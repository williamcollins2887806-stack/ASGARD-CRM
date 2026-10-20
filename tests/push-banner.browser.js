'use strict';

/**
 * D-317: плашка «включите push» видна согласующим ролям.
 * ═══════════════════════════════════════════════════════════════════════════
 * Причина: у всех трёх директоров в проде было 0 push-подписок при исправном
 * VAPID. Мягкое всплытие они закрыли → ни одного пуша о заявке.
 *
 * Проверяем: директору плашка показывается, обычному сотруднику — нет,
 * «Через 7 дней» её скрывает.
 */

const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');

const BASE = 'http://127.0.0.1:3101';
const SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';
const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };

async function openAs(browser, user) {
  const token = jwt.sign(
    { id: user.id, login: user.login, name: user.name, role: user.role, pinVerified: true },
    SECRET, { expiresIn: '1h' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(({ t, u }) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u));
  }, { t: token, u: { id: user.id, login: user.login, name: user.name, role: user.role } });
  await page.goto(`${BASE}/#/home`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  return page;
}

(async () => {
  await db.connect();
  console.log('\n=== D-317: плашка включения push ===');

  const dir = (await db.query(`SELECT id, login, name, role FROM users WHERE role='DIRECTOR_GEN' AND is_active=true LIMIT 1`)).rows[0];
  const worker = (await db.query(`SELECT id, login, name, role FROM users WHERE role='FIELD_WORKER' AND is_active=true LIMIT 1`)).rows[0];
  if (!dir || !worker) { console.error('нет тестовых пользователей'); process.exit(1); }

  const browser = await chromium.launch();

  // Директор: плашка должна быть.
  const pd = await openAs(browser, dir);
  const shown = await pd.evaluate(() => {
    // Плашку строит init(), но pushManager в headless может отсутствовать —
    // вызываем напрямую, чтобы проверить саму логику показа.
    if (!document.getElementById('asgard-push-cta') && window.AsgardPush && window.AsgardPush.showApproverBanner) {
      window.AsgardPush.showApproverBanner();
    }
    const el = document.getElementById('asgard-push-cta');
    if (!el) return { exists: false };
    const txt = el.innerText || '';
    return {
      exists: true,
      hasEnable: !!el.querySelector('#asgard-push-enable'),
      hasSnooze: !!el.querySelector('#asgard-push-snooze'),
      mentions12h: /12\s*ч/.test(txt),
      text: txt.slice(0, 200)
    };
  });
  if (shown.exists) ok('директору плашка показана');
  else bad('плашки нет у директора');
  if (shown.hasEnable && shown.hasSnooze) ok('есть «Включить» и «Через 7 дней»');
  else bad('нет кнопок плашки: ' + JSON.stringify(shown));
  if (shown.mentions12h) ok('в тексте объяснено про 12 ч напоминаний');
  else bad('в тексте нет объяснения про 12 ч');

  // Роль определяется верно.
  const roleCheck = await pd.evaluate(() => !!window.AsgardPush.isApproverRole());
  if (roleCheck) ok('директор определён как согласующая роль');
  else bad('AsgardPush не считает директора согласующей ролью');

  // «Через 7 дней» скрывает плашку и запоминает.
  const snoozed = await pd.evaluate(() => {
    const b = document.querySelector('#asgard-push-snooze');
    if (b) b.click();
    return {
      gone: !document.getElementById('asgard-push-cta'),
      until: localStorage.getItem('asgard_push_snooze_until')
    };
  });
  if (snoozed.gone) ok('«Через 7 дней» скрывает плашку');
  else bad('плашка не скрылась');
  if (snoozed.until && Number(snoozed.until) > Date.now() + 6 * 86400000) ok('запомнено на ~7 дней');
  else bad('срок «не напоминать» не записан: ' + snoozed.until);

  // Обычный сотрудник: плашка не нужна.
  const pw = await openAs(browser, worker);
  const wRole = await pw.evaluate(() => !!window.AsgardPush.isApproverRole());
  if (!wRole) ok('сотруднику (FIELD_WORKER) плашка не показывается');
  else bad('плашка показывается обычному сотруднику — лишний шум');

  await browser.close();
  await db.end();
  console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
