'use strict';
/**
 * Проверка отката ручной правки часов (FAIL верификатора 05.11.2026):
 * /adjust с minutes:null обязан вернуть office_minutes из проходов СКУД,
 * а не оставить часы правки навсегда.
 */
const path = require('path');
const Fastify = require('fastify');
const { Pool } = require('pg');

const DB = process.env.PGDATABASE || 'asgard_crm_test';

(async () => {
  const pool = new Pool({
    user: 'asgard', password: '123456789', database: DB, host: '127.0.0.1', port: 5432, max: 2
  });
  const fastify = Fastify({ logger: false });
  fastify.decorate('db', pool);
  fastify.decorate('authenticate', async () => {});
  fastify.decorate('requireRoles', () => async () => {});
  fastify.decorateRequest('user', null);
  fastify.addHook('onRequest', async (req) => { req.user = { id: 1, role: 'ADMIN' }; });
  await fastify.register(require(path.join(__dirname, '..', '..', 'src/routes/office-attendance')), {
    prefix: '/api/office-attendance'
  });
  await fastify.ready();

  // Берём реальный день с проходами СКУД.
  const { rows } = await pool.query(
    `SELECT staff_id, date::text AS date, office_minutes, segments
       FROM office_hours_daily
      WHERE jsonb_array_length(segments) > 0 AND office_minutes > 0
      ORDER BY date DESC LIMIT 1`
  );
  if (!rows.length) {
    console.log('SKIP: нет дней с segments — нечего проверять');
    await fastify.close(); await pool.end();
    return;
  }
  const day = rows[0];
  const before = Number(day.office_minutes);
  const segSum = (day.segments || []).reduce((a, s) => a + (Number(s.minutes) || 0), 0);
  console.log('день:', day.staff_id, day.date, 'office_minutes до:', before, 'сумма segments:', segSum);

  const put = (minutes) => fastify.inject({
    method: 'PUT',
    url: '/api/office-attendance/adjust',
    payload: { staff_id: day.staff_id, date: day.date, minutes, reason: 'тест отката правки' }
  });

  const setRes = await put(300);
  const setBody = JSON.parse(setRes.payload);
  console.log('правка 300 ->', setRes.statusCode, JSON.stringify(setBody).slice(0, 120));
  let cur = (await pool.query(
    `SELECT office_minutes, manual_minutes FROM office_hours_daily WHERE staff_id=$1 AND date=$2::date`,
    [day.staff_id, day.date]
  )).rows[0];
  console.log('после правки:', JSON.stringify(cur));

  const clearRes = await put(null);
  console.log('откат minutes:null ->', clearRes.statusCode);
  cur = (await pool.query(
    `SELECT office_minutes, manual_minutes, manual_reason FROM office_hours_daily WHERE staff_id=$1 AND date=$2::date`,
    [day.staff_id, day.date]
  )).rows[0];
  console.log('после отката:', JSON.stringify(cur));

  const restored = Number(cur.office_minutes);
  const ok = cur.manual_minutes === null && restored === segSum && restored === before;
  console.log(ok
    ? `PASS: часы восстановлены из проходов (${restored} = ${segSum}), manual снят`
    : `FAIL: ожидалось ${before} (= ${segSum}), получено ${restored}, manual=${cur.manual_minutes}`);

  await fastify.close();
  await pool.end();
  if (!ok) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
