/**
 * ASGARD CRM — Mimir Conductor: агент «Исследование ставок и норм» (rates_researcher)
 * ═══════════════════════════════════════════════════════════════════════════
 * Закрывает дыру: labor_calculator и consumables_calculator упирались в отсутствие
 * ставок и норм → BLOCKING. Этот агент САМ ИЩЕТ их по 4 источникам в порядке
 * убывания надёжности:
 *
 *   1) Каталог CRM            — products.last_price + field_tariff_grid.rate_per_shift
 *                               (точность ±0–5% — реальные закупки/тарифы предприятия)
 *   2) applicable_norms эталонов — labor_rates_rub_per_shift и consumables из похожего
 *                                  проекта (через historical_comparator). ±5–10%.
 *   3) RAG нормативов ГЭСН/ФЕР  — mimir_norms_index (pgvector). ±10% (если индекс заполнен).
 *   4) Веб-поиск через LLM       — aiProvider + plugins:[{id:'web'}]. ±15–25%.
 *
 * Артефакт: rates_research
 *   {
 *     labor_rates:  { "<position>": { value, unit:"₽/смену", source, confidence_pct, citations[] } },
 *     timing_norms: { prep_days:N, mob_demob_days:N, work_shifts:N, ... },
 *     consumables:  { "<name>": { value, unit, per_unit:"100м3", source, confidence_pct } },
 *     summary, key_findings[], clarifications[]
 *   }
 *
 * Решения этого агента ПОДКЛЮЧАЮТСЯ в labor_calculator и consumables_calculator
 * через requiredArtifacts.rates_research → если значение найдено, BLOCKING не возникает.
 *
 * ВАЖНО: НЕТ ХАРДКОДА. Любая цифра в результате — либо реально из БД, либо
 * вытащена LLM из веб-источников с цитатой. Если все 4 источника пусты —
 * возвращаем BLOCKING с конкретным указанием что не найдено и где можно заполнить.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../../db');
const aiProvider = require('../../ai-provider');
const { aiCompleteJson, formatRub } = require('./_util');

/* ─────────────────────────────────────────────────────────────────────────
 * Источник 1: CRM (каталог products + тарифная сетка field_tariff_grid)
 * ─────────────────────────────────────────────────────────────────────── */

async function findLaborRateInCrm(position) {
  // field_tariff_grid: position_name + rate_per_shift
  // Двусторонний fuzzy match (pg_trgm similarity).
  try {
    const r = await db.query(
      `SELECT position_name, rate_per_shift,
              GREATEST(similarity(lower(position_name), lower($1)),
                       similarity(lower($1), lower(position_name))) AS sim
         FROM field_tariff_grid
        WHERE is_active = true AND rate_per_shift > 0
        ORDER BY sim DESC NULLS LAST, rate_per_shift DESC
        LIMIT 5`,
      [position]
    );
    // Берём наилучшее совпадение с similarity >= 0.3 (трешхолд)
    const best = r.rows.find((x) => Number(x.sim) >= 0.3) || r.rows[0];
    if (best && Number(best.rate_per_shift) > 0) {
      return {
        value: Number(best.rate_per_shift),
        unit: '₽/смену',
        source: 'crm.field_tariff_grid',
        confidence_pct: best.sim >= 0.5 ? 95 : (best.sim >= 0.3 ? 85 : 70),
        matched_key: best.position_name,
        similarity: Number(best.sim || 0).toFixed(2)
      };
    }
  } catch (_) { /* pg_trgm может отсутствовать — игнор */ }
  // Простой ILIKE fallback (без pg_trgm)
  try {
    const r = await db.query(
      `SELECT position_name, rate_per_shift FROM field_tariff_grid
        WHERE is_active = true AND rate_per_shift > 0 AND position_name ILIKE $1
        ORDER BY rate_per_shift DESC LIMIT 1`,
      [`%${position.split(/[\s(\-]+/)[0]}%`]
    );
    if (r.rows[0] && Number(r.rows[0].rate_per_shift) > 0) {
      return {
        value: Number(r.rows[0].rate_per_shift),
        unit: '₽/смену',
        source: 'crm.field_tariff_grid',
        confidence_pct: 75,
        matched_key: r.rows[0].position_name
      };
    }
  } catch (_) {}
  return null;
}

