'use strict';
/**
 * Классификация позиции номенклатуры → product_categories.search_group + category_id.
 *
 * Зачем: из счетов в каталог сыплются и гипсокартон, и «Проживание Иванова», и
 * газоанализаторы — без группы искать невозможно. Первое совпадение выигрывает.
 */

const GROUP_LABELS = {
  housing: 'Жильё',
  equipment: 'Оборудование',
  consumable: 'Расходники',
  materials: 'Материалы',
  tools: 'Инструмент',
  ppe: 'СИЗ',
  services: 'Услуги',
  food: 'Питание',
  other: 'Прочее'
};

/** Порядок chips в UI. */
const SEARCH_GROUPS = [
  'housing', 'equipment', 'consumable', 'materials', 'ppe', 'tools', 'food', 'services', 'other'
];

/**
 * Витрина маркетплейса + AI-фото/описание — только «потрогать можно».
 * В номенклатуру (products + цены) уходит ВСЁ; эти группы на витрину не кладём.
 */
const NON_MARKETPLACE_GROUPS = new Set(['housing', 'food', 'services']);
const MARKETPLACE_GROUPS = new Set([
  'equipment', 'consumable', 'materials', 'tools', 'ppe', 'other'
]);

function isMarketplaceGroup(group) {
  const g = String(group || 'other');
  if (NON_MARKETPLACE_GROUPS.has(g)) return false;
  return MARKETPLACE_GROUPS.has(g) || !NON_MARKETPLACE_GROUPS.has(g);
}

