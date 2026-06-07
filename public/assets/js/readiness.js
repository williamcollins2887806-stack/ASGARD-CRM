/**
 * Готовность проектов — отдельные страницы для РП и директора.
 * Переиспользует API /api/work-readiness (work-readiness.js) и AsgardCharts.scoreRing.
 *  AsgardReadinessPage     — #/readiness        — РП: свои работы в подготовке + детали по этапам + override
 *  AsgardReadinessDirector — #/readiness-board  — директор: все РП, средняя готовность, горящие, drill-down
 */
window.AsgardReadiness = (function(){
  const esc = (window.AsgardUI && AsgardUI.esc) ? AsgardUI.esc
    : (s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

  const PREP = new Set(['Новая','Подготовка','Мобилизация']);
  const CLOSED = new Set(['Работы сдали','Закрыт']);
  const isPrep = w => PREP.has(w.work_status||'');
  const readyColor = p => p>=80 ? 'var(--ok-t)' : (p>=50 ? 'var(--amber,#e0a500)' : 'var(--err-t)');

  function token(){ return localStorage.getItem('asgard_token') || localStorage.getItem('auth_token') || ''; }
  function headers(){ return { 'Content-Type':'application/json', 'Authorization':'Bearer '+token() }; }

  async function summary(ids){
    if(!ids.length) return {};
    try{ const r = await fetch('/api/work-readiness/summary?ids='+ids.join(','), {headers:headers()}); return r.ok? await r.json():{}; }
    catch(e){ return {}; }
  }
  async function full(workId){
    try{ const r = await fetch('/api/work-readiness/'+workId, {headers:headers()}); return r.ok? await r.json():null; }
    catch(e){ return null; }
  }
  function daysLeft(d){ if(!d) return null; const dt=new Date(d); if(isNaN(dt)) return null; return Math.round((dt-new Date())/86400000); }

  // ── Однократная инъекция стилей ───────────────────────────────────────────
  (function css(){
    if(document.getElementById('rdy-page-css')) return;
    const st=document.createElement('style'); st.id='rdy-page-css';
    st.textContent=`
      .rdy-top{display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:8px}
      .rdy-hero-ring{flex:0 0 auto}
      .rdy-hero-meta b{font-size:26px}
      .rdy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-top:14px}
      .rdy-card{background:var(--bg2);border:1px solid var(--brd);border-radius:14px;padding:16px;display:flex;gap:14px;align-items:flex-start;cursor:pointer;transition:border-color .15s,transform .1s}
      .rdy-card:hover{border-color:var(--gold,#c8a84e);transform:translateY(-1px)}
      .rdy-ring{flex:0 0 auto;line-height:0}
      .rdy-body{flex:1;min-width:0}
      .rdy-name{font-weight:700;font-size:14px;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .rdy-sub{font-size:12px;color:var(--t3);margin-top:2px}
      .rdy-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;font-size:12px;color:var(--t2);align-items:center}
      .rdy-blk{color:var(--err-t,#e0524d);font-weight:700}
      .rdy-dl{color:var(--t3)}
      .rdy-empty{text-align:center;padding:60px 0;color:var(--t3)}
      .rdy-empty .ic{font-size:56px;margin-bottom:12px}
      .rdy-stage{border:1px solid var(--brd);border-radius:12px;padding:12px 14px;margin-bottom:10px;background:var(--bg2)}
      .rdy-stage-h{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:14px;color:var(--t1)}
      .rdy-items{margin:8px 0;display:flex;flex-direction:column;gap:4px}
      .rdy-item{display:flex;justify-content:space-between;gap:12px;font-size:13px;color:var(--t2)}
      .rdy-pmrow{display:flex;align-items:center;gap:14px;padding:12px 14px;background:var(--bg2);border:1px solid var(--brd);border-radius:12px;margin-bottom:10px;cursor:pointer}
      .rdy-pmrow:hover{border-color:var(--gold,#c8a84e)}
      .rdy-light{font-size:18px}
    `;
    document.head.appendChild(st);
  })();

  function ringHtml(pct, size){
    size=size||52; const p=Math.max(0,Math.min(100,Math.round(pct||0)));
    return '<span class="rdy-ring" data-pct="'+p+'" data-size="'+size+'"><canvas width="'+size+'" height="'+size+'"></canvas></span>';
  }
  function drawRings(scope){
    (scope||document).querySelectorAll('.rdy-ring canvas, .rdy-hero-ring canvas').forEach(cv=>{
      const host=cv.parentElement; const p=Number(host.getAttribute('data-pct'))||0; const size=Number(host.getAttribute('data-size'))||52;
      try{
        const dpr=window.devicePixelRatio||1; cv.width=size*dpr; cv.height=size*dpr; cv.style.width=size+'px'; cv.style.height=size+'px';
        const ctx=cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
        const cx=size/2,cy=size/2,r=size/2-5,lw=Math.max(5,size*0.11),s=Math.max(0,Math.min(100,p));
        ctx.clearRect(0,0,size,size); ctx.lineWidth=lw; ctx.lineCap='round';
        ctx.strokeStyle='rgba(120,140,180,.22)'; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
        const c=s>=80?'#22c55e':s>=50?'#e0a500':'#ef4444';
        ctx.strokeStyle=c; ctx.beginPath(); ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+(s/100)*Math.PI*2,false); ctx.stroke();
        ctx.fillStyle=c; ctx.font='bold '+Math.round(size*0.28)+'px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(s+'%',cx,cy+1);
      }catch(e){}
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  СТРАНИЦА РП — #/readiness
  // ─────────────────────────────────────────────────────────────────────────
  async function renderPM({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash='#/login'; return; }
    const user = auth.user;
    const allowed = ['ADMIN','PM','HEAD_PM','DIRECTOR_COMM','DIRECTOR_GEN','DIRECTOR_DEV'];
    if(!allowed.includes(user.role)){ AsgardUI.toast('Доступ','Раздел доступен РП','err'); location.hash='#/home'; return; }

    const body = `
      <div class="panel">
        <div class="help">Готовность ваших проектов к старту: по 7 этапам подготовки (персонал, допуска, закупки, сборы, билеты, жильё, логистика). Нажмите на проект — увидите детали и сможете закрыть этап вручную.</div>
        <hr class="hr"/>
        <div class="rdy-top" id="rdyTop"></div>
        <div id="rdyGrid">Загрузка…</div>
      </div>
    `;
    await layout(body, {title, motto:'Готов к походу — половина победы'});

    // только PM видит «свои»; руководители видят все работы в подготовке
    const isPMrole = user.role === 'PM';
    let works = (await AsgardDB.getAll('works')||[]).filter(w => !CLOSED.has(w.work_status||'') && isPrep(w));
    if(isPMrole) works = works.filter(w => w.pm_id === user.id);

    const grid = document.getElementById('rdyGrid');
    const top = document.getElementById('rdyTop');
    if(!works.length){
      top.innerHTML='';
      grid.innerHTML = '<div class="rdy-empty"><div class="ic">🎉</div><div style="font-size:18px">Нет проектов в подготовке</div><div class="help" style="margin-top:6px">Все работы либо уже идут, либо закрыты</div></div>';
      return;
    }

    const sum = await summary(works.map(w=>w.id));
    const items = works.map(w=>({ w, s: sum[w.id] })).filter(x=>x.s);
    items.sort((a,b)=>(a.s.overall_percent||0)-(b.s.overall_percent||0));

    // Hero: средняя готовность + счётчики
    const avg = items.length ? Math.round(items.reduce((a,x)=>a+(x.s.overall_percent||0),0)/items.length) : 0;
    const hot = items.filter(x=>{ const dl=daysLeft(x.s.start_plan||x.w.start_plan); return (x.s.overall_percent||0)<60 && dl!=null && dl<=14; }).length;
    top.innerHTML =
      '<span class="rdy-hero-ring" data-pct="'+avg+'" data-size="92"><canvas width="92" height="92"></canvas></span>'+
      '<div class="rdy-hero-meta"><b style="color:'+readyColor(avg)+'">'+avg+'%</b>'+
      '<div class="help">средняя готовность · '+items.length+' проектов в подготовке'+(hot?' · <span class="rdy-blk">'+hot+' горящих</span>':'')+'</div></div>';

    grid.innerHTML = '<div class="rdy-grid">'+items.map(({w,s})=>{
      const dl=daysLeft(s.start_plan||w.start_plan);
      const dlTxt = dl==null?'':(dl<0?'<span class="rdy-blk">старт −'+Math.abs(dl)+' дн.</span>':'<span class="rdy-dl">до старта '+dl+' дн.</span>');
      const blk = s.blocker_label?'<span class="rdy-blk">⚠ '+esc(s.blocker_label)+'</span>':'';
      return '<div class="rdy-card" data-work="'+w.id+'">'+ringHtml(s.overall_percent,56)+
        '<div class="rdy-body"><div class="rdy-name">'+esc(w.work_title||w.customer_name||('Работа #'+w.id))+'</div>'+
        '<div class="rdy-sub">'+esc(w.customer_name||'')+' · '+esc(w.work_status||'')+'</div>'+
        '<div class="rdy-meta"><span>'+(s.stages_done||0)+'/'+(s.stages_total||0)+' этапов</span>'+blk+dlTxt+'</div></div></div>';
    }).join('')+'</div>';
    drawRings(grid); drawRings(top);

    grid.querySelectorAll('.rdy-card').forEach(c=> c.addEventListener('click', ()=> openDrawer(Number(c.getAttribute('data-work')), user)));
  }

  // ── Drawer деталей этапов + override ──────────────────────────────────────
  async function openDrawer(workId, user){
    AsgardUI.showDrawer({ title:'Готовность проекта', width:'wide', html:'<div id="rdyDw">Загрузка…</div>', onMount: async ()=>{
      const data = await full(workId);
      const body = document.getElementById('rdyDw'); if(!body) return;
      if(!data){ body.innerHTML='<div class="help">Не удалось загрузить</div>'; return; }
      const canOv = ['PM','HEAD_PM','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(user.role);
      body.innerHTML =
        '<div class="rdy-top">'+ringHtml(data.overall_percent,72)+
        '<div class="rdy-hero-meta"><div style="font-weight:700;font-size:15px">'+esc(data.work_title||'')+'</div>'+
        '<div class="help">Общая готовность '+data.overall_percent+'% · '+data.stages_done+'/'+data.stages_total+' этапов'+(data.blocker?' · тормозит: <span class="rdy-blk">'+esc(data.stages.find(s=>s.stage===data.blocker)?.label||'')+'</span>':'')+'</div></div></div><hr class="hr"/>'+
        data.stages.filter(s=>s.applicable).map(s=>{
          const col=readyColor(s.percent);
          const items=(s.items||[]).map(it=>'<div class="rdy-item"><span>'+(it.ok?'✅':'⬜')+' '+esc(it.name)+'</span><span class="help">'+esc(it.detail||'')+'</span></div>').join('');
          const ov = canOv ? '<button class="btn mini ghost rdy-ov" data-stage="'+s.stage+'" data-on="'+(s.forced?1:0)+'" style="margin-top:6px">'+(s.forced?'Снять закрытие':'Закрыть этап вручную')+'</button>' : '';
          return '<div class="rdy-stage"><div class="rdy-stage-h"><span>'+s.icon+' '+esc(s.label)+(s.forced?' <span class="rdy-blk" style="font-weight:600">принудительно</span>':'')+'</span><span style="color:'+col+'">'+s.percent+'%</span></div><div class="rdy-items">'+items+'</div>'+ov+'</div>';
        }).join('');
      drawRings(body);
      body.querySelectorAll('.rdy-ov').forEach(b=> b.addEventListener('click', async ()=>{
        const stage=b.getAttribute('data-stage'), on=b.getAttribute('data-on')==='1'; b.disabled=true;
        try{
          if(on) await fetch('/api/work-readiness/'+workId+'/override/'+stage, {method:'DELETE', headers:headers()});
          else   await fetch('/api/work-readiness/'+workId+'/override', {method:'POST', headers:headers(), body:JSON.stringify({stage,forced_done:true})});
          openDrawer(workId, user);
        }catch(e){ AsgardUI.toast('Ошибка', e.message,'err'); b.disabled=false; }
      }));
    }});
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  СТРАНИЦА ДИРЕКТОРА — #/readiness-board
  // ─────────────────────────────────────────────────────────────────────────
  async function renderDirector({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash='#/login'; return; }
    const user = auth.user;
    const allowed = ['ADMIN','HEAD_PM','DIRECTOR_COMM','DIRECTOR_GEN','DIRECTOR_DEV'];
    if(!allowed.includes(user.role)){ AsgardUI.toast('Доступ','Раздел доступен руководителям','err'); location.hash='#/home'; return; }

    const body = `
      <div class="panel">
        <div class="help">Готовность всех проектов в подготовке в разрезе руководителей. 🔴 — есть горящие (готовность &lt;60% и старт ≤14 дней), 🟡 — есть отстающие, 🟢 — всё по плану. Нажмите на РП — увидите его проекты.</div>
        <hr class="hr"/>
        <div class="rdy-top" id="rdyTopD"></div>
        <div id="rdyPmList">Загрузка…</div>
      </div>
    `;
    await layout(body, {title, motto:'Видеть всё поле — значит управлять боем'});

    const works = (await AsgardDB.getAll('works')||[]).filter(w => !CLOSED.has(w.work_status||'') && isPrep(w));
    const users = (await AsgardDB.getAll('users')||[]);
    const umap = new Map(users.map(u=>[u.id,u]));
    const top = document.getElementById('rdyTopD');
    const list = document.getElementById('rdyPmList');

    if(!works.length){
      top.innerHTML='';
      list.innerHTML='<div class="rdy-empty"><div class="ic">🎉</div><div style="font-size:18px">Нет проектов в подготовке</div></div>';
      return;
    }
    const sum = await summary(works.map(w=>w.id));

    const byPm = new Map();
    works.forEach(w=>{ if(!w.pm_id) return; if(!byPm.has(w.pm_id)) byPm.set(w.pm_id,[]); byPm.get(w.pm_id).push(w); });
    const rows=[];
    for(const [pmId,wl] of byPm){
      const pm=umap.get(pmId); let s=0,c=0,hot=0;
      wl.forEach(w=>{ const ss=sum[w.id]; if(ss){ s+=ss.overall_percent||0; c++; const dl=daysLeft(ss.start_plan||w.start_plan); if((ss.overall_percent||0)<60&&dl!=null&&dl<=14)hot++; } });
      rows.push({ pmId, name: pm?(pm.name||pm.login||('РП #'+pmId)):('РП #'+pmId), works:wl.length, avg:c?Math.round(s/c):0, hot, list:wl });
    }
    rows.sort((a,b)=>a.avg-b.avg);

    // hero — общая средняя
    const gAvg = rows.length ? Math.round(rows.reduce((a,r)=>a+r.avg,0)/rows.length) : 0;
    const gHot = rows.reduce((a,r)=>a+r.hot,0);
    top.innerHTML='<span class="rdy-hero-ring" data-pct="'+gAvg+'" data-size="92"><canvas width="92" height="92"></canvas></span>'+
      '<div class="rdy-hero-meta"><b style="color:'+readyColor(gAvg)+'">'+gAvg+'%</b><div class="help">средняя по компании · '+works.length+' проектов · '+rows.length+' РП'+(gHot?' · <span class="rdy-blk">'+gHot+' горящих</span>':'')+'</div></div>';

    list.innerHTML = rows.map(r=>{
      const light = r.hot>0?'🔴':(r.avg<70?'🟡':'🟢');
      return '<div class="rdy-pmrow" data-pm="'+r.pmId+'">'+ringHtml(r.avg,48)+
        '<div class="rdy-body"><div class="rdy-name"><span class="rdy-light">'+light+'</span> '+esc(r.name)+'</div>'+
        '<div class="rdy-meta"><span>'+r.works+' в подготовке</span>'+(r.hot?'<span class="rdy-blk">'+r.hot+' горящих</span>':'')+'</div></div>'+
        '<span class="help">Проекты →</span></div>';
    }).join('');
    drawRings(list); drawRings(top);

    list.querySelectorAll('.rdy-pmrow').forEach(row=> row.addEventListener('click', ()=>{
      const r = rows.find(x=>String(x.pmId)===row.getAttribute('data-pm')); if(!r) return;
      AsgardUI.showDrawer({ title:'Проекты: '+r.name, width:'wide',
        html:'<div class="rdy-grid">'+r.list.map(w=>{ const s=sum[w.id]||{}; const blk=s.blocker_label?'<span class="rdy-blk">⚠ '+esc(s.blocker_label)+'</span>':''; return '<div class="rdy-card" data-work="'+w.id+'">'+ringHtml(s.overall_percent||0,56)+'<div class="rdy-body"><div class="rdy-name">'+esc(w.work_title||('Работа #'+w.id))+'</div><div class="rdy-sub">'+esc(w.work_status||'')+'</div><div class="rdy-meta"><span>'+(s.stages_done||0)+'/'+(s.stages_total||0)+' этапов</span>'+blk+'</div></div></div>'; }).join('')+'</div>',
        onMount: ()=>{ drawRings(document); document.querySelectorAll('#drawerBody .rdy-card').forEach(c=> c.addEventListener('click', ()=> openDrawer(Number(c.getAttribute('data-work')), user))); }
      });
    }));
  }

  return { renderPM, renderDirector };
})();
