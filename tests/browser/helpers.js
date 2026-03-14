// Playwright test helpers for ASGARD CRM
const { expect } = require('@playwright/test');

const BASE_URL = 'https://asgard-crm.ru';

const ACCOUNTS = {
  ADMIN:          { login: 'admin',              password: 'admin123',    pin: '1234' },
  DIRECTOR_GEN:   { login: 'test_director_gen',  password: 'Test123!',    pin: '0000' },
  DIRECTOR_COMM:  { login: 'test_director_comm', password: 'Test123!',    pin: '0000' },
  DIRECTOR_DEV:   { login: 'test_director_dev',  password: 'Test123!',    pin: '0000' },
  HEAD_PM:        { login: 'test_head_pm',       password: 'Test123!',    pin: '0000' },
  HEAD_TO:        { login: 'test_head_to',       password: 'Test123!',    pin: '0000' },
  PM:             { login: 'test_pm',            password: 'Test123!',    pin: '0000' },
  TO:             { login: 'test_to',            password: 'Test123!',    pin: '0000' },
  HR:             { login: 'test_hr',            password: 'Test123!',    pin: '0000' },
  BUH:            { login: 'test_buh',           password: 'Test123!',    pin: '0000' },
  PROC:           { login: 'test_proc',          password: 'Test123!',    pin: '0000' },
  WAREHOUSE:      { login: 'test_warehouse',     password: 'Test123!',    pin: '0000' },
};

/**
 * Login as a specific role via the CRM welcome/login page.
 * Flow: #/welcome → click "Войти" → fill #w_login + #w_pass → click #btnDoLogin → PIN: #w_pin → #btnVerifyPin
 */
async function loginAs(page, role) {
  const acc = ACCOUNTS[role];
  if (!acc) throw new Error(`No account for role: ${role}`);

  await page.goto(BASE_URL + '/#/welcome');
  await page.waitForTimeout(800);

  // Click "Войти" button to show login form
  const showLoginBtn = page.locator('#btnShowLogin, #btnLoginGo, button:has-text("Войти")');
  if (await showLoginBtn.count() > 0) {
    await showLoginBtn.first().click();
    await page.waitForTimeout(500);
  }

  // Wait for login form to appear
  await page.waitForSelector('#w_login, #loginInput', { timeout: 5000 }).catch(() => {});

  // Fill login and password
  const loginField = page.locator('#w_login, #loginInput');
  const passField = page.locator('#w_pass, #passwordInput');

  if (await loginField.count() > 0) {
    await loginField.fill(acc.login);
  }
  if (await passField.count() > 0) {
    await passField.fill(acc.password);
  }

  // Click login button
  const loginBtn = page.locator("#btnDoLogin");
  if (await loginBtn.count() > 0) {
    await loginBtn.click();
  }

  await page.waitForTimeout(2000);

  // Check if PIN screen appeared
  const pinField = page.locator('#w_pin, #pinInput');
  if (await pinField.isVisible().catch(() => false)) {
    await pinField.fill(acc.pin);
    await page.waitForTimeout(200);
    const pinBtn = page.locator('#btnVerifyPin, button:has-text("Войти")');
    if (await pinBtn.count() > 0) {
      await pinBtn.first().click();
    }
    await page.waitForTimeout(1500);
  }

  // Check for first-time setup (new password + PIN)
  const setupForm = page.locator('#setupForm');
  if (await setupForm.isVisible().catch(() => false)) {
    const newPass = page.locator('#s_pass');
    const newPin = page.locator('#s_pin');
    if (await newPass.count() > 0) {
      await newPass.fill(acc.password);
    }
    if (await newPin.count() > 0) {
      await newPin.fill(acc.pin);
    }
    const setupBtn = page.locator('#btnSetupSave, button:has-text("Сохранить")');
    if (await setupBtn.count() > 0) {
      await setupBtn.first().click();
    }
    await page.waitForTimeout(2000);
  }

  // Verify we're logged in — should be on home or dashboard
  await page.waitForTimeout(500);
}

/**
 * Navigate to a CRM page by hash
 */
async function navigateTo(page, pageName) {
  await page.goto(BASE_URL + '/#/' + pageName);
  await page.waitForTimeout(1500);
  // Wait for content
  await page.waitForSelector('#mainContent, .page-content, .panel, [data-page], #app', { timeout: 10000 }).catch(() => {});
}

/**
 * Check if any modal is visible
 */
async function isModalVisible(page) {
  return page.evaluate(() => {
    const modals = document.querySelectorAll('.modal, .modal-overlay, [class*="modal"]');
    for (const m of modals) {
      const style = window.getComputedStyle(m);
      if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
        // Check if it has actual content (not just an empty container)
        if (m.querySelector('.modal-title, .modal-header, .modal-body, h2, h3') || m.textContent.trim().length > 20) {
          return true;
        }
      }
    }
    return false;
  });
}

/**
 * Close the current modal
 */
async function closeModal(page) {
  // Try ESC key first
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await isModalVisible(page)) {
    // Try close button
    const closeBtn = page.locator('.modal-close, .btn-close, button:has-text("Закрыть"), button:has-text("Отмена"), .modal .close');
    if (await closeBtn.count() > 0) {
      await closeBtn.first().click();
      await page.waitForTimeout(300);
    }
  }
}

/**
 * Get all visible buttons on the page
 */
async function getVisibleButtons(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, .btn, [role="button"]'))
      .filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
      })
      .map(el => ({
        text: (el.textContent || '').trim().slice(0, 50),
        id: el.id || '',
        classes: el.className || '',
      }));
  });
}

/**
 * Get all visible inputs
 */
async function getVisibleInputs(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, select, textarea'))
      .filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null && el.type !== 'hidden';
      })
      .map(el => ({
        type: el.type || el.tagName.toLowerCase(),
        id: el.id || '',
        name: el.name || '',
        placeholder: el.placeholder || '',
      }));
  });
}

module.exports = {
  BASE_URL,
  ACCOUNTS,
  loginAs,
  navigateTo,
  isModalVisible,
  closeModal,
  getVisibleButtons,
  getVisibleInputs,
};
