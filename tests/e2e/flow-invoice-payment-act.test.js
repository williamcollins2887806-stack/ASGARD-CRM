/**
 * E2E FLOW: Invoice Payment and Act Financial Closing
 */
const { api, assert, assertOk, assertStatus, assertForbidden, skip } = require('../config');

let workId = null;
let invoiceId = null;
let actId = null;
const INVOICE_AMOUNT = 100000;
const VAT_PCT = 20;
const TOTAL_AMOUNT = INVOICE_AMOUNT * (1 + VAT_PCT / 100);

module.exports = {
  name: 'FLOW: Invoice Payment and Act Financial Closing',
  tests: [
    {
      name: 'PM creates a work for financial flow',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'E2E: Financial Flow Test Work', customer_name: 'E2E Test Customer', contract_value: TOTAL_AMOUNT, start_plan: '2026-01-15' }
        });
        if (resp.status === 404) skip('Works endpoint not available');
        assertOk(resp, 'PM creates work');
        workId = resp.data?.work?.id;
        assert(workId, 'Work ID must be returned');
      }
    },
    {
      name: 'TO cannot create invoice (forbidden)',
      run: async () => {
        const resp = await api('POST', '/api/invoices', { role: 'TO', body: { invoice_number: 'E2E-INV-DENY', invoice_date: '2026-02-01', amount: 1000, total_amount: 1200 } });
        if (resp.status === 404) skip('Invoices endpoint not available');
        assertForbidden(resp, 'TO should not create invoices');
      }
    },
    {
      name: 'PM creates invoice linked to work',
      run: async () => {
        if (!workId) skip('No work created');
        const resp = await api('POST', '/api/invoices', {
          role: 'PM',
          body: { invoice_number: 'E2E-INV-' + Date.now(), invoice_date: '2026-02-01', invoice_type: 'incoming', work_id: workId, customer_name: 'E2E Test Customer', description: 'E2E invoice for financial flow test', amount: INVOICE_AMOUNT, vat_pct: VAT_PCT, total_amount: TOTAL_AMOUNT, due_date: '2026-03-01', status: 'draft' }
        });
        if (resp.status === 404) skip('Invoices endpoint not available');
        assertOk(resp, 'PM creates invoice');
        invoiceId = resp.data?.invoice?.id;
        assert(invoiceId, 'Invoice ID must be returned');
      }
    },
    {
      name: 'PM views invoice details',
      run: async () => {
        if (!invoiceId) skip('No invoice created');
        const resp = await api('GET', '/api/invoices/' + invoiceId, { role: 'PM' });
        assertOk(resp, 'PM views invoice');
        assert(resp.data?.invoice?.id === invoiceId, 'Invoice ID must match');
        assert(parseFloat(resp.data.invoice.total_amount) === TOTAL_AMOUNT, 'Total amount must match');
      }
    },
    {
      name: 'BUH records partial payment (60000 of 120000)',
      run: async () => {
        if (!invoiceId) skip('No invoice created');
        const resp = await api('POST', '/api/invoices/' + invoiceId + '/payments', { role: 'BUH', body: { amount: 60000, payment_date: '2026-02-10', comment: 'E2E: Partial payment 1' } });
        assertOk(resp, 'BUH records partial payment');
        assert(resp.data?.new_status === 'partial', 'Status must be partial');
        assert(parseFloat(resp.data?.new_paid_amount) === 60000, 'Paid amount must be 60000');
      }
    },
    {
      name: 'Verify invoice status is partial',
      run: async () => {
        if (!invoiceId) skip('No invoice created');
        const resp = await api('GET', '/api/invoices/' + invoiceId, { role: 'BUH' });
        assertOk(resp, 'BUH checks invoice status');
        assert(resp.data?.invoice?.status === 'partial', 'Invoice status must be partial');
      }
    },
    {
      name: 'BUH records final payment (remaining 60000)',
      run: async () => {
        if (!invoiceId) skip('No invoice created');
        const resp = await api('POST', '/api/invoices/' + invoiceId + '/payments', { role: 'BUH', body: { amount: 60000, payment_date: '2026-02-20', comment: 'E2E: Final payment' } });
        assertOk(resp, 'BUH records final payment');
        assert(resp.data?.new_status === 'paid', 'Status must be paid');
        assert(parseFloat(resp.data?.new_paid_amount) === TOTAL_AMOUNT, 'Paid amount must equal total');
      }
    },
    {
      name: 'Verify invoice is fully paid with 2 payments',
      run: async () => {
        if (!invoiceId) skip('No invoice created');
        const resp = await api('GET', '/api/invoices/' + invoiceId, { role: 'PM' });
        assertOk(resp, 'PM verifies fully paid invoice');
        const inv = resp.data?.invoice;
        assert(inv.status === 'paid', 'Invoice must be paid');
        assert(parseFloat(inv.paid_amount) === TOTAL_AMOUNT, 'paid_amount must match total_amount');
        const payments = resp.data?.payments || [];
        assert(payments.length === 2, 'Must have exactly 2 payments');
      }
    },
    {
      name: 'PM creates act linked to work',
      run: async () => {
        if (!workId) skip('No work created');
        const resp = await api('POST', '/api/acts', {
          role: 'PM',
          body: { act_number: 'E2E-ACT-' + Date.now(), act_date: '2026-02-25', work_id: workId, customer_name: 'E2E Test Customer', description: 'E2E act', amount: INVOICE_AMOUNT, vat_pct: VAT_PCT, total_amount: TOTAL_AMOUNT, status: 'draft' }
        });
        if (resp.status === 404) skip('Acts endpoint not available');
        assertOk(resp, 'PM creates act');
        actId = resp.data?.act?.id;
        assert(actId, 'Act ID must be returned');
      }
    },
    {
      name: 'Verify act and invoice totals match',
      run: async () => {
        if (!actId || !invoiceId) skip('No act or invoice created');
        const actResp = await api('GET', '/api/acts/' + actId, { role: 'PM' });
        const invResp = await api('GET', '/api/invoices/' + invoiceId, { role: 'PM' });
        assertOk(actResp, 'Read act'); assertOk(invResp, 'Read invoice');
        assert(parseFloat(actResp.data?.act?.total_amount) === parseFloat(invResp.data?.invoice?.total_amount), 'Act total must match invoice total');
      }
    },
    {
      name: 'BUH can list all invoices',
      run: async () => {
        const resp = await api('GET', '/api/invoices?limit=5', { role: 'BUH' });
        assertOk(resp, 'BUH lists invoices');
        assert(Array.isArray(resp.data?.invoices), 'Must return array');
      }
    },
    { name: 'Cleanup: delete act', run: async () => { if (!actId) return; await api('DELETE', '/api/acts/' + actId, { role: 'PM' }); } },
    { name: 'Cleanup: delete invoice', run: async () => { if (!invoiceId) return; await api('DELETE', '/api/invoices/' + invoiceId, { role: 'PM' }); } },
    { name: 'Cleanup: delete work', run: async () => { if (!workId) return; await api('DELETE', '/api/works/' + workId, { role: 'ADMIN' }); } }
  ]
};
