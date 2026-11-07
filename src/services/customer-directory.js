'use strict';

/**
 * Единый реестр контрагентов: customers ∪ suppliers по ИНН + роли + счётчики + relation.
 */

const { validCounterpartyInn } = require('./counterparty-inn');

const RELATION_MONTHS = 18;

function monthsAgoIso(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

/**
 * @param {object} db
 * @param {object} opts — { search, role, relation, quarantine, limit, offset }
 */
async function listDirectory(db, opts) {
  const o = opts || {};
  const limit = Math.min(Math.max(parseInt(o.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(o.offset, 10) || 0, 0);
  const search = String(o.search || o.q || '').trim();
  const role = String(o.role || 'all'); // all | buyer | supplier
  const relation = String(o.relation || 'all'); // all | active | idle | none
  const quarantine = o.quarantine === true || o.quarantine === '1' || o.quarantine === 'true';
  const since = monthsAgoIso(RELATION_MONTHS);

  // Без миграции V469 — работаем как будто все unchecked
  let hasMeta = true;
  try {
    await db.query('SELECT 1 FROM customer_dadata_meta LIMIT 0');
  } catch (_) {
    hasMeta = false;
  }

  const params = [since];
  let p = 2;
  const metaJoin = hasMeta
    ? 'LEFT JOIN customer_dadata_meta m ON m.inn = i.inn'
    : '';
  const metaStatus = hasMeta
    ? "COALESCE(m.status, 'unchecked')"
    : "'unchecked'";

  // База: все ИНН из customers + suppliers (валидной длины)
  let sql = `
    WITH inns AS (
      SELECT regexp_replace(c.inn, '\\D', '', 'g') AS inn
        FROM customers c
       WHERE c.inn IS NOT NULL AND length(regexp_replace(c.inn, '\\D', '', 'g')) IN (10, 12)
      UNION
      SELECT regexp_replace(s.inn, '\\D', '', 'g') AS inn
        FROM suppliers s
       WHERE s.deleted_at IS NULL
         AND s.inn IS NOT NULL
         AND length(regexp_replace(s.inn, '\\D', '', 'g')) IN (10, 12)
    ),
    base AS (
      SELECT
        i.inn,
        COALESCE(NULLIF(TRIM(c.name), ''), NULLIF(TRIM(s.name), ''), i.inn) AS name,
        COALESCE(c.full_name, '') AS full_name,
        c.kpp AS kpp,
        c.address AS address,
        c.phone AS phone,
        c.email AS email,
        (c.inn IS NOT NULL) AS has_customer,
        (s.id IS NOT NULL) AS has_supplier,
        s.id AS supplier_id,
        ${metaStatus} AS dadata_status
      FROM inns i
      LEFT JOIN customers c ON regexp_replace(c.inn, '\\D', '', 'g') = i.inn
      LEFT JOIN LATERAL (
        SELECT * FROM suppliers sx
         WHERE sx.deleted_at IS NULL
           AND regexp_replace(COALESCE(sx.inn,''), '\\D', '', 'g') = i.inn
         ORDER BY sx.id
         LIMIT 1
      ) s ON true
      ${metaJoin}
    ),
    counts AS (
      SELECT
        b.*,
        (SELECT COUNT(*)::int FROM tenders t
          WHERE t.customer_inn = b.inn AND t.deleted_at IS NULL) AS tenders_count,
        (SELECT COUNT(*)::int FROM works w
          WHERE w.deleted_at IS NULL AND (
            w.customer_inn = b.inn
            OR w.tender_id IN (SELECT id FROM tenders WHERE customer_inn = b.inn AND deleted_at IS NULL)
          )) AS works_count,
        (SELECT COUNT(*)::int FROM contracts ct
          WHERE COALESCE(TRIM(ct.counterparty_name), '') <> ''
            AND (
              lower(TRIM(ct.counterparty_name)) = lower(TRIM(b.name))
              OR (b.inn <> '' AND EXISTS (
                SELECT 1 FROM suppliers sx
                 WHERE sx.deleted_at IS NULL
                   AND regexp_replace(COALESCE(sx.inn,''), '\\D', '', 'g') = b.inn
                   AND lower(TRIM(sx.name)) = lower(TRIM(ct.counterparty_name))
              ))
            )
        ) AS contracts_count,
        (SELECT COUNT(*)::int FROM doc_registry d
          WHERE d.deleted_at IS NULL AND d.dir = 'in'
            AND (
              d.supplier_id = b.supplier_id
              OR regexp_replace(COALESCE(d.counterparty_inn,''), '\\D', '', 'g') = b.inn
            )
        ) AS docs_count,
        (SELECT COUNT(*)::int FROM invoices inv WHERE inv.customer_inn = b.inn) AS invoices_out_count,
        (SELECT MAX(x) FROM (VALUES
          ((SELECT MAX(t.updated_at) FROM tenders t WHERE t.customer_inn = b.inn AND t.deleted_at IS NULL)),
          ((SELECT MAX(w.updated_at) FROM works w WHERE w.deleted_at IS NULL AND w.customer_inn = b.inn)),
          ((SELECT MAX(d.updated_at) FROM doc_registry d WHERE d.deleted_at IS NULL
             AND (d.supplier_id = b.supplier_id
                  OR regexp_replace(COALESCE(d.counterparty_inn,''), '\\D', '', 'g') = b.inn))),
          ((SELECT MAX(ct.updated_at) FROM contracts ct
             WHERE lower(TRIM(COALESCE(ct.counterparty_name,''))) = lower(TRIM(b.name))))
        ) AS v(x)) AS last_activity_at
      FROM base b
    ),
    enriched AS (
      SELECT
        c.*,
        CASE
          WHEN (c.has_supplier OR c.docs_count > 0)
           AND (c.has_customer OR c.tenders_count > 0 OR c.works_count > 0 OR c.invoices_out_count > 0)
            THEN 'both'
          WHEN (c.has_supplier OR c.docs_count > 0) THEN 'supplier'
          ELSE 'buyer'
        END AS roles,
        CASE
          WHEN c.last_activity_at IS NOT NULL AND c.last_activity_at >= $1::timestamptz THEN 'active'
          WHEN c.last_activity_at IS NOT NULL THEN 'idle'
          WHEN (c.tenders_count + c.works_count + c.contracts_count + c.docs_count + c.invoices_out_count) > 0 THEN 'idle'
          ELSE 'none'
        END AS relation_status
      FROM counts c
    )
    SELECT * FROM enriched WHERE 1=1
  `;

  // Основной список: скрываем уже помеченный мусор/ЕГРЮЛ-провалы.
  // «На разбор»: фильтр по checksum/status в JS (ниже), SQL не режем.
  if (!quarantine) {
    sql += ` AND dadata_status NOT IN ('quarantine','not_found','liquidated')`;
  }

  if (search) {
    sql += ` AND (LOWER(name) LIKE $${p} OR inn LIKE $${p})`;
    params.push(`%${search.toLowerCase()}%`);
    p++;
  }

  if (role === 'buyer') {
    sql += ` AND roles IN ('buyer','both')`;
  } else if (role === 'supplier') {
    sql += ` AND roles IN ('supplier','both')`;
  }

  if (relation === 'active' || relation === 'idle' || relation === 'none') {
    sql += ` AND relation_status = $${p}`;
    params.push(relation);
    p++;
  }

  sql += ` ORDER BY name ASC LIMIT $${p} OFFSET $${p + 1}`;
  params.push(limit, offset);

  const { rows } = await db.query(sql, params);

  const mapped = rows.map((r) => ({
    inn: r.inn,
    name: r.name,
    full_name: r.full_name,
    kpp: r.kpp,
    address: r.address,
    phone: r.phone,
    email: r.email,
    roles: r.roles,
    relation_status: r.relation_status,
    is_active_relation: r.relation_status === 'active',
    supplier_id: r.supplier_id,
    dadata_status: r.dadata_status,
    counts: {
      tenders: +r.tenders_count || 0,
      works: +r.works_count || 0,
      contracts: +r.contracts_count || 0,
      docs: (+r.docs_count || 0) + (+r.invoices_out_count || 0),
      docs_in: +r.docs_count || 0,
      invoices_out: +r.invoices_out_count || 0
    },
    last_activity_at: r.last_activity_at
  }));

  // Основной реестр — только checksum-валидные ИНН; «На разбор» — остальные
  const items = quarantine
    ? mapped.filter((r) => !validCounterpartyInn(r.inn) || ['quarantine', 'not_found', 'liquidated'].includes(r.dadata_status))
    : mapped.filter((r) => validCounterpartyInn(r.inn));

  return {
    items,
    limit,
    offset,
    relation_months: RELATION_MONTHS
  };
}

/** Роли + relation + counts для одного ИНН (dashboard). */
async function statsForInn(db, inn) {
  const dir = await listDirectory(db, { search: inn, limit: 5, offset: 0 });
  const hit = (dir.items || []).find((x) => x.inn === inn) || dir.items[0] || null;
  if (hit) return hit;

  // Fallback лёгкий, если listDirectory пуст (нет в customers/suppliers)
  return {
    inn,
    roles: 'buyer',
    relation_status: 'none',
    is_active_relation: false,
    supplier_id: null,
    dadata_status: 'unchecked',
    counts: { tenders: 0, works: 0, contracts: 0, docs: 0, docs_in: 0, invoices_out: 0 }
  };
}

module.exports = { listDirectory, statsForInn, RELATION_MONTHS };
