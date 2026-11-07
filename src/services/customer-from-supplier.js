'use strict';

/**
 * Зеркало поставщика → карточка customers (PK = inn).
 * Fill-only: не затираем уже заполненные поля/контакты.
 */

const { validCounterpartyInn, isStubOrgName, digitsInn } = require('./counterparty-inn');

let _bankColsCache = null;

async function customerHasBankCols(db) {
  if (_bankColsCache) return _bankColsCache;
  try {
    const r = await db.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='customers'
         AND column_name IN ('bank_account','bank_name','bik')`);
    _bankColsCache = new Set(r.rows.map((x) => x.column_name));
  } catch (_) {
    _bankColsCache = new Set();
  }
  return _bankColsCache;
}

function empty(v) {
  return v == null || String(v).trim() === '';
}

function setIfEmpty(row, col, val, patch, vals) {
  if (!empty(row[col])) return;
  if (empty(val)) return;
  vals.push(val);
  patch.push(`${col}=$${vals.length}`);
}

/**
 * @param {object} db
 * @param {object} supplier — строка suppliers или { inn, name, ... }
 * @param {object} [opts] — { ownInn, contacts[] }
 * @returns {Promise<{inn:string|null, created:boolean, filled:number, reason?:string}>}
 */
async function ensureCustomerFromSupplier(db, supplier, opts) {
  const o = opts || {};
  const inn = digitsInn(supplier && supplier.inn);
  const name = String((supplier && (supplier.name || supplier.counterparty_name)) || '').trim();
  const own = digitsInn(o.ownInn);

  if (!validCounterpartyInn(inn)) {
    return { inn: null, created: false, filled: 0, reason: 'bad_inn' };
  }
  if (own && inn === own) {
    return { inn: null, created: false, filled: 0, reason: 'own_inn' };
  }
  if (isStubOrgName(name) && empty(supplier.full_name)) {
    return { inn: null, created: false, filled: 0, reason: 'stub_name' };
  }

  const displayName = name || String(supplier.full_name || '').trim();
  if (!displayName) {
    return { inn: null, created: false, filled: 0, reason: 'no_name' };
  }

  const existing = await db.query('SELECT * FROM customers WHERE inn = $1', [inn]);
  const cur = existing.rows[0] || null;
  const bankCols = await customerHasBankCols(db);

  const bankAccount = supplier.bank_account || supplier.rs || null;
  const bankName = supplier.bank_name || null;
  const bik = supplier.bik || null;

  if (!cur) {
    const contacts = Array.isArray(o.contacts) ? o.contacts : null;
    const cols = ['inn', 'name', 'full_name', 'kpp', 'ogrn', 'address', 'phone', 'email'];
    const vals = [
      inn,
      displayName.slice(0, 255),
      (supplier.full_name || displayName || '').slice(0, 500) || null,
      supplier.kpp || null,
      supplier.ogrn || null,
      supplier.address || null,
      supplier.phone || null,
      supplier.email || null
    ];
    if (bankCols.has('bank_account')) { cols.push('bank_account'); vals.push(bankAccount); }
    if (bankCols.has('bank_name')) { cols.push('bank_name'); vals.push(bankName); }
    if (bankCols.has('bik')) { cols.push('bik'); vals.push(bik); }
    if (contacts) {
      cols.push('contacts');
      vals.push(JSON.stringify(contacts));
    }
    const placeholders = vals.map((_, i) => {
      if (cols[i] === 'contacts') return `$${i + 1}::jsonb`;
      return `$${i + 1}`;
    }).join(',');
    await db.query(
      `INSERT INTO customers (${cols.join(',')}, created_at, updated_at)
       VALUES (${placeholders}, NOW(), NOW())
       ON CONFLICT (inn) WHERE inn IS NOT NULL AND inn::text <> ''::text DO NOTHING`,
      vals
    );
    return { inn, created: true, filled: 0 };
  }

  const patch = [];
  const vals = [];
  setIfEmpty(cur, 'name', displayName.slice(0, 255), patch, vals);
  setIfEmpty(cur, 'full_name', (supplier.full_name || '').slice(0, 500) || null, patch, vals);
  setIfEmpty(cur, 'kpp', supplier.kpp || null, patch, vals);
  setIfEmpty(cur, 'ogrn', supplier.ogrn || null, patch, vals);
  setIfEmpty(cur, 'address', supplier.address || null, patch, vals);
  setIfEmpty(cur, 'phone', supplier.phone || null, patch, vals);
  setIfEmpty(cur, 'email', supplier.email || null, patch, vals);
  if (bankCols.has('bank_account')) setIfEmpty(cur, 'bank_account', bankAccount, patch, vals);
  if (bankCols.has('bank_name')) setIfEmpty(cur, 'bank_name', bankName, patch, vals);
  if (bankCols.has('bik')) setIfEmpty(cur, 'bik', bik, patch, vals);

  if (Array.isArray(o.contacts) && o.contacts.length) {
    let curContacts = cur.contacts;
    if (typeof curContacts === 'string') {
      try { curContacts = JSON.parse(curContacts); } catch (_) { curContacts = []; }
    }
    if (!Array.isArray(curContacts) || !curContacts.length) {
      vals.push(JSON.stringify(o.contacts));
      patch.push(`contacts=$${vals.length}::jsonb`);
    }
  }

  if (patch.length) {
    vals.push(inn);
    await db.query(
      `UPDATE customers SET ${patch.join(', ')}, updated_at=NOW() WHERE inn=$${vals.length}`,
      vals
    );
  }

  return { inn, created: false, filled: patch.length };
}

/**
 * После ensureSupplier: загрузить suppliers + contacts и зеркалить в customers.
 */
async function mirrorSupplierIdToCustomer(db, supplierId, opts) {
  if (!supplierId) return { inn: null, created: false, filled: 0, reason: 'no_id' };
  const { rows } = await db.query(
    `SELECT * FROM suppliers WHERE id=$1 AND deleted_at IS NULL`, [supplierId]);
  if (!rows[0]) return { inn: null, created: false, filled: 0, reason: 'not_found' };

  const contactsRes = await db.query(
    `SELECT full_name AS name, role AS position, phone, email, is_primary
       FROM supplier_contacts WHERE supplier_id=$1 ORDER BY is_primary DESC, id`,
    [supplierId]
  ).catch(() => ({ rows: [] }));

  const contacts = (contactsRes.rows || []).map((c) => ({
    name: c.name || '',
    position: c.position || '',
    phone: c.phone || '',
    phone2: '',
    email: c.email || '',
    is_primary: !!c.is_primary
  })).filter((c) => c.name || c.phone || c.email);

  return ensureCustomerFromSupplier(db, rows[0], { ...(opts || {}), contacts });
}

module.exports = {
  ensureCustomerFromSupplier,
  mirrorSupplierIdToCustomer
};
