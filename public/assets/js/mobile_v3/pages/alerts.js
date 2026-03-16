/**
 * ASGARD CRM — Mobile v3 · Уведомления
 * Окно 4, Страница 13
 * Данные из: API /notifications + Store
 * Компоненты: список уведомлений, свайп (прочитано/удалить), кнопка Прочитать все
 */
const AlertsPage = {
  async render() {
    const el = Utils.el;
    const t = DS.t;
    const page = el('div', { className: 'asgard-alerts-page' });
    let items = [];

    page.appendChild(M.Header({
      title: 'Уведомления',
      subtitle: 'СИСТЕМА',
      back: true,
      backHref: '/home',
      actions: [{
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
        onClick: () => markAllRead(),
      }],
    }));

    page.appendChild(M.FilterPills({
      items: [
        { label: 'Все', value: 'all', active: true },
        { label: 'Непрочитанные', value: 'unread' },
        { label: 'Задачи', value: 'task' },
        { label: 'Финансы', value: 'money' },
        { label: 'Чат', value: 'chat' },
      ],
      onChange: (v) => { activeFilter = v; renderList(); },
    }));
    let activeFilter = 'all';

    const listWrap = el('div', { style: { padding: '8px 0', minHeight: '200px' } });
    page.appendChild(listWrap);

    async function load() {
      listWrap.replaceChildren();
      listWrap.appendChild(M.Skeleton({ type: 'list', count: 6 }));
      try {
        const resp = await API.fetch('/notifications?limit=200');
        items = API.extractRows(resp);
        renderList();
      } catch (_) {
        // Fallback to Store
        items = Store.get('notifications') || [];
        renderList();
      }
    }

    function renderList() {
      listWrap.replaceChildren();
      const filtered = items.filter(n => {
        if (activeFilter === 'unread') return !n.read && !n.is_read;
        if (activeFilter !== 'all') return (n.type || n.category) === activeFilter;
        return true;
      });

      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: activeFilter === 'unread' ? 'Нет непрочитанных' : 'Нет уведомлений', icon: '🔔' }));
        return;
      }

      // Unread count header
      const unreadCount = items.filter(n => !n.read && !n.is_read).length;
      if (unreadCount > 0) {
        const badge = el('div', {
          style: { padding: '0 var(--sp-page)', marginBottom: '8px' },
        });
        badge.appendChild(M.Badge({ text: unreadCount + ' ' + Utils.plural(unreadCount, 'непрочитанное', 'непрочитанных', 'непрочитанных'), color: 'danger' }));
        listWrap.appendChild(badge);
      }

      const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
      filtered.forEach((notif, i) => {
        const isRead = notif.read || notif.is_read;
        const card = M.SwipeCard({
          title: notif.title || notif.message || 'Уведомление',
          subtitle: notif.text || notif.body || '',
          rightActions: [
            ...(!isRead ? [{ label: '✓', color: DS.t.blue, onClick: () => markRead(notif) }] : []),
            { label: '🗑', color: DS.t.red, onClick: () => deleteNotif(notif) },
          ],
        });

        // Enrich inner
        const inner = card.querySelector('.asgard-swipe-inner');
        if (inner) {
          inner.style.borderLeft = isRead ? '' : ('3px solid ' + t.blue);
          inner.style.opacity = isRead ? '0.7' : '1';

          // Add type icon + time
          const typeIcons = { info: 'ℹ️', success: '✅', warning: '⚠️', danger: '🚨', task: '📋', chat: '💬', money: '💰', system: '⚙️' };
          const meta = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' } });
          meta.appendChild(el('span', {
            style: { ...DS.font('xs'), color: t.textTer },
            textContent: (typeIcons[notif.type || notif.category] || '🔔') + ' ' + (notif.type || notif.category || 'система'),
          }));
          meta.appendChild(el('span', {
            style: { ...DS.font('xs'), color: t.textTer },
            textContent: notif.created_at ? Utils.relativeTime(notif.created_at) : (notif.time || ''),
          }));
          inner.appendChild(meta);
        }

        list.appendChild(el('div', { style: DS.anim(i * 0.02) }, card));
      });
      listWrap.appendChild(list);
    }

    async function markRead(notif) {
      try {
        await API.fetch('/notifications/' + notif.id + '/read', { method: 'POST' });
        notif.read = true;
        notif.is_read = true;
        renderList();
      } catch (_) {
        notif.read = true;
        notif.is_read = true;
        renderList();
      }
    }

    async function deleteNotif(notif) {
      const ok = await M.Confirm({ title: 'Удалить уведомление?', danger: true, okText: 'Удалить' });
      if (!ok) return;
      try {
        await API.fetch('/notifications/' + notif.id, { method: 'DELETE' });
      } catch (_) {}
      items = items.filter(n => n.id !== notif.id);
      renderList();
    }

    async function markAllRead() {
      try {
        await API.fetch('/notifications/read-all', { method: 'POST' });
      } catch (_) {}
      items.forEach(n => { n.read = true; n.is_read = true; });
      renderList();
      M.Toast({ message: 'Все прочитаны', type: 'success' });
    }

    load();
    return page;
  },
};

Router.register('/alerts', AlertsPage);
if (typeof window !== 'undefined') window.AlertsPage = AlertsPage;
