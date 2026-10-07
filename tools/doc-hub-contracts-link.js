'use strict';
/**
 * D-239: договоры и статусы доставки.
 *  - мусорные метки («Нет», «---», «б/н» …) → contract_mode='none' (без договора);
 *  - из чистых меток создаём карточки в contracts и связываем doc_registry.contract_id;
 *  - статус доставки (vitya_state): свободный текст → чистое значение + текст уходит
 *    в delivery_note (ничего не теряем).
 * DRY по умолчанию. APPLY=1 — коммит.
 */
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config({ path: '/var/www/asgard-crm/.env' });

const APPLY = process.env.APPLY === '1';
const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'asgard', password: String(process.env.DB_PASSWORD || '123456789'),
  database: process.env.DB_NAME || 'asgard_crm'
});
const q = (t, p) => pool.query(t, p);
const N = (v) => Number(v || 0);
const JUNK = ['нет', '---', '-', '—', 'без договора', 'б/н', 'отсутствует'];

const report = { apply: APPLY, junk: {}, contracts: {}, delivery: {} };

async function secJunk() {
  const rows = (await q(`
    SELECT id, contract_label FROM doc_registry
    WHERE deleted_at IS NULL AND lower(trim(contract_label)) = ANY($1::text[])`, [JUNK])).rows;
  report.junk = { docs: rows.length, labels: [...new Set(rows.map((r) => r.contract_label))] };
  if (!APPLY) return;
  await q(`UPDATE doc_registry SET contract_mode='none', contract_label=NULL, contract_id=NULL, updated_at=NOW()
           WHERE deleted_at IS NULL AND lower(trim(contract_label)) = ANY($1::text[])`, [JUNK]);
}

async function secContracts() {
  // Чистые метки с контрагентом (по supplier_id) — уникальная пара
  const labels = (await q(`
    SELECT TRIM(d.contract_label) AS label, d.supplier_id, s.name AS supplier_name, s.inn,
           count(*)::int docs,
           min(d.invoice_date)::text AS d1, max(d.invoice_date)::text AS d2,
           sum(d.amount_gross)::numeric AS total
    FROM doc_registry d LEFT JOIN suppliers s ON s.id = d.supplier_id
    WHERE d.deleted_at IS NULL AND COALESCE(TRIM(d.contract_label),'') <> ''
      AND lower(trim(d.contract_label)) <> ALL($1::text[])
    GROUP BY 1,2,3,4 ORDER BY 5 DESC`, [JUNK])).rows.map((r) => ({ ...r, docs: N(r.docs) }));

  const plan = [];
  for (const l of labels) {
    const existing = (await q(
      `SELECT id FROM contracts WHERE number = $1 AND COALESCE(counterparty_id,'') = COALESCE($2,'') AND COALESCE(work_id,0)=0 LIMIT 1`,
      [l.label, l.inn || (l.supplier_id ? String(l.supplier_id) : null)])).rows[0];
    plan.push({ label: l.label, supplier: l.supplier_name, supplier_id: l.supplier_id, inn: l.inn, docs: l.docs, total: Number(l.total || 0), work_id: null, contract_id: existing ? existing.id : null, create: !existing });
  }
  report.contracts = { labels: plan.length, to_create: plan.filter((p) => p.create).length, to_link_docs: plan.reduce((s, p) => s + p.docs, 0), plan };
  if (!APPLY) return;

  for (const p of plan) {
    let cid = p.contract_id;
    if (!cid) {
      const c = await q(
        `INSERT INTO contracts (number, type, counterparty_id, counterparty_name, customer_name, customer_inn,
           status, currency, vat_pct, is_perpetual, is_indefinite, comment, created_by)
         VALUES ($1,'supplier',$2,$3,$3,$4,'active','RUB',20,false,false,$5,1) RETURNING id`,
        [p.label, p.inn || null, p.supplier || '—', p.inn || null,
         'Импорт из реестра Doc Hub (D-239): ' + p.docs + ' док. на ' + Math.round(p.total) + ' ₽']);
      cid = c.rows[0].id;
    }
    await q(`UPDATE doc_registry SET contract_id=$1, updated_at=NOW()
             WHERE deleted_at IS NULL AND COALESCE(TRIM(contract_label),'')=$2
               AND COALESCE(supplier_id,-1) = COALESCE($3,-1)`, [cid, p.label, p.supplier_id || null]);
  }
}

// Статус доставки: свободный текст → enum + текст в delivery_note
const DONE_RE = /^(выполнено|выполнен|завершено|завершён|доставлено|перевозка осуществлена|получен по эдо)/i;
const CANCEL_RE = /(отмен[аё]н|отмена счета|заказ отменен|отказ)/i;
async function secDelivery() {
  const rows = (await q(`
    SELECT id, vitya_state, COALESCE(delivery_note,'') note FROM doc_registry
    WHERE deleted_at IS NULL AND COALESCE(TRIM(vitya_state),'') <> ''`)).rows;
  const buckets = { done: 0, cancelled: 0, in_progress: 0 };
  const updates = [];
  for (const r of rows) {
    const v = String(r.vitya_state).trim();
    let clean;
    if (DONE_RE.test(v)) { clean = 'выполнено'; buckets.done++; }
    else if (CANCEL_RE.test(v)) { clean = 'отменено'; buckets.cancelled++; }
    else { clean = 'в работе'; buckets.in_progress++; }
    // свободный текст сохраняем в delivery_note, если он отличается от значения
    const keepNote = v !== clean && !r.note.includes(v) ? (r.note ? r.note + ' | ' + v : v) : r.note;
    if (clean !== v || keepNote !== r.note) updates.push({ id: r.id, clean, note: keepNote || null });
  }
  report.delivery = { docs: rows.length, buckets, changed: updates.length };
  if (!APPLY) return;
  for (const u of updates) {
    await q('UPDATE doc_registry SET vitya_state=$1, delivery_note=$2, updated_at=NOW() WHERE id=$3', [u.clean, u.note, u.id]);
  }
}

(async () => {
  await secJunk();
  await secContracts();
  await secDelivery();
  fs.writeFileSync('/tmp/dh-audit/contracts-report.json', JSON.stringify(report, null, 1));
  console.log(JSON.stringify({
    apply: report.apply,
    junk_docs: report.junk.docs, junk_labels: report.junk.labels,
    contract_labels: report.contracts.labels, to_create: report.contracts.to_create, to_link_docs: report.contracts.to_link_docs,
    delivery: report.delivery
  }, null, 1));
  await pool.end();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
