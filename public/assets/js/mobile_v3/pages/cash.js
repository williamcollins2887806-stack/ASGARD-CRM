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
    content.appendChild(M.DetailFields({
      fields: [
        { label: 'Назначение', value: r.purpose || r.description || '—' },
        { label: 'Сумма', value: Utils.formatMoney(parseFloat(r.amount || 0)) + ' ₽' },
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'Работа', value: r.work_title || '—' },
        { label: 'Создано', value: r.created_at ? Utils.formatDate(r.created_at) : '—' },
        { label: 'Комментарий', value: r.comment || '—' },
      ],
    }));
    M.BottomSheet({ title: 'Заявка #' + r.id, content: content, fullscreen: false });
  }

  function openCreateModal() {
    var step = 0;
    var formData = { purpose: '', amount: '', comment: '' };
    var sheetRef;

    function renderStep() {
      var content = el('div');

      if (step === 0) {
        content.appendChild(M.Form({
          fields: [
            { id: 'purpose', label: 'Назначение', type: 'text', required: true, placeholder: 'Командировка, закупка и т.д.', value: formData.purpose },
            { id: 'amount', label: 'Сумма, ₽', type: 'number', required: true, placeholder: '50000', value: formData.amount },
            { id: 'comment', label: 'Комментарий', type: 'textarea', placeholder: 'Детали заявки...', value: formData.comment },
          ],
          submitLabel: 'Далее →',
          onSubmit: function (data) {
            Object.assign(formData, data);
            step = 1;
            sheetRef.body.replaceChildren();
            sheetRef.body.appendChild(renderStep());
          },
        }));
      } else {
        content.appendChild(M.DetailFields({
          fields: [
            { label: 'Назначение', value: formData.purpose },
            { label: 'Сумма', value: Utils.formatMoney(parseFloat(formData.amount || 0)) + ' ₽' },
            { label: 'Комментарий', value: formData.comment || '—' },
          ],
        }));
        content.appendChild(el('div', { style: { height: '16px' } }));
        content.appendChild(M.FullWidthBtn({
          label: '✓ Отправить заявку',
          onClick: async function () {
            try {
              await API.fetch('/cash', {
                method: 'POST',
                body: { purpose: formData.purpose, amount: parseFloat(formData.amount), comment: formData.comment },
              });
              sheetRef.close();
              M.Toast({ message: 'Заявка отправлена', type: 'success' });
              Router.navigate('/cash', { replace: true });
            } catch (e) {
              M.Toast({ message: 'Ошибка: ' + (e.message || 'Сеть'), type: 'error' });
            }
          },
        }));
        content.appendChild(el('div', { style: { height: '8px' } }));
        content.appendChild(M.FullWidthBtn({
          label: '← Назад', variant: 'secondary',
          onClick: function () {
            step = 0;
            sheetRef.body.replaceChildren();
            sheetRef.body.appendChild(renderStep());
          },
        }));
      }
      return content;
    }

    sheetRef = M.BottomSheet({ title: 'Новая заявка на аванс', content: renderStep(), fullscreen: true });
  }

  return {
    render: function () {
      var page = el('div', { style: { paddingBottom: '100px' } });
      page.appendChild(M.Header({ title: 'Касса', subtitle: 'МОИ АВАНСЫ', back: true, backHref: '/home' }));

      var body = el('div');
      body.appendChild(M.Skeleton({ type: 'hero', count: 1 }));
      body.appendChild(el('div', { style: { height: '12px' } }));
      body.appendChild(M.Skeleton({ type: 'card', count: 3 }));
      page.appendChild(body);

      page.appendChild(M.FAB({
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        onClick: function () { openCreateModal(); },
      }));

      setTimeout(async function () {
        try {
          var results = await Promise.all([
            API.fetch('/cash/my-balance'),
            API.fetch('/cash/my'),
          ]);
          var balance = results[0] || {};
          var requests = results[1];
          var reqList = API.extractRows(requests);

          body.replaceChildren();

          // Balance hero
          var heroWrap = el('div', { style: { padding: '12px 20px' } });
          heroWrap.appendChild(M.HeroCard({
            label: 'БАЛАНС НА РУКАХ',
            value: Utils.formatMoney(parseFloat(balance.remainder || balance.balance || 0)),
            valueSuffix: ' ₽',
            details: [
              { label: 'Получено', value: Utils.formatMoney(parseFloat(balance.approved || balance.issued || 0)) + ' ₽' },
              { label: 'Потрачено', value: Utils.formatMoney(parseFloat(balance.spent || 0)) + ' ₽' },
              { label: 'Возвращено', value: Utils.formatMoney(parseFloat(balance.returned || 0)) + ' ₽', color: DS.t.green },
            ],
          }));
          body.appendChild(heroWrap);

          body.appendChild(el('div', { style: { height: '12px' } }));
          body.appendChild(M.QuickActions({
            items: [
              { icon: '💵', label: 'Новая заявка', onClick: function () { openCreateModal(); } },
              { icon: '📊', label: 'Отчёт', onClick: function () { M.Toast({ message: 'В разработке', type: 'info' }); } },
            ],
          }));

          body.appendChild(el('div', { style: { height: '16px' } }));

          if (!reqList.length) {
            body.appendChild(M.Empty({ text: 'Заявок пока нет', icon: '💰' }));
          } else {
            var listWrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px' } });
            reqList.forEach(function (r, i) {
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
            body.appendChild(M.Section({ title: 'Мои заявки (' + reqList.length + ')', content: listWrap }));
          }

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

Router.register('/cash', CashPage);
if (typeof window !== 'undefined') window.CashPage = CashPage;
