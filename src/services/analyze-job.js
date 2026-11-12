'use strict';
/**
 * Job-обёртка для длинного stage/analyze.
 *
 * Без отдельной таблицы: прогресс живёт в stage_state._analyze_job.
 * Close модалки не должен убивать разбор и не должен стартовать второй.
 */

const STALE_MINUTES = 45;

function readJob(state) {
  const s = state && typeof state === 'object' ? state : {};
  const j = s._analyze_job;
  return j && typeof j === 'object' ? j : null;
}

function withJob(state, job) {
  const s = Object.assign({}, state && typeof state === 'object' ? state : {});
  if (job == null) {
    delete s._analyze_job;
  } else {
    s._analyze_job = job;
  }
  return s;
}

async function loadSession(db, sessionUid) {
  const { rows } = await db.query(
    `SELECT session_uid, tender_id, author_id, stage, stage_state, stage_version, status
       FROM tkp_quick_sessions WHERE session_uid = $1 LIMIT 1`,
    [sessionUid]
  );
  return rows[0] || null;
}

function isProcessAlive(pid) {
  if (!(Number(pid) > 0)) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (_) {
    return false;
  }
}

function isStale(job) {
  if (!job || job.status !== 'running') return false;
  if (job.pid && !isProcessAlive(job.pid)) return true;
  const started = Date.parse(job.started_at || '');
  if (!Number.isFinite(started)) return true;
  return (Date.now() - started) > STALE_MINUTES * 60 * 1000;
}

/**
 * Пометить analyze как running. Если уже running и не stale → { conflict:true }.
 */
async function beginAnalyze(db, sessionUid) {
  const sess = await loadSession(db, sessionUid);
  if (!sess) return { ok: false, error: 'session_not_found' };
  let state = sess.stage_state || {};
  let job = readJob(state);
  if (job && job.status === 'running' && !isStale(job)) {
    return { ok: false, conflict: true, job, version: sess.stage_version };
  }
  job = {
    status: 'running',
    pct: 1,
    message: 'Старт анализа',
    positions: 0,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    finished_at: null,
    pid: process.pid,
    error: null
  };
  state = withJob(state, job);
  // stage остаётся read/intake — constraint не знает analyzing.
  const { rows } = await db.query(
    `UPDATE tkp_quick_sessions
        SET stage_state = $2::jsonb,
            stage_version = stage_version + 1,
            stage_updated_at = NOW(),
            updated_at = NOW()
      WHERE session_uid = $1
      RETURNING stage_version, stage_state`,
    [sessionUid, JSON.stringify(state)]
  );
  return {
    ok: true,
    job,
    version: rows[0].stage_version,
    tender_id: sess.tender_id
  };
}

async function patchAnalyzeProgress(db, sessionUid, patch) {
  const sess = await loadSession(db, sessionUid);
  if (!sess) return null;
  const prev = readJob(sess.stage_state) || {};
  if (prev.status !== 'running') return prev;
  const job = Object.assign({}, prev, patch || {}, {
    updated_at: new Date().toISOString(),
    status: 'running',
    pid: process.pid
  });
  const state = withJob(sess.stage_state, job);
  await db.query(
    `UPDATE tkp_quick_sessions
        SET stage_state = $2::jsonb, updated_at = NOW()
      WHERE session_uid = $1`,
    [sessionUid, JSON.stringify(state)]
  );
  return job;
}

async function finishAnalyze(db, sessionUid, { error, resultMeta } = {}) {
  const sess = await loadSession(db, sessionUid);
  if (!sess) return null;
  const prev = readJob(sess.stage_state) || {};
  const job = Object.assign({}, prev, {
    status: error ? 'error' : 'done',
    error: error ? String(error).slice(0, 500) : null,
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    pct: error ? prev.pct : 100,
    message: error ? String(error).slice(0, 200) : 'Разбор сохранён',
    result_meta: resultMeta || null,
    pid: null
  });
  const state = withJob(sess.stage_state, job);
  await db.query(
    `UPDATE tkp_quick_sessions
        SET stage_state = $2::jsonb, updated_at = NOW()
      WHERE session_uid = $1`,
    [sessionUid, JSON.stringify(state)]
  );
  return job;
}

async function cancelAnalyze(db, sessionUid) {
  const sess = await loadSession(db, sessionUid);
  if (!sess) return { ok: false, error: 'session_not_found' };
  const prev = readJob(sess.stage_state);
  if (!prev || prev.status !== 'running') {
    return { ok: true, job: prev, cancelled: false };
  }
  const job = Object.assign({}, prev, {
    status: 'error',
    error: 'Отменено РП',
    message: 'Анализ отменён',
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    pid: null
  });
  const state = withJob(sess.stage_state, job);
  await db.query(
    `UPDATE tkp_quick_sessions
        SET stage_state = $2::jsonb, updated_at = NOW()
      WHERE session_uid = $1`,
    [sessionUid, JSON.stringify(state)]
  );
  return { ok: true, job, cancelled: true };
}

