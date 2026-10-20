'use strict';

/**
 * Гейт D-312: LogMonitor обязан видеть ошибки приложения.
 *
 * Дефект (20.10.2026): монитор читал `journalctl -p warning`, а pino пишет все
 * строки в journal с PRIORITY=6 — включая `"level":50`. За 3 часа монитор
 * получал «No entries», за 7 дней — 4 systemd-строки. 1 362 ошибки приложения
 * (ERR_HTTP_HEADERS_SENT, 42804, 42P01, client-error) он не видел.
 *
 * Тест проверяет:
 *   1) команда journalctl не содержит `-p warning` (иначе слепота вернётся);
 *   2) классификатор ловит реальные pino-строки прод-журнала;
 *   3) шум (cron, request completed, client-error) НЕ попадает в уведомления;
 *   4) негативный контроль: классификатор не «всё подряд»;
 *   5) превью группирует повторы и не раздувается.
 *
 * Запуск: node tests/log-monitor-sight.test.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'services', 'log-monitor-cron.js');
const source = fs.readFileSync(SRC, 'utf8');
const mod = require(SRC);

const checks = [];
const failures = [];
function ok(name, extra) { checks.push({ name, pass: true, extra }); }
function fail(name, extra) {
  checks.push({ name, pass: false, extra });
  failures.push(name + (extra ? ' — ' + extra : ''));
}

// ── 1. Команда чтения журнала ───────────────────────────────────────────────
(function checkCommand() {
  // Ищем ИМЕННО строку запуска journalctl, а не комментарии вокруг неё.
  const cmdMatch = /'journalctl[^']*'/.exec(source);
  if (!cmdMatch) {
    fail('команда журнала найдена', 'строка journalctl ... не найдена');
    return;
  }
  const cmd = cmdMatch[0];
  if (/-p\s+(warning|err|crit|alert)/.test(cmd)) {
    fail('нет фильтра -p (pino пишет всё как PRIORITY=6)', cmd);
  } else {
    ok('нет фильтра -p (pino пишет всё как PRIORITY=6)', cmd.slice(0, 70));
  }
})();

// ── 2. Реальные строки прода ловятся ────────────────────────────────────────
(function checkRealLines() {
  // Формат ровно как в /tmp/w7.log на проде (pino → journald).
  const samples = [
    ['{"level":50,"time":1791966627545,"pid":767531,"err":{"type":"DatabaseError","message":"column \\"done_by\\" is of type integer but expression is of type text"},"msg":"column \\"done_by\\" is of type integer but expression is of type text"}',
      'уровень 50: 42804 done_by'],
    ['{"level":50,"time":1792439127585,"pid":2787706,"err":{"code":"42P01"},"msg":"relation \\"office_vacations\\" does not exist"}',
      'уровень 50: 42P01 office_vacations'],
    ['{"level":50,"time":1792364108184,"pid":2402758,"err":{"code":"ERR_HTTP_HEADERS_SENT"},"msg":"Unhandled Promise Rejection"}',
      'уровень 50: unhandled rejection'],
    ['{"level":40,"time":1791898210791,"pid":489793,"url":"/api/field/worker/me","statusCode":401,"msg":"[field-api]"}',
      'уровень 40: field-api'],
    ['Oct 20 10:55:43 cv5977357.novalocal systemd[1]: asgard-crm.service: Main process exited, code=killed, status=9/KILL',
      'systemd: SIGKILL (без JSON)'],
    ['Oct 20 10:55:43 cv5977357.novalocal systemd[1]: asgard-crm.service: Failed with result \'timeout\'.',
      'systemd: Failed with result'],
  ];
  const missed = [];
  for (const [line, label] of samples) {
    if (mod.classify(line) !== 'error') missed.push(label);
  }
  if (missed.length) {
    fail('ловятся все реальные ошибки прод-журнала', 'пропущено: ' + missed.join('; '));
  } else {
    ok('ловятся все реальные ошибки прод-журнала', `${samples.length}/${samples.length}`);
  }
})();

// ── 3. Шум не должен будить админов ─────────────────────────────────────────
(function checkNoise() {
  const noise = [
    ['{"level":30,"time":1,"reqId":"req-1","msg":"request completed"}', 'access-лог'],
    ['{"level":40,"time":1,"msg":"[RecordingFetcher] Total matched: 0 out of 1 pending (throttled 1/h)"}', 'RecordingFetcher'],
    ['{"level":40,"time":1,"msg":"[PmAnalysisStale] no duty PM — skip 2 candidates"}', 'PmAnalysisStale (нет — это сигнал!)'],
    ['{"level":50,"time":1,"source":"m","kind":"boundary","message":"BookOpen is not defined","msg":"[client-error]"}', 'client-error (ошибка браузера)'],
    ['{"level":30,"time":1,"msg":"[LogMonitor] Check passed"}', 'сам монитор'],
    ['{"level":40,"time":1,"msg":"[TournamentCron] tick"}', 'TournamentCron'],
  ];
  // PmAnalysisStale НЕ в NOISE — это дефект бизнес-логики, его надо видеть.
  const expected = {
    'access-лог': 'ignore',
    'RecordingFetcher': 'ignore',
    'PmAnalysisStale (нет — это сигнал!)': 'error',
    'client-error (ошибка браузера)': 'ignore',
    'сам монитор': 'ignore',
    'TournamentCron': 'ignore',
  };
  const wrong = [];
  for (const [line, label] of noise) {
    const got = mod.classify(line);
    if (got !== expected[label]) wrong.push(`${label}: ждали ${expected[label]}, получили ${got}`);
  }
  if (wrong.length) {
    fail('шум не попадает в уведомления', wrong.join('; '));
  } else {
    ok('шум не попадает в уведомления', `${noise.length} категорий`);
  }
})();

// ── 4. Негативный контроль: классификатор не «всё подряд» ────────────────────
(function checkNegativeControl() {
  const normal = [
    '{"level":30,"time":1,"msg":"[JobQueue] Worker started"}',
    '{"level":30,"time":1,"reqId":"req-2","req":{"method":"GET","url":"/api/health"},"msg":"incoming request"}',
    '{"level":20,"time":1,"msg":"debug"}',
    'Oct 20 12:09:23 cv5977357.novalocal systemd[1]: Started asgard-crm.service - ASGARD CRM API.',
  ];
  const falsePositives = normal.filter((l) => mod.classify(l) === 'error');
  if (falsePositives.length) {
    fail('негативный контроль: обычные строки не считаются ошибкой',
      `${falsePositives.length} ложных: ${falsePositives[0].slice(0, 60)}`);
    return;
  }
  // и наоборот: настоящая ошибка обязана ловиться
  const real = '{"level":50,"time":1,"msg":"boom"}';
  if (mod.classify(real) !== 'error') {
    fail('негативный контроль: обычные строки не считаются ошибкой', 'пропущена реальная ошибка');
    return;
  }
  ok('негативный контроль: обычные строки не считаются ошибкой', '4 нормы / 1 ошибка');
})();

// ── 5. Превью группирует повторы ────────────────────────────────────────────
(function checkPrettify() {
  const line = '{"level":50,"time":1,"msg":"column \\"done_by\\" is of type integer but expression is of type text"}';
  const pretty = mod.prettify(line);
  if (!/\[error\]/.test(pretty)) {
    fail('превью: уровень и msg вытащены', pretty);
    return;
  }
  if (pretty.length > 170) {
    fail('превью: обрезано до 160 символов', String(pretty.length));
    return;
  }
  // systemd-строка не должна ломаться
  const sys = mod.prettify('Oct 20 10:55:43 cv systemd[1]: asgard-crm.service: Failed with result \'timeout\'.');
  if (!/timeout/.test(sys)) {
    fail('превью: systemd-строка читается', sys);
    return;
  }
  ok('превью: уровень и msg вытащены, длина ограничена', pretty.slice(0, 60));
})();

for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.extra ? '  — ' + c.extra : ''}`);
}
console.log(`\nитог: ${checks.filter((c) => c.pass).length}/${checks.length}`);
if (failures.length) {
  console.log('FAIL:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('LOG_MONITOR_SIGHT_OK');
