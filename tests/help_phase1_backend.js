/* eslint-disable */
/**
 * Фаза 1+2 backend e2e тесты на клоне asgard_crm_test.
 * Запуск: node tests/help_phase1_backend.js
 * Требует: тест-сервер на :3120 + DB_NAME=asgard_crm_test
 */
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3120';
const { Client } = require('pg');

const PG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: 5432,
  user: 'asgard',
  password: '123456789',
  database: 'asgard_crm_test'
};

let pass = 0, fail = 0;
const errors = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else      { fail++; errors.push(`${name}${extra ? ` :: ${extra}`:''}`); console.log(`❌ ${name}${extra?` :: ${extra}`:''}`); }
}

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch (e) { data = null; }
  return { status: r.status, data };
}

async function login(loginName, pin) {
  const a = await api('POST', '/api/auth/login', { login: loginName, password: 'Test123!' });
  if (a.status !== 200) throw new Error(`login failed for ${loginName}: ${a.status} ${JSON.stringify(a.data)}`);
  const b = await api('POST', '/api/auth/verify-pin', { pin }, a.data.token);
  if (b.status !== 200) throw new Error(`pin failed for ${loginName}: ${b.status}`);
  return { token: b.data.token, user: b.data.user };
}

(async () => {
  console.log('=== HELP MODULE Backend E2E (Phase 1+2) ===\n');

  // === Bootstrap ===
  const pg = new Client(PG); await pg.connect();
  // На клон есть test_pm/test_director. Найдём ещё PM и TO для assignee/redirect/escalate.
  const otherTO = (await pg.query("SELECT id, name, role FROM users WHERE role='TO' AND is_active=true AND login NOT LIKE 'test_%' LIMIT 2")).rows;
  const otherPM = (await pg.query("SELECT id, name, role FROM users WHERE role='PM' AND is_active=true AND login NOT LIKE 'test_%' LIMIT 2")).rows;
  const headTO  = (await pg.query("SELECT id, name, role FROM users WHERE role='HEAD_TO' AND is_active=true LIMIT 1")).rows[0];
  const buh     = (await pg.query("SELECT id, name, role FROM users WHERE role='BUH' AND is_active=true LIMIT 1")).rows[0];
  // Создаём отключённого юзера для теста inactive
  let inactive  = (await pg.query("SELECT id FROM users WHERE login='help_test_inactive' LIMIT 1")).rows[0];
  if (!inactive) {
    const r = await pg.query("INSERT INTO users (login, name, role, is_active, password_hash, must_change_password) VALUES ('help_test_inactive','Inactive User','TO', false, 'x', false) RETURNING id");
    inactive = r.rows[0];
  } else {
    await pg.query("UPDATE users SET is_active=false WHERE id=$1", [inactive.id]);
  }

  console.log('Bootstrap users:', { otherTO: otherTO.map(u=>u.name), otherPM: otherPM.map(u=>u.name), headTO: headTO?.name, buh: buh?.name, inactive: inactive.id });

  // Берём test_pm и test_director как реальных юзеров, но токены — через JWT helper (не зависим от PIN)
  const pmRow  = (await pg.query("SELECT id FROM users WHERE login='test_pm' LIMIT 1")).rows[0];
  const dirRow = (await pg.query("SELECT id FROM users WHERE login='test_director' LIMIT 1")).rows[0];
  if (!pmRow || !dirRow) throw new Error('test_pm/test_director не найдены');
  const pm  = await login_other(pg, pmRow.id);
  const dir = await login_other(pg, dirRow.id);
  console.log(`logged: PM=${pm.user.id}, DIR=${dir.user.id}\n`);

  // Очистка прошлых help-задач от теста (свежий прогон)
  await pg.query("DELETE FROM tasks WHERE title LIKE 'TEST-HELP%' OR title LIKE 'TEST-DIR%'");

  // ──────────────────────────────────────────────────────────
  // 1. RBAC: PM не может создавать directive
  // ──────────────────────────────────────────────────────────
  {
    const r = await api('POST','/api/tasks', { assignee_id: otherTO[0].id, title:'TEST-DIR forbid', task_kind:'directive' }, pm.token);
    ok('1. PM → POST directive → 403', r.status === 403, `got ${r.status}`);
  }

  // 2. Director может directive
  {
    const r = await api('POST','/api/tasks', { assignee_id: otherTO[0].id, title:'TEST-DIR ok', task_kind:'directive', priority:'high' }, dir.token);
    ok('2. DIRECTOR → POST directive → 200', r.status === 200 && r.data.task?.task_kind === 'directive');
    if (r.status === 200) {
      ok('2a. directive БЕЗ chat_id (чат не создаётся)', !r.data.task.chat_id);
    }
  }

  // 3. PM создаёт help → 200 + chat
  let helpTaskId, helpChatId;
  {
    const r = await api('POST','/api/tasks', {
      assignee_id: otherTO[0].id,
      title: 'TEST-HELP basic',
      description: 'Помогите найти ТЗ по объекту X',
      task_kind: 'help',
      priority: 'high',
      deadline: new Date(Date.now() + 24*3600*1000).toISOString(),
      watcher_ids: otherPM.length ? [otherPM[0].id] : []
    }, pm.token);
    ok('3. PM → POST help → 200', r.status === 200, JSON.stringify(r.data));
    helpTaskId = r.data?.task?.id;
    helpChatId = r.data?.task?.chat_id || r.data?.chat?.id;
    ok('3a. task.task_kind === help', r.data?.task?.task_kind === 'help');
    ok('3b. chat_id заполнен', !!helpChatId, `chat_id=${helpChatId}`);
    // Проверка БД: чат существует, привязан, pinned card + system msg
    if (helpChatId) {
      const ch = await pg.query('SELECT entity_type, entity_id, type, archived_at FROM chats WHERE id=$1',[helpChatId]);
      ok('3c. chats.entity_type=task', ch.rows[0]?.entity_type === 'task');
      ok('3d. chats.entity_id == task.id', ch.rows[0]?.entity_id === helpTaskId);
      ok('3e. chat не архивирован', !ch.rows[0]?.archived_at);
      const msgs = await pg.query("SELECT message_type, is_system FROM chat_messages WHERE chat_id=$1 ORDER BY id", [helpChatId]);
      ok('3f. есть pinned task_card', msgs.rows.some(m=>m.message_type==='task_card'));
      ok('3g. есть system msg при создании', msgs.rows.some(m=>m.is_system === true));
      const members = await pg.query('SELECT user_id FROM chat_group_members WHERE chat_id=$1',[helpChatId]);
      const expectedMembers = new Set([pm.user.id, otherTO[0].id, ...(otherPM.length?[otherPM[0].id]:[])]);
      ok('3h. участники: creator+assignee+watcher', members.rows.length === expectedMembers.size);
    }
  }

  // 4. Самому себе → 400
  {
    const r = await api('POST','/api/tasks', { assignee_id: pm.user.id, title:'TEST-HELP self', task_kind:'help' }, pm.token);
    ok('4. Help самому себе → 400', r.status === 400);
  }

  // 5. Inactive user → 400
  {
    const r = await api('POST','/api/tasks', { assignee_id: inactive.id, title:'TEST-HELP inactive', task_kind:'help' }, pm.token);
    ok('5. Help inactive юзеру → 400', r.status === 400);
  }

  // 6. Watcher лимит (>20) → 400
  {
    const fakeIds = Array.from({length: 21}, (_,i)=> i+100000);
    const r = await api('POST','/api/tasks', { assignee_id: otherTO[0].id, title:'TEST-HELP many watchers', task_kind:'help', watcher_ids: fakeIds }, pm.token);
    ok('6. watcher_ids > 20 → 400', r.status === 400);
  }

  // 7. Title пустой → 400
  {
    const r = await api('POST','/api/tasks', { assignee_id: otherTO[0].id, title:'   ', task_kind:'help' }, pm.token);
    ok('7. Пустой title → 400', r.status === 400);
  }

  // 8. /help/inbox: assignee видит задачу
  {
    const assigneeToken = (await login_other(pg, otherTO[0].id))?.token;
    if (assigneeToken) {
      const r = await api('GET','/api/tasks/help/inbox', null, assigneeToken);
      ok('8. /help/inbox: assignee видит свою help-задачу', r.status === 200 && r.data.tasks.some(t=>t.id===helpTaskId));
    } else {
      console.log('⚠️ skip 8 (нет токена assignee)');
    }
  }

  // 9. /help/outbox: creator видит
  {
    const r = await api('GET','/api/tasks/help/outbox', null, pm.token);
    ok('9. /help/outbox: creator видит help-задачу', r.status === 200 && r.data.tasks.some(t=>t.id===helpTaskId));
  }

  // 10. /help/stats: creator
  {
    const r = await api('GET','/api/tasks/help/stats', null, pm.token);
    ok('10. /help/stats: outbox_active >= 1', r.status === 200 && parseInt(r.data.outbox_active) >= 1);
  }

  // 11. Чужой не может accept
  if (buh) {
    const t = await login_other(pg, buh.id);
    if (t) {
      const r = await api('PUT', `/api/tasks/${helpTaskId}/accept`, {}, t.token);
      ok('11. Чужой /accept → 403', r.status === 403);
    }
  }

  // 12. Assignee accept
  {
    const t = await login_other(pg, otherTO[0].id);
    if (t) {
      const r = await api('PUT', `/api/tasks/${helpTaskId}/accept`, {}, t.token);
      ok('12. assignee /accept → 200', r.status === 200);
      const row = (await pg.query('SELECT status FROM tasks WHERE id=$1',[helpTaskId])).rows[0];
      ok('12a. статус → accepted', row.status === 'accepted');
      const sysMsgs = await pg.query("SELECT message FROM chat_messages WHERE chat_id=$1 AND is_system=true ORDER BY id DESC LIMIT 1",[helpChatId]);
      ok('12b. system msg о принятии в чате', /прин/i.test(sysMsgs.rows[0]?.message || ''));
    }
  }

  // 13. Decline без причины → 400
  {
    const t = await login_other(pg, otherTO[0].id);
    const r = await api('PUT', `/api/tasks/${helpTaskId}/decline`, {}, t.token);
    ok('13. decline без reason → 400', r.status === 400);
    const r2 = await api('PUT', `/api/tasks/${helpTaskId}/decline`, { reason: 'ok' }, t.token);
    ok('13a. decline reason<5 → 400', r2.status === 400);
  }

  // 14. Decline OK
  {
    const t = await login_other(pg, otherTO[0].id);
    const r = await api('PUT', `/api/tasks/${helpTaskId}/decline`, { reason: 'Сейчас сильно загружен срочным тендером' }, t.token);
    ok('14. decline OK → 200', r.status === 200);
    const row = (await pg.query('SELECT status, declined_reason FROM tasks WHERE id=$1',[helpTaskId])).rows[0];
    ok('14a. статус → declined', row.status === 'declined');
    ok('14b. declined_reason сохранён', /загружен/.test(row.declined_reason));
  }

  // 15. Reassign после declined
  if (otherTO.length >= 2) {
    const r = await api('PUT', `/api/tasks/${helpTaskId}/reassign`, { new_assignee_id: otherTO[1].id }, pm.token);
    ok('15. /reassign после declined → 200', r.status === 200, JSON.stringify(r.data));
    const row = (await pg.query('SELECT status, assignee_id, declined_reason FROM tasks WHERE id=$1',[helpTaskId])).rows[0];
    ok('15a. assignee сменился', row.assignee_id === otherTO[1].id);
    ok('15b. статус → new', row.status === 'new');
    ok('15c. declined_reason очищен', !row.declined_reason);
  }

  // 16. Чужой reassign → 403
  if (buh) {
    const t = await login_other(pg, buh.id);
    if (t) {
      const r = await api('PUT', `/api/tasks/${helpTaskId}/reassign`, { new_assignee_id: otherTO[0].id }, t.token);
      // status=new (после reassign), reassign требует status=declined → 400, и creator check → 403. Любой не-200 ОК.
      ok('16. чужой reassign → не 200', r.status !== 200);
    }
  }

  // 17. Reassign когда status != declined → 400
  {
    const r = await api('PUT', `/api/tasks/${helpTaskId}/reassign`, { new_assignee_id: otherTO[0].id }, pm.token);
    ok('17. reassign когда status!=declined → 400', r.status === 400);
  }

  // 18. Redirect — assignee (после reassign это otherTO[1]) перенаправляет на otherTO[0]
  let redirectTaskId = helpTaskId;
  if (otherTO.length >= 2) {
    const tAssignee = await login_other(pg, otherTO[1].id);
    const r = await api('PUT', `/api/tasks/${redirectTaskId}/redirect`, { new_assignee_id: otherTO[0].id, reason: 'Это его компетенция, он лучше разбирается' }, tAssignee.token);
    ok('18. /redirect (1-й раз) → 200', r.status === 200);
    const row = (await pg.query('SELECT assignee_id, redirected_once, redirected_from FROM tasks WHERE id=$1',[redirectTaskId])).rows[0];
    ok('18a. assignee = новому', row.assignee_id === otherTO[0].id);
    ok('18b. redirected_once = true', row.redirected_once === true);
    ok('18c. redirected_from = старый', row.redirected_from === otherTO[1].id);
    // Старый в watchers?
    const w = await pg.query('SELECT 1 FROM task_watchers WHERE task_id=$1 AND user_id=$2',[redirectTaskId, otherTO[1].id]);
    ok('18d. старый assignee в watchers', w.rows.length === 1);
  }

  // 19. Redirect 2-й раз → 409
  {
    const tAssignee = await login_other(pg, otherTO[0].id);
    if (tAssignee) {
      const target = otherTO.length >= 2 ? otherTO[1].id : (buh?.id);
      if (target) {
        const r = await api('PUT', `/api/tasks/${redirectTaskId}/redirect`, { new_assignee_id: target, reason: 'попробую ещё раз' }, tAssignee.token);
        ok('19. /redirect (2-й раз) → 409', r.status === 409);
      }
    }
  }

  // 20. Redirect в creator → 400
  {
    const tAssignee = await login_other(pg, otherTO[0].id);
    if (tAssignee) {
      // Используем свежую задачу
      const r2 = await api('POST','/api/tasks', { assignee_id: otherTO[0].id, title:'TEST-HELP redir-to-creator', task_kind:'help' }, pm.token);
      const tid = r2.data?.task?.id;
      if (tid) {
        const r = await api('PUT', `/api/tasks/${tid}/redirect`, { new_assignee_id: pm.user.id, reason: 'попытка зацикливания' }, tAssignee.token);
        ok('20. redirect → creator → 400', r.status === 400);
      }
    }
  }

  // 21. Complete → status=done + chat архивирован
  {
    const tAssignee = await login_other(pg, otherTO[0].id);
    if (tAssignee) {
      // accept потом complete
      await api('PUT', `/api/tasks/${redirectTaskId}/accept`, {}, tAssignee.token);
      const r = await api('PUT', `/api/tasks/${redirectTaskId}/complete`, { comment: 'Готово, ссылка в чате' }, tAssignee.token);
      ok('21. /complete → 200', r.status === 200, JSON.stringify(r.data));
      const row = (await pg.query('SELECT status FROM tasks WHERE id=$1',[redirectTaskId])).rows[0];
      ok('21a. status=done', row.status === 'done');
      const ch = (await pg.query('SELECT archived_at, is_readonly FROM chats WHERE id=$1',[helpChatId])).rows[0];
      ok('21b. chat архивирован', !!ch.archived_at);
      ok('21c. chat readonly', ch.is_readonly === true);
    }
  }

  // 22. Escalate — нужна свежая declined задача с TO assignee
  {
    if (otherTO.length && headTO) {
      // Создать help, declined, escalate
      const c = await api('POST','/api/tasks', { assignee_id: otherTO[0].id, title:'TEST-HELP escalate', task_kind:'help' }, pm.token);
      const tid = c.data?.task?.id;
      const tA = await login_other(pg, otherTO[0].id);
      await api('PUT', `/api/tasks/${tid}/decline`, { reason: 'занят на стройке' }, tA.token);
      const r = await api('PUT', `/api/tasks/${tid}/escalate`, {}, pm.token);
      ok('22. /escalate после declined → 200', r.status === 200, JSON.stringify(r.data));
      const row = (await pg.query('SELECT assignee_id, escalated_to, escalated_at FROM tasks WHERE id=$1',[tid])).rows[0];
      ok('22a. assignee = HEAD_TO', row.assignee_id === headTO.id);
      ok('22b. escalated_to заполнен', row.escalated_to === headTO.id);
    } else {
      console.log('⚠️ skip 22 (нет HEAD_TO)');
    }
  }

  // 23. Watchers bulk
  if (otherPM.length) {
    const c = await api('POST','/api/tasks', { assignee_id: otherTO[0].id, title:'TEST-HELP watchers', task_kind:'help' }, pm.token);
    const tid = c.data?.task?.id;
    const r = await api('POST', `/api/tasks/${tid}/watchers/bulk`, { user_ids: [otherPM[0].id, ...(buh?[buh.id]:[])] }, pm.token);
    ok('23. /watchers/bulk → 200', r.status === 200);
    ok('23a. added >= 1', r.data?.added >= 1);
    // Bulk: бекенд должен добавить участников в чат
    const ch = (await pg.query('SELECT chat_id FROM tasks WHERE id=$1',[tid])).rows[0]?.chat_id;
    if (ch) {
      const inChat = await pg.query('SELECT 1 FROM chat_group_members WHERE chat_id=$1 AND user_id=$2',[ch, otherPM[0].id]);
      ok('23b. watcher добавлен в чат', inChat.rows.length === 1);
    }
  }

  // 24. Bulk over limit → 400
  if (otherPM.length) {
    const c = await api('POST','/api/tasks', { assignee_id: otherTO[0].id, title:'TEST-HELP bulk-limit', task_kind:'help' }, pm.token);
    const tid = c.data?.task?.id;
    const ids = Array.from({length: 25}, (_,i)=> 1000000 + i); // явно больше лимита
    const r = await api('POST', `/api/tasks/${tid}/watchers/bulk`, { user_ids: ids }, pm.token);
    ok('24. bulk > 20 → 400', r.status === 400);
  }

  // 25. RBAC: чужой не видит help-task детали
  if (buh) {
    const tBuh = await login_other(pg, buh.id);
    if (tBuh) {
      const r = await api('GET', `/api/tasks/${helpTaskId}`, null, tBuh.token);
      ok('25. чужой GET /:id → 403', r.status === 403);
    }
  }

  await pg.end();
  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('\nFAILED:'); errors.forEach(e=>console.log(' -', e)); process.exit(1); }
})().catch(e => { console.error('FATAL:', e); process.exit(2); });

// Логин по user_id — выдаст временный токен через trusted helper
// Поскольку у нас нет универсального login by id, используем JWT secret напрямую
async function login_other(pg, userId) {
  const u = (await pg.query('SELECT id, login, name, role FROM users WHERE id=$1',[userId])).rows[0];
  if (!u) return null;
  const jwt = require('jsonwebtoken');
  const payload = { id: u.id, login: u.login, name: u.name, role: u.role, email: null, pinVerified: true };
  const token = jwt.sign(payload, process.env.JWT_SECRET || 'asgard-jwt-secret-2026', { expiresIn: '1h' });
  return { token, user: u };
}
