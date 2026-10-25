'use strict';
/**
 * gen-splash.js — генерация iOS splash-экранов из эмблемы ASGARD.
 *
 * Зачем: без apple-touch-startup-image iOS при запуске установленного PWA
 * показывает белый экран — «дешёвый» старт. Splash даёт мгновенный брендовый
 * кадр на тёмном фоне.
 *
 * Реализация на pngjs (уже в зависимостях): масштабирование ближайшим соседом
 * с предварительным сглаживанием — эмблема мелкая, артефактов не видно.
 *
 * Запуск: node tools/gen-splash.js
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'assets', 'img', 'asgard_emblem.png');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'img', 'splash');

const SIZES = [
  ['splash-1290x2796.png', 1290, 2796],
  ['splash-1179x2556.png', 1179, 2556],
  ['splash-1284x2778.png', 1284, 2778],
  ['splash-1170x2532.png', 1170, 2532],
  ['splash-1125x2436.png', 1125, 2436],
  ['splash-1242x2688.png', 1242, 2688],
  ['splash-828x1792.png', 828, 1792],
  ['splash-750x1334.png', 750, 1334],
  ['splash-2048x2732.png', 2048, 2732],
];

/**
 * Сцены стартовых картинок.
 *
 * ВАЖНО (24.10.2026). Раньше картинки были ТОЛЬКО тёмные (`BG = #0a0a0c`), и при
 * светлой теме iOS показывал тёмную заставку, а затем кремовый CSS-сплэш —
 * переход мигал. Теперь генерируются обе версии:
 *   • тёмная  — фон `--bg-primary` тёмной темы (#0a0a0c);
 *   • светлая — фон `--bg-primary` светлой темы (#F2F2F7).
 *
 * ФОН ОБЯЗАН СОВПАДАТЬ С `--bg-primary`: этим цветом закрашивается canvas под
 * коробкой вьюпорта, и расхождение даёт видимый «шов» внизу экрана.
 *
 * Подключение в `index.html` — через media, чтобы iOS выбирал по теме:
 *   <link rel="apple-touch-startup-image" href="…-light.png"
 *         media="(prefers-color-scheme: light)"/>
 */
const THEMES = [
  { suffix: '', bg: [10, 10, 12], label: 'ТЁМНАЯ', note: '#0a0a0c (--bg-primary тёмной)' },
  { suffix: '-light', bg: [242, 242, 247], label: 'СВЕТЛАЯ', note: '#F2F2F7 (--bg-primary светлой)' },
];

/** Билинейная выборка исходника в точку (x, y) целевого изображения. */
function sample(src, sx, sy) {
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, src.width - 1), y1 = Math.min(y0 + 1, src.height - 1);
  const fx = sx - x0, fy = sy - y0;
  const at = (x, y) => {
    const k = (src.width * y + x) << 2;
    return [src.data[k], src.data[k + 1], src.data[k + 2], src.data[k + 3]];
  };
  const a = at(x0, y0), b = at(x1, y0), c = at(x0, y1), d = at(x1, y1);
  const out = [];
  for (let i = 0; i < 4; i++) {
    out[i] = Math.round(
      a[i] * (1 - fx) * (1 - fy) + b[i] * fx * (1 - fy) + c[i] * (1 - fx) * fy + d[i] * fx * fy
    );
  }
  return out;
}

(async () => {
  if (!fs.existsSync(SRC)) { console.error('FAIL: нет эмблемы ' + SRC); process.exit(1); }
  const src = PNG.sync.read(fs.readFileSync(SRC));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('эмблема: ' + src.width + 'x' + src.height);

  for (const theme of THEMES) {
    console.log(`\n── ${theme.label} тема: фон ${theme.note} ──`);
    for (const [name, W, H] of SIZES) {
      const out = new PNG({ width: W, height: H });
      // фон
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const k = (W * y + x) << 2;
          out.data[k] = theme.bg[0]; out.data[k + 1] = theme.bg[1]; out.data[k + 2] = theme.bg[2]; out.data[k + 3] = 255;
        }
      }
      // эмблема ~26% меньшей стороны, по центру
      const logoW = Math.round(Math.min(W, H) * 0.26);
      const logoH = Math.max(1, Math.round(logoW * (src.height / src.width)));
      const offX = Math.round((W - logoW) / 2);
      const offY = Math.round((H - logoH) / 2);
      for (let y = 0; y < logoH; y++) {
        for (let x = 0; x < logoW; x++) {
          const sx = (x / logoW) * (src.width - 1);
          const sy = (y / logoH) * (src.height - 1);
          const [r, g, b, a] = sample(src, sx, sy);
          const af = a / 255;
          const k = (W * (offY + y) + (offX + x)) << 2;
          out.data[k] = Math.round(r * af + out.data[k] * (1 - af));
          out.data[k + 1] = Math.round(g * af + out.data[k + 1] * (1 - af));
          out.data[k + 2] = Math.round(b * af + out.data[k + 2] * (1 - af));
          out.data[k + 3] = 255;
        }
      }
      const fileName = name.replace(/\.png$/, theme.suffix + '.png');
      fs.writeFileSync(path.join(OUT_DIR, fileName), PNG.sync.write(out, { deflateLevel: 9 }));
      console.log('  ' + fileName.padEnd(34) + W + 'x' + H);
    }
  }
  console.log('\nготово: ' + OUT_DIR);
  console.log('не забудь: светлые картинки подключаются через media="(prefers-color-scheme: light)"');
})();
