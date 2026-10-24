'use strict';
/**
 * D-369: скриншоты мобильной страницы «Мои заявки» для презентации.
 *
 * Снимаем на ЛОКАЛЬНОМ стенде (:3001, БД asgard_crm_dev) — не на проде, чтобы
 * не мешать реальным заявкам. Данные тестовые (seed_demo_my_requests.js),
 * ФИО и суммы вымышленные: клиентские данные в презентацию не идут.
 *
 * Профиль iPhone 15 Pro: 393×852, DPR 3, isMobile, hasTouch — как в
 * tools/shot-tabbar.js, где этот профиль уже отработан.
 *
 * Скрипт снимает 7 кадров по плану презентации:
 *   01 список счетов с KPI и этапами
 *   02 пачка файлов в мастере
 *   03 подвкладка «Счёт» (распознанные поля)
 *   04 подвкладка «Условия» (вид расхода, объект, договор)
 *   05 подвкладка «Проверка» (чек-лист и кнопка отправки)
 *   06 шторка статусов с историей
 *   07 вкладка закупок (заглушка)
 *
 * Запуск: node tools/shots_my_requests.js
 * Выход:  tests/reports/_my_requests_shots/*.png
 */
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(process.cwd(), '.env') });

// По умолчанию — локальный стенд :3000 (dev-БД asgard_crm_dev).
// Раньше здесь стояло :3001 (временный порт со съёмки) — после его остановки
// скрипт молча снимал белые кадры, потому что страница не загружалась.
const BASE = process.env.SHOT_BASE || 'http://127.0.0.1:3000';
const SECRET = process.env.JWT_SECRET;
const USER = { id: 3471, login: 'office', role: 'OFFICE_MANAGER', name: 'Тумаева В. А.', pinVerified: true };
const OUT = path.join(process.cwd(), 'tests', 'reports', '_my_requests_shots');

