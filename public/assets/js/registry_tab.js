/**
 * Registry tab — unified TO tender spreadsheet (#/tenders → Реестр)
 * Action rows highlighted in-place; column sort with reset; default sort: action-first then deadline
 */
window.AsgardRegistryTab = (function () {
  const { esc, toast, showModal, hideModal } = AsgardUI;
  const API = AsgardRegistryApi;
  const timers = {};
  let mountEl = null;
  let state = { subtab: 'registry', period: 'year:2026', burnOnly: false, statusFilter: '', searchQ: '', searchInput: '', limit: 1000, sortKey: null, sortDir: 1 };
  let onRefreshCb = null;
  let onOpenWinCb = null;
  let pmsCache = [];
  let toUsersCache = [];
  let rowsCache = [];
  let clickBound = false;
  let deepLinkHandled = false;
  let dutyInfo = null;
  const STALE_MS = 62 * 24 * 60 * 60 * 1000;

  const DUTY_VIEW_ROLES = ['TO', 'HEAD_TO', 'ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const DUTY_ASSIGN_ROLES = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

  function dutyUser() {
    try {
      return JSON.parse(localStorage.getItem('asgard_user') || '{}');
    } catch (_) { return {}; }
  }

  function userCanDuty(roles) {
    const u = dutyUser();
    if (!u || !u.role) return false;
    if (u.role === 'ADMIN') return true;
    const rs = (window.AsgardAuth && typeof AsgardAuth.normalizeUserRoles === 'function')
      ? AsgardAuth.normalizeUserRoles(u)
      : (u.role ? [u.role] : []);
    return roles.some((r) => rs.includes(r));
  }

  function canViewDutyBar() {
    return userCanDuty(DUTY_VIEW_ROLES);
  }

  function canEditDutyRoster() {
    return userCanDuty(DUTY_ASSIGN_ROLES);
  }

  function renderDutyBar() {
    if (!canViewDutyBar()) return '';
    const pm = dutyInfo && dutyInfo.pm_name;
    const period = pm && dutyInfo.period_start
      ? esc(API.fmtDate(dutyInfo.period_start)) + ' — ' + esc(API.fmtDate(dutyInfo.period_end))
      : '';
    const inner = pm
      ? '🛡 Дежурный РП: <strong>' + esc(pm) + '</strong>' + (period ? ' · ' + period : '')
      : '<span class="muted">Дежурный РП не назначен на текущий период</span>';
    const editBtn = canEditDutyRoster()
      ? '<button type="button" class="btn mini" id="regOpenDutyRoster" style="margin-left:auto">График дежурств</button>'
      : '';
    return '<div class="reg-duty-bar alert" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;padding:10px 12px">' +
      '<span>' + inner + '</span>' + editBtn + '</div>';
  }

  const STATUS_CLASS = {
    рассмотрение: 'reg-st-review',
    готовим: 'reg-st-prep',
    подались: 'reg-st-submitted',
    выиграли: 'reg-st-won',
    проиграли: 'reg-st-lost',
    отмена: 'reg-st-cancel'
  };

  function currentUserRole() {
    try {
      const u = JSON.parse(localStorage.getItem('asgard_user') || '{}');
      return u.role || '';
    } catch (_) { return ''; }
  }

  const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

  function openRpReviewModal(row, opts) {
    if (!window.AsgardRpReviewModal) return;
    opts = opts || {};
    if (row.review_unread && API.markRegistryReviewSeen) {
      API.markRegistryReviewSeen(row.id).catch(function () {});
      row.review_unread = false;
    }
    const role = currentUserRole();
    const isTo = role === 'TO' || role === 'HEAD_TO' || role === 'ADMIN';
    const isDirector = DIRECTOR_ROLES.includes(role);
    const final = !!row.rp_review?.is_final;
    if (isDirector) {
      opts = Object.assign({ role: 'viewer', readOnly: true, mode: 'calc' }, opts);
    } else if (role === 'HEAD_TO' && !opts.forceEdit) {
      opts = Object.assign({
        role: final && opts.viewAsTo !== false ? 'to' : 'viewer',
        readOnly: true,
        mode: 'calc'
      }, opts);
    } else if (isTo && final && opts.viewAsTo !== false) {
      opts = Object.assign({ role: 'to', readOnly: true, mode: 'calc' }, opts);
    }
    AsgardRpReviewModal.open(row, pmsCache, refresh, opts);
  }

  function debounce(key, fn, delay) {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(fn, delay || 400);
  }

  function formatMoney(v) {
    if (v == null || v === '') return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
  }

  function tenderHasWork(row) {
    if (row.has_work === true || row.has_work === 't' || row.has_work === 1) return true;
    if (row.work_assigned_pm_id) return true;
    if (row.work_id) return true;
    return false;
  }

  function isTestGarbage(row) {
    const c = String(row.customer_name || '').trim();
    const t = String(row.tender_title || '').trim();
    const cl = c.toLowerCase();
    const tl = t.toLowerCase();
    if (/^st-/i.test(t) || /^st-/i.test(c)) return true;
    if (tl.includes('auto-tender') || cl.includes('auto-tender')) return true;
    if (cl === 'новый заказчик' && (!t || tl === 'новый тендер')) return true;
    if (!c && tl === 'новый тендер') return true;
    if (/<script|javascript:|<iframe|<embed|admin-matrix|conc-8 race|audit-3 update/i.test(t + c)) return true;
    if (/&#60;script|&lt;script/i.test(t + c)) return true;
    if (cl === 'ооо "валидация"' || cl.includes('кавычки & <теги>')) return true;
    if (row.source_pre_tender_id) return true;
    const comment = String(row.comment_to || '').toLowerCase();
    if (comment.includes('авто-tender из pre_tender') || comment.includes('создано из заявки #') || comment.includes('быстрый путь из заявки')) return true;
    const by = String(row.created_by_name || '');
    if (/^test (to|admin)$/i.test(by)) return true;
    return false;
  }

  function isStaleForActions(row) {
    const now = Date.now();
    if (row.docs_deadline) {
      const dl = new Date(row.docs_deadline).getTime();
      if (!Number.isNaN(dl) && dl < now - STALE_MS) return true;
    }
    const period = String(row.period || '');
    if (period && period < '2026-01') return true;
    return false;
  }

  /** Новые сверху: срок подачи → период → id (не created_at — сбивается при импорте). */
  function compareRecencyDesc(a, b) {
    const da = a.docs_deadline ? new Date(a.docs_deadline).getTime() : -Infinity;
    const db = b.docs_deadline ? new Date(b.docs_deadline).getTime() : -Infinity;
    if (da !== db) return db - da;
    const pa = String(a.period || '');
    const pb = String(b.period || '');
    if (pa !== pb) return pb.localeCompare(pa);
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  }

  const STATUS_ORDER = { рассмотрение: 0, готовим: 1, подались: 2, выиграли: 3, проиграли: 4, отмена: 5 };

  const STATUS_LEGEND = [
    { value: 'рассмотрение', label: 'Рассмотрение', cls: 'reg-st-review' },
    { value: 'готовим', label: 'Готовим', cls: 'reg-st-prep' },
    { value: 'подались', label: 'Подались', cls: 'reg-st-submitted' },
    { value: 'выиграли', label: 'Выиграли', cls: 'reg-st-won' },
    { value: 'проиграли', label: 'Проиграли', cls: 'reg-st-lost' },
    { value: 'отмена', label: 'Отмена', cls: 'reg-st-cancel' }
  ];

  const SORT_COLUMNS = [
    { key: 'registry_no', label: '№' },
    { key: 'customer_name', label: 'Заказчик' },
    { key: 'tender_title', label: 'Тендер' },
    { key: 'tender_price', label: 'НМЦ' },
    { key: 'docs_deadline', label: 'Срок' },
    { key: 'registry_status', label: 'Статус' },
    { key: 'calculator_user_name', label: 'Считает' },
    { key: '_rp_sort', label: 'Отчёт' },
    { key: '_score_pct', label: 'Скор' },
    { key: 'created_by_name', label: 'Внёс' },
    { key: 'created_at', label: 'Добавлен' },
    { key: 'comment_to', label: 'Коммент.' },
    { key: '_action_sort', label: 'Действие' }
  ];

  function getRowActionState(row) {
    const st = row.registry_status || 'рассмотрение';
    const rev = row.rp_review;
    if (st === 'выиграли' && !tenderHasWork(row)) {
      return { needs: true, type: 'won', label: 'Создать работу', tone: 'success' };
    }
    if (st !== 'рассмотрение') {
      return { needs: false, type: null, label: '', tone: null };
    }
    if (rev && rev.director_review_status === 'pending') {
      return { needs: true, type: 'director_wait', label: 'Согласование директора', tone: 'warn' };
    }
    if (rev && rev.is_final) {
      return { needs: true, type: 'decide', label: 'Решение по отчёту', tone: 'info' };
    }
    if (rev && rev.analysis_finalized_at && !rev.is_final) {
      return { needs: true, type: 'analysis_assign', label: 'Анализ готов — назначьте РП', tone: 'info' };
    }
    return { needs: true, type: 'wait', label: 'Ждёт анализ РП', tone: 'warn' };
  }

  function actionSortRank(row) {
    const a = getRowActionState(row);
    if (!a.needs) return 99;
    const ranks = { won: 0, decide: 1, analysis_assign: 2, assign: 3, draft: 4, wait: 5 };
    return ranks[a.type] != null ? ranks[a.type] : 50;
  }

  function rpSortRank(row) {
    const rev = row.rp_review;
    if (rev && rev.is_final) return 3;
    if (rev && rev.analysis_finalized_at && !rev.is_final) return 2;
    if (rev && !rev.is_final) return 1;
    return 0;
  }

  function sortFieldValue(row, key) {
    switch (key) {
      case 'registry_no':
        return row.registry_no != null ? Number(row.registry_no) : (Number(row.id) || 0);
      case 'tender_price':
        return row.tender_price != null && Number.isFinite(Number(row.tender_price)) ? Number(row.tender_price) : -Infinity;
      case 'docs_deadline':
        return row.docs_deadline ? new Date(row.docs_deadline).getTime() : -Infinity;
      case 'created_at':
        return row.created_at ? new Date(row.created_at).getTime() : -Infinity;
      case 'registry_status':
        return STATUS_ORDER[row.registry_status || 'рассмотрение'] != null
          ? STATUS_ORDER[row.registry_status || 'рассмотрение'] : 9;
      case 'calculator_user_name':
        return row.calculator_user_name || row.rp_review?.calculator_name || '';
      case '_rp_sort':
        return rpSortRank(row);
      case '_score_pct':
        return row.score?.win_chance_pct != null ? Number(row.score.win_chance_pct) : -Infinity;
      case '_action_sort':
        return actionSortRank(row);
      default:
        return row[key] != null ? row[key] : '';
    }
  }

  function compareField(a, b, key) {
    const av = sortFieldValue(a, key);
    const bv = sortFieldValue(b, key);
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av).localeCompare(String(bv), 'ru', { sensitivity: 'base' });
  }

  function sortRows(rows) {
    if (!state.sortKey) {
      return rows.slice().sort((a, b) => {
        const na = getRowActionState(a).needs ? 0 : 1;
        const nb = getRowActionState(b).needs ? 0 : 1;
        if (na !== nb) return na - nb;
        return compareRecencyDesc(a, b);
      });
    }
    const key = state.sortKey;
    const dir = state.sortDir;
    return rows.slice().sort((a, b) => dir * compareField(a, b, key));
  }

  function countActionRows(rows) {
    return rows.filter((r) => getRowActionState(r).needs).length;
  }

  function renderSortTh(key, label) {
    const active = state.sortKey === key;
    const ind = active ? (state.sortDir === 1 ? '▲' : '▼') : '';
    return '<th><button type="button" class="reg-th-sort' + (active ? ' reg-th-sort-active' : '') + '" data-sort="' + key + '">' +
      esc(label) + (ind ? ' <span class="reg-sort-ind">' + ind + '</span>' : '') + '</button></th>';
  }

  function filterRows(rows) {
    let list = rows.filter((r) => !isTestGarbage(r));
    if (state.statusFilter) list = list.filter((r) => (r.registry_status || 'рассмотрение') === state.statusFilter);
    return list;
  }

  function scoreTooltip(score) {
    if (!score || !score.top_reject_reasons) return '';
    return score.top_reject_reasons.map((r) => (r.reason || r.label || r) + (r.count ? ' (' + r.count + ')' : '')).join('\n');
  }

  function statusLabel(st) {
    const hit = API.REGISTRY_STATUSES.find((s) => s.value === st);
    return hit ? hit.label : st;
  }

  function statusPill(st, rowId) {
    const cls = STATUS_CLASS[st] || '';
    return '<button type="button" class="pill reg-status-pill reg-status-change ' + cls + '" data-id="' + rowId + '" title="Нажмите, чтобы сменить статус">' + esc(statusLabel(st)) + '</button>';
  }

  async function applyStatusChange(row, nextStatus) {
    const st = row.registry_status || 'рассмотрение';
    if (nextStatus === st) return;
    if (nextStatus === 'проиграли' && window.AsgardLossReasonModal) {
      return new Promise((resolve) => {
        AsgardLossReasonModal.open(row, (payload) => API.patchRegistryStatus(row.id, payload).then(() => {
          refresh();
          onRefreshCb && onRefreshCb();
          resolve();
        }), () => resolve());
      });
    }
    await API.patchRegistryStatus(row.id, nextStatus);
    if (nextStatus === 'выиграли') {
      openWinModal(row);
    }
    toast('Статус: ' + statusLabel(nextStatus), 'ok');
    refresh();
    onRefreshCb && onRefreshCb();
  }

  function openStatusModal(row) {
    const st = row.registry_status || 'рассмотрение';
    const html = '<p class="muted" style="margin:0 0 10px;font-size:13px">' + esc(row.customer_name || '') + ' — ' + esc((row.tender_title || '').slice(0, 80)) + '</p>' +
      '<label>Статус<select class="inp" id="regStatusPick" style="width:100%;margin-top:4px">' +
      API.REGISTRY_STATUSES.map((s) =>
        '<option value="' + s.value + '"' + (st === s.value ? ' selected' : '') + '>' + esc(s.label) + '</option>'
      ).join('') + '</select></label>' +
      '<p class="muted" style="font-size:11px;margin:10px 0 0">Отчёт РП «Подаём» → <strong>Готовим</strong>. «Подались» — когда заявку реально подали на площадке.</p>' +
      '<div style="display:flex;gap:8px;margin-top:14px">' +
      '<button type="button" class="btn" id="regStatusSave">Сохранить</button>' +
      '<button type="button" class="btn ghost" id="regStatusCancel">Отмена</button></div>';
    showModal({
      title: 'Статус тендера #' + row.id,
      html,
      onMount: () => {
        document.getElementById('regStatusCancel')?.addEventListener('click', hideModal);
        document.getElementById('regStatusSave')?.addEventListener('click', async () => {
          const next = document.getElementById('regStatusPick')?.value || st;
          try {
            await applyStatusChange(row, next);
            hideModal();
          } catch (e) { toast(e.message, 'err'); }
        });
      }
    });
  }

  function fmtAdded(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (_) { return '—'; }
  }

  function renderCustomerCell(row) {
    const name = row.customer_name || '—';
    const inn = row.customer_inn
      ? '<small class="muted" style="display:block;font-size:10px;margin-top:2px">ИНН ' + esc(row.customer_inn) + '</small>'
      : '';
    return '<span class="reg-cell-text reg-customer" title="' + esc(name) + '">' + esc(name) + '</span>' + inn;
  }

  function bindFormCustomerSuggest(inp) {
    if (!inp || inp._regSuggestBound) return;
    inp._regSuggestBound = true;
    const wrap = inp.closest('label') || inp.parentElement;
    if (!wrap) return;
    wrap.style.position = 'relative';
    let dd = wrap.querySelector('.reg-form-cust-dd');
    if (!dd) {
      dd = document.createElement('div');
      dd.className = 'reg-form-cust-dd';
      dd.style.cssText = 'display:none;position:absolute;left:0;right:0;top:100%;z-index:300;background:var(--bg);border:1px solid var(--brd);max-height:220px;overflow:auto;box-shadow:0 6px 16px rgba(0,0,0,.35)';
      wrap.appendChild(dd);
    }
    inp.addEventListener('input', () => {
      const v = inp.value.trim();
      if (v.length < 2) { dd.style.display = 'none'; return; }
      debounce('form-suggest', () => {
        API.suggestCustomers(v).then((items) => {
          if (!items.length) { dd.style.display = 'none'; return; }
          dd.innerHTML = items.slice(0, 8).map((it) => {
            const name = it.name || it.value || it.label || '';
            const inn = it.inn || '';
            const addr = it.address || '';
            return '<div class="reg-cust-opt" data-name="' + esc(name) + '" data-inn="' + esc(inn) + '" style="padding:6px 8px;cursor:pointer;border-bottom:1px solid var(--brd)">' +
              esc(name) +
              (inn ? '<br/><small class="muted">ИНН ' + esc(inn) + '</small>' : '') +
              (addr ? '<br/><small class="muted">' + esc(String(addr).slice(0, 60)) + '</small>' : '') +
              '</div>';
          }).join('');
          dd.style.display = 'block';
          dd.querySelectorAll('.reg-cust-opt').forEach((opt) => {
            opt.addEventListener('mousedown', (e) => {
              e.preventDefault();
              inp.value = opt.dataset.name;
              if (opt.dataset.inn) inp.dataset.inn = opt.dataset.inn;
              dd.style.display = 'none';
            });
          });
        });
      }, 300);
    });
    inp.addEventListener('blur', () => setTimeout(() => { dd.style.display = 'none'; }, 150));
  }

  function renderPurchaseCell(row) {
    if (row.purchase_url) {
      return '<a href="' + esc(row.purchase_url) + '" target="_blank" rel="noopener noreferrer" class="btn mini ghost" title="Ссылка на закупку">↗</a>';
    }
    return '<span class="muted">—</span>';
  }

  function openDetail(row) {
    if (window.AsgardRegistryDetail) {
      AsgardRegistryDetail.open(row, refresh);
      return;
    }
    openRowFormModal(row, false);
  }

  function openRowFormModal(row, isNew) {
    const st = row.registry_status || 'рассмотрение';
    const dl = row.docs_deadline ? API.fmtDateIso(row.docs_deadline) : '';
    let tenderId = row.id || null;
    let savedNew = false;

    function formHtml(showDocs) {
      const docsBlock = showDocs
        ? '<div id="regDocsHost"></div>'
        : (isNew ? API.renderRegistryDocsPlaceholderHtml() : '<div id="regDocsHost"></div>');
      return '<div class="reg-form-modal" style="display:grid;gap:10px">' +
        '<label style="position:relative">Заказчик <small class="muted">(название или ИНН — подскажем из ДаДата)</small>' +
        '<input class="inp" id="regFormCustomer" data-inn="' + esc(row.customer_inn || '') + '" value="' + esc(row.customer_name || '') + '" placeholder="Начните вводить…" style="width:100%;margin-top:4px"' + (showDocs ? ' disabled' : '') + '/></label>' +
        '<label>Тендер<input class="inp" id="regFormTitle" value="' + esc(row.tender_title || '') + '" style="width:100%;margin-top:4px"' + (showDocs ? ' disabled' : '') + '/></label>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<label>НМЦ<input class="inp" id="regFormPrice" type="number" value="' + (row.tender_price != null ? row.tender_price : '') + '" style="width:100%;margin-top:4px"' + (showDocs ? ' disabled' : '') + '/></label>' +
        '<label>Срок<input class="inp" id="regFormDeadline" type="date" value="' + dl + '" style="width:100%;margin-top:4px"' + (showDocs ? ' disabled' : '') + '/></label></div>' +
        '<label>Ссылка на закупку<input class="inp" id="regFormPurchaseUrl" type="url" value="' + esc(row.purchase_url || '') + '" placeholder="zakupki.gov.ru / B2B…" style="width:100%;margin-top:4px"' + (showDocs ? ' disabled' : '') + '/></label>' +
        '<label>Статус<select class="inp" id="regFormStatus" style="width:100%;margin-top:4px"' + (showDocs ? ' disabled' : '') + '>' +
        API.REGISTRY_STATUSES.map((s) =>
          '<option value="' + s.value + '"' + (st === s.value ? ' selected' : '') + '>' + esc(s.label) + '</option>'
        ).join('') + '</select></label>' +
        '<label>Комментарий<textarea class="inp" id="regFormComment" rows="3" style="width:100%;margin-top:4px"' + (showDocs ? ' disabled' : '') + '>' + esc(row.comment_to || '') + '</textarea></label>' +
        docsBlock +
        '<div style="display:flex;gap:8px;margin-top:4px">' +
        (showDocs
          ? '<button type="button" class="btn" id="regFormDone">Готово</button>'
          : '<button type="button" class="btn" id="regFormSave">' + (isNew ? 'Добавить' : 'Сохранить') + '</button>') +
        '<button type="button" class="btn ghost" id="regFormCancel">' + (showDocs ? 'Закрыть' : 'Отмена') + '</button></div></div>';
    }

    function mountForm(showDocs) {
      const root = document.querySelector('.reg-form-modal')?.closest('.modal-body') || document.querySelector('.reg-form-modal')?.parentElement;
      const modalRoot = document.querySelector('.reg-form-modal');
      if (!showDocs) {
        bindFormCustomerSuggest(document.getElementById('regFormCustomer'));
      }
      document.getElementById('regFormCancel')?.addEventListener('click', () => {
        hideModal();
        if (savedNew || !isNew) {
          refresh();
          onRefreshCb && onRefreshCb();
        }
      });
      if (showDocs && tenderId && modalRoot) {
        API.bindRegistryDocs(modalRoot, tenderId);
        setTimeout(() => {
          modalRoot.querySelector('#regDocsHost')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 80);
      }
      document.getElementById('regFormDone')?.addEventListener('click', () => {
        hideModal();
        refresh();
        onRefreshCb && onRefreshCb();
      });
      document.getElementById('regFormSave')?.addEventListener('click', async () => {
        const custInp = document.getElementById('regFormCustomer');
        const body = {
          customer_name: custInp?.value?.trim() || '',
          customer_inn: custInp?.dataset?.inn?.trim() || null,
          tender_title: document.getElementById('regFormTitle')?.value?.trim() || '',
          tender_price: (() => {
            const v = document.getElementById('regFormPrice')?.value;
            return v === '' || v == null ? null : Number(v);
          })(),
          docs_deadline: document.getElementById('regFormDeadline')?.value || null,
          purchase_url: document.getElementById('regFormPurchaseUrl')?.value?.trim() || null,
          comment_to: document.getElementById('regFormComment')?.value || ''
        };
        const nextStatus = document.getElementById('regFormStatus')?.value || st;
        try {
          if (isNew) {
            if (!body.customer_name && !body.tender_title) {
              toast('Укажите заказчика или тендер', 'err');
              return;
            }
            const res = await API.createRegistryRow(Object.assign({}, body, { registry_status: nextStatus }));
            tenderId = res.tender?.id || res.id;
            savedNew = true;
            toast('Строка добавлена — загрузите документы ниже', 'ok');
            if (typeof AsgardUI.replaceModal === 'function') {
              AsgardUI.replaceModal({
                title: 'Загрузите документы · строка #' + tenderId,
                html: formHtml(true),
                wide: true
              });
            } else {
              hideModal();
              showModal({
                title: 'Загрузите документы · строка #' + tenderId,
                html: formHtml(true),
                wide: true,
                onMount: () => mountForm(true)
              });
              return;
            }
            mountForm(true);
          } else {
            const fields = ['customer_name', 'customer_inn', 'tender_title', 'tender_price', 'docs_deadline', 'purchase_url', 'comment_to'];
            for (const f of fields) {
              if (body[f] !== (row[f] != null ? row[f] : (f === 'tender_price' || f === 'docs_deadline' ? null : ''))) {
                await API.patchRegistryField(row.id, f, body[f]);
              }
            }
            if (nextStatus !== st) {
              await applyStatusChange(row, nextStatus);
              hideModal();
              refresh();
              onRefreshCb && onRefreshCb();
              return;
            }
            toast('Сохранено', 'ok');
            hideModal();
            refresh();
            onRefreshCb && onRefreshCb();
          }
        } catch (e) { toast(e.message, 'err'); }
      });
    }

    showModal({
      title: isNew ? 'Новая строка реестра' : 'Редактирование #' + row.id,
      html: formHtml(!!tenderId && !isNew),
      wide: true,
      onMount: () => mountForm(!!tenderId && !isNew)
    });
  }

  function openAddRowModal() {
    openRowFormModal({
      customer_name: '',
      tender_title: '',
      tender_price: null,
      docs_deadline: null,
      registry_status: 'рассмотрение',
      comment_to: ''
    }, true);
  }

  function rpCell(row) {
    const rev = row.rp_review;
    if (rev && rev.director_review_status === 'pending') {
      return '<button type="button" class="pill warn reg-rp-view" data-id="' + row.id + '">У директора</button>';
    }
    if (rev && rev.is_final) {
      return '<button type="button" class="pill ok reg-rp-view" data-id="' + row.id + '">Отчёт готов</button>';
    }
    if (rev && rev.analysis_finalized_at && !rev.is_final) {
      return '<button type="button" class="pill ok reg-rp-view" data-id="' + row.id + '">Анализ готов</button>';
    }
    if (rev && !rev.is_final) {
      return '<button type="button" class="pill warn reg-rp-view" data-id="' + row.id + '">Черновик</button>';
    }
    return '<span class="pill muted">ожидает</span>';
  }

  function actionControls(row, action) {
    if (!action.needs) return '';
    if (action.type === 'won') {
      const opts = pmsCache.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
      return '<select class="inp reg-win-pm" data-id="' + row.id + '" style="min-width:140px;font-size:12px"><option value="">РП на работу</option>' + opts +
        '</select><button type="button" class="btn mini reg-win-go" data-id="' + row.id + '">OK</button>';
    }
    if (action.type === 'decide') {
      return '<button type="button" class="pill ok mini reg-rp-view" data-id="' + row.id + '">Смотреть отчёт</button>';
    }
    if (action.type === 'draft') {
      return '<button type="button" class="btn mini ghost reg-rp-view" data-id="' + row.id + '">Открыть</button>';
    }
    if (action.type === 'analysis_assign') {
      const pmOpts = pmsCache.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
      const calcName = row.calculator_user_name || row.rp_review?.calculator_name || '';
      let h = '<button type="button" class="btn mini ghost reg-rp-view" data-id="' + row.id + '">Открыть</button>';
      h += '<button type="button" class="btn mini ghost reg-self-calc" data-id="' + row.id + '">Считаю сам</button>';
      h += '<select class="inp reg-assign-pm" data-id="' + row.id + '" style="min-width:120px;font-size:11px"><option value="">РП</option>' + pmOpts + '</select>';
      h += '<button type="button" class="btn mini reg-assign-go" data-id="' + row.id + '">→</button>';
      if (calcName) {
        h += '<span class="muted" style="font-size:11px;margin-left:4px">' + esc(calcName) + ' считает</span>';
      }
      return h;
    }
    if (action.type === 'assign') {
      const pmOpts = pmsCache.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
      return '<button type="button" class="btn mini ghost reg-self-calc" data-id="' + row.id + '">Считаю сам</button>' +
        '<select class="inp reg-assign-pm" data-id="' + row.id + '" style="min-width:120px;font-size:11px"><option value="">РП</option>' + pmOpts + '</select>' +
        '<button type="button" class="btn mini reg-assign-go" data-id="' + row.id + '">→</button>';
    }
    if (action.type === 'director_wait') {
      return '<span class="pill warn">Ожидает директора</span>' +
        '<button type="button" class="btn mini ghost reg-rp-view" data-id="' + row.id + '" style="margin-left:6px">Открыть</button>';
    }
    if (action.type === 'wait') {
      const calcName = row.calculator_user_name || row.rp_review?.calculator_name || '';
      return calcName
        ? '<span class="muted" style="font-size:11px">' + esc(calcName) + ' считает</span>'
        : '<span class="pill warn">Ждёт анализ РП</span>';
    }
    return '';
  }

  function renderActionCell(row) {
    const action = getRowActionState(row);
    if (!action.needs) return '<span class="muted">—</span>';
    const controls = actionControls(row, action);
    return '<div class="reg-action-head reg-action-tone-' + action.tone + '">' +
      '<span class="reg-action-dot"></span>' +
      '<span class="reg-action-label">' + esc(action.label) + '</span></div>' +
      (controls ? '<div class="reg-action-controls">' + controls + '</div>' : '');
  }

  function openWinModal(tender) {
    if (typeof onOpenWinCb === 'function') { onOpenWinCb(tender); return; }
    const html = '<p>' + esc(tender.customer_name) + ' — ' + esc(tender.tender_title) + '</p>' +
      '<label>РП на работу<select class="inp" id="winWorkPm" style="width:100%;margin-top:4px"><option value="">— выберите —</option></select></label>' +
      '<div style="display:flex;gap:8px;margin-top:16px">' +
      '<button type="button" class="btn" id="winWorkSubmit">Создать работу</button>' +
      '<button type="button" class="btn ghost" id="winWorkCancel">Отмена</button></div>';
    showModal({
      title: 'Выиграли — создать работу',
      html,
      wide: true,
      onMount: () => {
        const sel = document.getElementById('winWorkPm');
        pmsCache.forEach((p) => {
          const o = document.createElement('option');
          o.value = p.id;
          o.textContent = p.name;
          if (tender.responsible_pm_id === p.id) o.selected = true;
          sel.appendChild(o);
        });
        document.getElementById('winWorkCancel')?.addEventListener('click', hideModal);
        document.getElementById('winWorkSubmit')?.addEventListener('click', async () => {
          const pmId = Number(document.getElementById('winWorkPm')?.value);
          if (!pmId) { toast('Выберите РП', 'err'); return; }
          try {
            await API.createRegistryWork(tender.id, pmId);
            toast('Работа создана', 'ok');
            hideModal();
            refresh();
            onRefreshCb && onRefreshCb();
          } catch (e) { toast(e.message, 'err'); }
        });
      }
    });
  }

  function renderLegend() {
    let h = '<div class="reg-status-legend">';
    STATUS_LEGEND.forEach((s) => {
      const active = state.statusFilter === s.value ? ' active' : '';
      h += '<button type="button" class="reg-legend-chip' + active + ' ' + s.cls + '" data-leg="' + s.value + '">' +
        '<span class="reg-legend-swatch"></span>' + esc(s.label) + '</button>';
    });
    if (state.statusFilter) {
      h += '<button type="button" class="btn mini ghost" id="regLegendClear">Все</button>';
    }
    return h + '</div>';
  }

  function handleDeepLink(rows) {
    if (deepLinkHandled || !rows.length) return;
    const hash = location.hash || '';
    const qs = hash.includes('?') ? hash.split('?')[1] : '';
    const params = new URLSearchParams(qs);
    const tid = params.get('id') || params.get('open');
    if (!tid) return;
    const row = rows.find((r) => String(r.id) === String(tid));
    if (!row) return;
    deepLinkHandled = true;
    const extra = params.get('rp') === 'chat' ? { initialTab: 'thread' } : {};
    openRpReviewModal(row, Object.assign({ viewAsTo: true }, extra));
  }

  function renderToolbar(total, periodOptions, actionCount) {
    const opts = periodOptions.map((o) =>
      '<option value="' + esc(o.value) + '"' + (o.value === state.period ? ' selected' : '') + '>' + esc(o.label) + '</option>'
    ).join('');
    const statusOpts = '<option value="">Все статусы</option>' + API.REGISTRY_STATUSES.map((s) =>
      '<option value="' + s.value + '"' + (state.statusFilter === s.value ? ' selected' : '') + '>' + esc(s.label) + '</option>'
    ).join('');
    return '<div class="reg-toolbar" style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<input class="inp" id="regSearchInp" placeholder="Заказчик, № реестра, предмет…" value="' + esc(state.searchInput) + '" style="min-width:220px;max-width:320px"/>' +
      '<label style="display:flex;align-items:center;gap:6px"><span class="muted" style="font-size:13px">Период:</span>' +
      '<select class="inp" id="regPeriodSel">' + opts + '</select></label>' +
      '<label style="display:flex;align-items:center;gap:6px"><span class="muted" style="font-size:13px">Статус:</span>' +
      '<select class="inp" id="regStatusSel">' + statusOpts + '</select></label>' +
      '<span class="muted" style="font-size:13px">' + total + ' тендеров' +
      (actionCount ? ' · ' + actionCount + ' нуждают действия' : '') +
      (state.burnOnly ? ' · горящие' : '') + '</span>' +
      '<label style="display:flex;align-items:center;gap:6px"><span class="muted" style="font-size:13px">Строк:</span>' +
      '<select class="inp" id="regLimitSel" style="min-width:72px">' +
      [100, 500, 1000, 2000].map((n) =>
        '<option value="' + n + '"' + (state.limit === n ? ' selected' : '') + '>' + (n >= 1000 ? (n / 1000) + 'k' : String(n)) + '</option>'
      ).join('') + '</select></label>' +
      '<button type="button" class="btn mini ghost" id="regSortReset"' + (state.sortKey ? '' : ' hidden') + '>↺ Сброс сортировки</button>' +
      '<button type="button" class="btn mini" id="regAddRow">+ Строка</button>' +
      '<button type="button" class="btn mini ghost" id="regRefresh">↻</button>' +
      '<a href="#/pm-calculations" class="btn mini ghost">Просчёты РП</a>' +
      '</div>' +
      '<p class="muted reg-toolbar-hint" style="font-size:12px;margin:-4px 0 10px">ℹ Статус — клик по плашке. Редактирование — двойной клик или ⋯. Сортировка — клик по заголовку колонки.</p>';
  }

  function renderRow(row) {
    const st = row.registry_status || 'рассмотрение';
    const cls = STATUS_CLASS[st] || '';
    const action = getRowActionState(row);
    const rpPill = rpCell(row);
    const score = row.score;
    const scoreTxt = score ? score.win_chance_pct + '% (' + (score.tenders_count || 0) + ')' : '—';
    const scoreTitle = esc(scoreTooltip(score));
    const calcName = row.calculator_user_name || row.rp_review?.calculator_name || '—';
    const commentPrev = row.comment_to ? esc(String(row.comment_to).slice(0, 40)) + (String(row.comment_to).length > 40 ? '…' : '') : '';
    const title = row.tender_title || '—';
    const docIcon = (row.doc_count > 0) ? '<span title="Есть документы" style="margin-right:4px">📎</span>' : '';
    const actionCls = action.needs ? ' reg-row-needs-action reg-action-tone-' + action.tone : '';
    const unreadCls = row.review_unread ? ' reg-row-unread' : '';
    const regNo = row.registry_no != null ? row.registry_no : row.id;
    return '<tr class="reg-row ' + cls + actionCls + unreadCls + '" data-id="' + row.id + '">' +
      '<td class="reg-no-cell" title="ID: ' + row.id + '"><div class="reg-no-main">' + esc(regNo) + '</div>' +
      '<div class="reg-no-sub">id ' + row.id + '</div></td>' +
      '<td class="reg-editable">' + renderCustomerCell(row) + '</td>' +
      '<td class="reg-editable"><span class="reg-cell-text reg-title" title="' + esc(title) + '">' + docIcon + esc(title) + '</span></td>' +
      '<td class="reg-editable"><span class="reg-cell-text reg-price-text" title="' + esc(formatMoney(row.tender_price)) + '">' + esc(formatMoney(row.tender_price)) + '</span></td>' +
      '<td class="reg-editable"><span class="reg-cell-text">' + esc(API.fmtDate(row.docs_deadline)) + '</span></td>' +
      '<td>' + statusPill(st, row.id) + '</td>' +
      '<td class="muted" style="font-size:12px">' + esc(calcName) + '</td>' +
      '<td>' + rpPill + '</td>' +
      '<td title="' + scoreTitle + '">' + esc(scoreTxt) + '</td>' +
      '<td class="muted" style="font-size:11px">' + esc(row.created_by_name || '—') + '</td>' +
      '<td class="muted" style="font-size:11px;white-space:nowrap" title="' + esc(row.created_at || '') + '">' + esc(fmtAdded(row.created_at)) + '</td>' +
      '<td class="muted" style="font-size:11px" title="' + esc(row.comment_to || '') + '">' + (commentPrev || '—') + '</td>' +
      '<td class="reg-purchase-cell">' + renderPurchaseCell(row) + '</td>' +
      '<td class="reg-action-cell">' + renderActionCell(row) + '</td>' +
      '<td><button type="button" class="btn mini ghost reg-detail" data-id="' + row.id + '" title="Карточка">⋯</button></td>' +
      '</tr>';
  }

  function renderTableHead() {
    return SORT_COLUMNS.map((c) => renderSortTh(c.key, c.label)).join('') +
      '<th class="reg-th-nosort" title="Ссылка на закупку">↗</th>' +
      '<th class="reg-th-nosort"></th>';
  }

  function renderTable(rows) {
    const filtered = filterRows(rows);
    const sorted = sortRows(filtered);
    let html = '<div class="reg-table-wrap" style="overflow-x:auto"><table class="tnd-table asg reg-table" style="width:100%;font-size:13px"><thead><tr>' +
      renderTableHead() +
      '</tr></thead><tbody>';
    sorted.forEach((row) => { html += renderRow(row); });
    html += '</tbody></table></div>';
    const shown = sorted.length;
    html += '<div class="reg-footer muted" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:13px">' +
      '<span>Всего: <strong>' + (state.totalCount != null ? state.totalCount : shown) + '</strong></span>' +
      '<span>Показано: <strong>' + shown + '</strong> из ' + (state.totalCount != null ? state.totalCount : shown) + '</span>' +
      (state.totalCount != null && state.totalCount > shown
        ? '<span class="muted">· загружено ' + rows.length + ', увеличьте «Строк»</span>' : '') +
      '</div>';
    if (!rows.length) {
      html += '<p class="muted">' + (state.burnOnly ? 'Нет горящих дедлайнов' : 'Нет записей за период') + '</p>';
    }
    return html;
  }

  function rerenderTable() {
    if (!mountEl) return;
    const periodOptions = API.buildRegistryPeriodOptions();
    const actionCount = countActionRows(filterRows(rowsCache));
    const wrap = mountEl.querySelector('.reg-table-wrap');
    const footer = mountEl.querySelector('.reg-footer');
    if (wrap) {
      const sorted = sortRows(filterRows(rowsCache));
      const tbody = wrap.querySelector('tbody');
      const thead = wrap.querySelector('thead tr');
      if (tbody) tbody.innerHTML = sorted.map((row) => renderRow(row)).join('');
      if (thead) thead.innerHTML = renderTableHead();
      if (footer) {
        const shown = sorted.length;
        footer.innerHTML = '<span>Всего: <strong>' + (state.totalCount != null ? state.totalCount : shown) + '</strong></span>' +
          '<span>Показано: <strong>' + shown + '</strong> из ' + (state.totalCount != null ? state.totalCount : shown) + '</span>' +
          (state.totalCount != null && state.totalCount > shown
            ? '<span class="muted">· загружено ' + rowsCache.length + ', увеличьте «Строк»</span>' : '');
      }
      const resetBtn = document.getElementById('regSortReset');
      if (resetBtn) resetBtn.hidden = !state.sortKey;
      const countSpan = mountEl.querySelector('.reg-toolbar .muted');
      if (countSpan) {
        countSpan.innerHTML = (state.totalCount != null ? state.totalCount : rowsCache.length) + ' тендеров' +
          (actionCount ? ' · ' + actionCount + ' нуждают действия' : '') +
          (state.burnOnly ? ' · горящие' : '');
      }
      const legWrap = mountEl.querySelector('.reg-status-legend');
      if (legWrap && legWrap.parentNode) {
        const newLeg = document.createElement('div');
        newLeg.innerHTML = renderLegend();
        legWrap.parentNode.replaceChild(newLeg.firstChild, legWrap);
        bindLegendHandlers();
      }
      bindTable(rowsCache);
      bindSortHandlers();
    } else {
      mountEl.innerHTML = renderToolbar(state.totalCount, periodOptions, actionCount) +
        renderLegend() + renderTable(rowsCache);
      bindDetailDelegation();
      bindTable(rowsCache);
      bindSortHandlers();
      bindToolbarHandlers(periodOptions);
      bindLegendHandlers();
    }
  }

  function bindLegendHandlers() {
    mountEl.querySelectorAll('.reg-legend-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-leg') || '';
        state.statusFilter = state.statusFilter === v ? '' : v;
        const sel = document.getElementById('regStatusSel');
        if (sel) sel.value = state.statusFilter;
        rerenderTable();
      });
    });
    document.getElementById('regLegendClear')?.addEventListener('click', () => {
      state.statusFilter = '';
      const sel = document.getElementById('regStatusSel');
      if (sel) sel.value = '';
      rerenderTable();
    });
  }

  function bindSortHandlers() {
    mountEl.querySelectorAll('.reg-th-sort').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const k = btn.getAttribute('data-sort');
        if (!k) return;
        if (state.sortKey === k) state.sortDir *= -1;
        else { state.sortKey = k; state.sortDir = 1; }
        rerenderTable();
      });
    });
  }

  function bindToolbarHandlers(periodOptions) {
    const searchInp = document.getElementById('regSearchInp');
    if (searchInp) {
      searchInp.addEventListener('input', (e) => {
        state.searchInput = e.target.value;
        debounce('search', () => {
          state.searchQ = state.searchInput.trim();
          refresh();
        }, 300);
      });
    }
    document.getElementById('regPeriodSel')?.addEventListener('change', (e) => {
      state.period = e.target.value;
      state.burnOnly = false;
      refresh();
    });
    document.getElementById('regStatusSel')?.addEventListener('change', (e) => {
      state.statusFilter = e.target.value;
      rerenderTable();
      const legWrap = mountEl.querySelector('.reg-status-legend');
      if (legWrap) {
        const parent = legWrap.parentNode;
        const newLeg = document.createElement('div');
        newLeg.innerHTML = renderLegend();
        parent.replaceChild(newLeg.firstChild, legWrap);
        bindLegendHandlers();
      }
    });
    document.getElementById('regAddRow')?.addEventListener('click', openAddRowModal);
    document.getElementById('regRefresh')?.addEventListener('click', refresh);
    document.getElementById('regLimitSel')?.addEventListener('change', (e) => {
      state.limit = Number(e.target.value) || 1000;
      refresh();
    });
    document.getElementById('regSortReset')?.addEventListener('click', () => {
      state.sortKey = null;
      state.sortDir = 1;
      rerenderTable();
    });
    document.getElementById('regOpenDutyRoster')?.addEventListener('click', () => {
      if (window.AsgardPmDutyPage && AsgardPmDutyPage.openRosterModal) {
        AsgardPmDutyPage.openRosterModal(() => refresh());
      } else {
        location.hash = '#/pm-calculations';
      }
    });
  }

  function bindDetailDelegation() {
    if (!mountEl || clickBound) return;
    clickBound = true;
    mountEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.reg-detail');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const row = rowsCache.find((r) => Number(r.id) === id);
      if (!row) {
        toast('Строка не найдена', 'err');
        return;
      }
      openDetail(row);
    });
  }

  function bindTable(rows) {
    mountEl.querySelectorAll('.reg-status-change').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        const row = rows.find((r) => r.id === id);
        if (row) openStatusModal(row);
      });
    });
    mountEl.querySelectorAll('.reg-editable').forEach((cell) => {
      cell.addEventListener('dblclick', (e) => {
        if (e.target.closest('button, select, a')) return;
        const tr = cell.closest('tr');
        const id = Number(tr?.dataset.id);
        const row = rows.find((r) => r.id === id);
        if (row) openRowFormModal(row, false);
      });
    });
    mountEl.querySelectorAll('.reg-win-go').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        const pmId = Number(mountEl.querySelector('.reg-win-pm[data-id="' + id + '"]')?.value);
        if (!pmId) { toast('Выберите РП', 'err'); return; }
        try {
          await API.createRegistryWork(id, pmId);
          toast('Работа создана', 'ok');
          refresh();
          onRefreshCb && onRefreshCb();
        } catch (e) { toast(e.message, 'err'); }
      });
    });
    mountEl.querySelectorAll('.reg-self-calc').forEach((btn) => {
      btn.addEventListener('click', () => {
        API.assignRegistryCalculator(Number(btn.dataset.id), 'to').then(() => {
          toast('Вы назначены считающим', 'ok');
          const row = rows.find((r) => r.id === Number(btn.dataset.id));
          if (row && window.AsgardRpReviewModal) AsgardRpReviewModal.open(row, pmsCache, refresh, { mode: 'calc' });
        }).catch((e) => toast(e.message, 'err'));
      });
    });
    mountEl.querySelectorAll('.reg-assign-go').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        const pmId = Number(mountEl.querySelector('.reg-assign-pm[data-id="' + id + '"]')?.value);
        if (!pmId) { toast('Выберите РП', 'err'); return; }
        API.assignRegistryCalculator(id, 'pm', pmId).then(() => {
          toast('РП назначен на просчёт', 'ok');
          refresh();
        }).catch((e) => toast(e.message, 'err'));
      });
    });
    mountEl.querySelectorAll('.reg-rp-edit, .reg-rp-view').forEach((el) => {
      el.addEventListener('click', () => {
        const row = rows.find((r) => r.id === Number(el.dataset.id));
        if (!row) return;
        const readOnly = el.classList.contains('reg-rp-view') && !!row.rp_review?.is_final;
        let mode = 'calc';
        if (!row.rp_review?.analysis_finalized_at) {
          const rj = row.rp_review?.report_json;
          try {
            const parsed = typeof rj === 'string' ? JSON.parse(rj || '{}') : (rj || {});
            mode = parsed.mode === 'analysis' ? 'analysis' : 'calc';
          } catch (_) { /* ignore */ }
        }
        openRpReviewModal(row, { readOnly, mode });
      });
    });
  }

  async function refresh() {
    if (!mountEl) return;
    mountEl.innerHTML = '<p>Загрузка реестра…</p>';
    const periodOptions = API.buildRegistryPeriodOptions();
    try {
      if (canViewDutyBar()) {
        try {
          const dutyRes = await API.loadPmDutyCurrent();
          dutyInfo = dutyRes.duty || dutyRes;
        } catch (_) {
          dutyInfo = null;
        }
      } else {
        dutyInfo = null;
      }
      const d = await API.loadRegistry({
        subtab: state.subtab,
        period: state.period,
        burn: state.burnOnly,
        limit: state.limit,
        q: state.searchQ || undefined
      });
      const rows = d.items || [];
      rowsCache = rows;
      state.totalCount = d.total != null ? d.total : rows.length;
      const actionCount = countActionRows(filterRows(rows));
      mountEl.innerHTML = renderDutyBar() + renderToolbar(state.totalCount, periodOptions, actionCount) +
        renderLegend() + renderTable(rows);
      bindDetailDelegation();
      bindTable(rows);
      bindSortHandlers();
      bindToolbarHandlers(periodOptions);
      bindLegendHandlers();
      handleDeepLink(rows);
    } catch (e) {
      mountEl.innerHTML = '<p class="err">Ошибка загрузки: ' + esc(e.message) + '</p>';
    }
  }

  return {
    mount(el, opts) {
      mountEl = el;
      opts = opts || {};
      state.subtab = opts.subtab || 'registry';
      state.period = opts.period != null ? opts.period : 'year:2026';
      state.burnOnly = !!opts.burnOnly;
      state.statusFilter = '';
      onRefreshCb = opts.onRefresh;
      onOpenWinCb = opts.onOpenWin;
      Promise.all([
        API.loadUsers('PM,HEAD_PM'),
        API.loadUsers('TO,HEAD_TO')
      ]).then(([pms, tos]) => {
        pmsCache = pms || [];
        toUsersCache = tos || [];
      }).catch(() => {});
      refresh();
    },
    setBurnOnly(on) {
      state.burnOnly = !!on;
      if (mountEl) refresh();
    },
    setPeriod(p) {
      state.period = p;
      state.burnOnly = false;
      if (mountEl) refresh();
    },
    setSubtab(sub) {
      state.subtab = sub || 'registry';
      if (mountEl) refresh();
    },
    refresh,
    unmount() {
      mountEl = null;
      rowsCache = [];
      clickBound = false;
      Object.keys(timers).forEach((k) => clearTimeout(timers[k]));
    }
  };
})();
