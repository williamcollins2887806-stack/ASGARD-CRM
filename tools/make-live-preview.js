/**
 * Превью живых страниц: собирает скриншоты из visual-live в одну подписанную
 * картинку. Нужно, чтобы смотреть результат глазами целиком, а не по одному.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIR = path.join('tests', 'reports', 'visual-live');
const PAGES = [
  ['главная (дашборд)', 'главная_дашборд.png'],
  ['заявки по РП', 'заявки_по_РП.png'],
  ['согласование тендеров', 'согласование_тендеров.png'],
  ['реестр тендеров', 'реестр_тендеров.png'],
  ['меню Ещё', 'меню_Ещ_.png'],
];

(async () => {
  const items = PAGES.filter(([, f]) => fs.existsSync(path.join(DIR, f)));
  if (!items.length) { console.log('нет скриншотов в ' + DIR); process.exit(1); }

  const cells = items.map(([label, f]) => {
    const b64 = fs.readFileSync(path.join(DIR, f)).toString('base64');
    return '<div class="c"><div class="cap">' + label + '</div>'
      + '<img class="s" src="data:image/png;base64,' + b64 + '"></div>';
  }).join('');

  const html = '<!doctype html><html><head><meta charset="utf-8"><style>'
    + 'body{margin:0;background:#15151a;font:13px -apple-system,Segoe UI,sans-serif;color:#eee;padding:16px}'
    + 'h1{font-size:15px;margin:0 0 12px 2px}'
    + '.g{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}'
    + '.c{background:#111;border:1px solid #333;border-radius:10px;overflow:hidden}'
    + '.cap{padding:8px 10px;font-weight:600;border-bottom:1px solid #333;background:#1b1b23}'
    + '.s{width:100%;display:block}'
    + '</style></head><body>'
    + '<h1>Живые страницы директора на клоне БД — реальный вход, реальные данные</h1>'
    + '<div class="g">' + cells + '</div></body></html>';

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1420, height: 1100 } });
  await p.setContent(html);
  await p.waitForTimeout(900);
  const el = await p.$('.g');
  const out = path.join(DIR, '_превью-живое.png');
  await el.screenshot({ path: out });
  console.log('превью: ' + out);
  await b.close();
})();
