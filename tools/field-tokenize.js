'use strict';
/**
 * Фаза 5 — конвертер хардкод-цветов полевого слоя в токены дизайн-системы.
 *
 * Задача: 40 экранов рисуют цвета литералами (#hex, rgba), поэтому светлая тема
 * на них не применяется. Скрипт делает механическую замену по картам:
 *   - тёмные фоны/поверхности  → --bg-*, --field-*
 *   - белый/серый текст        → --text-*
 *   - синий/золото/красный/зел → --acc/--value/--danger/--ok
 *   - прозрачные белые/чёрные  → color-mix с токенами
 *
 * Всё, что не удалось классифицировать, НЕ трогается и попадает в отчёт
 * (ручная правка). Скрипт идемпотентный: повторный запуск безопасен.
 *
 * Запуск:
 *   node tools/field-tokenize.js            # dry-run, отчёт
 *   node tools/field-tokenize.js --apply    # применить
 *   node tools/field-tokenize.js --file=FieldHome.jsx --apply
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'public', 'mobile-app', 'src', 'pages', 'field');
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--file=')) || '').split('=')[1];
/** --css: обрабатывать CSS-файлы игр (chem-lab-*.css, pipeline-game.css). */
const CSS_MODE = process.argv.includes('--css');
const EXTS = CSS_MODE ? ['.css'] : ['.jsx'];

/* ── Карты замен ──────────────────────────────────────────────────────────
   Порядок важен: сначала точные (фон/текст), потом акценты.               */
