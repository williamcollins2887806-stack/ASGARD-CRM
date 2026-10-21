'use strict';

/**
 * D-318: негативный контроль рантайм-теста графика оплат.
 * ═══════════════════════════════════════════════════════════════════════════
 * Возвращаем исторический дефект (отдельный массив для visibilitySql) и
 * убеждаемся, что тест ПАДАЕТ. Иначе «36 запросов 200» ничего не доказывает:
 * ровно так же было зелено, когда прод отдавал 503.
 *
 * Мутация ПРАВИТ ФАЙЛ (сервер читает исходник при старте), затем поднимает
 * отдельный инстанс на :3103 и восстанавливает файл.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'src', 'routes', 'doc-registry.js');
const PORT = 3103;
const orig = fs.readFileSync(FILE, 'utf8');
const norm = (s) => s.replace(/\r\n/g, '\n');

const GOOD = "    const vis = visibilitySql(p, req.user.role, req.user.id, { scope: 'all' });";
// ТОЧНАЯ копия исторического дефекта: отдельный массив для visibilitySql.
// ВАЖНО: вместе с этим убираем и `p.push(req.user.id)` из D-318b — иначе
// параметр существует и Postgres не падает (мой первый мутант был невалиден:
// тест «проходил» на мутанте, потому что дефект был замаскирован).
const GOOD_LINK = "    if (vis) {\n      p.push(req.user.id);";
const BAD_LINK = "    if (vis) {\n      // мутация: параметр не добавлен";
const BAD = "    const visParams = [];\n" +
  "    const vis = visibilitySql(visParams, req.user.role, req.user.id, { scope: 'all' });";

if (!norm(orig).includes(norm(GOOD))) {
  console.error('MUTATION: строка фикса не найдена — тест устарел');
  process.exit(2);
}
if (!norm(orig).includes(norm(GOOD_LINK))) {
  console.error('MUTATION: блок D-318b не найден — обновите мутант');
  process.exit(2);
}
let broken = norm(orig).replace(norm(GOOD), norm(BAD));
broken = broken.replace(norm(GOOD_LINK), norm(BAD_LINK));
// И убираем сам плейсхолдер, чтобы SQL гарантированно ссылался на $1 (статусы).
broken = broken.replace(
  "OR (d.id IS NULL AND pi.created_by = $", "OR (d.id IS NULL AND pi.created_by = 1 /* мутация */ AND 1=$"
);

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
    console.log('=== мутация: separate visParams (дефект) → сервер :' + PORT + ' ===');
    child = spawn(process.execPath, ['src/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env, PORT: String(PORT), DB_NAME: 'asgard_crm_test',
        DATABASE_URL: 'postgres://asgard:123456789@127.0.0.1:5432/asgard_crm_test',
        JWT_SECRET: process.env.JWT_SECRET || 'asgard-jwt-secret-2026', NODE_ENV: 'test'
      },
      stdio: 'ignore', windowsHide: true
    });
    const up = await waitPort(PORT, 120000);
    if (!up) { console.error('сервер не поднялся'); rc = 2; }
    else {
      console.log('=== тест на ДЕФЕКТНОМ коде (ожидаем FAIL) ===');
      try {
        execFileSync(process.execPath, [path.join(__dirname, 'payment-schedule.runtime.js')], {
          encoding: 'utf8', stdio: 'pipe',
          env: { ...process.env, DH_BASE: 'http://127.0.0.1:' + PORT }
        });
        console.log('ПРОБЛЕМА: тест прошёл на дефектном коде — он НЕ ловит 503');
        rc = 1;
      } catch (e) {
        const out = String(e.stdout || '') + String(e.stderr || '');
        console.log(out.split('\n').filter((l) => /FAIL|ИТОГ/.test(l)).slice(0, 6).join('\n'));
        const caught = /FAIL/.test(out) && /50[03]/.test(out);
        console.log(caught ? 'OK: тест поймал 503 на дефектном коде' : 'ВНИМАНИЕ: 503 не пойман');
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
