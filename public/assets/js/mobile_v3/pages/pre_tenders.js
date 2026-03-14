/**
 * ASGARD CRM — Mobile v3: Пред-тендерные заявки
 * Route: #/pre-tenders
 * Данные: GET /api/pre-tenders + AsgardDB('pre_tender_requests')
 */
window.MobilePreTenders = (function () {
  'use strict';

  const STATUS_MAP = {
    new:              { label: 'Новая',           color: 'neutral' },
    in_review:        { label: 'На рассмотрении', color: 'info' },
    need_docs:        { label: 'Нужны документы', color: 'warning' },
    accepted:         { label: 'Принята',         color: 'success' },
    rejected:         { label: 'Отклонена',       color: 'danger' },
    expired:          { label: 'Истекла',         color: 'neutral' },
    pending_approval: { label: 'На согласовании', color: 'info' },
  };

  const AI_COLOR_MAP = {
    green:  { label: 'Высокий шанс', color: 'success' },
    yellow: { label: 'Средний шанс', color: 'warning' },
    red:    { label: 'Низкий шанс',  color: 'danger' },
    gray:   { label: 'Без оценки',   color: 'neutral' },
  };

  const REJECT_REASONS = [
    'Не наш профиль работ',
    'Нет свободных специалистов',
    'Невыгодные условия',
    'Срок не подходит',
    'Другое',
  ];

  function fmt(v) { return v ? new Date(v).toLocaleDateString('ru-RU') : '—'; }
  function money(v) { return v ? Number(v).toLocaleString('ru-RU') + ' ₽' : '—'; }

  /* ── Загрузка данных ── */
  async function loadItems() {
    try {
      const data = await API.fetch('/pre-tenders');
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.items)) return data.items;
    } catch (_) { /* fallback to IDB */ }
    try {
      if (typeof AsgardDB !== 'undefined') {
        return (await AsgardDB.all('pre_tender_requests')) || [];
      }
    } catch (_) {}
    return [];
  }

  function statusInfo(item) {
    return STATUS_MAP[item.status] || STATUS_MAP.new;
  }

  function aiInfo(item) {
    const c = item.ai_color || item.aiColor || 'gray';
    return AI_COLOR_MAP[c] || AI_COLOR_MAP.gray;
  }

  /* ── Детальная модалка ── */
  function openDetail(item) {
    const t = DS.t;
    const el = Utils.el;
    const si = statusInfo(item);
    const ai = aiInfo(item);

    const content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } });

    // Статус + AI
    const pills = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
    pills.appendChild(M.Badge({ text: si.label, color: si.color }));
    pills.appendChild(M.Badge({ text: ai.label, color: ai.color }));
    content.appendChild(pills);

    // Поля
    var fields = [
      { label: 'Заказчик', value: item.customer_name || item.client_name || '—' },
      { label: 'Источник', value: item.source || item.source_type || '—' },
      { label: 'НМЦК', value: money(item.nmck || item.estimated_amount || item.amount) },
      { label: 'Дедлайн', value: fmt(item.deadline || item.submission_deadline) },
      { label: 'Создана', value: fmt(item.created_at) },
    ];
    if (item.region) fields.push({ label: 'Регион', value: item.region });
    content.appendChild(M.DetailFields({ fields: fields }));

    // Описание
    if (item.description || item.work_description) {
      var descBlock = el('div', { style: { padding: '12px', background: 'var(--surface-alt)', borderRadius: '12px' } });
      descBlock.appendChild(el('div', { style: { ...DS.font('xs'), color: 'var(--text-ter)', marginBottom: '4px' }, textContent: 'Описание' }));
      descBlock.appendChild(el('div', { style: { ...DS.font('sm'), color: 'var(--text-sec)', lineHeight: '1.5' }, textContent: item.description || item.work_description }));
      content.appendChild(descBlock);
    }

    // AI-анализ
    if (item.ai_report || item.ai_analysis) {
      var aiBlock = el('div', { style: { padding: '12px', background: 'var(--surface-alt)', borderRadius: '12px' } });
      aiBlock.appendChild(el('div', { style: { ...DS.font('xs'), color: 'var(--text-ter)', marginBottom: '4px' }, textContent: '🤖 AI-анализ' }));
      aiBlock.appendChild(el('div', { style: { ...DS.font('sm'), color: 'var(--text-sec)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }, textContent: item.ai_report || item.ai_analysis }));
      content.appendChild(aiBlock);
    }

    // Документы
    var docs = item.documents || item.files || [];
    if (docs.length) {
      var docsBlock = el('div');
      docsBlock.appendChild(el('div', { style: { ...DS.font('sm'), color: 'var(--text-ter)', marginBottom: '6px' }, textContent: '📎 Документы (' + docs.length + ')' }));
      docs.forEach(function (d) {
        var name = d.original_filename || d.name || d.filename || 'Файл';
        var row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' } });
        row.appendChild(el('span', { style: { fontSize: '14px' }, textContent: '📄' }));
        row.appendChild(el('span', { style: { ...DS.font('sm'), color: 'var(--blue)', fontWeight: 600 }, textContent: name }));
        docsBlock.appendChild(row);
      });
      content.appendChild(docsBlock);
    }

    // Кнопки действий (директор)
    var user = Store.get('user');
    var role = user && user.role;
    var canApprove = ['DIRECTOR', 'OWNER', 'ADMIN'].indexOf(role) >= 0;
    var isPending = item.status === 'new' || item.status === 'in_review' || item.status === 'pending_approval';

    if (canApprove && isPending) {
      var actionsRow = el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } });

      var approveBtn = el('button', {
        style: {
          flex: 1, padding: '12px', borderRadius: '12px', border: '1px solid var(--green-border)',
          background: 'var(--green-bg)', color: 'var(--green)', fontSize: '14px', fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
        },
        textContent: '✓ Согласовать',
        onClick: function () { doApprove(item); },
      });
      actionsRow.appendChild(approveBtn);

      var rejectBtn = el('button', {
        style: {
          flex: 1, padding: '12px', borderRadius: '12px', border: '1px solid var(--red-border)',
          background: 'var(--red-bg)', color: 'var(--red)', fontSize: '14px', fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
        },
        textContent: '✕ Отклонить',
        onClick: function () { doReject(item); },
      });
      actionsRow.appendChild(rejectBtn);

      content.appendChild(actionsRow);
    }

    M.BottomSheet({ title: item.title || item.customer_name || 'Заявка', content: content, fullscreen: true });
  }

  /* ── Действия директора ── */
  async function doApprove(item) {
    var ok = await M.Confirm({ title: 'Согласовать заявку?', message: item.title || item.customer_name, okText: 'Да, согласовать', cancelText: 'Отмена' });
    if (!ok) return;
    try {
      await API.fetch('/pre-tenders/' + item.id + '/accept', { method: 'POST' });
      M.Toast({ message: 'Заявка согласована', type: 'success' });
      window.dispatchEvent(new Event('asgard:refresh'));
    } catch (e) {
      M.Toast({ message: 'Ошибка: ' + (e.message || e), type: 'error' });
    }
  }

  async function doReject(item) {
    var el = Utils.el;
    var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
    content.appendChild(el('div', { style: { ...DS.font('sm'), color: 'var(--text-sec)' }, textContent: 'Выберите причину отклонения:' }));

    var selectedReason = '';
    var pills = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
    REJECT_REASONS.forEach(function (r) {
      var btn = el('button', {
        style: {
          padding: '8px 14px', borderRadius: '10px', border: '1px solid var(--border)',
          background: 'var(--surface-alt)', color: 'var(--text-sec)', fontSize: '13px',
          fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s ease',
        },
        textContent: r,
        onClick: function () {
          selectedReason = r;
          pills.querySelectorAll('button').forEach(function (b) {
            b.style.background = 'var(--surface-alt)';
            b.style.color = 'var(--text-sec)';
            b.style.borderColor = 'var(--border)';
          });
          btn.style.background = 'var(--red-bg)';
          btn.style.color = 'var(--red)';
          btn.style.borderColor = 'var(--red-border)';
        },
      });
      pills.appendChild(btn);
    });
    content.appendChild(pills);

    var commentInput = el('textarea', {
      style: {
        width: '100%', minHeight: '80px', padding: '12px', borderRadius: '12px',
        border: '1px solid var(--border)', background: 'var(--input-bg, var(--surface-alt))',
        color: 'var(--text)', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical',
        boxSizing: 'border-box',
      },
    });
    commentInput.placeholder = 'Комментарий (необязательно)';
    content.appendChild(commentInput);

    var sendBtn = M.FullWidthBtn({
      label: '✕ Отклонить заявку',
      variant: 'danger',
      onClick: async function () {
        if (!selectedReason) { M.Toast({ message: 'Выберите причину', type: 'error' }); return; }
        try {
          await API.fetch('/pre-tenders/' + item.id + '/reject', {
            method: 'POST',
            body: { reason: selectedReason, comment: commentInput.value.trim() },
          });
          M.Toast({ message: 'Заявка отклонена', type: 'success' });
          // Close sheets
          document.querySelectorAll('.asgard-sheet-overlay').forEach(function (o) { o.remove(); });
          Utils.unlockScroll();
          window.dispatchEvent(new Event('asgard:refresh'));
        } catch (e) {
          M.Toast({ message: 'Ошибка: ' + (e.message || e), type: 'error' });
        }
      },
    });
    content.appendChild(sendBtn);

    M.BottomSheet({ title: 'Отклонить заявку', content: content });
  }

  /* ── Рендер карточки ── */
  function renderCard(item, idx) {
    var si = statusInfo(item);
    var ai = aiInfo(item);
    var fields = [];
    var nmck = item.nmck || item.estimated_amount || item.amount;
    if (nmck) fields.push({ label: 'НМЦК', value: money(nmck) });
    var deadline = item.deadline || item.submission_deadline;
    if (deadline) fields.push({ label: 'Дедлайн', value: fmt(deadline) });
    if (item.region) fields.push({ label: 'Регион', value: item.region });

    return M.Card({
      title: item.title || item.customer_name || 'Заявка #' + (item.id || idx),
      subtitle: item.source || item.source_type || '',
      badge: ai.label !== 'Без оценки' ? ai.label : si.label,
      badgeColor: ai.label !== 'Без оценки' ? ai.color : si.color,
      fields: fields,
      time: fmt(item.created_at),
      onClick: function () { openDetail(item); },
      animDelay: idx * 0.03,
    });
  }

  /* ── Главный рендер ── */
  async function render() {
    var items = [];

    var page = M.TablePage({
      title: 'Заявки',
      subtitle: 'Пред-тендерные',
      back: true,
      backHref: '/home',
      search: true,
      items: items,
      renderItem: renderCard,
      filter: {
        pills: [
          { label: 'Все', value: 'all', active: true },
          { label: 'Новые', value: 'new' },
          { label: 'На рассмотрении', value: 'in_review' },
          { label: 'Принятые', value: 'accepted' },
          { label: 'Отклонённые', value: 'rejected' },
        ],
        filterFn: function (item, val) {
          if (val === 'all') return true;
          return item.status === val;
        },
      },
      empty: M.Empty({ text: 'Нет заявок', icon: '📋' }),
      onRefresh: async function () {
        try {
          return await loadItems();
        } catch (e) {
          M.Toast({ message: 'Ошибка загрузки заявок', type: 'error' });
          return [];
        }
      },
      fab: {
        icon: '+',
        onClick: function () { M.Toast({ message: 'Создание заявки — в разработке', type: 'info' }); },
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
  Router.register('/pre-tenders', window.MobilePreTenders);
}
