/**
 * ASGARD CRM — Mobile v3 · Командировки
 * Окно 4, Страница 7
 * Компоненты: список командировок, модалка создания, загрузка билетов/чеков
 */
const TravelPage = {
  async render() {
    const el = Utils.el;
    const t = DS.t;
    const page = el('div', { className: 'asgard-travel-page' });
    let items = [];
    let filter = 'all';

    page.appendChild(M.Header({
      title: 'Командировки',
      subtitle: 'ПЕРСОНАЛ',
      back: true,
      backHref: '/home',
    }));

    page.appendChild(M.FilterPills({
      items: [
        { label: 'Все', value: 'all', active: true },
        { label: 'Текущие', value: 'active' },
        { label: 'Предстоящие', value: 'upcoming' },
        { label: 'Завершённые', value: 'completed' },
      ],
      onChange: (v) => { filter = v; renderList(); },
    }));

    const listWrap = el('div', { style: { padding: '8px 0', minHeight: '200px' } });
    page.appendChild(listWrap);

    async function load() {
      listWrap.innerHTML = '';
      listWrap.appendChild(M.Skeleton({ type: 'card', count: 4 }));
      try {
        const resp = await API.fetch('/travel?limit=100');
        items = Array.isArray(resp) ? resp : (resp.data || []);
        renderList();
      } catch (_) {
        listWrap.innerHTML = '';
        listWrap.appendChild(M.Empty({ text: 'Ошибка загрузки', type: 'error' }));
      }
    }

    function renderList() {
      listWrap.innerHTML = '';
      const now = Date.now();
      const filtered = items.filter(trip => {
        if (filter === 'active') return new Date(trip.start_date) <= now && new Date(trip.end_date) >= now;
        if (filter === 'upcoming') return new Date(trip.start_date) > now;
        if (filter === 'completed') return new Date(trip.end_date) < now;
        return true;
      });

      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: 'Нет командировок', icon: '✈️' }));
        return;
      }

      const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 var(--sp-page)' } });
      filtered.forEach((trip, i) => {
        const statusMap = { active: 'info', upcoming: 'gold', completed: 'success', cancelled: 'danger' };
        const statusLabel = { active: 'В командировке', upcoming: 'Предстоит', completed: 'Завершена', cancelled: 'Отменена' };
        let status = trip.status || 'upcoming';
        const start = new Date(trip.start_date);
        const end = new Date(trip.end_date);
        if (!trip.status) {
          if (start <= now && end >= now) status = 'active';
          else if (start > now) status = 'upcoming';
          else status = 'completed';
        }

        wrap.appendChild(M.Card({
          title: trip.destination || trip.city || 'Командировка',
          subtitle: trip.purpose || trip.object_name || '',
          badge: statusLabel[status] || status,
          badgeColor: statusMap[status] || 'neutral',
          fields: [
            { label: 'Период', value: Utils.formatDate(trip.start_date) + ' — ' + Utils.formatDate(trip.end_date) },
            ...(trip.employee_name ? [{ label: 'Сотрудник', value: trip.employee_name }] : []),
            ...(trip.budget ? [{ label: 'Бюджет', value: Utils.formatMoney(trip.budget) }] : []),
          ],
          onClick: () => viewTripSheet(trip),
          animDelay: i * 0.03,
        }));
      });
      listWrap.appendChild(wrap);
    }

    page.appendChild(M.FAB({
      icon: '+',
      onClick: () => createTripSheet(),
    }));

    load();
    return page;
  },
};

function viewTripSheet(trip) {
  const el = Utils.el;
  const t = DS.t;
  const content = el('div');

  content.appendChild(M.DetailFields({
    fields: [
      { label: 'Направление', value: trip.destination || trip.city || '—' },
      { label: 'Цель', value: trip.purpose || '—' },
      { label: 'Начало', value: trip.start_date ? Utils.formatDate(trip.start_date) : '—' },
      { label: 'Окончание', value: trip.end_date ? Utils.formatDate(trip.end_date) : '—' },
      { label: 'Сотрудник', value: trip.employee_name || '—' },
      { label: 'Объект', value: trip.object_name || '—' },
      { label: 'Бюджет', value: trip.budget ? Utils.formatMoney(trip.budget) : '—' },
      { label: 'Жильё', value: trip.accommodation || '—' },
      { label: 'Транспорт', value: trip.transport || '—' },
    ],
  }));

  // Documents (tickets, receipts)
  if (trip.documents && trip.documents.length) {
    const docsWrap = el('div', { style: { marginTop: '16px' } });
    docsWrap.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, textContent: '📎 Документы' }));
    const chips = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
    trip.documents.forEach(d => {
      chips.appendChild(M.Chip({
        text: d.name || d.filename || 'Документ',
        color: 'info',
        onClick: () => window.open(d.url || '/api/travel/' + trip.id + '/files/' + d.id, '_blank'),
      }));
    });
    docsWrap.appendChild(chips);
    content.appendChild(docsWrap);
  }

  // Upload button
  const uploadBtn = el('div', { style: { marginTop: '16px' } });
  uploadBtn.appendChild(M.FullWidthBtn({
    label: '📎 Загрузить билет / чек',
    variant: 'secondary',
    onClick: () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.jpg,.jpeg,.png';
      input.multiple = true;
      input.onchange = async () => {
        for (const file of input.files) {
          const fd = new FormData();
          fd.append('file', file);
          try {
            await fetch('/api/travel/' + trip.id + '/upload', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + API.getToken() },
              body: fd,
            });
          } catch (_) {}
        }
        M.Toast({ message: 'Файлы загружены', type: 'success' });
      };
      input.click();
    },
  }));
  content.appendChild(uploadBtn);

  M.BottomSheet({ title: '✈️ Командировка', content, fullscreen: true });
}

function createTripSheet() {
  const content = document.createElement('div');
  content.appendChild(M.Form({
    fields: [
      { id: 'destination', label: 'Направление', type: 'text', required: true },
      { id: 'purpose', label: 'Цель', type: 'text', required: true },
      { id: 'start_date', label: 'Дата начала', type: 'date', required: true },
      { id: 'end_date', label: 'Дата окончания', type: 'date', required: true },
      { id: 'accommodation', label: 'Жильё', type: 'text' },
      { id: 'transport', label: 'Транспорт', type: 'text' },
      { id: 'budget', label: 'Бюджет, ₽', type: 'number' },
    ],
    submitLabel: 'Создать',
    onSubmit: async (data) => {
      try {
        await API.fetch('/travel', { method: 'POST', body: data });
        M.Toast({ message: 'Командировка создана', type: 'success' });
        Router.navigate('/travel');
      } catch (_) { M.Toast({ message: 'Ошибка', type: 'error' }); }
    },
  }));
  M.BottomSheet({ title: '✈️ Новая командировка', content, fullscreen: true });
}

Router.register('/travel', TravelPage);
if (typeof window !== 'undefined') window.TravelPage = TravelPage;
