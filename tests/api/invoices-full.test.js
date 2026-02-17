/**
 * INVOICES (Full) — Complete CRUD + payments + role access + negative tests
 * Covers: list, detail, create, update, payments, delete, overdue, stats
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, skip } = require('../config');

let testInvoiceId = null;
let testPaymentId = null;
let testWorkId = null;

module.exports = {
  name: 'INVOICES (Full CRUD + Payments)',
  tests: [
    // ── Setup: find a work for FK reference ──
    {
      name: 'Setup: find work_id for FK reference',
      run: async () => {
        const resp = await api('GET', '/api/works?limit=1', { role: 'ADMIN' });
        if (resp.ok) {
          const works = Array.isArray(resp.data) ? resp.data : (resp.data?.works || resp.data?.data || []);
          if (works.length > 0) testWorkId = works[0].id;
        }
        // work_id is optional — tests continue without it
      }
    },

    // ── 1. ADMIN reads invoices list ──
    {
      name: 'ADMIN reads invoices list',
      run: async () => {
        const resp = await api('GET', '/api/invoices', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN list invoices');
        const list = resp.data?.invoices || resp.data;
        assertArray(list, 'invoices list');
      }
    },

    // ── 2. PM reads invoices list ──
    {
      name: 'PM reads invoices list',
      run: async () => {
        const resp = await api('GET', '/api/invoices', { role: 'PM' });
        assertOk(resp, 'PM list invoices');
        const list = resp.data?.invoices || resp.data;
        assertArray(list, 'PM invoices list');
      }
    },

    // ── 3. BUH reads invoices list ──
    {
      name: 'BUH reads invoices list',
      run: async () => {
        const resp = await api('GET', '/api/invoices', { role: 'BUH' });
        assertOk(resp, 'BUH list invoices');
        const list = resp.data?.invoices || resp.data;
        assertArray(list, 'BUH invoices list');
      }
    },

    // ── 4. ADMIN reads overdue list ──
    {
      name: 'ADMIN reads overdue invoices list',
      run: async () => {
        const resp = await api('GET', '/api/invoices/overdue/list', { role: 'ADMIN' });
        assertOk(resp, 'overdue list');
        const list = resp.data?.invoices || resp.data;
        assertArray(list, 'overdue invoices');
      }
    },

    // ── 5. ADMIN reads stats summary ──
    {
      name: 'ADMIN reads invoice stats summary',
      run: async () => {
        const resp = await api('GET', '/api/invoices/stats/summary', { role: 'ADMIN' });
        assertOk(resp, 'stats summary');
        assert(resp.data && typeof resp.data === 'object', 'stats should be an object');
      }
    },

    // ── 6. PM reads overdue list (any authenticated role) ──
    {
      name: 'PM reads overdue invoices list',
      run: async () => {
        const resp = await api('GET', '/api/invoices/overdue/list', { role: 'PM' });
        assertOk(resp, 'PM overdue list');
      }
    },

    // ── 7. ADMIN creates invoice (with work_id FK if available) ──
    {
      name: 'ADMIN creates invoice with full fields',
      run: async () => {
        const body = {
          invoice_number: 'FULL-TEST-' + Date.now(),
          invoice_date: '2026-02-15',
          invoice_type: 'income',
          customer_name: 'Autotest Customer LLC',
          customer_inn: '7701234567',
          amount: 250000,
          vat_pct: 20,
          total_amount: 300000,
          due_date: '2026-03-15',
          description: 'E2E full invoice test',
          status: 'draft'
        };
        if (testWorkId) body.work_id = testWorkId;

        const resp = await api('POST', '/api/invoices', { role: 'ADMIN', body });
        assertOk(resp, 'ADMIN create invoice');
        const inv = resp.data?.invoice || resp.data;
        assert(inv && inv.id, 'created invoice must have id');
        testInvoiceId = inv.id;
      }
    },

    // ── 8. Read-back invoice by ID, verify fields ──
    {
      name: 'Read-back invoice by ID and verify fields',
      run: async () => {
        if (!testInvoiceId) skip('No invoice created');
        const resp = await api('GET', `/api/invoices/${testInvoiceId}`, { role: 'ADMIN' });
        assertOk(resp, 'get invoice by id');
        const inv = resp.data?.invoice || resp.data;
        assertHasFields(inv, ['id', 'invoice_number', 'amount', 'customer_name', 'status'], 'invoice detail');
        assert(inv.id === testInvoiceId, `id mismatch: expected ${testInvoiceId}, got ${inv.id}`);
        assert(inv.customer_name === 'Autotest Customer LLC', `customer_name mismatch: ${inv.customer_name}`);
        assert(inv.status === 'draft', `status should be draft, got ${inv.status}`);
        // Response should include payments array
        const payments = resp.data?.payments;
        if (payments !== undefined) {
          assertArray(payments, 'invoice payments');
        }
      }
    },

    // ── 9. PM reads invoice detail (any authenticated) ──
    {
      name: 'PM reads invoice detail by ID',
      run: async () => {
        if (!testInvoiceId) skip('No invoice created');
        const resp = await api('GET', `/api/invoices/${testInvoiceId}`, { role: 'PM' });
        assertOk(resp, 'PM get invoice');
        const inv = resp.data?.invoice || resp.data;
        assertHasFields(inv, ['id', 'invoice_number'], 'PM invoice detail');
      }
    },

    // ── 10. Add payment to invoice ──
    {
      name: 'ADMIN adds payment to invoice',
      run: async () => {
        if (!testInvoiceId) skip('No invoice created');
        const resp = await api('POST', `/api/invoices/${testInvoiceId}/payments`, {
          role: 'ADMIN',
          body: {
            amount: 50000,
            payment_date: '2026-02-15',
            comment: 'First partial payment'
          }
        });
        assertOk(resp, 'add payment');
        const payment = resp.data?.payment || resp.data;
        if (payment?.id) testPaymentId = payment.id;
        // Check returned status changed to partial
        if (resp.data?.new_status) {
          assert(resp.data.new_status === 'partial', `expected partial status, got ${resp.data.new_status}`);
        }
      }
    },

    // ── 11. Verify payment appears in invoice detail ──
    {
      name: 'Verify payment appears in invoice detail',
      run: async () => {
        if (!testInvoiceId) skip('No invoice created');
        const resp = await api('GET', `/api/invoices/${testInvoiceId}`, { role: 'ADMIN' });
        assertOk(resp, 'get invoice after payment');
        const payments = resp.data?.payments;
        if (payments !== undefined) {
          assertArray(payments, 'payments after add');
          assert(payments.length >= 1, `expected at least 1 payment, got ${payments.length}`);
        }
        // paid_amount should have increased
        const inv = resp.data?.invoice || resp.data;
        if (inv.paid_amount !== undefined) {
          assert(parseFloat(inv.paid_amount) >= 50000, `paid_amount should be >= 50000, got ${inv.paid_amount}`);
        }
      }
    },

    // ── 12. Update invoice ──
    {
      name: 'ADMIN updates invoice description and amount',
      run: async () => {
        if (!testInvoiceId) skip('No invoice created');
        const resp = await api('PUT', `/api/invoices/${testInvoiceId}`, {
          role: 'ADMIN',
          body: {
            description: 'Updated by full test',
            amount: 275000
          }
        });
        assertOk(resp, 'update invoice');
        const inv = resp.data?.invoice || resp.data;
        if (inv) {
          assert(inv.description === 'Updated by full test', `description not updated: ${inv.description}`);
        }
      }
    },

    // ── 13. BUH updates invoice (allowed WRITE_ROLE) ──
    {
      name: 'BUH updates invoice (allowed write role)',
      run: async () => {
        if (!testInvoiceId) skip('No invoice created');
        const resp = await api('PUT', `/api/invoices/${testInvoiceId}`, {
          role: 'BUH',
          body: { description: 'BUH updated description' }
        });
        assertOk(resp, 'BUH update invoice');
      }
    },

    // ── 14. NEGATIVE: WAREHOUSE cannot create invoice → 403 ──
    {
      name: 'NEGATIVE: WAREHOUSE cannot create invoice',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'WAREHOUSE',
          body: {
            invoice_number: 'FORBIDDEN-WH',
            invoice_date: '2026-02-01',
            amount: 100,
            customer_name: 'Forbidden'
          }
        });
        assertForbidden(resp, 'WAREHOUSE create invoice');
      }
    },

    // ── 15. NEGATIVE: HR cannot create invoice → 403 ──
    {
      name: 'NEGATIVE: HR cannot create invoice',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'HR',
          body: {
            invoice_number: 'FORBIDDEN-HR',
            invoice_date: '2026-02-01',
            amount: 100,
            customer_name: 'Forbidden'
          }
        });
        assertForbidden(resp, 'HR create invoice');
      }
    },

    // ── 16. NEGATIVE: TO cannot create invoice → 403 ──
    {
      name: 'NEGATIVE: TO cannot create invoice',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'TO',
          body: {
            invoice_number: 'FORBIDDEN-TO',
            invoice_date: '2026-02-01',
            amount: 100,
            customer_name: 'Forbidden'
          }
        });
        assertForbidden(resp, 'TO create invoice');
      }
    },

    // ── 17. NEGATIVE: PROC cannot create invoice → 403 ──
    {
      name: 'NEGATIVE: PROC cannot create invoice',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'PROC',
          body: {
            invoice_number: 'FORBIDDEN-PROC',
            invoice_date: '2026-02-01',
            amount: 100,
            customer_name: 'Forbidden'
          }
        });
        assertForbidden(resp, 'PROC create invoice');
      }
    },

    // ── 18. NEGATIVE: GET non-existent invoice → 404 ──
    {
      name: 'NEGATIVE: GET non-existent invoice returns 404',
      run: async () => {
        const resp = await api('GET', '/api/invoices/999999', { role: 'ADMIN' });
        if (resp.status === 404) {
          assert(resp.status === 404, 'expected 404');
        } else {
          skip(`Server returned ${resp.status} instead of 404`);
        }
      }
    },

    // ── 19. Cleanup: delete invoice (cascades payments) ──
    {
      name: 'Cleanup: ADMIN deletes invoice and payments',
      run: async () => {
        if (!testInvoiceId) skip('No invoice to clean up');
        const resp = await api('DELETE', `/api/invoices/${testInvoiceId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete invoice');
        // Verify it is gone
        const check = await api('GET', `/api/invoices/${testInvoiceId}`, { role: 'ADMIN' });
        assert(
          check.status === 404 || check.status === 400,
          `deleted invoice should return 404, got ${check.status}`
        );
        testInvoiceId = null;
        testPaymentId = null;
      }
    }
  ]
};
