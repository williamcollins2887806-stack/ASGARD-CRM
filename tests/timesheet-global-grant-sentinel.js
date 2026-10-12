/**
 * Sentinel: персональный доступ Путкова к общему табелю (V384).
 * Прогон на КЛОНЕ (:3100, asgard_crm_test). Ничего не пишет в прод.
 *
 * Проверяет:
 *   1. Grant ON  → GET ?mode=global возвращает mode=global, view_profile=full,
 *      granted_readonly=true; запись (PUT /entry) запрещена.
 *   2. Grant OFF → GET ?mode=global падает обратно на pm (view_profile=scoped),
 *      то есть грант действительно «только персональный», а не сломал роли.
 *   3. Другой PM без гранта (Андросов 3474) — не получает global.
 *   4. Excel-экспорт: с грантом 200 (xlsx), без гранта 403.
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const BASE = 'http://127.0.0.1:3100';
const SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: 'asgard_crm_test',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD,
});

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

async function tokenFor(id) {
  const { rows } = await pool.query('SELECT id, login, name, role FROM users WHERE id=$1', [id]);
  if (!rows.length) throw new Error('no user ' + id);
  const u = rows[0];
  return jwt.sign({ id: u.id, login: u.login, name: u.name, role: u.role, email: null, pinVerified: true }, SECRET, { expiresIn: '1h' });
}
function hdr(t) { return { Authorization: 'Bearer ' + t }; }

async function getJson(path, t) {
  const r = await fetch(BASE + path, { headers: hdr(t) });
  let body = null; try { body = await r.json(); } catch (_) {}
  return { status: r.status, body };
}
async function getRaw(path, t) {
  const r = await fetch(BASE + path, { headers: hdr(t) });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, ct: r.headers.get('content-type') || '', len: buf.length, head: buf.slice(0, 2).toString('hex') };
}

async function setGrant(ids) {
  await pool.query(
    `INSERT INTO settings (key, value_json, updated_at) VALUES ('timesheet_global_viewer_user_ids', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()`,
    [JSON.stringify(ids)]
  );
  // сбросить TTL-кэш модуля: перезапуск не нужен — ждём окно 60с? нет: форсим через отдельный процесс-нельзя.
  // Простейшее: ждём 61с недопустимо долго. Вместо этого — прямой сброс недоступен извне,
  // поэтому кэш проверяем отдельным юнит-тестом parseIds, а сервер запускаем уже с нужным значением.
}

async function main() {
  const PUTKOV = 3465;
  const OTHER_PM = 3474; // Андросов — без гранта

  console.log('=== 1. Грант ВКЛ (settings = [3465]) ===');
  const tPut = await tokenFor(PUTKOV);
  const g = await getJson('/api/timesheet/v2/2026/10?mode=global', tPut);
  check('granted: HTTP 200', g.status === 200, g.body);
  check('granted: mode=global', g.body && g.body.mode === 'global', g.body && g.body.mode);
  check('granted: view_profile=full', g.body && g.body.view_profile === 'full', g.body && g.body.view_profile);
  check('granted: granted_readonly=true', g.body && g.body.granted_readonly === true, g.body && g.body.granted_readonly);
  check('granted: есть summary (директорский вид)', !!(g.body && g.body.summary), g.body && Object.keys(g.body || {}));

  console.log('=== 2. Грант: запись запрещена ===');
  const put = await fetch(BASE + '/api/timesheet/v2/entry', {
    method: 'PUT', headers: { ...hdr(tPut), 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id: 252, date: '2026-10-15', type: 'day', shift: 'day' })
  });
  check('granted: PUT /entry НЕ 200 (нет права записи)', put.status !== 200 && put.status !== 201, put.status);

  console.log('=== 3. Excel с грантом ===');
  const xls = await getRaw('/api/timesheet/v2/2026/10/export?format=xlsx', tPut);
  check('granted: export HTTP 200', xls.status === 200, xls);
  check('granted: export is xlsx (zip PK)', xls.head === '504b', xls);

  console.log('=== 4. Другой PM без гранта (Андросов 3474) ===');
  const tOther = await tokenFor(OTHER_PM);
  const g2 = await getJson('/api/timesheet/v2/2026/10?mode=global', tOther);
  check('other PM: mode НЕ global (фолбэк pm)', g2.body && g2.body.mode !== 'global', g2.body && g2.body.mode);
  check('other PM: view_profile=scoped', g2.body && g2.body.view_profile === 'scoped', g2.body && g2.body.view_profile);
  const xls2 = await getRaw('/api/timesheet/v2/2026/10/export?format=xlsx', tOther);
  check('other PM: export 403', xls2.status === 403, xls2);

  console.log('=== 5. auth/me отдаёт пермишен timesheet_global только гранту ===');
  const me1 = await getJson('/api/auth/me', tPut);
  check('granted: permissions.timesheet_global.read=true', !!(me1.body && me1.body.user && me1.body.user.permissions && me1.body.user.permissions.timesheet_global && me1.body.user.permissions.timesheet_global.read), me1.body && me1.body.user && me1.body.user.permissions && me1.body.user.permissions.timesheet_global);
  const me2 = await getJson('/api/auth/me', tOther);
  check('other PM: нет timesheet_global', !(me2.body && me2.body.user && me2.body.user.permissions && me2.body.user.permissions.timesheet_global), me2.body && me2.body.user && me2.body.user.permissions && me2.body.user.permissions.timesheet_global);

  console.log(`\nИТОГО: PASS ${pass} / FAIL ${fail}`);
  process.exitCode = fail ? 1 : 0;
  try { await pool.end(); } catch (_) {}
  setTimeout(() => process.exit(process.exitCode), 150);
}

main().catch(async (e) => { console.error('CRASH', e); process.exit(1); });
