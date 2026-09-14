/**
 * Единое состояние анкеты рабочего (Edit + Extra + Docs).
 * Закон №0: все поля текущего контура, без урезания справочников.
 */
import {
  emailError, phoneError, innError, dateNotFutureError, lengthInRange,
} from '@/inputs/validators';
import {
  snilsError, passportSeriesError, passportNumberError, passportCodeError,
  normalizeRuPhoneDigits, digitsOf,
} from '@/lib/ruMasks';

/** Объединённый список специальностей (Add + Edit) */
export const ROLE_TAGS = ['слесарь', 'сварщик', 'альпинист', 'мастер', 'ПТО', 'РП'];

export const GENDERS = [
  { value: 'male', label: 'Мужской' },
  { value: 'female', label: 'Женский' },
];

export const CONTRACT_TYPES = [
  { value: '', label: '— не указано —' },
  { value: 'official', label: 'Трудовой договор' },
  { value: 'self_employed', label: 'Самозанятость' },
  { value: 'gph', label: 'ГПХ' },
  { value: 'unofficial', label: 'Без оформления' },
];

export const OFFICIAL_STATUSES = [
  { value: 'active', label: 'Активен' },
  { value: 'unpaid_leave', label: 'Отпуск без сохранения' },
  { value: 'maternity', label: 'Декрет' },
  { value: 'sick_leave', label: 'Больничный' },
  { value: 'fired', label: 'Уволен' },
];

export const MARITAL_OPTIONS = [
  { value: '', label: '— не указано —' },
  { value: 'single', label: 'Не женат/не замужем' },
  { value: 'married', label: 'Женат/замужем' },
  { value: 'divorced', label: 'Разведён(а)' },
];

export const BLOOD_OPTIONS = [
  { value: '', label: '— не указано —' },
  { value: 'O+', label: 'O(I)+' },
  { value: 'O-', label: 'O(I)−' },
  { value: 'A+', label: 'A(II)+' },
  { value: 'A-', label: 'A(II)−' },
  { value: 'B+', label: 'B(III)+' },
  { value: 'B-', label: 'B(III)−' },
  { value: 'AB+', label: 'AB(IV)+' },
  { value: 'AB-', label: 'AB(IV)−' },
];

export const NAV_SECTIONS = [
  { id: 'overview', label: 'Обзор' },
  { id: 'contacts', label: 'Контакты' },
  { id: 'documents', label: 'Документы' },
  { id: 'ppe', label: 'СИЗ' },
  { id: 'work', label: 'Работа' },
  { id: 'permits', label: 'Допуски' },
  { id: 'history', label: 'История' },
  { id: 'notes', label: 'Заметки' },
];

function dateOnly(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  return '';
}

function normalizeGenderInput(g) {
  if (!g) return '';
  const s = String(g).trim().toLowerCase();
  if (['m', 'м', 'male', 'мужской', 'муж'].includes(s)) return 'male';
  if (['f', 'ж', 'female', 'женский', 'жен'].includes(s)) return 'female';
  return '';
}

export function canonRoleTag(v) {
  const t = String(v || '').trim();
  if (!t) return '';
  if (t === 'РП' || t.toLowerCase() === 'рп') return 'РП';
  if (t === 'ПТО' || t.toLowerCase() === 'пто') return 'ПТО';
  const low = t.toLowerCase();
  return ROLE_TAGS.includes(low) ? low : t;
}

