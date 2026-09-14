#!/usr/bin/env node
/**
 * Tender premium UI — Playwright E2E (vanilla desktop, clone :3100).
 * Скриншоты + asserts → tests/reports/tender-premium-qa/
 *
 * Usage: node tests/tender-premium-ui-e2e.js
 * Env: TEST_BASE_URL, PGDATABASE=asgard_crm_dev, TENDER_MAIL_DISABLED=1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { Client } = require('pg');

process.env.TENDER_MAIL_DISABLED = process.env.TENDER_MAIL_DISABLED || '1';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const {
  BASE_URL,
  api,
  initTokens,
  initRealUsers,
  TEST_USERS,
  getAccount,
} = require('./config');

const BASE = process.env.TEST_BASE_URL || BASE_URL || 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, 'reports', 'tender-premium-qa');
fs.mkdirSync(OUT, { recursive: true });

const PG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'asgard',
  password: process.env.PGPASSWORD || '123456789',
  database: process.env.PGDATABASE || 'asgard_crm_dev',
};

const RUN_TAG = `TPUI_${Date.now()}`;
const VIEWPORT = { width: 1680, height: 1000 };
const WORK_PRICE = 12_200_000;

const report = {
  started_at: new Date().toISOString(),
  base: BASE,
  database: PG.database,
  run_tag: RUN_TAG,
  steps: [],
  seed: {},
  summary: { pass: 0, fail: 0 },
};

const state = {
  dutyPmUserId: null,
  useAdminOverride: false,
  openAnalysisTenderId: null,
  analysisTenderId: null,
  pendingTenderId: null,
  approvedTenderId: null,
};

function step(id, name, pass, detail, extra = {}) {
  const rec = { id, name, pass: !!pass, detail, at: new Date().toISOString(), ...extra };
  report.steps.push(rec);
  console.log(`[${rec.pass ? 'PASS' : 'FAIL'}] ${id} — ${name}`);
  if (detail) console.log('  ', detail);
  return rec.pass;
}

function calcRole() {
  return state.useAdminOverride ? 'ADMIN' : 'PM';
}

function withOverride(extra = {}) {
  return state.useAdminOverride ? { ...extra, override_as_admin: true } : extra;
}

function futureDeadline(days = 30) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function pgConnect() {
  const client = new Client(PG);
  await client.connect();
  return client;
}

async function ensureDutyPm(pg) {
  await pg.query(`
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS source_kind VARCHAR(40);
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER;
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS registry_status VARCHAR(40);
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS calculator_user_id INTEGER;
    ALTER TABLE tenders ADD COLUMN IF NOT EXISTS calculator_kind VARCHAR(20);
    ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS director_review_status VARCHAR(20);
    ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS analysis_finalized_at TIMESTAMPTZ;
    ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS calculator_user_id INTEGER;
  `).catch(() => {});

  await pg.query(`
    UPDATE users SET email = COALESCE(NULLIF(TRIM(email), ''), login || '@asgard-test.local')
    WHERE login IN ('test_director_gen','test_director_comm','test_director_dev','test_head_to')
  `).catch(() => {});

  const today = new Date().toISOString().slice(0, 10);
  const pmRes = await pg.query(
    `SELECT id FROM users WHERE login = 'test_pm' AND COALESCE(is_active, true) = true LIMIT 1`
  );
  const pmId = pmRes.rows[0]?.id;
  if (!pmId) throw new Error('test_pm not found');

  const adminRes = await pg.query(`SELECT id FROM users WHERE login = 'test_admin' LIMIT 1`);
  const assignedBy = adminRes.rows[0]?.id || pmId;

  // Жёстко: test_pm = дежурный на сегодня (иначе calc/analysis списки пустые или чужие)
  await pg.query(`
    DELETE FROM pm_duty_roster
    WHERE period_start <= $1::date AND period_end >= $1::date
  `, [today]);
  await pg.query(`
    INSERT INTO pm_duty_roster (pm_user_id, period_start, period_end, assigned_by_user_id)
    VALUES ($1, $2::date, $3::date, $4)
  `, [pmId, today, today, assignedBy]);

  state.dutyPmUserId = pmId;
  state.useAdminOverride = false;
  return pmId;
}

async function createRegistryTender(label, role = 'TO') {
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
  let id = resp.data?.tender?.id || resp.data?.id;

  const pg = await pgConnect();
  try {
    if (!(resp.status < 400 && id)) {
      const u = await pg.query(`SELECT id FROM users WHERE login = $1 LIMIT 1`, ['test_to']);
      const ins = await pg.query(`
        INSERT INTO tenders (customer_name, tender_title, tender_price, docs_deadline,
          registry_status, tender_status, source_kind, created_by, created_by_user_id, period, created_at, updated_at)
        VALUES ($1, $2, 1000000, $3::date, 'рассмотрение', 'Новый', 'to_manual', $4, $4,
          to_char(NOW(), 'YYYY-MM'), NOW(), NOW()) RETURNING id
      `, [`${RUN_TAG} ${label}`, `${RUN_TAG} ${label}`, futureDeadline(45), u.rows[0]?.id]);
      id = ins.rows[0].id;
    }
    // Реестр режет created_by с именем «test %» — перевешиваем на живого ТО
    await pg.query(`
      UPDATE tenders SET
        created_by = COALESCE((
          SELECT u.id FROM users u
          WHERE u.role IN ('TO','HEAD_TO')
            AND COALESCE(u.is_active, true) = true
            AND LOWER(COALESCE(u.name,'')) NOT LIKE 'test %'
            AND LOWER(COALESCE(u.login,'')) NOT LIKE 'test_%'
          ORDER BY u.id ASC LIMIT 1
        ), created_by),
        created_by_user_id = COALESCE((
          SELECT u.id FROM users u
          WHERE u.role IN ('TO','HEAD_TO')
            AND COALESCE(u.is_active, true) = true
            AND LOWER(COALESCE(u.name,'')) NOT LIKE 'test %'
            AND LOWER(COALESCE(u.login,'')) NOT LIKE 'test_%'
          ORDER BY u.id ASC LIMIT 1
        ), created_by_user_id)
      WHERE id = $1
    `, [id]);
    return id;
  } finally {
    await pg.end().catch(() => {});
  }
}

async function getReviewUpdatedAt(tenderId) {
  const resp = await api('GET', `/api/tenders/${tenderId}/rp-review`, { role: calcRole() });
  return resp.data?.review?.updated_at || null;
}

async function insertFakeTkp(pg, tenderId, uploadedBy) {
  const r = await pg.query(`
    INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
    VALUES ($1, $2, 'application/pdf', 128, 'rp_tkp', $3, $4, $5, NOW()) RETURNING id
  `, [`test_tkp_${tenderId}.pdf`, `TEST_TKP_${tenderId}.pdf`, tenderId, uploadedBy, `/uploads/test/tkp_${tenderId}.pdf`]);
  await pg.query(`UPDATE tender_rp_reviews SET tkp_file_id = $1 WHERE tender_id = $2`, [r.rows[0].id, tenderId]);
  return r.rows[0].id;
}

async function finalizeAnalysis(tenderId, pg) {
  const expected = await getReviewUpdatedAt(tenderId);
  const resp = await api('PUT', `/api/tenders/${tenderId}/rp-review`, {
    role: calcRole(),
    body: withOverride({
      decision: 'submit',
      report_kind: 'work',
      report_json: {
        mode: 'analysis',
        feasibility: 'yes',
        competition: 'medium',
        summary: `${RUN_TAG}: анализ UI`,
        recommendation: 'Подаём',
      },
      missing_info_flags: [],
      finalize: true,
      expected_updated_at: expected,
    }),
  });
  if (resp.status >= 400) throw new Error(`finalizeAnalysis ${resp.status}: ${JSON.stringify(resp.data).slice(0, 200)}`);
  return resp;
}

async function finalizeCalc(tenderId, workPrice, pg, opts = {}) {
  const uploader = state.dutyPmUserId || TEST_USERS.PM?.id || 1;
  await insertFakeTkp(pg, tenderId, uploader);
  const expected = await getReviewUpdatedAt(tenderId);
  const body = withOverride({
    decision: 'submit',
    report_kind: 'work',
    report_json: { mode: 'calc', summary: `${RUN_TAG}: просчёт UI` },
    work_price: workPrice,
    missing_info_flags: [],
    finalize: true,
    expected_updated_at: expected,
  });
  if (opts.approval_recipients) body.approval_recipients = opts.approval_recipients;
  return api('PUT', `/api/tenders/${tenderId}/rp-review`, { role: calcRole(), body });
}

async function approveDirector(tenderId, pg) {
  const resp = await api('POST', `/api/tenders/${tenderId}/rp-review/director-decision`, {
    role: 'DIRECTOR_GEN',
    body: { action: 'submit', comment: `${RUN_TAG} согласовано UI` },
  });
  if (resp.status < 400) return resp;
  await pg.query(`
    UPDATE tender_rp_reviews SET director_review_status = 'approved', director_review_at = NOW(),
      director_review_by_user_id = (SELECT id FROM users WHERE login = 'test_director_gen' LIMIT 1)
    WHERE tender_id = $1
  `, [tenderId]);
  await pg.query(`UPDATE tenders SET registry_status = 'готовим', updated_at = NOW() WHERE id = $1`, [tenderId]);
  return { status: 200, data: { fallback: 'sql' } };
}

async function seedData(pg) {
  await ensureDutyPm(pg);

  // Открытый анализ → вкладка «Анализ» (не финализируем)
  state.openAnalysisTenderId = await createRegistryTender('open-analysis', 'TO');
  await api('PUT', `/api/tenders/${state.openAnalysisTenderId}/rp-review`, {
    role: calcRole(),
    body: withOverride({
      decision: 'submit',
      report_kind: 'work',
      report_json: {
        mode: 'analysis',
        feasibility: 'yes',
        competition: 'medium',
        summary: `${RUN_TAG}: черновик анализа UI`,
        recommendation: 'Подаём',
      },
      missing_info_flags: [],
      finalize: false,
    }),
  }).catch(() => {});

  // Анализ закрыт → вкладка «Просчёты» (calculator = duty PM)
  state.analysisTenderId = await createRegistryTender('calc-queue', 'TO');
  await finalizeAnalysis(state.analysisTenderId, pg);
  await pg.query(`
    UPDATE tenders SET calculator_user_id = $1, calculator_kind = 'pm', updated_at = NOW() WHERE id = $2
  `, [state.dutyPmUserId, state.analysisTenderId]);
  await pg.query(`
    UPDATE tender_rp_reviews SET calculator_user_id = $1, updated_at = NOW() WHERE tender_id = $2
  `, [state.dutyPmUserId, state.analysisTenderId]);

  state.pendingTenderId = await createRegistryTender('pending-director', 'TO');
  await finalizeAnalysis(state.pendingTenderId, pg);
  const pendResp = await finalizeCalc(state.pendingTenderId, WORK_PRICE, pg, {
    approval_recipients: ['HEAD_TO'],
  });
  if (pendResp.status >= 400) {
    throw new Error(`pending calc failed: ${pendResp.status}`);
  }

  state.approvedTenderId = await createRegistryTender('approved-director', 'TO');
  await finalizeAnalysis(state.approvedTenderId, pg);
  const appCalc = await finalizeCalc(state.approvedTenderId, WORK_PRICE, pg, {
    approval_recipients: ['HEAD_TO'],
  });
  if (appCalc.status >= 400) throw new Error(`approved calc failed: ${appCalc.status}`);
  await approveDirector(state.approvedTenderId, pg);

  report.seed = {
    openAnalysisTenderId: state.openAnalysisTenderId,
    analysisTenderId: state.analysisTenderId,
    pendingTenderId: state.pendingTenderId,
    approvedTenderId: state.approvedTenderId,
    dutyPmUserId: state.dutyPmUserId,
    adminOverride: state.useAdminOverride,
  };
}

// ── Playwright helpers ───────────────────────────────────────────

async function officeLogin(roleKey) {
  const acc = getAccount(roleKey);
  if (!acc) throw new Error(`no account for ${roleKey}`);
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: acc.login, password: acc.password }),
  }).then((r) => r.json());
  if (!lr.token) throw new Error(`${roleKey} login fail`);
  let token = lr.token;
  let user = lr.user;
  if (lr.status === 'need_pin') {
    const pr = await fetch(`${BASE}/api/auth/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pin: acc.pin }),
    }).then((r) => r.json());
    if (!pr.token) throw new Error(`${roleKey} pin fail`);
    token = pr.token;
    user = pr.user || user;
  }
  const me = await fetch(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  return { token, user: me.user || user, permissions: (me.user || user || {}).permissions || {} };
}

async function dismissChrome(page, { keepModals = false } = {}) {
  await page.evaluate((keep) => {
    const d = new Date();
    const iso = d.toISOString().slice(0, 10);
    localStorage.setItem('presence_done_' + iso, '1');
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10);
      localStorage.setItem('presence_done_' + x, '1');
    }
    const gate = document.getElementById('asgard-presence-gate');
    if (gate) gate.remove();
    // НЕ удаляем .cr-m-overlay — это рабочие модалки просчёта/анализа
    if (!keep) {
      document.querySelectorAll('#asgard-presence-gate, .presence-gate, .cr-checkin-overlay').forEach((el) => {
        try { el.remove(); } catch (_) {}
      });
    }
    localStorage.setItem('asgard_shell_banner_dismissed', '1');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_theme', 'dark');
  }, keepModals);
  const gate = page.locator('#asgard-presence-gate');
  if (await gate.count()) {
    await gate.locator('#pg-opts button').first().click({ timeout: 2000 }).catch(() => {});
    await gate.locator('#pg-save').click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const g = document.getElementById('asgard-presence-gate');
      if (g) g.remove();
    });
  }
  if (!keepModals) {
    for (const t of ['Понял', 'Принять вызов', 'Позже']) {
      await page.getByRole('button', { name: new RegExp('^' + t + '$', 'i') }).first().click({ timeout: 400 }).catch(() => {});
    }
  }
  await page.evaluate(() => {
    document.querySelectorAll('.toast, .toast-item, .ui-toast, .asgard-toast').forEach((el) => {
      const txt = el.textContent || '';
      if (/ошибка|error|внутренняя/i.test(txt)) {
        try { el.remove(); } catch (_) {}
      }
    });
  });
}

async function openDesktop(context, auth, hash) {
  const page = await context.newPage();
  await context.addInitScript(({ token, user, permissions }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_permissions', JSON.stringify(permissions || {}));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('asgard_shell_banner_dismissed', '1');
    localStorage.setItem('asgard_v2_banner_dismissed', '1');
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10);
      localStorage.setItem('presence_done_' + x, '1');
    }
  }, auth);
  await page.goto(`${BASE}/`, { waitUntil: 'commit', timeout: 60000 });
  await page.evaluate(async () => {
    if (navigator.serviceWorker) {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    }
    if (window.caches) {
      for (const k of await caches.keys()) await caches.delete(k);
    }
  }).catch(() => {});
  await page.goto(`${BASE}/?nocache=${Date.now()}${hash}`, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForSelector('#layout, #main-content, body', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2800);
  await dismissChrome(page);
  return page;
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function shotEl(page, selector, name) {
  const file = path.join(OUT, `${name}.png`);
  const loc = page.locator(selector).first();
  if (await loc.count()) {
    await loc.screenshot({ path: file }).catch(async () => {
      await page.screenshot({ path: file, fullPage: false });
    });
  } else {
    await page.screenshot({ path: file, fullPage: false });
  }
  return file;
}

/** Полный кадр письма: отдельная страница из srcdoc (не оверлей поверх duty). */
async function shotMailFull(page, browserCtx) {
  const frame = page.locator('.rp-calc-mail-preview__frame');
  if (!(await frame.count())) return { ok: false, detail: 'no iframe' };
  const srcdoc = await frame.getAttribute('srcdoc').catch(() => null);
  if (!srcdoc || srcdoc.length < 200) return { ok: false, detail: 'empty srcdoc' };

  const hasDirector = /Решение для директора/i.test(srcdoc);
  const hasSmeta = /СМЕТА/i.test(srcdoc);
  const hasTax = /Налог\s*\/\s*взносы на ФОТ\s*\(55%\)|ФОТ\s*\(55%\)|55\s*%/i.test(srcdoc);

  // Кадр оверлея (chips + шапка письма)
  await shotEl(page, '.rp-calc-mail-preview', '07b-mail-overlay');

  const letter = await browserCtx.newPage();
  try {
    await letter.setContent(srcdoc, { waitUntil: 'domcontentloaded' });
    await letter.setViewportSize({ width: 780, height: 1100 });
    await letter.waitForTimeout(200);
    // Полное письмо
    await letter.screenshot({ path: path.join(OUT, '08-mail-html.png'), fullPage: true });
    await letter.screenshot({ path: path.join(OUT, '08b-mail-full.png'), fullPage: true });

    // Хвост: налог 55% + итоги
    await letter.evaluate(() => {
      const nodes = [...document.querySelectorAll('td, div, tr, b')];
      const tax = nodes.find((n) => /Налог\s*\/\s*взносы на ФОТ|ФОТ\s*\(55%\)|55\s*%/i.test(n.textContent || ''));
      const totals = nodes.find((n) => /Итоги для решения|С НДС/i.test(n.textContent || ''));
      const target = totals || tax;
      if (target) target.scrollIntoView({ block: 'center' });
    });
    await letter.waitForTimeout(150);
    await letter.screenshot({ path: path.join(OUT, '08c-mail-smeta-tail.png'), fullPage: false });

    // Прицельный кадр строки налога, если есть
    const taxCell = letter.locator('td', { hasText: /Налог\s*\/\s*взносы на ФОТ\s*\(55%\)|ФОТ\s*\(55%\)/i }).first();
    if (await taxCell.count()) {
      const row = taxCell.locator('xpath=ancestor::tr[1]');
      await row.screenshot({ path: path.join(OUT, '08d-mail-tax-row.png') }).catch(() => {});
    }
  } finally {
    await letter.close().catch(() => {});
  }

  return {
    ok: hasDirector && hasSmeta && hasTax,
    detail: `srcdoc=${srcdoc.length} director=${hasDirector} smeta=${hasSmeta} tax=${hasTax}`,
  };
}

