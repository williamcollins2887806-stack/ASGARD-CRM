'use strict';

/**
 * Honest rematrix V-PAIR writer (2026-10-06).
 * Verdicts from per-shot SBS Read — NOT batch 1в1.
 * Front [x] only if verdict === '1в1'.
 */
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '../VERIFY/PREDEPLOY-VISUAL');

// [shot, verdict, crm, ref, diffs[], goRework]
const PAIRS = [
  ['S01', 'не 1в1', 'CRM-S01-chat-list-dark.png', 'S01.jpg', [
    'Структура list близка (Изм.|Чаты, folders, birthday, stories, tabbar), но glass tabbar/FAB слабее REF',
    'Нет pinned-секции как в REF; unread badge стиль другой (синий vs серый muted)',
    'Stories rail = одинаковые AC-аватары (seed), не живые фото REF'
  ], 'REWORK'],
  ['S02', 'не 1в1', 'CRM-S02-contacts-list.png', 'S02.jpg', [
    'A–Я список + search есть; alpha index / density / avatar photos ≠ REF',
    'Glass nav присутствует, но не дотягивает до REF translucency'
  ], 'REWORK'],
  ['S03', 'не 1в1', 'CRM-S03-group-profile.png', 'S03.jpg', [
    'Profile head+tabs есть; media grid placeholders (green/red blocks) ≠ реальные фото REF',
    'Capture profile ранее был битый (56KB) — переснят, всё ещё не 1в1 по контенту'
  ], 'REWORK'],
  ['S04', 'не 1в1', 'CRM-S05-group-chat-ios-dark.png', 'S04.jpg', [
    'ACK: CRM reuse S05 — клавиатура OS_N/A, это не shot клавиатуры',
    'Нельзя закрывать Front 1в1 на reuse без dedicated KB capture'
  ], 'REWORK'],
  ['S05', 'не 1в1', 'CRM-S05-group-chat-ios-dark.png', 'S05.jpg', [
    'Thread chrome/composer есть; пузыри — тестовые stubs (checkmark/circle/«Сообщение»)',
    '«Расшифровка...» pending STT; фон/типографика не дотягивают до REF office chat'
  ], 'REWORK'],
  ['S06', 'не 1в1', 'CRM-S06-profile-main.png', 'S06.jpg', [
    'Profile sheet открывается (не stub→settings); tabs+actions есть',
    'Медиа-сетка placeholders; header denser/тоньше чем REF'
  ], 'REWORK'],
  ['S07', 'не 1в1', 'CRM-S07-outgoing-voice.png', 'S07.jpg', [
    'Voice bubble+waveform есть; transcript = pending/DEFER, не готовая расшифровка REF',
    'Duration 0:00 / stub visuals на части сообщений'
  ], 'REWORK'],
  ['S09', 'не 1в1', 'CRM-S09-voice-record-locked.png', 'S09.jpg', [
    'Есть hg-rec-bar «Запись голоса…»+Стоп (после fake-media recapture)',
    'REF = lock+timer+Отмена+send-up — другой chrome; lock UI не 1в1'
  ], 'REWORK'],
  ['S10', 'не 1в1', 'CRM-S10-circle-record.png', 'S10.jpg', [
    'Есть overlay «Запись кружка…» (не только пункт меню) — прогресс vs прошлой подкрутки',
    'REF = fullscreen camera circle UI; CRM = thread+rec-bar — сцена не та → не 1в1'
  ], 'REWORK'],
  ['S11', 'не 1в1', 'CRM-S11-ios-chat-bubbles.png', 'S11.jpg', [
    'Bubbles/reply/react в коде; capture = тот же thread stub что S05 (dupe size)',
    'Не dedicated bubble density vs REF'
  ], 'REWORK'],
  ['S12', 'не 1в1', 'CRM-S12-contacts-glass-nav.png', 'S12.jpg', [
    'Dedicated capture contacts+glass nav (больше не reuse S02 без файла)',
    'Glass translucency / active glow ≠ REF density'
  ], 'REWORK'],
  ['S13', 'не 1в1', 'CRM-S13-compose-create.png', 'S13.jpg', [
    'Sheet «Добавить»+search+A–Я есть и opaque',
    'Нет X/✓ header как REF; tabbar+FAB просвечивают снизу; нет alpha scroller'
  ], 'REWORK'],
  ['S14', 'не 1в1', 'CRM-S14-calls-ios.png', 'S14.jpg', [
    'Call event bubble в thread есть; calls list scene vs REF calls tab — слабо'
  ], 'REWORK'],
  ['S16', 'не 1в1', 'CRM-S16-mute-menu.png', 'S16.jpg', [
    'Mute control в profile more есть; menu chrome ≠ REF density'
  ], 'REWORK'],
  ['S18', 'не 1в1', 'CRM-S18-shared-media-grid.png', 'S18.jpg', [
    '3-col grid + tabs Медиа/Файлы/… есть',
    'Ячейки = synthetic green/red placeholders ≠ реальные фото REF'
  ], 'REWORK'],
  ['S19', 'не 1в1', 'CRM-S19-profile-more.png', 'S19.jpg', [
    'Profile more/mute UI есть (Playwright PASS); visual density ≠ REF'
  ], 'REWORK'],
  ['S20', 'не 1в1', 'CRM-S20-shared-files.png', 'S20.jpg', [
    'Files tab рендерится; список/иконки не 1в1 к REF'
  ], 'REWORK'],
  ['S21', 'не 1в1', 'CRM-S21-shared-links.png', 'S21.jpg', [
    'Links tab есть; empty/sparse vs REF'
  ], 'REWORK'],
  ['S22', 'не 1в1', 'CRM-S22-shared-voice-list.png', 'S22.jpg', [
    'Voice tab есть; play chrome не 1в1'
  ], 'REWORK'],
  ['S23', 'не 1в1', 'CRM-S23-members-glass.png', 'S23.jpg', [
    'Members list есть; glass/rows ≠ REF'
  ], 'REWORK'],
  ['S24', 'не 1в1', 'CRM-S24-header-pinned.png', 'S24.jpg', [
    'Pinned banner «pin-me» есть; typography/jump ≠ REF'
  ], 'REWORK'],
  ['S26', 'не 1в1', 'CRM-S26-reply-reactions.png', 'S26.jpg', [
    'Reply/reactions в коде; capture overlapped with stub thread — не 1в1'
  ], 'REWORK'],
  ['S27', 'не 1в1', 'CRM-S28-composer-glass.png', 'S27.jpg', [
    'ACK reuse S28: OS keyboard N/A — Front не закрываем как 1в1'
  ], 'REWORK'],
  ['S28', 'не 1в1', 'CRM-S28-composer-glass.png', 'S28.jpg', [
    'Composer+attach+mic есть; morph/glass vs REF composer не полный 1в1',
    'Capture overlapped thread stubs'
  ], 'REWORK'],
  ['S29', 'не 1в1', 'CRM-S29-settings-profile.png', 'S29.jpg', [
    'Settings profile card есть; почти дубль S32/S33/S34 — не dedicated scenes'
  ], 'REWORK'],
  ['S30', 'не 1в1', 'CRM-S30-album.png', 'S30.jpg', [
    'Album/image path; geo OUT; visual ≠ REF album'
  ], 'REWORK'],
  ['S32', 'не 1в1', 'CRM-S32-settings-root.png', 'S32.jpg', [
    'CRM = profile+FX+logout; REF = TG settings list (уведомления/данные/язык…)',
    'Сцена не та → жёсткий REWORK'
  ], 'REWORK'],
  ['S33', 'не 1в1', 'CRM-S33-settings-menu.png', 'S33.jpg', [
    'Capture ≈ S32; нет отдельного settings-menu chrome vs REF'
  ], 'REWORK'],
  ['S34', 'не 1в1', 'CRM-S34-settings-compact.png', 'S34.jpg', [
    'FX compact toggle есть; не отдельная compact scene 1в1'
  ], 'REWORK'],
  ['S35', 'не 1в1', 'CRM-S35-stories-header.png', 'S35.jpg', [
    'Stories rail на list есть; аватары seed AC ≠ REF stories'
  ], 'REWORK'],
  ['S36', 'не 1в1', 'CRM-S36-glass-tabbar-fab.png', 'S36.jpg', [
    'Tabbar 64 + FAB есть (scene-gate PASS); glass translucency слабее REF',
    'Capture size == S01 (тот же list frame) — island не изолирован'
  ], 'REWORK'],
  ['S37', 'не 1в1', 'CRM-S37-stories-liquid.png', 'S37.jpg', [
    'Dupe S35 capture size; liquid stories не доказаны отдельно'
  ], 'REWORK'],
  ['A01', 'не 1в1', 'CRM-A01-new-style-sheet.png', 'S28.jpg', [
    'Sheet «Новый стиль» реальный UI; REF path = S28.jpg (blur/wrong) — невалидное сравнение',
    'Нужен dedicated AI REF или ACK wrong-REF'
  ], 'REWORK'],
  ['A02', 'не 1в1', 'CRM-A02-ai-style-generate.png', 'S28.jpg', [
    'AI sheet UI есть; rewrite real-200 DEFER (anti-stub 502); wrong REF S28'
  ], 'REWORK'],
  ['A03', 'не 1в1', 'CRM-A03-ai-grammar-apply.png', 'S28.jpg', [
    'Apply UI path; grammar rewrite без stub = 502 DEFER; wrong REF'
  ], 'REWORK'],
  ['A04', 'не 1в1', 'CRM-A04-ai-translate-apply.png', 'S28.jpg', [
    'Translate UI; real rewrite DEFER; wrong REF S28'
  ], 'REWORK'],
  ['A05', 'не 1в1', 'CRM-A05-ai-style-apply.png', 'S28.jpg', [
    'Style apply UI; real rewrite DEFER; wrong REF S28'
  ], 'REWORK'],
  ['A06', 'не 1в1', 'CRM-A06-composer-idle-no-ai.png', 'S28.jpg', [
    'Idle no AI sheet — Playwright PASS; visual vs REF S28 не 1в1 (wrong REF)'
  ], 'REWORK'],
  ['A07', 'не 1в1', 'CRM-A07-ai-over-attach.png', 'S28.jpg', [
    'hgAiEditorBtn над attach — Playwright PASS; wrong REF S28 → не 1в1'
  ], 'REWORK']
];

