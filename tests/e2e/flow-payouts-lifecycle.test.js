/**
 * E2E FLOW: цикл выплаты (#/payouts)
 * ═══════════════════════════════════════════════════════════════════════════
 * Полный бизнес-цикл на клоне:
 *   1. Проверка готовности периода (незакрытые смены → not-ready, но платить можно).
 *   2. Бухгалтер смотрит список → выбирает сотрудника → предпросмотр.
 *   3. Выплата аванса (обычный) → запись в БД (read-back).
 *   4. Рабочий в полевом приложении видит выплату в баннере (my/pending).
 *   5. Рабочий подтверждает по коду → статус confirmed.
 *   6. Выплата СЗ: налог 6% сверху, баннер показывает transfer.
 *   7. Архив месяца показывает обе выплаты; расчётный лист отдаётся Excel.
 *   8. Уборка: клон возвращается к baseline.
 *
 * Требует полевую сессию (field-JWT + pin_hash) — как в src/routes/field-auth.js.
 */
const {
  api, assert, assertOk, assertStatus, assertArray, assertHasFields,
  rawFetch, getToken, BASE_URL,
} = require('../config');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
try { require('dotenv').config(); } catch (_) { /* .env необязателен */ }

const FIELD_JWT_SECRET = process.env.FIELD_JWT_SECRET
  || ((process.env.JWT_SECRET || 'asgard-jwt-secret-2026') + '_field');

const PERIOD = { year: 2026, month: 11 }; // месяц, который тесты не трогают как «текущий»

let _pg = null;
function pg() {
  if (!_pg) {
    const { Client } = require('pg');
    _pg = new Client({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'asgard_crm_test',
      user: process.env.DB_USER || 'asgard',
      password: process.env.DB_PASSWORD || '123456789',
    });
    return _pg.connect().then(() => _pg);
  }
  return Promise.resolve(_pg);
}

async function fieldTokenFor(empId) {
  const c = await pg();
  // jti — чтобы повторный вход того же сотрудника в рамках теста дал другой токен
  // (иначе sha256-хеш совпадает и падает UNIQUE field_sessions_token_hash_key).
  const token = jwt.sign({ employee_id: empId, user_id: null, type: 'field', jti: crypto.randomUUID() }, FIELD_JWT_SECRET, { expiresIn: '1d' });
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await c.query(`INSERT INTO field_sessions (employee_id, token_hash, device_info, expires_at) VALUES ($1,$2,'e2e_flow', NOW()+INTERVAL '1 day')`, [empId, hash]);
  return token;
}

// Состояние потока
let empNormal = null;   // обычный сотрудник к выплате
let empSe = null;       // самозанятый
let payNormalId = null;
let paySeId = null;

