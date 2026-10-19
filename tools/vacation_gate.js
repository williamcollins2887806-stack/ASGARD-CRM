'use strict';
/**
 * СВОДНЫЙ ГЕЙТ модуля «График отпусков (офис)». Прогоняет все проверки и печатает итог.
 * Запуск: node tools/vacation_gate.js
 *
 * Требует клон-сервер (:3100 по умолчанию; переопределяется TEST_BASE_URL/CLONE_URL)
 * и БД asgard_crm_test.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
if (!process.env.TEST_BASE_URL) process.env.TEST_BASE_URL = process.env.CLONE_URL || 'http://127.0.0.1:3100';
if (!process.env.CLONE_URL) process.env.CLONE_URL = process.env.TEST_BASE_URL;

const SUITES = [
  { name: 'Правила отпусков (юнит, без БД)', cmd: ['tests/unit/vacation-rules.test.js'] },
  { name: 'API отпусков (клон)', cmd: ['tests/api/vacations.test.js'] },
  { name: 'Кнопки «Да/Нет» из письма', cmd: ['tests/api/vacation-decision.test.js'] },
  { name: 'Недельное присутствие (клон)', cmd: ['tests/api/presence-week.test.js'] },
  { name: 'Напоминания и автоснятие (клон)', cmd: ['tests/api/vacation-cron.test.js'] },
  { name: 'Документы Т-6 / Т-7 / заявление', cmd: ['tests/api/vacation-docs.test.js'] },
  { name: 'Визуал и сверка с рендером', cmd: ['tests/api/vacation-visual.test.js'] },
];

const results = [];
for (const s of SUITES) {
  process.stdout.write('\n══════ ' + s.name + ' ══════\n');
  let ok = true, tail = '';
  try {
    const out = execFileSync('node', s.cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    tail = out.trim().split('\n').slice(-1)[0] || '';
  } catch (e) {
    ok = false;
    const o = String((e.stdout || '') + (e.stderr || ''));
    const lines = o.trim().split('\n');
    tail = lines.filter((l) => /FAIL|FAILS/i.test(l)).slice(0, 6).join(' | ') || lines.slice(-1)[0] || 'падение';
  }
  results.push({ name: s.name, ok, tail });
  console.log((ok ? 'OK  ' : 'FAIL') + ' — ' + tail);
}

console.log('\n══════════════════════════════════════');
const failed = results.filter((r) => !r.ok);
results.forEach((r) => console.log((r.ok ? 'OK  ' : 'FAIL') + '  ' + r.name));
console.log('══════════════════════════════════════');
console.log(failed.length ? `ИТОГ: FAIL (${failed.length} из ${results.length})` : `ИТОГ: ВСЕ ${results.length} НАБОРОВ ЗЕЛЁНЫЕ`);
process.exit(failed.length ? 1 : 0);
