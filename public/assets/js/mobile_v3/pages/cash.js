/**
 * ASGARD CRM — Mobile v3: Касса (РП)
 * Route: #/cash
 * API: GET /api/cash/my, GET /api/cash/my-balance, POST /api/cash
 */
const CashPage = {
  async render() {
    const el = Utils.el;
    const t = DS.t;

    const page = el('div', { style: { paddingBottom: '100px' } });
    page.appendChild(M.Header({ title: 'Касса', subtitle: 'МОИ АВАНСЫ', back: true, backHref: '/home' }));

    const body = el('div');
    body.appendChild(M.Skeleton({ type: 'hero', count: 1 }));
    body.appendChild(el('div', { style: { height: '12px' } }));
    body.appendChild(M.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(body);

    const statusMap = {
      requested: { label: 'На согласовании', color: 'info' },
      approved: { label: 'Согласовано', color: 'success' },
      money_issued: { label: 'Наличные выданы', color: 'info' },
      received: { label: 'Получено', color: 'gold' },
      reporting: { label: 'На отчёте', color: 'warning' },
      closed: { label: 'Закрыто', color: 'success' },
      rejected: { label: 'Отклонено', color: 'danger' },
    };

    try {
      const [balance, requests] = await Promise.all([
        API.fetch('/cash/my-balance'),
        API.fetch('/cash/my'),
      ]);

      body.innerHTML = '';

      // Balance hero
      const bal = balance || {};
      const heroWrap = el('div', { style: { padding: '12px 20px' } });
      heroWrap.appendChild(M.HeroCard({
        label: 'БАЛАНС НА РУКАХ',
        value: Utils.formatMoney(parseFloat(bal.remainder || bal.balance || 0)),
        valueSuffix: ' ₽',
        details: [
          { label: 'Получено', value: Utils.formatMoney(parseFloat(bal.approved || bal.issued || 0)) + ' ₽' },
          { label: 'Потрачено', value: Utils.formatMoney(parseFloat(bal.spent || 0)) + ' ₽' },
          { label: 'Возвращено', value: Utils.formatMoney(parseFloat(bal.returned || 0)) + ' ₽', color: '#34C759' },
        ],
      }));
      body.appendChild(heroWrap);

      // Quick actions
      body.appendChild(el('div', { style: { height: '12px' } }));
      body.appendChild(M.QuickActions({
        items: [
          { icon: '💵', label: 'Новая заявка', onClick: () => openCreateModal() },
          { icon: '📊', label: 'Отчёт', onClick: () => M.Toast({ message: 'В разработке', type: 'info' }) },
        ],
      }));

      // Requests list
      body.appendChild(el('div', { style: { height: '16px' } }));
      const reqList = Array.isArray(requests) ? requests : (requests.requests || requests.data || []);

      if (!reqList.length) {
        body.appendChild(M.Empty({ text: 'Заявок пока нет', icon: '💰' }));
      } else {
        const listWrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px' } });

        reqList.forEach((r, i) => {
          const st = statusMap[r.status] || { label: r.status, color: 'neutral' };
          const card = M.Card({
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
            onClick: () => openDetail(r),
          });
          listWrap.appendChild(card);
        });

        body.appendChild(M.Section({ title: 'Мои заявки (' + reqList.length + ')', content: listWrap }));
      }

    } catch (e) {
      body.innerHTML = '';
      body.appendChild(M.Empty({ text: 'Ошибка загрузки', type: 'error' }));
    }

    // FAB — new request
    page.appendChild(M.FAB({
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
      onClick: () => openCreateModal(),
    }));

    function buildActions(r) {
      const actions = [];
      if (r.status === 'money_issued') {
        actions.push({
          label: '✓ Получил',
          onClick: async () => {
            const ok = await M.Confirm({ title: 'Подтвердить получение?', message: 'Сумма: ' + Utils.formatMoney(r.amount) + ' ₽' });
            if (ok) {
              try {
                await API.fetch('/cash/' + r.id + '/receive', { method: 'PUT' });
                M.Toast({ message: 'Получение подтверждено', type: 'success' });
                Router.navigate('/cash', { replace: true });
              } catch (e) { M.Toast({ message: 'Ошибка', type: 'error' }); }
            }
          },
        });
      }
      return actions;
    }

    function openDetail(r) {
      const st = statusMap[r.status] || { label: r.status, color: 'neutral' };
      const content = el('div');
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

      M.BottomSheet({ title: 'Заявка #' + r.id, content, fullscreen: false });
    }

    function openCreateModal() {
      let step = 0;
      const formData = { purpose: '', amount: '', work_id: '', comment: '' };

      function renderStep() {
        const content = el('div');

        if (step === 0) {
          content.appendChild(M.Form({
            fields: [
              { id: 'purpose', label: 'Назначение', type: 'text', required: true, placeholder: 'Командировка, закупка и т.д.', value: formData.purpose },
              { id: 'amount', label: 'Сумма, ₽', type: 'number', required: true, placeholder: '50000', value: formData.amount },
              { id: 'comment', label: 'Комментарий', type: 'textarea', placeholder: 'Детали заявки...', value: formData.comment },
            ],
            submitLabel: 'Далее →',
            onSubmit: (data) => {
              Object.assign(formData, data);
              step = 1;
              sheetRef.body.innerHTML = '';
              sheetRef.body.appendChild(renderStep());
            },
          }));
        } else {
          // Confirmation step
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
            onClick: async () => {
              try {
                await API.fetch('/cash', {
                  method: 'POST',
                  body: {
                    purpose: formData.purpose,
                    amount: parseFloat(formData.amount),
                    comment: formData.comment,
                    work_id: formData.work_id || null,
                  },
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
            label: '← Назад',
            variant: 'secondary',
            onClick: () => {
              step = 0;
              sheetRef.body.innerHTML = '';
              sheetRef.body.appendChild(renderStep());
            },
          }));
        }

        return content;
      }

      const sheetRef = M.BottomSheet({
        title: 'Новая заявка на аванс',
        content: renderStep(),
        fullscreen: true,
      });
    }

    return page;
  },
};

Router.register('/cash', CashPage);
if (typeof window !== 'undefined') window.CashPage = CashPage;
