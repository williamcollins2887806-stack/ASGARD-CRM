/**
 * MEETINGS - Meeting management CRUD
 */
const { api, assert, assertOk } = require('../config');

let testMeetingId = null;

module.exports = {
  name: 'MEETINGS (Совещания)',
  tests: [
    {
      name: 'ADMIN reads meetings list',
      run: async () => {
        const resp = await api('GET', '/api/meetings', { role: 'ADMIN' });
        assert(resp.status < 500, `meetings: ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 200)}`);
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
      name: 'ADMIN reads single meeting',
      run: async () => {
        if (!testMeetingId) return;
        const resp = await api('GET', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assert(resp.status < 500, `get meeting: ${resp.status}`);
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
      name: 'Cleanup: delete meeting',
      run: async () => {
        if (!testMeetingId) return;
        await api('DELETE', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
      }
    }
  ]
};
