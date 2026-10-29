/**
 * Проба: какие элементы и тексты реально видит РП в предпросмотре отправки
 * при цене ниже и выше порога согласования.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SRC = fs.readFileSync('public/assets/js/rp_calc_modal.js', 'utf8');
const tokens = fs.readFileSync('public/assets/css/design-tokens.css', 'utf8');
const css = fs.readFileSync('public/assets/css/rp-calc-modal.css', 'utf8');

const stand = `<!doctype html><html><head><meta charset="utf-8">
<style>${tokens}</style><style>${css}</style></head>
<body><div id="h"></div>
<script>
window.AsgardUI = {
  esc: function (s) { return String(s == null ? '' : s); },
  toast: function () {}, showModal: function () {}, hideModal: function () {}, replaceModal: null
};
window.AsgardSmeta = { DEFAULT_PARAMS: {}, skeletonRows: function () { return []; },
  recalcAsgardSmeta: function (s) { return s; } };
window.fetch = function () { return Promise.reject(new Error('stand')); };
</script>
<script>${SRC}</script>
</body></html>`;

(async () => {
  const f = path.join(process.cwd(), 'tests', 'reports', '_probe.html');
  fs.writeFileSync(f, stand);

  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await p.goto('file:///' + f.replace(/\\/g, '/'));
  await p.waitForTimeout(150);

  for (const price of [4000000, 14000000]) {
    await p.evaluate((pr) => {
      document.querySelectorAll('.rp-calc-mail-preview').forEach((e) => e.remove());
      const h = document.getElementById('h');
      h.innerHTML = '';
      const s = window.AsgardRpCalcModal.openDemo(h);
      s.state.estimate.totals = {
        price_no_vat: pr, cost: pr * 0.7, price_with_vat: pr * 1.22, net_profit: pr * 0.2
      };
      s.state.directorThreshold = 10000000;
      s.state.smetaReady = true;
      s.paint();
      h.querySelector('[data-rp-act="demo-send"]').click();
    }, price);

    await p.waitForTimeout(300);

    const info = await p.evaluate(() => {
      const ov = document.querySelector('.rp-calc-mail-preview');
      if (!ov) return { preview: false };
      const flag = ov.querySelector('[data-approve-flag]');
      const lbl = ov.querySelector('.rp-calc-approve-toggle__text');
      const ok = ov.querySelector('[data-mail-prev="ok"]');
      const skip = ov.querySelector('.rp-calc-mail-preview__skip');
      const rcpt = ov.querySelector('[data-approve-recipients]');
      return {
        preview: true,
        flagExists: !!flag,
        flagChecked: flag ? flag.checked : null,
        flagLabel: lbl ? lbl.innerText.replace(/\n+/g, ' | ') : null,
        recipientsHidden: rcpt ? rcpt.hidden : null,
        okButton: ok ? ok.textContent : null,
        skipText: skip ? skip.innerText.replace(/\n+/g, ' ') : null
      };
    });

    console.log('=== цена ' + price.toLocaleString('ru-RU') + ' ₽ ===');
    console.log(JSON.stringify(info, null, 1));
  }

  await browser.close();
})();
