const { api, assert, assertOk, assertForbidden } = require('../config');

let testInvoiceId = null;

module.exports = {
  name: 'INVOICES (Счета)',
  tests: [
    {
      name: 'PM reads invoices',
      run: async () => {
        const resp = await api('GET', '/api/invoices', { role: 'PM' });
        assertOk(resp, 'list invoices');
      }
    },
    {
      name: 'PM creates invoice',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'PM',
          body: {
            invoice_number: 'TEST-INV-001',
            invoice_date: '2026-02-01',
            invoice_type: 'income',
            customer_name: 'Test Customer',
            amount: 500000
          }
        });
        assertOk(resp, 'create invoice');
        testInvoiceId = resp.data?.id;
      }
    },
    {
      name: 'BUH reads invoices',
      run: async () => {
        const resp = await api('GET', '/api/invoices', { role: 'BUH' });
        assertOk(resp, 'BUH invoices');
      }
    },
    {
      name: 'Invoice overdue list',
      run: async () => {
        const resp = await api('GET', '/api/invoices/overdue/list', { role: 'ADMIN' });
        assertOk(resp, 'overdue list');
      }
    },
    {
      name: 'Invoice stats',
      run: async () => {
        const resp = await api('GET', '/api/invoices/stats/summary', { role: 'ADMIN' });
        assertOk(resp, 'invoice stats');
      }
    },
    {
      name: 'HR cannot create invoice',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'HR',
          body: { invoice_number: 'X', invoice_date: '2026-01-01', invoice_type: 'income', customer_name: 'X', amount: 1 }
        });
        assertForbidden(resp, 'HR create invoice');
      }
    },
    {
      name: 'Cleanup: delete test invoice',
      run: async () => {
        if (!testInvoiceId) return;
        await api('DELETE', `/api/invoices/${testInvoiceId}`, { role: 'ADMIN' });
      }
    }
  ]
};
