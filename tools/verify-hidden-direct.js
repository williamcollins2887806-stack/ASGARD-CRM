/**
 * Гейт: скрытые разделы недоступны прямым заходом у ВСЕХ ролей.
 *
 * История дефекта (нашёл независимый верификатор 23.10.2026).
 * Первая версия гейта открывала приложение без авторизации и смотрела, уводит
 * ли маршрут. `ProtectedRoute` уводит на `/welcome` ЛЮБОЙ маршрут без токена,
 * поэтому гейт «проходил» даже на `/m/несуществующий` — доказательство было
 * вакуумным.
 *
 * Вторая версия (полный стенд с моком `/api/auth/me`) давала то 15/15, то
 * «6 контрольных уведены»: приложение держит SSE-поток к `/api/sse/stream`,
 * и в headless-стенде bootstrap нестабилен. Флак нельзя лечить таймаутами —
 * гейт обязан быть детерминированным.
 *
 * Поэтому здесь проверяется САМА логика скрытия, а не её косвенные признаки:
 *  1. Настоящий модуль `hiddenRoutes.js` импортируется из Node (файл копируется
 *     в .mjs побайтово — это тот же код, что в сборке, а не пересказ).
 *  2. Дифференциально: 15 скрытых → `true`, контрольные живые → `false`.
 *     Без контрольной группы «всё true» тоже дало бы PASS — это ловушка.
 *  3. `ProtectedRoute` действительно вызывает `isHiddenRoute` и уводит с
 *     маршрута (иначе функция есть, но не подключена — и скрытия нет).
 *  4. `More.jsx` действительно фильтрует меню через `isHiddenRoute`.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const SRC = 'public/mobile-app/src';
const CORE = path.join(SRC, 'config/hiddenRoutes.js');

// Скрытые на мобильном у ВСЕХ ролей (решение заказчика 23.10.2026).
const HIDDEN = [
  '/tenders/platform', '/payroll', '/official-employees', '/staff-requests',
  '/travel', '/permits', '/personal-kanban', '/personal-kanban-config',
  '/personal-kanban-v3', '/correspondence', '/warehouse', '/gantt',
  '/seals', '/my-equipment', '/integrations',
];
// Контроль: живые разделы. Если и они «скрыты» — гейт сломан, а не код.
// ВАЖНО: сюда НЕЛЬЗЯ класть разделы из HIDDEN_ADMIN_ONLY / HIDDEN_NAVHIDE /
// HIDDEN_MAINTENANCE — они скрыты намеренно ещё до этой задачи. /invoices и
// /acts, например, в HIDDEN_NAVHIDE (у них нет своего пункта меню).
const VISIBLE = [
  '/tenders', '/works', '/finances', '/tasks', '/settings', '/more',
  '/marketplace', '/procurement', '/cash', '/procurement/requests',
];

// Вложенный маршрут скрытой секции тоже обязан быть скрыт.
const NESTED = ['/personal-kanban/abc-123', '/gantt/42', '/warehouse/items/7'];

let fails = 0;
const fail = (msg) => { console.log('  FAIL ' + msg); fails++; };
const pass = (msg) => console.log('  OK   ' + msg);

(async () => {
  // ── 1. Импорт настоящего модуля ─────────────────────────────────────────
  if (!fs.existsSync(CORE)) { console.log('FAIL: нет ' + CORE); process.exit(1); }
  const code = fs.readFileSync(CORE, 'utf8');
  const tmp = path.join(os.tmpdir(), `hiddenRoutes-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, code);
  let mod;
  try {
    mod = await import('file://' + tmp.replace(/\\/g, '/'));
  } catch (e) {
    console.log('FAIL: модуль не импортируется: ' + e.message);
    process.exit(1);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ok */ }
  }

  if (typeof mod.isHiddenRoute !== 'function') {
    console.log('FAIL: isHiddenRoute не экспортируется');
    process.exit(1);
  }
  console.log('=== 1. Модуль ' + CORE + ' ===');
  console.log('  экспорт isHiddenRoute: функция');
  console.log('  массив HIDDEN_MOBILE_ONLY:', mod.HIDDEN_MOBILE_ONLY ? 'есть' : 'НЕТ');
  if (!mod.HIDDEN_MOBILE_ONLY) fail('нет HIDDEN_MOBILE_ONLY');

  // ── 2. Дифференциальная проверка (без неё PASS бессмысленен) ────────────
  console.log('\n=== 2. Скрытые пути → true ===');
  let hiddenOk = 0;
  for (const p of HIDDEN) {
    if (mod.isHiddenRoute(p) === true) hiddenOk++;
    else fail(p + ' НЕ скрыт (isHiddenRoute = false)');
  }
  if (hiddenOk === HIDDEN.length) pass(`все ${HIDDEN.length} скрыты`);

  console.log('\n=== 3. КОНТРОЛЬ: живые пути → false ===');
  let visOk = 0;
  for (const p of VISIBLE) {
    if (mod.isHiddenRoute(p) === false) visOk++;
    else fail(p + ' ошибочно скрыт — гейт/код сломан');
  }
  if (visOk === VISIBLE.length) pass(`все ${VISIBLE.length} живых открыты`);

  console.log('\n=== 4. Вложенные пути скрытых секций → true ===');
  for (const p of NESTED) {
    if (mod.isHiddenRoute(p) === true) pass(p);
    else fail(p + ' доступен (вложенный маршрут не закрыт)');
  }

  // ── 5. Логика реально подключена к роутингу ────────────────────────────
  console.log('\n=== 5. Подключение к приложению ===');
  const pr = fs.readFileSync(path.join(SRC, 'components/layout/ProtectedRoute.jsx'), 'utf8');
  const prUses = /isHiddenRoute\s*\(/.test(pr);
  const prRedirect = /isHiddenRoute\([^)]*\)[\s\S]{0,120}<Navigate/.test(pr);
  if (prUses && prRedirect) pass('ProtectedRoute: isHiddenRoute → <Navigate (прямой заход уводится)');
  else fail('ProtectedRoute не применяет isHiddenRoute к маршруту');

  const more = fs.readFileSync(path.join(SRC, 'pages/More.jsx'), 'utf8');
  if (/isHiddenRoute\s*\(/.test(more)) pass('More.jsx: пункты меню фильтруются через isHiddenRoute');
  else fail('More.jsx не фильтрует меню — скрытые пункты останутся в списке');

  console.log('\n' + (fails === 0
    ? `ИТОГ: OK — ${HIDDEN.length} скрытых закрыто, ${VISIBLE.length} живых открыто, логика подключена`
    : `ИТОГ: FAIL — ${fails} нарушений`));
  process.exit(fails === 0 ? 0 : 1);
})();
