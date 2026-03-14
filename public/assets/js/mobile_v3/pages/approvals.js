/**
 * ASGARD CRM — Mobile v3: Согласования (директор)
 * Route: #/approvals
 * Данные: AsgardDB.all('estimates') + AsgardDB.all('tenders')
 */
window.MobileApprovals = (function () {
  'use strict';

  var el = Utils.el;

  function money(v) { return v ? Number(v).toLocaleString('ru-RU') + ' ₽' : '—'; }
  function fmt(v) { return v ? new Date(v).toLocaleDateString('ru-RU') : '—'; }

  async function loadData() {
    var estimates = [];
    var tenders = [];
    var users = [];
    try {
      if (typeof AsgardDB !== 'undefined') {
        estimates = (await AsgardDB.all('estimates')) || [];
        tenders = (await AsgardDB.all('tenders')) || [];
        users = (await AsgardDB.all('users')) || [];
      }
    } catch (_) {}
    if (!estimates.length) {
      try {
        var d = await API.fetch('/data/estimates');
        estimates = Array.isArray(d) ? d : (d && d.items ? d.items : []);
      } catch (_) {}
    }
    if (!tenders.length) {
      try {
        var d2 = await API.fetch('/data/tenders');
        tenders = Array.isArray(d2) ? d2 : (d2 && d2.items ? d2.items : []);
      } catch (_) {}
    }
    return { estimates: estimates, tenders: tenders, users: users };
  }

  function getTender(tenders, id) {
    for (var i = 0; i < tenders.length; i++) {
      if (tenders[i].id === id) return tenders[i];
    }
    return null;
  }

  function getUser(users, id) {
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === id) return users[i];
    }
    return null;
  }

  /* ── Модалка ввода комментария ── */
  function openCommentSheet(title, btnLabel, btnColor, onSubmit) {
    var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

    var commentInput = el('textarea', {
      style: {
        width: '100%', minHeight: '100px', padding: '12px', borderRadius: '12px',
        border: '1px solid var(--border)', background: 'var(--input-bg, var(--surface-alt))',
        color: 'var(--text)', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical',
        boxSizing: 'border-box',
      },
    });
    commentInput.placeholder = 'Комментарий (обязательно)';
    content.appendChild(commentInput);

    var statusColor = { 'warning': 'warning', 'gold': 'gold', 'danger': 'danger' };
    var variant = btnColor === 'danger' ? 'danger' : undefined;

    content.appendChild(M.FullWidthBtn({
      label: btnLabel,
      variant: variant,
      onClick: function () {
        var text = commentInput.value.trim();
        if (!text) {
          M.Toast({ message: 'Комментарий обязателен', type: 'error' });
          return;
        }
        onSubmit(text);
      },
    }));

    M.BottomSheet({ title: title, content: content });
  }

  /* ── Действие согласования ── */
  async function doAction(est, action, comment) {
    try {
      var newStatus = action;
      if (typeof AsgardDB !== 'undefined') {
        var cur = await AsgardDB.get('estimates', est.id);
        if (cur) {
          cur.approval_status = newStatus;
          if (comment) cur.approval_comment = comment;
          cur.decided_at = new Date().toISOString();
          await AsgardDB.put('estimates', cur);
        }
      }
      try {
        await API.fetch('/data/estimates/' + est.id, {
          method: 'PUT',
          body: { approval_status: newStatus, approval_comment: comment || '' },
        });
      } catch (_) {}

      var labels = { approved: 'Согласовано', rework: 'На доработку', question: 'Вопрос отправлен', rejected: 'Отклонено' };
      var types = { approved: 'success', rework: 'info', question: 'info', rejected: 'error' };
      M.Toast({ message: labels[action] || action, type: types[action] || 'info' });

      // Close all sheets
      document.querySelectorAll('.asgard-sheet-overlay').forEach(function (o) { o.remove(); });
      Utils.unlockScroll();
      window.dispatchEvent(new Event('asgard:refresh'));
    } catch (e) {
      M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' });
    }
  }

  /* ── Детальная модалка ── */
  function openDetail(est, tender, users) {
    var t = DS.t;
    var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } });

    content.appendChild(el('div', { style: { display: 'flex', gap: '6px' } }, M.Badge({ text: 'На согласовании', color: 'info' })));

    var author = getUser(users, est.created_by || est.author_id);
    var authorName = author ? (author.display_name || author.username) : (est.author_name || est.created_by_name || '—');

    var fields = [
      { label: 'Тендер', value: tender ? (tender.customer_name || tender.name || '—') : '—' },
      { label: 'Автор', value: authorName },
      { label: 'Стоимость', value: money(est.total_price || est.price) },
      { label: 'Себестоимость', value: money(est.total_cost || est.cost) },
      { label: 'Отправлен', value: fmt(est.sent_for_approval_at || est.created_at) },
    ];
    content.appendChild(M.DetailFields({ fields: fields }));

    // Finance block
    var price = Number(est.total_price || est.price || 0);
    var cost = Number(est.total_cost || est.cost || 0);
    var profit = price - cost;
    var marginPct = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;

    var finBlock = el('div', { style: { padding: '14px', background: 'var(--surface-alt)', borderRadius: '14px' } });
    var finRow = el('div', { style: { display: 'flex', justifyContent: 'space-around', textAlign: 'center' } });
    [
      { label: 'Цена', val: money(price), cl: t.blue },
      { label: 'Себест.', val: money(cost), cl: t.orange },
      { label: 'Прибыль', val: money(profit), cl: profit > 0 ? t.green : t.red },
    ].forEach(function (f) {
      var cell = el('div');
      cell.appendChild(el('div', { style: { ...DS.font('xs'), color: t.textTer, marginBottom: '4px' }, textContent: f.label }));
      cell.appendChild(el('div', { style: { ...DS.font('md'), color: f.cl, fontWeight: 700 }, textContent: f.val }));
      finRow.appendChild(cell);
    });
    finBlock.appendChild(finRow);
    finBlock.appendChild(el('div', { style: { marginTop: '10px' } }, M.ProgressBar({ value: Math.max(0, Math.min(100, marginPct)), label: 'Маржа ' + marginPct + '%' })));
    content.appendChild(finBlock);

    // 4 action buttons (same as test page approval card)
    var actionsRow = el('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } });
    [
      { icon: '✓', label: 'Да', type: 'success', action: 'approved' },
      { icon: '↻', label: 'Доработка', type: 'warning', action: 'rework' },
      { icon: '?', label: 'Вопрос', type: 'gold', action: 'question' },
      { icon: '✕', label: 'Нет', type: 'danger', action: 'rejected' },
    ].forEach(function (a) {
      var s = DS.status(a.type);
      var btn = el('button', {
        style: {
          flex: 1, padding: '12px 4px', borderRadius: '10px',
          border: '1px solid ' + s.border, background: s.bg, color: s.color,
          fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        },
        textContent: a.icon + ' ' + a.label,
        onClick: function () {
          if (a.action === 'approved') {
            doAction(est, 'approved', '');
          } else {
            openCommentSheet(
              a.label,
              a.icon + ' ' + a.label,
              a.action === 'rejected' ? 'danger' : undefined,
              function (comment) { doAction(est, a.action, comment); }
            );
          }
        },
      });
      actionsRow.appendChild(btn);
    });
    content.appendChild(actionsRow);

    M.BottomSheet({
      title: (tender ? tender.customer_name || tender.name : '') || 'Согласование',
      content: content,
      fullscreen: true,
    });
  }

  /* ── Карточка согласования ── */
  function renderCard(est, idx, tenders, users) {
    var t = DS.t;
    var tender = getTender(tenders, est.tender_id);
    var author = getUser(users, est.created_by || est.author_id);
    var authorName = author ? (author.display_name || author.username) : (est.author_name || '—');

    var price = Number(est.total_price || est.price || 0);
    var cost = Number(est.total_cost || est.cost || 0);
    var marginPct = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;

    var card = M.Card({
      title: tender ? (tender.customer_name || tender.name || 'Просчёт') : 'Просчёт #' + est.id,
      subtitle: 'От: ' + authorName,
      badge: 'Согласование',
      badgeColor: 'info',
      fields: [
        { label: 'Сумма', value: money(price) },
        { label: 'Маржа', value: marginPct + '%' },
      ],
      time: fmt(est.sent_for_approval_at || est.created_at),
      animDelay: idx * 0.05,
    });

    // Inline 4-button row (same pattern as test.js approval card)
    var actionsRow = el('div', {
      style: {
        display: 'flex', gap: '6px', marginTop: '12px',
        borderTop: '1px solid ' + t.border, paddingTop: '12px',
      },
    });
    [
      { icon: '✓', type: 'success', label: 'Да', action: 'approved' },
      { icon: '↻', type: 'warning', label: 'Доработка', action: 'rework' },
      { icon: '?', type: 'gold', label: 'Вопрос', action: 'question' },
      { icon: '✕', type: 'danger', label: 'Нет', action: 'rejected' },
    ].forEach(function (a) {
      var s = DS.status(a.type);
      var btn = el('button', {
        style: {
          flex: 1, padding: '10px 4px', borderRadius: '10px',
          border: '1px solid ' + s.border, background: s.bg, color: s.color,
          fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        },
        textContent: a.icon + ' ' + a.label,
        onClick: function (e) {
          e.stopPropagation();
          if (a.action === 'approved') {
            doAction(est, 'approved', '');
          } else {
            openCommentSheet(a.label, a.icon + ' ' + a.label, a.action === 'rejected' ? 'danger' : undefined, function (comment) { doAction(est, a.action, comment); });
          }
        },
      });
      actionsRow.appendChild(btn);
    });
    card.appendChild(actionsRow);

    // Tap card body → detail
    card.addEventListener('click', function () { openDetail(est, tender, users); });
    card.style.cursor = 'pointer';

    return card;
  }

  /* ── Рендер ── */
  async function render() {
    var t = DS.t;
    var items = [];
    var tenders = [];
    var users = [];

    var page = M.TablePage({
      title: 'Согласования',
      subtitle: 'Директор',
      back: true,
      backHref: '/home',
      search: true,
      items: items,
      renderItem: function (item, idx) { return renderCard(item, idx, tenders, users); },
      empty: M.Empty({ text: 'Нет заявок на согласование', icon: '✍️' }),
      onRefresh: async function () {
        var d = await loadData();
        tenders = d.tenders;
        users = d.users;
        return d.estimates.filter(function (e) { return e.approval_status === 'sent'; });
      },
    });

    try {
      var data = await loadData();
      tenders = data.tenders;
      users = data.users;
      var pending = data.estimates.filter(function (e) { return e.approval_status === 'sent'; });
      pending.sort(function (a, b) { return new Date(b.sent_for_approval_at || b.created_at || 0) - new Date(a.sent_for_approval_at || a.created_at || 0); });
      items.push.apply(items, pending);
      window.dispatchEvent(new Event('asgard:refresh'));
    } catch (_) {}

    return page;
  }

  return { render: render };
})();

if (typeof Router !== 'undefined') {
  Router.register('/approvals', window.MobileApprovals);
}
