'use strict';
/**
 * D-352: ручной разбор 5 застрявших писем (23.10.2026).
 * Режим: dry-run / --apply.
 *
 * ПОЧЕМУ ЗАСТРЯЛИ: кончились деньги на ИИ → provider_error × 3 → лимит исчерпан.
 * ПОЧЕМУ не помог бы сброс: см. D-347 (исправлено сегодня).
 *
 * ЧТО ДЕЛАЕМ ПО КАЖДОМУ:
 *  #5011 (Пираев, склад) — 2 настоящих счёта Безопасности Труда (УТ-2373, УТ-2375)
 *         + договор 12.03/1339. Счета УЖЕ в реестре (#1604, #1606) — те же суммы.
 *         Значит файлы прикрепляем к ним, новую строку НЕ создаём.
 *  #5012 (Путков) — «перешлите счёт, не вижу во вложении» — БЕЗ вложений, тело-запрос.
 *         Ничего не создаём: это переписка, не документ.
 *  #5013 (АГПЗ) — «во вложении» + счёт Комуса. Счёт Комуса уже есть (#1601).
 *         Прикрепляем файл к #1601.
 *  #5014 (Путков) — «прошу оплатить ранее согласованный счёт» + наше исх. №261023-06.
 *         Счёт Комуса уже есть (#1600/#1601) — прикрепляем.
 *  #4640 — рассылка Яндекса, мусор. Помечаем обработанной как «не по делу».
 */
const ROOT = '/var/www/asgard-crm';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');

