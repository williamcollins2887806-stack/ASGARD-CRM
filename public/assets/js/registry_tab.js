/**
 * Registry tab — unified TO tender spreadsheet (#/tenders → Реестр)
 * Action rows highlighted in-place; column sort with reset; default sort: action-first then deadline
 */
window.AsgardRegistryTab = (function () {
  const { esc, showModal, hideModal } = AsgardUI;
  const _uiToast = AsgardUI.toast;
  /** Compat: toast(msg, 'err'|'ok'|'warn') — AsgardUI expects (title, msg, type). */
  function toast(a, b, c) {
    if (b === 'err' || b === 'ok' || b === 'warn') {
      const title = b === 'err' ? 'Ошибка' : b === 'warn' ? 'Внимание' : 'Готово';
      return _uiToast(title, a, b);
    }
    return _uiToast(a, b || '', c || 'ok');
  }
  const API = AsgardRegistryApi;
  const M = () => window.AsgardMoney;
  const timers = {};
  let mountEl = null;
  let state = {
    subtab: 'registry', period: 'current', burnOnly: false, statusFilter: '',
    searchQ: '', searchInput: '', limit: 1000, sortKey: null, sortDir: 1,
    hideOthers: false, hideOthersUserId: null,
    periodFilter: null,
    colFilters: { id: '', customer_name: '', tender_title: '', created_by_name: '', created_at: '', docs_deadline: '' }
  };
  let periodWidget = null;
  let onRefreshCb = null;
  let onOpenWinCb = null;
  let onClearBurnCb = null;
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
        role: opts.viewAsTo !== false ? 'to' : 'viewer',
        readOnly: true,
        mode: opts.mode || 'calc'
      }, opts);
    } else if (isTo && opts.viewAsTo !== false && !opts.forceEdit) {
      // ТО всегда смотрит как ТО (readOnly), даже до финала — иначе UI коллаба
      opts = Object.assign({ role: 'to', readOnly: true, mode: opts.mode || 'calc' }, opts);
    }
    const mode = opts.mode || (row.analysis_finalized_at || final ? 'calc' : 'analysis');
    opts.mode = mode;
    if (mode === 'calc' && window.AsgardRpCalcModal) {
      AsgardRpCalcModal.open(row, pmsCache, refresh, opts);
    } else if (window.AsgardRpReviewModal) {
      AsgardRpReviewModal.open(row, pmsCache, refresh, opts);
    }
  }

  function debounce(key, fn, delay) {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(fn, delay || 400);
  }

  function formatMoney(v) {
    if (M() && M().formatMoney) return M().formatMoney(v);
    if (v == null || v === '') return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
  }

  function formatSubmissionCell(row) {
    const withV = row.submission_price_with_vat != null ? Number(row.submission_price_with_vat) : null;
    const exV = row.submission_price != null ? Number(row.submission_price) : null;
    if ((!withV || !(withV > 0)) && (!exV || !(exV > 0))) return null;
    const vatPct = Number(row.vat_pct) || (M() && M().VAT_DEFAULT_PCT) || 22;
    if (M() && M().formatMoneyVat) {
      return M().formatMoneyVat(withV > 0 ? withV : M().withVat(exV, vatPct), vatPct, { exVat: exV > 0 ? exV : undefined });
    }
    const total = withV > 0 ? withV : Math.round(exV * (1 + vatPct / 100));
    return { withVat: formatMoney(total), vatLine: 'в т.ч. НДС ' + formatMoney(Math.round((total - (exV || total / (1 + vatPct / 100))) * 100) / 100) };
  }

  function fmtShortDate(value) {
    if (!value) return '—';
    const s = String(value).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? (m[3] + '.' + m[2] + '.' + m[1].slice(2)) : (API.fmtDate ? API.fmtDate(value) : s);
  }

  function fmtFullDate(value) {
    if (!value) return '—';
    const s = String(value).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? (m[3] + '.' + m[2] + '.' + m[1]) : fmtShortDate(value);
  }

  /** Mon–Fri business days (parity with src/lib/business-days.js). */
  function subBusinessDaysClient(iso, n) {
    const s = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, mo, d] = s.split('-').map(Number);
    const cur = new Date(y, mo - 1, d);
    let left = Math.max(0, Math.floor(Number(n) || 0));
    while (left > 0) {
      cur.setDate(cur.getDate() - 1);
      const day = cur.getDay();
      if (day !== 0 && day !== 6) left -= 1;
    }
    const yy = cur.getFullYear();
    const mm = String(cur.getMonth() + 1).padStart(2, '0');
    const dd = String(cur.getDate()).padStart(2, '0');
    return yy + '-' + mm + '-' + dd;
  }

  function previewAnalysisDeadline(docsDeadline, paid, createdAt) {
    const docs = String(docsDeadline || '').slice(0, 10);
    if (!docs) return null;
    const n = paid ? 5 : 3;
    let deadline = subBusinessDaysClient(docs, n);
    const created = String(createdAt || new Date().toISOString()).slice(0, 10);
    if (deadline && created && deadline < created) deadline = created;
    return { deadline, days: n, tight: !!(deadline && created && deadline === created && subBusinessDaysClient(docs, n) < created) };
  }

  function participationCell(row) {
    if (row.participation_paid) {
      const fee = row.participation_fee != null ? formatMoney(row.participation_fee) : 'платно';
      return '<span class="reg-participation-paid" title="Платный сбор за участие (сгорит при проигрыше)">' + esc(fee) + '</span>';
    }
    return '<span class="reg-participation-free muted" title="Участие без платы">бесплатно</span>';
  }

  function analysisDeadlineCell(row) {
    const dl = row.analysis_deadline ? String(row.analysis_deadline).slice(0, 10) : '';
    if (!dl) return '<span class="muted">—</span>';
    const today = new Date();
    const tIso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    let tone = 'reg-adl-ok';
    let title = 'Внутренний срок анализа';
    if (dl < tIso) {
      tone = 'reg-adl-overdue';
      title = 'Просрочен внутренний срок анализа';
    } else {
      const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      let left = 0;
      const cur = new Date(tomorrow);
      const end = new Date(dl.slice(0, 4), Number(dl.slice(5, 7)) - 1, Number(dl.slice(8, 10)));
      while (cur < end) {
        cur.setDate(cur.getDate() + 1);
        const day = cur.getDay();
        if (day !== 0 && day !== 6) left += 1;
      }
      if (left <= 1) {
        tone = 'reg-adl-soon';
        title = 'До внутреннего срока ≤1 раб. день';
      }
    }
    return '<span class="reg-adl-badge ' + tone + '" title="' + esc(title) + '">' + esc(fmtShortDate(dl)) + '</span>';
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
    { key: 'registry_no', label: '№', filterKey: 'id' },
    { key: 'customer_name', label: 'Заказчик', filterKey: 'customer_name' },
    { key: 'tender_title', label: 'Тендер', filterKey: 'tender_title' },
    { key: 'tender_price', label: 'НМЦ' },
    { key: 'submission_price_with_vat', label: 'Подача' },
    { key: 'docs_deadline', label: 'Срок', filterKey: 'docs_deadline' },
    { key: 'participation_fee', label: 'Сбор' },
    { key: 'analysis_deadline', label: 'Анализ' },
    { key: 'registry_status', label: 'Статус' },
    { key: 'calculator_user_name', label: 'Считает' },
    { key: '_rp_sort', label: 'Отчёт' },
    { key: 'comment_to', label: 'Коммент' },
    { key: '_score_pct', label: 'Скор' },
    { key: 'created_by_name', label: 'Внёс', filterKey: 'created_by_name' },
    { key: 'created_at', label: 'Добавлен', filterKey: 'created_at' },
    { key: '_action_sort', label: 'Действие' }
  ];

  const COL_FILTER_KEYS = ['id', 'customer_name', 'tender_title', 'created_by_name', 'created_at', 'docs_deadline'];

  function hasColFilters() {
    return COL_FILTER_KEYS.some((k) => String(state.colFilters[k] || '').trim());
  }

  function clearAllFilters() {
    state.statusFilter = '';
    state.searchQ = '';
    state.searchInput = '';
    state.burnOnly = false;
    COL_FILTER_KEYS.forEach((k) => { state.colFilters[k] = ''; });
    if (typeof onClearBurnCb === 'function') onClearBurnCb();
  }

  function getRowActionState(row) {
    const st = row.registry_status || 'рассмотрение';
    const rev = row.rp_review;
    if (st === 'выиграли' && !tenderHasWork(row)) {
      return { needs: true, type: 'won', label: 'Создать работу', tone: 'success' };
    }
    if (st === 'отмена' || st === 'проиграли') {
      return { needs: false, type: null, label: '', tone: null };
    }
    // РП закрыл «Не подаём» — тендер остаётся в реестре, ТО сам кидает в архив
    if (rev && rev.is_final && rev.decision === 'reject' && st !== 'отмена') {
      return { needs: true, type: 'rp_reject', label: 'РП: не подаём → в архив', tone: 'danger' };
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
      return { needs: true, type: 'analysis_assign', label: 'Анализ готов · считает дежурный РП', tone: 'info' };
    }
    return { needs: true, type: 'wait', label: 'Ждёт анализ РП', tone: 'warn' };
  }

  function actionSortRank(row) {
    const a = getRowActionState(row);
    if (!a.needs) return 99;
    const ranks = { won: 0, rp_reject: 1, decide: 2, analysis_assign: 3, assign: 4, draft: 5, wait: 6 };
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
      case 'submission_price_with_vat':
        return row.submission_price_with_vat != null && Number.isFinite(Number(row.submission_price_with_vat))
          ? Number(row.submission_price_with_vat) : -Infinity;
      case 'docs_deadline':
        return row.docs_deadline ? new Date(row.docs_deadline).getTime() : -Infinity;
      case 'analysis_deadline':
        return row.analysis_deadline ? new Date(row.analysis_deadline).getTime() : -Infinity;
      case 'participation_fee':
        if (row.participation_paid) {
          return row.participation_fee != null && Number.isFinite(Number(row.participation_fee))
            ? Number(row.participation_fee) : 0;
        }
        return -1;
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

  function renderSortTh(key, label, filterKey) {
    const active = state.sortKey === key;
    const ind = active ? (state.sortDir === 1 ? '▲' : '▼') : '';
    const extraTh = key === 'participation_fee' ? ' reg-th-participation'
      : (key === 'analysis_deadline' ? ' reg-th-analysis'
        : (key === 'docs_deadline' ? ' reg-th-date'
          : (key === 'tender_price' || key === 'submission_price_with_vat' ? ' reg-th-money'
            : (key === 'registry_no' ? ' reg-th-no' : ''))));
    const title = key === 'analysis_deadline'
      ? 'Внутренний срок анализа (срок подачи минус 3 или 5 раб. дней)'
      : (key === 'participation_fee' ? 'Сбор за участие в тендере' : '');
    let h = '<th class="reg-th-wrap' + extraTh + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' +
      '<button type="button" class="reg-th-sort' + (active ? ' reg-th-sort-active' : '') + '" data-sort="' + key + '">' +
      esc(label) + (ind ? ' <span class="reg-sort-ind">' + ind + '</span>' : '') + '</button>';
    if (filterKey) {
      const v = state.colFilters[filterKey] || '';
      h += '<input class="inp reg-col-filter" data-col-filter="' + filterKey + '" value="' + esc(v) + '" placeholder="фильтр…" title="Фильтр по колонке"/>';
    } else {
      // Spacer keeps header labels on one baseline when only some columns have filters
      h += '<span class="reg-col-filter-spacer" aria-hidden="true"></span>';
    }
    return h + '</th>';
  }

  function filterRows(rows) {
    let list = rows.filter((r) => !isTestGarbage(r));
    if (state.hideOthers && state.hideOthersUserId) {
      const me = Number(state.hideOthersUserId);
      list = list.filter((r) => {
        const calc = Number(r.calculator_user_id || 0);
        const created = Number(r.created_by_user_id || r.created_by || 0);
        return calc === me || created === me;
      });
    }
    if (state.statusFilter) list = list.filter((r) => (r.registry_status || 'рассмотрение') === state.statusFilter);
    const cf = state.colFilters || {};
    const idQ = String(cf.id || '').trim().toLowerCase();
    const custQ = String(cf.customer_name || '').trim().toLowerCase();
    const titleQ = String(cf.tender_title || '').trim().toLowerCase();
    const byQ = String(cf.created_by_name || '').trim().toLowerCase();
    const addedQ = String(cf.created_at || '').trim().toLowerCase();
    const dlQ = String(cf.docs_deadline || '').trim().toLowerCase();
    if (idQ) {
      list = list.filter((r) => {
        const no = String(r.registry_no != null ? r.registry_no : '');
        const id = String(r.id || '');
        return no.toLowerCase().includes(idQ) || id.toLowerCase().includes(idQ);
      });
    }
    if (custQ) list = list.filter((r) => String(r.customer_name || '').toLowerCase().includes(custQ));
    if (titleQ) list = list.filter((r) => String(r.tender_title || '').toLowerCase().includes(titleQ));
    if (byQ) list = list.filter((r) => String(r.created_by_name || '').toLowerCase().includes(byQ));
    if (addedQ) {
      list = list.filter((r) => {
        const iso = String(r.created_at || '').toLowerCase();
        const short = fmtShortDate(r.created_at).toLowerCase();
        return iso.includes(addedQ) || short.includes(addedQ);
      });
    }
    if (dlQ) {
      list = list.filter((r) => {
        const iso = String(r.docs_deadline || '').toLowerCase();
        const short = fmtShortDate(r.docs_deadline).toLowerCase();
        return iso.includes(dlQ) || short.includes(dlQ);
      });
    }
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

  async function applyStatusChange(row, nextOrBody) {
    const payload = typeof nextOrBody === 'string' ? { registry_status: nextOrBody } : (nextOrBody || {});
    const nextStatus = payload.registry_status;
    const st = row.registry_status || 'рассмотрение';
    if (nextStatus === st && !payload.submission_price && !payload.submission_price_with_vat) return;
    if (nextStatus === 'проиграли' && window.AsgardLossReasonModal) {
      return new Promise((resolve) => {
        AsgardLossReasonModal.open(row, (lossPayload) => API.patchRegistryStatus(row.id, lossPayload).then(() => {
          refresh();
          onRefreshCb && onRefreshCb();
          resolve();
        }), () => resolve());
      });
    }
    await API.patchRegistryStatus(row.id, payload);
    if (nextStatus === 'выиграли') {
      openWinModal(row);
    }
    toast('Статус: ' + statusLabel(nextStatus), 'ok');
    refresh();
    onRefreshCb && onRefreshCb();
  }

  async function openStatusModal(row) {
    const st = row.registry_status || 'рассмотрение';
    let vatPct = Number(row.vat_pct) || (M() && M().VAT_DEFAULT_PCT) || 22;
    try {
      const vatSetting = await AsgardDB.get('settings', 'vat_default_pct');
      const v = vatSetting ? parseFloat(vatSetting.value_json) : NaN;
      if (Number.isFinite(v) && v >= 0 && v <= 100) vatPct = v;
    } catch (_) { /* keep fallback */ }
    const suggested = (M() && M().suggestSubmissionPrices) ? M().suggestSubmissionPrices(row, vatPct) : { exVat: null, withVat: null, vatPct };
    const sugEx = suggested.exVat > 0 ? String(Math.round(suggested.exVat)) : '';
    const sugWith = suggested.withVat > 0 ? String(Math.round(suggested.withVat)) : '';
    const sugHint = suggested.withVat != null
      ? ' Предложена сумма из отчёта РП (' + formatMoney(suggested.withVat) + ').'
      : '';
    const html = '<p class="reg-status-modal-hint">' + esc(row.customer_name || '') + ' — ' + esc((row.tender_title || '').slice(0, 80)) + '</p>' +
      '<label>Статус<select class="inp" id="regStatusPick" style="width:100%;margin-top:4px">' +
      API.REGISTRY_STATUSES.map((s) =>
        '<option value="' + s.value + '"' + (st === s.value ? ' selected' : '') + '>' + esc(s.label) + '</option>'
      ).join('') + '</select></label>' +
      '<div id="regStatusMoney" class="reg-status-money" style="display:none">' +
      '<p class="reg-status-money-title">С какой суммой подались?' + esc(sugHint) + '</p>' +
      '<label>Без НДС, ₽<input class="inp" id="regSubEx" type="text" value="' + esc(sugEx) + '" placeholder="цифры или ориентир" style="width:100%;margin-top:4px"/></label>' +
      '<label style="margin-top:8px;display:block">С НДС ' + vatPct + '%, ₽<input class="inp" id="regSubWith" type="text" value="' + esc(sugWith) + '" placeholder="цифры или ориентир" style="width:100%;margin-top:4px"/></label>' +
      '<p class="reg-status-vat" id="regSubVatLine"></p>' +
      '</div>' +
      '<div id="regStatusCancelReason" style="display:none;margin-top:10px">' +
      '<label>Причина отмены <small class="muted">(необязательно)</small>' +
      '<textarea class="inp" id="regArchiveReason" rows="2" placeholder="Напр.: закупка отменена заказчиком" style="width:100%;margin-top:4px"></textarea></label></div>' +
      '<p class="muted" style="font-size:11px;margin:10px 0 0">Отчёт РП «Подаём» → <strong>Готовим</strong>. «Подались» — когда заявку реально подали на площадке.</p>' +
      '<div style="display:flex;gap:8px;margin-top:14px">' +
      '<button type="button" class="btn" id="regStatusSave">Сохранить</button>' +
      '<button type="button" class="btn ghost" id="regStatusCancel">Отмена</button></div>';
    showModal({
      title: 'Статус тендера #' + row.id,
      html,
      onMount: () => {
        const pick = document.getElementById('regStatusPick');
        const moneyBox = document.getElementById('regStatusMoney');
        const cancelBox = document.getElementById('regStatusCancelReason');
        const exInp = document.getElementById('regSubEx');
        const withInp = document.getElementById('regSubWith');
        const vatLine = document.getElementById('regSubVatLine');
        const syncVis = () => {
          if (moneyBox) moneyBox.style.display = (pick?.value === 'подались') ? '' : 'none';
          if (cancelBox) cancelBox.style.display = (pick?.value === 'отмена') ? '' : 'none';
        };
        const digits = (v) => String(v || '').replace(/\D/g, '');
        const updateVat = () => {
          const w = Number(digits(withInp?.value));
          const e = Number(digits(exInp?.value));
          if (!vatLine) return;
          if (w > 0) {
            const base = e > 0 ? e : (M() ? M().withoutVat(w, vatPct) : Math.round(w / (1 + vatPct / 100)));
            vatLine.textContent = 'в т.ч. НДС ' + formatMoney(Math.round((w - base) * 100) / 100);
          } else vatLine.textContent = '';
        };
        pick?.addEventListener('change', syncVis);
        syncVis();
        updateVat();
        exInp?.addEventListener('input', () => {
          const n = Number(digits(exInp.value));
          if (n > 0 && withInp) {
            withInp.value = String(Math.round(M() ? M().withVat(n, vatPct) : n * (1 + vatPct / 100)));
          }
          updateVat();
        });
        withInp?.addEventListener('input', () => {
          const n = Number(digits(withInp.value));
          if (n > 0 && exInp) {
            exInp.value = String(Math.round(M() ? M().withoutVat(n, vatPct) : n / (1 + vatPct / 100)));
          }
          updateVat();
        });
        document.getElementById('regStatusCancel')?.addEventListener('click', hideModal);
        document.getElementById('regStatusSave')?.addEventListener('click', async () => {
          const next = pick?.value || st;
          try {
            if (next === 'подались') {
              const finalNoVat = Number(digits(exInp?.value)) || 0;
              const finalWithVat = Number(digits(withInp?.value)) || 0;
              if (!finalNoVat && !finalWithVat) {
                toast('Укажите сумму подачи', 'warn');
                return;
              }
              await applyStatusChange(row, {
                registry_status: next,
                submission_price: finalNoVat || (M() ? M().withoutVat(finalWithVat, vatPct) : finalWithVat),
                submission_price_with_vat: finalWithVat || (M() ? M().withVat(finalNoVat, vatPct) : finalNoVat),
                vat_pct: vatPct
              });
            } else if (next === 'отмена') {
              const reasonEl = document.getElementById('regArchiveReason');
              const reason = reasonEl ? String(reasonEl.value || '') : '';
              await applyStatusChange(row, {
                registry_status: next,
                archive_reason: reason
              });
            } else {
              await applyStatusChange(row, next);
            }
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
      const paid = !!row.participation_paid;
      const feeVal = row.participation_fee != null ? row.participation_fee : '';
      return '<div class="reg-form-modal" style="display:grid;gap:10px">' +
        '<label style="position:relative">Заказчик <small class="muted">(название или ИНН — подскажем из ДаДата)</small>' +
        '<input class="inp" id="regFormCustomer" data-inn="' + esc(row.customer_inn || '') + '" value="' + esc(row.customer_name || '') + '" placeholder="Начните вводить…" style="width:100%;margin-top:4px"' + (showDocs ? ' disabled' : '') + '/></label>' +
        '<label>Тендер<input class="inp" id="regFormTitle" value="' + esc(row.tender_title || '') + '" style="width:100%;margin-top:4px"' + (showDocs ? ' disabled' : '') + '/></label>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<label>НМЦ<input class="inp" id="regFormPrice" type="number" value="' + (row.tender_price != null ? row.tender_price : '') + '" style="width:100%;margin-top:4px"' + (showDocs ? ' disabled' : '') + '/></label>' +
        '<label>Срок подачи <span class="req">*</span><input class="inp" id="regFormDeadline" type="date" value="' + dl + '" required style="width:100%;margin-top:4px"' + (showDocs ? ' disabled' : '') + '/></label></div>' +
        '<p class="muted" id="regFormAnalysisHint" style="font-size:11px;margin:-4px 0 0"></p>' +
        '<label style="display:flex;align-items:center;gap:8px;margin:0">' +
        '<input type="checkbox" id="regFormPaid"' + (paid ? ' checked' : '') + (showDocs ? ' disabled' : '') + '/>' +
        ' Платное участие</label>' +
        '<label id="regFormFeeWrap" style="' + (paid ? '' : 'display:none;') + '">Ориентировочная стоимость (сгорит при проигрыше), ₽' +
        '<input class="inp" id="regFormFee" type="number" min="1" step="0.01" value="' + esc(feeVal) + '" style="width:100%;margin-top:4px"' + (showDocs ? ' disabled' : '') + '/></label>' +
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

    function syncPaidFeeUi() {
      const paid = !!document.getElementById('regFormPaid')?.checked;
      const wrap = document.getElementById('regFormFeeWrap');
      if (wrap) wrap.style.display = paid ? '' : 'none';
      updateAnalysisHint();
    }

    function updateAnalysisHint() {
      const el = document.getElementById('regFormAnalysisHint');
      if (!el) return;
      const docs = document.getElementById('regFormDeadline')?.value || '';
      const paid = !!document.getElementById('regFormPaid')?.checked;
      const prev = previewAnalysisDeadline(docs, paid, row.created_at || null);
      if (!prev || !prev.deadline) {
        el.textContent = '';
        return;
      }
      let msg = 'Внутренний срок анализа: ' + fmtFullDate(prev.deadline) +
        ' (' + prev.days + ' раб. дн. до подачи)';
      if (prev.tight) msg += ' · мало времени до подачи';
      el.textContent = msg;
      el.style.color = prev.tight ? 'var(--warn, #b45309)' : '';
    }

    function mountForm(showDocs) {
      const root = document.querySelector('.reg-form-modal')?.closest('.modal-body') || document.querySelector('.reg-form-modal')?.parentElement;
      const modalRoot = document.querySelector('.reg-form-modal');
      if (!showDocs) {
        bindFormCustomerSuggest(document.getElementById('regFormCustomer'));
        document.getElementById('regFormPaid')?.addEventListener('change', syncPaidFeeUi);
        document.getElementById('regFormDeadline')?.addEventListener('change', updateAnalysisHint);
        document.getElementById('regFormDeadline')?.addEventListener('input', updateAnalysisHint);
        syncPaidFeeUi();
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
        const paid = !!document.getElementById('regFormPaid')?.checked;
        const feeRaw = document.getElementById('regFormFee')?.value;
        const fee = feeRaw === '' || feeRaw == null ? null : Number(feeRaw);
        if (paid && !(fee > 0)) {
          toast('Укажите ориентировочную стоимость платного участия', 'err');
          return;
        }
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
          comment_to: document.getElementById('regFormComment')?.value || '',
          participation_paid: paid,
          participation_fee: paid ? fee : null
        };
        const nextStatus = document.getElementById('regFormStatus')?.value || st;
        if (!body.docs_deadline) {
          toast('Укажите дату подачи (срок)', 'err');
          return;
        }
        try {
          if (isNew) {
            if (!body.customer_name && !body.tender_title) {
              toast('Укажите заказчика или тендер', 'err');
              return;
            }
            if (body.tender_title || body.purchase_url) {
              try {
                const dup = await API.findRegistryDuplicates({
                  title: body.tender_title || '',
                  purchase_url: body.purchase_url || ''
                });
                const items = dup.items || [];
                if (items.length) {
                  const lines = items.slice(0, 5).map((d) =>
                    '#' + d.id + ' · ' + (d.created_by_name || '—') + ' · ' + (d.registry_status || d.tender_status || '—') +
                    (d.tender_title ? '\n   ' + d.tender_title : '')
                  ).join('\n');
                  const ok = confirm('Такой тендер уже есть в CRM:\n\n' + lines + '\n\nВсё равно создать новую строку?');
                  if (!ok) return;
                }
              } catch (_) { /* soft: continue create if dupe check fails */ }
            }
            const res = await API.createRegistryRow(Object.assign({}, body, { registry_status: nextStatus }));
            tenderId = res.tender?.id || res.id;
            if (res.tender) {
              row.participation_paid = res.tender.participation_paid;
              row.participation_fee = res.tender.participation_fee;
              row.analysis_deadline = res.tender.analysis_deadline;
              row.created_at = res.tender.created_at;
            }
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
              const prev = row[f];
              let next = body[f];
              if (f === 'docs_deadline') {
                if (API.fmtDateIso(prev) === next) continue;
              } else if (f === 'tender_price') {
                const pn = prev != null ? Number(prev) : null;
                const nn = next != null ? Number(next) : null;
                if (pn === nn) continue;
              } else if ((prev != null ? prev : '') === (next != null ? next : '')) {
                continue;
              }
              await API.patchRegistryField(row.id, f, next);
            }
            const prevPaid = !!row.participation_paid;
            const prevFee = row.participation_fee != null ? Number(row.participation_fee) : null;
            if (prevPaid !== paid || prevFee !== (paid ? fee : null)) {
              await API.patchRegistryField(row.id, 'participation', {
                participation_paid: paid,
                participation_fee: paid ? fee : null
              });
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
    const qIcon = threadQuestionIcon(row);
    let core = '';
    if (rev && rev.director_review_status === 'pending') {
      core = '<button type="button" class="pill warn reg-rp-view" data-id="' + row.id + '">У директора</button>';
    } else if (rev && rev.director_review_status === 'rejected') {
      core = '<button type="button" class="reg-rp-decision reg-rp-decision-reject reg-rp-view" data-id="' + row.id + '" title="Отклонено директором">✕ Отклонено</button>';
    } else if (rev && rev.director_review_status === 'approved') {
      core = '<button type="button" class="pill ok reg-rp-view" data-id="' + row.id + '">Цена согласована</button>';
    } else if (rev && rev.is_final && rev.decision === 'reject') {
      core = '<button type="button" class="reg-rp-decision reg-rp-decision-reject reg-rp-view" data-id="' + row.id + '" title="РП рекомендует не подавать">✕ Не подаём</button>';
    } else if (rev && rev.is_final && rev.decision === 'submit') {
      // Ниже порога директор не вызывался — цена зафиксирована просчётом РП.
      core = '<button type="button" class="pill ok reg-rp-view" data-id="' + row.id + '">Цена согласована</button>' +
        '<div class="muted" style="font-size:10px;margin-top:2px">Отчёт готов</div>';
    } else if (rev && rev.is_final) {
      core = '<button type="button" class="pill ok reg-rp-view" data-id="' + row.id + '">Отчёт готов</button>';
    } else if (rev && rev.analysis_finalized_at && !rev.is_final) {
      if (rev.decision === 'submit') {
        core = '<button type="button" class="reg-rp-decision reg-rp-decision-submit reg-rp-view" data-id="' + row.id + '">Подаём</button>' +
          '<div class="muted" style="font-size:10px;margin-top:2px">Анализ готов</div>';
      } else if (rev.decision === 'reject') {
        core = '<button type="button" class="reg-rp-decision reg-rp-decision-reject reg-rp-view" data-id="' + row.id + '">Не подаём</button>' +
          '<div class="muted" style="font-size:10px;margin-top:2px">Анализ готов</div>';
      } else {
        core = '<button type="button" class="pill ok reg-rp-view" data-id="' + row.id + '">Анализ готов</button>';
      }
    } else if (rev && !rev.is_final) {
      let pre = '';
      if (rev.decision === 'submit') {
        pre = '<div class="reg-rp-predec reg-rp-predec-submit">предв. Подаём</div>';
      } else if (rev.decision === 'reject') {
        pre = '<div class="reg-rp-predec reg-rp-predec-reject">предв. Не подаём</div>';
      }
      core = '<button type="button" class="pill warn reg-rp-view" data-id="' + row.id + '">Черновик</button>' + pre;
    } else {
      core = '<span class="pill muted">ожидает</span>';
    }
    return '<div class="reg-rp-cell">' + qIcon + core + '</div>';
  }

  function threadQuestionIcon(row) {
    const n = Number(row.thread_unread_count) || 0;
    const preview = row.thread_last_question_preview;
    if (!n && !preview) return '';
    const who = row.thread_last_question_author ? (row.thread_last_question_author + ': ') : '';
    const tip = preview
      ? (who + preview)
      : ('Есть вопросы РП' + (n ? ' (' + n + ')' : ''));
    const badge = n > 0 ? '<span class="reg-thread-q-badge">' + (n > 9 ? '9+' : n) + '</span>' : '';
    return '<button type="button" class="reg-thread-q-btn reg-rp-chat" data-id="' + row.id + '" title="' + esc(tip) + '">⚠' + badge + '</button>';
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
    if (action.type === 'rp_reject') {
      return '<button type="button" class="btn mini ghost reg-rp-view" data-id="' + row.id + '">Открыть</button>' +
        '<button type="button" class="btn mini reg-to-archive" data-id="' + row.id + '">В архив</button>';
    }
    if (action.type === 'draft') {
      return '<button type="button" class="btn mini ghost reg-rp-view" data-id="' + row.id + '">Открыть</button>';
    }
    if (action.type === 'analysis_assign' || action.type === 'assign') {
      const calcName = row.calculator_user_name || row.rp_review?.calculator_name || '';
      let h = '<button type="button" class="btn mini ghost reg-rp-view" data-id="' + row.id + '">Открыть</button>';
      // Просчёт делает дежурный РП; ТО может только «считать сам» в той же модалке.
      h += '<button type="button" class="btn mini ghost reg-self-calc" data-id="' + row.id + '">Считаю сам</button>';
      if (calcName) {
        h += '<span class="muted" style="font-size:11px;margin-left:4px">' + esc(calcName) + ' считает</span>';
      }
      return h;
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

  function ensurePeriodFilter(legacyPeriod) {
    if (state.periodFilter) return state.periodFilter;
    if (window.TenderPeriodFilter) {
      state.periodFilter = window.TenderPeriodFilter.fromLegacyPeriod(
        legacyPeriod != null ? legacyPeriod : state.period
      );
    } else {
      state.periodFilter = {
        mode: 'month',
        month: state.period === 'current' ? '' : (state.period || ''),
        quick: 'all',
        dateFrom: '',
        dateTo: '',
        dateField: 'created_at'
      };
    }
    return state.periodFilter;
  }

  function mountPeriodWidget() {
    const host = document.getElementById('regPeriodHost');
    if (!host) return;
    if (periodWidget && periodWidget.destroy) {
      try { periodWidget.destroy(); } catch (_) {}
      periodWidget = null;
    }
    ensurePeriodFilter();
    if (!window.TenderPeriodFilterUI) {
      host.innerHTML = '<select class="inp" id="regPeriodSel"></select>';
      const sel = host.querySelector('#regPeriodSel');
      API.buildRegistryPeriodOptions().forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === state.period) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', (e) => {
        state.period = e.target.value;
        state.periodFilter = window.TenderPeriodFilter
          ? window.TenderPeriodFilter.fromLegacyPeriod(state.period)
          : null;
        state.burnOnly = false;
        if (typeof onClearBurnCb === 'function') onClearBurnCb();
        refresh();
      });
      return;
    }
    periodWidget = window.TenderPeriodFilterUI.mount(host, {
      state: state.periodFilter,
      onChange: (next) => {
        state.periodFilter = next;
        if (window.TenderPeriodFilter) {
          const q = window.TenderPeriodFilter.toQueryParams(next);
          state.period = q.period || '';
        }
        state.burnOnly = false;
        if (typeof onClearBurnCb === 'function') onClearBurnCb();
        refresh();
      }
    });
  }

  function renderToolbar(total, periodOptions, actionCount) {
    const statusOpts = '<option value="">Все статусы</option>' + API.REGISTRY_STATUSES.map((s) =>
      '<option value="' + s.value + '"' + (state.statusFilter === s.value ? ' selected' : '') + '>' + esc(s.label) + '</option>'
    ).join('');
    return '<div class="reg-toolbar">' +
      '<label class="reg-toolbar-field reg-toolbar-search"><span class="muted">Поиск</span>' +
      '<input class="inp" id="regSearchInp" placeholder="Заказчик, № реестра, предмет…" value="' + esc(state.searchInput) + '"/></label>' +
      '<div class="reg-toolbar-field reg-toolbar-period"><span class="muted">Период</span>' +
      '<div id="regPeriodHost"></div></div>' +
      '<label class="reg-toolbar-field"><span class="muted">Статус</span>' +
      '<select class="inp" id="regStatusSel">' + statusOpts + '</select></label>' +
      '<span class="reg-toolbar-meta muted">' + total + ' тендеров' +
      (actionCount ? ' · ' + actionCount + ' требуют действия' : '') + '</span>' +
      (state.burnOnly ? '<button type="button" class="reg-burn-chip" id="regBurnClear">🔥 Горящие ×</button>' : '') +
      '<label class="reg-toolbar-field"><span class="muted">Строк</span>' +
      '<select class="inp" id="regLimitSel">' +
      [100, 500, 1000, 2000].map((n) =>
        '<option value="' + n + '"' + (state.limit === n ? ' selected' : '') + '>' + (n >= 1000 ? (n / 1000) + 'k' : String(n)) + '</option>'
      ).join('') + '</select></label>' +
      '<button type="button" class="btn mini ghost" id="regSortReset"' + (state.sortKey ? '' : ' hidden') + '>↺ Сброс сортировки</button>' +
      '<button type="button" class="btn mini ghost" id="regFiltersReset"' +
      ((state.statusFilter || state.searchQ || hasColFilters() || state.burnOnly) ? '' : ' hidden') +
      '>Сбросить все фильтры</button>' +
      '<button type="button" class="btn mini" id="regAddRow">+ Строка</button>' +
      '<button type="button" class="btn mini ghost" id="regRefresh">↻</button>' +
      '<a href="#/pm-calculations" class="btn mini ghost">Просчёты РП</a>' +
      '</div>' +
      '<p class="muted reg-toolbar-hint">Период: месяц / даты от–до · фильтр по дате внесения или сроку подачи · статус — клик по плашке</p>';
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
    const title = row.tender_title || '—';
    const docIcon = (row.doc_count > 0) ? '<span title="Есть документы" style="margin-right:4px">📎</span>' : '';
    const actionCls = action.needs ? ' reg-row-needs-action reg-action-tone-' + action.tone : '';
    const rejectCls = (row.rp_review && row.rp_review.is_final && row.rp_review.decision === 'reject' && st !== 'отмена')
      ? ' reg-row-rp-reject' : '';
    const unreadCls = row.review_unread ? ' reg-row-unread' : '';
    const regNo = row.registry_no != null ? row.registry_no : row.id;
    const unreadDot = row.review_unread ? '<span class="reg-unread-dot" title="Новый отчёт"></span>' : '';
    const submission = formatSubmissionCell(row);
    const submitHtml = submission
      ? ('<div class="reg-submit-cell"><div class="reg-submit-main">' + esc(submission.withVat) + '</div>' +
         '<div class="reg-submit-vat muted">' + esc(submission.vatLine) + '</div></div>')
      : '<span class="muted">—</span>';
    const comment = row.comment_to || '';
    const dlIso = row.docs_deadline ? API.fmtDateIso(row.docs_deadline) : '';
    return '<tr class="reg-row ' + cls + actionCls + rejectCls + unreadCls + '" data-id="' + row.id + '">' +
      '<td class="reg-no-cell" title="ID: ' + row.id + '"><div class="reg-no-main">' + unreadDot + esc(regNo) + '</div>' +
      '<div class="reg-no-sub">id ' + row.id + '</div></td>' +
      '<td class="reg-editable">' + renderCustomerCell(row) + '</td>' +
      '<td><span class="reg-cell-text reg-title" title="' + esc(title) + '">' + docIcon + esc(title) + '</span></td>' +
      '<td class="reg-col-money"><span class="reg-cell-text reg-price-text" title="' + esc(formatMoney(row.tender_price)) + '">' + esc(formatMoney(row.tender_price)) + '</span></td>' +
      '<td class="reg-col-money reg-col-submit">' + submitHtml + '</td>' +
      '<td class="reg-col-date reg-deadline-cell" data-id="' + row.id + '" data-value="' + esc(dlIso) + '" title="Клик — изменить срок">' +
      '<span class="reg-cell-text reg-deadline-text">' + esc(fmtShortDate(row.docs_deadline)) + '</span></td>' +
      '<td class="reg-col-participation">' + participationCell(row) + '</td>' +
      '<td class="reg-col-analysis">' + analysisDeadlineCell(row) + '</td>' +
      '<td>' + statusPill(st, row.id) + '</td>' +
      '<td class="muted reg-col-person" style="font-size:12px">' + esc(calcName) + '</td>' +
      '<td>' + rpPill + '</td>' +
      '<td class="reg-col-comment"><div class="reg-comment-full">' + (comment ? esc(comment) : '<span class="muted">—</span>') + '</div></td>' +
      '<td class="reg-col-score" title="' + scoreTitle + '">' + esc(scoreTxt) + '</td>' +
      '<td class="muted reg-col-person" style="font-size:11px">' + esc(row.created_by_name || '—') + '</td>' +
      '<td class="muted reg-col-date" style="font-size:11px" title="' + esc(row.created_at || '') + '">' + esc(fmtShortDate(row.created_at)) + '</td>' +
      '<td class="reg-purchase-cell">' + renderPurchaseCell(row) + '</td>' +
      '<td class="reg-action-cell">' + renderActionCell(row) + '</td>' +
      '<td><button type="button" class="btn mini ghost reg-detail" data-id="' + row.id + '" title="Карточка">⋯</button></td>' +
      '</tr>';
  }

  function renderTableHead() {
    return SORT_COLUMNS.map((c) => renderSortTh(c.key, c.label, c.filterKey)).join('') +
      '<th class="reg-th-nosort" title="Ссылка на закупку">↗</th>' +
      '<th class="reg-th-nosort"></th>';
  }

  function renderTable(rows) {
    const filtered = filterRows(rows);
    const sorted = sortRows(filtered);
    if (!filtered.length) {
      return '<div class="reg-empty">' +
        '<div class="reg-empty-ic" aria-hidden="true">' + (state.burnOnly ? '🔥' : '📋') + '</div>' +
        '<div class="reg-empty-title">' + (state.burnOnly ? 'Нет горящих дедлайнов' : 'Нет записей за период') + '</div>' +
        '<div class="reg-empty-msg">' + (state.burnOnly
          ? 'Снимите фильтр или смените период — возможно, всё уже обработано.'
          : 'Смените период или добавьте строку вручную.') + '</div>' +
        '<div class="reg-empty-actions">' +
        (state.burnOnly ? '<button type="button" class="btn mini" id="regBurnClearEmpty">Сбросить горящие</button>' : '') +
        '<button type="button" class="btn mini" id="regAddRowEmpty">+ Строка</button>' +
        '</div></div>';
    }
    let html = '<div class="reg-table-wrap"><table class="tnd-table asg reg-table"><thead><tr>' +
      renderTableHead() +
      '</tr></thead><tbody>';
    sorted.forEach((row) => { html += renderRow(row); });
    html += '</tbody></table></div>';
    const shown = sorted.length;
    html += '<div class="reg-footer muted">' +
      '<span>Всего: <strong>' + (state.totalCount != null ? state.totalCount : shown) + '</strong></span>' +
      '<span>Показано: <strong>' + shown + '</strong> из ' + (state.totalCount != null ? state.totalCount : shown) + '</span>' +
      (state.totalCount != null && state.totalCount > shown
        ? '<span class="muted">· загружено ' + rows.length + ', увеличьте «Строк»</span>' : '') +
      '</div>';
    return html;
  }

  function renderSkeleton() {
    let rows = '';
    for (let i = 0; i < 8; i++) rows += '<div class="reg-skeleton-row" style="animation-delay:' + (i * 40) + 'ms"></div>';
    return '<div class="reg-skeleton" aria-busy="true" aria-label="Загрузка реестра">' + rows + '</div>';
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
      const filtersReset = document.getElementById('regFiltersReset');
      if (filtersReset) {
        filtersReset.hidden = !(state.statusFilter || state.searchQ || hasColFilters() || state.burnOnly);
      }
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
      bindColFilterHandlers();
    } else {
      mountEl.innerHTML = renderToolbar(state.totalCount, periodOptions, actionCount) +
        renderLegend() + renderTable(rowsCache);
      bindDetailDelegation();
      bindTable(rowsCache);
      bindSortHandlers();
      bindColFilterHandlers();
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
      searchInp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        state.searchInput = searchInp.value;
        state.searchQ = state.searchInput.trim();
        refresh();
      });
      searchInp.addEventListener('input', (e) => {
        state.searchInput = e.target.value;
      });
      searchInp.setAttribute('placeholder', 'Заказчик, № реестра, предмет… (Enter)');
      searchInp.title = 'Поиск запускается по Enter';
    }
    mountPeriodWidget();
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
    document.getElementById('regAddRowEmpty')?.addEventListener('click', openAddRowModal);
    document.getElementById('regRefresh')?.addEventListener('click', refresh);
    const clearBurn = () => {
      state.burnOnly = false;
      if (typeof onClearBurnCb === 'function') onClearBurnCb();
      refresh();
    };
    document.getElementById('regBurnClear')?.addEventListener('click', clearBurn);
    document.getElementById('regBurnClearEmpty')?.addEventListener('click', clearBurn);
    document.getElementById('regLimitSel')?.addEventListener('change', (e) => {
      state.limit = Number(e.target.value) || 1000;
      refresh();
    });
    document.getElementById('regSortReset')?.addEventListener('click', () => {
      state.sortKey = null;
      state.sortDir = 1;
      rerenderTable();
    });
    document.getElementById('regFiltersReset')?.addEventListener('click', () => {
      clearAllFilters();
      const searchInp2 = document.getElementById('regSearchInp');
      if (searchInp2) searchInp2.value = '';
      const statusSel = document.getElementById('regStatusSel');
      if (statusSel) statusSel.value = '';
      refresh();
    });
    document.getElementById('regOpenDutyRoster')?.addEventListener('click', () => {
      if (window.AsgardPmDutyPage && AsgardPmDutyPage.openRosterModal) {
        AsgardPmDutyPage.openRosterModal(() => refresh());
      } else {
        location.hash = '#/pm-calculations';
      }
    });
  }

  function bindColFilterHandlers() {
    mountEl.querySelectorAll('.reg-col-filter').forEach((inp) => {
      inp.addEventListener('click', (e) => e.stopPropagation());
      inp.addEventListener('mousedown', (e) => e.stopPropagation());
      inp.addEventListener('input', (e) => {
        const key = inp.getAttribute('data-col-filter');
        if (!key) return;
        state.colFilters[key] = e.target.value;
        debounce('col-filter-' + key, () => {
          rerenderTable();
          const filtersReset = document.getElementById('regFiltersReset');
          if (filtersReset) {
            filtersReset.hidden = !(state.statusFilter || state.searchQ || hasColFilters() || state.burnOnly);
          }
        }, 200);
      });
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
          if (row && window.AsgardRpCalcModal) AsgardRpCalcModal.open(row, pmsCache, refresh, { mode: 'calc' });
          else if (row && window.AsgardRpReviewModal) AsgardRpReviewModal.open(row, pmsCache, refresh, { mode: 'calc' });
        }).catch((e) => toast(e.message, 'err'));
      });
    });
    mountEl.querySelectorAll('.reg-to-archive').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        const row = rows.find((r) => r.id === id);
        if (!row) return;
        const ok = window.confirm(
          'Отправить в архив?\n\n' +
          (row.customer_name || '') + ' — ' + ((row.tender_title || '').slice(0, 80)) +
          '\n\nРП рекомендовал не подавать. После архива тендер уйдёт во вкладку «Архив».'
        );
        if (!ok) return;
        try {
          await API.archiveRegistryRow(id, 'РП: не подаём — подтверждено ТО');
          toast('Тендер в архиве', 'ok');
          refresh();
          onRefreshCb && onRefreshCb();
        } catch (err) { toast(err.message || 'Ошибка архива', 'err'); }
      });
    });
    mountEl.querySelectorAll('.reg-rp-edit, .reg-rp-view').forEach((el) => {
      el.addEventListener('click', () => {
        const row = rows.find((r) => r.id === Number(el.dataset.id));
        if (!row) return;
        const isView = el.classList.contains('reg-rp-view');
        const readOnly = isView;
        let mode = 'calc';
        if (!row.rp_review?.analysis_finalized_at) {
          const rj = row.rp_review?.report_json;
          try {
            const parsed = typeof rj === 'string' ? JSON.parse(rj || '{}') : (rj || {});
            mode = parsed.mode === 'analysis' ? 'analysis' : 'calc';
          } catch (_) { /* ignore */ }
        }
        openRpReviewModal(row, { readOnly, mode, viewAsTo: isView });
      });
    });
    mountEl.querySelectorAll('.reg-rp-chat').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const row = rows.find((r) => r.id === Number(el.dataset.id));
        if (!row) return;
        let mode = 'analysis';
        if (row.rp_review?.analysis_finalized_at) mode = 'calc';
        openRpReviewModal(row, { viewAsTo: true, mode, initialTab: 'thread', readOnly: true });
      });
    });
    mountEl.querySelectorAll('.reg-deadline-cell').forEach((cell) => {
      cell.addEventListener('click', (e) => {
        if (e.target.closest('input')) return;
        e.preventDefault();
        e.stopPropagation();
        if (cell.querySelector('input')) return;
        const id = Number(cell.dataset.id);
        const row = rows.find((r) => r.id === id);
        if (!row) return;
        const cur = cell.dataset.value || '';
        const inp = document.createElement('input');
        inp.type = 'date';
        inp.className = 'inp reg-deadline-inp';
        inp.value = cur;
        inp.style.cssText = 'width:100%;min-width:120px;font-size:12px';
        cell.innerHTML = '';
        cell.appendChild(inp);
        inp.focus();
        const save = async () => {
          const v = inp.value;
          if (!v) {
            toast('Дата подачи обязательна', 'err');
            inp.focus();
            return;
          }
          if (v === cur) {
            refresh();
            return;
          }
          try {
            await API.patchRegistryField(id, 'docs_deadline', v);
            toast('Срок обновлён', 'ok');
            refresh();
            onRefreshCb && onRefreshCb();
          } catch (err) {
            toast(err.message || 'Ошибка', 'err');
            refresh();
          }
        };
        inp.addEventListener('blur', () => { setTimeout(save, 100); });
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
          if (ev.key === 'Escape') { refresh(); }
        });
      });
    });
  }

  async function refresh() {
    if (!mountEl) return;
    if (periodWidget && periodWidget.destroy) {
      try { periodWidget.destroy(); } catch (_) {}
      periodWidget = null;
    }
    mountEl.innerHTML = renderSkeleton();
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
        periodFilter: ensurePeriodFilter(),
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
      bindColFilterHandlers();
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
      state.period = opts.period != null ? opts.period : 'current';
      state.periodFilter = window.TenderPeriodFilter
        ? window.TenderPeriodFilter.fromLegacyPeriod(state.period)
        : null;
      state.burnOnly = !!opts.burnOnly;
      state.hideOthers = !!opts.hideOthers;
      state.hideOthersUserId = opts.hideOthersUserId != null ? Number(opts.hideOthersUserId) : null;
      state.statusFilter = '';
      onRefreshCb = opts.onRefresh;
      onOpenWinCb = opts.onOpenWin;
      onClearBurnCb = opts.onClearBurn;
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
      state.periodFilter = window.TenderPeriodFilter
        ? window.TenderPeriodFilter.fromLegacyPeriod(p)
        : null;
      state.burnOnly = false;
      if (mountEl) refresh();
    },
    setSubtab(sub) {
      state.subtab = sub || 'registry';
      if (mountEl) refresh();
    },
    refresh,
    unmount() {
      if (periodWidget && periodWidget.destroy) {
        try { periodWidget.destroy(); } catch (_) {}
      }
      periodWidget = null;
      mountEl = null;
      rowsCache = [];
      clickBound = false;
      Object.keys(timers).forEach((k) => clearTimeout(timers[k]));
    }
  };
})();
