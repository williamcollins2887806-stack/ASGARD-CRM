#!/usr/bin/env node
'use strict';
/**
 * Backfill suppliers.phone / suppliers.email из документов реестра.
 *
 * Зачем: при импорте реестра контакты писались в сам документ
 * (doc_registry.counterparty_phone/email), а карточку suppliers не заполняли —
 * поэтому в карточках пусто (1 из 457), хотя в документах есть.
 *
 * Правила:
 *  - заполняем ТОЛЬКО пустые поля (COALESCE — существующее не трогаем);
 *  - источник: документ, привязанный по supplier_id (приоритет), иначе —
 *    по совпадению названия контрагента (lower(trim(...)));
 *  - берём ЗНАЧЕНИЕ ИЗ ПОСЛЕДНЕГО документа (invoice_date DESC NULLS LAST, id DESC);
 *  - идемпотентно: повторный прогон ничего не меняет.
 *
 * Usage:
 *   node tools/backfill_supplier_contacts.js            # dry-run (ROLLBACK)
 *   APPLY=1 node tools/backfill_supplier_contacts.js    # commit
 *
 * На проде запускать на сервере: cd /var/www/asgard-crm && node tools/backfill_supplier_contacts.js
 */
const { Pool } = require('pg');

const APPLY = process.env.APPLY === '1';

// Оценка «правдоподобности» значения из документа:
//  - телефон: не «число с разделителями тысяч» (артефакт Excel: 79,217,578,197),
//    минимум 5 цифр; допускаем форматы, доб., скобки;
//  - email: одна @, домен с точкой, без пробелов.
const PHONE_OK = `
    AND NULLIF(TRIM(d.counterparty_phone), '') IS NOT NULL
    AND d.counterparty_phone !~ '^[0-9]{1,3}(,[0-9]{3})+$'
    AND length(regexp_replace(d.counterparty_phone, '\\D', '', 'g')) >= 5`;
const EMAIL_OK = `
    AND NULLIF(TRIM(d.counterparty_email), '') IS NOT NULL
    AND d.counterparty_email ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`;

const SRC_MATCH = `
        AND ( d.supplier_id = s.id
              OR ( COALESCE(TRIM(d.counterparty_name), '') <> ''
                   AND lower(TRIM(d.counterparty_name)) = lower(TRIM(s.name)) ) )`;

const PICK_CTE = `
WITH pick AS (
  SELECT s.id AS supplier_id, s.name,
    (SELECT NULLIF(TRIM(d.counterparty_phone), '')
       FROM doc_registry d
      WHERE d.deleted_at IS NULL${SRC_MATCH}${PHONE_OK}
      ORDER BY (d.supplier_id = s.id) DESC, d.invoice_date DESC NULLS LAST, d.id DESC
      LIMIT 1) AS phone,
    (SELECT NULLIF(TRIM(d.counterparty_email), '')
       FROM doc_registry d
      WHERE d.deleted_at IS NULL${SRC_MATCH}${EMAIL_OK}
      ORDER BY (d.supplier_id = s.id) DESC, d.invoice_date DESC NULLS LAST, d.id DESC
      LIMIT 1) AS email
  FROM suppliers s
  WHERE s.deleted_at IS NULL
)`;

const TARGETS_WHERE = `
  (COALESCE(TRIM(s.phone), '') = '' AND p.phone IS NOT NULL)
  OR (COALESCE(TRIM(s.email), '') = '' AND p.email IS NOT NULL)`;

async function main() {
  const pool = new Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'asgard',
    password: process.env.PGPASSWORD || '123456789',
    database: process.env.PGDATABASE || 'asgard_crm'
  });
  const client = await pool.connect();
  try {
    const stats = async () => (await client.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE COALESCE(TRIM(phone),'') <> '')::int AS with_phone,
             count(*) FILTER (WHERE COALESCE(TRIM(email),'') <> '')::int AS with_email
        FROM suppliers WHERE deleted_at IS NULL`)).rows[0];

    const plan = async () => (await client.query(`
      ${PICK_CTE}
      SELECT count(*) FILTER (WHERE COALESCE(TRIM(s.phone),'') = '' AND p.phone IS NOT NULL)::int AS phone_to_fill,
             count(*) FILTER (WHERE COALESCE(TRIM(s.email),'') = '' AND p.email IS NOT NULL)::int AS email_to_fill,
             count(*) FILTER (WHERE (COALESCE(TRIM(s.phone),'') = '' AND p.phone IS NULL)
                                 AND (COALESCE(TRIM(s.email),'') = '' AND p.email IS NULL))::int AS no_source
        FROM suppliers s JOIN pick p ON p.supplier_id = s.id
       WHERE s.deleted_at IS NULL`)).rows[0];

    console.log('APPLY =', APPLY);
    console.log('before:', await stats());
    console.log('plan  :', await plan());

    // Примеры: 5 карточек, которым заполним контакты
    const sample = (await client.query(`
      ${PICK_CTE}
      SELECT s.id, s.name, p.phone, p.email
        FROM suppliers s JOIN pick p ON p.supplier_id = s.id
       WHERE s.deleted_at IS NULL
         AND ( (COALESCE(TRIM(s.phone),'') = '' AND p.phone IS NOT NULL)
            OR (COALESCE(TRIM(s.email),'') = '' AND p.email IS NOT NULL) )
       ORDER BY s.name LIMIT 5`)).rows;
    console.log('sample (5 из плана):');
    for (const r of sample) console.log('   #' + r.id, r.name, '| phone:', JSON.stringify(r.phone), '| email:', JSON.stringify(r.email));

    await client.query('BEGIN');
    const upd = await client.query(`
      ${PICK_CTE}
      UPDATE suppliers s
         SET phone = COALESCE(NULLIF(TRIM(s.phone), ''), p.phone),
             email = COALESCE(NULLIF(TRIM(s.email), ''), p.email),
             updated_at = NOW()
        FROM pick p
       WHERE s.id = p.supplier_id
         AND (${TARGETS_WHERE})`);
    console.log('updated rows:', upd.rowCount);
    const after = await stats();
    console.log('after :', after);

    // Осталось совсем без контактов (ни телефона, ни почты) — их нет в документах
    const both = (await client.query(`
      SELECT count(*)::int AS n FROM suppliers
       WHERE deleted_at IS NULL
         AND COALESCE(TRIM(phone),'')='' AND COALESCE(TRIM(email),'')=''`)).rows[0].n;
    console.log('без обоих контактов:', both);

    if (APPLY) {
      await client.query('COMMIT');
      console.log('COMMITTED');
    } else {
      await client.query('ROLLBACK');
      console.log('DRY-RUN: откатано. APPLY=1 для записи.');
    }
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
