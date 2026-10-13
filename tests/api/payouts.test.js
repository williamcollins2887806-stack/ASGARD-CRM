const {
  api, assert, assertOk, assertForbidden, assertStatus,
  assertArray, assertHasFields, rawFetch, getToken, BASE_URL,
} = require('../config');

/**
 * PAYOUTS (Страница выплат #/payouts) — API-тесты контура выплат.
 * Покрытие: доступ, предупреждения, список, архивы, сводка, выплата,
 * налог СЗ, защита от переплаты/дублей, подтверждение/спор, экспорт.
 */

let createdPaymentIds = [];

async function adminEmployees() {
  const r = await api('GET', '/api/staff/employees', { role: 'ADMIN' });
  const list = r.data?.employees || r.data || [];
  return Array.isArray(list) ? list : [];
}

async function firstWorkingEmployee() {
  // Берём любого сотрудника — список выплат отдаёт активных с начислениями.
  const list = await adminEmployees();
  return list.length ? list[0].id : 1;
}

/** Найти в списке строку с ненулевым to_pay (кандидат на выплату). */
async function findPayable(year, month) {
  const r = await api('GET', `/api/payouts/list/${year}/${month}`, { role: 'ADMIN' });
  assertOk(r, 'list for payable');
  const rows = r.data?.rows || [];
  return rows.find((x) => x.to_pay > 0) || rows[0] || null;
}

