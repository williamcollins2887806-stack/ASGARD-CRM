'use strict';

/**
 * Weekly RP digest — данные за календарную неделю + срез «сейчас» (работы/заявки).
 */

const { notClosedSql } = require('../helpers/work-status');

const COL_LABELS = {
  new: 'новые',
  calc: 'расчёт',
  approval: 'согласование',
  kp_prep: 'КП',
  sent: 'отправлено',
  addendum: 'дозапрос'
};

function isoDate(d) {
  if (!d) return null;
  if (typeof d === 'string') {
    const s = String(d).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) {
      try {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Europe/Moscow',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(parsed);
      } catch (_) { /* fall through */ }
    }
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : s.slice(0, 10);
  }
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    // DATE из pg часто = полночь локали → toISOString() сдвигает на −1 день.
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(d);
    } catch (_) {
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${mo}-${day}`;
    }
  }
  try { return String(d).slice(0, 10); } catch (_) { return null; }
}

/** Calendar +1 day for YYYY-MM-DD (UTC noon to avoid DST edge). */
function addDaysIso(iso, days) {
  const base = isoDate(iso);
  if (!base) return null;
  const d = new Date(base + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Previous Mon–Sun relative to asOf (or explicit week containing asOf). */
function resolveWeekRange(asOfDate) {
  const asOf = new Date((isoDate(asOfDate) || isoDate(new Date())) + 'T12:00:00Z');
  // JS: 0=Sun … 1=Mon
  const dow = asOf.getUTCDay();
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const thisMon = new Date(asOf);
  thisMon.setUTCDate(asOf.getUTCDate() - daysFromMon);
  // For Monday morning report we want *previous* completed week
  const prevMon = new Date(thisMon);
  prevMon.setUTCDate(thisMon.getUTCDate() - 7);
  const prevSun = new Date(prevMon);
  prevSun.setUTCDate(prevMon.getUTCDate() + 6);
  return {
    weekStart: isoDate(prevMon),
    weekEnd: isoDate(prevSun)
  };
}

function statusGroup(status) {
  const n = String(status || '').trim().toLowerCase();
  if (n === 'в работе') return 'in_work';
  if (n === 'на паузе' || n === 'подписание акта') return 'pause';
  if (n === 'новая' || n === 'подготовка' || n === 'мобилизация') return 'prep';
  return 'other';
}

async function buildWeeklyDigest(db, opts = {}) {
  const preview = !!opts.preview;
  let weekStart = opts.weekStart;
  let weekEnd = opts.weekEnd;
  if (!weekStart || !weekEnd) {
    const r = resolveWeekRange(opts.asOf || new Date());
    // If asOf is Monday 07.09, previous week is 31.08–06.09
    weekStart = weekStart || r.weekStart;
    weekEnd = weekEnd || r.weekEnd;
  }
  // Explicit override for preview 07.09
  if (opts.forceWeek) {
    weekStart = opts.forceWeek.start;
    weekEnd = opts.forceWeek.end;
  }

  const [
    duty,
    analysisByPm,
    registry,
    stale,
    ratings,
    works,
    marketplace,
    kanban,
    toActivity,
    crmActivity,
    nextDuty,
    fieldApp
  ] = await Promise.all([
    loadDuty(db, weekStart, weekEnd),
    loadAnalysisByPm(db, weekStart, weekEnd),
    loadRegistryMoves(db, weekStart, weekEnd),
    loadStaleOpen(db),
    loadRatings(db),
    loadActiveWorks(db),
    loadMarketplace(db),
    loadKanbanApps(db),
    loadToActivity(db, weekStart, weekEnd),
    loadCrmActivity(db, weekStart, weekEnd),
    loadNextDuty(db, weekEnd),
    loadFieldAppStats(db, weekStart, weekEnd)
  ]);

  const kpi = {
    taken: analysisByPm.reduce((s, x) => s + (x.taken || 0), 0),
    go: analysisByPm.reduce((s, x) => s + (x.go || 0), 0),
    reject: analysisByPm.reduce((s, x) => s + (x.reject || 0), 0),
    submitted: registry.submitted || 0,
    cancelled: registry.cancelled || 0
  };

  const dutyRows = duty.map((d) => {
    const a = analysisByPm.find((x) => x.user_id === d.pm_user_id) || {};
    const rat = ratings.find((x) => x.user_id === d.pm_user_id) || {};
    return {
      ...d,
      taken: a.taken || 0,
      go: a.go || 0,
      reject: a.reject || 0,
      closed: (a.go || 0) + (a.reject || 0),
      grade_d30: rat.grade_d30 || null,
      score_d30: rat.score_d30 != null ? rat.score_d30 : null,
      grade_duty: rat.grade_duty || null,
      score_duty: rat.score_duty != null ? rat.score_duty : null
    };
  });

  const analysisLeaders = analysisByPm
    .filter((a) => (a.go || 0) + (a.reject || 0) > 0)
    .map((a) => ({
      ...a,
      closed: (a.go || 0) + (a.reject || 0),
      on_duty: dutyRows.some((d) => d.pm_user_id === a.user_id)
    }))
    .sort((a, b) => b.closed - a.closed);

  const worksCounts = works.counts || { prep: 0, in_work: 0, pause: 0, other: 0 };
  const workItems = works.items || works;

  const payload = {
    preview,
    kind: opts.kind || 'weekly',
    title: opts.title || null,
    weekStart,
    weekEnd,
    generatedAt: new Date().toISOString(),
    kpi,
    duty: dutyRows,
    analysisLeaders,
    analysisOthers: analysisByPm
      .filter((a) => !dutyRows.some((d) => d.pm_user_id === a.user_id) && (a.go + a.reject + a.taken) > 0)
      .slice(0, 8),
    stale: stale.slice(0, 5),
    staleTotal: stale.length,
    ratingsTop: ratings
      .filter((r) => r.score_d30 != null && Number(r.score_d30) > 10)
      .sort((a, b) => (b.score_d30 || 0) - (a.score_d30 || 0))
      .slice(0, 5),
    works: {
      counts: worksCounts,
      items: sortWorks(workItems),
      total: works.total != null ? works.total : workItems.length
    },
    marketplace,
    kanban,
    toActivity,
    crmActivity,
    nextDuty,
    fieldApp,
    verdict: null,
    recommendations: []
  };

  const { buildHeuristicDigestCopy } = require('../prompts/pm-analysis-weekly-prompt');
  const copy = buildHeuristicDigestCopy(payload);
  payload.verdict = copy.verdict;
  payload.recommendations = copy.recommendations;

  return payload;
}

async function loadDuty(db, weekStart, weekEnd) {
  const r = await db.query(`
    SELECT r.id, r.pm_user_id, u.name AS pm_name,
           r.period_start::text AS period_start, r.period_end::text AS period_end
    FROM pm_duty_roster r
    JOIN users u ON u.id = r.pm_user_id
    WHERE r.period_start <= $2::date AND r.period_end >= $1::date
    ORDER BY r.period_start ASC, r.created_at ASC
  `, [weekStart, weekEnd]);
  return r.rows.map((row) => ({
    ...row,
    period_start: isoDate(row.period_start),
    period_end: isoDate(row.period_end)
  }));
}

/**
 * Дежурство после отчётной недели:
 * - continuing — смена покрывает день после weekEnd (ещё идёт);
 * - next — отдельная следующая смена после конца текущей / после weekEnd;
 * - none — дыра: после weekEnd никто не дежурит.
 * needs_successor — нет записи после period_end текущей (продолжающейся) смены.
 */
async function loadNextDuty(db, weekEnd) {
  const empty = {
    kind: 'none',
    assigned: false,
    continuing: false,
    needs_successor: true,
    pm_user_id: null,
    pm_name: null,
    period_start: null,
    period_end: null
  };
  const dayAfter = addDaysIso(weekEnd, 1);
  if (!dayAfter) return empty;

  const coveringR = await db.query(`
    SELECT r.pm_user_id, u.name AS pm_name,
           r.period_start::text AS period_start, r.period_end::text AS period_end
    FROM pm_duty_roster r
    JOIN users u ON u.id = r.pm_user_id
    WHERE r.period_start <= $1::date AND r.period_end >= $1::date
    ORDER BY r.created_at DESC
    LIMIT 1
  `, [dayAfter]).catch(() => ({ rows: [] }));

  const covering = coveringR.rows[0]
    ? {
        pm_user_id: coveringR.rows[0].pm_user_id,
        pm_name: coveringR.rows[0].pm_name,
        period_start: isoDate(coveringR.rows[0].period_start),
        period_end: isoDate(coveringR.rows[0].period_end)
      }
    : null;

  if (covering) {
    const nextR = await db.query(`
      SELECT r.pm_user_id, u.name AS pm_name,
             r.period_start::text AS period_start, r.period_end::text AS period_end
      FROM pm_duty_roster r
      JOIN users u ON u.id = r.pm_user_id
      WHERE r.period_start > $1::date
      ORDER BY r.period_start ASC
      LIMIT 1
    `, [covering.period_end]).catch(() => ({ rows: [] }));

    if (nextR.rows[0]) {
      const row = nextR.rows[0];
      return {
        kind: 'next',
        assigned: true,
        continuing: false,
        needs_successor: false,
        pm_user_id: row.pm_user_id,
        pm_name: row.pm_name,
        period_start: isoDate(row.period_start),
        period_end: isoDate(row.period_end),
        continuing_until: covering.period_end,
        continuing_pm_name: covering.pm_name
      };
    }

    return {
      kind: 'continuing',
      assigned: false,
      continuing: true,
      needs_successor: true,
      pm_user_id: covering.pm_user_id,
      pm_name: covering.pm_name,
      period_start: covering.period_start,
      period_end: covering.period_end
    };
  }

  const nextR = await db.query(`
    SELECT r.pm_user_id, u.name AS pm_name,
           r.period_start::text AS period_start, r.period_end::text AS period_end
    FROM pm_duty_roster r
    JOIN users u ON u.id = r.pm_user_id
    WHERE r.period_start >= $1::date
      AND r.period_end > $1::date
    ORDER BY r.period_start ASC
    LIMIT 1
  `, [weekEnd]).catch(() => ({ rows: [] }));

  if (!nextR.rows[0]) return empty;
  const row = nextR.rows[0];
  return {
    kind: 'next',
    assigned: true,
    continuing: false,
    needs_successor: false,
    pm_user_id: row.pm_user_id,
    pm_name: row.pm_name,
    period_start: isoDate(row.period_start),
    period_end: isoDate(row.period_end)
  };
}

/** Статистика приложения рабочих (Field App). */
async function loadFieldAppStats(db, weekStart, weekEnd) {
  const totals = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users
        WHERE role = 'FIELD_WORKER' AND is_active = true
          AND login NOT LIKE 'test_%' AND name NOT ILIKE 'Test %') AS total_users,
      (SELECT COUNT(*)::int FROM users
        WHERE role = 'FIELD_WORKER' AND is_active = true AND pin_hash IS NOT NULL
          AND login NOT LIKE 'test_%') AS with_pin
  `).catch(() => ({ rows: [{ total_users: 0, with_pin: 0 }] }));

  const period = await db.query(`
    SELECT
      COUNT(DISTINCT l.employee_id)::int AS active_users,
      COUNT(*)::int AS login_events
    FROM field_app_logins l
    JOIN employees e ON e.id = l.employee_id
    LEFT JOIN users u ON u.id = e.user_id
    WHERE l.created_at::date BETWEEN $1::date AND $2::date
      AND COALESCE(e.is_active, true) = true
      AND (u.role = 'FIELD_WORKER' OR u.id IS NULL)
      AND COALESCE(u.login, '') NOT LIKE 'test_%'
  `, [weekStart, weekEnd]).catch(async () => {
    const fb = await db.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE e.field_last_login::date BETWEEN $1::date AND $2::date
            AND u.role = 'FIELD_WORKER'
        )::int AS active_users,
        0::int AS login_events
      FROM employees e
      JOIN users u ON u.id = e.user_id
      WHERE COALESCE(e.is_active, true) = true
    `, [weekStart, weekEnd]).catch(() => ({ rows: [{ active_users: 0, login_events: 0 }] }));
    return fb;
  });

  const newReg = await db.query(`
    SELECT COUNT(*)::int AS new_users
    FROM users
    WHERE role = 'FIELD_WORKER'
      AND is_active = true
      AND created_at::date BETWEEN $1::date AND $2::date
      AND login NOT LIKE 'test_%'
      AND name NOT ILIKE 'Test %'
  `, [weekStart, weekEnd]).catch(() => ({ rows: [{ new_users: 0 }] }));

  const t = totals.rows[0] || {};
  const p = period.rows[0] || {};
  return {
    total_users: t.total_users || 0,
    with_pin: t.with_pin || 0,
    active_users: p.active_users || 0,
    login_events: p.login_events || 0,
    new_users: newReg.rows[0]?.new_users || 0,
    note: '«Заходили» — сколько уникальных рабочих входили в приложение за период (SMS или PIN).'
  };
}

async function loadAnalysisByPm(db, weekStart, weekEnd) {
  // Последнее finalize_* по review: reject→submit на одном анализе не двойнится.
  // «Взяли» = число уникальных закрытых анализов (= go + reject).
  const r = await db.query(`
    WITH last_fin AS (
      SELECT DISTINCT ON (l.review_id)
        l.review_id,
        l.actor_user_id AS uid,
        l.action
      FROM tender_rp_review_log l
      WHERE l.action IN ('finalize_analysis', 'finalize_reject')
        AND l.created_at::date BETWEEN $1::date AND $2::date
      ORDER BY l.review_id, l.created_at DESC
    ),
    closed_log AS (
      SELECT
        uid,
        COUNT(*) FILTER (WHERE action = 'finalize_reject')::int AS reject,
        COUNT(*) FILTER (WHERE action = 'finalize_analysis')::int AS go,
        COUNT(*)::int AS taken
      FROM last_fin
      GROUP BY 1
    )
    SELECT u.id AS user_id, u.name, u.role,
           COALESCE(c.taken, 0) AS taken,
           COALESCE(c.go, 0) AS go,
           COALESCE(c.reject, 0) AS reject
    FROM users u
    JOIN closed_log c ON c.uid = u.id
    WHERE COALESCE(c.taken, 0) > 0
    ORDER BY (COALESCE(c.go,0)+COALESCE(c.reject,0)) DESC, u.name
  `, [weekStart, weekEnd]);

  const admin = r.rows.find((x) => x.role === 'ADMIN' || /администратор/i.test(x.name || ''));
  const androsov = r.rows.find((x) => /андросов/i.test(x.name || '') && x.role === 'PM');
  let rows = r.rows.filter((x) => x.role !== 'ADMIN' && !/администратор/i.test(x.name || ''));
  if (admin && androsov) {
    androsov.taken += admin.taken || 0;
    androsov.go += admin.go || 0;
    androsov.reject += admin.reject || 0;
  } else if (admin) {
    rows.push({
      user_id: admin.user_id,
      name: 'Андросов Никита Андреевич',
      role: 'PM',
      taken: admin.taken || 0,
      go: admin.go || 0,
      reject: admin.reject || 0
    });
  }
  return rows.sort((a, b) => ((b.go + b.reject) - (a.go + a.reject)) || String(a.name).localeCompare(String(b.name), 'ru'));
}

async function loadRegistryMoves(db, weekStart, weekEnd) {
  const afterExpr = `
    CASE
      WHEN a.action = 'registry_lost' THEN 'проиграли'
      WHEN a.action = 'registry_won' THEN 'выиграли'
      WHEN jsonb_typeof(a.payload_json->'after') = 'string' THEN a.payload_json->>'after'
      ELSE COALESCE(a.payload_json->'after'->>'registry_status', a.payload_json->>'after')
    END
  `;
  const r = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE ${afterExpr} = 'подались')::int AS submitted,
      COUNT(*) FILTER (WHERE ${afterExpr} = 'отмена')::int AS cancelled,
      COUNT(*) FILTER (WHERE ${afterExpr} = 'проиграли')::int AS lost,
      COUNT(*) FILTER (WHERE ${afterExpr} = 'выиграли')::int AS won
    FROM audit_log a
    WHERE a.action IN ('registry_status', 'registry_lost', 'registry_won')
      AND a.created_at::date BETWEEN $1::date AND $2::date
  `, [weekStart, weekEnd]).catch(() => ({ rows: [{ submitted: 0, cancelled: 0, lost: 0, won: 0 }] }));
  return r.rows[0] || { submitted: 0, cancelled: 0, lost: 0, won: 0 };
}

