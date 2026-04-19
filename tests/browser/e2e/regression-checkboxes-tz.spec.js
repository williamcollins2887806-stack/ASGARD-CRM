// @ts-check
// Регресс-тест для последних фиксов (апрель 2026):
// - Фикс чекбоксов в модалках: picker'ы теперь показывают имена, а не только пустые квадраты
// - TZ-фикс dates: DATE колонки сериализуются как T12:00:00.000Z, даты не сдвигаются на -1 день
// - Gantt cross-month: работы видны корректно на границе месяцев
const { test, expect } = require('@playwright/test');
const h = require('../helpers');

test.describe('Regression: recent fixes (2026-04-11)', () => {

  test('REG-01: Pass request picker shows employee names (not empty checkboxes)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_GEN');
    // pass-requests page роут
    await page.goto('https://asgard-crm.ru/#/pass-requests');
    await page.waitForTimeout(2000);

    // Открыть модалку создания заявки
    const createBtn = page.locator('button:has-text("Новая заявка"), button:has-text("Создать"), button:has-text("+ Новая")').first();
    console.log(`[REG-01] create btn count: ${await createBtn.count()}`);
    if (await createBtn.count() > 0) {
      await createBtn.click();
      await page.waitForTimeout(1500);
    }

    // Подождать загрузку списка сотрудников
    await page.waitForSelector('#prEmpsList', { state: 'visible', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Проверить что у чекбоксов в #prEmpsList есть текст рядом
    const labels = await page.locator('#prEmpsList label').count();
    const prListHtml = await page.locator('#prEmpsList').innerHTML().catch(() => 'NOT FOUND');
    console.log(`[REG-01] labels count: ${labels}`);
    console.log(`[REG-01] #prEmpsList HTML (first 300): ${prListHtml.slice(0, 300)}`);
    expect(labels).toBeGreaterThan(0);

    // Проверить что хотя бы один label содержит непустой текст (имя сотрудника)
    const firstLabelText = await page.locator('#prEmpsList label').first().textContent();
    console.log(`[REG-01] first label text: "${firstLabelText?.slice(0, 60)}"`);
    expect(firstLabelText?.trim().length || 0).toBeGreaterThan(2);

    // Проверить что чекбокс в строке имеет адекватный размер (не растянут 100% по ширине)
    const cbBox = await page.locator('#prEmpsList input[type="checkbox"]').first().boundingBox();
    console.log(`[REG-01] checkbox size: ${cbBox?.width}x${cbBox?.height}`);
    expect(cbBox?.width || 0).toBeLessThan(30); // должен быть ~18px, не 600px

    h.assertNoConsoleErrors(errors, 'REG-01 pass picker');
  });

  test('REG-02: Gantt shows work on last days of month (TZ-safe)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.goto('https://asgard-crm.ru/#/gantt');
    await page.waitForTimeout(2000);

    // Нажать «Месяц»
    const monthBtn = page.locator('[data-gscale="month"]');
    if (await monthBtn.count() > 0) {
      await monthBtn.click();
      await page.waitForTimeout(800);
    }

    // Нажать «←» чтобы уйти в март 2026
    const prevBtn = page.locator('#g-prev');
    if (await prevBtn.count() > 0) {
      await prevBtn.click();
      await page.waitForTimeout(800);
    }

    // Проверить что на гант-доске есть хотя бы один бар с данными АРХБУМ
    const bars = page.locator('.gbar[data-gitem]');
    const barCount = await bars.count();
    console.log(`[REG-02] gantt bars count: ${barCount}`);
    expect(barCount).toBeGreaterThan(0);

    // Проверить tooltip первого бара — должен содержать 2026-03-28 или позже (не 03-27)
    const tooltips = [];
    for (let i = 0; i < Math.min(barCount, 5); i++) {
      const title = await bars.nth(i).getAttribute('title');
      if (title) tooltips.push(title);
    }
    console.log(`[REG-02] tooltips: ${JSON.stringify(tooltips, null, 2)}`);

    // Проверяем что дата в каком-то тултипе содержит 2026-03-28 или 2026-03-31 (АРХБУМ)
    const hasArkhbumDate = tooltips.some(t => t.includes('2026-03-28') || t.includes('2026-03-31'));
    if (tooltips.length > 0) {
      expect(hasArkhbumDate).toBeTruthy();
    }

    h.assertNoConsoleErrors(errors, 'REG-02 gantt TZ');
  });

  test('REG-03: Huginn group chat picker shows user names', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.goto('https://asgard-crm.ru/#/chat-groups');
    await page.waitForTimeout(1500);

    // Нажать «Новый чат» / «Создать чат»
    const newBtn = page.locator('button:has-text("Новый чат"), button:has-text("Создать чат"), button:has-text("Новая группа")').first();
    if (await newBtn.count() > 0) {
      await newBtn.click();
      await page.waitForTimeout(1000);
    } else {
      console.log('[REG-03] no "new chat" button found, skipping modal open');
    }

    // Проверить что есть items с аватарами + именами
    const selectorItems = page.locator('.emp-selector-item, .modal label');
    const itemCount = await selectorItems.count();
    console.log(`[REG-03] selector items: ${itemCount}`);

    if (itemCount > 0) {
      const firstText = await selectorItems.first().textContent();
      console.log(`[REG-03] first item text: "${firstText?.slice(0, 60)}"`);
      expect(firstText?.trim().length || 0).toBeGreaterThan(2);
    }

    h.assertNoConsoleErrors(errors, 'REG-03 huginn picker');
  });

  test('REG-04: Work card shows correct start/end dates (not -1 day)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'DIRECTOR_GEN');
    await page.goto('https://asgard-crm.ru/#/pm-works');
    await page.waitForTimeout(2000);

    // Получить raw ответ /api/works/10 через fetch — проверить формат дат
    const dates = await page.evaluate(async () => {
      const token = localStorage.getItem('asgard_token');
      const resp = await fetch('/api/data/works/10', { headers: { Authorization: 'Bearer ' + token } });
      const data = await resp.json();
      const item = data.item || {};
      return {
        start_in_work_date: item.start_in_work_date,
        end_fact: item.end_fact,
        end_plan: item.end_plan,
      };
    });
    console.log(`[REG-04] API dates: ${JSON.stringify(dates)}`);

    // Новый формат: YYYY-MM-DDT12:00:00.000Z
    expect(dates.start_in_work_date).toMatch(/^\d{4}-\d{2}-\d{2}T12:00:00\.000Z$/);
    expect(dates.end_fact).toMatch(/^\d{4}-\d{2}-\d{2}T12:00:00\.000Z$/);

    // Проверить что в любой TZ getDate() даёт правильный день
    const parsedDays = await page.evaluate((iso) => {
      return new Date(iso).getDate();
    }, dates.start_in_work_date);
    console.log(`[REG-04] parsed day of start_in_work_date: ${parsedDays}`);
    expect(parsedDays).toBe(28);

    h.assertNoConsoleErrors(errors, 'REG-04 work dates');
  });

  test('REG-05: Modal checkbox is 18px (not stretched)', async ({ page }) => {
    const errors = h.setupConsoleCollector(page);
    await h.loginAs(page, 'ADMIN');
    await page.goto('https://asgard-crm.ru/#/backup');
    await page.waitForTimeout(1500);

    // Открыть backup модалку (там есть чекбоксы wipe / keepNot)
    const restoreBtn = page.locator('button:has-text("Восстан"), button:has-text("Восстановить"), button:has-text("Импорт")').first();
    if (await restoreBtn.count() > 0) {
      await restoreBtn.click();
      await page.waitForTimeout(600);
    }

    // Проверить #wipe чекбокс
    const wipeCb = page.locator('.modal #wipe, .modal input[type="checkbox"]').first();
    if (await wipeCb.count() > 0) {
      const box = await wipeCb.boundingBox();
      console.log(`[REG-05] modal checkbox size: ${box?.width}x${box?.height}`);
      expect(box?.width || 0).toBeLessThan(30);
      expect(box?.width || 0).toBeGreaterThan(10);
    }

    h.assertNoConsoleErrors(errors, 'REG-05 modal checkbox size');
  });
});
