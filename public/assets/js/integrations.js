/**
 * АСГАРД CRM — Интеграции: Банк/1С, Тендерные площадки, ERP
 * Три вкладки в одном SPA-модуле
 */
window.AsgardIntegrationsPage = (function(){

  const ARTICLES = {
    fot:'ФОТ', taxes:'Налоги', rent:'Аренда', utilities:'Коммунальные', logistics:'Логистика',
    materials:'Материалы', subcontract:'Субподряд', equipment:'Оборудование', software:'ПО',
    bank:'Банковские', office:'Офис', communication:'Связь', other:'Прочее',
    payment:'Оплата', advance:'Аванс', final:'Оконч. расчёт', refund:'Возврат'
  };

  const TX_STATUS = {
    new:{l:'Новая',c:'var(--amber)'}, classified:{l:'Классиф.',c:'var(--info)'},
    confirmed:{l:'Подтверждена',c:'var(--ok-t)'}, distributed:{l:'Разнесена',c:'var(--ok)'},
    exported_1c:{l:'Экспорт 1С',c:'var(--t2)'}, skipped:{l:'Пропущена',c:'var(--t2)'}
  };

  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function money(x) { return AsgardUI.money(Math.round(Number(x || 0))) + ' ₽'; }

  async function api(path, opts) {
    const auth = await AsgardAuth.getAuth();
    const o = { headers: { 'Authorization':'Bearer '+auth.token } };
    if (opts?.body) { o.method = opts.method || 'POST'; o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
    else if (opts?.method) o.method = opts.method;
    const r = await fetch('/api/integrations' + path, o);
    return r.json();
  }

  let currentTab = 'bank';

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }

    const html = `
      <div class="stack" style="gap:0">
        <div style="display:flex;gap:4px;border-bottom:2px solid var(--line);margin-bottom:20px">
          <button class="tab-btn active" data-tab="bank">🏦 Банк / 1С</button>
          <button class="tab-btn" data-tab="platforms">🏗️ Площадки</button>
          <button class="tab-btn" data-tab="erp">🔗 ERP</button>
        </div>
        <div id="tabContent"></div>
      </div>
      <style>
        .tab-btn{padding:10px 20px;border:none;background:none;cursor:pointer;font-size:14px;font-weight:600;color:var(--text-muted);border-bottom:3px solid transparent;transition:.2s}
        .tab-btn:hover{color:var(--text)}
        .tab-btn.active{color:var(--gold);border-bottom-color:var(--gold)}
        .int-card{background:var(--bg-card);border-radius:6px;border:1px solid var(--line);padding:16px;margin-bottom:12px}
        .int-stat{text-align:center;padding:12px}
        .int-stat .val{font-size:22px;font-weight:900}
        .int-stat .lbl{font-size:11px;color:var(--text-muted)}
        .tx-row{display:grid;grid-template-columns:90px 100px 1fr 120px 100px 80px;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line);font-size:12px;align-items:center;cursor:pointer}
        .tx-row:hover{background:var(--bg-elevated)}
        @media(max-width:800px){.tx-row{grid-template-columns:80px 80px 1fr 90px}}
      </style>`;

    await layout(html, { title: title || 'Интеграции' });

    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentTab = btn.dataset.tab;
        loadTab();
      });
    });

    loadTab();
  }

  function loadTab() {
    var el = document.getElementById('tabContent');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Загрузка...</div>';
    if (currentTab === 'bank') renderBankTab(el);
    else if (currentTab === 'platforms') renderPlatformsTab(el);
    else if (currentTab === 'erp') renderERPTab(el);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ТАБ 1: БАНК
  // ═══════════════════════════════════════════════════════════════════════
  async function renderBankTab(el) {
    var stats = await api('/bank/stats');
    var s = stats.success ? stats : {};

    el.innerHTML = '<div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px">' +
        '<div class="int-card int-stat"><div class="val" style="color:var(--ok-t)">' + money(s.total_income || 0) + '</div><div class="lbl">Доходы</div></div>' +
        '<div class="int-card int-stat"><div class="val" style="color:var(--err-t)">' + money(s.total_expense || 0) + '</div><div class="lbl">Расходы</div></div>' +
        '<div class="int-card int-stat"><div class="val" style="color:var(--gold)">' + money(s.balance || 0) + '</div><div class="lbl">Баланс</div></div>' +
        '<div class="int-card int-stat"><div class="val" style="color:var(--amber)">' + (s.unclassified_count || 0) + '</div><div class="lbl">Неразнесённых</div></div>' +
      '</div>' +

      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
        '<button class="btn primary" id="btnUploadBank">📥 Загрузить выписку</button>' +
        '<button class="btn ghost" id="btnExport1c">📤 Экспорт в 1С</button>' +
        '<button class="btn ghost" id="btnBankRules">⚙️ Правила</button>' +
        '<select class="inp" id="fltBankStatus" style="width:140px"><option value="">Все статусы</option><option value="new">Новые</option><option value="classified">Классиф.</option><option value="confirmed">Подтв.</option><option value="distributed">Разнесённые</option></select>' +
        '<select class="inp" id="fltBankDir" style="width:120px"><option value="">Все</option><option value="income">Доходы</option><option value="expense">Расходы</option></select>' +
        '<input class="inp" id="fltBankSearch" placeholder="Поиск..." style="width:160px"/>' +
      '</div>' +

      '<div id="bankTxList"></div>' +
      '<div style="display:flex;gap:8px;margin-top:8px">' +
        '<button class="btn mini ghost" id="btnBulkClassify" disabled>Классифицировать выбранные</button>' +
        '<button class="btn mini ghost" id="btnBulkDistribute" disabled>Разнести выбранные</button>' +
      '</div>' +
    '</div>';

    loadBankTx();

    var fS = document.getElementById('fltBankStatus');
    var fD = document.getElementById('fltBankDir');
    var fQ = document.getElementById('fltBankSearch');
    if(fS) fS.onchange = loadBankTx;
    if(fD) fD.onchange = loadBankTx;
    if(fQ) { var t; fQ.oninput = function(){ clearTimeout(t); t = setTimeout(loadBankTx, 400); }; }

    document.getElementById('btnUploadBank')?.addEventListener('click', openBankUpload);
    document.getElementById('btnExport1c')?.addEventListener('click', async function() {
      var auth = await AsgardAuth.getAuth();
      window.open('/api/integrations/bank/export/1c?date_from=2020-01-01&date_to=2030-12-31', '_blank');
    });
    document.getElementById('btnBankRules')?.addEventListener('click', openBankRules);
  }

  async function loadBankTx() {
    var list = document.getElementById('bankTxList');
    if (!list) return;
    var s = document.getElementById('fltBankStatus')?.value || '';
    var d = document.getElementById('fltBankDir')?.value || '';
    var q = document.getElementById('fltBankSearch')?.value || '';
    var params = '?limit=100';
    if (s) params += '&status=' + s;
    if (d) params += '&direction=' + d;
    if (q) params += '&search=' + encodeURIComponent(q);

    var data = await api('/bank/transactions' + params);
    if (!data.success || !data.items?.length) { list.innerHTML = '<div class="help" style="text-align:center;padding:20px">Нет транзакций</div>'; return; }

    list.innerHTML = '<div style="display:grid;grid-template-columns:30px 90px 100px 1fr 120px 100px 80px;gap:8px;padding:8px 12px;font-size:11px;font-weight:700;border-bottom:2px solid var(--line)">' +
      '<div><input type="checkbox" id="chkAllTx"/></div><div>Дата</div><div>Сумма</div><div>Контрагент</div><div>Статья</div><div>Проект</div><div>Статус</div></div>' +
      data.items.map(function(tx) {
        var st = TX_STATUS[tx.status] || TX_STATUS.new;
        var bg = tx.status === 'new' ? 'rgba(234,179,8,0.06)' : tx.status === 'distributed' ? 'rgba(16,185,129,0.06)' : '';
        return '<div class="tx-row" style="grid-template-columns:30px 90px 100px 1fr 120px 100px 80px;background:'+bg+'" data-id="'+tx.id+'">' +
          '<div><input type="checkbox" class="tx-chk" data-id="'+tx.id+'"/></div>' +
          '<div>'+(tx.transaction_date ? AsgardUI.formatDate(tx.transaction_date) : '—')+'</div>' +
          '<div style="font-weight:700;color:'+(tx.direction==='income'?'var(--ok-t)':'var(--err-t)')+'">'+(tx.direction==='income'?'+':'-')+money(tx.amount).replace('₽','')+'</div>' +
          '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(tx.payment_purpose)+'">'+esc(tx.counterparty_name || '—')+'</div>' +
          '<div style="font-size:11px">'+(ARTICLES[tx.article] || tx.article || '<span style="color:var(--amber)">—</span>')+'</div>' +
          '<div style="font-size:11px">'+(tx.work_number || '—')+'</div>' +
          '<div><span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;background:'+st.c+'22;color:'+st.c+'">'+st.l+'</span></div>' +
        '</div>';
      }).join('') +
      '<div class="help" style="padding:8px;font-size:11px">Показано '+data.items.length+' из '+data.total+'</div>';

    document.getElementById('chkAllTx')?.addEventListener('change', function(e) {
      document.querySelectorAll('.tx-chk').forEach(function(c) { c.checked = e.target.checked; });
      updateBulkBtns();
    });
    document.querySelectorAll('.tx-chk').forEach(function(c) { c.onchange = updateBulkBtns; });
  }

  function updateBulkBtns() {
    var checked = document.querySelectorAll('.tx-chk:checked');
    var btnC = document.getElementById('btnBulkClassify');
    var btnD = document.getElementById('btnBulkDistribute');
    if(btnC) btnC.disabled = !checked.length;
    if(btnD) btnD.disabled = !checked.length;
  }

  function openBankUpload() {
    AsgardUI.showModal('📥 Загрузить выписку',
      '<div style="padding:20px;text-align:center">' +
        '<div id="bankDropZone" style="padding:40px;border:2px dashed var(--line);border-radius:6px;cursor:pointer;transition:.2s">' +
          '<div style="font-size:40px;margin-bottom:8px">📄</div>' +
          '<div style="font-size:14px;font-weight:600">Перетащите файл или нажмите</div>' +
          '<div class="help" style="margin-top:4px">CSV, TXT (1С, Тинькофф, Сбер, Точка)</div>' +
          '<input type="file" id="bankFileInput" accept=".csv,.txt" style="display:none"/>' +
        '</div>' +
        '<div id="bankUploadResult" style="margin-top:16px;display:none"></div>' +
      '</div>'
    );

    var zone = document.getElementById('bankDropZone');
    var inp = document.getElementById('bankFileInput');
    if(zone) {
      zone.addEventListener('click', function(){ inp?.click(); });
      zone.addEventListener('dragover', function(e){ e.preventDefault(); zone.style.borderColor='var(--gold)'; });
      zone.addEventListener('dragleave', function(){ zone.style.borderColor='var(--line)'; });
      zone.addEventListener('drop', function(e){ e.preventDefault(); zone.style.borderColor='var(--line)'; if(e.dataTransfer.files.length) doUpload(e.dataTransfer.files[0]); });
    }
    if(inp) inp.addEventListener('change', function(){ if(inp.files.length) doUpload(inp.files[0]); });

    async function doUpload(file) {
      var zone = document.getElementById('bankDropZone');
      if(zone) zone.innerHTML = '<div style="font-size:14px;color:var(--text-muted)">⏳ Обработка '+esc(file.name)+'...</div>';
      var auth = await AsgardAuth.getAuth();
      var fd = new FormData();
      fd.append('file', file);
      try {
        var resp = await fetch('/api/integrations/bank/upload', { method:'POST', headers:{'Authorization':'Bearer '+auth.token}, body:fd });
        var r = await resp.json();
        var res = document.getElementById('bankUploadResult');
        if (r.success && res) {
          res.style.display = 'block';
          res.innerHTML = '<div class="int-card" style="text-align:left">' +
            '<div style="font-weight:700;margin-bottom:8px">✅ Загружено! Формат: '+esc(r.format)+'</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">' +
              '<div>Всего строк: <b>'+r.stats.total+'</b></div>' +
              '<div>Новых: <b style="color:var(--ok-t)">'+r.stats.new+'</b></div>' +
              '<div>Дубликатов: <b style="color:var(--err-t)">'+r.stats.duplicates+'</b></div>' +
              '<div>Авто-классиф.: <b style="color:var(--info)">'+r.stats.auto+'</b></div>' +
              '<div>Требуют разноски: <b style="color:var(--amber)">'+r.stats.manual+'</b></div>' +
            '</div>' +
          '</div>';
          AsgardUI.toast('Импорт', r.stats.new+' новых транзакций загружено');
        } else {
          if(zone) zone.innerHTML = '<div style="color:var(--red)">Ошибка: '+ esc(r.error || 'Неизвестная') +'</div>';
        }
      } catch(e) {
        if(zone) zone.innerHTML = '<div style="color:var(--red)">Ошибка загрузки</div>';
      }
    }
  }

  async function openBankRules() {
    var data = await api('/bank/rules');
    var items = data.items || [];
    var html = '<div style="max-height:400px;overflow:auto">' +
      items.map(function(r) {
        return '<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);font-size:12px">' +
          '<div style="flex:1;font-weight:600">'+esc(r.pattern)+'</div>' +
          '<div style="width:70px">'+(r.direction || 'все')+'</div>' +
          '<div style="width:100px">'+(ARTICLES[r.article]||r.article)+'</div>' +
          '<div style="width:40px;text-align:right">'+(r.usage_count||0)+'</div>' +
          '<div style="width:20px">'+(r.is_system?'🔒':'')+'</div>' +
        '</div>';
      }).join('') +
      (items.length === 0 ? '<div class="help" style="text-align:center;padding:20px">Нет правил</div>' : '') +
    '</div>';
    AsgardUI.showModal('⚙️ Правила классификации', html);
  }


  // ═══════════════════════════════════════════════════════════════════════
  //  ТАБ 2: ТЕНДЕРНЫЕ ПЛОЩАДКИ
  // ═══════════════════════════════════════════════════════════════════════
  async function renderPlatformsTab(el) {
    var stats = await api('/platforms/stats');
    var s = stats.success ? stats : {};

    el.innerHTML = '<div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px">' +
        '<div class="int-card int-stat"><div class="val" style="color:var(--gold)">'+(s.total||0)+'</div><div class="lbl">Всего парсингов</div></div>' +
        ((s.upcoming_deadlines||[]).length ? '<div class="int-card int-stat"><div class="val" style="color:var(--err-t)">'+s.upcoming_deadlines.length+'</div><div class="lbl">Дедлайнов &lt;7 дней</div></div>' : '') +
      '</div>' +

      ((s.upcoming_deadlines||[]).length ? '<div class="int-card" style="margin-bottom:12px"><div style="font-weight:700;margin-bottom:8px">⏰ Ближайшие дедлайны</div>' +
        s.upcoming_deadlines.map(function(d) {
          return '<div style="padding:4px 0;font-size:12px;display:flex;justify-content:space-between">' +
            '<span>'+esc(d.purchase_number||'—')+' · '+esc(d.customer_name||'—')+'</span>' +
            '<span style="color:var(--err-t);font-weight:700">'+new Date(d.application_deadline).toLocaleDateString('ru-RU')+(d.nmck?' · '+money(d.nmck):'')+'</span>' +
          '</div>';
        }).join('') + '</div>' : '') +

      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
        '<button class="btn primary" id="btnParseBatch">🔄 Обработать новые письма</button>' +
        '<select class="inp" id="fltPlatform" style="width:160px"><option value="">Все площадки</option>' +
          (s.by_platform||[]).map(function(p) { return '<option value="'+esc(p.platform_code)+'">'+esc(p.platform_name)+' ('+p.cnt+')</option>'; }).join('') +
        '</select>' +
        '<input class="inp" id="fltPlatSearch" placeholder="Поиск..." style="width:160px"/>' +
      '</div>' +

      '<div id="platList"></div>' +
    '</div>';

    loadPlatforms();

    document.getElementById('btnParseBatch')?.addEventListener('click', async function() {
      var btn = document.getElementById('btnParseBatch');
      if(btn) { btn.disabled = true; btn.textContent = '⏳ Обработка...'; }
      var r = await api('/platforms/parse-batch', { body: { limit: 100 } });
      if(r.success) AsgardUI.toast('Парсинг', 'Обработано: '+r.success_count+', ошибок: '+r.failed);
      if(btn) { btn.disabled = false; btn.textContent = '🔄 Обработать новые письма'; }
      loadPlatforms();
    });

    var fP = document.getElementById('fltPlatform');
    var fQ = document.getElementById('fltPlatSearch');
    if(fP) fP.onchange = loadPlatforms;
    if(fQ) { var t; fQ.oninput = function(){ clearTimeout(t); t = setTimeout(loadPlatforms, 400); }; }
  }

  async function loadPlatforms() {
    var list = document.getElementById('platList');
    if (!list) return;
    var p = document.getElementById('fltPlatform')?.value || '';
    var q = document.getElementById('fltPlatSearch')?.value || '';
    var params = '?limit=100';
    if (p) params += '&platform_code=' + p;
    if (q) params += '&search=' + encodeURIComponent(q);

    var data = await api('/platforms' + params);
    if (!data.success || !data.items?.length) { list.innerHTML = '<div class="help" style="text-align:center;padding:20px">Нет данных</div>'; return; }

    var relColors = { h:'var(--ok-t)', m:'var(--amber)', l:'var(--err-t)' };

    list.innerHTML = data.items.map(function(it) {
      var score = it.ai_relevance_score || 0;
      var relC = score >= 70 ? relColors.h : score >= 40 ? relColors.m : relColors.l;
      var dl = it.application_deadline ? new Date(it.application_deadline).toLocaleDateString('ru-RU') : '—';
      return '<div class="int-card" style="cursor:pointer;display:grid;grid-template-columns:8px 120px 1fr 100px 100px 80px;gap:12px;align-items:center;padding:12px 16px" data-plat-id="'+it.id+'">' +
        '<div style="width:8px;height:8px;border-radius:50%;background:'+relC+'"></div>' +
        '<div style="font-size:11px;color:var(--text-muted)">'+esc(it.platform_name||'—')+'</div>' +
        '<div><div style="font-weight:600;font-size:13px">'+esc(it.customer_name||it.email_subject||'—')+'</div><div class="help" style="font-size:11px">'+esc((it.object_description||'').slice(0,60))+'</div></div>' +
        '<div style="font-size:12px;font-weight:700">'+(it.nmck?money(it.nmck):'—')+'</div>' +
        '<div style="font-size:12px;color:var(--err-t)">'+dl+'</div>' +
        '<div style="font-size:11px">'+score+'%</div>' +
      '</div>';
    }).join('');

    document.querySelectorAll('[data-plat-id]').forEach(function(el) {
      el.addEventListener('click', function() { openPlatformDetail(el.dataset.platId); });
    });
  }

  async function openPlatformDetail(id) {
    var d = await api('/platforms/' + id);
    if (!d.success) return;
    var it = d.item;
    var score = it.ai_relevance_score || 0;
    var relC = score >= 70 ? 'var(--ok-t)' : score >= 40 ? 'var(--amber)' : 'var(--err-t)';

    var html = '<div style="max-width:650px">' +
      '<div class="int-card">' +
        '<div style="font-weight:700;margin-bottom:8px">'+esc(it.platform_name || '')+'</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">' +
          '<div><b>Номер:</b> '+esc(it.purchase_number||'—')+'</div>' +
          '<div><b>Метод:</b> '+esc(it.purchase_method||'—')+'</div>' +
          '<div><b>Заказчик:</b> '+esc(it.customer_name||'—')+'</div>' +
          '<div><b>ИНН:</b> '+esc(it.customer_inn||'—')+'</div>' +
          '<div><b>НМЦ:</b> '+(it.nmck?money(it.nmck):'—')+'</div>' +
          '<div><b>Дедлайн:</b> '+(it.application_deadline?new Date(it.application_deadline).toLocaleString('ru-RU'):'—')+'</div>' +
        '</div>' +
        (it.object_description ? '<div style="margin-top:8px;font-size:12px"><b>Предмет:</b> '+esc(it.object_description)+'</div>' : '') +
        (it.purchase_url ? '<div style="margin-top:8px"><a href="'+esc(it.purchase_url)+'" target="_blank" class="btn mini ghost">🔗 Открыть на площадке</a></div>' : '') +
      '</div>' +

      (it.ai_analysis ? '<div class="int-card" style="border-left:3px solid '+relC+'">' +
        '<div style="font-weight:700;margin-bottom:8px">🤖 AI-анализ (релевантность: '+score+'%)</div>' +
        '<div style="font-size:12px;line-height:1.5">'+esc(it.ai_analysis)+'</div>' +
        '<div style="margin-top:8px;background:var(--bg-elevated);border-radius:6px;height:8px;overflow:hidden"><div style="height:100%;width:'+score+'%;background:'+relC+'"></div></div>' +
      '</div>' : '') +

      '<div style="display:flex;gap:8px;margin-top:12px">' +
        '<button class="btn primary" id="btnCreatePT">📋 Создать заявку</button>' +
        (it.email_id ? '<a href="#/mailbox?email='+it.email_id+'" class="btn ghost">📧 Письмо</a>' : '') +
      '</div>' +
    '</div>';

    AsgardUI.showModal('Результат парсинга #'+id, html);
    document.getElementById('btnCreatePT')?.addEventListener('click', async function() {
      var btn = document.getElementById('btnCreatePT');
      if(btn) { btn.disabled = true; btn.textContent = '⏳...'; }
      var r = await api('/platforms/'+id+'/create-pre-tender', { body: {} });
      if (r.success) {
        AsgardUI.toast('Создана', 'Заявка #'+r.pre_tender_id);
        AsgardUI.hideModal();
      } else {
        AsgardUI.toast('Ошибка', r.error || '', 'err');
        if(btn) { btn.disabled = false; btn.textContent = '📋 Создать заявку'; }
      }
    });
  }


  // ═══════════════════════════════════════════════════════════════════════
  //  ТАБ 3: ERP
  // ═══════════════════════════════════════════════════════════════════════
  async function renderERPTab(el) {
    var data = await api('/erp/connections');
    var conns = data.items || [];
    var logData = await api('/erp/sync-log?limit=10');
    var logs = logData.items || [];

    el.innerHTML = '<div>' +
      '<div style="display:flex;gap:8px;margin-bottom:16px">' +
        '<button class="btn primary" id="btnAddERP">+ Добавить подключение</button>' +
      '</div>' +

      (conns.length ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:20px">' +
        conns.map(function(c) {
          var icon = c.erp_type === '1c' ? '🟡' : c.erp_type === 'sap' ? '🔵' : c.erp_type === 'galaxy' ? '🟣' : '⚙️';
          var statusColor = c.last_sync_status === 'ok' ? 'var(--ok-t)' : c.last_sync_status === 'error' ? 'var(--err-t)' : 'var(--t2)';
          return '<div class="int-card">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
              '<span style="font-size:18px">'+icon+' <b>'+esc(c.name)+'</b></span>' +
              '<span style="width:10px;height:10px;border-radius:50%;background:'+statusColor+'"></span>' +
            '</div>' +
            '<div style="font-size:12px;color:var(--text-muted)">Тип: '+esc(c.erp_type)+' · '+esc(c.sync_direction)+'</div>' +
            (c.last_sync_at ? '<div style="font-size:11px;color:var(--text-muted)">Синхр.: '+new Date(c.last_sync_at).toLocaleString('ru-RU')+'</div>' : '') +
            (c.last_sync_error ? '<div style="font-size:11px;color:var(--err-t)">'+esc(c.last_sync_error)+'</div>' : '') +
            '<div style="display:flex;gap:6px;margin-top:10px">' +
              '<button class="btn mini ghost" data-test-conn="'+c.id+'">🔌 Тест</button>' +
              '<button class="btn mini ghost" data-export-conn="'+c.id+'">📤 Экспорт</button>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' : '<div class="help" style="text-align:center;padding:20px">Нет ERP-подключений</div>') +

      (logs.length ? '<div class="int-card"><div style="font-weight:700;margin-bottom:8px">📋 Последние синхронизации</div>' +
        logs.map(function(l) {
          var sc = l.status === 'completed' ? 'var(--ok-t)' : l.status === 'failed' ? 'var(--err-t)' : 'var(--amber)';
          return '<div style="padding:6px 0;border-bottom:1px solid var(--line);font-size:12px;display:flex;justify-content:space-between">' +
            '<span>'+esc(l.connection_name||'—')+' · '+esc(l.entity_type)+' · '+esc(l.direction)+'</span>' +
            '<span><span style="color:'+sc+'">'+esc(l.status)+'</span> · '+l.records_success+'/'+l.records_total+' · '+new Date(l.started_at).toLocaleDateString('ru-RU')+'</span>' +
          '</div>';
        }).join('') +
      '</div>' : '') +
    '</div>';

    document.getElementById('btnAddERP')?.addEventListener('click', openAddERPModal);
    document.querySelectorAll('[data-test-conn]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        btn.disabled = true; btn.textContent = '⏳...';
        var r = await api('/erp/connections/'+btn.dataset.testConn+'/test', { body: {} });
        AsgardUI.toast('Тест', r.success ? 'OK: '+r.status : 'Ошибка: '+(r.error||''));
        btn.disabled = false; btn.textContent = '🔌 Тест';
      });
    });
    document.querySelectorAll('[data-export-conn]').forEach(function(btn) {
      btn.addEventListener('click', function() { openExportModal(btn.dataset.exportConn); });
    });
  }

  function openAddERPModal() {
    AsgardUI.showModal('+ Добавить ERP-подключение',
      '<div style="display:grid;gap:12px">' +
        '<div><label style="font-size:12px;font-weight:600">Название</label><input id="erpName" class="inp" placeholder="1С Бухгалтерия"/></div>' +
        '<div><label style="font-size:12px;font-weight:600">Тип</label><select id="erpType" class="inp"><option value="1c">1С</option><option value="sap">SAP</option><option value="galaxy">Галактика</option><option value="custom">Custom</option></select></div>' +
        '<div><label style="font-size:12px;font-weight:600">URL API</label><input id="erpUrl" class="inp" placeholder="http://..."/></div>' +
        '<div><label style="font-size:12px;font-weight:600">Направление</label><select id="erpDir" class="inp"><option value="both">Двустороннее</option><option value="export">Только экспорт</option><option value="import">Только импорт</option></select></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button><button class="btn primary" id="erpSaveBtn">Сохранить</button></div>' +
      '</div>'
    );
    document.getElementById('erpSaveBtn')?.addEventListener('click', async function() {
      var r = await api('/erp/connections', { body: {
        name: document.getElementById('erpName')?.value,
        erp_type: document.getElementById('erpType')?.value,
        connection_url: document.getElementById('erpUrl')?.value || null,
        sync_direction: document.getElementById('erpDir')?.value
      }});
      if (r.success) { AsgardUI.toast('Создано', 'Подключение добавлено'); AsgardUI.hideModal(); renderERPTab(document.getElementById('tabContent')); }
      else AsgardUI.toast('Ошибка', r.error || '', 'err');
    });
  }

  function openExportModal(connId) {
    AsgardUI.showModal('📤 Экспорт данных',
      '<div style="display:grid;gap:12px">' +
        '<div><label style="font-size:12px;font-weight:600">Тип данных</label><select id="expType" class="inp"><option value="payroll">Зарплата</option><option value="bank">Банковские операции</option><option value="tenders">Тендеры</option></select></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><label style="font-size:12px;font-weight:600">С</label><input id="expFrom" type="date" class="inp"/></div><div><label style="font-size:12px;font-weight:600">По</label><input id="expTo" type="date" class="inp"/></div></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button><button class="btn primary" id="expRunBtn">Экспортировать</button></div>' +
      '</div>'
    );
    document.getElementById('expRunBtn')?.addEventListener('click', async function() {
      var btn = document.getElementById('expRunBtn');
      if(btn) { btn.disabled = true; btn.textContent = '⏳...'; }
      var r = await api('/erp/connections/'+connId+'/export', { body: {
        entity_type: document.getElementById('expType')?.value,
        date_from: document.getElementById('expFrom')?.value || null,
        date_to: document.getElementById('expTo')?.value || null
      }});
      if (r.success) AsgardUI.toast('Экспорт', r.records+' записей выгружено');
      else AsgardUI.toast('Ошибка', r.error || '', 'err');
      AsgardUI.hideModal();
    });
  }


  return { render };
})();
