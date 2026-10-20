'use strict';

/**
 * D-316: негативный контроль — тест должен ЛОВИТЬ возврат дефекта.
 * ═══════════════════════════════════════════════════════════════════════════
 * Дефект был: POST /api/payment-invoices создавал заявку сразу в
 * 'awaiting_dir' и слал письмо директору. Проверяем, что если вернуть
 * `status='draft'` → `'awaiting_dir'` в INSERT, тест падает.
 *
 * Мутация делается на живом коде: правим src, поднимаем ОТДЕЛЬНЫЙ сервер
 * (:3102), гоняем тест с DH_BASE, гасим, восстанавливаем файл.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'src', 'routes', 'payment-invoices.js');
const PORT = 3102;
const orig = fs.readFileSync(FILE, 'utf8');
const norm = (s) => s.replace(/\r\n/g, '\n');

const GOOD = "         'draft', $1, $2, $3, $4, $5, $6,";
if (!norm(orig).includes(norm(GOOD))) {
  console.error('MUTATION: строка INSERT со статусом draft не найдена — тест устарел');
  process.exit(2);
}
// Возвращаем исторический дефект: сразу awaiting_dir.
const broken = norm(orig).replace(norm(GOOD), "         'awaiting_dir', $1, $2, $3, $4, $5, $6,");

const waitPort = (port, ms) => new Promise((resolve) => {
  const t0 = Date.now();
  const tick = () => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => { s.destroy(); if (Date.now() - t0 > ms) return resolve(false); setTimeout(tick, 600); });
  };
  tick();
});

(async () => {
  let child = null;
  let rc = 0;
  try {
    fs.writeFileSync(FILE, broken, 'utf8');
    console.log('=== мутация: создание сразу awaiting_dir (дефект) → сервер :' + PORT + ' ===');
    child = spawn(process.execPath, ['src/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env, PORT: String(PORT), DB_NAME: 'asgard_crm_test',
        DATABASE_URL: 'postgres://asgard:123456789@127.0.0.1:5432/asgard_crm_test',
        JWT_SECRET: process.env.JWT_SECRET || 'asgard-jwt-secret-2026', NODE_ENV: 'test'
      },
      stdio: 'ignore', windowsHide: true
    });
    const up = await waitPort(PORT, 90000);
    if (!up) { console.error('сервер не поднялся'); rc = 2; }
    else {
      console.log('=== тест на ДЕФЕКТНОМ коде (ожидаем FAIL) ===');
      try {
        execFileSync(process.execPath, [path.join(__dirname, 'payment-drafts.runtime.js')], {
          encoding: 'utf8', stdio: 'pipe',
          env: { ...process.env, DH_BASE: 'http://127.0.0.1:' + PORT }
        });
        console.log('ПРОБЛЕМА: тест прошёл на дефектном коде — он НЕ ловит мгновенную отправку');
        rc = 1;
      } catch (e) {
        const out = String(e.stdout || '') + String(e.stderr || '');
        console.log(out.split('\n').filter((l) => /FAIL|ИТОГ/.test(l)).join('\n'));
        const caught = /FAIL/.test(out);
        console.log(caught ? 'OK: тест поймал дефект' : 'ВНИМАНИЕ: дефект не пойман');
        rc = caught ? 0 : 1;
      }
    }
  } finally {
    if (child) { try { child.kill('SIGKILL'); } catch (_) {} }
    fs.writeFileSync(FILE, orig, 'utf8');
    console.log('файл восстановлен, :' + PORT + ' погашен');
  }
  process.exit(rc);
})();
