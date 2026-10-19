// Дизайн-аудит V412: сравниваем модалки счетов с эталоном «Выплаты».
// Критерии эталона: hero, KPI-карточки, карточки с рамкой, единые токены,
// читаемая типографика, состояния hover/focus, обе темы.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const OUT = 'tests/reports/design-v412';
fs.mkdirSync(OUT, { recursive: true });

async function login(ctx, l, p) {
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { login: l, password: p } });
  const j = await r.json(); let t = j.token;
  if (j.status === 'need_pin' || j.need_pin) {
    for (const pin of ['0000', '1234']) {
      const r2 = await ctx.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + t }, data: { pin } });
      const j2 = await r2.json().catch(() => ({}));
      if (j2.token) { t = j2.token; break; }
    }
  }
  return t;
}

// Метрики «премиальности»: размеры, радиусы, тени, типографика.
const PROBE = () => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      fontSize: cs.fontSize, fontWeight: cs.fontWeight, radius: cs.borderRadius,
      pad: cs.padding, bg: cs.backgroundColor, border: cs.borderColor,
      h: Math.round(el.getBoundingClientRect().height)
    };
  };
  const hard = new Set();
  for (const el of document.querySelectorAll('[style]')) {
    const st = el.getAttribute('style') || '';
    if (!/color|background|border/i.test(st)) continue;
    const m = st.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)/gi);
    if (m) m.forEach((x) => hard.add(x.toLowerCase()));
  }
  return {
    drop: pick('.pbatch__drop'),
    card: pick('.pbatch__item'),
    btn: pick('#pb-submit'),
    input: pick('.pbatch__frow input'),
    total: pick('.pbatch__total b'),
    inlineHard: [...hard]
  };
};

(async () => {
  const b = await chromium.launch();
  const rep = [];
  for (const theme of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
    await p.goto(BASE + '/', { waitUntil: 'commit' });
    await p.waitForTimeout(1100);
    const t = await login(ctx, 'test_pm', 'Test123!');
    await p.evaluate((tk) => localStorage.setItem('asgard_token', tk), t);
    await p.evaluate((th) => { try { localStorage.setItem('asgard_theme', th); } catch (_) {} document.documentElement.dataset.theme = th; }, theme);
    await p.goto(BASE + '/#/my-procurement', { waitUntil: 'commit' });
    await p.reload({ waitUntil: 'commit' });
    await p.waitForTimeout(2600);
    await p.waitForFunction(() => !!window.AsgardPaymentBatch, { timeout: 15000 }).catch(() => {});
    await p.evaluate(() => window.AsgardPaymentBatch.open());
    await p.waitForSelector('.pbatch', { timeout: 12000 }).catch(() => {});
    await p.waitForTimeout(900);

    // Загружаем счёт, чтобы увидеть поля
    const pdf = (() => {
      const path = require('path');
      const root = path.join(__dirname, '..', 'uploads', 'mail');
      const walk = (d) => {
        if (!fs.existsSync(d)) return null;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name);
          if (e.isDirectory()) { const r = walk(f); if (r) return r; }
          else if (/\.pdf$/i.test(e.name) && fs.statSync(f).size > 10000) return f;
        }
        return null;
      };
      return walk(root);
    })();
    if (pdf) {
      const inp = await p.$('#pb-file');
      if (inp) { await inp.setInputFiles(pdf); await p.waitForSelector('.pbatch__item--ready', { timeout: 90000 }).catch(() => {}); }
      await p.waitForTimeout(1200);
    }
    const m = await p.evaluate(PROBE);
    await p.screenshot({ path: `${OUT}/batch-${theme}.png`, fullPage: false }).catch(() => {});
    rep.push({ theme, ...m, jsErrors: errs.length });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(`${OUT}/audit.json`, JSON.stringify(rep, null, 2));
  for (const r of rep) {
    console.log(`[${r.theme}] drop=${r.drop && r.drop.radius} карточка=${r.card && r.card.radius}/pad${r.card && r.card.pad} кнопка=${r.btn && r.btn.fontWeight} input=${r.input && r.input.radius} итог=${r.total && r.total.fontSize} hard=${r.inlineHard.length} jsErr=${r.jsErrors}`);
  }
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
