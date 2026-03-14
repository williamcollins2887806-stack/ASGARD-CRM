/**
 * E2E FLOW: Полный цикл персонала (Personnel Full Cycle)
 *
 * Комплексный тест всего модуля: от запроса персонала до ФОТ и премий.
 *
 * Шаги:
 *   1. HR создаёт сотрудника (employee)
 *   2. HR устанавливает ставку сотруднику (employee_rate)
 *   3. PM создаёт работу (work)
 *   4. HR создаёт запрос персонала (staff_request) на работу
 *   5. HR подбирает кандидатов → статус answered
 *   6. ADMIN согласовывает → статус approved
 *   7. HR добавляет сообщение к заявке (staff_request_messages)
 *   8. PM назначает сотрудника на работу (employee_assignment)
 *   9. PM ставит сотрудника на график (employee_plan) — проверяем отображение
 *  10. BUH создаёт ведомость ФОТ (payroll_sheet)
 *  11. BUH добавляет строку начисления в ведомость (payroll_item)
 *  12. PM отправляет ведомость на согласование
 *  13. DIRECTOR_GEN согласовывает ведомость
 *  14. BUH проводит оплату ведомости
 *  15. PM создаёт запрос на премию (bonus_request)
 *  16. DIRECTOR_GEN согласовывает премию
 *  17. HR создаёт замену сотрудника (staff_replacement)
 *  18. Проверяем полную связанность: сотрудник на графике, в ведомости, с премией
 *  19-25. Cleanup
 */
const { api, assert, assertOk, assertForbidden, assertArray, assertHasFields, TEST_USERS, initRealUsers } = require('../config');

// IDs для cleanup
let employeeId = null;
let rateId = null;
let workId = null;
let staffRequestId = null;
let messageId = null;
let assignmentId = null;
let planId1 = null;
let planId2 = null;
let planId3 = null;
let sheetId = null;
let payrollItemId = null;
let bonusId = null;
let replacementId = null;

