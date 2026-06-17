/**
 * Константы полевого модуля.
 * Источник: field-tab.js (vanilla).
 */

export const CATEGORIES = [
  { value: 'offshore',     label: 'МЛСП' },
  { value: 'ground',       label: 'Земля' },
  { value: 'ground_heavy', label: 'Земля тяж.' },
  { value: 'warehouse',    label: 'Склад' }
];

export const ROLES = [
  { value: 'worker',       label: 'Рабочий' },
  { value: 'shift_master', label: 'Мастер смены' },
  { value: 'object_master',label: 'Мастер объекта' },
  { value: 'pm',           label: 'РП' }
];

export const SHIFTS = [
  { value: 'day',   label: 'День' },
  { value: 'night', label: 'Ночь' },
  { value: 'swing', label: 'Качающаяся' }
];

// Бэк (field-logistics.js:77,120) использует именно ticket_back, не ticket_from.
// Vanilla field-tab.js:58-64 совпадает.
export const LOG_TYPES = [
  { value: 'ticket_to',     label: '✈️ Билет туда',    short: 'Туда' },
  { value: 'hotel',         label: '🏨 Отель',          short: 'Отель' },
  { value: 'ticket_back',   label: '✈️ Билет обратно', short: 'Обратно' },
  { value: 'visa',          label: '📄 Виза',           short: 'Виза' },
  { value: 'insurance',     label: '🛡️ Страховка',     short: 'Страховка' },
  { value: 'transfer',      label: '🚐 Трансфер',       short: 'Трансфер' },
  { value: 'medical',       label: '⚕️ Мед.осмотр',     short: 'Медосмотр' }
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

export const FUND_STATUS_LABELS = {
  issued:   'Выдано',
  spent:    'Потрачено',
  returned: 'Возвращено',
  closed:   'Закрыто'
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
