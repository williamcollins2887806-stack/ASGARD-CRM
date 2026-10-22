'use strict';
/**
 * ЕЖЕДНЕВНЫЙ АЛЕРТ КОНВЕЙЕРА СЧЕТОВ.
 * ═══════════════════════════════════════════════════════════════════════════
 * Запускается по cron на проде. Прогоняет `pipeline_check.js` (он ТОЛЬКО читает,
 * ничего не правит) и, если есть FAIL, отправляет письмо ответственному.
 *
 * ПРИНЦИПЫ:
 *   • письмо уходит ТОЛЬКО при FAIL — иначе ящик забьётся ежедневными «всё ок»
 *     и настоящее предупреждение потеряется среди них;
 *   • антиспам: одно и то же состояние не повторяется чаще раза в 12 часов
 *     (состояние = хэш списка FAIL-строк). Если ничего не менялось — молчим;
 *   • когда проблема исчезла после FAIL — приходит ОДНО письмо «восстановлено»;
 *   • всё пишется в лог /var/log/asgard-pipeline.log, письмо не единственный след.
 *
 * Запуск:
 *   node tools/pipeline_alert.js            # проверка + письмо при FAIL
 *   node tools/pipeline_alert.js --dry-run  # без отправки, только вывод
 *   node tools/pipeline_alert.js --force    # отправить даже если «всё ок»
 */

const ROOT = __dirname + '/..';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

// Кому шлём. Можно переопределить переменной окружения PIPELINE_ALERT_EMAIL.
const ALERT_TO = process.env.PIPELINE_ALERT_EMAIL || 'n.androsov@asgard-service.com';
// От чьего имени (id пользователя в CRM; 3474 = Андросов, у него есть ящик).
const ALERT_FROM_USER = parseInt(process.env.PIPELINE_ALERT_USER || '3474', 10);
// Файл состояния: чтобы не спамить и замечать восстановление.
const STATE_FILE = process.env.PIPELINE_STATE_FILE || '/var/lib/asgard/pipeline-state.json';
const LOG_FILE = process.env.PIPELINE_LOG_FILE || '/var/log/asgard-pipeline.log';
const REPEAT_HOURS = 12;

function logLine(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  // В cron stdout уже уходит в тот же файл (>> ... 2>&1) — писать второй раз
  // не нужно, иначе каждая строка дублируется. Пишем в файл сами только когда
  // stdout не перенаправлен (ручной запуск в терминале).
  const stdoutIsTty = process.stdout.isTTY;
  if (!stdoutIsTty) return;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) { /* лог не критичен */ }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; }
}
function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1));
  } catch (e) { logLine('не смог записать состояние: ' + e.message); }
}

/** Прогнать чек-лист и вернуть его текстовый вывод + признак FAIL. */
function runCheck() {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(ROOT, 'tools', 'pipeline_check.js')],
      { cwd: ROOT, maxBuffer: 8 * 1024 * 1024, timeout: 120000 },
      (err, stdout, stderr) => {
        const out = String(stdout || '') + (stderr ? '\n' + stderr : '');
        // Код выхода 1 у pipeline_check означает FAIL.
        const hasFail = !!(err && err.code === 1);
        resolve({ out, hasFail, crashed: !!(err && err.code !== 1 && err.code !== 0) });
      });
  });
}

/** Вытащить строки FAIL и итог из вывода чек-листа. */
function parseFails(out) {
  const lines = out.split('\n');
  const fails = lines.filter((l) => /^\s+✗/.test(l)).map((l) => l.trim());
  const warn = lines.filter((l) => /^\s+!/.test(l)).map((l) => l.trim());
  const summary = (lines.find((l) => /PASS:\s*\d+/.test(l)) || '').trim();
  return { fails, warn, summary };
}

