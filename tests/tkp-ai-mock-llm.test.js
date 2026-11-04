#!/usr/bin/env node
'use strict';

/**
 * Полный путь buildAiDraft БЕЗ RouterAI: подменяем aiProvider.complete
 * ответами «как от модели» (чистый JSON / грязный / битый / пустой).
 *
 * Доказывает:
 *  1. Чистый ответ модели проходит → degraded:false, суммы = просчёт, линт 0.
 *  2. Утечка / штамп / выдуманная сумма в поле → поле заменено шаблоном,
 *     черновик всё равно чистый и суммы сходятся.
 *  3. Битый/пустой ответ → деградация, шаблонные тексты, суммы из просчёта.
 *  4. В финальном черновике нет себестоимости/маржи/ФОТ/штампов.
 *
 * БД: читает 1 тендер с закрытым просчётом (клон/dev). Ничего не пишет в tkp.
 * Запуск:
 *   $env:DB_PASSWORD='123456789'; $env:DB_NAME='asgard_crm_test'; node tests/tkp-ai-mock-llm.test.js
 */

if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = '123456789';
if (!process.env.DB_NAME) process.env.DB_NAME = 'asgard_crm_test';

const assert = require('assert');
const db = require('../src/services/db');
const aiProvider = require('../src/services/ai-provider');
const svc = require('../src/services/tkp-ai-draft');
const lint = require('../src/services/client-doc-lint');

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  PASS', name);
  } catch (e) {
    failed += 1;
    failures.push({ name, error: e.message });
    console.log('  FAIL', name, '—', e.message);
  }
}

function assertDraftClean(draft, pricing) {
  const lr = lint.lintDraftFields(draft, {
    allowedNumbers: [
      pricing.price_no_vat, pricing.price_with_vat, pricing.vat_pct,
      Math.round((pricing.price_with_vat - pricing.price_no_vat) * 100) / 100
    ]
  });
  assert.strictEqual(lr.blocking, false, 'blocking lint: ' + JSON.stringify(lr.hits));
  assert.deepStrictEqual(
    lr.hits.filter((h) => h.severity === 'block'),
    [],
    'hits: ' + JSON.stringify(lr.hits)
  );

  const blob = [
    draft.subject, draft.work_description, draft.services,
    draft.deadline, draft.payment_terms, draft.warranty_text,
    ...(draft.scope_included || []), ...(draft.scope_excluded || []),
    ...(draft.items && draft.items.items || []).map((i) => i.name)
  ].join('\n');

  const forbidden = [
    /себестоим/i, /марж/i, /наценк/i, /\bФОТ\b/i, /пайков/i,
    /командировоч/i, /чистая прибыль/i, /таким образом/i,
    /в рамках/i, /стоит отметить/i, /рентабельн/i
  ];
  for (const re of forbidden) {
    assert.ok(!re.test(blob), 'утечка/штамп в черновике: ' + re + ' ← ' + blob.slice(0, 200));
  }

  const items = (draft.items && draft.items.items) || [];
  const sum = items.reduce((s, it) => s + Number(it.total || 0), 0);
  assert.ok(Math.abs(sum - pricing.price_no_vat) < 0.02,
    'сумма строк ' + sum + ' != ' + pricing.price_no_vat);
  assert.ok(Math.abs(Number(draft.total_sum) - pricing.price_no_vat) < 0.02);
  assert.strictEqual(items.length, 1, 'ожидали 1 сводную позицию');
}

function cleanPayload(title) {
  return {
    subject: String(title || 'Выполнение работ по техническому заданию').slice(0, 160),
    work_description: 'Выполняем химическую очистку теплообменного оборудования на объекте заказчика согласно техническому заданию. Работы ведём собственными силами и оборудованием.',
    deadline_text: 'Срок выполнения — 15 рабочих дней с даты подписания договора.',
    payment_terms_text: 'Аванс 30% в течение 5 банковских дней с даты подписания договора, остаток — после подписания акта.',
    warranty_text: '12 месяцев с даты подписания акта выполненных работ.',
    services: 'Химическая очистка, промывка контуров, сдача объекта заказчику.',
    scope_included: [
      'Химическая очистка теплообменников',
      'Промывка технологических линий',
      'Подготовка объекта к пуску'
    ],
    scope_excluded: [
      'Ремонт и замена оборудования, вышедшего из строя до начала работ.',
      'Строительно-монтажные работы вне технического задания.'
    ],
    item_names: ['Химическая очистка теплообменного оборудования']
  };
}

