/**
 * ASGARD CRM — ТКП/КП через ИИ из реестра тендеров
 * ═══════════════════════════════════════════════════════════════════════════
 * Собирает черновик коммерческого предложения по ЗАКРЫТОМУ просчёту РП.
 *
 * Главное правило (D-…): ИИ в этом модуле НЕ СЧИТАЕТ ДЕНЬГИ и НЕ ПИШЕТ
 * внутренние разделы. Он только:
 *   - формулирует предмет и описание работ,
 *   - перечисляет периметр (что входит / что не входит),
 *   - переименовывает готовые строки сметы «по-человечески».
 * Суммы, количество позиций, НДС и итоги — детерминированно из просчёта.
 *
 * Барьеры против мусора:
 *  1. Вход:  allowlist контекста + stripInternal() на всех свободных текстах.
 *  2. Выход: каждое поле проверяется отдельно, при провале — шаблон сервиса.
 *  3. Линтер client-doc-lint: правки человека тоже проходят через него.
 *  4. Гейт PDF: готовый байт-стрим читается pdf-parse и проверяется
 *     (см. lintPdfBuffer) до прикрепления файла к тендеру.
 *
 * Риски, обязанности заказчика и комментарии по цене ИИ НЕ ГЕНЕРИРУЕТ —
 * там нет источника правды, любой текст был бы выдумкой.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const crypto = require('crypto');
const db = require('./db');
const aiProvider = require('./ai-provider');
const promptLoader = require('./prompt-loader');
const lint = require('./client-doc-lint');
const { MODEL_DEFAULT } = require('./ai-models');

const AI_TIMEOUT_MS = 90_000;
const AI_MAX_TOKENS = 6000;
const OCR_BUDGET_CHARS = 40_000;
const CTX_BUDGET_CHARS = 60_000;
const CACHE_AGENT = 'tkp_ai_tender';

/* ─────────────────────────── константы шаблонов ─────────────────────────── */

const VALID_VARIANTS = ['classic', 'full'];

const WARRANTY_DEFAULT = '12 месяцев с даты подписания акта выполненных работ.';

// Тарифные условия оплаты — если в просчёте не задано иное.
const PAYMENT_DEFAULT = 'Аванс 30% в течение 5 банковских дней с даты подписания договора, '
  + 'остаток — в течение 10 банковских дней после подписания акта выполненных работ.';

// Обязанности заказчика: пишет шаблон, не ИИ (нет источника правды).
const CUSTOMER_DUTIES_DEFAULT = [
  'Предоставить доступ на объект и рабочие зоны на весь период выполнения работ.',
  'Обеспечить возможность подключения к воде, электроэнергии и канализации на объекте.',
  'Назначить ответственное лицо для согласования порядка работ и приёмки результата.',
  'Передать имеющуюся техническую документацию по оборудованию.'
].join('\n');

// Что не входит в объём: тоже шаблон. Формулировки нейтральные, без наших затрат.
const SCOPE_EXCLUDED_DEFAULT = [
  'Ремонт и замена оборудования, вышедшего из строя до начала работ.',
  'Строительно-монтажные работы, не указанные в техническом задании.',
  'Вывоз и утилизация отходов, образующихся в процессе эксплуатации объекта.'
];

// Периметр по умолчанию, если ИИ недоступен: строим из названий строк сметы.
// Ничего не выдумываем — только то, что уже есть в просчёте.

/* ─────────────────────────── утилиты ─────────────────────────── */

function num(v) {
  const n = Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function truncate(s, len) {
  const str = String(s == null ? '' : s);
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function firstLine(s) {
  return String(s == null ? '' : s).split(/\r?\n/)[0].trim();
}

function tryJson(text) {
  if (!text) return null;
  const raw = String(text);
  const attempts = [];

  attempts.push(raw.trim());

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) attempts.push(fenced[1].trim());

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) attempts.push(raw.slice(start, end + 1));

  for (const a of attempts) {
    try {
      const v = JSON.parse(a);
      if (v && typeof v === 'object') return v;
    } catch (_) { /* пробуем следующий вариант */ }
  }
  return null;
}

