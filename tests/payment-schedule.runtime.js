'use strict';

/**
 * D-318: РАНТАЙМ-тест графика оплат по всем ролям.
 * ═══════════════════════════════════════════════════════════════════════════
 * Почему появился: дефект «график оплат 503 у PM/HEAD_PM/HEAD_TO» жил в проде,
 * а все существующие тесты (`d292-payment-schedule-source`, `d291-doc-hub`)
 * проверяли НАЛИЧИЕ строки `visibilitySql` в исходнике — то есть были зелёными
 * на сломанном коде. Здесь мы реально вызываем эндпоинт под каждой ролью.
 *
 * Проверяем:
 *   1. 200 для ВСЕХ ролей, у которых непустая матрица видимости
 *      (PM, HEAD_PM, HEAD_TO, PROC, TO, WAREHOUSE) и для привилегированных
 *      (ADMIN, BUH, DIRECTOR_*, OFFICE_MANAGER);
 *   2. нет 503/500 ни в одном режиме (approved=true/false);
 *   3. заявка без строки реестра не видна ЧУЖОМУ пользователю
 *      (D-318b: раньше `(d.id IS NULL OR …)` пускал всех);
 *   4. суммы/счётчики не отрицательные и не NaN.
 *
 * Запуск: $env:JWT_SECRET='asgard-jwt-secret-2026'; node tests/payment-schedule.runtime.js
 * Требует приложения на :3101 с БД asgard_crm_test.
 */

const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const BASE = process.env.DH_BASE || 'http://127.0.0.1:3101';
const SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';
const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };

function mint(u) {
  return jwt.sign({ id: u.id, login: u.login, name: u.name, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' });
}

(async () => {
  await db.connect();
  console.log('\n=== D-318: график оплат по ролям (рантайм) ===');

  // По одному пользователю на каждую значимую роль.
  const users = (await db.query(
    `SELECT DISTINCT ON (role) id, login, name, role
       FROM users
      WHERE is_active AND role IN
        ('ADMIN','BUH','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','OFFICE_MANAGER',
         'PM','HEAD_PM','HEAD_TO','PROC','TO','WAREHOUSE')
      ORDER BY role, id`)).rows;
  if (!users.length) { console.error('нет пользователей для проверки'); process.exit(1); }

  const modes = [
    { qs: 'approved=true&paid=1', label: 'согласованные + оплаченные' },
    { qs: 'approved=true', label: 'только согласованные' },
    { qs: 'approved=false', label: 'ждут директора' }
  ];

  let broken = 0;
  for (const u of users) {
    const t = mint(u);
    for (const m of modes) {
      const r = await fetch(`${BASE}/api/doc-registry/payment-schedule?${m.qs}`, { headers: { Authorization: 'Bearer ' + t } });
      const txt = await r.text();
      if (r.status !== 200) {
        broken++;
        bad(`${u.role}(${u.id}) · ${m.label} → ${r.status} ${txt.slice(0, 90)}`);
        continue;
      }
      let j = null;
      try { j = JSON.parse(txt); } catch (_) { /* ниже проверим */ }
      const items = (j && j.items) || [];
      const kpi = (j && j.kpi) || {};
      const nums = [kpi.overdue, kpi.week, kpi.month].map((x) => (x && x.amount) || 0)
        .concat(items.map((x) => Number(x.amount) || 0));
      const badNum = nums.some((n) => !Number.isFinite(n) || n < 0);
      if (badNum) { broken++; bad(`${u.role} · ${m.label} → битые суммы`); }
    }
  }
  if (!broken) ok(`${users.length} ролей × ${modes.length} режима = ${users.length * modes.length} запросов, все 200`);

  // 503 конкретно не должно быть ни у одной роли (это был симптом дефекта).
  const pm = users.find((x) => x.role === 'PM');
  const headPm = users.find((x) => x.role === 'HEAD_PM');
  const headTo = users.find((x) => x.role === 'HEAD_TO');
  for (const u of [pm, headPm, headTo].filter(Boolean)) {
    const r = await fetch(`${BASE}/api/doc-registry/payment-schedule?approved=true&paid=1`, { headers: { Authorization: 'Bearer ' + mint(u) } });
    if (r.status === 200) ok(`${u.role}: 503 больше нет (был дефект integer = text[])`);
    else bad(`${u.role}: всё ещё ${r.status}`);
  }

  // D-318b: заявка без строки реестра не должна утекать чужому.
  const outsider = (await db.query(
    `SELECT id, login, name, role FROM users WHERE role='PM' AND is_active ORDER BY id LIMIT 1`)).rows[0];
  const other = (await db.query(
    `SELECT id, login, name, role FROM users WHERE role='PM' AND is_active AND id <> $1 ORDER BY id LIMIT 1`,
    [outsider.id])).rows[0];
  if (outsider && other) {
    // Заявка БЕЗ doc_registry_id, созданная «другим» человеком.
    const orphan = await db.query(
      `INSERT INTO payment_invoices(status, payment_status, supplier_name, amount, created_by, basis_type)
       VALUES('awaiting_dir','awaiting_dir','SCHED-TEST orphan', 777777, $1, 'other') RETURNING id`,
      [other.id]);
    const orphanId = orphan.rows[0].id;
    try {
      const r = await fetch(`${BASE}/api/doc-registry/payment-schedule?approved=false`, {
        headers: { Authorization: 'Bearer ' + mint(outsider) }
      });
      const j = await r.json().catch(() => ({}));
      const leaked = ((j.items || []).some((x) => Number(x.id) === Number(orphanId)));
      if (!leaked) ok('чужая заявка без реестра не видна (D-318b)');
      else bad('УТЕЧКА: чужая заявка без реестра видна другому PM');

      // Свой инициатор её видеть ДОЛЖЕН.
      const r2 = await fetch(`${BASE}/api/doc-registry/payment-schedule?approved=false`, {
        headers: { Authorization: 'Bearer ' + mint(other) }
      });
      const j2 = await r2.json().catch(() => ({}));
      const mine = ((j2.items || []).some((x) => Number(x.id) === Number(orphanId)));
      if (mine) ok('свой инициатор видит свою заявку без реестра');
      else bad('инициатор НЕ видит свою заявку — перекрутили видимость');
    } finally {
      await db.query('DELETE FROM payment_invoices WHERE id=$1', [orphanId]);
    }
  } else {
    console.log('  (нет двух PM для проверки утечки — пропущено)');
  }

  console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('ERR', e.message); if (db) await db.end().catch(() => {}); process.exit(1); });
