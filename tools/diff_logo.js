/**
 * Корректный замер: растр кадрируем по его bbox (91,88 → +566,+554),
 * вектор рендерим 566x554 на прозрачном фоне, затем считаем IoU и цвет.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'tests', 'reports');
const W = 566, H = 554, X0 = 91, Y0 = 88;
const VEC_PNG = path.join(OUT, '_vec.png');

function cropRaster() {
  const r = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'img', 'asgard_logo.png')));
  const out = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (r.width * (Y0 + y) + (X0 + x)) * 4;
      const di = (W * y + x) * 4;
      out.data[di] = r.data[si];
      out.data[di + 1] = r.data[si + 1];
      out.data[di + 2] = r.data[si + 2];
      out.data[di + 3] = r.data[si + 3];
    }
  }
  return out;
}

(async () => {
  const svg = fs.readFileSync(path.join(ROOT, 'public', 'mobile-app', 'src', 'assets', 'asgard-logo.svg'), 'utf8');
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:transparent}
 .v{width:${W}px;height:${H}px;line-height:0}
 .v svg{width:${W}px;height:${H}px;display:block}</style></head><body>
<div class="v">${svg}</div></body></html>`;
  const f = path.join(OUT, '_diff2.html');
  fs.writeFileSync(f, html);

  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 700, height: 700 }, deviceScaleFactor: 1 });
  await p.goto('file:///' + f.replace(/\\/g, '/'));
  await p.waitForTimeout(600);
  await (await p.$('.v')).screenshot({ path: VEC_PNG, omitBackground: true });
  await br.close();

  const vec = PNG.sync.read(fs.readFileSync(VEC_PNG));
  const ras = cropRaster();
  console.log('вектор', vec.width + 'x' + vec.height, '| растр-кроп', ras.width + 'x' + ras.height);

  let inter = 0, uni = 0, colN = 0, colSum = 0, big = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (W * y + x) * 4;
      const va = vec.data[i + 3] > 110;
      const ra = ras.data[i + 3] > 110;
      if (va && ra) {
        inter++;
        const d = (Math.abs(vec.data[i] - ras.data[i]) + Math.abs(vec.data[i + 1] - ras.data[i + 1]) + Math.abs(vec.data[i + 2] - ras.data[i + 2])) / 3;
        colSum += d; colN++;
        if (d > 60) big++;
      }
      if (va || ra) uni++;
    }
  }
  console.log('IoU силуэта          : %.1f%%' % (100 * inter / uni));
  console.log('средняя разница цвета : %.1f/255 (%.1f%%)' % (colSum / colN, 100 * (colSum / colN) / 255));
  console.log('пикселей с большой разницей (>60): %.1f%%' % (100 * big / colN));
  console.log('площадь вектора %d / растра %d (%.1f%%)', vec.data.filter((_, i) => i % 4 === 3 && vec.data[i] > 110).length, uni, 100 * inter / uni);
})();
