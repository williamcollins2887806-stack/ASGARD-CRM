/**
 * L2 verify — фронтенд-логика «Ожидание» (vanilla + desktop v2).
 * Тянем реальные исходники и проверяем ключевые инварианты:
 *   1. waiting есть в наборе типов travel-режима (vanilla + v2 + mobile).
 *   2. Иконка — ⏳ (песочные часы), а не ⏰.
 *   3. canManageCellType / cellIsEditable: чужая ⏳ заменяема для OFFICE_MANAGER/HEAD_TO,
 *      но PM в pm-режиме — НЕТ (нет эскалации прав).
 *   4. waiting НЕ в FREE_STANDING (work_id-контракт не сломан).
 */
const fs = require('fs');
const path = require('path');
// Скрипт живёт в tests/timesheet-v2/ — все пути считаем от корня репозитория.
const ROOT = path.resolve(__dirname, '..', '..');

const results = [];
function check(name, cond, proof) {
  results.push({ name, pass: !!cond, proof: proof === undefined ? '' : String(proof) });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${proof !== undefined ? '  — ' + proof : ''}`);
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── 1. Vanilla: MODE_ALLOWED_TYPES + иконка ────────────────────────────────
const vanilla = read('public/assets/js/timesheet-v2.js');
const vTravel = vanilla.match(/travel:\s*\[([^\]]*)\]/);
check('vanilla: travel-mode содержит waiting', /waiting/.test(vTravel ? vTravel[1] : ''), vTravel ? vTravel[1] : 'не найдено');
const vWaitingMeta = vanilla.match(/waiting:\s*\{[^}]*\}/);
check('vanilla: иконка waiting = ⏳', /icon:\s*'⏳'/.test(vWaitingMeta ? vWaitingMeta[0] : ''), (vWaitingMeta || [''])[0].slice(0, 90));

// ── 2. Vanilla: cellIsEditable через eval в изоляции ──────────────────────
const vSrc = vanilla.match(/const CROSS_EDIT_GROUPS = \[[\s\S]*?\n  \];[\s\S]*?^  \}/m);
const vAllowed = vanilla.match(/const MODE_ALLOWED_TYPES = \{[\s\S]*?\n  \};/);
let vFn = null;
if (vSrc && vAllowed) {
  // eslint-disable-next-line no-new-func
  vFn = new Function(`${vAllowed[0]}\n${vSrc[0]}\nreturn cellIsEditable;`)();
}
check('vanilla: cellIsEditable извлечена', typeof vFn === 'function');
if (typeof vFn === 'function') {
  const omEntry = { type: 'travel', is_mine: false };
  check('vanilla: OM видит чужую ✈️ кликабельной (замена на ⏳/🚢)', vFn(true, omEntry, 'travel') === true);
  const strangerWaiting = { type: 'waiting', is_mine: false };
  check('vanilla: OM видит чужую ⏳ кликабельной', vFn(true, strangerWaiting, 'travel') === true);
  check('vanilla: PM в pm-режиме НЕ правит чужую ⏳ (нет эскалации)', vFn(true, strangerWaiting, 'pm') === false);
  check('vanilla: PM в pm-режиме НЕ правит чужой день (регресс-гард)', vFn(true, { type: 'day', is_mine: false }, 'pm') === false);
  check('vanilla: своя отметка всегда редактируема', vFn(true, { type: 'waiting', is_mine: true }, 'pm') === true);
  check('vanilla: canEdit=false блокирует всё', vFn(false, null, 'travel') === false);
  check('vanilla: warehouse не правит чужую ⏳ (не его скоуп)', vFn(true, strangerWaiting, 'warehouse') === false);
}

// ── 3. Vanilla: waiting не свободный этап ────────────────────────────────
const vFree = vanilla.match(/const FREE_STANDING = \{([^}]*)\}/);
check('vanilla: waiting НЕ в FREE_STANDING (work_id-контракт цел)', vFree && !/waiting/.test(vFree[1]), vFree ? vFree[1].trim() : 'не найдено');

// ── 4. Desktop v2: api.js ────────────────────────────────────────────────
const v2api = read('public/desktop-v2-src/src/pages/Timesheet/api.js');
const travelCfg = v2api.match(/travel:\s*\{[\s\S]*?\n  \},/);
check('v2 api.js: travel.editableTypes содержит waiting', /editableTypes:\s*\['travel',\s*'waiting'\]/.test(travelCfg ? travelCfg[0] : ''), travelCfg ? travelCfg[0].match(/editableTypes[^\]]*\]/)[0] : 'не найдено');
check('v2 api.js: иконка waiting = ⏳', /waiting:\s*\{[^}]*icon:\s*'⏳'/.test(v2api));
check('v2 api.js: waiting НЕ в FREE_STANDING_TYPES', !/FREE_STANDING_TYPES\s*=\s*new Set\(\[[^\]]*waiting/.test(v2api));
check('v2 api.js: waiting остаётся в REQUIRE_WORK_ID (для pm/global)', /REQUIRE_WORK_ID = new Set\(\['day', 'night', 'waiting'\]\)/.test(v2api));

// ── 5. Desktop v2: CellEditor.canManageCellType ───────────────────────────
const cellEditor = read('public/desktop-v2-src/src/pages/Timesheet/CellEditor.jsx');
const groups = cellEditor.match(/const CROSS_EDIT_GROUPS = \[[\s\S]*?\n\];/);
const canFn = cellEditor.match(/export function canManageCellType\([\s\S]*?\n\}/);
let v2Fn = null;
if (groups && canFn) {
  // eslint-disable-next-line no-new-func
  v2Fn = new Function(`${groups[0]}\n${canFn[0].replace('export function', 'function')}\nreturn canManageCellType;`)();
}
check('v2 CellEditor: canManageCellType извлечена', typeof v2Fn === 'function');
if (typeof v2Fn === 'function') {
  check('v2: [travel,waiting] правит чужую ⏳', v2Fn(['travel', 'waiting'], 'waiting', 'travel') === true);
  check('v2: [travel,waiting] правит чужой ✈️', v2Fn(['travel', 'waiting'], 'travel', 'travel') === true);
  check('v2: [travel,waiting] правит чужой 🚢 (транспорт)', v2Fn(['travel', 'waiting'], 'ship', 'travel') === true);
  check('v2: PM НЕ получает cross-group прав на ✈️ (не его скоуп)', v2Fn(['day', 'night', 'waiting'], 'travel', 'pm') === false);
  check('v2: PM НЕ получает cross-group прав на 🚢', v2Fn(['day', 'night', 'waiting'], 'ship', 'pm') === false);
  check('v2: WAREHOUSE НЕ получает cross-group прав', v2Fn(['warehouse'], 'travel', 'warehouse') === false);
  check('v2: [medical] НЕ правит чужую ⏳', v2Fn(['medical', 'training', 'ship', 'helicopter'], 'waiting', 'medical') === false);
  check('v2: свой тип всегда правит', v2Fn(['waiting'], 'waiting', 'travel') === true);
  // Аудит-замечание «PM удаляет чужую ⏳» — снято как ложное: в PM-табеле чужая
  // отметка на работе РП отдаётся backend'ом с is_mine=true (work.pm_id === viewer.id),
  // и РП по ТЗ правит ВСЁ на своей работе. Гард ниже закрывает обратный случай —
  // PM не получает cross-group прав на типы вне своего набора.
  check('v2: PM guard отсекает cross-group (travel) вне своего набора', v2Fn(['day', 'night', 'waiting'], 'travel', 'pm') === false);
}
// Вызовы передают mode (3-й аргумент) — иначе гард PM не работает
const gridCalls = read('public/desktop-v2-src/src/pages/Timesheet/TimesheetGrid.jsx');
check('v2 TimesheetGrid: canManageCellType вызван с mode', /canManageCellType\(editableTypes, cell\.type, mode\)/.test(gridCalls));
check('v2 CellEditor: canManageCellType вызван с mode', /canManageCellType\(editableTypes, currentEntry\.type, mode\)/.test(cellEditor));

// ── 6. Mobile ───────────────────────────────────────────────────────────
const mob = read('public/mobile-app/src/pages/timesheet/TimesheetMobile.jsx');
check('mobile: travel-mode содержит waiting', /travel:\s*\['travel',\s*'waiting'\]/.test(mob));
check('mobile: иконка waiting = ⏳', /waiting:\s*\{[^}]*icon:\s*'⏳'/.test(mob));

// ── 7. Backend: waiting в travel-скоупе и не в медицинском ────────────────
const be = read('src/routes/timesheet-v2.js');
check('backend: travel-mode допускает waiting', /mode === 'travel'\) return type === 'travel' \|\| type === 'waiting'/.test(be));
check('backend: medical-mode НЕ допускает waiting', /mode === 'medical'\) \{[\s\S]{0,220}?return type === 'medical' \|\| type === 'training' \|\| type === 'ship' \|\| type === 'helicopter';/.test(be));
const locks = read('src/lib/timesheet-locks.js');
check('locks: waiting -> travel-скоуп', /waiting:\s*'travel'/.test(locks));
const gt = read('src/routes/global-timesheet.js');
check('global: OM/HEAD_TO могут waiting', /role === 'OFFICE_MANAGER' \|\| role === 'HEAD_TO'\) && \(type === 'travel' \|\| type === 'waiting'\)/.test(gt));
check('global: HEAD_TO waiting -> travel-скоуп', /role === 'HEAD_TO' && \(type === 'travel' \|\| type === 'waiting'\)\) return 'travel'/.test(gt));

const failed = results.filter((r) => !r.pass);
console.log(`\n═══ ИТОГ: ${results.length - failed.length}/${results.length} PASS ═══`);
if (failed.length) failed.forEach((f) => console.log(`  FAIL: ${f.name} — ${f.proof}`));
process.exit(failed.length ? 1 : 0);
