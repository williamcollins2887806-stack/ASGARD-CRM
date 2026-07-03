/**
 * ASGARD CRM — Mimir Conductor: генератор официальных писем заказчику (Сессия 5, Шаг 5.1-5.2)
 * ═══════════════════════════════════════════════════════════════════════════
 * Превращает открытые уточнения канала CUSTOMER в официальное письмо-запрос
 * на разъяснения. Письмо рендерится в DOCX (OOXML через adm-zip) и PDF (pdfkit
 * + кириллический DejaVuSans). Внешних бинарей (libreoffice/unoconv) НЕ требует —
 * оба формата собираются в самом Node, чтобы работать и локально, и на сервере.
 *
 * Зависимости — только уже установленные: adm-zip, pdfkit. package.json НЕ трогаем.
 *
 * Группировка вопросов по темам (groupQuestionsByTopic) уважает stub-режим:
 * в dev (ключ stub-*) баланс НЕ тратится — формулировки берутся детерминированно.
 *
 * Артефакты на диск: storage/letters/<letter_number>.docx / .pdf
 * Запись в БД: mimir_customer_letters (status DRAFTED → пути docx_path/pdf_path).
 *
 * Реальная схема (проверено по information_schema):
 *   mimir_customer_letters(id, conductor_run_id, tender_id, letter_number,
 *     direction, subject_text, body_text, questions_ids[], docx_path, pdf_path,
 *     to_organization, to_person, to_email, status, drafted_at, ...)
 *   tenders(customer_name, customer_inn, inn, tender_title, tender_contact, ...)
 *   users(name, email, phone, login)
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const PDFDocument = require('pdfkit');

const db = require('../db');
const aiProvider = require('../ai-provider');
const cr = require('./conductor-run');
const { parseStrictJson } = require('./agents/_util');
const docGen = require('../document-generator');
const correspondence = require('../correspondence');
// S-5 (2026-06-21): _loadAsgardGendir / _lookupCustomerByDadata /
// _tryConvertDocxToPdf вынесены в src/services/letter/_shared.js
// (используются также composer'ом писем). Здесь — delegate-обёртки,
// поведение НЕ изменено (та же сигнатура, тот же возврат, тот же fallback).
const letterShared = require('../letter/_shared');

// ─── ASGARD GENDIR + EXECUTOR ───────────────────────────────────────────
// 20.06.2026: подпись письма — гендир Асгарда (Кудряшов О.С.), PM становится «Исп.».
// Источник истины — settings.company_profile (jsonb), туда же положены реквизиты.
async function _loadAsgardGendir() {
  return letterShared.loadAsgardGendir();
}

/**
 * Dadata: получить ФИО + полное название по ИНН заказчика.
 * Возвращает { name (короткое с ОПФ), full_name (полное с ОПФ), director_short, director_full, director_position, address }
 * Если токен/ответ нет — возвращает null с inn-based fallback на стороне callера.
 */
async function _lookupCustomerByDadata(inn) {
  return letterShared.lookupCustomerByDadata(inn);
}

// ─── Реквизиты отправителя (фирменный бланк ООО «Асгард-Сервис») ───
// 19.06.2026: исправлены реквизиты — было ошибочно «Саратов, ИНН 6450078801»,
// правильные данные из оф. бланка (templates/director-report-template.docx):
const SENDER = {
  org: 'ООО «АСГАРД-Сервис»',
  inn_kpp: 'ИНН/КПП: 7736244785 / 770101001',
  address: '105082, г. Москва, ул. Большая Почтовая, д. 55/59, стр. 1, пом. 37',
  phone: '+7 (499) 322-30-62',
  email: 'info@asgard-service.com',
  bank: 'АО «Альфа-Банк», р/с 40702810502260000343, к/с 30101810200000000593, БИК 044525593'
};

const LETTERS_DIR = path.join(process.cwd(), 'storage', 'letters');
const FONT_REGULAR = path.join(process.cwd(), 'public', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(process.cwd(), 'public', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

function ensureDir() {
  if (!fs.existsSync(LETTERS_DIR)) fs.mkdirSync(LETTERS_DIR, { recursive: true });
}

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];
function formatRuDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getDate()} ${RU_MONTHS[dt.getMonth()]} ${dt.getFullYear()} г.`;
}
function addDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

/**
 * Следующий исходящий номер письма: АС-ГГГГ-ММ/QNNN.
 * Счётчик — по числу уже существующих писем за текущий месяц.
 */
async function nextLetterNumber() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `АС-${yyyy}-${mm}`;
  let seq = 1;
  try {
    const r = await db.query(
      "SELECT COUNT(*)::int AS n FROM mimir_customer_letters WHERE letter_number LIKE $1",
      [`${prefix}/%`]
    );
    seq = (r.rows[0] ? r.rows[0].n : 0) + 1;
  } catch (_) { /* при ошибке стартуем с 1 */ }
  return `${prefix}/Q${String(seq).padStart(3, '0')}`;
}

/**
 * Сгруппировать/переформулировать вопросы по темам.
 * 20.06.2026 v3: AI получает РАСШИРЕННЫЙ контекст для каждого вопроса:
 *   - parsed_documents с реальным контентом (не только имена)
 *   - tz_summary.gaps / missing_specs из tz_analyst
 *   - ai_meta.warnings из итогового estimate (что Quick/Conductor не смог посчитать)
 *   - clarification.why_we_ask и default_assumption от агентов
 *   - estimate detail (что УЖЕ посчитано) — позволяет AI ссылаться на конкретные позиции
 *
 * AI пишет вопросы в форме «во время просчёта мы увидели что в ТЗ отсутствует X /
 * ведомость показывает 100 но описание ссылается на 200» — это явная просьба
 * пользователя «не пустой запрос а именно почему ИИ делает запрос».
 *
 * Модель — gpt-5.5 (стабильная у Tokenator). Без markdown, строгий JSON-массив.
 *
 * @param {Array} clars — raw clarifications (channel=CUSTOMER, status=OPEN)
 * @param {Object} ctx — { runId, customerName, projectTitle, receivedDocs, tzGaps, estimateBrief, aiNotes }
 */
async function groupQuestionsByTopic(clars, ctx = {}) {
  // Детерминированный фолбэк (stub или ошибка LLM) — с базовой дедупликацией по first 80 chars.
  const fallback = () => {
    const seen = new Set();
    return clars.map((c, i) => ({
      number: i + 1,
      question_topic: topicOf(c),
      question_text: formalize(c.question_ru || ''),
      why_we_ask: c.why_we_ask || null,
      default_assumption: c.default_assumption || null
    })).filter(q => {
      const k = q.question_text.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).map((q, i) => ({ ...q, number: i + 1 }));
  };

  if (aiProvider.isStubMode()) return fallback();
  if (!clars.length) return [];

  const receivedDocsBlock = ctx.receivedDocs && ctx.receivedDocs.length
    ? ctx.receivedDocs.slice(0, 25).map(d => {
        const excerpt = (d.preview || '').replace(/\s+/g, ' ').slice(0, 350);
        return `─── ${d.name || '?'}${d.chars ? ` [${d.chars} симв.]` : ''}\n${excerpt || '(текст пуст или не извлекался)'}`;
      }).join('\n\n')
    : '(документы не получены или не разобраны парсером)';

  const tzGapsBlock = ctx.tzGaps && ctx.tzGaps.length
    ? ctx.tzGaps.slice(0, 15).map((g, i) => `  ${i+1}. ${g}`).join('\n')
    : '(аналитик ТЗ не отметил пробелов либо ТЗ не разбирался)';

  const aiWarningsBlock = ctx.aiWarnings && ctx.aiWarnings.length
    ? ctx.aiWarnings.slice(0, 12).map((w, i) => `  ${i+1}. ${w}`).join('\n')
    : '(в финальной смете нет явных warning)';

  const estimateBriefBlock = ctx.estimateBrief && ctx.estimateBrief.length
    ? ctx.estimateBrief.slice(0, 0xFFFF) // как есть, уже короткий брифинг
    : '(финальной сметы пока нет либо она пустая)';

  const _fmtJsonbField = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') return v.text || v.value || v.assumption || JSON.stringify(v);
    return String(v);
  };
  const clarsBlock = clars.map((c, i) => {
    const why = c.why_we_ask ? `\n     Зачем: ${c.why_we_ask}` : '';
    const defStr = _fmtJsonbField(c.default_assumption);
    const def = defStr ? `\n     Default: ${defStr}` : '';
    return `Q${i + 1}. [${c.category || '—'}] ${c.question_ru}${why}${def}`;
  }).join('\n\n');

  const prompt = `═══ КОНТЕКСТ ПРОЕКТА ═══