async function loadStaleOpen(db) {
  const r = await db.query(`
    SELECT t.id AS tender_id, t.customer_name, t.tender_title,
           t.docs_deadline::date AS docs_deadline,
           u.name AS pm_name, u.id AS pm_user_id,
           COALESCE(rev.analysis_started_at, rev.created_at) AS started_at,
           GREATEST(
             COALESCE(rev.updated_at, rev.created_at),
             COALESCE((SELECT MAX(l.created_at) FROM tender_rp_review_log l WHERE l.review_id = rev.id), rev.created_at),
             COALESCE((SELECT MAX(d.updated_at) FROM tender_rp_review_participant_drafts d WHERE d.review_id = rev.id), rev.created_at)
           ) AS last_touch
    FROM tender_rp_reviews rev
    JOIN tenders t ON t.id = rev.tender_id AND t.deleted_at IS NULL
    JOIN users u ON u.id = COALESCE(rev.analysis_owner_user_id, rev.started_by_user_id)
    WHERE rev.analysis_finalized_at IS NULL
      AND t.registry_status = 'рассмотрение'
      AND COALESCE(t.calculator_kind, '') <> 'to'
      AND u.role IS DISTINCT FROM 'ADMIN'
      AND u.name NOT ILIKE 'Администратор%'
      AND u.login NOT LIKE 'test_%'
      AND NOT (
        COALESCE(btrim(t.customer_name), '') = ''
        AND COALESCE(btrim(t.tender_title), '') ILIKE 'Новый тендер%'
      )
      AND (
        GREATEST(
          COALESCE(rev.updated_at, rev.created_at),
          COALESCE((SELECT MAX(l.created_at) FROM tender_rp_review_log l WHERE l.review_id = rev.id), rev.created_at),
          COALESCE((SELECT MAX(d.updated_at) FROM tender_rp_review_participant_drafts d WHERE d.review_id = rev.id), rev.created_at)
        ) < NOW() - INTERVAL '24 hours'
        OR (t.docs_deadline IS NOT NULL AND t.docs_deadline::date <= CURRENT_DATE + 2)
      )
    ORDER BY t.docs_deadline ASC NULLS LAST, last_touch ASC
    LIMIT 50
  `);
  return r.rows.map((row) => ({
    ...row,
    docs_deadline: isoDate(row.docs_deadline),
    idle_hours: row.last_touch
      ? Math.round((Date.now() - new Date(row.last_touch).getTime()) / 3600000)
      : null
  }));
}

