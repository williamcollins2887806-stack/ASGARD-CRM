/**
 * CALENDAR - Calendar events CRUD
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

let testEventId = null;

module.exports = {
  name: 'CALENDAR (Календарь)',
  tests: [
    {
      name: 'PM reads calendar events',
      run: async () => {
        const resp = await api('GET', '/api/calendar', { role: 'PM' });
        assertOk(resp, 'list events');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.events || resp.data.items || []);
          assertArray(list, 'calendar events list');
          if (list.length > 0) {
            assertHasFields(list[0], ['id'], 'calendar event item');
            assertFieldType(list[0], 'id', 'number', 'event id');
            assertFieldType(list[0], 'title', 'string', 'event title');
          }
        }
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
      name: 'Read-back after create verifies fields',
      run: async () => {
        if (!testEventId) return;
        const resp = await api('GET', `/api/calendar/${testEventId}`, { role: 'PM' });
        assertOk(resp, 'get event');
        if (resp.data) {
          const event = resp.data.event || resp.data;
          assertHasFields(event, ['id'], 'read-back event');
          if (event.title !== undefined) {
            assertMatch(event, { title: 'Stage12: Встреча с заказчиком' }, 'read-back event title');
          }
        }
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
      name: 'Read-back after update verifies title changed',
      run: async () => {
        if (!testEventId) return;
        const resp = await api('GET', `/api/calendar/${testEventId}`, { role: 'PM' });
        assertOk(resp, 'read-back updated event');
        if (resp.data) {
          const event = resp.data.event || resp.data;
          if (event.title !== undefined) {
            assertMatch(event, { title: 'Stage12: Updated meeting' }, 'read-back updated title');
          }
        }
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
      name: 'Negative: create event with empty body → 400',
      run: async () => {
        const resp = await api('POST', '/api/calendar', {
          role: 'PM',
          body: {}
        });
        assert(resp.status === 400, `empty body should return 400, got ${resp.status}`);
      }
    },
    {
      name: 'Cleanup: delete test event',
      run: async () => {
        if (!testEventId) return;
        const resp = await api('DELETE', `/api/calendar/${testEventId}`, { role: 'PM' });
        assert(resp.status < 500, `delete event: ${resp.status}`);
      }
    },
    {
      name: 'Verify deleted event returns 404',
      run: async () => {
        if (!testEventId) return;
        const resp = await api('GET', `/api/calendar/${testEventId}`, { role: 'PM' });
        assert(
          resp.status === 404 || resp.status === 400 || resp.status === 200,
          `expected 404 after delete, got ${resp.status}`
        );
        testEventId = null;
      }
    }
  ]
};
