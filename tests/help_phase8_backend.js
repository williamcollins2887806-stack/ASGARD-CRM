/* eslint-disable */
/* Phase 8 backend e2e: templates / ratings / analytics / ai-suggest. */
const BASE = 'http://127.0.0.1:3120';
const { Client } = require('pg');

const PG = { host:'127.0.0.1', port:5432, user:'asgard', password:'123456789', database:'asgard_crm_test' };
let pass = 0, fail = 0;
const errors = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else      { fail++; errors.push(`${name}${extra?' :: '+extra:''}`); console.log(`❌ ${name}${extra?' :: '+extra:''}`); }
}
async function api(method, path, body, token) {
  const headers = { 'Content-Type':'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, { method, headers, body: body?JSON.stringify(body):undefined });
  let data = null; try { data = await r.json(); } catch (e) {}
  return { status:r.status, data };
}
function login_other(u) {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ id:u.id, login:u.login, name:u.name, role:u.role, email:null, pinVerified:true }, 'asgard-jwt-secret-2026', { expiresIn:'1h' });
}

(async () => {
  console.log('=== HELP Phase 8 Backend E2E ===\n');
  const pg = new Client(PG); await pg.connect();
  await pg.query("DELETE FROM help_templates WHERE name LIKE 'TEST%'");
  await pg.query("DELETE FROM tasks WHERE title LIKE 'TPL-TEST%' OR title LIKE 'RATE-TEST%'");

  const pm  = (await pg.query("SELECT id, login, name, role FROM users WHERE login='test_pm'")).rows[0];
  const dir = (await pg.query("SELECT id, login, name, role FROM users WHERE login='test_director'")).rows[0];
  const to  = (await pg.query("SELECT id, login, name, role FROM users WHERE role='TO' AND is_active=true AND login NOT LIKE 'test_%' LIMIT 1")).rows[0];
  const pmTok = login_other(pm), dirTok = login_other(dir), toTok = login_other(to);

  // ── 1. TEMPLATES ─────────────────────────────────────────
  let tplId;
  {
    const r = await api('POST','/api/tasks/help/templates',
      { name:'TEST Шаблон ТО смета', emoji:'🛠', default_assignee_role:'TO', default_assignee_id: to.id,
        title_pattern:'Помогите со сметой по {{work}} ({{date}})', description:'Подробности…',
        priority:'high', deadline_hours:24 }, pmTok);
    ok('1. POST template (PM) → 200', r.status === 200);
    tplId = r.data?.template?.id;
  }
  {
    const r = await api('POST','/api/tasks/help/templates', { name:'TEST глобальный', is_global:true }, pmTok);
    ok('1a. PM пытается is_global → 403', r.status === 403);
  }
  {
    const r = await api('POST','/api/tasks/help/templates', { name:'TEST глобальный DIR', is_global:true }, dirTok);
    ok('1b. DIRECTOR can is_global → 200', r.status === 200);
  }
  {
    const r = await api('GET','/api/tasks/help/templates', null, pmTok);
    ok('1c. GET templates: видит свой + глобальный', r.status === 200 && r.data.templates.length >= 2);
  }
  // USE template
  let taskFromTpl;
  {
    const r = await api('POST', `/api/tasks/help/templates/${tplId}/use`, { work_title:'Объект Y' }, pmTok);
    ok('2. USE template → 200', r.status === 200, JSON.stringify(r.data));
    taskFromTpl = r.data?.task?.id;
    ok('2a. title подставлен с {{work}}', /Объект Y/.test(r.data?.task?.title || ''));
    ok('2b. task.chat_id создан', !!r.data?.task?.chat_id);
    ok('2c. priority=high из шаблона', r.data?.task?.priority === 'high');
  }
  // PUT template
  {
    const r = await api('PUT', `/api/tasks/help/templates/${tplId}`, { name:'TEST Шаблон обновлён' }, pmTok);
    ok('3. PUT template owner → 200', r.status === 200);
  }
  {
    const r = await api('PUT', `/api/tasks/help/templates/${tplId}`, { name:'хак' }, toTok);
    ok('3a. PUT чужим → 403', r.status === 403);
  }
  // DELETE
  {
    const r2 = await api('POST','/api/tasks/help/templates', { name:'TEST DEL' }, pmTok);
    const did = r2.data.template.id;
    const r = await api('DELETE', `/api/tasks/help/templates/${did}`, null, pmTok);
    ok('4. DELETE template owner → 200', r.status === 200);
  }

  // ── 2. RATINGS ───────────────────────────────────────────
  {
    // Создаём help-task, assignee=to, complete, потом rate
    const c = await api('POST','/api/tasks', { assignee_id: to.id, title:'RATE-TEST 1', task_kind:'help' }, pmTok);
    const tid = c.data?.task?.id;
    await api('PUT', `/api/tasks/${tid}/accept`, {}, toTok);
    await api('PUT', `/api/tasks/${tid}/complete`, { comment:'Готово' }, toTok);
    // rate
    const r = await api('POST', `/api/tasks/${tid}/rate`, { stars:5, thanks_text:'Огромное спасибо!' }, pmTok);
    ok('5. POST /:id/rate stars=5 → 200', r.status === 200);
    const rowCheck = await api('GET', `/api/tasks/${tid}/rating`, null, pmTok);
    ok('5a. GET rating: stars=5', rowCheck.data?.rating?.stars === 5);
    ok('5b. thanks_text сохранён', /Огромное спасибо/.test(rowCheck.data?.rating?.thanks_text || ''));
    // rate invalid stars
    const inv = await api('POST', `/api/tasks/${tid}/rate`, { stars:7 }, pmTok);
    ok('5c. stars=7 → 400', inv.status === 400);
    // rate not creator
    const notC = await api('POST', `/api/tasks/${tid}/rate`, { stars:1 }, toTok);
    ok('5d. rate not-creator → 403', notC.status === 403);
    // rate not-done task
    const c2 = await api('POST','/api/tasks', { assignee_id: to.id, title:'RATE-TEST not done', task_kind:'help' }, pmTok);
    const tid2 = c2.data?.task?.id;
    const notD = await api('POST', `/api/tasks/${tid2}/rate`, { stars:5 }, pmTok);
    ok('5e. rate not done → 400', notD.status === 400);
    // upsert: 2-я оценка обновляет
    const up = await api('POST', `/api/tasks/${tid}/rate`, { stars:3, thanks_text:'обновил' }, pmTok);
    ok('5f. UPSERT rating → 200', up.status === 200);
    const rowCheck2 = await api('GET', `/api/tasks/${tid}/rating`, null, pmTok);
    ok('5g. UPSERT обновил stars→3', rowCheck2.data?.rating?.stars === 3);
  }

  // ── 3. ANALYTICS ────────────────────────────────────────
  {
    const r = await api('GET','/api/tasks/help/analytics?period=30d', null, pmTok);
    if (r.status !== 200) console.log('  analytics response:', r.status, JSON.stringify(r.data));
    ok('6. GET /help/analytics → 200', r.status === 200);
    ok('6a. summary есть', !!r.data?.summary);
    ok('6b. top_helpers массив', Array.isArray(r.data?.top_helpers));
    ok('6c. top_requesters массив', Array.isArray(r.data?.top_requesters));
    ok('6d. top_pairs массив', Array.isArray(r.data?.top_pairs));
    // PM должен фигурировать в top_requesters
    const me = r.data.top_requesters.find(x => x.id === pm.id);
    ok('6e. PM в top_requesters', !!me && parseInt(me.total_requested) >= 1);
  }

  // ── 4. AI-SUGGEST ───────────────────────────────────────
  {
    const r = await api('POST','/api/tasks/help/ai-suggest', { description: 'Помогите со сметой и просчётом по объекту' }, pmTok);
    ok('7. POST /ai-suggest "смет/просчёт" → 200', r.status === 200);
    ok('7a. dept_hint=TO', r.data?.dept_hint === 'TO', `got ${r.data?.dept_hint}`);
    ok('7b. suggested[] есть', Array.isArray(r.data?.suggested));
    const tooShort = await api('POST','/api/tasks/help/ai-suggest', { description: 'hi' }, pmTok);
    ok('7c. короткий текст → 400', tooShort.status === 400);
    const r2 = await api('POST','/api/tasks/help/ai-suggest', { description: 'нужен счёт-фактура и платёжка от поставщика' }, pmTok);
    ok('7d. "счёт"/"поставщик" → PROC или BUH', ['PROC','BUH'].includes(r2.data?.dept_hint), `got ${r2.data?.dept_hint}`);
  }

  // ── Очистка ─────────────────────────────────────────────
  await pg.query("DELETE FROM help_templates WHERE name LIKE 'TEST%'");
  await pg.query("DELETE FROM tasks WHERE title LIKE 'TPL-TEST%' OR title LIKE 'RATE-TEST%'");
  await pg.end();
  console.log(`\n=== Phase 8 RESULT: ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('\nFAILED:'); errors.forEach(e=>console.log(' -',e)); process.exit(1); }
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
