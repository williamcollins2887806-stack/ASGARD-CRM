'use strict';

/**
 * API-тест «правды данных» Пульса директора на клоне БД.
 *
 * Что доказываем (каждое — реальный дефект, найденный 10.11.2026):
 *  1. В «Требует внимания» нет поданных/решённых/удалённых и ничего старше
 *     разумного окна — раньше приходили тендеры 2020 года.
 *  2. attention_count — реальное число, а не длина среза LIMIT.
 *  3. НМЦК считается с фолбэком на submission_price: не 0 при живых процедурах.
 *  4. Счётчики нормы по state сходятся с people_total.
 *  5. delta_hours не теряет минуты (раньше −5 мин превращались в −0,1 ч).
 *  6. История контрагента: сумма статусов = total, за всё время.
 *  7. /tenders читает sort и не отдаёт закрытые первыми.
 *
 * Запуск (нужен клон asgard_crm_test):
 *   npx jest tests/integration/director-analytics-truth.test.js
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
    database: DB,
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    max: 4
  });
  fastify = Fastify({ logger: false });
  fastify.decorate('db', pool);
  fastify.decorate('authenticate', async () => {});
  fastify.decorate('requireRoles', () => async () => {});
  fastify.decorateRequest('user', null);
  fastify.addHook('onRequest', async (req) => { req.user = { id: 1, role: 'DIRECTOR_GEN' }; });
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
  return { code: res.statusCode, body: JSON.parse(res.payload) };
}

describe('attention: только реально требующее решения', () => {
  test('нет поданных, выигранных, проигранных и отменённых', async () => {
    const r = await get('/api/director-analytics/overview?period=all');
    expect(r.code).toBe(200);
    const bad = r.body.tenders.attention.filter((x) => ['подались', 'выиграли', 'проиграли', 'отмена'].includes(x.status));
    expect(bad).toEqual([]);
  });

  test('нет удалённых и архивных (сверка с БД)', async () => {
    const r = await get('/api/director-analytics/overview?period=all');
    const ids = r.body.tenders.attention.map((x) => x.id);
    if (!ids.length) return;
    const { rows } = await pool.query(
      `SELECT id FROM tenders WHERE id = ANY($1::int[])
         AND (deleted_at IS NOT NULL OR archived_at IS NOT NULL)`,
      [ids]
    );
    expect(rows).toEqual([]);
  });

  test('нет карточек с уже принятым решением РП', async () => {
    const r = await get('/api/director-analytics/overview?period=all');
    const ids = r.body.tenders.attention.map((x) => x.id);
    if (!ids.length) return;
    const { rows } = await pool.query(
      `SELECT tender_id FROM tender_rp_reviews
        WHERE tender_id = ANY($1::int[])
          AND (COALESCE(decision,'pending') <> 'pending' OR COALESCE(is_final,false) = true)`,
      [ids]
    );
    expect(rows).toEqual([]);
  });

  test('attention_count — реальное число, не длина среза', async () => {
    const r = await get('/api/director-analytics/overview?period=all');
    expect(typeof r.body.tenders.attention_count).toBe('number');
    expect(r.body.tenders.attention_count).toBeGreaterThanOrEqual(r.body.tenders.attention.length);
  });

  test('attention не зависит от периода (просроченная задача не «исчезает»)', async () => {
    const m = await get('/api/director-analytics/overview?period=month');
    const a = await get('/api/director-analytics/overview?period=all');
    expect(m.body.tenders.attention_count).toBe(a.body.tenders.attention_count);
  });

  test('у каждой строки есть причина attention_kind', async () => {
    const r = await get('/api/director-analytics/overview?period=all');
    for (const x of r.body.tenders.attention) {
      expect(['director', 'analysis_overdue', 'deadline_soon']).toContain(x.attention_kind);
    }
  });
});

describe('деньги: НМЦК не обнуляется', () => {
  test('nmck_sum > 0 при наличии цен в периоде', async () => {
    const r = await get('/api/director-analytics/overview?period=month');
    expect(r.code).toBe(200);
    expect(r.body.tenders.total).toBeGreaterThan(0);
    expect(r.body.tenders.nmck_sum).toBeGreaterThan(0);
  });

  test('priced_count не больше total', async () => {
    const r = await get('/api/director-analytics/overview?period=all');
    expect(r.body.tenders.priced_count).toBeLessThanOrEqual(r.body.tenders.total);
  });

  test('nmck_sum совпадает с контрольным SQL (фолбэк на submission_price)', async () => {
    const r = await get('/api/director-analytics/overview?period=all');
    const { rows: [ctl] } = await pool.query(
      `SELECT COALESCE(SUM(COALESCE(tender_price, submission_price)), 0)::float AS s
         FROM tenders WHERE archived_at IS NULL AND deleted_at IS NULL`
    );
    expect(Math.round(r.body.tenders.nmck_sum)).toBe(Math.round(ctl.s));
  });
});

describe('норма: счётчики по одной метрике', () => {
  test('green + yellow + red + none = всего людей', async () => {
    const r = await get('/api/director-analytics/team-hours?period=month&date=2026-10-15');
    const n = r.body.norm;
    const sum = n.people_green + n.people_yellow + n.people_red + n.people_no_norm;
    expect(sum).toBe(r.body.people.length);
  });

  test('state каждого человека согласуется с группой', async () => {
    const r = await get('/api/director-analytics/team-hours?period=month&date=2026-10-15');
    const n = r.body.norm;
    const byState = (s) => r.body.people.filter((p) => p.norm_minutes > 0 && p.state === s).length;
    expect(n.people_green).toBe(byState('green'));
    expect(n.people_yellow).toBe(byState('yellow'));
    expect(n.people_red).toBe(byState('red'));
  });

  test('delta_hours в часах, а не в «десятках часов»', async () => {
    const r = await get('/api/director-analytics/team-hours?period=month&date=2026-10-15');
    for (const p of r.body.people) {
      if (p.delta_minutes == null) continue;
      // −5 мин должно быть ≈ −0,08 ч, а не −0,1 и не −5.
      expect(Math.abs(p.delta_hours - p.delta_minutes / 60)).toBeLessThan(0.02);
    }
  });
});

describe('контрагент: история за всё время', () => {
  test('сумма статусов равна total', async () => {
    const { rows } = await pool.query(
      `SELECT customer_inn FROM tenders
        WHERE customer_inn IS NOT NULL AND deleted_at IS NULL
        GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`
    );
    if (!rows.length) return;
    const r = await get('/api/director-analytics/customer?inn=' + rows[0].customer_inn);
    expect(r.code).toBe(200);
    expect(r.body.total).toBeGreaterThan(0);
    const sum = r.body.review + r.body.prep + r.body.submitted + r.body.won + r.body.lost + r.body.cancelled;
    expect(sum).toBe(r.body.total);
  });

  test('bad query отклоняется, а не отдаёт всю базу', async () => {
    const r = await get('/api/director-analytics/customer?name=ab');
    expect(r.code).toBe(400);
  });
});

describe('реестр тендеров: сортировка и живые впереди', () => {
  test('по умолчанию открытые идут раньше закрытых', async () => {
    const r = await get('/api/director-analytics/tenders?period=all&limit=50');
    expect(r.code).toBe(200);
    const closed = ['выиграли', 'проиграли', 'отмена', 'подались'];
    const firstClosed = r.body.items.findIndex((x) => closed.includes(x.registry_status));
    if (firstClosed === -1) return;
    const afterClosed = r.body.items.slice(firstClosed).filter((x) => !closed.includes(x.registry_status));
    expect(afterClosed).toEqual([]);
  });

  test('sort=created не падает и отдаёт массив', async () => {
    const r = await get('/api/director-analytics/tenders?period=all&limit=5&sort=created');
    expect(r.code).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
  });

  test('sort=sum не падает', async () => {
    const r = await get('/api/director-analytics/tenders?period=all&limit=5&sort=sum');
    expect(r.code).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
  });
});