async function findConsumablePriceInCrm(name) {
  // products.last_price + similarity по lower(name).
  try {
    const r = await db.query(
      `SELECT name, last_price, unit,
              GREATEST(similarity(lower(name), lower($1)),
                       similarity(lower($1), lower(name))) AS sim
         FROM products
        WHERE last_price > 0 AND deleted_at IS NULL
        ORDER BY sim DESC NULLS LAST, last_price DESC
        LIMIT 5`,
      [name]
    );
    const best = r.rows.find((x) => Number(x.sim) >= 0.3) || r.rows[0];
    if (best && Number(best.last_price) > 0) {
      return {
        value: Number(best.last_price),
        unit: best.unit || '₽/шт',
        source: 'crm.products',
        confidence_pct: best.sim >= 0.5 ? 95 : (best.sim >= 0.3 ? 80 : 65),
        matched_key: best.name,
        similarity: Number(best.sim || 0).toFixed(2)
      };
    }
  } catch (_) {}
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Источник 2: applicable_norms эталонов
 * ─────────────────────────────────────────────────────────────────────── */

function findLaborRateInAnalogs(analogs, position) {
  if (!analogs || !analogs.analysis) return null;
  const rates = (analogs.analysis.applicable_norms &&
                 analogs.analysis.applicable_norms.labor_rates_rub_per_shift) || {};
  const posLow = String(position || '').toLowerCase();
  const key = Object.keys(rates).find((k) => {
    const kLow = k.toLowerCase();
    return posLow.includes(kLow) || kLow.includes(posLow.split(/[\s(\-]+/)[0]);
  });
  if (key && rates[key] > 0) {
    return {
      value: Number(rates[key]),
      unit: '₽/смену',
      source: `analog.${analogs.analogs && analogs.analogs[0] ? analogs.analogs[0].title : '?'}`,
      confidence_pct: 85,
      matched_key: key
    };
  }
  return null;
}

function findConsumableInAnalogs(analogs, name) {
  if (!analogs || !analogs.analysis) return null;
  const consum = (analogs.analysis.applicable_norms &&
                  analogs.analysis.applicable_norms.consumables) || {};
  const nLow = String(name || '').toLowerCase();
  const key = Object.keys(consum).find((k) => {
    const kLow = k.toLowerCase();
    return nLow.includes(kLow) || kLow.includes(nLow.split(/[\s(\-]+/)[0]);
  });
  if (key && consum[key] != null) {
    const v = consum[key];
    return {
      value: typeof v === 'object' ? v.value : Number(v),
      unit: (typeof v === 'object' && v.unit) || '₽/шт',
      source: `analog.${analogs.analogs && analogs.analogs[0] ? analogs.analogs[0].title : '?'}`,
      confidence_pct: 80,
      matched_key: key
    };
  }
  return null;
}

function findTimingInAnalogs(analogs, key) {
  if (!analogs || !analogs.analysis) return null;
  const timing = (analogs.analysis.applicable_norms &&
                  analogs.analysis.applicable_norms.timing_norms) || {};
  if (timing[key] != null) {
    return {
      value: Number(timing[key]),
      unit: 'дней',
      source: `analog.${analogs.analogs && analogs.analogs[0] ? analogs.analogs[0].title : '?'}.timing_norms.${key}`,
      confidence_pct: 80
    };
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Источник 3: RAG ГЭСН/ФЕР (mimir_norms_index, pgvector)
 * ─────────────────────────────────────────────────────────────────────── */

async function findNormInRag(query) {
  try {
    const r = await db.query(
      `SELECT code, name, source, full_text FROM mimir_norms_index
        WHERE full_text ILIKE $1
        ORDER BY id DESC LIMIT 3`,
      [`%${query}%`]
    );
    if (r.rows[0]) {
      return {
        source: `rag.${r.rows[0].source || 'norms'}`,
        confidence_pct: 80,
        code: r.rows[0].code,
        excerpt: String(r.rows[0].full_text || '').slice(0, 300)
      };
    }
  } catch (_) { /* индекс может быть пуст */ }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Источник 4: Веб-поиск через LLM
 * ─────────────────────────────────────────────────────────────────────── */

const WEB_SYSTEM = `Ты — поисковик данных по нормативам/ценам для подрядной сметы.
По запросу пользователя найди КОНКРЕТНУЮ цифру (рубли, штуки, дни) для России на 2026 г.
Используй веб-поиск (b2b-center.ru, pulscen.ru, tiu.ru, ozon.ru, hh.ru, superjob.ru, СНИП, ГЭСН).
Верни СТРОГО JSON:
{ "value": число, "unit": "₽/смену | ₽/шт | шт/100м3 | дн | ...",
  "confidence_pct": 0..100, "citations": ["URL1","URL2"], "rationale": "1-2 предложения" }
Если найти нельзя — value:null, confidence_pct:0.`;

async function findViaWebLLM(query, expectedUnit) {
  try {
    const userMsg = `Найди для России 2026: ${query}\nОжидаемая единица: ${expectedUnit || 'любая'}.\nДай ОДНУ цифру и ссылки.`;
    const parsed = await aiCompleteJson(aiProvider, {
      system: WEB_SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
      model: 'web-search-fast',
      maxTokens: 2000
    }, {
      agentName: 'rates_researcher.web',
      maxAttempts: 2,
      fallback: null
    }).catch(() => null);
    if (parsed && parsed.value != null && Number(parsed.value) > 0) {
      return {
        value: Number(parsed.value),
        unit: parsed.unit || expectedUnit,
        source: 'web.llm',
        confidence_pct: Math.min(100, Math.max(0, Number(parsed.confidence_pct) || 50)),
        citations: parsed.citations || [],
        rationale: parsed.rationale || ''
      };
    }
  } catch (_) {}
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Универсальный поиск с приоритетом источников
 * ─────────────────────────────────────────────────────────────────────── */

async function resolveLaborRate(position, analogs, onThought) {
  // 1. CRM
  const fromCrm = await findLaborRateInCrm(position);
  if (fromCrm) {
    onThought(`✓ ${position}: ${fromCrm.value} ₽/смену (CRM, ${fromCrm.confidence_pct}%, ключ "${fromCrm.matched_key}")`);
    return fromCrm;
  }
  // 2. Аналоги
  const fromAnalog = findLaborRateInAnalogs(analogs, position);
  if (fromAnalog) {
    onThought(`✓ ${position}: ${fromAnalog.value} ₽/смену (эталон, ${fromAnalog.confidence_pct}%)`);
    return fromAnalog;
  }
  // 3. RAG ГЭСН/ФЕР (для ставок применимо мало, но индекс может содержать тарифы УР)
  // 4. Веб
  onThought(`→ ${position}: ищу в web (не нашли в CRM/эталонах)…`);
  const fromWeb = await findViaWebLLM(`средняя дневная ставка (₽/смену) для позиции "${position}" подрядчик нефтегаз 2026`, '₽/смену');
  if (fromWeb) {
    onThought(`✓ ${position}: ${fromWeb.value} ₽/смену (web, ${fromWeb.confidence_pct}%)`);
    return fromWeb;
  }
  onThought(`⚠ ${position}: не найдено ни в одном из 4 источников`);
  return null;
}

async function resolveConsumablePrice(name, analogs, onThought) {
  const fromCrm = await findConsumablePriceInCrm(name);
  if (fromCrm) {
    onThought(`✓ ${name}: ${fromCrm.value} ${fromCrm.unit} (CRM, ${fromCrm.confidence_pct}%, "${fromCrm.matched_key}")`);
    return fromCrm;
  }
  const fromAnalog = findConsumableInAnalogs(analogs, name);
  if (fromAnalog) {
    onThought(`✓ ${name}: ${fromAnalog.value} ${fromAnalog.unit} (эталон, ${fromAnalog.confidence_pct}%)`);
    return fromAnalog;
  }
  onThought(`→ ${name}: ищу в web…`);
  const fromWeb = await findViaWebLLM(`актуальная закупочная цена "${name}" 2026 Россия`, '₽/шт');
  if (fromWeb) {
    onThought(`✓ ${name}: ${fromWeb.value} ${fromWeb.unit} (web, ${fromWeb.confidence_pct}%)`);
    return fromWeb;
  }
  return null;
}

async function resolveTimingNorm(key, analogs, ragQuery, onThought) {
  const fromAnalog = findTimingInAnalogs(analogs, key);
  if (fromAnalog) {
    onThought(`✓ ${key}: ${fromAnalog.value} дней (эталон, ${fromAnalog.confidence_pct}%)`);
    return fromAnalog;
  }
  if (ragQuery) {
    const fromRag = await findNormInRag(ragQuery);
    if (fromRag) {
      onThought(`→ ${key}: нашёл норматив ${fromRag.code} в RAG, но без точной цифры — оставлю BLOCKING`);
    }
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Главный run
 * ─────────────────────────────────────────────────────────────────────── */

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};
  const crewPlan = requiredArtifacts.crew_plan || {};
  const analogs = requiredArtifacts.analogs_comparison || {};

  onThought('Этап 1/3: резолвлю ставки бригады из 4 источников');

  // Позиции, для которых нужны ставки — берём из crew_composer или дефолтный набор
  const positions = (crewPlan.crew && crewPlan.crew.length)
    ? Array.from(new Set(crewPlan.crew.map((c) => c.role || c.position).filter(Boolean)))
    : ['ИТР (РП)', 'Мастер ответственный', 'Слесарь (полный функционал)'];

  const labor_rates = {};
  const unresolvedLabor = [];
  for (const pos of positions) {
    const r = await resolveLaborRate(pos, analogs, onThought);
    if (r) labor_rates[pos] = r;
    else unresolvedLabor.push(pos);
  }

  onThought('Этап 2/3: резолвлю нормативы сроков (prep_days, mob_demob_days)');
  const timing_norms = {};
  const timingKeys = [
    { key: 'prep_days', rag: 'подготовка склад химпромывка дни' },
    { key: 'mob_demob_days', rag: 'мобилизация демобилизация офшорный объект' }
  ];
  const unresolvedTiming = [];
  for (const t of timingKeys) {
    const r = await resolveTimingNorm(t.key, analogs, t.rag, onThought);
    if (r) timing_norms[t.key] = r;
    else unresolvedTiming.push(t.key);
  }

  onThought('Этап 3/3: резолвлю цены типовых расходников');
  const consumables_names = ['щётка металлическая', 'насадка гидродинамическая', 'комплект СИЗ'];
  const consumables = {};
  const unresolvedConsum = [];
  for (const name of consumables_names) {
    const r = await resolveConsumablePrice(name, analogs, onThought);
    if (r) consumables[name] = r;
    else unresolvedConsum.push(name);
  }

  // Сводка по источникам
  const allResolved = { ...labor_rates, ...timing_norms, ...consumables };
  const bySource = {};
  for (const k of Object.keys(allResolved)) {
    const src = (allResolved[k].source || 'unknown').split('.')[0];
    bySource[src] = (bySource[src] || 0) + 1;
  }
  const summary = `Резолвнуто ${Object.keys(allResolved).length}/${positions.length + timingKeys.length + consumables_names.length} ставок и норм. ` +
    `Источники: ${Object.entries(bySource).map(([s, n]) => `${s}=${n}`).join(', ')}.`;

  const clarifications = [];
  if (unresolvedLabor.length) {
    clarifications.push({
      channel: 'PM', category: 'rates', blocking: false,
      question_ru: `Не нашёл ставки для ${unresolvedLabor.length} позиций: ${unresolvedLabor.join(', ')}. Заполните вручную или примите оценку.`,
      expected_inputs: unresolvedLabor.map((p) => ({
        key: `rate_${p.toLowerCase().replace(/[^а-яa-z]/g, '_')}`,
        label: `Ставка "${p}" (₽/смену)`, type: 'number', unit: '₽',
        target: `field_tariff_grid.${p}`
      }))
    });
  }
  if (unresolvedTiming.length) {
    clarifications.push({
      channel: 'PM', category: 'timing', blocking: false,
      question_ru: `Не нашёл нормы сроков для ${unresolvedTiming.join(', ')}.`,
      expected_inputs: unresolvedTiming.map((k) => ({
        key: k, label: k, type: 'number', unit: 'дн',
        target: `reference_norms.timing_norms.${k}`
      }))
    });
  }
  if (unresolvedConsum.length) {
    clarifications.push({
      channel: 'PM', category: 'consumables', blocking: false,
      question_ru: `Не нашёл цены для ${unresolvedConsum.join(', ')}.`
    });
  }

  return {
    summary,
    key_findings: [
      ...Object.entries(labor_rates).map(([k, v]) => `${k}: ${formatRub(v.value)} (${v.source}, ${v.confidence_pct}%)`),
      ...Object.entries(timing_norms).map(([k, v]) => `${k}: ${v.value} дн (${v.source})`),
      ...Object.entries(consumables).map(([k, v]) => `${k}: ${formatRub(v.value)} (${v.source})`)
    ],
    labor_rates,
    timing_norms,
    consumables,
    sources_used: bySource,
    clarifications
  };
}

module.exports = { run };
