'use strict';
/**
 * Синхронизация контактов договора → карточка контрагента (suppliers).
 *
 * Требование: у каждого договора свои контакты (лицо/телефон/почта), связанные
 * с карточкой контрагента. При сохранении/создании договора контакты договора
 * пишутся в карточку контрагента по ИНН.
 *
 * Правила:
 *  - карточка ищется по ИНН = contracts.counterparty_id; если пусто — по имени;
 *  - FILL-ONLY: незаполненные поля карточки заполняем, заполненные не трогаем
 *    (чужие данные не перетираем);
 *  - contact_person договора пишем в suppliers.name? НЕТ — в карточке нет поля
 *    «контактное лицо»; оно логируется и остаётся в договоре. В карточку идут
 *    только phone/email (её собственные поля).
 *  - ошибки синхронизации не должны ломать сохранение договора.
 */

/**
 * @param {object} db   пул/клиент pg
 * @param {object} row  сохранённая строка contracts (RETURNING *)
 * @param {object} [log] логгер fastify (опционально)
 */
async function syncContractContactsToSupplier(db, row, log) {
  if (!row) return { synced: false, reason: 'no_row' };
  const phone = row.contact_phone != null ? String(row.contact_phone).trim() : '';
  const email = row.contact_email != null ? String(row.contact_email).trim() : '';
  const person = row.contact_person != null ? String(row.contact_person).trim() : '';
  if (!phone && !email) return { synced: false, reason: 'no_contacts' };

  const inn = row.counterparty_id != null ? String(row.counterparty_id).replace(/\D/g, '') : '';
  const name = row.counterparty_name != null ? String(row.counterparty_name).trim() : '';

  let sup = null;
  try {
    if (inn) {
      sup = (await db.query(
        `SELECT id, name, COALESCE(TRIM(phone),'') AS phone, COALESCE(TRIM(email),'') AS email
           FROM suppliers WHERE deleted_at IS NULL AND btrim(inn) = $1 LIMIT 1`, [inn]
      )).rows[0] || null;
    }
    if (!sup && name) {
      sup = (await db.query(
        `SELECT id, name, COALESCE(TRIM(phone),'') AS phone, COALESCE(TRIM(email),'') AS email
           FROM suppliers WHERE deleted_at IS NULL AND lower(btrim(name)) = lower(btrim($1)) LIMIT 1`, [name]
      )).rows[0] || null;
    }
  } catch (e) {
    if (log) log.warn('[contract-contact-sync] lookup failed: ' + e.message);
    return { synced: false, reason: 'lookup_error' };
  }
  if (!sup) return { synced: false, reason: 'no_supplier' };

  const needPhone = !sup.phone && phone;
  const needEmail = !sup.email && email;
  if (!needPhone && !needEmail) return { synced: false, reason: 'already_filled', supplier_id: sup.id };

  try {
    await db.query(
      `UPDATE suppliers
          SET phone = COALESCE(NULLIF(TRIM(phone), ''), $2),
              email = COALESCE(NULLIF(TRIM(email), ''), $3),
              updated_at = NOW()
        WHERE id = $1`,
      [sup.id, phone || null, email || null]
    );
  } catch (e) {
    if (log) log.warn('[contract-contact-sync] update failed: ' + e.message);
    return { synced: false, reason: 'update_error', supplier_id: sup.id };
  }
  return { synced: true, supplier_id: sup.id, phone: needPhone, email: needEmail, person: !!person };
}

module.exports = { syncContractContactsToSupplier };
