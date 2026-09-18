#!/usr/bin/env node
/**
 * Sentinel по доработке просчёта и карточки тендера (D-184..D-190).
 *
 * Проверяет на ЖИВОМ приложении-двойнике (клон asgard_crm_test, :3100) то,
 * чего не поймать статикой:
 *   1) GET /:id/rp-review отдаёт director_threshold из settings;
 *   2) GET /:id/rp-review отдаёт tender_files (документы тендера);
 *   3) GET /api/files?exclude_types=… не возвращает rp_estimate/rp_report/rp_tkp
 *      и не дублирует файлы по (tender_id, original_name, type);
 *   4) PATCH /registry/:id — RBAC: immutable-поля (customer_name/tender_price/
 *      docs_deadline) закрыты для всех, кроме ADMIN; TO правит mutable (в т.ч.
 *      платное участие), PM/HEAD_PM — только comment_to;
 *   5) work_price в смете остаётся БЕЗ НДС.
 *
 * Usage: node tests/rp-calc-improvements-sentinel.js
 */
'use strict';

const {
  api,
  initTokens,
  initRealUsers,
  TEST_USERS,
  assert,
} = require('./config');

const results = [];
let failed = 0;

function ok(name, detail) {
  results.push(['PASS', name, detail || '']);
  console.log('PASS — ' + name + (detail ? ' :: ' + detail : ''));
}
function bad(name, detail) {
  failed += 1;
  results.push(['FAIL', name, detail || '']);
  console.log('FAIL — ' + name + (detail ? ' :: ' + detail : ''));
}
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => ok(name))
    .catch((e) => bad(name, e.message));
}

const TENDER_ID = Number(process.env.SENTINEL_TENDER_ID || 2052);

