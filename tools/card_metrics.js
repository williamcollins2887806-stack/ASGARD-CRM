#!/usr/bin/env node
'use strict';
/**
 * card_metrics.js — эталон метрик карточки тендера.
 *
 * Это ЕДИНСТВЕННЫЙ критерий «стало лучше или хуже» при правках Мимира.
 * Печатает 12 чисел по карточке: сколько позиций, у скольких есть норма,
 * кратность, геометрия, и сходятся ли trip_count в трёх местах.
 *
 * Зачем: без этого «проверка» превращается в «вроде работает». 12.11.2026
 * три прогона подряд дали 675 → 115 → 255 → 658 позиций, и понять, стало
 * лучше или хуже, можно было только вручную считая по БД.
 *
 * Запуск (на проде, из каталога приложения):
 *   DB_PASSWORD=... node tools/card_metrics.js --tender=2138
 *   DB_PASSWORD=... node tools/card_metrics.js --tender=2138 --json
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));

const arg = process.argv.find((a) => /^--tender=/.test(a));
const TENDER = arg ? Number(String(arg).split('=')[1]) : Number(process.env.TENDER_ID) || 2138;
const AS_JSON = process.argv.includes('--json');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || '123456789',
  database: process.env.DB_NAME || 'asgard_crm',
  max: 2
});

function metrics(rj) {
  const pos = Array.isArray(rj.dv_positions) ? rj.dv_positions : [];
  const cp = rj.calc_plan && typeof rj.calc_plan === 'object' ? rj.calc_plan : {};
  const vp = rj.visit_plan && typeof rj.visit_plan === 'object' ? rj.visit_plan : {};
  const sm = rj.asgard_smeta && typeof rj.asgard_smeta === 'object' ? rj.asgard_smeta : {};
  const totals = sm.totals || {};
  const params = sm.params || {};

  const conv = (p) => (p && p.conversion_params) || {};
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

  return {
    positions: pos.length,
    with_volume: pos.filter((p) => num(p.volume) > 0).length,
    with_mh: pos.filter((p) => num(p.mh) > 0).length,
    with_clean_count: pos.filter((p) => num(p.clean_count) > 0).length,
    with_tubes: pos.filter((p) => num(p.tubes) > 0 || num(conv(p).tubes) > 0).length,
    with_length_m: pos.filter((p) => num(conv(p).length_m) > 0 || num(p.length_m) > 0).length,
    with_dn_mm: pos.filter((p) => num(conv(p).dn_mm) > 0).length,
    work_days: num(cp.work_days) || num(totals.work_days) || null,
    trip_plan: num(vp.trip_count) || null,
    trip_calc: num(cp.trip_count) || null,
    trip_smeta: num(params.trip_count) || null,
    trips_agree: (() => {
      const vals = [
        num(vp.trip_count) || null,
        num(cp.trip_count) || null,
        num(params.trip_count) || null
      ].filter((x) => x != null);
      return vals.length >= 2 && vals.every((x) => x === vals[0]);
    })(),
    incomplete: rj.dv_incomplete === true,
    cost: Math.round(num(totals.cost)) || null,
    price_no_vat: Math.round(num(totals.price_no_vat)) || null
  };
}

(async () => {
  const q = await pool.query(
    'SELECT id, report_json, updated_at FROM tender_rp_reviews '
    + 'WHERE tender_id = $1 ORDER BY id DESC LIMIT 1', [TENDER]);
  if (!q.rows[0]) {
    console.log(`нет карточки по тендеру ${TENDER}`);
    await pool.end();
    process.exit(1);
  }
  const rj = q.rows[0].report_json || {};
  const m = metrics(rj);
  m.tender = TENDER;
  m.review_id = q.rows[0].id;
  m.updated_at = q.rows[0].updated_at;
  m.at = new Date().toISOString();

  if (AS_JSON) {
    console.log(JSON.stringify(m, null, 1));
    await pool.end();
    return;
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`# карточка ${TENDER} (review ${m.review_id}, обновлена ${m.updated_at})`);
  console.log('');
  console.log(pad('позиций', 26) + m.positions);
  console.log(pad('с объёмом', 26) + m.with_volume);
  console.log(pad('с нормой (mh)', 26) + m.with_mh);
  console.log(pad('с clean_count', 26) + m.with_clean_count);
  console.log(pad('с tubes', 26) + m.with_tubes);
  console.log(pad('с length_m', 26) + m.with_length_m);
  console.log(pad('с dn_mm', 26) + m.with_dn_mm);
  console.log(pad('work_days', 26) + (m.work_days == null ? '—' : m.work_days));
  console.log(pad('trip_count: план', 26) + (m.trip_plan == null ? '—' : m.trip_plan));
  console.log(pad('trip_count: расчёт', 26) + (m.trip_calc == null ? '—' : m.trip_calc));
  console.log(pad('trip_count: смета', 26) + (m.trip_smeta == null ? '—' : m.trip_smeta));
  console.log(pad('trip_count сходится', 26) + (m.trips_agree ? 'да' : 'НЕТ'));
  console.log(pad('incomplete', 26) + (m.incomplete ? 'ДА' : 'нет'));
  console.log(pad('себестоимость', 26) + (m.cost == null ? '—' : m.cost));
  console.log(pad('цена без НДС', 26) + (m.price_no_vat == null ? '—' : m.price_no_vat));
  await pool.end();
})().catch(async (e) => {
  console.log('FAIL', e.message);
  try { await pool.end(); } catch (_) { /* уже закрыт */ }
  process.exit(1);
});
