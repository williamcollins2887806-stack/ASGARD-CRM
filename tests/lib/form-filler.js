/**
 * Universal form filling engine
 * Detects form fields and fills them with appropriate test data
 */

const { TEST_PREFIX } = require('../config');
const { sleep } = require('./auth');
const { randomInt, randomPhone, futureDate, uid } = require('./data-generator');

/**
 * Detect all fillable fields in the current view (modal/drawer/inline form)
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{type, name, selector, placeholder, label, tagName, inputType}>>}
 */
async function detectFields(page) {
  return await page.evaluate(() => {
    const fields = [];
    const seen = new Set();

    // Find the active form container (modal, drawer, or main content)
    const containers = [
      ...document.querySelectorAll('[class*="modal"]:not([style*="display: none"])'),
      ...document.querySelectorAll('[role="dialog"]'),
      ...document.querySelectorAll('[class*="drawer"]:not([style*="display: none"])'),
    ];
    const container = containers.find(c => {
      const rect = c.getBoundingClientRect();
      return rect.width > 50 && rect.height > 50;
    }) || document.querySelector('main') || document.body;

    // Input fields
    const inputs = container.querySelectorAll('input, textarea, select');
    inputs.forEach((el, idx) => {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
      if (el.disabled || el.readOnly) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 5 || rect.height < 5) return;
      if (window.getComputedStyle(el).display === 'none') return;

      const name = el.name || el.id || '';
      const placeholder = el.placeholder || '';
      const label = el.closest('label')?.textContent?.trim()?.substring(0, 50) || '';
      // Try to find label by "for" attribute
      const labelFor = name ? document.querySelector(`label[for="${name}"]`)?.textContent?.trim()?.substring(0, 50) : '';
      // Try parent label text
      const parentLabel = el.closest('.form-group, .form-field, .inp, [class*="field"]')
        ?.querySelector('label, .label, [class*="label"]')?.textContent?.trim()?.substring(0, 50) || '';

      const key = name || `field_${idx}`;
      if (seen.has(key)) return;
      seen.add(key);

      fields.push({
        type: el.tagName.toLowerCase() === 'select' ? 'select' :
              el.tagName.toLowerCase() === 'textarea' ? 'textarea' :
              el.type || 'text',
        name,
        selector: el.id ? `#${el.id}` :
                  el.name ? `[name="${el.name}"]` :
                  `${el.tagName.toLowerCase()}:nth-of-type(${idx + 1})`,
        placeholder,
        label: label || labelFor || parentLabel || '',
        tagName: el.tagName.toLowerCase(),
        inputType: el.type || '',
        index: idx,
      });
    });

    return fields;
  });
}

/**
 * Determine the best value for a field based on its attributes
 */
function resolveFieldValue(field) {
  const id = uid();
  const nameLC = (field.name + ' ' + field.placeholder + ' ' + field.label).toLowerCase();

  // Skip file inputs
  if (field.type === 'file') return null;

  // Checkbox
  if (field.type === 'checkbox') return 'check';

  // Radio - skip, complex logic
  if (field.type === 'radio') return null;

  // Select
  if (field.type === 'select') return 'first_option';

  // Date fields
  if (field.type === 'date' || nameLC.match(/дат|date|deadline|срок|период/)) {
    return futureDate(30);
  }

  // Number fields
  if (field.type === 'number' || nameLC.match(/сумм|amount|budget|бюджет|цена|price|стоимость|cost|кол|count|qty/)) {
    return String(randomInt(10000, 1000000));
  }

  // Phone
  if (nameLC.match(/телефон|phone|тел\b|mobile|моб/)) {
    return randomPhone();
  }

  // Email
  if (field.type === 'email' || nameLC.match(/email|почта|e-mail/)) {
    return `test_auto_${id}@example.com`;
  }

  // INN
  if (nameLC.match(/инн|inn/)) {
    return String(randomInt(1000000000, 9999999999));
  }

  // Passport
  if (nameLC.match(/паспорт|passport/)) {
    return String(randomInt(100000, 999999));
  }

  // Address
  if (nameLC.match(/адрес|address/)) {
    return `${TEST_PREFIX}Address_${id}`;
  }

  // Textarea
  if (field.type === 'textarea' || field.tagName === 'textarea') {
    return `${TEST_PREFIX}Text_${id}`;
  }

  // Title/Name fields - highest priority text match (use specific prefix for identification)
  if (nameLC.match(/^title$|^name$|^наименование$|^название$/)) {
    return `${TEST_PREFIX}Title_${id}`;
  }

  // Name/title/description fields - use TEST_PREFIX
  if (nameLC.match(/наименов|name|назван|title|фио|фамил|имя|отчеств|описан|descript|коммент|comment|примеч|note|причин|reason|purpose|цел|тема|subject|заголов|header|объект|object/)) {
    return `${TEST_PREFIX}Value_${id}`;
  }

  // Default: text with prefix
  return `${TEST_PREFIX}Field_${id}`;
}

