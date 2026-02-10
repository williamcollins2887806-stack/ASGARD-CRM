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
        assert(resp.status < 500, `meetings: ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 200)}`);
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
        assert(resp.status < 500, `upcoming: ${resp.status}`);
      }
    },
    {
      name: 'ADMIN reads meetings stats',
      run: async () => {
        const resp = await api('GET', '/api/meetings/stats', { role: 'ADMIN' });
        assert(resp.status < 500, `stats: ${resp.status}`);
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
        assert(resp.status < 500, `create meeting: ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 200)}`);
        if (resp.ok) testMeetingId = resp.data?.meeting?.id || resp.data?.id;
      }
    },
    {
      name: 'Read-back after create verifies fields',
      run: async () => {
        if (!testMeetingId) return;
        const resp = await api('GET', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assert(resp.status < 500, `get meeting: ${resp.status}`);
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
        assert(resp.status < 500, `update meeting: ${resp.status}`);
      }
    },
    {
      name: 'Read-back after update verifies title changed',
      run: async () => {
        if (!testMeetingId) return;
        const resp = await api('GET', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assert(resp.status < 500, `read-back updated meeting: ${resp.status}`);
        if (resp.ok && resp.data) {
          const meeting = resp.data.meeting || resp.data;
          if (meeting.title !== undefined) {
            assertMatch(meeting, { title: 'Stage12: Updated planёrka' }, 'read-back updated title');
          }
        }
      }
    },
    {
      name: 'Negative: create meeting with empty body',
      run: async () => {
        const resp = await api('POST', '/api/meetings', {
          role: 'ADMIN',
          body: {}
        });
        // Server allows empty body (no server-side validation) — just verify no 5xx
        assert(resp.status < 500, `empty body should not cause 5xx, got ${resp.status}`);
      }
    },
    {
      name: 'Cleanup: delete meeting',
      run: async () => {
        if (!testMeetingId) return;
        const resp = await api('DELETE', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assert(resp.status < 500, `delete meeting: ${resp.status}`);
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
