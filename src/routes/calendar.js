'use strict';

/**
 * Calendar Routes — personal events + Outlook feed / availability / guest RSVP
 */

const { logError } = require('../lib/log-error');
const { getAvailability, findTime } = require('../services/calendar-availability');
const { createNotification } = require('../services/notify');

const ALLOWED_COLS = new Set([
  'title', 'description', 'date', 'end_date',
  'created_by', 'type', 'created_at', 'updated_at',
  'time', 'end_time', 'location', 'color', 'tender_id', 'work_id', 'reminder_minutes',
  'participants', 'all_day', 'recurrence'
]);

const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

function filterData(data) {
  const filtered = {};
  for (const [k, v] of Object.entries(data)) {
    if (ALLOWED_COLS.has(k) && v !== undefined) filtered[k] = v;
  }
  return filtered;
}

function toYmd(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function hhmm(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

/** Expand simple recurrence_rule: DAILY|WEEKLY|MONTHLY into occurrence dates in range */
function expandRecurrence(startDate, rule, rangeFrom, rangeTo, exceptions) {
  const excl = new Set((exceptions || []).map((e) => String(e).slice(0, 10)));
  const out = [];
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return out;
  const from = new Date(rangeFrom);
  const to = new Date(rangeTo);
  const r = String(rule || '').toUpperCase();
  if (!r || r === 'NONE') {
    const y = toYmd(start);
    if (y && y >= toYmd(from) && y <= toYmd(to) && !excl.has(y)) out.push(y);
    return out;
  }

  let cur = new Date(start);
  // Don't generate infinitely — cap 400 iterations
  for (let i = 0; i < 400; i++) {
    const y = toYmd(cur);
    if (y > toYmd(to)) break;
    if (y >= toYmd(from) && !excl.has(y)) out.push(y);
    if (r === 'DAILY' || r.startsWith('FREQ=DAILY')) {
      cur.setDate(cur.getDate() + 1);
    } else if (r === 'WEEKLY' || r.startsWith('FREQ=WEEKLY')) {
      cur.setDate(cur.getDate() + 7);
    } else if (r === 'MONTHLY' || r.startsWith('FREQ=MONTHLY')) {
      cur.setMonth(cur.getMonth() + 1);
    } else {
      break;
    }
  }
  return out;
}

function invitePageHtml({ meeting, guest, error }) {
  if (error) {
    return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Приглашение</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:40px auto;padding:0 16px;color:#0f172a} .err{color:#b91c1c}</style></head>
<body><h1 class="err">${error}</h1><p>Ссылка недействительна или устарела.</p></body></html>`;
  }
  const when = new Date(meeting.start_time).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const status = guest.rsvp_status || 'pending';
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(meeting.title)}</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#0f172a;line-height:1.5}
.card{border:1px solid #e2e8f0;border-radius:12px;padding:20px;box-shadow:0 4px 20px rgba(15,23,42,.06)}
.btn{display:inline-block;margin:6px 6px 0 0;padding:10px 16px;border-radius:8px;border:0;cursor:pointer;font-weight:600;color:#fff}
.ok{background:#16a34a}.no{background:#dc2626}.maybe{background:#ca8a04}
.muted{color:#64748b;font-size:14px}
.status{margin-top:12px;padding:8px 12px;background:#f1f5f9;border-radius:8px}
</style></head><body>
<div class="card">
  <h1>${escapeHtml(meeting.title)}</h1>
  <p><b>Когда:</b> ${escapeHtml(when)}</p>
  ${meeting.location ? `<p><b>Место:</b> ${escapeHtml(meeting.location)}</p>` : ''}
  ${meeting.conference_url ? `<p><b>ВКС:</b> <a href="${escapeHtml(meeting.conference_url)}">${escapeHtml(meeting.conference_url)}</a></p>` : ''}
  <p class="muted">Здравствуйте${guest.name ? ', ' + escapeHtml(guest.name) : ''}!</p>
  <div id="actions">
    <button class="btn ok" data-s="accepted">Принять</button>
    <button class="btn maybe" data-s="tentative">Возможно</button>
    <button class="btn no" data-s="declined">Отклонить</button>
  </div>
  <div class="status" id="status">Текущий ответ: <b>${escapeHtml(status)}</b></div>
</div>
<script>
const API = '/api/calendar/invite/' + location.pathname.split('/').pop();
document.querySelectorAll('[data-s]').forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    const status = btn.dataset.s;
    const r = await fetch(API, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({status})
    });
    const j = await r.json().catch(()=>({}));
    document.getElementById('status').innerHTML = r.ok
      ? 'Спасибо! Ваш ответ: <b>'+status+'</b>'
      : ('Ошибка: '+(j.error||r.status));
  });
});
</script>
</body></html>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function routes(fastify, options) {
  const db = fastify.db;

  // ── Feed: personal events + my meetings (union) ──────────────
  fastify.get('/feed', { preHandler: [fastify.authenticate] }, async (request) => {
    const userId = request.user.id;
    const { date_from, date_to, limit = 500 } = request.query;
    const from = date_from || toYmd(new Date());
    const to = date_to || from;
    const items = [];

    const { rows: events } = await db.query(`
      SELECT * FROM calendar_events
      WHERE created_by = $1
        AND date <= $3::date
        AND COALESCE(end_date, date) >= $2::date
      ORDER BY date ASC
      LIMIT $4
    `, [userId, from, to, Math.min(parseInt(limit, 10) || 500, 1000)]);

    for (const e of events) {
      items.push({
        id: e.id,
        source: 'event',
        title: e.title,
        description: e.description,
        date: String(e.date).slice(0, 10),
        time: e.time,
        end_time: e.end_time,
        type: e.type || 'other',
        location: e.location,
        participants: e.participants,
        reminder_minutes: e.reminder_minutes,
        meeting_id: null
      });
    }

    const { rows: meetings } = await db.query(`
      SELECT m.*,
        (SELECT rsvp_status FROM meeting_participants WHERE meeting_id = m.id AND user_id = $1) as my_rsvp
      FROM meetings m
      WHERE m.status IN ('scheduled', 'in_progress', 'completed')
        AND m.start_time::date <= $3::date
        AND COALESCE(m.end_time, m.start_time)::date >= $2::date
        AND (
          m.organizer_id = $1
          OR EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = m.id AND mp.user_id = $1)
        )
      ORDER BY m.start_time ASC
      LIMIT $4
    `, [userId, from, to, Math.min(parseInt(limit, 10) || 500, 1000)]);

    // exceptions map
    const meetingIds = meetings.map((m) => m.id);
    let exceptionsByMeeting = new Map();
    if (meetingIds.length) {
      const { rows: ex } = await db.query(
        'SELECT meeting_id, exception_date FROM meeting_exceptions WHERE meeting_id = ANY($1::int[]) AND is_cancelled = true',
        [meetingIds]
      );
      for (const row of ex) {
        const list = exceptionsByMeeting.get(row.meeting_id) || [];
        list.push(String(row.exception_date).slice(0, 10));
        exceptionsByMeeting.set(row.meeting_id, list);
      }
    }

    for (const m of meetings) {
      const start = new Date(m.start_time);
      const end = m.end_time ? new Date(m.end_time) : new Date(start.getTime() + 3600000);
      const rule = m.is_recurring ? (m.recurrence_rule || 'NONE') : 'NONE';
      const dates = expandRecurrence(start, rule, from, to, exceptionsByMeeting.get(m.id));
      const durationMs = end - start;
      for (const d of dates) {
        // Keep time-of-day from original start
        const occStart = new Date(m.start_time);
        const [yy, mm, dd] = d.split('-').map(Number);
        occStart.setFullYear(yy, mm - 1, dd);
        const occEnd = new Date(occStart.getTime() + durationMs);
        items.push({
          id: `m-${m.id}-${d}`,
          source: 'meeting',
          meeting_id: m.id,
          title: m.title,
          description: m.description,
          date: d,
          time: hhmm(occStart),
          end_time: hhmm(occEnd),
          type: 'meeting',
          location: m.location,
          conference_url: m.conference_url,
          my_rsvp: m.my_rsvp,
          organizer_id: m.organizer_id,
          status: m.status,
          recurrence_rule: m.recurrence_rule || null
        });
      }
    }

    items.sort((a, b) => {
      const c = String(a.date).localeCompare(String(b.date));
      if (c) return c;
      return String(a.time || '').localeCompare(String(b.time || ''));
    });

    return { items, events: items };
  });

  // ── Availability ─────────────────────────────────────────────
  fastify.get('/availability', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_ids, from, to } = request.query;
    if (!user_ids || !from || !to) {
      return reply.code(400).send({ error: 'Нужны user_ids, from, to' });
    }
    const ids = String(user_ids).split(',').map((x) => parseInt(x, 10)).filter(Boolean);
    if (!ids.length) return reply.code(400).send({ error: 'Пустой список user_ids' });
    if (ids.length > 30) return reply.code(400).send({ error: 'Максимум 30 участников' });

    const reveal = DIRECTOR_ROLES.includes(request.user.role);
    const data = await getAvailability(db, ids, from, to, { revealTitles: reveal });
    return data;
  });

  // ── Find time ────────────────────────────────────────────────
  fastify.post('/find-time', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const body = request.body || {};
    const user_ids = body.user_ids || [];
    if (!Array.isArray(user_ids) || !user_ids.length) {
      return reply.code(400).send({ error: 'user_ids обязателен' });
    }
    if (!body.window_from || !body.window_to) {
      return reply.code(400).send({ error: 'window_from и window_to обязательны' });
    }
    const result = await findTime(db, {
      user_ids,
      duration_minutes: body.duration_minutes || 60,
      window_from: body.window_from,
      window_to: body.window_to,
      allow_missing: body.allow_missing || 0
    });
    return result;
  });

  // ── Guest invite page (HTML) — also mounted at /invite/:token via index ──
  fastify.get('/invite/:token', async (request, reply) => {
    const token = request.params.token;
    const { rows: [guest] } = await db.query(
      'SELECT * FROM meeting_guests WHERE rsvp_token = $1',
      [token]
    );
    if (!guest) {
      reply.type('text/html').code(404);
      return invitePageHtml({ error: 'Приглашение не найдено' });
    }
    const { rows: [meeting] } = await db.query('SELECT * FROM meetings WHERE id = $1', [guest.meeting_id]);
    if (!meeting || meeting.status === 'cancelled') {
      reply.type('text/html').code(404);
      return invitePageHtml({ error: 'Встреча отменена или удалена' });
    }
    reply.type('text/html');
    return invitePageHtml({ meeting, guest });
  });

  fastify.post('/invite/:token', async (request, reply) => {
    const token = request.params.token;
    const status = (request.body && request.body.status) || '';
    if (!['accepted', 'declined', 'tentative'].includes(status)) {
      return reply.code(400).send({ error: 'status: accepted|declined|tentative' });
    }
    const { rows: [guest] } = await db.query(
      `UPDATE meeting_guests SET rsvp_status = $1 WHERE rsvp_token = $2 RETURNING *`,
      [status, token]
    );
    if (!guest) return reply.code(404).send({ error: 'Не найдено' });

    const { rows: [meeting] } = await db.query('SELECT * FROM meetings WHERE id = $1', [guest.meeting_id]);
    if (meeting) {
      const map = { accepted: 'принял', declined: 'отклонил', tentative: 'ответил «возможно»' };
      await createNotification(db, {
        user_id: meeting.organizer_id,
        title: '📅 RSVP гостя',
        message: `${guest.name || guest.email} ${map[status]} приглашение на «${meeting.title}»`,
        type: 'meeting',
        link: '#/calendar'
      });
    }
    return { success: true, rsvp_status: status };
  });

  // Must be before /:id
  fastify.get('/reminders/check', { preHandler: [fastify.authenticate] }, async (request) => {
    const result = await db.query(`
      SELECT * FROM calendar_events
      WHERE created_by = $1 AND date = CURRENT_DATE
      ORDER BY date ASC
    `, [request.user.id]);
    return { reminders: result.rows };
  });

  // ── Legacy list (kept) — prefer /feed for UI ─────────────────
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const userId = request.user.id;
    const { date_from, date_to, type, limit = 100, mine } = request.query;
    // Default: only own events (fix leak). mine=0 for directors can see all.
    const seeAll = mine === '0' && DIRECTOR_ROLES.includes(request.user.role);
    let sql = 'SELECT * FROM calendar_events WHERE 1=1';
    const params = [];
    let idx = 1;
    if (!seeAll) {
      sql += ` AND created_by = $${idx}`;
      params.push(userId);
      idx++;
    }
    if (date_from) { sql += ` AND date >= $${idx}`; params.push(date_from); idx++; }
    if (date_to) { sql += ` AND date <= $${idx}`; params.push(date_to); idx++; }
    if (type) { sql += ` AND type = $${idx}`; params.push(type); idx++; }
    sql += ` ORDER BY date ASC LIMIT $${idx}`;
    params.push(Math.min(parseInt(limit, 10) || 100, 1000));
    const result = await db.query(sql, params);
    return { events: result.rows };
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query(
      'SELECT * FROM calendar_events WHERE id = $1 AND created_by = $2',
      [request.params.id, request.user.id]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Событие не найдено' });
    return { event: result.rows[0] };
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const body = request.body || {};
      if (!body.title || !body.date) {
        return reply.code(400).send({ error: 'Обязательные поля: title, date' });
      }
      if (isNaN(new Date(body.date).getTime())) {
        return reply.code(400).send({ error: 'Некорректный формат даты' });
      }
      const data = filterData({
        ...body,
        created_by: request.user.id,
        created_at: new Date().toISOString(),
        reminder_sent: false
      });
      // reminder_sent not in allowlist — set via raw if column exists
      const keys = Object.keys(data);
      if (!keys.length) return reply.code(400).send({ error: 'Нет данных' });
      const values = Object.values(data);
      const sql = `INSERT INTO calendar_events (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
      const result = await db.query(sql, values);
      return { event: result.rows[0] };
    } catch (err) {
      if (err.code === '22P02') return reply.code(400).send({ error: 'Некорректный формат данных (тип поля)' });
      if (err.code === '22003') return reply.code(400).send({ error: 'Числовое значение вне допустимого диапазона' });
      if (err.code === '23503') return reply.code(400).send({ error: 'Связанная запись не найдена' });
      logError(fastify, 'Calendar POST error', err, request);
      return reply.code(500).send({ error: 'Ошибка создания события' });
    }
  });

  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const data = filterData(request.body || {});
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(data)) {
      updates.push(`${key} = $${idx}`); values.push(value); idx++;
    }
    if (!updates.length) return reply.code(400).send({ error: 'Нет данных' });
    updates.push('updated_at = NOW()');
    // reset reminder if time changed
    if (data.date || data.time || data.reminder_minutes !== undefined) {
      updates.push('reminder_sent = false');
    }
    values.push(id, request.user.id);
    const sql = `UPDATE calendar_events SET ${updates.join(', ')} WHERE id = $${idx} AND created_by = $${idx + 1} RETURNING *`;
    const result = await db.query(sql, values);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { event: result.rows[0] };
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.query(
      'DELETE FROM calendar_events WHERE id = $1 AND created_by = $2 RETURNING id',
      [request.params.id, request.user.id]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { message: 'Удалено' };
  });
}

module.exports = routes;