async function loadRatings(db) {
  const r = await db.query(`
    SELECT u.id AS user_id, u.name,
      MAX(CASE WHEN r.window_kind = 'd30' THEN r.score END) AS score_d30,
      MAX(CASE WHEN r.window_kind = 'd30' THEN r.grade END) AS grade_d30,
      MAX(CASE WHEN r.window_kind = 'duty' THEN r.score END) AS score_duty,
      MAX(CASE WHEN r.window_kind = 'duty' THEN r.grade END) AS grade_duty
    FROM pm_analysis_rating_daily r
    JOIN users u ON u.id = r.user_id
    WHERE r.as_of_date = (SELECT MAX(as_of_date) FROM pm_analysis_rating_daily)
      AND u.role IN ('PM', 'HEAD_PM')
      AND u.login NOT LIKE 'test_%'
      AND u.name NOT ILIKE 'Test %'
      AND u.name NOT ILIKE 'Администратор%'
    GROUP BY u.id, u.name
  `);
  return r.rows;
}

async function loadActiveWorks(db) {
  const countsR = await db.query(`
    SELECT btrim(lower(w.work_status)) AS st, COUNT(*)::int AS n
    FROM works w
    WHERE w.deleted_at IS NULL
      AND ${notClosedSql('w.work_status')}
    GROUP BY 1
  `);
  const worksCounts = { prep: 0, in_work: 0, pause: 0, other: 0 };
  for (const row of countsR.rows) {
    const g = statusGroup(row.st);
    worksCounts[g] = (worksCounts[g] || 0) + row.n;
  }
  const total = Object.values(worksCounts).reduce((s, n) => s + n, 0);

  const r = await db.query(`
    SELECT w.id, w.work_title, w.work_status, w.object_name, w.customer_name, w.city,
           u.name AS pm_name, u.id AS pm_user_id
    FROM works w
    LEFT JOIN users u ON u.id = w.pm_id
    WHERE w.deleted_at IS NULL
      AND ${notClosedSql('w.work_status')}
    ORDER BY
      CASE btrim(lower(w.work_status))
        WHEN 'в работе' THEN 1
        WHEN 'мобилизация' THEN 2
        WHEN 'подготовка' THEN 3
        WHEN 'новая' THEN 4
        WHEN 'на паузе' THEN 5
        WHEN 'подписание акта' THEN 6
        ELSE 7
      END,
      w.updated_at DESC NULLS LAST
    LIMIT 100
  `);
  return { items: r.rows, counts: worksCounts, total };
}

