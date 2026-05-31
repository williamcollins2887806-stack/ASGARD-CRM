/**
 * ASGARD CRM — Mimir Conductor: Монте-Карло симуляция стоимости (Сессия 7)
 * ═══════════════════════════════════════════════════════════════════════════
 * Чистый Node-расчёт (без LLM, без внешних пакетов). Крутит N итераций, на
 * каждой умножает базовую себестоимость на сэмплы из заданных распределений
 * (normal / lognormal / triangle / uniform), собирает перцентили P10/P50/P90,
 * считает вероятность убытка относительно цены контракта.
 *
 * Используется агентом risk_quantifier. Детерминируемость: при передаче seed
 * результат воспроизводим (тесты не «плавают»).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

/** Mulberry32 — быстрый сидируемый PRNG (детерминированный для тестов). */
function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller: стандартная нормаль N(0,1) из двух равномерных. */
function sampleStdNormal(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Сэмпл множителя из распределения.
 * @param {Object} dist — { dist:'normal'|'lognormal'|'triangle'|'uniform', ...params }
 * @param {Function} rng
 * @returns {number} множитель (около 1.0)
 */
function sampleDistribution(dist, rng) {
  const type = (dist && dist.dist) || 'normal';
  switch (type) {
    case 'normal': {
      const mean = dist.mean != null ? dist.mean : 1.0;
      const sigma = dist.sigma != null ? dist.sigma : 0.1;
      return Math.max(0, mean + sigma * sampleStdNormal(rng));
    }
    case 'lognormal': {
      // mean/sigma — параметры лежащей в основе нормали (mu, sigma).
      const mu = dist.mean != null ? dist.mean : 0;
      const sigma = dist.sigma != null ? dist.sigma : 0.15;
      return Math.exp(mu + sigma * sampleStdNormal(rng));
    }
    case 'triangle': {
      const min = dist.min != null ? dist.min : 0.9;
      const mode = dist.mode != null ? dist.mode : 1.0;
      const max = dist.max != null ? dist.max : 1.2;
      const u = rng();
      const c = (mode - min) / (max - min);
      if (u < c) return min + Math.sqrt(u * (max - min) * (mode - min));
      return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
    }
    case 'uniform': {
      const min = dist.min != null ? dist.min : 0.9;
      const max = dist.max != null ? dist.max : 1.1;
      return min + (max - min) * rng();
    }
    default:
      return 1.0;
  }
}

/** Перцентиль из отсортированного массива (linear, без интерполяции). */
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

/**
 * Монте-Карло симуляция итоговой себестоимости.
 * @param {Object} p
 * @param {number} p.base_cost — базовая (детерминированная) себестоимость
 * @param {Object} p.variations — { factor: { dist, ...params } }
 * @param {number} [p.iterations=5000]
 * @param {number} [p.contract_value] — цена контракта (для вероятности убытка)
 * @param {number} [p.seed=12345] — для воспроизводимости
 * @returns {Object} перцентили + риск-метрики
 */
function runMonteCarlo({ base_cost, variations = {}, iterations = 5000, contract_value = 0, seed = 12345 }) {
  const rng = makeRng(seed);
  const factors = Object.entries(variations);
  const results = new Array(iterations);

  for (let i = 0; i < iterations; i++) {
    let cost = base_cost;
    for (let f = 0; f < factors.length; f++) {
      cost *= sampleDistribution(factors[f][1], rng);
    }
    results[i] = cost;
  }
  results.sort((a, b) => a - b);

  const round = (x) => Math.round(x);
  const p10 = percentile(results, 0.10);
  const p50 = percentile(results, 0.50);
  const p90 = percentile(results, 0.90);
  const mean = results.reduce((s, x) => s + x, 0) / iterations;

  // Вероятность убытка: доля итераций, где себестоимость >= цены контракта.
  let lossCount = 0;
  if (contract_value > 0) {
    for (let i = 0; i < iterations; i++) {
      if (results[i] >= contract_value) lossCount++;
    }
  }
  const lossProbability = contract_value > 0 ? lossCount / iterations : 0;

  return {
    iterations,
    base_cost: round(base_cost),
    contract_value: round(contract_value),
    p10: round(p10),
    p50: round(p50),
    p90: round(p90),
    mean: round(mean),
    min: round(results[0]),
    max: round(results[results.length - 1]),
    // Ожидаемая прибыль/худший сценарий относительно цены контракта.
    expected_profit: contract_value > 0 ? round(contract_value - p50) : null,
    worst_case: contract_value > 0 ? round(contract_value - p90) : null,
    loss_probability: lossProbability
  };
}

module.exports = { runMonteCarlo, sampleDistribution, makeRng, percentile };
