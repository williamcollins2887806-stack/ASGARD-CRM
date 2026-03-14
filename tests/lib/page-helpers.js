/**
 * Page helpers - navigation, modals, screenshots, menu collection
 * Updated: excludes MiMir chat buttons, improved modal handling for ASGARD CRM
 */

const path = require('path');
const { DIRS, TIMEOUTS } = require('../config');
const { sleep, log } = require('./auth');

/**
 * Take a screenshot on error
 */
async function screenshotOnError(page, role, name) {
  const safe = `${role}_${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
  const p = path.join(DIRS.screenshots, `err_${safe}_${Date.now()}.png`);
  try {
    await page.screenshot({ path: p, fullPage: false, timeout: 5000 });
    return p;
  } catch {
    return null;
  }
}

/**
 * Collect all menu pages from the sidebar
 */
async function collectMenuPages(page) {
  const sidebarSelectors = ['aside a', '[class*="sidebar"] a', 'nav a[href^="#/"]', '[class*="menu"] a[href^="#/"]'];
  for (const sel of sidebarSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 });
      break;
    } catch {}
  }
  await sleep(2000);

  return await page.evaluate(() => {
    const containers = [
      document.querySelector('aside'),
      document.querySelector('[class*="sidebar"]'),
      document.querySelector('nav'),
      document.querySelector('[class*="menu"]'),
    ].filter(Boolean);

    const seen = new Set();
    const items = [];
    const searchIn = containers.length > 0 ? containers : [document.body];

    for (const container of searchIn) {
      const links = container.querySelectorAll('a[href^="#/"]');
      links.forEach(a => {
        const href = a.getAttribute('href');
        if (!href || href === '#/welcome' || href === '#/home' || seen.has(href)) return;
        seen.add(href);
        const spans = a.querySelectorAll('span');
        let name = '';
        if (spans.length > 0) name = spans[0].textContent.trim();
        if (!name) name = a.textContent.trim().split('\n')[0].trim();
        if (name) items.push({ name: name.substring(0, 50), href });
      });
      if (items.length > 0) break;
    }

    return items;
  });
}

/**
 * Navigate to a specific hash route with proper wait
 */
async function navigateTo(page, route) {
  await page.evaluate(hash => { window.location.hash = hash.replace(/^#/, ''); }, route);
  await sleep(3000);
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {}
}

/**
 * Check if element is inside MiMir chat or sidebar (should be excluded from button searches)
 */
function _isExcludedContainer(el) {
  // Check if button is inside MiMir chat drawer, sidebar, or navigation
  const excluded = el.closest('.mimir-drawer, .mimir-panel, [class*="mimir"], aside, nav, [class*="sidebar"]');
  return !!excluded;
}

/**
 * Check if a modal/drawer is currently open (CRM uses .show class on modals)
 */
async function isModalOpen(page) {
  return await page.evaluate(() => {
    // Strategy 1: CRM uses .modal-overlay.show pattern
    const overlays = document.querySelectorAll('.modal-overlay.show, .modal-overlay[style*="display: flex"], .modal-overlay[style*="display: block"]');
    for (const o of overlays) {
      const rect = o.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 50) return true;
    }

    // Strategy 2: Generic modal detection
    const modals = document.querySelectorAll(
      '[class*="modal"]:not([style*="display: none"]):not([style*="display:none"]):not(.modal-overlay), ' +
      '[role="dialog"], ' +
      '[class*="drawer"]:not([style*="display: none"]):not([class*="mimir"]), ' +
      '[class*="popup"]:not([style*="display: none"])'
    );
    for (const m of modals) {
      // Skip MiMir elements
      if (m.classList.contains('mimir-drawer') || m.closest('[class*="mimir"]')) continue;
      const rect = m.getBoundingClientRect();
      const style = window.getComputedStyle(m);
      if (rect.width > 50 && rect.height > 50 && style.display !== 'none' && style.visibility !== 'hidden') {
        return true;
      }
    }
    return false;
  });
}

/**
 * Close any open modal/drawer
 */
async function closeModal(page) {
  // Strategy 1: Click CRM close button (⛨ or ×)
  const closed = await page.evaluate(() => {
    // Find visible modal overlay
    const overlay = document.querySelector('.modal-overlay.show, .modal-overlay[style*="display: flex"]');
    if (overlay) {
      const closeBtn = overlay.querySelector('button[class*="close"], .modal-close, button:first-of-type');
      if (closeBtn) {
        closeBtn.click();
        return true;
      }
      // Try removing .show class directly
      overlay.classList.remove('show');
      overlay.style.display = 'none';
      return true;
    }

    // Generic: find close buttons in visible modals
    const modals = document.querySelectorAll('[class*="modal"]:not([style*="display: none"]), [role="dialog"]');
    for (const m of modals) {
      if (m.closest('[class*="mimir"]')) continue;
      const rect = m.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) continue;
      const btn = m.querySelector('button[class*="close"], .close, [aria-label="Close"], [aria-label="Закрыть"]');
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  });

  if (closed) {
    await sleep(500);
    return;
  }

  // Strategy 2: Escape key
  await page.keyboard.press('Escape');
  await sleep(500);

  // Strategy 3: Click "Закрыть" or "Отмена" button
  const stillOpen = await isModalOpen(page);
  if (stillOpen) {
    try {
      const cancelBtn = page.locator('button:has-text("Закрыть"), button:has-text("Отмена"), button:has-text("×")').first();
      if (await cancelBtn.isVisible({ timeout: 2000 })) {
        await cancelBtn.click();
        await sleep(500);
      }
    } catch {}
  }
}

/**
 * Check if element is truly visible in the main content area (not in mimir/sidebar/nav)
 */
async function _isVisibleInMainContent(page, locator) {
  try {
    const isVis = await locator.isVisible({ timeout: 2000 });
    if (!isVis) return false;

    // Check it's not inside excluded container
    const excluded = await locator.evaluate(el => {
      return !!(el.closest('.mimir-drawer, .mimir-panel, [class*="mimir"], aside, nav') ||
               el.id === 'mimirNewChat' ||
               el.classList.contains('mimir-quick-btn') ||
               el.classList.contains('mimir-new-chat-btn'));
    });
    return !excluded;
  } catch {
    return false;
  }
}

/**
 * Click a button matching text pattern (case-insensitive)
 * EXCLUDES MiMir chat buttons and sidebar buttons
 * Handles CRM-specific button texts: "Внести", "📋 Создать", emoji-prefixed, etc.
 */
async function clickButton(page, textPattern) {
  const timeout = TIMEOUTS.formFill;
  // Enhance pattern: add common CRM button texts
  let enhancedPattern = textPattern;
  if (/Создат|Добавит|Новый|Новая/.test(textPattern)) {
    enhancedPattern = textPattern + '|Внести|внести';
  }
  const regex = new RegExp(enhancedPattern, 'i');

  // Strategy 0: Try known button IDs first
  const knownIds = ['#btnNew', '#btnCreate', '#btnAdd', '#btnAddEquip', '#btnAddEquipment', '#fabBtn'];
  for (const sel of knownIds) {
    try {
      const btn = page.locator(sel);
      if (await btn.count() > 0) {
        const isVis = await btn.evaluate(el => {
          const r = el.getBoundingClientRect();
          const s = window.getComputedStyle(el);
          return r.width > 5 && r.height > 5 && s.display !== 'none' && s.visibility !== 'hidden';
        });
        if (isVis) {
          await btn.click();
          await sleep(1000);
          return;
        }
      }
    } catch {}
  }

  // Strategy 1: DOM evaluation — most reliable, excludes MiMir
  const clicked = await page.evaluate((pattern) => {
    const regex = new RegExp(pattern, 'i');
    const candidates = document.querySelectorAll(
      'button, [role="button"], a.btn, a[class*="btn"], a[class*="button"], ' +
      'div[class*="btn"], span[class*="btn"], input[type="submit"], input[type="button"]'
    );

    // Filter to main content buttons only
    const mainBtns = Array.from(candidates).filter(el => {
      // Exclude MiMir, sidebar, navigation
      if (el.closest('.mimir-drawer, .mimir-panel, [class*="mimir"], aside, nav, [class*="sidebar"]')) return false;
      if (el.id === 'mimirNewChat' || el.classList.contains('mimir-quick-btn') || el.classList.contains('mimir-new-chat-btn')) return false;

      const rect = el.getBoundingClientRect();
      if (rect.width < 5 || rect.height < 5) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      if (el.offsetParent === null && style.position !== 'fixed') return false;

      return true;
    });

    for (const el of mainBtns) {
      const text = el.textContent?.trim() || '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const allText = `${text} ${ariaLabel} ${title}`;

      if (regex.test(allText)) {
        el.click();
        return true;
      }
    }
    return false;
  }, textPattern);

  if (clicked) {
    await sleep(1000);
    return;
  }

  // Strategy 2: Playwright locator with visibility + exclusion check
  const selectors = ['button', '[role="button"]', 'a.btn', 'a[class*="btn"]'];
  for (const sel of selectors) {
    try {
      const allBtns = page.locator(sel).filter({ hasText: regex });
      const count = await allBtns.count();
      for (let i = 0; i < count; i++) {
        const btn = allBtns.nth(i);
        if (await _isVisibleInMainContent(page, btn)) {
          await btn.click();
          await sleep(1000);
          return;
        }
      }
    } catch {}
  }

  // Strategy 3: Wait and retry DOM approach
  await sleep(3000);
  const clickedRetry = await page.evaluate((pattern) => {
    const regex = new RegExp(pattern, 'i');
    const candidates = document.querySelectorAll('button, [role="button"]');
    for (const el of candidates) {
      if (el.closest('.mimir-drawer, .mimir-panel, [class*="mimir"], aside, nav')) continue;
      if (el.id === 'mimirNewChat') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 5 || rect.height < 5) continue;
      if (window.getComputedStyle(el).display === 'none') continue;
      const text = (el.textContent?.trim() || '') + ' ' + (el.getAttribute('aria-label') || '');
      if (regex.test(text)) {
        el.click();
        return true;
      }
    }
    return false;
  }, textPattern);

  if (clickedRetry) {
    await sleep(1000);
    return;
  }

  throw new Error(`Button "${textPattern}" not found in main content area`);
}

/**
 * Wait for and click a specific button
 */
async function clickButtonBySelector(page, selector) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: TIMEOUTS.modal });
  await el.click();
  await sleep(1000);
}

/**
 * Find a create button on the page ("+", "Создать", "Добавить")
 * EXCLUDES MiMir chat buttons
 */
async function findCreateButton(page) {
  // Strategy 0: Check known create button IDs
  const knownIds = ['#btnNew', '#btnCreate', '#btnAdd'];
  for (const sel of knownIds) {
    try {
      const btn = page.locator(sel);
      if (await btn.count() > 0) {
        const isVis = await btn.evaluate(el => {
          const r = el.getBoundingClientRect();
          const s = window.getComputedStyle(el);
          return r.width > 5 && r.height > 5 && s.display !== 'none' && s.visibility !== 'hidden';
        });
        if (isVis) return btn;
      }
    } catch {}
  }

  // Strategy 1: DOM evaluation — most reliable
  const btnInfo = await page.evaluate(() => {
    const patterns = [/Создать/i, /Добавить/i, /Новый/i, /Новая/i, /Новое/i, /Внести/i, /^\+$/];
    const candidates = document.querySelectorAll(
      'button, [role="button"], a.btn, a[class*="btn"]'
    );

    for (const el of candidates) {
      // Exclude MiMir, sidebar, navigation
      if (el.closest('.mimir-drawer, .mimir-panel, [class*="mimir"], aside, nav, [class*="sidebar"]')) continue;
      if (el.id === 'mimirNewChat' || el.classList.contains('mimir-quick-btn') || el.classList.contains('mimir-new-chat-btn')) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 5 || rect.height < 5) continue;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (el.offsetParent === null && style.position !== 'fixed') continue;

      const text = (el.textContent || '').trim();
      for (const p of patterns) {
        if (p.test(text)) {
          // Return a unique selector for this element
          if (el.id) return { selector: `#${el.id}` };
          // Build a unique CSS path
          const tag = el.tagName.toLowerCase();
          const cls = el.className ? `.${el.className.split(/\s+/).filter(c => c && !c.startsWith('mimir')).join('.')}` : '';
          return { selector: `${tag}${cls}`, text: text.substring(0, 30), index: Array.from(el.parentNode.children).indexOf(el) };
        }
      }
    }
    return null;
  });

  if (!btnInfo) return null;

  // Use Playwright to find and return the locator
  if (btnInfo.selector.startsWith('#')) {
    const btn = page.locator(btnInfo.selector);
    if (await btn.count() > 0) return btn;
  }

  // Fallback: find by text in main content
  const patterns = ['Создать', 'Добавить', 'Новый', 'Новая', 'Новое', '+'];
  for (const text of patterns) {
    const allBtns = page.locator(`button:has-text("${text}"), [role="button"]:has-text("${text}")`);
    const count = await allBtns.count();
    for (let i = 0; i < count; i++) {
      const btn = allBtns.nth(i);
      if (await _isVisibleInMainContent(page, btn)) {
        return btn;
      }
    }
  }

  return null;
}

