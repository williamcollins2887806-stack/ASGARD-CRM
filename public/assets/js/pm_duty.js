/**
 * PM Calculations page — #/pm-calculations (alias #/pm-duty)
 * Visual shell: hero, rating badge, tabs, queue, gantt, leaderboard.
 * RpReviewModal / calc business logic untouched.
 */
window.AsgardPmDutyPage = (function () {
  const { esc, toast, showModal, hideModal } = AsgardUI;
  const API = AsgardRegistryApi;
  const fmtDate = (v) => API.fmtDate(v);

  const ALLOWED = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const ASSIGN = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const LEADERBOARD = ['ADMIN', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const WRITE_NORMS = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO'];

  const QUEUE_TABS = [
    { id: 'analysis', label: 'Анализ' },
    { id: 'calc', label: 'Просчёты' },
    { id: 'mine', label: 'Мои' },
    { id: 'archive', label: 'Архив' },
    { id: 'norms', label: 'Справочник' }
  ];

  function userRoles(user) {
    if (!user) return [];
    if (window.AsgardAuth && typeof AsgardAuth.normalizeUserRoles === 'function') {
      return AsgardAuth.normalizeUserRoles(user);
    }
    return user.role ? [user.role] : [];
  }

  function userCan(user, roles) {
    if (!user) return false;
    if (user.role === 'ADMIN') return true;
    const rs = userRoles(user);
    return roles.some((r) => rs.includes(r));
  }

  function isoDate(d) {
    const x = d || new Date();
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }

  function weekPreset(kind) {
    const today = new Date();
    const dow = today.getDay();
    const monOffset = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(today);
    mon.setDate(today.getDate() + monOffset);
    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);
    if (kind === 'today6') {
      return { start: isoDate(today), end: addDays(isoDate(today), 6) };
    }
    if (kind === 'thisWeek') {
      return { start: isoDate(mon), end: isoDate(fri) };
    }
    if (kind === 'nextWeek') {
      mon.setDate(mon.getDate() + 7);
      fri.setDate(fri.getDate() + 7);
      return { start: isoDate(mon), end: isoDate(fri) };
    }
    return { start: isoDate(today), end: addDays(isoDate(today), 6) };
  }

  function parseHashTab() {
    const h = location.hash || '';
    const q = h.indexOf('?');
    if (q < 0) return 'analysis';
    const params = new URLSearchParams(h.slice(q + 1));
    let t = params.get('tab') || 'analysis';
    if (t === 'drafts' || t === 'need_report') t = t === 'need_report' ? 'analysis' : 'calc';
    if (t === 'my_reviewed') t = 'archive';
    return QUEUE_TABS.some((x) => x.id === t) ? t : 'analysis';
  }

  function queueSourceLabel(row, tab) {
    if (row.queue_source) return row.queue_source;
    if (tab === 'analysis') return 'Дежурная очередь';
    if (tab === 'mine') {
      if (row.phase === 'calc') return 'Просчёт';
      if (row.analysis_owner_name) return 'Хозяин: ' + row.analysis_owner_name;
      if (row.started_by_name) return 'Начал: ' + row.started_by_name;
      return 'Моё участие';
    }
    if (row.created_by_name) return 'Назначил ТО';
    return '—';
  }

  function tabHint(tab) {
    if (tab === 'analysis') return 'Быстрый анализ: подаём / не подаём (дежурная очередь «рассмотрение»)';
    if (tab === 'calc') return 'Назначили мне + черновики — полный просчёт со сметой';
    if (tab === 'mine') return 'Тендеры, которые вы начинали или считали. Пока анализ не закрыт — можно править вместе с дежурным.';
    if (tab === 'norms') return 'Нормы выработки, химия, оборудование — мини-калькулятор без ИИ';
    return 'Закрытые отчёты — бывший «Свод расчётов»';
  }

  function queueStatusLabel(row) {
    if (row.is_final) return 'Отчёт готов';
    if (row.phase === 'calc' || row.analysis_finalized_at) return 'Анализ закрыт · просчёт';
    if (row.decision === 'submit') return 'Подаём';
    if (row.decision === 'reject') return 'Не подаём';
    if (row.review_id && !row.is_final) return 'Черновик';
    return 'Новый';
  }

  function deadlineTone(docsDeadline) {
    if (!docsDeadline) return { cls: 'pm-duty-dl--none', label: 'без срока' };
    const d = String(docsDeadline).slice(0, 10);
    const today = isoDate();
    if (d < today) return { cls: 'pm-duty-dl--over', label: 'просрочен' };
    const soon = addDays(today, 3);
    if (d <= soon) return { cls: 'pm-duty-dl--hot', label: 'горит' };
    return { cls: 'pm-duty-dl--ok', label: 'в сроке' };
  }

  function gradeClass(grade) {
    const g = String(grade || 'E').toUpperCase();
    return 'pm-duty-grade pm-duty-grade--' + g.toLowerCase();
  }

  function ratingRingSvg(score, grade) {
    const s = Math.max(0, Math.min(100, Number(score) || 0));
    const r = 42;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - s / 100);
    const tone = String(grade || 'E').toLowerCase();
    return '<svg class="pm-duty-ring pm-duty-ring--' + tone + '" viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle class="pm-duty-ring-track" cx="50" cy="50" r="' + r + '" fill="none"/>' +
      '<circle class="pm-duty-ring-val" cx="50" cy="50" r="' + r + '" fill="none" ' +
        'stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '" ' +
        'transform="rotate(-90 50 50)"/>' +
      '</svg>';
  }

  function periodProgress(start, end) {
    if (!start || !end) return null;
    const s = new Date(String(start).slice(0, 10) + 'T12:00:00').getTime();
    const e = new Date(String(end).slice(0, 10) + 'T12:00:00').getTime();
    const n = new Date(isoDate() + 'T12:00:00').getTime();
    if (!(e > s)) return 100;
    const p = ((n - s) / (e - s)) * 100;
    return Math.max(0, Math.min(100, Math.round(p)));
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function renderDutyGantt(items) {
    if (!items || !items.length) {
      return '<div class="pm-duty-gantt pm-duty-gantt--empty"><p class="muted">Нет периодов в графике</p></div>';
    }
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 3);
    const end = new Date(today);
    end.setDate(end.getDate() + 21);
    const span = end.getTime() - start.getTime();
    const nowPct = Math.max(0, Math.min(100, ((today.getTime() - start.getTime()) / span) * 100));

    function pct(d) {
      const t = new Date(String(d).slice(0, 10) + 'T12:00:00').getTime();
      return Math.max(0, Math.min(100, ((t - start.getTime()) / span) * 100));
    }

    const nowStr = isoDate(today);
    const ticks = [];
    for (let i = 0; i <= 4; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + Math.round((i / 4) * 24));
      ticks.push({ left: (i / 4) * 100, label: String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') });
    }

    let html = '<div class="pm-duty-gantt">' +
      '<div class="pm-duty-gantt-scale">' +
      ticks.map((t) => '<span style="left:' + t.left + '%">' + esc(t.label) + '</span>').join('') +
      '</div>';

    items.slice(0, 16).forEach((r) => {
      const ps = pct(r.period_start);
      const pe = pct(r.period_end);
      const w = Math.max(3.5, pe - ps);
      const active = nowStr >= String(r.period_start).slice(0, 10) && nowStr <= String(r.period_end).slice(0, 10);
      html += '<div class="pm-duty-gantt-row' + (active ? ' is-active' : '') + '">' +
        '<div class="pm-duty-gantt-who">' +
          '<span class="pm-duty-avatar" aria-hidden="true">' + esc(initials(r.pm_name)) + '</span>' +
          '<span class="pm-duty-gantt-name">' + esc(r.pm_name) + '</span>' +
        '</div>' +
        '<div class="pm-duty-gantt-track">' +
          '<div class="pm-duty-gantt-today" style="left:' + nowPct + '%" title="Сегодня"></div>' +
          '<div class="pm-duty-gantt-bar' + (active ? ' active' : '') + '" style="left:' + ps + '%;width:' + w + '%" title="' +
            esc(fmtDate(r.period_start) + ' — ' + fmtDate(r.period_end)) + '"></div>' +
        '</div>' +
      '</div>';
    });
    return html + '</div>';
  }

  function openRatingDrawer(payload) {
    const r = payload && (payload.rating || payload);
    const user = (payload && payload.user) || {};
    if (!r) {
      toast('Нет данных рейтинга', 'err');
      return;
    }
    const comps = r.components || {};
    const pens = r.penalties || {};
    const bons = r.bonuses || {};
    const recs = r.recommendations || [];

    const row = (key, label) => {
      const c = comps[key] || {};
      const score = c.score != null ? c.score : 0;
      return '<div class="pm-duty-break-row">' +
        '<div class="pm-duty-break-meta"><span>' + esc(label) + '</span><strong>' + score + '</strong></div>' +
        '<div class="pm-duty-break-bar"><i style="width:' + Math.max(0, Math.min(100, score)) + '%"></i></div>' +
        '<div class="pm-duty-break-sub muted">' + esc(describeComp(key, c)) + '</div>' +
      '</div>';
    };

    function describeComp(key, c) {
      if (key === 'take') return 'Взято ' + (c.taken || 0) + ' из пула ' + (c.pool || 0);
      if (key === 'completion') return 'Закрыто ' + (c.done || 0) + ' из взятых ' + (c.taken || 0);
      if (key === 'speed') {
        return c.median_hours != null
          ? ('Медиана ' + c.median_hours + ' ч · цель ' + (c.target_hours || 24) + ' ч')
          : 'Мало закрытий для медианы';
      }
      if (key === 'discipline') return 'Отказы с причиной ' + (c.reject_with_preset || 0) + '/' + (c.reject_total || 0);
      if (key === 'collab') return 'Активных привлечений ' + (c.active || 0) + ' / норма ' + (c.norm || 3);
      return '';
    }

    const penLines = [];
    if (pens.overdue && pens.overdue.points) penLines.push('Просрочки: −' + pens.overdue.points + ' (' + (pens.overdue.count || 0) + ')');
    if (pens.abandoned && pens.abandoned.points) penLines.push('Брошенные: −' + pens.abandoned.points + ' (' + (pens.abandoned.count || 0) + ')');
    if (pens.reject_no_preset && pens.reject_no_preset.points) penLines.push('Отказ без пресета: −' + pens.reject_no_preset.points);
    if (pens.registry_cancel && pens.registry_cancel.points) penLines.push('Хаотичная отмена: −' + pens.registry_cancel.points);

    const html =
      '<div class="pm-duty-drawer">' +
        '<div class="pm-duty-drawer-head">' +
          '<div class="' + gradeClass(r.grade) + '">' + esc(r.grade || '—') + '</div>' +
          '<div>' +
            '<div class="pm-duty-drawer-score">' + esc(String(r.score != null ? r.score : '—')) + '<small>/100</small></div>' +
            '<div class="muted">' + esc(user.name || 'РП') + ' · окно ' + esc(r.window_kind || '') +
              (r.period_start ? (' · ' + fmtDate(r.period_start) + '–' + fmtDate(r.period_end)) : '') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="pm-duty-break-list">' +
          row('take', 'Покрытие очереди') +
          row('completion', 'Закрытие анализа') +
          row('speed', 'Скорость') +
          row('discipline', 'Дисциплина') +
          row('collab', 'Коллаборация') +
        '</div>' +
        (penLines.length
          ? '<div class="pm-duty-drawer-block"><h4>Штрафы хаоса</h4><ul>' + penLines.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>'
          : '') +
        (bons.collab_active && bons.collab_active.points
          ? '<div class="pm-duty-drawer-block"><h4>Бонусы</h4><p>Привлечение коллег: +' + esc(String(bons.collab_active.points)) + '</p></div>'
          : '') +
        '<div class="pm-duty-drawer-block"><h4>Рекомендации</h4><ul class="pm-duty-recs">' +
          (recs.length ? recs.map((x) => '<li>' + esc(x) + '</li>').join('') : '<li class="muted">Нет рекомендаций</li>') +
        '</ul></div>' +
      '</div>';

    showModal({
      title: 'Эффективность анализа',
      wide: true,
      html: html
    });
  }

  async function render({ layout, title, query }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;
    if (!userCan(user, ALLOWED)) {
      toast('Нет доступа', 'err');
      location.hash = '#/home';
      return;
    }

    const canAssign = userCan(user, ASSIGN);
    const canLeaderboard = userCan(user, LEADERBOARD);

    let tab = (query && query.tab) || parseHashTab();
    let items = [];
    let roster = [];
    let duty = null;
    let isDuty = false;
    let banner = null;
    let queueMode = 'duty';
    let pms = [];
    let form = { pm_user_id: '', period_start: '', period_end: '' };
    let editId = null;
    let myRating = null;
    let dutyRating = null;
    let leaderboard = [];
    let lbWindow = 'd30';

    async function loadQueue() {
      if (tab === 'norms') {
        items = [];
        banner = null;
        queueMode = 'duty';
        return;
      }
      const d = await API.loadPmDutyQueue(tab);
      items = d.items || [];
      banner = d.banner;
      duty = d.duty;
      isDuty = !!d.is_duty;
      queueMode = d.queue_mode || (isDuty ? 'duty' : 'preview');
    }

    async function loadRoster() {
      const d = await API.loadPmDutyRoster(50);
      roster = d.items || [];
    }

    async function loadCurrent() {
      const d = await API.loadPmDutyCurrent();
      duty = d.duty || duty;
      if (d.is_duty != null) isDuty = !!d.is_duty;
      else if (duty && duty.pm_user_id) isDuty = Number(duty.pm_user_id) === Number(user.id);
    }

    async function loadRatings() {
      try {
        const meDuty = await API.loadPmDutyRatingMe('duty');
        dutyRating = meDuty.rating || null;
      } catch (_) { dutyRating = null; }
      try {
        const me30 = await API.loadPmDutyRatingMe('d30');
        myRating = me30.rating || null;
      } catch (_) { myRating = null; }
      if (canLeaderboard) {
        try {
          const lb = await API.loadPmDutyLeaderboard(lbWindow === 'd90' ? '90' : '30', 12);
          leaderboard = lb.items || [];
        } catch (_) { leaderboard = []; }
      }
    }

    function queueKpis() {
      const today = isoDate();
      let overdue = 0;
      let hot = 0;
      let drafts = 0;
      items.forEach((row) => {
        const d = row.docs_deadline ? String(row.docs_deadline).slice(0, 10) : '';
        if (d && d < today) overdue += 1;
        else if (d && d <= addDays(today, 3)) hot += 1;
        if (row.review_id && !row.analysis_finalized_at && !row.is_final) drafts += 1;
      });
      return { total: items.length, overdue, hot, drafts };
    }

    function renderHero() {
      const rating = isDuty ? (dutyRating || myRating) : (myRating || dutyRating);
      const progress = duty ? periodProgress(duty.period_start, duty.period_end) : null;
      const kpis = tab === 'norms' ? null : queueKpis();
      const who = duty && duty.pm_name
        ? ('<strong>' + esc(duty.pm_name) + '</strong>')
        : '<span class="muted">не назначен</span>';
      const ratingWindowLabel = isDuty ? 'смены' : '30 дней';
      const topRec = rating && rating.recommendations && rating.recommendations[0]
        ? rating.recommendations[0]
        : '';

      const badge = rating
        ? ('<button type="button" class="pm-duty-rating-badge" id="pmDutyRatingBadge" title="Расшифровка эффективности">' +
            '<div class="pm-duty-rating-visual">' +
              ratingRingSvg(rating.score, rating.grade) +
              '<div class="pm-duty-rating-core">' +
                '<span class="' + gradeClass(rating.grade) + '">' + esc(rating.grade) + '</span>' +
                '<span class="pm-duty-rating-score">' + esc(String(rating.score)) + '</span>' +
              '</div>' +
            '</div>' +
            '<span class="pm-duty-rating-label">рейтинг · ' + ratingWindowLabel + '</span>' +
            (topRec ? '<span class="pm-duty-rating-tip">' + esc(topRec) + '</span>' : '') +
            '<span class="pm-duty-rating-cta">подробнее</span></button>')
        : '<div class="pm-duty-rating-badge is-empty"><span class="pm-duty-rating-score">—</span><span class="pm-duty-rating-label">рейтинг появится после расчёта</span></div>';

      return '<section class="pm-duty-hero' + (isDuty ? ' is-you' : '') + '">' +
        '<div class="pm-duty-hero-glow" aria-hidden="true"></div>' +
        '<div class="pm-duty-hero-main">' +
          '<div class="pm-duty-hero-kicker">Дежурство РП · быстрый анализ</div>' +
          '<div class="pm-duty-hero-title">Дежурный: ' + who +
            (isDuty ? ' <span class="pm-duty-chip pm-duty-chip--you">это вы</span>' : '') +
          '</div>' +
          (duty && duty.period_start
            ? ('<div class="pm-duty-hero-period">' +
                '<span>' + esc(fmtDate(duty.period_start)) + ' — ' + esc(fmtDate(duty.period_end)) + '</span>' +
                (progress != null
                  ? ('<div class="pm-duty-progress-wrap"><span class="pm-duty-progress-label">' + progress + '% периода</span>' +
                      '<div class="pm-duty-progress" aria-label="Прогресс периода"><i style="width:' + progress + '%"></i></div></div>')
                  : '') +
              '</div>')
            : '<div class="pm-duty-hero-period muted">Нет активного периода в графике</div>') +
          (kpis
            ? ('<div class="pm-duty-kpi-strip">' +
                '<div class="pm-duty-kpi"><b>' + kpis.total + '</b><span>в списке</span></div>' +
                '<div class="pm-duty-kpi"><b>' + kpis.drafts + '</b><span>черновики</span></div>' +
                '<div class="pm-duty-kpi' + (kpis.hot ? ' is-hot' : '') + '"><b>' + kpis.hot + '</b><span>горят</span></div>' +
                '<div class="pm-duty-kpi' + (kpis.overdue ? ' is-over' : '') + '"><b>' + kpis.overdue + '</b><span>просрочено</span></div>' +
              '</div>')
            : '') +
        '</div>' +
        '<div class="pm-duty-hero-side">' + badge + '</div>' +
      '</section>';
    }

    function renderTabs() {
      return '<div class="pm-duty-tabs-wrap">' +
        '<div class="pm-duty-tabs" role="tablist">' +
        QUEUE_TABS.map((t) =>
          '<button type="button" role="tab" class="pm-duty-tab' + (tab === t.id ? ' is-active' : '') +
            '" data-tab="' + t.id + '" aria-selected="' + (tab === t.id ? 'true' : 'false') + '">' +
            esc(t.label) +
            (t.id === 'analysis' && items.length ? '<em>' + items.length + '</em>' : '') +
          '</button>'
        ).join('') +
        '</div>' +
        '<p class="pm-duty-tab-hint muted">' + esc(tabHint(tab)) + '</p></div>';
    }

    function renderQueue() {
      if (!items.length) {
        const emptyTitle = tab === 'analysis' && !isDuty
          ? 'Очередь анализа пуста'
          : 'Пока пусто';
        const emptyBody = (banner && banner.message)
          ? banner.message
          : (tab === 'analysis'
            ? 'Когда появятся тендеры в «рассмотрение», они будут здесь с дедлайнами и статусом.'
            : 'В этой вкладке пока нет записей.');
        return '<div class="pm-duty-empty">' +
          '<div class="pm-duty-empty-icon" aria-hidden="true">◇</div>' +
          '<h4>' + esc(emptyTitle) + '</h4>' +
          '<p>' + esc(emptyBody) + '</p>' +
        '</div>';
      }

      const previewCount = items.filter((x) => x.preview || x.queue_mode === 'preview').length;
      const liveBar = tab === 'analysis' && !isDuty
        ? ('<div class="pm-duty-livebar">' +
            '<span class="pm-duty-live-dot" aria-hidden="true"></span>' +
            '<strong>' + items.length + '</strong> в очереди анализа' +
            (previewCount ? (' · <span class="muted">' + previewCount + ' просмотр</span>') : '') +
            (queueMode.indexOf('oversight') >= 0 ? ' · <span class="pm-duty-live-tag">обзор ТО</span>' : '') +
          '</div>')
        : (tab === 'analysis' && isDuty
          ? ('<div class="pm-duty-livebar is-duty">' +
              '<span class="pm-duty-live-dot" aria-hidden="true"></span>' +
              '<strong>' + items.length + '</strong> на вас как на дежурного' +
            '</div>')
          : '');

      return liveBar + '<div class="pm-duty-queue">' + items.map((row, idx) => {
        const st = queueStatusLabel(row);
        const isPreview = !!(row.preview || row.queue_mode === 'preview') && row.can_report !== true;
        const canReport = (typeof row.can_report === 'boolean')
          ? row.can_report
          : (((tab === 'analysis' || tab === 'calc') && !row.is_final)
            || (tab === 'mine' && !!row.can_edit));
        const canOpen = tab === 'archive' || (tab === 'mine' && !row.can_edit)
          || (isPreview && tab === 'analysis')
          || (tab === 'analysis' && !canReport);
        const src = queueSourceLabel(row, tab);
        const tone = deadlineTone(row.docs_deadline);
        let actionBtn = '';
        if (canReport && !isPreview) {
          actionBtn = '<button type="button" class="btn mini duty-report" data-id="' + row.id + '">Отчёт</button>';
        } else if (canOpen || isPreview) {
          actionBtn = '<button type="button" class="btn mini ghost duty-report" data-id="' + row.id + '" data-preview="' + (isPreview ? '1' : '0') + '">' +
            (isPreview ? 'Смотреть' : 'Открыть') + '</button>';
        }
        const pillCls = row.is_final ? ' ok' : (st === 'Черновик' ? ' warn' : '');
        return '<article class="pm-duty-row ' + tone.cls + (isPreview ? ' is-preview' : '') + '" style="--i:' + idx + '">' +
          '<div class="pm-duty-row-id">#' + row.id + '</div>' +
          '<div class="pm-duty-row-main">' +
            '<div class="pm-duty-row-title">' + esc(row.customer_name || '—') +
              (isPreview ? ' <span class="pm-duty-preview-tag">просмотр</span>' : '') +
              (row.deadline_hot ? ' <span class="pm-duty-hot-tag">дедлайн ≤2д</span>' : '') +
              (row.stale_idle && !row.deadline_hot ? ' <span class="pm-duty-stale-tag">без движения 24ч+</span>' : '') +
            '</div>' +
            '<div class="pm-duty-row-sub muted">' + esc(row.tender_title || '') + '</div>' +
            '<div class="pm-duty-row-meta">' +
              '<span class="pm-duty-dl ' + tone.cls + '">' + esc(fmtDate(row.docs_deadline)) + ' · ' + esc(tone.label) + '</span>' +
              '<span class="muted">' + esc(src) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="pm-duty-row-status"><span class="pill' + pillCls + '">' + esc(st) + '</span></div>' +
          '<div class="pm-duty-row-act">' + actionBtn + '</div>' +
        '</article>';
      }).join('') + '</div>';
    }

    function renderAssignAndRoster() {
      if (tab === 'norms') return '';

      if (!canAssign) {
        if (!roster.length) return '';
        return '<section class="pm-duty-roster-panel is-readonly" id="pm-duty-roster">' +
          '<div class="pm-duty-section-head"><h3>График дежурств</h3>' +
            '<span class="muted">ближайшие периоды</span></div>' +
          renderDutyGantt(roster) +
        '</section>';
      }

      const presetBtns =
        '<div class="pm-duty-presets">' +
        '<button type="button" class="btn mini ghost" data-preset="today6">Сегодня+6</button>' +
        '<button type="button" class="btn mini ghost" data-preset="thisWeek">Пн–Пт</button>' +
        '<button type="button" class="btn mini ghost" data-preset="nextWeek">След. неделя</button></div>';

      return '<section class="pm-duty-roster-panel" id="pm-duty-roster">' +
        '<div class="pm-duty-section-head"><h3>График дежурств</h3>' +
          '<span class="muted">назначение и лента периодов</span></div>' +
        '<div class="pm-duty-assign">' +
          '<h4>' + (editId ? 'Редактировать период' : 'Назначить дежурного') + '</h4>' +
          presetBtns +
          '<div class="pm-duty-assign-form">' +
            '<label>РП<select class="inp" id="dutyPm"><option value="">—</option>' +
              pms.map((p) => '<option value="' + p.id + '"' + (String(form.pm_user_id) === String(p.id) ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
            '</select></label>' +
            '<label>С<input type="date" class="inp" id="dutyStart" value="' + esc(form.period_start) + '"/></label>' +
            '<label>По<input type="date" class="inp" id="dutyEnd" value="' + esc(form.period_end) + '"/></label>' +
            '<button type="button" class="btn mini" id="dutyAssign">' + (editId ? 'Сохранить' : 'Назначить') + '</button>' +
            (editId ? '<button type="button" class="btn mini ghost" id="dutyCancelEdit">Отмена</button>' : '') +
          '</div>' +
        '</div>' +
        renderDutyGantt(roster) +
        '<div class="pm-duty-roster-table-wrap"><table class="tnd-table asg pm-duty-roster-table"><thead><tr>' +
          '<th>РП</th><th>С</th><th>По</th><th>Назначил</th><th></th></tr></thead><tbody>' +
          roster.map((r) => '<tr' + (editId === r.id ? ' class="is-editing"' : '') + '><td>' + esc(r.pm_name) + '</td><td>' +
            fmtDate(r.period_start) + '</td><td>' + fmtDate(r.period_end) + '</td><td>' + esc(r.assigned_by_name || '—') + '</td>' +
            '<td class="pm-duty-roster-acts"><button type="button" class="btn mini ghost duty-edit" data-id="' + r.id + '">Изменить</button> ' +
            '<button type="button" class="btn mini ghost duty-del" data-id="' + r.id + '">Удалить</button></td></tr>').join('') +
          '</tbody></table>' +
          (roster.length ? '' : '<p class="muted">Нет записей</p>') +
        '</div></section>';
    }

    function renderLeaderboard() {
      if (!canLeaderboard || tab === 'norms') return '';
      return '<section class="pm-duty-lb-panel">' +
        '<div class="pm-duty-section-head"><h3>Рейтинг РП</h3>' +
          '<div class="pm-duty-lb-switch">' +
            '<button type="button" class="btn mini' + (lbWindow === 'd30' ? '' : ' ghost') + '" data-lb="d30">30 дней</button>' +
            '<button type="button" class="btn mini' + (lbWindow === 'd90' ? '' : ' ghost') + '" data-lb="d90">90 дней</button>' +
          '</div></div>' +
        (leaderboard.length
          ? ('<ol class="pm-duty-lb">' + leaderboard.map((row, idx) =>
              '<li class="pm-duty-lb-item" style="--i:' + idx + '" data-user-id="' + row.user_id + '">' +
                '<span class="pm-duty-lb-rank">' + (row.rank || '') + '</span>' +
                '<span class="pm-duty-avatar">' + esc(initials(row.pm_name)) + '</span>' +
                '<span class="pm-duty-lb-name">' + esc(row.pm_name || ('#' + row.user_id)) + '</span>' +
                '<span class="' + gradeClass(row.grade) + '">' + esc(row.grade) + '</span>' +
                '<span class="pm-duty-lb-score">' + esc(String(row.score)) + '</span>' +
              '</li>').join('') + '</ol>')
          : '<p class="muted">Пока нет снапшотов рейтинга — появятся после суточного пересчёта или первого открытия.</p>') +
      '</section>';
    }

    function renderPage() {
      let bannerHtml = '';
      const showBannerAbove = items.length > 0 || tab === 'norms';
      if (showBannerAbove && banner && banner.message) {
        bannerHtml = '<div class="pm-duty-banner warn">' + esc(banner.message) + '</div>';
      } else if (showBannerAbove && !isDuty && tab === 'analysis') {
        bannerHtml = '<div class="pm-duty-banner">Вы не дежурный.' +
          (duty && duty.pm_name ? ' Сейчас: ' + esc(duty.pm_name) + '.' : '') +
          ' Обратитесь к TO / рук. ТО.</div>';
      }

      const body = tab === 'norms'
        ? '<div id="workNormsRoot" class="pm-duty-norms" style="min-height:520px"></div>'
        : (bannerHtml + renderQueue());

      return '<div class="pm-duty-page">' +
        renderHero() +
        renderAssignAndRoster() +
        renderLeaderboard() +
        '<section class="pm-duty-queue-panel">' +
          renderTabs() +
          body +
        '</section>' +
        '</div>';
    }

    async function refreshUI() {
      await Promise.all([
        loadQueue(),
        loadCurrent(),
        tab !== 'norms' ? loadRoster() : Promise.resolve(),
        loadRatings()
      ]);
      await layout(renderPage(), { title: title || 'Просчёты РП' });
      bindEvents();
      if (tab === 'norms' && window.AsgardWorkNormsUi) {
        const el = document.getElementById('workNormsRoot');
        if (el) {
          AsgardWorkNormsUi.mount({
            mountEl: el,
            canWrite: userCan(user, WRITE_NORMS)
          });
        }
      }
    }

    function bindEvents() {
      document.querySelectorAll('[data-tab]').forEach((b) => {
        b.addEventListener('click', () => {
          tab = b.dataset.tab;
          location.hash = '#/pm-calculations?tab=' + tab;
          refreshUI();
        });
      });
      document.querySelectorAll('[data-preset]').forEach((b) => {
        b.addEventListener('click', () => {
          const p = weekPreset(b.dataset.preset);
          form.period_start = p.start;
          form.period_end = p.end;
          const s = document.getElementById('dutyStart');
          const e = document.getElementById('dutyEnd');
          if (s) s.value = p.start;
          if (e) e.value = p.end;
        });
      });
      document.querySelectorAll('[data-lb]').forEach((b) => {
        b.addEventListener('click', async () => {
          lbWindow = b.dataset.lb === 'd90' ? 'd90' : 'd30';
          await loadRatings();
          await layout(renderPage(), { title: title || 'Просчёты РП' });
          bindEvents();
        });
      });
      document.getElementById('pmDutyRatingBadge')?.addEventListener('click', async () => {
        const uid = user.id;
        const win = isDuty ? 'duty' : 'd30';
        try {
          const d = await API.loadPmDutyRatingBreakdown(uid, win);
          openRatingDrawer(d);
        } catch (e) {
          openRatingDrawer({ rating: (isDuty ? dutyRating : myRating) || dutyRating || myRating, user: { name: user.name } });
        }
      });
      document.querySelectorAll('.pm-duty-lb-item').forEach((el) => {
        el.addEventListener('click', async () => {
          const uid = el.dataset.userId;
          try {
            const d = await API.loadPmDutyRatingBreakdown(uid, lbWindow);
            openRatingDrawer(d);
          } catch (e) {
            toast(e.message || 'Не удалось открыть расшифровку', 'err');
          }
        });
      });
      document.getElementById('dutyAssign')?.addEventListener('click', async () => {
        form.pm_user_id = document.getElementById('dutyPm')?.value;
        form.period_start = document.getElementById('dutyStart')?.value;
        form.period_end = document.getElementById('dutyEnd')?.value;
        if (!form.pm_user_id || !form.period_start || !form.period_end) {
          toast('Заполните все поля', 'err');
          return;
        }
        try {
          if (editId) {
            await API.updatePmDutyRoster(editId, {
              pm_user_id: Number(form.pm_user_id),
              period_start: form.period_start,
              period_end: form.period_end
            });
            toast('Период обновлён', 'ok');
          } else {
            await API.savePmDutyRoster({
              pm_user_id: Number(form.pm_user_id),
              period_start: form.period_start,
              period_end: form.period_end
            });
            toast('Дежурный назначен', 'ok');
          }
          editId = null;
          form = { pm_user_id: '', period_start: '', period_end: '' };
          refreshUI();
        } catch (e) {
          toast(e.message || 'Ошибка назначения', 'err');
        }
      });
      document.getElementById('dutyCancelEdit')?.addEventListener('click', () => {
        editId = null;
        form = { pm_user_id: '', period_start: '', period_end: '' };
        refreshUI();
      });
      document.querySelectorAll('.duty-edit').forEach((btn) => {
        btn.addEventListener('click', () => {
          const r = roster.find((x) => String(x.id) === btn.dataset.id);
          if (!r) return;
          editId = r.id;
          form = {
            pm_user_id: r.pm_user_id,
            period_start: String(r.period_start).slice(0, 10),
            period_end: String(r.period_end).slice(0, 10)
          };
          refreshUI();
        });
      });
      document.querySelectorAll('.duty-del').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!confirm('Удалить период дежурства?')) return;
          API.deletePmDutyRoster(btn.dataset.id).then(() => {
            toast('Удалено', 'ok');
            refreshUI();
          }).catch((e) => toast(e.message, 'err'));
        });
      });
      document.querySelectorAll('.duty-report').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = items.find((x) => String(x.id) === btn.dataset.id);
          if (!row) return;
          const analysisClosed = !!row.analysis_finalized_at;
          const isPreview = btn.dataset.preview === '1' || !!(row.preview && !row.can_report);
          let readOnly = tab === 'archive' || !!row.is_final
            || (tab === 'mine' && analysisClosed)
            || isPreview;
          const mode = (tab === 'calc' || row.phase === 'calc' || analysisClosed) ? 'calc' : 'analysis';
          const opts = { readOnly, mode };
          try {
            const u = JSON.parse(localStorage.getItem('asgard_user') || '{}');
            const r = u.role || '';
            const dirs = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
            if (dirs.includes(r)) {
              opts.role = 'viewer';
              opts.readOnly = true;
            } else if (r === 'HEAD_TO') {
              opts.readOnly = true;
              opts.role = row.is_final ? 'to' : 'viewer';
            } else if (tab === 'mine' && analysisClosed) {
              opts.readOnly = true;
              opts.role = 'viewer';
            } else if (isPreview) {
              opts.role = 'viewer';
              opts.readOnly = true;
            }
          } catch (_) { /* ignore */ }
          if (mode === 'calc' && window.AsgardRpCalcModal) {
            AsgardRpCalcModal.open(row, pms, refreshUI, opts);
          } else if (window.AsgardRpReviewModal) {
            AsgardRpReviewModal.open(row, pms, refreshUI, opts);
          }
        });
      });
    }

    pms = await API.loadUsers('PM,HEAD_PM');
    await refreshUI();
  }

  /** Модалка графика дежурств — для ТО из реестра и др. */
  async function openRosterModal(onSaved) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) return;
    const user = auth.user;
    if (!userCan(user, ASSIGN)) {
      toast('Нет прав на график дежурств', 'err');
      return;
    }

    let roster = [];
    let duty = null;
    let pms = [];
    let form = { pm_user_id: '', period_start: '', period_end: '' };
    let editId = null;

    async function reload() {
      const [r, d] = await Promise.all([API.loadPmDutyRoster(50), API.loadPmDutyCurrent()]);
      roster = r.items || [];
      duty = d.duty || d;
    }

    function paint() {
      const presetBtns =
        '<div class="pm-duty-presets">' +
        '<button type="button" class="btn mini ghost" data-preset="today6">Сегодня+6</button>' +
        '<button type="button" class="btn mini ghost" data-preset="thisWeek">Пн–Пт</button>' +
        '<button type="button" class="btn mini ghost" data-preset="nextWeek">След. неделя</button></div>';
      const body =
        '<div class="pm-duty-modal-shell">' +
        (duty && duty.pm_name
          ? '<p class="pm-duty-modal-current">Текущий: <strong>' + esc(duty.pm_name) + '</strong> · ' +
            fmtDate(duty.period_start) + ' — ' + fmtDate(duty.period_end) + '</p>'
          : '') +
        '<div class="pm-duty-assign"><h4>Назначить</h4>' + presetBtns +
        '<div class="pm-duty-assign-form">' +
        '<label>РП<select class="inp" id="dutyPmModal"><option value="">—</option>' +
        pms.map((p) => '<option value="' + p.id + '"' + (String(form.pm_user_id) === String(p.id) ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
        '</select></label>' +
        '<label>С<input type="date" class="inp" id="dutyStartModal" value="' + esc(form.period_start) + '"/></label>' +
        '<label>По<input type="date" class="inp" id="dutyEndModal" value="' + esc(form.period_end) + '"/></label>' +
        '<button type="button" class="btn mini" id="dutyAssignModal">' + (editId ? 'Сохранить' : 'Назначить') + '</button>' +
        (editId ? '<button type="button" class="btn mini ghost" id="dutyCancelEditModal">Отмена</button>' : '') +
        '</div></div>' +
        renderDutyGantt(roster) +
        '<table class="tnd-table asg pm-duty-roster-table"><thead><tr><th>РП</th><th>С</th><th>По</th><th>Назначил</th><th></th></tr></thead><tbody>' +
        roster.map((r) => '<tr><td>' + esc(r.pm_name) + '</td><td>' + fmtDate(r.period_start) + '</td><td>' + fmtDate(r.period_end) + '</td><td>' + esc(r.assigned_by_name || '—') + '</td>' +
        '<td><button type="button" class="btn mini ghost duty-edit-modal" data-id="' + r.id + '">Изменить</button> ' +
        '<button type="button" class="btn mini ghost duty-del-modal" data-id="' + r.id + '">Удалить</button></td></tr>').join('') +
        '</tbody></table></div>';
      const host = document.getElementById('pmDutyRosterBody');
      if (host) host.innerHTML = body;
      bindModal();
    }

    function bindModal() {
      document.querySelectorAll('#pmDutyRosterBody [data-preset]').forEach((b) => {
        b.onclick = () => {
          const p = weekPreset(b.dataset.preset);
          form.period_start = p.start;
          form.period_end = p.end;
          const s = document.getElementById('dutyStartModal');
          const e = document.getElementById('dutyEndModal');
          if (s) s.value = p.start;
          if (e) e.value = p.end;
        };
      });
      const assignBtn = document.getElementById('dutyAssignModal');
      if (assignBtn) assignBtn.onclick = async () => {
        form.pm_user_id = document.getElementById('dutyPmModal')?.value;
        form.period_start = document.getElementById('dutyStartModal')?.value;
        form.period_end = document.getElementById('dutyEndModal')?.value;
        if (!form.pm_user_id || !form.period_start || !form.period_end) {
          toast('Заполните все поля', 'err');
          return;
        }
        try {
          if (editId) {
            await API.updatePmDutyRoster(editId, {
              pm_user_id: Number(form.pm_user_id),
              period_start: form.period_start,
              period_end: form.period_end
            });
            toast('Период обновлён', 'ok');
          } else {
            await API.savePmDutyRoster({
              pm_user_id: Number(form.pm_user_id),
              period_start: form.period_start,
              period_end: form.period_end
            });
            toast('Дежурный назначен', 'ok');
          }
          editId = null;
          form = { pm_user_id: '', period_start: '', period_end: '' };
          await reload();
          paint();
          onSaved && onSaved();
        } catch (e) {
          toast(e.message || 'Ошибка назначения', 'err');
        }
      };
      const cancelEditBtn = document.getElementById('dutyCancelEditModal');
      if (cancelEditBtn) cancelEditBtn.onclick = () => {
        editId = null;
        form = { pm_user_id: '', period_start: '', period_end: '' };
        paint();
      };
      document.querySelectorAll('.duty-edit-modal').forEach((btn) => {
        btn.onclick = () => {
          const r = roster.find((x) => String(x.id) === btn.dataset.id);
          if (!r) return;
          editId = r.id;
          form = {
            pm_user_id: r.pm_user_id,
            period_start: String(r.period_start).slice(0, 10),
            period_end: String(r.period_end).slice(0, 10)
          };
          paint();
        };
      });
      document.querySelectorAll('.duty-del-modal').forEach((btn) => {
        btn.onclick = () => {
          if (!confirm('Удалить период дежурства?')) return;
          API.deletePmDutyRoster(btn.dataset.id).then(async () => {
            toast('Удалено', 'ok');
            await reload();
            paint();
            onSaved && onSaved();
          }).catch((e) => toast(e.message, 'err'));
        };
      });
    }

    pms = await API.loadUsers('PM,HEAD_PM');
    await reload();
    showModal({
      title: 'График дежурств РП',
      wide: true,
      html: '<div id="pmDutyRosterBody" class="pm-duty-modal-shell"><p class="muted">Загрузка…</p></div>',
      onMount: () => paint()
    });
  }

  return { render, openRosterModal, openRatingDrawer };
})();
