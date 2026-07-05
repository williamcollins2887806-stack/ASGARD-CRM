'use strict';

/**
 * ASGARD CRM — Мимир: быстрое ТКП (Quick TKP)
 *
 * Принимает ТЗ + историю заказчика → возвращает черновик ТКП:
 *   { chat_response_md, estimate: { subject, items[], subtotal, vat_pct, vat_sum, total_with_vat, ... } }
 *
 * Используется в POST /api/tkp-quick/sessions/:uid/calculate
 * и POST /api/tkp-quick/sessions/:uid/chat
 *
 * AP-MERGE (2026-06-19): Quick переведён на ТОТ ЖЕ промпт и пайплайн что и
 * Auto-Estimate (mimir-auto-estimate). Тот же системный prompt
 * (`buildAutoEstimatePrompt`), та же модель/провайдер (через `aiProvider.complete`),
 * та же валидация мат-расчёта (`validateAndRecomputeMath`) и тот же
 * матчинг оборудования (`resolveEquipmentFromWarehouse`). На вход в Quick
 * приходит pre_tender (а не work_id) → синтезируем минимальный `work`-объект
 * из ТЗ-текста + заказчик, документы превращаем в `ctx.documents` из OCR-вложений.
 * На выход — маппим калькуляцию (personnel/current_costs/travel/...) в
 * legacy-формат `items[]` который ждёт UI Quick.
 */

const crypto = require('crypto');
const aiProvider = require('./ai-provider');
const db = require('./db');
const mimirAutoEstimate = require('./mimir-auto-estimate');
const docGen = require('./document-generator');

// ─── Sliding-window для длинного диалога (Quick chat + Conductor) ──────────
// Юзер хочет вести переписку «очень долго» и не упираться в контекст 1M
// (1.1M токенов). Если history раздувается > MAX_HISTORY_TOKENS — обрезаем с
// начала (FIFO), оставляя последние MAX_HISTORY_TOKENS токенов. Это сохраняет
// свежий контекст (последние реплики важнее старых).
//
// Оценка: JSON.stringify(history).length / 3.5 ≈ токены (грубо, RU-текст тяжелее
// англ., но для отсечки безопасно). 500K токенов = ~1.75M chars JSON.
const MAX_HISTORY_TOKENS = parseInt(process.env.MIMIR_HISTORY_MAX_TOKENS || '500000', 10);

/**
 * Грубая оценка числа токенов в массиве сообщений диалога.
 * Используем JSON.stringify(history).length / 3.5 как нижнюю-консервативную оценку
 * (на RU тексте этот коэффициент чуть переоценивает токены — что и нужно для отсечки).
 */
function _estimateHistoryTokens(history) {
  if (!Array.isArray(history) || !history.length) return 0;
  try {
    return Math.ceil(JSON.stringify(history).length / 3.5);
  } catch (_) {
    return 0;
  }
}

/**
 * Sliding-window: если history превышает MAX_HISTORY_TOKENS — обрезаем
 * самые ранние сообщения (FIFO), оставляя последние MAX_HISTORY_TOKENS.
 * Возвращает новый массив (не мутирует входной).
 * Логирует сколько сообщений и токенов было отсечено (для аналитики).
 */
function _applySlidingWindow(history, label = 'tkp_quick') {
  if (!Array.isArray(history) || !history.length) return history || [];
  const totalTokens = _estimateHistoryTokens(history);
  if (totalTokens <= MAX_HISTORY_TOKENS) return history;

  // Откусываем с начала, пока не упрёмся в лимит. Идём с конца — берём последние
  // N сообщений, считая cumulative-tokens.
  const kept = [];
  let cum = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    let msgTokens;
    try {
      msgTokens = Math.ceil(JSON.stringify(history[i]).length / 3.5);
    } catch (_) {
      msgTokens = 0;
    }
    if (cum + msgTokens > MAX_HISTORY_TOKENS) break;
    cum += msgTokens;
    kept.unshift(history[i]);
  }

  const dropped = history.length - kept.length;
  const droppedTokens = totalTokens - cum;
  console.warn(
    `[${label}] sliding-window: total=${totalTokens} tokens (${history.length} msgs) > limit=${MAX_HISTORY_TOKENS}; ` +
    `kept last ${kept.length} msgs (~${cum} tokens), dropped ${dropped} msgs (~${droppedTokens} tokens)`
  );
  return kept;
}

/**
 * Загрузить настройки НДС из БД.
 * Совместимо со старым _loadSettings — используется в `src/routes/tkp_quick.js`.
 */
async function _loadSettings(db_) {
  const settings = { vat_pct: 20 };
  const dbi = db_ || db;
  if (!dbi) return settings;
  try {
    const r = await dbi.query("SELECT value_json FROM settings WHERE key = 'vat_default_pct'");
    if (r.rows[0]) settings.vat_pct = parseFloat(r.rows[0].value_json) || 20;
  } catch (_) {}
  return settings;
}

/**
 * Синтетический work-объект для Quick (нет реального work_id / pre_tender_id).
 * buildAutoEstimatePrompt() читает work.id / work.work_title / work.customer_name /
 * work.object_name / work.city / work.address / work.start_plan / work.end_plan
 * / work.contract_value / work.crew_size. Quick не знает большую часть этого —
 * оставляем null, prompt сам подставит '—' / 'не задан'.
 */
function _synthesizeWork({ session_uid, tz_text, customer_name }) {
  const titleSrc = String(tz_text || '').replace(/\s+/g, ' ').trim();
  const title = titleSrc ? (titleSrc.slice(0, 160) + (titleSrc.length > 160 ? '…' : '')) : 'Быстрый просчёт ТКП';
  return {
    id: 'quick-' + String(session_uid || crypto.randomBytes(4).toString('hex')).slice(0, 12),
    work_title: title,
    customer_name: customer_name || null,
    object_name: null,
    city: null,
    address: null,
    object_address: null,
    start_plan: null,
    end_plan: null,
    start_in_work_date: null,
    end_fact: null,
    contract_value: null,
    crew_size: null,
    tender_id: null
  };
}

/**
 * Превратить OCR-вложения в массив ctx.documents в формате который ждёт
 * buildAutoEstimatePrompt (см. documentsToPrompt — нужны original_name, size_kb,
 * content, content_chars).
 *
 * @param {string|Array} attachments — либо склеенный attachments_text, либо массив {filename, ocr_text}.
 */
