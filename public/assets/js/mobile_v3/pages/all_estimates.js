/**
 * ASGARD CRM — Mobile v3: Все расчёты
 * Route: #/all-estimates
 * Данные: GET /api/estimates + AsgardDB
 */
window.MobileAllEstimates = (function () {
  'use strict';

  var el = Utils.el;

  var STATUS_MAP = {
    draft:    { label: 'Черновик',          color: 'neutral' },
    sent:     { label: 'На согласовании',   color: 'info' },
    approved: { label: 'Согласовано',       color: 'success' },
    rework:   { label: 'На доработке',      color: 'warning' },
    question: { label: 'Вопрос',            color: 'gold' },
    rejected: { label: 'Отклонено',         color: 'danger' },
  };

  function statusInfo(s) { return STATUS_MAP[s] || STATUS_MAP.draft; }
  function money(v) { return v ? Number(v).toLocaleString('ru-RU') + ' ₽' : '—'; }
  function fmt(v) { return v ? new Date(v).toLocaleDateString('ru-RU') : '—'; }

  var PAGE_LIMIT = 50;
  var _offset = 0;
  var _hasMore = true;

  async function loadItems() {
    _offset = 0;
    _hasMore = true;
    return API.fetchCached('estimates', '/estimates?limit=' + PAGE_LIMIT + '&offset=0');
  }

  async function loadTenders() {
    return API.fetchCached('tenders', '/data/tenders');
  }

  /* ── Детальная модалка ── */
  function openDetail(est, tenders) {
    var si = statusInfo(est.approval_status);
    var tender = null;
    for (var i = 0; i < tenders.length; i++) {
      if (tenders[i].id === est.tender_id) { tender = tenders[i]; break; }
    }

    var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } });
    content.appendChild(el('div', { style: { display: 'flex', gap: '6px' } }, M.Badge({ text: si.label, color: si.color })));

    var price = Number(est.total_price || est.price || 0);
    var cost = Number(est.total_cost || est.cost || 0);
    var profit = price - cost;
    var marginPct = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;

    var fields = [
      { label: 'Тендер', value: tender ? (tender.customer_name || tender.name || '—') : '—' },
      { label: 'Стоимость', value: money(price) },
      { label: 'Себестоимость', value: money(cost) },
      { label: 'Прибыль', value: money(profit) },
      { label: 'Маржа', value: marginPct + '%', type: 'progress' },
      { label: 'Автор', value: est.author_name || est.created_by_name || '—' },
      { label: 'Создан', value: fmt(est.created_at) },
    ];
    if (est.approval_comment) {
      fields.push({ label: 'Комментарий', value: est.approval_comment });
    }
    if (est.decided_at) {
      fields.push({ label: 'Решение', value: fmt(est.decided_at) });
    }
    content.appendChild(M.DetailFields({ fields: fields }));

    M.BottomSheet({
      title: (tender ? tender.customer_name || tender.name : est.name) || 'Расчёт',
      content: content,
      fullscreen: true,
    });
  }

  /* ── Карточка ── */
  function renderCard(est, idx, tenders) {
    var si = statusInfo(est.approval_status);
    var tender = null;
    for (var i = 0; i < tenders.length; i++) {
      if (tenders[i].id === est.tender_id) { tender = tenders[i]; break; }
    }

    var price = Number(est.total_price || est.price || 0);
    var cost = Number(est.total_cost || est.cost || 0);
    var marginPct = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;

    return M.Card({
      title: tender ? (tender.customer_name || tender.name || 'Расчёт') : (est.name || 'Расчёт #' + est.id),
      subtitle: est.author_name || est.created_by_name || '',
      badge: si.label,
      badgeColor: si.color,
      fields: [
        { label: 'Сумма', value: money(price) },
        { label: 'Маржа', value: marginPct + '%' },
      ],
      time: fmt(est.created_at),
      onClick: function () { openDetail(est, tenders); },
      animDelay: idx * 0.03,
    });
  }

  /* ── Рендер ── */
  async function render() {
    var items = [];
    var tenders = [];

    var page = M.TablePage({
      title: 'Все расчёты',
      subtitle: 'Просчёты и ТКП',
      back: true,
      backHref: '/home',
      search: true,
      items: items,
      renderItem: function (item, idx) { return renderCard(item, idx, tenders); },
      filter: {
        pills: [
          { label: 'Все', value: 'all', active: true },
          { label: 'Черновик', value: 'draft' },
          { label: 'На согл.', value: 'sent' },
          { label: 'Согласовано', value: 'approved' },
          { label: 'Доработка', value: 'rework' },
          { label: 'Отклонено', value: 'rejected' },
        ],
        filterFn: function (item, val) {
          if (val === 'all') return true;
          return item.approval_status === val;
        },
      },
      stats: [
        { icon: '📊', value: 0, label: 'Всего', color: 'var(--blue)' },
        { icon: '✓', value: 0, label: 'Согласовано', color: 'var(--green)' },
        { icon: '⏳', value: 0, label: 'На согл.', color: 'var(--orange)' },
        { icon: '✕', value: 0, label: 'Отклонено', color: 'var(--red)' },
      ],
      empty: M.Empty({ text: 'Нет расчётов', icon: '📄' }),
      onRefresh: async function () {
        try {
          tenders = await loadTenders();
          var loaded = await loadItems();
          loaded.sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
          _offset = loaded.length;
          _hasMore = loaded.length >= PAGE_LIMIT;
          return loaded;
        } catch (e) {
          M.Toast({ message: 'Ошибка загрузки расчётов', type: 'error' });
          return [];
        }
      },
      loadMore: async function () {
        if (!_hasMore) return [];
        try {
          var rows = await API.fetchCached('estimates', '/estimates?limit=' + PAGE_LIMIT + '&offset=' + _offset);
          _offset += rows.length;
          if (rows.length < PAGE_LIMIT) _hasMore = false;
          rows.sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
          return rows;
        } catch (_) { return []; }
      },
    });

    // Show skeleton while initial data loads
    var listEl = page.querySelector('.asgard-table-page__list');
    if (listEl) listEl.replaceChildren(M.Skeleton({ type: 'card', count: 5 }));
    setTimeout(function () { window.dispatchEvent(new Event('asgard:refresh')); }, 0);

    return page;
  }

  return { render: render };
})();

if (typeof Router !== 'undefined') {
  Router.register('/all-estimates', window.MobileAllEstimates);
}