export function buildEmployeeForm(e = {}) {
  return {
    fio: e.fio || '',
    phone: normalizeRuPhoneDigits(e.phone || '') || (e.phone || ''),
    email: e.email || '',
    birth_date: dateOnly(e.birth_date),
    gender: normalizeGenderInput(e.gender),
    role_tag: canonRoleTag(e.role_tag),
    position: e.position || '',
    grade: e.grade || '',
    city: e.city || '',
    address: e.address || '',
    hire_date: dateOnly(e.hire_date),
    contract_type: e.contract_type || '',
    is_self_employed: !!e.is_self_employed,
    is_officially_employed: !!e.is_officially_employed,
    inn: digitsOf(e.inn || ''),
    snils: digitsOf(e.snils || ''),
    passport_series: digitsOf(e.passport_series || e.pass_series || '').slice(0, 4),
    passport_number: digitsOf(e.passport_number || e.pass_number || '').slice(0, 6),
    passport_issued: e.passport_issued || '',
    passport_date: dateOnly(e.passport_date),
    passport_code: digitsOf(e.passport_code || '').slice(0, 6),
    registration_address: e.registration_address || '',
    bank_name: e.bank_name || '',
    bik: digitsOf(e.bik || '').slice(0, 9),
    account_number: digitsOf(e.account_number || '').slice(0, 20),
    card_number: digitsOf(e.card_number || '').slice(0, 19),
    salary: e.salary != null ? String(e.salary) : '',
    day_rate: e.day_rate != null ? String(e.day_rate) : '',
    notes: e.notes || '',
    comment: e.comment || '',
    can_exceed_limit: !!e.can_exceed_limit,
    se_yearly_used_initial: e.se_yearly_used_initial != null ? String(e.se_yearly_used_initial) : '0',
    se_monthly_year: e.se_monthly_used_initial?.year != null ? String(e.se_monthly_used_initial.year) : '',
    se_monthly_month: e.se_monthly_used_initial?.month != null ? String(e.se_monthly_used_initial.month) : '',
    se_monthly_amount: e.se_monthly_used_initial?.amount != null ? String(e.se_monthly_used_initial.amount) : '',
    official_salary: e.official_salary != null ? String(e.official_salary) : '',
    official_non_burnable: e.official_non_burnable != null ? String(e.official_non_burnable) : '',
    official_hire_date: dateOnly(e.official_hire_date),
    official_status: e.official_status || 'active',
    official_leave_from: dateOnly(e.official_leave_from),
    official_leave_to: dateOnly(e.official_leave_to),
    use_payee: !!e.se_payee_id,
    se_payee_id: e.se_payee_id || null,
    se_payee_fio: e.se_payee_fio || '',
    se_payee_phone: e.se_payee_phone || '',
    se_payee_inn: e.se_payee_inn || '',
    // Extra
    phone2: normalizeRuPhoneDigits(e.phone2 || '') || (e.phone2 || ''),
    telegram: e.telegram || '',
    spouse_name: e.spouse_name || '',
    spouse_phone: normalizeRuPhoneDigits(e.spouse_phone || '') || (e.spouse_phone || ''),
    relative_name: e.relative_name || '',
    relative_relation: e.relative_relation || '',
    relative_phone: normalizeRuPhoneDigits(e.relative_phone || '') || (e.relative_phone || ''),
    education: e.education || '',
    specialty: e.specialty || '',
    marital_status: e.marital_status || '',
    children_count: e.children_count ?? '',
    clothing_size: e.clothing_size || '',
    shoe_size: e.shoe_size || '',
    headwear_size: e.headwear_size || '',
    height: e.height ?? '',
    blood_type: e.blood_type || '',
    medical_notes: e.medical_notes || '',
    // Docs
    military_id: e.military_id || '',
    driver_license: e.driver_license || '',
    docs_url: e.docs_url || e.docs_folder_link || '',
    // Field-visible
    naks: e.naks || e.naks_number || '',
    naks_expiry: dateOnly(e.naks_expiry),
    imt_number: e.imt_number || '',
    imt_expires: dateOnly(e.imt_expires),
  };
}

