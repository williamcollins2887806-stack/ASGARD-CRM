/**
 * ASGARD CRM — Интеграционные тесты: авторизация
 */

'use strict';

const { createApp } = require('../helpers/create-app');
const { getToken, authHeaders } = require('../helpers/auth');

let app;

beforeAll(async () => {
  app = await createApp();
}, 30000);

afterAll(async () => {
  if (app) await app.close();
});

describe('Auth API', () => {

  describe('POST /api/auth/login', () => {
    test('успешный вход ADMIN', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { login: 'test_admin', password: 'Test123!' }
      });
      expect(resp.statusCode).toBe(200);
      const data = JSON.parse(resp.body);
      expect(data.token).toBeDefined();
      expect(data.user).toBeDefined();
      expect(data.user.role).toBe('ADMIN');
    });

    test('успешный вход PM', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { login: 'test_pm', password: 'Test123!' }
      });
      expect(resp.statusCode).toBe(200);
      const data = JSON.parse(resp.body);
      expect(data.user.role).toBe('PM');
    });

    test('неверный пароль → 401', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { login: 'test_admin', password: 'wrong_password' }
      });
      expect(resp.statusCode).toBe(401);
    });

    test('несуществующий пользователь → 401', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { login: 'nonexistent_user', password: 'Test123!' }
      });
      expect(resp.statusCode).toBe(401);
    });

    test('пустой логин → ошибка', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { login: '', password: 'Test123!' }
      });
      expect(resp.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe('GET /api/auth/me', () => {
    test('с валидным токеном → информация о пользователе', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
      const data = JSON.parse(resp.body);
      expect(data.user).toBeDefined();
      expect(data.user.role).toBe('ADMIN');
    });

    test('без токена → 401', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/auth/me'
      });
      expect(resp.statusCode).toBe(401);
    });

    test('с невалидным токеном → 401', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { Authorization: 'Bearer invalid_token_here' }
      });
      expect(resp.statusCode).toBe(401);
    });
  });

  describe('Все роли могут авторизоваться', () => {
    const roles = [
      'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
      'HEAD_PM', 'HEAD_TO', 'PM', 'TO', 'HR', 'HR_MANAGER',
      'BUH', 'OFFICE_MANAGER', 'WAREHOUSE', 'PROC', 'CHIEF_ENGINEER'
    ];

    test.each(roles)('роль %s может получить токен', async (role) => {
      const token = await getToken(app, role);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(10);
    });
  });
});