(async () => {
  if (!SECRET) throw new Error('JWT_SECRET не найден в .env');
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const token = jwt.sign(USER, SECRET, { expiresIn: '3h' });

  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    serviceWorkers: 'block',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow'
  });

  await ctx.addInitScript(({ t }) => {
    // init-скрипт выполняется ДО загрузки бандла, поэтому тема и токен успевают
    // встать. Раньше здесь же добавлялся <style> через DOMContentLoaded —
    // в некоторых прогонах обработчик не успевал, и кадры выходили белыми.
    try {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('asgard_theme', 'dark');
      localStorage.setItem('field_auth_epoch', '6');
      localStorage.setItem('asgard_mobile_banner_dismissed_v1', '1');
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.style.colorScheme = 'dark';
    } catch (_) { /* приватный режим */ }
  }, { t: token });

  const page = await ctx.newPage();
  const shot = async (name) => {
    const p = path.join(OUT, name + '.png');
    await page.screenshot({ path: p });
    // Страховка от «белых» кадров: раньше прогон сохранил 7 одинаковых
    // белых картинок по 14 КБ, и это выяснилось только на сборке рамок.
    const info = await page.evaluate(() => ({
      text: document.body.innerText.trim().length,
      bg: getComputedStyle(document.body).backgroundColor
    }));
    const kb = Math.round(fs.statSync(p).size / 1024);
    if (kb < 40 || info.text < 60) {
      console.log(`  ВНИМАНИЕ: кадр ${name} подозрительно пустой (${kb} КБ, текста ${info.text}, фон ${info.bg})`);
    } else {
      console.log(`  снято: ${name}.png (${kb} КБ, текста ${info.text})`);
    }
  };

  const gotoSafe = async (url) => {
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2600);
  };

  // ── 01: список счетов ────────────────────────────────────────────────────
  console.log('[01] список «Мои заявки»');
  await gotoSafe(BASE + '/m/my-requests');
  await page.waitForTimeout(1200);
  await shot('01-my-requests-list');

  // ── 06: шторка деталей с историей (снимаем до мастера) ───────────────────
  console.log('[06] шторка статусов');
  // Открываем второй счёт (у директора) — там есть и submitted_at, и история.
  const cards = page.locator('button.card-glass');
  const cnt = await cards.count();
  console.log('  карточек на экране:', cnt);
  if (cnt > 1) {
    await cards.nth(1).click();
    // Ждём, пока шторка отрисуется целиком. Проверяем по факту: в #modal-root
    // должен быть текст (шапка + поля + история), иначе кадр ловит анимацию.
    const ready = await page.waitForFunction(() => {
      const root = document.getElementById('modal-root');
      return root && root.innerText.trim().length > 200;
    }, { timeout: 12000 }).then(() => true).catch(() => false);
    const sheetText = await page.evaluate(() => {
      const r = document.getElementById('modal-root');
      return r ? r.innerText.trim().length : 0;
    });
    console.log('  шторка готова:', ready, '| символов текста:', sheetText);
    await page.waitForTimeout(1500);
    await shot('06-status-timeline');
    // Закрываем шторку (кнопка «×» в шапке).
    const close = page.locator('[aria-label="Закрыть"], button:has(svg.lucide-x)').first();
    await close.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(900);
  }

  // ── 07: вкладка закупок (заглушка) ───────────────────────────────────────
  console.log('[07] вкладка закупок');
  const purchasesTab = page.getByRole('button', { name: 'Заявки на закупку' });
  await purchasesTab.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await shot('07-purchases-stub');

  // ── 02: мастер загрузки пачки ────────────────────────────────────────────
  console.log('[02] мастер загрузки');
  const invoicesTab = page.getByRole('button', { name: 'Счета на согласование' });
  await invoicesTab.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(700);

  // FAB «+»: открывает мастер.
  const fab = page.locator('button[aria-label="Загрузить счёт"]').first();
  await fab.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);

  // Подкладываем файлы через input[type=file] — иначе мастер пустой.
  const fileInput = page.locator('input[type="file"]').first();
  const demoPdf = path.join(OUT, '_demo-schet.pdf');
  // Минимальный валидный PDF, чтобы загрузка не упала на валидации.
  if (!fs.existsSync(demoPdf)) {
    const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R>>endobj\n' +
      '4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 60 760 Td (Schet 4471) Tj ET\nendstream endobj\n' +
      'trailer<</Root 1 0 R>>\n%%EOF\n';
    fs.writeFileSync(demoPdf, pdf);
  }

  // Подкладываем ДВА файла: на кадре видно «пачку», а не один счёт.
  const demoPdf2 = path.join(OUT, '_demo-schet-2.pdf');
  if (!fs.existsSync(demoPdf2)) fs.copyFileSync(demoPdf, demoPdf2);
  await fileInput.setInputFiles([demoPdf, demoPdf2]).catch(() => {});
  // Ждём, пока цепочка upload → черновик → распознавание отработает.
  await page.waitForTimeout(14000);
  await shot('02-upload-batch');

  // Заполняем поля, чтобы кадры были «как в жизни», а не пустые.
  const fillByLabel = async (labelText, value, role = 'textbox') => {
    const f = page.getByLabel(labelText, { exact: false }).first();
    const ok = await f.fill(value, { timeout: 2500 }).then(() => true).catch(() => false);
    if (!ok) console.log('  поле не найдено:', labelText);
    return ok;
  };

  // ── 03: подвкладка «Счёт» ────────────────────────────────────────────────
  console.log('[03] подвкладка «Счёт»');
  const tabMain = page.getByRole('button', { name: 'Счёт', exact: true }).last();
  await tabMain.click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
  // Контрагент, номер, дата, сумма — на кадре должны быть живые значения.
  await page.locator('input[placeholder*="Ромашка"]').first().fill('ООО «СтройМатериалы Плюс»', { timeout: 2500 }).catch(() => {});
  await page.locator('input[placeholder="№"]').first().fill('СМ-4471', { timeout: 2500 }).catch(() => {});
  const dateInputs = page.locator('input[type="date"]');
  if (await dateInputs.count() > 0) await dateInputs.first().fill('2026-10-21', { timeout: 2500 }).catch(() => {});
  const amountInput = page.locator('input[placeholder*="0,00"]').first();
  await amountInput.fill('248 900,00', { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(500);
  // Ставка 22 % — пересчитает нетто и НДС.
  await page.getByRole('button', { name: '22%', exact: true }).last().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(900);
  await shot('03-invoice-review');

  // ── 04: подвкладка «Условия» ─────────────────────────────────────────────
  console.log('[04] подвкладка «Условия»');
  await page.getByRole('button', { name: 'Условия', exact: true }).last().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
  // Вид расхода «Работы / объект» — чтобы был виден выбор объекта.
  await page.getByRole('button', { name: 'Работы / объект' }).last().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(600);
  const workInput = page.locator('input[placeholder*="объект"], input[placeholder*="Объект"]').first();
  if (await workInput.count() > 0) {
    await workInput.fill('Пасивация маслопровода', { timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(1200);
    // Берём первый вариант из подсказок, если появились.
    const hit = page.locator('button:has-text("Пасивация")').last();
    await hit.click({ timeout: 2500 }).catch(() => {});
  }
  await page.waitForTimeout(800);
  await shot('04-invoice-terms');

  // ── 05: подвкладка «Проверка» ────────────────────────────────────────────
  console.log('[05] подвкладка «Проверка»');
  await page.getByRole('button', { name: 'Проверка', exact: true }).last().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await shot('05-invoice-check');

  await browser.close();
  console.log('готово →', OUT);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