function sortWorks(items) {
  const rank = (s) => {
    const g = statusGroup(s);
    return g === 'in_work' ? 0 : g === 'prep' ? 1 : g === 'pause' ? 2 : 3;
  };
  return [...items].sort((a, b) => rank(a.work_status) - rank(b.work_status));
}

async function loadMarketplace(db) {
  const inbox = await db.query(`
    SELECT COUNT(*)::int AS c FROM inbox_applications
    WHERE assigned_pm_id IS NULL
      AND status IN ('new','ai_processed','under_review')
  `).catch(() => ({ rows: [{ c: 0 }] }));
  const pre = await db.query(`
    SELECT COUNT(*)::int AS c FROM pre_tender_requests pt
    WHERE pt.assigned_to IS NULL
      AND pt.status IN ('new','in_review','need_docs')
      AND NOT EXISTS (SELECT 1 FROM tenders t WHERE t.source_pre_tender_id = pt.id LIMIT 1)
  `).catch(async () => {
    return db.query(`
      SELECT COUNT(*)::int AS c FROM pre_tender_requests
      WHERE assigned_to IS NULL AND status IN ('new','in_review','need_docs')
    `).catch(() => ({ rows: [{ c: 0 }] }));
  });
  return {
    inbox_free: inbox.rows[0]?.c || 0,
    pretender_free: pre.rows[0]?.c || 0,
    free_total: (inbox.rows[0]?.c || 0) + (pre.rows[0]?.c || 0)
  };
}

