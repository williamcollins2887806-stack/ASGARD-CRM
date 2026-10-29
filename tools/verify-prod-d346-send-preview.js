/**
 * Проверка ПРОДА: скачиваем rp_calc_modal.js с asgard-crm.ru (ровно те байты,
 * что получит браузер РП), грузим в chromium, жмём «Отправить просчёт» и
 * смотрим, нет ли ReferenceError.
 *
 * Локальные гейты зелёные, но именно рассинхрон прод/локаль дал повторную
 * жалобу (29.10.2026) — поэтому проверять надо то, что реально отдаёт сервер.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PROD = 'https://asgard-crm.ru';
const CSS_PROD = PROD + '/assets/css/rp-calc-modal.css';
const TOKENS_PROD = PROD + '/assets/css/design-tokens.css';

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

(async () => {
  // Качаем через сетевой стек Chromium, а не node fetch: undici уходит в IPv6
  // и падает по connect-timeout там, где браузер/PowerShell проходят нормально.
  const browser = await chromium.launch();
  const net = await browser.newContext();

  const get = async (url) => {
    const r = await net.request.get(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok()) throw new Error(`не скачал ${url}: HTTP ${r.status()}`);
    return r.text();
  };

  const stamp = Date.now();
  const jsUrl = `${PROD}/assets/js/rp_calc_modal.js?probe=${stamp}`;
  const src = await get(jsUrl);
  console.log(`  скачано ${src.length} байт с ${jsUrl}\n`);

  // ── 1. Что именно в байтах прода ───────────────────────────────────────
  console.log('=== 1. Содержимое прод-файла ===');
  const m = src.match(/function wantApproval\(([^)]*)\)/);
  if (m && m[1].trim() === 'state') ok('прод отдаёт wantApproval(state) — параметр на месте');
  else bad(`прод отдаёт wantApproval(${m ? m[1] : '?'}) — СЛОМАНО`);
  if (!/function wantApproval\(\s*\)/.test(src)) ok('сломанной формы wantApproval() в проде нет');
  else bad('в проде осталась форма wantApproval() без параметра');
  if (/return wantApproval\(state\);/.test(src)) ok('approvalWanted() передаёт state');
  else bad('approvalWanted() не передаёт state');
  if (src.includes('\uFFFD')) bad('в прод-файле битые символы U+FFFD');
  else ok('кодировка целая');

  // ── 2. Клик на прод-коде ───────────────────────────────────────────────
  console.log('\n=== 2. Клик по кнопке на прод-коде ===');
  const [tokens, css] = await Promise.all([
    get(`${TOKENS_PROD}?probe=${stamp}`),
    get(`${CSS_PROD}?probe=${stamp}`),
  ]);
  await net.close();

  const stand = `<!doctype html><html><head><meta charset="utf-8">
<style>${tokens}</style><style>${css}</style></head><body><div id="h"></div>
<script>
window.AsgardUI = {
  esc: function (s) { return String(s == null ? '' : s); },
  toast: function (k, m) { window.__toasts = (window.__toasts || []).concat([k + ': ' + m]); },
  showModal: function () {}, hideModal: function () {}, replaceModal: null
};
window.AsgardSmeta = { DEFAULT_PARAMS: {}, skeletonRows: function () { return []; },
  recalcAsgardSmeta: function (s) { return s; } };
window.fetch = function () { return Promise.reject(new Error('stand')); };
window.__errors = [];
window.addEventListener('error', function (e) { window.__errors.push(String(e.message)); });
</script>
<script>${src}</script></body></html>`;

  const f = path.join(process.cwd(), 'tests', 'reports', '_prod-stand.html');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, stand);

  const browser2 = await chromium.launch();
  const p = await browser2.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  p.on('pageerror', (e) => pageErrors.push(String(e.message)));
  await p.goto('file:///' + f.replace(/\\/g, '/'));
  await p.waitForTimeout(200);

  if (await p.evaluate(() => !!window.AsgardRpCalcModal)) ok('прод-модуль загрузился');
  else bad('прод-модуль не загрузился');

  const clicked = await p.evaluate(() => {
    const h = document.getElementById('h');
    try {
      window.AsgardRpCalcModal.openDemo(h);
      const b = h.querySelector('[data-rp-act="demo-send"]');
      if (!b) return 'нет кнопки';
      b.click();
      return 'ok';
    } catch (e) {
      return 'исключение: ' + e.message;
    }
  });
  await p.waitForTimeout(400);

  const overlay = await p.$('.rp-calc-mail-preview');
  if (clicked === 'ok' && overlay) ok('клик открыл предпросмотр письма');
  else bad(`клик не открыл предпросмотр (${clicked})`);

  const errs = (await p.evaluate(() => window.__errors || [])).concat(pageErrors);
  const ref = errs.filter((e) => /is not defined|ReferenceError/i.test(e));
  if (ref.length === 0) ok('в консоли нет ReferenceError');
  else bad('ReferenceError в консоли: ' + ref.join(' | '));

  if (errs.length === 0) ok('вообще нет JS-ошибок');
  else console.log('  (прочие сообщения: ' + errs.join(' | ') + ')');

  await p.screenshot({ path: 'tests/reports/prod-send-preview.png' });
  await browser2.close();
  await browser.close();

  console.log('\n' + (fail === 0
    ? 'ИТОГ: OK — ПРОД отдаёт работающий код, кнопка открывает предпросмотр'
    : `ИТОГ: FAIL — ${fail} нарушений на проде`));
  process.exit(fail === 0 ? 0 : 1);
})();
