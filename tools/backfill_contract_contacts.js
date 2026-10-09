#!/usr/bin/env node
'use strict';
/**
 * Backfill контактов договоров из карточек контрагентов (suppliers).
 *
 * Требование: у существующих договоров поля контактов пустые — заполняем из
 * карточки контрагента (by ИНН = contracts.counterparty_id, иначе по имени),
 * при пустых в карточке — из последнего документа реестра (doc_registry).
 *
 * Правила:
 *  - заполняем ТОЛЬКО пустые contact_* договора;
 *  - в карточку ничего не пишем (только читаем) — источник истины уже есть;
 *  - идемпотентно.
 *
 * Usage (на проде: cd /var/www/asgard-crm):
 *   node tools/backfill_contract_contacts.js          # dry-run
 *   APPLY=1 node tools/backfill_contract_contacts.js  # запись
 */
const { Pool } = require('pg');

const APPLY = process.env.APPLY === '1';

// Для каждого договора: телефон/почта из карточки (по ИНН), иначе из документов
const PICK = `
WITH pick AS (
  SELECT c.id,
    COALESCE(
      (SELECT NULLIF(TRIM(s.phone),'') FROM suppliers s
        WHERE s.deleted_at IS NULL
          AND ( (COALESCE(TRIM(c.counterparty_id),'')<>'' AND btrim(s.inn)=btrim(c.counterparty_id))
             OR (COALESCE(TRIM(c.counterparty_name),'')<>'' AND lower(btrim(s.name))=lower(btrim(c.counterparty_name))) )
          AND COALESCE(TRIM(s.phone),'')<>''
        ORDER BY (btrim(s.inn)=btrim(c.counterparty_id)) DESC NULLS LAST LIMIT 1),
      (SELECT NULLIF(TRIM(d.counterparty_phone),'') FROM doc_registry d
        WHERE d.deleted_at IS NULL AND COALESCE(TRIM(c.counterparty_name),'')<>''
          AND lower(btrim(d.counterparty_name))=lower(btrim(c.counterparty_name))
          AND COALESCE(TRIM(d.counterparty_phone),'')<>''
        ORDER BY d.invoice_date DESC NULLS LAST, d.id DESC LIMIT 1)
    ) AS phone,
    COALESCE(
      (SELECT NULLIF(TRIM(s.email),'') FROM suppliers s
        WHERE s.deleted_at IS NULL
          AND ( (COALESCE(TRIM(c.counterparty_id),'')<>'' AND btrim(s.inn)=btrim(c.counterparty_id))
             OR (COALESCE(TRIM(c.counterparty_name),'')<>'' AND lower(btrim(s.name))=lower(btrim(c.counterparty_name))) )
          AND COALESCE(TRIM(s.email),'')<>''
        ORDER BY (btrim(s.inn)=btrim(c.counterparty_id)) DESC NULLS LAST LIMIT 1),
      (SELECT NULLIF(TRIM(d.counterparty_email),'') FROM doc_registry d
        WHERE d.deleted_at IS NULL AND COALESCE(TRIM(c.counterparty_name),'')<>''
          AND lower(btrim(d.counterparty_name))=lower(btrim(c.counterparty_name))
          AND COALESCE(TRIM(d.counterparty_email),'')<>''
        ORDER BY d.invoice_date DESC NULLS LAST, d.id DESC LIMIT 1)
    ) AS email,
    (SELECT NULLIF(TRIM(s.name),'') FROM suppliers s
       WHERE s.deleted_at IS NULL
         AND ( (COALESCE(TRIM(c.counterparty_id),'')<>'' AND btrim(s.inn)=btrim(c.counterparty_id))
            OR (COALESCE(TRIM(c.counterparty_name),'')<>'' AND lower(btrim(s.name))=lower(btrim(c.counterparty_name))) )
       LIMIT 1) AS sup_name
  FROM contracts c
)`;

async function state(client) {
  return (await client.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE COALESCE(TRIM(contact_phone),'')<>'')::int AS with_phone,
           count(*) FILTER (WHERE COALESCE(TRIM(contact_email),'')<>'')::int AS with_email
      FROM contracts`)).rows[0];
}

async function main() {
  const pool = new Pool({
    host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'asgard', password: process.env.PGPASSWORD || '123456789',
    database: process.env.PGDATABASE || 'asgard_crm'
  });
  const client = await pool.connect();
  try {
    console.log('APPLY =', APPLY);
    console.log('before:', await state(client));
    await client.query('BEGIN');

    const plan = (await client.query(`${PICK}
      SELECT count(*) FILTER (WHERE COALESCE(TRIM(c.contact_phone),'')='' AND p.phone IS NOT NULL)::int AS phone_to_fill,
             count(*) FILTER (WHERE COALESCE(TRIM(c.contact_email),'')='' AND p.email IS NOT NULL)::int AS email_to_fill,
             count(*) FILTER (WHERE (COALESCE(TRIM(c.contact_phone),'')='' AND p.phone IS NULL)
                                 AND (COALESCE(TRIM(c.contact_email),'')='' AND p.email IS NULL))::int AS no_source
        FROM contracts c JOIN pick p ON p.id = c.id`)).rows[0];
    console.log('plan  :', plan);

    const sample = (await client.query(`${PICK}
      SELECT c.id, c.number, c.counterparty_name, p.phone, p.email
        FROM contracts c JOIN pick p ON p.id = c.id
       WHERE (COALESCE(TRIM(c.contact_phone),'')='' AND p.phone IS NOT NULL)
          OR (COALESCE(TRIM(c.contact_email),'')='' AND p.email IS NOT NULL)
       ORDER BY c.id LIMIT 6`)).rows;
    console.log('sample:');
    for (const r of sample) console.log('   #' + r.id, r.number, '|', r.counterparty_name, '|', JSON.stringify(r.phone), JSON.stringify(r.email));

    const upd = await client.query(`${PICK}
      UPDATE contracts c
         SET contact_phone = COALESCE(NULLIF(TRIM(c.contact_phone), ''), p.phone),
             contact_email = COALESCE(NULLIF(TRIM(c.contact_email), ''), p.email)
        FROM pick p
       WHERE c.id = p.id
         AND ( (COALESCE(TRIM(c.contact_phone),'')='' AND p.phone IS NOT NULL)
            OR (COALESCE(TRIM(c.contact_email),'')='' AND p.email IS NOT NULL) )`);
    console.log('updated rows:', upd.rowCount);
    console.log('after :', await state(client));

    if (APPLY) { await client.query('COMMIT'); console.log('COMMITTED'); }
    else { await client.query('ROLLBACK'); console.log('DRY-RUN: откатано. APPLY=1 для записи.'); }
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally { client.release(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
