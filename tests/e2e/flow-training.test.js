/**
 * E2E API: Training Applications — полный цикл workflow + видимость + права
 */

const { api, assert, assertOk, assertForbidden, assertStatus, assertHasFields, assertMatch } = require('../config');

// Shared state между тестами
let appId = null;
let rejectId = null;

module.exports = {
  name: 'Training Applications Workflow',
  tests: [
    // ═══════ 1. CRUD: создание и редактирование ═══════
    {
      name: 'PM creates training application (draft)',
      run: async () => {
        const r = await api('POST', '/api/training-applications/', {
          role: 'PM',
          body: {
            course_name: 'TEST_AUTO_TrainCourse_PM',
            provider: 'Учебный центр АСГАРД',
            training_type: 'external',
            date_start: '2026-04-01',
            date_end: '2026-04-05',
            cost: 75000,
            justification: 'Повышение квалификации по проектному управлению',
            comment: 'Автотест'
          }
        });
        assertOk(r, 'create training app');
        const item = r.data.item;
        assert(item, 'item must exist');
        assert(item.id, 'item must have id');
        assertMatch(item, { status: 'draft', course_name: 'TEST_AUTO_TrainCourse_PM' });
        appId = item.id;
      }
    },
    {
      name: 'PM edits draft training application',
      run: async () => {
        const r = await api('PUT', '/api/training-applications/' + appId, {
          role: 'PM',
          body: { cost: 80000, comment: 'Обновлено автотестом' }
        });
        assertOk(r, 'edit training app');
        assertMatch(r.data.item, { cost: 80000 });
      }
    },
    {
      name: 'TO cannot edit PM draft (403)',
      run: async () => {
        const r = await api('PUT', '/api/training-applications/' + appId, {
          role: 'TO',
          body: { cost: 999 }
        });
        assertForbidden(r, 'TO edit PM app');
      }
    },

    // ═══════ 2. WORKFLOW: полный цикл ═══════
    {
      name: 'PM submits application (draft -> pending_approval)',
      run: async () => {
        const r = await api('PUT', '/api/training-applications/' + appId + '/status', {
          role: 'PM',
          body: { action: 'submit' }
        });
        assertOk(r, 'submit');
        assertMatch(r.data.item, { status: 'pending_approval' });
      }
    },
    {
      name: 'PM cannot edit after submit (400)',
      run: async () => {
        const r = await api('PUT', '/api/training-applications/' + appId, {
          role: 'PM',
          body: { cost: 999 }
        });
        assertStatus(r, 400, 'edit non-draft');
      }
    },
    {
      name: 'TO cannot approve (403)',
      run: async () => {
        const r = await api('PUT', '/api/training-applications/' + appId + '/status', {
          role: 'TO',
          body: { action: 'approve_head' }
        });
        assertForbidden(r, 'TO approve_head');
      }
    },
    {
      name: 'HEAD_PM approves (pending_approval -> approved)',
      run: async () => {
        const r = await api('PUT', '/api/training-applications/' + appId + '/status', {
          role: 'HEAD_PM',
          body: { action: 'approve_head' }
        });
        assertOk(r, 'approve_head');
        assertMatch(r.data.item, { status: 'approved' });
        assert(r.data.item.approved_by_head, 'approved_by_head must be set');
      }
    },
    {
      name: 'BUH cannot approve budget at wrong step (403)',
      run: async () => {
        const r = await api('PUT', '/api/training-applications/' + appId + '/status', {
          role: 'BUH',
          body: { action: 'approve_budget' }
        });
        assertForbidden(r, 'BUH approve_budget');
      }
    },
    {
      name: 'DIRECTOR_GEN approves budget (approved -> budget_approved)',
      run: async () => {
        const r = await api('PUT', '/api/training-applications/' + appId + '/status', {
          role: 'DIRECTOR_GEN',
          body: { action: 'approve_budget' }
        });
        assertOk(r, 'approve_budget');
        assertMatch(r.data.item, { status: 'budget_approved' });
        assert(r.data.item.approved_by_dir, 'approved_by_dir must be set');
      }
    },
    {
      name: 'HR cannot confirm payment (wrong role, 403)',
      run: async () => {
        const r = await api('PUT', '/api/training-applications/' + appId + '/status', {
          role: 'HR',
          body: { action: 'confirm_payment' }
        });
        assertForbidden(r, 'HR confirm_payment');
      }
    },
    {
      name: 'BUH confirms payment (budget_approved -> paid)',
      run: async () => {
        const r = await api('PUT', '/api/training-applications/' + appId + '/status', {
          role: 'BUH',
          body: { action: 'confirm_payment' }
        });
        assertOk(r, 'confirm_payment');
        assertMatch(r.data.item, { status: 'paid' });
        assert(r.data.item.paid_by_buh, 'paid_by_buh must be set');
      }
    },
    {
      name: 'PM cannot mark completed (wrong role, 403)',
      run: async () => {
        const r = await api('PUT', '/api/training-applications/' + appId + '/status', {
          role: 'PM',
          body: { action: 'mark_completed' }
        });
        assertForbidden(r, 'PM mark_completed');
      }
    },
    {
      name: 'HR marks completed (paid -> completed)',
      run: async () => {
        const r = await api('PUT', '/api/training-applications/' + appId + '/status', {
          role: 'HR',
          body: { action: 'mark_completed' }
        });
        assertOk(r, 'mark_completed');
        assertMatch(r.data.item, { status: 'completed' });
        assert(r.data.item.completed_by_hr, 'completed_by_hr must be set');
      }
    },

    // ═══════ 3. ВИДИМОСТЬ по ролям ═══════
    {
      name: 'ADMIN sees all training applications',
      run: async () => {
        const r = await api('GET', '/api/training-applications/', { role: 'ADMIN' });
        assertOk(r, 'admin list');
        assert(Array.isArray(r.data.applications), 'must be array');
        const found = r.data.applications.find(function(a) { return a.id === appId; });
        assert(found, 'ADMIN must see PM application');
      }
    },
    {
      name: 'HR sees all training applications',
      run: async () => {
        const r = await api('GET', '/api/training-applications/', { role: 'HR' });
        assertOk(r, 'HR list');
        const found = r.data.applications.find(function(a) { return a.id === appId; });
        assert(found, 'HR must see PM application');
      }
    },
    {
      name: 'BUH sees all training applications',
      run: async () => {
        const r = await api('GET', '/api/training-applications/', { role: 'BUH' });
        assertOk(r, 'BUH list');
        const found = r.data.applications.find(function(a) { return a.id === appId; });
        assert(found, 'BUH must see PM application');
      }
    },
    {
      name: 'DIRECTOR_GEN sees all training applications',
      run: async () => {
        const r = await api('GET', '/api/training-applications/', { role: 'DIRECTOR_GEN' });
        assertOk(r, 'DIRECTOR list');
        const found = r.data.applications.find(function(a) { return a.id === appId; });
        assert(found, 'DIRECTOR_GEN must see PM application');
      }
    },
    {
      name: 'HEAD_PM sees own + PM applications',
      run: async () => {
        const r = await api('GET', '/api/training-applications/', { role: 'HEAD_PM' });
        assertOk(r, 'HEAD_PM list');
        const found = r.data.applications.find(function(a) { return a.id === appId; });
        assert(found, 'HEAD_PM must see PM application (PM is subordinate)');
      }
    },
    {
      name: 'TO sees only own applications (not PM)',
      run: async () => {
        const r = await api('GET', '/api/training-applications/', { role: 'TO' });
        assertOk(r, 'TO list');
        const found = r.data.applications.find(function(a) { return a.id === appId; });
        assert(!found, 'TO must NOT see PM application');
      }
    },
    {
      name: 'GET /:id returns full details',
      run: async () => {
        const r = await api('GET', '/api/training-applications/' + appId, { role: 'ADMIN' });
        assertOk(r, 'get detail');
        assertHasFields(r.data.item, [
          'id', 'user_id', 'course_name', 'provider', 'training_type',
          'status', 'approved_by_head', 'approved_by_dir', 'paid_by_buh', 'completed_by_hr'
        ], 'detail fields');
      }
    },

    // ═══════ 4. ОТКЛОНЕНИЕ ═══════
    {
      name: 'Create, submit, and reject at pending_approval stage',
      run: async () => {
        var c = await api('POST', '/api/training-applications/', {
          role: 'PM',
          body: { course_name: 'TEST_AUTO_RejectTest', cost: 10000 }
        });
        assertOk(c, 'create for reject');
        rejectId = c.data.item.id;

        var s = await api('PUT', '/api/training-applications/' + rejectId + '/status', {
          role: 'PM',
          body: { action: 'submit' }
        });
        assertOk(s, 'submit for reject');

        var rej = await api('PUT', '/api/training-applications/' + rejectId + '/status', {
          role: 'HEAD_PM',
          body: { action: 'reject', reject_reason: 'Нет бюджета на обучение' }
        });
        assertOk(rej, 'reject');
        assertMatch(rej.data.item, { status: 'rejected' });
        assert(rej.data.item.rejected_by, 'rejected_by must be set');
        assert(rej.data.item.reject_reason, 'reject_reason must be set');
      }
    },
    {
      name: 'Cannot reject completed application (400)',
      run: async () => {
        const r = await api('PUT', '/api/training-applications/' + appId + '/status', {
          role: 'ADMIN',
          body: { action: 'reject', reject_reason: 'test' }
        });
        assertStatus(r, 400, 'reject completed');
      }
    },

    // ═══════ 5. УДАЛЕНИЕ ═══════
    {
      name: 'ADMIN cannot delete non-draft (404)',
      run: async () => {
        const r = await api('DELETE', '/api/training-applications/' + appId, { role: 'ADMIN' });
        assertStatus(r, 404, 'delete non-draft');
      }
    },
    {
      name: 'Create draft and ADMIN deletes it',
      run: async () => {
        var c = await api('POST', '/api/training-applications/', {
          role: 'PM',
          body: { course_name: 'TEST_AUTO_DeleteMe' }
        });
        assertOk(c, 'create for delete');
        var delId = c.data.item.id;

        var d = await api('DELETE', '/api/training-applications/' + delId, { role: 'ADMIN' });
        assertOk(d, 'delete draft');
        assert(d.data.success === true, 'success must be true');

        var g = await api('GET', '/api/training-applications/' + delId, { role: 'ADMIN' });
        assertStatus(g, 404, 'verify deleted');
      }
    },

    // ═══════ 6. CLEANUP ═══════
    {
      name: 'Cleanup test data',
      run: async () => {
        var all = await api('GET', '/api/training-applications/', { role: 'ADMIN' });
        if (all.data && all.data.applications) {
          for (var app of all.data.applications) {
            if (app.course_name && app.course_name.indexOf('TEST_AUTO_') === 0) {
              try {
                await api('DELETE', '/api/training-applications/' + app.id, { role: 'ADMIN' });
              } catch(e) {}
            }
          }
        }
      }
    }
  ]
};
