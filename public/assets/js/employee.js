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
    // Финансовые поля (Оклад/несгораемая/can_exceed_limit/offset) — правит только бухгалтер/директор/админ.
    // HR/TO/прочие видят значения текстом, без input.
    const canEditFinance = ["ADMIN","DIRECTOR_GEN","DIRECTOR_COMM","DIRECTOR_DEV","BUH"].includes(user.role);

    const query = parseQuery();
    const id = Number(query.id||0);
    const emp = await AsgardDB.get("employees", id);
    if(!emp){ toast("Сотрудник","Не найден","err"); location.hash="#/personnel"; return; }

    // Подтягиваем серверный snapshot из /api/staff/readiness — там есть on_site_info/approved_info,
    // last_assignment_info (последняя работа), effective_status, readiness_date/reason —
    // поля которых нет в локальной AsgardDB.
    // Используется для блока «Текущий/Последний объект, РП» и кнопок ✓ Готов / ✗ Не готов / Архив.
    let empServer = null;
    try {
      const rd = await apiFetch("/staff/readiness");
      empServer = (rd.employees || []).find(e => e.id === Number(id));
      if (empServer) {
        emp.on_site_info         = empServer.on_site_info         || null;
        emp.approved_info        = empServer.approved_info        || null;
        emp.last_assignment_info = empServer.last_assignment_info || null;
        emp.effective_status     = empServer.effective_status || emp.effective_status;
        emp.readiness_status     = empServer.readiness_status || emp.readiness_status;
        emp.readiness_date       = empServer.readiness_date   || emp.readiness_date;
        emp.readiness_reason     = empServer.readiness_reason || emp.readiness_reason;
      }
    } catch(_) { /* offline / API недоступен — рендерим без блока */ }

    // Если у рабочего привязан получатель НПД (se_payee_id) — подгрузим ФИО+телефон
    // для отображения. Локальная БД может его не знать; ищем через /staff/payees.
    if (emp.se_payee_id && !emp.se_payee_fio) {
      try {
        // Сначала пробуем взять напрямую из локальной БД (там employees уже синкнуты).
        const local = await AsgardDB.get("employees", Number(emp.se_payee_id));
        if (local && local.fio) {
          emp.se_payee_fio = local.fio;
          emp.se_payee_phone = local.phone || "";
        } else {
          // Иначе обращаемся к payees endpoint (search по id не обязан работать,
          // но поиск по ФИО=пусто отдаст список всех payees — на проде их единицы).
          const r = await apiFetch("/staff/payees?search=&limit=200");
          const items = (r && (r.payees || r.items)) || [];
          const found = items.find(x => Number(x.id) === Number(emp.se_payee_id));
          if (found) {
            emp.se_payee_fio = found.fio;
            emp.se_payee_phone = found.phone || "";
          }
        }
      } catch(_) { /* offline — отрендерим хотя бы id */ }
    }

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

        ${emp && (emp.on_site_info || emp.approved_info) ? `
          <div style="margin-top:12px;padding:10px 14px;background:var(--bg2);border-left:3px solid var(--gold);border-radius:6px;font-size:13px;color:var(--t1)">
            <span style="color:var(--t3)">🏗 ${emp.on_site_info ? "На объекте" : "Согласован"}:</span>
            <b>${esc((emp.on_site_info || emp.approved_info).work_title || "—")}</b>
            ${(emp.on_site_info || emp.approved_info).pm_name
              ? ` &middot; <span style="color:var(--t3)">РП:</span> <b>${esc((emp.on_site_info || emp.approved_info).pm_name)}</b>`
              : ""}
          </div>` : ""}

        ${canEdit && window.AsgardPersonnelPage ? `
          <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px">
            <span style="color:var(--t2);font-size:13px;align-self:center">Статус готовности:</span>
            <button class="btn emp-st-btn" data-st="ready"
              style="background:var(--gold-bg);color:var(--gold)">✓ Готов</button>
            <button class="btn ghost emp-st-btn" data-st="not_ready"
              style="border-color:var(--warn);color:var(--warn-t)">✗ Не готов</button>
            <button class="btn ghost emp-st-btn" data-st="archive"
              style="border-color:var(--brd);color:var(--t3)">Архив</button>
            ${emp.readiness_date ? `<span style="font-size:12px;color:var(--t3);align-self:center">с ${new Date(emp.readiness_date).toLocaleDateString('ru-RU')}</span>` : ""}
          </div>` : ""}

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
              <select id="role" ${canEdit?"":"disabled"} title="Слесарь — базовая ставка (склад 10б). Мастер — повышенная (склад 12б). РП — руководитель, не попадает в табель как рабочий.">
                ${(() => {
                  const cur = (emp.role_tag||"").toLowerCase();
                  const opts = [
                    { v: "слесарь", l: "🔧 Слесарь" },
                    { v: "мастер",  l: "👷 Мастер" },
                    { v: "РП",      l: "👑 РП (руководитель)" },
                  ];
                  // Если текущее значение не в списке — добавим как "Другое"
                  if (cur && !opts.find(o => o.v.toLowerCase() === cur)) {
                    opts.push({ v: emp.role_tag, l: `⚠ ${esc(emp.role_tag)} (нестандарт)` });
                  }
                  return opts.map(o => `<option value="${esc(o.v)}" ${cur===o.v.toLowerCase()?"selected":""}>${o.l}</option>`).join("");
                })()}
              </select>
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

        <!-- 💼 Самозанятый -->
        <details style="margin-top:16px" open>
          <summary class="kpi" style="cursor:pointer"><span style="display:inline-block;width:3px;height:14px;border-radius:2px;background:var(--ok-t);margin-right:8px;vertical-align:middle"></span> 💼 Самозанятый</summary>
          <div class="formrow" style="margin-top:12px">
            <div style="grid-column:1/-1">
              <label title="При включении блок «Официально устроен» будет недоступен (взаимоисключение)">
                <input id="is_self_employed" type="checkbox" ${emp.is_self_employed?"checked":""} ${canEdit?"":"disabled"} ${emp.is_officially_employed?"disabled":""}/>
                Является самозанятым (плательщик НПД)
              </label>
              ${emp.is_officially_employed && canEdit ? '<div class="help" style="margin-top:4px">Снимите «Официально устроен», чтобы включить.</div>' : ''}
            </div>
            <div>
              <label title="12 цифр. Используется для проверки лимита самозанятого (2.4M/год).">ИНН</label>
              <input id="inn" value="${esc(emp.inn||"")}" placeholder="123456789012" inputmode="numeric" ${canEdit?"":"disabled"}/>
            </div>

            <!-- Получатель НПД-выплат (V240) -->
            <div style="grid-column:1/-1;border-top:1px dashed var(--brd);padding-top:12px;margin-top:4px">
              <div class="help" style="margin-bottom:8px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:0.08em;font-size:11px">— Получатель НПД-выплат —</div>
              <label title="Выплаты СЗ идут не на самого рабочего, а на родственника-получателя (жена/брат/отец как СЗ). У получателя свои НПД-лимиты.">
                <input id="use_payee" type="checkbox" ${emp.se_payee_id?"checked":""} ${canEdit?"":"disabled"}/>
                Выплаты идут не на меня (на родственника-СЗ)
              </label>
              <div id="payee_block" style="display:${emp.se_payee_id?'block':'none'};margin-top:10px">
                <!-- Текущий привязанный payee (если есть) -->
                <div id="payee_current" style="display:${emp.se_payee_id?'flex':'none'};align-items:center;gap:10px;padding:10px 12px;background:#E8F5E9;border-radius:8px;margin-bottom:10px;flex-wrap:wrap">
                  <span style="font-size:18px">👤</span>
                  <div style="flex:1;min-width:200px">
                    <div style="font-weight:600;color:var(--t1)" id="payee_current_name">${esc(emp.se_payee_fio||('id='+(emp.se_payee_id||'')))}</div>
                    <div class="help" id="payee_current_meta">${emp.se_payee_id?('id='+esc(String(emp.se_payee_id))+(emp.se_payee_phone?' · '+esc(emp.se_payee_phone):'')):''}</div>
                  </div>
                  <div class="row" style="gap:6px;flex-wrap:wrap">
                    ${canEdit ? '<button type="button" class="btn ghost mini" id="payee_unlink">Открепить</button>' : ''}
                    <button type="button" class="btn ghost mini" id="payee_open">Открыть карточку</button>
                  </div>
                </div>
                <!-- Поиск + dropdown -->
                <div id="payee_search_wrap" style="position:relative">
                  <input id="payee_search" type="text" placeholder="Поиск по ФИО или телефону..." autocomplete="off" ${canEdit?'':'disabled'} style="width:100%"/>
                  <div id="payee_results" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg1);border:1px solid var(--brd);border-radius:8px;margin-top:4px;max-height:280px;overflow-y:auto;z-index:10;box-shadow:0 4px 16px rgba(0,0,0,0.2)"></div>
                </div>
                ${canEditFinance ? `<div style="margin-top:8px"><button type="button" class="btn ghost mini" id="payee_create">+ Создать нового получателя</button></div>` : ``}
                <input type="hidden" id="payee_id_hidden" value="${esc(String(emp.se_payee_id||''))}"/>
              </div>
            </div>

            <div>
              <label title="Если выключено — переводы свыше 350 000 ₽/мес автоматически блокируются. Годовой лимит 2,4 млн ₽ это не отменяет.">
                <input id="can_exceed_limit" type="checkbox" ${emp.can_exceed_limit?"checked":""} ${canEditFinance?"":"disabled"}/>
                Разрешить превышение месячного лимита (350k)
              </label>
            </div>
            <div style="grid-column:1/-1">
              <div class="help" style="margin-bottom:6px">Стартовый offset лимита (для переноса со старой системы):</div>
              ${canEditFinance ? `
                <div class="formrow">
                  <div>
                    <label title="Сумма, которая ушла самозанятому ВНЕ CRM с начала года. Пример: в апреле перевели 400 000 — ставь 400 000.">За год уже потрачено ₽</label>
                    <input id="se_yearly_used_initial" type="number" min="0" value="${esc(emp.se_yearly_used_initial!=null?emp.se_yearly_used_initial:0)}"/>
                  </div>
                  <div style="grid-column:1/-1">
                    <label title="Заполняй только если в этом конкретном месяце уже были переводы вне CRM.">За текущий месяц (опц.)</label>
                    <div class="row" style="gap:6px;flex-wrap:wrap">
                      <input id="se_monthly_used_initial_year"   type="number" min="2020" max="2099" placeholder="год"   value="${esc(emp.se_monthly_used_initial?.year||'')}"  style="max-width:90px"/>
                      <input id="se_monthly_used_initial_month"  type="number" min="1"    max="12"   placeholder="мес"   value="${esc(emp.se_monthly_used_initial?.month||'')}" style="max-width:70px"/>
                      <input id="se_monthly_used_initial_amount" type="number" min="0"               placeholder="сумма ₽" value="${esc(emp.se_monthly_used_initial?.amount||'')}" style="flex:1;min-width:160px"/>
                    </div>
                  </div>
                </div>
                <div class="help" style="margin-top:8px">
                  Подсказка: «Стартовый offset» — это то, что СЗ уже потратил у нас до момента перевода в систему.
                  Например, если в апреле ему уже перевели 400 000, поставь 400 000 в годовой offset.
                  Месячный offset нужен только если в этом конкретном месяце уже были переводы вне CRM.
                </div>
              ` : `
                <div class="help" style="font-size:12px;padding:8px;border:1px dashed var(--brd);border-radius:6px;color:var(--t2)">
                  <div><b>Месячный лимит:</b> ${emp.can_exceed_limit?'снят (разрешено превышение)':'действует (350 000 ₽)'}</div>
                  <div><b>За год уже потрачено:</b> ${esc(String(Number(emp.se_yearly_used_initial||0).toLocaleString('ru-RU')))} ₽</div>
                  ${emp.se_monthly_used_initial?.year?`<div><b>Месячный offset:</b> ${esc(emp.se_monthly_used_initial.year)}-${String(emp.se_monthly_used_initial.month||0).padStart(2,'0')} → ${esc(Number(emp.se_monthly_used_initial.amount||0).toLocaleString('ru-RU'))} ₽</div>`:''}
                  <div style="margin-top:4px;opacity:0.7">Изменить может только бухгалтер/директор/админ.</div>
                </div>
              `}
            </div>
          </div>
        </details>

        <!-- 🏢 Официально устроен -->
        <details style="margin-top:16px" open>
          <summary class="kpi" style="cursor:pointer"><span style="display:inline-block;width:3px;height:14px;border-radius:2px;background:var(--info);margin-right:8px;vertical-align:middle"></span> 🏢 Официально устроен</summary>
          <div class="formrow" style="margin-top:12px">
            <div style="grid-column:1/-1">
              <label title="При включении блок «Самозанятый» будет недоступен (взаимоисключение)">
                <input id="is_officially_employed" type="checkbox" ${emp.is_officially_employed?"checked":""} ${canEdit?"":"disabled"} ${emp.is_self_employed?"disabled":""}/>
                Является официально устроенным (по ТД)
              </label>
              ${emp.is_self_employed && canEdit ? '<div class="help" style="margin-top:4px">Снимите «Самозанятый», чтобы включить.</div>' : ''}
            </div>
            ${canEditFinance ? `
              <div>
                <label title="Месячный оклад по трудовому договору">Оклад ₽</label>
                <input id="official_salary" type="number" min="0" value="${esc(emp.official_salary!=null?emp.official_salary:'')}" placeholder="0"/>
              </div>
              <div>
                <label title="Минимум который компания платит даже если рабочий не отработал. Например: оклад 60k, несгораемая 30k. Если рабочий заработал 0 — компания всё равно платит 30k.">Несгораемая часть ₽</label>
                <input id="official_non_burnable" type="number" min="0" value="${esc(emp.official_non_burnable!=null?emp.official_non_burnable:'')}" placeholder="0"/>
                <div class="help" style="margin-top:4px;color:var(--t3);font-size:11px;line-height:1.4">
                  Минимум который компания платит даже если рабочий не отработал.<br>
                  Пример: оклад 60 000 ₽, несгораемая 30 000 ₽. Если рабочий заработал 0 — компания всё равно платит 30 000 ₽.
                </div>
              </div>
              <div>
                <label title="Дата приёма по трудовому договору">Дата приёма</label>
                <input id="official_hire_date" type="date" value="${esc(normalizeDateInput(emp.official_hire_date))}"/>
              </div>
              <div>
                <label>Статус занятости</label>
                <select id="official_status">
                  <option value="active"        ${(emp.official_status||'active')==='active'?'selected':''}>Активен</option>
                  <option value="unpaid_leave"  ${emp.official_status==='unpaid_leave'?'selected':''}>Отпуск без сохранения</option>
                  <option value="maternity"     ${emp.official_status==='maternity'?'selected':''}>Декрет</option>
                  <option value="sick_leave"    ${emp.official_status==='sick_leave'?'selected':''}>Больничный</option>
                  <option value="fired"         ${emp.official_status==='fired'?'selected':''}>Уволен</option>
                </select>
              </div>
              <div id="official_leave_block" style="grid-column:1/-1; ${emp.official_status==='unpaid_leave'?'':'display:none'}">
                <div class="formrow">
                  <div>
                    <label title="Только если статус = Отпуск без сохранения">Отпуск с</label>
                    <input id="official_leave_from" type="date" value="${esc(normalizeDateInput(emp.official_leave_from))}"/>
                  </div>
                  <div>
                    <label>по</label>
                    <input id="official_leave_to" type="date" value="${esc(normalizeDateInput(emp.official_leave_to))}"/>
                  </div>
                </div>
              </div>
            ` : `
              <div style="grid-column:1/-1">
                <div class="help" style="font-size:12px;padding:8px;border:1px dashed var(--brd);border-radius:6px;color:var(--t2)">
                  <div><b>Оклад:</b> ${emp.official_salary!=null?esc(Number(emp.official_salary).toLocaleString('ru-RU'))+' ₽':'—'}</div>
                  <div><b>Несгораемая часть:</b> ${emp.official_non_burnable!=null?esc(Number(emp.official_non_burnable).toLocaleString('ru-RU'))+' ₽':'—'}</div>
                  <div><b>Дата приёма:</b> ${emp.official_hire_date?esc(normalizeDateInput(emp.official_hire_date)):'—'}</div>
                  <div><b>Статус:</b> ${esc(({active:'Активен',unpaid_leave:'Отпуск без сохранения',maternity:'Декрет',sick_leave:'Больничный',fired:'Уволен'})[emp.official_status||'active'])}</div>
                  ${emp.official_status==='unpaid_leave' && (emp.official_leave_from||emp.official_leave_to) ? `<div><b>Отпуск:</b> ${esc(normalizeDateInput(emp.official_leave_from)||'—')} — ${esc(normalizeDateInput(emp.official_leave_to)||'—')}</div>` : ''}
                  <div style="margin-top:4px;opacity:0.7">Изменить может только бухгалтер/директор/админ.</div>
                </div>
              </div>
            `}
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
        headerH += '<div style="width:'+monthW+'px;flex-shrink:0;text-align:center;font-size:10px;color:var(--t3);padding:4px 0;border-right:1px solid var(--brd)">'+m2.label+'</div>';
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
          months.map(function(m2,i2){ return '<div style="position:absolute;left:'+(i2*monthW)+'px;top:0;bottom:0;width:1px;background:var(--brd)"></div>'; }).join('') +
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

    // ── Кнопки статуса готовности (✓ Готов / ✗ Не готов / Архив) ─────────
    // Делегируем в AsgardPersonnelPage.openStatusModal — модалку которая
    // и так умеет менять статус через PUT /staff/readiness/:id/status,
    // показывать форму даты/причины и логировать в historу.
    document.querySelectorAll(".emp-st-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!window.AsgardPersonnelPage || !window.AsgardPersonnelPage.openStatusModal) {
          toast("Статус", "Модуль персонала не загружен", "err");
          return;
        }
        const currentStatus = emp.effective_status || emp.readiness_status || "";
        window.AsgardPersonnelPage.openStatusModal(id, emp.fio, currentStatus, () => {
          // На успешную смену — перерисовываем карточку.
          render();
        });
      });
    });

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

        // 💼 Самозанятый / 🏢 Официально устроен — взаимоисключение + права на финансы
        const flagSE  = !!$("#is_self_employed")?.checked;
        const flagOFC = !!$("#is_officially_employed")?.checked;
        if (flagSE && flagOFC) {
          toast("Ошибка", "Нельзя одновременно «Самозанятый» и «Официально устроен»", "err");
          return;
        }
        emp.is_self_employed      = flagSE;
        emp.is_officially_employed = flagOFC;

        // Получатель НПД-выплат (V240). Если выбран payee — выплаты идут на него,
        // сам рабочий формально не СЗ (его ИНН-лимит не тратится).
        const usePayee = !!$("#use_payee")?.checked;
        const payeeIdRaw = $("#payee_id_hidden")?.value || "";
        const payeeId = usePayee && payeeIdRaw ? Number(payeeIdRaw) : null;
        emp.se_payee_id = payeeId;
        if (payeeId) emp.is_self_employed = false;

        // Финансовые поля — пишутся только если у юзера есть права
        if (canEditFinance) {
          emp.can_exceed_limit       = !!$("#can_exceed_limit")?.checked;
          const yiRaw = $("#se_yearly_used_initial")?.value;
          emp.se_yearly_used_initial = yiRaw !== "" && yiRaw != null ? Math.max(0, Number(yiRaw) || 0) : 0;
          const monY = Number($("#se_monthly_used_initial_year")?.value);
          const monM = Number($("#se_monthly_used_initial_month")?.value);
          const monA = Number($("#se_monthly_used_initial_amount")?.value);
          emp.se_monthly_used_initial = (monY && monM && monA && monM >= 1 && monM <= 12 && monA >= 0)
            ? { year: monY, month: monM, amount: monA }
            : null;
          const salRaw = $("#official_salary")?.value;
          const nbrRaw = $("#official_non_burnable")?.value;
          emp.official_salary       = salRaw !== "" && salRaw != null ? Number(salRaw) || null : null;
          emp.official_non_burnable = nbrRaw !== "" && nbrRaw != null ? Number(nbrRaw) || null : null;
          emp.official_hire_date    = $("#official_hire_date")?.value || null;
          emp.official_status       = $("#official_status")?.value || "active";
          emp.official_leave_from   = emp.official_status === "unpaid_leave" ? ($("#official_leave_from")?.value || null) : null;
          emp.official_leave_to     = emp.official_status === "unpaid_leave" ? ($("#official_leave_to")?.value   || null) : null;
        }

        emp.updated_at = isoNow();
        await AsgardDB.put("employees", emp);
        toast("Сохранено","Данные обновлены");
      };
    }

    // Взаимоисключение СЗ/Официально (live, без перерисовки страницы)
    const cbSE  = document.getElementById("is_self_employed");
    const cbOFC = document.getElementById("is_officially_employed");
    if (cbSE && cbOFC) {
      cbSE.addEventListener("change", () => {
        if (cbSE.checked) cbOFC.checked = false;
        cbOFC.disabled = cbSE.checked || !canEdit;
      });
      cbOFC.addEventListener("change", () => {
        if (cbOFC.checked) cbSE.checked = false;
        cbSE.disabled = cbOFC.checked || !canEdit;
      });
    }

    // Показ/скрытие блока «Отпуск с … по …» в зависимости от статуса занятости
    const selStatus = document.getElementById("official_status");
    const leaveBlock = document.getElementById("official_leave_block");
    if (selStatus && leaveBlock) {
      selStatus.addEventListener("change", () => {
        leaveBlock.style.display = (selStatus.value === "unpaid_leave") ? "" : "none";
      });
    }

    // ─── Получатель НПД-выплат (V240) ──────────────────────────────────────
    (function bindPayeeSection(){
      const cbUse     = document.getElementById("use_payee");
      const blockWrap = document.getElementById("payee_block");
      const inpSearch = document.getElementById("payee_search");
      const boxRes    = document.getElementById("payee_results");
      const boxCur    = document.getElementById("payee_current");
      const elName    = document.getElementById("payee_current_name");
      const elMeta    = document.getElementById("payee_current_meta");
      const hidden    = document.getElementById("payee_id_hidden");
      const btnUnlink = document.getElementById("payee_unlink");
      const btnOpen   = document.getElementById("payee_open");
      const btnCreate = document.getElementById("payee_create");
      if (!cbUse || !blockWrap || !inpSearch || !hidden) return;

      function setPayee(p) {
        if (!p) {
          hidden.value = "";
          if (boxCur) boxCur.style.display = "none";
          return;
        }
        hidden.value = String(p.id);
        if (elName) elName.textContent = p.fio || ("id=" + p.id);
        if (elMeta) {
          const bits = ["id=" + p.id];
          if (p.phone) bits.push(p.phone);
          if (p.inn) bits.push("ИНН " + p.inn);
          elMeta.textContent = bits.join(" · ");
        }
        if (boxCur) boxCur.style.display = "flex";
      }

      cbUse?.addEventListener("change", () => {
        if (cbUse.checked) {
          blockWrap.style.display = "block";
          inpSearch.focus();
        } else {
          blockWrap.style.display = "none";
          setPayee(null);
          // По требованиям: при выключении se_payee_id = null; is_self_employed
          // остаётся как было (трогаем только при включении).
          if (boxRes) { boxRes.style.display = "none"; boxRes.innerHTML = ""; }
          inpSearch.value = "";
        }
      });

      // debounced 300мс search
      let timer = null, lastQ = "";
      inpSearch?.addEventListener("input", () => {
        if (!canEdit) return;
        clearTimeout(timer);
        const q = inpSearch.value.trim();
        if (q.length < 2) {
          if (boxRes) { boxRes.style.display = "none"; boxRes.innerHTML = ""; }
          return;
        }
        if (q === lastQ) return;
        timer = setTimeout(async () => {
          lastQ = q;
          try {
            const res = await apiFetch("/staff/payees?search=" + encodeURIComponent(q) + "&limit=20");
            const items = (res && (res.payees || res.items || res.rows)) || [];
            if (!items.length) {
              boxRes.innerHTML = '<div style="padding:10px 12px;color:var(--t3);font-size:13px">Никого не нашли. Попробуйте создать нового.</div>';
              boxRes.style.display = "block";
              return;
            }
            boxRes.innerHTML = items.map(p => {
              const fio = esc(p.fio || "—");
              const phone = p.phone ? ' · ' + esc(p.phone) : '';
              const inn = p.inn ? ' · ИНН ' + esc(p.inn) : '';
              const linkedCnt = (p.linked_count != null) ? ` <span class="help">(привязано: ${esc(String(p.linked_count))})</span>` : '';
              return `<div class="payee-row" data-pid="${esc(String(p.id))}" data-fio="${esc(p.fio||'')}" data-phone="${esc(p.phone||'')}" data-inn="${esc(p.inn||'')}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--brd-2);font-size:13px">
                <b>${fio}</b>${linkedCnt}
                <div class="help">id=${esc(String(p.id))}${phone}${inn}</div>
              </div>`;
            }).join("");
            // hover effect через inline
            boxRes.querySelectorAll(".payee-row").forEach(row => {
              row.addEventListener("mouseenter", () => row.style.background = "var(--bg2)");
              row.addEventListener("mouseleave", () => row.style.background = "");
              row.addEventListener("click", () => {
                setPayee({
                  id: Number(row.dataset.pid),
                  fio: row.dataset.fio,
                  phone: row.dataset.phone,
                  inn: row.dataset.inn,
                });
                inpSearch.value = "";
                boxRes.style.display = "none";
                boxRes.innerHTML = "";
              });
            });
            boxRes.style.display = "block";
          } catch (e) {
            console.error("[payees] search failed:", e);
            boxRes.innerHTML = '<div style="padding:10px 12px;color:var(--err-t);font-size:13px">Ошибка поиска получателей</div>';
            boxRes.style.display = "block";
          }
        }, 300);
      });

      // Скрыть выпадайку при клике вне
      document.addEventListener("click", (ev) => {
        if (!boxRes) return;
        if (boxRes.style.display === "none") return;
        const wrap = document.getElementById("payee_search_wrap");
        if (wrap && !wrap.contains(ev.target)) {
          boxRes.style.display = "none";
        }
      });

      // Открепить
      btnUnlink?.addEventListener("click", () => {
        setPayee(null);
        if (cbUse) cbUse.checked = false;
        blockWrap.style.display = "none";
      });

      // Открыть карточку получателя
      btnOpen?.addEventListener("click", () => {
        const pid = Number(hidden.value || 0);
        if (!pid) { toast("Получатель", "Сначала выберите получателя", "err"); return; }
        location.hash = "#/employee?id=" + pid;
      });

      // Создать нового получателя (только FIN_ROLES)
      btnCreate?.addEventListener("click", () => {
        const html = `
          <div class="formrow">
            <div style="grid-column:1/-1">
              <label>ФИО получателя <span style="color:var(--err-t)">*</span></label>
              <input id="np_fio" placeholder="Иванов Иван Иванович"/>
            </div>
            <div>
              <label>Телефон</label>
              <input id="np_phone" placeholder="+7..."/>
            </div>
            <div>
              <label>ИНН (опц.)</label>
              <input id="np_inn" placeholder="123456789012" inputmode="numeric"/>
            </div>
            <div style="grid-column:1/-1" class="help">
              Будет создан employee с is_se_payee=true (получатель НПД, не работающий сам).
            </div>
          </div>
          <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px">
            <button class="btn" id="np_save">Создать</button>
          </div>`;
        showModal({ title: "+ Новый получатель НПД", html, icon: "💸", subtitle: "Родственник-СЗ для выплат" });
        const btn = document.getElementById("np_save");
        if (btn) {
          btn.onclick = async () => {
            const fio = document.getElementById("np_fio")?.value?.trim() || "";
            const phone = document.getElementById("np_phone")?.value?.trim() || "";
            const inn = document.getElementById("np_inn")?.value?.trim() || "";
            if (!fio) { toast("Проверка", "ФИО обязательно", "err"); return; }
            try {
              btn.disabled = true; btn.textContent = "Создаём…";
              const r = await apiFetch("/staff/payees", {
                method: "POST",
                body: JSON.stringify({ fio, phone, inn }),
              });
              const created = (r && (r.payee || r.employee || r)) || null;
              if (!created || !created.id) {
                toast("Ошибка", (r && r.error) || "Сервер не вернул id", "err");
                btn.disabled = false; btn.textContent = "Создать";
                return;
              }
              setPayee({ id: created.id, fio: created.fio || fio, phone: created.phone || phone, inn: created.inn || inn });
              toast("Готово", "Получатель создан");
              // закрыть модалку (AsgardUI.showModal обычно вешает overlay с data-close)
              const overlay = document.querySelector(".modal-overlay,.modal-bd,[data-modal]");
              if (overlay) overlay.remove();
              else document.querySelectorAll(".modal").forEach(m => m.remove());
            } catch (e) {
              console.error("[payees] create failed:", e);
              toast("Ошибка", "Не удалось создать получателя", "err");
              btn.disabled = false; btn.textContent = "Создать";
            }
          };
        }
      });
    })();

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
        showModal({ title: "Оценка сотрудника", html: body, icon: '👤', subtitle: 'Карточка сотрудника' });
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