function withMock(responder) {
  const orig = aiProvider.complete;
  aiProvider.complete = async function mockedComplete(opts) {
    return responder(opts);
  };
  return () => { aiProvider.complete = orig; };
}

async function pickTender() {
  // Берём живой русский предмет закупки, без синтетических TAC_/длинных ID —
  // иначе alien_number в subject ломает позитивный сценарий «чистая модель».
  const r = await db.query(`
    SELECT t.id, t.tender_title, rv.work_price, rv.work_price_ex_vat
      FROM tenders t
      JOIN tender_rp_reviews rv ON rv.tender_id = t.id
     WHERE rv.is_final = TRUE
       AND rv.decision = 'submit'
       AND COALESCE(rv.work_price, rv.work_price_ex_vat, 0) > 0
       AND COALESCE(rv.director_review_status, '') NOT IN ('rejected', 'pending')
       AND t.tender_title ~ '[А-Яа-яЁё]'
       AND t.tender_title !~ '[0-9]{7,}'
     ORDER BY t.id DESC
     LIMIT 1
  `);
  if (!r.rows[0]) throw new Error('Нет подходящего тендера на клоне');
  return r.rows[0];
}

async function bustCache() {
  // Кэш ключуется по system+user — для одного тендера все сценарии
  // схлопнулись бы в первый ответ. Чистим перед каждым кейсом.
  await db.query(
    `DELETE FROM mimir_ai_cache WHERE agent_name = $1`,
    [svc.CONST.CACHE_AGENT]
  ).catch(() => {});
}

