'use strict';

/**
 * Единый дайджест по тендерам — вместо десятков отдельных писем.
 *
 * ── Зачем ─────────────────────────────────────────────────────────────────
 * Раньше каждый шаг тендера (анализ готов, просчёт готов, дедлайн близко,
 * нет активности) отправлял СВОЁ письмо и СВОЙ пуш. На очереди из 14
 * тендеров это давало десятки писем в день, и РП переставал их читать —
 * уведомление превращалось в шум.
 *
 * ── Как теперь ────────────────────────────────────────────────────────────
 * Все события копятся в очереди (tender_digest_outbox) и уходят ОДНИМ
 * письмом:
 *   • утром (09:00–10:00 МСК) — что предстоит сегодня;
 *   • вечером (17:00–18:00 МСК) — что осталось и где нужен ответ.
 *
 * Ночью не отправляем ничего. Если дедлайн ближе суток — отправляем сразу
 * в рабочее время (09:00–18:00) с пометкой «срочно».
 *
 * ── Чего модуль НЕ трогает ────────────────────────────────────────────────
 * Согласование директора — отдельный контур, у него свои письма и свой
 * ритм. Здесь только тендеры: анализ, просчёт, дедлайны, простой.
 */

const crypto = require('crypto');

/** Часовой пояс компании: Москва, UTC+3 без перехода на летнее время. */
const MSK_OFFSET_MIN = 180;

/** Утреннее и вечернее окна отправки (МСК). */
const MORNING_WINDOW = { from: 9, to: 10 };
const EVENING_WINDOW = { from: 17, to: 18 };

/** Рабочие часы: срочные уведомления можно слать только внутри. */
const WORK_HOURS = { from: 9, to: 18 };

/** Дедлайн считается срочным, если до него меньше этого числа часов. */
const URGENT_HOURS = 24;

/**
 * Текущее время в Москве.
 *
 * Не используем локальное время сервера: прод живёт в UTC, и «9 утра» там
 * означало бы полдень по Москве. Смещение фиксированное (UTC+3), потому что
 * перехода на летнее время в России нет с 2014 года.
 *
 * @param {Date} [now]
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, weekday: number}}
 */
function moscowNow(now) {
  const base = now instanceof Date ? now : new Date();
  const shifted = new Date(base.getTime() + MSK_OFFSET_MIN * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),      // 0-based
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    // 0 = воскресенье, как в Date.getUTCDay().
    weekday: shifted.getUTCDay()
  };
}

/** Рабочий день: понедельник–пятница. */
function isWorkday(ts) {
  const w = ts.weekday;
  return w >= 1 && w <= 5;
}

/**
 * В каком окне сейчас находимся.
 *
 * @param {object} ts — результат moscowNow
 * @returns {'morning'|'evening'|'work'|'off'}
 */
function currentWindow(ts) {
  if (!isWorkday(ts)) return 'off';
  if (ts.hour >= MORNING_WINDOW.from && ts.hour < MORNING_WINDOW.to) return 'morning';
  if (ts.hour >= EVENING_WINDOW.from && ts.hour < EVENING_WINDOW.to) return 'evening';
  if (ts.hour >= WORK_HOURS.from && ts.hour < WORK_HOURS.to) return 'work';
  return 'off';
}

/**
 * Дедлайн ближе суток — срочно?
 *
 * Порог URGENT_HOURS объявлен, но раньше нигде не использовался: срочность
 * приходила готовым флагом снаружи. Теперь проверка здесь, чтобы вся
 * политика времени была в одном модуле.
 *
 * @param {string|Date|null} deadline
 * @param {Date} [now]
 * @returns {boolean}
 */
function isUrgentDeadline(deadline, now) {
  const d = parseWhen(deadline);
  if (!d) return false;
  const base = now instanceof Date ? now : new Date();
  const diffMs = d.getTime() - base.getTime();
  if (diffMs < 0) return true;              // уже просрочен — тем более срочно
  return diffMs < URGENT_HOURS * 3600 * 1000;
}

/**
 * Можно ли отправить дайджест сейчас.
 *
 * Ночью и в выходные — нельзя вообще. В рабочее время — можно, если это
 * окно отправки ИЛИ есть срочное событие (дедлайн ближе суток).
 *
 * @param {Date} [now]
 * @param {{urgent?: boolean}} [opts]
 * @returns {{allowed: boolean, window: string, reason: string}}
 */