/**
 * Серверный merge результата анализа в tender_rp_reviews.report_json,
 * чтобы карточка обновилась даже если UI закрыли до SSE result.
 */
async function commitAnalyzeToReview(db, tenderId, payload) {
  if (!(Number(tenderId) > 0) || !payload) return { ok: false };
  const { rows } = await db.query(
    `SELECT id, report_json FROM tender_rp_reviews
      WHERE tender_id = $1 ORDER BY id DESC LIMIT 1`,
    [tenderId]
  );
  if (!rows[0]) return { ok: false, error: 'review_not_found' };
  const rj = Object.assign({}, rows[0].report_json || {});
  const st = payload.state || {};
  const positions = Array.isArray(st.positions) ? st.positions
    : (Array.isArray(payload.positions) ? payload.positions : null);

  if (payload.summary) rj.summary = String(payload.summary).trim();
  if (payload.volume_summary) rj.volume_summary = String(payload.volume_summary).trim();
  if (payload.feasibility) rj.feasibility = payload.feasibility;
  if (payload.feasibility_note) rj.feasibility_note = String(payload.feasibility_note).trim();
  if (payload.competition) rj.competition = payload.competition;
  if (payload.risks) rj.risks = String(payload.risks).trim();
  if (payload.decision_recommend) rj.decision_recommend = payload.decision_recommend;
  if (Array.isArray(payload.call_questions)) rj.call_questions = payload.call_questions;
  if (payload.contact) rj.contact = payload.contact;
  if (payload.incomplete != null) rj.incomplete = !!payload.incomplete;
  if (payload.incomplete_note) rj.incomplete_note = String(payload.incomplete_note);
  if (payload.review_hint) rj.review_hint = String(payload.review_hint);
  if (payload.expected_rows != null) rj.expected_rows = Number(payload.expected_rows) || 0;
  if (payload.found_positions != null) rj.found_positions = Number(payload.found_positions) || 0;
  if (payload.valid_positions != null) rj.valid_positions = Number(payload.valid_positions) || 0;

  const vp = payload.visit_plan || st.visit_plan;
  if (vp) {
    rj.visit_plan = vp;
    rj.visit_mode = vp.mode || null;
    rj.trip_count = vp.trip_count || 1;
  }
  const mtrRaw = Array.isArray(payload.mtr_suggestions) ? payload.mtr_suggestions
    : (Array.isArray(st.mtr_suggestions) ? st.mtr_suggestions : []);
  if (mtrRaw.length) {
    rj.mtr_suggestions = mtrRaw;
    if (!Array.isArray(rj.mtr) || !rj.mtr.length) {
      rj.mtr = mtrRaw.map((x) => ({
        name: x.name, qty: x.qty, unit: x.unit, note: x.purpose || x.note, source: x.source
      }));
    }
  }
  const qs = Array.isArray(payload.questions_for_customer) ? payload.questions_for_customer
    : (Array.isArray(st.questions_for_customer) ? st.questions_for_customer : null);
  if (qs && qs.length) rj.questions_for_customer = qs;
  if (positions && positions.length) {
    rj.dv_positions = positions;
  }
  if (payload.schedule || st.schedule) rj.schedule = payload.schedule || st.schedule;
  if (payload.schedule_days != null || st.schedule_days != null) {
    rj.schedule_days = payload.schedule_days != null ? payload.schedule_days : st.schedule_days;
  }

  await db.query(
    `UPDATE tender_rp_reviews SET report_json = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(rj), rows[0].id]
  );
  return { ok: true, review_id: rows[0].id };
}

async function getAnalyzeStatus(db, sessionUid) {
  const sess = await loadSession(db, sessionUid);
  if (!sess) return { ok: false, error: 'session_not_found' };
  let job = readJob(sess.stage_state);
  if (job && job.status === 'running' && isStale(job)) {
    await finishAnalyze(db, sessionUid, { error: 'Анализ прерван (процесс не отвечает)' });
    job = readJob((await loadSession(db, sessionUid)).stage_state);
  }
  return {
    ok: true,
    stage: sess.stage,
    version: sess.stage_version,
    job: job || null,
    running: !!(job && job.status === 'running'),
    done: !!(job && job.status === 'done'),
    state: sess.stage_state
  };
}

module.exports = {
  beginAnalyze,
  patchAnalyzeProgress,
  finishAnalyze,
  cancelAnalyze,
  commitAnalyzeToReview,
  getAnalyzeStatus,
  readJob,
  STALE_MINUTES
};
