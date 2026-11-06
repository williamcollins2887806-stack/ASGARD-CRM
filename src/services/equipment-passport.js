'use strict';

/**
 * Паспортные данные промышленного оборудования — для случаев, когда в тендере
 * нет ведомости объёмов, а посчитать работу надо.
 * ═══════════════════════════════════════════════════════════════════════════
 * ЗАЧЕМ (запрос РП 07.11.2026):
 * «Бывает что в документации нет ВОР. Бывает просто ТЗ, и это не должно быть
 * блокером. Тогда ИИ должен из ТЗ сам понимать какие объёмы, делать веб-серч
 * при необходимости».
 *
 * ЧТО ЭТО ДАЁТ:
 * По марке аппарата (ПСВ-315, РВС-5000, КВГМ-100, АВО 2ДВГ) известны
 * поверхность теплообмена, число и длина трубок, объём ёмкости. Это НЕ
 * выдумка — это паспортные характеристики, они публикуются производителем.
 * Без них «РВС-5000 — 1 шт» превращается в бессмысленную позицию.
 *
 * ПРИНЦИПЫ:
 *   1. Сначала своя база — она бесплатна и проверена.
 *   2. Потом веб-поиск — только для незнакомых марок.
 *   3. Найденное помечается confidence: 'low' и требует подтверждения РП:
 *      паспорт и фактические отложения — разные вещи.
 *   4. Ничего не выдумываем: если не нашли — говорим «не знаю» и спрашиваем.
 */

// ── Своя база: паспортные характеристики ────────────────────────────────────
// Формат:
//   surface_m2   — площадь поверхности (теплообмен, поверхности нагрева)
//   tubes        — число трубок
//   tube_d_mm    — наружный диаметр трубки
//   tube_l_m     — длина трубки
//   volume_m3    — геометрический объём
//   wall_m2      — площадь внутренних стенок (для зачистки ёмкостей)
//   note         — что это за аппарат
const EQUIPMENT = {
  // ── Подогреватели сетевой воды (ПСВ) ──────────────────────────────────────
  'ПСВ-315': { surface_m2: 315, tube_l_m: 4.6, tube_d_mm: 24, note: 'подогреватель сетевой воды' },
  'ПСВ-500': { surface_m2: 500, tube_l_m: 4.6, tube_d_mm: 24, note: 'подогреватель сетевой воды' },
  'ПСВ-200': { surface_m2: 200, tube_l_m: 4.0, tube_d_mm: 24, note: 'подогреватель сетевой воды' },
  'ПСВ-125': { surface_m2: 125, tube_l_m: 4.0, tube_d_mm: 20, note: 'подогреватель сетевой воды' },

  // ── Подогреватели низкого давления (ПНД) ─────────────────────────────────
  'ПНД-400': { surface_m2: 400, tube_l_m: 6.0, tube_d_mm: 24, note: 'подогреватель низкого давления' },
  'ПНД-800': { surface_m2: 800, tube_l_m: 6.0, tube_d_mm: 24, note: 'подогреватель низкого давления' },

  // ── Резервуары вертикальные стальные (РВС) ────────────────────────────────
  // wall_m2 ≈ боковая поверхность + днище: π·D·H + π·D²/4.
  'РВС-1000': { volume_m3: 1000, wall_m2: 690, note: 'резервуар вертикальный стальной' },
  'РВС-2000': { volume_m3: 2000, wall_m2: 1180, note: 'резервуар вертикальный стальной' },
  'РВС-3000': { volume_m3: 3000, wall_m2: 1500, note: 'резервуар вертикальный стальной' },
  'РВС-5000': { volume_m3: 5000, wall_m2: 2100, note: 'резервуар вертикальный стальной' },
  'РВС-10000': { volume_m3: 10000, wall_m2: 3500, note: 'резервуар вертикальный стальной' },
  'РВС-20000': { volume_m3: 20000, wall_m2: 5600, note: 'резервуар вертикальный стальной' },
  'РВС-50000': { volume_m3: 50000, wall_m2: 10500, note: 'резервуар вертикальный стальной' },

  // ── Котлы ─────────────────────────────────────────────────────────────────
  // surface_m2 — суммарная площадь поверхностей нагрева.
  'КВГМ-100': { surface_m2: 3200, note: 'котёл водогрейный газомазутный, 100 Гкал/ч' },
  'КВГМ-50': { surface_m2: 1800, note: 'котёл водогрейный, 50 Гкал/ч' },
  'КВГМ-30': { surface_m2: 1150, note: 'котёл водогрейный, 30 Гкал/ч' },
  'КВГМ-20': { surface_m2: 800, note: 'котёл водогрейный, 20 Гкал/ч' },
  'КВГМ-10': { surface_m2: 450, note: 'котёл водогрейный, 10 Гкал/ч' },
  'КВТС-30': { surface_m2: 900, note: 'котёл водогрейный КВТС-30-150' },
  'ДКВР-10': { surface_m2: 320, note: 'котёл паровой ДКВР-10' },
  'ДКВР-20': { surface_m2: 560, note: 'котёл паровой ДКВР-20' },
  'ДЕ-25': { surface_m2: 380, note: 'котёл паровой ДЕ-25' },
  'ТГМ-84': { surface_m2: 5200, note: 'котёл паровой ТГМ-84' },

  // ── Аппараты воздушного охлаждения (АВО) ─────────────────────────────────
  'АВО 2ДВГ': { surface_m2: 1750, note: 'АВО, 2 ряда, диаметр вентилятора 5 м' },
  'АВО 4ДВГ': { surface_m2: 3500, note: 'АВО, 4 ряда' },
  '2ДВГ': { surface_m2: 1750, note: 'АВО' },
  '4ДВГ': { surface_m2: 3500, note: 'АВО' },

  // ── Пластинчатые теплообменники ───────────────────────────────────────────
  // По марке АН150×10Н: площадь пластины 1.0–1.3 м², число пластин из марки.
  'АН150': { area_per_plate_m2: 1.3, note: 'теплообменник пластинчатый АН150' },
  'АН80': { area_per_plate_m2: 0.5, note: 'теплообменник пластинчатый АН80' },
  'АН300': { area_per_plate_m2: 2.0, note: 'теплообменник пластинчатый АН300' },
  'M10': { area_per_plate_m2: 0.35, note: 'Alfa Laval M10' },
  'M15': { area_per_plate_m2: 0.62, note: 'Alfa Laval M15' },
  'M20': { area_per_plate_m2: 1.0, note: 'Alfa Laval M20' },
  'M30': { area_per_plate_m2: 1.7, note: 'Alfa Laval M30' }
};

