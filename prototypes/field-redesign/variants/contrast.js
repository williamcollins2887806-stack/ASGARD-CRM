'use strict';
/**
 * Проверка контраста текста для 8 вариаций главной (WCAG 2.1).
 * Считает relative luminance и ratio для пар: текст/фон.
 * Запуск: node prototypes/field-redesign/variants/contrast.js
 */
function hex(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function lum(rgb) {
  const [r, g, b] = rgb.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const l1 = lum(hex(a)), l2 = lum(hex(b));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// Проверяемые пары: [подпись, текст, фон, порог]
const PAIRS = [];
const skins = {
  'WB Berry': { bg: '#12010F', card: '#2A0A24', promo: '#5E0A4C', t1: '#FFFFFF', t2: '#D9B8D0', t3: '#A57C9C' },
  'Ozon Electric': { bg: '#050A14', card: '#16233D', promo: '#00308F', t1: '#FFFFFF', t2: '#AEC0DD', t3: '#7C8FB5' },
  'Aurora': { bg: '#05060F', card: '#1A1D3A', promo: '#4A2E9E', t1: '#FFFFFF', t2: '#B4B8D6', t3: '#8B90B2' },
  'Sunset': { bg: '#140809', card: '#361B1C', promo: '#8A3300', t1: '#FFFFFF', t2: '#E3B9B4', t3: '#B98C86' },
  'Lime': { bg: '#04120E', card: '#123027', promo: '#0F5A28', t1: '#FFFFFF', t2: '#B0D6C9', t3: '#7A9C90' },
  'Navy Gold': { bg: '#060B18', card: '#16223F', promo: '#1A2A5A', t1: '#FFFFFF', t2: '#B9C4DE', t3: '#7E8BAB' },
  'Frostlight': { bg: '#F5F8FF', card: '#FFFFFF', promo: '#00308F', t1: '#0B1220', t2: '#3D5473', t3: '#5A6B82' },
  'Neo Market': { bg: '#0B0714', card: '#2A1842', promo: '#3A1AA0', t1: '#FFFFFF', t2: '#C4B8DC', t3: '#9A8CBC' },
};
for (const [name, s] of Object.entries(skins)) {
  PAIRS.push([`${name} · t1 на bg`, s.t1, s.bg, 4.5]);
  PAIRS.push([`${name} · t2 на card`, s.t2, s.card, 4.5]);
  PAIRS.push([`${name} · t3 на card`, s.t3, s.card, 4.5]);
  PAIRS.push([`${name} · белый на promo`, '#FFFFFF', s.promo, 4.5]);
}

console.log('| пара | ratio | порог | вердикт |');
console.log('|---|--:|--:|:-:|');
let fails = 0;
for (const [label, fg, bg, thr] of PAIRS) {
  const r = ratio(fg, bg);
  const pass = r >= thr;
  if (!pass) fails++;
  console.log(`| ${label} | ${r.toFixed(2)} | ${thr} | ${pass ? 'PASS' : '**FAIL**'} |`);
}
console.log(`\nВсего пар: ${PAIRS.length} · FAIL: ${fails}`);
process.exit(fails ? 1 : 0);
