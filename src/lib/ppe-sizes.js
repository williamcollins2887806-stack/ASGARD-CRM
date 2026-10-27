/**
 * Единый справочник размеров СИЗ (одежда / обувь / каска / рост).
 * Источник правды для field self-edit, desktop HR и валидации API.
 *
 * Источник размерного ряда — «Размеры персонала 2.xlsx» (лист «Размеры персонала»),
 * решение заказчика 27.10.2026. См. migrations/V441.
 *
 *   clothing — ОБХВАТ ГРУДИ, см, диапазоном (96-100, 104-108). Это не номер
 *              размера: 96-100 ≠ 48, системы разные. Показываем так же, как
 *              в Excel, чтобы кладовщик и HR читали одно и то же.
 *   shoe     — размер обуви EU: 36…50 (в Excel встречаются женские 36-38 и 50).
 *   headwear — размер каски 54…62 или «стандарт».
 *   height   — рост, см, диапазоном: 146-152 … 200-206.
 *
 * Файл-зеркало: public/assets/js/ppe-sizes.js (vanilla),
 * public/desktop-v2-src/src/lib/ppeSizes.js (React v2),
 * public/mobile-app/src/lib/ppeSizes.js (mobile). Держать синхронно.
 */

const CLOTHING = ['84-88', '88-92', '92-96', '96-100', '100-104', '104-108', '108-112', '112-116', '116-120', '120-124', '124-128'];
const SHOE = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48', '49', '50'];
const HEADWEAR = ['54', '56', '58', '60', '62', 'стандарт'];
const HEIGHT = ['146-152', '152-158', '158-164', '164-170', '170-176', '176-182', '182-188', '188-194', '194-200', '200-206'];

const PPE_SIZE_CATALOG = Object.freeze({
  clothing: Object.freeze([...CLOTHING]),
  shoe: Object.freeze([...SHOE]),
  headwear: Object.freeze([...HEADWEAR]),
  height: Object.freeze([...HEIGHT]),
});

const FIELD_KEY = Object.freeze({
  clothing_size: 'clothing',
  shoe_size: 'shoe',
  headwear_size: 'headwear',
  height: 'height',
});

// Подписи для UI: в Excel это «Размер одежды (обхват груди, см)», поэтому
// показываем не голое «96-100», а с единицей измерения.
const FIELD_LABEL = Object.freeze({
  clothing_size: 'Размер одежды (обхват груди, см)',
  shoe_size: 'Размер обуви (EU)',
  headwear_size: 'Головной убор (каска)',
  height: 'Рост, см',
});

function normalizeSize(v) {
  if (v == null) return '';
  return String(v).trim();
}

function isAllowedPpeSize(kind, value) {
  const list = PPE_SIZE_CATALOG[kind];
  if (!list) return false;
  const v = normalizeSize(value);
  if (!v) return true; // empty = clear / optional
  if (list.includes(v)) return true;
  // Legacy passthrough: старые вольные значения (48/50, 46 (M), 54-3) не ломаем,
  // пока сотрудник или HR не выбрал значение из списка. Длину ограничиваем.
  return v.length <= 24;
}

function assertPpeSizes(fields) {
  const errors = [];
  for (const [key, kind] of Object.entries(FIELD_KEY)) {
    if (!(key in fields)) continue;
    const v = fields[key];
    if (v === undefined) continue;
    if (!isAllowedPpeSize(kind, v)) {
      errors.push(`${key}: допустимы только ${PPE_SIZE_CATALOG[kind].join(', ')}`);
    }
  }
  return errors;
}

/** Есть ли значение в справочнике (без legacy-поблажки). */
function isKnownPpeSize(kind, value) {
  const list = PPE_SIZE_CATALOG[kind];
  if (!list) return false;
  return list.includes(normalizeSize(value));
}

function optionsForSelect(kind, current) {
  const list = PPE_SIZE_CATALOG[kind] || [];
  const cur = normalizeSize(current);
  const opts = list.map((v) => ({ value: v, label: v }));
  if (cur && !list.includes(cur)) {
    opts.unshift({ value: cur, label: `${cur} (старое)` });
  }
  return opts;
}

module.exports = {
  PPE_SIZE_CATALOG,
  FIELD_KEY,
  FIELD_LABEL,
  normalizeSize,
  isAllowedPpeSize,
  isKnownPpeSize,
  assertPpeSizes,
  optionsForSelect,
};
