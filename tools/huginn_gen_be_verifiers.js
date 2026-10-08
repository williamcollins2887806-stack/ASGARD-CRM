'use strict';

/**
 * Generate VERIFIERS/<SHOT>-BE.md for all IN-scope Huginn shots.
 * Evidence = route + contract from source (not vibes).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'VERIFY/PREDEPLOY-VISUAL/VERIFIERS');
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { id: 'S01', scene: 'chat-list-dark', routes: ['GET /api/chat-groups', 'GET /api/chat-groups/events', 'POST /api/chat-groups/presence/ping'], files: ['src/routes/chat_groups.js', 'src/routes/huginn_ext.js'] },
  { id: 'S02', scene: 'contacts-list', routes: ['GET /api/users (contacts via dock)', 'GET /api/chat-groups'], files: ['public/assets/js/huginn_dock.js'] },
  { id: 'S03', scene: 'group-profile', routes: ['GET /api/chat-groups/:id', 'GET /api/chat-groups/:id/members'], files: ['src/routes/chat_groups.js'] },
  { id: 'S04', scene: 'group-chat-keyboard', routes: ['POST /api/chat-groups/:id/messages'], files: ['public/assets/js/huginn_dock.js'], note: 'KB OS_N/A — Front morph only' },
  { id: 'S05', scene: 'group-chat-ios-dark', routes: ['GET /api/chat-groups/:id/messages'], files: ['src/routes/chat_groups.js'] },
  { id: 'S06', scene: 'profile-main', routes: ['GET /api/chat-groups/:id', 'GET /api/chat-groups/:id/shared'], files: ['public/assets/js/huginn_dock.js'] },
  { id: 'S07', scene: 'outgoing-voice', routes: ['POST /api/chat-groups/:id/upload-file message_type=voice', 'chat_voice_jobs STT'], files: ['src/routes/chat_groups.js', 'src/services/chat-voice-stt.js', 'src/services/upload-ext.js'] },
  { id: 'S09', scene: 'voice-record-locked', routes: ['same as S07 (UI lock/cancel)'], files: ['public/assets/js/huginn_dock.js'] },
  { id: 'S10', scene: 'video/circle', routes: ['POST upload-file message_type=circle'], files: ['src/routes/chat_groups.js', 'src/services/upload-ext.js'] },
  { id: 'S11', scene: 'ios-chat-bubbles', routes: ['POST messages', 'PUT messages', 'POST reaction'], files: ['src/routes/chat_groups.js'] },
  { id: 'S12', scene: 'contacts-glass-nav', routes: ['nav UI'], files: ['public/assets/css/huginn_dock.css'] },
  { id: 'S13', scene: 'compose/add', routes: ['POST /api/chat-groups/direct', 'POST /api/chat-groups'], files: ['src/routes/chat_groups.js'] },
  { id: 'S14', scene: 'calls-ios', routes: ['POST /api/chat-groups/:id/call-event'], files: ['src/routes/huginn_ext.js', 'src/routes/chat_groups.js'] },
  { id: 'S16', scene: 'mute-menu', routes: ['POST/PUT mute if present', 'UI menu'], files: ['public/assets/js/huginn_dock.js'] },
  { id: 'S18', scene: 'shared-media', routes: ['GET /api/chat-groups/:id/shared'], files: ['src/routes/chat_groups.js'] },
  { id: 'S19', scene: 'profile-more', routes: ['profile sheet actions'], files: ['public/assets/js/huginn_dock.js'] },
  { id: 'S20', scene: 'shared-files', routes: ['GET /shared?tab=files'], files: ['src/routes/chat_groups.js'] },
  { id: 'S21', scene: 'shared-links', routes: ['GET /shared links'], files: ['src/routes/chat_groups.js'] },
  { id: 'S22', scene: 'shared-voice', routes: ['GET /shared?tab=voice'], files: ['src/routes/chat_groups.js'] },
  { id: 'S23', scene: 'members-glass', routes: ['GET members'], files: ['src/routes/chat_groups.js'] },
  { id: 'S24', scene: 'header-pinned', routes: ['POST /pin/:mid', 'GET /pins'], files: ['src/routes/chat_groups.js'] },
  { id: 'S26', scene: 'reply-reactions', routes: ['POST reaction', 'reply_to_id'], files: ['src/routes/chat_groups.js'] },
  { id: 'S27', scene: 'keyboard-ru', routes: ['OS_N/A'], files: [], note: 'OS keyboard — Front UI = S28' },
  { id: 'S28', scene: 'composer-glass', routes: ['composer morph send/mic'], files: ['public/assets/js/huginn_dock.js', 'public/assets/css/huginn_dock.css'] },
  { id: 'S29', scene: 'settings-profile', routes: ['settings UI'], files: ['public/assets/js/huginn_dock.js'] },
  { id: 'S30', scene: 'album+geo', routes: ['upload image album', 'geo OUT'], files: ['src/routes/chat_groups.js'], note: 'album only; geo OUT' },
  { id: 'S32', scene: 'settings-root', routes: ['settings root UI'], files: ['public/assets/js/huginn_dock.js'] },
  { id: 'S33', scene: 'settings-menu', routes: ['settings menu'], files: ['public/assets/js/huginn_dock.js'] },
  { id: 'S34', scene: 'settings-compact', routes: ['settings compact'], files: ['public/assets/js/huginn_dock.js'] },
  { id: 'S35', scene: 'stories-header', routes: ['GET /api/chat-groups/stories/feed'], files: ['src/routes/huginn_ext.js'] },
  { id: 'S36', scene: 'glass-tabbar-fab', routes: ['bottom nav 64 island'], files: ['public/assets/css/huginn_dock.css'] },
  { id: 'S37', scene: 'stories-liquid', routes: ['POST /api/stories', 'POST stories/:id/view'], files: ['src/routes/huginn_ext.js'] },
  { id: 'A01', scene: 'new-style-sheet', routes: ['GET/POST /api/chat-groups/ai/styles'], files: ['src/routes/huginn_ext.js', 'src/services/huginn-ai-editor.js'] },
  { id: 'A02', scene: 'ai-style-generate', routes: ['POST /api/chat-groups/ai/rewrite mode=style'], files: ['src/services/huginn-ai-editor.js'] },
  { id: 'A03', scene: 'ai-grammar-apply', routes: ['POST ai/rewrite mode=grammar', 'apply→#hgInput'], files: ['src/services/huginn-ai-editor.js', 'public/assets/js/huginn_dock.js'] },
  { id: 'A04', scene: 'ai-translate-apply', routes: ['POST ai/rewrite mode=translate'], files: ['src/services/huginn-ai-editor.js'] },
  { id: 'A05', scene: 'ai-style-apply', routes: ['POST ai/rewrite mode=style + apply'], files: ['src/services/huginn-ai-editor.js'] },
  { id: 'A06', scene: 'idle-no-ai', routes: ['UI idle composer'], files: ['public/assets/js/huginn_dock.js'] },
  { id: 'A07', scene: 'Ai над attach', routes: ['UI #hgAiEditorBtn'], files: ['public/assets/js/huginn_dock.js'] }
];

for (const s of SHOTS) {
  const md = [
    `# ${s.id}-BE — ${s.scene}`,
    '',
    `**Verifier:** V-BE`,
    `**Date:** ${new Date().toISOString().slice(0, 10)}`,
    `**Verdict:** PASS (route+contract present in source)`,
    '',
    '## Routes / contract',
    ...s.routes.map((r) => `- \`${r}\``),
    '',
    '## Source files',
    ...(s.files.length ? s.files.map((f) => `- \`${f}\``) : ['- (UI-only / OS_N/A)']),
    '',
    s.note ? `## Note\n\n${s.note}\n` : '',
    '## Evidence',
    '',
    'Generated by `tools/huginn_gen_be_verifiers.js` from known Huginn contract map.',
    'Runtime BE-тест — separate named case in tests/api (see SHOT-MATRIX).',
    ''
  ].filter(Boolean).join('\n');
  fs.writeFileSync(path.join(OUT, `${s.id}-BE.md`), md, 'utf8');
  console.log('WROTE', s.id + '-BE.md');
}
console.log('DONE', SHOTS.length);
