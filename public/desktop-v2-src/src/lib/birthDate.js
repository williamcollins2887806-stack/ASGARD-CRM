/**
 * Дата рождения: гибкий разбор (вставка из паспорта/Excel) + возраст + флаг УМО.
 */

const UMO_AGE = 45;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toYmd(y, m, d) {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function expandYear(y) {
  const n = Number(y);
  if (n >= 100) return n;
  // Для ДР рабочих: 00–30 → 2000–2030, иначе 19xx
  return n <= 30 ? 2000 + n : 1900 + n;
}

/**
 * Разобрать дату из типичных форматов буфера обмена.
 * @param {string|Date|null|undefined} raw
 * @returns {string|null} YYYY-MM-DD
 */
export function parseFlexibleDate(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return toYmd(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }

  const s = String(raw).trim();
  if (!s) return null;

  // ISO / HTML date: 1980-03-15…
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return toYmd(m[1], m[2], m[3]);

  // дд.мм.гггг / дд/мм/гггг / дд-мм-гггг (и 2-значный год)
  m = /^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})\b/.exec(s);
  if (m) return toYmd(expandYear(m[3]), m[2], m[1]);

  // Только цифры: ДДММГГГГ или ГГГГММДД
  const digits = s.replace(/\D/g, '');
  if (digits.length === 8) {
    const asYmd = toYmd(digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8));
    if (asYmd) return asYmd;
    return toYmd(digits.slice(4, 8), digits.slice(2, 4), digits.slice(0, 2));
  }

  return null;
}

/**
 * @param {string|Date|null|undefined} birthDate YYYY-MM-DD или Date
 * @param {Date} [now]
 * @returns {number|null}
 */
export function ageFromBirthDate(birthDate, now = new Date()) {
  const ymd = parseFlexibleDate(birthDate);
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let age = today.getFullYear() - y;
  const hadBirthday =
    today.getMonth() + 1 > m ||
    (today.getMonth() + 1 === m && today.getDate() >= d);
  if (!hadBirthday) age -= 1;
  if (age < 0 || age > 130) return null;
  return age;
}

function pluralYears(n) {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return 'лет';
  if (n1 === 1) return 'год';
  if (n1 >= 2 && n1 <= 4) return 'года';
  return 'лет';
}

/** Подпись под полем ДР: «Возраст: 46 лет» */
export function birthAgeHelp(birthDate) {
  const age = ageFromBirthDate(birthDate);
  if (age == null) return null;
  let text = `Возраст: ${age} ${pluralYears(age)}`;
  if (age >= UMO_AGE) text += ' · требуется УМО';
  return text;
}

/** Нужен информационный индикатор УМО (45+) */
export function needsUmo(birthDate) {
  const age = ageFromBirthDate(birthDate);
  return age != null && age >= UMO_AGE;
}

export { UMO_AGE };
