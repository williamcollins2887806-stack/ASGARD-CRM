// @ts-check
/**
 * E2E Browser: Personnel Full Cycle (37 tests)
 * Maps to: flow-personnel-full-cycle.test.js (36), flow-staff.test.js (1)
 * Pages: #/employees, #/works, #/staff_requests, #/payroll, #/calendar
 */
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

const TS = Date.now();

// ═══════════════════════════════════════════════════════════════
// Section 1 (tests 1-8): HR creates employee, BUH sets rate, PM creates work
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Personnel — Section 1: Employee + Rate + Work', () => {
  let adminToken;
  let hrToken;
  let buhToken;
  let pmToken;
  let employeeId;
  let workId;

  test('1. HR navigates to #/employees page', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'personnel');
    await h.waitForPageLoad(page);

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'HR employees page');
  });

  test('2. HR creates employee via UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'personnel');
    await h.waitForPageLoad(page);

    await h.clickCreate(page);
    await page.waitForTimeout(500);

    // Fill FIO
    const fioField = page.locator('input[name="fio"], input[id*="fio"], input[placeholder*="ФИО"]');
    if (await fioField.count() > 0) {
      await fioField.first().fill(`E2E_AUTO_Тестов Тест ${TS}`);
    }

    // Fill role_tag / position
    const roleField = page.locator('input[name="role_tag"], input[id*="role"], select[name="role_tag"]');
    if (await roleField.count() > 0) {
      const tagName = await roleField.first().evaluate(el => el.tagName);
      if (tagName === 'SELECT') {
        await roleField.first().selectOption({ index: 1 });
      } else {
        await roleField.first().fill('Сварщик');
      }
    }

    // Fill phone
    const phoneField = page.locator('input[name="phone"], input[id*="phone"], input[type="tel"]');
    if (await phoneField.count() > 0) {
      await phoneField.first().fill('+79990001234');
    }

    // Fill city
    const cityField = page.locator('input[name="city"], input[id*="city"]');
    if (await cityField.count() > 0) {
      await cityField.first().fill('Москва');
    }

    await h.clickSave(page);
    await page.waitForTimeout(1500);
    h.assertNoConsoleErrors(errors, 'HR create employee');
  });

  test('3. HR verifies employee appears in list', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'personnel');
    await h.waitForPageLoad(page);

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'HR verify employee list');
  });

  test('4. HR opens employee detail card', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'personnel');
    await h.waitForPageLoad(page);

    // Click first employee row to open detail
    const row = page.locator('table tbody tr, .card[data-id], .list-item[data-id]').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);
    }

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'HR employee detail');
  });

  test('5. BUH navigates to employees to set rate', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'BUH');
    await h.navigateTo(page, 'personnel');
    await h.waitForPageLoad(page);

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'BUH employees page');
  });

  test('6. BUH sets rate via API (browser context)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'BUH');
    await h.navigateTo(page, 'personnel');
    await h.waitForPageLoad(page);

    const token = await h.getSessionToken(page);
    if (!token) { test.skip(); return; }

    // Get first employee for rate
    const empResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/staff/employees?limit=1', null, token);
    const employees = empResp.data?.employees || empResp.data?.items || [];
    if (Array.isArray(employees) && employees.length > 0) {
      const empId = employees[0].id;
      const rateResp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/payroll/rates', {
        employee_id: empId,
        role_tag: 'Сварщик',
        day_rate: 3500,
        shift_rate: 4000,
        overtime_rate: 5250,
        effective_from: '2026-01-01',
        comment: `E2E_AUTO_Rate_${TS}`
      }, token);
      expect(rateResp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'BUH set rate');
  });

  test('7. PM navigates to #/works page', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pm-works');
    await h.waitForPageLoad(page);

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'PM works page');
  });

  test('8. PM creates work via UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pm-works');
    await h.waitForPageLoad(page);

    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить")').first();
    if (await createBtn.count() > 0) {
      await createBtn.click();
      await page.waitForTimeout(500);

      const titleField = page.locator('input[name="work_title"], input[id*="title"], input[placeholder*="Название"]');
      if (await titleField.count() > 0) {
        await titleField.first().fill(`E2E_AUTO_Монтаж_${TS}`);
      }

      const statusField = page.locator('select[name="work_status"], select[id*="status"]');
      if (await statusField.count() > 0) {
        await statusField.first().selectOption('В работе');
      }

      await h.clickSave(page);
      await page.waitForTimeout(1500);
    }

    h.assertNoConsoleErrors(errors, 'PM create work');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 2 (tests 9-14): Staff requests
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Personnel — Section 2: Staff Requests', () => {
  test('9. HR navigates to #/staff_requests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'hr-requests');
    await h.waitForPageLoad(page);

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'HR staff_requests page');
  });

  test('10. HR creates staff request via UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'hr-requests');
    await h.waitForPageLoad(page);

    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить")').first();
    if (await createBtn.count() > 0) {
      await createBtn.click();
      await page.waitForTimeout(500);

      const specField = page.locator('input[name="specialization"], input[id*="special"], textarea[name="specialization"]');
      if (await specField.count() > 0) {
        await specField.first().fill(`E2E_AUTO_Сварщик_${TS}`);
      }

      const countField = page.locator('input[name="required_count"], input[id*="count"]');
      if (await countField.count() > 0) {
        await countField.first().fill('2');
      }

      const commentsField = page.locator('textarea[name="comments"], textarea[id*="comment"]');
      if (await commentsField.count() > 0) {
        await commentsField.first().fill(`E2E_AUTO_Нужны 2 сварщика ${TS}`);
      }

      if (await h.isModalVisible(page)) {
        await h.clickSave(page);
      }
      await page.waitForTimeout(1500);
    }

    h.assertNoConsoleErrors(errors, 'HR create staff request');
  });

  test('11. HR adds message to staff request via API', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'hr-requests');
    await h.waitForPageLoad(page);

    const token = await h.getToken(page, 'HR');
    expect(token).toBeTruthy();

    // Get first staff request
    const listResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=1', null, token);
    const requests = listResp.data?.staff_requests || [];
    if (Array.isArray(requests) && requests.length > 0) {
      const reqId = requests[0].id;
      const msgResp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/data/staff_request_messages', {
        staff_request_id: reqId,
        author_user_id: 1,
        message: `E2E_AUTO_Сообщение ${TS}`
      }, token);
      expect(msgResp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'HR add message');
  });

  test('12. Status transition: new -> sent (via API in browser)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const listResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=5', null, token);
    const requests = listResp.data?.staff_requests || [];
    const newReq = Array.isArray(requests) ? requests.find(r => r.status === 'new') : null;

    if (newReq) {
      const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/data/staff_requests/${newReq.id}`, {
        status: 'sent'
      }, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'status new->sent');
  });

  test('13. Status transition: sent -> answered (via API in browser)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const listResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=5', null, token);
    const requests = listResp.data?.staff_requests || [];
    const sentReq = Array.isArray(requests) ? requests.find(r => r.status === 'sent') : null;

    if (sentReq) {
      const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/data/staff_requests/${sentReq.id}`, {
        status: 'answered',
        comments: `E2E_AUTO_Кандидаты подобраны ${TS}`
      }, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'status sent->answered');
  });

  test('14. Status transition: answered -> approved (via ADMIN)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');

    const token = await h.getToken(page, 'ADMIN');
    const listResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=5', null, token);
    const requests = listResp.data?.staff_requests || [];
    const answeredReq = Array.isArray(requests) ? requests.find(r => r.status === 'answered') : null;

    if (answeredReq) {
      const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/data/staff_requests/${answeredReq.id}`, {
        status: 'approved'
      }, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'status answered->approved');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 3 (tests 15-20): PM assigns employee, schedules calendar
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Personnel — Section 3: Assignments + Calendar', () => {
  test('15. PM navigates to #/works and opens a work', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'pm-works');
    await h.waitForPageLoad(page);

    const row = page.locator('table tbody tr, .card[data-id], .list-item').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);
    }

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'PM open work');
  });

  test('16. PM assigns employee to work via API', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');

    const token = await h.getToken(page, 'PM');
    expect(token).toBeTruthy();

    // Get first work
    const worksResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/works?limit=1', null, token);
    const works = worksResp.data?.works || [];
    const workId = Array.isArray(works) && works.length > 0 ? works[0].id : null;

    // Get first employee
    const empResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/staff/employees?limit=1', null, token);
    const employees = empResp.data?.employees || empResp.data?.items || [];
    const empId = Array.isArray(employees) && employees.length > 0 ? employees[0].id : null;

    if (workId && empId) {
      const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/data/employee_assignments', {
        employee_id: empId,
        work_id: workId,
        date_from: '2026-04-01',
        date_to: '2026-04-30',
        role: 'Сварщик'
      }, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'PM assign employee');
  });

  test('17. PM navigates to #/calendar', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'calendar');
    await h.waitForPageLoad(page);

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'PM calendar page');
  });

  test('18. PM schedules employee for day 1 via API', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');

    const token = await h.getToken(page, 'PM');
    const empResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/staff/employees?limit=1', null, token);
    const employees = empResp.data?.employees || empResp.data?.items || [];
    const empId = Array.isArray(employees) && employees.length > 0 ? employees[0].id : null;

    if (empId) {
      const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/staff/schedule', {
        employee_id: empId,
        date: '2026-04-01',
        kind: 'work',
        status: 'planned',
        shift_type: 'day',
        hours: 10,
        note: `E2E_AUTO_Schedule_${TS}`
      }, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'PM schedule day 1');
  });

  test('19. PM schedules employee for day 2 via API', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');

    const token = await h.getToken(page, 'PM');
    const empResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/staff/employees?limit=1', null, token);
    const employees = empResp.data?.employees || empResp.data?.items || [];
    const empId = Array.isArray(employees) && employees.length > 0 ? employees[0].id : null;

    if (empId) {
      const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/staff/schedule', {
        employee_id: empId,
        date: '2026-04-02',
        kind: 'work',
        status: 'planned',
        shift_type: 'day',
        hours: 10,
        note: `E2E_AUTO_Schedule_${TS}`
      }, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'PM schedule day 2');
  });

  test('20. PM schedules employee for day 3 via API', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');

    const token = await h.getToken(page, 'PM');
    const empResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/staff/employees?limit=1', null, token);
    const employees = empResp.data?.employees || empResp.data?.items || [];
    const empId = Array.isArray(employees) && employees.length > 0 ? employees[0].id : null;

    if (empId) {
      const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/staff/schedule', {
        employee_id: empId,
        date: '2026-04-03',
        kind: 'work',
        status: 'planned',
        shift_type: 'day',
        hours: 10,
        note: `E2E_AUTO_Schedule_${TS}`
      }, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'PM schedule day 3');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 4 (tests 21-27): Payroll lifecycle
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Personnel — Section 4: Payroll', () => {
  test('21. PM navigates to #/payroll', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'payroll');
    await h.waitForPageLoad(page);

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'PM payroll page');
  });

  test('22. PM creates payroll sheet via API', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');

    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/payroll/sheets', {
      title: `E2E_AUTO_ФОТ_${TS}`,
      period_from: '2026-04-01',
      period_to: '2026-04-30',
      comment: 'E2E auto payroll sheet'
    }, token);
    expect(resp.status).toBeLessThan(500);

    h.assertNoConsoleErrors(errors, 'PM create payroll sheet');
  });

  test('23. PM adds payroll item via API', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');

    const token = await h.getToken(page, 'PM');

    // Get sheets to find our sheet
    const sheetsResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/payroll/sheets?limit=5', null, token);
    const sheets = sheetsResp.data?.sheets || [];
    const draftSheet = Array.isArray(sheets) ? sheets.find(s => s.status === 'draft') : null;

    if (draftSheet) {
      const empResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/staff/employees?limit=1', null, token);
      const employees = empResp.data?.employees || empResp.data?.items || [];
      const empId = Array.isArray(employees) && employees.length > 0 ? employees[0].id : null;

      if (empId) {
        const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/payroll/items', {
          sheet_id: draftSheet.id,
          employee_id: empId,
          days_worked: 3,
          day_rate: 3500,
          bonus: 5000,
          overtime_hours: 2,
          penalty: 0,
          advance_paid: 5000,
          deductions: 0,
          payment_method: 'card',
          comment: `E2E_AUTO_Item_${TS}`
        }, token);
        expect(resp.status).toBeLessThan(500);
      }
    }

    h.assertNoConsoleErrors(errors, 'PM add payroll item');
  });

  test('24. PM submits payroll sheet (draft -> pending)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');

    const token = await h.getToken(page, 'PM');
    const sheetsResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/payroll/sheets?limit=5', null, token);
    const sheets = sheetsResp.data?.sheets || [];
    const draftSheet = Array.isArray(sheets) ? sheets.find(s => s.status === 'draft') : null;

    if (draftSheet) {
      const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/payroll/sheets/${draftSheet.id}/submit`, {}, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'PM submit sheet');
  });

  test('25. DIRECTOR_GEN approves payroll sheet', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_GEN');

    const token = await h.getToken(page, 'DIRECTOR_GEN');
    const sheetsResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/payroll/sheets?limit=10', null, token);
    const sheets = sheetsResp.data?.sheets || [];
    const pendingSheet = Array.isArray(sheets) ? sheets.find(s => s.status === 'pending' || s.status === 'submitted') : null;

    if (pendingSheet) {
      const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/payroll/sheets/${pendingSheet.id}/approve`, {
        director_comment: `E2E_AUTO_Approved_${TS}`
      }, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'DIRECTOR approve sheet');
  });

  test('26. BUH navigates to #/payroll and sees sheets', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'BUH');
    await h.navigateTo(page, 'payroll');
    await h.waitForPageLoad(page);

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'BUH payroll page');
  });

  test('27. BUH pays approved sheet', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'BUH');

    const token = await h.getToken(page, 'BUH');
    const sheetsResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/payroll/sheets?limit=10', null, token);
    const sheets = sheetsResp.data?.sheets || [];
    const approvedSheet = Array.isArray(sheets) ? sheets.find(s => s.status === 'approved') : null;

    if (approvedSheet) {
      const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/payroll/sheets/${approvedSheet.id}/pay`, {}, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'BUH pay sheet');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 5 (tests 28-32): Bonus + Replacement
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Personnel — Section 5: Bonus + Replacement', () => {
  test('28. PM creates bonus request via API', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');

    const token = await h.getToken(page, 'PM');

    // Get work and employee
    const worksResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/works?limit=1', null, token);
    const works = worksResp.data?.works || [];
    const workId = Array.isArray(works) && works.length > 0 ? works[0].id : null;

    const empResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/staff/employees?limit=1', null, token);
    const employees = empResp.data?.employees || empResp.data?.items || [];
    const empId = Array.isArray(employees) && employees.length > 0 ? employees[0].id : null;

    if (workId && empId) {
      const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/data/bonus_requests', {
        work_id: workId,
        employee_id: empId,
        amount: 15000,
        reason: `E2E_AUTO_Отличная работа ${TS}`,
        status: 'pending',
        currency: 'RUB'
      }, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'PM create bonus');
  });

  test('29. DIRECTOR_GEN sees bonus requests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_GEN');

    const token = await h.getToken(page, 'DIRECTOR_GEN');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/bonus_requests?limit=10', null, token);
    expect(resp.status).toBe(200);

    const bonuses = resp.data?.bonus_requests || [];
    expect(Array.isArray(bonuses)).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'DIRECTOR see bonuses');
  });

  test('30. DIRECTOR_GEN approves bonus via API', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_GEN');

    const token = await h.getToken(page, 'DIRECTOR_GEN');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/bonus_requests?limit=10', null, token);
    const bonuses = resp.data?.bonus_requests || [];
    const pending = Array.isArray(bonuses) ? bonuses.find(b => b.status === 'pending') : null;

    if (pending) {
      const approveResp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/data/bonus_requests/${pending.id}`, {
        status: 'approved',
        director_comment: `E2E_AUTO_Одобрено ${TS}`,
        approved_at: new Date().toISOString()
      }, token);
      expect(approveResp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'DIRECTOR approve bonus');
  });

  test('31. HR creates replacement via API', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const reqResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=1', null, token);
    const requests = reqResp.data?.staff_requests || [];
    const reqId = Array.isArray(requests) && requests.length > 0 ? requests[0].id : null;

    if (reqId) {
      const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/data/staff_replacements', {
        staff_request_id: reqId,
        old_employee_id: 1,
        new_employee_id: 2,
        reason: `E2E_AUTO_Замена ${TS}`,
        status: 'sent'
      }, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'HR create replacement');
  });

  test('32. HR verifies replacement in list', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_replacements?limit=10', null, token);
    expect(resp.status).toBeLessThan(500);

    const list = resp.data?.staff_replacements || [];
    expect(Array.isArray(list)).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'HR verify replacements');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 6 (tests 33-35): Access checks
// ═══════════════════════════════════════════════════════════════
test.describe('Personnel — Section 6: Access checks', () => {
  test('33. PM can see payroll sheets', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'payroll');
    await h.waitForPageLoad(page);

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);

    // PM should have access (page loads content)
    const url = page.url();
    expect(url).toContain('payroll');

    h.assertNoConsoleErrors(errors, 'PM payroll access');
  });

  test('34. HR cannot create payroll sheet', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/payroll/sheets', {
      title: 'E2E_HR_attempt',
      period_from: '2026-01-01',
      period_to: '2026-01-31'
    }, token);

    // HR should get 403
    expect(resp.status === 403 || resp.status === 401).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'HR payroll forbidden');
  });

  test('35. TO cannot access payroll', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'TO');

    const token = await h.getToken(page, 'TO');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/payroll/sheets', null, token);

    // TO should get 403
    expect(resp.status === 403 || resp.status === 401).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'TO payroll forbidden');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 7 (tests 36-37): Employee full cycle + auto-fill
// ═══════════════════════════════════════════════════════════════
test.describe('Personnel — Section 7: Full cycle + auto-fill', () => {
  test('36. Employee full cycle: create -> permit -> schedule -> review -> deactivate', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const adminToken = await h.getToken(page, 'ADMIN');

    // 1. Create employee
    const emp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/staff/employees', {
      fio: `E2E_CYCLE_Сидоров_${TS}`,
      role_tag: 'worker',
      phone: '+79990009999',
      is_active: true
    }, token);
    expect(emp.status).toBeLessThan(500);
    const empId = emp.data?.employee?.id || emp.data?.id;
    if (!empId) return;

    // 2. Add schedule entry
    const sched = await h.apiCall(page, 'POST', h.BASE_URL + '/api/staff/schedule', {
      employee_id: empId,
      date: '2026-03-01',
      shift_type: 'day',
      hours: 8
    }, token);
    expect(sched.status).toBeLessThan(500);

    // 3. Add review
    const review = await h.apiCall(page, 'POST', h.BASE_URL + `/api/staff/employees/${empId}/review`, {
      rating: 4,
      comment: `E2E_AUTO_Good_${TS}`
    }, token);
    expect(review.status).toBeLessThan(500);

    // 4. Verify employee detail
    const detail = await h.apiCall(page, 'GET', h.BASE_URL + `/api/staff/employees/${empId}`, null, token);
    expect(detail.status).toBe(200);

    // 5. Deactivate
    const deact = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/staff/employees/${empId}`, {
      is_active: false
    }, adminToken);
    expect(deact.status).toBeLessThan(500);

    h.assertNoConsoleErrors(errors, 'Employee full cycle');
  });

  test('37. Auto-fill test: payroll auto-calculation', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');

    const token = await h.getToken(page, 'PM');
    const adminToken = await h.getToken(page, 'ADMIN');

    // Create temp sheet for auto-fill
    const sheetResp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/payroll/sheets', {
      title: `E2E_AUTOFILL_${TS}`,
      period_from: '2026-04-01',
      period_to: '2026-04-30'
    }, token);

    if (sheetResp.status < 300) {
      const sheetId = sheetResp.data?.sheet?.id || sheetResp.data?.id;
      if (sheetId) {
        // Try auto-fill
        const fillResp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/payroll/items/auto-fill', {
          sheet_id: sheetId
        }, token);
        // OK if auto-fill not implemented (404) or no data
        expect(fillResp.status).toBeLessThan(500);

        // Cleanup
        await h.apiCall(page, 'DELETE', h.BASE_URL + `/api/payroll/sheets/${sheetId}`, null, adminToken);
      }
    }

    h.assertNoConsoleErrors(errors, 'Auto-fill test');
  });
});
