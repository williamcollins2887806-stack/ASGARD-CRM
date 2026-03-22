/**
 * E2E FULL COVERAGE — Все непокрытые модули CRM
 *
 * Покрывает:  approval, permissions, mimir, hints, email, mailbox,
 *             travel, worker_profiles, employee_collections, stories,
 *             geo, push, files, integrations, sse, inbox_applications_ai,
 *             permits_import
 *
 * Стратегия: Все поля заполнены. При 404 — skip (модуль не задеплоен).
 *            Cleanup в конце каждой секции.
 */
const { api, assert, assertOk, assertStatus, assertForbidden, skip } = require('../config');

// Shared IDs
const S = {};
// Will be set in first test — any existing work_id for cash requests
let realWorkId = null;

module.exports = {
  name: 'FULL COVERAGE — All Remaining Modules',
  tests: [

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 1: APPROVAL CHAINS (generic approval flow)
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'APPROVAL: Find work_id for cash requests',
      run: async () => {
        const resp = await api('GET', '/api/works?limit=1', { role: 'ADMIN' });
        if (resp.status === 404) skip('works endpoint not available');
        assertOk(resp, 'Get works list');
        const works = resp.data?.works || resp.data?.items || [];
        if (works.length > 0) {
          realWorkId = works[0].id;
        } else {
          // Create a temp work
          const w = await api('POST', '/api/works', {
            role: 'PM',
            body: { work_title: 'E2E_COVERAGE Temp Work', customer_name: 'Test', work_status: 'Новая' }
          });
          if (w.ok) {
            realWorkId = w.data?.work?.id || w.data?.id;
            S.tempWorkId = realWorkId;
          }
        }
        assert(realWorkId, 'Must have a work_id for cash tests');
      }
    },
    {
      name: 'APPROVAL: PM creates cash_request for approval',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'PM',
          body: {
            work_id: realWorkId,
            type: 'advance',
            amount: 50000,
            purpose: 'E2E_COVERAGE Тестовый аванс на расходные материалы',
            cover_letter: 'Прошу выдать аванс'
          }
        });
        if (resp.status === 404) skip('cash endpoint not available');
        assertOk(resp, 'PM creates cash request');
        S.cashId = resp.data?.item?.id || resp.data?.id;
        assert(S.cashId, 'Cash request ID returned');
      }
    },
    {
      name: 'APPROVAL: Director approves cash_request',
      run: async () => {
        if (!S.cashId) skip('No cash request');
        const resp = await api('POST', `/api/approval/cash_requests/${S.cashId}/approve`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'E2E одобрено директором' }
        });
        if (resp.status === 404) skip('approval endpoint not available');
        assertOk(resp, 'Director approves cash request');
      }
    },
    {
      name: 'APPROVAL: Director rework flow (create + rework + resubmit + approve)',
      run: async () => {
        // Create another cash request
        const cr = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: realWorkId, type: 'advance', amount: 30000, purpose: 'E2E_COVERAGE Rework test' }
        });
        if (!cr.ok) skip('Cannot create cash for rework test');
        const id = cr.data?.item?.id || cr.data?.id;
        if (!id) skip('No ID for rework test');
        S.cashReworkId = id;

        // Director sends for rework
        const rw = await api('POST', `/api/approval/cash_requests/${id}/rework`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Уточните сумму' }
        });
        if (rw.status === 404) skip('rework endpoint not available');
        assertOk(rw, 'Director rework');

        // PM resubmits
        const rs = await api('POST', `/api/approval/cash_requests/${id}/resubmit`, {
          role: 'PM', body: {}
        });
        assertOk(rs, 'PM resubmit');

        // Director approves
        const ap = await api('POST', `/api/approval/cash_requests/${id}/approve`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Теперь ок' }
        });
        assertOk(ap, 'Director approve after rework');
      }
    },
    {
      name: 'APPROVAL: Director question flow',
      run: async () => {
        const cr = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: realWorkId, type: 'advance', amount: 20000, purpose: 'E2E_COVERAGE Question test' }
        });
        if (!cr.ok) skip('Cannot create cash');
        const id = cr.data?.item?.id || cr.data?.id;
        if (!id) skip('No ID');
        S.cashQuestionId = id;

        // Director asks question
        const q = await api('POST', `/api/approval/cash_requests/${id}/question`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Зачем эта сумма?' }
        });
        if (q.status === 404) skip('question endpoint not available');
        assertOk(q, 'Director asks question');
      }
    },
    {
      name: 'APPROVAL: Director reject flow',
      run: async () => {
        const cr = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: realWorkId, type: 'advance', amount: 10000, purpose: 'E2E_COVERAGE Reject test' }
        });
        if (!cr.ok) skip('Cannot create cash');
        const id = cr.data?.item?.id || cr.data?.id;
        if (!id) skip('No ID');
        S.cashRejectId = id;

        const rej = await api('POST', `/api/approval/cash_requests/${id}/reject`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'Отклонено — нецелевые расходы' }
        });
        if (rej.status === 404) skip('reject endpoint not available');
        assertOk(rej, 'Director rejects');
      }
    },
    {
      name: 'APPROVAL: BUH pending queue',
      run: async () => {
        const resp = await api('GET', '/api/approval/pending-buh', { role: 'BUH' });
        if (resp.status === 404) skip('pending-buh not available');
        assertOk(resp, 'BUH pending queue');
      }
    },
    {
      name: 'APPROVAL: Cash balance check',
      run: async () => {
        const resp = await api('GET', '/api/approval/cash-balance', { role: 'ADMIN' });
        if (resp.status === 404) skip('cash-balance not available');
        assertOk(resp, 'Cash balance check');
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 2: PERMISSIONS (RBAC)
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'PERMISSIONS: Get modules list',
      run: async () => {
        const resp = await api('GET', '/api/permissions/modules', { role: 'ADMIN' });
        if (resp.status === 404) skip('permissions endpoint not available');
        assertOk(resp, 'Get modules');
        const modules = resp.data?.modules || resp.data;
        assert(Array.isArray(modules), 'Modules must be array');
      }
    },
    {
      name: 'PERMISSIONS: Get role presets',
      run: async () => {
        const resp = await api('GET', '/api/permissions/presets', { role: 'ADMIN' });
        if (resp.status === 404) skip('presets not available');
        assertOk(resp, 'Get presets');
      }
    },
    {
      name: 'PERMISSIONS: Get own permissions (PM)',
      run: async () => {
        const resp = await api('GET', '/api/permissions/my', { role: 'PM' });
        if (resp.status === 404) skip('permissions/my not available');
        assertOk(resp, 'PM own permissions');
      }
    },
    {
      name: 'PERMISSIONS: Get own permissions (ADMIN = full access)',
      run: async () => {
        const resp = await api('GET', '/api/permissions/my', { role: 'ADMIN' });
        if (resp.status === 404) skip('permissions/my not available');
        assertOk(resp, 'ADMIN own permissions');
      }
    },
    {
      name: 'PERMISSIONS: Get + Update menu settings',
      run: async () => {
        const get = await api('GET', '/api/permissions/menu', { role: 'PM' });
        if (get.status === 404) skip('menu not available');
        assertOk(get, 'Get menu');

        const put = await api('PUT', '/api/permissions/menu', {
          role: 'PM',
          body: { hidden_routes: ['stories'], route_order: ['dashboard', 'works', 'tenders'] }
        });
        assertOk(put, 'Update menu');

        // Restore
        await api('PUT', '/api/permissions/menu', {
          role: 'PM',
          body: { hidden_routes: [], route_order: [] }
        });
      }
    },
    {
      name: 'PERMISSIONS: HR cannot access user permissions',
      run: async () => {
        const resp = await api('GET', '/api/permissions/user/1', { role: 'HR' });
        if (resp.status === 404) skip('permissions not available');
        assert(resp.status === 403, `HR should get 403, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 3: MIMIR AI
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'MIMIR: Health check',
      run: async () => {
        const resp = await api('GET', '/api/mimir/health', { role: 'ADMIN' });
        if (resp.status === 404) skip('mimir not available');
        assertOk(resp, 'Mimir health');
      }
    },
    {
      name: 'MIMIR: Get stats',
      run: async () => {
        const resp = await api('GET', '/api/mimir/stats', { role: 'ADMIN' });
        if (resp.status === 404) skip('mimir stats not available');
        assertOk(resp, 'Mimir stats');
      }
    },
    {
      name: 'MIMIR: Create conversation',
      run: async () => {
        const resp = await api('POST', '/api/mimir/conversations', {
          role: 'PM',
          body: { title: 'E2E_COVERAGE тестовый диалог' }
        });
        if (resp.status === 404) skip('mimir conversations not available');
        assertOk(resp, 'Create conversation');
        S.mimirConvId = resp.data?.conversation?.id || resp.data?.id;
      }
    },
    {
      name: 'MIMIR: List conversations',
      run: async () => {
        const resp = await api('GET', '/api/mimir/conversations', { role: 'PM' });
        if (resp.status === 404) skip('mimir not available');
        assertOk(resp, 'List conversations');
      }
    },
    {
      name: 'MIMIR: Chat (non-streaming)',
      run: async () => {
        const resp = await api('POST', '/api/mimir/chat', {
          role: 'PM',
          body: {
            message: 'Сколько тендеров в системе?',
            conversation_id: S.mimirConvId || undefined
          }
        });
        if (resp.status === 404) skip('mimir chat not available');
        // AI may be unconfigured (503) — that's ok, we test the endpoint exists
        assert(resp.status !== 500, `Mimir chat should not 500, got ${resp.status}`);
      }
    },
    {
      name: 'MIMIR: Suggest form (customer)',
      run: async () => {
        const resp = await api('POST', '/api/mimir/suggest-form', {
          role: 'PM',
          body: { type: 'customer', context: { name: 'Газпром' } }
        });
        if (resp.status === 404) skip('suggest-form not available');
        assert(resp.status !== 500, `suggest-form should not 500, got ${resp.status}`);
      }
    },
    {
      name: 'MIMIR: Finance stats',
      run: async () => {
        const resp = await api('GET', '/api/mimir/finance-stats', { role: 'ADMIN' });
        if (resp.status === 404) skip('finance-stats not available');
        assertOk(resp, 'Finance stats');
      }
    },
    {
      name: 'MIMIR: Works analytics',
      run: async () => {
        const resp = await api('GET', '/api/mimir/works-analytics', { role: 'ADMIN' });
        if (resp.status === 404) skip('works-analytics not available');
        assertOk(resp, 'Works analytics');
      }
    },
    {
      name: 'MIMIR: Search',
      run: async () => {
        const resp = await api('GET', '/api/mimir/search?q=тендер', { role: 'PM' });
        if (resp.status === 404) skip('mimir search not available');
        assertOk(resp, 'Mimir search');
      }
    },
    {
      name: 'MIMIR: Cleanup conversation',
      run: async () => {
        if (!S.mimirConvId) return;
        await api('DELETE', `/api/mimir/conversations/${S.mimirConvId}`, { role: 'PM' });
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 4: HINTS (умные подсказки)
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'HINTS: Get hints for dashboard (ADMIN)',
      run: async () => {
        const resp = await api('GET', '/api/hints?page=dashboard', { role: 'ADMIN' });
        if (resp.status === 404) skip('hints not available');
        assertOk(resp, 'Dashboard hints');
        const hints = resp.data?.hints;
        assert(Array.isArray(hints), 'Hints must be array');
      }
    },
    {
      name: 'HINTS: Get hints for tenders (TO)',
      run: async () => {
        const resp = await api('GET', '/api/hints?page=tenders', { role: 'TO' });
        if (resp.status === 404) skip('hints not available');
        assertOk(resp, 'Tenders hints');
      }
    },
    {
      name: 'HINTS: Get hints for works (PM)',
      run: async () => {
        const resp = await api('GET', '/api/hints?page=pm-works', { role: 'PM' });
        if (resp.status === 404) skip('hints not available');
        assertOk(resp, 'PM works hints');
      }
    },
    {
      name: 'HINTS: Get hints for personnel (HR)',
      run: async () => {
        const resp = await api('GET', '/api/hints?page=personnel', { role: 'HR' });
        if (resp.status === 404) skip('hints not available');
        assertOk(resp, 'HR personnel hints');
      }
    },
    {
      name: 'HINTS: Get hints for warehouse (WAREHOUSE)',
      run: async () => {
        const resp = await api('GET', '/api/hints?page=warehouse', { role: 'WAREHOUSE' });
        if (resp.status === 404) skip('hints not available');
        assertOk(resp, 'Warehouse hints');
      }
    },
    {
      name: 'HINTS: Analysis endpoint',
      run: async () => {
        const resp = await api('GET', '/api/hints/analysis?page=dashboard', { role: 'ADMIN' });
        if (resp.status === 404) skip('hints analysis not available');
        // May return 503 if AI not configured — acceptable
        assert(resp.status !== 500, `Hints analysis should not 500, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 5: EMAIL (отправка)
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'EMAIL: Send test email to CRM mailbox',
      run: async () => {
        const resp = await api('POST', '/api/email/send', {
          role: 'ADMIN',
          body: {
            to: 'crm@asgard-service.com',
            subject: 'E2E_COVERAGE Test ' + new Date().toISOString().slice(0, 19),
            body: 'Тестовое письмо из E2E тестов.\nЕсли вы его видите — отправка работает.'
          }
        });
        if (resp.status === 404) skip('email send not available');
        assertOk(resp, 'Send email');
        S.emailMessageId = resp.data?.messageId;
      }
    },
    {
      name: 'EMAIL: Get send history',
      run: async () => {
        const resp = await api('GET', '/api/email/history?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('email history not available');
        assertOk(resp, 'Email history');
      }
    },
    {
      name: 'EMAIL: Non-admin cannot change settings',
      run: async () => {
        const resp = await api('POST', '/api/email/settings', {
          role: 'PM',
          body: { host: 'evil.com', port: 25 }
        });
        if (resp.status === 404) skip('email settings not available');
        assert(resp.status === 403, `PM should get 403 on email settings, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 6: MAILBOX (IMAP + full email management)
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'MAILBOX: List emails',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('mailbox not available');
        assertOk(resp, 'List emails');
        S.hasMailbox = true;
        const emails = resp.data?.emails || [];
        if (emails.length > 0) S.mailboxEmailId = emails[0].id;
      }
    },
    {
      name: 'MAILBOX: Get email detail',
      run: async () => {
        if (!S.hasMailbox) skip('mailbox not available');
        if (!S.mailboxEmailId) skip('No emails in mailbox');
        const resp = await api('GET', `/api/mailbox/emails/${S.mailboxEmailId}`, { role: 'ADMIN' });
        assertOk(resp, 'Email detail');
        assert(resp.data?.email, 'Email object returned');
      }
    },
    {
      name: 'MAILBOX: Get stats',
      run: async () => {
        if (!S.hasMailbox) skip('mailbox not available');
        const resp = await api('GET', '/api/mailbox/stats', { role: 'ADMIN' });
        assertOk(resp, 'Mailbox stats');
      }
    },
    {
      name: 'MAILBOX: List accounts',
      run: async () => {
        if (!S.hasMailbox) skip('mailbox not available');
        const resp = await api('GET', '/api/mailbox/accounts', { role: 'ADMIN' });
        assertOk(resp, 'List accounts');
        const accs = resp.data?.accounts || resp.data || [];
        if (Array.isArray(accs) && accs.length > 0) S.mailAccountId = accs[0].id;
      }
    },
    {
      name: 'MAILBOX: List templates',
      run: async () => {
        if (!S.hasMailbox) skip('mailbox not available');
        const resp = await api('GET', '/api/mailbox/templates', { role: 'ADMIN' });
        assertOk(resp, 'List templates');
      }
    },
    {
      name: 'MAILBOX: Create and delete template',
      run: async () => {
        if (!S.hasMailbox) skip('mailbox not available');
        const cr = await api('POST', '/api/mailbox/templates', {
          role: 'ADMIN',
          body: {
            name: 'E2E_COVERAGE Test Template',
            subject: 'Тестовый шаблон {{company}}',
            body: 'Уважаемый {{name}}, это тестовый шаблон.',
            category: 'test'
          }
        });
        assertOk(cr, 'Create template');
        const tplId = cr.data?.template?.id || cr.data?.id;
        if (tplId) {
          await api('DELETE', `/api/mailbox/templates/${tplId}`, { role: 'ADMIN' });
        }
      }
    },
    {
      name: 'MAILBOX: Classification rules',
      run: async () => {
        if (!S.hasMailbox) skip('mailbox not available');
        const resp = await api('GET', '/api/mailbox/classification-rules', { role: 'ADMIN' });
        assertOk(resp, 'Classification rules');
      }
    },
    {
      name: 'MAILBOX: Next outgoing number',
      run: async () => {
        if (!S.hasMailbox) skip('mailbox not available');
        const resp = await api('GET', '/api/mailbox/next-outgoing-number', { role: 'ADMIN' });
        assertOk(resp, 'Next outgoing number');
      }
    },
    {
      name: 'MAILBOX: HR cannot access mailbox',
      run: async () => {
        if (!S.hasMailbox) skip('mailbox not available');
        const resp = await api('GET', '/api/mailbox/emails', { role: 'HR' });
        assert(resp.status === 403, `HR should get 403 on mailbox, got ${resp.status}`);
      }
    },
    {
      name: 'MAILBOX: Send email via mailbox (loopback test)',
      run: async () => {
        if (!S.hasMailbox) skip('mailbox not available');
        const resp = await api('POST', '/api/mailbox/send', {
          role: 'ADMIN',
          body: {
            to: 'crm@asgard-service.com',
            subject: 'E2E_COVERAGE Mailbox Loopback ' + Date.now(),
            body: '<p>Тестовое письмо через mailbox API.</p>',
            account_id: S.mailAccountId || undefined
          }
        });
        if (resp.status === 404) skip('mailbox send not available');
        assertOk(resp, 'Mailbox send loopback');
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 7: TRAVEL (командировки)
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'TRAVEL: PM creates business trip (all fields)',
      run: async () => {
        const resp = await api('POST', '/api/travel', {
          role: 'PM',
          body: {
            destination: 'Ноябрьск, ХМАО',
            purpose: 'E2E_COVERAGE Монтаж оборудования на объекте',
            start_date: '2026-04-01',
            end_date: '2026-04-15',
            transport: 'Самолёт + служебный транспорт',
            budget: 150000
          }
        });
        if (resp.status === 404) skip('travel endpoint not available');
        assertOk(resp, 'PM creates trip');
        S.travelId = resp.data?.id;
      }
    },
    {
      name: 'TRAVEL: List trips',
      run: async () => {
        const resp = await api('GET', '/api/travel?limit=5', { role: 'PM' });
        if (resp.status === 404) skip('travel not available');
        assertOk(resp, 'List trips');
        const trips = resp.data?.data || resp.data || [];
        assert(Array.isArray(trips), 'Trips must be array');
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 8: WORKER PROFILES (анкета-характеристика)
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'WORKER_PROFILES: List all profiles',
      run: async () => {
        const resp = await api('GET', '/api/worker-profiles', { role: 'ADMIN' });
        if (resp.status === 404) skip('worker-profiles not available');
        assertOk(resp, 'List profiles');
      }
    },
    {
      name: 'WORKER_PROFILES: Upsert profile (all fields)',
      run: async () => {
        // Get a user ID first
        const me = await api('GET', '/api/auth/me', { role: 'PM' });
        if (!me.ok) skip('Cannot get user info');
        const userId = me.data?.user?.id;
        if (!userId) skip('No user ID');

        const resp = await api('PUT', `/api/worker-profiles/${userId}`, {
          role: 'PM',
          body: {
            data: {
              education: 'Высшее техническое',
              experience_years: 10,
              specialization: 'Монтаж инженерных систем',
              certifications: ['НАКС', 'СРО'],
              languages: ['Русский', 'Английский (B1)'],
              skills: 'Сварка, монтаж, пусконаладка',
              about: 'E2E_COVERAGE Опытный специалист'
            },
            filled_count: 7,
            total_count: 10,
            overall_score: 85,
            photo_url: null
          }
        });
        if (resp.status === 404) skip('worker-profiles not available');
        assertOk(resp, 'Upsert profile');
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 9: EMPLOYEE COLLECTIONS
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'COLLECTIONS: HR creates collection',
      run: async () => {
        const resp = await api('POST', '/api/employee-collections', {
          role: 'HR',
          body: {
            name: 'E2E_COVERAGE Монтажная бригада',
            description: 'Бригада для тестового объекта'
          }
        });
        if (resp.status === 404) skip('collections not available');
        assertOk(resp, 'Create collection');
        S.collectionId = resp.data?.collection?.id;
      }
    },
    {
      name: 'COLLECTIONS: List collections',
      run: async () => {
        const resp = await api('GET', '/api/employee-collections', { role: 'HR' });
        if (resp.status === 404) skip('collections not available');
        assertOk(resp, 'List collections');
      }
    },
    {
      name: 'COLLECTIONS: Add employees to collection',
      run: async () => {
        if (!S.collectionId) skip('No collection');
        // Get some employees — create temp if needed
        const emps = await api('GET', '/api/data/employees?limit=2', { role: 'ADMIN' });
        let empList = emps.data?.data || emps.data?.items || [];
        if (empList.length < 1) {
          // Create temp employee
          const emp = await api('POST', '/api/data/employees', {
            role: 'ADMIN',
            body: { full_name: 'E2E_COVERAGE Тестовый Сотрудник', phone: '+70001112233', active: true }
          });
          if (emp.ok && emp.data?.id) {
            empList = [{ id: emp.data.id }];
            S.tempEmployeeId = emp.data.id;
          }
        }
        if (empList.length < 1) skip('No employees');
        const ids = empList.slice(0, 2).map(e => e.id);

        const resp = await api('POST', `/api/employee-collections/${S.collectionId}/employees`, {
          role: 'HR',
          body: { employee_ids: ids }
        });
        assertOk(resp, 'Add employees');
      }
    },
    {
      name: 'COLLECTIONS: Get collection detail',
      run: async () => {
        if (!S.collectionId) skip('No collection');
        const resp = await api('GET', `/api/employee-collections/${S.collectionId}`, { role: 'HR' });
        assertOk(resp, 'Collection detail');
        assert(resp.data?.collection, 'Collection object returned');
      }
    },
    {
      name: 'COLLECTIONS: Delete collection',
      run: async () => {
        if (!S.collectionId) skip('No collection');
        const resp = await api('DELETE', `/api/employee-collections/${S.collectionId}`, { role: 'HR' });
        assertOk(resp, 'Delete collection');
      }
    },
    {
      name: 'COLLECTIONS: PM cannot manage collections',
      run: async () => {
        const resp = await api('POST', '/api/employee-collections', {
          role: 'PM',
          body: { name: 'Unauthorized', description: 'test' }
        });
        if (resp.status === 404) skip('collections not available');
        assert(resp.status === 403, `PM should get 403, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 10: STORIES (лента новостей)
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'STORIES: Create story',
      run: async () => {
        const resp = await api('POST', '/api/stories', {
          role: 'ADMIN',
          body: {
            content: 'E2E_COVERAGE Тестовая публикация в ленте. Это автоматический тест.',
            image_url: null
          }
        });
        if (resp.status === 404) skip('stories not available');
        assertOk(resp, 'Create story');
        S.storyId = resp.data?.story?.id;
      }
    },
    {
      name: 'STORIES: List stories',
      run: async () => {
        const resp = await api('GET', '/api/stories', { role: 'PM' });
        if (resp.status === 404) skip('stories not available');
        assertOk(resp, 'List stories');
      }
    },
    {
      name: 'STORIES: Delete own story',
      run: async () => {
        if (!S.storyId) skip('No story');
        const resp = await api('DELETE', `/api/stories/${S.storyId}`, { role: 'ADMIN' });
        assertOk(resp, 'Delete story');
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 11: GEO (геокодирование)
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'GEO: Geocode city',
      run: async () => {
        const resp = await api('GET', '/api/geo/geocode?city=Москва', { role: 'ADMIN' });
        if (resp.status === 404) skip('geo not available');
        assertOk(resp, 'Geocode');
        assert(resp.data?.coords, 'Coords returned for Москва');
      }
    },
    {
      name: 'GEO: Calculate distance',
      run: async () => {
        const resp = await api('GET', '/api/geo/distance?from=Москва&to=Санкт-Петербург', { role: 'ADMIN' });
        if (resp.status === 404) skip('geo distance not available');
        assertOk(resp, 'Distance calc');
        assert(resp.data?.distance_direct_km > 500, 'Moscow-SPb should be >500km');
      }
    },
    {
      name: 'GEO: List cities',
      run: async () => {
        const resp = await api('GET', '/api/geo/cities', { role: 'ADMIN' });
        if (resp.status === 404) skip('geo cities not available');
        assertOk(resp, 'Cities list');
        assert(resp.data?.count > 50, `Expected 70+ cities, got ${resp.data?.count}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 12: PUSH (push-уведомления)
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'PUSH: Get VAPID key (no auth required)',
      run: async () => {
        const resp = await api('GET', '/api/push/vapid-key', { role: 'ADMIN' });
        if (resp.status === 404) skip('push not available');
        assertOk(resp, 'VAPID key');
        assert(resp.data?.publicKey, 'Public key returned');
      }
    },
    {
      name: 'PUSH: Get badge count',
      run: async () => {
        const resp = await api('GET', '/api/push/badge-count', { role: 'PM' });
        if (resp.status === 404) skip('push badge not available');
        assertOk(resp, 'Badge count');
        assert(resp.data?.count !== undefined, 'Count field present');
      }
    },
    {
      name: 'PUSH: Non-admin cannot send push',
      run: async () => {
        const resp = await api('POST', '/api/push/send', {
          role: 'PM',
          body: { title: 'test', body: 'test', role: 'ADMIN' }
        });
        if (resp.status === 404) skip('push send not available');
        assert(resp.status === 403, `PM should get 403 on push send, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 13: FILES (загрузка файлов)
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'FILES: List files',
      run: async () => {
        const resp = await api('GET', '/api/files?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('files not available');
        assertOk(resp, 'List files');
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 14: INTEGRATIONS (банк + платформы + ERP)
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'INTEGRATIONS: Bank batches list',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'ADMIN' });
        if (resp.status === 404) skip('bank integration not available');
        assertOk(resp, 'Bank batches');
      }
    },
    {
      name: 'INTEGRATIONS: Bank transactions',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/transactions?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('bank transactions not available');
        assertOk(resp, 'Bank transactions');
      }
    },
    {
      name: 'INTEGRATIONS: Bank stats',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/stats', { role: 'ADMIN' });
        if (resp.status === 404) skip('bank stats not available');
        assertOk(resp, 'Bank stats');
      }
    },
    {
      name: 'INTEGRATIONS: Bank rules',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/rules', { role: 'ADMIN' });
        if (resp.status === 404) skip('bank rules not available');
        assertOk(resp, 'Bank rules');
      }
    },
    {
      name: 'INTEGRATIONS: Platforms list',
      run: async () => {
        const resp = await api('GET', '/api/integrations/platforms', { role: 'ADMIN' });
        if (resp.status === 404) skip('platforms not available');
        assertOk(resp, 'Platforms list');
      }
    },
    {
      name: 'INTEGRATIONS: Platforms stats',
      run: async () => {
        const resp = await api('GET', '/api/integrations/platforms/stats', { role: 'ADMIN' });
        if (resp.status === 404) skip('platforms stats not available');
        assertOk(resp, 'Platforms stats');
      }
    },
    {
      name: 'INTEGRATIONS: ERP connections',
      run: async () => {
        const resp = await api('GET', '/api/integrations/erp/connections', { role: 'ADMIN' });
        if (resp.status === 404) skip('ERP not available');
        assertOk(resp, 'ERP connections');
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 15: INBOX APPLICATIONS AI
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'INBOX_AI: List applications',
      run: async () => {
        const resp = await api('GET', '/api/inbox-applications?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('inbox-applications not available');
        assertOk(resp, 'List applications');
        S.hasInboxAI = true;
      }
    },
    {
      name: 'INBOX_AI: Stats summary',
      run: async () => {
        if (!S.hasInboxAI) skip('inbox-applications not available');
        const resp = await api('GET', '/api/inbox-applications/stats/summary', { role: 'ADMIN' });
        assertOk(resp, 'Stats summary');
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 16: SSE (Server-Sent Events) — проверяем stats
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'SSE: Connection stats',
      run: async () => {
        const resp = await api('GET', '/api/sse/stats', { role: 'ADMIN' });
        if (resp.status === 404) skip('SSE not available');
        assertOk(resp, 'SSE stats');
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 17: HR_MANAGER role (untested role)
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'HR_MANAGER: Can access employee list',
      run: async () => {
        const resp = await api('GET', '/api/data/employees?limit=3', { role: 'HR_MANAGER' });
        if (resp.status === 404) skip('data API not available');
        assertOk(resp, 'HR_MANAGER reads employees');
      }
    },
    {
      name: 'HR_MANAGER: Can access collections',
      run: async () => {
        const resp = await api('GET', '/api/employee-collections', { role: 'HR_MANAGER' });
        if (resp.status === 404) skip('collections not available');
        assertOk(resp, 'HR_MANAGER reads collections');
      }
    },
    {
      name: 'HR_MANAGER: Can access permissions',
      run: async () => {
        const resp = await api('GET', '/api/permissions/my', { role: 'HR_MANAGER' });
        if (resp.status === 404) skip('permissions not available');
        assertOk(resp, 'HR_MANAGER own permissions');
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // СЕКЦИЯ 18: CLEANUP
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'CLEANUP: Remove test data',
      run: async () => {
        // Delete cash requests created for approval testing
        for (const id of [S.cashId, S.cashReworkId, S.cashQuestionId, S.cashRejectId]) {
          if (id) {
            // Reset status to allow deletion
            await api('PUT', `/api/data/cash_requests/${id}`, {
              role: 'ADMIN', body: { status: 'draft' }
            });
            await api('DELETE', `/api/data/cash_requests/${id}`, { role: 'ADMIN' });
          }
        }
        // Delete temp employee
        if (S.tempEmployeeId) {
          await api('DELETE', `/api/data/employees/${S.tempEmployeeId}`, { role: 'ADMIN' });
        }
        // Delete temp work
        if (S.tempWorkId) {
          await api('DELETE', `/api/data/works/${S.tempWorkId}`, { role: 'ADMIN' });
        }
        console.log('    [cleanup] E2E_COVERAGE test data cleaned');
      }
    }
  ]
};
