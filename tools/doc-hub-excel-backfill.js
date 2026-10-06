#!/usr/bin/env node
'use strict';
/**
 * Backfill Excel Doc Hub batch:
 *  - НДС: «нет» → has_vat=false; иначе vat = gross*rate/(1+rate) (CRM 22%)
 *  - contract_label / contract_mode из merged-rows.json
 *  - doc_owner_id / pm_id из merged-rows (+ fio-remap-payload)
 *
 * Usage:
 *   node tools/doc-hub-excel-backfill.js            # dry-run
 *   APPLY=1 node tools/doc-hub-excel-backfill.js     # commit
 */
try { require('dotenv').config(); } catch (_) { /* optional */ }
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const APPLY = process.env.APPLY === '1';
const VAT_RATE = 0.22;
const BATCH_START = process.env.DOC_HUB_BATCH_START || '2026-10-05 18:22:00';
const BATCH_END = process.env.DOC_HUB_BATCH_END || '2026-10-05 18:23:00';
const OUT_DIR = path.join(__dirname, '..', 'tests', 'reports', 'doc-hub-excel');
const MERGED = process.env.DOC_HUB_MERGED || path.join(OUT_DIR, 'merged-rows.json');
const FIO = process.env.DOC_HUB_FIO || path.join(OUT_DIR, 'fio-remap-payload.json');

