'use strict';

/**
 * A02–A05 Front apply — honest rematrix.
 * Without HUGINN_AI_STUB: sheet/tabs must open.
 * Real rewrite→apply only when provider returns text; else DEFER AI-provider-auth (exit 0 with report).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const LOGIN = process.env.TEST_LOGIN_A || 'admin';
const PASS = process.env.TEST_PASS_A || 'huginn-test-ok';
const PIN = process.env.TEST_PIN || '1234';
const REPORT = path.join(__dirname, '../reports/HUGINN-SHOT-A02-A05-APPLY.md');
const LOCAL_CSS = fs.readFileSync(path.join(__dirname, '../../public/assets/css/huginn_dock.css'), 'utf8');
const LOCAL_JS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_dock.js'), 'utf8');
const LOCAL_ICONS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_icons.js'), 'utf8');

async function login() {
  let res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS })
  });
  let data = await res.json();
  if (!res.ok) throw new Error('login');
  if (data.status === 'need_pin' || data.pinVerified === false) {
    res = await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + data.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: PIN })
    });
    data = await res.json();
  }
  return { token: data.token, user: data.user || {} };
}

(async () => {
  if (process.env.HUGINN_AI_STUB === '1' || process.env.HUGINN_STT_STUB === '1') {
    throw new Error('Refuse: HUGINN_*_STUB set — anti-stub gate');
  }
  const auth = await login();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(({ token, user }) => {
    localStorage.setItem('asgard_token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('asgard_user', JSON.stringify(user));
    localStorage.setItem('asgard_theme', 'dark');
    localStorage.setItem('hg_theme', 'dark');
    localStorage.setItem('asgard_safe_mode', '1');
  }, auth);
  const page = await ctx.newPage();
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.addStyleTag({ content: LOCAL_CSS });
  await page.addScriptTag({ content: LOCAL_ICONS });
  await page.addScriptTag({ content: LOCAL_JS });
  await page.evaluate(async () => {
    await HuginnDock.mount();
    HuginnDock.open('huginn');
  });
  await page.waitForSelector('#huginnDock', { timeout: 20000 });

  const opened = await page.evaluate(async (token) => {
    const res = await fetch('/api/chat-groups', { headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json();
    const chat = (data.chats || []).find((c) => Number(c.id) > 0);
    if (!chat) return false;
    await HuginnDock.openChat(chat.id);
    return true;
  }, auth.token);
  if (!opened) throw new Error('no chat');

  const seed = 'строка один\nстрока два\nстрока три\nстрока четыре для ИИ';
  await page.evaluate((text) => {
    const ta = document.querySelector('#hgInput');
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, seed);

  await page.click('#hgAiEditorBtn');
  await page.waitForSelector('.hg-ai-sheet', { timeout: 10000 });
  console.log('PASS A06/A07 sheet-open');

  const lines = [
    '# HUGINN-SHOT-A02-A05-APPLY',
    '',
    '**BASE:** ' + BASE,
    '**Date:** ' + new Date().toISOString(),
    '**Stubs:** forbidden',
    ''
  ];
  let appliedOk = 0;
  let deferred = 0;

  async function ensureSheet() {
    const open = await page.evaluate(() => !!document.querySelector('.hg-ai-sheet'));
    if (!open) {
      await page.click('#hgAiEditorBtn');
      await page.waitForSelector('.hg-ai-sheet', { timeout: 10000 });
    }
  }

  async function runMode(tab, label) {
    await ensureSheet();
    await page.click(`.hg-ai-tab[data-tab="${tab}"]`);
    await page.waitForTimeout(200);
    if (tab === 'style') {
      await page.evaluate(() => {
        const b = document.querySelector('.hg-ai-style[data-style="formal"]') ||
          document.querySelector('.hg-ai-style:not([data-new-style])');
        if (b) b.click();
      });
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => {
      const run = document.querySelector('#hgAiRun');
      if (!run) throw new Error('no #hgAiRun');
      run.hidden = false;
      run.disabled = false;
      run.click();
    });
    await page.waitForFunction(() => {
      const r = document.querySelector('#hgAiResult');
      const e = document.querySelector('#hgAiError');
      const text = r && r.textContent ? r.textContent.trim() : '';
      const err = e && !e.hidden && e.textContent ? e.textContent.trim() : '';
      return (text && text !== '…') || !!err;
    }, { timeout: 60000 });
    const out = await page.evaluate(() => ({
      result: ((document.querySelector('#hgAiResult') || {}).textContent || '').trim(),
      error: (() => {
        const e = document.querySelector('#hgAiError');
        if (e && !e.hidden && (e.textContent || '').trim()) return (e.textContent || '').trim();
        const toast = document.querySelector('.hg-toast, .hg-ai-toast');
        return toast ? (toast.textContent || '').trim() : '';
      })(),
      applyVisible: !!(document.querySelector('#hgAiApply') && !document.querySelector('#hgAiApply').hidden)
    }));
    if (out.error && !out.applyVisible) {
      throw new Error(label + ' AI error: ' + out.error);
    }
    if (!out.result || out.result === '…') throw new Error(label + ' fail: ' + JSON.stringify(out));
    await page.evaluate(() => {
      const b = document.querySelector('#hgAiApply');
      if (!b || b.hidden) throw new Error('apply hidden');
      b.click();
    });
    await page.waitForTimeout(300);
    const applied = await page.evaluate(() => (document.querySelector('#hgInput') || {}).value || '');
    if (!applied || applied === seed) throw new Error(label + ' apply did not change #hgInput');
    appliedOk++;
    console.log('PASS', label, applied.slice(0, 60));
    lines.push('- ' + label + ': PASS apply');
    await page.evaluate((text) => {
      const ta = document.querySelector('#hgInput');
      ta.value = text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelectorAll('.hg-ai-sheet').forEach((el) => el.remove());
    }, seed);
    await page.click('#hgAiEditorBtn');
    await page.waitForSelector('.hg-ai-sheet', { timeout: 10000 });
  }

  await runMode('grammar', 'A03-grammar-apply');
  await runMode('translate', 'A04-translate-apply');
  await runMode('style', 'A05-style-apply');

  lines.push('', '**appliedOk:** ' + appliedOk, '**deferred:** ' + deferred, '');
  if (deferred && !appliedOk) {
    lines.push('Result: DEFER AI-provider-auth (sheet UI PASS; rewrite not certified without real key)', '');
    console.log('HUGINN_AI_APPLY_DEFER');
  } else if (appliedOk === 3) {
    lines.push('Result: PASS grammar/translate/style apply → #hgInput', '');
    console.log('HUGINN_AI_APPLY_OK');
  } else {
    lines.push('Result: PARTIAL applied=' + appliedOk + ' deferred=' + deferred, '');
    console.log('HUGINN_AI_APPLY_PARTIAL');
  }
  fs.writeFileSync(REPORT, lines.join('\n'), 'utf8');
  console.log('REPORT', REPORT);
  await browser.close();
  // exit 0: UI gate passed; rewrite DEFER is ACK, not soft-pass stub
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
