/**
 * ASGARD CRM — Mimir Conductor: агент «Контроль качества» (Сессия 7, Шаг 7.5)
 * ═══════════════════════════════════════════════════════════════════════════
 * БЕЗ LLM. Планирует неразрушающий контроль сварных соединений: % контроля ВИК/
 * УЗК/РК × стоимость метода × число стыков. Число стыков оценивается из объёма
 * работ (resources). Триггерится при сварке/монтаже.
 *
 * Артефакт: qc_plan
 *   { summary, key_findings[], joints, methods:[{method,pct,joints,unit_price,total}],
 *     total_qc, clarifications[] }
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { formatRub } = require('./_util');
const { resolveNorm } = require('./_norms');

// Fallback цены и проценты (применяются ТОЛЬКО если нет в applicable_norms).
const FALLBACK_VIK_PRICE = 150;
const FALLBACK_UZK_PRICE = 800;
const FALLBACK_RK_PRICE = 1500;
const FALLBACK_VIK_PCT = 1.0;
const FALLBACK_UZK_PCT = 0.20;
const FALLBACK_RK_PCT = 0.10;
const FALLBACK_JOINTS_PER_METER = 1 / 12; // 1 стык на 12 м

function methodStr(tz) {
  const method = (tz.scope && tz.scope.method) || [];
  const arr = Array.isArray(method) ? method : [method];
  return arr.join(' ').toLowerCase();
}

/** Оценка числа сварных стыков из объёма работ + норма стыков на метр из эталонов. */
function estimateJoints(resources, requiredArtifacts) {
  const list = Array.isArray(resources.resources) ? resources.resources : [];
  let vol = 0;
  for (const r of list) vol += Number(r.volume) || Number(r.qty) || 0;
  const jpm = resolveNorm(requiredArtifacts || {}, 'nk_joints_per_meter', FALLBACK_JOINTS_PER_METER);
  return Math.max(10, Math.round(vol * jpm.value));
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};
  const resources = requiredArtifacts.resources || {};

  onThought('Резолвлю цены и проценты НК из applicable_norms → fallback…');
  const vikPrice = resolveNorm(requiredArtifacts, 'nk_prices_rub.vik_per_joint', FALLBACK_VIK_PRICE);
  const uzkPrice = resolveNorm(requiredArtifacts, 'nk_prices_rub.uzk_per_joint', FALLBACK_UZK_PRICE);
  const rkPrice = resolveNorm(requiredArtifacts, 'nk_prices_rub.rk_per_joint', FALLBACK_RK_PRICE);
  const vikPct = resolveNorm(requiredArtifacts, 'nk_percent.vik', FALLBACK_VIK_PCT);
  const uzkPct = resolveNorm(requiredArtifacts, 'nk_percent.uzk', FALLBACK_UZK_PCT);
  const rkPct = resolveNorm(requiredArtifacts, 'nk_percent.rk', FALLBACK_RK_PCT);

  onThought('Планирую контроль качества сварных соединений…');
  const ms = methodStr(tz);
  const hasWelding = /сварк|монтаж|трубопровод/.test(ms);
  if (!hasWelding) {
    return {
      summary: 'Контроль качества НК не требуется (нет сварочных/монтажных работ)',
      key_findings: ['Сварка/монтаж в методе не выявлены — НК не планируется'],
      joints: 0, methods: [], total_qc: 0, clarifications: []
    };
  }

  const joints = estimateJoints(resources, requiredArtifacts);
  const tagSrc = (t) => t === 'analogs' ? '✅' : t === 'company_profile' ? '⚙' : '⚠';
  const methods = [
    { method: 'ВИК', pct: vikPct.value * 100, joints: Math.round(joints * vikPct.value), unit_price: vikPrice.value, total: Math.round(joints * vikPct.value) * vikPrice.value, _source_pct: vikPct.tier, _source_price: vikPrice.tier },
    { method: 'УЗК', pct: uzkPct.value * 100, joints: Math.round(joints * uzkPct.value), unit_price: uzkPrice.value, total: Math.round(joints * uzkPct.value) * uzkPrice.value, _source_pct: uzkPct.tier, _source_price: uzkPrice.tier },
    { method: 'РК', pct: rkPct.value * 100, joints: Math.round(joints * rkPct.value), unit_price: rkPrice.value, total: Math.round(joints * rkPct.value) * rkPrice.value, _source_pct: rkPct.tier, _source_price: rkPrice.tier }
  ];
  const totalQc = methods.reduce((s, m) => s + m.total, 0);

  return {
    summary: `Контроль качества: ${formatRub(totalQc)} (~${joints} стыков, ВИК/УЗК/РК)`,
    key_findings: methods.map((m) => `${tagSrc(m._source_pct)} ${m.method} (${m.pct}%): ${m.joints} стыков × ${formatRub(m.unit_price)} = ${formatRub(m.total)}`),
    joints,
    methods,
    total_qc: totalQc,
    _source_tiers: { vik_price: vikPrice.tier, uzk_price: uzkPrice.tier, rk_price: rkPrice.tier, vik_pct: vikPct.tier, uzk_pct: uzkPct.tier, rk_pct: rkPct.tier },
    assumptions: ['Число стыков и доли контроля резолвлены из applicable_norms или fallback; уточняются по проекту КМД'],
    clarifications: []
  };
}

module.exports = { run, estimateJoints };
