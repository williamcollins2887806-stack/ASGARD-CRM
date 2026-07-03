/**
 * Единый словарь taxonomy для work_expenses.
 *
 * Это ИСТОЧНИК ПРАВДЫ для категорий/подкатегорий/способов оплаты во ВСЕХ местах
 * (бэк, vanilla фронт, React v2 фронт, мобилка). Никакие копии этого словаря
 * больше не разрешены — фронты тянут через GET /api/expenses/categories.
 *
 * Если хочешь добавить категорию: добавь её ЗДЕСЬ + обнови CHECK-constraint
 * в новой миграции (см. V219). После этого:
 *   - вызов POST /api/expenses/work с этой категорией пройдёт валидацию
 *   - все фронты её увидят (через /categories endpoint)
 *   - 55%/НДС логика подтянется автоматически из expense-tax.js
 */

// Категории основные. taxable=true → попадает под 55% налоговую нагрузку.
const CATEGORIES = [
  { value: 'cash',          label: 'Наличные расходы',           icon: '💵', taxable: true,  description: 'Любая наличная оплата на месте (магазин/кафе/АЗС/такси), детализация в subcategory' },
  { value: 'subcontract',   label: 'Субподряд / самозанятый',    icon: '🤝', taxable: true,  description: 'Услуги токаря/сварщика/прочих подрядчиков и самозанятых' },
  { value: 'per_diem',      label: 'Суточные',                   icon: '🍽', taxable: true,  description: 'Суточные сотрудникам — авто-расчёт из worker_payments' },
  { value: 'fot',           label: 'ФОТ (зарплата)',             icon: '👷', taxable: true,  description: 'ЗП сотрудникам — авто-расчёт из worker_payments / field_checkins' },
  { value: 'materials',     label: 'Материалы (безнал)',         icon: '📦', taxable: false, description: 'Закупка по счёту от поставщика — может быть НДС-вычет' },
  { value: 'tickets',       label: 'Билеты / логистика',         icon: '✈️', taxable: false, description: 'Авиа/Ж/Д, грузоперевозки по счёту' },
  { value: 'accommodation', label: 'Проживание (безнал)',        icon: '🏨', taxable: false, description: 'Гостиницы/съём по счёту/ИП' },
  { value: 'transfer',      label: 'Трансфер / аренда авто',     icon: '🚚', taxable: false, description: 'Логистика/трансфер по счёту' },
  { value: 'other',         label: 'Прочее',                     icon: '📋', taxable: false, description: 'Не попадает в основные категории' },
];

// Подкатегории под 'cash' — детализация куда конкретно ушли наличные.
const CASH_SUBCATEGORIES = [
  { value: 'gsm',              label: 'ГСМ',                        icon: '⛽' },
  { value: 'accommodation',    label: 'Аренда жилья',               icon: '🏨' },
  { value: 'transport',        label: 'Транспорт / такси / авто',   icon: '🚗' },
  { value: 'food',             label: 'Питание бригады',            icon: '🍽' },
  { value: 'supplies',         label: 'Расходники / материалы',     icon: '📦' },
  { value: 'representational', label: 'Представительские',          icon: '🎁' },
  { value: 'services',         label: 'Услуги',                     icon: '🛠' },
  { value: 'other',            label: 'Прочее',                     icon: '📋' },
];

// Подкатегории под 'subcontract'.
const SUB_SUBCATEGORIES = [
  { value: 'lathe',            label: 'Токарь',                     icon: '⚙️' },
  { value: 'welder',           label: 'Сварщик',                    icon: '🔥' },
  { value: 'other_contractor', label: 'Прочий подрядчик',           icon: '👷' },
];

// Подкатегории под 'materials' — детализация безналичной закупки.
const MATERIALS_SUBCATEGORIES = [
  { value: 'ppe',         label: 'СИЗ / спецодежда',           icon: '🦺' },
  { value: 'tools',       label: 'Инструмент',                 icon: '🔧' },
  { value: 'consumables', label: 'Расходники',                 icon: '📦' },
  { value: 'equipment',   label: 'Оборудование',               icon: '⚙️' },
  { value: 'chemicals',   label: 'Химия / реагенты',           icon: '🧪' },
  { value: 'other',       label: 'Прочие материалы',           icon: '📋' },
];