async function loadKanbanApps(db) {
  const r = await db.query(`
    SELECT u.id AS user_id, u.name AS pm_name,
           pk_v3_column(c.flow_type, c.current_main_status) AS v3_column,
           COUNT(*)::int AS n
    FROM personal_kanban_cards c
    JOIN users u ON u.id = c.owner_user_id
    WHERE COALESCE(c.is_closed, false) = false
      AND c.flow_type IN ('application', 'pre_tender')
      AND u.role IN ('PM', 'HEAD_PM')
      AND pk_v3_column(c.flow_type, c.current_main_status) IN ('new','calc','approval','kp_prep','sent','addendum')
    GROUP BY u.id, u.name, 3
    ORDER BY u.name, 3
  `).catch(() => ({ rows: [] }));

  const byPm = new Map();
  for (const row of r.rows) {
    if (!byPm.has(row.user_id)) {
      byPm.set(row.user_id, { user_id: row.user_id, pm_name: row.pm_name, total: 0, cols: {} });
    }
    const p = byPm.get(row.user_id);
    p.cols[row.v3_column] = row.n;
    p.total += row.n;
  }
  const people = Array.from(byPm.values()).sort((a, b) => b.total - a.total);
  return {
    total: people.reduce((s, p) => s + p.total, 0),
    people: people.slice(0, 6),
    peopleTotal: people.length,
    colLabels: COL_LABELS
  };
}

