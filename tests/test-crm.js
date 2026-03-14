const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://asgard-crm.ru';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const REPORT = [];

// Collect JS console errors per page
let consoleErrors = [];
let networkErrors = [];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function setupErrorListeners(page) {
  consoleErrors = [];
  networkErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('response', response => {
    if (response.status() >= 500) {
      networkErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  page.on('pageerror', error => {
    consoleErrors.push(`PAGE_ERROR: ${error.message}`);
  });
}

function resetErrors() {
  consoleErrors = [];
  networkErrors = [];
}

function addReport(pageName, element, status, description = '') {
  REPORT.push({ pageName, element, status, description });
}

async function takeErrorScreenshot(page, name) {
  const safeName = name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, '_').substring(0, 80);
  const filePath = path.join(SCREENSHOT_DIR, `${safeName}_${Date.now()}.png`);
  try {
    await page.screenshot({ path: filePath, fullPage: false });
    return filePath;
  } catch (e) {
    return null;
  }
}

async function login(page) {
  console.log('=== Авторизация ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);

  // Screenshot login page
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '00_login_page.png') });

  // Step 1: Click "Войти" button to reveal the login form
  const enterBtn = page.locator('#btnShowLogin');
  await enterBtn.click();
  await sleep(2000);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '00a_after_enter_click.png') });

  // Step 2: Fill login - wait for field to become visible
  const loginInput = page.locator('input[name="login"], input[placeholder*="огин"], input[id*="login"]').first();
  await loginInput.waitFor({ state: 'visible', timeout: 10000 });
  await loginInput.fill('admin');

  // Fill password
  const passInput = page.locator('input[type="password"]').first();
  await passInput.waitFor({ state: 'visible', timeout: 5000 });
  await passInput.fill('admin123');

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '00b_credentials_filled.png') });

  // Click "Далее" submit button
  const submitBtn = page.getByText('Далее', { exact: true });
  await submitBtn.click();
  await sleep(3000);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_after_login.png') });

  // Step 3: Handle PIN code
  await sleep(2000);

  // Debug: dump all visible inputs
  const allVisibleInputs = page.locator('input:visible');
  const visCount = await allVisibleInputs.count();
  console.log(`Visible inputs on PIN page: ${visCount}`);
  for (let i = 0; i < visCount; i++) {
    const inp = allVisibleInputs.nth(i);
    const attrs = await inp.evaluate(el => ({
      id: el.id, name: el.name, type: el.type, class: el.className,
      placeholder: el.placeholder, maxlength: el.maxLength, value: el.value
    }));
    console.log(`  Input ${i}:`, JSON.stringify(attrs));
  }

  // Find the PIN input - look for id containing "pin" or a visible password-type input
  const pinField = page.locator('input:visible').first();
  await pinField.click();
  await pinField.fill('');
  // Type digit by digit to ensure the input registers them
  await page.keyboard.type('1234', { delay: 100 });
  await sleep(500);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01a_pin_filled.png') });

  // Debug: dump all visible buttons
  const allVisibleButtons = page.locator('button:visible');
  const btnCount = await allVisibleButtons.count();
  console.log(`Visible buttons on PIN page: ${btnCount}`);
  for (let i = 0; i < btnCount; i++) {
    const btn = allVisibleButtons.nth(i);
    const btnText = (await btn.textContent().catch(() => '')).trim();
    const btnId = await btn.getAttribute('id').catch(() => '');
    console.log(`  Button ${i}: "${btnText}" id="${btnId}"`);
  }

  // Click the visible "Войти" button (not the hidden #btnShowLogin)
  const visibleVoitiBtn = page.locator('button:visible:has-text("Войти")');
  const voitiCount = await visibleVoitiBtn.count();
  console.log(`Visible "Войти" buttons: ${voitiCount}`);
  if (voitiCount > 0) {
    await visibleVoitiBtn.first().click();
  } else {
    await page.keyboard.press('Enter');
  }
  await sleep(5000);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_after_pin.png') });
  console.log('Авторизация завершена, текущий URL:', page.url());
}

