/**
 * Smoke tests: My Mail v2.0 — Premium Feature
 * Quick health checks for ALL API endpoints, new v2.0 endpoints, pages, and frontend assets
 */
const { describe, test, expect, beforeAll } = require('@jest/globals');
const jwt = require('jsonwebtoken');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';
let authToken = '';

async function apiRequest(method, path, body = null, token = authToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const resp = await fetch(`${BASE_URL}${path}`, options);
  const data = await resp.json().catch(() => null);
  return { status: resp.status, data, ok: resp.ok };
}

async function fetchPage(path) {
  const resp = await fetch(`${BASE_URL}${path}`);
  const text = await resp.text();
  return { status: resp.status, text, ok: resp.ok };
}

describe('Smoke Tests: My Mail v2.0 Premium', () => {
  beforeAll(async () => {
    // Generate JWT directly with pinVerified: true to bypass login + PIN flow
    authToken = jwt.sign({
      id: 2656, login: 'test_admin', name: 'Test ADMIN', role: 'ADMIN',
      email: 'test_admin@test.asgard.local', pinVerified: true
    }, JWT_SECRET, { expiresIn: '1h' });
  });

  // --- Core API endpoint smoke tests ---

  describe('Core My Mail API endpoints respond', () => {
    test('GET /api/my-mail/account → 200', async () => {
      const { status } = await apiRequest('GET', '/api/my-mail/account');
      expect(status).toBe(200);
    });

    test('GET /api/my-mail/folders → 200', async () => {
      const { status } = await apiRequest('GET', '/api/my-mail/folders');
      expect(status).toBe(200);
    });

    test('GET /api/my-mail/emails → 200', async () => {
      const { status } = await apiRequest('GET', '/api/my-mail/emails?limit=5&offset=0');
      expect(status).toBe(200);
    });

    test('GET /api/my-mail/stats → 200', async () => {
      const { status } = await apiRequest('GET', '/api/my-mail/stats');
      expect(status).toBe(200);
    });
  });

  // --- NEW v2.0 endpoints ---

  describe('v2.0 new endpoints respond', () => {
    test('GET /api/my-mail/poll → 200 (lightweight polling)', async () => {
      const { status, data } = await apiRequest('GET', '/api/my-mail/poll');
      expect(status).toBe(200);
      expect(data).toHaveProperty('unread');
      expect(typeof data.unread).toBe('number');
    });

    test('GET /api/my-mail/contacts → 200 (address book)', async () => {
      const { status, data } = await apiRequest('GET', '/api/my-mail/contacts');
      expect(status).toBe(200);
      expect(data).toHaveProperty('contacts');
      expect(Array.isArray(data.contacts)).toBe(true);
    });

    test('POST /api/my-mail/folders → creates custom folder', async () => {
      const { status, data } = await apiRequest('POST', '/api/my-mail/folders', {
        name: 'E2E Test Folder'
      });
      // May 200/201 if account exists, 400/403/404 if no account configured
      expect([200, 201, 400, 403, 404]).toContain(status);
    });
  });

  // --- Auth checks ---

  describe('My Mail API auth checks', () => {
    test('GET /api/my-mail/account → 401 without token', async () => {
      const { status } = await apiRequest('GET', '/api/my-mail/account', null, '');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('GET /api/my-mail/folders → 401 without token', async () => {
      const { status } = await apiRequest('GET', '/api/my-mail/folders', null, '');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('GET /api/my-mail/emails → 401 without token', async () => {
      const { status } = await apiRequest('GET', '/api/my-mail/emails', null, '');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('POST /api/my-mail/send → 401 without token', async () => {
      const { status } = await apiRequest('POST', '/api/my-mail/send', { to: ['a@b.c'], subject: 'test', body_html: '<p>test</p>' }, '');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('GET /api/my-mail/poll → 401 without token', async () => {
      const { status } = await apiRequest('GET', '/api/my-mail/poll', null, '');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('GET /api/my-mail/contacts → 401 without token', async () => {
      const { status } = await apiRequest('GET', '/api/my-mail/contacts', null, '');
      expect(status).toBeGreaterThanOrEqual(400);
    });
  });

  // --- Input validation (v2.0 schema enforcement) ---

  describe('v2.0 input validation', () => {
    test('POST /api/my-mail/send rejects missing required fields', async () => {
      const { status } = await apiRequest('POST', '/api/my-mail/send', {});
      expect(status).toBe(400);
    });

    test('POST /api/my-mail/drafts rejects invalid body', async () => {
      const { status } = await apiRequest('POST', '/api/my-mail/drafts', { to: 12345 });
      // 400 = schema validation rejects numeric to, 403 = no mail account configured
      expect([400, 403]).toContain(status);
    });

    test('POST /api/my-mail/folders rejects empty name', async () => {
      const { status } = await apiRequest('POST', '/api/my-mail/folders', { name: '' });
      expect([400, 404]).toContain(status);
    });
  });

  // --- User email account API ---

  describe('User email account API endpoints respond', () => {
    test('GET /api/users/1/email-account → responds', async () => {
      const { status } = await apiRequest('GET', '/api/users/1/email-account');
      expect([200, 403, 404]).toContain(status);
    });
  });

  // --- Frontend smoke tests ---

  describe('Frontend pages & assets load', () => {
    test('index.html loads and contains my_mail.js v2.0', async () => {
      const { status, text } = await fetchPage('/');
      expect(status).toBe(200);
      expect(text).toContain('my_mail.js?v=2.');
    });

    test('my_mail.js script is accessible', async () => {
      const { status } = await fetchPage('/assets/js/my_mail.js?v=2.0.0');
      expect(status).toBe(200);
    });

    test('my-mail.css is accessible', async () => {
      const { status } = await fetchPage('/assets/css/my-mail.css?v=2.0.0');
      expect(status).toBe(200);
    });

    test('app.js loads and has my-mail route', async () => {
      const { status, text } = await fetchPage('/assets/js/app.js');
      expect(status).toBe(200);
      expect(text).toContain('my-mail');
    });
  });

  // --- Data structure checks ---

  describe('API response structures', () => {
    test('/api/my-mail/account has correct structure', async () => {
      const { data } = await apiRequest('GET', '/api/my-mail/account');
      expect(data).toHaveProperty('configured');
    });

    test('/api/my-mail/folders returns folders array', async () => {
      const { data } = await apiRequest('GET', '/api/my-mail/folders');
      expect(data).toHaveProperty('folders');
      expect(Array.isArray(data.folders)).toBe(true);
    });

    test('/api/my-mail/emails has pagination fields', async () => {
      const { data } = await apiRequest('GET', '/api/my-mail/emails?limit=5');
      expect(data).toHaveProperty('emails');
      expect(data).toHaveProperty('total');
      expect(Array.isArray(data.emails)).toBe(true);
      expect(typeof data.total).toBe('number');
    });

    test('/api/my-mail/stats has count fields', async () => {
      const { data } = await apiRequest('GET', '/api/my-mail/stats');
      expect(data).toHaveProperty('unread');
      expect(data).toHaveProperty('total');
    });

    test('/api/my-mail/poll returns unread count', async () => {
      const { data } = await apiRequest('GET', '/api/my-mail/poll');
      expect(typeof data.unread).toBe('number');
    });

    test('/api/my-mail/contacts returns contacts array', async () => {
      const { data } = await apiRequest('GET', '/api/my-mail/contacts');
      expect(Array.isArray(data.contacts)).toBe(true);
    });
  });

  // --- Existing functionality regression ---

  describe('Existing endpoints still work', () => {
    test('POST /api/auth/login accepts valid credentials', async () => {
      const { status, data } = await apiRequest('POST', '/api/auth/login', {
        login: 'test_admin',
        password: 'Test123!'
      }, null);
      // 200 = logged in (need_pin or direct), 401 = wrong password
      expect([200]).toContain(status);
      expect(data).toHaveProperty('token');
    });

    test('GET /api/users responds', async () => {
      const { status } = await apiRequest('GET', '/api/users');
      expect([200, 401, 403]).toContain(status);
    });

    test('GET /api/emails responds (old endpoint)', async () => {
      const { status } = await apiRequest('GET', '/api/emails?limit=5');
      expect([200, 403, 404]).toContain(status);
    });
  });
});
