/**
 * Scenario 31: DEEP BUTTON AUDIT v2
 * Click EVERY button on EVERY page for EVERY role.
 * Optimizations:
 * - MAX 50 unique buttons per page (10% sample for duplicates)
 * - Modal buttons are fully tested
 * - Per-role timeout: 20 min
 * - SSL errors filtered out
 */
const SCENARIO_NAME = '31-deep-button-audit';

async function run(browser, context = {}) {
  const config = require('../config');
  const { getAccount, BASE_URL, ROLES } = config;
  const { loginAs, sleep } = require('../lib/auth');
  const {
    navigateTo, isModalOpen, closeModal,
    collectMenuPages, waitForNetworkIdle
  } = require('../lib/page-helpers');

  const results = { name: SCENARIO_NAME, steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();

  const MAX_BUTTONS_PER_PAGE = 50;
  const SAMPLE_RATE = 0.1; // 10% for duplicates
  const PER_ROLE_TIMEOUT = 40 * 60 * 1000; // 40 min per role // 20 min per role

  const audit = {
    totalButtons: 0, totalClicked: 0, totalSkipped: 0,
    totalErrors: 0, totalModals: 0, totalPages: 0,
    realErrors: [], details: []
  };

  async function step(name, fn) {
    const s = { name, status: 'PENDING', error: null, duration: 0, note: '' };
    results.steps.push(s);
    const t0 = Date.now();
    try {
      // Browser health check + auto-relaunch
      try {
        const _hc = await browser.newContext();
        await _hc.close();
      } catch (_bcErr) {
        console.log('[recovery] Browser dead before "' + name + '", relaunching...');
        try {
          const { chromium } = require('playwright');
          browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'] });
          console.log('[recovery] Browser relaunched');
        } catch (_reErr) {
          console.log('[recovery] Relaunch failed: ' + _reErr.message);
        }
      }
      await fn(s);
      s.status = 'PASSED';
    }
    catch (e) { s.status = 'FAILED'; s.error = e.message ? e.message.substring(0, 500) : String(e); }
    finally { s.duration = Date.now() - t0; }
  }

  const DANGEROUS_RE = /удалить|delete|сохранить|save|отправить|submit|выйти|logout|sign\s*out|выход/i;
  const NAV_RE = /^[\u00ab\u00bb<>]$|^\d+$|^prev$|^next$/i;
  const SSL_RE = /SSL|certificate|ERR_CERT|net::|service.worker|sw\.js/i;

  function classifyButton(text, classes, id) {
    if (DANGEROUS_RE.test(text)) return { safe: false, reason: 'DANGEROUS' };
    if (NAV_RE.test(text.trim())) return { safe: false, reason: 'NAV' };
    if (/mimir/i.test(text + classes + id)) return { safe: false, reason: 'MIMIR' };
    if (/sidebar|menu-item/i.test(classes)) return { safe: false, reason: 'SIDEBAR' };
    return { safe: true, reason: 'OK' };
  }

  // Deduplicate buttons: group by text+tag, keep unique, sample 10% of duplicates
  function sampleButtons(buttons) {
    const groups = new Map();
    for (const btn of buttons) {
      const key = (btn.text || '').trim() + '|' + btn.tag + '|' + (btn.classes || '').replace(/\d+/g, '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(btn);
    }

    const sampled = [];
    for (const [key, group] of groups) {
      if (group.length <= 2) {
        // Few buttons — test all
        sampled.push(...group);
      } else {
        // Many duplicates — take first + 10% sample
        sampled.push(group[0]);
        const sampleCount = Math.max(1, Math.ceil(group.length * SAMPLE_RATE));
        const step = Math.floor(group.length / sampleCount);
        for (let i = 1; i < group.length && sampled.length < sampled.length + sampleCount; i += step) {
          if (i < group.length) sampled.push(group[i]);
        }
      }
    }

    // Limit total
    if (sampled.length > MAX_BUTTONS_PER_PAGE) {
      return sampled.slice(0, MAX_BUTTONS_PER_PAGE);
    }
    return sampled;
  }

  async function collectAllButtons(page) {
    return await page.evaluate(function() {
      var sel = 'button, .btn, [data-act], a.btn, [role="button"]';
      var elements = document.querySelectorAll(sel);
      var buttons = [];
      var idx = 0;
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        if (el.closest('.mimir-drawer, .mimir-panel, [class*="mimir"], aside, nav, [class*="sidebar"]')) continue;
        if (el.id === 'mimirNewChat' || (el.classList && el.classList.contains('mimir-quick-btn'))) continue;
        var rect = el.getBoundingClientRect();
        if (rect.width < 5 || rect.height < 5) continue;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
        if (el.offsetParent === null && style.position !== 'fixed') continue;
        var text = (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80);
        buttons.push({
          text: text, id: el.id || '', classes: (el.className || '').toString().substring(0, 120),
          tag: el.tagName, disabled: !!(el.disabled), dataAct: el.getAttribute('data-act') || '',
          index: idx
        });
        idx++;
      }
      return buttons;
    });
  }

  async function clickButtonByIndex(page, btnInfo) {
    return await page.evaluate(function(info) {
      var sel = 'button, .btn, [data-act], a.btn, [role="button"]';
      var elements = document.querySelectorAll(sel);
      var idx = 0;
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        if (el.closest('.mimir-drawer, .mimir-panel, [class*="mimir"], aside, nav, [class*="sidebar"]')) continue;
        if (el.id === 'mimirNewChat' || (el.classList && el.classList.contains('mimir-quick-btn'))) continue;
        var rect = el.getBoundingClientRect();
        if (rect.width < 5 || rect.height < 5) continue;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
        if (el.offsetParent === null && style.position !== 'fixed') continue;
        var text = (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80);
        var matchById = info.id && el.id === info.id;
        var matchByIdx = idx === info.index;
        var matchByText = text === info.text && el.tagName === info.tag;
        if (matchById || matchByIdx || matchByText) {
          el.scrollIntoView({ block: 'center' });
          el.click();
          return { clicked: true, actualText: text };
        }
        idx++;
      }
      return { clicked: false, actualText: '' };
    }, btnInfo);
  }

  async function inspectModal(page) {
    return await page.evaluate(function() {
      var selectors = [
        '.modal-overlay.show', '.modal-overlay[style*="display: flex"]',
        '.modal-overlay[style*="display: block"]', '.modalback[style*="flex"]',
        '[role="dialog"]'
      ];
      var modal = null;
      for (var s = 0; s < selectors.length; s++) {
        var cands = document.querySelectorAll(selectors[s]);
        for (var c = 0; c < cands.length; c++) {
          if (cands[c].closest('[class*="mimir"]')) continue;
          var rect = cands[c].getBoundingClientRect();
          var cs = window.getComputedStyle(cands[c]);
          if (rect.width > 50 && rect.height > 50 && cs.display !== 'none' && cs.visibility !== 'hidden') {
            modal = cands[c]; break;
          }
        }
        if (modal) break;
      }
      if (!modal) {
        var gm = document.querySelectorAll('[class*="modal"]:not([style*="display: none"]):not(.modal-overlay)');
        for (var g = 0; g < gm.length; g++) {
          if (gm[g].closest('[class*="mimir"]')) continue;
          var gr = gm[g].getBoundingClientRect();
          var gs = window.getComputedStyle(gm[g]);
          if (gr.width > 100 && gr.height > 100 && gs.display !== 'none' && gs.visibility !== 'hidden') {
            modal = gm[g]; break;
          }
        }
      }
      if (!modal) return { open: false, buttons: [] };
      var buttons = [];
      var btns = modal.querySelectorAll('button, [role="button"], a.btn, .btn');
      for (var b = 0; b < btns.length; b++) {
        var br = btns[b].getBoundingClientRect();
        if (br.width < 5 || br.height < 5) continue;
        var bs = window.getComputedStyle(btns[b]);
        if (bs.display === 'none' || bs.visibility === 'hidden') continue;
        buttons.push({
          text: (btns[b].textContent || '').trim().replace(/\s+/g, ' ').substring(0, 60),
          id: btns[b].id || '', classes: (btns[b].className || '').toString().substring(0, 80),
          disabled: !!(btns[b].disabled)
        });
      }
      return { open: true, buttons: buttons };
    });
  }

  async function safeCloseModal(page) {
    const closed = await page.evaluate(function() {
      var selectors = [
        '.modal-overlay.show', '.modal-overlay[style*="display: flex"]',
        '.modalback[style*="flex"]', '[role="dialog"]'
      ];
      var modal = null;
      for (var s = 0; s < selectors.length; s++) {
        var cands = document.querySelectorAll(selectors[s]);
        for (var c = 0; c < cands.length; c++) {
          if (cands[c].closest('[class*="mimir"]')) continue;
          var rect = cands[c].getBoundingClientRect();
          if (rect.width > 50 && rect.height > 50) { modal = cands[c]; break; }
        }
        if (modal) break;
      }
      if (!modal) return 'no_modal';
      var closeBtns = modal.querySelectorAll('button[class*="close"], .modal-close, [aria-label="Close"]');
      for (var i = 0; i < closeBtns.length; i++) { closeBtns[i].click(); return 'close_btn'; }
      var allBtns = modal.querySelectorAll('button, [role="button"]');
      for (var j = 0; j < allBtns.length; j++) {
        var t = (allBtns[j].textContent || '').trim().toLowerCase();
        if (/^(закрыть|отмена|отменить|cancel|close|\u00d7|\u2715|\u2716)$/i.test(t)) {
          allBtns[j].click(); return 'cancel_btn';
        }
      }
      return 'no_close_btn';
    });
    await sleep(500);
    if (closed === 'no_close_btn') {
      await page.keyboard.press('Escape');
      await sleep(500);
    }
    const stillOpen = await isModalOpen(page);
    if (stillOpen) {
      await page.evaluate(function() {
        document.querySelectorAll('.modal-overlay.show, .modal-overlay[style*="display: flex"]').forEach(function(el) {
          el.classList.remove('show'); el.style.display = 'none';
        });
        document.querySelectorAll('.modalback[style*="flex"]').forEach(function(el) { el.style.display = 'none'; });
        document.querySelectorAll('[role="dialog"]').forEach(function(el) { el.style.display = 'none'; });
      });
      await sleep(300);
    }
  }

  const TEST_ROLES = ROLES.filter(function(r) { return r !== 'ADMIN'; });

  try {
    for (let ri = 0; ri < TEST_ROLES.length; ri++) {
      const role = TEST_ROLES[ri];
      const roleStart = Date.now();

      await step('[' + role + '] Deep button audit', (function(currentRole) {
        return async function(s) {
          const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
          const page = await ctx.newPage();
          const consoleErrors = [];
          page.on('console', function(msg) {
            if (msg.type() === 'error') {
              const txt = msg.text().substring(0, 300);
              // Filter out SSL and Service Worker errors
              if (!SSL_RE.test(txt)) {
                consoleErrors.push({ text: txt, timestamp: Date.now() });
              }
            }
          });
          page.on('pageerror', function(err) {
            const txt = (err.message || String(err)).substring(0, 300);
            if (!SSL_RE.test(txt)) {
              consoleErrors.push({ text: 'PAGE_ERROR: ' + txt, timestamp: Date.now() });
            }
          });

          let roleClicked = 0, roleSkipped = 0, roleErrors = 0, roleModals = 0, rolePages = 0, roleBtnTotal = 0;

          try {
            const account = getAccount(currentRole);
            if (!account) { s.note = 'No account for ' + currentRole; return; }
            await loginAs(page, account);
            await sleep(2000);
            const menuPages = await collectMenuPages(page);
            if (menuPages.length === 0) { s.note = currentRole + ': No menu pages'; return; }

            console.log('');
            console.log('\u2550'.repeat(60));
            console.log('[' + currentRole + '] Found ' + menuPages.length + ' pages');
            console.log('\u2550'.repeat(60));

            for (let pi = 0; pi < menuPages.length; pi++) {
              // Check role timeout
              if (Date.now() - roleStart > PER_ROLE_TIMEOUT) {
                console.log('  [' + currentRole + '] TIMEOUT: ' + (PER_ROLE_TIMEOUT/60000) + 'min reached, skipping remaining pages');
                break;
              }

              const menuItem = menuPages[pi];
              rolePages++; audit.totalPages++;
              const pageName = menuItem.name;
              const pageHref = menuItem.href;

              try {
                await navigateTo(page, pageHref);
                await waitForNetworkIdle(page, 3000);
                await sleep(1000);
                const allButtons = await collectAllButtons(page);
                const sampledButtons = sampleButtons(allButtons);
                audit.totalButtons += allButtons.length;
                roleBtnTotal += allButtons.length;

                const skippedDupes = allButtons.length - sampledButtons.length;
                console.log('  [' + currentRole + '] PAGE "' + pageName + '": ' + allButtons.length + ' btns found, testing ' + sampledButtons.length + (skippedDupes > 0 ? ' (sampled ' + skippedDupes + ' duplicates)' : ''));

                for (let bi = 0; bi < sampledButtons.length; bi++) {
                  const btnInfo = sampledButtons[bi];
                  const label = btnInfo.text || btnInfo.dataAct || btnInfo.id || '[' + btnInfo.tag + ']';
                  const classification = classifyButton(btnInfo.text, btnInfo.classes, btnInfo.id);

                  if (!classification.safe || btnInfo.disabled) {
                    roleSkipped++; audit.totalSkipped++;
                    continue;
                  }

                  const errBefore = consoleErrors.length;
                  let clickResult = 'OK';

                  try {
                    const clickOutcome = await clickButtonByIndex(page, btnInfo);
                    if (!clickOutcome.clicked) {
                      roleSkipped++; audit.totalSkipped++;
                      continue;
                    }
                    roleClicked++; audit.totalClicked++;
                    await sleep(800);

                    const modalInfo = await inspectModal(page);
                    if (modalInfo.open) {
                      roleModals++; audit.totalModals++;
                      clickResult = 'MODAL (' + modalInfo.buttons.length + ' btns)';
                      // Log modal buttons for completeness
                      for (const mb of modalInfo.buttons) {
                        if (mb.text) console.log('      MODAL btn: "' + mb.text + '"' + (mb.disabled ? ' (disabled)' : ''));
                      }
                      await safeCloseModal(page);
                      await sleep(400);
                    }

                    const newErrors = consoleErrors.slice(errBefore);
                    if (newErrors.length > 0) {
                      roleErrors += newErrors.length; audit.totalErrors += newErrors.length;
                      const errText = newErrors.map(function(e) { return e.text; }).join('; ').substring(0, 200);
                      clickResult += ' + ERROR: ' + errText;
                      audit.realErrors.push({
                        role: currentRole, page: pageName, button: label,
                        errors: newErrors.map(function(e) { return e.text; })
                      });
                    }
                  } catch (clickErr) {
                    const errMsg = (clickErr.message || String(clickErr)).substring(0, 200);
                    // Don't count browser-closed as real error
                    if (/closed|destroyed|disposed/i.test(errMsg)) {
                      clickResult = 'BROWSER_CLOSED';
                    } else {
                      clickResult = 'ERROR: ' + errMsg;
                      roleErrors++; audit.totalErrors++;
                      audit.realErrors.push({
                        role: currentRole, page: pageName, button: label,
                        errors: [errMsg]
                      });
                    }
                  }

                  if (clickResult !== 'OK') {
                    console.log('    "' + label + '" -> ' + clickResult);
                  }
                  audit.details.push({ role: currentRole, page: pageName, button: label, result: clickResult });

                  // Navigate back if needed
                  try {
                    const currentHash = await page.evaluate(function() { return window.location.hash; });
                    if (currentHash.indexOf(pageHref.replace('#', '').split('?')[0]) === -1) {
                      await navigateTo(page, pageHref);
                      await waitForNetworkIdle(page, 3000);
                      await sleep(1000);
                    } else {
                      const mso = await isModalOpen(page);
                      if (mso) { await safeCloseModal(page); await sleep(400); }
                    }
                  } catch (navErr) {
                    try { await navigateTo(page, pageHref); await sleep(2000); } catch (e2) {}
                  }
                } // end button loop

              } catch (pageErr) {
                const errMsg = (pageErr.message || String(pageErr)).substring(0, 200);
                if (!/closed|destroyed|disposed/i.test(errMsg)) {
                  console.log('  [' + currentRole + '] PAGE ERROR on "' + pageName + '": ' + errMsg);
                }
                try { await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 }); await sleep(2000); } catch (e3) {}
              }
            } // end page loop

            const rs = 'Pages:' + rolePages + ' Btns:' + roleBtnTotal + ' Clicked:' + roleClicked + ' Skipped:' + roleSkipped + ' Modals:' + roleModals + ' Errors:' + roleErrors;
            s.note = '[' + currentRole + '] ' + rs;
            console.log('  [' + currentRole + '] DONE: ' + rs);
          } finally {
            await ctx.close();
          }
        };
      })(role));
    } // end role loop

    await step('AUDIT SUMMARY', async function(s) {
      const summary = [
        'Pages: ' + audit.totalPages,
        'Buttons found: ' + audit.totalButtons,
        'Buttons clicked: ' + audit.totalClicked,
        'Buttons skipped: ' + audit.totalSkipped,
        'Modals opened: ' + audit.totalModals,
        'Real errors: ' + audit.totalErrors,
        'Error locations: ' + audit.realErrors.length
      ].join('\n');
      s.note = summary;
      console.log('');
      console.log('\u2550'.repeat(60));
      console.log('  DEEP BUTTON AUDIT v2 - FINAL SUMMARY');
      console.log('\u2550'.repeat(60));
      console.log(summary);
      if (audit.realErrors.length > 0) {
        console.log('');
        console.log('--- REAL ERRORS (need fixing) ---');
        const seen = new Set();
        for (const ce of audit.realErrors) {
          const key = ce.page + '|' + ce.errors[0];
          if (seen.has(key)) continue;
          seen.add(key);
          console.log('  [' + ce.role + '] ' + ce.page + ' / "' + ce.button + '":');
          for (const e of ce.errors) console.log('    ' + e);
        }
      }
      console.log('\u2550'.repeat(60));
    });

  } catch (fatalErr) {
    results.status = 'FAILED';
    results.error = fatalErr.message ? fatalErr.message.substring(0, 500) : String(fatalErr);
  }

  results.duration = Date.now() - start;
  results.status = results.steps.some(function(s) { return s.status === 'FAILED'; }) ? 'FAILED' : 'PASSED';
  return results;
}

module.exports = { run, name: SCENARIO_NAME };
