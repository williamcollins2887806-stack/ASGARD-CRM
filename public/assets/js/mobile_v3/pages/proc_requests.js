/**
 * ASGARD CRM — Mobile v3 / Заявки закупок
 * Окно 3, Сессия 8 — 14.03.2026
 */
const ProcRequestsPage = {
  async render() {
    const t = DS.t;
    const el = Utils.el;

    const STATUS_MAP = {
      sent:     { label: 'Отправлена', color: 'info' },
      answered: { label: 'Ответ',     color: 'gold' },
      approved: { label: 'Одобрена',  color: 'success' },
      rework:   { label: 'Доработка', color: 'warning' },
      draft:    { label: 'Черновик',  color: 'neutral' },
      ordered:  { label: 'Заказано',  color: 'info' },
      closed:   { label: 'Закрыта',   color: 'neutral' },
    };

    let items = [];
    let users = [];
    try {
      // proc_requests uses AsgardDB on desktop; mobile reads via API
      const resp = await API.fetch('/procurement-requests').catch(() => API.fetch('/proc-requests').catch(() => ({ items: [] })));
      items = resp.items || resp.data || (Array.isArray(resp) ? resp : []);
      const uResp = await API.fetch('/users').catch(() => []);
      users = Array.isArray(uResp) ? uResp : (uResp.users || []);
    } catch (e) { console.error('[ProcRequests] load error', e); }

    const userMap = new Map(users.map(u => [u.id, u.name || u.fio || '—']));

    const filterPills = [
      { label: 'Все', value: 'all', active: true },
      { label: 'Отправлена', value: 'sent' },
      { label: 'Ответ', value: 'answered' },
      { label: 'Одобрена', value: 'approved' },
      { label: 'Доработка', value: 'rework' },
    ];

    const page = M.TablePage({
      title: 'Закупки',
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
        const fields = [];
        if (item.pm_id) fields.push({ label: 'РП', value: userMap.get(item.pm_id) || '—' });
        if (item.work_title) fields.push({ label: 'Работа', value: item.work_title });
        if (item.total_sum) fields.push({ label: 'Сумма', value: Utils.formatMoney(item.total_sum) });

        const composition = [];
        try {
          const parsed = typeof item.items_json === 'string' ? JSON.parse(item.items_json) : item.items_json;
          if (Array.isArray(parsed)) composition.push(...parsed);
        } catch (_) {}

        return M.Card({
          title: item.work_title || item.title || 'Заявка #' + item.id,
          subtitle: composition.length ? composition.length + ' позиций' : undefined,
          badge: st.label,
          badgeColor: st.color,
          fields,
          time: item.created_at ? Utils.relativeTime(item.created_at) : undefined,
          onClick: () => openDetail(item),
        });
      },
      empty: M.Empty({ text: 'Нет заявок на закупку', icon: '🛒' }),
      fab: { icon: '+', onClick: () => M.Toast({ message: 'Создание закупок — с десктопа', type: 'info' }) },
      onRefresh: async () => {
        const resp = await API.fetch('/procurement-requests', { noCache: true }).catch(() => API.fetch('/proc-requests', { noCache: true }).catch(() => ({ items: [] })));
        return resp.items || resp.data || (Array.isArray(resp) ? resp : []);
      },
    });

    function openDetail(item) {
      const st = STATUS_MAP[item.status] || STATUS_MAP.draft;
      const fields = [
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'РП', value: item.pm_id ? userMap.get(item.pm_id) : '—' },
        { label: 'Работа', value: item.work_title || '—' },
      ];
      if (item.total_sum) fields.push({ label: 'Сумма', value: Utils.formatMoney(item.total_sum) });
      if (item.comment) fields.push({ label: 'Комментарий', value: item.comment });

      const composition = [];
      try {
        const parsed = typeof item.items_json === 'string' ? JSON.parse(item.items_json) : item.items_json;
        if (Array.isArray(parsed)) composition.push(...parsed);
      } catch (_) {}

      const content = el('div');
      content.appendChild(M.DetailFields({ fields }));

      if (composition.length) {
        const label = el('div', { style: { ...DS.font('sm'), color: t.textSec, marginTop: '16px', marginBottom: '8px' } });
        label.textContent = 'Состав (' + composition.length + ')';
        content.appendChild(label);

        composition.forEach((row) => {
          const r = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid ' + t.border } });
          r.appendChild(el('span', { style: { ...DS.font('sm'), color: t.text, flex: 1 } }, row.name || row.title || '—'));
          r.appendChild(el('span', { style: { ...DS.font('sm'), color: t.textSec, flexShrink: 0 } }, (row.quantity || '') + ' ' + (row.unit || '')));
          content.appendChild(r);
        });
      }

      M.BottomSheet({ title: 'Закупка #' + item.id, content, fullscreen: true });
    }

    return page;
  },
};

Router.register('/proc-requests', ProcRequestsPage);
if (typeof window !== 'undefined') window.ProcRequestsPage = ProcRequestsPage;
