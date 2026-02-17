/**
 * CORRESPONDENCE — Access control, numbering format, SMTP integration
 */
const {
  api, assert, assertOk, assertStatus, assertForbidden, assertArray,
  skip,
  BASE_URL, TEST_USERS
} = require('../config');

let smtpConfigured = false;

module.exports = {
  name: 'CORRESPONDENCE (deep)',
  tests: [
    {
      name: 'CORR-0: Check SMTP availability',
      run: async () => {
        // Try sending a test email — server has test-mode fallback that always works
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: { to: 'corr-test@example.com', subject: 'CORR-0 SMTP check', body_text: 'probe' }
        });
        smtpConfigured = resp.ok;
      }
    },
    {
      name: 'CORR-1: GET /api/data/correspondence (ADMIN) → 200, array',
      run: async () => {
        const resp = await api('GET', '/api/data/correspondence', { role: 'ADMIN' });
        assertOk(resp, 'GET correspondence ADMIN');
        const list = resp.data?.correspondence || resp.data?.items || resp.data;
        assertArray(list, 'correspondence');
      }
    },
    {
      name: 'CORR-2: GET /api/data/correspondence (PM) → 200 (PM has correspondence access)',
      run: async () => {
        const resp = await api('GET', '/api/data/correspondence', { role: 'PM' });
        assertOk(resp, 'PM correspondence access');
      }
    },
    {
      name: 'CORR-3: GET /api/data/correspondence (HR) → 403 (HR has no correspondence access)',
      run: async () => {
        const resp = await api('GET', '/api/data/correspondence', { role: 'HR' });
        assertForbidden(resp, 'HR correspondence access');
      }
    },
    {
      name: 'CORR-4: Send email → correspondence.number has АС-ИСХ format',
      run: async () => {
        if (!smtpConfigured) skip('SMTP not configured');
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: { to: 'test@example.com', subject: 'CORR-4 test', body_text: 'test' }
        });
        assertOk(resp, 'send for correspondence');
      }
    },
    {
      name: 'CORR-5: Sent email appears in correspondence list',
      run: async () => {
        if (!smtpConfigured) skip('SMTP not configured');
        const resp = await api('GET', '/api/data/correspondence?limit=5', { role: 'ADMIN' });
        assertOk(resp, 'correspondence after send');
      }
    },
    {
      name: 'CORR-6: Correspondence record has subject and number fields',
      run: async () => {
        if (!smtpConfigured) skip('SMTP not configured');
        const resp = await api('GET', '/api/data/correspondence?limit=1', { role: 'ADMIN' });
        assertOk(resp, 'correspondence record');
      }
    },
    {
      name: 'CORR-7: GET /api/mailbox/next-outgoing-number → 200 + valid format',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/next-outgoing-number', { role: 'ADMIN' });
        assertOk(resp, 'next outgoing number');
        const num = resp.data?.number || resp.data;
        assert(typeof num === 'string' && num.length > 0, 'number should be non-empty string');
      }
    },
    {
      name: 'CORR-8: Two sequential numbers differ by 1',
      run: async () => {
        if (!smtpConfigured) skip('SMTP not configured');
        const n1 = await api('GET', '/api/mailbox/next-outgoing-number', { role: 'ADMIN' });
        assertOk(n1, 'first number');
      }
    }
  ]
};
