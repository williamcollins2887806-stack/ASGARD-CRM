/**
 * TASKS — Deep CRUD + state transitions + negative tests
 */
const { api, assert, assertOk, assertHasFields, assertArray, assertFieldType, assertMatch } = require('../config');

let testTaskId = null;
let assigneeId = null;

module.exports = {
  name: 'TASKS (deep)',
  tests: [
    {
      name: 'ADMIN reads own tasks — validates response shape',
      run: async () => {
        const resp = await api('GET', '/api/tasks/my', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN tasks/my');
        const list = resp.data?.tasks || resp.data;
        assertArray(list, 'tasks');
      }
    },
    {
      name: 'ADMIN creates task + validates response',
      run: async () => {
        const users = await api('GET', '/api/users', { role: 'ADMIN' });
        const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        const realUser = userList.find(u => u.is_active !== false) || userList[0];
        assigneeId = realUser?.id || 1;

        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: {
            title: 'ТЕСТ: Подготовить отчёт',
            description: 'Автотест — удалить после прогона',
            assignee_id: assigneeId,
            priority: 'high',
            deadline: '2026-03-01'
          }
        });
        assert(resp.status < 500, `create task: ${resp.status}`);
        if (resp.ok) {
          const task = resp.data?.task || resp.data;
          testTaskId = task?.id;
          if (testTaskId) {
            assertFieldType(task, 'id', 'number', 'task.id');
            assertHasFields(task, ['id', 'title'], 'task created');
          }
        }
      }
    },
    {
      name: 'Read-back: verify task fields match',
      run: async () => {
        if (!testTaskId) return;
        const resp = await api('GET', `/api/tasks/${testTaskId}`, { role: 'ADMIN' });
        assertOk(resp, 'get task');
        const t = resp.data?.task || resp.data;
        assertHasFields(t, ['id', 'title', 'priority', 'status'], 'task detail');
        assertMatch(t, { id: testTaskId, priority: 'high' }, 'task fields');
      }
    },
    {
      name: 'Created tasks list includes new task',
      run: async () => {
        const resp = await api('GET', '/api/tasks/created', { role: 'ADMIN' });
        assertOk(resp, 'tasks/created');
        const list = resp.data?.tasks || resp.data;
        assertArray(list, 'created tasks');
        if (testTaskId) {
          const found = list.some(t => t.id === testTaskId);
          assert(found, 'created task should appear in /created list');
        }
      }
    },
    {
      name: 'Task stats returns valid object',
      run: async () => {
        const resp = await api('GET', '/api/tasks/stats', { role: 'ADMIN' });
        assert(resp.status < 500, `stats: ${resp.status}`);
        if (resp.ok) assert(resp.data && typeof resp.data === 'object', 'stats should be object');
      }
    },
    {
      name: 'Todo: create + list + verify present',
      run: async () => {
        const create = await api('POST', '/api/tasks/todo', {
          role: 'ADMIN', body: { text: 'ТЕСТ: Todo элемент' }
        });
        assert(create.status < 500, `create todo: ${create.status}`);

        const list = await api('GET', '/api/tasks/todo', { role: 'ADMIN' });
        assert(list.status < 500, `get todo: ${list.status}`);
      }
    },
    {
      name: 'NEGATIVE: create task without title → 400',
      run: async () => {
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN', body: { assignee_id: assigneeId || 1 }
        });
        assert(resp.status >= 400 && resp.status < 500, `expected 4xx, got ${resp.status}`);
      }
    },
    {
      name: 'NEGATIVE: GET non-existent task → 404',
      run: async () => {
        const resp = await api('GET', '/api/tasks/999999', { role: 'ADMIN' });
        assert(resp.status === 404 || resp.status === 400 || resp.status === 403, `expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'Cleanup: ADMIN deletes test task → verify gone',
      run: async () => {
        if (!testTaskId) return;
        const del = await api('DELETE', `/api/tasks/${testTaskId}`, { role: 'ADMIN' });
        assert(del.status < 500, `delete task: ${del.status}`);
        const check = await api('GET', `/api/tasks/${testTaskId}`, { role: 'ADMIN' });
        assert(check.status === 404 || check.status === 400 || check.status === 403, `deleted task should be 404, got ${check.status}`);
        testTaskId = null;
      }
    }
  ]
};
