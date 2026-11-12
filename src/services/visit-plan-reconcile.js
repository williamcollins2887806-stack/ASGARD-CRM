#!/usr/bin/env node
'use strict';
/**
 * Правило согласования mode/trip_count/visits (дефект #2138: mode=visits,
 * trip_count=5, visits=1). Вынесено в чистую функцию, чтобы проверять без БД.
 *
 * Раньше логика жила инлайном в stage/calc-plan и молча ставила `visits`
 * от одного только trip_count > 1, оставляя график из одного заезда: смета
 * умножала дорогу и проживание на 5.
 */

/**
 * Согласует график заездов с числом выездов.
 *
 * @param {object} p
 * @param {Array} p.planVisits — заезды из плана просчёта
 * @param {object} p.prevPlan — ранее сохранённый visit_plan
 * @returns {{mode:string, trip_count:number, visits:Array}}
 */
function reconcileVisitPlan(p) {
  const o = p || {};
  const planVisits = Array.isArray(o.planVisits) ? o.planVisits : [];
  const prevPlan = o.prevPlan && typeof o.prevPlan === 'object' ? o.prevPlan : {};
  const prevVisits = Array.isArray(prevPlan.visits) ? prevPlan.visits : [];

  // Берём тот список, который ПОЛНЕЕ: сжатый ответ модели (1 заезд вместо 5)
  // не должен обнулять разбивку из анализа.
  const visits = planVisits.length >= prevVisits.length ? planVisits : prevVisits;
  const wasContinuous = String(prevPlan.mode || '') === 'continuous';
  const mode = wasContinuous && visits.length <= 1
    ? 'continuous'
    : (visits.length > 1 ? 'visits' : (prevPlan.mode || 'continuous'));

  return {
    mode,
    // trip_count описывает РОВНО те заезды, что в графике.
    trip_count: mode === 'visits' ? Math.max(1, visits.length) : 1,
    visits
  };
}

module.exports = { reconcileVisitPlan };

