window.AsgardEmployeePage=(function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;
  const isDirRole = (r)=> (window.AsgardAuth&&AsgardAuth.isDirectorRole)?AsgardAuth.isDirectorRole(r):(String(r||"" )==="DIRECTOR"||String(r||"" ).startsWith("DIRECTOR_"));

  function isoNow(){ return new Date().toISOString(); }

  /** Смена паспорта РФ в 20 и 45 лет (+90 дней). */
  function passportAgeBannerHtml(emp) {
    function parseYmd(v) {
      if (!v) return null;
      const s = String(v).slice(0, 10);
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) return null;
      return new Date(+m[1], +m[2] - 1, +m[3]);
    }
    function addYears(d, y) {
      const x = new Date(d.getFullYear() + y, d.getMonth(), d.getDate());
      if (x.getMonth() !== d.getMonth()) return new Date(d.getFullYear() + y, d.getMonth() + 1, 0);
      return x;
    }
    function addDays(d, n) { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
    function fmt(d) {
      return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();
    }
    const birth = parseYmd(emp.birth_date);
    const issued = parseYmd(emp.passport_date);
    if (!birth || !issued) {
      const msg = !birth ? 'Укажите дату рождения' : 'Укажите дату выдачи паспорта';
      return `<div class="emp-pass-banner prs-pass--unknown" style="margin:0 0 12px;padding:10px 12px;border:1px dashed var(--brd-2);border-radius:8px;font-size:13px;color:var(--t-3)">${esc(msg)} — рассчитаем смену паспорта в 20 и 45 лет.</div>`;
    }
    const today = new Date(); today.setHours(0,0,0,0);
    const d20 = addYears(birth, 20), d45 = addYears(birth, 45);
    const deadlines = [];
    if (issued < d20) deadlines.push({ at: addDays(d20, 90), m: 20 });
    if (issued < d45) deadlines.push({ at: addDays(d45, 90), m: 45 });
    if (!deadlines.length) {
      return `<div class="emp-pass-banner" style="margin:0 0 12px;padding:10px 12px;border-radius:8px;background:var(--ok-bg);color:var(--ok);font-size:13px">Паспорт: по возрасту ок (выдан после 45).</div>`;
    }
    const upcoming = deadlines.filter(x => x.at >= today).sort((a,b)=>a.at-b.at);
    const t = upcoming[0] || deadlines.sort((a,b)=>b.at-a.at)[0];
    const days = Math.round((t.at - today) / 86400000);
    let bg = 'var(--ok-bg)', fg = 'var(--ok)', label = `Паспорт до ${fmt(t.at)}`;
    if (days < 0) { bg = 'var(--danger-bg)'; fg = 'var(--danger)'; label = `Паспорт просрочен (смена в ${t.m})`; }
    else if (days <= 90) { bg = 'var(--orange-bg)'; fg = 'var(--amber)'; label = `Паспорт: замена до ${fmt(t.at)}`; }
    else if (days <= 180) { bg = 'var(--gold-bg)'; fg = 'var(--gold)'; label = `Паспорт: замена ~ ${fmt(t.at)}`; }
    return `<div class="emp-pass-banner" style="margin:0 0 12px;padding:10px 12px;border-radius:8px;background:${bg};color:${fg};font-size:13px"><strong>${esc(label)}</strong><div style="opacity:.9;margin-top:4px">В РФ паспорт меняют в 20 и 45 лет (+90 дней после дня рождения). Осталось: ${days} дн.</div></div>`;
  }

  function getToken() {
    return localStorage.getItem('asgard_token') || localStorage.getItem('auth_token') || '';
  }

  /** Локальный fetch к /api — apiFetch из personnel.js/db.js сюда не попадает (IIFE). */
  async function apiFetch(path, options) {
    options = options || {};
    const headers = Object.assign({ Authorization: 'Bearer ' + getToken() }, options.headers || {});
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const url = path.indexOf('/api') === 0 ? path : ('/api' + path);
    const r = await fetch(url, Object.assign({}, options, { headers }));
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  function ymd(v) {
    if (!v) return '';
    const s = String(v);
    return s.length >= 10 ? s.slice(0, 10) : s;
  }

  function assignEnd(a) {
    return ymd(a && a.date_to) || ymd(a && a.departure_date);
  }

  function isCurrentAssign(a, todayStr) {
    const end = assignEnd(a);
    if (end && end < todayStr) return false;
    if (a && (a.is_active === false || a.is_active === 'f' || a.is_active === 0)) {
      return !!(end && end >= todayStr);
    }
    return !end || end >= todayStr;
  }

  function fmtAssignDay(v) {
    const s = ymd(v);
    if (!s) return '—';
    return new Date(s + 'T00:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  async function employeeApiPut(path, body) {
    const r = await fetch('/api' + path, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + getToken(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  const EMP_API_FIELDS = [
    'fio', 'phone', 'email', 'birth_date', 'gender', 'role_tag', 'position', 'grade', 'city', 'address',
    'hire_date', 'contract_type', 'pass_series', 'pass_number', 'passport_series', 'passport_number',
    'passport_issued', 'passport_date', 'passport_code', 'registration_address', 'inn', 'snils',
    'notes', 'comment', 'is_self_employed', 'is_officially_employed', 'se_payee_id',
    'spouse_name', 'spouse_phone', 'relative_name', 'relative_relation', 'relative_phone',
    'phone2', 'telegram', 'education', 'specialty', 'marital_status', 'children_count',
    'clothing_size', 'shoe_size', 'headwear_size', 'height', 'blood_type', 'medical_notes',
    'military_id', 'driver_license',
    'docs_url', 'permits',
  ];

  function buildEmployeeApiPayload(emp, canEditFinance) {
    const payload = {};
    for (const k of EMP_API_FIELDS) {
      if (emp[k] !== undefined) payload[k] = emp[k] === '' ? null : emp[k];
    }
    if (canEditFinance) {
      ['can_exceed_limit', 'se_yearly_used_initial', 'se_monthly_used_initial',
        'official_salary', 'official_non_burnable', 'official_hire_date',
        'official_status', 'official_leave_from', 'official_leave_to'].forEach((k) => {
        if (emp[k] !== undefined) payload[k] = emp[k];
      });
    }
    return payload;
  }

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
    let list = [];
    try {
      const detail = await apiFetch('/staff/employees/' + employee_id);
      list = (detail && detail.reviews) || [];
    } catch(_) {
      list = [];
    }
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

  async function render(opts){
    if (opts && typeof opts.layout === 'function') {
      render._layout = opts.layout;
      if ('title' in opts) render._title = opts.title;
    }
    const layout = render._layout;
    const title = render._title;
    if (typeof layout !== 'function') {
      console.warn('[employee] render skipped: no layout');
      return;
    }
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user=auth.user;
    if(!(user.role==="ADMIN" || user.role==="HR" || user.role==="PM" || user.role==="TO" || user.role==="OFFICE_MANAGER" || user.role==="HR_MANAGER" || user.role==="HEAD_PM" || user.role==="HEAD_TO" || isDirRole(user.role))){
      toast("Доступ","Недостаточно прав","err"); location.hash="#/home"; return;
    }

    // FIX (23.06.2026): HEAD_PM и OFFICE_MANAGER редактируют контактные/паспортные/основные поля.
    // Финансовые остаются под BUH/директорами. Статус увольнения/официальное трудоустройство — HR.
    const canEdit = (user.role==="ADMIN" || user.role==="HR" || user.role==="HR_MANAGER" || user.role==="TO" || user.role==="HEAD_TO" || user.role==="HEAD_PM" || user.role==="OFFICE_MANAGER" || user.role==="PM" || isDirRole(user.role));
    // Финансовые поля (Оклад/несгораемая/can_exceed_limit/offset) — правит только бухгалтер/директор/админ.
    // HR/TO/HEAD_PM/OFFICE_MANAGER — видят значения текстом, без input.
    const canEditFinance = ["ADMIN","DIRECTOR_GEN","DIRECTOR_COMM","DIRECTOR_DEV","BUH"].includes(user.role);
    // HR-only поля (увольнение/официальное трудоустройство/СЗ) — HEAD_PM/OFFICE_MANAGER редактировать НЕ должны.
    const canEditHrSensitive = (user.role==="ADMIN" || user.role==="HR" || user.role==="HR_MANAGER" || isDirRole(user.role));

    const query = parseQuery();
    const id = Number(query.id||0);
    let emp = await AsgardDB.get("employees", id);
    if (!emp) {
      try {
        const detail = await apiFetch('/staff/employees/' + id);
        emp = (detail && detail.employee) || detail;
        if (emp && emp.id) await AsgardDB.put("employees", emp);
      } catch (_) { /* offline / только сервер */ }
    }
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
        emp.planned_info         = empServer.planned_info         || null;
        emp.mlsp_stay            = empServer.mlsp_stay            || null;
      }
    } catch(_) { /* offline / API недоступен — рендерим без блока */ }

    // planned_info также приходит из детальной карточки
    try {
      const detailEarly = await apiFetch('/staff/employees/' + id);
      if (detailEarly && detailEarly.planned_info) {
        emp.planned_info = detailEarly.planned_info;
      }
      if (detailEarly && detailEarly.on_site_info && !emp.on_site_info) {
        emp.on_site_info = detailEarly.on_site_info;
      }
    } catch (_) { /* ignore */ }

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

    let assigns = [], revs = [];
    try {
      const detail = await apiFetch('/staff/employees/' + id);
      assigns = (detail && detail.assignments) || [];
      revs = (detail && detail.reviews) || [];
    } catch(e) {
      console.warn('[employee] assignments load failed:', e && e.message);
      assigns = [];
      revs = [];
    }
    assigns.sort((a,b)=> String(b.date_from||"").localeCompare(String(a.date_from||"")));
    revs.sort((a,b)=> String(b.created_at||"").localeCompare(String(a.created_at||"")));
    const todayStr = new Date().toISOString().slice(0,10);

    // Separate current and past assignments
    const currentAssigns = assigns.filter(a => isCurrentAssign(a, todayStr));
    const pastAssigns = assigns.filter(a => !isCurrentAssign(a, todayStr));

    function assignRow(a, isCurrent) {
      const customer = a.customer_name || a.tender_customer_name || '';
      const city = a.city || a.object_address || a.tender_city || '';
      const wStatus = a.work_status || '';
      const statusBadge = isCurrent
        ? '<span style="background:rgba(34,197,94,.2);color:var(--ok-t);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap">Сейчас</span>'
        : (wStatus ? `<span style="background:rgba(100,116,139,.2);color:var(--t2);padding:2px 8px;border-radius:6px;font-size:11px;white-space:nowrap">${esc(wStatus)}</span>` : '');
      return `<tr class="emp-assign-row${isCurrent?' is-cur':''}" data-work-id="${a.work_id||''}">
        <td style="white-space:nowrap">${fmtAssignDay(a.date_from)}</td>
        <td style="white-space:nowrap">${fmtAssignDay(assignEnd(a))}</td>
        <td><b>${esc(a.work_title||"—")}</b></td>
        <td>${esc(customer)}</td>
        <td>${esc(city)}</td>
        <td>${esc(a.role||a.role_on_work||({worker:'Рабочий',senior_master:'Ст. мастер',project_lead:'Рук. проекта'}[a.field_role]||a.field_role||""))}</td>
        <td>${esc(a.pm_name||'—')}</td>
        <td>${statusBadge}</td>
      </tr>`;
    }

    const assignHtml = (currentAssigns.length + pastAssigns.length) > 0
      ? currentAssigns.map(a=>assignRow(a, true)).join("") + pastAssigns.map(a=>assignRow(a, false)).join("")
      : `<tr><td colspan="8" class="muted">Истории назначений нет</td></tr>`;

    const revHtml = revs.map(r=>{
      const who = r.reviewer_name || (r.pm_id ? `РП #${r.pm_id}` : "РП");
      return `<div class="pill" style="align-items:flex-start; gap:10px">
        <div style="margin-top:3px"><span class="dot" style="background:var(--err-t)"></span></div>
        <div style="flex:1">
          <div class="who"><b>${esc(who)}</b> <span class="help">${esc(new Date(r.created_at).toLocaleString("ru-RU"))}</span></div>
          <div class="row" style="gap:8px; margin-top:6px; flex-wrap:wrap">
            <span class="badge"><span class="dot" style="background:var(--ok-t)"></span>${esc(String(r.score_1_10 ?? '—'))}/10</span>
            <span class="badge"><span class="dot" style="background:var(--info)"></span>${r.work_title?esc(r.work_title):"—"}</span>
          </div>
          <div class="help" style="margin-top:6px">${esc(r.comment||"")}</div>
        </div>
      </div>`;
    }).join("") || `<div class="help">Пока нет оценок.</div>`;

    const M = window.AsgardRuMasks || {};
    const phoneDisp = (M.formatRuPhoneDisplay && M.formatRuPhoneDisplay(emp.phone)) || emp.phone || '';
    const phone2Disp = (M.formatRuPhoneDisplay && M.formatRuPhoneDisplay(emp.phone2)) || emp.phone2 || '';
    const spousePhoneDisp = (M.formatRuPhoneDisplay && M.formatRuPhoneDisplay(emp.spouse_phone)) || emp.spouse_phone || '';
    const relativePhoneDisp = (M.formatRuPhoneDisplay && M.formatRuPhoneDisplay(emp.relative_phone)) || emp.relative_phone || '';
    const snilsDisp = (M.formatSnilsDisplay && M.formatSnilsDisplay(emp.snils)) || emp.snils || '';
    const passportCodeDisp = (M.formatPassportCodeDisplay && M.formatPassportCodeDisplay(emp.passport_code)) || emp.passport_code || '';
    const passSeriesDigits = String(emp.pass_series || '').replace(/\D/g, '');
    const passNumberDigits = String(emp.pass_number || '').replace(/\D/g, '');
    const innDigits = String(emp.inn || '').replace(/\D/g, '');
    const WS_SECTIONS = ['overview','contacts','documents','ppe','work','permits','history','notes'];
    const _secRaw = String(query.section || 'overview').toLowerCase();
    const initialSection = WS_SECTIONS.includes(_secRaw) ? _secRaw : 'overview';
    const clothingChips = (window.AsgardPpeSizes && window.AsgardPpeSizes.clothing) || ['44','46','48','50','52','54','56','58','60','62','64'];
    const shoeChips = (window.AsgardPpeSizes && window.AsgardPpeSizes.shoe) || ['39','40','41','42','43','44','45','46','47','48'];
    const headwearList = (window.AsgardPpeSizes && window.AsgardPpeSizes.headwear) || ['54','56','58','60','62','стандарт'];
    const _ppeSelect = (kind, id, cur) => {
      const list = kind === 'clothing' ? clothingChips : kind === 'shoe' ? shoeChips : headwearList;
      const curS = String(cur || '').trim();
      let opts = `<option value="">—</option>`;
      if (curS && !list.includes(curS)) opts += `<option value="${esc(curS)}" selected>${esc(curS)} (старое)</option>`;
      for (const s of list) opts += `<option value="${esc(s)}"${curS === s ? ' selected' : ''}>${esc(s)}</option>`;
      return `<select id="${id}" class="emp-ws-ppe-select"${canEdit ? '' : ' disabled'}>${opts}</select>`;
    };
    const _chip = (sizes, cur) => sizes.map(s =>
      `<button type="button" class="emp-ws-chip${String(cur||'')===String(s)?' is-active':''}" data-size="${esc(s)}">${esc(s)}</button>`
    ).join('');

    const html = `
      <div class="panel emp-ws" id="empWorkspace">
        <div class="emp-ws-top">
          <button type="button" class="btn ghost emp-ws-back" id="btnBackPersonnel">← К дружине</button>
          <div class="emp-ws-completeness">
            <div class="emp-ws-completeness-bar">
              <div class="emp-ws-completeness-fill" id="empCompFill" style="width:0%"></div>
            </div>
            <span class="emp-ws-completeness-label" id="empCompLabel">Заполнено —</span>
            <button type="button" class="emp-ws-gap-link" id="empCompGaps" hidden></button>
          </div>
          <div class="emp-ws-save-status" id="empSaveStatus"></div>
        </div>

        <div class="emp-ws-head">
          <div>
            <div class="kpi"><span class="dot" style="background:var(--err-t)"></span>${esc(emp.fio||"")}</div>
            <div class="help">Роль: <b>${esc(emp.role_tag||"—")}</b> · Разряд: <b>${esc(emp.grade||"—")}</b> · Рейтинг: <b>${emp.rating_avg!=null?esc(Number(emp.rating_avg).toFixed(1)):"—"}</b></div>
          </div>
          <div class="row emp-ws-head-actions" style="gap:8px; flex-wrap:wrap">
            <button class="btn ghost" id="btnAiSummary" title="Мимир сгенерирует краткую характеристику">\uD83E\uDDD9 Характеристика</button>
            <button class="btn ghost" id="btnSchedule">График</button>
            <button class="btn ghost" id="btnProfile">\uD83D\uDCCB Анкета</button>
            ${canEdit ? `<button class="btn" id="btnSave">Сохранить</button>` : ``}
            ${(user.role==="PM" || user.role==="ADMIN" || isDirRole(user.role)) ? `<button class="btn red" id="btnReview">Оценить</button>` : ``}
          </div>
        </div>

        <div class="emp-ws-layout">
          <nav class="emp-ws-nav" id="empWsNav" aria-label="Разделы анкеты">
            ${[
              ['overview','Обзор'],
              ['contacts','Контакты'],
              ['documents','Документы'],
              ['ppe','СИЗ'],
              ['work','Работа'],
              ['permits','Допуски'],
              ['history','История'],
              ['notes','Заметки'],
            ].map(([sid,lab]) => `
              <button type="button" class="emp-ws-nav-item${initialSection===sid?' is-active':''}" data-section="${sid}">
                <span>${lab}</span>
                <span class="emp-ws-nav-dot" data-gap-for="${sid}" hidden></span>
              </button>`).join('')}
          </nav>

          <div class="emp-ws-main">
            <!-- ── overview ── -->
            <section class="emp-ws-panel${initialSection==='overview'?' is-active':''}" data-section="overview" id="empPanel_overview">
              <h3 class="emp-ws-panel-title"><span class="bar"></span> Обзор</h3>

              ${emp && (emp.on_site_info || emp.approved_info) ? `
                <div class="emp-ws-banner">
                  <span style="color:var(--t3)">🏗 ${emp.on_site_info ? "На объекте" : "Согласован"}:</span>
                  <b>${esc((emp.on_site_info || emp.approved_info).work_title || "—")}</b>
                  ${(emp.on_site_info || emp.approved_info).pm_name
                    ? ` &middot; <span style="color:var(--t3)">РП:</span> <b>${esc((emp.on_site_info || emp.approved_info).pm_name)}</b>`
                    : ""}
                </div>` : ""}
              ${emp && emp.mlsp_stay && emp.mlsp_stay.is_open ? `
                <div class="emp-ws-banner" style="margin-top:8px">
                  <span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:${
                    (emp.mlsp_stay.is_overdue || (emp.mlsp_stay.days_left != null && emp.mlsp_stay.days_left <= 7))
                      ? 'var(--err-bg)' : (emp.mlsp_stay.days_left != null && emp.mlsp_stay.days_left <= 14)
                        ? 'var(--warn-bg)' : 'var(--ok-bg)'
                  };color:${
                    (emp.mlsp_stay.is_overdue || (emp.mlsp_stay.days_left != null && emp.mlsp_stay.days_left <= 7))
                      ? 'var(--err)' : (emp.mlsp_stay.days_left != null && emp.mlsp_stay.days_left <= 14)
                        ? 'var(--warn-t)' : 'var(--ok)'
                  }">МЛСП · ${emp.mlsp_stay.days_on_platform ?? '—'} дн</span>
                  <span style="color:var(--t3);margin-left:8px">заезд ${esc(String(emp.mlsp_stay.arrived_at || '').slice(0,10))} · вывоз ${esc(String(emp.mlsp_stay.planned_depart_at || '').slice(0,10))}</span>
                  <a href="#/personnel?status=on_mlsp&focus_emp=${emp.id}" style="margin-left:8px;font-size:12px">В Дружине →</a>
                </div>` : ""}

              ${(canEdit || emp.planned_info) ? `
              <details style="margin-top:12px" ${emp.planned_info || canEdit ? 'open' : ''}>
                <summary class="kpi" style="cursor:pointer"><span style="display:inline-block;width:3px;height:14px;border-radius:2px;background:var(--info);margin-right:8px;vertical-align:middle"></span> Планируемое привлечение</summary>
                <div style="margin-top:10px;padding:12px 14px;background:var(--bg3);border-radius:8px;border:1px solid var(--brd)">
                  ${emp.planned_info && !canEdit ? `
                    <div style="font-size:13px"><b>📋 План:</b> ${esc(emp.planned_info.work_title || '—')}</div>
                    ${emp.planned_info.pm_name ? `<div class="help" style="margin-top:4px">РП: ${esc(emp.planned_info.pm_name)}</div>` : ''}
                    ${emp.planned_info.planned_from ? `<div class="help" style="margin-top:4px">с ${new Date(emp.planned_info.planned_from).toLocaleDateString('ru-RU')}${emp.planned_info.planned_to ? ' по ' + new Date(emp.planned_info.planned_to).toLocaleDateString('ru-RU') : ''}</div>` : ''}
                    ${emp.planned_info.inbound_transport ? `<div class="help" style="margin-top:4px">Завоз: ${emp.planned_info.inbound_transport === 'ship' ? 'корабль' : 'вертолёт'}</div>` : ''}
                    ${emp.planned_info.note ? `<div class="help" style="margin-top:4px">${esc(emp.planned_info.note)}</div>` : ''}
                  ` : canEdit ? `
                    <div class="formrow" style="margin-top:0">
                      <div style="grid-column:1/-1">
                        <label>Проект</label>
                        <select id="plan_work_id" class="input"></select>
                      </div>
                      <div>
                        <label>С даты</label>
                        <input id="plan_from" type="date" class="input" value="${esc(normalizeDateInput(emp.planned_info?.planned_from))}"/>
                      </div>
                      <div>
                        <label>По дату</label>
                        <input id="plan_to" type="date" class="input" value="${esc(normalizeDateInput(emp.planned_info?.planned_to))}"/>
                      </div>
                      <div style="grid-column:1/-1">
                        <label>Чем завозим (МЛСП)</label>
                        <select id="plan_inbound" class="input">
                          <option value="">— не указано —</option>
                          <option value="helicopter"${emp.planned_info?.inbound_transport === 'helicopter' ? ' selected' : ''}>Вертолёт</option>
                          <option value="ship"${emp.planned_info?.inbound_transport === 'ship' ? ' selected' : ''}>Корабль</option>
                        </select>
                      </div>
                      <div style="grid-column:1/-1">
                        <label>Комментарий</label>
                        <input id="plan_note" class="input" value="${esc(emp.planned_info?.note || '')}" placeholder="Необязательно"/>
                      </div>
                    </div>
                    <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
                      <button class="btn" id="btnPlanSave" type="button">Сохранить план</button>
                      ${emp.planned_info ? '<button class="btn ghost" id="btnPlanClear" type="button">Снять с плана</button>' : ''}
                    </div>
                    ${emp.on_site_info ? `<div class="help" style="margin-top:8px">Сейчас на объекте: <b>${esc(emp.on_site_info.work_title || '')}</b>${emp.on_site_info.pm_name ? ' · РП: <b>' + esc(emp.on_site_info.pm_name) + '</b>' : ''}. План на другой проект не снимает его с текущего — сначала отъезд.</div>` : ''}
                    <div class="help" style="margin-top:6px">План не создаёт назначение и не меняет статус готовности.</div>
                  ` : ''}
                </div>
              </details>` : ''}

              ${canEdit && window.AsgardPersonnelPage ? `
                <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px">
                  <span style="color:var(--t2);font-size:13px;align-self:center">Статус готовности:</span>
                  <button class="btn emp-st-btn" data-st="ready"
                    style="background:var(--gold-bg);color:var(--gold)">✓ Готов</button>
                  <button class="btn ghost emp-st-btn" data-st="not_ready"
                    style="border-color:var(--warn);color:var(--warn-t)">✗ Не готов</button>
                  <button class="btn ghost emp-st-btn" data-st="unknown"
                    style="border-color:var(--brd);color:var(--t2)">Без статуса</button>
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

              <div class="kpi" style="margin-top:16px"><span class="dot" style="background:var(--info)"></span> Основная информация</div>
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
                        { v: "сварщик", l: "🔥 Сварщик" },
                        { v: "альпинист", l: "🧗 Альпинист" },
                        { v: "мастер",  l: "👷 Мастер" },
                        { v: "РП",      l: "👑 РП (руководитель)" },
                      ];
                      const std = opts.map(o => o.v.toLowerCase());
                      if (cur && !std.includes(cur)) {
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
            </section>

            <!-- ── contacts ── -->
            <section class="emp-ws-panel${initialSection==='contacts'?' is-active':''}" data-section="contacts" id="empPanel_contacts">
              <h3 class="emp-ws-panel-title"><span class="bar"></span> Контакты</h3>
              <div class="formrow">
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
                  <div class="emp-ws-phone-row">
                    <input id="phone" value="${esc(phoneDisp)}" ${canEdit?"":"disabled"}/>
                    <button type="button" class="asg-copy-btn asg-copy-btn--always" id="btnCopyPhone" title="Скопировать телефон" aria-label="Скопировать телефон">
                      <svg class="asg-copy-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                      <svg class="asg-copy-btn__done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                  </div>
                </div>
                <div>
                  <label>Телефон дополнительный</label>
                  <input id="phone2" value="${esc(phone2Disp)}" ${canEdit?"":"disabled"}/>
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
              <div class="kpi" style="margin-top:18px"><span class="dot" style="background:var(--err-t)"></span> Экстренные контакты</div>
              <div class="formrow" style="margin-top:12px">
                <div>
                  <label>ФИО супруга(и)</label>
                  <input id="spouse_name" value="${esc(emp.spouse_name||"")}" ${canEdit?"":"disabled"}/>
                </div>
                <div>
                  <label>Телефон супруга(и)</label>
                  <input id="spouse_phone" value="${esc(spousePhoneDisp)}" ${canEdit?"":"disabled"}/>
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
                  <input id="relative_phone" value="${esc(relativePhoneDisp)}" ${canEdit?"":"disabled"}/>
                </div>
              </div>
            </section>

            <!-- ── documents ── -->
            <section class="emp-ws-panel${initialSection==='documents'?' is-active':''}" data-section="documents" id="empPanel_documents">
              <h3 class="emp-ws-panel-title"><span class="bar"></span> Документы</h3>
              ${passportAgeBannerHtml(emp)}
              <div class="formrow">
                <div>
                  <label>Паспорт: серия</label>
                  <input id="pass_series" value="${esc(passSeriesDigits)}" placeholder="1234" inputmode="numeric" ${canEdit?"":"disabled"}/>
                </div>
                <div>
                  <label>Паспорт: номер</label>
                  <input id="pass_number" value="${esc(passNumberDigits)}" placeholder="567890" inputmode="numeric" ${canEdit?"":"disabled"}/>
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
                  <input id="passport_code" value="${esc(passportCodeDisp)}" placeholder="123-456" ${canEdit?"":"disabled"}/>
                </div>
                <div>
                  <label>СНИЛС</label>
                  <input id="snils" value="${esc(snilsDisp)}" ${canEdit?"":"disabled"}/>
                </div>
                <div>
                  <label>Военный билет (№, категория)</label>
                  <input id="military_id" value="${esc(emp.military_id||"")}" ${canEdit?"":"disabled"}/>
                </div>
                <div style="grid-column:1/-1">
                  <label>Водительское удостоверение</label>
                  <input id="driver_license" value="${esc(emp.driver_license||"")}" placeholder="Категории, срок" ${canEdit?"":"disabled"}/>
                </div>
                <div style="grid-column:1/-1">
                  <label>Ссылка на папку документов сотрудника</label>
                  <input id="docs" value="${esc(emp.docs_folder_link||"")}" placeholder="https://drive.google.com/..." ${canEdit?"":"disabled"}/>
                </div>
              </div>
            </section>

            <!-- ── ppe ── -->
            <section class="emp-ws-panel${initialSection==='ppe'?' is-active':''}" data-section="ppe" id="empPanel_ppe">
              <h3 class="emp-ws-panel-title"><span class="bar"></span> СИЗ и доп. данные</h3>
              <div class="formrow">
                <div>
                  <label>Размер одежды</label>
                  ${_ppeSelect('clothing', 'clothing_size', emp.clothing_size)}
                </div>
                <div>
                  <label>Размер обуви</label>
                  ${_ppeSelect('shoe', 'shoe_size', emp.shoe_size)}
                </div>
                <div>
                  <label>Головной убор (каска)</label>
                  ${_ppeSelect('headwear', 'headwear_size', emp.headwear_size)}
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
              </div>
            </section>

            <!-- ── work ── -->
            <section class="emp-ws-panel${initialSection==='work'?' is-active':''}" data-section="work" id="empPanel_work">
              <h3 class="emp-ws-panel-title"><span class="bar"></span> Работа</h3>

              <div class="kpi"><span class="dot" style="background:var(--ok-t)"></span> 💼 Самозанятый</div>
              <div class="formrow" style="margin-top:12px">
                <div style="grid-column:1/-1">
                  <label title="При включении блок «Официально устроен» будет недоступен (взаимоисключение)">
                    <input id="is_self_employed" type="checkbox" ${emp.is_self_employed?"checked":""} ${canEditHrSensitive?"":"disabled"} ${emp.is_officially_employed?"disabled":""}/>
                    Является самозанятым (плательщик НПД)
                  </label>
                  ${emp.is_officially_employed && canEditHrSensitive ? '<div class="help" style="margin-top:4px">Снимите «Официально устроен», чтобы включить.</div>' : ''}
                </div>
                <div>
                  <label title="12 цифр. Используется для проверки лимита самозанятого (2.4M/год).">ИНН</label>
                  <input id="inn" value="${esc(innDigits)}" placeholder="123456789012" inputmode="numeric" ${canEdit?"":"disabled"}/>
                </div>

                <div style="grid-column:1/-1;border-top:1px dashed var(--brd);padding-top:12px;margin-top:4px">
                  <div class="help" style="margin-bottom:8px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:0.08em;font-size:11px">— Получатель НПД-выплат —</div>
                  <label title="Выплаты СЗ идут не на самого рабочего, а на родственника-получателя (жена/брат/отец как СЗ). У получателя свои НПД-лимиты.">
                    <input id="use_payee" type="checkbox" ${emp.se_payee_id?"checked":""} ${canEdit?"":"disabled"}/>
                    Выплаты идут не на меня (на родственника-СЗ)
                  </label>
                  <div id="payee_block" style="display:${emp.se_payee_id?'block':'none'};margin-top:10px">
                    <div id="payee_current" class="emp-payee-cur" style="display:${emp.se_payee_id?'flex':'none'}">
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

              <div class="kpi" style="margin-top:20px"><span class="dot" style="background:var(--info)"></span> 🏢 Официально устроен</div>
              <div class="formrow" style="margin-top:12px">
                <div style="grid-column:1/-1">
                  <label title="При включении блок «Самозанятый» будет недоступен (взаимоисключение)">
                    <input id="is_officially_employed" type="checkbox" ${emp.is_officially_employed?"checked":""} ${canEditHrSensitive?"":"disabled"} ${emp.is_self_employed?"disabled":""}/>
                    Является официально устроенным (по ТД)
                  </label>
                  ${emp.is_self_employed && canEditHrSensitive ? '<div class="help" style="margin-top:4px">Снимите «Самозанятый», чтобы включить.</div>' : ''}
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
                      <div><b>Дата приёма:</b> ${emp.official_hire_date ? esc(new Date(emp.official_hire_date).toLocaleDateString('ru-RU')) : '—'}</div>
                      <div><b>Статус:</b> ${esc(({active:'Активен',unpaid_leave:'Отпуск без сохранения',maternity:'Декрет',sick_leave:'Больничный',fired:'Уволен'})[emp.official_status||'active'])}</div>
                      ${emp.official_status==='unpaid_leave' && (emp.official_leave_from||emp.official_leave_to) ? `<div><b>Отпуск:</b> ${esc(emp.official_leave_from ? new Date(emp.official_leave_from).toLocaleDateString('ru-RU') : '—')} — ${esc(emp.official_leave_to ? new Date(emp.official_leave_to).toLocaleDateString('ru-RU') : '—')}</div>` : ''}
                      <div style="margin-top:4px;opacity:0.7">Изменить может только бухгалтер/директор/админ.</div>
                    </div>
                  </div>
                `}
              </div>
            </section>

            <!-- ── permits ── -->
            <section class="emp-ws-panel${initialSection==='permits'?' is-active':''}" data-section="permits" id="empPanel_permits">
              <h3 class="emp-ws-panel-title"><span class="bar"></span> Допуски и разрешения</h3>
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
            </section>

            <!-- ── history ── -->
            <section class="emp-ws-panel${initialSection==='history'?' is-active':''}" data-section="history" id="empPanel_history">
              <h3 class="emp-ws-panel-title"><span class="bar"></span> История работ</h3>
              <div class="emp-hist-stats">
                <div class="emp-hist-stat">
                  <div class="emp-hist-stat-v gold">${assigns.length}</div>
                  <div class="emp-hist-stat-l">Всего работ</div>
                </div>
                <div class="emp-hist-stat">
                  <div class="emp-hist-stat-v ok">${currentAssigns.length}</div>
                  <div class="emp-hist-stat-l">Активных</div>
                </div>
                <div class="emp-hist-stat">
                  <div class="emp-hist-stat-v" id="empFactDays">${(function(){
                    var total = 0;
                    assigns.forEach(function(a2){
                      var d1 = a2.date_from ? new Date(a2.date_from) : null;
                      var d2 = a2.date_to ? new Date(a2.date_to) : new Date();
                      if(d1) total += Math.max(0, Math.round((d2-d1)/86400000));
                    });
                    return total;
                  })()}</div>
                  <div class="emp-hist-stat-l">Дней отработано</div>
                </div>
                <div class="emp-hist-stat">
                  <div class="emp-hist-stat-v info">${new Set(assigns.map(function(a2){return a2.customer_name||a2.tender_customer_name||'';}).filter(Boolean)).size}</div>
                  <div class="emp-hist-stat-l">Заказчиков</div>
                </div>
              </div>

              <div id="empTimeline" class="emp-timeline"></div>

              <div class="tablewrap" style="margin-top:10px">
                <table class="tbl" id="empAssignTable">
                  <thead><tr><th>С</th><th>По</th><th>Контракт</th><th>Заказчик</th><th>Город</th><th>Роль</th><th>РП</th><th style="min-width:80px">Статус</th></tr></thead>
                  <tbody>${assignHtml}</tbody>
                </table>
              </div>

              <div class="kpi" style="margin-top:18px"><span class="dot" style="background:var(--ok-t)"></span> Отзывы РП</div>
              <div style="margin-top:10px">${revHtml}</div>
              <div class="help" style="margin-top:10px">ᚱ Хороший воин ценится делом, а не словами.</div>
            </section>

            <!-- ── notes ── -->
            <section class="emp-ws-panel${initialSection==='notes'?' is-active':''}" data-section="notes" id="empPanel_notes">
              <h3 class="emp-ws-panel-title"><span class="bar"></span> Заметки (${(emp.comments||[]).length})</h3>
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
            </section>
          </div>
        </div>

        ${canEdit ? `
        <div class="emp-ws-sticky">
          <span class="help" id="empStickyHint">Несохранённые правки сохранятся по кнопке или автосохранением.</span>
          <button type="button" class="btn" id="btnSaveSticky">Сохранить</button>
        </div>` : ''}
      </div>
    `;

    await layout(html, {title: title || "Личное дело", motto: "Сильна дружина, где помнят имена и дела."});

    // ─── CRSelect: employee form fields ───
    $('#gender_w')?.appendChild(CRSelect.create({ id: 'gender', options: [{ value: '', label: '—' }, { value: 'male', label: 'Мужской' }, { value: 'female', label: 'Женский' }], value: (() => { const g = String(emp.gender || '').toLowerCase(); if (['m','м','male','мужской'].includes(g)) return 'male'; if (['f','ж','female','женский'].includes(g)) return 'female'; return ''; })(), disabled: !canEdit }));
    $('#marital_status_w')?.appendChild(CRSelect.create({ id: 'marital_status', options: [{ value: '', label: '—' }, { value: 'single', label: 'Не женат/не замужем' }, { value: 'married', label: 'Женат/замужем' }, { value: 'divorced', label: 'Разведён(а)' }], value: emp.marital_status || '', disabled: !canEdit }));
    const _bloodOpts = [{ value: '', label: '—' }, { value: 'O+', label: 'O(I)+' }, { value: 'O-', label: 'O(I)−' }, { value: 'A+', label: 'A(II)+' }, { value: 'A-', label: 'A(II)−' }, { value: 'B+', label: 'B(III)+' }, { value: 'B-', label: 'B(III)−' }, { value: 'AB+', label: 'AB(IV)+' }, { value: 'AB-', label: 'AB(IV)−' }];
    $('#blood_type_w')?.appendChild(CRSelect.create({ id: 'blood_type', options: _bloodOpts, value: emp.blood_type || '', disabled: !canEdit }));

    // EMP_WS_BINDINGS — section nav, back, copy phone, chips, masks, completeness, dirty, autosave, leave guard
    (function bindEmpWorkspace(){
      const root = document.getElementById('empWorkspace');
      if (!root) return;
      const RM = window.AsgardRuMasks || {};
      let dirty = false;
      let autosaveTimer = null;
      let leaving = false;
      const statusEl = document.getElementById('empSaveStatus');

      function setSection(sec){
        const s = WS_SECTIONS.includes(sec) ? sec : 'overview';
        root.querySelectorAll('.emp-ws-nav-item').forEach(btn => {
          btn.classList.toggle('is-active', btn.getAttribute('data-section') === s);
        });
        root.querySelectorAll('.emp-ws-panel').forEach(p => {
          p.classList.toggle('is-active', p.getAttribute('data-section') === s);
        });
        try {
          const q = parseQuery();
          const parts = [];
          Object.keys(q).forEach(k => { if (k !== 'section') parts.push(encodeURIComponent(k)+'='+encodeURIComponent(q[k])); });
          parts.push('section='+encodeURIComponent(s));
          const base = (location.hash||'#/employee').split('?')[0];
          history.replaceState(null, '', base + '?' + parts.join('&'));
        } catch(_) {}
      }

      document.getElementById('empWsNav')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.emp-ws-nav-item');
        if (!btn) return;
        setSection(btn.getAttribute('data-section') || 'overview');
      });

      document.getElementById('btnBackPersonnel')?.addEventListener('click', () => {
        tryLeave('#/personnel');
      });

      document.getElementById('btnCopyPhone')?.addEventListener('click', async () => {
        const el = document.getElementById('phone');
        const btn = document.getElementById('btnCopyPhone');
        const raw = el ? (RM.phoneDigitsFromInput ? RM.phoneDigitsFromInput(el) : el.value) : '';
        const text = raw || el?.value || '';
        if (!text) { toast('Телефон', 'Пусто', 'err'); return; }
        try {
          await navigator.clipboard.writeText(text);
          toast('Скопировано', text);
          if (btn) {
            btn.classList.add('is-copied');
            btn.setAttribute('title', 'Скопировано');
            clearTimeout(btn._copiedTimer);
            btn._copiedTimer = setTimeout(() => {
              btn.classList.remove('is-copied');
              btn.setAttribute('title', 'Скопировать телефон');
            }, 1400);
          }
        } catch(_) {
          toast('Ошибка', 'Не удалось скопировать', 'err');
        }
      });

      root.querySelectorAll('.emp-ws-chips').forEach(wrap => {
        const field = wrap.getAttribute('data-chips-for');
        const inp = field ? document.getElementById(field) : null;
        if (!inp) return;
        wrap.addEventListener('click', (e) => {
          const chip = e.target.closest('.emp-ws-chip');
          if (!chip || inp.disabled) return;
          inp.value = chip.getAttribute('data-size') || '';
          wrap.querySelectorAll('.emp-ws-chip').forEach(c => c.classList.toggle('is-active', c === chip));
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          markDirty();
        });
      });

      if (RM.bindPhoneInput) {
        ['phone','phone2','spouse_phone','relative_phone'].forEach(id => RM.bindPhoneInput(document.getElementById(id)));
      }
      if (RM.bindDigitsInput) {
        RM.bindDigitsInput(document.getElementById('pass_series'), 4);
        RM.bindDigitsInput(document.getElementById('pass_number'), 6);
        RM.bindDigitsInput(document.getElementById('inn'), 12);
        RM.bindDigitsInput(document.getElementById('snils'), 11, RM.formatSnilsDisplay);
        RM.bindDigitsInput(document.getElementById('passport_code'), 6, RM.formatPassportCodeDisplay);
      }

      function val(id){ return (document.getElementById(id)?.value || '').trim(); }
      function filled(v){ return v != null && String(v).trim() !== ''; }
      function refreshCompleteness(){
        const form = {
          fio: val('fio'),
          phone: val('phone'),
          birth_date: val('birth'),
          address: val('address_fact'),
          registration_address: val('registration_address'),
          passport_series: val('pass_series'),
          passport_number: val('pass_number'),
          clothing_size: val('clothing_size'),
          shoe_size: val('shoe_size'),
          headwear_size: val('headwear_size'),
          passport_issued: val('passport_issued'),
          passport_date: val('passport_date'),
          passport_code: val('passport_code'),
          phone2: val('phone2'),
          spouse_name: val('spouse_name'),
          spouse_phone: val('spouse_phone'),
          relative_name: val('relative_name'),
          relative_phone: val('relative_phone'),
          snils: val('snils'),
          blood_type: (typeof CRSelect !== 'undefined' && CRSelect.getValue) ? (CRSelect.getValue('blood_type')||'') : '',
          inn: val('inn'),
          is_self_employed: !!document.getElementById('is_self_employed')?.checked,
        };
        const critical = [
          { ok: filled(form.fio), label: 'ФИО', section: 'overview' },
          { ok: filled(form.phone), label: 'Телефон', section: 'contacts' },
          { ok: filled(form.birth_date), label: 'Дата рождения', section: 'overview' },
          { ok: filled(form.address) || filled(form.registration_address), label: 'Адрес', section: 'contacts' },
          { ok: filled(form.passport_series) && filled(form.passport_number), label: 'Паспорт', section: 'documents' },
          { ok: filled(form.clothing_size) && filled(form.shoe_size), label: 'СИЗ (одежда+обувь)', section: 'ppe' },
        ];
        const soft = [
          { ok: filled(form.headwear_size), label: 'Каска', section: 'ppe' },
          { ok: filled(form.passport_issued) && filled(form.passport_date), label: 'Паспорт: кем/когда', section: 'documents' },
          { ok: filled(form.passport_code), label: 'Код подразделения', section: 'documents' },
          { ok: filled(form.phone2), label: 'Доп. телефон', section: 'contacts' },
          { ok: (filled(form.spouse_name) && filled(form.spouse_phone)) || (filled(form.relative_name) && filled(form.relative_phone)), label: 'Экстренный контакт', section: 'contacts' },
          { ok: filled(form.snils), label: 'СНИЛС', section: 'documents' },
          { ok: filled(form.blood_type), label: 'Группа крови', section: 'ppe' },
        ];
        if (form.is_self_employed) soft.unshift({ ok: filled(form.inn), label: 'ИНН (СЗ)', section: 'work' });
        const criticalGaps = critical.filter(g => !g.ok).map(g => g.label);
        const softGaps = soft.filter(g => !g.ok).map(g => g.label);
        const done = critical.filter(g => g.ok).length + soft.filter(g => g.ok).length;
        const total = critical.length + soft.length;
        const pct = total ? Math.round((done / total) * 100) : 100;
        const fill = document.getElementById('empCompFill');
        const lab = document.getElementById('empCompLabel');
        const gapsBtn = document.getElementById('empCompGaps');
        if (fill) fill.style.width = pct + '%';
        if (lab) lab.textContent = 'Заполнено ' + pct + '%';
        const sectionHints = {};
        [...critical, ...soft].filter(g => !g.ok).forEach(g => {
          if (!sectionHints[g.section]) sectionHints[g.section] = [];
          sectionHints[g.section].push(g.label);
        });
        root.querySelectorAll('[data-gap-for]').forEach(dot => {
          const sid = dot.getAttribute('data-gap-for');
          const gaps = sectionHints[sid];
          if (gaps && gaps.length) {
            dot.hidden = false;
            dot.title = gaps.join(', ');
          } else {
            dot.hidden = true;
            dot.removeAttribute('title');
          }
        });
        if (gapsBtn) {
          if (criticalGaps[0]) {
            gapsBtn.hidden = false;
            gapsBtn.textContent = 'пробелы: ' + criticalGaps.slice(0, 3).join(', ');
            gapsBtn.onclick = () => {
              const first = Object.keys(sectionHints)[0];
              if (first) setSection(first);
            };
          } else {
            gapsBtn.hidden = true;
            gapsBtn.textContent = '';
          }
        }
      }

      function updateStatus(){
        if (!statusEl) return;
        if (dirty) statusEl.textContent = 'есть правки';
        else statusEl.textContent = '';
      }
      function markDirty(){
        dirty = true;
        updateStatus();
        scheduleAutosave();
        refreshCompleteness();
      }
      function markSaved(){
        dirty = false;
        if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
        if (statusEl) {
          const t = new Date();
          statusEl.textContent = 'сохранено ' + t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        }
        refreshCompleteness();
      }
      window.__empWsMarkSaved = markSaved;

      function scheduleAutosave(){
        if (!canEdit) return;
        if (autosaveTimer) clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
          if (!dirty) return;
          if (statusEl) statusEl.textContent = 'сохраняем…';
          const btn = document.getElementById('btnSave');
          if (btn) btn.click();
        }, 30000);
      }

      function tryLeave(hash){
        if (!dirty || leaving) {
          location.hash = hash;
          return;
        }
        if (confirm('Есть несохранённые изменения. Выйти без сохранения?')) {
          leaving = true;
          dirty = false;
          location.hash = hash;
        }
      }

      root.addEventListener('input', (e) => {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('#empWorkspace')) markDirty();
      });
      root.addEventListener('change', (e) => {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('#empWorkspace')) markDirty();
      });

      window.addEventListener('beforeunload', (e) => {
        if (!dirty) return;
        e.preventDefault();
        e.returnValue = '';
      });

      const onHash = () => {
        if (!dirty || leaving) return;
        const h = location.hash || '';
        if (h.indexOf('#/employee') === 0) return;
        // hash already changed — warn once via confirm on next back is hard; rely on beforeunload + back button
      };
      window.addEventListener('hashchange', onHash);

      refreshCompleteness();
      setSection(initialSection);
    })();

    // ── Timeline / Gantt (по фактическим чек-инам) ──
    (async function renderTimeline(){
      var container = document.getElementById('empTimeline');
      if (!container) return;
      container.innerHTML = '<div class="help" style="text-align:center;padding:12px">⏳ Загрузка…</div>';

      var segments = [];
      try {
        var token = localStorage.getItem('asgard_token');
        var resp = await fetch('/api/staff/employees/' + id + '/worklog', { headers: { Authorization: 'Bearer ' + token } });
        if (resp.ok) { var data = await resp.json(); segments = data.segments || []; }
      } catch(e) { /* ignore — покажем пусто */ }

      if (!segments.length) {
        container.innerHTML = '<div class="help" style="text-align:center;padding:12px">Нет отметок о выходах на объект</div>';
        return;
      }

      var now = new Date();
      var fmtRu = function(s){ return s ? new Date(s).toLocaleDateString('ru-RU') : ''; };
      var endOf = function(seg){ return seg.ongoing ? now : (seg.end ? new Date(seg.end) : now); };
      var startOf = function(seg){ return seg.start ? new Date(seg.start) : now; };

      var factDays = 0;
      segments.forEach(function(s){ factDays += Number(s.days) || 0; });
      var factEl = document.getElementById('empFactDays');
      if (factEl) factEl.textContent = String(factDays);

      var allDates = [];
      segments.forEach(function(s){ allDates.push(startOf(s)); allDates.push(endOf(s)); });
      var minD = new Date(Math.min.apply(null, allDates));
      var maxD = new Date(Math.max.apply(null, allDates));
      minD.setDate(1); minD.setMonth(minD.getMonth()-1);
      maxD.setDate(1); maxD.setMonth(maxD.getMonth()+2);
      var totalMs = maxD - minD;
      if (totalMs <= 0) { container.innerHTML = '<div class="help" style="text-align:center;padding:12px">Нет данных для таймлайна</div>'; return; }

      var months = [];
      var cur = new Date(minD);
      while (cur < maxD) { months.push(cur.toLocaleDateString('ru-RU',{month:'short',year:'2-digit'})); cur.setMonth(cur.getMonth()+1); }
      var monthW = Math.max(60, 900 / months.length);
      var totalW = monthW * months.length;

      var headerH = '<div class="emp-timeline-head">';
      months.forEach(function(m2){ headerH += '<div class="emp-timeline-month" style="width:'+monthW+'px">'+m2+'</div>'; });
      headerH += '</div>';

      var rowsMap = new Map();
      segments.forEach(function(s){
        if (!rowsMap.has(s.work_id)) rowsMap.set(s.work_id, []);
        rowsMap.get(s.work_id).push(s);
      });
      var rows = Array.from(rowsMap.entries()).map(function(e){
        return { work_id: e[0], segs: e[1].sort(function(a,b){ return startOf(a)-startOf(b); }) };
      }).sort(function(a,b){ return startOf(a.segs[0]) - startOf(b.segs[0]); });

      var rowH = 38;
      var barsH = '';
      rows.forEach(function(row, idx){
        row.segs.forEach(function(s, segIdx){
          var d1 = startOf(s), d2 = endOf(s);
          var left = ((d1 - minD) / totalMs) * totalW;
          var width = Math.max(5, ((d2 - d1) / totalMs) * totalW);
          var barCls = 'emp-timeline-bar ' + (s.ongoing ? 'is-cur' : 'is-done');
          var title = (s.work_title || ('Объект #' + s.work_id));
          var label = s.days ? (s.days + ' дн.') : (segIdx === 0 ? title.substring(0, 25) : '');
          var periodTxt = fmtRu(s.start) + ' — ' + (s.ongoing ? 'по н.в. (текущая работа)' : fmtRu(s.end));
          var daysTxt = s.no_checkins ? 'нет отметок о выходах' : (s.days + ' дн. фактически');
          var depTxt = (!s.ongoing && s.departure) ? ('\nОтъезд: ' + fmtRu(s.departure)) : '';
          var tooltip = title + '\n' + (s.customer_name||'') + '\nРП: ' + (s.pm_name||'') + '\n' + periodTxt + '\n' + daysTxt + depTxt;
          barsH += '<div class="'+barCls+'" data-work-id="'+(s.work_id||'')+'" style="left:'+left+'px;top:'+(idx*rowH+4)+'px;width:'+width+'px;height:'+(rowH-8)+'px" title="'+tooltip.replace(/"/g,'&quot;')+'">'+label+'</div>';
        });
      });

      var todayLeft = ((now - minD) / totalMs) * totalW;
      var todayLine = '<div class="emp-timeline-today" style="left:'+todayLeft+'px" title="Сегодня"></div>';

      var totalHeight = rows.length * rowH + 10;
      container.innerHTML = '<div class="emp-timeline-inner" style="min-width:'+totalW+'px">' +
        headerH +
        '<div class="emp-timeline-body" style="height:'+totalHeight+'px">' +
          months.map(function(m2,i2){ return '<div class="emp-timeline-grid" style="left:'+(i2*monthW)+'px"></div>'; }).join('') +
          barsH + todayLine +
        '</div>' +
        '<div class="emp-timeline-legend">' +
          '<span><span class="emp-timeline-legend-sw cur"></span>Текущая работа</span>' +
          '<span><span class="emp-timeline-legend-sw done"></span>Завершённый заезд</span>' +
          '<span style="margin-left:auto"><span class="emp-timeline-legend-sw today"></span>Сегодня</span>' +
        '</div>' +
      '</div>';

      container.querySelectorAll('.emp-timeline-bar').forEach(function(bar){
        bar.addEventListener('click', function(){
          var wid = bar.getAttribute('data-work-id') || '';
          container.querySelectorAll('.emp-timeline-bar').forEach(function(b){ b.classList.remove('is-hl'); });
          document.querySelectorAll('tr.emp-assign-row').forEach(function(tr){ tr.classList.remove('is-hl'); });
          bar.classList.add('is-hl');
          document.querySelectorAll('tr.emp-assign-row[data-work-id="'+wid+'"]').forEach(function(tr){
            tr.classList.add('is-hl');
            tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          });
        });
      });
    })();

    // Render detailed permits table
    if (window.AsgardPermitsPage && AsgardPermitsPage.renderEmployeePermits) {
      AsgardPermitsPage.renderEmployeePermits(id, canEdit).then(h => {
        const b = document.getElementById("permitsDetailBlock");
        if (b) {
          b.innerHTML = h;
          // Bind "Add permit" button → единое окно (чеклист допусков)
          const btnAdd = b.querySelector("#btnAddPermit");
          if (btnAdd && AsgardPermitsPage.openChecklistModal) {
            const empFio = (typeof emp !== 'undefined' && emp) ? (emp.fio || emp.name || null) : null;
            btnAdd.onclick = () => AsgardPermitsPage.openChecklistModal(id, empFio, () => {
              AsgardPermitsPage.renderEmployeePermits(id, canEdit).then(h2 => { b.innerHTML = h2; });
            });
          } else if (btnAdd && AsgardPermitsPage.openPermitModal) {
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

    // ── Планируемое привлечение ─────────────────────────────────────────────
    const planWorkSel = document.getElementById("plan_work_id");
    if (planWorkSel && canEdit) {
      (async () => {
        let worksList = [];
        try {
          const token = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token') || '';
          const r = await fetch('/api/works?limit=500', { headers: { Authorization: 'Bearer ' + token } });
          const d = await r.json();
          worksList = (d.works || d.items || []).filter(w => !w.deleted_at && w.work_status !== 'Архив');
        } catch (_) {
          worksList = [];
        }
        worksList.sort((a, b) => String(a.work_title || '').localeCompare(String(b.work_title || ''), 'ru'));
        const onSiteId = emp.on_site_info ? Number(emp.on_site_info.work_id) : null;
        planWorkSel.innerHTML = '<option value="">— выберите работу —</option>' + worksList.map(w => {
          const isCurrent = onSiteId && Number(w.id) === onSiteId;
          const label = (w.work_title || ('#' + w.id)).slice(0, 70) + (isCurrent ? ' · уже на объекте' : '');
          return `<option value="${w.id}"${emp.planned_info && Number(emp.planned_info.work_id) === Number(w.id) ? ' selected' : ''}>${esc(label)}</option>`;
        }).join('');
      })();
    }
    const btnPlanSave = document.getElementById("btnPlanSave");
    if (btnPlanSave) {
      btnPlanSave.onclick = async () => {
        const workId = Number(planWorkSel?.value || 0);
        if (!workId) { toast('План', 'Выберите проект', 'err'); return; }
        if (emp.on_site_info && Number(emp.on_site_info.work_id) === workId) {
          toast(
            'План',
            `«${emp.fio || 'Сотрудник'}» уже на объекте «${emp.on_site_info.work_title || ''}». Выберите другой проект или оформите отъезд.`,
            'err'
          );
          return;
        }
        const body = {
          work_id: workId,
          planned_from: document.getElementById('plan_from')?.value || null,
          planned_to: document.getElementById('plan_to')?.value || null,
          note: (document.getElementById('plan_note')?.value || '').trim() || null,
          inbound_transport: document.getElementById('plan_inbound')?.value || null,
        };
        try {
          const token = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token') || '';
          const r = await fetch('/api/staff/planned-engagements/employees/' + id, {
            method: 'PUT',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
          if (data.warnings && data.warnings.length) toast('Предупреждение', data.warnings.join('; '), 'warn');
          toast('План', 'Сохранён', 'ok');
          render();
        } catch (e) {
          toast('План', e.message || 'Ошибка', 'err');
        }
      };
    }
    const btnPlanClear = document.getElementById("btnPlanClear");
    if (btnPlanClear) {
      btnPlanClear.onclick = async () => {
        try {
          const token = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token') || '';
          const r = await fetch('/api/staff/planned-engagements/employees/' + id, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + token },
          });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
          toast('План', 'Снят с плана', 'ok');
          render();
        } catch (e) {
          toast('План', e.message || 'Ошибка', 'err');
        }
      };
    }

    // ── Кнопки статуса готовности (Готов / Не готов / Без статуса / Архив) ─────────
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
        const _RM = window.AsgardRuMasks || {};
        emp.pass_series = (_RM.digitsFromInput ? _RM.digitsFromInput($("#pass_series"), 4) : ($("#pass_series")?.value||"").replace(/\D/g,'')) || "";
        emp.pass_number = (_RM.digitsFromInput ? _RM.digitsFromInput($("#pass_number"), 6) : ($("#pass_number")?.value||"").replace(/\D/g,'')) || "";
        emp.passport_issued=$("#passport_issued")?.value?.trim() || "";
        emp.passport_date=$("#passport_date")?.value || "";
        emp.passport_code = (_RM.digitsFromInput ? _RM.digitsFromInput($("#passport_code"), 6) : ($("#passport_code")?.value||"").replace(/\D/g,'')) || "";
        emp.inn = (_RM.digitsFromInput ? _RM.digitsFromInput($("#inn"), 12) : ($("#inn")?.value||"").replace(/\D/g,'')) || "";
        emp.snils = (_RM.digitsFromInput ? _RM.digitsFromInput($("#snils"), 11) : ($("#snils")?.value||"").replace(/\D/g,'')) || "";
        emp.military_id=$("#military_id")?.value?.trim() || "";
        emp.driver_license=$("#driver_license")?.value?.trim() || "";

        // Адреса и контакты
        emp.registration_address=$("#registration_address")?.value?.trim() || "";
        emp.address=$("#address_fact")?.value?.trim() || "";
        emp.phone = (_RM.phoneDigitsFromInput ? _RM.phoneDigitsFromInput($("#phone")) : ($("#phone")?.value?.trim() || "")) || "";
        emp.phone2 = (_RM.phoneDigitsFromInput ? _RM.phoneDigitsFromInput($("#phone2")) : ($("#phone2")?.value?.trim() || "")) || "";
        emp.email=$("#email")?.value?.trim() || "";
        emp.telegram=$("#telegram")?.value?.trim() || "";

        // Экстренные контакты
        emp.spouse_name=$("#spouse_name")?.value?.trim() || "";
        emp.spouse_phone = (_RM.phoneDigitsFromInput ? _RM.phoneDigitsFromInput($("#spouse_phone")) : ($("#spouse_phone")?.value?.trim() || "")) || "";
        emp.relative_name=$("#relative_name")?.value?.trim() || "";
        emp.relative_relation=$("#relative_relation")?.value?.trim() || "";
        emp.relative_phone = (_RM.phoneDigitsFromInput ? _RM.phoneDigitsFromInput($("#relative_phone")) : ($("#relative_phone")?.value?.trim() || "")) || "";

        // Дополнительно
        emp.education=$("#education")?.value?.trim() || "";
        emp.specialty=$("#specialty")?.value?.trim() || "";
        emp.marital_status=CRSelect.getValue('marital_status') || "";
        emp.children_count=$("#children_count")?.value ? Number($("#children_count").value) : null;
        emp.clothing_size=$("#clothing_size")?.value?.trim() || "";
        emp.shoe_size=$("#shoe_size")?.value?.trim() || "";
        emp.headwear_size=$("#headwear_size")?.value?.trim() || "";
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
        try {
          await employeeApiPut('/staff/employees/' + id, buildEmployeeApiPayload(emp, canEditFinance));
        } catch (e) {
          toast("Ошибка", e.message || "Не удалось сохранить", "err");
          return;
        }
        await AsgardDB.put("employees", emp);
        toast("Сохранено","Данные обновлены");
        if (typeof window.__empWsMarkSaved === 'function') window.__empWsMarkSaved();
      };
    }

    const btnSaveSticky = document.getElementById("btnSaveSticky");
    if (btnSaveSticky && btnSave) {
      btnSaveSticky.onclick = () => btnSave.click();
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
      btnReview.onclick=async ()=>{
        let worksOpts = [];
        try {
          const token = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token') || '';
          const r = await fetch('/api/works?limit=500', { headers: { Authorization: 'Bearer ' + token } });
          const d = await r.json();
          worksOpts = (d.works || d.items || []).filter(w => !w.deleted_at && w.work_status !== 'Архив');
        } catch (_) { worksOpts = []; }
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
        $('#w_w')?.appendChild(CRSelect.create({ id: 'w_sel', options: [{ value: '', label: '—' }, ...worksOpts.map(w => ({ value: String(w.id), label: w.work_title || '' }))], searchable: true, dropdownClass: 'z-modal' }));
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