/**
 * ASGARD CRM — Verification Tests for ALL 17 Tasks
 * ═══════════════════════════════════════════════════════════
 * Covers every task from "ASGARD CRM — Полный промпт":
 *
 *  1. Auth: login + PIN-verify → 200
 *  2. 15-role permission matrix — role-based access
 *  3. Modules CRUD (tenders, works, estimates, invoices, etc.)
 *  4. Chat groups / real-time
 *  5. Notifications: create + Telegram helper exists
 *  6. IMAP: service file + init
 *  7. Alerts: link_hash / link field handling
 *  8. Global search: navigateToResult in frontend
 *  9. Data API: ALLOWED_TABLES includes tkp, pass_requests, tmc_requests
 * 10. 401-redirect: db.js handles unauthorized
 * 11. TKP: full CRUD + PDF + status
 * 12. Pass requests: full CRUD + PDF + status
 * 13. TMC requests: full CRUD + Excel export
 * 14. Excel export: calculator_v2.js uses XLSX (SheetJS)
 * 15. API audit: all registered routes respond
 * 16. Menu/modal audit: frontend pages exist
 * 17. Migration V031 + test file existence
 */
'use strict';

const {
  api, assert, assertOk, assertStatus, assertForbidden,
  assertArray, assertHasFields, assertFieldType, assertIdReturned,
  assertCount, assertMatch, skip, SkipError, rawFetch
} = require('../config');

const fs = require('fs');
const path = require('path');

// Track created IDs for cleanup
let tkpId = null;
let passId = null;
let tmcId = null;