/**
 * Wait for network to settle
 */
async function waitForNetworkIdle(page, timeout = 3000) {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {}
}

/**
 * Check for error toasts/notifications on page
 */
async function checkForErrors(page) {
  return await page.evaluate(() => {
    const errors = [];
    const toasts = document.querySelectorAll(
      '[class*="toast"][class*="error"], [class*="toast"][class*="danger"], ' +
      '[class*="notification"][class*="error"], [class*="alert"][class*="danger"], ' +
      '[class*="snackbar"][class*="error"]'
    );
    toasts.forEach(t => {
      const text = t.textContent?.trim();
      if (text) errors.push(text.substring(0, 200));
    });
    return errors;
  });
}

/**
 * Check for success indicators
 */
async function checkForSuccess(page) {
  return await page.evaluate(() => {
    const toasts = document.querySelectorAll(
      '[class*="toast"][class*="success"], [class*="notification"][class*="success"], ' +
      '[class*="alert"][class*="success"], [class*="snackbar"][class*="success"]'
    );
    return toasts.length > 0;
  });
}

module.exports = {
  screenshotOnError,
  collectMenuPages,
  navigateTo,
  isModalOpen,
  closeModal,
  clickButton,
  clickButtonBySelector,
  findCreateButton,
  waitForNetworkIdle,
  checkForErrors,
  checkForSuccess,
};