const HEX_MAP = {
  // Тёмные фоны → токены темы
  '#0a0a0c': 'var(--bg-primary)',
  '#0b0e1a': 'var(--bg-primary)',
  '#080d1f': 'var(--bg-primary)',
  '#070a0e': 'var(--bg-primary)',
  '#0a0a1a': 'var(--bg-primary)',
  '#0d0d12': 'var(--bg-primary)',
  '#050814': 'var(--bg-primary)',
  '#0a0f1e': 'var(--bg-primary)',
  '#0a1018': 'var(--bg-primary)',
  '#0c0e1a': 'var(--bg-primary)',
  '#0a121c': 'var(--bg-primary)',
  '#000000': 'var(--bg-primary)',
  // Поверхности
  '#141418': 'var(--bg-surface)',
  '#141828': 'var(--field-card)',
  '#16161f': 'var(--bg-surface)',
  '#161d29': 'var(--bg-surface-alt)',
  '#1c1c22': 'var(--bg-surface-alt)',
  '#1a2040': 'var(--bg-surface-alt)',
  '#1a1f2e': 'var(--bg-surface-alt)',
  '#1e2550': 'var(--bg-elevated)',
  '#242430': 'var(--bg-elevated)',
  // Текст
  '#ffffff': 'var(--text-primary)',
  '#fff': 'var(--text-primary)',
  '#f5f5f7': 'var(--text-primary)',
  '#e8e8f0': 'var(--text-primary)',
  '#e5e7eb': 'var(--text-primary)',
  '#94a3b8': 'var(--text-secondary)',
  '#9ca3af': 'var(--text-secondary)',
  '#8e8e93': 'var(--text-secondary)',
  '#6b7280': 'var(--text-tertiary)',
  '#64748b': 'var(--text-tertiary)',
  // Акценты: синий = действие
  '#4a90d9': 'var(--acc)',
  '#3b82f6': 'var(--acc)',
  '#3a7bc8': 'var(--acc-deep)',
  '#60a5fa': 'var(--acc)',
  '#2d5a8a': 'var(--acc-deep)',
  // Золото = заработано
  '#c8a84e': 'var(--value)',
  '#c8a84b': 'var(--value)',
  '#d4a843': 'var(--value)',
  '#f0c24a': 'var(--value)',
  '#e0b44a': 'var(--value)',
  '#a08030': 'var(--value)',
  '#b8892b': 'var(--value)',
  // Красный = опасность
  '#ef4444': 'var(--danger)',
  '#c62828': 'var(--danger)',
  '#ff453a': 'var(--danger)',
  '#e5484d': 'var(--danger)',
  '#e24b4a': 'var(--danger)',
  // Зелёный = статус
  '#22c55e': 'var(--ok)',
  '#30d158': 'var(--ok)',
  '#10b981': 'var(--ok)',
  '#34d399': 'var(--ok)',
  '#16a34a': 'var(--ok)',
  '#12904a': 'var(--ok)',
  // Оранжевый/янтарный = заработано (ближайший смысл к золоту)
  '#f59e0b': 'var(--value)',
  '#f97316': 'var(--value)',
  '#fbbf24': 'var(--value)',
  '#f0c850': 'var(--value)',
  '#ffd700': 'var(--value)',
  '#b8860b': 'var(--value)',
  '#cd7f32': 'var(--value)',
  '#c0c0c0': 'var(--text-secondary)',
  // Фиолетовый/индиго (старая «руническая» система) → действие
  '#7b61ff': 'var(--acc)',
  '#8b5cf6': 'var(--acc)',
  '#a855f7': 'var(--acc)',
  '#a78bfa': 'var(--acc)',
  '#c4b5fd': 'var(--acc)',
  '#6366f1': 'var(--acc)',
  '#5aa0e0': 'var(--acc)',
  // Голубой/циан (действие)
  '#38bdf8': 'var(--acc)',
  '#0ea5e9': 'var(--acc)',
  '#06b6d4': 'var(--acc)',
  '#5ac8fa': 'var(--acc)',
  // Прочие тёмные фоны
  '#1a1a2e': 'var(--bg-surface)',
  '#1a0d2e': 'var(--bg-surface)',
  '#0a0a14': 'var(--bg-primary)',
  '#0a0a0a': 'var(--bg-primary)',
  '#101010': 'var(--bg-primary)',
  '#0d1b3e': 'var(--bg-primary)',
  '#1a0a2e': 'var(--bg-primary)',
  '#0a1628': 'var(--bg-primary)',
  '#1c0a22': 'var(--bg-primary)',
  '#120c08': 'var(--bg-primary)',
  '#140808': 'var(--bg-primary)',
  '#12100a': 'var(--bg-primary)',
  '#5a3e00': 'var(--value)',
  '#9333ea': 'var(--acc)',
  '#dc2626': 'var(--danger)',
  '#84cc16': 'var(--ok)',
  '#e6e9ef': 'var(--text-primary)',
  '#888': 'var(--text-secondary)',
  '#aaa': 'var(--text-secondary)',
  // С альфой (8-значный hex) → color-mix
  '#ffffff11': 'color-mix(in oklab, var(--text-primary) 7%, transparent)',
  '#ffffff08': 'color-mix(in oklab, var(--text-primary) 3%, transparent)',
  '#ffffff0a': 'color-mix(in oklab, var(--text-primary) 4%, transparent)',
  '#ffffff14': 'color-mix(in oklab, var(--text-primary) 8%, transparent)',
  '#ffffff1a': 'color-mix(in oklab, var(--text-primary) 10%, transparent)',
  '#ffffff22': 'color-mix(in oklab, var(--text-primary) 13%, transparent)',
  '#ffffff33': 'color-mix(in oklab, var(--text-primary) 20%, transparent)',
  '#00000033': 'color-mix(in oklab, var(--bg-primary) 20%, transparent)',
  '#00000066': 'color-mix(in oklab, var(--bg-primary) 40%, transparent)',
  // Прочие оттенки из игровых/полутоновых мест
  '#8b6914': 'var(--value)',
  '#c8940a': 'var(--value)',
  '#fff2a8': 'color-mix(in oklab, var(--value) 35%, #fff)',
  '#ffe17a': 'color-mix(in oklab, var(--value) 45%, #fff)',
  '#1a1000': 'var(--text-on-gold)',
  '#a06020': 'var(--value)',
  '#3ddc84': 'var(--ok)',
  '#166534': 'var(--ok)',
  // Финальная волна (остатки из игр/полутонов)
  '#e84057': 'var(--danger)',
  '#4ade80': 'var(--ok)',
  '#4a90ff': 'var(--acc)',
  '#a56eff': 'var(--acc)',
  '#a07010': 'var(--value)',
  '#7c3aed': 'var(--acc)',
  '#8b93a3': 'var(--text-secondary)',
  '#f5e6c8': 'color-mix(in oklab, var(--value) 25%, #fff)',
  '#5c2e10': 'var(--value)',
  '#ca8a04': 'var(--value)',
  '#7a1a28': 'var(--danger)',
  '#1a1408': 'var(--bg-primary)',
  '#e2e8f0': 'var(--text-primary)',
  '#2a2008': 'var(--bg-surface)',
  '#000': 'var(--bg-primary)',
  // Волна 2: индиго/фиолет (старая система) → действие
  '#7c3aed': 'var(--acc)', '#6366f1': 'var(--acc)', '#4f46e5': 'var(--acc)',
  '#6d28d9': 'var(--acc)', '#5b21b6': 'var(--acc)', '#4c1d95': 'var(--acc)',
  '#9b59b6': 'var(--acc)', '#a78bfa': 'var(--acc)', '#c084fc': 'var(--acc)',
  '#3b0764': 'var(--acc-deep)', '#2e1065': 'var(--acc-deep)',
  // Волна 2: оранжевый/янтарь → заработано
  '#ff9800': 'var(--value)', '#ffb020': 'var(--value)', '#fb923c': 'var(--value)',
  '#f5c542': 'var(--value)', '#f5c518': 'var(--value)', '#e8a838': 'var(--value)',
  '#a87d20': 'var(--value)', '#b08030': 'var(--value)', '#f59e0b': 'var(--value)',
  // Волна 2: светлые синие оттенки → действие
  '#93c5fd': 'var(--acc)', '#2563eb': 'var(--acc)', '#0284c7': 'var(--acc)',
  '#1d4ed8': 'var(--acc)', '#1e40af': 'var(--acc-deep)', '#172554': 'var(--acc-deep)',
  // Волна 2: красные/розовые → опасность
  '#f87171': 'var(--danger)', '#fca5a5': 'var(--danger)', '#9b2c2c': 'var(--danger)',
  '#7f1d1d': 'var(--danger)', '#991b1b': 'var(--danger)', '#b91c1c': 'var(--danger)',
  // Волна 2: зелёные → статус
  '#14532d': 'var(--ok)', '#166534': 'var(--ok)', '#065f46': 'var(--ok)',
  // Волна 2: тёмные базы градиентов
  '#111': 'var(--bg-primary)', '#1a1505': 'var(--bg-surface)', '#1a1520': 'var(--bg-surface)',
  '#1a1530': 'var(--bg-surface)', '#7a4a18': 'var(--value)', '#b8860b': 'var(--value)',
  '#6b6254': 'var(--text-secondary)', '#e8eef7': 'var(--text-primary)',
  '#4b5563': 'var(--text-tertiary)', '#1a1a2e': 'var(--bg-surface)', '#1a0d2e': 'var(--bg-surface)',
  '#0a0a1a': 'var(--bg-primary)', '#050814': 'var(--bg-primary)',
};

