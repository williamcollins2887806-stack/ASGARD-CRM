/**
 * Общие валидаторы для форм/модалок CRM v2.
 *
 * Принципы:
 *   • Каждая функция возвращает строку с сообщением об ошибке (для отображения),
 *     либо null/undefined если значение валидно (или пустое + не required).
 *   • Не выбрасывает ошибок и не зависит от React — годится для useMemo / on-submit
 *     guards / Field error= prop.
 *   • Пустая строка / null / undefined считаются «не заполнено» и пропускаются
 *     (required-проверка — отдельная). Так одна валидация = одна ответственность.
 *
 * Используется на формах: Customer, Supplier, SelfEmployed, OfficialEmployee,
 * Personnel, User, Contract, Tender, Invoice, Act, Cash, OneTimePay, BonusRequest,
 * Travel, PassRequest, Meeting, Reminder, Birthdays, FinanceLimits, OfficeExpense,
 * Procurement etc.
 *
 * G-4 (14.06.2026): добавлены недостающие проверки —
 *   email формата (regex), ИНН контрольная сумма, телефон (10 цифр без +7),
 *   дата start≤end, сумма >0, проценты 0-100, длина, trim-пустота, кросс-полевые.
 */

/* ─────────────────── строки ─────────────────── */

/** trim + проверка непустоты (для проверки «не строка из пробелов») */
export function isBlank(v) {
  return v == null || String(v).trim() === '';
}

/** Длина строки в пределах [min..max] (включительно). Пустая строка пропускается. */
export function lengthInRange(v, min, max) {
  if (isBlank(v)) return null;
  const s = String(v);
  if (min != null && s.length < min) return `Минимум ${min} симв.`;
  if (max != null && s.length > max) return `Максимум ${max} симв.`;
  return null;
}

/* ─────────────────── email ─────────────────── */

/**
 * Простой regex, исключающий «foo@bar» (без TLD), «foo@bar.», «a@@b.ru».
 * Требует: локальную часть (≥1 символ), @, домен с минимум одной точкой,
 * TLD длиной 2+ латинских буквы.
 *
 * Не пытается покрыть RFC 5322 полностью — это анти-паттерн.
 * Поведение совпадает с тем, что принимает большинство бэков
 * (Fastify валидирует email похожим regex, см. src/routes/users.js).
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/i;

export function isValidEmail(v) {
  if (isBlank(v)) return true; // пустое — отдельная required-проверка
  return EMAIL_RE.test(String(v).trim());
}

/** Возвращает сообщение об ошибке или null */
export function emailError(v) {
  if (isBlank(v)) return null;
  return isValidEmail(v) ? null : 'Неверный формат email (нужно user@domain.ru)';
}

/* ─────────────────── телефон ─────────────────── */

/**
 * Проверка телефона: после удаления нецифровых символов должно быть ровно 11 цифр
 * (российский номер с кодом страны +7/8). Совместимо с PhoneInput из Inputs.jsx,
 * который хранит «голые» 11 цифр.
 *
 * Также допускаем 10 цифр на случай пустого префикса +7 (PhoneInput всегда подставляет 7,
 * но при редактировании старых записей встречалось).
 */
export function digitsOf(v) {
  return String(v || '').replace(/\D/g, '');
}

export function isValidPhone(v) {
  if (isBlank(v)) return true;
  const d = digitsOf(v);
  return d.length === 10 || d.length === 11;
}

export function phoneError(v) {
  if (isBlank(v)) return null;
  return isValidPhone(v) ? null : 'Телефон должен содержать 10-11 цифр';
}

/* ─────────────────── ИНН ─────────────────── */

/**
 * Контрольная сумма ИНН по приказу ФНС России от 29.06.2012 № ММВ-7-6/435@.
 *
 *   • 10 цифр (юр.лицо): K = (Σ Cᵢ · Wᵢ) mod 11 mod 10, где W=[2,4,10,3,5,9,4,6,8],
 *     K сравнивается с 10-й цифрой.
 *   • 12 цифр (ИП/самозанятый): две контрольные цифры.
 *     K11 = (Σ Cᵢ · W11) mod 11 mod 10, W11=[7,2,4,10,3,5,9,4,6,8].
 *     K12 = (Σ Cᵢ · W12) mod 11 mod 10, W12=[3,7,2,4,10,3,5,9,4,6,8].
 */
function innChecksum10(d) {
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const s = w.reduce((a, wi, i) => a + wi * Number(d[i]), 0);
  return (s % 11) % 10;
}

function innChecksum12(d) {
  const w11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const w12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const k11 = (w11.reduce((a, wi, i) => a + wi * Number(d[i]), 0) % 11) % 10;
  const k12 = (w12.reduce((a, wi, i) => a + wi * Number(d[i]), 0) % 11) % 10;
  return { k11, k12 };
}

/**
 * Длина и контрольная сумма ИНН.
 * @param {'any'|'org'|'person'} kind — 'org' = только 10 цифр, 'person' = только 12, 'any' = и то, и другое.
 */
