'use strict';
/**
 * Приведение объёма из ведомости объёмов к единице, которую ждёт норма.
 *
 * Зачем. В ВОР объём приходит как удобно заказчику: «1750 м²», «1353 т»,
 * «500 трубок», «12 дюймов». Норма считает в своей единице: м³ ёмкости,
 * трубки, м² поверхности, стыки. Без пересчёта позиция уходит в «эксперт»
 * или считается неверно.
 *
 * Главный принцип: НЕ УГАДЫВАТЬ. Если для пересчёта нужен параметр
 * (толщина слоя, плотность, диаметр), а его нет — функция возвращает
 * missing[], и вызывающий код обязан спросить РП. Типовое значение
 * подставляется только если это разрешено явно (allowAssumed), и тогда
 * результат помечается assumed: true с текстом допущения.
 *
 * Формулы проверены исследованием 06.11.2026:
 *   • трубный пучок S = π·d·L·N  — ГОСТ 15122-79, отклонение ≤2,6% на 36 строках;
 *   • пластины S = f·(N−2)      — ГОСТ 15518-87, отклонение 0…+8% (f·N завышает до +60%);
 *   • ёмкость V = S·h и V = m/ρ;
 *   • шов трубы L = π·D         — ГОСТ 16037-80.
 */

const SQ = {};

/** Нормализация единицы: м2 → м², м3 → м³, л → литр. */
function normUnit(u) {
  const s = String(u == null ? '' : u).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return '';
  if (s === 'м2' || s === 'м²' || s === 'кв.м' || s === 'квм' || s === 'm2') return 'м²';
  if (s === 'м3' || s === 'м³' || s === 'куб' || s === 'куб.м' || s === 'm3') return 'м³';
  if (s === 'м' || s === 'м.п.' || s === 'мп' || s === 'пог.м' || s === 'm') return 'м';
  if (s === 'л' || s === 'литр' || s === 'литры' || s === 'l') return 'литр';
  if (s === 'т' || s === 'тонна' || s === 'тонны' || s === 't') return 'т';
  if (s === 'шт' || s === 'штук' || s === 'штуки' || s === 'pcs') return 'шт';
  if (s === 'мм' || s === 'mm') return 'мм';
  if (s === 'см' || s === 'cm') return 'см';
  if (s === 'дюйм' || s === 'дюймы' || s === '"' || s === 'inch') return 'дюйм';
  if (s.startsWith('труб')) return 'трубки';
  if (s.startsWith('пластин')) return 'пластины';
  if (s.startsWith('стык')) return 'стык';
  if (s.startsWith('цикл')) return 'цикл';
  if (s.startsWith('компл')) return 'компл';
  return s;
}

/**
 * DN ↔ дюймы ↔ наружный диаметр.
 *
 * ВАЖНО: при одном и том же DN наружный диаметр РАЗНЫЙ в двух сортаментах.
 * Смешивать нельзя — это даёт ошибку в длине шва до 6%, а на 100 стыках
 * это уже метры шва и часы работы (проверено исследованием 06.11.2026).
 *
 *   eu   — EN/DIN 2448 (импорт, европейская арматура)
 *   gost — ГОСТ 8732 (бесшовные) / 3262 (ВГП)
 *
 * Значения сверены с таблицей Ду/DN/NPS/OD.
 * По умолчанию используется eu — для нестандартизованных «труба 2 дюйма».
 * Для «Ду100 ГОСТ 8732» надо явно просить gost.
 */
const INCH_TO_MM = {
  '1/4': { dn: 8, eu: 13.5, gost: 13.5 },
  '3/8': { dn: 10, eu: 17.2, gost: 17.0 },
  '1/2': { dn: 15, eu: 21.3, gost: 21.3 },
  '3/4': { dn: 20, eu: 26.9, gost: 26.8 },
  '1': { dn: 25, eu: 33.7, gost: 33.5 },
  '1 1/4': { dn: 32, eu: 42.4, gost: 42.3 },
  '1 1/2': { dn: 40, eu: 48.3, gost: 48.0 },
  '2': { dn: 50, eu: 60.3, gost: 57.0 },
  '2 1/2': { dn: 65, eu: 76.1, gost: 76.0 },
  '3': { dn: 80, eu: 88.9, gost: 89.0 },
  '3 1/2': { dn: 90, eu: 101.6, gost: 102.0 },
  '4': { dn: 100, eu: 114.3, gost: 108.0 },
  '5': { dn: 125, eu: 139.7, gost: 133.0 },
  '6': { dn: 150, eu: 168.3, gost: 159.0 },
  '8': { dn: 200, eu: 219.1, gost: 219.0 },
  '10': { dn: 250, eu: 273.0, gost: 273.0 },
  '12': { dn: 300, eu: 323.9, gost: 325.0 },
  '14': { dn: 350, eu: 355.6, gost: 377.0 },
  '16': { dn: 400, eu: 406.4, gost: 426.0 },
  '20': { dn: 500, eu: 508.0, gost: 530.0 }
};