function esc(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function buildHtml({ fails, warn, summary, out, recovered }) {
  const head = recovered
    ? 'Конвейер счетов: проблема устранена'
    : 'Конвейер счетов: требуется внимание';
  const rows = fails.map((f) => `<li style="margin:4px 0"><code>${esc(f.replace(/^✗\s*/, ''))}</code></li>`).join('');
  const warnRows = warn.slice(0, 12).map((w) => `<li style="margin:2px 0;color:#666">${esc(w.replace(/^!\s*/, ''))}</li>`).join('');
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;color:#111">
  <h2 style="margin:0 0 4px">${esc(head)}</h2>
  <p style="color:#666;margin:0 0 16px">${esc(summary || '')}</p>
  ${recovered ? '' : `<h3 style="margin:16px 0 6px;color:#b91c1c">Что сломано (${fails.length})</h3>
  <ul style="margin:0 0 16px 18px;padding:0">${rows || '<li>нет</li>'}</ul>`}
  ${warnRows ? `<h3 style="margin:16px 0 6px;color:#92400e">Предупреждения (не блокируют, ${warn.length})</h3>
  <ul style="margin:0 0 16px 18px;padding:0">${warnRows}</ul>` : ''}
  <h3 style="margin:16px 0 6px">Полный отчёт</h3>
  <pre style="background:#f6f6f6;padding:12px;border-radius:6px;font-size:12px;white-space:pre-wrap">${esc(out)}</pre>
  <p style="color:#999;font-size:12px;margin-top:20px">
    Проверка только читает данные и ничего не меняет.<br>
    Запустить вручную: <code>cd /var/www/asgard-crm &amp;&amp; node tools/pipeline_check.js</code>
  </p>
  </body></html>`;
}

(async () => {
  logLine('--- старт проверки конвейера ---');
  const { out, hasFail, crashed } = await runCheck();
  const { fails, warn, summary } = parseFails(out);
  logLine(`итог: ${summary || 'нет итога'} | FAIL=${fails.length} WARN=${warn.length} crash=${crashed}`);

  if (crashed) {
    logLine('чек-лист упал с ошибкой — см. вывод выше');
  }

  const state = readState();
  const now = Date.now();
  const fingerprint = crypto.createHash('sha1')
    .update(JSON.stringify({ fails, hasFail, crashed })).digest('hex').slice(0, 12);
  const sameAsBefore = state.fingerprint === fingerprint;
  const lastSent = state.lastSentAt ? new Date(state.lastSentAt).getTime() : 0;
  const hoursSince = (now - lastSent) / 3600000;
  const wasFailing = !!state.failing;
  const recovered = wasFailing && !hasFail && !crashed;

  const needSend = FORCE
    || recovered
    || ((hasFail || crashed) && (!sameAsBefore || hoursSince >= REPEAT_HOURS));

  if (!needSend) {
    logLine(sameAsBefore && (hasFail || crashed)
      ? `то же состояние, письмо уже отправлено ${hoursSince.toFixed(1)}ч назад — молчу`
      : 'проблем нет — письмо не нужно');
    writeState({ ...state, fingerprint, failing: hasFail || crashed, lastCheckAt: new Date().toISOString() });
    return;
  }

  const subject = recovered
    ? '✓ Конвейер счетов: проблема устранена'
    : `⚠ Конвейер счетов: ${fails.length} FAIL${crashed ? ' (проверка упала)' : ''}`;

  const html = buildHtml({ fails, warn, summary, out, recovered });

  if (DRY) {
    logLine(`[dry-run] письмо НЕ отправлено. Кому: ${ALERT_TO} | Тема: ${subject}`);
    console.log(html.slice(0, 800));
    writeState({ ...state, fingerprint, failing: hasFail || crashed, lastCheckAt: new Date().toISOString() });
    return;
  }

  try {
    const { Client } = require(ROOT + '/node_modules/pg');
    const c = new Client({
      connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm'
    });
    await c.connect();
    const db = { query: (s, p) => c.query(s, p) };
    const mailer = require(ROOT + '/src/services/crm-mailer');
    const res = await mailer.sendCrmEmail(db, ALERT_FROM_USER, {
      to: ALERT_TO,
      subject,
      html,
      text: `${subject}\n\n${summary}\n\n` + fails.join('\n') + '\n\n' + out,
      skipBcc: true,     // служебное письмо — копию в CRM не кладём
      noBcc: true
    });
    await c.end();
    if (res && res.ok === false && res.skipped !== 'smtp_disabled') {
      logLine(`письмо НЕ отправлено: ${res.skipped || 'unknown'} ${JSON.stringify(res.bad || '')}`);
    } else {
      logLine(`письмо отправлено на ${ALERT_TO}: ${subject}`);
    }
  } catch (e) {
    logLine('ошибка отправки письма: ' + (e && e.message));
  }

  writeState({
    ...state, fingerprint,
    failing: hasFail || crashed,
    lastSentAt: new Date().toISOString(),
    lastCheckAt: new Date().toISOString(),
    lastFails: fails.length
  });
})().catch((e) => {
  logLine('КРИТИЧЕСКАЯ ОШИБКА: ' + (e && e.stack || e));
  process.exitCode = 1;
});