function canSendNow(now, opts = {}) {
  const ts = moscowNow(now);
  const win = currentWindow(ts);
  if (win === 'off') {
    return {
      allowed: false,
      window: 'off',
      reason: isWorkday(ts) ? 'вне рабочих часов (09:00–18:00 МСК)' : 'выходной день'
    };
  }
  if (win === 'morning' || win === 'evening') {
    return { allowed: true, window: win, reason: 'окно дайджеста' };
  }
  if (opts.urgent) {
    return { allowed: true, window: 'urgent', reason: 'срочный дедлайн в рабочее время' };
  }
  return { allowed: false, window: 'work', reason: 'между окнами дайджеста, событий без срочности нет' };
}

/**
 * Следующее окно отправки — для подсказки в интерфейсе.
 *
 * Возвращает НАЧАЛО следующего окна, а не текущую минуту: раньше перебор
 * шёл шагом 5 минут от «сейчас» и при now=09:04 возвращал «09:04» вместо
 * ближайшего окна, а при 09:06 — «17:01» вместо 17:00 (найдено
 * верификатором: подсказка врала на минуты).
 *
 * @param {Date|string} [now]
 * @returns {{at: string|null, window: string|null}}
 */
function nextWindow(now) {
  const base = now instanceof Date ? now : (parseWhen(now) || new Date());
  const ts = moscowNow(base);
  const nowMin = ts.hour * 60 + ts.minute;

  /** Начало окна в тот же день; null если уже прошло. */
  const atSameDay = (hour) => {
    if (nowMin < hour * 60) {
      return { hour, dayOffset: 0 };
    }
    return null;
  };

  // Окна сегодня, по возрастанию.
  for (const w of [{ hour: MORNING_WINDOW.from, name: 'morning' }, { hour: EVENING_WINDOW.from, name: 'evening' }]) {
    const hit = atSameDay(w.hour);
    if (hit && isWorkday(ts)) {
      return { at: formatMsk(base, hit.dayOffset, w.hour), window: w.name };
    }
  }

  // Следующий рабочий день: ищем ближайший понедельник-пятницу.
  for (let add = 1; add <= 7; add += 1) {
    const probe = new Date(base.getTime() + add * 24 * 3600 * 1000);
    const pt = moscowNow(probe);
    if (!isWorkday(pt)) continue;
    return { at: formatMsk(base, add, MORNING_WINDOW.from), window: 'morning' };
  }
  return { at: null, window: null };
}

/** Разбирает строку даты, если пришла строкой. */
function parseWhen(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Форматирует «начало окна в Москве» со сдвигом в днях. */
function formatMsk(base, dayOffset, hour) {
  const d = new Date(base.getTime() + dayOffset * 24 * 3600 * 1000);
  const ts = moscowNow(d);
  return `${ts.year}-${String(ts.month + 1).padStart(2, '0')}-${String(ts.day).padStart(2, '0')} `
    + `${String(hour).padStart(2, '0')}:00`;
}


/**
 * Ключ дедупликации события.
 *
 * Одно и то же событие (например, «анализ готов у тендера 2138») не должно
 * попадать в дайджест дважды — ни в утренний и вечерний, ни при повторном
 * запуске крона.
 *
 * @param {{kind: string, tender_id: (number|string), subject?: string}} ev
 * @returns {string}
 */
function eventKey(ev) {
  const e = ev || {};
  const raw = [e.kind, e.tender_id, e.subject || ''].join('|');
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 24);
}

/**
 * Группирует события в разделы дайджеста.
 *
 * Порядок разделов задан явно: сначала то, что горит, потом работа.
 *
 * @param {Array<object>} events
 * @returns {Array<{kind: string, title: string, items: Array<object>}>}
 */
