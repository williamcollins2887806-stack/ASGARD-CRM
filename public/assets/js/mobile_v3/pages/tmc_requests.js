/**
 * ASGARD CRM — Mobile v3 / Заявки на ТМЦ
 * Окно 3, Сессия 8 — 14.03.2026
 */
const TmcRequestsPage = {
  async render() {
    const t = DS.t;
    const el = Utils.el;

    const STATUS_MAP = {
      draft:     { label: 'Черновик',   color: 'neutral' },
      submitted: { label: 'Подана',     color: 'info' },
      approved:  { label: 'Одобрена',   color: 'success' },
      rejected:  { label: 'Отклонена',  color: 'danger' },
      ordered:   { label: 'Заказано',   color: 'info' },
      delivered: { label: 'Доставлено', color: 'success' },
      closed:    { label: 'Закрыта',    color: 'neutral' },
    };

    const PRIORITY_MAP = {
      low:    { label: 'Низкий',  color: 'neutral' },
      normal: { label: 'Обычный', color: 'info' },
      high:   { label: 'Высокий', color: 'warning' },
      urgent: { label: 'Срочный', color: 'danger' },
    };

    let items = [];
    try {
      const resp = await API.fetch('/tmc-requests');
      items = resp.items || resp.data || (Array.isArray(resp) ? resp : []);
    } catch (e) { console.error('[TmcRequests] load error', e); }

    const filterPills = [
      { label: 'Все', value: 'all', active: true },
      { label: 'Подана', value: 'submitted' },
      { label: 'Одобрена', value: 'approved' },
      { label: 'Заказано', value: 'ordered' },
      { label: 'Доставлено', value: 'delivered' },
    ];

    const page = M.TablePage({
      title: 'Заявки ТМЦ',
      subtitle: 'СКЛАД ЩИТОВ',
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
        const pr = PRIORITY_MAP[item.priority] || PRIORITY_MAP.normal;
        const fields = [];
        if (item.work_title) fields.push({ label: 'Проект', value: item.work_title });
        if (item.total_sum) fields.push({ label: 'Сумма', value: Utils.formatMoney(item.total_sum) });
        if (item.priority && item.priority !== 'normal') fields.push({ label: 'Приоритет', value: pr.label });

        return M.Card({
          title: item.title || 'Заявка #' + item.id,
          badge: st.label,
          badgeColor: st.color,
          fields,
          time: item.created_at ? Utils.relativeTime(item.created_at) : undefined,
          onClick: () => openDetail(item),
        });
      },
      empty: M.Empty({ text: 'Нет заявок на ТМЦ', icon: '📦' }),
      fab: { icon: '+', onClick: () => openCreateForm() },
      onRefresh: async () => {
        const resp = await API.fetch('/tmc-requests', { noCache: true });
        return resp.items || resp.data || (Array.isArray(resp) ? resp : []);
      },
    });

    function openDetail(item) {
      const st = STATUS_MAP[item.status] || STATUS_MAP.draft;
      const pr = PRIORITY_MAP[item.priority] || PRIORITY_MAP.normal;
      const itemsList = Array.isArray(item.items_json) ? item.items_json : [];
      const fields = [
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'Проект', value: item.work_title || '—' },
        { label: 'Приоритет', value: pr.label },
      ];
      if (item.total_sum) fields.push({ label: 'Сумма', value: Utils.formatMoney(item.total_sum) });
      if (item.comment) fields.push({ label: 'Комментарий', value: item.comment });

      const content = el('div');
      content.appendChild(M.DetailFields({ fields }));

      // Items table
      if (itemsList.length) {
        const label = el('div', { style: { ...DS.font('sm'), color: t.textSec, marginTop: '16px', marginBottom: '8px' } });
        label.textContent = 'Состав заявки (' + itemsList.length + ')';
        content.appendChild(label);

        itemsList.forEach((row) => {
          const r = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid ' + t.border } });
          r.appendChild(el('span', { style: { ...DS.font('sm'), color: t.text, flex: 1 } }, row.name || row.title || '—'));
          r.appendChild(el('span', { style: { ...DS.font('sm'), color: t.textSec, flexShrink: 0 } }, (row.quantity || '—') + ' ' + (row.unit || 'шт')));
          content.appendChild(r);
        });
      }

      const btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
      btns.appendChild(M.FullWidthBtn({
        label: '📥 Excel',
        variant: 'secondary',
        onClick: () => {
          const token = API.getToken();
          window.open(API.BASE + '/tmc-requests/export?id=' + item.id + '&token=' + token, '_blank');
        },
      }));
      content.appendChild(btns);

      M.BottomSheet({ title: item.title || 'Заявка ТМЦ', content, fullscreen: true });
    }

    function openCreateForm() {
      const content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'title', label: 'Название', required: true },
          { id: 'work_title', label: 'Проект / Работа' },
          { id: 'priority', label: 'Приоритет', type: 'select', options: [
            { value: 'normal', label: 'Обычный' },
            { value: 'high', label: 'Высокий' },
            { value: 'urgent', label: 'Срочный' },
            { value: 'low', label: 'Низкий' },
          ], value: 'normal' },
          { id: 'comment', label: 'Комментарий', type: 'textarea' },
        ],
        submitLabel: 'Создать заявку',
        onSubmit: async (data) => {
          try {
            await API.fetch('/tmc-requests', { method: 'POST', body: data });
            M.Toast({ message: 'Заявка создана', type: 'success' });
          } catch (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); }
        },
      }));
      M.BottomSheet({ title: 'Новая заявка ТМЦ', content, fullscreen: true });
    }

    return page;
  },
};

Router.register('/tmc-requests', TmcRequestsPage);
if (typeof window !== 'undefined') window.TmcRequestsPage = TmcRequestsPage;
