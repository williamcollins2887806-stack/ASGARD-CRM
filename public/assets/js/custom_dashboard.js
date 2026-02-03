/**
 * АСГАРД CRM — Настраиваемый дашборд
 * Этап 40
 */
window.AsgardCustomDashboard = (function(){
  
  const WIDGET_TYPES = {
    welcome: { name: 'Приветствие', icon: '👋', roles: ['*'], render: renderWelcome },
    notifications: { name: 'Уведомления', icon: '🔔', roles: ['*'], render: renderNotifications },
    my_works: { name: 'Мои работы', icon: '🔧', roles: ['PM'], render: renderMyWorks },
    tenders_funnel: { name: 'Воронка', icon: '📊', roles: ['ADMIN','TO','PM','DIRECTOR_*'], render: renderFunnel },
    money_summary: { name: 'Финансы', icon: '💰', roles: ['ADMIN','DIRECTOR_*'], render: renderMoney },
    equipment_value: { name: 'Стоимость ТМЦ', icon: '📦', roles: ['ADMIN','DIRECTOR_*'], render: renderEquipmentValue },
    birthdays: { name: 'Дни рождения', icon: '🎂', roles: ['*'], render: renderBirthdays },
    approvals: { name: 'Согласования', icon: '✅', roles: ['ADMIN','DIRECTOR_*'], render: renderApprovals },
    calendar: { name: 'Календарь', icon: '📅', roles: ['*'], render: renderCalendar },
    quick_actions: { name: 'Быстрые действия', icon: '⚡', roles: ['*'], render: renderQuickActions },
    receipt_scanner: { name: 'Сканер чеков', icon: '📷', roles: ['PM'], render: renderReceiptScanner },
    call_toggle: { name: 'Приём звонков', icon: '📞', roles: ['*'], render: renderCallToggle }
  };

  const DEFAULT_LAYOUTS = {
    ADMIN: ['welcome','quick_actions','money_summary','approvals','tenders_funnel','notifications'],
    PM: ['welcome','quick_actions','my_works','notifications','birthdays'],
    DEFAULT: ['welcome','notifications','calendar','birthdays']
  };

  async function getUserLayout(userId, role) {
    try {
      const s = await AsgardDB.get('settings', 'dash_layout_' + userId);
      if (s?.value_json) return JSON.parse(s.value_json);
    } catch(e) {}
    if (role?.startsWith('DIRECTOR')) return DEFAULT_LAYOUTS.ADMIN;
    return DEFAULT_LAYOUTS[role] || DEFAULT_LAYOUTS.DEFAULT;
  }

  async function saveUserLayout(userId, layout) {
    await AsgardDB.put('settings', { key: 'dash_layout_' + userId, value_json: JSON.stringify(layout) });
  }

  async function render({ layout: pageLayout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    const user = auth.user;
    const userLayout = await getUserLayout(user.id, user.role);
    const available = Object.entries(WIDGET_TYPES).filter(([id, w]) => 
      w.roles.includes('*') || w.roles.some(r => r.endsWith('*') ? user.role?.startsWith(r.slice(0,-1)) : r === user.role)
    );

    const html = '<div class="custom-dash">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<h2 style="margin:0;color:var(--gold)">Мой дашборд</h2>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn ghost" id="btnAddW">+ Виджет</button>' +
          '<button class="btn ghost" id="btnResetW">↺ Сброс</button>' +
        '</div>' +
      '</div>' +
      '<div class="dash-grid" id="dashGrid">' +
        userLayout.map(id => {
          const w = WIDGET_TYPES[id];
          if (!w) return '';
          return '<div class="dash-widget" data-id="' + id + '">' +
            '<div class="dash-widget-header">' +
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
      '.dash-widget{background:var(--bg-card);border-radius:16px;border:1px solid var(--line);overflow:hidden}' +
      '.dash-widget:hover{border-color:var(--gold)}' +
      '.dash-widget-header{padding:12px 16px;background:var(--bg-elevated);display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line)}' +
      '.dash-widget-content{padding:16px;min-height:100px}' +
      '.btn-remove{background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px}' +
      '.btn-remove:hover{color:var(--red)}' +
    '</style>';

    await pageLayout(html, { title: title || 'Мой дашборд' });

    for (const id of userLayout) {
      const w = WIDGET_TYPES[id];
      if (w?.render) {
        const el = document.getElementById('wc_' + id);
        if (el) try { await w.render(el, user); } catch(e) { el.innerHTML = 'Ошибка'; }
      }
    }

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
      if (!confirm('Сбросить?')) return;
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

  function esc(s){return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function formatMoney(n){return new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n||0);}

  return { render, WIDGET_TYPES };
})();
