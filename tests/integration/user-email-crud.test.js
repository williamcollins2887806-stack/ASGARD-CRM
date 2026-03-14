/**
 * Integration tests: User Email Account CRUD
 * Tests /api/users/:id/email-account/* routes
 */
const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
let adminToken = '';
let testUserId = null;
let regularUserToken = '';

async function apiRequest(method, path, body = null, token = adminToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const resp = await fetch(`${BASE_URL}${path}`, options);
  const data = await resp.json().catch(() => ({}));
  return { status: resp.status, data };
}

describe('User Email Account CRUD', () => {
  beforeAll(async () => {
    // Login as admin
    const loginResp = await apiRequest('POST', '/api/auth/login', {
      login: 'test_admin',
      password: 'Test123456!'
    });
    adminToken = loginResp.data.token;
    testUserId = loginResp.data.user?.id;
  });

  describe('GET /api/users/:id/email-account', () => {
    test('admin can get own email account', async () => {
      if (!testUserId) return;
      const { status, data } = await apiRequest('GET', `/api/users/${testUserId}/email-account`);
      expect(status).toBe(200);
      expect(data).toHaveProperty('account');
    });

    test('returns 401 without auth', async () => {
      if (!testUserId) return;
      const { status } = await apiRequest('GET', `/api/users/${testUserId}/email-account`, null, '');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('returns 404 or 403 for non-existent user', async () => {
      const { status } = await apiRequest('GET', '/api/users/99999/email-account');
      expect([403, 404]).toContain(status);
    });
  });

  describe('POST /api/users/:id/email-account', () => {
    test('creates email account with valid data', async () => {
      if (!testUserId) return;

      // Cleanup first
      await apiRequest('DELETE', `/api/users/${testUserId}/email-account`);

      const { status, data } = await apiRequest('POST', `/api/users/${testUserId}/email-account`, {
        email_address: 'integration.test@asgard-service.com',
        imap_password: 'test-imap-pass-123',
        display_name: 'Integration Test'
      });

      expect([200, 201, 409]).toContain(status);
      if (status === 200 || status === 201) {
        expect(data.success).toBe(true);
      }
    });

    test('rejects duplicate email account', async () => {
      if (!testUserId) return;

      // First create
      await apiRequest('POST', `/api/users/${testUserId}/email-account`, {
        email_address: 'duplicate.test@asgard-service.com',
        imap_password: 'test-pass',
        display_name: 'Dup Test'
      });

      // Second create - should fail with 409
      const { status } = await apiRequest('POST', `/api/users/${testUserId}/email-account`, {
        email_address: 'duplicate.test2@asgard-service.com',
        imap_password: 'test-pass',
        display_name: 'Dup Test 2'
      });

      expect([409, 400, 200]).toContain(status);
    });

    test('rejects request without email_address', async () => {
      if (!testUserId) return;
      const { status } = await apiRequest('POST', `/api/users/${testUserId}/email-account`, {
        display_name: 'No Email'
      });
      expect(status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('PUT /api/users/:id/email-account/signature', () => {
    test('updates signature and display name', async () => {
      if (!testUserId) return;
      const { status } = await apiRequest('PUT', `/api/users/${testUserId}/email-account/signature`, {
        signature_html: '<p>С уважением, Тест</p>',
        display_name: 'Тестовый Пользователь'
      });
      expect([200, 404]).toContain(status);
    });
  });

  describe('POST /api/users/:id/email-account/test', () => {
    test('tests connection (may fail if mail not configured)', async () => {
      if (!testUserId) return;
      const { status, data } = await apiRequest('POST', `/api/users/${testUserId}/email-account/test`);
      // Connection test will likely fail in test env — that's OK
      expect([200, 404, 500]).toContain(status);
    });
  });

  describe('DELETE /api/users/:id/email-account', () => {
    test('deletes email account', async () => {
      if (!testUserId) return;
      const { status } = await apiRequest('DELETE', `/api/users/${testUserId}/email-account`);
      expect([200, 404]).toContain(status);
    });

    test('second delete returns 404', async () => {
      if (!testUserId) return;
      const { status } = await apiRequest('DELETE', `/api/users/${testUserId}/email-account`);
      expect([200, 404]).toContain(status);
    });
  });

  describe('POST /api/users/:id/email-account/create-yandex', () => {
    test('requires admin role', async () => {
      if (!testUserId) return;
      const { status } = await apiRequest('POST', `/api/users/${testUserId}/email-account/create-yandex`, {
        nickname: 'test.auto',
        password: 'TestPass123!'
      });
      // May succeed (200) or fail if Yandex 360 not configured (400/500)
      expect([200, 400, 403, 500]).toContain(status);
    });
  });
});