for (const [shot, verdict, crm, ref, diffs, go] of PAIRS) {
  const md = [
    `# V-PAIR-${shot}`,
    '',
    `**Verdict:** ${verdict}`,
    `**Date:** 2026-10-06`,
    `**Verifier:** V-FRONT honest rematrix (per-shot SBS Read)`,
    `**CRM:** \`VERIFY/PREDEPLOY-VISUAL/CAPTURE/${crm}\``,
    `**REF:** \`tests/reports/huginn-ui/FOR-REVIEW/TG-DESIGN-BOOK/REFS/${ref}\``,
    `**SBS:** \`VERIFY/PREDEPLOY-VISUAL/SBS/${shot}-crm-ref.png\``,
    '',
    '## Diffs',
    '',
    ...diffs.map((d) => `- ${d}`),
    '- Brand/chrome ASGARD ≠ TG chrome — intentional, not sole FAIL reason',
    '',
    '## GO/REWORK',
    '',
    `**${go}**`,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(OUT, `V-PAIR-${shot}.md`), md, 'utf8');
  console.log(shot, verdict, go);
}
console.log('HONEST_VPAIR_WRITTEN', PAIRS.length);
const ones = PAIRS.filter((p) => p[1] === '1в1').length;
if (ones !== 0) {
  console.error('unexpected 1в1 count', ones);
  process.exit(1);
}
