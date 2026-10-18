/**
 * V411: «Мои заявки» — два потока в одной странице (заказчик 18.10.2026):
 *   • «Закупки» — канбан/таблица, заявку создаёт РП;
 *   • «Счета на оплату» — карточки со СВОИМИ статусами (у директора / у бухгалтерии /
 *     оплачен / возвращён), счёт идёт сразу директору, минуя закупщика.
 * Плюс API /api/payment-invoices/my: инициатор видит свои счета и их стадию.
 */
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

async function login(l, p) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
  const d = await r.json(); let t = d.token;
  if (d.status === 'need_pin') {
    for (const pin of ['0000', '1234']) {
      const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) });
      const d2 = await r2.json().catch(() => ({})); if (d2.token) { t = d2.token; break; }
    }
  }
  return t;
}
const H = (t) => ({ Authorization: 'Bearer ' + t });

(async () => {
  console.log('=== «Мои заявки»: счета на оплату для инициатора ===');
  const pm = await login('test_pm', 'Test123!');
  const buh = await login('test_buh', 'Test123!');

  console.log('\n-- 1. API /my отдаёт свои счета со стадией --');
  const r1 = await fetch(BASE + '/api/payment-invoices/my', { headers: H(pm) });
  const j1 = await r1.json();
  ok(r1.status === 200, 'эндпоинт отвечает 200');
  ok(Array.isArray(j1.items), 'вернулся список items (' + (j1.items || []).length + ')');
  const withStage = (j1.items || []).filter((x) => x.stage && x.stage.label);
  ok(withStage.length === (j1.items || []).length, 'у каждой заявки есть человеческая стадия');
  if (withStage.length) console.log('     пример:', withStage[0].id, withStage[0].supplier_name, '→', withStage[0].stage.label);

  console.log('\n-- 2. Стадии осмысленные --');
  const stages = [...new Set((j1.items || []).map((x) => x.stage.code))];
  console.log('     стадии:', JSON.stringify(stages));
  const allowed = ['dir', 'buh', 'paid', 'rejected', 'expired', 'other'];
  ok(stages.every((s) => allowed.includes(s)), 'все стадии из ожидаемого набора');

  console.log('\n-- 3. РП видит ТОЛЬКО свои счета (не чужие) --');
  const me = (await db.query(`SELECT id FROM users WHERE login='test_pm'`)).rows[0].id;
  // created_by приходит в ответе внутри полей заявки; если его нет — сверяем по БД.
  const ids = (j1.items || []).map((x) => x.id);
  let foreign = [];
  if (ids.length) {
    const own = (await db.query(`SELECT id FROM payment_invoices WHERE id = ANY($1::int[]) AND created_by = $2`, [ids, me]));
    const ownSet = new Set(own.rows.map((r) => Number(r.id)));
    foreign = ids.filter((i) => !ownSet.has(Number(i)));
  }
  ok(foreign.length === 0, 'чужих счетов в «моих» нет (' + foreign.length + ')' + (foreign.length ? ': ' + JSON.stringify(foreign.slice(0, 3)) : ''));

  console.log('\n-- 4. Карточка чужого счёта РП недоступна (403) --');
  const other = (await db.query(`SELECT id FROM payment_invoices WHERE created_by <> $1 AND created_by IS NOT NULL LIMIT 1`, [me])).rows[0];
  if (other) {
    const r = await fetch(BASE + `/api/payment-invoices/${other.id}`, { headers: H(pm) });
    ok(r.status === 403 || r.status === 404, 'чужой счёт закрыт (' + r.status + ')');
  } else console.log('     (нет чужого счёта для проверки)');

  console.log('\n-- 5. Привилегированные видят все (all=1) --');
  const r2 = await fetch(BASE + '/api/payment-invoices/my?all=1', { headers: H(buh) });
  const j2 = await r2.json();
  ok(r2.status === 200 && (j2.items || []).length >= (j1.items || []).length, 'бухгалтер видит сводку (' + (j2.items || []).length + ' ≥ ' + (j1.items || []).length + ')');

  console.log('\n-- 6. Простой сотрудник (не PM) тоже видит свои счета --');
  const admin = await login('test_admin', 'Test123!');
  const r3 = await fetch(BASE + '/api/payment-invoices/my', { headers: H(admin) });
  ok(r3.status === 200, 'ADMIN получает 200 (может подать счёт и видеть свой)');

  console.log('\n-- 7. Поля для карточки заполнены --');
  const one = (j1.items || [])[0];
  if (one) {
    ok(one.amount != null, 'сумма: ' + one.amount);
    ok('supplier_name' in one, 'контрагент: ' + one.supplier_name);
    ok('has_file' in one, 'флаг файла: ' + one.has_file);
    ok('lines_count' in one, 'позиций: ' + one.lines_count);
  }

  await db.end();
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('CRASH', e.message); try { await db.end(); } catch (_) {} process.exit(1); });
