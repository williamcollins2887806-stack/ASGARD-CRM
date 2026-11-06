const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * prod-mode-check.spec.js — режим карточки анализа на ПРОДЕ.
 *
 * Открываем модалку тем же путём, что и интерфейс: берём строку из очереди
 * дежурного (/api/pm-duty/queue) и передаём её в AsgardRpReviewModal.open.
 * Строка очереди содержит phase — именно от неё зависит режим.
 */
const PROD = process.env.PROD_URL || 'https://asgard-crm.ru';
const TOKEN = process.env.PROD_TOKEN || '';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-prod');

test('прод: карточка анализа открывается в режиме анализа', async ({ page }) => {
  test.skip(!TOKEN, 'нужен PROD_TOKEN');

  await page.goto(`${PROD}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('token', t);
  }, TOKEN);
  await page.goto(`${PROD}/#/pm-calculations`, { waitUntil: 'commit' });
  await page.waitForTimeout(3500);

  const queue = await page.evaluate(async () => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const r = await fetch('/api/pm-duty/queue?tab=analysis', { headers: { Authorization: auth } });
    const d = await r.json().catch(() => ({}));
    const items = d.items || d.rows || [];
    return {
      status: r.status,
      count: items.length,
      sample: items.slice(0, 3).map((x) => ({
        id: x.id, phase: x.phase,
        analysis_finalized_at: x.analysis_finalized_at || null,
        is_final: x.is_final, can_report: x.can_report
      }))
    };
  });
  console.log('ОЧЕРЕДЬ:', JSON.stringify(queue));

  test.skip(!queue.count, 'очередь пуста');

  const opened = await page.evaluate(async (id) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const r = await fetch(`/api/tenders/${id}/rp-review`, { headers: { Authorization: auth } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { status: r.status, error: d.error };
    const row = d.tender || { id };
    const analysisClosed = !!(row.analysis_finalized_at || (d.review && d.review.analysis_finalized_at));
    const mode = analysisClosed ? 'calc' : 'analysis';
    if (mode === 'calc' && window.AsgardRpCalcModal) {
      window.AsgardRpCalcModal.open(row, [], function () {}, { mode });
    } else if (window.AsgardRpReviewModal) {
      window.AsgardRpReviewModal.open(row, [], function () {}, { mode });
    }
    await new Promise((r2) => setTimeout(r2, 2200));
    const btns = Array.from(document.querySelectorAll('button'));
    const mimir = btns.find((b) => /Анализ Мимир|Просчёт Мимир/.test(b.textContent || ''));
    const badge = document.querySelector('.rp-review-badge.mode-analysis, .rp-review-badge.mode-calc');
    return {
      status: r.status,
      mode,
      buttonText: mimir ? mimir.textContent.trim() : '(кнопки Мимира нет)',
      modeBadge: badge ? badge.textContent.trim() : '(нет бейджа)',
      tabs: Array.from(document.querySelectorAll('.rp-review-tab')).map((t) => t.textContent.trim())
    };
  }, queue.sample[0].id);

  console.log('КАРТОЧКА:', JSON.stringify(opened));
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, '32-mode.png'), fullPage: false });

  expect(opened.mode).toBe('analysis');
  expect(opened.buttonText, 'кнопка Мимира в анализе').toContain('Анализ');
});
