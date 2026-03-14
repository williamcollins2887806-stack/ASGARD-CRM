/**
 * Authentication module - login (3 steps: login→password→pin), JWT extraction
 */

const { BASE_URL, TIMEOUTS } = require('../config');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(role, msg) { console.log(`[${new Date().toLocaleTimeString()}] [${role}] ${msg}`); }

/**
 * Login to CRM via browser UI (with retry on failure)
 * @param {import('playwright').Page} page
 * @param {object} account - { login, password, pin, role }
 * @param {number} retries - number of retry attempts
 * @returns {Promise<void>}
 */
async function loginAs(page, account, retries = 2) {
  const { login, password, pin, role } = account;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      log(role, `Logging in as ${login}... (attempt ${attempt}/${retries})`);

      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.login });
      await sleep(3000);

      // Wait for either login button or already logged-in state
      const btnShowLogin = page.locator('#btnShowLogin');
      const isLoggedIn = await page.evaluate(() => {
        return !!document.querySelector('aside a[href^="#/"]');
      });

      if (isLoggedIn) {
        log(role, `Already logged in. URL: ${page.url()}`);
        return;
      }

      await btnShowLogin.waitFor({ state: 'visible', timeout: 10000 });
      await btnShowLogin.click();
      await sleep(2000);

      const loginField = page.locator('#w_login');
      await loginField.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
      await loginField.fill(login);
      await page.locator('input[type="password"]').first().fill(password);
      await page.getByText('Далее', { exact: true }).click();
      await sleep(3000);

      const pinField = page.locator('#w_pin');
      await pinField.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
      await pinField.click();
      await page.keyboard.type(pin, { delay: 100 });
      await page.locator('#btnVerifyPin').click();
      await sleep(4000);

      log(role, `Logged in. URL: ${page.url()}`);
      return; // success
    } catch (e) {
      log(role, `Login attempt ${attempt} failed: ${e.message.substring(0, 100)}`);
      if (attempt === retries) {
        throw e; // re-throw on last attempt
      }
      // Wait before retry
      await sleep(5000);
      // Try to reload the page
      try {
        await page.goto('about:blank', { timeout: 5000 });
        await sleep(1000);
      } catch {}
    }
  }
}

/**
 * Extract JWT token from localStorage after login
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>}
 */
async function extractToken(page) {
  return await page.evaluate(() => {
    return localStorage.getItem('token') || localStorage.getItem('jwt') || null;
  });
}

/**
 * Login via API (fetch-based) and return token
 * @param {string} login
 * @param {string} password
 * @param {string} pin
 * @returns {Promise<string>} JWT token
 */
async function loginApi(login, password, pin) {
  const fetch = (await import('node-fetch')).default;

  // Step 1: Login + password
  const loginResp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  const loginData = await loginResp.json();

  if (!loginResp.ok) {
    throw new Error(`Login failed for ${login}: ${loginData.error || loginResp.status}`);
  }

  // Step 2: PIN verification
  const pinResp = await fetch(`${BASE_URL}/api/auth/verify-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, pin, tempToken: loginData.tempToken }),
  });
  const pinData = await pinResp.json();

  if (!pinResp.ok) {
    throw new Error(`PIN verify failed for ${login}: ${pinData.error || pinResp.status}`);
  }

  return pinData.token;
}

module.exports = { loginAs, extractToken, loginApi, log, sleep };
