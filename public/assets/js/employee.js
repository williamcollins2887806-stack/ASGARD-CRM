window.AsgardEmployeePage=(function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(String(r||"" )==="DIRECTOR"||String(r||"" ).startsWith("DIRECTOR_"));

  function isoNow(){ return new Date().toISOString(); }

  function normalizeDateInput(value){
    if(value === undefined || value === null || value === '') return '';

    if(value instanceof Date){
      return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0,10);
    }

    const raw = String(value).trim();
    if(!raw) return '';

    const direct = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
    if(direct) return direct[1];

    const prefixed = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
    if(prefixed) return prefixed[1];

    const parsed = new Date(raw);
    if(Number.isNaN(parsed.getTime())) return '';

    return parsed.toISOString().slice(0,10);
  }

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
    if(!(user.role==="ADMIN" || user.role==="HR" || user.role==="PM" || user.role==="TO" || user.role==="OFFICE_MANAGER" || user.role==="HR_MANAGER" || user.role==="HEAD_PM" || user.role==="HEAD_TO" || isDirRole(user.role))){
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
    const usersAll = await AsgardDB.all("users");
    const userMap = new Map((usersAll||[]).map(u=>[u.id, u.name||u.login||'']));
    const assigns = (await AsgardDB.byIndex("employee_assignments","employee_id", id)) || [];
    assigns.sort((a,b)=> String(b.date_from||"").localeCompare(String(a.date_from||"")));

    const revs = (await AsgardDB.byIndex("employee_reviews","employee_id", id)) || [];
    revs.sort((a,b)=> String(b.created_at||"").localeCompare(String(a.created_at||"")));

    const workMap = new Map((works||[]).map(w=>[w.id,w]));
    const tenders = await AsgardDB.all("tenders");
    const tenderMap = new Map((tenders||[]).map(t=>[t.id,t]));
    const todayStr = new Date().toISOString().slice(0,10);

    // Separate current and past assignments
    const currentAssigns = assigns.filter(a => !a.date_to || a.date_to.slice(0,10) >= todayStr);
    const pastAssigns = assigns.filter(a => a.date_to && a.date_to.slice(0,10) < todayStr);

    function assignRow(a, isCurrent) {
      const w = workMap.get(a.work_id);
      const t = w ? tenderMap.get(w.tender_id) : null;
      const customer = w?.customer_name || t?.customer_name || '';
      const city = w?.city || t?.city || w?.object_address || '';
      const wStatus = w?.work_status || '';
      const statusBadge = isCurrent
        ? '<span style="background:rgba(34,197,94,.2);color:var(--ok-t);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap">Сейчас</span>'
        : (wStatus ? `<span style="background:rgba(100,116,139,.2);color:var(--t2);padding:2px 8px;border-radius:6px;font-size:11px;white-space:nowrap">${esc(wStatus)}</span>` : '');
      return `<tr${isCurrent?' style="background:rgba(34,197,94,.08)"':''}>
        <td style="white-space:nowrap">${a.date_from ? new Date(a.date_from).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—'}</td>
        <td style="white-space:nowrap">${a.date_to ? new Date(a.date_to).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—'}</td>
        <td><b>${w?esc(w.work_title||""):"—"}</b></td>
        <td>${esc(customer)}</td>
        <td>${esc(city)}</td>
        <td>${esc(a.role||a.role_on_work||"")}</td>
        <td>${w?.pm_id ? esc(userMap.get(w.pm_id)||'') : '—'}</td>
        <td>${statusBadge}</td>
      </tr>`;
    }

    const assignHtml = (currentAssigns.length + pastAssigns.length) > 0
      ? currentAssigns.map(a=>assignRow(a, true)).join("") + pastAssigns.map(a=>assignRow(a, false)).join("")
      : `<tr><td colspan="8" class="muted">Истории назначений нет</td></tr>`;

    const revHtml = revs.map(r=>{
      const w = workMap.get(r.work_id);
      const who = r.pm_id ? `РП #${r.pm_id}` : "РП";
      return `<div class="pill" style="align-items:flex-start; gap:10px">
        <div style="margin-top:3px"><span class="dot" style="background:var(--err-t)"></span></div>
        <div style="flex:1">
          <div class="who"><b>${esc(who)}</b> <span class="help">${esc(new Date(r.created_at).toLocaleString("ru-RU"))}</span></div>
          <div class="row" style="gap:8px; margin-top:6px; flex-wrap:wrap">
            <span class="badge"><span class="dot" style="background:var(--ok-t)"></span>${esc(String(r.score_1_10 ?? '—'))}/10</span>
            <span class="badge"><span class="dot" style="background:var(--info)"></span>${w?esc(w.work_title||""):"—"}</span>
          </div>
          <div class="help" style="margin-top:6px">${esc(r.comment||"")}</div>
        </div>
      </div>`;
    }).join("") || `<div class="help">Пока нет оценок.</div>`;

    const html = `
      <div class="panel">
        <div class="row" style="justify-content:space-between; gap:10px; flex-wrap:wrap">
          <div>
            <div class="kpi"><span class="dot" style="background:var(--err-t)"></span>${esc(emp.fio||"")}</div>
            <div class="help">Роль: <b>${esc(emp.role_tag||"—")}</b> · Разряд: <b>${esc(emp.grade||"—")}</b> · Рейтинг: <b>${emp.rating_avg!=null?esc(Number(emp.rating_avg).toFixed(1)):"—"}</b></div>
          </div>
          <div class="row" style="gap:8px; flex-wrap:wrap">
            <button class="btn ghost" id="btnAiSummary" title="Мимир сгенерирует краткую характеристику">\uD83E\uDDD9 Характеристика</button>
            <button class="btn ghost" id="btnSchedule">График</button>
            <button class="btn ghost" id="btnProfile">\uD83D\uDCCB Анкета</button>
            ${canEdit ? `<button class="btn" id="btnSave">Сохранить</button>` : ``}
            ${(user.role==="PM" || user.role==="ADMIN" || isDirRole(user.role)) ? `<button class="btn red" id="btnReview">Оценить</button>` : ``}
          </div>
        </div>

        <div id="aiSummaryBlock" style="display:none;margin:12px 0;padding:16px;background:rgba(59,130,246,0.06);border-left:3px solid var(--blue-l);border-radius:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-weight:700;color:var(--blue-l);font-size:13px">\uD83E\uDDD9 Характеристика от Мимира</span>
            <div style="display:flex;gap:6px">
              <button id="btnRefreshSummary" class="btn ghost mini" title="Обновить">\uD83D\uDD04</button>
              <button id="btnCloseSummary" class="btn ghost mini" title="Скрыть">\u00D7</button>
            </div>
          </div>
          <div id="aiSummaryText" style="font-size:13px;line-height:1.6;color:var(--t1)"></div>
          <div id="aiSummaryMeta" style="margin-top:8px;font-size:11px;color:var(--t3)"></div>
        </div>

        <!-- Основная информация -->
        <details open style="margin-top:16px">
          <summary class="kpi" style="cursor:pointer"><span style="display:inline-block;width:3px;height:14px;border-radius:2px;background:var(--info);margin-right:8px;vertical-align:middle"></span> Основная информация</summary>
          <div class="formrow" style="margin-top:12px">
            <div>
              <label>ФИО (полностью)</label>
              <input id="fio" value="${esc(emp.fio||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Дата рождения</label>
              <input id="birth" type="date" value="${esc(normalizeDateInput(emp.birth_date))}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Пол</label>
              <div id="gender_w"></div>
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
              <input id="hire_date" type="date" value="${esc(normalizeDateInput(emp.hire_date))}" ${canEdit?"":"disabled"}/>
            </div>
          </div>
        </details>

        <!-- Документы -->
        <details style="margin-top:16px">
          <summary class="kpi" style="cursor:pointer"><span style="display:inline-block;width:3px;height:14px;border-radius:2px;background:var(--amber);margin-right:8px;vertical-align:middle"></span> Документы</summary>
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
              <input id="passport_issued" value="${esc(emp.passport_issued||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Дата выдачи</label>
              <input id="passport_date" type="date" value="${esc(normalizeDateInput(emp.passport_date))}" ${canEdit?"":"disabled"}/>
            </div>
            <div>
              <label>Код подразделения</label>
              <input id="passport_code" value="${esc(emp.passport_code||"")}" placeholder="123-456" ${canEdit?"":"disabled"}/>
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
          <summary class="kpi" style="cursor:pointer"><span style="display:inline-block;width:3px;height:14px;border-radius:2px;background:var(--ok-t);margin-right:8px;vertical-align:middle"></span> Адреса и контакты</summary>
          <div class="formrow" style="margin-top:12px">
            <div style="grid-column:1/-1">
              <label>Адрес регистрации (прописка)</label>
              <input id="registration_address" value="${esc(emp.registration_address||"")}" ${canEdit?"":"disabled"}/>
            </div>
            <div style="grid-column:1/-1">
              <label>Фактический адрес проживания</label>
              <input id="address_fact" value="${esc(emp.address||"")}" ${canEdit?"":"disabled"}/>
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
          <summary class="kpi" style="cursor:pointer"><span style="display:inline-block;width:3px;height:14px;border-radius:2px;background:var(--err-t);margin-right:8px;vertical-align:middle"></span> Экстренные контакты</summary>
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
          <summary class="kpi" style="cursor:pointer"><span style="display:inline-block;width:3px;height:14px;border-radius:2px;background:var(--purple);margin-right:8px;vertical-align:middle"></span> Дополнительно</summary>
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
              <div id="marital_status_w"></div>
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
              <div id="blood_type_w"></div>
            </div>
            <div style="grid-column:1/-1">
              <label>Аллергии / мед. ограничения</label>
              <input id="medical_notes" value="${esc(emp.medical_notes||"")}" ${canEdit?"":"disabled"}/>
            </div>
          </div>
        </details>

        <!-- Допуски и разрешения -->
        <details style="margin-top:16px">
          <summary class="kpi" style="cursor:pointer"><span style="display:inline-block;width:3px;height:14px;border-radius:2px;background:var(--cyan);margin-right:8px;vertical-align:middle"></span> Допуски и разрешения</summary>
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
            <div style="margin-top:16px">
              <label style="margin:0"><b>Документы и разрешения (подробно)</b></label>
              <div id="permitsDetailBlock" style="margin-top:8px"><span class="help">Загрузка...</span></div>
            </div>
          </div>
        </details>

        <!-- Комментарии -->
        <details style="margin-top:16px">
          <summary class="kpi" style="cursor:pointer"><span style="display:inline-block;width:3px;height:14px;border-radius:2px;background:var(--t2);margin-right:8px;vertical-align:middle"></span> Комментарии (${(emp.comments||[]).length})</summary>
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
          <summary class="kpi" style="cursor:pointer"><span style="display:inline-block;width:3px;height:14px;border-radius:2px;background:var(--orange);margin-right:8px;vertical-align:middle"></span> Документы (файлы)</summary>
          <div class="formrow" style="margin-top:12px">
            <div style="grid-column:1/-1">
              <label>Ссылка на папку документов сотрудника</label>
              <input id="docs" value="${esc(emp.docs_folder_link||"")}" placeholder="https://drive.google.com/..." ${canEdit?"":"disabled"}/>
            </div>
          </div>
        </details>

        <hr class="hr"/>

        <div class="kpi"><span class="dot" style="background:var(--info)"></span> История работ</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin:10px 0">
          <div style="padding:10px 16px;background:var(--bg3);border-radius:8px;border:1px solid var(--brd);text-align:center">
            <div style="font-size:20px;font-weight:900;color:var(--gold)">${assigns.length}</div>
            <div style="font-size:11px;color:var(--t3)">Всего работ</div>
          </div>
          <div style="padding:10px 16px;background:var(--bg3);border-radius:8px;border:1px solid var(--brd);text-align:center">
            <div style="font-size:20px;font-weight:900;color:var(--ok-t)">${currentAssigns.length}</div>
            <div style="font-size:11px;color:var(--t3)">Активных</div>
          </div>
          <div style="padding:10px 16px;background:var(--bg3);border-radius:8px;border:1px solid var(--brd);text-align:center">
            <div style="font-size:20px;font-weight:900;color:var(--t1)">${(function(){
              var total = 0;
              assigns.forEach(function(a2){
                var d1 = a2.date_from ? new Date(a2.date_from) : null;
                var d2 = a2.date_to ? new Date(a2.date_to) : new Date();
                if(d1) total += Math.max(0, Math.round((d2-d1)/86400000));
              });
              return total;
            })()}</div>
            <div style="font-size:11px;color:var(--t3)">Дней отработано</div>
          </div>
          <div style="padding:10px 16px;background:var(--bg3);border-radius:8px;border:1px solid var(--brd);text-align:center">
            <div style="font-size:20px;font-weight:900;color:var(--info)">${new Set(assigns.map(function(a2){var w2=workMap.get(a2.work_id);return w2?.customer_name||'';}).filter(Boolean)).size}</div>
            <div style="font-size:11px;color:var(--t3)">Заказчиков</div>
          </div>
        </div>

        <!-- Timeline / Gantt -->
        <div id="empTimeline" style="margin-bottom:16px;position:relative;overflow-x:auto;min-height:60px"></div>

        <div class="tablewrap" style="margin-top:10px">
          <table class="tbl">
            <thead><tr><th>С</th><th>По</th><th>Контракт</th><th>Заказчик</th><th>Город</th><th>Роль</th><th>РП</th><th style="min-width:80px">Статус</th></tr></thead>
            <tbody>${assignHtml}</tbody>
          </table>
        </div>

        <hr class="hr"/>

        <div class="kpi"><span class="dot" style="background:var(--ok-t)"></span> Отзывы РП</div>
        <div style="margin-top:10px">${revHtml}</div>

        <div class="help" style="margin-top:10px">ᚱ Хороший воин ценится делом, а не словами.</div>
      </div>
    `;

    await layout(html, {title: title || "Личное дело", motto: "Сильна дружина, где помнят имена и дела."});

    // ─── CRSelect: employee form fields ───
    $('#gender_w')?.appendChild(CRSelect.create({ id: 'gender', options: [{ value: '', label: '—' }, { value: 'male', label: 'Мужской' }, { value: 'female', label: 'Женский' }], value: emp.gender || '', disabled: !canEdit }));
    $('#marital_status_w')?.appendChild(CRSelect.create({ id: 'marital_status', options: [{ value: '', label: '—' }, { value: 'single', label: 'Не женат/не замужем' }, { value: 'married', label: 'Женат/замужем' }, { value: 'divorced', label: 'Разведён(а)' }], value: emp.marital_status || '', disabled: !canEdit }));
    const _bloodOpts = [{ value: '', label: '—' }, { value: 'O+', label: 'O(I)+' }, { value: 'O-', label: 'O(I)−' }, { value: 'A+', label: 'A(II)+' }, { value: 'A-', label: 'A(II)−' }, { value: 'B+', label: 'B(III)+' }, { value: 'B-', label: 'B(III)−' }, { value: 'AB+', label: 'AB(IV)+' }, { value: 'AB-', label: 'AB(IV)−' }];
    $('#blood_type_w')?.appendChild(CRSelect.create({ id: 'blood_type', options: _bloodOpts, value: emp.blood_type || '', disabled: !canEdit }));

    // ── Timeline / Gantt ──
    (function renderTimeline(){
      var container = document.getElementById('empTimeline');
      if (!container || assigns.length === 0) {
        if (container) container.innerHTML = '<div class="help" style="text-align:center;padding:12px">Нет данных для таймлайна</div>';
        return;
      }
      var now = new Date();
      var allDates = [];
      assigns.forEach(function(a2){
        if(a2.date_from) allDates.push(new Date(a2.date_from));
        allDates.push(a2.date_to ? new Date(a2.date_to) : now);
      });
      var minD = new Date(Math.min.apply(null, allDates));
      var maxD = new Date(Math.max.apply(null, allDates));
      minD.setDate(1); minD.setMonth(minD.getMonth()-1);
      maxD.setDate(1); maxD.setMonth(maxD.getMonth()+2);
      var totalMs = maxD - minD;
      if(totalMs <= 0) return;

      // Month headers
      var months = [];
      var cur = new Date(minD);
      while(cur < maxD){
        months.push({d: new Date(cur), label: cur.toLocaleDateString('ru-RU',{month:'short',year:'2-digit'})});
        cur.setMonth(cur.getMonth()+1);
      }
      var monthW = Math.max(60, 900 / months.length);
      var totalW = monthW * months.length;

      var headerH = '<div style="display:flex;border-bottom:1px solid var(--brd)">';
      months.forEach(function(m2){
        headerH += '<div style="width:'+monthW+'px;flex-shrink:0;text-align:center;font-size:10px;color:var(--t3);padding:4px 0;border-right:1px solid rgba(255,255,255,0.03)">'+m2.label+'</div>';
      });
      headerH += '</div>';

      var barsH = '';
      var rowH = 38;
      assigns.forEach(function(a2, idx){
        var d1 = a2.date_from ? new Date(a2.date_from) : minD;
        var d2 = a2.date_to ? new Date(a2.date_to) : now;
        var left = ((d1 - minD) / totalMs) * totalW;
        var width = Math.max(4, ((d2 - d1) / totalMs) * totalW);
        var w2 = workMap.get(a2.work_id);
        var t2 = w2 ? tenderMap.get(w2?.tender_id) : null;
        var isCurr = !a2.date_to || a2.date_to.slice(0,10) >= todayStr;
        var bgColor = isCurr ? 'linear-gradient(135deg,#d4a825,#c9952a)' : 'linear-gradient(135deg,#22c55e,#1a8a4a)';
        var label = w2 ? (w2.work_title||'').substring(0,25) : '';
        var customer = w2?.customer_name || t2?.customer_name || '';
        var pmName = w2?.pm_id ? (userMap.get(w2.pm_id)||'') : '';
        var role = a2.role || a2.role_on_work || '';
        var days = Math.max(1, Math.round((d2-d1)/86400000));
        var df = d1.toLocaleDateString('ru-RU');
        var dt = a2.date_to ? d2.toLocaleDateString('ru-RU') : 'по н.в.';

        var tooltip = label+'\n'+customer+'\nРП: '+pmName+'\nРоль: '+role+'\n'+df+' — '+dt+'\n'+days+' дн.'+(isCurr?' (активна)':' (завершена)');

        barsH += '<div style="position:absolute;left:'+left+'px;top:'+(idx*rowH+4)+'px;width:'+width+'px;height:'+(rowH-8)+'px;background:'+bgColor+';border-radius:6px;display:flex;align-items:center;padding:0 6px;font-size:10px;font-weight:600;color:#fff;cursor:pointer;overflow:hidden;white-space:nowrap;transition:transform 0.15s,box-shadow 0.15s;z-index:1" title="'+tooltip.replace(/"/g,'&quot;')+'" onmouseover="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 4px 12px rgba(0,0,0,0.3)\';this.style.zIndex=10" onmouseout="this.style.transform=\'none\';this.style.boxShadow=\'none\';this.style.zIndex=1">'+label+'</div>';
      });

      // Today line
      var todayLeft = ((now - minD) / totalMs) * totalW;
      var todayLine = '<div style="position:absolute;left:'+todayLeft+'px;top:0;bottom:0;width:2px;background:var(--red);z-index:5;opacity:0.6" title="Сегодня"></div>';

      var totalHeight = assigns.length * rowH + 10;
      container.innerHTML = '<div style="min-width:'+totalW+'px">' +
        headerH +
        '<div style="position:relative;height:'+totalHeight+'px;margin-top:4px">' +
          // grid lines
          months.map(function(m2,i2){ return '<div style="position:absolute;left:'+(i2*monthW)+'px;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.03)"></div>'; }).join('') +
          barsH + todayLine +
        '</div>' +
        '<div style="display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--t3)">' +
          '<span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:linear-gradient(135deg,#d4a825,#c9952a);margin-right:4px;vertical-align:middle"></span>Активна</span>' +
          '<span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:linear-gradient(135deg,#22c55e,#1a8a4a);margin-right:4px;vertical-align:middle"></span>Работы сдали</span>' +
          '<span style="margin-left:auto"><span style="display:inline-block;width:10px;height:2px;background:var(--red);margin-right:4px;vertical-align:middle"></span>Сегодня</span>' +
        '</div>' +
      '</div>';
    })();

    // Render detailed permits table
    if (window.AsgardPermitsPage && AsgardPermitsPage.renderEmployeePermits) {
      AsgardPermitsPage.renderEmployeePermits(id, canEdit).then(h => {
        const b = document.getElementById("permitsDetailBlock");
        if (b) {
          b.innerHTML = h;
          // Bind "Add permit" button
          const btnAdd = b.querySelector("#btnAddPermit");
          if (btnAdd && AsgardPermitsPage.openPermitModal) {
            btnAdd.onclick = () => AsgardPermitsPage.openPermitModal(id, null, () => {
              AsgardPermitsPage.renderEmployeePermits(id, canEdit).then(h2 => { b.innerHTML = h2; });
            });
          }
          // Bind edit/delete buttons
          b.querySelectorAll(".btnEditPermit").forEach(btn => {
            btn.onclick = async () => {
              const pId = parseInt(btn.dataset.id);
              const permits = await AsgardPermitsPage.getAll();
              const p = (permits||[]).find(x => x.id === pId);
              if (p && AsgardPermitsPage.openPermitModal) {
                AsgardPermitsPage.openPermitModal(id, p, () => {
                  AsgardPermitsPage.renderEmployeePermits(id, canEdit).then(h2 => { b.innerHTML = h2; });
                });
              }
            };
          });
          b.querySelectorAll(".btnDelPermit").forEach(btn => {
            btn.onclick = async () => {
              if (!confirm("Удалить разрешение?")) return;
              await AsgardPermitsPage.remove(parseInt(btn.dataset.id));
              AsgardPermitsPage.renderEmployeePermits(id, canEdit).then(h2 => { b.innerHTML = h2; });
            };
          });
        }
      }).catch(e => {
        const b = document.getElementById("permitsDetailBlock");
        if (b) b.innerHTML = '<span class="help">Ошибка загрузки допусков: ' + esc(e.message) + '</span>';
      });
    } else {
      const b = document.getElementById("permitsDetailBlock");
      if (b) b.innerHTML = '<span class="help">Модуль допусков не подключён</span>';
    }

    $("#btnSchedule").onclick=()=>{ location.hash=`#/workers-schedule?emp=${id}`; };

    const btnProfile = document.getElementById("btnProfile");
    if(btnProfile){
      btnProfile.onclick=()=>{
        if(!window.WorkerProfileDesktop){ toast("Ошибка","Модуль анкет не загружен","err"); return; }
        WorkerProfileDesktop.open({ user_id: emp.user_id, employee_id: id, fio: emp.fio });
      };
    }

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
        emp.gender=CRSelect.getValue('gender') || "";
        emp.role_tag=$("#role")?.value?.trim() || "";
        emp.grade=$("#grade")?.value?.trim() || "";
        emp.hire_date=$("#hire_date")?.value || "";

        // Документы
        emp.pass_series=$("#pass_series")?.value?.trim() || "";
        emp.pass_number=$("#pass_number")?.value?.trim() || "";
        emp.passport_issued=$("#passport_issued")?.value?.trim() || "";
        emp.passport_date=$("#passport_date")?.value || "";
        emp.passport_code=$("#passport_code")?.value?.trim() || "";
        emp.inn=$("#inn")?.value?.trim() || "";
        emp.snils=$("#snils")?.value?.trim() || "";
        emp.military_id=$("#military_id")?.value?.trim() || "";
        emp.driver_license=$("#driver_license")?.value?.trim() || "";

        // Адреса и контакты
        emp.registration_address=$("#registration_address")?.value?.trim() || "";
        emp.address=$("#address_fact")?.value?.trim() || "";
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
        emp.marital_status=CRSelect.getValue('marital_status') || "";
        emp.children_count=$("#children_count")?.value ? Number($("#children_count").value) : null;
        emp.clothing_size=$("#clothing_size")?.value?.trim() || "";
        emp.shoe_size=$("#shoe_size")?.value?.trim() || "";
        emp.height=$("#height")?.value ? Number($("#height").value) : null;
        emp.blood_type=CRSelect.getValue('blood_type') || "";
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
              <div id="w_w"></div>
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
        $('#w_w')?.appendChild(CRSelect.create({ id: 'w_sel', options: [{ value: '', label: '—' }, ...(works||[]).map(w => ({ value: String(w.id), label: w.work_title || '' }))], searchable: true, dropdownClass: 'z-modal' }));
        $("#btnSend").onclick = async ()=>{
          const work_id = Number(CRSelect.getValue('w_sel')||0) || null;
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

    // 🧙 AI-характеристика
    async function loadAiSummary() {
      const block = document.getElementById('aiSummaryBlock');
      const textEl = document.getElementById('aiSummaryText');
      const metaEl = document.getElementById('aiSummaryMeta');
      if (!block || !textEl) return;

      block.style.display = 'block';
      textEl.innerHTML = '<span style="color:var(--t3)">\u23F3 Мимир анализирует данные...</span>';
      metaEl.textContent = '';

      try {
        const token = localStorage.getItem('asgard_token');
        const resp = await fetch('/api/mimir/employee-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ employee_id: id })
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          textEl.innerHTML = '<span style="color:var(--err-t)">Ошибка: ' + esc(err.message || 'HTTP ' + resp.status) + '</span>';
          return;
        }

        const data = await resp.json();
        if (data.success && data.summary) {
          textEl.textContent = data.summary;
          const sources = data.data_sources || {};
          const parts = [];
          if (sources.has_profile) parts.push('анкета');
          if (sources.reviews_count > 0) parts.push(sources.reviews_count + ' отзывов');
          if (sources.assignments_count > 0) parts.push(sources.assignments_count + ' назначений');
          if (sources.has_payroll) parts.push('зарплата');
          metaEl.textContent = 'Источники: ' + (parts.length ? parts.join(', ') : 'основные данные');
        } else {
          textEl.innerHTML = '<span style="color:var(--err-t)">' + esc(data.message || 'Не удалось') + '</span>';
        }
      } catch (e) {
        textEl.innerHTML = '<span style="color:var(--err-t)">Ошибка: ' + esc(e.message) + '</span>';
      }
    }

    const btnAiSummary = document.getElementById('btnAiSummary');
    if (btnAiSummary) btnAiSummary.addEventListener('click', loadAiSummary);

    const btnRefreshSummary = document.getElementById('btnRefreshSummary');
    if (btnRefreshSummary) btnRefreshSummary.addEventListener('click', loadAiSummary);

    const btnCloseSummary = document.getElementById('btnCloseSummary');
    if (btnCloseSummary) btnCloseSummary.addEventListener('click', () => {
      const block = document.getElementById('aiSummaryBlock');
      if (block) block.style.display = 'none';
    });
  }

  return {render};
})();