async function getMenuItems(page) {
  console.log('=== Сбор пунктов бокового меню ===');
  await sleep(2000);

  // Take a screenshot of the sidebar
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_sidebar.png') });

  // Use JavaScript to extract the full sidebar menu structure
  const menuData = await page.evaluate(() => {
    // Find the sidebar/aside element
    const aside = document.querySelector('aside') || document.querySelector('[class*="sidebar"]') || document.querySelector('nav');
    if (!aside) return { error: 'No sidebar found', html: document.body.innerHTML.substring(0, 2000) };

    // Get all link-like elements in the sidebar
    const allLinks = aside.querySelectorAll('a[href]');
    const items = [];
    const seen = new Set();

    allLinks.forEach(a => {
      const href = a.getAttribute('href');
      if (!href || href === '#' || href === '#/welcome' || seen.has(href)) return;
      seen.add(href);

      const text = a.textContent.trim().replace(/\s+/g, ' ').substring(0, 60);
      const parentLi = a.closest('li');
      const isSubItem = parentLi ? parentLi.closest('ul')?.closest('li') !== null : false;

      items.push({ text, href, isSubItem });
    });

    // Also find expandable menu groups (sections that can be opened)
    const groups = aside.querySelectorAll('[class*="group"], [class*="section"], [class*="submenu"], details, [class*="collapse"]');
    const groupTexts = Array.from(groups).map(g => g.textContent.trim().substring(0, 40));

    return { items, groupTexts, totalLinks: allLinks.length };
  });

  console.log('Menu data:', JSON.stringify(menuData, null, 2));

  if (menuData.error) {
    console.log('Sidebar error:', menuData.error);
    return [];
  }

  // Now we need to expand all collapsed menu groups
  // Click each top-level nav group to expand it
  const navGroups = page.locator('aside [class*="group-title"], aside [class*="toggle"], aside summary, aside [class*="nav-section"] > span, aside [class*="nav-section"] > div:first-child');
  const groupCount = await navGroups.count().catch(() => 0);
  console.log(`Expandable groups found: ${groupCount}`);

  // Also try clicking menu items with expand arrows
  const expandBtns = page.locator('aside [class*="arrow"], aside [class*="expand"], aside [class*="chevron"], aside .nav-toggle');
  const expandCount = await expandBtns.count().catch(() => 0);
  console.log(`Expand buttons found: ${expandCount}`);

  // Click each expand button
  for (let i = 0; i < expandCount; i++) {
    try {
      await expandBtns.nth(i).click({ timeout: 2000 });
      await sleep(300);
    } catch (e) {}
  }

  await sleep(1000);

  // Re-collect all links after expanding
  const allMenuLinks = await page.evaluate(() => {
    const aside = document.querySelector('aside') || document.querySelector('[class*="sidebar"]') || document.querySelector('nav');
    if (!aside) return [];

    const allLinks = aside.querySelectorAll('a[href]');
    const items = [];
    const seen = new Set();

    allLinks.forEach(a => {
      const href = a.getAttribute('href');
      if (!href || href === '#/welcome' || seen.has(href)) return;
      seen.add(href);

      // Get direct text, not children's text
      let text = '';
      // Try span with text inside
      const span = a.querySelector('span:not([class*="badge"]):not([class*="count"])');
      if (span) {
        text = span.textContent.trim();
      }
      if (!text) {
        text = a.textContent.trim().replace(/\s+/g, ' ').substring(0, 60);
      }

      // Check visibility
      const rect = a.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0;

      if (text && text !== '#') {
        items.push({ text, href, isVisible });
      }
    });

    return items;
  });

  console.log(`\nВсего пунктов меню после раскрытия: ${allMenuLinks.length}`);
  allMenuLinks.forEach((item, idx) => {
    console.log(`  ${idx + 1}. ${item.isVisible ? '👁' : '👁‍🗨'} "${item.text}" -> ${item.href}`);
  });

  // Filter: only return items with hash routes (SPA navigation)
  const filtered = allMenuLinks.filter(item => item.href && item.href.startsWith('#/'));
  console.log(`Фильтрованные (SPA routes): ${filtered.length}`);

  return filtered;
}

async function findClickableElements(page) {
  // Find all buttons and clickable elements on the page
  const clickableSelectors = [
    'button:visible',
    'a:visible',
    '[role="button"]:visible',
    'input[type="submit"]:visible',
    'input[type="button"]:visible',
    '[onclick]:visible',
    '[class*="btn"]:visible',
  ];

  const elements = [];
  const seenTexts = new Set();

  for (const selector of clickableSelectors) {
    const items = page.locator(selector);
    const count = await items.count().catch(() => 0);

    for (let i = 0; i < count; i++) {
      try {
        const item = items.nth(i);
        const isVisible = await item.isVisible().catch(() => false);
        if (!isVisible) continue;

        const text = (await item.textContent().catch(() => '')).trim().substring(0, 50);
        const tag = await item.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
        const type = await item.getAttribute('type').catch(() => null);
        const href = await item.getAttribute('href').catch(() => null);
        const ariaLabel = await item.getAttribute('aria-label').catch(() => null);

        // Skip menu items (we navigate them separately) and tiny/hidden elements
        const box = await item.boundingBox().catch(() => null);
        if (!box || box.width < 5 || box.height < 5) continue;

        const displayText = text || ariaLabel || `[${tag}${type ? ':' + type : ''}]`;

        // Skip duplicates and navigation links
        if (seenTexts.has(displayText)) continue;
        // Skip sidebar menu links
        if (tag === 'a' && href && href.startsWith('#/')) continue;
        if (tag === 'a' && href && href.startsWith('/') && !href.includes('#')) continue;
        // Skip sidebar elements (inside aside)
        const isInSidebar = await item.evaluate(el => !!el.closest('aside')).catch(() => false);
        if (isInSidebar) continue;

        seenTexts.add(displayText);
        elements.push({
          text: displayText,
          tag,
          type,
          href,
          selector,
          index: i,
          locator: item,
        });
      } catch (e) {
        // skip
      }
    }
  }

  return elements;
}

