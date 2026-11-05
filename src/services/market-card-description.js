'use strict';
/**
 * AI-описание карточки маркетплейса: 3–10 предложений, до 1000 знаков.
 * Учитывает марку/модель; без цен и рекламы.
 */
const photo = require('./market-card-photo');

const MAX_CHARS = 1000;
const MODEL = 'google/gemini-2.5-flash';

const SYSTEM = `Ты редактор B2B-каталога промышленного снабжения (СИЗ, инструмент, насосы, сварка, расходники).
Напиши описание на русском для карточки маркетплейса.
Требования:
- 3–10 предложений, не больше 1000 символов вместе с пробелами;
- если есть марка/модель — коротко поясни, что это за изделие и типичное применение;
- укажи 3–8 характеристик (производительность, мощность, материал, класс защиты, диаметр и т.п.), если их можно уверенно вывести из названия/марки; не выдумывай точные цифры, которых нет в названии — пиши качественно («центробежный химический», «мембранный»);
- нейтральный деловой тон, без рекламы, без цен, без призывов купить;
- без маркировок markdown и без заголовков — только связный текст.`;

function parseAttrs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function clipDesc(text) {
  let s = String(text || '')
    .trim()
    .replace(/^["«]|["»]$/g, '')
    .replace(/\s+/g, ' ');
  if (s.length <= MAX_CHARS) return s;
  const cut = s.slice(0, MAX_CHARS);
  const last = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
  if (last > 400) return cut.slice(0, last + 1).trim();
  return cut.trim();
}

async function callChat(apiKey, user) {
  const res = await fetch('https://routerai.ru/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
      temperature: 0.35,
      max_tokens: 700,
    }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = {};
  }
  if (res.status === 402 || /no[_ ]?credit/i.test(text)) {
    const err = new Error('NO_CREDIT');
    err.code = 'NO_CREDIT';
    throw err;
  }
  if (!res.ok) {
    throw new Error(json.error?.message || `chat HTTP ${res.status}`);
  }
  const desc = clipDesc(json.choices?.[0]?.message?.content || '');
  if (!desc || desc.length < 40) {
    const err = new Error('empty or too short description');
    err.code = 'SHORT_DESC';
    err.raw = String(json.choices?.[0]?.message?.content || '').slice(0, 200);
    throw err;
  }
  return desc;
}

function fallbackDescription(row) {
  const name = String(row.name || 'Позиция').trim();
  const parts = [
    `${name} — позиция каталога для снабжения строительных и монтажных работ.`,
    row.brand || row.model
      ? `Марка/модель: ${[row.brand, row.model].filter(Boolean).join(' ')}.`
      : null,
    row.archetype_title ? `Тип: ${row.archetype_title}.` : null,
    row.category_name ? `Категория: ${row.category_name}.` : null,
    'Используется по назначению согласно маркировке и нормам эксплуатации. Перед применением проверьте соответствие проекту и комплектации.',
    'Поставляется со склада или под заказ в составе заявки на снабжение.',
  ].filter(Boolean);
  return clipDesc(parts.join(' '));
}

function buildUserPrompt(row) {
  return [
    `Наименование: ${row.name || '—'}`,
    row.brand ? `Марка: ${row.brand}` : null,
    row.model ? `Модель: ${row.model}` : null,
    row.article ? `Артикул: ${row.article}` : null,
    row.unit ? `Ед.: ${row.unit}` : null,
    row.category_name ? `Категория: ${row.category_name}` : null,
    row.search_group ? `Группа: ${row.search_group}` : null,
    row.archetype_title ? `Тип карточки: ${row.archetype_title}` : null,
    row.inventory_number ? `Инв. №: ${row.inventory_number}` : null,
    'Сделай описание для карточки витрины (3–10 предложений, ≤1000 знаков).',
  ]
    .filter(Boolean)
    .join('\n');
}

