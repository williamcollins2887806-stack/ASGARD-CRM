#!/usr/bin/env node
/**
 * verify_mimir_busy_stream.js — рантайм-гейт экрана расчёта Мимира (D-310).
 *
 * Предмет проверки (то, что было сломано и видно на скриншоте 22.10.2026):
 *   B1  шкала прогресса РАСТЁТ и не откатывается (раньше каждый SSE-heartbeat
 *       пересоздавал busy-экран и полоска начиналась с нуля);
 *   B2  таймер монотонно растёт и НЕ сбрасывается в 0:00 (было «время
 *       постоянно сбрасывается»);
 *   B3  процент растёт монотонно и не прыгает назад;
 *   B4  этапы переключаются вперёд (is-done/is-now), назад не откатываются;
 *   B5  светлая тема: текст и заливка контрастны (нет «серое по серому»);
 *   B6  тёмная тема: заливка золотая, текст не чёрный на чёрном;
 *   B7  живой поток рассуждений не вываливается простынёй — журнал свёрнут
 *       по умолчанию и раскрывается кнопкой;
 *   B8  prefers-reduced-motion: анимации отключены (нет бесконечного мерцания).
 *
 * Как: НЕ макет. Загружаем РЕАЛЬНЫЙ public/assets/js/personal_kanban.js в
 * chromium, подменяем только fetch (сеть) и дергаем настоящий
 * AsgardPKv3Modals.openQuick(). Всё, что меряем, — настоящий DOM модалки.
 *
 * Usage: node tools/verify_mimir_busy_stream.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? C.green + 'PASS' : C.red + 'FAIL'}${C.off}  ${name}${detail ? C.dim + '  — ' + detail + C.off : ''}`);
}

// ── CSS в порядке каскада из index.html (те же токены темы, что в проде) ──
const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const cssOrder = [];
for (const m of indexHtml.matchAll(/<link\b[^>]*?\bhref\s*=\s*["']([^"']+\.css)(?:\?[^"']*)?["']/gi)) {
  const rel = m[1].replace(/^\.?\//, '');
  if (/^https?:/i.test(rel)) continue;
  const abs = path.join(PUBLIC, rel);
  if (fs.existsSync(abs) && !cssOrder.includes(abs)) cssOrder.push(abs);
}
if (!cssOrder.length) {
  console.error(C.red + 'В public/index.html нет подключённых CSS — гейт бессмыслен.' + C.off);
  process.exit(1);
}
const linkTags = cssOrder
  .map((p) => `<link rel="stylesheet" href="file:///${p.replace(/\\/g, '/').replace(/ /g, '%20')}">`)
  .join('\n');

const KANBAN_JS = path.join(PUBLIC, 'assets', 'js', 'personal_kanban.js');
// Настоящий ui.js, а не заглушка: у него собственный глобальный Esc
// (_modalStack), и только с ним воспроизводится баг «один Esc = два окна».
const UI_JS = path.join(PUBLIC, 'assets', 'js', 'ui.js');

/**
 * Стенд: mock fetch отдаёт сессию в статусе calculating (как прод на 2–5 мин).
 * Поэтому openQuick сам открывает экран «Мимир считает смету» и держит его.
 * ВАЖНО: mock повторяет реальный контракт backend — heartbeat раз в 8 сек с
 * type=progress. Именно эти события раньше сбрасывали таймер.
 */
function harness(theme, reduceMotion, mode) {
  const estimating = mode === 'steps';
  return `<!doctype html><html lang="ru" data-theme="${theme}"><head><meta charset="utf-8">
${linkTags}
<style>
  html,body{margin:0;height:100%}
  body{background:var(--bg1);color:var(--t1);font-family:Inter,system-ui,sans-serif}
</style>
</head><body>
<script>
window.__reduceMotion = ${reduceMotion ? 'true' : 'false'};

// Минимальные заглушки, которых нет в статическом стенде (fetch, storage).
// AsgardUI — НАСТОЯЩИЙ (ui.js ниже), иначе не воспроизвести его глобальный Esc.
try { localStorage.setItem('asgard_token', 'test-token'); } catch (_) {}

const START = Date.now();
window.__sseHeartbeats = 0;

// Смета для проверки шагов/таблицы (step 2 → «К смете»).
const EST = {
  template: 'asgard_v1',
  meta: { title: 'Монтаж', customer: 'X', executor: 'Y' },
  params: { vat: 0.22, markup: 1.3, fot_tax: 0.302, overhead: 0.1, contingency: 0.05, days: 12, brigade: 6 },
  rows: [
    { id: 'a_1', kind: 'line', section: 'A', code: 'A1', name: 'ФОТ бригады', unit: 'ч/дн', qty: 72, price: 4200, sum: 302400 },
    { id: 'cost', kind: 'rollup', name: 'Себестоимость', sum: 302400, sumExpr: 'cost' }
  ],
  totals: { cost: 302400, price_no_vat: 393120, price_with_vat: 479606 }
};

window.fetch = async (url, init) => {
  const u = String(url);
  const json = (o) => new Response(JSON.stringify(o), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });

  if (u.includes('/api/settings/vat_default_pct')) return json({ value: 22 });

  ${mode === 'fail' ? `
  // ── Краевой случай ошибки расчёта ──
  // Сессия пустая (не existing) → фронт на шаге 0; жмём «Запустить»; SSE
  // присылает start и обрывается БЕЗ результата → «AI ничего не вернул»;
  // опрос сессии возвращает status=error → экран обязан показать ошибку,
  // НЕ пересоздавая таймер/шкалу/этап.
  if (u.includes('/start-quick')) {
    return json({ session_uid: 'deadbeefcafe0001', status: 'draft', tender_attachments: [] });
  }
  if (/\\/calculate$/.test(u)) {
    const body = 'data: ' + JSON.stringify({ type: 'start', message: 'Мимир приступает…' }) + '\\n\\n';
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(body));
        setTimeout(() => c.close(), 300);
      }
    });
    return new Response(stream, {
      status: 200, headers: { 'Content-Type': 'text/event-stream' }
    });
  }
  if (/\\/api\\/tkp-quick\\/sessions\\/[^/]+$/.test(u)) {
    return json({ status: 'error', error_text: 'провайдер недоступен', chat_messages: [] });
  }
  return json({});
