#!/usr/bin/env node
'use strict';

/**
 * D-246 (шум): почему `/api/data/notifications/by-index` — 43 % трафика.
 *
 * Гипотеза (доказана по nginx): SLA-тик зовёт `alreadyNotified` → `byIndex` на каждую
 * пару «правило × получатель» (дни рождения × все офисные юзеры). Это O(N·M) запросов,
 * а не 1. Скрипт считает это число на клоне и печатает доказательство.
 *
 * Запуск (только клон):
 *   node tools/measure_sla_byindex.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvFile(path.join(__dirname, '..', '.env'));

(async () => {
  const db = require('../src/services/db');
  if ((process.env.DB_NAME || '') !== 'asgard_crm_test') {
    console.error(`FAIL: DB_NAME=${process.env.DB_NAME} — замер только на asgard_crm_test`);
    await db.end();
    process.exit(2);
  }

  const q = async (sql, p) => (await db.query(sql, p)).rows;

  // Получатели правила «дни рождения офиса» = все активные users с birth_date,
  // а уведомляется каждый активный пользователь, кроме именинника.
  const office = await q(`SELECT count(*)::int AS n FROM users WHERE is_active AND birth_date IS NOT NULL`);
  const activeUsers = await q(`SELECT count(*)::int AS n FROM users WHERE is_active`);

  // Сотрудники: получатели = HR + DIRECTOR*
  const empsWithBday = await q(`SELECT count(*)::int AS n FROM employees WHERE birth_date IS NOT NULL`);
  const hrDirectors = await q(`
    SELECT count(*)::int AS n FROM users
    WHERE is_active AND (upper(role) = 'HR' OR upper(role) = 'DIRECTOR' OR upper(role) LIKE 'DIRECTOR_%')`);

  // Никто не именинник «сегодня» — значит правило soon (≤5 дней) тоже не сработает;
  // берём фактические данные за окно 14–20.09 как есть.
  const birthdaysInWeek = await q(`
    SELECT count(*)::int AS n FROM users
    WHERE is_active AND birth_date IS NOT NULL
      AND to_char(birth_date, 'MM-DD') BETWEEN to_char(DATE '2026-09-14', 'MM-DD') AND to_char(DATE '2026-09-20', 'MM-DD')`);

  // Сколько уже созданных уведомлений SLA (по kind) есть за неделю — для сверки.
  const notifKinds = await q(`
    SELECT kind, count(*)::int AS n FROM notifications
    WHERE created_at::date BETWEEN '2026-09-14' AND '2026-09-20'
      AND kind IN ('birthday_today','birthday_soon','emp_birthday_today','emp_birthday_soon',
                   'docs_deadline','pm_calc_due','pm_calc_overdue')
    GROUP BY 1 ORDER BY n DESC`);

  const N_MIN = Math.max(0, activeUsers[0].n - 1);   // получателей на 1 именинника
  const perTickWorst = office[0].n * N_MIN;          // O(именинники × получатели)

  console.log('── Данные клона ──');
  console.log(`активных users:                 ${activeUsers[0].n}`);
  console.log(`users с birth_date:             ${office[0].n}`);
  console.log(`employees с birth_date:         ${empsWithBday[0].n}`);
  console.log(`HR/DIRECTOR* (получатели Ф):    ${hrDirectors[0].n}`);
  console.log(`именинников офиса в окне:       ${birthdaysInWeek[0].n}`);
  console.log('\n── Оценка одного SLA-тика ──');
  console.log(`правило E (офис): ${office[0].n} × ${N_MIN} = ${perTickWorst} by-index вызовов`);
  console.log(`правило F (рабочие): ${empsWithBday[0].n} × ${hrDirectors[0].n} = ${empsWithBday[0].n * hrDirectors[0].n}`);
  console.log(`итого верхняя оценка на тик:    ${perTickWorst + empsWithBday[0].n * hrDirectors[0].n}`);
  console.log(`интервал тика:                  10 мин (router.js), коулдаун 5 мин (sla.js)`);
  console.log(`\nзасутки при 10-мин тике:        ${(perTickWorst + empsWithBday[0].n * hrDirectors[0].n) * 144}`);

  console.log('\n── Факт из БД (неделя 14–20.09) ──');
  if (!notifKinds.length) console.log('  уведомлений SLA за неделю нет (dedup) — значит by-index холостые: только чтения');
  for (const r of notifKinds) console.log(`  ${r.kind}: ${r.n}`);

  await db.end();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