// Подкатегории под 'tickets' — тип билета.
const TICKETS_SUBCATEGORIES = [
  { value: 'avia',    label: 'Авиабилет',         icon: '✈️' },
  { value: 'rail',    label: 'ЖД (РЖД/ФПК)',      icon: '🚆' },
  { value: 'bus',     label: 'Автобус',           icon: '🚌' },
  { value: 'freight', label: 'Грузоперевозка',    icon: '🚛' },
  { value: 'other',   label: 'Прочее',            icon: '📋' },
];

// Подкатегории под 'accommodation'.
const ACCOMMODATION_SUBCATEGORIES = [
  { value: 'hotel',     label: 'Гостиница',          icon: '🏨' },
  { value: 'apartment', label: 'Аренда квартиры',    icon: '🏢' },
  { value: 'other',     label: 'Прочее',             icon: '📋' },
];

// Подкатегории под 'transfer'.
const TRANSFER_SUBCATEGORIES = [
  { value: 'taxi',     label: 'Такси',                  icon: '🚕' },
  { value: 'delivery', label: 'Доставка груза (ДЛ/СДЭК)', icon: '📦' },
  { value: 'freight',  label: 'Перевозка груза',        icon: '🚛' },
  { value: 'gsm',      label: 'ГСМ безнал',             icon: '⛽' },
  { value: 'rental',   label: 'Аренда авто',            icon: '🚗' },
  { value: 'other',    label: 'Прочее',                 icon: '📋' },
];

// Способы оплаты. Влияют на 55%-логику в expense-tax.js.
const PAYMENT_METHODS = [
  { value: 'cash', label: 'Наличные',           icon: '💵', taxable: true,  description: '55% налоговая нагрузка' },
  { value: 'card', label: 'Карта на месте',     icon: '💳', taxable: true,  description: '55% налоговая нагрузка' },
  { value: 'bank', label: 'Безнал по счёту',    icon: '🏦', taxable: false, description: 'Без 55%, может быть НДС-вычет' },
  { value: 'self', label: 'Самозанятый / НПД',  icon: '👤', taxable: true,  description: '55% налоговая нагрузка (внутреннее правило: обналичка через НПД)' },
  { value: 'auto', label: 'Автоматический',     icon: '🤖', taxable: false, description: 'Системный (ФОТ/суточные) — 55% применяется к категориям fot/per_diem/payroll' },
];

const VALID_CATEGORIES = new Set(CATEGORIES.map(c => c.value));
const VALID_PAYMENT_METHODS = new Set(PAYMENT_METHODS.map(m => m.value));
const VALID_CASH_SUBS = new Set(CASH_SUBCATEGORIES.map(s => s.value));
const VALID_SUB_SUBS = new Set(SUB_SUBCATEGORIES.map(s => s.value));
const VALID_MATERIALS_SUBS = new Set(MATERIALS_SUBCATEGORIES.map(s => s.value));
const VALID_TICKETS_SUBS = new Set(TICKETS_SUBCATEGORIES.map(s => s.value));
const VALID_ACCOMMODATION_SUBS = new Set(ACCOMMODATION_SUBCATEGORIES.map(s => s.value));
const VALID_TRANSFER_SUBS = new Set(TRANSFER_SUBCATEGORIES.map(s => s.value));

// Категории полевого модуля: старые русские + новые english ключи.
// Все они маппятся в канонический work_expenses category='cash' + subcategory.
const FIELD_CATEGORY_ALIASES = {
  'Материалы': 'supplies',
  'Инструмент': 'supplies',
  'Транспорт': 'transport',
  'Питание': 'food',
  'Расходники': 'supplies',
  'Прочее': 'other',
  supplies: 'supplies',
  transport: 'transport',
  food: 'food',
  gsm: 'gsm',
  services: 'services',
  representational: 'representational',
  accommodation: 'accommodation',
  other: 'other',
};

/**
 * Возвращает массив допустимых подкатегорий по основной категории
 * (null если детализация не требуется).
 */
function getSubcategoriesFor(category) {
  if (category === 'cash') return CASH_SUBCATEGORIES;
  if (category === 'subcontract') return SUB_SUBCATEGORIES;
  if (category === 'materials') return MATERIALS_SUBCATEGORIES;
  if (category === 'tickets') return TICKETS_SUBCATEGORIES;
  if (category === 'accommodation') return ACCOMMODATION_SUBCATEGORIES;
  if (category === 'transfer') return TRANSFER_SUBCATEGORIES;
  return null;
}

