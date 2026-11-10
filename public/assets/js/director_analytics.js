/**
 * ASGARD CRM — Пульс директора (Jarl Pulse)
 * Обзор: 3 бизнес-секции + Команда и часы → реестр → модалка с вкладками.
 * Роли: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV.
 * UI-паритет: prototypes/director-analytics (v8).
 */
window.AsgardDirectorAnalyticsPage = (function () {
  const { esc, toast } = AsgardUI;
  const ALLOWED = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const API = '/api/director-analytics';
  const PAGE_SIZE = 25;

  const PERIODS = [
    { id: 'month', label: 'Месяц' },
    { id: 'half_year', label: 'Полгода' },
    { id: 'year', label: 'Год' },
    { id: 'all', label: 'Всё время' }
  ];

  /* Локальный фильтр «Графика офиса» — не связан с чипами периода выше. */
  const TEAM_SCOPES = [
    { id: 'week', label: 'Неделя' },
    { id: 'month', label: 'Месяц' },
    { id: 'year', label: 'Год' }
  ];

  const TENDER_STATUSES = [
    { id: 'рассмотрение', label: 'Рассмотрение', tone: 'info' },
    { id: 'готовим', label: 'Готовим', tone: 'blue' },
    { id: 'подались', label: 'Подались', tone: 'warn' },
    { id: 'выиграли', label: 'Выиграли', tone: 'ok' },
    { id: 'проиграли', label: 'Проиграли', tone: 'err' },
    { id: 'отмена', label: 'Отмена', tone: 'muted' }
  ];

  /* 11 статусов канбана V3 — как в proto mock-data.js */
  const APP_STATUSES = [
    { id: 'new', label: 'Новые', tone: 'warn' },
    { id: 'calc', label: 'Просчёт', tone: 'blue' },
    { id: 'approval', label: 'Согласование', tone: 'info' },
    { id: 'kp_prep', label: 'КП готов', tone: 'blue' },
    { id: 'sent', label: 'КП ушло', tone: 'info' },
    { id: 'addendum', label: 'Дозапрос', tone: 'warn' },
    { id: 'win', label: 'Выиграно', tone: 'ok' },
    { id: 'lose', label: 'Проиграно', tone: 'err' },
    { id: 'work', label: 'В работе', tone: 'ok' },
    { id: 'done', label: 'Завершено', tone: 'ok' },
    { id: 'trash', label: 'Корзина', tone: 'muted' }
  ];

  const WORK_STATUSES = [
    { id: 'active', label: 'Активные', tone: 'ok' },
    { id: 'pause', label: 'На паузе', tone: 'warn' },
    { id: 'archive', label: 'Архив', tone: 'muted' }
  ];

  const APP_TONE = Object.fromEntries(APP_STATUSES.map((s) => [s.id, s.tone]));
  APP_TONE.in_review = 'info';
  APP_TONE.need_docs = 'blue';
  APP_TONE.pending_approval = 'info';
  APP_TONE.approved = 'ok';
  APP_TONE.accepted = 'ok';
  APP_TONE.rejected = 'err';
  APP_TONE.expired = 'muted';
  APP_TONE.pending_payment = 'gold';
  APP_TONE.paid = 'ok';
  APP_TONE.marketplace = 'gold';

  const CHANNELS = {
    email: 'Почта', phone: 'Телефония', manual: 'Вручную',
    etp: 'Площадка', site: 'Сайт'
  };

  const TENDER_TABS = [
    { id: 'summary', label: 'Сводка' },
    { id: 'analysis', label: 'Анализ' },
    { id: 'calc', label: 'Просчёт РП' },
    { id: 'estimate', label: 'Смета' },
    { id: 'checklist', label: 'Чек-лист' },
    { id: 'report', label: 'Отчёт РП' },
    { id: 'docs', label: 'Документы' }
  ];
  const APP_TABS = [
    { id: 'summary', label: 'Сводка' },
    { id: 'estimate', label: 'Просчёт' },
    { id: 'history', label: 'История' },
    { id: 'docs', label: 'Документы' }
  ];
  const WORK_TABS = [
    { id: 'summary', label: 'Сводка' },
    { id: 'finance', label: 'Финансы' },
    { id: 'timesheet', label: 'Табель' },
    { id: 'brigade', label: 'Бригада' },
    { id: 'checkins', label: 'Чекины' }
  ];

  let _layout = null;
  let _user = null;
  let _bound = false;
  let _clockTimer = null;
  let _loadSeq = 0;
  let _listSeq = 0;

  const state = {
    period: 'month',
    view: 'overview',
    listSection: null,
    listStatus: 'all',
    listQuery: '',
    listSort: 'deadline',
    listPage: 1,
    modal: null,
    tab: null,
    overview: null,
    tendersByStatus: [],
    appsByStatus: [],
    worksItems: [],
    worksCounts: { active: 0, pause: 0, archive: 0 },
    tendersItems: [],
    appsItems: [],
    listItems: [],
    team: null,
    teamAnchor: null,
    teamScope: 'month',
    teamLoading: false,
    showAllAttention: false,
    detail: null,
    loading: false,
    sheetLoading: false
  };

  /* ── Утилиты ──────────────────────────────────────────────────────────── */
  function money(v) {
    if (v == null || v === '' || Number.isNaN(Number(v))) return '—';
    const fn = (AsgardUI && AsgardUI.moneyRub) || (window.AsgardMoney && AsgardMoney.formatMoney);
    return fn ? fn(Number(v)) : (Math.round(Number(v)).toLocaleString('ru-RU') + ' ₽');
  }

  function num(n) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0));
  }

  function rub(n) {
    if (n == null || n === '') return '—';
    return money(n);
  }

  function compact(n) {
    const v = Math.abs(Number(n) || 0);
    const sign = Number(n) < 0 ? '−' : '';
    if (v >= 1e9) return { v: sign + (v / 1e9).toFixed(2).replace('.', ','), u: 'млрд ₽' };
    if (v >= 1e6) {
      let m = (v / 1e6).toFixed(2).replace('.', ',');
      if (m.slice(-3) === ',00') m = m.slice(0, -3);
      else if (m.slice(-1) === '0') m = m.slice(0, -1);
      return { v: sign + m, u: 'млн ₽' };
    }
    if (v >= 1e3) return { v: sign + num(v), u: '₽' };
    return { v: sign + num(v), u: '₽' };
  }

  function moneyShort(n) {
    if (n == null || n === '' || !Number(n)) return '—';
    const c = compact(n);
    return c.v + ' ' + c.u;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    if (AsgardUI.formatDate) return AsgardUI.formatDate(iso);
    try {
      const s = String(iso).slice(0, 10);
      const p = s.split('-');
      if (p.length === 3) return p[2] + '.' + p[1] + '.' + p[0];
      return new Date(iso).toLocaleDateString('ru-RU');
    } catch (e) {
      return String(iso).slice(0, 10);
    }
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      return String(iso);
    }
  }

  function shortDate(isoStr) {
    if (!isoStr) return '—';
    const s = String(isoStr).slice(0, 10);
    const p = s.split('-');
    if (p.length === 3) return p[2] + '.' + p[1];
    return fmtDate(isoStr);
  }

  function isoDay(iso) {
    if (!iso) return null;
    return String(iso).slice(0, 10);
  }

  function daysLeft(isoStr) {
    const day = isoDay(isoStr);
    if (!day) return null;
    const d = new Date(day + 'T12:00:00');
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    return Math.round((d - now) / 86400000);
  }

  function deadlineText(isoStr) {
    const d = daysLeft(isoStr);
    if (d === null) return 'без срока';
    if (d === 0) return 'сегодня';
    if (d > 0) return 'через ' + d + ' дн.';
    return 'просрочен на ' + Math.abs(d) + ' дн.';
  }

  function daysWord(n) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return 'дней';
    if (b === 1) return 'день';
    if (b >= 2 && b <= 4) return 'дня';
    return 'дней';
  }

  function deadlineChip(isoStr, closed) {
    if (!isoStr) return '<span class="dl-chip">без срока</span>';
    const d = daysLeft(isoStr);
    if (closed) return '<span class="dl-chip is-muted">' + esc(shortDate(isoStr)) + '</span>';
    if (d < 0) {
      return '<span class="dl-chip is-over">просрочен ' + Math.abs(d) + ' ' + daysWord(d) + '</span>';
    }
    if (d === 0) return '<span class="dl-chip is-today">дедлайн сегодня</span>';
    if (d <= 3) {
      return '<span class="dl-chip is-soon">' + esc(shortDate(isoStr)) + ' · ' + d + ' ' + daysWord(d) + '</span>';
    }
    return '<span class="dl-chip">дедлайн ' + esc(shortDate(isoStr)) + '</span>';
  }

  function dueFlag(deadline, closed) {
    if (!deadline || closed) return '';
    const d = daysLeft(deadline);
    if (d === null) return '';
    if (d < 0) return 'over';
    if (d === 0) return 'today';
    return '';
  }

  function initials(name) {
    if (!name) return '—';
    const s = String(name).replace(/[«»"'()]/g, ' ').trim();
    const parts = s.split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }

  function pct(n) {
    const v = Number(n);
    if (!isFinite(v)) return '—';
    return (Math.round(v * 10) / 10).toLocaleString('ru-RU') + ' %';
  }

  function toneCls(t) {
    return 'tone-' + (t || 'muted');
  }

  function chev() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function chevL() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function periodLabel() {
    const p = PERIODS.find((x) => x.id === state.period);
    return p ? p.label : state.period;
  }

  function statusMeta(list, id) {
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function statusesOf(section) {
    if (section === 'tenders') return TENDER_STATUSES;
    if (section === 'applications') return APP_STATUSES;
    return WORK_STATUSES;
  }

  function itemStatusId(section, item) {
    if (section === 'tenders') return item.registry_status;
    if (section === 'applications') return item.status;
    return item.bucket || item.phase;
  }

  function itemDeadline(section, item) {
    if (section === 'tenders') return item.deadline || item.docs_deadline;
    if (section === 'applications') return item.deadline || item.work_deadline;
    return item.due || item.end_plan || item.deadline;
  }

  function itemAmount(section, item) {
    if (section === 'tenders') {
      return item.work_price != null ? item.work_price
        : (item.rp_review && item.rp_review.work_price != null ? item.rp_review.work_price : item.price) || 0;
    }
    if (section === 'applications') return item.amount != null ? item.amount : (item.estimated_sum || 0);
    return item.contract != null ? item.contract : (item.contract_value || 0);
  }

  function itemTitle(section, item) {
    if (section === 'applications') {
      return item.title || item.work_description || item.customer_name || ('Заявка #' + item.id);
    }
    return item.title || item.object_name || ('#' + item.id);
  }

  function itemCustomer(item) {
    return item.customer || item.customer_name || '—';
  }

  function isClosed(section, item) {
    if (section === 'tenders') {
      const s = item.registry_status;
      return s === 'выиграли' || s === 'проиграли' || s === 'отмена';
    }
    if (section === 'applications') {
      const s = item.status;
      return s === 'win' || s === 'lose' || s === 'trash' || s === 'done'
        || s === 'accepted' || s === 'rejected' || s === 'expired';
    }
    return (item.bucket || item.phase) === 'archive';
  }

  function findStatusMeta(section, id) {
    const list = statusesOf(section);
    const hit = statusMeta(list, id);
    if (hit) return hit;
    if (section === 'applications') {
      const row = (state.appsByStatus || []).find((s) => s.status === id || s.id === id);
      if (row) {
        return {
          id: row.status || row.id,
          label: row.label || row.status || id,
          tone: APP_TONE[row.status || row.id] || 'muted'
        };
      }
      return { id, label: id, tone: APP_TONE[id] || 'muted' };
    }
    return { id, label: id, tone: 'muted' };
  }

  async function authHeaders() {
    const token = localStorage.getItem('asgard_token') || '';
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
  }

  async function api(path) {
    const headers = await authHeaders();
    const res = await fetch(API + path, { headers });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || ('HTTP ' + res.status);
      throw new Error(msg);
    }
    return data;
  }

  function root() { return document.getElementById('jp-root'); }
  function elMain() { return document.getElementById('jpMain'); }
  function elSheet() { return document.getElementById('jpSheet'); }
  function elSheetInner() { return document.getElementById('sheetInner'); }
  function elBackdrop() { return document.getElementById('sheetBackdrop'); }

  function morphPeriodChip() {
    const host = document.getElementById('periodChips');
    if (!host) return;
    const on = host.querySelector('.jp-period-chip.is-on');
    if (!on) return;
    const hr = host.getBoundingClientRect();
    const r = on.getBoundingClientRect();
    host.style.setProperty('--morph-left', (r.left - hr.left) + 'px');
    host.style.setProperty('--morph-width', r.width + 'px');
  }

  function tickNow() {
    const node = document.getElementById('jpNow');
    if (!node) return;
    node.textContent = fmtDateTime(new Date().toISOString());
  }

  function updateSectionCounts() {
    const o = state.overview || {};
    const cTenders = document.getElementById('secCountTenders');
    const cA = document.getElementById('secCountApps');
    const cW = document.getElementById('secCountWorks');
    if (cTenders) cTenders.textContent = String((o.tenders && o.tenders.total) != null ? o.tenders.total : '—');
    if (cA) cA.textContent = String((o.applications && o.applications.total) != null ? o.applications.total : '—');
    if (cW) {
      const w = o.works || {};
      cW.textContent = String(w.total != null ? w.total : '—');
    }
    const cTeam = document.getElementById('secCountTeam');
    if (cTeam) {
      const t = state.team;
      cTeam.textContent = t && t.norm && t.norm.people_total != null ? String(t.norm.people_total) : '—';
    }
  }

  function updatePeriodHint() {
    const hint = document.getElementById('periodHint');
    if (!hint) return;
    const o = state.overview || {};
    const nT = (o.tenders && o.tenders.total) || 0;
    const nA = (o.applications && o.applications.total) || 0;
    const nW = (o.works && o.works.total) || 0;
    hint.textContent = periodLabel() + ' · ' + nT + ' тендеров · ' + nA + ' заявок · ' + nW + ' работ';
  }

  /* ── Hero / status / attention ────────────────────────────────────────── */
  function cell(cap, value, cls, meta) {
    return '<div class="hero-cell ' + (cls || '') + '">' +
      '<div class="hero-cap">' + esc(cap) + '</div>' +
      '<div class="hero-num lg">' + esc(value) + '</div>' +
      (meta ? '<div class="hero-meta">' + meta + '</div>' : '') +
      '</div>';
  }

  function cellMoney(cap, value, cls, meta) {
    const c = compact(value || 0);
    return '<div class="hero-cell ' + (cls || '') + '">' +
      '<div class="hero-cap">' + esc(cap) + '</div>' +
      '<div class="hero-num money">' + esc(c.v) + '<span class="unit">' + esc(c.u) + '</span></div>' +
      (meta ? '<div class="hero-meta">' + meta + '</div>' : '') +
      '</div>';
  }

  function heroTenders() {
    const t = (state.overview && state.overview.tenders) || {};
    const list = state.tendersItems || [];
    const total = t.total != null ? t.total : list.length;
    const nmck = t.nmck_sum != null ? t.nmck_sum
      : list.reduce((a, x) => a + Number(x.nmck || x.price || 0), 0);
    const price = t.work_price_sum != null ? t.work_price_sum
      : list.reduce((a, x) => a + Number(itemAmount('tenders', x)), 0);
    const win = t.won != null ? t.won : list.filter((x) => x.registry_status === 'выиграли').length;
    const lose = t.lost != null ? t.lost : list.filter((x) => x.registry_status === 'проиграли').length;
    const closed = win + lose;
    const conv = t.conversion != null ? t.conversion : (closed ? Math.round((win / closed) * 1000) / 10 : null);
    const inWork = list.filter((x) =>
      x.registry_status === 'рассмотрение' || x.registry_status === 'готовим' || x.registry_status === 'подались'
    ).length;

    return [
      cell('Тендеров в периоде', String(total), '', 'из них <b>' + inWork + '</b> в активной фазе'),
      cellMoney('Сумма НМЦК', nmck, '', 'по ' + total + ' процедурам'),
      cellMoney('Цена работ без НДС', price, '', 'сметы Асгард'),
      cell('Конверсия', conv == null ? '—' : conv + ' %', conv != null && conv >= 30 ? 'tone-ok' : '',
        '<b>' + win + '</b> побед из <b>' + closed + '</b> закрытых')
    ];
  }

  function heroApps() {
    const a = (state.overview && state.overview.applications) || {};
    const list = state.appsItems || [];
    const total = a.total != null ? a.total : list.length;
    const activeIds = ['calc', 'approval', 'kp_prep', 'sent', 'addendum', 'in_review', 'need_docs', 'pending_approval'];
    const active = list.filter((x) => activeIds.indexOf(x.status) >= 0);
    const activeSum = a.in_work_sum != null ? a.in_work_sum
      : active.reduce((s, x) => s + Number(itemAmount('applications', x)), 0);
    const win = list.filter((x) => x.status === 'win' || x.status === 'work' || x.status === 'done' || x.status === 'accepted');
    const winSum = a.won_sum != null ? a.won_sum
      : win.reduce((s, x) => s + Number(itemAmount('applications', x)), 0);
    const lose = list.filter((x) => x.status === 'lose' || x.status === 'rejected').length;
    const closed = win.length + lose;
    const conv = a.conversion != null ? a.conversion : (closed ? Math.round((win.length / closed) * 1000) / 10 : null);

    return [
      cell('Заявок в периоде', String(total), '', 'все статусы канбана'),
      cellMoney('В работе', activeSum, '', active.length + ' заявок в контуре'),
      cellMoney('Выиграно', winSum, 'tone-ok', win.length + ' заявок закрыто успешно'),
      cell('Конверсия', conv == null ? '—' : conv + ' %', conv != null && conv >= 40 ? 'tone-ok' : '',
        '<b>' + win.length + '</b> из <b>' + closed + '</b> решённых')
    ];
  }

  function heroWorks() {
    const w = (state.overview && state.overview.works) || {};
    const list = state.worksItems || [];
    const total = w.total != null ? w.total : list.length;
    const active = w.active != null ? w.active : (state.worksCounts.active || 0);
    const risk = w.risk_count != null ? w.risk_count
      : list.filter((x) => x.schedule_light === 'err' || x.tone === 'bad' || (x.days_left != null && x.days_left < 0)).length;
    const contract = w.contract_sum != null ? w.contract_sum
      : list.reduce((a, x) => a + Number(x.contract_value || x.contract || 0), 0);
    const withM = list.filter((x) => x.margin_pct != null);
    const avgM = w.avg_margin != null ? w.avg_margin
      : (withM.length ? withM.reduce((a, x) => a + Number(x.margin_pct), 0) / withM.length : 0);
    const paid = w.paid_sum != null ? w.paid_sum
      : list.reduce((a, x) => a + Number(x.received || x.paid || 0), 0);

    return [
      cell('Работ в периоде', String(total), '', '<b>' + active + '</b> активных · <b>' + risk + '</b> в риске'),
      cellMoney('Портфель контрактов', contract, '', 'по ' + total + ' договорам'),
      cell('Средняя маржа', Math.round(avgM * 10) / 10 + ' %', avgM >= 18 ? 'tone-ok' : 'tone-gold',
        moneyShort(contract - paid) + ' к оплате'),
      cellMoney('Оплачено', paid, '', 'остаток ' + moneyShort(Math.max(0, contract - paid)))
    ];
  }

  function statusRow(section, st, count, sum, metaHtml) {
    const n = Number(count || 0);
    const sumCap = section === 'applications' && st.id === 'trash' ? 'сумма не считается' : 'сумма';
    const moneyLabel = n ? moneyShort(sum) : '—';
    return '<button type="button" class="status-card ' + toneCls(st.tone) + '"' +
      ' data-status="' + esc(st.id) + '" data-section="' + section + '">' +
      '<span class="sc-bar"></span>' +
      '<span class="sc-top">' +
        '<span class="sc-name"><span class="sc-dot"></span>' + esc(st.label) + '</span>' +
        '<span class="sc-count' + (n ? '' : ' zero') + '">' + n + '</span>' +
      '</span>' +
      '<span class="sc-money">' + esc(moneyLabel) + '<span class="sc-money-cap">' + esc(sumCap) + '</span></span>' +
      '<span class="sc-meta">' + (metaHtml || (n ? n + ' карточек' : 'нет карточек за период')) + '</span>' +
      '<span class="sc-go" aria-hidden="true">' + chev() + '</span>' +
    '</button>';
  }

  function statusCards(section) {
    if (section === 'tenders') {
      const map = Object.fromEntries((state.tendersByStatus || []).map((r) => [r.status, r]));
      return TENDER_STATUSES.map((st) => {
        const row = map[st.id] || {};
        const items = (state.tendersItems || []).filter((x) => x.registry_status === st.id);
        const near = items.slice().sort((a, b) =>
          new Date(itemDeadline('tenders', a) || 0) - new Date(itemDeadline('tenders', b) || 0)
        )[0];
        const d = near ? daysLeft(itemDeadline('tenders', near)) : null;
        const tail = d == null ? '' : d < 0 ? ' · ближайший просрочен' : ' · ближайший через ' + d + ' ' + daysWord(d);
        const nmck = items.reduce((a, t) => a + Number(t.nmck || t.price || 0), 0);
        const meta = items.length
          ? 'НМЦК <b>' + moneyShort(nmck) + '</b>' + tail
          : 'нет карточек за период';
        return statusRow(section, st, row.count, row.sum, meta);
      }).join('');
    }
    if (section === 'applications') {
      const map = Object.fromEntries((state.appsByStatus || []).map((r) => [r.status, r]));
      const known = APP_STATUSES.map((st) => {
        const row = map[st.id] || {};
        const items = (state.appsItems || []).filter((x) => x.status === st.id);
        const green = items.filter((a) => a.ai_color === 'green' || (a.ai && a.ai.color === 'green')).length;
        const meta = items.length
          ? 'AI зелёных <b>' + green + '</b> · <b>' + items.length + '</b> в колонке'
          : (Number(row.count) ? '<b>' + row.count + '</b> в колонке' : 'нет карточек за период');
        const sum = row.sum != null ? row.sum
          : items.reduce((a, x) => a + Number(itemAmount('applications', x)), 0);
        return statusRow(section, st, row.count != null ? row.count : items.length, sum, meta);
      });
      /* Доп. статусы из API, которых нет в V3-каноне */
      const extra = (state.appsByStatus || []).filter((r) => !APP_STATUSES.some((s) => s.id === r.status));
      const extraCards = extra.map((r) => {
        const st = { id: r.status, label: r.label || r.status, tone: APP_TONE[r.status] || 'muted' };
        return statusRow(section, st, r.count, r.sum, Number(r.count) ? '<b>' + r.count + '</b> в колонке' : 'нет карточек');
      });
      return known.concat(extraCards).join('');
    }
    return WORK_STATUSES.map((st) => {
      const items = (state.worksItems || []).filter((w) => w.bucket === st.id);
      const n = state.worksCounts[st.id] != null ? state.worksCounts[st.id] : items.length;
      const sum = items.reduce((a, w) => a + Number(w.contract_value || 0), 0);
      const paid = items.reduce((a, w) => a + Number(w.received || w.paid || 0), 0);
      const risk = items.filter((w) => w.schedule_light === 'err' || w.tone === 'bad' || (w.days_left != null && w.days_left < 0)).length;
      const meta = n
        ? 'оплачено <b>' + moneyShort(paid) + '</b>' + (risk ? ' · <b>' + risk + '</b> в риске' : ' · график в норме')
        : 'нет карточек за период';
      return statusRow(section, st, n, sum, meta);
    }).join('');
  }

  function rowFor(section, item, st) {
    let av = '', t1 = '', t2 = '', moneyVal = '', moneySub = '', moneySubCls = '', flag = '';
    const closed = isClosed(section, item);
    const dl = itemDeadline(section, item);

    if (section === 'tenders') {
      flag = dueFlag(dl, closed);
      av = initials(itemCustomer(item));
      t1 = '<span class="t">' + esc(itemTitle(section, item)) + '</span>';
      t2 = esc(itemCustomer(item)) +
        (item.region ? '<span class="dotsep">·</span>' + esc(item.region) : '') +
        '<span class="dotsep"></span>' + deadlineChip(dl, closed);
      moneyVal = rub(itemAmount(section, item));
      const m = item.estimate && item.estimate.margin_pct != null ? item.estimate.margin_pct
        : (item.margin_pct != null ? item.margin_pct : null);
      moneySub = m != null ? 'маржа ' + pct(m) : (item.pm && item.pm.name ? 'РП ' + item.pm.name.split(' ')[0] : '—');
      moneySubCls = m == null ? '' : m >= 20 ? 'ok' : m >= 14 ? 'warn' : 'err';
    } else if (section === 'applications') {
      flag = dueFlag(dl, closed);
      const sender = (item.sender && item.sender.name) || item.contact_person || itemCustomer(item);
      av = initials(sender);
      t1 = '<span class="t">' + esc(itemTitle(section, item)) + '</span>';
      const ch = CHANNELS[item.channel || item.source_type] || item.channel || item.source_type || '';
      t2 = esc(itemCustomer(item)) +
        (ch ? '<span class="dotsep">·</span>' + esc(ch) : '') +
        '<span class="dotsep">·</span>' + esc(shortDate(item.created || item.created_at)) +
        (dl ? '<span class="dotsep"></span>' + deadlineChip(dl, closed) : '');
      moneyVal = itemAmount(section, item) ? rub(itemAmount(section, item)) : '—';
      const pm = item.pm || item.assigned;
      moneySub = pm && pm.name ? 'РП ' + String(pm.name).split(' ')[0] : 'РП не назначен';
      moneySubCls = pm ? '' : 'warn';
    } else {
      av = initials((item.pm && item.pm.name) || itemCustomer(item));
      t1 = '<span class="t">' + esc(itemTitle(section, item)) + '</span>';
      t2 = esc(itemCustomer(item)) +
        (item.city || item.region ? '<span class="dotsep">·</span>' + esc(item.city || item.region) : '') +
        '<span class="dotsep">·</span>бригада ' + Number(item.brigade_count || (item.brigade && item.brigade.length) || 0) +
        (dl ? '<span class="dotsep">·</span>до ' + esc(fmtDate(dl)) : '');
      moneyVal = rub(itemAmount(section, item));
      const m = item.margin_pct;
      moneySub = m != null ? 'маржа ' + pct(m) : '—';
      moneySubCls = m == null ? '' : m >= 20 ? 'ok' : m >= 12 ? 'warn' : 'err';
    }

    return '<button type="button" class="row' + (flag ? ' row--' + flag : '') +
      '" data-item="' + esc(item.id) + '" data-section="' + section + '">' +
      '<span class="row-av ' + toneCls(st && st.tone) + '">' + esc(av) + '</span>' +
      '<span class="row-main">' +
        '<span class="row-t1">' + t1 + '</span>' +
        '<span class="row-t2">' + t2 + '</span>' +
      '</span>' +
      '<span class="row-side">' +
        '<span class="row-money">' +
          '<span class="row-money-val">' + esc(moneyVal) + '</span>' +
          '<span class="row-money-sub ' + moneySubCls + '">' + esc(moneySub) + '</span>' +
        '</span>' +
        '<span class="row-chev">' + chev() + '</span>' +
      '</span>' +
    '</button>';
  }

  function overdueSummary(section, list) {
    let over = 0;
    let today = 0;
    const ov = (state.overview && state.overview[section] && state.overview[section].overdue_count);
    (list || []).forEach((x) => {
      const f = dueFlag(itemDeadline(section, x), isClosed(section, x));
      if (f === 'over') over++;
      else if (f === 'today') today++;
    });
    if (ov != null && !list.length) over = Number(ov) || 0;
    if (!over && !today) return '';
    return '<div class="due-strip' + (over ? ' is-over' : '') + '">' +
      '<span class="due-strip-ico" aria-hidden="true">!</span>' +
      '<span class="due-strip-text">' +
        (over ? '<b>' + over + '</b> с просроченным дедлайном' : '') +
        (over && today ? ' · ' : '') +
        (today ? '<b>' + today + '</b> истекает сегодня' : '') +
      '</span>' +
      '<button type="button" class="due-strip-act" data-open-list="' + section + '" data-list-status="all">Показать всё</button>' +
    '</div>';
  }

  function attentionList(section, list) {
    const fromApi = state.overview && state.overview[section] && state.overview[section].attention;
    let scored;
    if (Array.isArray(fromApi) && fromApi.length) {
      scored = fromApi.map((x) => ({ x, score: 3 }));
    } else {
      scored = (list || []).map((x) => {
        const f = dueFlag(itemDeadline(section, x), isClosed(section, x));
        let score = f === 'over' ? 3 : f === 'today' ? 2 : 0;
        if (section === 'works' && (x.schedule_light === 'err' || x.tone === 'bad')) score = Math.max(score, 1);
        return { x, score };
      }).filter((r) => r.score > 0);
    }
    if (!scored.length) return '';
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3);
    const stList = statusesOf(section);
    const body = top.map((r) => {
      const sid = itemStatusId(section, r.x);
      return rowFor(section, r.x, findStatusMeta(section, sid) || statusMeta(stList, sid));
    }).join('');
    return '<div class="attention">' +
      '<div class="attention-h">' +
        '<span class="attention-ico" aria-hidden="true">!</span>' +
        '<span class="attention-title">Требует внимания</span>' +
        '<span class="attention-n">' + scored.length + '</span>' +
        '<button type="button" class="attention-all" data-open-list="' + section +
          '" data-list-status="all">Весь реестр' + chev() + '</button>' +
      '</div>' +
      '<div class="rows rows--compact">' + body + '</div>' +
    '</div>';
  }

  function sectionBlock(cfg) {
    const list = cfg.items || [];
    const total = list.reduce((a, x) => a + Number(itemAmount(cfg.id, x)), 0);
    const c = compact(total);
    return '<section class="sec" id="sec-' + cfg.id + '">' +
      '<div class="sec-head">' +
        '<div class="sec-head-left">' +
          '<span class="sec-mark"></span>' +
          '<h2 class="sec-title">' + esc(cfg.title) + '</h2>' +
          '<span class="sec-note">' + esc(cfg.note) + '</span>' +
        '</div>' +
        '<div class="sec-head-right">' +
          '<span class="sec-total">' + esc(c.v + ' ' + c.u) + '</span>' +
          '<button type="button" class="sec-open" data-open-list="' + cfg.id + '">Открыть реестр' + chev() + '</button>' +
        '</div>' +
      '</div>' +
      overdueSummary(cfg.id, list) +
      '<div class="sec-hero">' + cfg.hero().join('') + '</div>' +
      '<div class="status-grid">' + statusCards(cfg.id) + '</div>' +
      attentionList(cfg.id, list) +
    '</section>';
  }

  /**
   * Новый обзор (редизайн 10.11.2026): одна главная цифра, три контура,
   * детали по тапу. Старые секции с четырьмя KPI убраны с первого экрана —
   * именно они давали «разбегаются глаза».
   */
  function renderSections() {
    const ov = state.overview || {};
    const tO = ov.tenders || {};
    const aO = ov.applications || {};
    const wO = ov.works || {};
    const teamNorm = (state.team && state.team.norm) || {};
    const tCount = Number(tO.attention_count || (tO.attention || []).length || 0);
    const aCount = Number(aO.attention_count || (aO.attention || []).length || 0);
    const wCount = Number(wO.risk_count || (wO.attention || []).length || 0);
    const total = tCount + aCount + wCount;

    const attention = [].concat(
      (tO.attention || []).map((x) => ({ ...x, section: 'tenders', kind: x.attention_kind })),
      (aO.attention || []).map((x) => ({ ...x, section: 'applications', kind: 'app' }))
    );
    const visible = state.showAllAttention ? attention : attention.slice(0, 4);

    const attHtml = visible.map((x) => {
      const label = x.kind === 'director' ? 'Ждёт вашего решения'
        : x.kind === 'analysis_overdue' ? 'Просрочен анализ'
          : x.kind === 'deadline_soon' ? 'Срок близко' : 'Требует внимания';
      return '<button type="button" class="jp2-att-row" data-open-item="' + esc(x.section) + '" data-item="' + esc(x.id) + '">' +
        '<span class="jp2-att-dot' + (x.kind === 'director' ? ' is-hot' : ' is-warm') + '"></span>' +
        '<span class="jp2-att-body">' +
          '<span class="jp2-att-title">' + esc(x.title || x.customer_name || '—') + '</span>' +
          '<span class="jp2-att-meta">' + esc(label + (x.customer_name && x.title ? ' · ' + x.customer_name : '')) + '</span>' +
        '</span>' + chev() + '</button>';
    }).join('');

    const moreHtml = attention.length > 4
      ? '<button type="button" class="jp2-att-more" data-toggle-attention="1">' +
        (state.showAllAttention ? 'Свернуть' : 'Ещё ' + (attention.length - 4)) + '</button>'
      : '';

    const contour = (id, title, mid, num) =>
      '<button type="button" class="jp2-contour" data-open-list="' + id + '" data-list-status="all">' +
        '<span class="jp2-contour-name">' + esc(title) + '</span>' +
        '<span class="jp2-contour-mid">' + esc(mid) + '</span>' +
        '<span class="jp2-contour-num' + (num > 0 ? ' is-hot' : '') + '">' + num + '</span>' +
        chev() + '</button>';

    // Факты периода: не «сумма ради суммы», а ответ на вопрос директора.
    const fact = (label, value, sub, good) =>
      '<div class="jp2-fact">' +
        '<span class="jp2-fact-k">' + esc(label) + '</span>' +
        '<span class="jp2-fact-v' + (good ? ' is-good' : '') + '">' + esc(String(value)) + '</span>' +
        '<span class="jp2-fact-s">' + esc(sub) + '</span>' +
      '</div>';

    const factsHtml =
      fact('Тендеры в работе',
        tO.active_work != null ? tO.active_work : '—',
        tO.active_work_sum > 0 ? 'на ' + moneyShort(tO.active_work_sum) : 'в рассмотрении и подготовке') +
      fact('Подписано',
        tO.won != null ? tO.won : '—',
        tO.won_sum > 0 ? 'на ' + moneyShort(tO.won_sum) : 'выигранных за период нет',
        tO.won > 0) +
      fact('Портфель работ',
        moneyShort(wO.contract_sum || 0),
        (wO.active != null ? wO.active + ' активных' : '—') +
          (wO.risk_count > 0 ? ' · ' + wO.risk_count + ' в риске' : ' · без рисков')) +
      fact('Люди в норме',
        (teamNorm.people_green != null ? teamNorm.people_green : '—') +
          (teamNorm.people_total != null ? ' из ' + teamNorm.people_total : ''),
        teamNorm.people_red > 0 ? teamNorm.people_red + ' ниже половины нормы' : 'недоработок нет',
        teamNorm.people_green > 0);

    const suspectNote = tO.price_suspect_count > 0
      ? '<div class="jp2-fact-note">Одна сумма в реестре аномальная (свыше 5 млрд) и в итоги не включена.</div>'
      : '';

    return '<div class="jp2-overview">' +
      '<section class="jp2-hero">' +
        '<div class="jp2-hero-cap">Требует решения</div>' +
        '<div class="jp2-hero-num' + (total > 0 ? ' is-hot' : '') + '">' + total + '</div>' +
        '<div class="jp2-hero-sub">' +
          (total > 0 ? 'задач по трём контурам' : 'Всё под контролем') +
        '</div>' +
      '</section>' +
      (attHtml ? '<section class="jp2-attention">' + attHtml + moreHtml + '</section>' : '') +
      '<section class="jp2-contours">' +
        '<div class="jp2-sec-cap">Контуры</div>' +
        contour('tenders', 'Тендеры',
          (tO.total != null ? tO.total + ' в периоде' : '—') +
          (tO.nmck_sum > 0 ? ' · НМЦК ' + moneyShort(tO.nmck_sum) : ''),
          tCount > 0 ? tCount : (tO.total || 0)) +
        contour('applications', 'Заявки',
          (aO.total != null ? aO.total + ' создано' : '—'),
          aCount > 0 ? aCount : (aO.total || 0)) +
        contour('works', 'Работы',
          (wO.total != null ? wO.total + ' в портфеле' : '—') +
          (wO.risk_count > 0 ? ' · ' + wO.risk_count + ' в риске' : ''),
          wCount > 0 ? wCount : (wO.active || 0)) +
      '</section>' +
      '<section class="jp2-facts">' +
        '<div class="jp2-sec-cap">Сейчас в работе</div>' +
        factsHtml + suspectNote +
      '</section>' +
    '</div>';
  }

  /* ── Реестр ───────────────────────────────────────────────────────────── */
  function listSectionMeta(section) {
    if (section === 'tenders') return { title: 'Тендеры', unit: 'тендеров', hero: heroTenders };
    if (section === 'applications') return { title: 'Заявки', unit: 'заявок', hero: heroApps };
    return { title: 'Работы', unit: 'работ', hero: heroWorks };
  }

  function sourceItems(section) {
    if (section === 'tenders') return state.tendersItems || [];
    if (section === 'applications') return state.appsItems || [];
    return state.worksItems || [];
  }

  function matchesQuery(section, item, q) {
    if (!q) return true;
    let hay = [];
    if (section === 'tenders') {
      hay = [item.title, item.customer_name, item.customer, item.customer_inn, item.notice,
        item.region, item.registry_status, item.pm && item.pm.name];
    } else if (section === 'applications') {
      hay = [item.title, item.work_description, item.customer_name, item.contact_person,
        item.note, item.status, item.ai_summary];
    } else {
      hay = [item.title, item.object_name, item.customer_name, item.city, item.contract_no,
        item.pm && item.pm.name];
    }
    return hay.filter(Boolean).join(' ').toLowerCase().indexOf(q) >= 0;
  }

  function filteredListItems(section) {
    const st = state.listStatus;
    const q = state.listQuery.trim().toLowerCase();
    let arr = (state.listItems && state.listItems.length)
      ? state.listItems.slice()
      : sourceItems(section).slice();
    if (st && st !== 'all') {
      arr = arr.filter((x) => itemStatusId(section, x) === st);
    }
    arr = arr.filter((x) => matchesQuery(section, x, q));
    const sort = state.listSort;
    arr.sort((a, b) => {
      if (sort === 'sum') return itemAmount(section, b) - itemAmount(section, a);
      if (sort === 'created') {
        return new Date(b.date || b.created || b.created_at || b.start || 0)
          - new Date(a.date || a.created || a.created_at || a.start || 0);
      }
      return new Date(itemDeadline(section, a) || 0) - new Date(itemDeadline(section, b) || 0);
    });
    return arr;
  }

  function listScreen() {
    const section = state.listSection;
    const meta = listSectionMeta(section);
    const all = filteredListItems(section);
    const totalSum = all.reduce((a, x) => a + Number(itemAmount(section, x)), 0);
    let pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    if (state.listPage > pages) state.listPage = pages;
    const from = (state.listPage - 1) * PAGE_SIZE;
    const pageItems = all.slice(from, from + PAGE_SIZE);
    const stMeta = findStatusMeta(section, state.listStatus);

    const tabs = statusesOf(section).map((st) => {
      const n = sourceItems(section).filter((x) => itemStatusId(section, x) === st.id).length
        || (section === 'tenders'
          ? ((state.tendersByStatus.find((r) => r.status === st.id) || {}).count || 0)
          : section === 'applications'
            ? ((state.appsByStatus.find((r) => r.status === st.id) || {}).count || 0)
            : (state.worksCounts[st.id] || 0));
      const on = state.listStatus === st.id ? ' is-on' : '';
      return '<button type="button" class="lt-tab' + on + ' ' + toneCls(st.tone) +
        '" data-list-status="' + esc(st.id) + '">' + esc(st.label) +
        '<span class="lt-n">' + n + '</span></button>';
    }).join('');
    const allOn = state.listStatus === 'all' ? ' is-on' : '';
    const allCount = sourceItems(section).length;

    const body = pageItems.length
      ? pageItems.map((x) => rowFor(section, x, findStatusMeta(section, itemStatusId(section, x)))).join('')
      : '<div class="empty">Ничего не найдено. Измените фильтр или период.</div>';

    let pager = '';
    if (pages > 1) {
      let nums = '';
      let lo = Math.max(1, state.listPage - 2);
      let hi = Math.min(pages, lo + 4);
      lo = Math.max(1, hi - 4);
      for (let i = lo; i <= hi; i++) {
        nums += '<button type="button" class="pg-n' + (i === state.listPage ? ' is-on' : '') +
          '" data-page="' + i + '">' + i + '</button>';
      }
      pager = '<div class="pager">' +
        '<span class="pg-info">' + (from + 1) + '–' + Math.min(from + PAGE_SIZE, all.length) +
          ' из ' + all.length + '</span>' +
        '<span class="pg-btns">' +
          '<button type="button" class="pg-arrow" data-page="' + (state.listPage - 1) + '"' +
            (state.listPage === 1 ? ' disabled' : '') + '>' + chevL() + '</button>' +
          nums +
          '<button type="button" class="pg-arrow" data-page="' + (state.listPage + 1) + '"' +
            (state.listPage === pages ? ' disabled' : '') + '>' + chev() + '</button>' +
        '</span></div>';
    }

    return '<div class="list-screen">' +
      '<div class="ls-head">' +
        '<button type="button" class="ls-back" data-back-overview>' + chevL() + '<span>К обзору</span></button>' +
        '<div class="ls-titles">' +
          '<nav class="p-crumbs"><span>Главная</span><span class="sep">/</span>' +
            '<span>Пульс директора</span><span class="sep">/</span>' +
            '<span class="cur">' + esc(meta.title) + '</span></nav>' +
          '<h1 class="ls-title">' + esc(meta.title) +
            '<span class="ls-badge">' +
              esc(stMeta && state.listStatus !== 'all' ? stMeta.label : 'все статусы') +
            '</span></h1>' +
        '</div>' +
        '<div class="ls-sum">' +
          '<span class="ls-sum-cap">' + esc(periodLabel()) + ' · ' + all.length + ' ' + esc(meta.unit) + '</span>' +
          '<span class="ls-sum-val">' + esc(moneyShort(totalSum)) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="ls-bar">' +
        '<label class="ls-search">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>' +
          '<input type="search" placeholder="Заказчик, ИНН, название, РП…" value="' +
            esc(state.listQuery) + '" data-list-search>' +
        '</label>' +
        '<div class="ls-sort">' +
          '<span class="ls-sort-cap">Сортировка</span>' +
          '<div class="seg-switch sm" role="group">' +
            '<button type="button" data-sort="deadline" class="' + (state.listSort === 'deadline' ? 'is-on' : '') + '">По дедлайну</button>' +
            '<button type="button" data-sort="sum" class="' + (state.listSort === 'sum' ? 'is-on' : '') + '">По сумме</button>' +
            '<button type="button" data-sort="created" class="' + (state.listSort === 'created' ? 'is-on' : '') + '">По дате</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ls-tabs" role="tablist">' +
        '<button type="button" class="lt-tab lt-all' + allOn + '" data-list-status="all">Все<span class="lt-n">' +
          allCount + '</span></button>' +
        tabs +
      '</div>' +
      '<div class="ls-body">' +
        '<div class="ls-thead"><span>Карточка</span><span>Дедлайн</span><span class="ta-r">Сумма</span></div>' +
        '<div class="rows rows--table">' + body + '</div>' +
      '</div>' +
      pager +
    '</div>';
  }

  /* ── Модалка: общие блоки ─────────────────────────────────────────────── */
  function modalShell(opts) {
    const tabs = opts.tabs.map((t) => {
      const on = state.tab === t.id;
      return '<button type="button" role="tab" data-tab="' + esc(t.id) + '"' +
        (on ? ' class="is-on" aria-selected="true"' : ' aria-selected="false"') + '>' +
        esc(t.label) + '</button>';
    }).join('');
    return '<div class="modal-head">' +
      '<div class="modal-head-top">' +
        '<button type="button" class="modal-back" data-close-sheet aria-label="Назад">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '<div class="modal-head-main">' +
          '<div class="modal-kicker"><span>' + esc(opts.kicker) + '</span><span class="mono">' +
            esc(opts.id) + '</span></div>' +
          '<h2 class="modal-title" id="jpModalTitle">' + esc(opts.title) + '</h2>' +
          '<div class="modal-sub">' + opts.sub + '</div>' +
        '</div>' +
        '<button type="button" class="modal-close asg-icon-btn" data-close-sheet aria-label="Закрыть">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="modal-tabs jp-modal-tabs" role="tablist"><span class="tabs-ind" id="tabsInd"></span>' +
        tabs + '</div>' +
    '</div>' +
    '<div class="modal-body">' + opts.body() + '</div>';
  }

  function positionTabsInd() {
    const sheet = elSheet();
    if (!sheet) return;
    const ind = sheet.querySelector('#tabsInd');
    const bar = sheet.querySelector('.modal-tabs');
    if (!ind || !bar) return;
    const on = bar.querySelector('button.is-on');
    if (!on) return;
    ind.style.left = on.offsetLeft + 'px';
    ind.style.width = on.offsetWidth + 'px';
  }

  function kvRow(k, v) {
    return '<div class="kv-row"><span class="kv-k">' + esc(k) + '</span><span class="kv-v">' + v + '</span></div>';
  }

  function kv(rows) {
    return '<div class="kv">' + rows.join('') + '</div>';
  }

  function block(title, body, headRight) {
    return '<div class="block">' +
      '<div class="block-h"><h3>' + esc(title) + '</h3>' + (headRight || '') + '</div>' +
      body + '</div>';
  }

  function sideCard(cap, value, cls, sub, rows) {
    return '<div class="side-card">' +
      '<div class="side-cap">' + esc(cap) + '</div>' +
      '<div class="side-big ' + (cls || '') + '">' + value + '</div>' +
      (sub ? '<div class="side-cap-sub">' + esc(sub) + '</div>' : '') +
      (rows && rows.length ? '<div class="side-rows">' + rows.map((r) =>
        '<div class="side-row"><span class="k">' + esc(r[0]) + '</span><span class="v">' + r[1] + '</span></div>'
      ).join('') + '</div>' : '') +
    '</div>';
  }

  function deadlineBanner(deadline, opts) {
    if (!deadline) return '';
    const d = daysLeft(deadline);
    if (d === null || d > 1) return '';
    const o = opts || {};
    const cls = d < 0 ? 'is-over' : 'is-today';
    const head = d < 0
      ? 'Просрочка: дедлайн прошёл ' + Math.abs(d) + ' ' + daysWord(d)
      : d === 0 ? 'Дедлайн сегодня' : 'Дедлайн завтра';
    const tail = o.status ? ' · статус «' + o.status + '»' : '';
    const hint = d < 0
      ? 'Карточка не закрыта. Требуется решение: продлить, подать или закрыть статусом.'
      : 'Срок истекает. Проверьте готовность пакета и решение по подаче.';
    return '<div class="dl-banner ' + cls + '">' +
      '<span class="dl-banner-ico" aria-hidden="true">!</span>' +
      '<span class="dl-banner-body">' +
        '<span class="dl-banner-head">' + esc(head) + esc(tail) + '</span>' +
        '<span class="dl-banner-hint">' + esc(hint) + '</span>' +
      '</span>' +
      '<span class="dl-banner-date mono">' + esc(shortDate(deadline)) + '</span>' +
    '</div>';
  }

  function auditBlock(rows) {
    const body = (rows || []).filter((r) => r && r.name).map((r) =>
      '<div class="audit-row">' +
        '<span class="audit-av">' + esc(initials(r.name)) + '</span>' +
        '<span class="audit-main">' +
          '<span class="audit-role">' + esc(r.role) + '</span>' +
          '<span class="audit-name">' + esc(r.name) + '</span>' +
        '</span>' +
        '<span class="audit-when mono">' + esc(r.at ? fmtDate(r.at) : '—') + '</span>' +
      '</div>'
    ).join('');
    return block('Кто вёл карточку',
      '<div class="audit">' + (body || '<div class="empty" style="padding:16px">Данных об авторе нет</div>') + '</div>');
  }

  function outcomeBlock(outcome) {
    if (!outcome) return '';
    const isCancel = outcome.kind === 'cancel';
    const badge = isCancel
      ? '<span class="badge neutral">Отмена</span>'
      : '<span class="badge err">Проигрыш</span>';
    return block(isCancel ? 'Почему отменили' : 'Почему проиграли',
      '<div class="outcome ' + (isCancel ? 'is-cancel' : 'is-lose') + '">' +
        '<div class="outcome-head">' + badge +
          '<span class="outcome-reason">' + esc(outcome.reason || '—') + '</span></div>' +
        (outcome.detail ? '<div class="outcome-detail">' + esc(outcome.detail) + '</div>' : '') +
        '<div class="outcome-foot">' +
          '<span>Зафиксировал: <b>' + esc(outcome.by || '—') + '</b></span>' +
          '<span class="mono">' + esc(outcome.at ? fmtDate(outcome.at) : '—') + '</span>' +
        '</div>' +
      '</div>');
  }

  function personLine(p, tag) {
    if (!p || !p.name) return '';
    return '<div class="person">' +
      '<span class="person-av">' + esc(initials(p.name)) + '</span>' +
      '<span class="person-txt"><span class="person-n">' + esc(p.name) + '</span>' +
      '<span class="person-r">' + esc(p.post || p.role || '') + '</span></span>' +
      (tag ? '<span class="person-tag">' + esc(tag) + '</span>' : '') +
    '</div>';
  }

  function docList(docs) {
    if (!docs || !docs.length) return '<div class="empty">Документов нет</div>';
    return '<div class="docs">' + docs.map((d) => {
      const name = d.original_name || d.file_name || d.name || 'файл';
      const ext = (d.ext || (name.split('.').pop() || 'file')).toString().slice(0, 4).toLowerCase();
      const size = d.size || d.mime_type || '';
      const date = d.date || d.created_at;
      return '<button type="button" class="doc">' +
        '<span class="doc-ext ' + esc(ext) + '">' + esc(ext) + '</span>' +
        '<span class="doc-main"><span class="doc-n">' + esc(name) + '</span>' +
        '<span class="doc-m">' + esc(size) + (date ? ' · ' + esc(fmtDate(date)) : '') + '</span></span>' +
        '<span class="doc-dl"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 18h14" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></span>' +
      '</button>';
    }).join('') + '</div>';
  }

  function statusPill(meta) {
    if (!meta) return '';
    return '<span class="pill-tone ' + toneCls(meta.tone) + '"><span class="sr-dot" style="background:currentColor"></span>' +
      esc(meta.label) + '</span>';
  }

  function normalizeEstimate(est) {
    if (!est) return null;
    const rows = est.rows || est.items || [];
    const total = est.total_no_vat != null ? est.total_no_vat
      : (est.amount != null ? Number(est.amount) : null);
    const cost = est.cost_total != null ? est.cost_total
      : (est.cost != null ? Number(est.cost) : null);
    const marginPct = est.margin_pct != null ? est.margin_pct
      : (est.margin != null ? Number(est.margin) : null);
    const vat = est.vat != null ? est.vat : (total != null ? Math.round(total * 0.2) : null);
    const withVat = est.total_with_vat != null ? est.total_with_vat
      : (total != null && vat != null ? total + vat : null);
    const marginRub = est.margin_rub != null ? est.margin_rub
      : (total != null && cost != null ? total - cost : null);
    return {
      title: est.title || 'Смета',
      rows: rows.map((r) => ({
        name: r.name || r.title || 'Позиция',
        unit: r.unit || '',
        qty: r.qty != null ? r.qty : r.quantity,
        sum: r.sum != null ? r.sum : r.amount,
        cost: r.cost,
        margin_pct: r.margin_pct != null ? r.margin_pct : r.margin
      })),
      total_no_vat: total,
      cost_total: cost,
      margin_pct: marginPct,
      margin_rub: marginRub,
      vat,
      total_with_vat: withVat
    };
  }

  function normalizeChecklist(cl) {
    if (!cl) return [];
    if (Array.isArray(cl.items)) return cl.items;
    if (Array.isArray(cl)) return cl;
    const items = [];
    const answers = cl.answers;
    if (answers && typeof answers === 'object') {
      Object.keys(answers).forEach((k) => {
        const v = answers[k];
        const done = v === true || v === 'yes' || v === 'да' || v === 1 || v === '1';
        items.push({ text: String(k), done });
      });
    }
    if (Array.isArray(cl.free_answers)) {
      cl.free_answers.forEach((f) => {
        if (typeof f === 'string') items.push({ text: f, done: false });
        else if (f && f.text) items.push({ text: f.text, done: !!f.done, date: f.date, due: f.due });
      });
    }
    return items;
  }

  /**
   * Вкладка «Анализ» — то, что модель разобрала до просчёта.
   *
   * ── Почему отдельной вкладкой ─────────────────────────────────────────────
   * Директор согласовывает цену, но судит по обоснованию. Раньше в пульсе
   * были только сводка, просчёт, смета и чек-лист: источник объёмов,
   * уверенность разбора и проблемы — всё это жило в report_json и нигде
   * не показывалось. Директор видел итог без причины.
   */
  function renderAnalysisTab(t) {
    const rj = (t && t.rp_review && t.rp_review.report_json) || {};
    const rep = typeof rj === 'string' ? (function () {
      try { return JSON.parse(rj); } catch (_) { return {}; }
    })() : (rj || {});

    const SOURCE = {
      vor: 'ведомость объёмов работ',
      tz: 'техническое задание',
      tz_labor: 'трудоёмкость из технического задания',
      defect_act: 'дефектный акт',
      passport: 'паспорт оборудования',
      web: 'открытые данные (паспорт найден поиском)',
      expert: 'оценка специалиста'
    };

    const facts = [];
    if (rep.volume_source) {
      facts.push(['Источник объёмов', SOURCE[rep.volume_source] || String(rep.volume_source)]);
    }
    if (rep.confidence != null) {
      const c = Number(rep.confidence);
      const word = c >= 0.8 ? 'высокая' : (c >= 0.5 ? 'средняя' : 'низкая');
      facts.push(['Уверенность разбора', word + ' (' + Math.round(c * 100) + ' %)']);
    }
    if (rep.expected_rows) facts.push(['Строк с объёмом в документах', String(rep.expected_rows)]);
    if (rep.found_positions) facts.push(['Найдено позиций', String(rep.found_positions)]);
    if (rep.valid_positions) facts.push(['Годных позиций', String(rep.valid_positions)]);
    if (rep.generation_rounds > 1) facts.push(['Проходов разбора', String(rep.generation_rounds)]);
    if (rep.incomplete) facts.push(['Разбор', 'неполный']);
    if (rep.history_count) facts.push(['Прошлых тендеров заказчика', String(rep.history_count)]);

    const works = Array.isArray(rep.works) ? rep.works
      : (Array.isArray((t && t.smeta) && t.smeta.works) ? t.smeta.works : []);
    const probs = Array.isArray(rep.problems) ? rep.problems.filter(Boolean) : [];

    const factsHtml = facts.length
      ? '<div class="kv">' + facts.map((f) =>
        '<div class="kv-row"><span class="kv-k">' + esc(f[0]) + '</span>' +
        '<span class="kv-v">' + esc(f[1]) + '</span></div>').join('') + '</div>'
      : '<div class="empty" style="padding:28px 0">Анализ ещё не проводился — данных нет, ' +
        'это честный пустой экран, не заглушка.</div>';

    const worksHtml = works.length
      ? block('Состав работ · ' + works.length,
        '<div class="checklist">' + works.slice(0, 40).map((w) =>
          '<div class="check-item"><span class="check-txt">' + esc(String(w.name || '—')) + '</span>' +
          '<span class="check-when">' + esc((w.volume != null ? String(w.volume) : '—')
            + (w.unit ? ' ' + w.unit : '')) +
          (w.volume_source ? '<span class="sub"> · ' + esc(SOURCE[w.volume_source] || '') + '</span>' : '') +
          '</span></div>').join('') + '</div>',
        works.length > 40 ? '<span class="badge neutral">первые 40</span>' : '')
      : '';

    const probsHtml = probs.length
      ? block('Требует внимания',
        '<ul class="rp-problems">' + probs.map((p) => {
          const text = typeof p === 'string' ? p : (p && (p.text || p.message || p.name)) || '';
          return text ? '<li>' + esc(String(text)) + '</li>' : '';
        }).join('') + '</ul>',
        '<span class="badge warn">' + probs.length + '</span>')
      : '';

    return '<div class="split"><div class="split-main">' +
      block('Анализ тендера', factsHtml) + worksHtml + probsHtml +
      '</div><div class="split-side">' +
      sideCard('Разбор',
        rep.incomplete ? 'неполный' : (rep.found_positions ? 'полный' : '—'),
        rep.incomplete ? 'warn' : 'ok',
        rep.incomplete ? 'часть строк могла не попасть' : 'все найденные строки учтены') +
      '</div></div>';
  }

  function estimateTableHtml(est) {
    if (!est || !est.rows || !est.rows.length) {
      return '<div class="empty" style="padding:28px 0">Строк сметы нет — честные пустые данные, не заглушка.</div>';
    }
    const rows = est.rows.map((r, i) =>
      '<tr>' +
        '<td>' + (i + 1) + '. ' + esc(r.name) +
          (r.unit ? '<span class="sub">' + esc(r.unit) + '</span>' : '') + '</td>' +
        '<td class="num">' + (r.qty != null ? num(r.qty) : '—') + '</td>' +
        '<td class="num">' + rub(r.sum) + '</td>' +
        '<td class="num">' + rub(r.cost) + '</td>' +
        (r.margin_pct != null
          ? '<td class="num pct' + (r.margin_pct >= 20 ? '' : r.margin_pct >= 14 ? ' low' : ' bad') + '">' +
            pct(r.margin_pct) + '</td>'
          : '<td class="num">—</td>') +
      '</tr>'
    ).join('');
    const hasMarginCol = est.rows.some((r) => r.margin_pct != null);
    return '<div class="tbl-wrap"><table class="tbl">' +
      '<thead><tr><th>Позиция</th><th class="num">Кол-во</th><th class="num">Сумма</th>' +
      '<th class="num">Себест.</th>' + (hasMarginCol ? '<th class="num">Маржа</th>' : '<th class="num">Маржа</th>') +
      '</tr></thead><tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td>Итого</td><td class="num">' + est.rows.length + ' поз.</td>' +
        '<td class="num">' + rub(est.total_no_vat) + '</td>' +
        '<td class="num">' + rub(est.cost_total) + '</td>' +
        '<td class="num pct' + (est.margin_pct == null ? '' : est.margin_pct >= 20 ? '' : est.margin_pct >= 14 ? ' low' : ' bad') + '">' +
          (est.margin_pct != null ? pct(est.margin_pct) : '—') + '</td></tr></tfoot></table></div>' +
      '<div class="totals">' +
        '<div class="totals-row"><span class="k">Без НДС</span><span class="v">' + rub(est.total_no_vat) + '</span></div>' +
        '<div class="totals-row"><span class="k">НДС 20 %</span><span class="v">' + rub(est.vat) + '</span></div>' +
        '<div class="totals-row grand"><span class="k">С НДС</span><span class="v">' + rub(est.total_with_vat) + '</span></div>' +
        '<div class="totals-row accent"><span class="k">Маржа</span><span class="v">' +
          (est.margin_rub != null ? rub(est.margin_rub) + ' · ' : '') +
          (est.margin_pct != null ? pct(est.margin_pct) : '—') + '</span></div>' +
      '</div>';
  }

  /* ── Тела вкладок ─────────────────────────────────────────────────────── */
  function tenderBody(t) {
    const st = findStatusMeta('tenders', t.registry_status);
    const dl = t.deadline || t.docs_deadline;
    const est = normalizeEstimate(t.estimate || (t.estimates && t.estimates[0]) || null);
    const rp = t.rp_review || t.rp_calc || null;
    const checklist = normalizeChecklist(t.checklist);
    const docs = t.docs || t.documents || [];
    const nmck = t.nmck != null ? t.nmck : t.price;
    const workPrice = t.work_price != null ? t.work_price
      : (rp && rp.work_price != null ? rp.work_price : t.price);

    if (state.tab === 'calc') {
      if (!rp) {
        return '<div class="empty" style="padding:40px 0">Просчёт РП ещё не создан.</div>';
      }
      const decision = (rp.decision === 'submit' || rp.decision === 'go' || rp.decision === 'подавать')
        ? '<span class="badge ok">Подавать</span>'
        : '<span class="badge err">' + esc(rp.decision || 'Не подавать') + '</span>';
      const who = rp.who || rp.calculator || t.calculator;
      const cost = rp.cost != null ? rp.cost : null;
      const marginPct = rp.margin_pct != null ? rp.margin_pct : null;
      const main =
        deadlineBanner(dl, { status: t.registry_status }) +
        block('Кто и что посчитал',
          '<div class="people">' + personLine(who, String(rp.kind || rp.report_kind || 'РП').toUpperCase()) + '</div>' +
          kv([
            kvRow('Цена работ', rub(rp.work_price != null ? rp.work_price : workPrice) + ' <span class="muted">без НДС</span>'),
            kvRow('Себестоимость', rub(cost)),
            kvRow('Маржа', marginPct != null ? pct(marginPct) : '—'),
            kvRow('Решение', decision),
            kvRow('Дата финализации', fmtDate(rp.finalized_at || rp.analysis_finalized_at))
          ]), decision) +
        (rp.recommendation || rp.report_json
          ? block('Рекомендация калькулятора',
            '<div class="report">' + esc(
              rp.recommendation || (typeof rp.report_json === 'string'
                ? rp.report_json
                : (rp.report_json && (rp.report_json.conclusion || rp.report_json.summary || rp.report_json.text)) || '—')
            ) + '</div>')
          : '');
      const wp = rp.work_price != null ? rp.work_price : workPrice;
      const side =
        sideCard('Цена работ без НДС',
          esc(compact(wp || 0).v) + '<span class="unit" style="font-size:13px;color:var(--t3);margin-left:3px">' +
            esc(compact(wp || 0).u) + '</span>', '', 'канон: цена без НДС', [
            ['НМЦК', esc(moneyShort(nmck))],
            ['Себестоимость', esc(moneyShort(cost))],
            ['Маржа', esc(marginPct != null ? pct(marginPct) : '—')]
          ]) +
        sideCard('Аналитик', esc(initials((t.analyzer && t.analyzer.name) || (who && who.name))), '',
          (t.analyzer && t.analyzer.name) || (who && who.name) || '—',
          [['Площадка', esc(t.platform || '—')], ['Регион', esc(t.region || '—')]]);
      return '<div class="split"><div class="split-main">' + main + '</div><div class="split-side">' + side + '</div></div>';
    }

    if (state.tab === 'estimate') {
      if (!est) {
        return '<div class="empty" style="padding:40px 0">Сметы по тендеру нет.</div>';
      }
      const side = sideCard('Цена работ без НДС',
        esc(compact(est.total_no_vat || 0).v) +
          '<span class="unit" style="font-size:13px;color:var(--t3);margin-left:3px">' +
          esc(compact(est.total_no_vat || 0).u) + '</span>',
        '', 'ндс начисляется сверху', [
          ['Позиций', String(est.rows.length)],
          ['Себестоимость', esc(moneyShort(est.cost_total))],
          ['Маржа', esc(est.margin_pct != null ? pct(est.margin_pct) : '—')],
          ['НДС 20 %', esc(moneyShort(est.vat))]
        ]) +
        (nmck
          ? sideCard('Сверка с НМЦК',
            esc(pct(((est.total_no_vat || 0) / nmck) * 100)), 'warn', 'доля цены работ от НМЦК', [
              ['НМЦК', esc(moneyShort(nmck))],
              ['Запас', esc(moneyShort(nmck - (est.total_no_vat || 0)))]
            ])
          : '');
      return '<div class="split"><div class="split-main">' +
        block('Смета Асгард · ' + est.rows.length + ' позиций', estimateTableHtml(est)) +
        '</div><div class="split-side">' + side + '</div></div>';
    }

    if (state.tab === 'analysis') {
      return renderAnalysisTab(t);
    }

    if (state.tab === 'checklist') {
      if (!checklist.length) {
        return '<div class="empty" style="padding:40px 0">Чек-лист анализа пуст.</div>';
      }
      const done = checklist.filter((x) => x.done).length;
      const items = checklist.map((c) => {
        const when = c.done ? fmtDate(c.date) : (c.due ? 'до ' + fmtDate(c.due) : '—');
        return '<div class="check-item' + (c.done ? ' done' : '') + '">' +
          '<span class="check-box">' + (c.done ? '✓' : '') + '</span>' +
          '<span class="check-txt">' + esc(c.text) + '</span>' +
          '<span class="check-when' + (c.done ? '' : ' pending') + '">' + esc(when) + '</span>' +
        '</div>';
      }).join('');
      return '<div class="split"><div class="split-main">' +
        block('Чек-лист анализа', '<div class="checklist">' + items + '</div>',
          '<span class="badge neutral">' + done + ' / ' + checklist.length + '</span>') +
        '</div><div class="split-side">' +
        sideCard('Готовность', done + ' / ' + checklist.length,
          done === checklist.length ? 'ok' : 'warn',
          done === checklist.length ? 'все пункты закрыты' : 'осталось ' + (checklist.length - done)) +
        '</div></div>';
    }

    if (state.tab === 'report') {
      const r = t.report || {};
      let text = r.text || '';
      if (!text && rp && rp.report_json) {
        try {
          const j = typeof rp.report_json === 'string' ? JSON.parse(rp.report_json) : rp.report_json;
          text = j.conclusion || j.summary || j.text || '';
        } catch (e) {
          text = String(rp.report_json);
        }
      }
      if (!text && !rp) {
        return '<div class="empty" style="padding:40px 0">Отчёта РП нет.</div>';
      }
      const decision = r.decision || (rp && rp.decision);
      const ok = decision === 'submit' || decision === 'go' || decision === 'подавать';
      const badge = decision
        ? (ok ? '<span class="badge ok">Согласовано · подавать</span>' : '<span class="badge err">Отказ</span>')
        : '';
      return '<div class="split"><div class="split-main">' +
        block('Заключение РП', '<div class="report">' + esc(text || '—') + '</div>' +
          '<div class="report-meta"><span>' + esc(r.author || (t.pm && t.pm.name) || 'РП') +
          '</span><span>' + esc(fmtDate(r.date || (rp && rp.analysis_finalized_at))) + '</span></div>', badge) +
        '</div><div class="split-side">' +
        sideCard('Решение', ok ? 'Подавать' : (decision || '—'), ok ? 'ok' : 'err', '') +
        '</div></div>';
    }

    if (state.tab === 'docs') {
      return block('Документы процедуры', docList(docs),
        '<span class="badge neutral">' + docs.length + ' файла</span>');
    }

    /* Сводка */
    const audit = t.audit || [
      { name: t.added_by && t.added_by.name, role: 'Добавил тендер', at: t.added_by && t.added_by.at },
      { name: t.analyzed_by && t.analyzed_by.name, role: 'Анализировал', at: t.analyzed_by && t.analyzed_by.at },
      { name: t.calculated_by && t.calculated_by.name, role: 'Считал просчёт', at: t.calculated_by && t.calculated_by.at },
      { name: t.calculator && t.calculator.name, role: 'Калькулятор', at: null },
      { name: t.pm && t.pm.name, role: 'Ответственный РП', at: t.date || t.created_at }
    ];
    const d = daysLeft(dl);
    const main =
      deadlineBanner(dl, { status: t.registry_status }) +
      block('Паспорт процедуры', kv([
        kvRow('Заказчик', esc(t.customer_name || t.customer || '—')),
        kvRow('ИНН', '<span class="mono">' + esc(t.customer_inn || t.inn || '—') + '</span>'),
        kvRow('Площадка', esc(t.platform || '—') +
          (t.purchase_url || t.link
            ? ' <a href="' + esc(t.purchase_url || t.link) + '" target="_blank" rel="noopener">открыть ↗</a>'
            : '')),
        kvRow('Извещение', '<span class="mono">' + esc(t.notice || t.registry_no || '—') + '</span>'),
        kvRow('НМЦК', rub(nmck)),
        kvRow('Цена работ', '<b>' + rub(workPrice) + '</b> <span class="muted">без НДС</span>'),
        kvRow('Дедлайн', fmtDate(dl) + ' <span class="muted">· ' + esc(deadlineText(dl)) + '</span>'),
        kvRow('Реестр / тендер', statusPill(st) +
          (t.tender_status ? ' <span class="muted">· ' + esc(t.tender_status) + '</span>' : '')),
        kvRow('Регион', esc(t.region || '—'))
      ])) +
      outcomeBlock(t.outcome) +
      auditBlock(audit);

    const side =
      sideCard('Цена работ без НДС',
        esc(compact(workPrice || 0).v) +
          '<span class="unit" style="font-size:13px;color:var(--t3);margin-left:3px">' +
          esc(compact(workPrice || 0).u) + '</span>',
        '', est ? ('смета · ' + est.rows.length + ' позиций') : 'смета не загружена', [
          ['НМЦК', esc(moneyShort(nmck))],
          ['Маржа сметы', esc(est && est.margin_pct != null ? pct(est.margin_pct) : '—')]
        ]) +
      sideCard('Дедлайн', d === null ? '—' : Math.abs(d) + ' ' + daysWord(d),
        d === null ? '' : d < 0 ? 'err' : d <= 5 ? 'warn' : 'ok',
        fmtDate(dl) + ' · ' + deadlineText(dl)) +
      sideCard('Статус', esc(st ? st.label : t.registry_status), '', t.tender_status || '', [
        ['Чек-лист', checklist.length ? (checklist.filter((x) => x.done).length + ' / ' + checklist.length) : '—'],
        ['Документов', String(docs.length)]
      ]);

    return '<div class="split"><div class="split-main">' + main + '</div><div class="split-side">' + side + '</div></div>';
  }

  function appBody(a) {
    const st = findStatusMeta('applications', a.status);
    const dl = a.deadline || a.work_deadline;
    const est = normalizeEstimate(a.estimate);
    const docs = a.docs || a.documents || [];
    const history = a.history || [];
    const ai = a.ai || {
      color: a.ai_color,
      confidence: a.ai_confidence != null ? a.ai_confidence : null,
      summary: a.ai_summary
    };

    if (state.tab === 'estimate') {
      if (!est) {
        return '<div class="empty" style="padding:40px 0">Просчёт по заявке ещё не создан.<br>' +
          'Калькулятор закрепляется автоматически при переходе в статус «Просчёт».</div>';
      }
      return '<div class="split"><div class="split-main">' +
        block(est.title, estimateTableHtml(est)) +
        '</div><div class="split-side">' +
        sideCard('Сумма без НДС',
          esc(compact(est.total_no_vat || 0).v) +
            '<span class="unit" style="font-size:13px;color:var(--t3);margin-left:3px">' +
            esc(compact(est.total_no_vat || 0).u) + '</span>', '',
          'позиций: ' + est.rows.length, [
            ['Себестоимость', esc(moneyShort(est.cost_total))],
            ['Маржа', esc(est.margin_pct != null ? pct(est.margin_pct) : '—')],
            ['НДС 20 %', esc(moneyShort(est.vat))]
          ]) +
        '</div></div>';
    }

    if (state.tab === 'history') {
      if (!history.length) {
        return '<div class="empty" style="padding:40px 0">Истории статусов пока нет.</div>';
      }
      const items = history.map((h, i) => {
        const meta = findStatusMeta('applications', h.status);
        const last = i === history.length - 1;
        return '<div class="tl-item' + (last ? ' is-last' : '') + '">' +
          '<span class="tl-dot"></span>' +
          '<div class="tl-head"><span class="tl-status">' + esc(meta ? meta.label : h.status) + '</span>' +
          '<span class="tl-date">' + esc(fmtDate(h.at)) + '</span></div>' +
          '<div class="tl-note">' + esc(h.note || '') + '</div>' +
          '<div class="tl-by">' + esc(h.by || '') + '</div>' +
        '</div>';
      }).join('');
      return '<div class="split"><div class="split-main">' +
        block('История статусов', '<div class="timeline">' + items + '</div>',
          '<span class="badge neutral">' + history.length + ' событий</span>') +
        '</div><div class="split-side">' +
        sideCard('Текущий статус', esc((st && st.label) || a.status), '',
          'создана ' + fmtDate(a.created_at || a.created), [
            ['Событий', String(history.length)],
            ['Дедлайн', dl ? esc(fmtDate(dl)) : '—']
          ]) +
        '</div></div>';
    }

    if (state.tab === 'docs') {
      return block('Документы заявки', docList(docs),
        '<span class="badge neutral">' + docs.length + ' файла</span>');
    }

    const colorLabel = ai.color === 'green' ? 'зелёный'
      : ai.color === 'amber' || ai.color === 'yellow' ? 'жёлтый'
        : ai.color === 'red' ? 'красный' : (ai.color || '—');
    const conf = ai.confidence != null
      ? (ai.confidence <= 1 ? Math.round(ai.confidence * 100) : Math.round(ai.confidence))
      : null;
    const aiCard = (ai.summary || ai.color)
      ? '<div class="ai-card">' +
          '<div class="ai-top"><span class="ai-num">AI-разбор</span>' +
            '<span class="badge ' + (ai.color === 'green' ? 'ok' : ai.color === 'amber' || ai.color === 'yellow' ? 'warn' : 'err') + '">' +
              esc(colorLabel) + '</span></div>' +
          (conf != null
            ? '<div class="ai-meter"><span class="ai-bar"><i class="' + esc(ai.color || 'amber') +
              '" style="width:' + conf + '%"></i></span><span class="ai-num">' + conf + ' %</span></div>'
            : '') +
          '<div class="ai-sum">' + esc(ai.summary || '—') + '</div></div>'
      : '<div class="empty">AI-разбора нет</div>';

    const d = daysLeft(dl);
    const amount = a.amount != null ? a.amount : a.estimated_sum;
    const main =
      deadlineBanner(dl, { status: st ? st.label : a.status }) +
      block('AI-разбор письма', aiCard) +
      block('Паспорт заявки', kv([
        kvRow('Заказчик', esc(a.customer_name || a.customer || '—')),
        kvRow('Отправитель', esc((a.sender && a.sender.name) || a.contact_person || '—')),
        kvRow('Контакт', '<span class="mono">' + esc((a.sender && a.sender.addr) || a.customer_email || a.contact_phone || '—') + '</span>'),
        kvRow('Канал', esc(CHANNELS[a.channel || a.source_type] || a.channel || a.source_type || '—')),
        kvRow('Создана', fmtDate(a.created_at || a.created)),
        kvRow('Дедлайн', dl ? fmtDate(dl) + ' <span class="muted">· ' + esc(deadlineText(dl)) + '</span>' : '—'),
        kvRow('Статус', statusPill(st)),
        kvRow('Назначенный РП', (a.pm || a.assigned)
          ? esc((a.pm || a.assigned).name)
          : '<span class="muted">не назначен</span>'),
        kvRow('Просчёт', est
          ? '<b>' + esc(est.title) + '</b> · ' + rub(est.total_no_vat) + ' <span class="muted">без НДС</span>'
          : '<span class="muted">не создан</span>')
      ])) +
      outcomeBlock(a.outcome) +
      auditBlock(a.audit || [
        { name: a.added_by && a.added_by.name, role: 'Добавил заявку', at: a.added_by && a.added_by.at },
        { name: a.created_by && a.created_by.name, role: 'Создал', at: a.created_at },
        { name: a.analyzed_by && a.analyzed_by.name, role: 'Анализировал / считал', at: a.analyzed_by && a.analyzed_by.at },
        { name: (a.pm || a.assigned) && (a.pm || a.assigned).name, role: 'Назначенный РП', at: a.created_at }
      ]) +
      (a.note || a.decision_comment || a.reject_reason
        ? block('Комментарий', '<div class="report">' + esc(a.note || a.decision_comment || a.reject_reason) + '</div>')
        : '');

    const side =
      sideCard('Оценка суммы', amount
        ? esc(compact(amount).v) + '<span class="unit" style="font-size:13px;color:var(--t3);margin-left:3px">' +
          esc(compact(amount).u) + '</span>'
        : '—', '', est ? 'смета: ' + moneyShort(est.total_no_vat) : 'смета не создана') +
      sideCard('Дедлайн', d === null ? '—' : Math.abs(d) + ' ' + daysWord(d),
        d === null ? '' : d < 0 ? 'err' : d <= 3 ? 'warn' : 'ok',
        dl ? fmtDate(dl) : 'без срока') +
      sideCard('В контуре', String(history.length || docs.length || 0), '', 'событий / документов', [
        ['Документов', String(docs.length)],
        ['AI', colorLabel + (conf != null ? ' · ' + conf + ' %' : '')]
      ]);

    return '<div class="split"><div class="split-main">' + main + '</div><div class="split-side">' + side + '</div></div>';
  }

  function workBody(w) {
    const received = w.paid != null ? Number(w.paid)
      : (Number(w.advance_received || 0) + Number(w.balance_received || 0));
    const leftover = w.leftover != null ? w.leftover
      : (w.contract_value != null ? Number(w.contract_value) - received : null);
    const contract = w.contract != null ? w.contract : w.contract_value;
    const cost = w.cost != null ? w.cost : w.cost_current;
    const light = w.schedule_light || (w.tone === 'bad' ? 'err' : w.tone === 'risk' ? 'warn' : 'ok');

    if (state.tab === 'finance') {
      const f = {
        contract, cost,
        margin: w.margin_rub != null ? w.margin_rub : w.margin_abs,
        marginPct: w.margin_pct,
        paid: received,
        spent: w.spent != null ? w.spent : cost,
        left: leftover
      };
      const grid = '<div class="fin-grid">' +
        '<div class="fin-cell"><div class="fin-cap">Контракт</div><div class="fin-val">' + rub(f.contract) + '</div></div>' +
        '<div class="fin-cell"><div class="fin-cap">Себестоимость</div><div class="fin-val">' + rub(f.cost) + '</div></div>' +
        '<div class="fin-cell"><div class="fin-cap">Маржа</div><div class="fin-val ' +
          (f.marginPct >= 20 ? 'ok' : f.marginPct >= 12 ? 'warn' : 'err') + '">' +
          rub(f.margin) + ' · ' + pct(f.marginPct) + '</div></div>' +
        '<div class="fin-cell"><div class="fin-cap">Оплачено</div><div class="fin-val">' + rub(f.paid) + '</div></div>' +
        '<div class="fin-cell"><div class="fin-cap">Остаток к оплате</div><div class="fin-val">' + rub(f.left) + '</div></div>' +
        '<div class="fin-cell"><div class="fin-cap">Расходы факт</div><div class="fin-val">' + rub(f.spent) + '</div></div>' +
      '</div>';
      const paidPct = f.contract ? Math.min(100, (f.paid / f.contract) * 100) : 0;
      const costPct = f.contract ? Math.min(100, (Number(f.spent || 0) / f.contract) * 100) : 0;
      const prog = '<div class="prog"><div class="prog-bar"><i style="width:' + paidPct.toFixed(1) + '%"></i></div>' +
        '<div class="prog-cap"><span>Оплачено ' + pct(paidPct) + '</span><span>' + rub(f.paid) + ' из ' + rub(f.contract) + '</span></div></div>' +
        '<div class="prog"><div class="prog-bar"><i style="width:' + costPct.toFixed(1) + '%;background:var(--t3)"></i></div>' +
        '<div class="prog-cap"><span>Израсходовано ' + pct(costPct) + '</span><span>' + rub(f.spent) + '</span></div></div>';
      return '<div class="split"><div class="split-main">' + block('Финансы договора', grid) +
        block('Оплаты и расходы', prog) +
        '</div><div class="split-side">' +
        sideCard('Маржа по договору', pct(f.marginPct),
          f.marginPct >= 20 ? 'ok' : f.marginPct >= 12 ? 'warn' : 'err',
          rub(f.margin) + ' валовой прибыли') +
        '</div></div>';
    }

    if (state.tab === 'timesheet') {
      const byMonth = w.timesheet_by_month || [];
      const brig = w.brigade || [];
      if (!byMonth.length && !brig.length) {
        return '<div class="empty" style="padding:40px 0">Нет данных табеля.</div>';
      }

      /* Сводка по людям: агрегат persons из месяцев + ставки/даты из бригады */
      const personMap = {};
      byMonth.forEach((m) => {
        (m.persons || []).forEach((p) => {
          const key = String(p.employee_id || p.name);
          if (!personMap[key]) {
            personMap[key] = {
              employee_id: p.employee_id,
              name: p.name || ('#' + p.employee_id),
              days: 0,
              sum: 0,
              rate: p.day_rate != null ? Number(p.day_rate) : null
            };
          }
          personMap[key].days += Number(p.days || 0);
          personMap[key].sum += Number(p.accrued != null ? p.accrued
            : (Number(p.days || 0) * Number(p.day_rate || 0)));
          if (personMap[key].rate == null && p.day_rate != null) {
            personMap[key].rate = Number(p.day_rate);
          }
        });
      });
      brig.forEach((b) => {
        const key = String(b.employee_id || b.name);
        if (!personMap[key]) {
          personMap[key] = {
            employee_id: b.employee_id,
            name: b.name || ('#' + b.employee_id),
            days: 0,
            sum: 0,
            rate: b.rate != null ? Number(b.rate) : null
          };
        }
        personMap[key].role = b.role || b.field_role || '';
        personMap[key].arrive = b.arrival_date || b.arrive || null;
        personMap[key].leave = b.departure_date || b.leave || null;
        if (personMap[key].rate == null && b.rate != null) personMap[key].rate = Number(b.rate);
      });
      const persons = Object.values(personMap);
      const totalDays = persons.reduce((a, p) => a + Number(p.days || 0), 0)
        || byMonth.reduce((a, m) => a + Number(m.marks || 0), 0);
      const totalSum = persons.reduce((a, p) => a + Number(p.sum || 0), 0);

      const monthRows = byMonth.map((m) => {
        const pers = m.persons || [];
        let days = pers.reduce((s, p) => s + Number(p.days || 0), 0) || Number(m.marks || 0);
        let sum = pers.reduce((s, p) => s + Number(p.accrued != null ? p.accrued
          : (Number(p.days || 0) * Number(p.day_rate || 0))), 0);
        if (!sum && days && persons.length) {
          const avgRate = persons.filter((p) => p.rate).reduce((s, p) => s + p.rate, 0)
            / (persons.filter((p) => p.rate).length || 1);
          sum = days * (avgRate || 0);
        }
        return '<tr' + (days ? '' : ' class="is-empty"') + '>' +
          '<td class="month">' + esc(m.month) + '</td>' +
          '<td class="num days">' + (days || '—') + '</td>' +
          '<td class="num rate">' + (days && sum ? rub(sum / days) : '—') + '</td>' +
          '<td class="num sum">' + (sum ? rub(sum) : '—') + '</td></tr>';
      }).join('');

      const personRows = persons.length
        ? persons.map((p) =>
          '<tr><td><b>' + esc(p.name) + '</b>' +
            '<span class="sub">' + esc(p.role || '') +
            (p.arrive ? ' · ' + esc(shortDate(p.arrive)) + ' — ' + esc(shortDate(p.leave)) : '') +
            '</span></td>' +
            '<td class="num days">' + (p.days || '—') + '</td>' +
            '<td class="num rate">' + (p.rate != null ? rub(p.rate) : '—') + '</td>' +
            '<td class="num sum">' + (p.sum ? rub(p.sum) : '—') + '</td></tr>'
        ).join('')
        : '';

      /* Gantt заезд→выезд по бригаде */
      let timeline = '';
      const dated = persons.filter((p) => p.arrive);
      if (dated.length) {
        const starts = dated.map((p) => new Date(p.arrive).getTime()).filter((n) => !Number.isNaN(n));
        const ends = dated.map((p) => new Date(p.leave || p.arrive).getTime()).filter((n) => !Number.isNaN(n));
        const winStart = Math.min.apply(null, starts);
        const winEnd = Math.max.apply(null, ends);
        const span = (winEnd - winStart) || 1;
        const spanRows = dated.map((p) => {
          const a = new Date(p.arrive).getTime();
          const b2 = new Date(p.leave || p.arrive).getTime();
          const left = Math.max(0, Math.min(100, ((a - winStart) / span) * 100));
          const width = Math.max(2, Math.min(100 - left, ((b2 - a) / span) * 100));
          const parts = String(p.name || '').split(/\s+/);
          const short = (parts[0] || '') + (parts[1] ? ' ' + parts[1].slice(0, 1) + '.' : '');
          return '<div class="span-row">' +
            '<span class="span-name" title="' + esc(p.name) + '">' + esc(short) + '</span>' +
            '<span class="span-track"><span class="span-fill" style="left:' + left.toFixed(2) +
            '%;width:' + width.toFixed(2) + '%"></span></span>' +
            '<span class="span-dates">' + esc(shortDate(p.arrive)) + ' — ' +
            esc(shortDate(p.leave)) + '</span></div>';
        }).join('');
        const axis = byMonth.slice().reverse().map((m) =>
          '<span>' + esc(String(m.month).slice(5) || m.month) + '</span>'
        ).join('');
        timeline = '<div class="span-line">' +
          '<div class="span-cap">Заезд → выезд по месяцам</div>' +
          spanRows +
          (axis ? '<div class="span-axis">' + axis + '</div>' : '') +
          '</div>';
      }

      return '<div class="ts-head"><div class="ts-totals">' +
        '<div class="ts-total"><div class="ts-total-cap">Человеко-дней</div><div class="ts-total-val">' +
          num(totalDays) + '</div></div>' +
        '<div class="ts-total"><div class="ts-total-cap">Начислено</div><div class="ts-total-val accent">' +
          (totalSum ? rub(totalSum) : '—') + '</div></div>' +
        '<div class="ts-total"><div class="ts-total-cap">В бригаде</div><div class="ts-total-val">' +
          (persons.length || brig.length) + ' чел.</div></div>' +
        '</div></div>' +
        (monthRows
          ? '<div class="ts-block"><table class="ts"><thead><tr><th>Месяц</th><th class="num">Дней</th>' +
            '<th class="num">Ставка</th><th class="num">Начислено</th></tr></thead><tbody>' +
            monthRows + '</tbody></table></div>'
          : '') +
        (personRows
          ? block('Сводка по людям',
            '<div class="ts-block"><div class="ts-sub"><span>Сводка по людям</span>' +
            '<span class="mono">дни × ставка = начислено</span></div>' +
            '<table class="ts"><thead><tr><th>ФИО</th><th class="num">Дней</th>' +
            '<th class="num">Ставка</th><th class="num">Начислено</th></tr></thead><tbody>' +
            personRows + '</tbody></table></div>')
          : '') +
        (timeline ? block('График заездов', timeline) : '');
    }

    if (state.tab === 'brigade') {
      const brig = w.brigade || [];
      if (!brig.length) {
        return '<div class="empty" style="padding:40px 0">Бригада не назначена.</div>';
      }
      const rows = brig.map((p) =>
        '<div class="brig-person">' +
          '<span class="brig-av">' + esc(initials(p.name)) + '</span>' +
          '<span><span class="brig-n">' + esc(p.name || ('#' + p.employee_id)) + '</span>' +
            '<span class="brig-r">' + esc(p.role || p.field_role || '') + '</span></span>' +
          '<span class="brig-rate">' + (p.rate != null ? rub(p.rate) + ' / смена' : '—') + '</span>' +
          '<span class="brig-dates">' +
            (p.arrive || p.arrival_date ? esc(shortDate(p.arrive || p.arrival_date)) + ' — ' +
              esc(shortDate(p.leave || p.departure_date)) : '—') +
          '</span></div>'
      ).join('');
      return '<div class="split"><div class="split-main">' +
        block('Бригада на объекте', '<div class="brigade">' + rows + '</div>',
          '<span class="badge neutral">' + brig.length + ' чел.</span>') +
        '</div><div class="split-side">' +
        sideCard('РП', esc(initials(w.pm && w.pm.name)), '', (w.pm && w.pm.name) || '—',
          [['Регион', esc(w.city || w.region || '—')]]) +
        '</div></div>';
    }

    if (state.tab === 'checkins') {
      const list = w.checkins || w.recent_checkins || [];
      if (!list.length) {
        return '<div class="empty" style="padding:40px 0">Чекинов нет.</div>';
      }
      const rows = list.map((c) => {
        const ok = c.ok != null ? c.ok : (c.status !== 'missed' && c.status !== 'absent');
        return '<div class="check-row">' +
          '<span class="check-date">' + esc(fmtDate(c.at || c.date)) + '</span>' +
          '<span class="check-kind ' + (ok ? 'ok' : 'warn') + '">' + esc(c.kind || c.status || '—') + '</span>' +
          '<span class="check-note">' + esc(ok ? 'Подтверждено' : 'Требует внимания') +
            '<small>' + esc(c.who || c.name || '') + (c.note ? ' · ' + esc(c.note) : '') + '</small></span>' +
        '</div>';
      }).join('');
      const okCount = list.filter((c) => c.ok != null ? c.ok : true).length;
      return '<div class="split"><div class="split-main">' +
        block('Последние чекины', '<div class="checks">' + rows + '</div>',
          '<span class="badge ' + (okCount === list.length ? 'ok' : 'warn') + '">' +
            okCount + ' / ' + list.length + ' ок</span>') +
        '</div><div class="split-side">' +
        sideCard('Дисциплина', pct((okCount / list.length) * 100),
          okCount === list.length ? 'ok' : 'warn', 'чекинов с подтверждением') +
        '</div></div>';
    }

    /* Сводка */
    const lightText = light === 'ok' ? 'Укладываемся в график'
      : light === 'warn' ? 'Небольшое отставание' : 'Отставание от графика';
    const lightCard = '<div class="light-card ' + light + '">' +
      '<span class="light-lamp"></span>' +
      '<span class="light-txt"><span class="light-t">' + esc(lightText) + '</span>' +
      '<span class="light-s">факт ' + (w.fact_pct != null ? w.fact_pct + ' %' : '—') +
        ' · план ' + (w.plan_pct != null ? w.plan_pct + ' %' : '—') +
        (w.days_left != null ? ' · дней ' + w.days_left : '') + '</span></span></div>';

    const main =
      block('Паспорт объекта', kv([
        kvRow('Заказчик', esc(w.customer_name || w.customer || '—')),
        kvRow('Объект', esc(w.object || w.object_name || '—')),
        kvRow('Адрес', esc(w.address || w.city || '—')),
        kvRow('Договор', '<span class="mono">' + esc(w.contract_no || '—') + '</span>'),
        kvRow('РП', esc((w.pm && w.pm.name) || '—')),
        kvRow('Бригадир', esc(w.lead || '—')),
        kvRow('Старт', fmtDate(w.start || w.start_fact || w.start_in_work_date || w.start_plan)),
        kvRow(w.closed || w.end_fact ? 'Закрыт' : 'Плановое окончание',
          fmtDate(w.closed || w.end_fact || w.due || w.end_plan)),
        kvRow('Фаза', statusPill(findStatusMeta('works', w.bucket || w.phase)))
      ])) +
      block('Светофор сроков', lightCard) +
      (w.pause_reason ? block('Причина паузы', '<div class="report">' + esc(w.pause_reason) + '</div>') : '');

    const side =
      sideCard('Контракт',
        esc(compact(contract || 0).v) +
          '<span class="unit" style="font-size:13px;color:var(--t3);margin-left:3px">' +
          esc(compact(contract || 0).u) + '</span>',
        '', 'маржа ' + pct(w.margin_pct), [
          ['Себестоимость', esc(moneyShort(cost))],
          ['Оплачено', esc(moneyShort(received))],
          ['Остаток', esc(moneyShort(leftover))]
        ]) +
      sideCard('Бригада',
        Number(w.brigade_count || (w.brigade && w.brigade.length) || 0) + ' чел.', '', '');

    return '<div class="split"><div class="split-main">' + main + '</div><div class="split-side">' + side + '</div></div>';
  }

  /* ── Модалка open/close ───────────────────────────────────────────────── */
  function closeSheetSilent() {
    const sheet = elSheet();
    const rootEl = document.getElementById('jpModalRoot');
    const backdrop = elBackdrop();
    const inner = elSheetInner();
    if (sheet) {
      sheet.classList.remove('is-open');
      sheet.setAttribute('aria-hidden', 'true');
    }
    if (rootEl) {
      rootEl.classList.remove('is-on');
      rootEl.hidden = true;
    }
    if (backdrop) {
      backdrop.classList.remove('is-on');
      backdrop.hidden = true;
    }
    if (inner) inner.innerHTML = '';
    document.body.classList.remove('jp-modal-open');
    state.modal = null;
    state.detail = null;
    state.sheetLoading = false;
  }

  function closeSheet() {
    closeSheetSilent();
    renderMain();
  }

  function renderModal() {
    if (!state.modal || !state.detail) return;
    const section = state.modal.section;
    const item = state.detail;
    const inner = elSheetInner();
    if (!inner) return;
    let html;
    if (section === 'tenders') {
      html = modalShell({
        kicker: 'Тендер', id: item.id, title: item.title || 'Тендер',
        sub: statusPill(findStatusMeta('tenders', item.registry_status)) +
          (item.platform ? '<span class="dotsep">·</span><span>' + esc(item.platform) + '</span>' : '') +
          '<span class="dotsep">·</span><span>' + esc(item.customer_name || item.customer || '') + '</span>',
        tabs: TENDER_TABS,
        body: function () { return tenderBody(item); }
      });
    } else if (section === 'applications') {
      html = modalShell({
        kicker: 'Заявка', id: item.id,
        title: item.title || item.customer_name || ('Заявка #' + item.id),
        sub: statusPill(findStatusMeta('applications', item.status)) +
          '<span class="dotsep">·</span><span>' + esc(item.customer_name || '') + '</span>',
        tabs: APP_TABS,
        body: function () { return appBody(item); }
      });
    } else {
      html = modalShell({
        kicker: 'Работа', id: item.id,
        title: item.title || item.object_name || ('Работа #' + item.id),
        sub: statusPill(findStatusMeta('works', item.bucket || item.phase)) +
          '<span class="dotsep">·</span><span>' + esc(item.customer_name || '') + '</span>',
        tabs: WORK_TABS,
        body: function () { return workBody(item); }
      });
    }
    inner.innerHTML = html;
    requestAnimationFrame(positionTabsInd);
  }

  async function openSheet(section, itemId) {
    state.modal = { section: section, id: itemId };
    state.tab = (section === 'tenders' ? TENDER_TABS : section === 'applications' ? APP_TABS : WORK_TABS)[0].id;
    state.sheetLoading = true;
    const sheet = elSheet();
    const inner = elSheetInner();
    const rootEl = document.getElementById('jpModalRoot');
    if (!sheet || !inner) return;

    inner.innerHTML = '<div class="jp-loading">Загрузка карточки…</div>';
    if (rootEl && rootEl.parentElement !== document.body) {
      document.body.appendChild(rootEl);
    }
    if (rootEl) {
      rootEl.hidden = false;
      requestAnimationFrame(() => rootEl.classList.add('is-on'));
    }
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('jp-modal-open');

    try {
      let detail = null;
      if (section === 'tenders') detail = await api('/tenders/' + encodeURIComponent(itemId));
      else if (section === 'applications') detail = await api('/applications/' + encodeURIComponent(itemId));
      else detail = await api('/works/' + encodeURIComponent(itemId));
      if (!state.modal || String(state.modal.id) !== String(itemId)) return;
      state.detail = detail;
      state.sheetLoading = false;
      renderModal();
    } catch (e) {
      if (!state.modal || String(state.modal.id) !== String(itemId)) return;
      state.sheetLoading = false;
      inner.innerHTML = '<div class="jp-empty">Не удалось загрузить: ' + esc(e.message || String(e)) + '</div>';
      toast('Ошибка', e.message || String(e), 'err');
    }
  }

  /* ── Команда и часы (сохранено) ───────────────────────────────────────── */
  function hoursFmt(minutes) {
    if (minutes == null) return '—';
    const m = Math.max(0, Math.round(Number(minutes)));
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return hh + ':' + String(mm).padStart(2, '0');
  }

  function hoursHuman(minutes) {
    if (minutes == null) return '—';
    const m = Math.abs(Math.round(Number(minutes)));
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return (minutes < 0 ? '−' : '') + hh + ' ч' + (mm ? ' ' + mm + ' мин' : '');
  }

  function teamRangeLabel(t) {
    if (!t || !t.period || !t.period.from || !t.period.to) return 'период';
    return fmtDate(t.period.from) + '–' + fmtDate(t.period.to);
  }

  /** Состояния дисциплины «Графика офиса» — подписи для строки и легенды. */
  const OG_STATES = {
    green: { label: 'в норме' },
    yellow: { label: 'недоработка' },
    red: { label: 'ниже половины' },
    none: { label: 'нет нормы' }
  };

  function renderTeamHours() {
    const t = state.team;
    if (!t) return '<div class="jp-loading">Загрузка часов…</div>';

    const dq = t.data_quality || {};
    const period = t.period || {};
    const noSkud = !dq.last_import;
    const people = t.people || [];

    const scope = TEAM_SCOPES.some((s) => s.id === period.scope) ? period.scope : state.teamScope;
    const scopeChips = TEAM_SCOPES.map((s) =>
      '<button type="button" class="og-scope' + (s.id === scope ? ' is-on' : '') + '" ' +
      'data-team-scope="' + esc(s.id) + '" role="tab" aria-selected="' + (s.id === scope ? 'true' : 'false') + '">' +
      esc(s.label) + '</button>'
    ).join('');

    const atCurrent = !state.teamAnchor
      || (period.current_anchor && period.from && period.current_anchor >= period.from
          && period.current_anchor <= period.to);
    const filterHtml =
      '<div class="og-filter">' +
        '<div class="og-scopes" role="tablist" aria-label="Период графика офиса">' + scopeChips + '</div>' +
        '<div class="og-nav">' +
          '<button type="button" class="og-nav-btn" data-team-step="prev" aria-label="Предыдущий период" ' +
          (period.prev_anchor ? 'data-team-anchor="' + esc(period.prev_anchor) + '"' : 'disabled') + '>‹</button>' +
          '<span class="og-range">' + esc(period.label || teamRangeLabel(t)) + '</span>' +
          '<button type="button" class="og-nav-btn" data-team-step="next" aria-label="Следующий период" ' +
          (period.next_anchor ? 'data-team-anchor="' + esc(period.next_anchor) + '"' : 'disabled') + '>›</button>' +
        '</div>' +
        (atCurrent ? '' : '<button type="button" class="og-today" data-team-current="1">Текущий период</button>') +
      '</div>';

    if (noSkud) {
      return '<section class="sec" id="sec-team">' +
        '<div class="sec-head"><div class="sec-head-left">' +
          '<span class="sec-mark"></span><h2 class="sec-title">График офиса</h2>' +
          '<span class="sec-note">норма 8 ч/день · 40 ч/нед</span>' +
        '</div></div>' + filterHtml +
        '<div class="dl-banner"><span class="dl-banner-ico" aria-hidden="true">!</span>' +
          '<span class="dl-banner-body"><span class="dl-banner-head">Нет отчёта СКУД</span>' +
          '<span class="dl-banner-hint">Часы в офисе и норма не считаются, пока офис-менеджер не загрузит отчёт. ' +
          'Это не «0 часов» — это отсутствие данных.</span></span></div>' +
        '</section>';
    }

    // Отчёт есть, но за выбранный период нормы не начислено (например, ноябрь
    // при последнем импорте по 01.11). Это «нет данных», а не прогул: показываем
    // подсказку и кнопку на последний покрытый период.
    const importTo = dq.last_import ? String(dq.last_import.period_to).slice(0, 10) : null;
    const hasNorm = people.some((p) => Number(p.norm_minutes) > 0);
    const notCovered = !!importTo && people.length > 0 && !hasNorm;
    const coverageHtml = notCovered
      ? '<div class="dl-banner"><span class="dl-banner-ico" aria-hidden="true">!</span>' +
          '<span class="dl-banner-body"><span class="dl-banner-head">Период ещё не покрыт отчётом СКУД</span>' +
          '<span class="dl-banner-hint">Последний отчёт загружен по ' + esc(fmtDate(importTo)) +
          '. За дни без отчёта норма не начисляется — цвет и корона не ставятся.</span>' +
          '<button type="button" class="th-empty-btn" data-team-anchor="' + esc(importTo) + '">' +
          'Показать ' + esc(fmtDate(importTo)) + '</button></span></div>'
      : '';


    // Коронованный сверху, дальше — от худшего выполнения к лучшему.
    const stateRank = { red: 0, yellow: 1, none: 2, green: 3 };
    const sorted = people.slice().sort((a, b) => {
      if (!!b.crown !== !!a.crown) return b.crown ? 1 : -1;
      const ra = stateRank[a.state] == null ? 2 : stateRank[a.state];
      const rb = stateRank[b.state] == null ? 2 : stateRank[b.state];
      if (ra !== rb) return ra - rb;
      const pa = a.ratio_pct == null ? Number.POSITIVE_INFINITY : a.ratio_pct;
      const pb = b.ratio_pct == null ? Number.POSITIVE_INFINITY : b.ratio_pct;
      if (pa !== pb) return pa - pb;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
    });

    const CROWN_SVG =
      '<svg class="og-crown" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M3 8.5l4.2 3.2L12 5l4.8 6.7L21 8.5l-1.8 10.2H4.8L3 8.5z" ' +
      'fill="currentColor" stroke="none"/></svg>';

    const rowsHtml = sorted.map((p) => {
      const st = p.state || 'none';
      const pct = p.ratio_pct == null ? '—' : (Math.round(p.ratio_pct) + ' %');
      const deltaTxt = p.state === 'none' || p.delta_pct == null ? ''
        : (p.delta_pct < 0 ? '−' + Math.abs(Math.round(p.delta_pct)) + ' % к норме'
          : '+' + Math.round(p.delta_pct) + ' % к норме');
      const label = (OG_STATES[st] || OG_STATES.none).label;
      return '<button type="button" class="og-row is-' + esc(st) + (p.crown ? ' is-crown' : '') + '" ' +
        'data-team-person="' + esc(p.staff_id) + '" ' +
        'title="' + esc((p.name || '') + ' · ' + label + (deltaTxt ? ' · ' + deltaTxt : '')) + '">' +
        '<span class="og-bar" aria-hidden="true"></span>' +
        '<span class="og-name">' +
          '<span class="og-name-txt">' + esc(p.name || '—') + (p.crown ? CROWN_SVG : '') + '</span>' +
          '<span class="og-role">' + esc(p.role || '') +
            (p.norm_minutes > 0 ? (p.role ? ' · ' : '') + p.days_counted + ' дн. в норме' : '') + '</span>' +
        '</span>' +
        '<span class="og-cell num">' + esc(hoursFmt(p.office_minutes)) + '</span>' +
        '<span class="og-cell num">' + esc(hoursFmt(p.remote_minutes)) + '</span>' +
        '<span class="og-cell og-sum num">' + esc(hoursFmt(p.worked_minutes)) + '</span>' +
        '<span class="og-cell num">' + esc(p.norm_minutes ? hoursFmt(p.norm_minutes) : '—') + '</span>' +
        '<span class="og-pct"><span class="og-pct-v">' + esc(pct) + '</span>' +
          '<span class="og-pct-l">' + esc(label) + '</span></span>' +
      '</button>';
    }).join('');

    const listHtml = people.length
      ? '<div class="og-table">' +
          '<div class="og-thead">' +
            '<span class="og-name">Сотрудник</span>' +
            '<span class="og-cell">Офис</span>' +
            '<span class="og-cell">Удалённо</span>' +
            '<span class="og-cell og-sum">Сумма</span>' +
            '<span class="og-cell">Норма</span>' +
            '<span class="og-pct">Выработка</span>' +
          '</div>' + rowsHtml +
        '</div>'
      : '<div class="jp-empty">Нет сотрудников с аккаунтом CRM</div>';

    const legendHtml =
      '<div class="og-legend">' +
        '<span class="og-legend-item is-green"><i></i>норма и выше</span>' +
        '<span class="og-legend-item is-yellow"><i></i>недоработка до 50 %</span>' +
        '<span class="og-legend-item is-red"><i></i>ниже половины нормы</span>' +
        '<span class="og-legend-item is-none"><i></i>нет нормы (отпуск/больничный)</span>' +
      '</div>';

    const dqBits = [];
    if (dq.last_import) {
      dqBits.push('Отчёт СКУД: ' + fmtDate(dq.last_import.period_from) + '–' +
        fmtDate(dq.last_import.period_to) + ' · загружен ' + fmtDateTime(dq.last_import.imported_at));
    }
    if (dq.skud_days_missing_count) {
      dqBits.push('дней без отчёта: ' + dq.skud_days_missing_count);
    }
    if (dq.flags_open) dqBits.push('ждут ответа «где был»: ' + dq.flags_open);
    if (dq.crm_activity_since) dqBits.push('учёт СРМ с ' + fmtDate(dq.crm_activity_since));

    return '<section class="sec" id="sec-team">' +
      '<div class="sec-head">' +
        '<div class="sec-head-left">' +
          '<span class="sec-mark"></span>' +
          '<h2 class="sec-title">График офиса</h2>' +
          '<span class="sec-note">офис + удалённо · норма 8 ч/день</span>' +
        '</div>' +
      '</div>' +
      filterHtml +
      coverageHtml +
      '<div class="og-summary">' +
        (t.norm && t.norm.people_total
          ? '<span class="og-sum-item">В норме: <b>' + (t.norm.people_total - t.norm.people_under) +
            '</b> из ' + t.norm.people_total + '</span>'
          : '<span class="og-sum-item">Нет данных для расчёта нормы</span>') +
        (t.period && t.period.working_days
          ? '<span class="og-sum-item">рабочих дней: <b>' + t.period.working_days + '</b></span>'
          : '') +
      '</div>' +
      legendHtml +
      listHtml +
      (dqBits.length
        ? '<div class="og-dq">' + dqBits.map((b) => '<span>' + esc(b) + '</span>').join('<span class="og-dq-sep">·</span>') + '</div>'
        : '') +
      '</section>';
  }

  const TEAM_STATUS_LABELS = {
    'оф': 'В офисе', 'уд': 'Удалёнка', 'об': 'На объекте', 'км': 'Командировка',
    'пг': 'Встреча', 'уч': 'Учёба', 'ск': 'Склад', 'бн': 'Больничный',
    'сс': 'За свой счёт', 'вх': 'Выходной', 'нп': 'Не подтверждён'
  };
  const TEAM_SOURCE_LABELS = {
    skud: 'часы СКУД', crm: 'часы СРМ', skud_no_status: 'СКУД (статуса нет)',
    crm_no_status: 'СРМ (статуса нет)', no_crm_data: 'нет данных СРМ', no_data: 'нет данных',
    excluded: 'не входит в норму', unconfirmed: 'ждёт ответа', dayoff: 'выходной',
    legacy: 'до старта учёта СРМ', none: '—', skud_not_covered: 'нет отчёта СКУД'
  };

  function teamDayRow(d) {
    const remote = d.crm_remote_minutes != null
      ? Number(d.crm_remote_minutes)
      : Math.max(0, (Number(d.credited_minutes) || 0) - (Number(d.office_minutes) || 0));
    const worked = (Number(d.office_minutes) || 0) + remote;
    const tone = d.counts_in_norm
      ? (worked >= Number(d.norm_minutes || 0) ? 'ok' : 'err') : 'muted';
    const delta = d.counts_in_norm ? worked - Number(d.norm_minutes || 0) : null;
    return '<div class="th-row th-row--day">' +
      '<span class="mono">' + esc(fmtDate(d.date)) + '</span>' +
      '<span>' + esc(TEAM_STATUS_LABELS[d.status_code] || d.status_code || '—') + '</span>' +
      '<span class="ta-r num">' + esc(hoursFmt(d.office_minutes)) + '</span>' +
      '<span class="ta-r num">' + esc(hoursFmt(remote)) + '</span>' +
      '<span class="ta-r num">' + esc(hoursFmt(worked)) + '</span>' +
      '<span class="ta-r num">' + esc(hoursFmt(d.norm_minutes)) + '</span>' +
      '<span class="ta-r num ' + (tone === 'err' ? 'is-neg' : tone === 'ok' ? 'is-pos' : '') + '">' +
        esc(delta == null ? '—' : hoursHuman(delta)) + '</span>' +
      '<span class="src">' + esc(TEAM_SOURCE_LABELS[d.source] || d.source || '—') + '</span></div>';
  }

  function openTeamPerson(staffId) {
    const t = state.team;
    if (!t) return;
    closeSheetSilent();
    const p = (t.people || []).find((x) => String(x.staff_id) === String(staffId)
      || (x.staff_ids || []).map(String).includes(String(staffId)));
    if (!p) return;
    const days = p.days || [];
    const rows = days.filter((d) =>
      d.counts_in_norm || Number(d.office_minutes) > 0 || Number(d.crm_minutes) > 0
      || !!d.status_code || Number(d.norm_minutes) > 0);
    const roleLine = [p.role || '', (t.period && t.period.label) || ''].filter(Boolean).join(' · ');
    const body =
      '<div class="th-person-head">' +
        '<div><div class="th-person-name">' + esc(p.name) + '</div>' +
        '<div class="th-person-role">' + esc(roleLine) + '</div></div>' +
        '<div class="th-person-sum">' +
          '<span class="k">Офис</span><span class="v">' + esc(hoursFmt(p.office_minutes)) + '</span>' +
          '<span class="k">Удалённо</span><span class="v">' + esc(hoursFmt(p.remote_minutes)) + '</span>' +
          '<span class="k">Сумма</span><span class="v">' + esc(hoursFmt(p.worked_minutes)) + '</span>' +
          '<span class="k">Норма</span><span class="v">' + esc(hoursFmt(p.norm_minutes)) + '</span>' +
          '<span class="k">Отклонение</span><span class="v ' + (p.delta_minutes < 0 ? 'is-neg' : 'is-pos') + '">' +
            esc(hoursHuman(p.delta_minutes)) + '</span></div></div>' +
      (rows.length
        ? '<div class="th-table th-table--modal">' +
          '<div class="th-thead th-thead--days"><span>Дата</span><span>Статус</span>' +
          '<span class="ta-r">Офис</span><span class="ta-r">Удалённо</span><span class="ta-r">Сумма</span>' +
          '<span class="ta-r">Норма</span><span class="ta-r">Откл.</span><span>Источник</span></div>' +
          rows.map(teamDayRow).join('') + '</div>'
        : '<div class="jp-empty">За период нет дней с данными</div>');
    const inner = elSheetInner();
    const rootEl = document.getElementById('jpModalRoot');
    if (!inner) return;
    inner.innerHTML =
      '<div class="jp-sheet-head"><div>' +
        '<span class="jp-badge tone-info" style="margin-bottom:8px">Часы</span>' +
        '<h3 id="jpModalTitle">' + esc(p.name) + '</h3></div>' +
        '<button type="button" class="jp-sheet-close asg-icon-btn" data-close-sheet aria-label="Закрыть"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>' +
      '</div><div class="jp-sheet-section">' + body + '</div>';
    if (rootEl) {
      if (rootEl.parentElement !== document.body) document.body.appendChild(rootEl);
      rootEl.hidden = false;
      requestAnimationFrame(() => rootEl.classList.add('is-on'));
    }
    document.body.classList.add('jp-modal-open');
  }

  /* ── Рендер / загрузка ────────────────────────────────────────────────── */
  function renderMain() {
    const main = elMain();
    if (!main) return;
    updateSectionCounts();
    updatePeriodHint();

    if (state.loading) {
      main.innerHTML = '<div class="jp-loading">Загрузка…</div>';
      return;
    }

    if (state.view === 'list' && state.listSection) {
      main.innerHTML = listScreen();
      main.className = 'jp-main jp-main--list';
      return;
    }

    main.className = 'jp-main';
    main.innerHTML =
      '<div class="sections" id="jpSections">' +
        renderSections() +
        renderTeamHours() +
      '</div>';
  }

  function paintChrome() {
    const nav = document.getElementById('sectionNav');
    if (nav) {
      nav.querySelectorAll('.jp-sec-btn').forEach((b) => {
        b.classList.toggle('is-on', false);
      });
    }
    const chips = document.getElementById('periodChips');
    if (chips) {
      chips.querySelectorAll('.jp-period-chip').forEach((b) => {
        const on = b.dataset.period === state.period;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    requestAnimationFrame(morphPeriodChip);
  }

  async function loadTeamHours() {
    // Раздел живёт на СВОЁМ состоянии (локальный фильтр «График офиса»):
    // глобальные чипы тендеров/заявок/работ не должны ломать его период.
    const scope = TEAM_SCOPES.some((s) => s.id === state.teamScope) ? state.teamScope : 'month';
    const url = '/team-hours?period=' + scope
      + (state.teamAnchor ? '&date=' + encodeURIComponent(state.teamAnchor) : '');
    return api(url);
  }

  async function loadTeamOnly() {
    state.teamLoading = true;
    renderMain();
    try {
      const data = await loadTeamHours();
      state.team = data;
      state.teamAnchor = (data && data.period && data.period.from) || state.teamAnchor;
      state.teamLoading = false;
      renderMain();
    } catch (e) {
      state.teamLoading = false;
      toast('Ошибка', e.message || String(e), 'err');
      renderMain();
    }
  }

  async function loadOverview() {
    const seq = ++_loadSeq;
    state.loading = true;
    renderMain();
    paintChrome();

    try {
      const periodQ = encodeURIComponent(state.period);
      const [overview, tBy, aBy, works, tenders, apps, team] = await Promise.all([
        api('/overview?period=' + periodQ),
        api('/tenders/by-status?period=' + periodQ),
        api('/applications/by-status?period=' + periodQ),
        api('/works?bucket=all'),
        api('/tenders?period=' + periodQ),
        api('/applications?period=' + periodQ),
        loadTeamHours()
      ]);
      if (seq !== _loadSeq) return;
      state.overview = overview;
      state.tendersByStatus = (tBy && tBy.byStatus) || [];
      state.appsByStatus = (aBy && aBy.byStatus) || [];
      state.worksItems = (works && works.items) || [];
      state.worksCounts = (works && works.counts) || { active: 0, pause: 0, archive: 0 };
      state.tendersItems = (tenders && tenders.items) || [];
      state.appsItems = (apps && apps.items) || [];
      state.team = team;
      state.loading = false;
      renderMain();
      paintChrome();
    } catch (e) {
      if (seq !== _loadSeq) return;
      state.loading = false;
      toast('Ошибка', e.message || String(e), 'err');
      const main = elMain();
      if (main) {
        main.innerHTML = '<div class="jp-empty">Не удалось загрузить данные: ' +
          esc(e.message || String(e)) + '</div>';
      }
    }
  }

  async function openList(section, status) {
    state.view = 'list';
    state.listSection = section;
    state.listStatus = status || 'all';
    state.listPage = 1;
    state.listQuery = '';
    closeSheetSilent();

    const seq = ++_listSeq;
    state.loading = true;
    renderMain();

    try {
      const periodQ = encodeURIComponent(state.period);
      let data;
      if (section === 'tenders') {
        const st = status && status !== 'all' ? '&status=' + encodeURIComponent(status) : '';
        data = await api('/tenders?period=' + periodQ + st + '&sort=' + encodeURIComponent(state.listSort));
        if (seq !== _listSeq) return;
        state.listItems = data.items || [];
        if (!status || status === 'all') state.tendersItems = state.listItems;
      } else if (section === 'applications') {
        const st = status && status !== 'all' ? '&status=' + encodeURIComponent(status) : '';
        data = await api('/applications?period=' + periodQ + st + '&sort=' + encodeURIComponent(state.listSort));
        if (seq !== _listSeq) return;
        state.listItems = data.items || [];
        if (!status || status === 'all') state.appsItems = state.listItems;
      } else {
        const bucket = status && status !== 'all' ? status : 'all';
        data = await api('/works?bucket=' + encodeURIComponent(bucket));
        if (seq !== _listSeq) return;
        state.listItems = data.items || [];
        if (bucket === 'all') {
          state.worksItems = state.listItems;
          state.worksCounts = data.counts || state.worksCounts;
        }
      }
    } catch (e) {
      if (seq !== _listSeq) return;
      toast('Ошибка', e.message || String(e), 'err');
      state.listItems = sourceItems(section).slice();
    }

    if (seq !== _listSeq) return;
    state.loading = false;
    renderMain();
    window.scrollTo({ top: 0 });
  }

  function closeList() {
    state.view = 'overview';
    state.listSection = null;
    state.listQuery = '';
    state.listPage = 1;
    state.listItems = [];
    renderMain();
    window.scrollTo({ top: 0 });
  }

  async function setPeriod(period) {
    state.period = period;
    state.view = 'overview';
    state.listSection = null;
    // Глобальный период сменился — «График офиса» возвращаем на текущий.
    state.teamAnchor = null;
    closeSheetSilent();
    await loadOverview();
  }

  function shellHtml() {
    return (
      '<div class="jp-page" id="jp-root">' +
      '<header class="jp-top">' +
      '<div class="jp-top-left">' +
      '<div class="jp-eyebrow">ASGARD · JARL</div>' +
      '<h1 class="jp-title">Пульс директора</h1>' +
      '</div>' +
      '<div class="jp-top-right">' +
      '<div class="jp-vip-pill" title="VIP-контур аналитики">' +
      '<span class="jp-vip-dot"></span>Живой контур</div>' +
      '<div class="jp-now" id="jpNow">—</div>' +
      '</div></header>' +
      '<nav class="jp-sections" id="sectionNav" aria-label="Разделы">' +
      '<button type="button" class="jp-sec-btn" data-jump="tenders">' +
      '<span class="jp-sec-label">Тендеры</span><span class="jp-sec-count" id="secCountTenders">—</span></button>' +
      '<button type="button" class="jp-sec-btn" data-jump="applications">' +
      '<span class="jp-sec-label">Заявки</span><span class="jp-sec-count" id="secCountApps">—</span></button>' +
      '<button type="button" class="jp-sec-btn" data-jump="works">' +
      '<span class="jp-sec-label">Работы</span><span class="jp-sec-count" id="secCountWorks">—</span></button>' +
      '<button type="button" class="jp-sec-btn" data-jump="team">' +
      '<span class="jp-sec-label">График офиса</span><span class="jp-sec-count" id="secCountTeam">—</span></button>' +
      '</nav>' +
      '<div class="jp-period-row">' +
      '<div class="jp-period-chips" id="periodChips" role="tablist" aria-label="Период">' +
      PERIODS.map((p, i) =>
        '<button type="button" class="jp-period-chip' + (i === 0 ? ' is-on' : '') +
        '" data-period="' + p.id + '" role="tab" aria-selected="' + (i === 0 ? 'true' : 'false') + '">' +
        esc(p.label) + '</button>'
      ).join('') +
      '</div>' +
      '<div class="jp-period-hint" id="periodHint"></div>' +
      '</div>' +
      '<div class="jp-body">' +
      '<main class="jp-main" id="jpMain"><div class="jp-loading">Загрузка…</div></main>' +
      '</div>' +
      '<div class="jp-modal-root" id="jpModalRoot" hidden>' +
      '<div class="jp-modal-scrim" data-close-sheet></div>' +
      '<div class="jp-modal" id="jpSheet" role="dialog" aria-modal="true" aria-labelledby="jpModalTitle">' +
      '<div class="jp-sheet-inner" id="sheetInner"></div>' +
      '</div></div>' +
      '<div class="jp-sheet-backdrop" id="sheetBackdrop" hidden></div>' +
      '</div>'
    );
  }

  function bindOnce() {
    if (_bound) return;
    _bound = true;

    document.addEventListener('click', (e) => {
      if (!root()) return;

      if (e.target.closest('#jpModalRoot')) {
        const personInModal = e.target.closest('[data-team-person]');
        if (personInModal) {
          openTeamPerson(personInModal.getAttribute('data-team-person'));
          return;
        }
        const tabBtn = e.target.closest('[data-tab]');
        if (tabBtn && state.modal) {
          state.tab = tabBtn.getAttribute('data-tab');
          renderModal();
          const body = elSheet() && elSheet().querySelector('.modal-body');
          if (body) body.scrollTop = 0;
          return;
        }
        if (e.target.closest('[data-close-sheet]')) {
          closeSheet();
          return;
        }
      }

      const jumpBtn = e.target.closest('#sectionNav [data-jump]');
      if (jumpBtn && root().contains(jumpBtn)) {
        if (state.view === 'list') {
          closeList();
          requestAnimationFrame(() => {
            const sec = document.getElementById('sec-' + jumpBtn.dataset.jump);
            if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        } else {
          const sec = document.getElementById('sec-' + jumpBtn.dataset.jump);
          if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }

      const periodBtn = e.target.closest('#periodChips .jp-period-chip');
      if (periodBtn && root().contains(periodBtn)) {
        setPeriod(periodBtn.dataset.period);
        return;
      }

      const main = elMain();
      if (main && main.contains(e.target)) {
        if (e.target.closest('[data-back-overview]')) {
          closeList();
          return;
        }
        const openListBtn = e.target.closest('[data-open-list]');
        if (openListBtn) {
          openList(
            openListBtn.getAttribute('data-open-list'),
            openListBtn.getAttribute('data-list-status') || 'all'
          );
          return;
        }
        const listStatusBtn = e.target.closest('[data-list-status]');
        if (listStatusBtn && state.view === 'list') {
          state.listStatus = listStatusBtn.getAttribute('data-list-status');
          state.listPage = 1;
          renderMain();
          return;
        }
        const sortBtn = e.target.closest('[data-sort]');
        if (sortBtn) {
          state.listSort = sortBtn.getAttribute('data-sort');
          state.listPage = 1;
          renderMain();
          return;
        }
        const pageBtn = e.target.closest('[data-page]');
        if (pageBtn && !pageBtn.disabled) {
          const n = parseInt(pageBtn.getAttribute('data-page'), 10);
          if (Number.isFinite(n) && n > 0) {
            state.listPage = n;
            renderMain();
          }
          return;
        }
        const stBtn = e.target.closest('[data-status]');
        if (stBtn) {
          openList(stBtn.getAttribute('data-section'), stBtn.getAttribute('data-status'));
          return;
        }
        const itemBtn = e.target.closest('[data-item]');
        if (itemBtn) {
          openSheet(itemBtn.getAttribute('data-section'), itemBtn.getAttribute('data-item'));
          return;
        }
        const toggleAtt = e.target.closest('[data-toggle-attention]');
        if (toggleAtt) {
          state.showAllAttention = !state.showAllAttention;
          renderMain();
          return;
        }
        const teamScopeBtn = e.target.closest('[data-team-scope]');        if (teamScopeBtn) {
          const next = teamScopeBtn.getAttribute('data-team-scope');
          if (next && next !== state.teamScope) {
            state.teamScope = next;
            // Якорь сбрасываем: новый scope должен открыться на текущем периоде.
            state.teamAnchor = null;
            loadTeamOnly();
          }
          return;
        }
        const teamNavBtn = e.target.closest('[data-team-anchor]');
        if (teamNavBtn) {
          const anchor = teamNavBtn.getAttribute('data-team-anchor');
          if (anchor) {
            state.teamAnchor = anchor;
            loadTeamOnly();
          }
          return;
        }
        const teamCurrentBtn = e.target.closest('[data-team-current]');
        if (teamCurrentBtn) {
          state.teamAnchor = null;
          loadTeamOnly();
          return;
        }
        const teamPersonBtn = e.target.closest('[data-team-person]');
        if (teamPersonBtn) {
          openTeamPerson(teamPersonBtn.getAttribute('data-team-person'));
          return;
        }
      }

      if (e.target.closest('[data-close-sheet]')) {
        closeSheet();
        return;
      }
      if (e.target === elBackdrop() || e.target.closest('#sheetBackdrop')) {
        closeSheet();
      }
    });

    document.addEventListener('input', (e) => {
      const s = e.target.closest('[data-list-search]');
      if (!s || !root() || !root().contains(s)) return;
      state.listQuery = s.value;
      state.listPage = 1;
      const section = state.listSection;
      const all = filteredListItems(section);
      const rowsEl = elMain() && elMain().querySelector('.rows--table');
      if (!rowsEl) return;
      const pageItems = all.slice(0, PAGE_SIZE);
      rowsEl.innerHTML = pageItems.length
        ? pageItems.map((x) => rowFor(section, x, findStatusMeta(section, itemStatusId(section, x)))).join('')
        : '<div class="empty">Ничего не найдено. Измените фильтр или период.</div>';
      const info = elMain().querySelector('.pg-info');
      if (info) {
        info.textContent = all.length
          ? '1–' + Math.min(PAGE_SIZE, all.length) + ' из ' + all.length
          : '0 из 0';
      }
      const sumVal = elMain().querySelector('.ls-sum-val');
      if (sumVal) {
        const totalSum = all.reduce((a, x) => a + Number(itemAmount(section, x)), 0);
        sumVal.textContent = moneyShort(totalSum);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const mroot = document.getElementById('jpModalRoot');
      if (state.modal || (mroot && !mroot.hidden)) closeSheet();
    });

    window.addEventListener('resize', () => {
      requestAnimationFrame(morphPeriodChip);
      if (state.modal) positionTabsInd();
    });
  }

  async function render(opts) {
    opts = opts || {};
    _layout = opts.layout;
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    _user = auth.user;

    if (!ALLOWED.includes(_user.role)) {
      toast('Доступ', 'Раздел только для директоров', 'err');
      location.hash = '#/home';
      return;
    }

    const title = opts.title || 'Пульс директора';
    await _layout(shellHtml(), {
      title,
      motto: 'Тендеры · заявки · работы — один контур'
    });

    bindOnce();
    tickNow();
    if (_clockTimer) clearInterval(_clockTimer);
    _clockTimer = setInterval(tickNow, 30000);

    state.period = 'month';
    state.view = 'overview';
    state.listSection = null;
    state.teamScope = 'month';
    state.teamAnchor = null;
    closeSheetSilent();
    await loadOverview();
    requestAnimationFrame(() => {
      morphPeriodChip();
      setTimeout(morphPeriodChip, 50);
    });
  }

  return { render };
})();
