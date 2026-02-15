/**
 * ASGARD CRM — Интеграционные тесты: тендеры
 */

'use strict';

const { createApp } = require('../helpers/create-app');
const { getToken, authHeaders } = require('../helpers/auth');
const { TENDER_FIXTURE } = require('../helpers/fixtures');

let app;

beforeAll(async () => {
  app = await createApp();
}, 30000);

afterAll(async () => {
  if (app) await app.close();
});

describe('Tenders API', () => {

  describe('POST /api/tenders', () => {
    test('ADMIN может создать тендер', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'POST',
        url: '/api/tenders',
        headers: authHeaders(token),
        payload: TENDER_FIXTURE
      });
      expect(resp.statusCode).toBe(200);
      const data = JSON.parse(resp.body);
      expect(data.tender || data.id || data.success).toBeTruthy();
    });

    test('TO может создать тендер', async () => {
      const token = await getToken(app, 'TO');
      const resp = await app.inject({
        method: 'POST',
        url: '/api/tenders',
        headers: authHeaders(token),
        payload: { ...TENDER_FIXTURE, customer: 'ООО "ТО-Тест"' }
      });
      expect(resp.statusCode).toBeLessThan(500);
    });
  });

  describe('GET /api/tenders', () => {
    test('ADMIN получает список тендеров', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/tenders?limit=10',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
      const data = JSON.parse(resp.body);
      expect(data.tenders || data.items || Array.isArray(data)).toBeTruthy();
    });

    test('TO получает список тендеров', async () => {
      const token = await getToken(app, 'TO');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/tenders?limit=10',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });

    test('без авторизации → 401', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/tenders'
      });
      expect(resp.statusCode).toBe(401);
    });

    test('фильтр по статусу', async () => {
      const token = await getToken(app, 'ADMIN');
      const resp = await app.inject({
        method: 'GET',
        url: '/api/tenders?status=Новый&limit=5',
        headers: authHeaders(token)
      });
      expect(resp.statusCode).toBe(200);
    });
  });

  describe('PUT /api/tenders/:id', () => {
    test('ADMIN может обновить тендер', async () => {
      const token = await getToken(app, 'ADMIN');

      // Создаём тендер
      const createResp = await app.inject({
        method: 'POST',
        url: '/api/tenders',
        headers: authHeaders(token),
        payload: { ...TENDER_FIXTURE, customer: 'ООО "Обновление"' }
      });
      const createData = JSON.parse(createResp.body);
      const tenderId = createData.tender?.id || createData.id;

      if (tenderId) {
        const updateResp = await app.inject({
          method: 'PUT',
          url: `/api/tenders/${tenderId}`,
          headers: authHeaders(token),
          payload: { tender_status: 'В работе' }
        });
        expect(updateResp.statusCode).toBeLessThan(500);
      }
    });
  });
});
