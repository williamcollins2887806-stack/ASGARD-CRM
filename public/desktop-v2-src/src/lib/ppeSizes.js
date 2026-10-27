/**
 * Единый справочник размеров СИЗ.
 * Должен совпадать с src/lib/ppe-sizes.js
 *
 * Одежда — ОБХВАТ ГРУДИ диапазоном («96-100»), как в Excel «Размеры персонала».
 * Рост — диапазоном («170-176»). См. migrations/V441.
 */

export const PPE_CLOTHING_SIZES = ['84-88', '88-92', '92-96', '96-100', '100-104', '104-108', '108-112', '112-116', '116-120', '120-124', '124-128'];
export const PPE_SHOE_SIZES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48', '49', '50'];
export const PPE_HEADWEAR_SIZES = ['54', '56', '58', '60', '62', 'стандарт'];
export const PPE_HEIGHT_SIZES = ['146-152', '152-158', '158-164', '164-170', '170-176', '176-182', '182-188', '188-194', '194-200', '200-206'];

export const PPE_SIZE_BY_FIELD = {
  clothing_size: PPE_CLOTHING_SIZES,
  shoe_size: PPE_SHOE_SIZES,
  headwear_size: PPE_HEADWEAR_SIZES,
  height: PPE_HEIGHT_SIZES,
};

export const PPE_FIELD_LABEL = {
  clothing_size: 'Размер одежды (обхват груди, см)',
  shoe_size: 'Размер обуви (EU)',
  headwear_size: 'Головной убор (каска)',
  height: 'Рост, см',
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
