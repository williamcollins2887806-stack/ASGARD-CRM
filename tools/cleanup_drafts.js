/**
 * D-366: ежедневная очистка заброшенных черновиков заявок.
 * Черновик = заявка, созданная и брошенная (не отправлена директору).
 * Без чистки мусор копится, человек видит «черновик заявки» и путается.
 *
 * ВАЖНО: черновик НЕ создаёт строку в реестре (проверено). Поэтому чистка
 * касается только очереди заявок, а не реестра счетов.
 */
const ROOT = '/var/www/asgard-crm';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');

const APPLY = process.argv.includes('--apply');
const HOURS = parseInt(process.env.DOC_DRAFT_TTL_HOURS || '168', 10);

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);
  console.log(`[draft-cleanup] порог: ${HOURS}ч, режим: ${APPLY ? 'ПРИМЕНЕНИЕ' : 'dry-run'}`);

  const rows = await q(`
      SELECT id, supplier_name, amount, created_by, created_at
        FROM payment_invoices
       WHERE status='draft'
         AND COALESCE(doc_registry_id, 0) = 0
         AND created_at < NOW() - ($1 || ' hours')::interval
       ORDER BY id`, [String(HOURS)]);

  console.log(`[draft-cleanup] найдено брошенных: ${rows.length}`);
  for (const r of rows.slice(0, 10))
    console.log(`  #${r.id} ${String(r.amount).padStart(10)} | ${String(r.supplier_name || 'без поставщика').slice(0, 30)} | создан ${String(r.created_at).slice(0, 16)}`);

  if (!APPLY) { console.log('[draft-cleanup] dry-run — ничего не меняю'); await c.end(); return; }

  let n = 0;
  for (const r of rows) {
    await q(`UPDATE payment_invoices SET status='rejected', updated_at=NOW()
             WHERE id=$1 AND status='draft'`, [r.id]);
    n++;
  }
  console.log(`[draft-cleanup] закрыто: ${n}`);
  const left = (await q(`SELECT count(*)::int n FROM payment_invoices WHERE status='draft'`))[0];
  console.log(`[draft-cleanup] осталось активных черновиков: ${left.n}`);
  await c.end();
})().catch((e) => { console.error('[draft-cleanup] ERR', e.message); process.exit(1); });