async function testPage(page, pageName, url) {
  console.log(`\n--- Тестирование страницы: "${pageName}" (${url}) ---`);
  resetErrors();

  try {
    // Navigate to the page (SPA with hash routing)
    if (url && url !== '#' && url !== 'javascript:void(0)') {
      if (url.startsWith('#/')) {
        // Hash-based SPA routing - use evaluate to change location
        await page.evaluate((hash) => { window.location.hash = hash.substring(1); }, url);
      } else {
        const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      }
    }
    await sleep(3000);

    // Check page loaded
    const title = await page.title();
    const currentUrl = page.url();
    console.log(`  URL: ${currentUrl}, Title: "${title}"`);

    // Check for 500 errors
    if (networkErrors.length > 0) {
      const errDesc = networkErrors.join('; ');
      addReport(pageName, 'PAGE_LOAD', 'ОШИБКА', `Серверные ошибки: ${errDesc}`);
      await takeErrorScreenshot(page, `${pageName}_500_error`);
    }

    // Check for JS errors
    if (consoleErrors.length > 0) {
      const errDesc = consoleErrors.slice(0, 5).join('; ');
      addReport(pageName, 'JS_CONSOLE', 'ОШИБКА', `JS ошибки: ${errDesc}`);
      await takeErrorScreenshot(page, `${pageName}_js_error`);
    }

    if (networkErrors.length === 0 && consoleErrors.length === 0) {
      addReport(pageName, 'PAGE_LOAD', 'OK', 'Страница загрузилась без ошибок');
    }

    // Find clickable elements
    const clickables = await findClickableElements(page);
    console.log(`  Найдено кликабельных элементов: ${clickables.length}`);

    // Limit to first 15 buttons per page to avoid infinite loops
    const toTest = clickables.slice(0, 15);

    for (const elem of toTest) {
      resetErrors();
      const beforeUrl = page.url();

      try {
        // Check if element is still visible and attached
        const isVisible = await elem.locator.isVisible().catch(() => false);
        if (!isVisible) {
          addReport(pageName, elem.text, 'ПРОПУЩЕН', 'Элемент не виден');
          continue;
        }

        // Click with short timeout
        await elem.locator.click({ timeout: 5000 });
        await sleep(1500);

        const afterUrl = page.url();

        // Check for new errors after click
        const hasJsError = consoleErrors.length > 0;
        const hasNetworkError = networkErrors.length > 0;

        // Check if modal appeared
        const modalVisible = await page.locator('.modal:visible, [class*="modal"]:visible, [class*="Modal"]:visible, [role="dialog"]:visible, .ant-modal:visible, .el-dialog:visible, .popup:visible, [class*="popup"]:visible, [class*="Popup"]:visible, [class*="dialog"]:visible, [class*="Dialog"]:visible').first().isVisible().catch(() => false);

        let status = 'OK';
        let description = '';

        if (hasJsError || hasNetworkError) {
          status = 'ОШИБКА';
          description = [];
          if (hasJsError) description.push(`JS: ${consoleErrors[0]}`);
          if (hasNetworkError) description.push(`HTTP: ${networkErrors[0]}`);
          description = description.join('; ');
          await takeErrorScreenshot(page, `${pageName}_${elem.text}_click_error`);
        } else if (afterUrl !== beforeUrl) {
          description = `Переход: ${afterUrl}`;
        } else if (modalVisible) {
          description = 'Модальное окно открылось';
          // Close modal
          const closeBtn = page.locator('.modal .close, [class*="modal"] .close, [aria-label="Close"], button:has-text("Закрыть"), button:has-text("Отмена"), button:has-text("×"), .ant-modal-close, .el-dialog__close').first();
          const closeBtnVisible = await closeBtn.isVisible().catch(() => false);
          if (closeBtnVisible) {
            await closeBtn.click().catch(() => {});
            await sleep(500);
          } else {
            await page.keyboard.press('Escape');
            await sleep(500);
          }
        } else {
          description = 'Клик выполнен, видимых изменений нет';
        }

        addReport(pageName, elem.text, status, description);

        // Navigate back if URL changed
        if (afterUrl !== beforeUrl) {
          if (url.startsWith('#/')) {
            await page.evaluate((hash) => { window.location.hash = hash.substring(1); }, url);
          } else {
            await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(async () => {
              const navUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
              await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
            });
          }
          await sleep(2000);
        }

      } catch (e) {
        const errMsg = e.message.substring(0, 150);
        addReport(pageName, elem.text, 'ОШИБКА', `Exception: ${errMsg}`);
        await takeErrorScreenshot(page, `${pageName}_${elem.text}_exception`);

        // Try to recover - navigate back to the page
        try {
          if (url.startsWith('#/')) {
            await page.evaluate((hash) => { window.location.hash = hash.substring(1); }, url);
          } else {
            const navUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
            await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
          }
          await sleep(2000);
        } catch (e2) {
          // Can't recover, continue
        }
      }
    }

  } catch (e) {
    addReport(pageName, 'PAGE_NAVIGATION', 'ОШИБКА', `Не удалось загрузить страницу: ${e.message.substring(0, 200)}`);
    await takeErrorScreenshot(page, `${pageName}_navigation_error`);
  }
}