/**
 * Fill a single field
 * @param {import('playwright').Page} page
 * @param {object} field - Field descriptor from detectFields
 * @param {string} value - Value to fill
 * @returns {Promise<boolean>} success
 */
async function fillField(page, field, value) {
  if (!value) return false;

  try {
    if (field.type === 'select' && value === 'first_option') {
      // Select: pick first non-empty option
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const options = el.querySelectorAll('option');
        for (const opt of options) {
          if (opt.value && opt.value !== '' && !opt.disabled) {
            el.value = opt.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }
        }
      }, field.selector);
      return true;
    }

    if (field.type === 'checkbox' && value === 'check') {
      const el = page.locator(field.selector).first();
      if (await el.isVisible({ timeout: 2000 })) {
        const checked = await el.isChecked();
        if (!checked) await el.check();
      }
      return true;
    }

    // For regular text/number/date inputs
    const el = page.locator(field.selector).first();
    if (await el.isVisible({ timeout: 2000 })) {
      await el.click();
      await el.fill('');
      await el.fill(value);
      await el.dispatchEvent('change');
      return true;
    }
  } catch (e) {
    // Field might have become invisible or detached
    return false;
  }

  return false;
}

/**
 * Fill all detected fields in the current form
 * @param {import('playwright').Page} page
 * @returns {Promise<{filled: number, failed: number, fields: Array}>}
 */
async function fillAllFields(page) {
  const fields = await detectFields(page);
  let filled = 0;
  let failed = 0;
  const results = [];

  for (const field of fields) {
    const value = resolveFieldValue(field);
    if (!value) {
      results.push({ ...field, status: 'skipped', value: null });
      continue;
    }

    const success = await fillField(page, field, value);
    if (success) {
      filled++;
      results.push({ ...field, status: 'filled', value });
    } else {
      failed++;
      results.push({ ...field, status: 'failed', value });
    }

    await sleep(200); // Small delay between fields
  }

  return { filled, failed, fields: results };
}

/**
 * Try to submit the form (click Save/Submit/OK button)
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function submitForm(page) {
  // Strategy 1: Playwright locators
  const submitSelectors = [
    'button:has-text("Сохранить")',
    'button:has-text("Создать")',
    'button:has-text("Добавить")',
    'button:has-text("Отправить")',
    'button:has-text("OK")',
    'button:has-text("Ок")',
    'button:has-text("Submit")',
    'button:has-text("Save")',
    'button[type="submit"]',
    'input[type="submit"]',
  ];

  for (const sel of submitSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        await sleep(2000);
        return true;
      }
    } catch {}
  }

  // Strategy 2: DOM evaluation fallback (handles emoji prefixes, icon buttons)
  const clicked = await page.evaluate(() => {
    const patterns = [/сохранить/i, /создать/i, /добавить/i, /отправить/i, /^ok$/i, /^ок$/i, /submit/i, /save/i];
    const candidates = document.querySelectorAll(
      'button, [role="button"], input[type="submit"], a.btn, a[class*="btn"]'
    );

    // Find buttons inside modal/drawer first
    const containers = [
      ...document.querySelectorAll('[class*="modal"]:not([style*="display: none"])'),
      ...document.querySelectorAll('[role="dialog"]'),
      ...document.querySelectorAll('[class*="drawer"]:not([style*="display: none"])'),
    ];
    const activeContainer = containers.find(c => {
      const rect = c.getBoundingClientRect();
      return rect.width > 50 && rect.height > 50;
    });

    const scope = activeContainer || document.querySelector('main') || document.body;
    const btns = scope.querySelectorAll('button, [role="button"], input[type="submit"]');

    for (const btn of btns) {
      const rect = btn.getBoundingClientRect();
      if (rect.width < 5 || rect.height < 5) continue;
      if (window.getComputedStyle(btn).display === 'none') continue;
      const text = (btn.textContent || '').trim();
      for (const p of patterns) {
        if (p.test(text)) {
          btn.click();
          return true;
        }
      }
      // Also check for submit type
      if (btn.type === 'submit') {
        btn.click();
        return true;
      }
    }
    return false;
  });

  if (clicked) {
    await sleep(2000);
    return true;
  }

  return false;
}

module.exports = {
  detectFields,
  resolveFieldValue,
  fillField,
  fillAllFields,
  submitForm,
};