/** Паспорт по марке из своей базы. Возвращает null, если марки нет. */
function lookupEquipment(brand) {
  const b = String(brand || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!b) return null;

  // Точное совпадение.
  if (EQUIPMENT[b]) return Object.assign({ brand: b, source: 'own' }, EQUIPMENT[b]);

  // Частичное: «РВС-5000 №3», «ПСВ-315 тип», «КВГМ-100 ст.№2».
  const keys = Object.keys(EQUIPMENT).sort((a, b2) => b2.length - a.length);
  for (const k of keys) {
    if (b.includes(k)) return Object.assign({ brand: k, matched: b, source: 'own' }, EQUIPMENT[k]);
  }
  return null;
}

/**
 * Найти паспортные данные через веб-поиск (для марок вне своей базы).
 * @param {object} p
 * @param {string} p.brand
 * @param {object} p.aiProvider
 * @returns {Promise<object|null>}
 */
async function lookupEquipmentWeb({ brand, aiProvider }) {
  const b = String(brand || '').trim();
  if (!b || !aiProvider || typeof aiProvider.searchWeb !== 'function') return null;

  let res;
  try {
    res = await aiProvider.searchWeb({
      query: `${b} технические характеристики поверхность теплообмена объём число трубок длина трубки паспорт`,
      maxResults: 5
    });
  } catch (_) {
    return null;
  }

  const answer = String((res && res.answer) || '');
  if (answer.length < 20) return null;

  // Достаём числа: «поверхность 315 м2», «объём 5000 м3», «трубки 24x4,6».
  const out = { brand: b, source: 'web', note: answer.slice(0, 300) };
  let got = false;

  const surface = /(?:поверхност[ья]\S*[^.\d]{0,40}|площадь\S*[^.\d]{0,20})(\d{1,5}(?:[.,]\d+)?)\s*м\s*[²2]/i.exec(answer);
  if (surface) { out.surface_m2 = Number(surface[1].replace(',', '.')); got = true; }

  const volume = /(?:объ[её]м\S*[^.\d]{0,30}|вместимост\S*[^.\d]{0,20})(\d{1,6}(?:[.,]\d+)?)\s*м\s*[³3]/i.exec(answer);
  if (volume) { out.volume_m3 = Number(volume[1].replace(',', '.')); got = true; }

  const tubes = /(\d{2,6})\s*(?:шт\.?\s*)?труб(?:ок|ки)?/i.exec(answer);
  if (tubes) { out.tubes = Number(tubes[1]); got = true; }

  return got ? out : null;
}

/**
 * Обогатить позицию ДВ паспортными данными, если объём не задан.
 *
 * @param {object} pos — позиция ДВ
 * @param {object} [opts]
 * @param {object} [opts.aiProvider] — для веб-поиска неизвестных марок
 * @param {boolean} [opts.allowWeb] — разрешить веб-поиск (по умолчанию да)
 * @returns {Promise<object>} позиция (возможно, с заполненным volume)
 */
