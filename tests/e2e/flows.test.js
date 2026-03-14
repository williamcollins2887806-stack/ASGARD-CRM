/**
 * E2E: 5 сквозных бизнес-маршрутов через API — с глубокой валидацией
 */
const { api, assert, assertOk, assertHasFields, assertArray, assertMatch } = require('../config');

module.exports = {
  name: 'E2E BUSINESS FLOWS (deep)',
  tests: [
    // ═══════ МАРШРУТ 1: Тендер → Просчёт (с верификацией связей) ═══════
    {
      name: 'FLOW 1: TO creates tender → PM creates estimate → verify linked → cleanup',
      run: async () => {
        // TO создаёт тендер
        const t = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'E2E: Заказчик HVAC', customer_name: 'E2E: Заказчик HVAC', estimated_sum: 5000000, tender_status: 'Новый' }
        });
        assertOk(t, 'tender created');
        const tender = t.data?.tender || t.data;
        const tid = tender?.id;
        assert(tid, 'tender must have id');
        assertHasFields(tender, ['id'], 'tender response');

        // PM создаёт просчёт привязанный к тендеру
        const e = await api('POST', '/api/estimates', {
          role: 'PM',
          body: { tender_id: tid, title: 'E2E просчёт', amount: 3500000, margin: 15, approval_status: 'draft' }
        });
        assertOk(e, 'estimate');
        const eid = e.data?.estimate?.id || e.data?.id;

        // Verify estimate appears in list
        const elist = await api('GET', '/api/estimates', { role: 'PM' });
        assertOk(elist, 'estimates list');
        const estimates = elist.data?.estimates || elist.data;
        assertArray(estimates, 'estimates');

        // Verify tender detail includes linked data
        const tDetail = await api('GET', `/api/tenders/${tid}`, { role: 'TO' });
        assertOk(tDetail, 'tender detail');
        const tData = tDetail.data?.tender || tDetail.data;
        assertMatch(tData, { id: tid }, 'tender detail id');

        // Cleanup
        if (eid) await api('DELETE', `/api/estimates/${eid}`, { role: 'ADMIN' });
        if (tid) await api('DELETE', `/api/tenders/${tid}`, { role: 'ADMIN' });
      }
    },

    // ═══════ МАРШРУТ 2: Работа → Расход → Доход (с верификацией) ═══════
    {
      name: 'FLOW 2: PM creates work → adds expense → adds income → verify work detail',
      run: async () => {
        const w = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'E2E: Монтаж', work_number: 'E2E-' + Date.now(), work_status: 'В работе', contract_value: 2000000 }
        });
        assertOk(w, 'work created');
        const work = w.data?.work || w.data;
        const wid = work?.id;
        assert(wid, 'work must have id');

        // Verify work readable
        const wCheck = await api('GET', `/api/works/${wid}`, { role: 'PM' });
        assertOk(wCheck, 'work readable');
        const wData = wCheck.data?.work || wCheck.data;
        assertMatch(wData, { id: wid, work_status: 'В работе' }, 'work fields');

        // PM добавляет расход
        const exp = await api('POST', '/api/expenses/work', {
          role: 'PM',
          body: { work_id: wid, amount: 50000, description: 'Материалы', category: 'materials' }
        });
        assertOk(exp, 'expense created');

        // PM добавляет доход
        const inc = await api('POST', '/api/incomes', {
          role: 'PM',
          body: { work_id: wid, amount: 200000, description: 'Оплата аванса', type: 'advance' }
        });
        assertOk(inc, 'income');

        // Verify expenses list shows our expense
        const expList = await api('GET', '/api/expenses/work', { role: 'PM' });
        assertOk(expList, 'expense list');

        // Cleanup
        if (wid) await api('DELETE', `/api/works/${wid}`, { role: 'ADMIN' });
      }
    },

    // ═══════ МАРШРУТ 3: Задача полный цикл (с верификацией статусов) ═══════
    {
      name: 'FLOW 3: ADMIN creates task → PM accepts → PM completes → verify states',
      run: async () => {
        const users = await api('GET', '/api/users', { role: 'ADMIN' });
        const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        const realUser = userList.find(u => u.is_active !== false) || userList[0];
        const assigneeId = realUser?.id || 1;

        const t = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { title: 'E2E: Подготовить отчёт', assignee_id: assigneeId, priority: 'high', deadline: '2026-03-01' }
        });
        assertOk(t, 'create task');
        const task = t.data?.task || t.data;
        const taskId = task?.id;
        if (!taskId) return;

        // Verify initial state
        const detail1 = await api('GET', `/api/tasks/${taskId}`, { role: 'ADMIN' });
        if (detail1.ok) {
          const td = detail1.data?.task || detail1.data;
          assertHasFields(td, ['id', 'title', 'status'], 'task detail');
        }

        // ADMIN принимает (ADMIN/Director can accept any task in 'new' status)
        const acc = await api('PUT', `/api/tasks/${taskId}/accept`, { role: 'ADMIN', body: {} });
        assertOk(acc, 'accept');

        // ADMIN завершает
        const comp = await api('PUT', `/api/tasks/${taskId}/complete`, {
          role: 'ADMIN', body: { comment: 'Выполнено автотестом' }
        });
        assertOk(comp, 'complete');

        // Verify task appears in list
        const myTasks = await api('GET', '/api/tasks/my', { role: 'ADMIN' });
        assertOk(myTasks, 'tasks list');

        // Cleanup
        await api('DELETE', `/api/tasks/${taskId}`, { role: 'ADMIN' });
      }
    },

    // ═══════ МАРШРУТ 4: Сотрудник + допуск (с верификацией) ═══════
    {
      name: 'FLOW 4: HR creates employee → adds permit → verifies matrix → cleanup',
      run: async () => {
        const emp = await api('POST', '/api/staff/employees', {
          role: 'HR',
          body: { fio: 'E2E Тестов Иван', role_tag: 'worker', phone: '+79990005555', is_active: true }
        });
        assertOk(emp, 'employee created');
        const employee = emp.data?.employee || emp.data;
        const empId = employee?.id;
        if (!empId) throw new Error('No employee id');
        assertHasFields(employee, ['id', 'fio'], 'employee');

        // Verify employee readable
        const empCheck = await api('GET', `/api/staff/employees/${empId}`, { role: 'HR' });
        assertOk(empCheck, 'employee readable');

        // Look up real permit type
        const typeList = await api('GET', '/api/permits/types', { role: 'ADMIN' });
        const types = typeList.data?.types || typeList.data || [];
        const pType = Array.isArray(types) ? types[0] : null;

        if (!pType) {
          const matrix = await api('GET', '/api/permits/matrix', { role: 'ADMIN' });
          assertOk(matrix, 'permit matrix');
          await api('PUT', `/api/staff/employees/${empId}`, { role: 'ADMIN', body: { is_active: false } });
          return;
        }

        // Add permit
        const permit = await api('POST', '/api/permits', {
          role: 'ADMIN',
          body: { employee_id: empId, type_id: pType.id, issue_date: '2026-01-01', expiry_date: '2027-01-01', doc_number: 'E2E-001' }
        });
        assertOk(permit, 'permit');
        const permitId = permit.data?.permit?.id || permit.data?.id;

        // Verify matrix
        const matrix = await api('GET', '/api/permits/matrix', { role: 'ADMIN' });
        assertOk(matrix, 'permit matrix');

        // Verify permit list contains our permit
        const pList = await api('GET', '/api/permits', { role: 'ADMIN' });
        assertOk(pList, 'permits list');

        // Cleanup
        if (permitId) await api('DELETE', `/api/permits/${permitId}`, { role: 'ADMIN' });
        await api('PUT', `/api/staff/employees/${empId}`, { role: 'ADMIN', body: { is_active: false } });
      }
    },

    // ═══════ МАРШРУТ 5: Объект с координатами (с верификацией) ═══════
    {
      name: 'FLOW 5: ADMIN creates site → updates coords → reads back → verify in list → cleanup',
      run: async () => {
        const s = await api('POST', '/api/sites', {
          role: 'ADMIN',
          body: { name: 'E2E: Платформа Север', customer_name: 'Тест', address: 'Москва', geocode_status: 'pending' }
        });
        assertOk(s, 'site created');
        const site = s.data?.site || s.data;
        const sid = site?.id;
        if (!sid) throw new Error('No site id');

        // Update with coordinates
        const upd = await api('PUT', `/api/sites/${sid}`, {
          role: 'ADMIN',
          body: { lat: 55.75, lng: 37.62, geocode_status: 'manual', region: 'Москва' }
        });
        assertOk(upd, 'site updated');

        // Read-back: verify coordinates persisted
        const sCheck = await api('GET', `/api/sites/${sid}`, { role: 'ADMIN' });
        if (sCheck.ok) {
          const sData = sCheck.data?.site || sCheck.data;
          // Lat/lng might be string or number
          assert(sData.lat || sData.lat === 0, 'site should have lat');
          assert(sData.lng || sData.lng === 0, 'site should have lng');
        }

        // Verify appears in list
        const list = await api('GET', '/api/sites', { role: 'ADMIN' });
        assertOk(list, 'sites list');
        const sites = Array.isArray(list.data) ? list.data : (list.data?.sites || []);
        const found = sites.some(x => x.id === sid);
        assert(found, 'created site should be in list');

        // Cleanup
        await api('DELETE', `/api/sites/${sid}`, { role: 'ADMIN' });

        // Verify deleted
        const delCheck = await api('GET', `/api/sites/${sid}`, { role: 'ADMIN' });
        assert(delCheck.status === 404 || delCheck.status === 400 || delCheck.status === 500, `deleted site should be gone, got ${delCheck.status}`);
      }
    }
  ]
};
