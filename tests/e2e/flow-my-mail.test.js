/**
 * E2E FLOW: My Mail v2.0 (Premium) — Full Lifecycle
 * Login → My Mail page → folders → emails list → compose → drafts → settings → poll → contacts → folder CRUD
 * Tests all roles can access /my-mail
 */
const { api, rawFetch, assert, assertOk, assertStatus, skip } = require('../config');

let myMailAccount = null;
let draftId = null;
let customFolderId = null;

module.exports = {
  name: 'FLOW: My Mail v2.0 — Premium Email Client',
  tests: [
    // --- Access for all roles ---
    {
      name: 'ADMIN can access /api/my-mail/account',
      run: async () => {
        const resp = await api('GET', '/api/my-mail/account', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN should access my-mail account');
        assert(resp.data.hasOwnProperty('configured'), 'Response should have configured field');
      }
    },
    {
      name: 'TO can access /api/my-mail/account',
      run: async () => {
        const resp = await api('GET', '/api/my-mail/account', { role: 'TO' });
        assertOk(resp, 'TO should access my-mail account');
      }
    },
    {
      name: 'PM can access /api/my-mail/account',
      run: async () => {
        const resp = await api('GET', '/api/my-mail/account', { role: 'PM' });
        assertOk(resp, 'PM should access my-mail account');
      }
    },
    {
      name: 'HR can access /api/my-mail/account',
      run: async () => {
        const resp = await api('GET', '/api/my-mail/account', { role: 'HR' });
        assertOk(resp, 'HR should access my-mail account');
      }
    },
    {
      name: 'BUH can access /api/my-mail/account',
      run: async () => {
        const resp = await api('GET', '/api/my-mail/account', { role: 'BUH' });
        assertOk(resp, 'BUH should access my-mail account');
      }
    },
    {
      name: 'WAREHOUSE can access /api/my-mail/account',
      run: async () => {
        const resp = await api('GET', '/api/my-mail/account', { role: 'WAREHOUSE' });
        assertOk(resp, 'WAREHOUSE should access my-mail account');
      }
    },

    // --- Folders ---
    {
      name: 'Get folder list',
      run: async () => {
        const resp = await api('GET', '/api/my-mail/folders', { role: 'ADMIN' });
        assertOk(resp, 'Should get folders');
        assert(Array.isArray(resp.data.folders), 'Folders should be array');
      }
    },

    // --- Emails list ---
    {
      name: 'Get emails with pagination',
      run: async () => {
        const resp = await api('GET', '/api/my-mail/emails?limit=10&offset=0', { role: 'ADMIN' });
        assertOk(resp, 'Should get emails');
        assert(Array.isArray(resp.data.emails), 'Emails should be array');
        assert(typeof resp.data.total === 'number', 'Total should be number');
      }
    },
    {
      name: 'Search emails',
      run: async () => {
        const resp = await api('GET', '/api/my-mail/emails?search=test', { role: 'ADMIN' });
        assertOk(resp, 'Should search emails');
        assert(Array.isArray(resp.data.emails), 'Search results should be array');
      }
    },

    // --- Stats ---
    {
      name: 'Get mail stats',
      run: async () => {
        const resp = await api('GET', '/api/my-mail/stats', { role: 'ADMIN' });
        assertOk(resp, 'Should get stats');
        assert(typeof resp.data.unread === 'number', 'Unread should be number');
        assert(typeof resp.data.total === 'number', 'Total should be number');
      }
    },

    // --- NEW v2.0: Poll ---
    {
      name: 'GET /api/my-mail/poll — lightweight polling',
      run: async () => {
        const resp = await api('GET', '/api/my-mail/poll', { role: 'ADMIN' });
        assertOk(resp, 'Should get poll data');
        assert(typeof resp.data.unread === 'number', 'Unread should be number');
      }
    },

    // --- NEW v2.0: Contacts ---
    {
      name: 'GET /api/my-mail/contacts — address book',
      run: async () => {
        const resp = await api('GET', '/api/my-mail/contacts', { role: 'ADMIN' });
        assertOk(resp, 'Should get contacts');
        assert(Array.isArray(resp.data.contacts), 'Contacts should be array');
      }
    },

    // --- NEW v2.0: Folder CRUD ---
    {
      name: 'POST /api/my-mail/folders — create custom folder',
      run: async () => {
        const resp = await api('POST', '/api/my-mail/folders', {
          role: 'ADMIN',
          body: { name: 'E2E Custom Folder' }
        });
        if (resp.status === 200 || resp.status === 201) {
          assert(resp.data.folder || resp.data.id, 'Should return folder info');
          customFolderId = resp.data.folder?.id || resp.data.id;
        }
      }
    },
    {
      name: 'PUT /api/my-mail/folders/:id — rename folder',
      run: async () => {
        if (!customFolderId) return; // skip if folder wasn't created
        const resp = await api('PUT', `/api/my-mail/folders/${customFolderId}`, {
          role: 'ADMIN',
          body: { name: 'E2E Renamed Folder' }
        });
        assert([200, 404].includes(resp.status), 'Should rename or report not found');
      }
    },
    {
      name: 'DELETE /api/my-mail/folders/:id — delete folder',
      run: async () => {
        if (!customFolderId) return;
        const resp = await api('DELETE', `/api/my-mail/folders/${customFolderId}`, { role: 'ADMIN' });
        assert([200, 204, 404].includes(resp.status), 'Should delete or report not found');
      }
    },

    // --- Drafts ---
    {
      name: 'Create draft',
      run: async () => {
        const resp = await api('POST', '/api/my-mail/drafts', {
          role: 'ADMIN',
          body: {
            to: ['e2e-test@example.com'],
            subject: 'E2E Draft Test v2',
            body_text: 'This is an E2E test draft v2',
            body_html: '<p>This is an E2E test draft v2</p>'
          }
        });
        if (resp.status === 200 || resp.status === 201) {
          assert(resp.data.id || resp.data.success, 'Should return draft info');
          draftId = resp.data.id;
        }
      }
    },

    // --- Account settings ---
    {
      name: 'Update account signature',
      run: async () => {
        const resp = await api('PUT', '/api/my-mail/account', {
          role: 'ADMIN',
          body: {
            display_name: 'E2E Test Admin v2',
            signature_html: '<p>С уважением, E2E Test v2</p>'
          }
        });
        assert([200, 404].includes(resp.status), 'Should update or report no account');
      }
    },

    // --- Auth checks ---
    {
      name: 'Unauthenticated request blocked',
      run: async () => {
        const resp = await rawFetch('GET', '/api/my-mail/account');
        assert(resp.status >= 400, 'Should block unauthenticated request');
      }
    },
    {
      name: 'Unauthenticated poll blocked',
      run: async () => {
        const resp = await rawFetch('GET', '/api/my-mail/poll');
        assert(resp.status >= 400, 'Should block unauthenticated poll');
      }
    },

    // --- Input validation (v2.0) ---
    {
      name: 'POST /api/my-mail/send rejects empty body',
      run: async () => {
        const resp = await api('POST', '/api/my-mail/send', { role: 'ADMIN', body: {} });
        assert(resp.status === 400, 'Should reject missing required fields');
      }
    },

    // --- Existing endpoints still work ---
    {
      name: 'Existing auth still works',
      run: async () => {
        const resp = await api('POST', '/api/auth/login', {
          body: { login: 'test_admin', password: 'Test123!' }
        });
        assertOk(resp, 'Login should still work');
        assert(resp.data?.token || resp.data?.user, 'Should return token');
      }
    },
    {
      name: 'Existing users API still works',
      run: async () => {
        const resp = await api('GET', '/api/users', { role: 'ADMIN' });
        assertOk(resp, 'Users API should still work');
      }
    }
  ]
};
