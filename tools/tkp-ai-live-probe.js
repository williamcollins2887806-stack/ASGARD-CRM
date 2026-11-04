#!/usr/bin/env node
'use strict';

/**
 * Живой прогон ТКП через ИИ (RouterAI) на 2–3 реальных тендерах.
 * Ничего не пишет в tkp/documents — только buildAiDraft + линт.
 *
 * Запуск:
 *   $env:DB_PASSWORD='123456789'; $env:DB_NAME='asgard_crm_test'; node tools/tkp-ai-live-probe.js [id1,id2,...]
 */

if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = '123456789';
if (!process.env.DB_NAME) process.env.DB_NAME = 'asgard_crm_test';

const db = require('../src/services/db');
const svc = require('../src/services/tkp-ai-draft');
const lint = require('../src/services/client-doc-lint');

const FORBIDDEN = [
  /себестоим/i, /марж/i, /наценк/i, /\bФОТ\b/i, /пайков/i, /командировоч/i,
  /чистая прибыль/i, /рентабельн/i, /таким образом/i, /стоит отметить/i,
  /в рамках/i, /комплексный подход/i, /позволит/i, /обеспечит/i,
  /ключевой/i, /оптимальн/i, /```/ 
];

async function pickTenders(ids) {
  if (ids.length) {
    const r = await db.query(
      `SELECT t.id, left(t.tender_title, 100) AS title,
              rv.work_price, rv.work_price_ex_vat,
              COALESCE(rv.report_json->'asgard_smeta'->'totals'->>'vat_pct', NULL) AS smeta_vat
         FROM tenders t
         JOIN tender_rp_reviews rv ON rv.tender_id = t.id
        WHERE t.id = ANY($1::int[])
        ORDER BY t.id DESC`,
      [ids]
    );
    return r.rows;
  }
  const r = await db.query(`
    SELECT t.id, left(t.tender_title, 100) AS title,
           rv.work_price, rv.work_price_ex_vat,
           COALESCE(rv.report_json->'asgard_smeta'->'totals'->>'vat_pct', NULL) AS smeta_vat
      FROM tenders t
      JOIN tender_rp_reviews rv ON rv.tender_id = t.id
     WHERE rv.is_final = TRUE
       AND rv.decision = 'submit'
       AND COALESCE(rv.work_price, rv.work_price_ex_vat, 0) > 0
       AND COALESCE(rv.director_review_status, '') NOT IN ('rejected', 'pending')
       AND t.tender_title ~ '[А-Яа-яЁё]'
       AND t.tender_title !~ '[0-9]{7,}'
     ORDER BY t.id DESC
     LIMIT 3
  `);
  return r.rows;
}

function blobOf(draft) {
  return [
    draft.subject, draft.work_description, draft.services,
    draft.deadline, draft.payment_terms, draft.warranty_text,
    ...(draft.scope_included || []), ...(draft.scope_excluded || []),
    ...((draft.items && draft.items.items) || []).map((i) => i.name)
  ].join('\n');
}

async function runOne(tender) {
  console.log('\n════════════════════════════════════════');
  console.log('Тендер', tender.id, '—', tender.title);
  console.log('Просчёт:', tender.work_price_ex_vat || tender.work_price, '| smeta vat:', tender.smeta_vat);

  // Сброс кэша, чтобы не брать старый degraded/мок
  await db.query(
    `DELETE FROM mimir_ai_cache WHERE agent_name = $1`,
    [svc.CONST.CACHE_AGENT]
  ).catch(() => {});

  const t0 = Date.now();
  const res = await svc.buildAiDraft({
    tenderId: tender.id,
    variant: 'classic',
    user: { id: 1, name: 'Проверка живой' }
  });
  const ms = Date.now() - t0;
  const d = res.draft;
  const meta = res.meta || {};
  const pricing = res.pricing || {};

  console.log('meta:', JSON.stringify({
    degraded: meta.degraded,
    reason: meta.reason,
    code: meta.code,
    model: meta.model,
    cached: meta.cached,
    durationMs: meta.durationMs || ms,
    sums_ok: meta.sums_ok,
    replaced_fields: meta.replaced_fields,
    vat_pct: pricing.vat_pct
  }));

  console.log('— subject:', d.subject);
  console.log('— description:', String(d.work_description || '').slice(0, 280));
  console.log('— scope_in:', (d.scope_included || []).join(' | '));
  console.log('— scope_out:', (d.scope_excluded || []).join(' | '));
  console.log('— items:', ((d.items && d.items.items) || []).map((i) => i.name + '=' + i.total).join('; '));
  console.log('— totals:', pricing.price_no_vat, '+НДС', pricing.vat_pct + '% →', pricing.price_with_vat);
  console.log('— payment:', String(d.payment_terms || '').slice(0, 160));
  console.log('— warranty:', String(d.warranty_text || '').slice(0, 120));

  // allowedNumbers как в сервисе: цены + числа из контекста (коды Z49002 и т.п.)
  const ctxPack = await svc.loadTenderContext(tender.id);
  const fullPricing = svc.readPricing(ctxPack.review, ctxPack.tender);
  const promptCtx = svc.buildPromptContext({
    tender: ctxPack.tender, review: ctxPack.review,
    checklist: ctxPack.checklist, docs: ctxPack.docs, pricing: fullPricing
  });
  const allowed = svc.collectAllowedNumbers(promptCtx, fullPricing);
  const lr = lint.lintDraftFields(d, { allowedNumbers: allowed });
  const text = blobOf(d);
  const leaks = FORBIDDEN.filter((re) => re.test(text)).map((re) => re.source);
  const vatOk = [0, 5, 10, 22].includes(Number(pricing.vat_pct));
  const sumOk = Math.abs(Number(d.total_sum) - Number(pricing.price_no_vat)) < 0.02;

  const verdict = {
    degraded: !!meta.degraded,
    lint_blocking: !!lr.blocking,
    lint_hits: lr.hits.length,
    leaks,
    vat_ok: vatOk,
    vat_pct: pricing.vat_pct,
    sums_ok: sumOk && !!meta.sums_ok,
    items_n: ((d.items && d.items.items) || []).length,
    ms
  };
  console.log('VERDICT', JSON.stringify(verdict));
  return verdict;
}

async function main() {
  const ids = (process.argv[2] || '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => n > 0);

  const tenders = await pickTenders(ids);
  if (!tenders.length) {
    console.error('Нет тендеров для прогона');
    process.exit(2);
  }

  const results = [];
  for (const t of tenders) {
    try {
      results.push({ id: t.id, ...(await runOne(t)) });
    } catch (e) {
      console.error('FAIL tender', t.id, e.message);
      results.push({ id: t.id, error: e.message });
    }
  }

  console.log('\n════════ ИТОГ ════════');
  results.forEach((r) => console.log(JSON.stringify(r)));
  const bad = results.filter((r) =>
    r.error || r.lint_blocking || (r.leaks && r.leaks.length) || !r.vat_ok || !r.sums_ok || r.items_n !== 1
  );
  // degraded при живом балансе — тоже дефект (хотим увидеть модель)
  const degraded = results.filter((r) => r.degraded);
  if (degraded.length) {
    console.log('WARN: деградация на', degraded.length, 'тендерах — модель не ответила');
  }
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
