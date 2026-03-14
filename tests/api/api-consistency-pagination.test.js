/**
 * API Consistency, Pagination, Sorting & Filtering (150 tests)
 *
 * Read-only tests verifying consistent behavior across:
 *  - Universal data API (/api/data/:table) pagination, sorting, search
 *  - Dedicated endpoint availability and response format
 *  - Response structure consistency
 */
const { api, assert, assertOk, assertArray, assertHasFields, skip } = require('../config');

/** Extract the array payload from a response, regardless of envelope shape. */
function extractList(data, tableName) {
  if (!data) return null;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.rows)) return data.rows;
  if (tableName && Array.isArray(data[tableName])) return data[tableName];
  return null;
}

// ---------------------------------------------------------------------------
// Section 1 — Pagination on data API (40 tests)
// ---------------------------------------------------------------------------
const PAGINATION_TABLES = [
  'tenders', 'works', 'employees', 'invoices', 'acts',
  'customers', 'calendar_events', 'equipment', 'notifications', 'chats',
  'contracts', 'documents', 'staff', 'reminders', 'correspondence',
];

const paginationTests = [];

// 1-2: tenders limit=1 and limit=5
paginationTests.push({
  name: 'Pagination: GET /api/data/tenders?limit=1 returns <=1 item',
  run: async () => {
    const resp = await api('GET', '/api/data/tenders?limit=1');
    assertOk(resp, 'tenders limit=1');
    const list = extractList(resp.data, 'tenders');
    if (!list) skip('tenders data format unrecognised');
    assert(list.length <= 1, `Expected <=1, got ${list.length}`);
  },
});

paginationTests.push({
  name: 'Pagination: GET /api/data/tenders?limit=5 returns <=5 items',
  run: async () => {
    const resp = await api('GET', '/api/data/tenders?limit=5');
    assertOk(resp, 'tenders limit=5');
    const list = extractList(resp.data, 'tenders');
    if (!list) skip('tenders data format unrecognised');
    assert(list.length <= 5, `Expected <=5, got ${list.length}`);
  },
});

// 3: limit=0 -> empty or error
paginationTests.push({
  name: 'Pagination: GET /api/data/tenders?limit=0 returns empty or error',
  run: async () => {
    const resp = await api('GET', '/api/data/tenders?limit=0');
    assert(resp.status !== 500, `limit=0 caused 500 server error`);
    if (resp.ok) {
      const list = extractList(resp.data, 'tenders');
      if (list) assert(list.length === 0, `Expected 0 items for limit=0, got ${list.length}`);
    }
  },
});

// 4: limit=-1 -> graceful handling
paginationTests.push({
  name: 'Pagination: GET /api/data/tenders?limit=-1 handles gracefully',
  run: async () => {
    const resp = await api('GET', '/api/data/tenders?limit=-1');
    assert(resp.status !== 500, `limit=-1 caused 500 server error`);
  },
});

// 5: offset=0&limit=1
paginationTests.push({
  name: 'Pagination: GET /api/data/tenders?offset=0&limit=1 works',
  run: async () => {
    const resp = await api('GET', '/api/data/tenders?offset=0&limit=1');
    assertOk(resp, 'tenders offset=0 limit=1');
    const list = extractList(resp.data, 'tenders');
    if (!list) skip('tenders data format unrecognised');
    assert(list.length <= 1, `Expected <=1, got ${list.length}`);
  },
});

// 6: huge offset -> empty
paginationTests.push({
  name: 'Pagination: GET /api/data/tenders?offset=999999&limit=1 returns empty',
  run: async () => {
    const resp = await api('GET', '/api/data/tenders?offset=999999&limit=1');
    assertOk(resp, 'tenders huge offset');
    const list = extractList(resp.data, 'tenders');
    if (!list) skip('tenders data format unrecognised');
    assert(list.length === 0, `Expected 0 at offset 999999, got ${list.length}`);
  },
});

// 7-40: For each of the 15 tables, limit=1 test and limit=5 test (30 tests)
// Plus 4 extra edge-case pagination tests = 6 + 30 + 4 = 40 total
for (const table of PAGINATION_TABLES) {
  paginationTests.push({
    name: `Pagination: /api/data/${table}?limit=1 returns <=1`,
    run: async () => {
      const resp = await api('GET', `/api/data/${table}?limit=1`);
      if (resp.status === 404) skip(`Table ${table} not found`);
      assertOk(resp, `${table} limit=1`);
      const list = extractList(resp.data, table);
      if (!list) skip(`${table} data format unrecognised`);
      assert(list.length <= 1, `${table}: expected <=1, got ${list.length}`);
    },
  });

  paginationTests.push({
    name: `Pagination: /api/data/${table}?limit=5 returns <=5`,
    run: async () => {
      const resp = await api('GET', `/api/data/${table}?limit=5`);
      if (resp.status === 404) skip(`Table ${table} not found`);
      assertOk(resp, `${table} limit=5`);
      const list = extractList(resp.data, table);
      if (!list) skip(`${table} data format unrecognised`);
      assert(list.length <= 5, `${table}: expected <=5, got ${list.length}`);
    },
  });
}

