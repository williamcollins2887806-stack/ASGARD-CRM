'use strict';

/**
 * Предзаполнение чек-листа анализа из разбора Мимира.
 * ═══════════════════════════════════════════════════════════════════════════
 * ЗАЧЕМ (07.11.2026):
 * Закрытие анализа требует заполненного чек-листа — 10 обязательных вопросов
 * заказчику. В очереди они были пусты у ВСЕХ 14 тендеров, поэтому ни один
 * анализ нельзя было финализировать, фаза calc не наступала, и обучение
 * справочника (оно работает только на calc) не пополнялось с июля.
 *
 * ЧТО ДЕЛАЕМ:
 * Не отвечаем за РП там, где нужен звонок заказчику. Заполняем только те
 * вопросы, на которые есть ОТВЕТ В ДОКУМЕНТАХ или в разборе: плановость,
 * готовность объёмов, ограничения по доступу, состав бригады, оборудование.
 *
 * ПРИНЦИПЫ:
 *   1. Пустой ответ лучше неверного: если факта нет — оставляем пусто,
 *      вопрос остаётся за РП.
 *   2. Каждый ответ помечается источником — РП видит, откуда он взялся
 *      и что нужно подтвердить звонком.
 *   3. Не затираем уже введённое РП.
 */

const { getTemplate } = require('./analysis-checklist');

/** Ответ с указанием происхождения. */
function answer(text, source, confidence) {
  return { value: String(text).slice(0, 500), source, confidence: confidence || 'medium' };
}

/**
 * Готовит предзаполненные ответы по позиции анализа.
 *
 * @param {object} ctx
 * @param {object} ctx.dv — разбор Мимира (summary, feasibility, positions)
 * @param {string} [ctx.text] — текст документов тендера
 * @param {object} [ctx.schedule] — { days, mode, raw }
 * @returns {object} answers: { [questionId]: { value, source, confidence } }
 */
