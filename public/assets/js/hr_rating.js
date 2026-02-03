window.AsgardHrRatingPage=(function(){
  const { $, $$, esc, toast } = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(String(r||"" )==="DIRECTOR"||String(r||"" ).startsWith("DIRECTOR_"));

  function parseQuery(){
    const h=(location.hash||"#/home").replace(/^#/, "");
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

  function fmtAvg(v){
    if(v==null || !isFinite(v)) return "—";
    try{ return Number(v).toFixed(1); }catch(_){ return String(v); }
  }

  async function render({layout,title}={}){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user=auth.user;
    if(!(user.role==="ADMIN" || user.role==="HR" || isDirRole(user.role))){
      toast("Доступ","Недостаточно прав","err");
      location.hash="#/home";
      return;
    }

    const query = parseQuery();
    const q = (query.q||"").trim().toLowerCase();
    const permit = (query.permit||"").trim();

    const motto = "Кто держит строй — тот держит имя.";

    const refsRec = await AsgardDB.get("settings","refs");
    const refs = refsRec ? JSON.parse(refsRec.value_json||"{}") : {};
    const permits = Array.isArray(refs.permits) ? refs.permits : [];

    const employees = await AsgardDB.all("employees");
    const reviews = await AsgardDB.all("employee_reviews");

    const agg = new Map();
    for(const r of (reviews||[])){
      if(!r || r.employee_id==null) continue;
      const score = Number(r.score||0);
      if(!isFinite(score) || score<=0) continue;
      const id = Number(r.employee_id);
      const a = agg.get(id) || {sum:0,count:0,last_at:null};
      a.sum += score;
      a.count += 1;
      const ca = String(r.created_at||"");
      if(ca && (!a.last_at || ca>a.last_at)) a.last_at = ca;
      agg.set(id, a);
    }

    let rows = (employees||[]).map(e=>{
      const a = agg.get(Number(e.id)) || {sum:0,count:0,last_at:null};
      const avg = a.count ? (a.sum/a.count) : null;
      return {
        ...e,
        rating_avg_calc: avg,
        rating_count: a.count,
        last_review_at: a.last_at
      };
    });

    if(q){
      rows = rows.filter(e=> (e.fio||"").toLowerCase().includes(q) || (e.role_tag||"").toLowerCase().includes(q) || (e.city||"").toLowerCase().includes(q));
    }
    if(permit){
      rows = rows.filter(e=> Array.isArray(e.permits) && e.permits.includes(permit));
    }

    rows.sort((a,b)=>{
      const av = (a.rating_avg_calc==null)?-1:a.rating_avg_calc;
      const bv = (b.rating_avg_calc==null)?-1:b.rating_avg_calc;
      if(bv!==av) return bv-av;
      if((b.rating_count||0)!==(a.rating_count||0)) return (b.rating_count||0)-(a.rating_count||0);
      return String(a.fio||"").localeCompare(String(b.fio||""),"ru");
    });

    const html = `
      <div class="panel">
        <div class="row" style="justify-content:space-between; gap:10px; flex-wrap:wrap">
          <div>
            <div class="kpi"><span class="dot" style="background:#22c55e"></span>Рейтинг дружины</div>
            <div class="help">Оценки РП 1–10. Средний балл = сумма/кол-во оценок. Фильтр по допускам — из настроек.</div>
          </div>
          <div class="row" style="gap:8px; flex-wrap:wrap">
            <input id="q" class="input" placeholder="Поиск: ФИО, роль, город..." value="${esc(q)}"/>
            <select id="perm" class="input" style="min-width:220px">
              <option value="">Допуск: любой</option>
              ${(permits||[]).map(p=>`<option value="${esc(p)}" ${p===permit?"selected":""}>${esc(p)}</option>`).join("")}
            </select>
            <button class="btn" id="btnFind">Найти</button>
            <button class="btn ghost" id="btnPersonnel">Персонал</button>
          </div>
        </div>

        <div class="tablewrap" style="margin-top:12px">
          <table class="table">
            <thead>
              <tr>
                <th style="width:42px">#</th>
                <th>ФИО</th>
                <th>Роль</th>
                <th>Город</th>
                <th style="width:110px">Средний</th>
                <th style="width:110px">Оценок</th>
                <th style="width:170px">Последняя</th>
                <th style="width:140px"></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((e,idx)=>{
                const avg = e.rating_avg_calc;
                const dot = (avg==null) ? "#64748b" : (avg>=8?"#22c55e":(avg>=6?"#f59e0b":"#ef4444"));
                const when = e.last_review_at ? new Date(e.last_review_at).toLocaleDateString("ru-RU") : "—";
                return `
                  <tr>
                    <td>${idx+1}</td>
                    <td><b>${esc(e.fio||"")}</b></td>
                    <td>${esc(e.role_tag||"")}</td>
                    <td>${esc(e.city||"")}</td>
                    <td><span class="badge"><span class="dot" style="background:${dot}"></span>${esc(fmtAvg(avg))}</span></td>
                    <td>${esc(String(e.rating_count||0))}</td>
                    <td>${esc(when)}</td>
                    <td class="right"><button class="btn sm ghost" data-open="${e.id}">Открыть</button></td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="8" class="muted">Нет данных</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="help" style="margin-top:10px">ᚨ Держи рейтинг честным — и дружина будет крепка.</div>
      </div>
    `;

    await layout(html, {title: title||"Рейтинг дружины", motto});

    $("#btnFind").onclick=()=>{
      const qv = ($("#q").value||"").trim();
      const pv = ($("#perm").value||"").trim();
      const parts=[];
      if(qv) parts.push(`q=${encodeURIComponent(qv)}`);
      if(pv) parts.push(`permit=${encodeURIComponent(pv)}`);
      const qs = parts.length?`?${parts.join("&")}`:"";
      location.hash = `#/hr-rating${qs}`;
    };
    $("#q").addEventListener("keydown", (e)=>{ if(e.key==="Enter") $("#btnFind").click(); });
    $("#btnPersonnel").onclick=()=>{ location.hash="#/personnel"; };
    $$(".btn[data-open]").forEach(b=> b.onclick=()=>{ location.hash=`#/employee?id=${b.dataset.open}`; });
  }

  return { render };
})();
