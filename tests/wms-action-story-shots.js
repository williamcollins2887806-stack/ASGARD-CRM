'use strict';
/**
 * Action-story screenshots: каждое действие = отдельный PNG + баннер «что делаем».
 * Артефакты: tests/reports/wms-action-story/
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

process.env.TEST_BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const BASE = process.env.TEST_BASE_URL.replace(/\/$/, '');
const OUT = path.join(__dirname, 'reports', 'wms-action-story');
const FIX = path.join(__dirname, 'fixtures', 'wms-cart-scenario-a.xlsx');
fs.mkdirSync(OUT, { recursive: true });

const ACCOUNTS = {
  PM: { login: 'test_pm', password: 'Test123!', pin: '0000' },
  PROC: { login: 'test_proc', password: 'Test123!', pin: '0000' },
};

const report = { started_at: new Date().toISOString(), base: BASE, shots: [], ids: {} };
let stepNo = 0;

async function login(role) {
  const a = ACCOUNTS[role];
  let lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: a.login, password: a.password }),
  }).then((r) => r.json());
  if (lr.status === 'need_pin') {
    lr = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lr.token },
      body: JSON.stringify({ pin: a.pin }),
    }).then((r) => r.json());
  }
  if (!lr.token) throw new Error(role + ' login fail');
  return { token: lr.token, user: lr.user, role };
}

async function api(auth, method, urlPath, body) {
  const opts = { method, headers: { Authorization: 'Bearer ' + auth.token } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + urlPath, opts);
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function markPresence(auth) {
  await api(auth, 'POST', '/api/daily-presence', { status_code: 'оф' }).catch(() => {});
}

async function clearCart(auth) {
  const cart = await api(auth, 'GET', '/api/warehouse-cart');
  for (const it of cart.data.items || []) {
    await api(auth, 'DELETE', '/api/warehouse-cart/items/' + it.id);
  }
}

async function dismiss(page) {
  await page.evaluate(() => {
    const gate = document.getElementById('asgard-presence-gate');
    if (gate) {
      const office = [...gate.querySelectorAll('button')].find((b) => /В офисе/i.test(b.textContent || ''));
      if (office) office.click();
    }
  }).catch(() => {});
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const gate = document.getElementById('asgard-presence-gate');
    if (!gate) return;
    const go = gate.querySelector('#pg-save');
    if (go) go.click();
    else gate.remove();
  }).catch(() => {});
  for (const t of ['Позже', 'Понял', 'Закрыть', 'Не сейчас']) {
    await page.getByRole('button', { name: new RegExp('^' + t + '$', 'i') }).first().click({ timeout: 400 }).catch(() => {});
  }
  await page.evaluate(() => {
    document.querySelectorAll('.modal, .cr-m-overlay').forEach((el) => {
      const txt = el.textContent || '';
      if (/свитк|отстаёте|Информационная безопасность|Пройти сейчас/i.test(txt)) {
        try { el.remove(); } catch (_) {}
      }
    });
  }).catch(() => {});
}

async function openDesktop(browser, auth, hash) {
  const today = new Date().toISOString().slice(0, 10);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ token, user, today }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('presence_done_' + today, '1');
  }, { token: auth.token, user: auth.user, today });
  const page = await context.newPage();
  await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
  await page.evaluate(async () => {
    try {
      if (navigator.serviceWorker) {
        for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      }
      if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    } catch (_) {}
  }).catch(() => {});
  await page.goto(BASE + '/?nocache=' + Date.now() + hash, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForTimeout(2200);
  await dismiss(page);
  return { context, page };
}

async function banner(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById('e2e-action-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'e2e-action-banner';
      el.setAttribute('style',
        'position:fixed;left:12px;right:12px;top:10px;z-index:2147483647;pointer-events:none;'
        + 'padding:10px 14px;border-radius:10px;font:700 14px/1.35 system-ui,Segoe UI,sans-serif;'
        + 'color:#111;background:linear-gradient(90deg,#f5d56a,#e0a800);'
        + 'box-shadow:0 8px 24px rgba(0,0,0,.45);border:1px solid rgba(0,0,0,.2)');
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function shot(page, slug, actionLabel) {
  stepNo += 1;
  const name = String(stepNo).padStart(2, '0') + '-' + slug;
  const label = 'Действие ' + stepNo + ': ' + actionLabel;
  await banner(page, label);
  await page.waitForTimeout(250);
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  report.shots.push({ n: stepNo, name, label: actionLabel, file: path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/') });
  console.log('[shot]', name, '—', actionLabel);
}

async function main() {
  console.log('ACTION STORY', BASE);
  const health = await fetch(BASE + '/api/health').then((r) => r.json());
  if (!health || health.status !== 'ok') throw new Error('health fail');

  const pm = await login('PM');
  const proc = await login('PROC');
  await markPresence(pm);
  await markPresence(proc);
  await clearCart(pm);

  const work = await api(pm, 'POST', '/api/works', {
    work_title: 'STORY-' + Date.now() + ' Монтаж',
    object_place: 'Рязань',
    customer_name: 'Story QA',
    status: 'in_progress',
  });
  const workId = (work.data.item && work.data.item.id) || work.data.id;
  report.ids.work_id = workId;

  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page } = await openDesktop(browser, pm, '#/warehouse-v2');
    await page.waitForSelector('.wh2-fab__btn, #wh2-cart-fab', { timeout: 20000 }).catch(() => {});
    await shot(page, 'pm-warehouse', 'РП открыл склад (каталог)');

    await page.evaluate(() => {
      if (window.AsgardWarehouseCart && window.AsgardWarehouseCart.open) window.AsgardWarehouseCart.open();
      else document.querySelector('.wh2-fab__btn')?.click();
    });
    await page.waitForTimeout(1000);
    await shot(page, 'pm-cart-open', 'РП открыл корзину (drawer)');

    await page.evaluate(() => {
      const b = document.getElementById('wh2-cart-excel');
      if (b) b.click();
      else if (window.AsgardWarehouseCart?.openExcel) window.AsgardWarehouseCart.openExcel();
    });
    await page.waitForTimeout(800);
    await shot(page, 'pm-excel-panel', 'РП нажал Excel в корзине');

    if (!(await page.locator('#wh2-xl-file').count())) throw new Error('no excel input');
    await page.locator('#wh2-xl-file').setInputFiles(FIX);
    await page.waitForSelector('#wh2-xl-add', { timeout: 45000 });
    await shot(page, 'pm-excel-parsed', 'РП загрузил Excel → AI-превью строк');

    await page.evaluate(() => document.getElementById('wh2-xl-add')?.click());
    await page.waitForTimeout(1800);
    if (!(await page.locator('.wh2-cart-it, #wh2-cart-submit').count())) {
      await page.evaluate(() => window.AsgardWarehouseCart?.open?.());
      await page.waitForTimeout(1000);
    }
    await shot(page, 'pm-cart-filled', 'РП добавил строки Excel в корзину');

    // привязка work_id ко всем строкам + гарантируем дефицит
    const cart = await api(pm, 'GET', '/api/warehouse-cart');
    for (const it of cart.data.items || []) {
      await api(pm, 'PUT', '/api/warehouse-cart/items/' + it.id, { work_id: workId }).catch(() => {});
    }
    await page.evaluate(() => window.AsgardWarehouseCart?.open?.());
    await page.waitForTimeout(800);
    await shot(page, 'pm-cart-work-bound', 'РП привязал позиции корзины к работе #' + workId);

    if (!(cart.data.items || []).some((i) => i.item_type === 'new_position')) {
      await api(pm, 'POST', '/api/warehouse-cart/items', {
        warehouse_id: 1,
        items: [{
          item_type: 'new_position',
          custom_name: 'Story уплотнение ' + Date.now(),
          need_qty: 2,
          manual_price: 12000,
          work_id: workId,
          source: 'manual',
        }],
      });
      await page.evaluate(() => window.AsgardWarehouseCart?.open?.());
      await page.waitForTimeout(1000);
      await shot(page, 'pm-cart-procure-line', 'РП добавил позицию «в закупку»');
    }

    await page.evaluate(() => document.getElementById('wh2-cart-preview')?.click());
    await page.waitForSelector('#wh2-prev-submit', { timeout: 15000 });
    await page.waitForTimeout(600);
    // дождаться опций работ и выбрать
    await page.waitForFunction((wid) => {
      const sel = document.getElementById('wh2-prev-work');
      if (!sel) return false;
      if (wid && [...sel.options].some((o) => o.value === String(wid))) {
        sel.value = String(wid);
        return true;
      }
      return sel.options.length > 1;
    }, workId, { timeout: 8000 }).catch(() => {});
    await shot(page, 'pm-preview-modal', 'РП открыл модалку «Предпросмотр перед отправкой»');
    await shot(page, 'pm-preview-work', 'РП выбрал работу в превью');

    const subWait = page.waitForResponse(
      (r) => r.url().includes('/api/warehouse-cart/submit') && r.request().method() === 'POST',
      { timeout: 30000 }
    ).catch(() => null);
    await page.evaluate(() => document.getElementById('wh2-prev-submit')?.click());
    const subResp = await subWait;
    let subJson = {};
    if (subResp) subJson = await subResp.json().catch(() => ({}));
    if (!subJson.procurement_id) {
      const submit = await api(pm, 'POST', '/api/warehouse-cart/submit', { global_work_id: workId, confirmed: true });
      subJson = submit.data;
    }
    report.ids.procurement_id = subJson.procurement_id;
    report.ids.assembly_id = subJson.assembly_id;
    await page.waitForTimeout(1500);
    await shot(page, 'pm-submitted', 'РП подтвердил отправку → заявка #' + (subJson.procurement_id || '?'));

    await page.goto(BASE + '/#/my-procurement', { waitUntil: 'commit' });
    await page.waitForTimeout(2200);
    await dismiss(page);
    await shot(page, 'pm-my-procurement', 'РП смотрит «Мои закупки» после submit');
    await context.close();

    // PROC
    const pid = report.ids.procurement_id;
    if (!pid) throw new Error('no procurement');
    const { context: c2, page: p2 } = await openDesktop(browser, proc, '#/procurement');
    await page.waitForTimeout(500).catch(() => {});
    await p2.waitForTimeout(2000);
    await shot(p2, 'proc-board', 'Закупщик открыл очередь закупок');

    await p2.goto(BASE + '/#/procurement?id=' + pid, { waitUntil: 'commit' });
    await p2.waitForTimeout(2200);
    await dismiss(p2);
    await p2.evaluate((id) => {
      const card = [...document.querySelectorAll('.proc-card, .kanban-card, [data-id], .proc-k-card')]
        .find((el) => (el.textContent || '').includes('#' + id));
      if (card) card.click();
    }, pid).catch(() => {});
    await p2.waitForTimeout(1200);
    // если модалки нет — клик по тексту карточки
    if (!(await p2.locator('.proc-detail').count())) {
      await p2.getByText('#' + pid, { exact: false }).first().click({ timeout: 3000 }).catch(() => {});
      await p2.waitForTimeout(1200);
    }
    await shot(p2, 'proc-detail-open', 'Закупщик открыл карточку заявки #' + pid);

    // проставить цены если пустые
    const det = await api(proc, 'GET', '/api/procurement/' + pid);
    for (const it of det.data.items || []) {
      if (it.unit_price == null || parseFloat(it.unit_price) <= 0) {
        await api(proc, 'PUT', `/api/procurement/${pid}/items/${it.id}`, {
          unit_price: 1000,
          supplier: 'Story Поставщик',
        });
      }
    }
    await p2.reload({ waitUntil: 'commit' });
    await p2.waitForTimeout(2000);
    await dismiss(p2);
    await p2.evaluate((id) => {
      const card = [...document.querySelectorAll('*')].find((el) => (el.textContent || '').trim() === '#' + id);
      if (card) (card.closest('button,a,.proc-card,.card') || card).click();
    }, pid).catch(() => {});
    await p2.waitForTimeout(1200);
    if (!(await p2.locator('.proc-detail').count())) {
      await p2.getByText('Заявка #' + pid, { exact: false }).first().click({ timeout: 2000 }).catch(() => {});
      await p2.waitForTimeout(1000);
    }
    await shot(p2, 'proc-detail-priced', 'Закупщик проставил цены → карточка с суммой');

    await api(proc, 'PUT', `/api/procurement/${pid}/proc-respond`, { comment: 'Story: цены ок' });
    await p2.reload({ waitUntil: 'commit' });
    await p2.waitForTimeout(2000);
    await dismiss(p2);
    await shot(p2, 'proc-responded-board', 'Закупщик нажал ответ РП (proc-respond) — канбан обновился');
    await c2.close();
  } finally {
    await browser.close();
  }

  report.finished_at = new Date().toISOString();
  const md = [
    '# Action story — каждое действие отдельным скрином',
    '',
    `Base: ${BASE}`,
    `IDs: work=${report.ids.work_id}, procurement=${report.ids.procurement_id}`,
    '',
    '| # | Файл | Действие |',
    '|---|------|----------|',
    ...report.shots.map((s) => `| ${s.n} | ![](${path.basename(s.file)}) | ${s.label} |`),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'INDEX.md'), md);
  fs.writeFileSync(path.join(OUT, 'STORY.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ shots: report.shots.length, ids: report.ids }, null, 2));
  process.exit(report.shots.length >= 8 ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  fs.writeFileSync(path.join(OUT, 'STORY.json'), JSON.stringify({ ...report, error: String(e) }, null, 2));
  process.exit(2);
});
