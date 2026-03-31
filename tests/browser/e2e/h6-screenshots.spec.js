/**
 * H6 Screenshots — Estimate Chat UI
 * Mobile (390×844) + Desktop (1280×800)
 */
const { test, expect } = require('@playwright/test');
const { loginAs, getSessionToken } = require('../helpers');

const BASE_URL = process.env.BASE_URL || 'http://92.242.61.184:3000';

// Mobile viewport
const MOBILE = { width: 390, height: 844 };
// Desktop viewport
const DESKTOP = { width: 1280, height: 800 };

test.describe('H6 Estimate Chat Screenshots', () => {

  test('Mobile: Tab "Все" — chat list', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE });
    const page = await ctx.newPage();
    await loginAs(page, 'test_pm', 'Test123!', '0000');
    await page.goto(`${BASE_URL}/m/chat`);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests/screenshots/h6-01-mobile-tab-all.png', fullPage: false });
    await ctx.close();
  });

  test('Mobile: Tab "Просчёты"', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE });
    const page = await ctx.newPage();
    await loginAs(page, 'test_pm', 'Test123!', '0000');
    await page.goto(`${BASE_URL}/m/chat`);
    await page.waitForTimeout(1500);
    // Click on estimates tab
    const tabs = page.locator('button').filter({ hasText: 'Просчёты' });
    if (await tabs.count() > 0) await tabs.first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/screenshots/h6-02-mobile-tab-estimates.png', fullPage: false });
    await ctx.close();
  });

  test('Mobile: Inside estimate chat (PM)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE });
    const page = await ctx.newPage();
    await loginAs(page, 'test_pm', 'Test123!', '0000');
    await page.goto(`${BASE_URL}/m/chat`);
    await page.waitForTimeout(1500);
    // Click first estimate chat
    const estItem = page.locator('[style*="border-left: 3px"]').first();
    if (await estItem.count() > 0) {
      await estItem.click();
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: 'tests/screenshots/h6-03-mobile-chat-pm.png', fullPage: false });
    await ctx.close();
  });

  test('Mobile: Inside estimate chat (Director)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE });
    const page = await ctx.newPage();
    await loginAs(page, 'test_director_gen', 'Test123!', '0000');
    await page.goto(`${BASE_URL}/m/chat`);
    await page.waitForTimeout(1500);
    const estItem = page.locator('[style*="border-left: 3px"]').first();
    if (await estItem.count() > 0) {
      await estItem.click();
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: 'tests/screenshots/h6-04-mobile-chat-director.png', fullPage: false });
    await ctx.close();
  });

  test('Mobile: Tab "Личные"', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE });
    const page = await ctx.newPage();
    await loginAs(page, 'test_pm', 'Test123!', '0000');
    await page.goto(`${BASE_URL}/m/chat`);
    await page.waitForTimeout(1500);
    const tabs = page.locator('button').filter({ hasText: 'Личные' });
    if (await tabs.count() > 0) await tabs.first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/screenshots/h6-05-mobile-tab-personal.png', fullPage: false });
    await ctx.close();
  });

  test('Desktop: Chat list with tabs', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: DESKTOP });
    const page = await ctx.newPage();
    await loginAs(page, 'test_pm', 'Test123!', '0000');
    await page.goto(`${BASE_URL}/#/messenger`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'tests/screenshots/h6-06-desktop-chatlist.png', fullPage: false });
    await ctx.close();
  });

  test('Desktop: Inside estimate chat', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: DESKTOP });
    const page = await ctx.newPage();
    await loginAs(page, 'test_pm', 'Test123!', '0000');
    await page.goto(`${BASE_URL}/#/messenger`);
    await page.waitForTimeout(2000);
    // Click first estimate chat
    const estItem = page.locator('.chat-item[data-entity-type="estimate"]').first();
    if (await estItem.count() > 0) {
      await estItem.click();
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: 'tests/screenshots/h6-07-desktop-estimate-chat.png', fullPage: false });
    await ctx.close();
  });
});
