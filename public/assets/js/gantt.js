window.AsgardGantt = (function(){
  const { esc } = AsgardUI;

  function parseDate(d){
    if(!d) return null;
    if(typeof d === 'string'){
      // СТРОГО YYYY-MM-DD → парсим как ЛОКАЛЬНУЮ дату (иначе new Date('2026-03-28') = UTC midnight,
      // и в браузере вне Moscow TZ getDate() возвращает предыдущий день).
      // ISO с временем (TIMESTAMPs) парсим стандартно — там важен инстант, не календарный день.
      const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if(m) return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
    }
    const x = new Date(d);
    return isNaN(x.getTime()) ? null : x;
  }

  function startOfWeek(d){
    const x=new Date(d);
    const day=(x.getDay()+6)%7; // Mon=0
    x.setHours(0,0,0,0);
    x.setDate(x.getDate()-day);
    return x;
  }

  function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }

  function isoDate(d){
    const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,"0"); const dd=String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${dd}`;
  }

  function weeksBetween(a,b){
    const ms = 7*24*60*60*1000;
    return Math.ceil((b-a)/ms);
  }

  function renderMini({startIso="2026-01-01", weeks=16, barStart, barEnd, barLabel="", barColor="#2a6cf1"}){
    const start = startOfWeek(parseDate(startIso) || new Date("2026-01-01"));
    const end = addDays(start, weeks*7);
    const bS = startOfWeek(parseDate(barStart) || start);
    const bE = parseDate(barEnd) || addDays(bS,7);

    const totalWeeks = weeksBetween(start, end);
    const offsetWeeks = Math.max(0, Math.floor((bS-start)/(7*24*60*60*1000)));
    const durWeeks = Math.max(1, Math.ceil(((bE-bS)/(7*24*60*60*1000))));

    const today = startOfWeek(new Date());
    const todayOffset = Math.floor((today-start)/(7*24*60*60*1000));

    const head = Array.from({length: totalWeeks}).map((_,i)=>{
      const d = addDays(start, i*7);
      const lab = `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}`;
      return `<div class="w">${esc(lab)}</div>`;
    }).join("");

    const barLeft = (offsetWeeks/totalWeeks)*100;
    const barW = (durWeeks/totalWeeks)*100;
    const todayLeft = (todayOffset/totalWeeks)*100;

    return `
      <style>
        .gbox{border:none; background:rgba(13,20,40,.35); border-radius:6px; overflow:hidden}
        .ghead{display:grid; grid-template-columns: repeat(${totalWeeks}, 1fr); gap:0; border-bottom:1px solid rgba(255,255,255,.04)}
        .ghead .w{padding:8px 6px; font-size:11px; color:rgba(184,196,231,.92); text-align:center; border-right:1px solid rgba(255,255,255,.04)}
        .gbody{position:relative; height:58px}
        .gbar{position:absolute; top:16px; height:26px; left:${barLeft}%; width:${barW}%; background:${barColor};
          border-radius:999px; box-shadow:0 10px 20px rgba(0,0,0,.25); display:flex; align-items:center; padding:0 10px; font-size:12px; font-weight:800; color:#0b0f1f}
        .gtoday{position:absolute; top:0; bottom:0; left:${todayLeft}%; width:2px; background:rgba(242,208,138,.95)}
        .gtoday::after{content:""; position:absolute; top:6px; left:6px; font-size:10px; color:rgba(242,208,138,.95)}
        .ggrid{position:absolute; inset:0; display:grid; grid-template-columns: repeat(${totalWeeks}, 1fr)}
        .ggrid div{border-right:1px solid rgba(255,255,255,.03)}
      </style>
      <div class="gbox">
        <div class="ghead">${head}</div>
        <div class="gbody">
          <div class="ggrid">${Array.from({length: totalWeeks}).map(()=>"<div></div>").join("")}</div>
          <div class="gtoday" title="Сегодня"></div>
          <div class="gbar" title="${esc(barLabel)}"></div>
        </div>
      </div>
    `;
  }

  
  function renderBoard({startIso="2026-01-01", weeks=52, rows=[], getColor=(row)=>"#2a6cf1"}){
    // timeline starts at Monday 00:00 for stable grid, but bars keep exact dates (no snapping)
    const start = startOfWeek(parseDate(startIso) || new Date("2026-01-01"));
    const end = addDays(start, weeks*7);
    const totalWeeks = weeksBetween(start, end);

    const msDay = 24*60*60*1000;
    const today = new Date();
    today.setHours(0,0,0,0);
    const todayOffsetDays = Math.floor((today-start)/msDay);

    const head = Array.from({length: totalWeeks}).map((_,i)=>{
      const d=addDays(start, i*7);
      const lab = `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}`;
      return `<div class="w">${esc(lab)}</div>`;
    }).join("");

    const gridCols = `repeat(${totalWeeks}, 1fr)`;
    const totalDays = totalWeeks*7;
    const todayLeft = (todayOffsetDays/totalDays)*100;

    const rowHtml = rows.map((r, idx)=>{
      const bS = parseDate(r.start) || start;
      const bEraw = parseDate(r.end) || bS;
      const bS0 = new Date(bS); bS0.setHours(0,0,0,0);
      const bE0 = new Date(bEraw); bE0.setHours(0,0,0,0);
      // Реальные дни от старта шкалы (могут быть отрицательными или > totalDays)
      const rawStartDays = Math.floor((bS0-start)/msDay);
      const rawEndDays = Math.max(rawStartDays, Math.floor((bE0-start)/msDay));
      // Клампим на видимую область — бар, выходящий за края, обрезается
      const startDays = Math.max(0, Math.min(totalDays-1, rawStartDays));
      const endDays = Math.max(startDays, Math.min(totalDays-1, rawEndDays));
      const durDays = Math.max(1, (endDays - startDays) + 1);
      const startsBefore = rawStartDays < 0;
      const endsAfter = rawEndDays >= totalDays;

      const barLeft = (startDays/totalDays)*100;
      const barW = (durDays/totalDays)*100;
      const color = getColor(r);
      const label = r.label || "";
      const sub = r.sub || "";
      const startIso = isoDate(bS0);
      const endIso = isoDate(bE0);
      const tooltip = `${label}\n${startIso} — ${endIso}${startsBefore?'\n← начало раньше видимой области':''}${endsAfter?'\nконец позже видимой области →':''}`;
      const barClasses = ['gbar'];
      if(startsBefore) barClasses.push('gbar--cut-left');
      if(endsAfter) barClasses.push('gbar--cut-right');
      return `
        <div class="grow">
          <div class="gname">
            <div class="gmain">${esc(label)}</div>
            <div class="gsub">${esc(sub)}</div>
          </div>
          <div class="gtrack">
            <div class="ggrid" style="grid-template-columns:${gridCols}">${Array.from({length: totalWeeks}).map(()=>"<div></div>").join("")}</div>
            <div class="gtoday" style="left:${todayLeft}%"></div>
            <div class="${barClasses.join(' ')}" data-gitem="${esc(String(r.id??idx))}" style="left:${barLeft}%; width:${barW}%; background:${color}; cursor:pointer" title="${esc(tooltip)}"><span class="gcap start"></span><span class="gcap end"></span></div>
          </div>
        </div>
      `;
    }).join("");

    return `
      <style>
        .gboard{border:none; background:rgba(13,20,40,.35); border-radius:6px; overflow:hidden}
        .ghead{display:grid; grid-template-columns: 320px 1fr; border-bottom:1px solid rgba(255,255,255,.04)}
        .ghead .left{padding:10px 12px; font-weight:900; color:rgba(242,208,138,.95)}
        .ghead .right{display:grid; grid-template-columns:${gridCols}}
        .ghead .right .w{padding:10px 4px; font-size:11px; color:rgba(184,196,231,.92); text-align:center; border-right:1px solid rgba(255,255,255,.04)}
        .grow{display:grid; grid-template-columns:320px 1fr; border-bottom:1px solid rgba(255,255,255,.04)}
        .gname{padding:10px 12px}
        .gmain{font-weight:900}
        .gsub{font-size:12px; color:rgba(184,196,231,.85); margin-top:4px}
        .gtrack{position:relative; height:44px; padding:8px 0}
        .ggrid{position:absolute; inset:0; display:grid}
        .ggrid div{border-right:1px solid rgba(255,255,255,.03)}
        .gbar{position:absolute; top:9px; height:26px; border-radius:999px; box-shadow:0 10px 20px rgba(0,0,0,.25);
          display:flex; align-items:center; padding:0; overflow:hidden; min-width:6px}
        .gbar--cut-left{border-top-left-radius:0; border-bottom-left-radius:0; border-left:2px dashed rgba(255,255,255,.55)}
        .gbar--cut-right{border-top-right-radius:0; border-bottom-right-radius:0; border-right:2px dashed rgba(255,255,255,.55)}
        .gcap{position:absolute; top:0; bottom:0; width:8px; opacity:.9}
        .gcap.start{left:0; background:linear-gradient(90deg, rgba(0,0,0,.35), rgba(0,0,0,0))}
        .gcap.end{right:0; background:linear-gradient(270deg, rgba(0,0,0,.35), rgba(0,0,0,0))}
        .gtoday{position:absolute; top:0; bottom:0; width:2px; background:rgba(242,208,138,.95)}
      </style>
      <div class="gboard">
        <div class="ghead">
          <div class="left">Список</div>
          <div class="right">${head}</div>
        </div>
        ${rowHtml || `<div class="help" style="padding:14px">Нет данных для отображения.</div>`}
      </div>
    `;
  }

  /* ── Quick-scale navigation bar (S9) ── */
  const GMONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  function navHtml(){
    return `<div class="cr-gantt-nav">
      <div class="cr-gantt-nav__scales">
        <button class="cr-gantt-nav__btn" data-gscale="month">Месяц</button>
        <button class="cr-gantt-nav__btn" data-gscale="quarter">Квартал</button>
        <button class="cr-gantt-nav__btn" data-gscale="year">Год</button>
        <button class="cr-gantt-nav__btn" data-gscale="all">Всё</button>
      </div>
      <button class="cr-gantt-nav__arrow" id="g-prev" title="Назад">\u2190</button>
      <span class="cr-gantt-nav__label" id="g-range-label"></span>
      <button class="cr-gantt-nav__arrow" id="g-next" title="Вперёд">\u2192</button>
      <button class="cr-gantt-nav__today" id="g-today">Сегодня</button>
    </div>`;
  }

  function initNav(fromInp, toInp, applyFn){
    let scale = 'month', offset = 0;

    function updateLabel(){
      const el = document.getElementById('g-range-label');
      if(!el) return;
      const now = new Date(); now.setHours(0,0,0,0);
      if(scale==='month'){
        const d = new Date(now.getFullYear(), now.getMonth()+offset, 1);
        el.textContent = GMONTHS[d.getMonth()] + ' ' + d.getFullYear();
      }else if(scale==='quarter'){
        const qm = Math.floor(now.getMonth()/3)*3;
        const d = new Date(now.getFullYear(), qm+offset*3, 1);
        el.textContent = (Math.floor(d.getMonth()/3)+1) + '-й кв. ' + d.getFullYear();
      }else if(scale==='year'){
        el.textContent = (now.getFullYear()+offset) + ' год';
      }else{
        el.textContent = 'Все данные';
      }
    }

    function setScale(s, off){
      scale = s; offset = off;
      const now = new Date(); now.setHours(0,0,0,0);
      if(s==='month'){
        const d = new Date(now.getFullYear(), now.getMonth()+offset, 1);
        fromInp.value = isoDate(d);
        toInp.value = isoDate(new Date(d.getFullYear(), d.getMonth()+1, 0));
      }else if(s==='quarter'){
        const qm = Math.floor(now.getMonth()/3)*3;
        const d = new Date(now.getFullYear(), qm+offset*3, 1);
        fromInp.value = isoDate(d);
        toInp.value = isoDate(new Date(d.getFullYear(), d.getMonth()+3, 0));
      }else if(s==='year'){
        const d = new Date(now.getFullYear()+offset, 0, 1);
        fromInp.value = isoDate(d);
        toInp.value = isoDate(new Date(d.getFullYear(), 11, 31));
      }else{
        fromInp.value = ''; toInp.value = '';
      }
      document.querySelectorAll('.cr-gantt-nav__btn').forEach(b=>
        b.classList.toggle('cr-gantt-nav__btn--active', b.dataset.gscale===s));
      updateLabel();
      applyFn();
    }

    document.querySelectorAll('.cr-gantt-nav__btn[data-gscale]').forEach(btn=>{
      btn.addEventListener('click', ()=> setScale(btn.dataset.gscale, 0));
    });
    const prevB = document.getElementById('g-prev');
    const nextB = document.getElementById('g-next');
    const todayB = document.getElementById('g-today');
    if(prevB) prevB.addEventListener('click', ()=>{ if(scale!=='all') setScale(scale, offset-1); });
    if(nextB) nextB.addEventListener('click', ()=>{ if(scale!=='all') setScale(scale, offset+1); });
    if(todayB) todayB.addEventListener('click', ()=> setScale(scale, 0));

    setScale('month', 0);
  }

  return { renderMini, renderBoard, isoDate, navHtml, initNav };

})();