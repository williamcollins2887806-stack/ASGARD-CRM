#!/usr/bin/env node
'use strict';
/**
 * mimir-gallery.js — собирает галерею скриншотов этапов.
 *
 * Зачем: «покажи на клоне» должно быть проверяемым артефактом, а не словами.
 * Галерея открывается локально и содержит все кадры с подписями «этап → что видно».
 *
 * Запуск: node tools/mimir-gallery.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'tests/reports/mimir-stages/screens');
const OUT = path.join(ROOT, 'tests/reports/mimir-stages/index.html');

const STAGE_CAPTIONS = {
  '01-intake': ['C1 Приём', 'Документы тендера, поле описания работ, кнопка «Запустить анализ». Панель «Ход работы» справа.'],
  '03-clarify': ['C3 Пауза: не хватает данных', 'Карточки пробелов: обязательные и необязательные, ответ текстом, «Позже», «Продолжить без этого».'],
  '04-dv': ['C4 ДВ — ведомость объёмов', 'Позиции как строки сметы: объём, ед., метод, отложения, технология, источник, статус.'],
  '05-tech': ['C5 Технология и оснастка', 'Чем работаем по позиции: оснастка РП/Мимира и карточка нормы с trace.'],
  '06-decision': ['C6 Решение', '«Подаём / Не подаём», сводка объёмов, чек-лист анализа внутри модалки.'],
  '07-calc-plan': ['C7 План просчёта', 'Люди, сутки, смены, оборудование, источник каждой цифры; итог — максимум по параллельной группе.'],
  '08-calc-smeta': ['C8 Смета и калибровка', 'Предварительная смета и список норм, которые изменятся после сохранения.'],
  '09-nogo': ['C9 «Не подаём»', 'Терминальный экран: причина, автор; в архив переводит ТО, не Мимир.'],
  '10-width-360': ['Адаптив 360 px', 'Панель хода свёрнута, главное действие на всю ширину и в пределах экрана.'],
  '10-width-768': ['Адаптив 768 px', 'Панель под контентом, рельс заменён на «Этап N из 9».'],
  '10-width-1440': ['Десктоп 1440 px', 'Полный каркас: рельс этапов, контент и панель «Ход работы» в колонку.'],
  '11-light': ['Светлая тема', 'Те же токены темы, без потери контраста и обрезки.'],
  'diag': ['Диагностика', 'Служебный кадр проверки монтирования.']
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

if (!fs.existsSync(SHOTS)) {
  console.error('нет каталога со скриншотами:', SHOTS);
  process.exit(1);
}

const files = fs.readdirSync(SHOTS).filter((f) => f.endsWith('.png')).sort();
const cards = files.map((f) => {
  const key = f.replace(/\.png$/, '');
  const [title, desc] = STAGE_CAPTIONS[key] || [key, ''];
  return `<figure class="card">
    <figcaption><b>${esc(title)}</b>${desc ? `<span>${esc(desc)}</span>` : ''}</figcaption>
    <a href="screens/${encodeURIComponent(f)}" target="_blank" rel="noopener">
      <img src="screens/${encodeURIComponent(f)}" alt="${esc(title)}" loading="lazy">
    </a>
  </figure>`;
}).join('\n');

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Мимир · этапы анализа и просчёта — галерея</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:24px; background:#0D1117; color:#e6edf3;
         font:14px/1.5 Inter, system-ui, -apple-system, Segoe UI, sans-serif; }
  h1 { font-family: Cinzel, Georgia, serif; font-size:20px; margin:0 0 4px; color:#D4A843; }
  .lead { margin:0 0 20px; color:rgba(255,255,255,.65); font-size:13px; }
  .grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fill, minmax(420px, 1fr)); }
  .card { margin:0; background:#151922; border:1px solid rgba(255,255,255,.08); border-radius:12px; overflow:hidden; }
  figcaption { padding:10px 13px; border-bottom:1px solid rgba(255,255,255,.07); font-size:12px; }
  figcaption b { display:block; font-size:12.5px; color:#D4A843; margin-bottom:2px; }
  figcaption span { color:rgba(255,255,255,.6); }
  img { display:block; width:100%; height:auto; background:#0D1117; }
  .meta { margin-top:20px; font-size:11.5px; color:rgba(255,255,255,.4); }
</style>
</head>
<body>
  <h1>Мимир · этапы анализа и просчёта</h1>
  <p class="lead">Скриншоты сняты на клоне <code>asgard_crm_test</code> (:3100) в chromium.
     Всего кадров: ${files.length}. Каждый экран проверен тестом на заполненность и отсутствие «undefined».</p>
  <div class="grid">
${cards}
  </div>
  <p class="meta">Сгенерировано ${new Date().toLocaleString('ru-RU')} · tools/mimir-gallery.js</p>
</body>
</html>
`;

fs.writeFileSync(OUT, html);
console.log('галерея:', OUT);
console.log('кадров:', files.length);
console.log('этапов с подписями:', files.filter((f) => STAGE_CAPTIONS[f.replace(/\.png$/, '')]).length);
