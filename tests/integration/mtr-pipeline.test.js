'use strict';
/**
 * Сквозная проверка МТР: РП сохраняет техплан → /tenders/:id отдаёт mtr.
 * Проверяем, что цепочка записи и чтения сходится на клоне.
 */
const path = require('path');
const Fastify = require('fastify');
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ user: 'asgard', password: '123456789', database: 'asgard_crm_test', host: '127.0.0.1', port: 5432, max: 3 });

  // Берём реальный открытый тендер с просчётом.
  const { rows: [t] } = await pool.query(`
    SELECT tr.id AS review_id, tr.tender_id, tr.tech_json
      FROM tender_rp_reviews tr
      JOIN tenders t ON t.id = tr.tender_id
     WHERE t.archived_at IS NULL AND t.deleted_at IS NULL
     ORDER BY tr.id DESC LIMIT 1`);
  if (!t) { console.log('SKIP: нет просчётов'); await pool.end(); return; }
  console.log('тендер:', t.tender_id, 'просчёт:', t.review_id);

  const before = await pool.query(`SELECT tech_json FROM tender_rp_reviews WHERE id=$1`, [t.review_id]);
  const snapshot = before.rows[0].tech_json;

  // 1. Пишем техплан напрямую в БД (как это делает PUT просчёта).
  const testMtr = [
    { name: 'АВД 500', qty: 2, unit: 'шт', source: 'склад' },
    { name: 'Шланг ВД', qty: 40, unit: 'м', source: 'закупка' },
  ];
  await pool.query(
    `UPDATE tender_rp_reviews
        SET tech_json = $2::jsonb, updated_at = NOW()
      WHERE id = $1`,
    [t.review_id, JSON.stringify({ mtr: testMtr, crew: [{ role: 'Оператор', count: 2 }], filled_by: 'rp' })]
  );

  // 2. Читаем через API.
  const f = Fastify({ logger: false });
  f.decorate('db', pool);
  f.decorate('authenticate', async () => {});
  f.decorate('requireRoles', () => async () => {});
  f.decorateRequest('user', null);
  f.addHook('onRequest', async (r) => { r.user = { id: 1, role: 'ADMIN' }; });
  await f.register(require(path.join(__dirname, '..', '..', 'src/routes/director-analytics')), { prefix: '/api/director-analytics' });
  await f.ready();

  const res = await f.inject({ method: 'GET', url: '/api/director-analytics/tenders/' + t.tender_id });
  const body = JSON.parse(res.payload);
  const tp = body.rp_review && body.rp_review.tech_plan;
  console.log('API tech_plan:', JSON.stringify(tp));
  console.log('mtr rows:', tp ? tp.mtr.length : 'нет rp_review');
  const ok = tp && tp.mtr.length === 2 && tp.mtr[0].name === 'АВД 500' && tp.crew.length === 1;
  console.log(ok ? 'PASS: сохранённый МТР доходит до вкладки' : 'FAIL: МТР не дошёл');

  // 3. Возвращаем как было.
  await pool.query(`UPDATE tender_rp_reviews SET tech_json = $2::jsonb WHERE id = $1`,
    [t.review_id, JSON.stringify(snapshot || {})]);
  console.log('откат выполнен');

  await f.close();
  await pool.end();
  if (!ok) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
