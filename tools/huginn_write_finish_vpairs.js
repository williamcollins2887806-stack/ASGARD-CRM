'use strict';
/** Honest finish V-PAIR — 1в1 only after SBS Read in this pass. */
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '../VERIFY/PREDEPLOY-VISUAL');

const PAIRS = [
  ['S01', '1в1', 'CRM-S01-chat-list-dark.png', 'S01.jpg', ['List+pinned+glass tabbar; ACK CRM folders/tabs'], 'HOLD'],
  ['S02', '1в1', 'CRM-S02-contacts-list.png', 'S02.jpg', ['Contacts A–Я+nav; ACK initials'], 'HOLD'],
  ['S03', 'не 1в1', 'CRM-S03-group-profile.png', 'S03.jpg', ['Profile denser; seed media≠фото REF'], 'REWORK'],
  ['S04', 'не 1в1', 'CRM-S05-group-chat-ios-dark.png', 'S04.jpg', ['OS_N/A'], '—'],
  ['S05', 'не 1в1', 'CRM-S05-group-chat-ios-dark.png', 'S05.jpg', ['Thread ok chrome; color tiles/0B file ≠ REF'], 'REWORK'],
  ['S06', 'не 1в1', 'CRM-S06-profile-main.png', 'S06.jpg', ['Profile denser than REF'], 'REWORK'],
  ['S07', 'не 1в1', 'CRM-S07-outgoing-voice.png', 'S07.jpg', ['STT BE PASS; Front bubble short'], 'REWORK'],
  ['S09', '1в1', 'CRM-S09-voice-record-locked.png', 'S09.jpg', ['Rec overlay chrome'], 'HOLD'],
  ['S10', '1в1', 'CRM-S10-circle-record.png', 'S10.jpg', ['Circle FS; ACK headless preview'], 'HOLD'],
  ['S11', 'не 1в1', 'CRM-S11-ios-chat-bubbles.png', 'S11.jpg', ['Bubbles density'], 'REWORK'],
  ['S12', '1в1', 'CRM-S12-contacts-glass-nav.png', 'S12.jpg', ['Contacts+glass'], 'HOLD'],
  ['S13', '1в1', 'CRM-S13-compose-create.png', 'S13.jpg', ['Compose X/✓/index'], 'HOLD'],
  ['S14', 'не 1в1', 'CRM-S14-calls-ios.png', 'S14.jpg', ['Calls weak'], 'REWORK'],
  ['S16', 'не 1в1', 'CRM-S16-mute-menu.png', 'S16.jpg', ['Mute'], 'REWORK'],
  ['S18', 'не 1в1', 'CRM-S18-shared-media-grid.png', 'S18.jpg', ['Color seed≠фото'], 'REWORK'],
  ['S19', 'не 1в1', 'CRM-S19-profile-more.png', 'S19.jpg', ['More'], 'REWORK'],
  ['S20', 'не 1в1', 'CRM-S20-shared-files.png', 'S20.jpg', ['Files'], 'REWORK'],
  ['S21', 'не 1в1', 'CRM-S21-shared-links.png', 'S21.jpg', ['Links'], 'REWORK'],
  ['S22', 'не 1в1', 'CRM-S22-shared-voice-list.png', 'S22.jpg', ['Voices'], 'REWORK'],
  ['S23', 'не 1в1', 'CRM-S23-members-glass.png', 'S23.jpg', ['Members'], 'REWORK'],
  ['S24', 'не 1в1', 'CRM-S24-header-pinned.png', 'S24.jpg', ['Pinned'], 'REWORK'],
  ['S26', 'не 1в1', 'CRM-S26-reply-reactions.png', 'S26.jpg', ['Reply'], 'REWORK'],
  ['S27', 'не 1в1', 'CRM-S28-composer-glass.png', 'S27.jpg', ['OS_N/A'], '—'],
  ['S28', '1в1', 'CRM-S28-composer-glass.png', 'S28.jpg', ['Composer glass'], 'HOLD'],
  ['S29', 'не 1в1', 'CRM-S29-settings-profile.png', 'S29.jpg', ['Profile denser'], 'REWORK'],
  ['S30', 'не 1в1', 'CRM-S30-album.png', 'S30.jpg', ['Album'], 'REWORK'],
  ['S32', '1в1', 'CRM-S32-settings-root.png', 'S32.jpg', ['Settings list+nav; ACK no Premium'], 'HOLD'],
  ['S33', '1в1', 'CRM-S33-settings-menu.png', 'S33.jpg', ['Settings family'], 'HOLD'],
  ['S34', '1в1', 'CRM-S34-settings-compact.png', 'S34.jpg', ['Settings family'], 'HOLD'],
  ['S35', 'не 1в1', 'CRM-S35-stories-header.png', 'S35.jpg', ['Stories initials'], 'REWORK'],
  ['S36', '1в1', 'CRM-S36-glass-tabbar-fab.png', 'S36.jpg', ['Glass tabbar+FAB'], 'HOLD'],
  ['S37', 'не 1в1', 'CRM-S37-stories-liquid.png', 'S37.jpg', ['Stories'], 'REWORK'],
  ['A01', 'не 1в1', 'CRM-A01-new-style-sheet.png', 'A01.jpg', ['AI REF mapped; need Read after recapture'], 'REWORK'],
  ['A02', 'не 1в1', 'CRM-A02-ai-style-generate.png', 'A02.jpg', ['AI REF mapped; need Read'], 'REWORK'],
  ['A03', 'не 1в1', 'CRM-A03-ai-grammar-apply.png', 'A03.jpg', ['AI REF mapped; need Read'], 'REWORK'],
  ['A04', 'не 1в1', 'CRM-A04-ai-translate-apply.png', 'A04.jpg', ['AI REF mapped; need Read'], 'REWORK'],
  ['A05', 'не 1в1', 'CRM-A05-ai-style-apply.png', 'A05.jpg', ['AI REF mapped; need Read'], 'REWORK'],
  ['A06', 'не 1в1', 'CRM-A06-composer-idle-no-ai.png', 'A06.jpg', ['AI REF mapped; need Read'], 'REWORK'],
  ['A07', 'не 1в1', 'CRM-A07-ai-over-attach.png', 'A07.jpg', ['AI REF mapped; need Read'], 'REWORK']
];

function md(shot, verdict, crm, ref, diffs, go) {
  return [
    `# V-PAIR-${shot}`, '',
    `**Дата:** 2026-10-06 (finish pass)`,
    `**Вердикт:** \`${verdict}\``,
    `**CRM:** VERIFY/PREDEPLOY-VISUAL/CAPTURE/${crm}`,
    `**REF:** tests/reports/huginn-ui/FOR-REVIEW/TG-DESIGN-BOOK/REFS/${ref}`,
    `**SBS:** VERIFY/PREDEPLOY-VISUAL/SBS/${shot}-crm-ref.png`, '',
    '## Diffs (Read)', ...diffs.map((d) => `- ${d}`), '',
    `## Go: ${go}`, '',
    verdict === '1в1' ? 'Front 1в1 — Front [x].' : 'Front открыт — REWORK.'
  ].join('\n');
}

let n1 = 0;
for (const p of PAIRS) {
  fs.writeFileSync(path.join(OUT, `V-PAIR-${p[0]}.md`), md(...p), 'utf8');
  if (p[1] === '1в1') n1++;
  console.log(p[0], p[1]);
}
console.log('DONE pairs', PAIRS.length, '1в1', n1);
