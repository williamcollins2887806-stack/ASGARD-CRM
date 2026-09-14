'use strict';

/**
 * Build nodemailer fields for iMIP calendar invites (Outlook / Yandex / Gmail).
 * No DB / mailer deps — safe for unit tests.
 *
 * @param {string} ics
 * @param {'REQUEST'|'CANCEL'|string} method
 */
function buildImipMailFields(ics, method) {
  const m = String(method || 'REQUEST').toUpperCase();
  const content = typeof ics === 'string' ? ics : String(ics || '');
  return {
    icalEvent: {
      filename: 'invite.ics',
      method: m,
      content
    },
    // Dual: inline via icalEvent + attachment for clients that ignore alternative part
    attachments: [{
      filename: 'invite.ics',
      content: Buffer.from(content, 'utf8'),
      contentType: `application/ics; charset=UTF-8; method=${m}`,
      contentDisposition: 'attachment'
    }],
    skipAttachmentMention: true
  };
}

module.exports = { buildImipMailFields };
