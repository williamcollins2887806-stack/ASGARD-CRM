/**
 * ASGARD CRM — Mobile v3 / Role-Based Access Control
 * Матрица доступа: route → [разрешённые роли]
 * Whitelist — если маршрута нет в RESTRICTED, он общедоступный
 *
 * Синхронизировано с: router.js MENU_SECTIONS, backend role_presets
 */
(function () {
  'use strict';

  // ── Публичные маршруты (без авторизации) ──
  var PUBLIC_ROUTES = ['/welcome', '/login', '/register'];

  // ── Общие маршруты (все авторизованные пользователи) ──
  var COMMON_ROUTES = [
    '/home', '/my-dashboard', '/more', '/profile',
    '/tasks', '/messenger', '/mimir', '/mimir-page',
    '/alerts', '/training', '/meetings', '/my-mail',
    '/warehouse', '/worker-profiles',
  ];

  // ── Ограниченные маршруты: route → [разрешённые роли] ──
  // '*' внутри массива = все роли (на всякий случай)
  // 'DIRECTOR_*' = DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV
  var RESTRICTED = {
    // Управление задачами — почти все кроме TO
    '/tasks-admin': ['ADMIN', 'PM', 'HEAD_PM', 'HEAD_TO', 'BUH', 'HR', 'HR_MANAGER', 'OFFICE_MANAGER', 'PROC', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_*'],

    // Тендеры
    '/pre-tenders': ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_*'],
    '/funnel':      ['ADMIN', 'PM', 'DIRECTOR_*'],
    '/tenders':     ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'CHIEF_ENGINEER', 'DIRECTOR_*'],
    '/customers':   ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_*'],

    // Работы
    '/pm-calcs':      ['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_*'],
    '/approvals':     ['ADMIN', 'BUH', 'HEAD_PM', 'DIRECTOR_*'],
    '/all-estimates': ['ADMIN', 'PM', 'TO', 'HEAD_PM', 'HEAD_TO', 'BUH', 'CHIEF_ENGINEER', 'DIRECTOR_*'],
    '/pm-works':      ['ADMIN', 'PM', 'TO', 'HEAD_PM', 'HEAD_TO', 'CHIEF_ENGINEER', 'DIRECTOR_*'],
    '/all-works':     ['ADMIN', 'PM', 'TO', 'HEAD_PM', 'HEAD_TO', 'CHIEF_ENGINEER', 'DIRECTOR_*'],
    '/gantt':         ['ADMIN', 'PM', 'TO', 'HEAD_PM', 'HEAD_TO', 'CHIEF_ENGINEER', 'DIRECTOR_*'],

    // Финансы
    '/cash':             ['ADMIN', 'PM', 'HEAD_PM', 'BUH', 'OFFICE_MANAGER', 'PROC', 'DIRECTOR_*'],
    '/cash-admin':       ['ADMIN', 'BUH', 'DIRECTOR_*'],
    '/approval-payment': ['ADMIN', 'PM', 'HEAD_PM', 'BUH', 'OFFICE_MANAGER', 'PROC', 'DIRECTOR_*'],
    '/finances':         ['ADMIN', 'BUH', 'DIRECTOR_*'],
    '/payroll':          ['ADMIN', 'PM', 'HEAD_PM', 'BUH', 'DIRECTOR_*'],
    '/office-expenses':  ['ADMIN', 'HR', 'HR_MANAGER', 'OFFICE_MANAGER', 'DIRECTOR_*'],
    '/invoices':         ['ADMIN', 'PM', 'BUH', 'PROC', 'DIRECTOR_*'],
    '/acts':             ['ADMIN', 'PM', 'BUH', 'DIRECTOR_*'],

    // Заявки
    '/pass-requests': ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'HR', 'HR_MANAGER', 'OFFICE_MANAGER', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_*'],
    '/tmc-requests':  ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'BUH', 'PROC', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_*'],
    '/proc-requests': ['ADMIN', 'PM', 'PROC', 'DIRECTOR_*'],

    // Персонал
    '/personnel':        ['ADMIN', 'PM', 'TO', 'HEAD_PM', 'HEAD_TO', 'HR', 'HR_MANAGER', 'BUH', 'OFFICE_MANAGER', 'CHIEF_ENGINEER', 'DIRECTOR_*'],
    '/permits':          ['ADMIN', 'PM', 'TO', 'HEAD_TO', 'HR', 'HR_MANAGER', 'CHIEF_ENGINEER', 'DIRECTOR_*'],
    '/hr-requests':      ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_*'],
    '/workers-schedule': ['ADMIN', 'PM', 'TO', 'HEAD_PM', 'HEAD_TO', 'HR', 'HR_MANAGER', 'CHIEF_ENGINEER', 'DIRECTOR_*'],
    '/travel':           ['ADMIN', 'PM', 'TO', 'HEAD_PM', 'HEAD_TO', 'HR', 'HR_MANAGER', 'OFFICE_MANAGER', 'CHIEF_ENGINEER', 'DIRECTOR_*'],

    // Коммуникации (ограниченные)
    '/correspondence': ['ADMIN', 'PM', 'TO', 'HEAD_PM', 'HEAD_TO', 'HR', 'HR_MANAGER', 'BUH', 'OFFICE_MANAGER', 'PROC', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_*'],

    // Склад/оборудование
    '/my-equipment': ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'PROC', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_*'],

    // Документы
    '/contracts': ['ADMIN', 'PM', 'OFFICE_MANAGER', 'BUH', 'DIRECTOR_*'],
    '/seals':     ['ADMIN', 'OFFICE_MANAGER', 'DIRECTOR_*'],
    '/proxies':   ['ADMIN', 'OFFICE_MANAGER', 'DIRECTOR_*'],

    // Система (только админ)
    '/settings':     ['ADMIN'],
    '/telegram':     ['ADMIN'],
    '/integrations': ['ADMIN', 'BUH', 'DIRECTOR_*'],
    '/diag':         ['ADMIN'],
    '/test':         ['ADMIN'],
    '/test2':        ['ADMIN'],
    '/backup':       ['ADMIN'],
  };

  // ── Маппинг детальных маршрутов на родительские ──
  // /tender/123 → проверяем доступ к /tenders
  var DETAIL_TO_LIST = {
    '/tender':    '/tenders',
    '/employee':  '/personnel',
    '/customer':  '/customers',
    '/contract':  '/contracts',
    '/estimate':  '/all-estimates',
    '/work':      '/all-works',
    '/invoice':   '/invoices',
    '/act':       '/acts',
    '/permit':    '/permits',
    '/meeting':   '/meetings',
    '/pre-tender': '/pre-tenders',
  };

  // ── Нормализация маршрута ──
  function normalizeRoute(path) {
    var p = (path || '').split('?')[0];
    // Берём первый сегмент: /tender/123 → /tender
    var parts = p.split('/').filter(Boolean);
    var base = parts.length ? '/' + parts[0] : '/';
    return DETAIL_TO_LIST[base] || base;
  }

  // ── Проверка роли в массиве разрешённых ──
  function roleInList(role, allowed) {
    if (!allowed || !allowed.length) return false;
    if (allowed.indexOf('*') !== -1) return true;
    if (allowed.indexOf(role) !== -1) return true;
    // DIRECTOR_* wildcard
    if (role && role.indexOf('DIRECTOR') === 0 && allowed.indexOf('DIRECTOR_*') !== -1) return true;
    return false;
  }

  // ═══ PUBLIC API ═══

  /**
   * Проверить доступ роли к маршруту
   * @param {string} role — ADMIN, PM, TO, etc.
   * @param {string} route — /tenders, /cash, /tender/123, etc.
   * @returns {boolean}
   */
  function hasAccess(role, route) {
    if (!role || !route) return false;

    var normalized = normalizeRoute(route);

    // Публичные маршруты — всегда доступны
    if (PUBLIC_ROUTES.indexOf(normalized) !== -1) return true;

    // Общие маршруты — все авторизованные пользователи
    if (COMMON_ROUTES.indexOf(normalized) !== -1) return true;

    // Ограниченные маршруты — проверяем по матрице
    var allowed = RESTRICTED[normalized];
    if (allowed) return roleInList(role, allowed);

    // Маршрут не в RESTRICTED и не в COMMON → разрешаем (неизвестный маршрут)
    return true;
  }

  /**
   * Отфильтровать массив пунктов меню по роли
   * @param {Array} items — [{path: '/tenders', ...}, ...]
   * @param {string} role
   * @returns {Array}
   */
  function filterMenu(items, role) {
    if (!role || !items) return items || [];
    return items.filter(function (item) {
      if (!item.path) return true; // Items без path (theme toggle etc.) — всегда показываем
      return hasAccess(role, item.path);
    });
  }

  /**
   * Получить все разрешённые маршруты для роли
   * @param {string} role
   * @returns {string[]|null} null = полный доступ
   */
  function getAllowedRoutes(role) {
    if (!role) return [];
    // ADMIN и DIRECTOR_* — полный доступ
    if (role === 'ADMIN' || role.indexOf('DIRECTOR') === 0) return null;
    var result = COMMON_ROUTES.slice();
    for (var route in RESTRICTED) {
      if (RESTRICTED.hasOwnProperty(route) && roleInList(role, RESTRICTED[route])) {
        result.push(route);
      }
    }
    return result;
  }

  // ── Экспорт ──
  window.RoleAccess = {
    hasAccess: hasAccess,
    filterMenu: filterMenu,
    getAllowedRoutes: getAllowedRoutes,
    normalizeRoute: normalizeRoute,
    _RESTRICTED: RESTRICTED,
    _COMMON: COMMON_ROUTES,
  };

})();
