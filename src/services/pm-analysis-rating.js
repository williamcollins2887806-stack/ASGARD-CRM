'use strict';

/**
 * Рейтинг эффективности РП по фазе быстрого анализа (не просчёт / не win-KPI).
 * Окна: duty (текущее/последнее дежурство), d30, d90.
 * Правило отмен C: reject с reject_preset — дисциплина; хаос — штрафы.
 */

const WEIGHTS = Object.freeze({
  take: 25,
  completion: 30,
  speed: 25,
  discipline: 10,
  collab: 10
});

const SPEED_TARGET_HOURS = 24;
const COLLAB_NORM = 3; // invites с активностью helper → полный вес Collab

const PENALTY = Object.freeze({
  overdue: { per: 12, cap: 36 },
  abandoned: { per: 5, cap: 20 },
  rejectNoPreset: { per: 3, cap: 9 },
  registryCancel: { per: 4, cap: 12 }
});

const BONUS = Object.freeze({
  collabActive: { per: 2, cap: 8 },
  win: 0 // MVP: выигрыши не влияют
});

const GRADES = [
  { grade: 'A', min: 85 },
  { grade: 'B', min: 70 },
  { grade: 'C', min: 55 },
  { grade: 'D', min: 40 },
  { grade: 'E', min: 0 }
];

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function gradeFromScore(score) {
  const s = clamp(score, 0, 100);
  for (const g of GRADES) {
    if (s >= g.min) return g.grade;
  }
  return 'E';
}

function isoDate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  try {
    return d.toISOString().slice(0, 10);
  } catch (_) {
    return String(d).slice(0, 10);
  }
}

