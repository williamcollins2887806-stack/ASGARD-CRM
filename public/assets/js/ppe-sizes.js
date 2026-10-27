/**
 * Единый справочник размеров СИЗ (vanilla desktop).
 * Должен совпадать с src/lib/ppe-sizes.js
 *
 * Одежда — ОБХВАТ ГРУДИ диапазоном («96-100»), как в Excel «Размеры персонала».
 * Рост — диапазоном («170-176»). См. migrations/V441.
 */
(function (global) {
  const CLOTHING = ['84-88', '88-92', '92-96', '96-100', '100-104', '104-108', '108-112', '112-116', '116-120', '120-124', '124-128'];
  const SHOE = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48', '49', '50'];
  const HEADWEAR = ['54', '56', '58', '60', '62', 'стандарт'];
  const HEIGHT = ['146-152', '152-158', '158-164', '164-170', '170-176', '176-182', '182-188', '188-194', '194-200', '200-206'];

  const LABEL = {
    clothing_size: 'Размер одежды (обхват груди, см)',
    shoe_size: 'Размер обуви (EU)',
    headwear_size: 'Головной убор (каска)',
    height: 'Рост, см',
  };

  function optsHtml(list, current, esc) {
    const cur = String(current || '').trim();
    let html = `<option value="">—</option>`;
    if (cur && !list.includes(cur)) {
      html += `<option value="${esc(cur)}" selected>${esc(cur)} (старое)</option>`;
    }
    for (const s of list) {
      html += `<option value="${esc(s)}"${cur === s ? ' selected' : ''}>${esc(s)}</option>`;
    }
    return html;
  }

  global.AsgardPpeSizes = {
    clothing: CLOTHING,
    shoe: SHOE,
    headwear: HEADWEAR,
    height: HEIGHT,
    label: LABEL,
    selectHtml(kind, current, esc) {
      const list = this[kind] || [];
      return optsHtml(list, current, esc || ((x) => String(x)));
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
