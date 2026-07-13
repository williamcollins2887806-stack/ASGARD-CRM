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
    attach_estimate: 'Прикреплена смета',
    attach_report: 'Прикреплён отчёт',
    invite_collaborator: 'Приглашён коллаборатор',
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
    if (v == null || v === '') return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
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
    if (min != null && max != null) return fmtMoney(min) + ' — ' + fmtMoney(max) + ' (без НДС)';
    if (min != null) return 'от ' + fmtMoney(min) + ' (без НДС)';
    if (max != null) return 'до ' + fmtMoney(max) + ' (без НДС)';
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
    if (rj.feasibility) done++;
    if (String(rj.summary || '').trim()) done++;
    if (String(rj.recommendation || '').trim() || String(rj.risks || '').trim()) done++;
    if (decision === 'reject' && (rj.points || []).some((p) => p.point || p.reason)) done++;
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
      h += '<span class="rp-review-badge" style="background:#14532d;color:#86efac">Одобрено директором</span>';
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

    function titleText() {
      return 'Отчёт РП · #' + tender.id;
    }

    function badgesHtml() {
      return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">' + renderHeaderBadges(review, mode, isLocked) + '</div>';
    }

    function subtitleHtml() {
      const c = tender.customer_name || '';
      const t = tender.tender_title || '';
      return esc(c) + (c && t ? ' · ' : '') + esc(t.length > 90 ? t.slice(0, 90) + '…' : t);
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
            ih += '<div class="rp-review-field-row"><div class="rp-review-field"><label>Ориентир цены от, ₽ (без НДС)</label>' +
              '<input class="inp" id="rpPriceMin" type="number" value="' + esc(reportJson.price_range_min ?? '') + '"/></div>' +
              '<div class="rp-review-field"><label>до, ₽ (без НДС)</label>' +
              '<input class="inp" id="rpPriceMax" type="number" value="' + esc(reportJson.price_range_max ?? '') + '"/></div></div>';
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
            if (estimateFile) {
              const kb = estimateFile.size ? Math.round(estimateFile.size / 1024) + ' КБ' : '';
              ih += '<div class="rp-review-estimate has-file"><strong>' + esc(estimateFile.original_name || 'Смета') + '</strong>' +
                (kb ? ' <span class="muted">' + kb + '</span>' : '') +
                ' <a class="btn mini" href="' + esc(estimateFile.download_url) + '" target="_blank" rel="noreferrer" style="margin-left:8px">Скачать</a></div>';
            } else if (!isLocked) {
              ih += '<div class="rp-review-estimate rp-review-estimate-drop">' +
                '<strong>Перетащите файл сметы сюда</strong>' +
                '<span class="muted" style="font-size:12px">или выберите .xlsx, .pdf, .csv</span>' +
                '<input type="file" class="inp" id="rpEstimateFile" accept=".xlsx,.xls,.pdf,.csv" style="margin-top:10px;width:100%"/></div>';
            } else if (isLocked && !estimateFile) {
              ih += '<p class="muted" style="margin:0">Смета не прикреплена</p>';
            }
            if (reportFile) {
              const kb = reportFile.size ? Math.round(reportFile.size / 1024) + ' КБ' : '';
              ih += '<div class="rp-review-estimate has-file" style="margin-top:10px"><strong>' + esc(reportFile.original_name || 'Отчёт') + '</strong>' +
                (kb ? ' <span class="muted">' + kb + '</span>' : '') +
                ' <a class="btn mini" href="' + esc(reportFile.download_url) + '" target="_blank" rel="noreferrer" style="margin-left:8px">Скачать отчёт</a></div>';
            } else if (!isLocked) {
              ih += '<div class="rp-review-estimate rp-review-estimate-drop" style="margin-top:10px">' +
                '<strong>Прикрепить файл отчёта</strong>' +
                '<span class="muted" style="font-size:12px">.docx, .pdf</span>' +
                '<input type="file" class="inp" id="rpReportFile" accept=".docx,.doc,.pdf" style="margin-top:10px;width:100%"/></div>';
            } else if (isLocked && !reportFile) {
              ih += '<p class="muted" style="margin:8px 0 0">Файл отчёта не прикреплён</p>';
            }
            ih += '<div class="rp-review-field" style="margin-top:12px"><label>ТКП' + (!isLocked ? ' <span class="req">*</span>' : '') + '</label>';
            if (tkpFile) {
              const kb = tkpFile.size ? Math.round(tkpFile.size / 1024) + ' КБ' : '';
              ih += '<div class="rp-review-estimate has-file"><strong>' + esc(tkpFile.original_name || 'ТКП') + '</strong>' +
                (kb ? ' <span class="muted">' + kb + '</span>' : '') +
                ' <a class="btn mini" href="' + esc(tkpFile.download_url) + '" target="_blank" rel="noreferrer" style="margin-left:8px">Скачать</a></div>';
            } else if (!isLocked) {
              ih += '<div class="rp-review-estimate rp-review-estimate-drop">' +
                '<strong>Прикрепить ТКП</strong>' +
                '<span class="muted" style="font-size:12px">.pdf, .docx, .xlsx</span>' +
                '<input type="file" class="inp" id="rpTkpFile" accept=".pdf,.docx,.doc,.xlsx,.xls" style="margin-top:10px;width:100%"/></div>';
            } else {
              ih += '<p class="muted" style="margin:0">ТКП не прикреплено</p>';
            }
            ih += '</div>';
            return ih;
          })());
        }

        h += section('missing', 'Не хватает данных', renderChips(MISSING_FLAGS, missingFlags, isLocked));
      }

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
      if (!logs.length) return '<p class="muted">Пока нет действий</p>';
      let h = '<ul class="rp-review-timeline">';
      logs.forEach((l) => {
        const label = LOG_LABELS[l.action] || l.action;
        let extra = '';
        if (l.payload_json) {
          try {
            const p = typeof l.payload_json === 'string' ? JSON.parse(l.payload_json) : l.payload_json;
            if (p.comment) extra = ' — ' + p.comment;
          } catch (_) { /* ignore */ }
        }
        h += '<li><div class="tl-time">' + new Date(l.created_at).toLocaleString('ru-RU') +
          ' · ' + esc(l.actor_name || '—') + '</div><div class="tl-action">' + esc(label) + esc(extra) + '</div></li>';
      });
      return h + '</ul>';
    }

    function renderTeamTab() {
      let h = '';
      if (collabs.length) {
        h += '<ul style="padding-left:18px;margin:0 0 12px">' +
          collabs.map((c) => '<li>' + esc(c.pm_name) + '</li>').join('') + '</ul>';
      } else {
        h += '<p class="muted" style="margin:0 0 12px">Нет приглашённых РП</p>';
      }
      if (!isLocked) {
        h += '<div class="rp-review-field"><label>Привлечь РП</label><div style="display:flex;gap:8px">' +
          '<select class="inp" id="rpInvitePm" style="flex:1"><option value="">— выберите —</option>' +
          pms.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') +
          '</select><button type="button" class="btn mini" id="rpInviteBtn">Пригласить</button></div></div>';
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
              h += '<button type="button" class="btn mini rp-thread-preview" data-doc-id="' + f.id + '" data-name="' + esc(fname) + '">Просмотр</button>';
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
      } catch (e) { toast(e.message, 'err'); }
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
      }).catch((e) => toast(e.message, 'err'));
    }

    function renderToBar() {
      if (review?.director_review_status === 'pending') return '';
      if (isViewer || !isTo || !review?.is_final || review.decision === 'reject') return '';
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
        '<p class="muted" style="font-size:12px;margin:0 0 10px">Просчёт РП свыше 5 млн ₽ без НДС. Подтвердите подачу или отклоните тендер.</p>' +
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
      h += '<p class="rp-review-lead">' + subtitleHtml() + '</p>';
      h += renderMeta(tender, review, mode);
      h += '<div id="rpTenderDocs" class="rp-review-tender-docs"></div>';
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
      h += renderToBar();
      h += renderDirectorBar();
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
      return '<div class="rp-review-footer">' +
        '<button type="button" class="btn ghost" id="rpExit">Выход</button>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn ghost" id="rpDraft">Сохранить черновик</button>' +
        '<button type="button" class="btn" id="rpFinal">' +
        (mode === 'analysis' ? 'Закрыть анализ' : 'Закрыть отчёт') +
        '</button></div>';
    }

    function syncFromDom() {
      if (isLocked) return;
      document.querySelectorAll('[data-seg]').forEach((seg) => {
        const name = seg.dataset.seg;
        const on = seg.querySelector('button.on');
        if (on) reportJson[name] = on.dataset.val;
      });
      if (decision === 'submit') {
        reportJson.summary = document.getElementById('rpSummary')?.value || '';
        reportJson.risks = document.getElementById('rpRisks')?.value || '';
        reportJson.recommendation = document.getElementById('rpRecommendation')?.value || '';
        if (mode === 'calc') {
          reportJson.scope = document.getElementById('rpScope')?.value || '';
          reportJson.duration_days = document.getElementById('rpDuration')?.value ? Number(document.getElementById('rpDuration').value) : null;
          reportJson.resources = document.getElementById('rpResources')?.value || '';
          const qs = [];
          document.querySelectorAll('.rp-q-inp').forEach((inp) => {
            const v = inp.value.trim();
            if (v) qs.push(v);
          });
          reportJson.questions_for_customer = qs;
          workPrice = document.getElementById('rpPrice')?.value || '';
          reportJson.cost_without_vat = document.getElementById('rpCostNoVat')?.value
            ? Number(document.getElementById('rpCostNoVat').value) : null;
        }
        if (mode === 'analysis') {
          reportJson.price_range_min = document.getElementById('rpPriceMin')?.value ? Number(document.getElementById('rpPriceMin').value) : null;
          reportJson.price_range_max = document.getElementById('rpPriceMax')?.value ? Number(document.getElementById('rpPriceMax').value) : null;
        }
      }
      if (decision === 'reject') {
        const points = [];
        document.querySelectorAll('.rp-point').forEach((inp) => {
          const i = Number(inp.dataset.i);
          const reason = document.querySelector('.rp-reason[data-i="' + i + '"]')?.value || '';
          points.push({ point: inp.value, reason });
        });
        reportJson.points = points.length ? points : REJECT_TEMPLATE;
      }
      missingFlags = [];
      document.querySelectorAll('.rp-review-chip.on').forEach((c) => missingFlags.push(c.dataset.flag));
    }

    function collectPayload(finalize) {
      syncFromDom();
      reportJson.mode = mode;
      return {
        decision,
        report_kind: reportKind,
        report_json: reportJson,
        missing_info_flags: missingFlags,
        work_price: workPrice ? Number(workPrice) : null,
        finalize: !!finalize
      };
    }

    function mountTenderDocs() {
      const el = document.getElementById('rpTenderDocs');
      if (!el || !tender?.id || !API.loadTenderDocs) return;
      API.loadTenderDocs(tender.id).then((docs) => {
        if (!docs.length) {
          el.innerHTML = '<div class="muted" style="font-size:12px;margin:8px 0">Документы ТО: пока нет</div>';
          return;
        }
        el.innerHTML = '<div class="muted" style="font-size:12px;margin:8px 0 4px">Документы ТО (ТЗ и прочее)</div>' +
          docs.map((d) => {
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
      document.getElementById('rpDraft')?.addEventListener('click', () => {
        API.saveRpReview(tender.id, collectPayload(false)).then(() => {
          toast('Сохранено', 'ok');
          onSaved && onSaved();
        }).catch((e) => toast(e.message, 'err'));
      });
      document.getElementById('rpFinal')?.addEventListener('click', () => {
        if (decision !== 'submit' && decision !== 'reject') {
          toast('Выберите решение: Подаём или Не подаём', 'err');
          return;
        }
        if (mode === 'calc' && decision === 'submit' && !tkpFile) {
          toast('Приложите ТКП к отчёту просчёта', 'err');
          return;
        }
        API.saveRpReview(tender.id, collectPayload(true)).then(() => {
          toast(mode === 'analysis' ? 'Анализ закрыт' : 'Отчёт закрыт', 'ok');
          onSaved && onSaved();
          hideModal();
        }).catch((e) => toast(e.message, 'err'));
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
          toast('РП приглашён', 'ok');
          return API.loadRpReview(tender.id);
        }).then((d) => { collabs = d.collaborators || []; rerender(); })
          .catch((e) => toast(e.message, 'err'));
      });
      document.getElementById('rpEstimateFile')?.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        API.uploadRpEstimate(tender.id, file).then((d) => {
          estimateFile = d.estimate_file || null;
          toast('Смета прикреплена', 'ok');
          rerender();
        }).catch((err) => toast(err.message, 'err'));
      });
      document.getElementById('rpReportFile')?.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        API.uploadRpReport(tender.id, file).then((d) => {
          reportFile = d.report_file || null;
          toast('Отчёт прикреплён', 'ok');
          rerender();
        }).catch((err) => toast(err.message, 'err'));
      });
      document.getElementById('rpTkpFile')?.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        API.uploadRpTkp(tender.id, file).then((d) => {
          tkpFile = d.tkp_file || null;
          toast('ТКП прикреплено', 'ok');
          rerender();
        }).catch((err) => toast(err.message, 'err'));
      });

      document.getElementById('rpDirSubmit')?.addEventListener('click', () => {
        const comment = document.getElementById('rpDirComment')?.value?.trim() || '';
        API.directorDecisionRpReview(tender.id, { action: 'submit', comment: comment || undefined }).then(() => {
          toast('Одобрено — ТО может подавать', 'ok');
          onSaved && onSaved();
          hideModal();
        }).catch((e) => toast(e.message, 'err'));
      });
      document.getElementById('rpDirReject')?.addEventListener('click', () => {
        const comment = document.getElementById('rpDirComment')?.value?.trim() || '';
        if (!comment) {
          toast('Укажите причину отказа', 'err');
          document.getElementById('rpDirComment')?.focus();
          return;
        }
        API.directorDecisionRpReview(tender.id, { action: 'reject', comment }).then(() => {
          toast('Тендер отклонён', 'ok');
          onSaved && onSaved();
          hideModal();
        }).catch((e) => toast(e.message, 'err'));
      });

      document.getElementById('rpToAccept')?.addEventListener('click', () => {
        const comment = document.getElementById('rpToComment')?.value?.trim() || '';
        API.toDecisionRpReview(tender.id, { action: 'accept', comment: comment || undefined }).then(() => {
          toast('Принято — статус «Готовим»', 'ok');
          onSaved && onSaved();
          hideModal();
        }).catch((e) => toast(e.message, 'err'));
      });
      document.getElementById('rpToRework')?.addEventListener('click', () => {
        const comment = document.getElementById('rpToComment')?.value?.trim() || '';
        if (!comment) {
          toast('Укажите комментарий — что доработать', 'err');
          document.getElementById('rpToComment')?.focus();
          return;
        }
        API.toDecisionRpReview(tender.id, { action: 'rework', comment }).then(() => {
          toast('Отправлено на доработку', 'ok');
          onSaved && onSaved();
          hideModal();
        }).catch((e) => toast(e.message, 'err'));
      });
      document.getElementById('rpToReject')?.addEventListener('click', () => {
        const reason = document.getElementById('rpToComment')?.value?.trim() || '';
        if (!reason) {
          toast('Укажите причину отклонения', 'err');
          document.getElementById('rpToComment')?.focus();
          return;
        }
        API.toDecisionRpReview(tender.id, { action: 'reject', reject_reason: reason }).then(() => {
          toast('Тендер отклонён', 'ok');
          onSaved && onSaved();
          hideModal();
        }).catch((e) => toast(e.message, 'err'));
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
          toast(e.message, 'err');
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
        subtitle: subtitleHtml(),
        icon: '📊',
        html: bodyHtml(),
        wide: true
      });
      bindModal();
    }

    showModal({
      title: titleText(),
      subtitle: subtitleHtml(),
      icon: '📊',
      html: '<p class="muted">Загрузка отчёта…</p>',
      wide: true,
      onMount: () => {
        API.loadRpReview(tender.id).then((d) => {
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
          const openTab = tab;
          if (openTab === 'thread') {
            loadThreadMessages().then(() => rerender());
          } else {
            rerender();
          }
        }).catch((e) => toast(e.message, 'err'));
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
