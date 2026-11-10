'use strict';
/**
 * warehouse-context.js — что есть на складе, для Мимира на анализе.
 *
 * ── Зачем ─────────────────────────────────────────────────────────────────
 * Анализ не знал остатков, и МТР либо не заполнялся вовсе (#2138: 0 позиций
 * три прогона подряд), либо модель выдумывала оборудование «из головы».
 * Заказчик требует, чтобы перечень материалов и техники опирался на реальное
 * наличие, а чего нет — показывалось как «купить».
 *
 * ── Почему НЕ отдаём все 1229 позиций ─────────────────────────────────────
 * Промпт анализа уже забит ведомостями (318 тыс. символов). Полный каталог
 * склада съест бюджет и вытеснит объёмы — ровно тот дефект, из-за которого
 * тендер 2138 терял позиции. Поэтому:
 *   • отдаём СЖАТЫЙ каталог (категория → наименование → количество → ед.);
 *   • отбрасываем служебные артикулы (`BIZ_EQUIP_1773939054170`) и позиции
 *     с нулевым остатком/списанные;
 *   • склеиваем дубли одного наименования (HCl встречался 10 раз по 3 л);
 *   • оставляем позиции, релевантные работам тендера (химия при промывке,
 *     насосы/шланги при гидрочистке и т.д.), но БЕЗ выдуманных правил:
 *     фильтр только по совпадению слов категории и наименования с текстом.
 *   • если релевантных мало — добираем остальное до лимита, чтобы модель
 *     видела реальную картину, а не только «удобные» строки.
 *
 * Отдельного «инструмента запроса» не нужно: анализ — один вызов модели,
 * и каталог должен приехать вместе с ним. Точечные запросы живут в
 * `mimir-agent` (get_warehouse_stock) для чата.
 */

/** Сколько строк каталога максимум уходит в промпт. */
const MAX_LINES = 120;
/** Сколько символов максимум занимает блок склада. */
const MAX_CHARS = 9000;

/** Служебные артикулы вида BIZ_EQUIP_... — не человеческое наименование. */
function isServiceName(name) {
  return /^[A-Z][A-Z0-9_]{6,}$/.test(String(name || '').trim());
}

/** Нормализует наименование для склейки дублей: HCl / hcl / HCl  → hcl. */
function normName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[«»"'`]/g, '')
    .trim();
}

/**
 * Строит компактный каталог склада.
 *
 * @param {Array} rows — строки equipment (name, quantity, unit, category_name)
 * @param {object} opts — { text, maxLines, maxChars }
 * @returns {{ text: string, items: Array, total: number, relevant: number }}
 */
function buildWarehouseContext(rows, opts) {
  const o = opts || {};
  const maxLines = Number(o.maxLines) || MAX_LINES;
  const maxChars = Number(o.maxChars) || MAX_CHARS;
  const list = Array.isArray(rows) ? rows : [];

  // 1. Отсев мусора и склейка дублей по наименованию внутри категории.
  const byKey = new Map();
  let dropped = 0;
  for (const r of list) {
    const name = String((r && r.name) || '').trim();
    const qty = Number(r && r.quantity) || 0;
    if (!name || qty <= 0) { dropped += 1; continue; }
    if (isServiceName(name)) { dropped += 1; continue; }
    const cat = String((r && r.category_name) || 'Прочее').trim() || 'Прочее';
    const key = `${cat}|${normName(name)}`;
    const prev = byKey.get(key);
    if (prev) {
      // Дубли складываем: 10 строк «HCl 3 л» = 30 л, а не 10 строк в промпте.
      prev.quantity += qty;
      prev.rows += 1;
    } else {
      byKey.set(key, {
        category: cat,
        name,
        quantity: qty,
        unit: String((r && r.unit) || '').trim(),
        rows: 1
      });
    }
  }

  const items = [...byKey.values()];

  // 2. Релевантность: слова из текста тендера ищем в категории/наименовании.
  // Это НЕ «умное угадывание» — только совпадение слов, чтобы при промывке
  // вперёд шли кислоты и насосы, а не мебель.
  const text = String(o.text || '').toLowerCase();
  const scored = items.map((it) => {
    const hay = `${it.category} ${it.name}`.toLowerCase();
    let score = 0;
    const words = (text.match(/[а-яёa-z0-9]{4,}/gi) || []);
    const uniq = new Set();
    for (const w of words) {
      const word = w.toLowerCase();
      if (uniq.has(word)) continue;
      uniq.add(word);
      if (uniq.size > 400) break;
      if (hay.includes(word)) score += 1;
    }
    // Химия/расходники/СИЗ чаще нужны в работах — небольшой приоритет,
    // но НЕ замена релевантности по тексту.
    if (/химия|расходник|спецодежда|инструмент/i.test(it.category)) score += 0.5;
    return { it, score };
  });

  // 3. Сортировка: релевантные → по количеству строк (крупные остатки виднее).
  scored.sort((a, b) => (b.score - a.score) || (b.it.rows - a.it.rows) || a.it.name.localeCompare(b.it.name));

  const relevant = scored.filter((s) => s.score > 0.5).length;
  const picked = scored.slice(0, maxLines).map((s) => s.it);

  // 4. Текст блока: категория одной строкой, внутри — позиции.
  const byCat = new Map();
  for (const it of picked) {
    if (!byCat.has(it.category)) byCat.set(it.category, []);
    byCat.get(it.category).push(it);
  }
  const lines = [];
  for (const [cat, arr] of byCat) {
    const parts = arr.map((it) => `${it.name}: ${formatQty(it.quantity)}${it.unit ? ' ' + it.unit : ''}`);
    lines.push(`[${cat}] ${parts.join(', ')}`);
  }
  let text2 = lines.join('\n');
  if (text2.length > maxChars) text2 = text2.slice(0, maxChars);

  return {
    text: text2 || '(склад пуст)',
    items: picked,
    total: items.length,
    source_rows: list.length,
    dropped,
    relevant,
    truncated: items.length > picked.length
  };
}

/** Количество без хвоста .000: 3.000 → 3, 2.5 → 2.5. */
function formatQty(q) {
  const n = Number(q);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * Текст-инструкция к блоку склада для промпта.
 * Пишет прямо: чего нет — то покупка, выдумывать нельзя.
 */
function warehousePromptBlock(ctx) {
  if (!ctx || !ctx.text) return '(данных по складу нет)';
  return ctx.text;
}

module.exports = {
  buildWarehouseContext,
  warehousePromptBlock,
  isServiceName,
  normName,
  MAX_LINES,
  MAX_CHARS
};
