// Роли: какой HTML реально рендерится на #/my-procurement (ждём стабильно).
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3100';

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

const ROLES = [['test_pm','PM'],['test_head_pm','HEAD_PM'],['test_buh','BUH'],['test_director_comm','DIRECTOR_COMM'],['test_office_manager','OFFICE_MANAGER'],['test_to','TO'],['test_proc','PROC'],['test_warehouse','WAREHOUSE']];

(async () => {
  const b = await chromium.launch();
  for (const [ln, role] of ROLES) {
    const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(BASE + '/', { waitUntil: 'commit' });
    await p.waitForTimeout(800);
    const t = await login(ctx, ln, 'Test123!');
    if (!t) { console.log(role, 'НЕТ ЛОГИНА'); await ctx.close(); continue; }
    await p.evaluate((tk) => localStorage.setItem('asgard_token', tk), t);
    await p.goto(BASE + '/#/my-procurement', { waitUntil: 'commit' });
    await p.reload({ waitUntil: 'commit' });
    // Ждём появления сегмента/одиночной вкладки/канбана — стабильное состояние
    await p.waitForFunction(() => document.querySelector('#proc-seg') || document.querySelector('.proc-seg--single') || document.querySelector('.proc-kcol') || document.querySelector('.proc-pay-hero') || document.querySelector('.proc-empty'), { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(2500);
    const info = await p.evaluate(() => ({
      tabs: Array.from(document.querySelectorAll('#proc-seg [data-tab]')).map((x) => x.getAttribute('data-tab')),
      single: !!document.querySelector('.proc-seg--single'),
      buttons: Array.from(document.querySelectorAll('.proc-toolbar__acts button')).map((x) => x.textContent.trim()),
      payHero: !!document.querySelector('.proc-pay-hero'),
      kanban: document.querySelectorAll('.proc-kcol').length,
      tableRows: document.querySelectorAll('#proc-table tbody tr').length
    }));
    console.log(`${role.padEnd(15)} tabs=${JSON.stringify(info.tabs)} single=${info.single} payHero=${info.payHero} kanban=${info.kanban} btns=${JSON.stringify(info.buttons)}`);
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
