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

export function archiveRegistryRow(id, archive_reason) {
  return api.request(`/tenders/registry/${id}/archive`, {
    method: 'POST',
    body: JSON.stringify({ archive_reason: archive_reason || 'РП: не подаём — архив ТО' }),
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

export function loadDirectorReviewQueue() {
  return api.get('/tenders/director-review-queue');
}

export function loadDirectorReviewQueueCount() {
  return api.get('/tenders/director-review-queue/count');
}

export function markDirectorReviewSeen(tenderId) {
  return api.post(`/tenders/${tenderId}/director-review-seen`);
}

export function directorDecisionRpReview(tenderId, body) {
  return api.request(`/tenders/${tenderId}/rp-review/director-decision`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function loadRpReviewMessages(tenderId) {
  return api.get(`/tenders/${tenderId}/rp-review/messages`);
}

export function postRpReviewMessage(tenderId, body, files = []) {
  const fd = new FormData();
  fd.append('body', body || '');
  files.forEach((f) => fd.append('file', f));
  const token = localStorage.getItem('asgard_token');
  return fetch(`/api/tenders/${tenderId}/rp-review/messages`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || d.message || `HTTP ${r.status}`);
    return d;
  });
}

export function loadTenderFiles(tenderId) {
  return api.get(`/files?tender_id=${tenderId}`).then((d) => d.files || d.items || []);
}

/** Превью файла из thread просчёта (blob URL — вызвать URL.revokeObjectURL после закрытия). */
export async function previewRpReviewFile(tenderId, docId) {
  const token = api.getToken?.() || localStorage.getItem('asgard_token');
  const r = await fetch(`/api/tenders/${tenderId}/rp-review/files/${docId}/preview`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || d.message || `HTTP ${r.status}`);
  }
  const blob = await r.blob();
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, contentType: r.headers.get('content-type') || blob.type };
}
