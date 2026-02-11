/**
 * Block A: Pagination, sorting, filtering tests
 * Tests /api/data/:table with limit, offset, orderBy, desc, where params
 */
const { api, assert, assertOk, assertArray, skip } = require('../config');

const TABLES = ['tenders', 'works', 'employees', 'invoices', 'equipment'];

function makeTests() {
  const tests = [];

  for (const table of TABLES) {
    tests.push({
      name: `PAGING: ${table} limit=5 offset=0 → ≤5 items`,
      run: async () => {
        const resp = await api('GET', `/api/data/${table}?limit=5&offset=0`);
        assertOk(resp, `${table} limit=5`);
        const list = resp.data?.[table];
        assertArray(list, `${table} list`);
        assert(list.length <= 5, `${table}: expected ≤5, got ${list.length}`);
        if (list.length === 0) skip(`${table} has no data`);
      }
    });

    tests.push({
      name: `PAGING: ${table} limit=5 offset=5 → no overlap with first page`,
      run: async () => {
        const page1 = await api('GET', `/api/data/${table}?limit=5&offset=0`);
        const page2 = await api('GET', `/api/data/${table}?limit=5&offset=5`);
        assertOk(page1, `${table} page1`);
        assertOk(page2, `${table} page2`);
        const ids1 = (page1.data?.[table] || []).map(r => r.id).filter(Boolean);
        const ids2 = (page2.data?.[table] || []).map(r => r.id).filter(Boolean);
        if (ids1.length === 0 || ids2.length === 0) skip(`${table} insufficient data for pagination test`);
        const overlap = ids1.filter(id => ids2.includes(id));
        assert(overlap.length === 0, `${table}: pages overlap on ids: ${overlap.join(',')}`);
      }
    });

    tests.push({
      name: `PAGING: ${table} offset=999999 → empty`,
      run: async () => {
        const resp = await api('GET', `/api/data/${table}?limit=5&offset=999999`);
        assertOk(resp, `${table} offset=999999`);
        const list = resp.data?.[table] || [];
        assert(list.length === 0, `${table}: expected 0 items at huge offset, got ${list.length}`);
      }
    });

    tests.push({
      name: `SORT: ${table} orderBy=created_at desc → newest first`,
      run: async () => {
        const resp = await api('GET', `/api/data/${table}?limit=5&orderBy=created_at&desc=true`);
        assertOk(resp, `${table} sort desc`);
        const list = resp.data?.[table] || [];
        if (list.length < 2) skip(`${table} insufficient data for sort test`);
        const first = new Date(list[0].created_at).getTime();
        const last = new Date(list[list.length - 1].created_at).getTime();
        assert(first >= last, `${table}: first (${list[0].created_at}) should be >= last (${list[list.length-1].created_at})`);
      }
    });

    tests.push({
      name: `SORT: ${table} orderBy=created_at asc → oldest first`,
      run: async () => {
        const resp = await api('GET', `/api/data/${table}?limit=5&orderBy=created_at&desc=false`);
        assertOk(resp, `${table} sort asc`);
        const list = resp.data?.[table] || [];
        if (list.length < 2) skip(`${table} insufficient data for sort test`);
        const first = new Date(list[0].created_at).getTime();
        const last = new Date(list[list.length - 1].created_at).getTime();
        assert(first <= last, `${table}: first should be <= last in ASC`);
      }
    });
  }

  // Filter by status for tenders
  tests.push({
    name: 'FILTER: tenders where status=Новый → all items have that status',
    run: async () => {
      const where = JSON.stringify({ tender_status: 'Новый' });
      const resp = await api('GET', `/api/data/tenders?where=${encodeURIComponent(where)}&limit=50`);
      assertOk(resp, 'tenders filter status');
      const list = resp.data?.tenders || [];
      if (list.length === 0) skip('No tenders with status Новый');
      for (const item of list) {
        assert(item.tender_status === 'Новый', `Expected status "Новый", got "${item.tender_status}"`);
      }
    }
  });

  // Combo: limit + offset + sort
  tests.push({
    name: 'COMBO: tenders limit=3 offset=2 orderBy=created_at desc → correct slice',
    run: async () => {
      const all = await api('GET', '/api/data/tenders?limit=100&orderBy=created_at&desc=true');
      const page = await api('GET', '/api/data/tenders?limit=3&offset=2&orderBy=created_at&desc=true');
      assertOk(all, 'combo all');
      assertOk(page, 'combo page');
      const allList = all.data?.tenders || [];
      const pageList = page.data?.tenders || [];
      if (allList.length < 5) skip('Insufficient tenders for combo test');
      assert(pageList.length <= 3, `Expected ≤3, got ${pageList.length}`);
      if (pageList.length > 0 && allList.length > 2) {
        assert(pageList[0].id === allList[2].id, `First item of page should match item #3 of full list`);
      }
    }
  });

  // Total count reflects filter
  tests.push({
    name: 'PAGING: total count is number and ≥ returned items',
    run: async () => {
      const resp = await api('GET', '/api/data/tenders?limit=2');
      assertOk(resp, 'total count');
      assert(typeof resp.data?.total === 'number', `total should be number, got ${typeof resp.data?.total}`);
      const list = resp.data?.tenders || [];
      assert(resp.data.total >= list.length, `total (${resp.data.total}) should be >= items (${list.length})`);
    }
  });

  return tests;
}

module.exports = {
  name: 'PAGINATION, SORT & FILTER',
  tests: makeTests()
};
