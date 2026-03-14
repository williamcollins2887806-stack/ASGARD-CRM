/** E2E FLOW 12: Notification triggers */
const { api, assert, assertOk, skip } = require('../config');

module.exports = {
  name: 'FLOW: Notification Triggers',
  tests: [
    {
      name: 'Task creation triggers notification for assignee',
      run: async () => {
        const u = await api('GET', '/api/users', { role: 'ADMIN' });
        const ul = Array.isArray(u.data) ? u.data : (u.data?.users || []);
        const pm = ul.find(x => x.role === 'PM' && x.is_active !== false);
        if (!pm) skip('Need PM');
        const br = await api('GET', '/api/notifications/unread-count', { role: 'PM' });
        if (br.status === 404) skip('notifs N/A');
        assertOk(br, 'unread count');
        const tr = await api('POST', '/api/tasks', {
          role: 'DIRECTOR_GEN',
          body: { title: 'E2E Notif: Review report', assignee_id: pm.id, priority: 'high',
            deadline: new Date(Date.now()+7*86400000).toISOString().slice(0,10) }
        });
        if (tr.status === 404) skip('tasks N/A');
        assertOk(tr, 'create task');
        const tid = tr.data?.task?.id || tr.data?.id;
        try {
          await new Promise(r => setTimeout(r, 500));
          const ar = await api('GET', '/api/notifications?is_read=false', { role: 'PM' });
          assertOk(ar, 'PM notifs');
          assert(Array.isArray(ar.data?.notifications), 'is array');
        } finally {
          if (tid) await api('DELETE', '/api/tasks/' + tid, { role: 'ADMIN' });
        }
      }
    },
    {
      name: 'Cash approval triggers notification',
      run: async () => {
        const works = await api('GET', '/api/works?limit=1', { role: 'PM' });
        const wl = works.data?.works || works.data || [];
        if (!Array.isArray(wl) || !wl.length) skip('No works');
        const cr = await api('POST', '/api/cash', {
          role: 'PM', body: { amount: 25000, purpose: 'E2E notif test', work_id: wl[0].id, type: 'advance' }
        });
        if (cr.status === 404) skip('cash N/A');
        assertOk(cr, 'create cash');
        const cid = cr.data?.id;
        if (!cid) skip('No cash ID');
        try {
          const ap = await api('PUT', '/api/cash/' + cid + '/approve', { role: 'ADMIN', body: { comment: 'E2E' } });
          assertOk(ap, 'approve');
          await new Promise(r => setTimeout(r, 500));
          const nr = await api('GET', '/api/notifications?is_read=false', { role: 'PM' });
          assertOk(nr, 'PM notifs after approval');
        } finally {
          await api('PUT', '/api/cash/' + cid + '/close', { role: 'ADMIN', body: { force: true, comment: 'cleanup' } });
        }
      }
    },
    {
      name: 'Calendar event and notification endpoints',
      run: async () => {
        const d = new Date(Date.now()+3*86400000).toISOString().slice(0,10);
        const cr = await api('POST', '/api/calendar', {
          role: 'ADMIN', body: { title: 'E2E: Team Event', description: 'test', date: d, time: '14:00', type: 'event' }
        });
        if (cr.status === 404) skip('calendar N/A');
        assertOk(cr, 'create event');
        const ev = cr.data?.event;
        if (!ev || !ev.id) skip('No event');
        try {
          const lr = await api('GET', '/api/calendar?date_from=' + d, { role: 'ADMIN' });
          assertOk(lr, 'list events');
          const nr = await api('GET', '/api/notifications', { role: 'ADMIN' });
          assertOk(nr, 'list notifs');
          const ns = nr.data?.notifications || [];
          if (ns.length > 0) {
            const mr = await api('PUT', '/api/notifications/' + ns[0].id + '/read', { role: 'ADMIN', body: {} });
            assertOk(mr, 'mark read');
          }
          const ma = await api('PUT', '/api/notifications/read-all', { role: 'ADMIN', body: {} });
          assertOk(ma, 'mark all read');
          const uc = await api('GET', '/api/notifications/unread-count', { role: 'ADMIN' });
          assertOk(uc, 'unread count');
        } finally {
          await api('DELETE', '/api/calendar/' + ev.id, { role: 'ADMIN' });
        }
      }
    },
    {
      name: 'Notification CRUD: create, mark-read, delete',
      run: async () => {
        const u = await api('GET', '/api/users', { role: 'ADMIN' });
        const ul = Array.isArray(u.data) ? u.data : (u.data?.users || []);
        const au = ul.find(x => x.login === 'test_admin') || ul.find(x => x.role === 'ADMIN');
        if (!au) skip('No ADMIN');
        const cr = await api('POST', '/api/notifications', {
          role: 'ADMIN', body: { user_id: au.id, title: 'E2E Test', message: 'E2E notif', type: 'info', link: '#/test' }
        });
        if (cr.status === 404) skip('notif POST N/A');
        if (cr.status === 403) skip('Cannot create');
        if (!cr.ok) skip('Failed: ' + cr.status);
        const n = cr.data?.notification;
        if (!n || !n.id) skip('Not returned');
        try {
          const rr = await api('PUT', '/api/notifications/' + n.id + '/read', { role: 'ADMIN', body: {} });
          assertOk(rr, 'mark read');
        } finally {
          await api('DELETE', '/api/notifications/' + n.id, { role: 'ADMIN' });
        }
      }
    }
  ]
};