function arr(v) {
  if (Array.isArray(v)) return v.map((x) => String(x == null ? '' : x)).filter((x) => x.trim());
  if (typeof v === 'string' && v.trim()) {
    return v.split(/\r?\n|;\s*/).map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

/* ─────────────────────────── контекст для ИИ ─────────────────────────── */

/**
 * Собрать контекст просчёта и тендера.
 * Внутренние цифры здесь ЕСТЬ (нужны для детерминированной сборки),
 * но в промпт они не попадают — см. buildPromptContext().
 */
async function loadTenderContext(tenderId) {
  const { rows: [tender] } = await db.query(
    `SELECT t.*, u.name AS creator_name
       FROM tenders t
       LEFT JOIN users u ON u.id = t.created_by
      WHERE t.id = $1`,
    [tenderId]
  );
  if (!tender) {
    throw Object.assign(new Error('Тендер не найден'), { statusCode: 404 });
  }

  const { rows: [review] } = await db.query(
    'SELECT * FROM tender_rp_reviews WHERE tender_id = $1',
    [tenderId]
  );

  let checklist = null;
  try {
    const r = await db.query(
      'SELECT answers, free_answers, template_snapshot FROM tender_analysis_checklists WHERE tender_id = $1',
      [tenderId]
    );
    checklist = r.rows[0] || null;
  } catch (_) { /* таблицы может не быть на старых клонах */ }

  const docs = await db.query(
    `SELECT original_name, type, mime_type, ocr_text
       FROM documents
      WHERE tender_id = $1
        AND COALESCE(type,'') NOT IN ('ocr-extract')
        AND (
          ocr_text IS NULL
          OR (
            length(trim(ocr_text)) > 20
            AND ocr_text NOT ILIKE '%[Demo]%'
            AND ocr_text NOT ILIKE '%демо-режим%'
            AND ocr_text NOT ILIKE '%[ошибка OCR%'
          )
        )
      ORDER BY (ocr_text IS NULL) ASC, created_at DESC
      LIMIT 30`,
    [tenderId]
  ).catch(() => ({ rows: [] }));

  return { tender, review: review || null, checklist, docs: docs.rows || [] };
}

/** Развернуть report_json (JSONB или строка). */
function parseReviewJson(review) {
  if (!review) return {};
  let rj = review.report_json;
  if (typeof rj === 'string') {
    try { rj = JSON.parse(rj); } catch (_) { rj = {}; }
  }
  return rj && typeof rj === 'object' ? rj : {};
}

/**
 * Ставки НДС с 2026: 0 / 5 / 10 / 22. Ставка 20 — легаси до 2026,
 * в клиентских ТКП больше не используем (подменяем на 22).
 * Важно: 0 — валидная ставка, нельзя отсекать через `if (!vatPct)`.
 */
const CANON_VAT_RATES = [0, 5, 10, 22];

function normalizeVatPct(raw) {
  // Явный ноль — отдельная ветка: num(null)/num('') тоже дают 0, их нельзя
  // принимать за «без НДС».
  if (raw === 0 || raw === '0') return 0;
  if (raw == null || raw === '') return 22;
  const cleaned = String(raw).replace(/\s/g, '').replace(',', '.');
  const v = Number(cleaned);
  if (!Number.isFinite(v)) return 22;
  if (CANON_VAT_RATES.includes(v)) return v;
  // 20% и любые прочие — в ТКП с 2026 ведём как 22.
  return 22;
}

/**
 * Эталонный расчёт НДС и итога от базы.
 *
 * ЕДИНСТВЕННАЯ формула для клиентского документа: сервер и модалка обязаны
 * считать одинаково. Раньше превью считало `round(base * pct * 100)/100`,
 * а сервер `round2(subtotal * pct / 100)` — на 0,08 % баз это давало копейку
 * расхождения: в БД сохранялось 145 880,96, в DOCX печаталось 145 880,95.
 *
 * Считаем в целых копейках (канон D-181): база → копейки, ставка → базисные
 * пункты (22 % → 2200), поэтому произведение остаётся целым и точным.
 */
function vatFromBase(base, vatPct) {
  const b = Number(base);
  const p = Number(vatPct);
  if (!Number.isFinite(b) || b <= 0) return { base: 0, vat: 0, total: 0 };
  if (!Number.isFinite(p) || p < 0) return { base: round2(b), vat: 0, total: round2(b) };
  const baseKop = Math.round(b * 100);
  const bp = Math.round(p * 100);
  const vatKop = Math.round(baseKop * bp / 10000);
  return {
    base: baseKop / 100,
    vat: vatKop / 100,
    total: (baseKop + vatKop) / 100
  };
}

/**
 * Числа из просчёта: цена без НДС, цена с НДС, НДС, состав строк.
 * Источник истины — work_price (канон D-173: цена без НДС), дубль — смета.
 */
function readPricing(review, tender) {
  const reportJson = parseReviewJson(review);
  const smeta = reportJson.asgard_smeta || null;
  const totals = (smeta && smeta.totals) || {};

  const priceNoVat = num(
    review && review.work_price_ex_vat != null
      ? review.work_price_ex_vat
      : (review && review.work_price != null ? review.work_price : totals.price_no_vat)
  ) || num(totals.price_no_vat);

  let vatRaw = null;
  if (totals.vat_pct != null && totals.vat_pct !== '') vatRaw = totals.vat_pct;
  else if (tender && tender.vat_pct != null && tender.vat_pct !== '') vatRaw = tender.vat_pct;
  else {
    const withV = num(totals.price_with_vat);
    if (priceNoVat > 0 && withV > priceNoVat) {
      vatRaw = round2((withV / priceNoVat - 1) * 100);
    }
  }
  const vatPct = normalizeVatPct(vatRaw);

  let priceWithVat = num(totals.price_with_vat);
  // Если ставка нормализована (20→22) или withVat нет — считаем от цены без НДС.
  const implied = priceNoVat > 0 && priceWithVat > priceNoVat
    ? round2((priceWithVat / priceNoVat - 1) * 100)
    : null;
  if (!priceWithVat || (implied != null && Math.abs(implied - vatPct) > 0.51)) {
    priceWithVat = priceNoVat ? round2(priceNoVat * (1 + vatPct / 100)) : 0;
  }

  const cost = num(totals.cost);

  return {
    priceNoVat: round2(priceNoVat),
    priceWithVat: round2(priceWithVat),
    vatPct,
    cost: round2(cost),
    markup: cost > 0 && priceNoVat > 0 ? priceNoVat / cost : 0,
    totals,
    smeta,
    durationDays: num(reportJson.duration_days) || num(smeta && smeta.params && smeta.params.work_days),
    durationNote: reportJson.duration_note || '',
    paymentTerms: reportJson.payment_terms || '',
    scope: reportJson.scope || '',
    summary: reportJson.summary || '',
    analysis: reportJson.analysis_snapshot || {},
    resources: reportJson.resources || null
  };
}

/**
 * Отфильтровать ИИ-штампы из OCR/описания — но НЕ выбрасывать строку целиком,
 * а вырезать только предложения со штампами. OCR тендерной документации —
 * цитата заказчика, терять её из-за «является» нельзя: там ТЗ, объёмы, сроки.
 */
function stripCliches(text) {
  const src = String(text == null ? '' : text);
  if (!src.trim()) return '';

  const lines = src.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const sentences = lint.splitSentences
      ? lint.splitSentences(line)
      : line.split(/(?<=[.!?…])\s+/);
    const kept = sentences.filter((s) => {
      const probe = lint.lintText(s, { skipNumbers: true });
      return !probe.hits.some((h) => h.kind === 'ai_cliche' || h.kind === 'internal');
    });
    if (kept.length) out.push(kept.join(' '));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Контекст для ПРОМПТА. Никаких внутренних цифр: ни себестоимости, ни маржи,
 * ни цен строк, ни ФОТ. Только то, что заказчик и так знает.
 */
function buildPromptContext({ tender, review, checklist, docs, pricing }) {
  const reportJson = parseReviewJson(review);
  const analysis = reportJson.analysis_snapshot || {};

  const checklistLines = [];
  if (checklist) {
    let tpl = checklist.template_snapshot;
    if (typeof tpl === 'string') { try { tpl = JSON.parse(tpl); } catch (_) { tpl = []; } }
    let ans = checklist.answers;
    if (typeof ans === 'string') { try { ans = JSON.parse(ans); } catch (_) { ans = {}; } }
    if (Array.isArray(tpl)) {
      for (const q of tpl) {
        const v = ans && ans[q && q.id];
        if (v == null || String(v).trim() === '') continue;
        checklistLines.push(`${firstLine(q.text || q.label || '')}: ${String(v).trim()}`);
      }
    }
    const free = Array.isArray(checklist.free_answers) ? checklist.free_answers : [];
    for (const f of free) {
      if (f && f.answer) checklistLines.push(`${firstLine(f.text || '')}: ${String(f.answer).trim()}`);
    }
  }

  const ocrBlocks = [];
  let budget = OCR_BUDGET_CHARS;
  for (const d of docs) {
    if (!d || !d.ocr_text) continue;
    if (budget <= 0) break;
    const piece = truncate(stripCliches(lint.stripInternal(d.ocr_text)), Math.min(budget, 12000));
    if (!piece.trim()) continue;
    ocrBlocks.push(`[${d.original_name || 'документ'}] ${piece}`);
    budget -= piece.length;
  }

  // Только названия РАБОТ. Статьи затрат (СИЗ, материалы, амортизация, ФОТ)
  // в промпт не идут: клиенту они не показываются, и модель не должна их видеть.
  const workNames = collectWorkNames(pricing, review);

  // Техплан: сроки, бригада, МТР. Это факты из просчёта, а не выдумка модели —
  // на их основе она разбивает работы на позиции и пишет условия.
  const techLines = buildTechPromptLines(review, pricing);

  const ctx = {
    customer_name: tender.customer_name || '',
    customer_inn: tender.customer_inn || '',
    tender_title: tender.tender_title || '',
    tender_type: tender.tender_type || '',
    tender_description: truncate(lint.stripInternal(tender.tender_description || ''), 8000),
    purchase_url: tender.purchase_url || '',
    deadline_date: tender.docs_deadline ? String(tender.docs_deadline).slice(0, 10) : '',
    work_start_plan: tender.work_start_plan ? String(tender.work_start_plan).slice(0, 10) : '',
    checklist: truncate(lint.stripInternal(checklistLines.join('\n')), 6000),
    analysis_summary: truncate(lint.stripInternal(analysis.summary || reportJson.summary || ''), 3000),
    analysis_scope: truncate(lint.stripInternal(reportJson.scope || ''), 3000),
    feasibility: truncate(patternSafe(analysis.feasibility), 1200),
    competition: truncate(patternSafe(analysis.competition), 1200),
    requirement: truncate(lint.stripInternal((analysis.points || []).map((p) => String(p)).join('\n')), 3000),
    duration_days: pricing.durationDays ? String(pricing.durationDays) : '',
    duration_note: truncate(lint.stripInternal(reportJson.duration_note || ''), 500),
    payment_terms: truncate(patternSafe(reportJson.payment_terms), 500),
    price_no_vat: pricing.priceNoVat ? fmtMoney(pricing.priceNoVat) : '',
    price_with_vat: pricing.priceWithVat ? fmtMoney(pricing.priceWithVat) : '',
    vat_pct: String(pricing.vatPct),
    work_names: workNames.length ? workNames.map((n, i) => (i + 1) + '. ' + n).join('\n') : '(перечень работ не детализирован)',
    tech_plan: techLines,
    ocr: truncate(ocrBlocks.join('\n\n'), OCR_BUDGET_CHARS)
  };

  // Финальная зачистка: даже если что-то просочилось в свободный текст — вырезаем.
  // work_names исключён: это наши названия с нумерацией, уже прошедшие фильтр.
  // Свободные тексты чистятся от ИИ-штампов точечно (stripCliches), чтобы
  // цитаты заказчика из ТЗ не пропадали из-за канцелярита в исходнике.
  for (const k of Object.keys(ctx)) {
    if (!ctx[k] || k === 'work_names') continue;
    ctx[k] = stripCliches(lint.stripInternal(String(ctx[k])));
  }

  // Общий бюджет контекста: сначала важное, OCR в конце.
  let total = 0;
  for (const k of ['customer_name', 'tender_title', 'tender_type', 'tender_description',
    'deadline_date', 'work_start_plan', 'checklist', 'analysis_summary', 'analysis_scope',
    'feasibility', 'competition', 'requirement', 'duration_days', 'duration_note',
    'payment_terms', 'price_no_vat', 'price_with_vat', 'vat_pct', 'work_names', 'ocr']) {
    total += String(ctx[k] || '').length;
    if (total > CTX_BUDGET_CHARS && k === 'ocr') {
      const over = total - CTX_BUDGET_CHARS;
      ctx.ocr = truncate(ctx.ocr, Math.max(0, ctx.ocr.length - over));
    }
  }

  return ctx;
}

function patternSafe(v) {
  return typeof v === 'string' ? v : (v ? JSON.stringify(v).slice(0, 1200) : '');
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ─────────────────────────── позиции ─────────────────────────── */

// Те же служебные статьи, что прячет buildClientItems: клиент их не видит
// по отдельности. Держим копию списка, чтобы модуль был самостоятельно тестируем.
// Служебные статьи, которые нельзя показывать клиенту. Единственный источник
// правды — client-doc-lint (INTERNAL_WORDS): здесь только быстрый предфильтр,
// и ЛЮБОЕ название дополнительно проверяется линтером через isInternalName().
// Раньше это была вторая копия списка, и она разошлась с линтером: «транспортные
// расходы», «логистика», «мобилизация» проходили в позиции МТР и в PDF.
const INTERNAL_ROW_RE = /(ФОТ(?![а-яА-Я])|налог\s*\/?\s*взнос|накладн|непредвиден|пайков|проживан|билет|такси|подготовка на складе|дни дороги|доставка оборудования|проезд персонала|командировоч|суточн|зарплат|оклад|амортизац|себестоимост|маржинальн|наценк|транспортн|логистик|мобилизац)/i;

/**
 * Внутренняя ли статья по названию.
 *
 * Решает ЛИНТЕР (единый словарь), а regex — только дешёвый предфильтр.
 * Так список не может снова разойтись: новая формулировка в
 * client-doc-lint автоматически закрывается и здесь.
 */
function isInternalName(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return false;
  if (INTERNAL_ROW_RE.test(s)) return true;
  try {
    const probe = lint.lintText(s, { skipNumbers: true });
    return probe.hits.some((h) => h.kind === 'internal' || h.kind === 'internal_number');
  } catch (_) {
    return false;
  }
}

/**
 * Строки сметы → позиции для клиента.
 *
 * Правила:
 *  - секции A (персонал), C (командировочные), D (логистика), G (закупка долей),
 *    H (аренда) — в клиентскую таблицу по отдельности не идут: это структура
 *    наших затрат. Их стоимость «размазывается» наценкой по секциям B, E, F.
 *  - секции B (текущие расходы), E (материалы), F (перечень техники) — основа.
 *  - если после фильтрации не осталось ни строки — одна сводная строка.
 */
function collectClientRows(pricing) {
  const smeta = pricing.smeta;
  const rows = Array.isArray(smeta && smeta.rows) ? smeta.rows : [];
  const out = [];

  for (const r of rows) {
    if (!r) continue;
    if (r.kind !== 'line' && r.kind !== 'info') continue;
    const name = String(r.name || '').trim();
    if (!name) continue;
    if (isInternalName(name)) continue;
    const section = String(r.section || '');
    // Скрытые секции — это внутренняя структура затрат.
    if (['A', 'C', 'D', 'G', 'H'].includes(section)) continue;
    const qty = num(r.qty);
    const unit = String(r.unit || '').trim();
    const rowSum = num(r.sum);
    out.push({
      name,
      unit,
      qty: qty > 0 ? qty : 1,
      section,
      sum: rowSum
    });
  }

  return out;
}

/**
 * Клиентские позиции КП.
 *
 * ВАЖНО (проверено на реальной смете): строки `asgard_smeta` — это статьи
 * ЗАТРАТ (ФОТ, СИЗ, материалы, амортизация, аренда), а не работы для клиента.
 * Раздавать цену КП пропорционально им нельзя: получается «СИЗ + спецодежда —
 * 422 250 ₽», что и абсурдно, и раскрывает структуру себестоимости.
 *
 * Поэтому таблица КП всегда содержит ОДНУ сводную позицию на всю цену без НДС,
 * а состав работ уходит в текст (scope_included / work_description). Это:
 *   - не раскрывает затраты вообще (нулевой риск утечки);
 *   - гарантирует сходимость Σ строк = цена КП;
 *   - не выглядит как ошибка для заказчика.
 *
 * Если РП или ТО нужно несколько позиций, они добавляют их руками в форме ТКП —
 * это осознанное действие человека, а не догадка алгоритма.
 */
function buildClientItems(pricing, opts) {
  const o = opts || {};
  const target = round2(pricing.priceNoVat);
  if (!(target > 0)) return [];

  const name = o.summaryName || 'Выполнение работ по техническому заданию';

  return [{
    name,
    unit: 'усл.',
    qty: 1,
    price: target,
    total: target,
    section: ''
  }];
}

/* ─────────────────── позиции полного КП (разбивка) ─────────────────── */

/**
 * Позиции полного КП: N работ + N единиц МТР, а не одна сводная строка.
 *
 * Правила, которые нельзя нарушать:
 *  1. Σ строк = цена КП без НДС до копейки. Остаток округления — в последнюю
 *     строку. Иначе `_reconcileWithReview` блокирует публикацию.
 *  2. Внутренние статьи (ФОТ, пайковые, амортизация, накладные) в клиентскую
 *     таблицу не попадают НИКОГДА — от них остаётся только вес в цене.
 *  3. Работы распределяются по трудозатратам (чел-часы по роли), МТР — по
 *     стоимости из сметы, если она есть; иначе МТР идут справочно (0 ₽) и вес
 *     переносится на работы.
 *
 * @param {object} p { pricing, techPlan, workNames, summaryName }
 * @returns {Array<{name,unit,qty,price,total,section,inventory_number?}>}
 */
function buildItemizedClientItems(p) {
  const o = p || {};
  const pricing = o.pricing || {};
  const target = round2(pricing.priceNoVat);
  if (!(target > 0)) return [];

  const plan = o.techPlan || {};
  const crew = Array.isArray(plan.crew) ? plan.crew : [];
  const mtr = Array.isArray(plan.mtr) ? plan.mtr : [];
  const workNames = Array.isArray(o.workNames) ? o.workNames : [];
  const smetaRows = Array.isArray(pricing.smeta && pricing.smeta.rows) ? pricing.smeta.rows : [];
  const workDays = num(plan.schedule && plan.schedule.work_days);
  const shifts = num(plan.schedule && plan.schedule.shift_mode) || 1;
  const hours = num(plan.schedule && plan.schedule.shift_hours) || 12;

  // ── 1. Строки работ
  const works = [];
  const seen = new Set();
  const pushWork = (name, manHours) => {
    const n = tidyItemName(name);
    if (!n || n.length < 3) return;
    if (isInternalName(n)) return;
    if (seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    works.push({ name: n, manHours: manHours > 0 ? manHours : null });
  };

  // Работы из периметра просчёта: их трудозатраты неизвестны по отдельности,
  // поэтому делим общий человеко-ресурс пропорционально (равно).
  if (workNames.length) {
    const totalMH = num(plan.man_hours_total) || (workDays * shifts * hours * Math.max(1, crew.reduce((s, c) => s + num(c.count), 0)));
    const perWork = totalMH > 0 && workNames.length ? totalMH / workNames.length : null;
    workNames.forEach((w) => pushWork(w, perWork));
  }

  // Строки сметы как работы — если периметра нет вообще.
  if (!works.length) {
    const clientRows = collectClientRows(pricing);
    const names = clientRows.length
      ? clientRows.map((r) => r.name)
      : ['Выполнение работ по техническому заданию'];
    const totalMH = num(plan.man_hours_total);
    const perWork = totalMH > 0 ? totalMH / names.length : null;
    names.forEach((n) => pushWork(n, perWork));
  }

  // ── 2. Строки МТР
  const mtrRows = [];
  mtr.forEach((m) => {
    const name = tidyItemName(m.name);
    if (!name) return;
    // Внутренние статьи не имеют права попасть в перечень МТР: «ФОТ бригады»,
    // «Транспортные расходы», «Амортизация» — наша экономика, а не оборудование.
    // Тот же фильтр, что для работ: раньше проверка стояла только в pushWork,
    // и грязные названия МТР проходили в предпросмотр PDF.
    if (isInternalName(name)) return;
    const qty = num(m.qty) || 1;
    const unit = String(m.unit || 'шт').trim();
    // Стоимость МТР: из строки сметы F (перечень) или из самой позиции.
    let price = num(m.price);
    if (!(price > 0)) {
      const row = smetaRows.find((r) => r && String(r.section) === 'F'
        && String(r.name || '').toLowerCase().trim() === String(m.name || '').toLowerCase().trim());
      if (row) price = num(row.price);
    }
    mtrRows.push({
      name,
      unit,
      qty,
      price,
      total: round2(qty * price),
      section: 'MTR',
      inventory_number: m.inventory_number || ''
    });
  });

  // ── 3. Распределение цены
  const mtrTotal = round2(mtrRows.reduce((s, r) => s + r.total, 0));
  const worksTotalMH = works.reduce((s, w) => s + (num(w.manHours) > 0 ? num(w.manHours) : 1), 0);

  // Если МТР дороже цены КП — это дефект данных: МТР уходят справочно,
  // вся цена распределяется по работам (иначе получим отрицательные работы).
  const mtrFits = mtrTotal > 0 && mtrTotal < target * 0.95;
  const worksBudget = round2(mtrFits ? target - mtrTotal : target);

  const items = [];
  let allocated = 0;

  works.forEach((w, i) => {
    const weight = num(w.manHours) > 0 ? num(w.manHours) : 1;
    const isLast = i === works.length - 1;
    const share = worksTotalMH > 0 ? weight / worksTotalMH : 1 / works.length;
    const total = isLast ? round2(worksBudget - allocated) : round2(worksBudget * share);
    allocated = round2(allocated + total);
    items.push({
      name: w.name,
      unit: 'усл.',
      qty: 1,
      price: total,
      total,
      section: 'WORK'
    });
  });

  if (mtrFits) {
    mtrRows.forEach((r) => {
      items.push({
        name: r.name + (r.inventory_number ? ' (инв. № ' + r.inventory_number + ')' : ''),
        unit: r.unit,
        qty: r.qty,
        price: r.price,
        total: r.total,
        section: 'MTR',
        inventory_number: r.inventory_number
      });
    });
  } else if (mtrRows.length) {
    // МТР справочно: показываем перечень, но цену не несёт (иначе Σ ≠ цена).
    mtrRows.forEach((r) => {
      items.push({
        name: r.name + (r.inventory_number ? ' (инв. № ' + r.inventory_number + ')' : ''),
        unit: r.unit,
        qty: r.qty,
        price: 0,
        total: 0,
        section: 'MTR',
        inventory_number: r.inventory_number,
        reference: true
      });
    });
  }

  // ── 4. Сверка суммы
  const sum = round2(items.reduce((s, it) => s + num(it.total), 0));
  const diff = round2(target - sum);
  if (Math.abs(diff) >= 0.01 && items.length) {
    // Остаток — в последнюю позицию с ненулевой суммой.
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (num(items[i].total) > 0) {
        items[i].total = round2(items[i].total + diff);
        items[i].price = items[i].qty ? round2(items[i].total / items[i].qty) : items[i].total;
        break;
      }
    }
  }

  // Позиции без названия/с нулём qty — дефект сборки, не отдаём.
  return items.filter((it) => it.name && num(it.qty) > 0);
}

/**
 * Техплан из отчёта для ТКП. Читает `report_json.tech_json`, при его
 * отсутствии — смету (`asgard_smeta.crew/mtr/schedule`).
 */
function readTechPlan(review, pricing) {
  const rj = parseReviewJson(review);
  const raw = rj.tech_json || {};
  const sm = (pricing && pricing.smeta) || {};

  // ── МТР: четыре источника, один порядок ──────────────────────────────────
  // Контракт агента МТР (13.11.2026): результат лежит в `report_json.mtr`
  // и `mtr_suggestions`, но `readTechPlan` их не читал вовсе — правки МТР
  // в карточке не доходили до ТКП. Порядок как в rp-tech-plan-ui.readPlan:
  //   tech_json.mtr (РП правил в карточке) → smeta.mtr → report_json.mtr
  //   → report_json.mtr_suggestions
  //
  // Отличаем «нет данных» от «РП очистил перечень» (`[]`): пустой массив в
  // tech_json — это осознанное решение, и подменять его сметой нельзя.
  const tjHasMtrKey = Object.prototype.hasOwnProperty.call(raw, 'mtr');
  const tjMtr = Array.isArray(raw.mtr) ? raw.mtr : null;
  const tjCleared = tjHasMtrKey && Array.isArray(raw.mtr) && raw.mtr.length === 0;

  const smMtr = Array.isArray(sm.mtr) ? sm.mtr : [];
  const rjMtr = Array.isArray(rj.mtr) ? rj.mtr : [];
  const rjSug = Array.isArray(rj.mtr_suggestions) ? rj.mtr_suggestions : [];

  const pickMtr = () => {
    if (tjMtr && tjMtr.length) return tjMtr;
    if (tjCleared) return [];
    if (smMtr.length) return smMtr;
    if (rjMtr.length) return rjMtr;
    if (rjSug.length) return rjSug;
    return [];
  };

  return {
    schedule: raw.schedule || sm.schedule || {},
    crew: Array.isArray(raw.crew) && raw.crew.length ? raw.crew : (Array.isArray(sm.crew) ? sm.crew : []),
    mtr: pickMtr(),
    man_hours_total: raw.man_hours_total != null ? raw.man_hours_total
      : ((sm.totals && sm.totals.man_hours != null) ? sm.totals.man_hours : null)
  };
}

/**
 * Названия работ для промпта и для текстового блока «что входит».
 * Берём только «работные» строки сметы (секции B/E — текущие расходы и материалы
 * тут НЕ годятся), а также периметр из просчёта. Ничего не выдумываем.
 */
function collectWorkNames(pricing, review) {
  const out = [];
  const push = (s) => {
    const v = String(s == null ? '' : s).trim();
    if (!v) return;
    if (isInternalName(v)) return;
    if (out.indexOf(v) === -1) out.push(v);
  };

  const reportJson = parseReviewJson(review);
  const scope = String(reportJson.scope || pricing.scope || '').trim();
  if (scope) {
    scope.split(/\r?\n|;\s*|\.\s+/).forEach((line) => {
      const clean = line.replace(/^[\s\-–—•\d.)]+/, '').trim();
      // Предложение с внутренней статьёй («ФОТ бригады 300 000 руб.») целиком
      // отбрасываем: это не работа, а структура затрат.
      if (clean.length >= 3 && !isInternalName(clean)) push(clean);
    });
  }

  const analysis = reportJson.analysis_snapshot || {};
  if (Array.isArray(analysis.points)) {
    analysis.points.forEach((p) => push(typeof p === 'string' ? p : (p && p.text)));
  }

  // Перечень оборудования/техники (секция F) — это объекты работ, не затраты.
  // Заголовок секции («F. Планируемое оборудование и техника») в работы не берём:
  // это подпись раздела, а не работа.
  //
  // ВАЖНО: с 13.11.2026 в F лежат ещё и строки МТР (установки АВД, CIP-контуры,
  // компрессоры) — агент МТР кладёт их туда. Они НЕ являются работами:
  // без фильтра в таблице КП появлялась строка «Работа: АВД высокого давления».
  const rows = Array.isArray(pricing.smeta && pricing.smeta.rows) ? pricing.smeta.rows : [];
  rows.forEach((r) => {
    if (!r || r.section !== 'F') return;
    if (r.kind === 'section') return;
    // Строка пришла из МТР — это ресурс, а не работа.
    if (r.tech_from === 'mtr' || r.mtr_source) return;
    if (r.is_equipment) return;
    const n = String(r.name || '').trim();
    if (n) push(n);
  });

  return out;
}

/**
 * Допустимые числа для валидации ответа ИИ.
 *
 * Это НЕ только деньги: любое число, которое уже есть в исходных данных
 * (номер закупки в названии тендера, объём в чек-листе, номер аппарата),
 * модель имеет право повторить. Иначе получаем ложные срабатывания на
 * «TPUI_1789333911272» и выбрасываем нормальный текст.
 *
 * Выдуманной считается сумма, которой нет ни в ценах просчёта, ни во входных
 * данных, — вот её линтер и обязан ловить.
 */
function collectAllowedNumbers(ctx, pricing) {
  const out = [
    pricing.priceNoVat,
    pricing.priceWithVat,
    round2(pricing.priceWithVat - pricing.priceNoVat),
    pricing.vatPct,
    pricing.durationDays
  ].filter((v) => v != null && v !== '' && Number(v) !== 0);

  const texts = [
    ctx.tender_title, ctx.tender_description, ctx.checklist,
    ctx.analysis_summary, ctx.analysis_scope, ctx.requirement,
    ctx.work_names, ctx.duration_note, ctx.payment_terms,
    ctx.price_no_vat, ctx.price_with_vat
  ];

  for (const t of texts) {
    const s = String(t == null ? '' : t);
    if (!s) continue;
    lint.extractNumbers(s).forEach((n) => out.push(n.raw));
  }

  // Числа техплана (дни, чел-часы, количество) — тоже законные.
  const plan = ctx.tech_plan_data || null;  if (plan) {
    const sch = plan.schedule || {};
    [sch.work_days, sch.trip_count, sch.shift_hours, plan.man_hours_total].forEach((v) => {
      if (v != null && Number(v) !== 0) out.push(String(v));
    });
    (plan.crew || []).forEach((c) => { if (c && c.count != null) out.push(String(c.count)); });
    (plan.mtr || []).forEach((m) => { if (m && m.qty != null) out.push(String(m.qty)); });
  }

  // Числа из текстовых строк техплана («9 раб. дн.», «36 чел-ч»).
  lint.extractNumbers(String(ctx.tech_plan || '')).forEach((n) => out.push(n.raw));

  return out;
}

/**
 * Текстовые строки техплана для промпта.
 * Возвращает '' если техплана нет — тогда модель работает по составу работ.
 */
function buildTechPromptLines(review, pricing) {
  const rj = parseReviewJson(review);
  const raw = rj.tech_json || {};
  const sm = pricing && pricing.smeta ? pricing.smeta : {};
  // Сметная бригада/МТР — источник, если техплана нет: РП уже заполнил
  // параметры, и условия в КП обязаны это отражать, а не быть пустыми.
  const params = sm.params || {};
  const crew = Array.isArray(raw.crew) && raw.crew.length
    ? raw.crew
    : (Array.isArray(sm.crew) && sm.crew.length ? sm.crew : []);
  // МТР — тот же резолвер, что в readTechPlan: иначе в текст КП не попадала
  // техника из mtr_suggestions, и модель писала условия «по общим словам».
  const tp = readTechPlan(review, pricing);
  const mtr = tp.mtr;
  const schedule = Object.assign({}, sm.schedule || {}, raw.schedule || {});
  if (!Number(schedule.work_days) && Number(params.work_days)) schedule.work_days = params.work_days;
  if (!Number(schedule.shift_mode) && Number(params.shifts_per_day)) schedule.shift_mode = String(params.shifts_per_day);
  if (!Number(schedule.shift_hours) && Number(params.shift_hours)) schedule.shift_hours = params.shift_hours;
  if (!Number(schedule.trip_count) && Number(params.trip_count)) schedule.trip_count = params.trip_count;

  const plan = {
    schedule,
    crew,
    mtr,
    man_hours_total: raw.man_hours_total != null ? raw.man_hours_total
      : ((sm.totals && sm.totals.man_hours != null) ? sm.totals.man_hours : null)
  };

  // Если структурной бригады нет, но есть параметры — показываем их: иначе
  // в полном КП блок «условия» окажется пустым при заполненном просчёте.
  if (!plan.crew.length) {
    const masters = Number(params.masters_per_shift) || 0;
    const workers = Number(params.workers_per_shift) || 0;
    if (masters > 0) plan.crew.push({ role: 'Мастер / бригадир', count: masters });
    if (workers > 0) plan.crew.push({ role: 'Слесарь', count: workers });
    if (plan.crew.length) plan.crew.unshift({ role: 'ИТР (РП)', count: 1 });
  }

  const lines = [];
  const sch = plan.schedule;
  if (Number(sch.work_days) > 0) {
    let s = 'Срок: ' + Number(sch.work_days) + ' раб. дн.';
    if (Number(sch.trip_count) > 1) s += ', заездов: ' + Number(sch.trip_count);
    if (Number(sch.shift_mode) > 0) s += ', режим: ' + Number(sch.shift_mode) + ' смены/сут';
    if (Number(sch.shift_hours) > 0) s += ', смена ' + Number(sch.shift_hours) + ' ч';
    lines.push(s);
  }
  if (Number(plan.man_hours_total) > 0) {
    lines.push('Трудозатраты: ' + Math.round(Number(plan.man_hours_total)) + ' чел-ч.');
  }
  if (plan.crew.length) {
    lines.push('Бригада: ' + plan.crew.map((c) => (c.role || 'Роль') + ' — ' + Number(c.count || 0)).join('; '));
  }
  if (plan.mtr.length) {
    lines.push('Оборудование и материалы: ' + plan.mtr.map((m) => {
      const inv = m.inventory_number ? (' (' + m.inventory_number + ')') : '';
      const src = m.source === 'warehouse' ? ', склад' : (m.source === 'rent' ? ', аренда' : '');
      return (m.name || '') + inv + ' × ' + Number(m.qty || 1) + src;
    }).join('; '));
  }
  return lines.join('\n');
}

function buildSystemPrompt(ctx) {
  return promptLoader.buildPrompt('PROMPT-tkp-ai-v1.md', ctx);
}

const USER_INSTRUCTION = [
  'Сформируй черновик технико-коммерческого предложения по данным выше.',
  'Верни СТРОГО JSON по схеме из системного промпта, без markdown и без пояснений.',
  'Количество элементов в item_names должно быть РОВНО равно числу работ в work_names.'
].join(' ');

/**
 * Вызов модели. Возвращает {parsed, meta} либо {parsed:null, meta} — без throw:
 * отсутствие ИИ не должно ломать создание ТКП.
 */
async function callModel(system, userMessage) {
  const started = Date.now();
  try {
    const cacheKey = crypto.createHash('sha256')
      .update(system + '\n#MSG#\n' + userMessage + '\n#MODEL#\n' + MODEL_DEFAULT)
      .digest('hex');

    try {
      const cached = await db.query(
        'SELECT output_text FROM mimir_ai_cache WHERE input_hash = $1 LIMIT 1',
        [cacheKey]
      );
      if (cached.rows[0] && cached.rows[0].output_text) {
        const parsed = tryJson(cached.rows[0].output_text);
        if (parsed) {
          await db.query(
            'UPDATE mimir_ai_cache SET hit_count = hit_count + 1, last_used_at = NOW() WHERE input_hash = $1',
            [cacheKey]
          ).catch(() => {});
          return {
            parsed,
            meta: { model: MODEL_DEFAULT, cached: true, durationMs: Date.now() - started, degraded: false }
          };
        }
      }
    } catch (_) { /* кэш не обязателен */ }

    const result = await aiProvider.complete({
      system,
      messages: [{ role: 'user', content: userMessage }],
      model: MODEL_DEFAULT,
      maxTokens: AI_MAX_TOKENS,
      temperature: 0.2,
      timeoutMs: AI_TIMEOUT_MS,
      reasoning: { enabled: false }
    });

    const text = String((result && result.text) || '');
    if (!text.trim()) {
      return {
        parsed: null,
        meta: {
          degraded: true, reason: 'empty_response', model: (result && result.model) || MODEL_DEFAULT,
          durationMs: Date.now() - started, stopReason: (result && result.stopReason) || null
        }
      };
    }

    const parsed = tryJson(text);
    if (!parsed) {
      return {
        parsed: null,
        meta: { degraded: true, reason: 'bad_json', model: (result && result.model) || MODEL_DEFAULT, durationMs: Date.now() - started }
      };
    }

    try {
      await db.query(
        `INSERT INTO mimir_ai_cache (input_hash, model, agent_name, output_text, output_usage)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (input_hash) DO NOTHING`,
        [cacheKey, (result && result.model) || MODEL_DEFAULT, CACHE_AGENT, JSON.stringify(parsed),
          JSON.stringify((result && result.usage) || {})]
      );
    } catch (_) { /* кэш не обязателен */ }

    return {
      parsed,
      meta: {
        degraded: false,
        model: (result && result.model) || MODEL_DEFAULT,
        cached: false,
        durationMs: Date.now() - started,
        usage: (result && result.usage) || null
      }
    };
  } catch (err) {
    return {
      parsed: null,
      meta: {
        degraded: true,
        reason: 'provider_error',
        code: err && err.code ? err.code : null,
        message: err && err.userMessage ? err.userMessage() : (err && err.message) || 'ошибка провайдера',
        model: MODEL_DEFAULT,
        durationMs: Date.now() - started
      }
    };
  }
}

/* ─────────────────────────── валидация полей от ИИ ─────────────────────────── */

/**
 * Каждое поле проверяется отдельно. Провал → шаблон. НЕ пытаемся «починить»
 * текст, оставляя куски: либо поле прошло линтер целиком, либо его заменили.
 */
function validateTextField(value, { maxLen, fallback, allowedNumbers, field }) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return { value: fallback, replaced: !!fallback, reason: 'empty', field };

  if (raw.length > maxLen) {
    return { value: fallback, replaced: true, reason: 'too_long', field };
  }

  const probe = lint.lintText(raw, { allowedNumbers });
  if (probe.hits.length) {
    return { value: fallback, replaced: true, reason: 'lint', hits: probe.hits, field };
  }

  return { value: raw, replaced: false, field };
}

function validateList(list, { maxItems, maxLen, allowedNumbers, field }) {
  const items = arr(list).slice(0, maxItems);
  const clean = [];
  const rejected = [];

  for (const it of items) {
    const s = String(it).trim();
    if (!s || s.length > maxLen) { rejected.push({ value: s, reason: 'bad_shape' }); continue; }
    const probe = lint.lintText(s, { allowedNumbers });
    if (probe.hits.length) { rejected.push({ value: s, reason: 'lint', hits: probe.hits }); continue; }
    clean.push(s);
  }

  if (clean.length !== items.length) {
    return { value: clean, rejected, replaced: true, field };
  }
  return { value: clean, rejected, replaced: false, field };
}

/**
 * Шаблонные названия позиций: «Очистка теплообменника» из строки
 * «Очистка теплообменника (АВД)». Ничего не выдумываем — чистим скобки и хвосты.
 */
function tidyItemName(name) {
  let s = String(name || '').trim();
  s = s.replace(/\s*\([^)]{0,40}\)\s*$/, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) s = 'Выполнение работ';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ─────────────────────────── сборка черновика ─────────────────────────── */

/**
 * Отбросить из названия закупки технический мусор (номер процедуры).
 * На реальных данных предмет часто выглядит как «TPUI_1789333911272
 * approved-director» — заказчику такое показывать нельзя.
 */
function pickWorkTitle(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  // Идентификаторы процедур: латинские коды с длинными цифровыми хвостами.
  s = s.replace(/[A-Za-z]{2,}[_-]?\d{6,}/g, ' ');
  // Служебные суффиксы автотестов.
  s = s.replace(/\b(approved|rejected|pending|director|test|ui|demo)[-_]?/gi, ' ');
  s = s.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Если остались только цифры/обрывки — считаем, что названия нет.
  if (!/[а-яА-Я]{3,}/.test(s) && s.length < 12) return '';
  return s;
}

function defaultSubject(tender) {
  const title = pickWorkTitle(tender && tender.tender_title);
  if (title) return truncate(title, 180);
  const type = String((tender && tender.tender_type) || '').trim();
  return truncate('Выполнение работ' + (type ? ' (' + type + ')' : ''), 180);
}

function defaultDescription(tender, pricing, workNames) {
  const parts = [];
  // Периметр/резюме РП может быть техническим («TPUI_...: просчёт UI») —
  // чистим идентификаторы процедур, как и в subject.
  const scope = pickWorkTitle(pricing.scope) || pickWorkTitle(pricing.summary);
  if (scope) parts.push(truncate(firstLine(scope), 400));
  const names = (workNames || []).map((n) => pickWorkTitle(n)).filter(Boolean).slice(0, 4).join(', ');
  if (names) parts.push('Состав работ: ' + names + '.');
  if (pricing.durationDays) parts.push('Срок выполнения — ' + pricing.durationDays + ' рабочих дней.');
  if (parts.length) return truncate(parts.join(' '), 2000);
  return truncate('Выполняем работы по техническому заданию заказчика в согласованные сроки.', 2000);
}

/**
 * Собрать позиции для полного КП: аппараты и транспорт.
 * Суммы берём из позиций (уже приведённых к цене КП), имена — из строк.
 */
function buildFullPayload(pricing, items, texts) {
  const t = texts || {};
  const plan = t.techPlan || {};
  const sch = plan.schedule || {};
  let crew = Array.isArray(plan.crew) ? plan.crew : [];

  // Если структурной бригады нет, но в смете заданы параметры — показываем их.
  // Иначе блок «условия» выходит пустым при полностью заполненном просчёте
  // (ровно то, на что жаловались: «много мест не заполнено»).
  const sm = (pricing && pricing.smeta) || {};
  const par = sm.params || {};
  if (!crew.length) {
    const masters = num(par.masters_per_shift);
    const workers = num(par.workers_per_shift);
    if (masters > 0) crew.push({ role: 'Мастер / бригадир', count: masters });
    if (workers > 0) crew.push({ role: 'Слесарь', count: workers });
    if (crew.length) crew.unshift({ role: 'ИТР (РП)', count: 1 });
  }

  const schedule = Object.assign({}, plan.schedule || {});
  if (!num(schedule.work_days) && num(par.work_days)) schedule.work_days = num(par.work_days);
  if (!num(schedule.shift_mode) && num(par.shifts_per_day)) schedule.shift_mode = num(par.shifts_per_day);
  if (!num(schedule.shift_hours) && num(par.shift_hours)) schedule.shift_hours = num(par.shift_hours);
  if (!num(schedule.trip_count) && num(par.trip_count)) schedule.trip_count = num(par.trip_count);

  // Позиции таблицы: для полного КП — N работ + N МТР с ценами (уже сведены
  // к цене КП без НДС в buildItemizedClientItems). Единица измерения — в
  // «Ед. изм.», объём/примечание — в третьей колонке.
  const apparatus = (items || []).map((it) => ({
    equipment: it.name,
    inventory_no: it.unit || 'усл.',
    tube_data: it.inventory_number
      ? ('инв. № ' + it.inventory_number)
      : (it.reference ? 'справочно' : ''),
    qty: it.qty || 1,
    amount_no_vat: round2(it.total)
  }));

  // Условия — из техплана, а не выдумка модели: цифры уже проверены РП.
  const personnelParts = [];
  if (crew.length) {
    const byRole = {};
    crew.forEach((c) => {
      const r = String(c.role || 'Бригада').trim();
      byRole[r] = (byRole[r] || 0) + num(c.count);
    });
    Object.keys(byRole).forEach((r) => personnelParts.push(r + ' — ' + byRole[r]));
  }
  const regimeParts = [];
  if (num(schedule.shift_mode) > 0) regimeParts.push(num(schedule.shift_mode) + ' смены в сутки');
  if (num(schedule.shift_hours) > 0) regimeParts.push('смена ' + num(schedule.shift_hours) + ' ч');
  if (num(schedule.work_days) > 0) regimeParts.push('рабочих дней: ' + num(schedule.work_days));
  if (num(schedule.trip_count) > 1) regimeParts.push('заездов: ' + num(schedule.trip_count));

  return {
    object_name: t.object_name || '',
    basis: t.basis || 'Техническое задание заказчика',
    conditions: {
      mobilization: '',
      personnel: personnelParts.length ? personnelParts.join(', ') : '',
      regime: regimeParts.join(', '),
      payment: t.payment_terms_text || '',
      customer_resources: '',
      price_summary: ''
    },
    scope: (t.scope_included || []).join('\n'),
    scope_boundary: t.scope_boundary || '',
    apparatus,
    // Транспорт НЕ передаём отдельной суммой: цена без НДС, которую распределяет
    // buildItemizedClientItems, уже включает транспорт (он сидит в себестоимости).
    // Раньше шаблон прибавлял transport_amount к Σ позиций — итог в документе
    // расходился с ценой КП (5 935 430 + 50 000), и сохранение падало на проде,
    // где LibreOffice рендерит DOCX, а не PDFKit-фолбэк.
    transport_amount: 0,
    table_labels: {},
    cost_notes: t.cost_notes || '',
    acceptance: '',
    risks: (t.risks_paras || []).join('\n'),
    customer_duties: t.duties || '',
    deliverables: t.deliverables || '',
    author_name: t.author_name || '',
    author_position: t.author_position || 'Генеральный директор'
  };
}

/**
 * ФИО и должность директора для подписи в клиентском КП.
 * Источник — settings.company_profile; fallback — канон компании.
 */
async function resolveCompanyDirector() {
  const fallback = {
    name: 'Кудряшов О.С.',
    title: 'Генеральный директор'
  };
  try {
    const { rows } = await db.query(
      "SELECT value_json FROM settings WHERE key = 'company_profile' LIMIT 1"
    );
    const raw = rows[0] && rows[0].value_json;
    const cj = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    const full = String(cj.director_name || cj.director_full_name || cj.director || '').trim();
    const title = String(cj.director_title || cj.position || '').trim() || fallback.title;
    if (!full) return { name: fallback.name, title };
    const parts = full.split(/\s+/).filter(Boolean);
    let name = full;
    if (parts.length >= 3) {
      name = parts[0] + ' ' + parts[1].charAt(0).toUpperCase() + '.'
        + parts[2].charAt(0).toUpperCase() + '.';
    } else if (parts.length === 2 && parts[1].length > 2) {
      name = parts[0] + ' ' + parts[1].charAt(0).toUpperCase() + '.';
    }
    return { name, title };
  } catch (_) {
    return fallback;
  }
}

/**
 * Проверить, что просчёт готов к формированию ТКП.
 * Вынесено отдельной функцией: её можно тестировать без БД и без подмены
 * внутренних вызовов (подмена экспорта не работает — внутри модуля вызов
 * идёт по прямой ссылке).
 *
 * @throws {Error} с code: no_review | review_not_ready | director_rejected | director_pending
 */
function assertReviewReady(review) {
  if (!review) {
    throw Object.assign(
      new Error('По тендеру ещё нет просчёта РП — ТКП через ИИ недоступно'),
      { statusCode: 400, code: 'no_review' }
    );
  }
  if (review.is_final !== true || review.decision !== 'submit') {
    throw Object.assign(
      new Error('Просчёт РП не закрыт или РП рекомендует не подавать'),
      { statusCode: 400, code: 'review_not_ready' }
    );
  }
  // Директор отклонил или ещё не решил — цена не зафиксирована, ТКП формировать рано.
  if (review.director_review_status === 'rejected') {
    throw Object.assign(
      new Error('Просчёт отклонён директором — ТКП не формируется'),
      { statusCode: 400, code: 'director_rejected' }
    );
  }
  if (review.director_review_status === 'pending') {
    throw Object.assign(
      new Error('Просчёт ждёт решения директора — ТКП можно сформировать после решения'),
      { statusCode: 400, code: 'director_pending' }
    );
  }
}

/**
 * Главная функция: черновик ТКП по закрытому просчёту. В БД НИЧЕГО НЕ ПИШЕТ.
 *
 * @param {object} p
 * @param {number} p.tenderId
 * @param {'classic'|'full'} p.variant
 * @param {object} [p.user] — { id, name }
 * @param {object} [p.overrides] — ручные правки из модалки (повторный линт)
 * @returns {Promise<{draft:object, meta:object}>}
 */
async function buildAiDraft(p) {
  const tenderId = Number(p && p.tenderId);
  const variant = VALID_VARIANTS.includes(p && p.variant) ? p.variant : 'classic';

  const { tender, review, checklist, docs } = await loadTenderContext(tenderId);

  assertReviewReady(review);

  const pricing = readPricing(review, tender);
  if (!(pricing.priceNoVat > 0)) {
    throw Object.assign(
      new Error('В просчёте не указана цена без НДС — ТКП сформировать нечем'),
      { statusCode: 400, code: 'no_price' }
    );
  }

  const ctx = buildPromptContext({ tender, review, checklist, docs, pricing });
  const system = buildSystemPrompt(ctx);
  const ai = await callModel(system, USER_INSTRUCTION);

  // ── Отказ модели не должен давать правдоподобный пустой ТКП ───────────────
  // `ai.parsed || {}` молча подменял нераспарсенный ответ пустым объектом:
  // subject/description подставлялись из fallback, services оставался '',
  // scope_included/scope_excluded — пустые массивы. Пользователь видел
  // «ТКП создано» с пустыми блоками и не понимал, что модель не ответила.
  // Лучше честная ошибка: ТО нажмёт «Сохранить» ещё раз или впишет текст.
  if (!ai || !ai.parsed) {
    const reason = (ai && ai.meta && (ai.meta.reason || ai.meta.stop)) || 'ответ модели не разобран';
    throw Object.assign(
      new Error('Модель не вернула текст КП (' + reason + '). Черновик не создан — '
        + 'повторите генерацию. Суммы и позиции при этом не пострадали: они берутся из просчёта.'),
      { statusCode: 502, code: 'ai_unparsed' }
    );
  }
  const aiData = ai.parsed;

  // В таблице КП — одна сводная позиция: строки сметы это статьи затрат,
  // а не работы (см. buildClientItems). Название берём из ПРЕДМЕТА ЗАКУПКИ:
  // это то, что заказчик покупает. Оборудование из перечня (секция F) для
  // названия не годится — «АВД 500» не является предметом работ.
  const workNames = collectWorkNames(pricing, review);
  const summaryName = tidyItemName(
    pickWorkTitle(tender.tender_title) || workNames[0] || 'Выполнение работ по техническому заданию'
  );
  // Разбивка по позициям:
  //  * краткое КП — одна сводная строка (как раньше);
  //  * полное КП — N работ + N единиц МТР, Σ = цена КП до копейки.
  const techPlan = readTechPlan(review, pricing);
  const items = variant === 'full'
    ? buildItemizedClientItems({ pricing, techPlan, workNames })
    : buildClientItems(pricing, { summaryName });
  const allowedNumbers = collectAllowedNumbers(ctx, pricing);

  // Подписант КП — всегда директор компании, НЕ сотрудник ТО, который
  // нажал «Сохранить». Раньше брали p.user.name → у Гаджи в PDF стояло
  // «Газретов… / Генеральный директор».
  const director = await resolveCompanyDirector();
  const authorName = director.name;
  const authorPosition = director.title;

  const subject = validateTextField(aiData.subject, {
    maxLen: 180, fallback: defaultSubject(tender), allowedNumbers, field: 'subject'
  });

  const description = validateTextField(aiData.work_description, {
    maxLen: 2000,
    fallback: defaultDescription(tender, pricing, workNames),
    allowedNumbers,
    field: 'work_description'
  });

  const deadline = validateTextField(aiData.deadline_text, {
    maxLen: 300,
    fallback: pricing.durationDays ? `Срок выполнения — ${pricing.durationDays} рабочих дней с даты подписания договора.` : '',
    allowedNumbers,
    field: 'deadline_text'
  });

  const payment = validateTextField(aiData.payment_terms_text, {
    maxLen: 500,
    fallback: pricing.paymentTerms || PAYMENT_DEFAULT,
    allowedNumbers,
    field: 'payment_terms_text'
  });

  const warranty = validateTextField(aiData.warranty_text, {
    maxLen: 400, fallback: WARRANTY_DEFAULT, allowedNumbers, field: 'warranty_text'
  });

  const services = validateTextField(aiData.services, {
    maxLen: 1000, fallback: '', allowedNumbers, field: 'services'
  });

  const scopeIncluded = validateList(aiData.scope_included, {
    maxItems: 8, maxLen: 200, allowedNumbers, field: 'scope_included'
  });

  const scopeExcluded = validateList(aiData.scope_excluded, {
    maxItems: 6, maxLen: 200, allowedNumbers, field: 'scope_excluded'
  });

  // Названия позиций: только косметика. Количество обязано совпасть 1:1.
  const names = arr(aiData.item_names);
  const renamed = [];
  let namesReplaced = false;
  for (let i = 0; i < items.length; i += 1) {
    const cand = names[i] ? String(names[i]).trim() : '';
    if (!cand || cand.length > 160) { renamed.push(tidyItemName(items[i].name)); namesReplaced = true; continue; }
    const probe = lint.lintText(cand, { skipNumbers: true });
    if (probe.hits.length) { renamed.push(tidyItemName(items[i].name)); namesReplaced = true; continue; }
    renamed.push(cand);
  }
  if (names.length !== items.length) namesReplaced = true;
  const finalItems = items.map((it, i) => Object.assign({}, it, { name: renamed[i] }));

  // ── полный КП: тексты, которые ИИ писать не должен
  const fullPayload = buildFullPayload(pricing, finalItems, {
    object_name: (tender.customer_name ? tender.customer_name + ', ' : '') + firstLine(tender.tender_title || ''),
    basis: 'Техническое задание заказчика',
    payment_terms_text: payment.value,
    scope_included: scopeIncluded.value.length ? scopeIncluded.value : (workNames.length ? workNames : finalItems.map((i) => i.name)),
    scope_boundary: scopeExcluded.value.length
      ? 'Не входит в объём работ:\n' + scopeExcluded.value.map((s) => '— ' + s).join('\n')
      : '',
    cost_notes: '',
    risks_paras: [],
    duties: CUSTOMER_DUTIES_DEFAULT,
    deliverables: '',
    author_name: authorName,
    author_position: authorPosition,
    techPlan
  });

  const subtotal = round2(finalItems.reduce((s, it) => s + num(it.total), 0));

  // НДС и итог — по единой формуле vatFromBase (та же, что в модалке).
  // Раньше здесь был round2(subtotal * pct / 100), а в превью — другая
  // последовательность округлений: расходились на копейку на 0,08 % баз.
  const vatCalc = vatFromBase(subtotal, pricing.vatPct);
  const vatSum = vatCalc.vat;
  const totalWithVat = vatCalc.total;

  const itemsPayload = {
    items: finalItems,
    vat_pct: pricing.vatPct,
    subtotal,
    vat_sum: vatSum,
    total_with_vat: totalWithVat,
    payment_terms: payment.value,
    author_name: authorName,
    author_position: authorPosition,
    meta: {
      source: 'ai_tender',
      variant,
      generated_at: new Date().toISOString(),
      model: ai.meta && ai.meta.model ? ai.meta.model : null,
      cached: !!(ai.meta && ai.meta.cached),
      degraded: !!(ai.meta && ai.meta.degraded),
      replaced_fields: [
        subject.replaced ? 'subject' : null,
        description.replaced ? 'work_description' : null,
        deadline.replaced ? 'deadline_text' : null,
        payment.replaced ? 'payment_terms_text' : null,
        warranty.replaced ? 'warranty_text' : null,
        services.replaced ? 'services' : null,
        scopeIncluded.replaced ? 'scope_included' : null,
        scopeExcluded.replaced ? 'scope_excluded' : null,
        namesReplaced ? 'item_names' : null
      ].filter(Boolean),
      // Внутренние цифры просчёта. Храним, чтобы гейт PDF мог проверить,
      // что ни одна из них не попала в клиентский файл (себестоимость,
      // маржа, чистая прибыль). В сам документ они не выводятся.
      internal_amounts: [pricing.cost, pricing.totals && pricing.totals.margin_rub, pricing.totals && pricing.totals.net_profit]
        .map((v) => Math.round(Number(v) || 0))
        .filter((v) => v > 0)
    }
  };

  if (variant === 'full') itemsPayload.full = fullPayload;

  const draft = {
    subject: subject.value,
    tender_id: tenderId,
    customer_name: tender.customer_name || '',
    customer_inn: tender.customer_inn || '',
    work_description: description.value,
    services: services.value || null,
    items: itemsPayload,
    total_sum: subtotal,
    deadline: deadline.value || null,
    validity_days: 30,
    kp_variant: variant,
    link_type: 'tender',
    source: 'ai_tender',
    payment_terms: payment.value,
    // Поля для формы/полного КП (плоские, чтобы модалка их показала).
    scope_included: scopeIncluded.value,
    scope_excluded: scopeExcluded.value,
    deadline_text: deadline.value,
    payment_terms_text: payment.value,
    warranty_text: warranty.value,
    risks_paras: []
  };

  // ── финальная самопроверка: то, что уйдёт в документ, обязано быть чистым
  const lintResult = lint.lintDraftFields(draft, { allowedNumbers });
  const sumOk = Math.abs(subtotal - pricing.priceNoVat) < 0.02;
  // Итог с НДС проверяем по арифметике самого документа, а не по priceWithVat:
  // цена с НДС в смете считалась от неокруглённой базы и может отличаться на
  // копейки. Клиенту важен документ, а не внутренняя смета.
  const vatOk = Math.abs(totalWithVat - round2(subtotal + vatSum)) < 0.01;

  if (lintResult.blocking) {
    // Блокирующие нарушения после всех замен — значит, шаблон тоже грязный.
    // Это дефект кода, а не модели: не отдаём молча и печатаем, что именно.
    const detail = lintResult.hits
      .filter((h) => h.severity === 'block')
      .map((h) => `${h.field}: ${h.kind} «${h.phrase}»`)
      .join('; ');
    throw Object.assign(
      new Error('Шаблон ТКП содержит недопустимый текст (' + detail + ') — обратитесь к разработчику'),
      { statusCode: 500, code: 'template_dirty', hits: lintResult.hits }
    );
  }

  return {
    draft,
    pricing: {
      price_no_vat: subtotal,
      price_with_vat: totalWithVat,
      vat_pct: pricing.vatPct,
      vat_sum: vatSum
    },
    meta: Object.assign({}, ai.meta || {}, {
      variant,
      sums_ok: sumOk && vatOk,
      warnings: lintResult.hits,
      replaced_fields: itemsPayload.meta.replaced_fields
    })
  };
}

/* ─────────────────────────── гейт PDF ─────────────────────────── */

/**
 * Гейт перед прикреплением файла к тендеру.
 * Проверяет именно готовый PDF-байт-стрим.
 *
 * @param {Buffer} buffer
 * @param {object} p — { expectedNumbers:number[], allowedNumbers:number[] }
 * @returns {Promise<{ok:boolean, hits:Array, text:string, pages:number, numbers:object|null}>}
 */
async function assertPdfClean(buffer, p) {
  const o = p || {};
  return lint.lintPdfBuffer(buffer, {
    allowedNumbers: o.allowedNumbers || o.expectedNumbers,
    expectedNumbers: o.expectedNumbers,
    forbiddenNumbers: o.forbiddenNumbers
  });
}

/* ─────────────────────────── правки руками ─────────────────────────── */

/**
 * Проверить и почистить ручные правки перед сохранением.
 * Возвращает {ok, draft, hits}. Блокирующие нарушения НЕ сохраняются.
 */
function sanitizeManualDraft(draft, opts) {
  const o = opts || {};
  const src = draft || {};
  const allowedNumbers = o.allowedNumbers || [];

  const out = Object.assign({}, src);
  const hits = [];

  // Текстовые поля: вырезаем блокирующие предложения, штампы → отказ сохранять.
  for (const f of lint.DRAFT_TEXT_FIELDS) {
    if (out[f] == null) continue;
    const cleaned = lint.scrubText(String(out[f]));
    const probe = lint.lintText(cleaned, { allowedNumbers });
    out[f] = cleaned;
    probe.hits.forEach((h) => hits.push(Object.assign({ field: f }, h)));
  }
  for (const f of lint.DRAFT_LIST_FIELDS) {
    if (!Array.isArray(out[f])) continue;
    out[f] = out[f].map((item) => lint.scrubText(String(item || ''))).filter((s) => s.trim());
  }
  if (out.items && Array.isArray(out.items.items)) {
    out.items.items = out.items.items.map((it) => {
      const name = lint.scrubText(String((it && it.name) || ''));
      const probe = lint.lintText(name, { skipNumbers: true });
      probe.hits.forEach((h) => hits.push(Object.assign({ field: 'items.name' }, h)));
      return Object.assign({}, it, { name: name || 'Выполнение работ' });
    });
  }

  return { ok: hits.length === 0, draft: out, hits };
}

module.exports = {
  buildAiDraft,
  assertReviewReady,
  assertPdfClean,
  sanitizeManualDraft,
  resolveCompanyDirector,
  // для тестов и переиспользования
  readPricing,
  normalizeVatPct,
  vatFromBase,
  isInternalName,
  buildItemizedClientItems,
  readTechPlan,
  buildTechPromptLines,
  collectClientRows,
  collectWorkNames,
  collectAllowedNumbers,
  pickWorkTitle,
  buildClientItems,
  buildPromptContext,
  buildSystemPrompt,
  validateTextField,
  validateList,
  tidyItemName,
  defaultSubject,
  defaultDescription,
  loadTenderContext,
  parseReviewJson,
  _internal: { tryJson, arr, num, round2, truncate, INTERNAL_ROW_RE },
  CONST: {
    VALID_VARIANTS, AI_TIMEOUT_MS, WARRANTY_DEFAULT, PAYMENT_DEFAULT,
    CUSTOMER_DUTIES_DEFAULT, SCOPE_EXCLUDED_DEFAULT, CACHE_AGENT,
    CANON_VAT_RATES
  }
};