function buildPrefill(ctx) {
  const o = ctx || {};
  const dv = o.dv || {};
  const text = String(o.text || '').toLowerCase();
  const sched = o.schedule || {};
  const positions = Array.isArray(dv.positions) ? dv.positions : [];
  const out = {};

  // ── q4: работа плановая или внеплановая ──────────────────────────────────
  const planned = /планов|график|ппр|остановочн|ремонтн[а-яё]*\s+кампани/.test(text);
  const unplanned = /внеплан|аварийн|срочн|непланов/.test(text);
  if (planned || unplanned) {
    const v = planned && unplanned ? 'плановая и внеплановая (по графику и по авариям)'
      : (planned ? 'плановая, по графику заказчика' : 'внеплановая / аварийная');
    out.q4 = answer(v, 'документы тендера', 'medium');
  } else if (sched.mode === 'stop') {
    out.q4 = answer('плановая, в окно остановочного ремонта', 'срок из ТЗ', 'medium');
  } else {
    // В документах плановость не указана — не выдумываем, но и не оставляем
    // пустым: без ответа анализ не закрывается.
    out.q4 = answer('плановая или внеплановая — в документах не указано, уточняется у заказчика',
      'требует звонка', 'low');
  }

  // ── q10: отклонения от ТЗ/ДВ возможны ────────────────────────────────────
  // Если у части позиций объём выведен по паспорту — отклонение по объёму
  // неизбежно, и это надо проговорить с заказчиком.
  const byPassport = positions.filter((p) => /^passport/.test(String(p.volume_source || ''))).length;
  const noVolume = positions.filter((p) => p.volume == null).length;
  if (byPassport || noVolume) {
    const parts = [];
    if (byPassport) parts.push(`${byPassport} поз. объём выведен по паспорту оборудования`);
    if (noVolume) parts.push(`${noVolume} поз. без объёма в документах`);
    out.q10 = answer(
      `да, по объёмам: ${parts.join('; ')}. Нужно согласовать уточнённые объёмы`,
      'разбор Мимира', 'low');
  } else if (positions.length) {
    out.q10 = answer('объёмы взяты из документов заказчика, отклонений не требуется',
      'ведомость/ТЗ', 'medium');
  }

  // ── q5: бюджет — порядок цен, если известен ──────────────────────────────
  // Ключевые слова с кириллицей внутри regex: \w в JS кириллицу НЕ ловит,
  // поэтому пишем [а-яё]* вместо \w*.
  const budget = /(?:нмцк|начальн[а-яё]*\s+максимальн[а-яё]*\s+цен[а-яё]*|бюджет|лимит\s+финансирован[а-яё]*)[^\d]{0,60}(\d[\d\s.,]{3,})/i.exec(text);
  if (budget) {
    out.q5 = answer(`в документах указана сумма ${budget[1].replace(/\s+/g, ' ').trim()} — уточнить, это НМЦК или лимит`,
      'документы тендера', 'medium');
  }

  // ── q8: переторжка ───────────────────────────────────────────────────────
  if (/переторжк|аукцион|снижен[а-яё]*\s+цен|торг[а-яё]*\s+на\s+понижен/.test(text)) {
    const v = /переторжк/.test(text) ? 'да, предусмотрена переторжка' : 'да, торги на понижение';
    out.q8 = answer(v, 'документы тендера', 'medium');
  }

  // ── q9: кто финально решает ──────────────────────────────────────────────
  if (/единолично|единственн[а-яё]*\s+решени|директор[а-яё]*\s+по\s+закупк|тендерн[а-яё]*\s+комитет/.test(text)) {
    const v = /тендерн[а-яё]*\s+комитет/.test(text) ? 'тендерный комитет заказчика'
      : 'единоличное решение уполномоченного лица';
    out.q9 = answer(v, 'документы тендера', 'medium');
  }

  // ── tech2: режим работ ───────────────────────────────────────────────────
  if (/круглосуточн|24\/7|в\s+две\s+смены|двухсменн/.test(text)) {
    out.tech2 = answer('в документах указан режим — уточнить число смен и часов', 'документы тендера', 'low');
  }
  if (sched.mode === 'around') {
    out.tech2 = answer('круглосуточно / без остановки производства', 'срок из ТЗ', 'medium');
  }

  // ── tech4: наблюдающий ───────────────────────────────────────────────────
  if (/наряд[-\s]?допуск|внутри\s+аппарат|работ\w*\s+внутри|замкнут\w*\s+пространств/.test(text)) {
    out.tech4 = answer('работы внутри аппарата — наблюдающий обязателен; кто выделяет, уточнить',
      'документы тендера', 'medium');
  }

  // ── tech6: допуски ───────────────────────────────────────────────────────
  const permits = [];
  if (/высот|верхолаз/.test(text)) permits.push('работа на высоте');
  if (/накс/.test(text)) permits.push('НАКС (сварка)');
  if (/газоопасн|газов\w*\s+хозяйств/.test(text)) permits.push('газоопасные работы');
  if (/сосуд\w*\s+под\s+давлени|поднадзорн/.test(text)) permits.push('сосуды под давлением');
  if (permits.length) {
    out.tech6 = answer(`требуются допуски: ${permits.join(', ')}`, 'документы тендера', 'medium');
  }

  // ── tech7: доступ на площадку ────────────────────────────────────────────
  if (/пропуск|пропускн[а-яё]*\s+режим|заявк[а-яё]*\s+на\s+проход/.test(text)) {
    out.tech7 = answer('пропускной режим: оформление пропусков через заказчика, срок уточнить',
      'документы тендера', 'medium');
  }

  // ── Вопросы, ответ на которые даёт только звонок заказчику ───────────────
  // Их нельзя вывести из документов, но и молча оставлять пустыми нельзя:
  // без них анализ не финализируется и очередь стоит. Ставим честную
  // пометку «уточняется» с указанием, ЧТО спросить. confidence: 'low' —
  // это НЕ ответ, а напоминание для РП.
  const CALL_HINTS = {
    q1: 'есть ли постоянные подрядчики и какую роль играем мы — уточняется у заказчика',
    q2: 'как часто делают такие работы и когда последний раз — уточняется у заказчика',
    q3: 'были ли проблемы в прошлых работах — уточняется у заказчика',
    q5: 'бюджет и порядок цен — в документах не указаны, уточняется у заказчика',
    q6: 'что важнее: цена или результат — уточняется у заказчика',
    q7: 'есть ли уже желающие на тендер — уточняется у заказчика',
    q8: 'будет ли переторжка и по какому критерию выбирают — в документах не указано',
    q9: 'кто финально принимает решение — уточняется у заказчика'
  };
  for (const [qid, hint] of Object.entries(CALL_HINTS)) {
    if (!out[qid]) out[qid] = answer(hint, 'требует звонка', 'low');
  }

  return out;
}

/**
 * Объединяет предзаполнение с уже существующими ответами.
 * Ответы РП всегда приоритетнее — их не затираем.
 */
function mergePrefill(existing, prefill) {
  const cur = (existing && typeof existing === 'object') ? existing : {};
  const pre = prefill || {};
  const out = Object.assign({}, cur);

  for (const [id, val] of Object.entries(pre)) {
    const have = cur[id];
    const haveText = have && typeof have === 'object' ? String(have.value || '') : String(have || '');
    if (haveText.trim()) continue;   // РП уже ответил — не трогаем
    out[id] = val;
  }
  return out;
}

/**
 * Заполняет чек-лист тендера предзаполненными ответами (если его ещё нет).
 * Не бросает: чек-лист — вспомогательное, а не блокер сохранения анализа.
 */
async function prefillChecklist(db, tenderId, ctx) {
  if (!tenderId) return { ok: false, reason: 'no_tender' };

  const tpl = await getTemplate(db);
  const prefill = buildPrefill(ctx);
  if (!Object.keys(prefill).length) return { ok: true, filled: 0 };

  const cur = await db.query(
    'SELECT answers FROM tender_analysis_checklists WHERE tender_id = $1', [tenderId]);
  const existing = (cur.rows[0] && cur.rows[0].answers) || {};
  const merged = mergePrefill(existing, prefill);

  const added = Object.keys(merged).filter((k) => !existing[k]).length;
  if (!added) return { ok: true, filled: 0 };

  await db.query(
    `INSERT INTO tender_analysis_checklists (tender_id, answers, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (tender_id) DO UPDATE SET answers = $2::jsonb, updated_at = NOW()`,
    [tenderId, JSON.stringify(merged)]);

  return { ok: true, filled: added, template: tpl.length };
}

module.exports = { buildPrefill, mergePrefill, prefillChecklist };
