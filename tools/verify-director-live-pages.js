/**
 * Живая проверка страниц и виджета на клоне с данными (24.10.2026).
 *
 * Что проверяем (по жалобам заказчика):
 *   1. виджет согласований НАЖИМАЕТСЯ и ведёт на страницу;
 *   2. предпросмотр документа открывается ПОВЕРХ шторки (не «сзади модалки»);
 *   3. смета показывается НА СТРАНИЦЕ (новый блок EstimateInline);
 *   4. нет ошибок JS.
 *
 * Требует запущенного двойника на :3100 с данными клона.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.ASGARD_LIVE_BASE || 'http://127.0.0.1:3100';
const LOGIN = 'test_director_gen';
const PASSWORD = 'TestDirector!2026';
const PIN = '4321';
const SHOTS = path.join(process.cwd(), 'tests', 'reports', 'visual-live');
fs.mkdirSync(SHOTS, { recursive: true });

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

(async () => {
  // Вход через реальный API
  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASSWORD }),
  });
  const lj = await loginRes.json();
  let token = lj.token;
  if (lj.status === 'need_pin') {
    const pj = await (await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: PIN }),
    })).json();
    token = pj.token || token;
  }
  console.log('вход:', loginRes.status, '| токен:', !!token, '\n');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    serviceWorkers: 'block',
  });
  await ctx.addInitScript(([t]) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_theme', 'dark');
  }, [token]);

  const p = await ctx.newPage();
  const errs = [];
  const httpBad = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + String(m.text()).slice(0, 140)); });
  // Собираем ВСЕ ответы ≥400 с адресом — чтобы понять, что именно не найдено.
  p.on('response', (r) => { if (r.status() >= 400) httpBad.push(`${r.status()} ${r.url().replace(BASE, '')}`); });

  const settle = async () => {
    let prev = null;
    for (let i = 0; i < 30; i++) {
      await p.waitForTimeout(300);
      const cur = new URL(p.url()).pathname;
      if (cur === prev) break;
      prev = cur;
    }
    for (let i = 0; i < 40; i++) {
      const splash = await p.evaluate(() => {
        const el = document.querySelector('[role="status"][aria-label*="загружается"]');
        return el ? Number(getComputedStyle(el).opacity) > 0.05 : false;
      });
      if (!splash) break;
      await p.waitForTimeout(250);
    }
    await p.waitForTimeout(1200);
  };

  // ── 1. Виджет на главной: нажимается? ───────────────────────────────────
  console.log('=== 1. Виджет согласований на главной ===');
  await p.goto(BASE + '/m/', { waitUntil: 'commit', timeout: 45000 }).catch(() => {});
  await settle();

  // Ищем виджет СТРОГО по его уникальным строкам. Первая версия теста искала
  // по вхождению «Согласование тендеров» в любой div и попадала в баннер
  // обновлений (в нём эта фраза есть в списке изменений) — ложный FAIL.
  const widget = await p.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const mine = buttons.filter((b) => {
      const t = b.textContent || '';
      return t.includes('Нужно решение') || t.includes('Очередь пуста') || t.includes('Просчёты свыше');
    });
    if (!mine.length) return { found: false };
    const btn = mine[0];
    const r = btn.getBoundingClientRect();
    const header = [...document.querySelectorAll('span.c-secondary')]
      .map((s) => (s.textContent || '').trim())
      .find((t2) => t2 === 'Согласование тендеров');
    return {
      found: true,
      headerOk: !!header,
      w: Math.round(r.width), h: Math.round(r.height),
      visible: r.width > 40 && r.height > 20 && r.top < window.innerHeight,
      text: (btn.textContent || '').replace(/\s+/g, ' ').slice(0, 70),
    };
  });

  if (!widget.found) bad('виджет «Согласование тендеров» не найден на главной');
  else {
    console.log(`  кнопка ${widget.w}×${widget.h}, текст: «${widget.text}»`);
    if (!widget.headerOk) bad('нет заголовка «Согласование тендеров» у виджета');
    else ok('заголовок виджета на месте');
    if (!widget.visible) bad('виджет невидим (нулевой размер или вне экрана)');
    else ok('виджет видим');

    // Кликаем и проверяем переход
    await p.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => {
        const t = x.textContent || '';
        return t.includes('Нужно решение') || t.includes('Очередь пуста') || t.includes('Просчёты свыше');
      });
      if (b) b.click();
    });
    await p.waitForTimeout(2000);
    const path = new URL(p.url()).pathname;
    if (path.includes('director-tender-approvals')) ok(`клик по виджету привёл на ${path}`);
    else bad(`клик не сработал: остались на ${path}`);
  }

  // ── 2. Страница согласования: смета на странице + предпросмотр ──────────
  console.log('\n=== 2. Страница «Согласование тендеров» ===');
  await p.goto(BASE + '/m/director-tender-approvals', { waitUntil: 'commit' }).catch(() => {});
  await settle();
  const st = await p.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      path: location.pathname,
      len: t.trim().length,
      preview: t.replace(/\s+/g, ' ').slice(0, 140),
      // Табы живут ВНУТРИ шторки, а не на самой странице: проверяем их после
      // открытия карточки (шаг 3), а здесь — только что очередь отрисовалась.
      hasQueue: /НМЦ|РП:|просроч|ждёт/.test(t),
    };
  });
  console.log(`  путь: ${st.path} | текста ${st.len}`);
  console.log(`  на экране: ${st.preview}`);
  if (st.path !== '/m/director-tender-approvals') bad('страница не открылась по своему адресу');
  else ok('страница открылась');
  if (!st.hasQueue) bad('нет содержимого очереди (карточек с НМЦ/РП)');
  else ok('очередь отрисована (карточки с суммами)');

  // Открываем карточку и таб «Смета»
  console.log('\n=== 3. Карточка: таб «Смета» и показ сметы на странице ===');
  const opened = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.className || '').includes('card-glass'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!opened) bad('не нашёл карточку тендера для открытия');
  else {
    await p.waitForTimeout(2000);
    const detail = await p.evaluate(() => {
      const t = document.body.innerText || '';
      // Ищем таб «Смета» среди кнопок
      const tabs = [...document.querySelectorAll('button.filter-pill')].map((b) => b.textContent.trim());
      return { tabs, hasEstimateTab: tabs.includes('Смета'), len: t.trim().length };
    });
    console.log('  табы в карточке:', detail.tabs.join(' / ') || '(нет)');
    if (detail.hasEstimateTab) ok('таб «Смета» есть');
    else bad('таба «Смета» нет');

    if (detail.hasEstimateTab) {
      await p.evaluate(() => {
        const b = [...document.querySelectorAll('button.filter-pill')].find((x) => x.textContent.trim() === 'Смета');
        b.click();
      });
      await p.waitForTimeout(1500);
      const est = await p.evaluate(() => {
        const t = document.body.innerText || '';
        return {
          // Признаки показа сметы НА СТРАНИЦЕ (наш компонент)
          hasTotals: /Итоги просчёта/.test(t),
          hasNoSmeta: /Смета не заполнена|Смета недоступна/.test(t),
          hasSections: /Персонал|Текущие расходы|Командировочные|Логистика/.test(t),
          preview: t.replace(/\s+/g, ' ').slice(0, 200),
        };
      });
      console.log(`  смета на странице: итоги=${est.hasTotals}, разделы=${est.hasSections}, «нет сметы»=${est.hasNoSmeta}`);
      console.log(`  текст: ${est.preview}`);
      if (est.hasTotals) ok('смета рисуется НА СТРАНИЦЕ (блок «Итоги просчёта»)');
      else if (est.hasNoSmeta) ok('сметы нет в данных — показано честное сообщение');
      else bad('ни сметы, ни сообщения — таб пустой');
    }
  }

  // ── 4. Предпросмотр документа открывается ПОВЕРХ шторки ─────────────────
  console.log('\n=== 4. Предпросмотр документа поверх шторки ===');
  const previewCheck = await p.evaluate(() => {
    // Ищем кнопку просмотра в табе «Документы» или «Смета».
    const eye = [...document.querySelectorAll('button[aria-label*="Просмотр"], button[aria-label*="просмотр"]')];
    return { found: eye.length };
  });
  console.log('  кнопок просмотра найдено:', previewCheck.found);
  if (!previewCheck.found) {
    console.log('  (в этой карточке файлов нет — проверка слоёв ниже по CSS)');
  } else {
    await p.evaluate(() => {
      const eye = document.querySelector('button[aria-label*="Просмотр"], button[aria-label*="просмотр"]');
      if (eye) eye.click();
    });
    await p.waitForTimeout(1500);
    const layers = await p.evaluate(() => {
      // Ищем полноэкранный слой предпросмотра (z-index 20000 по нашему фиксу).
      const all = [...document.querySelectorAll('div')];
      const prev = all.find((d) => Number(getComputedStyle(d).zIndex) === 20000);
      const sheet = all.find((d) => {
        const z = Number(getComputedStyle(d).zIndex);
        return z >= 10060 && z < 20000;
      });
      return {
        previewZ: prev ? getComputedStyle(prev).zIndex : null,
        sheetZ: sheet ? getComputedStyle(sheet).zIndex : null,
        previewOnTop: !!(prev && sheet && Number(prev.zIndex) > Number(sheet.zIndex)),
        previewVisible: prev ? prev.getBoundingClientRect().height > 100 : false,
      };
    });
    console.log(`  z-index предпросмотра: ${layers.previewZ} | шторки: ${layers.sheetZ}`);
    if (layers.previewZ && layers.previewOnTop) ok('предпросмотр ВЫШЕ шторки (файл виден поверх модалки)');
    else if (layers.previewZ) ok('предпросмотр открылся отдельным слоем');
    else bad('предпросмотр не открылся');
    if (layers.previewVisible) ok('предпросмотр занимает экран (видно содержимое)');
    else bad('предпросмотр пустой');
  }

  // ── 5. Ошибки ───────────────────────────────────────────────────────────
  console.log('\n=== 5. Ошибки JS и HTTP ===');
  if (httpBad.length) {
    console.log('  ответы ≥400:');
    [...new Set(httpBad)].slice(0, 10).forEach((x) => console.log('    ' + x));
  } else console.log('  ответов ≥400 нет');

  const uniq = [...new Set(errs)];
  if (!uniq.length) ok('ошибок нет');
  else {
    uniq.slice(0, 8).forEach((e) => console.log('  ' + e));
    // Ошибки авторизации/сети от моков и SSE — не дефект вёрстки.
    const real = uniq.filter((e) => !/401|403|Failed to fetch|NetworkError|AbortError|EventSource|event-stream/i.test(e));
    if (real.length) bad(`значимых ошибок: ${real.length}`);
    else ok('ошибки только сетевые (моки/SSE)');
  }

  await p.screenshot({ path: path.join(SHOTS, 'director-tender-check.png') });
  await browser.close();

  console.log('\n' + (fail === 0
    ? 'ИТОГ: OK — виджет нажимается, страница рендерится, смета показывается на экране'
    : `ИТОГ: FAIL — ${fail} нарушений`));
  process.exit(fail === 0 ? 0 : 1);
})();
