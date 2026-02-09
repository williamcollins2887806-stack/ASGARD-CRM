/**
 * E2E: 5 сквозных бизнес-маршрутов через API
 */
const { api, assert, assertOk } = require('../config');

module.exports = {
  name: 'E2E BUSINESS FLOWS',
  tests: [
    // ═══════ МАРШРУТ 1: Тендер → Просчёт ═══════
    {
      name: 'FLOW 1: TO creates tender → PM creates estimate → verify linked',
      run: async () => {
        // TO создаёт тендер
        const t = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'E2E: Заказчик HVAC', estimated_sum: 5000000, tender_status: 'Новый' }
        });
        assertOk(t, 'tender created');
        const tid = t.data.id;

        // PM создаёт просчёт привязанный к тендеру
        const e = await api('POST', '/api/estimates', {
          role: 'PM',
          body: { tender_id: tid, estimate_title: 'E2E просчёт', cost_total: 3500000, margin_percent: 15, pm_id: 9001 }
        });
        assertOk(e, 'estimate created');

        // Проверяем что просчёт виден
        const elist = await api('GET', `/api/estimates?tender_id=${tid}`, { role: 'PM' });
        assertOk(elist, 'estimates list');

        // Cleanup
        if (e.data?.id) await api('DELETE', `/api/estimates/${e.data.id}`, { role: 'ADMIN' });
        await api('DELETE', `/api/tenders/${tid}`, { role: 'ADMIN' });
      }
    },

    // ═══════ МАРШРУТ 2: Работа → Расход → Доход ═══════
    {
      name: 'FLOW 2: PM creates work → adds expense → adds income',
      run: async () => {
        const w = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'E2E: Монтаж', work_status: 'В работе', pm_id: 9001, contract_value: 2000000 }
        });
        assertOk(w, 'work created');
        const wid = w.data.id;

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
        assert(inc.status < 500, `income: ${inc.status}`);

        // Cleanup
        await api('DELETE', `/api/works/${wid}`, { role: 'ADMIN' });
      }
    },

    // ═══════ МАРШРУТ 3: Задача полный цикл ═══════
    {
      name: 'FLOW 3: ADMIN creates task → PM accepts → PM completes',
      run: async () => {
        const t = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { title: 'E2E: Подготовить отчёт', assignee_id: 9001, priority: 'high', due_date: '2026-03-01' }
        });
        assertOk(t, 'task created');
        const taskId = t.data?.id;
        if (!taskId) throw new Error('No task id returned');

        // PM принимает
        const acc = await api('PUT', `/api/tasks/${taskId}/accept`, { role: 'PM' });
        assert(acc.status < 500, `accept: ${acc.status}`);

        // PM завершает
        const comp = await api('PUT', `/api/tasks/${taskId}/complete`, {
          role: 'PM',
          body: { comment: 'Выполнено автотестом' }
        });
        assert(comp.status < 500, `complete: ${comp.status}`);

        // Cleanup
        await api('DELETE', `/api/tasks/${taskId}`, { role: 'ADMIN' });
      }
    },

    // ═══════ МАРШРУТ 4: Сотрудник + допуск ═══════
    {
      name: 'FLOW 4: HR creates employee → adds permit → checks matrix',
      run: async () => {
        const emp = await api('POST', '/api/staff/employees', {
          role: 'HR',
          body: { fio: 'E2E Тестов Иван', role_tag: 'worker', phone: '+79990005555', is_active: true }
        });
        assertOk(emp, 'employee created');
        const empId = emp.data?.id;
        if (!empId) throw new Error('No employee id');

        // Добавить допуск
        const permit = await api('POST', '/api/permits', {
          role: 'ADMIN',
          body: { employee_id: empId, type_id: 'safety_general', issue_date: '2026-01-01', expiry_date: '2027-01-01' }
        });
        assert(permit.status < 500, `permit: ${permit.status}`);

        // Проверить матрицу
        const matrix = await api('GET', '/api/permits/matrix', { role: 'ADMIN' });
        assertOk(matrix, 'permit matrix');

        // Cleanup
        if (permit.data?.id) await api('DELETE', `/api/permits/${permit.data.id}`, { role: 'ADMIN' });
        await api('PUT', `/api/staff/employees/${empId}`, { role: 'ADMIN', body: { is_active: false } });
      }
    },

    // ═══════ МАРШРУТ 5: Объект на карте ═══════
    {
      name: 'FLOW 5: ADMIN creates site → updates coords → reads back',
      run: async () => {
        const s = await api('POST', '/api/sites', {
          role: 'ADMIN',
          body: { name: 'E2E: Платформа Север', customer_name: 'Тест', address: 'Москва', geocode_status: 'pending' }
        });
        assertOk(s, 'site created');
        const sid = s.data?.id;
        if (!sid) throw new Error('No site id');

        // Ручная привязка координат
        const upd = await api('PUT', `/api/sites/${sid}`, {
          role: 'ADMIN',
          body: { lat: 55.75, lng: 37.62, geocode_status: 'manual', region: 'Москва' }
        });
        assertOk(upd, 'site updated');

        // Проверяем что виден в списке
        const list = await api('GET', '/api/sites', { role: 'ADMIN' });
        assertOk(list, 'sites list');
        const found = Array.isArray(list.data) && list.data.some(x => x.id === sid);
        assert(found, 'created site should be in list');

        // Cleanup
        await api('DELETE', `/api/sites/${sid}`, { role: 'ADMIN' });
      }
    }
  ]
};
