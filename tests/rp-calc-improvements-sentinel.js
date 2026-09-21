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
 *   4) PATCH /registry/:id — RBAC: immutable-поля (customer_name/customer_inn/
 *      tender_price) закрыты для всех, кроме ADMIN; TO правит mutable (в т.ч.
 *      платное участие), PM/HEAD_PM — только comment_to;
 *   4b) срок подачи (docs_deadline) — рабочее поле ТО (D-237): TO/HEAD_TO/ADMIN
 *      пишут, PM/HEAD_PM получают 403; при переносе срока внутренний срок анализа
 *      (analysis_deadline) пересчитывается по канону «−3 раб. дня бесплатно / −5 при
 *      платном участии»;
 *   4c) внутренний срок пересчитывается и на ОБЩИХ путях записи (D-238):
 *      PUT /api/tenders/:id (v2/PmCalcs/funnel/mobile), PUT /api/data/tenders/:id
 *      (ванила AsgardDB.put), POST /api/tenders (создание);
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

const { computeAnalysisDeadline } = require('../src/lib/business-days');

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

/**
 * Полная строка тендера из реестра. GET /:id/rp-review отдаёт tender усечённым
 * (без created_at / participation_paid / analysis_deadline), а пересчёт внутреннего
 * срока анализа опирается именно на них — берём из списка реестра.
 */
