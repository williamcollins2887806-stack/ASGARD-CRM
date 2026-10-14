#!/usr/bin/env node
'use strict';

/**
 * Импорт августовских остатков/переплат из файла бухгалтера (111.xlsx).
 * ═══════════════════════════════════════════════════════════════════════════
 * Зачем: в системе не было ни одной pending-записи до сентября, поэтому
 * колонка «Остаток» на странице выплат была нулевой. Бухгалтерская сверка
 * августа приносит по каждому работнику итог: долг компании (>0) либо
 * переплата/выданный аванс (<0).
 *
 * Как отражаем (заказчик 14.10.2026):
 *   остаток > 0  → worker_payments(type='salary',  status='pending', 08.2026)
 *                  → попадает в «Остаток» (долг компании рабочему).
 *   остаток < 0  → worker_payments(type='penalty', status='pending', 08.2026)
 *                  → carry уходит в минус → колонка «Аванс» (переплата/аванс).
 *
 * Почему penalty, а не advance: долг с прошлых периодов (payout-row.js) собирает
 * ТОЛЬКО salary/bonus/per_diem/penalty. Pending-аванс туда не входит, поэтому
 * отрицательный перенос выражается именно штрафом (рабочий должен компании).
 *
 * Идемпотентно: повторный запуск не создаёт дублей (по тегу comment).
 * Обратимо: --revert удаляет все записи этого импорта.
 *
 * Запуск:
 *   node tools/import_august_balances.js --db asgard_crm_test          # dry-run
 *   node tools/import_august_balances.js --db asgard_crm_test --apply
 *   node tools/import_august_balances.js --db asgard_crm --revert
 */

const path = require('path');
const { Pool } = require('pg');

const TAG = 'AUG-2026-BALANCE-IMPORT';
const COMMENT = 'Корректировка августа 2026 (сверка 111.xlsx): остаток к выплате';
const COMMENT_ADV = 'Корректировка августа 2026 (сверка 111.xlsx): переплата/аванс';
const PERIOD_YEAR = 2026;
const PERIOD_MONTH = 8;

/**
 * Алиасы ФИО из файла бухгалтера → ФИО в CRM. В файле встречаются неточности:
 *   «Круглов Вадим» — в CRM это «Круглов Николай Александрович» (id 10030):
 *   подтверждено табелем (сентябрь 57 000 ₽ смены + 9 000 ₽ этапы);
 *   «Круглов Евгений Викторович» (9901) — без табеля, не он.
 */
const FIO_ALIASES = {
  'круглов вадим': 'Круглов Николай',
};

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] || true) : def;
}
const DB_NAME = arg('--db', 'asgard_crm_test');
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
// --emit-sql: не подключаться к БД, а напечатать SQL для прод-сервера
// (прод-база снаружи недоступна). SQL резолвит сотрудника по ФИО на самой БД.
const EMIT_SQL = process.argv.includes('--emit-sql');

