/**
 * Константы полевого модуля.
 * Источник: field-tab.js (vanilla).
 */

// Значения совпадают с field_tariff_grid.category в БД:
// ground, ground_hard, mlsp, special, warehouse. Раньше использовались
// устаревшие offshore/ground_heavy — dropdown возвращал 0 строк для МЛСП и «Земля тяж.».
export const CATEGORIES = [
  { value: 'mlsp',       label: 'МЛСП' },
  { value: 'ground',     label: 'Земля' },
  { value: 'ground_hard',label: 'Земля тяж.' },
  { value: 'warehouse',  label: 'Склад' }
];

// field_role бригады. Мастерские права — только shift_master / senior_master.
export const ROLES = [
  { value: 'worker',        label: 'Рабочий' },
  { value: 'welder',        label: 'Сварщик' },
  { value: 'pto',           label: 'ПТО' },
  { value: 'shift_master',  label: 'Мастер смены' },
  { value: 'senior_master', label: 'Старший мастер' },
  { value: 'project_lead',  label: 'Рук. проекта' }
];

/** role_tag дружины → field_role (можно переопределить в UI). */
export function mapRoleTagToFieldRole(roleTag) {
  const t = String(roleTag || '').trim().toLowerCase();
  if (t === 'сварщик') return 'welder';
  if (t === 'пто' || t === 'pto') return 'pto';
  if (t === 'мастер') return 'shift_master';
  if (t === 'рп' || t === 'руководитель' || t.startsWith('рп')) return 'project_lead';
  return 'worker';
}

