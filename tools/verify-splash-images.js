/**
 * ЗАМЕР: цвет нижнего края apple-touch-startup-image против фона html.
 *
 * Гипотеза из подсказки другого разработчика (24.10.2026): кремовый фон со
 * скриншота — это НЕ CSS-сплэш, а `apple-touch-startup-image` (PNG). iOS
 * показывает эту картинку при запуске PWA, и если её нижний пиксель отличается
 * от фона `html`, внизу видна полоса ровно этого расхождения.
 *
 * Проверяем ФАКТ: читаем нижнюю строку пикселей каждой картинки и сравниваем
 * с --bg-primary (тёмная #0a0a0c / светлая #F2F2F7).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIR = 'public/assets/img/splash';
const DARK_BG = '#0a0a0c';
const LIGHT_BG = '#F2F2F7';

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const dist = (a, b) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return Math.max(...x.map((v, i) => Math.abs(v - y[i])));
};

(async () => {
  if (!fs.existsSync(DIR)) { console.log('нет каталога ' + DIR); process.exit(1); }
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.png')).sort();
  console.log('картинок сплэша:', files.length);
  console.log('фон html: тёмная', DARK_BG, '| светлая', LIGHT_BG, '\n');

  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent('<canvas id="c"></canvas>');

  let problems = 0;
  for (const f of files) {
    const b64 = fs.readFileSync(path.join(DIR, f)).toString('base64');
    const r = await p.evaluate(async (data) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + data;
      await img.decode();
      const c = document.getElementById('c');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      // Нижняя строка и предпоследняя (край и чуть выше — на градиент).
      const bottom = g.getImageData(0, img.height - 1, img.width, 1).data;
      const above = g.getImageData(0, img.height - 12, img.width, 1).data;
      const mid = g.getImageData(Math.floor(img.width / 2), img.height - 1, 1, 1).data;
      // Средний цвет по нижней строке: у градиентов край может гулять.
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let i = 0; i < bottom.length; i += 4) { sr += bottom[i]; sg += bottom[i + 1]; sb += bottom[i + 2]; n++; }
      return {
        w: img.width, h: img.height,
        edge: [bottom[0], bottom[1], bottom[2]],
        edgeAvg: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)],
        center: [mid[0], mid[1], mid[2]],
        above: [above[0], above[1], above[2]],
      };
    }, b64);

    const edgeHex = hex(...r.edge);
    const avgHex = hex(...r.edgeAvg);
    const dDark = dist(edgeHex, DARK_BG);
    const dLight = dist(edgeHex, LIGHT_BG);
    const best = Math.min(dDark, dLight);
    const bestName = dDark <= dLight ? 'тёмной' : 'светлой';
    const ok = best <= 3;   // допуск на антиалиасинг/сжатие

    console.log(`${f}  ${r.w}×${r.h}`);
    console.log(`  нижний пиксель (центр): ${hex(...r.center)}`);
    console.log(`  нижний пиксель (левый): ${edgeHex} | средний по строке: ${avgHex}`);
    console.log(`  на 12px выше низа      : ${hex(...r.above)}`);
    console.log(`  ближе к ${bestName} теме, расхождение ${best} -> ${ok ? 'совпадает' : 'ПОЛОСА'}`);
    if (!ok) problems++;
    console.log('');
  }

  await b.close();
  console.log(problems === 0
    ? 'ИТОГ: OK — низ всех картинок совпадает с фоном html'
    : `ИТОГ: ${problems} картинок с расхождением — именно они дают полосу`);
})();
