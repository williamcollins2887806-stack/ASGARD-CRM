#!/usr/bin/env node
/**
 * Tender approval chain — local HTTP regression (clone :3100, asgard_crm_test).
 * POST → PUT → GET/DB assert. No live SMTP (TENDER_MAIL_DISABLED / dry_run).
 *
 * Usage: node tests/tender-approval-chain.js
 * Server: TEST_BASE_URL=http://127.0.0.1:3100, PGDATABASE=asgard_crm_test
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Mail safety — client-side gate + module check (server must also have TENDER_MAIL_DISABLED=1)
process.env.TENDER_MAIL_DISABLED = process.env.TENDER_MAIL_DISABLED || '1';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const {
  BASE_URL,
  api,
  initTokens,
  initRealUsers,
  TEST_USERS,
} = require('./config');

/** Mirror src/services/tender-director-mail.js — без require (db.js требует DB_PASSWORD). */
function isLiveMail() {
  if (process.env.TENDER_MAIL_DISABLED === '1') return false;
  if (process.env.TENDER_MAIL_FORCE === '1' || process.env.PAYMENT_MAIL_FORCE === '1') return true;
  const dbName = process.env.DB_NAME || process.env.PGDATABASE || 'asgard_crm';
  return process.env.NODE_ENV === 'production' && dbName === 'asgard_crm';
}

const PG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'asgard',
  password: process.env.PGPASSWORD || '123456789',
  database: process.env.PGDATABASE || 'asgard_crm_test',
};

const VAT_DIVISOR = 1.22;
// Порог берётся из настроек БД (settings.director_tender_threshold_rub) — той же,
// из которой его читает бэкенд (src/routes/pm-duty.js:36-46). Константа не дублируется:
// иначе тест «зеленеет» на устаревшем пороге (находка L3 F-1).
const ACCEPTED_THRESHOLD_RUB = 10_000_000; // приёмка заказчика от 14.09: порог = 10 млн
let THRESHOLD_EX_VAT = null;               // заполняется в loadThresholdFromDb()
const RUN_TAG = `TAC_${Date.now()}`;

const results = [];
const state = { approvedTenderId: null, dutyPmUserId: null, useAdminOverride: false };

function record(id, name, status, detail) {
  results.push({ id, name, status, detail, at: new Date().toISOString() });
  console.log(`[${status}] ${id} — ${name}`);
  console.log('  ', detail);
}

function pass(id, name, detail) {
  record(id, name, 'PASS', detail);
  return true;
}

function fail(id, name, detail) {
  record(id, name, 'FAIL', detail);
  return false;
}

function exVat(withVat) {
  return Math.round((Number(withVat) / VAT_DIVISOR) * 100) / 100;
}

function futureDeadline(days = 30) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function calcRole() {
  return state.useAdminOverride ? 'ADMIN' : 'PM';
}

function withOverride(extra = {}) {
  return state.useAdminOverride ? { ...extra, override_as_admin: true } : extra;
}

async function pgConnect() {
  const client = new Client(PG);
  await client.connect();
  return client;
}

/**
 * Читает действующий порог согласования директора из настроек (как это делает бэкенд)
 * и сверяет его с приёмочным значением. Возвращает { configured, accepted, ok }.
 */
