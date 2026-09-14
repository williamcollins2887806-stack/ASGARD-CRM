'use strict';

/**
 * Meeting invite emails via iMIP (text/calendar) + ICS fallback attachment.
 */

const crypto = require('crypto');
const { sendCrmEmail } = require('./crm-mailer');
const { buildMeetingIcs } = require('./ics');
const { buildImipMailFields } = require('./imip-mail');
const { createNotification } = require('./notify');

function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || process.env.APP_URL || 'https://asgard-crm.ru').replace(/\/$/, '');
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRu(dt) {
  try {
    return new Date(dt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  } catch {
    return String(dt || '');
  }
}

function formatInviteWhenParts(start, end) {
  const optsDate = { timeZone: 'Europe/Moscow', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const optsTime = { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' };
  try {
    const s = new Date(start);
    const e = end ? new Date(end) : null;
    const dateLine = s.toLocaleDateString('ru-RU', optsDate);
    const timeLine = e
      ? `${s.toLocaleTimeString('ru-RU', optsTime)} – ${e.toLocaleTimeString('ru-RU', optsTime)}`
      : s.toLocaleTimeString('ru-RU', optsTime);
    return { dateLine, timeLine, whenFull: `${dateLine}, ${timeLine}` };
  } catch {
    const when = formatRu(start);
    return { dateLine: when, timeLine: '', whenFull: when };
  }
}

/**
 * Postcard-style invite (email-safe tables + inline CSS).
 */
function inviteHtml({
  title,
  when,
  dateLine,
  timeLine,
  location,
  conferenceUrl,
  crmLink,
  guestLink,
  organizerName,
  cancelled,
  updated
}) {
  const brand = 'АСГАРД';
  const eyebrow = cancelled
    ? 'Встреча отменена'
    : updated
      ? 'Изменение встречи'
      : 'Приглашение на встречу';
  const accent = cancelled ? '#f87171' : '#d4a017';
  const accentSoft = cancelled ? '#3f1212' : '#2a220c';
  const ctaBg = cancelled ? '#7f1d1d' : '#c9a227';
  const ctaColor = cancelled ? '#ffffff' : '#1a1408';

  const row = (label, valueHtml) => `
    <tr>
      <td style="padding:0 0 14px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="width:110px;vertical-align:top;padding:2px 12px 0 0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9aa3b5;font-family:Segoe UI,Arial,sans-serif;">
              ${label}
            </td>
            <td style="vertical-align:top;font-size:15px;line-height:1.45;color:#eef2f8;font-family:Segoe UI,Arial,sans-serif;">
              ${valueHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  const whenBlock = `
    <div style="font-size:17px;font-weight:700;color:#ffffff;letter-spacing:.01em;">${escHtml(dateLine || when || '')}</div>
    ${timeLine ? `<div style="margin-top:4px;font-size:15px;color:#d4a017;">${escHtml(timeLine)}</div>` : ''}`;

  const vcsBtn = conferenceUrl
    ? `<a href="${escHtml(conferenceUrl)}" style="display:inline-block;margin:0 8px 10px 0;padding:12px 20px;background:${ctaBg};color:${ctaColor};text-decoration:none;border-radius:10px;font-weight:800;font-size:14px;font-family:Segoe UI,Arial,sans-serif;">Подключиться к ВКС</a>`
    : '';

  const rsvpBtn = (!cancelled && guestLink)
    ? `<a href="${escHtml(guestLink)}" style="display:inline-block;margin:0 8px 10px 0;padding:12px 20px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;font-family:Segoe UI,Arial,sans-serif;">Ответить</a>`
    : '';

  const crmBtn = crmLink
    ? `<a href="${escHtml(crmLink)}" style="display:inline-block;margin:0 8px 10px 0;padding:12px 20px;background:#182033;color:#e8eef8;text-decoration:none;border-radius:10px;font-weight:650;font-size:14px;border:1px solid #3a4660;font-family:Segoe UI,Arial,sans-serif;">Открыть в CRM</a>`
    : '';

  const statusBanner = cancelled
    ? `<tr><td style="padding:0 0 18px 0;"><div style="padding:12px 14px;border-radius:10px;background:#3f1212;border:1px solid #7f1d1d;color:#fecaca;font-size:14px;font-family:Segoe UI,Arial,sans-serif;">Эта встреча снята с календаря. Если она уже была у вас — подтвердите отмену в почтовом клиенте.</div></td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escHtml(title || 'Приглашение')}</title>
</head>
<body style="margin:0;padding:0;background:#0b0f17;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0b0f17;">
    <tr>
      <td align="center" style="padding:28px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:560px;width:100%;">
          <tr>
            <td style="padding:0 0 14px 0;text-align:center;font-family:Segoe UI,Arial,sans-serif;font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:#8b7355;">
              ${brand} · CRM
            </td>
          </tr>
          <tr>
            <td style="border-radius:18px;overflow:hidden;border:1px solid #2a3348;background-color:#121826;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td style="height:4px;line-height:4px;font-size:0;background-color:#c9a227;">&nbsp;</td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:28px 28px 8px 28px;">
                    <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:${accentSoft};border:1px solid ${accent};color:${accent};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-family:Segoe UI,Arial,sans-serif;">
                      ${escHtml(eyebrow)}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 28px 6px 28px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.25;font-weight:700;color:#f7f3e8;">
                    ${escHtml(title || 'Встреча')}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 28px 22px 28px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#9aa3b5;">
                    Вас приглашает <span style="color:#e8eef8;font-weight:650;">${escHtml(organizerName || 'организатор')}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 28px 8px 28px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background-color:#0e1420;border:1px solid #243049;border-radius:14px;">
                      <tr>
                        <td style="padding:18px 18px 4px 18px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                            ${statusBanner}
                            ${row('Когда', whenBlock)}
                            ${location ? row('Где', escHtml(location)) : ''}
                            ${conferenceUrl ? row('ВКС', `<a href="${escHtml(conferenceUrl)}" style="color:#93c5fd;text-decoration:none;word-break:break-all;">Открыть ссылку на звонок →</a>`) : ''}
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:22px 28px 8px 28px;">
                    ${vcsBtn}${rsvpBtn}${crmBtn}
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 28px 26px 28px;font-family:Segoe UI,Arial,sans-serif;font-size:12px;line-height:1.5;color:#6b7280;">
                    ${cancelled
                      ? 'Если почтовый клиент предложит отменить событие в календаре — подтвердите. Файл invite.ics во вложении — запасной вариант.'
                      : 'В Outlook, Яндекс.Почте и Gmail нажмите «Принять» прямо в письме — встреча появится в календаре. Файл invite.ics — запасной вариант.'}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 8px 0 8px;text-align:center;font-family:Segoe UI,Arial,sans-serif;font-size:11px;color:#5b6475;">
              ООО «Асгард-Сервис» · письмо сформировано автоматически
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Load meeting + participants + guests for ICS mail.
 */
async function loadMeetingInviteContext(db, meetingId) {
  const { rows: [meeting] } = await db.query('SELECT * FROM meetings WHERE id = $1', [meetingId]);
  if (!meeting) return null;

  const { rows: [organizer] } = await db.query(
    'SELECT id, name, email, login FROM users WHERE id = $1',
    [meeting.organizer_id]
  );

    // Need notified_at for onlyUnnotified filtering
  const { rows: participants } = await db.query(`
    SELECT mp.user_id, mp.rsvp_status, mp.notified_at, u.name, u.email, u.login
    FROM meeting_participants mp
    JOIN users u ON u.id = mp.user_id
    WHERE mp.meeting_id = $1
  `, [meetingId]);

  const { rows: guests } = await db.query(
    'SELECT * FROM meeting_guests WHERE meeting_id = $1',
    [meetingId]
  );

  return { meeting, organizer, participants, guests };
}

function buildIcsPayload(ctx, method) {
  const { meeting, organizer, participants, guests } = ctx;
  const attendees = [];
  for (const p of participants) {
    if (p.email) {
      attendees.push({ email: p.email, name: p.name || p.login, rsvp: p.rsvp_status });
    }
  }
  for (const g of guests) {
    attendees.push({ email: g.email, name: g.name, rsvp: g.rsvp_status });
  }

  const loc = meeting.conference_url || meeting.location || '';
  const descParts = [];
  if (meeting.description) descParts.push(meeting.description);
  if (meeting.agenda) descParts.push('Повестка: ' + meeting.agenda);
  if (meeting.conference_url) descParts.push('ВКС: ' + meeting.conference_url);
  descParts.push('CRM: ' + baseUrl() + '/#/calendar');

  return buildMeetingIcs({
    method: method || 'REQUEST',
    uid: meeting.ics_uid || `meeting-${meeting.id}@asgard-crm.ru`,
    sequence: meeting.ics_sequence || 0,
    title: meeting.title,
    description: descParts.join('\n'),
    location: loc,
    url: meeting.conference_url || null,
    start: meeting.start_time,
    end: meeting.end_time || new Date(new Date(meeting.start_time).getTime() + 3600000),
    organizer: {
      name: (organizer && organizer.name) || 'ASGARD',
      email: (organizer && organizer.email) || 'noreply@asgard-crm.ru'
    },
    attendees
  });
}

/**
 * Send invites to participants (with email) and guests.
 * @param {object} db
 * @param {number} meetingId
 * @param {{
 *   method?:'REQUEST'|'CANCEL',
 *   sendEmail?:boolean,
 *   organizerUserId?:number,
 *   onlyUserIds?:number[],
 *   onlyGuestEmails?:string[],
 *   onlyUnnotified?:boolean
 * }} opts
 *   onlyUserIds — слать только этим CRM-участникам (новые после редактирования)
 *   onlyUnnotified — только тем, у кого notified_at IS NULL
 */
async function sendMeetingInvites(db, meetingId, opts = {}) {
  const method = opts.method || 'REQUEST';
  const sendEmail = opts.sendEmail !== false;
  const ctx = await loadMeetingInviteContext(db, meetingId);
  if (!ctx) return { sent: 0, notified: 0 };

  const onlyUserIds = Array.isArray(opts.onlyUserIds)
    ? new Set(opts.onlyUserIds.map((x) => parseInt(x, 10)).filter(Boolean))
    : null;
  const onlyGuestEmails = Array.isArray(opts.onlyGuestEmails)
    ? new Set(opts.onlyGuestEmails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))
    : null;
  const onlyUnnotified = !!opts.onlyUnnotified;

  const { meeting, organizer, participants, guests } = ctx;
  const ics = buildIcsPayload(ctx, method);
  const organizerUserId = opts.organizerUserId || meeting.organizer_id;
  const whenParts = formatInviteWhenParts(meeting.start_time, meeting.end_time);
  const when = whenParts.whenFull;
  const crmLink = `${baseUrl()}/#/calendar`;
  const orgName = (organizer && organizer.name) || 'Организатор';
  const subjectPrefix = method === 'CANCEL' ? 'Отмена: ' : (meeting.ics_sequence > 0 ? 'Обновление: ' : '');
  const subject = `${subjectPrefix}${meeting.title}`;
  const htmlCommon = {
    title: meeting.title,
    when,
    dateLine: whenParts.dateLine,
    timeLine: whenParts.timeLine,
    location: meeting.location,
    conferenceUrl: meeting.conference_url,
    crmLink,
    organizerName: orgName,
    cancelled: method === 'CANCEL',
    updated: method === 'REQUEST' && Number(meeting.ics_sequence) > 0 && !onlyUserIds
  };

  let sent = 0;
  let notified = 0;

  // CRM users: in-app + optional email
  for (const p of participants) {
    if (p.user_id === meeting.organizer_id) continue;
    if (onlyUserIds && !onlyUserIds.has(parseInt(p.user_id, 10))) continue;
    if (onlyUnnotified && p.notified_at) continue;

    const title =
      method === 'CANCEL' ? '📅 Встреча отменена' :
      (meeting.ics_sequence > 0 && !onlyUserIds) ? '📅 Изменение встречи' : '📅 Приглашение на встречу';
    const msg =
      method === 'CANCEL'
        ? `«${meeting.title}» отменена`
        : `${orgName}: «${meeting.title}»\n🕐 ${when}` +
          (meeting.conference_url ? `\n🔗 ${meeting.conference_url}` : '');

    await createNotification(db, {
      user_id: p.user_id,
      title,
      message: msg,
      type: 'meeting',
      link: `#/calendar`
    });
    notified++;

    if (sendEmail && p.email) {
      try {
        await sendCrmEmail(db, organizerUserId, {
          to: p.email,
          subject,
          text: msg,
          html: inviteHtml({
            ...htmlCommon,
            // для новых участников всегда «приглашение», не «обновление»
            updated: method === 'REQUEST' && Number(meeting.ics_sequence) > 0 && !onlyUserIds
          }),
          ...buildImipMailFields(ics, method)
        });
        sent++;
        await db.query(
          'UPDATE meeting_participants SET notified_at = NOW() WHERE meeting_id = $1 AND user_id = $2',
          [meetingId, p.user_id]
        );
      } catch (e) {
        console.warn('[calendar-invite] email user failed:', p.user_id, e.message);
      }
    }
  }

  // Guests by email
  for (const g of guests) {
    if (!sendEmail || !g.email) continue;
    const gEmail = String(g.email).trim().toLowerCase();
    if (onlyGuestEmails && !onlyGuestEmails.has(gEmail)) continue;
    if (onlyUserIds && !onlyGuestEmails) continue; // при точечной рассылке участникам гостей не трогаем
    if (onlyUnnotified && g.notified_at) continue;
    const guestLink = `${baseUrl()}/invite/${g.rsvp_token}`;
    try {
      await sendCrmEmail(db, organizerUserId, {
        to: g.email,
        subject,
        text: `${orgName} приглашает: ${meeting.title}\n${when}\nОтвет: ${guestLink}`,
        html: inviteHtml({ ...htmlCommon, guestLink, updated: false }),
        ...buildImipMailFields(ics, method)
      });
      sent++;
      await db.query(
        'UPDATE meeting_guests SET notified_at = NOW() WHERE id = $1',
        [g.id]
      );
    } catch (e) {
      console.warn('[calendar-invite] email guest failed:', g.email, e.message);
    }
  }

  return { sent, notified };
}

/**
 * Upsert guests from [{email, name?}] array.
 */
async function upsertGuests(db, meetingId, guestList) {
  if (!Array.isArray(guestList)) return [];
  const out = [];
  for (const g of guestList) {
    const email = String(g.email || g || '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    const name = (g.name && String(g.name).trim()) || null;
    const token = crypto.randomUUID();
    const { rows: [row] } = await db.query(`
      INSERT INTO meeting_guests (meeting_id, email, name, rsvp_status, rsvp_token, created_at)
      VALUES ($1, $2, $3, 'pending', $4, NOW())
      ON CONFLICT (meeting_id, email) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, meeting_guests.name)
      RETURNING *
    `, [meetingId, email, name, token]);
    out.push(row);
  }
  return out;
}

module.exports = {
  sendMeetingInvites,
  upsertGuests,
  loadMeetingInviteContext,
  buildIcsPayload,
  buildImipMailFields,
  inviteHtml,
  formatInviteWhenParts,
  baseUrl
};
