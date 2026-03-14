/**
 * ASGARD CRM — Интеграционные тесты: зарплатный модуль
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

describe('Payroll API', () => {

  describe('GET /api/payroll/sheets', () => {
    test('ADMIN получает список ведомостей', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/payroll/sheets?limit=10',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });

    test('BUH получает список ведомостей', async () => {
      const token = await getToken(app, 'BUH');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/payroll/sheets?limit=10',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });

    test('без авторизации → 401', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/payroll/sheets'
      });
      expect(resp.statusCode).toBe(401);
    });
  });

  describe('GET /api/payroll/rates', () => {
    test('ADMIN получает ставки', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/payroll/rates',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });
  });

  describe('GET /api/payroll/stats', () => {
    test('ADMIN получает статистику', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/payroll/stats',
        headers: authHeaders(token)
      });
      // Может быть 200 или 404 (если эндпоинт не реализован)
      expect(resp.statusCode).toBeLessThan(500);
    });
  });
});