function groupEvents(events) {
  const list = Array.isArray(events) ? events : [];
  const SECTIONS = [
    { kind: 'deadline', title: 'Горят дедлайны' },
    { kind: 'analysis', title: 'Готовы к просчёту (анализ закрыт)' },
    { kind: 'calc', title: 'Просчёты для отправки' },
    { kind: 'stale', title: 'Без движения' },
    { kind: 'reminder', title: 'Напоминания' }
  ];
  // ── Псевдонимы видов ────────────────────────────────────────────────────
  // Крон ставит в очередь `analysis_idle` / `analysis_deadline` /
  // `analysis_overdue`, а разделы описаны как deadline/analysis/calc/stale.
  // Из-за этого события падали в «ПРОЧЕЕ» — владелец получал письмо, где
  // вместо понятной группы стояло безымянное «Прочее (1)» (09.11.2026).
  const ALIAS = {
    analysis_idle: 'stale',
    analysis_deadline: 'deadline',
    analysis_overdue: 'deadline',
    idle: 'stale',
    deadline_2d: 'deadline',
    analysis_finalized: 'analysis',
    calc_ready: 'calc'
  };
  const byKind = new Map();
  for (const e of list) {
    const raw = String((e && e.kind) || 'reminder');
    const k = ALIAS[raw] || raw;
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(e);
  }
  const out = [];
  for (const s of SECTIONS) {
    const items = (byKind.get(s.kind) || [])
      .filter(Boolean)
      .sort((a, b) => {
        // Срочные — всегда сверху.
        if (!!b.urgent !== !!a.urgent) return b.urgent ? 1 : -1;
        // Затем по сроку: ближний первым.
        const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
        const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
        return da - db;
      });
    if (items.length) out.push({ kind: s.kind, title: s.title, items });
    byKind.delete(s.kind);
  }
  // Незнакомые виды не теряем — складываем в «Прочее».
  for (const [k, items] of byKind) {
    if (items.length) out.push({ kind: k, title: 'Прочее', items });
  }
  return out;
}

/**
 * Тема письма: одна строка, по ней видно масштаб.
 *
 * @param {Array<object>} events
 * @param {'morning'|'evening'|'urgent'} window
 * @returns {string}
 */
function buildSubject(events, window) {
  const list = Array.isArray(events) ? events : [];
  const urgent = list.filter((e) => e && e.urgent).length;
  const parts = [];
  if (urgent) parts.push(`срочно: ${urgent}`);
  parts.push(`всего: ${list.length}`);
  const prefix = window === 'urgent' ? 'Срочно по тендерам'
    : (window === 'evening' ? 'Тендеры: итоги дня' : 'Тендеры: план на день');
  return `${prefix} (${parts.join(', ')})`;
}

/** Экранирование HTML. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Дата по-русски: «31.12.2027».
 *
 * Раньше в письмо уходил `String(e.deadline)` от объекта Date, и владелец
 * видел «Fri Dec 31 2027 00:00:00 GMT+0300 (Moscow Standard Time)» — сырой
 * технический вывод вместо даты (09.11.2026).
 *
 * ВАЖНО: считаем в МОСКОВСКОМ времени, а не в UTC. Дата `2027-12-31T00:00+03:00`
 * в UTC — это ещё 30 декабря; преждевременный переход на UTC сдвигал срок
 * на день назад.
 *
 * @param {string|Date|null} v
 * @returns {string} '' если даты нет
 */
