/**
 * Ремонт mojibake в app.css и light-theme.css.
 *
 * Причина дефекта: коммит 7efcfa5f (19.10.2026, «слить правки двух агентов»)
 * записал UTF-8 как cp866 — русский текст превратился в последовательности
 * псевдографики (символы рамок вместо букв). Класс D-142b.
 * Лечение: обратная перекодировка cp866 -> UTF-8 по не-ASCII участкам.
 *
 * Идемпотентно: корректный русский текст проходит без изменений.
 */
const fs = require('fs');
const iconv = require('iconv-lite');

const FILES = ['public/assets/css/app.css', 'public/assets/css/light-theme.css'];
const BAD = /[╨╤╥╪╫╬╧╦╣╢╡╠╟╞╝╜╛║]/;

function repairRun(run) {
  try {
    const fixed = iconv.encode(run, 'cp866').toString('utf8');
    if (fixed.includes('\uFFFD')) return null;
    return fixed;
  } catch (_) { return null; }
}

function repair(text) {
  return text.replace(/[^\x00-\x7F]+/g, (run) => repairRun(run) || run);
}

for (const f of FILES) {
  const before = fs.readFileSync(f, 'utf8');
  const badBefore = (before.match(new RegExp(BAD.source, 'g')) || []).length;
  if (!badBefore) { console.log(`${f}: чисто, пропуск`); continue; }

  const after = repair(before);
  const badAfter = (after.match(new RegExp(BAD.source, 'g')) || []).length;
  const fffd = (after.match(/\uFFFD/g) || []).length;

  // Защита: длина не должна разъехаться, U+FFFD появиться не должен.
  if (fffd > 0) { console.error(`${f}: ОТКАЗ — появились U+FFFD`); continue; }

  fs.writeFileSync(f, after, 'utf8');
  console.log(`${f}: mojibake ${badBefore} -> ${badAfter}, U+FFFD=${fffd}, длина ${before.length} -> ${after.length}`);
}
