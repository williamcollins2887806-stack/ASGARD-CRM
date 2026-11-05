'use strict';

/**
 * skud-xls — разбор отчёта СКУД «Отчет "события"».
 *
 * Формат отчёта (проверено на файле за 26.10–01.11.2026, 2413 строк):
 *   строка 0  — заголовок «Отчет "события"»
 *   строка 1  — «период c 26.10.2026 00:00 по 01.11.2026 23:59»
 *   строка 2  — шапка колонок: B=«Дата Время», C=«Событие», F=«Считыватель», G=«Контроллер»
 *   далее     — блоки по людям: строка «ФИО … (таб.№)» в колонке B, затем события
 *   подвал    — дата печати в колонке A и «Страница N из M» в колонке F
 *
 * Особенности данных, которые ломают наивный подсчёт:
 *   1. Каждое прохождение пишется ДВАЖДЫ: «доступ разрешен» и через ~2 сек «проход»
 *      (2390 строк из 2413 — дубли).
 *   2. На одном проёме два считывателя («6 этаж» и «6 этаж новая»), поэтому
 *      «вход 6 этаж» → «выход 6 этаж новая» — это ОДИН проход, а не два события.
 *      Считать по устройствам нельзя: получится 1.7 часа вместо 6.6 (замерено).
 *   3. Есть события «неизвестный ключ» — направление ненадёжно, в часы не идём.
 *   4. Вход без выхода (забыл приложить карту) закрывается последним событием дня
 *      и помечается open_ended — иначе получится 12 часов «работы».
 *
 * Поэтому состояние бинарное («внутри / снаружи»), а не по устройствам.
 */

const crypto = require('crypto');

/** События, которые дублируют уже зафиксированный проход. */
const TECHNICAL_EVENTS = new Set(['проход']);
/** Неизвестный ключ: направление может быть любым — в расчёт часов не берём. */
const UNKNOWN_EVENTS = new Set(['неизвестный ключ']);

const DDMMYYYY_TIME_RE = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;
const PERIOD_RE = /период\s+c\s+(\d{2})\.(\d{2})\.(\d{4})[^]*?по\s+(\d{2})\.(\d{2})\.(\d{4})/i;

function pad2(n) { return String(n).padStart(2, '0'); }

/** '26.10.2026 10:23:29' → { iso: '2026-10-26', time: '10:23:29', ts: Date(UTC-подобный) }. */
function parseStamp(raw) {
  const m = DDMMYYYY_TIME_RE.exec(String(raw || '').trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  return {
    iso: `${yyyy}-${mm}-${dd}`,
    time: `${hh}:${mi}:${ss}`,
    // Считаем в «наивном» UTC, чтобы арифметика не зависела от часового пояса процесса.
    ts: Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss)
  };
}

/** «ФИО (таб.№)» → «ФИО». Возвращает null, если это не заголовок человека. */
function parsePersonHeader(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  // В отчёте встречается «(таб.№)» без номера; кириллическая «№» тоже бывает.
  if (!/\(таб\.?\s*№?\s*\)\s*$/i.test(s)) return null;
  const name = s.replace(/\s*\(таб\.?\s*№?\s*\)\s*$/i, '').replace(/\s+/g, ' ').trim();
  return name || null;
}

/** Дата из шапки файла. Если шапки нет — null (тогда период берём по событиям). */
function parsePeriodHeader(rows) {
  const head = rows.slice(0, 5);
  for (const row of head) {
    for (const cell of row) {
      const text = String(cell || '');
      const m = PERIOD_RE.exec(text);
      if (m) {
        const [, d1, m1, y1, d2, m2, y2] = m;
        return { from: `${y1}-${m1}-${d1}`, to: `${y2}-${m2}-${d2}` };
      }
    }
  }
  return null;
}

/**
 * Схлопывание в бинарное состояние «внутри / снаружи».
 *
 * На одном проёме два считывателя: в сыром отчёте часто «вход→выход» за пару
 * секунд или день начинается с «выход». Это НЕ перепутанные колонки — так
 * пишет СКУД. Мы держим только смены состояния:
 *   уже внутри + ещё «вход» → отброс;
 *   уже снаружи + «выход» → отброс.
 * Контрольные суммы недели (Тумаева/Зубань) сверены с этим правилом.
 */
