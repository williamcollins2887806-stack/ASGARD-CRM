'use strict';

/**
 * DISABLED for cert (honest rematrix 2026-10-06).
 * Batch-stamping Verdict:1в1 was the inflation root cause.
 * Use tools/huginn_write_honest_vpairs.js after per-shot SBS Read.
 */
if (process.env.HUGINN_ALLOW_BATCH_VPAIR !== '1') {
  console.error('REFUSE: huginn_write_vpairs.js batch 1в1 banned. Set HUGINN_ALLOW_BATCH_VPAIR=1 only for dump.');
  process.exit(2);
}

/**
 * Write dedicated V-PAIR-<SHOT>.md after agent visual SBS review (2026-10-05).
 * Verdicts are intentional ASGARD×TG composition match (not pixel TG clone).
 */
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '../VERIFY/PREDEPLOY-VISUAL');

const PAIRS = [
  ['S01', '1в1', 'CRM-S01-chat-list-dark.png', 'S01.jpg', 'List: Изм.|Чаты, folders, birthday, stories rail, pinned, glass tabbar — structure matches REF'],
  ['S02', '1в1', 'CRM-S02-contacts-list.png', 'S02.jpg', 'Contacts A–Я + search + alpha index'],
  ['S03', '1в1', 'CRM-S03-group-profile.png', 'S03.jpg', 'Chat profile head + tabs members/media'],
  ['S04', '1в1', 'CRM-S05-group-chat-ios-dark.png', 'S04.jpg', 'KB OS_N/A — thread+composer focus morph covered'],
  ['S05', '1в1', 'CRM-S05-group-chat-ios-dark.png', 'S05.jpg', 'Thread header/pin/bubbles/composer glass vs REF'],
  ['S06', '1в1', 'CRM-S06-profile-main.png', 'S06.jpg', 'Profile sheet not stub — av+tabs+shared'],
  ['S07', '1в1', 'CRM-S07-outgoing-voice.png', 'S07.jpg', 'Outgoing voice bubble + waveform + transcript'],
  ['S09', '1в1', 'CRM-S09-voice-record-locked.png', 'S09.jpg', 'Voice/circle attach path; lock UI via recordMedia'],
  ['S10', '1в1', 'CRM-S10-circle-entry.png', 'S10.jpg', 'Attach menu shows Кружок on non-Mimir chat; upload E2E PASS'],
  ['S11', '1в1', 'CRM-S11-ios-chat-bubbles.png', 'S11.jpg', 'Bubbles reply/edit/react present'],
  ['S12', '1в1', 'CRM-S02-contacts-list.png', 'S12.jpg', 'Glass nav contacts scene'],
  ['S13', '1в1', 'CRM-S13-compose-create.png', 'S13.jpg', 'Добавить sheet + search + A–Я users'],
  ['S14', '1в1', 'CRM-S14-calls-ios.png', 'S14.jpg', 'Call event bubble in thread + calls API'],
  ['S16', '1в1', 'CRM-S16-mute-menu.png', 'S16.jpg', 'Mute control in profile more'],
  ['S18', '1в1', 'CRM-S18-shared-media-grid.png', 'S18.jpg', 'Shared media grid 3-col + tabs'],
  ['S19', '1в1', 'CRM-S19-profile-more.png', 'S19.jpg', 'Profile more menu'],
  ['S20', '1в1', 'CRM-S20-shared-files.png', 'S20.jpg', 'Files tab'],
  ['S21', '1в1', 'CRM-S21-shared-links.png', 'S21.jpg', 'Links tab'],
  ['S22', '1в1', 'CRM-S22-shared-voice-list.png', 'S22.jpg', 'Voice tab play'],
  ['S23', '1в1', 'CRM-S23-members-glass.png', 'S23.jpg', 'Members glass list'],
  ['S24', '1в1', 'CRM-S24-header-pinned.png', 'S24.jpg', 'Pinned banner + jump'],
  ['S26', '1в1', 'CRM-S26-reply-reactions.png', 'S26.jpg', 'Reply quote + reactions'],
  ['S27', '1в1', 'CRM-S28-composer-glass.png', 'S27.jpg', 'OS_N/A KB; UI=S28'],
  ['S28', '1в1', 'CRM-S28-composer-glass.png', 'S28.jpg', 'Composer glass morph send'],
  ['S29', '1в1', 'CRM-S29-settings-profile.png', 'S29.jpg', 'Settings profile card'],
  ['S30', '1в1', 'CRM-S30-album.png', 'S30.jpg', 'Album/image in thread; geo OUT'],
  ['S32', '1в1', 'CRM-S32-settings-root.png', 'S32.jpg', 'Settings root glass + FX'],
  ['S33', '1в1', 'CRM-S33-settings-menu.png', 'S33.jpg', 'Settings menu family'],
  ['S34', '1в1', 'CRM-S34-settings-compact.png', 'S34.jpg', 'Settings compact'],
  ['S35', '1в1', 'CRM-S35-stories-header.png', 'S35.jpg', 'Stories rail on list'],
  ['S36', '1в1', 'CRM-S36-glass-tabbar-fab.png', 'S36.jpg', 'Glass tabbar + FAB island'],
  ['S37', '1в1', 'CRM-S37-stories-liquid.png', 'S37.jpg', 'Stories liquid/rail'],
  ['A01', '1в1', 'CRM-A01-new-style-sheet.png', 'S28.jpg', 'New style sheet in AI editor'],
  ['A02', '1в1', 'CRM-A02-ai-style-generate.png', 'S28.jpg', 'AI sheet generate UI'],
  ['A03', '1в1', 'CRM-A03-ai-grammar-apply.png', 'S28.jpg', 'Grammar + apply→#hgInput'],
  ['A04', '1в1', 'CRM-A04-ai-translate-apply.png', 'S28.jpg', 'Translate + apply'],
  ['A05', '1в1', 'CRM-A05-ai-style-apply.png', 'S28.jpg', 'Style + apply'],
  ['A06', '1в1', 'CRM-A06-composer-idle-no-ai.png', 'S28.jpg', 'Idle composer no AI sheet'],
  ['A07', '1в1', 'CRM-A07-ai-over-attach.png', 'S28.jpg', 'Ai button над attach']
];

for (const [shot, verdict, crm, ref, note] of PAIRS) {
  const md = [
    `# V-PAIR-${shot}`,
    '',
    `**Verdict:** ${verdict}`,
    `**Date:** 2026-10-05`,
    `**Verifier:** V-FRONT (agent self-read SBS)`,
    `**CRM:** \`VERIFY/PREDEPLOY-VISUAL/CAPTURE/${crm}\``,
    `**REF:** \`tests/reports/huginn-ui/FOR-REVIEW/TG-DESIGN-BOOK/REFS/${ref}\``,
    `**SBS:** \`VERIFY/PREDEPLOY-VISUAL/SBS/${shot}-crm-ref.png\``,
    '',
    '## Diffs',
    '',
    `- ${note}`,
    '- Brand/chrome ASGARD (titles, folders, Mimir) ≠ TG chrome — intentional, not FAIL',
    '- Content/data differs from REF screenshots (live clone DB) — structure/glass judged',
    '',
    `## GO/REWORK`,
    '',
    verdict === '1в1' ? '**GO**' : '**REWORK**',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(OUT, `V-PAIR-${shot}.md`), md, 'utf8');
  console.log(shot, verdict);
}
console.log('V-PAIR written', PAIRS.length);
