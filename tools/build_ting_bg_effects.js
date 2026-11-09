/**
 * Собирает автономный ESM-бандл эффектов фона для Тинга.
 *
 * Проблема: public/assets/vendor/livekit-track-processors.esm.js содержит
 *   import ... from 'livekit-client'
 *   import ... from '@mediapipe/tasks-vision'
 * В браузере таких модулей нет — import падал, а ошибка проглатывалась
 * в loadTrackProcessors() → «Эффекты фона недоступны в этом браузере».
 *
 * Решение: собираем один файл, где livekit-client и mediapipe внутри,
 * а внешние ассеты медиапайпа (wasm/модель) указывают на локальные пути.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'assets', 'vendor', 'ting-bg-effects.esm.js');
const TMP = path.join(ROOT, '.deploy', '_bg_entry.mjs');

const entry = `
export { BackgroundBlur, VirtualBackground, supportsBackgroundProcessors } from '@livekit/track-processors';
`;

fs.writeFileSync(TMP, entry, 'utf8');

const args = [
  TMP,
  '--bundle',
  '--format=esm',
  '--outfile=' + OUT,
  '--platform=browser',
  '--target=es2020',
  '--legal-comments=none',
];

console.log('[bg-bundle] esbuild ...');
try {
  /* Windows: npx.cmd через execFileSync даёт EINVAL — вызываем через shell. */
  execFileSync('npx',
    ['--yes', 'esbuild', ...args],
    { cwd: ROOT, stdio: 'inherit', shell: true });
} catch (e) {
  console.error('[bg-bundle] esbuild failed:', e.message);
  process.exit(1);
}

const size = fs.statSync(OUT).size;
const src = fs.readFileSync(OUT, 'utf8');
console.log('[bg-bundle] written', OUT, size, 'bytes');
console.log('[bg-bundle] has BackgroundBlur:', src.includes('BackgroundBlur'));
console.log('[bg-bundle] has VirtualBackground:', src.includes('VirtualBackground'));
console.log('[bg-bundle] remaining bare imports:',
  (src.match(/from\s*["'](?!\.|\/)[^"']+["']/g) || []).slice(0, 5));

try { fs.unlinkSync(TMP); } catch (_) {}
