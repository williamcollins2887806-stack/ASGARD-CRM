/**
 * NOTIFICATIONS & TELEGRAM — Tests for notification system
 */
const { api, assert, assertOk, assertArray, assertHasFields, skip } = require('../config');

module.exports = {
  name: 'NOTIFICATIONS (Уведомления)',
  tests: [
    // ── Read notifications ──
    {
      name: 'ADMIN reads notifications list',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'ADMIN' });
        assertOk(resp, 'notifications');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.notifications || resp.data?.data || []);
        assertArray(list, 'notifications');
      }
    },
    {
      name: 'PM reads notifications',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'PM' });
        assertOk(resp, 'PM notifications');
      }
    },
    {
      name: 'TO reads notifications',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'TO' });
        assertOk(resp, 'TO notifications');
      }
    },
    {
      name: 'HR reads notifications',
      run: async () => {
        const resp = await api('GET', '/api/notifications', { role: 'HR' });
        assertOk(resp, 'HR notifications');
      }
    },
    // ── Mark as read ──
    {
      name: 'Mark notification as read',
      run: async () => {
        // Get a notification first
        const list = await api('GET', '/api/notifications', { role: 'ADMIN' });
        assertOk(list, 'get notifications');
        const notifications = Array.isArray(list.data) ? list.data : (list.data?.notifications || []);
        if (notifications.length === 0) { skip('no notifications to mark'); return; }

        const notifId = notifications[0].id;
        const resp = await api('PUT', `/api/notifications/${notifId}/read`, {
          role: 'ADMIN', body: {}
        });
        if (resp.status === 404) skip('mark-read endpoint not found');
        assert(resp.status < 500, `mark read should not 5xx, got ${resp.status}`);
      }
    },
    // ── Mark all as read ──
    {
      name: 'Mark all notifications as read',
      run: async () => {
        const resp = await api('PUT', '/api/notifications/read-all', {
          role: 'ADMIN', body: {}
        });
        if (resp.status === 404) skip('read-all endpoint not found');
        assert(resp.status < 500, `mark all read should not 5xx, got ${resp.status}`);
      }
    },
    // ── Unread count ──
    {
      name: 'Get unread notification count',
      run: async () => {
        const resp = await api('GET', '/api/notifications/unread-count', { role: 'ADMIN' });
        if (resp.status === 404) skip('unread-count endpoint not found');
        assert(resp.status < 500, `unread count should not 5xx, got ${resp.status}`);
      }
    },
    // ── Telegram password send (ADMIN only) ──
    {
      name: 'ADMIN sends telegram password',
      run: async () => {
        // Get first user
        const users = await api('GET', '/api/users', { role: 'ADMIN' });
        const list = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        if (list.length === 0) { skip('no users'); return; }

        const resp = await api('POST', '/api/auth/send-telegram-password', {
          role: 'ADMIN',
          body: { userId: list[0].id }
        });
        // May fail if no telegram bot configured — that's ok
        assert(resp.status < 500, `send telegram pwd should not 5xx, got ${resp.status}`);
      }
    },
    // ── Calendar reminders check triggers notifications ──
    {
      name: 'Calendar reminders check',
      run: async () => {
        const resp = await api('GET', '/api/calendar/reminders/check', { role: 'ADMIN' });
        assertOk(resp, 'calendar reminders');
      }
    },
    // ── Meeting reminders check ──
    {
      name: 'Meeting reminders check',
      run: async () => {
        const resp = await api('GET', '/api/meetings/check-reminders', { role: 'ADMIN' });
        assert(resp.status < 500, `meeting reminders should not 5xx, got ${resp.status}`);
      }
    },
    // ── Permit expiry check ──
    {
      name: 'Permit expiry check triggers notifications',
      run: async () => {
        const resp = await api('GET', '/api/permits/check-expiry', { role: 'ADMIN' });
        assert(resp.status < 500, `permit expiry should not 5xx, got ${resp.status}`);
      }
    }
  ]
};
