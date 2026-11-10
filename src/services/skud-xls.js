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
 *   4. Вход без выхода (забыл карту на выходе) → закрываем в 18:00; если на
 *      следующий день есть «выход» до 06:00 — закрываем им (ночная работа).
 *   5. День начинается с «выход» → это ВХОД (сотрудник не отметился на входе,
 *      время до первого касания карты не восстанавливаем).
 *   6. Сиротский «выход» среди дня (после чистого выхода, забыли войти) →
 *      дотягиваем сессию, если разрыв ≤ 3 ч. Выход суток = последний учтённый.
 *
 * Поэтому состояние бинарное («внутри / снаружи»), а не по устройствам.
 */

const crypto = require('crypto');

/** События, которые дублируют уже зафиксированный проход. */
const TECHNICAL_EVENTS = new Set(['проход']);
/** Неизвестный ключ: направление может быть любым — в расчёт часов не берём. */
const UNKNOWN_EVENTS = new Set(['неизвестный ключ']);

/** Незакрытый вход без ночного ухода закрываем в этот час (МСК/настенные). */
const DEFAULT_DAY_CLOSE_HOUR = 18;
/** Сиротский выход после ухода: дотягиваем сессию, если разрыв не больше (мин). */
const DEFAULT_ORPHAN_EXTEND_MIN = 180;
/** «Выход» на следующий день до этого часа — закрытие вчерашней смены. */
const DEFAULT_NEXT_EARLY_EXIT_BEFORE_HOUR = 6;

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
 * Схлопывание дублей двух считывателей: вход→вход / выход→выход подряд.
 * Без правил «первый выход = вход» и сирот — их делает computeDayPresence.
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
 * Интервалы присутствия из схлопнутого списка (только склейка gap).
 * Закрытие незакрытого входа — в computeDayPresence (18:00 / ночной уход).
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

/** Настенные часы суток из ts (наивный UTC = МСК в отчёте). */
function wallHourOf(ts) {
  return new Date(ts).getUTCHours();
}

function dayCloseTs(dayIso, hour) {
  const [y, m, d] = String(dayIso).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour, 0, 0);
}

/**
 * Часы присутствия за один календарный день.
 *
 * Правила (заказчик 09.11.2026):
 *   1) первый «выход» дня = вход (не восставливаем утро до карты);
 *   2) сиротский «выход» ≤ orphanExtendMin после предыдущего выхода → дотянуть;
 *   3) незакрытый вход → 18:00, либо «выход» след.дня до 06:00;
 *   4) выход суток = последний учтённый выход.
 *
 * @param {Array<{ts:number, direction:string, time?:string}>} events
 * @param {{
 *   mergeGapMin?: number,
 *   dayIso?: string,
 *   dayCloseHour?: number,
 *   orphanExtendMin?: number,
 *   nextEarlyExitBeforeHour?: number,
 *   nextDayEarlyExits?: Array<{ts:number, direction:string, time?:string}>
 * }} opts
 * @returns {{
 *   segments: Array,
 *   openEnded: boolean,
 *   collapsed: Array,
 *   minutes: number,
 *   firstIn: object|null,
 *   lastOut: object|null,
 *   consumedNextEarly: object|null
 * }}
 */