` : ''}

  if (u.includes('/start-quick')) {
    return json({ session_uid: 'deadbeefcafe0001', status: 'existing', tender_attachments: [] });
  }

  if (/\\/api\\/tkp-quick\\/sessions\\/[^/]+$/.test(u)) {
    ${estimating ? `
    // Режим «есть смета» — модалка открывается на шаге диалога (2).
    return json({ status: 'chatting', estimate_draft: EST,
      chat_messages: [{ role: 'assistant', content: 'ok', estimate: EST }] });` : `
    // Режим ожидания: держим 'calculating' + heartbeat раз в 8 сек — именно
    // этот поток событий раньше сбрасывал таймер и шкалу.
    const el = Math.floor((Date.now() - START) / 1000);
    if (el > 0 && el % 8 === 0) window.__sseHeartbeats++;
    return json({ status: 'calculating', chat_messages: [] });`}
  }
  return json({});
};

// Эмуляция reduced-motion до запуска модуля.
if (window.__reduceMotion) {
  const _mm = window.matchMedia.bind(window);
  window.matchMedia = (q) => (String(q).includes('prefers-reduced-motion')
    ? { matches: true, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }
    : _mm(q));
}
</script>
<script src="file:///${UI_JS.replace(/\\/g, '/').replace(/ /g, '%20')}"></script>
<script src="file:///${KANBAN_JS.replace(/\\/g, '/').replace(/ /g, '%20')}"></script>
</body></html>`;
}

const MEASURE = `(() => {
  const root = document.querySelector('.pk3-mimir-busy');
  if (!root) return { missing: true };
  const card = root.querySelector('.pk3-bz-card');
  const fill = root.querySelector('.pk3-bz-fill');
  const pctEl = root.querySelector('.pk3-bz-pct');
  const timeEl = root.querySelector('.pk3-bz-time b');
  const hintEl = root.querySelector('.pk3-bz-hint');
  const live = root.querySelector('.pk3-bz-live-text');
  const thoughts = root.querySelector('.pk3-mimir-thoughts');
  const more = root.querySelector('.pk3-bz-more');
  const cs = (el) => el ? getComputedStyle(el) : null;
  const parsePct = (t) => {
    const m = String(t || '').match(/(\\d+)/);
    return m ? Number(m[1]) : null;
  };
  const parseTime = (t) => {
    const m = String(t || '').match(/(\\d+):(\\d+)/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const scaleX = () => {
    const tr = fill ? getComputedStyle(fill).transform : '';
    const m = String(tr).match(/matrix\\(([^)]+)\\)/);
    if (m) return Number(m[1].split(',')[0]);
    return tr === 'none' ? 1 : 0;
  };
  const stageNodes = Array.from(root.querySelectorAll('.pk3-bz-stage'));
  return {
    missing: false,
    cardH: card ? Math.round(card.getBoundingClientRect().height) : 0,
    viewportH: window.innerHeight,
    fillScale: scaleX(),
    pct: parsePct(pctEl && pctEl.textContent),
    timeSec: parseTime(timeEl && timeEl.textContent),
    hint: hintEl ? hintEl.textContent : '',
    liveText: live ? live.textContent : '',
    thoughtsDisplay: thoughts ? cs(thoughts).display : 'absent',
    moreExpanded: more ? more.classList.contains('is-open') : null,
    stages: stageNodes.map((el) => ({
      txt: el.textContent.trim(),
      done: el.classList.contains('is-done'),
      now: el.classList.contains('is-now')
    })),
    colors: {
      title: cs(root.querySelector('.pk3-bz-title')).color,
      note: cs(root.querySelector('.pk3-bz-note')).color,
      liveBg: cs(root.querySelector('.pk3-bz-live')).backgroundColor,
      liveText: cs(live).color,
      frameBg: cs(card).backgroundColor,
      barBg: cs(root.querySelector('.pk3-bz-bar')).backgroundColor,
      fillImg: cs(fill).backgroundImage,
      stageNowBg: cs(root.querySelector('.pk3-bz-stage.is-now')).backgroundColor,
    },
    crestAnim: cs(root.querySelector('.pk3-bz-crest i')).animationName,
    shineAnim: cs(root.querySelector('.pk3-bz-shine')).animationName,
  };
})()`;

/* Шаги мастера и таблица сметы — вне busy-экрана, поэтому меряем отдельно.
   D-310: именно тут «на светлой теме всё блёкло» — старые цвета #6DCB96 /
   #E8C96A на белом давали контраст ниже 2:1. */
const MEASURE_STEPS = `(() => {
  const cs = (el) => el ? getComputedStyle(el) : null;
  const steps = Array.from(document.querySelectorAll('[data-mimir-quick="1"] .pk3-wiz-step'));
  const qin = document.querySelector('[data-mimir-quick="1"] .pk3-qin');
  const ovBg = cs(document.querySelector('[data-mimir-quick="1"] .pk3-modal')).backgroundColor;
  // Реальная подложка под шагом: рейл .pk3-wiz-steps (там var(--brd-m)), а не
  // модалка. На светлой теме --brd-m тёмный — на нём и видно реальный контраст.
  const rail = document.querySelector('[data-mimir-quick="1"] .pk3-wiz-steps');
  return {
    count: steps.length,
    railBg: rail ? cs(rail).backgroundColor : null,
    steps: steps.map((el) => ({
      cls: el.className,
      bg: cs(el).backgroundColor,
      color: cs(el).color
    })),
    modalBg: ovBg,
    qinBg: qin ? cs(qin).backgroundColor : 'none',
    qinBorder: qin ? cs(qin).borderTopColor : 'none',
    qinColor: qin ? cs(qin).color : 'none'
  };
})()`;

