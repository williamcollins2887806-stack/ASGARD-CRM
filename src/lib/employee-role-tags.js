/**
 * Стандартные должности (role_tag) реестра «Дружина».
 * Используется в staff API и может подключаться на фронте.
 */
const EMPLOYEE_ROLE_TAGS = [
  { value: 'слесарь', label: '🔧 Слесарь' },
  { value: 'сварщик', label: '🔥 Сварщик' },
  { value: 'альпинист', label: '🧗 Альпинист' },
  { value: 'мастер', label: '👷 Мастер' },
  { value: 'РП', label: '👑 РП (руководитель)' },
];

const EMPLOYEE_ROLE_TAG_VALUES = EMPLOYEE_ROLE_TAGS.map((r) => r.value);

function isStandardRoleTag(v) {
  const s = String(v || '').trim().toLowerCase();
  return EMPLOYEE_ROLE_TAG_VALUES.some((x) => x.toLowerCase() === s);
}

module.exports = {
  EMPLOYEE_ROLE_TAGS,
  EMPLOYEE_ROLE_TAG_VALUES,
  isStandardRoleTag,
};
