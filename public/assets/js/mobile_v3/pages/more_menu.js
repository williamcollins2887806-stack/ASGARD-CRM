/**
 * ASGARD CRM — Mobile v3 / Меню «Ещё»
 */
var MoreMenuPage = {
  render: function () {
    var el = Utils.el;
    var t = DS.t;

    var page = el('div', { style: { background: t.bg, minHeight: '100vh', paddingBottom: '120px' } });

    page.appendChild(M.Header({ title: 'Ещё', subtitle: 'Разделы системы', back: false }));

    var menuItems = [
      { icon: '📋', label: 'Тендеры', path: '/tenders' },
      { icon: '📊', label: 'Воронка', path: '/funnel' },
      { icon: '👥', label: 'Контрагенты', path: '/customers' },
      { icon: '🏗', label: 'Работы', path: '/all-works' },
      { icon: '📦', label: 'Склад', path: '/warehouse' },
      { icon: '👔', label: 'Сотрудники', path: '/personnel' },
      { icon: '📋', label: 'Анкеты рабочих', path: '/worker-profiles' },
      { icon: '💰', label: 'Заявки на аванс', path: '/cash' },
      { icon: '📄', label: 'Документы', path: '/contracts' },
      { icon: '🔔', label: 'Уведомления', path: '/alerts' },
      { icon: '📊', label: 'Расчёты', path: '/all-estimates' },
      { icon: '📧', label: 'Почта', path: '/my-mail' },
      { icon: '📊', label: 'Диаграмма Ганта', path: '/gantt' },
      { icon: '📝', label: 'Совещания', path: '/meetings' },
      { icon: '🔧', label: 'Профиль', path: '/profile' },
      { icon: '🌓', label: (DS.getTheme && DS.getTheme() === 'dark') ? 'Тема: Тёмная' : 'Тема: Светлая', action: function () {
        DS.toggleTheme();
        Router.navigate('/more', { replace: true });
      } },
    ];

    // RBAC: фильтрация пунктов меню по роли
    var _userRole = (Store.get('user') || {}).role || '';
    if (window.RoleAccess) {
      menuItems = RoleAccess.filterMenu(menuItems, _userRole);
    }

    var list = el('div', { style: { padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '2px' } });

    menuItems.forEach(function (item, idx) {
      var row = el('div', { style: {
        display: 'flex', alignItems: 'center', gap: '14px',
        padding: '14px 16px', borderRadius: '14px', cursor: 'pointer',
        background: 'transparent',
        transition: 'background 0.15s ease',
      } });

      row.appendChild(el('div', { style: {
        width: '36px', height: '36px', borderRadius: '10px',
        background: t.surfaceAlt, border: '1px solid ' + t.border,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '18px', flexShrink: '0',
      } }, item.icon));

      row.appendChild(el('div', { style: Object.assign({}, DS.font('base'), {
        color: t.text, flex: '1', fontWeight: '500',
      }) }, item.label));

      /* chevron */
      var chevron = el('div');
      chevron.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + t.textTer + '" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
      chevron.style.flexShrink = '0';
      row.appendChild(chevron);

      row.addEventListener('click', function () { if (item.action) { item.action(); } else { Router.navigate(item.path); } });
      row.addEventListener('touchstart', function () { row.style.background = t.surfaceAlt; }, { passive: true });
      row.addEventListener('touchend', function () { row.style.background = 'transparent'; }, { passive: true });
      list.appendChild(row);
    });

    page.appendChild(list);

    /* logout at bottom */
    var logoutSection = el('div', { style: { padding: '24px 12px 0' } });
    var logoutBtn = el('div', { style: {
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
      padding: '14px', borderRadius: '14px', cursor: 'pointer',
      border: '1px solid ' + t.border,
    } });
    logoutBtn.appendChild(el('span', { style: { fontSize: '16px' } }, '🚪'));
    logoutBtn.appendChild(el('span', { style: Object.assign({}, DS.font('sm'), { color: t.red, fontWeight: '500' }) }, 'Выйти'));
    logoutBtn.addEventListener('click', function () {
      M.Confirm({ title: 'Выход', message: 'Вы уверены, что хотите выйти?', okText: 'Выйти', cancelText: 'Отмена', danger: true }).then(function (ok) {
        if (ok) {
          localStorage.removeItem('auth_token');
          Store.set('user', null);
          Router.navigate('/welcome', { replace: true });
        }
      });
    });
    logoutSection.appendChild(logoutBtn);
    page.appendChild(logoutSection);

    return page;
  }
};

if (typeof Router !== 'undefined') {
  Router.register('/more', MoreMenuPage);
}
if (typeof window !== 'undefined') window.MoreMenuPage = MoreMenuPage;