/** rgba/rgb → color-mix с токеном (по семантике канала). */
function mapRgba(src) {
  return src.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/g, (full, r, g, b, a) => {
    const [R, G, B] = [Number(r), Number(g), Number(b)];
    const alpha = a === undefined ? 1 : Number(a);
    const isWhite = R > 240 && G > 240 && B > 240;
    const isBlack = R < 24 && G < 24 && B < 24;
    const isBlueish = B > R + 40 && B > G + 20;
    const isRedish = R > G + 60 && R > B + 40;
    const isGreenish = G > R + 40 && G > B + 20;
    const isGoldish = R > 150 && G > 110 && B < 110;
    const pct = Math.round(alpha * 100);
    if (alpha >= 0.999) {
      if (isWhite) return 'var(--text-primary)';
      if (isBlack) return 'var(--bg-primary)';
      if (isBlueish) return 'var(--acc)';
      if (isRedish) return 'var(--danger)';
      if (isGreenish) return 'var(--ok)';
      if (isGoldish) return 'var(--value)';
      return full;
    }
    if (isWhite) return `color-mix(in oklab, var(--text-primary) ${pct}%, transparent)`;
    if (isBlack) return `color-mix(in oklab, var(--bg-primary) ${pct}%, transparent)`;
    if (isBlueish) return `color-mix(in oklab, var(--acc) ${pct}%, transparent)`;
    if (isRedish) return `color-mix(in oklab, var(--danger) ${pct}%, transparent)`;
    if (isGreenish) return `color-mix(in oklab, var(--ok) ${pct}%, transparent)`;
    if (isGoldish) return `color-mix(in oklab, var(--value) ${pct}%, transparent)`;
    return full;
  });
}

/* ── Прогон ─────────────────────────────────────────────────────────────── */
const report = [];
const files = fs.readdirSync(DIR).filter((f) => EXTS.some((e) => f.endsWith(e)) && (!ONLY || f === ONLY));

for (const f of files) {
  const p = path.join(DIR, f);
  const orig = fs.readFileSync(p, 'utf8');
  let out = orig;

  // 1) точные hex. ВАЖНО: длинные — первыми, и с проверкой, что дальше нет
  //    hex-символа (иначе `#fff` съедает начало `#fff2a8`).
  const hexKeys = Object.keys(HEX_MAP).sort((a, b) => b.length - a.length);
  for (const hex of hexKeys) {
    const token = HEX_MAP[hex];
    const body = hex.slice(1);
    const re = new RegExp('#' + body + '(?![0-9a-fA-F])', 'gi');
    out = out.replace(re, token);
  }
  // 2) rgba/rgb
  out = mapRgba(out);

  const before = (orig.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length + (orig.match(/rgba?\(/g) || []).length;
  const after = (out.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length + (out.match(/rgba?\(/g) || []).length;
  const leftoverHex = (out.match(/#[0-9a-fA-F]{3,8}\b/g) || []).slice(0, 6);

  report.push({ f, before, after, replaced: before - after, leftoverHex });
  if (APPLY && out !== orig) {
    fs.writeFileSync(p, out, 'utf8');
  }
}

report.sort((a, b) => b.replaced - a.replaced);
console.log(`# Токенизация полевых экранов (${APPLY ? 'APPLY' : 'DRY-RUN'})\n`);
console.log('| файл | было | стало | заменено | остаток hex |');
console.log('|---|--:|--:|--:|---|');
for (const r of report) {
  if (r.before === 0) continue;
  console.log(`| ${r.f} | ${r.before} | ${r.after} | ${r.replaced} | ${[...new Set(r.leftoverHex)].join(' ') || '—'} |`);
}
const totB = report.reduce((t, r) => t + r.before, 0);
const totA = report.reduce((t, r) => t + r.after, 0);
console.log('');
console.log(`Итого: ${totB} → ${totA} (заменено ${totB - totA}, осталось ${totA})`);
if (!APPLY) console.log('\nЗапуск с --apply для применения.');
