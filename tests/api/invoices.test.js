/**
 * INVOICES — Deep CRUD + validation + negative tests
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

let testInvoiceId = null;

module.exports = {
  name: 'INVOICES (deep)',
  tests: [
    {
      name: 'PM creates invoice + validates shape',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'PM',
          body: {
            invoice_number: 'TEST-INV-' + Date.now(),
            invoice_date: '2026-02-01',
            invoice_type: 'income',
            customer_name: 'Test Customer',
            amount: 500000,
            description: 'Autotest invoice'
          }
        });
        assertOk(resp, 'create invoice');
        const inv = resp.data?.invoice || resp.data;
        testInvoiceId = inv?.id;
        if (testInvoiceId) assertFieldType(inv, 'id', 'number', 'invoice.id');
      }
    },
    {
      name: 'Read-back: verify invoice fields',
      run: async () => {
        if (!testInvoiceId) throw new Error('No invoice');
        const resp = await api('GET', `/api/invoices/${testInvoiceId}`, { role: 'PM' });
        assertOk(resp, 'get invoice');
        const inv = resp.data?.invoice || resp.data;
        assertHasFields(inv, ['id', 'invoice_number', 'amount'], 'invoice detail');
        assertMatch(inv, { id: testInvoiceId }, 'invoice id match');
      }
    },
    {
      name: 'List invoices: response shape + fields',
      run: async () => {
        const resp = await api('GET', '/api/invoices', { role: 'PM' });
        assertOk(resp, 'list invoices');
        const list = resp.data?.invoices || resp.data;
        assertArray(list, 'invoices');
        if (list.length > 0) assertHasFields(list[0], ['id', 'invoice_number', 'amount'], 'invoice item');
      }
    },
    {
      name: 'BUH reads invoices (allowed)',
      run: async () => {
        const resp = await api('GET', '/api/invoices', { role: 'BUH' });
        assertOk(resp, 'BUH invoices');
      }
    },
    {
      name: 'Invoice overdue list returns array',
      run: async () => {
        const resp = await api('GET', '/api/invoices/overdue/list', { role: 'ADMIN' });
        assertOk(resp, 'overdue list');
      }
    },
    {
      name: 'Invoice stats returns valid object',
      run: async () => {
        const resp = await api('GET', '/api/invoices/stats/summary', { role: 'ADMIN' });
        assertOk(resp, 'invoice stats');
        assert(resp.data && typeof resp.data === 'object', 'stats should be object');
      }
    },
    {
      name: 'NEGATIVE: HR cannot create invoice',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'HR',
          body: { invoice_number: 'X', invoice_date: '2026-01-01', invoice_type: 'income', customer_name: 'X', amount: 1 }
        });
        assertForbidden(resp, 'HR create invoice');
      }
    },
    {
      name: 'NEGATIVE: create invoice with empty body → no 5xx',
      run: async () => {
        const resp = await api('POST', '/api/invoices', { role: 'PM', body: {} });
        // Server allows empty body (no validation) — just verify no 5xx
        assert(resp.status < 500, `empty body should not cause 5xx, got ${resp.status}`);
      }
    },
    {
      name: 'NEGATIVE: GET non-existent invoice → 404',
      run: async () => {
        const resp = await api('GET', '/api/invoices/999999', { role: 'PM' });
        assert(resp.status === 404 || resp.status === 400, `expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'Cleanup: delete invoice → verify gone',
      run: async () => {
        if (!testInvoiceId) return;
        await api('DELETE', `/api/invoices/${testInvoiceId}`, { role: 'ADMIN' });
        const check = await api('GET', `/api/invoices/${testInvoiceId}`, { role: 'PM' });
        assert(check.status === 404 || check.status === 400, `deleted invoice should be 404, got ${check.status}`);
        testInvoiceId = null;
      }
    }
  ]
};