function _attachmentsToDocs(attachments) {
  if (!attachments) return [];
  // Если передали массив — обработаем штатно
  if (Array.isArray(attachments)) {
    return attachments
      .filter(a => a && (a.ocr_text || a.content))
      .map(a => {
        const content = a.ocr_text || a.content || '';
        return {
          id: a.id || null,
          original_name: a.filename || a.original_name || 'attachment',
          mime_type: a.mime_type || null,
          size_kb: Math.max(1, Math.round((a.size || content.length) / 1024)),
          content,
          content_chars: content.length
        };
      });
  }
  // Если строка — разбираем формат "[filename]\nOCR\n\n---\n\n[filename2]\n..."
  const text = String(attachments || '').trim();
  if (!text) return [];
  const blocks = text.split(/\n\n---\n\n/);
  return blocks.map((blk, i) => {
    const m = blk.match(/^\[([^\]]+)\]\n([\s\S]*)$/);
    const filename = m ? m[1] : `attachment_${i + 1}`;
    const content = m ? m[2] : blk;
    return {
      id: null,
      original_name: filename,
      mime_type: null,
      size_kb: Math.max(1, Math.round(content.length / 1024)),
      content,
      content_chars: content.length
    };
  });
}

/**
 * Подгружает «настройки расчёта» из БД через тот же helper что Auto-Estimate
 * (НДС, ФОТ-налог, накладные, расходники, непредвиденные). Если в Quick
 * прислали свой settings.vat_pct — он перебивает значение из БД.
 */
async function _mergeCalcSettings(baseSettings) {
  let s = { ...mimirAutoEstimate.DEFAULT_SETTINGS };
  try {
    s = await mimirAutoEstimate.getCalcSettings(db);
  } catch (_) { /* fallback */ }
  if (baseSettings && typeof baseSettings === 'object') {
    if (baseSettings.vat_pct != null) s.vat_pct = Number(baseSettings.vat_pct) || s.vat_pct;
  }
  return s;
}

/**
 * Собрать ctx в точности том формате который buildAutoEstimatePrompt + valida-
 * teAndRecomputeMath + resolveEquipmentFromWarehouse ожидают.
 *
 * Для Quick:
 *   - work — синтетический (минимум полей)
 *   - tender — null (Quick не привязан к тендеру; даже если auto-создался
 *     технический tender_draft — это не реальная заявка, не подменяем)
 *   - documents — из OCR вложений
 *   - analogs — []  (Quick не привязан к work_type/work — поиск аналогов
 *     по тексту ТЗ бесполезен без типизации; AI довольствуется только историей клиента
 *     и тарифной сеткой. Это сознательное упрощение.)
 *   - customer_history — заполняется упрощённо: формат из dashboard уже
 *     встроен в session.customer_data, но buildAutoEstimatePrompt ждёт rows
 *     из mimir.customer_tender_history — у нас их нет, передаём [].
 *     История клиента всё равно идёт в extraUserMessage отдельным блоком.
 *   - warehouse — реальный getWarehouseStock(db)
 *   - workers — реальный getAvailableWorkers(db, null, null) — все активные
 *     (Quick не имеет start_plan/end_plan, значит фильтра по занятости нет)
 *   - permits — getEmployeePermitsSummary(db, fieldEmpIds)
 *   - tariffs — getTariffGrid(db)
 *   - settings — _mergeCalcSettings(opts.settings)
 *   - workType — inferWorkType(tz_text + attachments_text)
 */
async function _buildQuickCtx(opts, onProgress) {
  const {
    tz_text, customer_name, attachments_text, attachments,
    session_uid, settings: rawSettings
  } = opts;

  const safe = (step, msg) => {
    try { onProgress && onProgress({ type: 'progress', step, message: msg }); } catch (_) {}
  };

  const work = _synthesizeWork({ session_uid, tz_text, customer_name });
  const documents = _attachmentsToDocs(attachments || attachments_text);
  const workType = mimirAutoEstimate.inferWorkType(
    String(tz_text || '') + ' ' + (documents.map(d => d.original_name).join(' '))
  );

  safe('quick_ctx_start', '📦 Подгружаю склад, рабочих, тарифы…');

  // Параллельно подгружаем тяжёлые источники (как делает buildAutoEstimateContext).
  const [warehouse, workers, tariffs, settingsFromDb] = await Promise.all([
    mimirAutoEstimate.getWarehouseStock(db, onProgress).catch(() => []),
    mimirAutoEstimate.getAvailableWorkers(db, null, null, onProgress).catch(() => ({
      itr_available: [], field_available: [], itr_busy_count: 0, field_busy_count: 0,
      buckets: { total: 0, universals: 0, welders: 0, foremen: 0, insulators: 0,
                 tinsmiths: 0, assemblers: 0, masters: 0, drivers: 0, chemists: 0, other: 0 }
    })),
    mimirAutoEstimate.getTariffGrid(db, onProgress).catch(() => ({ rows: [], grouped: {} })),
    _mergeCalcSettings(rawSettings)
  ]);

  // Допуска свободных полевых — после того как мы знаем их id'шники.
  const fieldEmpIds = (workers.field_available || []).map(e => e.id).filter(x => x);
  const permits = await mimirAutoEstimate.getEmployeePermitsSummary(db, fieldEmpIds, onProgress)
    .catch(() => ({ by_type: {}, by_employee: {}, total_active: 0, employees_with_permits: 0, expiring_soon: [] }));

  return {
    work,
    tender: null,
    documents,
    linkedEstimate: null,
    workType,
    analogs: [],
    customer_history: [],
    warehouse,
    workers,
    permits,
    tariffs,
    settings: settingsFromDb
  };
}

/**
 * Сборка extraUserMessage. У Auto-Estimate ctx сам содержит весь объект работы
 * (название, заказчик, документы — всё уже в системном промпте). У Quick много
 * этого нет — поэтому докидываем в user-сообщение полный текст ТЗ +
 * формат "истории клиента" (как было в старом TKP_QUICK).
 */
