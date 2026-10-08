'use strict';

/**
 * Build SBS CRM|REF panels for Huginn shots via Playwright + data URLs.
 * Out: VERIFY/PREDEPLOY-VISUAL/SBS/<SHOT>-crm-ref.png
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CAPTURE = path.join(ROOT, 'VERIFY/PREDEPLOY-VISUAL/CAPTURE');
const REFS = path.join(ROOT, 'tests/reports/huginn-ui/FOR-REVIEW/TG-DESIGN-BOOK/REFS');
const OUT = path.join(ROOT, 'VERIFY/PREDEPLOY-VISUAL/SBS');
fs.mkdirSync(OUT, { recursive: true });

const MAP = [
  ['S01', 'CRM-S01-chat-list-dark.png', 'S01.jpg'],
  ['S02', 'CRM-S02-contacts-list.png', 'S02.jpg'],
  ['S03', 'CRM-S03-group-profile.png', 'S03.jpg'],
  ['S04', 'CRM-S05-group-chat-ios-dark.png', 'S04.jpg'], // OUT kbd — alias
  ['S05', 'CRM-S05-group-chat-ios-dark.png', 'S05.jpg'],
  ['S06', 'CRM-S06-profile-main.png', 'S06.jpg'],
  ['S07', 'CRM-S07-outgoing-voice.png', 'S07.jpg'],
  ['S08', 'CRM-S05-group-chat-ios-dark.png', 'S08.jpg'], // OUT live-geo — alias thread
  ['S09', 'CRM-S09-voice-record-locked.png', 'S09.jpg'],
  ['S10', 'CRM-S10-circle-record.png', 'S10.jpg'],
  ['S11', 'CRM-S11-ios-chat-bubbles.png', 'S11.jpg'],
  ['S12', 'CRM-S12-contacts-glass-nav.png', 'S12.jpg'],
  ['S13', 'CRM-S13-compose-create.png', 'S13.jpg'],
  ['S14', 'CRM-S14-calls-ios.png', 'S14.jpg'],
  // S15 DEFER — skip if no capture
  ['S16', 'CRM-S16-mute-menu.png', 'S16.jpg'],
  // S17 DEFER
  ['S18', 'CRM-S18-shared-media-grid.png', 'S18.jpg'],
  ['S19', 'CRM-S19-profile-more.png', 'S19.jpg'],
  ['S20', 'CRM-S20-shared-files.png', 'S20.jpg'],
  ['S21', 'CRM-S21-shared-links.png', 'S21.jpg'],
  ['S22', 'CRM-S22-shared-voice-list.png', 'S22.jpg'],
  ['S23', 'CRM-S23-members-glass.png', 'S23.jpg'],
  ['S24', 'CRM-S24-header-pinned.png', 'S24.jpg'],
  ['S25', 'CRM-S05-group-chat-ios-dark.png', 'S25.jpg'], // OUT kbd+geo
  ['S26', 'CRM-S26-reply-reactions.png', 'S26.jpg'],
  ['S27', 'CRM-S28-composer-glass.png', 'S27.jpg'], // OUT OS kbd
  ['S28', 'CRM-S28-composer-glass.png', 'S28.jpg'],
  ['S29', 'CRM-S29-settings-profile.png', 'S29.jpg'],
  ['S30', 'CRM-S30-album.png', 'S30.jpg'],
  // S31 DEFER
  ['S32', 'CRM-S32-settings-root.png', 'S32.jpg'],
  ['S33', 'CRM-S33-settings-menu.png', 'S33.jpg'],
  ['S34', 'CRM-S34-settings-compact.png', 'S34.jpg'],
  ['S35', 'CRM-S35-stories-header.png', 'S35.jpg'],
  ['S36', 'CRM-S36-glass-tabbar-fab.png', 'S36.jpg'],
  ['S37', 'CRM-S37-stories-liquid.png', 'S37.jpg'],
  ['S38', 'CRM-S37-stories-liquid.png', 'S38.jpg'], // near-dup stories
  ['S39', 'CRM-S39-publications.png', 'S39.jpg'],
  ['S40', 'CRM-S40-archive.png', 'S40.jpg'],
  ['S42', 'CRM-S42-compose-create.png', 'S42.jpg'],
  ['S45', 'CRM-S45-members.png', 'S45.jpg'],
  ['S46', 'CRM-S46-list-edit.png', 'S46.jpg'],
  ['S48', 'CRM-S48-members.png', 'S48.jpg'],
  ['S49', 'CRM-S49-profile-more.png', 'S49.jpg'],
  ['S50', 'CRM-S50-sound-menu.png', 'S50.jpg'],
  ['S51', 'CRM-S51-profile-more.png', 'S51.jpg'],
  ['S52', 'CRM-S52-member-menu.png', 'S52.jpg'],
  ['S54', 'CRM-S54-contacts.png', 'S54.jpg'],
  ['S55', 'CRM-S55-members.png', 'S55.jpg'],
  ['S56', 'CRM-S56-connecting.png', 'S56.jpg'],
  ['S57', 'CRM-S57-pin-chat.png', 'S57.jpg'],
  ['S58', 'CRM-S58-reply-composer.png', 'S58.jpg'],
  ['A01', 'CRM-A01-new-style-sheet.png', 'A01.jpg'],
  ['A02', 'CRM-A02-ai-style-generate.png', 'A02.jpg'],
  ['A03', 'CRM-A03-ai-grammar-apply.png', 'A03.jpg'],
  ['A04', 'CRM-A04-ai-translate-apply.png', 'A04.jpg'],
  ['A05', 'CRM-A05-ai-style-apply.png', 'A05.jpg'],
  ['A06', 'CRM-A06-composer-idle-no-ai.png', 'A06.jpg'],
  ['A07', 'CRM-A07-ai-over-attach.png', 'A07.jpg'],
  ['A08', 'CRM-A07-ai-over-attach.png', 'A08.jpg']
  // NO_CAPTURE IN (S41 S43 S44 S47 S53): omitted until UI HAVE
];

function dataUrl(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
      : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 860, height: 960 } });
  let built = 0;
  let skipped = 0;
  for (const [shot, crmName, refName] of MAP) {
    const crm = path.join(CAPTURE, crmName);
    const ref = path.join(REFS, refName);
    if (!fs.existsSync(crm) || !fs.existsSync(ref)) {
      console.log('SKIP', shot, !fs.existsSync(crm) ? 'no-crm' : 'no-ref', crmName);
      skipped++;
      continue;
    }
    const crmUrl = dataUrl(crm);
    const refUrl = dataUrl(ref);
    const html = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#111;color:#fff;font:14px sans-serif">
  <div style="display:flex;gap:8px;padding:8px;align-items:flex-start">
    <div style="flex:0 0 auto"><div style="margin-bottom:6px">CRM ${shot}</div>
      <img id="crm" src="${crmUrl}" width="414" height="896" style="display:block;background:#222;object-fit:cover"/></div>
    <div style="flex:0 0 auto"><div style="margin-bottom:6px">REF ${refName}</div>
      <img id="ref" src="${refUrl}" width="414" height="896" style="display:block;background:#222;object-fit:cover"/></div>
  </div>
</body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(() => {
      const a = document.getElementById('crm');
      const b = document.getElementById('ref');
      return a && b && a.complete && b.complete && a.naturalWidth > 0 && b.naturalWidth > 0;
    }, { timeout: 15000 });
    const out = path.join(OUT, `${shot}-crm-ref.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log('SBS', shot);
    built++;
  }
  await browser.close();
  console.log('SBS_DONE built=' + built + ' skipped=' + skipped);
  if (built === 0) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
