// @ts-check
/**
 * UI-регресс: вкладки директора на странице «Согласование оплат» (#/approval-payment)
 * НЕ должны исчезать после цикла live-таймера (каждые 20 сек) и не должны утекать
 * на другие страницы.
 *
 * Баг (найден на ручном тестировании 16.10.2026): живой таймер перерисовывал
 * ВНЕШНИЙ контейнер #payment-list, внутри которого в режиме директора лежат
 * вкладки (#ap_tabs) и панели (#ap_panel, #ap_invoices_panel) — вкладки стирались.
 *
 * Запуск (нужен поднятый тест-сервер на :3200):
 *   npx playwright test tests/browser/e2e/payouts-approval-tabs.spec.js \
 *     --project=e2e-browser --config=playwright.clone.config.js
 */
const { test, expect } = require('@playwright/test');

const BASE = process.env.CLONE_URL || 'http://127.0.0.1:3200';
// Payout-гейт и время live-tick (20 c) требуют запаса.
test.setTimeout(120000);

async function loginClone(page, login = 'admin', password = 'admin123', pin = '1234') {
  await page.goto(BASE + '/api/health').catch(() => {});
  await page.goto(BASE + '/');
  const token = await page.evaluate(async ({ login, password, pin }) => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) });
    const d = await r.json();
    let t = d.token;
    if (d.status === 'need_pin') {
      const r2 = await fetch('/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) });
      const d2 = await r2.json();
      if (d2.token) t = d2.token;
    }
    if (t) {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('auth_token', t);
    }
    // Оверлей выбора темы показывается один раз и перехватывает клики —
    // помечаем «уже выбрана», иначе тест не сможет нажать вкладку.
    localStorage.setItem('asgard_theme_chosen', '1');
    return t || null;
  }, { login, password, pin });
  // Баннер выбора темы мог показаться раньше (watchForWelcome ставит таймер на
  // 700 мс) — убираем его ДО перехода, иначе он перехватит клики на странице.
  await page.evaluate(() => {
    const el = document.getElementById('asgard-theme-selector');
    if (el) el.remove();
  });
  return token;
}

/** Закрыть модалку-напоминание об обучении («вы отстаёте»). Она появляется
 *  при входе, если есть несданные обязательные уроки, и перекрывает интерфейс.
 *  Закрываем ШТАТНОЙ кнопкой «Позже» (через hideModal с сохранением стека),
 *  а не удалением из DOM — иначе напоминание вернётся и «догонит» следующий шаг. */
async function dismissOverlays(page) {
  // Баннер выбора темы — перехватывает клики, если успел появиться.
  await page.evaluate(() => {
    const ts = document.getElementById('asgard-theme-selector');
    if (ts) ts.remove();
  });
  for (let i = 0; i < 3; i++) {
    const overlay = page.locator('.cr-m-overlay.cr-m-overlay--visible');
    if (await overlay.count() === 0) return;
    const later = page.locator('#oaLagLater');
    if (await later.count() > 0) {
      await later.click({ timeout: 3000 }).catch(() => {});
    } else {
      // не наша модалка — закрываем штатным hideModal
      await page.evaluate(() => { try { AsgardUI.hideModal(); } catch (_) {} });
    }
    await page.waitForTimeout(600);
  }
}