function _buildQuickUserMessage(opts) {
  const { tz_text, customer_name, customer_inn, customer_data, attachments_text } = opts;

  const parts = [];
  parts.push('Это запрос быстрого ТКП (Quick). Реальной работы и тендера ещё нет, рассчитай по ТЗ из письма клиента.');
  parts.push('');

  if (customer_name || customer_inn) {
    parts.push(`Заказчик: ${customer_name || ''}${customer_inn ? ' (ИНН ' + customer_inn + ')' : ''}`);
  }

  if (customer_data) {
    const t = customer_data.tenders || {};
    const k = customer_data.tkp || {};
    const f = customer_data.finance || {};
    const tl = customer_data.traffic_light || {};
    const fmt = n => Number(n || 0).toLocaleString('ru-RU');
    parts.push('');
    parts.push('═══ ИСТОРИЯ КОНТРАГЕНТА ═══');
    parts.push(`Статус: ${tl.label || '—'} (${tl.color || 'gray'}) — ${tl.reason || ''}`);
    parts.push(`Тендеры: всего ${t.total || 0}, выиграно ${t.won || 0} (${t.conversion_pct != null ? t.conversion_pct + '%' : '—'}), в работе ${t.in_work || 0}`);
    parts.push(`Сумма выигранных: ${fmt(t.won_sum)} ₽ | В работе: ${fmt(t.in_work_sum)} ₽`);
    parts.push(`ТКП: всего ${k.total || 0}, принято ${k.accepted || 0}, отказ ${k.rejected || 0}, ожидает ${k.awaiting || 0}`);
    parts.push(`Финансы: оплачено актов ${fmt(f.acts_paid_sum)} ₽, неоплачено ${fmt(f.acts_unpaid_sum)} ₽, просроченных счетов ${f.overdue_invoices_cnt || 0}`);
  }

  if (attachments_text && String(attachments_text).trim()) {
    parts.push('');
    parts.push('═══ OCR ВЛОЖЕНИЙ (ТЗ, спецификации) ═══');
    parts.push(String(attachments_text).slice(0, 20000));
  }

  parts.push('');
  parts.push('═══ ТЕХНИЧЕСКОЕ ЗАДАНИЕ (из тела письма) ═══');
  parts.push(String(tz_text || '').trim() || '(текст ТЗ не передан — опирайся только на вложения)');

  parts.push('');
  parts.push('Сформируй просчёт по правилам из системного промпта. Верни СТРОГО JSON.');

  return parts.join('\n');
}

/**
 * Из recomputed.calculation (формат Auto-Estimate) собрать legacy `items[]`
 * который ждёт фронт Quick: { name, unit, qty, price, total }.
 *
 * Раскладываем personnel/current_costs/travel/transport/chemistry в плоский
 * список. Себестоимость = sum(items.qty*items.price) = totals.subtotal без
 * непредвиденных. Чтобы UI _calcTotals считал то же что серверный
 * totalCost — добавляем виртуальные строки «ФОТ-налог», «Накладные»,
 * «Расходные», «Непредвиденные» (qty=1, price=сумма).
 */
function _flattenCalcToItems(recomputed) {
  const items = [];
  const calc = (recomputed && recomputed.calculation) || {};
  const totals = (recomputed && recomputed.totals) || {};

  const pushPersonnel = (rows) => {
    (rows || []).forEach(r => {
      const name = r.role || r.item || r.description || 'Персонал';
      const count = Number(r.count) || 0;
      const days = Number(r.days) || 0;
      const rate = Number(r.rate_per_day) || 0;
      const qty = count * days || count || 1;
      const price = qty > 0 ? (Number(r.total) || rate * count * days) / qty : 0;
      items.push({
        name: `${name}${days ? ` (${days} см.)` : ''}`,
        unit: 'чел·смен',
        qty: qty,
        price: Math.round(price),
        total: Math.round(Number(r.total) || 0)
      });
    });
  };

  const pushFlat = (rows, defaultUnit) => {
    (rows || []).forEach(r => {
      const name = r.description || r.name || r.item || 'Позиция';
      const qty = Number(r.count) || Number(r.qty) || Number(r.volume_liters) || 1;
      const price = Number(r.price) || Number(r.unit_price) || Number(r.price_per_liter) || 0;
      const total = Number(r.total) || Number(r.amount) || qty * price;
      items.push({
        name,
        unit: r.unit || defaultUnit || 'шт',
        qty: qty,
        price: Math.round(price || (qty > 0 ? total / qty : 0)),
        total: Math.round(total)
      });
    });
  };

  pushPersonnel(calc.personnel);
  pushFlat(calc.current_costs, 'компл');
  pushFlat(calc.travel, 'чел');
  pushFlat(calc.transport, 'рейс');
  pushFlat(calc.chemistry, 'л');

  // Виртуальные строки — чтобы UI считал cost совпадающий с total_cost.
  if (totals.fot_tax > 0) {
    items.push({ name: `ФОТ-налог (${recomputed.settings?.fot_tax_pct || 55}%)`, unit: 'усл.', qty: 1, price: Math.round(totals.fot_tax), total: Math.round(totals.fot_tax) });
  }
  if (totals.overhead > 0) {
    items.push({ name: `Накладные (${recomputed.settings?.overhead_pct || 15}%)`, unit: 'усл.', qty: 1, price: Math.round(totals.overhead), total: Math.round(totals.overhead) });
  }
  if (totals.consumables > 0) {
    items.push({ name: `Расходные (${recomputed.settings?.consumables_pct || 3}%)`, unit: 'усл.', qty: 1, price: Math.round(totals.consumables), total: Math.round(totals.consumables) });
  }
  if (totals.contingency_amount > 0) {
    items.push({ name: `Непредвиденные (${totals.contingency_pct || 12}%)`, unit: 'усл.', qty: 1, price: Math.round(totals.contingency_amount), total: Math.round(totals.contingency_amount) });
  }

  return items;
}

/**
 * Собрать chat_response_md из AI-структуры (analysis + comment + totals).
 */
