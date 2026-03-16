/**
 * ASGARD CRM — Mobile v3: Очередь оплаты бухгалтерии
 * Route: #/approval-payment
 * API: GET /api/approval/pending-buh → { items, cash_balance }
 */
window.MobileApprovalPayment = (function () {
  'use strict';

  var el = Utils.el;

  function money(v) {
    return v ? Number(v).toLocaleString('ru-RU') + ' ₽' : '—';
  }

  function fmtDate(v) {
    if (!v) return '—';
    var d = new Date(v);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: undefined }) +
      ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  var ApprovalPaymentPage = {
    render: function () {
      var t = DS.t;
      var page = el('div', { style: { background: t.bg, minHeight: '100vh', paddingBottom: '100px' } });

      // Header
      page.appendChild(M.Header({
        title: 'Очередь оплаты',
        subtitle: 'БУХГАЛТЕРИЯ',
        back: true
      }));

      // Balance hero
      var balanceWrap = el('div', { style: { padding: '12px 20px' } });
      var balanceCard = el('div', {
        style: {
          padding: '16px', borderRadius: '16px',
          background: t.surface, border: '1px solid ' + t.border
        }
      });
      var balanceValue = el('div', {
        style: { ...DS.font('hero'), color: t.blue },
        textContent: '—'
      });
      var balanceLabel = el('div', {
        style: { ...DS.font('xs'), color: t.textSec, marginTop: '2px' },
        textContent: 'Баланс кассы'
      });
      balanceCard.appendChild(M.BigNumber({ value: 0, suffix: ' ₽', label: 'Баланс кассы', icon: '💵' }));
      balanceWrap.appendChild(balanceCard);
      page.appendChild(balanceWrap);

      // Контейнер списка
      var listWrap = el('div', {
        style: { padding: '0 20px', display: 'flex', flexDirection: 'column', gap: '8px' }
      });
      page.appendChild(listWrap);

      // Skeleton пока грузится
      var skeleton = M.Skeleton({ type: 'card', count: 3 });
      listWrap.appendChild(skeleton);

      // Pull-to-refresh
      M.PullToRefresh(page, function () { loadItems(); });

      // Загрузка данных
      function loadItems() {
        return API.fetch('/approval/pending-buh', { noCache: true }).then(function (data) {
          renderItems(data);
        }).catch(function (err) {
          listWrap.replaceChildren();
          if (err && err.status === 403) {
            listWrap.appendChild(M.Empty({ text: 'Доступ только для бухгалтерии', icon: '🔒' }));
          } else {
            listWrap.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
            M.Toast({ message: 'Ошибка загрузки платежей', type: 'error' });
          }
        });
      }

      function renderItems(data) {
        listWrap.replaceChildren();
        var items = (data && data.items) || [];
        var cashBal = (data && data.cash_balance) || 0;

        // Обновить баланс
        balanceWrap.replaceChildren();
        var bCard = el('div', {
          style: {
            padding: '16px', borderRadius: '16px',
            background: t.surface, border: '1px solid ' + t.border
          }
        });
        bCard.appendChild(M.BigNumber({ value: cashBal, suffix: ' ₽', label: 'Баланс кассы', icon: '💵' }));
        balanceWrap.appendChild(bCard);

        if (!items.length) {
          listWrap.appendChild(M.Empty({ text: 'Нет заявок на оплату', icon: '✅' }));
          return;
        }

        // Счётчик
        var countBadge = el('div', {
          style: {
            ...DS.font('sm'), color: t.textSec, marginBottom: '8px'
          },
          textContent: 'Заявок: ' + items.length
        });
        listWrap.appendChild(countBadge);

        items.forEach(function (item, idx) {
          var entityType = item.entity_type || item.entityType || '';
          var entityId = item.entity_id || item.entityId || item.id;
          var label = MobileApproval.entityLabel(entityType);

          var card = M.Card({
            title: (item.title || item.name || label) + '',
            subtitle: item.initiator_name || item.created_by_name || '',
            badge: label,
            badgeColor: 'warning',
            time: fmtDate(item.updated_at || item.created_at),
            fields: [
              item.amount ? { label: 'Сумма', value: money(item.amount) } : null,
              item.comment ? { label: 'Комментарий', value: item.comment.substring(0, 40) } : null
            ].filter(Boolean),
            animDelay: idx * 0.03,
            onClick: function () {
              MobileApproval.showBuhPayment(entityType, entityId, {
                title: item.title || item.name,
                amount: item.amount,
                initiator: item.initiator_name,
                onDone: function () {
                  loadItems(); // Перезагрузить список
                }
              });
            }
          });

          // ID badge
          var idBadge = el('div', {
            style: {
              ...DS.font('xs'), color: t.textTer,
              position: 'absolute', top: '10px', right: '12px'
            },
            textContent: '#' + entityId
          });
          card.style.position = 'relative';
          card.appendChild(idBadge);

          listWrap.appendChild(card);
        });
      }

      // Initial load
      loadItems();

      return page;
    }
  };

  // Регистрация маршрута
  if (typeof Router !== 'undefined') {
    Router.register('/approval-payment', ApprovalPaymentPage);
  }

  return ApprovalPaymentPage;
})();
