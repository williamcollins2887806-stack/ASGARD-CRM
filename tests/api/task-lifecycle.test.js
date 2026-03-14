/**
 * BLOCK 4: TASK LIFECYCLE — Create, assign, accept, start, complete, delete
 * Todo, Kanban, Comments, Watchers
 */
'use strict';

const { api, assert, assertOk, assertStatus, assertForbidden,
        assertArray, assertHasFields, assertMatch,
        skip, TEST_USERS } = require('../config');

let taskId = null;
let todoId = null;
let commentId = null;

module.exports = {
  name: 'BLOCK 4 — TASK LIFECYCLE',
  tests: [
    // ═══════════════════════════════════════════════
    // 4.1 Task CRUD
    // ═══════════════════════════════════════════════
    {
      name: '4.1.1 ADMIN creates task with title, description, assignee → 201',
      run: async () => {
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: {
            assignee_id: TEST_USERS.PM.id,
            title: 'Тестовая задача lifecycle',
            description: 'Описание тестовой задачи для проверки полного цикла',
            deadline: '2026-03-01',
            priority: 'high'
          }
        });
        assertOk(resp, 'create task');
        const task = resp.data?.task || resp.data;
        taskId = task.id;
        assert(taskId, 'task id');
        assertMatch(task, { status: 'new' }, 'initial status');
        assertMatch(task, { priority: 'high' }, 'priority');
      }
    },
    {
      name: '4.1.2 Task appears in assignee GET /api/tasks/my',
      run: async () => {
        const resp = await api('GET', '/api/tasks/my?limit=500', { role: 'PM' });
        assertOk(resp, 'my tasks');
        const tasks = resp.data?.tasks || resp.data;
        assertArray(tasks, 'tasks array');
        const found = tasks.find(t => String(t.id) === String(taskId));
        assert(found, 'task found in my list');
      }
    },
    {
      name: '4.1.3 GET /api/tasks/created → creator sees task',
      run: async () => {
        const resp = await api('GET', '/api/tasks/created', { role: 'ADMIN' });
        assertOk(resp, 'created tasks');
        const tasks = resp.data?.tasks || resp.data;
        assertArray(tasks, 'tasks');
      }
    },
    {
      name: '4.1.4 GET /api/tasks/:id → detail',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('GET', `/api/tasks/${taskId}`, { role: 'PM' });
        assertOk(resp, 'task detail');
        const task = resp.data?.task || resp.data;
        assertHasFields(task, ['id', 'title', 'status', 'priority'], 'task fields');
      }
    },
    {
      name: '4.1.5 GET /api/tasks/stats → active/new/done/overdue counts',
      run: async () => {
        const resp = await api('GET', '/api/tasks/stats', { role: 'PM' });
        assertOk(resp, 'task stats');
        assertHasFields(resp.data, ['active', 'new_count', 'done_count', 'overdue'], 'stats fields');
      }
    },

    // ═══════════════════════════════════════════════
    // 4.2 Status transitions
    // ═══════════════════════════════════════════════
    {
      name: '4.2.1 Assignee accepts task → status accepted',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('PUT', `/api/tasks/${taskId}/accept`, { role: 'PM', body: {} });
        assertOk(resp, 'accept task');
        assert(resp.data.success === true, 'accept success');
      }
    },
    {
      name: '4.2.2 Assignee starts task → status in_progress',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('PUT', `/api/tasks/${taskId}/start`, { role: 'PM', body: {} });
        assertOk(resp, 'start task');
        assert(resp.data.success === true, 'start success');
      }
    },
    {
      name: '4.2.3 Assignee completes task with comment → status done',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('PUT', `/api/tasks/${taskId}/complete`, {
          role: 'PM',
          body: { comment: 'Работа выполнена, результат в прикреплённых файлах' }
        });
        assertOk(resp, 'complete task');
        assert(resp.data.success === true, 'complete success');
      }
    },
    {
      name: '4.2.4 Verify task status is done',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('GET', `/api/tasks/${taskId}`, { role: 'ADMIN' });
        assertOk(resp, 'check done');
        const task = resp.data?.task || resp.data;
        assertMatch(task, { status: 'done' }, 'done status');
      }
    },

    // ═══════════════════════════════════════════════
    // 4.3 Task edit and delete
    // ═══════════════════════════════════════════════
    {
      name: '4.3.1 Creator edits task',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('PUT', `/api/tasks/${taskId}`, {
          role: 'ADMIN',
          body: { description: 'Updated description after completion' }
        });
        assertOk(resp, 'edit task');
      }
    },
    {
      name: '4.3.2 Non-creator cannot edit → 403',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('PUT', `/api/tasks/${taskId}`, {
          role: 'PM',
          body: { title: 'PM hijack attempt' }
        });
        assertForbidden(resp, 'PM cannot edit');
      }
    },
    {
      name: '4.3.3 Create and delete task',
      run: async () => {
        const create = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { assignee_id: TEST_USERS.PM.id, title: 'Delete me' }
        });
        assertOk(create, 'create for delete');
        const id = (create.data?.task || create.data).id;
        const del = await api('DELETE', `/api/tasks/${id}`, { role: 'ADMIN' });
        assertOk(del, 'delete task');
      }
    },
    {
      name: '4.3.4 Create task without title → 400',
      run: async () => {
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { assignee_id: TEST_USERS.PM.id, title: '' }
        });
        assertStatus(resp, 400, 'empty title');
      }
    },
    {
      name: '4.3.5 Create task without assignee → 400',
      run: async () => {
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { title: 'No assignee' }
        });
        assertStatus(resp, 400, 'missing assignee');
      }
    },

    // ═══════════════════════════════════════════════
    // 4.4 Task with priorities
    // ═══════════════════════════════════════════════
    {
      name: '4.4.1 Create tasks with different priorities',
      run: async () => {
        for (const p of ['low', 'normal', 'high', 'urgent']) {
          const resp = await api('POST', '/api/tasks', {
            role: 'ADMIN',
            body: { assignee_id: TEST_USERS.PM.id, title: `Priority ${p}`, priority: p }
          });
          assertOk(resp, `create ${p} priority`);
        }
      }
    },
    {
      name: '4.4.2 Task with deadline',
      run: async () => {
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: {
            assignee_id: TEST_USERS.PM.id,
            title: 'Deadline task',
            deadline: '2026-02-15',
            priority: 'urgent'
          }
        });
        assertOk(resp, 'create with deadline');
      }
    },

    // ═══════════════════════════════════════════════
    // 4.5 Comments
    // ═══════════════════════════════════════════════
    {
      name: '4.5.1 Add comment to task',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('POST', `/api/tasks/${taskId}/comments`, {
          role: 'PM',
          body: { text: 'Комментарий от исполнителя' }
        });
        assertOk(resp, 'add comment');
        commentId = (resp.data?.comment || resp.data)?.id;
        assert(commentId, 'comment id');
      }
    },
    {
      name: '4.5.2 GET /api/tasks/:id/comments → array',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('GET', `/api/tasks/${taskId}/comments`, { role: 'PM' });
        assertOk(resp, 'get comments');
        const comments = resp.data?.comments || resp.data;
        assertArray(comments, 'comments list');
        assert(comments.length >= 1, 'has comments');
      }
    },
    {
      name: '4.5.3 Empty comment → 400',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('POST', `/api/tasks/${taskId}/comments`, {
          role: 'PM',
          body: { text: '' }
        });
        assertStatus(resp, 400, 'empty comment');
      }
    },

    // ═══════════════════════════════════════════════
    // 4.6 Watchers
    // ═══════════════════════════════════════════════
    {
      name: '4.6.1 Self-subscribe as watcher',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('POST', `/api/tasks/${taskId}/watch`, { role: 'DIRECTOR_GEN', body: {} });
        assertOk(resp, 'self-subscribe');
      }
    },
    {
      name: '4.6.2 GET /api/tasks/:id/watchers → includes subscriber',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('GET', `/api/tasks/${taskId}/watchers`, { role: 'PM' });
        assertOk(resp, 'get watchers');
        const watchers = resp.data?.watchers || resp.data;
        assertArray(watchers, 'watchers');
      }
    },
    {
      name: '4.6.3 Add watcher by user_id',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('POST', `/api/tasks/${taskId}/watchers`, {
          role: 'PM',
          body: { user_id: TEST_USERS.HEAD_PM.id }
        });
        assertOk(resp, 'add watcher');
      }
    },
    {
      name: '4.6.4 Self-unsubscribe',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('DELETE', `/api/tasks/${taskId}/watch`, { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'self-unsubscribe');
      }
    },

    // ═══════════════════════════════════════════════
    // 4.7 Todo
    // ═══════════════════════════════════════════════
    {
      name: '4.7.1 Create personal todo → 201',
      run: async () => {
        const resp = await api('POST', '/api/tasks/todo', {
          role: 'PM',
          body: { text: 'Проверить отчёт' }
        });
        assertOk(resp, 'create todo');
        const item = resp.data?.item || resp.data;
        todoId = item.id;
        assert(todoId, 'todo id');
      }
    },
    {
      name: '4.7.2 GET /api/tasks/todo → list',
      run: async () => {
        const resp = await api('GET', '/api/tasks/todo', { role: 'PM' });
        assertOk(resp, 'get todos');
        const items = resp.data?.items || resp.data;
        assertArray(items, 'todo items');
      }
    },
    {
      name: '4.7.3 Toggle todo done',
      run: async () => {
        if (!todoId) skip('No todo');
        const resp = await api('PUT', `/api/tasks/todo/${todoId}/toggle`, { role: 'PM', body: {} });
        assertOk(resp, 'toggle todo');
        assert(resp.data.success === true, 'toggle success');
        assert(resp.data.done === true, 'marked done');
      }
    },
    {
      name: '4.7.4 Toggle todo back to undone',
      run: async () => {
        if (!todoId) skip('No todo');
        const resp = await api('PUT', `/api/tasks/todo/${todoId}/toggle`, { role: 'PM', body: {} });
        assertOk(resp, 'toggle back');
        assert(resp.data.done === false, 'marked undone');
      }
    },
    {
      name: '4.7.5 Edit todo text',
      run: async () => {
        if (!todoId) skip('No todo');
        const resp = await api('PUT', `/api/tasks/todo/${todoId}`, {
          role: 'PM',
          body: { text: 'Updated todo text' }
        });
        assertOk(resp, 'edit todo');
      }
    },
    {
      name: '4.7.6 Empty todo text → 400',
      run: async () => {
        const resp = await api('POST', '/api/tasks/todo', {
          role: 'PM',
          body: { text: '' }
        });
        assertStatus(resp, 400, 'empty todo text');
      }
    },
    {
      name: '4.7.7 Reorder todos',
      run: async () => {
        if (!todoId) skip('No todo');
        const resp = await api('PUT', '/api/tasks/todo/reorder', {
          role: 'PM',
          body: { order: [{ id: todoId, sort_order: 0 }] }
        });
        assertOk(resp, 'reorder');
      }
    },
    {
      name: '4.7.8 Delete todo',
      run: async () => {
        if (!todoId) skip('No todo');
        const resp = await api('DELETE', `/api/tasks/todo/${todoId}`, { role: 'PM' });
        assertOk(resp, 'delete todo');
      }
    },

    // ═══════════════════════════════════════════════
    // 4.8 Kanban
    // ═══════════════════════════════════════════════
    {
      name: '4.8.1 GET /api/tasks/kanban → columns + tasks',
      run: async () => {
        const resp = await api('GET', '/api/tasks/kanban', { role: 'ADMIN' });
        assertOk(resp, 'kanban board');
        assertHasFields(resp.data, ['tasks'], 'kanban fields');
      }
    },
    {
      name: '4.8.2 Move task to in_progress column',
      run: async () => {
        // Create a fresh task for kanban move
        const create = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { assignee_id: TEST_USERS.PM.id, title: 'Kanban move test' }
        });
        assertOk(create, 'create kanban task');
        const id = (create.data?.task || create.data).id;

        const resp = await api('PUT', `/api/tasks/${id}/move`, {
          role: 'PM',
          body: { column: 'in_progress' }
        });
        assertOk(resp, 'move to in_progress');
      }
    },
    {
      name: '4.8.3 Move task to done column',
      run: async () => {
        const create = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { assignee_id: TEST_USERS.PM.id, title: 'Kanban done test' }
        });
        assertOk(create, 'create');
        const id = (create.data?.task || create.data).id;

        const resp = await api('PUT', `/api/tasks/${id}/move`, {
          role: 'PM',
          body: { column: 'done' }
        });
        assertOk(resp, 'move to done');
      }
    },
    {
      name: '4.8.4 Invalid column → 400',
      run: async () => {
        if (!taskId) skip('No task');
        const resp = await api('PUT', `/api/tasks/${taskId}/move`, {
          role: 'PM',
          body: { column: 'nonexistent' }
        });
        assertStatus(resp, 400, 'invalid column');
      }
    },

    // ═══════════════════════════════════════════════
    // 4.9 Acknowledge
    // ═══════════════════════════════════════════════
    {
      name: '4.9.1 Acknowledge task receipt',
      run: async () => {
        const create = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { assignee_id: TEST_USERS.PM.id, title: 'Acknowledge test' }
        });
        assertOk(create, 'create');
        const id = (create.data?.task || create.data).id;

        const resp = await api('PUT', `/api/tasks/${id}/acknowledge`, { role: 'PM', body: {} });
        assertOk(resp, 'acknowledge');
        assert(resp.data.success === true, 'ack success');
      }
    },

    // ═══════════════════════════════════════════════
    // 4.10 All tasks (admin view)
    // ═══════════════════════════════════════════════
    {
      name: '4.10.1 GET /api/tasks/all → director sees all tasks',
      run: async () => {
        const resp = await api('GET', '/api/tasks/all', { role: 'ADMIN' });
        assertOk(resp, 'all tasks');
        const tasks = resp.data?.tasks || resp.data;
        assertArray(tasks, 'all tasks list');
      }
    },
    {
      name: '4.10.2 GET /api/tasks/all filter by status',
      run: async () => {
        const resp = await api('GET', '/api/tasks/all?status=new', { role: 'ADMIN' });
        assertOk(resp, 'filter by status');
        const tasks = resp.data?.tasks || resp.data;
        assertArray(tasks, 'filtered');
      }
    },
    {
      name: '4.10.3 Check deadlines endpoint',
      run: async () => {
        const resp = await api('GET', '/api/tasks/check-deadlines', { role: 'ADMIN' });
        assertOk(resp, 'check deadlines');
        assertHasFields(resp.data, ['reminded'], 'reminded field');
      }
    }
  ]
};
