#!/usr/bin/env node
'use strict';

/**
 * Прогон всех статических/поведенческих гейтов из аудита логов 14–20.10.2026
 * (D-307…D-312) одной командой.
 *
 * Зачем отдельный скрипт, а не tests/runner.js: runner поднимает БД и Playwright
 * (api/e2e/scenarios), а эти гейты — чисто локальные и должны гоняться на любом
 * шаге, включая pre-deploy. Подключение: `npm run verify:guards` и строка в
 * pre-deploy чеклисте.
 *
 * Выход: 0 — все зелёные, 1 — хотя бы один красный.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const GUARDS = [
  // D-307: двойной ответ Fastify (async onSend + send без return)
  ['tests/fastify-onsend-guard.test.js', 'ONSEND_GUARD_OK'],
  // D-308: типизация SQL-параметров + полнота списка миграций
  ['tests/sql-cast-guard.test.js', 'SQL_CAST_GUARD_OK'],
  // D-309: смерть токена не превращается в вечный реконнект
  ['tests/huginn-sse-401.test.js', 'HUGINN_SSE_401_OK'],
  // D-310: PWA-ассеты резолвятся с вложенных роутов /m/
  ['tools/verify_mobile_pwa_assets.js', 'MOBILE_PWA_ASSETS_OK'],
  // D-312: LogMonitor видит ошибки приложения, а не только systemd
  ['tests/log-monitor-sight.test.js', 'LOG_MONITOR_SIGHT_OK'],
];

let failed = 0;
for (const [rel, marker] of GUARDS) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [path.join(ROOT, rel)], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const okMarker = out.includes(marker);
  const code = res.status;
  const ms = Date.now() - started;
  if (code === 0 && okMarker) {
    console.log(`PASS  ${rel}  (${ms}ms)`);
  } else {
    failed += 1;
    console.log(`FAIL  ${rel}  (exit=${code}, маркер ${okMarker ? 'есть' : 'НЕТ'}, ${ms}ms)`);
    const tail = out.trim().split('\n').slice(-12).join('\n');
    if (tail) console.log(tail.replace(/^/gm, '      '));
  }
}

console.log(`\nгейтов: ${GUARDS.length}, провалов: ${failed}`);
if (failed) {
  console.log('GUARDS_FAILED');
  process.exit(1);
}
console.log('GUARDS_OK');
