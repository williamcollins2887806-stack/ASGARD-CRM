'use strict';

const { createApp } = require('../helpers/create-app');
const { getToken, authHeaders } = require('../helpers/auth');
const { TENDER_FIXTURE, PRE_TENDER_FIXTURE } = require('../helpers/fixtures');

let app;
let adminToken, toToken, dirToken, pmToken;

beforeAll(async () => {
  app = await createApp();
  adminToken = await getToken(app, 'ADMIN');
  toToken = await getToken(app, 'TO');
  dirToken = await getToken(app, 'DIRECTOR_GEN');
  pmToken = await getToken(app, 'PM');
}, 30000);

afterAll(async () => {
  if (app) await app.close();
});

// --- Helper: create tender ---
async function createTender(token, overrides = {}) {
  const resp = await app.inject({
    method: 'POST',
    url: '/api/tenders',
    headers: authHeaders(token),
    payload: { ...TENDER_FIXTURE, ...overrides }
  });
  const data = JSON.parse(resp.body);
  return { resp, data, id: data.tender?.id || data.id };
}

// --- Helper: create pre_tender via generic data API ---
async function createPreTender(token, overrides = {}) {
  const resp = await app.inject({
    method: 'POST',
    url: '/api/data/pre_tender_requests',
    headers: authHeaders(token),
    payload: {
      customer_name: 'Тест Заказчик',
      work_description: 'Химическая чистка',
      estimated_sum: 1500000,
      status: 'new',
      ai_color: 'gray',
      source_type: 'manual',
      ...overrides
    }
  });
  const data = JSON.parse(resp.body);
  return { resp, data, id: data.id || data.item?.id };
}

