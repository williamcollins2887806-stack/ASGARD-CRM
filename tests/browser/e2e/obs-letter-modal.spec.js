// @ts-check
/**
 * tests/browser/e2e/obs-letter-modal.spec.js
 *
 * V473: E2E модалки «Письмо для оплаты через ОБС».
 *
 * ЧТО ПРОВЕРЯЕМ ГЛАЗАМИ ПОЛЬЗОВАТЕЛЯ, а не по коду:
 *   • кнопка «Создать» есть и открывает окно, а не сразу печатает письмо;
 *   • окно заполнено данными счёта (номер/дата/сумма подставлены);
 *   • можно снять «взять из карточки» и ввести свои значения;
 *   • предпросмотр рисует PDF прямо в окне;
 *   • «Сохранить» недоступно до предпросмотра и включается после;
 *   • после сохранения в карточке и в строке реестра появляется исходящий номер;
 *   • страница переживает F5 (данные из БД, а не из памяти модуля);
 *   • в консоли нет ошибок ни под одной из ролей.
 *
 * Требует клон на 127.0.0.1 и тестовые аккаунты (см. tests/browser/helpers.js).
 */
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

const PAGE = 'doc-hub';

async function openRegistry(page) {
  await h.navigateTo(page, PAGE);
  await h.waitForPageLoad(page);
  await page.waitForTimeout(1500);
}

test.describe.serial('ОБС: письмо из реестра счетов', () => {
  test('OBS-UI-01: кнопка «Создать» открывает модалку, а не печатает письмо сразу', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'BUH');
    await openRegistry(page);

    const genBtn = page.locator('[data-obs-gen]').first();
    if ((await genBtn.count()) === 0) test.skip(true, 'нет строк ОБС без письма');

    await genBtn.click();
    const modal = page.locator('#dhObsModal');
    await expect(modal).toBeVisible({ timeout: 15000 });

    await expect(page.locator('#dhObsInvDate')).not.toHaveValue('');
    await expect(page.locator('#dhObsGross')).not.toHaveValue('');
    await expect(page.locator('#dhObsSave')).toBeDisabled();

    h.assertNoConsoleErrors(errors, 'OBS-UI-01 открытие модалки');
  });

  test('OBS-UI-02: свои реквизиты и предпросмотр PDF', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'BUH');
    await openRegistry(page);

    const genBtn = page.locator('[data-obs-gen]').first();
    if ((await genBtn.count()) === 0) test.skip(true, 'нет строк ОБС без письма');
    await genBtn.click();
    await expect(page.locator('#dhObsModal')).toBeVisible({ timeout: 15000 });

    await page.locator('#dhObsFromCard').uncheck();
    await page.locator('#dhObsInvNo').fill('TEST-UI-777');
    await page.locator('#dhObsInvDate').fill('2026-11-07');
    await page.locator('#dhObsGross').fill('12345.67');
    await page.locator('#dhObsVatRate').selectOption('20');
    await page.locator('#dhObsItems').fill('Услуга проверки — 2 шт');

    await expect(page.locator('#dhObsSave')).toBeDisabled();

    await page.locator('#dhObsPreviewBtn').click();
    await expect(page.locator('#dhObsPreviewFrame')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#dhObsSave')).toBeEnabled();

    h.assertNoConsoleErrors(errors, 'OBS-UI-02 предпросмотр');
  });

  test('OBS-UI-03: сохранение даёт исходящий номер', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'BUH');
    await openRegistry(page);

    const genBtn = page.locator('[data-obs-gen]').first();
    if ((await genBtn.count()) === 0) test.skip(true, 'нет строк ОБС без письма');
    await genBtn.click();
    await expect(page.locator('#dhObsModal')).toBeVisible({ timeout: 15000 });

    await page.locator('#dhObsPreviewBtn').click();
    await expect(page.locator('#dhObsPreviewFrame')).toBeVisible({ timeout: 30000 });
    await page.locator('#dhObsSave').click();

    await expect(page.locator('#dhObsFootLeft')).toContainText('Исх. №', { timeout: 30000 });
    const text = await page.locator('#dhObsFootLeft').innerText();
    expect(text).toMatch(/Исх\. №\s*\S+/);

    h.assertNoConsoleErrors(errors, 'OBS-UI-03 сохранение');
  });

  test('OBS-UI-04: закрытие окна — Esc и крестик', async ({ page }) => {
    await h.loginAs(page, 'BUH');
    await openRegistry(page);
    const genBtn = page.locator('[data-obs-gen]').first();
    if ((await genBtn.count()) === 0) test.skip(true, 'нет строк ОБС без письма');

    await genBtn.click();
    const modal = page.locator('#dhObsModal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden({ timeout: 5000 });

    await genBtn.click();
    await expect(modal).toBeVisible({ timeout: 15000 });
    await page.locator('#dhObsX').click();
    await expect(modal).toBeHidden({ timeout: 5000 });
  });

  test('OBS-UI-05: плашка Исх. видна после перезагрузки', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'BUH');
    await openRegistry(page);
    await page.reload();
    await h.waitForPageLoad(page);
    await page.waitForTimeout(2000);

    const pill = page.locator('.dh-obs-letter--open').first();
    if ((await pill.count()) === 0) test.skip(true, 'в базе нет писем ОБС');
    await expect(pill).toBeVisible();
    const t = await pill.innerText();
    expect(t.length).toBeGreaterThan(0);

    h.assertNoConsoleErrors(errors, 'OBS-UI-05 после F5');
  });

  test('OBS-UI-06: инициатор (PM) видит кнопку на своём счёте', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await openRegistry(page);

    const gen = page.locator('[data-obs-gen]').first();
    if ((await gen.count()) === 0) test.skip(true, 'у PM нет строк ОБС без письма');
    await expect(gen).toBeVisible();
    await gen.click();
    await expect(page.locator('#dhObsModal')).toBeVisible({ timeout: 15000 });

    h.assertNoConsoleErrors(errors, 'OBS-UI-06 PM');
  });

  test('OBS-UI-07: предпросмотр не тратит номер — отмена не меняет реестр', async ({ page }) => {
    await h.loginAs(page, 'BUH');
    await openRegistry(page);
    const genBtn = page.locator('[data-obs-gen]').first();
    if ((await genBtn.count()) === 0) test.skip(true, 'нет строк ОБС без письма');

    const rowId = await genBtn.getAttribute('data-obs-gen');
    const beforeText = await page.locator(`tr[data-id="${rowId}"]`).innerText();

    await genBtn.click();
    await expect(page.locator('#dhObsModal')).toBeVisible({ timeout: 15000 });
    await page.locator('#dhObsPreviewBtn').click();
    await expect(page.locator('#dhObsPreviewFrame')).toBeVisible({ timeout: 30000 });
    await page.locator('#dhObsX').click();
    await expect(page.locator('#dhObsModal')).toBeHidden({ timeout: 5000 });

    const afterText = await page.locator(`tr[data-id="${rowId}"]`).innerText();
    expect(afterText).toBe(beforeText);
  });
});
