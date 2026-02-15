/**
 * ASGARD CRM — Интеграционные тесты: ролевая матрица (data API)
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

describe('Data API — Ролевая матрица', () => {

  describe('ADMIN — полный доступ', () => {
    test('может читать tenders', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/data/tenders',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });

    test('может читать users', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/data/users',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });
  });

  describe('WAREHOUSE — ограниченный доступ', () => {
    test('может читать equipment', async () => {
      const token = await getToken(app, 'WAREHOUSE');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/data/equipment',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });

    test('не может читать tenders', async () => {
      const token = await getToken(app, 'WAREHOUSE');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/data/tenders',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(403);
    });

    test('не может читать payroll_sheets', async () => {
      const token = await getToken(app, 'WAREHOUSE');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/data/payroll_sheets',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(403);
    });
  });

  describe('BUH — финансовый доступ', () => {
    test('может читать payroll_sheets', async () => {
      const token = await getToken(app, 'BUH');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/data/payroll_sheets',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });

    test('может читать invoices', async () => {
      const token = await getToken(app, 'BUH');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/data/invoices',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });
  });

  describe('TO — тендерный доступ', () => {
    test('может читать tenders', async () => {
      const token = await getToken(app, 'TO');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/data/tenders',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });

    test('не может читать payroll_sheets', async () => {
      const token = await getToken(app, 'TO');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/data/payroll_sheets',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(403);
    });
  });

  describe('PM — проектный доступ', () => {
    test('может читать works', async () => {
      const token = await getToken(app, 'PM');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/data/works',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });

    test('не может удалять записи', async () => {
      const token = await getToken(app, 'PM');
      const resp = await app.inject({
        method: 'DELETE',
        url: '/api/data/tenders/99999',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(403);
    });
  });

  describe('Защита чувствительных таблиц', () => {
    test('HR не может читать users', async () => {
      const token = await getToken(app, 'HR');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/data/users',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(403);
    });

    test('PM не может читать audit_log', async () => {
      const token = await getToken(app, 'PM');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/data/audit_log',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(403);
    });
  });

  describe('Наследование ролей', () => {
    test('HEAD_TO наследует доступ TO к tenders', async () => {
      const token = await getToken(app, 'HEAD_TO');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/data/tenders',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });

    test('HEAD_PM наследует доступ PM к works', async () => {
      const token = await getToken(app, 'HEAD_PM');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/data/works',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });
  });
});
