'use strict';
// Светлая тема на проде без логина: выставляем localStorage и снимаем.
const { chromium } = require('playwright');
const PROD = process.env.PROD_URL || 'https://92.242.61.184';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('asgard_theme', 'light');
      localStorage.setItem('asgard_theme_chosen', '1');
      for (const k of ['asgard_shell_banner_dismissed', 'cr_modal_seen', 'asgard_v2_banner_dismissed']) localStorage.setItem(k, '1');
    } catch (e) {}
  });
  const page = await ctx.newPage();
  await page.goto(PROD + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6000);

  const out = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const css = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, blur: s.backdropFilter, color: s.color };
    };
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      version: window.ASGARD_SHELL_VERSION,
      bg1: cs.getPropertyValue('--bg1').trim(),
      t1: cs.getPropertyValue('--t1').trim(),
      sidenav: css('.sidenav'),
      topbar: css('.topbar'),
      // проверяем, что новые CSS реально применились
      hasContrastFix: !!document.querySelector('link[href*="light-contrast-fix"]'),
      hasButtons: !!document.querySelector('link[href*="light-buttons"]'),
      hasGlass: !!document.querySelector('link[href*="light-glass"]'),
      // шрифт
      fontFamily: getComputedStyle(document.body).fontFamily.slice(0, 60)
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await page.screenshot({ path: 'tests/reports/full-audit/prod-light.png' });
  await b.close();
})();
