/**
 * NOTIFICATIONS - Notification system
 */
const { api, assert, assertOk } = require('../config');

module.exports = {
  name: 'NOTIFICATIONS (Уведомления)',
  tests: [
    {
      name: 'ADMIN reads notifications',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'ADMIN' });
        assertOk(resp, 'notifications');
      }
    },
    {
      name: 'PM reads own notifications',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'PM' });
        assertOk(resp, 'PM notifications');
      }
    },
    {
      name: 'ADMIN creates notification',
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
      name: 'DIRECTOR_GEN reads notifications',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DIR notifications');
      }
    }
  ]
};
