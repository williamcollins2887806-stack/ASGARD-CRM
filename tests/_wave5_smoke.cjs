/* Wave-5 smoke test (Cross-cutting hooks: tender→work, PUT tender, accept inbox, H4 close).
 *
 * Запуск: DB_NAME=asgard_crm_kanban_test JWT_SECRET=<from .env> node tests/_wave5_smoke.cjs
 * Сервер слушает http://127.0.0.1:3120 (тест-клон).
 *
 * Проверяет 4 поведения:
 *   1. POST /tenders/:id/assign-work-pm → появляется карта personal_kanban_cards
 *      (flow_type='work', entity_kind='work', owner=pm, main_status='Подготовка'),
 *      history(action='create').
 *   2. PUT /tenders/:id с новым responsible_pm_id → карта обновилась
 *      (новый owner, transferred_from_user_id/transferred_at заполнены), history(action='transfer').
 *   3. POST /inbox-applications/:id/accept → карта переведена на entity_kind='tender',
 *      entity_id=new tender.id, history(action='convert').
 *   4. DELETE /inbox-applications/:id → карта закрылась (is_closed=true), history(action='close').
 */
'use strict';

const jwt = require('jsonwebtoken');
const http = require('http');
const { Client } = require('pg');

const SECRET = process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })();
const BASE = 'http://127.0.0.1:3120';

