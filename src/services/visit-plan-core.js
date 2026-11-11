'use strict';
/**
 * visit-plan-core.js — склейка плана заездов без потери правок РП.
 *
 * ── Дефект, который чиним ─────────────────────────────────────────────────
 * Повторный разбор ДВ безусловно перезаписывал `visit_plan` и позиции:
 *   saveStage(... { visit_plan: freshPlan, dv_positions: freshPositions })
 * РП правил период у позиции, число людей, разбивал заезд — и всё это
 * исчезало при следующем «Analyze». На тендере, который переразбирают
 * по 3–5 раз, это означало потерю работы каждый раз.
 *
 * ── Правило склейки ───────────────────────────────────────────────────────
 * Для каждой записи решаем по происхождению:
 *   source = 'rp'          → правку человека НЕ трогаем никогда;
 *   crew_locked = true     → состав закреплён РП, не перезаписываем;
 *   source = 'analysis'    → можно обновить из нового разбора;
 *   записи нет в новом      → оставляем (модель могла пропустить страницу).
 *
 * Это «3 стороны»: base (сохранённое), incoming (новый разбор), ours (правка
 * РП). При конфликте побеждает `ours`, а расхождение пишется в отчёт — чтобы
 * РП видел, что его правка удержала другое число.
 *
 * ── Ключ сопоставления ────────────────────────────────────────────────────
 * `id`, иначе `source_ref` (строка документа), иначе нормализованное имя плюс
 * период. Только по имени нельзя: «чистка теплообменника» встречается 40 раз
 * в разных цехах и периодах — это РАЗНЫЕ позиции (подтверждено на #2138).
 */

/** Признак правки человека. */
function isManual(rec) {
  if (!rec) return false;
  if (rec.crew_locked) return true;
  const src = String(rec.source || rec.origin || '').toLowerCase();
  return src === 'rp' || src === 'manual' || src === 'user';
}

/** Признак правки человека в плане заездов. */
function visitPlanManual(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (plan.crew_locked || plan.locked || plan.manual) return true;
  const src = String(plan.source || plan.origin || '').toLowerCase();
  return src === 'rp' || src === 'manual' || src === 'user';
}

/**
 * Объединение списков id без потерь и дублей.
 * Порядок: сначала сохранённые, затем новые из разбора.
 */