function fmtDateRu(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (!Number.isFinite(d.getTime())) return '';
  const msk = new Date(d.getTime() + MSK_OFFSET_MIN * 60 * 1000);
  const dd = String(msk.getUTCDate()).padStart(2, '0');
  const mm = String(msk.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${msk.getUTCFullYear()}`;
}

/**
 * Сколько осталось до срока, словами (в московских сутках).
 *
 * @param {string|Date|null} v
 * @param {Date} [now]
 * @returns {{text: string, tone: 'over'|'hot'|'ok'|''}}
 */
function daysLeft(v, now = new Date()) {
  if (!v) return { text: '', tone: '' };
  const d = v instanceof Date ? v : new Date(v);
  if (!Number.isFinite(d.getTime())) return { text: '', tone: '' };
  const day = 24 * 3600 * 1000;
  const off = MSK_OFFSET_MIN * 60 * 1000;
  // Сутки считаем по московскому календарю: полночь МСК = граница дня.
  const dm = new Date(d.getTime() + off);
  const nm = new Date(now.getTime() + off);
  const left = Math.round((Date.UTC(dm.getUTCFullYear(), dm.getUTCMonth(), dm.getUTCDate())
    - Date.UTC(nm.getUTCFullYear(), nm.getUTCMonth(), nm.getUTCDate())) / day);
  if (left < 0) return { text: `просрочен на ${Math.abs(left)} дн.`, tone: 'over' };
  if (left === 0) return { text: 'срок сегодня', tone: 'hot' };
  if (left === 1) return { text: 'остался 1 день', tone: 'hot' };
  if (left <= 4) return { text: `осталось ${left} дня`, tone: 'hot' };
  if (left <= 30) return { text: `осталось ${left} дн.`, tone: 'ok' };
  const months = Math.round(left / 30);
  if (months < 12) return { text: `осталось ~${months} мес.`, tone: 'ok' };
  const years = (left / 365).toFixed(1).replace('.0', '').replace('.', ',');
  return { text: `осталось ~${years} г.`, tone: 'ok' };
}

/**
 * HTML дайджеста.
 *
 * @param {Array<object>} events
 * @param {{window: string, generatedAt?: Date}} meta
 * @returns {string}
 */
function buildHtml(events, meta) {
  const list = Array.isArray(events) ? events : [];
  const sections = groupEvents(list);
  const m = meta || {};
  const windowTitle = m.window === 'evening' ? 'Итоги дня'
    : (m.window === 'urgent' ? 'Срочное уведомление' : 'План на день');
  const now = m.generatedAt instanceof Date ? m.generatedAt : new Date();

  const TONE = {
    over: { bg: '#fef2f2', bd: '#fecaca', fg: '#b91c1c' },
    hot: { bg: '#fff7ed', bd: '#fed7aa', fg: '#c2410c' },
    ok: { bg: '#f0f9ff', bd: '#bae6fd', fg: '#0369a1' },
    '': { bg: '#f8fafc', bd: '#e2e8f0', fg: '#64748b' }
  };

  const rows = sections.map((s) => {
    const items = s.items.map((e) => {
      const no = e.registry_no ? `№ ${esc(String(e.registry_no))}` : '';
      const title = esc(String(e.title || e.subject || 'Тендер'));
      const left = daysLeft(e.deadline, now);
      const tone = TONE[left.tone || ''] || TONE[''];

      // Плашка срока: дата + сколько осталось. Никаких сырых Date.
      const dateStr = fmtDateRu(e.deadline);
      const chip = dateStr
        ? '<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;'
          + 'background:' + tone.bg + ';border:1px solid ' + tone.bd + ';color:' + tone.fg + ';'
          + 'font-size:11px;font-weight:600;white-space:nowrap">'
          + esc(dateStr) + (left.text ? ' · ' + esc(left.text) : '') + '</span>'
        : '';

      const urgent = e.urgent
        ? '<span style="display:inline-block;margin-right:6px;padding:2px 7px;border-radius:5px;'
          + 'background:#b91c1c;color:#fff;font-size:10px;font-weight:800;letter-spacing:.04em">СРОЧНО</span>'
        : '';

      return '<tr><td style="padding:11px 0;border-bottom:1px solid #eef1f6">'
        + '<div style="font-size:14px;line-height:1.45;color:#1a2332">'
        + urgent
        + (no ? '<span style="color:#64748b;font-weight:600">' + no + '</span> · ' : '')
        + '<span style="font-weight:600">' + title + '</span>' + chip + '</div>'
        + '</td></tr>';
    }).join('');

    return '<tr><td style="padding:18px 0 0">'
      + '<div style="font-size:11px;font-weight:800;color:#1b2a4a;letter-spacing:.06em;'
      + 'padding-bottom:2px">' + esc(String(s.title).toUpperCase())
      + '<span style="color:#94a3b8;font-weight:600"> · ' + s.items.length + '</span></div>'
      + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
      + 'style="border-collapse:collapse">' + items + '</table>'
      + '</td></tr>';
  }).join('');

  // Счётчики в шапке: по ним видно масштаб с первого взгляда.
  const urgentCount = list.filter((e) => e && e.urgent).length;
  const overdueCount = list.filter((e) => daysLeft(e.deadline, now).tone === 'over').length;
  const stats = [
    ['Событий', list.length],
    ['Срочных', urgentCount],
    ['Просрочено', overdueCount]
  ].map(([label, value]) => {
    const over = label === 'Просрочено' && value > 0;
    const hot = label === 'Срочных' && value > 0;
    const fg = over ? '#b91c1c' : (hot ? '#c2410c' : '#1a2332');
    return '<td style="padding:0 18px 0 0">'
      + '<div style="font-size:20px;font-weight:800;line-height:1.1;color:' + fg + '">' + value + '</div>'
      + '<div style="font-size:10.5px;color:#94a3b8;letter-spacing:.04em;text-transform:uppercase">'
      + esc(label) + '</div></td>';
  }).join('');

  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Светлая схема принудительно: в тёмном режиме клиента письмо
     выцветало и становилось нечитаемым (белое на белом). -->
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>Тендеры · ${esc(windowTitle)}</title>
<style>:root{color-scheme:light only}</style></head>
<body bgcolor="#eef1f6" style="margin:0;padding:24px 12px;background:#eef1f6;color:#1a2332;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
   <tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"
         style="width:100%;max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
    <tr><td style="padding:22px 28px 0;background:#1b2a4a">
      <div style="font-size:10.5px;color:#93a4c3;letter-spacing:.12em;text-transform:uppercase;font-weight:600">
        Асгард-Сервис · тендерный отдел</div>
      <div style="font-size:23px;font-weight:800;color:#ffffff;margin:6px 0 16px;letter-spacing:-.01em">
        ${esc(windowTitle)}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="padding-bottom:18px">
        <tr>${stats}</tr>
      </table>
    </td></tr>
    <tr><td style="padding:4px 28px 24px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${rows || '<tr><td style="padding:18px 0;font-size:14px;color:#64748b">Событий нет — очередь пуста.</td></tr>'}
      </table>
    </td></tr>
    <tr><td style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e2e8f0">
      <div style="font-size:11px;color:#94a3b8;line-height:1.6">
        Письмо собрано автоматически: все события дня в одном месте, отдельные
        уведомления по тендерам больше не приходят. Открыть очередь —
        <a href="https://asgard-crm.ru/#/pm-duty" style="color:#2f6fed;text-decoration:none;font-weight:600">Дежурство РП</a>.
      </div>
    </td></tr>
  </table>
   </td></tr>
  </table>
</body></html>`;
}

/** Текстовая версия — для почтовых клиентов без HTML. */
function buildText(events, meta) {
  const list = Array.isArray(events) ? events : [];
  const sections = groupEvents(list);
  const now = (meta && meta.generatedAt instanceof Date) ? meta.generatedAt : new Date();
  const lines = [];
  lines.push(`ТЕНДЕРЫ · ${(meta && meta.window) === 'evening' ? 'ИТОГИ ДНЯ' : 'ПЛАН НА ДЕНЬ'}`);
  lines.push(`Событий: ${list.length}`);
  for (const s of sections) {
    lines.push('');
    lines.push(`${s.title.toUpperCase()} (${s.items.length})`);
    for (const e of s.items) {
      const urgent = e.urgent ? '[СРОЧНО] ' : '';
      const no = e.registry_no ? `№ ${e.registry_no} · ` : '';
      lines.push(`- ${urgent}${no}${e.title || e.subject || 'Тендер'}`);
      // Дата по-русски + сколько осталось (раньше печатался сырой объект Date).
      const d = fmtDateRu(e.deadline);
      if (d) {
        const left = daysLeft(e.deadline, now);
        lines.push(`  Срок: ${d}${left.text ? ' · ' + left.text : ''}`);
      }
    }
  }
  return lines.join('\n');
}

module.exports = {
  MSK_OFFSET_MIN,
  URGENT_HOURS,
  moscowNow,
  isWorkday,
  currentWindow,
  canSendNow,
  nextWindow,
  isUrgentDeadline,
  eventKey,
  groupEvents,
  buildSubject,
  buildHtml,
  buildText,
  // Форматирование срока: русская дата и «осталось N дней».
  // Вынесено наружу, чтобы тесты ловили возврат сырого объекта Date в письмо.
  fmtDateRu,
  daysLeft
};
