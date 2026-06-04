export const ROLE_PERMISSIONS = {
  ADMIN:          ['*'],
  DIRECTOR_GEN:   ['*'],
  HEAD_PM:        ['dashboard', 'tasks', 'chat', 'tenders', 'approvals', 'finances', 'works', 'personnel', 'profile', 'settings'],
  PM:             ['dashboard', 'tasks', 'chat', 'tenders', 'works', 'finances', 'profile', 'settings'],
  TO:             ['dashboard', 'tasks', 'chat', 'tenders', 'works', 'personnel', 'profile', 'settings'],
  BUH:            ['dashboard', 'tasks', 'chat', 'tenders', 'approvals', 'finances', 'works', 'personnel', 'profile', 'settings'],
  DIRECTOR_DEV:   ['dashboard', 'tasks', 'chat', 'tenders', 'approvals', 'finances', 'works', 'personnel', 'profile', 'settings'],
  DIRECTOR_COMM:  ['dashboard', 'tasks', 'chat', 'tenders', 'approvals', 'finances', 'works', 'personnel', 'profile', 'settings'],
  OFFICE_MANAGER: ['dashboard', 'tasks', 'chat', 'tenders', 'finances', 'works', 'personnel', 'profile', 'settings'],
  CHIEF_ENGINEER: ['dashboard', 'tasks', 'chat', 'tenders', 'finances', 'works', 'personnel', 'profile', 'settings'],
  PROC:           ['dashboard', 'tasks', 'chat', 'finances', 'works', 'profile', 'settings'],
  WAREHOUSE:      ['dashboard', 'tasks', 'chat', 'works', 'personnel', 'profile', 'settings'],
  HEAD_TO:        ['dashboard', 'tasks', 'chat', 'tenders', 'works', 'personnel', 'finances', 'profile', 'settings'],
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
  '/approvals': 'approvals',
  '/finances':  'finances',
  '/personnel': 'personnel',
  '/profile':   'profile',
  '/settings':       'settings',
  '/call-analytics': 'dashboard',
  '/global-timesheet':   'personnel',
  '/training-board':     'personnel',
  '/payroll-dashboard':  'finances',
  '/official-employees': 'finances',
  '/pm-balance':         'finances',
  '/staff-requests':     'works',
};
