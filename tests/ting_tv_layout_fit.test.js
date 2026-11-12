'use strict';

/**
 * D-403: расчёт размера плитки обязан вписывать сетку в экран.
 *
 * Прошлая версия считала от box.height, а onLayout отдаёт размер ВМЕСТЕ с
 * padding сцены (74 сверху + 112 снизу). Плитки выходили выше доступного
 * места — сетка снова вылезала, и «вёрстка как была».
 *
 * Проверяем арифметику на реальных разрешениях ТВ и разных составах зала:
 * сумма высот рядов + padding + док не должна превышать высоту экрана.
 */
const assert = require('assert');

const INNER_PAD_TOP = 74;
const INNER_PAD_BOTTOM = 112;
const INNER_PAD_SIDE = 14;
const TILE_MARGIN = 6;
const DOCK_SPACE = 0; /* док внутри paddingBottom сцены (112 px) */

function computeTile(box, rows, cols) {
  if (!box.width || !box.height || !rows) return null;
  const maxCols = Math.max(1, ...cols);
  const innerW = box.width - INNER_PAD_SIDE * 2;
  const innerH = box.height - INNER_PAD_TOP - INNER_PAD_BOTTOM;
  if (innerW <= 0 || innerH <= 0) return null;
  const m2 = TILE_MARGIN * 2;
  const wByWidth = innerW / maxCols - m2;
  const hByHeight = innerH / rows - m2;
  if (wByWidth <= 0 || hByHeight <= 0) return null;
  const widthByHeight = hByHeight * (16 / 9);
  const width = Math.max(48, Math.min(wByWidth, widthByHeight));
  return { width, height: (width * 9) / 16 };
}

/* Сетка из gridFor в api.js: wait/spot 1, dual 2, g3 3x3, g4 4x3, g5 5x3. */
const CASES = [
  { name: '1 участник', rows: 1, cols: [1] },
  { name: '2 участника', rows: 1, cols: [2] },
  { name: '3 участника', rows: 1, cols: [3] },
  { name: '4 участника', rows: 2, cols: [2, 2] },
  { name: '6 участников', rows: 2, cols: [3, 3] },
  { name: '9 участников', rows: 3, cols: [3, 3, 3] },
  { name: '12 участников', rows: 3, cols: [4, 4, 4] },
];

const SCREENS = [
  { name: '1080p', width: 1920, height: 1080 },
  { name: '720p', width: 1280, height: 720 },
  /* ТВ с масштабом интерфейса 1.5 — WebView отдаёт меньше логических px. */
  { name: '1080p@1.5', width: 1280, height: 720 },
];

let checks = 0;
for (const screen of SCREENS) {
  for (const c of CASES) {
    const t = computeTile(screen, c.rows, c.cols);
    assert.ok(t, `${screen.name} / ${c.name}: размер не посчитан`);
    assert.ok(t.width > 48, `${screen.name} / ${c.name}: плитка схлопнулась (${t.width})`);

    /* Главная проверка: сетка + отступы сцены влезают в высоту экрана. */
    const stageHeight = c.rows * (t.height + TILE_MARGIN * 2);
    const totalHeight = stageHeight + INNER_PAD_TOP + INNER_PAD_BOTTOM + DOCK_SPACE;
    assert.ok(
      totalHeight <= screen.height + 1,
      `${screen.name} / ${c.name}: не влезает — нужно ${Math.round(totalHeight)}px при ${screen.height}px`
    );

    /* И по ширине. */
    const maxCols = Math.max(...c.cols);
    const totalWidth = maxCols * (t.width + TILE_MARGIN * 2) + INNER_PAD_SIDE * 2;
    assert.ok(
      totalWidth <= screen.width + 1,
      `${screen.name} / ${c.name}: по ширине нужно ${Math.round(totalWidth)}px при ${screen.width}px`
    );
    checks += 2;
  }
}

/* Негативный контроль: старая формула (без учёта padding) должна НЕ влезать. */
{
  const screen = { width: 1920, height: 1080 };
  const rows = 3;
  const maxCols = 4;
  const gap = 12;
  const availW = screen.width - gap * (maxCols + 1);
  const availH = screen.height - gap * (rows + 1);
  const wByWidth = availW / maxCols;
  const wByHeight = (availH / rows) * (16 / 9);
  const width = Math.min(wByWidth, wByHeight);
  const height = (width * 9) / 16;
  const oldTotal = rows * (height + TILE_MARGIN * 2) + INNER_PAD_TOP + INNER_PAD_BOTTOM;
  assert.ok(
    oldTotal > screen.height,
    'негативный контроль невалиден: старая формула должна переполнять экран'
  );
  console.log(`негативный контроль: старая формула даёт ${Math.round(oldTotal)}px при 1080px — переполнение воспроизведено`);
}

console.log(`D-403 tile fit: ${checks} проверок влезания — OK`);
