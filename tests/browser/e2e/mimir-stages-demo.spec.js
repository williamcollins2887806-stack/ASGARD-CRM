const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * mimir-stages-demo.spec.js — визуальная и функциональная проверка этапов.
 *
 * Ключевые проверки после доработки:
 *   • в анализе НЕТ этапа сметы (рельс заканчивается решением);
 *   • в таблице объёмов можно менять поля, согласовывать, удалять, добавлять;
 *   • на экране решения есть блок «позвонить клиенту» с вопросами;
 *   • загрузка файла работает прямо из модалки;
 *   • нет английских слов в видимом тексте, нет «undefined».
 */
const CLONE = process.env.CLONE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.CLONE_LOGIN || 'test_pm';
const PASS = process.env.CLONE_PASS || 'Test123!';
const PIN = process.env.CLONE_PIN || '0000';
const SHOTS = path.join(__dirname, '../../../tests/reports/mimir-stages/screens');

async function apiToken() {
  const lr = await fetch(`${CLONE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS })
  });
  const ld = await lr.json();
  if (!ld.token) throw new Error('login failed');
  if (ld.status === 'ok') return ld.token;
  const pr = await fetch(`${CLONE}/api/auth/verify-pin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ld.token },
    body: JSON.stringify({ pin: PIN })
  });
  const pd = await pr.json();
  if (!pd.token) throw new Error('verify-pin failed');
  return pd.token;
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

