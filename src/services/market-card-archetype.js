'use strict';
/**
 * Матчер архетипов карточек маркетплейса (похожие SKU → один market_card_key).
 * Taxonomy: tests/reports/market-card-clusters/AGENT-TAXONOMY.json + EXTRA + group fallbacks.
 */
const fs = require('fs');
const path = require('path');

const TAX_PATH = path.join(__dirname, '..', '..', 'tests', 'reports', 'market-card-clusters', 'AGENT-TAXONOMY.json');

const FALLBACK_BY_GROUP = {
  housing: { key: 'fallback_housing', title: 'Жильё / проживание (общее)' },
  food: { key: 'fallback_food', title: 'Питание (общее)' },
  ppe: { key: 'fallback_ppe', title: 'СИЗ (общее)' },
  equipment: { key: 'fallback_equipment', title: 'Оборудование (общее)' },
  consumable: { key: 'fallback_consumable', title: 'Расходники (общее)' },
  materials: { key: 'fallback_materials', title: 'Материалы (общее)' },
  tools: { key: 'fallback_tools', title: 'Инструмент (общее)' },
  services: { key: 'fallback_services', title: 'Услуги (общее)' },
  other: { key: 'fallback_other', title: 'Прочее (общее)' },
};

/**
 * Узкие правила ПЕРЕД taxonomy: иначе «насос»/«сварочный» схлопывают разные типы в один ключ.
 */
