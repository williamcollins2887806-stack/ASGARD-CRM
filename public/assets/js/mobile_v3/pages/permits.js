/**
 * ASGARD CRM — Mobile v3 / Допуски и удостоверения
 * Окно 3, Сессия 8 — 14.03.2026
 */
const PermitsPage = {
  async render() {
    const t = DS.t;
    const el = Utils.el;

    function getPermitStatus(item) {
      if (!item.valid_to) return { label: 'Без срока', color: 'neutral' };
      const now = new Date();
      const end = new Date(item.valid_to);
      const daysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
      if (daysLeft < 0) return { label: 'Просрочен', color: 'danger' };
      if (daysLeft <= 30) return { label: 'Истекает (' + daysLeft + ' дн)', color: 'warning' };
      return { label: 'Действует', color: 'success' };
    }

    let permits = [];
    let employees = [];
    try {
      const [pResp, eResp] = await Promise.all([
        API.fetch('/permits'),
        API.fetch('/staff/employees?limit=1000').catch(() => []),
      ]);
      permits = pResp.items || pResp.data || (Array.isArray(pResp) ? pResp : []);
      employees = Array.isArray(eResp) ? eResp : (eResp.items || eResp.data || []);
    } catch (e) { console.error('[Permits] load error', e); }

    const empMap = new Map(employees.map(emp => [emp.id, emp.fio || emp.name || '—']));

    // Stats
    const expired = permits.filter(p => getPermitStatus(p).color === 'danger').length;
    const expiring = permits.filter(p => getPermitStatus(p).color === 'warning').length;
    const valid = permits.filter(p => getPermitStatus(p).color === 'success').length;

    const filterPills = [
      { label: 'Все', value: 'all', active: true },
      { label: 'Действует', value: 'valid' },
      { label: 'Истекает', value: 'expiring' },
      { label: 'Просрочен', value: 'expired' },
    ];

    const page = M.TablePage({
      title: 'Допуски',
      subtitle: 'УДОСТОВЕРЕНИЯ',
      back: true,
      backHref: '/home',
      items: permits,
      search: true,
      stats: [
        { icon: '🛡', value: permits.length, label: 'Всего', color: t.blue },
        { icon: '✅', value: valid, label: 'Действует', color: t.green },
        { icon: '⚠️', value: expiring, label: 'Истекает', color: t.orange },
        { icon: '❌', value: expired, label: 'Просрочено', color: t.red },
      ],
      filter: {
        pills: filterPills,
        filterFn: (item, val) => {
          if (val === 'all') return true;
          const st = getPermitStatus(item);
          if (val === 'valid') return st.color === 'success';
          if (val === 'expiring') return st.color === 'warning';
          if (val === 'expired') return st.color === 'danger';
          return true;
        },
      },
      renderItem: (permit) => {
        const st = getPermitStatus(permit);
        const fields = [];
        if (permit.employee_id) fields.push({ label: 'Сотрудник', value: empMap.get(permit.employee_id) || '—' });
        if (permit.valid_from) fields.push({ label: 'С', value: Utils.formatDate(permit.valid_from) });
        if (permit.valid_to) fields.push({ label: 'До', value: Utils.formatDate(permit.valid_to) });
        if (permit.number) fields.push({ label: '№', value: permit.number });

        return M.Card({
          title: permit.permit_type || permit.type_name || permit.title || 'Допуск #' + permit.id,
          subtitle: permit.employee_id ? empMap.get(permit.employee_id) : undefined,
          badge: st.label,
          badgeColor: st.color,
          fields,
          onClick: () => openDetail(permit),
        });
      },
      empty: M.Empty({ text: 'Нет допусков', icon: '🛡' }),
      onRefresh: async () => {
        const resp = await API.fetch('/permits', { noCache: true });
        return resp.items || resp.data || (Array.isArray(resp) ? resp : []);
      },
    });

    function openDetail(permit) {
      const st = getPermitStatus(permit);
      const fields = [
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'Тип', value: permit.permit_type || permit.type_name || '—' },
        { label: 'Сотрудник', value: permit.employee_id ? empMap.get(permit.employee_id) : '—' },
        { label: 'Номер', value: permit.number || '—', copy: true },
      ];
      if (permit.valid_from) fields.push({ label: 'Действует с', value: Utils.formatDate(permit.valid_from) });
      if (permit.valid_to) fields.push({ label: 'Действует до', value: Utils.formatDate(permit.valid_to) });
      if (permit.issuing_authority) fields.push({ label: 'Выдано', value: permit.issuing_authority });
      if (permit.work_title) fields.push({ label: 'Работа', value: permit.work_title });

      const content = el('div');
      content.appendChild(M.DetailFields({ fields }));

      // Scan download
      if (permit.scan_file) {
        const btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
        btns.appendChild(M.FullWidthBtn({
          label: '📎 Скачать скан',
          variant: 'secondary',
          onClick: () => {
            window.open(API.BASE + '/files/download/' + permit.scan_file, '_blank');
          },
        }));
        content.appendChild(btns);
      }

      // Progress bar for days remaining
      if (permit.valid_to) {
        const now = new Date();
        const end = new Date(permit.valid_to);
        const start = permit.valid_from ? new Date(permit.valid_from) : new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);
        const total = end - start;
        const elapsed = now - start;
        const pct = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));

        const progWrap = el('div', { style: { marginTop: '16px' } });
        progWrap.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec, marginBottom: '4px' } }, 'Срок действия'));
        progWrap.appendChild(M.ProgressBar({ value: pct, label: pct + '%' }));
        content.appendChild(progWrap);
      }

      M.BottomSheet({ title: permit.permit_type || 'Допуск', content, fullscreen: true });
    }

    return page;
  },
};

Router.register('/permits', PermitsPage);
if (typeof window !== 'undefined') window.PermitsPage = PermitsPage;
