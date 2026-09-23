// Генератор мутантов для D-247 (hideModal/крестик шапки).
//
// Назначение: доказать, что живой гейт tools/verify_d247_hidemodal_live.js
// НЕ тавтологичен. Мутант откатывает правку D-247 в ui.js к прежнему поведению:
//   * closeBtn.addEventListener("click", hideModal)  → в hideModal приходит MouseEvent;
//   * hideModal без нормализации аргумента → target = event → `$(".cr-m", target)` падает.
//
// Ожидаемый результат: гейт в мутант-режиме обязан вернуть exit 1 (H1*/H4/H5 краснеют).
//
// Запуск:
//   node tools/make_d247_mutant.js
//   → пишет %TEMP%\ui_D247_MUTANT.js
//   UI_JS_PATH=%TEMP%\ui_D247_MUTANT.js node tools/verify_d247_hidemodal_live.js
//
// Скрипт правит ТОЛЬКО копию в %TEMP%; рабочий public/assets/js/ui.js не трогается.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'assets', 'js', 'ui.js');
const OUT = path.join(os.tmpdir(), 'ui_D247_MUTANT.js');

if (!fs.existsSync(SRC)) { console.error(`FATAL: не найден ${SRC}`); process.exit(1); }
let src = fs.readFileSync(SRC, 'utf8');
const before = src;

// ── Мутация 1: вернуть привязку крестика к событию (а не к overlay) ──────────
const fixedBtn = 'closeBtn.addEventListener("click", function(){ hideModal(overlay); });';
const oldBtn = 'closeBtn.addEventListener("click", hideModal);';
if (!src.includes(fixedBtn)) { console.error('FATAL: не найдена правка привязки крестика (мутация 1). Файл уже не тот?'); process.exit(1); }
src = src.replace(fixedBtn, oldBtn);

// ── Мутация 2: убрать нормализацию аргумента в hideModal ────────────────────
// Файл в CRLF — матчим регексом, терпимым к \r?\n.
const fixedPick = /    var el = _isOverlay\(overlay\) \? overlay\r?\n\s*: \(overlay && _isOverlay\(overlay\.currentTarget\) \? overlay\.currentTarget : null\);\r?\n    var target;\r?\n    if\(el\)\{/;
if (!fixedPick.test(src)) { console.error('FATAL: не найден блок нормализации (мутация 2). Файл уже не тот?'); process.exit(1); }
src = src.replace(fixedPick, '    let target = null;\r\n    if(overlay){');

// согласовать тело ветки: `_modalStack.indexOf(el)` → `_modalStack.indexOf(overlay)`, `target = el` → `target = overlay`
src = src.replace(/      const i = _modalStack\.indexOf\(el\);\r?\n      if\(i >= 0\) _modalStack\.splice\(i, 1\);\r?\n      target = el;/,
  '      const i = _modalStack.indexOf(overlay);\r\n      if(i >= 0) _modalStack.splice(i, 1);\r\n      target = overlay;');

// ── Мутация 3: вернуть падающую мёртвую строку ─────────────────────────────
src = src.replace(/    if\(!target \|\| !target\.classList\) return;\r?\n/,
  '    if(!target) return;\r\n    const modal = $(".cr-m", target);\r\n');

if (src === before) { console.error('FATAL: ни одна мутация не применилась'); process.exit(1); }

fs.writeFileSync(OUT, src, 'utf8');

// Проверка, что мутант действительно «сломан по D-247»
const checks = {
  'нормализация в hideModal убрана': !/_isOverlay\(overlay\)/.test(src),
  'крестик слушает Event': /closeBtn\.addEventListener\("click", hideModal\)/.test(src),
  'вернулась падающая строка': /const modal = \$\("\.cr-m", target\);\s*\n/.test(src),
};
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '[OK]' : '[FAIL]'} ${k}`); if (!v) ok = false; }

console.log(`\nМутант записан: ${OUT}`);
console.log(`Размер: ${src.length} (исходник ${before.length})`);
console.log('Прогон: UI_JS_PATH=' + OUT + ' node tools/verify_d247_hidemodal_live.js  (ожидается exit 1)');
process.exit(ok ? 0 : 1);
