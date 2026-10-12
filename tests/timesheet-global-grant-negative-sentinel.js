/**
 * Sentinel (обратный): БЕЗ ключа в settings доступ НЕ появляется.
 * Прогон на КЛОНЕ (:3100). Доказывает, что грант персональный и исчезает
 * вместе с удалением ключа (кэш сброшен перезапуском процесса).
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
  const u = rows[0];
  return jwt.sign({ id: u.id, login: u.login, name: u.name, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' });
}
async function getJson(path, t) {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + t } });
  let body = null; try { body = await r.json(); } catch (_) {}
  return { status: r.status, body };
}
async function getRaw(path, t) {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + t } });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, head: buf.slice(0, 2).toString('hex') };
}

async function main() {
  const PUTKOV = 3465;
  console.log('=== Ключ отсутствует в settings ===');
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM settings WHERE key='timesheet_global_viewer_user_ids'");
  check('нет ключа гранта', rows[0].n === 0, rows);

  const t = await tokenFor(PUTKOV);
  const g = await getJson('/api/timesheet/v2/2026/10?mode=global', t);
  check('Путков БЕЗ гранта: mode не global (фолбэк pm)', g.body && g.body.mode !== 'global', g.body && g.body.mode);
  check('Путков БЕЗ гранта: view_profile=scoped', g.body && g.body.view_profile === 'scoped', g.body && g.body.view_profile);
  const xls = await getRaw('/api/timesheet/v2/2026/10/export?format=xlsx', t);
  check('Путков БЕЗ гранта: export 403', xls.status === 403, xls);
  const me = await getJson('/api/auth/me', t);
  check('Путков БЕЗ гранта: нет пермишена timesheet_global', !(me.body && me.body.user && me.body.user.permissions && me.body.user.permissions.timesheet_global), me.body && me.body.user && me.body.user.permissions);

  console.log(`\nИТОГО: PASS ${pass} / FAIL ${fail}`);
  process.exitCode = fail ? 1 : 0;
  try { await pool.end(); } catch (_) {}
  // Даём libuv закрыть сокеты без гонки (иначе на Windows — ложный assert).
  setTimeout(() => process.exit(process.exitCode), 150);
}
main().catch(async (e) => { console.error('CRASH', e); process.exit(1); });
