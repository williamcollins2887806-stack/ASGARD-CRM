/**
 * verify_d247_hidemodal_live.js — D-247: живой гейт по модалкам AsgardUI.
 *
 * Дефект (прод-журнал, 31 событие 21–23.09): закрытие модалки крестиком в шапке
 * падало с `TypeError: e.querySelector is not a function` — `hideModal` получал
 * MouseEvent вместо overlay и обращался к `$(".cr-m", target)` (target.querySelector).
 *
 * Гейт ставит РЕАЛЬНЫЙ chromium против живого сервера и проверяет поведение по DOM,
 * а не по тексту файла. Перехватывает pageerror — ошибка класса D-247 ловится как факт.
 *
 * Замечания по методике:
 *  - на части страниц модалка открывается сама («Утренний брифинг») и держится в стеке,
 *    поэтому проверки — по ИДЕНТИЧНОСТИ своих overlay, а не по абсолютному счёту;
 *  - `#modalClose`/`#modalTitle`/`#modalBody` дублируются в каждом слое (пре-существующий
 *    паттерн), поэтому клик делается ВНУТРИ своего overlay, а не по document.
 *
 * Мутант-режим (доказательство не-тавтологичности):
 *   UI_JS_PATH=%TEMP%\ui_MUTANT.js node tools/verify_d247_hidemodal_live.js
 *   → гейт обязан вернуть exit 1 (H1/H4/H5 краснеют).
 *
 * Запуск: TEST_BASE_URL=http://127.0.0.1:3100 node tools/verify_d247_hidemodal_live.js
 */
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';
if (process.env.DB_NAME === 'asgard_crm') { console.error('[D-247] FAIL: прод-БД запрещена'); process.exit(1); }

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const UI_JS = path.resolve(process.env.UI_JS_PATH || path.join(__dirname, '..', 'public', 'assets', 'js', 'ui.js'));
const IS_MUTANT = !!process.env.UI_JS_PATH;

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); console.log(`${ok ? '[OK]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`); };

