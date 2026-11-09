'use strict';

/**
 * Отправка единого дайджеста по тендерам.
 *
 * ── Роль модуля ────────────────────────────────────────────────────────────
 * `tender-digest.js` знает, КОГДА можно отправлять и КАК выглядит письмо.
 * Этот модуль связывает его с реальностью:
 *   • кладёт события в очередь (tender_digest_outbox);
 *   • по крону забирает неотправленные и шлёт ОДНО письмо;
 *   • помечает отправленные, чтобы не повторить;
 *   • не даёт двум серверам отправить дважды (advisory lock).
 *
 * ── Почему очередь, а не прямая отправка ──────────────────────────────────
 * Прямая отправка в момент события — это и есть спам: 14 тендеров × 4 события
 * = 56 писем в день. Очередь позволяет собрать их в два письма и отправить в
 * рабочие окна.
 */

const digest = require('./tender-digest');

/** Права advisory-замка: два инстанса не отправят дайджест одновременно. */
const LOCK_ID = 47601;

/**
 * Кладёт событие в очередь.
 *
 * Дедупликация по event_key: повторная попытка того же события не создаёт
 * вторую запись. Это важно, потому что обработчики могут срабатывать
 * несколько раз (пересохранение, повторный вызов анализа).
 *
 * @param {object} db — пул/клиент с .query
 * @param {{kind: string, tender_id: number, title?: string, deadline?: string,
 *          urgent?: boolean, payload?: object}} ev
 * @returns {Promise<{ok: boolean, queued: boolean, key: string}>}
 */
async function enqueueEvent(db, ev) {
  const e = ev || {};
  if (!e.kind || e.tender_id == null) {
    return { ok: false, queued: false, key: '', error: 'нужны kind и tender_id' };
  }
  const key = digest.eventKey({ kind: e.kind, tender_id: e.tender_id, subject: e.title || '' });
  // Срочность считаем сами, если дедлайн передан: политика времени должна
  // жить в одном месте, а не в каждом обработчике.
  const urgent = e.urgent != null
    ? !!e.urgent
    : digest.isUrgentDeadline(e.deadline || null);

  try {
    const r = await db.query(
      `INSERT INTO tender_digest_outbox
         (event_key, kind, tender_id, title, deadline, urgent, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (event_key) DO NOTHING
       RETURNING id`,
      [key, String(e.kind), e.tender_id, e.title || null,
        e.deadline || null, urgent, e.payload ? JSON.stringify(e.payload) : null]
    );
    return { ok: true, queued: r.rowCount > 0, key };
  } catch (err) {
    // Очередь — вспомогательная: не роняем бизнес-операцию из-за неё.
    return { ok: false, queued: false, key, error: err.message };
  }
}

/**
 * Забирает неотправленные события.
 *
 * @param {object} db
 * @param {{limit?: number}} [opts]
 * @returns {Promise<Array<object>>}
 */
async function takePending(db, opts = {}) {
  const limit = Math.min(Number(opts.limit) || 500, 2000);
  const r = await db.query(
    `SELECT id, event_key, kind, tender_id, title, deadline, urgent, payload, created_at
       FROM tender_digest_outbox
      WHERE sent_at IS NULL
      ORDER BY urgent DESC, deadline NULLS LAST, created_at
      LIMIT $1`,
    [limit]
  );
  return r.rows || [];
}

/**
 * Помечает события отправленными.
 *
 * @param {object} db
 * @param {number[]} ids
 * @param {string} sentTo — кому ушло (для аудита)
 * @returns {Promise<number>} сколько помечено
 */
async function markSent(db, ids, sentTo) {
  const list = (Array.isArray(ids) ? ids : []).filter((x) => Number.isFinite(Number(x)));
  if (!list.length) return 0;
  const r = await db.query(
    `UPDATE tender_digest_outbox
        SET sent_at = NOW(), sent_to = $2
      WHERE id = ANY($1::bigint[]) AND sent_at IS NULL`,
    [list, sentTo || null]
  );
  return r.rowCount || 0;
}

/**
 * Основной проход крона: решает, можно ли слать, и отправляет.
 *
 * @param {object} p
 * @param {object} p.db
 * @param {object} p.log — логгер fastify
 * @param {Function} p.sendMail — функция отправки (db, log, opts)
 * @param {Date} [p.now] — для тестов
 * @param {string[]} [p.recipients] — кому слать
 * @param {boolean} [p.force] — игнорировать окна (только для ручного запуска)
 * @returns {Promise<object>}
 */
