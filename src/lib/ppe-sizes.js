/**
 * Единый справочник размеров СИЗ (одежда / обувь / каска).
 * Источник правды для field self-edit, desktop HR и валидации API.
 */

const CLOTHING = ['44', '46', '48', '50', '52', '54', '56', '58', '60', '62', '64'];
const SHOE = ['39', '40', '41', '42', '43', '44', '45', '46', '47', '48'];
const HEADWEAR = ['54', '56', '58', '60', '62', 'стандарт'];

const PPE_SIZE_CATALOG = Object.freeze({
  clothing: Object.freeze([...CLOTHING]),
  shoe: Object.freeze([...SHOE]),
  headwear: Object.freeze([...HEADWEAR]),
});

const FIELD_KEY = Object.freeze({
  clothing_size: 'clothing',
  shoe_size: 'shoe',
  headwear_size: 'headwear',
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
  // Legacy passthrough: старые свободные значения (пока юзер не выберет из списка)
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
  normalizeSize,
  isAllowedPpeSize,
  assertPpeSizes,
  optionsForSelect,
};