test.describe.serial('Согласование директором: вкладки устойчивы к live-таймеру', () => {
  test('вкладки есть, переключаются и НЕ пропадают после 20-сек таймера', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));

    const token = await loginClone(page);
    expect(token, 'вход в тестовую систему (admin/admin123/PIN 1234)').toBeTruthy();

    await page.goto(BASE + '/#/approval-payment');
    await page.waitForSelector('#ap_tabs', { timeout: 20000 });
    // Напоминание об обучении («вы отстаёте») приходит через ~2 с и перекрывает
    // вкладки — закрываем оверлеи перед взаимодействием.
    await page.waitForTimeout(3000);
    await dismissOverlays(page);

    // 1) Вкладки в режиме директора отрисованы
    const tabs = page.locator('#ap_tabs .ap-tab');
    await expect(tabs).toHaveCount(4);
    for (const label of ['Счета', 'Выплаты', 'Касса', 'Планирование']) {
      await expect(page.locator(`#ap_tabs .ap-tab:has-text("${label}")`).first()).toBeVisible();
    }

    // 2) Вкладки лежат ВНУТРИ #payment-list (источник бага) — фиксируем контракт
    const tabsInsideList = await page.locator('#payment-list #ap_tabs').count();
    expect(tabsInsideList, 'вкладки должны быть внутри #payment-list (контракт разметки)').toBe(1);

    // 3) Переключаем на «Выплаты» — панель наполняется
    await page.locator('#ap_tabs .ap-tab:has-text("Выплаты")').first().click();
    await page.waitForTimeout(2500);
    await expect(page.locator('#ap_panel')).not.toBeEmpty();
    const panelBefore = await page.locator('#ap_panel').innerText();

    // 4) КЛЮЧЕВОЕ: ждём цикл live-таймера (20 c) и проверяем, что НИЧЕГО не пропало
    await page.waitForTimeout(23000);
    await expect(page.locator('#ap_tabs')).toBeVisible();
    await expect(page.locator('#ap_tabs .ap-tab')).toHaveCount(4);
    await expect(page.locator('#ap_tabs .ap-tab.is-on')).toContainText('Выплаты');
    const panelAfter = await page.locator('#ap_panel').innerText();
    expect(panelAfter.length, 'панель «Выплаты» не должна опустеть после таймера').toBeGreaterThan(0);
    expect(panelBefore.length).toBeGreaterThan(0);

    // 5) У КАЖДОЙ вкладки свой верхний блок: общий («Счета, ожидающие...» +
    // «К согласованию») виден ТОЛЬКО на «Счетах». Иначе на всех вкладках висели
    // бы суммы счетов (найдено на ручном тестировании 16.10.2026).
    const tabHeader = page.locator('#ap_header');
    const dirTotal = page.locator('#dir-total');
    for (const [name, shouldSee] of [['Счета', true], ['Выплаты', false], ['Касса', false], ['Планирование', false]]) {
      await dismissOverlays(page);
      await page.locator(`#ap_tabs .ap-tab:has-text("${name}")`).first().click();
      await page.waitForTimeout(2500);
      if (shouldSee) {
        await expect(tabHeader, `блок счетов должен быть виден на «${name}»`).toBeVisible();
        await expect(dirTotal, `«К согласованию» должно быть на «${name}»`).toBeVisible();
      } else {
        await expect(tabHeader, `блок счетов НЕ должен висеть на «${name}»`).toBeHidden();
        await expect(dirTotal, `«К согласованию» НЕ должно висеть на «${name}»`).toBeHidden();
        // у вкладки — свой заголовок со своей суммой
        await expect(page.locator('#ap_panel')).not.toBeEmpty();
      }
    }

    // 6) Блок «К согласованию» не должен утекать на другие страницы
    for (const route of ['#/home', '#/works', '#/payouts']) {
      await page.goto(BASE + '/' + route);
      await page.waitForTimeout(2000);
      await expect(page.locator('#dir-total'), `«К согласованию» не должно быть на ${route}`).toHaveCount(0);
      const hasK = await page.locator('body').innerText().then((t) => /К согласованию/.test(t));
      expect(hasK, `«К согласованию» утекло на ${route}`).toBe(false);
    }

    // 7) Возврат — вкладки снова на месте
    await page.goto(BASE + '/#/approval-payment');
    await page.waitForSelector('#ap_tabs', { timeout: 20000 });
    await expect(page.locator('#ap_tabs .ap-tab')).toHaveCount(4);

    expect(errors.filter((e) => !/favicon|ERR_ABORTED/.test(e)), 'ошибки JS на странице').toEqual([]);
  });
});
