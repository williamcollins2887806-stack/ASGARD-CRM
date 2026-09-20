'use strict';

/**
 * ASGARD CRM — нормализация и синонимы для сопоставления товарных строк.
 *
 * Зачем: счёт поставщика пишет «УШМ 125», а каталог — «Болгарка (УШМ) 125 мм»;
 * строка «АКБ 12В» против «Аккумулятор 12В». Чистый trigram ловит опечатки и
 * перестановки, но НЕ синонимы — на них similarity падает ниже порога и строка
 * уходит в «не найдено». Здесь мы расширяем строку запроса словами-синонимами
 * и добавляем токен-пересечение — детерминированно, без ИИ.
 *
 * Что НЕ делает:
 *  - не выдумывает артикулы/цены;
 *  - не «угадывает» синонимы из воздуха: словарь ниже — только устоявшиеся
 *    технические эквиваленты (одна и та же вещь), проверенные глазами.
 *    Спорные пары (шуруповёрт↔дрель, саморез↔шуруп) СОЗНАТЕЛЬНО не внесены:
 *    это разные позиции, ложный матч дороже промаха.
 */

// Устоявшиеся технические эквиваленты. Слева — «ключ», справа — любые
// равнозначные написания. Связь двусторонняя (строим обе стороны).
const SYNONYM_GROUPS = [
  ['ушм', 'болгарка', 'угловая-шлифмашина', 'шлифмашина-угловая'],
  ['акб', 'аккумулятор', 'аккумуляторная-батарея', 'батарея-аккумуляторная'],
  ['авд', 'минимойка', 'мойка-высокого-давления', 'аппарат-высокого-давления'],
  ['сгр', 'строительный-фен', 'термофен', 'фен-строительный'],
  ['сиз', 'средства-индивидуальной-защиты'],
  ['сож', 'средства-обязательной-защиты'],
  ['лкм', 'лакокрасочные-материалы'],
  ['пила', 'циркулярная-пила', 'дисковая-пила'],
  ['перфоратор', 'перфоратор-сверлильный'],
  ['шуроповерт', 'шуруповерт', 'шурупoверт'], // частая опечатка ё/о
  ['электрод', 'электроды-сварочные', 'сварочные-электроды'],
  ['сверло', 'сверло-по-металлу', 'сверло-металл'],
  ['герметик', 'силиконовый-герметик', 'герметик-силиконовый'],
  ['грунтовка', 'грунт', 'грунтовка-глубокого-проникновения'],
  ['эмаль', 'эмаль-пф-115', 'пф-115'],
  ['диск', 'диск-отрезной', 'отрезной-диск'],
  ['фото-фиксация', 'фотофиксация'],
];

// Собрать двустороннюю карту: слово → множество синонимов (включая себя).
const SYNONYMS = (() => {
  const map = new Map();
  const add = (from, to) => {
    if (!map.has(from)) map.set(from, new Set());
    map.get(from).add(to);
  };
  for (const group of SYNONYM_GROUPS) {
    for (const a of group) {
      for (const b of group) {
        if (a !== b) add(a, b);
      }
    }
  }
  return map;
})();

const STOPWORDS = new Set([
  'для', 'или', 'без', 'под', 'над', 'при', 'мма', 'мм', 'шт', 'штук', 'кг',
  'уп', 'упак', 'руб', 'цена', 'сумма', 'всего', 'итого', 'ндс', 'и', 'в', 'на',
  'the', 'and', 'for', 'with', 'pcs',
]);

/**
 * Базовая нормализация названия:
 *  - нижний регистр; ё→е; латиница-двойники (x/c/a/e/o/p/k/m/t/h) → кириллица;
 *  - кавычки/знаки/№ → пробел; десятичная запятая остаётся цифрой;
 *  - кратные пробелы → один; краевые пробелы срезаны.
 */
