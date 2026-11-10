'use strict';

/**
 * Нарезка большой ведомости на порции — чтобы модель не теряла позиции.
 *
 * ── Почему это нужно ───────────────────────────────────────────────────────
 * На ведомости в 673 строки модель отдавала от 1 до 353 позиций в разных
 * запусках: ответ не влезал в лимит токенов и обрывался в случайном месте.
 * «Попроси продолжить» не помогало — модель начинала ведомость заново.
 *
 * Решение: резать перечень на порции по ЕСТЕСТВЕННЫМ границам (цех, отделение,
 * раздел) и разбирать каждую отдельно. Тогда каждый ответ короткий, а склейка
 * даёт полный список.
 *
 * ── Как режем ──────────────────────────────────────────────────────────────
 * 1. Ищем в тексте строки-заголовки разделов («Цех 3», «Раздел 2», «Отделение
 *    А») и режем по ним — это осмысленные границы.
 * 2. Если границ нет или порция всё равно велика — режем по числу строк,
 *    стараясь не разрывать таблицу посередине строки.
 *
 * Возвращаем массив порций с номерами строк: по ним можно сказать модели
 * «продолжи с 51-й», и она не будет начинать сначала.
 */

/** Максимум символов в одной порции. */
const MAX_CHARS = 9000;

/** Максимум строк в порции. */
const MAX_LINES = 120;

/** Минимум строк, чтобы порция имела смысл. */
const MIN_LINES = 15;

/** Сколько первых строк повторять в каждой порции как шапку таблицы. */
const HEADER_LINES = 8;

/**
 * Признак строки-заголовка раздела.
 *
 * Покрываем реальные варианты: «Цех 3», «1. Цех 2», «Раздел 4»,
 * «Отделение А», «Участок 2», «Приложение 1».
 *
 * @param {string} line
 * @returns {boolean}
 */
function isSectionLine(line) {
  const s = String(line || '').trim();
  if (!s || s.length > 120) return false;
  // Заголовок раздела: служебное слово + номер/буква, и почти нет цифр объёма.
  const hasWord = /(^|\s)(цех|отделени|участок|раздел|часть|этап|блок|секци|приложени|корпус|установк)\w*/i.test(s);
  if (!hasWord) return false;
  const numCount = (s.match(/\d+/g) || []).length;
  // У заголовка 1–2 числа (номер раздела), у строки данных — объём и номер.
  return numCount <= 2;
}

/**
 * Режет текст ведомости на порции.
 *
 * @param {string} text — полный текст документа
 * @param {{maxChars?: number, maxLines?: number}} [opts]
 * @returns {Array<{index: number, fromLine: number, toLine: number, text: string, title: string}>}
 */
function chunkText(text, opts = {}) {
  const src = String(text || '');
  if (!src.trim()) return [];

  const maxChars = Math.max(4000, Number(opts.maxChars) || MAX_CHARS);
  const maxLines = Math.max(20, Number(opts.maxLines) || MAX_LINES);

  const lines = src.split(/\r?\n/);
  // Одна порция целиком — самый частый и лучший случай.
  if (src.length <= maxChars && lines.length <= maxLines) {
    return [{
      index: 0,
      fromLine: 1,
      toLine: lines.length,
      text: src,
      title: 'полностью'
    }];
  }

  // ── Ищем границы разделов ──────────────────────────────────────────────
  const boundaries = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (isSectionLine(lines[i])) {
      boundaries.push({ at: i, title: String(lines[i]).trim().slice(0, 80) });
    }
  }

  const chunks = [];
  // Шапка таблицы: колонки «наименование / объём / ед. изм.» обычно стоят в
  // первых строках документа. Без неё модель в порции 5 не понимает, где
  // объём, — повторяем шапку в каждой порции.
  const header = lines.slice(0, Math.min(HEADER_LINES, lines.length)).join('\n');

  const pushChunk = (from, to, title, withHeader) => {
    const body = lines.slice(from, to).join('\n');
    if (!body.trim()) return;
    chunks.push({
      index: chunks.length,
      fromLine: from + 1,
      toLine: to,
      // Шапку добавляем только к продолжениям: в первую порцию она уже входит.
      text: withHeader && from > 0 ? `${header}\n...\n${body}` : body,
      title: title || ('строки ' + (from + 1) + '–' + to)
    });
  };

  // ── Режем по разделам, если они дают порции разумного размера ──────────
  if (boundaries.length >= 2) {
    const starts = boundaries.map((b) => b.at);
    // Первая порция — всё до первого раздела (шапка таблицы и преамбула).
    if (starts[0] > 0) {
      const head = lines.slice(0, starts[0]).join('\n');
      if (head.trim()) {
        chunks.push({
          index: chunks.length,
          fromLine: 1,
          toLine: starts[0],
          text: head,
          title: 'шапка документа'
        });
      }
    }
    for (let i = 0; i < starts.length; i += 1) {
      const from = starts[i];
      const to = i + 1 < starts.length ? starts[i + 1] : lines.length;
      const body = lines.slice(from, to);
      // Раздел может быть огромным — тогда режем его по строкам.
      if (body.length <= maxLines && body.join('\n').length <= maxChars) {
        pushChunk(from, to, boundaries[i].title, true);
      } else {
        for (let s = from; s < to; s += maxLines) {
          pushChunk(s, Math.min(s + maxLines, to), boundaries[i].title, true);
        }
      }
    }
    return chunks;
  }

  // ── Границ нет: режем по числу строк ───────────────────────────────────
  for (let from = 0; from < lines.length; from += maxLines) {
    pushChunk(from, Math.min(from + maxLines, lines.length), null, true);
  }
  return chunks;
}

/**
 * Склеивает результаты разбора порций, убирая повторы.
 *
 * Модель на стыке порций может повторить последнюю строку предыдущей —
 * отсекаем по подписи (название + объём + единица).
 *
 * @param {Array<Array<object>>} parts — позиции по порциям
 * @returns {Array<object>}
 */
function mergeChunkPositions(parts) {
  const out = [];
  const seen = new Set();
  for (const list of (Array.isArray(parts) ? parts : [])) {
    for (const p of (Array.isArray(list) ? list : [])) {
      if (!p) continue;
      const key = [
        String(p.name || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 160),
        p.volume == null ? '—' : String(p.volume),
        String(p.unit || '').toLowerCase().trim()
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

module.exports = {
  MAX_CHARS,
  MAX_LINES,
  MIN_LINES,
  isSectionLine,
  chunkText,
  mergeChunkPositions
};