/** Статусы реестра, которые ТО двигает руками (канон CRM). */
function extractRegistryAfterSql(alias = 'a') {
  return `
    CASE
      WHEN ${alias}.action = 'registry_lost' THEN 'проиграли'
      WHEN ${alias}.action = 'registry_won' THEN 'выиграли'
      WHEN jsonb_typeof(${alias}.payload_json->'after') = 'string'
        THEN ${alias}.payload_json->>'after'
      ELSE COALESCE(
        ${alias}.payload_json->'after'->>'registry_status',
        ${alias}.payload_json->>'after'
      )
    END
  `;
}

async function loadToActivity(db, weekStart, weekEnd) {
  // период: [start, end] включительно по датам
  const afterExpr = extractRegistryAfterSql('a');
  const r = await db.query(`
    WITH tos AS (
      SELECT id, name, role
      FROM users
      WHERE is_active = true
        AND role IN ('TO', 'HEAD_TO')
        AND login NOT LIKE 'test_%'
        AND name NOT ILIKE 'Test %'
        AND name NOT ILIKE 'ТЕСТ%'
        AND name NOT ILIKE 'Администратор%'
    ),
    created AS (
      SELECT COALESCE(t.created_by_user_id, t.created_by) AS uid, COUNT(*)::int AS n
      FROM tenders t
      WHERE t.deleted_at IS NULL
        AND t.created_at::date BETWEEN $1::date AND $2::date
      GROUP BY 1
    ),
    moved AS (
      SELECT a.actor_user_id AS uid,
        COUNT(*) FILTER (WHERE ${afterExpr} = 'подались')::int AS submitted,
        COUNT(*) FILTER (WHERE ${afterExpr} = 'отмена')::int AS cancelled,
        COUNT(*) FILTER (WHERE ${afterExpr} = 'проиграли')::int AS lost,
        COUNT(*) FILTER (WHERE ${afterExpr} = 'выиграли')::int AS won
      FROM audit_log a
      WHERE a.action IN ('registry_status', 'registry_lost', 'registry_won')
        AND a.created_at::date BETWEEN $1::date AND $2::date
        AND a.actor_user_id IS NOT NULL
      GROUP BY 1
    ),
    won_fb AS (
      SELECT won_by_user_id AS uid, COUNT(*)::int AS n
      FROM tenders
      WHERE deleted_at IS NULL AND won_at::date BETWEEN $1::date AND $2::date
        AND won_by_user_id IS NOT NULL
      GROUP BY 1
    ),
    lost_fb AS (
      SELECT lost_by_user_id AS uid, COUNT(*)::int AS n
      FROM tenders
      WHERE deleted_at IS NULL AND lost_at::date BETWEEN $1::date AND $2::date
        AND lost_by_user_id IS NOT NULL
      GROUP BY 1
    )
    SELECT t.id AS user_id, t.name, t.role,
           COALESCE(c.n, 0) AS created,
           COALESCE(m.submitted, 0) AS submitted,
           COALESCE(m.cancelled, 0) AS cancelled,
           GREATEST(COALESCE(m.lost, 0), COALESCE(lf.n, 0)) AS lost,
           GREATEST(COALESCE(m.won, 0), COALESCE(wf.n, 0)) AS won
    FROM tos t
    LEFT JOIN created c ON c.uid = t.id
    LEFT JOIN moved m ON m.uid = t.id
    LEFT JOIN won_fb wf ON wf.uid = t.id
    LEFT JOIN lost_fb lf ON lf.uid = t.id
  `, [weekStart, weekEnd]);

  const people = r.rows.map((row) => {
    const activity = (row.created || 0) + (row.submitted || 0) + (row.cancelled || 0)
      + (row.lost || 0) + (row.won || 0);
    return { ...row, activity };
  }).sort((a, b) => b.activity - a.activity || String(a.name).localeCompare(String(b.name), 'ru'));

  return {
    people,
    note: '«Внёс» — новые тендеры за период. «Подались / отмена / проиграли / выиграли» — переводы статуса в реестре за тот же период (могут быть по тендерам прошлых недель). Статус «не подаём» — решение анализа руководителя проекта, в этой таблице не учитывается.'
  };
}

