const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

/**
 * calc-stability.spec.js — сквозная проверка ПРОСЧЁТА тендера после большого
 * рефакторинга. Один тест: логин → карточка → окно просчёта → все вкладки →
 * таблица ДВ → смета с числовыми итогами → повторный проход (состояние не
 * теряется) → отсутствие JS-ошибок.
 *
 * Запуск:
 *   npx playwright test tests/browser/e2e/calc-stability.spec.js \
 *       --config=playwright.clone.config.js --reporter=list
 *
 * Клон: http://127.0.0.1:3100, БД asgard_crm_test, test_pm / Test123! + PIN 0000.
 * Тест НЕ правит код приложения: только читает БД, подкладывает report_json
 * через штатный PUT /api/tenders/:id/rp-review и ходит по UI.
 */

const CLONE = process.env.CLONE_URL || 'http://127.0.0.1:3100';
const OUT = path.join(__dirname, '../../../tests/reports/mimir-stages/screens');

const LOGIN = 'test_pm';
const PASSWORD = 'Test123!';
const PIN = '0000';

/**
 * Деньги в UI печатает `AsgardMoney.formatMoney` с `fractionDigits: 0` —
 * то есть рубли без копеек. Поэтому отображаемую сумму сравниваем с точной
 * с допуском 1 ₽ (два независимых округления: панель и футер). Расчёт движка
 * при этом сверяется до копейки отдельной проверкой.
 */
const SHOW_EPS = 1.0;

// Ожидаемые вкладки просчёта (порядок как в rp_calc_modal.js → TABS).
const EXPECTED_TABS = [
  { id: 'inputs', label: 'Вводные' },
  { id: 'dv', label: 'Объёмы' },
  { id: 'tech', label: 'Бригада и МТР' },
  { id: 'smeta', label: 'Смета' },
  { id: 'checklist', label: 'Чек-лист' },
  { id: 'files', label: 'Файлы' },
  { id: 'tender', label: 'Тендер' }
];

// Фикстура ДВ: 3 позиции с полями, которые читает вкладка «Объёмы».
const DV_POSITIONS = [
  {
    id: 'st1',
    name: 'Зачистка приёмного бункера КТЛ-1 №1',
    category_code: 'vessels',
    category_name: 'Ёмкостное оборудование',
    method_code: 'manual_scrape',
    method_name: 'Механическая зачистка вручную',
    volume: 875,
    unit: 'м³',
    fouling: 'heavy',
    tech_equip: 'отбойный молоток, кюбели для выгрузки',
    objects: [{ tag: 'Бункер-1' }],
    approved: true
  },
  {
    id: 'st2',
    name: 'Химическая промывка контура котла ПТВМ-50',
    category_code: 'boilers',
    category_name: 'Котлы',
    method_code: 'chem_wash',
    method_name: 'Химическая промывка',
    volume: 200,
    unit: 'м³',
    fouling: 'medium',
    tech_equip: 'насосная станция, реагентный узел',
    objects: [{ tag: 'Котёл-1' }],
    approved: true
  },
  {
    id: 'st3',
    name: 'Гидродинамическая очистка трубного пучка ТО-4',
    category_code: 'tubes',
    category_name: 'Трубное пространство',
    method_code: 'hydro',
    method_name: 'Гидродинамическая очистка',
    volume: 120,
    unit: 'м2',
    fouling: 'light',
    tech_equip: 'АВД высокого давления, гибкие шланги',
    objects: [{ tag: 'ТО-4' }],
    approved: true
  }
];

// Сметная фикстура: параметры заданы явно, чтобы расчёт был воспроизводим.
const SMETA_SEED = {
  template: 'asgard_v1',
  meta: {
    customer: 'ДЕМО Мимир',
    object: 'Котельная №1',
    title: 'Просчёт',
    executor: 'ООО «АСГАРД-Сервис»'
  },
  params: {
    shifts_per_day: 1,
    workers_per_shift: 4,
    masters_per_shift: 1,
    work_days: 10,
    road_days: 2,
    mob_days: 1,
    trip_count: 1
  },
  rows: []
};