/** Разбор « 125 496,00» / -30000 / 29195.25 → число. */
function parseAmount(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const s = String(v).replace(/\u00a0/g, ' ').replace(/\s+/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Читает xlsx (лист «Наемники»): [{fio, amount}] */
function readFile(xlsxPath) {
  const XLSX = require(path.join(__dirname, '..', 'node_modules', 'xlsx'));
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    const amount = parseAmount(r[1]);
    if (amount == null) continue;
    out.push({ fio: String(r[0]).trim(), amount });
  }
  return out;
}

/** «Андрющенко Константин» → строгий префикс ФИО (фамилия+имя), чтобы
 *  отчество не давало ложных совпадений («Пономарев Александр» ≠
 *  «Пономарев Кирилл Александрович»). */
async function resolveEmployee(db, fio) {
  const parts = fio.split(/\s+/).filter(Boolean);
  // Применяем алиас (неточность в файле бухгалтера), иначе — фамилия+имя.
  const resolved = FIO_ALIASES[parts.slice(0, 2).join(' ').toLowerCase()] || parts.slice(0, 2).join(' ');
  const { rows } = await db.query(
    `SELECT id, fio FROM employees WHERE fio ILIKE $1 ORDER BY id`,
    [`${resolved}%`]
  );
  if (rows.length === 1) return { emp: rows[0], amb: null };
  if (rows.length === 0) return { emp: null, amb: 'не найден' };
  return { emp: null, amb: 'неоднозначно: ' + rows.map((r) => `${r.id}:${r.fio}`).join(' | ') };
}

async function main() {
  const xlsxPath = arg('--file', path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads', '111.xlsx'));

  // ── Режим SQL-эмиссии для прод-сервера (БД снаружи недоступна) ────────────
  if (EMIT_SQL) {
    const fileRows = readFile(xlsxPath);
    const q = (s) => String(s).replace(/'/g, "''");
    const lines = [];
    lines.push('\\set ON_ERROR_STOP on');
    lines.push('BEGIN;');
    lines.push(`-- идемпотентно: чистим прошлый импорт этого тега`);
    lines.push(`DELETE FROM worker_payments WHERE comment IN ('${q(COMMENT)}', '${q(COMMENT_ADV)}');`);
    let total = 0, unresolved = 0;
    for (const fr of fileRows) {
      const parts = fr.fio.split(/\s+/).filter(Boolean);
      const resolved = FIO_ALIASES[parts.slice(0, 2).join(' ').toLowerCase()] || parts.slice(0, 2).join(' ');
      const type = fr.amount > 0 ? 'salary' : 'penalty';
      const abs = Math.abs(fr.amount);
      const comment = type === 'salary' ? COMMENT : COMMENT_ADV;
      const col = type === 'salary' ? 'Остаток' : 'Аванс';
      // Резолвим сотрудника подзапросом; если строк 0 или >1 — вставится 0 строк.
      lines.push(`-- ${fr.fio} → ${col} ${abs}`);
      lines.push(
        `INSERT INTO worker_payments (employee_id, work_id, type, amount, status, payment_method, paid_by, paid_by_role, pay_year, pay_month, comment, created_by, created_at, confirmation_status)` +
        ` SELECT e.id, NULL, '${type}', ${abs}, 'pending', 'adjustment',` +
        ` (SELECT id FROM users WHERE role='ADMIN' AND is_active IS NOT FALSE ORDER BY id LIMIT 1),` +
        ` 'buh', ${PERIOD_YEAR}, ${PERIOD_MONTH}, '${q(comment)}, ${col}: ${abs} ₽ (сверка авг.2026)',` +
        ` (SELECT id FROM users WHERE role='ADMIN' AND is_active IS NOT FALSE ORDER BY id LIMIT 1), NOW(), NULL` +
        ` FROM employees e WHERE e.fio ILIKE '${q(resolved)}%'` +
        ` AND (SELECT count(*) FROM employees e2 WHERE e2.fio ILIKE '${q(resolved)}%') = 1;`
      );
      total++;
    }
    lines.push('COMMIT;');
    lines.push(`SELECT 'ИМПОРТ: заявлено строк=${total}, actual вставлено=' || count(*) AS итог FROM worker_payments WHERE comment LIKE 'Корректировка августа 2026%';`);
    const out = arg('--out', null);
    const text = lines.join('\n') + '\n';
    if (typeof out === 'string') {
      require('fs').writeFileSync(out, text, 'utf8');
      process.stdout.write(`SQL записан: ${out} (${Buffer.byteLength(text)} байт, UTF-8)\n`);
    } else {
      process.stdout.write(text);
    }
    return;
  }

  const db = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: DB_NAME,
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789',
  });

  console.log(`=== Импорт остатков августа 2026 → ${DB_NAME} ${APPLY ? '(APPLY)' : REVERT ? '(REVERT)' : '(DRY-RUN)'} ===`);

  if (REVERT) {
    const { rowCount } = await db.query(`DELETE FROM worker_payments WHERE comment IN ($1, $2)`, [COMMENT, COMMENT_ADV]);
    console.log(`Удалено записей импорта: ${rowCount}`);
    await db.end();
    return;
  }

  const fileRows = readFile(xlsxPath);
  console.log(`В файле: ${fileRows.length} строк\n`);

  // Автор записи — первый активный ADMIN (для аудита).
  const { rows: admins } = await db.query(
    `SELECT id FROM users WHERE role='ADMIN' AND is_active IS NOT false ORDER BY id LIMIT 1`);
  const actorId = admins[0] ? admins[0].id : null;

  const plan = [];
  let problems = 0;
  for (const fr of fileRows) {
    const { emp, amb } = await resolveEmployee(db, fr.fio);
    if (!emp) { problems++; plan.push({ fio: fr.fio, amount: fr.amount, skip: amb }); continue; }
    const type = fr.amount > 0 ? 'salary' : 'penalty';
    const abs = Math.abs(fr.amount);
    plan.push({ fio: fr.fio, employee_id: emp.id, db_fio: emp.fio, amount: fr.amount, type, abs, col: fr.amount > 0 ? 'Остаток' : 'Аванс' });
  }

  console.log('ФИО из файла'.padEnd(26), 'ID'.padEnd(7), 'Сумма'.padStart(12), ' → колонка');
  console.log('-'.repeat(70));
  for (const p of plan) {
    if (p.skip) console.log(`${p.fio.padEnd(26)} ${'—'.padEnd(7)} ${String(p.amount).padStart(12)}  ⚠ ${p.skip}`);
    else console.log(`${p.fio.padEnd(26)} ${String(p.employee_id).padEnd(7)} ${String(p.amount).padStart(12)}  → ${p.col}`);
  }
  console.log('-'.repeat(70));
  const ok = plan.filter((p) => !p.skip);
  console.log(`Готово к записи: ${ok.length}; проблем: ${problems}\n`);

  if (!APPLY) {
    console.log('DRY-RUN. Для применения добавьте --apply');
    await db.end();
    return;
  }

  let inserted = 0, skippedDup = 0;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const p of ok) {
      // Идемпотентность: если такая запись уже есть (тот же период/тип/сумма/тег) — пропускаем.
      const { rows: dup } = await client.query(
        `SELECT id FROM worker_payments
          WHERE employee_id=$1 AND type=$2 AND pay_year=$3 AND pay_month=$4 AND comment=$5 AND status='pending'`,
        [p.employee_id, p.type, PERIOD_YEAR, PERIOD_MONTH, p.type === 'salary' ? COMMENT : COMMENT_ADV]);
      if (dup.length) { skippedDup++; continue; }

      const { rows: ins } = await client.query(
        `INSERT INTO worker_payments
           (employee_id, work_id, type, amount, status, payment_method, paid_by, paid_by_role,
            pay_year, pay_month, comment, created_by, created_at, confirmation_status)
         VALUES ($1, NULL, $2, $3, 'pending', 'adjustment', $4, 'buh', $5, $6, $7, $4, NOW(), NULL)         RETURNING id`,
        [p.employee_id, p.type, p.abs, actorId, PERIOD_YEAR, PERIOD_MONTH,
          p.type === 'salary' ? COMMENT : COMMENT_ADV]);
      inserted++;

      if (actorId) {
        await client.query(
          `INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
           VALUES ($1, 'worker_payments', $2, 'payout_aug_balance_import', $3::jsonb, NOW())`,
          [actorId, ins[0].id, JSON.stringify({
            employee_id: p.employee_id, fio: p.fio, source: '111.xlsx', period: '2026-08',
            balance: p.amount, reflected_as: p.type, column: p.col, tag: TAG,
          })]);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(`Записано: ${inserted}; пропущено дублей: ${skippedDup}`);
  console.log('Откат: node tools/import_august_balances.js --db ' + DB_NAME + ' --revert');
  await db.end();
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