Заказчик: ${ctx.customerName || 'не указан'}
Проект: ${ctx.projectTitle || 'не указан'}
Количество прикреплённых документов: ${(ctx.receivedDocs || []).length}

═══ ВЫДЕРЖКИ ИЗ ПОЛУЧЕННЫХ ДОКУМЕНТОВ (что мы реально видели) ═══
${receivedDocsBlock}

═══ ПРОБЕЛЫ ТЗ (от агента-аналитика ТЗ) ═══
${tzGapsBlock}

═══ WARNING'И ИЗ ФИНАЛЬНОЙ СМЕТЫ (что не удалось посчитать однозначно) ═══
${aiWarningsBlock}

═══ ЧТО МЫ УЖЕ ПОСЧИТАЛИ (краткий брифинг по смете) ═══
${estimateBriefBlock}

═══ ИСХОДНЫЕ ВОПРОСЫ ${clars.length} шт. от агентов Conductor ═══
${clarsBlock}

═══ ТВОЯ ЗАДАЧА — НАПИСАТЬ ПОЛНОЦЕННЫЕ ПОЯСНЕНИЯ К ЗАПРОСУ ═══
Ты пишешь раздел «ПОЯСНЕНИЯ К ЦЕНОВОМУ ПРЕДЛОЖЕНИЮ» в официальном письме гендиру заказчика.
Это НЕ короткий запрос — это деловое письмо в стиле ГНШ: каждый пункт ОБЪЯСНЯЕТ
почему мы спрашиваем, ссылается на КОНКРЕТНЫЙ раздел ТЗ или ведомости и
говорит как мы временно ПРИНЯЛИ при отсутствии данных.

1. ДЕДУПЛИЦИРУЙ: «пришлите ТЗ» + «пришлите спецификации» + «пришлите чертежи» = ОДИН пункт «По составу исходных данных».
2. УЧТИ что заказчик уже прислал ${(ctx.receivedDocs || []).length} документов — НЕ проси то что уже есть в выдержках выше.
3. ОБЪЕДИНЯЙ родственные вопросы в крупные тематические разделы (3-6 разделов).
4. Каждый пункт — 3-7 предложений делового стиля:
   а) ЧТО мы увидели в ТЗ/ведомости (с привязкой к конкретному документу или разделу из выдержек).
   б) ПОЧЕМУ для нас это блокер расчёта (какую цифру в смете это меняет).
   в) КАКОЕ ВРЕМЕННОЕ ДОПУЩЕНИЕ мы приняли (со ссылкой на типовую практику / референсный проект).
   г) ПРОСИМ ПОДТВЕРДИТЬ или скорректировать.
5. Стиль — спокойный, корпоративный, без эмоций, без «срочно» и «критично». Без «без этого нельзя зафиксировать стоимость».
6. Заголовки тем — короткие в форме «По <теме>»: «По объёму работ», «По мобилизации бригады», «По составу налоговых платежей», «По безопасности», «По срокам».
7. why_we_ask — одной фразой деловая причина (для отчётности).
8. default_assumption — одной фразой что приняли по умолчанию.
9. Максимум 6 пунктов в финальном списке.

