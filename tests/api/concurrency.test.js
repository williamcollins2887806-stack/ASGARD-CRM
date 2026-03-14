/**
 * CONCURRENCY — Parallel creates, reads, auth, race conditions
 */
const {
  api, assert, assertOk, assertStatus, assertArray, assertOneOf,
  BASE_URL, TEST_USERS
} = require('../config');

module.exports = {
  name: 'CONCURRENCY (deep)',
  tests: [
    {
      name: 'CONC-1: 5 parallel tender creates → all 200, unique IDs',
      run: async () => {
        const promises = Array.from({ length: 5 }, (_, i) =>
          api('POST', '/api/tenders', { role: 'TO', body: { customer: `CONC-1 Tender ${i}`, estimated_sum: 1000 * (i + 1) } })
        );
        const results = await Promise.all(promises);
        const ids = [];
        for (const r of results) {
          assertOk(r, 'parallel tender create');
          const t = r.data?.tender || r.data;
          if (t?.id) ids.push(t.id);
        }
        // All IDs should be unique
        const unique = new Set(ids);
        assert(unique.size === ids.length, `expected ${ids.length} unique IDs, got ${unique.size}`);
        // Cleanup
        for (const id of ids) {
          await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' }).catch(() => {});
        }
      }
    },
    {
      name: 'CONC-2: 3 parallel work creates → all 200, unique IDs',
      run: async () => {
        const promises = Array.from({ length: 3 }, (_, i) =>
          api('POST', '/api/works', { role: 'PM', body: { work_title: `CONC-2 Work ${i}` } })
        );
        const results = await Promise.all(promises);
        const ids = [];
        for (const r of results) {
          assertOk(r, 'parallel work create');
          const w = r.data?.work || r.data;
          if (w?.id) ids.push(w.id);
        }
        const unique = new Set(ids);
        assert(unique.size === ids.length, `expected ${ids.length} unique work IDs, got ${unique.size}`);
        for (const id of ids) {
          await api('DELETE', `/api/works/${id}`, { role: 'ADMIN' }).catch(() => {});
        }
      }
    },
    {
      name: 'CONC-3: 3 parallel customer creates (different INN) → all 200',
      run: async () => {
        const inns = ['9999800001', '9999800002', '9999800003'];
        // Pre-clean
        for (const inn of inns) {
          await api('DELETE', `/api/customers/${inn}`, { role: 'ADMIN' }).catch(() => {});
        }
        const promises = inns.map((inn, i) =>
          api('POST', '/api/customers', { role: 'PM', body: { inn, name: `CONC-3 Customer ${i}` } })
        );
        const results = await Promise.all(promises);
        for (const r of results) {
          assertOk(r, 'parallel customer create');
        }
        for (const inn of inns) {
          await api('DELETE', `/api/customers/${inn}`, { role: 'ADMIN' }).catch(() => {});
        }
      }
    },
    {
      name: 'CONC-4: 10 parallel GET /api/tenders → all 200, consistent counts',
      run: async () => {
        const promises = Array.from({ length: 10 }, () =>
          api('GET', '/api/tenders', { role: 'TO' })
        );
        const results = await Promise.all(promises);
        const counts = [];
        for (const r of results) {
          assertOk(r, 'parallel GET tenders');
          const list = r.data?.tenders || r.data;
          if (Array.isArray(list)) counts.push(list.length);
        }
        // All parallel reads should return same count (snapshot consistency)
        if (counts.length > 1) {
          assert(counts.every(c => c === counts[0]), `inconsistent counts: ${counts.join(', ')}`);
        }
      }
    },
    {
      name: 'CONC-5: 10 parallel GET /api/works → all 200',
      run: async () => {
        const promises = Array.from({ length: 10 }, () =>
          api('GET', '/api/works', { role: 'PM' })
        );
        const results = await Promise.all(promises);
        for (const r of results) {
          assertOk(r, 'parallel GET works');
        }
      }
    },
    {
      name: 'CONC-6: 5 parallel GET /api/users → all 200',
      run: async () => {
        const promises = Array.from({ length: 5 }, () =>
          api('GET', '/api/users', { role: 'ADMIN' })
        );
        const results = await Promise.all(promises);
        for (const r of results) {
          assertOk(r, 'parallel GET users');
        }
      }
    },
    {
      name: 'CONC-7: 5 parallel GET /api/auth/me with different roles → each returns own role',
      run: async () => {
        const roles = ['ADMIN', 'PM', 'TO', 'HR', 'BUH'];
        const promises = roles.map(role =>
          api('GET', '/api/auth/me', { role })
        );
        const results = await Promise.all(promises);
        for (let i = 0; i < roles.length; i++) {
          assertOk(results[i], `auth/me ${roles[i]}`);
          const user = results[i].data?.user || results[i].data;
          assert(user?.role === roles[i], `expected ${roles[i]}, got ${user?.role}`);
        }
      }
    },
    {
      name: 'CONC-8: 3 parallel PUTs on tender → final status is one of submitted values',
      run: async () => {
        const cr = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'CONC-8 Race Tender', estimated_sum: 100 }
        });
        assertOk(cr, 'create race tender');
        const tid = (cr.data?.tender || cr.data)?.id;
        assert(tid, 'race tender id');

        const statuses = ['В работе', 'Выиграли', 'Проиграли'];
        const promises = statuses.map(s =>
          api('PUT', `/api/tenders/${tid}`, { role: 'TO', body: { tender_status: s } })
        );
        const results = await Promise.all(promises);
        for (const r of results) {
          assertOk(r, 'race PUT');
        }

        // Verify final state is one of the submitted values
        const check = await api('GET', `/api/tenders/${tid}`, { role: 'TO' });
        if (check.ok) {
          const final = (check.data?.tender || check.data)?.tender_status;
          assertOneOf(final, statuses, 'final tender status after race');
        }

        await api('DELETE', `/api/tenders/${tid}`, { role: 'ADMIN' }).catch(() => {});
      }
    },
    {
      name: 'CONC-9: Parallel create + read → no blocking',
      run: async () => {
        const [createResp, readResp] = await Promise.all([
          api('POST', '/api/tenders', { role: 'TO', body: { customer: 'CONC-9 Parallel', estimated_sum: 100 } }),
          api('GET', '/api/tenders', { role: 'TO' })
        ]);
        assertOk(createResp, 'parallel create');
        assertOk(readResp, 'parallel read');
        const t = createResp.data?.tender || createResp.data;
        if (t?.id) await api('DELETE', `/api/tenders/${t.id}`, { role: 'ADMIN' }).catch(() => {});
      }
    },
    {
      name: 'CONC-10: 3 parallel task title updates → final is one of submitted values',
      run: async () => {
        const cr = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { title: 'CONC-10 Task Race', assignee_id: TEST_USERS['ADMIN'].id }
        });
        assertOk(cr, 'create race task');
        const taskId = (cr.data?.task || cr.data)?.id;
        assert(taskId, 'race task id');

        const titles = ['Race A', 'Race B', 'Race C'];
        const promises = titles.map(t =>
          api('PUT', `/api/tasks/${taskId}`, { role: 'ADMIN', body: { title: t } })
        );
        const results = await Promise.all(promises);
        for (const r of results) {
          assertOk(r, 'task race PUT');
        }

        // Verify final state is one of the submitted values
        const check = await api('GET', `/api/tasks/${taskId}`, { role: 'ADMIN' });
        if (check.ok) {
          const finalTitle = (check.data?.task || check.data)?.title;
          assertOneOf(finalTitle, titles, 'final task title after race');
        }

        await api('DELETE', `/api/tasks/${taskId}`, { role: 'ADMIN' }).catch(() => {});
      }
    }
  ]
};
