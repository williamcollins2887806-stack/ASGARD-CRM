/**
 * iMIP mail structure: nodemailer icalEvent + application/ics attachment.
 */
const nodemailer = require('nodemailer');
const { buildMeetingIcs } = require('../../src/services/ics');
const { buildImipMailFields } = require('../../src/services/imip-mail');

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
}

(async () => {
  const ics = buildMeetingIcs({
    method: 'REQUEST',
    uid: 'meeting-imip@asgard-crm.ru',
    sequence: 0,
    title: 'iMIP test',
    start: '2026-09-10T08:00:00.000Z',
    end: '2026-09-10T09:00:00.000Z',
    organizer: { name: 'Org', email: 'org@asgard-crm.ru' },
    attendees: [{ email: 'guest@example.com', name: 'Guest', rsvp: 'pending' }]
  });

  const fields = buildImipMailFields(ics, 'REQUEST');
  assert(fields.icalEvent.method === 'REQUEST', 'method');
  assert(String(fields.icalEvent.content).includes('METHOD:REQUEST'), 'ics method');
  assert(fields.attachments[0].contentType.includes('application/ics'), 'app/ics');
  assert(fields.attachments[0].contentType.includes('method=REQUEST'), 'ctype method');
  assert(fields.skipAttachmentMention === true, 'skip mention');

  const transport = nodemailer.createTransport({ jsonTransport: true });
  const info = await transport.sendMail({
    from: 'org@asgard-crm.ru',
    to: 'guest@example.com',
    subject: 'Invite',
    text: 'Please join',
    html: '<p>Please join</p>',
    icalEvent: fields.icalEvent,
    attachments: fields.attachments
  });

  const raw = typeof info.message === 'string' ? info.message : JSON.stringify(info.message);
  // jsonTransport returns structured message
  const msg = typeof info.message === 'string' ? JSON.parse(info.message) : info.message;
  assert(msg.icalEvent || (msg.attachments && msg.attachments.length), 'has calendar payload');
  const ical = msg.icalEvent || {};
  const methodOk =
    String(ical.method || '').toUpperCase() === 'REQUEST' ||
    String(raw).toUpperCase().includes('METHOD=REQUEST') ||
    String(raw).includes('METHOD:REQUEST');
  assert(methodOk, 'REQUEST in message');

  const cancelFields = buildImipMailFields(ics.replace('METHOD:REQUEST', 'METHOD:CANCEL'), 'CANCEL');
  assert(cancelFields.icalEvent.method === 'CANCEL', 'cancel method');

  console.log('iMIP unit checks: PASS');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
