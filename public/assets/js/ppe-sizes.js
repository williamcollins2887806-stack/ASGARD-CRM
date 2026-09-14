/**
 * Единый справочник размеров СИЗ (vanilla desktop).
 * Должен совпадать с src/lib/ppe-sizes.js
 */
(function (global) {
  const CLOTHING = ['44', '46', '48', '50', '52', '54', '56', '58', '60', '62', '64'];
  const SHOE = ['39', '40', '41', '42', '43', '44', '45', '46', '47', '48'];
  const HEADWEAR = ['54', '56', '58', '60', '62', 'стандарт'];

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
    selectHtml(kind, current, esc) {
      const list = this[kind] || [];
      return optsHtml(list, current, esc || ((x) => String(x)));
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
