'use strict';
/**
 * МТР из анализа должен доезжать до просчёта и до ТО.
 *
 * ── История (10.11.2026) ───────────────────────────────────────────────────
 * На проде у всех 10 закрытых просчётов `tech_json.mtr = 0` и
 * `asgard_smeta.mtr = 0`, хотя модель анализа возвращает `mtr_suggestions`
 * (промпт PROMPT-dv-v1 просит это поле, нормализатор его сохраняет).
 * Разрывы: buildMtr не читал это поле; buildSmetaFromStage писал mtr: [];
 * readPlan игнорировал est.mtr при наличии tech_json.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tech = require('../src/services/rp-tech-plan');
const smeta = require('../src/services/asgard-smeta');

const ROOT = path.join(__dirname, '..');
const PM_DUTY = fs.readFileSync(path.join(ROOT, 'src/routes/pm-duty.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'public/assets/js/rp-tech-plan-ui.js'), 'utf8');
const REVIEW = fs.readFileSync(path.join(ROOT, 'src/services/rp-review-drafts.js'), 'utf8');
const STAGES = fs.readFileSync(path.join(ROOT, 'src/services/mimir-tender-stages.js'), 'utf8');

const results = [];
function check(name, fn) {
  try { fn(); results.push({ ok: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ ok: false }); console.log('FAIL ' + name + ' — ' + e.message); }
}

check('модель анализа возвращает mtr_suggestions', () => {
  assert.ok(/mtr_suggestions:/.test(STAGES), 'нормализатор не пробрасывает mtr_suggestions');
});

check('buildMtr читает mtr_suggestions как источник', () => {
  const mtr = tech.buildMtr({
    mtr_suggestions: [
      { name: 'Ингибитор коррозии', qty: 40, unit: 'кг', purpose: 'промывка', source: 'doc' },
      { name: 'Ветошь', qty: 10, unit: 'кг', purpose: 'зачистка', source: 'typical' }
    ]
  });
  assert.strictEqual(mtr.length, 2, 'МТР не собран: ' + mtr.length);
  assert.strictEqual(mtr[0].name, 'Ингибитор коррозии');
  assert.strictEqual(mtr[0].qty, 40);
  assert.strictEqual(mtr[1].unit, 'кг');
});

check('buildMtr не дублирует одинаковые позиции', () => {
  const mtr = tech.buildMtr({
    tech_plan: { mtr: [{ name: 'Ингибитор коррозии', qty: 40, unit: 'кг' }] },
    mtr_suggestions: [{ name: 'ингибитор коррозии', qty: 40, unit: 'кг' }]
  });
  assert.strictEqual(mtr.length, 1, 'продублировано: ' + mtr.length);
});

check('buildTechPlan переносит МТР в план', () => {
  const plan = tech.buildTechPlan({
    estimate: { mtr_suggestions: [{ name: 'Насадка ГДО', qty: 6, unit: 'шт' }] },
    smeta: {},
    filledBy: 'mimir'
  });
  assert.strictEqual(plan.mtr.length, 1, 'МТР не попал в план: ' + plan.mtr.length);
  assert.ok(tech.hasContent(plan), 'план без МТР не считается содержательным');
});

check('смета из анализа берёт МТР из плана, а не пишет пустой список', () => {
  assert.ok(/const mtr = \(\(\) =>/.test(PM_DUTY), 'нет сбора mtr из stage_state/отчёта');
  assert.ok(!/crew,\s*\n\s*mtr: \[\],/.test(PM_DUTY), 'остался жёсткий mtr: []');
});

check('смета не теряет МТР при пересчёте', () => {
  const est = smeta.recalcAsgardSmeta({
    params: { work_days: 5, shifts_per_day: 2 },
    crew: [{ code: 'worker', role: 'Слесарь', count: 4 }],
    mtr: [{ name: 'Насадка ГДО', qty: 6, unit: 'шт', source: 'purchase' }],
    rows: []
  });
  assert.strictEqual(est.mtr.length, 1, 'МТР потерян при пересчёте');
  assert.ok(est.rows.some((r) => r.section === 'F' && /Насадка/.test(String(r.name))),
    'МТР не попал в перечень F');
});

check('readPlan берёт МТР из сметы, если в tech_json пусто', () => {
  assert.ok(/if \(!plan\.mtr\.length\)/.test(UI), 'нет фолбэка МТР из сметы/отчёта');
});

check('mapAnalysisEstimateToReport пробрасывает mtr_suggestions', () => {
  assert.ok(/mtr_suggestions: estimate\.ai_meta\.mtr_suggestions \|\| estimate\.mtr_suggestions/.test(REVIEW),
    'mtr_suggestions не пробрасываются в техплан');
});

check('МТР: mtr_suggestions сохраняются в состоянии анализа', () => {
  const QS = fs.readFileSync(path.join(ROOT, 'src/routes/tkp_quick.js'), 'utf8');
  const ST = fs.readFileSync(path.join(ROOT, 'src/services/mimir-tender-stages.js'), 'utf8');
  assert.ok(/mtr_suggestions: Array\.isArray\(gen\.dv\.mtr_suggestions\)/.test(QS),
    'этап ДВ не сохраняет mtr_suggestions — в БД их не будет никогда');
  assert.ok(/out\.mtr_suggestions = Array\.isArray/.test(ST),
    'normalizeState выбрасывает mtr_suggestions');
});

check('МТР: смета из анализа читает mtr_suggestions состояния', () => {
  assert.ok(/st\.mtr_suggestions/.test(PM_DUTY), 'buildSmetaFromStage не смотрит в stage_state.mtr_suggestions');
});

const failed = results.filter((r) => !r.ok);
console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
