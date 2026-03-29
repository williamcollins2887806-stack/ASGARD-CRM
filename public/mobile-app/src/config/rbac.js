export const ROLE_PERMISSIONS = {
  ADMIN:          ['*'],
  DIRECTOR_GEN:   ['*'],
  HEAD_PM:        ['dashboard', 'tasks', 'chat', 'tenders', 'approvals', 'finances', 'works', 'personnel', 'profile', 'settings'],
  PM:             ['dashboard', 'tasks', 'chat', 'tenders', 'works', 'finances', 'profile', 'settings'],
  TO:             ['dashboard', 'tasks', 'chat', 'tenders', 'works', 'profile', 'settings'],
  BUH:            ['dashboard', 'tasks', 'chat', 'tenders', 'approvals', 'finances', 'works', 'profile', 'settings'],
  DIRECTOR_DEV:   ['dashboard', 'tasks', 'chat', 'tenders', 'approvals', 'finances', 'works', 'personnel', 'profile', 'settings'],
  DIRECTOR_COMM:  ['dashboard', 'tasks', 'chat', 'tenders', 'approvals', 'finances', 'works', 'personnel', 'profile', 'settings'],
  OFFICE_MANAGER: ['dashboard', 'tasks', 'chat', 'tenders', 'finances', 'works', 'personnel', 'profile', 'settings'],
  CHIEF_ENGINEER: ['dashboard', 'tasks', 'chat', 'tenders', 'finances', 'works', 'personnel', 'profile', 'settings'],
  PROC:           ['dashboard', 'tasks', 'chat', 'finances', 'works', 'profile', 'settings'],
  WAREHOUSE:      ['dashboard', 'tasks', 'chat', 'works', 'profile', 'settings'],
  HEAD_TO:        ['dashboard', 'tasks', 'chat', 'tenders', 'works', 'personnel', 'profile', 'settings'],
  HR:             ['dashboard', 'tasks', 'chat', 'personnel', 'profile', 'settings'],
  HR_MANAGER:     ['dashboard', 'tasks', 'chat', 'personnel', 'profile', 'settings'],
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
};