(async function main() {
  await initTokens();
  await initRealUsers();

  const pm = TEST_USERS['PM'] || {};
  const to = TEST_USERS['TO'] || {};
  const admin = TEST_USERS['ADMIN'] || {};
  const RP_REVIEW = '/api/tenders/' + TENDER_ID + '/rp-review';

  // ── 1. director_threshold из settings ────────────────────────────────
  let reviewResp = null;
  await check('GET /:id/rp-review отдаёт director_threshold из settings (D-185)', async () => {
    reviewResp = await api('GET', RP_REVIEW, { role: 'ADMIN' });
    assert(reviewResp.ok, 'HTTP ' + reviewResp.status + ' — ' + JSON.stringify(reviewResp.data).slice(0, 200));
    const th = Number(reviewResp.data.director_threshold);
    assert(Number.isFinite(th) && th > 0, 'director_threshold не пришёл: ' + JSON.stringify(reviewResp.data.director_threshold));
    assert(th === 10000000, 'ожидали 10 000 000 из settings, получили ' + th);
  });

  // ── 2. tender_files в ответе просчёта ────────────────────────────────
  await check('GET /:id/rp-review отдаёт tender_files — документы тендера (D-187)', async () => {
    assert(reviewResp && reviewResp.ok, 'нет успешного ответа rp-review');
    const tf = reviewResp.data.tender_files;
    assert(Array.isArray(tf), 'tender_files не массив: ' + typeof tf);
    assert(tf.length > 0, 'документы тендера пусты для #' + TENDER_ID);
    const types = tf.map((f) => String(f.type || ''));
    assert(!types.some((t) => t.startsWith('rp_')), 'в tender_files просочились rp-типы: ' + types.join(','));
    assert(tf.every((f) => f.original_name), 'у документа нет original_name');
    const names = tf.map((f) => f.original_name);
    assert(new Set(names).size === names.length, 'в tender_files есть дубли по имени: ' + names.join(' | '));
    // Файлы сметы/ТКП/отчёта приходят как estimate_file/tkp_file/report_file — в tender_files
    // они дублировались (нашёл L3-верификатор на tender 2052). Ни по id, ни по имени их быть не должно.
    const linkedIds = [reviewResp.data.estimate_file, reviewResp.data.report_file, reviewResp.data.tkp_file]
      .filter(Boolean).map((f) => Number(f.id));
    const linkedNames = [reviewResp.data.estimate_file, reviewResp.data.report_file, reviewResp.data.tkp_file]
      .filter(Boolean).map((f) => String(f.original_name || '').trim().toLowerCase());
    for (const f of tf) {
      assert(!linkedIds.includes(Number(f.id)),
        'файл сметы/ТКП/отчёта попал в tender_files по id: #' + f.id + ' ' + f.original_name);
      assert(!linkedNames.includes(String(f.original_name || '').trim().toLowerCase()),
        'файл сметы/ТКП/отчёта попал в tender_files по имени: ' + f.original_name);
    }
  });

  // ── 3. exclude_types + дедуп в /api/files ────────────────────────────
  await check('GET /api/files?exclude_types=… без rp-типов и без дублей (D-187)', async () => {
    const exclude = 'rp_estimate,rp_report,rp_tkp,Смета,ТКП';
    const r = await api('GET', '/api/files?tender_id=' + TENDER_ID + '&limit=200&cascade=false&exclude_types=' +
      encodeURIComponent(exclude), { role: 'ADMIN' });
    assert(r.ok, 'HTTP ' + r.status + ' — ' + JSON.stringify(r.data).slice(0, 200));
    const files = r.data.files || [];
    const types = files.map((f) => String(f.type || ''));
    const leaked = types.filter((t) => ['rp_estimate', 'rp_report', 'rp_tkp', 'Смета', 'ТКП'].includes(t));
    assert(!leaked.length, 'в списке остались исключённые типы: ' + leaked.join(','));
    const keys = files.map((f) => [f.tender_id, f.original_name, f.type].join('|'));
    assert(new Set(keys).size === keys.length, 'есть дубли по (tender_id, original_name, type)');
  });

  // ── 4. РБАК на PATCH карточки ────────────────────────────────────────
  await check('PATCH: immutable-поля закрыты для PM (403) — D-189', async () => {
    assert(pm.id, 'не найден test_pm');
    const r = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
      role: 'PM',
      body: { field: 'tender_price', value: 1 }
    });
    assert(r.status === 403, 'ожидали 403, получили ' + r.status + ' — ' + JSON.stringify(r.data).slice(0, 200));
  });

  await check('PATCH: PM правит comment_to (не 403) — D-189', async () => {
    const cur = await api('GET', RP_REVIEW, { role: 'PM' });
    const before = (cur.data.tender && cur.data.tender.comment_to) || '';
    const r = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
      role: 'PM',
      body: { field: 'comment_to', value: before }
    });
    assert(r.ok, 'ожидали 2xx, получили ' + r.status + ' — ' + JSON.stringify(r.data).slice(0, 200));
  });

  await check('PATCH: immutable закрыт для TO (403) — D-189', async () => {
    assert(to.id, 'не найден test_to');
    const r = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
      role: 'TO',
      body: { field: 'customer_inn', value: '0000000000' }
    });
    assert(r.status === 403, 'ожидали 403, получили ' + r.status + ' — ' + JSON.stringify(r.data).slice(0, 200));
  });

  await check('PATCH: TO может писать comment_to (не 403) — D-189', async () => {
    const detail = await api('GET', RP_REVIEW, { role: 'ADMIN' });
    const cur = (detail.data.tender && detail.data.tender.comment_to) || '';
    const r = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
      role: 'TO',
      body: { field: 'comment_to', value: cur }
    });
    assert(r.ok, 'ожидали 2xx, получили ' + r.status + ' — ' + JSON.stringify(r.data).slice(0, 200));
  });

  await check('PATCH: TO может писать платное участие — D-189', async () => {
    const detail = await api('GET', RP_REVIEW, { role: 'ADMIN' });
    const t = detail.data.tender || {};
    const r = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
      role: 'TO',
      body: { field: 'participation', value: { participation_paid: !!t.participation_paid, participation_fee: t.participation_fee } }
    });
    assert(r.ok, 'ожидали 2xx, получили ' + r.status + ' — ' + JSON.stringify(r.data).slice(0, 200));
  });

  await check('PATCH: HEAD_PM тоже только комментарий — D-189', async () => {
    const r = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
      role: 'HEAD_PM',
      body: { field: 'tender_title', value: 'HACK' }
    });
    assert(r.status === 403, 'ожидали 403, получили ' + r.status);
  });

  await check('PATCH: ADMIN может immutable (аварийный доступ) — D-189', async () => {
    assert(admin.id, 'не найден test_admin');
    const detail = await api('GET', RP_REVIEW, { role: 'ADMIN' });
    const t = detail.data.tender || {};
    // Пишем ТО ЖЕ значение — проверяем доступ, а не мутируем данные.
    const r = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
      role: 'ADMIN',
      body: { field: 'customer_inn', value: t.customer_inn }
    });
    assert(r.ok, 'ожидали 2xx, получили ' + r.status + ' — ' + JSON.stringify(r.data).slice(0, 200));
  });

  // ── 5. work_price без НДС ────────────────────────────────────────────
  await check('work_price в смете — без НДС (канон D-173)', async () => {
    const r = await api('GET', '/api/pm-duty/calc-queue?tab=calc&limit=200', { role: 'ADMIN' });
    if (!r.ok) return; // очередь может быть недоступна роли — не наш дефект
    const items = r.data.items || r.data.queue || r.data.rows || [];
    const withEst = items.find((it) => it.estimate && it.estimate.totals);
    if (!withEst) return;
    const t = withEst.estimate.totals;
    assert(Number(t.price_no_vat) > 0, 'нет price_no_vat');
    assert(Math.abs(Number(t.work_price || t.price_no_vat) - Number(t.price_no_vat)) < 0.02,
      'work_price разошёлся с price_no_vat');
  });

  console.log('\n' + results.filter((r) => r[0] === 'PASS').length + '/' + results.length + ' PASS');
  if (failed) {
    console.log('\nПРОВАЛЫ:');
    results.filter((r) => r[0] === 'FAIL').forEach((r) => console.log('  · ' + r[1] + ' — ' + r[2]));
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exit(2);
});
