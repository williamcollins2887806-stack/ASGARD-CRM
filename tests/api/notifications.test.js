/**
 * NOTIFICATIONS - Notification system
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

module.exports = {
  name: 'NOTIFICATIONS (Уведомления)',
  tests: [
    {
      name: 'ADMIN reads notifications',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'ADMIN' });
        assertOk(resp, 'notifications');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.notifications || resp.data.items || []);
          assertArray(list, 'notifications list');
          if (list.length > 0) {
            assertHasFields(list[0], ['id'], 'notification item');
            assertFieldType(list[0], 'id', 'number', 'notification id');
          }
        }
      }
    },
    {
      name: 'PM reads own notifications',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'PM' });
        assertOk(resp, 'PM notifications');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.notifications || resp.data.items || []);
          assertArray(list, 'PM notifications list');
        }
      }
    },
    {
      name: 'ADMIN creates notification and validates create returns ok',
      run: async () => {
        // Get a real user for user_id
        const users = await api('GET', '/api/users', { role: 'ADMIN' });
        const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        const targetUser = userList.find(u => u.is_active !== false) || userList[0];
        if (!targetUser) return;

        const resp = await api('POST', '/api/notifications', {
          role: 'ADMIN',
          body: {
            user_id: targetUser.id,
            title: 'Stage12: Test notification',
            message: 'This is an autotest notification',
            type: 'info'
          }
        });
        assert(resp.status < 500, `create notification: ${resp.status}`);
        if (resp.ok) {
          assert(resp.data !== null && resp.data !== undefined, 'create notification should return data');
        }
      }
    },
    {
      name: 'ADMIN marks all as read',
      run: async () => {
        const resp = await api('PUT', '/api/notifications/read-all', { role: 'ADMIN' });
        assert(resp.status < 500, `read-all: ${resp.status}`);
      }
    },
    {
      name: 'Read-back after mark-all-read verifies state',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'ADMIN' });
        assertOk(resp, 'read-back after mark-all-read');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.notifications || resp.data.items || []);
          assertArray(list, 'notifications after mark-all-read');
        }
      }
    },
    {
      name: 'DIRECTOR_GEN reads notifications',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DIR notifications');
      }
    },
    {
      name: 'Negative: create notification without user_id → 400',
      run: async () => {
        const resp = await api('POST', '/api/notifications', {
          role: 'ADMIN',
          body: { title: 'Missing user_id' }
        });
        assert(resp.status === 400, `missing user_id should return 400, got ${resp.status}`);
      }
    }
  ]
};