export function employeeFieldErrors(form) {
  return {
    fio: lengthInRange(form.fio, null, 255),
    email: emailError(form.email),
    phone: phoneError(form.phone),
    phone2: phoneError(form.phone2),
    spouse_phone: phoneError(form.spouse_phone),
    relative_phone: phoneError(form.relative_phone),
    inn: innError(form.inn),
    snils: snilsError(form.snils),
    birth_date: dateNotFutureError(form.birth_date, 'Дата рождения'),
    hire_date: dateNotFutureError(form.hire_date, 'Дата приёма'),
    bik: form.bik && form.bik.length !== 9 ? 'БИК — 9 цифр' : null,
    passport_series: passportSeriesError(form.passport_series),
    passport_number: passportNumberError(form.passport_number),
    passport_code: passportCodeError(form.passport_code),
    account_number: form.account_number && form.account_number.length !== 20 ? 'Счёт — 20 цифр' : null,
    salary: form.salary && Number(form.salary) < 0 ? 'Оклад ≥ 0' : null,
    day_rate: form.day_rate && Number(form.day_rate) < 0 ? 'Ставка ≥ 0' : null,
  };
}

/**
 * Payload для PUT /api/staff/employees/:id
 * @param {object} form
 * @param {{ canEditFinance?: boolean }} opts
 */
export function buildEmployeePayload(form, opts = {}) {
  const { canEditFinance = false } = opts;
  const payload = {};
  Object.entries(form).forEach(([k, v]) => {
    if (typeof v === 'string') payload[k] = v.trim() || null;
    else payload[k] = v;
  });

  ['salary', 'day_rate'].forEach((k) => {
    if (payload[k] === '' || payload[k] === null) payload[k] = null;
    else payload[k] = Number(payload[k]);
  });
  if (payload.children_count === '' || payload.children_count == null) payload.children_count = null;
  else payload.children_count = Number(payload.children_count);
  if (payload.height === '' || payload.height == null) payload.height = null;
  else payload.height = Number(payload.height);

  // Дубли passport → pass_* для старых записей
  if (payload.passport_series) payload.pass_series = payload.passport_series;
  if (payload.passport_number) payload.pass_number = payload.passport_number;

  if (canEditFinance) {
    const yi = Number(form.se_yearly_used_initial || 0);
    payload.se_yearly_used_initial = Number.isFinite(yi) && yi >= 0 ? yi : 0;
    const monY = Number(form.se_monthly_year);
    const monM = Number(form.se_monthly_month);
    const monA = Number(form.se_monthly_amount);
    payload.se_monthly_used_initial =
      (monY && monM && monA && monM >= 1 && monM <= 12 && monA >= 0)
        ? { year: monY, month: monM, amount: monA }
        : null;
    payload.can_exceed_limit = !!form.can_exceed_limit;
    payload.official_salary = form.official_salary ? Number(form.official_salary) : null;
    payload.official_non_burnable = form.official_non_burnable ? Number(form.official_non_burnable) : null;
    payload.official_hire_date = form.official_hire_date || null;
    payload.official_status = form.official_status || 'active';
    payload.official_leave_from = form.official_status === 'unpaid_leave' ? (form.official_leave_from || null) : null;
    payload.official_leave_to = form.official_status === 'unpaid_leave' ? (form.official_leave_to || null) : null;
  } else {
    delete payload.se_yearly_used_initial;
    delete payload.can_exceed_limit;
    delete payload.official_salary;
    delete payload.official_non_burnable;
    delete payload.official_hire_date;
    delete payload.official_status;
    delete payload.official_leave_from;
    delete payload.official_leave_to;
  }
  delete payload.se_monthly_year;
  delete payload.se_monthly_month;
  delete payload.se_monthly_amount;

  if (canEditFinance) {
    if (form.use_payee && form.se_payee_id) {
      payload.se_payee_id = Number(form.se_payee_id);
      payload.is_self_employed = false;
    } else {
      payload.se_payee_id = null;
    }
  } else {
    // Не-FIN: не трогаем se_payee_id и не сбрасываем СЗ из-за UI-флага use_payee
    delete payload.se_payee_id;
  }
  delete payload.use_payee;
  delete payload.se_payee_fio;
  delete payload.se_payee_phone;
  delete payload.se_payee_inn;

  return payload;
}

