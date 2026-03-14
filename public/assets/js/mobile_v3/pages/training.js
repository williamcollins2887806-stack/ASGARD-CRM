/**
 * ASGARD CRM — Mobile v3 / Обучение
 * Окно 3, Сессия 9 — 14.03.2026
 * Двойное согласование: руководитель → директор
 */
const TrainingPage = {
  async render() {
    const t = DS.t;
    const el = Utils.el;

    const STATUS_MAP = {
      draft:            { label: 'Черновик',         color: 'neutral' },
      pending_approval: { label: 'На согласовании',  color: 'info' },
      approved:         { label: 'Согласовано',       color: 'success' },
      budget_approved:  { label: 'Бюджет утверждён', color: 'gold' },
      paid:             { label: 'Оплачено',          color: 'warning' },
      completed:        { label: 'Завершено',         color: 'success' },
      rejected:         { label: 'Отклонено',         color: 'danger' },
    };

    const TYPE_MAP = {
      external:      'Внешнее',
      internal:      'Внутреннее',
      conference:    'Конференция',
      certification: 'Сертификация',
      online:        'Онлайн-курс',
    };

    let items = [];
    try {
      const resp = await API.fetch('/training-applications').catch(() => ({ items: [] }));
      items = resp.items || resp.data || (Array.isArray(resp) ? resp : []);
    } catch (e) { console.error('[Training] load error', e); }

    const filterPills = [
      { label: 'Все', value: 'all', active: true },
      { label: 'На согласовании', value: 'pending_approval' },
      { label: 'Согласовано', value: 'approved' },
      { label: 'Оплачено', value: 'paid' },
      { label: 'Отклонено', value: 'rejected' },
    ];

    const page = M.TablePage({
      title: 'Обучение',
      subtitle: 'РАЗВИТИЕ',
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
        const typeName = TYPE_MAP[item.type] || item.type || '—';
        const fields = [];
        if (item.employee_name || item.employee_fio) fields.push({ label: 'Сотрудник', value: item.employee_name || item.employee_fio });
        fields.push({ label: 'Тип', value: typeName });
        if (item.cost && Number(item.cost) > 0) fields.push({ label: 'Стоимость', value: Utils.formatMoney(item.cost) });
        if (item.date_from) fields.push({ label: 'Начало', value: Utils.formatDate(item.date_from) });

        return M.Card({
          title: item.title || item.course_name || 'Обучение #' + item.id,
          badge: st.label,
          badgeColor: st.color,
          fields,
          time: item.created_at ? Utils.relativeTime(item.created_at) : undefined,
          onClick: () => openDetail(item),
        });
      },
      empty: M.Empty({ text: 'Нет заявок на обучение', icon: '📚' }),
      fab: { icon: '+', onClick: () => openCreateForm() },
      onRefresh: async () => {
        const resp = await API.fetch('/training-applications', { noCache: true }).catch(() => ({ items: [] }));
        return resp.items || resp.data || (Array.isArray(resp) ? resp : []);
      },
    });

    function openDetail(item) {
      const st = STATUS_MAP[item.status] || STATUS_MAP.draft;
      const fields = [
        { label: 'Статус', value: st.label, type: 'badge', badgeColor: st.color },
        { label: 'Курс / Программа', value: item.title || item.course_name || '—' },
        { label: 'Тип', value: TYPE_MAP[item.type] || item.type || '—' },
        { label: 'Сотрудник', value: item.employee_name || item.employee_fio || '—' },
      ];
      if (item.provider) fields.push({ label: 'Провайдер', value: item.provider });
      if (item.cost && Number(item.cost) > 0) fields.push({ label: 'Стоимость', value: Utils.formatMoney(item.cost) });
      if (item.date_from) fields.push({ label: 'Начало', value: Utils.formatDate(item.date_from) });
      if (item.date_to) fields.push({ label: 'Окончание', value: Utils.formatDate(item.date_to) });
      if (item.comment) fields.push({ label: 'Комментарий', value: item.comment });

      const content = el('div');
      content.appendChild(M.DetailFields({ fields }));

      // Approval timeline
      const timelineItems = [];
      if (item.created_at) timelineItems.push({ title: 'Заявка создана', time: Utils.formatDate(item.created_at), color: 'var(--blue)' });
      if (item.approved_by_manager_at) timelineItems.push({ title: 'Руководитель одобрил', text: item.manager_name || '', time: Utils.formatDate(item.approved_by_manager_at), badge: '✓', badgeColor: 'success', color: 'var(--green)' });
      if (item.approved_by_director_at) timelineItems.push({ title: 'Директор утвердил', text: item.director_name || '', time: Utils.formatDate(item.approved_by_director_at), badge: '✓', badgeColor: 'success', color: 'var(--green)' });
      if (item.rejected_at) timelineItems.push({ title: 'Отклонено', text: item.reject_reason || '', time: Utils.formatDate(item.rejected_at), badge: '✕', badgeColor: 'danger', color: 'var(--red)' });

      if (timelineItems.length > 1) {
        const tLabel = el('div', { style: { ...DS.font('sm'), color: t.textSec, marginTop: '16px', marginBottom: '8px' } });
        tLabel.textContent = 'Ход согласования';
        content.appendChild(tLabel);
        content.appendChild(M.Timeline({ items: timelineItems }));
      }

      // Approval buttons — двойное согласование
      const user = Store.get('user');
      const role = user ? user.role || '' : '';
      const isManager = role === 'PM' || role === 'HEAD_PM';
      const isDirector = role === 'ADMIN' || role.startsWith('DIRECTOR');

      if (item.status === 'pending_approval') {
        const btns = el('div', { style: { display: 'flex', gap: '6px', marginTop: '16px' } });

        if (isManager || isDirector) {
          const approveLabel = isDirector ? '✓ Утвердить (директор)' : '✓ Согласовать';
          btns.appendChild(M.FullWidthBtn({
            label: approveLabel,
            onClick: async () => {
              try {
                await API.fetch('/training-applications/' + item.id + '/approve', { method: 'POST' });
                M.Toast({ message: 'Согласовано', type: 'success' });
              } catch (e) { M.Toast({ message: 'Ошибка', type: 'error' }); }
            },
          }));
        }

        btns.appendChild(M.FullWidthBtn({
          label: '✕ Отклонить',
          variant: 'danger',
          onClick: async () => {
            const ok = await M.Confirm({ title: 'Отклонить заявку на обучение?', danger: true });
            if (!ok) return;
            try {
              await API.fetch('/training-applications/' + item.id + '/reject', { method: 'POST' });
              M.Toast({ message: 'Отклонено', type: 'success' });
            } catch (e) { M.Toast({ message: 'Ошибка', type: 'error' }); }
          },
        }));
        content.appendChild(btns);
      }

      M.BottomSheet({ title: item.title || 'Обучение', content, fullscreen: true });
    }

    function openCreateForm() {
      const content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'title', label: 'Название курса / программы', required: true },
          { id: 'type', label: 'Тип', type: 'select', options: Object.entries(TYPE_MAP).map(([v, l]) => ({ value: v, label: l })), value: 'external' },
          { id: 'employee_name', label: 'Сотрудник', required: true },
          { id: 'provider', label: 'Провайдер / Организация' },
          { id: 'cost', label: 'Стоимость (₽)', type: 'number' },
          { id: 'date_from', label: 'Дата начала', type: 'date' },
          { id: 'date_to', label: 'Дата окончания', type: 'date' },
          { id: 'comment', label: 'Обоснование', type: 'textarea' },
        ],
        submitLabel: 'Подать на согласование',
        onSubmit: async (data) => {
          try {
            await API.fetch('/training-applications', { method: 'POST', body: { ...data, status: 'pending_approval' } });
            M.Toast({ message: 'Заявка отправлена', type: 'success' });
          } catch (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); }
        },
      }));
      M.BottomSheet({ title: 'Заявка на обучение', content, fullscreen: true });
    }

    return page;
  },
};

Router.register('/training', TrainingPage);
if (typeof window !== 'undefined') window.TrainingPage = TrainingPage;
