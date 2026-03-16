/**
 * ASGARD CRM — Mobile v3: Список тендеров
 * Route: #/tenders
 * Данные: AsgardDB.all('tenders')
 */
window.MobileTenders = (function () {
  'use strict';

  var STATUS_MAP = {
    'Черновик':          { label: 'Черновик',          color: 'neutral' },
    'Новый':             { label: 'Новый',             color: 'neutral' },
    'Получен':           { label: 'Получен',           color: 'info' },
    'В просчёте':        { label: 'В просчёте',        color: 'info' },
    'На просчёте':       { label: 'На просчёте',       color: 'info' },
    'КП отправлено':     { label: 'КП отправлено',     color: 'warning' },
    'ТКП отправлено':    { label: 'ТКП отправлено',    color: 'warning' },
    'На согласовании':   { label: 'На согласовании',   color: 'info' },
    'Переговоры':        { label: 'Переговоры',        color: 'warning' },
    'Выиграли':          { label: 'Выиграли',          color: 'success' },
    'Контракт':          { label: 'Контракт',          color: 'success' },
    'Проиграли':         { label: 'Проиграли',         color: 'danger' },
    'Отказ':             { label: 'Отказ',             color: 'danger' },
    'В работе':          { label: 'В работе',          color: 'info' },
  };

  function statusInfo(s) {
    if (!s) return { label: 'Новый', color: 'neutral' };
    return STATUS_MAP[s] || { label: s, color: 'neutral' };
  }

  function money(v) { return v ? Number(v).toLocaleString('ru-RU') + ' ₽' : '—'; }
  function fmt(v) { return v ? new Date(v).toLocaleDateString('ru-RU') : '—'; }

  async function loadItems() {
    try {
      if (typeof AsgardDB !== 'undefined') {
        return (await AsgardDB.all('tenders')) || [];
      }
    } catch (_) {}
    try {
      var data = await API.fetch('/data/tenders');
      return API.extractRows(data);
    } catch (_) {}
    return [];
  }

  /* ── Детальная модалка ── */
  function openDetail(tender) {
    var el = Utils.el;
    var si = statusInfo(tender.status);
    var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } });

    // Status pill
    content.appendChild(el('div', { style: { display: 'flex', gap: '6px' } }, M.Badge({ text: si.label, color: si.color })));

    // Fields
    var fields = [
      { label: 'Заказчик', value: tender.customer_name || tender.client || '—' },
      { label: 'Сумма', value: money(tender.amount || tender.price) },
      { label: 'Дедлайн', value: fmt(tender.deadline || tender.submission_deadline) },
      { label: 'РП', value: tender.manager_name || tender.rp || '—' },
      { label: 'Создан', value: fmt(tender.created_at) },
    ];
    if (tender.source) fields.push({ label: 'Источник', value: tender.source });
    if (tender.region) fields.push({ label: 'Регион', value: tender.region });
    if (tender.margin != null) fields.push({ label: 'Маржа', value: tender.margin + '%' });
    content.appendChild(M.DetailFields({ fields: fields }));

    // Description
    if (tender.description || tender.work_description) {
      var desc = el('div', { style: { padding: '12px', background: 'var(--surface-alt)', borderRadius: '12px' } });
      desc.appendChild(el('div', { style: { ...DS.font('xs'), color: 'var(--text-ter)', marginBottom: '4px' }, textContent: 'Описание' }));
      desc.appendChild(el('div', { style: { ...DS.font('sm'), color: 'var(--text-sec)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }, textContent: tender.description || tender.work_description }));
      content.appendChild(desc);
    }

    // Documents
    var docs = tender.documents || tender.files || [];
    if (docs.length) {
      var docsBlock = el('div');
      docsBlock.appendChild(el('div', { style: { ...DS.font('sm'), color: 'var(--text-ter)', marginBottom: '6px' }, textContent: '📎 Документы (' + docs.length + ')' }));
      docs.forEach(function (d) {
        var row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' } });
        row.appendChild(el('span', { style: { fontSize: '14px' }, textContent: '📄' }));
        row.appendChild(el('span', { style: { ...DS.font('sm'), color: 'var(--blue)', fontWeight: 600 }, textContent: d.original_filename || d.name || 'Файл' }));
        docsBlock.appendChild(row);
      });
      content.appendChild(docsBlock);
    }

    // History
    var history = tender.history || tender.status_history || [];
    if (history.length) {
      content.appendChild(M.Timeline({
        items: history.slice(0, 10).map(function (h) {
          return {
            title: h.status || h.action || '',
            text: h.user || h.actor || '',
            time: fmt(h.created_at || h.date),
            color: 'var(--blue)',
          };
        }),
      }));
    }

    // Actions
    var actRow = el('div', { style: { display: 'flex', gap: '8px' } });
    actRow.appendChild(M.FullWidthBtn({
      label: '📈 Воронка',
      variant: 'secondary',
      onClick: function () {
        document.querySelectorAll('.asgard-sheet-overlay').forEach(function (o) { o.remove(); });
        Utils.unlockScroll();
        Router.navigate('/funnel');
      },
    }));
    actRow.appendChild(M.FullWidthBtn({
      label: '🧮 Просчёт',
      variant: 'secondary',
      onClick: function () {
        document.querySelectorAll('.asgard-sheet-overlay').forEach(function (o) { o.remove(); });
        Utils.unlockScroll();
        Router.navigate('/pm-calcs', { query: { tender_id: tender.id } });
      },
    }));
    content.appendChild(actRow);

    M.BottomSheet({
      title: tender.customer_name || tender.client || tender.name || 'Тендер',
      content: content,
      fullscreen: true,
    });
  }

  /* ── Карточка ── */
  function renderCard(item, idx) {
    var si = statusInfo(item.status);
    var fields = [];
    if (item.amount || item.price) fields.push({ label: 'Сумма', value: money(item.amount || item.price) });
    if (item.manager_name || item.rp) fields.push({ label: 'РП', value: item.manager_name || item.rp });
    var deadline = item.deadline || item.submission_deadline;
    if (deadline) fields.push({ label: 'Дедлайн', value: fmt(deadline) });

    return M.Card({
      title: item.customer_name || item.client || 'Тендер',
      subtitle: item.name || item.title || '',
      badge: si.label,
      badgeColor: si.color,
      fields: fields,
      time: fmt(deadline),
      onClick: function () { openDetail(item); },
      animDelay: idx * 0.03,
    });
  }

  /* ── Рендер ── */
  async function render() {
    var items = [];

    var page = M.TablePage({
      title: 'Тендеры',
      subtitle: 'Все тендеры',
      back: true,
      backHref: '/home',
      search: true,
      items: items,
      renderItem: renderCard,
      filter: {
        pills: [
          { label: 'Все', value: 'all', active: true },
          { label: 'Новые', value: 'new' },
          { label: 'В работе', value: 'wip' },
          { label: 'Выиграно', value: 'won' },
          { label: 'Проиграно', value: 'lost' },
        ],
        filterFn: function (item, val) {
          if (val === 'all') return true;
          var s = (item.status || '').toLowerCase();
          if (val === 'new') return s.includes('новый') || s.includes('получен') || s.includes('черновик');
          if (val === 'wip') return s.includes('просчёт') || s.includes('кп') || s.includes('ткп') || s.includes('переговор') || s.includes('согласован') || s.includes('в работе');
          if (val === 'won') return s.includes('выиграли') || s.includes('контракт') || s.includes('клиент согласился');
          if (val === 'lost') return s.includes('проиграли') || s.includes('отказ');
          return true;
        },
      },
      empty: M.Empty({ text: 'Нет тендеров', icon: '🏆' }),
      onRefresh: async function () {
        try {
          var loaded = await loadItems();
          loaded.sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
          return loaded;
        } catch (e) {
          M.Toast({ message: 'Ошибка загрузки тендеров', type: 'error' });
          return [];
        }
      },
      actions: [{
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
        onClick: function () { Router.navigate('/funnel'); },
      }],
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
  Router.register('/tenders', window.MobileTenders);
}
