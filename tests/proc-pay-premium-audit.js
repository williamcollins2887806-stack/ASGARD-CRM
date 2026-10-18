// Премиум-аудит «Мои заявки» (#/my-procurement): вкладка «Счета на оплату».
// Логин — по проверенной схеме (та же, что у doc-design-audit).
// Проверяем: hero, KPI, рельс стадий, карточки, модалку, обе темы, 0 JS-ошибок.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';

async function login(ctx, login, pass) {
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { login, password: pass } });
  const j = await r.json();
  let t = j.token;
  if (j.status === 'need_pin' || j.need_pin) {
    for (const pin of ['0000', '1234', '1111']) {
      const r2 = await ctx.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + t }, data: { pin } });
      const j2 = await r2.json().catch(() => ({}));
      if (j2.token) { t = j2.token; break; }
    }
  }
  return t;
}

const OUT = 'tests/reports/proc-pay-premium';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch();
  const report = [];
  // n.androsov — реальный инициатор счетов (#2145, #2074) на клоне.
  const CREDS = process.env.PROC_USER ? [process.env.PROC_USER, process.env.PROC_PASS || 'Test123!'] : ['n.androsov', 'Test123!'];

  const ctx = await b.newContext({ viewport: { width: 1600, height: 1100 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 140)));
  const consoleErrs = [];
  p.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 140)); });
  const failedUrls = [];
  p.on('response', (r) => { if (r.status() >= 400) failedUrls.push(r.status() + ' ' + r.url().replace(BASE, '')); });

  await p.goto(BASE + '/', { waitUntil: 'commit' });
  await p.waitForTimeout(1500);
  let t = await login(ctx, CREDS[0], CREDS[1]);
  if (!t) { console.log('LOGIN FAIL', CREDS[0]); await b.close(); return; }
  await p.evaluate((tk) => localStorage.setItem('asgard_token', tk), t);

  for (const theme of ['dark', 'light']) {
    // ── Вкладка «Закупки» (канбан) — по умолчанию.
    await p.goto(BASE + '/#/my-procurement', { waitUntil: 'commit' });
    await p.waitForTimeout(1200);
    await p.evaluate((th) => {
      try { localStorage.setItem('asgard_theme', th); } catch (_) {}
      document.documentElement.dataset.theme = th;
      if (window.AsgardTheme && window.AsgardTheme.set) { try { window.AsgardTheme.set(th); } catch (_) {} }
    }, theme);
    await p.waitForTimeout(700);
    const kanban = await p.evaluate(() => ({
      cols: document.querySelectorAll('.proc-kcol').length,
      colsVisible: Array.from(document.querySelectorAll('.proc-kcol')).filter((c) => getComputedStyle(c).display !== 'none').length,
      cards: document.querySelectorAll('.proc-kcard').length,
      rail: document.querySelectorAll('.proc-krail__chip').length
    })).catch(() => ({ err: true }));
    await p.screenshot({ path: `${OUT}/my-procurement-kanban-${theme}.png`, fullPage: false });

    // Переходим на вкладку «Счета на оплату» (ждём и ретраим — сегмент появляется после отрисовки).
    await p.waitForSelector('#proc-seg [data-tab="pay"]', { timeout: 20000 }).catch(() => {});
    for (let attempt = 0; attempt < 4; attempt++) {
      await p.evaluate(() => {
        const seg = document.querySelector('#proc-seg [data-tab="pay"]');
        if (seg) seg.click();
      });
      await p.waitForTimeout(1200);
      const has = await p.evaluate(() => !!(document.querySelector('.proc-pay-hero') || document.querySelector('.proc-pay-empty')));
      if (has) break;
      await p.waitForTimeout(1500);
    }
    await p.waitForFunction(
      () => document.querySelector('.proc-pay-hero') || document.querySelector('.proc-pay-empty'),
      { timeout: 25000 }
    ).catch(() => {});
    await p.waitForTimeout(1500);

    const info = await p.evaluate(() => {
      const g = (sel) => document.querySelectorAll(sel).length;
      const txt = (sel) => { const e = document.querySelector(sel); return e ? e.textContent.trim().slice(0, 60) : null; };
      // Хардкод-цвета: только инлайн-стили (в CSS — fallback токенов, это норма).
      const hard = new Set();
      for (const el of document.querySelectorAll('[style]')) {
        const st = el.getAttribute('style') || '';
        if (!/color|background|border/i.test(st)) continue;
        const m = st.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)/gi);
        if (m) m.forEach((x) => hard.add(x.toLowerCase()));
      }
      const body = getComputedStyle(document.body);
      return {
        theme: document.documentElement.dataset.theme || 'dark',
        hero: txt('.proc-pay-hero__t'),
        heroSub: txt('.proc-pay-hero__s'),
        kpi: g('.proc-pay-kpi'),
        kpiLabels: Array.from(document.querySelectorAll('.proc-pay-kpi__lab')).map((x) => x.textContent.trim()),
        rail: g('.proc-pay-rail__b'),
        cards: g('.proc-pay-card'),
        cardsWithBar: g('.proc-pay-card__bar'),
        empty: txt('.proc-pay-empty__t'),
        stageChips: g('.proc-pay__st'),
        segPay: g('#proc-seg [data-tab="pay"]'),
        bg: body.backgroundColor,
        ink: body.color,
        inlineHardColors: [...hard]
      };
    });

    // Снимок списка.
    await p.screenshot({ path: `${OUT}/my-procurement-${theme}.png`, fullPage: false });

    // Модалка счёта (первая карточка). Клик может не успеть после перерисовки — ретраим.
    let modal = { opened: false, sections: 0, title: null };
    for (let attempt = 0; attempt < 3 && !modal.opened; attempt++) {
      try {
        await p.waitForSelector('.proc-pay-card[data-pay]', { timeout: 15000 }).catch(() => {});
        const card = await p.$('.proc-pay-card[data-pay]');
        if (!card) { await p.waitForTimeout(1200); continue; }
        await card.scrollIntoViewIfNeeded().catch(() => {});
        // Прямой DOM-клик: обходит actionability-проверки Playwright (карточка могла
        // «дрожать» от анимации hover). Цель — проверить, что модалка строится.
        await p.evaluate(() => { const c = document.querySelector('.proc-pay-card[data-pay]'); if (c) c.click(); });
        await p.waitForSelector('.proc-pay-modal', { timeout: 10000 }).catch(() => {});
        await p.waitForTimeout(1200);
        const m = await p.evaluate(() => ({
          opened: !!document.querySelector('.proc-pay-modal'),
          sections: document.querySelectorAll('.proc-pay-modal__section').length,
          title: (document.querySelector('[class*="modal"] h2, [class*="modal"] h3') || {}).textContent || null,
          sum: (document.querySelector('.proc-pay-modal__sum') || {}).textContent || null,
          hasPreview: !!document.querySelector('.proc-pay-modal__preview, .proc-pay-paper')
        }));
        if (m.opened) {
          modal = m;
          await p.screenshot({ path: `${OUT}/my-procurement-modal-${theme}.png`, fullPage: false });
          await p.keyboard.press('Escape');
          await p.waitForTimeout(500);
        } else { await p.waitForTimeout(1000); }
      } catch (e) { modal = { opened: false, err: e.message.slice(0, 100) }; }
    }

    report.push({ theme, kanban, ...info, modal, jsErrors: errs.length, consoleErrors: consoleErrs.length });
  }

  await ctx.close();
  await b.close();

  fs.writeFileSync(`${OUT}/audit.json`, JSON.stringify(report, null, 2));
  fs.writeFileSync(`${OUT}/errors.txt`, 'PAGE:\n' + errs.join('\n') + '\n\nCONSOLE:\n' + consoleErrs.join('\n') + '\n\nFAILED URLs:\n' + failedUrls.join('\n'));

  for (const r of report) {
    console.log(`[${r.theme}] канбан: cols=${r.kanban.cols}(вид${r.kanban.colsVisible}) cards=${r.kanban.cards} | счета: hero="${r.hero}" kpi=${r.kpi}(${r.kpiLabels.join('/')}) rail=${r.rail} cards=${r.cards} modal=${r.modal.opened ? 'ok(' + r.modal.sections + ')' : 'НЕТ'} jsErr=${r.jsErrors}`);
  }
  console.log('\nJS-ошибки:', errs.length ? errs.join(' | ') : 'нет');
  console.log('Вывод: ' + OUT);
})().catch((e) => { console.error('CRASH', e.message, e.stack); process.exit(1); });