async function login(loginName, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginName, password }),
  });
  const j = await r.json();
  let token = j.token, user = j.user || null;
  if (j.status === 'need_pin' || j.status === 'need_setup') {
    const r2 = await fetch(`${BASE}/api/auth/verify-pin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: '0000' }),
    });
    const j2 = await r2.json();
    if (j2.token) token = j2.token;
    if (j2.user) user = j2.user;
  }
  return { token, user };
}

(async () => {
  if (!fs.existsSync(UI_JS)) { console.error(`FATAL: не найден ${UI_JS}`); process.exit(1); }
  const uiSrc = fs.readFileSync(UI_JS, 'utf8');
  console.log(`[env] BASE=${BASE}`);
  console.log(`[env] ui.js=${UI_JS}${IS_MUTANT ? ' (MUTANT режим)' : ''} размер=${uiSrc.length} _isOverlay=${/_isOverlay/.test(uiSrc)}`);

  const { token, user } = await login('test_admin', 'Test123!');
  if (!user) { console.error('FATAL: login не вернул user — тест был бы недостоверным'); process.exit(1); }
  console.log(`[env] роль теста: ${user.role}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });

  if (IS_MUTANT) {
    await ctx.route('**/assets/js/ui.js*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: uiSrc }));
  }

  await ctx.addInitScript(([t, u]) => {
    try {
      localStorage.setItem('asgard_token', t); localStorage.setItem('auth_token', t);
      localStorage.setItem('asgard_user', JSON.stringify(u));
    } catch (_) {}
  }, [token, user]);

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));
  const d247Err = () => pageErrors.filter((m) => /querySelector is not a function/.test(m));

  await page.goto(`${BASE}/#/tenders`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.AsgardUI && typeof window.AsgardUI.showModal === 'function', null, { timeout: 20000 }).catch(() => {});
  const apiOk = await page.evaluate(() => !!(window.AsgardUI && window.AsgardUI.hideModal && window.AsgardUI.showModal));
  check('0. AsgardUI загружен, hideModal/showModal доступны', apiOk);
  if (!apiOk) { await browser.close(); console.error('FATAL: ui.js не загрузился'); process.exit(1); }
  await page.waitForTimeout(2500); // дать авто-модалкам («Утренний брифинг») проявиться

  // ── H0: закрыть уже открытые overlay ИХ крестиком (scoped, не по document) ──
  const h0 = await page.evaluate(async () => {
    let closed = 0;
    for (let i = 0; i < 12; i++) {
      const ov = [...document.querySelectorAll('.cr-m-overlay')].pop();
      if (!ov) break;
      const btn = ov.querySelector('#modalClose, .cr-m__close');
      if (btn) btn.click(); else AsgardUI.hideModal(ov);
      closed++;
      await new Promise((r) => setTimeout(r, 380));
    }
    return { closed, left: document.querySelectorAll('.cr-m-overlay').length };
  });
  check('H0. уже открытые overlay закрываются их крестиком (чистый стек)', h0.left === 0, `закрыто=${h0.closed} осталось=${h0.left}`);

  const errsAfterCleanup = pageErrors.length;

  // ── H1: крестик в шапке закрывает ИМЕННО свою модалку ────────────────────
  const h1 = await page.evaluate(async () => {
    const ov = AsgardUI.showModal({ title: 'D247 H1', html: '<p>h1</p>' });
    await new Promise((r) => setTimeout(r, 120));
    const btn = ov.querySelector('#modalClose');
    const hadBtn = !!btn;
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 450));
    return { hadBtn, detached: !document.body.contains(ov), left: document.querySelectorAll('.cr-m-overlay').length };
  });
  check('H1. клик по крестику шапки закрывает свою модалку', h1.hadBtn && h1.detached && h1.left === 0, `detached=${h1.detached} overlay=${h1.left}`);
  check('H1b. нет pageerror класса D-247', d247Err().length === 0, d247Err().join(' | ') || 'чисто');

  // ── H2: hideModal() без аргумента закрывает верхнюю ──────────────────────
  const h2 = await page.evaluate(async () => {
    const ov = AsgardUI.showModal({ title: 'D247 H2', html: '<p>h2</p>' });
    await new Promise((r) => setTimeout(r, 120));
    AsgardUI.hideModal();
    await new Promise((r) => setTimeout(r, 450));
    return { detached: !document.body.contains(ov), left: document.querySelectorAll('.cr-m-overlay').length };
  });
  check('H2. hideModal() без аргумента закрывает верхнюю', h2.detached && h2.left === 0, `detached=${h2.detached} overlay=${h2.left}`);

  // ── H3: регресс D-226 — hideModal(lower) закрывает именно нижнюю, верхняя живёт ──
  const h3 = await page.evaluate(async () => {
    const low = AsgardUI.showModal({ title: 'D247 H3-low', html: '<p>low</p>' });
    const up = AsgardUI.showModal({ title: 'D247 H3-up', html: '<p>up</p>' });
    await new Promise((r) => setTimeout(r, 120));
    AsgardUI.hideModal(low);
    await new Promise((r) => setTimeout(r, 450));
    const r = {
      lowGone: !document.body.contains(low),
      upAlive: document.body.contains(up),
      upVisible: up.classList.contains('cr-m-overlay--visible'),
    };
    AsgardUI.hideModal(up);
    await new Promise((r2) => setTimeout(r2, 400));
    r.left = document.querySelectorAll('.cr-m-overlay').length;
    return r;
  });
  check('H3. hideModal(overlay) закрывает конкретную (нижнюю), верхняя остаётся живой (D-226)',
    h3.lowGone && h3.upAlive && h3.upVisible && h3.left === 0,
    `lowGone=${h3.lowGone} upAlive=${h3.upAlive} upVisible=${h3.upVisible} overlay=${h3.left}`);

  // ── H4: прямой вызов класса D-247 — hideModal(Event) не бросает и закрывает верхнюю ──
  const h4 = await page.evaluate(async () => {
    const ov = AsgardUI.showModal({ title: 'D247 H4', html: '<p>h4</p>' });
    await new Promise((r) => setTimeout(r, 120));
    let threw = null;
    try { AsgardUI.hideModal(new MouseEvent('click')); } catch (e) { threw = String((e && e.message) || e); }
    await new Promise((r) => setTimeout(r, 450));
    return { threw, detached: !document.body.contains(ov), left: document.querySelectorAll('.cr-m-overlay').length };
  });
  check('H4. hideModal(new MouseEvent("click")) не бросает и закрывает верхнюю',
    !h4.threw && h4.detached && h4.left === 0,
    h4.threw ? `throw: ${h4.threw}` : `detached=${h4.detached} overlay=${h4.left}`);

  // ── H5: класс-проверка — серия открытий/закрытий крестиком подряд ──────────
  const h5 = await page.evaluate(async () => {
    let leaked = 0;
    for (let i = 0; i < 6; i++) {
      const ov = AsgardUI.showModal({ title: 'D247 H5 #' + i, html: '<p>x</p>' });
      await new Promise((r) => setTimeout(r, 100));
      const btn = ov.querySelector('#modalClose');
      if (btn) btn.click(); else AsgardUI.hideModal(ov);
      await new Promise((r) => setTimeout(r, 400));
      if (document.body.contains(ov)) leaked++;
    }
    return { leaked, left: document.querySelectorAll('.cr-m-overlay').length };
  });
  check('H5. серия из 6 открытий/закрытий крестиком — ни одна не утекла', h5.leaked === 0 && h5.left === 0, `утекло=${h5.leaked} осталось=${h5.left}`);
  check('H5b. за сессию ни одного pageerror класса D-247', d247Err().length === 0, d247Err().join(' | ') || 'чисто');

  if (IS_MUTANT) {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n[mutant] FAIL-кейсов: ${failed} (ожидается > 0)`);
  } else {
    check('H6. счётчик pageerror не вырос за сессию модалок', pageErrors.length === errsAfterCleanup, `pageerror ${errsAfterCleanup}→${pageErrors.length}`);
  }

  await browser.close();

  const fail = results.filter((r) => !r.ok);
  console.log(`\nИТОГ: ${results.length - fail.length} PASS / ${fail.length} FAIL${IS_MUTANT ? ' (MUTANT режим — ожидается FAIL)' : ''}`);
  fail.forEach((f) => console.log(`  FAIL: ${f.name} — ${f.detail}`));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
