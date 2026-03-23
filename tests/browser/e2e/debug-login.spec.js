const { test } = require('@playwright/test');

test('debug login flow for TO', async ({ page }) => {
  await page.goto('https://asgard-crm.ru/#/welcome');
  await page.waitForTimeout(1000);
  console.log('1. URL after goto welcome:', page.url());

  const showLoginBtn = page.locator('#btnShowLogin');
  const isVisible = await showLoginBtn.isVisible({ timeout: 5000 }).catch(() => false);
  console.log('2. #btnShowLogin visible:', isVisible);

  if (isVisible) {
    await showLoginBtn.click();
    await page.waitForTimeout(600);
    console.log('3. URL after clicking #btnShowLogin:', page.url());
  }

  const loginFormVisible = await page.locator('#loginForm').isVisible({ timeout: 5000 }).catch(() => false);
  console.log('4. #loginForm visible:', loginFormVisible);

  const wLogin = await page.locator('#w_login').isVisible().catch(() => false);
  const wPass = await page.locator('#w_pass').isVisible().catch(() => false);
  console.log('5. #w_login visible:', wLogin, '#w_pass visible:', wPass);

  if (wLogin) {
    await page.locator('#w_login').fill('test_to');
    await page.locator('#w_pass').fill('Test123!');
    console.log('6. Filled login and password');
  }

  const btnDoLoginVisible = await page.locator('#btnDoLogin').isVisible().catch(() => false);
  console.log('7. #btnDoLogin visible:', btnDoLoginVisible);

  if (btnDoLoginVisible) {
    await page.locator('#btnDoLogin').click();
    console.log('8. Clicked #btnDoLogin');
    await page.waitForTimeout(2000);
    console.log('9. URL after login click:', page.url());
  }

  const pinFormVisible = await page.locator('#pinForm').isVisible({ timeout: 5000 }).catch(() => false);
  console.log('10. #pinForm visible:', pinFormVisible);

  if (pinFormVisible) {
    console.log('11. Entering PIN 0000...');
    for (const digit of '0000') {
      const key = page.locator('#pk-keypad [data-digit="' + digit + '"]');
      const keyVisible = await key.isVisible({ timeout: 5000 }).catch(() => false);
      console.log('  digit ' + digit + ' visible:', keyVisible);
      if (keyVisible) {
        await key.click();
        await page.waitForTimeout(200);
      }
    }
    await page.waitForTimeout(2000);
    console.log('12. URL after PIN entry:', page.url());
  }

  await page.waitForTimeout(1000);
  console.log('FINAL URL:', page.url());
});
