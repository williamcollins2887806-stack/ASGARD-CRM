'use strict';
/**
 * D-370: проверка ветки «контрагента нет в базе» в мобильном мастере.
 *
 * Заказчик спрашивал: «если он новый — предложит создать карточку?».
 * Здесь проверяем, что при неизвестном контрагенте мастер честно показывает
 * предупреждение, а не молчит.
 *
 * Ввод неизвестного имени делаем через поле, как это сделал бы человек.
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
  await page.goto(BASE + '/m/my-requests', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.locator('button[aria-label="Загрузить счёт"]').first().click();
  await page.waitForTimeout(1000);

  const dir = 'tests/fixtures/real-invoices';
  const pick = fs.readdirSync(dir).filter((n) => /Радио/i.test(n))[0];
  await page.locator('input[type="file"]').first().setInputFiles([path.join(dir, pick)]);
  await page.waitForFunction(() => {
    return [...document.querySelectorAll('input')].some((i) => /РАДИО|ООО|ИП/i.test(i.value || ''));
  }, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // Ветка 1: известный контрагент — должна быть карточка со счётчиками.
  let text = await page.evaluate(() => document.getElementById('modal-root')?.innerText || '');
  const known = /в реестре|счетов не было/.test(text) && /договор/i.test(text);
  console.log('A. известный контрагент: карточка со счётчиками —', known ? 'ЕСТЬ' : 'НЕТ');
  await page.screenshot({ path: path.join(OUT, '_branch-known-supplier.png') });

  // Ветка 2: вводим имя, которого нет в базе.
  const nameInput = page.locator('input[placeholder*="Ромашка"]').first();
  await nameInput.fill('ООО «Совсем Новый Поставщик Тест»');
  await page.waitForTimeout(2500);
  text = await page.evaluate(() => document.getElementById('modal-root')?.innerText || '');
  const newWarn = /нет в базе СРМ|создастся автоматически/.test(text);
  console.log('B. новый контрагент: предложение создать карточку —', newWarn ? 'ЕСТЬ' : 'НЕТ');
  const snippet = (text.match(/Контрагента нет[^\n]*|Контрагента нет[\s\S]{0,160}/) || [''])[0];
  if (snippet) console.log('   текст:', snippet.replace(/\n+/g, ' ').slice(0, 200));
  await page.screenshot({ path: path.join(OUT, '_branch-new-supplier.png') });

  // Ветка 3: у контрагента есть договор (проверяем на известном с договором).
  console.log('\nПроверка ветки «есть договор» — через API:');
  const api = await fetch(BASE + '/api/customers/registry-suggest?q=' + encodeURIComponent('7736244785') + '&limit=2',
    { headers: { Authorization: 'Bearer ' + token } });
  const j = await api.json().catch(() => ({}));
  console.log('  АСГАРД (свой ИНН):', JSON.stringify((j.suppliers || [])[0] || 'не найден'));

  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
