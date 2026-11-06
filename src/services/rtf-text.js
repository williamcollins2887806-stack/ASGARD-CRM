'use strict';

/**
 * Распаковка RTF в читаемый текст.
 * ═══════════════════════════════════════════════════════════════════════════
 * Дефект 06.11.2026 (тендер 2158, «Т-101 чистка трубок.rtf»):
 * в БД лежало 100 000 символов СЫРОЙ RTF-разметки — 11 538 управляющих
 * команд и ни одного читаемого слова. Документ с объёмами считался
 * «распознанным» (ocr_status=done) и уходил в промпт мусором.
 *
 * Парсер .rtf открывал файл как обычный текст. Здесь — настоящая распаковка:
 *   • управляющие слова \word и \word123 отбрасываются;
 *   • \'xx — байт в кодировке документа (по умолчанию cp1251, \ansicpg задаёт);
 *   • \uNNNN — юникод (отрицательные значения = +65536);
 *   • {\*\...} — служебные группы (метаданные, шрифты) выбрасываются целиком;
 *   • \\ \{ \} — экранированные символы;
 *   • \par \line \tab → переводы строк и табуляция.
 */

const iconv = require('iconv-lite');

const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'themedata',
  'colorschememapping', 'latentstyles', 'datastore', 'listtable', 'listoverridetable',
  'rsidtbl', 'generator', 'xmlnstbl', 'mmathpr', 'shpinst', 'fldinst', 'header',
  'footer', 'footnote', 'annotation', 'bkmkstart', 'bkmkend'
]);

/** Кодировка из заголовка: \ansicpg1251 → cp1251. */
function detectCodepage(raw) {
  const m = /\\ansicpg(\d+)/.exec(raw.slice(0, 2000));
  if (m) {
    const n = m[1];
    return n === '1251' ? 'cp1251' : n === '1252' ? 'win1252' : 'cp' + n;
  }
  return 'cp1251';   // русские RTF по умолчанию
}

/** Байт \'xx → символ в кодировке документа. */
function decodeHexByte(hex, codepage) {
  try {
    const b = Buffer.from(hex, 'hex');
    const s = iconv.decode(b, codepage);
    return s.includes('\uFFFD') ? iconv.decode(b, 'cp1251') : s;
  } catch (_) {
    return '';
  }
}

/**
 * RTF → читаемый текст.
 * @param {Buffer|string} input
 * @returns {string}
 */
function rtfToText(input) {
  const raw = Buffer.isBuffer(input)
    ? iconv.decode(input, 'latin1')   // читаем побайтово, декодируем вручную
    : String(input || '');

  if (!/^\s*\{\\rtf/.test(raw)) {
    // Не RTF — вернуть как есть, но проверить на смешанный случай.
    return Buffer.isBuffer(input) ? iconv.decode(input, 'utf-8') : String(input || '');
  }

  const codepage = detectCodepage(raw);
  const out = [];
  let i = 0;
  let depth = 0;
  const skipDepth = [];      // глубины, внутри которых всё выбрасываем
  let ucSkip = 1;            // сколько символов пропустить после \uN

  const rawLen = raw.length;
  while (i < rawLen) {
    const ch = raw[i];

    // Группа: { ... }
    if (ch === '{') {
      depth += 1;
      i += 1;
      // Служебная группа {\*\word ...} — метаданные, шрифты, картинки.
      if (raw[i] === '\\' && raw[i + 1] === '*') {
        skipDepth.push(depth);
        i += 2;
        // пропускаем имя управляющего слова
        while (i < rawLen && /[a-zA-Z]/.test(raw[i])) i += 1;
        continue;
      }
      // {\fonttbl ...}, {\colortbl ...} и подобные — тоже служебные.
      const peek = /^\\([a-zA-Z]+)/.exec(raw.slice(i, i + 32));
      if (peek && SKIP_DESTINATIONS.has(peek[1])) {
        skipDepth.push(depth);
        i += peek[0].length;
        continue;
      }
      continue;
    }
    if (ch === '}') {
      if (skipDepth.length && skipDepth[skipDepth.length - 1] === depth) skipDepth.pop();
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }

    const skipping = skipDepth.length > 0;

    // Управляющее слово: \word или \word123
    if (ch === '\\') {
      const rest = raw.slice(i, i + 40);

      // Экранированные символы.
      if (/^\\\\/.test(rest)) { if (!skipping) out.push('\\'); i += 2; continue; }
      if (/^\\\{/.test(rest)) { if (!skipping) out.push('{'); i += 2; continue; }
      if (/^\\\}/.test(rest)) { if (!skipping) out.push('}'); i += 2; continue; }

      // Байт в кодировке документа: \'xx
      const hex = /^\\'([0-9a-fA-F]{2})/.exec(rest);
      if (hex) {
        if (!skipping) out.push(decodeHexByte(hex[1], codepage));
        i += 4;
        continue;
      }

      // Юникод: \uNNNN?
      const uni = /^\\u(-?\d+)/.exec(rest);
      if (uni) {
        if (!skipping) {
          let code = Number(uni[1]);
          if (code < 0) code += 65536;
          if (code > 0) out.push(String.fromCharCode(code));
        }
        i += uni[0].length;
        // Следующий за \uN символ — заменитель (обычно «?»), его пропускаем.
        let toSkip = ucSkip;
        while (toSkip > 0 && i < rawLen) {
          if (raw[i] === '\\' && raw[i + 1] === "'") { i += 4; toSkip -= 1; continue; }
          if (raw[i] === '\\') { const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(raw.slice(i, i + 32)); i += m ? m[0].length : 2; continue; }
          i += 1;
          toSkip -= 1;
        }
        continue;
      }

      // Прочие управляющие слова.
      const word = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rest);
      if (word) {
        const name = word[1];
        const num = word[2] != null ? Number(word[2]) : null;
        if (!skipping) {
          if (name === 'par' || name === 'line') out.push('\n');
          else if (name === 'tab') out.push('\t');
          else if (name === 'sect' || name === 'page') out.push('\n');
          else if (name === 'cell' || name === 'row') out.push('\t');
          else if (name === 'uc' && num != null) ucSkip = num;
        }
        i += word[0].length;
        // После \par идёт пробел-разделитель — он уже съеден regexp'ом.
        continue;
      }

      // Одиночный \-управляющий символ (\~, \-, \_).
      i += 2;
      continue;
    }

    // Обычный символ.
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { if (!skipping) out.push('\n'); i += 1; continue; }
    if (!skipping) out.push(ch);
    i += 1;
  }

  return normalize(out.join(''));
}

/** Убрать артефакты: лишние пробелы, пустые строки, хвосты разметки. */
function normalize(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    // Остатки команд, если попались (страховка).
    .replace(/\\[a-zA-Z]+-?\d* ?/g, ' ')
    .replace(/\{\\\*?[^}]*\}/g, ' ')
    .trim();
}

/** Сколько в тексте RTF-мусора. 0 → текст чистый. */
function rtfJunkRatio(text) {
  const t = String(text || '');
  if (!t) return 0;
  const marks = (t.match(/\\(?:[a-zA-Z]+-?\d*|'[0-9a-fA-F]{2})/g) || []).length;
  return marks / Math.max(1, t.length / 100);
}

module.exports = { rtfToText, rtfJunkRatio, detectCodepage };
