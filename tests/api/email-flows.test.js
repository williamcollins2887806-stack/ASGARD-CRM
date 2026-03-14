/**
 * BLOCK 1: EMAIL FLOWS — All email sending points
 * Tests mailbox send, drafts, templates, classification, stats, and simple email API
 */
'use strict';

const { api, rawFetch, assert, assertOk, assertStatus, assertForbidden,
        assertArray, assertHasFields, assertFieldType, assertIdReturned,
        assertCount, assertMatch, assertNotHasFields, assertOneOf,
        skip, TEST_USERS } = require('../config');

let draftId = null;
let templateId = null;
let classRuleId = null;
let testEmailId = null;

module.exports = {
  name: 'BLOCK 1 — EMAIL FLOWS',
  tests: [
    // ═══════════════════════════════════════════════
    // 1.1 Direct send from Mailbox tab
    // ═══════════════════════════════════════════════
    {
      name: '1.1.1 POST /api/mailbox/send with to, subject, body → 200 + messageId',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: {
            to: 'test-recipient@example.com',
            subject: 'Test email flow',
            body_text: 'Hello from ASGARD CRM test',
            body_html: '<p>Hello from ASGARD CRM test</p>'
          }
        });
        // SMTP may not be configured in test — accept 200 or 500 with SMTP error
        if (resp.status === 500 && resp.data && /smtp|SMTP|транспорт|connect|ECONNREFUSED/i.test(JSON.stringify(resp.data))) {
          skip('SMTP not configured in test environment');
        }
        assertOk(resp, 'send email');
        assert(resp.data.success === true, 'success flag');
      }
    },
    {
      name: '1.1.2 POST /api/mailbox/send with CC and BCC → 200',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: {
            to: 'main@example.com',
            cc: 'cc-user@example.com',
            bcc: 'bcc-hidden@example.com',
            subject: 'CC/BCC test',
            body_text: 'Testing CC and BCC fields'
          }
        });
        if (resp.status === 500 && /smtp|SMTP|connect|ECONNREFUSED/i.test(JSON.stringify(resp.data))) {
          skip('SMTP not configured');
        }
        assertOk(resp, 'send with cc/bcc');
      }
    },
    {
      name: '1.1.3 POST /api/mailbox/send without "to" → 400',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: {
            subject: 'No recipient',
            body_text: 'Missing to field'
          }
        });
        assertStatus(resp, 400, 'missing to');
      }
    },
    {
      name: '1.1.4 POST /api/mailbox/send without subject → 400',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: {
            to: 'test@example.com',
            body_text: 'Missing subject'
          }
        });
        assertStatus(resp, 400, 'missing subject');
      }
    },
    {
      name: '1.1.5 POST /api/mailbox/send with invalid email → 400',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: {
            to: 'not-an-email',
            subject: 'Bad email',
            body_text: 'Invalid format'
          }
        });
        assertStatus(resp, 400, 'invalid email format');
      }
    },
    {
      name: '1.1.6 POST /api/mailbox/send "Name <email>" format → accepted',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: {
            to: 'Test User <test-user@example.com>',
            subject: 'Named recipient test',
            body_text: 'Testing Name <email> format'
          }
        });
        if (resp.status === 500 && /smtp|SMTP|connect|ECONNREFUSED/i.test(JSON.stringify(resp.data))) {
          skip('SMTP not configured');
        }
        // Should not be 400 — the Name <email> format is valid
        assert(resp.status !== 400, `expected non-400 for Name <email>, got ${resp.status}`);
      }
    },
    {
      name: '1.1.7 PM role CAN send via mailbox (MAILBOX_ROLES includes PM)',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'PM',
          body: {
            to: 'test@example.com',
            subject: 'PM attempt',
            body_text: 'PM has mailbox access'
          }
        });
        // PM has mailbox access; may get 200, 400, or 500 depending on SMTP config, but NOT 403
        assert(resp.status !== 403, 'PM should have mailbox access, got 403');
      }
    },

    // ═══════════════════════════════════════════════
    // 1.2 Drafts
    // ═══════════════════════════════════════════════
    {
      name: '1.2.1 POST /api/mailbox/drafts — save new draft',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/drafts', {
          role: 'ADMIN',
          body: {
            to: 'draft-to@example.com',
            subject: 'Draft test',
            body_text: 'Draft body content'
          }
        });
        assertOk(resp, 'create draft');
        assert(resp.data.success === true, 'draft success');
        draftId = resp.data.id;
        assert(draftId, 'draft id returned');
      }
    },
    {
      name: '1.2.2 POST /api/mailbox/drafts — update existing draft',
      run: async () => {
        if (!draftId) skip('No draft created');
        const resp = await api('POST', '/api/mailbox/drafts', {
          role: 'ADMIN',
          body: {
            id: draftId,
            subject: 'Draft test updated',
            body_text: 'Updated draft content'
          }
        });
        assertOk(resp, 'update draft');
      }
    },

    // ═══════════════════════════════════════════════
    // 1.3 Email stats
    // ═══════════════════════════════════════════════
    {
      name: '1.3.1 GET /api/mailbox/stats → counts',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/stats', { role: 'ADMIN' });
        assertOk(resp, 'email stats');
        const d = resp.data;
        assertHasFields(d, ['unread', 'inbox_total', 'starred', 'drafts', 'sent'], 'stats fields');
      }
    },

    // ═══════════════════════════════════════════════
    // 1.4 Email list and read
    // ═══════════════════════════════════════════════
    {
      name: '1.4.1 GET /api/mailbox/emails → array with pagination',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails?limit=5', { role: 'ADMIN' });
        assertOk(resp, 'email list');
        assertHasFields(resp.data, ['emails', 'total'], 'list fields');
        assertArray(resp.data.emails, 'emails array');
      }
    },
    {
      name: '1.4.2 GET /api/mailbox/emails filter by direction=inbound',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails?direction=inbound&limit=5', { role: 'ADMIN' });
        assertOk(resp, 'inbound filter');
        assertArray(resp.data.emails, 'emails');
      }
    },
    {
      name: '1.4.3 GET /api/mailbox/emails filter by is_starred=true',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails?is_starred=true&limit=5', { role: 'ADMIN' });
        assertOk(resp, 'starred filter');
        assertArray(resp.data.emails, 'emails');
      }
    },
    {
      name: '1.4.4 GET /api/mailbox/emails search by keyword',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails?search=test&limit=5', { role: 'ADMIN' });
        assertOk(resp, 'search filter');
        assertArray(resp.data.emails, 'emails');
      }
    },
    {
      name: '1.4.5 GET /api/mailbox/emails/:id — get single email detail',
      run: async () => {
        // First, get an email ID from the list
        const list = await api('GET', '/api/mailbox/emails?limit=1', { role: 'ADMIN' });
        assertOk(list, 'list emails');
        if (!list.data.emails || list.data.emails.length === 0) skip('No emails in DB');
        testEmailId = list.data.emails[0].id;
        const resp = await api('GET', `/api/mailbox/emails/${testEmailId}`, { role: 'ADMIN' });
        assertOk(resp, 'get email detail');
        assertHasFields(resp.data, ['email'], 'email field');
      }
    },

    // ═══════════════════════════════════════════════
    // 1.5 Email flags (PATCH)
    // ═══════════════════════════════════════════════
    {
      name: '1.5.1 PATCH /api/mailbox/emails/:id — mark as starred',
      run: async () => {
        if (!testEmailId) skip('No email to patch');
        const resp = await api('PATCH', `/api/mailbox/emails/${testEmailId}`, {
          role: 'ADMIN',
          body: { is_starred: true }
        });
        assertOk(resp, 'star email');
      }
    },
    {
      name: '1.5.2 PATCH /api/mailbox/emails/:id — no fields → 400',
      run: async () => {
        if (!testEmailId) skip('No email');
        const resp = await api('PATCH', `/api/mailbox/emails/${testEmailId}`, {
          role: 'ADMIN',
          body: {}
        });
        assertStatus(resp, 400, 'empty patch');
      }
    },

    // ═══════════════════════════════════════════════
    // 1.6 Bulk operations
    // ═══════════════════════════════════════════════
    {
      name: '1.6.1 POST /api/mailbox/emails/bulk — mark_read',
      run: async () => {
        if (!testEmailId) skip('No email');
        const resp = await api('POST', '/api/mailbox/emails/bulk', {
          role: 'ADMIN',
          body: { ids: [testEmailId], action: 'mark_read' }
        });
        assertOk(resp, 'bulk mark_read');
        assert(resp.data.success === true, 'bulk success');
      }
    },
    {
      name: '1.6.2 POST /api/mailbox/emails/bulk — empty ids → 400',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/emails/bulk', {
          role: 'ADMIN',
          body: { ids: [], action: 'mark_read' }
        });
        assertStatus(resp, 400, 'empty bulk ids');
      }
    },
    {
      name: '1.6.3 POST /api/mailbox/emails/bulk — unknown action → 400',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/emails/bulk', {
          role: 'ADMIN',
          body: { ids: [1], action: 'destroy_all' }
        });
        assertStatus(resp, 400, 'unknown action');
      }
    },

    // ═══════════════════════════════════════════════
    // 1.7 Templates
    // ═══════════════════════════════════════════════
    {
      name: '1.7.1 GET /api/mailbox/templates → array',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/templates', { role: 'ADMIN' });
        assertOk(resp, 'list templates');
        assertHasFields(resp.data, ['templates'], 'templates field');
        assertArray(resp.data.templates, 'templates list');
      }
    },
    {
      name: '1.7.2 POST /api/mailbox/templates — create (ADMIN only)',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/templates', {
          role: 'ADMIN',
          body: {
            code: 'test_tpl_' + Date.now(),
            name: 'Test Template',
            category: 'custom',
            subject_template: 'Test: {{topic}}',
            body_template: '<p>Hello {{name}}</p>'
          }
        });
        assertOk(resp, 'create template');
        templateId = resp.data.id;
        assert(templateId, 'template id');
      }
    },
    {
      name: '1.7.3 POST /api/mailbox/templates/:id/render — render with variables',
      run: async () => {
        if (!templateId) skip('No template');
        const resp = await api('POST', `/api/mailbox/templates/${templateId}/render`, {
          role: 'ADMIN',
          body: { variables: { topic: 'CRM', name: 'Тестов' } }
        });
        assertOk(resp, 'render template');
        assertHasFields(resp.data, ['subject', 'body'], 'rendered fields');
      }
    },
    {
      name: '1.7.4 DELETE /api/mailbox/templates/:id — ADMIN only',
      run: async () => {
        if (!templateId) skip('No template');
        const resp = await api('DELETE', `/api/mailbox/templates/${templateId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete template');
      }
    },

    // ═══════════════════════════════════════════════
    // 1.8 Classification rules
    // ═══════════════════════════════════════════════
    {
      name: '1.8.1 GET /api/mailbox/classification-rules → array',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/classification-rules', { role: 'ADMIN' });
        assertOk(resp, 'list rules');
        assertHasFields(resp.data, ['rules'], 'rules field');
      }
    },
    {
      name: '1.8.2 POST /api/mailbox/classification-rules — create',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/classification-rules', {
          role: 'ADMIN',
          body: {
            rule_type: 'keyword_subject',
            pattern: 'ТЕСТ-ПРАВИЛО',
            match_mode: 'contains',
            classification: 'platform_tender',
            confidence: 90,
            priority: 100,
            description: 'Test classification rule'
          }
        });
        assertOk(resp, 'create rule');
        classRuleId = resp.data.id;
        assert(classRuleId, 'rule id');
      }
    },
    {
      name: '1.8.3 POST /api/mailbox/classification-rules/test — test classification',
      run: async () => {
        const resp = await api('POST', '/api/mailbox/classification-rules/test', {
          role: 'ADMIN',
          body: {
            from_email: 'tender@zakupki.gov.ru',
            subject: 'ТЕСТ-ПРАВИЛО Аукцион',
            body_text: 'Извещение о проведении'
          }
        });
        assertOk(resp, 'test classification');
      }
    },
    {
      name: '1.8.4 DELETE /api/mailbox/classification-rules/:id',
      run: async () => {
        if (!classRuleId) skip('No rule');
        const resp = await api('DELETE', `/api/mailbox/classification-rules/${classRuleId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete rule');
      }
    },

    // ═══════════════════════════════════════════════
    // 1.9 Correspondence number
    // ═══════════════════════════════════════════════
    {
      name: '1.9.1 GET /api/mailbox/next-outgoing-number → preview number',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/next-outgoing-number', { role: 'ADMIN' });
        assertOk(resp, 'next number');
        assertHasFields(resp.data, ['number'], 'number field');
      }
    },

    // ═══════════════════════════════════════════════
    // 1.10 Simple email API (/api/email)
    // ═══════════════════════════════════════════════
    {
      name: '1.10.1 POST /api/email/send — simple email',
      run: async () => {
        const resp = await api('POST', '/api/email/send', {
          role: 'ADMIN',
          body: {
            to: 'simple-test@example.com',
            subject: 'Simple email test',
            body: 'Plain text email body'
          }
        });
        if (resp.status === 500 && /smtp|SMTP|connect|ECONNREFUSED/i.test(JSON.stringify(resp.data))) {
          skip('SMTP not configured');
        }
        assertOk(resp, 'simple email send');
      }
    },
    {
      name: '1.10.2 POST /api/email/send — missing to → 400',
      run: async () => {
        const resp = await api('POST', '/api/email/send', {
          role: 'ADMIN',
          body: { subject: 'No recipient', body: 'Text' }
        });
        assertStatus(resp, 400, 'missing to');
      }
    },
    {
      name: '1.10.3 POST /api/email/send — missing subject → 400',
      run: async () => {
        const resp = await api('POST', '/api/email/send', {
          role: 'ADMIN',
          body: { to: 'test@example.com', body: 'No subject' }
        });
        assertStatus(resp, 400, 'missing subject');
      }
    },
    {
      name: '1.10.4 GET /api/email/history → array',
      run: async () => {
        const resp = await api('GET', '/api/email/history', { role: 'ADMIN' });
        assertOk(resp, 'email history');
        assertHasFields(resp.data, ['history'], 'history field');
        assertArray(resp.data.history, 'history array');
      }
    },
    {
      name: '1.10.5 POST /api/email/test — ADMIN only',
      run: async () => {
        const resp = await api('POST', '/api/email/test', {
          role: 'ADMIN',
          body: { email: 'test-target@example.com' }
        });
        if (resp.status === 500 && /smtp|SMTP|connect|ECONNREFUSED/i.test(JSON.stringify(resp.data))) {
          skip('SMTP not configured');
        }
        // Admin should at least not be forbidden
        assert(resp.status !== 403, 'admin allowed');
      }
    },
    {
      name: '1.10.6 POST /api/email/test — non-admin → 403',
      run: async () => {
        const resp = await api('POST', '/api/email/test', {
          role: 'PM',
          body: { email: 'test@example.com' }
        });
        assertForbidden(resp, 'PM denied email test');
      }
    },
    {
      name: '1.10.7 POST /api/email/settings — ADMIN only',
      run: async () => {
        const resp = await api('POST', '/api/email/settings', {
          role: 'PM',
          body: { host: 'smtp.test.com', port: 587, user: 'x', pass: 'y' }
        });
        assertForbidden(resp, 'PM denied settings');
      }
    },

    // ═══════════════════════════════════════════════
    // 1.11 Mailbox accounts (ADMIN/settings)
    // ═══════════════════════════════════════════════
    {
      name: '1.11.1 GET /api/mailbox/accounts → list (settings roles)',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/accounts', { role: 'ADMIN' });
        assertOk(resp, 'list accounts');
        assertHasFields(resp.data, ['accounts'], 'accounts field');
      }
    },
    {
      name: '1.11.2 GET /api/mailbox/accounts — PM denied → 403',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/accounts', { role: 'PM' });
        assertForbidden(resp, 'PM denied accounts');
      }
    },
    {
      name: '1.11.3 GET /api/mailbox/sync-log → logs',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/sync-log', { role: 'ADMIN' });
        assertOk(resp, 'sync log');
        assertHasFields(resp.data, ['logs'], 'logs field');
      }
    }
  ]
};