ФОРМАТ ОТВЕТА — СТРОГО JSON-массив (без markdown, без объяснений):
[{
  "number": 1,
  "question_topic": "По объёму работ",
  "question_text": "В Техническом задании (раздел 2.2, п. 4) приведено описание работ без ведомости объёмов или сметы заказчика. По нашей оценке стоимость работ составит 90 883 851,13 руб. без НДС (110 878 298,38 руб. с НДС 22 %) при следующих исходных условиях: ... При этом, обращаясь к стоимости мобилизации бригады работ, стоимость которой составляет XX руб. (п. 4 настоящего письма), сумма с учётом мобилизации составит ZZ руб. с НДС. Просим подтвердить корректность нашей оценки либо направить ведомость объёмов работ по форме Заказчика для корректировки.",
  "why_we_ask": "Для финализации цены и сроков по разделу 2.2 ТЗ.",
  "default_assumption": "Применили типовой объём по референсному проекту аналогичной мощности."
}]`;

  try {
    const result = await aiProvider.complete({
      system: 'Ты — эксперт-инженер ООО «Асгард-Сервис», старший автор разъяснительных писем гендиру заказчика. Пишешь длинные деловые пояснения 3-7 предложений каждое со ссылкой на конкретный документ/раздел/цифру. Стиль — корпоративный, спокойный, без эмоций. ТОЛЬКО валидный JSON-массив, без markdown-обрамления.',
      messages: [{ role: 'user', content: prompt }],
      model: 'gpt-5.5',
      maxTokens: 8000
    });
    const txt = String(result.text || result.content || '').trim();
    let body = txt;
    const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) body = fence[1].trim();
    const first = body.indexOf('[');
    const last = body.lastIndexOf(']');
    let parsed = null;
    if (first !== -1 && last > first) {
      const json = body.slice(first, last + 1);
      try { parsed = JSON.parse(json); } catch (_) {
        try { parsed = JSON.parse(json.replace(/,(\s*[}\]])/g, '$1')); } catch (_) {}
      }
    }
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.slice(0, 8).map((q, i) => ({
        number: i + 1,
        question_topic: String(q.question_topic || topicOf(q)).slice(0, 90),
        question_text: String(q.question_text || q.question || '').trim(),
        why_we_ask: q.why_we_ask || null,
        default_assumption: q.default_assumption || null
      })).filter(q => q.question_text && q.question_text.length > 30);
    }
    console.warn('[letter-generator] AI вернул не-массив или пустой массив. First 200 chars:', txt.slice(0, 200));
    return fallback();
  } catch (e) {
    console.warn('[letter-generator] AI consolidator failed:', e.message);
    return fallback();
  }
}

/** Грубая эвристика темы вопроса по ключевым словам категории/текста. */
function topicOf(c) {
  const t = `${c.category || ''} ${c.question_ru || ''}`.toLowerCase();
  if (/объ[её]м|кол-?во|количеств|площад|метр/.test(t)) return 'По объёму работ';
  if (/чертеж|документ|пд|рд|схем/.test(t)) return 'По документации';
  if (/метод|способ|технолог/.test(t)) return 'По методу производства работ';
  if (/доступ|режим|пропуск|допуск|наряд/.test(t)) return 'По доступу и режиму объекта';
  if (/материал|давальч|поставк/.test(t)) return 'По материалам и поставкам';
  if (/срок|дат|график/.test(t)) return 'По срокам';
  return 'Прочие уточнения';
}

/** Минимальная «деловая» оболочка для технического вопроса. */
function formalize(q) {
  const trimmed = String(q || '').trim();
  if (!trimmed) return 'Просим предоставить разъяснения.';
  if (/^просим/i.test(trimmed)) return trimmed;
  return `Просим уточнить: ${trimmed}`;
}

// ─── Сборка контекста письма из БД ───
async function loadLetterContext(runId, pmUserId) {
  const run = await cr.getRun(runId);
  if (!run) throw new Error(`ConductorRun ${runId} не найден`);

  let tender = null;
  if (run.tender_id) {
    const tr = await db.query(
      `SELECT id, tender_title, customer_name, customer, customer_inn, inn, tender_contact, period, comment_to
         FROM tenders WHERE id = $1`,
      [run.tender_id]
    );
    tender = tr.rows[0] || null;
  }

  // Pre-tender для нормального проектного заголовка и заказчика.
  // Tender обычно — автоматический draft с шумом ('Авто-tender из ...'),
  // а pre_tender_requests держит реальные work_description, customer_name и т.д.
  let preTender = null;
  let preTenderId = null;
  try {
    const cf = run.complexity_flags || {};
    // 20.06.2026: поддержка cf.entity_kind:'pre_tender' + entity_id (test-conductor.js формат).
    preTenderId = cf.pre_tender_id || cf.preTenderId
              || (cf.entity_kind === 'pre_tender' && cf.entity_id ? Number(cf.entity_id) : null)
              || null;
    if (!preTenderId && run.tender_id) {
      const r = await db.query(
        'SELECT id FROM pre_tender_requests WHERE created_tender_id = $1 LIMIT 1',
        [run.tender_id]);
      if (r.rows[0]) preTenderId = Number(r.rows[0].id);
    }
    if (preTenderId) {
      const r = await db.query(
        `SELECT id, customer_name, work_description, work_location, ai_summary, ai_work_type
           FROM pre_tender_requests WHERE id = $1`, [preTenderId]);
      preTender = r.rows[0] || null;
    }
  } catch (_) {}

  let pm = null;
  if (pmUserId) {
    const ur = await db.query('SELECT id, name, email, phone FROM users WHERE id = $1', [pmUserId]);
    pm = ur.rows[0] || null;
  }

  const fed = run.final_estimate_data || {};
  // Приводим английские "..." к русским «...» + фильтр Auto-tender (тестовое имя из test-conductor-pt).
  const _ruQuote = (s) => {
    if (!s) return s;
    let str = String(s);
    let opening = true;
    str = str.replace(/"/g, () => { opening = !opening; return opening ? '»' : '«'; });
    if (str.includes('«') && !str.includes('»')) str = str.replace(/«([^«»]+)$/, '«$1»');
    return str;
  };
  const _isAutoTender = (s) => /^auto[-\s]?tender\b|\bpt-\d+\b/i.test(String(s || ''));
  // projectTitle: приоритет — реальное название работ (work_description / ai_summary),
  // НЕ внутренний «Просчёт #N» и НЕ «Auto-tender для pt-X».
  const projectTitle = _ruQuote(
    (fed.title && !_isAutoTender(fed.title) ? fed.title : null)
    || (preTender && (preTender.ai_work_type || _firstSentence(preTender.work_description) || _firstSentence(preTender.ai_summary)))
    || (tender && tender.tender_title && !_isAutoTender(tender.tender_title) ? tender.tender_title : null)
    || (tender && tender.period && !/^[а-яё]{3,5}\s+\d{4}/i.test(tender.period) ? tender.period : null)
    || `работы по заявке #${runId}`
  );

  // Заказчик.
  const toOrg = _ruQuote((preTender && preTender.customer_name)
    || (tender && (tender.customer_name || tender.customer))
    || '');

  return { run, tender, preTender, pm, projectTitle, toOrg };
}