function collapseState(events) {
  const out = [];
  let inside = false;
  for (const ev of events || []) {
    if (ev.direction === 'вход') {
      if (inside) continue;
      inside = true;
      out.push(ev);
    } else if (ev.direction === 'выход') {
      if (!inside) continue;
      inside = false;
      out.push(ev);
    }
  }
  return out;
}

/**
 * Интервалы присутствия из схлопнутого списка.
 * @param {Array} events — [{ts, direction, ...}] по возрастанию ts
 * @param {number} mergeGapMin — разрыв, который считаем тем же присутствием
 */
function buildIntervals(events, mergeGapMin) {
  if (!events.length) return { segments: [], openEnded: false };
  const raw = [];
  let openedAt = null;
  for (const ev of events) {
    if (ev.direction === 'вход') {
      if (openedAt === null) openedAt = ev.ts;
    } else if (openedAt !== null) {
      raw.push({ from: openedAt, to: ev.ts });
      openedAt = null;
    }
  }
  let openEnded = false;
  if (openedAt !== null) {
    // Незакрытый вход: закрываем последним событием дня, иначе «до полуночи».
    const last = events[events.length - 1].ts;
    if (last > openedAt) raw.push({ from: openedAt, to: last });
    openEnded = true;
  }

  const gapMs = Math.max(0, Number(mergeGapMin) || 0) * 60000;
  const merged = [];
  for (const iv of raw) {
    if (iv.to <= iv.from) continue;
    const prev = merged[merged.length - 1];
    if (prev && iv.from - prev.to <= gapMs) {
      prev.to = Math.max(prev.to, iv.to);
    } else {
      merged.push({ from: iv.from, to: iv.to });
    }
  }

  const segments = merged.map((iv) => ({
    from: new Date(iv.from).toISOString(),
    to: new Date(iv.to).toISOString(),
    minutes: Math.round((iv.to - iv.from) / 60000)
  }));
  return { segments, openEnded };
}

