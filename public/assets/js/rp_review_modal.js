/**
 * RP Review modal — structured report (analysis / calc) + TO decision panel
 */
window.AsgardRpReviewModal = (function () {
  const { esc, toast, showModal, hideModal, replaceModal } = AsgardUI;
  const API = AsgardRegistryApi;

  const MISSING_FLAGS = [
    { id: 'tz', label: 'ТЗ / документация' },
    { id: 'volume', label: 'Объём работ' },
    { id: 'schedule', label: 'Сроки / график' },
    { id: 'site_access', label: 'Доступ на площадку' },
    { id: 'contact', label: 'Контакт заказчика' },
    { id: 'estimate', label: 'Смета / НМЦ' },
    { id: 'contract', label: 'Условия договора' },
    { id: 'other', label: 'Прочее' }
  ];

  const REJECT_PRESETS = [
    { id: 'spec', label: 'Не наша специализация' },
    { id: 'deadline', label: 'Сроки не подходят' },
    { id: 'nmc', label: 'НМЦ / маржа' },
    { id: 'resources', label: 'Нет ресурсов' },
    { id: 'other', label: 'Другое' }
  ];

  const LOG_LABELS = {
    save_draft: 'Черновик сохранён',
    finalize: 'Отчёт закрыт',
    finalize_analysis: 'Анализ закрыт',
    finalize_reject: 'Решение: не подаём',
    attach_estimate: 'Прикреплена смета',
    attach_report: 'Прикреплён отчёт',
    attach_tkp: 'Прикреплено ТКП',
    invite_collaborator: 'Привлечён РП к совместной работе',
    revoke_collaborator: 'Привлечение РП отозвано',
    draft_ready: 'Черновик отмечен готовым',
    save_participant_draft: 'Личный черновик сохранён',
    import_draft_to_final: 'Черновик взят в финал',
    mimir_apply: 'Мимир: применено к отчёту',
    draft_attach_estimate: 'Черновик: смета',
    draft_attach_report: 'Черновик: отчёт',
    draft_attach_tkp: 'Черновик: ТКП',
    to_accept: 'ТО: принято → Готовим',
    to_reject: 'ТО: отклонено',
    to_rework: 'ТО: на доработку',
    thread_message: 'Сообщение в чате',
    thread_attach: 'Вложение в чате'
  };

  const REJECT_TEMPLATE = [{ point: '', reason: '' }];

  function defaultRj(mode) {
    return {
      mode: mode || 'calc',
      summary: '', scope: '', risks: '', recommendation: '',
      questions_for_customer: [], missing_info: [],
      feasibility: '', competition: '',
      price_range_min: null, price_range_max: null,
      cost_without_vat: null,
      duration_days: null, resources: '',
      reject_preset: '', points: []
    };
  }

  function parseRj(raw, mode) {
    let r = raw;
    if (typeof r === 'string') {
      try { r = JSON.parse(r || '{}'); } catch (_) { r = {}; }
    }
    if (!r || typeof r !== 'object') r = {};
    const resolvedMode = mode != null ? mode : (r.mode || 'calc');
    return Object.assign(defaultRj(resolvedMode), r, { mode: resolvedMode });
  }

  function getAnalysisSnapshot(reportJson, review, apiSnapshot) {
    if (apiSnapshot && typeof apiSnapshot === 'object') return apiSnapshot;
    const rj = parseRj(reportJson, 'calc');
    if (rj.analysis_snapshot) return rj.analysis_snapshot;
    if (review?.analysis_finalized_at) {
      return {
        decision: review.decision,
        feasibility: rj.feasibility,
        competition: rj.competition,
        price_range_min: rj.price_range_min,
        price_range_max: rj.price_range_max,
        summary: rj.summary,
        risks: rj.risks,
        recommendation: rj.recommendation,
        finalized_at: review.analysis_finalized_at,
        finalized_by_name: review.analysis_finalized_by_name || ''
      };
    }
    return null;
  }

  function renderAnalysisRefBlock(snap, missingFlags) {
    if (!snap) return '';
    const dec = snap.decision;
    const cls = dec === 'submit' ? 'submit' : (dec === 'reject' ? 'reject' : '');
    const label = dec === 'submit' ? '✓ Подаём' : (dec === 'reject' ? '✕ Не подаём' : '—');
    const who = snap.finalized_by_name || 'дежурный РП';
    const when = snap.finalized_at
      ? new Date(snap.finalized_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '';
    let h = '<div class="rp-review-analysis-ref">';
    h += '<div class="rp-review-analysis-ref-head"><strong>Анализ дежурного РП</strong>';
    h += '<span class="muted">' + esc(who) + (when ? ' · ' + esc(when) : '') + '</span></div>';
    h += '<div class="rp-review-summary-card ' + cls + '" style="margin:0 0 10px"><strong>' + esc(label) + '</strong>';
    const pr = priceRangeLabel(snap, null);
    if (dec === 'submit' && pr !== '—') h += ' · ' + esc(pr);
    h += '</div>';
    h += renderRo('Выполнимость', feasibilityLabel(snap.feasibility));
    h += renderRo('Конкуренция', competitionLabel(snap.competition));
    h += renderRo('Суть для ТО', snap.summary);
    h += renderRo('Риски', snap.risks);
    h += renderRo('Рекомендация', snap.recommendation);
    if (missingFlags && missingFlags.length) {
      const labels = MISSING_FLAGS.filter((f) => missingFlags.includes(f.id)).map((f) => f.label);
      if (labels.length) h += renderRo('Не хватает данных', labels.join(', '));
    }
    h += '</div>';
    return h;
  }

  function fmtMoney(v) {
    return (AsgardUI.moneyRub || AsgardMoney.formatMoney)(v);
  }

  function feasibilityLabel(v) {
    return { yes: 'Да', conditional: 'Условно', no: 'Нет' }[v] || '—';
  }

  function rejectPresetLabel(v) {
    const hit = REJECT_PRESETS.find((p) => p.id === v);
    return hit ? hit.label : '—';
  }

  function priceRangeLabel(rj, workPrice) {
    if (workPrice) return fmtMoney(workPrice) + ' (с НДС)';
    const min = rj.price_range_min;
    const max = rj.price_range_max;
    const fmt = (v) => {
      if (v == null || v === '') return null;
      if (typeof v === 'number' && Number.isFinite(v)) return fmtMoney(v);
      const s = String(v).trim();
      if (!s) return null;
      const n = Number(s.replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? fmtMoney(n) : s;
    };
    const minL = fmt(min);
    const maxL = fmt(max);
    if (minL != null && maxL != null) return minL + ' — ' + maxL + ' (без НДС)';
    if (minL != null) return 'от ' + minL + ' (без НДС)';
    if (maxL != null) return 'до ' + maxL + ' (без НДС)';
    return '—';
  }

  function competitionLabel(v) {
    return { low: 'Низкая', medium: 'Средняя', high: 'Высокая' }[v] || '—';
  }

  function threadInitials(name) {
    return String(name || '?').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();
  }

  function threadRoleShort(role) {
    if (!role) return '';
    if (role === 'TO' || role === 'HEAD_TO') return 'ТО';
    if (role === 'PM' || role === 'HEAD_PM') return 'РП';
    return role;
  }

  function fmtThreadDt(s) {
    if (!s) return '';
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '';
  }

  function currentUserId() {
    try {
      return Number(JSON.parse(localStorage.getItem('asgard_user') || '{}').id) || 0;
    } catch (_) { return 0; }
  }

  function getAuthToken() {
    try { return localStorage.getItem('asgard_token') || ''; } catch (_) { return ''; }
  }

  function threadFileIcon(mime, name) {
    const m = String(mime || '').toLowerCase();
    const n = String(name || '').toLowerCase();
    if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(n)) return '🖼️';
    if (m.includes('pdf') || n.endsWith('.pdf')) return '📕';
    if (m.includes('word') || n.endsWith('.docx') || n.endsWith('.doc')) return '📘';
    if (m.includes('sheet') || m.includes('excel') || /\.(xlsx|xls|csv)$/i.test(n)) return '📗';
    return '📎';
  }

  function progressPct(rj, mode, decision, workPrice, estimateAttached) {
    let total = 5;
    let done = 0;
    if (decision === 'submit' || decision === 'reject') done++;
    if (decision === 'reject') {
      // Для «Не подаём» суть/выполнимость не нужны — считаем причины отказа.
      total = 3;
      if (String(rj.reject_preset || '').trim()) done++;
      if ((rj.points || []).some((p) => String(p.point || '').trim() || String(p.reason || '').trim())) done++;
      return { done, total, pct: Math.round((done / total) * 100) };
    }
    if (rj.feasibility) done++;
    if (String(rj.summary || '').trim()) done++;
    if (String(rj.recommendation || '').trim() || String(rj.risks || '').trim()) done++;
    if (mode === 'calc') {
      total = 9;
      if (String(rj.scope || '').trim()) done++;
      if (rj.duration_days) done++;
      if (String(rj.resources || '').trim()) done++;
      if (workPrice) done++;
      if (estimateAttached) done++;
    }
    return { done, total, pct: Math.round((done / total) * 100) };
  }

  function renderMeta(tender, review, mode) {
    const score = tender.score?.win_chance_pct;
    let h = '<div class="rp-review-meta">';
    h += '<span>НМЦ <strong>' + esc(fmtMoney(tender.tender_price)) + '</strong></span>';
    h += '<span>Срок <strong>' + esc(API.fmtDate(tender.docs_deadline)) + '</strong></span>';
    if (tender.created_by_name) {
      h += '<span>Внёс <strong>' + esc(tender.created_by_name) + '</strong></span>';
    }
    if (score != null) h += '<span>Скор <strong>' + esc(score) + '%</strong></span>';
    if (tender.calculator_user_name || review?.calculator_name) {
      const calcName = review?.finalized_by_name || review?.analysis_finalized_by_name
        || tender.calculator_user_name || review?.calculator_name;
      h += '<span>Считает <strong>' + esc(calcName) + '</strong></span>';
    }
    if (tender.registry_status) h += '<span>Статус <strong>' + esc(tender.registry_status) + '</strong></span>';
    if (tender.purchase_url) {
      h += '<span><a href="' + esc(tender.purchase_url) + '" target="_blank" rel="noopener noreferrer">↗ Закупка</a></span>';
    }
    h += '</div>';
    return h;
  }

  function renderHeaderBadges(review, mode, isLocked) {
    let h = '';
    if (review?.director_review_status === 'pending') {
      h += '<span class="rp-review-badge" style="background:#7c2d12;color:#fdba74">Согласование директора</span>';
    } else if (review?.director_review_status === 'approved') {
      h += '<span class="rp-review-badge" style="background:var(--ok-bg);color:var(--ok-t)">Цена согласована</span>';
    } else if (review?.director_review_status === 'rejected') {
      h += '<span class="rp-review-badge reject">Отклонено директором</span>';
    }
    if (review?.is_final) h += '<span class="rp-review-badge final">Готов</span>';
    else if (review?.analysis_finalized_at && mode === 'calc') {
      h += '<span class="rp-review-badge" style="background:#1e3a5f;color:#93c5fd">Анализ закрыт</span>';
    }
    else if (!isLocked) h += '<span class="rp-review-badge draft">Черновик</span>';
    h += '<span class="rp-review-badge mode-' + (mode === 'calc' ? 'calc' : 'analysis') + '">' +
      (mode === 'calc' ? 'Полный просчёт' : 'Быстрый анализ') + '</span>';
    return h;
  }

  function renderSeg(name, options, value, isLocked) {
    let h = '<div class="rp-review-seg" data-seg="' + esc(name) + '">';
    options.forEach((o) => {
      h += '<button type="button" data-val="' + esc(o.id) + '"' + (value === o.id ? ' class="on"' : '') +
        (isLocked ? ' disabled' : '') + '>' + esc(o.label) + '</button>';
    });
    return h + '</div>';
  }

  function renderChips(flags, selected, isLocked) {
    let h = '<div class="rp-review-chips" id="rpMissingChips">';
    flags.forEach((f) => {
      const on = selected.includes(f.id);
      h += '<button type="button" class="rp-review-chip' + (on ? ' on' : '') + '" data-flag="' + f.id + '"' +
        (isLocked ? ' disabled' : '') + '>' + esc(f.label) + '</button>';
    });
    return h + '</div>';
  }

  function renderReadonlySummary(review, rj, workPrice) {
    const dec = review?.decision;
    const cls = dec === 'submit' ? 'submit' : (dec === 'reject' ? 'reject' : '');
    const label = dec === 'submit' ? '✓ Подаём' : (dec === 'reject' ? '✕ Не подаём' : 'Ожидает решения');
    let h = '<div class="rp-review-summary-card ' + cls + '">';
    h += '<strong>' + esc(label) + '</strong>';
    const priceTxt = priceRangeLabel(rj, workPrice);
    if (dec === 'submit' && priceTxt !== '—') h += ' · ' + esc(priceTxt);
    if (rj.recommendation) h += '<p style="margin:8px 0 0;font-size:13px">' + esc(rj.recommendation) + '</p>';
    h += '</div>';
    return h;
  }

  /** Краткий бриф для директора: цифры и РП сверху, детали ниже. */
  function renderDirectorBriefing(tender, review, rj, workPrice, files) {
    files = files || {};
    const calcName = review?.finalized_by_name
      || tender?.calculator_user_name
      || review?.calculator_name
      || review?.analysis_finalized_by_name
      || '—';
    const cost = rj?.cost_without_vat;
    const priceInc = workPrice != null && workPrice !== '' ? Number(workPrice) : null;
    const priceEx = review?.work_price_ex_vat != null
      ? Number(review.work_price_ex_vat)
      : (Number.isFinite(priceInc) ? Math.round((priceInc / 1.22) * 100) / 100 : null);
    const duration = rj?.duration_days;
    const deadline = tender?.docs_deadline;
    const dec = review?.decision;
    const decLabel = dec === 'submit' ? 'РП: подаём' : (dec === 'reject' ? 'РП: не подаём' : 'Решение РП не зафиксировано');
    const decCls = dec === 'submit' ? 'ok' : (dec === 'reject' ? 'bad' : '');

    const docs = [];
    if (files.estimate) docs.push({ file: files.estimate, label: 'Смета' });
    if (files.report) docs.push({ file: files.report, label: 'Отчёт' });
    if (files.tkp) docs.push({ file: files.tkp, label: 'ТКП' });

    let h = '<div class="rp-dir-brief">';
    h += '<div class="rp-dir-brief-top">';
    h += '<div class="rp-dir-brief-title">Просчёт на согласование</div>';
    h += '<span class="rp-dir-brief-pill ' + decCls + '">' + esc(decLabel) + '</span>';
    h += '</div>';

    h += '<div class="rp-dir-brief-grid">';
    h += '<div class="rp-dir-kv"><div class="k">РП (считал)</div><div class="v">' + esc(calcName) + '</div></div>';
    h += '<div class="rp-dir-kv"><div class="k">Заказчик</div><div class="v">' + esc(tender?.customer_name || '—') + '</div></div>';
    h += '<div class="rp-dir-kv"><div class="k">Себестоимость без НДС</div><div class="v">' +
      esc(cost != null && cost !== '' ? fmtMoney(cost) : '—') + '</div></div>';
    h += '<div class="rp-dir-kv highlight"><div class="k">Сумма подачи с НДС</div><div class="v">' +
      esc(Number.isFinite(priceInc) ? fmtMoney(priceInc) : '—') + '</div></div>';
    h += '<div class="rp-dir-kv"><div class="k">Сумма подачи без НДС</div><div class="v">' +
      esc(Number.isFinite(priceEx) ? fmtMoney(priceEx) : '—') + '</div></div>';
    h += '<div class="rp-dir-kv"><div class="k">Срок выполнения</div><div class="v">' +
      esc(duration != null && duration !== '' ? (duration + ' дн.') : '—') + '</div></div>';
    h += '<div class="rp-dir-kv"><div class="k">Срок подачи документов</div><div class="v">' +
      esc(API.fmtDate ? API.fmtDate(deadline) : (deadline || '—')) + '</div></div>';
    h += '<div class="rp-dir-kv"><div class="k">Предмет</div><div class="v rp-dir-subject">' +
      esc(tender?.tender_title || '—') + '</div></div>';
    h += '</div>';

    if (rj?.recommendation) {
      h += '<div class="rp-dir-rec"><span class="k">Рекомендация РП</span> ' + esc(rj.recommendation) + '</div>';
    } else if (rj?.summary) {
      h += '<div class="rp-dir-rec"><span class="k">Суть</span> ' + esc(String(rj.summary).slice(0, 280)) +
        (String(rj.summary).length > 280 ? '…' : '') + '</div>';
    }

    h += '<div class="rp-dir-docs-bar">';
    h += '<button type="button" class="btn" id="rpDirDocsToggle">📄 Документы' +
      (docs.length ? ' (' + docs.length + ')' : '') + '</button>';
    if (tender?.purchase_url) {
      h += '<a class="btn ghost mini" href="' + esc(tender.purchase_url) + '" target="_blank" rel="noopener">↗ Закупка</a>';
    }
    h += '</div>';

    h += '<div id="rpDirDocsPanel" class="rp-dir-docs-panel" hidden>';
    if (!docs.length) {
      h += '<p class="muted" style="margin:0">Файлы просчёта не прикреплены</p>';
    } else {
      docs.forEach((d) => {
        const f = d.file;
        const kb = f.size ? Math.round(f.size / 1024) + ' КБ' : '';
        const arch = (() => {
          const name = String(f.original_name || '').toLowerCase();
          const mime = String(f.mime_type || '').toLowerCase();
          return mime.includes('zip') || mime.includes('rar') || mime.includes('7z') || /\.(zip|rar|7z)$/i.test(name);
        })();
        h += '<div class="rp-dir-doc-row">';
        h += '<div class="rp-dir-doc-meta"><span class="pill mini">' + esc(d.label) + '</span> ';
        h += '<strong>' + esc(f.original_name || d.label) + '</strong>';
        if (kb) h += ' <span class="muted">' + kb + '</span>';
        h += '</div><div class="rp-dir-doc-actions">';
        if (!arch && f.id) {
          h += '<button type="button" class="btn mini rp-attach-preview" data-doc-id="' + f.id +
            '" data-name="' + esc(f.original_name || d.label) + '">Просмотр</button>';
        }
        if (f.download_url) {
          h += '<a class="btn mini ghost" href="' + esc(f.download_url) + '" target="_blank" rel="noreferrer">Скачать</a>';
        }
        h += '</div></div>';
      });
    }
    h += '<div id="rpDirToDocs" class="rp-dir-to-docs muted" style="font-size:12px;margin-top:10px"></div>';
    h += '</div>';

    h += '</div>';
    return h;
  }

  function renderRo(label, value) {
    if (!value) return '';
    return '<div class="rp-review-ro"><div class="lbl">' + esc(label) + '</div><div>' + esc(value) + '</div></div>';
  }

  function open(tender, pms, onSaved, opts) {
    pms = pms || [];
    opts = opts || {};
    const role = opts.role || '';
    const isTo = role === 'to';
    const isDirector = role === 'director';
    const isViewer = role === 'viewer';
    let isLocked = !!opts.readOnly || isViewer;
    let mode = opts.mode || 'calc';
    const contextMode = opts.mode || null;
    let tab = opts.initialTab || 'report';
    let review = null;
    let logs = [];
    let collabs = [];
    let estimateFile = null;
    let reportFile = null;
    let tkpFile = null;
    let threadMessages = [];
    let threadUnread = 0;
    let threadSending = false;
    let threadPendingFiles = [];
    let decision = 'pending';
    let reportKind = 'work';
    let reportJson = defaultRj(mode);
    let workPrice = '';
    let missingFlags = [];
    let collapsed = {};
    let analysisSnapshot = null;
    let isFinalOwner = true;
    let isRealFinalOwner = true;
    let canFinalize = true;
    let finalOwnerName = '';
    let finalOwnerUserId = null;
    let myDraft = null;
    let teamDrafts = [];
    let teamSummary = null;
    let editingParticipantDraft = false; // коллаб пишет в my-draft, не в финал

    function titleText() {
      return 'Отчёт РП · #' + tender.id;
    }

    function badgesHtml() {
      return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">' + renderHeaderBadges(review, mode, isLocked) + '</div>';
    }

    function decodeEntities(s) {
      if (s == null || s === '') return '';
      const str = String(s);
      if (!/[&](?:amp|quot|lt|gt|#\d+|#x[0-9a-f]+);/i.test(str)) return str;
      try {
        const ta = document.createElement('textarea');
        ta.innerHTML = str;
        return ta.value;
      } catch (_) {
        return str
          .replace(/&quot;/g, '"')
          .replace(/&#39;|&apos;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');
      }
    }

    /** Plain text for modal subtitle (textContent — без HTML-escape). */
    function subtitleText() {
      const c = decodeEntities(tender.customer_name || '');
      const t = decodeEntities(tender.tender_title || '');
      const short = t.length > 90 ? t.slice(0, 90) + '…' : t;
      return c + (c && short ? ' · ' : '') + short;
    }

    /** Для вставки в HTML body. */
    function subtitleHtml() {
      return esc(subtitleText());
    }

    function renderDecisionCards() {
      if (isLocked) return '';
      let h = '<div class="rp-review-decision-row">';
      h += '<button type="button" class="rp-review-decision-card' + (decision === 'submit' ? ' selected submit' : '') + '" data-dec="submit">' +
        '<div class="rp-dec-icon">✓</div><div class="rp-dec-title">Подаём</div><div class="rp-dec-hint">Рекомендуем участие</div></button>';
      h += '<button type="button" class="rp-review-decision-card' + (decision === 'reject' ? ' selected reject' : '') + '" data-dec="reject">' +
        '<div class="rp-dec-icon">✕</div><div class="rp-dec-title">Не подаём</div><div class="rp-dec-hint">С указанием причин</div></button>';
      return h + '</div>';
    }

    const RP_FILE_ACCEPT = '.xlsx,.xls,.csv,.docx,.doc,.pdf,.zip,.rar,.7z';
    const RP_FILE_HINT = '.xlsx, .docx, .pdf, .zip, .rar, .7z';

    function isArchiveFile(file) {
      if (!file) return false;
      const name = String(file.original_name || file.filename || '').toLowerCase();
      const mime = String(file.mime_type || '').toLowerCase();
      return mime.includes('zip') || mime.includes('rar') || mime.includes('7z')
        || mime.includes('compressed') || mime.includes('x-tar')
        || /\.(zip|rar|7z|tar|gz|tgz)$/i.test(name);
    }

    function canPreviewFile(file) {
      return !!(file && file.id && !isArchiveFile(file));
    }

    function renderAttachedFile(file, label) {
      if (!file) return '';
      const kb = file.size ? Math.round(file.size / 1024) + ' КБ' : '';
      const previewBtn = canPreviewFile(file)
        ? ' <button type="button" class="btn mini rp-attach-preview" data-doc-id="' + file.id +
          '" data-name="' + esc(file.original_name || label) + '" style="margin-left:8px">Просмотр</button>'
        : '';
      return '<div class="rp-review-estimate has-file" style="margin-top:8px"><span class="muted" style="font-size:12px">' + esc(label) + '</span><br/>' +
        '<strong>' + esc(file.original_name || label) + '</strong>' +
        (kb ? ' <span class="muted">' + kb + '</span>' : '') +
        previewBtn +
        ' <a class="btn mini' + (previewBtn ? ' ghost' : '') + '" href="' + esc(file.download_url) + '" target="_blank" rel="noreferrer" style="margin-left:8px">Скачать</a></div>';
    }

    function renderUploadDrop(inputId, title, hint) {
      return '<div class="rp-review-estimate rp-review-estimate-drop" style="margin-top:10px">' +
        '<strong>' + esc(title) + '</strong>' +
        '<span class="muted" style="font-size:12px">' + esc(hint) + '</span>' +
        '<input type="file" class="inp" id="' + inputId + '" accept="' + RP_FILE_ACCEPT + '" style="margin-top:10px;width:100%"/></div>';
    }

    /** Always visible for RP (upload) and TO (download) — not gated by decision/mode. */
    function renderAttachmentsSection() {
      const showTkp = mode === 'calc' || !!tkpFile;
      const hasAny = !!(estimateFile || reportFile || tkpFile);
      if (isLocked && !hasAny) return '';

      let ih = '';
      if (!isLocked) {
        ih += '<p class="muted" style="font-size:12px;margin:0 0 8px">Можно приложить смету, файл отчёта' +
          (mode === 'calc' ? ' или ТКП' : '') +
          ' — архив, Excel, Word, PDF (необязательно на анализе).</p>';
      }

      if (estimateFile) {
        ih += renderAttachedFile(estimateFile, 'Смета / расчёт');
      } else if (!isLocked) {
        ih += renderUploadDrop('rpEstimateFile', 'Прикрепить смету / файл', RP_FILE_HINT);
      }

      if (reportFile) {
        ih += renderAttachedFile(reportFile, 'Файл отчёта');
      } else if (!isLocked) {
        ih += renderUploadDrop('rpReportFile', 'Прикрепить файл отчёта', RP_FILE_HINT);
      }

      if (showTkp) {
        if (tkpFile) {
          ih += renderAttachedFile(tkpFile, 'ТКП');
        } else if (!isLocked && mode === 'calc') {
          ih += '<div class="rp-review-field" style="margin-top:12px"><label>ТКП <span class="req">*</span></label></div>';
          ih += renderUploadDrop('rpTkpFile', 'Прикрепить ТКП', RP_FILE_HINT);
        }
      }

      if (!ih) return '';
      return section('attachments', 'Вложения РП', ih);
    }

    function section(id, title, inner) {
      const col = collapsed[id];
      return '<div class="rp-review-section' + (col ? ' collapsed' : '') + '" data-sec="' + id + '">' +
        '<div class="rp-review-section-head" data-toggle-sec="' + id + '">' + esc(title) +
        ' <span class="rp-section-chevron">' + (col ? '▶' : '▼') + '</span></div>' +
        '<div class="rp-review-section-body">' + inner + '</div></div>';
    }

    function renderReportTab() {
      let h = '';
      const hasSnap = mode === 'calc' && analysisSnapshot;
      const calcNoSnap = mode === 'calc' && !analysisSnapshot && !isLocked;

      // Для директора ключевые цифры уже в брифе сверху — не дублируем summary-card.
      if (!(isDirector && isLocked)) {
        if (hasSnap) {
          h += renderAnalysisRefBlock(analysisSnapshot, missingFlags);
        } else if (calcNoSnap) {
          h += '<div class="alert" style="margin-bottom:12px;font-size:13px">Анализ дежурного РП ещё не закрыт. Можно начать просчёт, но рекомендации анализа пока недоступны.</div>';
        }

        if (isLocked && review) {
          h += renderReadonlySummary(review, hasSnap ? analysisSnapshot : reportJson, workPrice);
        } else if (!hasSnap) {
          h += renderDecisionCards();
        } else {
          const dec = analysisSnapshot.decision || decision;
          const cls = dec === 'submit' ? 'submit' : (dec === 'reject' ? 'reject' : '');
          const label = dec === 'submit' ? '✓ Подаём' : (dec === 'reject' ? '✕ Не подаём' : '—');
          h += '<div class="rp-review-summary-card ' + cls + '" style="margin-bottom:10px"><strong>' + esc(label) + '</strong>';
          h += '<p class="muted" style="margin:6px 0 0;font-size:12px">Решение из анализа дежурного РП</p></div>';
          decision = dec === 'reject' ? 'reject' : 'submit';
          reportKind = decision === 'reject' ? 'reject' : 'work';
        }
      } else if (hasSnap) {
        h += renderAnalysisRefBlock(analysisSnapshot, missingFlags);
      }

      if (!isLocked) {
        const pr = progressPct(reportJson, mode, decision, workPrice, !!estimateFile);
        h += '<div class="rp-review-progress">Заполнено ' + pr.done + '/' + pr.total + ' разделов<bar><i style="width:' + pr.pct + '%"></i></bar></div>';
      }

      if (decision === 'reject' && mode !== 'calc') {
        const presets = section('reject', 'Причины отказа', (() => {
          let ih = '';
          if (isLocked && reportJson.reject_preset) {
            ih += renderRo('Категория', rejectPresetLabel(reportJson.reject_preset));
          } else {
            ih += '<div class="rp-review-field"><label>Категория</label>' +
              renderSeg('reject_preset', REJECT_PRESETS, reportJson.reject_preset || '', isLocked) + '</div>';
          }
          const points = reportJson.points?.length ? reportJson.points : REJECT_TEMPLATE;
          points.forEach((p, i) => {
            if (isLocked) {
              ih += renderRo('Пункт ' + (i + 1), (p.point || '') + (p.reason ? ' — ' + p.reason : ''));
            } else {
              ih += '<div class="rp-review-field"><input class="inp rp-point" data-i="' + i + '" placeholder="Пункт ТЗ / требование" value="' + esc(p.point || '') + '"/>' +
                '<input class="inp rp-reason" data-i="' + i + '" placeholder="Почему не подаём" value="' + esc(p.reason || '') + '" style="margin-top:4px"/></div>';
            }
          });
          if (!isLocked) ih += '<button type="button" class="btn mini ghost" id="rpAddRejectPoint">+ Пункт</button>';
          return ih;
        })());
        h += presets;
      }

      if (decision === 'submit') {
        if (mode === 'analysis' || (mode === 'calc' && !hasSnap)) {
        const assess = section('assess', 'Оценка и рекомендация', (() => {
          let ih = '<div class="rp-review-field-row">';
          ih += '<div class="rp-review-field"><label>Выполнимость' + (!isLocked ? ' <span class="req">*</span>' : '') + '</label>';
          ih += isLocked ? renderRo('', feasibilityLabel(reportJson.feasibility)) :
            renderSeg('feasibility', [{ id: 'yes', label: 'Да' }, { id: 'conditional', label: 'Условно' }, { id: 'no', label: 'Нет' }], reportJson.feasibility, isLocked);
          ih += '</div><div class="rp-review-field"><label>Конкуренция</label>';
          ih += isLocked ? renderRo('', competitionLabel(reportJson.competition)) :
            renderSeg('competition', [{ id: 'low', label: 'Низкая' }, { id: 'medium', label: 'Средняя' }, { id: 'high', label: 'Высокая' }], reportJson.competition, isLocked);
          ih += '</div></div>';

          if (mode === 'analysis' && !isLocked) {
            ih += '<p class="muted" style="margin:0 0 8px;font-size:12px">Ориентир до детального просчёта — оба значения без НДС.</p>';
            ih += '<div class="rp-review-field-row"><div class="rp-review-field"><label>Ориентир цены от (без НДС)</label>' +
              '<input class="inp" id="rpPriceMin" type="text" value="' + esc(reportJson.price_range_min ?? '') + '" placeholder="например: 5 млн или по КП"/></div>' +
              '<div class="rp-review-field"><label>до (без НДС)</label>' +
              '<input class="inp" id="rpPriceMax" type="text" value="' + esc(reportJson.price_range_max ?? '') + '" placeholder="цифры или текст"/></div></div>';
          } else if (mode === 'analysis' && isLocked) {
            const pr = priceRangeLabel(reportJson, workPrice);
            if (pr !== '—') ih += renderRo('Ориентир цены', pr);
          } else if (mode === 'calc' && isLocked && workPrice) {
            ih += renderRo('Цена работ (с НДС)', fmtMoney(workPrice));
          }

          ih += '<div class="rp-review-field"><label>Суть для ТО' + (!isLocked ? ' <span class="req">*</span>' : '') + '</label>';
          ih += isLocked ? renderRo('', reportJson.summary) :
            '<textarea class="inp" id="rpSummary" rows="3">' + esc(reportJson.summary || '') + '</textarea>';
          ih += '</div><div class="rp-review-field"><label>Риски</label>';
          ih += isLocked ? renderRo('', reportJson.risks) :
            '<textarea class="inp" id="rpRisks" rows="2">' + esc(reportJson.risks || '') + '</textarea>';
          ih += '</div><div class="rp-review-field"><label>Рекомендация РП</label>';
          ih += isLocked ? renderRo('', reportJson.recommendation) :
            '<textarea class="inp" id="rpRecommendation" rows="2">' + esc(reportJson.recommendation || '') + '</textarea>';
          ih += '</div>';
          return ih;
        })());
        h += assess;
        }

        if (mode === 'calc') {
          h += section('scope', 'Объём и сроки', (() => {
            let ih = '<div class="rp-review-field"><label>Объём работ (scope)</label>';
            ih += isLocked ? renderRo('', reportJson.scope) :
              '<textarea class="inp" id="rpScope" rows="3">' + esc(reportJson.scope || '') + '</textarea>';
            ih += '</div><div class="rp-review-field-row">';
            ih += '<div class="rp-review-field"><label>Срок выполнения, дней</label>';
            ih += isLocked ? renderRo('', reportJson.duration_days) :
              '<input class="inp" id="rpDuration" type="number" value="' + esc(reportJson.duration_days ?? '') + '"/>';
            ih += '</div><div class="rp-review-field"><label>Ресурсы (бригада / техника)</label>';
            ih += isLocked ? renderRo('', reportJson.resources) :
              '<input class="inp" id="rpResources" value="' + esc(reportJson.resources || '') + '"/>';
            ih += '</div></div>';
            ih += '<div class="rp-review-field"><label>Вопросы заказчику</label>';
            if (isLocked) {
              (reportJson.questions_for_customer || []).forEach((q) => { ih += renderRo('', q); });
            } else {
              ih += '<div class="rp-review-questions" id="rpQuestions">';
              const qs = (reportJson.questions_for_customer || []).length ? reportJson.questions_for_customer : [''];
              qs.forEach((q, i) => {
                ih += '<div class="rp-review-q-row"><input class="inp rp-q-inp" data-i="' + i + '" value="' + esc(q) + '"/>' +
                  (qs.length > 1 ? '<button type="button" class="btn mini ghost rp-q-del" data-i="' + i + '">✕</button>' : '') + '</div>';
              });
              ih += '</div><button type="button" class="btn mini ghost" id="rpAddQuestion">+ Вопрос</button>';
            }
            ih += '</div>';
            return ih;
          })());

          h += section('finance', 'Финансы', (() => {
            let ih = '<div class="rp-review-field"><label>Себестоимость, ₽ (без НДС)</label>';
            ih += isLocked ? renderRo('', reportJson.cost_without_vat != null ? fmtMoney(reportJson.cost_without_vat) : '—') :
              '<input class="inp" id="rpCostNoVat" type="number" value="' + esc(reportJson.cost_without_vat ?? '') + '"/>';
            ih += '</div>';
            ih += '<div class="rp-review-field"><label>Цена работ, ₽ (с НДС)' + (!isLocked ? ' <span class="req">*</span>' : '') + '</label>';
            ih += isLocked ? renderRo('', fmtMoney(workPrice)) :
              '<input class="inp" id="rpPrice" type="number" value="' + esc(workPrice) + '"/>';
            ih += '</div>';
            return ih;
          })());
        }

        h += section('missing', 'Не хватает данных', renderChips(MISSING_FLAGS, missingFlags, isLocked));
      }

      h += renderAttachmentsSection();

      return h;
    }

    function renderTenderTab() {
      return '<div class="rp-review-field">' + renderRo('Заказчик', tender.customer_name) +
        renderRo('Тендер', tender.tender_title) +
        renderRo('Комментарий ТО', tender.comment_to) +
        (tender.purchase_url ? '<p><a href="' + esc(tender.purchase_url) + '" target="_blank" rel="noopener" class="btn mini">↗ Открыть закупку</a></p>' : '') +
        '</div>';
    }

    function renderHistoryTab() {
      const TO_FINAL_ACTIONS = new Set([
        'finalize', 'finalize_analysis', 'finalize_reject',
        'attach_estimate', 'attach_report', 'attach_tkp',
        'to_accept', 'to_reject', 'to_rework',
        'invite_collaborator', 'revoke_collaborator'
      ]);
      let visible = logs;
      let h = '';
      if (isTo && !isDirector) {
        const compact = logs.filter((l) => TO_FINAL_ACTIONS.has(l.action));
        const hidden = logs.length - compact.length;
        visible = compact;
        if (hidden > 0) {
          h += '<p class="muted" style="font-size:12px;margin:0 0 8px">Показаны финальные действия для ТО. ' +
            'В памяти тендера ещё ' + hidden + ' записей черновиков/Мимира (доступны РП и админам).</p>';
        }
      }
      if (!visible.length) return h + '<p class="muted">Пока нет действий</p>';
      h += '<ul class="rp-review-timeline">';
      visible.forEach((l) => {
        const label = LOG_LABELS[l.action] || l.action;
        let extra = '';
        if (l.payload_json) {
          try {
            const p = typeof l.payload_json === 'string' ? JSON.parse(l.payload_json) : l.payload_json;
            if (p.comment) extra = ' — ' + p.comment;
            if (l.action === 'mimir_apply' && p.session_uid) extra += ' · сессия ' + String(p.session_uid).slice(0, 8);
            if (l.action === 'import_draft_to_final' && p.author_user_id) extra += ' · от РП #' + p.author_user_id;
          } catch (_) { /* ignore */ }
        }
        h += '<li><div class="tl-time">' + new Date(l.created_at).toLocaleString('ru-RU') +
          ' · ' + esc(l.actor_name || '—') + '</div><div class="tl-action">' + esc(label) + esc(extra) + '</div></li>';
      });
      return h + '</ul>';
    }

    function renderRoleBanner() {
      if (isLocked || isTo || isDirector) return '';
      let h = '';
      if (editingParticipantDraft) {
        h += '<div class="alert" style="margin:0 0 12px;font-size:13px">Вы готовите <b>личный черновик</b> для ' +
          esc(finalOwnerName || 'хозяина фазы') +
          '. Закрыть анализ/отчёт может только он — отметьте «Готово», когда закончите.</div>';
      } else if (isFinalOwner && teamSummary && (teamSummary.drafts_count > 0 || (collabs && collabs.length))) {
        h += '<div class="muted" style="margin:0 0 10px;font-size:12px">Команда: ' +
          (collabs.length || 0) + ' привлечённых · черновиков: ' + (teamSummary.drafts_count || 0) +
          (teamSummary.ready_count ? ' · готовых: ' + teamSummary.ready_count : '') +
          ' · вкладка «Команда»</div>';
      }
      if (!isLocked) {
        h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px">' +
          '<button type="button" class="btn mini" id="rpOpenMimir" title="Опциональный просчёт через Мимир-Quick">🚀 Просчёт Мимир</button>' +
          '</div>';
      }
      return h;
    }

    function renderTeamTab() {
      let h = '';
      if (finalOwnerName) {
        h += '<p class="muted" style="margin:0 0 10px;font-size:12px">Хозяин финала: <b>' + esc(finalOwnerName) + '</b></p>';
      }
      h += '<h4 style="margin:0 0 8px;font-size:13px">Привлечённые РП</h4>';
      if (collabs.length) {
        h += '<ul style="padding-left:0;margin:0 0 12px;list-style:none">' +
          collabs.map((c) => {
            let row = '<li style="display:flex;align-items:center;gap:8px;margin:6px 0">' +
              '<span style="flex:1">' + esc(c.pm_name) + '</span>';
            if (!isLocked && isFinalOwner) {
              row += '<button type="button" class="btn mini ghost rp-revoke-collab" data-pm="' + c.pm_user_id + '">Отозвать</button>';
            }
            return row + '</li>';
          }).join('') + '</ul>';
      } else {
        h += '<p class="muted" style="margin:0 0 12px">Нет привлечённых РП — это параллельная работа, не перевод тендера</p>';
      }
      if (!isLocked && isFinalOwner) {
        h += '<div class="rp-review-field"><label>Привлечь РП к совместному ' +
          (mode === 'calc' ? 'просчёту' : 'анализу') + '</label><div style="display:flex;gap:8px">' +
          '<select class="inp" id="rpInvitePm" style="flex:1"><option value="">— выберите —</option>' +
          pms.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') +
          '</select><button type="button" class="btn mini" id="rpInviteBtn">Пригласить</button></div></div>';
      }

      h += '<h4 style="margin:16px 0 8px;font-size:13px">Черновики команды</h4>';
      const cards = [];
      if (myDraft && editingParticipantDraft) {
        cards.push({ ...myDraft, _mine: true });
      }
      (teamDrafts || []).forEach((d) => cards.push(d));
      if (!cards.length) {
        h += '<p class="muted" style="margin:0">Пока нет чужих черновиков</p>';
      } else {
        cards.forEach((d) => {
          const dj = d.draft_json || {};
          const ready = d.status === 'ready';
          h += '<div class="rp-review-summary-card" style="margin-bottom:10px">' +
            '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">' +
            '<strong>' + esc(d.author_name || (d._mine ? 'Вы' : 'РП')) +
            (ready ? ' · <span style="color:var(--ok,#4ade80)">готово</span>' : '') + '</strong>' +
            '<span class="muted" style="font-size:11px">' +
            (d.updated_at ? new Date(d.updated_at).toLocaleString('ru-RU') : '') + '</span></div>';
          if (dj.summary) h += '<div style="font-size:12px;margin-top:6px">' + esc(String(dj.summary).slice(0, 220)) + '</div>';
          if (dj.price_range_min != null || dj.price_range_max != null) {
            h += '<div class="muted" style="font-size:11px;margin-top:4px">Ориентир: ' +
              esc(fmtMoney(dj.price_range_min)) + ' — ' + esc(fmtMoney(dj.price_range_max)) + '</div>';
          }
          if (dj.work_price != null) {
            h += '<div class="muted" style="font-size:11px;margin-top:4px">Цена: ' + esc(fmtMoney(dj.work_price)) + '</div>';
          }
          if (isFinalOwner && !isLocked && !d._mine) {
            h += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' +
              '<button type="button" class="btn mini rp-import-draft" data-draft-id="' + d.id + '" data-files="1">Взять в финал (поля+файлы)</button>' +
              '<button type="button" class="btn mini ghost rp-import-draft" data-draft-id="' + d.id + '" data-files="0">Только поля</button>' +
              '</div>';
          }
          h += '</div>';
        });
      }
      return h;
    }

    function renderThreadTab() {
      const uid = currentUserId();
      let h = '<div class="rp-review-thread">';
      h += '<div class="rp-review-thread-head"><strong>Вопросы и ответы</strong>' +
        '<span class="muted" style="font-size:12px">ТО и РП по этому тендеру · у каждого файла есть предпросмотр</span></div>';
      h += '<div class="rp-review-thread-feed" id="rpThreadFeed">';
      if (!threadMessages.length) {
        h += '<p class="muted">Пока нет сообщений — задайте вопрос или ответьте коллеге</p>';
      } else {
        threadMessages.forEach((m) => {
          const mine = Number(m.user_id) === uid;
          h += '<div class="rp-thread-msg' + (mine ? ' mine' : '') + '">';
          h += '<div class="rp-thread-msg-meta">';
          if (!mine) h += '<span class="rp-thread-avatar">' + esc(threadInitials(m.user_name)) + '</span>';
          h += '<span class="rp-thread-author">' + esc(m.user_name || 'Пользователь') + '</span>';
          h += '<span class="pill mini muted">' + esc(threadRoleShort(m.user_role)) + '</span>';
          h += '<span class="muted" style="font-size:11px">' + esc(fmtThreadDt(m.created_at)) + '</span>';
          h += '</div><div class="rp-thread-bubble">';
          if (m.body) h += '<div class="rp-thread-text">' + esc(m.body) + '</div>';
          if ((m.files || []).length) {
            h += '<div class="rp-thread-files">';
            (m.files || []).forEach((f) => {
              const fname = f.original_name || 'файл';
              h += '<div class="rp-thread-file-card">';
              h += '<span class="rp-thread-file-icon">' + threadFileIcon(f.mime_type, fname) + '</span>';
              h += '<div class="rp-thread-file-meta"><div class="rp-thread-file-name" title="' + esc(fname) + '">' + esc(fname) + '</div></div>';
              if (canPreviewFile(f)) {
                h += '<button type="button" class="btn mini rp-thread-preview" data-doc-id="' + f.id + '" data-name="' + esc(fname) + '">Просмотр</button>';
              }
              h += '<a class="btn mini ghost" href="' + esc(f.download_url) + '" target="_blank" rel="noreferrer" download>↓</a>';
              h += '</div>';
            });
            h += '</div>';
          }
          h += '</div></div>';
        });
      }
      h += '</div>';
      if (review?.is_final && !['pending', 'approved'].includes(review.director_review_status || '')) {
        h += '<div class="alert" style="margin-top:12px;font-size:13px">Чат закрыт — отчёт финализирован. История сообщений доступна только для просмотра.</div>';
      } else {
      h += '<div class="rp-review-thread-form">';
      h += '<input type="file" id="rpThreadFiles" multiple style="display:none"/>';
      h += '<button type="button" class="btn mini ghost" id="rpThreadAttach">📎' +
        (threadPendingFiles.length ? ' (' + threadPendingFiles.length + ')' : '') + '</button>';
      if (threadPendingFiles.length) {
        h += '<div class="rp-thread-pending-list">';
        threadPendingFiles.forEach((f, i) => {
          h += '<div class="rp-thread-pending-file"><span>' + threadFileIcon(f.type, f.name) + ' ' + esc(f.name) + '</span>' +
            '<button type="button" class="btn mini rp-thread-preview-local" data-i="' + i + '">Просмотр</button>' +
            '<button type="button" class="btn mini ghost rp-thread-remove-local" data-i="' + i + '">✕</button></div>';
        });
        h += '</div>';
      }
      h += '<div style="flex:1;min-width:200px"><textarea class="inp" id="rpThreadText" rows="2" placeholder="Напишите вопрос или ответ…  Enter — отправить"></textarea></div>';
      h += '<button type="button" class="btn" id="rpThreadSend"' + (threadSending ? ' disabled' : '') + '>Отправить</button>';
      h += '</div>';
      }
      h += '</div>';
      return h;
    }

    async function previewThreadFile(docId, name) {
      const url = '/api/tenders/' + tender.id + '/rp-review/files/' + docId + '/preview';
      try {
        const r = await fetch(url, { headers: { Authorization: 'Bearer ' + getAuthToken() } });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || ('HTTP ' + r.status));
        }
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html')) {
          const html = await r.text();
          if (window.AsgardDocPreview) {
            AsgardDocPreview.open({ title: name || 'Файл', htmlContent: html, downloadUrl: url });
          }
          return;
        }
        const blob = await r.blob();
        const blobUrl = URL.createObjectURL(blob);
        if (window.AsgardDocPreview) {
          AsgardDocPreview.open({
            title: name || 'Файл',
            fileUrl: blobUrl,
            mime: ct,
            downloadUrl: url
          });
        }
      } catch (e) { toast('Ошибка', e.message || 'Сбой', 'err'); }
    }

    function previewLocalThreadFile(file) {
      const blobUrl = URL.createObjectURL(file);
      if (window.AsgardDocPreview) {
        AsgardDocPreview.open({
          title: file.name,
          fileUrl: blobUrl,
          mime: file.type || '',
          downloadUrl: blobUrl
        });
      }
    }

    function loadThreadMessages() {
      return API.loadRpReviewMessages(tender.id).then((d) => {
        threadMessages = d.messages || [];
        threadUnread = 0;
        if (tab === 'thread') {
          const feed = document.getElementById('rpThreadFeed');
          if (feed) feed.scrollTop = feed.scrollHeight;
        }
      }).catch((e) => toast('Ошибка', e.message || 'Сбой', 'err'));
    }

    function renderToBar() {
      if (review?.director_review_status === 'pending') return '';
      if (isViewer || !isTo || !review?.is_final) return '';
      // РП сказал «не подаём» — ТО подтверждает архив или возвращает на доработку
      if (review.decision === 'reject') {
        return '<div class="rp-review-to-bar rp-review-to-bar-reject">' +
          '<h4>РП рекомендует: Не подаём</h4>' +
          '<p class="muted" style="font-size:12px;margin:0 0 10px">Тендер остаётся в активном реестре. Подтвердите архив или верните отчёт РП на доработку.</p>' +
          '<div class="rp-review-to-comment">' +
          '<label class="muted" style="font-size:12px;display:block;margin-bottom:4px">Комментарий (для «На доработку» — обязателен)</label>' +
          '<textarea class="inp" id="rpToComment" rows="2" placeholder="Комментарий…"></textarea>' +
          '</div>' +
          '<div class="rp-review-to-actions">' +
          '<button type="button" class="btn" id="rpToArchive">В архив</button>' +
          '<button type="button" class="btn ghost" id="rpToRework">На доработку</button>' +
          '</div></div>';
      }
      return '<div class="rp-review-to-bar"><h4>Решение ТО</h4>' +
        '<p class="muted" style="font-size:12px;margin:0 0 10px">Отчёт РП готов. Подтвердите или верните на доработку.</p>' +
        '<div class="rp-review-to-comment">' +
        '<label class="muted" style="font-size:12px;display:block;margin-bottom:4px">Комментарий для РП</label>' +
        '<textarea class="inp" id="rpToComment" rows="2" placeholder="Для «На доработку» и «Отклонить» — обязателен"></textarea>' +
        '</div>' +
        '<div class="rp-review-to-actions">' +
        '<button type="button" class="btn" id="rpToAccept">Принять → Готовим</button>' +
        '<button type="button" class="btn ghost" id="rpToRework">На доработку</button>' +
        '<button type="button" class="btn ghost" id="rpToReject" style="color:#f87171">Отклонить</button>' +
        '</div></div>';
    }

    function renderDirectorBar() {
      if (!isDirector || review?.director_review_status !== 'pending') return '';
      return '<div class="rp-review-to-bar" style="border-color:#c2410c">' +
        '<h4>Решение директора</h4>' +
        '<p class="muted" style="font-size:12px;margin:0 0 10px">Просчёт РП от 10 млн ₽ без НДС. Подтвердите подачу или отклоните тендер.</p>' +
        '<div class="rp-review-to-comment">' +
        '<label class="muted" style="font-size:12px;display:block;margin-bottom:4px">Комментарий (обязателен при отказе)</label>' +
        '<textarea class="inp" id="rpDirComment" rows="2" placeholder="Причина отказа…"></textarea>' +
        '</div>' +
        '<div class="rp-review-to-actions">' +
        '<button type="button" class="btn" id="rpDirSubmit">Подавать</button>' +
        '<button type="button" class="btn ghost" id="rpDirReject" style="color:#f87171">Не подавать</button>' +
        '</div></div>';
    }

    function bodyHtml() {
      const tabs = [
        { id: 'report', label: 'Отчёт' },
        { id: 'tender', label: 'Тендер' },
        { id: 'history', label: 'История' },
        { id: 'team', label: 'Команда' },
        { id: 'thread', label: 'Вопросы' }
      ];
      let h = '<div class="rp-review-modal">';
      h += badgesHtml();

      if (isDirector) {
        h += renderDirectorBriefing(tender, review, reportJson, workPrice, {
          estimate: estimateFile,
          report: reportFile,
          tkp: tkpFile
        });
        h += renderDirectorBar();
        h += '<div class="rp-dir-details-label">Подробности просчёта</div>';
      } else {
        h += '<p class="rp-review-lead">' + subtitleHtml() + '</p>';
        h += renderMeta(tender, review, mode);
        h += renderRoleBanner();
        h += '<div id="rpTenderDocs" class="rp-review-tender-docs"></div>';
      }

      h += '<div class="rp-review-tabs">';
      tabs.forEach((t) => {
        const badge = t.id === 'thread' && threadUnread > 0
          ? '<span class="rp-review-tab-badge">' + threadUnread + '</span>' : '';
        h += '<button type="button" class="rp-review-tab' + (tab === t.id ? ' active' : '') + '" data-rptab="' + t.id + '">' +
          t.label + badge + '</button>';
      });
      h += '</div>';
      if (tab === 'report') h += renderReportTab();
      else if (tab === 'tender') h += renderTenderTab();
      else if (tab === 'history') h += renderHistoryTab();
      else if (tab === 'thread') h += renderThreadTab();
      else h += renderTeamTab();
      if (!isDirector) h += renderToBar();
      if (!isDirector) h += renderDirectorBar();
      h += footerHtml();
      h += '</div>';
      return h;
    }

    function footerHtml() {
      if ((isTo || isViewer) && review?.is_final && review.decision !== 'reject' && isTo) {
        return '';
      }
      if (isLocked) {
        return '<div class="rp-review-footer"><button type="button" class="btn ghost" id="rpExit">Закрыть</button></div>';
      }
      if (editingParticipantDraft) {
        return '<div class="rp-review-footer">' +
          '<button type="button" class="btn ghost" id="rpExit">Выход</button>' +
          '<span class="spacer"></span>' +
          '<button type="button" class="btn ghost" id="rpDraft">Сохранить черновик</button>' +
          '<button type="button" class="btn primary" id="rpDraftReady">Отметить готовым</button></div>';
      }
      return '<div class="rp-review-footer">' +
        '<button type="button" class="btn ghost" id="rpExit">Выход</button>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn ghost" id="rpDraft">Сохранить черновик</button>' +
        (canFinalize
          ? ('<button type="button" class="btn primary" id="rpFinal">' +
            (mode === 'analysis' ? 'Закрыть анализ' : 'Закрыть отчёт') +
            '</button>')
          : '') +
        '</div>';
    }

    function syncFromDom() {
      if (isLocked) return;
      // Only sync fields that are currently mounted. Footer "Сохранить черновик"
      // is visible on every tab, but report inputs exist only on tab=report.
      // Reading missing nodes as '' used to wipe in-memory draft on save.
      document.querySelectorAll('[data-seg]').forEach((seg) => {
        const name = seg.dataset.seg;
        const on = seg.querySelector('button.on');
        if (on) reportJson[name] = on.dataset.val;
      });
      if (decision === 'submit') {
        const summaryEl = document.getElementById('rpSummary');
        if (summaryEl) reportJson.summary = summaryEl.value || '';
        const risksEl = document.getElementById('rpRisks');
        if (risksEl) reportJson.risks = risksEl.value || '';
        const recoEl = document.getElementById('rpRecommendation');
        if (recoEl) reportJson.recommendation = recoEl.value || '';
        if (mode === 'calc') {
          const scopeEl = document.getElementById('rpScope');
          if (scopeEl) reportJson.scope = scopeEl.value || '';
          const durEl = document.getElementById('rpDuration');
          if (durEl) reportJson.duration_days = durEl.value ? Number(durEl.value) : null;
          const resEl = document.getElementById('rpResources');
          if (resEl) reportJson.resources = resEl.value || '';
          const qInps = document.querySelectorAll('.rp-q-inp');
          if (qInps.length) {
            const qs = [];
            qInps.forEach((inp) => {
              const v = inp.value.trim();
              if (v) qs.push(v);
            });
            reportJson.questions_for_customer = qs;
          }
          const priceEl = document.getElementById('rpPrice');
          if (priceEl) workPrice = priceEl.value || '';
          const costEl = document.getElementById('rpCostNoVat');
          if (costEl) {
            reportJson.cost_without_vat = costEl.value ? Number(costEl.value) : null;
          }
        }
        if (mode === 'analysis') {
          const minEl = document.getElementById('rpPriceMin');
          if (minEl) reportJson.price_range_min = minEl.value ? minEl.value.trim() : null;
          const maxEl = document.getElementById('rpPriceMax');
          if (maxEl) reportJson.price_range_max = maxEl.value ? maxEl.value.trim() : null;
        }
      }
      if (decision === 'reject') {
        const pointInps = document.querySelectorAll('.rp-point');
        if (pointInps.length) {
          const points = [];
          pointInps.forEach((inp) => {
            const i = Number(inp.dataset.i);
            const reason = document.querySelector('.rp-reason[data-i="' + i + '"]')?.value || '';
            points.push({ point: inp.value, reason });
          });
          reportJson.points = points.length ? points : REJECT_TEMPLATE;
        }
      }
      const chips = document.querySelectorAll('.rp-review-chip');
      if (chips.length) {
        missingFlags = [];
        chips.forEach((c) => {
          if (c.classList.contains('on')) missingFlags.push(c.dataset.flag);
        });
      }
    }

    function collectPayload(finalize, overrideAsAdmin) {
      syncFromDom();
      reportJson.mode = mode;
      const body = {
        decision,
        report_kind: reportKind,
        report_json: reportJson,
        missing_info_flags: missingFlags,
        work_price: workPrice ? Number(workPrice) : null,
        finalize: !!finalize,
        expected_updated_at: review?.updated_at || null
      };
      if (overrideAsAdmin) body.override_as_admin = true;
      return body;
    }

    async function confirmAdminOverrideIfNeeded(finalize) {
      const uid = currentUserId();
      const ownerId = finalOwnerUserId ? Number(finalOwnerUserId) : null;
      if (!ownerId || !uid || ownerId === uid || isRealFinalOwner) return { ok: true, override: false };
      if (!isFinalOwner) return { ok: true, override: false };
      const who = finalOwnerName || ('#' + ownerId);
      const title = finalize ? 'Перезаписать чужой финал?' : 'Сохранить чужой финал?';
      const body = 'Вы не хозяин фазы (<b>' + esc(who) + '</b>). ' +
        (finalize
          ? 'Закрытие запишет финал от его имени.'
          : 'Сохранение перезапишет финальный отчёт хозяина.');
      let ok = true;
      if (window.AsgardConfirm && typeof AsgardConfirm.open === 'function') {
        ok = await AsgardConfirm.open({
          title,
          body,
          okText: finalize ? 'Закрыть чужой финал' : 'Перезаписать',
          cancelText: 'Отмена',
          danger: true
        });
      } else {
        ok = window.confirm(title + '\n\nХозяин: ' + who);
      }
      return { ok: !!ok, override: true };
    }

    function handleSaveConflict(e) {
      const msg = e && e.message ? String(e.message) : '';
      toast('Конфликт', msg || 'Отчёт изменился — обновите форму', 'err');
      if (/изменился|REVIEW_CONFLICT|конфликт/i.test(msg)) {
        API.loadRpReview(tender.id).then((d) => {
          if (d.review) review = d.review;
          if (d.logs) logs = d.logs;
          toast('Обновлено', 'Форма перезагружена с сервера — проверьте и сохраните снова', 'ok');
          rerender();
        }).catch(() => {});
      }
    }

    function mountTenderDocs() {
      const el = document.getElementById('rpTenderDocs') || document.getElementById('rpDirToDocs');
      if (!el || !tender?.id || !API.loadTenderDocs) return;
      API.loadTenderDocs(tender.id).then((docs) => {
        if (!docs.length) {
          if (el.id === 'rpTenderDocs') {
            el.innerHTML = '<div class="muted" style="font-size:12px;margin:8px 0">Документы ТО: пока нет</div>';
          } else {
            el.innerHTML = '';
          }
          return;
        }
        const head = el.id === 'rpDirToDocs'
          ? '<div style="font-weight:600;margin-bottom:6px">Документы ТО (ТЗ и прочее)</div>'
          : '<div class="muted" style="font-size:12px;margin:8px 0 4px">Документы ТО (ТЗ и прочее)</div>';
        el.innerHTML = head + docs.map((d) => {
          const href = API.docDownloadHref ? API.docDownloadHref(d) : (d.download_url || '');
          const label = esc(d.original_name || d.filename || 'файл');
          return '<div style="margin:4px 0;font-size:13px">📄 ' +
            (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : label) +
            '</div>';
        }).join('');
      }).catch(() => { el.innerHTML = ''; });
    }

    function bindModal() {
      document.getElementById('rpExit')?.addEventListener('click', hideModal);
      document.getElementById('rpDirDocsToggle')?.addEventListener('click', () => {
        const panel = document.getElementById('rpDirDocsPanel');
        if (!panel) return;
        const open = panel.hasAttribute('hidden');
        if (open) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
        const btn = document.getElementById('rpDirDocsToggle');
        if (btn) btn.textContent = open ? '📄 Скрыть документы' : ('📄 Документы' +
          ((estimateFile || reportFile || tkpFile)
            ? ' (' + [estimateFile, reportFile, tkpFile].filter(Boolean).length + ')'
            : ''));
        if (open) mountTenderDocs();
      });
      document.getElementById('rpDraft')?.addEventListener('click', () => {
        if (editingParticipantDraft) {
          syncFromDom();
          const dj = Object.assign({}, reportJson);
          if (workPrice !== '' && workPrice != null) dj.work_price = Number(workPrice);
          API.saveRpMyDraft(tender.id, {
            phase: mode === 'calc' ? 'calc' : 'analysis',
            draft_json: dj,
            status: 'working',
            expected_updated_at: myDraft?.updated_at
          }).then((d) => {
            myDraft = d.draft || myDraft;
            toast('Черновик', 'Сохранено', 'ok');
            onSaved && onSaved();
          }).catch((e) => toast('Ошибка', e.message || 'Не удалось сохранить', 'err'));
          return;
        }
        (async () => {
          const ov = await confirmAdminOverrideIfNeeded(false);
          if (!ov.ok) return;
          API.saveRpReview(tender.id, collectPayload(false, ov.override)).then((d) => {
            if (d && d.review) review = d.review;
            toast('Анализ', 'Сохранено', 'ok');
            onSaved && onSaved();
          }).catch((e) => handleSaveConflict(e));
        })();
      });
      document.getElementById('rpDraftReady')?.addEventListener('click', () => {
        syncFromDom();
        const dj = Object.assign({}, reportJson);
        if (workPrice !== '' && workPrice != null) dj.work_price = Number(workPrice);
        API.saveRpMyDraft(tender.id, {
          phase: mode === 'calc' ? 'calc' : 'analysis',
          draft_json: dj,
          status: 'ready',
          expected_updated_at: myDraft?.updated_at
        }).then((d) => {
          myDraft = d.draft || myDraft;
          toast('Готово', 'Ответственный РП получит уведомление', 'ok');
          onSaved && onSaved();
        }).catch((e) => toast('Ошибка', e.message || 'Не удалось', 'err'));
      });
      document.getElementById('rpOpenMimir')?.addEventListener('click', () => {
        if (!window.AsgardMimirQuick || typeof AsgardMimirQuick.openForRpReview !== 'function') {
          toast('Мимир', 'Модуль ещё не загружен — обновите страницу', 'err');
          return;
        }
        AsgardMimirQuick.openForRpReview({
          tenderId: tender.id,
          phase: mode === 'calc' ? 'calc' : 'analysis',
          tender,
          isFinalOwner: isFinalOwner && !editingParticipantDraft,
          onApplied: (result) => {
            if (result.field_patch) {
              Object.assign(reportJson, result.field_patch);
            }
            if (result.work_price != null && !editingParticipantDraft) {
              workPrice = result.work_price;
            } else if (result.field_patch && result.field_patch.work_price != null) {
              workPrice = result.field_patch.work_price;
            }
            if (editingParticipantDraft && result.draft) {
              myDraft = result.draft;
              if (result.draft.estimate_file) estimateFile = result.draft.estimate_file;
              else if (result.estimate_file) estimateFile = result.estimate_file;
              if (result.draft.report_file) reportFile = result.draft.report_file;
              else if (result.report_file) reportFile = result.report_file;
              if (result.draft.tkp_file) tkpFile = result.draft.tkp_file;
            } else {
              if (result.estimate_file) estimateFile = result.estimate_file;
              if (result.report_file) reportFile = result.report_file;
              if (result.draft) myDraft = result.draft;
            }
            if (result.review) {
              review = result.review;
              reportJson = parseRj(review.report_json, mode);
              workPrice = review.work_price ?? workPrice;
            }
            toast('Мимир', 'Применено к форме — можно править поля', 'ok');
            rerender();
            onSaved && onSaved();
          }
        });
      });
      document.getElementById('rpFinal')?.addEventListener('click', async () => {
        // Sync before checks — otherwise decision/fields may be stale vs DOM.
        syncFromDom();
        if (decision !== 'submit' && decision !== 'reject') {
          toast('Анализ', 'Выберите решение: Подаём или Не подаём', 'err');
          return;
        }
        if (mode === 'analysis' && decision === 'submit') {
          if (!String(reportJson.summary || '').trim()) {
            toast('Анализ', 'Для закрытия укажите «Суть для ТО»', 'err');
            return;
          }
          if (!reportJson.feasibility) {
            toast('Анализ', 'Укажите выполнимость (да / условно / нет)', 'err');
            return;
          }
        }
        if (mode === 'analysis' && decision === 'reject') {
          const points = reportJson.points || [];
          const hasReason = points.some((p) => String(p.point || '').trim() || String(p.reason || '').trim())
            || String(reportJson.reject_preset || '').trim();
          if (!hasReason) {
            toast('Анализ', 'Укажите причину «Не подаём» (категория или пункт)', 'err');
            return;
          }
        }
        if (mode === 'calc' && decision === 'submit' && !tkpFile) {
          toast('Просчёт', 'Приложите ТКП к отчёту просчёта', 'err');
          return;
        }
        const isAnalysis = mode === 'analysis';
        const confirmTitle = isAnalysis ? 'Закрыть анализ?' : 'Закрыть отчёт?';
        const confirmBody = isAnalysis
          ? 'После закрытия вы <b>больше не сможете править</b> анализ — его получит ТО.<br><br>Чтобы просто выйти со страницы — нажмите крестик (анализ при этом не закроется). Черновик сохраняйте кнопкой «Сохранить».'
          : 'После закрытия вы <b>больше не сможете править</b> отчёт.<br><br>Чтобы просто выйти — нажмите крестик (отчёт при этом не закроется).';
        const confirmOk = isAnalysis ? 'Закрыть анализ' : 'Закрыть отчёт';
        let ok = true;
        if (window.AsgardConfirm && typeof AsgardConfirm.open === 'function') {
          ok = await AsgardConfirm.open({
            title: confirmTitle,
            body: confirmBody,
            okText: confirmOk,
            cancelText: 'Отмена',
            danger: true
          });
        } else {
          ok = window.confirm(
            (isAnalysis
              ? 'Закрыть анализ? После закрытия вы больше не сможете его править. ТО получит анализ на проверку.\n\nЧтобы просто выйти — нажмите крестик, не эту кнопку.'
              : 'Закрыть отчёт? После закрытия вы больше не сможете его править.\n\nЧтобы просто выйти — нажмите крестик, не эту кнопку.')
          );
        }
        if (!ok) return;
        const ov = await confirmAdminOverrideIfNeeded(true);
        if (!ov.ok) return;
        API.saveRpReview(tender.id, collectPayload(true, ov.override)).then((d) => {
          if (d && d.review) review = d.review;
          toast('Анализ', mode === 'analysis' ? 'Анализ закрыт' : 'Отчёт закрыт', 'ok');
          onSaved && onSaved();
          hideModal();
        }).catch((e) => handleSaveConflict(e));
      });

      document.querySelectorAll('[data-rptab]').forEach((b) => {
        b.addEventListener('click', () => {
          syncFromDom();
          tab = b.dataset.rptab;
          if (tab === 'thread') {
            loadThreadMessages().then(() => rerender());
          } else {
            rerender();
          }
        });
      });
      document.querySelectorAll('[data-toggle-sec]').forEach((b) => {
        b.addEventListener('click', () => {
          const id = b.dataset.toggleSec;
          collapsed[id] = !collapsed[id];
          rerender();
        });
      });
      document.querySelectorAll('.rp-review-decision-card').forEach((card) => {
        card.addEventListener('click', () => {
          decision = card.dataset.dec;
          reportKind = decision === 'reject' ? 'reject' : 'work';
          if (decision === 'reject' && !(reportJson.points || []).length) {
            reportJson.points = [...REJECT_TEMPLATE];
          }
          rerender();
        });
      });
      document.querySelectorAll('[data-seg] button:not([disabled])').forEach((btn) => {
        btn.addEventListener('click', () => {
          const seg = btn.closest('[data-seg]');
          seg.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
          btn.classList.add('on');
        });
      });
      document.querySelectorAll('.rp-review-chip:not([disabled])').forEach((chip) => {
        chip.addEventListener('click', () => chip.classList.toggle('on'));
      });
      document.getElementById('rpAddRejectPoint')?.addEventListener('click', () => {
        syncFromDom();
        reportJson.points = [...(reportJson.points || REJECT_TEMPLATE), { point: '', reason: '' }];
        rerender();
      });
      document.getElementById('rpAddQuestion')?.addEventListener('click', () => {
        syncFromDom();
        reportJson.questions_for_customer = [...(reportJson.questions_for_customer || ['']), ''];
        rerender();
      });
      document.querySelectorAll('.rp-q-del').forEach((btn) => {
        btn.addEventListener('click', () => {
          syncFromDom();
          const i = Number(btn.dataset.i);
          reportJson.questions_for_customer = (reportJson.questions_for_customer || []).filter((_, idx) => idx !== i);
          rerender();
        });
      });
      document.getElementById('rpInviteBtn')?.addEventListener('click', () => {
        const pm = Number(document.getElementById('rpInvitePm')?.value);
        if (!pm) return;
        API.inviteRpCollaborator(tender.id, pm).then(() => {
          toast('Команда', 'РП привлечён к совместной работе', 'ok');
          return API.loadRpReview(tender.id);
        }).then((d) => {
          collabs = d.collaborators || [];
          teamDrafts = d.team_drafts || [];
          teamSummary = d.team_summary || null;
          rerender();
        }).catch((e) => toast('Ошибка', e.message || 'Сбой', 'err'));
      });
      document.querySelectorAll('.rp-revoke-collab').forEach((btn) => {
        btn.addEventListener('click', () => {
          const pmId = Number(btn.dataset.pm);
          if (!pmId || !window.confirm('Отозвать привлечение РП?')) return;
          API.revokeRpCollaborator(tender.id, pmId).then(() => {
            toast('Команда', 'Привлечение отозвано', 'ok');
            return API.loadRpReview(tender.id);
          }).then((d) => {
            collabs = d.collaborators || [];
            teamDrafts = d.team_drafts || [];
            rerender();
          }).catch((e) => toast('Ошибка', e.message || 'Сбой', 'err'));
        });
      });
      document.querySelectorAll('.rp-import-draft').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const draftId = Number(btn.dataset.draftId);
          const includeFiles = btn.dataset.files !== '0';
          const ok = window.confirm(
            includeFiles
              ? 'Заменить поля финала и вложения черновиком коллеги?'
              : 'Заменить только поля финала черновиком коллеги (файлы оставить)?'
          );
          if (!ok || !draftId) return;
          try {
            const d = await API.importRpDraft(tender.id, {
              draft_id: draftId,
              include_files: includeFiles
            });
            if (d.review) {
              review = d.review;
              reportJson = parseRj(review.report_json, mode);
              workPrice = review.work_price ?? workPrice;
            }
            const full = await API.loadRpReview(tender.id);
            estimateFile = full.estimate_file || estimateFile;
            reportFile = full.report_file || reportFile;
            tkpFile = full.tkp_file || tkpFile;
            toast('Импорт', 'Черновик взят в финал', 'ok');
            tab = 'report';
            rerender();
          } catch (e) {
            toast('Ошибка', e.message || 'Импорт не удался', 'err');
          }
        });
      });
      document.getElementById('rpEstimateFile')?.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const phase = mode === 'calc' ? 'calc' : 'analysis';
        const p = editingParticipantDraft
          ? API.uploadRpDraftFile(tender.id, 'estimate', file, phase)
          : API.uploadRpEstimate(tender.id, file);
        p.then((d) => {
          if (editingParticipantDraft && d.draft) {
            myDraft = d.draft;
            estimateFile = d.draft.estimate_file || d.file || null;
          } else {
            estimateFile = d.estimate_file || null;
          }
          toast('Файл', 'Смета прикреплена', 'ok');
          rerender();
        }).catch((err) => toast('Ошибка', err.message || 'Сбой', 'err'));
      });
      document.getElementById('rpReportFile')?.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const phase = mode === 'calc' ? 'calc' : 'analysis';
        const p = editingParticipantDraft
          ? API.uploadRpDraftFile(tender.id, 'report', file, phase)
          : API.uploadRpReport(tender.id, file);
        p.then((d) => {
          if (editingParticipantDraft && d.draft) {
            myDraft = d.draft;
            reportFile = d.draft.report_file || d.file || null;
          } else {
            reportFile = d.report_file || null;
          }
          toast('Файл', 'Отчёт прикреплён', 'ok');
          rerender();
        }).catch((err) => toast('Ошибка', err.message || 'Сбой', 'err'));
      });
      document.getElementById('rpTkpFile')?.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const phase = mode === 'calc' ? 'calc' : 'analysis';
        const p = editingParticipantDraft
          ? API.uploadRpDraftFile(tender.id, 'tkp', file, phase)
          : API.uploadRpTkp(tender.id, file);
        p.then((d) => {
          if (editingParticipantDraft && d.draft) {
            myDraft = d.draft;
            tkpFile = d.draft.tkp_file || d.file || null;
          } else {
            tkpFile = d.tkp_file || null;
          }
          toast('Файл', 'ТКП прикреплено', 'ok');
          rerender();
        }).catch((err) => toast('Ошибка', err.message || 'Сбой', 'err'));
      });

      document.getElementById('rpDirSubmit')?.addEventListener('click', () => {
        const comment = document.getElementById('rpDirComment')?.value?.trim() || '';
        API.directorDecisionRpReview(tender.id, { action: 'submit', comment: comment || undefined }).then(() => {
          toast('Директор', 'Одобрено — ТО может подавать', 'ok');
          onSaved && onSaved();
          hideModal();
        }).catch((e) => toast('Ошибка', e.message || 'Сбой', 'err'));
      });
      document.getElementById('rpDirReject')?.addEventListener('click', () => {
        const comment = document.getElementById('rpDirComment')?.value?.trim() || '';
        if (!comment) {
          toast('Директор', 'Укажите причину отказа', 'err');
          document.getElementById('rpDirComment')?.focus();
          return;
        }
        API.directorDecisionRpReview(tender.id, { action: 'reject', comment }).then(() => {
          toast('Решение', 'Тендер отклонён', 'ok');
          onSaved && onSaved();
          hideModal();
        }).catch((e) => toast('Ошибка', e.message || 'Сбой', 'err'));
      });

      document.getElementById('rpToAccept')?.addEventListener('click', () => {
        const comment = document.getElementById('rpToComment')?.value?.trim() || '';
        API.toDecisionRpReview(tender.id, { action: 'accept', comment: comment || undefined }).then(() => {
          toast('ТО', 'Принято — статус «Готовим»', 'ok');
          onSaved && onSaved();
          hideModal();
        }).catch((e) => toast('Ошибка', e.message || 'Сбой', 'err'));
      });
      document.getElementById('rpToRework')?.addEventListener('click', () => {
        const comment = document.getElementById('rpToComment')?.value?.trim() || '';
        if (!comment) {
          toast('ТО', 'Укажите комментарий — что доработать', 'err');
          document.getElementById('rpToComment')?.focus();
          return;
        }
        API.toDecisionRpReview(tender.id, { action: 'rework', comment }).then(() => {
          toast('ТО', 'Отправлено на доработку', 'ok');
          onSaved && onSaved();
          hideModal();
        }).catch((e) => toast('Ошибка', e.message || 'Сбой', 'err'));
      });
      document.getElementById('rpToReject')?.addEventListener('click', () => {
        const reason = document.getElementById('rpToComment')?.value?.trim() || '';
        if (!reason) {
          toast('ТО', 'Укажите причину отклонения', 'err');
          document.getElementById('rpToComment')?.focus();
          return;
        }
        API.toDecisionRpReview(tender.id, { action: 'reject', reject_reason: reason }).then(() => {
          toast('Решение', 'Тендер отклонён', 'ok');
          onSaved && onSaved();
          hideModal();
        }).catch((e) => toast('Ошибка', e.message || 'Сбой', 'err'));
      });
      document.getElementById('rpToArchive')?.addEventListener('click', () => {
        API.archiveRegistryRow(tender.id, 'РП: не подаём — подтверждено ТО').then(() => {
          toast('ТО', 'Тендер в архиве', 'ok');
          onSaved && onSaved();
          hideModal();
        }).catch((e) => toast('Ошибка', e.message || 'Сбой', 'err'));
      });

      document.getElementById('rpThreadAttach')?.addEventListener('click', () => {
        document.getElementById('rpThreadFiles')?.click();
      });
      document.getElementById('rpThreadFiles')?.addEventListener('change', (e) => {
        threadPendingFiles = Array.from(e.target.files || []);
        rerender();
      });
      document.querySelectorAll('.rp-thread-preview').forEach((btn) => {
        btn.addEventListener('click', () => {
          previewThreadFile(Number(btn.dataset.docId), btn.dataset.name || 'Файл');
        });
      });
      document.querySelectorAll('.rp-attach-preview').forEach((btn) => {
        btn.addEventListener('click', () => {
          previewThreadFile(Number(btn.dataset.docId), btn.dataset.name || 'Файл');
        });
      });
      document.querySelectorAll('.rp-thread-preview-local').forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = Number(btn.dataset.i);
          const f = threadPendingFiles[i];
          if (f) previewLocalThreadFile(f);
        });
      });
      document.querySelectorAll('.rp-thread-remove-local').forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = Number(btn.dataset.i);
          threadPendingFiles = threadPendingFiles.filter((_, idx) => idx !== i);
          const inp = document.getElementById('rpThreadFiles');
          if (inp) inp.value = '';
          rerender();
        });
      });
      document.getElementById('rpThreadText')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          document.getElementById('rpThreadSend')?.click();
        }
      });
      document.getElementById('rpThreadSend')?.addEventListener('click', () => {
        if (threadSending) return;
        const body = document.getElementById('rpThreadText')?.value?.trim() || '';
        if (!body && !threadPendingFiles.length) return;
        threadSending = true;
        API.postRpReviewMessage(tender.id, body, threadPendingFiles).then((res) => {
          if (res?.message) threadMessages = [...threadMessages, res.message];
          threadPendingFiles = [];
          threadSending = false;
          rerender();
          onSaved && onSaved();
        }).catch((e) => {
          threadSending = false;
          toast('Ошибка', e.message || 'Сбой', 'err');
        });
      });
      if (tab === 'thread') {
        const feed = document.getElementById('rpThreadFeed');
        if (feed) feed.scrollTop = feed.scrollHeight;
      }
      mountTenderDocs();
    }

    function rerender() {
      replaceModal({
        title: titleText(),
        subtitle: subtitleText(),
        icon: '📊',
        html: bodyHtml(),
        wide: true
      });
      bindModal();
    }

    showModal({
      title: titleText(),
      subtitle: subtitleText(),
      icon: '📊',
      html: '<p class="muted">Загрузка отчёта…</p>',
      wide: true,
      onMount: () => {
        API.loadRpReview(tender.id).then((d) => {
          if (d.tender) {
            Object.assign(tender, d.tender);
          }
          review = d.review;
          logs = d.logs || [];
          collabs = d.collaborators || [];
          estimateFile = d.estimate_file || null;
          reportFile = d.report_file || null;
          tkpFile = d.tkp_file || null;
          analysisSnapshot = getAnalysisSnapshot(review?.report_json, review, d.analysis_snapshot);
          decision = review?.decision && review.decision !== 'pending' ? review.decision : 'submit';
          if (analysisSnapshot?.decision && mode === 'calc') {
            decision = analysisSnapshot.decision === 'reject' ? 'reject' : 'submit';
          }
          reportKind = review?.report_kind || (decision === 'reject' ? 'reject' : 'work');
          mode = contextMode != null ? contextMode : (parseRj(review?.report_json, 'calc').mode || 'calc');
          reportJson = parseRj(review?.report_json, mode);
          workPrice = review?.work_price ?? '';
          missingFlags = Array.isArray(review?.missing_info_flags) ? [...review.missing_info_flags] : [];
          threadUnread = d.thread_unread || 0;
          if (review?.is_final) isLocked = true;
          isFinalOwner = d.is_final_owner !== false;
          isRealFinalOwner = d.is_real_final_owner != null
            ? !!d.is_real_final_owner
            : (!d.final_owner_user_id || Number(d.final_owner_user_id) === currentUserId());
          canFinalize = !!d.can_finalize && !isLocked;
          finalOwnerName = d.final_owner_name || '';
          finalOwnerUserId = d.final_owner_user_id != null ? Number(d.final_owner_user_id) : null;
          myDraft = d.my_draft || null;
          teamDrafts = d.team_drafts || [];
          teamSummary = d.team_summary || null;
          // Коллаб без права финала редактирует личный черновик
          editingParticipantDraft = !isLocked && !isTo && !isDirector && !isViewer && !isFinalOwner;
          if (editingParticipantDraft && myDraft && myDraft.draft_json) {
            reportJson = parseRj(myDraft.draft_json, mode);
            if (myDraft.estimate_file) estimateFile = myDraft.estimate_file;
            if (myDraft.report_file) reportFile = myDraft.report_file;
            if (myDraft.tkp_file) tkpFile = myDraft.tkp_file;
            if (myDraft.draft_json.work_price != null) workPrice = myDraft.draft_json.work_price;
          }
          // ТО после анализа видит только snapshot в режиме просмотра
          if (isTo && analysisSnapshot && review?.analysis_finalized_at && !review?.is_final) {
            // keep form from snapshot for read of analysis; calc not yet
          }
          const openTab = tab;
          if (openTab === 'thread') {
            loadThreadMessages().then(() => rerender());
          } else {
            rerender();
          }
        }).catch((e) => toast('Ошибка', e.message || 'Сбой', 'err'));
      }
    });
  }

  function renderReportSnippet(rev, estimateFile) {
    if (!rev) return '';
    const rj = parseRj(rev.report_json, 'calc');
    let h = '<div class="rp-review-summary-card' + (rev.decision === 'submit' ? ' submit' : (rev.decision === 'reject' ? ' reject' : '')) + '">';
    h += '<strong>' + (rev.decision === 'submit' ? '✓ Подаём' : (rev.decision === 'reject' ? '✕ Не подаём' : 'Черновик')) + '</strong>';
    if (rev.work_price) h += ' · ' + esc(fmtMoney(rev.work_price));
    h += '</div>';
    h += renderRo('Суть', rj.summary) + renderRo('Риски', rj.risks) + renderRo('Рекомендация', rj.recommendation);
    if (estimateFile) {
      h += '<a class="btn mini" href="' + esc(estimateFile.download_url) + '" target="_blank" rel="noreferrer">Скачать смету</a>';
    }
    return h;
  }

  return { open, renderReportSnippet, MISSING_FLAGS };
})();
