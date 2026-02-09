const { api, ROLES, assert } = require('../config');

/**
 * Матрица доступа: какие роли должны получить доступ, а какие — 403/401.
 *
 * Формат: [метод, путь, разрешённые роли]
 *
 * Примечание: ADMIN всегда проходит (серверная логика).
 * Роли-наследники: HEAD_TO→TO, HEAD_PM→PM, HR_MANAGER→HR, CHIEF_ENGINEER→WAREHOUSE
 * Многие эндпоинты используют просто authenticate (любой авторизованный пользователь).
 * Здесь тестируем только те, где есть явные requireRoles/requirePermission.
 */
const ACCESS_MATRIX = [
  // Тендеры — authenticate, доступ всем
  ['GET',  '/api/tenders',             ROLES],

  // Тендеры: удаление — ADMIN + DIRECTOR_GEN
  ['DELETE', '/api/tenders/999999',    ['ADMIN', 'DIRECTOR_GEN']],

  // Работы — authenticate, доступ всем
  ['GET',  '/api/works',              ROLES],

  // Работы: удаление — ADMIN only
  ['DELETE', '/api/works/999999',      ['ADMIN']],

  // Работы: team analytics — HEAD_PM, directors
  ['GET',  '/api/works/analytics/team', ['ADMIN', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV']],

  // Просчёты — authenticate, доступ всем
  ['GET',  '/api/estimates',           ROLES],

  // Счета: создание — PM, BUH, directors
  ['POST', '/api/invoices',            ['ADMIN', 'PM', 'HEAD_PM', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM']],

  // Расходы: создание — PM, BUH, directors
  ['POST', '/api/expenses/work',       ['ADMIN', 'PM', 'HEAD_PM', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM']],

  // Доходы: создание — PM, BUH, directors
  ['POST', '/api/incomes',             ['ADMIN', 'PM', 'HEAD_PM', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM']],

  // Пользователи: список
  ['GET',  '/api/users',              ROLES],

  // Пользователи: удаление — ADMIN only
  ['DELETE', '/api/users/999999',      ['ADMIN']],

  // Настройки: удаление ключа — ADMIN only
  ['DELETE', '/api/settings/test_key', ['ADMIN']],

  // Уведомления — все
  ['GET',  '/api/notifications',       ROLES],

  // Объекты — authenticate, доступ всем
  ['GET',  '/api/sites',              ROLES],

  // Объекты: удаление — ADMIN
  ['DELETE', '/api/sites/999999',      ['ADMIN']],

  // Персонал — authenticate, доступ всем
  ['GET',  '/api/staff/employees',     ROLES],

  // Оборудование — authenticate, доступ всем
  ['GET',  '/api/equipment',           ROLES],

  // Health check — no auth
  // (tested separately)
];

// Генерируем тест для каждой пары [роль × эндпоинт]
const tests = ACCESS_MATRIX.flatMap(([method, path, allowed]) => {
  // Тестируем только несколько "запрещённых" ролей чтобы не раздувать suite
  const deniedRoles = ROLES.filter(r => !allowed.includes(r));
  // Берём макс 3 denied роли для скорости
  const testDenied = deniedRoles.slice(0, 3);
  // Берём 2 allowed роли (не ADMIN, т.к. ADMIN всегда проходит)
  const testAllowed = allowed.filter(r => r !== 'ADMIN').slice(0, 2);

  const allowedTests = testAllowed.map(role => ({
    name: `${role} → ${method} ${path}: ALLOW`,
    run: async () => {
      const resp = await api(method, path, {
        role,
        body: method === 'POST' ? { _test: true } : null
      });
      // Для DELETE/POST на несуществующие ID — 404 тоже ок (доступ есть, объекта нет)
      assert(
        resp.status < 500 && resp.status !== 403 && resp.status !== 401,
        `${role} should access ${method} ${path}, got ${resp.status}`
      );
    }
  }));

  const deniedTests = testDenied.map(role => ({
    name: `${role} → ${method} ${path}: DENY`,
    run: async () => {
      const resp = await api(method, path, {
        role,
        body: method === 'POST' ? { _test: true } : null
      });
      assert(
        resp.status === 403 || resp.status === 401,
        `${role} should NOT access ${method} ${path}, got ${resp.status}`
      );
    }
  }));

  return [...allowedTests, ...deniedTests];
});

// Дополнительный тест: health check без авторизации
tests.unshift({
  name: 'Health check (no auth): GET /api/health',
  run: async () => {
    const { BASE_URL } = require('../config');
    const resp = await fetch(`${BASE_URL}/api/health`);
    assert(resp.ok, `health check: ${resp.status}`);
  }
});

module.exports = {
  name: 'ACCESS MATRIX',
  tests
};
