'use strict';

/**
 * Test/system users must not appear in production UI lists (office schedule, dropdowns).
 * Auth endpoints are unaffected — test accounts can still log in for QA.
 *
 * Bypass for automated tests: GET ...?include_test=1 as ADMIN.
 * Local dev with test users in lists: SHOW_TEST_USERS=1 in .env.
 */

const TEST_LOGIN_PREFIX = 'test_';
const SYSTEM_LOGINS = new Set(['mimir_bot']);

function isTestLogin(login) {
  const l = String(login || '');
  return l.startsWith(TEST_LOGIN_PREFIX) || SYSTEM_LOGINS.has(l);
}

/** Row from users table or minimal { login, name }. */
function isTestUserRecord(user) {
  if (!user) return false;
  if (isTestLogin(user.login)) return true;
  const name = String(user.name || '').trim();
  return name.startsWith('Test ') || name.startsWith('Тест ');
}

/** Whether list endpoints should omit test users for this request. */
function shouldHideTestUsersFromLists(request) {
  if (process.env.SHOW_TEST_USERS === '1') return false;
  const q = request?.query || {};
  if (q.include_test === '1' || q.include_test === 'true') {
    const role = request?.user?.role;
    if (role === 'ADMIN') return false;
  }
  return true;
}

/** SQL fragment: exclude test_/system logins (PostgreSQL regex — LIKE 'test_%' ловит testX). */
function usersExcludeSql(alias = 'u') {
  const a = alias;
  return ` AND (${a}.login IS NULL OR (${a}.login !~ '^test_' AND ${a}.login <> 'mimir_bot'))`;
}

/** staff.user_id → users; drop rows tied to test/system logins. */
function staffExcludeTestSql(staffAlias = 's') {
  const s = staffAlias;
  return ` AND (${s}.user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = ${s}.user_id
      AND (u.login ~ '^test_' OR u.login = 'mimir_bot')
  ))`;
}

function filterOutTestUsers(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.filter((r) => !isTestUserRecord(r));
}

module.exports = {
  TEST_LOGIN_PREFIX,
  SYSTEM_LOGINS,
  isTestLogin,
  isTestUserRecord,
  shouldHideTestUsersFromLists,
  usersExcludeSql,
  staffExcludeTestSql,
  filterOutTestUsers,
};
