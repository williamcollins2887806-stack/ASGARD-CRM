/**
 * Российские маски: телефон, паспорт, СНИЛС, код подразделения.
 * Хранение: digits (телефон/ИНН) или нормализованные строки.
 * Отображение: человекочитаемый формат.
 */

export function digitsOf(v) {
  return String(v || '').replace(/\D/g, '');
}

/** 8XXXXXXXXXX / 9XXXXXXXXX → 7XXXXXXXXXX (11 цифр) или null */
export function normalizeRuPhoneDigits(raw) {
  let d = digitsOf(raw);
  if (!d) return '';
  if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  if (d.length > 11) d = d.slice(0, 11);
  return d;
}

/**
 * Отображение: +7(916)-061-48-09
 * value — digits (предпочтительно) или любая строка с цифрами.
 */
export function formatRuPhoneDisplay(raw) {
  const d = normalizeRuPhoneDigits(raw);
  if (!d) return '';
  if (d.length <= 1) return '+7';
  const rest = d.startsWith('7') ? d.slice(1) : d;
  if (rest.length <= 3) return `+7(${rest}`;
  if (rest.length <= 6) return `+7(${rest.slice(0, 3)})-${rest.slice(3)}`;
  if (rest.length <= 8) return `+7(${rest.slice(0, 3)})-${rest.slice(3, 6)}-${rest.slice(6)}`;
  return `+7(${rest.slice(0, 3)})-${rest.slice(3, 6)}-${rest.slice(6, 8)}-${rest.slice(8, 10)}`;
}

/** СНИЛС: XXX-XXX-XXX XX */
export function formatSnilsDisplay(raw) {
  const d = digitsOf(raw).slice(0, 11);
  if (!d) return '';
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6, 9)} ${d.slice(9)}`;
}

/** Код подразделения: XXX-XXX */
export function formatPassportCodeDisplay(raw) {
  const d = digitsOf(raw).slice(0, 6);
  if (!d) return '';
  if (d.length <= 3) return d;
  return `${d.slice(0, 3)}-${d.slice(3)}`;
}

export function snilsError(v) {
  if (v == null || String(v).trim() === '') return null;
  const d = digitsOf(v);
  return d.length === 11 ? null : 'СНИЛС — 11 цифр';
}

export function passportSeriesError(v) {
  if (v == null || String(v).trim() === '') return null;
  return digitsOf(v).length === 4 ? null : 'Серия — 4 цифры';
}

export function passportNumberError(v) {
  if (v == null || String(v).trim() === '') return null;
  return digitsOf(v).length === 6 ? null : 'Номер — 6 цифр';
}

export function passportCodeError(v) {
  if (v == null || String(v).trim() === '') return null;
  return digitsOf(v).length === 6 ? null : 'Код подразделения — 6 цифр (XXX-XXX)';
}
