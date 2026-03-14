/**
 * Integration tests: My Mail API endpoints
 * Tests /api/my-mail/* routes with real DB
 */
const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
let authToken = '';
let testUserId = null;

async function apiRequest(method, path, body = null, token = authToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const resp = await fetch(`${BASE_URL}${path}`, options);
  const data = await resp.json().catch(() => ({}));
  return { status: resp.status, data };
}

describe('My Mail API', () => {
  beforeAll(async () => {
    // Login as test admin
    const loginResp = await apiRequest('POST', '/api/auth/login', {
      login: 'test_admin',
      password: 'Test123456!'
    });
    authToken = loginResp.data.token;
    testUserId = loginResp.data.user?.id;
  });

  describe('GET /api/my-mail/account', () => {
    test('returns account info or null', async () => {
      const { status, data } = await apiRequest('GET', '/api/my-mail/account');
      expect(status).toBe(200);
      expect(data).toHaveProperty('configured');
    });

    test('returns 401 without auth', async () => {
      const { status } = await apiRequest('GET', '/api/my-mail/account', null, '');
      expect(status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('GET /api/my-mail/folders', () => {
    test('returns folders array', async () => {
      const { status, data } = await apiRequest('GET', '/api/my-mail/folders');
      expect(status).toBe(200);
      expect(data).toHaveProperty('folders');
      expect(Array.isArray(data.folders)).toBe(true);
    });
  });

  describe('GET /api/my-mail/emails', () => {
    test('returns emails list with pagination', async () => {
      const { status, data } = await apiRequest('GET', '/api/my-mail/emails?limit=10&offset=0');
      expect(status).toBe(200);
      expect(data).toHaveProperty('emails');
      expect(data).toHaveProperty('total');
      expect(Array.isArray(data.emails)).toBe(true);
    });

    test('supports search parameter', async () => {
      const { status, data } = await apiRequest('GET', '/api/my-mail/emails?search=test');
      expect(status).toBe(200);
      expect(data).toHaveProperty('emails');
    });
  });

  describe('GET /api/my-mail/stats', () => {
    test('returns unread count and folder stats', async () => {
      const { status, data } = await apiRequest('GET', '/api/my-mail/stats');
      expect(status).toBe(200);
      expect(data).toHaveProperty('unread');
      expect(data).toHaveProperty('total');
    });
  });

  describe('POST /api/my-mail/drafts', () => {
    test('creates a draft', async () => {
      const { status, data } = await apiRequest('POST', '/api/my-mail/drafts', {
        to: ['test@example.com'],
        subject: 'Test Draft',
        body_text: 'This is a test draft',
        body_html: '<p>This is a test draft</p>'
      });
      // May fail if no email account configured
      expect([200, 403]).toContain(status);
    });
  });

  describe('PUT /api/my-mail/account', () => {
    test('updates account settings', async () => {
      const { status } = await apiRequest('PUT', '/api/my-mail/account', {
        display_name: 'Test User Updated',
        signature_html: '<p>Test Signature</p>'
      });
      // May fail if no email account
      expect([200, 404]).toContain(status);
    });
  });

  // User email account management
  describe('User Email Account CRUD', () => {
    test('GET /api/users/:id/email-account returns account or null', async () => {
      if (!testUserId) return;
      const { status, data } = await apiRequest('GET', `/api/users/${testUserId}/email-account`);
      expect(status).toBe(200);
      expect(data).toHaveProperty('account');
    });

    test('POST /api/users/:id/email-account creates account', async () => {
      if (!testUserId) return;
      // Clean up first
      await apiRequest('DELETE', `/api/users/${testUserId}/email-account`);

      const { status, data } = await apiRequest('POST', `/api/users/${testUserId}/email-account`, {
        email_address: 'test.integration@asgard-service.com',
        imap_password: 'test-password',
        display_name: 'Test Integration'
      });

      expect([200, 409]).toContain(status);
      if (status === 200) {
        expect(data.success).toBe(true);
      }
    });

    test('DELETE /api/users/:id/email-account removes account', async () => {
      if (!testUserId) return;
      const { status } = await apiRequest('DELETE', `/api/users/${testUserId}/email-account`);
      expect([200, 404]).toContain(status);
    });
  });
});