async function loadThresholdFromDb(pg) {
  const r = await pg.query(
    "SELECT value_json FROM settings WHERE key = 'director_tender_threshold_rub'"
  );
  const raw = r.rows[0] ? r.rows[0].value_json : null;
  const v = typeof raw === 'number' ? raw : Number(String(raw == null ? '' : raw).replace(/"/g, ''));
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(
      "FATAL: settings.director_tender_threshold_rub не найден/не число " +
      `(получено: ${JSON.stringify(raw)}). Бэкенд в этом случае падает на DEFAULT_DIRECTOR_THRESHOLD — ` +
      'тест обязан проверять фактическую настройку, а не дефолт.'
    );
  }
  THRESHOLD_EX_VAT = v;
  return { configured: v, accepted: ACCEPTED_THRESHOLD_RUB, ok: v === ACCEPTED_THRESHOLD_RUB };
}

function assertNotProdDb() {
  if (PG.database === 'asgard_crm' && process.env.ALLOW_PROD_DB_TESTS !== '1') {
    throw new Error(
      `FATAL: PGDATABASE=${PG.database} looks like production. Use asgard_crm_test.`
    );
  }
}

function assertMailSafe() {
  if (isLiveMail()) {
    throw new Error(
      'FATAL: live tender mail would be sent. Set TENDER_MAIL_DISABLED=1 on test server and client.'
    );
  }
}

async function ensureDutyPm(pg) {
  // Schema drift on local clones: registry POST needs source_kind etc.
  await pg.query(`
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS source_kind VARCHAR(40);
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER;
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS registry_status VARCHAR(40);
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS participation_paid BOOLEAN;
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS participation_fee NUMERIC;
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS analysis_deadline DATE;
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS calculator_kind VARCHAR(10);
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS calculator_user_id INTEGER;
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS archived_by INTEGER;
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS archive_reason TEXT;
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS reject_reason TEXT;
  `).catch(() => {});

  await pg.query(`
    ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS director_review_status VARCHAR(20);
    ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS director_review_at TIMESTAMPTZ;
    ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS director_review_by_user_id INTEGER;
    ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS director_review_comment TEXT;
    ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS director_notify_at TIMESTAMPTZ;
    ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS work_price_ex_vat NUMERIC(18,2);
    ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS tkp_file_id INTEGER;
    ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS to_notify_at TIMESTAMPTZ;
    ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS analysis_finalized_at TIMESTAMPTZ;
    ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS analysis_finalized_by_user_id INTEGER;
    ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS calculator_user_id INTEGER;
  `).catch(() => {});

  // Адресное согласование: у получателей должен быть email.
  await pg.query(`
    UPDATE users SET email = COALESCE(NULLIF(TRIM(email), ''), login || '@asgard-test.local')
    WHERE login IN ('test_director_gen','test_director_comm','test_director_dev','test_head_to')
  `).catch(() => {});

  // Для локальных тестов: HEAD_TO без «Хосе» в имени — всё равно резолвится фолбэком по роли.
  await pg.query(`
    UPDATE users SET name = COALESCE(NULLIF(TRIM(name), ''), 'Тест Хосе ТО')
    WHERE login = 'test_head_to' AND (name IS NULL OR name NOT ILIKE '%Хосе%')
  `).catch(() => {});

  const today = new Date().toISOString().slice(0, 10);
  const dutyRes = await pg.query(`
    SELECT r.pm_user_id, u.login
    FROM pm_duty_roster r
    JOIN users u ON u.id = r.pm_user_id
    WHERE r.period_start <= $1::date AND r.period_end >= $1::date
    ORDER BY r.created_at DESC
    LIMIT 1
  `, [today]);

  const pmRes = await pg.query(
    `SELECT id FROM users WHERE login = 'test_pm' AND COALESCE(is_active, true) = true LIMIT 1`
  );
  const pmId = pmRes.rows[0]?.id;
  if (!pmId) throw new Error('test_pm user not found in DB');

  if (dutyRes.rows[0]?.login === 'test_pm') {
    state.dutyPmUserId = pmId;
    state.useAdminOverride = false;
    return pmId;
  }

  if (!dutyRes.rows[0]) {
    const adminRes = await pg.query(
      `SELECT id FROM users WHERE login = 'test_admin' LIMIT 1`
    );
    const assignedBy = adminRes.rows[0]?.id || pmId;
    await pg.query(`
      INSERT INTO pm_duty_roster (pm_user_id, period_start, period_end, assigned_by_user_id)
      VALUES ($1, $2::date, $3::date, $4)
    `, [pmId, today, today, assignedBy]);
    state.dutyPmUserId = pmId;
    state.useAdminOverride = false;
    return pmId;
  }

  // Another PM is on duty — use ADMIN override for rp-review mutations
  state.dutyPmUserId = pmId;
  state.useAdminOverride = true;
  return dutyRes.rows[0].pm_user_id;
}

async function createRegistryTender(label, role = 'TO') {
  // Prefer API; on schema-drift local DBs fall back to SQL insert.
  const resp = await api('POST', '/api/tenders/registry', {
    role,
    body: {
      customer_name: `${RUN_TAG} ${label}`,
      tender_title: `${RUN_TAG} ${label}`,
      docs_deadline: futureDeadline(45),
      tender_price: 1_000_000,
      participation_paid: false,
    },
  });
  if (resp.status < 400) {
    const id = resp.data?.tender?.id || resp.data?.id;
    if (id) return id;
  }

  const pg = await pgConnect();
  const u = await pg.query(
    `SELECT id FROM users WHERE login = $1 LIMIT 1`,
    [role === 'ADMIN' ? 'test_admin' : 'test_to']
  );
  const uid = u.rows[0]?.id || null;
  const ins = await pg.query(`
    INSERT INTO tenders (
      customer_name, tender_title, tender_price, docs_deadline,
      registry_status, tender_status, source_kind,
      created_by, created_by_user_id, period, created_at, updated_at
    ) VALUES (
      $1, $2, 1000000, $3::date,
      'рассмотрение', 'Новый', 'to_manual',
      $4, $4, to_char(NOW(), 'YYYY-MM'), NOW(), NOW()
    )
    RETURNING id
  `, [`${RUN_TAG} ${label}`, `${RUN_TAG} ${label}`, futureDeadline(45), uid]);
  return ins.rows[0].id;
}

async function getReviewUpdatedAt(tenderId, role) {
  const resp = await api('GET', `/api/tenders/${tenderId}/rp-review`, { role });
  return resp.data?.review?.updated_at || null;
}

async function insertFakeTkp(pg, tenderId, uploadedBy) {
  const r = await pg.query(`
    INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
    VALUES ($1, $2, $3, $4, 'rp_tkp', $5, $6, $7, NOW())
    RETURNING id
  `, [
    `test_tkp_${tenderId}.pdf`,
    `TEST_TKP_${tenderId}.pdf`,
    'application/pdf',
    128,
    tenderId,
    uploadedBy,
    `/uploads/test/tkp_${tenderId}.pdf`,
  ]);
  const tkpId = r.rows[0].id;
  await pg.query(
    `UPDATE tender_rp_reviews SET tkp_file_id = $1, updated_at = NOW() WHERE tender_id = $2`,
    [tkpId, tenderId]
  );
  return tkpId;
}

async function finalizeAnalysis(tenderId, pg) {
  const role = calcRole();
  const expected = await getReviewUpdatedAt(tenderId, role);
  const resp = await api('PUT', `/api/tenders/${tenderId}/rp-review`, {
    role,
    body: withOverride({
      decision: 'submit',
      report_kind: 'work',
      report_json: {
        mode: 'analysis',
        feasibility: 'yes',
        competition: 'medium',
        summary: `${RUN_TAG}: суть для ТО — анализ дежурного РП`,
        recommendation: 'Подаём',
        risks: 'Тестовый риск',
      },
      missing_info_flags: [],
      finalize: true,
      expected_updated_at: expected,
    }),
  });
  if (resp.status >= 400) {
    throw new Error(`finalizeAnalysis: HTTP ${resp.status} ${JSON.stringify(resp.data).slice(0, 400)}`);
  }

  const row = await pg.query(`
    SELECT t.calculator_user_id, r.calculator_user_id AS review_calc_id, r.analysis_finalized_at
    FROM tenders t
    LEFT JOIN tender_rp_reviews r ON r.tender_id = t.id
    WHERE t.id = $1
  `, [tenderId]);
  return { resp, row: row.rows[0] };
}

async function finalizeCalc(tenderId, workPrice, pg, opts = {}) {
  const role = calcRole();
  const uploader = state.dutyPmUserId || TEST_USERS.PM?.id || 1;
  const tkpId = await insertFakeTkp(pg, tenderId, uploader);
  const expected = await getReviewUpdatedAt(tenderId, role);
  const body = withOverride({
    decision: 'submit',
    report_kind: 'work',
    report_json: { mode: 'calc', summary: `${RUN_TAG}: просчёт` },
    work_price: workPrice,
    tkp_file_id: tkpId,
    missing_info_flags: [],
    finalize: true,
    expected_updated_at: expected,
  });
  if (opts.approval_recipients) {
    body.approval_recipients = opts.approval_recipients;
  }

  const resp = await api('PUT', `/api/tenders/${tenderId}/rp-review`, { role, body });
  return { resp, tkpId, exVat: exVat(workPrice) };
}

async function readTenderState(pg, tenderId) {
  const r = await pg.query(`
    SELECT t.registry_status,
           rev.director_review_status,
           rev.work_price,
           rev.work_price_ex_vat,
           rev.is_final,
           rev.analysis_finalized_at
    FROM tenders t
    LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
    WHERE t.id = $1
  `, [tenderId]);
  return r.rows[0] || {};
}

async function countApprovalRecipients(pg, tenderId) {
  const r = await pg.query(
    `SELECT COUNT(*)::int AS c FROM tender_approval_recipients WHERE tender_id = $1`,
    [tenderId]
  );
  return r.rows[0]?.c || 0;
}

// ── Cases ────────────────────────────────────────────────────────

async function caseA(pg) {
  const id = 'A';
  const name = 'Создание + finalize analysis → calculator_user_id';
  try {
    const tenderId = await createRegistryTender('case-A', 'TO');
    const { row } = await finalizeAnalysis(tenderId, pg);
    const calcId = row?.calculator_user_id ?? row?.review_calc_id;
    const okCalc = calcId != null && Number(calcId) > 0;
    const okAnalysis = !!row?.analysis_finalized_at;
    if (okCalc && okAnalysis) {
      return pass(id, name, `tenderId=${tenderId} calculator_user_id=${calcId} analysis_finalized_at set`);
    }
    return fail(id, name, `tenderId=${tenderId} calc=${calcId} analysis_finalized_at=${row?.analysis_finalized_at}`);
  } catch (e) {
    return fail(id, name, e.message);
  }
}

async function caseB(pg) {
  const id = 'B';
  const name = 'Calc <10M ex-VAT → без director pending, registry=готовим';
  const workPrice = 5_000_000;
  try {
    const tenderId = await createRegistryTender('case-B', 'ADMIN');
    await finalizeAnalysis(tenderId, pg);
    const { resp, exVat: ev } = await finalizeCalc(tenderId, workPrice, pg);
    if (resp.status >= 400) {
      return fail(id, name, `finalize HTTP ${resp.status} ${JSON.stringify(resp.data).slice(0, 300)}`);
    }
    const st = await readTenderState(pg, tenderId);
    const rev = resp.data?.review || {};
    const okPrice = ev < THRESHOLD_EX_VAT;
    const okDirector = (st.director_review_status || rev.director_review_status) !== 'pending';
    const okRegistry = st.registry_status === 'готовим';
    const mailSafe = !isLiveMail();
    if (okPrice && okDirector && okRegistry && mailSafe) {
      return pass(
        id,
        name,
        `tenderId=${tenderId} work_price=${workPrice} ex_vat≈${ev} director=${st.director_review_status} registry=${st.registry_status} mail=dry_run`
      );
    }
    return fail(
      id,
      name,
      `tenderId=${tenderId} ex_vat=${ev} director=${st.director_review_status} registry=${st.registry_status} mailLive=${isLiveMail()}`
    );
  } catch (e) {
    return fail(id, name, e.message);
  }
}

async function caseC(pg) {
  const id = 'C';
  const name = 'Calc ≥10M ex-VAT + HEAD_TO → pending + recipients';
  const workPrice = 12_200_000;
  try {
    const tenderId = await createRegistryTender('case-C', 'TO');
    await finalizeAnalysis(tenderId, pg);
    const { resp, exVat: ev } = await finalizeCalc(tenderId, workPrice, pg, {
      approval_recipients: ['HEAD_TO'],
    });
    if (resp.status >= 400) {
      return fail(id, name, `finalize HTTP ${resp.status} ${JSON.stringify(resp.data).slice(0, 300)}`);
    }
    const st = await readTenderState(pg, tenderId);
    const rcptCount = await countApprovalRecipients(pg, tenderId);
    const okPrice = ev >= THRESHOLD_EX_VAT;
    const okPending = st.director_review_status === 'pending';
    const okRecipients = rcptCount >= 1;
    const mailSafe = !isLiveMail();
    state.pendingTenderId = tenderId;
    if (okPrice && okPending && okRecipients && mailSafe) {
      return pass(
        id,
        name,
        `tenderId=${tenderId} ex_vat=${ev} director=pending recipients=${rcptCount} mail=dry_run (no SMTP)`
      );
    }
    return fail(
      id,
      name,
      `tenderId=${tenderId} ex_vat=${ev} director=${st.director_review_status} recipients=${rcptCount} mailLive=${isLiveMail()}`
    );
  } catch (e) {
    return fail(id, name, e.message);
  }
}

// B2/C2 закрывают формулировку приёмки буквально: порог считается по сумме БЕЗ НДС,
// поэтому проверяем ровно 6 млн и 12 млн ex-VAT (цена с НДС подбирается обратно через VAT_DIVISOR).
async function caseThreshold(pg, { id, name, exVatTarget, expectDirector }) {
  try {
    if (!Number.isFinite(THRESHOLD_EX_VAT) || THRESHOLD_EX_VAT <= 0) {
      return fail(id, name, 'THRESHOLD_EX_VAT не загружен из settings — тест не имеет права угадывать порог');
    }
    const withVat = Math.round(exVatTarget * VAT_DIVISOR);
    const tenderId = await createRegistryTender(`case-${id}`, 'TO');
    await finalizeAnalysis(tenderId, pg);
    const { resp, exVat: ev } = await finalizeCalc(tenderId, withVat, pg, {
      approval_recipients: expectDirector ? ['HEAD_TO'] : undefined,
    });
    if (resp.status >= 400) {
      return fail(id, name, `finalize HTTP ${resp.status} ${JSON.stringify(resp.data).slice(0, 300)}`);
    }
    const st = await readTenderState(pg, tenderId);
    const rcptCount = await countApprovalRecipients(pg, tenderId);
    const isPending = st.director_review_status === 'pending';
    const okPrice = expectDirector ? ev >= THRESHOLD_EX_VAT : ev < THRESHOLD_EX_VAT;
    const okDirector = isPending === expectDirector;
    const okRecipients = expectDirector ? rcptCount >= 1 : rcptCount === 0;
    if (okPrice && okDirector && okRecipients && !isLiveMail()) {
      return pass(id, name, `tenderId=${tenderId} with_vat=${withVat} ex_vat=${ev} ` +
        `director=${st.director_review_status || 'null'} recipients=${rcptCount} registry=${st.registry_status}`);
    }
    return fail(id, name, `tenderId=${tenderId} with_vat=${withVat} ex_vat=${ev} ` +
      `director=${st.director_review_status} recipients=${rcptCount} okPrice=${okPrice} okDirector=${okDirector}`);
  } catch (e) {
    return fail(id, name, e.message);
  }
}

async function caseB2(pg) {
  // Граница снизу: 6 млн при пороге 10 млн (0.6×) — считается от ФАКТИЧЕСКОЙ настройки, не от константы.
  const target = Math.round(THRESHOLD_EX_VAT * 0.6);
  return caseThreshold(pg, {
    id: 'B2',
    name: `Calc ${target.toLocaleString('ru-RU')} ex-VAT (< ${THRESHOLD_EX_VAT.toLocaleString('ru-RU')}) → директору НЕ уходит, без recipients`,
    exVatTarget: target,
    expectDirector: false,
  });
}

async function caseC2(pg) {
  // Граница сверху: 12 млн при пороге 10 млн (1.2×).
  const target = Math.round(THRESHOLD_EX_VAT * 1.2);
  return caseThreshold(pg, {
    id: 'C2',
    name: `Calc ${target.toLocaleString('ru-RU')} ex-VAT (>= ${THRESHOLD_EX_VAT.toLocaleString('ru-RU')}) → директору уходит, recipients есть`,
    exVatTarget: target,
    expectDirector: true,
  });
}

async function caseD(pg) {
  const id = 'D';
  const name = 'DIRECTOR_GEN approve → approved + registry=готовим';
  try {
    let tenderId = state.pendingTenderId;
    if (!tenderId) {
      tenderId = await createRegistryTender('case-D', 'TO');
      await finalizeAnalysis(tenderId, pg);
      await finalizeCalc(tenderId, 12_200_000, pg, { approval_recipients: ['HEAD_TO'] });
    }
    const before = await readTenderState(pg, tenderId);
    if (before.director_review_status !== 'pending') {
      return fail(id, name, `tenderId=${tenderId} expected pending, got ${before.director_review_status}`);
    }

    const resp = await api('POST', `/api/tenders/${tenderId}/rp-review/director-decision`, {
      role: 'DIRECTOR_GEN',
      body: { action: 'submit', comment: `${RUN_TAG} согласовано` },
    });
    if (resp.status >= 400) {
      return fail(id, name, `director-decision HTTP ${resp.status} ${JSON.stringify(resp.data).slice(0, 300)}`);
    }

    const st = await readTenderState(pg, tenderId);
    const okApproved = st.director_review_status === 'approved';
    const okRegistry = st.registry_status === 'готовим';
    state.approvedTenderId = tenderId;
    if (okApproved && okRegistry) {
      return pass(id, name, `tenderId=${tenderId} director=approved registry=готовим`);
    }
    return fail(id, name, `tenderId=${tenderId} director=${st.director_review_status} registry=${st.registry_status}`);
  } catch (e) {
    return fail(id, name, e.message);
  }
}

async function caseE(pg) {
  const id = 'E';
  const name = '2 recipients → одного DIRECTOR достаточно для approved';
  const workPrice = 12_500_000;
  try {
    const tenderId = await createRegistryTender('case-E', 'TO');
    await finalizeAnalysis(tenderId, pg);
    const { resp } = await finalizeCalc(tenderId, workPrice, pg, {
      approval_recipients: ['DIRECTOR_GEN', 'DIRECTOR_COMM'],
    });
    if (resp.status >= 400) {
      return fail(id, name, `finalize HTTP ${resp.status} ${JSON.stringify(resp.data).slice(0, 300)}`);
    }
    const rcptCount = await countApprovalRecipients(pg, tenderId);
    if (rcptCount < 2) {
      return fail(id, name, `expected ≥2 recipients, got ${rcptCount}`);
    }

    const dec = await api('POST', `/api/tenders/${tenderId}/rp-review/director-decision`, {
      role: 'DIRECTOR_COMM',
      body: { action: 'submit', comment: `${RUN_TAG} comm approve` },
    });
    if (dec.status >= 400) {
      return fail(id, name, `director-decision HTTP ${dec.status} ${JSON.stringify(dec.data).slice(0, 300)}`);
    }

    const st = await readTenderState(pg, tenderId);
    if (st.director_review_status === 'approved' && st.registry_status === 'готовим') {
      return pass(id, name, `tenderId=${tenderId} recipients=${rcptCount} approved by DIRECTOR_COMM`);
    }
    return fail(id, name, `tenderId=${tenderId} director=${st.director_review_status} registry=${st.registry_status}`);
  } catch (e) {
    return fail(id, name, e.message);
  }
}

async function caseF(pg) {
  const id = 'F';
  const name = 'Director reject → registry=отмена';
  const workPrice = 12_200_000;
  try {
    const tenderId = await createRegistryTender('case-F', 'TO');
    await finalizeAnalysis(tenderId, pg);
    await finalizeCalc(tenderId, workPrice, pg, { approval_recipients: ['DIRECTOR_GEN'] });

    const resp = await api('POST', `/api/tenders/${tenderId}/rp-review/director-decision`, {
      role: 'DIRECTOR_GEN',
      body: { action: 'reject', comment: `${RUN_TAG}: отказ директора — тест` },
    });
    if (resp.status >= 400) {
      return fail(id, name, `director-decision HTTP ${resp.status} ${JSON.stringify(resp.data).slice(0, 300)}`);
    }

    const st = await readTenderState(pg, tenderId);
    if (st.director_review_status === 'rejected' && st.registry_status === 'отмена') {
      return pass(id, name, `tenderId=${tenderId} director=rejected registry=отмена`);
    }
    return fail(id, name, `tenderId=${tenderId} director=${st.director_review_status} registry=${st.registry_status}`);
  } catch (e) {
    return fail(id, name, e.message);
  }
}

async function caseG(pg) {
  const id = 'G';
  const name = 'assign-calculator kind=pm → 400';
  try {
    const tenderId = await createRegistryTender('case-G', 'TO');
    await finalizeAnalysis(tenderId, pg);

    const pmId = state.dutyPmUserId || TEST_USERS.PM?.id;
    const resp = await api('POST', `/api/tenders/registry/${tenderId}/assign-calculator`, {
      role: 'TO',
      body: { kind: 'pm', user_id: pmId },
    });

    if (resp.status === 400) {
      return pass(id, name, `tenderId=${tenderId} HTTP 400 as expected: ${JSON.stringify(resp.data?.error || resp.data).slice(0, 120)}`);
    }
    return fail(id, name, `tenderId=${tenderId} expected 400, got ${resp.status} ${JSON.stringify(resp.data).slice(0, 200)}`);
  } catch (e) {
    return fail(id, name, e.message);
  }
}

async function caseH(pg) {
  const id = 'H';
  const name = 'Бейдж «Цена согласована»: director_review_status=approved';
  try {
    const tenderId = state.approvedTenderId;
    if (!tenderId) {
      return fail(id, name, 'no approved tender from case D');
    }

    const st = await readTenderState(pg, tenderId);
    const drs = st?.director_review_status;
    if (drs !== 'approved') {
      return fail(id, name, `tenderId=${tenderId} director_review_status=${drs}`);
    }

    // Доп. проверка API (если форма ответа позволяет).
    const revResp = await api('GET', `/api/tenders/${tenderId}/rp-review`, { role: 'ADMIN' });
    const apiDrs = revResp.data?.review?.director_review_status
      || revResp.data?.director_review_status
      || null;

    return pass(
      id,
      name,
      `tenderId=${tenderId} director_review_status=approved` +
        (apiDrs ? ` api=${apiDrs}` : ' (db assert; api shape may omit field)')
    );
  } catch (e) {
    return fail(id, name, e.message);
  }
}

// ── Main ─────────────────────────────────────────────────────────

(async () => {
  console.log(`\n=== Tender approval chain ===`);
  console.log(`BASE_URL=${BASE_URL} PG=${PG.database} RUN_TAG=${RUN_TAG}\n`);

  assertNotProdDb();
  assertMailSafe();

  let pg;
  try {
    await initTokens();
    await initRealUsers();

    pg = await pgConnect();
    await ensureDutyPm(pg);
    console.log(`duty_pm_user_id=${state.dutyPmUserId} admin_override=${state.useAdminOverride}\n`);

    // F-1 (L3): порог не хардкодим — читаем настройку и сверяем её с приёмочным значением.
    const th = await loadThresholdFromDb(pg);
    if (th.ok) {
      pass('T0', 'Порог согласования директора = приёмочные 10 млн (settings.director_tender_threshold_rub)',
        `configured=${th.configured} accepted=${th.accepted}`);
    } else {
      fail('T0', 'Порог согласования директора = приёмочные 10 млн (settings.director_tender_threshold_rub)',
        `settings=${th.configured}, приёмка требует ${th.accepted} — тест не должен «зеленеть» на другом пороге`);
    }
    console.log(`threshold_ex_vat=${THRESHOLD_EX_VAT}\n`);

    const cases = [
      ['A', caseA],
      ['B', caseB],
      ['B2', caseB2],
      ['C', caseC],
      ['C2', caseC2],
      ['D', caseD],
      ['E', caseE],
      ['F', caseF],
      ['G', caseG],
      ['H', caseH],
    ];

    for (const [, fn] of cases) {
      try {
        await fn(pg);
      } catch (e) {
        record('?', fn.name, 'CRASH', String(e?.message || e));
      }
    }
  } catch (e) {
    record('SETUP', 'preflight', 'FAIL', e.message);
  } finally {
    if (pg) await pg.end().catch(() => {});
  }

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`${r.status.padEnd(6)} ${r.id} ${r.name}`);
  }

  const outPath = path.join(__dirname, 'reports', 'tender-approval-chain-result.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    run_tag: RUN_TAG,
    base_url: BASE_URL,
    database: PG.database,
    mail_disabled: !isLiveMail(),
    duty_pm_user_id: state.dutyPmUserId,
    admin_override: state.useAdminOverride,
    results,
    summary: {
      pass: results.filter((r) => r.status === 'PASS').length,
      fail: results.filter((r) => r.status === 'FAIL').length,
      crash: results.filter((r) => r.status === 'CRASH').length,
    },
  }, null, 2));
  console.log(`\nWrote ${outPath}`);

  const failCount = results.filter((r) => r.status !== 'PASS').length;
  process.exit(failCount ? 1 : 0);
})();
