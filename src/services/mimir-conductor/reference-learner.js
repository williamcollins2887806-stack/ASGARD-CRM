/**
 * ASGARD CRM — Mimir Conductor: автоматическое обучение по эталонам
 * ═══════════════════════════════════════════════════════════════════════════
 * Каждый утверждённый просчёт (Conductor final_estimate ИЛИ Quick estimate)
 * автоматически создаёт/обновляет запись в mimir_reference_projects. Это
 * feedback loop: РП/директор согласовали → база эталонов обогащается → следующие
 * похожие проекты используют этот эталон как analog.
 *
 * Идемпотентность: запись связывается с source_tender_id (Conductor) или
 * source_work_id (Quick). При повторном utilisation — UPDATE, не дубль.
 *
 * Когда работа закрыта (status='closed' / completed_at + есть expenses) —
 * заполняются и planned, и actual поля. До этого — только planned.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const db = require('../db');

/**
 * Учить базу эталонов на основе утверждённого Conductor-просчёта.
 * @param {number} runId — id mimir_conductor_runs
 * @param {Object} [opts] — { createdBy:userId, source:'conductor_approve' }
 */
async function learnFromConductorRun(runId, opts = {}) {
  if (!runId) return { ok: false, reason: 'no_run_id' };
  try {
    const runRes = await db.query(
      `SELECT r.id, r.work_id, r.tender_id, r.status, r.contract_value, r.final_estimate_data,
              t.tender_title, t.customer_name, t.customer_inn, t.tender_price,
              w.work_title, w.object_name AS work_object_name, w.city AS work_city,
              w.start_in_work_date, w.act_signed_date_fact
         FROM mimir_conductor_runs r
         LEFT JOIN tenders t ON t.id = r.tender_id
         LEFT JOIN works w ON w.id = r.work_id
        WHERE r.id = $1`,
      [runId]
    );
    if (!runRes.rows[0]) return { ok: false, reason: 'run_not_found' };
    const run = runRes.rows[0];

    const finalArt = await db.query(
      `SELECT content FROM mimir_artifacts
        WHERE conductor_run_id=$1 AND artifact_type='final_estimate' AND superseded_by IS NULL
        ORDER BY id DESC LIMIT 1`,
      [runId]
    );
    const final = finalArt.rows[0] && finalArt.rows[0].content;
    if (!final) return { ok: false, reason: 'no_final_estimate' };
    const ssr = final.ssr || {};
    const analysis = final.analysis || {};

    // Извлекаем дополнительные артефакты для resources_actual
    const tzArt = await db.query(
      `SELECT content FROM mimir_artifacts WHERE conductor_run_id=$1 AND artifact_type='tz_summary' AND superseded_by IS NULL ORDER BY id DESC LIMIT 1`,
      [runId]
    );
    const tz = tzArt.rows[0] && tzArt.rows[0].content;
    const crewArt = await db.query(
      `SELECT content FROM mimir_artifacts WHERE conductor_run_id=$1 AND artifact_type='crew_plan' AND superseded_by IS NULL ORDER BY id DESC LIMIT 1`,
      [runId]
    );
    const crew = crewArt.rows[0] && crewArt.rows[0].content;
    const laborArt = await db.query(
      `SELECT content FROM mimir_artifacts WHERE conductor_run_id=$1 AND artifact_type='labor_cost' AND superseded_by IS NULL ORDER BY id DESC LIMIT 1`,
      [runId]
    );
    const labor = laborArt.rows[0] && laborArt.rows[0].content;
    const analogsArt = await db.query(
      `SELECT content FROM mimir_artifacts WHERE conductor_run_id=$1 AND artifact_type='analogs_comparison' AND superseded_by IS NULL ORDER BY id DESC LIMIT 1`,
      [runId]
    );
    const analogs = analogsArt.rows[0] && analogsArt.rows[0].content;

    // Собираем resources_actual из артефактов (нормы которые сработали)
    const resourcesActual = {
      labor: {
        rates_rub_per_shift: (analogs && analogs.analysis && analogs.analysis.applicable_norms && analogs.analysis.applicable_norms.labor_rates_rub_per_shift) || {},
        payroll_tax_pct: (analogs && analogs.analysis && analogs.analysis.applicable_norms && analogs.analysis.applicable_norms.fot_tax_pct) || null
      },
      timing_norms: (analogs && analogs.analysis && analogs.analysis.applicable_norms && analogs.analysis.applicable_norms.timing_norms) || {},
      overheads_pct_of_direct: (analogs && analogs.analysis && analogs.analysis.applicable_norms && analogs.analysis.applicable_norms.overheads_pct) || null,
      warranty_reserve_pct_of_revenue: (analogs && analogs.analysis && analogs.analysis.applicable_norms && analogs.analysis.applicable_norms.warranty_pct) || null,
      min_profitability_pct_for_OPO: (analogs && analogs.analysis && analogs.analysis.applicable_norms && analogs.analysis.applicable_norms.margin_min_pct) || null,
      _from_conductor_run: runId,
      _from_artifacts: { tz_summary: !!tz, crew_plan: !!crew, labor_cost: !!labor, analogs_comparison: !!analogs }
    };

    // applicable_norms для будущих просчётов — повторяем что Conductor использовал
    const applicableNorms = (analogs && analogs.analysis && analogs.analysis.applicable_norms) || {};

    // Insights — заметки из final.analysis для следующих рекомендаций
    const insights = {
      lessons_learned: (final.key_findings || []).slice(0, 8),
      risk_factors_realized: (analysis.key_risks || []).slice(0, 6),
      applicable_norms: applicableNorms,
      pricing_strategy_for_similar: {
        recommended_client_price_no_vat_rub: ssr.total_with_margin || null,
        reasoning: analysis.decision_reasoning || null
      },
      what_to_check_before_bid: (analysis.warnings || []).slice(0, 6),
      _conductor_run_id: runId,
      _source: opts.source || 'conductor_approve'
    };

    const customerName = run.customer_name || (tz && tz.customer && tz.customer.name) || null;
    const objectName = run.work_object_name || (tz && tz.object && tz.object.name) || run.tender_title;
    const city = run.work_city || (tz && tz.object && tz.object.city) || null;
    const workType = (tz && tz.scope && (Array.isArray(tz.scope.method) ? tz.scope.method.join('; ') : tz.scope.method)) || run.tender_title;
    const crewSize = crew ? (Number(crew.total_count) || (Array.isArray(crew.crew) ? crew.crew.length : null)) : null;
    const totalWithVat = ssr.total_with_vat || run.tender_price || null;
    const totalCost = ssr.total_cost || null;
    const profit = (totalWithVat && totalCost) ? (totalWithVat - totalCost) : null;
    const marginPct = (profit && totalWithVat) ? Math.round((profit / totalWithVat) * 10000) / 100 : (ssr.gross_profit_margin_pct || null);
    const workDays = (labor && labor.work_days) || (tz && tz.timing && tz.timing.work_days) || null;

    // Upsert по source_tender_id или source_work_id
    const findKey = run.tender_id
      ? { col: 'source_tender_id', val: run.tender_id }
      : (run.work_id ? { col: 'source_work_id', val: run.work_id } : null);

    if (findKey) {
      const exists = await db.query(`SELECT id FROM mimir_reference_projects WHERE ${findKey.col}=$1 LIMIT 1`, [findKey.val]);
      if (exists.rows[0]) {
        await db.query(
          `UPDATE mimir_reference_projects
              SET customer_name=$1, object_name=$2, city=$3, work_type=$4,
                  contract_value_planned=$5, contract_value_actual=$5,
                  contract_value_planned_no_vat=$6, contract_value_actual_no_vat=$6,
                  cost_planned=$7, cost_actual=$7,
                  profit_planned=$8, profit_actual=$8,
                  margin_planned_pct=$9, margin_actual_pct=$9,
                  vat_rate_pct=COALESCE($10, vat_rate_pct),
                  duration_planned_workshifts=COALESCE($11, duration_planned_workshifts),
                  crew_size_planned=COALESCE($12, crew_size_planned),
                  resources_actual=$13::jsonb,
                  insights=$14::jsonb,
                  notes=$15, updated_at=NOW()
            WHERE id=$16`,
          [customerName, objectName, city, workType,
            totalWithVat, totalWithVat ? totalWithVat / (1 + (ssr.vat_pct || 20) / 100) : null,
            totalCost, profit, marginPct,
            ssr.vat_pct || null, workDays, crewSize,
            JSON.stringify(resourcesActual), JSON.stringify(insights),
            `Авто-обновлено из утверждённого Conductor run #${runId}`,
            exists.rows[0].id]
        );
        return { ok: true, updated: true, reference_id: exists.rows[0].id, source: 'conductor', run_id: runId };
      }
    }

    // INSERT новой записи
    const ins = await db.query(
      `INSERT INTO mimir_reference_projects
         (customer_name, customer_inn, object_name, city,
          work_type, industry_sector, asset_type,
          contract_value_planned, contract_value_actual,
          vat_rate_pct,
          contract_value_planned_no_vat, contract_value_actual_no_vat,
          cost_planned, cost_actual,
          profit_planned, profit_actual,
          margin_planned_pct, margin_actual_pct,
          duration_planned_workshifts,
          crew_size_planned,
          resources_actual, insights,
          source_work_id, source_tender_id,
          quality_score, is_active,
          notes,
          created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4, $5,$6,$7, $8,$8, $9, $10,$10, $11,$11, $12,$12, $13,$13, $14, $15,
               $16::jsonb, $17::jsonb, $18,$19, $20, true, $21, $22, NOW(), NOW())
       RETURNING id`,
      [customerName, run.customer_inn || null, objectName, city,
        workType, 'Нефтегазохимия', 'АВО/Теплообменники',
        totalWithVat, ssr.vat_pct || 20,
        totalWithVat ? totalWithVat / (1 + (ssr.vat_pct || 20) / 100) : null,
        totalCost, profit, marginPct,
        workDays, crewSize,
        JSON.stringify(resourcesActual), JSON.stringify(insights),
        run.work_id || null, run.tender_id || null,
        70, // quality_score 70 для авто-эталона (90 — для ручных, 100 — с фактом)
        `Авто-эталон из утверждённого Conductor run #${runId}`,
        opts.createdBy || null]
    );
    return { ok: true, created: true, reference_id: ins.rows[0].id, source: 'conductor', run_id: runId };
  } catch (e) {
    return { ok: false, error: e.message, run_id: runId };
  }
}

