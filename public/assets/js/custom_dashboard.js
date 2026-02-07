/**
 * АСГАРД CRM — Настраиваемый дашборд
 * Этап 40
 */
window.AsgardCustomDashboard = (function(){
  
  const WIDGET_TYPES = {
    welcome: { name: 'Приветствие', icon: '👋', size: 'normal', roles: ['*'], render: renderWelcome },
    notifications: { name: 'Уведомления', icon: '🔔', size: 'normal', roles: ['*'], render: renderNotifications },
    my_works: { name: 'Мои работы', icon: '🔧', size: 'normal', roles: ['PM','HEAD_PM'], render: renderMyWorks },
    tenders_funnel: { name: 'Воронка', icon: '📊', size: 'normal', roles: ['ADMIN','TO','HEAD_TO','PM','DIRECTOR_*'], render: renderFunnel },
    money_summary: { name: 'Финансы', icon: '💰', size: 'normal', roles: ['ADMIN','DIRECTOR_*'], render: renderMoney },
    equipment_value: { name: 'Стоимость ТМЦ', icon: '📦', size: 'normal', roles: ['ADMIN','CHIEF_ENGINEER','DIRECTOR_*'], render: renderEquipmentValue },
    birthdays: { name: 'Дни рождения', icon: '🎂', size: 'normal', roles: ['*'], render: renderBirthdays },
    approvals: { name: 'Согласования', icon: '✅', size: 'normal', roles: ['ADMIN','HEAD_PM','DIRECTOR_*'], render: renderApprovals },
    calendar: { name: 'Календарь', icon: '📅', size: 'normal', roles: ['*'], render: renderCalendar },
    quick_actions: { name: 'Быстрые действия', icon: '⚡', size: 'normal', roles: ['*'], render: renderQuickActions },
    receipt_scanner: { name: 'Сканер чеков', icon: '📷', size: 'normal', roles: ['PM','HEAD_PM'], render: renderReceiptScanner },
    call_toggle: { name: 'Приём звонков', icon: '📞', size: 'normal', roles: ['*'], render: renderCallToggle },
    // ─── M16: Новые виджеты ───
    overdue_works: {
      name: 'Просроченные работы', icon: '⚠️', size: 'wide',
      roles: ['ADMIN','PM','HEAD_PM','DIRECTOR_*'], render: renderOverdueWorks
    },
    permits_expiry: {
      name: 'Истекающие допуски', icon: '🛡️', size: 'normal',
      roles: ['ADMIN','HR','HR_MANAGER','HEAD_TO','CHIEF_ENGINEER','DIRECTOR_*'], render: renderPermitsExpiry
    },
    team_workload: {
      name: 'Загрузка РП', icon: '📊', size: 'wide',
      roles: ['ADMIN','HEAD_PM','DIRECTOR_*'], render: renderTeamWorkload
    },
    tender_dynamics: {
      name: 'Динамика тендеров', icon: '📈', size: 'wide',
      roles: ['ADMIN','TO','HEAD_TO','DIRECTOR_*'], render: renderTenderDynamics
    },
    kpi_summary: {
      name: 'KPI сводка', icon: '🎯', size: 'wide',
      roles: ['ADMIN','DIRECTOR_*'], render: renderKpiSummary
    },
    gantt_mini: {
      name: 'Ближайшие дедлайны', icon: '⏰', size: 'normal',
      roles: ['ADMIN','PM','HEAD_PM','DIRECTOR_*'], render: renderGanttMini
    },
    cash_balance: {
      name: 'Баланс КАССА', icon: '💵', size: 'normal',
      roles: ['ADMIN','BUH','DIRECTOR_*'], render: renderCashBalance
    },
    equipment_alerts: {
      name: 'Оборудование • Алерты', icon: '🔧', size: 'normal',
      roles: ['ADMIN','CHIEF_ENGINEER','WAREHOUSE','DIRECTOR_*'], render: renderEquipmentAlerts
    }
  };

  const DEFAULT_LAYOUTS = {
    ADMIN: ['welcome','kpi_summary','quick_actions','overdue_works','tenders_funnel','notifications'],
    PM: ['welcome','quick_actions','my_works','gantt_mini','notifications','birthdays'],
    TO: ['welcome','quick_actions','tenders_funnel','tender_dynamics','notifications'],
    HEAD_TO: ['welcome','tender_dynamics','tenders_funnel','notifications'],
    HEAD_PM: ['welcome','team_workload','overdue_works','gantt_mini','notifications'],
    CHIEF_ENGINEER: ['welcome','equipment_value','equipment_alerts','notifications'],
    HR: ['welcome','permits_expiry','birthdays','notifications','calendar'],
    HR_MANAGER: ['welcome','permits_expiry','birthdays','team_workload','notifications'],
    BUH: ['welcome','cash_balance','money_summary','notifications'],
    DEFAULT: ['welcome','notifications','calendar','birthdays']
  };

  async function getUserLayout(userId, role) {
    try {
      const s = await AsgardDB.get('settings', 'dash_layout_' + userId);
      if (s?.value_json) return JSON.parse(s.value_json);
    } catch(e) {}
    if (role?.startsWith('DIRECTOR')) return DEFAULT_LAYOUTS.ADMIN;
    // M16: Поддержка новых ролей
    if (DEFAULT_LAYOUTS[role]) return DEFAULT_LAYOUTS[role];
    return DEFAULT_LAYOUTS.DEFAULT;
  }

  async function saveUserLayout(userId, layout) {
    await AsgardDB.put('settings', { key: 'dash_layout_' + userId, value_json: JSON.stringify(layout) });
  }

  async function render({ layout: pageLayout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    const user = auth.user;
    let userLayout = await getUserLayout(user.id, user.role);
    // M16: Расширенная проверка ролей (HEAD_* наследуют виджеты базовых ролей)
    const available = Object.entries(WIDGET_TYPES).filter(([id, w]) => {
      if (w.roles.includes('*')) return true;
      const r = user.role || '';
      return w.roles.some(wr => {
        if (wr.endsWith('*')) return r.startsWith(wr.slice(0, -1));
        if (wr === r) return true;
        // HEAD_TO наследует TO виджеты
        if (r === 'HEAD_TO' && wr === 'TO') return true;
        if (r === 'HEAD_PM' && wr === 'PM') return true;
        if (r === 'HR_MANAGER' && wr === 'HR') return true;
        if (r === 'CHIEF_ENGINEER' && wr === 'WAREHOUSE') return true;
        return false;
      });
    });

    const html = '<div class="custom-dash">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<h2 style="margin:0;color:var(--gold)">Мой дашборд</h2>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn ghost" id="btnAddW">+ Виджет</button>' +
          '<button class="btn ghost" id="btnResetW">↺ Сброс</button>' +
        '</div>' +
      '</div>' +
      '<div class="help" style="margin-bottom:16px;font-size:12px">Перетаскивайте виджеты для изменения порядка</div>' +
      '<div class="dash-grid" id="dashGrid">' +
        userLayout.map(id => {
          const w = WIDGET_TYPES[id];
          if (!w) return '';
          const sizeClass = (w.size === 'wide') ? ' wide' : '';
          return '<div class="dash-widget' + sizeClass + '" data-id="' + id + '" draggable="true">' +
            '<div class="dash-widget-header">' +
              '<span class="drag-handle">☰</span>' +
              '<span>' + w.icon + '</span>' +
              '<span style="flex:1;font-weight:600">' + w.name + '</span>' +
              '<button class="btn-remove" data-id="' + id + '">✕</button>' +
            '</div>' +
            '<div class="dash-widget-content" id="wc_' + id + '">Загрузка...</div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>' +
    '<style>' +
      '.dash-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}' +
      '.dash-widget{background:var(--bg-card);border-radius:16px;border:1px solid var(--line);overflow:hidden;transition:border-color .2s,box-shadow .2s,opacity .2s}' +
      '.dash-widget:hover{border-color:var(--gold)}' +
      '.dash-widget.wide{grid-column:span 2}' +
      '@media(max-width:700px){.dash-widget.wide{grid-column:span 1}}' +
      '.dash-widget-header{padding:12px 16px;background:var(--bg-elevated);display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line)}' +
      '.dash-widget-content{padding:16px;min-height:100px}' +
      '.btn-remove{background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px}' +
      '.btn-remove:hover{color:var(--red)}' +
      '.drag-handle{cursor:grab;color:var(--text-muted);font-size:14px}' +
      '.dash-widget[draggable]{cursor:grab}' +
      '.dash-widget[draggable]:active{cursor:grabbing}' +
      '.dash-widget.drag-over{border-color:var(--gold);box-shadow:0 0 20px rgba(242,208,138,.3)}' +
      '.dash-widget.dragging{opacity:0.4}' +
    '</style>';

    await pageLayout(html, { title: title || 'Мой дашборд' });

    for (const id of userLayout) {
      const w = WIDGET_TYPES[id];
      if (w?.render) {
        const el = document.getElementById('wc_' + id);
        if (el) try { await w.render(el, user); } catch(e) { el.innerHTML = 'Ошибка'; }
      }
    }

    // === M16: Drag & Drop ===
    let dragSrc = null;
    document.querySelectorAll('.dash-widget').forEach(w => {
      w.addEventListener('dragstart', e => {
        dragSrc = w;
        w.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', w.dataset.id);
      });
      w.addEventListener('dragend', () => {
        w.classList.remove('dragging');
        document.querySelectorAll('.dash-widget').forEach(x => x.classList.remove('drag-over'));
      });
      w.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (w !== dragSrc) w.classList.add('drag-over');
      });
      w.addEventListener('dragleave', () => w.classList.remove('drag-over'));
      w.addEventListener('drop', async e => {
        e.preventDefault();
        w.classList.remove('drag-over');
        if (!dragSrc || dragSrc === w) return;
        const fromId = dragSrc.dataset.id;
        const toId = w.dataset.id;
        const fromIdx = userLayout.indexOf(fromId);
        const toIdx = userLayout.indexOf(toId);
        if (fromIdx < 0 || toIdx < 0) return;
        // Swap positions
        userLayout.splice(fromIdx, 1);
        userLayout.splice(toIdx, 0, fromId);
        await saveUserLayout(user.id, userLayout);
        render({ layout: pageLayout, title });
      });
    });

    document.querySelectorAll('.btn-remove').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const newLayout = userLayout.filter(x => x !== id);
        await saveUserLayout(user.id, newLayout);
        render({ layout: pageLayout, title });
      };
    });

    document.getElementById('btnAddW')?.addEventListener('click', () => {
      const curr = new Set(userLayout);
      const avail = available.filter(([id]) => !curr.has(id));
      const html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">' +
        avail.map(([id, w]) =>
          '<div class="widget-pick" data-id="' + id + '" style="padding:16px;border:1px solid var(--line);border-radius:12px;text-align:center;cursor:pointer">' +
            '<div style="font-size:32px">' + w.icon + '</div>' +
            '<div style="font-size:13px;font-weight:600">' + w.name + '</div>' +
            (w.size === 'wide' ? '<div style="font-size:10px;color:var(--text-muted);margin-top:4px">широкий</div>' : '') +
          '</div>'
        ).join('') +
        (avail.length === 0 ? '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted)">Все виджеты добавлены</div>' : '') +
      '</div>';
      AsgardUI.showModal('Добавить виджет', html);
      document.querySelectorAll('.widget-pick').forEach(el => {
        el.onclick = async () => {
          userLayout.push(el.dataset.id);
          await saveUserLayout(user.id, userLayout);
          AsgardUI.hideModal();
          render({ layout: pageLayout, title });
        };
      });
    });

    document.getElementById('btnResetW')?.addEventListener('click', async () => {
      if (!confirm('Сбросить раскладку на стандартную?')) return;
      const def = user.role?.startsWith('DIRECTOR') ? DEFAULT_LAYOUTS.ADMIN : (DEFAULT_LAYOUTS[user.role] || DEFAULT_LAYOUTS.DEFAULT);
      await saveUserLayout(user.id, def);
      render({ layout: pageLayout, title });
    });
  }

  async function renderWelcome(el, user) {
    const h = new Date().getHours();
    let g = 'Доброй ночи'; if (h>=5&&h<12) g='Доброе утро'; else if (h>=12&&h<17) g='Добрый день'; else if (h>=17&&h<22) g='Добрый вечер';
    el.innerHTML = '<div style="display:flex;align-items:center;gap:16px"><div style="font-size:40px">⚔️</div><div><div style="font-size:18px;font-weight:700;color:var(--gold)">' + g + ', ' + esc(user.name?.split(' ')[0]||'воин') + '!</div><div class="help">Пусть удача сопутствует тебе</div></div></div>';
  }

  async function renderNotifications(el, user) {
    const n = (await AsgardDB.byIndex('notifications','user_id',user.id)||[]).filter(x=>!x.is_read).slice(0,5);
    if (!n.length) { el.innerHTML = '<div class="help" style="text-align:center">Нет уведомлений</div>'; return; }
    el.innerHTML = n.map(x=>'<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div style="font-weight:600;font-size:13px">'+esc(x.title)+'</div><div class="help" style="font-size:12px">'+esc((x.message||'').slice(0,50))+'</div></div>').join('');
  }

  async function renderMyWorks(el, user) {
    const w = (await AsgardDB.getAll('works')||[]).filter(x=>x.pm_id===user.id&&x.work_status!=='Завершена').slice(0,5);
    if (!w.length) { el.innerHTML = '<div class="help" style="text-align:center">Нет работ</div>'; return; }
    el.innerHTML = w.map(x=>'<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div style="font-weight:600;font-size:13px">'+esc(x.work_name||x.work_title)+'</div><div class="help">'+esc(x.customer_name)+' · '+esc(x.work_status)+'</div></div>').join('');
  }

  async function renderFunnel(el, user) {
    const t = await AsgardDB.getAll('tenders')||[];
    // Показываем ВСЕ тендеры, без фильтра по периоду
    const total = t.length;
    const sts = [
      {name: 'Новый', color: '#64748b'},
      {name: 'Клиент согласился', color: '#16a34a'},
      {name: 'Клиент отказался', color: '#dc2626'},
      {name: 'Другое', color: '#94a3b8'}
    ];
    const maxCount = Math.max(...sts.map(s => t.filter(x=>x.tender_status===s.name).length), 1);
    el.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px">'+
      '<div class="help" style="margin-bottom:4px">Всего: '+total+' тендеров</div>'+
      sts.map(s=>{
        const c = t.filter(x=>x.tender_status===s.name).length;
        const pct = Math.round((c / maxCount) * 100);
        return '<div style="display:flex;gap:10px;align-items:center">'+
          '<div style="width:110px;font-size:12px;white-space:nowrap">'+s.name+'</div>'+
          '<div style="flex:1;background:var(--bg-elevated);border-radius:4px;height:20px;overflow:hidden">'+
            '<div style="height:100%;width:'+pct+'%;background:'+s.color+';transition:width 0.3s"></div>'+
          '</div>'+
          '<div style="width:35px;text-align:right;font-weight:600">'+c+'</div>'+
        '</div>';
      }).join('')+'</div>';
  }

  async function renderMoney(el, user) {
    const w = await AsgardDB.getAll('works')||[];
    const y = new Date().getFullYear();
    const sum = w.filter(x=>(x.contract_date||'').startsWith(y)).reduce((s,x)=>s+(Number(x.balance_received)||0)+(Number(x.advance_received)||0),0);
    el.innerHTML = '<div style="text-align:center"><div style="font-size:24px;font-weight:700;color:var(--green)">'+formatMoney(sum)+'</div><div class="help">Поступило ('+y+')</div></div>';
  }

  async function renderBirthdays(el, user) {
    const emps = await AsgardDB.getAll('employees')||[];
    const today = new Date();
    const up = emps.filter(e=>e.birth_date).map(e=>{
      const bd = new Date(e.birth_date);
      const ty = new Date(today.getFullYear(),bd.getMonth(),bd.getDate());
      if (ty<today) ty.setFullYear(today.getFullYear()+1);
      return {...e, days:Math.ceil((ty-today)/(1000*60*60*24))};
    }).filter(e=>e.days<=30).sort((a,b)=>a.days-b.days).slice(0,5);
    if (!up.length) { el.innerHTML = '<div class="help" style="text-align:center">Нет ДР</div>'; return; }
    el.innerHTML = up.map(e=>'<div style="padding:8px 0;border-bottom:1px solid var(--line);display:flex;gap:10px"><div style="font-size:24px">🎂</div><div><div style="font-weight:600;font-size:13px">'+esc(e.fio||e.full_name)+'</div><div class="help">'+(e.days===0?'Сегодня!':'Через '+e.days+' дн.')+'</div></div></div>').join('');
  }

  async function renderApprovals(el, user) {
    const b = (await AsgardDB.getAll('bonus_requests')||[]).filter(x=>x.status==='pending');
    el.innerHTML = '<div style="text-align:center"><div style="font-size:48px;font-weight:700;color:'+(b.length?'var(--amber)':'var(--green)')+'">'+b.length+'</div><div class="help">Ожидают</div>'+(b.length?'<a href="#/bonus-approval" class="btn mini" style="margin-top:12px">Перейти</a>':'')+'</div>';
  }

  async function renderCalendar(el, user) {
    const d = new Date();
    el.innerHTML = '<div style="text-align:center"><div style="font-size:14px;color:var(--gold)">'+d.toLocaleString('ru-RU',{month:'long',year:'numeric'})+'</div><div style="font-size:64px;font-weight:700">'+d.getDate()+'</div><div class="help">'+d.toLocaleString('ru-RU',{weekday:'long'})+'</div><a href="#/calendar" class="btn mini ghost" style="margin-top:12px">Календарь</a></div>';
  }

  async function renderQuickActions(el, user) {
    const acts = [];
    if (['ADMIN','TO'].includes(user.role)||user.role?.startsWith('DIRECTOR')) acts.push({i:'📋',l:'Тендер',h:'#/tenders?new=1'});
    if (user.role==='PM') acts.push({i:'📷',l:'Чек',a:'scan'});
    acts.push({i:'💬',l:'Чат',h:'#/chat'});
    el.innerHTML = '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">'+acts.map(a=>
      '<button class="btn ghost" '+(a.h?'onclick="location.hash=\''+a.h+'\'"':'data-action="'+a.a+'"')+' style="flex:1;min-width:80px;flex-direction:column"><span style="font-size:20px">'+a.i+'</span><span style="font-size:11px">'+a.l+'</span></button>'
    ).join('')+'</div>';
    el.querySelector('[data-action="scan"]')?.addEventListener('click',()=>{if(window.AsgardReceiptScanner)AsgardReceiptScanner.openScanner();});
  }

  async function renderReceiptScanner(el, user) {
    el.innerHTML = '<div style="text-align:center"><div style="font-size:48px;margin-bottom:12px">📷</div><button class="btn primary" onclick="if(window.AsgardReceiptScanner)AsgardReceiptScanner.openScanner()" style="width:100%">Сканировать чек</button><div class="help" style="margin-top:8px">Быстрый ввод расходов</div></div>';
  }

  async function renderCallToggle(el, user) {
    if (window.AsgardMango) {
      el.id = 'callToggleWidget_' + user.id;
      AsgardMango.renderCallToggle(el.id);
    } else {
      el.innerHTML = '<div class="help" style="text-align:center">Телефония не загружена</div>';
    }
  }

  async function renderEquipmentValue(el, user) {
    el.innerHTML = '<div style="text-align:center"><div class="help">Загрузка...</div></div>';
    
    try {
      const auth = await AsgardAuth.getAuth();
      const resp = await fetch('/api/equipment/balance-value', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      
      if (!data.success) {
        el.innerHTML = '<div class="help" style="text-align:center">Нет доступа</div>';
        return;
      }
      
      const deprecPercent = data.total_purchase_price > 0 
        ? Math.round((data.total_depreciation / data.total_purchase_price) * 100) 
        : 0;
      
      el.innerHTML = `
        <div style="text-align:center">
          <div style="font-size:28px;font-weight:700;color:var(--gold)">${formatMoney(data.total_book_value)}</div>
          <div class="help" style="margin-bottom:12px">Балансовая стоимость</div>
          
          <div style="display:flex;gap:16px;justify-content:center;font-size:12px">
            <div>
              <div style="font-weight:600;color:var(--text-muted)">Закупка</div>
              <div>${formatMoney(data.total_purchase_price)}</div>
            </div>
            <div>
              <div style="font-weight:600;color:var(--amber)">Амортиз.</div>
              <div>${formatMoney(data.total_depreciation)} (${deprecPercent}%)</div>
            </div>
          </div>
          
          <div style="margin-top:12px;background:var(--bg-elevated);border-radius:6px;height:8px;overflow:hidden">
            <div style="height:100%;width:${100 - deprecPercent}%;background:linear-gradient(90deg,var(--gold),var(--green));transition:width 0.5s"></div>
          </div>
          
          <div style="margin-top:12px;font-size:11px;color:var(--text-muted)">
            ${data.equipment_count} ед. на балансе
            ${data.expiring_soon?.count > 0 ? `<br><span style="color:var(--amber)">⚠️ ${data.expiring_soon.count} скоро истекает</span>` : ''}
            ${data.auto_written_off > 0 ? `<br><span style="color:var(--red)">🗑️ ${data.auto_written_off} автосписано</span>` : ''}
          </div>
          
          <a href="#/warehouse" class="btn mini ghost" style="margin-top:12px">📦 Склад</a>
        </div>
      `;
    } catch(e) {
      el.innerHTML = '<div class="help" style="text-align:center;color:var(--red)">Ошибка загрузки</div>';
    }
  }

  // ─── M16: Рендер новых виджетов ───

  async function renderOverdueWorks(el, user) {
    const works = await AsgardDB.getAll('works') || [];
    const now = new Date();
    const overdue = works.filter(w => {
      if (!w.end_plan) return false;
      if (['Работы сдали','Закрыт'].includes(w.work_status)) return false;
      return new Date(w.end_plan) < now;
    }).sort((a,b) => new Date(a.end_plan) - new Date(b.end_plan)).slice(0, 8);

    if (!overdue.length) {
      el.innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:40px;margin-bottom:8px">✅</div><div class="help">Просроченных работ нет</div></div>';
      return;
    }
    el.innerHTML = '<div style="font-size:12px;color:var(--red);font-weight:700;margin-bottom:8px">⚠️ ' + overdue.length + ' просроченных</div>' +
      overdue.map(w => {
        const days = Math.round((now - new Date(w.end_plan)) / 86400000);
        return '<div style="padding:6px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:8px">' +
          '<div style="font-size:12px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(w.work_title || w.work_name || ('ID ' + w.id)) + '</div>' +
          '<div style="font-size:11px;color:var(--red);white-space:nowrap">+' + days + ' дн.</div>' +
        '</div>';
      }).join('') +
      '<a href="#/all-works" class="btn mini ghost" style="margin-top:8px;font-size:11px">Все работы →</a>';
  }

  async function renderPermitsExpiry(el, user) {
    const permits = await AsgardDB.getAll('permits') || [];
    const now = new Date();
    const soon = permits.filter(p => {
      if (!p.expiry_date) return false;
      const exp = new Date(p.expiry_date);
      const days = Math.round((exp - now) / 86400000);
      return days >= 0 && days <= 30;
    }).sort((a,b) => new Date(a.expiry_date) - new Date(b.expiry_date)).slice(0, 8);

    if (!soon.length) {
      el.innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:40px;margin-bottom:8px">🛡️</div><div class="help">Все допуски в порядке</div></div>';
      return;
    }
    el.innerHTML = '<div style="font-size:12px;color:var(--amber);font-weight:700;margin-bottom:8px">🛡️ ' + soon.length + ' истекают в ближайшие 30 дней</div>' +
      soon.map(p => {
        const days = Math.round((new Date(p.expiry_date) - now) / 86400000);
        const color = days <= 7 ? 'var(--red)' : 'var(--amber)';
        return '<div style="padding:6px 0;border-bottom:1px solid var(--line)">' +
          '<div style="font-size:12px;font-weight:600">' + esc(p.employee_name || p.fio || '') + '</div>' +
          '<div style="display:flex;justify-content:space-between;font-size:11px">' +
            '<span class="help">' + esc(p.permit_type || p.type || '') + '</span>' +
            '<span style="color:' + color + '">' + (days === 0 ? 'Сегодня!' : days + ' дн.') + '</span>' +
          '</div></div>';
      }).join('') +
      '<a href="#/permits" class="btn mini ghost" style="margin-top:8px;font-size:11px">Все допуски →</a>';
  }

  async function renderTeamWorkload(el, user) {
    const works = await AsgardDB.getAll('works') || [];
    const users = await AsgardDB.getAll('users') || [];
    const pms = users.filter(u => u.is_active && (u.role === 'PM' || u.role === 'HEAD_PM'));
    const activeStatuses = ['В работе', 'Мобилизация', 'Подготовка', 'На объекте'];

    const data = pms.map(pm => {
      const pmWorks = works.filter(w => w.pm_id === pm.id && activeStatuses.includes(w.work_status));
      return { name: pm.name, count: pmWorks.length, id: pm.id };
    }).filter(d => d.count > 0).sort((a,b) => b.count - a.count);

    if (!data.length) {
      el.innerHTML = '<div class="help" style="text-align:center;padding:20px">Нет активных работ</div>';
      return;
    }
    const max = Math.max(...data.map(d => d.count), 1);
    el.innerHTML = data.map(d => {
      const pct = Math.round((d.count / max) * 100);
      const color = d.count > 5 ? '#f44336' : d.count > 3 ? '#ff9800' : '#4caf50';
      return '<div style="display:flex;align-items:center;gap:10px;margin:6px 0">' +
        '<div style="width:90px;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc((d.name || '').split(' ')[0]) + '</div>' +
        '<div style="flex:1;background:var(--bg-elevated);border-radius:4px;height:16px;overflow:hidden">' +
          '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:4px;transition:width .3s"></div>' +
        '</div>' +
        '<div style="width:24px;text-align:right;font-weight:700;font-size:13px">' + d.count + '</div>' +
      '</div>';
    }).join('');
  }

  async function renderTenderDynamics(el, user) {
    const tenders = await AsgardDB.getAll('tenders') || [];
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const label = d.toLocaleDateString('ru-RU', { month: 'short' });
      const mTenders = tenders.filter(t => (t.period || '').startsWith(key) || (t.created_at || '').startsWith(key));
      const won = mTenders.filter(t => ['Выиграли','Контракт','Клиент согласился'].includes(t.tender_status)).length;
      months.push({ label, total: mTenders.length, won });
    }
    const max = Math.max(...months.map(m => m.total), 1);
    el.innerHTML = '<div style="display:flex;align-items:flex-end;gap:6px;height:100px;padding-top:8px">' +
      months.map(m => {
        const h = Math.max(4, Math.round((m.total / max) * 80));
        const wh = m.total > 0 ? Math.round((m.won / m.total) * h) : 0;
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">' +
          '<div style="font-size:10px;font-weight:700">' + m.total + '</div>' +
          '<div style="width:100%;height:' + h + 'px;border-radius:4px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end">' +
            '<div style="height:' + (h - wh) + 'px;background:#5c6bc0"></div>' +
            '<div style="height:' + wh + 'px;background:#4caf50"></div>' +
          '</div>' +
          '<div style="font-size:10px;color:var(--text-muted)">' + esc(m.label) + '</div>' +
        '</div>';
      }).join('') +
    '</div>' +
    '<div style="display:flex;gap:12px;margin-top:8px;font-size:10px">' +
      '<span><span style="display:inline-block;width:8px;height:8px;background:#5c6bc0;border-radius:2px;margin-right:4px"></span>Всего</span>' +
      '<span><span style="display:inline-block;width:8px;height:8px;background:#4caf50;border-radius:2px;margin-right:4px"></span>Выиграно</span>' +
    '</div>';
  }

  async function renderKpiSummary(el, user) {
    const [tenders, works] = await Promise.all([
      AsgardDB.getAll('tenders') || [],
      AsgardDB.getAll('works') || []
    ]);
    const y = new Date().getFullYear();
    const yTenders = tenders.filter(t => String(t.year) === String(y) || (t.period || '').startsWith(y));
    const yWorks = works.filter(w => {
      const d = w.work_start_fact || w.work_start_plan || w.created_at;
      return d && new Date(d).getFullYear() === y;
    });
    const won = yTenders.filter(t => ['Выиграли','Контракт','Клиент согласился'].includes(t.tender_status)).length;
    const conv = yTenders.length > 0 ? Math.round((won / yTenders.length) * 100) : 0;
    const revenue = yWorks.reduce((s, w) => s + (Number(w.contract_sum) || Number(w.contract_value) || 0), 0);
    const done = yWorks.filter(w => w.work_status === 'Работы сдали').length;

    el.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<div style="text-align:center;padding:8px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:800">Тендеров</div><div style="font-size:24px;font-weight:900;color:#60a5fa">' + yTenders.length + '</div></div>' +
      '<div style="text-align:center;padding:8px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:800">Конверсия</div><div style="font-size:24px;font-weight:900;color:#4caf50">' + conv + '%</div></div>' +
      '<div style="text-align:center;padding:8px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:800">Выручка</div><div style="font-size:18px;font-weight:900;color:var(--gold)">' + formatMoney(revenue) + '</div></div>' +
      '<div style="text-align:center;padding:8px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:800">Сдано работ</div><div style="font-size:24px;font-weight:900;color:#22c55e">' + done + '/' + yWorks.length + '</div></div>' +
    '</div>';
  }

  async function renderGanttMini(el, user) {
    const works = await AsgardDB.getAll('works') || [];
    const now = new Date();
    const soon = works.filter(w => {
      if (!w.end_plan) return false;
      if (['Работы сдали','Закрыт'].includes(w.work_status)) return false;
      const d = new Date(w.end_plan);
      const days = Math.round((d - now) / 86400000);
      return days >= 0 && days <= 30;
    }).sort((a, b) => new Date(a.end_plan) - new Date(b.end_plan)).slice(0, 6);

    if (!soon.length) {
      el.innerHTML = '<div class="help" style="text-align:center;padding:20px">Нет дедлайнов в ближайшие 30 дней</div>';
      return;
    }
    el.innerHTML = soon.map(w => {
      const days = Math.round((new Date(w.end_plan) - now) / 86400000);
      const color = days <= 3 ? 'var(--red)' : days <= 7 ? 'var(--amber)' : 'var(--text-muted)';
      return '<div style="padding:6px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:8px">' +
        '<div style="font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(w.work_title || w.work_name || '') + '</div>' +
        '<div style="font-size:11px;font-weight:700;color:' + color + ';white-space:nowrap">' + days + ' дн.</div>' +
      '</div>';
    }).join('') +
    '<a href="#/gantt-works" class="btn mini ghost" style="margin-top:8px;font-size:11px">Гантт →</a>';
  }

  async function renderCashBalance(el, user) {
    try {
      const cashRecords = await AsgardDB.getAll('cash_advances') || [];
      const pending = cashRecords.filter(r => r.status === 'pending' || r.status === 'issued').length;
      const totalIssued = cashRecords.filter(r => r.status === 'issued').reduce((s, r) => s + (Number(r.amount) || 0), 0);
      el.innerHTML = '<div style="text-align:center">' +
        '<div style="font-size:28px;font-weight:700;color:var(--gold)">' + formatMoney(totalIssued) + '</div>' +
        '<div class="help">Выдано (не закрыто)</div>' +
        '<div style="margin-top:12px;font-size:13px;color:var(--amber);font-weight:600">' + pending + ' заявок в обработке</div>' +
      '</div>';
    } catch(e) {
      el.innerHTML = '<div class="help" style="text-align:center">Нет данных КАССА</div>';
    }
  }

  async function renderEquipmentAlerts(el, user) {
    try {
      const auth = AsgardAuth.getAuth();
      const resp = await fetch('/api/equipment/maintenance/upcoming', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      const items = (data.items || data.equipment || data || []).slice(0, 5);
      if (!items.length) {
        el.innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:40px;margin-bottom:8px">✅</div><div class="help">Всё обслужено</div></div>';
        return;
      }
      el.innerHTML = '<div style="font-size:12px;color:var(--amber);font-weight:700;margin-bottom:8px">🔧 Требуется ТО</div>' +
        items.map(i => '<div style="padding:5px 0;border-bottom:1px solid var(--line);font-size:12px">' +
          '<div style="font-weight:600">' + esc(i.name || i.equipment_name || '') + '</div>' +
          '<div class="help">' + esc(i.next_maintenance_date ? new Date(i.next_maintenance_date).toLocaleDateString('ru-RU') : '—') + '</div>' +
        '</div>').join('') +
        '<a href="#/warehouse" class="btn mini ghost" style="margin-top:8px;font-size:11px">Склад →</a>';
    } catch(e) {
      el.innerHTML = '<div class="help" style="text-align:center">Ошибка загрузки</div>';
    }
  }

  function esc(s){return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function formatMoney(n){return new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n||0);}

  return { render, WIDGET_TYPES };
})();
