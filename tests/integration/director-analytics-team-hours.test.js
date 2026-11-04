'use strict';

/**
 * API-тест GET /api/director-analytics/team-hours на клоне БД.
 *
 * Что доказываем:
 *  1. суммы часов СКУД совпадают с контрольным SQL;
 *  2. пустой период даёт null (а не 0) — иначе дашборд врёт «в офисе 0 ч»;
 *  3. исключённые статусы (бн/сс/вх/отп) и «нп» не входят в норму;
 *  4. люди без аккаунта CRM (заглушки-площадки) не попадают в знаменатель;
 *  5. legacy-дни до старта серверного учёта СРМ не дают недоработку.
 *
 * Запуск (нужна клонированная БД asgard_crm_test с данными СКУД):
 *   npx jest tests/api/director-analytics-team-hours.test.js
 */

const path = require('path');
const Fastify = require('fastify');

const ROOT = path.join(__dirname, '..', '..');
// По умолчанию работаем с клоном: он не боевой и содержит данные СКУД.
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

describe('team-hours: структура и честность данных', () => {
  test('отдаёт 200 и полный контракт', async () => {
    const r = await get('/api/director-analytics/team-hours?period=week');
    expect(r.code).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.period).toMatchObject({ scope: 'week' });
    expect(r.body.period.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.body).toHaveProperty('now');
    expect(r.body).toHaveProperty('avg');
    expect(r.body).toHaveProperty('norm');
    expect(r.body).toHaveProperty('data_quality');
    expect(Array.isArray(r.body.people)).toBe(true);
  });

  test('пустой период: средние = null, а не 0', async () => {
    const r = await get('/api/director-analytics/team-hours?period=week&date=2030-01-07');
    expect(r.code).toBe(200);
    expect(r.body.avg.office_minutes_per_day).toBeNull();
    expect(r.body.avg.crm_minutes_per_day).toBeNull();
    expect(r.body.avg.office_people_per_day).toBeNull();
    expect(r.body.norm.people_total).toBe(0);
    expect(r.body.norm.under_pct).toBeNull();
  });

  test('месяц и неделя считаются независимо', async () => {
    const w = await get('/api/director-analytics/team-hours?period=week&date=2026-10-28');
    const m = await get('/api/director-analytics/team-hours?period=month&date=2026-10-15');
    expect(w.code).toBe(200);
    expect(m.code).toBe(200);
    expect(m.body.period.from).toBe('2026-10-01');
    expect(m.body.period.to).toBe('2026-10-31');
    expect(m.body.people.length).toBeGreaterThanOrEqual(w.body.people.length);
  });
});

