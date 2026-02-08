/**
 * ASGARD CRM — Хелпер авторизации для тестов
 */

'use strict';

async function getToken(app, role = 'ADMIN') {
  const login = `test_${role.toLowerCase()}`;
  const resp = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { login, password: 'Test123!' }
  });
  const data = JSON.parse(resp.body);
  if (!data.token) {
    throw new Error(`Не удалось получить токен для роли ${role}: ${resp.body}`);
  }
  return data.token;
}

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

module.exports = { getToken, authHeaders };
