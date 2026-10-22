'use strict';
/**
 * D-342/D-343: исправление данных на проде (22.10.2026).
 *  1. Заявка #27 «Комус»: файл и позиции из родственного письма треда (#4992).
 *  2. Зависшее согласие grant #1 (20.10) — погасить как отработанное.
 *  3. Заявка #11 «ТСИ»: позиций нет и взять негде (файл есть, разбор пуст) — пометить.
 */
const ROOT = '/var/www/asgard-crm';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');
const fs = require('fs');

const APPLY = process.argv.includes('--apply');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);
  console.log(`РЕЖИМ: ${APPLY ? 'ПРИМЕНЕНИЕ' : 'dry-run'}\n`);

  // ── 1. Заявка #27 «Комус» ─────────────────────────────────────────────
  console.log('=== 1. ЗАЯВКА #27 «Комус» (без файла и без позиций) ===');
  const pi = (await q(`SELECT * FROM payment_invoices WHERE id=27`))[0];
  console.log(`  сумма ${pi.amount}, doc=${pi.doc_registry_id}, письмо=${pi.source_email_id}`);
  // Ищем вложение в треде письма-источника.
  const att = (await q(`
      SELECT a.id, a.filename, a.original_filename, a.file_path, a.mime_type, e.id AS src_email
        FROM emails src
        JOIN emails e ON e.thread_id = src.thread_id AND e.id <> src.id
        JOIN email_attachments a ON a.email_id = e.id
       WHERE src.id = $1 AND a.mime_type ILIKE '%pdf%'
       ORDER BY e.email_date ASC LIMIT 1`, [pi.source_email_id]))[0];
  if (!att) {
    console.log('  → в треде вложений не найдено');
  } else {
    console.log(`  нашли счёт в письме #${att.src_email}: ${att.original_filename || att.filename}`);
    const full = '/var/www/asgard-crm/' + String(att.file_path).replace(/^\/?uploads\//, 'uploads/');
    console.log(`  файл на диске: ${fs.existsSync(full) ? 'ДА' : 'НЕТ'} (${full})`);
    if (APPLY && fs.existsSync(full)) {
      // Файл + имя в заявку
      await q(`UPDATE payment_invoices
                 SET file_path=$1, file_name=$2, updated_at=NOW()
               WHERE id=27 AND (file_path IS NULL OR file_path='')`,
        ['/' + String(att.file_path).replace(/^\/?uploads\//, 'uploads/'),
          att.original_filename || att.filename]);
      // Путь в документ реестра
      await q(`UPDATE doc_registry SET original_path_url=$1, updated_at=NOW()
               WHERE id=$2 AND (original_path_url IS NULL OR original_path_url='')`,
        [att.file_path, pi.doc_registry_id]);
      console.log('  ✓ файл привязан к заявке и документу');
    }
  }

  // ── 2. Зависшее согласие ──────────────────────────────────────────────
  console.log('\n=== 2. ЗАВИСШИЕ СОГЛАСИЯ (старше 72ч) ===');
  const stale = await q(`SELECT id, email_id, thread_key, created_at FROM doc_approval_grant
      WHERE applied_at IS NULL AND created_at <= NOW() - INTERVAL '72 hours'`);
  if (!stale.length) console.log('  → нет');
  for (const g of stale) {
    console.log(`  grant #${g.id} от ${String(g.created_at).slice(0,16)} (письмо ${g.email_id}) — погашаю`);
    if (APPLY) {
      await q(`UPDATE doc_approval_grant
                 SET applied_at=NOW(), comment=COALESCE(comment,'') || ' [просрочено, погашено вручную D-342]'
               WHERE id=$1 AND applied_at IS NULL`, [g.id]);
    }
  }
  // Отдельно: согласие, чья заявка уже решена (как grant #1 → заявка #8).
  const resolved = await q(`SELECT g.id, g.email_id, g.thread_key, pi.id pi_id, pi.status
      FROM doc_approval_grant g
      JOIN emails e ON e.thread_id = g.thread_key
      JOIN payment_invoices pi ON pi.source_email_id = e.id
     WHERE g.applied_at IS NULL`);
  console.log('\n  согласия, чьи заявки уже решены:');
  if (!resolved.length) console.log('   → нет');
  for (const r of resolved) {
    if (['pending_payment', 'paid', 'rejected'].includes(r.status)) {
      console.log(`   grant #${r.id} → заявка #${r.pi_id} уже ${r.status} — погашаю`);
      if (APPLY) {
        await q(`UPDATE doc_approval_grant
                   SET applied_at=NOW(), comment=COALESCE(comment,'') || ' [заявка #' || $2 || ' уже ' || $3 || ']'
                 WHERE id=$1 AND applied_at IS NULL`, [r.id, r.pi_id, r.status]);
      }
    }
  }

  // Сироты: согласие есть, но в его треде НЕТ ни одной заявки. Такое согласие
  // отработало «в пустоту» (заявка родилась из другого письма) и висит грузом:
  // первый же новый счёт в этом треде согласуется молча. Гасим.
  const orphans = await q(`SELECT g.id, g.email_id, g.thread_key, g.created_at
      FROM doc_approval_grant g
     WHERE g.applied_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM emails e JOIN payment_invoices pi ON pi.source_email_id = e.id
          WHERE e.thread_id = g.thread_key)
       AND g.created_at <= NOW() - INTERVAL '6 hours'`);
  console.log('\n  согласия-сироты (в треде нет заявок, старше 6ч):');
  if (!orphans.length) console.log('   → нет');
  for (const o of orphans) {
    console.log(`   grant #${o.id} (письмо ${o.email_id}, ${String(o.created_at).slice(0, 16)}) — погашаю как отработавшее`);
    if (APPLY) {
      await q(`UPDATE doc_approval_grant
                 SET applied_at=NOW(),
                     comment=COALESCE(comment,'') || ' [сирота: в треде нет заявок, погашено D-342]'
               WHERE id=$1 AND applied_at IS NULL`, [o.id]);
    }
  }

  // ── 3. Заявка #11 «ТСИ» ───────────────────────────────────────────────
  console.log('\n=== 3. ЗАЯВКА #11 «ТСИ»: позиций нет ===');
  const p11 = (await q(`SELECT id, amount, file_path, line_items_json FROM payment_invoices WHERE id=11`))[0];
  console.log(`  сумма ${p11.amount}, файл=${p11.file_path ? 'есть' : 'нет'}, позиций=${(p11.line_items_json || []).length}`);

  console.log(`\n${APPLY ? 'ГОТОВО' : 'это dry-run, для применения: --apply'}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
