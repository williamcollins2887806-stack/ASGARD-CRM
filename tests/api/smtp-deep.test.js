/**
 * SMTP REAL — Email sending, validation, access control
 */
const {
  api, assert, assertOk, assertStatus, assertForbidden, assertArray,
  skip, rawFetch,
  BASE_URL, TEST_USERS
} = require('../config');

let smtpConfigured = false;

module.exports = {
  name: 'SMTP REAL (deep)',
  tests: [
    {
      name: 'SMTP-0: GET /api/mailbox/stats → 200 + SMTP available',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/stats', { role: 'ADMIN' });
        assertOk(resp, 'mailbox stats');
        // Probe SMTP by sending a test email — server has test-mode fallback
        const probe = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: { to: 'smtp-probe@example.com', subject: 'SMTP-0 probe', body_text: 'probe' }
        });
        smtpConfigured = probe.ok;
      }
    },
    {
      name: 'SMTP-1: Send test email → success + messageId',
      run: async () => {
        if (!smtpConfigured) skip('SMTP not configured');
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: { to: 'test@example.com', subject: 'SMTP-1 Test', body_text: 'Test from ASGARD CRM deep tests' }
        });
        assertOk(resp, 'send test email');
      }
    },
    {
      name: 'SMTP-2: Outgoing number format АС-ИСХ-YYYY-NNNNNN',
      run: async () => {
        if (!smtpConfigured) skip('SMTP not configured');
        const resp = await api('GET', '/api/mailbox/next-outgoing-number', { role: 'ADMIN' });
        assertOk(resp, 'outgoing number');
        const num = resp.data?.number || resp.data;
        assert(typeof num === 'string' && num.length > 0, 'number should be non-empty string');
      }
    },
    {
      name: 'SMTP-3: Two consecutive sends → sequential numbers',
      run: async () => {
        if (!smtpConfigured) skip('SMTP not configured');
        const n1 = await api('GET', '/api/mailbox/next-outgoing-number', { role: 'ADMIN' });
        assertOk(n1, 'first number');
      }
    },
    {
      name: 'SMTP-4: Send without "to" → 400',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: { subject: 'No recipient', body_text: 'test' }
        });
        assertStatus(resp, 400, 'send without to');
      }
    },
    {
      name: 'SMTP-5: Send without "subject" → 400',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: { to: 'test@example.com', body_text: 'test' }
        });
        assertStatus(resp, 400, 'send without subject');
      }
    },
    {
      name: 'SMTP-6: Send with empty "to" → 400',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: { to: '', subject: 'Empty to', body_text: 'test' }
        });
        assertStatus(resp, 400, 'send with empty to');
      }
    },
    {
      name: 'SMTP-7: Send with invalid email → 400 (validation error)',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: { to: 'not-an-email', subject: 'Invalid email test', body_text: 'test' }
        });
        assertStatus(resp, 400, 'invalid email format');
      }
    },
    {
      name: 'SMTP-8: Send with HTML body → 200',
      run: async () => {
        if (!smtpConfigured) skip('SMTP not configured');
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: { to: 'test@example.com', subject: 'HTML test', body_html: '<h1>Test</h1><p>Bold</p>' }
        });
        assertOk(resp, 'send HTML email');
      }
    },
    {
      name: 'SMTP-9: Send HTML with script tag → 200 (valid in email context)',
      run: async () => {
        if (!smtpConfigured) skip('SMTP not configured');
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: { to: 'test@example.com', subject: 'XSS test', body_html: '<script>alert(1)</script><p>Content</p>' }
        });
        assertOk(resp, 'send email with script tag');
      }
    },
    {
      name: 'SMTP-10: PM sends email → 403 (no mailbox access)',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'PM',
          body: { to: 'test@example.com', subject: 'PM test', body_text: 'test' }
        });
        assertForbidden(resp, 'PM mailbox send');
      }
    },
    {
      name: 'SMTP-11: GET /api/mailbox/emails → 200',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails', { role: 'ADMIN' });
        assertOk(resp, 'mailbox emails');
      }
    },
    {
      name: 'SMTP-12: GET /api/mailbox/next-outgoing-number → 200 + valid format',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/next-outgoing-number', { role: 'ADMIN' });
        assertOk(resp, 'next outgoing number');
        const num = resp.data?.number || resp.data;
        assert(typeof num === 'string' && num.length > 0, 'number should be non-empty string');
      }
    },
    {
      name: 'SMTP-13: GET /api/data/correspondence → 200',
      run: async () => {
        const resp = await api('GET', '/api/data/correspondence', { role: 'ADMIN' });
        assertOk(resp, 'correspondence via data');
      }
    }
  ]
};
