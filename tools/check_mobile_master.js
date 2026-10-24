'use strict';
/**
 * D-370: проверка того, что ВИДИТ пользователь в мобильной СРМ.
 *
 * Вопросы заказчика проверяются глазами браузера, а не только по API:
 *   1. предпросмотр загруженного счёта в мастере;
 *   2. подтянулись ли контрагент, сумма, НДС из распознанного счёта;
 *   3. видна ли карточка контрагента со счётчиками («N счетов, M договоров»)
 *      и предупреждение, если договора нет / контрагента нет в базе.
 *
 * Скрипт открывает мастер, подкладывает реальный PDF, ждёт распознавание и
 * снимает кадры + печатает найденные тексты. Работает на локальном стенде.
 */
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(process.cwd(), '.env') });

const BASE = process.env.SHOT_BASE || 'http://127.0.0.1:3000';
const OUT = path.join(process.cwd(), 'tests', 'reports', '_my_requests_shots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const token = jwt.sign({ id: 3474, login: 'n.androsov', role: 'PM', pinVerified: true },
    process.env.JWT_SECRET, { expiresIn: '3h' });

  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 3, serviceWorkers: 'block', locale: 'ru-RU'
  });
  await ctx.addInitScript(({ t }) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('field_auth_epoch', '6');
    localStorage.setItem('asgard_mobile_banner_dismissed_v1', '1');
  }, { t: token });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 160)));

  console.log('=== Открываю «Мои заявки» ===');
  await page.goto(BASE + '/m/my-requests', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3200);

  console.log('=== Открываю мастер загрузки ===');
  await page.locator('button[aria-label="Загрузить счёт"]').first().click();
  await page.waitForTimeout(1200);

  // Реальный счёт: контрагент есть в справочнике, договора нет.
  const dir = 'tests/fixtures/real-invoices';
  const pick = fs.readdirSync(dir).filter((n) => /Радио/i.test(n))[0];
  const pdf = path.join(dir, pick);
  console.log('  файл:', pick);

  await page.locator('input[type="file"]').first().setInputFiles([pdf]);
  console.log('  ждём распознавание…');
  // Распознавание идёт в фоне: ждём, пока в полях появятся значения.
  await page.waitForFunction(() => {
    const inputs = [...document.querySelectorAll('input')];
    const amount = inputs.find((i) => /0,00|₽/.test(i.placeholder || '') || /amount|сумм/i.test(i.name || ''));
    const hasName = inputs.some((i) => /РАДИО|Высот|ООО|ИП/i.test(i.value || ''));
    return hasName || (amount && /\d/.test(amount.value || ''));
  }, { timeout: 90000 }).catch(() => console.log('  (распознавание не завершилось вовремя)'));
  await page.waitForTimeout(3000);

  // Что видно в полях.
  const fields = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('input').forEach((i) => {
      const label = i.closest('div')?.querySelector('label')?.textContent?.trim()
        || i.getAttribute('placeholder') || '';
      if (i.value) out[label || i.type] = i.value;
    });
    return out;
  });
  console.log('  поля в мастере:', JSON.stringify(fields, null, 1).slice(0, 700));

  // Текст шторки — там карточка контрагента и предупреждения.
  const sheet = await page.evaluate(() => {
    const r = document.getElementById('modal-root');
    return r ? r.innerText.replace(/\n{3,}/g, '\n\n') : '';
  });
  console.log('\n=== ТЕКСТ МАСТЕРА (что видит пользователь) ===');
  console.log(sheet.slice(0, 1800));

  console.log('\n=== ПРОВЕРКИ ===');
  const hasSupplier = /РАДИО|Высот/i.test(sheet);
  const hasMoney = /\d[\d\s]{2,}[,.]\d{2}/.test(sheet);
  const hasRegistry = /в реестре|счетов не было/.test(sheet);
  const hasContracts = /договор/i.test(sheet);
  const hasNewWarn = /нет в базе СРМ|создастся автоматически/.test(sheet);
  console.log('  контрагент подтянулся:      ', hasSupplier ? 'ДА' : 'НЕТ');
  console.log('  суммы видны:               ', hasMoney ? 'ДА' : 'НЕТ');
  console.log('  счётчики реестра видны:    ', hasRegistry ? 'ДА' : 'НЕТ');
  console.log('  информация о договорах:    ', hasContracts ? 'ДА' : 'НЕТ');
  console.log('  предупреждение о новой карточке:', hasNewWarn ? 'ДА (уместно)' : 'не показано');

  await page.screenshot({ path: path.join(OUT, '_mobile-master-check.png') });

  // Проверяем превью: кнопка «Открыть скан».
  const previewBtn = page.locator('button[aria-label="Открыть скан"]').first();
  if (await previewBtn.count() > 0) {
    await previewBtn.click();
    await page.waitForTimeout(2500);
    const imgOk = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('#modal-root img')];
      return imgs.some((i) => i.naturalWidth > 200);
    });
    console.log('  превью скана открылось:    ', imgOk ? 'ДА (картинка загрузилась)' : 'НЕТ');
    await page.screenshot({ path: path.join(OUT, '_mobile-preview-check.png') });
  } else {
    console.log('  кнопка превью не найдена');
  }

  await browser.close();
  console.log('\nготово. отладочные кадры в', OUT);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
