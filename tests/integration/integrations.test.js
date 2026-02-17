/**
 * ASGARD CRM — Интеграционные тесты: модуль интеграций (банк, площадки, ERP)
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

describe('Integrations API', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // БАНК
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bank — GET /api/integrations/bank/stats', () => {
    test('ADMIN получает статистику', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/integrations/bank/stats',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
      const data = JSON.parse(resp.body);
      expect(data.success).toBe(true);
    });

    test('BUH получает статистику', async () => {
      const token = await getToken(app, 'BUH');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/integrations/bank/stats',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });
  });

  describe('Bank — GET /api/integrations/bank/transactions', () => {
    test('ADMIN получает список транзакций', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/integrations/bank/transactions?limit=10',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
      const data = JSON.parse(resp.body);
      expect(data.items || Array.isArray(data)).toBeTruthy();
    });
  });

  describe('Bank — GET /api/integrations/bank/rules', () => {
    test('ADMIN получает правила классификации', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/integrations/bank/rules',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
      const data = JSON.parse(resp.body);
      expect(data.rules || data.items || Array.isArray(data)).toBeTruthy();
    });
  });

  describe('Bank — GET /api/integrations/bank/batches', () => {
    test('ADMIN получает список батчей', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/integrations/bank/batches',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ПЛОЩАДКИ
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Platforms — GET /api/integrations/platforms', () => {
    test('ADMIN получает результаты парсинга', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/integrations/platforms?limit=10',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });
  });

  describe('Platforms — GET /api/integrations/platforms/stats', () => {
    test('ADMIN получает статистику площадок', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/integrations/platforms/stats',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
      const data = JSON.parse(resp.body);
      expect(data.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ERP
  // ═══════════════════════════════════════════════════════════════════════════

  describe('ERP — GET /api/integrations/erp/connections', () => {
    test('ADMIN получает список подключений', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/integrations/erp/connections',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });
  });

  describe('ERP — GET /api/integrations/erp/sync-log', () => {
    test('ADMIN получает лог синхронизации', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/integrations/erp/sync-log',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ДОСТУП
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Контроль доступа', () => {
    test('без авторизации → 401', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/integrations/bank/stats'
      });
      expect(resp.statusCode).toBe(401);
    });
  });
});
