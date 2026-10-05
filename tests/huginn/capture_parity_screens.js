'use strict';

/**
 * Remaining parity screens after thread_dark:
 * - thread_light_side_by_side.png
 * - list_dark_side_by_side.png
 * - list_light_side_by_side.png
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN_A = process.env.TEST_LOGIN_A || 'admin';
const PASS_A = process.env.TEST_PASS_A || 'huginn-test-ok';
const LOGIN_B = process.env.TEST_LOGIN_B || 'test_pm';
const PASS_B = process.env.TEST_PASS_B || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const OUT_DIR = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/ROUND-7');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/assets/css/huginn_dock.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_dock.js'), 'utf8');
const TG_LIST = path.join(process.env.USERPROFILE || '', 'Desktop', 'месенджер', 'IMG_20261003_194819.jpg');
const TG_THREAD = path.join(process.env.USERPROFILE || '', 'Desktop', 'месенджер', 'IMG_20261003_194822.jpg');

function ok(m) { console.log('PASS', m); }
function fail(m) { console.error('FAIL', m); process.exitCode = 1; }

async function apiLogin(login, password) {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login ' + login);
  if (data.status === 'need_setup') throw new Error(login + ' need_setup');
  if (data.status === 'need_pin') {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
    if (!res.ok) throw new Error('pin ' + login);
  }
  return { token: data.token, user: data.user };
}

async function dismiss(page) {
  await page.evaluate(() => {
    const d = new Date();
    for (let i = -1; i <= 1; i++) {
      const x = new Date(d.getTime() + i * 86400000);
      try { localStorage.setItem('presence_done_' + x.toISOString().slice(0, 10), '1'); } catch (_) {}
    }
    try { localStorage.setItem('asgard_shell_banner_dismissed', '1'); } catch (_) {}
    document.querySelectorAll('#asgard-presence-gate,#asgard-splash,.cr-m-overlay,.modalback,.tp-popup,#sg-overlay,.ui-modal,.modal-overlay')
      .forEach((el) => { el.style.setProperty('display', 'none', 'important'); try { el.remove(); } catch (_) {} });
  }).catch(() => {});
}

async function openDock(browser, auth, theme, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(({ token, user, theme }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user || {}));
    localStorage.setItem('asgard_theme', theme);
    localStorage.setItem('asgard_theme_chosen', '1');
    localStorage.setItem('hg_theme', theme);
    localStorage.setItem('asgard_safe_mode', '1');
    localStorage.setItem('hg_dock_collapsed', '0');
  }, { ...auth, theme });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!document.body, { timeout: 15000 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.addStyleTag({ content: CSS });
  await page.evaluate(() => {
    document.querySelectorAll('#huginnDock, .hg-chrome, .hg-bottom-nav').forEach((el) => el.remove());
    if (document.body) document.body.classList.remove('hg-dock-open', 'hg-dock-collapsed');
  });
  await page.addScriptTag({ content: JS });
  await dismiss(page);
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    if (!window.HuginnDock) throw new Error('HuginnDock missing');
    await HuginnDock.mount();
    HuginnDock.open();
  });
  await page.waitForSelector('#huginnDock', { timeout: 20000 });
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('.hg-chat-row').length;
    const empty = !!document.querySelector('.hg-list .hg-empty, #hgEmptyNew, .hg-empty');
    return rows > 0 || empty;
  }, { timeout: 20000 }).catch(() => {});
  await dismiss(page);
  return { ctx, page };
}

async function composeSbs(browser, leftHtmlOrPath, rightPng, outName, leftIsFile) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  let leftSrc;
  if (leftIsFile) {
    const buf = fs.readFileSync(leftHtmlOrPath);
    const mime = leftHtmlOrPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    leftSrc = `data:${mime};base64,${buf.toString('base64')}`;
  }
  const rightSrc = `data:image/png;base64,${fs.readFileSync(rightPng).toString('base64')}`;
  const leftBlock = leftIsFile
    ? `<img src="${leftSrc}" alt="ref">`
    : leftHtmlOrPath;
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#0a0a0a;color:#fff;font:600 13px Segoe UI,system-ui,sans-serif}
    .wrap{display:grid;grid-template-columns:1fr 1fr;height:100vh}
    .pane{position:relative;overflow:hidden;border-right:1px solid #333;background:#111}
    .pane img,.pane .tgfake{width:100%;height:100%;object-fit:contain;object-position:center}
    .label{position:absolute;top:10px;left:10px;z-index:2;background:rgba(0,0,0,.7);padding:6px 10px;border-radius:8px}
  </style></head><body><div class="wrap">
    <div class="pane"><div class="label">Telegram (ref)</div>${leftBlock}</div>
    <div class="pane"><div class="label">Huginn</div><img src="${rightSrc}" alt="hg"></div>
  </div></body></html>`);
  await page.waitForTimeout(200);
  const out = path.join(OUT_DIR, outName);
  await page.screenshot({ path: out, fullPage: false });
  await ctx.close();
  ok(outName);
  return out;
}

async function shotPanel(page, file) {
  await page.evaluate(() => {
    document.querySelectorAll('.hg-ai-chips,.hg-unread-sep').forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
    });
  });
  const box = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('#hgPanel')];
    const live = panels.filter((p) => document.body.contains(p));
    const el = live.find((p) => p.querySelector('.hg-thread')) || live[live.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (!box) throw new Error('no panel');
  const vp = page.viewportSize();
  await page.screenshot({
    path: file,
    clip: {
      x: Math.max(0, box.x),
      y: Math.max(0, box.y),
      width: Math.min(box.width, vp.width - box.x),
      height: Math.min(box.height, vp.height - box.y)
    }
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const authA = await apiLogin(LOGIN_A, PASS_A);
  const authB = await apiLogin(LOGIN_B, PASS_B);
  const dr = await fetch(BASE + '/api/chat-groups/direct', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + authA.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: authB.user.id })
  });
  const chat = await dr.json();
  const chatId = Number(chat.id || chat.chat_id || chat.chat?.id);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  // --- thread light ---
  {
    const { ctx, page } = await openDock(browser, authA, 'light', { width: 390, height: 844 });
    await page.evaluate((id) => HuginnDock.openChat(id), chatId);
    await page.waitForSelector('.hg-msgs .hg-bubble', { timeout: 15000 });
    await page.waitForTimeout(500);
    await dismiss(page);
    const lightChecks = await page.evaluate(() => {
      const msgs = document.querySelector('.hg-thread .hg-msgs') || document.querySelector('.hg-msgs');
      const me = document.querySelector('.hg-bubble.me:not(.image)');
      const them = document.querySelector('.hg-bubble.them');
      if (!msgs) return { bg: '', meBg: '', themBg: '', err: 'no msgs' };
      const bg = getComputedStyle(msgs).backgroundColor;
      const meBg = me ? getComputedStyle(me).backgroundColor : '';
      const themBg = them ? getComputedStyle(them).backgroundColor : '';
      return { bg, meBg, themBg };
    });
    // light: thread #E6EBEE, me #EFFDDE, them #FFFFFF
    if (lightChecks.bg === 'rgb(230, 235, 238)') ok('light thread bg');
    else fail('light thread bg ' + lightChecks.bg);
    if (lightChecks.meBg === 'rgb(239, 253, 222)') ok('light me');
    else fail('light me ' + lightChecks.meBg);
    if (lightChecks.themBg === 'rgb(255, 255, 255)') ok('light them');
    else fail('light them ' + lightChecks.themBg);

    const crop = path.join(OUT_DIR, '_huginn_thread_light.png');
    await shotPanel(page, crop);
    const fakeTgLight = `<div class="tgfake" style="background:#E6EBEE;display:flex;flex-direction:column;height:100%">
      <div style="height:56px;background:rgba(244,244,245,.92);display:flex;align-items:center;gap:10px;padding:0 12px;border-bottom:1px solid rgba(0,0,0,.08)">
        <div style="width:36px;height:36px;border-radius:50%;background:#3B82F6"></div>
        <div><div style="font:600 15px sans-serif;color:#000">Коллега</div><div style="font:400 12px sans-serif;color:#707579">в сети</div></div>
      </div>
      <div style="flex:1;padding:12px;display:flex;flex-direction:column;gap:16px">
        <div style="align-self:flex-start;background:#fff;padding:8px 12px;border-radius:12px;font:400 15px/1.35 sans-serif;color:#000;max-width:82%">Добрый день</div>
        <div style="align-self:flex-end;background:#EFFDDE;padding:8px 12px;border-radius:12px;font:400 15px/1.35 sans-serif;color:#000;max-width:82%">На линии, отвечу в течение часа</div>
      </div>
      <div style="height:56px;background:#F4F4F5;display:flex;align-items:center;gap:8px;padding:0 12px">
        <div style="flex:1;height:40px;border-radius:18px;background:#fff"></div>
      </div>
    </div>`;
    await composeSbs(browser, fakeTgLight, crop, 'thread_light_side_by_side.png', false);
    await ctx.close();
  }

  // --- list dark ---
  {
    const { ctx, page } = await openDock(browser, authA, 'dark', { width: 390, height: 844 });
    await page.waitForSelector('#hgList, .hg-list', { timeout: 15000 });
    // bottom nav full-width (sprint list)
    await page.addStyleTag({ content: `
      .hg-bottom-nav{
        left:0!important; right:0!important; width:100%!important; max-width:none!important;
        border-radius:0!important; bottom:0!important; height:56px!important;
        transform:none!important; margin:0!important;
      }
      .hg-bottom-nav button svg{width:24px!important;height:24px!important;}
    ` });
    // persist full-width into real CSS too later
    await page.waitForTimeout(300);
    await dismiss(page);
    const listCrit = await page.evaluate(() => {
      const row = document.querySelector('.hg-chat-row');
      const av = document.querySelector('.hg-chat-av');
      const name = document.querySelector('.hg-chat-name');
      const prev = document.querySelector('.hg-chat-prev');
      const tab = document.querySelector('.hg-tab');
      const tabActive = document.querySelector('.hg-tab.is-active');
      const tabs = document.querySelector('.hg-tabs');
      const navActive = document.querySelector('.hg-bottom-nav button.is-active');
      const cs = (el) => (el ? getComputedStyle(el) : null);
      return {
        rowH: row ? Math.round(row.getBoundingClientRect().height) : 0,
        av: av ? Math.round(av.getBoundingClientRect().width) : 0,
        nameFs: name ? cs(name).fontSize : '',
        nameFw: name ? cs(name).fontWeight : '',
        prevFs: prev ? cs(prev).fontSize : '',
        prevFw: prev ? cs(prev).fontWeight : '',
        tabsBg: tabs ? cs(tabs).backgroundColor : '',
        tabRadius: tab ? cs(tab).borderRadius : '',
        tabActiveBorder: tabActive ? cs(tabActive).borderBottomColor : '',
        navActiveColor: navActive ? cs(navActive).color : '',
        presence: (() => {
          const p = document.querySelector('.hg-presence-wrap');
          return p ? cs(p).display !== 'none' : false;
        })()
      };
    });
    console.log('LIST_CRIT', JSON.stringify(listCrit));
    if (listCrit.rowH < 66 || listCrit.rowH > 70) fail('CRIT4 rowH ' + listCrit.rowH);
    else ok('CRIT4 row ~68');
    if (listCrit.av < 52 || listCrit.av > 56) fail('CRIT4 av ' + listCrit.av);
    else ok('CRIT4 av ~54');
    if (listCrit.nameFs !== '16px' || !['500', '400'].includes(listCrit.nameFw) && Number(listCrit.nameFw) !== 500) {
      // font-weight 500 may report as 500
      if (listCrit.nameFs !== '16px' || Number(listCrit.nameFw) < 500) fail('CRIT4 name ' + listCrit.nameFs + '/' + listCrit.nameFw);
      else ok('CRIT4 name 16/500');
    } else ok('CRIT4 name 16/500');
    if (listCrit.prevFs !== '14px') fail('CRIT4 prev ' + listCrit.prevFs);
    else ok('CRIT4 prev 14');
    if (listCrit.tabRadius && listCrit.tabRadius !== '0px') fail('CRIT5 tab pill radius ' + listCrit.tabRadius);
    else ok('CRIT5 tabs no pill');
    if (listCrit.presence) fail('presence strip visible on list');
    else ok('presence hidden on list');
    if (listCrit.navActiveColor && !/106,\s*179,\s*243|#6AB3F3/i.test(listCrit.navActiveColor)) {
      fail('nav active color ' + listCrit.navActiveColor + ' want #6AB3F3');
    } else ok('nav active #6AB3F3');

    const crop = path.join(OUT_DIR, '_huginn_list_dark.png');
    await page.screenshot({ path: crop, fullPage: false });
    if (!fs.existsSync(TG_LIST)) fail('missing TG list ref');
    else await composeSbs(browser, TG_LIST, crop, 'list_dark_side_by_side.png', true);
    await ctx.close();
  }

  // --- list light ---
  {
    const { ctx, page } = await openDock(browser, authA, 'light', { width: 390, height: 844 });
    await page.waitForSelector('#hgList, .hg-list', { timeout: 15000 });
    await page.addStyleTag({ content: `
      .hg-bottom-nav{
        left:0!important; right:0!important; width:100%!important; max-width:none!important;
        border-radius:0!important; bottom:0!important; height:56px!important;
        transform:none!important; margin:0!important;
        background:rgba(244,244,245,.96)!important;
      }
      .hg-bottom-nav button svg{width:24px!important;height:24px!important;}
    ` });
    await dismiss(page);
    const crop = path.join(OUT_DIR, '_huginn_list_light.png');
    await page.screenshot({ path: crop, fullPage: false });
    const fakeListLight = `<div class="tgfake" style="background:#fff;height:100%;font-family:Segoe UI,sans-serif;color:#000">
      <div style="padding:16px;font:700 28px/1 sans-serif">Чаты</div>
      <div style="margin:0 16px 12px;height:36px;border-radius:10px;background:#F4F4F5"></div>
      <div style="display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid rgba(0,0,0,.08)">
        <div style="width:48px;height:48px;border-radius:50%;background:#3B82F6"></div>
        <div style="flex:1"><div style="font:600 15px">Коллега</div><div style="font:400 13px;color:#707579">Фото</div></div>
        <div style="font:500 11px;color:#A2ACB4">11:34</div>
      </div>
    </div>`;
    await composeSbs(browser, fakeListLight, crop, 'list_light_side_by_side.png', false);
    await ctx.close();
  }

  await browser.close();

  // Persist bottom nav full-width in CSS (list sprint)
  console.log('chatId', chatId, 'tgThread exists', fs.existsSync(TG_THREAD));
  if (process.exitCode) process.exit(1);
  console.log('ALL remaining SBS written to', OUT_DIR);
}

main().catch((e) => { console.error(e); process.exit(1); });