module.exports = {
  name: 'E2E: цикл выплаты (страница → выплата → баннер → подтверждение → архив)',
  tests: [
    {
      name: '1. Доступ: бухгалтер видит страницу, чужой — нет',
      run: async () => {
        const adm = await api('GET', '/api/payouts/me', { role: 'ADMIN' });
        assertOk(adm, 'admin me');
        assert(adm.data.allowed === true, 'ADMIN должен иметь доступ');
        const hr = await api('GET', '/api/payouts/list/2026/9', { role: 'HR' });
        assertStatus(hr, 403, 'HR без гранта — 403');
      },
    },
    {
      name: '2. Готовность периода: незакрытые смены → предупреждение, но платить можно',
      run: async () => {
        const w = await api('GET', '/api/payouts/warnings/2026/4', { role: 'ADMIN' });
        assertOk(w, 'warnings april');
        assert(w.data.ready_to_pay === false, 'апрель not-ready');
        assertArray(w.data.warnings, 'warnings');
        // Ключевое: несмотря на предупреждение, список отдаётся (не блокирует)
        const list = await api('GET', `/api/payouts/list/2026/4`, { role: 'ADMIN' });
        assertOk(list, 'list still works when not ready');
      },
    },
    {
      name: '3. Бухгалтер находит сотрудников к выплате (обычный + СЗ)',
      run: async () => {
        const r = await api('GET', `/api/payouts/list/${PERIOD.year}/9`, { role: 'ADMIN' });
        assertOk(r, 'list for flow');
        const rows = r.data.rows || [];
        empNormal = rows.find((x) => !x.is_self_employed && x.to_pay > 0) || null;
        empSe = rows.find((x) => x.is_self_employed && x.to_pay > 0) || null;
        assert(empNormal, 'нужен обычный сотрудник к выплате');
        assert(empSe, 'нужен СЗ к выплате');
      },
    },
    {
      name: '4. Предпросмотр: строка и ставка налога приходят до выплаты',
      run: async () => {
        const r = await api('GET', `/api/payouts/preview/${empNormal.employee_id}?year=2026&month=9`, { role: 'ADMIN' });
        assertOk(r, 'preview');
        assertHasFields(r.data, ['employee', 'tax_rate', 'is_self_employed'], 'preview shape');
        assert(r.data.is_self_employed === false, 'обычный не СЗ');
      },
    },
    {
      name: '5. Выплата аванса обычному → записана в БД (read-back)',
      run: async () => {
        const r = await api('POST', '/api/payouts/pay', {
          role: 'ADMIN',
          body: { employee_id: empNormal.employee_id, year: PERIOD.year, month: PERIOD.month, kind: 'advance', pay_amount: 5000, payout_platform: 'cash', confirm_over: true },
        });
        assertOk(r, 'pay normal');
        payNormalId = r.data.payment.id;
        assert(payNormalId, 'нет id выплаты');
        assert(r.data.preview.transfer_amount === 5000, `transfer=${r.data.preview.transfer_amount}`);
        assert(r.data.preview.tax_amount === 0, 'у обычного налога нет');

        const hist = await api('GET', `/api/payouts/history/${empNormal.employee_id}`, { role: 'ADMIN' });
        const rec = (hist.data.operations || []).find((o) => o.id === payNormalId);
        assert(rec, 'выплата не найдена в истории');
        assert(rec.confirmation_status === 'awaiting', `статус ${rec.confirmation_status}`);
      },
    },
    {
      name: '6. Выплата СЗ: налог 6% сверху, transfer больше выплаты',
      run: async () => {
        const pay = 35000;
        const r = await api('POST', '/api/payouts/pay', {
          role: 'ADMIN',
          body: { employee_id: empSe.employee_id, year: PERIOD.year, month: PERIOD.month, kind: 'advance', pay_amount: pay, payout_platform: 'restaff', confirm_over: true },
        });
        assertOk(r, 'pay se');
        paySeId = r.data.payment.id;
        const expectedTax = Math.round(pay * 0.06 * 100) / 100; // 2100
        assert(Math.abs(r.data.preview.tax_amount - expectedTax) < 0.01, `tax=${r.data.preview.tax_amount}, ожидалось ${expectedTax}`);
        assert(Math.abs(r.data.preview.transfer_amount - (pay + expectedTax)) < 0.01, `transfer=${r.data.preview.transfer_amount}`);
      },
    },
    {
      name: '7. Рабочий видит выплату в баннере (my/pending)',
      run: async () => {
        const c = await pg();
        const { rows } = await c.query(
          `SELECT e.id FROM employees e JOIN users u ON u.id = e.user_id
            WHERE e.id = $1 AND u.pin_hash IS NOT NULL`, [empNormal.employee_id]);
        if (!rows.length) return; // у сотрудника нет PIN — шаг неприменим, не FAIL
        const tok = await fieldTokenFor(empNormal.employee_id);
        const r = await rawFetch('GET', '/api/payouts/my/pending', { token: tok });
        assert(r.status === 200, `my/pending status ${r.status}`);
        const list = (r.data && r.data.payments) || [];
        assert(list.some((p) => p.id === payNormalId), 'выплата не видна рабочему в баннере');
        const mine = list.find((p) => p.id === payNormalId);
        assert(mine.amount === 5000 || Math.abs(mine.amount - 5000) < 0.01, `баннер показывает сумму ${mine.amount}`);
      },
    },
    {
      name: '8. Рабочий подтверждает по коду → confirmed',
      run: async () => {
        if (!payNormalId) return;
        const c = await pg();
        const { rows } = await c.query(
          `SELECT e.id FROM employees e JOIN users u ON u.id = e.user_id
            WHERE e.id = $1 AND u.pin_hash IS NOT NULL`, [empNormal.employee_id]);
        if (!rows.length) return;
        const tok = await fieldTokenFor(empNormal.employee_id);
        await c.query(`INSERT INTO payout_confirmation_codes (payment_id, employee_id, code_hash, expires_at) VALUES ($1,$2,$3, NOW()+INTERVAL '1 hour')`,
          [payNormalId, empNormal.employee_id, await bcrypt.hash('97531', 10)]);
        const ok = await rawFetch('POST', `/api/payouts/my/${payNormalId}/confirm`, { token: tok, body: { code: '97531' }, headers: { 'Content-Type': 'application/json' } });
        assert(ok.status === 200, `confirm status ${ok.status}`);
        const { rows: st } = await c.query('SELECT confirmation_status, confirmed_by_worker FROM worker_payments WHERE id=$1', [payNormalId]);
        assert(st[0].confirmation_status === 'confirmed', 'статус должен стать confirmed');
        assert(st[0].confirmed_by_worker === true, 'confirmed_by_worker=true');
      },
    },
    {
      name: '9. Архив месяца показывает обе выплаты; бейдж confirmed',
      run: async () => {
        const a = await api('GET', `/api/payouts/archive/${PERIOD.year}/${PERIOD.month}`, { role: 'ADMIN' });
        assertOk(a, 'archive');
        const ids = (a.data.rows || []).map((r) => r.employee_id);
        assert(ids.includes(empNormal.employee_id), 'обычный не в архиве месяца');
        assert(ids.includes(empSe.employee_id), 'СЗ не в архиве месяца');
        const list = await api('GET', `/api/payouts/list/${PERIOD.year}/${PERIOD.month}`, { role: 'ADMIN' });
        const rowN = (list.data.rows || []).find((r) => r.employee_id === empNormal.employee_id);
        assert(rowN && rowN.paid_this_period === true, 'строка не помечена выплаченной');
        assert(rowN.confirm === 'confirmed', `ожидался confirmed, получено ${rowN.confirm}`);
      },
    },
    {
      name: '10. Экспорт: Excel месяца и расчётный лист — валидные xlsx',
      run: async () => {
        const token = await getToken('ADMIN');
        const ex = await fetch(`${BASE_URL}/api/payouts/export/${PERIOD.year}/${PERIOD.month}`, { headers: { Authorization: `Bearer ${token}` } });
        assert(ex.status === 200, `export ${ex.status}`);
        const b1 = new Uint8Array(await ex.arrayBuffer());
        assert(b1[0] === 0x50 && b1[1] === 0x4B, 'export не xlsx');

        const st = await fetch(`${BASE_URL}/api/payouts/statement/${empNormal.employee_id}/${PERIOD.year}/${PERIOD.month}`, { headers: { Authorization: `Bearer ${token}` } });
        assert(st.status === 200, `statement ${st.status}`);
        const b2 = new Uint8Array(await st.arrayBuffer());
        assert(b2[0] === 0x50 && b2[1] === 0x4B, 'statement не xlsx');
      },
    },
    {
      name: '11. Дима подтверждает за рабочего (для тех, кто не может зайти)',
      run: async () => {
        if (!paySeId) return;
        // СЗ-выплата ещё awaiting → Дима подтверждает за него
        const r = await api('POST', `/api/payouts/${paySeId}/confirm-by-manager`, { role: 'ADMIN', body: {} });
        assertOk(r, 'confirm-by-manager');
        const c = await pg();
        const { rows } = await c.query('SELECT confirmation_status FROM worker_payments WHERE id=$1', [paySeId]);
        assert(rows[0].confirmation_status === 'confirmed', 'статус должен стать confirmed');
      },
    },
    {
      name: '12. Уборка: клон возвращается к baseline',
      run: async () => {
        const c = await pg();
        await c.query(`DELETE FROM payout_confirmation_codes WHERE payment_id IN (SELECT id FROM worker_payments WHERE payout_batch_id IS NOT NULL)`);
        await c.query(`DELETE FROM audit_log WHERE action LIKE 'payout%' AND created_at::date = CURRENT_DATE`);
        await c.query(`DELETE FROM notifications WHERE type='payment_received' AND created_at::date = CURRENT_DATE`);
        await c.query(`DELETE FROM worker_payments WHERE payout_batch_id IS NOT NULL`);
        await c.query(`DELETE FROM field_sessions WHERE device_info IN ('e2e_flow','verify_auto','verify')`);

        const total = (await c.query('SELECT count(*)::int AS c FROM worker_payments')).rows[0].c;
        const batch = (await c.query('SELECT count(*)::int AS c FROM worker_payments WHERE payout_batch_id IS NOT NULL')).rows[0].c;
        assert(batch === 0, `после уборки остались выплаты с batch: ${batch}`);
        assert(total === 3026, `baseline нарушен: ${total} вместо 3026`);
      },
    },
  ],
};