function _firstSentence(s) {
  if (!s || typeof s !== 'string') return '';
  const t = s.trim();
  if (!t) return '';
  // Берём до первой точки/перевода строки, ограничиваем 160 символами.
  const m = t.match(/^([^.\n!?]{1,160})/);
  return (m ? m[1] : t.slice(0, 160)).trim();
}

// ─── DOCX-рендер (OOXML минимальный, через adm-zip) ───
function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function docxParagraph(text, opts = {}) {
  const bold = opts.bold ? '<w:b/>' : '';
  const italic = opts.italic ? '<w:i/>' : '';
  const size = opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : '';
  const align = opts.align ? `<w:jc w:val="${opts.align}"/>` : '';
  const lines = String(text == null ? '' : text).split('\n');
  const runs = lines.map((ln, i) =>
    `<w:r><w:rPr>${bold}${italic}${size}</w:rPr>${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${escXml(ln)}</w:t></w:r>`
  ).join('');
  return `<w:p><w:pPr>${align}<w:spacing w:after="120"/></w:pPr>${runs}</w:p>`;
}

function buildDocxXml(model) {
  const parts = [];
  parts.push(docxParagraph(SENDER.org, { bold: true, size: 28 }));
  parts.push(docxParagraph(`${SENDER.inn_kpp}\n${SENDER.address}\nТел: ${SENDER.phone}`, { size: 20 }));
  parts.push(docxParagraph(`Кому: ${model.to_organization || '—'}`, { size: 20 }));
  if (model.to_person) parts.push(docxParagraph(`Вниманию: ${model.to_person}`, { size: 20 }));
  parts.push(docxParagraph(`Исх. № ${model.letter_number}    Дата: ${model.date_ru}`, { size: 20 }));
  // 20.06.2026: шапка-бланк с реквизитами (как в отчёте директора).
  // Раньше DOCX был без бланка — только PDF. Теперь оба формата на оф. бланке.
  parts.unshift(docxParagraph(SENDER.org, { bold: true, size: 24, align: 'center' }));
  parts.push(docxParagraph(SENDER.address, { size: 18, align: 'center' }));
  parts.push(docxParagraph(SENDER.inn_kpp, { size: 18, align: 'center' }));
  parts.push(docxParagraph(`Тел: ${SENDER.phone}   E-mail: info@asgard-service.com`, { size: 18, align: 'center' }));
  parts.push(docxParagraph('—————————————————————————————————————————————————', { size: 16, align: 'center' }));
  // Шапка письма (Кому / Адрес / Исх. № / Дата) — перенесены из старой структуры.
  parts.push(docxParagraph(`Кому: ${model.to_organization || '—'}`, { size: 22 }));
  if (model.to_address) parts.push(docxParagraph(`Адрес: ${model.to_address}`, { size: 20 }));
  if (model.to_person) parts.push(docxParagraph(`Вниманию: ${model.to_person}`, { size: 22 }));
  parts.push(docxParagraph(`Исх. № ${model.letter_number}   Дата: ${model.date_ru}`, { size: 20 }));
  parts.push(docxParagraph(`Запрос на разъяснения по объекту: ${model.project_title}`, { bold: true, size: 24, align: 'center' }));
  parts.push(docxParagraph(
    `Уважаемый(ая) ${model.to_person ? model.to_person.split(' ').slice(0,2).join(' ') : 'коллега'}!\n\n` +
    `В рамках подготовки коммерческого предложения по проекту «${model.project_title}»` +
    (model.received_docs_count ? `, после анализа полученных от Вас ${model.received_docs_count} ${model.received_docs_count === 1 ? 'документа' : 'документов'},` : '') +
    ' для уточнения существенных параметров расчёта стоимости работ просим Вас ' +
    'предоставить разъяснения по следующим вопросам:',
    { size: 22 }
  ));
  for (const q of model.questions) {
    parts.push(docxParagraph(`${q.number}. ${q.question_topic}`, { bold: true, size: 22 }));
    parts.push(docxParagraph(q.question_text, { size: 22 }));
    if (q.why_we_ask) parts.push(docxParagraph(`Зачем нужно: ${q.why_we_ask}`, { size: 20, italic: true }));
    if (q.default_assumption) parts.push(docxParagraph(`Если не уточните: ${q.default_assumption}`, { size: 20, italic: true }));
  }
  parts.push(docxParagraph(
    `Просим направить ответ в адрес ${SENDER.org}:\n` +
    `— электронной почтой: ${model.sender_email || '—'}\n` +
    `— или письмом по адресу: ${SENDER.address}`,
    { size: 22 }
  ));
  parts.push(docxParagraph(`Срок предоставления ответа: до ${model.deadline_date_ru}.`, { size: 22 }));
  parts.push(docxParagraph(
    `С уважением,\nРуководитель проекта    ______________ /${model.sender_name || ''}/\n` +
    `Тел.: ${model.sender_phone || '—'}    E-mail: ${model.sender_email || '—'}    М.П.`,
    { size: 22 }
  ));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${parts.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
}

function renderDocx(model, outPath) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(buildDocxXml(model), 'utf8'));
  zip.writeZip(outPath);
}