function sign(u) { return jwt.sign({ id: u.id, login: u.login, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' }); }

function req(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } };
    if (data) opts.headers['Content-Length'] = data.length;
    const r = http.request(opts, res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', c => buf += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch (_) { parsed = buf; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const PM       = { id: 4610, login: 'test_pm',       role: 'PM' };
const HEAD_PM  = { id: 4608, login: 'test_head_pm',  role: 'HEAD_PM' };
const HEAD_TO  = { id: 4609, login: 'test_head_to',  role: 'HEAD_TO' };
const DIR      = { id: 4594, login: 'test_director', role: 'DIRECTOR_GEN' };

let passed = 0, failed = 0;
const trace = [];
function check(name, cond, info) {
  if (cond) { passed++; console.log(`PASS  ${name}` + (info ? '  ' + info : '')); }
  else { failed++; console.log(`FAIL  ${name}` + (info ? '  ' + info : '')); trace.push({ name, info }); }
}

(async () => {
  const pg = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_kanban_test', user: 'asgard', password: '123456789' });
  await pg.connect();

  const tokenPm     = sign(PM);
  const tokenHeadPm = sign(HEAD_PM);
  const tokenHeadTo = sign(HEAD_TO);
  const tokenDir    = sign(DIR);

  // ─── PRE-CLEANUP: убираем карты тестовых сценариев, оставшиеся от прошлых прогонов ──
  // Стираем карты test_pm/test_head_pm с tender/work entity_id из служебного префикса
  // (мы создадим тендеры с tender_title начинающимся с 'WAVE5_SMOKE_').
  await pg.query(
    `DELETE FROM personal_kanban_card_history
       WHERE card_id IN (
         SELECT c.id FROM personal_kanban_cards c
          WHERE c.owner_user_id IN ($1, $2)
            AND (
              (c.entity_kind='tender'  AND c.entity_id IN (SELECT id FROM tenders WHERE tender_title LIKE 'WAVE5_SMOKE_%'))
              OR (c.entity_kind='work' AND c.entity_id IN (SELECT id FROM works WHERE work_title LIKE 'WAVE5_SMOKE_%'))
              OR (c.entity_kind='inbox_application' AND c.entity_id IN (SELECT id FROM inbox_applications WHERE subject LIKE 'WAVE5_SMOKE_%'))
            )
       )`,
    [PM.id, HEAD_PM.id]);
  await pg.query(
    `DELETE FROM personal_kanban_cards
       WHERE owner_user_id IN ($1, $2)
         AND (
           (entity_kind='tender'  AND entity_id IN (SELECT id FROM tenders WHERE tender_title LIKE 'WAVE5_SMOKE_%'))
           OR (entity_kind='work' AND entity_id IN (SELECT id FROM works WHERE work_title LIKE 'WAVE5_SMOKE_%'))
           OR (entity_kind='inbox_application' AND entity_id IN (SELECT id FROM inbox_applications WHERE subject LIKE 'WAVE5_SMOKE_%'))
         )`,
    [PM.id, HEAD_PM.id]);
  // удаляем тестовые works/tenders/inbox от старых прогонов
  // (порядок: works → inbox_applications → tenders, т.к. inbox.linked_tender_id → tenders FK)
  await pg.query(`DELETE FROM works WHERE work_title LIKE 'WAVE5_SMOKE_%'`);
  await pg.query(`DELETE FROM inbox_applications WHERE subject LIKE 'WAVE5_SMOKE_%'`);
  await pg.query(`DELETE FROM tenders WHERE tender_title LIKE 'WAVE5_SMOKE_%'`);

  // ────────────────────────────────────────────────────────────────────────────
  // 1. assign-work-pm → создаётся карта flow_type='work' + history(action='create').
  // ────────────────────────────────────────────────────────────────────────────
  // Готовим тендер со статусом «Выиграли», без назначенной работы и без site_id.
  const tIns = await pg.query(
    `INSERT INTO tenders (tender_title, customer_name, tender_status, period, created_by, created_at, updated_at, tender_price)
     VALUES ($1, 'WAVE5 Customer', 'Выиграли', '2026-06', $2, NOW(), NOW(), 100000)
     RETURNING id`,
    ['WAVE5_SMOKE_assign_work_pm', DIR.id]);
  const tenderId1 = tIns.rows[0].id;
  // подчищаем work_assigned_* (на случай старых данных)
  await pg.query(`UPDATE tenders SET work_assigned_pm_id=NULL, work_assigned_at=NULL, work_assigned_by_user_id=NULL WHERE id=$1`, [tenderId1]);

  const r1 = await req('POST', `/api/tenders/${tenderId1}/assign-work-pm`, tokenHeadTo, { pm_id: PM.id, work_comment: 'wave5 smoke' });
  check('1a.assign-work-pm 200', r1.status === 200 && r1.body.work_id, 'status=' + r1.status + ' body=' + JSON.stringify(r1.body).slice(0, 120));
  const workId = r1.body?.work_id;
  const kanbanCardId1 = r1.body?.kanban_card_id;
  check('1b.assign-work-pm возвращает kanban_card_id', !!kanbanCardId1, 'card_id=' + kanbanCardId1);

  if (kanbanCardId1) {
    const card = await pg.query(
      `SELECT id, owner_user_id, flow_type, entity_kind, entity_id, current_main_status, is_closed
         FROM personal_kanban_cards WHERE id = $1`, [kanbanCardId1]);
    const c = card.rows[0];
    check('1c.card flow_type=work', c && c.flow_type === 'work', 'flow=' + c?.flow_type);
    check('1d.card entity_kind=work',  c && c.entity_kind === 'work', 'kind=' + c?.entity_kind);
    check('1e.card entity_id=workId',  c && c.entity_id === workId, 'eid=' + c?.entity_id + ' workId=' + workId);
    check('1f.card owner=PM',          c && c.owner_user_id === PM.id, 'owner=' + c?.owner_user_id);
    check('1g.card main_status=Подготовка', c && c.current_main_status === 'Подготовка', 'st=' + c?.current_main_status);
    check('1h.card is_closed=false',   c && c.is_closed === false);
    const h = await pg.query(
      `SELECT action, to_main_status FROM personal_kanban_card_history
        WHERE card_id=$1 ORDER BY id`, [kanbanCardId1]);
    check('1i.history action=create',  h.rows[0]?.action === 'create' && h.rows[0]?.to_main_status === 'Подготовка',
      'rows=' + h.rows.length + ' first=' + JSON.stringify(h.rows[0]));
    // Wave-5 round-1 F-1: новый возвращаемый kanban_action для пути create.
    check('1j.kanban_action=create (без существующей tender-карты)',
      r1.body?.kanban_action === 'create', 'kanban_action=' + r1.body?.kanban_action);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 1bis. Wave-5 round-1 F-1+F-2: если у PM УЖЕ есть открытая tender-карта на этот
  //       тендер, assign-work-pm должен КОНВЕРТИРОВАТЬ её (id неизменен), а не
  //       создавать вторую work-карту.
  //   - resp.kanban_action='convert'
  //   - resp.kanban_card_id == исходному id предварительно созданной tender-карты
  //   - карта обновлена: entity_kind='work', entity_id=work.id, flow_type='work',
  //     current_main_status='Подготовка'
  //   - в history последняя запись action='convert' + note содержит 'assign-work-pm'
  //   - count карт PM по (tender entity_kind или work entity_kind) на эту цепочку = 1
  // ────────────────────────────────────────────────────────────────────────────
  const tIns1bis = await pg.query(
    `INSERT INTO tenders (tender_title, customer_name, tender_status, period, created_by, responsible_pm_id, created_at, updated_at, tender_price)
     VALUES ($1, 'WAVE5 Cust1bis', 'Выиграли', '2026-06', $2, $3, NOW(), NOW(), 75000)
     RETURNING id`,
    ['WAVE5_SMOKE_assign_work_pm_convert', DIR.id, PM.id]);
  const tenderId1bis = tIns1bis.rows[0].id;
  await pg.query(`UPDATE tenders SET work_assigned_pm_id=NULL, work_assigned_at=NULL, work_assigned_by_user_id=NULL WHERE id=$1`, [tenderId1bis]);

  // Создаём предварительную tender-карту у PM (имитируем «РП уже работал в Согласовании ТКП»).
  const preIns = await pg.query(
    `INSERT INTO personal_kanban_cards
       (owner_user_id, flow_type, entity_kind, entity_id, current_main_status,
        last_moved_at, version, is_closed)
     VALUES ($1, 'tender', 'tender', $2, 'Согласование ТКП', now(), 1, FALSE)
     RETURNING id, version`,
    [PM.id, tenderId1bis]);
  const preTenderCardId = preIns.rows[0].id;
  // история create предварительной карты (чтобы потом убедиться, что convert добавился сверху).
  await pg.query(
    `INSERT INTO personal_kanban_card_history
       (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, note, action)
     VALUES ($1, NULL, NULL, NULL, 'Согласование ТКП', $2, 'pre-existing tender-card for 1bis', 'create')`,
    [preTenderCardId, DIR.id]);

  const r1bis = await req('POST', `/api/tenders/${tenderId1bis}/assign-work-pm`, tokenHeadTo,
    { pm_id: PM.id, work_comment: 'wave5 1bis convert' });
  check('1bis.a assign-work-pm 200', r1bis.status === 200 && r1bis.body.work_id,
    'status=' + r1bis.status + ' body=' + JSON.stringify(r1bis.body).slice(0, 160));
  const work1bisId = r1bis.body?.work_id;

  check('1bis.b resp.kanban_action=convert',
    r1bis.body?.kanban_action === 'convert', 'kanban_action=' + r1bis.body?.kanban_action);
  check('1bis.c resp.kanban_card_id == preTenderCardId',
    r1bis.body?.kanban_card_id === preTenderCardId,
    'resp=' + r1bis.body?.kanban_card_id + ' pre=' + preTenderCardId);

  // Карта обновилась
  const cardAfterConv = await pg.query(
    `SELECT id, owner_user_id, flow_type, entity_kind, entity_id, current_main_status, is_closed, version
       FROM personal_kanban_cards WHERE id = $1`, [preTenderCardId]);
  const cv = cardAfterConv.rows[0];
  check('1bis.d card flow_type=work',  cv && cv.flow_type === 'work',  'flow=' + cv?.flow_type);
  check('1bis.e card entity_kind=work', cv && cv.entity_kind === 'work', 'kind=' + cv?.entity_kind);
  check('1bis.f card entity_id=workId', cv && cv.entity_id === work1bisId,
    'eid=' + cv?.entity_id + ' work=' + work1bisId);
  check('1bis.g card owner=PM',         cv && cv.owner_user_id === PM.id, 'owner=' + cv?.owner_user_id);
  check('1bis.h card main_status=Подготовка',
    cv && cv.current_main_status === 'Подготовка', 'st=' + cv?.current_main_status);
  check('1bis.i card is_closed=false',  cv && cv.is_closed === false);
  check('1bis.j version > 1',           cv && cv.version > 1, 'v=' + cv?.version);

  // НЕТ дополнительной карты — count карт PM на (tender=tenderId1bis OR work=work1bisId) = 1.
  const dupCheck = await pg.query(
    `SELECT id, entity_kind, entity_id, is_closed FROM personal_kanban_cards
      WHERE owner_user_id = $1
        AND (
          (entity_kind = 'tender' AND entity_id = $2)
          OR (entity_kind = 'work'  AND entity_id = $3)
        )`,
    [PM.id, tenderId1bis, work1bisId]);
  check('1bis.k единственная карта (нет дубля work+tender)',
    dupCheck.rows.length === 1 && dupCheck.rows[0].id === preTenderCardId,
    'rows=' + dupCheck.rows.length + ' ids=' + JSON.stringify(dupCheck.rows.map(r => r.id)));

  // В history последняя запись action='convert' + note содержит 'assign-work-pm'.
  const histConv1bis = await pg.query(
    `SELECT action, note, from_main_status, to_main_status
       FROM personal_kanban_card_history
      WHERE card_id = $1 ORDER BY id DESC LIMIT 1`,
    [preTenderCardId]);
  const lastH = histConv1bis.rows[0];
  check('1bis.l history последняя запись action=convert',
    lastH && lastH.action === 'convert', 'action=' + lastH?.action);
  check('1bis.m history.note содержит "assign-work-pm"',
    lastH && typeof lastH.note === 'string' && lastH.note.includes('assign-work-pm'),
    'note=' + JSON.stringify(lastH?.note));
  check('1bis.n history.to_main_status=Подготовка',
    lastH && lastH.to_main_status === 'Подготовка', 'to=' + lastH?.to_main_status);

  // Помечаем работу WAVE5_SMOKE_-префиксом чтобы её удалил post-cleanup
  // (insert через эндпоинт ставит work_title = tender.tender_title — уже WAVE5_SMOKE_*).

  // ────────────────────────────────────────────────────────────────────────────
  // 2. PUT /tenders/:id с новым responsible_pm_id → карта transferred.
  // ────────────────────────────────────────────────────────────────────────────
  // Готовим тендер с responsible_pm_id=PM, статусом 'Новый' (для перехода).
  const tIns2 = await pg.query(
    `INSERT INTO tenders (tender_title, customer_name, tender_status, period, created_by, responsible_pm_id, created_at, updated_at, tender_price)
     VALUES ($1, 'WAVE5 Cust2', 'Новый', '2026-06', $2, $3, NOW(), NOW(), 50000)
     RETURNING id`,
    ['WAVE5_SMOKE_put_responsible', DIR.id, PM.id]);
  const tenderId2 = tIns2.rows[0].id;
  // создаём карту через PUT (никакой не было): меняем responsible_pm_id на самого же PM → no-op,
  // далее меняем на HEAD_PM → должна создаться или transfer-нуться.
  // Сначала создадим карту: смена с PM → HEAD_PM. (Карты до этого нет.)
  const r2a = await req('PUT', `/api/tenders/${tenderId2}`, tokenDir, { responsible_pm_id: HEAD_PM.id });
  check('2a.PUT tender responsible 200', r2a.status === 200, 'status=' + r2a.status + ' body=' + JSON.stringify(r2a.body).slice(0, 120));

  // Должна появиться карта у HEAD_PM (т.к. до этого карты не было)
  const cardAfterCreate = await pg.query(
    `SELECT id, owner_user_id, current_main_status, transferred_from_user_id
       FROM personal_kanban_cards
      WHERE entity_kind='tender' AND entity_id=$1`, [tenderId2]);
  check('2b.card создана у HEAD_PM', cardAfterCreate.rows.length === 1 && cardAfterCreate.rows[0].owner_user_id === HEAD_PM.id,
    'rows=' + cardAfterCreate.rows.length + ' owner=' + cardAfterCreate.rows[0]?.owner_user_id);
  const tenderCardId = cardAfterCreate.rows[0]?.id;

  // Теперь повторный PUT: HEAD_PM → PM. Должен быть transfer (а не дубль).
  const r2c = await req('PUT', `/api/tenders/${tenderId2}`, tokenDir, { responsible_pm_id: PM.id });
  check('2c.PUT tender responsible PM 200', r2c.status === 200, 'status=' + r2c.status);

  const cardAfterTransfer = await pg.query(
    `SELECT id, owner_user_id, current_main_status, transferred_from_user_id, transferred_at, version
       FROM personal_kanban_cards
      WHERE id=$1`, [tenderCardId]);
  const cT = cardAfterTransfer.rows[0];
  check('2d.card owner=PM после transfer', cT && cT.owner_user_id === PM.id, 'owner=' + cT?.owner_user_id);
  check('2e.transferred_from=HEAD_PM',     cT && cT.transferred_from_user_id === HEAD_PM.id, 'from=' + cT?.transferred_from_user_id);
  check('2f.transferred_at !== null',      cT && cT.transferred_at !== null);
  check('2g.version > 1',                  cT && cT.version > 1, 'v=' + cT?.version);

  const histTransfer = await pg.query(
    `SELECT action FROM personal_kanban_card_history WHERE card_id=$1 ORDER BY id`, [tenderCardId]);
  const actions = histTransfer.rows.map(r => r.action);
  check('2h.history содержит create + transfer', actions.includes('create') && actions.includes('transfer'),
    'actions=' + JSON.stringify(actions));

  // ────────────────────────────────────────────────────────────────────────────
  // 3. inbox-app → accept → card converted (entity_kind='inbox_application' → 'tender').
  // ────────────────────────────────────────────────────────────────────────────
  // Создаём заявку напрямую в БД, назначаем PM (через assign-pm), затем accept.
  const insApp = await pg.query(
    `INSERT INTO inbox_applications (source, subject, body_preview, status, source_kind, created_by, attachment_count, source_email, source_name, ai_classification)
     VALUES ('manual', 'WAVE5_SMOKE_accept_convert', 'WAVE5 body', 'ai_processed', 'manual', $1, 0, 'wave5@test.io', 'WAVE5 Sender', 'direct_request')
     RETURNING id`, [DIR.id]);
  const appId = insApp.rows[0].id;

  // assign-pm → создаст карту inbox_application у PM
  const assignR = await req('POST', `/api/inbox-applications/${appId}/assign-pm`, tokenDir, { pm_user_id: PM.id });
  check('3a.assign-pm 200', assignR.status === 200 && assignR.body.card_id, 'status=' + assignR.status + ' body=' + JSON.stringify(assignR.body).slice(0, 120));
  const inboxCardId = assignR.body?.card_id;

  // accept → должна сконвертироваться
  const acceptR = await req('POST', `/api/inbox-applications/${appId}/accept`, tokenDir, { create_tender: true, send_email: false });
  check('3b.accept 200', acceptR.status === 200 && acceptR.body.tender_id, 'status=' + acceptR.status + ' body=' + JSON.stringify(acceptR.body).slice(0, 160));
  const newTenderId = acceptR.body?.tender_id;
  const convertedCardIdFromResp = acceptR.body?.kanban_card_id;
  check('3c.accept возвращает kanban_card_id=inboxCardId',
    convertedCardIdFromResp === inboxCardId, 'resp=' + convertedCardIdFromResp + ' inbox=' + inboxCardId);

  if (inboxCardId) {
    const conv = await pg.query(
      `SELECT id, owner_user_id, flow_type, entity_kind, entity_id, current_main_status, is_closed
         FROM personal_kanban_cards WHERE id=$1`, [inboxCardId]);
    const cc = conv.rows[0];
    check('3d.card flow_type=tender',  cc && cc.flow_type === 'tender', 'flow=' + cc?.flow_type);
    check('3e.card entity_kind=tender',cc && cc.entity_kind === 'tender', 'kind=' + cc?.entity_kind);
    check('3f.card entity_id=newTender', cc && cc.entity_id === newTenderId, 'eid=' + cc?.entity_id + ' new=' + newTenderId);
    check('3g.card main_status=Новый', cc && cc.current_main_status === 'Новый', 'st=' + cc?.current_main_status);
    const histConv = await pg.query(
      `SELECT action FROM personal_kanban_card_history WHERE card_id=$1 ORDER BY id`, [inboxCardId]);
    check('3h.history содержит convert', histConv.rows.some(r => r.action === 'convert'),
      'actions=' + JSON.stringify(histConv.rows.map(r => r.action)));
    // cleanup: пометим тендер testовым префиксом чтобы тесты следующего прогона его удалили
    if (newTenderId) {
      await pg.query(`UPDATE tenders SET tender_title = 'WAVE5_SMOKE_accepted_tender_' || $1 WHERE id = $1`, [newTenderId]);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 4. H4: DELETE inbox_application → card closed.
  // ────────────────────────────────────────────────────────────────────────────
  // Создаём отдельную заявку + карту через assign-pm, затем DELETE.
  const insApp2 = await pg.query(
    `INSERT INTO inbox_applications (source, subject, body_preview, status, source_kind, created_by, attachment_count, source_email, source_name)
     VALUES ('manual', 'WAVE5_SMOKE_h4_close', 'WAVE5 body', 'ai_processed', 'manual', $1, 0, 'wave5h4@test.io', 'WAVE5 H4')
     RETURNING id`, [DIR.id]);
  const appId2 = insApp2.rows[0].id;
  const assign2 = await req('POST', `/api/inbox-applications/${appId2}/assign-pm`, tokenDir, { pm_user_id: PM.id });
  check('4a.assign-pm для H4 200', assign2.status === 200 && assign2.body.card_id);
  const closeCardId = assign2.body?.card_id;

  const delR = await req('DELETE', `/api/inbox-applications/${appId2}`, tokenDir);
  check('4b.DELETE inbox_app 200', delR.status === 200);

  if (closeCardId) {
    const cl = await pg.query(
      `SELECT id, is_closed, version FROM personal_kanban_cards WHERE id=$1`, [closeCardId]);
    check('4c.card is_closed=true', cl.rows[0]?.is_closed === true, 'closed=' + cl.rows[0]?.is_closed);
    const histClose = await pg.query(
      `SELECT action, note FROM personal_kanban_card_history WHERE card_id=$1 ORDER BY id`, [closeCardId]);
    check('4d.history содержит close', histClose.rows.some(r => r.action === 'close'),
      'actions=' + JSON.stringify(histClose.rows.map(r => r.action)));
  }

  // ─── POST-CLEANUP ──────────────────────────────────────────────────────────
  // Удаляем созданные сущности (history каскадно через FK).
  await pg.query(`DELETE FROM personal_kanban_card_history WHERE card_id IN (
                    SELECT id FROM personal_kanban_cards
                     WHERE owner_user_id IN ($1, $2)
                       AND (
                         (entity_kind='tender'  AND entity_id IN (SELECT id FROM tenders WHERE tender_title LIKE 'WAVE5_SMOKE_%'))
                         OR (entity_kind='work' AND entity_id IN (SELECT id FROM works WHERE work_title LIKE 'WAVE5_SMOKE_%'))
                         OR (entity_kind='inbox_application' AND entity_id IN (SELECT id FROM inbox_applications WHERE subject LIKE 'WAVE5_SMOKE_%'))
                       )
                  )`, [PM.id, HEAD_PM.id]);
  await pg.query(`DELETE FROM personal_kanban_cards
                   WHERE owner_user_id IN ($1, $2)
                     AND (
                       (entity_kind='tender'  AND entity_id IN (SELECT id FROM tenders WHERE tender_title LIKE 'WAVE5_SMOKE_%'))
                       OR (entity_kind='work' AND entity_id IN (SELECT id FROM works WHERE work_title LIKE 'WAVE5_SMOKE_%'))
                       OR (entity_kind='inbox_application' AND entity_id IN (SELECT id FROM inbox_applications WHERE subject LIKE 'WAVE5_SMOKE_%'))
                     )`, [PM.id, HEAD_PM.id]);
  // Порядок важен: inbox_applications.linked_tender_id ссылается на tenders → сначала inbox, потом tenders.
  await pg.query(`DELETE FROM works WHERE work_title LIKE 'WAVE5_SMOKE_%'`);
  await pg.query(`DELETE FROM inbox_applications WHERE subject LIKE 'WAVE5_SMOKE_%'`);
  await pg.query(`DELETE FROM tenders WHERE tender_title LIKE 'WAVE5_SMOKE_%'`);
  await pg.end();

  console.log(`\n=== Wave-5 smoke: ${passed} passed, ${failed} failed ===`);
  if (failed) {
    console.log('Failed checks:');
    for (const t of trace) console.log('  -', t.name, t.info || '');
    process.exit(1);
  }
  process.exit(0);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
