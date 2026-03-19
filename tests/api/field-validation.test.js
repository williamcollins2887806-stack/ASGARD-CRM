/**
 * BLOCK 6: FIELD VALIDATION — All input fields across forms
 * Tenders, Works, Employees, Invoices, Equipment, Calendar
 */
'use strict';

const { api, assert, assertOk, assertStatus, assertForbidden,
        assertArray, assertHasFields, assertMatch,
        skip, TEST_USERS } = require('../config');

module.exports = {
  name: 'BLOCK 6 — FIELD VALIDATION',
  tests: [
    // ═══════════════════════════════════════════════
    // 6.1 Tenders
    // ═══════════════════════════════════════════════
    {
      name: '6.1.1 Tender: customer required',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { tender_type: 'Аукцион', tender_status: 'Новый' }
        });
        assertStatus(resp, 400, 'missing customer');
      }
    },
    {
      name: '6.1.2 Tender: empty customer → 400',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: '   ', tender_type: 'Аукцион' }
        });
        assertStatus(resp, 400, 'empty customer');
      }
    },
    {
      name: '6.1.3 Tender: valid creation with all fields',
      run: async () => {
        // Create customer first to satisfy FK constraint on customer_inn
        const testInn = '77' + Date.now().toString().slice(-8);
        await api('POST', '/api/customers', {
          role: 'ADMIN',
          body: { inn: testInn, name: 'ООО Валидация FK Test' }
        });

        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: {
            customer: 'ООО "Валидация"',
            customer_inn: testInn,
            tender_type: 'Прямой запрос',
            tender_status: 'Новый',
            deadline: '2026-06-01',
            estimated_sum: 2000000,
            tag: 'test-validation'
          }
        });
        assertOk(resp, 'full tender');
        const t = resp.data?.tender || resp.data;
        assert(t.id, 'has id');

        // Cleanup
        await api('DELETE', `/api/customers/${testInn}`, { role: 'ADMIN' }).catch(() => {});
      }
    },
    {
      name: '6.1.4 Tender: special characters in fields preserved',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: {
            customer: 'ООО "Кавычки & <Теги>"',
            tender_type: 'Запрос котировок',
            tender_status: 'Новый'
          }
        });
        assertOk(resp, 'special chars');
        const t = resp.data?.tender || resp.data;
        assert(t.customer_name?.includes('&') || t.customer?.includes('&'), 'ampersand preserved');
      }
    },
    {
      name: '6.1.5 Tender: past deadline acceptable',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: {
            customer: 'Past deadline test',
            deadline: '2020-01-01',
            tender_status: 'Новый'
          }
        });
        assertOk(resp, 'past deadline ok');
      }
    },

    // ═══════════════════════════════════════════════
    // 6.2 Works
    // ═══════════════════════════════════════════════
    {
      name: '6.2.1 Work: work_title required',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_status: 'В работе' }
        });
        assertStatus(resp, 400, 'missing work_title');
      }
    },
    {
      name: '6.2.2 Work: empty work_title → 400',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: '  ' }
        });
        assertStatus(resp, 400, 'empty work_title');
      }
    },
    {
      name: '6.2.3 Work: valid creation',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: {
            work_title: 'Validation Work',
            work_status: 'Подготовка',
            contract_value: 500000,
            start_plan: '2026-03-01',
            end_plan: '2026-06-01'
          }
        });
        assertOk(resp, 'create work');
      }
    },
    {
      name: '6.2.4 Work: numeric contract_value accepted',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'Value test', contract_value: 1500000.50 }
        });
        assertOk(resp, 'decimal value');
      }
    },

    // ═══════════════════════════════════════════════
    // 6.3 Employees
    // ═══════════════════════════════════════════════
    {
      name: '6.3.1 Employee: fio required',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'HR',
          body: { phone: '+79001234567' }
        });
        assertStatus(resp, 400, 'missing fio');
      }
    },
    {
      name: '6.3.2 Employee: full valid creation',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'HR',
          body: {
            fio: 'Тестов Тест Тестович',
            phone: '+79001234567',
            email: 'testov@test.ru',
            birth_date: '1990-05-15',
            position: 'Инженер',
            department: 'Производство',
            is_active: true
          }
        });
        assertOk(resp, 'create employee');
        const emp = resp.data?.employee || resp.data;
        assert(emp.id, 'employee id');
      }
    },
    {
      name: '6.3.3 Employee review with score_1_10',
      run: async () => {
        // Get any employee ID
        const list = await api('GET', '/api/staff/employees?limit=1', { role: 'PM' });
        assertOk(list, 'get employees');
        const employees = list.data?.employees || list.data;
        if (!employees || employees.length === 0) skip('No employees');
        const empId = employees[0].id;

        const resp = await api('POST', `/api/staff/employees/${empId}/review`, {
          role: 'PM',
          body: { score_1_10: 8, comment: 'Хорошая работа на объекте' }
        });
        assertOk(resp, 'add review');
        const review = resp.data?.review || resp.data;
        assert(review.id, 'review id');
      }
    },
    {
      name: '6.3.4 Employee: GET detail + reviews',
      run: async () => {
        const list = await api('GET', '/api/staff/employees?limit=1', { role: 'PM' });
        const employees = list.data?.employees || list.data;
        if (!employees || employees.length === 0) skip('No employees');
        const resp = await api('GET', `/api/staff/employees/${employees[0].id}`, { role: 'PM' });
        assertOk(resp, 'employee detail');
        assertHasFields(resp.data, ['employee', 'reviews'], 'detail fields');
      }
    },

    // ═══════════════════════════════════════════════
    // 6.4 Invoices
    // ═══════════════════════════════════════════════
    {
      name: '6.4.1 Invoice: all required fields',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'PM',
          body: { description: 'Missing required fields' }
        });
        assertStatus(resp, 400, 'missing invoice fields');
      }
    },
    {
      name: '6.4.2 Invoice: valid creation with VAT',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'PM',
          body: {
            invoice_number: `VAL-INV-${Date.now()}`,
            invoice_date: '2026-02-10',
            amount: 200000,
            vat_pct: 20,
            customer_name: 'ООО "Тест"',
            due_date: '2026-03-10'
          }
        });
        assertOk(resp, 'create with VAT');
      }
    },
    {
      name: '6.4.3 Invoice: payment updates status to partial',
      run: async () => {
        const create = await api('POST', '/api/invoices', {
          role: 'PM',
          body: {
            invoice_number: `PAY-TEST-${Date.now()}`,
            invoice_date: '2026-02-10',
            amount: 100000,
            total_amount: 120000
          }
        });
        assertOk(create, 'create invoice');
        const id = (create.data?.invoice || create.data)?.id;
        assert(id, 'invoice id');

        const pay = await api('POST', `/api/invoices/${id}/payments`, {
          role: 'PM',
          body: { amount: 50000, payment_date: '2026-02-11' }
        });
        assertOk(pay, 'add payment');
        assertMatch(pay.data, { new_status: 'partial' }, 'partial status');
      }
    },

    // ═══════════════════════════════════════════════
    // 6.5 Equipment
    // ═══════════════════════════════════════════════
    {
      name: '6.5.1 Equipment: create with required fields',
      run: async () => {
        // Get category — create one if none exist
        const cats = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        assertOk(cats, 'get categories');
        let categories = cats.data?.categories || cats.data;
        let catId;
        if (!categories || !categories.length) {
          const newCat = await api('POST', '/api/data/equipment_categories', {
            role: 'ADMIN', body: { name: 'TEST_FV_' + Date.now() }
          });
          if (!newCat.ok) skip('No equipment categories');
          catId = (newCat.data?.item || newCat.data)?.id;
        } else {
          catId = categories[0].id;
        }

        const resp = await api('POST', '/api/equipment', {
          role: 'ADMIN',
          body: {
            name: 'Тестовый прибор',
            category_id: catId,
            serial_number: `SN-TEST-${Date.now()}`,
            purchase_price: 50000,
            brand: 'TestBrand',
            model: 'TM-100'
          }
        });
        assertOk(resp, 'create equipment');
        const eq = resp.data?.equipment || resp.data;
        assert(eq.id, 'equipment id');
        assert(eq.inventory_number, 'auto inventory_number');
      }
    },
    {
      name: '6.5.2 Equipment: GET list with stats',
      run: async () => {
        const resp = await api('GET', '/api/equipment?limit=5', { role: 'ADMIN' });
        assertOk(resp, 'equipment list');
        assertHasFields(resp.data, ['equipment', 'stats'], 'list fields');
      }
    },
    {
      name: '6.5.3 Equipment: search by name',
      run: async () => {
        const resp = await api('GET', '/api/equipment?search=тест&limit=5', { role: 'ADMIN' });
        assertOk(resp, 'search equipment');
      }
    },
    {
      name: '6.5.4 Equipment: write-off needs reason (min 5 chars)',
      run: async () => {
        const list = await api('GET', '/api/equipment?limit=1', { role: 'ADMIN' });
        const items = list.data?.equipment || [];
        if (!items.length) skip('No equipment');
        const resp = await api('POST', '/api/equipment/write-off', {
          role: 'ADMIN',
          body: { equipment_id: items[0].id, reason: 'ab' }
        });
        assertStatus(resp, 400, 'short reason');
      }
    },

    // ═══════════════════════════════════════════════
    // 6.6 Calendar
    // ═══════════════════════════════════════════════
    {
      name: '6.6.1 Calendar: title and date required',
      run: async () => {
        const resp = await api('POST', '/api/calendar', {
          role: 'PM',
          body: { description: 'No title or date' }
        });
        assertStatus(resp, 400, 'missing title/date');
      }
    },
    {
      name: '6.6.2 Calendar: invalid date → 400',
      run: async () => {
        const resp = await api('POST', '/api/calendar', {
          role: 'PM',
          body: { title: 'Bad date event', date: 'not-a-date' }
        });
        assertStatus(resp, 400, 'invalid date');
      }
    },
    {
      name: '6.6.3 Calendar: valid event creation',
      run: async () => {
        const resp = await api('POST', '/api/calendar', {
          role: 'PM',
          body: {
            title: 'Тестовое событие',
            date: '2026-03-15',
            time: '10:00',
            end_date: '2026-03-15',
            end_time: '11:00',
            type: 'meeting',
            location: 'Офис'
          }
        });
        assertOk(resp, 'create event');
        const ev = resp.data?.event || resp.data;
        assert(ev.id, 'event id');
      }
    },
    {
      name: '6.6.4 Calendar: GET events list',
      run: async () => {
        const resp = await api('GET', '/api/calendar?date_from=2026-01-01&date_to=2026-12-31', { role: 'PM' });
        assertOk(resp, 'list events');
        assertHasFields(resp.data, ['events'], 'events field');
      }
    },
    {
      name: '6.6.5 Calendar: owner can update',
      run: async () => {
        const create = await api('POST', '/api/calendar', {
          role: 'PM',
          body: { title: 'Update test', date: '2026-04-01' }
        });
        assertOk(create, 'create');
        const id = (create.data?.event || create.data)?.id;
        const resp = await api('PUT', `/api/calendar/${id}`, {
          role: 'PM',
          body: { title: 'Updated title' }
        });
        assertOk(resp, 'update event');
      }
    },
    {
      name: '6.6.6 Calendar: owner can delete',
      run: async () => {
        const create = await api('POST', '/api/calendar', {
          role: 'PM',
          body: { title: 'Delete me', date: '2026-04-01' }
        });
        assertOk(create, 'create');
        const id = (create.data?.event || create.data)?.id;
        const resp = await api('DELETE', `/api/calendar/${id}`, { role: 'PM' });
        assertOk(resp, 'delete event');
      }
    },

    // ═══════════════════════════════════════════════
    // 6.7 Staff schedule
    // ═══════════════════════════════════════════════
    {
      name: '6.7.1 Schedule: create entry',
      run: async () => {
        const list = await api('GET', '/api/staff/employees?limit=1', { role: 'PM' });
        const employees = list.data?.employees || list.data;
        if (!employees || !employees.length) skip('No employees');

        const resp = await api('POST', '/api/staff/schedule', {
          role: 'PM',
          body: {
            employee_id: employees[0].id,
            date: '2026-03-01',
            shift_type: 'day',
            hours: 8,
            object_name: 'Объект тестовый'
          }
        });
        assertOk(resp, 'create schedule');
      }
    },
    {
      name: '6.7.2 Schedule: GET with date filter',
      run: async () => {
        const resp = await api('GET', '/api/staff/schedule?date_from=2026-03-01&date_to=2026-03-31', { role: 'PM' });
        assertOk(resp, 'filter schedule');
        assertHasFields(resp.data, ['schedule'], 'schedule field');
      }
    },

    // ═══════════════════════════════════════════════
    // 6.8 Estimates validation
    // ═══════════════════════════════════════════════
    {
      name: '6.8.1 Estimate: title required',
      run: async () => {
        const resp = await api('POST', '/api/estimates', {
          role: 'PM',
          body: { amount: 100000 }
        });
        assertStatus(resp, 400, 'missing title');
      }
    },
    {
      name: '6.8.2 Estimate: valid with all fields',
      run: async () => {
        const resp = await api('POST', '/api/estimates', {
          role: 'PM',
          body: {
            title: 'Validation estimate',
            amount: 750000,
            cost: 500000,
            margin: 250000,
            description: 'Full validation',
            work_type: 'Строительство',
            priority: 'high'
          }
        });
        assertOk(resp, 'full estimate');
      }
    },

    // ═══════════════════════════════════════════════
    // 6.9 Cash validation edge cases
    // ═══════════════════════════════════════════════
    {
      name: '6.9.1 Cash: missing purpose → 400',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'PM',
          body: { amount: 5000, type: 'other' }
        });
        assertStatus(resp, 400, 'missing purpose');
      }
    },
    {
      name: '6.9.2 Cash: advance type requires work_id',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'PM',
          body: { amount: 5000, purpose: 'Test', type: 'advance' }
        });
        // Should be 400 because advance type needs work_id
        assertStatus(resp, 400, 'advance needs work_id');
      }
    },

    // ═══════════════════════════════════════════════
    // 6.10 Customers
    // ═══════════════════════════════════════════════
    {
      name: '6.10.1 Customers: GET list',
      run: async () => {
        const resp = await api('GET', '/api/customers', { role: 'PM' });
        assertOk(resp, 'list customers');
      }
    }
  ]
};
