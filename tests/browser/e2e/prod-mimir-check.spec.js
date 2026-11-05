const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * prod-mimir-check.spec.js — проверка этапов на ПРОДЕ от лица РП Андросова.
 * Токен выдаётся сервером (tools/_prod-token.js) и передаётся через PROD_TOKEN.
 * Только чтение: открываем модалку на реальной сессии и снимаем экраны.
 */
const PROD = process.env.PROD_URL || 'https://asgard-crm.ru';
const TOKEN = process.env.PROD_TOKEN || '';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-prod');

async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

test.describe('Прод: этапы Мимира', () => {
  test.setTimeout(180000);

  test('реальная сессия РП: этап, объёмы, звонок', async ({ page }) => {
    test.skip(!TOKEN, 'PROD_TOKEN не задан');

    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${PROD}/#/welcome`, { waitUntil: 'commit' });
    await page.evaluate((t) => {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('token', t);
    }, TOKEN);
    await page.goto(`${PROD}/#/pm-calculations`, { waitUntil: 'commit' });
    await page.waitForTimeout(3500);
    await shot(page, '00-page');

    const sessions = await page.evaluate(async () => {
      const r = await fetch('/api/tkp-quick/sessions', {
        headers: { Authorization: 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      const d = await r.json().catch(() => ({}));
      const list = (d.sessions || []).map((s) => ({
        uid: s.session_uid, name: s.customer_name, status: s.status
      }));
      // Проверяем именно АНАЛИЗ: берём сессию, где в рельсе ещё нет сметы.
      const details = [];
      for (const s of list.slice(0, 10)) {
        const sr = await fetch(`/api/tkp-quick/sessions/${s.uid}/stage`, {
          headers: { Authorization: 'Bearer ' + localStorage.getItem('asgard_token') }
        });
        const sd = await sr.json().catch(() => ({}));
        details.push({ ...s, stage: sd.stage, positions: (sd.state?.positions || []).length });
      }
      return { status: r.status, list: details };
    });
    console.log('СЕССИИ:', sessions.status, JSON.stringify(sessions.list.slice(0, 6)));
    expect(sessions.list.length, 'у РП есть сессии анализа').toBeGreaterThan(0);

    // Приоритет: сессия анализа с объёмами (её и видит дежурный РП).
    const analysisStages = ['intake', 'read', 'clarify', 'dv', 'tech', 'decision', 'done', 'nogo'];
    const target = sessions.list.find((s) => s.stage === 'dv' && s.positions > 0)
      || sessions.list.find((s) => analysisStages.includes(s.stage) && s.positions > 0)
      || sessions.list.find((s) => analysisStages.includes(s.stage))
      || sessions.list[0];
    console.log('ВЫБРАНА СЕССИЯ:', JSON.stringify(target));
    const uid = target.uid;
    await page.evaluate((u) => {
      if (window.AsgardMimirStages) {
        window.AsgardMimirStages.open({
          sessionUid: u, title: 'Анализ тендера · дежурный РП', subtitle: 'Проверка на проде'
        });
      }
    }, uid);
    await page.waitForSelector('.mst-modal', { timeout: 20000 });
    await page.waitForTimeout(1800);
    await shot(page, '01-prod-stage');

    const stage = await page.locator('.mst-step.is-now').innerText().catch(() => '—');
    const text = await page.locator('.mst-main').innerText();
    console.log('ЭТАП:', stage);
    console.log('ТЕКСТ:\n' + text.slice(0, 700));

    expect(text.length).toBeGreaterThan(40);
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');

    // Рельс на этапе анализа не должен содержать смету.
    // (На просчёте смета — нормальный этап, поэтому проверяем только анализ.)
    const rail = await page.locator('.mst-rail').innerText().catch(() => '');
    if (analysisStages.includes(target.stage)) {
      expect(rail).not.toContain('Смета');
      expect(rail).not.toContain('Люди и сроки');
    }

    const real = errors.filter((e) => !/Failed to load resource|401|403/i.test(e));
    expect(real, 'ошибки: ' + real.join(' | ')).toHaveLength(0);
  });
});