function computeDayPresence(events, opts = {}) {
  const mergeGapMin = opts.mergeGapMin == null ? 60 : Number(opts.mergeGapMin);
  const dayCloseHour = opts.dayCloseHour == null ? DEFAULT_DAY_CLOSE_HOUR : Number(opts.dayCloseHour);
  const orphanExtendMin = opts.orphanExtendMin == null ? DEFAULT_ORPHAN_EXTEND_MIN : Number(opts.orphanExtendMin);
  const earlyBefore = opts.nextEarlyExitBeforeHour == null
    ? DEFAULT_NEXT_EARLY_EXIT_BEFORE_HOUR
    : Number(opts.nextEarlyExitBeforeHour);
  const orphanExtendMs = Math.max(0, orphanExtendMin) * 60000;

  const sorted = [...(events || [])]
    .filter((e) => e && (e.direction === 'вход' || e.direction === 'выход') && Number.isFinite(e.ts))
    .sort((a, b) => a.ts - b.ts);

  if (!sorted.length) {
    return {
      segments: [], openEnded: false, collapsed: [], minutes: 0,
      firstIn: null, lastOut: null, consumedNextEarly: null
    };
  }

  const dayIso = opts.dayIso || (sorted[0].iso ? String(sorted[0].iso).slice(0, 10) : null)
    || new Date(sorted[0].ts).toISOString().slice(0, 10);

  const collapsed = [];
  let inside = false;
  let sawPresence = false;
  let lastExitTs = null;

  for (const ev of sorted) {
    if (ev.direction === 'вход') {
      if (inside) continue;
      inside = true;
      sawPresence = true;
      collapsed.push({ ...ev, direction: 'вход' });
      continue;
    }
    // выход
    if (inside) {
      inside = false;
      sawPresence = true;
      collapsed.push({ ...ev, direction: 'выход' });
      lastExitTs = ev.ts;
      continue;
    }
    if (!sawPresence) {
      // Первый значимый сигнал — «выход»: считаем входом.
      inside = true;
      sawPresence = true;
      collapsed.push({
        ...ev,
        direction: 'вход',
        assumed_entry: true,
        time: ev.time || hhmm(ev.ts)
      });
      continue;
    }
    // Сиротский выход среди дня: забыли войти обратно.
    if (lastExitTs != null && ev.ts - lastExitTs <= orphanExtendMs) {
      collapsed.push({
        ts: lastExitTs,
        direction: 'вход',
        time: hhmm(lastExitTs),
        assumed_entry: true,
        synthetic: true
      });
      inside = false;
      collapsed.push({ ...ev, direction: 'выход' });
      lastExitTs = ev.ts;
      sawPresence = true;
    }
    // Иначе шум / чужой проход — игнор.
  }

  let openEnded = false;
  let consumedNextEarly = null;

  if (inside) {
    const early = (opts.nextDayEarlyExits || [])
      .filter((e) => e && e.direction === 'выход' && Number.isFinite(e.ts) && wallHourOf(e.ts) < earlyBefore)
      .sort((a, b) => a.ts - b.ts)[0] || null;

    if (early) {
      collapsed.push({
        ...early,
        direction: 'выход',
        assumed_close: 'next_early_exit'
      });
      inside = false;
      lastExitTs = early.ts;
      consumedNextEarly = early;
      openEnded = true;
    } else {
      const closeAt = dayCloseTs(dayIso, dayCloseHour);
      const opened = [...collapsed].reverse().find((e) => e.direction === 'вход');
      const fromTs = opened ? opened.ts : sorted[0].ts;
      // Если «вход» уже после 18:00 — закрываем последним событием дня, не отрицательным интервалом.
      const toTs = closeAt > fromTs ? closeAt : (sorted[sorted.length - 1].ts > fromTs
        ? sorted[sorted.length - 1].ts
        : fromTs);
      collapsed.push({
        ts: toTs,
        direction: 'выход',
        time: hhmm(toTs),
        assumed_close: closeAt > fromTs ? 'day_close_18' : 'last_event'
      });
      inside = false;
      lastExitTs = toTs;
      openEnded = true;
    }
  }

  const { segments } = buildIntervals(collapsed, mergeGapMin);
  const minutes = segments.reduce((s, x) => s + x.minutes, 0);
  const firstIn = collapsed.find((e) => e.direction === 'вход') || null;
  const lastOut = [...collapsed].reverse().find((e) => e.direction === 'выход') || null;

  return {
    segments,
    openEnded,
    collapsed,
    minutes,
    firstIn,
    lastOut,
    consumedNextEarly
  };
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
    const dates = [...byDate.keys()].sort();
    const skipTs = new Set(); // ночные выходы, уже закрывшие вчера
    const days = [];
    for (let i = 0; i < dates.length; i++) {
      const iso = dates[i];
      allDates.push(iso);
      const evs = (byDate.get(iso) || [])
        .filter((e) => !skipTs.has(e.ts))
        .sort((a, b) => a.ts - b.ts);
      const nextIso = dates[i + 1] || null;
      const nextDayEarlyExits = nextIso
        ? (byDate.get(nextIso) || []).filter((e) =>
          e.direction === 'выход' && wallHourOf(e.ts) < DEFAULT_NEXT_EARLY_EXIT_BEFORE_HOUR)
        : [];

      const presence = computeDayPresence(evs, {
        mergeGapMin,
        dayIso: iso,
        nextDayEarlyExits
      });
      if (presence.consumedNextEarly && presence.consumedNextEarly.ts != null) {
        skipTs.add(presence.consumedNextEarly.ts);
      }

      const firstIn = presence.firstIn;
      const lastOut = presence.lastOut;
      days.push({
        date: iso,
        minutes: presence.minutes,
        openEnded: presence.openEnded,
        firstIn: firstIn ? `${iso} ${firstIn.time || hhmm(firstIn.ts)}` : null,
        lastOut: lastOut
          ? `${(lastOut.assumed_close === 'next_early_exit' && nextIso) ? nextIso : iso} ${lastOut.time || hhmm(lastOut.ts)}`
          : null,
        segments: presence.segments,
        skippedEvents: bucket.skipped,
        punches: evs.map((e) => ({
          date: iso,
          ts: `${iso} ${e.time}`,
          direction: e.direction,
          event: e.event,
          device: e.device
        }))
      });
    }
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

/**
 * Человекочитаемая подпись считывателя для истории проходов.
 * В БД остаётся сырое «4 этаж (…» / «6 этаж новая (…)» — маппинг только на показ.
 * «6 этаж новая» = кабинет тендеров: там сейчас перепутан вход/выход в железе;
 * направления в расчёте не трогаем — ждём перезаливку отчётов с верными значениями.
 */
function friendlyDeviceLabel(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const base = s.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (base === '4 этаж' || base.startsWith('4 этаж ')) return 'Бухгалтерия';
  // «новая» раньше «6 этаж», иначе съест префикс.
  if (base === '6 этаж новая' || base.startsWith('6 этаж новая')) {
    return 'Кабинет тендерного отдела';
  }
  if (base === '6 этаж' || base.startsWith('6 этаж ')) return 'Основной офис';
  return s;
}

module.exports = {
  parseBuffer,
  parseRows,
  parseStamp,
  parsePersonHeader,
  parsePeriodHeader,
  collapseState,
  buildIntervals,
  computeDayPresence,
  looksLikeSkudRows,
  friendlyDeviceLabel,
  sha256,
  TECHNICAL_EVENTS,
  UNKNOWN_EVENTS,
  DEFAULT_DAY_CLOSE_HOUR,
  DEFAULT_ORPHAN_EXTEND_MIN,
  DEFAULT_NEXT_EARLY_EXIT_BEFORE_HOUR,
  _hhmm: hhmm
};
