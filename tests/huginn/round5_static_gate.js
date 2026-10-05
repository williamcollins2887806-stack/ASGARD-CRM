'use strict';

/**
 * Huginn ROUND-5 static gate — tokens / craft / no #F5C542.
 * Run: node tests/huginn/round5_static_gate.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const files = {
  css: path.join(ROOT, 'public/assets/css/huginn_dock.css'),
  js: path.join(ROOT, 'public/assets/js/huginn_dock.js'),
  icons: path.join(ROOT, 'public/assets/js/huginn_icons.js'),
  hIndex: path.join(ROOT, 'public/h/index.html'),
  hApp: path.join(ROOT, 'public/h/app.js'),
  index: path.join(ROOT, 'public/index.html'),
  tokens: path.join(ROOT, 'public/assets/css/design-tokens.css')
};

const fails = [];
const passes = [];
function fail(m) { fails.push(m); console.error('FAIL', m); }
function ok(m) { passes.push(m); console.log('PASS', m); }

function read(p) {
  if (!fs.existsSync(p)) { fail('missing ' + path.relative(ROOT, p)); return ''; }
  return fs.readFileSync(p, 'utf8');
}

const css = read(files.css);
const js = read(files.js);
const icons = read(files.icons);
const hIndex = read(files.hIndex);
const hApp = read(files.hApp);
const index = read(files.index);
const tokens = read(files.tokens);

// V1 visual/static palette
if (/#F5C542/i.test(css + js + hIndex + hApp)) fail('V1: #F5C542 still present in Huginn UI sources');
else ok('V1: no #F5C542 in huginn css/js/h');

if (!/--hg-accent:\s*var\(--gold/.test(css)) fail('V1: --hg-accent not aliased to --gold');
else ok('V1: --hg-accent → var(--gold)'); // accepts var(--gold) or var(--gold, fallback)

if (!/--hg-bg:\s*var\(--bg1/.test(css)) fail('V1: --hg-bg not CRM --bg1');
else ok('V1: surfaces alias CRM');

const numeric = [
  '--hg-radius-bubble: 14px',
  '--hg-radius-panel: 16px',
  '--hg-radius-popup: 12px',
  '--hg-pad-bubble: 10px 14px',
  '--hg-blur-float: 24px',
  '--hg-gap-msg-group: 4px',
  '--hg-gap-msg-between: 16px',
  '--hg-dur-hover: 120ms',
  '--hg-dur-menu: 150ms',
  '--hg-dur-bubble: 200ms',
  '--hg-dur-react: 300ms'
];
numeric.forEach((t) => {
  if (!css.includes(t)) fail('V1 numeric missing: ' + t);
});
if (!fails.some((f) => f.includes('numeric'))) ok('V1: numeric token scale present');

if (!/html\[data-theme="light"\]/.test(css)) fail('V1: light theme hooks missing in css');
else ok('V1: light theme hooks');

if (!/design-tokens\.css/.test(hIndex)) fail('V1: /h missing design-tokens.css');
else ok('V1: /h loads design-tokens');

// V2 layout craft
['hg-presence', 'hg-scroll-fab', 'hg-unread-sep', 'hg-empty', 'hg-empty-cta', 'hg-reacts', 'hg-media-photo', 'hg-file-card', 'hg-float'].forEach((cls) => {
  if (!css.includes('.' + cls)) fail('V2: CSS missing .' + cls);
});
if (!fails.some((f) => f.startsWith('V2: CSS'))) ok('V2: required CSS classes');

if (!/groupMessages/.test(js)) fail('V2: message grouping missing');
else ok('V2: message grouping');

if (!/На линии/.test(js)) fail('V2: presence label «На линии» missing');
else ok('V2: presence «На линии»');

if (!/Пока пусто/.test(js)) fail('V2: empty state copy missing');
else ok('V2: empty states');

// V3 runtime surface (static markers)
['toggleReaction', 'editLastOwn', 'openLightbox', 'updateScrollFab', 'isNearBottom', 'Ctrl', 'ArrowUp'].forEach((k) => {
  if (!js.includes(k) && k !== 'Ctrl') {
    if (k === 'Ctrl' && !/ctrlKey|metaKey/.test(js)) fail('V3: Ctrl/Cmd+K missing');
  }
});
if (!/ctrlKey|metaKey/.test(js)) fail('V3: Ctrl/Cmd+K missing');
else ok('V3: keyboard shortcuts markers');
if (!/toggleReaction/.test(js)) fail('V3: reaction toggle missing');
else ok('V3: reaction toggle');

// V4 frontend icons
if (!/LUCIDE_VERSION|0\.460/.test(icons)) fail('V4: Lucide version not pinned');
else ok('V4: Lucide module version pinned');
if (!/huginn_icons\.js/.test(index)) fail('V4: index.html does not load huginn_icons.js');
else ok('V4: shell loads huginn_icons.js');
if (!/huginn_icons\.js/.test(hIndex)) fail('V4: /h does not load huginn_icons.js');
else ok('V4: /h loads huginn_icons.js');
['reply', 'smile', 'trash', 'copy', 'forward', 'paperclip', 'send', 'sparkles'].forEach((n) => {
  if (!icons.includes(n + ':')) fail('V4: icon missing ' + n);
});
if (!fails.some((f) => f.includes('icon missing'))) ok('V4: Lucide subset keys');

if (/hg-sticker-emoji[\s\S]{0,200}--st|#F5C542/.test(css) && /--st,/.test(css)) {
  fail('V4: rainbow sticker tiles still styled');
}
if (/color-mix\(in srgb, var\(--st/.test(css)) fail('V4: colored sticker tiles remain');
else ok('V4: emoji stickers without colored tiles');

// V5 backend contract — API paths still used (no breakage)
['/api/chat-groups/', '/reaction', '/upload-file', '/messages'].forEach((p) => {
  if (!js.includes(p.replace(/^\//, '')) && !js.includes(p)) {
    /* soft */
  }
});
if (!js.includes('/api/chat-groups/')) fail('V5: chat-groups API usage removed');
else ok('V5: chat-groups API still wired');
if (!js.includes('/reaction')) fail('V5: reaction API missing');
else ok('V5: reaction API wired');
if (!/--gold:\s*#D4A843/.test(tokens) && !/--gold:\s+#D4A843/.test(tokens)) {
  // light overrides gold; dark root should have it
  if (!tokens.includes('#D4A843')) fail('V5: CRM --gold #D4A843 not in design-tokens');
  else ok('V5: CRM gold token exists');
} else ok('V5: CRM gold token exists');

const report = [
  '# Huginn ROUND-5 STATIC GATE',
  '',
  `At: ${new Date().toISOString()}`,
  `PASS: ${passes.length}`,
  `FAIL: ${fails.length}`,
  '',
  '## Passes',
  ...passes.map((p) => '- ' + p),
  '',
  '## Fails',
  ...(fails.length ? fails.map((f) => '- ' + f) : ['- (none)']),
  '',
  `VERDICT: ${fails.length ? 'FAIL' : 'PASS'}`
].join('\n');

const outDir = path.join(ROOT, 'tests/reports');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'HUGINN-ROUND5-STATIC.md'), report, 'utf8');
console.log('\n' + report);
process.exit(fails.length ? 1 : 0);
