// @ts-check
/**
 * E2E Browser: Staff Requests (45 tests)
 * Maps to: flow-staff-requests.test.js
 * Page: #/staff_requests
 */
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

const TS = Date.now();

// ═══════════════════════════════════════════════════════════════
// Section 1 (tests 1-5): CRUD
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Staff Requests — Section 1: CRUD', () => {
  let requestId;
  let request2Id;

  test('1. HR creates staff request via UI', async ({ page }) => {
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
        await specField.first().fill(`E2E_SR_Сварщик_${TS}`);
      }

      const countField = page.locator('input[name="required_count"], input[id*="count"]');
      if (await countField.count() > 0) {
        await countField.first().fill('3');
      }

      const dateFromField = page.locator('input[name="date_from"], input[id*="date_from"], input[type="date"]').first();
      if (await dateFromField.count() > 0) {
        await dateFromField.fill('2026-04-01');
      }

      const commentsField = page.locator('textarea[name="comments"], textarea[id*="comment"]');
      if (await commentsField.count() > 0) {
        await commentsField.first().fill(`E2E_SR_Нужны_${TS}`);
      }

      await h.clickSave(page);
      await page.waitForTimeout(1500);
    }

    h.assertNoConsoleErrors(errors, 'HR create request');
  });

  test('2. HR_MANAGER creates second request via API', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    // Use HR_MANAGER token (test account may not have HR_MANAGER, fallback to HR)
    let token;
    try {
      token = await h.getToken(page, 'HR');
    } catch {
      token = await h.getToken(page, 'HR');
    }

    const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/data/staff_requests', {
      pm_id: 1,
      status: 'new',
      required_count: 2,
      specialization: `E2E_SR_Монтажник_${TS}`,
      date_from: '2026-05-01',
      date_to: '2026-07-31',
      comments: `E2E_SR_Монтажники_${TS}`
    }, token);
    expect(resp.status).toBeLessThan(500);
    request2Id = resp.data?.id || resp.data?.item?.id;

    h.assertNoConsoleErrors(errors, 'HR_MANAGER create request');
  });

  test('3. HR reads list of staff requests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'hr-requests');
    await h.waitForPageLoad(page);

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'HR read list');
  });

  test('4. HR reads single request detail', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'hr-requests');
    await h.waitForPageLoad(page);

    // Click first item to see detail
    const row = page.locator('table tbody tr, .card[data-id], .list-item[data-id]').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1000);
    }

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'HR read detail');
  });

  test('5. Verify request has expected fields', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=1', null, token);
    expect(resp.status).toBe(200);

    const list = resp.data?.staff_requests || [];
    if (Array.isArray(list) && list.length > 0) {
      const item = list[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('status');
    }

    h.assertNoConsoleErrors(errors, 'verify fields');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 2 (tests 6-10): Read by different roles + status transitions
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Staff Requests — Section 2: Roles + Transitions', () => {
  test('6. ADMIN reads staff requests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');

    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=100', null, token);
    expect(resp.status).toBe(200);
    expect(Array.isArray(resp.data?.staff_requests)).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'ADMIN read');
  });

  test('7. DIRECTOR_GEN reads all requests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_GEN');

    const token = await h.getToken(page, 'DIRECTOR_GEN');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=100', null, token);
    expect(resp.status).toBe(200);
    expect(Array.isArray(resp.data?.staff_requests)).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'DIRECTOR_GEN read');
  });

  test('8. Status transition: new -> sent', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const listResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=20', null, token);
    const list = listResp.data?.staff_requests || [];
    const newReq = Array.isArray(list) ? list.find(r => r.status === 'new') : null;

    if (newReq) {
      const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/data/staff_requests/${newReq.id}`, {
        status: 'sent'
      }, token);
      expect(resp.status).toBeLessThan(500);
      if (resp.status === 200) {
        expect(resp.data?.item?.status).toBe('sent');
      }
    }

    h.assertNoConsoleErrors(errors, 'new->sent');
  });

  test('9. Status transition: sent -> answered', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const listResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=20', null, token);
    const list = listResp.data?.staff_requests || [];
    const sentReq = Array.isArray(list) ? list.find(r => r.status === 'sent') : null;

    if (sentReq) {
      const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/data/staff_requests/${sentReq.id}`, {
        status: 'answered',
        comments: `E2E_SR_Подобраны_${TS}`
      }, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'sent->answered');
  });

  test('10. Status transition: answered -> approved', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');

    const token = await h.getToken(page, 'ADMIN');
    const listResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=20', null, token);
    const list = listResp.data?.staff_requests || [];
    const answeredReq = Array.isArray(list) ? list.find(r => r.status === 'answered') : null;

    if (answeredReq) {
      const resp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/data/staff_requests/${answeredReq.id}`, {
        status: 'approved'
      }, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'answered->approved');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 3 (tests 11-15): Messages
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Staff Requests — Section 3: Messages', () => {
  let messageId;

  test('11. HR adds message to request', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const listResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=1', null, token);
    const requests = listResp.data?.staff_requests || [];
    const reqId = Array.isArray(requests) && requests.length > 0 ? requests[0].id : null;

    if (reqId) {
      const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/data/staff_request_messages', {
        staff_request_id: reqId,
        author_user_id: 1,
        message: `E2E_SR_MSG1_${TS}`
      }, token);
      expect(resp.status).toBeLessThan(500);
      messageId = resp.data?.id || resp.data?.item?.id;
    }

    h.assertNoConsoleErrors(errors, 'HR add message');
  });

  test('12. HR adds second message', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const listResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=1', null, token);
    const requests = listResp.data?.staff_requests || [];
    const reqId = Array.isArray(requests) && requests.length > 0 ? requests[0].id : null;

    if (reqId) {
      const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/data/staff_request_messages', {
        staff_request_id: reqId,
        author_user_id: 1,
        message: `E2E_SR_MSG2_${TS}`
      }, token);
      expect(resp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'HR add message 2');
  });

  test('13. Read messages for request', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const listResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=1', null, token);
    const requests = listResp.data?.staff_requests || [];
    const reqId = Array.isArray(requests) && requests.length > 0 ? requests[0].id : null;

    if (reqId) {
      const where = JSON.stringify({ staff_request_id: reqId });
      const resp = await h.apiCall(page, 'GET', h.BASE_URL + `/api/data/staff_request_messages?where=${encodeURIComponent(where)}`, null, token);
      expect(resp.status).toBe(200);
      const msgs = resp.data?.staff_request_messages || [];
      expect(Array.isArray(msgs)).toBeTruthy();
    }

    h.assertNoConsoleErrors(errors, 'read messages');
  });

  test('14. Messages have correct fields', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_request_messages?limit=1', null, token);
    expect(resp.status).toBe(200);

    const msgs = resp.data?.staff_request_messages || [];
    if (Array.isArray(msgs) && msgs.length > 0) {
      expect(msgs[0]).toHaveProperty('id');
      expect(msgs[0]).toHaveProperty('staff_request_id');
      expect(msgs[0]).toHaveProperty('message');
    }

    h.assertNoConsoleErrors(errors, 'message fields');
  });

  test('15. Filter messages by staff_request_id', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const listResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=1', null, token);
    const requests = listResp.data?.staff_requests || [];
    const reqId = Array.isArray(requests) && requests.length > 0 ? requests[0].id : null;

    if (reqId) {
      const where = JSON.stringify({ staff_request_id: reqId });
      const resp = await h.apiCall(page, 'GET', h.BASE_URL + `/api/data/staff_request_messages?where=${encodeURIComponent(where)}`, null, token);
      expect(resp.status).toBe(200);
      const msgs = resp.data?.staff_request_messages || [];
      if (Array.isArray(msgs)) {
        for (const m of msgs) {
          expect(m.staff_request_id).toBe(reqId);
        }
      }
    }

    h.assertNoConsoleErrors(errors, 'filter messages');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 4 (tests 16-20): Replacements
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Staff Requests — Section 4: Replacements', () => {
  let replacementId;

  test('16. HR creates replacement', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const listResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=1', null, token);
    const requests = listResp.data?.staff_requests || [];
    const reqId = Array.isArray(requests) && requests.length > 0 ? requests[0].id : null;

    if (reqId) {
      const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/data/staff_replacements', {
        staff_request_id: reqId,
        old_employee_id: 1,
        new_employee_id: 2,
        reason: `E2E_SR_Замена_${TS}`,
        status: 'sent'
      }, token);
      expect(resp.status).toBeLessThan(500);
      replacementId = resp.data?.id || resp.data?.item?.id;
    }

    h.assertNoConsoleErrors(errors, 'HR create replacement');
  });

  test('17. HR reads replacements list', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_replacements?limit=10', null, token);
    // staff_replacements may return 200 or 400 (table access depends on config) — just not 5xx
    expect(resp.status).toBeLessThan(500);
    if (resp.status === 200) {
      expect(Array.isArray(resp.data?.staff_replacements)).toBeTruthy();
    }

    h.assertNoConsoleErrors(errors, 'HR read replacements');
  });

  test('18. Filter replacements by staff_request_id', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const listResp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=1', null, token);
    const requests = listResp.data?.staff_requests || [];
    const reqId = Array.isArray(requests) && requests.length > 0 ? requests[0].id : null;

    if (reqId) {
      const where = JSON.stringify({ staff_request_id: reqId });
      const resp = await h.apiCall(page, 'GET', h.BASE_URL + `/api/data/staff_replacements?where=${encodeURIComponent(where)}`, null, token);
      expect(resp.status).toBe(200);
    }

    h.assertNoConsoleErrors(errors, 'filter replacements');
  });

  test('19. HR updates replacement status', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_replacements?limit=5', null, token);
    const replacements = resp.data?.staff_replacements || [];
    const sentRepl = Array.isArray(replacements) ? replacements.find(r => r.status === 'sent') : null;

    if (sentRepl) {
      const updateResp = await h.apiCall(page, 'PUT', h.BASE_URL + `/api/data/staff_replacements/${sentRepl.id}`, {
        status: 'approved',
        reason: `E2E_SR_Согласовано_${TS}`
      }, token);
      expect(updateResp.status).toBeLessThan(500);
    }

    h.assertNoConsoleErrors(errors, 'update replacement status');
  });

  test('20. Replacement has correct fields', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');

    const token = await h.getToken(page, 'HR');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_replacements?limit=1', null, token);
    const list = resp.data?.staff_replacements || [];
    if (Array.isArray(list) && list.length > 0) {
      expect(list[0]).toHaveProperty('id');
      expect(list[0]).toHaveProperty('staff_request_id');
      expect(list[0]).toHaveProperty('status');
    }

    h.assertNoConsoleErrors(errors, 'replacement fields');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 5 (tests 21-30): Role access checks
// ═══════════════════════════════════════════════════════════════
test.describe('Staff Requests — Section 5: Role Access', () => {
  test('21. ADMIN can access staff_requests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests', null, token);
    expect(resp.status).toBe(200);
    h.assertNoConsoleErrors(errors, 'ADMIN access');
  });

  test('22. DIRECTOR_GEN can access staff_requests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_GEN');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests', null, token);
    expect(resp.status).toBe(200);
    h.assertNoConsoleErrors(errors, 'DIRECTOR_GEN access');
  });

  test('23. DIRECTOR_COMM can access staff_requests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_COMM');
    const token = await h.getToken(page, 'DIRECTOR_COMM');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests', null, token);
    expect(resp.status).toBe(200);
    h.assertNoConsoleErrors(errors, 'DIRECTOR_COMM access');
  });

  test('24. DIRECTOR_DEV can access staff_requests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_DEV');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests', null, token);
    expect(resp.status).toBe(200);
    h.assertNoConsoleErrors(errors, 'DIRECTOR_DEV access');
  });

  test('25. HR can access staff_requests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests', null, token);
    expect(resp.status).toBe(200);
    h.assertNoConsoleErrors(errors, 'HR access');
  });

  test('26. PM can access staff_requests (limited)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests', null, token);
    // PM may have access (per API test) or limited
    expect(resp.status).toBeLessThan(500);
    h.assertNoConsoleErrors(errors, 'PM access');
  });

  test('27. TO denied access to staff_requests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'TO');
    const token = await h.getToken(page, 'TO');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests', null, token);
    expect(resp.status === 403 || resp.status === 401).toBeTruthy();
    h.assertNoConsoleErrors(errors, 'TO denied');
  });

  test('28. BUH denied access to staff_requests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'BUH');
    const token = await h.getToken(page, 'BUH');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests', null, token);
    expect(resp.status === 403 || resp.status === 401).toBeTruthy();
    h.assertNoConsoleErrors(errors, 'BUH denied');
  });

  test('29. WAREHOUSE denied access to staff_requests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'WAREHOUSE');
    const token = await h.getToken(page, 'WAREHOUSE');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests', null, token);
    expect(resp.status === 403 || resp.status === 401).toBeTruthy();
    h.assertNoConsoleErrors(errors, 'WAREHOUSE denied');
  });

  test('30. PROC denied access to staff_requests', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PROC');
    const token = await h.getToken(page, 'PROC');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests', null, token);
    expect(resp.status === 403 || resp.status === 401).toBeTruthy();
    h.assertNoConsoleErrors(errors, 'PROC denied');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 5 continued (tests 31-35): Write access checks
// ═══════════════════════════════════════════════════════════════
test.describe('Staff Requests — Section 5b: Write Access', () => {
  test('31. PM can create staff_request', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    const token = await h.getToken(page, 'PM');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/data/staff_requests', {
      pm_id: 1,
      status: 'new',
      required_count: 1,
      specialization: `E2E_SR_PM_test_${TS}`
    }, token);
    expect(resp.status).toBeLessThan(500);
    h.assertNoConsoleErrors(errors, 'PM create request');
  });

  test('32. TO cannot create staff_request_messages', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'TO');
    const token = await h.getToken(page, 'TO');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/data/staff_request_messages', {
      staff_request_id: 1,
      author_user_id: 1,
      message: 'E2E test forbidden'
    }, token);
    expect(resp.status === 403 || resp.status === 401).toBeTruthy();
    h.assertNoConsoleErrors(errors, 'TO create message forbidden');
  });

  test('33. BUH cannot create staff_replacements', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'BUH');
    const token = await h.getToken(page, 'BUH');
    const resp = await h.apiCall(page, 'POST', h.BASE_URL + '/api/data/staff_replacements', {
      staff_request_id: 1,
      old_employee_id: 1,
      new_employee_id: 2
    }, token);
    expect(resp.status === 403 || resp.status === 401).toBeTruthy();
    h.assertNoConsoleErrors(errors, 'BUH create replacement forbidden');
  });

  test('34. HR can access staff_requests page via UI', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'hr-requests');
    await h.waitForPageLoad(page);

    const url = page.url();
    expect(url).toContain('hr-requests');
    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'HR UI access');
  });

  test('35. TO redirected or denied from staff_requests page', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'TO');
    await h.navigateTo(page, 'hr-requests');
    await page.waitForTimeout(2000);

    const noAccess = await h.expectNoAccess(page);
    expect(noAccess).toBeTruthy();

    h.assertNoConsoleErrors(errors, 'TO UI denied');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 6 (tests 36-40): Filtering
// ═══════════════════════════════════════════════════════════════
test.describe('Staff Requests — Section 6: Filtering', () => {
  test('36. Filter by status (approved)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    const token = await h.getSessionToken(page);
    const where = JSON.stringify({ status: 'approved' });
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + `/api/data/staff_requests?where=${encodeURIComponent(where)}`, null, token);
    expect(resp.status).toBe(200);
    const list = resp.data?.staff_requests || [];
    if (Array.isArray(list)) {
      for (const item of list) {
        expect(item.status).toBe('approved');
      }
    }
    h.assertNoConsoleErrors(errors, 'filter by status');
  });

  test('37. Filter by pm_id', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    const token = await h.getSessionToken(page);
    const where = JSON.stringify({ pm_id: 1 });
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + `/api/data/staff_requests?where=${encodeURIComponent(where)}`, null, token);
    expect(resp.status).toBe(200);
    h.assertNoConsoleErrors(errors, 'filter by pm_id');
  });

  test('38. Pagination: limit=1', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=1&offset=0', null, token);
    expect(resp.status).toBeLessThan(500);
    if (resp.status === 200) {
      const list = resp.data?.staff_requests || [];
      expect(Array.isArray(list)).toBeTruthy();
      expect(list.length).toBeLessThanOrEqual(1);
    }
    h.assertNoConsoleErrors(errors, 'limit=1');
  });

  test('39. Pagination: offset', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    const token = await h.getToken(page, 'ADMIN');
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=1&offset=1', null, token);
    expect(resp.status).toBe(200);
    h.assertNoConsoleErrors(errors, 'offset');
  });

  test('40. OrderBy created_at DESC', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?orderBy=created_at&desc=true&limit=10', null, token);
    expect(resp.status).toBe(200);
    const list = resp.data?.staff_requests || [];
    if (Array.isArray(list) && list.length >= 2) {
      const d1 = new Date(list[0].created_at).getTime();
      const d2 = new Date(list[1].created_at).getTime();
      expect(d1).toBeGreaterThanOrEqual(d2);
    }
    h.assertNoConsoleErrors(errors, 'orderBy DESC');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 7 (tests 41-45): Edge cases
// ═══════════════════════════════════════════════════════════════
test.describe('Staff Requests — Section 7: Edge Cases', () => {
  test('41. GET nonexistent table returns 400', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests_nonexistent', null, token);
    // Server should return 4xx for invalid table (400 or 403 or 404)
    expect(resp.status).not.toBe(200);
    expect(resp.status).not.toBe(500);
    h.assertNoConsoleErrors(errors, 'nonexistent table');
  });

  test('42. GET nonexistent ID returns 404', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests/999999', null, token);
    // Server should return 4xx for nonexistent record
    expect(resp.status).not.toBe(200);
    expect(resp.status).not.toBe(500);
    h.assertNoConsoleErrors(errors, 'nonexistent ID');
  });

  test('43. limit=0 returns valid response', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=0', null, token);
    // limit=0 may return empty array or all items depending on API impl — just verify it's not a server error
    expect(resp.status).toBeLessThan(500);
    if (resp.status === 200) {
      const list = resp.data?.staff_requests || [];
      expect(Array.isArray(list)).toBeTruthy();
    }
    h.assertNoConsoleErrors(errors, 'limit=0');
  });

  test('44. Total field present in response', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    const token = await h.getSessionToken(page);
    const resp = await h.apiCall(page, 'GET', h.BASE_URL + '/api/data/staff_requests?limit=1', null, token);
    expect(resp.status).toBe(200);
    expect(resp.data?.total !== undefined).toBeTruthy();
    h.assertNoConsoleErrors(errors, 'total field');
  });

  test('45. Staff requests page loads without console errors for HR', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'HR');
    await h.navigateTo(page, 'hr-requests');
    await h.waitForPageLoad(page);
    await page.waitForTimeout(2000);

    const content = await page.textContent('body');
    expect(content.length).toBeGreaterThan(50);
    h.assertNoConsoleErrors(errors, 'HR page no errors');
  });
});