function rgb(str) {
  const m = String(str || '').match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((x) => Number(x.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] };
}
/** Наложить цвет на подложку. Принимает и строку, и уже посчитанный объект. */
function over(fg, bg) {
  const f = typeof fg === 'string' ? rgb(fg) : fg;
  const b = typeof bg === 'string' ? rgb(bg) : bg;
  if (!f) return null;
  if (!b) return f;
  const a = f.a == null ? 1 : f.a;
  if (a >= 1) return { r: f.r, g: f.g, b: f.b, a: 1 };
  return {
    r: Math.round(f.r * a + b.r * (1 - a)),
    g: Math.round(f.g * a + b.g * (1 - a)),
    b: Math.round(f.b * a + b.b * (1 - a)),
    a: 1
  };
}
function lum(c) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
/** Контраст с композитом: fg поверх bgBase, и bgBase как реальная подложка. */
function contrast(fgStr, bgStr, bgBase) {
  const bgSolid = bgBase ? over(bgStr, bgBase) : rgb(bgStr);
  const fgSolid = bgBase ? over(fgStr, over(bgStr, bgBase)) : rgb(fgStr);
  if (!fgSolid || !bgSolid) return null;
  const L1 = Math.max(lum(fgSolid), lum(bgSolid));
  const L2 = Math.min(lum(fgSolid), lum(bgSolid));
  return Math.round(((L1 + 0.05) / (L2 + 0.05)) * 100) / 100;
}
/**
 * Контраст по СТЕКУ слоёв — так меряется реальный пиксель: текст поверх
 * полупрозрачного шага, шаг поверх полупрозрачного рейла, рейл поверх модалки.
 * Без этого гейт завышал контраст (найдено верификатором 22.10.2026).
 */
function contrastLayers(fgStr, layers) {
  // Композим снизу вверх: последний слой — самая глубокая подложка.
  let base = layers.length ? rgb(layers[layers.length - 1]) : null;
  base = base || { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 2; i >= 0; i--) base = over(layers[i], base);
  const fgSolid = over(fgStr, base);
  if (!fgSolid || !base) return null;
  const L1 = Math.max(lum(fgSolid), lum(base));
  const L2 = Math.min(lum(fgSolid), lum(base));
  return Math.round(((L1 + 0.05) / (L2 + 0.05)) * 100) / 100;
}

const MEASURE_FAIL = `(() => {
  const root = document.querySelector('.pk3-mimir-busy');
  if (!root) return { missing: true };
  const cs = (el) => el ? getComputedStyle(el) : null;
  const parseTime = (t) => {
    const m = String(t || '').match(/(\\d+):(\\d+)/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const tr = cs(root.querySelector('.pk3-bz-fill')).transform;
  const m = String(tr).match(/matrix\\(([^)]+)\\)/);
  return {
    missing: false,
    isFailed: root.classList.contains('is-failed'),
    timeSec: parseTime((root.querySelector('.pk3-bz-time b') || {}).textContent),
    fill: m ? Number(m[1].split(',')[0]) : (tr === 'none' ? 1 : 0),
    stageNow: Array.from(root.querySelectorAll('.pk3-bz-stage')).findIndex((el) => el.classList.contains('is-now')),
    hasExitBtn: !!root.querySelector('.pk3-bz-actions .pk3-bz-btn'),
    actionsDisplay: cs(root.querySelector('.pk3-bz-actions')) ? cs(root.querySelector('.pk3-bz-actions')).display : 'absent',
    errBg: cs(root.querySelector('.pk3-bz-live')).backgroundColor,
    titleText: (root.querySelector('.pk3-bz-title') || {}).textContent
  };
})()`;

/* Мелкий текст экрана расчёта (D-310, найдено верификатором): kicker/hint/foot/
   more-btn были на var(--t3) = rgba(255,255,255,.40) → 3.34–3.81:1 на --bg2.
   Это ниже WCAG AA и хуже старого экрана (6.23:1). Меряем реальный стек слоёв. */
