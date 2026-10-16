'use strict';
/**
 * Валидатор игрового UI по правилам скилов game-ui-design / game-ui-ux
 * (references/validations.md). Проверяет HUD, панели, кнопки игр.
 *
 * Правила: мелкий шрифт, мелкий тач-таргет, длинная анимация, отсутствие
 * reduced-motion, z-index-война, `outline:none` без :focus-visible,
 * HUD-текст без тени/обводки, фиксированные пиксельные размеры,
 * «цвет — единственный признак».
 *
 * Запуск:
 *   node tools/verify-game-ui.js            # отчёт
 *   node tools/verify-game-ui.js --check    # exit 1 при error-нарушениях
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIELD = path.join(ROOT, 'public', 'mobile-app', 'src', 'pages', 'field');
const CHECK = process.argv.includes('--check');

const GAME_FILES = [
  'ChemLabGame.jsx', 'PipelineGame.jsx', 'WheelOfNorns.jsx', 'ChemLabStage.jsx', 'ReactionVfx.jsx',
  'chem-lab-game.css', 'chem-lab-stage.css', 'chem-lab-vfx.css', 'pipeline-game.css',
];
/* Canvas/3D-полотно: внутри рисует WebGL, правила верстки к нему не применимы. */
const CANVAS_EXEMPT = /(canvas|three|webgl|gl_|mesh|shader|geometry|viewport)/i;

const findings = [];

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

function scan(f, src) {
  const lines = stripComments(src).split(/\r?\n/);
  lines.forEach((line, i) => {
    const n = i + 1;
    const push = (id, sev, msg) => findings.push({ file: f, line: n, id, sev, msg, text: line.trim().slice(0, 120) });
    if (CANVAS_EXEMPT.test(line) && !/font|button|touch|target/i.test(line)) return;

    // 1. Мелкий шрифт (<14px)
    const fs1 = line.match(/font-?[Ss]ize[:\s=]+['"]?([0-9]|1[0-3])(px|pt|rem)?['"]?/);
    if (fs1 && !/scale|clamp|em\b|%/i.test(line)) push('small-font-size', 'error', 'шрифт < 14px — нечитаем на телефоне/ТВ');

    // 2. Мелкий тач-таргет (<44px)
    const w = line.match(/\b(width|height|size)[:\s=]+['"]?([0-3]?[0-9])(px)?['"]?(?!\d)/);
    if (w && !/scale|%|vh|vw|em\b|flex|icon|gap|border|radius|padding|margin|stroke|line|dot|bar|font|letter/i.test(line)) {
      const v = Number(w[2]);
      if (v > 0 && v < 44) push('small-touch-target', 'error', `размер ${v}px < 44px — тач-таргет мал`);
    }

    // 3. Долгая анимация (>500ms)
    const a = line.match(/animation-?[Dd]uration[:\s=]+['"]?([0-9.]+)\s*(ms|s)?/);
    if (a) {
      const ms = a[2] === 's' ? Number(a[1]) * 1000 : Number(a[1]);
      if (ms > 500) push('long-animation-duration', 'warning', `анимация ${ms}ms > 500ms — риск motion-дискомфорта`);
    }

    // 4. z-index > 1000
    const z = line.match(/z-?[Ii]ndex[:\s=]+['"]?([0-9]{4,})['"]?/);
    if (z) push('z-index-war', 'warning', `z-index ${z[1]} > 1000 — ломает систему слоёв`);

    // 5. outline:none без :focus-visible
    if (/outline:\s*(none|0)/.test(line) && !/:focus-visible/.test(src)) {
      push('missing-focus-visible', 'warning', 'outline убран без :focus-visible');
    }

    // 6. Фиксированные крупные размеры (>=3 цифр)
    const fx = line.match(/\b(width|height):\s*([0-9]{3,4})px(?!\s*\/\*)/);
    if (fx && !/max-|min-|clamp|calc|scale/.test(line)) push('fixed-pixel-dimensions', 'warning', `жёсткий ${fx[1]}: ${fx[2]}px — не масштабируется`);
  });

  // 7. prefers-reduced-motion обязателен, если есть анимации
  if (/(@keyframes|animation:)/.test(src) && !/prefers-reduced-motion/.test(src)) {
    findings.push({ file: f, line: 0, id: 'no-reduced-motion', sev: 'info', msg: 'есть анимации, но нет @media (prefers-reduced-motion)', text: '' });
  }
  // 8. HUD-текст: класс hud/статус без тени/обводки
  if (/className="[^"]*hud[^"]*"/.test(src) && !/text-shadow|textShadow|-webkit-text-stroke/.test(src)) {
    findings.push({ file: f, line: 0, id: 'no-text-shadow-outline', sev: 'warning', msg: 'HUD-текст без тени/обводки — теряется на пестром фоне', text: '' });
  }
  // 9. Цвет как единственный признак (мигающий/активный статус только цветом)
  if (/(success|failure|danger|warning)[^\n]*color:\s*(red|#[fF][0-9a-fA-F]{2})/.test(src) && !/(icon|Icon|label|text|title)/.test(src)) {
    findings.push({ file: f, line: 0, id: 'color-only-meaning', sev: 'warning', msg: 'статус показан только цветом — добавь иконку/текст', text: '' });
  }
}

for (const f of GAME_FILES) {
  const p = path.join(FIELD, f);
  if (!fs.existsSync(p)) continue;
  scan(f, fs.readFileSync(p, 'utf8'));
}

const byId = {};
for (const x of findings) byId[x.id] = (byId[x.id] || 0) + 1;
const errors = findings.filter((x) => x.sev === 'error');
const warnings = findings.filter((x) => x.sev === 'warning');
const infos = findings.filter((x) => x.sev === 'info');

console.log('# Валидатор игрового UI (скил game-ui-design)\n');
console.log(`файлов: ${GAME_FILES.length} · error: ${errors.length} · warning: ${warnings.length} · info: ${infos.length}\n`);
console.log('| правило | кол-во |');
console.log('|---|--:|');
for (const [id, c] of Object.entries(byId).sort((a, b) => b[1] - a[1])) console.log(`| ${id} | ${c} |`);

if (errors.length) {
  console.log('\n## ERROR (чинить обязательно)');
  for (const e of errors.slice(0, 40)) console.log(`- ${e.file}:${e.line} [${e.id}] ${e.msg}\n  ${e.text}`);
}
if (warnings.length) {
  console.log('\n## WARNING');
  for (const w of warnings.slice(0, 25)) console.log(`- ${w.file}:${w.line} [${w.id}] ${w.msg}\n  ${w.text}`);
}
if (infos.length) {
  console.log('\n## INFO');
  for (const x of infos.slice(0, 12)) console.log(`- ${x.file} [${x.id}] ${x.msg}`);
}

if (CHECK && errors.length) {
  console.error(`\nFAIL: ${errors.length} error-нарушений правил игрового UI`);
  process.exit(1);
}
console.log(errors.length ? '\n(есть error)' : '\nOK — error-нарушений нет');
