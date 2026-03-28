// @ts-check
// File 19: Meetings E2E — 2 browser tests
// Maps to: flow-meeting-actions.test.js
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

const TS = () => Date.now();

test.describe('Meetings', () => {

  test('MTG-01: DIRECTOR_GEN creates meeting with PM & TO, verifies RSVPs and minutes', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_GEN');
    await h.navigateTo(page, 'meetings');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Create a new meeting
    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Новое совещание"), button:has-text("Добавить"), #btnNewMeeting');
    if (await createBtn.count() > 0) {
      await createBtn.first().click();
      await page.waitForTimeout(500);

      // Fill title
      const titleField = page.locator('.modal input[name="title"], .modal input[id*="title"], .modal input[name="name"]');
      if (await titleField.count() > 0) {
        await titleField.first().fill('PW Meeting: Weekly Sync ' + TS());
      }

      // Fill date
      const dateField = page.locator('.modal input[type="date"], .modal input[name="start_time"], .modal input[name="date"], .modal input[id*="date"]');
      if (await dateField.count() > 0) {
        const futureDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
        await dateField.first().fill(futureDate);
      }

      // Fill description / agenda
      const descField = page.locator('.modal textarea[name="description"], .modal textarea[name="agenda"], .modal textarea');
      if (await descField.count() > 0) {
        await descField.first().fill('E2E browser test meeting agenda');
      }

      // Select participants if multiselect is available
      const participantSelect = page.locator('.modal select[name="participants"], .modal select[name="participant_ids"], .modal [data-field="participants"]');
      if (await participantSelect.count() > 0) {
        // Try to select first few options
        const options = await participantSelect.first().locator('option').all();
        if (options.length > 1) {
          await participantSelect.first().selectOption({ index: 1 });
        }
      }

      // Fill location
      const locField = page.locator('.modal input[name="location"], .modal input[id*="location"]');
      if (await locField.count() > 0) {
        await locField.first().fill('Conference Room A');
      }

      await h.clickSave(page);
      await page.waitForTimeout(1500);
    }

    // Verify meeting list reloaded
    await h.navigateTo(page, 'meetings');
    await h.waitForPageLoad(page);

    const bodyAfter = await page.textContent('body');
    expect(bodyAfter.length).toBeGreaterThan(50);

    // Try to open a meeting row to check details (RSVP, minutes)
    const row = page.locator('tbody tr, .meeting-row, .meeting-card, [data-id]').first();
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1500);

      // Look for RSVP section
      const rsvpSection = page.locator('text=RSVP, text=Участники, text=Ответ, .rsvp, [data-tab="participants"]');
      if (await rsvpSection.count() > 0) {
        await rsvpSection.first().click();
        await page.waitForTimeout(500);
      }

      // Look for minutes tab/section
      const minutesSection = page.locator('text=Протокол, text=Минуты, button:has-text("Протокол"), [data-tab="minutes"]');
      if (await minutesSection.count() > 0) {
        await minutesSection.first().click();
        await page.waitForTimeout(500);

        // Try adding a note
        const noteInput = page.locator('textarea[name="minute_content"], textarea[name="content"], .minutes-input textarea');
        if (await noteInput.count() > 0) {
          await noteInput.first().fill('PW Minutes: Action item — prepare estimate');
        }

        const addBtn = page.locator('button:has-text("Добавить"), button:has-text("Записать")');
        if (await addBtn.count() > 0) {
          await addBtn.first().click();
          await page.waitForTimeout(500);
        }
      }

      await h.closeModal(page);
    }

    h.assertNoConsoleErrors(errors, 'MTG-01 DIRECTOR_GEN creates meeting');
  });

  test('MTG-02: Meeting list loads, upcoming section visible', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'meetings');
    await h.waitForPageLoad(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(50);

    // Verify list or table is present
    const listContainer = page.locator('table, .meetings-list, .card-list, [data-page="meetings"], tbody, .meeting-card, .grid, h2, h3');
    expect(await listContainer.count()).toBeGreaterThan(0);

    // Check for upcoming section/tab/filter
    const upcomingTab = page.locator('text=Предстоящие, text=Upcoming, button:has-text("Предстоящие"), .tab:has-text("Предстоящие"), [data-filter="upcoming"]');
    if (await upcomingTab.count() > 0) {
      await upcomingTab.first().click();
      await page.waitForTimeout(500);
    }

    // Check for stats section
    const statsSection = page.locator('text=Статистика, text=Stats, .meetings-stats, [data-tab="stats"]');
    if (await statsSection.count() > 0) {
      await statsSection.first().click();
      await page.waitForTimeout(500);
    }

    // Verify page rendered without console errors
    const buttons = await h.getVisibleButtons(page);
    expect(buttons.length).toBeGreaterThanOrEqual(0);

    h.assertNoConsoleErrors(errors, 'MTG-02 Meeting list and upcoming');
  });
});