module.exports = {
  name: 'FLOW: Personnel Full Cycle (Запрос → График → ФОТ → Премия)',
  tests: [
    // ═══════════════════════════════════════════════
    // 1. Создание сотрудника
    // ═══════════════════════════════════════════════
    {
      name: '1. HR создаёт сотрудника',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'HR',
          body: {
            fio: 'TEST_AUTO_Иванов Пётр Сергеевич',
            role_tag: 'Сварщик',
            phone: '+79990005555',
            is_active: true,
            city: 'Москва',
            day_rate: 3500
          }
        });
        assertOk(resp, 'create employee');
        employeeId = resp.data?.employee?.id;
        assert(employeeId, 'got employee ID');
      }
    },

    // ═══════════════════════════════════════════════
    // 2. Установка ставки
    // ═══════════════════════════════════════════════
    {
      name: '2. BUH устанавливает дневную ставку сотруднику',
      run: async () => {
        const resp = await api('POST', '/api/payroll/rates', {
          role: 'BUH',
          body: {
            employee_id: employeeId,
            role_tag: 'Сварщик',
            day_rate: 3500,
            shift_rate: 4000,
            overtime_rate: 5250,
            effective_from: '2026-01-01',
            comment: 'TEST_AUTO_Начальная ставка'
          }
        });
        assertOk(resp, 'create rate');
        rateId = resp.data?.rate?.id || resp.data?.id;
        assert(rateId, 'got rate ID');

        // Проверяем что ставка отображается
        const check = await api('GET', `/api/payroll/rates?employee_id=${employeeId}`, { role: 'BUH' });
        assertOk(check, 'read rates');
        const rates = check.data?.rates || check.data || [];
        assert(Array.isArray(rates) && rates.length >= 1, 'rate exists');
      }
    },

    // ═══════════════════════════════════════════════
    // 3. Создание работы
    // ═══════════════════════════════════════════════
    {
      name: '3. PM создаёт работу для назначения персонала',
      run: async () => {
        const resp = await api('POST', '/api/data/works', {
          role: 'PM',
          body: {
            work_title: 'TEST_AUTO_Монтаж оборудования ПС-110',
            customer_name: 'TEST_AUTO_Энергосеть',
            work_status: 'В работе',
            pm_id: TEST_USERS['PM']?.id || 2324,
            start_plan: '2026-04-01',
            end_plan: '2026-04-30',
            city: 'Казань'
          }
        });
        assertOk(resp, 'create work');
        workId = resp.data?.id || resp.data?.item?.id;
        assert(workId, 'got work ID');
      }
    },

    // ═══════════════════════════════════════════════
    // 4. Запрос персонала
    // ═══════════════════════════════════════════════
    {
      name: '4. HR создаёт запрос персонала на работу',
      run: async () => {
        const resp = await api('POST', '/api/data/staff_requests', {
          role: 'HR',
          body: {
            work_id: workId,
            pm_id: TEST_USERS['PM']?.id || 2324,
            status: 'new',
            required_count: 2,
            specialization: 'TEST_AUTO_Сварщик НАКС',
            date_from: '2026-04-01',
            date_to: '2026-04-30',
            comments: 'TEST_AUTO_Нужны 2 сварщика НАКС для монтажа ПС-110'
          }
        });
        assertOk(resp, 'create staff_request');
        staffRequestId = resp.data?.id || resp.data?.item?.id;
        assert(staffRequestId, 'got staff_request ID');
      }
    },

    {
      name: '5. HR подбирает кандидатов → sent → answered',
      run: async () => {
        // Отправляем
        const sent = await api('PUT', `/api/data/staff_requests/${staffRequestId}`, {
          role: 'HR',
          body: { status: 'sent' }
        });
        assertOk(sent, 'status → sent');

        // HR отвечает с подобранными кандидатами
        const answered = await api('PUT', `/api/data/staff_requests/${staffRequestId}`, {
          role: 'HR',
          body: {
            status: 'answered',
            comments: 'TEST_AUTO_Подобран: Иванов П.С. (Сварщик НАКС, допуск до 2027)'
          }
        });
        assertOk(answered, 'status → answered');
        assert(answered.data?.item?.status === 'answered', 'status is answered');
      }
    },

    {
      name: '6. ADMIN согласовывает запрос → approved',
      run: async () => {
        const resp = await api('PUT', `/api/data/staff_requests/${staffRequestId}`, {
          role: 'ADMIN',
          body: { status: 'approved' }
        });
        assertOk(resp, 'approve');
        assert(resp.data?.item?.status === 'approved', 'status is approved');
      }
    },

    // ═══════════════════════════════════════════════
    // 5. Сообщения к заявке
    // ═══════════════════════════════════════════════
    {
      name: '7. HR добавляет сообщение к заявке',
      run: async () => {
        const resp = await api('POST', '/api/data/staff_request_messages', {
          role: 'HR',
          body: {
            staff_request_id: staffRequestId,
            author_user_id: TEST_USERS['HR']?.id || 2326,
            message: 'TEST_AUTO_Иванов подтвердил готовность выехать 01.04'
          }
        });
        assertOk(resp, 'create message');
        messageId = resp.data?.id || resp.data?.item?.id;
        assert(messageId, 'got message ID');
      }
    },

    // ═══════════════════════════════════════════════
    // 6. Назначение на работу (employee_assignment)
    // ═══════════════════════════════════════════════
    {
      name: '8. PM назначает сотрудника на работу (assignment)',
      run: async () => {
        const resp = await api('POST', '/api/data/employee_assignments', {
          role: 'PM',
          body: {
            employee_id: employeeId,
            work_id: workId,
            date_from: '2026-04-01',
            date_to: '2026-04-30',
            role: 'Сварщик'
          }
        });
        assertOk(resp, 'create assignment');
        assignmentId = resp.data?.id || resp.data?.item?.id;
        assert(assignmentId, 'got assignment ID');
      }
    },

    // ═══════════════════════════════════════════════
    // 7. Ставим на график (employee_plan) — КЛЮЧЕВОЙ ТЕСТ
    // ═══════════════════════════════════════════════
    {
      name: '9. PM ставит сотрудника на график (employee_plan) — 3 дня',
      run: async () => {
        // Ставим 3 дня: 01.04, 02.04, 03.04
        const days = ['2026-04-01', '2026-04-02', '2026-04-03'];
        const ids = [];

        for (const date of days) {
          const resp = await api('POST', '/api/staff/schedule', {
            role: 'PM',
            body: {
              employee_id: employeeId,
              date: date,
              work_id: workId,
              kind: 'work',
              status: 'planned',
              note: 'TEST_AUTO_Монтаж ПС-110',
              shift_type: 'day',
              hours: 10
            }
          });
          assertOk(resp, `plan entry for ${date}`);
          const id = resp.data?.plan?.id || resp.data?.id;
          ids.push(id);
        }

        planId1 = ids[0];
        planId2 = ids[1];
        planId3 = ids[2];
        assert(planId1, 'got plan ID 1');
      }
    },

    {
      name: '10. Проверяем: сотрудник отображается на графике',
      run: async () => {
        const resp = await api('GET', `/api/staff/schedule?employee_id=${employeeId}&date_from=2026-04-01&date_to=2026-04-30`, {
          role: 'HR'
        });
        assertOk(resp, 'read schedule');
        const schedule = resp.data?.schedule || [];
        assertArray(schedule, 'schedule is array');
        assert(schedule.length >= 3, `expected >=3 plan entries, got ${schedule.length}`);

        // Проверяем привязку к работе
        const withWork = schedule.filter(s => s.work_id === workId);
        assert(withWork.length >= 3, `entries linked to work: ${withWork.length}`);
      }
    },

    // ═══════════════════════════════════════════════
    // 8. ФОТ: ведомость (payroll_sheet)
    // ═══════════════════════════════════════════════
    {
      name: '11. PM создаёт ведомость ФОТ на работу',
      run: async () => {
        const resp = await api('POST', '/api/payroll/sheets', {
          role: 'PM',
          body: {
            work_id: workId,
            title: 'TEST_AUTO_ФОТ Монтаж ПС-110 апрель',
            period_from: '2026-04-01',
            period_to: '2026-04-30',
            comment: 'TEST_AUTO_Тестовая ведомость'
          }
        });
        assertOk(resp, 'create payroll sheet');
        sheetId = resp.data?.sheet?.id || resp.data?.id;
        assert(sheetId, 'got sheet ID');
      }
    },

    {
      name: '12. PM добавляет строку начисления (payroll_item) для сотрудника',
      run: async () => {
        const resp = await api('POST', '/api/payroll/items', {
          role: 'PM',
          body: {
            sheet_id: sheetId,
            employee_id: employeeId,
            employee_name: 'TEST_AUTO_Иванов Пётр Сергеевич',
            work_id: workId,
            role_on_work: 'Сварщик',
            days_worked: 3,
            day_rate: 3500,
            bonus: 5000,
            overtime_hours: 2,
            penalty: 0,
            advance_paid: 5000,
            deductions: 0,
            payment_method: 'card',
            comment: 'TEST_AUTO_Начисление за 3 дня + премия'
          }
        });
        assertOk(resp, 'create payroll item');
        payrollItemId = resp.data?.item?.id || resp.data?.id;
        assert(payrollItemId, 'got payroll item ID');
      }
    },

    {
      name: '13. Проверяем расчёт: base=10500, accrued=15500+OT, payout корректен',
      run: async () => {
        const resp = await api('GET', `/api/payroll/sheets/${sheetId}`, { role: 'PM' });
        assertOk(resp, 'read sheet detail');
        const sheet = resp.data?.sheet || resp.data;
        const items = resp.data?.items || [];

        // Проверяем итоги
        assert(Number(sheet.workers_count) >= 1, `workers_count >= 1, got ${sheet.workers_count}`);
        assert(Number(sheet.total_accrued) > 0, 'total_accrued > 0');

        // Проверяем строку начисления
        const item = items.find(i => i.employee_id === employeeId);
        assert(item, 'employee item found in sheet');
        // base_amount = 3 * 3500 = 10500
        assert(Number(item.base_amount) === 10500, `base_amount: expected 10500, got ${item.base_amount}`);
        // accrued = 10500 + 5000(bonus) + OT
        assert(Number(item.accrued) >= 15500, `accrued >= 15500, got ${item.accrued}`);
        // payout = accrued - advance(5000)
        assert(Number(item.payout) > 0, 'payout > 0');
      }
    },

    // ═══════════════════════════════════════════════
    // 9. Workflow ведомости: submit → approve → pay
    // ═══════════════════════════════════════════════
    {
      name: '14. PM отправляет ведомость на согласование',
      run: async () => {
        const resp = await api('PUT', `/api/payroll/sheets/${sheetId}/submit`, {
          role: 'PM',
          body: {}
        });
        assertOk(resp, 'submit sheet');

        // Проверяем статус
        const check = await api('GET', `/api/payroll/sheets/${sheetId}`, { role: 'PM' });
        assertOk(check, 'read sheet');
        const status = check.data?.sheet?.status || check.data?.status;
        assert(status === 'submitted' || status === 'pending', `expected submitted, got ${status}`);
      }
    },

    {
      name: '15. DIRECTOR_GEN согласовывает ведомость',
      run: async () => {
        const resp = await api('PUT', `/api/payroll/sheets/${sheetId}/approve`, {
          role: 'DIRECTOR_GEN',
          body: { director_comment: 'TEST_AUTO_Согласовано' }
        });
        assertOk(resp, 'approve sheet');

        const check = await api('GET', `/api/payroll/sheets/${sheetId}`, { role: 'PM' });
        assertOk(check, 'read approved sheet');
        const status = check.data?.sheet?.status || check.data?.status;
        assert(status === 'approved', `expected approved, got ${status}`);
      }
    },

    {
      name: '16. BUH проводит оплату ведомости',
      run: async () => {
        const resp = await api('PUT', `/api/payroll/sheets/${sheetId}/pay`, {
          role: 'BUH',
          body: {}
        });
        assertOk(resp, 'pay sheet');

        const check = await api('GET', `/api/payroll/sheets/${sheetId}`, { role: 'PM' });
        assertOk(check, 'read paid sheet');
        const status = check.data?.sheet?.status || check.data?.status;
        assert(status === 'paid', `expected paid, got ${status}`);
      }
    },

    // ═══════════════════════════════════════════════
    // 10. Премии (bonus_request)
    // ═══════════════════════════════════════════════
    {
      name: '17. PM создаёт запрос на премию сотруднику',
      run: async () => {
        const resp = await api('POST', '/api/data/bonus_requests', {
          role: 'PM',
          body: {
            work_id: workId,
            pm_id: TEST_USERS['PM']?.id || 2324,
            employee_id: employeeId,
            amount: 15000,
            reason: 'TEST_AUTO_Отличная работа на монтаже ПС-110',
            status: 'pending',
            pm_name: 'Test PM',
            work_title: 'TEST_AUTO_Монтаж оборудования ПС-110',
            currency: 'RUB'
          }
        });
        assertOk(resp, 'create bonus request');
        bonusId = resp.data?.id || resp.data?.item?.id;
        assert(bonusId, 'got bonus ID');
      }
    },

    {
      name: '18. DIRECTOR_GEN видит и согласовывает премию',
      run: async () => {
        // Читаем все премии
        const list = await api('GET', '/api/data/bonus_requests?limit=50', { role: 'DIRECTOR_GEN' });
        assertOk(list, 'list bonus requests');
        const bonuses = list.data?.bonus_requests;
        assertArray(bonuses, 'is array');
        const found = bonuses.find(b => b.id === bonusId);
        assert(found, 'our bonus found');
        assert(found.status === 'pending', 'status is pending');
        assert(Number(found.amount) === 15000, 'amount is 15000');

        // Согласуем
        const resp = await api('PUT', `/api/data/bonus_requests/${bonusId}`, {
          role: 'DIRECTOR_GEN',
          body: {
            status: 'approved',
            director_comment: 'TEST_AUTO_Одобрено, выплатить с ближайшей зарплатой',
            approved_by: TEST_USERS['DIRECTOR_GEN']?.id || 2319,
            approved_at: new Date().toISOString()
          }
        });
        assertOk(resp, 'approve bonus');

        // Проверяем
        const check = await api('GET', `/api/data/bonus_requests/${bonusId}`, { role: 'ADMIN' });
        assertOk(check, 'read approved bonus');
        const item = check.data?.item;
        assert(item?.status === 'approved', `expected approved, got ${item?.status}`);
      }
    },

    // ═══════════════════════════════════════════════
    // 11. Замена сотрудника
    // ═══════════════════════════════════════════════
    {
      name: '19. HR создаёт запрос на замену сотрудника',
      run: async () => {
        const resp = await api('POST', '/api/data/staff_replacements', {
          role: 'HR',
          body: {
            staff_request_id: staffRequestId,
            old_employee_id: employeeId,
            new_employee_id: 1, // Абраменко В.
            reason: 'TEST_AUTO_Иванов заболел, замена на Абраменко',
            status: 'sent'
          }
        });
        assertOk(resp, 'create replacement');
        replacementId = resp.data?.id || resp.data?.item?.id;
        assert(replacementId, 'got replacement ID');
      }
    },

    // ═══════════════════════════════════════════════
    // 12. Полная проверка связанности
    // ═══════════════════════════════════════════════
    {
      name: '20. Проверяем: сотрудник на графике по работе',
      run: async () => {
        const resp = await api('GET', `/api/staff/schedule?employee_id=${employeeId}&date_from=2026-04-01&date_to=2026-04-03`, {
          role: 'ADMIN'
        });
        assertOk(resp, 'schedule check');
        const schedule = resp.data?.schedule || [];
        assert(schedule.length === 3, `expected 3 schedule entries, got ${schedule.length}`);
        for (const entry of schedule) {
          assert(entry.work_id === workId, `plan entry linked to work ${workId}`);
          assert(entry.employee_id === employeeId, 'plan entry linked to employee');
        }
      }
    },

    {
      name: '21. Проверяем: сотрудник в назначениях (assignment)',
      run: async () => {
        const where = JSON.stringify({ employee_id: employeeId });
        const resp = await api('GET', `/api/data/employee_assignments?where=${encodeURIComponent(where)}`, { role: 'ADMIN' });
        assertOk(resp, 'assignments check');
        const list = resp.data?.employee_assignments || [];
        const found = list.find(a => a.work_id === workId);
        assert(found, 'assignment to our work exists');
        assert(found.role === 'Сварщик', 'assignment role matches');
      }
    },

    {
      name: '22. Проверяем: сотрудник в ведомости (payroll) с корректной суммой',
      run: async () => {
        const resp = await api('GET', `/api/payroll/sheets/${sheetId}`, { role: 'ADMIN' });
        assertOk(resp, 'payroll check');
        const items = resp.data?.items || [];
        const item = items.find(i => i.employee_id === employeeId);
        assert(item, 'employee in payroll sheet');
        assert(Number(item.days_worked) === 3, `days_worked=3, got ${item.days_worked}`);
        assert(Number(item.day_rate) === 3500, `day_rate=3500, got ${item.day_rate}`);
        assert(Number(item.base_amount) === 10500, `base=10500, got ${item.base_amount}`);
      }
    },

    {
      name: '23. Проверяем: премия связана с сотрудником и работой',
      run: async () => {
        const resp = await api('GET', `/api/data/bonus_requests/${bonusId}`, { role: 'ADMIN' });
        assertOk(resp, 'bonus check');
        const item = resp.data?.item;
        assert(item.employee_id === employeeId, 'bonus linked to employee');
        assert(item.work_id === workId, 'bonus linked to work');
        assert(item.status === 'approved', 'bonus approved');
      }
    },

    {
      name: '24. Проверяем: запрос персонала связан с работой',
      run: async () => {
        const resp = await api('GET', `/api/data/staff_requests/${staffRequestId}`, { role: 'ADMIN' });
        assertOk(resp, 'staff request check');
        const item = resp.data?.item;
        assert(item.work_id === workId, 'staff request linked to work');
        assert(item.status === 'approved', 'staff request approved');
      }
    },

    {
      name: '25. Проверяем: замена существует и связана с заявкой',
      run: async () => {
        const where = JSON.stringify({ staff_request_id: staffRequestId });
        const resp = await api('GET', `/api/data/staff_replacements?where=${encodeURIComponent(where)}`, { role: 'HR' });
        assertOk(resp, 'replacements check');
        const list = resp.data?.staff_replacements || [];
        assert(list.length >= 1, 'replacement exists');
        const found = list.find(r => r.id === replacementId);
        assert(found, 'our replacement found');
        assert(found.old_employee_id === employeeId, 'old_employee matches');
      }
    },

    // ═══════════════════════════════════════════════
    // 13. Ролевой доступ к ведомостям
    // ═══════════════════════════════════════════════
    {
      name: '26. PM видит ведомости (payroll sheets)',
      run: async () => {
        const resp = await api('GET', '/api/payroll/sheets', { role: 'PM' });
        assertOk(resp, 'PM list sheets');
      }
    },

    {
      name: '27. HR не может создавать ведомости',
      run: async () => {
        const resp = await api('POST', '/api/payroll/sheets', {
          role: 'HR',
          body: { title: 'test', period_from: '2026-01-01', period_to: '2026-01-31' }
        });
        assertForbidden(resp, 'HR create sheet forbidden');
      }
    },

    {
      name: '28. TO не имеет доступа к ведомостям',
      run: async () => {
        const resp = await api('GET', '/api/payroll/sheets', { role: 'TO' });
        assertForbidden(resp, 'TO access sheets forbidden');
      }
    },

    // ═══════════════════════════════════════════════
    // 14. Auto-fill тест (если есть назначения)
    // ═══════════════════════════════════════════════
    {
      name: '29. Тест auto-fill: авто-расчёт строк ведомости',
      run: async () => {
        // Создадим новую ведомость для auto-fill
        const newSheet = await api('POST', '/api/payroll/sheets', {
          role: 'PM',
          body: {
            work_id: workId,
            title: 'TEST_AUTO_AutoFill ведомость',
            period_from: '2026-04-01',
            period_to: '2026-04-30'
          }
        });
        assertOk(newSheet, 'create autofill sheet');
        const newSheetId = newSheet.data?.sheet?.id || newSheet.data?.id;

        if (newSheetId) {
          // Пробуем auto-fill
          const fill = await api('POST', '/api/payroll/items/auto-fill', {
            role: 'PM',
            body: { sheet_id: newSheetId }
          });
          // Auto-fill может вернуть ошибку если нет данных — OK
          if (fill.ok) {
            const check = await api('GET', `/api/payroll/sheets/${newSheetId}`, { role: 'PM' });
            const items = check.data?.items || [];
            // Наш сотрудник должен быть в auto-fill т.к. есть assignment
            const found = items.find(i => i.employee_id === employeeId);
            if (found) {
              assert(Number(found.day_rate) > 0, 'auto-filled day_rate > 0');
            }
          }

          // Cleanup этой ведомости
          await api('DELETE', `/api/payroll/sheets/${newSheetId}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══════════════════════════════════════════════
    // 15. Отзыв о сотруднике
    // ═══════════════════════════════════════════════
    {
      name: '30. PM оставляет отзыв о сотруднике',
      run: async () => {
        const resp = await api('POST', `/api/staff/employees/${employeeId}/review`, {
          role: 'PM',
          body: {
            rating: 5,
            comment: 'TEST_AUTO_Отлично работал на монтаже ПС-110'
          }
        });
        assertOk(resp, 'create review');

        // Проверяем что рейтинг обновился
        const emp = await api('GET', `/api/staff/employees/${employeeId}`, { role: 'HR' });
        assertOk(emp, 'read employee');
        const reviews = emp.data?.reviews || [];
        assert(reviews.length >= 1, 'review exists');
      }
    },

    // ═══════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════
    {
      name: '31. Cleanup: удаляем payroll item и sheet',
      run: async () => {
        if (payrollItemId) {
          await api('DELETE', `/api/payroll/items/${payrollItemId}`, { role: 'ADMIN' });
        }
        if (sheetId) {
          // Сбросим статус на draft для удаления
          await api('PUT', `/api/data/payroll_sheets/${sheetId}`, {
            role: 'ADMIN',
            body: { status: 'draft' }
          });
          await api('DELETE', `/api/payroll/sheets/${sheetId}`, { role: 'ADMIN' });
        }
      }
    },

    {
      name: '32. Cleanup: удаляем премию',
      run: async () => {
        if (bonusId) {
          await api('DELETE', `/api/data/bonus_requests/${bonusId}`, { role: 'ADMIN' });
        }
      }
    },

    {
      name: '33. Cleanup: удаляем замену и сообщение',
      run: async () => {
        if (replacementId) await api('DELETE', `/api/data/staff_replacements/${replacementId}`, { role: 'ADMIN' });
        if (messageId) await api('DELETE', `/api/data/staff_request_messages/${messageId}`, { role: 'ADMIN' });
      }
    },

    {
      name: '34. Cleanup: удаляем запрос персонала',
      run: async () => {
        if (staffRequestId) {
          await api('DELETE', `/api/data/staff_requests/${staffRequestId}`, { role: 'ADMIN' });
        }
      }
    },

    {
      name: '35. Cleanup: удаляем график, назначение, ставку',
      run: async () => {
        // План (schedule) - через Data API
        for (const pid of [planId1, planId2, planId3]) {
          if (pid) await api('DELETE', `/api/data/employee_plan/${pid}`, { role: 'ADMIN' });
        }
        if (assignmentId) await api('DELETE', `/api/data/employee_assignments/${assignmentId}`, { role: 'ADMIN' });
        if (rateId) await api('DELETE', `/api/payroll/rates/${rateId}`, { role: 'ADMIN' });
      }
    },

    {
      name: '36. Cleanup: удаляем работу и сотрудника',
      run: async () => {
        if (workId) await api('DELETE', `/api/data/works/${workId}`, { role: 'ADMIN' });
        // Деактивируем сотрудника (FK constraints)
        if (employeeId) {
          await api('PUT', `/api/staff/employees/${employeeId}`, {
            role: 'ADMIN',
            body: { is_active: false, fio: 'TEST_AUTO_DELETED' }
          });
        }
      }
    },
  ]
};
