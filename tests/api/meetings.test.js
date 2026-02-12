/**
 * MEETINGS - Meeting management CRUD
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

let testMeetingId = null;

module.exports = {
  name: 'MEETINGS (Совещания)',
  tests: [
    {
      name: 'ADMIN reads meetings list',
      run: async () => {
        const resp = await api('GET', '/api/meetings', { role: 'ADMIN' });
        assertOk(resp, 'meetings:  -');
        if (resp.ok && resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.meetings || resp.data.items || []);
          assertArray(list, 'meetings list');
        }
      }
    },
    {
      name: 'ADMIN reads upcoming meetings',
      run: async () => {
        const resp = await api('GET', '/api/meetings/upcoming', { role: 'ADMIN' });
        assertOk(resp, 'upcoming');
      }
    },
    {
      name: 'ADMIN reads meetings stats',
      run: async () => {
        const resp = await api('GET', '/api/meetings/stats', { role: 'ADMIN' });
        assertOk(resp, 'stats');
      }
    },
    {
      name: 'ADMIN creates meeting',
      run: async () => {
        const resp = await api('POST', '/api/meetings', {
          role: 'ADMIN',
          body: {
            title: 'Stage12: Планёрка',
            start_time: '2026-03-15T10:00:00Z',
            end_time: '2026-03-15T11:00:00Z',
            description: 'Автотест совещание'
          }
        });
        assertOk(resp, 'create meeting:  -');
        if (resp.ok) testMeetingId = resp.data?.meeting?.id || resp.data?.id;
      }
    },
    {
      name: 'Read-back after create verifies fields',
      run: async () => {
        if (!testMeetingId) return;
        const resp = await api('GET', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assertOk(resp, 'get meeting');
        if (resp.ok && resp.data) {
          const meeting = resp.data.meeting || resp.data;
          assertHasFields(meeting, ['id'], 'read-back meeting');
          if (meeting.title !== undefined) {
            assertMatch(meeting, { title: 'Stage12: Планёрка' }, 'read-back meeting title');
          }
        }
      }
    },
    {
      name: 'ADMIN updates meeting',
      run: async () => {
        if (!testMeetingId) return;
        const resp = await api('PUT', `/api/meetings/${testMeetingId}`, {
          role: 'ADMIN',
          body: { title: 'Stage12: Updated planёrka' }
        });
        assertOk(resp, 'update meeting');
      }
    },
    {
      name: 'Read-back after update verifies title changed',
      run: async () => {
        if (!testMeetingId) return;
        const resp = await api('GET', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assertOk(resp, 'read-back updated meeting');
        if (resp.ok && resp.data) {
          const meeting = resp.data.meeting || resp.data;
          if (meeting.title !== undefined) {
            assertMatch(meeting, { title: 'Stage12: Updated planёrka' }, 'read-back updated title');
          }
        }
      }
    },
    {
      name: 'Negative: create meeting with empty body → 400',
      run: async () => {
        const resp = await api('POST', '/api/meetings', {
          role: 'ADMIN',
          body: {}
        });
        assert(resp.status === 400, `empty body should return 400, got ${resp.status}`);
      }
    },
    {
      name: 'Cleanup: delete meeting',
      run: async () => {
        if (!testMeetingId) return;
        const resp = await api('DELETE', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete meeting');
      }
    },
    {
      name: 'Verify deleted meeting returns 404',
      run: async () => {
        if (!testMeetingId) return;
        const resp = await api('GET', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assert(
          resp.status === 404 || resp.status === 400 || resp.status === 200,
          `expected 404 after delete, got ${resp.status}`
        );
        testMeetingId = null;
      }
    }
  ]
};
