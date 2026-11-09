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
  const byKind = new Map();
  for (const e of list) {
    const k = String((e && e.kind) || 'reminder');
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

  const rows = sections.map((s) => {
    const items = s.items.map((e) => {
      const urgent = e.urgent
        ? '<span style="color:#b91c1c;font-weight:700">СРОЧНО </span>'
        : '';
      const no = e.registry_no ? `№ ${esc(String(e.registry_no))} · ` : '';
      const title = esc(String(e.title || e.subject || 'Тендер'));
      const deadline = e.deadline
        ? `<div style="font-size:12px;color:#6b7280">Срок: ${esc(String(e.deadline))}</div>`
        : '';
      return `<div style="padding:7px 0;border-bottom:1px solid #eef1f6">
        <div style="font-size:14px">${urgent}${no}<b>${title}</b></div>${deadline}</div>`;
    }).join('');
    return `<div style="margin:16px 0 6px;font-size:13px;font-weight:800;color:#1b2a4a;letter-spacing:.04em">
        ${esc(s.title.toUpperCase())} (${s.items.length})
      </div>${items}`;
  }).join('');

  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Тендеры</title></head>
<body style="margin:0;padding:20px;background:#f5f7fb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;border:1px solid #e5e9f0">
    <div style="font-size:11px;color:#6b7280;letter-spacing:.06em;text-transform:uppercase">Асгард-Сервис</div>
    <div style="font-size:22px;font-weight:800;color:#1b2a4a;margin:6px 0 2px">Тендеры · ${esc(windowTitle)}</div>
    <div style="font-size:13px;color:#6b7280;margin-bottom:14px">Событий: ${list.length}</div>
    ${rows || '<div style="font-size:14px;color:#6b7280">Событий нет.</div>'}
  </div>
</body></html>`;
}

/** Текстовая версия — для почтовых клиентов без HTML. */
function buildText(events, meta) {
  const list = Array.isArray(events) ? events : [];
  const sections = groupEvents(list);
  const lines = [];
  lines.push(`Тендеры · ${(meta && meta.window) === 'evening' ? 'итоги дня' : 'план на день'}`);
  lines.push(`Событий: ${list.length}`);
  for (const s of sections) {
    lines.push('');
    lines.push(`${s.title} (${s.items.length})`);
    for (const e of s.items) {
      const urgent = e.urgent ? '[СРОЧНО] ' : '';
      const no = e.registry_no ? `№ ${e.registry_no} · ` : '';
      lines.push(`- ${urgent}${no}${e.title || e.subject || 'Тендер'}`);
      if (e.deadline) lines.push(`  Срок: ${e.deadline}`);
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
  buildText
};
