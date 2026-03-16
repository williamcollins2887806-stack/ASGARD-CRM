/**
 * ASGARD CRM — Mobile v3: Ведомости ЗП
 * Route: #/payroll
 * API: GET /api/payroll/sheets, GET /api/payroll/sheets/:id
 */
var PayrollPage = (function () {
  'use strict';

  var el = Utils.el;

  var STATUS_MAP = {
    draft: { label: 'Черновик', color: 'neutral' },
    pending: { label: 'На согласовании', color: 'info' },
    submitted: { label: 'На согласовании', color: 'info' },
    approved: { label: 'Согласовано', color: 'success' },
    paid: { label: 'Оплачено', color: 'success' },
    rework: { label: 'На доработке', color: 'warning' },
    rejected: { label: 'Отклонено', color: 'danger' },
  };

  function buildActions(sh) {
    var actions = [];
    var user = Store.get('user') || {};
    var isManager = ['ADMIN', 'DIRECTOR', 'DIRECTOR_GEN', 'HEAD_PM'].indexOf(user.role) !== -1;

    if (sh.status === 'draft') {
      actions.push({
        label: '📤 Отправить',
        onClick: async function () {
          var ok = await M.Confirm({ title: 'Отправить на согласование?', message: sh.title || 'Ведомость #' + sh.id });
          if (ok) {
            try {
              await API.fetch('/payroll/sheets/' + sh.id + '/submit', { method: 'PUT' });
              M.Toast({ message: 'Отправлено', type: 'success' });
              Router.navigate('/payroll', { replace: true });
            } catch (e) { M.Toast({ message: 'Ошибка: ' + (e.message || e), type: 'error' }); }
          }
        },
      });
    }
    if ((sh.status === 'pending' || sh.status === 'submitted') && isManager) {
      actions.push({
        label: '✓ Согласовать',
        onClick: async function () {
          var ok = await M.Confirm({ title: 'Согласовать ведомость?', message: Utils.formatMoney(sh.total_amount || sh.amount) + ' ₽' });
          if (ok) {
            try {
              await API.fetch('/payroll/sheets/' + sh.id + '/approve', { method: 'PUT' });
              M.Toast({ message: 'Согласовано', type: 'success' });
              Router.navigate('/payroll', { replace: true });
            } catch (e) { M.Toast({ message: 'Ошибка: ' + (e.message || e), type: 'error' }); }
          }
        },
      });
    }
    return actions;
  }

  async function openDetail(sh) {
    var t = DS.t;
    var st = STATUS_MAP[sh.status] || { label: sh.status, color: 'neutral' };
    var content = el('div');

    content.appendChild(M.DetailFields({
      fields: [
        { label: 'Название', value: sh.title || sh.name || 'Ведомость #' + sh.id },
        { label: 'Период', value: sh.period || sh.month || '—' },
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'Общая сумма', value: Utils.formatMoney(parseFloat(sh.total_amount || sh.amount || 0)) + ' ₽' },
        { label: 'Работников', value: String(sh.employee_count || sh.items_count || '—') },
        { label: 'Создано', value: sh.created_at ? Utils.formatDate(sh.created_at) : '—' },
        { label: 'Автор', value: sh.created_by_name || '—' },
      ],
    }));

    try {
      var detail = await API.fetch('/payroll/sheets/' + sh.id);
      var items = detail.items || detail.employees || [];

      if (items.length) {
        content.appendChild(el('div', { style: { height: '16px' } }));
        var itemsSection = el('div');
        itemsSection.appendChild(el('div', {
          style: { ...DS.font('md'), color: t.text, padding: '0 0 8px' },
          textContent: 'Работники (' + items.length + ')',
        }));

        items.slice(0, 20).forEach(function (item) {
          var row = el('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid ' + t.border },
          });
          row.appendChild(el('span', { style: { ...DS.font('sm'), color: t.text }, textContent: item.employee_name || item.name || 'Сотрудник' }));
          row.appendChild(el('span', { style: { ...DS.font('sm'), fontWeight: 600, color: t.text }, textContent: Utils.formatMoney(parseFloat(item.amount || item.total || 0)) + ' ₽' }));
          itemsSection.appendChild(row);
        });

        if (items.length > 20) {
          itemsSection.appendChild(el('div', {
            style: { ...DS.font('xs'), color: t.textTer, textAlign: 'center', padding: '8px' },
            textContent: 'Показаны 20 из ' + items.length,
          }));
        }

        content.appendChild(itemsSection);
      }
    } catch (_) { /* detail load failed — basic info shown */ }

    M.BottomSheet({ title: 'Ведомость #' + sh.id, content: content, fullscreen: true });
  }

  return {
    render: function () {
      var page = el('div', { style: { paddingBottom: '100px' } });
      page.appendChild(M.Header({ title: 'Ведомости', subtitle: 'ЗАРПЛАТА', back: true, backHref: '/home' }));

      var body = el('div');
      body.appendChild(M.Skeleton({ type: 'card', count: 4 }));
      page.appendChild(body);

      setTimeout(async function () {
        var sheets = [];
        var currentFilter = 'all';

        try {
          var data = await API.fetch('/payroll/sheets');
          sheets = Array.isArray(data) ? data : (data.sheets || data.data || []);

          body.replaceChildren();

          var totalAmount = sheets.reduce(function (s, sh) { return s + parseFloat(sh.total_amount || sh.amount || 0); }, 0);
          var pending = sheets.filter(function (s) { return s.status === 'pending' || s.status === 'submitted'; });
          var paid = sheets.filter(function (s) { return s.status === 'paid'; });

          body.appendChild(el('div', { style: { margin: '12px 0 4px' } }, M.Stats({
            items: [
              { icon: '📋', label: 'Всего', value: sheets.length },
              { icon: '⏳', label: 'На согласов.', value: pending.length, color: 'var(--orange)' },
              { icon: '✅', label: 'Оплачено', value: paid.length, color: 'var(--green)' },
              { icon: '💰', label: 'Общая сумма', value: Utils.formatMoney(totalAmount) },
            ],
          })));

          body.appendChild(M.FilterPills({
            items: [
              { label: 'Все', value: 'all', active: true },
              { label: 'Черновики', value: 'draft' },
              { label: 'На согласов.', value: 'pending' },
              { label: 'Согласовано', value: 'approved' },
              { label: 'Оплачено', value: 'paid' },
            ],
            onChange: function (val) { currentFilter = val; renderList(); },
          }));

          var listContainer = el('div', { style: { padding: '12px 0' } });
          body.appendChild(listContainer);

          function renderList() {
            listContainer.replaceChildren();
            var filtered = sheets;
            if (currentFilter !== 'all') {
              filtered = sheets.filter(function (s) { return s.status === currentFilter || (currentFilter === 'pending' && s.status === 'submitted'); });
            }

            if (!filtered.length) {
              listContainer.appendChild(M.Empty({ text: 'Нет ведомостей', type: 'search' }));
              return;
            }

            var sorted = filtered.slice().sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
            var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px' } });

            sorted.forEach(function (sh, i) {
              var st = STATUS_MAP[sh.status] || { label: sh.status, color: 'neutral' };
              list.appendChild(M.Card({
                title: sh.title || sh.name || 'Ведомость #' + sh.id,
                subtitle: sh.period || sh.month || '',
                badge: st.label,
                badgeColor: st.color,
                fields: [
                  { label: 'Сумма', value: Utils.formatMoney(parseFloat(sh.total_amount || sh.amount || 0)) + ' ₽' },
                  { label: 'Работников', value: String(sh.employee_count || sh.items_count || '—') },
                  { label: 'Дата', value: sh.created_at ? Utils.formatDate(sh.created_at) : '—' },
                ],
                animDelay: i * 0.03,
                actions: buildActions(sh),
                onClick: function () { openDetail(sh); },
              }));
            });

            listContainer.appendChild(list);
          }

          renderList();

        } catch (e) {
          body.replaceChildren();
          body.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
          M.Toast({ message: 'Ошибка загрузки: ' + (e.message || e), type: 'error' });
        }
      }, 0);

      return page;
    },
  };
})();

Router.register('/payroll', PayrollPage);
if (typeof window !== 'undefined') window.PayrollPage = PayrollPage;