/** @param {object} db @param {'product'|'equipment'} entityType @param {number} entityId @param {{force?:boolean}} opts */
async function generateEntityDescription(db, entityType, entityId, opts = {}) {
  const apiKey = await photo.resolveApiKey(db);
  if (!apiKey) {
    const err = new Error('NO_API_KEY');
    err.code = 'NO_API_KEY';
    throw err;
  }

  if (entityType === 'product') {
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.unit, p.article, p.notes, p.attrs,
              c.name AS category_name, c.search_group, a.title AS archetype_title
       FROM products p
       LEFT JOIN product_categories c ON c.id = p.category_id
       LEFT JOIN market_card_archetypes a ON a.key = p.market_card_key
       WHERE p.id=$1`,
      [entityId]
    );
    const p = rows[0];
    if (!p) return { ok: false, reason: 'missing' };
    const attrs = parseAttrs(p.attrs);
    if (attrs.description_ai && !opts.force) return { ok: true, skipped: true, chars: String(attrs.description_ai).length };

    const promptRow = {
      ...p,
      brand: attrs.brand || attrs.manufacturer || null,
      model: attrs.model || null,
    };
    let desc;
    let modelUsed = MODEL;
    try {
      desc = await callChat(apiKey, buildUserPrompt(promptRow));
    } catch (e) {
      if (e.code !== 'SHORT_DESC' && e.code !== 'NO_CREDIT') throw e;
      if (e.code === 'NO_CREDIT') throw e;
      desc = fallbackDescription(promptRow);
      modelUsed = 'fallback_template';
    }
    const nextAttrs = {
      ...attrs,
      description_ai: desc,
      description_ai_at: new Date().toISOString(),
      description_ai_model: modelUsed,
    };
    await db.query(
      `UPDATE products SET
         attrs = $2::jsonb,
         notes = CASE WHEN notes IS NULL OR btrim(notes)='' THEN $3 ELSE notes END,
         updated_at = NOW()
       WHERE id=$1`,
      [entityId, JSON.stringify(nextAttrs), desc.slice(0, 500)]
    );
    return { ok: true, chars: desc.length, entity_type: 'product', id: entityId };
  }

  if (entityType === 'equipment') {
    const { rows } = await db.query(
      `SELECT e.id, e.name, e.brand, e.model, e.attrs, e.inventory_number,
              c.name AS category_name, a.title AS archetype_title
       FROM equipment e
       LEFT JOIN equipment_categories c ON c.id = e.category_id
       LEFT JOIN market_card_archetypes a ON a.key = e.market_card_key
       WHERE e.id=$1`,
      [entityId]
    );
    const e = rows[0];
    if (!e) return { ok: false, reason: 'missing' };
    const attrs = parseAttrs(e.attrs);
    if (attrs.description_ai && !opts.force) return { ok: true, skipped: true, chars: String(attrs.description_ai).length };

    const desc = await callChat(
      apiKey,
      buildUserPrompt({ ...e, search_group: 'equipment', unit: 'шт' })
    );
    const nextAttrs = {
      ...attrs,
      description_ai: desc,
      description_ai_at: new Date().toISOString(),
      description_ai_model: MODEL,
    };
    await db.query(
      `UPDATE equipment SET attrs = $2::jsonb, updated_at = NOW() WHERE id=$1`,
      [entityId, JSON.stringify(nextAttrs)]
    );
    // копируем на близнецов с тем же именем/маркой/моделью без описания
    await db.query(
      `UPDATE equipment e SET attrs = COALESCE(e.attrs,'{}'::jsonb) || $4::jsonb, updated_at = NOW()
       WHERE e.deleted_at IS NULL
         AND lower(trim(e.name)) = lower(trim($1))
         AND COALESCE(lower(trim(e.brand)),'') = COALESCE(lower(trim($2)),'')
         AND COALESCE(lower(trim(e.model)),'') = COALESCE(lower(trim($3)),'')
         AND (e.attrs IS NULL OR e.attrs->>'description_ai' IS NULL OR btrim(e.attrs->>'description_ai')='')`,
      [
        e.name,
        e.brand || '',
        e.model || '',
        JSON.stringify({
          description_ai: desc,
          description_ai_at: nextAttrs.description_ai_at,
          description_ai_model: MODEL,
        }),
      ]
    );
    return { ok: true, chars: desc.length, entity_type: 'equipment', id: entityId };
  }

  return { ok: false, reason: 'bad_type' };
}

module.exports = {
  MAX_CHARS,
  MODEL,
  SYSTEM,
  generateEntityDescription,
  clipDesc,
  buildUserPrompt,
};
