window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.quick_actions = {
  name: 'Быстрые действия', icon: '⚡', size: 'normal', roles: ['*'],
  render: function (container, user) {
    container.replaceChildren(M.QuickActions({ items: [
      { icon: '📋', label: 'Тендер', onClick: function () { Router.navigate('/tenders'); } },
      { icon: '💰', label: 'Касса', onClick: function () { Router.navigate('/cash'); } },
      { icon: '💬', label: 'Чат', onClick: function () { Router.navigate('/messenger'); } },
      { icon: '📝', label: 'Задача', onClick: function () { Router.navigate('/tasks'); } },
      { icon: '📄', label: 'Письма', onClick: function () { Router.navigate('/correspondence'); } },
      { icon: '📊', label: 'KPI', onClick: function () { Router.navigate('/analytics'); } }
    ] }));
  }
};
