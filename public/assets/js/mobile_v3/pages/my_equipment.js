/**
 * ASGARD CRM — Mobile v3 · Моё оборудование
 * Окно 4, Страница 6
 * Компоненты: список выданного мне оборудования, карточки
 */
const MyEquipmentPage = {
  async render() {
    const el = Utils.el;
    const t = DS.t;
    const page = el('div', { className: 'asgard-my-equipment-page' });

    page.appendChild(M.Header({
      title: 'Моё оборудование',
      subtitle: 'РЕСУРСЫ',
      back: true,
      backHref: '/home',
    }));

    const statsWrap = el('div', { style: { marginTop: '8px' } });
    page.appendChild(statsWrap);

    const listWrap = el('div', { style: { padding: '8px 0', minHeight: '200px' } });
    page.appendChild(listWrap);

    async function load() {
      listWrap.replaceChildren();
      listWrap.appendChild(M.Skeleton({ type: 'card', count: 4 }));
      try {
        const user = Store.get('user') || {};
        const resp = await API.fetch('/equipment?responsible_id=' + (user.id || '') + '&limit=200');
        const items = API.extractRows(resp);

        // Stats
        statsWrap.replaceChildren();
        const totalValue = items.reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
        statsWrap.appendChild(M.Stats({
          items: [
            { icon: '🛠', label: 'Единиц', value: items.length, color: t.blue },
            { icon: '💰', label: 'Стоимость', value: Math.round(totalValue), color: t.gold },
          ],
        }));

        renderList(items);
      } catch (_) {
        listWrap.replaceChildren();
        M.Toast({ message: 'Ошибка загрузки', type: 'error' });
        listWrap.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
      }
    }

    function renderList(items) {
      listWrap.replaceChildren();
      if (!items.length) {
        listWrap.appendChild(M.Empty({ text: 'Нет выданного оборудования', icon: '🛠' }));
        return;
      }

      const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 var(--sp-page)' } });
      items.forEach((item, i) => {
        const statusMap = { active: 'success', repair: 'warning', decommissioned: 'danger' };
        const statusLabel = { active: 'В работе', repair: 'Ремонт', decommissioned: 'Списано' };

        wrap.appendChild(M.Card({
          title: item.name || 'Оборудование',
          subtitle: item.inventory_number ? 'Инв. №' + item.inventory_number : '',
          badge: statusLabel[item.status] || item.status || '',
          badgeColor: statusMap[item.status] || 'neutral',
          fields: [
            ...(item.category_name ? [{ label: 'Категория', value: item.category_name }] : []),
            ...(item.serial_number ? [{ label: 'S/N', value: item.serial_number }] : []),
            ...(item.price ? [{ label: 'Стоимость', value: Utils.formatMoney(item.price) }] : []),
          ],
          onClick: () => viewEquipSheet(item),
          animDelay: i * 0.03,
        }));
      });
      listWrap.appendChild(wrap);
    }

    load();
    return page;
  },
};

function viewEquipSheet(item) {
  const content = Utils.el('div');
  content.appendChild(M.DetailFields({
    fields: [
      { label: 'Название', value: item.name || '—' },
      { label: 'Инв. №', value: item.inventory_number || '—' },
      { label: 'Серийный №', value: item.serial_number || '—' },
      { label: 'Категория', value: item.category_name || '—' },
      { label: 'Статус', value: item.status || '—' },
      { label: 'Склад', value: item.warehouse_name || '—' },
      { label: 'Стоимость', value: item.price ? Utils.formatMoney(item.price) : '—' },
      { label: 'Дата выдачи', value: item.assigned_date ? Utils.formatDate(item.assigned_date) : '—' },
      { label: 'Примечание', value: item.note || '—' },
    ],
  }));
  M.BottomSheet({ title: '🛠 ' + (item.name || 'Оборудование'), content, fullscreen: true });
}

Router.register('/my-equipment', MyEquipmentPage);
if (typeof window !== 'undefined') window.MyEquipmentPage = MyEquipmentPage;
