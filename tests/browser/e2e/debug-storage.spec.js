const { test } = require('@playwright/test');

test('check session storage after login then goto', async ({ page }) => {
  // Step 1: Login manually (same as debug-pin)
  await page.goto('https://asgard-crm.ru/#/welcome');
  await page.waitForTimeout(1500);
  await page.locator('#btnShowLogin').click();
  await page.waitForTimeout(600);
  await page.locator('#w_login').fill('test_to');
  await page.locator('#w_pass').fill('Test123!');
  await page.locator('#btnDoLogin').click();
  await page.waitForTimeout(2000);

  const pinVisible = await page.locator('#pinForm').isVisible().catch(() => false);
  console.log('#pinForm visible:', pinVisible);

  for (const digit of '0000') {
    const key = page.locator('#pk-keypad [data-digit="' + digit + '"]').first();
    await key.click();
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(3000);

  console.log('URL after PIN:', page.url());

  // Check storage
  const storage = await page.evaluate(() => {
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      ls[k] = (localStorage.getItem(k) || '').slice(0, 100);
    }
    const ss = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      ss[k] = (sessionStorage.getItem(k) || '').slice(0, 100);
    }
    return { localStorage: ls, sessionStorage: ss };
  });
  console.log('Storage BEFORE page.goto:', JSON.stringify(storage, null, 2));

  // Step 2: Use page.goto() to navigate (like navigateTo does)
  await page.goto('https://asgard-crm.ru/#/tkp');
  await page.waitForTimeout(1500);

  console.log('URL after page.goto tkp:', page.url());

  const storage2 = await page.evaluate(() => {
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      ls[k] = (localStorage.getItem(k) || '').slice(0, 100);
    }
    const ss = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      ss[k] = (sessionStorage.getItem(k) || '').slice(0, 100);
    }
    return { localStorage: ls, sessionStorage: ss };
  });
  console.log('Storage AFTER page.goto:', JSON.stringify(storage2, null, 2));
});