function esc(s) {
  return String(s || '').replace(/'/g, "''");
}

async function main() {
  const pool = new Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'asgard',
    password: process.env.PGPASSWORD || '123456789',
    database: process.env.PGDATABASE || 'asgard_crm'
  });

  const merged = JSON.parse(fs.readFileSync(MERGED, 'utf8'));
  console.log('merged rows', merged.length, 'APPLY', APPLY);

  const client = await pool.connect();
  try {
    const before = await client.query(
      `SELECT
         count(*)::int AS n,
         count(*) FILTER (WHERE has_vat AND COALESCE(vat_amount,0)=0 AND amount_gross>0)::int AS vat_zero,
         count(*) FILTER (WHERE contract_label IS NOT NULL AND contract_label<>'')::int AS with_label,
         count(*) FILTER (WHERE doc_owner_id IS NOT NULL)::int AS with_owner
       FROM doc_registry
       WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
         AND deleted_at IS NULL`,
      [BATCH_START, BATCH_END]
    );
    console.log('batch before', before.rows[0]);

    await client.query('BEGIN');

    // 1) Explicit NO-VAT from merged
    let noVat = 0;
    for (const r of merged) {
      if (r.has_vat !== false) continue;
      const inv = String(r.invoice_number || '').trim();
      const dt = String(r.invoice_date || '').slice(0, 10);
      if (!inv || !dt) continue;
      const q = await client.query(
        `UPDATE doc_registry
         SET has_vat = false, vat_rate = 0, vat_amount = 0,
             amount_net = amount_gross, updated_at = NOW()
         WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
           AND deleted_at IS NULL
           AND invoice_number = $3 AND invoice_date = $4::date`,
        [BATCH_START, BATCH_END, inv, dt]
      );
      noVat += q.rowCount;
    }
    console.log('no-vat updates', noVat);

    // 2) Compute VAT for remaining has_vat with zero vat
    const vatQ = await client.query(
      `UPDATE doc_registry
       SET
         vat_rate = $3::numeric,
         amount_net = ROUND((amount_gross / (1 + $3::numeric))::numeric, 2),
         vat_amount = ROUND((amount_gross - (amount_gross / (1 + $3::numeric)))::numeric, 2),
         updated_at = NOW()
       WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
         AND deleted_at IS NULL
         AND has_vat IS TRUE
         AND COALESCE(vat_amount,0) = 0
         AND COALESCE(amount_gross,0) > 0`,
      [BATCH_START, BATCH_END, VAT_RATE]
    );
    console.log('vat compute updates', vatQ.rowCount);

    // 3) contract_label
    let labels = 0;
    for (const r of merged) {
      const label = String(r.contract_label || '').trim();
      const inv = String(r.invoice_number || '').trim();
      const dt = String(r.invoice_date || '').slice(0, 10);
      if (!label || !inv || !dt) continue;
      const mode = r.contract_mode || 'linked';
      const q = await client.query(
        `UPDATE doc_registry
         SET contract_label = $5,
             contract_mode = CASE WHEN contract_mode = 'none' THEN $6 ELSE contract_mode END,
             updated_at = NOW()
         WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
           AND deleted_at IS NULL
           AND invoice_number = $3 AND invoice_date = $4::date
           AND (contract_label IS NULL OR contract_label = '')`,
        [BATCH_START, BATCH_END, inv, dt, label, mode]
      );
      labels += q.rowCount;
    }
    console.log('contract_label updates', labels);

    // 4) fio remap — prefer merged (full), then fio payload
    const fioMap = new Map();
    function key(inv, dt) { return `${inv}\t${dt}`; }
    for (const r of merged) {
      const inv = String(r.invoice_number || '').trim();
      const dt = String(r.invoice_date || '').slice(0, 10);
      if (!inv || !dt) continue;
      fioMap.set(key(inv, dt), {
        doc_owner_id: r.doc_owner_id || null,
        pm_id: r.work_pm_id || r.pm_id || null
      });
    }
    if (fs.existsSync(FIO)) {
      const fio = JSON.parse(fs.readFileSync(FIO, 'utf8'));
      for (const r of fio.rows || []) {
        const inv = String(r.invoice_number || '').trim();
        const dt = String(r.invoice_date || '').slice(0, 10);
        if (!inv || !dt) continue;
        const prev = fioMap.get(key(inv, dt)) || {};
        fioMap.set(key(inv, dt), {
          doc_owner_id: r.doc_owner_id || prev.doc_owner_id || null,
          pm_id: r.work_pm_id || r.pm_id || prev.pm_id || null
        });
      }
    }

    let fioN = 0;
    for (const [k, ids] of fioMap) {
      if (!ids.doc_owner_id && !ids.pm_id) continue;
      const [inv, dt] = k.split('\t');
      const sets = [];
      const params = [BATCH_START, BATCH_END, inv, dt];
      if (ids.doc_owner_id) {
        params.push(ids.doc_owner_id);
        sets.push(`doc_owner_id = $${params.length}`);
      }
      if (ids.pm_id) {
        params.push(ids.pm_id);
        sets.push(`pm_id = COALESCE(pm_id, $${params.length})`);
      }
      const q = await client.query(
        `UPDATE doc_registry
         SET ${sets.join(', ')}, updated_at = NOW()
         WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
           AND deleted_at IS NULL
           AND invoice_number = $3 AND invoice_date = $4::date`,
        params
      );
      fioN += q.rowCount;
    }
    console.log('fio updates', fioN);

    // 5) closing_json / receive_channel / vitya / delivery / contract flags — only if CRM empty
    let closingN = 0;
    let recvN = 0;
    let vityaN = 0;
    let metaN = 0;
    for (const r of merged) {
      const inv = String(r.invoice_number || '').trim();
      const dt = String(r.invoice_date || '').slice(0, 10);
      if (!inv || !dt) continue;
      const params = [BATCH_START, BATCH_END, inv, dt];
      const sets = [];

      const cj = Array.isArray(r.closing_json) ? r.closing_json : [];
      if (cj.length) {
        params.push(JSON.stringify(cj));
        sets.push(`closing_json = CASE
          WHEN closing_json IS NULL OR closing_json = '[]'::jsonb THEN $${params.length}::jsonb
          ELSE closing_json END`);
      }
      if (r.receive_channel) {
        params.push(String(r.receive_channel).trim());
        sets.push(`receive_channel = COALESCE(NULLIF(receive_channel,''), $${params.length})`);
      }
      if (r.vitya_state) {
        params.push(String(r.vitya_state).trim());
        sets.push(`vitya_state = COALESCE(NULLIF(vitya_state,''), $${params.length})`);
      }
      if (r.delivery_note) {
        params.push(String(r.delivery_note).trim());
        sets.push(`delivery_note = COALESCE(NULLIF(delivery_note,''), $${params.length})`);
      }
      if (r.delivery_due_at) {
        params.push(String(r.delivery_due_at).slice(0, 10));
        sets.push(`delivery_due_at = COALESCE(delivery_due_at, $${params.length}::date)`);
      }
      if (r.contract_date) {
        params.push(String(r.contract_date).slice(0, 10));
        sets.push(`contract_date = COALESCE(contract_date, $${params.length}::date)`);
      }
      if (r.contract_has_scan) {
        sets.push(`contract_has_scan = true`);
      }
      if (r.contract_has_original) {
        sets.push(`contract_has_original = true`);
      }
      if (r.counterparty_email) {
        params.push(String(r.counterparty_email).trim());
        sets.push(`counterparty_email = COALESCE(NULLIF(counterparty_email,''), $${params.length})`);
      }
      if (r.counterparty_phone) {
        params.push(String(r.counterparty_phone).trim());
        sets.push(`counterparty_phone = COALESCE(NULLIF(counterparty_phone,''), $${params.length})`);
      }
      if (r.reconciliation_note) {
        params.push(String(r.reconciliation_note).trim());
        sets.push(`reconciliation_note = COALESCE(NULLIF(reconciliation_note,''), $${params.length})`);
      }
      if (r.spend_kind) {
        params.push(String(r.spend_kind));
        sets.push(`spend_kind = COALESCE(spend_kind, $${params.length})`);
      }
      if (!sets.length) continue;
      const q = await client.query(
        `UPDATE doc_registry
         SET ${sets.join(', ')}, updated_at = NOW()
         WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
           AND deleted_at IS NULL
           AND invoice_number = $3 AND invoice_date = $4::date`,
        params
      );
      if (cj.length) closingN += q.rowCount;
      if (r.receive_channel) recvN += q.rowCount;
      if (r.vitya_state) vityaN += q.rowCount;
      metaN += q.rowCount;
    }
    console.log('closing/recv/vitya/meta updates', { closingN, recvN, vityaN, metaN });

    const after = await client.query(
      `SELECT
         count(*) FILTER (WHERE has_vat AND COALESCE(vat_amount,0)=0 AND amount_gross>0)::int AS vat_zero,
         count(*) FILTER (WHERE has_vat AND vat_amount > 0)::int AS vat_ok,
         count(*) FILTER (WHERE NOT has_vat)::int AS no_vat,
         count(*) FILTER (WHERE contract_label IS NOT NULL AND contract_label<>'')::int AS with_label,
         count(*) FILTER (WHERE doc_owner_id IS NOT NULL)::int AS with_owner,
         count(*) FILTER (WHERE pm_id IS NOT NULL)::int AS with_pm,
         count(*) FILTER (WHERE closing_json IS NOT NULL AND closing_json <> '[]'::jsonb)::int AS with_closing,
         count(*) FILTER (WHERE receive_channel IS NOT NULL AND receive_channel<>'')::int AS with_recv
       FROM doc_registry
       WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
         AND deleted_at IS NULL`,
      [BATCH_START, BATCH_END]
    );
    console.log('batch after', after.rows[0]);

    const sample = await client.query(
      `SELECT id, invoice_number, amount_gross::text, amount_net::text, vat_amount::text, has_vat, left(coalesce(contract_label,''),40) AS label
       FROM doc_registry
       WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
         AND deleted_at IS NULL AND has_vat AND vat_amount > 0
       ORDER BY id LIMIT 5`,
      [BATCH_START, BATCH_END]
    );
    console.log('sample', sample.rows);

    if (APPLY) {
      await client.query('COMMIT');
      console.log('COMMITTED');
    } else {
      await client.query('ROLLBACK');
      console.log('DRY-RUN rolled back. APPLY=1 to commit.');
    }
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
