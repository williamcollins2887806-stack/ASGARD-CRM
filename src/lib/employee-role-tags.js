/**
 * Стандартные должности (role_tag) реестра «Дружина».
 * Используется в staff API и может подключаться на фронте.
 */
const EMPLOYEE_ROLE_TAGS = [
  { value: 'слесарь', label: '🔧 Слесарь' },
  { value: 'сварщик', label: '🔥 Сварщик' },
  { value: 'альпинист', label: '🧗 Альпинист' },
  { value: 'мастер', label: '👷 Мастер' },
  { value: 'ПТО', label: '📐 ПТО' },
  { value: 'РП', label: '👑 РП (руководитель)' },
];

const EMPLOYEE_ROLE_TAG_VALUES = EMPLOYEE_ROLE_TAGS.map((r) => r.value);

/** Допустимые field_role в бригаде (employee_assignments.field_role). */
const FIELD_CREW_ROLES = [
  { value: 'worker', label: 'Рабочий' },
  { value: 'welder', label: 'Сварщик' },
  { value: 'pto', label: 'ПТО' },
  { value: 'shift_master', label: 'Мастер смены' },
  { value: 'senior_master', label: 'Ст. мастер' },
  { value: 'project_lead', label: 'Рук. проекта' },
];

const FIELD_CREW_ROLE_VALUES = FIELD_CREW_ROLES.map((r) => r.value);

function isStandardRoleTag(v) {
  const s = String(v || '').trim().toLowerCase();
  return EMPLOYEE_ROLE_TAG_VALUES.some((x) => x.toLowerCase() === s);
}

/** role_tag дружины → field_role бригады (можно переопределить вручную в UI). */
function mapRoleTagToFieldRole(roleTag) {
  const t = String(roleTag || '').trim().toLowerCase();
  if (t === 'сварщик') return 'welder';
  if (t === 'пто' || t === 'pto') return 'pto';
  if (t === 'мастер') return 'shift_master';
  if (t === 'рп' || t === 'руководитель' || t.startsWith('рп')) return 'project_lead';
  return 'worker';
}

function isValidFieldRole(v) {
  return FIELD_CREW_ROLE_VALUES.includes(String(v || ''));
}

/** Тарифы сварщика/ПТО в сетке: «Сварщик (14б)», «ПТО (20б)». */
function isWelderTariffName(name) {
  return /^Сварщик\s*\(/i.test(String(name || '').trim());
}

function isPtoTariffName(name) {
  return /^ПТО\s*\(/i.test(String(name || '').trim());
}

function filterTariffsForFieldRole(tariffs, fieldRole, siteCategory) {
  const list = Array.isArray(tariffs) ? tariffs : [];
  const role = String(fieldRole || 'worker');
  if (role === 'welder') {
    return list.filter((t) => isWelderTariffName(t.position_name || t.label || t.name)
      && (t.category === siteCategory || !siteCategory));
  }
  if (role === 'pto') {
    return list.filter((t) => isPtoTariffName(t.position_name || t.label || t.name)
      && (t.category === siteCategory || !siteCategory));
  }
  return list.filter((t) => {
    const n = t.position_name || t.label || t.name || '';
    if (isWelderTariffName(n) || isPtoTariffName(n)) return false;
    if (siteCategory && t.category && t.category !== siteCategory && t.category !== 'special') return false;
    return !t.is_combinable;
  });
}

function defaultTariffIdForRole(tariffs, fieldRole, siteCategory) {
  const filtered = filterTariffsForFieldRole(tariffs, fieldRole, siteCategory)
    .slice()
    .sort((a, b) => (Number(a.points) || 0) - (Number(b.points) || 0));
  const fourteen = filtered.find((t) => Number(t.points) === 14);
  return fourteen ? fourteen.id : (filtered[0]?.id || null);
}

module.exports = {
  EMPLOYEE_ROLE_TAGS,
  EMPLOYEE_ROLE_TAG_VALUES,
  FIELD_CREW_ROLES,
  FIELD_CREW_ROLE_VALUES,
  isStandardRoleTag,
  mapRoleTagToFieldRole,
  isValidFieldRole,
  isWelderTariffName,
  isPtoTariffName,
  filterTariffsForFieldRole,
  defaultTariffIdForRole,
};
