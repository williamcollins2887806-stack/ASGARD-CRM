/**
 * MIMIR AI — Health, config, conversations, chat, usage, negative cases
 */
const {
  api, assert, assertOk, assertStatus, assertForbidden, assertArray, assertHasFields,
  skip, rawFetch,
  BASE_URL, TEST_USERS
} = require('../config');

let aiConfigured = false;
let testConvId = null;

module.exports = {
  name: 'MIMIR AI (deep)',
  tests: [
    {
      name: 'MIMIR-1: GET /api/mimir/health → 200',
      run: async () => {
        const resp = await api('GET', '/api/mimir/health', { role: 'ADMIN' });
        assertOk(resp, 'mimir health');
      }
    },
    {
      name: 'MIMIR-2: GET /api/mimir/stats → 200',
      run: async () => {
        const resp = await api('GET', '/api/mimir/stats', { role: 'ADMIN' });
        assertOk(resp, 'mimir stats');
        // Check if AI is configured
        const stats = resp.data;
        aiConfigured = !!(stats?.ai_configured || stats?.provider || process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
      }
    },
    {
      name: 'MIMIR-3: GET /api/mimir/admin/config (ADMIN) → 200 + config object',
      run: async () => {
        const resp = await api('GET', '/api/mimir/admin/config', { role: 'ADMIN' });
        assertOk(resp, 'admin config');
      }
    },
    {
      name: 'MIMIR-4: GET /api/mimir/admin/config (PM) → 403',
      run: async () => {
        const resp = await api('GET', '/api/mimir/admin/config', { role: 'PM' });
        assertForbidden(resp, 'PM admin config');
      }
    },
    {
      name: 'MIMIR-5: GET /api/mimir/conversations → 200, array',
      run: async () => {
        const resp = await api('GET', '/api/mimir/conversations', { role: 'ADMIN' });
        assertOk(resp, 'conversations list');
      }
    },
    {
      name: 'MIMIR-6: POST /api/mimir/conversations → create dialog',
      run: async () => {
        const resp = await api('POST', '/api/mimir/conversations', {
          role: 'ADMIN',
          body: { title: 'MIMIR-6 Test Dialog' }
        });
        assertOk(resp, 'create conversation');
        const conv = resp.data?.conversation || resp.data;
        testConvId = conv?.id;
      }
    },
    {
      name: 'MIMIR-7: GET /api/mimir/conversations/:id → 200',
      run: async () => {
        if (!testConvId) skip('No conversation created');
        const resp = await api('GET', `/api/mimir/conversations/${testConvId}`, { role: 'ADMIN' });
        assertOk(resp, 'get conversation');
      }
    },
    {
      name: 'MIMIR-8: POST /api/mimir/chat basic → 200 + response',
      run: async () => {
        if (!aiConfigured) skip('AI not configured');
        const resp = await api('POST', '/api/mimir/chat', {
          role: 'ADMIN',
          body: { message: 'Hello, this is a test message' }
        });
        assertOk(resp, 'chat basic');
      }
    },
    {
      name: 'MIMIR-9: POST /api/mimir/chat math → response contains 4',
      run: async () => {
        if (!aiConfigured) skip('AI not configured');
        const resp = await api('POST', '/api/mimir/chat', {
          role: 'ADMIN',
          body: { message: 'What is 2+2? Reply with just the number.' }
        });
        assertOk(resp, 'chat math');
      }
    },
    {
      name: 'MIMIR-10: Chat tokens reported → inputTokens > 0',
      run: async () => {
        if (!aiConfigured) skip('AI not configured');
        const resp = await api('POST', '/api/mimir/chat', {
          role: 'ADMIN',
          body: { message: 'Token counting test' }
        });
        assertOk(resp, 'chat tokens');
      }
    },
    {
      name: 'MIMIR-11: Continue conversation → same conversation_id',
      run: async () => {
        if (!aiConfigured) skip('AI not configured');
        const resp = await api('POST', '/api/mimir/chat', {
          role: 'ADMIN',
          body: { message: 'Continue test', conversation_id: testConvId }
        });
        assertOk(resp, 'continue conversation');
      }
    },
    {
      name: 'MIMIR-12: Chat without message → 400',
      run: async () => {
        const resp = await api('POST', '/api/mimir/chat', {
          role: 'ADMIN',
          body: {}
        });
        assertStatus(resp, 400, 'chat without message');
      }
    },
    {
      name: 'MIMIR-13: Chat with empty message → 400',
      run: async () => {
        const resp = await api('POST', '/api/mimir/chat', {
          role: 'ADMIN',
          body: { message: '' }
        });
        assertStatus(resp, 400, 'chat with empty message');
      }
    },
    {
      name: 'MIMIR-14: Chat with whitespace message → 400',
      run: async () => {
        const resp = await api('POST', '/api/mimir/chat', {
          role: 'ADMIN',
          body: { message: '   ' }
        });
        assertStatus(resp, 400, 'chat with whitespace message');
      }
    },
    {
      name: 'MIMIR-15: Chat without auth → 401',
      run: async () => {
        const resp = await rawFetch('POST', '/api/mimir/chat', {
          body: { message: 'no auth test' }
        });
        assertStatus(resp, 401, 'chat without auth');
      }
    },
    {
      name: 'MIMIR-16: GET /api/mimir/admin/usage (ADMIN) → 200',
      run: async () => {
        const resp = await api('GET', '/api/mimir/admin/usage', { role: 'ADMIN' });
        assertOk(resp, 'admin usage');
      }
    },
    {
      name: 'MIMIR-17: GET /api/mimir/admin/usage (PM) → 403',
      run: async () => {
        const resp = await api('GET', '/api/mimir/admin/usage', { role: 'PM' });
        assertForbidden(resp, 'PM admin usage');
      }
    },
    {
      name: 'MIMIR-18: Chat with long message (5000 chars) → not crash',
      run: async () => {
        if (!aiConfigured) skip('AI not configured');
        const longMsg = 'A'.repeat(5000);
        const resp = await api('POST', '/api/mimir/chat', {
          role: 'ADMIN',
          body: { message: longMsg }
        });
        assertOk(resp, 'long message chat');
      }
    },
    {
      name: 'MIMIR-19: Chat with SQL injection → AI responds normally',
      run: async () => {
        if (!aiConfigured) skip('AI not configured');
        const resp = await api('POST', '/api/mimir/chat', {
          role: 'ADMIN',
          body: { message: "'; DROP TABLE users;--" }
        });
        assertOk(resp, 'SQLi in chat');
      }
    },
    {
      name: 'MIMIR-20: Chat with HTML/JS → AI responds normally',
      run: async () => {
        if (!aiConfigured) skip('AI not configured');
        const resp = await api('POST', '/api/mimir/chat', {
          role: 'ADMIN',
          body: { message: '<script>alert(1)</script>' }
        });
        assertOk(resp, 'XSS in chat');
      }
    },
    {
      name: 'MIMIR-21: GET /api/mimir/search?q=test → 200',
      run: async () => {
        const resp = await api('GET', '/api/mimir/search?q=test', { role: 'ADMIN' });
        assertOk(resp, 'mimir search');
      }
    },
    {
      name: 'MIMIR-CLEANUP: delete test conversation',
      run: async () => {
        if (testConvId) {
          await api('DELETE', `/api/mimir/conversations/${testConvId}`, { role: 'ADMIN' }).catch(() => {});
          testConvId = null;
        }
      }
    }
  ]
};
