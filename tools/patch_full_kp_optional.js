#!/usr/bin/env node
'use strict';

/**
 * Убрать из DOCX-шаблона полного КП последние пустые метки и заголовки.
 *
 * Верификатор 05.11.2026 нашёл, что после первой правки остались:
 *   • «Примечания к распределению стоимости» — {cost_notes} без guard,
 *     а в ИИ-черновике cost_notes ВСЕГДА пустой → заголовок без текста
 *     в каждом полном КП через ИИ;
 *   • «Персонал» и «Режим производства» — {cond_personnel}/{cond_regime}
 *     без guard: 114 из 115 готовых просчётов дают метку без значения;
 *   • «Граница объема» — {scope_boundary} без guard.
 *
 * Приём тот же: условный блок вокруг строки/абзаца, метки внутри w:t.
 * Идемпотентно.
 *
 * Запуск: node tools/patch_full_kp_optional.js
 */

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const TPL = path.join(__dirname, '..', 'templates', 'full-kp-nika-tpl.docx');

/** Плейсхолдер → имя условного блока → что оборачивать. */
const ITEMS = [
  { ph: '{cost_notes}', tag: 'has_cost_notes', wrap: 'row', label: 'cost_notes' },
  { ph: '{scope_boundary}', tag: 'has_scope_boundary', wrap: 'row', label: 'scope_boundary' },
  { ph: '{cond_personnel}', tag: 'has_cond_personnel', wrap: 'row', label: 'personnel' },
  { ph: '{cond_regime}', tag: 'has_cond_regime', wrap: 'row', label: 'regime' },
  // «Оплата» осталась без guard в прошлой итерации: в живых КП печаталось
  // «Оплата» без значения (2 из 5 готовых полных КП).
  { ph: '{cond_payment}', tag: 'has_cond_payment', wrap: 'row', label: 'payment' }
];

/** Найти границы абзаца, содержащего idx. */
function paraBounds(xml, idx) {
  const start = Math.max(xml.lastIndexOf('<w:p ', idx), xml.lastIndexOf('<w:p>', idx));
  if (start < 0) return null;
  const end = xml.indexOf('</w:p>', idx);
  if (end < 0) return null;
  return { start, end: end + '</w:p>'.length };
}

/** Найти границы строки таблицы, содержащей idx (если она есть). */
function rowBounds(xml, idx) {
  const start = xml.lastIndexOf('<w:tr', idx);
  if (start < 0) return null;
  const end = xml.indexOf('</w:tr>', idx);
  if (end < 0) return null;
  // Плейсхолдер не должен быть во вложенной строке.
  if (xml.slice(idx, end).indexOf('<w:tr') >= 0) return null;
  return { start, end: end + '</w:tr>'.length };
}

function wtsIn(xml, from, to) {
  const seg = xml.slice(from, to);
  const out = [];
  const re = /<w:t(?:\s|>)/g;
  let m;
  while ((m = re.exec(seg)) !== null) out.push(from + m.index);
  return out;
}

function main() {
  const zip = new PizZip(fs.readFileSync(TPL));
  let xml = zip.file('word/document.xml').asText();
  let applied = 0;

  for (const it of ITEMS) {
    if (xml.indexOf('{#' + it.tag + '}') >= 0) {
      console.log('уже обёрнут:', it.tag);
      continue;
    }
    const phIdx = xml.indexOf(it.ph);
    if (phIdx < 0) { console.log('нет плейсхолдера:', it.ph); continue; }

    // Для меток условий оборачиваем строку таблицы (там слева метка, справа
    // значение). Для остальных — абзац: заголовок печатается отдельным w:p.
    let bounds = null;
    if (it.wrap === 'row') bounds = rowBounds(xml, phIdx) || paraBounds(xml, phIdx);

    // Особый случай: cost_notes и scope_boundary стоят ПОД заголовком отдельным
    // абзацем. Чтобы убрать и заголовок, оборачиваем вместе с предыдущим абзацем.
    if (it.wrap === 'row' && !bounds) bounds = paraBounds(xml, phIdx);

    if (!bounds) { console.log('нет границ для', it.label); continue; }

    let start = bounds.start;
    if (it.wrap === 'row' && !rowBounds(xml, phIdx)) {
      // scope_boundary/cost_notes: захватить предыдущий абзац-заголовок.
      const prevP = Math.max(xml.lastIndexOf('<w:p ', start - 1), xml.lastIndexOf('<w:p>', start - 1));
      if (prevP >= 0) start = prevP;
    }

    const tList = wtsIn(xml, start, bounds.end);
    if (!tList.length) { console.log('нет w:t для', it.label); continue; }

    // Закрывающий тег ставим первым (с конца), иначе позиции сдвинутся.
    const lastT = tList[tList.length - 1];
    const lastTClose = xml.indexOf('</w:t', lastT);
    let out = xml.slice(0, lastTClose) + '{/' + it.tag + '}' + xml.slice(lastTClose);

    const firstT = tList[0];
    const firstTOpenEnd = out.indexOf('>', firstT) + 1;
    out = out.slice(0, firstTOpenEnd) + '{#' + it.tag + '}' + out.slice(firstTOpenEnd);

    xml = out;
    applied += 1;
    console.log('обёрнут:', it.tag, '←', it.ph);

    // Дальнейшие поиски — по новому xml.
    bounds = null;
  }

  if (!applied) { console.log('нечего менять'); return; }

  for (const it of ITEMS) {
    const o = (xml.match(new RegExp('\\{#' + it.tag + '\\}', 'g')) || []).length;
    const c = (xml.match(new RegExp('\\{/' + it.tag + '\\}', 'g')) || []).length;
    if (o !== c) throw new Error('дисбаланс ' + it.tag + ': ' + o + '/' + c);
    if (o > 1) throw new Error('дубль ' + it.tag);
  }

  zip.file('word/document.xml', xml);
  fs.writeFileSync(TPL, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log('OK: обёрнуто ' + applied);
}

main();
