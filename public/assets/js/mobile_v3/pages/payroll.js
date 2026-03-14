/**
 * ASGARD CRM — Mobile v3: Ведомости ЗП
 * Route: #/payroll
 * API: GET /api/payroll/sheets, GET /api/payroll/sheets/:id,
 *      PUT /api/payroll/sheets/:id/approve, PUT /api/payroll/sheets/:id/submit
 */
const PayrollPage = {
  async render() {
    const el = Utils.el;
    const t = DS.t;

    const statusMap = {
      draft: { label: 'Черновик', color: 'neutral' },
      pending: { label: 'На согласовании', color: 'info' },
      submitted: { label: 'На согласовании', color: 'info' },
      approved: { label: 'Согласовано', color: 'success' },
      paid: { label: 'Оплачено', color: 'success' },
      rework: { label: 'На доработке', color: 'warning' },
      rejected: { label: 'Отклонено', color: 'danger' },
    };

    const page = el('div', { style: { paddingBottom: '100px' } });
    page.appendChild(M.Header({ title: 'Ведомости', subtitle: 'ЗАРПЛАТА', back: true, backHref: '/home' }));

    const body = el('div');
    body.appendChild(M.Skeleton({ type: 'card', count: 4 }));
    page.appendChild(body);

    let sheets = [];
    let currentFilter = 'all';

    try {
      const data = await API.fetch('/payroll/sheets');
      sheets = Array.isArray(data) ? data : (data.sheets || data.data || []);

      body.innerHTML = '';

      // Stats
      const totalAmount = sheets.reduce((s, sh) => s + (parseFloat(sh.total_amount || sh.amount || 0)), 0);
      const pending = sheets.filter(s => s.status === 'pending' || s.status === 'submitted');
      const paid = sheets.filter(s => s.status === 'paid');

      body.appendChild(el('div', { style: { margin: '12px 0 4px' } }, M.Stats({
        items: [
          { icon: '📋', label: 'Всего', value: sheets.length },
          { icon: '⏳', label: 'На согласов.', value: pending.length, color: 'var(--orange)' },
          { icon: '✅', label: 'Оплачено', value: paid.length, color: 'var(--green)' },
          { icon: '💰', label: 'Общая сумма', value: Utils.formatMoney(totalAmount) },
        ],
      })));

      // Filters
      body.appendChild(M.FilterPills({
        items: [
          { label: 'Все', value: 'all', active: true },
          { label: 'Черновики', value: 'draft' },
          { label: 'На согласов.', value: 'pending' },
          { label: 'Согласовано', value: 'approved' },
          { label: 'Оплачено', value: 'paid' },
        ],
        onChange: (val) => { currentFilter = val; renderList(); },
      }));

      const listContainer = el('div', { style: { padding: '12px 0' } });
      body.appendChild(listContainer);

      function renderList() {
        listContainer.innerHTML = '';
        let filtered = sheets;
        if (currentFilter !== 'all') {
          filtered = sheets.filter(s => s.status === currentFilter || (currentFilter === 'pending' && s.status === 'submitted'));
        }

        if (!filtered.length) {
          listContainer.appendChild(M.Empty({ text: 'Нет ведомостей', type: 'search' }));
          return;
        }

        const sorted = [...filtered].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px' } });

        sorted.forEach((sh, i) => {
          const st = statusMap[sh.status] || { label: sh.status, color: 'neutral' };
          const card = M.Card({
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
            onClick: () => openDetail(sh),
          });
          list.appendChild(card);
        });

        listContainer.appendChild(list);
      }

      renderList();

    } catch (e) {
      body.innerHTML = '';
      body.appendChild(M.Empty({ text: 'Ошибка загрузки', type: 'error' }));
    }

    function buildActions(sh) {
      const actions = [];
      const user = Store.get('user') || {};
      const isManager = ['ADMIN', 'DIRECTOR', 'DIRECTOR_GEN', 'HEAD_PM'].includes(user.role);

      if (sh.status === 'draft') {
        actions.push({
          label: '📤 Отправить',
          onClick: async () => {
            const ok = await M.Confirm({ title: 'Отправить на согласование?', message: sh.title || 'Ведомость #' + sh.id });
            if (ok) {
              try {
                await API.fetch('/payroll/sheets/' + sh.id + '/submit', { method: 'PUT' });
                M.Toast({ message: 'Отправлено', type: 'success' });
                Router.navigate('/payroll', { replace: true });
              } catch (e) { M.Toast({ message: 'Ошибка', type: 'error' }); }
            }
          },
        });
      }
      if ((sh.status === 'pending' || sh.status === 'submitted') && isManager) {
        actions.push({
          label: '✓ Согласовать',
          onClick: async () => {
            const ok = await M.Confirm({ title: 'Согласовать ведомость?', message: Utils.formatMoney(sh.total_amount || sh.amount) + ' ₽' });
            if (ok) {
              try {
                await API.fetch('/payroll/sheets/' + sh.id + '/approve', { method: 'PUT' });
                M.Toast({ message: 'Согласовано', type: 'success' });
                Router.navigate('/payroll', { replace: true });
              } catch (e) { M.Toast({ message: 'Ошибка', type: 'error' }); }
            }
          },
        });
      }
      return actions;
    }

    async function openDetail(sh) {
      const st = statusMap[sh.status] || { label: sh.status, color: 'neutral' };
      const content = el('div');

      // Basic info
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

      // Try loading items
      try {
        const detail = await API.fetch('/payroll/sheets/' + sh.id);
        const items = detail.items || detail.employees || [];

        if (items.length) {
          content.appendChild(el('div', { style: { height: '16px' } }));
          const itemsSection = el('div');
          itemsSection.appendChild(el('div', {
            style: { ...DS.font('md'), color: t.text, padding: '0 0 8px' },
            textContent: 'Работники (' + items.length + ')',
          }));

          items.slice(0, 20).forEach((item) => {
            const row = el('div', {
              style: {
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 0', borderBottom: '1px solid ' + t.border,
              },
            });
            row.appendChild(el('span', {
              style: { ...DS.font('sm'), color: t.text },
              textContent: item.employee_name || item.name || 'Сотрудник',
            }));
            row.appendChild(el('span', {
              style: { ...DS.font('sm'), fontWeight: 600, color: t.text },
              textContent: Utils.formatMoney(parseFloat(item.amount || item.total || 0)) + ' ₽',
            }));
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
      } catch (e) { /* detail load failed — okay, basic info shown */ }

      M.BottomSheet({ title: 'Ведомость #' + sh.id, content, fullscreen: true });
    }

    return page;
  },
};

Router.register('/payroll', PayrollPage);
if (typeof window !== 'undefined') window.PayrollPage = PayrollPage;