/**
 * Валидирует пару (category, subcategory).
 * @returns {string|null} текст ошибки или null если ок.
 */
function validateCategory(category, subcategory) {
  if (!category) return 'category обязателен';
  if (!VALID_CATEGORIES.has(category)) {
    return `category='${category}' не входит в список: ${Array.from(VALID_CATEGORIES).join(', ')}`;
  }
  if (subcategory) {
    const sub = String(subcategory).toLowerCase();
    if (category === 'cash' && !VALID_CASH_SUBS.has(sub)) {
      return `Под cash subcategory='${subcategory}' не допустимо. Разрешены: ${Array.from(VALID_CASH_SUBS).join(', ')}`;
    }
    if (category === 'subcontract' && !VALID_SUB_SUBS.has(sub)) {
      return `Под subcontract subcategory='${subcategory}' не допустимо. Разрешены: ${Array.from(VALID_SUB_SUBS).join(', ')}`;
    }
    if (category === 'materials' && !VALID_MATERIALS_SUBS.has(sub)) {
      return `Под materials subcategory='${subcategory}' не допустимо. Разрешены: ${Array.from(VALID_MATERIALS_SUBS).join(', ')}`;
    }
    if (category === 'tickets' && !VALID_TICKETS_SUBS.has(sub)) {
      return `Под tickets subcategory='${subcategory}' не допустимо. Разрешены: ${Array.from(VALID_TICKETS_SUBS).join(', ')}`;
    }
    if (category === 'accommodation' && !VALID_ACCOMMODATION_SUBS.has(sub)) {
      return `Под accommodation subcategory='${subcategory}' не допустимо. Разрешены: ${Array.from(VALID_ACCOMMODATION_SUBS).join(', ')}`;
    }
    if (category === 'transfer' && !VALID_TRANSFER_SUBS.has(sub)) {
      return `Под transfer subcategory='${subcategory}' не допустимо. Разрешены: ${Array.from(VALID_TRANSFER_SUBS).join(', ')}`;
    }
    const SUB_ALLOWED_CATS = new Set(['cash','subcontract','materials','tickets','accommodation','transfer']);
    if (!SUB_ALLOWED_CATS.has(category)) {
      return `Под '${category}' подкатегории не используются (subcategory должен быть пустым)`;
    }
  }
  return null;
}

function validatePaymentMethod(method) {
  if (!method) return null; // допустим NULL — fallback к legacy category-логике
  if (!VALID_PAYMENT_METHODS.has(method)) {
    return `payment_method='${method}' не входит в список: ${Array.from(VALID_PAYMENT_METHODS).join(', ')}`;
  }
  return null;
}

/**
 * Дефолтный payment_method исходя из категории.
 * cash/subcontract → 'cash' (РП заплатил наличкой)
 * fot/per_diem     → 'auto' (системное начисление)
 * остальное        → 'bank' (счёт от поставщика)
 */
function defaultPaymentMethod(category) {
  if (category === 'cash' || category === 'subcontract') return 'cash';
  if (category === 'fot' || category === 'per_diem' || category === 'payroll') return 'auto';
  return 'bank';
}

function resolveFieldCategory(inputCategory) {
  const key = String(inputCategory || '').trim();
  const subcategory = FIELD_CATEGORY_ALIASES[key] || 'other';
  return { category: 'cash', subcategory };
}

module.exports = {
  CATEGORIES,
  CASH_SUBCATEGORIES,
  SUB_SUBCATEGORIES,
  MATERIALS_SUBCATEGORIES,
  TICKETS_SUBCATEGORIES,
  ACCOMMODATION_SUBCATEGORIES,
  TRANSFER_SUBCATEGORIES,
  PAYMENT_METHODS,
  VALID_CATEGORIES,
  VALID_PAYMENT_METHODS,
  VALID_CASH_SUBS,
  VALID_SUB_SUBS,
  VALID_MATERIALS_SUBS,
  VALID_TICKETS_SUBS,
  VALID_ACCOMMODATION_SUBS,
  VALID_TRANSFER_SUBS,
  getSubcategoriesFor,
  validateCategory,
  validatePaymentMethod,
  defaultPaymentMethod,
  FIELD_CATEGORY_ALIASES,
  resolveFieldCategory,
};
