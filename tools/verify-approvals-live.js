/**
 * Живая проверка: согласованные счета открываются (27.10.2026).
 *
 * Гейт `verify-approvals-openable.js` проверяет код. Здесь — фактическое
 * поведение: открываем страницу согласований под директором и пробуем
 * раскрыть карточку из блока «К ОПЛАТЕ».
 *
 * Нужен двойник на :3100 с данными клона.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.ASGARD_LIVE_BASE || 'http://127.0.0.1:3100';
const SHOTS = path.join(process.cwd(), 'tests', 'reports', 'visual-live');
fs.mkdirSync(SHOTS, { recursive: true });

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

(async () => {
  const lj = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test_director_gen', password: 'TestDirector!2026' }),
  })).json();
  let token = lj.token;
  if (lj.status === 'need_pin') {
    const pj = await (await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: '4321' }),
    })).json();
    token = pj.token || token;
  }

  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, serviceWorkers: 'block',
  });
  await ctx.addInitScript(([t]) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_theme', 'dark');
  }, [token]);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));

  await p.goto(BASE + '/m/director-approvals?tab=invoices', { waitUntil: 'commit' }).catch(() => {});
  // Ждём bootstrap и уход заставки
  for (let i = 0; i < 40; i++) {
    const s = await p.evaluate(() => {
      const el = document.querySelector('[role="status"][aria-label*="загружается"]');
      return el ? Number(getComputedStyle(el).opacity) > 0.05 : false;
    });
    if (!s) break;
    await p.waitForTimeout(250);
  }
  await p.waitForTimeout(2500);

  // 1. Есть ли блок «К ОПЛАТЕ» на вкладке счетов
  console.log('=== 1. Вкладка «Счета»: есть ли блок «К ОПЛАТЕ» ===');
  const state = await p.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      path: location.pathname,
      hasToPay: /К ОПЛАТЕ/.test(t),
      hasAwaiting: /Согласовать|Вернуть/.test(t),
      preview: t.replace(/\s+/g, ' ').slice(0, 200),
      // Ищем кликабельные карточки в блоке «К ОПЛАТЕ»
      toPayButtons: [...document.querySelectorAll('button')].filter((b) => {
        const t2 = b.textContent || '';
        return /одобрен, ждёт оплаты/.test(t2);
      }).length,
    };
  });
  console.log('  путь:', state.path);
  console.log('  блок «К ОПЛАТЕ»:', state.hasToPay, '| кликабельных карточек:', state.toPayButtons);
  console.log('  текст:', state.preview);

  if (!state.hasToPay) {
    console.log('  (на клоне нет согласованных счетов к оплате — проверить клик нельзя)');
  } else {
    ok('блок «К ОПЛАТЕ» отрисован');
    if (state.toPayButtons > 0) ok(`${state.toPayButtons} кликабельных карточек (кнопки, не дивы)`);
    else bad('карточки в «К ОПЛАТЕ» не кликабельны');
  }

  // 2. Если есть карточка — кликаем и проверяем деталку
  if (state.toPayButtons > 0) {
    console.log('\n=== 2. Клик по согласованному счёту ===');
    await p.evaluate(() => {
      const b2 = [...document.querySelectorAll('button')].find((x) => /одобрен, ждёт оплаты/.test(x.textContent || ''));
      if (b2) b2.click();
    });
    await p.waitForTimeout(2000);

    const detail = await p.evaluate(() => {
      const t = document.body.innerText || '';
      const sheet = [...document.querySelectorAll('div')].find((d) => {
        const z = Number(getComputedStyle(d).zIndex);
        return z >= 10060 && /Счёт|Поставщик|К оплате/.test(d.textContent || '');
      });
      /**
       * ВАЖНО: кнопки решения ищем ВНУТРИ открытой шторки, а не по всей странице.
       * Под шторкой остаётся список очереди, где у ДРУГИХ счетов законно есть
       * «Согласовать»/«Вернуть» — первая версия теста считала их за дефект.
       */
      const sheetText = sheet ? (sheet.textContent || '') : '';
      return {
        opened: !!sheet,
        hasReadOnlyNote: /Счёт согласован/.test(sheetText),
        hasApproveBtn: /Согласовать/.test(sheetText),
        hasRejectBtn: /Вернуть/.test(sheetText),
        hasTiming: /Срок оплаты/.test(sheetText),
        sheetText: sheetText.replace(/\s+/g, ' ').slice(0, 220),
      };
    });

    if (!detail.opened) bad('деталка не открылась по клику');
    else ok('деталка открылась — счёт можно посмотреть');
    if (detail.hasReadOnlyNote) ok('показано «Счёт согласован» (режим просмотра)');
    else console.log('  (подписи «Счёт согласован» нет — возможно, другой статус)');
    if (detail.hasApproveBtn || detail.hasRejectBtn) bad('внутри шторки просмотра есть кнопки решения');
    else ok('внутри шторки просмотра кнопок «Согласовать»/«Вернуть» нет');
    if (detail.hasTiming) bad('в просмотре виден выбор срока оплаты — не должно быть');
    else ok('выбор срока оплаты скрыт');
    console.log('  содержимое деталки:', detail.sheetText || '(пусто)');
  }

  // 3. Вкладка выплат — та же проверка
  console.log('\n=== 3. Вкладка «Выплаты» ===');
  await p.goto(BASE + '/m/director-approvals?tab=payouts', { waitUntil: 'commit' }).catch(() => {});
  await p.waitForTimeout(3000);
  const payState = await p.evaluate(() => {
    const t = document.body.innerText || '';
    const btns = [...document.querySelectorAll('button')].filter((x) => /ждёт перевода/.test(x.textContent || ''));
    return { hasToPay: /К ВЫПЛАТЕ/.test(t), clickable: btns.length, preview: t.replace(/\s+/g, ' ').slice(0, 150) };
  });
  console.log('  блок «К ВЫПЛАТЕ»:', payState.hasToPay, '| кликабельных:', payState.clickable);
  if (payState.hasToPay && payState.clickable > 0) {
    await p.evaluate(() => {
      const b2 = [...document.querySelectorAll('button')].find((x) => /ждёт перевода/.test(x.textContent || ''));
      if (b2) b2.click();
    });
    await p.waitForTimeout(1800);
    const pd = await p.evaluate(() => {
      // Ищем внутри шторки выплаты, а не по странице (под ней есть очередь).
      const sheet = [...document.querySelectorAll('div')].find((d) => {
        const z = Number(getComputedStyle(d).zIndex);
        return z >= 10060 && /Состав суммы|Выплата согласована/.test(d.textContent || '');
      });
      const st = sheet ? (sheet.textContent || '') : '';
      return {
        hasComposition: /Состав суммы/.test(st),
        hasApproved: /Выплата согласована/.test(st),
        hasDecide: /Согласовать/.test(st),
      };
    });
    if (pd.hasComposition) ok('просмотр выплаты показывает состав суммы');
    else bad('просмотр выплаты не открылся или без состава');
    if (pd.hasDecide) bad('внутри шторки выплаты есть кнопка решения');
    else ok('кнопок решения в шторке выплаты нет');
  } else if (!payState.hasToPay) {
    console.log('  (на клоне нет согласованных выплат — проверить клик нельзя)');
  } else {
    bad('карточки в «К ВЫПЛАТЕ» не кликабельны');
  }

  console.log('\n=== 4. Ошибки JS ===');
  console.log(errs.length ? [...new Set(errs)].slice(0, 5).join('\n') : '  нет');
  if (errs.length) fail += errs.length;

  await p.screenshot({ path: path.join(SHOTS, 'approvals-openable.png') });
  await b.close();

  console.log('\n' + (fail === 0
    ? 'ИТОГ: OK — согласованные счета и выплаты открываются, кнопок решения в просмотре нет'
    : `ИТОГ: FAIL — ${fail} нарушений`));
  process.exit(fail === 0 ? 0 : 1);
})();