async function loadTenderRow(role) {
  const r = await api('GET', '/api/tenders/registry?period=all&limit=2000&q=' + TENDER_ID, { role: role || 'ADMIN' });
  assert(r.ok, 'реестр недоступен: HTTP ' + r.status + ' — ' + JSON.stringify(r.data).slice(0, 160));
  const items = r.data.items || [];
  const row = items.find((it) => Number(it.id) === TENDER_ID);
  assert(row, 'тендер #' + TENDER_ID + ' не найден в реестре (period=all)');
  return row;
}

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

  await check('PATCH: НМЦ закрыта для TO (403), но срок подачи — можно — D-237', async () => {
    assert(to.id, 'не найден test_to');
    const t = await loadTenderRow('ADMIN');
    assert(t.docs_deadline, 'у тендера #' + TENDER_ID + ' не заполнен docs_deadline');

    const rPrice = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
      role: 'TO',
      body: { field: 'tender_price', value: Number(t.tender_price || 0) + 1 }
    });
    assert(rPrice.status === 403, 'НМЦ должна остаться неизменяемой: получили ' + rPrice.status);

    const iso = String(t.docs_deadline).slice(0, 10);
    const rDl = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
      role: 'TO',
      body: { field: 'docs_deadline', value: iso }
    });
    assert(rDl.ok, 'ТО должен менять срок подачи: HTTP ' + rDl.status + ' — ' + JSON.stringify(rDl.data).slice(0, 200));
    assert(String((rDl.data.tender || {}).docs_deadline || '').slice(0, 10) === iso,
      'бэк вернул не тот docs_deadline: ' + JSON.stringify((rDl.data.tender || {}).docs_deadline));

    // То же значение = проверка доступа, без мутации. Внутренний срок анализа не должен «уехать».
    const adlBefore = String(t.analysis_deadline || '').slice(0, 10);
    const adlAfter = String((rDl.data.tender || {}).analysis_deadline || '').slice(0, 10);
    assert(adlBefore === adlAfter, 'analysis_deadline изменился без смены даты: ' + adlBefore + ' → ' + adlAfter);
  });

  await check('PATCH: срок подачи закрыт для PM/HEAD_PM (403) — D-237', async () => {
    for (const role of ['PM', 'HEAD_PM']) {
      const r = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
        role,
        body: { field: 'docs_deadline', value: '2026-12-31' }
      });
      assert(r.status === 403, role + ': ожидали 403, получили ' + r.status + ' — ' + JSON.stringify(r.data).slice(0, 160));
    }
  });

  await check('PATCH: перенос срока ТО пересчитывает внутренний срок анализа — D-237', async () => {
    assert(to.id, 'не найден test_to');
    const t0 = await loadTenderRow('ADMIN');
    const paid = !!t0.participation_paid;
    const created = t0.created_at || null;
    const origIso = String(t0.docs_deadline).slice(0, 10);

    // Сначала переносим срок ВПЕРЁД от текущего, чтобы пересчёт не упёрся в клэмп created_at
    // (канон business-days.computeAnalysisDeadline: internal = docs − 3 раб. дн., при платном — −5).
    const d = new Date(origIso + 'T12:00:00');
    d.setDate(d.getDate() + 10);
    const shifted = d.toISOString().slice(0, 10);

    const r = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
      role: 'TO',
      body: { field: 'docs_deadline', value: shifted }
    });
    assert(r.ok, 'перенос срока упал: HTTP ' + r.status + ' — ' + JSON.stringify(r.data).slice(0, 200));
    const expected = computeAnalysisDeadline({ docs_deadline: shifted, participation_paid: paid, created_at: created });
    const got = String((r.data.tender || {}).analysis_deadline || '').slice(0, 10);
    assert(got === expected,
      'analysis_deadline не пересчитан: ожидали ' + expected + ', получили ' + got +
      ' (docs=' + shifted + ', paid=' + paid + ', created=' + created + ')');

    // Возвращаем исходную дату — гейт не должен оставлять за собой изменённый тендер.
    const back = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
      role: 'TO',
      body: { field: 'docs_deadline', value: origIso }
    });
    assert(back.ok, 'не удалось вернуть исходный срок: HTTP ' + back.status);
    const restored = computeAnalysisDeadline({ docs_deadline: origIso, participation_paid: paid, created_at: created });
    assert(String((back.data.tender || {}).analysis_deadline || '').slice(0, 10) === restored,
      'после возврата срока analysis_deadline не сошёлся с каноном');
  });

  await check('PATCH: HEAD_TO тоже меняет срок подачи — D-237', async () => {
    const t = await loadTenderRow('ADMIN');
    const iso = String(t.docs_deadline).slice(0, 10);
    const r = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
      role: 'HEAD_TO',
      body: { field: 'docs_deadline', value: iso }
    });
    assert(r.ok, 'HEAD_TO должен менять срок подачи: HTTP ' + r.status + ' — ' + JSON.stringify(r.data).slice(0, 200));
  });

  // РП в карточке просчёта и в анализе видит срок из tender.docs_deadline (см. rp_calc_modal.js
  // deadlineTone / rp_review_modal.js renderMeta). Проверяем, что перенос ТО доезжает до этой ручки.
  await check('РП видит перенесённый срок в карточке просчёта/анализа — D-237', async () => {
    const t0 = await loadTenderRow('ADMIN');
    const origIso = String(t0.docs_deadline).slice(0, 10);
    const d = new Date(origIso + 'T12:00:00');
    d.setDate(d.getDate() + 7);
    const shifted = d.toISOString().slice(0, 10);

    const r = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
      role: 'TO',
      body: { field: 'docs_deadline', value: shifted }
    });
    assert(r.ok, 'перенос ТО упал: HTTP ' + r.status);

    const seen = await api('GET', RP_REVIEW, { role: 'PM' });
    assert(seen.ok, 'PM не открыл rp-review: HTTP ' + seen.status);
    const seenTender = seen.data.tender || {};
    assert(String(seenTender.docs_deadline || '').slice(0, 10) === shifted,
      'РП видит старый срок: ' + String(seenTender.docs_deadline || '').slice(0, 10) + ' вместо ' + shifted);
    const shiftedExpected = computeAnalysisDeadline({
      docs_deadline: shifted,
      participation_paid: !!t0.participation_paid,
      created_at: t0.created_at || null
    });
    assert(String(r.data.tender.analysis_deadline || '').slice(0, 10) === shiftedExpected,
      'внутренний срок анализа не поехал вместе со сроком подачи');

    const back = await api('PATCH', '/api/tenders/registry/' + TENDER_ID, {
      role: 'TO',
      body: { field: 'docs_deadline', value: origIso }
    });
    assert(back.ok, 'не удалось вернуть исходный срок: HTTP ' + back.status);
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

  // ── 4c. D-238: внутренний срок пересчитывается и на ОБЩИХ путях записи ──
  // Реестр — не единственный путь: ванила пишет тендер через PUT /api/data/tenders/:id
  // (AsgardDB.put), общий редактор v2/PmCalcs/funnel/mobile — через PUT /api/tenders/:id.
  // До фикса срок подачи уезжал, а analysis_deadline оставался старым (РП работал по протухшему).
  const TENDER_PUT = '/api/tenders/' + TENDER_ID;
  const TENDER_DATA = '/api/data/tenders/' + TENDER_ID;

  async function dataRow() {
    const r = await api('GET', TENDER_DATA, { role: 'ADMIN' });
    const t = r.data.item || r.data.tender || r.data;
    assert(t && t.id, 'GET /api/data/tenders/:id не отдал строку: ' + JSON.stringify(r.data).slice(0, 160));
    return t;
  }

  await check('PUT /api/tenders/:id — перенос срока пересчитывает analysis_deadline — D-238', async () => {
    const t0 = await dataRow();
    const paid = !!t0.participation_paid;
    const origIso = String(t0.docs_deadline).slice(0, 10);
    const d = new Date(origIso + 'T12:00:00');
    d.setDate(d.getDate() + 10);
    const shifted = d.toISOString().slice(0, 10);
    const expected = computeAnalysisDeadline({ docs_deadline: shifted, participation_paid: paid, created_at: t0.created_at });

    const r = await api('PUT', TENDER_PUT, { role: 'TO', body: { docs_deadline: shifted } });
    assert(r.ok, 'общий редактор упал: HTTP ' + r.status + ' — ' + JSON.stringify(r.data).slice(0, 200));
    const got = String((r.data.tender || {}).analysis_deadline || '').slice(0, 10);
    assert(got === expected,
      'analysis_deadline не пересчитан общим редактором: ожидали ' + expected + ', получили ' + got);

    const back = await api('PUT', TENDER_PUT, { role: 'ADMIN', body: { docs_deadline: origIso } });
    assert(back.ok, 'не удалось вернуть срок: HTTP ' + back.status);
    assert(String((back.data.tender || {}).analysis_deadline || '').slice(0, 10) === String(t0.analysis_deadline).slice(0, 10),
      'возврат срока не вернул прежний analysis_deadline');
  });

  await check('PUT /api/data/tenders/:id — перенос срока пересчитывает analysis_deadline — D-238', async () => {
    const t0 = await dataRow();
    const paid = !!t0.participation_paid;
    const origIso = String(t0.docs_deadline).slice(0, 10);
    const d = new Date(origIso + 'T12:00:00');
    d.setDate(d.getDate() + 10);
    const shifted = d.toISOString().slice(0, 10);
    const expected = computeAnalysisDeadline({ docs_deadline: shifted, participation_paid: paid, created_at: t0.created_at });

    const r = await api('PUT', TENDER_DATA, { role: 'TO', body: { docs_deadline: shifted } });
    assert(r.ok, 'generic-путь упал: HTTP ' + r.status + ' — ' + JSON.stringify(r.data).slice(0, 200));
    const after = await dataRow();
    assert(String(after.analysis_deadline).slice(0, 10) === expected,
      'analysis_deadline не пересчитан generic-путём: ожидали ' + expected + ', получили ' + String(after.analysis_deadline).slice(0, 10));

    await api('PUT', TENDER_DATA, { role: 'ADMIN', body: { docs_deadline: origIso } });
    const restored = await dataRow();
    assert(String(restored.analysis_deadline).slice(0, 10) === String(t0.analysis_deadline).slice(0, 10),
      'возврат срока не вернул прежний analysis_deadline');
  });

  await check('PUT /api/data/tenders/:id — платное участие меняет срок анализа на −5 раб. дней — D-238', async () => {
    const t0 = await dataRow();
    if (t0.docs_deadline == null) return;
    const expected = computeAnalysisDeadline({ docs_deadline: t0.docs_deadline, participation_paid: true, created_at: t0.created_at });
    const r = await api('PUT', TENDER_DATA, { role: 'ADMIN', body: { participation_paid: true } });
    assert(r.ok, 'HTTP ' + r.status);
    const after = await dataRow();
    assert(after.participation_paid === true, 'участие не переключилось');
    assert(String(after.analysis_deadline).slice(0, 10) === expected,
      'срок анализа не учёл платное участие: ожидали ' + expected + ', получили ' + String(after.analysis_deadline).slice(0, 10));

    await api('PUT', TENDER_DATA, { role: 'ADMIN', body: { participation_paid: !!t0.participation_paid, participation_fee: t0.participation_fee } });
  });

  await check('POST /api/tenders — новый тендер получает analysis_deadline сразу — D-238', async () => {
    const iso = '2026-12-15';
    const r = await api('POST', '/api/tenders', {
      role: 'TO',
      body: { customer_name: 'SENTINEL_D238', tender_title: 'sentinel', docs_deadline: iso, tender_price: 1000 }
    });
    assert(r.ok, 'создание упало: HTTP ' + r.status + ' — ' + JSON.stringify(r.data).slice(0, 200));
    const t = r.data.tender || r.data || {};
    const expected = computeAnalysisDeadline({ docs_deadline: iso, participation_paid: false, created_at: t.created_at });
    assert(String(t.analysis_deadline || '').slice(0, 10) === expected,
      'новый тендер без внутреннего срока: ожидали ' + expected + ', получили ' + JSON.stringify(t.analysis_deadline));
    if (t.id) await api('DELETE', '/api/tenders/' + t.id, { role: 'ADMIN' });
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
