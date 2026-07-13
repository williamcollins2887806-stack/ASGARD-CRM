/**
 * Общие хелперы для массива контактов контрагента (JSONB `customers.contacts`).
 * Используются в CustomerDetailModal, CustomerEditModal, CustomerContactEditModal.
 */

function mapContact(c) {
  return {
    name:       String(c?.name || ''),
    position:   String(c?.position || c?.role || ''),
    phone:      String(c?.phone || ''),
    email:      String(c?.email || ''),
    is_primary: !!c?.is_primary
  };
}

/** Нормализует contacts из JSONB / JSON-string / массива. Пустой массив → null (fallback дальше). */
function asContactArray(raw) {
  if (Array.isArray(raw)) return raw.length ? raw : null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (_e) { /* ignore */ }
  }
  return null;
}

/** Загрузка контактов: contacts JSONB → contacts_json TEXT → contact_person fallback. */
export function initialContacts(customer) {
  const fromContacts = asContactArray(customer?.contacts);
  if (fromContacts) return fromContacts.map(mapContact);

  if (customer?.contacts_json && String(customer.contacts_json).trim()) {
    try {
      const parsed = JSON.parse(String(customer.contacts_json));
      if (Array.isArray(parsed) && parsed.length) return parsed.map(mapContact);
    } catch (_e) { /* fallback ниже */ }
  }

  if (customer?.contact_person && String(customer.contact_person).trim()) {
    return [{
      name:       String(customer.contact_person).trim(),
      position:   '',
      phone:      String(customer.phone || ''),
      email:      String(customer.email || ''),
      is_primary: true
    }];
  }
  return [];
}

/** Нормализация перед сохранением: trim, filter empty, единственный is_primary. */
export function cleanContacts(contacts) {
  const cleaned = (contacts || [])
    .map((c) => ({
      name:       (c.name || '').trim(),
      position:   (c.position || '').trim(),
      phone:      (c.phone || '').trim(),
      email:      (c.email || '').trim(),
      is_primary: !!c.is_primary
    }))
    .filter((c) => c.name || c.phone || c.email);

  let primaryFound = false;
  for (const c of cleaned) {
    if (c.is_primary && !primaryFound) primaryFound = true;
    else c.is_primary = false;
  }
  if (cleaned.length && !primaryFound) cleaned[0].is_primary = true;
  return cleaned;
}

/** Legacy `contact_person` для обратной совместимости со старыми местами CRM. */
export function legacyContactPerson(contacts) {
  const cleaned = cleanContacts(contacts);
  const primary = cleaned.find((c) => c.is_primary) || cleaned[0];
  return primary ? [primary.name, primary.position].filter(Boolean).join(' · ') : '';
}

/** Payload для PUT: contacts + contact_person. */
export function contactsPayload(contacts) {
  const cleaned = cleanContacts(contacts);
  return {
    contacts:       cleaned,
    contact_person: legacyContactPerson(cleaned)
  };
}

export function emitCustomersChanged() {
  window.dispatchEvent(new CustomEvent('asgard:customers:changed'));
}
