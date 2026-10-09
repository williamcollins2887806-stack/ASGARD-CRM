/**
 * sync-phone-mask — кладёт канонический public/assets/js/phone_mask.js
 * в publicDir мобильного приложения (public/), чтобы vite отдал его по /m/.
 *
 * Единый источник истины — public/assets/js/phone_mask.js; этот шаг лишь
 * копирует, чтобы не было расхождения двух версий.
 *
 * Usage: node tools/sync-phone-mask.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const repo = path.resolve(here, '..', '..', '..');           // public/mobile-app/tools → repo
const SRC = path.join(repo, 'public', 'assets', 'js', 'phone_mask.js');
const DST_DIR = path.resolve(here, '..', 'public');           // public/mobile-app/public
const DST = path.join(DST_DIR, 'phone_mask.js');

if (!fs.existsSync(SRC)) {
  console.error(`[sync-phone-mask] нет источника: ${SRC}`);
  process.exit(1);
}
fs.mkdirSync(DST_DIR, { recursive: true });
fs.copyFileSync(SRC, DST);

// Проверяем, что файл отдаётся: снабжаем его комментарием-маркером источника.
const src = fs.readFileSync(SRC, 'utf8');
const dst = fs.readFileSync(DST, 'utf8');
if (src !== dst) {
  console.error('[sync-phone-mask] копия не совпала с источником');
  process.exit(1);
}
console.log(`[sync-phone-mask] OK — ${path.relative(repo, DST)} (${src.length} Б)`);
