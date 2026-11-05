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

/**
 * Технические вопросы — то, из чего собирается техплан (сроки, бригада, МТР).
 *
 * Без них Мимар писал «Рабочий (исполнитель)», а ТО не мог ответить заказчику
 * «сколько человек, кого именно, на сколько дней, что за оборудование».
 * Спрашиваем при анализе — до просчёта, а не после.
 */
const TECH_QUESTIONS = [
  'Сколько заездов на объект и какой период работ по каждому?',
  'Режим работ: 1 смена, 2 смены, 3 смены или 24/7? Сколько часов в смене?',
  'Какой состав бригады требуется: ИТР, мастер, слесари, сварщики (НАКС), изолировщики, наблюдающие?',
  'Кто предоставляет наблюдающего/спасателя — мы или заказчик?',
  'Какое оборудование и техника нужны? Что у нас есть на складе, что закупаем или берём в аренду?',
  'Нужны ли допуски и удостоверения (высота, НАКС, газ, ОТ)? Есть ли они у бригады?',
  'Есть ли ограничения по доступу на площадку (пропуска, время заезда, карантин)?'
];

const SETTINGS_KEY = 'analysis_checklist_template';
const FREE_SLOTS = 2;
const MAX_QUESTIONS = 40;
const MAX_TEXT_LEN = 500;

/** Дефолтный шаблон: 10 базовых вопросов + техническая секция + 2 свободные строки. */
function buildDefaultTemplate() {
  const items = DEFAULT_QUESTIONS.map((text, i) => ({
    id: 'q' + (i + 1),
    text,
    kind: 'question',
    required: true
  }));
  // Технические вопросы идут до свободных строк: это чек-лист «что нужно
  // посчитать», а не «что ещё спросить».
  items.push(...buildTechQuestions());
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

/**
 * Техническая секция шаблона.
 *
 * Отдельной функцией, а не частью buildDefaultTemplate: сохранённые шаблоны
 * в settings остаются прежними (плюс блок дописывается при нормализации),
 * поэтому у существующих карточек ничего не «прыгает».
 */
function buildTechQuestions() {
  return TECH_QUESTIONS.map((text, i) => ({
    id: 'tech' + (i + 1),
    text,
    kind: 'tech',
    required: false
  }));
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
    const rawKind = it && it.kind;
    const kind = (rawKind === 'free' || rawKind === 'tech') ? rawKind : 'question';
    if (!id || seen.has(id)) id = (kind === 'free' ? 'free' : (kind === 'tech' ? 'tech' : 'q')) + (out.length + 1);
    while (seen.has(id)) id = id + '_' + (out.length + 1);
    seen.add(id);
    out.push({
      id,
      text,
      kind,
      // Технические вопросы по умолчанию необязательные: не блокируем закрытие
      // анализа, если ТО ещё не получил ответ по допускам.
      required: kind === 'free' || kind === 'tech' ? false : (it.required !== false)
    });
    if (out.length >= MAX_QUESTIONS) break;
  }
  if (!out.length) return buildDefaultTemplate();

  // Техническая секция: дописываем, если её нет. Существующие вопросы и их id
  // не трогаем — сохранённые чек-листы продолжают читаться.
  const hasTech = out.some((x) => x.kind === 'tech');
  if (!hasTech) {
    buildTechQuestions().forEach((tq) => {
      let id = tq.id;
      while (seen.has(id)) id = id + '_x';
      seen.add(id);
      out.push({ id, text: tq.text, kind: 'tech', required: false });
    });
  }

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
  TECH_QUESTIONS,
  SETTINGS_KEY,
  FREE_SLOTS,
  buildDefaultTemplate,
  buildTechQuestions,
  normalizeTemplate,
  getTemplate,
  validateAnswers
};