/** «1 881 899 ₽» → 1881899. NaN если не число. */
function parseMoney(raw) {
  if (raw == null) return NaN;
  const s = String(raw)
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/₽|руб\.?/gi, '')
    .replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (s.includes(',')) return Number(s.replace(',', '.'));
  return Number(s);
}

async function apiLogin() {
  const lr = await fetch(`${CLONE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASSWORD })
  });
  const ld = await lr.json();
  expect(lr.ok, `login HTTP ${lr.status}: ${JSON.stringify(ld).slice(0, 200)}`).toBeTruthy();
  expect(ld.token, 'login вернул токен').toBeTruthy();

  const pr = await fetch(`${CLONE}/api/auth/verify-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ld.token },
    body: JSON.stringify({ pin: PIN })
  });
  const pd = await pr.json();
  expect(pr.ok, `verify-pin HTTP ${pr.status}: ${JSON.stringify(pd).slice(0, 200)}`).toBeTruthy();
  expect(pd.token, 'verify-pin вернул токен').toBeTruthy();
  return pd.token;
}

async function findDemoTenderId() {
  const db = new Client({
    host: 'localhost',
    port: 5432,
    user: 'asgard',
    password: process.env.DB_PASSWORD || '123456789',
    database: 'asgard_crm_test'
  });
  await db.connect();
  try {
    const r = await db.query(
      "SELECT id FROM tenders WHERE tender_title ILIKE '%ДЕМО Мимир%' AND deleted_at IS NULL ORDER BY id LIMIT 1"
    );
    return r.rows[0] ? r.rows[0].id : null;
  } finally {
    await db.end();
  }
}

/** Снимает состояние вкладки «Объёмы» из DOM. */
async function readDv(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-panel="dv"]');
    // Позиции — карточками (переделано 06.11: таблица на 9 колонок не читалась).
    const cards = panel ? Array.from(panel.querySelectorAll('.rp-calc-dv-card')) : [];
    const rows = cards.map((card) => {
      const grid = {};
      card.querySelectorAll('.rp-calc-dv-card__grid > div').forEach((d) => {
        const k = ((d.querySelector('dt') || {}).textContent || '').trim();
        const v = ((d.querySelector('dd') || {}).textContent || '').trim();
        if (k) grid[k] = v;
      });
      return {
        id: card.getAttribute('data-dv-pos'),
        name: ((card.querySelector('h4') || {}).textContent || '').trim(),
        meta: ((card.querySelector('.rp-calc-dv-card__meta') || {}).textContent || '').trim(),
        tech: ((card.querySelector('.rp-calc-dv-card__tech p') || {}).textContent || '').trim(),
        grid
      };
    });
    return {
      hasPanel: !!panel,
      panelHeight: panel ? panel.offsetHeight : 0,
      hasTable: cards.length > 0,
      tableCount: document.querySelectorAll('.rp-calc-dv-card').length,
      headers: ['Позиция', 'Метод', 'Отложения', 'Люди', 'Сутки'],
      rows
    };
  });
}

/** Снимает состояние вкладки «Смета» из DOM: таблица, итоги панели, KPI футера. */
async function readSmeta(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-panel="smeta"]');
    const table = panel ? panel.querySelector('.rp-calc-smeta') : null;
    const kpis = {};
    if (panel) {
      panel.querySelectorAll('.rp-calc-smeta-totals .kpi').forEach((k) => {
        const label = ((k.querySelector('span') || {}).textContent || '').trim();
        const value = ((k.querySelector('b') || {}).textContent || '').trim();
        kpis[label.replace(/\s*\(.*\)$/, '')] = value;
      });
    }
    const footer = {};
    document.querySelectorAll('[data-rp-calc-root] .rp-calc-footer [data-kpi]').forEach((el) => {
      footer[el.getAttribute('data-kpi')] = (el.textContent || '').trim();
    });
    const rowIds = table
      ? Array.from(table.querySelectorAll('tbody tr')).map((tr) => tr.getAttribute('data-row-id'))
      : [];
    return {
      hasPanel: !!panel,
      panelHeight: panel ? panel.offsetHeight : 0,
      hasTable: !!table,
      tableCount: document.querySelectorAll('.rp-calc-smeta').length,
      rows: rowIds.length,
      rowIds,
      emptyBanner: !!document.querySelector('.rp-calc-smeta-empty'),
      kpis,
      footer
    };
  });
}