function _buildChatMd(ai, recomputed) {
  const lines = [];
  const est = (ai && ai.estimate) || {};
  const totals = (recomputed && recomputed.totals) || {};
  const analysis = (ai && ai.analysis) || {};

  const fmt = n => Math.round(Number(n) || 0).toLocaleString('ru-RU');

  lines.push(`### ${est.title || 'Просчёт ТКП'}`);
  if (est.comment) lines.push('\n' + est.comment);

  lines.push('');
  lines.push('**Параметры расчёта:**');
  if (est.crew_count) lines.push(`- Бригада: ${est.crew_count} чел`);
  if (est.work_days) lines.push(`- Рабочих смен: ${est.work_days} (+ дорога ${est.road_days || 0} дн×2)`);
  if (est.object_city) lines.push(`- Город объекта: ${est.object_city}${est.object_distance_km ? ` (~${est.object_distance_km} км)` : ''}`);
  if (est.markup_multiplier) lines.push(`- Наценка: ×${est.markup_multiplier}`);

  lines.push('');
  lines.push('**Финансы:**');
  lines.push(`- Себестоимость: ${fmt(totals.total_cost)} ₽`);
  lines.push(`- Цена без НДС (маржа ${totals.margin_pct || 0}%): ${fmt(totals.total_with_margin)} ₽`);
  lines.push(`- С НДС ${totals.vat_pct || 20}%: ${fmt(totals.total_with_vat)} ₽`);

  if (analysis.markup_reasoning) {
    lines.push('');
    lines.push(`**Обоснование наценки:** ${analysis.markup_reasoning}`);
  }

  if (Array.isArray(analysis.warnings) && analysis.warnings.length) {
    lines.push('');
    lines.push('**Предупреждения:**');
    analysis.warnings.slice(0, 6).forEach(w => {
      const icon = w.level === 'critical' ? '🔴' : (w.level === 'warning' ? '🟡' : 'ℹ️');
      lines.push(`- ${icon} ${w.title ? '**' + w.title + '**: ' : ''}${w.text || ''}`);
    });
  }

  const notes = ai && ai.mimir_notes;
  if (notes && Array.isArray(notes.client_questions) && notes.client_questions.length) {
    lines.push('');
    lines.push('**Вопросы клиенту:**');
    notes.client_questions.slice(0, 5).forEach(q => lines.push(`- ${q}`));
  }

  return lines.join('\n');
}

/**
 * Собрать legacy estimate-объект который ждёт UI Quick из recomputed +
 * ai.estimate. Сохраняем оба «диалекта» (items + дополнительные поля).
 */
function _composeLegacyEstimate(ai, recomputed) {
  const est = (ai && ai.estimate) || {};
  const totals = (recomputed && recomputed.totals) || {};
  const items = _flattenCalcToItems(recomputed);

  const subtotal = Math.round(Number(totals.total_cost) || 0);
  const totalWithoutVat = Math.round(Number(totals.total_with_margin) || subtotal);
  const totalWithVat = Math.round(Number(totals.total_with_vat) || totalWithoutVat);
  const vatPct = Number(totals.vat_pct) || 20;
  const vatSum = totalWithVat - totalWithoutVat;

  return {
    // Legacy-формат для UI
    subject: est.title || 'Просчёт ТКП',
    work_description: est.comment || '',
    items,
    subtotal,
    total_without_vat: totalWithoutVat,
    vat_pct: vatPct,
    vat_sum: vatSum,
    total_with_vat: totalWithVat,
    deadline: (est.work_days && est.road_days != null)
      ? `${est.work_days} рабочих смен + ${est.road_days * 2} дн дороги`
      : 'По согласованию',
    payment_terms: 'Аванс 50%, остаток по подписании акта',
    notes: '',
    validity_days: 30,
    // Полный AI-объект — чтобы можно было собрать ТКП-черновик / отладить
    ai_meta: {
      estimate: est,
      calculation: recomputed && recomputed.calculation,
      totals,
      equipment_status: ai && ai.equipment_status,
      permits_status: ai && ai.permits_status,
      route_plan: ai && ai.route_plan,
      mimir_notes: ai && ai.mimir_notes,
      analysis: ai && ai.analysis
    }
  };
}

/**
 * Сгенерировать 3 артефакта (смета.xlsx + отчёт.docx + опц. письмо.docx) и
 * сохранить их в pre_tender_requests.manual_documents / tenders.manual_documents.
 *
 * @param {object} ctx
 *   .recomputed     — результат validateAndRecomputeMath (calculation/totals/settings).
 *   .ai             — оригинальный AI-объект (analysis/estimate).
 *   .pre_tender_id  — id записи pre_tender_requests (опц).
 *   .tender_id      — id записи tenders (опц, если pre_tender_id не задан).
 *   .customer_name, .customer_inn
 * @returns {Promise<Array<{kind,filename,file_path}>>}
 */