module.exports = {
  name: 'PAYOUTS (Страница выплат)',
  tests: [
    // ── Доступ ──────────────────────────────────────────────────────────────
    {
      name: 'ADMIN: /api/payouts/me → allowed=true',
      run: async () => {
        const r = await api('GET', '/api/payouts/me', { role: 'ADMIN' });
        assertOk(r, 'me admin');
        assert(r.data.allowed === true, 'ADMIN должен иметь доступ к выплатам');
      },
    },
    {
      name: 'BUH: /api/payouts/me → allowed=true',
      run: async () => {
        const r = await api('GET', '/api/payouts/me', { role: 'BUH' });
        assertOk(r, 'me buh');
        assert(r.data.allowed === true, 'BUH должен иметь доступ к выплатам');
      },
    },
    {
      name: 'PM без гранта: /api/payouts/list → 403',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'PM' });
        assertForbidden(r, 'PM без гранта');
      },
    },
    {
      name: 'HR без гранта: /api/payouts/list → 403',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'HR' });
        assertForbidden(r, 'HR без гранта');
      },
    },
    {
      name: 'Без токена: /api/payouts/list → 401',
      run: async () => {
        const r = await rawFetch('GET', '/api/payouts/list/2026/9');
        assertStatus(r, 401, 'no-token');
      },
    },
    // ── Предупреждения периода (мягкие, без блокировки) ─────────────────────
    {
      name: 'warnings: возвращает warnings[] и ready_to_pay',
      run: async () => {
        const r = await api('GET', '/api/payouts/warnings/2026/9', { role: 'ADMIN' });
        assertOk(r, 'warnings');
        assertHasFields(r.data, ['year', 'month', 'ready_to_pay', 'warnings'], 'warnings shape');
        assertArray(r.data.warnings, 'warnings array');
      },
    },
    {
      name: 'warnings: некорректный период → 400',
      run: async () => {
        for (const p of ['2026/13', '2026/0', '2019/1', 'abc/1', '2026/9abc']) {
          const r = await api('GET', `/api/payouts/warnings/${p}`, { role: 'ADMIN' });
          assertStatus(r, 400, `warnings ${p}`);
        }
      },
    },

    // ── Список ──────────────────────────────────────────────────────────────
    {
      name: 'list: строки с полной схемой колонок',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        assertOk(r, 'list');
        assertArray(r.data.rows, 'rows');
        assertHasFields(r.data.totals, ['accrued', 'carry', 'advance', 'penalty', 'official', 'to_pay', 'employees'], 'totals');
        if (r.data.rows.length) {
          assertHasFields(r.data.rows[0],
            ['employee_id', 'fio', 'carry', 'accrued', 'advance', 'penalty', 'official', 'to_pay'],
            'row fields');
        }
      },
    },
    {
      name: 'list: формула к_выплате = остаток+начислено+премия−штраф−аванс−оклад',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        assertOk(r, 'list formula');
        for (const x of (r.data.rows || []).slice(0, 25)) {
          const expected = Math.round((x.carry + x.accrued + x.bonus - x.penalty - x.advance - x.official) * 100) / 100;
          assert(Math.abs(expected - x.to_pay) < 0.01,
            `to_pay ${x.to_pay} != ${expected} для emp ${x.employee_id}`);
        }
      },
    },
    {
      name: 'list: сортировка по алфавиту',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        const fios = (r.data.rows || []).map((x) => x.fio);
        const sorted = fios.slice().sort((a, b) => a.localeCompare(b, 'ru'));
        assert(JSON.stringify(fios) === JSON.stringify(sorted), 'список не отсортирован по алфавиту');
      },
    },
    {
      name: 'list: «пустой» сотрудник (всё ноль) отсутствует',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        for (const x of (r.data.rows || [])) {
          const hasAny = x.accrued || x.carry || x.advance || x.penalty || x.official || x.bonus;
          assert(!!hasAny, `пустая строка emp ${x.employee_id} не должна выводиться`);
        }
      },
    },
    {
      name: 'list: переплата помечена overpaid=true',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        const over = (r.data.rows || []).filter((x) => x.to_pay < 0);
        over.forEach((x) => assert(x.overpaid === true, `emp ${x.employee_id} to_pay<0 но overpaid!=true`));
        assert(typeof r.data.totals.overpaid_count === 'number', 'overpaid_count отсутствует');
      },
    },
    {
      name: 'list: пустой месяц → 200 + пустые rows',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2020/1', { role: 'ADMIN' });
        assertOk(r, 'empty month');
        assertArray(r.data.rows, 'rows');
      },
    },

    // ── Архив ───────────────────────────────────────────────────────────────
    {
      name: 'archive/years: возвращает 2020..2026',
      run: async () => {
        const r = await api('GET', '/api/payouts/archive/years', { role: 'ADMIN' });
        assertOk(r, 'archive years');
        assertArray(r.data.years, 'years');
        assert(r.data.years.includes(2026), 'нет 2026');
      },
    },
    {
      name: 'archive/:y/:m: только paid/confirmed с разбивкой по типам',
      run: async () => {
        const r = await api('GET', '/api/payouts/archive/2026/9', { role: 'ADMIN' });
        assertOk(r, 'archive month');
        assertArray(r.data.rows, 'archive rows');
        if (r.data.rows.length) {
          assertHasFields(r.data.rows[0], ['employee_id', 'fio', 'total', 'by_type'], 'archive row');
        }
      },
    },

    // ── Сводка сотрудника ───────────────────────────────────────────────────
    {
      name: 'employee/:id/summary: инвариант sum(months) == by_year[current]',
      run: async () => {
        const empId = await firstWorkingEmployee();
        const r = await api('GET', `/api/payouts/employee/${empId}/summary`, { role: 'ADMIN' });
        assertOk(r, 'summary');
        const y = new Date().getFullYear();
        const byY = (r.data.by_year || []).find((x) => x.year === y);
        const sumMonths = (r.data.current_year_months || []).reduce((s, m) => s + (m.paid || 0), 0);
        const byYVal = byY ? byY.paid : 0;
        assert(Math.abs(sumMonths - byYVal) < 0.01,
          `sum(months)=${sumMonths} != by_year=${byYVal} для emp ${empId}`);
      },
    },

    // ── Выплата ─────────────────────────────────────────────────────────────
    {
      name: 'pay: обычный сотрудник — transfer=pay, tax=0',
      run: async () => {
        const row = await findPayable(2026, 12);
        if (!row || !row.employee_id) return;
        const r = await api('POST', '/api/payouts/pay', {
          role: 'ADMIN',
          body: {
            employee_id: row.employee_id, year: 2026, month: 12, kind: 'advance',
            pay_amount: 100, payout_platform: 'cash', confirm_over: true,
          },
        });
        if (r.status === 409) return; // уже платили в этом месяце — допустимо
        assertOk(r, 'pay normal');
        if (r.data.payment) createdPaymentIds.push(r.data.payment.id);
        const pv = r.data.preview;
        if (!pv.is_self_employed) {
          assert(Math.abs(pv.transfer_amount - pv.pay_amount) < 0.01, `transfer ${pv.transfer_amount} != pay ${pv.pay_amount}`);
          assert(pv.tax_amount === 0, `tax должен быть 0, получено ${pv.tax_amount}`);
        }
      },
    },
    {
      name: 'pay: СЗ — tax = pay×0.06, transfer = pay+tax',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        const se = (r.data.rows || []).find((x) => x.is_self_employed && x.to_pay > 0);
        if (!se) return;
        const pay = 1000;
        const resp = await api('POST', '/api/payouts/pay', {
          role: 'ADMIN',
          body: { employee_id: se.employee_id, year: 2026, month: 12, kind: 'advance', pay_amount: pay, payout_platform: 'restaff', confirm_over: true },
        });
        if (resp.status === 409) return;
        assertOk(resp, 'pay se');
        if (resp.data.payment) createdPaymentIds.push(resp.data.payment.id);
        const pv = resp.data.preview;
        assert(Math.abs(pv.tax_amount - pay * 0.06) < 0.02, `tax ${pv.tax_amount} != ${pay * 0.06}`);
        assert(Math.abs(pv.transfer_amount - (pay + pv.tax_amount)) < 0.01, `transfer ${pv.transfer_amount}`);
      },
    },
    {
      name: 'pay: переплата без confirm_over → 409 over_earnings',
      run: async () => {
        const row = await findPayable(2026, 12);
        if (!row) return;
        const r = await api('POST', '/api/payouts/pay', {
          role: 'ADMIN',
          body: { employee_id: row.employee_id, year: 2026, month: 12, kind: 'salary', pay_amount: 99999999, payout_platform: 'cash' },
        });
        assertStatus(r, 409, 'over_earnings guard');
        assert(r.data.error === 'over_earnings', `ожидался over_earnings, получено ${r.data.error}`);
      },
    },
    {
      name: 'pay: невалидные входные данные → 400',
      run: async () => {
        const bad = [
          { kind: 'foo', pay_amount: 100 },
          { kind: 'advance', pay_amount: 0 },
          { kind: 'advance', pay_amount: -5 },
          { kind: 'advance', pay_amount: '10abc' },
          { kind: 'advance', pay_amount: '1,000' },
          { kind: 'advance', pay_amount: 100, payout_platform: 'crypto' },
        ];
        for (const b of bad) {
          const r = await api('POST', '/api/payouts/pay', { role: 'ADMIN', body: { employee_id: 18, year: 2026, month: 12, ...b } });
          assertStatus(r, 400, `bad body ${JSON.stringify(b)}`);
        }
      },
    },
    {
      name: 'pay: PM без гранта → 403',
      run: async () => {
        const r = await api('POST', '/api/payouts/pay', { role: 'PM', body: { employee_id: 18, year: 2026, month: 12, kind: 'advance', pay_amount: 100 } });
        assertForbidden(r, 'PM pay');
      },
    },

    // ── Подтверждение/спор (CRM-сторона) ────────────────────────────────────
    {
      name: 'confirm-by-manager: несуществующая выплата → 404',
      run: async () => {
        const r = await api('POST', '/api/payouts/999999999/confirm-by-manager', { role: 'ADMIN', body: {} });
        assertStatus(r, 404, 'confirm-by-manager 404');
      },
    },
    {
      name: 'preview: возвращает строку и ставку налога',
      run: async () => {
        const empId = await firstWorkingEmployee();
        const r = await api('GET', `/api/payouts/preview/${empId}?year=2026&month=9`, { role: 'ADMIN' });
        assertOk(r, 'preview');
        assertHasFields(r.data, ['employee', 'tax_rate', 'is_self_employed'], 'preview shape');
      },
    },

    // ── Экспорт ─────────────────────────────────────────────────────────────
    {
      name: 'export: xlsx (PK-магия) для месяца',
      run: async () => {
        const token = await getToken('ADMIN');
        const res = await fetch(`${BASE_URL}/api/payouts/export/2026/9`, { headers: { Authorization: `Bearer ${token}` } });
        assert(res.status === 200, `export status ${res.status}`);
        const ab = await res.arrayBuffer();
        const b = new Uint8Array(ab);
        assert(b[0] === 0x50 && b[1] === 0x4B, 'не валидный xlsx (нет PK)');
      },
    },
    {
      name: 'statement: xlsx для сотрудника',
      run: async () => {
        const empId = await firstWorkingEmployee();
        const token = await getToken('ADMIN');
        const res = await fetch(`${BASE_URL}/api/payouts/statement/${empId}/2026/9`, { headers: { Authorization: `Bearer ${token}` } });
        assert(res.status === 200, `statement status ${res.status}`);
        const ab = await res.arrayBuffer();
        const b = new Uint8Array(ab);
        assert(b[0] === 0x50 && b[1] === 0x4B, 'не валидный xlsx (нет PK)');
      },
    },
    {
      name: 'export: некорректный период → 400',
      run: async () => {
        const r = await api('GET', '/api/payouts/export/2026/13', { role: 'ADMIN' });
        assertStatus(r, 400, 'export bad period');
      },
    },

    // ── Уборка ──────────────────────────────────────────────────────────────
    {
      name: 'Cleanup: отменить тестовые выплаты',
      run: async () => {
        // Штатный API переводит в status='cancelled' (soft). Для чистоты клона
        // аннулируем созданные тестом строки окончательно через тот же API.
        for (const id of createdPaymentIds) {
          await api('DELETE', `/api/worker-payments/${id}`, { role: 'ADMIN' });
        }
        createdPaymentIds = [];
      },
    },
  ],
};
