/**
 * ASGARD CRM — Mobile v3 / Обучение
 * Окно 3, Сессия 9 — FIX: async skeleton
 * Двойное согласование: руководитель → директор
 */
var TrainingPage = {
  render: function () {
    var t = DS.t;
    var el = Utils.el;
    var STATUS_MAP = {
      draft: { label: 'Черновик', color: 'neutral' }, pending_approval: { label: 'На согласовании', color: 'info' },
      approved: { label: 'Согласовано', color: 'success' }, budget_approved: { label: 'Бюджет утверждён', color: 'gold' },
      paid: { label: 'Оплачено', color: 'warning' }, completed: { label: 'Завершено', color: 'success' },
      rejected: { label: 'Отклонено', color: 'danger' },
    };
    var TYPE_MAP = {
      external: 'Внешнее', internal: 'Внутреннее', conference: 'Конференция',
      certification: 'Сертификация', online: 'Онлайн-курс',
    };

    var page = M.TablePage({
      title: 'Обучение', subtitle: 'РАЗВИТИЕ', back: true, backHref: '/home',
      items: [], search: true,
      filter: {
        pills: [
          { label: 'Все', value: 'all', active: true }, { label: 'На согласовании', value: 'pending_approval' },
          { label: 'Согласовано', value: 'approved' }, { label: 'Оплачено', value: 'paid' }, { label: 'Отклонено', value: 'rejected' },
        ],
        filterFn: function (item, val) { return val === 'all' || item.status === val; },
      },
      renderItem: function (item) {
        var st = STATUS_MAP[item.status] || STATUS_MAP.draft;
        var typeName = TYPE_MAP[item.type] || item.type || '—';
        var fields = [];
        if (item.employee_name || item.employee_fio) fields.push({ label: 'Сотрудник', value: item.employee_name || item.employee_fio });
        fields.push({ label: 'Тип', value: typeName });
        if (item.cost && Number(item.cost) > 0) fields.push({ label: 'Стоимость', value: Utils.formatMoney(item.cost) });
        if (item.date_from) fields.push({ label: 'Начало', value: Utils.formatDate(item.date_from) });
        return M.Card({
          title: item.title || item.course_name || 'Обучение #' + item.id,
          badge: st.label, badgeColor: st.color, fields: fields,
          time: item.created_at ? Utils.relativeTime(item.created_at) : undefined,
          onClick: function () { openDetail(item); },
        });
      },
      empty: M.Empty({ text: 'Нет заявок на обучение', icon: '📚' }),
      fab: { icon: '+', onClick: function () { openCreateForm(); } },
      onRefresh: function () {
        return API.fetch('/training-applications', { noCache: true }).catch(function () { return { items: [] }; }).then(function (resp) {
          return API.extractRows(resp);
        }).catch(function (e) { M.Toast({ message: 'Ошибка загрузки', type: 'error' }); return []; });
      },
    });
    var listEl = page.querySelector('.asgard-table-page__list');
    if (listEl) listEl.replaceChildren(M.Skeleton({ type: 'card', count: 5 }));
    setTimeout(function () { window.dispatchEvent(new Event('asgard:refresh')); }, 0);

    function openDetail(item) {
      var st = STATUS_MAP[item.status] || STATUS_MAP.draft;
      var fields = [
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
      var content = el('div');
      content.appendChild(M.DetailFields({ fields: fields }));

      // Approval timeline
      var timelineItems = [];
      if (item.created_at) timelineItems.push({ title: 'Заявка создана', time: Utils.formatDate(item.created_at), color: 'var(--blue)' });
      if (item.approved_by_manager_at) timelineItems.push({ title: 'Руководитель одобрил', text: item.manager_name || '', time: Utils.formatDate(item.approved_by_manager_at), badge: '✓', badgeColor: 'success', color: 'var(--green)' });
      if (item.approved_by_director_at) timelineItems.push({ title: 'Директор утвердил', text: item.director_name || '', time: Utils.formatDate(item.approved_by_director_at), badge: '✓', badgeColor: 'success', color: 'var(--green)' });
      if (item.rejected_at) timelineItems.push({ title: 'Отклонено', text: item.reject_reason || '', time: Utils.formatDate(item.rejected_at), badge: '✕', badgeColor: 'danger', color: 'var(--red)' });
      if (timelineItems.length > 1) {
        content.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textSec, marginTop: '16px', marginBottom: '8px' }) }, 'Ход согласования'));
        content.appendChild(M.Timeline({ items: timelineItems }));
      }

      // Approval buttons
      var user = Store.get('user');
      var role = user ? user.role || '' : '';
      var isManager = role === 'PM' || role === 'HEAD_PM';
      var isDirector = role === 'ADMIN' || role.startsWith('DIRECTOR');
      if (item.status === 'pending_approval') {
        var btns = el('div', { style: { display: 'flex', gap: '6px', marginTop: '16px' } });
        if (isManager || isDirector) {
          btns.appendChild(M.FullWidthBtn({
            label: isDirector ? '✓ Утвердить (директор)' : '✓ Согласовать',
            onClick: function () {
              API.fetch('/training-applications/' + item.id + '/approve', { method: 'POST' })
                .then(function () { M.Toast({ message: 'Согласовано', type: 'success' }); })
                .catch(function () { M.Toast({ message: 'Ошибка', type: 'error' }); });
            },
          }));
        }
        btns.appendChild(M.FullWidthBtn({ label: '✕ Отклонить', variant: 'danger', onClick: function () {
          M.Confirm({ title: 'Отклонить заявку на обучение?', danger: true }).then(function (ok) {
            if (!ok) return;
            API.fetch('/training-applications/' + item.id + '/reject', { method: 'POST' })
              .then(function () { M.Toast({ message: 'Отклонено', type: 'success' }); })
              .catch(function () { M.Toast({ message: 'Ошибка', type: 'error' }); });
          });
        } }));
        content.appendChild(btns);
      }
      M.BottomSheet({ title: item.title || 'Обучение', content: content, fullscreen: true });
    }

    function openCreateForm() {
      var content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'title', label: 'Название курса / программы', required: true },
          { id: 'type', label: 'Тип', type: 'select', options: Object.entries(TYPE_MAP).map(function (e) { return { value: e[0], label: e[1] }; }), value: 'external' },
          { id: 'employee_name', label: 'Сотрудник', required: true },
          { id: 'provider', label: 'Провайдер / Организация' },
          { id: 'cost', label: 'Стоимость (₽)', type: 'number' },
          { id: 'date_from', label: 'Дата начала', type: 'date' },
          { id: 'date_to', label: 'Дата окончания', type: 'date' },
          { id: 'comment', label: 'Обоснование', type: 'textarea' },
        ],
        submitLabel: 'Подать на согласование',
        onSubmit: function (data) {
          API.fetch('/training-applications', { method: 'POST', body: Object.assign({}, data, { status: 'pending_approval' }) })
            .then(function () { M.Toast({ message: 'Заявка отправлена', type: 'success' }); })
            .catch(function (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); });
        },
      }));
      M.BottomSheet({ title: 'Заявка на обучение', content: content, fullscreen: true });
    }
    return page;
  },
};
Router.register('/training', TrainingPage);
if (typeof window !== 'undefined') window.TrainingPage = TrainingPage;