const EXTRA = [
  // --- насосы (от частного к общему) ---
  { key: 'pump_control_panel', title: 'Щит управления насосом', match_hints: ['regex: щит\\s*управл\\w*\\s*насос|\\bщун\\b'] },
  { key: 'pump_hydrocleaning', title: 'Насосная установка гидроочистки', match_hints: ['regex: гидроочист|\\bунг\\b|байкал\\s*унг'] },
  { key: 'pump_membrane', title: 'Насос мембранный', match_hints: ['regex: мембранн\\w*\\s*насос|насос\\w*\\s*мембран'] },
  { key: 'pump_vacuum', title: 'Насос вакуумный / водокольцевой', match_hints: ['regex: вакуумн\\w*\\s*насос|насос\\w*\\s*вакуум|водокольц'] },
  { key: 'pump_pressure_test', title: 'Насос опрессовочный', match_hints: ['regex: опрессов'] },
  { key: 'pump_chemical', title: 'Насос химический / агрессивостойкий', match_hints: ['regex: насос\\w*.*(химич|агрессив)|химическ\\w*.*насос|\\bкмх\\b|\\bхцм\\b|\\bах\\b|х\\d{2,3}-\\d{2,3}'] },
  { key: 'pump_submersible_drain', title: 'Насос дренажный / погружной', match_hints: ['regex: дренажн|погружн\\w*\\s*насос|насос\\w*\\s*погруж|unilift'] },
  { key: 'pump_gear_oil', title: 'Насос шестерённый / для масла и топлива', match_hints: ['regex: шестерен|пластинчат|\\bнмш\\b|petroll|вязк\\w*\\s*жидк|диз\\.?\\s*топлив'] },
  { key: 'pump_pneumatic', title: 'Насос пневматический', match_hints: ['regex: пневматическ\\w*\\s*(вакуумн\\w*\\s*)?насос|насос\\w*\\s*пневмат'] },
  { key: 'equip_garden_pump', title: 'Насос садовый', match_hints: ['regex: (насос\\s*садов|садов\\w*\\s*насос|al-?ko\\s*jet)'] },
  { key: 'pump_centrifugal', title: 'Насос центробежный / станция / ЭЦВ', match_hints: ['regex: центробеж|насосн\\w*\\s*(станц|установк)|\\bэцв\\b|\\bцнс\\b|\\bwilo\\b|\\bкмн\\b|\\bюнк\\b|\\bкм\\s*\\d'] },
  // общий хвост «насос» — только если узкие не сработали (в taxonomy тоже есть equip_pump)

  // --- сварка ---
  { key: 'weld_tig', title: 'Сварка TIG / аргонодуговая', match_hints: ['regex: \\btig\\b|аргонодуг|аргонн\\w*\\s*свар|intig|ac\\s*/\\s*dc.*multi'] },
  { key: 'weld_mig_mag', title: 'Сварочный полуавтомат MIG/MAG', match_hints: ['regex: полуавтомат|\\bmig\\b|\\bmag\\b|irmig|проволок\\w*\\s*свароч|сопло\\s*газов\\w*.*mig'] },
  { key: 'weld_electrofusion', title: 'Электромуфтовый сварочный аппарат', match_hints: ['regex: электромуфт\\w*\\s*свароч'] },
  { key: 'weld_filler_rod', title: 'Пруток / присадка TIG', match_hints: ['regex: пруток\\s*присадочн|присадочн\\w*\\s*пруток'] },
  { key: 'weld_gas_hose', title: 'Рукав газосварочный', match_hints: ['regex: рукав\\s*газосвароч'] },
  { key: 'weld_kit', title: 'Набор для сварки', match_hints: ['regex: набор\\s*для\\s*сварки'] },
  { key: 'ppe_welding_boots', title: 'Ботинки сварщика', match_hints: ['regex: ботинк\\w*\\s*свар'] },
  { key: 'ppe_welding_suit', title: 'Костюм / фартук сварщика', match_hints: ['regex: (костюм|фартук)\\w*\\s*свар|сварщик\\w*\\s*(брезент|спилк|комбин)'] },
  { key: 'ppe_welding_gloves', title: 'Краги сварщика', match_hints: ['regex: краги\\s*свар|перчатк\\w*\\s*краги\\s*свар'] },
  { key: 'ppe_welding_glasses', title: 'Очки газосварщика', match_hints: ['regex: очки\\w*.*(газосвар|сварочн)'] },
  { key: 'ppe_mask_welding', title: 'Маска / щиток сварщика', match_hints: ['regex: маск\\w*\\s*свар|щиток\\s*свар|светофильтр\\s*свароч|стекло\\s*защитн\\w*\\s*для\\s*маски\\s*свар'] },
  { key: 'welding_inverter_mma', title: 'Сварочный инвертор ММА (штучный)', match_hints: [
    'regex: сварочн\\w*\\s*(инвертор|аппарат)|инвертор\\w*\\s*свароч|\\bсаи[\\s-]*\\d|форсаж\\s*\\d|fubag\\s*ir\\s*\\d',
    'negative: полуавтомат|\\btig\\b|\\bmig\\b|шуруповер|дрель|гайковерт|компрессор|пневмо'
  ] },

  // --- прочее EXTRA ---
  { key: 'hose_rvd', title: 'Рукав высокого давления (РВД)', match_hints: ['regex: \\bрвд\\b|рукав\\s*высок'] },
  { key: 'tool_angle_grinder', title: 'УШМ / болгарка', match_hints: ['regex: ушм|болгарк|углова?я\\s*шлиф|углошлиф'] },
  { key: 'equip_flashlight_head', title: 'Фонарь налобный', match_hints: ['regex: налобн\\w*\\s*фонар|фонар\\w*\\s*налобн|petzl\\s*pixa|gauss\\s*3w'] },
  { key: 'equip_flashlight_hand', title: 'Фонарь ручной / переносной', match_hints: ['regex: фонар', 'negative: налобн'] },
  { key: 'tool_extension_reel', title: 'Удлинитель / переноска', match_hints: ['regex: удлинител|переноск'] },
  { key: 'equip_hoist_chain', title: 'Таль цепная / ручная', match_hints: ['regex: \\bталь\\b'] },
  { key: 'equip_winch', title: 'Лебёдка', match_hints: ['regex: лебедк'] },
  { key: 'equip_ladder', title: 'Лестница', match_hints: ['regex: лестниц'] },
  { key: 'scaffold_parts', title: 'Элементы лесов', match_hints: ['regex: лес(ов|а)\\b|стойка\\s*лесов|связь\\s*(лесов|горизонт)|лх\\s*\\('] },
  { key: 'ppe_respirator', title: 'Респиратор / полумаска', match_hints: ['regex: респиратор|полумаск'] },
  { key: 'tool_socket_set', title: 'Набор головок / ключей', match_hints: ['regex: набор.*(ключ|головок|инструмент)|головк\\w*\\s*(торцев|ударн)'] },
  { key: 'tool_metal_shears', title: 'Ножницы по металлу', match_hints: ['regex: ножниц\\w*.*металл|гидравлическ\\w*\\s*ножниц'] },
  { key: 'battery_tool_pack', title: 'АКБ / зарядка инструмента', match_hints: ['regex: аккумулятор.*(makita|зубр|шуруповер|инструмент|dca|dewalt)|зарядн\\w*\\s*устрой'] },
  { key: 'office_mfu', title: 'МФУ / принтер / сканер', match_hints: ['regex: мфу|принтер|сканер|ламинатор|брошюров'] },
  { key: 'equip_jack', title: 'Домкрат', match_hints: ['regex: домкрат'] },
  { key: 'equip_router_net', title: 'Роутер / сетевое', match_hints: ['regex: \\bроутер\\b|маршрутизатор'] },
  { key: 'first_aid_kit', title: 'Аптечка', match_hints: ['regex: аптечк'] },
  { key: 'equip_level_bracket', title: 'Кронштейн / опора', match_hints: ['regex: кронштейн|\\bопора\\b'] },
  { key: 'bearing_part', title: 'Подшипник', match_hints: ['regex: подшипник'] },
  { key: 'office_laptop', title: 'Ноутбук / ПК', match_hints: ['regex: ноутбук|\\bпк\\b|системн\\w*\\s*блок|монитор\\s'] },
  { key: 'paint_coating', title: 'Краска / грунт / эмаль', match_hints: ['regex: \\bкраск|эмаль|грунт(овк|овка)|лак\\s'] },
  { key: 'drill_bit', title: 'Сверло / бур', match_hints: ['regex: \\bсверл|\\bбур(ы|а)?\\b|коронк\\w*\\s*(алмаз|по\\s*бетону)'] },
  { key: 'tape_seal', title: 'Лента / герметик / фум', match_hints: ['regex: фум.?лент|герметик|скотч|лента\\s*(маляр|изол|клей)'] },
  { key: 'wire_rope', title: 'Трос / канат', match_hints: ['regex: \\bтрос\\b|\\bканат\\b'] },
  { key: 'gas_cylinder', title: 'Баллон газовый', match_hints: ['regex: баллон.*(кислор|пропан|ацетил|углекисл)|газ\\w*\\s*баллон'] },
  { key: 'filter_cartridge', title: 'Фильтр / картридж', match_hints: ['regex: фильтр.*(воздуш|маслян|газо|противо)|картридж'] },
  { key: 'marking_tool', title: 'Маркер / краска разметочная', match_hints: ['regex: маркер|разметочн|мелок'] },
];