function hhmm(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/**
 * Разбор массива строк (уже сконвертированного из книги).
 * Чистая функция — без БД, без fs: так тестируется отдельно.
 *
 * @param {Array<Array<any>>} rows
 * @param {{mergeGapMin?:number}} opts
 * @returns {{periodFrom:string|null, periodTo:string|null, people:Array, rowsTotal:number, rowsUsed:number, warnings:Array<string>}}
 */
function parseRows(rows, opts = {}) {
  const mergeGapMin = opts.mergeGapMin == null ? 60 : Number(opts.mergeGapMin);
  const header = parsePeriodHeader(rows);

  /** @type {Map<string, {rawName:string, events:Array, skipped:number}>} */
  const people = new Map();
  let current = null;
  let rowsTotal = 0;
  let rowsUsed = 0;
  const warnings = [];

  for (const row of rows) {
    if (!row) continue;
    const colB = row[1];
    const colC = row[2];

    // 1) Заголовок человека живёт в колонке B.
    const person = parsePersonHeader(colB);
    if (person) {
      current = person;
      if (!people.has(person)) {
        people.set(person, { rawName: person, events: [], skipped: 0 });
      }
      continue;
    }

    // 2) Событие: колонка B — дата/время. Всё остальное (подвал, пустые строки) мимо.
    const stamp = parseStamp(colB);
    if (!stamp) continue;
    rowsTotal += 1;
    if (!current) {
      warnings.push(`Событие без заголовка сотрудника на строке «${String(colB).trim()}» пропущено`);
      continue;
    }

    const eventName = String(colC || '').trim().toLowerCase();
    if (UNKNOWN_EVENTS.has(eventName)) {
      people.get(current).skipped += 1;
      continue;
    }

    const directionRaw = String(row[5] || '').trim().toLowerCase();
    const direction = directionRaw === 'вход' ? 'вход' : (directionRaw === 'выход' ? 'выход' : null);
    if (!direction) {
      people.get(current).skipped += 1;
      continue;
    }

    people.get(current).events.push({
      iso: stamp.iso,
      time: stamp.time,
      ts: stamp.ts,
      direction,
      event: String(colC || '').trim(),
      device: String(row[6] || '').trim(),   // «6 этаж (000B3A00FB2C)» — считыватель + контроллер
      technical: TECHNICAL_EVENTS.has(eventName)
    });
    rowsUsed += 1;
  }

  // Технические дубли («проход») выкидываем до схлопывания: они повторяют
  // уже записанный «доступ разрешен» через ~2 секунды.
  const result = [];
  let allDates = [];
  for (const [rawName, bucket] of people) {
    const byDate = new Map();
    for (const ev of bucket.events) {
      if (ev.technical) continue;
      if (!byDate.has(ev.iso)) byDate.set(ev.iso, []);
      byDate.get(ev.iso).push(ev);
    }
    const days = [];
    for (const [iso, evs] of byDate) {
      allDates.push(iso);
      evs.sort((a, b) => a.ts - b.ts);
      const collapsed = collapseState(evs);
      const { segments, openEnded } = buildIntervals(collapsed, mergeGapMin);
      const minutes = segments.reduce((s, x) => s + x.minutes, 0);
      const firstIn = collapsed.find((e) => e.direction === 'вход');
      const lastOut = [...collapsed].reverse().find((e) => e.direction === 'выход');
      days.push({
        date: iso,
        minutes,
        openEnded,
        firstIn: firstIn ? `${iso} ${firstIn.time}` : null,
        lastOut: lastOut ? `${iso} ${lastOut.time}` : null,
        segments,
        skippedEvents: bucket.skipped,
        // Сырые прохождения (для доказуемости в карточке дня).
        punches: evs.map((e) => ({
          date: iso,
          ts: `${iso} ${e.time}`,
          direction: e.direction,
          event: e.event,
          device: e.device
        }))
      });
    }
    days.sort((a, b) => (a.date < b.date ? -1 : 1));
    result.push({ rawName, days, skippedEvents: bucket.skipped });
  }

  result.sort((a, b) => a.rawName.localeCompare(b.rawName, 'ru'));
  allDates = allDates.sort();
  const periodFrom = header ? header.from : (allDates[0] || null);
  const periodTo = header ? header.to : (allDates[allDates.length - 1] || null);

  return { periodFrom, periodTo, people: result, rowsTotal, rowsUsed, warnings };
}

/**
 * Разбор файла .xls / .xlsx / .zip из буфера.
 * @param {Buffer} buffer
 * @param {{mergeGapMin?:number, filename?:string}} opts
 */
function parseBuffer(buffer, opts = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Пустой файл отчёта СКУД');
  }
  let buf = buffer;
  let filename = opts.filename || '';

  // ZIP: внутри лежит один .xls. Отчёт приходит и архивом — поддерживаем оба вида.
  // ВАЖНО: .xlsx сам по себе является ZIP-контейнером (PK\x03\x04), поэтому
  // распаковывать нужно только настоящий архив, а не книгу Excel.
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(buf);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);
    const isWorkbook = entries.some((e) => /^xl\/workbook\.xml$/i.test(e.entryName));
    if (!isWorkbook) {
      const entry = entries.find((e) => /\.(xls|xlsx)$/i.test(e.entryName));
      if (!entry) throw new Error('В архиве нет файла .xls/.xlsx');
      buf = entry.getData();
      filename = filename || entry.entryName;
    }
  }

  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, {
    type: 'buffer',
    codepage: 1251,
    cellDates: false,
    raw: true
  });
  const sheetName = wb.SheetNames && wb.SheetNames[0];
  if (!sheetName) throw new Error('В файле нет ни одного листа');
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

  const parsed = parseRows(rows, opts);
  if (!parsed.people.length) {
    throw new Error('Не найдено ни одного сотрудника — это не отчёт СКУД?');
  }
  return { ...parsed, filename, sheet: sheetName, sha256: sha256(buf) };
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Быстрая проверка «это вообще отчёт СКУД?» без полного разбора. */
function looksLikeSkudRows(rows) {
  const text = rows.slice(0, 6).map((r) => (r || []).join(' ')).join(' ');
  if (/Отчет\s+"события"/i.test(text)) return true;
  if (PERIOD_RE.test(text)) return true;
  const headerRow = rows.find((r) => (r || []).some((c) => /Дата\s+Время/i.test(String(c || ''))));
  const hasPerson = rows.some((r) => parsePersonHeader((r || [])[1]));
  return !!headerRow && hasPerson;
}

module.exports = {
  parseBuffer,
  parseRows,
  parseStamp,
  parsePersonHeader,
  parsePeriodHeader,
  collapseState,
  buildIntervals,
  looksLikeSkudRows,
  sha256,
  TECHNICAL_EVENTS,
  UNKNOWN_EVENTS,
  _hhmm: hhmm
};
