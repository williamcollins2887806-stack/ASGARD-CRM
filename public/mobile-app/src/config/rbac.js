export const ROLE_PERMISSIONS = {
  ADMIN:          ['*'],
  DIRECTOR_GEN:   ['*'],
  HEAD_PM:        ['dashboard', 'tasks', 'chat', 'tenders', 'approvals', 'finances', 'works', 'personnel', 'profile', 'settings', 'inbox', 'personal_kanban', 'marketplace'],
  PM:             ['dashboard', 'tasks', 'chat', 'tenders', 'works', 'finances', 'profile', 'settings', 'personal_kanban', 'marketplace'],
  // D-369 (23.10.2026): TO и WAREHOUSE раньше не имели `finances`.
  // ПЕРВАЯ попытка добавить им `finances` дала ЭСКАЛАЦИЮ ПРАВ (нашёл
  // верификатор): под этой секцией 11 пунктов, включая /invoices и /acts —
  // реестры счетов и актов заказчиков с суммами и ИНН. На десктопе у TO и
  // склада эти разделы закрыты (app.js:294). Кладовщик видел 15,5 млн по АЗОТу.
  //
  // Поэтому `finances` НЕ добавляем. Страница «Мои заявки» живёт в секции
  // `works`, которая у них уже есть, а доступ к ней дополнительно ограничен
  // списком ролей в пункте меню и в ROUTE_SECTIONS.
  TO:             ['dashboard', 'tasks', 'chat', 'tenders', 'works', 'personnel', 'profile', 'settings', 'personal_kanban'],
  BUH:            ['dashboard', 'tasks', 'chat', 'tenders', 'approvals', 'finances', 'works', 'personnel', 'profile', 'settings'],
  DIRECTOR_DEV:   ['dashboard', 'tasks', 'chat', 'tenders', 'approvals', 'finances', 'works', 'personnel', 'profile', 'settings', 'inbox', 'personal_kanban'],
  DIRECTOR_COMM:  ['dashboard', 'tasks', 'chat', 'tenders', 'approvals', 'finances', 'works', 'personnel', 'profile', 'settings', 'inbox', 'personal_kanban'],
  OFFICE_MANAGER: ['dashboard', 'tasks', 'chat', 'tenders', 'finances', 'works', 'personnel', 'profile', 'settings'],
  CHIEF_ENGINEER: ['dashboard', 'tasks', 'chat', 'tenders', 'finances', 'works', 'personnel', 'profile', 'settings'],
  PROC:           ['dashboard', 'tasks', 'chat', 'finances', 'works', 'profile', 'settings'],
  WAREHOUSE:      ['dashboard', 'tasks', 'chat', 'works', 'personnel', 'profile', 'settings'],
  HEAD_TO:        ['dashboard', 'tasks', 'chat', 'tenders', 'works', 'personnel', 'finances', 'profile', 'settings', 'personal_kanban'],
  HR:             ['dashboard', 'tasks', 'chat', 'personnel', 'finances', 'profile', 'settings'],
  HR_MANAGER:     ['dashboard', 'tasks', 'chat', 'personnel', 'finances', 'profile', 'settings'],
};

export function hasPermission(userRole, section) {
  if (!userRole || !ROLE_PERMISSIONS[userRole]) return false;
  const perms = ROLE_PERMISSIONS[userRole];
  return perms.includes('*') || perms.includes(section);
}

export const ROUTE_SECTIONS = {
  '/':          'dashboard',
  '/tasks':     'tasks',
  '/chat':      'chat',
  '/chat/:id':  'chat',
  '/mimir':     'chat',
  '/works':     'works',
  '/tenders':   'tenders',
  '/tenders/platform': 'tenders',
  '/tenders/tenderguru-settings': 'tenders',
  '/to-calcs': 'tenders',
  '/head-to-approvals': 'tenders',
  '/approvals': 'approvals',
  '/finances':  'finances',
  '/personnel': 'personnel',
  '/profile':   'profile',
  '/settings':       'settings',
  '/call-analytics': 'dashboard',
  '/telephony': 'dashboard',
  '/telephony/missed': 'dashboard',
  '/telephony/history': 'dashboard',
  '/telephony/calls/:id': 'dashboard',
  '/global-timesheet':   'personnel',
  '/timesheet':              'personnel',
  '/timesheet-warehouse':    'personnel',
  '/timesheet-medical':      'personnel',
  '/timesheet-travel':       'personnel',
  '/my-timesheet':           'works',
  '/training-board':     'personnel',
  '/payroll-dashboard':  'finances',
  '/official-employees': 'finances',
  '/pm-balance':         'finances',
  '/staff-requests':     'works',
  '/personal-kanban':        'personal_kanban',
  '/personal-kanban-config': 'personal_kanban',
  '/director-inbox':         'inbox',
  '/marketplace':            'marketplace',
  // D-369 (23.10.2026): «Мои заявки». Секция `works`, а НЕ `finances`: под
  // `finances` лежат /invoices и /acts (реестры счетов и актов заказчиков), и
  // выдача этой секции TO/складу открыла бы им чужие деньги — эскалация прав,
  // которой на десктопе нет. Конкретный маршрут ограничен списком ролей ниже.
  '/my-requests':            'works',
};
