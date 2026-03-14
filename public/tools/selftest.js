/* Self-test harness for static CRM build.
 * Goals:
 *  - Detect missing globals / broken script load
 *  - Validate critical settings shapes in IndexedDB
 *  - Smoke-test routing + RBAC redirects
 *  - Capture runtime errors (window.onerror / unhandledrejection)
 */

(function(){
  const out = document.getElementById('out');
  const errlog = document.getElementById('errlog');
  const btnRun = document.getElementById('btnRun');
  const btnWipe = document.getElementById('btnWipe');

  const captured=[];
  function capLine(obj){
    try{ return JSON.stringify(obj, null, 2); }catch(_){ return String(obj); }
  }
  function renderErrors(){
    if(!captured.length){ errlog.textContent='(пока пусто)'; return; }
    errlog.textContent = captured.map((e,i)=>`#${i+1} ${e.type}: ${e.message}${e.where?`\n${e.where}`:''}`).join('\n\n');
  }
  window.addEventListener('error', (ev)=>{
    captured.push({
      type:'error',
      message: ev.message || 'Unknown error',
      where: `${ev.filename||''}:${ev.lineno||''}:${ev.colno||''}`
    });
    renderErrors();
  });
  window.addEventListener('unhandledrejection', (ev)=>{
    const r = ev.reason;
    captured.push({
      type:'promise',
      message: (r && (r.message||r.name)) ? `${r.name||'Error'}: ${r.message||''}` : String(r),
      where: ''
    });
    renderErrors();
  });

  function row(name, status, details){
    const cls = status==='PASS' ? 'st-ok' : (status==='WARN' ? 'st-warn' : 'st-bad');
    const el = document.createElement('div');
    el.className = 'st-row';
    el.innerHTML = `
      <div class="k">${name}</div>
      <div class="v ${cls}">${status}</div>
      <div class="help">${details||''}</div>
    `;
    out.appendChild(el);
  }
  function hr(){
    const el=document.createElement('div');
    el.innerHTML='<hr class="hr"/>';
    out.appendChild(el);
  }
  function clear(){ out.innerHTML=''; }
  const sleep=(ms)=>new Promise(r=>setTimeout(r, ms));

  async function wipeDb(){
    if(!window.AsgardDB || !AsgardDB.importJSON) throw new Error('AsgardDB не инициализирован');
    await AsgardDB.importJSON({}, {wipe:true});
  }

  async function ensureBoot(){
    if(!window.AsgardApp || !AsgardApp.boot) throw new Error('AsgardApp.boot недоступен');
    await AsgardApp.boot({startRouter:true});
  }

  async function checkGlobals(){
    const required=[
      'AsgardDB','AsgardUI','AsgardAuth','AsgardRouter','AsgardSeed',
      'AsgardSLA',
      'AsgardBooking',
      'AsgardCharts',
      'AsgardTemplates',
      'AsgardDocsPack',
      'AsgardBirthdaysPage',
      'AsgardTendersPage','AsgardCustomersPage','AsgardPmCalcsPage','AsgardApprovalsPage','AsgardPmWorksPage',
      'AsgardAllWorksPage','AsgardAllEstimatesPage','AsgardKpiWorksPage','AsgardKpiMoneyPage',
      'AsgardPersonnelPage','AsgardEmployeePage','AsgardHrRatingPage',
      'AsgardSettingsPage','AsgardGanttFullPage','AsgardCalc'
    ];
    let ok=true;
    for(const k of required){
      if(!window[k]){ ok=false; row(`Global: ${k}`,'FAIL','Объект не найден (скрипт не загрузился или не экспортируется в window)'); }
      else row(`Global: ${k}`,'PASS','');
    }
    return ok;
  }

  function hasTransport(calc){
    const a = calc && (calc.transport_options || calc.transport);
    return Array.isArray(a) && a.length>0;
  }

  async function checkSettings(){
    const app = await AsgardDB.get('settings','app');
    if(!app){ row('Settings: app','FAIL','Запись settings.key="app" отсутствует'); return false; }
    let v;
    try {
      v = typeof app.value_json === 'string' ? JSON.parse(app.value_json) : (app.value_json || {});
    } catch(e) {
      row('Settings: app','FAIL','Не удалось распарсить value_json: ' + e.message);
      return false;
    }

    const req=[
      ['sla.docs_deadline_notice_days','число'],
      ['sla.birthday_notice_days','число'],
      ['sla.pm_calc_due_workdays','число'],
      ['sla.director_approval_due_workdays','число'],
      ['sla.pm_rework_due_workdays','число'],
      ['limits.pm_active_calcs_limit','число'],
      ['schedules.office_strict_own','булево'],
      ['schedules.block_on_conflict','булево'],
      ['calc.min_profit_per_person_day','число'],
      ['calc.overhead_pct','число'],
      ['calc.fot_tax_pct','число'],
      ['calc.profit_tax_pct','число'],
      ['work_close_trigger_status','строка']
    ];

    let ok=true;
    for(const [path, hint] of req){
      const parts=path.split('.');
      let cur=v;
      for(const p of parts){ cur = (cur && (p in cur)) ? cur[p] : undefined; }
      let good=false;
      if(hint==='число') good = (typeof cur==='number' && isFinite(cur));
      else if(hint==='булево') good = (typeof cur==='boolean');
      else if(hint==='строка') good = (typeof cur==='string' && cur.length>0);
      else good = (cur!==undefined);
      if(!good){ ok=false; row(`Settings: ${path}`,'FAIL',`Ожидается ${hint}, получено: ${capLine(cur)}`); }
      else row(`Settings: ${path}`,'PASS',String(cur));
    }

    if(!v.calc){ ok=false; row('Settings: calc','FAIL','Блок calc отсутствует'); }
    else{
      if(!hasTransport(v.calc)){ ok=false; row('Settings: calc.transport','FAIL','Нет transport/transport_options или пустой список'); }
      else row('Settings: calc.transport','PASS',`Вариантов: ${(v.calc.transport_options||v.calc.transport).length}`);

      if(!Array.isArray(v.calc.chemicals) || !v.calc.chemicals.length){ ok=false; row('Settings: calc.chemicals','FAIL','Список химии пуст'); }
      else row('Settings: calc.chemicals','PASS',`Позиций: ${v.calc.chemicals.length}`);

      if(!v.calc.role_rates || typeof v.calc.role_rates!=='object'){ ok=false; row('Settings: calc.role_rates','FAIL','Нет ставок по ролям'); }
      else row('Settings: calc.role_rates','PASS',`Ролей: ${Object.keys(v.calc.role_rates).length}`);
    }

    // customers directory store (INN -> name)
    try{
      const c = await AsgardDB.all('customers');
      row('Store: customers','PASS',`Записей: ${Array.isArray(c)?c.length:0}`);
    }catch(e){
      ok=false;
      row('Store: customers','FAIL', e.message || 'Не удалось прочитать store');
    }

    // customer reviews (rating on closeout)
    try{
      const cr = await AsgardDB.all('customer_reviews');
      row('Store: customer_reviews','PASS',`Записей: ${Array.isArray(cr)?cr.length:0}`);
    }catch(e){
      ok=false;
      row('Store: customer_reviews','FAIL', e.message || 'Не удалось прочитать store');
    }

    // docs templates
    const docs = await AsgardDB.get('settings','docs');
    if(!docs){ ok=false; row('Settings: docs','FAIL','Запись settings.key="docs" отсутствует (шаблоны документов)'); }
    else{
      let dv=null;
      try{ dv = JSON.parse(docs.value_json||"{}"); }catch(_){ dv=null; }
      const must=['payment_terms','request_extra','tkp_extra'];
      let good=true;
      for(const k of must){ if(!dv || typeof dv[k]!=="string" || !dv[k].trim()) good=false; }
      if(!good){ ok=false; row('Settings: docs fields','FAIL','Поля шаблонов пусты или некорректны'); }
      else row('Settings: docs','PASS','Шаблоны документов присутствуют');
    }

    // refs
    const refsRec = await AsgardDB.get('settings','refs');
    if(!refsRec){ ok=false; row('Settings: refs','FAIL','Запись settings.key="refs" отсутствует (справочники)'); }
    else{
      let rv=null;
      try{ rv = JSON.parse(refsRec.value_json||"{}"); }catch(_){ rv=null; }
      if(!rv || !Array.isArray(rv.permits)){
        ok=false; row('Settings: refs.permits','FAIL','Справочник допусков отсутствует или не массив');
      }else{
        row('Settings: refs.permits','PASS',`Позиций: ${rv.permits.length}`);
      }
    }
    return ok;
  }

  async function navTo(hash, waitMs=500){
    location.hash = hash;
    await sleep(waitMs);
    // Дополнительно ждём стабилизации роутера
    await sleep(100);
    return (window.AsgardRouter && AsgardRouter.current) ? AsgardRouter.current() : null;
  }

  async function checkRBAC(){
    let ok=true;

    // ensure logged out
    try{ AsgardAuth.logout(); }catch(_){ }
    await navTo('#/settings');
    const p0 = AsgardRouter.current();
    // Неавторизованный пользователь перенаправляется на /login или /welcome
    if(p0 !== '/login' && p0 !== '/welcome'){ ok=false; row('RBAC: anon -> /settings','FAIL',`Ожидалось перенаправление на /login или /welcome, фактически: ${p0}`); }
    else row('RBAC: anon -> /settings','PASS',`Перенаправление на ${p0}`);

    // TO
    await AsgardAuth._testLogin('to1');
    const p1 = await navTo('#/tenders');
    if(p1 !== '/tenders'){ ok=false; row('RBAC: TO -> /tenders','FAIL',`Фактически: ${p1}`); } else row('RBAC: TO -> /tenders','PASS','');
    const p1a = await navTo('#/customers');
    if(p1a !== '/customers'){ ok=false; row('RBAC: TO -> /customers','FAIL',`Фактически: ${p1a}`); } else row('RBAC: TO -> /customers','PASS','');
    const p1b = await navTo('#/personnel');
    if(p1b !== '/personnel'){ ok=false; row('RBAC: TO -> /personnel','FAIL',`Фактически: ${p1b}`); } else row('RBAC: TO -> /personnel','PASS','');
    const p1c = await navTo('#/employee?id=1');
    if(p1c !== '/employee'){ ok=false; row('RBAC: TO -> /employee','FAIL',`Фактически: ${p1c}`); } else row('RBAC: TO -> /employee','PASS','');
    const p2 = await navTo('#/approvals');
    if(p2 !== '/home'){ ok=false; row('RBAC: TO -> /approvals','FAIL',`Ожидалось отклонение в /home, фактически: ${p2}`); } else row('RBAC: TO -> /approvals','PASS','Отклонение по ролям');
    AsgardAuth.logout();

    // PM
    await AsgardAuth._testLogin('androsov');
    const p3 = await navTo('#/pm-calcs');
    if(p3 !== '/pm-calcs'){ ok=false; row('RBAC: PM -> /pm-calcs','FAIL',`Фактически: ${p3}`); } else row('RBAC: PM -> /pm-calcs','PASS','');
    const p4 = await navTo('#/tenders');
    if(p4 !== '/home'){ ok=false; row('RBAC: PM -> /tenders','FAIL',`Ожидалось отклонение в /home, фактически: ${p4}`); } else row('RBAC: PM -> /tenders','PASS','Отклонение по ролям');
    const p5 = await navTo('#/gantt-works');
    if(p5 !== '/gantt-works'){ ok=false; row('RBAC: PM -> /gantt-works','FAIL',`Фактически: ${p5}`); } else row('RBAC: PM -> /gantt-works','PASS','');
    const p5b = await navTo('#/gantt-calcs');
    if(p5b !== '/gantt-calcs'){ ok=false; row('RBAC: PM -> /gantt-calcs','FAIL',`Фактически: ${p5b}`); } else row('RBAC: PM -> /gantt-calcs','PASS','');
    AsgardAuth.logout();

    // DIRECTOR
    await AsgardAuth._testLogin('jarl');
    const p6 = await navTo('#/approvals');
    if(p6 !== '/approvals'){ ok=false; row('RBAC: DIRECTOR -> /approvals','FAIL',`Фактически: ${p6}`); } else row('RBAC: DIRECTOR -> /approvals','PASS','');
    const p7 = await navTo('#/settings');
    if(p7 !== '/settings'){ ok=false; row('RBAC: DIRECTOR -> /settings','FAIL',`Фактически: ${p7}`); } else row('RBAC: DIRECTOR -> /settings','PASS','');
    const p8 = await navTo('#/pm-calcs');
    if(p8 !== '/pm-calcs'){ ok=false; row('RBAC: DIRECTOR -> /pm-calcs','FAIL',`Фактически: ${p8}`); } else row('RBAC: DIRECTOR -> /pm-calcs','PASS','');
    const p9 = await navTo('#/gantt-works');
    if(p9 !== '/gantt-works'){ ok=false; row('RBAC: DIRECTOR -> /gantt-works','FAIL',`Фактически: ${p9}`); } else row('RBAC: DIRECTOR -> /gantt-works','PASS','');
    const p10 = await navTo('#/gantt-calcs');
    if(p10 !== '/gantt-calcs'){ ok=false; row('RBAC: DIRECTOR -> /gantt-calcs','FAIL',`Фактически: ${p10}`); } else row('RBAC: DIRECTOR -> /gantt-calcs','PASS','');
    const p11 = await navTo('#/hr-requests');
    if(p11 !== '/hr-requests'){ ok=false; row('RBAC: DIRECTOR -> /hr-requests','FAIL',`Фактически: ${p11}`); } else row('RBAC: DIRECTOR -> /hr-requests','PASS','');
    const p12 = await navTo('#/proc-requests');
    if(p12 !== '/proc-requests'){ ok=false; row('RBAC: DIRECTOR -> /proc-requests','FAIL',`Фактически: ${p12}`); } else row('RBAC: DIRECTOR -> /proc-requests','PASS','');
    AsgardAuth.logout();

    // HR
    await AsgardAuth._testLogin('trukhin');
    const ph1 = await navTo('#/personnel');
    if(ph1 !== '/personnel'){ ok=false; row('RBAC: HR -> /personnel','FAIL',`Фактически: ${ph1}`); } else row('RBAC: HR -> /personnel','PASS','');
    const ph2 = await navTo('#/hr-rating');
    if(ph2 !== '/hr-rating'){ ok=false; row('RBAC: HR -> /hr-rating','FAIL',`Фактически: ${ph2}`); } else row('RBAC: HR -> /hr-rating','PASS','');
    const ph3 = await navTo('#/hr-requests');
    if(ph3 !== '/hr-requests'){ ok=false; row('RBAC: HR -> /hr-requests','FAIL',`Фактически: ${ph3}`); } else row('RBAC: HR -> /hr-requests','PASS','');
    const ph4 = await navTo('#/proc-requests');
    if(ph4 !== '/home'){ ok=false; row('RBAC: HR -> /proc-requests','FAIL',`Ожидалось отклонение в /home, фактически: ${ph4}`); } else row('RBAC: HR -> /proc-requests','PASS','Отклонение по ролям');
    AsgardAuth.logout();

    // PROC
    await AsgardAuth._testLogin('barinov');
    const pp1 = await navTo('#/proc-requests');
    if(pp1 !== '/proc-requests'){ ok=false; row('RBAC: PROC -> /proc-requests','FAIL',`Фактически: ${pp1}`); } else row('RBAC: PROC -> /proc-requests','PASS','');
    const pp2 = await navTo('#/hr-requests');
    if(pp2 !== '/home'){ ok=false; row('RBAC: PROC -> /hr-requests','FAIL',`Ожидалось отклонение в /home, фактически: ${pp2}`); } else row('RBAC: PROC -> /hr-requests','PASS','Отклонение по ролям');
    AsgardAuth.logout();

    return ok;
  }

  async function run(){
    clear();
    captured.length=0;
    renderErrors();

    row('Init','PASS','Старт самопроверки');
    hr();

    try{
      await wipeDb();
      row('DB wipe','PASS',`IndexedDB ${AsgardDB.DB_NAME} очищена`);
    }catch(e){
      row('DB wipe','FAIL',e.message||String(e));
      return;
    }

    try{
      await ensureBoot();
      row('Boot','PASS','Маршруты зарегистрированы, router запущен');
    }catch(e){
      row('Boot','FAIL',e.message||String(e));
      return;
    }

    hr();
    const gOk = await checkGlobals();
    hr();
    const sOk = await checkSettings();
    hr();
    const rOk = await checkRBAC();

    hr();
    const runtimeOk = captured.length===0;
    row('Runtime errors','' + (runtimeOk ? 'PASS' : 'FAIL'), runtimeOk ? 'Ошибок не зафиксировано' : `Зафиксировано: ${captured.length}`);
    renderErrors();

    const allOk = gOk && sOk && rOk && runtimeOk;
    hr();
    row('RESULT', allOk ? 'PASS' : 'FAIL', allOk ? 'Базовые проверки пройдены' : 'Есть ошибки/несоответствия — см. строки выше');
    return {ok: allOk, errors: captured.slice()};
  }

  window.AsgardSelftestRun = run;
  const sp = new URLSearchParams(location.search);
  
  // Автозапуск только если явно указано ?autorun=1
  if(sp.get('autorun')==='1') {
    setTimeout(()=>run(), 100);
  }

  btnRun.addEventListener('click', ()=>run());
  btnWipe.addEventListener('click', async ()=>{
    clear();
    try{ await wipeDb(); row('DB wipe','PASS','База очищена'); }
    catch(e){ row('DB wipe','FAIL',e.message||String(e)); }
  });
})();
