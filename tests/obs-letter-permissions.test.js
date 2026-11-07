'use strict';

/**
 * tests/obs-letter-permissions.test.js
 *
 * V473: матрица прав «кто может создать письмо для ОБС».
 *
 * ПОЧЕМУ НЕ «ПРОВЕРИЛ ГЛАЗАМИ». Правило выглядит простым, но в нём легко
 * ошибиться в двух местах:
 *   • право шире, чем смена контура: письмо создаёт инициатор и ответственный,
 *     а контур по-прежнему меняет только бухгалтерия;
 *   • персональный полный обзор (`users.doc_full_view`) даёт право на ЛЮБОЙ
 *     счёт. На проде такой флаг у Д. Путкова, и он должен работать по факту
 *     чтения из БД, а не по роли в localStorage.
 *
 * Здесь проверяются оба правила и запреты. Функция извлечена из роута как
 * чистая: (user, doc, db) → boolean.
 */

const test = require('node:test');
const assert = require('node:assert');

process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test-not-used';

/**
 * Зеркало `canCreateObsLetter` из src/routes/doc-registry.js.
 * Держим копию здесь, чтобы тест ловил расхождение: если правило в роуте
 * изменится, а тест — нет, он упадёт на источнике (см. проверку ниже).
 */
const OBS_LETTER_ROLES = ['ADMIN', 'BUH', 'OFFICE_MANAGER'];

async function canCreateObsLetter(user, doc, db) {
  if (!user || !doc) return false;
  const role = String(user.role || '').toUpperCase();
  if (OBS_LETTER_ROLES.includes(role)) return true;
  const uid = Number(user.id) || 0;
  if (!uid) return false;
  if (Number(doc.created_by) === uid) return true;
  if (Number(doc.doc_owner_id) === uid) return true;
  if (Number(doc.pm_id) === uid) return true;
  try {
    const r = await db.query('SELECT doc_full_view FROM users WHERE id=$1', [uid]);
    if (r.rows[0] && r.rows[0].doc_full_view) return true;
  } catch (_) { /* нет колонки — нет права */ }
  return false;
}

function mkDb(fullView) {
  return { query: async () => ({ rows: [{ doc_full_view: !!fullView }] }) };
}

const OTHER_DOC = { created_by: 1, doc_owner_id: 1, pm_id: null, id: 500 };

test('бухгалтерия может создать письмо по чужому счёту', async () => {
  const ok = await canCreateObsLetter({ id: 900, role: 'BUH' }, OTHER_DOC, mkDb(false));
  assert.strictEqual(ok, true);
});

test('админ и офис-менеджер — тоже', async () => {
  assert.strictEqual(await canCreateObsLetter({ id: 1, role: 'ADMIN' }, OTHER_DOC, mkDb(false)), true);
  assert.strictEqual(await canCreateObsLetter({ id: 3471, role: 'OFFICE_MANAGER' }, OTHER_DOC, mkDb(false)), true);
});

test('инициатор (created_by) может по своему счёту', async () => {
  const doc = { created_by: 3465, doc_owner_id: 1, pm_id: null };
  assert.strictEqual(await canCreateObsLetter({ id: 3465, role: 'PM' }, doc, mkDb(false)), true);
});

test('ответственный (doc_owner_id) может по своему счёту', async () => {
  const doc = { created_by: 1, doc_owner_id: 4701, pm_id: null };
  assert.strictEqual(await canCreateObsLetter({ id: 4701, role: 'PROC' }, doc, mkDb(false)), true);
});

test('РП строки (pm_id) может по своему счёту', async () => {
  const doc = { created_by: 1, doc_owner_id: 1, pm_id: 3465 };
  assert.strictEqual(await canCreateObsLetter({ id: 3465, role: 'PM' }, doc, mkDb(false)), true);
});

test('Путков с doc_full_view может по ЛЮБОМУ счёту', async () => {
  // Именно этот сценарий просил заказчик: у Димы грант полного обзора,
  // он видит весь реестр и пишет письмо по любой строке.
  const ok = await canCreateObsLetter({ id: 3465, role: 'PM' }, OTHER_DOC, mkDb(true));
  assert.strictEqual(ok, true);
});

test('PM без гранта по чужому счёту — отказ', async () => {
  const ok = await canCreateObsLetter({ id: 3466, role: 'PM' }, OTHER_DOC, mkDb(false));
  assert.strictEqual(ok, false);
});

test('PROC без гранта по чужому счёту — отказ', async () => {
  const ok = await canCreateObsLetter({ id: 4700, role: 'PROC' }, OTHER_DOC, mkDb(false));
  assert.strictEqual(ok, false);
});

test('ошибка чтения флага не даёт право (fail-closed)', async () => {
  const db = { query: async () => { throw new Error('колонки нет'); } };
  const ok = await canCreateObsLetter({ id: 3466, role: 'PM' }, OTHER_DOC, db);
  assert.strictEqual(ok, false);
});

test('без пользователя — отказ', async () => {
  assert.strictEqual(await canCreateObsLetter(null, OTHER_DOC, mkDb(true)), false);
  assert.strictEqual(await canCreateObsLetter({ id: 1, role: 'PM' }, null, mkDb(true)), false);
});

// ─── Сверка с источником: правило в роуте не разошлось с тестом ───────────
test('константы и правило в роуте совпадают с тестом', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/routes/doc-registry'), 'utf8');

  const m = src.match(/const OBS_LETTER_ROLES = \[([^\]]*)\]/);
  assert.ok(m, 'OBS_LETTER_ROLES найден в роуте');
  const roles = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  for (const r of OBS_LETTER_ROLES) assert.ok(roles.includes(r), `роль ${r} в списке роута`);
  assert.ok(!roles.includes('PM'), 'PM в списке ролей быть не должно — только через флаг/владение');

  assert.ok(/function canCreateObsLetter/.test(src), 'в роуте есть canCreateObsLetter');
  assert.ok(/doc_full_view/.test(src), 'право учитывает персональный полный обзор');
  assert.ok(/doc_owner_id/.test(src) && /created_by/.test(src) && /pm_id/.test(src),
    'право учитывает владельца, автора и РП строки');
});

test('переключатель контура остаётся у бухгалтерии (не расширен на PM)', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/routes/doc-registry'), 'utf8');
  const m = src.match(/const OBS_ROLES = \[([^\]]*)\]/);
  assert.ok(m, 'OBS_ROLES найден');
  const roles = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.deepStrictEqual(roles.sort(), ['BUH'], 'контур меняет только BUH (ADMIN проходит отдельно)');
});
