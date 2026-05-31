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

// Стоимость контроля на 1 стык, ₽.
const VIK_PRICE = 150;   // визуально-измерительный
const UZK_PRICE = 800;   // ультразвуковой
const RK_PRICE = 1500;   // радиографический

// Доли контроля (типовые для ответственных трубопроводов).
const VIK_PCT = 1.0;     // 100% ВИК
const UZK_PCT = 0.20;    // 20% УЗК
const RK_PCT = 0.10;     // 10% РК

function methodStr(tz) {
  const method = (tz.scope && tz.scope.method) || [];
  const arr = Array.isArray(method) ? method : [method];
  return arr.join(' ').toLowerCase();
}

/** Оценка числа сварных стыков из объёма работ. */
function estimateJoints(resources) {
  const list = Array.isArray(resources.resources) ? resources.resources : [];
  let vol = 0;
  for (const r of list) vol += Number(r.volume) || Number(r.qty) || 0;
  // ~1 стык на 12 м трубопровода; минимум 10, если объёмов нет.
  return Math.max(10, Math.round(vol / 12));
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};
  const resources = requiredArtifacts.resources || {};

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

  const joints = estimateJoints(resources);
  const methods = [
    { method: 'ВИК (100%)', pct: VIK_PCT * 100, joints: Math.round(joints * VIK_PCT), unit_price: VIK_PRICE, total: Math.round(joints * VIK_PCT) * VIK_PRICE },
    { method: 'УЗК (20%)', pct: UZK_PCT * 100, joints: Math.round(joints * UZK_PCT), unit_price: UZK_PRICE, total: Math.round(joints * UZK_PCT) * UZK_PRICE },
    { method: 'РК (10%)', pct: RK_PCT * 100, joints: Math.round(joints * RK_PCT), unit_price: RK_PRICE, total: Math.round(joints * RK_PCT) * RK_PRICE }
  ];
  const totalQc = methods.reduce((s, m) => s + m.total, 0);

  return {
    summary: `Контроль качества: ${formatRub(totalQc)} (~${joints} стыков, ВИК/УЗК/РК)`,
    key_findings: methods.map((m) => `${m.method}: ${m.joints} стыков = ${formatRub(m.total)}`),
    joints,
    methods,
    total_qc: totalQc,
    assumptions: ['Число стыков и доли контроля оценены типово; уточняются по проекту КМД'],
    clarifications: []
  };
}

module.exports = { run, estimateJoints };
