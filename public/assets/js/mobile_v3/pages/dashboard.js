/**
 * ASGARD CRM — Mobile v3 / Dashboard
 * 27 виджетов, drag-drop, add/remove, pull-to-refresh
 */
var DashboardPage = {

  /* ─── Widget Registry ─── */
  WIDGET_TYPES: {
    welcome:          { name: 'Приветствие',          icon: '👋', size: 'normal', roles: ['*'] },
    notifications:    { name: 'Уведомления',          icon: '🔔', size: 'normal', roles: ['*'] },
    my_works:         { name: 'Мои работы',            icon: '🔧', size: 'normal', roles: ['PM','HEAD_PM'] },
    tenders_funnel:   { name: 'Воронка',               icon: '📊', size: 'normal', roles: ['ADMIN','TO','HEAD_TO','PM','DIRECTOR_*'] },
    money_summary:    { name: 'Финансы',               icon: '💰', size: 'normal', roles: ['ADMIN','DIRECTOR_*'], hero: true },
    equipment_value:  { name: 'Стоимость ТМЦ',        icon: '📦', size: 'normal', roles: ['ADMIN','CHIEF_ENGINEER','DIRECTOR_*'] },
    birthdays:        { name: 'Дни рождения',          icon: '🎂', size: 'normal', roles: ['*'] },
    approvals:        { name: 'Согласования',          icon: '✍️', size: 'normal', roles: ['ADMIN','HEAD_PM','DIRECTOR_*'] },
    calendar:         { name: 'Календарь',             icon: '📅', size: 'normal', roles: ['*'] },
    quick_actions:    { name: 'Быстрые действия',      icon: '⚡', size: 'normal', roles: ['*'] },
    receipt_scanner:  { name: 'Сканер чеков',          icon: '📷', size: 'normal', roles: ['PM','HEAD_PM'] },
    telephony_status: { name: 'Телефония',             icon: '📞', size: 'normal', roles: ['ADMIN','DIRECTOR_*','PM','HEAD_PM','TO','HEAD_TO','BUH'] },
    overdue_works:    { name: 'Просроченные работы',   icon: '⚠️', size: 'wide',   roles: ['ADMIN','PM','HEAD_PM','DIRECTOR_*'] },
    permits_expiry:   { name: 'Истекающие допуски',    icon: '🛡', size: 'wide',   roles: ['ADMIN','HR','HR_MANAGER','HEAD_TO','CHIEF_ENGINEER','DIRECTOR_*'] },
    team_workload:    { name: 'Загрузка РП',           icon: '📊', size: 'wide',   roles: ['ADMIN','HEAD_PM','DIRECTOR_*'] },
    tender_dynamics:  { name: 'Динамика тендеров',     icon: '📈', size: 'wide',   roles: ['ADMIN','TO','HEAD_TO','DIRECTOR_*'] },
    kpi_summary:      { name: 'KPI сводка',            icon: '🎯', size: 'wide',   roles: ['ADMIN','DIRECTOR_*'] },
    gantt_mini:       { name: 'Ближайшие дедлайны',    icon: '⏰', size: 'normal', roles: ['ADMIN','PM','HEAD_PM','DIRECTOR_*'] },
    cash_balance:     { name: 'Баланс КАССА',          icon: '💵', size: 'normal', roles: ['ADMIN','BUH','DIRECTOR_*'] },
    my_cash_balance:  { name: 'Мои подотчётные',       icon: '💼', size: 'normal', roles: ['*'] },
    equipment_alerts: { name: 'Оборудование • Алерты', icon: '🛠', size: 'normal', roles: ['ADMIN','CHIEF_ENGINEER','WAREHOUSE','DIRECTOR_*'] },
    payroll_pending:  { name: 'Ведомости (ожидание)',   icon: '📋', size: 'normal', roles: ['ADMIN','BUH','PM','HEAD_PM','DIRECTOR_*'] },
    todo:             { name: 'Мои задачи',            icon: '✅', size: 'normal', roles: ['*'] },
    pre_tenders:      { name: 'Заявки',                icon: '🤖', size: 'normal', roles: ['ADMIN','HEAD_TO','DIRECTOR_*'] },
    bank_summary:     { name: 'Банковская сводка',     icon: '🏦', size: 'normal', roles: ['ADMIN','BUH','DIRECTOR_*'] },
    platform_alerts:  { name: 'Тендерные площадки',    icon: '🏗', size: 'normal', roles: ['ADMIN','TO','HEAD_TO','DIRECTOR_*'] },
    my_mail:          { name: 'Моя почта',             icon: '📧', size: 'normal', roles: ['*'] }
  },

  DEFAULT_LAYOUTS: {
    ADMIN:          ['welcome','kpi_summary','pre_tenders','quick_actions','overdue_works','tenders_funnel','my_mail','notifications'],
    PM:             ['welcome','quick_actions','my_works','my_cash_balance','gantt_mini','todo','my_mail','notifications','birthdays'],
    TO:             ['welcome','quick_actions','tenders_funnel','tender_dynamics','my_mail','notifications'],
    HEAD_TO:        ['welcome','pre_tenders','platform_alerts','tender_dynamics','tenders_funnel','my_mail','notifications'],
    HEAD_PM:        ['welcome','team_workload','overdue_works','gantt_mini','my_mail','notifications'],
    CHIEF_ENGINEER: ['welcome','equipment_value','equipment_alerts','my_mail','notifications'],
    HR:             ['welcome','permits_expiry','birthdays','my_mail','notifications','calendar'],
    HR_MANAGER:     ['welcome','permits_expiry','birthdays','team_workload','my_mail','notifications'],
    BUH:            ['welcome','cash_balance','bank_summary','money_summary','my_mail','notifications'],
    DEFAULT:        ['welcome','my_mail','notifications','todo','calendar','birthdays']
  },

  /* ─── Helpers ─── */
  _roleMatch: function (userRole, widgetRoles) {
    if (widgetRoles.indexOf('*') !== -1) return true;
    var r = userRole || '';
    for (var i = 0; i < widgetRoles.length; i++) {
      var wr = widgetRoles[i];
      if (wr.charAt(wr.length - 1) === '*' && r.indexOf(wr.slice(0, -1)) === 0) return true;
      if (wr === r) return true;
      if (r === 'HEAD_TO' && wr === 'TO') return true;
      if (r === 'HEAD_PM' && wr === 'PM') return true;
      if (r === 'HR_MANAGER' && wr === 'HR') return true;
      if (r === 'CHIEF_ENGINEER' && wr === 'WAREHOUSE') return true;
    }
    return false;
  },

  _getLayoutSync: function (userId, role) {
    if (role && role.indexOf('DIRECTOR') === 0) return this.DEFAULT_LAYOUTS.ADMIN.slice();
    return (this.DEFAULT_LAYOUTS[role] || this.DEFAULT_LAYOUTS.DEFAULT).slice();
  },

  _loadLayout: function (userId, role) {
    var self = this;
    return new Promise(function (resolve) {
      if (typeof AsgardDB !== 'undefined' && AsgardDB.get) {
        AsgardDB.get('settings', 'dash_layout_' + userId).then(function (s) {
          if (s && s.value_json) {
            try { resolve(JSON.parse(s.value_json)); return; } catch (e) { /* ignore */ }
          }
          resolve(self._getLayoutSync(userId, role));
        }).catch(function () {
          resolve(self._getLayoutSync(userId, role));
        });
      } else {
        resolve(self._getLayoutSync(userId, role));
      }
    });
  },

  _saveLayout: function (userId, layout) {
    if (typeof AsgardDB !== 'undefined' && AsgardDB.put) {
      AsgardDB.put('settings', { key: 'dash_layout_' + userId, value_json: JSON.stringify(layout) }).catch(function () {});
    }
  },

  /* ─── State for current render ─── */
  _state: null,

  /* ─── SYNC render ─── */
  render: function () {
    var el = Utils.el;
    var t = DS.t;
    var self = this;
    var user = Store.get('user');

    if (!user) {
      Router.navigate('/welcome', { replace: true });
      return el('div');
    }

    // State object
    var state = { layout: self._getLayoutSync(user.id, user.role), user: user, grid: null };
    self._state = state;

    var page = el('div', { style: { background: t.bg, minHeight: '100vh', paddingBottom: '120px' } });

    // Header
    page.appendChild(M.Header({
      title: 'Зал Ярла',
      subtitle: 'ASGARD CRM',
      back: false,
      actions: [{
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
        onClick: function () { self._showAddSheet(); }
      }]
    }));

    // Grid — Sber-style compact
    var grid = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 12px' } });
    grid.className = 'asgard-dash-grid';

    // Skeletons
    for (var i = 0; i < 4; i++) grid.appendChild(M.Skeleton({ type: 'card', count: 1 }));
    page.appendChild(grid);
    state.grid = grid;

    // FAB removed — "+" already in header actions

    // Fire-and-forget: load real layout → render widgets
    self._loadLayout(user.id, user.role).then(function (layout) {
      state.layout = layout;
      self._renderWidgets(state);
      self._initDragDrop(state);
    }).catch(function (e) {
      console.error('[Dashboard] layout load error', e);
      self._renderWidgets(state);
    });

    return page;
  },

  /* ─── Render widgets into grid ─── */
  _renderWidgets: function (state) {
    var el = Utils.el;
    var t = DS.t;
    var self = this;
    var grid = state.grid;
    var layout = state.layout;
    var user = state.user;

    grid.replaceChildren();

    layout.forEach(function (widgetId, index) {
      var wType = self.WIDGET_TYPES[widgetId];
      if (!wType) return;
      if (!self._roleMatch(user.role, wType.roles)) return;

      // Card wrapper — Sber-style depth (hero widgets get transparent wrapper)
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      var isHero = !!wType.hero;
      var card = el('div', {
        'data-wid': widgetId,
        'data-idx': '' + index,
        style: {
          background: isHero ? 'transparent' : t.surface,
          borderRadius: isHero ? '0' : '16px',
          border: isHero ? 'none' : (isDark ? '0.5px solid rgba(255,255,255,0.06)' : 'none'),
          overflow: 'hidden',
          boxShadow: isHero ? 'none' : (isDark
            ? '0 1px 2px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.15)'
            : '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.06)'),
          transition: 'transform 0.15s ease, box-shadow 0.2s ease, opacity 0.2s ease'
        }
      });

      // Widget header bar — skip for hero widgets (they render their own header)
      if (!isHero) {
        var hdr = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 16px 0' } });
        hdr.appendChild(el('span', { style: { fontSize: '14px', lineHeight: '1' } }, wType.icon));
        hdr.appendChild(el('span', { style: Object.assign({}, DS.font('sm'), { color: t.textSec, flex: '1', fontWeight: '600', letterSpacing: '0.2px' }) }, wType.name));
        card.appendChild(hdr);
      }

      // Widget content zone
      var content = el('div', {
        className: 'asgard-widget-body',
        style: { padding: isHero ? '0' : '12px 16px 16px', minHeight: isHero ? '0' : '60px' }
      });
      content.appendChild(M.Skeleton({ type: 'card', count: 1 }));
      card.appendChild(content);
      grid.appendChild(card);

      // Render widget (fire-and-forget)
      var widgetMod = (window.MobileWidgets || {})[widgetId];
      if (widgetMod && typeof widgetMod.render === 'function') {
        try {
          widgetMod.render(content, user);
        } catch (e) {
          console.error('[Dashboard] widget "' + widgetId + '" error:', e);
          content.replaceChildren(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.red, textAlign: 'center', padding: '16px 0' }) }, 'Ошибка загрузки'));
          M.Toast({ message: 'Виджет ' + wType.name + ': ошибка', type: 'error' });
        }
      } else {
        content.replaceChildren(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textTer, textAlign: 'center', padding: '16px 0' }) }, 'Виджет не загружен'));
      }
    });
  },

  /* ─── Refresh all widgets ─── */
  _refreshAll: function (state) {
    var self = this;
    var cards = state.grid.querySelectorAll('[data-wid]');
    cards.forEach(function (card) {
      var wid = card.getAttribute('data-wid');
      var content = card.querySelector('.asgard-widget-body');
      var widgetMod = (window.MobileWidgets || {})[wid];
      if (widgetMod && content) {
        content.replaceChildren(M.Skeleton({ type: 'card', count: 1 }));
        try { widgetMod.render(content, state.user); }
        catch (e) {
          console.error('[Dashboard] refresh "' + wid + '" error:', e);
          content.replaceChildren(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
        }
      }
    });
  },

  /* ─── Drag & Drop (long press) ─── */
  _initDragDrop: function (state) {
    var self = this;
    var grid = state.grid;
    var t = DS.t;
    var longTimer = null;
    var dragEl = null;
    var isDragging = false;
    var startY = 0;

    grid.addEventListener('touchstart', function (e) {
      var card = e.target.closest('[data-wid]');
      if (!card) return;
      startY = e.touches[0].clientY;
      longTimer = setTimeout(function () {
        isDragging = true;
        dragEl = card;
        card.style.opacity = '0.7';
        card.style.transform = 'scale(1.03)';
        card.style.boxShadow = t.shadowHover;
        card.style.zIndex = '' + DS.z.fab;
        try { navigator.vibrate(30); } catch (ex) { /* */ }
      }, 500);
    }, { passive: true });

    grid.addEventListener('touchmove', function (e) {
      if (!isDragging || !dragEl) {
        if (longTimer && Math.abs(e.touches[0].clientY - startY) > 10) {
          clearTimeout(longTimer); longTimer = null;
        }
        return;
      }
      e.preventDefault();
      var touchY = e.touches[0].clientY;
      var cards = Array.from(grid.querySelectorAll('[data-wid]'));
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        if (c === dragEl) continue;
        var rect = c.getBoundingClientRect();
        if (touchY > rect.top && touchY < rect.bottom) {
          var dragIdx = cards.indexOf(dragEl);
          var targetIdx = cards.indexOf(c);
          if (dragIdx < targetIdx) grid.insertBefore(dragEl, c.nextSibling);
          else grid.insertBefore(dragEl, c);
          break;
        }
      }
    }, { passive: false });

    grid.addEventListener('touchend', function () {
      clearTimeout(longTimer); longTimer = null;
      if (isDragging && dragEl) {
        dragEl.style.opacity = '';
        dragEl.style.transform = '';
        dragEl.style.boxShadow = '';
        dragEl.style.zIndex = '';
        // Save new order
        var newLayout = [];
        grid.querySelectorAll('[data-wid]').forEach(function (c) {
          var wid = c.getAttribute('data-wid');
          if (wid) newLayout.push(wid);
        });
        state.layout = newLayout;
        self._saveLayout(state.user.id, newLayout);
      }
      isDragging = false;
      dragEl = null;
    }, { passive: true });

    /* ─── Swipe to remove ─── */
    var swStartX = 0, swCard = null, swActive = false;

    grid.addEventListener('touchstart', function (e) {
      var card = e.target.closest('[data-wid]');
      if (!card) return;
      swStartX = e.touches[0].clientX;
      swCard = card;
      swActive = false;
    }, { passive: true });

    grid.addEventListener('touchmove', function (e) {
      if (!swCard) return;
      var dx = e.touches[0].clientX - swStartX;
      if (dx < -20) {
        swActive = true;
        swCard.style.transform = 'translateX(' + Math.max(dx, -100) + 'px)';
      }
    }, { passive: true });

    grid.addEventListener('touchend', function (e) {
      if (!swCard || !swActive) {
        if (swCard) swCard.style.transform = '';
        swCard = null; return;
      }
      var dx = e.changedTouches[0].clientX - swStartX;
      var card = swCard;
      swCard = null; swActive = false;

      if (dx < -80) {
        var wid = card.getAttribute('data-wid');
        var wName = (self.WIDGET_TYPES[wid] || {}).name || wid;
        M.Confirm({
          title: 'Убрать виджет?',
          message: '«' + wName + '» — можно вернуть через +',
          okText: 'Убрать', cancelText: 'Отмена', danger: true
        }).then(function (ok) {
          if (ok) {
            card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
            card.style.transform = 'translateX(-120%)';
            card.style.opacity = '0';
            setTimeout(function () {
              var idx = state.layout.indexOf(wid);
              if (idx !== -1) state.layout.splice(idx, 1);
              self._saveLayout(state.user.id, state.layout);
              card.remove();
            }, 300);
          } else {
            card.style.transition = 'transform 0.3s ease';
            card.style.transform = '';
            setTimeout(function () { card.style.transition = ''; }, 300);
          }
        });
      } else {
        card.style.transition = 'transform 0.3s ease';
        card.style.transform = '';
        setTimeout(function () { card.style.transition = ''; }, 300);
      }
    }, { passive: true });
  },

  /* ─── Add Widget Bottom Sheet ─── */
  _showAddSheet: function () {
    var el = Utils.el;
    var t = DS.t;
    var self = this;
    var state = self._state;
    if (!state) return;

    var currentSet = {};
    state.layout.forEach(function (id) { currentSet[id] = true; });

    var available = [];
    var keys = Object.keys(self.WIDGET_TYPES);
    for (var i = 0; i < keys.length; i++) {
      var id = keys[i];
      var w = self.WIDGET_TYPES[id];
      if (currentSet[id]) continue;
      if (!self._roleMatch(state.user.role, w.roles)) continue;
      available.push({ id: id, w: w });
    }

    if (!available.length) {
      M.Toast({ message: 'Все виджеты добавлены', type: 'info' });
      return;
    }

    var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });

    available.forEach(function (item) {
      var row = el('div', { style: {
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '14px 16px', background: t.surfaceAlt, borderRadius: '14px',
        cursor: 'pointer', border: '1px solid ' + t.border
      } });

      row.appendChild(el('span', { style: { fontSize: '24px' } }, item.w.icon));
      var info = el('div', { style: { flex: '1' } });
      info.appendChild(el('div', { style: Object.assign({}, DS.font('base'), { color: t.text, fontWeight: '600' }) }, item.w.name));
      if (item.w.size === 'wide') {
        info.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textTer }) }, 'Широкий'));
      }
      row.appendChild(info);

      var plus = el('div', { style: {
        width: '32px', height: '32px', borderRadius: '10px',
        background: t.blueBg, color: t.blue,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '18px', fontWeight: '700', flexShrink: '0'
      } }, '+');
      row.appendChild(plus);

      row.addEventListener('click', function () {
        state.layout.push(item.id);
        self._saveLayout(state.user.id, state.layout);
        self._renderWidgets(state);
        self._initDragDrop(state);
        M.Toast({ message: item.w.name + ' добавлен', type: 'success' });
        var overlay = document.querySelector('.asgard-bottomsheet-overlay');
        if (overlay) overlay.click();
      });

      content.appendChild(row);
    });

    M.BottomSheet({ title: 'Добавить виджет', content: content });
  }
};

/* ─── Register routes ─── */
if (typeof Router !== 'undefined') {
  Router.register('/home', DashboardPage);
  Router.register('/my-dashboard', DashboardPage);
}
if (typeof window !== 'undefined') window.DashboardPage = DashboardPage;
