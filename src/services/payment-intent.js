'use strict';

/**
 * V404 (Часть II, замечание заказчика 17.10.2026): распознать СРОК ОПЛАТЫ из
 * тела письма инициатора и превратить его в конкретное поле заявки.
 * ═══════════════════════════════════════════════════════════════════════════
 * Инициатор пишет бухгалтерии в теле письма простым языком:
 *   • «настя оплати завтра»            → срочно, срок = завтра (рабочий)
 *   • «оплати срочно / сегодня»        → срочно, без отложенной даты
 *   • «оплата через 2 месяца»          → отложенная, срок = +2 месяца
 *   • «оплата после получения груза»   → отложенная, срок «по факту поставки»
 *   • «оплатить до 20.10.2026»         → конкретная дата
 *
 * ВАЖНО: НЕ путать с согласием директора («Добро», «Согласовано») — это РАЗНЫЕ
 * вещи: согласие живёт в approval-detector (fail-closed whitelist), а здесь —
 * только СРОК. Письмо инициатора не может согласовать оплату.
 *
 * Возвращаем структуру, которую кладём в payment_invoices.pay_timing + due_date
 * и показываем бухгалтерии отдельной строкой «Просьба инициатора».
 */

/** Рабочий день: сдвиг на понедельник, если попали в выходные (без work_calendar). */
function nextWorkday(d) {
  const x = new Date(d.getTime());
  while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() + 1);
  return x;
}
const iso = (d) => d.toISOString().slice(0, 10);

const MONTHS = {
  январь: 1, января: 1, февраль: 2, февраля: 2, март: 3, марта: 3,
  апрель: 4, апреля: 4, май: 5, мая: 5, июнь: 6, июня: 6, июль: 7, июля: 7,
  август: 8, августа: 8, сентябрь: 9, сентября: 9, октябрь: 10, октября: 10,
  ноябрь: 11, ноября: 11, декабрь: 12, декабря: 12
};

/**
 * Разобрать срок оплаты из текста письма.
 * @param {string} text
 * @param {Date} [now]
 * @returns {{timing:'immediate'|'deferred', due_date:string|null, urgent:boolean,
 *   shipment_based:boolean, intent:string, matched:string|null}}
 */
function parsePaymentIntent(text, now = new Date()) {
  const raw = String(text || '');
  // Обрезаем цитируемую переписку — там старое «до 20.10» прошлых писем.
  // Берём только «свой» текст до первой строки-цитаты (иначе старые сроки побеждают).
  const t = raw.split(/\n(?=>|—{2,}|_{2,}|От:|From:|Кому:|Тема:)/m)[0] || raw;
  const out = { timing: 'immediate', due_date: null, urgent: false, shipment_based: false, intent: 'none', matched: null };
  if (!t || t.trim().length < 3) return out;

  const set = (m, patch) => { out.matched = m[0].trim().slice(0, 60); Object.assign(out, patch); return out; };

  // 1. «после получения груза/товара/поставки» — срок по факту, не дата.
  let m = t.match(/(?:после|по\s+факту)\s+(?:получени[яю]|поставки|отгрузки|при[её]мки|доставки)[^\n.]{0,40}/i);
  if (m) return set(m, { timing: 'deferred', due_date: null, shipment_based: true, intent: 'after_delivery' });

  // 2. Явная дата: «оплатить до 20.10.2026», «оплата до 20.10», «до 5 ноября».
  m = t.match(/(?:оплат\w*\s+до|до)\s*(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/i);
  if (m) {
    const yy = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(now.getFullYear());
    return set(m, { timing: 'deferred', due_date: `${yy}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`, intent: 'explicit_date' });
  }
  m = t.match(/(?:оплат\w*\s+до|до)\s*(\d{1,2})\s+([а-яё]+)/i);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) return set(m, { timing: 'deferred', due_date: `${now.getFullYear()}-${String(mm).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`, intent: 'explicit_date' });
  }

  // 3. Относительный срок: «через 2 месяца», «через 10 дней», «через неделю».
  m = t.match(/через\s+(\d{1,3})\s*(месяц[а-яё]*|дн[а-яё]*|недел[а-яё]*|год[а-яё]*)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    const d = new Date(now.getTime());
    addRelative(d, n, m[2]);
    return set(m, { timing: 'deferred', due_date: iso(nextWorkday(d)), intent: 'relative' });
  }
  // «через неделю / через месяц / через день» — без числа (n = 1).
  m = t.match(/через\s+(месяц[а-яё]*|недел[а-яё]*|день|несколько\s+дней)/i);
  if (m) {
    const d = new Date(now.getTime());
    addRelative(d, 1, m[1]);
    if (/несколько/i.test(m[1])) d.setDate(d.getDate() + 3);
    return set(m, { timing: 'deferred', due_date: iso(nextWorkday(d)), intent: 'relative' });
  }

  // 4. Срочность: «срочно», «сегодня», «завтра», «не задерживать».
  // ВАЖНО: \b и \w в JS не работают с кириллицей (она не входит в \w) — границы
  // и хвосты задаём явными классами, иначе «завтра»/«задерживайте» не находятся.
  const B = '(?:^|[^а-яё])';   // начало слова
  const E = '(?![а-яё])';      // конец слова
  m = t.match(new RegExp(B + '(срочно|срочн[а-яё]*|как\\s+можно\\s+быстрее|не\\s+задержива[а-яё]*|в\\s+приоритете|немедленно)' + E, 'i'));
  if (m) return set(m, { timing: 'immediate', urgent: true, intent: 'urgent' });

  m = t.match(new RegExp(B + '(сегодня)' + E, 'i'));
  if (m) return set(m, { timing: 'immediate', urgent: true, due_date: iso(nextWorkday(now)), intent: 'today' });

  m = t.match(new RegExp(B + '(завтра)' + E, 'i'));
  if (m) {
    const d = new Date(now.getTime()); d.setDate(d.getDate() + 1);
    return set(m, { timing: 'immediate', urgent: true, due_date: iso(nextWorkday(d)), intent: 'tomorrow' });
  }

  // 5. «оплата в течение N дней» — отложенная.
  m = t.match(/в\s+течение\s+(\d{1,3})\s*(?:рабочих\s+)?(дн[а-яё]*|недел[а-яё]*|месяц[а-яё]*)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    const d = new Date(now.getTime());
    addRelative(d, n, m[2]);
    return set(m, { timing: 'deferred', due_date: iso(nextWorkday(d)), intent: 'within' });
  }

  return out;
}

/** Прибавить относительный срок к дате (месяцы/недели/дни/годы). */
function addRelative(d, n, unit) {
  const u = String(unit || '').toLowerCase();
  if (u.startsWith('месяц')) d.setMonth(d.getMonth() + n);
  else if (u.startsWith('недел')) d.setDate(d.getDate() + n * 7);
  else if (u.startsWith('год')) d.setFullYear(d.getFullYear() + n);
  else d.setDate(d.getDate() + n);
  return d;
}

/** Короткая человеческая подпись для карточки и письма бухгалтерии. */
function intentLabel(intent) {
  return ({
    urgent: 'Срочно (оплатить сразу)',
    today: 'Просили оплатить сегодня',
    tomorrow: 'Просили оплатить завтра',
    explicit_date: 'Просили оплатить к дате',
    relative: 'Отложенная (срок из письма)',
    within: 'Отложенная (срок из письма)',
    after_delivery: 'Оплата после получения груза',
    none: '—'
  })[intent] || '—';
}

module.exports = { parsePaymentIntent, intentLabel };
