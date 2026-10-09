#!/usr/bin/env node
'use strict';
/**
 * Backfill suppliers.phone / suppliers.email из документов реестра.
 *
 * Зачем: при импорте реестра контакты писались в сам документ
 * (doc_registry.counterparty_phone/email), а карточку suppliers не заполняли —
 * поэтому в карточках пусто, хотя в документах есть.
 *
 * Правила:
 *  - заполняем ТОЛЬКО пустые поля (COALESCE — существующее не трогаем);
 *  - источник: документ, привязанный по supplier_id (приоритет), иначе —
 *    по совпадению названия контрагента (lower(trim(...)));
 *  - берём значение из ПОСЛЕДНЕГО документа (invoice_date DESC, id DESC);
 *    сортировка «привязан по supplier_id» — DESC NULLS LAST (иначе документы
 *    без supplier_id всплывают первыми);
 *  - валидация: телефон не «число с разделителями тысяч» (артефакт Excel),
 *    не ФИО (кириллица кроме маркеров «доб./вн./моб.»), >= 5 цифр;
 *    email — одна @ с доменом;
 *  - идемпотентно.
 *
 * Режимы:
 *   node tools/backfill_supplier_contacts.js            # dry-run (ROLLBACK)
 *   APPLY=1 node tools/backfill_supplier_contacts.js    # записать
 *   FIX=1   node tools/backfill_supplier_contacts.js    # ремедиация уже записанных
 *                                                       # «плохих» значений (dry-run)
 *   FIX=1 APPLY=1 node tools/backfill_supplier_contacts.js
 *
 * На проде запускать на сервере: cd /var/www/asgard-crm && node tools/...
 */
const { Pool } = require('pg');

const APPLY = process.env.APPLY === '1';
const FIX = process.env.FIX === '1';

// ── Валидация телефона ──────────────────────────────────────────────────────
// «Мягкая» (как было в первой версии): отсекает Excel-артефакт и <5 цифр.
const PHONE_LOOSE = `
    AND NULLIF(TRIM(d.counterparty_phone), '') IS NOT NULL
    AND d.counterparty_phone !~ '^[0-9]{1,3}(,[0-9]{3})+$'
    AND length(regexp_replace(d.counterparty_phone, '\\D', '', 'g')) >= 5`;
// «Строгая»: дополнительно отсекает ФИО/роли (кириллица после удаления
// легитимных маркеров «доб./вн./моб./тел./раб./офис»).
const PHONE_STRICT = PHONE_LOOSE + `
    AND NOT (regexp_replace(d.counterparty_phone, '(доб|вн|моб|тел|раб|офис)\\.?', '', 'gi') ~ '[А-Яа-яЁё]')`;

const EMAIL_OK = `
    AND NULLIF(TRIM(d.counterparty_email), '') IS NOT NULL
    AND d.counterparty_email ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`;

const SRC_MATCH = `
        AND ( d.supplier_id = s.id
              OR ( COALESCE(TRIM(d.counterparty_name), '') <> ''
                   AND lower(TRIM(d.counterparty_name)) = lower(TRIM(s.name)) ) )`;

/**
 * CTE с «выборкой» контактов.
 * @param {string} name     имя CTE
 * @param {string} phoneOk  выражение валидации телефона
 * @param {boolean} orderFix true → NULLS LAST для признака привязки
 */
function pickCte(name, phoneOk, orderFix) {
  const ord = orderFix ? 'DESC NULLS LAST' : 'DESC';
  return `${name} AS (
  SELECT s.id AS supplier_id, s.name,
    (SELECT NULLIF(TRIM(d.counterparty_phone), '')
       FROM doc_registry d
      WHERE d.deleted_at IS NULL${SRC_MATCH}${phoneOk}
      ORDER BY (d.supplier_id = s.id) ${ord}, d.invoice_date DESC NULLS LAST, d.id DESC
      LIMIT 1) AS phone,
    (SELECT NULLIF(TRIM(d.counterparty_email), '')
       FROM doc_registry d
      WHERE d.deleted_at IS NULL${SRC_MATCH}${EMAIL_OK}
      ORDER BY (d.supplier_id = s.id) ${ord}, d.invoice_date DESC NULLS LAST, d.id DESC
      LIMIT 1) AS email
  FROM suppliers s
  WHERE s.deleted_at IS NULL
)`;
}

const WITH_FILL = 'WITH ' + pickCte('pick', PHONE_STRICT, true);
const WITH_FIX = 'WITH ' + pickCte('oldpick', PHONE_LOOSE, false) + ', ' + pickCte('pick', PHONE_STRICT, true);

const TARGETS_WHERE = `
  (COALESCE(TRIM(s.phone), '') = '' AND p.phone IS NOT NULL)
  OR (COALESCE(TRIM(s.email), '') = '' AND p.email IS NOT NULL)`;