async function _generateAndSaveQuickDocs({ recomputed, ai, pre_tender_id, tender_id, customer_name, customer_inn, author_id, work_type }) {
  if (!pre_tender_id && !tender_id) {
    console.warn('[mimir-tkp-quick] _generateAndSaveQuickDocs: ни pre_tender_id, ни tender_id не переданы — пропускаю генерацию документов');
    return [];
  }

  // 1. Соберём project + customer из БД (если есть pre_tender).
  let project = {
    subject: (ai && ai.estimate && ai.estimate.title) || 'Просчёт ТКП',
    object: null,
    deadline: null
  };
  let customer = {
    name: customer_name || null,
    inn: customer_inn || null,
    address: null,
    contact_person: null
  };

  // 1a. PM-автор (для блока «Контакты для уточнений» в смете + подпись отчёта).
  let pmUser = null;
  try {
    if (author_id) {
      const u = await db.query(
        `SELECT id, name, phone, email, role FROM users WHERE id = $1`,
        [author_id]
      );
      pmUser = u.rows[0] || null;
    } else if (pre_tender_id) {
      // fallback: РП заявки (assigned_to) или, если не назначен, создатель (created_by).
      // Колонки pt.author_id НЕТ — это бага из старого кода; реальные — assigned_to + created_by.
      const u = await db.query(
        `SELECT u.id, u.name, u.phone, u.email, u.role
           FROM pre_tender_requests pt
           JOIN users u ON u.id = COALESCE(pt.assigned_to, pt.created_by)
          WHERE pt.id = $1`,
        [pre_tender_id]
      );
      pmUser = u.rows[0] || null;
    } else if (tender_id) {
      // fallback: автор tender (если просчёт без pre_tender)
      const u = await db.query(
        `SELECT u.id, u.name, u.phone, u.email, u.role
           FROM tenders t
           JOIN users u ON u.id = COALESCE(t.assigned_to, t.created_by)
          WHERE t.id = $1`,
        [tender_id]
      );
      pmUser = u.rows[0] || null;
    }
  } catch (e) {
    console.warn('[mimir-tkp-quick] не удалось подгрузить pmUser:', e.message);
  }

  try {
    if (pre_tender_id) {
      const r = await db.query(
        `SELECT customer_name, customer_inn, contact_person, work_description, work_location, work_deadline
           FROM pre_tender_requests WHERE id = $1`,
        [pre_tender_id]
      );
      if (r.rows[0]) {
        const pt = r.rows[0];
        customer.name = customer.name || pt.customer_name;
        customer.inn = customer.inn || pt.customer_inn;
        customer.address = pt.work_location || null;
        customer.contact_person = pt.contact_person || null;
        project.subject = pt.work_description || project.subject;
        project.object = pt.work_location || null;
        project.deadline = pt.work_deadline ? new Date(pt.work_deadline).toLocaleDateString('ru-RU') : null;
      }
    } else if (tender_id) {
      const r = await db.query(
        `SELECT customer_name, customer_inn, tender_contact, tender_title
           FROM tenders WHERE id = $1`,
        [tender_id]
      );
      if (r.rows[0]) {
        const t = r.rows[0];
        customer.name = customer.name || t.customer_name;
        customer.inn = customer.inn || t.customer_inn;
        customer.contact_person = t.tender_contact || null;
        project.subject = t.tender_title || project.subject;
      }
    }
  } catch (e) {
    console.warn('[mimir-tkp-quick] _generateAndSaveQuickDocs: не удалось подгрузить данные сущности:', e.message);
  }

  // 2. Параллельно генерируем артефакты.
  const generatedAt = new Date();
  const stamp = `${generatedAt.getFullYear()}${String(generatedAt.getMonth() + 1).padStart(2, '0')}${String(generatedAt.getDate()).padStart(2, '0')}_${String(generatedAt.getHours()).padStart(2, '0')}${String(generatedAt.getMinutes()).padStart(2, '0')}`;

  // 1b. Категория работ + assumptions/warnings для opts.
  //     site_category — если AI его явно вернул (recomputed.estimate.site_category);
  //     иначе inferWorkType по ТЗ-тексту/work_type, иначе 'ground' (нейтральный дефолт).
  const aiSiteCat = recomputed?.estimate?.site_category;
  const aiAnalysis = (recomputed && recomputed.analysis)
    || (ai && ai.analysis)
    || {};
  const workCategory = aiSiteCat || work_type || 'ground';
  const assumptions = Array.isArray(aiAnalysis.assumptions) ? aiAnalysis.assumptions.filter(Boolean) : [];
  const warnings = Array.isArray(aiAnalysis.warnings) ? aiAnalysis.warnings : [];

  // ВАЖНО: warnings/assumptions НЕ дублируем в opts — они уже в analysis,
  // который передаётся 4-м аргументом в generateDirectorReportDocx и подхватывается
  // через estimate.analysis в generateSmetaXlsx. Дубль раньше давал 8 пунктов
  // вместо 4 в разделе «Риски и допущения». Опус-фикс 19.06.2026.
  const opts = {
    author: pmUser ? {
      name: pmUser.name || '—',
      phone: pmUser.phone || '',
      email: pmUser.email || ''
    } : undefined,
    workCategory
  };

  let xlsxBuf, docxBuf;
  try {
    [xlsxBuf, docxBuf] = await Promise.all([
      docGen.generateSmetaXlsx(recomputed, project, customer, opts),
      docGen.generateDirectorReportDocx(recomputed, project, customer, ai && ai.analysis, opts)
    ]);
  } catch (e) {
    console.error('[mimir-tkp-quick] генерация документов сломалась:', e.message);
    return [];
  }

  const docs = [
    { filename: `smeta_${stamp}.xlsx`, buffer: xlsxBuf, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'mimir_smeta' },
    { filename: `director_report_${stamp}.docx`, buffer: docxBuf, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'mimir_director_report' }
  ];

  const entityKind = pre_tender_id ? 'pre_tender' : 'tender';
  const entityId = pre_tender_id || tender_id;
  try {
    const { saved } = await docGen.saveDocumentsForEntity(entityKind, entityId, docs);
    return saved.map(d => ({ kind: d.kind, filename: d.filename, file_path: d.file_path, size: d.size }));
  } catch (e) {
    console.error(`[mimir-tkp-quick] saveDocumentsForEntity(${entityKind}#${entityId}) failed:`, e.message);
    return [];
  }
}

/**
 * Основной вызов: генерация черновика ТКП через AI.
 *
 * @param {object} opts
 * @param {string} opts.tz_text
 * @param {string} [opts.customer_inn]
 * @param {string} [opts.customer_name]
 * @param {object} [opts.customer_data]
 * @param {string} [opts.attachments_text]
 * @param {Array}  [opts.attachments]
 * @param {string} [opts.session_uid]
 * @param {Array}  [opts.history]
 * @param {object} [opts.settings]
 * @param {Function} [opts.onProgress]
 * @returns {Promise<{chat_response_md, estimate, diagnostics}>}
 */
