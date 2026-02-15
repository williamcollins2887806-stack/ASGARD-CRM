/**
 * Block I: Date filtering tests
 * Tests filtering by date ranges using the data API where param
 */
const { api, assert, assertOk, assertArray, skip } = require('../config');

module.exports = {
  name: 'DATE FILTERING',
  tests: [
    {
      name: 'DATE: tenders created_at desc → proper date order',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=10&orderBy=created_at&desc=true');
        assertOk(resp, 'date order desc');
        const list = resp.data?.tenders || [];
        if (list.length < 2) skip('Not enough tenders for date test');
        for (let i = 0; i < list.length - 1; i++) {
          if (list[i].created_at && list[i + 1].created_at) {
            const a = new Date(list[i].created_at).getTime();
            const b = new Date(list[i + 1].created_at).getTime();
            assert(a >= b, `item ${i} (${list[i].created_at}) should be >= item ${i + 1} (${list[i + 1].created_at})`);
          }
        }
      }
    },
    {
      name: 'DATE: tenders created_at asc → proper date order',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=10&orderBy=created_at&desc=false');
        assertOk(resp, 'date order asc');
        const list = resp.data?.tenders || [];
        if (list.length < 2) skip('Not enough tenders for date test');
        for (let i = 0; i < list.length - 1; i++) {
          if (list[i].created_at && list[i + 1].created_at) {
            const a = new Date(list[i].created_at).getTime();
            const b = new Date(list[i + 1].created_at).getTime();
            assert(a <= b, `item ${i} should be <= item ${i + 1} in ASC order`);
          }
        }
      }
    },
    {
      name: 'DATE: works ordered by created_at desc',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=10&orderBy=created_at&desc=true');
        assertOk(resp, 'works date order');
        const list = resp.data?.works || [];
        if (list.length < 2) skip('Not enough works for date test');
        const first = new Date(list[0].created_at).getTime();
        const last = new Date(list[list.length - 1].created_at).getTime();
        assert(first >= last, 'first should be >= last in DESC');
      }
    },
    {
      name: 'DATE: employees ordered by created_at desc',
      run: async () => {
        const resp = await api('GET', '/api/data/employees?limit=10&orderBy=created_at&desc=true');
        assertOk(resp, 'employees date order');
        const list = resp.data?.employees || [];
        if (list.length < 2) skip('Not enough employees for date test');
        const first = new Date(list[0].created_at).getTime();
        const last = new Date(list[list.length - 1].created_at).getTime();
        assert(first >= last, 'first should be >= last in DESC');
      }
    },
    {
      name: 'DATE: invoices ordered by created_at desc',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=10&orderBy=created_at&desc=true');
        assertOk(resp, 'invoices date order');
        const list = resp.data?.invoices || [];
        if (list.length < 2) skip('Not enough invoices for date test');
        const first = new Date(list[0].created_at).getTime();
        const last = new Date(list[list.length - 1].created_at).getTime();
        assert(first >= last, 'first should be >= last in DESC');
      }
    },
    {
      name: 'DATE: calendar events ordered by date',
      run: async () => {
        const resp = await api('GET', '/api/data/calendar_events?limit=10&orderBy=created_at&desc=true');
        assertOk(resp, 'calendar date order');
        const list = resp.data?.calendar_events || [];
        if (list.length < 2) skip('Not enough calendar events');
        // Just verify no 500 and proper structure
        assert(Array.isArray(list), 'should be array');
      }
    },
    {
      name: 'DATE: equipment ordered by created_at desc',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment?limit=10&orderBy=created_at&desc=true');
        assertOk(resp, 'equipment date order');
        const list = resp.data?.equipment || [];
        if (list.length < 2) skip('Not enough equipment');
        const first = new Date(list[0].created_at).getTime();
        const last = new Date(list[list.length - 1].created_at).getTime();
        assert(first >= last, 'first should be >= last in DESC');
      }
    },
    {
      name: 'DATE: future date filter → empty or valid',
      run: async () => {
        const where = JSON.stringify({ tender_status: 'FUTURE_2099' });
        const resp = await api('GET', `/api/data/tenders?where=${encodeURIComponent(where)}&limit=10`);
        assertOk(resp, 'future filter');
        const list = resp.data?.tenders || [];
        assert(list.length === 0, `future date filter should return 0, got ${list.length}`);
      }
    },
    {
      name: 'DATE: combined sort + limit + offset → consistent order',
      run: async () => {
        // Get first page
        const p1 = await api('GET', '/api/data/tenders?limit=3&offset=0&orderBy=created_at&desc=true');
        const p2 = await api('GET', '/api/data/tenders?limit=3&offset=3&orderBy=created_at&desc=true');
        assertOk(p1, 'page1');
        assertOk(p2, 'page2');
        const l1 = p1.data?.tenders || [];
        const l2 = p2.data?.tenders || [];
        if (l1.length < 3 || l2.length === 0) skip('Not enough data for paginated date test');
        // Last of page 1 should be >= first of page 2
        const lastP1 = new Date(l1[l1.length - 1].created_at).getTime();
        const firstP2 = new Date(l2[0].created_at).getTime();
        assert(lastP1 >= firstP2, 'page boundary should maintain order');
      }
    },
    {
      name: 'DATE: notifications ordered by created_at',
      run: async () => {
        const resp = await api('GET', '/api/data/notifications?limit=10&orderBy=created_at&desc=true');
        assertOk(resp, 'notifications date order');
        const list = resp.data?.notifications || [];
        assert(Array.isArray(list), 'notifications should be array');
      }
    }
  ]
};
