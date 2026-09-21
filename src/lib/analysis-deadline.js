'use strict';

/**
 * Внутренний срок анализа (`tenders.analysis_deadline`) — единая точка пересчёта
 * для ВСЕХ путей записи, которые трогают `docs_deadline` / `participation_paid` / `participation_fee`.
 *
 * Канон («docs_deadline − 3 раб. дня бесплатно / −5 при платном участии, клэмп по created_at»)
 * живёт в `lib/business-days.js`. Реестр (`PATCH /api/tenders/registry/:id`) его применял сразу,
 * но общий редактор тендера (`PUT /api/tenders/:id`: v2 TenderEditor, PmCalcs, funnel) и
 * generic CRUD (`PUT /api/data/tenders/:id`: ванила `AsgardDB.put`, мобильные шторки) — нет.
 * Из-за этого срок подачи уезжал, а `analysis_deadline` оставался старым, и РП работал
 * по протухшему внутреннему сроку (D-237).
 */

const { computeAnalysisDeadline } = require('./business-days');

/** Поля, от которых зависит внутренний срок анализа. */
const ANALYSIS_DEADLINE_INPUTS = ['docs_deadline', 'participation_paid', 'participation_fee'];

/** Тот же парс, что и в реестре (`tenders-registry.js`): платное участие — bool. */
function parsePaidFlag(raw) {
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  return false;
}

/**
 * Пересчитать `analysis_deadline` для патча.
 *
 * @param {object} patch   — то, что реально уйдёт в UPDATE (только эти поля).
 * @param {object} current — строка `tenders` ДО обновления (нужны `created_at` и пропущенные входы).
 * @returns {string|null|undefined} `YYYY-MM-DD`, `null` (срок убрали) либо `undefined`
 *          (среди полей нет входов канона — трогать не нужно).
 */
function recalcAnalysisDeadlinePatch(patch, current) {
  const p = patch || {};
  const cur = current || {};
  const touchesFn = ANALYSIS_DEADLINE_INPUTS.some((f) => p[f] !== undefined);
  if (!touchesFn) return undefined;

  const docs = p.docs_deadline !== undefined ? p.docs_deadline : cur.docs_deadline;
  const paid = p.participation_paid !== undefined
    ? parsePaidFlag(p.participation_paid)
    : parsePaidFlag(cur.participation_paid);

  return computeAnalysisDeadline({ docs_deadline: docs, participation_paid: paid, created_at: cur.created_at });
}

module.exports = {
  ANALYSIS_DEADLINE_INPUTS,
  recalcAnalysisDeadlinePatch,
  parsePaidFlag
};
