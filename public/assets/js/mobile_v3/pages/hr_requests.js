/**
 * ASGARD CRM — Mobile v3 / Заявки HR
 * Окно 3, Сессия 9 — 14.03.2026
 */
const HrRequestsPage = {
  async render() {
    const t = DS.t;
    const el = Utils.el;

    const STATUS_MAP = {
      draft:          { label: 'Черновик',         color: 'neutral' },
      pending:        { label: 'На рассмотрении',  color: 'info' },
      approved:       { label: 'Одобрена',         color: 'success' },
      rejected:       { label: 'Отклонена',        color: 'danger' },
      in_progress:    { label: 'В работе',         color: 'info' },
      completed:      { label: 'Завершена',        color: 'success' },
      cancelled:      { label: 'Отменена',         color: 'neutral' },
    };

    const TYPE_MAP = {
      hire:      'Найм',
      dismiss:   'Увольнение',
      transfer:  'Перевод',
      vacation:  'Отпуск',
      sick:      'Больничный',
      document:  'Документ',
      other:     'Прочее',
    };

    let items = [];
    let users = [];
    try {
      // HR requests endpoint — try multiple patterns
      const resp = await API.fetch('/hr-requests').catch(() => API.fetch('/staff/requests').catch(() => ({ items: [] })));
      items = resp.items || resp.data || (Array.isArray(resp) ? resp : []);
      const uResp = await API.fetch('/users').catch(() => []);
      users = Array.isArray(uResp) ? uResp : (uResp.users || []);
    } catch (e) { console.error('[HrRequests] load error', e); }

    const userMap = new Map(users.map(u => [u.id, u.name || u.fio || '—']));

    const filterPills = [
      { label: 'Все', value: 'all', active: true },
      { label: 'На рассмотрении', value: 'pending' },
      { label: 'Одобрена', value: 'approved' },
      { label: 'В работе', value: 'in_progress' },
      { label: 'Отклонена', value: 'rejected' },
    ];

    const page = M.TablePage({
      title: 'Заявки HR',
      subtitle: 'КАДРЫ',
      back: true,
      backHref: '/home',
      items,
      search: true,
      filter: {
        pills: filterPills,
        filterFn: (item, val) => val === 'all' || item.status === val,
      },
      renderItem: (item) => {
        const st = STATUS_MAP[item.status] || STATUS_MAP.draft;
        const typeName = TYPE_MAP[item.type] || item.type_name || item.type || '—';
        const fields = [];
        if (typeName) fields.push({ label: 'Тип', value: typeName });
        if (item.employee_name || item.employee_fio) fields.push({ label: 'Сотрудник', value: item.employee_name || item.employee_fio });
        if (item.requester_id) fields.push({ label: 'Заявитель', value: userMap.get(item.requester_id) || '—' });
        if (item.position) fields.push({ label: 'Должность', value: item.position });

        return M.Card({
          title: item.title || typeName + (item.employee_name ? ' — ' + item.employee_name : ''),
          badge: st.label,
          badgeColor: st.color,
          fields,
          time: item.created_at ? Utils.relativeTime(item.created_at) : undefined,
          onClick: () => openDetail(item),
        });
      },
      empty: M.Empty({ text: 'Нет заявок HR', icon: '📋' }),
      fab: { icon: '+', onClick: () => openCreateForm() },
      onRefresh: async () => {
        const resp = await API.fetch('/hr-requests', { noCache: true }).catch(() => API.fetch('/staff/requests', { noCache: true }).catch(() => ({ items: [] })));
        return resp.items || resp.data || (Array.isArray(resp) ? resp : []);
      },
    });

    function openDetail(item) {
      const st = STATUS_MAP[item.status] || STATUS_MAP.draft;
      const fields = [
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'Тип', value: TYPE_MAP[item.type] || item.type_name || item.type || '—' },
        { label: 'Сотрудник', value: item.employee_name || item.employee_fio || '—' },
        { label: 'Заявитель', value: item.requester_id ? userMap.get(item.requester_id) : '—' },
      ];
      if (item.position) fields.push({ label: 'Должность', value: item.position });
      if (item.department) fields.push({ label: 'Отдел', value: item.department });
      if (item.date_from) fields.push({ label: 'Дата с', value: Utils.formatDate(item.date_from) });
      if (item.date_to) fields.push({ label: 'Дата по', value: Utils.formatDate(item.date_to) });
      if (item.comment) fields.push({ label: 'Комментарий', value: item.comment });
      if (item.reason) fields.push({ label: 'Причина', value: item.reason });

      const content = el('div');
      content.appendChild(M.DetailFields({ fields }));

      // Approval buttons
      const user = Store.get('user');
      const canApprove = user && (user.role === 'ADMIN' || user.role === 'HR' || (user.role || '').startsWith('DIRECTOR'));

      if (canApprove && item.status === 'pending') {
        const btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
        btns.appendChild(M.FullWidthBtn({
          label: '✓ Одобрить',
          onClick: async () => {
            try {
              await API.fetch('/hr-requests/' + item.id, { method: 'PUT', body: { status: 'approved' } });
              M.Toast({ message: 'Одобрено', type: 'success' });
            } catch (e) { M.Toast({ message: 'Ошибка', type: 'error' }); }
          },
        }));
        btns.appendChild(M.FullWidthBtn({
          label: '✕ Отклонить',
          variant: 'danger',
          onClick: async () => {
            const ok = await M.Confirm({ title: 'Отклонить заявку?', danger: true });
            if (!ok) return;
            try {
              await API.fetch('/hr-requests/' + item.id, { method: 'PUT', body: { status: 'rejected' } });
              M.Toast({ message: 'Отклонено', type: 'success' });
            } catch (e) { M.Toast({ message: 'Ошибка', type: 'error' }); }
          },
        }));
        content.appendChild(btns);
      }

      M.BottomSheet({ title: item.title || 'Заявка HR', content, fullscreen: true });
    }

    function openCreateForm() {
      const content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'type', label: 'Тип заявки', type: 'select', options: Object.entries(TYPE_MAP).map(([v, l]) => ({ value: v, label: l })), required: true },
          { id: 'employee_name', label: 'ФИО сотрудника', required: true },
          { id: 'position', label: 'Должность' },
          { id: 'date_from', label: 'Дата с', type: 'date' },
          { id: 'date_to', label: 'Дата по', type: 'date' },
          { id: 'comment', label: 'Комментарий', type: 'textarea' },
        ],
        submitLabel: 'Создать заявку',
        onSubmit: async (data) => {
          try {
            await API.fetch('/hr-requests', { method: 'POST', body: data });
            M.Toast({ message: 'Заявка создана', type: 'success' });
          } catch (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); }
        },
      }));
      M.BottomSheet({ title: 'Новая заявка HR', content, fullscreen: true });
    }

    return page;
  },
};

Router.register('/hr-requests', HrRequestsPage);
if (typeof window !== 'undefined') window.HrRequestsPage = HrRequestsPage;