const MEASURE_SMALL = `(() => {
  const root = document.querySelector('.pk3-mimir-busy');
  if (!root) return { missing: true };
  const cs = (el) => el ? getComputedStyle(el) : null;
  const card = root.querySelector('.pk3-bz-card');
  const frame = cs(card).backgroundColor;
  const layer = (sel) => {
    const el = root.querySelector(sel);
    if (!el) return null;
    const c = cs(el);
    // opacity на самом элементе (не на предках: у оверлея идёт анимация
    // появления, и её промежуточное значение не про контраст текста).
    const own = Number(cs(el).opacity);
    return { color: c.color, bg: cs(el).backgroundColor, opacity: isFinite(own) ? own : 1 };
  };
  return {
    missing: false,
    frame,
    items: {
      kicker: layer('.pk3-bz-kicker'),
      hint: layer('.pk3-bz-hint'),
      foot: layer('.pk3-bz-foot'),
      moreBtn: layer('.pk3-bz-more-btn'),
      time: layer('.pk3-bz-time'),
      meta: layer('.pk3-bz-meta'),
      // Чипы этапов раньше не входили в проверку — из-за этого B12 был зелёным
      // при фактических 3.74:1 (тёмная) и 4.46:1 (светлая, is-done).
      stageUpcoming: layer('.pk3-bz-stage:not(.is-now):not(.is-done)'),
      stageDone: layer('.pk3-bz-stage.is-done'),
      stageNow: layer('.pk3-bz-stage.is-now')
    }
  };
})()`;

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) {
    console.error(C.red + 'Нет playwright: npm i -D playwright && npx playwright install chromium' + C.off);
    process.exit(1);
  }

  const darkPath = path.join(os.tmpdir(), 'asgard-mimir-busy-dark.html');
  const lightPath = path.join(os.tmpdir(), 'asgard-mimir-busy-light.html');
  const rmPath = path.join(os.tmpdir(), 'asgard-mimir-busy-rm.html');
  const stepsLightPath = path.join(os.tmpdir(), 'asgard-mimir-steps-light.html');
  const stepsDarkPath = path.join(os.tmpdir(), 'asgard-mimir-steps-dark.html');
  fs.writeFileSync(darkPath, harness('dark', false), 'utf8');
  fs.writeFileSync(lightPath, harness('light', false), 'utf8');
  fs.writeFileSync(rmPath, harness('dark', true), 'utf8');
  fs.writeFileSync(stepsLightPath, harness('light', false, 'steps'), 'utf8');
  fs.writeFileSync(stepsDarkPath, harness('dark', false, 'steps'), 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));

  async function openBusy(file) {
    await page.goto('file:///' + file.replace(/\\/g, '/'));
    await page.waitForFunction(() => !!window.AsgardPKv3Modals, null, { timeout: 15000 });
    await page.evaluate(() => {
      window.AsgardPKv3Modals.openQuick({
        id: 1, customer_name: 'ООО «Тест»', work_description: 'Монтаж',
        email_attachments: [], entity_kind: 'pre_tender', entity_id: 1
      }, {});
    });
    await page.waitForSelector('.pk3-mimir-busy', { timeout: 15000 });
  }

  // ── Тёмная тема: серия замеров, пока идёт «расчёт» ──
  await openBusy(darkPath);
  const darkSmall = await page.evaluate(MEASURE_SMALL);
  const dark = [];
  for (let i = 0; i < 6; i++) {
    dark.push(await page.evaluate(MEASURE));
    await page.waitForTimeout(1150);
  }

  // Свёрнутый журнал → раскрываем кнопкой.
  await page.click('.pk3-bz-more-btn');
  await page.waitForTimeout(180);
  const opened = await page.evaluate(MEASURE);

  // ── Светлая тема ──
  await openBusy(lightPath);
  await page.waitForTimeout(1600);
  const light = await page.evaluate(MEASURE);
  const lightSmall = await page.evaluate(MEASURE_SMALL);

  // Шаги мастера и ячейки сметы: нужен режим «есть смета» (step 2), а не busy.
  async function stepProbe(file) {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await p.goto('file:///' + file.replace(/\\/g, '/'));
    await p.waitForFunction(() => !!window.AsgardPKv3Modals, null, { timeout: 15000 });
    await p.evaluate(() => {
      window.AsgardPKv3Modals.openQuick({
        id: 1, customer_name: 'ООО «Тест»', work_description: 'Монтаж',
        email_attachments: [], entity_kind: 'pre_tender', entity_id: 1
      }, {});
    });
    await p.waitForSelector('[data-mimir-quick="1"] .pk3-modal', { timeout: 15000 });
    await p.waitForTimeout(1200);
    const btn = await p.$('[data-act="to-smeta"]');
    if (btn) { await btn.click(); await p.waitForTimeout(900); }
    const r = await p.evaluate(MEASURE_STEPS);
    await p.close();
    return r;
  }

  // ── reduced-motion ──
  // ВАЖНО: CSS-медиазапросы оценивает браузер, а не JS matchMedia — поэтому
  // эмулируем через Playwright (page.emulateMedia), иначе проверка была бы
  // фиктивной (PASS без доказательства).
  const rmPage = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await rmPage.emulateMedia({ reducedMotion: 'reduce' });
  await rmPage.goto('file:///' + rmPath.replace(/\\/g, '/'));
  await rmPage.waitForFunction(() => !!window.AsgardPKv3Modals, null, { timeout: 15000 });
  await rmPage.evaluate(() => {
    window.AsgardPKv3Modals.openQuick({
      id: 1, customer_name: 'ООО «Тест»', work_description: 'Монтаж',
      email_attachments: [], entity_kind: 'pre_tender', entity_id: 1
    }, {});
  });
  await rmPage.waitForSelector('.pk3-mimir-busy', { timeout: 15000 });
  await rmPage.waitForTimeout(500);
  const rm = await rmPage.evaluate(MEASURE);
  await rmPage.close();

  // Шаги мастера (нужен живой браузер — measure до close).
  const stepsLight = await stepProbe(stepsLightPath);
  const stepsDark = await stepProbe(stepsDarkPath);

  // ── Краевой случай: ошибка расчёта (B11) ──
  // Раньше экран пересоздавался: время 0:03 → 0:00, шкала 27 % → 0, этап 2 → 0,
  // и модалка запиралась (оверлей перекрывал шапку). Теперь он замирает.
  const failPath = path.join(os.tmpdir(), 'asgard-mimir-fail.html');
  fs.writeFileSync(failPath, harness('dark', false, 'fail'), 'utf8');
  const failPage = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const failErrors = [];
  failPage.on('pageerror', (e) => failErrors.push(String(e.message || e)));
  // Инструментируем ДО открытия модалки, иначе счётчик увидит 0 подписок и
  // проверка станет вакуумной (как было в первом прогоне: add=0).
  await failPage.addInitScript(() => {
    window.__kd = { added: 0, removed: 0 };
    const origAdd = document.addEventListener.bind(document);
    const origRem = document.removeEventListener.bind(document);
    document.addEventListener = function (t, fn, o) {
      if (t === 'keydown') window.__kd.added++;
      return origAdd(t, fn, o);
    };
    document.removeEventListener = function (t, fn, o) {
      if (t === 'keydown') window.__kd.removed++;
      return origRem(t, fn, o);
    };
  });
  await failPage.goto('file:///' + failPath.replace(/\\/g, '/'));
  await failPage.waitForFunction(() => !!window.AsgardPKv3Modals, null, { timeout: 15000 });
  await failPage.evaluate(() => {
    window.AsgardPKv3Modals.openQuick({
      id: 1, customer_name: 'ООО «Тест»', work_description: 'Монтаж',
      email_attachments: [], entity_kind: 'pre_tender', entity_id: 1
    }, {});
  });
  await failPage.waitForSelector('.pk3-modal', { timeout: 15000 });
  // В режиме fail сессия пустая → нажимаем «Запустить», чтобы стартовать расчёт.
  const runBtn = await failPage.$('[data-act="upload"]');
  if (runBtn) await runBtn.click();
  await failPage.waitForSelector('.pk3-mimir-busy', { timeout: 15000 });
  await failPage.waitForTimeout(1400);
  const beforeFail = await failPage.evaluate(MEASURE_FAIL);
  // Дожидаемся, пока бэкенд-мок вернёт пустой результат → путь ошибки.
  await failPage.waitForFunction(
    () => document.querySelector('.pk3-mimir-busy.is-failed') != null,
    null, { timeout: 25000 }
  ).catch(() => {});
  await failPage.waitForTimeout(700);
  const afterFail = await failPage.evaluate(MEASURE_FAIL);
  // Кнопка выхода должна реально снимать экран.
  let exitWorks = false;
  const exitBtn = await failPage.$('.pk3-bz-actions .pk3-bz-btn');
  if (exitBtn) {
    await exitBtn.click();
    await failPage.waitForTimeout(320);
    exitWorks = (await failPage.$('.pk3-mimir-busy')) === null;
  }

  // B13: циклы «модалка → ошибка → выход кнопкой». Считаем ПРИРОСТ незакрытых
  // подписок за цикл. Глобальные обработчики страницы (модульный Escape,
  // mountModal) живут всё время — их нельзя считать утечкой, поэтому база
  // снимается после первого открытия модалки.
  const leakSnapshots = [];
  for (let i = 0; i < 3; i++) {
    if (i > 0) {
      // Переоткрываем модалку заново: иначе повторного _bzFail не будет.
      await failPage.evaluate(() => {
        document.querySelectorAll('.pk3-modal-overlay[data-mimir-quick="1"]').forEach((el) => el.remove());
      });
      await failPage.evaluate(() => {
        window.AsgardPKv3Modals.openQuick({
          id: 1, customer_name: 'ООО «Тест»', work_description: 'Монтаж',
          email_attachments: [], entity_kind: 'pre_tender', entity_id: 1
        }, {});
      });
      await failPage.waitForSelector('.pk3-modal', { timeout: 15000 });
      const r2 = await failPage.$('[data-act="upload"]');
      if (r2) await r2.click();
    }
    await failPage.waitForFunction(
      () => !!document.querySelector('.pk3-mimir-busy.is-failed'), null, { timeout: 20000 }
    ).catch(() => {});
    const b = await failPage.$('.pk3-bz-actions .pk3-bz-btn');
    if (b) { await b.click(); await failPage.waitForTimeout(260); }
    leakSnapshots.push(await failPage.evaluate(() => ({
      added: window.__kd.added, removed: window.__kd.removed
    })));
  }
  const leak = { snapshots: leakSnapshots, added: leakSnapshots.length ? leakSnapshots[leakSnapshots.length - 1].added : 0, removed: leakSnapshots.length ? leakSnapshots[leakSnapshots.length - 1].removed : 0 };
  await failPage.close();

  // B14 — один Esc закрывает ровно одно окно (Quick поверх модалки отчёта).
  // ВАЖНО: до browser.close(), иначе «Target page has been closed».
  // Нижний слой намеренно СО СВОИМ Esc-обработчиком — как настоящий
  // AsgardUI.showModal (ui.js). Без него фикстура была вакуумной: B14
  // зеленел даже при удалённом фиксе (mutation-проверка верификатора).
  const escPage = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await escPage.goto('file:///' + darkPath.replace(/\\/g, '/'));
  await escPage.waitForFunction(() => !!window.AsgardPKv3Modals && !!window.AsgardUI, null, { timeout: 15000 });
  await escPage.evaluate(() => {
    // НАСТОЯЩАЯ модалка отчёта (ui.js showModal) — со своим глобальным Esc.
    window.AsgardUI.showModal({ title: 'Модалка отчёта', html: '<p>под низом</p>' });
    window.AsgardPKv3Modals.openQuick({
      id: 1, customer_name: 'ООО «Тест», работа', work_description: 'Монтаж',
      email_attachments: [], entity_kind: 'pre_tender', entity_id: 1
    }, {});
  });
  await escPage.waitForSelector('.pk3-mimir-busy', { timeout: 15000 });
  await escPage.waitForTimeout(600);
  const beforeEsc = await escPage.evaluate(() => ({
    quick: document.querySelectorAll('.pk3-modal-overlay[data-mimir-quick="1"]').length,
    under: document.querySelectorAll('.cr-m-overlay').length
  }));
  await escPage.keyboard.press('Escape');
  await escPage.waitForTimeout(400);
  const afterEsc = await escPage.evaluate(() => ({
    quick: document.querySelectorAll('.pk3-modal-overlay[data-mimir-quick="1"]').length,
    under: document.querySelectorAll('.cr-m-overlay').length
  }));
  await escPage.close();
  const closedCount = (beforeEsc.quick - afterEsc.quick) + (beforeEsc.under - afterEsc.under);
  check('B14 один Esc закрывает ровно одно окно (верхнее)',
    closedCount === 1 && afterEsc.under >= 1,
    `было quick=${beforeEsc.quick}/отчёт=${beforeEsc.under} → стало quick=${afterEsc.quick}/отчёт=${afterEsc.under} (закрыто=${closedCount})`);

  // B16 — два окна канбана с ОДИНАКОВЫМ z (20100 у openReferences/openSend).
  // Прежняя версия сравнивала z и объявляла нетоповыми оба окна: Esc не
  // закрывал НИЧЕГО (три нажатия — ноль). Теперь порядок берётся из стека
  // открытия. Проверка обязательна: этот класс регрессии не ловил ни один гейт.
  const pairPath = path.join(os.tmpdir(), 'asgard-mimir-pair.html');
  fs.writeFileSync(pairPath, harness('dark', false), 'utf8');
  const pairPage = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await pairPage.goto('file:///' + pairPath.replace(/\\/g, '/'));
  await pairPage.waitForFunction(() => !!window.AsgardPKv3Modals, null, { timeout: 15000 });
  await pairPage.evaluate(() => {
    document.querySelectorAll('.pk3-modal-overlay[data-mimir-quick="1"]').forEach((el) => el.remove());
    window.AsgardPKv3Modals.openReferences({ id: 1, customer_name: 'X', email_attachments: [] });
  });
  await pairPage.waitForTimeout(500);
  await pairPage.evaluate(() => window.AsgardPKv3Modals.openReferences({ id: 2, customer_name: 'Y', email_attachments: [] }));
  await pairPage.waitForTimeout(500);
  const pairBefore = await pairPage.evaluate(() => ({
    n: document.querySelectorAll('.pk3-modal-overlay').length,
    zs: Array.from(document.querySelectorAll('.pk3-modal-overlay'))
      .map((el) => Number(getComputedStyle(el).zIndex) || 0)
  }));
  await pairPage.keyboard.press('Escape');
  await pairPage.waitForTimeout(400);
  const pairAfter = await pairPage.evaluate(() => ({
    n: document.querySelectorAll('.pk3-modal-overlay').length
  }));
  await pairPage.close();
  check('B16 два окна с ОДИНАКОВЫМ z: Esc закрывает ровно одно (не ноль)',
    pairBefore.n === 2 && pairAfter.n === 1,
    `z=${JSON.stringify(pairBefore.zs)}: ${pairBefore.n} → ${pairAfter.n}`);


  // B15 — Esc на экране ошибки снимает ТОЛЬКО экран, модалку не закрывает.
  // Регрессия раунда: `_bzFail` передавал в _isTopmostOverlay сам
  // .pk3-mimir-busy (z=80) вместо overlay (z=13000) → условие всегда ложно,
  // и Esc закрывал окно целиком.
  // ВАЖНО: гоняем РЕАЛЬНЫЙ путь ошибки (SSE обрыв → _bzFail), а не выставляем
  // класс вручную — иначе Esc-обработчик не создаётся и тест врёт.
  const failEscPath = path.join(os.tmpdir(), 'asgard-mimir-fail-esc.html');
  fs.writeFileSync(failEscPath, harness('dark', false, 'fail'), 'utf8');
  const errEsc = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await errEsc.goto('file:///' + failEscPath.replace(/\\/g, '/'));
  await errEsc.waitForFunction(() => !!window.AsgardPKv3Modals, null, { timeout: 15000 });
  await errEsc.evaluate(() => {
    window.AsgardPKv3Modals.openQuick({
      id: 1, customer_name: 'ООО «Тест», работа', work_description: 'Монтаж',
      email_attachments: [], entity_kind: 'pre_tender', entity_id: 1
    }, {});
  });
  await errEsc.waitForSelector('.pk3-modal', { timeout: 15000 });
  const runErr = await errEsc.$('[data-act="upload"]');
  if (runErr) await runErr.click();
  await errEsc.waitForFunction(
    () => !!document.querySelector('.pk3-mimir-busy.is-failed'), null, { timeout: 25000 }
  ).catch(() => {});
  await errEsc.waitForTimeout(300);
  const errBefore = await errEsc.evaluate(() => ({
    quick: document.querySelectorAll('.pk3-modal-overlay[data-mimir-quick="1"]').length,
    busy: document.querySelectorAll('.pk3-mimir-busy').length,
    failed: !!document.querySelector('.pk3-mimir-busy.is-failed')
  }));
  await errEsc.keyboard.press('Escape');
  await errEsc.waitForTimeout(400);
  const errAfter = await errEsc.evaluate(() => ({
    quick: document.querySelectorAll('.pk3-modal-overlay[data-mimir-quick="1"]').length,
    busy: document.querySelectorAll('.pk3-mimir-busy').length
  }));
  await errEsc.close();
  check('B15 экран ошибки реально показан (тест не вакуумный)',
    errBefore.failed === true, `is-failed=${errBefore.failed}, busy=${errBefore.busy}`);
  check('B15 Esc снимает только экран ошибки, модалка остаётся',
    errBefore.quick === 1 && errBefore.busy === 1
      && errAfter.busy === 0 && errAfter.quick === 1,
    `до: busy=${errBefore.busy}/модалка=${errBefore.quick} → после Esc: busy=${errAfter.busy}/модалка=${errAfter.quick}`);


  await browser.close();

  const first = dark[0];
  if (first.missing) {
    console.error(C.red + 'Экран расчёта не появился — дальнейшие проверки бессмысленны.' + C.off);
    process.exit(1);
  }

  console.log(`\n${C.dim}замеры (сек / fill / % / этап): ${dark.map((s) =>
    `${s.timeSec} / ${s.fillScale.toFixed(3)} / ${s.pct}% / ${s.stages.findIndex((x) => x.now)}`).join('  →  ')}${C.off}\n`);

  // B1 — шкала растёт и не откатывается
  let fillMono = true;
  let fillGrew = false;
  for (let i = 1; i < dark.length; i++) {
    if (dark[i].fillScale + 0.0005 < dark[i - 1].fillScale) fillMono = false;
    if (dark[i].fillScale > dark[i - 1].fillScale + 0.002) fillGrew = true;
  }
  check('B1 шкала растёт и не откатывается ни на одном кадре', fillMono,
    `замеры: ${dark.map((s) => s.fillScale.toFixed(3)).join(' → ')}`);
  check('B1 шкала реально движется (не «мёртвая полоска»)', fillGrew,
    `${first.fillScale.toFixed(3)} → ${dark[dark.length - 1].fillScale.toFixed(3)}`);
  check('B1 шкала не выходит за 1.0', dark.every((s) => s.fillScale <= 1.0005),
    `max=${Math.max(...dark.map((s) => s.fillScale)).toFixed(3)}`);

  // B2 — таймер монотонен и не сбрасывается (это и был баг «время сбрасывается»)
  let timeMono = true;
  for (let i = 1; i < dark.length; i++) {
    if (dark[i].timeSec < dark[i - 1].timeSec) timeMono = false;
  }
  check('B2 таймер растёт и НЕ сбрасывается в 0:00', timeMono,
    dark.map((s) => s.timeSec + 'с').join(' → '));
  check('B2 таймер отстаёт от реального времени не больше чем на 2 с',
    Math.abs(dark[dark.length - 1].timeSec - (5 * 1.15 + 1)) < 2.6,
    `показано ${dark[dark.length - 1].timeSec}с при ~${(5 * 1.15 + 1).toFixed(1)}с прогона`);

  // B3 — процент монотонен
  let pctMono = true;
  for (let i = 1; i < dark.length; i++) {
    if ((dark[i].pct || 0) < (dark[i - 1].pct || 0)) pctMono = false;
  }
  check('B3 процент монотонен', pctMono, dark.map((s) => s.pct + '%').join(' → '));
  check('B3 процент согласован со шкалой (±2 п.п.)',
    dark.every((s) => Math.abs(s.pct - Math.round(s.fillScale * 100)) <= 2),
    dark.map((s) => `${Math.round(s.fillScale * 100)}/${s.pct}`).join(' '));

  // B4 — этапы
  const nowCounts = first.stages.map((s) => first.stages.filter((x) => x.now).length);
  check('B4 этапов 4 и активен ровно один',
    first.stages.length === 4 && nowCounts.length === 4 && first.stages.filter((s) => s.now).length === 1,
    first.stages.map((s) => s.txt + (s.now ? '*' : s.done ? '+' : '')).join(' | '));
  const idxSeq = dark.map((s) => s.stages.findIndex((x) => x.now));
  const idxMono = idxSeq.every((v, i) => i === 0 || v >= idxSeq[i - 1]);
  check('B4 активный этап не откатывается назад', idxMono, `последовательность: ${idxSeq.join(' → ')}`);

  // B5 — светлая тема: контраст
  const lightTitle = contrast(light.colors.title, light.colors.frameBg);
  const lightNote = contrast(light.colors.note, light.colors.frameBg);
  const lightLive = contrast(light.colors.liveText, light.colors.liveBg);
  check('B5 светлая тема: заголовок контрастен (≥7:1)', lightTitle >= 7,
    `«${light.colors.title}» на «${light.colors.frameBg}» = ${lightTitle}:1`);
  check('B5 светлая тема: пояснение контрастно (≥4.5:1)', lightNote >= 4.5,
    `${lightNote}:1`);
  check('B5 светлая тема: строка статуса в потоке контрастна (≥7:1)', lightLive >= 7,
    `«${light.colors.liveText}» на «${light.colors.liveBg}» = ${lightLive}:1`);
  check('B5 светлая тема: заливка шкалы не серо-белая', /gradient/.test(light.colors.fillImg || '')
    && !/rgb\(2\d\d, 2\d\d, 2\d\d\)/.test(light.colors.fillImg || ''),
    String(light.colors.fillImg).slice(0, 78));
  check('B5 светлая тема: активный этап подкрашен, а не «как все»',
    light.colors.stageNowBg !== 'rgba(0, 0, 0, 0)' && light.colors.stageNowBg !== 'transparent',
    `bg=${light.colors.stageNowBg}`);

  // B6 — тёмная тема
  const darkTitle = contrast(first.colors.title, first.colors.frameBg);
  const darkLive = contrast(first.colors.liveText, first.colors.liveBg);
  check('B6 тёмная тема: заголовок контрастен (≥7:1)', darkTitle >= 7, `${darkTitle}:1`);
  check('B6 тёмная тема: строка статуса контрастна (≥4.5:1)', darkLive >= 4.5, `${darkLive}:1`);
  check('B6 тёмная тема: заливка шкалы золотая',
    /gradient/.test(String(first.colors.fillImg)) && /212,\s*168,\s*67|232,\s*195,\s*90|184,\s*132,\s*26/.test(String(first.colors.fillImg)),
    String(first.colors.fillImg).slice(0, 78));
  check('B6 карточка не выше экрана (не режет футер)', first.cardH <= first.viewportH - 20,
    `card=${first.cardH}px, viewport=${first.viewportH}px`);

  // B7 — журнал свёрнут, живая строка одна
  check('B7 журнал рассуждений свёрнут по умолчанию', first.thoughtsDisplay === 'none',
    `display=${first.thoughtsDisplay}`);
  check('B7 журнал раскрывается кнопкой', opened.thoughtsDisplay !== 'none' && opened.moreExpanded === true,
    `display=${opened.thoughtsDisplay}, is-open=${opened.moreExpanded}`);
  check('B7 живой статус — одна строка, а не простыня',
    String(first.liveText).length <= 460 && !/\n/.test(first.liveText),
    `${String(first.liveText).length} симв., одна строка`);

  // B8 — reduced motion
  check('B8 prefers-reduced-motion: анимации выключены',
    rm.crestAnim === 'none' && rm.shineAnim === 'none',
    `crest=${rm.crestAnim}, shine=${rm.shineAnim}`);

  // ── B9/B10: шаги мастера и ячейки сметы (продолжение «блеклости») ──
  const sl = stepsLight;
  const sd = stepsDark;
  // ВАЖНО (найдено верификатором 22.10.2026): подложка шага — не --bg2, а
  // композит --gold-bg/--ok-bg ПОВЕРХ рейла шагов (var(--brd-m) на светлой
  // теме тёмный). Меряем реальный композит, иначе гейт зелёный при провале WCAG.
  const stepContrast = (probe) => probe.steps.map((s) => {
    const c = contrastLayers(s.color, [s.bg, probe.railBg, probe.modalBg]);
    return { cls: s.cls, color: s.color, bg: s.bg, ratio: c };
  });
  const slC = stepContrast(sl);
  check('B9 светлая тема: у каждого шага мастера контраст ≥4.5:1',
    slC.every((s) => s.ratio != null && s.ratio >= 4.5),
    slC.map((s) => s.cls.replace('pk3-wiz-step', '').trim() + '=' + s.ratio).join(' '));
  check('B9 светлая тема: активный шаг золотой и контрастный (--gold-h)',
    sl.steps.some((s) => s.cls.includes('pk3-now') && /rgb\(122, 84, 15\)/.test(s.color)),
    sl.steps.filter((s) => s.cls.includes('pk3-now')).map((s) => s.color).join(' '));
  check('B9 светлая тема: пройденный шаг тёмно-зелёный, а не бледный #6DCB96',
    sl.steps.some((s) => s.cls.includes('pk3-done') && /rgb\(14, 102, 52\)/.test(s.color)),
    sl.steps.filter((s) => s.cls.includes('pk3-done')).map((s) => s.color).join(' '));
  check('B9 шаги совпадают в обеих темах (нет «съехавшей» вёрстки)',
    sd.count === sl.count && sd.count === 5, `light=${sl.count}, dark=${sd.count}`);
  const qinLight = contrast(sl.qinColor, sl.qinBg);
  check('B10 светлая тема: редактируемая ячейка сметы читается (≥7:1)',
    qinLight != null && qinLight >= 7,
    `«${sl.qinColor}» на «${sl.qinBg}» = ${qinLight}:1`);
  check('B10 ячейка сметы больше не на Excel-синем #dce6f1',
    !/220, 230, 241/.test(String(sl.qinBg)) && !/143, 170, 220/.test(String(sl.qinBorder)),
    `bg=${sl.qinBg}, border=${sl.qinBorder}`);
  check('B10 тёмная тема: ячейка сметы — золотая подсветка, не синяя',
    !/220, 230, 241/.test(String(sd.qinBg)),
    `bg=${sd.qinBg}, border=${sd.qinBorder}`);

  // B11 — ошибка расчёта: экран замирает, а не пересоздаётся
  check('B11 ошибка: таймер не обнулился (экран не пересоздан)',
    afterFail.missing === false && afterFail.timeSec >= beforeFail.timeSec,
    `${beforeFail.timeSec}с → ${afterFail.timeSec}с`);
  check('B11 ошибка: шкала не откатилась назад',
    afterFail.fill + 0.0005 >= beforeFail.fill,
    `${beforeFail.fill.toFixed(3)} → ${afterFail.fill.toFixed(3)}`);
  check('B11 ошибка: этап не сброшен на первый',
    afterFail.stageNow >= beforeFail.stageNow,
    `${beforeFail.stageNow} → ${afterFail.stageNow}`);
  check('B11 ошибка: экран показывает состояние ошибки', afterFail.isFailed === true,
    `is-failed=${afterFail.isFailed}, title="${afterFail.titleText}"`);
  check('B11 ошибка: окно не заперто — есть кнопка выхода',
    afterFail.hasExitBtn === true && afterFail.actionsDisplay !== 'none',
    `кнопка=${afterFail.hasExitBtn}, display=${afterFail.actionsDisplay}`);
  check('B11 ошибка: кнопка выхода реально снимает экран', exitWorks === true,
    `экран снят=${exitWorks}`);
  check('B11 ошибка: никаких JS-ошибок на пути ошибки', failErrors.length === 0,
    failErrors.length ? failErrors.slice(0, 2).join(' | ') : '0 ошибок');

  // B12 — мелкий текст в обеих темах (--t3 давал 3.34–3.81:1)
  function smallContrast(probe) {
    const out = [];
    for (const [k, v] of Object.entries(probe.items || {})) {
      if (!v) { out.push({ k, ratio: null }); continue; }
      const r = contrastLayers(v.color, [v.bg, probe.frame]);
      // opacity на предке гасит и текст, и фон — учитываем как потерю контраста
      const eff = (v.opacity != null && v.opacity < 0.99) ? (r == null ? null : r) : r;
      out.push({ k, ratio: eff, opacity: v.opacity, color: v.color, bg: v.bg });
    }
    return out;
  }
  const dSmall = smallContrast(darkSmall);
  const lSmall = smallContrast(lightSmall);
  check('B12 тёмная тема: весь мелкий текст ≥4.5:1',
    dSmall.every((s) => s.ratio != null && s.ratio >= 4.5),
    dSmall.map((s) => s.k + '=' + s.ratio).join(' '));
  check('B12 светлая тема: весь мелкий текст ≥4.5:1',
    lSmall.every((s) => s.ratio != null && s.ratio >= 4.5),
    lSmall.map((s) => s.k + '=' + s.ratio).join(' '));
  check('B12 футер без opacity (иначе контраст режется)',
    (darkSmall.items.foot || {}).opacity >= 0.99,
    `opacity=${(darkSmall.items.foot || {}).opacity}`);

  // B13 — нет утечки keydown-слушателей при выходе кнопкой
  const firstSnap = leak.snapshots[0] || { added: 0, removed: 0 };
  const lastSnap = leak.snapshots[leak.snapshots.length - 1] || { added: 0, removed: 0 };
  // Прирост подписок за ВСЕ повторные циклы должен быть 0.
  const grew = (lastSnap.added - firstSnap.added) - (lastSnap.removed - firstSnap.removed);
  check('B13 подписка на keydown реально была (проверка не вакуумная)',
    firstSnap.added > 0, `первый цикл: add=${firstSnap.added}, remove=${firstSnap.removed}`);
  check('B13 повторные циклы не копят keydown-слушатели (прирост 0)',
    grew === 0,
    `циклы: ${leak.snapshots.map((s) => s.added + '/' + s.removed).join(' → ')}, прирост=${grew}`);

  // Загрузка без ошибок
  check('B0 модуль личного канбана грузится без JS-ошибок', errors.length === 0,
    errors.length ? errors.slice(0, 3).join(' | ') : '0 ошибок');

  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length) {
    console.log(C.red + `ИТОГ: FAIL — ${failed.length} из ${results.length} проверок провалено` + C.off);
    process.exit(1);
  }
  console.log(C.green + `ИТОГ: OK — ${results.length}/${results.length} проверок пройдено (реальный personal_kanban.js в chromium)` + C.off);
  process.exit(0);
})().catch((e) => {
  console.error(C.red + 'Гейт упал: ' + (e && e.stack || e) + C.off);
  process.exit(1);
});
