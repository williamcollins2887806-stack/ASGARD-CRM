'use strict';

/**
 * ICS (iCalendar) builder for meeting invites / cancellations.
 * Outlook / Yandex / Gmail accept METHOD:REQUEST with text/calendar attachment.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Format Date as UTC iCal: 20260908T080000Z */
function formatUtc(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return (
    x.getUTCFullYear() +
    pad2(x.getUTCMonth() + 1) +
    pad2(x.getUTCDate()) +
    'T' +
    pad2(x.getUTCHours()) +
    pad2(x.getUTCMinutes()) +
    pad2(x.getUTCSeconds()) +
    'Z'
  );
}

function escapeText(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function foldLine(line) {
  // Avoid splitting mailto: addresses (breaks Outlook/Yandex parsers in practice)
  if (line.startsWith('ATTENDEE') || line.startsWith('ORGANIZER') || line.startsWith('URL:')) {
    return line;
  }
  // RFC 5545: lines SHOULD be folded at 75 octets
  if (line.length <= 75) return line;
  let out = '';
  let rest = line;
  while (rest.length > 75) {
    out += rest.slice(0, 75) + '\r\n ';
    rest = rest.slice(75);
  }
  return out + rest;
}

/**
 * @param {object} opts
 * @param {'REQUEST'|'CANCEL'} opts.method
 * @param {string} opts.uid
 * @param {number} [opts.sequence]
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {string} [opts.location]
 * @param {string} [opts.url]
 * @param {Date|string} opts.start
 * @param {Date|string} [opts.end]
 * @param {{name?:string,email:string}} opts.organizer
 * @param {Array<{name?:string,email:string,rsvp?:string}>} [opts.attendees]
 */
function buildMeetingIcs(opts) {
  const method = opts.method || 'REQUEST';
  const uid = opts.uid || `meeting-${Date.now()}@asgard-crm.ru`;
  const seq = Number(opts.sequence) || 0;
  const start = formatUtc(opts.start);
  let end = opts.end ? formatUtc(opts.end) : null;
  if (!end && start) {
    const s = new Date(opts.start);
    end = formatUtc(new Date(s.getTime() + 60 * 60 * 1000));
  }
  const now = formatUtc(new Date());
  const orgEmail = (opts.organizer && opts.organizer.email) || 'noreply@asgard-crm.ru';
  const orgName = (opts.organizer && opts.organizer.name) || 'ASGARD CRM';

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//ASGARD CRM//Calendar//RU',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeText(opts.title)}`,
    `SEQUENCE:${seq}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    `ORGANIZER;CN=${escapeText(orgName)}:mailto:${orgEmail}`
  ];

  if (opts.description) lines.push(`DESCRIPTION:${escapeText(opts.description)}`);
  if (opts.location) lines.push(`LOCATION:${escapeText(opts.location)}`);
  if (opts.url) lines.push(`URL:${opts.url}`);

  for (const a of opts.attendees || []) {
    if (!a || !a.email) continue;
    const partstat =
      a.rsvp === 'accepted' ? 'ACCEPTED' :
      a.rsvp === 'declined' ? 'DECLINED' :
      a.rsvp === 'tentative' ? 'TENTATIVE' : 'NEEDS-ACTION';
    const cn = a.name ? `;CN=${escapeText(a.name)}` : '';
    lines.push(
      `ATTENDEE${cn};ROLE=REQ-PARTICIPANT;PARTSTAT=${partstat};RSVP=TRUE:mailto:${a.email}`
    );
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

module.exports = {
  buildMeetingIcs,
  formatUtc,
  escapeText
};
