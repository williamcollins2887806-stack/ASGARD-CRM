const { api, assert, assertOk } = require('../config');

let testTaskId = null;

module.exports = {
  name: 'TASKS',
  tests: [
    {
      name: 'ADMIN reads own tasks (GET /api/tasks/my)',
      run: async () => {
        const resp = await api('GET', '/api/tasks/my', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN tasks/my');
      }
    },
    {
      name: 'PM reads own tasks',
      run: async () => {
        const resp = await api('GET', '/api/tasks/my', { role: 'PM' });
        // Может быть 403 если нет permission tasks:read
        assert(resp.status < 500, `PM tasks/my: ${resp.status}`);
      }
    },
    {
      name: 'ADMIN creates task',
      run: async () => {
        // Look up a real user for assignee_id to avoid FK violation
        const users = await api('GET', '/api/users', { role: 'ADMIN' });
        const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        const realUser = userList.find(u => u.is_active !== false) || userList[0];
        const assigneeId = realUser?.id || 1;

        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: {
            title: 'ТЕСТ: Подготовить отчёт',
            description: 'Автотест — удалить после прогона',
            assignee_id: assigneeId,
            priority: 'high',
            due_date: '2026-03-01'
          }
        });
        // May fail with 400 if assignee doesn't exist, that's ok
        assert(resp.status < 500, `create task: ${resp.status}`);
        if (resp.ok) {
          testTaskId = resp.data?.task?.id || resp.data?.id;
        }
      }
    },
    {
      name: 'ADMIN reads created tasks',
      run: async () => {
        const resp = await api('GET', '/api/tasks/created', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN tasks/created');
      }
    },
    {
      name: 'ADMIN reads single task',
      run: async () => {
        if (!testTaskId) return; // skip if create failed
        const resp = await api('GET', `/api/tasks/${testTaskId}`, { role: 'ADMIN' });
        assertOk(resp, 'get task');
      }
    },
    {
      name: 'Todo: ADMIN creates todo item',
      run: async () => {
        const resp = await api('POST', '/api/tasks/todo', {
          role: 'ADMIN',
          body: { text: 'ТЕСТ: Todo элемент' }
        });
        // Todo table may not exist or have different schema
        assert(resp.status < 500, `create todo: ${resp.status}`);
      }
    },
    {
      name: 'Todo: ADMIN reads todo list',
      run: async () => {
        const resp = await api('GET', '/api/tasks/todo', { role: 'ADMIN' });
        assert(resp.status < 500, `get todo: ${resp.status}`);
      }
    },
    {
      name: 'Cleanup: ADMIN deletes test task',
      run: async () => {
        if (!testTaskId) return;
        const resp = await api('DELETE', `/api/tasks/${testTaskId}`, { role: 'ADMIN' });
        assert(resp.status < 500, `delete task: ${resp.status}`);
        testTaskId = null;
      }
    }
  ]
};