async function main() {
  console.log('Запуск тестирования ASGARD CRM...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();
  setupErrorListeners(page);

  try {
    // Step 1: Login
    await login(page);

    // Step 2: Get menu items
    const menuItems = await getMenuItems(page);

    if (menuItems.length === 0) {
      console.log('\nМеню не найдено. Попробуем найти через body...');
      // Take a screenshot to see current state
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_no_menu_debug.png') });

      // Get all links on the page
      const allLinks = page.locator('a[href]');
      const linkCount = await allLinks.count();
      console.log(`Всего ссылок на странице: ${linkCount}`);
      for (let i = 0; i < Math.min(linkCount, 30); i++) {
        const text = (await allLinks.nth(i).textContent().catch(() => '')).trim();
        const href = await allLinks.nth(i).getAttribute('href').catch(() => '');
        console.log(`  ${i}: "${text}" -> ${href}`);
      }

      // Try to get page HTML structure
      const bodyClasses = await page.evaluate(() => {
        const sidebar = document.querySelector('[class*="sidebar"], [class*="Sidebar"], [class*="menu"], [class*="Menu"], nav, aside');
        if (sidebar) return { found: true, tag: sidebar.tagName, classes: sidebar.className, html: sidebar.innerHTML.substring(0, 2000) };
        return { found: false, bodyClasses: document.body.className, bodyHTML: document.body.innerHTML.substring(0, 3000) };
      });
      console.log('Body/sidebar info:', JSON.stringify(bodyClasses, null, 2));
    }

    // Step 3: Test each page
    for (const item of menuItems) {
      const url = item.href || '#';
      await testPage(page, item.text || `Unnamed(${url})`, url);
    }

  } catch (e) {
    console.error('Fatal error:', e);
  } finally {
    await browser.close();
  }

  // Generate report
  console.log('\n\n========================================');
  console.log('        ИТОГОВЫЙ ОТЧЁТ');
  console.log('========================================\n');

  let currentPage = '';
  let okCount = 0;
  let errorCount = 0;
  let skipCount = 0;

  for (const r of REPORT) {
    if (r.pageName !== currentPage) {
      currentPage = r.pageName;
      console.log(`\n📄 Страница: ${currentPage}`);
      console.log('─'.repeat(60));
    }

    const icon = r.status === 'OK' ? '✅' : r.status === 'ОШИБКА' ? '❌' : '⏭️';
    console.log(`  ${icon} [${r.element}] → ${r.status}${r.description ? ': ' + r.description : ''}`);

    if (r.status === 'OK') okCount++;
    else if (r.status === 'ОШИБКА') errorCount++;
    else skipCount++;
  }

  console.log('\n========================================');
  console.log(`  ИТОГО: ✅ OK: ${okCount} | ❌ Ошибок: ${errorCount} | ⏭️ Пропущено: ${skipCount}`);
  console.log('========================================');

  // Save report to file
  const reportText = REPORT.map(r => `${r.pageName}\t${r.element}\t${r.status}\t${r.description}`).join('\n');
  fs.writeFileSync(path.join(__dirname, 'report.tsv'), `Страница\tЭлемент\tСтатус\tОписание\n${reportText}`);
  console.log('\nОтчёт сохранён в report.tsv');

  // Save JSON report
  fs.writeFileSync(path.join(__dirname, 'report.json'), JSON.stringify(REPORT, null, 2));
  console.log('JSON отчёт сохранён в report.json');
}

main().catch(console.error);
