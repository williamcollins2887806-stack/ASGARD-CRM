/**
 * Sentinel: closeout roster + pm-analysis-rating pool/loyalty + duty gantt invariants.
 * Run: node tests/sentinel_closeout_rating_duty.js
 * DB: asgard_crm_test (fallback asgard_crm)
 */
'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const { computeUserRating } = require('../src/services/pm-analysis-rating');

const results = [];
function pass(id, detail) { results.push({ id, ok: true, detail }); console.log('PASS', id, detail || ''); }
function fail(id, detail) { results.push({ id, ok: false, detail }); console.log('FAIL', id, detail || ''); }

async function openPool() {
  for (const database of ['asgard_crm_test', 'asgard_crm']) {
    const pool = new Pool({
      user: process.env.DB_USER || 'asgard',
      password: process.env.DB_PASSWORD || '123456789',
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      database,
      connectionTimeoutMillis: 4000
    });
    try {
      await pool.query('SELECT 1');
      console.log('DB', database);
      return pool;
    } catch (e) {
      await pool.end().catch(() => {});
      console.log('skip', database, e.message);
    }
  }
  throw new Error('No DB available');
}

function readSrc(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function assertSrc(id, rel, needles) {
  const src = readSrc(rel);
  const missing = needles.filter((n) => !src.includes(n));
  if (missing.length) fail(id, rel + ' missing: ' + missing.join(' | '));
  else pass(id, rel);
}

async function main() {
  // ── Static parity / UI invariants ───────────────────────────────────────
  assertSrc('SRC_ROSTER_UNION', 'public/assets/js/pm_works.js', [
    'crew-all',
    'rosterEmployeeIds',
    'btnRateCrew',
    "LEGACY_DONE_STATUSES"
  ]);
  assertSrc('SRC_CLOSEOUT_API', 'src/routes/works.js', [
    "'Завершена':        ['Подписание акта']",
    'LEGACY_DONE',
    '!work.closeout_submitted_at'
  ]);
  assertSrc('SRC_V2_CLOSEOUT', 'public/desktop-v2-src/src/pages/PmWorks/modals/CloseoutWizard.jsx', [
    'loadCrewAll',
    'ratingsOnly',
    'loadRatingCrew'
  ]);
  assertSrc('SRC_RATING_POOL', 'src/services/pm-analysis-rating.js', [
    'только МОИ карточки',
    'BONUS.volume',
    'scareQueue',
    'finalized_by_user_id'
  ]);
  assertSrc('SRC_DUTY_GANTT', 'public/assets/js/pm_duty.js', [
    'intersectsViewport',
    'byPm',
    'рейтинг · ',
    'Europe/Moscow',
    'is_duty'
  ]);
  assertSrc('SRC_CURRENT_IS_DUTY', 'src/routes/pm-duty.js', [
    'is_duty: isDuty',
    'Number(duty.pm_user_id) === uid'
  ]);

  // Gantt logic unit (no DOM): group + no ghost dots outside viewport
  {
    const now = '2026-10-02';
    const viewStart = '2026-09-29';
    const viewEnd = '2026-10-23';
    const items = [
      { pm_user_id: 1, pm_name: 'Андросов', period_start: '2026-07-07', period_end: '2026-07-12' },
      { pm_user_id: 1, pm_name: 'Андросов', period_start: '2026-10-01', period_end: '2026-10-14' },
      { pm_user_id: 1, pm_name: 'Андросов', period_start: '2026-08-31', period_end: '2026-09-04' },
      { pm_user_id: 2, pm_name: 'Путков', period_start: '2026-10-05', period_end: '2026-10-10' }
    ];
    const visible = items.filter((r) => {
      const a = r.period_start;
      const b = r.period_end;
      return a <= viewEnd && b >= viewStart;
    });
    const byPm = new Set(visible.map((r) => r.pm_user_id));
    if (visible.length !== 2) fail('GANTT_FILTER', 'expected 2 visible periods, got ' + visible.length);
    else pass('GANTT_FILTER', 'visible=' + visible.length);
    if (byPm.size !== 2) fail('GANTT_GROUP', 'expected 2 PMs, got ' + byPm.size);
    else pass('GANTT_GROUP', 'pms=' + byPm.size);
    // july/aug must be filtered
    if (visible.some((r) => r.period_start.startsWith('2026-07') || r.period_start.startsWith('2026-08'))) {
      fail('GANTT_NO_GHOST', 'july/aug still visible');
    } else pass('GANTT_NO_GHOST', 'out-of-window filtered @' + now);
  }

  const pool = await openPool();
  try {
    // Closeout: legacy Завершена works without closeout_submitted_at
    const legacy = await pool.query(`
      SELECT id, work_status, closeout_submitted_at
      FROM works
      WHERE work_status IN ('Завершена','Завершено','Завершен','Завершён','Закрыта','Сдана','Сдан')
        AND closeout_submitted_at IS NULL
      ORDER BY id
      LIMIT 5
    `);
    pass('CLOSEOUT_LEGACY_ROWS', 'count=' + legacy.rows.length +
      (legacy.rows[0] ? (' sample=#' + legacy.rows[0].id) : ''));

    // Rating: find a PM with duty roster history (prefer Androsov)
    const pmQ = await pool.query(`
      SELECT u.id, u.name
      FROM users u
      WHERE COALESCE(u.is_active, true) = true
        AND (
          u.name ILIKE '%Андросов%'
          OR EXISTS (SELECT 1 FROM pm_duty_roster d WHERE d.pm_user_id = u.id)
        )
      ORDER BY CASE WHEN u.name ILIKE '%Андросов%' THEN 0 ELSE 1 END, u.id
      LIMIT 1
    `);
    if (!pmQ.rows[0]) {
      fail('RATING_PM', 'no PM found');
    } else {
      const uid = pmQ.rows[0].id;
      pass('RATING_PM', pmQ.rows[0].name + ' #' + uid);

      const d30 = await computeUserRating(pool, uid, 'd30', new Date());
      const duty = await computeUserRating(pool, uid, 'duty', new Date());

      if (d30.empty) {
        pass('RATING_D30_EMPTY_OK', 'empty payload flagged');
      } else {
        const poolSize = d30.components.take.pool;
        const taken = d30.components.take.taken;
        const done = d30.components.completion.done;
        // Loyalty: pool must not explode to whole company backlog (soft check)
        if (poolSize > 500) fail('RATING_POOL_CAP', 'pool too large: ' + poolSize);
        else pass('RATING_POOL_CAP', 'pool=' + poolSize + ' taken=' + taken + ' done=' + done);

        if (d30.bonuses && d30.bonuses.volume && typeof d30.bonuses.volume.points === 'number') {
          pass('RATING_VOLUME_BONUS', 'points=' + d30.bonuses.volume.points + ' count=' + d30.bonuses.volume.count);
        } else fail('RATING_VOLUME_BONUS', 'missing volume bonus');

        const scare = (d30.recommendations || []).some((x) => /неразобранн/i.test(x) && /очеред/i.test(x));
        // Off-duty d30 should not scare with duty queue backlog wording unless currently on duty
        const onDuty = await pool.query(`
          SELECT 1 FROM pm_duty_roster
          WHERE pm_user_id = $1 AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE
          LIMIT 1
        `, [uid]);
        if (!onDuty.rows[0] && scare && /дежурства/i.test((d30.recommendations || []).join(' '))) {
          fail('RATING_NO_SCARE', 'off-duty d30 still scares with duty queue');
        } else {
          pass('RATING_NO_SCARE', onDuty.rows[0] ? 'on duty — scare ok' : 'off duty — no duty scare');
        }

        pass('RATING_D30_SCORE', 'grade=' + d30.grade + ' score=' + d30.score +
          ' window=' + d30.period_start + '..' + d30.period_end);
      }

      if (duty.empty) {
        pass('RATING_DUTY_EMPTY', 'empty duty flagged (UI must not show E/0)');
      } else {
        pass('RATING_DUTY_SCORE', 'grade=' + duty.grade + ' score=' + duty.score +
          ' pool=' + duty.components.take.pool);
      }

      // Windows must differ in kind
      if (d30.window_kind !== 'd30') fail('RATING_WINDOW_KIND', d30.window_kind);
      else pass('RATING_WINDOW_KIND', 'd30 ok');
    }

    // Roster rows for gantt: duplicates by name are OK in DB, UI groups them
    const roster = await pool.query(`
      SELECT pm_user_id, COUNT(*)::int AS periods, MIN(u.name) AS name
      FROM pm_duty_roster r
      JOIN users u ON u.id = r.pm_user_id
      GROUP BY pm_user_id
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 3
    `);
    pass('ROSTER_MULTI_PERIODS', roster.rows.map((r) => r.name + '=' + r.periods).join('; ') || 'none');

    // Optional: crew-all endpoint shape exists in code (route)
    assertSrc('SRC_CREW_ALL_ROUTE', 'src/routes/worker-payments.js', ['crew-all']);
  } finally {
    await pool.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n=== SUMMARY', results.length - failed.length + '/' + results.length, '===');
  if (failed.length) {
    failed.forEach((f) => console.log('  FAIL', f.id, f.detail));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
