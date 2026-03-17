/**
 * ASGARD CRM — Mobile v3: Касса (РП)
 * Route: #/cash
 * API: GET /api/cash/my, GET /api/cash/my-balance, POST /api/cash
 */
var CashPage = (function () {
  'use strict';

  var el = Utils.el;

  var STATUS_MAP = {
    requested: { label: 'На согласовании', color: 'info' },
    approved: { label: 'Согласовано', color: 'success' },
    money_issued: { label: 'Наличные выданы', color: 'info' },
    received: { label: 'Получено', color: 'gold' },
    reporting: { label: 'На отчёте', color: 'warning' },
    closed: { label: 'Закрыто', color: 'success' },
    rejected: { label: 'Отклонено', color: 'danger' },
    question: { label: 'Вопрос', color: 'warning' },
  };

  var FILTER_STATUSES = {
    all: null,
    pending: ['requested', 'question'],
    approved: ['approved', 'money_issued', 'received'],
    closed: ['closed', 'reporting'],
  };

  function buildActions(r) {
    var actions = [];
    if (r.status === 'money_issued') {
      actions.push({
        label: '✓ Получил',
        onClick: async function () {
          var ok = await M.Confirm({ title: 'Подтвердить получение?', message: 'Сумма: ' + Utils.formatMoney(r.amount) + ' ₽' });
          if (ok) {
            try {
              await API.fetch('/cash/' + r.id + '/receive', { method: 'PUT' });
              M.Toast({ message: 'Получение подтверждено', type: 'success' });
              Router.navigate('/cash', { replace: true });
            } catch (e) { M.Toast({ message: 'Ошибка: ' + (e.message || e), type: 'error' }); }
          }
        },
      });
    }
    return actions;
  }

  function openDetail(r) {
    var st = STATUS_MAP[r.status] || { label: r.status, color: 'neutral' };
    var content = el('div');
    var fields = [
      { label: 'Назначение', value: r.purpose || r.description || '—' },
      { label: 'Сумма', value: Utils.formatMoney(parseFloat(r.amount || 0)) + ' ₽' },
      { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
      { label: 'Работа', value: r.work_title || '—' },
      { label: 'Создано', value: r.created_at ? Utils.formatDate(r.created_at) : '—' },
      { label: 'Комментарий', value: r.comment || '—' },
    ];
    if (r.receipt_url) {
      fields.push({ label: 'Квитанция', value: '📄 Скачать', type: 'link', href: r.receipt_url });
    }
    content.appendChild(M.DetailFields({ fields: fields }));

    // Расходы (если есть)
    if (r.expenses && r.expenses.length) {
      var expWrap = el('div', { style: { marginTop: '16px' } });
      expWrap.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: DS.t.textSec, marginBottom: '8px', fontWeight: '600' }), textContent: 'Расходы' }));
      r.expenses.forEach(function(exp) {
        var row = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid ' + DS.t.border } });
        row.appendChild(el('span', { style: Object.assign({}, DS.font('sm'), { color: DS.t.text }), textContent: exp.description || 'Расход' }));
        row.appendChild(el('span', { style: Object.assign({}, DS.font('sm'), { color: DS.t.red, fontWeight: '600' }), textContent: Utils.formatMoney(parseFloat(exp.amount || 0)) + ' ₽' }));
        expWrap.appendChild(row);
      });
      content.appendChild(expWrap);
    }

    M.BottomSheet({ title: 'Заявка #' + r.id, content: content, fullscreen: false });
  }

  function openCreateModal(worksList) {
    var formData = { purpose: '', amount: '', comment: '', work_id: '', deadline: '' };
    var workOptions = [{ value: '', label: '— Без привязки —' }];
    if (worksList && worksList.length) {
      worksList.forEach(function(w) {
        workOptions.push({ value: String(w.id), label: (w.work_title || w.customer_name || 'Работа #' + w.id).substring(0, 50) });
      });
    }

    var content = el('div');
    content.appendChild(M.Form({
      fields: [
        { id: 'purpose', label: 'Назначение', type: 'text', required: true, placeholder: 'Командировка, закупка и т.д.' },
        { id: 'amount', label: 'Сумма, ₽', type: 'number', required: true, placeholder: '50000' },
        { id: 'work_id', label: 'Связать с работой', type: 'select', options: workOptions },
        { id: 'deadline', label: 'Срок', type: 'date' },
        { id: 'comment', label: 'Комментарий', type: 'textarea', placeholder: 'Детали заявки...' },
      ],
      submitLabel: '✓ Отправить заявку',
      onSubmit: async function (data) {
        try {
          var body = { purpose: data.purpose, amount: parseFloat(data.amount), comment: data.comment };
          if (data.work_id) body.work_id = parseInt(data.work_id);
          if (data.deadline) body.deadline = data.deadline;
          await API.fetch('/cash', { method: 'POST', body: body });
          M.Toast({ message: 'Заявка отправлена', type: 'success' });
          Router.navigate('/cash', { replace: true });
        } catch (e) {
          M.Toast({ message: 'Ошибка: ' + (e.message || 'Сеть'), type: 'error' });
        }
      },
    }));

    M.BottomSheet({ title: 'Новая заявка на аванс', content: content, fullscreen: true });
  }

  return {
    render: function () {
      var t = DS.t;
      var page = el('div', { style: { paddingBottom: '100px' } });
      page.appendChild(M.Header({ title: 'Касса', subtitle: 'МОИ АВАНСЫ', back: true, backHref: '/home' }));

      // Фильтры
      var activeFilter = 'all';
      var allRequests = [];
      var worksCache = null;

      page.appendChild(M.FilterPills({
        items: [
          { label: 'Все', value: 'all', active: true },
          { label: 'На согласовании', value: 'pending' },
          { label: 'Одобрено', value: 'approved' },
          { label: 'Закрыто', value: 'closed' },
        ],
        onChange: function (val) { activeFilter = val; renderList(); },
      }));

      var body = el('div');
      body.appendChild(M.Skeleton({ type: 'hero', count: 1 }));
      body.appendChild(el('div', { style: { height: '12px' } }));
      body.appendChild(M.Skeleton({ type: 'card', count: 3 }));
      page.appendChild(body);

      var listContainer = el('div');
      var heroSection = null;

      page.appendChild(M.FAB({
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        onClick: function () {
          if (worksCache) {
            openCreateModal(worksCache);
          } else {
            API.fetchCached('works', '/works').then(function(w) { worksCache = w; openCreateModal(w); }).catch(function() { openCreateModal([]); });
          }
        },
      }));

      function renderList() {
        listContainer.replaceChildren();
        var filtered = allRequests;
        var statuses = FILTER_STATUSES[activeFilter];
        if (statuses) {
          filtered = allRequests.filter(function(r) { return statuses.indexOf(r.status) !== -1; });
        }

        if (!filtered.length) {
          listContainer.appendChild(M.Empty({ text: activeFilter === 'all' ? 'Заявок пока нет' : 'Нет заявок с таким статусом', icon: '💰' }));
          return;
        }

        var listWrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px' } });
        filtered.forEach(function (r, i) {
          var st = STATUS_MAP[r.status] || { label: r.status, color: 'neutral' };
          listWrap.appendChild(M.Card({
            title: r.purpose || r.description || 'Заявка #' + r.id,
            subtitle: r.work_title || '',
            badge: st.label,
            badgeColor: st.color,
            fields: [
              { label: 'Сумма', value: Utils.formatMoney(parseFloat(r.amount || 0)) + ' ₽' },
              { label: 'Дата', value: r.created_at ? Utils.formatDate(r.created_at) : '—' },
            ],
            animDelay: i * 0.03,
            actions: buildActions(r),
            onClick: function () { openDetail(r); },
          }));
        });
        listContainer.appendChild(M.Section({ title: 'Заявки (' + filtered.length + ')', content: listWrap }));
      }

      async function loadData() {
        try {
          var results = await Promise.all([
            API.fetch('/cash/my-balance'),
            API.fetch('/cash/my'),
          ]);
          var balance = results[0] || {};
          var requests = results[1];
          allRequests = API.extractRows(requests);

          body.replaceChildren();

          // Balance hero
          heroSection = el('div', { style: { padding: '12px 20px' } });
          heroSection.appendChild(M.HeroCard({
            label: 'БАЛАНС НА РУКАХ',
            value: Utils.formatMoney(parseFloat(balance.remainder || balance.balance || 0)),
            valueSuffix: ' ₽',
            details: [
              { label: 'Получено', value: Utils.formatMoney(parseFloat(balance.approved || balance.issued || 0)) + ' ₽' },
              { label: 'Потрачено', value: Utils.formatMoney(parseFloat(balance.spent || 0)) + ' ₽' },
              { label: 'Возвращено', value: Utils.formatMoney(parseFloat(balance.returned || 0)) + ' ₽', color: t.green },
            ],
          }));
          body.appendChild(heroSection);
          body.appendChild(el('div', { style: { height: '16px' } }));
          body.appendChild(listContainer);

          renderList();
        } catch (e) {
          body.replaceChildren();
          body.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate('/cash', { replace: true }); } }));
          M.Toast({ message: 'Ошибка загрузки: ' + (e.message || e), type: 'error' });
        }
      }

      // Pull-to-refresh
      window.addEventListener('asgard:refresh', function _cashRefresh() {
        if (!page.isConnected) { window.removeEventListener('asgard:refresh', _cashRefresh); return; }
        loadData();
      });

      loadData();
      return page;
    },
  };
})();

Router.register('/cash', CashPage);
if (typeof window !== 'undefined') window.CashPage = CashPage;
