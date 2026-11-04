'use strict';

/**
 * Jarl Pulse — overview + detail enrichment на клоне asgard_crm_test.
 *
 * Доказываем:
 *  1. /overview отдаёт hero-поля (nmck_sum, work_price_sum, attention, by_status);
 *  2. заявки идут по канбану V3 (11 колонок, включая trash);
 *  3. /tenders/:id отдаёт estimate.rows / checklist.items / audit / outcome-поля;
 *  4. /applications/:id и /works/:id не 500.
 */

const path = require('path');
const Fastify = require('fastify');

const ROOT = path.join(__dirname, '..', '..');
const DB = process.env.PGDATABASE || 'asgard_crm_test';

let fastify;
let pool;

beforeAll(async () => {
  const { Pool } = require('pg');
  pool = new Pool({
    user: process.env.PGUSER || 'asgard',
    password: process.env.PGPASSWORD || '123456789',
    database: process.env.PGDATABASE || DB,
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    max: 4
  });

  fastify = Fastify({ logger: false });
  fastify.decorate('db', pool);
  fastify.decorate('authenticate', async () => {});
  fastify.decorate('requireRoles', () => async () => {});
  fastify.decorateRequest('user', null);
  fastify.addHook('onRequest', async (req) => {
    req.user = { id: 1, role: 'DIRECTOR_GEN' };
  });
  await fastify.register(require(path.join(ROOT, 'src/routes/director-analytics')), {
    prefix: '/api/director-analytics'
  });
  await fastify.ready();
});

afterAll(async () => {
  if (fastify) await fastify.close();
  if (pool) await pool.end();
});

async function get(url) {
  const res = await fastify.inject({ method: 'GET', url });
  let body = null;
  try { body = JSON.parse(res.payload); } catch (_) { body = res.payload; }
  return { code: res.statusCode, body };
}

const V3 = [
  'new', 'calc', 'approval', 'kp_prep', 'sent', 'addendum',
  'win', 'lose', 'work', 'done', 'trash'
];

describe('director-analytics overview', () => {
  test('200 + hero контракт тендеров/заявок/работ', async () => {
    const r = await get('/api/director-analytics/overview?period=year');
    expect(r.code).toBe(200);
    expect(r.body.tenders).toMatchObject({
      total: expect.any(Number),
      nmck_sum: expect.any(Number),
      work_price_sum: expect.any(Number),
      overdue_count: expect.any(Number)
    });
    expect(Array.isArray(r.body.tenders.by_status)).toBe(true);
    expect(r.body.tenders.by_status).toHaveLength(6);
    expect(Array.isArray(r.body.tenders.attention)).toBe(true);

    expect(r.body.applications).toMatchObject({
      total: expect.any(Number),
      overdue_count: expect.any(Number)
    });
    expect(Array.isArray(r.body.applications.by_status)).toBe(true);
    expect(r.body.applications.by_status.map((x) => x.status)).toEqual(V3);
    expect(r.body.applications.by_status.find((x) => x.status === 'trash')).toBeTruthy();

    expect(r.body.works).toMatchObject({
      total: expect.any(Number),
      contract_sum: expect.any(Number),
      paid_sum: expect.any(Number),
      risk_count: expect.any(Number)
    });
    expect(Array.isArray(r.body.works.by_bucket)).toBe(true);
    expect(Array.isArray(r.body.works.attention)).toBe(true);
  });
});

describe('director-analytics applications V3', () => {
  test('by-status отдаёт 11 колонок канбана', async () => {
    const r = await get('/api/director-analytics/applications/by-status?period=all');
    expect(r.code).toBe(200);
    expect(r.body.byStatus.map((x) => x.status)).toEqual(V3);
    expect(r.body.byStatus.find((x) => x.status === 'trash').label).toBe('Корзина');
  });

  test('list не падает; статусы только из V3', async () => {
    const r = await get('/api/director-analytics/applications?period=all&limit=20');
    expect(r.code).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
    for (const it of r.body.items) {
      expect(V3).toContain(it.status);
    }
  });
});

describe('director-analytics detail enrichment', () => {
  test('tender detail: estimate/checklist/audit shape', async () => {
    const list = await get('/api/director-analytics/tenders?period=all&limit=5');
    expect(list.code).toBe(200);
    if (!list.body.items.length) return;
    const id = list.body.items[0].id;
    const r = await get('/api/director-analytics/tenders/' + id);
    expect(r.code).toBe(200);
    expect(r.body).toHaveProperty('nmck');
    expect(r.body).toHaveProperty('platform');
    expect(r.body).toHaveProperty('audit');
    expect(Array.isArray(r.body.audit)).toBe(true);
    expect(r.body.estimate).toBeTruthy();
    expect(Array.isArray(r.body.estimate.rows)).toBe(true);
    expect(r.body.checklist === null || Array.isArray(r.body.checklist.items)).toBe(true);
    expect(r.body).toHaveProperty('outcome');
    expect(r.body).toHaveProperty('due_flag');
  });

  test('application detail: history/docs/estimate shape', async () => {
    const list = await get('/api/director-analytics/applications?period=all&limit=5');
    expect(list.code).toBe(200);
    const withPt = (list.body.items || []).find((x) => x.entity_kind === 'pre_tender' || x.id);
    if (!withPt) return;
    const r = await get('/api/director-analytics/applications/' + withPt.id);
    // pre_tender entity — 200; inbox-only id без строки pt — 404 допустим
    if (r.code === 404) return;
    expect(r.code).toBe(200);
    expect(Array.isArray(r.body.history)).toBe(true);
    expect(Array.isArray(r.body.documents)).toBe(true);
    expect(Array.isArray(r.body.audit)).toBe(true);
    expect(V3).toContain(r.body.status);
  });

  test('work detail: schedule_light + timesheet persons', async () => {
    const list = await get('/api/director-analytics/works?bucket=all');
    expect(list.code).toBe(200);
    if (!list.body.items.length) return;
    const id = list.body.items[0].id;
    const r = await get('/api/director-analytics/works/' + id);
    expect(r.code).toBe(200);
    expect(r.body).toHaveProperty('schedule_light');
    expect(r.body).toHaveProperty('leftover');
    expect(Array.isArray(r.body.timesheet_by_month)).toBe(true);
    expect(Array.isArray(r.body.brigade)).toBe(true);
    expect(Array.isArray(r.body.recent_checkins)).toBe(true);
  });
});