export function isValidInn(v, kind = 'any') {
  if (isBlank(v)) return true;
  const d = digitsOf(v);
  if (kind === 'org' && d.length !== 10) return false;
  if (kind === 'person' && d.length !== 12) return false;
  if (kind === 'any' && d.length !== 10 && d.length !== 12) return false;
  if (d.length === 10) {
    return innChecksum10(d) === Number(d[9]);
  }
  if (d.length === 12) {
    const { k11, k12 } = innChecksum12(d);
    return k11 === Number(d[10]) && k12 === Number(d[11]);
  }
  return false;
}

export function innError(v, kind = 'any') {
  if (isBlank(v)) return null;
  const d = digitsOf(v);
  if (kind === 'org' && d.length !== 10) return 'ИНН организации — 10 цифр';
  if (kind === 'person' && d.length !== 12) return 'ИНН самозанятого/ИП — 12 цифр';
  if (kind === 'any' && d.length !== 10 && d.length !== 12) return 'ИНН — 10 или 12 цифр';
  if (!isValidInn(v, kind)) return 'ИНН не прошёл контрольную сумму';
  return null;
}

/* ─────────────────── даты ─────────────────── */

/** Парс ISO YYYY-MM-DD в Date без time-зоны (полночь UTC). */
function parseISODate(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const dt = new Date(s + 'T00:00:00');
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

/** Сегодня в UTC, без времени. */
function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** start ≤ end. Пустые пропускаются. */
export function dateRangeError(start, end, labels = {}) {
  const a = parseISODate(start);
  const b = parseISODate(end);
  if (!a || !b) return null;
  if (b < a) {
    const sName = labels.start || 'Дата начала';
    const eName = labels.end || 'Дата окончания';
    return `${eName} не может быть раньше «${sName.toLowerCase()}»`;
  }
  return null;
}

/** Дата не в прошлом (для дедлайнов). */
export function dateNotPastError(v, label = 'Дата') {
  const d = parseISODate(v);
  if (!d) return null;
  if (d < todayUTC()) return `${label} не может быть в прошлом`;
  return null;
}

/** Дата не в будущем (для факт-дат). */
export function dateNotFutureError(v, label = 'Дата') {
  const d = parseISODate(v);
  if (!d) return null;
  if (d > todayUTC()) return `${label} не может быть в будущем`;
  return null;
}

/* ─────────────────── числа ─────────────────── */

/** Парс «1 234,56» / «1 234.56» / «1234.56» → Number или NaN. */
export function parseMoney(v) {
  if (v == null || v === '') return NaN;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/** Положительное число (>0). */
export function isPositive(v) {
  const n = parseMoney(v);
  return Number.isFinite(n) && n > 0;
}

/** Сообщение об ошибке для суммы (>0). */
export function positiveAmountError(v, label = 'Сумма') {
  if (isBlank(v)) return null;
  const n = parseMoney(v);
  if (!Number.isFinite(n)) return `${label} должна быть числом`;
  if (n <= 0) return `${label} должна быть больше 0`;
  return null;
}

/** Число в диапазоне [min..max]. */
export function rangeError(v, min, max, label = 'Значение') {
  if (isBlank(v)) return null;
  const n = parseMoney(v);
  if (!Number.isFinite(n)) return `${label} должно быть числом`;
  if (min != null && n < min) return `${label} ≥ ${min}`;
  if (max != null && n > max) return `${label} ≤ ${max}`;
  return null;
}

/** Процент 0..100. */
export function percentError(v, label = 'Процент') {
  return rangeError(v, 0, 100, label);
}

/* ─────────────────── url ─────────────────── */

export function isValidUrl(v) {
  if (isBlank(v)) return true;
  try {
    const u = new URL(String(v).trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function urlError(v) {
  if (isBlank(v)) return null;
  return isValidUrl(v) ? null : 'Введите корректный URL (https://…)';
}

/* ─────────────────── батч ─────────────────── */

/**
 * Собирает первую ошибку по списку проверок.
 * Используется как «return-on-first-error» гард на submit.
 *
 *   const err = firstError([
 *     [isBlank(form.fio), 'ФИО обязательно'],
 *     [emailError(form.email)],
 *     [phoneError(form.phone)],
 *     [innError(form.inn, 'org')],
 *   ]);
 *   if (err) { toast.error(err); return; }
 */
export function firstError(checks) {
  for (const c of checks) {
    if (Array.isArray(c)) {
      if (c.length === 2 && c[0] && typeof c[1] === 'string') {
        // [bool, msg]
        if (c[0]) return c[1];
      } else if (c.length === 1 && typeof c[0] === 'string') {
        // [msg|null]
        if (c[0]) return c[0];
      } else if (c.length === 1 && c[0] == null) {
        continue;
      }
    } else if (typeof c === 'string') {
      return c;
    }
  }
  return null;
}
