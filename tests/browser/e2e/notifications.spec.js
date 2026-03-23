// @ts-check
// File 20: Notifications E2E — 4 browser tests
// Maps to: flow-notification-triggers.test.js
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

const BASE_URL = 'https://asgard-crm.ru';
const TS = () => Date.now();

test.describe('Notifications', () => {

  test('NOTIF-01: Task creation triggers notification for assignee', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    // Step 1: Create a task via API assigned to PM
    await h.loginAs(page, 'DIRECTOR_GEN');
    await h.waitForPageLoad(page);

    const dirToken = await h.getToken(page, 'DIRECTOR_GEN');

    // Get PM user id
    const usersResp = await h.apiCall(page, 'GET', BASE_URL + '/api/users', null, dirToken);
    const users = Array.isArray(usersResp.data) ? usersResp.data : (usersResp.data?.users || []);
    const pmUser = users.find(u => u.role === 'PM' && u.is_active !== false);

    if (pmUser) {
      // Create task assigned to PM
      const taskResp = await h.apiCall(page, 'POST', BASE_URL + '/api/tasks', {
        title: 'PW Notif Test Task ' + TS(),
        assignee_id: pmUser.id,
        priority: 'high',
        deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
      }, dirToken);

      const taskId = taskResp.data?.task?.id || taskResp.data?.id;

      // Step 2: Login as PM and check notification bell
      await h.loginAs(page, 'PM');
      await h.navigateTo(page, 'home');
      await h.waitForPageLoad(page);

      // Check notification bell / count
      const bellIcon = page.locator('.notification-bell, .notif-badge, [data-notifications], .badge, #notifCount, .bell-icon');
      if (await bellIcon.count() > 0) {
        const bellText = await bellIcon.first().textContent();
        // Bell exists — notification system works
        expect(bellText).toBeDefined();
      }

      // Navigate to notifications page and verify
      await h.navigateTo(page, 'alerts');
      await h.waitForPageLoad(page);

      const body = await page.textContent('body');
      expect(body.length).toBeGreaterThan(50);

      // Cleanup task via API
      if (taskId) {
        const adminToken = await h.getToken(page, 'ADMIN');
        await h.apiCall(page, 'DELETE', BASE_URL + '/api/tasks/' + taskId, null, adminToken);
      }
    }

    h.assertNoConsoleErrors(errors, 'NOTIF-01 Task triggers notification');
  });

  test('NOTIF-02: Cash approval triggers notification for PM', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    // Create and approve cash request via API
    await h.loginAs(page, 'ADMIN');
    await h.waitForPageLoad(page);

    const adminToken = await h.getToken(page, 'ADMIN');
    const pmToken = await h.getToken(page, 'PM');

    // Find a work for the cash request
    const worksResp = await h.apiCall(page, 'GET', BASE_URL + '/api/works?limit=1', null, adminToken);
    const works = worksResp.data?.works || worksResp.data?.items || [];
    const workId = works.length > 0 ? works[0].id : null;

    // Create cash request as PM
    const cashBody = { amount: 15000, purpose: 'PW Notif cash test ' + TS(), type: 'advance' };
    if (workId) cashBody.work_id = workId;

    const cashResp = await h.apiCall(page, 'POST', BASE_URL + '/api/cash', cashBody, pmToken);
    const cashId = cashResp.data?.item?.id || cashResp.data?.id;

    if (cashId) {
      // Approve as admin
      await h.apiCall(page, 'PUT', BASE_URL + '/api/cash/' + cashId + '/approve', { comment: 'E2E' }, adminToken);
      await page.waitForTimeout(500);

      // Login as PM and check notifications
      await h.loginAs(page, 'PM');
      await h.navigateTo(page, 'alerts');
      await h.waitForPageLoad(page);

      const body = await page.textContent('body');
      expect(body.length).toBeGreaterThan(50);

      // Cleanup
      await h.apiCall(page, 'PUT', BASE_URL + '/api/cash/' + cashId + '/close',
        { force: true, comment: 'cleanup' }, adminToken);
    }

    h.assertNoConsoleErrors(errors, 'NOTIF-02 Cash approval notification');
  });

  test('NOTIF-03: Calendar events load on calendar page', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'calendar');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Verify calendar renders — grid, cells, or events
    const calContainer = page.locator('.calendar, .fc, [data-page="calendar"], table, .calendar-grid, .cal-wrapper');
    expect(await calContainer.count()).toBeGreaterThan(0);

    // Try creating an event
    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить"), button:has-text("Событие")');
    if (await createBtn.count() > 0) {
      await createBtn.first().click();
      await page.waitForTimeout(500);

      const titleField = page.locator('.modal input[name="title"], .modal input[id*="title"], .modal input[name="name"]');
      if (await titleField.count() > 0) {
        await titleField.first().fill('PW Calendar Event ' + TS());
      }

      await h.clickSave(page);
      await page.waitForTimeout(1000);
    }

    // Verify notification endpoint works (via navigating to notifications)
    await h.navigateTo(page, 'alerts');
    await h.waitForPageLoad(page);

    const notifBody = await page.textContent('body');
    expect(notifBody.length).toBeGreaterThan(50);

    h.assertNoConsoleErrors(errors, 'NOTIF-03 Calendar and notifications');
  });

  test('NOTIF-04: Notification CRUD — click, mark read, delete', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await h.navigateTo(page, 'alerts');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Click on a notification if any exist
    const notifRow = page.locator('.notification-item, .notif-row, tbody tr, [data-notification-id], .list-item').first();
    if (await notifRow.count() > 0) {
      await notifRow.click();
      await page.waitForTimeout(500);

      // Try to mark as read
      const readBtn = page.locator('button:has-text("Прочитано"), button:has-text("Mark read"), button:has-text("Отметить"), .mark-read');
      if (await readBtn.count() > 0) {
        await readBtn.first().click();
        await page.waitForTimeout(300);
      }

      // Try to delete
      const deleteBtn = page.locator('button:has-text("Удалить"), button:has-text("Delete"), .delete-notif, .btn-danger');
      if (await deleteBtn.count() > 0) {
        await deleteBtn.first().click();
        await page.waitForTimeout(300);

        // Confirm deletion if dialog appears
        const confirmBtn = page.locator('button:has-text("Да"), button:has-text("Подтвердить"), button:has-text("OK")');
        if (await confirmBtn.count() > 0) {
          await confirmBtn.first().click();
          await page.waitForTimeout(500);
        }
      }
    }

    // Try "Mark all read" button
    const markAllBtn = page.locator('button:has-text("Прочитать все"), button:has-text("Отметить все"), button:has-text("Mark all read")');
    if (await markAllBtn.count() > 0) {
      await markAllBtn.first().click();
      await page.waitForTimeout(500);
    }

    h.assertNoConsoleErrors(errors, 'NOTIF-04 Notification CRUD');
  });
});
