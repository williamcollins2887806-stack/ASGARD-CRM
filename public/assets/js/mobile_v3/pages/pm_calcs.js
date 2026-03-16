/**
 * ASGARD CRM — Mobile v3: Просчёты РП
 * Route: #/pm-calcs
 * Данные: AsgardDB.all('estimates'), AsgardDB.all('tenders')
 */
window.MobilePmCalcs = (function () {
  'use strict';

  var el = Utils.el;

  var APPROVAL_MAP = {
    draft:    { label: 'Черновик',          color: 'neutral' },
    sent:     { label: 'На согласовании',   color: 'info' },
    approved: { label: 'Согласовано',       color: 'success' },
    rework:   { label: 'На доработке',      color: 'warning' },
    question: { label: 'Вопрос',            color: 'gold' },
    rejected: { label: 'Отклонено',         color: 'danger' },
  };

  function approvalInfo(s) {
    return APPROVAL_MAP[s] || APPROVAL_MAP.draft;
  }

  function money(v) { return v ? Number(v).toLocaleString('ru-RU') + ' ₽' : '—'; }
  function fmt(v) { return v ? new Date(v).toLocaleDateString('ru-RU') : '—'; }

  async function loadData() {
    var estimates = [];
    var tenders = [];
    try {
      if (typeof AsgardDB !== 'undefined') {
        estimates = (await AsgardDB.all('estimates')) || [];
        tenders = (await AsgardDB.all('tenders')) || [];
      }
    } catch (_) {}
    if (!estimates.length) {
      try {
        var data = await API.fetch('/data/estimates');
        estimates = API.extractRows(data);
      } catch (_) {}
    }
    if (!tenders.length) {
      try {
        var data2 = await API.fetch('/data/tenders');
        tenders = API.extractRows(data2);
      } catch (_) {}
    }
    return { estimates: estimates, tenders: tenders };
  }

  function getTender(tenders, id) {
    for (var i = 0; i < tenders.length; i++) {
      if (tenders[i].id === id) return tenders[i];
    }
    return null;
  }

  /* ── Детальная модалка ── */
  function openDetail(est, tender) {
    var ai = approvalInfo(est.approval_status);
    var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } });

    content.appendChild(el('div', { style: { display: 'flex', gap: '6px' } }, M.Badge({ text: ai.label, color: ai.color })));

    var fields = [
      { label: 'Тендер', value: tender ? (tender.customer_name || tender.name || '—') : '—' },
      { label: 'Стоимость', value: money(est.total_price || est.price) },
      { label: 'Себестоимость', value: money(est.total_cost || est.cost) },
      { label: 'Маржа', value: (est.margin || est.margin_percent || 0) + '%', type: 'progress' },
      { label: 'Создан', value: fmt(est.created_at) },
      { label: 'Автор', value: est.author_name || est.created_by_name || '—' },
    ];
    if (est.approval_comment) {
      fields.push({ label: 'Комментарий', value: est.approval_comment });
    }
    content.appendChild(M.DetailFields({ fields: fields }));

    // Финансовый блок
    var finBlock = el('div', { style: { padding: '14px', background: 'var(--surface-alt)', borderRadius: '14px' } });
    var price = Number(est.total_price || est.price || 0);
    var cost = Number(est.total_cost || est.cost || 0);
    var profit = price - cost;
    var marginPct = price > 0 ? Math.round((profit / price) * 100) : 0;

    var finRow = el('div', { style: { display: 'flex', justifyContent: 'space-around', textAlign: 'center' } });
    [
      { label: 'Цена', val: money(price), cl: 'var(--blue)' },
      { label: 'Себест.', val: money(cost), cl: 'var(--orange)' },
      { label: 'Прибыль', val: money(profit), cl: profit > 0 ? 'var(--green)' : 'var(--red)' },
    ].forEach(function (f) {
      var cell = el('div');
      cell.appendChild(el('div', { style: { ...DS.font('xs'), color: 'var(--text-ter)', marginBottom: '4px' }, textContent: f.label }));
      cell.appendChild(el('div', { style: { ...DS.font('md'), color: f.cl, fontWeight: 700 }, textContent: f.val }));
      finRow.appendChild(cell);
    });
    finBlock.appendChild(finRow);
    finBlock.appendChild(el('div', { style: { marginTop: '10px' } }, M.ProgressBar({ value: Math.max(0, Math.min(100, marginPct)), label: 'Маржа ' + marginPct + '%' })));
    content.appendChild(finBlock);

    // Кнопка «Отправить на согласование»
    if (est.approval_status === 'draft' || est.approval_status === 'rework') {
      content.appendChild(M.FullWidthBtn({
        label: '📤 Отправить на согласование',
        onClick: async function () {
          try {
            if (typeof AsgardDB !== 'undefined') {
              var cur = await AsgardDB.get('estimates', est.id);
              if (cur) {
                cur.approval_status = 'sent';
                cur.sent_for_approval_at = new Date().toISOString();
                await AsgardDB.put('estimates', cur);
              }
            }
            try {
              await API.fetch('/data/estimates/' + est.id, {
                method: 'PUT',
                body: { approval_status: 'sent' },
              });
            } catch (_) {}
            M.Toast({ message: 'Отправлено на согласование', type: 'success' });
            document.querySelectorAll('.asgard-sheet-overlay').forEach(function (o) { o.remove(); });
            Utils.unlockScroll();
            window.dispatchEvent(new Event('asgard:refresh'));
          } catch (e) {
            M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' });
          }
        },
      }));
    }

    M.BottomSheet({
      title: (tender ? tender.customer_name || tender.name : '') || 'Просчёт',
      content: content,
      fullscreen: true,
    });
  }

  /* ── Карточка ── */
  function renderCard(est, idx, tenders) {
    var ai = approvalInfo(est.approval_status);
    var tender = getTender(tenders, est.tender_id);
    var tenderName = tender ? (tender.customer_name || tender.name || '') : '';
    var price = Number(est.total_price || est.price || 0);
    var cost = Number(est.total_cost || est.cost || 0);
    var marginPct = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;

    var fields = [
      { label: 'Цена', value: money(price) },
      { label: 'Себест.', value: money(cost) },
      { label: 'Маржа', value: marginPct + '%' },
    ];

    return M.Card({
      title: tenderName || 'Просчёт #' + (est.id || idx),
      subtitle: est.name || est.description || '',
      badge: ai.label,
      badgeColor: ai.color,
      fields: fields,
      time: fmt(est.created_at),
      onClick: function () { openDetail(est, tender); },
      animDelay: idx * 0.03,
    });
  }

  /* ── Рендер ── */
  async function render(params) {
    var items = [];
    var tenders = [];

    var page = M.TablePage({
      title: 'Просчёты',
      subtitle: 'Расчёты РП',
      back: true,
      backHref: '/home',
      search: true,
      items: items,
      renderItem: function (item, idx) { return renderCard(item, idx, tenders); },
      filter: {
        pills: [
          { label: 'Все', value: 'all', active: true },
          { label: 'Черновики', value: 'draft' },
          { label: 'На согласовании', value: 'sent' },
          { label: 'Согласовано', value: 'approved' },
          { label: 'Доработка', value: 'rework' },
        ],
        filterFn: function (item, val) {
          if (val === 'all') return true;
          return item.approval_status === val;
        },
      },
      empty: M.Empty({ text: 'Нет просчётов', icon: '🧮' }),
      onRefresh: async function () {
        try {
          var d = await loadData();
          tenders = d.tenders;
          var ests = d.estimates;
          if (params && params.tender_id) {
            ests = ests.filter(function (e) { return String(e.tender_id) === String(params.tender_id); });
          }
          ests.sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
          return ests;
        } catch (e) {
          M.Toast({ message: 'Ошибка загрузки просчётов', type: 'error' });
          return [];
        }
      },
      fab: {
        icon: '+',
        onClick: function () { M.Toast({ message: 'Быстрый просчёт — в разработке', type: 'info' }); },
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
  Router.register('/pm-calcs', window.MobilePmCalcs);
}
