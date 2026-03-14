/**
 * E2E FLOW: Staff Requests (Запрос персонала)
 *
 * Полный цикл: создание заявки → сообщения → обновление статуса →
 * видимость по ролям → замены → удаление.
 *
 * API: /api/data/staff_requests (универсальный Data API)
 *       /api/data/staff_request_messages
 *       /api/data/staff_replacements
 *
 * Формат ответов Data API:
 *   POST  → { success, item, id }
 *   PUT   → { success, item }
 *   GET /:id → { item }
 *   GET /    → { <table>: [...], total, limit, offset }
 *   DELETE   → { success }
 *
 * Доступ по ролевой матрице:
 *   staff_requests/messages/replacements: ADMIN, DIRECTOR_*, HR, HR_MANAGER
 *   PM, HEAD_PM, TO, BUH, OFFICE_MANAGER, WAREHOUSE, PROC, CHIEF_ENGINEER — нет доступа
 */
const { api, assert, assertOk, assertForbidden, assertArray, assertHasFields, TEST_USERS, initRealUsers } = require('../config');

let requestId = null;
let request2Id = null;
let messageId = null;
let message2Id = null;
let replacementId = null;

module.exports = {
  name: 'FLOW: Staff Requests (Запрос персонала)',
  tests: [
    // ═══════════════════════════════════════════════
    // 1. CRUD: Создание заявки на персонал
    // ═══════════════════════════════════════════════
    {
      name: '1. HR создаёт заявку на персонал',
      run: async () => {
        const resp = await api('POST', '/api/data/staff_requests', {
          role: 'HR',
          body: {
            pm_id: TEST_USERS['PM']?.id || 2324,
            status: 'new',
            required_count: 3,
            specialization: 'TEST_AUTO_Сварщик НАКС',
            date_from: '2026-04-01',
            date_to: '2026-06-30',
            comments: 'TEST_AUTO_Нужны сварщики с допуском НАКС для объекта'
          }
        });
        assertOk(resp, 'HR create staff_request');
        assert(resp.data?.success === true, 'success flag');
        requestId = resp.data?.id || resp.data?.item?.id;
        assert(requestId, 'got request ID');
      }
    },

    {
      name: '2. HR_MANAGER создаёт вторую заявку',
      run: async () => {
        const resp = await api('POST', '/api/data/staff_requests', {
          role: 'HR_MANAGER',
          body: {
            pm_id: TEST_USERS['HEAD_PM']?.id || 2322,
            status: 'new',
            required_count: 2,
            specialization: 'TEST_AUTO_Монтажник',
            date_from: '2026-05-01',
            date_to: '2026-07-31',
            comments: 'TEST_AUTO_Монтажники для подрядных работ'
          }
        });
        assertOk(resp, 'HR_MANAGER create staff_request');
        request2Id = resp.data?.id || resp.data?.item?.id;
        assert(request2Id, 'got request2 ID');
      }
    },

    // ═══════════════════════════════════════════════
    // 2. Чтение: список и одна запись
    // ═══════════════════════════════════════════════
    {
      name: '3. HR читает список заявок на персонал',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=100', { role: 'HR' });
        assertOk(resp, 'HR list staff_requests');
        const list = resp.data?.staff_requests;
        assertArray(list, 'staff_requests is array');
        const found = list.find(r => r.id === requestId);
        assert(found, 'HR request found in list');
        assert(found.specialization === 'TEST_AUTO_Сварщик НАКС', 'specialization matches');
      }
    },

    {
      name: '4. ADMIN читает одну заявку по ID',
      run: async () => {
        const resp = await api('GET', `/api/data/staff_requests/${requestId}`, { role: 'ADMIN' });
        assertOk(resp, 'ADMIN get by ID');
        const item = resp.data?.item;
        assert(item, 'item exists');
        assertHasFields(item, ['id', 'pm_id', 'status', 'required_count', 'specialization'], 'fields present');
        assert(item.id === requestId, 'id matches');
      }
    },

    {
      name: '5. HR_MANAGER читает заявки',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=50', { role: 'HR_MANAGER' });
        assertOk(resp, 'HR_MANAGER read');
        const list = resp.data?.staff_requests;
        assertArray(list, 'is array');
        const found = list.find(r => r.id === request2Id);
        assert(found, 'HR_MANAGER created request found');
      }
    },

    {
      name: '6. DIRECTOR_GEN читает все заявки',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=100', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DIRECTOR_GEN read');
        const list = resp.data?.staff_requests;
        assertArray(list, 'is array');
        const found1 = list.find(r => r.id === requestId);
        const found2 = list.find(r => r.id === request2Id);
        assert(found1, 'request1 visible to DIRECTOR_GEN');
        assert(found2, 'request2 visible to DIRECTOR_GEN');
      }
    },

    // ═══════════════════════════════════════════════
    // 3. Обновление: смена статуса (workflow)
    // ═══════════════════════════════════════════════
    {
      name: '7. HR обновляет статус заявки → sent',
      run: async () => {
        const resp = await api('PUT', `/api/data/staff_requests/${requestId}`, {
          role: 'HR',
          body: { status: 'sent' }
        });
        assertOk(resp, 'HR update status to sent');
        assert(resp.data?.item?.status === 'sent', 'status updated to sent');
      }
    },

    {
      name: '8. HR обновляет заявку → answered',
      run: async () => {
        const resp = await api('PUT', `/api/data/staff_requests/${requestId}`, {
          role: 'HR',
          body: {
            status: 'answered',
            comments: 'TEST_AUTO_Подобраны 3 кандидата'
          }
        });
        assertOk(resp, 'HR answer request');
        assert(resp.data?.item?.status === 'answered', 'status is answered');
      }
    },

    {
      name: '9. Проверяем статус = answered через GET',
      run: async () => {
        const resp = await api('GET', `/api/data/staff_requests/${requestId}`, { role: 'ADMIN' });
        assertOk(resp, 'get updated request');
        assert(resp.data?.item?.status === 'answered', `expected answered, got ${resp.data?.item?.status}`);
      }
    },

    {
      name: '10. ADMIN обновляет статус → approved',
      run: async () => {
        const resp = await api('PUT', `/api/data/staff_requests/${requestId}`, {
          role: 'ADMIN',
          body: { status: 'approved' }
        });
        assertOk(resp, 'ADMIN approve');
        assert(resp.data?.item?.status === 'approved', 'status is approved');
      }
    },

    {
      name: '11. HR обновляет вторую заявку → sent → rework',
      run: async () => {
        const resp1 = await api('PUT', `/api/data/staff_requests/${request2Id}`, {
          role: 'HR',
          body: { status: 'sent' }
        });
        assertOk(resp1, 'HR send request2');
        const resp2 = await api('PUT', `/api/data/staff_requests/${request2Id}`, {
          role: 'HR_MANAGER',
          body: { status: 'rework', comments: 'TEST_AUTO_Нужен монтажник с допуском на высоту' }
        });
        assertOk(resp2, 'HR_MANAGER rework');
        assert(resp2.data?.item?.status === 'rework', 'status is rework');
      }
    },

    {
      name: '12. Проверяем статусы обеих заявок',
      run: async () => {
        const r1 = await api('GET', `/api/data/staff_requests/${requestId}`, { role: 'ADMIN' });
        assertOk(r1, 'get request1');
        assert(r1.data?.item?.status === 'approved', `request1: expected approved, got ${r1.data?.item?.status}`);

        const r2 = await api('GET', `/api/data/staff_requests/${request2Id}`, { role: 'ADMIN' });
        assertOk(r2, 'get request2');
        assert(r2.data?.item?.status === 'rework', `request2: expected rework, got ${r2.data?.item?.status}`);
      }
    },

    // ═══════════════════════════════════════════════
    // 4. Сообщения (staff_request_messages)
    // ═══════════════════════════════════════════════
    {
      name: '13. HR добавляет сообщение к заявке',
      run: async () => {
        const resp = await api('POST', '/api/data/staff_request_messages', {
          role: 'HR',
          body: {
            staff_request_id: requestId,
            author_user_id: TEST_USERS['HR']?.id || 2326,
            message: 'TEST_AUTO_Кандидаты подобраны, ожидаем подтверждения'
          }
        });
        assertOk(resp, 'HR post message');
        messageId = resp.data?.id || resp.data?.item?.id;
        assert(messageId, 'got message ID');
      }
    },

    {
      name: '14. HR_MANAGER добавляет второе сообщение',
      run: async () => {
        const resp = await api('POST', '/api/data/staff_request_messages', {
          role: 'HR_MANAGER',
          body: {
            staff_request_id: requestId,
            author_user_id: TEST_USERS['HR_MANAGER']?.id || 2326,
            message: 'TEST_AUTO_Согласовано, жду договор'
          }
        });
        assertOk(resp, 'HR_MANAGER post message');
        message2Id = resp.data?.id || resp.data?.item?.id;
        assert(message2Id, 'got message2 ID');
      }
    },

    {
      name: '15. Читаем сообщения заявки (фильтр по staff_request_id)',
      run: async () => {
        const where = JSON.stringify({ staff_request_id: requestId });
        const resp = await api('GET', `/api/data/staff_request_messages?where=${encodeURIComponent(where)}`, { role: 'HR' });
        assertOk(resp, 'read messages');
        const msgs = resp.data?.staff_request_messages;
        assertArray(msgs, 'messages is array');
        assert(msgs.length >= 2, `expected >=2 messages, got ${msgs.length}`);
        const m1 = msgs.find(m => m.id === messageId);
        assert(m1, 'first message found');
        assert(String(m1.message || '').includes('TEST_AUTO_'), 'message content matches');
      }
    },

    // ═══════════════════════════════════════════════
    // 5. Замены (staff_replacements)
    // ═══════════════════════════════════════════════
    {
      name: '16. HR создаёт замену сотрудника',
      run: async () => {
        const resp = await api('POST', '/api/data/staff_replacements', {
          role: 'HR',
          body: {
            staff_request_id: requestId,
            old_employee_id: 1,
            new_employee_id: 2,
            reason: 'TEST_AUTO_Замена по болезни',
            status: 'sent'
          }
        });
        assertOk(resp, 'HR create replacement');
        replacementId = resp.data?.id || resp.data?.item?.id;
        assert(replacementId, 'got replacement ID');
      }
    },

    {
      name: '17. Читаем замены по заявке',
      run: async () => {
        const where = JSON.stringify({ staff_request_id: requestId });
        const resp = await api('GET', `/api/data/staff_replacements?where=${encodeURIComponent(where)}`, { role: 'HR' });
        assertOk(resp, 'read replacements');
        const list = resp.data?.staff_replacements;
        assertArray(list, 'replacements is array');
        assert(list.length >= 1, 'at least one replacement');
        const found = list.find(r => r.id === replacementId);
        assert(found, 'our replacement found');
        assert(String(found.reason || '').includes('TEST_AUTO_Замена по болезни'), 'reason matches');
      }
    },

    {
      name: '18. HR обновляет статус замены → approved',
      run: async () => {
        const resp = await api('PUT', `/api/data/staff_replacements/${replacementId}`, {
          role: 'HR',
          body: { status: 'approved', reason: 'TEST_AUTO_Согласовано РП' }
        });
        assertOk(resp, 'update replacement status');
        assert(resp.data?.item?.status === 'approved', `expected approved, got ${resp.data?.item?.status}`);
      }
    },

    // ═══════════════════════════════════════════════
    // 6. Ролевой доступ: кто имеет доступ
    // ═══════════════════════════════════════════════
    {
      name: '19. ADMIN имеет полный доступ к staff_requests',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN read');
        assertArray(resp.data?.staff_requests, 'is array');
      }
    },

    {
      name: '20. DIRECTOR_GEN имеет полный доступ',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DIRECTOR_GEN read');
        assertArray(resp.data?.staff_requests, 'is array');
      }
    },

    {
      name: '21. DIRECTOR_COMM имеет доступ',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests', { role: 'DIRECTOR_COMM' });
        assertOk(resp, 'DIRECTOR_COMM read');
      }
    },

    {
      name: '22. DIRECTOR_DEV имеет доступ',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests', { role: 'DIRECTOR_DEV' });
        assertOk(resp, 'DIRECTOR_DEV read');
      }
    },

    // ═══════════════════════════════════════════════
    // 7. Ролевой доступ: кто НЕ имеет доступа
    // ═══════════════════════════════════════════════
    {
      name: '23. PM имеет доступ к staff_requests',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests', { role: 'PM' });
        assertOk(resp, 'PM can access staff_requests');
      }
    },

    {
      name: '24. TO не имеет доступа к staff_requests',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests', { role: 'TO' });
        assertForbidden(resp, 'TO should be forbidden');
      }
    },

    {
      name: '25. BUH не имеет доступа к staff_requests',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests', { role: 'BUH' });
        assertForbidden(resp, 'BUH should be forbidden');
      }
    },

    {
      name: '26. OFFICE_MANAGER не имеет доступа к staff_requests',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests', { role: 'OFFICE_MANAGER' });
        assertForbidden(resp, 'OFFICE_MANAGER should be forbidden');
      }
    },

    {
      name: '27. WAREHOUSE не имеет доступа к staff_requests',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests', { role: 'WAREHOUSE' });
        assertForbidden(resp, 'WAREHOUSE should be forbidden');
      }
    },

    {
      name: '28. PROC не имеет доступа к staff_requests',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests', { role: 'PROC' });
        assertForbidden(resp, 'PROC should be forbidden');
      }
    },

    {
      name: '29. CHIEF_ENGINEER не имеет доступа к staff_requests',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests', { role: 'CHIEF_ENGINEER' });
        assertForbidden(resp, 'CHIEF_ENGINEER should be forbidden');
      }
    },

    {
      name: '30. HEAD_PM имеет доступ к staff_requests',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests', { role: 'HEAD_PM' });
        assertOk(resp, 'HEAD_PM can access staff_requests');
      }
    },

    {
      name: '31. HEAD_TO не имеет доступа к staff_requests',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests', { role: 'HEAD_TO' });
        assertForbidden(resp, 'HEAD_TO should be forbidden');
      }
    },

    // ═══════════════════════════════════════════════
    // 8. Запись от запрещённых ролей
    // ═══════════════════════════════════════════════
    {
      name: '32. PM может создать staff_request',
      run: async () => {
        const resp = await api('POST', '/api/data/staff_requests', {
          role: 'PM',
          body: { pm_id: 1, status: 'new', required_count: 1, specialization: 'test' }
        });
        assertOk(resp, 'PM can create staff_request');
      }
    },

    {
      name: '33. TO не может создать staff_request_messages (403)',
      run: async () => {
        const resp = await api('POST', '/api/data/staff_request_messages', {
          role: 'TO',
          body: { staff_request_id: requestId, author_user_id: 1, message: 'test' }
        });
        assertForbidden(resp, 'TO create message should be forbidden');
      }
    },

    {
      name: '34. BUH не может создать staff_replacements (403)',
      run: async () => {
        const resp = await api('POST', '/api/data/staff_replacements', {
          role: 'BUH',
          body: { staff_request_id: requestId, old_employee_id: 1, new_employee_id: 2 }
        });
        assertForbidden(resp, 'BUH create replacement should be forbidden');
      }
    },

    // ═══════════════════════════════════════════════
    // 9. Фильтрация
    // ═══════════════════════════════════════════════
    {
      name: '35. Фильтрация по статусу через where',
      run: async () => {
        const where = JSON.stringify({ status: 'approved' });
        const resp = await api('GET', `/api/data/staff_requests?where=${encodeURIComponent(where)}`, { role: 'ADMIN' });
        assertOk(resp, 'filter by status');
        const list = resp.data?.staff_requests;
        assertArray(list, 'is array');
        for (const item of list) {
          assert(item.status === 'approved', `all filtered items should be approved, got ${item.status}`);
        }
        const found = list.find(r => r.id === requestId);
        assert(found, 'our approved request found in filtered list');
      }
    },

    {
      name: '36. Фильтрация по pm_id',
      run: async () => {
        const pmId = TEST_USERS['PM']?.id || 2324;
        const where = JSON.stringify({ pm_id: pmId });
        const resp = await api('GET', `/api/data/staff_requests?where=${encodeURIComponent(where)}`, { role: 'ADMIN' });
        assertOk(resp, 'filter by pm_id');
        const list = resp.data?.staff_requests;
        assertArray(list, 'is array');
        const found = list.find(r => r.id === requestId);
        assert(found, 'request with PM filter found');
      }
    },

    // ═══════════════════════════════════════════════
    // 10. Лимит, offset, orderBy
    // ═══════════════════════════════════════════════
    {
      name: '37. Лимит и offset работают',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=1&offset=0', { role: 'ADMIN' });
        assertOk(resp, 'limit=1');
        const list = resp.data?.staff_requests;
        assertArray(list, 'is array');
        assert(list.length <= 1, `expected max 1 record, got ${list.length}`);
        assert(resp.data.total !== undefined, 'total field present');
        assert(Number(resp.data.total) >= 2, `total should be >=2, got ${resp.data.total}`);
      }
    },

    {
      name: '38. OrderBy работает',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?orderBy=created_at&desc=true&limit=10', { role: 'ADMIN' });
        assertOk(resp, 'orderBy');
        const list = resp.data?.staff_requests;
        assertArray(list, 'is array');
        if (list.length >= 2) {
          const d1 = new Date(list[0].created_at).getTime();
          const d2 = new Date(list[1].created_at).getTime();
          assert(d1 >= d2, 'ordered DESC by created_at');
        }
      }
    },

    // ═══════════════════════════════════════════════
    // 11. Edge cases
    // ═══════════════════════════════════════════════
    {
      name: '39. Несуществующая таблица → 400',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests_nonexistent', { role: 'ADMIN' });
        assert(resp.status === 400, `expected 400, got ${resp.status}`);
      }
    },

    {
      name: '40. GET несуществующий ID → 404',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests/999999', { role: 'ADMIN' });
        assert(resp.status === 404, `expected 404, got ${resp.status}`);
      }
    },

    {
      name: '41. limit=0 возвращает пустой массив',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=0', { role: 'ADMIN' });
        assertOk(resp, 'limit=0');
        const list = resp.data?.staff_requests;
        assertArray(list, 'is array');
        assert(list.length === 0, `expected 0 items, got ${list.length}`);
      }
    },

    // ═══════════════════════════════════════════════
    // 12. Cleanup (удаление тестовых данных)
    // ═══════════════════════════════════════════════
    {
      name: '42. ADMIN удаляет замену',
      run: async () => {
        if (!replacementId) return;
        const resp = await api('DELETE', `/api/data/staff_replacements/${replacementId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete replacement');
      }
    },

    {
      name: '43. ADMIN удаляет сообщения',
      run: async () => {
        if (messageId) {
          const resp = await api('DELETE', `/api/data/staff_request_messages/${messageId}`, { role: 'ADMIN' });
          assertOk(resp, 'delete message1');
        }
        if (message2Id) {
          const resp = await api('DELETE', `/api/data/staff_request_messages/${message2Id}`, { role: 'ADMIN' });
          assertOk(resp, 'delete message2');
        }
      }
    },

    {
      name: '44. ADMIN удаляет тестовые заявки',
      run: async () => {
        if (requestId) {
          const resp = await api('DELETE', `/api/data/staff_requests/${requestId}`, { role: 'ADMIN' });
          assertOk(resp, 'delete request 1');
        }
        if (request2Id) {
          const resp = await api('DELETE', `/api/data/staff_requests/${request2Id}`, { role: 'ADMIN' });
          assertOk(resp, 'delete request 2');
        }
      }
    },

    {
      name: '45. Проверяем что тестовые данные удалены',
      run: async () => {
        if (!requestId) return;
        const resp = await api('GET', `/api/data/staff_requests/${requestId}`, { role: 'ADMIN' });
        assert(resp.status === 404, 'deleted request returns 404');
      }
    },
  ]
};
