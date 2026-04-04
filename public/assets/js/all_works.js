window.AsgardAllWorksPage=(function(){
  const { $, $$, esc, toast, showModal, money } = AsgardUI;
  const { ymNow, sortBy } = window.AsgardWorksShared || {};
  function getApiBase(){
    return (window.AsgardApp && AsgardApp.API_BASE) || localStorage.getItem('asgard_api_base') || '/api';
  }
  async function apiFetch(path, opts = {}){
    const token = localStorage.getItem('asgard_token') || (window.AsgardAuth && AsgardAuth.getToken && AsgardAuth.getToken());
    const base = getApiBase();
    const res = await fetch(`${base}${path}`, {
      ...opts,
      headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers||{}) }
    });
    if(!res.ok){
      const err = await res.json().catch(()=>({error:'Network error'}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function getUsers(){ return (await AsgardDB.all("users")).filter(u=>u.is_active && u.name && u.name.trim()); }
  async function getSettings(){
    const s = await AsgardDB.get("settings","app");
    return s ? JSON.parse(s.value_json||"{}") : { gantt_start_iso:"2026-01-01T00:00:00.000Z", status_colors:{work:{}} };
  }
  async function getRefs(){
    const refs = await AsgardDB.get("settings","refs");
    return refs ? JSON.parse(refs.value_json||"{}") : { work_statuses:[] };
  }

  async function render({layout,title}){
    let currentPage = 1, pageSize = window.AsgardPagination ? AsgardPagination.getPageSize() : 20;
    const auth=await AsgardAuth.requireUser();
    if(!auth){ location.hash="#/login"; return; }
    const user=auth.user;

    const users = await getUsers();
    const byId = new Map(users.map(u=>[u.id,u]));
    const settings = await getSettings();
    const refs = await getRefs();

    const works = await AsgardDB.all("works");
    const tenders = await AsgardDB.all("tenders");

    let sortKey="id", sortDir=-1;

    const body = `
      ${window.__ASG_SHARED_TABLE_CSS__||""}
      <div class="panel">
        <div class="help">\u00abСвод Контрактов\u00bb \u2014 все работы по компании. Девиз: \u201cДело идёт по плану \u2014 пока цифры честны.\u201d</div>
        <hr class="hr"/>
        <div class="tools">
          <div class="field"><label>Период</label><div id="f_period_w"></div></div>
          <div class="field"><label>Поиск</label><input id="f_q" placeholder="заказчик / работа"/></div>
          <div class="field"><label>РП</label><div id="f_pm_w"></div></div>
          <div class="field"><label>Статус</label><div id="f_status_w"></div></div>
          <div style="display:flex; gap:10px; flex-wrap:wrap">
            <button class="btn ghost" id="btnGantt">Гантт по всем работам</button>
          </div>
        </div>
        <hr class="hr"/>
        <div style="overflow:auto">
          <table class="asg">
            <thead>
              <tr>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="company">Заказчик / Работа</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="pm_id">РП</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="work_status">Статус</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="start_in_work_date">Сроки</button></th>
                <th><button class="btn ghost" style="padding:6px 10px" data-sort="contract_value">Деньги</button></th>
                <th></th>
              </tr>
            </thead>
            <tbody id="tb"></tbody>
          </table>
        </div>
        <div class="help" id="cnt"></div>
      </div>
    `;
    await layout(body,{title:title||"Свод Контрактов"});

    const tb=$("#tb"), cnt=$("#cnt");

    // ─── CRSelect filters ───
    { const periodOpts = [{ value: '', label: 'Все' }];
      const now2 = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now2.getFullYear(), now2.getMonth() - i, 1);
        const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        periodOpts.push({ value: v, label: d.toLocaleString('ru-RU', { month: 'long', year: 'numeric' }) });
      }
      $('#f_period_w').appendChild(CRSelect.create({ id: 'f_period', options: periodOpts, value: ymNow(), onChange: () => apply() }));
    }
    { const pmIds = new Set(works.map(w => w.pm_id).filter(Boolean));
      const pmUsers = users.filter(u => pmIds.has(u.id));
      $('#f_pm_w').appendChild(CRSelect.create({ id: 'f_pm', options: [{ value: '', label: 'Все' }, ...pmUsers.map(p => ({ value: String(p.id), label: p.name }))], onChange: () => apply() }));
    }
    $('#f_status_w').appendChild(CRSelect.create({ id: 'f_status', options: [{ value: '', label: 'Все' }, ...(refs.work_statuses||[]).map(s => ({ value: s, label: s }))], onChange: () => apply() }));

    function norm(s){ return String(s||"").toLowerCase().trim(); }

    function row(w){
      const t = tenders.find(x=>x.id===w.tender_id);
      const pm = byId.get(w.pm_id);
      const st=w.work_status||"";
      const color=(settings.status_colors?.work||{})[st]||"#2a6cf1";
      const got = (Number(w.advance_received||0)+Number(w.balance_received||0))||0;
      const left = (w.contract_value||0) ? Math.max(0, Number(w.contract_value||0)-got) : 0;
      const fmtDate = AsgardUI.formatDate || (d => d ? new Date(d).toLocaleDateString('ru-RU') : '\u2014');
      const start = fmtDate(w.start_in_work_date || t?.work_start_plan);
      const end = fmtDate(w.end_fact || w.end_plan || t?.work_end_plan);
      return `<tr data-id="${w.id}" data-tender-id="${w.tender_id||""}">
        <td><b>${esc(w.customer_name||t?.customer_name||"")}</b><div class="help">${esc(w.work_title||t?.tender_title||"")}</div></td>
        <td>${esc(pm?pm.name:"\u2014")}</td>
        <td><span class="pill" style="border-color:${esc(color)}">${esc(st)}</span></td>
        <td>${start} \u2192 ${end}</td>
        <td><div><b>${money(w.contract_value)}</b> \u20bd</div><div class="help">получено: ${money(got)} \u20bd \u2022 должны: ${money(left)} \u20bd</div></td>
        <td><button class="btn ghost" style="padding:6px 10px" data-act="create_tkp" title="Создать ТКП по этой работе">Создать ТКП</button></td>
      </tr>`;
    }

    // ═══ MOBILE_ALLWORK_CARDS ═══
    const _isMobAW = () => document.body.classList.contains('is-mobile') || window.innerWidth <= 768;

    function workCardAW(w) {
      const t = tenders.find(x => x.id === w.tender_id);
      const pm = byId.get(w.pm_id);
      const st = w.work_status || '';
      const color = (settings.status_colors?.work||{})[st] || '#2a6cf1';
      const got = (Number(w.advance_received||0) + Number(w.balance_received||0)) || 0;
      const contractVal = Number(w.contract_value||0);
      const pct = contractVal > 0 ? Math.min(100, Math.round((got / contractVal) * 100)) : 0;
      const fmtDate = AsgardUI.formatDate || (d => d ? new Date(d).toLocaleDateString('ru-RU') : '—');
      const start = fmtDate(w.start_in_work_date || t?.work_start_plan);
      const end = fmtDate(w.end_fact || w.end_plan || t?.work_end_plan);

      return '<div class="m-work-card" data-id="' + w.id + '" data-tender-id="' + (w.tender_id||'') + '">' +
        '<div class="m-wc-header">' +
          '<div class="m-wc-customer">' + esc(w.customer_name || t?.customer_name || '—') + '</div>' +
          '<span class="m-wc-status" style="border-color:' + esc(color) + ';color:' + esc(color) + '">' + esc(st) + '</span>' +
        '</div>' +
        '<div class="m-wc-title">' + esc(w.work_title || t?.tender_title || '') + '</div>' +
        '<div class="m-wc-meta" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
          '<span style="font-size:12px;color:var(--t3)">РП: <b style="color:var(--t1)">' + esc(pm?.name || '—') + '</b></span>' +
          '<span style="font-size:12px;color:var(--t3)">📅 ' + start + ' → ' + end + '</span>' +
        '</div>' +
        '<div class="m-wc-money">' +
          '<div class="m-wc-contract">' +
            '<span class="m-wc-label">Контракт</span>' +
            '<span class="m-wc-val">' + money(contractVal) + ' ₽</span>' +
          '</div>' +
          '<div class="m-wc-progress-bar">' +
            '<div class="m-wc-progress-fill" style="width:' + pct + '%;background:' + esc(color) + '"></div>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:var(--t3)">' +
            '<span>Получено: ' + money(got) + ' ₽</span>' +
            '<span>' + pct + '%</span>' +
          '</div>' +
        '</div>' +
        '<div class="m-wc-footer">' +
          '<button class="btn mini ghost" data-act="create_tkp" style="border-radius:8px">Создать ТКП</button>' +
          '<button class="btn mini" data-act="open" style="border-radius:8px">Открыть</button>' +
        '</div>' +
      '</div>';
    }

    function apply(){
      const per = norm(CRSelect.getValue('f_period') || '');
      const q = norm($("#f_q").value);
      const pm = CRSelect.getValue('f_pm') || '';
      const st = CRSelect.getValue('f_status') || '';

      let list = works.filter(w=>{
        const t = tenders.find(x=>x.id===w.tender_id);
        if(per) {
          const period = t?.period || '';
          if (!period) return false;
          if (norm(period) !== per) return false;
        }
        if(pm && String(w.pm_id)!==String(pm)) return false;
        if(st && w.work_status!==st) return false;
        if(q){
          const hay = `${w.customer_name||""} ${w.work_title||""} ${(t?.customer_name||"")} ${(t?.tender_title||"")}`.toLowerCase();
          if(!hay.includes(q)) return false;
        }
        return true;
      });

      list.sort(sortBy(sortKey,sortDir));
      const paged_allworks = window.AsgardPagination ? AsgardPagination.paginate(list, currentPage, pageSize) : list;
      if (_isMobAW()) {
        const _tableEl = tb.closest('table');
        if (_tableEl) {
          _tableEl.style.display = 'none';
          let _wc = document.getElementById('m-allwork-cards');
          if (!_wc) {
            _wc = document.createElement('div');
            _wc.id = 'm-allwork-cards';
            _wc.className = 'm-work-cards';
            _tableEl.parentNode.insertBefore(_wc, _tableEl);
          }
          _wc.innerHTML = paged_allworks.map(workCardAW).join('');
          _wc.querySelectorAll('.m-work-card').forEach(card => {
            card.addEventListener('click', (e) => {
              if (e.target.tagName === 'BUTTON') return;
              location.hash = '#/pm-works?open=' + card.dataset.id;
            });
            var _ob = card.querySelector('[data-act="open"]');
            if (_ob) _ob.addEventListener('click', () => { location.hash = '#/pm-works?open=' + card.dataset.id; });
          });
        }
      } else {
        const _tableEl = tb.closest('table');
        if (_tableEl) _tableEl.style.display = '';
        const _wc = document.getElementById('m-allwork-cards');
        if (_wc) _wc.remove();
        tb.innerHTML = paged_allworks.map(row).join("");
      }
      if (window.AsgardPagination) {
        let pgEl = document.getElementById("allworks_pagination");
        if (!pgEl) { pgEl = document.createElement("div"); pgEl.id = "allworks_pagination"; tb.closest("table").after(pgEl); }
        pgEl.innerHTML = AsgardPagination.renderControls(list.length, currentPage, pageSize);
        AsgardPagination.attachHandlers("allworks_pagination",
          (p) => { currentPage = p; apply(); },
          (s) => { pageSize = s; currentPage = 1; apply(); }
        );
      };
      cnt.textContent = `Показано: ${list.length} из ${works.length}.`;
    }

    apply();
    $("#f_q").addEventListener("input", apply);

    $$("[data-sort]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const k=b.getAttribute("data-sort");
        if(sortKey===k) sortDir*=-1; else { sortKey=k; sortDir=1; }
        apply();
      });
    });

    tb.addEventListener("click", (ev)=>{
      const tr = ev.target.closest("tr[data-id]");
      if(!tr) return;
      const act = ev.target.getAttribute("data-act");
      if(act==="create_tkp") createTkpFromWork(Number(tr.getAttribute("data-id")));
    });

    async function createTkpFromWork(workId){
      const w = works.find(x=>x.id===workId);
      if(!w){ toast("Работа не найдена","error"); return; }
      const t = tenders.find(x=>x.id===w.tender_id);

      const tkpTitle = `ТКП: ${w.customer_name||t?.customer_name||""} \u2014 ${w.work_title||t?.tender_title||""}`;
      const totalSum = w.contract_value || 0;

      try {
        const resp = await apiFetch('/tkp', {
          method: 'POST',
          body: JSON.stringify({
            title: tkpTitle.substring(0, 200),
            tender_id: w.tender_id || null,
            work_id: w.id,
            customer_name: w.customer_name || t?.customer_name || '',
            total_sum: totalSum,
            source: 'work',
            work_description: w.work_title || t?.tender_title || ''
          })
        });
        if(resp.item){
          toast("ТКП #" + resp.item.id + " создано", "success");
          location.hash = '#/tkp';
        } else {
          toast("ТКП создано", "success");
          location.hash = '#/tkp';
        }
      } catch(err){
        toast("Ошибка создания ТКП: " + err.message, "error");
      }
    }

    $("#btnGantt").addEventListener("click", ()=>{
      const startIso=(settings.gantt_start_iso||"2026-01-01T00:00:00.000Z").slice(0,10);
      const rows = works.map(w=>{
        const t=tenders.find(x=>x.id===w.tender_id);
        const start = w.start_in_work_date || t?.work_start_plan || w.end_plan || "2026-01-01";
        const end = w.end_fact || w.end_plan || t?.work_end_plan || start;
        return {start,end,label:(w.customer_name||t?.customer_name||""),sub:(w.work_title||t?.tender_title||""),barText:w.work_status||"",status:w.work_status||""};
      });
      const html = AsgardGantt.renderBoard({startIso, weeks: 60, rows, getColor:(r)=>(settings.status_colors?.work||{})[r.status]||"#2a6cf1"});
      showModal("Гантт \u2022 Все работы", '<div style="max-height:80vh; overflow:auto">' + html + '</div>');
    });
  }

  return { render };
})();
