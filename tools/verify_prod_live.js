'use strict';
/**
 * Проверка живого прода: русский текст на месте, контраст, ошибки.
 * Работает по HTTPS с игнором самоподписанного сертификата.
 */
const { chromium } = require('playwright');

const PROD = process.env.PROD_URL || 'https://92.242.61.184';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 980 },
    ignoreHTTPSErrors: true
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));

  await page.goto(PROD + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);

  // 1. Проверяем, что нет mojibake в DOM
  const dom = await page.evaluate(() => {
    const txt = document.body.innerText;
    const moji = (txt.match(/[\u2568\u2564\u2565]/g) || []).length;
    const fffd = (txt.match(/\ufffd/g) || []).length;
    // ищем ключевую фразу гейта присутствия
    const hasGate = txt.includes('рабочую неделю') || txt.includes('держать строй');
    return {
      moji, fffd,
      hasGate,
      sample: txt.slice(0, 200).replace(/\s+/g, ' '),
      theme: document.documentElement.getAttribute('data-theme'),
      version: window.ASGARD_SHELL_VERSION || '—'
    };
  });
  console.log('=== продакшн DOM:');
  console.log(JSON.stringify(dom, null, 1));

  // 2. Контраст на главной
  const contrast = await page.evaluate(() => {
    const parse = (c) => {
      const str = String(c);
      const cs = str.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
      if (cs) return { r: +cs[1] * 255, g: +cs[2] * 255, b: +cs[3] * 255, a: cs[4] !== undefined ? +cs[4] : 1 };
      const m = str.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x.trim()));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const blend = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
    const effBg = (el) => {
      let node = el, acc = null;
      while (node && node !== document.documentElement) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage !== 'none' && /gradient/.test(cs.backgroundImage) && !acc) return { grad: true };
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) { acc = acc ? blend(acc, c) : c; if (c.a >= 0.999) return acc; }
        node = node.parentElement;
      }
      return acc || { r: 255, g: 255, b: 255, a: 1 };
    };
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const t = w.currentNode;
      if ((t.nodeValue || '').trim().length < 2) continue;
      const el = t.parentElement;
      if (!el || !vis(el) || el.closest('svg')) continue;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      if (!fg) continue;
      const bg = effBg(el);
      if (bg.grad) continue;
      const f = fg.a < 1 ? blend(fg, bg) : fg;
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const need = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5;
      const cr = ratio(f, bg);
      if (cr < need) out.push({ text: (t.nodeValue || '').trim().slice(0, 40), cls: String(el.className).slice(0, 40), ratio: Math.round(cr * 100) / 100 });
    }
    return out;
  });
  console.log('\n=== контраст на главной (нарушений):', contrast.length);
  contrast.slice(0, 8).forEach((c) => console.log(`   ${c.ratio}:1 "${c.text}" .${c.cls}`));

  console.log('\n=== JS-ошибки:', errors.length);
  errors.slice(0, 5).forEach((e) => console.log('   ' + e));

  await page.screenshot({ path: 'tests/reports/full-audit/prod-home.png' });
  await browser.close();
})();
