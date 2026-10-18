// Дизайн-аудит Doc Hub / Согласование оплат / Бухгалтерия.
// Логин и ожидания — по проверенной схеме (та же, что дала 20 строк и 7 KPI).
const { chromium } = require('playwright');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';

async function login(ctx, login, pass) {
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { login, password: pass } });
  const j = await r.json();
  let t = j.token;
  if (j.status === 'need_pin' || j.need_pin) {
    for (const pin of ['0000', '1234', '1111']) {
      const r2 = await ctx.request.post(BASE + '/api/auth/verify-pin', {
        headers: { Authorization: 'Bearer ' + t }, data: { pin }
      });
      const j2 = await r2.json().catch(() => ({}));
      if (j2.token) { t = j2.token; break; }
    }
  }
  return t;
}

const ROUTES = [
  ['admin', 'test_admin', 'doc-hub', '#/doc-hub'],
  ['admin', 'test_admin', 'acts', '#/doc-hub?tab=acts'],
  ['admin', 'test_admin', 'archive', '#/doc-hub?tab=archive'],
  ['buh', 'test_buh', 'buh-hub', '#/approval-payment'],
  ['director', 'test_director_comm', 'dir-hub', '#/approval-payment']
];

(async () => {
  const b = await chromium.launch();
  const report = [];
  const sessions = {};
  for (const [role, user, tag, route] of ROUTES) {
    if (!sessions[user]) {
      const ctx = await b.newContext({ viewport: { width: 1600, height: 1100 } });
      const p = await ctx.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
      await p.goto(BASE + '/', { waitUntil: 'commit' });
      await p.waitForTimeout(1500);
      const t = await login(ctx, user, 'Test123!');
      await p.evaluate((tk) => localStorage.setItem('asgard_token', tk), t);
      sessions[user] = { ctx, p, errs, token: t, role };
    }
    const s = sessions[user];
    await s.p.goto(BASE + '/' + route, { waitUntil: 'commit' });
    await s.p.reload({ waitUntil: 'commit' });  // SPA: hash без reload не перерисовывает экран
    await s.p.waitForFunction(
      () => document.querySelector('[data-kpi], #ap_tabs .ap-tab, .dh-acts__bar, .dh-arch__bar, .dh-empty'),
      { timeout: 30000 }
    ).catch(() => {});
    await s.p.waitForTimeout(2500);

    const info = await s.p.evaluate(() => {
      const g = (sel) => document.querySelectorAll(sel).length;
      // Хардкод-цвета: только инлайн-стили (в CSS — fallback'и токенов, это норма)
      const hard = new Set();
      for (const el of document.querySelectorAll('[style]')) {
        const st = el.getAttribute('style') || '';
        if (!/color|background|border/i.test(st)) continue;
        const m = st.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)/gi);
        if (m) m.forEach((x) => hard.add(x.toLowerCase()));
      }
      const h1 = document.querySelector('.page-title, .dh-top__h1, h1');
      const body = getComputedStyle(document.body);
      return {
        title: h1 ? h1.textContent.trim() : null,
        kpiCards: g('[data-kpi]'),
        kpiKeys: Array.from(document.querySelectorAll('[data-kpi]')).map((x) => x.dataset.kpi),
        tabs: g('#ap_tabs .ap-tab'),
        tabLabels: Array.from(document.querySelectorAll('#ap_tabs .ap-tab')).map((x) => x.textContent.trim()),
        trafficBadges: g('.dh-tl'),
        rows: g('#dhTableHost tbody tr[data-id]'),
        actsBar: g('.dh-acts__bar'),
        archBar: g('.dh-arch__bar'),
        emptyState: g('.dh-empty') ? (document.querySelector('.dh-empty').textContent.trim().slice(0, 60)) : null,
        theme: document.documentElement.dataset.theme || 'dark',
        bg: body.backgroundColor,
        ink: body.color,
        inlineHardColors: [...hard]
      };
    });
    report.push({ role, tag, route, ...info, jsErrors: s.errs.length });
    await s.p.screenshot({ path: `tests/reports/doc-hub-e2e/audit-${role}-${tag}.png`, fullPage: false });
  }
  for (const k of Object.keys(sessions)) await sessions[k].ctx.close();
  require('fs').writeFileSync('tests/reports/doc-hub-e2e/design-audit.json', JSON.stringify(report, null, 2));
  for (const r of report) {
    console.log(`[${r.role}/${r.tag}] ${r.route} | kpi=${r.kpiCards}(${r.kpiKeys.join(',')}) tabs=${r.tabs} tl=${r.trafficBadges} rows=${r.rows} acts=${r.actsBar} arch=${r.archBar} err=${r.jsErrors}`);
  }
  await b.close();
})().catch((e) => { console.error('CRASH', e.message, e.stack); process.exit(1); });
