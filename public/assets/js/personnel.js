window.AsgardPersonnelPage=(function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(String(r||"" )==="DIRECTOR"||String(r||"" ).startsWith("DIRECTOR_"));

  function isoNow(){ return new Date().toISOString(); }

  function parseQuery(){
    const h=(location.hash||"#/welcome").replace(/^#/, "");
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

  async function render({layout,title}){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user=auth.user;
    if(!(user.role==="ADMIN" || user.role==="HR" || user.role==="TO" || isDirRole(user.role))){
      toast("Доступ","Недостаточно прав","err"); location.hash="#/home"; return;
    }

    const query = parseQuery();
    const q = (query.q||"").trim().toLowerCase();
    const permit = (query.permit||"").trim();
    const motto = "В дружине сила. В учёте — порядок. В деле — честь.";

    const refsRec = await AsgardDB.get("settings","refs");
    const refs = refsRec ? JSON.parse(refsRec.value_json||"{}") : {};
    const permits = Array.isArray(refs.permits) ? refs.permits : [];

    const list = await AsgardDB.all("employees");
    let rows = (list||[]).slice();
    if(q){
      rows = rows.filter(e=>(e.fio||"").toLowerCase().includes(q) || (e.role_tag||"").toLowerCase().includes(q) || (e.city||"").toLowerCase().includes(q));
    }
    if(permit){
      rows = rows.filter(e=> Array.isArray(e.permits) && e.permits.includes(permit));
    }
    rows.sort((a,b)=>(b.rating_avg||0)-(a.rating_avg||0) || String(a.fio||"").localeCompare(String(b.fio||""), "ru"));

    const html = `
      <div class="panel">
        <div class="row" style="justify-content:space-between; gap:10px; flex-wrap:wrap">
          <div>
            <div class="kpi"><span class="dot" style="background:#3b82f6"></span> Персонал</div>
            <div class="help">50 тестовых бойцов уже в базе. Рейтинг считается по оценкам РП.</div>
          </div>
          <div class="row" style="gap:8px; flex-wrap:wrap">
            <input id="q" class="input" placeholder="Поиск: ФИО, роль, город..." value="${esc(q)}"/>
            <select id="perm" class="input" style="min-width:220px">
              <option value="">Допуск: любой</option>
              ${(permits||[]).map(p=>`<option value="${esc(p)}" ${p===permit?"selected":""}>${esc(p)}</option>`).join("")}
            </select>
            <button class="btn" id="btnFind">Найти</button>
            <button class="btn ghost" id="btnSchedule">График</button>
            <button class="btn ghost" id="btnAdd">Добавить</button>
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
                <th>Телефон</th>
                <th style="width:110px">Рейтинг</th>
                <th style="width:140px"></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((e,idx)=>`
                <tr>
                  <td>${idx+1}</td>
                  <td><b>${esc(e.fio||"")}</b></td>
                  <td>${esc(e.role_tag||"")}</td>
                  <td>${esc(e.city||"")}</td>
                  <td>${esc(e.phone||"")}</td>
                  <td>${e.rating_avg!=null? `<span class="badge"><span class="dot" style="background:#22c55e"></span>${esc(String(e.rating_avg.toFixed(1)))}</span>` : `<span class="badge"><span class="dot" style="background:#94a3b8"></span>—</span>`}</td>
                  <td class="right">
                    <button class="btn sm ghost" data-open="${e.id}">Открыть</button>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="7" class="muted">Нет данных</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="help" style="margin-top:10px">ᚨ Держи список чистым — и дружина будет надёжной.</div>
      </div>
    `;

    await layout(html, {title: title || "Дружина • Персонал", motto});

    $("#btnFind").onclick=()=>{
      const qv = ($("#q").value||"").trim();
      const pv = ($("#perm").value||"").trim();
      const parts=[];
      if(qv) parts.push(`q=${encodeURIComponent(qv)}`);
      if(pv) parts.push(`permit=${encodeURIComponent(pv)}`);
      const qs = parts.length? `?${parts.join("&")}` : "";
      location.hash=`#/personnel${qs}`;
    };
    $("#q").addEventListener("keydown",(e)=>{ if(e.key==="Enter") $("#btnFind").click(); });
    $("#btnSchedule").onclick=()=>{ location.hash="#/workers-schedule"; };

    $$(".btn[data-open]").forEach(b=> b.onclick=()=>{ location.hash=`#/employee?id=${b.dataset.open}`; });

    $("#btnAdd").onclick=()=>{
      const body = `
        <div class="formrow">
          <div style="grid-column:1/-1">
            <label for="e_fio">ФИО</label><input id="e_fio" placeholder="Фамилия Имя Отчество"/>
          </div>
          <div>
            <label for="e_birth">Дата рождения</label><input id="e_birth" type="date"/>
            <div class="help">Обязательно для рабочих (HR).</div>
          </div>
          <div>
            <label for="e_role">Роль</label><input id="e_role" placeholder="Слесарь/Мастер/..."/>
          </div>
          <div>
            <label for="e_city">Город</label><input id="e_city" placeholder="Москва"/>
          </div>
          <div>
            <label for="e_phone">Телефон</label><input id="e_phone" placeholder="+7 ..."/>
          </div>
          <div>
            <label for="e_grade">Разряд</label><input id="e_grade" placeholder="3..6"/>
          </div>
          <div style="grid-column:1/-1">
            <label for="e_docs">Ссылка на папку документов (Диск/сервер)</label><input id="e_docs" placeholder="https://..."/>
          </div>
        </div>
        <div class="row" style="justify-content:flex-end; gap:8px; margin-top:12px">
          <button class="btn" id="btnSave">Сохранить</button>
        </div>
      `;
      showModal("Новый сотрудник", body);
      $("#btnSave").onclick = async ()=>{
        const fio=$("#e_fio").value.trim();
        if(!fio){ toast("Проверка","ФИО обязательно","err"); return; }
        await AsgardDB.add("employees",{
          fio,
          role_tag:$("#e_role").value.trim(),
          city:$("#e_city").value.trim(),
          phone:$("#e_phone").value.trim(),
          grade:$("#e_grade").value.trim(),
          docs_folder_link:$("#e_docs").value.trim(),
          availability_status:"Свободен",
          rating_avg:null,
          created_at: isoNow()
        });
        toast("Готово","Добавлено");
        location.hash="#/personnel";
      };
    };
  }

  return {render};
})();