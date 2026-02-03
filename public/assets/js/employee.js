window.AsgardEmployeePage=(function(){
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

  async function recomputeRating(employee_id){
    const revs = await AsgardDB.byIndex("employee_reviews","employee_id", employee_id);
    const list = (revs||[]);
    if(list.length===0){
      const e = await AsgardDB.get("employees", employee_id);
      if(e){ e.rating_avg=null; await AsgardDB.put("employees", e); }
      return null;
    }
    const avg = list.reduce((s,r)=>s+Number(r.score_1_10||0),0)/list.length;
    const e = await AsgardDB.get("employees", employee_id);
    if(e){ e.rating_avg=avg; await AsgardDB.put("employees", e); }
    return avg;
  }

  async function render({layout,title}){
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user=auth.user;
    if(!(user.role==="ADMIN" || user.role==="HR" || user.role==="PM" || user.role==="TO" || isDirRole(user.role))){
      toast("Доступ","Недостаточно прав","err"); location.hash="#/home"; return;
    }

    const canEdit = (user.role==="ADMIN" || user.role==="HR" || user.role==="TO" || isDirRole(user.role));

    const query = parseQuery();
    const id = Number(query.id||0);
    const emp = await AsgardDB.get("employees", id);
    if(!emp){ toast("Сотрудник","Не найден","err"); location.hash="#/personnel"; return; }

    const refsRec = await AsgardDB.get("settings","refs");
    const refs = refsRec ? JSON.parse(refsRec.value_json||"{}"): {};
    const permits = Array.isArray(refs.permits) ? refs.permits : [];
    const empPermits = Array.isArray(emp.permits) ? emp.permits : [];

    const works = await AsgardDB.all("works");
    const assigns = (await AsgardDB.byIndex("employee_assignments","employee_id", id)) || [];
    assigns.sort((a,b)=> String(b.date_from||"").localeCompare(String(a.date_from||"")));

    const revs = (await AsgardDB.byIndex("employee_reviews","employee_id", id)) || [];
    revs.sort((a,b)=> String(b.created_at||"").localeCompare(String(a.created_at||"")));

    const workMap = new Map((works||[]).map(w=>[w.id,w]));
    const assignHtml = assigns.map(a=>{
      const w = workMap.get(a.work_id);
      return `<tr>
        <td>${esc(a.date_from||"")}</td>
        <td>${esc(a.date_to||"")}</td>
        <td>${w?esc(w.work_title||w.work_name||""):"—"}</td>
        <td>${esc(a.role_on_work||"")}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="4" class="muted">Истории назначений нет</td></tr>`;

    const revHtml = revs.map(r=>{
      const w = workMap.get(r.work_id);
      const who = r.pm_id ? `РП #${r.pm_id}` : "РП";
      return `<div class="pill" style="align-items:flex-start; gap:10px">
        <div style="margin-top:3px"><span class="dot" style="background:#ef4444"></span></div>
        <div style="flex:1">
          <div class="who"><b>${esc(who)}</b> <span class="help">${esc(new Date(r.created_at).toLocaleString("ru-RU"))}</span></div>
          <div class="row" style="gap:8px; margin-top:6px; flex-wrap:wrap">
            <span class="badge"><span class="dot" style="background:#22c55e"></span>${esc(String(r.score_1_10))}/10</span>
            <span class="badge"><span class="dot" style="background:#3b82f6"></span>${w?esc(w.work_title||""):"—"}</span>
          </div>
          <div class="help" style="margin-top:6px">${esc(r.comment||"")}</div>
        </div>
      </div>`;
    }).join("") || `<div class="help">Пока нет оценок.</div>`;

    const html = `
      <div class="panel">
        <div class="row" style="justify-content:space-between; gap:10px; flex-wrap:wrap">
          <div>
            <div class="kpi"><span class="dot" style="background:#ef4444"></span>${esc(emp.fio||"")}</div>
            <div class="help">Роль: <b>${esc(emp.role_tag||"—")}</b> · Разряд: <b>${esc(emp.grade||"—")}</b> · Рейтинг: <b>${emp.rating_avg!=null?esc(emp.rating_avg.toFixed(1)):"—"}</b></div>
          </div>
          <div class="row" style="gap:8px; flex-wrap:wrap">
            <button class="btn ghost" id="btnSchedule">График</button>
            ${canEdit ? `<button class="btn" id="btnSave">Сохранить</button>` : ``}
            ${(user.role==="PM" || user.role==="ADMIN" || isDirRole(user.role)) ? `<button class="btn red" id="btnReview">Оценить</button>` : ``}
          </div>
        </div>

        <!-- Основная информация -->
        <details open style="margin-top:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:#3b82f6"></span> Основная информация</summary>
          <div class="formrow" style="margin-top:12px">
            <div>
              <label>ФИО (полностью)</label>
              <input id="fio" value="${esc(emp.fio||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Дата рождения</label>
              <input id="birth" type="date" value="${esc(emp.birth_date||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Пол</label>
              <select id="gender" ${canEdit?"":"disabled"}>
                <option value="">—</option>
                <option value="male" ${emp.gender==="male"?"selected":""}>Мужской</option>
                <option value="female" ${emp.gender==="female"?"selected":""}>Женский</option>
              </select>
            </div>
            <div>
              <label>Должность</label>
              <input id="role" value="${esc(emp.role_tag||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Разряд</label>
              <input id="grade" value="${esc(emp.grade||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Дата приёма</label>
              <input id="hire_date" type="date" value="${esc(emp.hire_date||"")}" ${canEdit?"":"disabled"}/>
            </div>
          </div>
        </details>

        <!-- Документы -->
        <details style="margin-top:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:#f59e0b"></span> Документы</summary>
          <div class="formrow" style="margin-top:12px">
            <div>
              <label>Паспорт: серия</label>
              <input id="pass_series" value="${esc(emp.pass_series||"")}" placeholder="1234" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Паспорт: номер</label>
              <input id="pass_number" value="${esc(emp.pass_number||"")}" placeholder="567890" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Кем выдан</label>
              <input id="pass_issued_by" value="${esc(emp.pass_issued_by||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Дата выдачи</label>
              <input id="pass_issued_date" type="date" value="${esc(emp.pass_issued_date||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Код подразделения</label>
              <input id="pass_code" value="${esc(emp.pass_code||"")}" placeholder="123-456" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>ИНН</label>
              <input id="inn" value="${esc(emp.inn||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>СНИЛС</label>
              <input id="snils" value="${esc(emp.snils||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Военный билет (№, категория)</label>
              <input id="military_id" value="${esc(emp.military_id||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div style="grid-column:1/-1">
              <label>Водительское удостоверение</label>
              <input id="driver_license" value="${esc(emp.driver_license||"")}" placeholder="Категории, срок" ${canEdit?"":"disabled"}/>
            </div>
          </div>
        </details>

        <!-- Адреса и контакты -->
        <details style="margin-top:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:#22c55e"></span> Адреса и контакты</summary>
          <div class="formrow" style="margin-top:12px">
            <div style="grid-column:1/-1">
              <label>Адрес регистрации (прописка)</label>
              <input id="address_reg" value="${esc(emp.address_reg||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div style="grid-column:1/-1">
              <label>Фактический адрес проживания</label>
              <input id="address_fact" value="${esc(emp.address_fact||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Телефон основной</label>
              <input id="phone" value="${esc(emp.phone||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Телефон дополнительный</label>
              <input id="phone2" value="${esc(emp.phone2||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Email</label>
              <input id="email" type="email" value="${esc(emp.email||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Telegram</label>
              <input id="telegram" value="${esc(emp.telegram||"")}" placeholder="@username" ${canEdit?"":"disabled"}/>
            </div>
          </div>
        </details>

        <!-- Экстренные контакты -->
        <details style="margin-top:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:#ef4444"></span> Экстренные контакты</summary>
          <div class="formrow" style="margin-top:12px">
            <div>
              <label>ФИО супруга(и)</label>
              <input id="spouse_name" value="${esc(emp.spouse_name||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Телефон супруга(и)</label>
              <input id="spouse_phone" value="${esc(emp.spouse_phone||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>ФИО родственника</label>
              <input id="relative_name" value="${esc(emp.relative_name||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Кем приходится</label>
              <input id="relative_relation" value="${esc(emp.relative_relation||"")}" placeholder="мать/отец/брат..." ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Телефон родственника</label>
              <input id="relative_phone" value="${esc(emp.relative_phone||"")}" ${canEdit?"":"disabled"}/>
            </div>
          </div>
        </details>

        <!-- Дополнительно -->
        <details style="margin-top:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:#8b5cf6"></span> Дополнительно</summary>
          <div class="formrow" style="margin-top:12px">
            <div>
              <label>Образование</label>
              <input id="education" value="${esc(emp.education||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Специальность по диплому</label>
              <input id="specialty" value="${esc(emp.specialty||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Семейное положение</label>
              <select id="marital_status" ${canEdit?"":"disabled"}>
                <option value="">—</option>
                <option value="single" ${emp.marital_status==="single"?"selected":""}>Не женат/не замужем</option>
                <option value="married" ${emp.marital_status==="married"?"selected":""}>Женат/замужем</option>
                <option value="divorced" ${emp.marital_status==="divorced"?"selected":""}>Разведён(а)</option>
              </select>
            </div>
            <div>
              <label>Количество детей</label>
              <input id="children_count" type="number" min="0" value="${esc(emp.children_count||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Размер одежды</label>
              <input id="clothing_size" value="${esc(emp.clothing_size||"")}" placeholder="48-50" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Размер обуви</label>
              <input id="shoe_size" value="${esc(emp.shoe_size||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Рост (см)</label>
              <input id="height" type="number" value="${esc(emp.height||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Группа крови</label>
              <select id="blood_type" ${canEdit?"":"disabled"}>
                <option value="">—</option>
                <option value="O+" ${emp.blood_type==="O+"?"selected":""}>O(I)+</option>
                <option value="O-" ${emp.blood_type==="O-"?"selected":""}>O(I)−</option>
                <option value="A+" ${emp.blood_type==="A+"?"selected":""}>A(II)+</option>
                <option value="A-" ${emp.blood_type==="A-"?"selected":""}>A(II)−</option>
                <option value="B+" ${emp.blood_type==="B+"?"selected":""}>B(III)+</option>
                <option value="B-" ${emp.blood_type==="B-"?"selected":""}>B(III)−</option>
                <option value="AB+" ${emp.blood_type==="AB+"?"selected":""}>AB(IV)+</option>
                <option value="AB-" ${emp.blood_type==="AB-"?"selected":""}>AB(IV)−</option>
              </select>
            </div>
            <div style="grid-column:1/-1">
              <label>Аллергии / мед. ограничения</label>
              <input id="medical_notes" value="${esc(emp.medical_notes||"")}" ${canEdit?"":"disabled"}/>
            </div>
          </div>
        </details>

        <!-- Допуски и разрешения -->
        <details style="margin-top:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:#06b6d4"></span> Допуски и разрешения</summary>
          <div style="margin-top:12px">
            <div class="row" style="flex-wrap:wrap; gap:8px">
              ${(permits||[]).map(p=>{
                const checked = empPermits.includes(p);
                return `<label class="badge" style="display:inline-flex; align-items:center; gap:8px; cursor:${canEdit?"pointer":"default"}">
                  <input type="checkbox" class="perm" value="${esc(p)}" ${checked?"checked":""} ${canEdit?"":"disabled"}/>
                  <span>${esc(p)}</span>
                </label>`;
              }).join("") || `<span class="help">Справочник пуст. Добавьте допуски в Настройках.</span>`}
            </div>
            <div class="help" style="margin-top:8px">Справочник настраивается в «Кузнице Настроек»</div>
          </div>
        </details>

        <!-- Комментарии -->
        <details style="margin-top:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:#94a3b8"></span> Комментарии (${(emp.comments||[]).length})</summary>
          <div style="margin-top:12px">
            ${canEdit ? `
              <div class="row" style="gap:8px;margin-bottom:12px">
                <input id="newComment" class="inp" placeholder="Добавить комментарий..." style="flex:1"/>
                <button class="btn" id="btnAddComment">Добавить</button>
              </div>
            ` : ''}
            <div id="commentsBlock">
              ${(emp.comments||[]).slice().reverse().map(c => `
                <div class="card" style="padding:10px;margin-bottom:8px">
                  <div style="font-size:12px;opacity:0.7">${esc(c.author||"?")} · ${c.date ? new Date(c.date).toLocaleString("ru-RU") : ""}</div>
                  <div style="margin-top:4px">${esc(c.text)}</div>
                </div>
              `).join("") || '<div class="help">Комментариев нет</div>'}
            </div>
          </div>
        </details>

        <!-- Ссылка на документы -->
        <details style="margin-top:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:#f97316"></span> Документы (файлы)</summary>
          <div class="formrow" style="margin-top:12px">
            <div style="grid-column:1/-1">
              <label>Ссылка на папку документов сотрудника</label>
              <input id="docs" value="${esc(emp.docs_folder_link||"")}" placeholder="https://drive.google.com/..." ${canEdit?"":"disabled"}/>
            </div>
          </div>
        </details>

        <hr class="hr"/>

        <div class="kpi"><span class="dot" style="background:#3b82f6"></span> История работ</div>
        <div class="tablewrap" style="margin-top:10px">
          <table class="table">
            <thead><tr><th>С</th><th>По</th><th>Контракт</th><th>Роль на объекте</th></tr></thead>
            <tbody>${assignHtml}</tbody>
          </table>
        </div>

        <hr class="hr"/>

        <div class="kpi"><span class="dot" style="background:#22c55e"></span> Отзывы РП</div>
        <div style="margin-top:10px">${revHtml}</div>

        <div class="help" style="margin-top:10px">ᚱ Хороший воин ценится делом, а не словами.</div>
      </div>
    `;

    await layout(html, {title: title || "Личное дело", motto: "Сильна дружина, где помнят имена и дела."});

    $("#btnSchedule").onclick=()=>{ location.hash=`#/workers-schedule?emp=${id}`; };

    // Добавление комментария
    const btnAddComment = document.getElementById("btnAddComment");
    if(btnAddComment){
      btnAddComment.onclick = async () => {
        const text = $("#newComment")?.value?.trim();
        if(!text){ toast("Ошибка","Введите комментарий","err"); return; }
        if(!emp.comments) emp.comments = [];
        emp.comments.push({
          text,
          author: user.name || user.login,
          date: isoNow()
        });
        await AsgardDB.put("employees", emp);
        toast("Добавлено","Комментарий сохранён");
        location.hash = `#/employee?id=${id}`;
      };
    }

    const btnSave = document.getElementById("btnSave");
    if(btnSave){
      btnSave.onclick=async ()=>{
        // Основная информация
        emp.fio=$("#fio")?.value?.trim() || emp.fio;
        const birth=$("#birth")?.value?.trim();
        if(!birth){ toast("Проверка","Дата рождения обязательна","err"); return; }
        emp.birth_date=birth;
        emp.gender=$("#gender")?.value || "";
        emp.role_tag=$("#role")?.value?.trim() || "";
        emp.grade=$("#grade")?.value?.trim() || "";
        emp.hire_date=$("#hire_date")?.value || "";

        // Документы
        emp.pass_series=$("#pass_series")?.value?.trim() || "";
        emp.pass_number=$("#pass_number")?.value?.trim() || "";
        emp.pass_issued_by=$("#pass_issued_by")?.value?.trim() || "";
        emp.pass_issued_date=$("#pass_issued_date")?.value || "";
        emp.pass_code=$("#pass_code")?.value?.trim() || "";
        emp.inn=$("#inn")?.value?.trim() || "";
        emp.snils=$("#snils")?.value?.trim() || "";
        emp.military_id=$("#military_id")?.value?.trim() || "";
        emp.driver_license=$("#driver_license")?.value?.trim() || "";

        // Адреса и контакты
        emp.address_reg=$("#address_reg")?.value?.trim() || "";
        emp.address_fact=$("#address_fact")?.value?.trim() || "";
        emp.phone=$("#phone")?.value?.trim() || "";
        emp.phone2=$("#phone2")?.value?.trim() || "";
        emp.email=$("#email")?.value?.trim() || "";
        emp.telegram=$("#telegram")?.value?.trim() || "";

        // Экстренные контакты
        emp.spouse_name=$("#spouse_name")?.value?.trim() || "";
        emp.spouse_phone=$("#spouse_phone")?.value?.trim() || "";
        emp.relative_name=$("#relative_name")?.value?.trim() || "";
        emp.relative_relation=$("#relative_relation")?.value?.trim() || "";
        emp.relative_phone=$("#relative_phone")?.value?.trim() || "";

        // Дополнительно
        emp.education=$("#education")?.value?.trim() || "";
        emp.specialty=$("#specialty")?.value?.trim() || "";
        emp.marital_status=$("#marital_status")?.value || "";
        emp.children_count=$("#children_count")?.value ? Number($("#children_count").value) : null;
        emp.clothing_size=$("#clothing_size")?.value?.trim() || "";
        emp.shoe_size=$("#shoe_size")?.value?.trim() || "";
        emp.height=$("#height")?.value ? Number($("#height").value) : null;
        emp.blood_type=$("#blood_type")?.value || "";
        emp.medical_notes=$("#medical_notes")?.value?.trim() || "";

        // Допуски
        emp.permits = Array.from(document.querySelectorAll("input.perm:checked")).map(x=>x.value);
        
        // Документы (ссылка)
        emp.docs_folder_link=$("#docs")?.value?.trim() || "";

        emp.updated_at = isoNow();
        await AsgardDB.put("employees", emp);
        toast("Сохранено","Данные обновлены");
      };
    }

    const btnReview = document.getElementById("btnReview");
    if(btnReview){
      btnReview.onclick=()=>{
        const body = `
          <div class="formrow">
            <div style="grid-column:1/-1">
              <label for="w">Контракт</label>
              <select id="w">
                <option value="">—</option>
                ${(works||[]).map(w=>`<option value="${w.id}">${esc(w.work_title||"")}</option>`).join("")}
              </select>
            </div>
            <div>
              <label for="score">Оценка (1..10)</label>
              <input id="score" placeholder="10" value="8"/>
            </div>
            <div style="grid-column:1/-1">
              <label for="comm">Комментарий</label>
              <textarea id="comm" rows="3" placeholder="что сделал хорошо / что улучшить"></textarea>
            </div>
          </div>
          <div class="row" style="justify-content:flex-end; gap:8px; margin-top:12px">
            <button class="btn" id="btnSend">Сохранить отзыв</button>
          </div>
        `;
        showModal("Оценка сотрудника", body);
        $("#btnSend").onclick = async ()=>{
          const work_id = Number($("#w").value||0) || null;
          const score = Number($("#score").value||0);
          if(!(score>=1 && score<=10)){ toast("Проверка","Оценка 1..10","err"); return; }
          const comm = $("#comm").value.trim();
          await AsgardDB.add("employee_reviews",{employee_id:id, work_id, pm_id:user.id, score_1_10:score, comment:comm, created_at: isoNow()});
          await recomputeRating(id);
          toast("Готово","Отзыв сохранён");
          location.hash = `#/employee?id=${id}`;
        };
      };
    }
  }

  return {render};
})();