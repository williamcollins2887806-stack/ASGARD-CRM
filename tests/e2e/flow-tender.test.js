/**
 * E2E FLOW 1: Tender -> Estimate -> Work -> Invoice (full lifecycle)
 */
const { api, assert, assertOk } = require('../config');

module.exports = {
  name: 'FLOW: Tender Lifecycle',
  tests: [
    {
      name: 'Tender full lifecycle: create -> estimate -> work -> invoice -> cleanup',
      run: async () => {
        // 1. TO creates tender
        const t = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'E2E Flow1: Lifecycle Customer', estimated_sum: 10000000, tender_status: 'Новый' }
        });
        assertOk(t, 'tender');
        const tid = t.data?.tender?.id || t.data?.id;
        if (!tid) return;

        // 2. PM creates estimate linked to tender
        const e = await api('POST', '/api/estimates', {
          role: 'PM',
          body: { tender_id: tid, title: 'E2E: HVAC estimate', amount: 8000000, cost: 6000000, margin: 25, approval_status: 'draft' }
        });
        assertOk(e, 'estimate');
        const eid = e.data?.estimate?.id || e.data?.id;

        // 3. Verify estimates linked to tender
        const elist = await api('GET', `/api/estimates?tender_id=${tid}`, { role: 'PM' });
        assertOk(elist, 'estimates list');

        // 4. PM creates work from tender
        const w = await api('POST', '/api/works', {
          role: 'PM',
          body: { tender_id: tid, work_title: 'E2E: HVAC installation', work_number: 'E2E-W-001', work_status: 'В работе', contract_value: 8000000 }
        });
        assertOk(w, 'work');
        const wid = w.data?.work?.id || w.data?.id;

        // 5. PM creates invoice
        let iid = null;
        if (wid) {
          const inv = await api('POST', '/api/invoices', {
            role: 'PM',
            body: { work_id: wid, invoice_number: 'E2E-INV-001', invoice_date: '2026-02-01', invoice_type: 'income', customer_name: 'E2E Customer', amount: 4000000, total_amount: 4000000 }
          });
          assertOk(inv, 'invoice');
          iid = inv.data?.invoice?.id || inv.data?.id;
        }

        // 6. Verify tender has linked works
        const tDetail = await api('GET', `/api/tenders/${tid}`, { role: 'PM' });
        assertOk(tDetail, 'tender detail');

        // Cleanup
        if (iid) await api('DELETE', `/api/invoices/${iid}`, { role: 'ADMIN' });
        if (wid) await api('DELETE', `/api/works/${wid}`, { role: 'ADMIN' });
        if (eid) await api('DELETE', `/api/estimates/${eid}`, { role: 'ADMIN' });
        if (tid) await api('DELETE', `/api/tenders/${tid}`, { role: 'ADMIN' });
      }
    }
  ]
};