async function generateEstimate(opts) {
  const {
    tz_text, customer_inn, customer_name,
    customer_data, attachments_text, attachments,
    session_uid, history: rawHistory = [], settings, onProgress = () => {},
    pre_tender_id, tender_id, author_id
  } = opts;

  // Sliding-window: если переписка раздулась > MAX_HISTORY_TOKENS — обрезаем
  // самые старые реплики (FIFO), оставляя последние MAX_HISTORY_TOKENS токенов.
  const history = _applySlidingWindow(rawHistory, `tkp_quick:${session_uid || 'no-uid'}`);

  onProgress({ type: 'status', message: '🧠 Мимир анализирует ТЗ и подгружает данные компании…' });

  // 1. Собрать ctx в формате Auto-Estimate (склад/рабочие/тарифы/допуска/настройки).
  const ctx = await _buildQuickCtx({
    tz_text, customer_name, attachments_text, attachments,
    session_uid, settings
  }, onProgress);

  // 2. Кэш — детерминированный по системному промпту + user-сообщению.
  //    Если тот же ТЗ → возвращаем сохранённый estimate.
  const userMessage = _buildQuickUserMessage({
    tz_text, customer_name, customer_inn, customer_data, attachments_text
  });
  const systemPrompt = mimirAutoEstimate.buildAutoEstimatePrompt(ctx);

  // history в Quick встраивается в extraUserMessage — мы не пишем agent-loop с web,
  // у Auto-Estimate его тоже нет (только aiProvider.complete). Если history передан
  // в continueChat — склеиваем диалог в один user-message.
  //
  // 21.06.2026: КРИТИЧНАЯ ПРАВКА. Раньше AI после простой правки маржи переписывал
  // смету ПОЛНОСТЬЮ с нуля (cost падал в 150 раз). Теперь явно передаём текущую
  // смету (baseline) + инструкцию «изменяй только то что просит пользователь, остальное
  // оставь как есть». Извлекаем последний estimate из history (latest assistant).
  let baselineEstimate = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') {
      const m = String(history[i].content || '').match(/```json\s*([\s\S]*?)\s*```/);
      if (m) { try { baselineEstimate = JSON.parse(m[1]); break; } catch (_) {} }
    }
  }
  const dialogMessage = history.length
    ? [
        '═══ ЗАПРОС ПОЛЬЗОВАТЕЛЯ ═══',
        userMessage,
        '',
        ...(baselineEstimate ? [
          '═══ ТЕКУЩАЯ СМЕТА (BASELINE — правки применять относительно этой версии) ═══',
          '```json',
          JSON.stringify(baselineEstimate, null, 2).slice(0, 12000),
          '```',
          '',
          '⚠️ ВАЖНО (инструкция для Мимира):',
          '  • Измени ТОЛЬКО то, что просит пользователь (маржу, наценку, конкретные позиции и т.п.).',
          '  • Все остальные позиции, объёмы, цены, бригаду, режим работы, теплоноситель — СОХРАНИ В ТОЧНОСТИ как в BASELINE.',
          '  • НЕ пересчитывай смету с нуля. НЕ меняй total_cost, ФОТ, материалы, командировочные если пользователь об этом не просил.',
          '  • Если просят «маржу 30%» — поставь margin_pct=30 и пересчитай total_with_margin/total_with_vat от текущего total_cost.',
          '  • Если просят «наценку ×2.5» — поставь markup_multiplier=2.5 (margin_pct=150) и пересчитай.',
          '  • Если просят правку в позиции (например «добавь рейс») — добавь строку, остальное не трогай.',
          ''
        ] : []),
        '═══ ИСТОРИЯ ДИАЛОГА (последние реплики PM ↔ Мимир) ═══',
        ...history.map(m => `[${m.role}]: ${String(m.content || '').slice(0, 6000)}`)
      ].join('\n')
    : userMessage;

  const cacheKey = crypto.createHash('sha256').update(
    systemPrompt + '\n#MSG#\n' + dialogMessage
  ).digest('hex');

  try {
    const cached = await db.query(
      "SELECT output_text FROM mimir_ai_cache WHERE input_hash=$1 AND agent_name='tkp_quick' LIMIT 1",
      [cacheKey]
    );
    if (cached.rows[0]) {
      onProgress({ type: 'status', message: '💾 Расчёт из кэша (детерминированно)' });
      await db.query(
        "UPDATE mimir_ai_cache SET hit_count=hit_count+1, last_used_at=NOW() WHERE input_hash=$1",
        [cacheKey]
      ).catch(() => {});
      try { return JSON.parse(cached.rows[0].output_text); } catch (_) { /* кэш битый — игнор */ }
    }
  } catch (_) { /* нет таблицы — игнор */ }

  // 3. Вызов AI — ровно как в Auto-Estimate (тот же systemPrompt, тот же
  //    парсер, тот же recompute, тот же matching склада).
  onProgress({ type: 'status', message: '🧠 Запрашиваю расчёт у Мимир-Sonnet…' });

  const aiCall = await mimirAutoEstimate.callMimirForEstimate(aiProvider, ctx, dialogMessage);

  // 4. Маппинг в legacy-формат Quick.
  const estimate = _composeLegacyEstimate(aiCall.ai, aiCall.recomputed);
  const chatMd = _buildChatMd(aiCall.ai, aiCall.recomputed);

  // 4a. 21.06.2026 ИЗМЕНЕНИЕ: больше НЕ сохраняем xlsx/docx в pre_tender_requests
  // на КАЖДОЙ chat-правке. Сохранение только при finalize endpoint (кнопка
  // «✓ Сохранить в карточку» в UI). Промежуточные правки → только estimate_draft
  // в сессии. Документы предпросматриваются на лету через
  // GET /sessions/:uid/preview-doc/:kind (генерация в память).
  const generatedDocs = [];

  const payload = {
    chat_response_md: chatMd,
    estimate,
    docs: generatedDocs,
    diagnostics: {
      model: aiCall.model,
      provider: aiCall.provider,
      tokens: aiCall.tokens,
      duration_ms: aiCall.duration_ms
    }
  };

  // 5. Кэш.
  try {
    await db.query(
      `INSERT INTO mimir_ai_cache (input_hash, model, agent_name, output_text, output_usage)
       VALUES ($1, $2, 'tkp_quick', $3, $4)
       ON CONFLICT (input_hash) DO NOTHING`,
      [cacheKey, aiCall.model || 'unknown', JSON.stringify(payload), aiCall.tokens || null]
    );
  } catch (_) { /* игнор */ }

  return payload;
}

/**
 * Продолжение диалога (для /chat endpoint).
 * Полностью аналогично generateEstimate, history передаётся как часть user-message
 * (callMimirForEstimate принимает один extraUserMessage, поэтому склеиваем).
 */