async function setStage(token, uid, stage, state, version) {
  const r = await fetch(`${CLONE}/api/tkp-quick/sessions/${encodeURIComponent(uid)}/stage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ stage, state, expected_version: version })
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

async function openModal(page, uid) {
  await page.evaluate((u) => {
    if (window.AsgardMimirStages) {
      window.AsgardMimirStages.close();
      window.AsgardMimirStages.open({ sessionUid: u, title: 'Анализ тендера · демо', subtitle: 'Демо · проверка этапов' });
    }
  }, uid);
  // Ждём именно появления модалки, а не фиксированную паузу: после reset
  // сервер отвечает дольше, и фиксированные 1100 мс не хватали.
  await page.waitForSelector('.mst-modal', { timeout: 15000 });
  await page.waitForTimeout(600);
}

const POSITIONS = [
  {
    id: 'p1', name: 'Промывка котла К-1', category_code: 'boilers', method_code: 'chem',
    volume: 2, unit: 'м³', fouling: 'heavy',
    tech_equip: 'Кислота с ингибитором, станция промывки, 2 цикла, нейтрализация',
    tech_status: 'ai', approved: true, needs_classification: false, problems: [],
    objects: [{ tag: 'К-1', type: 'котёл', size: '2 м³' }],
    source_ref: { document: 'ТЗ.pdf', fragment: 'п.3.1 промывка котла К-1' },
    norm: { code: 'boiler_chem_hours', work_days: 2, crew: { master: 1, exec: 3 }, trace: ['12 ч/цикл × 2 цикла'] }
  },
  {
    id: 'p2', name: 'Сварка шва Ду159', category_code: 'repair_weld', method_code: 'weld',
    volume: 12, unit: 'м', fouling: null,
    tech_equip: 'Инвертор 250 А, электроды УОНИ, режим по НАКС',
    tech_status: 'rp', approved: false, needs_classification: false, problems: [],
    objects: [{ tag: 'ТП-1', type: 'трубопровод' }],
    source_ref: { document: 'Ведомость.xlsx', fragment: 'стр.4' },
    norm: { code: 'weld_joint_shift', work_days: 1, crew: { master: 1, exec: 2 }, trace: ['2,1 стык/смену'] }
  }
];

const STATE = {
  gaps: [],
  positions: POSITIONS,
  calc: { positions: [], work_days: null },
  decision: { go: true }
};

test.describe('Мимир: этапы на клоне', () => {
  test.setTimeout(240000);

  test('анализ без сметы, действия в объёмах, звонок клиенту', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

    const token = await apiToken();
    await page.goto(`${CLONE}/#/welcome`, { waitUntil: 'commit' });
    await page.evaluate((t) => {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('token', t);
    }, token);
    await page.goto(`${CLONE}/#/pm-calculations`, { waitUntil: 'commit' });
    await page.waitForTimeout(1800);

    const uid = await page.evaluate(async () => {
      const r = await fetch('/api/tkp-quick/sessions', {
        headers: { Authorization: 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      return (await r.json()).sessions?.[0]?.session_uid || null;
    });
    expect(uid, 'нужна демо-сессия').toBeTruthy();

    await fetch(`${CLONE}/api/tkp-quick/sessions/${uid}/stage/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ to: 'intake' })
    });

    // C1: приём — есть загрузка файлом
    await openModal(page, uid);
    await expect(page.locator('.mst-modal')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-act="pick-files"]')).toBeVisible();
    await expect(page.locator('[data-file-input]').getAttribute('type')).resolves.toBe('file');
    await shot(page, '01-intake');
    await expect(page.locator('[data-main-action]')).toHaveText('Запустить анализ');

    // C4: объёмы — правка, согласование, добавление, удаление
    let ver = 0;
    let r = await setStage(token, uid, 'read', STATE, ver);
    ver = r.data.version;
    r = await setStage(token, uid, 'dv', STATE, ver);
    expect(r.status).toBe(200);
    await openModal(page, uid);

    await expect(page.locator('.mst-table tbody tr')).toHaveCount(2);
    await expect(page.locator('[data-pos-field="volume"]')).toHaveCount(2);
    await expect(page.locator('[data-pos-field="method"]')).toHaveCount(2);
    await expect(page.locator('[data-act="approve-pos"]')).toHaveCount(2);
    await expect(page.locator('[data-act="delete-pos"]')).toHaveCount(2);
    await expect(page.locator('[data-act="add-position"]')).toBeVisible();
    await shot(page, '04-dv');

    // Меняем объём первой позиции — значение должно сохраниться на сервере.
    const volInput = page.locator('[data-pos="p1"] [data-pos-field="volume"]');
    await volInput.fill('3.5');
    await volInput.dispatchEvent('change');
    await page.waitForTimeout(1200);    const savedVol = await page.evaluate(async (u) => {
      const res = await fetch(`/api/tkp-quick/sessions/${u}/stage`, {
        headers: { Authorization: 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      const d = await res.json();
      return (d.state.positions || []).find((p) => p.id === 'p1')?.volume;
    }, uid);
    expect(Number(savedVol), 'объём сохранён').toBe(3.5);

    // Согласование второй позиции.
    await page.locator('[data-pos="p2"] [data-act="approve-pos"]').click();
    await page.waitForTimeout(1000);
    const savedApproved = await page.evaluate(async (u) => {
      const res = await fetch(`/api/tkp-quick/sessions/${u}/stage`, {
        headers: { Authorization: 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      const d = await res.json();
      return (d.state.positions || []).find((p) => p.id === 'p2')?.approved;
    }, uid);
    expect(savedApproved, 'позиция согласована').toBe(true);

    // Добавление позиции.
    await page.locator('[data-act="add-position"]').first().click();
    await page.waitForTimeout(1000);
    await expect(page.locator('.mst-table tbody tr')).toHaveCount(3);
    await shot(page, '04-dv-actions');

    // C6: решение — блок звонка и отсутствие сметы в рельсе.
    // Идём от reset, чтобы версия состояния была предсказуемой: прошлые
    // правки позиций меняли версию, и переход молча не применялся.
    await fetch(`${CLONE}/api/tkp-quick/sessions/${uid}/stage/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ to: 'intake' })
    });
    // Версия после reset — читаем фактическую: она монотонно растёт и не
    // сбрасывается, поэтому «0» всегда даёт 409.
    const verAfterReset = await page.evaluate(async (u) => {
      const res = await fetch(`/api/tkp-quick/sessions/${u}/stage`, {
        headers: { Authorization: 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      return (await res.json()).version;
    }, uid);

    let step = await setStage(token, uid, 'read', STATE, verAfterReset);
    expect(step.status, 'переход в чтение: ' + JSON.stringify(step.data).slice(0, 150)).toBe(200);
    step = await setStage(token, uid, 'dv', STATE, step.data.version);
    expect(step.status, 'переход к объёмам').toBe(200);
    step = await setStage(token, uid, 'tech', STATE, step.data.version);
    expect(step.status, 'переход к технологии').toBe(200);
    step = await setStage(token, uid, 'decision', STATE, step.data.version);
    expect(step.status, 'переход к решению: ' + JSON.stringify(step.data).slice(0, 150)).toBe(200);

    await openModal(page, uid);
    // Дождаться именно экрана решения, а не «Технологии».
    await expect(page.locator('.mst-step.is-now')).toContainText('Решение', { timeout: 10000 });
    await expect(page.locator('.mst-callout')).toBeVisible();
    await expect(page.locator('.mst-callout__list li').first()).toBeVisible();
    await expect(page.locator('.mst-callnote')).toContainText('Смета на этом этапе не считается');
    await shot(page, '06-decision');

    // В анализе нет шагов сметы: рельс заканчивается решением/итогом.
    const railText = await page.locator('.mst-rail').innerText();
    expect(railText).not.toContain('Смета');
    expect(railText).not.toContain('Люди и сроки');

    // Нет английских слов в видимом тексте и «undefined».
    const mainText = await page.locator('.mst-main').innerText();
    expect(mainText).not.toContain('undefined');
    // Проверяем только явные англицизмы, которых не должно быть в интерфейсе.
    for (const bad of ['undefined', 'null', 'NaN', 'stage', 'gap_id']) {
      expect(mainText.toLowerCase()).not.toContain(bad.toLowerCase());
    }

    const real = consoleErrors.filter((e) => !/Failed to load resource/i.test(e));
    expect(real, 'console errors: ' + real.join(' | ')).toHaveLength(0);
  });

  test('ширины, светлая тема, геометрия', async ({ page }) => {
    const token = await apiToken();
    await page.goto(`${CLONE}/#/welcome`, { waitUntil: 'commit' });
    await page.evaluate((t) => {
      localStorage.setItem('asgard_token', t);
      localStorage.setItem('token', t);
    }, token);
    await page.goto(`${CLONE}/#/pm-calculations`, { waitUntil: 'commit' });
    await page.waitForTimeout(1500);

    const uid = await page.evaluate(async () => {
      const r = await fetch('/api/tkp-quick/sessions', {
        headers: { Authorization: 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      return (await r.json()).sessions?.[0]?.session_uid || null;
    });
    test.skip(!uid, 'нет демо-сессии');

    for (const w of [360, 768, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(300);
      await openModal(page, uid);
      const box = await page.locator('.mst-modal').boundingBox();
      expect(box, `модалка видна на ${w}`).toBeTruthy();
      expect(box.width, `не шире экрана на ${w}`).toBeLessThanOrEqual(w + 1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `горизонтальный скролл на ${w}`).toBeLessThanOrEqual(1);

      const btn = page.locator('[data-main-action]');
      const bbox = await btn.boundingBox();
      expect(bbox.width, `кнопка не схлопнулась на ${w}`).toBeGreaterThan(60);
      expect(bbox.y + bbox.height, `кнопка в пределах экрана на ${w}`).toBeLessThanOrEqual(900);

      const footBox = await page.locator('.mst-foot').boundingBox();
      const modalBox = await page.locator('.mst-modal').boundingBox();
      expect(footBox.y + footBox.height, `футер внутри модалки на ${w}`)
        .toBeLessThanOrEqual(modalBox.y + modalBox.height + 1);

      await shot(page, `10-width-${w}`);

      if (w === 360) {
        const sideBox = await page.locator('.mst-side').boundingBox();
        expect(sideBox.height, 'панель хода не выше 30% экрана на 360').toBeLessThan(900 * 0.3);
        const mainBox = await page.locator('.mst-main').boundingBox();
        expect(mainBox.height, 'контент занимает больше половины высоты').toBeGreaterThan(900 * 0.5);
      }

      if (w === 1440) {
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
        await page.waitForTimeout(400);
        await shot(page, '11-light');
        await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      }
    }
  });
});
