/**
 * MAILBOX FULL COVERAGE — Accounts, templates, classification rules, email operations
 * MAILBOX_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO', 'HEAD_PM', 'PM', 'TO']
 */
const { api, assert, assertOk, assertForbidden, skip } = require('../config');

let emailId = null;
let accountId = null;
let templateId = null;
let classRuleId = null;

module.exports = {
  name: 'MAILBOX FULL COVERAGE',
  tests: [
    // ── EMAIL LIST ──
    {
      name: 'ADMIN reads mailbox emails',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN mailbox emails');
        const list = resp.data?.emails || resp.data?.items || resp.data?.data || [];
        if (Array.isArray(list) && list.length > 0) emailId = list[0].id;
      }
    },
    {
      name: 'ADMIN reads emails with is_read filter',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails?is_read=false', { role: 'ADMIN' });
        assertOk(resp, 'emails is_read filter');
      }
    },
    {
      name: 'ADMIN reads emails with search',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails?search=test', { role: 'ADMIN' });
        assertOk(resp, 'emails search');
      }
    },
    {
      name: 'ADMIN reads emails by direction',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails?direction=inbox', { role: 'ADMIN' });
        assertOk(resp, 'emails direction filter');
      }
    },
    {
      name: 'ADMIN reads mailbox stats',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/stats', { role: 'ADMIN' });
        assertOk(resp, 'mailbox stats');
      }
    },
    {
      name: 'ADMIN reads mailbox sync log',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/sync-log', { role: 'ADMIN' });
        assertOk(resp, 'mailbox sync log');
      }
    },
    {
      name: 'ADMIN reads next outgoing number',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/next-outgoing-number', { role: 'ADMIN' });
        assertOk(resp, 'next outgoing number');
      }
    },
    {
      name: 'DIRECTOR_COMM reads mailbox emails',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails', { role: 'DIRECTOR_COMM' });
        assertOk(resp, 'DIRECTOR_COMM mailbox emails');
      }
    },
    {
      name: 'NEGATIVE: WAREHOUSE cannot read mailbox emails',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails', { role: 'WAREHOUSE' });
        assert(resp.status === 403, 'WAREHOUSE mailbox should be 403, got ' + resp.status);
      }
    },
    {
      name: 'PM can read mailbox emails',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails', { role: 'PM' });
        assert(resp.status !== 403, 'PM has mailbox access (MAILBOX_ROLES includes PM), got ' + resp.status);
      }
    },
    {
      name: 'NEGATIVE: HR cannot read mailbox emails',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails', { role: 'HR' });
        assert(resp.status === 403, 'HR mailbox should be 403, got ' + resp.status);
      }
    },
    // ── EMAIL OPERATIONS ──
    {
      name: 'GET email by ID (if exists)',
      run: async () => {
        if (!emailId) skip('no emails in mailbox');
        const resp = await api('GET', `/api/mailbox/emails/${emailId}`, { role: 'ADMIN' });
        assertOk(resp, 'get email by id');
      }
    },
    {
      name: 'PATCH email - mark as read (if exists)',
      run: async () => {
        if (!emailId) skip('no emailId');
        const resp = await api('PATCH', `/api/mailbox/emails/${emailId}`, {
          role: 'ADMIN',
          body: { is_read: true }
        });
        assertOk(resp, 'patch email mark read');
      }
    },
    {
      name: 'PATCH email - mark as starred (if exists)',
      run: async () => {
        if (!emailId) skip('no emailId');
        const resp = await api('PATCH', `/api/mailbox/emails/${emailId}`, {
          role: 'ADMIN',
          body: { is_starred: true }
        });
        assertOk(resp, 'patch email mark starred');
      }
    },
    {
      name: 'POST /emails/bulk - bulk read action',
      run: async () => {
        if (!emailId) skip('no emailId');
        const resp = await api('POST', '/api/mailbox/emails/bulk', {
          role: 'ADMIN',
          body: { action: 'read', ids: [emailId], value: true }
        });
        assert([200, 400].includes(resp.status), 'bulk read: got ' + resp.status);
      }
    },
    {
      name: 'POST /send email (SMTP may not be configured)',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: {
            to: 'test@example.com',
            subject: 'E2E Test Email',
            body: '<p>E2E test</p>'
          }
        });
        assert([200, 400, 500, 503].includes(resp.status), 'send email: got ' + resp.status);
      }
    },
    // ── EMAIL ACCOUNTS ──
    {
      name: 'ADMIN reads email accounts',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/accounts', { role: 'ADMIN' });
        assertOk(resp, 'mailbox accounts');
        const list = resp.data?.accounts || resp.data?.items || resp.data || [];
        if (Array.isArray(list) && list.length > 0) accountId = list[0].id;
      }
    },
    {
      name: 'ADMIN creates email account',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/accounts', {
          role: 'ADMIN',
          body: {
            name: 'E2E Test Account',
            email: 'e2e@test.example.com',
            smtp_host: 'smtp.example.com',
            smtp_port: 587,
            smtp_user: 'e2e@test.example.com',
            smtp_pass: 'testpass123',
            is_active: false
          }
        });
        assertOk(resp, 'create email account');
        const item = resp.data?.account || resp.data?.item || resp.data;
        if (item?.id) accountId = item.id;
      }
    },
    {
      name: 'ADMIN updates email account',
      run: async () => {
        if (!accountId) skip('no accountId');
        const resp = await api('PUT', `/api/mailbox/accounts/${accountId}`, {
          role: 'ADMIN',
          body: { name: 'E2E Updated Account', smtp_port: 465 }
        });
        assertOk(resp, 'update email account');
      }
    },
    {
      name: 'ADMIN tests SMTP (bad credentials → error in response, not 5xx)',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/accounts/test-smtp', {
          role: 'ADMIN',
          body: {
            host: 'smtp.nonexistent-e2e-test.com',
            port: 587,
            user: 'test@test.com',
            pass: 'wrong',
            secure: false
          }
        });
        assert([200, 400].includes(resp.status), 'test-smtp: got ' + resp.status);
      }
    },
    {
      name: 'ADMIN tests IMAP (bad credentials → error in response)',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/accounts/test-imap', {
          role: 'ADMIN',
          body: {
            host: 'imap.nonexistent-e2e-test.com',
            port: 993,
            user: 'test@test.com',
            pass: 'wrong',
            tls: true
          }
        });
        assert([200, 400].includes(resp.status), 'test-imap: got ' + resp.status);
      }
    },
    {
      name: 'ADMIN syncs email account',
      run: async () => {
        if (!accountId) skip('no accountId');
        const resp = await api('POST', `/api/mailbox/accounts/${accountId}/sync`, {
          role: 'ADMIN',
          body: {}
        });
        assert([200, 400, 500].includes(resp.status), 'sync account: got ' + resp.status);
      }
    },
    {
      name: 'ADMIN deletes email account',
      run: async () => {
        if (!accountId) skip('no accountId');
        const resp = await api('DELETE', `/api/mailbox/accounts/${accountId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete email account');
      }
    },
    // ── EMAIL TEMPLATES ──
    {
      name: 'ADMIN reads email templates',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/templates', { role: 'ADMIN' });
        assertOk(resp, 'email templates');
        const list = resp.data?.templates || resp.data?.items || resp.data || [];
        if (Array.isArray(list) && list.length > 0) templateId = list[0].id;
      }
    },
    {
      name: 'ADMIN creates email template',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/templates', {
          role: 'ADMIN',
          body: {
            name: 'E2E Test Template',
            subject: 'E2E Subject {{name}}',
            body_html: '<p>Hello {{name}}, this is a test.</p>'
          }
        });
        assertOk(resp, 'create email template');
        const item = resp.data?.template || resp.data?.item || resp.data;
        if (item?.id) templateId = item.id;
      }
    },
    {
      name: 'ADMIN updates email template',
      run: async () => {
        if (!templateId) skip('no templateId');
        const resp = await api('PUT', `/api/mailbox/templates/${templateId}`, {
          role: 'ADMIN',
          body: { name: 'E2E Updated Template', subject: 'Updated Subject {{name}}' }
        });
        assertOk(resp, 'update template');
      }
    },
    {
      name: 'ADMIN renders template with variables',
      run: async () => {
        if (!templateId) skip('no templateId');
        const resp = await api('POST', `/api/mailbox/templates/${templateId}/render`, {
          role: 'ADMIN',
          body: { variables: { name: 'Тест Тестов' } }
        });
        assertOk(resp, 'render template');
      }
    },
    {
      name: 'ADMIN deletes email template',
      run: async () => {
        if (!templateId) skip('no templateId');
        const resp = await api('DELETE', `/api/mailbox/templates/${templateId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete template');
      }
    },
    // ── CLASSIFICATION RULES ──
    {
      name: 'ADMIN reads classification rules',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/classification-rules', { role: 'ADMIN' });
        assertOk(resp, 'classification rules');
      }
    },
    {
      name: 'ADMIN creates classification rule',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/classification-rules', {
          role: 'ADMIN',
          body: {
            pattern: 'e2e_test',
            category: 'test',
            match_field: 'subject'
          }
        });
        assertOk(resp, 'create classification rule');
        const item = resp.data?.rule || resp.data?.item || resp.data;
        classRuleId = item?.id;
      }
    },
    {
      name: 'ADMIN updates classification rule',
      run: async () => {
        if (!classRuleId) skip('no classRuleId');
        const resp = await api('PUT', `/api/mailbox/classification-rules/${classRuleId}`, {
          role: 'ADMIN',
          body: { category: 'updated_test', is_active: true }
        });
        assertOk(resp, 'update classification rule');
      }
    },
    {
      name: 'ADMIN tests classification rule',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/classification-rules/test', {
          role: 'ADMIN',
          body: {
            subject: 'e2e_test incoming email',
            from: 'sender@example.com',
            body: 'test body content'
          }
        });
        assertOk(resp, 'test classification rule');
      }
    },
    {
      name: 'ADMIN deletes classification rule',
      run: async () => {
        if (!classRuleId) skip('no classRuleId');
        const resp = await api('DELETE', `/api/mailbox/classification-rules/${classRuleId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete classification rule');
      }
    }
  ]
};
