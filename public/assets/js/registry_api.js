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

  function fmtDate(value) {
    if (!value) return '—';
    if (window.AsgardUI && AsgardUI.formatDate) return AsgardUI.formatDate(value);
    const s = String(value).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
  }

  function fmtDateIso(value) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatDocBytes(n) {
    if (!n) return '';
    if (n < 1024) return n + ' Б';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
    return (n / 1024 / 1024).toFixed(1) + ' МБ';
  }

  function docDownloadHref(doc) {
    if (window.AsgardFileDownload && AsgardFileDownload.fileDownloadUrl) {
      return AsgardFileDownload.fileDownloadUrl(doc);
    }
    let url = doc.file_url || doc.download_url || '';
    if (!url && doc.filename) url = '/api/files/download/' + encodeURIComponent(doc.filename);
    if (url && url.startsWith('/api/files/download/')) {
      const t = token();
      if (t && !/[?&]token=/.test(url)) url += '?token=' + encodeURIComponent(t);
    }
    return url;
  }

  function canManageRegistryDocs() {
    try {
      const u = JSON.parse(localStorage.getItem('asgard_user') || '{}');
      return ['TO', 'HEAD_TO', 'ADMIN'].includes(u.role || '');
    } catch (_) {
      return false;
    }
  }

  function renderRegistryDocsPlaceholderHtml() {
    return '<hr style="margin:12px 0"/>' +
      '<label class="muted" style="font-size:12px;font-weight:600">Документы (ТЗ и прочее)</label>' +
      '<div style="margin-top:8px;padding:14px;border:2px dashed var(--brd,var(--line));border-radius:8px;background:var(--bg-2,rgba(255,255,255,0.02))">' +
      '<p style="font-size:13px;margin:0 0 10px;line-height:1.45">① Заполните поля выше и нажмите <strong>Добавить</strong><br/>' +
      '② Затем загрузите ТЗ и другие файлы — кнопка и зона загрузки появятся здесь</p>' +
      '<button type="button" class="btn mini" disabled tabindex="-1" style="opacity:0.55;cursor:not-allowed">📎 Добавить файлы</button>' +
      '<span class="muted" style="font-size:11px;margin-left:8px">РП увидит документы в просчёте</span></div>';
  }

  function renderRegistryDocsHtml(docs, canEdit) {
    const esc = (s) => (window.AsgardUI && AsgardUI.esc) ? AsgardUI.esc(s) : String(s || '');
    let list = '';
    if (!docs || !docs.length) {
      list = '<div class="muted" style="font-size:12px;padding:8px 0">Документов пока нет.</div>';
    } else {
      list = '<div class="reg-docs-list" style="display:grid;gap:6px;margin-top:8px">' +
        docs.map((d) => {
          const label = esc(d.original_name || d.filename || d.name || 'файл');
          const href = esc(docDownloadHref(d));
          const delBtn = canEdit ? ' <button type="button" class="btn mini ghost reg-doc-del" data-id="' + d.id + '" title="Удалить">×</button>' : '';
          return '<div class="reg-docs-row" style="display:flex;align-items:center;gap:8px;font-size:13px">' +
            '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            (href ? '<a href="' + href + '" target="_blank" rel="noopener noreferrer">📄 ' + label + '</a>' : '📄 ' + label) +
            (d.size ? ' <span class="muted">(' + esc(formatDocBytes(d.size)) + ')</span>' : '') +
            '</span>' + delBtn + '</div>';
        }).join('') + '</div>';
    }
    const upload = canEdit
      ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">' +
        '<button type="button" class="btn mini" id="regDocsPick">📎 Добавить файлы</button>' +
        '<input type="file" id="regDocsInput" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.jpg,.jpeg,.png,.txt,.csv,.xml" style="display:none"/>' +
        '<span class="muted" style="font-size:11px">РП увидит документы в просчёте</span></div>' +
        '<div id="regDocsDrop" style="margin-top:8px;border:2px dashed var(--brd,var(--line));border-radius:8px;padding:12px;text-align:center;font-size:12px;color:var(--t3,var(--muted))">Перетащите файлы сюда</div>'
      : '';
    return '<hr style="margin:12px 0"/>' +
      '<label class="muted" style="font-size:12px">Документы (ТЗ и прочее)</label>' +
      upload + list;
  }

  function bindRegistryDocs(root, tenderId, onChange) {
    if (!root || !tenderId) return;
    const canEdit = canManageRegistryDocs();
    let docs = [];
    const toastFn = (msg, kind) => {
      if (window.AsgardUI && AsgardUI.toast) AsgardUI.toast(msg, kind);
    };

    function paint() {
      const host = root.querySelector('#regDocsHost');
      if (!host) return;
      host.innerHTML = renderRegistryDocsHtml(docs, canEdit);
      bindControls();
    }

    async function reload() {
      try {
        docs = await loadTenderDocs(tenderId);
      } catch (e) {
        docs = [];
        toastFn(e.message || 'Ошибка загрузки документов', 'err');
      }
      paint();
      onChange && onChange(docs);
    }

    async function uploadFiles(fileList) {
      if (!canEdit || !fileList || !fileList.length) return;
      let ok = 0;
      for (const f of Array.from(fileList)) {
        try {
          await uploadTenderFile(tenderId, f, 'Документ');
          ok++;
        } catch (e) {
          toastFn((f.name || 'файл') + ': ' + (e.message || e), 'err');
        }
      }
      if (ok) toastFn('Загружено файлов: ' + ok, 'ok');
      await reload();
    }

    function bindControls() {
      root.querySelector('#regDocsPick')?.addEventListener('click', () => {
        root.querySelector('#regDocsInput')?.click();
      });
      const input = root.querySelector('#regDocsInput');
      if (input) {
        input.onchange = (e) => {
          uploadFiles(e.target.files);
          e.target.value = '';
        };
      }
      const drop = root.querySelector('#regDocsDrop');
      if (drop) {
        drop.ondragover = (e) => { e.preventDefault(); drop.style.borderColor = 'var(--gold)'; };
        drop.ondragleave = () => { drop.style.borderColor = ''; };
        drop.ondrop = (e) => {
          e.preventDefault();
          drop.style.borderColor = '';
          uploadFiles(e.dataTransfer?.files);
        };
      }
      root.querySelectorAll('.reg-doc-del').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          if (!id || !confirm('Удалить документ?')) return;
          try {
            await deleteTenderDoc(id);
            toastFn('Документ удалён', 'ok');
            await reload();
          } catch (e) {
            toastFn(e.message || 'Ошибка удаления', 'err');
          }
        });
      });
    }

    reload();
  }

  function loadTenderDocs(tenderId) {
    return fetch('/api/files?tender_id=' + encodeURIComponent(tenderId) + '&limit=200&cascade=false', {
      headers: headers()
    }).then((r) => r.json().then((d) => {
      if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
      return d.files || d.rows || d.items || [];
    }));
  }

  function uploadTenderFile(tenderId, file, type) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('tender_id', String(tenderId));
    fd.append('type', type || 'Документ');
    return fetch('/api/files/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token() },
      body: fd
    }).then((r) => r.json().then((d) => {
      if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
      return d;
    }));
  }

  function deleteTenderDoc(docId) {
    return api('/api/files/' + docId, { method: 'DELETE' });
  }

  return {
    api,
    REGISTRY_STATUSES,
    buildRegistryPeriodOptions,
    periodLabel,
    fmtDate,
    fmtDateIso,
    loadRegistry(params) {
      const q = new URLSearchParams();
      q.set('subtab', params.subtab || 'registry');
      q.set('limit', String(params.limit != null ? params.limit : 500));
      if (params.periodFilter && window.TenderPeriodFilter) {
        window.TenderPeriodFilter.appendSearchParams(q, params.periodFilter);
      } else if (params.period !== undefined) {
        q.set('period', params.period);
      }
      if (params.date_from) q.set('date_from', params.date_from);
      if (params.date_to) q.set('date_to', params.date_to);
      if (params.date_field) q.set('date_field', params.date_field);
      if (params.burn) q.set('burn', '1');
      if (params.q) q.set('q', params.q);
      return api('/api/tenders/registry?' + q);
    },
    createRegistryRow(body) {
      return api('/api/tenders/registry', { method: 'POST', body: body || {} });
    },
    findRegistryDuplicates(opts) {
      const q = new URLSearchParams();
      if (opts?.title) q.set('title', opts.title);
      if (opts?.purchase_url) q.set('purchase_url', opts.purchase_url);
      return api('/api/tenders/registry/find-duplicates?' + q);
    },
    patchRegistryField(id, field, value) {
      return api('/api/tenders/registry/' + id, { method: 'PATCH', body: { field, value } });
    },
    patchRegistryStatus(id, body) {
      const payload = typeof body === 'string' ? { registry_status: body } : (body || {});
      return api('/api/tenders/registry/' + id + '/status', { method: 'PATCH', body: payload });
    },
    archiveRegistryRow(id, archive_reason) {
      return api('/api/tenders/registry/' + id + '/archive', {
        method: 'POST',
        body: { archive_reason: archive_reason || 'РП: не подаём — архив ТО' }
      });
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
      return api('/api/pm-duty/queue?tab=' + (tab || 'analysis'));
    },
    loadPmDutyRatingMe(window) {
      return api('/api/pm-duty/rating/me?window=' + encodeURIComponent(window || 'duty'));
    },
    loadPmDutyLeaderboard(window, limit) {
      return api('/api/pm-duty/rating/leaderboard?window=' + encodeURIComponent(window || '30') +
        (limit ? '&limit=' + limit : ''));
    },
    loadPmDutyRatingBreakdown(userId, window) {
      return api('/api/pm-duty/rating/' + userId + '/breakdown?window=' + encodeURIComponent(window || 'd30'));
    },
    loadRpReview(tenderId) {
      return api('/api/tenders/' + tenderId + '/rp-review');
    },
    saveRpReview(tenderId, body) {
      return api('/api/tenders/' + tenderId + '/rp-review', { method: 'PUT', body: body });
    },
    saveRpMyDraft(tenderId, body) {
      return api('/api/tenders/' + tenderId + '/rp-review/my-draft', { method: 'PUT', body: body || {} });
    },
    importRpDraft(tenderId, body) {
      return api('/api/tenders/' + tenderId + '/rp-review/import-draft', { method: 'POST', body: body || {} });
    },
    startRpQuick(tenderId, body) {
      return api('/api/tenders/' + tenderId + '/rp-review/start-quick', { method: 'POST', body: body || {} });
    },
    mimirApplyRpReview(tenderId, body) {
      return api('/api/tenders/' + tenderId + '/rp-review/mimir-apply', { method: 'POST', body: body || {} });
    },
    revokeRpCollaborator(tenderId, pmId) {
      return api('/api/tenders/' + tenderId + '/rp-review/invite/' + pmId, { method: 'DELETE' });
    },
    uploadRpDraftFile(tenderId, kind, file, phase) {
      const fd = new FormData();
      fd.append('file', file);
      const q = phase ? ('?phase=' + encodeURIComponent(phase)) : '';
      return fetch('/api/tenders/' + tenderId + '/rp-review/my-draft/' + kind + q, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token() },
        body: fd
      }).then((r) => r.json().then((d) => {
        if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
        return d;
      }));
    },
    uploadRpEstimate(tenderId, file) {
      const fd = new FormData();
      fd.append('file', file);
      return fetch('/api/tenders/' + tenderId + '/rp-review/estimate', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token() },
        body: fd
      }).then((r) => r.json().then((d) => {
        if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
        return d;
      }));
    },
    uploadRpReport(tenderId, file) {
      const fd = new FormData();
      fd.append('file', file);
      return fetch('/api/tenders/' + tenderId + '/rp-review/report', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token() },
        body: fd
      }).then((r) => r.json().then((d) => {
        if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
        return d;
      }));
    },
    uploadRpTkp(tenderId, file) {
      const fd = new FormData();
      fd.append('file', file);
      return fetch('/api/tenders/' + tenderId + '/rp-review/tkp', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token() },
        body: fd
      }).then((r) => r.json().then((d) => {
        if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
        return d;
      }));
    },
    directorDecisionRpReview(tenderId, body) {
      return api('/api/tenders/' + tenderId + '/rp-review/director-decision', { method: 'POST', body: body || {} });
    },
    loadDirectorReviewQueue() {
      return api('/api/tenders/director-review-queue');
    },
    loadDirectorReviewQueueCount() {
      return api('/api/tenders/director-review-queue/count');
    },
    markDirectorReviewSeen(tenderId) {
      return api('/api/tenders/' + tenderId + '/director-review-seen', { method: 'POST' });
    },
    inviteRpCollaborator(tenderId, pm_user_id) {
      return api('/api/tenders/' + tenderId + '/rp-review/invite', { method: 'POST', body: { pm_user_id } });
    },
    toDecisionRpReview(tenderId, body) {
      return api('/api/tenders/' + tenderId + '/rp-review/to-decision', { method: 'POST', body: body || {} });
    },
    loadRpReviewMessages(tenderId) {
      return api('/api/tenders/' + tenderId + '/rp-review/messages');
    },
    postRpReviewMessage(tenderId, body, files) {
      const fd = new FormData();
      fd.append('body', body || '');
      (files || []).forEach((f) => fd.append('file', f));
      return fetch('/api/tenders/' + tenderId + '/rp-review/messages', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token() },
        body: fd
      }).then((r) => r.json().then((d) => {
        if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
        return d;
      }));
    },
    suggestCustomers(q) {
      return fetch('/api/customers/suggest?q=' + encodeURIComponent(q) + '&type=party', { headers: headers() })
        .then((r) => r.json())
        .then((d) => d.suggestions || d.items || [])
        .catch(() => []);
    },
    assignRegistryCalculator(id, kind, user_id) {
      const body = { kind };
      if (user_id) body.user_id = user_id;
      return api('/api/tenders/registry/' + id + '/assign-calculator', { method: 'POST', body });
    },
    markRegistryReviewSeen(id) {
      return api('/api/tenders/registry/' + id + '/review-seen', { method: 'POST' });
    },
    loadRegistryHistory(id) {
      return api('/api/tenders/registry/' + id + '/history');
    },
    loadTenderComments(id) {
      return api('/api/tenders/' + id + '/comments');
    },
    loadUsers(role) {
      const q = role ? '?role=' + encodeURIComponent(role) + '&limit=200' : '?limit=200';
      return api('/api/users' + q).then((d) => d.users || d.items || []);
    },
    loadTenderDocs,
    uploadTenderFile,
    deleteTenderDoc,
    canManageRegistryDocs,
    formatDocBytes,
    docDownloadHref,
    renderRegistryDocsHtml,
    renderRegistryDocsPlaceholderHtml,
    bindRegistryDocs
  };
})();
