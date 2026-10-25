'use strict';
/**
 * D-377x: согласовать #23, #24, #33 ИСКЛЮЧЕНИЕМ по решению пользователя.
 *
 * Основание решения (не выдумка): пользователь 24.10.2026 20:10 дал прямое
 * указание «23 24 33 тоже ставь согласовано, в качестве исключения».
 * Это НЕ письменное согласие директора — в почте его нет, есть только
 * пересказ Баринова «Олег Викторович — ранее подтверждали».
 *
 * Поэтому в карточке честно пишем:
 *   • approval_channel = 'exception'  — видно, что канал не почтовый;
 *   • dir_comment       — причина и цитата из писем Баринова;
 *   • в реестре (doc_registry.comment_text) — то же, чтобы бухгалтер видел.
 *
 * НЕ подставляем Сторожева/Гажилиева как согласовавших: они этого счёта не
 * подтверждали, и подпись чужим именем — фальсификация. В dir_approved_by
 * ставим пользователя, который принял решение (Никита Андросов), а канал
 * явно говорит «исключение».
 *
 * Идемпотентно: уже не awaiting_dir → пропуск.
 */
const pg = require('/var/www/asgard-crm/node_modules/pg');
require('/var/www/asgard-crm/node_modules/dotenv').config({ path: '/var/www/asgard-crm/.env' });

const REASON = 'Исключение по решению руководства CRM (24.10.2026): оплату согласовали в обход почтовой процедуры. '
  + 'В почте прямого ответа директора нет — есть пересказ инициатора: «ранее подтверждали» (Баринов В.А.).';

const TARGETS = [
  { id: 23, quote: '«Олег Викторович — ранее подтверждали. Анастасия — прошу поставить в очередь оплаты» (Баринов, 22.10)' },
  { id: 24, quote: '«Олег Викторович — ранее подтверждали. Анастасия — прошу поставить в очередь оплаты» (Баринов, 22.10)' },
  { id: 33, quote: '«Олег Викторович — ранее подтверждали заявку. Анастасия — прошу оплатить» (Баринов, 22.10)' },
];

(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });

  // Кто принимает решение — пользователь, давший указание.
  const me = (await pool.query(`SELECT id, name, role FROM users WHERE email ILIKE '%nikita%' OR name ILIKE '%Андросов%' ORDER BY id LIMIT 1`)).rows[0];
  if (!me) { console.error('не нашёл пользователя-инициатора'); process.exit(1); }
  console.log(`решение фиксируем от: #${me.id} ${me.name} (${me.role})\n`);

  for (const t of TARGETS) {
    const pay = (await pool.query(`SELECT * FROM payment_invoices WHERE id=$1`, [t.id])).rows[0];
    if (!pay) { console.log(`#${t.id}: нет счёта`); continue; }
    if (pay.status !== 'awaiting_dir') { console.log(`#${t.id}: статус ${pay.status} — пропуск`); continue; }

    const full = `${REASON} Основание: ${t.quote}`;
    await pool.query('BEGIN');
    try {
      await pool.query(`
        UPDATE payment_invoices
           SET status='pending_payment', payment_status='pending_payment',
               dir_approved_by=$2, dir_approved_at=NOW(),
               approval_channel='exception',
               dir_comment=$3,
               updated_at=NOW()
         WHERE id=$1 AND status='awaiting_dir'`, [t.id, me.id, full]);

      // Реестр: та же пометка, чтобы бухгалтер не искал письмо, которого нет.
      if (pay.doc_registry_id) {
        await pool.query(`
          UPDATE doc_registry
             SET comment_text = CASE WHEN COALESCE(TRIM(comment_text),'')='' THEN $2
                                     ELSE comment_text || ' | ' || $2 END,
                 updated_at = NOW()
           WHERE id=$1`, [pay.doc_registry_id, 'Согласовано исключением (CRM, 24.10.2026): письменного ответа директора нет.']);
      }
      await pool.query('COMMIT');
      console.log(`✅ #${t.id} ${pay.invoice_number} · ${Number(pay.amount).toLocaleString('ru-RU')} ₽ → pending_payment`);
      console.log(`   канал: manual_exception, реестр: ${pay.doc_registry_id || '—'}`);
    } catch (e) {
      await pool.query('ROLLBACK');
      console.error(`#${t.id}: ОШИБКА ${e.message}`);
    }
  }

  console.log('\n── итог по девяти:');
  const rows = (await pool.query(`
    SELECT id, status, amount, approval_channel FROM payment_invoices
     WHERE id IN (1,11,23,24,25,29,30,33,41) ORDER BY id`)).rows;
  let dir = 0, ok = 0;
  for (const r of rows) {
    const mark = r.status === 'pending_payment' ? (r.approval_channel === 'exception' ? 'к оплате (исключение)' : 'к оплате') : 'ждёт директора';
    if (r.status === 'awaiting_dir') dir++; else ok++;
    console.log(`  #${r.id} ${Number(r.amount).toLocaleString('ru-RU')} ₽ — ${mark}`);
  }
  console.log(`  итог: к оплате ${ok}, ждут директора ${dir}`);

  await pool.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
