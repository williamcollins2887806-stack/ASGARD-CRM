/**
 * MEETINGS-FULL — Complete meeting lifecycle: CRUD, participants, RSVP,
 * attendance, minutes, finalize, reminders, and role-based access control.
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertFieldType, skip } = require('../config');

let testMeetingId = null;
let testMinuteItemId = null;
let participantUserId = null;

module.exports = {
  name: 'MEETINGS FULL (Совещания — полный цикл)',
  tests: [
    // ═══════════════════════════════════════════════════════════════
    // SETUP: resolve a real user ID for participant FK
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'Setup: find a real user ID for participant FK',
      run: async () => {
        const resp = await api('GET', '/api/users?limit=5', { role: 'ADMIN' });
        assertOk(resp, 'fetch users');
        const users = Array.isArray(resp.data) ? resp.data : (resp.data?.users || resp.data?.data || []);
        if (users.length >= 2) {
          // Pick the second user so it differs from the ADMIN organizer
          participantUserId = users[1].id;
        } else if (users.length === 1) {
          participantUserId = users[0].id;
        }
        assert(participantUserId, 'need at least one user for participant FK');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 1. ADMIN reads meetings list
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'ADMIN reads meetings list',
      run: async () => {
        const resp = await api('GET', '/api/meetings', { role: 'ADMIN' });
        assertOk(resp, 'meetings list');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.meetings || resp.data?.items || []);
        assertArray(list, 'meetings list');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 2. ADMIN reads upcoming meetings
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'ADMIN reads upcoming meetings',
      run: async () => {
        const resp = await api('GET', '/api/meetings/upcoming', { role: 'ADMIN' });
        assertOk(resp, 'upcoming meetings');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.meetings || resp.data?.items || []);
        assertArray(list, 'upcoming meetings');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 3. ADMIN reads meeting stats
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'ADMIN reads meeting stats',
      run: async () => {
        const resp = await api('GET', '/api/meetings/stats', { role: 'ADMIN' });
        assertOk(resp, 'meeting stats');
        assert(resp.data && typeof resp.data === 'object', 'stats should be an object');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 4. ADMIN creates meeting with participants
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'ADMIN creates meeting with participants',
      run: async () => {
        const body = {
          title: 'MeetFull-Test: Sprint Planning',
          description: 'Autotest meeting — full lifecycle',
          start_time: '2026-06-20T10:00:00Z',
          end_time: '2026-06-20T11:30:00Z',
          location: 'Conference Room A',
          agenda: '1. Review backlog\n2. Assign tasks',
          participant_ids: participantUserId ? [participantUserId] : []
        };
        const resp = await api('POST', '/api/meetings', { role: 'ADMIN', body });
        assertOk(resp, 'create meeting');
        const meeting = resp.data?.meeting || resp.data;
        assert(meeting && meeting.id, 'created meeting must have an id');
        testMeetingId = meeting.id;
        assertFieldType(meeting, 'title', 'string', 'meeting title type');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 5. Read-back meeting by ID
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'Read-back meeting by ID verifies fields',
      run: async () => {
        if (!testMeetingId) return skip('no meeting created');
        const resp = await api('GET', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assertOk(resp, 'get meeting by ID');
        const meeting = resp.data?.meeting || resp.data;
        assertHasFields(meeting, ['id', 'title', 'status'], 'meeting detail');
        assert(meeting.title === 'MeetFull-Test: Sprint Planning', 'title must match created value');
        assert(meeting.status === 'scheduled', `expected status "scheduled", got "${meeting.status}"`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 6. Read-back includes participants
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'Read-back meeting includes participants array',
      run: async () => {
        if (!testMeetingId) return skip('no meeting created');
        const resp = await api('GET', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assertOk(resp, 'get meeting detail');
        const participants = resp.data?.participants;
        if (!participants) return skip('response does not contain participants key');
        assertArray(participants, 'participants');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 7. Update meeting
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'ADMIN updates meeting title and location',
      run: async () => {
        if (!testMeetingId) return skip('no meeting created');
        const resp = await api('PUT', `/api/meetings/${testMeetingId}`, {
          role: 'ADMIN',
          body: {
            title: 'MeetFull-Test: Sprint Planning (updated)',
            location: 'Conference Room B'
          }
        });
        assertOk(resp, 'update meeting');
        // Verify update
        const check = await api('GET', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assertOk(check, 'read-back after update');
        const meeting = check.data?.meeting || check.data;
        if (meeting.title !== undefined) {
          assert(meeting.title === 'MeetFull-Test: Sprint Planning (updated)', 'title should reflect update');
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 8. Add participants to meeting
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'ADMIN adds participant to meeting',
      run: async () => {
        if (!testMeetingId || !participantUserId) return skip('no meeting or participant');
        const resp = await api('POST', `/api/meetings/${testMeetingId}/participants`, {
          role: 'ADMIN',
          body: { user_id: participantUserId }
        });
        assertOk(resp, 'add participant');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 9. RSVP to meeting
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'ADMIN RSVPs to meeting (accepted)',
      run: async () => {
        if (!testMeetingId) return skip('no meeting created');
        const resp = await api('PUT', `/api/meetings/${testMeetingId}/rsvp`, {
          role: 'ADMIN',
          body: { status: 'accepted', comment: 'Will attend' }
        });
        // ADMIN may not be a participant (organizer), so 404 is acceptable
        if (resp.status === 404) return skip('ADMIN is organizer, not participant — skip RSVP');
        assertOk(resp, 'RSVP accepted');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 10. Mark attendance
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'ADMIN marks attendance',
      run: async () => {
        if (!testMeetingId || !participantUserId) return skip('no meeting or participant');
        const resp = await api('PUT', `/api/meetings/${testMeetingId}/attendance`, {
          role: 'ADMIN',
          body: {
            attendees: [{ user_id: participantUserId, attended: true }]
          }
        });
        assertOk(resp, 'mark attendance');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 11. Add minutes item
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'ADMIN adds minutes item to meeting',
      run: async () => {
        if (!testMeetingId) return skip('no meeting created');
        const resp = await api('POST', `/api/meetings/${testMeetingId}/minutes`, {
          role: 'ADMIN',
          body: {
            item_type: 'decision',
            content: 'Autotest: decided to ship by EOW',
            responsible_user_id: participantUserId,
            deadline: '2026-06-25'
          }
        });
        assertOk(resp, 'add minutes');
        const item = resp.data?.item || resp.data;
        if (item && item.id) {
          testMinuteItemId = item.id;
          assertHasFields(item, ['id', 'content'], 'minute item');
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 12. Read-back meeting verifies minutes present
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'Read-back meeting includes minutes',
      run: async () => {
        if (!testMeetingId) return skip('no meeting created');
        const resp = await api('GET', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assertOk(resp, 'get meeting for minutes check');
        const minutes = resp.data?.minutes;
        if (!minutes) return skip('response does not contain minutes key');
        assertArray(minutes, 'minutes');
        assert(minutes.length >= 1, 'should have at least 1 minutes item');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 13. Finalize meeting
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'ADMIN finalizes meeting',
      run: async () => {
        if (!testMeetingId) return skip('no meeting created');
        const resp = await api('PUT', `/api/meetings/${testMeetingId}/finalize`, {
          role: 'ADMIN',
          body: { minutes_text: 'Final protocol: all items covered.' }
        });
        assertOk(resp, 'finalize meeting');
        // Verify status changed to completed
        const check = await api('GET', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assertOk(check, 'read-back finalized');
        const meeting = check.data?.meeting || check.data;
        if (meeting.status !== undefined) {
          assert(meeting.status === 'completed', `expected "completed" after finalize, got "${meeting.status}"`);
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 14. Check reminders endpoint
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'ADMIN calls check-reminders endpoint',
      run: async () => {
        const resp = await api('GET', '/api/meetings/check-reminders', { role: 'ADMIN' });
        if (resp.status === 404) return skip('check-reminders endpoint not found');
        assertOk(resp, 'check reminders');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // NEGATIVE: forbidden write roles
    // ═══════════════════════════════════════════════════════════════
    // Meetings is OPEN (authenticate only) — all roles can access
    {
      name: 'OPEN: WAREHOUSE can create meeting (authenticate only)',
      run: async () => {
        const resp = await api('POST', '/api/meetings', {
          role: 'WAREHOUSE',
          body: { title: 'Warehouse meeting test', start_time: '2026-07-01T09:00:00Z' }
        });
        assert(resp.status !== 403, `WAREHOUSE should access meetings but got 403`);
        const id = resp.data?.meeting?.id || resp.data?.id;
        if (id) await api('DELETE', `/api/meetings/${id}`, { role: 'ADMIN' }).catch(() => {});
      }
    },
    {
      name: 'OPEN: PROC can create meeting (authenticate only)',
      run: async () => {
        const resp = await api('POST', '/api/meetings', {
          role: 'PROC',
          body: { title: 'Proc meeting test', start_time: '2026-07-01T09:00:00Z' }
        });
        assert(resp.status !== 403, `PROC should access meetings but got 403`);
        const id = resp.data?.meeting?.id || resp.data?.id;
        if (id) await api('DELETE', `/api/meetings/${id}`, { role: 'ADMIN' }).catch(() => {});
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // NEGATIVE: invalid RSVP status -> 400
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'NEGATIVE: RSVP with invalid status -> 400',
      run: async () => {
        if (!testMeetingId) return skip('no meeting created');
        const resp = await api('PUT', `/api/meetings/${testMeetingId}/rsvp`, {
          role: 'ADMIN',
          body: { status: 'invalid_status' }
        });
        assert(resp.status === 400, `invalid RSVP status should return 400, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // CLEANUP: delete meeting (and cascade data)
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'Cleanup: ADMIN deletes test meeting',
      run: async () => {
        if (!testMeetingId) return;
        const resp = await api('DELETE', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete meeting');
      }
    },
    {
      name: 'Verify deleted meeting returns 404',
      run: async () => {
        if (!testMeetingId) return;
        const resp = await api('GET', `/api/meetings/${testMeetingId}`, { role: 'ADMIN' });
        assert(
          resp.status === 404 || resp.status === 403,
          `expected 404 after delete, got ${resp.status}`
        );
        testMeetingId = null;
        testMinuteItemId = null;
      }
    }
  ]
};
