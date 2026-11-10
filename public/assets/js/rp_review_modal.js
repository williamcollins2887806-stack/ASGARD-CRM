/**
 * RP Review modal — structured report (analysis / calc) + TO decision panel
 */
window.AsgardRpReviewModal = (function () {
  if (!window.AsgardUI) {
    console.warn('[AsgardRpReviewModal] AsgardUI missing — stub');
    return { open: async function () { return null; } };
  }
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
      volume_summary: '', history_block: '',
      decision_recommend: '',
      norm_hint: null,
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
    // Дефолт 'analysis': незакрытый анализ не должен открываться как просчёт.
    const resolvedMode = mode != null ? mode : (r.mode || 'analysis');
    return Object.assign(defaultRj(resolvedMode), r, { mode: resolvedMode });
  }

  function getAnalysisSnapshot(reportJson, review, apiSnapshot) {
    if (apiSnapshot && typeof apiSnapshot === 'object') return apiSnapshot;
    const rj = parseRj(reportJson, 'analysis');
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
    h += '<div class="rp-review-summary-card rp-review-ref-decision ' + cls + '"><strong>' + esc(label) + '</strong>';
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

  function analysisDecisionBadge(dec) {
    const d = String(dec || '').toLowerCase();
    if (d === 'go') return { cls: 'submit', label: 'Рекомендация: подаём' };
    if (d === 'no_go') return { cls: 'reject', label: 'Рекомендация: не подаём' };
    if (d === 'need_info') return { cls: 'need-info', label: 'Нужны данные' };
    return { cls: '', label: '' };
  }

  /** Карточка отчёта Мимира в фазе анализа (без сметы и сумм). */
  function renderAnalysisReportCard(rj) {
    rj = rj || {};
    const badge = analysisDecisionBadge(rj.decision_recommend);
    let h = '<div class="rp-review-analysis-report rp-review-analysis-ref">';
    h += '<div class="rp-review-analysis-ref-head"><strong>Отчёт Мимира</strong>' +
      '<span class="muted">решение · объём и риски · без сметы</span></div>';
    if (badge.label) {
      h += '<div class="rp-review-mimir-decision rp-review-summary-card ' + badge.cls + '"><strong>' +
        esc(badge.label) + '</strong></div>';
    }
    h += '<div class="rp-review-report-body">';
    h += renderRo('Суть для ТО', rj.summary);
    h += renderRo('Объём', rj.volume_summary);
    h += renderRo('Выполнимость', feasibilityLabel(rj.feasibility));
    h += renderRo('Конкуренция', competitionLabel(rj.competition));
    h += renderRo('Риски', rj.risks);
    if (rj.norm_hint && rj.norm_hint.days != null) {
      h += renderRo('Ориентир по срокам (нормы)', rj.norm_hint.days + ' дн.');
    }
    h += renderRo('История заказчика', rj.history_block);
    if (Array.isArray(rj.questions_for_customer) && rj.questions_for_customer.length) {
      h += '<div class="rp-review-ro"><div class="lbl">Вопросы заказчику</div>' +
        '<ul class="rp-review-q-list">';
      rj.questions_for_customer.forEach((q) => { h += '<li>' + esc(q) + '</li>'; });
      h += '</ul></div>';
    }
    h += '</div></div>';
    return h;
  }

  /**
   * ДВ в карточке анализа: позиции карточками, а не сжатой таблицей.
   *
   * Сжатая таблица на 8 колонок в модалке 900 px нечитаема: позиция
   * переносится по слову, технология — в 4 строки. Здесь каждая позиция —
   * блок: слева номер и название с объёмом, справа метод, отложения, статус,
   * ниже технология и источник. На экране 1–2 позиции целиком, без скролла
   * по горизонтали.
   */
  /**
   * Ведомость объёмов с ПОЛНЫМ ручным редактированием.
   *
   * ── Почему редактируемая ─────────────────────────────────────────────────
   * Модель может ошибиться: не понять объём, взять не ту единицу, пропустить
   * строку или придумать лишнюю. Если ДВ только для чтения, РП не закроет
   * анализ — он заперт чужим разбором.
   *
   * Поэтому каждая позиция правится целиком: название, объём, единица,
   * метод. Строки можно удалять и добавлять вручную. Пустая ДВ — не тупик:
   * её можно заполнить с нуля.
   *
   * @param {object} rj — report_json
   * @param {boolean} isLocked — карточка закрыта (только просмотр)
   */
  /**
   * График заездов — «Гант» по месяцам. БЕЗ ДЕНЕГ: только режим, даты,
   * позиции, дни работ, люди и человеко-часы. Деньги считает просчёт.
   *
   * Режим определяет анализ (модель по документам + детерминированная
   * страховка). Если не определён — показываем баннер и вопрос РП, а не
   * выдумываем график.
   */
  function renderVisitSchedule(rj) {
    const vp = rj && rj.visit_plan;
    if (!vp) return '';
    const visits = Array.isArray(vp.visits) ? vp.visits : [];
    const mode = String(vp.mode || 'unknown');
    const totals = vp.totals || {};
    const conflicts = Array.isArray(vp.conflicts) ? vp.conflicts : [];

    const MODE_LABEL = {
      continuous: 'Один непрерывный заезд',
      visits: `${vp.trip_count || visits.length} заезд(ов)`,
      unknown: 'Режим не определён'
    };
    const modeText = MODE_LABEL[mode] || 'Режим не определён';

    // Таймлайн: один месяц — одна колонка. Полоса заезда накрывает месяцы
    // его периода; без дат — полоса занимает весь ряд с пометкой «без срока».
    const months = [];
    const monthKeys = new Set();
    const addMonth = (key) => {
      if (!key || !/^\d{4}-\d{2}$/.test(key)) return;
      if (monthKeys.has(key)) return;
      monthKeys.add(key);
      months.push(key);
    };
    visits.forEach((v) => {
      const s = String(v.period_start || '').slice(0, 7);
      const e = String(v.period_end || '').slice(0, 7);
      if (s && e && s !== e) {
        // Заполняем месяцы между началом и концом.
        const [sy, sm] = s.split('-').map(Number);
        const [ey, em] = e.split('-').map(Number);
        let y = sy; let m = sm; let guard = 0;
        while ((y < ey || (y === ey && m <= em)) && guard < 36) {
          addMonth(`${y}-${String(m).padStart(2, '0')}`);
          m += 1; if (m > 12) { m = 1; y += 1; }
          guard += 1;
        }
      } else if (s) {
        addMonth(s);
      } else if (e) {
        addMonth(e);
      }
    });
    months.sort();
    const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн',
      'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    const monthLabel = (key) => {
      const [y, m] = key.split('-').map(Number);
      return `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`;
    };

    let h = '<section class="rp-visit-plan" data-rp-visit-root="1">' +
      '<div class="rp-visit-plan__head">' +
        '<div><strong>График заездов</strong>' +
          '<span class="rp-visit-plan__sub">кто и когда едет на объект — без денег</span></div>' +
        '<div class="rp-visit-plan__metrics">' +
          '<span class="rp-visit-plan__mode rp-visit-plan__mode--' + esc(mode) + '">' +
            esc(modeText) + '</span>' +
          (totals.work_days ? '<span><b>' + esc(String(totals.work_days)) + '</b> дн. работ</span>' : '') +
          (totals.person_hours
            ? '<span><b>' + esc(String(totals.person_hours)) + '</b> чел·ч</span>' : '') +
        '</div>' +
      '</div>';

    // Баннер неопределённости — вопрос РП, а не догадка.
    if (vp.unconfirmed) {
      h += '<div class="rp-visit-plan__warn">' +
        '<b>Режим заездов не подтверждён.</b> В документах нет графика: ' +
        'непонятно, один это непрерывный заезд или несколько выездов. ' +
        'От этого зависят дорога, проживание и мобилизация в просчёте.' +
        '<div class="rp-visit-plan__warn-actions">' +
          '<button type="button" class="rp-visit-plan__btn" data-rp-visit-mode="continuous">Один непрерывный заезд</button>' +
          '<button type="button" class="rp-visit-plan__btn" data-rp-visit-mode="visits">Несколько выездов</button>' +
        '</div>' +
      '</div>';
    }

    // Конфликты источников (ТЗ vs ВОР, модель vs документы).
    if (conflicts.length) {
      h += '<ul class="rp-visit-plan__conflicts">' +
        conflicts.map((c) => '<li>' + esc(c.message || '') + '</li>').join('') +
      '</ul>';
    }

    if (!visits.length) {
      h += '<div class="rp-visit-plan__empty">Заездов нет: позиции без сроков.</div></section>';
      return h;
    }

    // Шапка таймлайна по месяцам.
    h += '<div class="rp-visit-grid">' +
      '<div class="rp-visit-grid__label">Заезд</div>';
    if (months.length) {
      h += '<div class="rp-visit-grid__months">' +
        months.map((m) => '<span>' + esc(monthLabel(m)) + '</span>').join('') +
      '</div>';
    }
    h += '</div>';

    visits.forEach((v, i) => {
      const s = String(v.period_start || '').slice(0, 7);
      const e = String(v.period_end || '').slice(0, 7);
      const spanMonths = months.length ? Math.max(1, monthSpan(s, e, months)) : 0;
      const startIdx = months.length ? Math.max(0, months.indexOf(s)) : 0;

      h += '<div class="rp-visit-row" data-rp-visit-idx="' + i + '">' +
        '<div class="rp-visit-row__label">' +
          '<span class="rp-visit-row__num">' + (i + 1) + '</span>' +
          '<span class="rp-visit-row__name">' + esc(v.label || 'заезд') + '</span>' +
          '<span class="rp-visit-row__dates">' +
            esc([v.period_start, v.period_end].filter(Boolean).join(' — ') || 'даты не указаны') +
          '</span>' +
        '</div>';

      if (months.length) {
        h += '<div class="rp-visit-row__track">' +
          '<div class="rp-visit-bar" style="grid-column:' + (startIdx + 1) +
            ' / span ' + spanMonths + '">' +
            '<span>' + esc(String(v.positions || 0)) + ' поз.</span>' +
          '</div>' +
          '<div class="rp-visit-row__cells">' +
            months.map(() => '<i></i>').join('') +
          '</div>' +
        '</div>';
      }

      h += '<div class="rp-visit-row__stats">' +
        '<span><b>' + esc(String(v.positions != null ? v.positions : '—')) + '</b> позиц.</span>' +
        '<span><b>' + esc(v.work_days != null ? String(v.work_days) : '—') + '</b> дн.</span>' +
        '<span><b>' + esc(v.people_peak != null ? String(v.people_peak) : '—') + '</b> чел.</span>' +
        '<span><b>' + esc(v.person_hours != null ? String(v.person_hours) : '—') + '</b> чел·ч</span>' +
        (v.incomplete_positions
          ? '<span class="rp-visit-row__gap">' + esc(String(v.incomplete_positions)) + ' без нормы</span>'
          : '') +
      '</div></div>';
    });

    h += '</section>';
    return h;
  }

  /** Сколько месяцев накрывает период заезда в сетке months. */
  function monthSpan(startKey, endKey, months) {
    if (!months.length) return 1;
    const i = months.indexOf(startKey);
    const j = months.indexOf(endKey);
    if (i < 0 && j < 0) return 1;
    const from = i < 0 ? 0 : i;
    const to = j < 0 ? from : j;
    return Math.max(1, to - from + 1);
  }

  function renderDvBlock(rj, isLocked) {
    const positions = Array.isArray(rj && rj.dv_positions) ? rj.dv_positions : [];
    const locked = !!isLocked;
    if (!positions.length && locked) return '';

    const foulingMap = { light: 'лёгкие', medium: 'средние', heavy: 'тяжёлые' };
    const foulingCls = { light: 'is-light', medium: 'is-medium', heavy: 'is-heavy' };
    const agreed = positions.filter((p) => p.approved).length;
    const blocked = positions.filter((p) => p.needs_classification).length;

    // Единицы — только те, что понимает справочник норм. «п.м трубок» и
    // подобные склейки не годятся: норма их не примет.
    const UNITS = ['м3', 'м2', 'п.м', 'т', 'шт', 'кг', 'компл', 'Гкал', 'апп.', 'м'];

    let h = '<div class="rp-review-dv-block" data-rp-dv-root="1">' +
      '<div class="rp-review-dv-head">' +
        '<div><strong>Ведомость объёмов</strong>' +
        '<span class="rp-review-dv-sub">' +
          (locked
            ? 'что разобрал Мимир по документам'
            : 'можно править: изменить, удалить или добавить строку') +
        '</span></div>' +
        '<div class="rp-review-dv-metrics">' +
          '<span><b data-rp-dv-count>' + positions.length + '</b> позиц.</span>' +
          '<span' + (agreed ? '' : ' class="is-dim"') + '><b>' + agreed + '</b> согласовано</span>' +
          (blocked ? '<span class="is-warn"><b>' + blocked + '</b> без метода</span>' : '') +
        '</div>' +
      '</div>';

    // Пустая ДВ: не тупик, а приглашение заполнить руками.
    if (!positions.length) {
      h += '<div class="rp-dv-empty-manual">' +
        'Мимир не нашёл позиций в документах. Заполните ведомость вручную — ' +
        'анализ можно закрыть и без автоматического разбора.' +
        '</div>';
    }

    h += '<div class="rp-review-dv-list">';

    positions.forEach((p, idx) => {
      const objects = Array.isArray(p.objects)
        ? p.objects.map((o) => o.tag || o.type).filter(Boolean) : [];
      const method = [p.category_name, p.method_name].filter(Boolean).join(' · ')
        || [p.category_code, p.method_code].filter(Boolean).join('.');
      const src = p.source_ref
        ? [p.source_ref.document, p.source_ref.fragment].filter(Boolean).join(' · ')
        : '';
      const st = p.needs_classification
        ? '<span class="rp-dv-st rp-dv-st--bad">нужен метод</span>'
        : (p.approved
          ? '<span class="rp-dv-st rp-dv-st--ok">согласовано</span>'
          : '<span class="rp-dv-st">проверено</span>');

      // ── Режим просмотра ──────────────────────────────────────────────────
      if (locked) {
        h += '<article class="rp-dv-card' + (p.approved ? ' is-approved' : '') + '">' +
          '<div class="rp-dv-card__top">' +
            '<span class="rp-dv-card__num">' + (idx + 1) + '</span>' +
            '<div class="rp-dv-card__title">' +
              '<h4>' + esc(p.name || '—') + '</h4>' +
              '<div class="rp-dv-card__meta">' +
                '<span class="rp-dv-vol">' +
                  (p.volume != null ? esc(String(p.volume)) : '—') +
                  ' <i>' + esc(p.unit || '') + '</i></span>' +
                (objects.length ? '<span class="rp-dv-tags">' +
                  objects.slice(0, 4).map((t) => '<b>' + esc(t) + '</b>').join('') +
                  (objects.length > 4 ? '<b>+' + (objects.length - 4) + '</b>' : '') +
                '</span>' : '') +
              '</div>' +
            '</div>' +
            '<div class="rp-dv-card__side">' + st + '</div>' +
          '</div>' +
          '<dl class="rp-dv-card__grid">' +
            '<div><dt>Метод</dt><dd>' + esc(method || '—') + '</dd></div>' +
            '<div><dt>Отложения</dt><dd><span class="rp-dv-foul ' +
              (foulingCls[p.fouling] || '') + '">' +
              esc(foulingMap[p.fouling] || 'не указаны') + '</span></dd></div>' +
            '<div><dt>Когда</dt><dd>' +
              esc(p.period || p.period_start || 'срок не указан') + '</dd></div>' +
          '</dl>' +
          (p.tech_equip
            ? '<div class="rp-dv-card__tech"><span>Чем работаем</span><p>' +
              esc(p.tech_equip) + '</p></div>'
            : '<div class="rp-dv-card__tech is-empty"><span>Чем работаем</span><p>не указано</p></div>') +
          (src ? '<div class="rp-dv-card__src" title="' + esc(src) + '">' +
            '<span>Источник</span> ' + esc(src) + '</div>' : '') +
          '</article>';
        return;
      }

      // ── Режим редактирования ────────────────────────────────────────────
      // Строка таблицы, а не карточка: ведомость читают построчно, и правка
      // должна ощущаться как работа в таблице, а не как заполнение анкеты.
      const unitOpts = UNITS.map((u) =>
        '<option value="' + esc(u) + '"' + (u === p.unit ? ' selected' : '') + '>' +
        esc(u) + '</option>').join('');
      // Если единица модели не входит в список — показываем её как есть,
      // чтобы правка не стёрла данные молча.
      const extraUnit = p.unit && UNITS.indexOf(p.unit) === -1
        ? '<option value="' + esc(p.unit) + '" selected>' + esc(p.unit) + '</option>' : '';
      const rowCls = p.needs_classification ? ' is-warn' : (p.approved ? ' is-ok' : '');

      h += '<div class="rp-dv-row' + rowCls + '" data-rp-dv-idx="' + idx + '">' +
        '<div class="rp-dv-row__num">' + (idx + 1) + '</div>' +
        '<div class="rp-dv-row__name">' +
          '<input class="rp-dv-field rp-dv-field--name" data-rp-dv-field="name" ' +
            'value="' + esc(p.name || '') + '" placeholder="Что делаем" ' +
            'aria-label="Наименование работ"/>' +
          '<input class="rp-dv-field rp-dv-field--method" data-rp-dv-field="method_name" ' +
            'value="' + esc(p.method_name || p.category_name || '') + '" ' +
            'placeholder="метод: чистка, гидродинамика…" aria-label="Метод"/>' +
        '</div>' +
        '<div class="rp-dv-row__qty">' +
          '<input class="rp-dv-field rp-dv-field--vol" type="number" step="any" min="0" ' +
            'data-rp-dv-field="volume" ' +
            'value="' + (p.volume != null ? esc(String(p.volume)) : '') + '" ' +
            'placeholder="0" aria-label="Объём"/>' +
          '<select class="rp-dv-field rp-dv-field--unit" data-rp-dv-field="unit" aria-label="Единица">' +
            '<option value="">—</option>' + extraUnit + unitOpts + '</select>' +
        '</div>' +
        '<div class="rp-dv-row__foul">' +
          '<select class="rp-dv-field rp-dv-field--foul" data-rp-dv-field="fouling" aria-label="Отложения">' +
            '<option value="">—</option>' +
            '<option value="light"' + (p.fouling === 'light' ? ' selected' : '') + '>лёгкие</option>' +
            '<option value="medium"' + (p.fouling === 'medium' ? ' selected' : '') + '>средние</option>' +
            '<option value="heavy"' + (p.fouling === 'heavy' ? ' selected' : '') + '>тяжёлые</option>' +
          '</select>' +
        '</div>' +
        '<div class="rp-dv-row__period">' +
          '<input class="rp-dv-field rp-dv-field--period" data-rp-dv-field="period" ' +
            'value="' + esc(p.period || '') + '" placeholder="когда: сентябрь, IV кв…" ' +
            'title="Период работ. Одна и та же работа в разные месяцы — разные строки и разные заезды" ' +
            'aria-label="Период работ"/>' +
        '</div>' +
        '<button type="button" class="rp-dv-row__del" data-rp-dv-act="del" ' +
          'data-rp-dv-idx="' + idx + '" title="Удалить строку" aria-label="Удалить строку">' +
          '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">' +
            '<path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.6" ' +
            'stroke-linecap="round"/></svg>' +
        '</button>' +
        (src ? '<div class="rp-dv-row__src" title="' + esc(src) + '">' +
          '<span>источник:</span> ' + esc(src) + '</div>' : '') +
        '</div>';
    });

    h += '</div>';

    if (!locked) {
      h += '<div class="rp-dv-actions">' +
        '<button type="button" class="rp-dv-add" data-rp-dv-act="add">' +
          '<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">' +
            '<path d="M6.5 1v11M1 6.5h11" stroke="currentColor" stroke-width="1.7" ' +
            'stroke-linecap="round"/></svg>' +
          'Добавить строку' +
        '</button>' +
        '<span class="rp-dv-actions__hint">' +
          'Если Мимир ошибся — правьте здесь: объём и единицу подхватит справочник норм.' +
        '</span>' +
      '</div>';
    }

    h += '</div>';
    return h;
  }

  /**
   * Блок «Позвоните клиенту»: телефон, контакт и вопросы из ТЗ.
   * Требование: анализ напоминает позвонить и подсказывает, что спросить.
   */
  function renderCallBlock(rj) {
    const c = (rj && rj.contact) || {};
    const questions = Array.isArray(rj && rj.call_questions) ? rj.call_questions : [];
    if (!c.phone && !c.name && !questions.length) return '';
    const phoneHref = String(c.phone || '').replace(/[^+\d]/g, '');
    let h = '<div class="rp-review-call-block">' +
      '<div class="rp-review-call-head">' +
      '<span class="rp-review-call-ic">☎</span>' +
      '<div class="rp-review-call-text">' +
      '<strong>Позвоните клиенту до решения</strong>' +
      '<span class="muted">' + esc(c.name || 'Контакт заказчика') +
      (c.phone ? ' · ' + esc(c.phone) : ' · телефон в документах не указан') +
      (c.window ? ' · ' + esc(c.window) : '') + '</span></div>' +
      (c.phone ? '<a class="btn mini" href="tel:' + esc(phoneHref) + '">Позвонить</a>' : '') +
      '</div>';
    if (questions.length) {
      h += '<ol class="rp-review-call-list">' +
        questions.slice(0, 8).map((q) => '<li>' + esc(q) + '</li>').join('') +
        '</ol>';
    }
    h += '</div>';
    return h;
  }

  /**
   * Техплан: сроки, бригада, МТР.
   *
   * Раньше в карточке анализа была видна только смета — ТО не мог ответить
   * «сколько человек, кого, на сколько дней, что за оборудование». Здесь
   * сводка из `report_json.tech_json` (или из сметы, если техплан старый).
   */
  function renderTechPlanBlock(rj) {
    const ui = window.AsgardTechPlanUI;
    if (!ui) return '';
    const plan = ui.readPlan(rj || {}, (rj && rj.asgard_smeta) || {});
    const html = ui.summaryHtml(plan, { hideEmpty: true });
    if (!html) return '';
    return '<div class="rp-review-tech-block"><div class="rp-review-analysis-ref-head"><strong>Техплан</strong>' +
      '<span class="muted">бригада · МТР · сроки</span></div>' + html + '</div>';
  }

  function feasibilityLabel(v) {
    return { yes: 'Да', conditional: 'Условно', no: 'Нет' }[v] || '—';
  }

  function rejectPresetLabel(v) {
    const hit = REJECT_PRESETS.find((p) => p.id === v);
    return hit ? hit.label : '—';
  }

  /**
   * Канон цены работ РП: work_price — БЕЗ НДС (зеркало src/services/work-price.js).
   * Legacy-карточки хранили с НДС + work_price_ex_vat = /1.22 — распознаём по отношению.
   */
  function reviewWorkPrice(review, workPrice) {
    const src = {
      work_price: workPrice != null && workPrice !== '' ? workPrice : (review && review.work_price),
      work_price_ex_vat: review && review.work_price_ex_vat
    };
    const M = window.AsgardMoney;
    if (M && M.resolveWorkPrice) return M.resolveWorkPrice(src);
    const ex = Number(src.work_price);
    if (!Number.isFinite(ex)) return { exVat: null, withVat: null };
    return { exVat: ex, withVat: Math.round(ex * 1.22 * 100) / 100 };
  }

  function priceRangeLabel(rj, workPrice) {
    if (workPrice) return fmtMoney(workPrice) + ' (без НДС)';
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
      h += '<span class="rp-review-badge director-pending">Согласование директора</span>';
    } else if (review?.director_review_status === 'approved') {
      h += '<span class="rp-review-badge director-approved">Цена согласована</span>';
    } else if (review?.director_review_status === 'rejected') {
      h += '<span class="rp-review-badge reject">Отклонено директором</span>';
    }
    if (review?.is_final) h += '<span class="rp-review-badge final">Готов</span>';
    else if (review?.analysis_finalized_at && mode === 'calc' && !review?.is_final) {
      const wp = Number(review.work_price);
      const needsCalc = !(Number.isFinite(wp) && wp > 0) && !review.estimate_file_id;
      if (needsCalc) {
        h += '<span class="rp-review-badge need-calc">Нужен просчёт</span>';
      } else {
        h += '<span class="rp-review-badge analysis-done">Анализ закрыт</span>';
      }
    }
    else if (!isLocked) h += '<span class="rp-review-badge draft">Черновик</span>';
    h += '<span class="rp-review-badge mode-' + (mode === 'calc' ? 'calc' : 'analysis') + '">' +
      (mode === 'calc' ? 'Полный просчёт' : 'Анализ тендера') + '</span>';
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
    const rw = reviewWorkPrice(review, workPrice);
    const priceEx = rw.exVat;
    const priceInc = rw.withVat;
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
    // Дефолт — по фазе, а не жёстко 'calc': незакрытый анализ открывается
    // как анализ, иначе в карточке появляется «Просчёт Мимир» (прод 06.11).
    let mode = opts.mode || 'analysis';
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
    // Чек-лист анализа (D-203): шаблон и ответы грузим один раз при открытии вкладки.
    let checklistData = { template: [], answers: {}, free_answers: [], loaded: false, saving: false };

    /** Можно ли править чек-лист (хозяин анализа / дежурный / участник / wide). */
    function canEditChecklist() {
      if (isDirector || isViewer) return false;
      // D-203: после закрытия анализа чек-лист неизменяем (он — основание решения о подаче).
      // Проверяем по данным карточки, а не по isLocked: ТО открывает анализ редактируемым,
      // и без этой строки он мог бы переписать закрытый чек-лист (бэк вернёт 409).
      if (review && review.analysis_finalized_at) return false;
      if (isTo) return false;              // ТО смотрит анализ, но не правит
      if (isLocked && !editingParticipantDraft) return false;
      return !!canFinalize || editingParticipantDraft || isFinalOwner;
    }

    function renderChecklistTab() {
      if (!checklistData.loaded) {
        // Подгрузка асинхронно, первый кадр — плейсхолдер.
        loadChecklist();
        return '<div class="rp-review-tab-body" id="rpChecklistHost"><p class="muted">Загрузка чек-листа…</p></div>';
      }
      const ro = !canEditChecklist();
      const wordUrl = API.analysisChecklistWordUrl ? API.analysisChecklistWordUrl(tender.id) : '';
      return '<div class="rp-review-tab-body" id="rpChecklistHost">' +
        window.AsgardAnalysisChecklist.html(
          checklistData.template, checklistData.answers, checklistData.free_answers,
          { readOnly: ro, wordUrl }
        ) + '</div>';
    }

    function loadChecklist(force) {
      if (checklistData.loading) return Promise.resolve();
      if (checklistData.loaded && !force) return Promise.resolve();
      checklistData.loading = true;
      return window.AsgardAnalysisChecklist.load(tender.id).then((d) => {
        checklistData = {
          template: d.template || [],
          answers: d.answers || {},
          free_answers: d.free_answers || [],
          loaded: true,
          loading: false,
          error: !!d.error
        };
        if (tab === 'checklist') rerender();
      }).catch(() => {
        checklistData.loading = false;
        checklistData.loaded = true;
      });
    }

    function titleText() {
      return 'Отчёт РП · #' + tender.id;
    }

    async function showAnalysisBridgeModal() {
      const dec = (review && review.decision) || decision
        || (reportJson && reportJson.decision_recommend);
      const isReject = dec === 'reject' || dec === 'no_go';
      const bodyHtml = isReject
        ? 'Анализ закрыт с решением <b>не подаём</b>. Просчёт не обязателен — при необходимости его можно открыть из очереди.'
        : 'Анализ закрыт. <b>Следующий шаг — просчёт</b>: смета, цена работ и материалы для ТО.';
      const okText = isReject ? 'Понятно' : 'Открыть просчёт';
      const cancelText = isReject ? 'Всё же открыть просчёт' : 'Пока останусь в анализе';
      const openCalc = () => {
        hideModal();
        if (typeof opts.onOpenCalc === 'function') opts.onOpenCalc(tender);
      };
      let ok = true;
      if (window.AsgardConfirm && typeof AsgardConfirm.open === 'function') {
        ok = await AsgardConfirm.open({
          title: 'Анализ закрыт',
          body: bodyHtml,
          okText,
          cancelText,
          danger: false
        });
      }
      if (isReject) {
        if (ok) hideModal();
        else openCalc();
      } else if (ok) openCalc();
      else hideModal();
    }

    function maybeToastAnalysisClosed() {
      if (mode !== 'analysis' || !review || !review.analysis_finalized_at) return;
      const key = 'rp_analysis_toast_' + tender.id;
      try {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, '1');
      } catch (_) { return; }
      toast('Анализ', 'Анализ уже закрыт. Остался просчёт.', 'info');
    }

    function badgesHtml() {
      return '<div class="rp-review-badges-row">' + renderHeaderBadges(review, mode, isLocked) + '</div>';
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
      let base = c + (c && short ? ' · ' : '') + short;
      if (mode === 'analysis') {
        base += (base ? ' · ' : '') + 'Решение «подаём / не подаём» без сметы — цену считаем в просчёте';
      }
      return base;
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
          h += '<div class="rp-review-summary-card rp-review-ref-decision ' + cls + '"><strong>' + esc(label) + '</strong>';
          h += '<p class="rp-review-ref-hint muted">Решение из анализа дежурного РП</p></div>';
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

      if (mode === 'analysis') {
        const hasMimirAnalysis = !!(reportJson.decision_recommend || reportJson.volume_summary
          || (reportJson.summary && reportJson.decision_recommend));
        if (hasMimirAnalysis || reportJson.summary || reportJson.risks) {
          h += renderAnalysisReportCard(reportJson);
        } else if (!isLocked) {
          h += '<p class="muted" style="font-size:12px;margin:0 0 10px">Нажмите «Анализ Мимир» — в отчёт попадут рекомендация, объём и риски без сметы.</p>';
        }
        // ДВ, технология и звонок — то, что разобрал Мимир. Без них карточка
        // показывала только текст и не давала проверить объёмы.
        h += renderVisitSchedule(reportJson);
        h += renderDvBlock(reportJson, isLocked);
        h += renderCallBlock(reportJson);
        h += renderTechPlanBlock(reportJson);
      }

      if (mode === 'calc' && review && review.analysis_finalized_at && !review.is_final) {
        const wp = Number(review.work_price);
        const needsCalc = !(Number.isFinite(wp) && wp > 0) && !review.estimate_file_id;
        h += '<div class="rp-review-calc-banner' + (needsCalc ? ' is-urgent' : '') + '">' +
          (needsCalc
            ? '<strong>Нужен просчёт</strong> — заполните смету и цену работ (без НДС).'
            : 'Анализ закрыт. Следующий шаг — <strong>просчёт</strong>: смета и цена для ТО.') +
          '</div>';
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

      // Оценка нужна ДО решения: дежурный смотрит выполнимость и риски, чтобы
      // решить, подаём или нет. Раньше блок рисовался только при decision=submit,
      // и до нажатия «Подаём» все поля стояли пустые (прод 06.11).
      if (mode === 'analysis' || (mode === 'calc' && !hasSnap)) {
        const assess = section('assess', 'Оценка и рекомендация', (() => {
          let ih = '<div class="rp-review-field-row">';
          ih += '<div class="rp-review-field"><label>Выполнимость' + (!isLocked ? ' <span class="req">*</span>' : '') + '</label>';
          ih += isLocked ? renderRo('', feasibilityLabel(reportJson.feasibility)) :
            renderSeg('feasibility', [{ id: 'yes', label: 'Да' }, { id: 'conditional', label: 'Условно' }, { id: 'no', label: 'Нет' }], reportJson.feasibility, isLocked);
          // Пояснение от модели: почему «условно» или «нет». Без него статус
          // не даёт ТО никакой информации.
          if (reportJson.feasibility_note) {
            ih += '<p class="rp-feasibility-note">' + esc(reportJson.feasibility_note) + '</p>';
          }
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
            // Канон: work_price — цена без НДС; «с НДС» показываем производной.
            ih += renderRo('Цена работ (без НДС)', fmtMoney(workPrice));
            const rw = reviewWorkPrice(review, workPrice);
            if (rw.withVat != null && rw.withVat !== Number(workPrice)) {
              ih += renderRo('Цена работ (с НДС)', fmtMoney(rw.withVat));
            }
          }

          ih += '<div class="rp-review-field"><label>Суть для ТО' + (!isLocked ? ' <span class="req">*</span>' : '') + '</label>';
          ih += isLocked ? renderRo('', reportJson.summary) :
            '<textarea class="inp" id="rpSummary" rows="3">' + esc(reportJson.summary || '') + '</textarea>';
          ih += '</div><div class="rp-review-field"><label>Объём коротко</label>';
          ih += isLocked ? renderRo('', reportJson.volume_summary) :
            '<textarea class="inp" id="rpVolumeSummary" rows="2">' + esc(reportJson.volume_summary || '') + '</textarea>';
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

        if (mode === 'calc') {
          h += section('scope', 'Объём и сроки', (() => {
            let ih = '<div class="rp-review-field"><label>Объём работ</label>';
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
            ih += '<div class="rp-review-field"><label>Цена работ, ₽ (без НДС)' + (!isLocked ? ' <span class="req">*</span>' : '') + '</label>';
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
        const mimirLabel = mode === 'analysis' ? '🚀 Анализ Мимир' : '🚀 Просчёт Мимир';
        const mimirTitle = mode === 'analysis'
          ? 'ИИ-анализ тендера без сметы'
          : 'Просчёт через Мимир-Quick';
        h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px">' +
          '<button type="button" class="btn mini" id="rpOpenMimir" title="' + esc(mimirTitle) + '">' +
          esc(mimirLabel) + '</button></div>';
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
            h += '<div class="muted" style="font-size:11px;margin-top:4px">Цена (без НДС): ' + esc(fmtMoney(dj.work_price)) + '</div>';
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
        { id: 'checklist', label: 'Чек-лист' },
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
      else if (tab === 'checklist') h += renderChecklistTab();
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
      // Оценка есть всегда (она нужна до решения), поэтому и сохраняем всегда.
      {
        const summaryEl = document.getElementById('rpSummary');
        if (summaryEl) reportJson.summary = summaryEl.value || '';
        const volEl = document.getElementById('rpVolumeSummary');
        if (volEl) reportJson.volume_summary = volEl.value || '';
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

    /**
     * Живое редактирование ДВ прямо в карточке.
     *
     * Работает без перерисовки всей модалки: меняем reportJson и обновляем
     * счётчик. Перерисовка сбивала бы фокус и теряла недопечатанный символ.
     */
    function bindDvEditing() {
      const root = document.querySelector('[data-rp-dv-root]');
      if (!root) return;

      const positions = () => (Array.isArray(reportJson.dv_positions) ? reportJson.dv_positions : []);

      // Удаление строки.
      root.querySelectorAll('[data-rp-dv-act="del"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.getAttribute('data-rp-dv-idx'));
          const list = positions();
          if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return;
          list.splice(idx, 1);
          reportJson.dv_positions = list;
          rerenderDvSection();
        });
      });

      // Добавление строки.
      const addBtn = root.querySelector('[data-rp-dv-act="add"]');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          const list = positions();
          list.push({
            name: '',
            volume: null,
            unit: 'м3',
            method_name: '',
            fouling: '',
            // Пометка: позиция введена человеком, а не моделью. Справочник
            // подберёт норму при просчёте, но приоритет — за РП.
            volume_source: 'manual'
          });
          reportJson.dv_positions = list;
          rerenderDvSection();
        });
      }

      // Правка полей — пишем сразу в reportJson.
      root.querySelectorAll('[data-rp-dv-field]').forEach((inp) => {
        const field = inp.getAttribute('data-rp-dv-field');
        const card = inp.closest('[data-rp-dv-idx]');
        const idx = card ? Number(card.getAttribute('data-rp-dv-idx')) : NaN;
        const handler = () => {
          const list = positions();
          if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return;
          let v = inp.value;
          if (field === 'volume') v = v === '' ? null : Number(v);
          if (field === 'name' && !String(v).trim()) return; // пустое имя не пишем
          list[idx][field] = v;
          // Ручная правка снимает автоматические метки: модель больше не
          // отвечает за эту строку.
          if (field === 'volume' || field === 'unit') {
            list[idx].volume_source = 'manual';
            delete list[idx].needs_classification;
          }
          reportJson.dv_positions = list;
        };
        inp.addEventListener('change', handler);
        // Для текста — ещё и ввод, чтобы не терять правку при закрытии без blur.
        if (inp.tagName === 'INPUT' && inp.type !== 'number') {
          inp.addEventListener('input', handler);
        }
      });
    }

    /** Перерисовывает только блок ДВ, сохраняя позицию скролла. */
    function rerenderDvSection() {
      const old = document.querySelector('[data-rp-dv-root]');
      if (!old) return;
      const scrollTop = old.ownerDocument.documentElement.scrollTop;
      const html = renderDvBlock(reportJson, false);
      const wrap = old.ownerDocument.createElement('div');
      wrap.innerHTML = html;
      const fresh = wrap.firstElementChild;
      if (!fresh) return;
      old.replaceWith(fresh);
      bindDvEditing();
      try { old.ownerDocument.documentElement.scrollTop = scrollTop; } catch (_) {}
    }

    /**
     * Кнопки подтверждения режима заездов.
     *
     * Анализ не гадает: если график в документах не найден, режим остаётся
     * `unknown` и РП отвечает здесь. Ответ пишется в visit_plan и переводит
     * смету на правильное число выездов, а не на молчаливую единицу.
     */
    function bindVisitSchedule() {
      const root = document.querySelector('[data-rp-visit-root]');
      if (!root) return;
      root.querySelectorAll('[data-rp-visit-mode]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const mode = btn.getAttribute('data-rp-visit-mode');
          if (!mode) return;
          let trips = 1;
          if (mode === 'visits') {
            const raw = window.prompt('Сколько выездов бригады планируется?', '2');
            if (raw == null) return;
            trips = Math.max(2, Number(raw) || 2);
          }
          const plan = reportJson.visit_plan || {};
          reportJson.visit_plan = Object.assign({}, plan, {
            mode: mode === 'visits' ? 'visits' : 'continuous',
            trip_count: mode === 'visits' ? trips : 1,
            unconfirmed: false,
            confirmed_by: 'rp',
            conflicts: (plan.conflicts || []).filter((c) => c.kind !== 'mode_unknown')
          });
          reportJson.visit_mode = reportJson.visit_plan.mode;
          reportJson.trip_count = reportJson.visit_plan.trip_count;
          try {
            const saved = await API.saveRpReview(tender.id, {
              mode: 'analysis',
              report_json: reportJson,
              // work_price не трогаем: на анализе денег нет.
            });
            if (saved && saved.review) review = saved.review;
          } catch (e) {
            toast('График заездов', 'Не удалось сохранить режим: ' + (e.message || 'ошибка'), 'warn');
          }
          rerender();
        });
      });
    }

    function bindModal() {
      document.getElementById('rpExit')?.addEventListener('click', hideModal);

      // ── Редактирование ведомости объёмов ────────────────────────────────
      // РП должен уметь исправить разбор Мимира: удалить лишнюю строку,
      // добавить пропущенную, поправить объём или единицу. Без этого
      // ошибочный разбор запирал бы закрытие анализа.
      bindDvEditing();
      bindVisitSchedule();
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
      document.getElementById('rpOpenMimir')?.addEventListener('click', async () => {
        // В ФАЗЕ АНАЛИЗА открываем поэтапный Мимир (объёмы → технология →
        // решение → звонок), а не старый мастер со сметой: в анализе сметы нет.
        // Просчёт (mode='calc') остаётся на прежнем мастере Quick.
        if (mode === 'analysis' && window.AsgardMimirStages) {
          try {
            const started = await API.startRpQuick(tender.id, { phase: 'analysis' });
            const uid = started && started.session_uid;
            if (!uid) throw new Error('Не удалось создать сессию анализа');
            const checklist = await API.loadAnalysisChecklist(tender.id).catch(() => null);
            window.AsgardMimirStages.open({
              sessionUid: uid,
              tenderId: tender.id,
              phase: 'analysis',
              title: 'Анализ тендера · ' + (tender.customer_name || ('#' + tender.id)),
              subtitle: (tender.tender_title || '').slice(0, 120),
              tzText: [tender.tender_title, tender.tender_description].filter(Boolean).join('\n\n'),
              attachments: started.tender_attachments || [],
              checklist: checklist ? {
                items: (checklist.template || []).map((t) => ({
                  id: t.id, text: t.text, required: t.required !== false,
                  answer: ((checklist.checklist && checklist.checklist.answers) || {})[t.id] || ''
                })),
                answered: Object.keys((checklist.checklist && checklist.checklist.answers) || {}).length,
                total: (checklist.template || []).length
              } : null,
              onAnalyze: async (payload, progress) => {
                const onProgress = typeof progress === 'function' ? progress : () => {};
                const token = window.AsgardRegistryApi?._token?.()
                  || localStorage.getItem('asgard_token') || '';
                const r = await fetch(
                  `/api/tkp-quick/sessions/${encodeURIComponent(uid)}/stage/analyze`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Accept: 'text/event-stream',
                      Authorization: 'Bearer ' + token
                    },
                    body: JSON.stringify({ tz_text: payload.tz_text, stream: true })
                  }
                );
                // SSE: шаги анализа с числами. Раньше висел один запрос 10–15 мин
                // без обратной связи — «Мимир думает…» и тишина.
                let d = null;
                if (r.ok && r.body && (r.headers.get('content-type') || '').includes('text/event-stream')) {
                  const reader = r.body.getReader();
                  const decoder = new TextDecoder();
                  let buffer = '';
                  for (;;) {
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    buffer += decoder.decode(chunk.value, { stream: true });
                    const parts = buffer.split('\n\n');
                    buffer = parts.pop() || '';
                    for (const part of parts) {
                      const line = part.trim();
                      if (!line.startsWith('data:')) continue;
                      let evt = null;
                      try { evt = JSON.parse(line.slice(5)); } catch (_) { continue; }
                      if (evt.type === 'result') {
                        d = evt;
                      } else if (evt.type === 'error') {
                        throw new Error(evt.error || 'Анализ не удался');
                      } else {
                        // start / progress / heartbeat — в ленту этапов.
                        onProgress(evt);
                      }
                    }
                  }
                } else {
                  // Сервер не отдал поток — забираем обычный JSON.
                  d = await r.json().catch(() => ({}));
                }
                if (!d) throw new Error('Анализ не вернул результат');
                if (!d.ok) throw new Error(d.error || 'Анализ не удался');

                // Заполняем КАРТОЧКУ отчёта из результата анализа: объём, суть,
                // риски, выполнимость. Раньше карточка оставалась пустой, и было
                // непонятно, что дал анализ.
                const positions = (d.state && d.state.positions) || [];

                // Вопросы для звонка и контакт пишем ВСЕГДА, даже если позиций нет:
                // именно в этом случае они особенно нужны — чтобы позвонить и
                // добрать объёмы. Раньше они лежали внутри if (positions.length)
                // и терялись при пустом разборе (прод 06.11).
                reportJson.call_questions = Array.isArray(d.call_questions) ? d.call_questions : [];
                reportJson.contact = d.contact || null;
                reportJson.decision_recommend = d.decision_recommend || 'need_info';

                // Готовые формулировки от модели: суть, объём, выполнимость,
                // риски. Раньше промпт их не просил — поля стояли пустые.
                if (d.summary) reportJson.summary = String(d.summary).trim();
                if (d.volume_summary) reportJson.volume_summary = String(d.volume_summary).trim();
                if (d.feasibility) reportJson.feasibility = d.feasibility;
                if (d.feasibility_note) reportJson.feasibility_note = String(d.feasibility_note).trim();
                if (d.competition) reportJson.competition = d.competition;
                if (d.risks) reportJson.risks = String(d.risks).trim();

                // ── Диагностика разбора ──────────────────────────────────
                // Без переноса этих полей баннер в модалке просчёта НИКОГДА
                // не появится: он читает их из report_json, а сюда они не
                // попадали (на проде 0 из 219 записей — найдено верификатором).
                if (d.incomplete != null) reportJson.incomplete = !!d.incomplete;
                if (d.incomplete_note) reportJson.incomplete_note = String(d.incomplete_note);
                if (d.review_hint) reportJson.review_hint = String(d.review_hint);
                if (d.expected_rows != null) reportJson.expected_rows = Number(d.expected_rows) || 0;
                if (d.expected_rows_grid != null) reportJson.expected_rows_grid = Number(d.expected_rows_grid) || 0;
                if (d.model_said_positions != null) reportJson.model_said_positions = Number(d.model_said_positions) || 0;
                if (d.found_positions != null) reportJson.found_positions = Number(d.found_positions) || 0;
                if (d.valid_positions != null) reportJson.valid_positions = Number(d.valid_positions) || 0;
                if (d.generation_rounds != null) reportJson.generation_rounds = Number(d.generation_rounds) || 1;

                // ── График заездов ──────────────────────────────────────────
                // Анализ отдаёт режим и заезды (без денег). Кладём в report_json,
                // чтобы карточка анализа показала Гант, а просчёт взял trip_count
                // для дороги/проживания/пайковых.
                if (d.visit_plan) {
                  reportJson.visit_plan = d.visit_plan;
                  reportJson.visit_mode = d.visit_plan.mode || null;
                  reportJson.trip_count = d.visit_plan.trip_count || 1;
                  reportJson.visit_conflicts = d.visit_plan.conflicts || [];
                } else if (d.state && d.state.visit_plan) {
                  reportJson.visit_plan = d.state.visit_plan;
                  reportJson.visit_mode = d.state.visit_mode || null;
                  reportJson.trip_count = d.state.trip_count || 1;
                }

                // ── Материалы и оборудование ────────────────────────────────
                // Раньше МТР всегда был пуст («Перечень не заполнен»), потому
                // что модель его не возвращала, а заполнять вручную каждый раз
                // никто не станет. Теперь модель предлагает расходники по
                // документам, а РП правит их на вкладке «Бригада и МТР».
                if (Array.isArray(d.mtr_suggestions) && d.mtr_suggestions.length) {
                  const mtrList = d.mtr_suggestions
                    .filter((x) => x && x.name)
                    .map((x) => ({
                      name: String(x.name).trim().slice(0, 200),
                      qty: Number(x.qty) > 0 ? Number(x.qty) : null,
                      unit: String(x.unit || '').trim().slice(0, 20),
                      purpose: String(x.purpose || '').trim().slice(0, 200),
                      // Источник: из документа или типовой расходник.
                      source: String(x.source || '').toLowerCase() === 'typical' ? 'typical' : 'doc'
                    }));
                  reportJson.mtr_suggestions = mtrList;
                  // Кладём в техплан, чтобы вкладка «Бригада и МТР» была
                  // заполнена сразу, а не показывала «Перечень не заполнен».
                  if (!Array.isArray(reportJson.mtr) || !reportJson.mtr.length) {
                    reportJson.mtr = mtrList.map((x) => ({
                      name: x.name,
                      qty: x.qty,
                      unit: x.unit,
                      note: x.purpose
                    }));
                  }
                }

                if (positions.length) {
                  const scopeText = positions.map((p) =>
                    `${p.name} — ${p.volume} ${p.unit || ''}`.trim()).join('; ');
                  reportJson.scope = scopeText;
                  reportJson.volume_summary = scopeText;
                  reportJson.resources = positions
                    .map((p) => p.tech_equip).filter(Boolean).join('; ');

                  // ДВ и всё, что разобрал Мимир, кладём в отчёт ЦЕЛИКОМ:
                  // карточка должна показывать позиции, технологию, источник,
                  // вопросы для звонка и контакт, а не только текст объёма.
                  reportJson.dv_positions = positions;
                  reportJson.decision_recommend = d.decision_recommend || 'need_info';

                  // Выполнимость: needs_classification/проблемы → «условно».
                  const problems = positions.filter((p) => p.needs_classification || (p.problems || []).length);
                  reportJson.feasibility = problems.length ? 'conditional' : 'yes';

                  // Риски собираем из проблем и предупреждений, а не выдумываем.
                  const riskLines = [];
                  if (problems.length) {
                    riskLines.push(`Требуют уточнения: ${problems.map((p) => p.name).join(', ')}`);
                  }
                  if (d.blocked) riskLines.push(`Позиций без метода: ${d.blocked}`);
                  if (Array.isArray(d.questions_for_customer) && d.questions_for_customer.length) {
                    riskLines.push('Открытые вопросы к заказчику: ' + d.questions_for_customer.slice(0, 3).join('; '));
                  }
                  reportJson.risks = reportJson.risks || riskLines.join('\n');

                  const total = positions.length;
                  const decisionMap = { go: 'submit', no_go: 'reject', need_info: 'pending' };
                  if (decisionMap[d.decision_recommend]) decision = decisionMap[d.decision_recommend];
                  // Суть: если модель не дала — собираем честно из позиций,
                  // а не пишем «разобрал N позиций» (это не суть для ТО).
                  if (!reportJson.summary) {
                    const names = positions.slice(0, 3).map((p) => p.name).filter(Boolean);
                    reportJson.summary = (names.join('; ') || 'Позиции по ТЗ') +
                      ` — всего ${total} позиц.` +
                      (d.decision_recommend === 'go' ? ' Данных достаточно для участия.'
                        : d.decision_recommend === 'no_go' ? ' Рекомендуется не участвовать.'
                          : ' Нужны уточнения у заказчика.');
                  }
                }
                rerender();
                // Сохраняем карточку на сервер: иначе разбор живёт только до
                // перезагрузки, а просчёт и ТО не видят ни ДВ, ни вопросов к клиенту.
                // Вопросы для звонка и контакт берём из ОТВЕТА РАЗБОРА, а не из
                // stage: там они привязаны к сессии, и при смене сессии пропадали.
                try {
                  const saved = await API.saveRpReview(tender.id, {
                    mode: 'analysis',
                    report_json: reportJson,
                    decision: decision === 'reject' ? 'reject' : (decision === 'submit' ? 'submit' : 'pending')
                  });
                  if (saved && saved.review) review = saved.review;
                } catch (e) {
                  console.warn('[Mimir] analysis save failed:', e && e.message);
                  toast('Анализ', 'Разбор не сохранён: ' + (e.message || 'ошибка'), 'warn');
                }
                return d;
              },
              onDecide: async (res) => {
                // Записываем решение в карточку: оно и закрывает анализ.
                decision = res.go ? 'submit' : 'reject';
                reportJson.decision_recommend = res.go ? 'go' : 'no_go';
                if (res.reason) reportJson.reject_reason = res.reason;
                if (res.answers) {
                  await API.saveAnalysisChecklist(tender.id, { answers: res.answers }).catch(() => {});
                }
                rerender();
              },
              onClose: () => { onSaved && onSaved(); }
            });
            return;
          } catch (e) {
            toast('Мимир', e.message || 'Не удалось открыть анализ', 'err');
            return;
          }
        }

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
              const dr = result.field_patch.decision_recommend;
              if (dr === 'no_go') decision = 'reject';
              else if (dr === 'go') decision = 'submit';
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
              workPrice = reviewWorkPrice(review).exVat ?? workPrice;
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
          ? 'После закрытия анализ нельзя править — его получит ТО.<br><br>' +
            'Закрытие анализа — это не просчёт и не закрытие тендера.<br>' +
            'Смету и цену вы посчитаете на следующем шаге — в просчёте.<br><br>' +
            'Чтобы просто выйти без закрытия — нажмите крестик.<br>' +
            'Черновик сохраняйте кнопкой «Сохранить».'
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
              ? 'Закрыть анализ? После закрытия анализ нельзя править — его получит ТО.\n\n' +
                'Закрытие анализа — это не просчёт и не закрытие тендера.\n' +
                'Смету и цену вы посчитаете на следующем шаге — в просчёте.\n\n' +
                'Чтобы просто выйти без закрытия — нажмите крестик.\n' +
                'Черновик сохраняйте кнопкой «Сохранить».'
              : 'Закрыть отчёт? После закрытия вы больше не сможете его править.\n\nЧтобы просто выйти — нажмите крестик, не эту кнопку.')
          );
        }
        if (!ok) return;
        // D-203: анализ закрывается только с заполненным чек-листом. Сохраняем его
        // жёстко (require_complete) ДО закрытия — иначе бэк вернёт 400 и анализ останется открытым.
        if (isAnalysis) {
          try {
            const clHost = document.getElementById('rpChecklistHost');
            if (clHost && canEditChecklist()) {
              await window.AsgardAnalysisChecklist.save(tender.id, clHost, { requireComplete: true });
            }
          } catch (e) {
            if (e && e.code === 'CHECKLIST_INCOMPLETE') {
              tab = 'checklist';
              toast('Чек-лист', 'Заполните ' + (e.missing || []).length + ' обязательных вопрос(ов) чек-листа: ' +
                (e.missing || []).map((m) => '«' + m.text + '»').slice(0, 3).join(', ') +
                ((e.missing || []).length > 3 ? ' …' : ''), 'err');
              rerender();
              return;
            }
            toast('Чек-лист', e.message || 'Не удалось сохранить чек-лист', 'err');
            return;
          }
        }
        const ov = await confirmAdminOverrideIfNeeded(true);
        if (!ov.ok) return;
        API.saveRpReview(tender.id, collectPayload(true, ov.override)).then((d) => {
          if (d && d.review) review = d.review;
          toast('Анализ', mode === 'analysis' ? 'Анализ закрыт' : 'Отчёт закрыт', 'ok');
          onSaved && onSaved();
          if (mode === 'analysis') void showAnalysisBridgeModal();
          else hideModal();
        }).catch((e) => handleSaveConflict(e));
      });

      document.querySelectorAll('[data-rptab]').forEach((b) => {
        b.addEventListener('click', () => {
          syncFromDom();
          tab = b.dataset.rptab;
          if (tab === 'thread') {
            loadThreadMessages().then(() => rerender());
          } else if (tab === 'checklist') {
            loadChecklist().then(() => { if (tab === 'checklist') rerender(); });
            rerender();
          } else {
            rerender();
          }
        });
      });

      // Чек-лист: сохранение из вкладки.
      document.getElementById('rpClSave')?.addEventListener('click', () => {
        const host = document.getElementById('rpChecklistHost');
        if (!host || checklistData.saving) return;
        checklistData.saving = true;
        const st = document.getElementById('rpClStatus');
        if (st) st.textContent = 'Сохранение…';
        const payload = window.AsgardAnalysisChecklist.collect(host);
        API.saveAnalysisChecklist(tender.id, {
          answers: payload.answers,
          free_answers: payload.free_answers
        }).then(() => {
          checklistData.answers = payload.answers;
          checklistData.free_answers = payload.free_answers;
          checklistData.saving = false;
          const s = document.getElementById('rpClStatus');
          if (s) s.textContent = 'Сохранено';
          toast('Чек-лист', 'Сохранено', 'ok');
        }).catch((e) => {
          checklistData.saving = false;
          const s = document.getElementById('rpClStatus');
          if (s) s.textContent = '';
          toast('Чек-лист', e.message || 'Не удалось сохранить', 'err');
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
              workPrice = reviewWorkPrice(review).exVat ?? workPrice;
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
        wide: true,
        fullscreen: true
      });
      bindModal();
    }

    showModal({
      title: titleText(),
      subtitle: subtitleText(),
      icon: '📊',
      html: '<p class="muted">Загрузка отчёта…</p>',
      wide: true,
      fullscreen: true,
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
          // Режим НЕ перезаписываем из report_json.mode: у нового тендера он пуст,
          // и дефолт 'calc' превращал анализ в просчёт. Фаза берётся из карточки:
          // анализ закрыт (analysis_finalized_at) → просчёт, иначе анализ.
          if (contextMode != null) {
            mode = contextMode;
          } else {
            const finalized = !!(review?.analysis_finalized_at);
            mode = finalized ? 'calc' : 'analysis';
          }
          reportJson = parseRj(review?.report_json, mode);
          workPrice = reviewWorkPrice(review).exVat ?? '';
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
          maybeToastAnalysisClosed();
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
    if (rev.work_price) h += ' · ' + esc(fmtMoney(reviewWorkPrice(rev).exVat)) + ' (без НДС)';
    h += '</div>';
    h += renderRo('Суть', rj.summary) + renderRo('Риски', rj.risks) + renderRo('Рекомендация', rj.recommendation);
    if (estimateFile) {
      h += '<a class="btn mini" href="' + esc(estimateFile.download_url) + '" target="_blank" rel="noreferrer">Скачать смету</a>';
    }
    return h;
  }

  return { open, renderReportSnippet, MISSING_FLAGS };
})();