// ─── PDF-рендер (pdfkit + DejaVuSans для кириллицы) ───
function renderPdf(model, outPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      const stream = fs.createWriteStream(outPath);
      doc.pipe(stream);

      const hasFont = fs.existsSync(FONT_REGULAR);
      if (hasFont) {
        doc.registerFont('ru', FONT_REGULAR);
        if (fs.existsSync(FONT_BOLD)) doc.registerFont('ru-bold', FONT_BOLD);
      }
      const F = hasFont ? 'ru' : 'Helvetica';
      const FB = hasFont && fs.existsSync(FONT_BOLD) ? 'ru-bold' : (hasFont ? 'ru' : 'Helvetica-Bold');

      doc.font(FB).fontSize(14).text(SENDER.org);
      doc.font(F).fontSize(9).text(`${SENDER.inn_kpp}\n${SENDER.address}\nТел: ${SENDER.phone}`);
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Кому: ${model.to_organization || '—'}`);
      if (model.to_person) doc.text(`Вниманию: ${model.to_person}`);
      doc.text(`Исх. № ${model.letter_number}    Дата: ${model.date_ru}`);
      doc.moveDown(0.7);
      doc.font(FB).fontSize(12).text(`Запрос на разъяснения по объекту: ${model.project_title}`, { align: 'center' });
      doc.moveDown(0.7);
      doc.font(F).fontSize(11).text(
        `Уважаемый(ая) представитель ${model.to_organization || 'заказчика'}!\n\n` +
        `В рамках подготовки коммерческого предложения по проекту «${model.project_title}» ` +
        'для уточнения существенных параметров расчёта стоимости работ просим Вас ' +
        'предоставить разъяснения по следующим вопросам:'
      );
      doc.moveDown(0.5);
      for (const q of model.questions) {
        doc.font(FB).fontSize(11).text(`${q.number}. ${q.question_topic}`);
        doc.font(F).fontSize(11).text(q.question_text);
        doc.moveDown(0.4);
      }
      doc.moveDown(0.3);
      doc.text(
        `Просим направить ответ в адрес ${SENDER.org}:\n` +
        `— электронной почтой: ${model.sender_email || '—'}\n` +
        `— или письмом по адресу: ${SENDER.address}`
      );
      doc.moveDown(0.3);
      doc.text(`Срок предоставления ответа: до ${model.deadline_date_ru}.`);
      doc.moveDown(0.7);
      doc.text(
        `С уважением,\nРуководитель проекта    ______________ /${model.sender_name || ''}/\n` +
        `Тел.: ${model.sender_phone || '—'}    E-mail: ${model.sender_email || '—'}    М.П.`
      );

      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * LEGACY: оригинальный генератор письма (adm-zip + pdfkit, ручной OOXML).
 * Сохранён как фолбэк — новая `generateClarificationLetter` использует
 * docxtemplater + единый шаблон бланка, см. ниже.
 *
 * @param {{runId:number, clarificationIds:number[], pmUserId:number}} opts
 * @returns {Promise<{letterId:number, letterNumber:string, docxPath:string, pdfPath:string, questions:Array}>}
 */
async function generateClarificationLetter_legacy({ runId, clarificationIds, pmUserId }) {
  if (!Array.isArray(clarificationIds) || !clarificationIds.length) {
    throw new Error('Не переданы id вопросов (clarification_ids)');
  }
  ensureDir();

  // 1. Загружаем открытые вопросы к заказчику
  const clars = await db.query(
    "SELECT * FROM mimir_clarifications WHERE id = ANY($1) AND channel = 'CUSTOMER' AND status = 'OPEN'",
    [clarificationIds]
  );
  if (clars.rows.length === 0) throw new Error('Нет открытых вопросов к заказчику среди переданных id');

  const { run, tender, pm, projectTitle, toOrg } = await loadLetterContext(runId, pmUserId);

  // 2. Группируем/переформулируем вопросы
  const groupedQuestions = await groupQuestionsByTopic(clars.rows);

  // 3. Номер исходящего
  const letterNumber = await nextLetterNumber();

  const model = {
    to_organization: toOrg,
    to_person: (tender && tender.tender_contact) || '',
    project_title: projectTitle,
    letter_number: letterNumber,
    date_ru: formatRuDate(new Date()),
    deadline_date_ru: formatRuDate(addDays(new Date(), 5)),
    questions: groupedQuestions,
    sender_name: (pm && pm.name) || '',
    sender_email: (pm && pm.email) || '',
    sender_phone: (pm && pm.phone) || ''
  };

  const subjectText = `Запрос на разъяснения по объекту: ${projectTitle}`;
  const bodyText = groupedQuestions
    .map((q) => `${q.number}. ${q.question_topic}\n${q.question_text}`)
    .join('\n\n');

  // 4. Запись DRAFTED
  const ins = await db.query(
    `INSERT INTO mimir_customer_letters (
        conductor_run_id, tender_id, letter_number, direction,
        subject_text, body_text, questions_ids,
        to_organization, to_person, to_email,
        status, drafted_at, reminders_sent_count
     ) VALUES ($1,$2,$3,'OUTGOING',$4,$5,$6,$7,$8,$9,'DRAFTED',NOW(),0)
     RETURNING id`,
    [
      runId, run.tender_id, letterNumber,
      subjectText, bodyText, clars.rows.map((c) => Number(c.id)),
      toOrg, model.to_person, model.sender_email
    ]
  );
  const letterId = Number(ins.rows[0].id);

  // 5. Рендер DOCX + PDF
  const docxPath = path.join(LETTERS_DIR, `${letterNumber.replace(/[\\/]/g, '_')}.docx`);
  const pdfPath = path.join(LETTERS_DIR, `${letterNumber.replace(/[\\/]/g, '_')}.pdf`);
  renderDocx(model, docxPath);
  await renderPdf(model, pdfPath);

  // 6. Сохраняем пути
  await db.query(
    'UPDATE mimir_customer_letters SET docx_path = $1, pdf_path = $2 WHERE id = $3',
    [docxPath, pdfPath, letterId]
  );

  // Событие в War Room
  try {
    await cr.addEvent(runId, null, 'letter_drafted', {
      letter_id: letterId, letter_number: letterNumber, questions_count: groupedQuestions.length
    });
  } catch (_) { /* событие не критично */ }

  return { letterId, letterNumber, docxPath, pdfPath, questions: groupedQuestions };
}

// ─── НОВЫЙ generateClarificationLetter (docxtemplater + единый бланк) ───
//
// Главная функция: собрать ВСЕ открытые вопросы (CUSTOMER channel) от runId,
// сгенерировать единое письмо клиенту через docxtemplater по шаблону
// `templates/customer-letter-tpl.docx`. Подтягивает данные pre_tender/tender,
// готовит project_intro через AI (одним коротким запросом), кладёт DOCX в
// `storage/letters/<letter_number>.docx`. Если повторный вызов с тем же runId
// без перечисления id'шников — обновляет существующее DRAFTED-письмо (overwrite).
//
// PDF: если установлен libreoffice — конвертируем `docx → pdf` через
// `libreoffice --headless --convert-to pdf`. Иначе pdf_path возвращаем null
// (UI скачает DOCX).

function _tryConvertDocxToPdf(docxAbs, outDirAbs) {
  // S-5 (2026-06-21): тело вынесено в _shared.js:convertDocxToPdf, поведение
  // идентично (тот же набор бинарей-кандидатов, тот же таймаут 60с,
  // та же логика возврата null при отсутствии libreoffice).
  return letterShared.convertDocxToPdf(docxAbs, outDirAbs);
}

/**
 * Собрать данные pre_tender для подстановки в шаблон письма.
 * tender.created_tender_id обратно связан с pre_tender — пробуем найти.
 */
async function _resolveCustomerFromRun(run, tender) {
  let preTender = null;
  let preTenderId = null;
  try {
    // 1) Явная ссылка в complexity_flags (исторически Conductor пишет туда).
    if (run && run.complexity_flags && typeof run.complexity_flags === 'object') {
      const cf = run.complexity_flags;
      const ptId = cf.pre_tender_id || cf.preTenderId || null;
      if (ptId) preTenderId = Number(ptId);
    }
    // 2) tenders.id → pre_tender_requests.created_tender_id = run.tender_id.
    if (!preTenderId && run && run.tender_id) {
      const r = await db.query(
        'SELECT id FROM pre_tender_requests WHERE created_tender_id = $1 LIMIT 1',
        [run.tender_id]
      );
      if (r.rows[0]) preTenderId = Number(r.rows[0].id);
    }
    if (preTenderId) {
      const r = await db.query(
        `SELECT id, customer_name, customer_inn, contact_person, contact_phone, customer_email,
                work_description, work_location, work_deadline
           FROM pre_tender_requests WHERE id = $1`,
        [preTenderId]
      );
      preTender = r.rows[0] || null;
    }
  } catch (e) {
    console.warn('[letter-generator] resolve pre_tender failed:', e.message);
  }

  const customer = {
    name: (preTender && preTender.customer_name)
      || (tender && (tender.customer_name || tender.customer))
      || '',
    inn: (preTender && preTender.customer_inn) || (tender && (tender.customer_inn || tender.inn)) || '',
    address: (preTender && preTender.work_location) || '',
    contact_person: (preTender && preTender.contact_person) || (tender && tender.tender_contact) || '',
    email: (preTender && preTender.customer_email) || ''
  };
  return { customer, preTender, preTenderId };
}

/** Спросить AI короткий intro-параграф для письма (2-3 предложения). */
async function _aiProjectIntro(projectTitle, docsCount, customerName) {
  try {
    if (aiProvider.isStubMode()) {
      return `В рамках подготовки коммерческого предложения по проекту «${projectTitle}» мы провели ` +
             `первичный анализ исходных данных${docsCount > 0 ? ` и ${docsCount} прикреплённых документов` : ''}. ` +
             'Для подготовки точного расчёта стоимости нам необходимо уточнить следующие вопросы:';
    }
    const result = await aiProvider.complete({
      system: 'Ты вежливый эксперт-инженер. Пишешь короткое деловое вступление к официальному письму. Никаких приветствий — только 2 предложения о контексте.',
      messages: [{ role: 'user', content:
        `Напиши 2 предложения вступления к письму клиенту с уточнениями по работам.\n` +
        `Проект: ${projectTitle}\nЗаказчик: ${customerName || '—'}\n` +
        `Документов получено: ${docsCount}\n` +
        `Финал: «...нам необходимо уточнить следующие вопросы:»`
      }],
      model: 'sonnet-4-6',
      maxTokens: 400
    });
    const txt = (result && result.text ? result.text : '').trim();
    if (txt) return txt;
  } catch (e) {
    console.warn('[letter-generator] AI intro failed:', e.message);
  }
  return `В рамках подготовки коммерческого предложения по проекту «${projectTitle}» мы провели ` +
         `первичный анализ исходных данных. Для подготовки точного расчёта стоимости нам необходимо ` +
         'уточнить следующие вопросы:';
}

/**
 * Главная функция: сформировать письмо по ВСЕМ открытым уточнениям к заказчику.
 *
 * @param {{runId:number, clarificationIds?:number[], pmUserId:number}} opts
 *   Если clarificationIds НЕ переданы — берём все OPEN по runId+CUSTOMER.
 *   При повторном вызове для того же runId — UPDATE существующего DRAFTED-письма
 *   (overwrite docx, не создаём новое).
 * @returns {Promise<{letterId, letterNumber, docxPath, pdfPath, questions}>}
 */
async function generateClarificationLetter({ runId, clarificationIds, pmUserId }) {
  ensureDir();

  // 1. Открытые вопросы (все CUSTOMER по run, если ids не переданы).
  let clarsRes;
  if (Array.isArray(clarificationIds) && clarificationIds.length) {
    clarsRes = await db.query(
      "SELECT * FROM mimir_clarifications WHERE id = ANY($1) AND channel = 'CUSTOMER' AND status = 'OPEN' ORDER BY id",
      [clarificationIds]
    );
  } else {
    clarsRes = await db.query(
      "SELECT * FROM mimir_clarifications WHERE conductor_run_id = $1 AND channel = 'CUSTOMER' AND status = 'OPEN' ORDER BY id",
      [runId]
    );
  }
  if (!clarsRes.rows.length) throw new Error('Нет открытых вопросов к заказчику для данного run');

  const { run, tender, pm, projectTitle, toOrg } = await loadLetterContext(runId, pmUserId);
  const { customer } = await _resolveCustomerFromRun(run, tender);

  // 1b. РАСШИРЕННЫЙ контекст для AI (явная просьба пользователя): берём не имена документов,
  // а реальные выдержки из их контента; пробелы ТЗ из tz_analyst; warning из final_estimate.
  let receivedDocs = [];
  try {
    const parsedArt = await cr.getArtifact(runId, 'parsed_documents');
    if (parsedArt && parsedArt.content && Array.isArray(parsedArt.content.documents)) {
      const seen = new Set();
      receivedDocs = parsedArt.content.documents
        .filter(d => { const k = d.name || ''; if (seen.has(k) || !k) return false; seen.add(k); return true; })
        .map(d => ({
          name: d.name,
          chars: d.content_chars || (d.text || '').length || 0,
          strategy: d.extraction_strategy,
          preview: (d.text || d.content || d.excerpt || '').slice(0, 1200)
        }))
        .filter(d => d.chars > 100);
    }
  } catch (_) {}

  // tz_summary.gaps — пробелы ТЗ от агента-аналитика.
  let tzGaps = [];
  try {
    const tzArt = await cr.getArtifact(runId, 'tz_summary');
    if (tzArt && tzArt.content) {
      const c = tzArt.content;
      const arr = c.gaps || c.missing_specs || c.unresolved || c.open_questions || [];
      if (Array.isArray(arr)) {
        tzGaps = arr.map(x => typeof x === 'string' ? x : (x.text || x.description || x.gap || JSON.stringify(x))).filter(Boolean);
      }
    }
  } catch (_) {}

  // ai_meta.warnings из final_estimate_data — что не удалось посчитать однозначно.
  let aiWarnings = [];
  try {
    const fed = run.final_estimate_data || {};
    const meta = fed.ai_meta || fed.meta || {};
    aiWarnings = Array.isArray(meta.warnings) ? meta.warnings.filter(Boolean) : [];
  } catch (_) {}

  // Краткий брифинг по смете (что уже посчитали — тогда AI сможет сослаться на цифры).
  let estimateBrief = '';
  try {
    const fed = run.final_estimate_data || {};
    const t = fed.totals || fed.summary || {};
    const calc = fed.calculation || {};
    const lines = [];
    if (t.total_cost) lines.push(`Себестоимость без НДС: ${Number(t.total_cost).toLocaleString('ru-RU')} руб.`);
    if (t.recommended_price) lines.push(`Рекомендуемая цена (без НДС): ${Number(t.recommended_price).toLocaleString('ru-RU')} руб.`);
    if (t.price_with_vat) lines.push(`С НДС 20 %: ${Number(t.price_with_vat).toLocaleString('ru-RU')} руб.`);
    if (calc.duration_days) lines.push(`Длительность: ${calc.duration_days} календ. дней.`);
    if (calc.crew_breakdown) lines.push(`Бригада: ${calc.crew_breakdown}.`);
    estimateBrief = lines.join(' ');
  } catch (_) {}

  // 2. Группировка/дедупликация/переформулировка через AI (gpt-5.5, расширенный контекст).
  const grouped = await groupQuestionsByTopic(clarsRes.rows, {
    runId,
    customerName: customer.name || toOrg,
    projectTitle,
    receivedDocs,
    tzGaps,
    aiWarnings,
    estimateBrief
  });
  // Сорт: blocking сверху.
  const sorted = grouped.slice().sort((a, b) => {
    const ba = a.blocking || (clarsRes.rows.find(r => r.id === a.id)?.is_blocking) ? 1 : 0;
    const bb = b.blocking || (clarsRes.rows.find(r => r.id === b.id)?.is_blocking) ? 1 : 0;
    return bb - ba;
  });
  const questions = sorted.map((q, i) => ({
    n: i + 1,
    question_topic: q.question_topic,
    question_text: q.question_text,
    why_we_ask: q.why_we_ask || 'без этого нельзя зафиксировать стоимость и сроки',
    default_assumption: q.default_assumption || 'будем исходить из стандартного варианта',
    blocking: !!q.blocking
  }));

  // 3. Документы — сколько было приложено к запросу (для intro).
  let docsCount = 0;
  try {
    if (run && run.tender_id) {
      const dr = await db.query('SELECT COUNT(*)::int AS n FROM documents WHERE tender_id = $1', [run.tender_id]);
      docsCount = dr.rows[0]?.n || 0;
    }
  } catch (_) {}

  // 4. Гендир Асгарда (из settings.company_profile) — подпись.
  const gendir = await _loadAsgardGendir();

  // 5. Dadata: ФИО гендира заказчика + полное название.
  //    Если у preTender есть customer_inn — используем; иначе — у tender; иначе — null.
  let inn = (customer && customer.inn) || (tender && (tender.customer_inn || tender.inn)) || null;
  let customerDadata = null;
  if (inn) {
    customerDadata = await _lookupCustomerByDadata(inn);
  }

  // 6. AI-intro (одним коротким запросом).
  const projectIntro = await _aiProjectIntro(projectTitle, docsCount, (customerDadata && customerDadata.name) || customer.name || toOrg);

  // 7. Reuse letter если уже есть DRAFTED по этому run.
  let letterId = null;
  let letterNumber = null;
  try {
    const ex = await db.query(
      `SELECT id, letter_number FROM mimir_customer_letters
         WHERE conductor_run_id = $1 AND status = 'DRAFTED'
         ORDER BY id DESC LIMIT 1`,
      [runId]
    );
    if (ex.rows[0]) {
      letterId = Number(ex.rows[0].id);
      letterNumber = ex.rows[0].letter_number;
    }
  } catch (_) {}

  // 8. Исходящий номер — через correspondence (единая нумерация всех ИСХ).
  //    Используем глобальный db как client (allocateOutgoingNumber берёт last_number FOR UPDATE
  //    внутри транзакции — на проде у нас один Pool, конкурента нет).
  let correspondenceAllocation = null;
  if (!letterNumber) {
    try {
      correspondenceAllocation = await correspondence.allocateOutgoingNumber(db, { date: new Date() });
      letterNumber = correspondenceAllocation.number;
    } catch (e) {
      console.warn('[letter-generator] correspondence.allocateOutgoingNumber failed:', e.message);
      letterNumber = await nextLetterNumber();
    }
  }

  // 9. Адресат и доп. поля для шаблона.
  // _ruQuote: ASCII-кавычки в названии (Dadata выдаёт «"...">> вместо «...») → русские «...».
  const _ruQ = (s) => {
    if (!s) return s;
    let str = String(s); let opening = true;
    str = str.replace(/"/g, () => { opening = !opening; return opening ? '»' : '«'; });
    if (str.includes('«') && !str.includes('»')) str = str.replace(/«([^«»]+)$/, '«$1»');
    return str;
  };
  const customerFullName = _ruQ((customerDadata && customerDadata.full_name)
    || (customerDadata && customerDadata.name)
    || customer.name || toOrg || '—');
  const recipientShort = (customerDadata && customerDadata.director_short) || '';
  const recipientNote = recipientShort
    ? '(по сведениям, размещённым в открытых источниках)'
    : '';

  // Тема закупки / лот — если есть упоминание в preTender.
  const procurementLot = (run.final_estimate_data && run.final_estimate_data.procurement_lot)
    || (tender && tender.tender_title && /л[ое]т|извещ|закупк|тендер/i.test(tender.tender_title) ? tender.tender_title : '')
    || '';

  // 10. Письмо.docx через обновлённый шаблон ГНШ.
  const docxBuf = await docGen.generateCustomerLetterDocx({
    customer: {
      name: (customerDadata && customerDadata.name) || customer.name || toOrg,
      full_name: customerFullName,
      address: (customerDadata && customerDadata.address) || customer.address,
      inn,
      recipient_name_short: recipientShort,
      recipient_note: recipientNote
    },
    project: {
      subject: projectTitle,
      object: customer.address || '',
      procurement_intro: procurementLot ? 'present' : '',
      procurement_lot: procurementLot
    },
    questions: questions.map(q => ({
      question_topic: q.question_topic,
      question_text: q.question_text,
      blocking: q.blocking
    })),
    gendir: { name: gendir.name, position: gendir.position, org: gendir.org },
    executor: {
      name: (pm && pm.name) || '',
      phone: (pm && pm.phone) || '',
      email: (pm && pm.email) || ''
    },
    projectIntro,
    projectOutro: 'Указанные пояснения позволят финализировать стоимость работ и сроки, а до получения ответа Заказчика мы будем исходить из перечисленных временных допущений.',
    letterNumber,
    documentsCount: docsCount
  });

  const safeName = String(letterNumber).replace(/[\\/]/g, '_');
  const docxPath = path.join(LETTERS_DIR, `${safeName}.docx`);
  fs.writeFileSync(docxPath, docxBuf);

  // 11. Конвертация в PDF (если есть libreoffice).
  const pdfPathTry = _tryConvertDocxToPdf(docxPath, LETTERS_DIR);
  const pdfPath = pdfPathTry || null;

  // 12. INSERT/UPDATE письма + регистрация в модуле корреспонденции.
  const subjectText = `Пояснения к ценовому предложению по объекту: ${projectTitle}`;
  const bodyText = questions.map(q => `${q.n}. ${q.question_topic}\n${q.question_text}`).join('\n\n');

  if (letterId) {
    await db.query(
      `UPDATE mimir_customer_letters
          SET subject_text = $1, body_text = $2, questions_ids = $3,
              docx_path = $4, pdf_path = $5
        WHERE id = $6`,
      [subjectText, bodyText, clarsRes.rows.map(c => Number(c.id)), docxPath, pdfPath, letterId]
    );
  } else {
    const ins = await db.query(
      `INSERT INTO mimir_customer_letters (
          conductor_run_id, tender_id, letter_number, direction,
          subject_text, body_text, questions_ids,
          to_organization, to_person, to_email,
          status, drafted_at, reminders_sent_count,
          docx_path, pdf_path
       ) VALUES ($1,$2,$3,'OUTGOING',$4,$5,$6,$7,$8,$9,'DRAFTED',NOW(),0,$10,$11)
       RETURNING id`,
      [
        runId, run.tender_id, letterNumber,
        subjectText, bodyText, clarsRes.rows.map(c => Number(c.id)),
        customerFullName, (customerDadata && customerDadata.director_full) || customer.contact_person || '',
        customer.email || ((pm && pm.email) || ''),
        docxPath, pdfPath
      ]
    );
    letterId = Number(ins.rows[0].id);
  }

  // 13. Регистрация в модуле корреспонденции (приложение — docxPath).
  try {
    const corrPayload = {
      direction: 'outgoing',
      date: new Date().toISOString().slice(0, 10),
      number: letterNumber,
      doc_type: 'letter',
      subject: subjectText,
      body: bodyText,
      counterparty: customerFullName,
      contact_person: (customerDadata && customerDadata.director_full) || '',
      note: `Авто-сгенерировано Мимиром (Conductor run #${runId})`,
      file_path: docxPath,
      status: 'draft',
      tender_id: run.tender_id || null,
      created_by: pmUserId
    };
    // Номер уже выделен этой же транзакцией allocateOutgoingNumber.
    // Если запись с этим номером уже была (повторная генерация письма) —
    // обновляем; иначе вставляем новую. Без ON CONFLICT (нет UNIQUE
    // constraint на correspondence.number).
    const existing = await db.query(
      "SELECT id FROM correspondence WHERE direction = 'outgoing' AND number = $1 LIMIT 1",
      [corrPayload.number]
    );
    if (existing.rows[0]) {
      await db.query(
        `UPDATE correspondence
            SET subject = $1, body = $2, content = $2,
                counterparty = $3, contact_person = $4,
                file_path = $5, updated_at = NOW()
          WHERE id = $6`,
        [
          corrPayload.subject, corrPayload.body,
          corrPayload.counterparty, corrPayload.contact_person,
          corrPayload.file_path, existing.rows[0].id
        ]
      );
    } else {
      await db.query(
        `INSERT INTO correspondence (
          direction, date, number, doc_type, subject, body, content,
          counterparty, contact_person, note, file_path, status,
          created_by, created_at, updated_at, tender_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $6,
          $7, $8, $9, $10, $11,
          $12, NOW(), NOW(), $13
        )`,
        [
          corrPayload.direction, corrPayload.date, corrPayload.number, corrPayload.doc_type,
          corrPayload.subject, corrPayload.body,
          corrPayload.counterparty, corrPayload.contact_person, corrPayload.note,
          corrPayload.file_path, corrPayload.status,
          corrPayload.created_by, corrPayload.tender_id
        ]
      );
    }
  } catch (e) {
    console.warn('[letter-generator] correspondence registration failed:', e.message);
  }

  // 14. Событие в War Room.
  try {
    await cr.addEvent(runId, null, 'letter_drafted', {
      letter_id: letterId, letter_number: letterNumber, questions_count: questions.length
    });
  } catch (_) {}

  return { letterId, letterNumber, docxPath, pdfPath, questions };
}

/** Получить письмо по id (с путями к файлам). */
async function getLetterById(letterId) {
  const r = await db.query('SELECT * FROM mimir_customer_letters WHERE id = $1', [Number(letterId)]);
  return r.rows[0] || null;
}

module.exports = {
  generateClarificationLetter,
  generateClarificationLetter_legacy,
  groupQuestionsByTopic,
  getLetterById,
  nextLetterNumber,
  formatRuDate,
  LETTERS_DIR
};