/**
 * Учить базу эталонов на основе утверждённой быстрой сметы (Quick estimate).
 * @param {number} estimateId — id estimates
 */
async function learnFromEstimate(estimateId, opts = {}) {
  if (!estimateId) return { ok: false, reason: 'no_estimate_id' };
  try {
    // HIGH-фикс: было `e.total_amount` — этой колонки нет в `estimates` (есть `total_sum`).
    // Feedback-loop Мимира молча падал на каждом approve-finalize, эталоны не обучались.
    const r = await db.query(
      `SELECT e.id, e.tender_id, e.title, e.work_type, e.object_name, e.total_sum AS total_amount,
              e.approval_status, e.ai_report, e.metadata,
              t.customer_name, t.customer_inn, t.tender_price, t.tender_region,
              w.work_title, w.city AS work_city, w.start_in_work_date, w.act_signed_date_fact
         FROM estimates e
         LEFT JOIN tenders t ON t.id = e.tender_id
         LEFT JOIN works w ON w.id = e.work_id
        WHERE e.id = $1`,
      [estimateId]
    );
    const est = r.rows[0];
    if (!est) return { ok: false, reason: 'estimate_not_found' };
    if (est.approval_status !== 'approved') return { ok: false, reason: 'not_approved', status: est.approval_status };

    const aiReport = est.ai_report || {};
    const meta = est.metadata || {};
    const totalWithVat = Number(est.total_amount) || 0;
    const vatPct = Number(aiReport.vat_pct) || Number(meta.vat_pct) || 20;
    const totalNoVat = totalWithVat / (1 + vatPct / 100);
    const totalCost = Number(aiReport.total_cost) || Number(meta.total_cost) || null;
    const profit = totalCost ? totalWithVat - totalCost : null;
    const marginPct = (profit && totalWithVat) ? Math.round((profit / totalWithVat) * 10000) / 100 : null;

    // Идемпотентность по source_tender_id
    if (est.tender_id) {
      const exists = await db.query(`SELECT id FROM mimir_reference_projects WHERE source_tender_id=$1 LIMIT 1`, [est.tender_id]);
      if (exists.rows[0]) {
        await db.query(
          `UPDATE mimir_reference_projects
              SET customer_name=$1, object_name=$2,
                  contract_value_planned=$3, contract_value_actual=$3,
                  contract_value_planned_no_vat=$4, contract_value_actual_no_vat=$4,
                  cost_planned=$5, cost_actual=$5,
                  profit_planned=$6, profit_actual=$6,
                  margin_planned_pct=$7, margin_actual_pct=$7,
                  vat_rate_pct=$8, notes=$9, updated_at=NOW()
            WHERE id=$10`,
          [est.customer_name, est.object_name || est.work_title || est.title,
            totalWithVat, totalNoVat, totalCost, profit, marginPct, vatPct,
            `Обновлено из утверждённой quick-сметы #${estimateId}`,
            exists.rows[0].id]
        );
        return { ok: true, updated: true, reference_id: exists.rows[0].id, source: 'quick', estimate_id: estimateId };
      }
    }

    const ins = await db.query(
      `INSERT INTO mimir_reference_projects
         (customer_name, customer_inn, object_name, city,
          work_type, industry_sector,
          contract_value_planned, contract_value_actual,
          vat_rate_pct,
          contract_value_planned_no_vat, contract_value_actual_no_vat,
          cost_planned, cost_actual,
          profit_planned, profit_actual,
          margin_planned_pct, margin_actual_pct,
          source_tender_id, quality_score, is_active, notes,
          created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4, $5,$6, $7,$7, $8, $9,$9, $10,$10, $11,$11, $12,$12, $13, $14, true, $15, $16, NOW(), NOW())
       RETURNING id`,
      [est.customer_name, est.customer_inn || null,
        est.object_name || est.work_title || est.title, est.work_city || est.tender_region,
        est.work_type, 'Промышленные работы',
        totalWithVat, vatPct, totalNoVat,
        totalCost, profit, marginPct,
        est.tender_id || null,
        60, // quality 60 для auto-quick (он без полной детализации Conductor)
        `Авто-эталон из утверждённой quick-сметы #${estimateId}`,
        opts.createdBy || null]
    );
    return { ok: true, created: true, reference_id: ins.rows[0].id, source: 'quick', estimate_id: estimateId };
  } catch (e) {
    return { ok: false, error: e.message, estimate_id: estimateId };
  }
}

module.exports = { learnFromConductorRun, learnFromEstimate };