function fixCyrBoundary(raw) {
  // \b в JS не знает кириллицу; чередуем «начало»/«конец» токена.
  let i = 0;
  const edge = () => {
    i += 1;
    return i % 2 === 1
      ? '(?:^|[^0-9A-Za-zА-Яа-яЁё])'
      : '(?:$|[^0-9A-Za-zА-Яа-яЁё])';
  };
  return String(raw)
    .replace(/\\b/g, edge)
    .replace(/\\w/g, '[0-9A-Za-zА-Яа-яЁё]')
    .replace(/\(\?\<\!\[[^\]]*\]\)/g, '');
}

function compileOne(a) {
  const hints = a.match_hints || [];
  const regexHints = hints.filter((h) => h.startsWith('regex:'));
  const negHints = hints.filter((h) => h.startsWith('negative:'));
  const groupHints = hints
    .filter((h) => h.startsWith('search_group:'))
    .map((h) => h.slice('search_group:'.length).trim());
  const unitHints = hints
    .filter((h) => h.startsWith('unit:'))
    .map((h) => h.slice('unit:'.length).trim());

  let re = null;
  if (regexHints.length) {
    const raw = fixCyrBoundary(regexHints[0].slice('regex:'.length).trim());
    try {
      re = new RegExp(raw, 'i');
    } catch (e) {
      console.warn('[market-card-archetype] bad regex', a.key, e.message);
    }
  }
  const negatives = negHints
    .map((h) => {
      try {
        return new RegExp(fixCyrBoundary(h.slice('negative:'.length).trim()), 'i');
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);

  return {
    key: a.key,
    title: a.title || a.key,
    prompt_hint: a.prompt_hint || a.title || a.key,
    re,
    negatives,
    groupHints,
    unitHints,
  };
}

let _cache = null;

function loadTaxonomy() {
  if (_cache) return _cache;
  let archetypes = [];
  try {
    const tax = JSON.parse(fs.readFileSync(TAX_PATH, 'utf8'));
    archetypes = Array.isArray(tax.archetypes) ? tax.archetypes : [];
  } catch (e) {
    console.warn('[market-card-archetype] taxonomy load failed:', e.message);
  }
  // Узкие EXTRA раньше широких taxonomy (иначе equip_pump/welding_machine схлопывают всё).
  const skipInBase = new Set([
    'other_fallback',
    'equip_garden_pump', // дубль в EXTRA (раньше)
    'welding_machine', // заменён на weld_* / welding_inverter_mma
    'welding_inverter',
    'welding_ppe', // ppe_mask_welding + узкие СИЗ сварщика
  ]);
  const base = archetypes
    .filter((a) => a.key && !skipInBase.has(a.key))
    .map(compileOne);
  const extra = EXTRA.map(compileOne);
  const fallbacks = Object.values(FALLBACK_BY_GROUP).map((f) =>
    compileOne({ key: f.key, title: f.title, match_hints: [] })
  );
  const titleByKey = {};
  for (const a of archetypes) titleByKey[a.key] = a.title || a.key;
  for (const e of EXTRA) titleByKey[e.key] = e.title;
  for (const f of Object.values(FALLBACK_BY_GROUP)) titleByKey[f.key] = f.title;
  titleByKey.fallback_other = FALLBACK_BY_GROUP.other.title;

  _cache = {
    rules: extra.concat(base),
    fallbacks,
    titleByKey,
    allKeys: Object.keys(titleByKey),
  };
  return _cache;
}

function clearArchetypeCache() {
  _cache = null;
}

function matchArchetype(row = {}) {
  const { rules, titleByKey } = loadTaxonomy();
  const name = [row.name, row.brand, row.model].filter(Boolean).join(' ').trim();
  const unit = String(row.unit || '');
  const g = String(row.search_group || '');

  for (const r of rules) {
    if (r.negatives.some((n) => n.test(name))) continue;
    if (r.re && r.re.test(name)) {
      return { key: r.key, title: titleByKey[r.key] || r.title, source: 'rule' };
    }
    if (r.unitHints.length && r.unitHints.some((u) => {
      try { return new RegExp(fixCyrBoundary(u), 'i').test(unit); } catch (_) { return false; }
    })) {
      return { key: r.key, title: titleByKey[r.key] || r.title, source: 'unit' };
    }
  }

  for (const r of rules) {
    if (!r.groupHints.length) continue;
    if (!r.groupHints.includes(g)) continue;
    if (!(r.key.startsWith('housing') || r.key.startsWith('food') || r.key.startsWith('services'))) continue;
    if (r.re && r.re.test(name)) {
      return { key: r.key, title: titleByKey[r.key] || r.title, source: 'group+name' };
    }
    if (!r.re) {
      return { key: r.key, title: titleByKey[r.key] || r.title, source: 'group' };
    }
  }

  const fb = FALLBACK_BY_GROUP[g] || FALLBACK_BY_GROUP.other;
  return { key: fb.key, title: fb.title, source: 'fallback' };
}

function listArchetypeDefs() {
  const { titleByKey } = loadTaxonomy();
  return Object.entries(titleByKey).map(([key, title]) => ({
    key,
    title,
    prompt_hint: title,
  }));
}

async function ensureArchetype(db, { key, title, prompt_hint }) {
  const k = String(key || '').trim();
  if (!k) return null;
  const t = String(title || key).trim() || k;
  const ph = String(prompt_hint || t).trim();
  await db.query(
    `INSERT INTO market_card_archetypes(key, title, prompt_hint, status, updated_at)
     VALUES($1,$2,$3,'pending_photo',NOW())
     ON CONFLICT (key) DO UPDATE SET
       title = COALESCE(NULLIF(EXCLUDED.title,''), market_card_archetypes.title),
       prompt_hint = COALESCE(NULLIF(EXCLUDED.prompt_hint,''), market_card_archetypes.prompt_hint),
       updated_at = NOW()`,
    [k, t, ph]
  );
  const { rows } = await db.query('SELECT * FROM market_card_archetypes WHERE key=$1', [k]);
  return rows[0] || null;
}

async function assignProductCardKey(db, productId, row) {
  const m = matchArchetype(row);
  await ensureArchetype(db, { key: m.key, title: m.title, prompt_hint: m.title });
  await db.query(
    `UPDATE products SET market_card_key=$2, updated_at=NOW()
     WHERE id=$1 AND (market_card_key IS DISTINCT FROM $2)`,
    [productId, m.key]
  );
  // link existing hero immediately
  await db.query(
    `UPDATE products p SET
       photo_url = a.hero_photo_url,
       photo_source = COALESCE(a.photo_source, 'ai'),
       updated_at = NOW()
     FROM market_card_archetypes a
     WHERE p.id=$1 AND a.key=$2
       AND a.hero_photo_url IS NOT NULL AND btrim(a.hero_photo_url)<>''
       AND (p.photo_url IS NULL OR p.photo_source IS NULL OR p.photo_source IN ('ai','placeholder'))`,
    [productId, m.key]
  );
  return m;
}

async function assignEquipmentCardKey(db, equipmentId, row) {
  const m = matchArchetype(row);
  await ensureArchetype(db, { key: m.key, title: m.title, prompt_hint: m.title });
  await db.query(
    `UPDATE equipment SET market_card_key=$2, updated_at=NOW()
     WHERE id=$1 AND (market_card_key IS DISTINCT FROM $2)`,
    [equipmentId, m.key]
  );
  await db.query(
    `UPDATE equipment e SET
       photo_url = a.hero_photo_url,
       photo_source = COALESCE(a.photo_source, 'ai'),
       updated_at = NOW()
     FROM market_card_archetypes a
     WHERE e.id=$1 AND a.key=$2
       AND a.hero_photo_url IS NOT NULL AND btrim(a.hero_photo_url)<>''
       AND (e.photo_url IS NULL OR e.photo_source IS NULL OR e.photo_source IN ('ai','placeholder'))`,
    [equipmentId, m.key]
  );
  return m;
}

async function linkMembersToHero(db, archetypeKey) {
  const { rows } = await db.query(
    `SELECT key, hero_photo_url, photo_source FROM market_card_archetypes WHERE key=$1`,
    [archetypeKey]
  );
  const a = rows[0];
  if (!a || !a.hero_photo_url) return { products: 0, equipment: 0 };
  const src = a.photo_source || 'ai';
  const p = await db.query(
    `UPDATE products SET photo_url=$2, photo_source=$3, updated_at=NOW()
     WHERE market_card_key=$1
       AND (photo_url IS NULL OR photo_source IS NULL OR photo_source IN ('ai','placeholder'))`,
    [archetypeKey, a.hero_photo_url, src]
  );
  const e = await db.query(
    `UPDATE equipment SET photo_url=$2, photo_source=$3, updated_at=NOW()
     WHERE market_card_key=$1
       AND (photo_url IS NULL OR photo_source IS NULL OR photo_source IN ('ai','placeholder'))`,
    [archetypeKey, a.hero_photo_url, src]
  );
  return { products: p.rowCount || 0, equipment: e.rowCount || 0 };
}

module.exports = {
  matchArchetype,
  listArchetypeDefs,
  ensureArchetype,
  assignProductCardKey,
  assignEquipmentCardKey,
  linkMembersToHero,
  FALLBACK_BY_GROUP,
  loadTaxonomy,
  clearArchetypeCache,
  EXTRA,
};
