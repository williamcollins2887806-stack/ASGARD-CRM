const { test, expect } = require('@playwright/test');

test('debug PIN entry step by step', async ({ page }) => {
  // Step 1: Navigate and login
  await page.goto('https://asgard-crm.ru/#/welcome');
  await page.waitForTimeout(1500);

  await page.locator('#btnShowLogin').click();
  await page.waitForTimeout(600);

  await page.locator('#w_login').fill('test_to');
  await page.locator('#w_pass').fill('Test123!');
  await page.locator('#btnDoLogin').click();
  await page.waitForTimeout(2000);

  console.log('After login click, URL:', page.url());

  // Check pinForm
  const pinFormVisible = await page.locator('#pinForm').isVisible().catch(() => false);
  console.log('#pinForm visible:', pinFormVisible);

  if (!pinFormVisible) {
    console.log('NO PIN FORM - checking what is visible...');
    const bodyText = await page.textContent('body');
    console.log('Body (first 500):', bodyText.trim().slice(0, 500));
    return;
  }

  // Check pk-keypad structure
  const pkKeypad = await page.locator('#pk-keypad').isVisible().catch(() => false);
  console.log('#pk-keypad visible:', pkKeypad);

  const allDataDigits = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-digit]')).map(el => ({
      dataDigit: el.getAttribute('data-digit'),
      id: el.id,
      tag: el.tagName,
      classes: el.className,
      offsetParent: el.offsetParent !== null,
      inPkKeypad: !!el.closest('#pk-keypad'),
    }));
  });
  console.log('All [data-digit] elements:', JSON.stringify(allDataDigits, null, 2));

  // Try clicking PIN digits
  console.log('Clicking PIN 0 0 0 0...');
  for (let i = 0; i < 4; i++) {
    const key = page.locator('#pk-keypad [data-digit="0"]').first();
    await key.click();
    await page.waitForTimeout(300);

    const pinStillVisible = await page.locator('#pinForm').isVisible().catch(() => false);
    console.log('After click ' + (i+1) + ': #pinForm still visible:', pinStillVisible, '| URL:', page.url());

    if (!pinStillVisible) {
      console.log('PIN form disappeared after ' + (i+1) + ' clicks!');
      break;
    }
  }

  await page.waitForTimeout(3000);
  console.log('FINAL URL:', page.url());

  const finalPinVisible = await page.locator('#pinForm').isVisible().catch(() => false);
  console.log('FINAL #pinForm visible:', finalPinVisible);
});
