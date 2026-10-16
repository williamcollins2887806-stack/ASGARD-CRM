/* ═══════════════════════════════════════════════════════════════════════════
   ASGARD · «Тинг Асгарда» — алгоритм сборки презентационного PDF
   Запуск:  node tools/build-ting-rating-pdf.js
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', 'prototypes', 'ting-rating');
const OUT = path.resolve(__dirname, '..', 'prototypes', 'ting-rating', 'TING-ASGARDA.pdf');
const PORT = 8791;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8'
};

// ширина/высота PNG из заголовка (без внешних зависимостей)
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return { w: 0, h: 0 };
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, p.replace(/^\/+/, ''));
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

// ── нормализация секции: единый вид для печати ──────────────────────────────
async function normalize(page) {
  await page.evaluate(() => {
    // 0) письмо снимаем на тёмном фоне: убираем белую «читалку» Яндекс.Почты,
    //    иначе вокруг письма остаётся белая рамка на странице PDF
    if (!document.getElementById('_tingdark')) {
      const st = document.createElement('style');
      st.id = '_tingdark';
      st.textContent =
        '.ym,.ym__body,.ym__read,.ym__body-slot,.ym__meta,.ym__readbar{background:#0f0f14 !important;border-color:rgba(255,255,255,.08) !important;}' +
        '.ym__nav,.ym__list,.ym__listbar,.ym__readbar .ym__btn:not(.ym__btn--primary){display:none !important;}' +
        '.ym__body{grid-template-columns:1fr !important;}' +
        '.ym__read{max-width:840px;margin:0 auto;width:100%;}' +
        '.ym__body-slot{padding:18px 22px 26px !important;}' +
        '.ym__meta{padding:16px 22px 12px !important;}';
      document.head.appendChild(st);
    }

    // 1) оболочка снимается, если она есть
    const app = document.querySelector('.app');
    if (app) {
      app.style.display = 'block';
      app.style.gridTemplateColumns = '1fr';
    }
    document.querySelectorAll('.nav, .main__bar, .tr-demo, #toast').forEach((e) => (e.style.display = 'none'));
    const main = document.querySelector('.main');
    if (main) main.style.display = 'block';

    // 2) убираем принудительную высоту вьюпорта, чтобы скриншот был по контенту
    document.documentElement.style.minHeight = '0';
    document.body.style.minHeight = '0';
    ['.app', '.main', '.view', '#viewHost', '.crm-shell', '.survey-page'].forEach((sel) => {
      document.querySelectorAll(sel).forEach((e) => {
        e.style.minHeight = '0';
        e.style.height = 'auto';
      });
    });

    // 3) вырезаем тело секции из первой «страницы»
    const host = document.getElementById('viewHost');
    let node = null;
    let source = null;
    if (host) {
      source = host;
      node = host.firstElementChild || host;
    } else {
      node = document.querySelector('.pdf') || document.body.firstElementChild || document.body;
    }
    if (node === source) node = source.firstElementChild || source;

    // 3) iframe письма: снимаем fixed-высоту, чтобы PDF не оставлял пустой лист
    document.querySelectorAll('iframe.mail-frame').forEach((f) => {
      const h = parseInt(f.dataset.fittedH || f.style.height || '0', 10);
      f.style.height = (h && h < 2000 ? h : 1400) + 'px';
      f.style.maxHeight = f.style.height;
    });

    // 4) скрываем всё лишнее в теле
    Array.from(document.body.children).forEach((child) => {
      if (child === source || child === node || child.id === 'toast') return;
      if (child.contains && child.contains(source)) return;
      child.style.display = 'none';
    });
    document.body.style.background = getComputedStyle(document.body).backgroundColor;
  });
}

async function fitFrames(page) {
  await page.evaluate(() => {
    document.querySelectorAll('iframe.mail-frame').forEach((f) => {
      try {
        const d = f.contentDocument;
        const h = Math.max(d.body.scrollHeight, d.documentElement.scrollHeight, 400);
        f.style.height = (h + 4) + 'px';
      } catch (e) { /* cross-origin не бывает: srcdoc */ }
    });
  });
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${PORT}`;
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb'] });

  async function newPage() {
    const p = await browser.newPage({ viewport: { width: 1120, height: 1000 }, deviceScaleFactor: 2 });
    await p.addStyleTag({ content: 'html,body{min-height:0 !important;height:auto !important;}' });
    return p;
  }
  let page = await newPage();

  async function open(url, waitMs) {
    await page.goto(url, { waitUntil: 'load' });
    // style tag теряется при навигации — возвращаем, чтобы не было пустого хвоста
    await page.addStyleTag({ content: 'html,body{min-height:0 !important;height:auto !important;}' });
    await page.waitForTimeout(waitMs || 700);
    await fitFrames(page);
    await page.waitForTimeout(250);
    await fitFrames(page);
  }

  const shots = [];
  const shotIdx = (name) => shots.length + 1;

  async function addFull(name) {
    const buf = await page.screenshot({ fullPage: true });
    shots.push({ name, kind: 'full', buf });
    return buf;
  }
  async function addClip(name, selector, pad, opts) {
    const el = await page.$(selector);
    if (!el) throw new Error('нет селектора ' + selector);
    const box = await el.boundingBox();
    const p = pad || 10;
    const forceW = opts && opts.w;
    const x = forceW ? Math.max(0, Math.min(1120 - forceW, box.x - p)) : Math.max(0, box.x - p);
    const w = forceW ? forceW : Math.min(1120, box.width + p * 2);
    const buf = await page.screenshot({
      clip: { x: x, y: Math.max(0, box.y - p), width: w, height: box.height + p * 2 }
    });
    shots.push({ name, kind: 'clip', buf });
    return buf;
  }

  // 1) титул + обзор
  await open(base + '/index.html#overview');
  await normalize(page);
  await addFull('01-obzor');

  // 2..8) письма (ПК)
  for (const [id, name] of [
    ['invite', '02-pismo-priglashenie'],
    ['reminder', '03-pismo-napominanie'],
    ['published', '04-pismo-reyting-opublikovan'],
    ['incore', '05-pismo-v-yadre'],
    ['rank1', '06-pismo-1-mesto'],
    ['rank2', '07-pismo-2-mesto'],
    ['rank3', '08-pismo-3-mesto']
  ]) {
    await open(base + '/index.html?e=' + id + '#' + id, 900);
    await normalize(page);
    // вкладку переключим кликом, чтобы отрисовалось нужное письмо
    await page.evaluate((em) => {
      const b = document.querySelector('.nav__item[data-email="' + em + '"]');
      if (b) b.click();
    }, id);
    await page.waitForTimeout(900);
    await normalize(page);
    await fitFrames(page);
    await addClip(name, 'iframe.mail-frame', 8, { w: 1005 });
  }

  // 9) телефон: список писем
  await open(base + '/index.html#mail-mobile');
  await normalize(page);
  await addClip('09-telefon-pochta', '.phone', 16);

  // 10) телефон: письмо открыто
  await open(base + '/index.html#mail-mobile');
  await page.evaluate(() => document.querySelectorAll('.mmail-item')[0].click());
  await page.waitForTimeout(900);
  await normalize(page);
  await fitFrames(page);
  await addClip('10-telefon-pismo', '.phone__screen', 6);

  // 11) Telegram
  await open(base + '/index.html#tg');
  await normalize(page);
  await addClip('11-telegram', '.phone', 16);

  // 12) опрос ПК
  await open(base + '/index.html#survey-web');
  await normalize(page);
  await addFull('12-opros-pk');

  // 13) опрос ПК — заполненный (10 мест) + подтверждение
  await page.evaluate(async () => {
    for (let i = 0; i < 10; i++) {
      const b = document.querySelector('#viewHost [data-act="pick"]');
      if (b) b.click();
    }
  });
  await page.waitForTimeout(300);
  await addFull('13-opros-zapolnen');

  // 14) опрос телефон
  await open(base + '/index.html#survey-mobile');
  await normalize(page);
  await addClip('14-telefon-opros', '.phone', 16);

  // 15) рейтинг CRM — сотрудник вне Ядра
  await open(base + '/index.html#crm');
  await normalize(page);
  await addFull('15-crm-vne-yadra');

  // 16) рейтинг CRM — сотрудник в Ядре
  await page.evaluate(() => { const b = document.querySelector('[data-crm="core"]'); if (b) b.click(); });
  await page.waitForTimeout(400);
  await normalize(page);
  await page.evaluate(() => { document.documentElement.style.minHeight = '0'; document.body.style.minHeight = '0'; });
  await addFull('16-crm-v-yadre');

  // 17) отчёт руководству
  await open(base + '/index.html#report');
  await normalize(page);
  await addFull('17-otchet-rukovodstvu');

  await browser.close();
  srv.close();

  // ── сборка HTML-документа для печати ─────────────────────────────────────
  const items = shots.map((s, i) => {
    const b64 = s.buf.toString('base64');
    const dim = pngSize(s.buf);
    return { name: s.name, kind: s.kind, b64, idx: i + 1, src: 'data:image/png;base64,' + b64, h: dim.h, w: dim.w };
  });

  const humanName = (name) => ({
    'obzor': 'Обзор кампании',
    'pismo-priglashenie': 'Письмо · приглашение на Тинг',
    'pismo-napominanie': 'Письмо · напоминание (голос не отдан)',
    'pismo-reyting-opublikovan': 'Письмо · рейтинг опубликован',
    'pismo-v-yadre': 'Письмо · личное: вы в Ядре Дружины',
    'pismo-1-mesto': 'Письмо · поздравление, 1 место 🥇',
    'pismo-2-mesto': 'Письмо · поздравление, 2 место 🥈',
    'pismo-3-mesto': 'Письмо · поздравление, 3 место 🥉',
    'telefon-pochta': 'Телефон · почта, список писем',
    'telefon-pismo': 'Телефон · письмо открыто',
    'telegram': 'Telegram · уведомление от рабочего бота',
    'opros-pk': 'Опрос по ссылке · ПК',
    'opros-zapolnen': 'Опрос · выбрано 10 мест',
    'telefon-opros': 'Телефон · опрос',
    'crm-vne-yadra': 'CRM · виджет: сотрудник вне Ядра',
    'crm-v-yadre': 'CRM · виджет: сотрудник в Ядре',
    'otchet-rukovodstvu': 'Управленческий отчёт руководству'
  }[name.replace(/^\d+-/, '')] || name);

  const secs = items.map((s) => (
    '<section class="page">' +
    '<div class="phead"><span class="pn">' + String(s.idx).padStart(2, '0') + '</span>' +
    '<span class="pt">' + humanName(s.name) + '</span></div>' +
    '<div class="pbody"><img src="' + s.src + '" alt=""></div>' +
    '</section>'
  )).join('\n');

  const renderHtml = '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
    '<title>Тинг Асгарда — рендер кампании</title>' +
    '<style>' +
    '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
    'html,body{margin:0;padding:0;background:#0A0C10;}' +
    'body{font-family:Inter,"Segoe UI",Arial,sans-serif;color:#fff;}' +
    /* экранный режим: страницы как листы в столбик */
    '.doc{padding:26px 16px 60px;}' +
    '.page{width:210mm;min-height:297mm;margin:0 auto 22px;padding:11mm 11mm 9mm;background:#0A0C10;' +
      'display:flex;flex-direction:column;gap:7mm;overflow:hidden;' +
      'box-shadow:0 18px 50px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.09);border-radius:3px;}' +
    '.phead{display:flex;align-items:center;gap:12px;flex:0 0 auto;' +
      'padding:9px 15px;border-radius:11px;background:#151922;border:1px solid rgba(255,255,255,.11);' +
      'border-left:4px solid #D4A843;}' +
    '.pn{font:800 14px/1 ui-monospace,Consolas,monospace;color:#D4A843;}' +
    '.pt{font-size:14.5px;font-weight:800;letter-spacing:-.1px;}' +
    '.pbody{flex:1 1 auto;min-height:0;display:flex;align-items:flex-start;justify-content:center;}' +
    '.pbody img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;' +
      'object-position:top center;display:block;border-radius:10px;}' +
    /* титульная страница */
    '.cover{justify-content:center;gap:0;}' +
    '.cover .mk{display:inline-grid;place-items:center;width:74px;height:74px;border-radius:22px;' +
      'background:linear-gradient(145deg,#D4A843,#B8922E);color:#241B06;font-size:38px;margin-bottom:26px;}' +
    '.cover h1{font-size:44px;font-weight:800;letter-spacing:-1.4px;line-height:1.08;margin:0 0 18px;color:#fff;}' +
    '.cover h1 b{background:linear-gradient(90deg,#D4A843,#E8C35A);-webkit-background-clip:text;' +
      'background-clip:text;color:transparent;}' +
    '.cover p{color:rgba(255,255,255,.66);font-size:15px;line-height:1.7;max-width:150mm;margin:0 0 26px;}' +
    '.ctags{display:flex;flex-wrap:wrap;gap:9px;margin-bottom:30px;}' +
    '.ctag{padding:7px 14px;border-radius:999px;font-size:12px;font-weight:600;' +
      'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.8);}' +
    '.ctag.gold{background:rgba(212,168,67,.12);border-color:rgba(212,168,67,.4);color:#E8C35A;}' +
    '.cfoot{font-size:11.5px;color:rgba(255,255,255,.36);}' +
    /* печать: лист без полей, тёмный фон до края */
    '@page{size:A4;margin:0;}' +
    '@media print{' +
      'html,body{background:#0A0C10!important;}' +
      '.doc{padding:0;}' +
      '.page{width:210mm;height:296.8mm;min-height:0;margin:0;border-radius:0;box-shadow:none;' +
        'break-after:page;page-break-after:always;break-inside:avoid;page-break-inside:avoid;}' +
      '.page:last-child{break-after:auto;page-break-after:auto;}' +
    '}' +
    '</style></head><body><div class="doc">' +
    '<section class="page cover">' +
      '<div class="mk">⚔</div>' +
      '<h1>Тинг Асгарда<br><b>рейтинг ТОП-10 Дружины АСГАРД</b></h1>' +
      '<p>Полный рендер кампании: 7 писем сотрудникам (Яндекс.Почта — ПК и телефон), уведомление в Telegram, ' +
      'анонимный опрос, рейтинг-виджет в CRM на неделю и управленческий отчёт руководству.</p>' +
      '<div class="ctags">' +
        '<span class="ctag gold">⚔ стилистика АСГАРД</span>' +
        '<span class="ctag">' + (items.length - 1) + ' экранов кампании</span>' +
        '<span class="ctag">ТОП-10 · 1 место = 10 баллов</span>' +
        '<span class="ctag">анонимно · один раз</span>' +
      '</div>' +
      '<div class="cfoot">Прототип Asgard CRM · сотрудники и цифры вымышлены</div>' +
    '</section>' +
    secs +
    '</div></body></html>';

  fs.writeFileSync(path.join(ROOT, 'render.html'), renderHtml);
  console.log('render.html готов, страниц:', items.length + 1);

  // ── PDF через тот же chromium ────────────────────────────────────────────
  const b2 = await chromium.launch();
  const p2 = await b2.newPage();
  await p2.goto('file:///' + path.join(ROOT, 'render.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await p2.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { timeout: 60000 }).catch(() => {});
  await p2.waitForTimeout(900);
  await p2.pdf({
    path: OUT,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' }
  });
  await b2.close();

  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log('PDF готов:', OUT, '(' + kb + ' KB)');
})().catch((e) => { console.error('FAIL:', e && e.stack || e); process.exit(1); });
