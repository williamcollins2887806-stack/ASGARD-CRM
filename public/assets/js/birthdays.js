window.AsgardBirthdaysPage=(function(){
  const { esc } = window.AsgardUI || { esc:(s)=>String(s||'') };

  function toDateYMD(ymd){
    const s = String(ymd||'').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(!m) return null;
    const y=Number(m[1]), mo=Number(m[2]), d=Number(m[3]);
    return new Date(Date.UTC(y, mo-1, d, 0,0,0));
  }

  function dayKeyLocal(dt){
    const d = dt instanceof Date ? dt : new Date();
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const da=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${da}`;
  }

  function nextBirthday(birth_ymd, now=new Date()){
    const b = toDateYMD(birth_ymd);
    if(!b) return null;
    const mm = b.getUTCMonth()+1;
    const dd = b.getUTCDate();

    const y = now.getFullYear();
    const thisYear = toDateYMD(`${y}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`);
    if(!thisYear) return null;

    const today = toDateYMD(dayKeyLocal(now));
    if(!today) return thisYear;
    if(thisYear.getTime() >= today.getTime()) return thisYear;
    return toDateYMD(`${y+1}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`);
  }

  function diffDaysUTC(a,b){
    if(!a||!b) return null;
    const ms = b.getTime() - a.getTime();
    return Math.floor(ms/(24*3600*1000));
  }

  function monthNameRu(m){
    const names=[
      'Январь','Февраль','Март','Апрель','Май','Июнь',
      'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
    ];
    return names[m-1] || String(m);
  }

  function parseQuery(){
    const h=(location.hash||"#/birthdays").replace(/^#/, "");
    const [,qs]=h.split("?");
    const query={};
    if(qs){
      qs.split("&").forEach(kv=>{
        if(!kv) return;
        const [k,v]=kv.split("=");
        query[decodeURIComponent(k)] = decodeURIComponent(v||"");
      });
    }
    return query;
  }

  function isDirectorRole(role){
    const r = String(role||"");
    return r==="DIRECTOR" || r.startsWith("DIRECTOR_");
  }

  async function buildBirthdayData(items, birthField, getName, getRole){
    const todayLocal = dayKeyLocal(new Date());
    const todayUTC = toDateYMD(todayLocal);

    const rows = [];
    for(const it of (items||[])){
      if(!it) continue;
      const bd = it[birthField];
      if(!bd) continue;
      const nb = nextBirthday(bd, new Date());
      if(!nb || !todayUTC) continue;
      const days = diffDaysUTC(todayUTC, nb);
      if(days==null) continue;
      rows.push({it, nb, days});
    }
    rows.sort((a,b)=>a.days-b.days || String(getName(a.it)||'').localeCompare(String(getName(b.it)||''), 'ru'));

    const nearest = rows.slice(0, 12);

    const byMonth = new Map();
    for(const r of rows){
      const bd = toDateYMD(r.it[birthField]);
      if(!bd) continue;
      const m = bd.getUTCMonth()+1;
      const d = bd.getUTCDate();
      const arr = byMonth.get(m) || [];
      arr.push({d, name:getName(r.it), role:getRole(r.it), birth_date:r.it[birthField]});
      byMonth.set(m, arr);
    }
    for(const [m, arr] of byMonth.entries()){
      arr.sort((a,b)=>a.d-b.d || String(a.name||'').localeCompare(String(b.name||''), 'ru'));
    }

    return { rows, nearest, byMonth };
  }

  function renderNearestTable(nearest, getName, getRole){
    if(!nearest.length){
      return `
        <div class="card">
          <h3>Ближайшие дни рождения</h3>
          <div class="help">Пока нет данных. Заполните даты рождения.</div>
        </div>
      `;
    }
    return `
      <div class="card">
        <h3>Ближайшие дни рождения</h3>
        <div class="tablewrap" style="margin-top:10px">
          <table class="tbl">
            <thead><tr><th>Когда</th><th>Кто</th><th>Роль</th><th>Дней</th></tr></thead>
            <tbody>
              ${nearest.map(r=>{
                const when = r.nb ? r.nb.toLocaleDateString('ru-RU') : '—';
                const who = esc(getName(r.it));
                const role = esc(getRole(r.it)||'');
                const d = (r.days===0) ? '<span class="badge" style="background:#22c55e">сегодня</span>' : esc(String(r.days));
                return `<tr><td>${when}</td><td>${who}</td><td>${role}</td><td>${d}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderMonths(byMonth){
    const months = Array.from(byMonth.keys()).sort((a,b)=>a-b);
    if(!months.length){
      return `<div class="card"><div class="help">Нет данных по датам рождения.</div></div>`;
    }
    // Показываем только месяцы где есть ДР
    return months.map(m=>{
      const arr = byMonth.get(m) || [];
      if(!arr.length) return ''; // Пропускаем пустые месяцы
      return `
        <div class="card birthday-month">
          <h3 class="birthday-month-title">${esc(monthNameRu(m))}</h3>
          <div class="birthday-list">
            ${arr.map(x=>`
              <div class="birthday-item">
                <span class="birthday-day">${esc(String(x.d))}</span>
                <span class="birthday-name">${esc(x.name||'')}</span>
                <span class="birthday-role">${esc(x.role||'')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  function topTabs({activeTab, canWorkers}){
    const mk = (tab, label)=>{
      const is = tab===activeTab;
      return `<a class="badge" href="#/birthdays?tab=${tab}" style="text-decoration:none; cursor:pointer; ${is?'background:#3b82f6':''}">${esc(label)}</a>`;
    };
    return `
      <div class="row" style="gap:10px; flex-wrap:wrap">
        ${mk('office','Офис')}
        ${canWorkers ? mk('workers','Рабочие') : ''}
      </div>
    `;
  }

  async function renderOffice({layout, title, canWorkers, activeTab}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash='#/login'; return; }

    let users=[];
    try{ users = (await AsgardDB.all('users')) || []; }catch(e){ users=[]; }
    users = users.filter(u=>u && u.is_active);

    const getName = (u)=>u?.name||u?.login||'Сотрудник';
    const getRole = (u)=>u?.role||'';

    const data = await buildBirthdayData(users, 'birth_date', getName, getRole);
    const monthsHtml = renderMonths(data.byMonth);

    const body = `
      <div class="panel">
        <div style="margin-bottom:12px">${topTabs({activeTab, canWorkers})}</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px">
          <button class="btn ghost" id="btnOpenAlerts">Открыть уведомления</button>
          <button class="btn ghost" id="btnOpenSettings">Настройки уведомлений</button>
        </div>
        <div class="birthday-months">
          ${monthsHtml}
        </div>
      </div>
    `;

    await layout(body, {title: title||'Дни рождения'});
    const a=document.getElementById('btnOpenAlerts');
    if(a) a.onclick = ()=>location.hash='#/alerts';
    const s=document.getElementById('btnOpenSettings');
    if(s) s.onclick = ()=>location.hash='#/settings?tab=sla';
  }

  async function renderWorkers({layout, title, canWorkers, activeTab}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash='#/login'; return; }
    const user = auth.user;
    if(!canWorkers){ toast('Доступ','Недостаточно прав','err'); location.hash='#/birthdays?tab=office'; return; }

    let emps=[];
    try{ emps = (await AsgardDB.all('employees')) || []; }catch(e){ emps=[]; }

    const getName = (e)=>e?.fio||e?.full_name||e?.name||`Сотрудник #${e?.id||''}`;
    const getRole = (e)=>e?.role_tag||'';

    const data = await buildBirthdayData(emps, 'birth_date', getName, getRole);
    const monthsHtml = renderMonths(data.byMonth);

    const body = `
      <div class="panel">
        <div style="margin-bottom:12px">${topTabs({activeTab, canWorkers})}</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px">
          <button class="btn ghost" id="btnOpenAlerts">Открыть уведомления</button>
          <button class="btn ghost" id="btnOpenPersonnel">Персонал</button>
        </div>
        <div class="birthday-months">
          ${monthsHtml}
        </div>
      </div>
    `;

    await layout(body, {title: title||'Дни рождения рабочих'});
    const a=document.getElementById('btnOpenAlerts');
    if(a) a.onclick = ()=>location.hash='#/alerts';
    const p=document.getElementById('btnOpenPersonnel');
    if(p) p.onclick = ()=>location.hash='#/personnel';
  }

  async function render({layout,title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash='#/login'; return; }
    const user = auth.user;
    const canWorkers = (String(user.role||'')==='HR') || isDirectorRole(user.role);
    const q = parseQuery();
    const tab = (q.tab||'office').toLowerCase();
    if(tab==='workers'){
      return renderWorkers({layout, title:'Дни рождения', canWorkers, activeTab:'workers'});
    }
    return renderOffice({layout, title:'Дни рождения', canWorkers, activeTab:'office'});
  }

  return { render, renderOffice, renderWorkers };
})();
