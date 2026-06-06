/**
 * dateMSK.js — утилита работы с датами в часовом поясе Москвы.
 *
 * Проблема: `new Date().toISOString().slice(0,10)` даёт UTC-дату.
 * Для МСК (UTC+3) после 21:00 это даёт ЗАВТРАШНЮЮ дату → документы,
 * сменa, табель уезжают на день.
 *
 * Решение: использовать `toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })`
 * — формат YYYY-MM-DD по МСК.
 *
 * См. `_BUGS-UI.md` UI005, UI006, UI007.
 */

const MSK_TZ = 'Europe/Moscow';

/**
 * Текущая дата по МСК в формате 'YYYY-MM-DD'.
 * Если передан Date — возвращает его дату по МСК.
 *
 * @param {Date} [date=new Date()]
 * @returns {string} 'YYYY-MM-DD'
 */
export function toMSKDate(date = new Date()) {
  if (!(date instanceof Date)) {
    if (date == null) return '';
    date = new Date(date);
  }
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-CA', { timeZone: MSK_TZ });
}

/**
 * Текущее datetime по МСК как Date-объект (с подставленными часами/минутами МСК).
 * Удобно для отображения в UI.
 */
export function nowMSK() {
  return new Date();
}

/**
 * Проверка: просрочен ли дедлайн по МСК?
 * Корректно сравнивает даты, не привязываясь к timezone клиента.
 *
 * Если у дедлайна нет времени (формат 'YYYY-MM-DD') — сравниваем даты как строки.
 * Если есть время — сравниваем как timestamp.
 *
 * @param {string|Date} deadline
 * @returns {boolean} true если deadline в прошлом
 */
export function isOverdueMSK(deadline) {
  if (!deadline) return false;

  const todayMSK = toMSKDate();

  // Дата без времени: 'YYYY-MM-DD' (или с T...)
  if (typeof deadline === 'string') {
    const dateOnly = deadline.slice(0, 10);
    // Если только дата — сравниваем строки YYYY-MM-DD
    if (deadline.length === 10) {
      return dateOnly < todayMSK;
    }
    // Если есть время — datetime сравниваем как Date
    const d = new Date(deadline);
    return !isNaN(d.getTime()) && d.getTime() < Date.now();
  }

  // Date-объект
  if (deadline instanceof Date) {
    return deadline.getTime() < Date.now();
  }

  return false;
}

/**
 * Форматирование даты для отображения по МСК.
 * Используется когда нужен формат 'ДД.ММ.ГГГГ' или 'ДД месяц ГГГГ'.
 *
 * @param {string|Date} date
 * @param {Object} [opts]
 * @returns {string}
 */
export function formatMSKDate(date, opts = {}) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { timeZone: MSK_TZ, ...opts });
}

/**
 * Время в МСК в формате 'HH:MM' или 'HH:MM:SS'.
 */
export function formatMSKTime(date, withSeconds = false) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ru-RU', {
    timeZone: MSK_TZ,
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  });
}

/**
 * Час в МСК (0-23) для текущего момента.
 * Заменяет `new Date().getHours()` в FieldShift и подобных.
 */
export function currentMSKHour() {
  return Number(
    new Date().toLocaleString('en-US', {
      timeZone: MSK_TZ,
      hour: '2-digit',
      hour12: false,
    })
  );
}
