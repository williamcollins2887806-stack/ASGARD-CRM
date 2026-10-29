/**
 * Скриншоты состояний предпросмотра «Отправить просчёт» для показа РП.
 *
 * Зачем: ответить на вопрос «где ставить галочку, что согласование не нужно».
 * Галочка по замыслу появляется ТОЛЬКО когда цена без НДС выше порога (10 млн):
 * до порога согласования нет вовсе, поэтому и галочки нет — там писать нечего.
 *
 * Скрипт рисует оба состояния на настоящем модуле и сохраняет PNG.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SRC = fs.readFileSync('public/assets/js/rp_calc_modal.js', 'utf8');
const tokens = fs.readFileSync('public/assets/css/design-tokens.css', 'utf8');
const light = fs.readFileSync('public/assets/css/light-theme.css', 'utf8');
const css = fs.readFileSync('public/assets/css/rp-calc-modal.css', 'utf8');

const stand = (theme) => `<!doctype html><html${theme === 'light' ? ' data-theme="light"' : ''}><head><meta charset="utf-8">
<style>${tokens}</style><style>${light}</style><style>${css}</style></head>
<body style="margin:0;background:var(--bg1,var(--bg,#0d1117))">
<script>
window.AsgardUI = {
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); },
  toast: function () {}, showModal: function () {}, hideModal: function () {}, replaceModal: null
};
window.AsgardSmeta = { DEFAULT_PARAMS: {}, skeletonRows: function () { return []; },
  recalcAsgardSmeta: function (s) { return s; } };
window.fetch = function () { return Promise.reject(new Error('stand')); };
</script>
<script>${SRC}</script>
</body></html>`;

/** Предпросмотр при заданной цене без НДС — через настоящий openSendPreview. */
const shot = async (browser, theme, price, file) => {
  const f = path.join(process.cwd(), 'tests', 'reports', `_stand-${price}.html`);
  fs.writeFileSync(f, stand(theme));
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + f.replace(/\\/g, '/'));

  await p.evaluate((price) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const s = window.AsgardRpCalcModal.openDemo(host);
    // Демо-смета: подменяем цену и порог, чтобы попасть в нужную ветку.
    s.state.estimate.totals = Object.assign({}, s.state.estimate.totals, {
      price_no_vat: price,
      cost: price * 0.7,
      price_with_vat: price * 1.22,
      net_profit: price * 0.2
    });
    s.state.directorThreshold = 10000000;
    s.state.smetaReady = true;
    s.paint();
    // Жмём ту же кнопку, что и РП в проде.
    host.querySelector('[data-rp-act="demo-send"]').click();
  }, price);

  await p.waitForTimeout(400);
  await p.screenshot({ path: file, fullPage: false });
  const hasFlag = await p.$('[data-approve-flag]');
  const skip = await p.$('.rp-calc-mail-preview__skip');
  console.log(`  ${theme} / ${price.toLocaleString('ru-RU')} ₽ → ` +
    (hasFlag ? 'галочка ЕСТЬ' : (skip ? 'галочки нет (ниже порога)' : 'предпросмотра нет')) +
    (errs.length ? ' | ОШИБКИ: ' + errs.join(', ') : ''));
  await ctx.close();
  return !!hasFlag;
};

(async () => {
  const browser = await chromium.launch();
  console.log('Рендер состояний предпросмотра:');
  await shot(browser, 'dark', 4000000, 'tests/reports/preview-below-threshold.png');
  await shot(browser, 'dark', 14000000, 'tests/reports/preview-above-threshold.png');
  await browser.close();
})();