async function continueChat(opts) {
  // 21.06.2026: Quick AI на «маржу X%» / «наценку ×Y» пересчитывает смету с нуля
  // (cost → 0). Перехватываем простые числовые правки regex'ом и применяем direct
  // к baseline (последнему estimate из history). AI вызывается только для сложных
  // запросов (правка текста, добавление позиции, изменение состава работ).
  const message = String(opts.tz_text || '').trim();
  const history = Array.isArray(opts.history) ? opts.history : [];

  // Извлечь baseline estimate из истории (последний assistant с ```json```).
  let baseline = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') {
      const m = String(history[i].content || '').match(/```json\s*([\s\S]*?)\s*```/);
      if (m) { try { baseline = JSON.parse(m[1]); break; } catch (_) {} }
    }
  }

  if (baseline && baseline.ai_meta && baseline.ai_meta.totals) {
    const totals = JSON.parse(JSON.stringify(baseline.ai_meta.totals));
    let applied = [];

    // «маржу 30%» / «маржу сделай 30 процентов» / «маржа = 30»
    const mMargin = message.match(/маржу?\s*(?:сделай|поставь|измени|=)?\s*(?:на\s+)?(\d+(?:[.,]\d+)?)\s*(?:%|процент)/i);
    if (mMargin) {
      const pct = Number(mMargin[1].replace(',', '.'));
      totals.margin_pct = pct;
      totals.markup_multiplier = +(1 + pct / 100).toFixed(3);
      applied.push(`margin_pct=${pct}%`);
    }
    // «наценку ×2.5» / «наценка 2.2»
    const mMarkup = message.match(/наценк[ауи]?\s*(?:сделай|поставь|измени|=)?\s*(?:на\s+)?[×x]?\s*(\d+(?:[.,]\d+)?)/i);
    if (mMarkup && !mMargin) {
      const k = Number(mMarkup[1].replace(',', '.'));
      if (k > 0.5 && k < 10) {
        totals.markup_multiplier = k;
        totals.margin_pct = +((k - 1) * 100).toFixed(1);
        applied.push(`markup=${k}`);
      }
    }
    // НДС
    const mVat = message.match(/НДС\s*(?:сделай|поставь|измени|=)?\s*(?:на\s+)?(\d+(?:[.,]\d+)?)\s*(?:%|процент)/i);
    if (mVat) {
      totals.vat_pct = Number(mVat[1].replace(',', '.'));
      applied.push(`vat=${totals.vat_pct}%`);
    }

    if (applied.length) {
      const cost = Number(totals.total_cost) || 0;
      const vat = Number(totals.vat_pct) || 22;
      totals.total_with_margin = +(cost * (totals.markup_multiplier || 2.2)).toFixed(2);
      totals.total_with_vat = +(totals.total_with_margin * (1 + vat / 100)).toFixed(2);

      const newEstimate = JSON.parse(JSON.stringify(baseline));
      newEstimate.ai_meta.totals = totals;
      // КРИТИЧНО: дублируем markup в ai_meta.estimate (generator берёт его первым).
      if (newEstimate.ai_meta.estimate) {
        newEstimate.ai_meta.estimate.markup_multiplier = totals.markup_multiplier;
        if (typeof totals.material_markup !== 'undefined') {
          newEstimate.ai_meta.estimate.material_markup = totals.material_markup;
        }
        if (typeof totals.vat_pct !== 'undefined') {
          newEstimate.ai_meta.estimate.vat_pct = totals.vat_pct;
        }
      }
      // Сбрасываем кэш summary/section2 — будут пересозданы Generator'ом.
      if (newEstimate.ai_meta.analysis) {
        newEstimate.ai_meta.analysis.summary = null;
        newEstimate.ai_meta.analysis.section_2_text = null;
      }

      const responseMd = `✓ Применил прямую правку: ${applied.join(', ')}.\n\n` +
        `Себестоимость осталась ${(cost / 1e6).toFixed(2)} млн ₽ без НДС.\n` +
        `Новая цена с НДС: ${(totals.total_with_vat / 1e6).toFixed(2)} млн ₽ (наценка ×${totals.markup_multiplier}).`;

      return {
        chat_response_md: responseMd,
        estimate: newEstimate,
        docs: [],
        diagnostics: { mode: 'direct-edit', applied }
      };
    }
  }

  // Для сложных правок — обычный AI flow.
  return generateEstimate(opts);
}

