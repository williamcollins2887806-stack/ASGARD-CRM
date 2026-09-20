/**
 * C5 — рантайм-верификация AI/fuzzy парсера на КЛОНЕ (:3101, asgard_crm_test).
 *
 * Проверяет (каждый пункт — с доказательством):
 *   1) Словарь синонимов и нормализация (юнит, без сети):
 *      «УШМ» ≡ «болгарка», «АКБ» ≡ «аккумулятор»; кавычки/ё не мешают.
 *   2) Токен-пересечение: синоним/перестановка даёт матч, а РАЗНЫЕ позиции
 *      (АКБ 12В vs АКБ 7Ач) — НЕ дают (иначе ложный матч хуже промаха).
 *   3) Эвристика строк счёта ДО AI: ≥3 позиции → AI не вызывается.
 *   4) Рантайм `POST /api/procurement/:id/invoice/parse`: строка счёта «УШМ 125»
 *      матчится на позицию заявки «Болгарка (УШМ) 125 мм» (match_via = synonym|tokens),
 *      «АКБ 12В» → «Аккумулятор 12В 2Ач», а чужая строка — в unmatched.
 *   5) Рантайм `POST /api/warehouse-cart/suggest-ai`: синоним находит товар каталога,
 *      ответ ≤ 60 с.
 *
 * Пишет только в клон-БД; в конце убирает за собой.
 * Запуск: node tools/verify_c5_parser.js
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Client } = require('pg');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3101';
const DB = process.env.CL_DB_NAME || 'asgard_crm_test';
const tm = require('../src/services/text-match');

const pool = new Client({ host: '127.0.0.1', port: 5432, user: 'asgard', password: '123456789', database: DB });

let pass = 0, fail = 0;
function check(name, ok, proof) { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${name}${proof ? ' — ' + proof : ''}`); }

async function login(login, password, pin = '0000') {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const d = await r.json().catch(() => ({}));
  let token = d.token;
  if (d.status === 'need_pin') {
    const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ pin }) });
    token = ((await r2.json().catch(() => ({}))).token) || token;
  }
  return token;
}
const H = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });

// Синтетический «текст счёта»: 3 строки с ценой → эвристика, AI не зовётся.
const INVOICE_TEXT = [
  'Счёт № 123 от 20.09.2026',
  'УШМ 125 1 шт 4 500,00',
  'АКБ 12В 2 шт 1 200,00',
  'Подшипник 6204 10 шт 350,00',
  'Итого с НДС 20%: 24 400,00',
].join('\n');

(async () => {
  await pool.connect();
  const created = { procId: null, productIds: [], importIds: [] };
  try {
    // ─── 1. Юнит: нормализация и синонимы (без сети) ───
    check('normalize: ё→е, кавычки/№ не мешают',
      tm.normalizeName('Ёмкость «Р-1» №5') === 'емкость р-1 5',
      `«${tm.normalizeName('Ёмкость «Р-1» №5')}»`);
    check('синоним: УШМ ≡ болгарка', tm.areSynonyms('УШМ', 'болгарка') === true, 'areSynonyms=true');
    check('синоним: АКБ ≡ аккумулятор', tm.areSynonyms('АКБ', 'аккумулятор') === true, 'areSynonyms=true');
    check('matchVariants: УШМ 125 → болгарка 125',
      tm.matchVariants('УШМ 125').some(v => v.includes('болгарка')),
      tm.matchVariants('УШМ 125').join(' | '));
    check('likePatterns: содержит %болгарка%',
      tm.likePatterns('УШМ 125').includes('%болгарка%'),
      tm.likePatterns('УШМ 125').join(','));

    // ─── 2. Токен-пересечение: синоним матчит, «похожие, но разные» — нет ───
    const ovPos = tm.tokenOverlapScore('УШМ 125', 'Болгарка (УШМ) 125 мм');
    check('tokenOverlap: «УШМ 125» ↔ «Болгарка (УШМ) 125 мм» ≥ 0.6 (матч)', ovPos >= 0.6, `ov=${ovPos.toFixed(2)}`);
    const ovAkb = tm.tokenOverlapScore('АКБ 12В', 'Аккумулятор 12В 2Ач');
    check('tokenOverlap: «АКБ 12В» ↔ «Аккумулятор 12В 2Ач» ≥ 0.6 (матч)', ovAkb >= 0.6, `ov=${ovAkb.toFixed(2)}`);
    const ovNeg = tm.tokenOverlapScore('АКБ 12В', 'Аккумулятор 7Ач');
    check('tokenOverlap: «АКБ 12В» ↔ «Аккумулятор 7Ач» < 0.6 (НЕ матч)', ovNeg < 0.6, `ov=${ovNeg.toFixed(2)}`);
    const ovAlien = tm.tokenOverlapScore('Подшипник 6204', 'Болгарка (УШМ) 125 мм');
    check('tokenOverlap: чужая строка ↔ позиция = 0', ovAlien === 0, `ov=${ovAlien.toFixed(2)}`);

    // ─── 3. Эвристика строк до AI ───
    const heur = tm.heuristicParseInvoiceLines(INVOICE_TEXT);
    check('эвристика: 3 позиции из текста счёта (AI не нужен)', heur.length === 3, `n=${heur.length}`);
    const hUshm = heur.find(x => /ушм|болгарк/i.test(x.name));
    check('эвристика: «УШМ 125» распознан с ценой 4500 и кол-вом 1',
      !!hUshm && hUshm.unit_price === 4500 && hUshm.quantity === 1,
      hUshm ? `name="${hUshm.name}" qty=${hUshm.quantity} price=${hUshm.unit_price}` : 'нет');

    // ─── 4. Рантайм: invoice/parse матчит по синониму ───
    const pmToken = await login('test_pm', 'Test123!');
    const adminToken = await login('test_admin', 'Test123!');
    check('login: PM/ADMIN', !!pmToken && !!adminToken, `pm=${!!pmToken} admin=${!!adminToken}`);

    const workId = (await pool.query(`SELECT id FROM works WHERE pm_id=(SELECT id FROM users WHERE login='test_pm') ORDER BY id DESC LIMIT 1`)).rows[0]?.id || null;

    let r = await fetch(BASE + '/api/procurement', { method: 'POST', headers: H(pmToken), body: JSON.stringify({ work_id: workId, title: 'VERIFY C5 парсер' }) });
    let d = await r.json().catch(() => ({}));
    const procId = d.item && d.item.id;
    created.procId = procId;
    check('POST /api/procurement (черновик)', r.status === 200 && !!procId, `status=${r.status} id=${procId}`);

    const namesBefore = await pool.query(`SELECT id FROM products WHERE name IN ('Болгарка (УШМ) 125 мм','Аккумулятор 12В 2Ач')`);
    const beforeIds = new Set(namesBefore.rows.map(x => x.id));

    for (const it of [{ name: 'Болгарка (УШМ) 125 мм', quantity: 1 }, { name: 'Аккумулятор 12В 2Ач', quantity: 2 }]) {
      const rr = await fetch(BASE + `/api/procurement/${procId}/items`, { method: 'POST', headers: H(pmToken), body: JSON.stringify({ ...it, unit: 'шт', delivery_target: 'warehouse' }) });
      if (rr.status !== 200) check(`POST .../items "${it.name}"`, false, `status=${rr.status}`);
    }
    const items = (await pool.query(`SELECT id,name FROM procurement_items WHERE procurement_id=$1 ORDER BY id`, [procId])).rows;
    check('заявка: 2 позиции созданы', items.length === 2, items.map(x => `${x.id}:${x.name}`).join(' | '));

    const afterIds = await pool.query(`SELECT id,name FROM products WHERE name IN ('Болгарка (УШМ) 125 мм','Аккумулятор 12В 2Ач')`);
    for (const p of afterIds.rows) if (!beforeIds.has(p.id)) created.productIds.push(p.id);

    r = await fetch(BASE + `/api/procurement/${procId}/invoice/parse`, { method: 'POST', headers: H(pmToken), body: JSON.stringify({ text: INVOICE_TEXT }) });
    d = await r.json().catch(() => ({}));
    const matches = d.matches || [], unmatched = d.unmatched || [];
    check('POST invoice/parse: 200 и есть матчи', r.status === 200 && matches.length >= 2, `status=${r.status} matched=${matches.length} unmatched=${unmatched.length}`);

    const mUshm = matches.find(m => /ушм/i.test(m.invoice_name));
    check('матч по синониму: «УШМ 125» → позиция «Болгарка (УШМ) 125 мм»',
      !!mUshm && /болгарк/i.test(mUshm.item_name) && ['synonym', 'tokens'].includes(mUshm.match_via),
      mUshm ? `via=${mUshm.match_via} → ${mUshm.item_name} (conf=${mUshm.confidence})` : 'нет матча');

    const mAkb = matches.find(m => /акб/i.test(m.invoice_name));
    check('матч по синониму: «АКБ 12В» → позиция «Аккумулятор 12В 2Ач»',
      !!mAkb && /аккумулятор/i.test(mAkb.item_name) && ['synonym', 'tokens'].includes(mAkb.match_via),
      mAkb ? `via=${mAkb.match_via} → ${mAkb.item_name} (conf=${mAkb.confidence})` : 'нет матча');

    check('чужая строка «Подшипник 6204» → unmatched (не ложный матч)',
      unmatched.some(u => /подшипник/i.test(u.invoice_name)),
      unmatched.map(u => u.invoice_name).join(' | ') || '(пусто)');

    const priceU = mUshm && mUshm.unit_price;
    check('цена из счёта доехала до матча (4500)', priceU === 4500, `unit_price=${priceU}`);

    // import-лог сохранён (в т.ч. эвристикой, без AI)
    const imp = await pool.query(`SELECT id, parsed_json FROM procurement_invoice_imports WHERE procurement_id=$1 ORDER BY id DESC LIMIT 1`, [procId]);
    if (imp.rows[0]) created.importIds.push(imp.rows[0].id);
    check('import-лог записан (parsed_json непустой)',
      !!imp.rows[0] && Array.isArray(imp.rows[0].parsed_json) && imp.rows[0].parsed_json.length >= 3,
      imp.rows[0] ? `import_id=${imp.rows[0].id} parsed=${(imp.rows[0].parsed_json || []).length}` : 'нет строки');

    // ─── 5. Рантайм: suggest-ai по синониму + latency ≤ 60 с ───
    const t0 = Date.now();
    let sr = await fetch(BASE + '/api/warehouse-cart/suggest-ai', { method: 'POST', headers: H(pmToken), body: JSON.stringify({ rows: [{ name: 'УШМ 125 мм', quantity: 1 }] }) });
    const elapsed = Date.now() - t0;
    const sd = await sr.json().catch(() => ({}));
    const s0 = (sd.suggestions || [])[0] || {};
    const altNames = (s0.alternatives || []).map(a => a.name).join(' | ');
    check('POST /warehouse-cart/suggest-ai: 200', sr.status === 200, `status=${sr.status}`);
    check('suggest-ai: синоним «УШМ 125 мм» находит товар каталога',
      !!(s0.matched && s0.product_id && (s0.alternatives || []).some(a => /болгарк|ушм/i.test(a.name || ''))),
      `matched=${s0.matched} product_id=${s0.product_id} alts=[${altNames}]`);
    check('suggest-ai latency ≤ 60 c', elapsed < 60000, `${elapsed} мс (ai_used=${sd.ai_used})`);

  } catch (e) {
    check('НЕОЖИДАННАЯ ОШИБКА', false, e.message);
  } finally {
    try {
      if (created.procId) {
        await pool.query('DELETE FROM procurement_invoice_imports WHERE procurement_id=$1', [created.procId]);
        await pool.query('DELETE FROM procurement_items WHERE procurement_id=$1', [created.procId]);
        await pool.query('DELETE FROM procurement_history WHERE procurement_id=$1', [created.procId]);
        await pool.query('DELETE FROM procurement_requests WHERE id=$1', [created.procId]);
      }
      for (const pid of created.productIds) await pool.query('DELETE FROM products WHERE id=$1', [pid]).catch(() => {});
    } catch (e) { console.log('cleanup warn:', e.message); }
    await pool.end().catch(() => {});
  }

  console.log('\n===================================================');
  console.log(`  ИТОГ: ${pass} PASS / ${fail} FAIL`);
  console.log('===================================================');
  process.exit(fail > 0 ? 1 : 0);
})();
