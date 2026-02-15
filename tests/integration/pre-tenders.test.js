/**
 * ASGARD CRM — Интеграционные тесты: предварительные заявки
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

describe('Pre-Tenders API', () => {

  describe('GET /api/pre-tenders', () => {
    test('ADMIN получает список заявок', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/pre-tenders?limit=10',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
      const data = JSON.parse(resp.body);
      expect(data.items || Array.isArray(data)).toBeTruthy();
    });

    test('HEAD_TO получает список заявок', async () => {
      const token = await getToken(app, 'HEAD_TO');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/pre-tenders?limit=5',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });

    test('фильтр по статусу', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/pre-tenders?status=new&limit=5',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });

    test('фильтр по AI-цвету', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/pre-tenders?ai_color=green&limit=5',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });

    test('без авторизации → 401', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/pre-tenders'
      });
      expect(resp.statusCode).toBe(401);
    });
  });

  describe('GET /api/pre-tenders/stats', () => {
    test('ADMIN получает статистику', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/pre-tenders/stats',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
      const data = JSON.parse(resp.body);
      expect(data.success).toBe(true);
    });
  });

  describe('POST /api/pre-tenders/:id/accept', () => {
    test('несуществующая заявка → 404', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'POST',
        url: '/api/pre-tenders/99999/accept',
        headers: authHeaders(token),
        payload: {}
      });
      expect(resp.statusCode).toBe(404);
    });
  });

  describe('POST /api/pre-tenders/:id/reject', () => {
    test('несуществующая заявка → 404', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'POST',
        url: '/api/pre-tenders/99999/reject',
        headers: authHeaders(token),
        payload: { reject_reason: 'Тест' }
      });
      expect(resp.statusCode).toBe(404);
    });
  });
});