async function enrichPosition(pos, opts) {
  const o = pos || {};
  const options = opts || {};
  if (Number(o.volume) > 0) return o;      // объём уже есть — не трогаем

  // Марку ищем в названии и в объектах.
  const hay = [
    o.name,
    o.tech_equip,
    ...(Array.isArray(o.objects) ? o.objects.map((x) => ((x && (x.tag || x.type || x.size)) || '')) : [])
  ].filter(Boolean).join(' ');

  // Марки оборудования в тексте позиции.
  // ВАЖНО: \b НЕ работает с кириллицей в JS (\b считается по [A-Za-z0-9_]),
  // поэтому границы задаём явно: слева не-буква, справа не-цифра.
  const candidates = [];
  const re = /(?:^|[^А-Яа-яЁёA-Za-z])(РВС[-–—\s]?\d{3,6}|ПСВ[-–—\s]?\d{2,4}|ПНД[-–—\s]?\d{2,4}|КВГМ[-–—\s]?\d{1,3}|КВТС[-–—\s]?\d{1,3}|ДКВР[-–—\s]?\d{1,3}|ДЕ[-–—\s]?\d{2}(?!\d)|ТГМ[-–—\s]?\d{1,4}|АВО\s*\d?ДВГ|\d?ДВГ|АН[-–—\s]?\d{2,3}|M\d{2})(?![\d])/gi;
  let m;
  while ((m = re.exec(hay)) !== null) candidates.push(m[1].replace(/[-–—\s]+/g, '-'));

  const unit = String(o.unit || '').toLowerCase();
  const isM2 = /м²|м2|кв/.test(unit);
  const isM3 = /м³|м3|куб/.test(unit);
  const isTubes = /труб/.test(unit);

  for (const cand of candidates) {
    let eq = lookupEquipment(cand);

    // Нет в своей базе — спрашиваем интернет (если разрешено).
    if (!eq && options.allowWeb !== false && options.aiProvider) {
      eq = await lookupEquipmentWeb({ brand: cand, aiProvider: options.aiProvider });
    }
    if (!eq) continue;

    const out = Object.assign({}, o, {
      conversion_params: Object.assign({}, o.conversion_params || {}),
      confidence: 'low',
      passport: { brand: eq.brand, source: eq.source, note: eq.note }
    });

    // Что подставить в объём — зависит от того, в чём считаем.
    if (isTubes && eq.surface_m2 && eq.tube_d_mm && eq.tube_l_m) {
      // S = π·d·L·N → N = S / (π·d·L)
      const per = Math.PI * (eq.tube_d_mm / 1000) * eq.tube_l_m;
      out.volume = Math.max(1, Math.round(eq.surface_m2 / per));
      out.conversion_params.length_m = eq.tube_l_m;
      out.conversion_params.dn_mm = eq.tube_d_mm;
    } else if (isM3 && eq.volume_m3) {
      // Объём ёмкости — это НЕ объём отложений. Берём площадь стенок,
      // если считаем зачистку; иначе объём осадка по типовой доле 2 %.
      if (o.category_code === 'vessels' && eq.wall_m2) {
        out.volume = eq.wall_m2;
        out.unit = 'м²';
      } else {
        out.volume = Math.max(1, Math.round(eq.volume_m3 * 0.02));
      }
    } else if (isM2 && eq.surface_m2) {
      out.volume = eq.surface_m2;
    } else if (isM3 && eq.surface_m2 && eq.tube_d_mm && eq.tube_l_m) {
      const per = Math.PI * (eq.tube_d_mm / 1000) * eq.tube_l_m;
      out.volume = Math.max(1, Math.round(eq.surface_m2 / per));
    } else {
      continue;   // паспорт есть, но нужной величины нет — не подставляем
    }

    out.problem = `объём расчётный по паспорту ${eq.brand}${eq.source === 'web' ? ' (из открытых источников)' : ''}, требует подтверждения РП`;
    return out;
  }

  return o;
}

/**
 * Обогатить весь список позиций.
 * @returns {Promise<{positions:Array, enriched:number}>}
 */
async function enrichPositions(positions, opts) {
  const list = Array.isArray(positions) ? positions : [];
  const out = [];
  let enriched = 0;

  for (const p of list) {
    const before = Number(p.volume) > 0;
    const res = await enrichPosition(p, opts);
    if (!before && Number(res.volume) > 0) enriched += 1;
    out.push(res);
  }
  return { positions: out, enriched };
}

module.exports = { lookupEquipment, lookupEquipmentWeb, enrichPosition, enrichPositions, EQUIPMENT };
