/**
 * ASGARD CRM — Mobile v3 Router
 * Сессия 15.5: Бургер-меню «Ещё» + каталог всех маршрутов
 *
 * Все страницы уже сами регистрируются через Router.register()
 * при загрузке соответствующего <script>. Здесь мы:
 * 1. Описываем карту ROUTES для бургер-меню
 * 2. Регистрируем страницу /more (бургер-меню)
 */
(function () {
  'use strict';

  // ── Каталог маршрутов для бургер-меню ──────────────────────────
  var MENU_SECTIONS = [
    {
      id: 'main', label: 'Главная', icon: '🏠',
      items: [
        { path: '/home',         title: 'Дашборд',         icon: '🏠', roles: ['*'] },
        { path: '/my-dashboard', title: 'Мой дашборд',     icon: '📊', roles: ['*'] },
        { path: '/tasks',        title: 'Задачи',          icon: '✅', roles: ['*'] },
        { path: '/tasks-admin',  title: 'Управление задачами', icon: '📋', roles: ['ADMIN'] },
        { path: '/alerts',       title: 'Уведомления',     icon: '🔔', roles: ['*'] },
      ]
    },
    {
      id: 'tenders', label: 'Тендеры', icon: '📨',
      items: [
        { path: '/pre-tenders', title: 'Заявки',       icon: '📨', roles: ['ADMIN','TO','HEAD_TO','DIRECTOR_*'] },
        { path: '/funnel',      title: 'Воронка',      icon: '📊', roles: ['ADMIN','TO','HEAD_TO','DIRECTOR_*'] },
        { path: '/tenders',     title: 'Тендеры',      icon: '📋', roles: ['ADMIN','TO','HEAD_TO','DIRECTOR_*'] },
        { path: '/customers',   title: 'Контрагенты',  icon: '🏢', roles: ['ADMIN','TO','HEAD_TO','PM','HEAD_PM','DIRECTOR_*'] },
      ]
    },
    {
      id: 'works', label: 'Работы', icon: '🔧',
      items: [
        { path: '/pm-calcs',      title: 'Просчёты',      icon: '🧮', roles: ['ADMIN','PM','HEAD_PM','DIRECTOR_*'] },
        { path: '/approvals',     title: 'Согласования',   icon: '✅', roles: ['ADMIN','HEAD_PM','DIRECTOR_*'] },
        { path: '/all-estimates', title: 'Все расчёты',    icon: '📊', roles: ['ADMIN','BUH','HEAD_PM','DIRECTOR_*'] },
        { path: '/pm-works',     title: 'Мои работы',      icon: '🔧', roles: ['ADMIN','PM','HEAD_PM','DIRECTOR_*'] },
        { path: '/all-works',    title: 'Все работы',      icon: '📋', roles: ['ADMIN','HEAD_PM','DIRECTOR_*'] },
        { path: '/gantt',        title: 'Дедлайны',        icon: '📅', roles: ['ADMIN','PM','HEAD_PM','DIRECTOR_*'] },
      ]
    },
    {
      id: 'finance', label: 'Финансы', icon: '💰',
      items: [
        { path: '/cash',             title: 'Касса',             icon: '💰', roles: ['ADMIN','PM','DIRECTOR_*'] },
        { path: '/cash-admin',       title: 'Касса (управление)',icon: '💵', roles: ['ADMIN','BUH','DIRECTOR_*'] },
        { path: '/approval-payment', title: 'Очередь оплаты',   icon: '💳', roles: ['ADMIN','BUH','DIRECTOR_*'] },
        { path: '/finances',         title: 'Финансы',           icon: '📊', roles: ['ADMIN','BUH','DIRECTOR_*'] },
        { path: '/payroll',          title: 'Ведомости',         icon: '💰', roles: ['ADMIN','PM','HEAD_PM','BUH','DIRECTOR_*'] },
        { path: '/office-expenses',  title: 'Офисные расходы',   icon: '🏢', roles: ['ADMIN','OFFICE_MANAGER','DIRECTOR_*'] },
        { path: '/invoices',         title: 'Счета',             icon: '📄', roles: ['ADMIN','PM','BUH','DIRECTOR_*'] },
        { path: '/acts',             title: 'Акты',              icon: '📋', roles: ['ADMIN','PM','BUH','DIRECTOR_*'] },
      ]
    },
    {
      id: 'requests', label: 'Заявки', icon: '📦',
      items: [
        { path: '/pass-requests', title: 'Пропуска',     icon: '🎫', roles: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','HR','HR_MANAGER','DIRECTOR_*'] },
        { path: '/tmc-requests',  title: 'Заявки ТМЦ',   icon: '📦', roles: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','BUH','DIRECTOR_*'] },
        { path: '/proc-requests', title: 'Закупки',       icon: '🛒', roles: ['ADMIN','PROC','DIRECTOR_*'] },
      ]
    },
    {
      id: 'personnel', label: 'Персонал', icon: '👥',
      items: [
        { path: '/personnel',        title: 'Дружина',          icon: '👥', roles: ['ADMIN','HR','HR_MANAGER','DIRECTOR_*'] },
        { path: '/permits',          title: 'Допуски',          icon: '🛡️', roles: ['ADMIN','HR','HR_MANAGER','TO','HEAD_TO','PM','CHIEF_ENGINEER','DIRECTOR_*'] },
        { path: '/hr-requests',      title: 'Заявки HR',        icon: '👤', roles: ['ADMIN','HR','HR_MANAGER','DIRECTOR_*'] },
        { path: '/training',         title: 'Обучение',         icon: '📚', roles: ['*'] },
        { path: '/workers-schedule', title: 'График рабочих',   icon: '📅', roles: ['ADMIN','HR','HR_MANAGER','DIRECTOR_*'] },
        { path: '/travel',           title: 'Командировки',     icon: '✈️', roles: ['ADMIN','OFFICE_MANAGER','HR','HR_MANAGER','PM','DIRECTOR_*'] },
      ]
    },
    {
      id: 'comms', label: 'Коммуникации', icon: '💬',
      items: [
        { path: '/messenger',      title: 'Хугинн',          icon: '💬', roles: ['*'] },
        { path: '/my-mail',        title: 'Моя почта',        icon: '✉️', roles: ['*'] },
        { path: '/correspondence', title: 'Корреспонденция',  icon: '📨', roles: ['ADMIN','OFFICE_MANAGER','DIRECTOR_*'] },
        { path: '/meetings',       title: 'Совещания',        icon: '🤝', roles: ['*'] },
      ]
    },
    {
      id: 'warehouse', label: 'Склад', icon: '📦',
      items: [
        { path: '/warehouse',    title: 'Склад',             icon: '📦', roles: ['*'] },
        { path: '/my-equipment', title: 'Моё оборудование',  icon: '🔧', roles: ['PM','HEAD_PM','CHIEF_ENGINEER','DIRECTOR_*','ADMIN'] },
      ]
    },
    {
      id: 'docs', label: 'Документы', icon: '📄',
      items: [
        { path: '/contracts', title: 'Договоры',       icon: '📄', roles: ['ADMIN','OFFICE_MANAGER','BUH','DIRECTOR_*'] },
        { path: '/seals',    title: 'Печати',          icon: '🔏', roles: ['ADMIN','OFFICE_MANAGER','DIRECTOR_*'] },
        { path: '/proxies',  title: 'Доверенности',    icon: '📜', roles: ['ADMIN','OFFICE_MANAGER','DIRECTOR_*'] },
      ]
    },
    {
      id: 'system', label: 'Система', icon: '⚙️',
      items: [
        { path: '/settings',     title: 'Настройки',    icon: '⚙️', roles: ['ADMIN'] },
        { path: '/telegram',     title: 'Telegram',     icon: '📱', roles: ['ADMIN'] },
        { path: '/integrations', title: 'Интеграции',   icon: '🔗', roles: ['ADMIN','BUH','DIRECTOR_*'] },
        // backup removed — backend route does not exist
        { path: '/diag',         title: 'Диагностика',  icon: '🔍', roles: ['ADMIN'] },
        { path: '/test',         title: 'UI Kit',        icon: '🧪', roles: ['ADMIN'] },
      ]
    },
  ];

  // ── Проверка роли ─────────────────────────────────────────────
  function matchRole(userRole, allowedRoles) {
    if (!allowedRoles || !allowedRoles.length) return true;
    if (allowedRoles.indexOf('*') !== -1) return true;
    if (allowedRoles.indexOf(userRole) !== -1) return true;
    // DIRECTOR_* matches DIRECTOR, DIRECTOR_GENERAL, etc.
    if (userRole && userRole.indexOf('DIRECTOR') === 0) {
      if (allowedRoles.indexOf('DIRECTOR_*') !== -1) return true;
    }
    return false;
  }

  // ── Страница «Ещё» (бургер-меню) ─────────────────────────────
  var MorePage = {
    render: function () {
      var t = (typeof DS !== 'undefined' && DS.t) ? DS.t : {};
      var user = Store.get('user') || {};
      var role = user.role || '';

      var page = document.createElement('div');
      page.className = 'asgard-more-page';
      page.style.cssText = 'padding:0 0 32px 0;';

      // ── Профиль-хедер ──
      var profileCard = document.createElement('div');
      profileCard.style.cssText = [
        'display:flex;align-items:center;gap:14px;',
        'padding:20px;margin:0 0 8px 0;',
        'cursor:pointer;',
      ].join('');
      profileCard.addEventListener('click', function () { Router.navigate('/profile'); });

      var avatarSize = 52;
      var avatar = document.createElement('div');
      avatar.style.cssText = [
        'width:' + avatarSize + 'px;height:' + avatarSize + 'px;',
        'border-radius:50%;',
        'background:var(--hero-grad, linear-gradient(135deg, #3B82F6, #EF4444));',
        'display:flex;align-items:center;justify-content:center;',
        'font-size:20px;font-weight:700;color:#fff;',
        'flex-shrink:0;',
      ].join('');
      var initials = ((user.first_name || '?')[0] + (user.last_name || '')[0]).toUpperCase();
      avatar.textContent = initials;
      if (user.avatar_url) {
        avatar.style.backgroundImage = 'url(' + user.avatar_url + ')';
        avatar.style.backgroundSize = 'cover';
        avatar.textContent = '';
      }

      var info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      var nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-size:16px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      nameEl.textContent = (user.first_name || '') + ' ' + (user.last_name || '');
      var roleEl = document.createElement('div');
      roleEl.style.cssText = 'font-size:12px;color:var(--text-sec);margin-top:2px;';
      roleEl.textContent = user.role_display || role || 'Пользователь';
      info.appendChild(nameEl);
      info.appendChild(roleEl);

      var arrow = document.createElement('div');
      arrow.style.cssText = 'color:var(--text-sec);font-size:18px;flex-shrink:0;';
      arrow.textContent = '›';

      profileCard.appendChild(avatar);
      profileCard.appendChild(info);
      profileCard.appendChild(arrow);
      page.appendChild(profileCard);

      // ── Разделы меню ──
      MENU_SECTIONS.forEach(function (section) {
        // Фильтруем items по роли
        var visibleItems = section.items.filter(function (item) {
          return matchRole(role, item.roles);
        });
        if (!visibleItems.length) return;

        // Секция
        var sectionEl = document.createElement('div');
        sectionEl.style.cssText = 'margin:0 0 4px 0;';

        // Заголовок секции
        var headerEl = document.createElement('div');
        headerEl.style.cssText = [
          'padding:12px 20px 6px;',
          'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;',
          'color:var(--text-sec);opacity:0.7;',
        ].join('');
        headerEl.textContent = section.label;
        sectionEl.appendChild(headerEl);

        // Items
        visibleItems.forEach(function (item) {
          var row = document.createElement('a');
          row.href = '#' + item.path;
          row.style.cssText = [
            'display:flex;align-items:center;gap:14px;',
            'padding:13px 20px;text-decoration:none;',
            'transition:background 0.15s;',
          ].join('');
          row.addEventListener('click', function (e) {
            e.preventDefault();
            Router.navigate(item.path);
          });

          // Active highlight
          var currentPath = (Router.current && Router.current()) ? Router.current().path : '';
          if (currentPath === item.path) {
            row.style.background = 'var(--bg1, rgba(59,130,246,0.08))';
          }

          var iconEl = document.createElement('span');
          iconEl.style.cssText = 'font-size:20px;width:28px;text-align:center;flex-shrink:0;';
          iconEl.textContent = item.icon;

          var labelEl = document.createElement('span');
          labelEl.style.cssText = 'font-size:15px;color:var(--text);font-weight:500;';
          labelEl.textContent = item.title;

          row.appendChild(iconEl);
          row.appendChild(labelEl);
          sectionEl.appendChild(row);
        });

        page.appendChild(sectionEl);
      });

      // ── Выход ──
      var logoutWrap = document.createElement('div');
      logoutWrap.style.cssText = 'padding:24px 20px 0;';
      var logoutBtn = document.createElement('button');
      logoutBtn.style.cssText = [
        'width:100%;padding:14px;border:none;border-radius:12px;',
        'background:var(--bg1, #f5f5f5);color:var(--red, #EF4444);',
        'font-size:15px;font-weight:600;cursor:pointer;',
        'transition:opacity 0.15s;',
      ].join('');
      logoutBtn.textContent = '🚪 Выйти из аккаунта';
      logoutBtn.addEventListener('click', function () {
        if (typeof M !== 'undefined' && M.Confirm) {
          M.Confirm({
            title: 'Выход',
            message: 'Вы уверены, что хотите выйти?',
            confirmLabel: 'Выйти',
            cancelLabel: 'Отмена',
          }).then(function (ok) {
            if (ok) doLogout();
          });
        } else {
          if (confirm('Выйти из аккаунта?')) doLogout();
        }
      });
      logoutWrap.appendChild(logoutBtn);
      page.appendChild(logoutWrap);

      // ── Версия ──
      var versionEl = document.createElement('div');
      versionEl.style.cssText = 'padding:16px 20px;text-align:center;font-size:11px;color:var(--text-sec);opacity:0.5;';
      versionEl.textContent = 'ASGARD CRM Mobile v3.0 · Сессия 15.5';
      page.appendChild(versionEl);

      return page;
    }
  };

  function doLogout() {
    Store.set('user', null);
    Store.set('token', null);
    if (typeof API !== 'undefined' && API.clearToken) API.clearToken();
    // Clear IDB
    if (typeof IDB !== 'undefined' && IDB.clear) {
      try { IDB.clear(); } catch (e) {}
    }
    Router.navigate('/welcome', { replace: true });
  }

  // ── Регистрация /more ─────────────────────────────────────────
  // more_menu.js уже регистрирует MoreMenuPage на /more.
  // Регистрируем только если маршрут ещё не занят.
  if (typeof Router !== 'undefined' && !Router.has('/more')) {
    Router.register('/more', MorePage);
  }

  // ── Экспорт для внешнего использования ────────────────────────
  window.MobileMenuSections = MENU_SECTIONS;
  window.MobileMatchRole = matchRole;

})();