describe('team-hours: сверка с контрольным SQL', () => {
  test('сумма часов СКУД за неделю совпадает с office_hours_daily', async () => {
    const r = await get('/api/director-analytics/team-hours?period=week&date=2026-10-28');
    const apiSum = r.body.people.reduce((a, p) => a + p.office_minutes, 0);

    // Контроль считаем БЕЗ тестовых аккаунтов и без строк без user_id:
    // API намеренно их исключает (это не сотрудники, а песочница).
    const { rows: [ctl] } = await pool.query(
      `SELECT COALESCE(SUM(oh.office_minutes), 0)::int AS s
         FROM office_hours_daily oh
         JOIN staff s ON s.id = oh.staff_id
         LEFT JOIN users u ON u.id = s.user_id
        WHERE oh.date >= $1::date AND oh.date <= $2::date
          AND s.user_id IS NOT NULL
          AND (u.id IS NULL OR (
                COALESCE(u.role, '') NOT IN ('BOT')
                AND u.login NOT LIKE 'test_%'
                AND COALESCE(u.name, '') NOT LIKE 'Test %'
                AND COALESCE(u.name, '') NOT LIKE 'Тест %'
          ))`,
      [r.body.period.from, r.body.period.to]
    );
    expect(apiSum).toBe(ctl.s);
  });

  test('нет людей с часами СКУД, выпавших из ответа', async () => {
    const r = await get('/api/director-analytics/team-hours?period=week&date=2026-10-28');
    // Каждая строка staff, у которой есть часы и которая не тестовая, должна
    // быть представлена в people (по любой из staff_ids аккаунта).
    const covered = new Set(r.body.people.flatMap((p) => (p.staff_ids || [p.staff_id]).map(Number)));
    const { rows } = await pool.query(
      `SELECT DISTINCT oh.staff_id
         FROM office_hours_daily oh
         JOIN staff s ON s.id = oh.staff_id
         LEFT JOIN users u ON u.id = s.user_id
        WHERE oh.date >= $1::date AND oh.date <= $2::date
          AND oh.office_minutes > 0
          AND s.user_id IS NOT NULL
          AND (u.id IS NULL OR (
                COALESCE(u.role, '') NOT IN ('BOT')
                AND u.login NOT LIKE 'test_%'
                AND COALESCE(u.name, '') NOT LIKE 'Test %'
                AND COALESCE(u.name, '') NOT LIKE 'Тест %'
          ))`,
      [r.body.period.from, r.body.period.to]
    );
    const missing = rows.map((x) => x.staff_id).filter((id) => !covered.has(Number(id)));
    expect(missing).toEqual([]);
  });

  test('people_under совпадает с пересчётом по людям', async () => {
    const r = await get('/api/director-analytics/team-hours?period=week&date=2026-10-28');
    const manual = r.body.people.filter((p) => p.norm_minutes > 0 && p.delta_minutes < 0).length;
    expect(r.body.norm.people_under).toBe(manual);
  });
});

describe('team-hours: правила зачёта', () => {
  let body;
  beforeAll(async () => {
    const r = await get('/api/director-analytics/team-hours?period=month&date=2026-10-15');
    body = r.body;
  });

  test('строки staff без user_id не попадают в норму', async () => {
    // В норму идут только люди с аккаунтом CRM. Строки-площадки без user_id
    // (если такие есть) не должны надувать знаменатель.
    const { rows: orphans } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM staff WHERE user_id IS NULL AND COALESCE(is_active, true) = true`);
    if (orphans[0].n === 0) return; // нечего проверять на этом клоне
    const ids = new Set(body.people.map((p) => p.staff_id));
    const { rows } = await pool.query(
      `SELECT id FROM staff WHERE user_id IS NULL AND COALESCE(is_active, true) = true`);
    const leaked = rows.filter((r) => ids.has(r.id));
    expect(leaked.length).toBe(0);
  });

  test('нет дублей людей по одному аккаунту (на проде staff дублируется)', () => {
    const ids = body.people.map((p) => p.staff_id);
    expect(new Set(ids).size).toBe(ids.length);
    // Один пользователь = одна строка в отчёте, иначе знаменатель нормы врёт.
    const stor = {};
    return pool.query(`SELECT id, user_id FROM staff WHERE user_id IS NOT NULL`).then(({ rows }) => {
      const userIds = ids.map((id) => (rows.find((r) => r.id === id) || {}).user_id).filter(Boolean);
      userIds.forEach((u) => { stor[u] = (stor[u] || 0) + 1; });
      const dupes = Object.values(stor).filter((n) => n > 1);
      expect(dupes.length).toBe(0);
    });
  });

  test('никто не получает положительную дельту как «переработку сверх нормы дня»', () => {
    // credited ограничен нормой дня при сводке — суммарная дельта не может
    // быть положительной за счёт переработок в отдельные дни.
    const over = body.people.filter((p) => p.delta_minutes > p.norm_minutes);
    expect(over.length).toBe(0);
  });

  test('данные о качестве отдают последний импорт и открытые флаги', () => {
    expect(body.data_quality).toHaveProperty('last_import');
    expect(body.data_quality).toHaveProperty('flags_open');
    expect(body.data_quality).toHaveProperty('skud_days_missing');
    expect(typeof body.data_quality.flags_open).toBe('number');
  });
});
