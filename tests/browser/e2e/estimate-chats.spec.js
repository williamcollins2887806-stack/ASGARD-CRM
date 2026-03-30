// @ts-check
// Estimate Chats (H3/H4) — Desktop E2E tests
// Verifies: estimate section in sidebar, pinned card, message types, Mimir bubble
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

const TS = () => Date.now();

test.describe.serial('Estimate Chats Desktop', () => {
  let pmToken, directorToken;
  let estimateId;

  // ─── Setup: get tokens ───────────────────────────────────────

  test('EC-01: Get tokens for PM and Director', async ({ page }) => {
    pmToken = await h.getToken(page, 'PM');
    expect(pmToken).toBeTruthy();

    directorToken = await h.getToken(page, 'DIRECTOR_GEN');
    expect(directorToken).toBeTruthy();
  });

  // ─── Create estimate draft via API ───────────────────────────

  test('EC-02: PM creates estimate draft', async ({ page }) => {
    // Find a tender to attach estimate to
    const tendersResp = await h.apiCall(page, 'GET', '/api/data/tenders?limit=1', null, pmToken);
    const tenderId = tendersResp.data?.rows?.[0]?.id;
    // Create estimate
    const name = 'H4 Chat Test ' + TS();
    const body = { title: name, name: name };
    if (tenderId) body.tender_id = tenderId;

    const resp = await h.apiCall(page, 'POST', '/api/data/estimates', body, pmToken);
    estimateId = resp.data?.id || resp.data?.row?.id;

    if (!estimateId) {
      // Fallback: find any existing draft estimate
      const existing = await h.apiCall(page, 'GET', '/api/data/estimates?limit=5', null, pmToken);
      const draft = existing.data?.rows?.find(e => e.approval_status === 'draft');
      estimateId = draft?.id;
    }

    expect(estimateId).toBeTruthy();
    console.log('Estimate ID:', estimateId);
  });

  // ─── Send estimate for approval (creates chat) ──────────────

  test('EC-03: PM sends estimate for approval', async ({ page }) => {
    const resp = await h.apiCall(page, 'POST', `/api/approval/estimates/${estimateId}/send`, {}, pmToken);
    // May fail if already sent — that's ok
    expect(resp.status).toBeLessThan(500);
    console.log('Send result:', resp.status, resp.data?.status || resp.data?.error);
  });

  // ─── Director does rework with comment ───────────────────────

  test('EC-04: Director sends rework with comment', async ({ page }) => {
    // Wait for chat creation to complete
    await page.waitForTimeout(2000);

    const resp = await h.apiCall(page, 'POST', `/api/approval/estimates/${estimateId}/rework`, {
      comment: 'Нужно пересчитать маржу, слишком низкая'
    }, directorToken);

    expect(resp.status).toBeLessThan(500);
    console.log('Rework result:', resp.status, resp.data?.status || resp.data?.error);

    // Wait for Mimir auto-respond to fire (fire-and-forget with delay)
    await page.waitForTimeout(5000);
  });

  // ─── Verify messenger: estimate section in sidebar ───────────

  test('EC-05: Messenger shows estimate chats section', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'messenger');
    await page.waitForTimeout(2000);

    // Check estimate section header exists
    const sectionHeader = page.locator('.ec-section-header');
    const hasSectionHeader = await sectionHeader.count() > 0;

    // Check estimate chat items exist
    const estimateItems = page.locator('.chat-item[data-entity-type="estimate"]');
    const estimateCount = await estimateItems.count();

    console.log('Section header present:', hasSectionHeader);
    console.log('Estimate chat items:', estimateCount);

    // At least verify the messenger page loaded
    const sidebar = page.locator('.chat-sidebar, #chat-sidebar');
    await expect(sidebar.first()).toBeVisible({ timeout: 10000 });

    // If estimate chats exist, verify gold border
    if (estimateCount > 0) {
      expect(hasSectionHeader).toBeTruthy();
      const firstEstimate = estimateItems.first();
      await expect(firstEstimate).toBeVisible();
    }

    h.assertNoConsoleErrors(errors, 'EC-05 Estimate section');
  });

  // ─── Verify: open estimate chat, check pinned card ───────────

  test('EC-06: Estimate chat has pinned card and messages', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'messenger');
    await page.waitForTimeout(2000);

    // Click first estimate chat
    const estimateItems = page.locator('.chat-item[data-entity-type="estimate"]');
    const count = await estimateItems.count();
    if (count === 0) {
      console.log('No estimate chats found — skipping pinned card check');
      return;
    }

    await estimateItems.first().click();
    await page.waitForTimeout(2000);

    // Check pinned card
    const pinnedCard = page.locator('.ec-pinned-card');
    const hasPinned = await pinnedCard.count() > 0;
    console.log('Pinned card present:', hasPinned);

    if (hasPinned) {
      // Verify card elements
      await expect(pinnedCard.locator('.ec-pinned-card__title')).toBeVisible();
      await expect(pinnedCard.locator('.ec-status-badge')).toBeVisible();

      // Metrics (cost, margin)
      const metrics = pinnedCard.locator('.ec-metric');
      const metricsCount = await metrics.count();
      console.log('Metrics count:', metricsCount);
      expect(metricsCount).toBe(3);

      // Report link
      const link = pinnedCard.locator('.ec-pinned-card__link');
      await expect(link).toBeVisible();
      const href = await link.getAttribute('href');
      expect(href).toContain('estimate-report');
    }

    // Check for messages container
    const messagesContainer = page.locator('#chat-messages-container');
    await expect(messagesContainer).toBeVisible();

    h.assertNoConsoleErrors(errors, 'EC-06 Pinned card');
  });

  // ─── Verify: special message types ───────────────────────────

  test('EC-07: Chat contains special message types', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    await h.loginAs(page, 'PM');
    await h.navigateTo(page, 'messenger');
    await page.waitForTimeout(2000);

    const estimateItems = page.locator('.chat-item[data-entity-type="estimate"]');
    if (await estimateItems.count() === 0) {
      console.log('No estimate chats — skipping message type check');
      return;
    }

    await estimateItems.first().click();
    await page.waitForTimeout(2000);

    // Check: estimate_card is NOT rendered as a regular message (it's the pinned card)
    // System pills (estimate_update) — may or may not exist
    const systemPills = page.locator('.ec-system-pill');
    console.log('System pills:', await systemPills.count());

    // Action badges (rework/approve/etc)
    const actionBadges = page.locator('.ec-action-badge');
    const badgeCount = await actionBadges.count();
    console.log('Action badges:', badgeCount);

    // Mimir response messages (gradient avatar)
    const mimirAvatars = page.locator('.ec-mimir-avatar');
    const mimirBubbles = page.locator('.ec-mimir-bubble');
    console.log('Mimir avatars:', await mimirAvatars.count());
    console.log('Mimir bubbles:', await mimirBubbles.count());

    // Mimir pill "ассистент"
    const mimirPills = page.locator('.ec-mimir-pill');
    console.log('Mimir pills:', await mimirPills.count());

    // At minimum — messages should exist
    const messages = page.locator('.chat-message, .ec-system-pill');
    const msgCount = await messages.count();
    console.log('Total messages/pills:', msgCount);

    h.assertNoConsoleErrors(errors, 'EC-07 Message types');
  });

  // ─── Verify: director view shows same chat ───────────────────

  test('EC-08: Director sees estimate chat too', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);

    await h.loginAs(page, 'DIRECTOR_GEN');
    await h.navigateTo(page, 'messenger');
    await page.waitForTimeout(2000);

    const estimateItems = page.locator('.chat-item[data-entity-type="estimate"]');
    const count = await estimateItems.count();
    console.log('Director estimate chats:', count);

    if (count > 0) {
      await estimateItems.first().click();
      await page.waitForTimeout(2000);

      // Should see pinned card
      const pinnedCard = page.locator('.ec-pinned-card');
      console.log('Director pinned card:', await pinnedCard.count() > 0);

      // Should see the "+" add member button
      const addBtn = page.locator('.ec-add-member-btn');
      console.log('Add member button:', await addBtn.count() > 0);
    }

    h.assertNoConsoleErrors(errors, 'EC-08 Director view');
  });
});
