'use strict';

/**
 * Тесты проводки дайджеста: очередь → отправка в окно → пометка.
 *
 * ── Что проверяем ──────────────────────────────────────────────────────────
 * `tender-digest.js` умел окна и письмо, но нигде не был подключён: события
 * не копились, крон не звал, дедуп не хранился. Теперь есть очередь
 * (tender_digest_outbox) и раннер. Проверяем на фейковой БД — без сервера.
 *
 * Главные гарантии:
 *   • одно событие не попадает в очередь дважды (дедуп по ключу);
 *   • вне окон письмо НЕ уходит, очередь ждёт;
 *   • срочное может уйти днём вне окна;
 *   • после отправки события помечены и повторно не пойдут;
 *   • без получателей письмо не уходит и события не теряются.
 */

const assert = require('assert');
const path = require('path');

const digest = require(path.join(__dirname, '..', 'src', 'services', 'tender-digest.js'));
const runner = require(path.join(__dirname, '..', 'src', 'services', 'tender-digest-runner.js'));

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log('FAIL ' + name + ' — ' + e.message);
  }
}

/** Фейковая БД: хранит очередь в памяти, отвечает на нужные запросы. */
function makeDb() {
  const rows = [];
  let nextId = 1;
  const db = {
    rows,
    async query(sql, params = []) {
      const s = String(sql);

      if (/pg_try_advisory_lock/.test(s)) return { rows: [{ ok: true }], rowCount: 1 };
      if (/pg_advisory_unlock/.test(s)) return { rows: [{ pg_advisory_unlock: true }], rowCount: 1 };

      if (/INSERT INTO tender_digest_outbox/.test(s)) {
        const key = params[0];
        const existing = rows.find((r) => r.event_key === key);
        if (existing) {
          // ON CONFLICT DO UPDATE ... WHERE sent_at IS NOT NULL AND old > 36ч
          const canRevive = existing.sent_at
            && (Date.now() - new Date(existing.sent_at).getTime()) > 36 * 3600 * 1000;
          if (!canRevive) return { rows: [], rowCount: 0 };
          existing.sent_at = null;
          existing.urgent = params[5];
          existing.deadline = params[4];
          existing.payload = params[6];
          existing.created_at = new Date();
          return { rows: [{ id: existing.id }], rowCount: 1 };
        }
        const row = {
          id: nextId++,
          event_key: key,
          kind: params[1],
          tender_id: params[2],
          title: params[3],
          deadline: params[4],
          urgent: params[5],
          payload: params[6],
          created_at: new Date(),
          sent_at: null
        };
        rows.push(row);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }

      if (/FROM tender_digest_outbox[\s\S]*sent_at IS NULL/.test(s)) {
        const pending = rows.filter((r) => !r.sent_at);
        return { rows: pending, rowCount: pending.length };
      }

      if (/UPDATE tender_digest_outbox/.test(s)) {
        const ids = new Set((params[0] || []).map(Number));
        let n = 0;
        for (const r of rows) {
          if (ids.has(r.id) && !r.sent_at) { r.sent_at = new Date(); r.sent_to = params[1]; n += 1; }
        }
        return { rows: [], rowCount: n };
      }

      if (/DELETE FROM tender_digest_outbox/.test(s)) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].sent_at) rows.splice(i, 1);
        return { rowCount: before - rows.length };
      }

      return { rows: [], rowCount: 0 };
    }
  };
  return db;
}

/** Московское время как Date. */
function msk(y, m, d, h, min = 0) {
  return new Date(Date.UTC(y, m - 1, d, h - 3, min, 0));
}