async function runDigest({ db, log, sendMail, now, recipients, force }) {
  const at = now instanceof Date ? now : new Date();

  // ── Замок: второй инстанс не должен отправить то же письмо ──────────────
  let locked = false;
  try {
    const l = await db.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
    locked = !!(l.rows && l.rows[0] && l.rows[0].ok);
  } catch (_) {
    locked = false;
  }
  if (!locked) {
    return { ok: false, skipped: true, reason: 'дайджест уже отправляется другим процессом' };
  }

  try {
    const events = await takePending(db, { limit: 500 });
    if (!events.length) {
      return { ok: true, sent: 0, reason: 'очередь пуста' };
    }

    // Срочные события разрешают отправку вне окон (но только днём).
    const hasUrgent = events.some((e) => e.urgent);
    const gate = digest.canSendNow(at, { urgent: hasUrgent });
    if (!gate.allowed && !force) {
      const next = digest.nextWindow(at);
      return {
        ok: true,
        sent: 0,
        pending: events.length,
        reason: gate.reason,
        next_window: next.at
      };
    }

    const windowKind = gate.window === 'urgent' ? 'urgent' : gate.window;
    const subject = digest.buildSubject(events, windowKind === 'off' ? 'morning' : windowKind);
    const html = digest.buildHtml(events, { window: windowKind });
    const text = digest.buildText(events, { window: windowKind });

    const to = (Array.isArray(recipients) ? recipients : []).filter(Boolean);
    if (!to.length) {
      return { ok: false, sent: 0, pending: events.length, reason: 'некому отправлять' };
    }

    await sendMail(db, log, {
      to: to.length === 1 ? to[0] : to,
      subject,
      html,
      text,
      skipBcc: true,
      noBcc: true
    });

    // ── Один push на весь дайджест ────────────────────────────────────────
    // Раньше push уходил на КАЖДОЕ тендерное событие (события больше не шлют
    // push сами — см. notify.js). Здесь ровно один push на дайджест, без
    // отдельного tag на событие: ОС схлопывает его в одно уведомление.
    //
    // Ошибку не пробрасываем: если подписки нет или push не настроен,
    // письмо уже ушло, и бизнес-операция завершена.
    let pushed = 0;
    try {
      pushed = await sendDigestPush(db, log, { events, subject, windowKind, urgent: hasUrgent });
    } catch (e) {
      log?.warn?.('[TenderDigest] push не отправлен: ' + e.message);
    }

    const marked = await markSent(db, events.map((e) => e.id), to.join(','));
    log?.info?.(`[TenderDigest] отправлено ${marked} событий (окно: ${windowKind}), push: ${pushed}`);
    return { ok: true, sent: marked, window: windowKind, urgent: hasUrgent, pushed };
  } finally {
    try { await db.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); } catch (_) {}
  }
}

/**
 * Один push на весь дайджест.
 *
 * События тендеров больше не шлют push сами (notify.js пропускает тип
 * `tender_*`). Здесь собираем их в ОДНО уведомление: заголовок — сколько
 * срочных и всего, тело — первые несколько тендеров. Так РП получает один
 * пуш утром и один вечером вместо десятков.
 *
 * Тег постоянный: ОС заменит предыдущий дайджест, а не покажет второй.
 *
 * @param {object} db
 * @param {object} log
 * @param {{events: Array<object>, subject: string, windowKind: string, urgent: boolean}} p
 * @returns {Promise<number>} сколько устройств получило
 */
async function sendDigestPush(db, log, p) {
  const o = p || {};
  const events = Array.isArray(o.events) ? o.events : [];
  if (!events.length) return 0;

  let webpush;
  try { webpush = require('web-push'); } catch (_) { return 0; }
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return 0;

  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@asgard-crm.ru',
    publicKey,
    privateKey
  );

  const urgentCount = events.filter((e) => e && e.urgent).length;
  // Заголовок без служебных слов: «Тендеры: 3 (1 срочный)».
  const title = urgentCount
    ? `Тендеры: ${events.length} (${urgentCount} срочно)`
    : `Тендеры: ${events.length}`;
  // Тело: первые три названия, чтобы было понятно без открытия.
  const names = events.slice(0, 3)
    .map((e) => {
      const no = e.registry_no ? `№ ${e.registry_no} · ` : '';
      return no + String(e.title || 'тендер').slice(0, 60);
    });
  const more = events.length > 3 ? ` и ещё ${events.length - 3}` : '';
  const body = names.join('; ') + more;

  // Кому: все активные подписки. Дайджест общий для тендерного контура,
  // поэтому не привязываемся к конкретному userId.
  const subs = await db.query(
    'SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions'
  );
  if (!subs.rows || !subs.rows.length) return 0;

  const payload = JSON.stringify({
    title,
    body,
    url: '/m/',
    // Постоянный tag: новый дайджест заменяет старый, а не копится.
    tag: 'tender-digest-' + (o.windowKind || 'day'),
    urgent: !!o.urgent,
    icon: './assets/img/icon-192.png'
  });

  let sent = 0;
  for (const sub of subs.rows) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      }, payload, { urgency: o.urgent ? 'high' : 'normal', TTL: 6 * 60 * 60 });
      sent += 1;
    } catch (err) {
      // Просроченная подписка — удаляем, чтобы не копить мёртвые.
      if (err && (err.statusCode === 410 || err.statusCode === 404)) {
        await db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      }
    }
  }
  return sent;
}

/**
 * Чистка старых отправленных событий (раз в сутки).
 *
 * @param {object} db
 * @param {number} [days]
 * @returns {Promise<number>}
 */
async function purgeOld(db, days = 60) {
  const n = Math.max(7, Number(days) || 60);
  const r = await db.query(
    `DELETE FROM tender_digest_outbox
      WHERE sent_at IS NOT NULL AND sent_at < NOW() - ($1 || ' days')::interval`,
    [String(n)]
  );
  return r.rowCount || 0;
}

module.exports = {
  LOCK_ID,
  enqueueEvent,
  takePending,
  markSent,
  runDigest,
  purgeOld
};