function normalizeName(input) {
  let s = String(input == null ? '' : input).toLowerCase();
  // ё → е (счёт = счет)
  s = s.replace(/ё/g, 'е');
  // Латинские двойники кириллицы (частая беда в счетах: "12 мм x 100")
  s = s.replace(/[x×]/g, 'х');
  // Типографские кавычки и мусор → пробел
  s = s.replace(/[«»"'`„“”‘’]/g, ' ');
  s = s.replace(/№/g, ' ');
  // Любой не-(буква|цифра|точка|дефис|запятая|дробь) → пробел
  s = s.replace(/[^\p{L}\p{N}.,\-\/]+/gu, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Токены нормализованного названия длиной ≥2 (для токен-пересечения). */
function tokenize(input) {
  const norm = normalizeName(input);
  if (!norm) return [];
  return norm
    .split(/[\s\-\/.,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Значимые токены (≥3 символов, не числа, не стоп-слова) — «смысл» позиции. */
function significantTokens(input) {
  return tokenize(input).filter((t) => t.length >= 3 && !/^\d+$/.test(t));
}

/**
 * Варианты строки запроса для SQL-сопоставления:
 * [нормализованное, + по одному варианту на каждый синоним значимых токенов].
 * Максимум 5 вариантов, чтобы не раздувать SQL.
 */
function matchVariants(input, maxVariants = 5) {
  const norm = normalizeName(input);
  const variants = [];
  if (norm) variants.push(norm);

  const tokens = tokenize(input);
  for (const tok of tokens) {
    const syns = SYNONYMS.get(tok);
    if (!syns) continue;
    for (const syn of syns) {
      if (syn === tok) continue;
      // Заменяем токен на синоним в нормализованной строке (первое вхождение).
      const replaced = norm.replace(new RegExp(`(^|[\\s\\-\\/.])${escapeRe(tok)}([\\s\\-\\/.]|$)`), `$1${syn}$2`);
      if (replaced && replaced !== norm && !variants.includes(replaced)) {
        variants.push(replaced);
      }
      if (variants.length >= maxVariants) return variants;
    }
  }
  return variants;
}

/** Паттерны для ILIKE ANY(): %токен% + %синоним% по каждому значимому токену. */
function likePatterns(input, maxPatterns = 12) {
  const out = [];
  const push = (v) => { const p = '%' + String(v).trim() + '%'; if (v && !out.includes(p)) out.push(p); };
  for (const t of tokenize(input)) {
    push(t);
    const syns = SYNONYMS.get(t);
    if (syns) for (const s of syns) push(s);
    if (out.length >= maxPatterns) break;
  }
  return out.slice(0, maxPatterns);
}

/** Значимые токены + их синонимы — «смысловое поле» строки. */
function meaningTokens(input) {
  const out = new Set();
  for (const t of significantTokens(input)) {
    out.add(t);
    const syns = SYNONYMS.get(t);
    if (syns) for (const s of syns) out.add(s);
  }
  return out;
}

/**
 * Насколько значимые слова строки `a` покрыты смысловым полем строки `b`
 * (с учётом синонимов). Возвращает долю 0..1.
 * Важно: знаменатель — только собственные значимые токены `a`, поэтому
 * «АКБ 12В» против «Аккумулятор 7Ач» даст 0.5 (совпал лишь тип), а не 1.0.
 */
function tokenOverlapScore(a, b) {
  const ta = significantTokens(a);
  if (!ta.length) return 0;
  const mb = meaningTokens(b);
  if (!mb.size) return 0;
  let covered = 0;
  for (const t of ta) if (mb.has(t)) covered++;
  return Math.min(1, covered / ta.length);
}

/** Синоним ли одного «ключа» — короткая проверка для теста/логов. */
function areSynonyms(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (na === nb) return true;
  const sa = SYNONYMS.get(na), sb = SYNONYMS.get(nb);
  return !!((sa && sa.has(nb)) || (sb && sb.has(na)));
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * C5: эвристический разбор ТАБЛИЦЫ счёта ДО обращения к AI. Если строки читаются
 * надёжно (≥3 позиции с наименованием и ценой) — AI не зовём: быстрее и не жжём
 * баланс. Возвращает массив {name, article, quantity, unit, unit_price}.
 */
function heuristicParseInvoiceLines(rawText) {
  const text = String(rawText || '');
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  // ВАЖНО: в JS `\b` опирается на \w=[A-Za-z0-9_], поэтому на границе кириллицы он
  // НЕ срабатывает («\bшт\b» на «1 шт» = false, «^итого\b» на «итого» = false).
  // Используем явные lookaround по кириллице+латинице.
  const unitRe = /(?<![а-яёa-z])(шт|шт\.|кг|г|м|мм|см|л|мл|уп|упак|компл|пар|рул|пач)(?![а-яёa-z])/i;
  // Итоговые строки — не позиции (иначе «Итого с НДС» попадёт в матчинг).
  const totalRe = /^(итого|всего|сумма|к\s*оплате|total|subtotal|ндс|налог|доставка|скидка|предоплата)(?![а-яёa-z])/i;
  for (const line of lines) {
    if (totalRe.test(line)) continue;
    const priceM = line.match(/(\d[\d\s\u00a0]*(?:[.,]\d{2}))\s*(?:₽|руб\.?|р\.?)?\s*$/i);
    if (!priceM) continue;
    const unitPrice = parseFloat(priceM[1].replace(/[\s\u00a0]/g, '').replace(',', '.'));
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;
    let head = line.slice(0, priceM.index).trim();
    if (head.length < 4) continue;
    const letters = (head.match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
    if (letters < 3) continue;
    const qtyM = head.match(/\b(\d+(?:[.,]\d+)?)\s*([A-Za-zА-Яа-яЁё]{1,6})?\s*$/);
    let quantity = 1;
    if (qtyM && unitRe.test(qtyM[0])) { quantity = parseFloat(qtyM[1].replace(',', '.')) || 1; head = head.slice(0, qtyM.index).trim(); }
    const artM = head.match(/\b([A-ZА-Я0-9][A-ZА-Я0-9\-.\/]{4,})\b/);
    const article = artM && /\d/.test(artM[1]) ? artM[1] : '';
    if (article) head = head.replace(article, ' ').replace(/\s{2,}/g, ' ').trim();
    if (head.length < 3) continue;
    items.push({ name: head, article, quantity: quantity || 1, unit: 'шт', unit_price: unitPrice });
  }
  return items;
}

module.exports = {
  normalizeName,
  tokenize,
  significantTokens,
  meaningTokens,
  matchVariants,
  likePatterns,
  tokenOverlapScore,
  heuristicParseInvoiceLines,
  areSynonyms,
  SYNONYMS,
  SYNONYM_GROUPS,
};
