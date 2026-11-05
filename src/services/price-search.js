'use strict';
/**
 * Поиск по базе цен: «перчатки» / «каска» → позиции + предложения поставщиков.
 * Для UI и ИИ: summary, flat_offers, метаданные актуальности.
 */

const SOURCE_LABEL = {
  procurement: 'Закупка',
  manual: 'Вручную',
  ai_search: 'AI-поиск',
  quote: 'Счёт',
  market_monitoring: 'Мониторинг'
};

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(v) {
  const n = num(v);
  if (n == null) return '—';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ₽';
}

function ageDays(d) {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function freshnessOf(days) {
  if (days == null) return { code: 'unknown', label: 'дата неизвестна' };
  if (days <= 30) return { code: 'fresh', label: 'свежая' };
  if (days <= 90) return { code: 'ok', label: 'норма' };
  if (days <= 180) return { code: 'stale', label: 'устаревает' };
  return { code: 'old', label: 'устарела' };
}

function originLabel(o) {
  if (o.invoice_number) return `Счёт ${o.invoice_number}`;
  if (o.doc_registry_id) return `Док. #${o.doc_registry_id}`;
  const src = SOURCE_LABEL[o.source] || o.source || 'База цен';
  return src;
}

/** Синонимы «как на маркетплейсе»: каска ≈ шлем, перчатки ≈ рукавицы… */
const SYNONYMS = [
  { re: /каск|шлем|каскет/, add: ['каск', 'шлем', 'каскет'] },
  { re: /перчат|рукавиц|краг/, add: ['перчат', 'рукавиц', 'краг'] },
  // «шуруп» НЕ добавляем в ILIKE — иначе ловит «шуруповёрт»
  { re: /саморез/, add: ['саморез'] },
  { re: /(^|[^а-яё])шуруп(ы|ов|ами|ах)?([^а-яё]|$)/, add: ['саморез'] },
  { re: /электрод/, add: ['электрод'] },
  { re: /диск\s*отрез|отрезн\w*\s*диск|круг\s*отрез/, add: ['диск отрез', 'отрезн', 'круг отрез'] },
  { re: /прожив|гостиниц|отел|хостел|апарт|суточн/, add: ['прожив', 'номер', 'гостиниц', 'отел'] },
  { re: /респиратор|полумаск|противогаз/, add: ['респиратор', 'полумаск'] },
  { re: /очк\w*\s*защит|защитн\w*\s*очк|маск\w*\s*защит/, add: ['очки', 'маска'] },
  { re: /жилет/, add: ['жилет'] },
  { re: /болгар|ушм/, add: ['болгар', 'ушм'] },
  { re: /перфоратор/, add: ['перфоратор'] },
  { re: /(^|[^а-яё])дрель([^а-яё]|$)/, add: ['дрель'] }
];

/**
 * Ложные друзья: запрос про крепёж не должен тянуть инструмент.
 * when — запрос; drop — название позиции.
 */
const FALSE_FRIENDS = [
  {
    when: /саморез|(^|[^а-яё])шуруп(ы|ов|ами|ах)?([^а-яё]|$)/i,
    drop: /шурупов[её]рт|дрель[\s\-]*шуру|шуруповорот|плазморез/i
  }
];

/** Стем/варианты запроса + синонимы (каска→каск/шлем, перчатки→перчат) */
function queryVariants(q) {
  const raw = String(q || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const out = new Set([raw]);
  // убрать окончания мн.ч. / падежей (грубо, но ловит каски/перчатки/саморезы)
  const stems = [
    raw.replace(/(ами|ями|ов|ев|ей|ах|ях|ам|ям|ы|и|а|я|у|ю|е|о)$/i, ''),
    raw.replace(/(овые|овый|овая|ные|ный|ная|ские|ский|ская)$/i, '')
  ];
  for (const s of stems) {
    if (s && s.length >= 3) out.add(s);
  }
  for (const rule of SYNONYMS) {
    if (rule.re.test(raw)) rule.add.forEach((x) => out.add(x));
  }
  return [...out];
}

function isFalseFriend(q, name) {
  const qq = String(q || '');
  const nn = String(name || '');
  for (const rule of FALSE_FRIENDS) {
    if (rule.when.test(qq) && rule.drop.test(nn)) return true;
  }
  return false;
}

/** Кол-во в упаковке из названия: «(250)», «уп. 100 шт», «2900 шт» */
function parsePackQty(name) {
  const s = String(name || '');
  let m = s.match(/\((\d{2,5})\)/);
  if (m) return parseInt(m[1], 10);
  m = s.match(/(?:уп\.?|упак\.?|упаковка)\s*[^\d]{0,8}(\d{2,5})/i);
  if (m) return parseInt(m[1], 10);
  m = s.match(/(\d{2,5})\s*шт\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 10) return n; // «1 шт» не упаковка
  }
  return null;
}

function normalizeUnit(u) {
  const s = String(u || 'шт').trim().toLowerCase();
  if (/^кг|килограм/.test(s)) return 'кг';
  if (/^г$|^грам/.test(s)) return 'г';
  if (/упак|уп\.?$|^уп$/.test(s)) return 'упак';
  if (/компл|набор/.test(s)) return 'компл';
  if (/м2|м²|кв\.?\s*м/.test(s)) return 'м²';
  if (/^м$|^метр/.test(s)) return 'м';
  if (/л$|литр/.test(s)) return 'л';
  if (/пар/.test(s)) return 'пар';
  return s || 'шт';
}

/** Релевантность названия к запросу (чем выше — тем ближе к теме) */
function nameRelevance(q, name) {
  const raw = String(q || '').trim().toLowerCase();
  const n = String(name || '').toLowerCase();
  if (!raw || !n) return 0;
  if (isFalseFriend(raw, n)) return -10;
  let s = 0;
  if (n.includes(raw)) s += 2.2;
  const stem = raw.replace(/(ами|ями|ов|ев|ей|ах|ях|ам|ям|ы|и|а|я|у|ю|е|о)$/i, '');
  if (stem.length >= 4 && n.includes(stem)) s += 1.4;
  // целое слово в начале названия — как на маркетплейсе
  if (n.startsWith(raw) || n.startsWith(stem)) s += 1.2;
  const wordRe = new RegExp(`(^|[^а-яёa-z0-9])${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([а-яёa-z]*)?([^а-яёa-z0-9]|$)`, 'i');
  if (wordRe.test(n)) s += 1.5;
  return s;
}

function enrichOffer(o) {
  const asOf = o.invoice_date || o.recorded_at || null;
  const age = ageDays(asOf);
  const fr = freshnessOf(age);
  const unit = normalizeUnit(o.unit);
  const packQty = (o._pack_qty_hint != null && o._pack_qty_hint > 0)
    ? o._pack_qty_hint
    : parsePackQty(o.item_name || o.product_name || '');
  const price = num(o.unit_price);
  let pricePerPiece = null;
  let pricePerKg = null;
  if (o._unit_price_base_hint != null && o._unit_price_base_hint > 0) {
    pricePerPiece = o._unit_price_base_hint;
  } else if (price != null && packQty && (unit === 'упак' || unit === 'компл' || unit === 'шт')) {
    if (unit === 'упак' || unit === 'компл' || (unit === 'шт' && packQty >= 10)) {
      pricePerPiece = Math.round((price / packQty) * 10000) / 10000;
    }
  }
  if (price != null && unit === 'кг') pricePerKg = price;

  let unit_hint = `за ${unit}`;
  if ((unit === 'упак' || unit === 'компл') && packQty) unit_hint = `за упак (${packQty} шт)`;
  else if (unit === 'кг') unit_hint = 'за кг';
  else if (unit === 'шт') unit_hint = 'за 1 шт';

  let price_note = null;
  if (pricePerPiece != null && packQty && packQty > 1) {
    price_note = `≈ ${fmtMoney(pricePerPiece)} за 1 шт`;
  }

  return {
    ...o,
    unit,
    pack_qty: packQty,
    price_per_piece: pricePerPiece,
    price_per_kg: pricePerKg,
    unit_hint,
    price_note,
    as_of: asOf,
    age_days: age,
    freshness: fr.code,
    freshness_label: fr.label,
    source_label: SOURCE_LABEL[o.source] || o.source || '—',
    origin_label: originLabel(o)
  };
}

const GROUP_LABELS = {
  housing: 'Жильё', equipment: 'Оборудование', consumable: 'Расходники',
  materials: 'Материалы', tools: 'Инструмент', ppe: 'СИЗ',
  services: 'Услуги', food: 'Питание', other: 'Прочее'
};

function assembleResult(q, days, group, variants, hits, limit, extra = {}) {
  // Отсечь ложные друзья до группировки (саморез → не шуруповёрт)
  const cleanHits = hits.filter((r) => {
    const name = r.product_name || r.item_name || '';
    return !isFalseFriend(q, name);
  });

  const map = new Map();
  for (const r of cleanHits) {
    const key = r.product_id
      ? `p:${r.product_id}`
      : `n:${String(r.product_name || r.item_name || '').toLowerCase()}`;
    let g = map.get(key);
    const rel = nameRelevance(q, r.product_name || r.item_name);
    const baseScore = (Number(r.score) || 0) + rel;
    if (!g) {
      g = {
        product_id: r.product_id || null,
        name: r.product_name || r.item_name,
        unit: normalizeUnit(r.unit || 'шт'),
        article: r.article || null,
        category_id: r.category_id || null,
        category_name: r.category_name || null,
        search_group: r.search_group || 'other',
        score: baseScore,
        bySup: new Map()
      };
      map.set(key, g);
    } else if (baseScore > g.score) {
      g.score = baseScore;
      if (r.product_name) g.name = r.product_name;
    }

    const sk = `${r.supplier_id || 'x'}::${String(r.supplier_name || '').toLowerCase()}`;
    const offer = enrichOffer({
      price_id: r.price_id,
      supplier_id: r.supplier_id || null,
      supplier_name: r.supplier_name || 'Без поставщика',
      unit_price: num(r.unit_price),
      quantity: num(r.quantity),
      total: num(r.total),
      unit: r.product_base_unit || r.unit || g.unit,
      item_name: r.item_name,
      product_name: r.product_name || r.item_name,
      // pack из карточки товара (V449), иначе эвристика по названию в enrichOffer
      _pack_qty_hint: r.product_pack_qty != null ? num(r.product_pack_qty) : null,
      _unit_price_base_hint: r.product_unit_price_base != null ? num(r.product_unit_price_base) : null,
      invoice_date: r.invoice_date,
      invoice_number: r.invoice_number,
      doc_registry_id: r.doc_registry_id,
      recorded_at: r.recorded_at,
      source: r.source,
      source_url: r.source_url || null
    });
    const prev = g.bySup.get(sk);
    if (!prev) g.bySup.set(sk, offer);
    else if ((offer.unit_price ?? 1e18) < (prev.unit_price ?? 1e18)) g.bySup.set(sk, offer);
    else if (offer.unit_price === prev.unit_price && (offer.age_days ?? 1e9) < (prev.age_days ?? 1e9)) {
      g.bySup.set(sk, offer);
    }
  }

  let items = [...map.values()].map((g) => {
    const offers = [...g.bySup.values()]
      .sort((a, b) => (a.unit_price ?? 1e18) - (b.unit_price ?? 1e18)
        || (a.age_days ?? 1e9) - (b.age_days ?? 1e9));
    const prices = offers.map((o) => o.unit_price).filter((x) => x != null);
    const best = offers[0] || null;
    return {
      product_id: g.product_id,
      name: g.name,
      unit: g.unit,
      article: g.article,
      category_id: g.category_id,
      category_name: g.category_name,
      search_group: g.search_group,
      score: Math.round(g.score * 1000) / 1000,
      offers_count: offers.length,
      best_price: best ? best.unit_price : null,
      best_supplier: best ? best.supplier_name : null,
      best_as_of: best ? best.as_of : null,
      best_origin: best ? best.origin_label : null,
      min_price: prices.length ? Math.min(...prices) : null,
      max_price: prices.length ? Math.max(...prices) : null,
      offers
    };
  });

  // Сначала релевантность, внутри — цена
  items.sort((a, b) => (b.score - a.score) || ((a.best_price ?? 1e18) - (b.best_price ?? 1e18)));
  items = items.slice(0, limit);

  const flat_offers = items
    .flatMap((it) => it.offers.map((o) => ({
      product_id: it.product_id,
      product_name: it.name,
      category_name: it.category_name,
      search_group: it.search_group,
      article: it.article,
      relevance: it.score,
      ...o,
      unit: o.unit || it.unit
    })))
    .sort((a, b) => (b.relevance || 0) - (a.relevance || 0)
      || (a.unit_price ?? 1e18) - (b.unit_price ?? 1e18)
      || (a.age_days ?? 1e9) - (b.age_days ?? 1e9));

  const groupCounts = {};
  for (const it of items) {
    const g = it.search_group || 'other';
    groupCounts[g] = (groupCounts[g] || 0) + it.offers_count;
  }
  const other_groups = Object.entries(groupCounts)
    .map(([code, count]) => ({ code, label: GROUP_LABELS[code] || code, count }))
    .sort((a, b) => b.count - a.count);

  const allPrices = flat_offers.map((o) => o.unit_price).filter((x) => x != null);
  const totalOffers = flat_offers.length;
  const minP = allPrices.length ? Math.min(...allPrices) : null;
  const maxP = allPrices.length ? Math.max(...allPrices) : null;

  const top = flat_offers.slice(0, 5).map((o, i) =>
    `${i + 1}) ${o.product_name} — ${fmtMoney(o.unit_price)} ${o.unit_hint || ''} · ${o.supplier_name}` +
    (o.price_note ? ` (${o.price_note})` : '') +
    ` · ${o.origin_label}` +
    (o.as_of ? ` · на ${new Date(o.as_of).toLocaleDateString('ru-RU')}` : '') +
    (o.age_days != null ? ` (${o.freshness_label}, ${o.age_days} дн.)` : '')
  ).join('\n');

  const summary = items.length
    ? `По запросу «${q}»: ${items.length} позиций, ${totalOffers} предложений` +
      (minP != null ? `, цены ${fmtMoney(minP)}…${fmtMoney(maxP)}` : '') +
      (top ? `.\nЛучшие:\n${top}` : '')
    : `По запросу «${q}» предложений в базе цен нет`;

  return {
    q,
    days,
    search_group: group,
    variants,
    total_products: items.length,
    total_offers: totalOffers,
    min_price: minP,
    max_price: maxP,
    sort: 'relevance_then_price',
    summary,
    flat_offers: flat_offers.slice(0, 80),
    items,
    other_groups,
    ...extra
  };
}

/**
 * @param {object} db
 * @param {{ q: string, search_group?: string, days?: number, limit?: number }} opts
 */
async function searchPrices(db, opts = {}) {
  const q = String(opts.q || '').trim();
  if (q.length < 2) {
    return {
      q, items: [], flat_offers: [], total_products: 0, total_offers: 0,
      other_groups: [], summary: 'Запрос слишком короткий'
    };
  }
  const days = Math.min(Math.max(parseInt(opts.days, 10) || 730, 30), 1825);
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 60, 5), 120);
  const requestedGroup = opts.search_group ? String(opts.search_group) : null;
  const variants = queryVariants(q);
  const likes = variants.map((v) => `%${v}%`);

  const fetchHits = async (grp) => {
    const params = [q, likes, String(days), grp];
    const sqlCore = (withPack) => `
      WITH matched AS (
        SELECT
          pr.product_id,
          COALESCE(NULLIF(trim(p.name), ''), pr.item_name) AS product_name,
          COALESCE(p.unit, pr.unit, 'шт') AS unit,
          ${withPack ? 'p.pack_qty AS product_pack_qty, p.base_unit AS product_base_unit, p.unit_price_base AS product_unit_price_base,' : 'NULL::numeric AS product_pack_qty, NULL::text AS product_base_unit, NULL::numeric AS product_unit_price_base,'}
          p.article,
          c.id AS category_id,
          c.name AS category_name,
          COALESCE(c.search_group, 'other') AS search_group,
          pr.id AS price_id,
          pr.item_name,
          pr.unit_price,
          pr.quantity,
          pr.total,
          pr.invoice_date,
          pr.invoice_number,
          pr.doc_registry_id,
          pr.recorded_at,
          pr.source,
          pr.source_url,
          pr.supplier_id,
          COALESCE(s.name, pr.supplier_name) AS supplier_name,
          GREATEST(
            similarity(lower(COALESCE(p.name, '')), lower($1)),
            similarity(lower(pr.item_name), lower($1)),
            CASE
              WHEN pr.item_name ILIKE ANY($2::text[])
                OR COALESCE(p.name,'') ILIKE ANY($2::text[])
                OR COALESCE(p.article,'') ILIKE ANY($2::text[])
              THEN 0.7 ELSE 0
            END
          ) AS score
        FROM price_records pr
        LEFT JOIN products p ON p.id = pr.product_id AND p.deleted_at IS NULL
        LEFT JOIN product_categories c ON c.id = COALESCE(pr.product_category_id, p.category_id)
        LEFT JOIN suppliers s ON s.id = pr.supplier_id
        WHERE pr.unit_price > 0
          AND pr.recorded_at >= NOW() - ($3 || ' days')::interval
          AND (
            pr.item_name ILIKE ANY($2::text[])
            OR COALESCE(p.name, '') ILIKE ANY($2::text[])
            OR COALESCE(p.article, '') ILIKE ANY($2::text[])
            OR similarity(lower(pr.item_name), lower($1)) >= 0.22
            OR similarity(lower(COALESCE(p.name,'')), lower($1)) >= 0.22
          )
          AND ($4::text IS NULL OR COALESCE(c.search_group, 'other') = $4)
      )
      SELECT * FROM matched
      WHERE score >= 0.22
      ORDER BY score DESC, unit_price ASC, recorded_at DESC
      LIMIT 1200`;
    try {
      const { rows } = await db.query(sqlCore(true), params);
      return rows;
    } catch (e) {
      if (/pack_qty|base_unit|unit_price_base/i.test(String(e.message || e))) {
        const { rows } = await db.query(sqlCore(false), params);
        return rows;
      }
      throw e;
    }
  };

  // Всегда сначала ищем без фильтра группы — чтобы знать, где реально лежат хиты
  // (как на маркетплейсе: «каска» в СИЗ, а не в Материалах).
  const allHits = await fetchHits(null);
  let hits = allHits;
  let activeGroup = null;
  let relaxed = false;
  let relaxed_from = null;

  if (requestedGroup) {
    const filtered = allHits.filter((r) => (r.search_group || 'other') === requestedGroup);
    if (filtered.length) {
      hits = filtered;
      activeGroup = requestedGroup;
    } else if (allHits.length) {
      // Фильтр пустой, а без него есть — снимаем, как Ozon/WB
      hits = allHits;
      activeGroup = null;
      relaxed = true;
      relaxed_from = requestedGroup;
    } else {
      hits = [];
      activeGroup = requestedGroup;
    }
  }

  const extra = { relaxed, relaxed_from };
  if (relaxed && relaxed_from) {
    const fromLabel = GROUP_LABELS[relaxed_from] || relaxed_from;
    const topGroup = (() => {
      const counts = {};
      for (const r of allHits) {
        const g = r.search_group || 'other';
        counts[g] = (counts[g] || 0) + 1;
      }
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      return best ? (GROUP_LABELS[best[0]] || best[0]) : null;
    })();
    extra.relax_hint = topGroup
      ? `В «${fromLabel}» пусто — показали все совпадения (чаще в «${topGroup}»)`
      : `В «${fromLabel}» пусто — показали все совпадения`;
  }

  return assembleResult(q, days, activeGroup, variants, hits, limit, extra);
}

module.exports = {
  searchPrices, fmtMoney, queryVariants, enrichOffer, GROUP_LABELS,
  isFalseFriend, parsePackQty, nameRelevance, normalizeUnit
};
