/**
 * API-клиент страницы /customers.
 * Источник истины — vanilla `public/assets/js/customers.js`.
 *
 * Endpoint'ы (см. src/routes/customers.js):
 *   GET    /api/customers?search=&limit=&offset=
 *   GET    /api/customers/:inn                — карточка + последние 10 тендеров
 *   GET    /api/customers/:inn/dashboard      — светофор + KPI
 *   GET    /api/customers/lookup/:inn         — ДаДата по ИНН
 *   GET    /api/customers/suggest?q=          — ДаДата autocomplete
 *   POST   /api/customers                     — создать / upsert
 *   PUT    /api/customers/:inn                — обновить
 *   DELETE /api/customers/:inn                — удалить (ADMIN)
 *
 * Идентификатор — `inn` (ИНН), не id.
 */
import { api } from '@/api/client';

export function normInn(v) {
  return String(v || '').replace(/\D/g, '');
}

export function loadCustomers(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit ?? 1000));
  if (params.offset) q.set('offset', String(params.offset));
  if (params.search) q.set('search', params.search);
  return api('/api/customers?' + q.toString()).then((d) => d.customers || d.items || []);
}

export function loadCustomer(inn) {
  return api('/api/customers/' + encodeURIComponent(inn));
}

export function loadCustomerDashboard(inn) {
  return api('/api/customers/' + encodeURIComponent(inn) + '/dashboard');
}

export function createCustomer(payload) {
  return api('/api/customers', { method: 'POST', body: payload });
}

export function updateCustomer(inn, payload) {
  return api('/api/customers/' + encodeURIComponent(inn), { method: 'PUT', body: payload });
}

export function deleteCustomer(inn) {
  return api('/api/customers/' + encodeURIComponent(inn), { method: 'DELETE' });
}

export function lookupByInn(inn) {
  return api('/api/customers/lookup/' + encodeURIComponent(inn));
}

export function suggestCustomers(query) {
  if (!query || query.length < 2) return Promise.resolve([]);
  return api('/api/customers/suggest?q=' + encodeURIComponent(query))
    .then((d) => d.suggestions || [])
    .catch(() => []);
}

/* ── helpers ─────────────────────────────────────────────────────────── */
export function filterByQuery(list, q) {
  if (!q || !q.trim()) return list;
  const lq = q.trim().toLowerCase();
  return list.filter((c) =>
    (c.name || '').toLowerCase().includes(lq) ||
    (c.full_name || '').toLowerCase().includes(lq) ||
    (c.inn || '').includes(lq) ||
    (c.email || '').toLowerCase().includes(lq) ||
    (c.phone || '').includes(lq)
  );
}

export function isValidInn(inn) {
  // G-4: добавлена контрольная сумма (общий валидатор validators.js).
  // Раньше — только длина, бэк ловил на чёрные ИНН (1234567890) → 500 без объяснения юзеру.
  const v = normInn(inn);
  if (v.length !== 10 && v.length !== 12) return false;
  if (v.length === 10) {
    const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
    const k = (w.reduce((a, wi, i) => a + wi * Number(v[i]), 0) % 11) % 10;
    return k === Number(v[9]);
  }
  // 12 цифр
  const w11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const w12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const k11 = (w11.reduce((a, wi, i) => a + wi * Number(v[i]), 0) % 11) % 10;
  const k12 = (w12.reduce((a, wi, i) => a + wi * Number(v[i]), 0) % 11) % 10;
  return k11 === Number(v[10]) && k12 === Number(v[11]);
}