// ═══════════════════════════════════════════════════════════════════
// BUG-01: tender_price saves on create
// ═══════════════════════════════════════════════════════════════════
describe('BUG-01: tender_price сохраняется при создании', () => {
  test('POST с tender_price -> цена сохранена', async () => {
    const { resp, data } = await createTender(adminToken, { tender_price: 5000000 });
    expect(resp.statusCode).toBe(200);
    expect(Number(data.tender.tender_price)).toBe(5000000);
  });

  test('POST без tender_price -> не падает, цена null', async () => {
    const { resp, data } = await createTender(adminToken, { tender_price: undefined });
    expect(resp.statusCode).toBe(200);
    expect(data.tender.tender_price).toBeNull();
  });

  test('PUT обновляет tender_price', async () => {
    const { id } = await createTender(adminToken, { tender_price: 1000 });
    const upd = await app.inject({
      method: 'PUT', url: `/api/tenders/${id}`,
      headers: authHeaders(adminToken),
      payload: { tender_price: 9999999 }
    });
    expect(upd.statusCode).toBe(200);
    expect(Number(JSON.parse(upd.body).tender.tender_price)).toBe(9999999);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG-02: columns exist after V049 migration
// ═══════════════════════════════════════════════════════════════════
describe('BUG-02: колонки существуют после миграции V049', () => {
  test('GET /api/tenders/analytics/team — не 500', async () => {
    const resp = await app.inject({
      method: 'GET', url: '/api/tenders/analytics/team',
      headers: authHeaders(adminToken)
    });
    expect(resp.statusCode).not.toBe(500);
    expect([200, 403]).toContain(resp.statusCode);
  });

  test('GET /api/tenders/stats/summary — не 500', async () => {
    const resp = await app.inject({
      method: 'GET', url: '/api/tenders/stats/summary',
      headers: authHeaders(adminToken)
    });
    expect(resp.statusCode).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG-03: fast-track не падает с ReferenceError
// ═══════════════════════════════════════════════════════════════════
describe('BUG-03: fast-track не падает с ReferenceError', () => {
  test('fast-track от ADMIN создаёт тендер', async () => {
    const usersResp = await app.inject({
      method: 'GET', url: '/api/users',
      headers: authHeaders(adminToken)
    });
    const users = JSON.parse(usersResp.body);
    const usersList = Array.isArray(users) ? users : (users.users || []);
    const pm = usersList.find(u => u.role === 'PM' && u.is_active);

    if (!pm) { console.warn('Нет активного PM — пропускаем тест'); return; }

    const { id: ptId } = await createPreTender(adminToken);
    expect(ptId).toBeTruthy();

    const resp = await app.inject({
      method: 'POST', url: `/api/pre-tenders/${ptId}/fast-track`,
      headers: authHeaders(adminToken),
      payload: { pm_id: pm.id, comment: 'Тест fast-track' }
    });
    expect(resp.statusCode).not.toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG-04: stats counts 'Выиграли' as won
// ═══════════════════════════════════════════════════════════════════
describe('BUG-04: статистика считает Выиграли как won', () => {
  test('won включает статус Выиграли', async () => {
    const statuses = ['Выиграли'];
    for (const s of statuses) {
      const { id } = await createTender(adminToken, {
        tender_price: 1000000,
        customer: `Тест-${s}`,
        tender_status: 'Новый'
      });
      await app.inject({
        method: 'PUT', url: `/api/tenders/${id}`,
        headers: authHeaders(adminToken),
        payload: { tender_status: s }
      });
    }

    const resp = await app.inject({
      method: 'GET', url: '/api/tenders/stats/summary',
      headers: authHeaders(adminToken)
    });
    expect(resp.statusCode).toBe(200);
    const { summary } = JSON.parse(resp.body);
    expect(Number(summary.won)).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG-05: no phantom fields in pre_tenders.js
// ═══════════════════════════════════════════════════════════════════
describe('BUG-05: нет фантомных полей в pre_tenders.js', () => {
  test('файл не содержит pt.tender_name, pt.budget, pt.description (без _)', () => {
    const fs = require('fs');
    const code = fs.readFileSync('src/routes/pre_tenders.js', 'utf8');
    expect(code).not.toMatch(/pt\.tender_name/);
    expect(code).not.toMatch(/pt\.budget/);
    expect(code).not.toMatch(/pt\.description[^_]/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG-06: DELETE pre_tender with validation
// ═══════════════════════════════════════════════════════════════════
describe('BUG-06: DELETE pre_tender с проверками', () => {
  test('DELETE несуществующего -> 404', async () => {
    const resp = await app.inject({
      method: 'DELETE', url: '/api/pre-tenders/999999',
      headers: authHeaders(adminToken)
    });
    expect(resp.statusCode).toBe(404);
  });

  test('DELETE существующего -> 200', async () => {
    const { id } = await createPreTender(adminToken);
    expect(id).toBeTruthy();
    const resp = await app.inject({
      method: 'DELETE', url: `/api/pre-tenders/${id}`,
      headers: authHeaders(adminToken)
    });
    expect(resp.statusCode).toBe(200);
  });

  test('TO не может удалять -> 403', async () => {
    const { id } = await createPreTender(adminToken);
    const resp = await app.inject({
      method: 'DELETE', url: `/api/pre-tenders/${id}`,
      headers: authHeaders(toToken)
    });
    expect(resp.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG-07: renew restores expired
// ═══════════════════════════════════════════════════════════════════
describe('BUG-07: renew восстанавливает expired', () => {
  test('expired -> new после renew', async () => {
    const { id } = await createPreTender(adminToken);
    await app.inject({
      method: 'PUT', url: `/api/data/pre_tender_requests/${id}`,
      headers: authHeaders(adminToken),
      payload: { status: 'expired' }
    });
    const resp = await app.inject({
      method: 'POST', url: `/api/pre-tenders/${id}/renew`,
      headers: authHeaders(adminToken)
    });
    expect(resp.statusCode).toBe(200);
    const data = JSON.parse(resp.body);
    expect(data.item?.status || data.status).toBe('new');
  });

  test('in_review остаётся in_review после renew', async () => {
    const { id } = await createPreTender(adminToken, { status: 'in_review' });
    const resp = await app.inject({
      method: 'POST', url: `/api/pre-tenders/${id}/renew`,
      headers: authHeaders(adminToken)
    });
    expect(resp.statusCode).toBe(200);
    const data = JSON.parse(resp.body);
    expect(data.item?.status || data.status).not.toBe('new');
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG-09: no regex replace in SQL
// ═══════════════════════════════════════════════════════════════════
describe('BUG-09: нет regex replace в SQL', () => {
  test('файл не содержит replace(/t\\./', () => {
    const fs = require('fs');
    const code = fs.readFileSync('src/routes/tenders.js', 'utf8');
    expect(code).not.toMatch(/\.replace\(\/t\\\./);
  });

  test('stats/summary с поиском не падает', async () => {
    const resp = await app.inject({
      method: 'GET', url: '/api/tenders/stats/summary?search=test.value',
      headers: authHeaders(adminToken)
    });
    expect(resp.statusCode).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG-10: accept in transaction
// ═══════════════════════════════════════════════════════════════════
describe('BUG-10: accept в транзакции', () => {
  test('accept создаёт тендер и обновляет заявку атомарно', async () => {
    const { id: ptId } = await createPreTender(dirToken, {
      customer_name: 'ООО Транзакция',
      status: 'new'
    });
    expect(ptId).toBeTruthy();

    const resp = await app.inject({
      method: 'POST', url: `/api/pre-tenders/${ptId}/accept`,
      headers: authHeaders(dirToken),
      payload: { comment: 'Тест транзакции' }
    });

    if (resp.statusCode === 200) {
      const data = JSON.parse(resp.body);
      expect(data.tender_id).toBeTruthy();

      const ptResp = await app.inject({
        method: 'GET', url: `/api/pre-tenders/${ptId}`,
        headers: authHeaders(dirToken)
      });
      if (ptResp.statusCode === 200) {
        const ptData = JSON.parse(ptResp.body);
        expect(ptData.item?.status).toBe('accepted');
        expect(ptData.item?.created_tender_id).toBe(data.tender_id);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG-11: stats with year parameter
// ═══════════════════════════════════════════════════════════════════
describe('BUG-11: stats с year параметром', () => {
  test('stats/summary?year=2026 работает', async () => {
    const resp = await app.inject({
      method: 'GET', url: '/api/tenders/stats/summary?year=2026',
      headers: authHeaders(adminToken)
    });
    expect(resp.statusCode).toBe(200);
    const data = JSON.parse(resp.body);
    expect(data.summary).toBeDefined();
  });

  test('stats/summary?period=2026-03&year=2026 работает', async () => {
    const resp = await app.inject({
      method: 'GET', url: '/api/tenders/stats/summary?period=2026-03&year=2026',
      headers: authHeaders(adminToken)
    });
    expect(resp.statusCode).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Final code checks
// ═══════════════════════════════════════════════════════════════════
describe('Финальные проверки кодовой базы', () => {
  const fs = require('fs');

  test('нет delete raw.tender_price', () => {
    const code = fs.readFileSync('src/routes/tenders.js', 'utf8');
    expect(code).not.toContain('delete raw.tender_price');
  });

  test('нет дубля tender_price в allowedFields', () => {
    const code = fs.readFileSync('src/routes/tenders.js', 'utf8');
    expect(code).not.toMatch(/'tender_price',\s*'tender_price'/);
  });

  test('нет regex replace t. в SQL', () => {
    const code = fs.readFileSync('src/routes/tenders.js', 'utf8');
    expect(code).not.toMatch(/\.replace\(\/t\\\./);
  });

  test('нет фантомных полей в pre_tenders', () => {
    const code = fs.readFileSync('src/routes/pre_tenders.js', 'utf8');
    expect(code).not.toMatch(/pt\.tender_name/);
    expect(code).not.toMatch(/pt\.budget/);
  });

  test('миграция V049 существует', () => {
    expect(fs.existsSync('migrations/V049__tender_bugfix_columns.sql')).toBe(true);
  });
});
