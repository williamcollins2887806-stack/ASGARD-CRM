/**
 * Registry API helpers — shared by registry_tab, platform_tenders, pm_duty
 */
window.AsgardRegistryApi = (function () {
  function token() {
    return localStorage.getItem('asgard_token') || '';
  }

  function headers(json) {
    const h = { Authorization: 'Bearer ' + token() };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function api(path, opts) {
    opts = opts || {};
    const r = await fetch(path, {
      method: opts.method || 'GET',
      headers: headers(!!opts.body),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
    return d;
  }

  const REGISTRY_STATUSES = [
    { value: 'рассмотрение', label: 'Рассмотрение' },
    { value: 'готовим', label: 'Готовим' },
    { value: 'подались', label: 'Подались' },
    { value: 'выиграли', label: 'Выиграли' },
    { value: 'проиграли', label: 'Проиграли' },
    { value: 'отмена', label: 'Отмена' }
  ];

  function buildRegistryPeriodOptions() {
    const now = new Date();
    const y = now.getFullYear();
    const pad = (n) => String(n).padStart(2, '0');
    const opts = [
      { value: 'current', label: 'Текущий месяц' },
      { value: '', label: 'Все тендеры' },
      { value: 'year:' + y, label: 'За ' + y + ' год' },
      { value: 'year:' + (y - 1), label: 'За ' + (y - 1) + ' год' }
    ];
    for (let i = 0; i < 12; i++) {
      const d = new Date(y, now.getMonth() - i, 1);
      const ym = d.getFullYear() + '-' + pad(d.getMonth() + 1);
      opts.push({
        value: ym,
        label: d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
      });
    }
    return opts;
  }

  function periodLabel(value, options) {
    if (value === 'current') return 'Текущий месяц';
    if (!value) return 'Все тендеры';
    const hit = (options || buildRegistryPeriodOptions()).find((o) => o.value === value);
    return hit ? hit.label : value;
  }

  return {
    api,
    REGISTRY_STATUSES,
    buildRegistryPeriodOptions,
    periodLabel,
    loadRegistry(params) {
      const q = new URLSearchParams();
      q.set('subtab', params.subtab || 'registry');
      q.set('limit', String(params.limit != null ? params.limit : 500));
      if (params.period !== undefined) q.set('period', params.period);
      if (params.burn) q.set('burn', '1');
      return api('/api/tenders/registry?' + q);
    },
    createRegistryRow(body) {
      return api('/api/tenders/registry', { method: 'POST', body: body || {} });
    },
    patchRegistryField(id, field, value) {
      return api('/api/tenders/registry/' + id, { method: 'PATCH', body: { field, value } });
    },
    patchRegistryStatus(id, registry_status) {
      return api('/api/tenders/registry/' + id + '/status', { method: 'PATCH', body: { registry_status } });
    },
    acceptPlatformCandidate(id) {
      return api('/api/tenders/registry/platform/' + id + '/accept', { method: 'POST' });
    },
    dismissPlatformCandidate(id, duplicate) {
      return api('/api/tenders/registry/platform/' + id + '/dismiss', { method: 'POST', body: { duplicate: !!duplicate } });
    },
    createRegistryWork(tenderId, pm_id) {
      return api('/api/tenders/registry/' + tenderId + '/create-work', { method: 'POST', body: { pm_id } });
    },
    loadTenderGuruSettings() {
      return api('/api/tenders/registry/tenderguru/settings');
    },
    saveTenderGuruSettings(body) {
      return api('/api/tenders/registry/tenderguru/settings', { method: 'PUT', body: body });
    },
    testTenderGuruApi() {
      return api('/api/tenders/registry/tenderguru/test');
    },
    syncTenderGuruNow(force) {
      return api('/api/tenders/registry/tenderguru/sync', { method: 'POST', body: force ? { force: true } : {} });
    },
    loadPmDutyCurrent() {
      return api('/api/pm-duty/current');
    },
    loadPmDutyRoster(limit) {
      return api('/api/pm-duty/roster?limit=' + (limit || 50));
    },
    savePmDutyRoster(body) {
      return api('/api/pm-duty/roster', { method: 'POST', body: body });
    },
    updatePmDutyRoster(id, body) {
      return api('/api/pm-duty/roster/' + id, { method: 'PUT', body: body });
    },
    deletePmDutyRoster(id) {
      return api('/api/pm-duty/roster/' + id, { method: 'DELETE' });
    },
    loadPmDutyQueue(tab) {
      return api('/api/pm-duty/queue?tab=' + (tab || 'need_report'));
    },
    loadRpReview(tenderId) {
      return api('/api/tenders/' + tenderId + '/rp-review');
    },
    saveRpReview(tenderId, body) {
      return api('/api/tenders/' + tenderId + '/rp-review', { method: 'PUT', body: body });
    },
    inviteRpCollaborator(tenderId, pm_user_id) {
      return api('/api/tenders/' + tenderId + '/rp-review/invite', { method: 'POST', body: { pm_user_id } });
    },
    suggestCustomers(q) {
      return fetch('/api/customers/suggest?q=' + encodeURIComponent(q) + '&type=party', { headers: headers() })
        .then((r) => r.json())
        .then((d) => d.suggestions || d.items || [])
        .catch(() => []);
    },
    loadUsers(role) {
      const q = role ? '?role=' + encodeURIComponent(role) + '&limit=200' : '?limit=200';
      return api('/api/users' + q).then((d) => d.users || d.items || []);
    }
  };
})();
