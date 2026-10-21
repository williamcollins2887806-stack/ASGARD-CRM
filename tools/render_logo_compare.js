/**
 * Сравнение векторного логотипа с растром-оригиналом: форма, объём, края.
 * Показываем рядом на тёмном фоне в нескольких размерах + увеличение.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.cwd();
const svg = fs.readFileSync(path.join(ROOT, 'public', 'mobile-app', 'src', 'assets', 'asgard-logo.svg'), 'utf8');
const rasterB64 = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'img', 'asgard_logo.png')).toString('base64');
const sized = (cls) => svg.replace('<svg ', `<svg class="${cls}" `);

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
 :root{--gold:#c8a84e;--brand-red:#C8293B;--brand-blue:#1E4D8C}
 body{margin:0;background:#0a0d18;font-family:system-ui;color:#8E96A4}
 .row{display:flex;gap:30px;padding:20px;align-items:flex-end}
 .col{text-align:center}
 .lbl{font-size:12px;margin-bottom:8px}
 .s90{width:90px}.s180{width:180px}.s300{width:300px}
 .r90{width:90px}.r180{width:180px}.r300{width:300px}
 .zoom{width:340px;height:340px;overflow:hidden;border:1px solid #1f2436;position:relative}
 .zoom>*{width:1360px!important;height:auto!important;position:absolute;left:-510px;top:-190px}
 h3{font-size:13px;color:#c8a84e;padding:14px 20px 0;margin:0}
</style></head><body>
<h3>ВЕКТОР (кривые Безье + градиент объёма)</h3>
<div class="row">
 <div class="col"><div class="lbl">90</div>${sized('s90')}</div>
 <div class="col"><div class="lbl">180</div>${sized('s180')}</div>
 <div class="col"><div class="lbl">300</div>${sized('s300')}</div>
</div>
<h3>РАСТР-ОРИГИНАЛ</h3>
<div class="row">
 <div class="col"><div class="lbl">90</div><img class="r90" src="data:image/png;base64,${rasterB64}"></div>
 <div class="col"><div class="lbl">180</div><img class="r180" src="data:image/png;base64,${rasterB64}"></div>
 <div class="col"><div class="lbl">300</div><img class="r300" src="data:image/png;base64,${rasterB64}"></div>
</div>
<h3>Увеличение x4</h3>
<div class="row">
 <div class="col"><div class="lbl">ВЕКТОР</div><div class="zoom">${svg}</div></div>
 <div class="col"><div class="lbl">РАСТР</div><div class="zoom"><img src="data:image/png;base64,${rasterB64}"></div></div>
</div>
</body></html>`;

const f = path.join(ROOT, 'tests', 'reports', 'logo-compare.html');
fs.writeFileSync(f, html);

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1300, height: 1500 }, deviceScaleFactor: 2 });
  await p.goto('file:///' + f.replace(/\\/g, '/'));
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'tests/reports/logo-compare.png', fullPage: true });
  await b.close();
  console.log('saved');
})();
