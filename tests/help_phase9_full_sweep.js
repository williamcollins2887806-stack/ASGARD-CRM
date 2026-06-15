/* eslint-disable */
/**
 * Phase 6+9 финальный sweep: все backend e2e + RBAC под 5 ролями + smoke API + статика.
 * Запуск: cd /var/www/asgard-test && node test_help_p9.js
 */
const BASE = 'http://127.0.0.1:3120';
const { Client } = require('pg');
const PG = { host:'127.0.0.1', port:5432, user:'asgard', password:'123456789', database:'asgard_crm_test' };

let pass = 0, fail = 0, sections = [];
const errors = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else      { fail++; errors.push(`${name}${extra?' :: '+extra:''}`); console.log(`❌ ${name}${extra?' :: '+extra:''}`); }
}
function section(s) { console.log(`\n══════════ ${s} ══════════`); sections.push(s); }

async function api(method, path, body, token) {
  const headers = { 'Content-Type':'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, { method, headers, body: body?JSON.stringify(body):undefined });
  let data = null; try { data = await r.json(); } catch (e) {}
  return { status:r.status, data };
}
function jwt_for(u) {
  return require('jsonwebtoken').sign(
    { id:u.id, login:u.login, name:u.name, role:u.role, email:null, pinVerified:true },
    'asgard-jwt-secret-2026', { expiresIn:'1h' });
}

(async () => {
  console.log('=== HELP MODULE Phase 6+9 — FINAL SWEEP ===');
  const pg = new Client(PG); await pg.connect();

  // ── BOOTSTRAP ──────────────────────────────────────────────
  // Чистка
  await pg.query("DELETE FROM tasks WHERE title LIKE 'SWEEP%'");

  // 5 ролей: PM, TO, BUH, DIRECTOR_GEN, ADMIN
  const usersByRole = {};
  for (const role of ['PM','TO','BUH','DIRECTOR_GEN','ADMIN','HEAD_TO']) {
    const u = (await pg.query(
      `SELECT id, login, name, role FROM users WHERE role=$1 AND is_active=true LIMIT 1`, [role]
    )).rows[0];
    if (u) usersByRole[role] = { ...u, token: jwt_for(u) };
  }
  console.log('Roles:', Object.keys(usersByRole).map(r => `${r}=${usersByRole[r].name}`));

  // ════════════════════════════════════════════════════════════════
  section('1. Миграции применены');
  // ════════════════════════════════════════════════════════════════
  const migs = (await pg.query("SELECT name FROM migrations WHERE name IN ('V212__tasks_help_extension','V213__help_templates_ratings')")).rows;
  ok('1.1 V212 зарегистрирован', migs.some(m => m.name === 'V212__tasks_help_extension'));
  ok('1.2 V213 зарегистрирован', migs.some(m => m.name === 'V213__help_templates_ratings'));

  const cols = (await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_name='tasks' AND column_name IN ('task_kind','chat_id','declined_reason','redirected_once','escalated_to')`)).rows;
  ok('1.3 Все 5 новых колонок есть', cols.length === 5);

  const tbls = (await pg.query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('help_templates','help_ratings')`)).rows;
  ok('1.4 help_templates + help_ratings таблицы созданы', tbls.length === 2);

  // ════════════════════════════════════════════════════════════════
  section('2. RBAC под 5 ролями: GET /tasks/help/inbox доступен всем');
  // ════════════════════════════════════════════════════════════════
  for (const role of ['PM','TO','BUH','DIRECTOR_GEN','ADMIN']) {
    if (!usersByRole[role]) continue;
    const r = await api('GET','/api/tasks/help/inbox', null, usersByRole[role].token);
    ok(`2.${role}: GET /help/inbox → 200`, r.status === 200, `${r.status}`);
  }

  // ════════════════════════════════════════════════════════════════
  section('3. Создание help-задачи: ВСЕ роли могут');
  // ════════════════════════════════════════════════════════════════
  const targetId = usersByRole.TO?.id || usersByRole.BUH?.id;
  for (const role of ['PM','TO','BUH','HEAD_TO','DIRECTOR_GEN']) {
    if (!usersByRole[role]) continue;
    if (usersByRole[role].id === targetId) continue; // нельзя самому себе
    const r = await api('POST','/api/tasks',
      { assignee_id: targetId, title:`SWEEP from ${role}`, task_kind:'help', priority:'normal' },
      usersByRole[role].token);
    ok(`3.${role}: POST /api/tasks (help) → 200`, r.status === 200, `${r.status}`);
    if (r.status === 200) {
      ok(`3.${role}-chat: chat_id создан`, !!r.data?.task?.chat_id);
    }
  }

  // ════════════════════════════════════════════════════════════════
  section('4. RBAC: directive — только DIRECTOR_ROLES');
  // ════════════════════════════════════════════════════════════════
  for (const role of ['PM','TO','BUH']) {
    if (!usersByRole[role]) continue;
    const r = await api('POST','/api/tasks',
      { assignee_id: targetId, title:`SWEEP-DIR from ${role}`, task_kind:'directive' },
      usersByRole[role].token);
    ok(`4.${role}: POST directive → 403`, r.status === 403);
  }
  for (const role of ['DIRECTOR_GEN','ADMIN']) {
    if (!usersByRole[role]) continue;
    const r = await api('POST','/api/tasks',
      { assignee_id: targetId, title:`SWEEP-DIR from ${role}`, task_kind:'directive' },
      usersByRole[role].token);
    ok(`4.${role}: POST directive → 200`, r.status === 200);
  }

  // ════════════════════════════════════════════════════════════════
  section('5. Жизненный цикл: accept → complete + chat archived');
  // ════════════════════════════════════════════════════════════════
  {
    const c = await api('POST','/api/tasks',
      { assignee_id: targetId, title:'SWEEP lifecycle', task_kind:'help' },
      usersByRole.PM?.token);
    const tid = c.data?.task?.id;
    const chatId = c.data?.task?.chat_id;

    const assignee = Object.values(usersByRole).find(u => u.id === targetId);
    const a = await api('PUT', `/api/tasks/${tid}/accept`, {}, assignee.token);
    ok('5.1 accept → 200', a.status === 200);
    const co = await api('PUT', `/api/tasks/${tid}/complete`, { comment:'Готово' }, assignee.token);
    ok('5.2 complete → 200', co.status === 200);
    const ch = (await pg.query('SELECT archived_at, is_readonly FROM chats WHERE id=$1',[chatId])).rows[0];
    ok('5.3 chat архивирован (archived_at not null)', !!ch?.archived_at);
    ok('5.4 chat readonly', ch?.is_readonly === true);
  }

  // ════════════════════════════════════════════════════════════════
  section('6. Декомпозиция: decline → reassign → escalate работают');
  // ════════════════════════════════════════════════════════════════
  {
    const assignee = Object.values(usersByRole).find(u => u.id === targetId);
    const c = await api('POST','/api/tasks',
      { assignee_id: targetId, title:'SWEEP decline-reassign', task_kind:'help' },
      usersByRole.PM?.token);
    const tid = c.data?.task?.id;
    const d = await api('PUT', `/api/tasks/${tid}/decline`, { reason:'Не моя зона ответственности' }, assignee.token);
    ok('6.1 decline → 200', d.status === 200);
    const row = (await pg.query('SELECT status, declined_reason FROM tasks WHERE id=$1',[tid])).rows[0];
    ok('6.2 status=declined', row.status === 'declined');
    ok('6.3 declined_reason сохранён', /зона/.test(row.declined_reason));

    // Reassign
    const newId = usersByRole.HEAD_TO?.id || usersByRole.PM?.id;
    if (newId && newId !== usersByRole.PM?.id && newId !== targetId) {
      const re = await api('PUT', `/api/tasks/${tid}/reassign`, { new_assignee_id: newId }, usersByRole.PM?.token);
      ok('6.4 reassign creator → 200', re.status === 200, `${re.status} ${JSON.stringify(re.data)}`);
    }
  }

  // ════════════════════════════════════════════════════════════════
  section('7. Phase 8 — templates / ratings / analytics / ai-suggest smoke');
  // ════════════════════════════════════════════════════════════════
  {
    const tpl = await api('POST','/api/tasks/help/templates',
      { name:'SWEEP tpl', emoji:'📋', default_assignee_id: targetId }, usersByRole.PM?.token);
    ok('7.1 create template → 200', tpl.status === 200);
    const use = await api('POST', `/api/tasks/help/templates/${tpl.data.template.id}/use`, {}, usersByRole.PM?.token);
    ok('7.2 use template → 200', use.status === 200);
    const an = await api('GET','/api/tasks/help/analytics?period=30d', null, usersByRole.PM?.token);
    ok('7.3 analytics → 200', an.status === 200);
    ok('7.4 analytics.summary.total >= 1', parseInt(an.data?.summary?.total || 0) >= 1);
    const ai = await api('POST','/api/tasks/help/ai-suggest',
      { description:'нужен счёт-фактура для поставщика' }, usersByRole.PM?.token);
    ok('7.5 ai-suggest → 200', ai.status === 200);
    ok('7.6 ai-suggest dept_hint detected', !!ai.data?.dept_hint);
    // Cleanup
    await api('DELETE', `/api/tasks/help/templates/${tpl.data.template.id}`, null, usersByRole.PM?.token);
  }

  // ════════════════════════════════════════════════════════════════
  section('8. Cron deadlines работает (Phase 7)');
  // ════════════════════════════════════════════════════════════════
  {
    const cron = require('/var/www/asgard-test/src/services/tasks-deadlines-cron');
    const db = require('/var/www/asgard-test/src/services/db');
    // Создать просроченную
    const r = await pg.query(`INSERT INTO tasks (creator_id, assignee_id, title, status, deadline, task_kind, priority, created_at, updated_at)
      VALUES ($1, $2, 'SWEEP overdue', 'in_progress', NOW() - INTERVAL '1 hour', 'help', 'high', NOW(), NOW()) RETURNING id`,
      [usersByRole.PM.id, targetId]);
    const tid = r.rows[0].id;
    await cron.runOnce(db, { info:()=>{}, error:console.error });
    const after = (await pg.query('SELECT status FROM tasks WHERE id=$1',[tid])).rows[0];
    ok('8.1 cron: overdue→status переход', after.status === 'overdue');
    const n = (await pg.query("SELECT * FROM notifications WHERE entity_id=$1 AND type='task_overdue'",[tid])).rows;
    ok('8.2 cron: task_overdue notification создана', n.length >= 1);
  }

  // ════════════════════════════════════════════════════════════════
  section('9. Smoke статика (frontend assets)');
  // ════════════════════════════════════════════════════════════════
  for (const url of [
    '/v2/',
    '/m/',
    '/assets/js/help_tasks.js',
    '/assets/js/tasks.js'
  ]) {
    const r = await fetch(BASE + url);
    ok(`9. ${url} → HTTP 200`, r.status === 200, `${r.status}`);
  }

  // ════════════════════════════════════════════════════════════════
  section('10. Все API endpoints help-модуля отвечают (auth check)');
  // ════════════════════════════════════════════════════════════════
  for (const ep of [
    'GET /api/tasks/help/inbox', 'GET /api/tasks/help/outbox', 'GET /api/tasks/help/watching',
    'GET /api/tasks/help/stats', 'GET /api/tasks/help/templates', 'GET /api/tasks/help/analytics'
  ]) {
    const [method, path] = ep.split(' ');
    const r = await api(method, path, null);
    ok(`10. ${ep} без токена → 401`, r.status === 401, `${r.status}`);
    const ra = await api(method, path, null, usersByRole.PM?.token);
    ok(`10. ${ep} c токеном → 200`, ra.status === 200, `${ra.status}`);
  }

  // Очистка
  await pg.query("DELETE FROM tasks WHERE title LIKE 'SWEEP%'");
  await pg.end();

  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`FINAL SWEEP: ${pass} passed, ${fail} failed (${sections.length} sections)`);
  if (fail) {
    console.log('\nFAILED:');
    errors.forEach(e => console.log(' -', e));
    process.exit(1);
  } else {
    console.log('🎉 ALL GREEN — готово к проду');
  }
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
