'use strict';

/**
 * Разделение разбора ведомости на три роли.
 *
 * ── Почему не одна модель ──────────────────────────────────────────────────
 * Один промпт «разбери ведомость и посчитай нормы» просит от модели слишком
 * много сразу. На больших документах она «плывёт»: придумывает нормы,
 * подменяет объёмы, путает строки. Тридцать кругов правок это подтвердили.
 *
 * Здесь разбор разделён по РОЛЯМ, и каждая отвечает за одно:
 *
 *   • извлечение объёмов — прочитать строки документа и выписать объёмы
 *     КАК ЕСТЬ, ничего не считая. Правило «одна строка ВОР = одна позиция»;
 *   • сопоставление норм — по объёму и единице подобрать норму из справочника,
 *     не выдумывая;
 *   • контекст — понять тип оборудования, метод, отложения по описанию.
 *
 * Роли работают на ОДНИХ данных, поэтому склейка результатов не теряет позиции.
 */

/** Правило, которое чаще всего нарушает модель при извлечении. */
const ONE_ROW_ONE_POSITION = `
ПРАВИЛО: одна строка перечня — одна позиция.
Не объединяй несколько строк в одну позицию и не разбивай одну строку
на несколько. Если строка повторяется (например, «Замена лампы» в
разных помещениях) — это РАЗНЫЕ позиции, если у них разные объёмы
или разные примечания.
`;

/** Промпт роли извлечения объёмов. */
const VOLUME_SYSTEM = `Ты извлекаешь объёмы работ из документа.
Твоя работа — ПЕРЕПИСАТЬ строки как есть. Ты НЕ считаешь стоимость,
НЕ подбираешь нормы и НЕ оцениваешь сроки.
${ONE_ROW_ONE_POSITION}
Верни ТОЛЬКО JSON:
{
  "positions": [
    { "name": "как в документе", "volume": 100, "unit": "м3",
      "source_ref": {"document": "имя файла", "fragment": "цитата строки"} }
  ],
  "rows_seen": число строк перечня, которые ты увидел
}
Если объёма нет — volume: null. Не придумывай число.
Если перечня нет вовсе — пустой positions и rows_seen: 0.`;

/** Промпт роли сопоставления норм. */
const NORM_SYSTEM = `Ты подбираешь нормы по объёму и единице измерения.
Тебе дан перечень категорий и методов справочника.
Верни ТОЛЬКО JSON:
{
  "matches": [
    { "name": "позиция", "category_code": "из справочника или null",
      "method_code": "из справочника или null",
      "reason": "почему выбрал" }
  ]
}
ПРАВИЛО: если подходящей нормы нет — category_code: null. Не выдумывай код.
Не меняй единицу измерения: если норма в штуках, а объём в метрах, ответь null.`;

/** Промпт роли контекста. */
const CONTEXT_SYSTEM = `Ты определяешь контекст работ по описанию.
Верни ТОЛЬКО JSON:
{
  "items": [
    { "name": "позиция", "equipment_type": "теплообменник | резервуар | котёл | трубопровод | прочее",
      "fouling": "light | medium | heavy | unknown",
      "note": "что в документе это подтверждает" }
  ]
}
ПРАВИЛО: если по тексту не понять — fouling: "unknown". Не угадывай.`;

/**
 * Разбирает ответ роли и достаёт нужный массив.
 *
 * @param {object|null} parsed
 * @param {string} field — имя массива («positions», «matches», «items»)
 * @returns {Array<object>}
 */
function pickArray(parsed, field) {
  if (!parsed || typeof parsed !== 'object') return [];
  const v = parsed[field];
  return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];
}

/**
 * Объединяет результаты трёх ролей в позиции ДВ.
 *
 * Сопоставление по названию: роли видят одни строки, поэтому имя служит
 * ключом. Если роль норм или контекста не ответила, позиция остаётся с тем,
 * что дала роль объёмов: частичный результат лучше пустого.
 *
 * @param {object} p
 * @param {Array<object>} p.volumes — результат роли объёмов
 * @param {Array<object>} p.norms — результат роли норм
 * @param {Array<object>} p.context — результат роли контекста
 * @returns {Array<object>}
 */
function mergeAgents({ volumes, norms, context }) {
  const vol = Array.isArray(volumes) ? volumes : [];
  const normList = Array.isArray(norms) ? norms : [];
  const ctxList = Array.isArray(context) ? context : [];

  /** Ключ сопоставления: нормализованное имя. */
  const key = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);

  const normBy = new Map();
  for (const n of normList) normBy.set(key(n.name), n);
  const ctxBy = new Map();
  for (const c of ctxList) ctxBy.set(key(c.name), c);

  return vol.map((v) => {
    const k = key(v.name);
    const n = normBy.get(k) || {};
    const c = ctxBy.get(k) || {};
    const out = {
      name: v.name || '',
      volume: v.volume == null ? null : v.volume,
      unit: v.unit || ''
    };
    // Норма: только если она реально есть в справочнике (иначе null).
    if (n.category_code) out.category_code = n.category_code;
    if (n.method_code) out.method_code = n.method_code;
    if (n.reason) out.norm_reason = n.reason;
    // Контекст: тип оборудования и характер отложений.
    if (c.equipment_type) out.equipment_type = c.equipment_type;
    if (c.fouling) out.fouling = c.fouling;
    if (c.note) out.context_note = c.note;
    // Источник объёма — из документа, иначе из текста.
    if (v.source_ref) out.source_ref = v.source_ref;
    out.volume_source = v.source_ref ? 'vor' : 'tz';
    // Позиция без объёма или без нормы — на проверку РП, а не молча в расчёт.
    if (out.volume == null || !out.category_code) out.needs_classification = true;
    return out;
  });
}

/**
 * Проверка полноты: сколько строк перечня роль увидела и сколько отдала.
 *
 * @param {number} rowsSeen
 * @param {number} extracted
 * @returns {{complete: boolean, note: string|null}}
 */
function checkCompleteness(rowsSeen, extracted) {
  const seen = Number(rowsSeen) || 0;
  const got = Number(extracted) || 0;
  if (seen <= 0) return { complete: true, note: null };
  // Допуск 10 %: часть строк — подстроки и заголовки, они не позиции.
  if (got >= seen * 0.9) return { complete: true, note: null };
  return {
    complete: false,
    note: `Роль объёмов увидела ${seen} строк перечня, а выписала ${got}. `
      + 'Проверьте ведомость: часть позиций могла не попасть в разбор.'
  };
}

module.exports = {
  ONE_ROW_ONE_POSITION,
  VOLUME_SYSTEM,
  NORM_SYSTEM,
  CONTEXT_SYSTEM,
  pickArray,
  mergeAgents,
  checkCompleteness
};
