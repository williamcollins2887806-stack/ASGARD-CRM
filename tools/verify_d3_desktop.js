/**
 * D3 — хвост маркетплейса/склада в DESKTOP (vanilla `warehouse-v2`).
 * Самодостаточный: сам создаёт тестовую сборку и демобилизацию, поэтому не зависит от состояния клона.
 * Проверяет на КЛОНЕ (:3101, asgard_crm_test):
 *   1) в ведомости НЕТ мёртвых кнопок «PDF» и «Бирки» (роутов /api/assembly/:id/pdf|labels не существует);
 *   2) PDF/Excel/бирки ведут на СУЩЕСТВУЮЩИЕ роуты и с ?token= (без токена эти роуты дают 401);
 *   3) guided pick: строка предлагает выбор паллета, «＋ новый паллет…» создаёт ровно один паллет,
 *      позиция реально уходит на него (assign-pallet + pack подтверждаются в БД);
 *   4) demob reconcile доступен в desktop (кнопка «Принять с объекта» + модалка сверки возврата
 *      с причинами returning/damaged/lost/consumed и полем «лишнее»);
 *   5) 0 JS-ошибок консоли (кроме исходов самих негативных проб), 0 ответов 5xx.
 * Запуск: node tools/verify_d3_desktop.js
 */
