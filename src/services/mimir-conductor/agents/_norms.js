/**
 * Универсальный резолвер норм/ставок для агентов Conductor.
 * Источники истины в порядке приоритета:
 *   1. analogs_comparison.analysis.applicable_norms (из эталонов mimir_reference_projects)
 *   2. work_scope_research.company_profile.financial_policy / .labor_rates_baseline и т.д.
 *      (политики компании из settings.company_profile)
 *   3. work_scope_research.warehouse_snapshot (реальные цены/категории расходников)
 *   4. work_scope_research.employees_summary (реальные ставки кадров с qualification)
 *   5. fallback-значение (с пометкой 'tier:defaults' — РП видит warning)
 *
 * Каждый агент должен вызвать resolveNorm(requiredArtifacts, 'norm_name', fallback)
 * и проверить tier ('analogs'/'company_profile'/'warehouse'/'employees'/'defaults').
 */
'use strict';

/**
 * Универсальная функция: бери из applicable_norms, потом company_profile.*, потом fallback.
 * @param {Object} requiredArtifacts - артефакты агента
 * @param {string} normKey - путь к норме в applicable_norms (например 'overheads_pct', 'training_costs_rub_per_permit.накс')
 * @param {*} fallbackValue - значение по умолчанию
 * @param {string} [companyPolicyKey] - путь в company_profile.financial_policy для tier-2 fallback
 * @returns {{ value, tier }}
 */
function resolveNorm(requiredArtifacts, normKey, fallbackValue, companyPolicyKey) {
  const analogs = requiredArtifacts && requiredArtifacts.analogs_comparison;
  const scope = requiredArtifacts && requiredArtifacts.work_scope_research;
  const norms = (analogs && analogs.analysis && analogs.analysis.applicable_norms) || {};
  const policy = (scope && scope.company_profile && scope.company_profile.financial_policy) || {};

  // 1. analogs (path по точкам)
  const v1 = getPath(norms, normKey);
  if (v1 != null && (typeof v1 === 'number' ? Number.isFinite(v1) : true)) {
    return { value: v1, tier: 'analogs' };
  }
  // 2. company_profile policy
  if (companyPolicyKey) {
    const v2 = getPath(policy, companyPolicyKey);
    if (v2 != null && (typeof v2 === 'number' ? Number.isFinite(v2) : true)) {
      return { value: v2, tier: 'company_profile' };
    }
  }
  // 3. fallback
  return { value: fallbackValue, tier: 'defaults' };
}

/** Получить ставку конкретной квалификации из реальных employees_summary. */
function resolveEmployeeRate(requiredArtifacts, qualificationFragment) {
  const scope = requiredArtifacts && requiredArtifacts.work_scope_research;
  const list = (scope && scope.employees_summary && scope.employees_summary.by_qualification) || [];
  const frag = String(qualificationFragment || '').toLowerCase();
  if (!frag) return null;
  const hit = list.find((q) => q.qualification && q.qualification.toLowerCase().includes(frag));
  if (hit && hit.avg_day_rate_rub > 0) {
    return { value: Number(hit.avg_day_rate_rub), tier: 'employees', qualification: hit.qualification };
  }
  return null;
}

/** Получить категорию расходников из warehouse_snapshot. */
function resolveConsumableCategory(requiredArtifacts, categoryFragment) {
  const scope = requiredArtifacts && requiredArtifacts.work_scope_research;
  const list = (scope && scope.warehouse_snapshot && scope.warehouse_snapshot.consumables_by_category) || [];
  const frag = String(categoryFragment || '').toLowerCase();
  if (!frag) return null;
  const hit = list.find((c) => c.category && c.category.toLowerCase().includes(frag));
  if (hit) return { value: hit, tier: 'warehouse' };
  return null;
}

/** Получить корпоративный профиль (мета). */
function getCompanyProfile(requiredArtifacts) {
  const scope = requiredArtifacts && requiredArtifacts.work_scope_research;
  return (scope && scope.company_profile) || {};
}

/** Список строгих заказчиков (вынесен из дубля в norms_compliance + executive_docs_planner). */
function getStrictCustomers(requiredArtifacts) {
  const profile = getCompanyProfile(requiredArtifacts);
  if (Array.isArray(profile.strict_customers) && profile.strict_customers.length) {
    return profile.strict_customers;
  }
  // Fallback — стандартный список без хардкода
  return ['газпром', 'транснефт', 'роснефт', 'норникел', 'лукойл', 'новатэк', 'татнефт', 'башнефт'];
}

function isStrictCustomer(customerName, requiredArtifacts) {
  if (!customerName) return false;
  const list = getStrictCustomers(requiredArtifacts);
  const low = String(customerName).toLowerCase();
  return list.some((s) => low.includes(s));
}

/** Достать значение по точечному пути (как lodash.get). */
function getPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split('.');
  let v = obj;
  for (const p of parts) {
    if (v == null) return undefined;
    v = v[p];
  }
  return v;
}

module.exports = {
  resolveNorm,
  resolveEmployeeRate,
  resolveConsumableCategory,
  getCompanyProfile,
  getStrictCustomers,
  isStrictCustomer
};