async function stats(client) {
  return (await client.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE COALESCE(TRIM(phone),'') <> '')::int AS with_phone,
           count(*) FILTER (WHERE COALESCE(TRIM(email),'') <> '')::int AS with_email,
           count(*) FILTER (WHERE COALESCE(TRIM(phone),'') = '' AND COALESCE(TRIM(email),'') = '')::int AS without_both
      FROM suppliers WHERE deleted_at IS NULL`)).rows[0];
}

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
    console.log('APPLY =', APPLY, '| FIX =', FIX);
    console.log('before:', await stats(client));

    await client.query('BEGIN');

    if (FIX) {
      // ── Ремедиация: строки, куда первая версия записала «плохое» значение.
      // Признак: текущее значение совпадает со «старым» выбором, но отличается
      // от исправленного (валидатор + NULLS LAST) → перезаписываем на исправленное.
      const plan = (await client.query(`
        ${WITH_FIX}
        SELECT count(*) FILTER (WHERE (s.phone IS NOT DISTINCT FROM o.phone AND s.phone IS DISTINCT FROM f.phone)
                                    OR (s.email IS NOT DISTINCT FROM o.email AND s.email IS DISTINCT FROM f.email))::int AS to_fix
          FROM suppliers s JOIN oldpick o ON o.supplier_id = s.id JOIN pick f ON f.supplier_id = s.id
         WHERE s.deleted_at IS NULL`)).rows[0];
      console.log('FIX plan:', plan);

      const sample = (await client.query(`
        ${WITH_FIX}
        SELECT s.id, s.name,
               CASE WHEN s.phone IS NOT DISTINCT FROM o.phone AND s.phone IS DISTINCT FROM f.phone THEN s.phone END AS phone_was,
               CASE WHEN s.phone IS NOT DISTINCT FROM o.phone AND s.phone IS DISTINCT FROM f.phone THEN f.phone END AS phone_now,
               CASE WHEN s.email IS NOT DISTINCT FROM o.email AND s.email IS DISTINCT FROM f.email THEN s.email END AS email_was,
               CASE WHEN s.email IS NOT DISTINCT FROM o.email AND s.email IS DISTINCT FROM f.email THEN f.email END AS email_now
          FROM suppliers s JOIN oldpick o ON o.supplier_id = s.id JOIN pick f ON f.supplier_id = s.id
         WHERE s.deleted_at IS NULL
           AND ( (s.phone IS NOT DISTINCT FROM o.phone AND s.phone IS DISTINCT FROM f.phone)
              OR (s.email IS NOT DISTINCT FROM o.email AND s.email IS DISTINCT FROM f.email) )
         ORDER BY s.id`)).rows;
      console.log('FIX sample (' + sample.length + '):');
      for (const r of sample) console.log('   #' + r.id, r.name,
        '| phone:', JSON.stringify(r.phone_was), '->', JSON.stringify(r.phone_now),
        '| email:', JSON.stringify(r.email_was), '->', JSON.stringify(r.email_now));

      const upd = await client.query(`
        ${WITH_FIX}
        UPDATE suppliers s
           SET phone = CASE WHEN s.phone IS NOT DISTINCT FROM o.phone AND s.phone IS DISTINCT FROM f.phone THEN f.phone ELSE s.phone END,
               email = CASE WHEN s.email IS NOT DISTINCT FROM o.email AND s.email IS DISTINCT FROM f.email THEN f.email ELSE s.email END,
               updated_at = NOW()
          FROM oldpick o, pick f
         WHERE s.id = o.supplier_id AND s.id = f.supplier_id
           AND s.deleted_at IS NULL
           AND ( (s.phone IS NOT DISTINCT FROM o.phone AND s.phone IS DISTINCT FROM f.phone)
              OR (s.email IS NOT DISTINCT FROM o.email AND s.email IS DISTINCT FROM f.email) )`);
      console.log('FIX updated rows:', upd.rowCount);
    } else {
      // ── Обычный backfill (fill-only, исправленная логика)
      const plan = (await client.query(`
        ${WITH_FILL}
        SELECT count(*) FILTER (WHERE COALESCE(TRIM(s.phone),'') = '' AND p.phone IS NOT NULL)::int AS phone_to_fill,
               count(*) FILTER (WHERE COALESCE(TRIM(s.email),'') = '' AND p.email IS NOT NULL)::int AS email_to_fill,
               count(*) FILTER (WHERE (COALESCE(TRIM(s.phone),'') = '' AND p.phone IS NULL)
                                   AND (COALESCE(TRIM(s.email),'') = '' AND p.email IS NULL))::int AS no_source
          FROM suppliers s JOIN pick p ON p.supplier_id = s.id
         WHERE s.deleted_at IS NULL`)).rows[0];
      console.log('plan  :', plan);

      const sample = (await client.query(`
        ${WITH_FILL}
        SELECT s.id, s.name, p.phone, p.email
          FROM suppliers s JOIN pick p ON p.supplier_id = s.id
         WHERE s.deleted_at IS NULL
           AND ( (COALESCE(TRIM(s.phone),'') = '' AND p.phone IS NOT NULL)
              OR (COALESCE(TRIM(s.email),'') = '' AND p.email IS NOT NULL) )
         ORDER BY s.name LIMIT 5`)).rows;
      console.log('sample (5 из плана):');
      for (const r of sample) console.log('   #' + r.id, r.name, '| phone:', JSON.stringify(r.phone), '| email:', JSON.stringify(r.email));

      const upd = await client.query(`
        ${WITH_FILL}
        UPDATE suppliers s
           SET phone = COALESCE(NULLIF(TRIM(s.phone), ''), p.phone),
               email = COALESCE(NULLIF(TRIM(s.email), ''), p.email),
               updated_at = NOW()
          FROM pick p
         WHERE s.id = p.supplier_id
           AND (${TARGETS_WHERE})`);
      console.log('updated rows:', upd.rowCount);
    }

    console.log('after :', await stats(client));
    // Контроль качества: не осталось ли мусора в телефонах
    const bad = (await client.query(`
      SELECT count(*)::int AS n FROM suppliers
       WHERE deleted_at IS NULL
         AND ( COALESCE(TRIM(phone),'') <> ''
               AND regexp_replace(phone, '(доб|вн|моб|тел|раб|офис)\\.?', '', 'gi') ~ '[А-Яа-яЁё]' )`)).rows[0].n;
    console.log('мусорных телефонов (ФИО):', bad);

    if (APPLY) { await client.query('COMMIT'); console.log('COMMITTED'); }
    else { await client.query('ROLLBACK'); console.log('DRY-RUN: откатано. APPLY=1 для записи.'); }
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
