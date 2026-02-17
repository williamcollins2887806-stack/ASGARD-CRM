/**
 * AUTH ALL ROLES — Verify each of 15 roles can authenticate and access /me
 */
const { api, assert, assertOk, assertHasFields, ROLES, skip } = require('../config');

const tests = [];

// For each role, verify GET /api/auth/me returns correct data
for (const role of ROLES) {
  tests.push({
    name: `${role}: GET /api/auth/me returns valid user`,
    run: async () => {
      const resp = await api('GET', '/api/auth/me', { role });
      assertOk(resp, `${role} /me`);
      const user = resp.data?.user || resp.data;
      assert(user && typeof user === 'object', `${role}: /me should return user object`);
      assert(user.id, `${role}: user should have id`);
      assert(user.role, `${role}: user should have role`);
    }
  });
}

// Verify each role can read their own notifications
for (const role of ROLES) {
  tests.push({
    name: `${role}: GET /api/notifications accessible`,
    run: async () => {
      const resp = await api('GET', '/api/notifications', { role });
      assert(resp.status < 500, `${role} notifications should not 5xx, got ${resp.status}`);
    }
  });
}

// Verify each role can read their own tasks
for (const role of ROLES) {
  tests.push({
    name: `${role}: GET /api/tasks/my accessible`,
    run: async () => {
      const resp = await api('GET', '/api/tasks/my', { role });
      assertOk(resp, `${role} tasks/my`);
    }
  });
}

module.exports = {
  name: 'AUTH ALL ROLES (Аутентификация всех ролей)',
  tests
};
