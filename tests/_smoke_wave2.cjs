/* Wave-2 smoke test (Personal Kanban + assign-pm).
 * Запуск: DB_NAME=asgard_crm_kanban_test JWT_SECRET=<from .env> node tests/_smoke_wave2.cjs
 * Сервер должен слушать на http://127.0.0.1:3120
 */
'use strict';

const jwt = require('jsonwebtoken');
const http = require('http');

const SECRET = process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })();
const BASE = 'http://127.0.0.1:3120';

function sign(user) {
  return jwt.sign({ id: user.id, login: user.login, role: user.role, pinVerified: true }, SECRET, { expiresIn: '1h' });
}

function req(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const opts = {
      method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    };
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

const PM = { id: 4610, login: 'test_pm', role: 'PM' };
const DIR = { id: 4594, login: 'test_director', role: 'DIRECTOR_GEN' };
const HEAD_PM = { id: 4608, login: 'test_head_pm', role: 'HEAD_PM' };

let passed = 0, failed = 0;
function check(name, cond, info) {
  if (cond) { passed++; console.log(`PASS  ${name}` + (info ? '  ' + info : '')); }
  else { failed++; console.log(`FAIL  ${name}` + (info ? '  ' + info : '')); }
}

(async () => {
  const tokenPm = sign(PM);
  const tokenDir = sign(DIR);
  const tokenHeadPm = sign(HEAD_PM);

  // 0. сброс substages для test_pm (на случай повтора)
  // используем include_inactive=true для просмотра всех
  const cleanup = await req('GET', '/api/personal-kanban/substages?flow_type=application&include_inactive=true', tokenPm);
  if (cleanup.body && Array.isArray(cleanup.body.items)) {
    for (const s of cleanup.body.items) {
      // soft-delete активных (если карты — DELETE вернёт 409, игнорируем)
      if (s.is_active) {
        await req('DELETE', '/api/personal-kanban/substages/' + s.id, tokenPm);
      }
    }
  }

  // 1. GET /substages?flow_type=application → 200 (массив)
  const r1 = await req('GET', '/api/personal-kanban/substages?flow_type=application', tokenPm);
  check('1.GET substages list 200', r1.status === 200 && Array.isArray(r1.body.items), 'status=' + r1.status);

  // 2. POST /substages — каноник
  const r2 = await req('POST', '/api/personal-kanban/substages', tokenPm,
    { flow_type: 'application', main_status: 'assigned', title: 'Тест-этап' });
  check('2.POST substage canonical 200', r2.status === 200 && r2.body.item?.id, 'status=' + r2.status);
  const substageId = r2.body?.item?.id;

  // 3. POST /substages — invalid main_status → 400
  const r3 = await req('POST', '/api/personal-kanban/substages', tokenPm,
    { flow_type: 'application', main_status: 'НЕ_В_КАНОНЕ', title: 'X' });
  check('3.POST invalid main_status → 400', r3.status === 400 && r3.body.error === 'invalid_main_status', 'status=' + r3.status);

  // 4. PATCH /substages/:id с version=1 → 200, version=2
  const r4 = await req('PATCH', '/api/personal-kanban/substages/' + substageId, tokenPm,
    { title: 'Тест-этап (renamed)', version: 1 });
  check('4.PATCH version=1 → 200', r4.status === 200 && r4.body.item?.version === 2, 'v=' + r4.body?.item?.version);

  // 5. PATCH с version=1 (stale) → 409 version_conflict
  const r5 = await req('PATCH', '/api/personal-kanban/substages/' + substageId, tokenPm,
    { title: 'Тест-этап (stale)', version: 1 });
  check('5.PATCH stale version → 409', r5.status === 409 && r5.body.error === 'version_conflict');

  // 6. DELETE /substages/:id → 200 (нет карт)
  const r6 = await req('DELETE', '/api/personal-kanban/substages/' + substageId, tokenPm);
  check('6.DELETE substage → 200', r6.status === 200);

  // 7. DELETE на удалённом → 200 already_inactive
  const r7 = await req('DELETE', '/api/personal-kanban/substages/' + substageId, tokenPm);
  check('7.DELETE already-soft-deleted → 200', r7.status === 200);

  // 8. POST /substages под канон tender → главный статус валиден
  const r8 = await req('POST', '/api/personal-kanban/substages', tokenPm,
    { flow_type: 'tender', main_status: 'Согласование ТКП', title: 'Сбор данных' });
  check('8.POST tender canonical 200', r8.status === 200);

  // 9. POST /:id/assign-pm — нужна заявка. Создадим прямую через director.
  const r9 = await req('POST', '/api/inbox-applications/direct', tokenDir,
    { title: 'Тест-заявка для assign-pm', body: 'Тело заявки', assign_pm_user_id: PM.id });
  check('9.POST /direct (director) 200', r9.status === 200 && r9.body.application_id, 'status=' + r9.status + ' body=' + JSON.stringify(r9.body).slice(0, 100));
  const appId = r9.body?.application_id;

  // Создаём ВТОРУЮ заявку без assignment — для теста H3 (параллельный assign-pm).
  // Сначала вставим напрямую через POST /:id/assign-pm после отдельной заявки:
  // используем POST /direct + потом сбрасываем assigned_pm_id (через psql) — нельзя из node.
  // Воспроизведём проще: 2 параллельных вызова assign-pm на ту же ЗАЯВКУ, у которой
  // assigned_pm_id уже NULL — придётся специально создать. Делаем raw INSERT через
  // direct + удалением assignment с node-pg, чтобы не плодить sleeps.
  const { Client } = require('pg');
  const pg = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_kanban_test', user: 'asgard', password: '123456789' });
  await pg.connect();
  // создаём чистую заявку без assignment
  const ins = await pg.query(
    `INSERT INTO inbox_applications (source, subject, body_preview, status, source_kind, created_by, attachment_count)
     VALUES ('manual', 'Тест-параллельный-assign', 'тело', 'ai_processed', 'manual', $1, 0) RETURNING id`, [DIR.id]);
  const cleanAppId = ins.rows[0].id;
  // Удалим возможно созданную карту (от direct-ручки она не появится — мы вставили напрямую).

  // 10. Параллельный assign-pm: один 200, другой 409
  const [pa, pb] = await Promise.all([
    req('POST', `/api/inbox-applications/${cleanAppId}/assign-pm`, tokenDir, { pm_user_id: PM.id }),
    req('POST', `/api/inbox-applications/${cleanAppId}/assign-pm`, tokenDir, { pm_user_id: HEAD_PM.id })
  ]);
  const winner = pa.status === 200 ? pa : (pb.status === 200 ? pb : null);
  const loser = pa.status === 409 ? pa : (pb.status === 409 ? pb : null);
  check('10a.parallel assign-pm one winner', !!winner, 'a=' + pa.status + ' b=' + pb.status);
  check('10b.parallel assign-pm one loser (409 already_assigned)', !!loser && loser.body.error === 'already_assigned', 'loser=' + JSON.stringify(loser?.body).slice(0, 80));

  // 11. Карта канбана появилась у победителя
  if (winner && winner.body.card_id) {
    const r11 = await req('GET', '/api/personal-kanban/cards?flow_type=application', tokenPm);
    const found = Array.isArray(r11.body?.items) && r11.body.items.find(c => c.id === winner.body.card_id);
    check('11.card visible to assigned PM', !!found || winner.body.assigned_pm_id !== PM.id,
      'card_id=' + winner.body.card_id + ' pm_assigned=' + winner.body.assigned_pm_id);
  } else {
    check('11.card_id present in winner', false, JSON.stringify(winner?.body).slice(0, 100));
  }

  // 12. POST /direct — PM назначает себе (default)
  const r12 = await req('POST', '/api/inbox-applications/direct', tokenPm,
    { title: 'Самозаявка PM', body: 'Тело' });
  check('12.PM /direct → self-assigned', r12.status === 200 && r12.body.success);

  // 13. POST /direct без assign_pm_user_id у директора → 400
  const r13 = await req('POST', '/api/inbox-applications/direct', tokenDir,
    { title: 'Без PM', body: 'тело' });
  check('13.director /direct no pm → 400', r13.status === 400);

  // 14. POST /substages PM-роль работает (без requireRoles)
  const r14 = await req('POST', '/api/personal-kanban/substages', tokenPm,
    { flow_type: 'work', main_status: 'Подготовка', title: 'Документы' });
  check('14.PM creates substage for work', r14.status === 200);

  // 15. Reminder в прошлом → 400. Используем токен реального владельца карты.
  if (winner && winner.body.card_id) {
    const ownerId = winner.body.assigned_pm_id || winner.body.pm_user_id;
    const ownerTok = ownerId === HEAD_PM.id ? tokenHeadPm : (ownerId === PM.id ? tokenPm : tokenPm);

    const r15 = await req('POST', `/api/personal-kanban/cards/${winner.body.card_id}/reminders`, ownerTok,
      { remind_at: '2020-01-01T00:00:00Z', message: 'тест' });
    check('15.reminder past → 400', r15.status === 400);

    // 16. Reminder в будущем → 200
    const future = new Date(Date.now() + 600000).toISOString();
    const r16 = await req('POST', `/api/personal-kanban/cards/${winner.body.card_id}/reminders`, ownerTok,
      { remind_at: future, message: 'тест-будущее' });
    check('16.reminder future → 200', r16.status === 200, 'status=' + r16.status + ' body=' + JSON.stringify(r16.body).slice(0, 80));

    // 17. Note
    const r17 = await req('POST', `/api/personal-kanban/cards/${winner.body.card_id}/notes`, ownerTok,
      { body: 'тестовая заметка' });
    check('17.note add → 200', r17.status === 200, 'status=' + r17.status);

    // 18. history
    const r18 = await req('GET', `/api/personal-kanban/cards/${winner.body.card_id}/history`, ownerTok);
    check('18.history → 200', r18.status === 200 && Array.isArray(r18.body.items), 'status=' + r18.status);
  }

  // cleanup: убираем созданные substages
  const all = await req('GET', '/api/personal-kanban/substages?flow_type=application&include_inactive=true', tokenPm);
  if (all.body?.items) for (const s of all.body.items) {
    if (s.is_active) await req('DELETE', '/api/personal-kanban/substages/' + s.id, tokenPm);
  }
  const all2 = await req('GET', '/api/personal-kanban/substages?flow_type=work&include_inactive=true', tokenPm);
  if (all2.body?.items) for (const s of all2.body.items) {
    if (s.is_active) await req('DELETE', '/api/personal-kanban/substages/' + s.id, tokenPm);
  }
  await pg.end();

  console.log(`\n=== RESULTS ===  passed=${passed}  failed=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();
