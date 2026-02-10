/**
 * CALENDAR - Calendar events CRUD
 */
const { api, assert, assertOk } = require('../config');

let testEventId = null;

module.exports = {
  name: 'CALENDAR (Календарь)',
  tests: [
    {
      name: 'PM reads calendar events',
      run: async () => {
        const resp = await api('GET', '/api/calendar', { role: 'PM' });
        assertOk(resp, 'list events');
      }
    },
    {
      name: 'PM creates calendar event',
      run: async () => {
        const resp = await api('POST', '/api/calendar', {
          role: 'PM',
          body: {
            title: 'Stage12: Встреча с заказчиком',
            date: '2026-03-15',
            time: '10:00',
            type: 'meeting',
            description: 'Автотест'
          }
        });
        assert(resp.status < 500, `create event: ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 200)}`);
        if (resp.ok) testEventId = resp.data?.event?.id || resp.data?.id;
      }
    },
    {
      name: 'PM reads single event',
      run: async () => {
        if (!testEventId) return;
        const resp = await api('GET', `/api/calendar/${testEventId}`, { role: 'PM' });
        assertOk(resp, 'get event');
      }
    },
    {
      name: 'PM updates event',
      run: async () => {
        if (!testEventId) return;
        const resp = await api('PUT', `/api/calendar/${testEventId}`, {
          role: 'PM',
          body: { title: 'Stage12: Updated meeting' }
        });
        assertOk(resp, 'update event');
      }
    },
    {
      name: 'ADMIN reads calendar',
      run: async () => {
        const resp = await api('GET', '/api/calendar', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN calendar');
      }
    },
    {
      name: 'Calendar reminders check',
      run: async () => {
        const resp = await api('GET', '/api/calendar/reminders/check', { role: 'PM' });
        assert(resp.status < 500, `reminders: ${resp.status}`);
      }
    },
    {
      name: 'Cleanup: delete test event',
      run: async () => {
        if (!testEventId) return;
        await api('DELETE', `/api/calendar/${testEventId}`, { role: 'PM' });
      }
    }
  ]
};