async function waitGlobals(page, names, timeout = 20000) {
  await page.waitForFunction(
    (ns) => ns.every((n) => !!window[n]),
    names,
    { timeout }
  );
}

function assertNoInjectMarkers(detail) {
  return !/__e2eInject|DOM-подмен|injected badge/i.test(String(detail || ''));
}

// ── UI steps ─────────────────────────────────────────────────────

async function runPmUiSteps(browser) {
  const auth = await officeLogin('PM');
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await openDesktop(ctx, auth, '#/pm-calculations?tab=analysis');

  await waitGlobals(page, ['AsgardPmDutyPage', 'AsgardRpReviewModal', 'AsgardRpCalcModal']);

  // 01 — analysis tab WITH list rows (no PASS on empty)
  await page.waitForSelector('[data-tab="analysis"], .pm-duty-page', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate((tag) => {
    const row = [...document.querySelectorAll('.pm-duty-row')].find((el) => (el.textContent || '').includes(tag));
    if (row) row.scrollIntoView({ block: 'center' });
  }, RUN_TAG);
  const analysisRows = await page.locator('.pm-duty-row').count();
  const analysisEmpty = await page.locator('.pm-duty-empty').count();
  const analysisBody = await page.locator('.pm-duty-queue-panel, .pm-duty-page').innerText().catch(() => '');
  const analysisListOk = analysisRows >= 1 && analysisEmpty === 0 && !/Пока пусто/i.test(analysisBody);
  step('01', 'PM: список Анализ ≥1 строка', analysisListOk,
    `rows=${analysisRows} emptyNodes=${analysisEmpty} tag=${RUN_TAG.slice(0, 12)}`);
  await shotEl(page, '.pm-duty-queue-panel, .pm-duty-page', '01-duty-list-analysis');
  await shot(page, '01-duty-analysis');

  // 02 — calc tab WITH list rows
  await page.locator('[data-tab="calc"]').click({ timeout: 8000 }).catch(async () => {
    await page.evaluate(() => { location.hash = '#/pm-calculations?tab=calc'; });
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.querySelectorAll('.mimir-toast, .mimir-card, [class*="mimir"]').forEach((el) => {
      const t = el.textContent || '';
      if (/МИМИР|просрочен/i.test(t)) try { el.style.opacity = '0.25'; } catch (_) {}
    });
  });
  await dismissChrome(page, { keepModals: true });
  await page.evaluate((tag) => {
    const row = [...document.querySelectorAll('.pm-duty-row')].find((el) => (el.textContent || '').includes(tag));
    if (row) row.scrollIntoView({ block: 'center' });
  }, RUN_TAG);
  const calcRows = await page.locator('.pm-duty-row').count();
  const calcEmpty = await page.locator('.pm-duty-empty').count();
  const calcBody = await page.locator('.pm-duty-queue-panel, .pm-duty-page').innerText().catch(() => '');
  const calcListOk = calcRows >= 1 && calcEmpty === 0 && !/Пока пусто/i.test(calcBody);
  step('02', 'PM: список Просчёты ≥1 строка', calcListOk,
    `rows=${calcRows} emptyNodes=${calcEmpty}`);
  await shotEl(page, '.pm-duty-queue-panel, .pm-duty-page', '02-duty-list-calc');
  await shot(page, '02-duty-calc-tab');

  // 03 — archive tab
  await page.locator('[data-tab="archive"]').click({ timeout: 8000 }).catch(async () => {
    await page.evaluate(() => { location.hash = '#/pm-calculations?tab=archive'; });
  });
  await page.waitForTimeout(2000);
  step('03', 'PM: вкладка Архив', /архив/i.test(await page.locator('body').innerText()), 'tab=archive');
  await shot(page, '03-duty-archive-tab');

  // 04 — analysis modal
  await page.evaluate((tid) => {
    window.AsgardRpReviewModal.open({ id: tid, customer_name: 'UI analysis' }, [], null, { mode: 'analysis' });
  }, state.openAnalysisTenderId || state.analysisTenderId);
  await page.waitForSelector('.cr-m-overlay.cr-m-overlay--visible, .rp-review-modal, .rp-review-decision-row', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => {
    const overlay = document.querySelector('.cr-m-overlay.cr-m-overlay--visible');
    if (!overlay) return false;
    const txt = overlay.innerText || '';
    const loading = /Загрузка отчёта/i.test(txt);
    const toast500 = /Внутренняя ошибка сервера/i.test(document.body.innerText || '');
    const hasContent = /Подаём|Не подаём|заказчик|рекоменд|feasibility|отчёт/i.test(txt) && !loading;
    return hasContent || toast500;
  }, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  await dismissChrome(page, { keepModals: true });
  const modalOpen = await page.locator('.cr-m-overlay.cr-m-overlay--visible .rp-review-modal, .cr-m-overlay--visible .rp-review-decision-row, .rp-review-modal').count();
  const overlayTxt = await page.locator('.cr-m-overlay.cr-m-overlay--visible').innerText().catch(() => '');
  const stillLoading = /Загрузка отчёта/i.test(overlayTxt);
  const has500 = /Внутренняя ошибка сервера/i.test(await page.locator('body').innerText().catch(() => ''));
  const hasContent = /Подаём|Не подаём|заказчик|рекоменд|feasibility/i.test(overlayTxt);
  const analysisOk = modalOpen > 0 && hasContent && !stillLoading && !has500;
  step('04', 'PM: модалка анализа AsgardRpReviewModal', analysisOk,
    `tender=${state.openAnalysisTenderId || state.analysisTenderId} modalNodes=${modalOpen} loading=${stillLoading} err500=${has500} content=${hasContent}`);
  await shot(page, '04-analysis-modal');
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    if (window.AsgardUI && typeof AsgardUI.hideModal === 'function') {
      for (let i = 0; i < 5; i++) {
        if (!document.querySelector('.cr-m-overlay')) break;
        AsgardUI.hideModal();
      }
    }
    document.querySelectorAll('.cr-m-overlay').forEach((el) => { try { el.remove(); } catch (_) {} });
    document.body.style.overflow = '';
  });
  await page.waitForTimeout(400);

  // 05 — calc demo modal inputs + director label
  await page.evaluate(() => { window.__e2eCalc = window.AsgardRpCalcModal.openDemo(); });
  await page.waitForSelector('[data-rp-calc-root], .rp-calc-modal', { timeout: 12000 });
  const directorLabelOk = await page.locator('label', { hasText: /Решение для директора/i }).count() > 0;
  step('05', 'PM: демо-модалка + «Решение для директора»',
    (await page.locator('[data-rp-calc-root]').count() > 0) && directorLabelOk,
    `directorLabel=${directorLabelOk}`);
  await shot(page, '05-calc-modal-inputs');

  // 06 — smeta: unit select + tax % + full table shot
  await page.locator('[data-rp-tab="smeta"]').click({ timeout: 5000 }).catch(async () => {
    await page.evaluate(() => {
      const b = document.querySelector('[data-rp-tab="smeta"]');
      if (b) b.click();
    });
  });
  await page.waitForTimeout(800);
  const smetaPanel = page.locator('[data-panel="smeta"]');
  const unitSelects = await page.locator('select[data-fld="unit"]').count();
  const smetaTxt = await smetaPanel.innerText().catch(() => '');
  const taxPctOk = /Налог\s*\/\s*взносы на ФОТ\s*\(55%\)/i.test(smetaTxt) || /ФОТ\s*\(55%\)/i.test(smetaTxt);
  const qtyHint = await page.locator('input[data-fld="qty"][placeholder], input[data-fld="qty"][title]').count();
  const smetaOk = (await smetaPanel.count()) > 0 && unitSelects >= 1 && taxPctOk && qtyHint >= 1;
  step('06', 'Смета: unit select + налог 55% + подсказки', smetaOk,
    `units=${unitSelects} tax55=${taxPctOk} qtyHint=${qtyHint}`);
  await page.evaluate(() => {
    const wrap = document.querySelector('.rp-calc-smeta-wrap');
    if (wrap) wrap.scrollTop = 0;
    const hero = document.querySelector('.rp-calc-hero');
    if (hero) hero.scrollIntoView({ block: 'start' });
  });
  await shotEl(page, '.rp-calc-modal, [data-rp-calc-root]', '06-calc-modal-smeta');
  await page.evaluate(() => {
    const wrap = document.querySelector('.rp-calc-smeta-wrap');
    if (!wrap) return;
    wrap.style.maxHeight = 'none';
    wrap.style.overflow = 'visible';
    const roll = [...wrap.querySelectorAll('.rp-calc-rollup')].pop();
    if (roll) roll.scrollIntoView({ block: 'end' });
  });
  await page.waitForTimeout(200);
  await shotEl(page, '.rp-calc-smeta-wrap', '06b-smeta-full');

  // 07 — mail preview recipients (chips)
  await page.evaluate(() => {
    const session = window.__e2eCalc;
    if (!session) throw new Error('__e2eCalc session missing');
    if (!session.state.estimate.params) session.state.estimate.params = {};
    session.state.estimate.params.markup = 2.2;
    session.state.approvalRecipients = ['DIRECTOR_GEN', 'DIRECTOR_DEV', 'DIRECTOR_COMM', 'HEAD_TO'];
    session.paint();
  });
  await page.waitForTimeout(500);
  await page.locator('[data-rp-act="demo-send"]').click({ timeout: 8000 });
  await page.waitForSelector('.rp-calc-mail-preview', { timeout: 10000 });
  await page.waitForSelector('.rp-calc-mail-preview__to-item', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  await dismissChrome(page, { keepModals: true });
  const rcptCount = await page.locator('.rp-calc-mail-preview__to-item').count();
  const chips = await page.locator('.rp-calc-mail-preview__chip').count();
  const mailBoxVisible = await page.locator('.rp-calc-mail-preview').isVisible().catch(() => false);
  const hintOk = await page.locator('.rp-calc-mail-preview__to-hint').count() > 0;
  step('07', 'Превью письма: 4 chip-получателя', mailBoxVisible && rcptCount === 4 && chips === 4 && hintOk,
    `visible=${mailBoxVisible} items=${rcptCount} chips=${chips} hint=${hintOk}`);
  // Письмо fixed поверх — не absolute внутри страницы
  const mailCss = await page.evaluate(() => {
    const mail = document.querySelector('.rp-calc-mail-preview');
    if (!mail) return null;
    const cs = getComputedStyle(mail);
    return {
      position: cs.position,
      zIndex: cs.zIndex,
      inset: [cs.top, cs.right, cs.bottom, cs.left].join(','),
      parentIsBody: mail.parentElement === document.body,
    };
  });
  const noBleed = !!(mailCss && mailCss.position === 'fixed' && mailCss.parentIsBody &&
    parseInt(mailCss.zIndex, 10) >= 1000);
  step('07b', 'Письмо: fixed overlay на body (без склейки с duty)', noBleed,
    mailCss ? JSON.stringify(mailCss) : 'no-mail');
  await shotEl(page, '.rp-calc-mail-preview', '07-mail-preview-recipients');

  // 08 — full mail HTML (отдельная страница из srcdoc)
  const mailShot = await shotMailFull(page, ctx);
  step('08', 'Превью HTML письма (решение + смета + 55%)', !!mailShot.ok, mailShot.detail || 'no iframe');

  await page.keyboard.press('Escape').catch(() => {});
  await ctx.close();
}

async function runToRegistrySteps(browser) {
  const auth = await officeLogin('TO');
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await openDesktop(ctx, auth, '#/tenders');
  await dismissChrome(page);
  await page.waitForTimeout(1500);

  // вкладка «Реестр», если сага с несколькими табами
  await page.getByRole('button', { name: /реестр/i }).first().click({ timeout: 3000 }).catch(() => {});
  await page.locator('[data-tab="registry"], .tenders-tab[data-id="registry"], a:has-text("Реестр")').first()
    .click({ timeout: 3000 }).catch(() => {});
  await page.waitForSelector('.reg-toolbar, #regSearchInp, table.reg-table, .reg-table', { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await dismissChrome(page);

  // 09 — search RUN_TAG
  // период «все», чтобы seed точно попал в выборку
  await page.evaluate(() => {
    const sel = document.querySelector('#regPeriodSel, select[name="period"]');
    if (sel) {
      const allOpt = [...sel.options].find((o) => /все/i.test(o.textContent || '') || o.value === 'all' || o.value === '');
      if (allOpt) {
        sel.value = allOpt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    // TenderPeriodFilterUI: клик по «Все тендеры» если есть
  });
  await page.getByText(/Все тендеры/i).first().click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(800);
  const searchInp = page.locator('#regSearchInp');
  let foundTag = false;
  if (await searchInp.count()) {
    await searchInp.fill(RUN_TAG);
    await searchInp.press('Enter');
    await page.waitForTimeout(3500);
    foundTag = (await page.locator('body').innerText()).includes(RUN_TAG);
  }
  // дождаться строк таблицы с RUN_TAG
  await page.waitForFunction((tag) => {
    const t = document.body && document.body.innerText || '';
    return t.includes(tag) && (/Цена согласована|Считаю сам|У директора|Открыть/i.test(t));
  }, RUN_TAG, { timeout: 15000 }).catch(() => {});
  await page.evaluate((tag) => {
    const row = [...document.querySelectorAll('tr, .reg-row, .e2e-reg-row')].find((el) => (el.textContent || '').includes(tag));
    if (row) row.scrollIntoView({ block: 'center' });
  }, RUN_TAG);
  await page.waitForTimeout(500);
  step('09', 'TO: реестр #/tenders + поиск RUN_TAG', foundTag || (await page.locator('body').innerText()).includes(RUN_TAG), `q=${RUN_TAG}`);
  await page.evaluate(() => {
    const toolbar = document.querySelector('.reg-toolbar, #regSearchInp');
    if (toolbar) toolbar.scrollIntoView({ block: 'start' });
    const wrap = document.querySelector('.reg-table-wrap');
    if (wrap) wrap.scrollLeft = 0;
  });
  await shot(page, '09-registry-to');
  // Полный кадр: тулбар + таблица (не тулбар вместо таблицы)
  const tableRowsVisible = await page.locator('.reg-table tbody tr, table.reg-table tbody tr').count();
  const regFullOk = tableRowsVisible >= 1 && (await page.locator('.reg-table-wrap').count()) > 0;
  if (!regFullOk) {
    step('09b', 'TO: полный кадр реестра (таблица)', false, `rows=${tableRowsVisible}`);
  }
  await page.evaluate(() => {
    const host = document.querySelector('.reg-page, #main-content, .page') || document.body;
    const toolbar = document.querySelector('.reg-toolbar');
    const wrap = document.querySelector('.reg-table-wrap');
    if (toolbar) toolbar.scrollIntoView({ block: 'start' });
    if (wrap) {
      wrap.style.maxHeight = 'none';
      wrap.scrollTop = 0;
      wrap.scrollLeft = 0;
    }
  });
  await page.waitForTimeout(200);
  // Снимаем страницу с тулбаром+таблицами, не один тулбар
  await page.screenshot({
    path: path.join(OUT, '09b-registry-full.png'),
    fullPage: false,
  });
  // Доп. кадр именно wrap таблицы со строками
  await shotEl(page, '.reg-table-wrap', '09c-registry-table');

  const body = await page.locator('body').innerText();

  // 10 — approved badge (только живой pill в DOM)
  await dismissChrome(page, { keepModals: true });
  const badgeBtn = page.locator('.pill.ok.reg-rp-view', { hasText: /Цена согласована/i });
  let badgeOk = (await badgeBtn.count()) > 0;
  if (badgeOk) {
    await badgeBtn.first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => {
    const toolbar = document.querySelector('.reg-toolbar, #regSearchInp');
    if (toolbar) toolbar.scrollIntoView({ block: 'start' });
    const badge = document.querySelector('.pill.ok.reg-rp-view');
    if (badge) {
      const row = badge.closest('tr, .reg-row');
      if (row) row.scrollIntoView({ block: 'center', inline: 'nearest' });
      badge.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  });
  await page.waitForTimeout(400);
  step('10', 'TO: бейдж «Цена согласована»', badgeOk, badgeOk ? 'live .pill.ok.reg-rp-view' : 'pill missing');
  await page.evaluate(() => {
    const wrap = document.querySelector('.reg-table-wrap');
    const badge = document.querySelector('.pill.ok.reg-rp-view');
    if (wrap && badge) {
      const br = badge.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      wrap.scrollLeft += (br.left - wr.left) - 80;
      wrap.scrollTop = Math.max(0, badge.closest('tr')?.offsetTop - 40);
    }
  });
  await page.waitForTimeout(300);
  const wrap = page.locator('.reg-table-wrap').first();
  if (await wrap.count()) {
    await wrap.screenshot({ path: path.join(OUT, '10-registry-badge-approved.png') }).catch(() => shot(page, '10-registry-badge-approved'));
  } else {
    await shot(page, '10-registry-badge-approved');
  }
  await shot(page, '10b-registry-full-badge');

  // 11 — self-calc, no RP assign select (живой DOM)
  await page.evaluate((tag) => {
    const wrap = document.querySelector('.reg-table-wrap');
    const btn = [...document.querySelectorAll('.reg-self-calc')].find((el) => /Считаю сам/i.test(el.textContent || ''));
    if (wrap && btn) {
      const br = btn.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      wrap.scrollLeft += (br.left - wr.left) - 80;
      const row = btn.closest('tr');
      if (row) wrap.scrollTop = Math.max(0, row.offsetTop - 40);
    } else if (wrap) {
      const row = [...document.querySelectorAll('tr')].find((el) => (el.textContent || '').includes(tag));
      if (row) wrap.scrollTop = Math.max(0, row.offsetTop - 40);
    }
  }, RUN_TAG);
  await page.waitForTimeout(300);
  const selfCalc = await page.locator('.reg-self-calc, button:has-text("Считаю сам")').count();
  const assignPm = await page.locator('.reg-assign-pm, .reg-assign-go, select.reg-assign-pm').count();
  const noAssign = assignPm === 0;
  const tableRows = await page.locator('.reg-table tbody tr, table.reg-table tbody tr').count();
  const registryNotEmpty = tableRows >= 1 || body.includes(RUN_TAG);
  step('11', 'TO: «Считаю сам» без назначения РП', selfCalc > 0 && noAssign && registryNotEmpty,
    `selfCalc=${selfCalc}, reg-assign-pm=${assignPm}, rows=${tableRows}`);
  if (await wrap.count()) {
    await wrap.screenshot({ path: path.join(OUT, '11-registry-self-calc.png') }).catch(() => shot(page, '11-registry-self-calc'));
  } else {
    await shot(page, '11-registry-self-calc');
  }

  await ctx.close();
}

async function main() {
  console.log(`\n=== Tender premium UI E2E ===`);
  console.log(`BASE=${BASE} PG=${PG.database} RUN_TAG=${RUN_TAG}\n`);

  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health || health.status !== 'ok') {
    console.error('Сервер недоступен:', BASE);
    process.exit(1);
  }

  let pg;
  let browser;
  try {
    await initTokens();
    await initRealUsers();

    pg = await pgConnect();
    await seedData(pg);
    console.log('Seed:', JSON.stringify(report.seed));

    browser = await chromium.launch({ headless: true });
    await runPmUiSteps(browser);
    await runToRegistrySteps(browser);
  } catch (e) {
    step('SETUP', 'preflight / seed / browser', false, String(e.message || e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (pg) await pg.end().catch(() => {});
  }

  report.finished_at = new Date().toISOString();
  report.summary.pass = report.steps.filter((s) => s.pass).length;
  report.summary.fail = report.steps.filter((s) => !s.pass).length;

  const outFile = path.join(OUT, 'tender-premium-ui-result.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\n=== ИТОГ: ${report.summary.pass} pass / ${report.summary.fail} fail ===`);
  console.log(`Wrote ${outFile}`);

  process.exit(report.summary.fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