test('ПРОСЧЁТ тендера: стабильность после рефакторинга (все вкладки, ДВ, смета)', async ({ page }) => {
  test.setTimeout(180000);

  // ── 0. Ошибки JS на всю сессию ───────────────────────────────
  const consoleErrors = [];
  const pageErrors = [];
  const apiFailures = [];
  let modalOpened = false;

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));
  page.on('response', (res) => {
    const u = res.url();
    if (res.status() >= 400 && u.includes('/api/')) {
      apiFailures.push({ status: res.status(), url: u, afterModalOpen: modalOpened });
    }
  });

  // ── 1. Логин через API ───────────────────────────────────────
  const token = await apiLogin();
  console.log('[auth] токен получен, длина', token.length);

  // ── 2. Тендер из БД ──────────────────────────────────────────
  const tenderId = await findDemoTenderId();
  test.skip(!tenderId, 'в asgard_crm_test нет тендера [ДЕМО Мимир]');
  console.log('[db] tender_id =', tenderId);

  // ── 3. Подкладываем данные анализа ───────────────────────────
  // Смету считаем тем же движком, что и фронт (public/assets/js/asgard_smeta.js):
  // так тест проверяет и сходимость расчёта, и идентичность браузерного зеркала.
  // eslint-disable-next-line global-require
  require(path.join(__dirname, '../../../public/assets/js/asgard_smeta.js'));
  const S = globalThis.AsgardSmeta;
  expect(S && typeof S.recalcAsgardSmeta === 'function', 'движок сметы AsgardSmeta загружен').toBeTruthy();

  const seedSmeta = S.recalcAsgardSmeta(SMETA_SEED);
  const expected = seedSmeta.totals || {};
  console.log(
    '[smeta:node] cost =', expected.cost,
    '| без НДС =', expected.price_no_vat,
    '| с НДС =', expected.price_with_vat,
    '| строк =', (seedSmeta.rows || []).length
  );
  expect(Number(expected.price_with_vat), 'фикстура сметы посчитана (> 0)').toBeGreaterThan(0);

  const getReview = await fetch(`${CLONE}/api/tenders/${tenderId}/rp-review`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  expect(getReview.ok, `GET rp-review HTTP ${getReview.status}`).toBeTruthy();
  const reviewPayload = await getReview.json();
  const currentReport = (() => {
    let rj = reviewPayload.review && reviewPayload.review.report_json;
    if (typeof rj === 'string') { try { rj = JSON.parse(rj); } catch (_) { rj = {}; } }
    return rj && typeof rj === 'object' ? rj : {};
  })();

  const nextReport = Object.assign({}, currentReport, {
    mode: 'calc',
    summary: currentReport.summary || 'Просчёт: проверка стабильности',
    dv_positions: DV_POSITIONS,
    asgard_smeta: seedSmeta,
    cost_without_vat: Math.round(Number(expected.cost) || 0)
  });

  const put = await fetch(`${CLONE}/api/tenders/${tenderId}/rp-review`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ mode: 'calc', report_json: nextReport })
  });
  const putBody = await put.json().catch(() => ({}));
  expect(put.ok, `PUT rp-review HTTP ${put.status}: ${JSON.stringify(putBody).slice(0, 300)}`).toBeTruthy();
  console.log('[api] report_json сохранён: dv =', DV_POSITIONS.length, ', asgard_smeta.rows =', (seedSmeta.rows || []).length);

  // ── 4. Открываем окно просчёта ───────────────────────────────
  await page.goto(`${CLONE}/#/welcome`, { waitUntil: 'commit' });
  await page.evaluate((t) => {
    localStorage.setItem('asgard_token', t);
    localStorage.setItem('token', t);
  }, token);
  await page.goto(`${CLONE}/#/tenders-registry`, { waitUntil: 'commit' });
  await page.waitForFunction(
    () => typeof window.AsgardRpCalcModal === 'object' && typeof window.AsgardSmeta === 'object',
    null,
    { timeout: 30000 }
  );

  await page.evaluate(async (tid) => {
    const auth = 'Bearer ' + localStorage.getItem('asgard_token');
    const d = await fetch(`/api/tenders/${tid}/rp-review`, { headers: { Authorization: auth } })
      .then((r) => r.json());
    window.AsgardRpCalcModal.open(d.tender || { id: tid }, [], function () {}, { mode: 'calc' });
  }, tenderId);

  await page.waitForSelector('[data-rp-calc-root] .rp-calc-tab', { timeout: 25000 });
  modalOpened = true;
  await page.waitForTimeout(1200);

  // ── 5. Все вкладки: клик → панель существует и видима ────────
  const tabButtons = await page.locator('.rp-calc-tab').evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute('data-rp-tab'),
      label: (el.textContent || '').trim(),
      active: el.classList.contains('is-active')
    }))
  );
  console.log('[tabs] найдено:', JSON.stringify(tabButtons.map((t) => `${t.id}:${t.label}`)));

  async function walkTabs() {
    const results = [];
    for (const expectedTab of EXPECTED_TABS) {
      const sel = `.rp-calc-tab[data-rp-tab="${expectedTab.id}"]`;
      const btn = page.locator(sel);
      if ((await btn.count()) === 0) {
        results.push({ ...expectedTab, exists: false, visible: false, height: 0, activeLabel: '', text: null, fail: 'нет кнопки вкладки' });
        continue;
      }
      await btn.first().click({ force: true });
      await page.waitForTimeout(700);

      // Активная панель должна реально отрисоваться: у неактивных CSS display:none.
      let height = 0;
      for (let i = 0; i < 12; i += 1) {
        height = await page.evaluate((id) => {
          const el = document.querySelector(`[data-panel="${id}"]`);
          return el ? el.offsetHeight : 0;
        }, expectedTab.id);
        if (height > 0) break;
        await page.waitForTimeout(250);
      }

      const panelInfo = await page.evaluate((id) => {
        const el = document.querySelector(`[data-panel="${id}"]`);
        if (!el) return { exists: false, text: null };
        const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
        return { exists: true, text: text.slice(0, 200) };
      }, expectedTab.id);

      const activeLabel = (await page.locator('.rp-calc-tab.is-active').first().innerText().catch(() => '')).trim();
      results.push({
        ...expectedTab,
        exists: panelInfo.exists,
        visible: height > 0,
        height,
        activeLabel,
        text: panelInfo.text,
        fail: !panelInfo.exists
          ? 'панели нет в DOM'
          : (height > 0 ? null : 'панель есть, но offsetHeight = 0 (не отрисовалась)')
      });
    }
    return results;
  }

  const tabResults = await walkTabs();

  console.log('\n===== ВКЛАДКИ ПРОСЧЁТА (проход 1) =====');
  for (const r of tabResults) {
    console.log(
      `${r.fail ? 'FAIL' : ' OK '} | ${String(r.label).padEnd(14)} | data-rp-tab=${String(r.id).padEnd(9)}` +
      ` | панель=${r.exists ? 'есть' : 'НЕТ'} | height=${r.height}` +
      (r.activeLabel ? ` | активна="${r.activeLabel}"` : '') +
      (r.fail ? ` | ${r.fail}` : '')
    );
    if (r.text) console.log(`       текст: ${r.text}`);
  }

  // ── 6. «Объёмы»: таблица ДВ и строки ─────────────────────────
  await page.locator('.rp-calc-tab[data-rp-tab="dv"]').first().click({ force: true });
  await page.waitForTimeout(700);
  const dvFirst = await readDv(page);

  console.log('\n===== ВКЛАДКА «ОБЪЁМЫ» =====');
  console.log('таблица ДВ:', dvFirst.hasTable ? 'есть' : 'НЕТ', '| экземпляров:', dvFirst.tableCount, '| строк:', dvFirst.rows.length);
  console.log('колонки:', JSON.stringify(dvFirst.headers));
  console.log('первая позиция:', JSON.stringify(dvFirst.rows[0] || null));

  // ── 7. «Смета»: таблица и числовой итог ──────────────────────
  await page.locator('.rp-calc-tab[data-rp-tab="smeta"]').first().click({ force: true });
  await page.waitForTimeout(900);
  const smetaFirst = await readSmeta(page);

  const num = {
    cost: parseMoney(smetaFirst.kpis['Себестоимость']),
    noVat: parseMoney(smetaFirst.kpis['Без НДС']),
    withVat: parseMoney(smetaFirst.kpis['С НДС']),
    footerCost: parseMoney(smetaFirst.footer.cost),
    footerNoVat: parseMoney(smetaFirst.footer.price_no_vat),
    footerWithVat: parseMoney(smetaFirst.footer.price_with_vat)
  };

  console.log('\n===== ВКЛАДКА «СМЕТА» =====');
  console.log('таблица:', smetaFirst.hasTable ? 'есть' : 'НЕТ', '| строк:', smetaFirst.rows, '| баннер «не рассчитана»:', smetaFirst.emptyBanner);
  console.log('итоги в панели:', JSON.stringify(smetaFirst.kpis));
  console.log('KPI в футере:', JSON.stringify(smetaFirst.footer));

  // Браузерное зеркало движка сверяем с node-расчётом до копейки.
  const browserTotals = await page.evaluate((seed) => {
    const rows = window.AsgardSmeta.recalcAsgardSmeta(seed);
    return rows && rows.totals ? rows.totals : null;
  }, SMETA_SEED);
  console.log('[smeta:browser] cost =', browserTotals && browserTotals.cost,
    '| без НДС =', browserTotals && browserTotals.price_no_vat,
    '| с НДС =', browserTotals && browserTotals.price_with_vat);

  // ── 8. Повторный проход: состояние не теряется ───────────────
  const tabResults2 = await walkTabs();
  await page.locator('.rp-calc-tab[data-rp-tab="dv"]').first().click({ force: true });
  await page.waitForTimeout(700);
  const dvSecond = await readDv(page);
  await page.locator('.rp-calc-tab[data-rp-tab="smeta"]').first().click({ force: true });
  await page.waitForTimeout(900);
  const smetaSecond = await readSmeta(page);
  const numSecond = {
    cost: parseMoney(smetaSecond.kpis['Себестоимость']),
    noVat: parseMoney(smetaSecond.kpis['Без НДС']),
    withVat: parseMoney(smetaSecond.kpis['С НДС'])
  };

  console.log('\n===== ПОВТОРНЫЙ ПРОХОД (стабильность) =====');
  console.log('вкладки: OK', tabResults2.filter((r) => !r.fail).length, '/', tabResults2.length);
  console.log('ДВ строк: было', dvFirst.rows.length, '→ стало', dvSecond.rows.length);
  console.log('Смета строк: было', smetaFirst.rows, '→ стало', smetaSecond.rows);
  console.log('Смета с НДС: было', num.withVat, '→ стало', numSecond.withVat);

  // ── 9. Ошибки JS ────────────────────────────────────────────
  // Известные: 500 от /api/, mango, WRITE_PROTECTED. «Failed to load resource»
  // без URL в тексте — это те же 500, поэтому опираемся на apiFailures.
  const KNOWN_TEXT = [/mango/i, /WRITE_PROTECTED/i];
  const knownApi500 = apiFailures.filter((f) => f.status === 500);
  const unknownApiFailures = apiFailures.filter((f) => f.status !== 500);
  const rpCriticalFailures = apiFailures.filter(
    (f) => /\/api\/tenders\/\d+\/rp-review|\/api\/tkp-quick\//.test(f.url)
  );

  const isKnownConsole = (txt) => {
    if (KNOWN_TEXT.some((re) => re.test(txt))) return true;
    if (/Failed to load resource/i.test(txt) && /status of 500/i.test(txt)) return true;
    if (/status of 500.*\/api\//i.test(txt) || /\/api\/.*status of 500/i.test(txt)) return true;
    return false;
  };
  const realConsoleErrors = consoleErrors.filter((t) => !isKnownConsole(t));
  const realPageErrors = pageErrors.filter((t) => !KNOWN_TEXT.some((re) => re.test(t)));

  console.log('\n===== ОШИБКИ JS =====');
  console.log('pageerror:', pageErrors.length ? JSON.stringify(pageErrors) : 'нет');
  console.log('console.error всего:', consoleErrors.length, realConsoleErrors.length ? '| нефильтрованных: ' + JSON.stringify(realConsoleErrors) : '| все известные (500 /api/, mango, WRITE_PROTECTED)');
  console.log('HTTP >=400 по /api/:', apiFailures.length ? JSON.stringify(apiFailures.map((f) => `${f.status} ${f.url}`)) : 'нет');
  console.log('из них 500 (известные, вне просчёта):', knownApi500.length);
  console.log('из них критичные для просчёта (rp-review / tkp-quick):', rpCriticalFailures.length);
  console.log('неизвестные статусы (не 500):', unknownApiFailures.length ? JSON.stringify(unknownApiFailures) : 'нет');

  fs.mkdirSync(OUT, { recursive: true });
  const shot = path.join(OUT, '98-calc-stability.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log('скриншот:', shot);

  // ── Ассерты ─────────────────────────────────────────────────
  const fails = [];

  // 1) Все семь вкладок на месте, подписи совпадают.
  for (const et of EXPECTED_TABS) {
    const found = tabButtons.find((t) => t.id === et.id);
    if (!found) fails.push(`вкладка ${et.id} (${et.label}) отсутствует в .rp-calc-tab`);
    else if (found.label !== et.label) fails.push(`вкладка ${et.id}: подпись «${found.label}» вместо «${et.label}»`);
  }

  // 2) Каждая панель существует и видима после клика.
  for (const r of tabResults) if (r.fail) fails.push(`вкладка ${r.id} (${r.label}): ${r.fail}`);

  // 3) ДВ: карточки позиций — ровно столько, сколько подложено.
  if (!dvFirst.hasTable) fails.push('вкладка «Объёмы»: нет карточек .rp-calc-dv-card');
  if (!(dvFirst.rows.length > 0)) fails.push('вкладка «Объёмы»: 0 карточек позиций');
  if (dvFirst.rows.length !== DV_POSITIONS.length) {
    fails.push(`вкладка «Объёмы»: карточек ${dvFirst.rows.length}, а подложено позиций ${DV_POSITIONS.length}`);
  }
  const dvIds = dvFirst.rows.map((r) => r.id).filter(Boolean);
  for (const p of DV_POSITIONS) {
    if (!dvIds.includes(p.id)) fails.push(`вкладка «Объёмы»: нет карточки позиции «${p.id}» (${p.name})`);
  }
  if (dvFirst.rows.some((r) => !r.grid || !('Метод' in r.grid))) {
    fails.push('вкладка «Объёмы»: в карточке нет поля «Метод»');
  }

  // 4) Смета: таблица + числовые итоги (не NaN, не пусто, > 0).
  if (!smetaFirst.hasTable) fails.push('вкладка «Смета»: нет таблицы .rp-calc-smeta');
  if (!(smetaFirst.rows > 0)) fails.push('вкладка «Смета»: 0 строк в .rp-calc-smeta tbody tr');
  if (smetaFirst.emptyBanner) fails.push('вкладка «Смета»: показан баннер «Смета не рассчитана» при подложенном расчёте');
  const shownRaw = {
    cost: smetaFirst.kpis['Себестоимость'],
    noVat: smetaFirst.kpis['Без НДС'],
    withVat: smetaFirst.kpis['С НДС']
  };
  for (const [label, value] of Object.entries(num)) {
    if (!Number.isFinite(value)) {
      fails.push(`вкладка «Смета»: итог «${label}» не число: ${JSON.stringify(shownRaw[label] || smetaFirst.footer[label])}`);
    } else if (!(value > 0)) {
      fails.push(`вкладка «Смета»: итог «${label}» = ${value} (ожидалось > 0)`);
    }
  }
  if (Number.isFinite(num.withVat) && Number.isFinite(num.noVat) && !(num.withVat > num.noVat)) {
    fails.push(`смета: «С НДС» (${num.withVat}) не больше «Без НДС» (${num.noVat})`);
  }
  if (Number.isFinite(num.noVat) && Number.isFinite(num.cost) && !(num.noVat > num.cost)) {
    fails.push(`смета: «Без НДС» (${num.noVat}) не больше себестоимости (${num.cost})`);
  }

  // 5) НДС по ставке 22 % (допуск — округление отображения до рубля).
  const actualVat = num.withVat - num.noVat;
  if (Number.isFinite(actualVat) && Number.isFinite(num.noVat) && Math.abs(actualVat - num.noVat * 0.22) > SHOW_EPS) {
    fails.push(`смета: НДС ${actualVat.toFixed(2)} ≠ 22 % от ${num.noVat} (= ${(num.noVat * 0.22).toFixed(2)})`);
  }

  // 6) Панель и футер показывают одно и то же (модель не разъехалась).
  if (Number.isFinite(num.withVat) && Number.isFinite(num.footerWithVat) && Math.abs(num.withVat - num.footerWithVat) > SHOW_EPS) {
    fails.push(`смета: итог панели «С НДС» (${num.withVat}) ≠ KPI футера (${num.footerWithVat})`);
  }
  if (Number.isFinite(num.cost) && Number.isFinite(num.footerCost) && Math.abs(num.cost - num.footerCost) > SHOW_EPS) {
    fails.push(`смета: итог панели «Себестоимость» (${num.cost}) ≠ KPI футера (${num.footerCost})`);
  }

  // 7) Браузерное зеркало сметы == node-расчёт, до копейки (источник истины один).
  for (const key of ['cost', 'price_no_vat', 'price_with_vat']) {
    const a = Number(browserTotals && browserTotals[key]);
    const b = Number(expected[key]);
    if (!Number.isFinite(a)) fails.push(`движок в браузере: totals.${key} не число (${browserTotals && browserTotals[key]})`);
    else if (Math.abs(a - b) > 0.01) fails.push(`движок в браузере: totals.${key} = ${a}, node посчитал ${b}`);
  }

  // 8) Показанные суммы соответствуют расчёту с точностью до рубля.
  for (const [label, shown, exact] of [
    ['Себестоимость', num.cost, Number(expected.cost)],
    ['Без НДС', num.noVat, Number(expected.price_no_vat)],
    ['С НДС', num.withVat, Number(expected.price_with_vat)]
  ]) {
    if (Number.isFinite(shown) && Number.isFinite(exact) && Math.abs(shown - exact) > SHOW_EPS) {
      fails.push(`смета: показано «${label}» ${shown}, расчёт движка ${exact} (дельта ${(shown - exact).toFixed(2)})`);
    }
  }

  // 9) Повторный проход: вкладки и данные не потерялись.
  for (const r of tabResults2) if (r.fail) fails.push(`повторный проход, вкладка ${r.id} (${r.label}): ${r.fail}`);
  if (dvSecond.rows.length !== dvFirst.rows.length) {
    fails.push(`повторный проход: строк ДВ ${dvSecond.rows.length} вместо ${dvFirst.rows.length}`);
  }
  if (smetaSecond.rows !== smetaFirst.rows) {
    fails.push(`повторный проход: строк сметы ${smetaSecond.rows} вместо ${smetaFirst.rows}`);
  }
  if (Number.isFinite(num.withVat) && Number.isFinite(numSecond.withVat) && Math.abs(num.withVat - numSecond.withVat) > SHOW_EPS) {
    fails.push(`повторный проход: «С НДС» стало ${numSecond.withVat} вместо ${num.withVat}`);
  }

  // 10) Ошибки JS: только известные исключения.
  if (realPageErrors.length) fails.push('pageerror: ' + realPageErrors.join(' | '));
  if (realConsoleErrors.length) fails.push('console.error: ' + realConsoleErrors.join(' | '));
  if (unknownApiFailures.length) {
    fails.push('HTTP не-500 ошибки по /api/: ' + unknownApiFailures.map((f) => `${f.status} ${f.url}`).join(' | '));
  }
  if (rpCriticalFailures.length) {
    fails.push('ошибки API внутри просчёта: ' + rpCriticalFailures.map((f) => `${f.status} ${f.url}`).join(' | '));
  }

  console.log('\n===== ВЕРДИКТ =====');
  if (fails.length) {
    console.log('FAIL, найдено проблем:', fails.length);
    fails.forEach((f, i) => console.log(`  ${i + 1}) ${f}`));
  } else {
    console.log(
      'PASS: 7/7 вкладок открылись, ДВ', dvFirst.rows.length,
      'строк, смета с НДС =', num.withVat, '(движок', expected.price_with_vat + '),',
      'ошибок JS нет'
    );
  }

  expect(fails, 'FAIL:\n' + fails.map((f, i) => `${i + 1}) ${f}`).join('\n')).toEqual([]);
});
