#!/usr/bin/env node
'use strict';

/**
 * Живой прогон черновика ТКП через ИИ на реальной БД (клон/dev).
 *
 * Ничего не пишет: только читает тендер с закрытым просчётом и печатает,
 * что получилось. Нужен для проверки, что сборка контекста, позиции и
 * линтер работают на фактических данных, а не только на фикстурах.
 *
 * Запуск (PowerShell):
 *   $env:DB_PASSWORD='123456789'; $env:DB_NAME='asgard_crm_dev'; node tools/tkp-ai-draft-probe.js [tenderId]
 */

const db = require('../src/services/db');
const svc = require('../src/services/tkp-ai-draft');
const lint = require('../src/services/client-doc-lint');

async function main() {
  const argId = process.argv[2] ? parseInt(process.argv[2], 10) : null;

  let tenderId = argId;
  if (!tenderId) {
    const r = await db.query(
      `SELECT t.id
         FROM tenders t
         JOIN tender_rp_reviews rv ON rv.tender_id = t.id
        WHERE rv.is_final = TRUE AND rv.decision = 'submit'
        ORDER BY t.id DESC
        LIMIT 1`
    );
    if (!r.rows[0]) {
      console.log('Нет тендеров с закрытым просчётом «подаём» — нечего проверять.');
      return;
    }
    tenderId = r.rows[0].id;
  }

  console.log('Тендер:', tenderId);
  const ctx = await svc.loadTenderContext(tenderId);
  const pricing = svc.readPricing(ctx.review, ctx.tender);

  console.log('Заказчик:', ctx.tender.customer_name);
  console.log('Предмет:', ctx.tender.tender_title);
  console.log('Просчёт: is_final=' + ctx.review.is_final + ' decision=' + ctx.review.decision);
  console.log('work_price=' + ctx.review.work_price + '  ex_vat=' + ctx.review.work_price_ex_vat);
  console.log('Цена без НДС:', pricing.priceNoVat, '| с НДС:', pricing.priceWithVat, '| НДС:', pricing.vatPct + '%');
  console.log('Себестоимость (внутренняя!):', pricing.cost, '| наценка:', Math.round(pricing.markup * 100) / 100);
  console.log('Строк в смете:', (pricing.smeta && pricing.smeta.rows || []).length);

  const workNames = svc.collectWorkNames(pricing, ctx.review);
  console.log('\nРаботы для клиента:', workNames.length);
  workNames.forEach((r) => console.log('  -', r));

  const summaryName = svc.tidyItemName(
    svc.pickWorkTitle(ctx.tender.tender_title) || workNames[0] || 'Выполнение работ по техническому заданию'
  );
  const items = svc.buildClientItems(pricing, { summaryName });
  console.log('\nПозиции КП:', items.length);
  let sum = 0;
  items.forEach((it) => {
    sum += Number(it.total) || 0;
    console.log('  ' + it.name + ' | ' + it.unit + ' | ' + it.qty + ' × ' + it.price + ' = ' + it.total);
  });
  console.log('Сумма строк:', Math.round(sum * 100) / 100, '| цена КП без НДС:', pricing.priceNoVat,
    '| сходится:', Math.abs(sum - pricing.priceNoVat) < 0.02);

  const promptCtx = svc.buildPromptContext({
    tender: ctx.tender, review: ctx.review, checklist: ctx.checklist,
    docs: ctx.docs, pricing
  });

  // Линтим ЗНАЧЕНИЯ полей, а не JSON: иначе snake_case-ключи контекста
  // (customer_name) сами выглядят как машинный артефакт.
  let hits = 0;
  Object.keys(promptCtx).forEach((k) => {
    const r = lint.lintText(String(promptCtx[k] || ''), { skipNumbers: true });
    if (r.hits.length) {
      hits += r.hits.length;
      console.log('  ! [' + k + ']', r.hits.map((h) => h.kind + ':' + h.phrase).join(', '));
    }
  });
  console.log('\nЛинт значений промпта: hits =', hits);

  const draftLint = lint.lintDraftFields({ items }, { skipNumbers: true });
  console.log('Линт позиций: hits =', draftLint.hits.length);
  draftLint.hits.slice(0, 10).forEach((h) => console.log('  !', h.field, h.kind, h.phrase));
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
