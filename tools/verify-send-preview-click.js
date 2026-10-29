/**
 * Рантайм-проверка кнопки «Отправить просчёт» (десктоп, ванильный просчёт РП).
 *
 * Баг, который ловит тест (29.10.2026). Функция `wantApproval()` жила на уровне
 * модуля, но читала `state` — переменную, которая создаётся ВНУТРИ `createSession()`.
 * Любой вызов падал с `ReferenceError: state is not defined` ещё до построения
 * оверлея предпросмотра, поэтому клик по «Отправить просчёт» не давал вообще
 * ничего (ни письма, ни ошибки для пользователя).
 *
 * Статические гейты такое не ловят: строки в файле есть, формулы верные.
 * Поэтому здесь грузим настоящий rp_calc_modal.js в браузер, жмём кнопку как РП
 * и проверяем, что предпросмотр реально появился и в консоли нет исключений.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SRC = fs.readFileSync('public/assets/js/rp_calc_modal.js', 'utf8');

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

// ── 1. Скоуп: ни одна модульная функция не читает state из воздуха ────────
console.log('=== 1. Модульные функции не читают чужой state ===');

/**
 * Грубая, но действенная проверка: функции на уровне модуля (2 пробела отступа)
 * не имеют права ссылаться на `state`, если он не пришёл параметром и не
 * объявлен локально в теле. Именно так ловится исходный ReferenceError.
 *
 * `createSession` владеет своим `const state = {...}` и имеет полное право его
 * читать — поэтому сначала собираем тело функции, ищем локальное объявление и
 * пропускаем такие функции целиком.
 */
const lines = SRC.split('\n');
const offenders = [];

/** Тело функции на уровне модуля: от строки объявления до парной закрывающей. */
function bodyOf(startLine) {
  let depth = 0;
  let started = false;
  const body = [];
  for (let j = startLine; j < lines.length; j++) {
    depth += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (depth > 0) started = true;
    body.push({ n: j + 1, text: lines[j] });
    if (started && depth <= 0) break;
  }
  return body;
}

for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^  function (\w+)\(([^)]*)\)/);
  if (!m) continue;
  const name = m[1];
  const params = m[2];
  if (/\bstate\b/.test(params)) continue;

  const body = bodyOf(i);
  // Локальное объявление state внутри функции — законно, дальше не смотрим.
  const declaresState = body.some((L) => /(?:const|let|var)\s+state\b/.test(L.text));
  if (declaresState) continue;

  for (const L of body) {
    if (/^\s*\*/.test(L.text)) continue;                 // комментарий-блок
    const code = L.text.replace(/\/\/.*$/, '');          // хвостовой комментарий
    if (!/\bstate\b/.test(code)) continue;
    // Обращение через объект (session.state, d.state) — это не свободная переменная.
    const qualified = /[\w\]$)]\s*\.\s*state\b/.test(code);
    if (qualified) continue;
    offenders.push(`${name}() строка ${L.n}: ${code.trim().slice(0, 90)}`);
  }
}
if (offenders.length === 0) {
  ok('нет функций, читающих необъявленный state');
} else {
  bad('функции читают state, которого у них нет (ReferenceError):\n       ' + offenders.join('\n       '));
}

// ── 2. Кнопка реально открывает предпросмотр ──────────────────────────────
console.log('\n=== 2. Клик по «Отправить просчёт» открывает предпросмотр ===');

const page = `<!doctype html><html><head><meta charset="utf-8">
<style>${fs.readFileSync('public/assets/css/design-tokens.css', 'utf8')}</style>
<style>${fs.readFileSync('public/assets/css/rp-calc-modal.css', 'utf8')}</style>
</head><body><div id="host"></div>
<script>
/* Минимальные заглушки окружения: модуль ждёт AsgardUI и AsgardSmeta. */
window.__errors = [];
window.addEventListener('error', function (e) { window.__errors.push(String(e.message)); });
window.AsgardUI = {
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); },
  toast: function (k, m) { window.__toasts = (window.__toasts || []).concat([k + ': ' + m]); },
  showModal: function () {},
  hideModal: function () {},
  replaceModal: null
};
window.AsgardSmeta = {
  DEFAULT_PARAMS: {},
  skeletonRows: function () { return []; },
  recalcAsgardSmeta: function (s) { return s; }
};
window.fetch = function () { return Promise.reject(new Error('offline-stand')); };
</script>
<script>${SRC}</script>
</body></html>`;

(async () => {
  const file = path.join(process.cwd(), 'tests', 'reports', '_send-preview-stand.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, page);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const consoleErrors = [];
  p.on('pageerror', (e) => consoleErrors.push(String(e.message)));

  await p.goto('file:///' + file.replace(/\\/g, '/'));
  await p.waitForTimeout(200);

  const loaded = await p.evaluate(() => !!window.AsgardRpCalcModal);
  ok(loaded ? 'модуль загрузился' : 'модуль отдал публичный API (проверьте имя)');

  // Рендерим демо-просчёт прямо в контейнер — это тот же createSession + bind,
  // что и в проде, только без модалки и без API.
  const apiName = await p.evaluate(() => (window.AsgardRpCalcModal ? 'AsgardRpCalcModal' : null));
  if (!apiName) { bad('не нашёл публичный API модуля'); await browser.close(); return; }

  const sent = await p.evaluate((name) => {
    const host = document.getElementById('host');
    try {
      window[name].openDemo(host);
      return true;
    } catch (e) {
      window.__errors.push('openDemo: ' + e.message);
      return false;
    }
  }, apiName);
  if (sent) ok('openDemo отрисовал просчёт в контейнере');
  else bad('openDemo упал');

  await p.waitForTimeout(200);

  const btn = await p.$('[data-rp-act="send-director"], [data-rp-act="demo-send"]');
  if (!btn) {
    bad('в футере нет кнопки отправки просчёта');
  } else {
    await btn.click();
    await p.waitForTimeout(300);
    const overlay = await p.$('.rp-calc-mail-preview');
    if (overlay) ok('предпросмотр письма открылся после клика');
    else bad('клик по кнопке не открыл предпросмотр (баг ReferenceError вернулся?)');
  }

  const errs = await p.evaluate(() => window.__errors || []);
  const refErr = errs.concat(consoleErrors).filter((e) => /is not defined|ReferenceError/i.test(e));
  if (refErr.length === 0) ok('нет ReferenceError в консоли');
  else bad('ReferenceError: ' + refErr.join(' | '));

  await p.screenshot({ path: 'tests/reports/send-preview-click.png', fullPage: false });
  await ctx.close();
  await browser.close();

  console.log('\n' + (fail === 0
    ? 'ИТОГ: OK — «Отправить просчёт» открывает предпросмотр без ошибок в консоли'
    : `ИТОГ: FAIL — ${fail} нарушений`));
  process.exit(fail === 0 ? 0 : 1);
})();
