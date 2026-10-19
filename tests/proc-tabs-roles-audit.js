// V413: какие вкладки видит каждая роль на «Моих заявках» + какие кнопки.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const OUT = 'tests/reports/proc-tabs-roles';
fs.mkdirSync(OUT, { recursive: true });

async function login(ctx, l, p) {
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { login: l, password: p } });
  const j = await r.json(); let t = j.token;
  if (j.status === 'need_pin' || j.need_pin) {
    for (const pin of ['0000', '1234', '1111']) {
      const r2 = await ctx.request.post(BASE + '/api/auth/verify-pin', { headers: { Authorization: 'Bearer ' + t }, data: { pin } });
      const j2 = await r2.json().catch(() => ({}));
      if (j2.token) { t = j2.token; break; }
    }
  }
  return t;
}

const ROLES = [
  ['test_pm', 'PM'],
  ['test_head_pm', 'HEAD_PM'],
  ['test_admin', 'ADMIN'],
  ['test_buh', 'BUH'],
  ['test_director_comm', 'DIRECTOR_COMM'],
  ['test_office_manager', 'OFFICE_MANAGER'],
  ['test_proc', 'PROC'],
  ['test_warehouse', 'WAREHOUSE'],
  ['test_to', 'TO']
];

(async () => {
  const b = await chromium.launch();
  const rep = [];
  for (const [loginName, role] of ROLES) {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 100)));
    await p.goto(BASE + '/', { waitUntil: 'commit' });
    await p.waitForTimeout(900);
    const t = await login(ctx, loginName, 'Test123!');
    if (!t) { rep.push({ role, login: loginName, noLogin: true }); await ctx.close(); continue; }
    await p.evaluate((tk) => localStorage.setItem('asgard_token', tk), t);
    await p.goto(BASE + '/#/my-procurement', { waitUntil: 'commit' });
    await p.reload({ waitUntil: 'commit' });
    await p.waitForTimeout(3500);
    const info = await p.evaluate(() => {
      const seg = document.querySelector('#proc-seg');
      const tabs = Array.from(document.querySelectorAll('#proc-seg [data-tab]')).map((x) => x.textContent.trim().split(' ')[0]);
      const single = !!document.querySelector('.proc-seg--single');
      const buttons = Array.from(document.querySelectorAll('.proc-toolbar__acts button')).map((x) => x.textContent.trim());
      const kanban = document.querySelectorAll('.proc-kcol').length;
      const payHero = !!document.querySelector('.proc-pay-hero');
      return { hasSeg: !!seg, tabs, single, buttons, kanban, payHero };
    }).catch(() => ({}));
    await p.screenshot({ path: `${OUT}/${role}.png`, fullPage: false }).catch(() => {});
    rep.push({ role, login, ...info, jsErrors: errs.length });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(`${OUT}/roles.json`, JSON.stringify(rep, null, 2));
  for (const r of rep) {
    if (r.noLogin) { console.log(`[${r.role}] НЕТ ЛОГИНА`); continue; }
    console.log(`[${r.role}] вкладки=${JSON.stringify(r.tabs)} одна=${r.single} кнопки=${JSON.stringify(r.buttons)} jsErr=${r.jsErrors}`);
  }
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
