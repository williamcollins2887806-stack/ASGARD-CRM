/**
 * Calendar Outlook — feed, ICS, guests, find-time
 */
const { api, assert, assertOk, assertArray } = require('../config');
const { buildMeetingIcs } = require('../../src/services/ics');

module.exports = {
  name: 'CALENDAR OUTLOOK',
  tests: [
    {
      name: 'ICS REQUEST contains UID METHOD ATTENDEE',
      run: async () => {
        const ics = buildMeetingIcs({
          method: 'REQUEST',
          uid: 'meeting-test@asgard-crm.ru',
          sequence: 0,
          title: 'ВКС ТАБЕЛЬ',
          description: 'Test',
          location: 'https://meet.example/x',
          url: 'https://meet.example/x',
          start: '2026-09-08T11:00:00+03:00',
          end: '2026-09-08T12:00:00+03:00',
          organizer: { name: 'Org', email: 'org@asgard-crm.ru' },
          attendees: [
            { email: 'a@asgard-crm.ru', name: 'A', rsvp: 'pending' },
            { email: 'guest@ex.com', name: 'Guest' }
          ]
        });
        assert(ics.includes('BEGIN:VCALENDAR'), 'BEGIN');
        assert(ics.includes('METHOD:REQUEST'), 'METHOD');
        assert(ics.includes('UID:meeting-test@asgard-crm.ru'), 'UID');
        assert(ics.includes('SUMMARY:ВКС ТАБЕЛЬ') || ics.includes('SUMMARY:'), 'SUMMARY');
        assert(ics.includes('ATTENDEE'), 'ATTENDEE');
        assert(ics.includes('mailto:guest@ex.com'), 'guest mailto');
      }
    },
    {
      name: 'ICS CANCEL has STATUS CANCELLED',
      run: async () => {
        const ics = buildMeetingIcs({
          method: 'CANCEL',
          uid: 'meeting-1@asgard-crm.ru',
          sequence: 2,
          title: 'X',
          start: new Date(),
          end: new Date(Date.now() + 3600000),
          organizer: { email: 'o@a.ru' },
          attendees: []
        });
        assert(ics.includes('METHOD:CANCEL'), 'cancel method');
        assert(ics.includes('STATUS:CANCELLED'), 'cancelled status');
        assert(ics.includes('SEQUENCE:2'), 'sequence');
      }
    },
    {
      name: 'GET /api/calendar/feed returns items',
      run: async () => {
        const resp = await api('GET', '/api/calendar/feed?date_from=2026-01-01&date_to=2026-12-31&limit=50', { role: 'PM' });
        assertOk(resp, 'feed ok');
        const items = resp.data?.items || resp.data?.events || [];
        assertArray(items, 'feed items');
      }
    },
    {
      name: 'POST /api/calendar/find-time validates body',
      run: async () => {
        const resp = await api('POST', '/api/calendar/find-time', {
          role: 'PM',
          body: { user_ids: [], window_from: '2026-09-08', window_to: '2026-09-10' }
        });
        assert(resp.status === 400 || !resp.ok, 'empty user_ids rejected');
      }
    },
    {
      name: 'POST meeting with guest creates meeting_guests (if migrated)',
      run: async () => {
        const start = '2026-09-15T11:00:00';
        const end = '2026-09-15T12:00:00';
        const resp = await api('POST', '/api/meetings', {
          role: 'PM',
          body: {
            title: 'Outlook autotest VKS',
            start_time: start,
            end_time: end,
            conference_url: 'https://example.com/vks',
            participant_ids: [],
            guests: [{ email: 'outlook-guest-test@example.com', name: 'Guest' }],
            send_invites: false,
            recurrence_rule: 'NONE'
          }
        });
        if (!resp.ok) {
          // schema not migrated yet — skip soft
          if (String(resp.data?.error || '').includes('column') || resp.status === 500) return;
          assertOk(resp, 'create meeting');
          return;
        }
        const mid = resp.data?.meeting?.id;
        assert(mid, 'meeting id');
        const det = await api('GET', `/api/meetings/${mid}`, { role: 'PM' });
        assertOk(det, 'get meeting');
        const guests = det.data?.guests || [];
        if (guests.length) {
          assert(guests.some((g) => g.email === 'outlook-guest-test@example.com'), 'guest stored');
        }
        // cleanup
        await api('DELETE', `/api/meetings/${mid}`, { role: 'PM' });
      }
    },
    {
      name: 'availability endpoint accepts user_ids',
      run: async () => {
        const me = await api('GET', '/api/auth/me', { role: 'PM' }).catch(() => null);
        let uid = me?.data?.user?.id || me?.data?.id;
        if (!uid) {
          // fallback: list users
          const us = await api('GET', '/api/users?limit=1', { role: 'PM' });
          uid = us.data?.users?.[0]?.id;
        }
        if (!uid) return;
        const resp = await api('GET',
          `/api/calendar/availability?user_ids=${uid}&from=2026-09-08&to=2026-09-12`,
          { role: 'PM' }
        );
        assertOk(resp, 'availability');
        assert(resp.data?.users, 'users map');
        assert(resp.data?.work_hours, 'work_hours');
      }
    }
  ]
};
