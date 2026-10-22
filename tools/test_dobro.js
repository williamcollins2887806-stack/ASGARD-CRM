'use strict';
/**
 * D-342: тесты «Добро» директора — не пропадает, не срабатывает ложно.
 * Проверяем: срок годности отложенного согласия и гашение уже решённых.
 */
const assert = require('assert');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log(`PASS  ${name}`); pass++; }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); fail++; }
}

/**
 * Мок БД. Различает запросы по тексту, чтобы проверить ИМЕННО логику TTL/гашения.
 */
function makeDb(cfg = {}) {
  const log = [];
  return {
    log,
    query: async (sql, params) => {
      const s = String(sql);
      log.push({ sql: s, head: s.slice(0, 70), params });
      // ВАЖНО: порядок ветвей ниже важен. Запрос гашения просроченных и запрос
      // поиска согласий оба содержат `FROM doc_approval_grant` — сначала
      // отсекаем UPDATE-ы, только потом SELECT.
      // 1. Гашение просроченных (UPDATE ... 'просрочено')
      if (/^\s*UPDATE\s+doc_approval_grant/i.test(s) && /просрочено/.test(s)) {
        return { rows: cfg.expired ? cfg.expired.map((id) => ({ id })) : [] };
      }
      // 2. Погашение уже решённой заявки (UPDATE ... 'заявка уже решена')
      if (/^\s*UPDATE\s+doc_approval_grant/i.test(s) && /заявка уже решена/.test(s)) {
        return { rows: [] };
      }
      // 3. Применение согласия (UPDATE ... applied_ids)
      if (/^\s*UPDATE\s+doc_approval_grant/i.test(s) && /applied_ids/.test(s)) return { rows: [] };
      // 4. Поиск согласий (SELECT ... FROM doc_approval_grant g)
      if (/SELECT[\s\S]*FROM doc_approval_grant g/i.test(s)) return { rows: cfg.grants || [] };
      // Заявка
      if (/FROM payment_invoices WHERE id=\$1/.test(s)) return { rows: cfg.pay ? [cfg.pay] : [] };
      // Пользователь-согласующий
      if (/FROM users WHERE id=\$1/.test(s)) return { rows: [{ id: 3456, name: 'Директор', role: 'DIRECTOR_COMM' }] };
      // Настройки
      if (/FROM settings/.test(s)) return { rows: [{ value_json: '3456' }] };
      return { rows: [] };
    }
  };
}

(async () => {
  const thr = require('../src/services/approval-thread');

  console.log('=== 1. Просроченное согласие НЕ применяется ===');
  await t('grant старше 72ч: поиск его не возвращает (условие по интервалу в SQL)', async () => {
    const db = makeDb({ grants: [], pay: { id: 8, status: 'awaiting_dir' } });
    const r = await thr.applyPendingGrants(db, { paymentId: 8, sourceEmailId: 4917, threadKey: 'T1' });
    assert.strictEqual(r.applied, false);
    // В запросе поиска обязан быть фильтр по свежести
    const search = db.log.find((x) => /FROM doc_approval_grant g/.test(x.sql));
    assert.ok(search, 'запрос поиска согласий должен быть');
    const full = db.log.find((x) => /hours/.test(x.sql));
    assert.ok(full, 'должен быть фильтр по сроку годности (hours)');
  });

  console.log('\n=== 2. Гашение уже решённой заявки ===');
  await t('заявка уже pending_payment → согласие гасится, applied=false', async () => {
    const db = makeDb({
      grants: [{ id: 1, thread_key: 'T1', action: 'approve' }],
      pay: { id: 8, status: 'pending_payment' }
    });
    const r = await thr.applyPendingGrants(db, { paymentId: 8, sourceEmailId: 4917, threadKey: 'T1' });
    assert.strictEqual(r.applied, false);
    const extinguished = db.log.find((x) => /заявка уже решена/.test(x.sql));
    assert.ok(extinguished, 'согласие должно быть погашено (UPDATE с пометкой)');
  });

  await t('заявки нет вовсе → согласие тоже гасится', async () => {
    const db = makeDb({ grants: [{ id: 2, thread_key: 'T1' }], pay: null });
    const r = await thr.applyPendingGrants(db, { paymentId: 99, threadKey: 'T1' });
    assert.strictEqual(r.applied, false);
    assert.ok(db.log.some((x) => /заявка уже решена/.test(x.sql)), 'должно погаситься');
  });

  console.log('\n=== 3. Живое согласие применяется ===');
  await t('заявка awaiting_dir + свежий grant → применяется', async () => {
    const db = makeDb({
      grants: [{ id: 3, thread_key: 'T1', action: 'approve' }],
      pay: { id: 10, status: 'awaiting_dir' }
    });
    // applyDecision импортируется из payment-mail — подменяем через require cache.
    const pmPath = require.resolve('../src/services/payment-mail');
    const orig = require.cache[pmPath];
    require.cache[pmPath] = {
      id: pmPath, filename: pmPath, loaded: true, exports: {
        applyDecision: async () => ({ ok: true, status: 'pending_payment' })
      }
    };
    try {
      const r = await thr.applyPendingGrants(db, { paymentId: 10, threadKey: 'T1' });
      assert.strictEqual(r.applied, true, 'согласие должно примениться');
    } finally {
      if (orig) require.cache[pmPath] = orig; else delete require.cache[pmPath];
    }
  });

  console.log('\n=== 4. Просроченные гасятся отдельным проходом ===');
  await t('проход гашения просроченных выполняется', async () => {
    const db = makeDb({ expired: [5, 6], grants: [], pay: null });
    await thr.applyPendingGrants(db, { paymentId: 1, threadKey: 'T' });
    const cleanup = db.log.find((x) => /просрочено/.test(x.sql));
    assert.ok(cleanup, 'должен быть UPDATE для просроченных');
  });

  console.log('\n=== 5. Детектор: «добро» распознаётся, мусор — нет ===');
  const { detectApproval } = require('../src/services/approval-detector');
  await t('«Добро» → согласие', async () => {
    assert.strictEqual(detectApproval('Добро').approve, true);
  });
  await t('«ДоброОтправлено с iPhone» → согласие (склейка подписи)', async () => {
    assert.strictEqual(detectApproval('ДоброОтправлено с iPhone').approve, true);
  });
  await t('«Доброе утро» → НЕ согласие', async () => {
    assert.strictEqual(detectApproval('Доброе утро').approve, false);
  });
  await t('«Добро, но не оплачивайте» → НЕ согласие', async () => {
    assert.strictEqual(detectApproval('Добро\n--\nНе оплачивайте').approve, false);
  });
  await t('«Да» без «добро» → НЕ согласие (D-285)', async () => {
    assert.strictEqual(detectApproval('Да').approve, false);
  });

  console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
  if (fail) process.exitCode = 1;
})();