export function isWelderTariffName(name) {
  return /^Сварщик\s*\(/i.test(String(name || '').trim());
}

export function isPtoTariffName(name) {
  return /^ПТО\s*\(/i.test(String(name || '').trim());
}

/** Фильтр сетки ставок под роль бригады. */
export function filterTariffsForFieldRole(tariffs, fieldRole, siteCategory) {
  const list = Array.isArray(tariffs) ? tariffs : [];
  const role = String(fieldRole || 'worker');
  const inCat = (t) => !siteCategory || t.category === siteCategory || t.category === 'special';
  if (role === 'welder') {
    return list.filter((t) => isWelderTariffName(t.position_name || t.label || t.name)
      && inCat(t));
  }
  if (role === 'pto') {
    return list.filter((t) => isPtoTariffName(t.position_name || t.label || t.name)
      && inCat(t));
  }
  if (role === 'shift_master') {
    return list.filter((t) => {
      const n = t.position_name || t.label || t.name || '';
      if (t.is_combinable) return false;
      return /Мастер сменный/i.test(n) && inCat(t);
    });
  }
  if (role === 'senior_master') {
    return list.filter((t) => {
      const n = t.position_name || t.label || t.name || '';
      if (t.is_combinable) return false;
      return /Мастер ответственный/i.test(n) && inCat(t);
    });
  }
  return list.filter((t) => {
    const n = t.position_name || t.label || t.name || '';
    if (isWelderTariffName(n) || isPtoTariffName(n)) return false;
    if (/Мастер сменный|Мастер ответственный|Мастер ПТО/i.test(n)) return false;
    if (siteCategory && t.category && t.category !== siteCategory) return false;
    return !t.is_combinable;
  });
}

export function defaultTariffIdForRole(tariffs, fieldRole, siteCategory) {
  const filtered = filterTariffsForFieldRole(tariffs, fieldRole, siteCategory)
    .slice()
    .sort((a, b) => (Number(a.points) || 0) - (Number(b.points) || 0));
  const fourteen = filtered.find((t) => Number(t.points) === 14);
  return fourteen ? String(fourteen.id) : (filtered[0] ? String(filtered[0].id) : '');
}

/** Роли для окна «Базовые ставки» (после создания работы). */
export const BASE_ROLE_DEFS = [
  { key: 'worker',        label: 'Слесарь / монтажник', defaultEnabled: true },
  { key: 'shift_master',  label: 'Мастер сменный',      defaultEnabled: true },
  { key: 'senior_master', label: 'Мастер ответственный', defaultEnabled: true },
  { key: 'welder',        label: 'Сварщик',             defaultEnabled: false },
  { key: 'pto',           label: 'ПТО',                 defaultEnabled: false },
  { key: 'project_lead',  label: 'Рук. проекта',        defaultEnabled: false }
];

/** Дефолтный тариф для роли в окне базовых ставок (мастер — по имени). */
export function pickDefaultTariffForRole(tariffs, roleKey) {
  const list = Array.isArray(tariffs) ? tariffs.slice() : [];
  const byPointsAsc = (a, b) => (Number(a.points) || 0) - (Number(b.points) || 0);
  if (roleKey === 'shift_master') {
    const hit = list.find((t) => /Мастер сменный/i.test(t.position_name || ''));
    if (hit) return String(hit.id);
  }
  if (roleKey === 'senior_master') {
    const hit = list.find((t) => /Мастер ответственный/i.test(t.position_name || ''));
    if (hit) return String(hit.id);
  }
  if (roleKey === 'welder' || roleKey === 'pto') {
    list.sort(byPointsAsc);
    const fourteen = list.find((t) => Number(t.points) === 14);
    return fourteen ? String(fourteen.id) : (list[0] ? String(list[0].id) : '');
  }
  // worker: слесарь «полный функционал» или средний по баллам
  const sle = list.find((t) => /Слесарь \(полный функционал/i.test(t.position_name || '')
    || /Слесарь \(полный функционал,/i.test(t.position_name || '')
    || /Слесарь-монтажник/i.test(t.position_name || ''));
  if (sle) return String(sle.id);
  list.sort(byPointsAsc);
  return list[0] ? String(list[0].id) : '';
}

/** Тариф по role_base_rates для field_role при добавлении в бригаду. */
export function tariffIdFromRoleBaseRates(roleBaseRates, fieldRole) {
  const roles = Array.isArray(roleBaseRates?.roles) ? roleBaseRates.roles : [];
  const hit = roles.find((r) => r.role_key === fieldRole && r.enabled && r.tariff_id);
  return hit?.tariff_id ? String(hit.tariff_id) : '';
}

export const SHIFTS = [
  { value: 'day',   label: 'День' },
  { value: 'night', label: 'Ночь' },
  { value: 'swing', label: 'Качающаяся' }
];

// Бэк (field-logistics.js:71-77,120) использует item_type из канона
// ticket_to, ticket_back, hotel, visa, insurance, transfer, directive_mo
// (medical — это expense_type, не item_type, попадал бы мимо work-readiness и SMS-шаблонов).
export const LOG_TYPES = [
  { value: 'ticket_to',    label: '✈️ Билет туда',    short: 'Туда' },
  { value: 'hotel',        label: '🏨 Отель',          short: 'Отель' },
  { value: 'ticket_back',  label: '✈️ Билет обратно', short: 'Обратно' },
  { value: 'visa',         label: '📄 Виза',           short: 'Виза' },
  { value: 'insurance',    label: '🛡️ Страховка',     short: 'Страховка' },
  { value: 'transfer',     label: '🚐 Трансфер',       short: 'Трансфер' },
  { value: 'directive_mo', label: '⚕️ Направление на МО', short: 'МО' }
];

// Для матричного UI логистики — 5 основных колонок (как в vanilla field-tab.js:58-64).
export const LOG_MATRIX_TYPES = [
  { value: 'ticket_to',   label: '✈️ Туда' },
  { value: 'hotel',       label: '🏨 Отель' },
  { value: 'ticket_back', label: '✈️ Обратно' },
  { value: 'visa',        label: '📄 Виза' },
  { value: 'insurance',   label: '🛡️ Страх.' }
];

// Статусы логистики бэка (field_logistics.status):
//   pending → purchased → ready → sent.
export const LOG_STATUS_LABELS = {
  pending:   '⏳ Не куплено',
  purchased: '💳 Куплено',
  ready:     '📋 Готово',
  sent:      '📨 Отправлено'
};

export const STATUS_COLORS = {
  draft:    'var(--t-3)',
  pending:  'var(--amber)',
  approved: 'var(--ok)',
  sent:     'var(--info)',
  delivered:'var(--ok)',
  rejected: 'var(--err)'
};

export const DISPUTE_TYPE_LABELS = {
  missing_shift:     'Не записана смена',
  wrong_rate:        'Неверная ставка',
  missing_per_diem:  'Не выплачены суточные',
  bonus_promise:     'Обещанный бонус не выплачен',
  other:             'Другое'
};

// Канон бэка field_master_funds.status (V061:22-23): issued → confirmed → reporting → closed.
// До 23.06.2026 здесь были {issued/spent/returned/closed} — но spent и returned это
// денежные КОЛОНКИ (V061:18-19), а не значения статуса. Реальные confirmed/reporting
// отображались сырыми английскими ключами на экране.
export const FUND_STATUS_LABELS = {
  issued:    'Выдано',
  confirmed: 'Подтверждено',
  reporting: 'На отчёте',
  closed:    'Закрыто'
};

// Старые ключи (mob/shift/rest/sick/vacation/demob) НЕ принимались бэкендом
// (src/routes/field-stages.js:32 STAGE_TYPES = ['medical','travel','waiting','warehouse','day_off','object']).
// Сейчас приведены к серверным — POST /stages теперь будет работать (раньше 400).
export const STAGE_COLORS = {
  medical:   '#9333EA',
  travel:    '#3B82F6',
  waiting:   '#F59E0B',
  warehouse: '#F97316',
  day_off:   '#9CA3AF',
  object:    '#22C55E'
};

export const STAGE_LABELS = {
  medical:   'Медосмотр',
  travel:    'Дорога',
  waiting:   'Ожидание',
  warehouse: 'Склад',
  day_off:   'Выходной',
  object:    'Объект'
};

// Шаблон «типовых этапов» для bulk-создания. Vanilla не имеет точного аналога —
// делаем удобный пресет на основе серверных stage_type.
export const STAGE_TEMPLATES = [
  { stage_type: 'medical',   label: 'Медосмотр (день перед выездом)',  offset: -1 },
  { stage_type: 'travel',    label: 'Дорога туда',                       offset: 0  },
  { stage_type: 'warehouse', label: 'Склад / приёмка ТМЦ',              offset: 1  },
  { stage_type: 'waiting',   label: 'Ожидание вахты',                    offset: 2  },
  { stage_type: 'day_off',   label: 'Выходной в межвахте',               offset: 3  }
];

export const FIELD_TABS = [
  { id: 'dashboard', label: '📊 Дашборд' },
  { id: 'crew',      label: '👥 Бригада' },
  { id: 'logistics', label: '✈️ Логистика' },
  { id: 'timesheet', label: '📋 Табель' },
  { id: 'disputes',  label: '⚠️ Разногласия' },
  { id: 'funds',     label: '💰 Подотчёт' },
  { id: 'packing',   label: '📦 Сборы' },
  { id: 'stages',    label: '🗺 Маршруты' },
  { id: 'payments',  label: '💳 Выплаты' },
  { id: 'prizes',    label: '🎁 Призы' }
];
