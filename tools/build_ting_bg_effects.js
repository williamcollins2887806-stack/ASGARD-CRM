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

let src = fs.readFileSync(OUT, 'utf8');

/* VideoFrame GC: fallback path вызывал transform без await → кадр уходил в GC
   без close (livekit/track-processors#47). Патчим бандл после esbuild. */
const before = src;
const syncMarker = 'this.frameCallback = (frame) => {';
const asyncMarker = 'this.frameCallback = async (frame) => {';
if (src.includes(syncMarker)) {
  src = src.replace(syncMarker, asyncMarker);
}
const fireTransform = 'this.transformer.transform(frame, controller);';
const awaitTransform = 'await this.transformer.transform(frame, controller);';
if (src.includes(fireTransform) && !src.includes(awaitTransform)) {
  src = src.split(fireTransform).join(awaitTransform);
}
/* В catch закрываем frame безопаснее (idempotent close). */
src = src.replace(
  /this\.log\.error\("Error in transform:", e3\);\s*frame\.close\(\);/,
  'this.log.error("Error in transform:", e3);\n        try { frame.close(); } catch (_) {}'
);
src = src.replace(
  /if \(this\.frameCallback\) \{\s*this\.frameCallback\(frame\);\s*\} else \{\s*frame\.close\(\);\s*\}/,
  'if (this.frameCallback) {\n' +
  '              const _p = this.frameCallback(frame);\n' +
  '              if (_p && typeof _p.then === "function") {\n' +
  '                _p.catch((e3) => {\n' +
  '                  this.log.error("Error in frameCallback:", e3);\n' +
  '                  try { frame.close(); } catch (_) {}\n' +
  '                });\n' +
  '              }\n' +
  '            } else {\n' +
  '              frame.close();\n' +
  '            }'
);
const ok =
  src.includes(asyncMarker) &&
  src.includes(awaitTransform) &&
  src.includes('const _p = this.frameCallback(frame)');
if (!ok) {
  console.warn('[bg-bundle] WARN: VideoFrame await-patch incomplete — check upstream');
} else if (src === before) {
  console.log('[bg-bundle] VideoFrame await-patch already present');
} else {
  console.log('[bg-bundle] VideoFrame await-patch applied');
}
fs.writeFileSync(OUT, src, 'utf8');
const size = fs.statSync(OUT).size;
console.log('[bg-bundle] written', OUT, size, 'bytes');
console.log('[bg-bundle] has BackgroundBlur:', src.includes('BackgroundBlur'));
console.log('[bg-bundle] has VirtualBackground:', src.includes('VirtualBackground'));
console.log('[bg-bundle] remaining bare imports:',
  (src.match(/from\s*["'](?!\.|\/)[^"']+["']/g) || []).slice(0, 5));

try { fs.unlinkSync(TMP); } catch (_) {}