function filled(v) {
  return v != null && String(v).trim() !== '';
}

/**
 * Completeness groups (OR внутри группы).
 * @returns {{ pct: number, criticalGaps: string[], softGaps: string[], sectionHints: Record<string,string[]> }}
 */
export function computeCompleteness(form) {
  const critical = [
    { id: 'fio', ok: filled(form.fio), label: 'ФИО', section: 'contacts' },
    { id: 'phone', ok: filled(form.phone), label: 'Телефон', section: 'contacts' },
    { id: 'birth', ok: filled(form.birth_date), label: 'Дата рождения', section: 'contacts' },
    { id: 'address', ok: filled(form.address) || filled(form.registration_address), label: 'Адрес', section: 'contacts' },
    { id: 'passport', ok: filled(form.passport_series) && filled(form.passport_number), label: 'Паспорт', section: 'documents' },
    { id: 'ppe', ok: filled(form.clothing_size) && filled(form.shoe_size), label: 'СИЗ (одежда+обувь)', section: 'ppe' },
  ];
  const soft = [
    { id: 'headwear', ok: filled(form.headwear_size), label: 'Каска', section: 'ppe' },
    { id: 'passport_meta', ok: filled(form.passport_issued) && filled(form.passport_date), label: 'Паспорт: кем/когда', section: 'documents' },
    { id: 'passport_code', ok: filled(form.passport_code), label: 'Код подразделения', section: 'documents' },
    { id: 'phone2', ok: filled(form.phone2), label: 'Доп. телефон', section: 'contacts' },
    { id: 'emergency', ok: (filled(form.spouse_name) && filled(form.spouse_phone)) || (filled(form.relative_name) && filled(form.relative_phone)), label: 'Экстренный контакт', section: 'contacts' },
    { id: 'snils', ok: filled(form.snils), label: 'СНИЛС', section: 'documents' },
    { id: 'bank', ok: filled(form.bank_name) && filled(form.bik), label: 'Банк', section: 'work' },
    { id: 'blood', ok: filled(form.blood_type), label: 'Группа крови', section: 'ppe' },
  ];
  if (form.is_self_employed) {
    soft.unshift({ id: 'inn', ok: filled(form.inn), label: 'ИНН (СЗ)', section: 'work' });
  }

  const criticalGaps = critical.filter((g) => !g.ok).map((g) => g.label);
  const softGaps = soft.filter((g) => !g.ok).map((g) => g.label);
  const done = critical.filter((g) => g.ok).length + soft.filter((g) => g.ok).length;
  const total = critical.length + soft.length;
  const pct = total ? Math.round((done / total) * 100) : 100;

  const sectionHints = {};
  [...critical, ...soft].filter((g) => !g.ok).forEach((g) => {
    if (!sectionHints[g.section]) sectionHints[g.section] = [];
    sectionHints[g.section].push(g.label);
  });

  return { pct, criticalGaps, softGaps, sectionHints, criticalOk: criticalGaps.length === 0 };
}

/** Поля, которые может править рабочий в Field (без допусков / HR readiness) */
export const FIELD_SELF_EDIT_KEYS = [
  'fio', 'phone', 'phone2', 'email', 'telegram',
  'birth_date', 'gender', 'city', 'address', 'registration_address',
  'passport_series', 'passport_number', 'passport_issued', 'passport_date', 'passport_code',
  'inn', 'snils',
  'clothing_size', 'shoe_size', 'headwear_size',
  'spouse_name', 'spouse_phone',
  'relative_name', 'relative_relation', 'relative_phone',
  'education', 'specialty', 'marital_status', 'children_count',
  'blood_type', 'height', 'medical_notes',
  'bank_name', 'bik', 'account_number', 'card_number',
  'is_self_employed',
  'naks', 'naks_expiry', 'imt_number', 'imt_expires',
];
