/**
 * Единый справочник размеров СИЗ.
 * Должен совпадать с src/lib/ppe-sizes.js
 */

export const PPE_CLOTHING_SIZES = ['44', '46', '48', '50', '52', '54', '56', '58', '60', '62', '64'];
export const PPE_SHOE_SIZES = ['39', '40', '41', '42', '43', '44', '45', '46', '47', '48'];
export const PPE_HEADWEAR_SIZES = ['54', '56', '58', '60', '62', 'стандарт'];

export const PPE_SIZE_BY_FIELD = {
  clothing_size: PPE_CLOTHING_SIZES,
  shoe_size: PPE_SHOE_SIZES,
  headwear_size: PPE_HEADWEAR_SIZES,
};

export function ppeSizeSelectOptions(fieldKey, current) {
  const list = PPE_SIZE_BY_FIELD[fieldKey] || [];
  const cur = current != null ? String(current).trim() : '';
  const opts = [{ value: '', label: '— не указано —' }, ...list.map((v) => ({ value: v, label: v }))];
  if (cur && !list.includes(cur)) {
    opts.splice(1, 0, { value: cur, label: `${cur} (старое)` });
  }
  return opts;
}
