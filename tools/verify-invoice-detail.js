'use strict';
/**
 * verify-invoice-detail.js — гейт раскрытия счёта у директора.
 *
 * Проверяет в реальном браузере (DIRECTOR_GEN), что на вкладке «Счета»
 * экрана /director-approvals:
 *   • карточка счёта тапабельна и открывает деталку;
 *   • в деталке видны поставщик, сумма, основание;
 *   • есть кнопка просмотра файла (если файл приложен) и она открывает вьюер;
 *   • есть выбор срока оплаты «Сразу / Отложенная»;
 *   • есть кнопки «Согласовать» и «Вернуть».
 *
 * Запуск: node tools/verify-invoice-detail.js
 */
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');

const SECRET = 'asgard-jwt-secret-2026';
const BASE = process.env.BASE || 'http://127.0.0.1:5173';

let fails = 0;
const bad = (m) => { console.log('  FAIL ' + m); fails++; };
const ok = (m) => console.log('  ok   ' + m);

(async () => {
  const b = await chromium.launch();
  const token = jwt.sign({ id: 3455, login: 'ok', name: 'Д', role: 'DIRECTOR_GEN', email: 'x@a.com', pinVerified: true }, SECRET);
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(({ t }) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('field_auth_epoch', '6');
    localStorage.setItem('asgard_mobile_banner_dismissed_v1', '1');
  }, { t: token });
  const p = await ctx.newPage();

  console.log('=== verify-invoice-detail ===');
  await p.goto(BASE + '/m/director-approvals?tab=invoices', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4200);

  // 1. Карточка счёта тапабельна
  const card = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button[aria-label^="Открыть счёт"]')];
    if (!btns.length) return { found: 0 };
    const first = btns[0];
    return { found: btns.length, label: first.getAttribute('aria-label'), visible: first.offsetParent !== null };
  });
  if (!card.found) {
    bad('нет тапабельной карточки счёта (aria-label="Открыть счёт …")');
    console.log('     — возможно, очередь пуста; проверьте данные на стенде');
  } else {
    ok('карточек счёта: ' + card.found + ' (' + card.label + ')');
  }

  // 2. Открываем деталку
  if (card.found) {
    // Перехватываем POST решения, чтобы проверить ТЕЛО запроса (pay_timing).
    // Без этого исходный дефект «выбор срока не уходит на бэк» проходил зелёным.
    let approveBody = null;
    p.on('request', (req) => {
      if (req.method() === 'POST' && /\/api\/payment-invoices\/\d+\/dir-approve/.test(req.url())) {
        try { approveBody = JSON.parse(req.postData() || 'null'); } catch { approveBody = null; }
      }
    });

    await p.click('button[aria-label^="Открыть счёт"]');
    await p.waitForTimeout(2600);
    const detail = await p.evaluate(() => {
      // Шторка живёт в портале #modal-root, поэтому читаем её текст, а не body.
      const dialog = document.querySelector('[role="dialog"]') || document.getElementById('modal-root');
      const txt = dialog ? dialog.innerText : '';
      return {
        hasSupplier: /Поставщик/.test(txt),
        hasAmount: /К оплате|К ОПЛАТЕ/i.test(txt),
        hasBasis: /Основание/.test(txt),
        hasTiming: /Сразу/.test(txt) && /Отложенная/.test(txt),
        hasApprove: /Согласовать/.test(txt),
        hasReject: /Вернуть/.test(txt),
        hasPreview: /Просмотр|Открыть счёт|Файл к счёту не приложен/.test(txt),
        text: txt.slice(0, 200),
      };
    });
    (detail.hasSupplier ? ok : bad.bind(null, 'в деталке нет блока «Поставщик»'))('Поставщик в деталке');
    (detail.hasAmount ? ok : bad.bind(null, 'в деталке нет суммы «К оплате»'))('сумма в деталке');
    (detail.hasBasis ? ok : bad.bind(null, 'в деталке нет «Основание»'))('основание в деталке');
    (detail.hasTiming ? ok : bad.bind(null, 'нет выбора срока оплаты'))('Сразу / Отложенная');
    (detail.hasApprove && detail.hasReject ? ok : bad.bind(null, 'нет кнопок решения'))('кнопки решения');
    (detail.hasPreview ? ok : bad.bind(null, 'нет блока файла'))('блок файла');

    // 3. Если файл есть — открываем вьюер
    const previewBtn = await p.$('text=Просмотр');
    if (previewBtn) {
      await previewBtn.click();
      await p.waitForTimeout(2600);
      const viewer = await p.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const txt = dialog ? dialog.innerText : '';
        const img = document.querySelector('img[alt]');
        const iframe = document.querySelector('iframe[title]');
        return { img: !!img, iframe: !!iframe, empty: /Файл не приложен/.test(txt) };
      });
      if (viewer.empty) ok('файла нет — вьюер корректно сообщает об этом');
      else if (viewer.img || viewer.iframe) ok('вьюер показал файл (' + (viewer.iframe ? 'PDF' : 'изображение') + ')');
      else bad('вьюер открылся, но файл не отобразился');
    }

    // 4. Тело запроса решения: выбранный срок оплаты должен уходить на бэкенд.
    //    Проверяем на счёте с файлом: ставим «Отложенная» и жмём «Согласовать».
    //    ВНИМАНИЕ: это реально меняет статус фикстуры — она создаётся сидером
    //    заново при следующем прогоне.
    const deferredBtn = p.locator('[role="dialog"] button', { hasText: 'Отложенная' }).first();
    if (await deferredBtn.count()) {
      await deferredBtn.click();
      await p.waitForTimeout(400);
      const approveBtn = p.locator('[role="dialog"] button', { hasText: 'Согласовать' }).first();
      if (await approveBtn.count()) {
        await approveBtn.click();
        await p.waitForTimeout(2200);
        if (approveBody && approveBody.pay_timing === 'deferred') {
          ok('pay_timing уходит в теле dir-approve: {"pay_timing":"deferred"}');
        } else {
          bad('тело dir-approve не содержит pay_timing=deferred (получено: ' + JSON.stringify(approveBody) + ')');
        }
      }
    }
  }

  console.log('\nИТОГ: ' + (fails === 0 ? 'OK — счёт раскрывается с превью' : 'FAIL — ' + fails + ' нарушений'));
  await b.close();
  process.exit(fails === 0 ? 0 : 1);
})();
