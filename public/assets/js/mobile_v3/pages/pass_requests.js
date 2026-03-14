/**
 * ASGARD CRM — Mobile v3 / Заявки на пропуски
 * Окно 3, Сессия 8 — 14.03.2026
 */
const PassRequestsPage = {
  async render() {
    const t = DS.t;
    const el = Utils.el;

    const STATUS_MAP = {
      draft:     { label: 'Черновик',   color: 'neutral' },
      submitted: { label: 'Подана',     color: 'info' },
      approved:  { label: 'Одобрена',   color: 'success' },
      rejected:  { label: 'Отклонена',  color: 'danger' },
      issued:    { label: 'Выдан',      color: 'success' },
      expired:   { label: 'Просрочен',  color: 'warning' },
    };

    let items = [];
    try {
      const resp = await API.fetch('/pass-requests');
      items = resp.items || resp.data || (Array.isArray(resp) ? resp : []);
    } catch (e) { console.error('[PassRequests] load error', e); }

    const filterPills = [
      { label: 'Все', value: 'all', active: true },
      { label: 'Подана', value: 'submitted' },
      { label: 'Одобрена', value: 'approved' },
      { label: 'Отклонена', value: 'rejected' },
      { label: 'Выдан', value: 'issued' },
    ];

    const page = M.TablePage({
      title: 'Пропуска',
      subtitle: 'ЗАЯВКИ',
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
        const emps = Array.isArray(item.employees_json) ? item.employees_json : [];
        const fields = [];
        if (item.object_name) fields.push({ label: 'Объект', value: item.object_name });
        if (emps.length) fields.push({ label: 'Сотрудники', value: emps.length + ' чел.' });
        if (item.pass_date_from && item.pass_date_to) {
          fields.push({ label: 'Период', value: Utils.formatDate(item.pass_date_from) + ' — ' + Utils.formatDate(item.pass_date_to) });
        }

        return M.Card({
          title: item.object_name || 'Заявка #' + item.id,
          subtitle: item.pass_date_from ? Utils.formatDate(item.pass_date_from) + ' — ' + Utils.formatDate(item.pass_date_to) : undefined,
          badge: st.label,
          badgeColor: st.color,
          fields,
          time: item.created_at ? Utils.relativeTime(item.created_at) : undefined,
          onClick: () => openDetail(item),
        });
      },
      empty: M.Empty({ text: 'Нет заявок на пропуски', icon: '🪪' }),
      fab: { icon: '+', onClick: () => openCreateForm() },
      onRefresh: async () => {
        const resp = await API.fetch('/pass-requests', { noCache: true });
        return resp.items || resp.data || (Array.isArray(resp) ? resp : []);
      },
    });

    function openDetail(item) {
      const st = STATUS_MAP[item.status] || STATUS_MAP.draft;
      const emps = Array.isArray(item.employees_json) ? item.employees_json : [];
      const fields = [
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'Объект', value: item.object_name || '—' },
        { label: 'Период', value: (item.pass_date_from ? Utils.formatDate(item.pass_date_from) : '?') + ' — ' + (item.pass_date_to ? Utils.formatDate(item.pass_date_to) : '?') },
        { label: 'Сотрудники', value: emps.length ? emps.map(e => e.fio || e.name || e).join(', ') : '—' },
      ];
      if (item.comment) fields.push({ label: 'Комментарий', value: item.comment });

      const content = el('div');
      content.appendChild(M.DetailFields({ fields }));

      const btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
      btns.appendChild(M.FullWidthBtn({
        label: '📄 PDF',
        variant: 'secondary',
        onClick: () => {
          const token = API.getToken();
          window.open(API.BASE + '/pass-requests/' + item.id + '/pdf?token=' + token, '_blank');
        },
      }));
      if (item.status === 'draft') {
        btns.appendChild(M.FullWidthBtn({
          label: 'Подать',
          onClick: async () => {
            try {
              await API.fetch('/pass-requests/' + item.id, { method: 'PUT', body: { status: 'submitted' } });
              M.Toast({ message: 'Заявка подана', type: 'success' });
            } catch (e) { M.Toast({ message: 'Ошибка', type: 'error' }); }
          },
        }));
      }
      content.appendChild(btns);

      M.BottomSheet({ title: 'Заявка #' + item.id, content });
    }

    function openCreateForm() {
      const content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'object_name', label: 'Объект', required: true },
          { id: 'pass_date_from', label: 'Дата с', type: 'date', required: true },
          { id: 'pass_date_to', label: 'Дата по', type: 'date', required: true },
          { id: 'comment', label: 'Комментарий', type: 'textarea' },
        ],
        submitLabel: 'Создать заявку',
        onSubmit: async (data) => {
          try {
            await API.fetch('/pass-requests', { method: 'POST', body: data });
            M.Toast({ message: 'Заявка создана', type: 'success' });
          } catch (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); }
        },
      }));
      M.BottomSheet({ title: 'Новая заявка на пропуск', content, fullscreen: true });
    }

    return page;
  },
};

Router.register('/pass-requests', PassRequestsPage);
if (typeof window !== 'undefined') window.PassRequestsPage = PassRequestsPage;
