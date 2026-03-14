/**
 * E2E FLOW 7: Meeting lifecycle with cross-role participation
 * DIRECTOR_GEN creates meeting -> invites PM, TO -> participants RSVP ->
 * meeting minutes recorded -> action items -> tasks created -> cleanup
 */
const { api, assert, assertOk, skip } = require('../config');

module.exports = {
  name: 'FLOW: Meeting Actions & Minutes',
  tests: [
    {
      name: 'DIRECTOR_GEN creates meeting, PM and TO RSVP, minutes, task from minutes',
      run: async () => {
        const users = await api('GET', '/api/users', { role: 'ADMIN' });
        const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        const pmUser = userList.find(u => u.role === 'PM' && u.is_active !== false);
        const toUser = userList.find(u => u.role === 'TO' && u.is_active !== false);
        if (!pmUser || !toUser) skip('Need active PM and TO users');
        const pmId = pmUser.id;
        const toId = toUser.id;

        const futureDate = new Date(Date.now() + 7 * 86400000).toISOString();
        const endDate = new Date(Date.now() + 7 * 86400000 + 3600000).toISOString();

        const createResp = await api('POST', '/api/meetings', {
          role: 'DIRECTOR_GEN',
          body: {
            title: 'E2E Meeting: Weekly Sync',
            description: 'E2E autotest meeting',
            location: 'Conference Room A',
            start_time: futureDate,
            end_time: endDate,
            agenda: 'Discuss project progress',
            participant_ids: [pmId, toId]
          }
        });
        if (createResp.status === 404) skip('meetings endpoint not available');
        assertOk(createResp, 'DIRECTOR_GEN create meeting');
        const meetingId = createResp.data?.meeting?.id;
        if (!meetingId) skip('Meeting ID not returned');

        try {
          const getResp = await api('GET', '/api/meetings/' + meetingId, { role: 'DIRECTOR_GEN' });
          assertOk(getResp, 'GET meeting details');
          assert(getResp.data?.meeting?.title === 'E2E Meeting: Weekly Sync', 'title matches');

          const rsvpPm = await api('PUT', '/api/meetings/' + meetingId + '/rsvp', {
            role: 'PM', body: { status: 'accepted', comment: 'PM will attend' }
          });
          assertOk(rsvpPm, 'PM RSVP accepted');

          const rsvpTo = await api('PUT', '/api/meetings/' + meetingId + '/rsvp', {
            role: 'TO', body: { status: 'tentative', comment: 'TO may attend' }
          });
          assertOk(rsvpTo, 'TO RSVP tentative');

          const noteResp = await api('POST', '/api/meetings/' + meetingId + '/minutes', {
            role: 'DIRECTOR_GEN',
            body: { item_type: 'note', content: 'E2E: Discussed timeline and resources' }
          });
          assertOk(noteResp, 'add minutes note');

          const deadline = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
          const actionResp = await api('POST', '/api/meetings/' + meetingId + '/minutes', {
            role: 'DIRECTOR_GEN',
            body: {
              item_type: 'action',
              content: 'E2E: Prepare detailed estimate',
              responsible_user_id: pmId,
              deadline: deadline
            }
          });
          assertOk(actionResp, 'add action item');
          const actionItemId = actionResp.data?.item?.id;

          if (actionItemId) {
            const taskResp = await api('POST', '/api/meetings/' + meetingId + '/minutes/' + actionItemId + '/create-task', {
              role: 'DIRECTOR_GEN', body: {}
            });
            assertOk(taskResp, 'create task from action item');
            const taskId = taskResp.data?.task?.id;
            if (taskId) {
              const taskDetail = await api('GET', '/api/tasks/' + taskId, { role: 'ADMIN' });
              assertOk(taskDetail, 'get created task');
              const task = taskDetail.data?.task || taskDetail.data;
              if (task) assert(task.assignee_id === pmId, 'task assigned to PM');
              await api('DELETE', '/api/tasks/' + taskId, { role: 'ADMIN' });
            }
          }

          const attendResp = await api('PUT', '/api/meetings/' + meetingId + '/attendance', {
            role: 'DIRECTOR_GEN',
            body: { attendees: [{ user_id: pmId, attended: true }, { user_id: toId, attended: false }] }
          });
          assertOk(attendResp, 'mark attendance');

          const finalizeResp = await api('PUT', '/api/meetings/' + meetingId + '/finalize', {
            role: 'DIRECTOR_GEN',
            body: { minutes_text: 'E2E: Meeting concluded. Actions assigned.' }
          });
          assertOk(finalizeResp, 'finalize meeting');

          const finalDetails = await api('GET', '/api/meetings/' + meetingId, { role: 'DIRECTOR_GEN' });
          assertOk(finalDetails, 'GET finalized meeting');
          assert(finalDetails.data?.meeting?.status === 'completed', 'meeting completed');
        } finally {
          await api('DELETE', '/api/meetings/' + meetingId, { role: 'ADMIN' });
        }
      }
    },
    {
      name: 'Meeting list, upcoming, and stats endpoints work',
      run: async () => {
        const listResp = await api('GET', '/api/meetings', { role: 'DIRECTOR_GEN' });
        if (listResp.status === 404) skip('meetings endpoint not available');
        assertOk(listResp, 'list meetings');
        assert(Array.isArray(listResp.data?.meetings), 'meetings array returned');

        const upcomingResp = await api('GET', '/api/meetings/upcoming', { role: 'PM' });
        assertOk(upcomingResp, 'upcoming meetings');

        const statsResp = await api('GET', '/api/meetings/stats', { role: 'PM' });
        assertOk(statsResp, 'meeting stats');
      }
    }
  ]
};