// 37-40: Extra edge-case pagination tests
paginationTests.push({
  name: 'Pagination: /api/data/works?offset=0&limit=10 returns <=10',
  run: async () => {
    const resp = await api('GET', '/api/data/works?offset=0&limit=10');
    if (resp.status === 404) skip('Table works not found');
    assertOk(resp, 'works offset=0 limit=10');
    const list = extractList(resp.data, 'works');
    if (!list) skip('works data format unrecognised');
    assert(list.length <= 10, `Expected <=10, got ${list.length}`);
  },
});

paginationTests.push({
  name: 'Pagination: /api/data/employees?offset=999999&limit=5 returns empty',
  run: async () => {
    const resp = await api('GET', '/api/data/employees?offset=999999&limit=5');
    if (resp.status === 404) skip('Table employees not found');
    assertOk(resp, 'employees huge offset');
    const list = extractList(resp.data, 'employees');
    if (!list) skip('employees data format unrecognised');
    assert(list.length === 0, `Expected 0 at huge offset, got ${list.length}`);
  },
});

paginationTests.push({
  name: 'Pagination: /api/data/invoices?limit=2&offset=1 returns <=2',
  run: async () => {
    const resp = await api('GET', '/api/data/invoices?limit=2&offset=1');
    if (resp.status === 404) skip('Table invoices not found');
    assertOk(resp, 'invoices limit=2 offset=1');
    const list = extractList(resp.data, 'invoices');
    if (!list) skip('invoices data format unrecognised');
    assert(list.length <= 2, `Expected <=2, got ${list.length}`);
  },
});

paginationTests.push({
  name: 'Pagination: /api/data/customers?limit=3&offset=0 returns <=3',
  run: async () => {
    const resp = await api('GET', '/api/data/customers?limit=3&offset=0');
    if (resp.status === 404) skip('Table customers not found');
    assertOk(resp, 'customers limit=3 offset=0');
    const list = extractList(resp.data, 'customers');
    if (!list) skip('customers data format unrecognised');
    assert(list.length <= 3, `Expected <=3, got ${list.length}`);
  },
});

// ---------------------------------------------------------------------------
// Section 2 — Sorting on data API (25 tests)
// ---------------------------------------------------------------------------
const SORT_TABLES = [
  'tenders', 'works', 'employees', 'invoices', 'acts',
  'customers', 'equipment', 'contracts', 'documents', 'staff',
];

const sortingTests = [];

// 2 tests per table (sort=id asc & desc) = 20 tests
for (const table of SORT_TABLES) {
  sortingTests.push({
    name: `Sorting: /api/data/${table}?sort=id&order=asc returns 200`,
    run: async () => {
      const resp = await api('GET', `/api/data/${table}?sort=id&order=asc&limit=5`);
      if (resp.status === 404) skip(`Table ${table} not found`);
      assertOk(resp, `${table} sort id asc`);
    },
  });

  sortingTests.push({
    name: `Sorting: /api/data/${table}?sort=id&order=desc returns 200`,
    run: async () => {
      const resp = await api('GET', `/api/data/${table}?sort=id&order=desc&limit=5`);
      if (resp.status === 404) skip(`Table ${table} not found`);
      assertOk(resp, `${table} sort id desc`);
    },
  });
}

// 21: tenders sort by created_at desc
sortingTests.push({
  name: 'Sorting: /api/data/tenders?sort=created_at&order=desc returns 200',
  run: async () => {
    const resp = await api('GET', '/api/data/tenders?sort=created_at&order=desc&limit=5');
    if (resp.status === 404) skip('Table tenders not found');
    assertOk(resp, 'tenders sort created_at desc');
  },
});

// 22: works sort by created_at asc
sortingTests.push({
  name: 'Sorting: /api/data/works?sort=created_at&order=asc returns 200',
  run: async () => {
    const resp = await api('GET', '/api/data/works?sort=created_at&order=asc&limit=5');
    if (resp.status === 404) skip('Table works not found');
    assertOk(resp, 'works sort created_at asc');
  },
});