function addDaysIso(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function median(nums) {
  const a = nums.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function ownerExpr(alias = 'rev') {
  return `COALESCE(${alias}.analysis_owner_user_id, ${alias}.started_by_user_id, ${alias}.analysis_finalized_by_user_id)`;
}

function parseRejectPreset(reportJson) {
  if (!reportJson) return '';
  let rj = reportJson;
  if (typeof rj === 'string') {
    try { rj = JSON.parse(rj); } catch (_) { return ''; }
  }
  const snap = rj.analysis_snapshot || {};
  return String(rj.reject_preset || snap.reject_preset || '').trim();
}

/**
 * Resolve [start, end] inclusive dates for window_kind.
 */
async function resolveWindow(db, userId, windowKind, asOfDate) {
  const asOf = isoDate(asOfDate) || isoDate(new Date());
  const kind = String(windowKind || 'd30');

  if (kind === 'd30') {
    return { window_kind: 'd30', period_start: addDaysIso(asOf, -29), period_end: asOf, roster_id: null };
  }
  if (kind === 'd90') {
    return { window_kind: 'd90', period_start: addDaysIso(asOf, -89), period_end: asOf, roster_id: null };
  }

  // duty: current overlapping asOf, else last ended period for this PM
  const cur = await db.query(`
    SELECT id, period_start, period_end
    FROM pm_duty_roster
    WHERE pm_user_id = $1
      AND period_start <= $2::date
      AND period_end >= $2::date
    ORDER BY created_at DESC
    LIMIT 1
  `, [userId, asOf]);
  if (cur.rows[0]) {
    return {
      window_kind: 'duty',
      period_start: isoDate(cur.rows[0].period_start),
      period_end: isoDate(cur.rows[0].period_end),
      roster_id: cur.rows[0].id
    };
  }
  const last = await db.query(`
    SELECT id, period_start, period_end
    FROM pm_duty_roster
    WHERE pm_user_id = $1 AND period_end < $2::date
    ORDER BY period_end DESC
    LIMIT 1
  `, [userId, asOf]);
  if (last.rows[0]) {
    return {
      window_kind: 'duty',
      period_start: isoDate(last.rows[0].period_start),
      period_end: isoDate(last.rows[0].period_end),
      roster_id: last.rows[0].id
    };
  }
  // no duty history — empty day window
  return { window_kind: 'duty', period_start: asOf, period_end: asOf, roster_id: null, empty_duty: true };
}

/**
 * Load candidate tenders/reviews for the scoring window.
 */
async function loadCandidates(db, userId, periodStart, periodEnd) {
  const r = await db.query(`
    SELECT
      t.id AS tender_id,
      t.registry_status,
      t.docs_deadline,
      t.created_at AS tender_created_at,
      t.won_at,
      rev.id AS review_id,
      rev.decision,
      rev.is_final,
      rev.report_json,
      rev.analysis_started_at,
      rev.analysis_finalized_at,
      rev.analysis_finalized_by_user_id,
      rev.started_by_user_id,
      rev.analysis_owner_user_id,
      rev.created_at AS review_created_at,
      rev.updated_at AS review_updated_at,
      ${ownerExpr('rev')} AS owner_id,
      (
        SELECT MIN(l.created_at)
        FROM tender_rp_review_log l
        WHERE l.review_id = rev.id AND l.action IN ('save_draft', 'finalize_analysis', 'finalize_reject')
      ) AS first_activity_at,
      (
        SELECT MIN(l.created_at)
        FROM tender_rp_review_log l
        WHERE l.review_id = rev.id AND l.action IN ('finalize_analysis', 'finalize_reject')
      ) AS analysis_closed_at_log
    FROM tenders t
    LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
    WHERE t.deleted_at IS NULL
      AND COALESCE(t.calculator_kind, '') != 'to'
      AND t.created_at::date <= $2::date
      AND (
        t.registry_status = 'рассмотрение'
        OR (rev.analysis_finalized_at IS NOT NULL
            AND rev.analysis_finalized_at::date BETWEEN $1::date AND $2::date)
        OR (
          EXISTS (
            SELECT 1 FROM tender_rp_review_log lx
            WHERE lx.review_id = rev.id
              AND lx.action IN ('finalize_analysis', 'finalize_reject')
              AND lx.created_at::date BETWEEN $1::date AND $2::date
          )
        )
        OR (rev.decision = 'reject' AND COALESCE(rev.is_final, false) = true
            AND rev.updated_at::date BETWEEN $1::date AND $2::date)
        OR (rev.id IS NOT NULL AND rev.created_at::date BETWEEN $1::date AND $2::date)
        OR (t.registry_status = 'отмена'
            AND t.updated_at::date BETWEEN $1::date AND $2::date
            AND ${ownerExpr('rev')} = $3)
      )
  `, [periodStart, periodEnd, userId]);
  return r.rows;
}

async function loadCollabStats(db, userId, periodStart, periodEnd) {
  const r = await db.query(`
    SELECT
      c.id AS collab_id,
      c.tender_id,
      c.pm_user_id AS helper_id,
      c.invited_at,
      EXISTS (
        SELECT 1 FROM tender_rp_review_log l
        WHERE l.review_id = c.review_id
          AND l.actor_user_id = c.pm_user_id
          AND l.created_at >= c.invited_at
      ) OR EXISTS (
        SELECT 1 FROM tender_rp_review_participant_drafts d
        WHERE d.review_id = c.review_id
          AND d.author_user_id = c.pm_user_id
          AND d.phase = 'analysis'
          AND d.updated_at >= c.invited_at
      ) AS helper_active
    FROM tender_rp_review_collaborators c
    WHERE c.invited_by_user_id = $1
      AND c.revoked_at IS NULL
      AND c.invited_at::date BETWEEN $2::date AND $3::date
  `, [userId, periodStart, periodEnd]);
  return r.rows;
}

function isTaken(row) {
  if (!row.review_id) return false;
  return !!(row.started_by_user_id || row.analysis_owner_user_id || row.analysis_started_at || row.first_activity_at);
}

/** Analysis closed = go-path timestamp OR reject finalize (log / is_final). */
function analysisClosedAt(row) {
  if (row.analysis_finalized_at) return row.analysis_finalized_at;
  if (row.analysis_closed_at_log) return row.analysis_closed_at_log;
  if (row.decision === 'reject' && row.is_final) {
    return row.review_updated_at || row.first_activity_at || null;
  }
  return null;
}

function startTs(row) {
  return row.analysis_started_at || row.first_activity_at || row.review_created_at || null;
}

function hoursBetween(a, b) {
  if (!a || !b) return null;
  const t0 = new Date(a).getTime();
  const t1 = new Date(b).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return null;
  return (t1 - t0) / 3600000;
}

/**
 * Compute full rating payload for one user + window.
 */
async function computeUserRating(db, userId, windowKind, asOfDate) {
  const win = await resolveWindow(db, userId, windowKind, asOfDate);
  const asOf = isoDate(asOfDate) || isoDate(new Date());
  const { period_start: ps, period_end: pe, window_kind } = win;

  if (win.empty_duty && window_kind === 'duty') {
    return emptyPayload(userId, win, asOf, 'Нет периодов дежурства — рейтинг смены недоступен.');
  }

  const [rows, collabs] = await Promise.all([
    loadCandidates(db, userId, ps, pe),
    loadCollabStats(db, userId, ps, pe)
  ]);

  const poolIds = new Set();
  const takenIds = new Set();
  const doneIds = new Set();
  const speedHours = [];
  let rejectWithPreset = 0;
  let rejectTotal = 0;
  let closedBeforeDeadline = 0;
  let closedWithDeadline = 0;

  let overdueOpen = 0;
  const overdueIds = [];
  let abandoned = 0;
  const abandonedIds = [];
  let rejectNoPreset = 0;
  let registryCancelBad = 0;

  const today = asOf;

  for (const row of rows) {
    const tid = row.tender_id;
    poolIds.add(tid);

    const owner = row.owner_id != null ? Number(row.owner_id) : null;
    const mine = owner === Number(userId);
    const taken = isTaken(row);
    const closedAt = analysisClosedAt(row);
    const finalized = !!closedAt;
    const finDate = finalized ? isoDate(closedAt) : null;
    const finalizedInWindow = finalized && finDate >= ps && finDate <= pe;

    if (mine && taken) takenIds.add(tid);
    if (mine && finalizedInWindow) {
      doneIds.add(tid);
      const h = hoursBetween(startTs(row), closedAt);
      if (h != null) speedHours.push(h);

      if (row.decision === 'reject') {
        rejectTotal += 1;
        if (parseRejectPreset(row.report_json)) rejectWithPreset += 1;
        else rejectNoPreset += 1;
      }

      if (row.docs_deadline) {
        closedWithDeadline += 1;
        if (finDate <= isoDate(row.docs_deadline)) closedBeforeDeadline += 1;
      }
    }

    // Overdue: open analysis, docs_deadline < today, owner is me OR (unowned and we are scoring duty pool attribution)
    const openAnalysis = !finalized && (row.registry_status === 'рассмотрение' || !row.registry_status);
    if (openAnalysis && row.docs_deadline && isoDate(row.docs_deadline) < today) {
      if (mine || (taken && mine)) {
        overdueOpen += 1;
        overdueIds.push(tid);
      } else if (!taken && window_kind === 'duty') {
        // duty: unowned overdue in pool still hurts the duty PM (responsibility for queue)
        overdueOpen += 1;
        overdueIds.push(tid);
      }
    }

    // Abandoned: mine, started, not closed, and (duty ended before today OR age > 7d)
    if (mine && taken && !finalized) {
      const started = startTs(row);
      const startedDate = started ? isoDate(started) : null;
      const dutyEnded = pe < today;
      const olderThan7 = startedDate && addDaysIso(startedDate, 7) < today;
      if (dutyEnded || olderThan7) {
        abandoned += 1;
        abandonedIds.push(tid);
      }
    }

    // Registry cancel chaos: owner mine, отмена, без закрытого анализа и без preset
    if (mine && row.registry_status === 'отмена') {
      const preset = parseRejectPreset(row.report_json);
      if (!finalized && !preset) {
        registryCancelBad += 1;
      }
    }
  }

  const pool = poolIds.size;
  const taken = takenIds.size;
  const done = doneIds.size;

  const takeRate = pool > 0 ? taken / pool : (taken > 0 ? 1 : 0);
  const completionRate = taken > 0 ? done / taken : (done > 0 ? 1 : 0);

  const medHours = median(speedHours);
  const speedScore01 = medHours == null
    ? (done > 0 ? 0.5 : 0)
    : clamp(SPEED_TARGET_HOURS / Math.max(medHours, 0.01), 0, 1);

  const rejectDiscipline = rejectTotal > 0 ? rejectWithPreset / rejectTotal : 1;
  const deadlineDiscipline = closedWithDeadline > 0 ? closedBeforeDeadline / closedWithDeadline : 1;
  const discipline01 = (rejectDiscipline + deadlineDiscipline) / 2;

  const activeCollabs = collabs.filter((c) => c.helper_active).length;
  const collab01 = clamp(activeCollabs / COLLAB_NORM, 0, 1);

  const components = {
    take: {
      weight: WEIGHTS.take,
      score: Math.round(takeRate * 100),
      points: Math.round(takeRate * WEIGHTS.take * 100) / 100,
      pool,
      taken
    },
    completion: {
      weight: WEIGHTS.completion,
      score: Math.round(completionRate * 100),
      points: Math.round(completionRate * WEIGHTS.completion * 100) / 100,
      taken,
      done
    },
    speed: {
      weight: WEIGHTS.speed,
      score: Math.round(speedScore01 * 100),
      points: Math.round(speedScore01 * WEIGHTS.speed * 100) / 100,
      median_hours: medHours != null ? Math.round(medHours * 10) / 10 : null,
      target_hours: SPEED_TARGET_HOURS,
      samples: speedHours.length
    },
    discipline: {
      weight: WEIGHTS.discipline,
      score: Math.round(discipline01 * 100),
      points: Math.round(discipline01 * WEIGHTS.discipline * 100) / 100,
      reject_with_preset: rejectWithPreset,
      reject_total: rejectTotal,
      closed_before_deadline: closedBeforeDeadline,
      closed_with_deadline: closedWithDeadline
    },
    collab: {
      weight: WEIGHTS.collab,
      score: Math.round(collab01 * 100),
      points: Math.round(collab01 * WEIGHTS.collab * 100) / 100,
      invites: collabs.length,
      active: activeCollabs,
      norm: COLLAB_NORM
    }
  };

  const base =
    components.take.points +
    components.completion.points +
    components.speed.points +
    components.discipline.points +
    components.collab.points;

  const overduePts = Math.min(overdueOpen * PENALTY.overdue.per, PENALTY.overdue.cap);
  const abandonedPts = Math.min(abandoned * PENALTY.abandoned.per, PENALTY.abandoned.cap);
  const rejectPts = Math.min(rejectNoPreset * PENALTY.rejectNoPreset.per, PENALTY.rejectNoPreset.cap);
  const cancelPts = Math.min(registryCancelBad * PENALTY.registryCancel.per, PENALTY.registryCancel.cap);
  const penaltiesTotal = overduePts + abandonedPts + rejectPts + cancelPts;

  const collabBonus = Math.min(activeCollabs * BONUS.collabActive.per, BONUS.collabActive.cap);
  const bonusesTotal = collabBonus + BONUS.win;

  const score = Math.round(clamp(base + bonusesTotal - penaltiesTotal, 0, 100));
  const grade = gradeFromScore(score);

  const penalties = {
    overdue: { count: overdueOpen, points: overduePts, ids: overdueIds.slice(0, 20) },
    abandoned: { count: abandoned, points: abandonedPts, ids: abandonedIds.slice(0, 20) },
    reject_no_preset: { count: rejectNoPreset, points: rejectPts },
    registry_cancel: { count: registryCancelBad, points: cancelPts },
    total: penaltiesTotal
  };

  const bonuses = {
    collab_active: { count: activeCollabs, points: collabBonus },
    win: { points: BONUS.win },
    total: bonusesTotal
  };

  const recommendations = buildRecommendations({
    components, penalties, pool, taken, done, medHours, activeCollabs, overdueIds, abandonedIds
  });

  return {
    user_id: Number(userId),
    as_of_date: asOf,
    window_kind,
    period_start: ps,
    period_end: pe,
    roster_id: win.roster_id || null,
    score,
    grade,
    base: Math.round(base * 10) / 10,
    components,
    penalties,
    bonuses,
    recommendations,
    weights: WEIGHTS
  };
}

function emptyPayload(userId, win, asOf, hint) {
  const zeroComp = (weight) => ({ weight, score: 0, points: 0 });
  return {
    user_id: Number(userId),
    as_of_date: asOf,
    window_kind: win.window_kind,
    period_start: win.period_start,
    period_end: win.period_end,
    roster_id: null,
    score: 0,
    grade: 'E',
    base: 0,
    components: {
      take: { ...zeroComp(WEIGHTS.take), pool: 0, taken: 0 },
      completion: { ...zeroComp(WEIGHTS.completion), taken: 0, done: 0 },
      speed: { ...zeroComp(WEIGHTS.speed), median_hours: null, target_hours: SPEED_TARGET_HOURS, samples: 0 },
      discipline: { ...zeroComp(WEIGHTS.discipline), reject_with_preset: 0, reject_total: 0, closed_before_deadline: 0, closed_with_deadline: 0 },
      collab: { ...zeroComp(WEIGHTS.collab), invites: 0, active: 0, norm: COLLAB_NORM }
    },
    penalties: { overdue: { count: 0, points: 0, ids: [] }, abandoned: { count: 0, points: 0, ids: [] }, reject_no_preset: { count: 0, points: 0 }, registry_cancel: { count: 0, points: 0 }, total: 0 },
    bonuses: { collab_active: { count: 0, points: 0 }, win: { points: 0 }, total: 0 },
    recommendations: [hint || 'Недостаточно данных для оценки.'],
    weights: WEIGHTS,
    empty: true
  };
}

function buildRecommendations(ctx) {
  const recs = [];
  const { components, penalties, pool, taken, done, medHours, activeCollabs, overdueIds, abandonedIds } = ctx;
  const untaken = Math.max(0, pool - taken);
  const drafts = Math.max(0, taken - done);

  if (components.take.score < 60 && untaken > 0) {
    recs.push(`В очереди ${untaken} неразобранных — разберите сами или привлеките коллегу.`);
  }
  if (components.completion.score < 60 && drafts > 0) {
    recs.push(`${drafts} черновик(ов) без решения — закройте анализ (подаём / не подаём).`);
  }
  if (components.speed.score < 60 && medHours != null) {
    recs.push(`Медиана закрытия ${Math.round(medHours)} ч при цели ${SPEED_TARGET_HOURS} ч — ускорьте первичный разбор.`);
  }
  if (penalties.overdue.count > 0) {
    const sample = overdueIds.slice(0, 5).join(', ');
    recs.push(`Просрочено по docs_deadline: ${penalties.overdue.count}` + (sample ? ` (ID: ${sample})` : '') + ' — приоритет на горящие.');
  }
  if (penalties.abandoned.count > 0) {
    const sample = abandonedIds.slice(0, 5).join(', ');
    recs.push(`Брошено без финала: ${penalties.abandoned.count}` + (sample ? ` (ID: ${sample})` : '') + '.');
  }
  if (penalties.reject_no_preset.count > 0) {
    recs.push('Отказы без причины (reject_preset) — указывайте пресет при «не подаём».');
  }
  if (components.collab.score < 40 && pool >= 5 && activeCollabs === 0) {
    recs.push('Большая очередь без коллаборации — привлекайте смежных РП.');
  }
  if (!recs.length) {
    if (components.take.score >= 80 && components.completion.score >= 80) {
      recs.push('Сильные покрытие и закрытие — держите темп и следите за дедлайнами.');
    } else {
      recs.push('Продолжайте разбирать очередь и закрывать анализ до дедлайна документов.');
    }
  }
  return recs.slice(0, 5);
}

async function listPmUserIds(db) {
  const r = await db.query(`
    SELECT DISTINCT u.id
    FROM users u
    WHERE COALESCE(u.is_active, true) = true
      AND (
        u.role IN ('PM', 'HEAD_PM')
        OR EXISTS (SELECT 1 FROM pm_duty_roster d WHERE d.pm_user_id = u.id)
        OR EXISTS (
          SELECT 1 FROM tender_rp_reviews rev
          WHERE COALESCE(rev.analysis_owner_user_id, rev.started_by_user_id, rev.analysis_finalized_by_user_id) = u.id
        )
      )
    ORDER BY u.id
  `);
  return r.rows.map((x) => x.id);
}

/**
 * Persist daily snapshots for all window kinds for one user.
 */
async function upsertSnapshots(db, userId, asOfDate) {
  const asOf = isoDate(asOfDate) || isoDate(new Date());
  const kinds = ['duty', 'd30', 'd90'];
  const results = [];
  for (const kind of kinds) {
    const payload = await computeUserRating(db, userId, kind, asOf);
    await db.query(`
      INSERT INTO pm_analysis_rating_daily (
        user_id, as_of_date, window_kind, score, grade,
        period_start, period_end, components_json, penalties_json, bonuses_json, recs_json, updated_at
      ) VALUES ($1, $2::date, $3, $4, $5, $6::date, $7::date, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, NOW())
      ON CONFLICT (user_id, as_of_date, window_kind) DO UPDATE SET
        score = EXCLUDED.score,
        grade = EXCLUDED.grade,
        period_start = EXCLUDED.period_start,
        period_end = EXCLUDED.period_end,
        components_json = EXCLUDED.components_json,
        penalties_json = EXCLUDED.penalties_json,
        bonuses_json = EXCLUDED.bonuses_json,
        recs_json = EXCLUDED.recs_json,
        updated_at = NOW()
    `, [
      userId, asOf, kind, payload.score, payload.grade,
      payload.period_start, payload.period_end,
      JSON.stringify(payload.components),
      JSON.stringify(payload.penalties),
      JSON.stringify(payload.bonuses),
      JSON.stringify(payload.recommendations)
    ]);
    results.push(payload);
  }
  return results;
}

async function recomputeAll(db, asOfDate, log) {
  const asOf = isoDate(asOfDate) || isoDate(new Date());
  const ids = await listPmUserIds(db);
  let ok = 0;
  for (const id of ids) {
    try {
      await upsertSnapshots(db, id, asOf);
      ok += 1;
    } catch (err) {
      log?.error?.({ err, userId: id }, '[PmAnalysisRating] user failed');
    }
  }
  log?.info?.(`[PmAnalysisRating] recomputed ${ok}/${ids.length} users for ${asOf}`);
  return { as_of: asOf, users: ok, total: ids.length };
}

async function getLatestSnapshot(db, userId, windowKind) {
  const kind = windowKind === 'duty' || windowKind === 'd90' ? windowKind : 'd30';
  const r = await db.query(`
    SELECT *
    FROM pm_analysis_rating_daily
    WHERE user_id = $1 AND window_kind = $2
    ORDER BY as_of_date DESC
    LIMIT 1
  `, [userId, kind]);
  return r.rows[0] || null;
}

function snapshotToPayload(row, extra = {}) {
  if (!row) return null;
  return {
    user_id: row.user_id,
    as_of_date: isoDate(row.as_of_date),
    window_kind: row.window_kind,
    period_start: isoDate(row.period_start),
    period_end: isoDate(row.period_end),
    score: row.score,
    grade: row.grade,
    components: row.components_json,
    penalties: row.penalties_json,
    bonuses: row.bonuses_json,
    recommendations: row.recs_json,
    ...extra
  };
}

module.exports = {
  WEIGHTS,
  SPEED_TARGET_HOURS,
  PENALTY,
  BONUS,
  GRADES,
  clamp,
  gradeFromScore,
  resolveWindow,
  computeUserRating,
  upsertSnapshots,
  recomputeAll,
  listPmUserIds,
  getLatestSnapshot,
  snapshotToPayload
};
