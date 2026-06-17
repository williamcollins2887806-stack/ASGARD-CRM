/**
 * WorkersSchedule — константы и helpers.
 */
export const STATUS_LIST = [
  { code: 'office',  label: 'Офис',                color: 'var(--blue)',   short: 'О' },
  { code: 'trip',    label: 'Командировка',        color: 'var(--purple)', short: 'К' },
  { code: 'work',    label: 'Работа (контракт)',   color: 'var(--ok)',     short: 'Р' },
  { code: 'note',    label: 'Заметка',             color: 'var(--amber)',  short: 'З' },
  { code: 'reserve', label: 'Бронь',               color: 'var(--purple)', short: 'Б' }
];

export const STATUS_BY_CODE = Object.fromEntries(STATUS_LIST.map((s) => [s.code, s]));

export function fmtDateIso(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
