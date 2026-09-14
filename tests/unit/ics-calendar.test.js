/**
 * Standalone ICS unit checks (no DB / server).
 */
const { buildMeetingIcs } = require('../../src/services/ics');

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
}

const ics = buildMeetingIcs({
  method: 'REQUEST',
  uid: 'meeting-42@asgard-crm.ru',
  sequence: 0,
  title: 'ВКС ТАБЕЛЬ',
  description: 'Line1\nLine2',
  location: 'https://meet.example/x',
  start: '2026-09-08T08:00:00.000Z',
  end: '2026-09-08T09:00:00.000Z',
  organizer: { name: 'Org', email: 'org@asgard-crm.ru' },
  attendees: [
    { email: 'a@asgard-crm.ru', name: 'Ivan', rsvp: 'pending' },
    { email: 'guest@ex.com', name: 'Guest' }
  ]
});

assert(ics.includes('BEGIN:VCALENDAR'), 'BEGIN');
assert(ics.includes('METHOD:REQUEST'), 'METHOD');
assert(ics.includes('UID:meeting-42@asgard-crm.ru'), 'UID');
assert(ics.includes('ATTENDEE'), 'ATTENDEE');
assert(ics.includes('guest@ex.com'), 'guest');
assert(ics.includes('DTSTART:20260908T080000Z'), 'DTSTART utc');

const cancel = buildMeetingIcs({
  method: 'CANCEL',
  uid: 'meeting-42@asgard-crm.ru',
  sequence: 3,
  title: 'ВКС ТАБЕЛЬ',
  start: new Date('2026-09-08T08:00:00Z'),
  end: new Date('2026-09-08T09:00:00Z'),
  organizer: { email: 'org@asgard-crm.ru' }
});
assert(cancel.includes('METHOD:CANCEL'), 'CANCEL');
assert(cancel.includes('STATUS:CANCELLED'), 'STATUS');
assert(cancel.includes('SEQUENCE:3'), 'SEQ');

console.log('ICS unit checks: PASS');