// Helper: _ruQuote → ASCII " на русские «»; _isAutoTender → фильтр тестовых названий.
function _ruQuote(s) {
  if (!s) return s;
  let str = String(s); let opening = true;
  str = str.replace(/"/g, () => { opening = !opening; return opening ? '»' : '«'; });
  if (str.includes('«') && !str.includes('»')) str = str.replace(/«([^«»]+)$/, '«$1»');
  return str;
}
function _isAutoTender(s) { return /^auto[-\s]?tender\b|\bpt-\d+\b/i.test(String(s || '')); }

// Распределение crew_count → itr/foremen/workers/observers (типовое для Асгарда).
function _splitCrew(crew, shifts) {
  const total = Number(crew) || 0;
  if (total <= 0) return { itr: 1, foremen: 0, workers: 0, observers: 0 };
  // Базовая схема: 1 ИТР + мастера + рабочие.
  // shift=1 → 1 мастер; shift>=2 → 2 мастера. Наблюдающие = 0 если не задано.
  const itr = 1;
  const foremen = shifts >= 2 ? Math.min(2, total - itr) : 1;
  const remaining = Math.max(0, total - itr - foremen);
  const workers = remaining;
  return { itr, foremen, workers, observers: 0 };
}

// Подготовка recomputed + project + customer перед docgen. Применяется и в preview, и в save.
async function _prepareForGenerator({ estimate_draft, pre_tender_id, tender_id, customer_name, customer_inn, author_id, work_type }) {
  const recomputed = (estimate_draft.ai_meta && {
    ...estimate_draft.ai_meta,
    estimate: { ...(estimate_draft.ai_meta.estimate || {}) },
    calculation: { ...(estimate_draft.ai_meta.calculation || {}) },
    totals: { ...(estimate_draft.ai_meta.totals || {}) },
    analysis: { ...(estimate_draft.ai_meta.analysis || {}) }
  }) || estimate_draft;

  // Enrichment бригады: ai_meta.estimate имеет crew_count, но НЕ имеет foremen/workers/observers
  // — generator пишет «0 мастеров, 0 рабочих». Распределяем сами.
  const est = recomputed.estimate;
  if (!est.foremen_count && !est.workers_count && est.crew_count) {
    const split = _splitCrew(est.crew_count, est.shifts_per_day || (est.shift_mode === '24/7' ? 2 : 1));
    est.itr_count = est.itr_count || split.itr;
    est.foremen_count = split.foremen;
    est.workers_count = split.workers;
    est.observers_count = split.observers;
  }

  // Подгружаем customer/project из pre_tender_requests или tenders
  const customer = { name: customer_name || '', inn: customer_inn || '' };
  let project = { subject: 'Просчёт через Мимира' };
  try {
    if (pre_tender_id) {
      const r = await db.query(
        `SELECT customer_name, customer_inn, contact_person, work_description, work_location, work_deadline
           FROM pre_tender_requests WHERE id = $1`,
        [pre_tender_id]
      );
      if (r.rows[0]) {
        const pt = r.rows[0];
        customer.name = customer.name || pt.customer_name;
        customer.inn = customer.inn || pt.customer_inn;
        customer.address = pt.work_location || null;
        customer.contact_person = pt.contact_person || null;
        project.subject = pt.work_description || project.subject;
        project.object = pt.work_location || null;
        project.deadline = pt.work_deadline ? new Date(pt.work_deadline).toLocaleDateString('ru-RU') : null;
      }
    } else if (tender_id) {
      const r = await db.query(
        `SELECT customer_name, customer_inn, tender_contact, tender_title
           FROM tenders WHERE id = $1`, [tender_id]);
      if (r.rows[0]) {
        const t = r.rows[0];
        customer.name = customer.name || t.customer_name;
        customer.inn = customer.inn || t.customer_inn;
        customer.contact_person = t.tender_contact || null;
        // Tender_title часто «Auto-tender для pt-N» — фильтруем.
        if (t.tender_title && !_isAutoTender(t.tender_title)) project.subject = t.tender_title;
      }
    }
  } catch (e) {
    console.warn('[mimir-tkp-quick] _prepareForGenerator load entity failed:', e.message);
  }

  // Из ai_meta.estimate.title если есть — приоритет (это AI-генерируемое name).
  if (est.title && !_isAutoTender(est.title)) project.subject = est.title;

  // Применяем _ruQuote к customer и project
  customer.name = _ruQuote(customer.name);
  project.subject = _ruQuote(project.subject);
  project.title = _ruQuote(project.title || project.subject);

  // Чистим analysis от stale-фраз
  const _staleRe = /(\b0\s*₽|:\s*0\b|=\s*0\b|равен\s+0|не\s+(выпускать|подавать)|эвристически|standby_reserve|ФОТ\s+не\s+(посчитан|рассчитан|дал)|нулев(ая|ой|ыми|ую)|обнулен|(до|перед|после)\s+пересч\w*|агрегаци.*ССР|консолидаци.*ССР|логистика\s+заблокирована|расходники\s+заблокирован|не\s+попал.*ССР|восстановить\s+(расч[её]т|ФОТ)|заполнить\s+(нормы|стоимост|цен)|ресурсная\s+ведомость\s+пуста|не\s+распарсилось|Request\s+error|не\s+предоставлен)/i;
  const _flat = (w) => (typeof w === 'string' ? w : String((w && (w.text || w.message || w.title)) || ''));
  const _filter = (arr) => Array.isArray(arr) ? arr.filter(w => { const t = _flat(w); return t && !_staleRe.test(t); }) : [];
  if (recomputed.analysis) {
    recomputed.analysis.warnings = _filter(recomputed.analysis.warnings);
    recomputed.analysis.recommendations = _filter(recomputed.analysis.recommendations);
    // Если summary содержит «×2,2» а реальный markup другой — сбросить, AI пересоздаст.
    if (recomputed.analysis.summary && /×\s*2[.,]2/.test(recomputed.analysis.summary)
        && Math.abs((recomputed.totals.markup_multiplier || 2.2) - 2.2) > 0.05) {
      recomputed.analysis.summary = null;
    }
  }

  let pmUser = null;
  if (author_id) {
    try {
      const r = await db.query('SELECT id, name, phone, email FROM users WHERE id = $1', [author_id]);
      pmUser = r.rows[0] || null;
    } catch (_) {}
  }

  return { recomputed, project, customer, pmUser };
}

// Buffer-only генерация документов (для preview): возвращает {xlsxBuf, docxBuf, recomputed}
// БЕЗ сохранения в pre_tender_requests. Используется в /sessions/:uid/preview-doc.
async function generatePreviewBuffers({ estimate_draft, pre_tender_id, tender_id, customer_name, customer_inn, author_id, work_type }) {
  if (!estimate_draft) throw new Error('Нет estimate_draft для генерации превью');
  const docGen = require('./document-generator');
  const { recomputed, project, customer, pmUser } = await _prepareForGenerator({
    estimate_draft, pre_tender_id, tender_id, customer_name, customer_inn, author_id, work_type
  });

  const opts = {
    author: pmUser ? { name: pmUser.name || '—', phone: pmUser.phone || '', email: pmUser.email || '' } : undefined,
    workCategory: work_type || (estimate_draft.ai_meta && estimate_draft.ai_meta.estimate && estimate_draft.ai_meta.estimate.site_category) || 'ground'
  };

  const [xlsxBuf, docxBuf] = await Promise.all([
    docGen.generateSmetaXlsx(recomputed, project, customer, opts),
    docGen.generateDirectorReportDocx(recomputed, project, customer, recomputed.analysis, opts)
  ]);
  return { xlsxBuf, docxBuf, recomputed, project, customer };
}

// Сохранение docs в pre_tender_requests.manual_documents — вызывается при finalize
// и /save-to-card. Использует тот же _prepareForGenerator что и preview-doc, поэтому
// числа, бригада, кавычки и фильтр stale-warnings одинаковые в превью и в сохранённом.
async function saveDocsToCard({ estimate_draft, pre_tender_id, tender_id, customer_name, customer_inn, author_id, work_type }) {
  if (!pre_tender_id && !tender_id) return [];
  const docGen = require('./document-generator');
  const { recomputed, project, customer, pmUser } = await _prepareForGenerator({
    estimate_draft, pre_tender_id, tender_id, customer_name, customer_inn, author_id, work_type
  });
  const opts = {
    author: pmUser ? { name: pmUser.name || '—', phone: pmUser.phone || '', email: pmUser.email || '' } : undefined,
    workCategory: work_type || (estimate_draft.ai_meta && estimate_draft.ai_meta.estimate && estimate_draft.ai_meta.estimate.site_category) || 'ground'
  };
  let xlsxBuf, docxBuf;
  try {
    [xlsxBuf, docxBuf] = await Promise.all([
      docGen.generateSmetaXlsx(recomputed, project, customer, opts),
      docGen.generateDirectorReportDocx(recomputed, project, customer, recomputed.analysis, opts)
    ]);
  } catch (e) {
    console.error('[mimir-tkp-quick] saveDocsToCard: генерация сорвалась:', e.message);
    return [];
  }
  const generatedAt = new Date();
  const stamp = `${generatedAt.getFullYear()}${String(generatedAt.getMonth() + 1).padStart(2, '0')}${String(generatedAt.getDate()).padStart(2, '0')}_${String(generatedAt.getHours()).padStart(2, '0')}${String(generatedAt.getMinutes()).padStart(2, '0')}`;
  const docs = [
    { filename: `smeta_${stamp}.xlsx`, buffer: xlsxBuf, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'mimir_smeta' },
    { filename: `director_report_${stamp}.docx`, buffer: docxBuf, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'mimir_director_report' }
  ];
  const entityKind = pre_tender_id ? 'pre_tender' : 'tender';
  const entityId = pre_tender_id || tender_id;
  try {
    const { saved } = await docGen.saveDocumentsForEntity(entityKind, entityId, docs);
    return saved.map(d => ({ kind: d.kind, filename: d.filename, file_path: d.file_path, size: d.size }));
  } catch (e) {
    console.error(`[mimir-tkp-quick] saveDocumentsForEntity(${entityKind}#${entityId}) failed:`, e.message);
    return [];
  }
}

module.exports = {
  generateEstimate,
  continueChat,
  _loadSettings,
  // Sliding-window helpers (reusable Conductor / другие чат-сервисы)
  _applySlidingWindow,
  _estimateHistoryTokens,
  MAX_HISTORY_TOKENS,
  // 21.06.2026: preview + save
  generatePreviewBuffers,
  saveDocsToCard
};
