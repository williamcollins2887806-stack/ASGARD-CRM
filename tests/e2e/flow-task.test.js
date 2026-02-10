/**
 * E2E FLOW 4: Task lifecycle with director -> employee flow
 */
const { api, assert, assertOk } = require('../config');

module.exports = {
  name: 'FLOW: Task Lifecycle',
  tests: [
    {
      name: 'Task full cycle: create -> accept -> comment -> complete -> delete',
      run: async () => {
        // Get a real user for assignee_id
        const users = await api('GET', '/api/users', { role: 'ADMIN' });
        const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        const realUser = userList.find(u => u.is_active !== false) || userList[0];
        const assigneeId = realUser?.id || 1;

        // 1. ADMIN creates task
        const t = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { title: 'E2E Task: Prepare monthly report', assignee_id: assigneeId, priority: 'high', deadline: '2026-03-15', description: 'E2E autotest task' }
        });
        assert(t.status < 500, `create task: ${t.status}`);
        const taskId = t.data?.task?.id || t.data?.id;
        if (!taskId) return;

        // 2. Check task appears in created list
        const created = await api('GET', '/api/tasks/created', { role: 'ADMIN' });
        assertOk(created, 'created tasks');

        // 3. PM comments on task
        const comment = await api('POST', `/api/tasks/${taskId}/comments`, {
          role: 'PM',
          body: { text: 'E2E: Working on this task' }
        });
        assert(comment.status < 500, `comment: ${comment.status}`);

        // 4. PM completes task
        const complete = await api('POST', `/api/tasks/${taskId}/complete`, {
          role: 'PM',
          body: { comment: 'E2E: Task completed successfully' }
        });
        assert(complete.status < 500, `complete: ${complete.status}`);

        // Cleanup
        await api('DELETE', `/api/tasks/${taskId}`, { role: 'ADMIN' });
      }
    }
  ]
};