const NAME_RULES = [
  // Жильё / проживание
  { g: 'housing', re: /(проживани|гостиниц|отел|хостел|апарт\w*|квартир|суточн|найм\s*жил|плата за простой номера|бронирован\w*\s*номер|номер\s*\d|жиль[её])/i },
  // Питание
  { g: 'food', re: /(питани|обед|завтрак|ужин|столов|кейтеринг|газпром\s*питани|продукт\w*\s*бригад|пайк|комплексн\w*\s*питани)/i },
  // СИЗ
  // В JS \b плохо работает с кириллицей — без word-boundary.
  { g: 'ppe', re: /(сиз|спецодежд|спецобув|каск|перчатк|респиратор|очки защит|жилет сигналь|балаклава|термобель|полуботинк|ботинк\w*\s*защит|наушник\w*\s*противошум|страховочн|привязь|строп\s*страх)/i },
  // Оборудование / техника / измерители
  { g: 'equipment', re: /(газоанализатор|детектор|тепловизор|нивелир|лазерн\w*\s*уров|дальномер|толщиномер|генератор|компрессор|насос|инвертор|сварочн\w*\s*аппарат|перфоратор|шурупов[её]рт|ушм|болгарк|дрель|электростанц|газон\w*\s*анализатор|лидергаз|лестниц|связь\s*горизонталь|ригель|связи\s*горизонталь)/i },
  // Инструмент (ручной / расходный инструмент)
  { g: 'tools', re: /(бит[аы]|отвертк|ключ\s*рожков|ключ\s*торцев|молоток|зубр|всеинструмент|диск\s*отрез|круг\s*отрез|сверло|метчик|плашк)/i },
  // Расходники / химия / метизы
  { g: 'consumable', re: /(саморез|болт|гайк|шайб|анкер|дюбел|хомут|электрод|проволок\w*\s*свароч|спрей|антипригар|растворител|герметик|скотч|плёнк|пленк|салфетк|лента\s*изол|канистр|газ\s*универсальн|горелка\s*газов)/i },
  // Материалы
  { g: 'materials', re: /(гипсокартон|профиль\s*стоеч|утеплител|штукатурк|наливн\w*\s*пол|цемент|бетон|краск|грунт|кабель|провод|труба|фитинг|муфт\w*\s*труб|лист\s*оц|рулон\s*оц|настил\s*дерев)/i },
  // Услуги / связь / подписки / доставка / аренда (не товар).
  // НЕ трогать СИЗ: «страховочная привязь» ≠ «страховка ОСАГО».
  // «Связь горизонтальная» у лесов — оборудование, не телеком (не использовать голое «связ»).
  { g: 'services', re: /(доставк|транспортн\w*\s*услуг|автоуслуг|аренд\w*.{0,48}(помещен|нежил|офис|здан)|обеспечительн\w*\s*плат|тбо|обращен\w*\s*с\s*тверд|коммунал|интернет|абонентск|сотов\w*\s*связ|телефонн\w*\s*связ|услуг\w*\s*связ|телефони|роуминг|хостинг|лиценз|подписк|командиров|проезд|обучен|полис\s*страхов|страховк[аиуеоы]|страхов\w*\s*(осаго|каско|имуществ|ответствен)|договор\s*страхов|охран\w*\s*услуг|консультац|бухгалтер|оказан\w*\s*услуг|(?:^|[\s«"(])услуг)/i }
];

const UNIT_HINTS = [
  { g: 'housing', re: /^(сут|сутки|койко[- ]?сут)/i },
  { g: 'food', re: /^(чел[- ]?дн|порц|комплекс)/i }
];

const SUPPLIER_RULES = [
  { g: 'housing', re: /(отел|гостиниц|хостел|апарт|магистр|жиль|суточн|booking|островск|вайт\s*тревел)/i },
  { g: 'food', re: /(газпром\s*питани|кейтеринг|столов|ресторан|общепит)/i },
  { g: 'ppe', re: /(техноавиа|восток[- ]?сервис|авангард[- ]?спецодежд|тракт)/i },
  { g: 'tools', re: /(всеинструмент)/i },
  { g: 'consumable', re: /(комус|офисмаг)/i },
  { g: 'equipment', re: /(лидергаздетектор|газдетектор)/i }
];

/** Канонические имена категорий по группе (должны совпасть с seed/V448). */
const GROUP_CATEGORY_NAME = {
  housing: 'Жильё и проживание',
  food: 'Питание',
  equipment: 'Оборудование',
  consumable: 'Химия и расходники',
  materials: 'Строительные материалы',
  tools: 'Инструмент',
  ppe: 'СИЗ (средства защиты)',
  services: 'Услуги',
  other: 'Прочее'
};

function classifyProductGroup({ name, unit, supplierName } = {}) {
  const nm = String(name || '');
  const un = String(unit || '');
  const sp = String(supplierName || '');

  if (un) {
    for (const r of UNIT_HINTS) if (r.re.test(un)) return r.g;
  }
  if (nm) {
    for (const r of NAME_RULES) if (r.re.test(nm)) return r.g;
  }
  if (sp) {
    for (const r of SUPPLIER_RULES) if (r.re.test(sp)) return r.g;
  }
  return 'other';
}

/**
 * Найти category_id по группе. Кеш на время жизни процесса ок — справочник маленький.
 */
let _cache = null;
let _cacheAt = 0;

async function loadCategoryMap(db) {
  const now = Date.now();
  if (_cache && (now - _cacheAt) < 60_000) return _cache;
  const { rows } = await db.query(
    `SELECT id, name, search_group FROM product_categories
      WHERE is_active = true AND parent_id IS NULL`
  );
  const byGroup = new Map();
  const byName = new Map();
  for (const r of rows) {
    byName.set(String(r.name).toLowerCase(), r);
    if (r.search_group && !byGroup.has(r.search_group)) byGroup.set(r.search_group, r);
  }
  // Предпочтительные имена поверх «первой попавшейся» группы
  for (const [g, nm] of Object.entries(GROUP_CATEGORY_NAME)) {
    const hit = byName.get(nm.toLowerCase());
    if (hit) byGroup.set(g, hit);
  }
  _cache = { byGroup, byName, rows };
  _cacheAt = now;
  return _cache;
}

function invalidateCategoryCache() {
  _cache = null;
  _cacheAt = 0;
}

/**
 * @returns {{ group: string, category_id: number|null, category_name: string|null }}
 */
async function resolveProductCategory(db, opts = {}) {
  const group = classifyProductGroup(opts);
  try {
    const map = await loadCategoryMap(db);
    const cat = map.byGroup.get(group) || map.byName.get((GROUP_CATEGORY_NAME[group] || 'Прочее').toLowerCase());
    return {
      group,
      category_id: cat ? cat.id : null,
      category_name: cat ? cat.name : null
    };
  } catch (_) {
    return { group, category_id: null, category_name: null };
  }
}

module.exports = {
  classifyProductGroup,
  resolveProductCategory,
  invalidateCategoryCache,
  isMarketplaceGroup,
  GROUP_LABELS,
  SEARCH_GROUPS,
  MARKETPLACE_GROUPS,
  NON_MARKETPLACE_GROUPS,
  GROUP_CATEGORY_NAME,
  NAME_RULES
};