/**
 * Дюймы → { dn_mm, od_mm, standard }.
 *
 * @param {string|number} value  «2», «1 1/2», «4»
 * @param {string} standard      'eu' (по умолчанию) либо 'gost'
 */
function inchToMm(value, standard) {
  const v = String(value == null ? '' : value).replace(',', '.').trim();
  const std = String(standard || 'eu').toLowerCase() === 'gost' ? 'gost' : 'eu';
  const row = INCH_TO_MM[v];
  if (row) {
    return { dn_mm: row.dn, od_mm: row[std], standard: std };
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Ближайший табличный размер.
  let best = null;
  let bestDiff = Infinity;
  for (const k of Object.keys(INCH_TO_MM)) {
    const frac = k.split(' ').reduce((acc, part) => {
      if (part.includes('/')) {
        const [a, b] = part.split('/').map(Number);
        return acc + (b ? a / b : 0);
      }
      return acc + Number(part);
    }, 0);
    const d = Math.abs(frac - n);
    if (d < bestDiff) { bestDiff = d; best = k; }
  }
  return best
    ? { dn_mm: INCH_TO_MM[best].dn, od_mm: INCH_TO_MM[best][std], standard: std, approximated: true }
    : null;
}

/**
 * Площадь ёмкости (стенки + днище) через диаметр и высоту.
 * S = π·D·H + π·D²/4·(днищ). Отсюда же S/V = 4/D + 1/H.
 */
function cylinderSurfaceM2(diameterM, heightM, bottoms) {
  const d = Number(diameterM);
  const h = Number(heightM);
  if (!(d > 0) || !(h > 0)) return null;
  const nBottoms = Number(bottoms) > 0 ? Number(bottoms) : 1;
  const side = Math.PI * d * h;
  const bottom = (Math.PI * d * d) / 4 * nBottoms;
  return Math.round((side + bottom) * 1000) / 1000;
}

/** Объём цилиндра V = π·D²/4·H. */
function cylinderVolumeM3(diameterM, heightM) {
  const d = Number(diameterM);
  const h = Number(heightM);
  if (!(d > 0) || !(h > 0)) return null;
  return Math.round((Math.PI * d * d / 4 * h) * 1000) / 1000;
}

/** Длина шва одного стыка трубы: L = π·D (D в метрах, результат в метрах). */
function weldLengthPerJoint(dnMm) {
  const d = Number(dnMm);
  if (!(d > 0)) return null;
  return Math.round((Math.PI * d / 1000) * 10000) / 10000;
}

/**
 * Площадь одной трубки, м². По умолчанию — по внутреннему диаметру.
 *
 * ГОСТ даёт площадь по НАРУЖНОМУ диаметру, а чистят внутреннюю поверхность.
 * Разница 11–19% (проверено исследованием 06.11.2026): для 25×2 внутренний
 * меньше наружного на 19%. Поэтому по умолчанию считаем по внутреннему.
 */
function tubeAreaM2(diameterMm, lengthM, opts) {
  const d = Number(diameterMm);
  const l = Number(lengthM);
  if (!(d > 0) || !(l > 0)) return null;
  const inner = opts && opts.inner === false ? false : true;
  // Толщина стенки по умолчанию 1 мм, если не задана.
  const wall = Number(opts && opts.wallMm) > 0 ? Number(opts.wallMm) : 1;
  const dEff = inner ? Math.max(1, d - 2 * wall) : d;
  return Math.round((Math.PI * dEff / 1000 * l) * 10000) / 10000;
}

/**
 * Длина шва одного стыка с поправкой на толщину стенки.
 *
 * Номинал — по наружному диаметру: L = π·D.
 * Корневой проход идёт по внутреннему: L_корня = π·(D − 2S).
 * Для тонких стенок (S/D < 0.1) разницей пренебрегают, для толстых — нет:
 * D114×S6 даёт 0,358 → 0,320 м (−11%).
 *
 * @returns {{ outer: number, root: number, diffPct: number, useRoot: boolean }}
 */
function weldLengthDetailed(dnMm, wallMm) {
  const d = Number(dnMm);
  if (!(d > 0)) return null;
  const outer = Math.round((Math.PI * d / 1000) * 10000) / 10000;
  const s = Number(wallMm) > 0 ? Number(wallMm) : 0;
  if (!(s > 0)) {
    return { outer, root: outer, diffPct: 0, useRoot: false };
  }
  const dRoot = Math.max(1, d - 2 * s);
  const root = Math.round((Math.PI * dRoot / 1000) * 10000) / 10000;
  const diffPct = Math.round(((outer - root) / outer) * 1000) / 10;
  // Поправка существенна при S/D > 0.1 (толстостенные трубы).
  const useRoot = s / d > 0.1;
  return { outer, root, diffPct, useRoot };
}

/**
 * Основная функция пересчёта.
 *
 * @param {object} p
 * @param {string} p.category   код категории (vessels, tubes…)
 * @param {string} p.method     код метода
 * @param {string} p.fromUnit   единица из ВОР
 * @param {number} p.value      число из ВОР
 * @param {object} p.toField    поле, которое ждёт норма (volume_m3, tubes…)
 * @param {object} p.params     известные параметры: { thickness_mm, density_t_m3, dn_mm, length_m, area_per_plate_m2 }
 * @param {object} p.rule       правило из work_norm_unit_conversions
 * @param {object} p.defaults   типовые значения (толщина/плотность)
 * @param {boolean} p.allowAssumed  разрешено подставлять типовое значение
 * @param {string} p.fouling    тип отложений для выбора плотности
 *
 * @returns {{ ok, value, unit, assumed, missing, note, trace }}
 */
function convert(p) {
  const o = p || {};
  const from = normUnit(o.fromUnit);
  const value = Number(o.value);
  const trace = [];
  const missing = [];

  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, value: null, assumed: false, missing: [], note: 'объём не указан', trace };
  }
  if (!from) {
    return { ok: false, value: null, assumed: false, missing: ['unit'], note: 'единица не указана', trace };
  }

  const rule = o.rule || null;
  if (!rule) {
    return {
      ok: false, value: null, assumed: false, missing: ['rule'],
      note: `нет правила пересчёта «${from}» для ${o.category}.${o.method}`, trace
    };
  }

  const params = o.params || {};
  const defaults = o.defaults || {};
  const kind = String(rule.formula_kind || 'multiply');
  let assumed = false;
  let note = '';

  /** Достаёт параметр: сначала из позиции, потом типовое, потом missing. */
  function param(name, defaultKey) {
    const direct = Number(params[name]);
    if (Number.isFinite(direct) && direct > 0) {
      trace.push(`${name}=${direct} (из позиции)`);
      return direct;
    }
    if (defaults[defaultKey || name] != null) {
      const d = Number(defaults[defaultKey || name]);
      if (Number.isFinite(d) && d > 0) {
        if (o.allowAssumed) {
          assumed = true;
          trace.push(`${name}=${d} (типовое, допущение)`);
          return d;
        }
        missing.push(name);
        return null;
      }
    }
    const fb = Number(rule.fallback_typical);
    if (Number.isFinite(fb) && fb > 0 && o.allowAssumed) {
      assumed = true;
      trace.push(`${name}=${fb} (типовое из правила, допущение)`);
      return fb;
    }
    missing.push(name);
    return null;
  }

  let result = null;

  if (kind === 'multiply') {
    // S × h → м³  либо  N × f → м²
    const need = rule.needs_param ? String(rule.needs_param) : null;
    if (need === 'thickness_mm') {
      const hMm = param('thickness_mm');
      if (hMm == null) return fail(missing, 'нужна толщина слоя, мм', trace);
      result = value * (hMm / 1000);
      trace.push(`${value} ${from} × ${hMm} мм = ${round3(result)} м³`);
    } else if (need === 'density_t_m3') {
      // Для плотности используется формула деления, см. ниже.
      return convert(Object.assign({}, o, { rule: Object.assign({}, rule, { formula_kind: 'divide' }) }));
    } else if (need === 'area_per_plate_m2') {
      const f = param('area_per_plate_m2');
      if (f == null) return fail(missing, 'нужна площадь одной пластины, м²', trace);
      // S = f·(N−2)
      result = f * Math.max(0, value - 2);
      trace.push(`${value} пластин − 2 крайние = ${value - 2} × ${f} м² = ${round3(result)} м²`);
    } else {
      result = value * (Number(rule.factor) || 1);
      trace.push(`${value} × ${Number(rule.factor) || 1} = ${round3(result)}`);
    }
  } else if (kind === 'divide') {
    const div = Number(rule.factor) || 1;
    if (String(rule.needs_param) === 'density_t_m3') {
      const rho = param('density_t_m3', densityKey(o.fouling));
      if (rho == null) return fail(missing, 'нужна плотность отложений, т/м³', trace);
      result = value / rho;
      trace.push(`${value} т / ${rho} т/м³ = ${round3(result)} м³`);
    } else {
      result = value / div;
      trace.push(`${value} / ${div} = ${round3(result)}`);
    }
  } else if (kind === 'geometry_cylinder') {
    const d = param('diameter_m');
    const h = param('height_m');
    if (d == null || h == null) return fail(missing, 'нужны диаметр и высота, м', trace);
    result = cylinderVolumeM3(d, h);
    trace.push(`V = π·${d}²/4·${h} = ${result} м³`);
  } else if (kind === 'pipe_weld_length') {
    // Пересчёт «метры шва» ↔ «стыки».
    const dn = param('dn_mm');
    if (dn == null) return fail(missing, 'нужен диаметр (Ду), мм', trace);
    const perJoint = weldLengthPerJoint(dn);
    if (String(o.toField) === 'joints' || String(o.toField) === 'стык') {
      result = value / perJoint;
      trace.push(`${value} м шва / (π·${dn}/1000 = ${perJoint} м) = ${round3(result)} стыков`);
    } else {
      result = value * perJoint;
      trace.push(`${value} стыков × ${perJoint} м = ${round3(result)} м шва`);
    }
  } else if (kind === 'dn_from_inch') {
    const std = o.standard || (params.wall_mm ? null : null) || 'eu';
    const r = inchToMm(value, o.standard);
    if (!r) return fail(['dn_mm'], 'не удалось перевести дюймы', trace);
    result = r.od_mm;
    trace.push(`${value}″ → Ду ${r.dn_mm} мм, наружный ${r.od_mm} мм ` +
      `(${r.standard === 'gost' ? 'ГОСТ' : 'EN/DIN'})${r.approximated ? ' — ближайший типоразмер' : ''}`);
  } else if (kind === 'sum_area') {
    // Пересчёт между трубками и площадью поверхности: S = π·d·L·N
    const dn = param('diameter_mm');
    const len = param('length_m');
    if (dn == null || len == null) return fail(missing, 'нужны Ø и длина трубки', trace);
    const a1 = tubeAreaM2(dn, len, { inner: true });
    const to = String(o.toField || '');
    if (to === 'surface_m2' || to === 'м²') {
      // трубок → площадь
      result = value * a1;
      trace.push(`${value} трубок × ${a1} м² = ${round3(result)} м²`);
    } else {
      // площадь → трубок
      result = value / a1;
      trace.push(`${value} м² / ${a1} м² на трубку = ${round3(result)} трубок`);
    }
  } else {
    return fail(['rule'], `неизвестная формула ${kind}`, trace);
  }

  if (!Number.isFinite(result) || result <= 0) {
    return fail(missing, 'пересчёт дал ноль', trace);
  }

  if (assumed) {
    note = 'пересчёт по типовому значению — это допущение, проверьте';
  }

  return {
    ok: true,
    value: round3(result),
    unit: String(o.toField || ''),
    assumed,
    missing: [],
    note,
    trace
  };

  function fail(miss, message, tr) {
    return {
      ok: false, value: null, assumed: false,
      missing: miss || [], note: message, trace: tr
    };
  }
}

/** Ключ плотности по типу отложений. */
function densityKey(fouling) {
  const f = String(fouling || '').toLowerCase();
  if (!f) return 'density_typical_t_m3';
  return 'density_typical_t_m3';
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

module.exports = {
  convert,
  normUnit,
  inchToMm,
  cylinderSurfaceM2,
  cylinderVolumeM3,
  weldLengthPerJoint,
  weldLengthDetailed,
  tubeAreaM2,
  INCH_TO_MM
};
