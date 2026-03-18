/**
 * ASGARD CRM — Mobile v3: Касса (управление)
 * Route: #/cash-admin
 * API: GET /api/cash/all, GET /api/cash/balance
 */
var CashAdminPage = (function () {
  'use strict';

  var el = Utils.el;

  var STATUS_MAP = {
    requested: { label: 'На согласовании', color: 'info' },
    approved: { label: 'Согласовано', color: 'success' },
    money_issued: { label: 'Выдано', color: 'gold' },
    received: { label: 'Получено', color: 'info' },
    reporting: { label: 'На отчёте', color: 'warning' },
    closed: { label: 'Закрыто', color: 'success' },
    rejected: { label: 'Отклонено', color: 'danger' },
  };

  function openIssueModal(r) {
    var content = el('div');
    content.appendChild(M.DetailFields({
      fields: [
        { label: 'Сотрудник', value: r.user_name || '—' },
        { label: 'Сумма', value: Utils.formatMoney(parseFloat(r.amount || 0)) + ' ₽' },
        { label: 'Назначение', value: r.purpose || '—' },
      ],
    }));
    content.appendChild(el('div', { style: { height: '16px' } }));
    content.appendChild(M.Form({
      fields: [
        { id: 'amount', label: 'Сумма выдачи, ₽', type: 'number', value: String(r.amount || ''), required: true },
        { id: 'comment', label: 'Комментарий', type: 'textarea', placeholder: 'Способ выдачи...' },
      ],
      submitLabel: '💵 Выдать наличные',
      onSubmit: async function (data) {
        try {
          await API.fetch('/cash/' + r.id + '/issue', { method: 'PUT', body: { amount: parseFloat(data.amount), comment: data.comment } });
          sheetRef.close();
          M.Toast({ message: 'Наличные выданы', type: 'success' });
          Router.navigate('/cash-admin', { replace: true });
        } catch (e) { M.Toast({ message: 'Ошибка: ' + (e.message || e), type: 'error' }); }
      },
    }));
    var sheetRef = M.BottomSheet({ title: 'Выдача наличных', content: content, fullscreen: false });
  }

  function openDetail(r) {
    var st = STATUS_MAP[r.status] || { label: r.status, color: 'neutral' };
    var content = el('div');
    content.appendChild(M.DetailFields({
      fields: [
        { label: 'Сотрудник', value: r.user_name || '—' },
        { label: 'Назначение', value: r.purpose || r.description || '—' },
        { label: 'Сумма', value: Utils.formatMoney(parseFloat(r.amount || 0)) + ' ₽' },
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'Работа', value: r.work_title || '—' },
        { label: 'Создано', value: r.created_at ? Utils.formatDate(r.created_at) : '—' },
        { label: 'Выдал', value: r.issued_by_name || '—' },
        { label: 'Комментарий', value: r.comment || '—' },
      ],
    }));

    if (r.status === 'requested' || r.status === 'approved') {
      content.appendChild(el('div', { style: { height: '16px' } }));
      var btns = el('div', { style: { display: 'flex', gap: '8px' } });
      if (r.status === 'requested') {
        btns.appendChild(M.FullWidthBtn({
          label: '✓ Согласовать',
          onClick: async function () {
            try {
              await API.fetch('/cash/' + r.id + '/approve', { method: 'PUT', body: {} });
              sheetRef.close();
              M.Toast({ message: 'Согласовано', type: 'success' });
              Router.navigate('/cash-admin', { replace: true });
            } catch (e) { M.Toast({ message: 'Ошибка: ' + (e.message || e), type: 'error' }); }
          },
        }));
      }
      if (r.status === 'approved') {
        btns.appendChild(M.FullWidthBtn({
          label: '💵 Выдать',
          onClick: function () { sheetRef.close(); openIssueModal(r); },
        }));
      }
      content.appendChild(btns);
    }

    var sheetRef = M.BottomSheet({ title: 'Заявка #' + r.id, content: content, fullscreen: false });
  }

  function buildActions(r) {
    var actions = [];
    if (r.status === 'requested') {
      actions.push({
        label: '✓ Согласовать',
        onClick: async function () {
          var ok = await M.Confirm({ title: 'Согласовать заявку?', message: r.user_name + ' — ' + Utils.formatMoney(r.amount) + ' ₽' });
          if (ok) {
            try {
              await API.fetch('/cash/' + r.id + '/approve', { method: 'PUT', body: {} });
              M.Toast({ message: 'Согласовано', type: 'success' });
              Router.navigate('/cash-admin', { replace: true });
            } catch (e) { M.Toast({ message: 'Ошибка: ' + (e.message || e), type: 'error' }); }
          }
        },
      });
      actions.push({
        label: '✕ Отклонить',
        onClick: async function () {
          var ok = await M.Confirm({ title: 'Отклонить заявку?', message: r.user_name + ' — ' + Utils.formatMoney(r.amount) + ' ₽', danger: true });
          if (ok) {
            try {
              await API.fetch('/cash/' + r.id + '/reject', { method: 'PUT', body: { comment: 'Отклонено с мобильного' } });
              M.Toast({ message: 'Отклонено', type: 'info' });
              Router.navigate('/cash-admin', { replace: true });
            } catch (e) { M.Toast({ message: 'Ошибка: ' + (e.message || e), type: 'error' }); }
          }
        },
      });
    }
    if (r.status === 'approved') {
      actions.push({ label: '💵 Выдать', onClick: function () { openIssueModal(r); } });
    }
    return actions;
  }

  return {
    render: function () {
      var page = el('div', { style: { paddingBottom: '100px' } });
      page.appendChild(M.Header({ title: 'Касса', subtitle: 'УПРАВЛЕНИЕ', back: true, backHref: '/home' }));

      var body = el('div');
      body.appendChild(M.Skeleton({ type: 'hero', count: 1 }));
      body.appendChild(el('div', { style: { height: '12px' } }));
      body.appendChild(M.Skeleton({ type: 'card', count: 4 }));
      page.appendChild(body);

      setTimeout(async function () {
        var allRequests = [];
        var currentFilter = 'all';

        try {
          var results = await Promise.all([
            API.fetch('/cash/balance'),
            API.fetch('/cash/all'),
          ]);
          var balanceData = results[0] || {};
          var reqData = results[1];
          allRequests = API.extractRows(reqData);

          body.replaceChildren();

          // Balance hero
          var heroWrap = el('div', { style: { padding: '12px 20px' } });
          heroWrap.appendChild(M.HeroCard({
            label: 'БАЛАНС КАССЫ',
            value: Utils.formatMoney(parseFloat(balanceData.total_balance || balanceData.balance || 0)),
            valueSuffix: ' ₽',
            details: [
              { label: 'Выдано', value: Utils.formatMoney(parseFloat(balanceData.total_issued || 0)) + ' ₽' },
              { label: 'Потрачено', value: Utils.formatMoney(parseFloat(balanceData.total_spent || 0)) + ' ₽' },
              { label: 'Возвращено', value: Utils.formatMoney(parseFloat(balanceData.total_returned || 0)) + ' ₽', color: DS.t.green },
            ],
          }));
          body.appendChild(heroWrap);

          // Stats
          var pending = allRequests.filter(function (r) { return r.status === 'requested'; });
          var issued = allRequests.filter(function (r) { return r.status === 'money_issued' || r.status === 'received'; });

          body.appendChild(el('div', { style: { margin: '12px 0 4px' } }, M.Stats({
            items: [
              { icon: '📝', label: 'На согласов.', value: pending.length, color: 'var(--orange)' },
              { icon: '💵', label: 'Выдано', value: issued.length, color: 'var(--blue)' },
              { icon: '📋', label: 'Всего заявок', value: allRequests.length },
              { icon: '✅', label: 'Закрыто', value: allRequests.filter(function (r) { return r.status === 'closed'; }).length, color: 'var(--green)' },
            ],
          })));

          body.appendChild(M.FilterPills({
            items: [
              { label: 'Все', value: 'all', active: true },
              { label: 'Ожидают', value: 'requested' },
              { label: 'Согласованы', value: 'approved' },
              { label: 'Выданы', value: 'money_issued' },
              { label: 'Закрыты', value: 'closed' },
            ],
            onChange: function (val) { currentFilter = val; renderList(); },
          }));

          var listContainer = el('div', { style: { padding: '12px 0' } });
          body.appendChild(listContainer);

          function renderList() {
            listContainer.replaceChildren();
            var filtered = currentFilter === 'all' ? allRequests : allRequests.filter(function (r) { return r.status === currentFilter; });

            if (!filtered.length) {
              listContainer.appendChild(M.Empty({ text: 'Нет заявок', type: 'search' }));
              return;
            }

            var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px' } });
            filtered.forEach(function (r, i) {
              var st = STATUS_MAP[r.status] || { label: r.status, color: 'neutral' };
              list.appendChild(M.Card({
                title: r.user_name || 'Сотрудник',
                subtitle: r.purpose || r.description || '',
                badge: st.label,
                badgeColor: st.color,
                fields: [
                  { label: 'Сумма', value: Utils.formatMoney(parseFloat(r.amount || 0)) + ' ₽' },
                  { label: 'Дата', value: r.created_at ? Utils.formatDate(r.created_at) : '—' },
                ],
                animDelay: i * 0.02,
                actions: buildActions(r),
                onClick: function () { openDetail(r); },
              }));
            });
            listContainer.appendChild(list);
          }

          renderList();

        } catch (e) {
          body.replaceChildren();
          if (e && e.status === 403) {
            body.appendChild(M.AccessDenied());
          } else {
            body.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
            M.Toast({ message: 'Ошибка загрузки: ' + (e.message || e), type: 'error' });
          }
        }
      }, 0);

      return page;
    },
  };
})();

Router.register('/cash-admin', CashAdminPage);
if (typeof window !== 'undefined') window.CashAdminPage = CashAdminPage;