function mergeIds(a, b) {
  const listA = Array.isArray(a) ? a : [];
  const listB = Array.isArray(b) ? b : [];
  if (!listA.length) return listB.slice();
  if (!listB.length) return listA.slice();
  const out = [];
  const seen = new Set();
  for (const x of listA.concat(listB)) {
    const k = String(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

/** Нормализация имени для ключа. */
function normName(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[«»"'`]/g, '').trim();
}

/**
 * Стабильный ключ записи.
 * @param {object} rec
 * @returns {string|null}
 */
function keyOf(rec) {
  if (!rec) return null;
  if (rec.id != null && rec.id !== '') return 'id:' + String(rec.id);
  if (rec.source_ref) return 'ref:' + String(rec.source_ref);
  const nm = normName(rec.name || rec.title);
  if (!nm) return null;
  const per = String(rec.period || rec.visit_label || '').toLowerCase().trim();
  return 'nm:' + nm + '|' + per;
}

/**
 * Склейка списка записей (позиции ДВ, заезды).
 *
 * @param {object} p
 * @param {Array} p.base — что сохранено сейчас
 * @param {Array} p.incoming — что дал новый разбор
 * @returns {{merged:Array, stats:object, conflicts:Array}}
 */
function mergeList(p) {
  const o = p || {};
  const base = Array.isArray(o.base) ? o.base : [];
  const incoming = Array.isArray(o.incoming) ? o.incoming : [];

  const merged = [];
  const conflicts = [];
  let keptManual = 0;
  let updated = 0;
  let added = 0;
  let keptMissing = 0;

  const incomingByKey = new Map();
  for (const rec of incoming) {
    const k = keyOf(rec);
    if (k) incomingByKey.set(k, rec);
  }

  const usedKeys = new Set();

  for (const oldRec of base) {
    const k = keyOf(oldRec);

    // Правка человека — неприкосновенна.
    if (isManual(oldRec)) {
      const fresh = k ? incomingByKey.get(k) : null;
      if (fresh) {
        usedKeys.add(k);
        // Фиксируем, что разбор предложил другое — РП должен знать.
        const diffs = [];
        for (const f of ['period', 'people', 'days', 'visit_label', 'work_days']) {
          if (fresh[f] != null && oldRec[f] != null && String(fresh[f]) !== String(oldRec[f])) {
            diffs.push({ field: f, kept: oldRec[f], proposed: fresh[f] });
          }
        }
        if (diffs.length) {
          conflicts.push({
            key: k,
            name: oldRec.name || oldRec.label || null,
            reason: 'правка РП сохранена',
            diffs
          });
        }
      }
      merged.push(oldRec);
      keptManual += 1;
      continue;
    }

    // Не правил человек: обновляем, если разбор дал запись с тем же ключом.
    if (k && incomingByKey.has(k)) {
      usedKeys.add(k);
      const fresh = incomingByKey.get(k);
      merged.push(Object.assign({}, oldRec, fresh, {
        // Сохраняем идентичность и ручные флаги, если были.
        id: oldRec.id != null ? oldRec.id : fresh.id,
        source: fresh.source || 'analysis',
        // Состав заезда объединяем: разбор мог не увидеть часть позиций,
        // а сохранённая запись их уже содержала. Потеря состава = потеря
        // объёма в смете (на #2138 это десятки позиций).
        position_ids: mergeIds(oldRec.position_ids, fresh.position_ids)
      }));
      updated += 1;
      continue;
    }

    // Разбор запись не вернул. Оставляем: пропуск страницы/порции — не повод
    // терять позицию. РП разберётся, а не потеряет объём.
    merged.push(oldRec);
    keptMissing += 1;
  }

  // Новое из разбора, чего не было в сохранённом.
  for (const rec of incoming) {
    const k = keyOf(rec);
    if (k && usedKeys.has(k)) continue;
    if (k && base.some((b) => keyOf(b) === k)) continue;
    merged.push(Object.assign({}, rec, { source: rec.source || 'analysis' }));
    added += 1;
  }

  return {
    merged,
    stats: {
      base: base.length,
      incoming: incoming.length,
      merged: merged.length,
      kept_manual: keptManual,
      updated,
      added,
      kept_missing: keptMissing
    },
    conflicts
  };
}

/**
 * Склейка плана заездов. Отличается от mergeList тем, что у заезда есть
 * состав позиций — его тоже нельзя терять.
 *
 * @param {object} p
 * @param {object} p.basePlan — { visits: [...] }
 * @param {object} p.incomingPlan — { visits: [...] }
 * @returns {{plan:object, stats:object, conflicts:Array}}
 */
function mergeVisitPlan(p) {
  const o = p || {};
  const baseVisits = Array.isArray((o.basePlan || {}).visits) ? o.basePlan.visits : [];
  const incomingVisits = Array.isArray((o.incomingPlan || {}).visits) ? o.incomingPlan.visits : [];

  const res = mergeList({ base: baseVisits, incoming: incomingVisits });

  // Позиции внутри заездов: объединяем по id, не теряя ручных.
  // ── Порядок слияния: правки РП главнее, но НЕ порядком ключей ────────────
  // Было `Object.assign({}, incoming, base, {...})` — base последний, значит
  // новый разбор не мог изменить ни режим, ни число заездов, ни вернуть
  // исправленный график. При этом визиты приходили из разбора, и получалось
  // внутреннее противоречие: mode=continuous при 3 визитах.
  //
  // Правильно: берём свежий разбор за основу (он актуален), а поверх кладём
  // ТОЛЬКО те поля сохранённого плана, которые человек правил вручную.
  const basePlanObj = o.basePlan || {};
  const manualFields = ['schedule_mode', 'trip_count', 'visits', 'note'];
  const keptFromBase = {};
  if (visitPlanManual(basePlanObj)) {
    for (const f of manualFields) {
      if (basePlanObj[f] !== undefined) keptFromBase[f] = basePlanObj[f];
    }
  }

  const plan = Object.assign(
    {},
    basePlanObj,        // исторические поля, которые разбор не знает
    o.incomingPlan || {}, // актуальные данные разбора
    keptFromBase        // ручные правки РП поверх всего
  );
  plan.visits = res.merged.map((v) => {
    // `v` — результат склейки (с приоритетом РП), `inc` — свежий разбор.
    // Порядок важен: свежие поля дают новое, но правки РП перекрывают.
    const inc = incomingVisits.find((x) => keyOf(x) === keyOf(v)) || {};
    const ids = [...new Set([]
      .concat(v.position_ids || [])
      .concat(inc.position_ids || []))];
    return Object.assign({}, inc, v, { position_ids: ids });
  });

  return { plan, stats: res.stats, conflicts: res.conflicts };
}

/**
 * Склейка ДВ: позиции + план заездов одним проходом.
 *
 * @param {object} p
 * @param {Array} p.basePositions
 * @param {Array} p.incomingPositions
 * @param {object} [p.basePlan]
 * @param {object} [p.incomingPlan]
 * @returns {object}
 */
function mergeDv(p) {
  const o = p || {};
  const pos = mergeList({ base: o.basePositions, incoming: o.incomingPositions });
  const plan = mergeVisitPlan({ basePlan: o.basePlan, incomingPlan: o.incomingPlan });
  return {
    positions: pos.merged,
    plan: plan.plan,
    stats: Object.assign({}, pos.stats, {
      visits_base: plan.stats.base,
      visits_merged: plan.stats.merged,
      visits_manual: plan.stats.kept_manual
    }),
    conflicts: pos.conflicts.concat(plan.conflicts)
  };
}

module.exports = {
  isManual,
  normName,
  mergeIds,
  keyOf,
  mergeList,
  mergeVisitPlan,
  mergeDv
};
