'use strict';

/**
 * msk — работа с московским временем без Intl на горячем пути.
 *
 * Европейская часть РФ живёт в фиксированном UTC+3 без перехода на летнее время,
 * поэтому смещение — константа. Это дешевле, чем Intl.DateTimeFormat, который
 * вызывался бы на каждый API-запрос (учёт активности СРМ).
 */

const MSK_OFFSET_MIN = 180;
const MSK_TZ = 'Europe/Moscow';

function pad2(n) { return String(n).padStart(2, '0'); }

/** Текущая московская дата 'YYYY-MM-DD'. */
function mskDay(nowMs) {
  const t = (nowMs == null ? Date.now() : nowMs) + MSK_OFFSET_MIN * 60000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Текущая московская минута 'YYYY-MM-DDTHH:mm'. */
function mskMinuteStr(nowMs) {
  const t = (nowMs == null ? Date.now() : nowMs) + MSK_OFFSET_MIN * 60000;
  const d = new Date(t);
  return `${mskDay(nowMs)}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * 'HH:mm' из значения колонки PostgreSQL типа `timestamp without time zone`.
 *
 * ТОНКОСТЬ (верификатор 03.11.2026, P1-5): `pg` разбирает `timestamp without
 * time zone` как ЛОКАЛЬНОЕ время процесса. На сервере с TZ=Europe/Moscow
 * значение «2026-11-03 23:55» приходит как Date(2026-11-03T20:55:00Z), и
 * `getUTCHours()` даёт 20:55 вместо 23:55. Все минуты съезжали на 3 часа,
 * ночные склеивались с вечерними: 2 минуты факта превращались в 11 минут зачёта.
 *
 * Поэтому для «наивных» timestamp-ов берём ЛОКАЛЬНЫЕ компоненты (они ровно те,
 * что записаны в БД), а не UTC.
 */
function hhmmWallClock(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const m = /(\d{2}):(\d{2})/.exec(value);
    return m ? `${m[1]}:${m[2]}` : null;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Наивный 'YYYY-MM-DD HH:mm:ss' для записи в `timestamp without time zone`.
 * Собирается из локальных компонент — ровно то, что потом прочитается обратно.
 */
function wallClockStamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
         `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * ISO-строка для jsonb-поля `segments`: '2026-10-26T10:23:29.000Z'.
 *
 * ЗАЧЕМ отдельная функция (верификатор 03.11.2026, P1-5 остаток): парсер
 * пишет segments как ISO (new Date(Date.UTC(...)).toISOString()), а
 * `recountPerson` после ручной привязки ФИО писал «наивную» строку
 * '2026-10-26 10:08:49'. Интерфейс читает оба варианта одним кодом через
 * `getUTCHours()` — и для «наивной» строки получал сдвиг на −3 часа
 * (11:19 вместо 14:19). В jsonb должен быть ОДИН формат.
 *
 * Берём локальные компоненты (они равны записанному в БД времени) и
 * собираем из них UTC — ровно так же, как это делает парсер.
 */
function isoFromWallClock(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const utc = Date.UTC(
    d.getFullYear(), d.getMonth(), d.getDate(),
    d.getHours(), d.getMinutes(), d.getSeconds()
  );
  return new Date(utc).toISOString();
}

module.exports = {
  MSK_TZ, MSK_OFFSET_MIN, mskDay, mskMinuteStr,
  hhmmWallClock, wallClockStamp, isoFromWallClock, pad2
};
