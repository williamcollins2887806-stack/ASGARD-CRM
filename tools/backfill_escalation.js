/**
 * D-317: бэкфилл расписания эскалации для УЖЕ висящих заявок.
 * Без него заявки, созданные до выкатки, никогда не напомнят о себе:
 * крон выбирает только то, что есть в approval_escalation.
 *
 * Правило: next_at = submitted_at + 12ч (или created_at, если submitted_at пуст).
 * Если этот момент уже прошёл — ставим NOW(): напомним на ближайшем тике,
 * но не ночью (тихое окно 07–22 МСК отсечёт).
 *
 * Запуск: node tools/backfill_escalation.js [--apply]
 */

const path = process.cwd();
require(path + '/node_modules/dotenv').config({ path: path + '/.env' });
const { Client } = require(path + '/node_modules/pg');

const APPLY = process.argv.includes('--apply');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();

  const has = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_name='approval_escalation'`);
  if (!has.rows.length) { console.error('НЕТ таблицы approval_escalation — примените V432'); process.exit(1); }

  const missing = await c.query(
    `SELECT p.id, p.supplier_name, p.amount, p.submitted_at, p.created_at
       FROM payment_invoices p
      WHERE p.status='awaiting_dir'
        -- D-317: не напоминаем про мусорные карточки. Старый поток создавал
        -- заявку ДО распознавания (поставщик «Распознаётся…», сумма 0) —
        -- это не заявка директору, а технический черновик.
        AND COALESCE(p.amount, 0) > 0
        AND COALESCE(p.supplier_name, '') NOT IN ('', 'Распознаётся…')
        AND NOT EXISTS (SELECT 1 FROM approval_escalation e WHERE e.payment_invoice_id = p.id)
      ORDER BY p.id`
  );
  console.log(`заявок awaiting_dir без расписания: ${missing.rows.length}`);
  for (const r of missing.rows) {
    console.log(`  #${r.id} ${r.supplier_name || '—'} ${r.amount} ₽`);
  }

  // Показываем, что пропущено осознанно (мусорные карточки) — не молчим.
  const junk = await c.query(
    `SELECT p.id, p.supplier_name, p.amount FROM payment_invoices p
      WHERE p.status='awaiting_dir'
        AND (COALESCE(p.amount,0) <= 0 OR COALESCE(p.supplier_name,'') IN ('', 'Распознаётся…'))
        AND NOT EXISTS (SELECT 1 FROM approval_escalation e WHERE e.payment_invoice_id=p.id)
      ORDER BY p.id`
  );
  if (junk.rows.length) {
    console.log(`\nпропущено как мусор (нет суммы/поставщика): ${junk.rows.length}`);
    for (const r of junk.rows) console.log(`  #${r.id} ${r.supplier_name || '—'} ${r.amount} ₽`);
  }

  if (!APPLY) {
    console.log('\n(dry-run) запустите с --apply, чтобы создать расписание');
    await c.end();
    return;
  }

  let made = 0;
  for (const r of missing.rows) {
    // D-318c (верификатор 21.10.2026): шаг НЕЛЬЗЯ фиксировать в 0.
    // Заявка возрастом 44 ч должна быть на step≈2-3, иначе «догоняющие»
    // напоминания (12ч → 24ч → 24ч) никогда не уйдут: backfill ставил
    // step=0 и next_at=NOW(), и первое же напоминание сдвигало счётчик на 1,
    // теряя шаги 2–3.
    // Считаем ожидаемый шаг от возраста: 12ч → step 1, 36ч → step 2, 60ч → step 3.
    const res = await c.query(
      `WITH aged AS (
         SELECT $1::int AS pid,
                COALESCE($2::timestamptz, $3::timestamptz, NOW()) AS base
       ), calc AS (
         SELECT pid, base,
                GREATEST(0, FLOOR((EXTRACT(EPOCH FROM (NOW() - base)) - 12*3600) / (24*3600)) + 1)::int AS step_due
           FROM aged
       )
       INSERT INTO approval_escalation (payment_invoice_id, step, next_at, created_at, updated_at)
       SELECT pid, step_due, NOW(), NOW(), NOW()
         FROM calc
       ON CONFLICT (payment_invoice_id) DO NOTHING
       RETURNING id, step`,
      [r.id, r.submitted_at, r.created_at]
    );
    if (res.rowCount) {
      made++;
      if (res.rows[0].step > 0) {
        console.log(`  #${r.id}: возраст большой → сразу step=${res.rows[0].step} (догоняющие напоминания не потеряны)`);
      }
    }
  }
  console.log(`\nсоздано расписаний: ${made}`);

  const check = await c.query(
    `SELECT count(*)::int n FROM payment_invoices p
      WHERE p.status='awaiting_dir'
        AND NOT EXISTS (SELECT 1 FROM approval_escalation e WHERE e.payment_invoice_id=p.id)`);
  console.log(`осталось без расписания: ${check.rows[0].n}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