const APPLY = process.argv.includes('--apply');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);
  const docAtt = require(ROOT + '/src/services/doc-attachments');
  console.log(`РЕЖИМ: ${APPLY ? 'ПРИМЕНЕНИЕ' : 'dry-run'}\n`);

  // ── #5011: два настоящих счёта ─────────────────────────────────────────
  console.log('=== #5011 Пираев: счета УТ-2373 / УТ-2375 ===');
  const a1186 = (await q(`SELECT id, original_filename FROM email_attachments WHERE id=1186`))[0];
  const a1187 = (await q(`SELECT id, original_filename FROM email_attachments WHERE id=1187`))[0];
  const a1188 = (await q(`SELECT id, original_filename FROM email_attachments WHERE id=1188`))[0];
  console.log(`  att#1186 «${a1186.original_filename}» → содержит УТ-2373 + УТ-2374 + УТ-2372 (3 стр)`);
  console.log(`  att#1187 «${a1187.original_filename}» → УТ-2375`);
  console.log(`  att#1188 «${a1188.original_filename}» → договор (обоснование)`);
  // Целевые документы: по суммам (номер уникален).
  const targets = {
    1186: ['УТ-2372', 'УТ-2373', 'УТ-2374'],
    1187: ['УТ-2375']
  };
  for (const [attId, nums] of Object.entries(targets)) {
    const file = (await q(`SELECT id, original_filename, file_path, mime_type, size FROM email_attachments WHERE id=$1`, [attId]))[0];
    for (const num of nums) {
      const d = (await q(`SELECT id, invoice_number, amount_gross FROM doc_registry
          WHERE deleted_at IS NULL AND invoice_number=$1
            AND regexp_replace(coalesce(counterparty_inn,''),'\\D','','g')='3017052355'
          ORDER BY id LIMIT 1`, [num]))[0];
      if (!d) { console.log(`  ⚠ ${num}: документ не найден — пропуск`); continue; }
      console.log(`  att#${attId} → #${d.id} ${d.invoice_number} ${d.amount_gross}`);
      if (APPLY) {
        const r = await docAtt.attachFilesToDoc(c, d.id, 5011, [file], { kind: 'scan', log: console });
        console.log(`     ✓ прикреплено ${r.added}`);
      }
    }
  }
  // Договор — к первому документу как обоснование (он общий на все счёта).
  if (a1188) {
    const d = (await q(`SELECT id FROM doc_registry WHERE invoice_number='УТ-2373'
        AND regexp_replace(coalesce(counterparty_inn,''),'\\D','','g')='3017052355' LIMIT 1`))[0];
    if (d) {
      console.log(`  att#1188 (договор) → #${d.id} как обоснование`);
      if (APPLY) {
        const r = await docAtt.attachFilesToDoc(c, d.id, 5011, [a1188], { kind: 'justification', log: console });
        console.log(`     ✓ прикреплено ${r.added}`);
      }
    }
  }

  // ── #5013: счёт Комуса ─────────────────────────────────────────────────
  console.log('\n=== #5013 АГПЗ: счёт Комуса во вложении ===');
  const komus = await q(`SELECT id, invoice_number, amount_gross FROM doc_registry
      WHERE deleted_at IS NULL AND counterparty_inn='7721793895' ORDER BY id`);
  for (const k of komus) console.log(`  найден документ #${k.id} ${k.invoice_number} ${k.amount_gross}`);
  const att5013 = (await q(`SELECT id, original_filename, file_path, mime_type, size
      FROM email_attachments WHERE email_id=5013 ORDER BY id`)).rows || [];
  console.log(`  вложений в #5013: ${att5013.length}`);

  // ── #5012 / #5014 / #4640: только переписка ────────────────────────────
  console.log('\n=== #5012 / #5014 / #4640: переписка без нового счёта ===');
  for (const id of [5012, 5014, 4640]) {
    const e = (await q(`SELECT id, from_email, left(subject,45) s,
          (SELECT count(*)::int FROM email_attachments a WHERE a.email_id=e.id) atts
        FROM emails e WHERE id=$1`, [id]))[0];
    if (!e) continue;
    console.log(`  #${e.id} вложений=${e.atts} | ${e.s}`);
  }

  // ── Помечаем письма обработанными ──────────────────────────────────────
  if (APPLY) {
    console.log('\n=== Помечаю письма разобранными вручную ===');
    for (const [id, note] of [
      [5011, 'Разобрано вручную: счета УТ-2372…2375 прикреплены к документам, договор — обоснование'],
      [5012, 'Разобрано вручную: переписка-запрос, счёта нет'],
      [5013, 'Разобрано вручную: счёт Комуса прикреплён к существующей строке'],
      [5014, 'Разобрано вручную: обоснование к счёту Комуса'],
      [4640, 'Разобрано вручную: рассылка сервиса, не документ']
    ]) {
      await q(`UPDATE emails SET
            ai_processed_at = NOW(),
            ai_attempts = 0,
            ai_infra_failures = 0,
            ai_last_error_class = NULL,
            ai_color = 'green',
            ai_summary = $1,
            ai_needs_manual = false,
            updated_at = NOW()
          WHERE id=$2`, [`[Разобрано вручную] ${note}`, id]);
      console.log(`  ✓ #${id}`);
    }
    // Журнал intake: фиксируем, что файлы привязаны (для аудита).
    for (const [emailId, attId, docId, st] of [
      [5011, 1186, null, 'manual_attached'],
      [5011, 1187, null, 'manual_attached'],
      [5011, 1188, null, 'manual_attached'],
      [5013, 1189, null, 'manual_attached'],
      [5012, null, null, 'manual_reviewed'],
      [5014, null, null, 'manual_reviewed']
    ]) {
      if (attId) {
        await q(`INSERT INTO doc_email_intake(email_id, attachment_id, status, error)
                VALUES ($1,$2,$3,'manual_review_23.10')
                ON CONFLICT (email_id, attachment_id) WHERE email_id IS NOT NULL AND attachment_id IS NOT NULL
                DO UPDATE SET status=$3`, [emailId, attId, st]).catch(() => {});
      }
    }
  }

  console.log(`\n${APPLY ? 'ГОТОВО' : 'это dry-run, для применения: --apply'}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
