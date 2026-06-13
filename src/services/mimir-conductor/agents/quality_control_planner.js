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

// БЕЗ ХАРДКОДА. Цены НК и проценты — только из applicable_norms.nk_*.
// Если отсутствует — BLOCKING.

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
  const jpm = resolveNorm(requiredArtifacts || {}, 'nk_joints_per_meter', null);
  if (jpm.value == null) return { joints: null, missing: 'nk_joints_per_meter' };
  return { joints: Math.max(10, Math.round(vol * jpm.value)), missing: null };
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};
  const resources = requiredArtifacts.resources || {};

  onThought('Резолвлю цены и проценты НК из applicable_norms (без fallback)…');
  const vikPrice = resolveNorm(requiredArtifacts, 'nk_prices_rub.vik_per_joint', null);
  const uzkPrice = resolveNorm(requiredArtifacts, 'nk_prices_rub.uzk_per_joint', null);
  const rkPrice = resolveNorm(requiredArtifacts, 'nk_prices_rub.rk_per_joint', null);
  const vikPct = resolveNorm(requiredArtifacts, 'nk_percent.vik', null);
  const uzkPct = resolveNorm(requiredArtifacts, 'nk_percent.uzk', null);
  const rkPct = resolveNorm(requiredArtifacts, 'nk_percent.rk', null);

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

  const missing = [];
  if (vikPrice.value == null) missing.push('nk_prices_rub.vik_per_joint');
  if (uzkPrice.value == null) missing.push('nk_prices_rub.uzk_per_joint');
  if (rkPrice.value == null) missing.push('nk_prices_rub.rk_per_joint');
  if (vikPct.value == null) missing.push('nk_percent.vik');
  if (uzkPct.value == null) missing.push('nk_percent.uzk');
  if (rkPct.value == null) missing.push('nk_percent.rk');
  const jointsResult = estimateJoints(resources, requiredArtifacts);
  if (jointsResult.missing) missing.push(jointsResult.missing);
  if (missing.length) {
    const FIELD_MAP = {
      'nk_prices_rub.vik_per_joint': { key: 'vik_price', label: 'Цена ВИК (₽/стык)', type: 'number', unit: '₽',
        hint: 'Стоимость визуально-измерительного контроля одного сварного стыка.', target: 'reference_norms.nk_prices_rub.vik_per_joint' },
      'nk_prices_rub.uzk_per_joint': { key: 'uzk_price', label: 'Цена УЗК (₽/стык)', type: 'number', unit: '₽',
        hint: 'Стоимость ультразвукового контроля одного стыка.', target: 'reference_norms.nk_prices_rub.uzk_per_joint' },
      'nk_prices_rub.rk_per_joint': { key: 'rk_price', label: 'Цена РК (₽/стык)', type: 'number', unit: '₽',
        hint: 'Стоимость радиографического контроля одного стыка.', target: 'reference_norms.nk_prices_rub.rk_per_joint' },
      'nk_percent.vik': { key: 'vik_pct', label: 'Доля ВИК (от стыков)', type: 'number', unit: '0..1',
        hint: 'Какая доля стыков подвергается ВИК (например 1.0 = 100%).', target: 'reference_norms.nk_percent.vik' },
      'nk_percent.uzk': { key: 'uzk_pct', label: 'Доля УЗК (от стыков)', type: 'number', unit: '0..1',
        hint: 'Какая доля стыков подвергается УЗК (например 0.2 = 20%).', target: 'reference_norms.nk_percent.uzk' },
      'nk_percent.rk': { key: 'rk_pct', label: 'Доля РК (от стыков)', type: 'number', unit: '0..1',
        hint: 'Какая доля стыков подвергается РК (например 0.1 = 10%).', target: 'reference_norms.nk_percent.rk' },
      'nk_joints_per_meter': { key: 'joints_per_meter', label: 'Стыков на метр трубы', type: 'number', unit: 'стык/м',
        hint: 'Среднее число сварных стыков на метр трубы (типично 1/12 ≈ 0.083).', target: 'reference_norms.nk_joints_per_meter' }
    };
    const expected_inputs = missing.map((k) => FIELD_MAP[k]).filter(Boolean);
    return {
      summary: 'BLOCKED: цены/проценты НК не найдены в эталонах',
      key_findings: missing.map((k) => `BLOCKER: ${k}`),
      joints: 0, methods: [], total_qc: 0,
      _source_tiers: { missing },
      assumptions: ['Заполните прямо в форме — данные сохранятся в reference_norms и просчёт продолжится.'],
      clarifications: [{
        channel: 'PM', category: 'qc', blocking: true,
        question_ru: `Нет норм НК в эталонах: ${missing.join(', ')}. Заполните прямо здесь.`,
        expected_inputs
      }]
    };
  }
  const joints = jointsResult.joints;
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
