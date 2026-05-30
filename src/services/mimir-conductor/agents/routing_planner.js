/**
 * ASGARD CRM — Mimir Conductor: агент «Логистика — маршруты» (Сессия 6, Шаг 6.9)
 * ═══════════════════════════════════════════════════════════════════════════
 * Планирует доставку людей и техники по crew_plan + tz_summary. Для каждого
 * сотрудника строит маршрут [город → (склад Москва) → объект]. Близкие (<300 км)
 * едут напрямую. Плюс мобилизация/демобилизация оборудования (склад↔объект).
 *
 * Артефакт: routing_plan
 *   { summary, key_findings[], object_city, legs:[{who,from,to,transport,date,distance_km,road_days}],
 *     requires_travel, equipment_mob_demob:{...} }
 *
 * Sonnet 4.6 + (в будущем) Яндекс.Карты. На dev/stub — детерминированная оценка
 * расстояний по справочнику городов (без внешних API, без баланса).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const WAREHOUSE_CITY = 'Москва';

// Грубый справочник расстояний от Москвы (км). Для городов вне справочника —
// дефолт 1000 км (дальняя командировка). Достаточно для оценки дороги/транспорта.
const DIST_FROM_MOSCOW = {
  'москва': 0, 'московская область': 50, 'саратов': 850, 'санкт-петербург': 700,
  'нижний новгород': 420, 'казань': 820, 'самара': 1060, 'уфа': 1340,
  'екатеринбург': 1790, 'тюмень': 2150, 'сургут': 2880, 'новый уренгой': 3300,
  'краснодар': 1350, 'ростов-на-дону': 1080, 'волгоград': 960, 'пермь': 1380,
  'челябинск': 1760, 'омск': 2550, 'новосибирск': 3300, 'мурманск': 1900,
  'архангельск': 1230, 'ямбург': 3400, 'норильск': 4500
};

function distFromMoscow(city) {
  const key = String(city || '').trim().toLowerCase();
  if (key in DIST_FROM_MOSCOW) return DIST_FROM_MOSCOW[key];
  return key ? 1000 : 0;
}

/** Грубая оценка расстояния между двумя городами через Москву как хаб. */
function distBetween(a, b) {
  const da = distFromMoscow(a);
  const db = distFromMoscow(b);
  // Если оба не Москва — приблизительно сумма плеч (через хаб); иначе разница.
  if (da === 0 || db === 0) return Math.abs(da - db) || (da + db);
  return Math.round((da + db) * 0.8); // коэффициент на «не строго через Москву»
}

function pickTransport(distanceKm) {
  if (distanceKm <= 300) return 'auto';
  if (distanceKm <= 1500) return 'train';
  return 'plane';
}

function roadDaysFor(distanceKm, transport) {
  if (transport === 'auto') return distanceKm <= 100 ? 0 : 1;
  if (transport === 'train') return distanceKm <= 800 ? 1 : 2;
  return 1; // самолёт
}

async function run({ requiredArtifacts, onThought }) {
  const crewPlan = requiredArtifacts.crew_plan || {};
  const crew = Array.isArray(crewPlan.crew) ? crewPlan.crew : [];
  // object_city из tz_summary, если есть в контексте через crew (city объекта не
  // всегда доступен здесь) — пробуем взять из tz через requiredArtifacts косвенно.
  const tz = requiredArtifacts.tz_summary || {};
  const objectCity = (tz.object && tz.object.city) || (crewPlan.object_city) || null;

  const cityPart = objectCity ? ` в г. ${objectCity}` : '';
  onThought(`Планирую маршруты бригады (${crew.length} чел) к объекту${cityPart}…`);

  const legs = [];
  let requiresTravel = false;

  for (const m of crew) {
    const fromCity = m.city || WAREHOUSE_CITY;
    const directDist = objectCity ? distBetween(fromCity, objectCity) : 0;

    if (objectCity && directDist <= 300) {
      const transport = pickTransport(directDist);
      legs.push({ who: m.name || m.role, from: fromCity, to: objectCity, transport, distance_km: directDist, road_days: roadDaysFor(directDist, transport), via_warehouse: false });
    } else if (objectCity) {
      // Через склад (Москва): город → Москва → объект.
      requiresTravel = true;
      const d1 = distBetween(fromCity, WAREHOUSE_CITY);
      const d2 = distBetween(WAREHOUSE_CITY, objectCity);
      const t1 = pickTransport(d1);
      const t2 = pickTransport(d2);
      legs.push({ who: m.name || m.role, from: fromCity, to: WAREHOUSE_CITY, transport: t1, distance_km: d1, road_days: roadDaysFor(d1, t1), via_warehouse: true });
      legs.push({ who: m.name || m.role, from: WAREHOUSE_CITY, to: objectCity, transport: t2, distance_km: d2, road_days: roadDaysFor(d2, t2), via_warehouse: true });
    } else {
      // Город объекта неизвестен — помечаем как требующий уточнения.
      legs.push({ who: m.name || m.role, from: fromCity, to: '(объект — город не задан)', transport: 'unknown', distance_km: null, road_days: 1, via_warehouse: false });
    }
  }

  // Мобилизация/демобилизация оборудования (склад → объект → склад).
  const equipDist = objectCity ? distBetween(WAREHOUSE_CITY, objectCity) : null;
  const equipmentMobDemob = {
    from: WAREHOUSE_CITY,
    to: objectCity || '(не задан)',
    distance_km: equipDist,
    transport: equipDist != null ? (equipDist <= 1500 ? 'truck' : 'truck_long_haul') : 'unknown',
    round_trip: true,
    road_days: equipDist != null ? roadDaysFor(equipDist, 'auto') * 2 : 2
  };
  if (equipDist != null && equipDist > 300) requiresTravel = true;

  const maxRoadDays = legs.reduce((mx, l) => Math.max(mx, l.road_days || 0), 0);

  return {
    summary: `Маршруты: ${legs.length} плеч, дорога до ${maxRoadDays} дн/чел${requiresTravel ? ', требуется проезд' : ''}`,
    key_findings: [
      objectCity ? `Город объекта: ${objectCity}` : 'Город объекта не задан — требуется уточнение',
      `Плеч маршрутов: ${legs.length}`,
      `Мобилизация оборудования: ${WAREHOUSE_CITY} → ${objectCity || '?'} (${equipDist != null ? equipDist + ' км' : 'н/д'})`
    ],
    object_city: objectCity,
    legs,
    requires_travel: requiresTravel,
    equipment_mob_demob: equipmentMobDemob,
    clarifications: objectCity ? [] : [{
      channel: 'PM', category: 'logistics', blocking: false,
      question_ru: 'Не определён город объекта — уточните локацию для расчёта логистики и проезда.'
    }]
  };
}

module.exports = { run, distBetween, pickTransport };