const { chromium } = require('playwright');
const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3101').replace(/\/$/, '');
const PROBE_MARK = '__d3_probe__';

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, proof) {
  ok ? pass++ : (fail++, fails.push(name));
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${proof ? ' — ' + proof : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const jsErrs = [];
  const netErrs = [];
  const fivexx = [];
  const noise = [];
  const isProbeUrl = (u) => /\/api\/assembly\/\d+\/(pdf|labels)(\?|$)/.test(u);
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // диагностика: что именно даёт «Failed to load resource» и на каком URL
    const loc = (m.location && m.location()) || {};
    const line = t + ' @ ' + (loc.url || '');
    if (isProbeUrl(loc.url || '')) { noise.push(line); return; }
    if (/402|403|404|401|Unauthorized|Failed to load resource/i.test(t)) noise.push(line);
    else jsErrs.push(line);
  });
  page.on('pageerror', (e) => jsErrs.push('pageerror: ' + e.message));
  page.on('response', (r) => {
    if (r.status() >= 500 && !isProbeUrl(r.url())) fivexx.push(r.status() + ' ' + r.url());
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (/^blob:/.test(u)) return;
    // SSE и фоновые опросы могут отменяться при навигации — это не обрыв логики страницы
    if (/\/api\/(sse\/stream|data\/users)/.test(u)) { noise.push('abort ' + u.split('?')[0]); return; }
    if (/\/api\/assembly\/\d+\/(checklist-pdf|export-excel|pallets\/\d+\/label-pdf)/.test(u)) { noise.push('abort ' + u.split('?')[0]); return; }
    netErrs.push(u);
  });

  let asmId = null, demobId = null;
  const palletPosts = [];

  try {
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    const seed = await page.evaluate(async (base) => {
      const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'test_admin', password: 'Test123!' }) });
      const d = await r.json();
      let t = d.token;
      if (d.status === 'need_pin') {
        const r2 = await fetch(base + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin: '0000' }) });
        t = ((await r2.json()).token) || t;
      }
      if (t) { localStorage.setItem('asgard_token', t); localStorage.setItem('auth_token', t); }
      const H = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
      const me = await fetch(base + '/api/auth/me', { headers: H }).then(x => x.json());
      const w = await fetch(base + '/api/works?limit=20', { headers: H }).then(x => x.json());
      const works = w.works || w.items || w.rows || [];
      const work = works[0];
      if (!work) return { ok: false, why: 'нет работ' };
      const uniq = Date.now();
      // мобилизация для guided pick
      const a = await fetch(base + '/api/assembly', { method: 'POST', headers: H, body: JSON.stringify({ work_id: work.id, type: 'mobilization', title: '__d3_probe__ ' + uniq, destination: 'Полигон D3' }) }).then(x => x.json());
      const asm = a.item || a;
      if (!asm || !asm.id) return { ok: false, why: 'сборка не создана: ' + JSON.stringify(a).slice(0, 120) };
      await fetch(base + '/api/assembly/' + asm.id + '/items', { method: 'POST', headers: H, body: JSON.stringify({ name: '__d3_probe__ позиция ' + uniq, unit: 'шт', quantity: 2 }) });
      await fetch(base + '/api/assembly/' + asm.id + '/confirm', { method: 'PUT', headers: H, body: '{}' });
      // демобилизация (для приёмки) — из свежей мобилизации
      const dd = await fetch(base + '/api/assembly/' + asm.id + '/create-demob', { method: 'POST', headers: H, body: '{}' }).then(x => x.json());
      const demob = dd.item || dd;
      return { ok: true, token: t, user: me.user || me, workId: work.id, asmId: asm.id, demobId: (demob && demob.id) || null };
    }, BASE);
    check('логин + сев тестовой мобилизации и демобилизации', seed.ok, seed.ok ? `asm=${seed.asmId} demob=${seed.demobId}` : (seed.why || ''));
    if (!seed.ok) throw new Error(seed.why || 'seed failed');
    asmId = seed.asmId;
    demobId = seed.demobId;

    // ── 1-2) Мёртвые роуты и живые ссылки
    const links = await page.evaluate(async ({ base, token, id }) => {
      const H = { Authorization: 'Bearer ' + token };
      const probe = async (p) => { try { const r = await fetch(base + p, { headers: H }); return r.status; } catch (e) { return 'ERR'; } };
      const noAuth = async (p) => { try { const r = await fetch(base + p); return r.status; } catch (e) { return 'ERR'; } };
      return {
        oldPdf: await probe('/api/assembly/' + id + '/pdf'),
        oldLabels: await probe('/api/assembly/' + id + '/labels'),
        checklistNoAuth: await noAuth('/api/assembly/' + id + '/checklist-pdf'),
        checklistTok: await probe('/api/assembly/' + id + '/checklist-pdf?token=' + encodeURIComponent(token)),
        excelTok: await probe('/api/assembly/' + id + '/export-excel?token=' + encodeURIComponent(token))
      };
    }, { base: BASE, token: seed.token, id: asmId });
    check('старые роуты /:id/pdf и /:id/labels не существуют (404) — в UI их держать нельзя', links.oldPdf === 404 && links.oldLabels === 404, `pdf=${links.oldPdf} labels=${links.oldLabels}`);
    check('href без токена получает 401 → UI обязан добавлять ?token=', links.checklistNoAuth === 401, 'checklist-no-auth=' + links.checklistNoAuth);
    check('живые роуты с ?token= отдают 200 (чек-лист + Excel)', links.checklistTok === 200 && links.excelTok === 200, `checklist=${links.checklistTok} excel=${links.excelTok}`);

    page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/assembly\/\d+\/pallets$/.test(r.url())) palletPosts.push(r.url()); });

    // ── 3) guided pick в реальном DOM
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window.WH2Asm && window.AsgardUI), null, { timeout: 20000 });
    await page.addStyleTag({ content: '#asgard-theme-selector{display:none!important}' });
    await page.evaluate((id) => { location.hash = '#/warehouse-v2?tab=sheet&id=' + id; }, asmId);
    await page.waitForFunction(() => !!document.getElementById('wh2-asm-sheet-body'), null, { timeout: 20000 });
    await page.waitForTimeout(900);

    const ui = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#wh2-asm-sheet-btns a, #wh2-asm-sheet-btns button')];
      return {
        labels: btns.map(b => b.textContent.trim()),
        hrefs: btns.filter(b => b.tagName === 'A').map(b => b.getAttribute('href')),
        sels: document.querySelectorAll('[data-pal-sel]').length,
        newOpt: [...document.querySelectorAll('[data-pal-sel] option')].some(o => /новый паллет/i.test(o.textContent)),
        packBtns: document.querySelectorAll('[data-pack]').length
      };
    });
    check('в шапке НЕТ кнопок «PDF» и «Бирки» (вели в 404)', !ui.labels.includes('PDF') && !ui.labels.includes('Бирки'), JSON.stringify(ui.labels));
    check('href файлов содержат ?token= и живые пути', ui.hrefs.length > 0 && ui.hrefs.every(h => /\?token=/.test(h)) && ui.hrefs.join(' ').match(/checklist-pdf|export-excel|label-pdf/) && !/\/pdf"|\/labels"/.test(ui.hrefs.join(' ')), ui.hrefs.map(h => h.split('?')[0]).join(' | '));
    check('guided pick: у позиции есть выбор паллета + пункт «＋ новый паллет…»', ui.sels > 0 && ui.newOpt, `выборов=${ui.sels} new=${ui.newOpt}`);

    if (ui.packBtns > 0) {
      const before = palletPosts.length;
      const firstSel = await page.$('[data-pal-sel]');
      await firstSel.selectOption('__new__');
      await page.click('[data-pack]');
      await page.waitForFunction(() => !!document.getElementById('wh2-asm-sheet-body'), null, { timeout: 20000 });
      await page.waitForTimeout(1500);
      check('«＋ новый паллет…» создаёт РОВНО ОДИН паллет (POST /pallets=1)', palletPosts.length - before === 1, 'POST /pallets=' + (palletPosts.length - before));
      const after = await page.evaluate(async ({ base, id }) => {
        const t = localStorage.getItem('asgard_token');
        const d = await fetch(base + '/api/assembly/' + id, { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json());
        const packed = (d.items || []).filter(i => i.packed);
        return { pallets: (d.pallets || []).length, packed: packed.length, allOnPallet: packed.length > 0 && packed.every(i => i.pallet_id) };
      }, { base: BASE, id: asmId });
      check('после укладки позиция реально на паллете (подтверждено в БД)', after.packed > 0 && after.allOnPallet, JSON.stringify(after));
    } else {
      check('guided pick: кнопка укладки есть', false, 'кнопок [data-pack]=0');
    }

    // ── 4) demob reconcile в desktop
    if (demobId) {
      await page.evaluate((id) => { location.hash = '#/warehouse-v2?tab=sheet&id=' + id; }, demobId);
      await page.waitForFunction(() => !!document.getElementById('wh2-asm-sheet-body'), null, { timeout: 20000 });
      await page.waitForTimeout(800);
      const rc = await page.evaluate(() => ({
        receiptBtn: !!document.getElementById('wh2-asm-receipt'),
        demobBtn: !!document.getElementById('wh2-asm-demob'),
        packSel: document.querySelectorAll('[data-pal-sel]').length
      }));
      check('демобилизация: есть «Принять с объекта» (reconcile в desktop, не только field)', rc.receiptBtn === true, JSON.stringify(rc));
      check('демобилизация: укладка на паллет скрыта (это приёмка, а не комплектация)', rc.packSel === 0, 'селектов=' + rc.packSel);
      if (rc.receiptBtn) {
        await page.click('#wh2-asm-receipt');
        await page.waitForSelector('.wh2-rc', { timeout: 10000 });
        const rcModal = await page.evaluate(() => ({
          rows: document.querySelectorAll('[data-rc]').length,
          qty: document.querySelectorAll('[data-rc-qty]').length,
          statuses: [...document.querySelectorAll('[data-rc-st] option')].map(o => o.value).filter(Boolean),
          hasExtra: !!document.getElementById('wh2-rc-extra-name'),
          okBtn: !!document.getElementById('wh2-rc-ok')
        }));
        check('модалка приёмки: строки + количество + все причины возврата + «приехало лишнее»',
          rcModal.rows > 0 && rcModal.qty > 0 && ['returning', 'damaged', 'lost', 'consumed'].every(s => rcModal.statuses.includes(s)) && rcModal.hasExtra && rcModal.okBtn,
          JSON.stringify(rcModal));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    } else {
      check('демобилизация создаётся из мобилизации (нужна для приёмки)', false, 'create-demob не вернул id');
    }

    const realJsErrs = jsErrs;
    check('0 JS-ошибок консоли (негативные пробы и сетевые исходы отделены)', realJsErrs.length === 0, realJsErrs.slice(0, 3).join(' | ') || 'нет');
    check('0 ответов 5xx', fivexx.length === 0, fivexx.slice(0, 3).join(' | ') || 'нет');
    check('0 сетевых обрывов логики страницы', netErrs.length === 0, netErrs.slice(0, 3).join(' | ') || 'нет');
    console.log('ДИАГНОСТИКА (ожидаемый шум, не дефекты): ' + (noise.length ? noise.slice(0, 6).join(' ; ') : 'нет'));
  } catch (e) {
    check('прогон без фатальной ошибки', false, e.message);
  } finally {
    await browser.close();
  }

  console.log(`\nИТОГ: ${pass} PASS / ${fail} FAIL`);
  if (fails.length) console.log('Провалы: ' + fails.join('; '));
  process.exit(fail ? 1 : 0);
})();