// 23: employees sort by created_at desc
sortingTests.push({
  name: 'Sorting: /api/data/employees?sort=created_at&order=desc returns 200',
  run: async () => {
    const resp = await api('GET', '/api/data/employees?sort=created_at&order=desc&limit=5');
    if (resp.status === 404) skip('Table employees not found');
    assertOk(resp, 'employees sort created_at desc');
  },
});

// 24: invalid sort field should not crash
sortingTests.push({
  name: 'Sorting: invalid sort field does not cause 500',
  run: async () => {
    const resp = await api('GET', '/api/data/tenders?sort=nonexistent_field_xyz&order=asc&limit=5');
    assert(resp.status !== 500, `Invalid sort field caused 500 error`);
  },
});

// 25: invalid order value should not crash
sortingTests.push({
  name: 'Sorting: invalid order value does not cause 500',
  run: async () => {
    const resp = await api('GET', '/api/data/tenders?sort=id&order=INVALID&limit=5');
    assert(resp.status !== 500, `Invalid order value caused 500 error`);
  },
});

// ---------------------------------------------------------------------------
// Section 3 — Dedicated endpoints respond (40 tests)
// ---------------------------------------------------------------------------
const DEDICATED_ENDPOINTS = [
  '/api/tenders',
  '/api/works',
  '/api/users',
  '/api/invoices',
  '/api/acts',
  '/api/estimates',
  '/api/customers',
  '/api/equipment',
  '/api/calendar',
  '/api/staff',
  '/api/employees',
  '/api/notifications',
  '/api/chats',
  '/api/tasks',
  '/api/permits',
  '/api/sites',
  '/api/meetings',
  '/api/reports',
  '/api/settings',
  '/api/correspondence',
];

const endpointTests = [];

// 2 tests per endpoint: ADMIN + alternate role = 40 tests
const ALTERNATE_ROLES = {
  '/api/tenders': 'PM',
  '/api/works': 'PM',
  '/api/users': 'BUH',
  '/api/invoices': 'BUH',
  '/api/acts': 'BUH',
  '/api/estimates': 'PM',
  '/api/customers': 'PM',
  '/api/equipment': 'PM',
  '/api/calendar': 'PM',
  '/api/staff': 'BUH',
  '/api/employees': 'BUH',
  '/api/notifications': 'PM',
  '/api/chats': 'PM',
  '/api/tasks': 'PM',
  '/api/permits': 'PM',
  '/api/sites': 'PM',
  '/api/meetings': 'PM',
  '/api/reports': 'BUH',
  '/api/settings': 'BUH',
  '/api/correspondence': 'PM',
};

for (const endpoint of DEDICATED_ENDPOINTS) {
  const altRole = ALTERNATE_ROLES[endpoint] || 'PM';

  endpointTests.push({
    name: `Endpoint: GET ${endpoint} as ADMIN returns 200`,
    run: async () => {
      const resp = await api('GET', endpoint, { role: 'ADMIN' });
      if (resp.status === 404) skip(`${endpoint} not implemented`);
      assertOk(resp, `${endpoint} ADMIN`);
    },
  });

  endpointTests.push({
    name: `Endpoint: GET ${endpoint} as ${altRole} responds`,
    run: async () => {
      const resp = await api('GET', endpoint, { role: altRole });
      if (resp.status === 404) skip(`${endpoint} not implemented`);
      // Allow 200, 403, 401 — just not 500
      assert(resp.status !== 500, `${endpoint} [${altRole}] returned 500`);
    },
  });
}

// ---------------------------------------------------------------------------
// Section 4 — Response format consistency (25 tests)
// ---------------------------------------------------------------------------
const FORMAT_TABLES = [
  'tenders', 'works', 'employees', 'invoices', 'acts',
  'customers', 'equipment', 'contracts', 'documents', 'staff',
  'notifications', 'chats', 'calendar_events', 'correspondence', 'reminders',
];

const formatTests = [];

// 15 tests: each data API response is an array (via extractList)
for (const table of FORMAT_TABLES) {
  formatTests.push({
    name: `Format: /api/data/${table} response contains array`,
    run: async () => {
      const resp = await api('GET', `/api/data/${table}?limit=5`);
      if (resp.status === 404) skip(`Table ${table} not found`);
      assertOk(resp, `${table} format`);
      const list = extractList(resp.data, table);
      assert(list !== null, `${table}: response does not contain an array (data: ${JSON.stringify(resp.data)?.slice(0, 200)})`);
      assertArray(list, `${table} array check`);
    },
  });
}

