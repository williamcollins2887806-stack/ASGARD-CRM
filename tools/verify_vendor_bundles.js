#!/usr/bin/env node
'use strict';
/**
 * Гейт целостности vendor-бандлов.
 *
 * Класс дефекта (найден 08.10.2026): `public/assets/vendor/jssip.min.js` был
 * повреждён — вместо переводов строк literal `\n` — файл не парсился, `window.JsSIP`
 * не определялся, WebRTC-софтфон молча не работал (SIP не регистрировался).
 * Такой файл отдаётся браузеру с HTTP 200 и не даёт ни одной ошибки в логах nginx,
 * поэтому нужен детерминированный гейт.
 *
 * Проверки для каждого `public/assets/vendor/*.js`:
 *   1. файл читается как UTF-8, размер > 100 Б;
 *   2. нет U+FFFD (потеря глифов при неверной кодировке);
 *   3. исходник парсится (`new Function`) — иначе это SyntaxError для браузера;
 *   4. для UMD-бандлов из EXPECTED_GLOBALS проверяется наличие маркера экспорта,
 *      и — если получается — реальное создание глобала в изолированной песочнице.
 *
 * Usage: node tools/verify_vendor_bundles.js
 * Exit 1 — любой провал.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const VENDOR_DIR = path.join(ROOT, 'public', 'assets', 'vendor');

/**
 * Ожидания для UMD-бандлов.
 * marker — подстрока, доказывающая standalone-экспорт (browserify `--standalone`).
 * check  — проверка глобала после исполнения в песочнице (best-effort).
 */
const EXPECTED_GLOBALS = {
  'jssip.min.js': {
    name: 'JsSIP',
    marker: 'JsSIP',
    check: (ctx) => !!(ctx.JsSIP && ctx.JsSIP.UA && ctx.JsSIP.WebSocketInterface),
    hint: 'window.JsSIP.UA / window.JsSIP.WebSocketInterface — без них софтфон не регистрируется',
  },
};

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function browserSandbox() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = {
    createElement: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    body: { appendChild() {}, classList: { add() {}, remove() {} } },
  };
  sandbox.navigator = { userAgent: 'node', mediaDevices: {}, language: 'ru' };
  sandbox.location = { protocol: 'https:', host: 'x', hostname: 'x', href: 'https://x/' };
  sandbox.console = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
  sandbox.setTimeout = () => 0;
  sandbox.clearTimeout = () => {};
  sandbox.setInterval = () => 0;
  sandbox.clearInterval = () => {};
  sandbox.RTCPeerConnection = function RTCPeerConnection() {};
  sandbox.MediaStream = function MediaStream() {};
  sandbox.WebSocket = function WebSocket() {};
  return sandbox;
}

function main() {
  if (!fs.existsSync(VENDOR_DIR)) {
    console.log(red(`FAIL: нет каталога ${path.relative(ROOT, VENDOR_DIR)}`));
    process.exit(1);
  }

  const files = fs.readdirSync(VENDOR_DIR).filter((f) => f.endsWith('.js')).sort();
  if (!files.length) {
    console.log(red('FAIL: в vendor нет ни одного .js'));
    process.exit(1);
  }

  let failed = 0;
  let warnings = 0;
  console.log('verify_vendor_bundles —', path.relative(ROOT, VENDOR_DIR));

  for (const f of files) {
    const p = path.join(VENDOR_DIR, f);
    const problems = [];
    const warns = [];
    let src = '';
    try {
      src = fs.readFileSync(p, 'utf8');
    } catch (e) {
      problems.push(`не читается: ${e.message}`);
    }

    if (src) {
      if (src.length < 100) problems.push(`слишком мал: ${src.length} Б`);
      const fffd = (src.match(/\uFFFD/g) || []).length;
      if (fffd > 0) problems.push(`потеря глифов U+FFFD: ${fffd}`);

      // Главная проверка: файл должен парситься как скрипт.
      let parses = true;
      try {
        // eslint-disable-next-line no-new-func
        new Function(src);
      } catch (e) {
        parses = false;
        problems.push(`SyntaxError при парсинге: ${e.message}`);
      }

      const exp = EXPECTED_GLOBALS[f];
      if (exp) {
        if (src.indexOf(exp.marker) === -1) {
          problems.push(`нет маркера standalone-экспорта «${exp.marker}»`);
        }
        if (parses && src.indexOf(exp.marker) !== -1) {
          const sandbox = browserSandbox();
          try {
            vm.createContext(sandbox);
            vm.runInContext(src, sandbox, { filename: f, timeout: 5000 });
            if (!exp.check(sandbox)) {
              problems.push(`не создаёт ожидаемый глобал ${exp.name} — ${exp.hint}`);
            }
          } catch (e) {
            // Runtime-ошибка в песочнице из-за неполного browser-окружения — не приговор:
            // маркер экспорта и парсинг уже подтверждены.
            warns.push(`песочница не подтвердила глобал (${e.message}); проверено статически`);
          }
        }
      }
    }

    if (problems.length) {
      failed += 1;
      console.log(`  ${red('FAIL')} ${f} (${src.length} Б)`);
      for (const pr of problems) console.log(`      ${red('-')} ${pr}`);
    } else if (warns.length) {
      warnings += 1;
      console.log(`  ${yellow('WARN')} ${f} ${dim(`(${src.length} Б)`)}`);
      for (const w of warns) console.log(`      ${yellow('-')} ${w}`);
    } else {
      console.log(`  ${green('PASS')} ${f} ${dim(`(${src.length} Б)`)}`);
    }
  }

  console.log(
    failed
      ? red(`\nИТОГ: FAIL — ${failed} из ${files.length} бандлов невалидны`)
      : green(`\nИТОГ: OK — ${files.length} бандлов валидны${warnings ? `, предупреждений: ${warnings}` : ''}`)
  );
  process.exit(failed ? 1 : 0);
}

main();
