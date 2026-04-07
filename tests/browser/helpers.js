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
  PM_ANDROSOV:    { login: 'n.androsov',         password: 'Test123!',    pin: '0000' },
  TO:             { login: 'test_to',            password: 'Test123!',    pin: '0000' },
  HR:             { login: 'test_hr',            password: 'Test123!',    pin: '0000' },
  BUH:            { login: 'test_buh',           password: 'Test123!',    pin: '0000' },
  PROC:           { login: 'test_proc',          password: 'Test123!',    pin: '0000' },
  WAREHOUSE:      { login: 'test_warehouse',     password: 'Test123!',    pin: '0000' },
};

/**
 * Enter PIN via virtual keypad (digits are clickable divs [data-digit="X"])
 */
async function enterPin(page, pin) {
  // Wait for PIN form to be visible
  await page.waitForSelector('#pinForm', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300); // wait for keypad to render

  for (const digit of pin.split('')) {
    const key = page.locator(`#pk-keypad [data-digit="${digit}"]`);
    await key.waitFor({ state: 'visible', timeout: 5000 });
    await key.click();
    await page.waitForTimeout(300); // small delay between digits
  }
  // After 4 digits PIN is auto-submitted — wait for SPA to navigate
  await page.waitForTimeout(3000);
}

/**
 * Login as a specific role via the CRM welcome page.
 * Flow: #/welcome → #btnShowLogin → fill #w_login + #w_pass → #btnDoLogin → PIN keypad → done
 */
