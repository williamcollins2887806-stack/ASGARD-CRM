/**
 * analysis-checklist.js — чек-лист анализа тендера (D-203).
 *
 * Порядок работы, который закрепляет чек-лист (как в задаче):
 *   1) прочитать ТЗ (файлы тендера рядом во вкладке «Чек-лист»);
 *   2) изучить компанию-заказчика;
 *   3) выписать свои вопросы;
 *   4) позвонить клиенту и заполнить базовые вопросы;
 *   5) сохранить чек-лист — он остаётся в карточке анализа.
 *
 * Шаблон вопросов редактируется из настроек (ADMIN / HEAD_TO) и хранится в
 * `settings.key = 'analysis_checklist_template'`. Здесь — только дефолт и
 * нормализация; хардкода вопросов во фронте нет.
 */

// 10 базовых вопросов «Звонок по тендеру» — формулировки из задачи, дословно.
const DEFAULT_QUESTIONS = [
  'Есть постоянные подрядчики? Мы для массы или ищете подешевле?',
  'Как часто делаете такие работы? Когда последний раз?',
  'Были проблемы в прошлых работах? Какие?',
  'Работа плановая или внеплановая?',
  'Бюджет уже есть? Если нет — можно назвать порядок цен и посмотреть на реакцию.',
  'Что важнее — цена или результат?',
  'Есть уже желающие на этот тендер?',
  'Переторжка будет? Победитель по низкой цене или цена не решающий фактор?',
  'Кто финально решает, кого брать?',
  'Отклонения от ТЗ или ДВ возможны?'
];

const SETTINGS_KEY = 'analysis_checklist_template';
const FREE_SLOTS = 2;
const MAX_QUESTIONS = 40;
const MAX_TEXT_LEN = 500;

/** Дефолтный шаблон: 10 базовых вопросов + 2 свободные строки. */
function buildDefaultTemplate() {
  const items = DEFAULT_QUESTIONS.map((text, i) => ({
    id: 'q' + (i + 1),
    text,
    kind: 'question',
    required: true
  }));
  for (let i = 0; i < FREE_SLOTS; i++) {
    items.push({
      id: 'free' + (i + 1),
      text: 'Свободный вопрос ' + (i + 1),
      kind: 'free',
      required: false
    });
  }
  return items;
}

const DEFAULT_TEMPLATE = buildDefaultTemplate();

function cleanText(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LEN);
}

/**
 * Приводит произвольный вход к валидному шаблону.
 * Пустой/битый вход → дефолт. id уникальны, тексты непусты, свободные слоты
 * добавляются в конец, если их нет (иначе форма потеряет строки свободного ввода).
 */
function normalizeTemplate(raw) {
  let items = null;
  if (Array.isArray(raw)) items = raw;
  else if (raw && Array.isArray(raw.questions)) items = raw.questions;
  else if (raw && Array.isArray(raw.items)) items = raw.items;
  if (!items) return buildDefaultTemplate();

  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it) continue;
    const text = cleanText(typeof it === 'string' ? it : it.text);
    if (!text) continue;
    let id = cleanText(typeof it === 'string' ? '' : it.id).replace(/[^A-Za-z0-9_-]/g, '');
    const kind = (it && it.kind === 'free') ? 'free' : 'question';
    if (!id || seen.has(id)) id = (kind === 'free' ? 'free' : 'q') + (out.length + 1);
    while (seen.has(id)) id = id + '_' + (out.length + 1);
    seen.add(id);
    out.push({ id, text, kind, required: kind === 'free' ? false : (it.required !== false) });
    if (out.length >= MAX_QUESTIONS) break;
  }
  if (!out.length) return buildDefaultTemplate();

  // Гарантируем наличие свободных строк — иначе ТО не сможет дописать свой вопрос.
  const freeCount = out.filter((x) => x.kind === 'free').length;
  for (let i = freeCount; i < FREE_SLOTS; i++) {
    let id = 'free' + (i + 1);
    while (seen.has(id)) id = id + '_x';
    seen.add(id);
    out.push({ id, text: 'Свободный вопрос ' + (i + 1), kind: 'free', required: false });
  }
  return out;
}

/** Шаблон из настроек; при отсутствии/поломке — дефолт (никогда не бросает). */
async function getTemplate(db) {
  try {
    const r = await db.query('SELECT value_json FROM settings WHERE key = $1', [SETTINGS_KEY]);
    if (!r.rows[0]) return buildDefaultTemplate();
    let v = r.rows[0].value_json;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch (_) { v = null; }
    }
    return normalizeTemplate(v);
  } catch (_) {
    return buildDefaultTemplate();
  }
}

/**
 * Проверка заполненности: все `required` из шаблона должны иметь непустой ответ.
 * Свободные строки необязательны (это «пару строчек для свободного ввода»).
 * Возвращает { ok, missing: [{id, text}] } — чтобы фронт показал, чего не хватает.
 */
function validateAnswers(template, answers) {
  const tpl = Array.isArray(template) && template.length ? template : buildDefaultTemplate();
  const a = (answers && typeof answers === 'object') ? answers : {};
  const missing = [];
  for (const q of tpl) {
    if (!q.required) continue;
    const val = cleanText(a[q.id]);
    if (!val) missing.push({ id: q.id, text: q.text });
  }
  return { ok: missing.length === 0, missing };
}

module.exports = {
  DEFAULT_TEMPLATE,
  DEFAULT_QUESTIONS,
  SETTINGS_KEY,
  FREE_SLOTS,
  buildDefaultTemplate,
  normalizeTemplate,
  getTemplate,
  validateAnswers
};
