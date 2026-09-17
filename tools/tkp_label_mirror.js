'use strict';
/**
 * Разбор и сверка «шапки таблицы стоимости» полного КП.
 *
 * Дефолты шапки живут в ТРЁХ местах:
 *   1) src/services/tkp-full-kp.js                     — источник истины (печать DOCX/PDF);
 *   2) public/assets/js/tkp-full-form.js               — vanilla-форма (она и на проде, /#/tkp);
 *   3) public/desktop-v2-src/src/pages/Tkp/modals/FullKpFormModal.jsx — React v2 (/v2/).
 *
 * Пока это дубли, их надо сверять ПО КЛЮЧАМ. Подстрочный поиск значения по файлу
 * не годится: «Наименование» встречается в v2 ещё и как label поля, поэтому мутация
 * дефолта не красила гейт (найдено аудитом 17.09.2026). Здесь объект разбирается
 * как объект — тогда подмена значения видна всегда.
 *
 * Модуль используется гейтами: tools/verify_tkp_full_template.js (версионирован)
 * и _tmp_tender_brief/zavidovo_golf_kp/verify_tpl.js (локальный, с арифметикой прайса).
 */

const fs = require('fs');
const path = require('path');

// Имя константы исторически разошлось: в сервисе TABLE_LABELS_DEFAULT, в формах
// TABLE_LABEL_DEFAULTS. Оба варианта — один и тот же литерал, парсер принимает любой.
const DECL = 'TABLE_LABEL_DEFAULTS';
const DECL_RE = /TABLE_LABELS?_DEFAULT/;

/** Тело литерала `TABLE_LABELS?_DEFAULT = { ... }` (скобки считаем с учётом строк). */
function extractObjectLiteral(src, decl = DECL) {
  const m = DECL_RE.exec(src);
  if (!m) return null;
  const at = m.index;
  const open = src.indexOf('{', src.indexOf('=', at + m[0].length));
  if (open < 0) return null;
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/** 'key': 'value' → { key: value } (только строковые литералы, как в этих трёх файлах). */
function parseDefaultsObject(src, decl = DECL) {
  const body = extractObjectLiteral(src, decl);
  if (!body) return null;
  const defaults = {};
  const re = /([A-Za-z_$][\w$]*)\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const raw = m[2] !== undefined ? m[2] : m[3];
    defaults[m[1]] = raw.replace(/\\(['"\\])/g, '$1');
  }
  return defaults;
}

const SOURCES = [
  ['service', 'src/services/tkp-full-kp.js'],
  ['v1 vanilla', 'public/assets/js/tkp-full-form.js'],
  ['v2 react', 'public/desktop-v2-src/src/pages/Tkp/modals/FullKpFormModal.jsx']
];

/** Все три источника с разобранными дефолтами (пути — от корня репозитория). */
function collect(root) {
  return SOURCES.map(([name, rel]) => {
    const abs = path.join(root, rel);
    const exists = fs.existsSync(abs);
    const src = exists ? fs.readFileSync(abs, 'utf8') : '';
    return { name, rel, abs, exists, src, defaults: exists ? parseDefaultsObject(src) : null };
  });
}

/**
 * Сверка зеркал. truth — разобранный источник истины (по умолчанию service).
 * Возвращает { truth, rows, problems } — problems пуст, если всё сходится.
 */
function compare(root) {
  return compareSources(collect(root));
}

/** Та же сверка, но по готовому списку источников (нужно для mutation-самопроверки гейта). */
function compareSources(sources) {
  const service = sources.find((s) => s.name === 'service');
  const truth = service && service.defaults;
  const problems = [];
  const rows = [];

  for (const s of sources) {
    const row = { name: s.name, rel: s.rel, ok: false, notes: [] };
    if (!s.exists) {
      row.notes.push('ФАЙЛА НЕТ');
      problems.push(`${s.name}: нет файла ${s.rel}`);
      rows.push(row);
      continue;
    }
    if (!s.defaults) {
      row.notes.push('не нашёл литерал ' + DECL);
      problems.push(`${s.name}: в ${s.rel} нет разобранного ${DECL}`);
      rows.push(row);
      continue;
    }
    if (!truth) {
      row.notes.push('сверять не с чем (источник истины не разобран)');
      rows.push(row);
      continue;
    }
    const keys = Object.keys(truth);
    for (const k of keys) {
      if (!(k in s.defaults)) {
        row.notes.push(`НЕТ ключа ${k}`);
        problems.push(`${s.name}: нет ключа ${k} (ожидалось «${truth[k]}»)`);
      } else if (s.defaults[k] !== truth[k]) {
        row.notes.push(`${k}: «${s.defaults[k]}» вместо «${truth[k]}»`);
        problems.push(`${s.name}: ${k} = «${s.defaults[k]}», а в сервисе «${truth[k]}»`);
      }
    }
    for (const k of Object.keys(s.defaults)) {
      if (!(k in truth)) {
        row.notes.push(`лишний ключ ${k}`);
        problems.push(`${s.name}: лишний ключ ${k} (в сервисе его нет)`);
      }
    }
    row.ok = row.notes.length === 0;
    rows.push(row);
  }
  return { truth, rows, problems, sources };
}

module.exports = { DECL, parseDefaultsObject, extractObjectLiteral, collect, compare, compareSources, SOURCES };