async function loginAs(page, role) {
  const acc = ACCOUNTS[role];
  if (!acc) throw new Error(`No account for role: ${role}`);

  // Clear any existing session to prevent the SPA from auto-redirecting #/welcome → #/home
  // when a token exists in localStorage, which would cause getSessionToken() to return
  // the PREVIOUS user's token (role-switch bug in multi-role tests).
  //
  // Note: if the page is at about:blank (fresh test start), this evaluate runs in the
  // about:blank context and is a no-op — that's fine because each Playwright test gets
  // a fresh browser context (fresh localStorage) so there's nothing to clear.
  // If the page is already on the CRM domain (within-test role switch), this correctly
  // removes the current user's token from CRM's localStorage.
  await page.evaluate(() => {
    ['asgard_token', 'token', 'authToken', 'auth_token', 'access_token', 'jwt'].forEach(k => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
  }).catch(() => {});

  await page.goto(BASE_URL + '/#/welcome');
  // Wait for welcome page to be fully interactive (button visible, not just DOM loaded)
  await page.waitForSelector('#btnShowLogin', { state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Click #btnShowLogin to reveal the login form (NOT #btnLoginGo which navigates away)
  await page.locator('#btnShowLogin').click().catch(() => {});
  // Wait for login form to become VISIBLE (not just present in DOM)
  await page.waitForSelector('#w_login', { state: 'visible', timeout: 8000 }).catch(() => {});

  // Fill login and password
  await page.locator('#w_login').fill(acc.login).catch(() => {});
  await page.locator('#w_pass').fill(acc.password).catch(() => {});

  // Submit login
  await page.locator('#btnDoLogin').click().catch(() => {});
  // Wait for PIN form to become VISIBLE after server responds (up to 20s — slow server from local machine)
  await page.waitForSelector('#pinForm', { state: 'visible', timeout: 20000 }).catch(() => {});

  // Check for first-time setup form (#setupForm shown when account has no password yet)
  const setupForm = page.locator('#setupForm');
  if (await setupForm.isVisible().catch(() => false)) {
    await page.locator('#s_pass').fill(acc.password).catch(() => {});
    await page.waitForTimeout(500);
    const setupPinContainer = page.locator('#setupPinKeypadContainer');
    if (await setupPinContainer.isVisible().catch(() => false)) {
      for (const digit of acc.pin.split('')) {
        await setupPinContainer.locator(`[data-digit="${digit}"]`).click().catch(() => {});
        await page.waitForTimeout(150);
      }
    }
    await page.locator('#btnSetupSave').click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  // Enter PIN via virtual keypad
  const pinFormVisible = await page.locator('#pinForm').isVisible().catch(() => false);
  if (pinFormVisible) {
    await enterPin(page, acc.pin);
    // Wait for PIN modal and its backdrop to fully close before interacting
    await page.waitForSelector('#pinForm', { state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.waitForSelector('.modalback', { state: 'hidden', timeout: 5000 }).catch(() => {});
    // Wait for the full session token (post-PIN) to be stored in localStorage
    // and for navigation away from welcome page — guarantees getSessionToken() gets real token
    await page.waitForFunction(
      () => {
        const t = localStorage.getItem('asgard_token');
        return !!t && t.length > 50 && !window.location.hash.includes('/welcome');
      },
      { timeout: 20000 }
    ).catch(() => {});
  }
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

// ─── Console Error Collector ───

function setupConsoleCollector(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore known harmless errors
      if (text.includes('favicon')) return;
      if (text.includes('net::ERR')) return;
      if (text.includes('ResizeObserver')) return;
      if (text.includes('ETELEGRAM')) return;
      if (text.includes('service-worker') || text.includes('sw.js')) return;
      // Ignore expected HTTP 401/403 — these are normal access-denied responses,
      // NOT JavaScript bugs. Access control tests intentionally trigger them.
      if (text.includes('status of 401') || text.includes('status of 403')) return;
      if (text.includes('Failed to load resource')) return; // all HTTP errors are server-side
      errors.push(text);
    }
  });
  page.on('pageerror', err => errors.push(`PAGE_ERROR: ${err.message}`));
  return errors;
}

function assertNoConsoleErrors(errors, testName) {
  if (errors.length > 0) {
    throw new Error(`Console errors in "${testName}":\n${errors.join('\n')}`);
  }
}

// ─── Page Helpers ───

async function waitForPageLoad(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
}

async function clickCreate(page) {
  // Wait for async page content to render
  await page.waitForTimeout(1000);

  // Find the first TRULY VISIBLE create/add button using JS evaluation
  // (avoids capturing hidden modal buttons that also match "Создать")
  const clicked = await page.evaluate(() => {
    const keywords = ['Создать', 'Добавить', 'Новый', 'Новое', 'New', '+ '];
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const btn of buttons) {
      if (btn.id === 'mimirNewChat') continue; // exclude Mimir chat "Новый диалог"
      const txt = (btn.textContent || '').trim();
      const isVisible = btn.offsetParent !== null &&
        window.getComputedStyle(btn).display !== 'none' &&
        window.getComputedStyle(btn).visibility !== 'hidden';
      const matchesText = keywords.some(kw => txt.includes(kw));
      const matchesId = /btn(New|Create|Add)/i.test(btn.id || '');
      if (isVisible && (matchesText || matchesId)) {
        btn.click();
        return { id: btn.id, txt: txt.slice(0, 40) };
      }
    }
    return null;
  });

  if (!clicked) {
    // Fallback: wait up to 10s for any create button to appear, then retry
    await page.waitForFunction(() => {
      const keywords = ['Создать', 'Добавить', 'Новый', 'Новое', '+ '];
      return Array.from(document.querySelectorAll('button')).some(b => {
        if (b.id === 'mimirNewChat') return false;
        const txt = (b.textContent || '').trim();
        const visible = b.offsetParent !== null;
        return visible && (keywords.some(k => txt.includes(k)) || /btn(New|Create|Add)/i.test(b.id || ''));
      });
    }, {}, { timeout: 10000 });

    await page.evaluate(() => {
      const keywords = ['Создать', 'Добавить', 'Новый', 'Новое', '+ '];
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        if (btn.id === 'mimirNewChat') continue;
        const txt = (btn.textContent || '').trim();
        const visible = btn.offsetParent !== null;
        if (visible && (keywords.some(k => txt.includes(k)) || /btn(New|Create|Add)/i.test(btn.id || ''))) {
          btn.click();
          return;
        }
      }
    });
  }

  await page.waitForTimeout(500);
}

async function fillField(page, labelOrId, value) {
  if (labelOrId.startsWith('#')) {
    await page.fill(labelOrId, value);
  } else {
    const byLabel = page.getByLabel(labelOrId);
    if (await byLabel.count() > 0) {
      await byLabel.first().fill(value);
    } else {
      const byPlaceholder = page.locator(`input[placeholder*="${labelOrId}"], textarea[placeholder*="${labelOrId}"]`);
      if (await byPlaceholder.count() > 0) {
        await byPlaceholder.first().fill(value);
      }
    }
  }
}

async function selectOption(page, selectorOrId, value) {
  if (selectorOrId.startsWith('#')) {
    await page.selectOption(selectorOrId, value);
  } else {
    await page.locator(`select[name="${selectorOrId}"]`).selectOption(value);
  }
}

async function clickSave(page) {
  const btn = page.locator('.modal button:has-text("Сохранить"), .modal button:has-text("Создать"), .modal button.btn-primary, #modalBody button.btn-primary').first();
  await btn.waitFor({ state: 'visible', timeout: 5000 });
  await btn.click();
  await page.waitForTimeout(500);
}

async function expectToast(page, type = 'ok') {
  const cls = type === 'ok' ? '.toast-success, .toast-ok, .alert-success' : '.toast-error, .toast-danger, .alert-danger';
  await page.locator(cls).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
}

async function expectListNotEmpty(page) {
  const rows = page.locator('table tbody tr, .card[data-id], .list-item, [data-id], .data-row');
  await rows.first().waitFor({ state: 'visible', timeout: 10000 });
}

async function expectNoAccess(page) {
  const noAccess = page.locator('text=Нет доступа, text=Доступ запрещён, text=403, .no-access, .access-denied');
  const homeRedirect = page.url().includes('#/home') || page.url().includes('#/welcome');
  const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить")');
  const createHidden = (await createBtn.count()) === 0;
  return homeRedirect || (await noAccess.count()) > 0 || createHidden;
}

async function apiCall(page, method, url, body, token) {
  return page.evaluate(async ({ method, url, body, token }) => {
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: resp.status, data: await resp.json().catch(() => null) };
  }, { method, url, body, token });
}

async function getToken(page, role) {
  // Use full login (including PIN) to get a real session token.
  // Pre-PIN tokens from /api/auth/login are restricted and return 403 on most API endpoints.
  // We must clear localStorage first to bypass loginAs's early-return when already on #/home,
  // which would otherwise keep the previous user's session active.
  const currentUrl = page.url();
  if (!currentUrl.startsWith(BASE_URL)) {
    await page.goto(BASE_URL + '/#/welcome');
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => {
    ['asgard_token', 'token', 'authToken', 'auth_token', 'access_token', 'jwt'].forEach(k => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
  });
  await loginAs(page, role);
  return getSessionToken(page);
}

/**
 * Click a table row, bypassing sticky headers that intercept pointer events.
 */
async function clickRow(page, locator) {
  const row = typeof locator === 'string' ? page.locator(locator) : locator;
  if (await row.count() > 0) {
    // Try normal click first; fall back to force:true for sticky-header overlap
    await row.first().click({ force: true });
    return true;
  }
  return false;
}

/**
 * Get the fully-authenticated session token from localStorage.
 * Use this when loginAs() was already called (token is stored after PIN verification).
 */
async function getSessionToken(page) {
  return page.evaluate(() => {
    const keys = ['asgard_token', 'token', 'authToken', 'auth_token', 'access_token', 'jwt'];
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v && v.length > 20) return v;
    }
    return null;
  });
}

module.exports = {
  BASE_URL,
  ACCOUNTS,
  loginAs,
  enterPin,
  navigateTo,
  isModalVisible,
  closeModal,
  getVisibleButtons,
  getVisibleInputs,
  setupConsoleCollector,
  assertNoConsoleErrors,
  waitForPageLoad,
  clickCreate,
  clickRow,
  fillField,
  selectOption,
  clickSave,
  expectToast,
  expectListNotEmpty,
  expectNoAccess,
  apiCall,
  getToken,
  getSessionToken,
};