async function loadCrmActivity(db, weekStart, weekEnd) {
  // Источники дней: график офиса + last_login + presence.
  // audit_log НЕ даёт «день» — иначе фон (notifications) и чужие сессии без login
  // рисуют ложных «заходивших» (Кудряшов/Пантузенко).
  // Часы — только из crm_presence_daily (с 08.09), без оценок «≈8ч».
  // Важно: многие действия офиса (в т.ч. работы) НЕ пишутся в audit_log —
  // поэтому график обязателен, иначе люди вроде офис-менеджера «пропадают».
  const ANDROSOV_ID = 3474;
  const ADMIN_ID = 1;
  const PLAN_ACTIVE = new Set(['оф', 'уд', 'об', 'км', 'пг', 'уч', 'ск']);

  const presence = await db.query(`
    SELECT u.id AS user_id, u.name, u.role,
           COUNT(*)::int AS days_active,
           ROUND(SUM(p.active_seconds) / 3600.0, 1) AS hours
    FROM crm_presence_daily p
    JOIN users u ON u.id = p.user_id
    WHERE p.day BETWEEN $1::date AND $2::date
      AND p.active_seconds > 0
      AND u.is_active = true
      AND u.role NOT IN ('FIELD_WORKER', 'BOT')
      AND u.login NOT LIKE 'test_%'
      AND u.name NOT ILIKE 'Test %'
      AND u.name NOT ILIKE 'ТЕСТ%'
    GROUP BY u.id, u.name, u.role
  `, [weekStart, weekEnd]).catch(() => ({ rows: [] }));

  const plan = await db.query(`
    SELECT u.id AS user_id, u.name, u.role, sp.date::text AS d, sp.status_code
    FROM staff_plan sp
    JOIN staff s ON s.id = sp.staff_id
    JOIN users u ON u.id = s.user_id
    WHERE sp.date BETWEEN $1::date AND $2::date
      AND sp.status_code IS NOT NULL AND btrim(sp.status_code) <> ''
      AND u.is_active = true
      AND u.role NOT IN ('FIELD_WORKER', 'BOT')
      AND u.login NOT LIKE 'test_%'
      AND u.name NOT ILIKE 'Test %'
      AND u.name NOT ILIKE 'ТЕСТ%'
  `, [weekStart, weekEnd]).catch(() => ({ rows: [] }));

  const audit = await db.query(`
    SELECT u.id AS user_id, u.name, u.role,
           a.created_at::date::text AS d,
           COUNT(*)::int AS actions
    FROM audit_log a
    JOIN users u ON u.id = a.actor_user_id
    WHERE a.created_at::date BETWEEN $1::date AND $2::date
      AND u.is_active = true
      AND u.role NOT IN ('FIELD_WORKER', 'BOT')
      AND u.login NOT LIKE 'test_%'
      AND u.name NOT ILIKE 'Test %'
      AND u.name NOT ILIKE 'ТЕСТ%'
      AND COALESCE(a.payload_json->>'path', '') NOT ILIKE '%/notifications/%'
      AND COALESCE(a.payload_json->>'path', '') NOT ILIKE '%/daily-presence/%'
    GROUP BY u.id, u.name, u.role, 4
  `, [weekStart, weekEnd]).catch(() => ({ rows: [] }));

  const logins = await db.query(`
    SELECT id AS user_id, name, role, last_login_at::date::text AS d
    FROM users
    WHERE is_active = true
      AND last_login_at::date BETWEEN $1::date AND $2::date
      AND role NOT IN ('FIELD_WORKER', 'BOT', 'ADMIN')
      AND login NOT LIKE 'test_%'
      AND name NOT ILIKE 'Test %'
      AND name NOT ILIKE 'ТЕСТ%'
  `, [weekStart, weekEnd]).catch(() => ({ rows: [] }));

  const byUser = new Map();
  const fold = (id, name, role) => {
    let uid = Number(id);
    let nm = name;
    let rl = role;
    if (uid === ADMIN_ID || role === 'ADMIN' || /администратор/i.test(name || '')) {
      uid = ANDROSOV_ID;
      nm = 'Андросов Никита Андреевич';
      rl = 'PM';
    }
    if (!byUser.has(uid)) {
      byUser.set(uid, {
        user_id: uid, name: nm, role: rl,
        days: new Set(), hours: null, actions: 0,
        hasPresence: false, hasPlan: false, hasLogin: false
      });
    }
    const row = byUser.get(uid);
    if (nm && /андросов/i.test(nm)) row.name = nm;
    if (rl && row.role === 'ADMIN') row.role = rl;
    return row;
  };

  for (const p of presence.rows) {
    const row = fold(p.user_id, p.name, p.role);
    row.hasPresence = true;
    row.hours = (row.hours || 0) + Number(p.hours || 0);
    row._presenceDays = Math.max(row._presenceDays || 0, p.days_active || 0);
  }

  for (const p of plan.rows) {
    const code = String(p.status_code || '').toLowerCase();
    if (!PLAN_ACTIVE.has(code)) continue;
    const row = fold(p.user_id, p.name, p.role);
    row.hasPlan = true;
    if (p.d) row.days.add(p.d);
  }

  for (const a of audit.rows) {
    const row = fold(a.user_id, a.name, a.role);
    row.actions += a.actions || 0;
    // дни из audit не добавляем — только счётчик действий
  }

  for (const l of logins.rows) {
    const row = fold(l.user_id, l.name, l.role);
    row.hasLogin = true;
    if (l.d) row.days.add(l.d);
  }

  // добрать имена для тех, кто попал только через fold без name
  const ids = [...byUser.keys()];
  if (ids.length) {
    const names = await db.query(
      `SELECT id, name, role FROM users WHERE id = ANY($1::int[])`,
      [ids]
    ).catch(() => ({ rows: [] }));
    for (const u of names.rows) {
      const row = byUser.get(u.id);
      if (!row) continue;
      if (!row.name) row.name = u.name;
      if (!row.role || row.role === 'ADMIN') row.role = u.role;
    }
  }

  const hasAnyPresence = presence.rows.length > 0;
  const people = [...byUser.values()]
    .filter((p) => {
      if (p.role === 'ADMIN') return false;
      // В письме только реальный сигнал: пульс / график / логин (не audit-only).
      return p.hasPresence || p.hasPlan || p.hasLogin;
    })
    .map((p) => ({
      user_id: p.user_id,
      name: p.name || ('#' + p.user_id),
      role: p.role,
      visits: Math.max(p.days.size, p._presenceDays || 0),
      hours: hasAnyPresence && p.hasPresence ? Math.round((p.hours || 0) * 10) / 10 : null,
      actions: p.actions
    }))
    .sort((a, b) => {
      const ha = a.hours != null ? a.hours : -1;
      const hb = b.hours != null ? b.hours : -1;
      return hb - ha || b.visits - a.visits || String(a.name).localeCompare(String(b.name), 'ru');
    });

  return {
    people,
    tracked: hasAnyPresence,
    note: hasAnyPresence
      ? 'Часы — по пульсу открытой вкладки CRM. Дни — график офиса, логин и пульс (фоновые API без входа не считаются).'
      : 'Дни — по графику офиса и логину. С 07.09 в журнал пишутся все сохранения и изменения в CRM; точные часы — с 8 сентября.'
  };
}

module.exports = {
  buildWeeklyDigest,
  resolveWeekRange,
  COL_LABELS,
  esc,
  isoDate,
  addDaysIso,
  loadToActivity,
  loadCrmActivity,
  loadNextDuty
};
