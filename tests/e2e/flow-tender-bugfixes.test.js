/**
 * E2E FLOW: Проверка исправленных багов модуля тендеров
 * Запуск: node tests/runner.js --e2e (сервер должен быть запущен)
 */
const { api, assert, assertOk, assertStatus, skip } = require('../config');

module.exports = {
  name: 'FLOW: Tender Bugfixes Verification',
  tests: [
    {
      name: 'BUG-01: tender_price сохраняется при создании',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'BUG01 Test', tender_price: 7777777, tender_status: 'Новый' }
        });
        assertOk(resp, 'create tender with price');
        const tender = resp.data?.tender;
        assert(tender, 'tender object returned');
        assert(Number(tender.tender_price) === 7777777,
          `tender_price should be 7777777, got ${tender.tender_price}`);

        const tid = tender.id;
        if (tid) await api('DELETE', `/api/tenders/${tid}`, { role: 'ADMIN' });
      }
    },
    {
      name: 'BUG-04: stats/summary считает Клиент согласился как won',
      run: async () => {
        const t = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'BUG04 Won Test', tender_price: 1000000, tender_status: 'Новый' }
        });
        assertOk(t, 'create tender');
        const tid = t.data?.tender?.id;
        if (!tid) skip('No tender ID');

        await api('PUT', `/api/tenders/${tid}`, {
          role: 'ADMIN',
          body: { tender_status: 'Клиент согласился' }
        });

        const stats = await api('GET', '/api/tenders/stats/summary', { role: 'ADMIN' });
        assertOk(stats, 'get stats');
        assert(Number(stats.data?.summary?.won) >= 1,
          `won should be >= 1, got ${stats.data?.summary?.won}`);

        await api('DELETE', `/api/tenders/${tid}`, { role: 'ADMIN' });
      }
    },
    {
      name: 'BUG-02: analytics/team не падает с 500',
      run: async () => {
        const resp = await api('GET', '/api/tenders/analytics/team', { role: 'ADMIN' });
        assert(resp.status !== 500, `analytics/team returned ${resp.status}, should not be 500`);
      }
    },
    {
      name: 'BUG-06: DELETE pre_tender проверяет существование',
      run: async () => {
        const resp = await api('DELETE', '/api/pre-tenders/999999', { role: 'ADMIN' });
        assertStatus(resp, 404, 'DELETE non-existent returns 404');
      }
    },
    {
      name: 'BUG-06: TO не может удалять pre_tender',
      run: async () => {
        const cr = await api('POST', '/api/data/pre_tender_requests', {
          role: 'ADMIN',
          body: {
            customer_name: 'BUG06 Delete Test',
            work_description: 'Test delete access',
            status: 'new',
            ai_color: 'gray',
            source_type: 'manual'
          }
        });
        if (cr.status === 404) skip('data API not available');
        assertOk(cr, 'create pre-tender');
        const ptId = cr.data?.id;
        if (!ptId) skip('No pre-tender ID');

        const del = await api('DELETE', `/api/pre-tenders/${ptId}`, { role: 'TO' });
        assert(del.status === 403, `TO delete should be 403, got ${del.status}`);

        const del2 = await api('DELETE', `/api/pre-tenders/${ptId}`, { role: 'ADMIN' });
        assertOk(del2, 'ADMIN delete ok');
      }
    },
    {
      name: 'BUG-07: renew восстанавливает expired',
      run: async () => {
        const cr = await api('POST', '/api/data/pre_tender_requests', {
          role: 'ADMIN',
          body: {
            customer_name: 'BUG07 Renew Test',
            work_description: 'Test renew',
            status: 'new',
            ai_color: 'gray',
            source_type: 'manual'
          }
        });
        assertOk(cr, 'create pre-tender via data API');
        const ptId = cr.data?.id;
        if (!ptId) skip('No ID');

        await api('PUT', `/api/data/pre_tender_requests/${ptId}`, {
          role: 'ADMIN',
          body: { status: 'expired' }
        });

        const renew = await api('POST', `/api/pre-tenders/${ptId}/renew`, { role: 'ADMIN' });
        assertOk(renew, 'renew');
        const status = renew.data?.item?.status;
        assert(status === 'new', `status after renew should be 'new', got '${status}'`);

        await api('DELETE', `/api/pre-tenders/${ptId}`, { role: 'ADMIN' });
      }
    },
    {
      name: 'BUG-09: stats с search содержащим точку не ломается',
      run: async () => {
        const resp = await api('GET', '/api/tenders/stats/summary?search=test.value', { role: 'ADMIN' });
        assertOk(resp, 'stats with dot in search');
      }
    },
    {
      name: 'BUG-11: stats с period + year не ломается',
      run: async () => {
        const resp = await api('GET', '/api/tenders/stats/summary?period=2026-03&year=2026', { role: 'ADMIN' });
        assertOk(resp, 'stats with period and year');
      }
    },
    {
      name: 'Регрессия: полный lifecycle тендера работает',
      run: async () => {
        const t = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'Regression Test Corp', tender_price: 5000000, tender_status: 'Новый' }
        });
        assertOk(t, 'create');
        const tid = t.data?.tender?.id;
        if (!tid) skip('No tender ID');

        const get = await api('GET', `/api/tenders/${tid}`, { role: 'TO' });
        assertOk(get, 'read');
        assert(Number(get.data?.tender?.tender_price) === 5000000, 'price preserved');

        const upd = await api('PUT', `/api/tenders/${tid}`, {
          role: 'ADMIN',
          body: { tender_status: 'В работе', tender_price: 6000000 }
        });
        assertOk(upd, 'update');
        assert(Number(upd.data?.tender?.tender_price) === 6000000, 'price updated');

        const list = await api('GET', '/api/tenders?limit=5', { role: 'TO' });
        assertOk(list, 'list');

        await api('DELETE', `/api/tenders/${tid}`, { role: 'ADMIN' });
      }
    }
  ]
};
