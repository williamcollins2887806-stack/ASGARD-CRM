import { api } from '@/api/client';

export function buildRegistryPeriodOptions() {
  const now = new Date();
  const y = now.getFullYear();
  const pad = (n) => String(n).padStart(2, '0');
  const opts = [
    { value: 'current', label: 'Текущий месяц' },
    { value: '', label: 'Все тендеры' },
    { value: `year:${y}`, label: `За ${y} год` },
    { value: `year:${y - 1}`, label: `За ${y - 1} год` },
  ];
  for (let i = 0; i < 12; i++) {
    const d = new Date(y, now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    opts.push({
      value: ym,
      label: d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
    });
  }
  return opts;
}

export async function loadRegistry(params = {}) {
  const q = new URLSearchParams();
  q.set('subtab', params.subtab || 'registry');
  q.set('limit', String(params.limit ?? 500));
  if (params.period !== undefined) q.set('period', params.period);
  if (params.burn) q.set('burn', '1');
  return api.get(`/tenders/registry?${q}`);
}

export function createRegistryRow(body) {
  return api.post('/tenders/registry', body);
}

export function patchRegistryField(id, field, value) {
  return api.request(`/tenders/registry/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ field, value }),
  });
}

export function patchRegistryStatus(id, registry_status) {
  return api.request(`/tenders/registry/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ registry_status }),
  });
}

export function createRegistryWork(tenderId, pm_id) {
  return api.post(`/tenders/registry/${tenderId}/create-work`, { pm_id });
}

export function acceptPlatformCandidate(id) {
  return api.post(`/tenders/registry/platform/${id}/accept`);
}

export function dismissPlatformCandidate(id, duplicate = false) {
  return api.post(`/tenders/registry/platform/${id}/dismiss`, { duplicate });
}

export function loadTenderGuruSettings() {
  return api.get('/tenders/registry/tenderguru/settings');
}

export function saveTenderGuruSettings(body) {
  return api.request('/tenders/registry/tenderguru/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function testTenderGuruApi() {
  return api.get('/tenders/registry/tenderguru/test');
}

export function syncTenderGuruNow({ force = false } = {}) {
  return api.post('/tenders/registry/tenderguru/sync', force ? { force: true } : {});
}

export async function loadPmUsers() {
  const [pm, head] = await Promise.all([
    api.get('/users?role=PM&is_active=true&limit=200').catch(() => ({ users: [] })),
    api.get('/users?role=HEAD_PM&is_active=true&limit=50').catch(() => ({ users: [] })),
  ]);
  const rows = [...(pm.users || pm.rows || []), ...(head.users || head.rows || [])];
  const seen = new Set();
  return rows.filter((u) => {
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });
}

export function loadPmDutyCurrent() {
  return api.get('/pm-duty/current');
}

export function loadPmDutyQueue(tab = 'need_report') {
  return api.get(`/pm-duty/queue?tab=${tab}`);
}

export function loadPmDutyRoster(limit = 50) {
  return api.get(`/pm-duty/roster?limit=${limit}`);
}

export function savePmDutyRoster(body) {
  return api.post('/pm-duty/roster', body);
}

export function suggestCustomers(q) {
  return api.get(`/customers/suggest?q=${encodeURIComponent(q)}&type=party`)
    .then((d) => d.suggestions || d.items || [])
    .catch(() => []);
}

export function loadRpReview(tenderId) {
  return api.get(`/tenders/${tenderId}/rp-review`);
}

export function saveRpReview(tenderId, body) {
  return api.request(`/tenders/${tenderId}/rp-review`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
