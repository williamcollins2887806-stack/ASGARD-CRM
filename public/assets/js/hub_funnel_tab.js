/**
 * Hub Funnel tab — воронка на #/tenders (ванильный десктоп).
 * Режим «Заявки»: Маркетплейс + 9 колонок PK3.
 */
window.AsgardHubFunnel = (function () {
  const esc = (AsgardUI && AsgardUI.esc) || ((s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c])));
  const money = (v) => (window.AsgardMoney && AsgardMoney.formatMoney)
    ? AsgardMoney.formatMoney(v)
    : ((v == null || v === '') ? '—' : (Number(v).toLocaleString('ru-RU') + ' ₽'));

  const TENDER_COLS = ['рассмотрение', 'готовим', 'подались', 'выиграли', 'проиграли', 'отмена'];
  const LABELS = {
    рассмотрение: 'Рассмотрение', готовим: 'Готовим', подались: 'Подались',
    выиграли: 'Выиграли', проиграли: 'Проиграли', отмена: 'Отмена'
  };
  const APP_COLS = [
    { id: 'marketplace', label: 'Маркетплейс', tone: 'marketplace' },
    { id: 'new', label: 'Новые', tone: 'new' },
    { id: 'calc', label: 'Просчёт', tone: 'calc' },
    { id: 'approval', label: 'Согласование', tone: 'approval' },
    { id: 'kp_prep', label: 'Подготовка КП', tone: 'kp_prep' },
    { id: 'sent', label: 'КП ушло', tone: 'sent' },
    { id: 'addendum', label: 'Дозапрос', tone: 'addendum' },
    { id: 'win', label: 'Выиграно', tone: 'win' },
    { id: 'lose', label: 'Проиграно', tone: 'lose' },
    { id: 'work', label: 'В работу', tone: 'work' }
  ];

  let mountEl = null;
  let state = {
    mode: 'tenders',
    period: 'month',
    marketplace: [],
    kanban: [],
    loadingApps: false,
    sheetItem: null
  };
  let tendersCache = [];

  function periodBounds(period) {
    const now = new Date();
    const y = now.getFullYear();
    if (period === 'ytd') {
      return { start: new Date(y, 0, 1).getTime(), end: now.getTime(), label: 'С начала года' };
    }
    if (period === 'year') {
      return { start: new Date(y, 0, 1).getTime(), end: new Date(y, 11, 31, 23, 59, 59).getTime(), label: 'Год' };
    }
    const start = new Date(y, now.getMonth(), 1);
    const end = new Date(y, now.getMonth() + 1, 0, 23, 59, 59);
    return { start: start.getTime(), end: end.getTime(), label: 'Месяц' };
  }

  function inPeriod(iso, bounds) {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return !Number.isNaN(t) && t >= bounds.start && t <= bounds.end;
  }

  function itemDate(item) {
    return item?.event_at || item?.last_moved_at || item?.created_at || item?.won_at || item?.submitted_at || null;
  }

  function fmtDate(v) {
    if (!v) return '—';
    const s = String(v).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : s;
  }

  function daysLeft(dl) {
    if (!dl) return null;
    return Math.floor((new Date(dl).getTime() - Date.now()) / 86400000);
  }

  function allApps() {
    return (state.marketplace || []).concat(state.kanban || []);
  }

  function filteredApps(bounds) {
    const mp = (state.marketplace || []);
    const kb = (state.kanban || []).filter((a) => inPeriod(itemDate(a), bounds));
    return mp.concat(kb);
  }

  function authTokenQs() {
    try {
      const t = (window.AsgardAuth && AsgardAuth.getToken && AsgardAuth.getToken()) ||
        localStorage.getItem('token') || '';
      return t ? ('?token=' + encodeURIComponent(t)) : '';
    } catch (_) {
      return '';
    }
  }

  function appCardHtml(item, i) {
    const left = daysLeft(item.deadline || item.docs_deadline);
    const hot = left != null && left >= 0 && left <= 3;
    const title = item.title || item.customer_name || ('Заявка #' + item.id);
    const subParts = [];
    if (item.source_label) subParts.push(item.source_label);
    subParts.push(item.owner_name || 'не взята');
    if (item.docs_count) subParts.push(item.docs_count + ' док.');
    return '<button type="button" class="hub-funnel-card' + (hot ? ' is-hot' : '') +
      '" data-app-key="' + esc(item.source_bucket + ':' + item.kind + ':' + item.id) +
      '" style="animation-delay:' + (i * 20) + 'ms">' +
      '<div class="hub-funnel-card-top">' +
      '<span class="hub-funnel-card-id">#' + esc(item.id) + '</span>' +
      (hot ? '<span class="hub-funnel-hot">🔥 ' + left + 'д</span>' : '') +
      '</div>' +
      '<div class="hub-funnel-card-title">' + esc(title) + '</div>' +
      '<div class="hub-funnel-card-sub">' + esc(subParts.join(' · ')) + '</div>' +
      '<div class="hub-funnel-card-meta"><span>' + esc(fmtDate(item.deadline || itemDate(item))) + '</span>' +
      '<span class="hub-funnel-card-price">' + esc(item.estimated_sum ? money(item.estimated_sum) : '—') + '</span></div>' +
      '</button>';
  }

  function tenderCardHtml(item, i) {
    const left = daysLeft(item.docs_deadline);
    const hot = left != null && left >= 0 && left <= 3;
    const price = item.submission_price_with_vat || item.tender_price || item._sum;
    return '<button type="button" class="hub-funnel-card" data-tender-id="' + item.id + '" style="animation-delay:' + (i * 20) + 'ms">' +
      '<div class="hub-funnel-card-top">' +
      '<span class="hub-funnel-card-id">#' + esc(item.registry_no || item.id) + '</span>' +
      (hot ? '<span class="hub-funnel-hot">🔥 ' + left + 'д</span>' : '') +
      '</div>' +
      '<div class="hub-funnel-card-title">' + esc(item.customer_name || item.title || 'Без названия') + '</div>' +
      '<div class="hub-funnel-card-sub">' + esc(String(item.tender_title || item.subject || '').slice(0, 72) || '—') + '</div>' +
      '<div class="hub-funnel-card-meta"><span>' + esc(fmtDate(item.docs_deadline || itemDate(item))) + '</span>' +
      '<span class="hub-funnel-card-price">' + esc(price ? money(price) : '—') + '</span></div>' +
      (item.assigned_pm_name || item.pm_name || item.work_pm_name
        ? '<div class="hub-funnel-card-sub" style="margin-top:4px;opacity:.85">РП: ' + esc(item.assigned_pm_name || item.pm_name || item.work_pm_name) + '</div>'
        : '') +
      '</button>';
  }

  function sheetHtml(item) {
    if (!item) return '';
    const docs = Array.isArray(item.documents) ? item.documents : [];
    const qs = authTokenQs();
    const docsHtml = docs.length
      ? '<ul class="hub-funnel-docs">' + docs.map((d) => {
          const url = (d.download_url || '#') + (d.download_url ? qs : '');
          return '<li><a href="' + esc(url) + '" target="_blank" rel="noopener">' +
            esc(d.filename || 'Документ') + '</a></li>';
        }).join('') + '</ul>'
      : '<div class="muted" style="font-size:12px">Документов нет</div>';
    const openLabel = item.source_bucket === 'marketplace' ? 'Открыть в маркетплейсе' : 'Открыть в канбане';
    return '<div class="hub-funnel-sheet-backdrop" data-sheet-close="1">' +
      '<div class="hub-funnel-sheet" role="dialog" aria-modal="true">' +
      '<div class="hub-funnel-sheet-h">' +
      '<div><div class="hub-funnel-sheet-title">' + esc(item.title || item.customer_name || 'Заявка') + '</div>' +
      '<div class="muted" style="font-size:12px">#' + esc(item.id) + ' · ' + esc(item.source_label || item.kind || '') + '</div></div>' +
      '<button type="button" class="hub-funnel-sheet-x" data-sheet-close="1" aria-label="Закрыть">×</button>' +
      '</div>' +
      '<div class="hub-funnel-sheet-body">' +
      '<p class="hub-funnel-sheet-text">' + esc(item.work_description || item.work_title || '—') + '</p>' +
      '<div class="hub-funnel-kv">' +
      '<span>Заказчик</span><b>' + esc(item.customer_name || '—') + '</b>' +
      '<span>ИНН</span><b>' + esc(item.customer_inn || '—') + '</b>' +
      '<span>Контакт</span><b>' + esc([item.contact_person, item.contact_phone].filter(Boolean).join(' · ') || '—') + '</b>' +
      '<span>Статус</span><b>' + esc(item.status || item.funnel_column || '—') + '</b>' +
      '<span>РП</span><b>' + esc(item.owner_name || 'не взята') + '</b>' +
      '<span>Дедлайн</span><b>' + esc(fmtDate(item.deadline)) + '</b>' +
      '</div>' +
      '<div class="hub-funnel-sheet-docs-h">Документы (' + docs.length + ')</div>' +
      docsHtml +
      '</div>' +
      '<div class="hub-funnel-sheet-foot">' +
      (item.open_hash
        ? '<a class="btn sm" href="' + esc(item.open_hash) + '">' + esc(openLabel) + '</a>'
        : '') +
      '<button type="button" class="btn sm" data-sheet-close="1">Закрыть</button>' +
      '</div></div></div>';
  }

  function analyticsChipsHtml(bounds) {
    if (state.mode === 'apps') {
      const apps = filteredApps(bounds);
      const mp = apps.filter((a) => a.funnel_column === 'marketplace').length;
      const inWork = apps.filter((a) => a.funnel_column !== 'marketplace').length;
      const calc = apps.filter((a) => a.funnel_column === 'calc').length;
      const sent = apps.filter((a) => a.funnel_column === 'sent').length;
      const win = apps.filter((a) => a.funnel_column === 'win').length;
      const lose = apps.filter((a) => a.funnel_column === 'lose').length;
      const burn = apps.filter((a) => {
        const left = daysLeft(a.deadline);
        return left != null && left >= 0 && left <= 3;
      }).length;
      const byPm = {};
      apps.forEach((a) => {
        if (!a.owner_name) return;
        byPm[a.owner_name] = (byPm[a.owner_name] || 0) + 1;
      });
      const topPm = Object.entries(byPm).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const chip = (label, value, tone) =>
        '<div class="hub-funnel-chip' + (tone ? ' tone-' + tone : '') + '"><span class="hub-funnel-chip-l">' + esc(label) +
        '</span><span class="hub-funnel-chip-v">' + esc(String(value)) + '</span></div>';
      return chip('Маркетплейс', mp) +
        chip('В работе у РП', inWork, 'info') +
        chip('На просчёте', calc) +
        chip('КП ушло', sent, 'info') +
        chip('Выиграно', win, 'ok') +
        chip('Проиграно', lose, 'err') +
        chip('Горящие ≤3д', burn, 'err') +
        (topPm[0]
          ? chip('Топ РП', topPm.map(([n, c]) => n.split(' ')[0] + ' (' + c + ')').join(' · '), 'gold')
          : '');
    }

    const list = tendersCache.filter((t) =>
      inPeriod(itemDate(t), bounds) || inPeriod(t.won_at, bounds) || inPeriod(t.submitted_at, bounds)
    );
    const pipeline = list.filter((t) => ['рассмотрение', 'готовим', 'подались'].includes(t.registry_status)).length;
    const submitted = list.filter((t) => t.registry_status === 'подались');
    const won = list.filter((t) => t.registry_status === 'выиграли' || t.tender_status === 'Выиграли');
    const lost = list.filter((t) => t.registry_status === 'проиграли' || t.tender_status === 'Проиграли');
    const burn = list.filter((t) => {
      if (['отмена', 'выиграли', 'проиграли'].includes(t.registry_status)) return false;
      const left = daysLeft(t.docs_deadline);
      return left != null && left >= 0 && left <= 3;
    }).length;
    const subSum = submitted.reduce((s, t) => s + (Number(t.submission_price_with_vat) || 0), 0);
    const convN = won.length + lost.length;
    const winPct = convN ? Math.round((won.length / convN) * 100) : null;
    const chip = (label, value, tone) =>
      '<div class="hub-funnel-chip' + (tone ? ' tone-' + tone : '') + '"><span class="hub-funnel-chip-l">' + esc(label) +
      '</span><span class="hub-funnel-chip-v">' + esc(String(value)) + '</span></div>';
    return chip('Пайплайн', pipeline) +
      chip('Подались', submitted.length, 'info') +
      chip('Выиграно', won.length, 'ok') +
      chip('Проиграно', lost.length, 'err') +
      chip('Конверсия', winPct != null ? winPct + '%' : '—', 'gold') +
      chip('Горящие ≤3д', burn, 'err') +
      chip('Сумма подач', money(subSum), 'gold');
  }

  function findAppByKey(key) {
    return allApps().find((a) => (a.source_bucket + ':' + a.kind + ':' + a.id) === key) || null;
  }

  function render() {
    if (!mountEl) return;
    const bounds = periodBounds(state.period);
    const filteredTenders = tendersCache.filter((t) =>
      inPeriod(itemDate(t), bounds) || inPeriod(t.won_at, bounds) || inPeriod(t.submitted_at, bounds)
    );
    const apps = filteredApps(bounds);

    let columns;
    if (state.mode === 'tenders') {
      const map = Object.fromEntries(TENDER_COLS.map((c) => [c, []]));
      filteredTenders.forEach((t) => {
        const st = t.registry_status || 'рассмотрение';
        (map[st] || map.рассмотрение).push(t);
      });
      columns = TENDER_COLS.map((id) => ({ id, label: LABELS[id] || id, items: map[id] || [] }));
    } else {
      const map = Object.fromEntries(APP_COLS.map((c) => [c.id, []]));
      apps.forEach((a) => {
        const col = a.funnel_column && map[a.funnel_column] ? a.funnel_column : 'new';
        map[col].push(a);
      });
      columns = APP_COLS.map((c) => ({ id: c.id, label: c.label, tone: c.tone, items: map[c.id] || [] }));
    }

    let html = '<div class="hub-funnel">' +
      '<div class="hub-funnel-toolbar">' +
      '<div class="hub-funnel-seg" role="tablist">' +
      '<button type="button" class="' + (state.mode === 'tenders' ? 'on' : '') + '" data-mode="tenders">Тендеры <span class="hub-funnel-seg-n">' + filteredTenders.length + '</span></button>' +
      '<button type="button" class="' + (state.mode === 'apps' ? 'on' : '') + '" data-mode="apps">Заявки <span class="hub-funnel-seg-n">' + apps.length + '</span></button>' +
      '</div>' +
      '<div class="hub-funnel-period">' +
      [['month', 'Месяц'], ['ytd', 'С начала года'], ['year', 'Год']].map(([id, label]) =>
        '<button type="button" class="' + (state.period === id ? 'on' : '') + '" data-period="' + id + '">' + label + '</button>'
      ).join('') +
      '</div></div>' +
      '<div class="hub-funnel-analytics">' + analyticsChipsHtml(bounds) + '</div>' +
      '<div class="hub-funnel-board mode-' + state.mode + (state.mode === 'apps' && state.loadingApps ? ' is-loading' : '') + '">';

    columns.forEach((col) => {
      html += '<div class="hub-funnel-col tone-' + esc(col.tone || col.id) + '">' +
        '<div class="hub-funnel-col-h"><span class="hub-funnel-col-title">' + esc(col.label) + '</span>' +
        '<span class="hub-funnel-col-n">' + (state.loadingApps && state.mode === 'apps' ? '…' : col.items.length) + '</span></div>' +
        '<div class="hub-funnel-col-body">';
      if (state.mode === 'apps' && state.loadingApps) {
        html += '<div class="hub-funnel-skel"></div><div class="hub-funnel-skel"></div><div class="hub-funnel-skel"></div>';
      } else if (!col.items.length) {
        html += '<div class="hub-funnel-empty">Пусто за период</div>';
      } else {
        col.items.slice(0, 40).forEach((item, i) => {
          html += state.mode === 'apps' ? appCardHtml(item, i) : tenderCardHtml(item, i);
        });
        if (col.items.length > 40) html += '<div class="hub-funnel-more">ещё ' + (col.items.length - 40) + '</div>';
      }
      html += '</div></div>';
    });
    html += '</div>';

    const totalVisible = state.mode === 'tenders' ? filteredTenders.length : apps.length;
    if (!totalVisible && !(state.mode === 'apps' && state.loadingApps)) {
      html += '<div class="hub-funnel-zero"><div class="hub-funnel-zero-ic">⌁</div>' +
        '<div>За ' + esc(bounds.label.toLowerCase()) + ' записей нет</div>' +
        '<div class="muted" style="font-size:12px">Смените период или переключатель выше</div></div>';
    }
    html += sheetHtml(state.sheetItem);
    html += '</div>';
    mountEl.innerHTML = html;
    bind();
  }

  function bind() {
    mountEl.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.mode = btn.getAttribute('data-mode');
        state.sheetItem = null;
        render();
        if (state.mode === 'apps') loadApps();
      });
    });
    mountEl.querySelectorAll('[data-period]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.period = btn.getAttribute('data-period');
        render();
      });
    });
    mountEl.querySelectorAll('[data-app-key]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = btn.getAttribute('data-app-key');
        state.sheetItem = findAppByKey(key);
        render();
      });
    });
    mountEl.querySelectorAll('[data-sheet-close]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target !== el && !el.classList.contains('hub-funnel-sheet-x') && el.tagName !== 'BUTTON') return;
        if (el.classList.contains('hub-funnel-sheet-backdrop') && e.target !== el) return;
        state.sheetItem = null;
        render();
      });
    });
  }

  async function loadApps() {
    state.loadingApps = true;
    render();
    try {
      const a = await AsgardAuth.getAuth();
      const res = await fetch('/api/tenders-hub/funnel-apps', {
        headers: { Authorization: 'Bearer ' + a.token }
      });
      const data = res.ok ? await res.json() : {};
      state.marketplace = data.marketplace || [];
      state.kanban = data.kanban || [];
    } catch (_) {
      state.marketplace = [];
      state.kanban = [];
    }
    state.loadingApps = false;
    render();
  }

  return {
    mount(el, opts) {
      mountEl = el;
      tendersCache = (opts && opts.tenders) || [];
      state.mode = 'tenders';
      state.period = 'month';
      state.sheetItem = null;
      render();
      loadApps();
    },
    unmount() {
      if (mountEl) mountEl.innerHTML = '';
      mountEl = null;
    }
  };
})();