async function main() {
  console.log('=== tkp-ai-mock-llm (без RouterAI) ===');
  const tender = await pickTender();
  console.log('Тендер', tender.id, '—', String(tender.tender_title || '').slice(0, 80));

  const cleanSubject = 'Химическая очистка теплообменного оборудования';

  await check('чистый JSON модели → черновик без деградации, суммы сходятся', async () => {
    await bustCache();
    const restore = withMock(async () => ({
      text: JSON.stringify(cleanPayload(cleanSubject)),
      model: 'mock-clean',
      usage: { prompt_tokens: 10, completion_tokens: 20 }
    }));
    try {
      const res = await svc.buildAiDraft({
        tenderId: tender.id, variant: 'classic', user: { id: 1, name: 'Проверка' }
      });
      assert.strictEqual(res.meta.degraded, false, 'ожидали degraded=false, получили ' + JSON.stringify(res.meta));
      assert.ok(res.meta.sums_ok, 'sums_ok=false');
      assert.ok(!(res.meta.replaced_fields || []).includes('subject'),
        'чистый subject не должен заменяться: ' + (res.meta.replaced_fields || []).join(','));
      assert.strictEqual(res.draft.subject, cleanSubject);
      assertDraftClean(res.draft, res.pricing);
      console.log('    subject:', res.draft.subject.slice(0, 90));
      console.log('    desc:', String(res.draft.work_description).slice(0, 120));
      console.log('    total:', res.pricing.price_no_vat, '+НДС', res.pricing.vat_pct + '% →', res.pricing.price_with_vat);
    } finally {
      restore();
    }
  });

  await check('грязь (себестоимость + штамп) → поля заменены, черновик чистый', async () => {
    await bustCache();
    const dirty = Object.assign(cleanPayload(cleanSubject), {
      subject: 'Таким образом предлагаем работы',
      work_description: 'Себестоимость работ 350000 руб., маржа позволит выполнить качественно.',
      scope_included: ['Очистка', 'Пайковые 700 руб на человека', 'Промывка']
    });
    const restore = withMock(async () => ({ text: JSON.stringify(dirty), model: 'mock-dirty' }));
    try {
      const res = await svc.buildAiDraft({
        tenderId: tender.id, variant: 'classic', user: { id: 1, name: 'Проверка' }
      });
      assert.strictEqual(res.meta.degraded, false, 'JSON валидный — не деградация провайдера');
      const replaced = res.meta.replaced_fields || [];
      assert.ok(replaced.includes('subject'), 'subject должен быть заменён');
      assert.ok(replaced.includes('work_description'), 'description должен быть заменён');
      assert.ok(replaced.includes('scope_included'), 'scope_included должен быть заменён/почищен');
      assertDraftClean(res.draft, res.pricing);
    } finally {
      restore();
    }
  });

  await check('выдуманная сумма в тексте → поле в шаблон, деньги из просчёта', async () => {
    await bustCache();
    const dirty = Object.assign(cleanPayload(cleanSubject), {
      work_description: 'Стоимость комплекса работ составит 999 999 руб. без НДС.'
    });
    const restore = withMock(async () => ({ text: JSON.stringify(dirty), model: 'mock-nums' }));
    try {
      const res = await svc.buildAiDraft({
        tenderId: tender.id, variant: 'classic', user: { id: 1, name: 'Проверка' }
      });
      assert.ok((res.meta.replaced_fields || []).includes('work_description'));
      assert.ok(Math.abs(res.draft.total_sum - res.pricing.price_no_vat) < 0.02);
      assert.ok(!/999\s*999/.test(res.draft.work_description || ''), 'выдуманная сумма осталась в тексте');
      assertDraftClean(res.draft, res.pricing);
    } finally {
      restore();
    }
  });

  await check('битый JSON → деградация, шаблон, суммы ок', async () => {
    await bustCache();
    const restore = withMock(async () => ({
      text: 'Извините, не могу сформировать JSON прямо сейчас.',
      model: 'mock-bad-json'
    }));
    try {
      const res = await svc.buildAiDraft({
        tenderId: tender.id, variant: 'classic', user: { id: 1, name: 'Проверка' }
      });
      assert.strictEqual(res.meta.degraded, true);
      assert.ok(res.meta.reason === 'bad_json' || res.meta.degraded);
      assertDraftClean(res.draft, res.pricing);
    } finally {
      restore();
    }
  });

  await check('пустой ответ / ошибка провайдера → деградация без падения', async () => {
    await bustCache();
    const restore = withMock(async () => {
      const err = new Error('Недостаточно средств');
      err.code = 'insufficient_funds';
      err.userMessage = () => 'Недостаточно средств на балансе AI-провайдера.';
      throw err;
    });
    try {
      const res = await svc.buildAiDraft({
        tenderId: tender.id, variant: 'full', user: { id: 1, name: 'Проверка' }
      });
      assert.strictEqual(res.meta.degraded, true);
      assert.strictEqual(res.draft.kp_variant, 'full');
      assert.ok(res.draft.items && res.draft.items.full, 'full-payload должен быть');
      assertDraftClean(res.draft, res.pricing);
      // обязанности заказчика — только шаблон (ключ customer_duties в full-payload)
      const duties = res.draft.items.full.customer_duties || '';
      assert.ok(duties.indexOf('Предоставить доступ') >= 0, 'нет шаблона обязанностей');
      const lr = lint.lintText(duties);
      assert.deepStrictEqual(lr.hits, []);
    } finally {
      restore();
    }
  });

  await check('модель подсовывает внутренние item_names → имя из предмета закупки', async () => {
    await bustCache();
    const dirty = Object.assign(cleanPayload(cleanSubject), {
      item_names: ['ФОТ бригады + накладные 10%']
    });
    const restore = withMock(async () => ({ text: JSON.stringify(dirty), model: 'mock-items' }));
    try {
      const res = await svc.buildAiDraft({
        tenderId: tender.id, variant: 'classic', user: { id: 1, name: 'Проверка' }
      });
      const name = res.draft.items.items[0].name;
      assert.ok(!/ФОТ|накладн/i.test(name), 'утечка в названии: ' + name);
      assertDraftClean(res.draft, res.pricing);
    } finally {
      restore();
    }
  });

  console.log('\nИтого: PASS', passed, '/ FAIL', failed);
  if (failures.length) {
    failures.forEach((f) => console.log(' -', f.name, ':', f.error));
  }
  try { await db.end(); } catch (_) {}
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