(async () => {
  // ── 1. Очередь и дедупликация ───────────────────────────────────────────
  await check('событие кладётся в очередь', async () => {
    const db = makeDb();
    const r = await runner.enqueueEvent(db, { kind: 'analysis', tender_id: 2138, title: 'Очистка' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.queued, true);
    assert.strictEqual(db.rows.length, 1);
  });

  await check('то же событие не дублируется', async () => {
    const db = makeDb();
    const ev = { kind: 'analysis', tender_id: 2138, title: 'Очистка' };
    await runner.enqueueEvent(db, ev);
    const second = await runner.enqueueEvent(db, ev);
    assert.strictEqual(second.queued, false, 'событие продублировано');
    assert.strictEqual(db.rows.length, 1);
  });

  await check('разные тендеры — разные события', async () => {
    const db = makeDb();
    await runner.enqueueEvent(db, { kind: 'analysis', tender_id: 1, title: 'A' });
    await runner.enqueueEvent(db, { kind: 'analysis', tender_id: 2, title: 'B' });
    assert.strictEqual(db.rows.length, 2);
  });

  await check('срочность считается по дедлайну', async () => {
    const db = makeDb();
    const soon = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
    await runner.enqueueEvent(db, { kind: 'deadline', tender_id: 5, title: 'Горит', deadline: soon });
    assert.strictEqual(db.rows[0].urgent, true, 'близкий дедлайн не помечен срочным');
  });

  // ── 2. Отправка в окно ──────────────────────────────────────────────────
  await check('в окно 09:30 письмо уходит одним отправлением', async () => {
    const db = makeDb();
    await runner.enqueueEvent(db, { kind: 'analysis', tender_id: 1, title: 'A' });
    await runner.enqueueEvent(db, { kind: 'calc', tender_id: 2, title: 'B' });
    let calls = 0;
    const r = await runner.runDigest({
      db, log: null, sendMail: async () => { calls += 1; },
      now: msk(2026, 11, 9, 9, 30), recipients: ['rp@example.test']
    });
    assert.strictEqual(calls, 1, 'писем: ' + calls + ', должно быть одно');
    assert.strictEqual(r.sent, 2, 'отправлено событий: ' + r.sent);
    assert.ok(db.rows.every((x) => x.sent_at), 'не все помечены отправленными');
  });

  await check('вне окон письмо НЕ уходит, очередь ждёт', async () => {
    const db = makeDb();
    await runner.enqueueEvent(db, { kind: 'analysis', tender_id: 1, title: 'A' });
    let calls = 0;
    const r = await runner.runDigest({
      db, log: null, sendMail: async () => { calls += 1; },
      now: msk(2026, 11, 9, 13, 0), recipients: ['rp@example.test']
    });
    assert.strictEqual(calls, 0, 'письмо ушло вне окна');
    assert.strictEqual(r.sent, 0);
    assert.ok(r.next_window, 'нет подсказки о следующем окне');
    assert.ok(!db.rows[0].sent_at, 'событие помечено отправленным зря');
  });

  await check('ночью письмо не уходит даже со срочным', async () => {
    const db = makeDb();
    await runner.enqueueEvent(db, { kind: 'deadline', tender_id: 1, title: 'Горит', urgent: true });
    let calls = 0;
    const r = await runner.runDigest({
      db, log: null, sendMail: async () => { calls += 1; },
      now: msk(2026, 11, 9, 2, 0), recipients: ['rp@example.test']
    });
    assert.strictEqual(calls, 0, 'ночью письмо ушло');
    assert.strictEqual(r.sent, 0);
  });

  await check('срочное днём вне окна уходит', async () => {
    const db = makeDb();
    await runner.enqueueEvent(db, { kind: 'deadline', tender_id: 1, title: 'Горит', urgent: true });
    let calls = 0;
    const r = await runner.runDigest({
      db, log: null, sendMail: async () => { calls += 1; },
      now: msk(2026, 11, 9, 13, 0), recipients: ['rp@example.test']
    });
    assert.strictEqual(calls, 1, 'срочное не ушло днём');
    assert.strictEqual(r.window, 'urgent');
  });

  // ── 3. Повторный запуск ─────────────────────────────────────────────────
  await check('повторный запуск не отправляет то же снова', async () => {
    const db = makeDb();
    await runner.enqueueEvent(db, { kind: 'analysis', tender_id: 1, title: 'A' });
    let calls = 0;
    const send = async () => { calls += 1; };
    await runner.runDigest({ db, log: null, sendMail: send, now: msk(2026, 11, 9, 9, 30), recipients: ['a@b.c'] });
    const second = await runner.runDigest({ db, log: null, sendMail: send, now: msk(2026, 11, 9, 9, 35), recipients: ['a@b.c'] });
    assert.strictEqual(calls, 1, 'письмо ушло дважды');
    assert.strictEqual(second.sent, 0);
  });

  // ── 4. Краевые случаи ───────────────────────────────────────────────────
  await check('пустая очередь не отправляет письмо', async () => {
    const db = makeDb();
    let calls = 0;
    const r = await runner.runDigest({
      db, log: null, sendMail: async () => { calls += 1; },
      now: msk(2026, 11, 9, 9, 30), recipients: ['a@b.c']
    });
    assert.strictEqual(calls, 0);
    assert.strictEqual(r.sent, 0);
    assert.ok(/пуста/i.test(r.reason || ''), 'причина должна говорить про пустую очередь');
  });

  await check('без получателей письмо не уходит, события не теряются', async () => {
    const db = makeDb();
    await runner.enqueueEvent(db, { kind: 'analysis', tender_id: 1, title: 'A' });
    let calls = 0;
    const r = await runner.runDigest({
      db, log: null, sendMail: async () => { calls += 1; },
      now: msk(2026, 11, 9, 9, 30), recipients: []
    });
    assert.strictEqual(calls, 0, 'письмо ушло без получателей');
    assert.ok(!db.rows[0].sent_at, 'событие потеряно для следующего окна');
    assert.strictEqual(r.ok, false);
  });

  await check('событие без вида или тендера не ставится в очередь', async () => {
    const db = makeDb();
    const a = await runner.enqueueEvent(db, { tender_id: 1 });
    const b = await runner.enqueueEvent(db, { kind: 'analysis' });
    assert.strictEqual(a.ok, false);
    assert.strictEqual(b.ok, false);
    assert.strictEqual(db.rows.length, 0);
  });

  // ── 5. Чистка ───────────────────────────────────────────────────────────
  await check('чистка удаляет только отправленные', async () => {
    const db = makeDb();
    await runner.enqueueEvent(db, { kind: 'analysis', tender_id: 1, title: 'A' });
    await runner.enqueueEvent(db, { kind: 'analysis', tender_id: 2, title: 'B' });
    db.rows[0].sent_at = new Date();
    const removed = await runner.purgeOld(db, 60);
    assert.strictEqual(removed, 1, 'удалено: ' + removed);
    assert.strictEqual(db.rows.length, 1);
    assert.ok(!db.rows[0].sent_at, 'неотправленное удалено');
  });

  // ── 6. Push дайджеста ───────────────────────────────────────────────────
  await check('без VAPID push не отправляется, но письмо уходит', async () => {
    // Ключей нет в тестах — push должен тихо пропуститься, письмо уйти.
    const db = makeDb();
    await runner.enqueueEvent(db, { kind: 'analysis', tender_id: 1, title: 'A' });
    let mails = 0;
    const r = await runner.runDigest({
      db, log: null, sendMail: async () => { mails += 1; },
      now: msk(2026, 11, 9, 9, 30), recipients: ['a@b.c']
    });
    assert.strictEqual(mails, 1, 'письмо не ушло');
    assert.strictEqual(r.pushed, 0, 'push ушёл без ключей');
  });

  await check('события тендеров больше не шлют push сами', () => {
    // notify.js пропускает тип tender_* — иначе push уходил бы на каждое
    // событие, и дайджест терял бы смысл.
    const notifySrc = require('fs').readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'notify.js'), 'utf8'
    );
    assert.ok(/isTenderDigestEvent/.test(notifySrc), 'нет фильтра тендерных пущ-событий');
  });

  // ── 7. Повторное напоминание ─────────────────────────────────────────────
  await check('повторное напоминание доходит после 36 ч, но не раньше', async () => {
    // Дефект: ON CONFLICT DO NOTHING делал ключ вечным. Один раз напомнили —
    // и тендер навсегда выпадал из напоминаний, хотя он ещё висит.
    const db = makeDb();
    const ev = { kind: 'analysis_idle', tender_id: 77, title: 'X' };

    const first = await runner.enqueueEvent(db, ev);
    assert.strictEqual(first.queued, true, 'первое событие не встало в очередь');

    let mails = 0;
    await runner.runDigest({
      db, log: null, sendMail: async () => { mails += 1; },
      now: msk(2026, 11, 9, 9, 30), recipients: ['a@b.c']
    });
    assert.strictEqual(mails, 1, 'письмо не ушло');
    assert.strictEqual(db.rows[0].sent_at != null, true, 'событие не помечено отправленным');

    // Сразу повторно — не дубль.
    const again = await runner.enqueueEvent(db, ev);
    assert.strictEqual(again.queued, false, 'продублировали отправленное событие');

    // Сдвигаем отметку на 40 часов назад: напоминание должно ожить.
    db.rows[0].sent_at = new Date(Date.now() - 40 * 3600 * 1000);
    const revived = await runner.enqueueEvent(db, ev);
    assert.strictEqual(revived.queued, true, 'напоминание не ожило через 40 ч');
  });

  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
  process.exit(failed.length ? 1 : 0);
})();
