#!/usr/bin/env node
'use strict';

/**
 * Мок-модель → черновик → реальный PDF (pdfkit) → lintPdfBuffer.
 * Без RouterAI. Доказывает: чистый ответ модели даёт чистый PDF;
 * грязный ответ не протаскивает утечку в байт-стрим.
 *
 * Запуск:
 *   $env:DB_PASSWORD='123456789'; $env:DB_NAME='asgard_crm_test'; node tests/tkp-ai-mock-pdf.test.js
 */

if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = '123456789';
if (!process.env.DB_NAME) process.env.DB_NAME = 'asgard_crm_test';

const assert = require('assert');
const path = require('path');
const PDFDocument = require('pdfkit');
const db = require('../src/services/db');
const aiProvider = require('../src/services/ai-provider');
const svc = require('../src/services/tkp-ai-draft');
const lint = require('../src/services/client-doc-lint');

function withMock(text) {
  const orig = aiProvider.complete;
  aiProvider.complete = async () => ({ text, model: 'mock-pdf' });
  return () => { aiProvider.complete = orig; };
}

function renderDraftPdf(draft, pricing) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const font = path.join(process.cwd(), 'public', 'assets', 'fonts', 'DejaVuSans.ttf');
    if (require('fs').existsSync(font)) doc.font(font);

    const fmt = (n) => Number(n).toLocaleString('ru-RU', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    const items = (draft.items && draft.items.items) || [];
    const vatPct = (draft.items && draft.items.vat_pct) || pricing.vat_pct;
    const sub = (draft.items && draft.items.subtotal) || pricing.price_no_vat;
    const vat = (draft.items && draft.items.vat_sum) || (pricing.price_with_vat - pricing.price_no_vat);
    const tot = (draft.items && draft.items.total_with_vat) || pricing.price_with_vat;

    doc.fontSize(14).text('ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ');
    doc.moveDown(0.5);
    doc.fontSize(11).text('Предмет: ' + (draft.subject || ''));
    doc.text(String(draft.work_description || ''));
    doc.moveDown(0.5);
    if (Array.isArray(draft.scope_included)) {
      draft.scope_included.forEach((s) => doc.text('— ' + s));
    }
    doc.moveDown(0.5);
    items.forEach((it) => {
      doc.text(it.name + ' — ' + fmt(it.total) + ' руб.');
    });
    doc.moveDown(0.5);
    doc.text('Итого без НДС: ' + fmt(sub) + ' руб.');
    doc.text('НДС ' + vatPct + '%: ' + fmt(vat) + ' руб.');
    doc.text('ИТОГО: ' + fmt(tot) + ' руб.');
    if (draft.payment_terms) doc.text(String(draft.payment_terms));
    if (draft.warranty_text) doc.text(String(draft.warranty_text));
    doc.end();
  });
}

async function main() {
  const tender = (await db.query(`
    SELECT t.id FROM tenders t
    JOIN tender_rp_reviews rv ON rv.tender_id = t.id
   WHERE rv.is_final AND rv.decision = 'submit'
     AND COALESCE(rv.work_price,0) > 0
     AND t.tender_title ~ '[А-Яа-яЁё]'
     AND t.tender_title !~ '[0-9]{7,}'
   ORDER BY t.id DESC LIMIT 1
  `)).rows[0];
  if (!tender) throw new Error('нет тендера');

  await db.query('DELETE FROM mimir_ai_cache WHERE agent_name = $1', [svc.CONST.CACHE_AGENT]).catch(() => {});

  const clean = {
    subject: 'Химическая очистка теплообменного оборудования',
    work_description: 'Выполняем химическую очистку теплообменного оборудования на объекте заказчика согласно техническому заданию.',
    deadline_text: 'Срок выполнения — 15 рабочих дней с даты подписания договора.',
    payment_terms_text: 'Аванс 30% в течение 5 банковских дней с даты подписания договора, остаток — после акта.',
    warranty_text: '12 месяцев с даты подписания акта выполненных работ.',
    services: 'Химическая очистка и промывка контуров.',
    scope_included: ['Химическая очистка теплообменников', 'Промывка линий'],
    scope_excluded: ['Ремонт оборудования, вышедшего из строя до начала работ.'],
    item_names: ['Химическая очистка теплообменного оборудования']
  };

  let passed = 0;
  let failed = 0;

  async function check(name, fn) {
    try {
      await fn();
      passed += 1;
      console.log('PASS', name);
    } catch (e) {
      failed += 1;
      console.log('FAIL', name, '—', e.message);
    }
  }

  await check('мок-чистый → PDF без хитов линтера', async () => {
    await db.query('DELETE FROM mimir_ai_cache WHERE agent_name = $1', [svc.CONST.CACHE_AGENT]);
    const restore = withMock(JSON.stringify(clean));
    try {
      const res = await svc.buildAiDraft({ tenderId: tender.id, variant: 'classic', user: { id: 1, name: 'П' } });
      const buf = await renderDraftPdf(res.draft, res.pricing);
      const gate = await svc.assertPdfClean(buf, {
        expectedNumbers: [res.pricing.price_no_vat, res.pricing.price_with_vat],
        allowedNumbers: [res.pricing.price_no_vat, res.pricing.price_with_vat, res.pricing.vat_pct,
          Math.round((res.pricing.price_with_vat - res.pricing.price_no_vat) * 100) / 100],
        forbiddenNumbers: (res.draft.items.meta && res.draft.items.meta.internal_amounts) || []
      });
      assert.strictEqual(gate.ok, true, JSON.stringify(gate.hits));
      assert.ok(gate.hits.length === 0 || !gate.hits.some((h) => h.severity === 'block'),
        JSON.stringify(gate.hits));
    } finally { restore(); }
  });

  await check('мок-грязный → поля вычищены, PDF всё равно чистый', async () => {
    await db.query('DELETE FROM mimir_ai_cache WHERE agent_name = $1', [svc.CONST.CACHE_AGENT]);
    const dirty = Object.assign({}, clean, {
      subject: 'Таким образом предлагаем комплексный подход',
      work_description: 'Себестоимость 123456, маржа и ФОТ бригады учтены. Наценка 2.2.',
      scope_included: ['Работы', 'Пайковые и проживание']
    });
    const restore = withMock(JSON.stringify(dirty));
    try {
      const res = await svc.buildAiDraft({ tenderId: tender.id, variant: 'classic', user: { id: 1, name: 'П' } });
      const blob = [res.draft.subject, res.draft.work_description, ...(res.draft.scope_included || [])].join('\n');
      assert.ok(!/себестоим|марж|ФОТ|пайков|таким образом|комплексный подход/i.test(blob), blob);
      const buf = await renderDraftPdf(res.draft, res.pricing);
      const gate = await svc.assertPdfClean(buf, {
        expectedNumbers: [res.pricing.price_no_vat, res.pricing.price_with_vat],
        allowedNumbers: [res.pricing.price_no_vat, res.pricing.price_with_vat, res.pricing.vat_pct],
        forbiddenNumbers: (res.draft.items.meta && res.draft.items.meta.internal_amounts) || []
      });
      assert.strictEqual(gate.ok, true, JSON.stringify(gate.hits));
    } finally { restore(); }
  });

  console.log('Итого: PASS', passed, '/ FAIL', failed);
  try { await db.end(); } catch (_) {}
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
