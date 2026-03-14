/**
 * Unit tests: Yandex 360 API Service
 */
const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');

// Mock db
jest.mock('../../src/services/db', () => ({
  query: jest.fn()
}));

// Mock fetch globally
const originalFetch = global.fetch;

describe('Yandex 360 Service', () => {
  let yandex360;
  const mockDb = require('../../src/services/db');

  beforeAll(() => {
    // Setup config in mock DB
    mockDb.query.mockImplementation((sql) => {
      if (sql.includes('yandex360_config')) {
        return { rows: [{ value_json: JSON.stringify({ oauth_token: 'test-token', org_id: '12345', domain: 'asgard-service.com' }) }] };
      }
      return { rows: [] };
    });
    yandex360 = require('../../src/services/yandex360');
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('getConfig returns config from DB', async () => {
    yandex360.invalidateConfig();
    const config = await yandex360.getConfig();
    expect(config).toBeDefined();
    expect(config.oauth_token).toBe('test-token');
    expect(config.org_id).toBe('12345');
  });

  test('createUser sends correct API request', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ id: '999', nickname: 'test.user' }))
    });

    yandex360.invalidateConfig();
    const result = await yandex360.createUser({
      nickname: 'test.user',
      password: 'SecurePass123',
      firstName: 'Иван',
      lastName: 'Тестов'
    });

    expect(result).toBeDefined();
    expect(result.id).toBe('999');
    expect(result.email).toBe('test.user@asgard-service.com');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/directory/v1/org/12345/users'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'OAuth test-token'
        })
      })
    );
  });

  test('testConnection returns success on valid config', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ total: 10, users: [] }))
    });

    yandex360.invalidateConfig();
    const result = await yandex360.testConnection();
    expect(result.success).toBe(true);
  });

  test('testConnection returns error on invalid config', async () => {
    mockDb.query.mockImplementationOnce(() => ({ rows: [{ value_json: '{}' }] }));
    yandex360.invalidateConfig();
    const result = await yandex360.testConnection();
    expect(result.success).toBe(false);
  });

  test('saveConfig persists to DB', async () => {
    mockDb.query.mockImplementation(() => ({ rows: [] }));
    await yandex360.saveConfig({ oauth_token: 'new-token', org_id: '99999', domain: 'test.com' });
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('yandex360_config'),
      expect.any(Array)
    );
  });
});