// 5 tests: dedicated endpoints return consistent format
const FORMAT_DEDICATED = [
  { path: '/api/tenders', key: 'tenders' },
  { path: '/api/works', key: 'works' },
  { path: '/api/customers', key: 'customers' },
  { path: '/api/invoices', key: 'invoices' },
  { path: '/api/equipment', key: 'equipment' },
];

for (const ep of FORMAT_DEDICATED) {
  formatTests.push({
    name: `Format: ${ep.path} response is array or has array data`,
    run: async () => {
      const resp = await api('GET', ep.path, { role: 'ADMIN' });
      if (resp.status === 404) skip(`${ep.path} not implemented`);
      assertOk(resp, `${ep.path} format`);
      const list = extractList(resp.data, ep.key);
      assert(list !== null, `${ep.path}: no array found in response (keys: ${resp.data && typeof resp.data === 'object' ? Object.keys(resp.data).join(', ') : typeof resp.data})`);
    },
  });
}

// 3 tests: objects in arrays have 'id' field
const ID_TABLES = ['tenders', 'works', 'employees'];

for (const table of ID_TABLES) {
  formatTests.push({
    name: `Format: /api/data/${table} objects have 'id' field`,
    run: async () => {
      const resp = await api('GET', `/api/data/${table}?limit=3`);
      if (resp.status === 404) skip(`Table ${table} not found`);
      assertOk(resp, `${table} id field`);
      const list = extractList(resp.data, table);
      if (!list || list.length === 0) skip(`${table} has no data`);
      for (const item of list) {
        assert('id' in item, `${table}: object missing 'id' field (keys: ${Object.keys(item).join(', ')})`);
      }
    },
  });
}

// 2 tests: objects have created_at for timestamped tables
const TIMESTAMP_TABLES = ['tenders', 'works'];

for (const table of TIMESTAMP_TABLES) {
  formatTests.push({
    name: `Format: /api/data/${table} objects have 'created_at' field`,
    run: async () => {
      const resp = await api('GET', `/api/data/${table}?limit=3`);
      if (resp.status === 404) skip(`Table ${table} not found`);
      assertOk(resp, `${table} created_at field`);
      const list = extractList(resp.data, table);
      if (!list || list.length === 0) skip(`${table} has no data`);
      for (const item of list) {
        assert('created_at' in item, `${table}: object missing 'created_at' (keys: ${Object.keys(item).join(', ')})`);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Section 5 — Search / Filter functionality (20 tests)
// ---------------------------------------------------------------------------
const SEARCH_TABLES = [
  'tenders', 'works', 'customers', 'employees', 'invoices',
  'equipment', 'contracts', 'documents', 'staff', 'acts',
];

const searchTests = [];

// 10 tests: search=test on 10 tables
for (const table of SEARCH_TABLES) {
  searchTests.push({
    name: `Search: /api/data/${table}?search=test returns 200`,
    run: async () => {
      const resp = await api('GET', `/api/data/${table}?search=test&limit=5`);
      if (resp.status === 404) skip(`Table ${table} not found`);
      assertOk(resp, `${table} search=test`);
    },
  });
}

// 5 tests: empty search string on 5 tables
const EMPTY_SEARCH_TABLES = ['tenders', 'works', 'customers', 'employees', 'invoices'];

for (const table of EMPTY_SEARCH_TABLES) {
  searchTests.push({
    name: `Search: /api/data/${table}?search= (empty) returns 200`,
    run: async () => {
      const resp = await api('GET', `/api/data/${table}?search=&limit=5`);
      if (resp.status === 404) skip(`Table ${table} not found`);
      assertOk(resp, `${table} empty search`);
    },
  });
}

// 5 tests: special chars in search on 5 tables
const SPECIAL_SEARCH_TABLES = ['tenders', 'works', 'customers', 'employees', 'equipment'];

for (const table of SPECIAL_SEARCH_TABLES) {
  searchTests.push({
    name: `Search: /api/data/${table}?search=<special> does not crash`,
    run: async () => {
      const q = encodeURIComponent("'; DROP TABLE --");
      const resp = await api('GET', `/api/data/${table}?search=${q}&limit=5`);
      if (resp.status === 404) skip(`Table ${table} not found`);
      assert(resp.status !== 500, `${table}: special chars in search caused 500`);
    },
  });
}

// ---------------------------------------------------------------------------
// Assemble all tests
// ---------------------------------------------------------------------------
const allTests = [
  ...paginationTests,   // 40
  ...sortingTests,       // 25
  ...endpointTests,      // 40
  ...formatTests,        // 25
  ...searchTests,        // 20
];

module.exports = {
  name: `API Consistency, Pagination, Sorting & Filtering (${allTests.length} tests)`,
  tests: allTests,
};
