'use strict';
/**
 * Съёмка ИГР с авторизацией полевого рабочего (PIN 0000).
 * Игры доступны только из-под field_token, поэтому без логина они редиректят
 * на /field/welcome — прежние снимки игр были пустыми по этой причине.
 *
 * Запуск: node tools/shoot-field-games.js [--base=http://127.0.0.1:5173]
 * Выход:  prototypes/field-redesign/_shots/app/games/<theme>/<screen>.png
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}
const BASE = arg('base', 'http://127.0.0.1:5173');
const OUT = path.join(ROOT, 'prototypes', 'field-redesign', '_shots', 'app', 'games');
const DB = {
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || '123456789',
  database: arg('db', process.env.DB_NAME || 'asgard_crm_dev'),
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
};
/** Рабочий и PIN (заказчик: 9160614809 / 1488). */
const WORKER_PHONE = arg('phone', '9160614809');
const WORKER_PIN = arg('pin', '1488');

const SCREENS = [
  { key: 'chemlab', url: '/m/field/chemlab' },
  { key: 'pipeline', url: '/m/field/pipeline' },
  { key: 'wheel', url: '/m/field/wheel' },
];
const THEMES = ['dark', 'light'];

async function seedWorker() {
  const pool = new Pool(DB);
  try {
    const digits = String(WORKER_PHONE).replace(/\D/g, '').slice(-10);
    const emp = (await pool.query(`
      SELECT e.id, e.phone, e.fio, e.full_name, e.user_id
      FROM employees e
      WHERE e.is_active = true AND e.phone IS NOT NULL
        AND e.user_id IS NOT NULL
        AND regexp_replace(e.phone, '\\D', '', 'g') LIKE $1
      ORDER BY e.id ASC LIMIT 1`, ['%' + digits])).rows[0];
    if (!emp) throw new Error(`сотрудник по телефону ${WORKER_PHONE} с user_id не найден`);
    return { employee_id: emp.id, phone: emp.phone, user_id: emp.user_id, fio: emp.fio || emp.full_name, pin: WORKER_PIN };
  } finally {
    await pool.end();
  }
}

/** Авторизация: pin-login по employee_id, при неудаче — код из БД (как field-baseline-shots.js). */
async function fieldToken(fw) {
  const pinR = await fetch(`${BASE}/api/field/auth/pin-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id: fw.employee_id, pin: fw.pin }),
  });
  const pinD = await pinR.json().catch(() => ({}));
  if (pinR.ok && pinD.token) return pinD;

  await fetch(`${BASE}/api/field/auth/request-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: fw.phone }),
  });
  const pool = new Pool(DB);
  let code;
  try {
    code = (await pool.query(
      `SELECT code FROM field_auth_codes
       WHERE employee_id=$1 AND used=false AND expires_at>NOW()
       ORDER BY id DESC LIMIT 1`, [fw.employee_id])).rows[0]?.code;
  } finally { await pool.end(); }
  if (!code) throw new Error('нет кода в field_auth_codes');

  const vr = await fetch(`${BASE}/api/field/auth/verify-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: fw.phone, code }),
  }).then((r) => r.json());
  if (vr.status === 'need_pin_setup' && vr.token) {
    await fetch(`${BASE}/api/field/auth/setup-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vr.token}` },
      body: JSON.stringify({ pin: fw.pin }),
    });
    return fieldToken(fw);
  }
  if (!vr.token) throw new Error('verify-code: ' + JSON.stringify(vr).slice(0, 160));
  return vr;
}

async function main() {
  const worker = await seedWorker();
  console.log('worker:', worker.fio, worker.phone, 'pin=0000');
  fs.mkdirSync(OUT, { recursive: true });

  let auth;
  try {
    auth = await fieldToken(worker);
    console.log('auth: token получен, employee=', auth.employee?.fio || auth.employee?.full_name || '—');
  } catch (e) {
    console.error('FAIL авторизация:', String(e.message).slice(0, 200));
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const shots = [];

  for (const theme of THEMES) {
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      serviceWorkers: 'block',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    await ctx.addInitScript(({ a, t }) => {
      localStorage.setItem('asgard_theme', t);
      localStorage.setItem('asgard_theme_chosen', '1');
      localStorage.setItem('field_redesign_2026_seen', '1');
      if (a) {
        localStorage.setItem('field_auth_epoch', '6');
        localStorage.setItem('field_token', a.token);
        localStorage.setItem('field_employee', JSON.stringify(a.employee || {}));
        localStorage.setItem('field_has_pin', '1');
      }
    }, { a: auth, t: theme });

    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));

    for (const s of SCREENS) {
      try {
        await page.goto(BASE + s.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4500);
        const state = await page.evaluate(() => ({
          redirected: location.pathname,
          crash: document.body.innerText.includes('Что-то пошло не так'),
          canvas: document.querySelectorAll('canvas').length,
          theme: document.documentElement.className,
        }));
        const dir = path.join(OUT, theme);
        fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: path.join(dir, `${s.key}.png`) });
        shots.push({ theme, key: s.key, ...state, ok: true });
        console.log(`[${theme}] ${s.key}: url=${state.redirected} canvas=${state.canvas} theme="${state.theme}"${state.crash ? ' CRASH' : ''}`);
      } catch (e) {
        shots.push({ theme, key: s.key, ok: false, error: String(e.message).slice(0, 120) });
        console.log(`[${theme}] ${s.key}: FAIL ${String(e.message).slice(0, 90)}`);
      }
    }
    await ctx.close();
  }

  await browser.close();
  if (errors.length) console.log('pageerrors:', [...new Set(errors)].slice(0, 5));
  const redirected = shots.filter((s) => s.ok && String(s.redirected).includes('welcome')).length;
  console.log(`\nснимков: ${shots.filter((s) => s.ok).length}/${shots.length}; редиректов на вход: ${redirected}`);
  console.log('→', OUT);
  if (redirected > 0) { console.error('FAIL: часть игр недоступна (редирект на вход)'); process.exit(1); }
  console.log('OK — игры сняты под авторизацией');
}

main().catch((e) => { console.error(e); process.exit(1); });