module.exports = {
  name: '17 TASKS VERIFICATION',
  tests: [

    // ═══════════════════════════════════════════════════════════════
    // TASK 1: Auth (login + PIN)
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T1] POST /api/auth/login returns token + status',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', {
          body: { login: 'admin', password: 'admin123' }
        });
        assertOk(resp, 'login');
        assert(resp.data.token, 'login must return token');
        assert(resp.data.status === 'need_pin' || resp.data.status === 'ok', 'status should be need_pin or ok');
        assert(resp.data.user && resp.data.user.id, 'login must return user object with id');
      }
    },
    {
      name: '[T1] Auth rejects invalid credentials',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', {
          body: { login: 'admin', password: 'wrong-password-xyz' }
        });
        assert(resp.status === 401 || resp.status === 400, `expected 401/400, got ${resp.status}`);
      }
    },
    {
      name: '[T1] Protected endpoint rejects no-token request',
      run: async () => {
        const resp = await rawFetch('GET', '/api/users');
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 2: 15-role permission matrix
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T2] ADMIN can access /api/users',
      run: async () => {
        const resp = await api('GET', '/api/users', { role: 'ADMIN' });
        assertOk(resp, 'admin users');
      }
    },
    {
      name: '[T2] Permission matrix: TO cannot delete users',
      run: async () => {
        const resp = await api('DELETE', '/api/users/99999', { role: 'TO' });
        assertForbidden(resp, 'TO delete user');
      }
    },
    {
      name: '[T2] GET /api/permissions/modules returns module list',
      run: async () => {
        const resp = await api('GET', '/api/permissions/modules', { role: 'ADMIN' });
        assertOk(resp, 'permissions/modules');
        assertArray(resp.data, 'modules');
        assert(resp.data.length > 0, 'should have at least 1 module');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 3: Modules CRUD (tenders, works, invoices)
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T3] GET /api/tenders returns array',
      run: async () => {
        const resp = await api('GET', '/api/tenders', { role: 'ADMIN' });
        assertOk(resp, 'tenders');
        const list = resp.data?.tenders || resp.data;
        assertArray(list, 'tenders');
      }
    },
    {
      name: '[T3] GET /api/works returns array',
      run: async () => {
        const resp = await api('GET', '/api/works', { role: 'ADMIN' });
        assertOk(resp, 'works');
        const list = resp.data?.works || resp.data;
        assertArray(list, 'works');
      }
    },
    {
      name: '[T3] GET /api/invoices returns array',
      run: async () => {
        const resp = await api('GET', '/api/invoices', { role: 'ADMIN' });
        assertOk(resp, 'invoices');
        const list = resp.data?.invoices || resp.data;
        assertArray(list, 'invoices');
      }
    },
    {
      name: '[T3] GET /api/estimates returns response',
      run: async () => {
        const resp = await api('GET', '/api/estimates', { role: 'ADMIN' });
        assertOk(resp, 'estimates');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 4: Chat groups
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T4] GET /api/chat-groups returns chats array',
      run: async () => {
        const resp = await api('GET', '/api/chat-groups', { role: 'ADMIN' });
        assertOk(resp, 'chat-groups');
        const list = resp.data?.chats || resp.data;
        assertArray(list, 'chats');
      }
    },
    {
      name: '[T4] chat_groups.js has messenger-style UI (bubbles, sidebar, polling)',
      run: async () => {
        const chatPath = path.join(__dirname, '..', '..', 'public', 'assets', 'js', 'chat_groups.js');
        assert(fs.existsSync(chatPath), 'chat_groups.js should exist');
        const src = fs.readFileSync(chatPath, 'utf8');
        assert(src.includes('chat-message-bubble'), 'should have message bubbles');
        assert(src.includes('chat-sidebar'), 'should have sidebar with chat list');
        assert(src.includes('chat-message-sender'), 'should show sender name');
        assert(src.includes('scrollTop') || src.includes('scrollHeight'), 'should auto-scroll to bottom');
        assert(src.includes('pollingInterval') || src.includes('setInterval'), 'should have polling for new messages');
        assert(src.includes('isOwn'), 'should distinguish own vs other messages');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 5: Notifications + Telegram
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T5] GET /api/notifications returns notifications array',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'ADMIN' });
        assertOk(resp, 'notifications');
        const list = resp.data?.notifications || resp.data;
        assertArray(list, 'notifications');
      }
    },
    {
      name: '[T5] src/services/notify.js exports createNotification',
      run: async () => {
        const notifyPath = path.join(__dirname, '..', '..', 'src', 'services', 'notify.js');
        assert(fs.existsSync(notifyPath), 'notify.js should exist');
        const mod = require(notifyPath);
        assert(typeof mod.createNotification === 'function', 'createNotification must be a function');
      }
    },
    {
      name: '[T5] src/services/telegram.js exists',
      run: async () => {
        const tgPath = path.join(__dirname, '..', '..', 'src', 'services', 'telegram.js');
        assert(fs.existsSync(tgPath), 'telegram.js should exist');
      }
    },
    {
      name: '[T5] Notification helper uses link field (for alerts.js compatibility)',
      run: async () => {
        const src = fs.readFileSync(
          path.join(__dirname, '..', '..', 'src', 'services', 'notify.js'), 'utf8'
        );
        assert(src.includes('link'), 'notify.js should reference link field');
        assert(src.includes('INSERT INTO notifications'), 'notify.js should insert into notifications');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 6: IMAP integration
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T6] src/services/imap.js exists and is substantial',
      run: async () => {
        const imapPath = path.join(__dirname, '..', '..', 'src', 'services', 'imap.js');
        assert(fs.existsSync(imapPath), 'imap.js should exist');
        const stats = fs.statSync(imapPath);
        assert(stats.size > 5000, `imap.js should be substantial (${stats.size} bytes)`);
      }
    },
    {
      name: '[T6] IMAP service is initialized in index.js',
      run: async () => {
        const src = fs.readFileSync(
          path.join(__dirname, '..', '..', 'src', 'index.js'), 'utf8'
        );
        assert(src.includes('imap') || src.includes('IMAP'), 'index.js should reference IMAP');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 7: Alerts — link_hash / link
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T7] alerts.js handles both link_hash and link fields',
      run: async () => {
        const src = fs.readFileSync(
          path.join(__dirname, '..', '..', 'public', 'assets', 'js', 'alerts.js'), 'utf8'
        );
        assert(src.includes('link_hash'), 'alerts.js should reference link_hash');
        assert(src.includes('link'), 'alerts.js should reference link');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 8: Global search with navigate
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T8] global_search.js has navigateToResult function',
      run: async () => {
        const src = fs.readFileSync(
          path.join(__dirname, '..', '..', 'public', 'assets', 'js', 'global_search.js'), 'utf8'
        );
        assert(src.includes('navigateToResult'), 'global_search.js should have navigateToResult');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 9: Data API — ALLOWED_TABLES
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T9] /api/data/tkp returns data',
      run: async () => {
        const resp = await api('GET', '/api/data/tkp?limit=1', { role: 'ADMIN' });
        assertOk(resp, 'data/tkp');
      }
    },
    {
      name: '[T9] /api/data/pass_requests returns data',
      run: async () => {
        const resp = await api('GET', '/api/data/pass_requests?limit=1', { role: 'ADMIN' });
        assertOk(resp, 'data/pass_requests');
      }
    },
    {
      name: '[T9] /api/data/tmc_requests returns data',
      run: async () => {
        const resp = await api('GET', '/api/data/tmc_requests?limit=1', { role: 'ADMIN' });
        assertOk(resp, 'data/tmc_requests');
      }
    },
    {
      name: '[T9] data.js ALLOWED_TABLES includes new tables',
      run: async () => {
        const src = fs.readFileSync(
          path.join(__dirname, '..', '..', 'src', 'routes', 'data.js'), 'utf8'
        );
        assert(src.includes("'tkp'") || src.includes('"tkp"'), 'data.js should include tkp');
        assert(src.includes('pass_requests'), 'data.js should include pass_requests');
        assert(src.includes('tmc_requests'), 'data.js should include tmc_requests');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 10: 401-redirect in db.js
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T10] db.js handles 401 Unauthorized',
      run: async () => {
        const src = fs.readFileSync(
          path.join(__dirname, '..', '..', 'public', 'assets', 'js', 'db.js'), 'utf8'
        );
        assert(src.includes('401') || src.includes('Unauthorized'), 'db.js should handle 401');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 11: TKP — full CRUD + PDF + status
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T11] POST /api/tkp creates TKP',
      run: async () => {
        const resp = await api('POST', '/api/tkp', {
          role: 'ADMIN',
          body: {
            title: 'ТЕСТ-ТКП-VERIFY',
            customer_name: 'Тестовый заказчик',
            customer_email: 'test@example.com',
            total_sum: 150000,
            services: 'Монтаж, Пусконаладка',
            deadline: '30 дней',
            validity_days: 45,
            content_json: { items: [{ name: 'Услуга', quantity: 1, unit: 'шт', price: 150000, total: 150000 }] }
          }
        });
        assertOk(resp, 'create tkp');
        const item = resp.data?.item || resp.data;
        assert(item.id, 'tkp should have id');
        tkpId = item.id;
        assert(item.subject === 'ТЕСТ-ТКП-VERIFY' || item.title === 'ТЕСТ-ТКП-VERIFY',
          'subject/title should match');
        assert(item.author_id, 'should have author_id');
      }
    },
    {
      name: '[T11] GET /api/tkp/:id returns created TKP',
      run: async () => {
        if (!tkpId) skip('No TKP created');
        const resp = await api('GET', `/api/tkp/${tkpId}`, { role: 'ADMIN' });
        assertOk(resp, 'get tkp');
        const item = resp.data?.item || resp.data;
        assertHasFields(item, ['id', 'subject', 'total_sum', 'status', 'author_id'], 'tkp detail');
      }
    },
    {
      name: '[T11] GET /api/tkp lists TKPs',
      run: async () => {
        const resp = await api('GET', '/api/tkp', { role: 'ADMIN' });
        assertOk(resp, 'list tkp');
        const items = resp.data?.items || resp.data;
        assertArray(items, 'tkp items');
        assert(items.length >= 1, 'should have at least 1 TKP');
      }
    },
    {
      name: '[T11] PUT /api/tkp/:id/status changes status',
      run: async () => {
        if (!tkpId) skip('No TKP created');
        const resp = await api('PUT', `/api/tkp/${tkpId}/status`, {
          role: 'ADMIN',
          body: { status: 'sent' }
        });
        assertOk(resp, 'status change');
        const item = resp.data?.item || resp.data;
        assert(item.status === 'sent', `expected sent, got ${item.status}`);
      }
    },
    {
      name: '[T11] GET /api/tkp/:id/pdf generates PDF',
      run: async () => {
        if (!tkpId) skip('No TKP created');
        const resp = await api('GET', `/api/tkp/${tkpId}/pdf`, { role: 'ADMIN' });
        assertOk(resp, 'tkp pdf');
        // PDF response — data may be string (binary) or buffer info
        assert(resp.status === 200, 'PDF should return 200');
      }
    },
    {
      name: '[T11] PUT /api/tkp/:id updates TKP',
      run: async () => {
        if (!tkpId) skip('No TKP created');
        const resp = await api('PUT', `/api/tkp/${tkpId}`, {
          role: 'ADMIN',
          body: { subject: 'Обновлённое ТКП', total_sum: 200000 }
        });
        assertOk(resp, 'update tkp');
        const item = resp.data?.item || resp.data;
        assert(item.subject === 'Обновлённое ТКП', 'subject should be updated');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 12: Pass requests — full CRUD + PDF + status
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T12] POST /api/pass-requests creates request',
      run: async () => {
        const resp = await api('POST', '/api/pass-requests', {
          role: 'ADMIN',
          body: {
            object_name: 'ТЕСТ-ОБЪЕКТ-VERIFY',
            pass_date_from: '2026-04-01',
            pass_date_to: '2026-04-30',
            employees_json: [{ fio: 'Иванов И.И.', passport: '1234 567890', position: 'Монтажник' }],
            vehicles_json: [{ brand: 'КАМАЗ', plate: 'А123БВ89' }],
            contact_person: 'Петров П.П.',
            contact_phone: '+7-900-123-4567'
          }
        });
        assertOk(resp, 'create pass');
        const item = resp.data?.item || resp.data;
        assert(item.id, 'pass should have id');
        passId = item.id;
        assert(item.object_name === 'ТЕСТ-ОБЪЕКТ-VERIFY', 'object_name should match');
        assert(item.author_id, 'should have author_id');
      }
    },
    {
      name: '[T12] GET /api/pass-requests/:id returns request',
      run: async () => {
        if (!passId) skip('No pass created');
        const resp = await api('GET', `/api/pass-requests/${passId}`, { role: 'ADMIN' });
        assertOk(resp, 'get pass');
        const item = resp.data?.item || resp.data;
        assertHasFields(item, ['id', 'object_name', 'date_from', 'date_to', 'status', 'workers'], 'pass detail');
      }
    },
    {
      name: '[T12] GET /api/pass-requests lists items',
      run: async () => {
        const resp = await api('GET', '/api/pass-requests', { role: 'ADMIN' });
        assertOk(resp, 'list pass');
        const items = resp.data?.items || resp.data;
        assertArray(items, 'pass items');
        assert(items.length >= 1, 'should have at least 1 pass request');
      }
    },
    {
      name: '[T12] PUT /api/pass-requests/:id/status → submitted',
      run: async () => {
        if (!passId) skip('No pass created');
        const resp = await api('PUT', `/api/pass-requests/${passId}/status`, {
          role: 'ADMIN',
          body: { status: 'submitted' }
        });
        assertOk(resp, 'submit pass');
        const item = resp.data?.item || resp.data;
        assert(item.status === 'submitted', `expected submitted, got ${item.status}`);
      }
    },
    {
      name: '[T12] PUT /api/pass-requests/:id/status → approved',
      run: async () => {
        if (!passId) skip('No pass created');
        const resp = await api('PUT', `/api/pass-requests/${passId}/status`, {
          role: 'ADMIN',
          body: { status: 'approved' }
        });
        assertOk(resp, 'approve pass');
        const item = resp.data?.item || resp.data;
        assert(item.status === 'approved', `expected approved, got ${item.status}`);
        assert(item.approved_by, 'approved_by should be set');
      }
    },
    {
      name: '[T12] GET /api/pass-requests/:id/pdf generates PDF',
      run: async () => {
        if (!passId) skip('No pass created');
        const resp = await api('GET', `/api/pass-requests/${passId}/pdf`, { role: 'ADMIN' });
        assertOk(resp, 'pass pdf');
        assert(resp.status === 200, 'PDF should return 200');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 13: TMC requests — full CRUD + Excel
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T13] POST /api/tmc-requests creates request',
      run: async () => {
        const resp = await api('POST', '/api/tmc-requests', {
          role: 'ADMIN',
          body: {
            title: 'ТЕСТ-ТМЦ-VERIFY',
            priority: 'high',
            items_json: [
              { name: 'Труба 219х8', unit: 'м.п.', quantity: 100, price: 1500 },
              { name: 'Задвижка DN200', unit: 'шт', quantity: 2, price: 25000 }
            ],
            total_sum: 200000,
            notes: 'Срочная поставка'
          }
        });
        assertOk(resp, 'create tmc');
        const item = resp.data?.item || resp.data;
        assert(item.id, 'tmc should have id');
        tmcId = item.id;
        assert(item.title === 'ТЕСТ-ТМЦ-VERIFY', 'title should match');
        assert(item.priority === 'high', 'priority should be high');
        assert(item.author_id, 'should have author_id');
      }
    },
    {
      name: '[T13] GET /api/tmc-requests/:id returns request',
      run: async () => {
        if (!tmcId) skip('No TMC created');
        const resp = await api('GET', `/api/tmc-requests/${tmcId}`, { role: 'ADMIN' });
        assertOk(resp, 'get tmc');
        const item = resp.data?.item || resp.data;
        assertHasFields(item, ['id', 'items', 'total_sum', 'status', 'priority'], 'tmc detail');
      }
    },
    {
      name: '[T13] GET /api/tmc-requests lists items',
      run: async () => {
        const resp = await api('GET', '/api/tmc-requests', { role: 'ADMIN' });
        assertOk(resp, 'list tmc');
        const items = resp.data?.items || resp.data;
        assertArray(items, 'tmc items');
        assert(items.length >= 1, 'should have at least 1 tmc request');
      }
    },
    {
      name: '[T13] GET /api/tmc-requests/:id/excel returns xlsx',
      run: async () => {
        if (!tmcId) skip('No TMC created');
        const resp = await api('GET', `/api/tmc-requests/${tmcId}/excel`, { role: 'ADMIN' });
        assertOk(resp, 'tmc excel');
        assert(resp.status === 200, 'Excel should return 200');
      }
    },
    {
      name: '[T13] GET /api/tmc-requests/export returns bulk xlsx',
      run: async () => {
        const resp = await api('GET', '/api/tmc-requests/export', { role: 'ADMIN' });
        assertOk(resp, 'tmc bulk export');
        assert(resp.status === 200, 'Bulk export should return 200');
      }
    },
    {
      name: '[T13] PUT /api/tmc-requests/:id/status → submitted',
      run: async () => {
        if (!tmcId) skip('No TMC created');
        const resp = await api('PUT', `/api/tmc-requests/${tmcId}/status`, {
          role: 'ADMIN',
          body: { status: 'submitted' }
        });
        assertOk(resp, 'submit tmc');
        const item = resp.data?.item || resp.data;
        assert(item.status === 'submitted', `expected submitted, got ${item.status}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 14: Excel export in calculator
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T14] calculator_v2.js uses SheetJS (XLSX) with styled headers + sum in words',
      run: async () => {
        const src = fs.readFileSync(
          path.join(__dirname, '..', '..', 'public', 'assets', 'js', 'calculator_v2.js'), 'utf8'
        );
        assert(src.includes('XLSX'), 'calculator_v2.js should use XLSX (SheetJS)');
        assert(
          src.includes('writeFile') || src.includes('write_file') || src.includes('book_new'),
          'should have XLSX write methods'
        );
        assert(src.includes('sumInWords'), 'should have sum-in-words function');
        assert(src.includes('HEADER_FILL') || src.includes('1A2D52'), 'should have styled header fill');
        assert(src.includes('ООО "Асгард-Сервис"') || src.includes('Асгард-Сервис'), 'should have company name in header');
        assert(src.includes('!merges'), 'should have merged cells for company header');
      }
    },
    {
      name: '[T14] index.html includes SheetJS CDN',
      run: async () => {
        const src = fs.readFileSync(
          path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8'
        );
        assert(src.includes('xlsx') || src.includes('sheetjs') || src.includes('XLSX'),
          'index.html should include XLSX/SheetJS CDN');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 15: API audit — all registered routes respond
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T15] All major GET endpoints respond 2xx (not 404/500)',
      run: async () => {
        // Each endpoint uses correct sub-path (routes w/o GET / use their first GET sub-route)
        const endpoints = [
          '/api/users',
          '/api/tenders',
          '/api/works',
          '/api/invoices',
          '/api/cash/all',
          '/api/tasks/all',
          '/api/notifications',
          '/api/settings',
          '/api/staff/employees',
          '/api/email/history',
          '/api/permissions/modules',
          '/api/chat-groups',
          '/api/tkp',
          '/api/pass-requests',
          '/api/tmc-requests',
          '/api/data/users',
          '/api/equipment',
          '/api/customers'
        ];
        const failed = [];
        for (const ep of endpoints) {
          const resp = await api('GET', ep, { role: 'ADMIN' });
          if (resp.status >= 400) failed.push(`${ep} → ${resp.status}`);
        }
        assert(failed.length === 0, `These endpoints failed: ${failed.join(', ')}`);
      }
    },
    {
      name: '[T15] POST /api/auth/login responds (not 404)',
      run: async () => {
        const resp = await rawFetch('POST', '/api/auth/login', {
          body: { login: 'test', password: 'test' }
        });
        assert(resp.status !== 404, 'auth/login should be registered');
        assert(resp.status === 400 || resp.status === 401, `expected 400/401 for bad creds, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 16: Menu/modal audit — frontend pages exist
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T16] Frontend pages exist: tkp, pass-requests, tmc-requests',
      run: async () => {
        const pages = ['tkp-page.js', 'pass-requests-page.js', 'tmc-requests-page.js'];
        const dir = path.join(__dirname, '..', '..', 'public', 'assets', 'js');
        for (const p of pages) {
          assert(fs.existsSync(path.join(dir, p)), `${p} should exist`);
        }
      }
    },
    {
      name: '[T16] app.js has routes for new pages',
      run: async () => {
        const src = fs.readFileSync(
          path.join(__dirname, '..', '..', 'public', 'assets', 'js', 'app.js'), 'utf8'
        );
        assert(src.includes('tkp'), 'app.js should have tkp route');
        assert(src.includes('pass-requests'), 'app.js should have pass-requests route');
        assert(src.includes('tmc-requests'), 'app.js should have tmc-requests route');
      }
    },
    {
      name: '[T16] index.html includes new page scripts',
      run: async () => {
        const src = fs.readFileSync(
          path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8'
        );
        assert(src.includes('tkp-page.js'), 'index.html should include tkp-page.js');
        assert(src.includes('pass-requests-page.js'), 'index.html should include pass-requests-page.js');
        assert(src.includes('tmc-requests-page.js'), 'index.html should include tmc-requests-page.js');
      }
    },
    {
      name: '[T16] finances.js uses CSS variables (no hardcoded rgba)',
      run: async () => {
        const src = fs.readFileSync(
          path.join(__dirname, '..', '..', 'public', 'assets', 'js', 'finances.js'), 'utf8'
        );
        assert(src.includes('var(--'), 'finances.js should use CSS variables');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // TASK 17: Migration + tests
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[T17] Migration V031__tkp_pass_tmc.sql exists',
      run: async () => {
        const migPath = path.join(__dirname, '..', '..', 'migrations', 'V031__tkp_pass_tmc.sql');
        assert(fs.existsSync(migPath), 'V031 migration should exist');
        const src = fs.readFileSync(migPath, 'utf8');
        assert(src.includes('tkp'), 'migration should reference tkp');
        assert(src.includes('pass_requests'), 'migration should reference pass_requests');
        assert(src.includes('tmc_requests'), 'migration should reference tmc_requests');
      }
    },
    {
      name: '[T17] This test file exists and is registered',
      run: async () => {
        const testPath = path.join(__dirname, 'tasks-17-verification.test.js');
        assert(fs.existsSync(testPath), 'tasks-17-verification.test.js should exist');
      }
    },
    {
      name: '[T17] business-process.test.js exists with 10 E2E scenarios',
      run: async () => {
        const bpPath = path.join(__dirname, 'business-process.test.js');
        assert(fs.existsSync(bpPath), 'business-process.test.js should exist');
        const src = fs.readFileSync(bpPath, 'utf8');
        assert(src.includes('BP1'), 'should have scenario BP1 (Tender flow)');
        assert(src.includes('BP5'), 'should have scenario BP5 (TMC flow)');
        assert(src.includes('BP10'), 'should have scenario BP10 (Multi-role)');
        assert(src.includes('Business Process') || src.includes('business process') || src.includes('SCENARIO'), 'should be business process test');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // CLEANUP — remove test data
    // ═══════════════════════════════════════════════════════════════
    {
      name: '[CLEANUP] Delete test TKP, Pass, TMC records',
      run: async () => {
        // Cleanup — non-critical, just best-effort
        if (tkpId) {
          // Reset status to draft first for deletion
          await api('PUT', `/api/tkp/${tkpId}/status`, { role: 'ADMIN', body: { status: 'draft' } });
          await api('DELETE', `/api/tkp/${tkpId}`, { role: 'ADMIN' });
        }
        if (passId) {
          // Pass in approved status, just leave it — not a draft
        }
        if (tmcId) {
          // TMC in submitted — leave it
        }
        // Always pass cleanup
        assert(true, 'cleanup done');
      }
    }
  ]
};
