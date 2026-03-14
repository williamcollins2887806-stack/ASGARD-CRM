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
    telephony_status: { name: 'Телефония', icon: '📞', size: 'normal', roles: ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','PM','HEAD_PM','TO','HEAD_TO','BUH'], render: renderTelephonyStatus },
    // ─── M16: Новые виджеты ───
    overdue_works: {
      name: 'Просроченные работы', icon: '⚠️', size: 'wide',
      roles: ['ADMIN','PM','HEAD_PM','DIRECTOR_*'], render: renderOverdueWorks
    },
    permits_expiry: {
      name: 'Истекающие допуски', icon: '🛡️', size: 'wide',
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
    },
    payroll_pending: {
      name: 'Ведомости (ожидание)', icon: '💰', size: 'normal',
      roles: ['ADMIN','BUH','PM','HEAD_PM','DIRECTOR_*'], render: renderPayrollPending
    },
    todo: {
      name: 'Мои задачи', icon: '✅', size: 'normal',
      roles: ['*'], render: renderTodo
    },
    pre_tenders: {
      name: 'Заявки', icon: '📨', size: 'normal',
      roles: ['ADMIN','HEAD_TO','DIRECTOR_*'], render: renderPreTenders
    },
    // ─── Phase 10: Интеграции ───
    bank_summary: {
      name: 'Банковская сводка', icon: '🏦', size: 'normal',
      roles: ['ADMIN','BUH','DIRECTOR_*'], render: renderBankSummary
    },
    platform_alerts: {
      name: 'Тендерные площадки', icon: '🏗️', size: 'normal',
      roles: ['ADMIN','TO','HEAD_TO','DIRECTOR_*'], render: renderPlatformAlerts
    },
    my_mail: {
      name: 'Моя почта', icon: '✉️', size: 'normal',
      roles: ['*'], render: renderMyMail
    },

  };

  const DEFAULT_LAYOUTS = {
    ADMIN: ['welcome','kpi_summary','pre_tenders','quick_actions','overdue_works','tenders_funnel','my_mail','notifications'],
    PM: ['welcome','quick_actions','my_works','gantt_mini','todo','my_mail','notifications','birthdays'],
    TO: ['welcome','quick_actions','tenders_funnel','tender_dynamics','my_mail','notifications'],
    HEAD_TO: ['welcome','pre_tenders','platform_alerts','tender_dynamics','tenders_funnel','my_mail','notifications'],
    HEAD_PM: ['welcome','team_workload','overdue_works','gantt_mini','my_mail','notifications'],
    CHIEF_ENGINEER: ['welcome','equipment_value','equipment_alerts','my_mail','notifications'],
    HR: ['welcome','permits_expiry','birthdays','my_mail','notifications','calendar'],
    HR_MANAGER: ['welcome','permits_expiry','birthdays','team_workload','my_mail','notifications'],
    BUH: ['welcome','cash_balance','bank_summary','money_summary','my_mail','notifications'],
    DEFAULT: ['welcome','my_mail','notifications','todo','calendar','birthdays']
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
        if (r === 'HEAD_TO' && wr === 'TO') return true;
        if (r === 'HEAD_PM' && wr === 'PM') return true;
        if (r === 'HR_MANAGER' && wr === 'HR') return true;
        if (r === 'CHIEF_ENGINEER' && wr === 'WAREHOUSE') return true;
        return false;
      });
    });

    const html = '<div class="custom-dash">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:12px">' +
        '<div>' +
          '<h2 style="margin:0;color:var(--gold)">&#5765; Зал Ярла</h2>' +
          '<div class="dash-subtitle">&#5765; &#9670; &#5765; &#9670; &#5765;</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn ghost" id="btnAddW" style="border:1px solid var(--brd)">+ Виджет</button>' +
          '<button class="btn ghost" id="btnResetW" style="border:1px solid var(--brd)">&#8634; Сброс</button>' +
        '</div>' +
      '</div>' +
      '<div class="dash-rune-divider">&#5765; &#9670; &#9671; &#9670; &#5765;</div>' +
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
    '</div>'; // Styles are now in components.css (.dash-grid, .dash-widget, etc.)

    await pageLayout(html, { title: title || 'Мой дашборд' });

    /* perf: parallel widget render — all widgets load simultaneously */
    await Promise.allSettled(userLayout.map(async function(id) {
      const w = WIDGET_TYPES[id];
      if (w && w.render) {
        const el = document.getElementById('wc_' + id);
        if (el) {
          try { await w.render(el, user); }
          catch(e) { el.innerHTML = '<div style="color:var(--t3);padding:12px;text-align:center">Ошибка загрузки</div>'; }
        }
      }
    }));

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
          '<div class="widget-pick" data-id="' + id + '" style="padding:16px;border:1px solid var(--brd);border-radius:var(--r-md);text-align:center;cursor:pointer;background:var(--bg3);transition:all 0.15s ease">' +
            '<div style="font-size:32px;margin-bottom:6px">' + w.icon + '</div>' +
            '<div style="font-size:13px;font-weight:600;color:var(--t1)">' + w.name + '</div>' +
            (w.size === 'wide' ? '<div style="font-size:10px;color:var(--t3);margin-top:4px">широкий</div>' : '') +
          '</div>'
        ).join('') +
        (avail.length === 0 ? '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--t3)">Все виджеты добавлены</div>' : '') +
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
    const hour = new Date().getHours();
    const _fullName = user.name || user.login;
    const _firstName = (_fullName || "").split(" ")[0];
    const _patr = user.patronymic || "";
    const name = _patr ? (_firstName + " " + _patr) : _fullName;

    // Viking greetings by time of day
    const greetings = {
      morning: [
        'Вель комен, {n}! Солнце встаёт — и твоя слава.',
        'Хайль, {n}! Утро несёт новые битвы.',
        'Слава Одину, {n} здесь! Да будет день богатым.',
        'Восход приветствует тебя, {n}! К делам!'
      ],
      day: [
        'Хайль, воин {n}! Путь до Вальгаллы идёт через дела.',
        'Тор благословляет, {n}! Продолжай свой поход.',
        'Дружина сильна, {n} на посту! За работу.',
        '{n}, день в разгаре — время крепить славу!'
      ],
      evening: [
        'Вечер, {n}! Время считать добычу дня.',
        'Хайль, {n}! Сумерки близки, но дела не ждут.',
        '{n}, закат зовёт — заверши начатое.',
        'Валькирии поют, {n}. Заканчивай достойно.'
      ],
      night: [
        'Поздний час, {n}! Истинные воины не спят.',
        'Ночь тиха, {n}. Время для мудрых решений.',
        '{n} бодрствует! Один тоже не дремлет.',
        'Звёзды смотрят, {n}. Работай во славу!'
      ]
    };

    let pool;
    if (hour >= 6 && hour < 12) pool = greetings.morning;
    else if (hour >= 12 && hour < 18) pool = greetings.day;
    else if (hour >= 18 && hour < 22) pool = greetings.evening;
    else pool = greetings.night;
    const greeting = pool[Math.floor(Math.random() * pool.length)].replace('{n}', esc(name));

    const sagas = [
      'План — щит. Факт — сталь.',
      'Срок не ждёт. Действие решает.',
      'Казна любит порядок — держи цифры честными.',
      'Клятва дана — доведи дело до конца.',
      'Время — клинок. Береги его.',
      'Сильнейший — тот, кто держит слово.',
      'Честь дороже золота. Но золото тоже считай.'
    ];
    const saga = sagas[Math.floor(Math.random() * sagas.length)];

    const dateStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

    el.innerHTML =
      '<div class="viking-welcome">' +
        '<span class="vw-rune">\u16DF</span>' +
        '<div class="vw-greeting">' + greeting + '</div>' +
        '<div class="vw-role">' + esc(user.role) + ' \u00B7 ' + esc(dateStr) + '</div>' +
        '<div class="vw-saga-wrap">' +
          '<div class="vw-saga-label">\u16B1 Сага дня</div>' +
          '<div class="vw-saga-text">' + esc(saga) + '</div>' +
        '</div>' +
        '<div class="vw-runes-row">\u16DF \u16B1 \u16A2 \u16C7 \u16D2</div>' +
      '</div>';
  }

  async function renderNotifications(el, user) {
    const n = (await AsgardDB.byIndex('notifications','user_id',user.id)||[]).filter(x=>!x.is_read).slice(0,5);
    if (!n.length) { el.innerHTML = '<div class="help" style="text-align:center;padding:16px 0">Нет уведомлений</div>'; return; }
    el.innerHTML = n.map(x=>'<div style="padding:10px 12px;margin-bottom:6px;background:var(--bg3);border-radius:var(--r-sm);border-left:3px solid var(--gold)"><div style="font-weight:600;font-size:13px;color:var(--t1)">'+esc(x.title)+'</div><div style="font-size:12px;color:var(--t3);margin-top:2px">'+esc((x.message||'').slice(0,60))+'</div></div>').join('');
  }

  async function renderMyWorks(el, user) {
    const w = (await AsgardDB.getAll('works')||[]).filter(x=>x.pm_id===user.id&&x.work_status!=='Завершена'&&x.work_status!=='Работы сдали'&&x.work_status!=='Закрыт').slice(0,5);
    if (!w.length) { el.innerHTML = '<div class="help" style="text-align:center;padding:16px 0">Нет активных работ</div>'; return; }
    el.innerHTML = w.map(x=>'<div style="padding:10px 12px;margin-bottom:6px;background:var(--bg3);border-radius:var(--r-sm);border-left:3px solid var(--red)"><div style="font-weight:600;font-size:13px;color:var(--t1)">'+esc(x.work_name||x.work_title)+'</div><div style="font-size:12px;color:var(--t3);margin-top:2px">'+esc(x.customer_name)+' \u00B7 '+esc(x.work_status)+'</div></div>').join('');
  }

  async function renderFunnel(el, user) {
    const _allT = await AsgardDB.getAll("tenders")||[]; const y = new Date().getFullYear(); const t = _allT.filter(x => String(x.year) === String(y) || (x.period || "").startsWith(String(y)));
    const total = t.length;

    // Color map for known statuses
    const colorMap = {
      '\u041a\u043e\u043d\u0442\u0440\u0430\u043a\u0442': 'var(--ok-t)',
      '\u0412\u044b\u0438\u0433\u0440\u0430\u043b\u0438': 'var(--ok)',
      '\u0422\u041a\u041f \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043e': 'var(--gold)',
      '\u0421\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u0438\u0435 \u0422\u041a\u041f': 'var(--amber)',
      '\u041d\u043e\u0432\u044b\u0439': 'var(--info)',
      '\u041a\u043b\u0438\u0435\u043d\u0442 \u0441\u043e\u0433\u043b\u0430\u0441\u0438\u043b\u0441\u044f': '#22c55e',
      '\u041a\u043b\u0438\u0435\u043d\u0442 \u043e\u0442\u043a\u0430\u0437\u0430\u043b\u0441\u044f': 'var(--err-t)',
      '\u041f\u0440\u043e\u0438\u0433\u0440\u0430\u043b\u0438': 'var(--red)'
    };
    var defaultColor = 'var(--t3)';

    // Build dynamic status list from actual data
    var statusCounts = {};
    t.forEach(function(x) {
      var st = x.tender_status || '\u0411\u0435\u0437 \u0441\u0442\u0430\u0442\u0443\u0441\u0430';
      statusCounts[st] = (statusCounts[st] || 0) + 1;
    });
    var sts = Object.entries(statusCounts).sort(function(a,b){ return b[1]-a[1]; });
    var maxCount = Math.max(sts.length ? sts[0][1] : 1, 1);

    // Won count
    var wonStatuses = ['\u041a\u043e\u043d\u0442\u0440\u0430\u043a\u0442', '\u0412\u044b\u0438\u0433\u0440\u0430\u043b\u0438', '\u041a\u043b\u0438\u0435\u043d\u0442 \u0441\u043e\u0433\u043b\u0430\u0441\u0438\u043b\u0441\u044f'];
    var won = t.filter(function(x){ return wonStatuses.includes(x.tender_status); }).length;
    var conv = total > 0 ? Math.round((won / total) * 100) : 0;

    el.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px">' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--t2);margin-bottom:4px">' +
        '<span>\u0412\u0441\u0435\u0433\u043e: <b style="color:var(--gold)">' + total + '</b></span>' +
        '<span>\u041a\u043e\u043d\u0432\u0435\u0440\u0441\u0438\u044f: <b style="color:var(--ok-t)">' + conv + '%</b></span>' +
      '</div>' +
      sts.map(function(entry) {
        var name = entry[0], c = entry[1];
        var pct = Math.round((c / maxCount) * 100);
        var color = colorMap[name] || defaultColor;
        return '<div style="display:flex;gap:8px;align-items:center">' +
          '<div style="width:130px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--t2)">' + esc(name) + '</div>' +
          '<div style="flex:1;background:var(--bg3);border-radius:4px;height:20px;overflow:hidden;border:1px solid var(--brd)">' +
            '<div style="height:100%;width:' + pct + '%;background:' + color + ';transition:width 0.3s;border-radius:3px"></div>' +
          '</div>' +
          '<div style="width:30px;text-align:right;font-weight:700;font-size:12px;color:var(--t1)">' + c + '</div>' +
        '</div>';
      }).join('') +
      '<a href="#/tenders" class="btn mini ghost" style="margin-top:4px;font-size:11px">\u0412\u0441\u0435 \u0442\u0435\u043d\u0434\u0435\u0440\u044b \u2192</a>' +
    '</div>';
  }

  async function renderMoney(el, user) {
    const [works, tenders] = await Promise.all([
      AsgardDB.getAll('works'),
      AsgardDB.getAll('tenders')
    ]);
    const w = works || [];
    const t = tenders || [];
    const y = new Date().getFullYear();

    function tenderMatchesYear(tender) {
      return String(tender.year) === String(y) || (tender.period || '').startsWith(String(y));
    }

    const tenderIds = new Set(t.filter(tenderMatchesYear).map(x => x.id));

    const yWorks = w.filter(x => {
      const d = x.start_fact || x.start_plan || x.start_in_work_date;
      if (d && new Date(d).getFullYear() === y) return true;
      if (x.tender_id && tenderIds.has(x.tender_id)) return true;
      const fb = x.created_at;
      if (fb && new Date(fb).getFullYear() === y) return true;
      return false;
    });

    const sum = yWorks.reduce((s,x) => s + (Number(x.contract_sum) || Number(x.contract_value) || 0), 0);
    el.innerHTML = '<div style="text-align:center;padding:8px 0"><div style="font-size:26px;font-weight:900;color:var(--gold)">'+formatMoney(sum)+'</div><div style="font-size:12px;color:var(--t3);margin-top:6px">Сумма договоров за '+y+' г.</div></div>';
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
    el.innerHTML = up.map(e=>'<div style="padding:10px 0;display:flex;gap:10px"><div style="font-size:24px">🎂</div><div><div style="font-weight:600;font-size:13px">'+esc(e.fio||e.full_name)+'</div><div class="help">'+(e.days===0?'Сегодня!':'Через '+e.days+' дн.')+'</div></div></div>').join('');
  }

  async function renderApprovals(el, user) {
    const b = (await AsgardDB.getAll('bonus_requests')||[]).filter(x=>x.status==='pending');
    el.innerHTML = '<div style="text-align:center;padding:8px 0"><div style="font-size:48px;font-weight:900;color:'+(b.length?'var(--gold)':'var(--ok-t)')+'">'+b.length+'</div><div style="font-size:12px;color:var(--t3);margin-top:4px">Ожидают согласования</div>'+(b.length?'<a href="#/bonus-approval" class="btn mini" style="margin-top:14px;border:1px solid var(--gold);color:var(--gold)">Перейти</a>':'')+'</div>';
  }

  async function renderCalendar(el, user) {
    const d = new Date();
    el.innerHTML = '<div style="text-align:center;padding:4px 0"><div style="font-size:13px;color:var(--gold);text-transform:capitalize;font-weight:600">'+d.toLocaleString('ru-RU',{month:'long',year:'numeric'})+'</div><div style="font-size:60px;font-weight:900;color:var(--t1);line-height:1.1;margin:8px 0">'+d.getDate()+'</div><div style="font-size:13px;color:var(--t3);text-transform:capitalize">'+d.toLocaleString('ru-RU',{weekday:'long'})+'</div><a href="#/calendar" class="btn mini ghost" style="margin-top:14px;border:1px solid var(--brd)">Календарь</a></div>';
  }

  async function renderQuickActions(el, user) {
    const acts = [];
    if (['ADMIN','TO'].includes(user.role)||user.role?.startsWith('DIRECTOR')) acts.push({i:'📋',l:'Тендер',h:'#/tenders?new=1'});
    if (user.role==='PM') acts.push({i:'📷',l:'Чек',a:'scan'});
    acts.push({i:'💬',l:'Чат',h:'#/chat'});
    el.innerHTML = '<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">'+acts.map(a=>
      '<button class="btn ghost" '+(a.h?'onclick="location.hash=\''+a.h+'\'"':'data-action="'+a.a+'"')+' style="flex:1;min-width:80px;flex-direction:column;display:flex;align-items:center;padding:14px 10px;border:1px solid var(--brd);border-radius:var(--r-md);background:var(--bg3)"><span style="font-size:22px;margin-bottom:4px">'+a.i+'</span><span style="font-size:11px;color:var(--t2)">'+a.l+'</span></button>'
    ).join('')+'</div>';
    el.querySelector('[data-action="scan"]')?.addEventListener('click',()=>{if(window.AsgardReceiptScanner)AsgardReceiptScanner.openScanner();});
  }

  async function renderReceiptScanner(el, user) {
    el.innerHTML = '<div style="text-align:center"><div style="font-size:48px;margin-bottom:12px">📷</div><button class="btn primary" onclick="if(window.AsgardReceiptScanner)AsgardReceiptScanner.openScanner()" style="width:100%">Сканировать чек</button><div class="help" style="margin-top:8px">Быстрый ввод расходов</div></div>';
  }

  async function renderTelephonyStatus(el, user) {
  try {
    const auth = await AsgardAuth.getAuth();
    const token = auth.token;
    
    // Load dispatcher status and recent calls in parallel
    const [settingsRes, callsRes] = await Promise.all([
      fetch('/api/telephony/call-control/settings', { headers: { 'Authorization': 'Bearer ' + token } }).catch(() => null),
      fetch('/api/telephony/calls?limit=5&_sort=-created_at', { headers: { 'Authorization': 'Bearer ' + token } }).catch(() => null)
    ]);
    
    const settings = settingsRes ? await settingsRes.json().catch(() => ({})) : {};
    const callsData = callsRes ? await callsRes.json().catch(() => ({ calls: [] })) : { calls: [] };
    const calls = (callsData.calls || callsData.rows || []).slice(0, 5);
    
    const isDispatcher = settings.is_dispatcher;
    const dispatcherName = settings.current_dispatcher_name || '';
    
    // Dispatcher status section
    let dispatcherHtml;
    if (isDispatcher) {
      dispatcherHtml = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="width:10px;height:10px;border-radius:50%;background:var(--green,#4ade80);box-shadow:0 0 8px var(--green,#4ade80);flex-shrink:0"></span>
          <span style="font-weight:600;color:var(--green,#4ade80)">Диспетчер активен</span>
        </div>`;
    } else if (dispatcherName) {
      dispatcherHtml = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="width:10px;height:10px;border-radius:50%;background:var(--amber,#fbbf24);flex-shrink:0"></span>
          <span style="color:var(--text-sec)">Диспетчер: <b style="color:var(--text)">${dispatcherName}</b></span>
        </div>`;
    } else {
      dispatcherHtml = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="width:10px;height:10px;border-radius:50%;background:var(--text-sec,#666);flex-shrink:0"></span>
          <span style="color:var(--text-sec)">Диспетчер не активен</span>
        </div>`;
    }
    
    // Recent calls section
    let callsHtml = '';
    if (calls.length > 0) {
      const dirIcons = { inbound: '↙', outbound: '↗', missed: '↩', internal: '⇄' };
      const dirColors = { inbound: 'var(--green,#4ade80)', outbound: 'var(--info,#60a5fa)', missed: 'var(--red,#f87171)', internal: 'var(--amber,#fbbf24)' };
      
      callsHtml = calls.map(c => {
        const dir = c.direction || 'inbound';
        const icon = dirIcons[dir] || '↙';
        const color = dirColors[dir] || 'var(--text-sec)';
        const phone = c.from_number || c.to_number || c.caller_id || '—';
        const time = c.created_at ? new Date(c.created_at).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'}) : '';
        const dur = c.duration_seconds ? Math.floor(c.duration_seconds/60) + ':' + String(c.duration_seconds%60).padStart(2,'0') : '0:00';
        
        return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px">
          <span style="color:${color};font-size:14px;width:18px;text-align:center">${icon}</span>
          <span style="flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${phone}</span>
          <span style="color:var(--text-sec);flex-shrink:0">${dur}</span>
          <span style="color:var(--text-sec);flex-shrink:0;font-size:11px">${time}</span>
        </div>`;
      }).join('');
      
      callsHtml = `<div style="border-top:1px solid var(--border,rgba(255,255,255,.08));padding-top:8px;margin-top:4px">
        <div style="font-size:11px;color:var(--text-sec);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Последние звонки</div>
        ${callsHtml}
      </div>`;
    } else {
      callsHtml = '<div style="color:var(--text-sec);font-size:12px;text-align:center;padding:8px 0">Нет звонков</div>';
    }
    
    // Link to telephony page
    const linkHtml = `<a href="#/telephony" class="btn mini ghost" style="margin-top:10px;display:block;text-align:center;font-size:12px">📞 Журнал звонков →</a>`;
    
    el.innerHTML = dispatcherHtml + callsHtml + linkHtml;
    
  } catch(e) {
    el.innerHTML = '<div class="help" style="text-align:center;color:var(--red)">Ошибка загрузки</div>';
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
      
      const deprecPercent = data.total_purchase_value > 0 
        ? Math.round((data.total_depreciation / data.total_purchase_value) * 100) 
        : 0;
      
      el.innerHTML = `
        <div style="text-align:center">
          <div style="font-size:28px;font-weight:700;color:var(--gold)">${formatMoney(data.total_book_value)}</div>
          <div class="help" style="margin-bottom:12px">Балансовая стоимость</div>
          
          <div style="display:flex;gap:16px;justify-content:center;font-size:12px">
            <div>
              <div style="font-weight:600;color:var(--text-muted)">Закупка</div>
              <div>${formatMoney(data.total_purchase_value)}</div>
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
            ${data.total_items} ед. на балансе
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
    const works = await AsgardDB.getAll('works');
    const now = new Date();
    const overdue = works.filter(w => {
      if (!w.end_plan) return false;
      if (['Работы сдали','Завершена','Закрыт'].includes(w.work_status)) return false;
      return new Date(w.end_plan) < now;
    }).sort((a,b) => new Date(a.end_plan) - new Date(b.end_plan)).slice(0, 8);

    if (!overdue.length) {
      el.innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:40px;margin-bottom:8px">✅</div><div class="help">Просроченных работ нет</div></div>';
      return;
    }
    el.innerHTML = '<div style="font-size:12px;color:var(--red);font-weight:700;margin-bottom:8px">⚠️ ' + overdue.length + ' просроченных</div>' +
      overdue.map(w => {
        const days = Math.round((now - new Date(w.end_plan)) / 86400000);
        return '<div style="padding:10px 0;display:flex;justify-content:space-between;gap:8px">' +
          '<div style="font-size:12px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(w.work_title || w.work_name || ('ID ' + w.id)) + '</div>' +
          '<div style="font-size:11px;color:var(--red);white-space:nowrap">+' + days + ' дн.</div>' +
        '</div>';
      }).join('') +
      '<a href="#/all-works" class="btn mini ghost" style="margin-top:8px;font-size:11px">Все работы →</a>';
  }

  async function renderPermitsExpiry(el, user) {
    const permits = await AsgardDB.getAll('permits') || [];
    const employees = await AsgardDB.getAll('employees') || [];
    const empMap = new Map(employees.map(e => [e.id, e.full_name || e.name || '']));
    const now = new Date();

    // Classify permits
    const groups = { expired: [], critical: [], warning: [], upcoming: [] };

    permits.forEach(p => {
      if (!p.expiry_date) return;
      const exp = new Date(p.expiry_date);
      const days = Math.round((exp - now) / 86400000);
      const name = empMap.get(p.employee_id) || p.employee_name || p.fio || '\u2014';
      const type = p.permit_type || p.type || p.category || '';
      const item = { name, type, days, date: p.expiry_date, id: p.id, eid: p.employee_id };

      if (days < 0) groups.expired.push(item);
      else if (days <= 14) groups.critical.push(item);
      else if (days <= 30) groups.warning.push(item);
      else if (days <= 60) groups.upcoming.push(item);
    });

    // Sort each group
    groups.expired.sort((a, b) => a.days - b.days);
    groups.critical.sort((a, b) => a.days - b.days);
    groups.warning.sort((a, b) => a.days - b.days);
    groups.upcoming.sort((a, b) => a.days - b.days);

    const total = groups.expired.length + groups.critical.length + groups.warning.length + groups.upcoming.length;
    if (!total) {
      el.innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:40px;margin-bottom:8px">\u2705</div><div class="help">\u0412\u0441\u0435 \u0434\u043e\u043f\u0443\u0441\u043a\u0438 \u0432 \u043f\u043e\u0440\u044f\u0434\u043a\u0435</div></div>';
      return;
    }

    function fmtDate(d) {
      if (!d) return '';
      try { return new Date(d).toLocaleDateString('ru-RU', {day:'2-digit',month:'2-digit',year:'numeric'}); } catch(e) { return d; }
    }

    function badge(count, color, label) {
      if (!count) return '';
      return '<div style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;background:' + color + '20;color:' + color + '">' +
        '<span>' + count + '</span><span style="font-weight:400;font-size:11px">' + label + '</span></div>';
    }

    function renderGroup(items, color, maxShow) {
      if (!items.length) return '';
      var shown = items.slice(0, maxShow || 10);
      var html = shown.map(function(it) {
        var daysText = it.days === 0 ? '\u0421\u0435\u0433\u043e\u0434\u043d\u044f' : it.days < 0 ? Math.abs(it.days) + ' \u0434\u043d. \u043d\u0430\u0437\u0430\u0434' : it.days + ' \u0434\u043d.';
        return '<tr>' +
          '<td style="padding:4px 6px;font-size:12px;font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            '<a href="#/employees/' + (it.eid || '') + '" style="color:inherit;text-decoration:none">' + esc(it.name) + '</a></td>' +
          '<td style="padding:4px 6px;font-size:11px;color:var(--t3);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(it.type) + '</td>' +
          '<td style="padding:4px 6px;font-size:11px;color:var(--t3);white-space:nowrap">' + fmtDate(it.date) + '</td>' +
          '<td style="padding:4px 6px;font-size:12px;font-weight:700;color:' + color + ';white-space:nowrap;text-align:right">' + daysText + '</td>' +
        '</tr>';
      }).join('');
      if (items.length > maxShow) {
        html += '<tr><td colspan="4" style="padding:4px 6px;font-size:11px;color:var(--t3);text-align:center">\u0438 \u0435\u0449\u0451 ' + (items.length - maxShow) + '...</td></tr>';
      }
      return html;
    }

    var html = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">' +
      badge(groups.expired.length, 'var(--red,#ef4444)', '\u0438\u0441\u0442\u0435\u043a\u043b\u0438') +
      badge(groups.critical.length, '#f97316', '< 14 \u0434\u043d.') +
      badge(groups.warning.length, 'var(--amber,#f59e0b)', '< 30 \u0434\u043d.') +
      badge(groups.upcoming.length, '#3b82f6', '< 60 \u0434\u043d.') +
    '</div>';

    html += '<div style="max-height:320px;overflow-y:auto">';
    html += '<table style="width:100%;border-collapse:collapse">';

    if (groups.expired.length) {
      html += '<tr><td colspan="4" style="padding:6px 4px 2px;font-size:11px;font-weight:700;color:var(--red,#ef4444);text-transform:uppercase;border-bottom:1px solid var(--red,#ef4444)30">\u2716 \u0418\u0441\u0442\u0435\u043a\u043b\u0438</td></tr>';
      html += renderGroup(groups.expired, 'var(--red,#ef4444)', 10);
    }
    if (groups.critical.length) {
      html += '<tr><td colspan="4" style="padding:6px 4px 2px;font-size:11px;font-weight:700;color:#f97316;text-transform:uppercase;border-bottom:1px solid #f9731630">\u26a0 \u041a\u0440\u0438\u0442\u0438\u0447\u043d\u043e (\u0434\u043e 14 \u0434\u043d.)</td></tr>';
      html += renderGroup(groups.critical, '#f97316', 20);
    }
    if (groups.warning.length) {
      html += '<tr><td colspan="4" style="padding:6px 4px 2px;font-size:11px;font-weight:700;color:var(--amber,#f59e0b);text-transform:uppercase;border-bottom:1px solid var(--amber,#f59e0b)30">\u23f0 \u0414\u043e 30 \u0434\u043d.</td></tr>';
      html += renderGroup(groups.warning, 'var(--amber,#f59e0b)', 20);
    }
    if (groups.upcoming.length) {
      html += '<tr><td colspan="4" style="padding:6px 4px 2px;font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;border-bottom:1px solid #3b82f630">\U0001f4c5 \u0414\u043e 60 \u0434\u043d.</td></tr>';
      html += renderGroup(groups.upcoming, '#3b82f6', 15);
    }

    html += '</table></div>';
    html += '<a href="#/permits" class="btn mini ghost" style="margin-top:8px;font-size:11px">\u0412\u0441\u0435 \u0434\u043e\u043f\u0443\u0441\u043a\u0438 \u2192</a>';

    el.innerHTML = html;
  }

  async function renderTeamWorkload(el, user) {
    const works = await AsgardDB.getAll('works');
    const employees = await AsgardDB.getAll('employees') || [];
    const users = await AsgardDB.getAll('users') || [];

    // Build PM map: find all unique pm_ids from works
    const pmIds = [...new Set(works.filter(w => w.pm_id).map(w => w.pm_id))];

    // Map pm_id to name (from users or employees)
    const userMap = new Map(users.map(u => [u.id, u.name || u.login || '']));
    const empMap = new Map(employees.map(e => [e.user_id, e.full_name || '']));

    const data = pmIds.map(pmId => {
      const pmWorks = works.filter(w => w.pm_id === pmId);
      const completed = pmWorks.filter(w => ['\u0420\u0430\u0431\u043e\u0442\u044b \u0441\u0434\u0430\u043b\u0438','\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430','\u0417\u0430\u043a\u0440\u044b\u0442'].includes(w.work_status)).length;
      const active = pmWorks.length - completed;
      var name = userMap.get(pmId) || '';
      if (!name) { for (var [uid, fn] of empMap) { if (uid === pmId) { name = fn; break; } } }
      if (!name) name = 'PM #' + pmId;
      return { name: name, total: pmWorks.length, active: active, completed: completed, id: pmId };
    }).filter(d => d.total > 0).sort((a,b) => b.total - a.total);

    if (!data.length) {
      el.innerHTML = '<div class="help" style="text-align:center;padding:20px">\u041d\u0435\u0442 \u0440\u0430\u0431\u043e\u0442 \u0441 \u0420\u041f</div>';
      return;
    }
    const max = Math.max(...data.map(d => d.total), 1);
    el.innerHTML = data.map(d => {
      const pctDone = Math.round((d.completed / max) * 100);
      const pctActive = Math.round((d.active / max) * 100);
      const color = d.active > 5 ? 'var(--err-t)' : d.active > 2 ? 'var(--amber)' : 'var(--ok)';
      // Short name (surname only)
      const shortName = (d.name || '').split(' ')[0];
      return '<div style="display:flex;align-items:center;gap:8px;margin:5px 0">' +
        '<div style="width:100px;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(d.name) + '">' + esc(shortName) + '</div>' +
        '<div style="flex:1;background:var(--bg-elevated);border-radius:4px;height:18px;overflow:hidden;display:flex">' +
          '<div style="height:100%;width:' + pctDone + '%;background:var(--ok-t);transition:width .3s"></div>' +
          '<div style="height:100%;width:' + pctActive + '%;background:' + color + ';transition:width .3s"></div>' +
        '</div>' +
        '<div style="width:45px;text-align:right;font-size:11px;white-space:nowrap"><b>' + d.total + '</b> <span style="color:var(--t3)">(' + d.active + ')</span></div>' +
      '</div>';
    }).join('') +
    '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;padding-top:8px;border-top:1px solid var(--brd);font-size:10px;color:var(--t3)">' +
      '<span style="display:flex;align-items:center;gap:3px"><span style="display:inline-block;width:8px;height:8px;background:var(--ok-t);border-radius:2px"></span>\u0421\u0434\u0430\u043d\u043e</span>' +
      '<span style="display:flex;align-items:center;gap:3px"><span style="display:inline-block;width:8px;height:8px;background:var(--ok);border-radius:2px"></span>\u0412 \u043d\u043e\u0440\u043c\u0435 (1-2)</span>' +
      '<span style="display:flex;align-items:center;gap:3px"><span style="display:inline-block;width:8px;height:8px;background:var(--amber);border-radius:2px"></span>\u041d\u0430\u0433\u0440\u0443\u0437\u043a\u0430 (3-5)</span>' +
      '<span style="display:flex;align-items:center;gap:3px"><span style="display:inline-block;width:8px;height:8px;background:var(--err-t);border-radius:2px"></span>\u041f\u0435\u0440\u0435\u0433\u0440\u0443\u0437\u043a\u0430 (6+)</span>' +
      '<span style="margin-left:auto">\u0412\u0441\u0435\u0433\u043e (\u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0445)</span>' +
    '</div>';
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
          '<div style="font-size:10px;font-weight:700;color:var(--t1)">' + m.total + '</div>' +
          '<div style="width:100%;height:' + h + 'px;border-radius:4px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end">' +
            '<div style="height:' + (h - wh) + 'px;background:var(--red)"></div>' +
            '<div style="height:' + wh + 'px;background:var(--ok)"></div>' +
          '</div>' +
          '<div style="font-size:10px;color:var(--t3)">' + esc(m.label) + '</div>' +
        '</div>';
      }).join('') +
    '</div>' +
    '<div style="display:flex;gap:12px;margin-top:10px;font-size:10px;color:var(--t2)">' +
      '<span><span style="display:inline-block;width:8px;height:8px;background:var(--red);border-radius:2px;margin-right:4px"></span>Всего</span>' +
      '<span><span style="display:inline-block;width:8px;height:8px;background:var(--ok);border-radius:2px;margin-right:4px"></span>Выиграно</span>' +
    '</div>';
  }

  async function renderKpiSummary(el, user) {
    const [tenders, works] = await Promise.all([
      AsgardDB.getAll('tenders'),
      AsgardDB.getAll('works')
    ]);
    const y = new Date().getFullYear();
    const yTenders = tenders.filter(t => String(t.year) === String(y) || (t.period || '').startsWith(y));
    const yWorks = works.filter(w => {
      const d = w.start_fact || w.work_start_plan || w.created_at;
      return d && new Date(d).getFullYear() === y;
    });
    const won = yTenders.filter(t => ['Выиграли','Контракт','Клиент согласился'].includes(t.tender_status)).length;
    const conv = yTenders.length > 0 ? Math.round((won / yTenders.length) * 100) : 0;
    const revenue = yWorks.reduce((s, w) => s + (Number(w.contract_sum) || Number(w.contract_value) || 0), 0);
    const done = yWorks.filter(w => ['Работы сдали','Завершена','Закрыт'].includes(w.work_status)).length;

    el.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<div style="text-align:center;padding:14px 18px;background:var(--bg3);border-radius:var(--r-md);border:1px solid var(--brd)"><div style="font-size:10px;color:var(--t3);text-transform:uppercase;font-weight:800;letter-spacing:0.05em">Тендеров</div><div style="font-size:24px;font-weight:900;color:var(--red)">' + yTenders.length + '</div></div>' +
      '<div style="text-align:center;padding:14px 18px;background:var(--bg3);border-radius:var(--r-md);border:1px solid var(--brd)"><div style="font-size:10px;color:var(--t3);text-transform:uppercase;font-weight:800;letter-spacing:0.05em">Конверсия</div><div style="font-size:24px;font-weight:900;color:var(--ok-t)">' + conv + '%</div></div>' +
      '<div style="text-align:center;padding:14px 18px;background:var(--bg3);border-radius:var(--r-md);border:1px solid var(--brd)"><div style="font-size:10px;color:var(--t3);text-transform:uppercase;font-weight:800;letter-spacing:0.05em">Выручка</div><div style="font-size:18px;font-weight:900;color:var(--gold)">' + formatMoney(revenue) + '</div></div>' +
      '<div style="text-align:center;padding:14px 18px;background:var(--bg3);border-radius:var(--r-md);border:1px solid var(--brd)"><div style="font-size:10px;color:var(--t3);text-transform:uppercase;font-weight:800;letter-spacing:0.05em">Сдано работ</div><div style="font-size:24px;font-weight:900;color:var(--ok-t)">' + done + '/' + yWorks.length + '</div></div>' +
    '</div>';
  }

  async function renderGanttMini(el, user) {
    const works = await AsgardDB.getAll('works');
    const now = new Date();
    const soon = works.filter(w => {
      if (!w.end_plan) return false;
      if (['Работы сдали','Завершена','Закрыт'].includes(w.work_status)) return false;
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
      return '<div style="padding:10px 0;display:flex;justify-content:space-between;gap:8px">' +
        '<div style="font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(w.work_title || w.work_name || '') + '</div>' +
        '<div style="font-size:11px;font-weight:700;color:' + color + ';white-space:nowrap">' + days + ' дн.</div>' +
      '</div>';
    }).join('') +
    '<a href="#/gantt-works" class="btn mini ghost" style="margin-top:8px;font-size:11px">Гантт →</a>';
  }

  async function renderCashBalance(el, user) {
    try {
      const cashRecords = await AsgardDB.getAll('cash_requests') || [];
      const pending = cashRecords.filter(r => r.status === 'requested' || r.status === 'approved').length;
      const totalIssued = cashRecords.filter(r => r.status === 'received' || r.status === 'reporting').reduce((s, r) => s + (Number(r.amount) || 0), 0);
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
      const auth = await AsgardAuth.getAuth();
      const resp = await fetch('/api/equipment/maintenance/upcoming', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      const items = (data.upcoming || data.items || data.equipment || []).slice(0, 5);
      if (!items.length) {
        el.innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:40px;margin-bottom:8px">✅</div><div class="help">Всё обслужено</div></div>';
        return;
      }
      el.innerHTML = '<div style="font-size:12px;color:var(--amber);font-weight:700;margin-bottom:8px">🔧 Требуется ТО</div>' +
        items.map(i => '<div style="padding:7px 0;font-size:12px">' +
          '<div style="font-weight:600">' + esc(i.name || i.equipment_name || '') + '</div>' +
          '<div class="help">' + esc((i.next_maintenance || i.next_calibration) ? new Date(i.next_maintenance || i.next_calibration).toLocaleDateString('ru-RU') : '—') + '</div>' +
        '</div>').join('') +
        '<a href="#/warehouse" class="btn mini ghost" style="margin-top:8px;font-size:11px">Склад →</a>';
    } catch(e) {
      el.innerHTML = '<div class="help" style="text-align:center">Ошибка загрузки</div>';
    }
  }

  async function renderPayrollPending(el, user) {
    try {
      const sheets = (await AsgardDB.all('payroll_sheets') || []).filter(s => s.status === 'pending');
      const oneTime = (await AsgardDB.all('one_time_payments') || []).filter(s => s.status === 'pending');
      const total = sheets.length + oneTime.length;
      el.innerHTML = `
        <div style="font-size:28px;font-weight:900;color:${total > 0 ? 'var(--gold)' : 'var(--green)'}">${total}</div>
        <div class="help">ведомостей / разовых на согласовании</div>
        ${sheets.length ? '<a href="#/payroll" style="color:var(--blue);font-size:13px">Ведомости →</a>' : ''}
        ${oneTime.length ? ' <a href="#/one-time-pay" style="color:var(--blue);font-size:13px;margin-left:8px">Разовые →</a>' : ''}
      `;
    } catch(e) {
      el.innerHTML = '<div class="help" style="text-align:center">Ошибка загрузки</div>';
    }
  }

  async function renderTodo(el, user) {
    try {
      const auth = await AsgardAuth.getAuth();
      const resp = await fetch('/api/tasks/todo', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      const items = (data.items || data || []).slice(0, 8);
      if (!items.length) {
        el.innerHTML = '<div style="text-align:center;padding:16px"><div style="font-size:32px;margin-bottom:8px">✅</div><div class="help">Нет задач</div><a href="#/todo" class="btn mini ghost" style="margin-top:8px">Открыть</a></div>';
        return;
      }
      const pending = items.filter(i => !i.done);
      const done = items.filter(i => i.done);
      el.innerHTML = '<div style="font-size:12px;font-weight:700;margin-bottom:8px">' + pending.length + ' активных</div>' +
        pending.slice(0, 5).map(i =>
          '<div style="padding:7px 0;display:flex;gap:8px;align-items:center">' +
            '<span style="color:var(--amber);font-size:14px">○</span>' +
            '<span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(i.text || i.title || '') + '</span>' +
          '</div>'
        ).join('') +
        (done.length ? '<div style="font-size:11px;color:var(--text-muted);margin-top:8px">' + done.length + ' выполнено</div>' : '') +
        '<a href="#/todo" class="btn mini ghost" style="margin-top:8px;font-size:11px">Все задачи →</a>';
    } catch(e) {
      el.innerHTML = '<div class="help" style="text-align:center">Ошибка загрузки</div>';
    }
  }

  async function renderPreTenders(el, user) {
    try {
      const auth = await AsgardAuth.getAuth();
      const resp = await fetch('/api/pre-tenders/stats', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      if (!data.success) { el.innerHTML = '<div class="help" style="text-align:center">Нет данных</div>'; return; }

      const total = (data.total_new || 0) + (data.total_in_review || 0) + (data.total_need_docs || 0);
      el.innerHTML = '<div style="display:flex;gap:16px;justify-content:center;margin-bottom:12px">' +
        '<div style="text-align:center"><div style="font-size:22px;font-weight:900;color:var(--info)">' + (data.total_new || 0) + '</div><div style="font-size:10px;color:var(--text-muted)">Новых</div></div>' +
        '<div style="text-align:center"><div style="font-size:22px;font-weight:900;color:var(--amber)">' + (data.total_in_review || 0) + '</div><div style="font-size:10px;color:var(--text-muted)">На рассмотрении</div></div>' +
        '<div style="text-align:center"><div style="font-size:22px;font-weight:900;color:var(--t2)">' + (data.total_need_docs || 0) + '</div><div style="font-size:10px;color:var(--text-muted)">Нужны документы</div></div>' +
      '</div>';

      // Мини-список последних 5
      try {
        const listResp = await fetch('/api/pre-tenders/?status=new&limit=5', {
          headers: { 'Authorization': 'Bearer ' + auth.token }
        });
        const listData = await listResp.json();
        if (listData.items?.length) {
          const colorDots = { green: 'var(--ok-t)', yellow: 'var(--amber)', red: 'var(--err-t)', gray: 'var(--t2)' };
          el.innerHTML += listData.items.map(function(i) {
            var dot = colorDots[i.ai_color] || colorDots.gray;
            return '<div style="padding:10px 0;display:flex;align-items:center;gap:8px;font-size:12px">' +
              '<div style="width:10px;height:10px;border-radius:50%;background:' + dot + ';flex-shrink:0"></div>' +
              '<div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(i.customer_name || i.email_from_name || '-') + '</div>' +
              '<div style="color:var(--text-muted);font-size:10px">' + (i.created_at ? new Date(i.created_at).toLocaleDateString('ru-RU') : '') + '</div>' +
            '</div>';
          }).join('');
        }
      } catch(e2) {}

      el.innerHTML += '<a href="#/pre-tenders" class="btn mini ghost" style="margin-top:8px;font-size:11px;display:block;text-align:center">Все заявки →</a>';
    } catch(e) {
      el.innerHTML = '<div class="help" style="text-align:center">Ошибка загрузки</div>';
    }
  }

  // ─── Phase 10: Банковская сводка ───
  async function renderBankSummary(el, user) {
    try {
      const auth = await AsgardAuth.getAuth();
      const resp = await fetch('/api/integrations/bank/stats', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      if (!data.success) { el.innerHTML = '<div class="help" style="text-align:center">Нет данных</div>'; return; }

      const s = data.stats || data;
      el.innerHTML = '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-bottom:8px">' +
        '<div style="text-align:center"><div style="font-size:20px;font-weight:900;color:var(--ok-t)">' + formatMoney(s.total_income || 0) + '</div><div style="font-size:10px;color:var(--text-muted)">Приход</div></div>' +
        '<div style="text-align:center"><div style="font-size:20px;font-weight:900;color:var(--err-t)">' + formatMoney(s.total_expense || 0) + '</div><div style="font-size:10px;color:var(--text-muted)">Расход</div></div>' +
      '</div>' +
      '<div style="text-align:center;margin-bottom:8px"><span style="font-size:11px;color:var(--text-muted)">Нераспред.: </span><span style="font-weight:700;color:var(--amber)">' + (s.unclassified || s.unclassified_count || 0) + '</span></div>';

      // Последние 5 транзакций
      try {
        const txResp = await fetch('/api/integrations/bank/transactions?limit=5&sort=transaction_date&order=desc', {
          headers: { 'Authorization': 'Bearer ' + auth.token }
        });
        const txData = await txResp.json();
        if (txData.items?.length) {
          el.innerHTML += txData.items.map(function(t) {
            var color = t.direction === 'income' ? 'var(--ok-t)' : 'var(--err-t)';
            var sign = t.direction === 'income' ? '+' : '-';
            return '<div style="padding:10px 0;display:flex;align-items:center;gap:6px;font-size:11px">' +
              '<div style="color:' + color + ';font-weight:700;white-space:nowrap">' + sign + formatMoney(Math.abs(t.amount)) + '</div>' +
              '<div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted)">' + esc(t.counterparty_name || t.payment_purpose || '-') + '</div>' +
            '</div>';
          }).join('');
        }
      } catch(e2) {}

      el.innerHTML += '<a href="#/integrations" class="btn mini ghost" style="margin-top:8px;font-size:11px;display:block;text-align:center">Банк / 1С →</a>';
    } catch(e) {
      el.innerHTML = '<div class="help" style="text-align:center">Ошибка загрузки</div>';
    }
  }

  // ─── Phase 10: Тендерные площадки ───
  async function renderPlatformAlerts(el, user) {
    try {
      const auth = await AsgardAuth.getAuth();
      const resp = await fetch('/api/integrations/platforms/stats', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      const data = await resp.json();
      if (!data.success) { el.innerHTML = '<div class="help" style="text-align:center">Нет данных</div>'; return; }

      const s = data.stats || data;
      el.innerHTML = '<div style="display:flex;gap:14px;justify-content:center;margin-bottom:10px">' +
        '<div style="text-align:center"><div style="font-size:20px;font-weight:900;color:var(--info)">' + (s.total || 0) + '</div><div style="font-size:10px;color:var(--text-muted)">Всего</div></div>' +
        '<div style="text-align:center"><div style="font-size:20px;font-weight:900;color:var(--ok-t)">' + (s.completed || 0) + '</div><div style="font-size:10px;color:var(--text-muted)">Разобрано</div></div>' +
        '<div style="text-align:center"><div style="font-size:20px;font-weight:900;color:var(--amber)">' + (s.pending || 0) + '</div><div style="font-size:10px;color:var(--text-muted)">Ожидают</div></div>' +
      '</div>';

      // Ближайшие дедлайны
      try {
        var dlResp = await fetch('/api/integrations/platforms?parse_status=completed&sort=application_deadline&order=asc&limit=5', {
          headers: { 'Authorization': 'Bearer ' + auth.token }
        });
        var dlData = await dlResp.json();
        if (dlData.items?.length) {
          var now = Date.now();
          el.innerHTML += dlData.items.filter(function(p) {
            return p.application_deadline && new Date(p.application_deadline) > new Date();
          }).slice(0, 4).map(function(p) {
            var dl = new Date(p.application_deadline);
            var daysLeft = Math.ceil((dl - now) / 86400000);
            var urgColor = daysLeft <= 2 ? 'var(--err-t)' : daysLeft <= 5 ? 'var(--amber)' : 'var(--ok-t)';
            return '<div style="padding:10px 0;display:flex;align-items:center;gap:6px;font-size:11px">' +
              '<div style="width:8px;height:8px;border-radius:50%;background:' + urgColor + ';flex-shrink:0"></div>' +
              '<div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.customer_name || p.purchase_number || '-') + '</div>' +
              '<div style="color:' + urgColor + ';font-size:10px;font-weight:700;white-space:nowrap">' + daysLeft + 'д</div>' +
            '</div>';
          }).join('');
        }
      } catch(e2) {}

      el.innerHTML += '<a href="#/integrations" class="btn mini ghost" style="margin-top:8px;font-size:11px;display:block;text-align:center">Все площадки →</a>';
    } catch(e) {
      el.innerHTML = '<div class="help" style="text-align:center">Ошибка загрузки</div>';
    }
  }

  function esc(s){return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function formatMoney(n){return new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n||0);}


  // ========== Widget: My Mail ==========
  async function renderMyMail(el, user) {
    el.innerHTML = '<div class="dash-loading">\u2709\ufe0f Loading mail...</div>';

    try {
      const auth = await AsgardAuth.getAuth();
      const token = auth?.token;
      if (!token) { el.innerHTML = '<div class="help">Not authorized</div>'; return; }

      let stats = null;
      let emails = [];
      let mailType = 'personal';
      let pageUrl = '#/my-mail';

      // Try personal mail
      try {
        const resp = await fetch('/api/my-mail/stats', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (resp.ok) {
          stats = await resp.json();
          if (stats.total > 0) {
            const emailsResp = await fetch('/api/my-mail/emails?limit=5&folder_type=inbox', {
              headers: { 'Authorization': 'Bearer ' + token }
            });
            if (emailsResp.ok) {
              const emailsData = await emailsResp.json();
              emails = emailsData.emails || [];
            }
          }
        }
      } catch(e) { console.warn('[Dashboard] Personal mail check failed:', e.message); }

      // Fallback to company mailbox
      if (!stats || stats.total === 0) {
        try {
          const resp = await fetch('/api/mailbox/stats', {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          if (resp.ok) {
            stats = await resp.json();
            mailType = 'company';
            pageUrl = '#/mailbox';
            if (stats.inbox_total > 0) {
              const emailsResp = await fetch('/api/mailbox/emails?limit=5&folder=inbox', {
                headers: { 'Authorization': 'Bearer ' + token }
              });
              if (emailsResp.ok) {
                const emailsData = await emailsResp.json();
                emails = emailsData.emails || [];
              }
            }
          }
        } catch(e) { console.warn('[Dashboard] Company mail check failed:', e.message); }
      }

      const unread = stats ? (stats.unread || 0) : 0;
      const total = stats ? (mailType === 'company' ? (stats.inbox_total || 0) : (stats.total || 0)) : 0;

      // No mail configured
      if (!stats || (total === 0 && unread === 0 && emails.length === 0)) {
        var isAdm = user && (user.role === 'ADMIN' || (user.role||'').startsWith('DIRECTOR'));
        el.innerHTML = '<div style="text-align:center;padding:20px 0">' +
          '<div style="font-size:32px;margin-bottom:12px">\u2709\ufe0f</div>' +
          '<div style="color:var(--text-muted);font-size:13px">\u041f\u043e\u0447\u0442\u0430 \u043d\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0430</div>' +
          (isAdm ? '<a href="#/my-mail" class="btn ghost" style="margin-top:12px;font-size:12px">\u041d\u0430\u0441\u0442\u0440\u043e\u0438\u0442\u044c</a>' : '<div style="color:var(--text-muted);font-size:11px;margin-top:8px">\u041e\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044c \u043a \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0443</div>') +
          '</div>';
        return;
      }

      // Stats badge
      var unreadBadge = unread > 0
        ? '<span style="background:var(--red,#e74c3c);color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;margin-left:8px">' + unread + ' \u043d\u043e\u0432\u044b\u0445</span>'
        : '<span style="color:var(--ok,#2ecc71);font-size:12px;margin-left:8px">\u0432\u0441\u0451 \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043d\u043e</span>';

      // Email list
      var listHtml = '';
      if (emails.length > 0) {
        listHtml = emails.slice(0, 5).map(function(e) {
          var from = esc(e.from_name || e.from_address || e.email_from_name || e.email_from || '');
          var subj = esc(e.subject || e.email_subject || '(\u0431\u0435\u0437 \u0442\u0435\u043c\u044b)');
          var snippet = esc((e.snippet || e.body_text || '').substring(0, 60));
          var isRead = e.is_read;
          var date = e.created_at || e.received_at || e.date;
          var ago = date ? _mailAgo(new Date(date)) : '';
          var readStyle = isRead ? 'opacity:0.7' : 'font-weight:700';
          var dot = !isRead ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--blue,#3498db);flex-shrink:0;display:inline-block"></span>' : '';
          return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line,rgba(255,255,255,0.06));cursor:pointer;' + readStyle + '" onclick="location.hash=\'' + pageUrl + '\'">'+
            dot +
            '<div style="flex:1;min-width:0">'+
              '<div style="display:flex;justify-content:space-between;align-items:center">'+
                '<span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%">' + from + '</span>'+
                '<span style="font-size:10px;color:var(--text-muted);white-space:nowrap">' + ago + '</span>'+
              '</div>'+
              '<div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t2)">' + subj + '</div>'+
            '</div></div>';
        }).join('');
      } else {
        listHtml = '<div style="text-align:center;padding:16px 0;color:var(--text-muted);font-size:12px">\u041d\u0435\u0442 \u043f\u0438\u0441\u0435\u043c</div>';
      }

      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
        '<div style="display:flex;align-items:center"><span style="font-size:14px;font-weight:700">\u2709\ufe0f \u041f\u043e\u0447\u0442\u0430</span>' + unreadBadge + '</div>' +
        '<a href="' + pageUrl + '" style="font-size:11px;color:var(--blue,#3498db);text-decoration:none">\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u2192</a></div>' +
        '<div style="max-height:280px;overflow-y:auto">' + listHtml + '</div>';
    } catch(e) {
      el.innerHTML = '<div class="help">\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u043f\u043e\u0447\u0442\u044b</div>';
      console.warn('[Dashboard] Mail widget error:', e);
    }
  }

  function _mailAgo(date) {
    if (!date || isNaN(date.getTime())) return '';
    var now = new Date();
    var diff = Math.floor((now - date) / 1000);
    if (diff < 60) return '\u0441\u0435\u0439\u0447\u0430\u0441';
    if (diff < 3600) return Math.floor(diff / 60) + ' \u043c\u0438\u043d';
    if (diff < 86400) return Math.floor(diff / 3600) + ' \u0447';
    if (diff < 604800) return Math.floor(diff / 86400) + ' \u0434\u043d';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  return { render, WIDGET_TYPES };
})();
