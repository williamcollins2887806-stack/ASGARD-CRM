/**
 * ASGARD CRM — Mobile v3 · Совещания
 * Окно 4, Страница 4
 * Компоненты: список совещаний, модалка создания, модалка протокола
 */
const MeetingsPage = {
  async render() {
    const el = Utils.el;
    const page = el('div', { className: 'asgard-meetings-page' });
    let items = [];
    let filter = 'all';

    page.appendChild(M.Header({
      title: 'Совещания',
      subtitle: 'КОММУНИКАЦИИ',
      back: true,
      backHref: '/home',
    }));

    page.appendChild(M.FilterPills({
      items: [
        { label: 'Все', value: 'all', active: true },
        { label: 'Предстоящие', value: 'upcoming' },
        { label: 'Прошедшие', value: 'past' },
      ],
      onChange: (v) => { filter = v; renderList(); },
    }));

    const listWrap = el('div', { style: { padding: '8px 0', minHeight: '200px' } });
    page.appendChild(listWrap);

    async function load() {
      listWrap.replaceChildren();
      listWrap.appendChild(M.Skeleton({ type: 'card', count: 4 }));
      try {
        const resp = await API.fetch('/meetings?limit=100');
        items = Array.isArray(resp) ? resp : (resp.data || []);
        renderList();
      } catch (_) {
        listWrap.replaceChildren();
        listWrap.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
      }
    }

    function renderList() {
      listWrap.replaceChildren();
      const now = Date.now();
      const filtered = items.filter(m => {
        if (filter === 'upcoming') return new Date(m.date || m.start_date) > now;
        if (filter === 'past') return new Date(m.date || m.start_date) <= now;
        return true;
      });

      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: 'Нет совещаний', icon: '📹' }));
        return;
      }

      const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 var(--sp-page)' } });
      filtered.forEach((meet, i) => {
        const isPast = new Date(meet.date || meet.start_date) <= now;
        wrap.appendChild(M.Card({
          title: meet.topic || meet.title || 'Совещание',
          subtitle: meet.organizer_name || '',
          badge: isPast ? 'Завершено' : 'Предстоит',
          badgeColor: isPast ? 'neutral' : 'info',
          time: meet.date ? Utils.formatDate(meet.date) : '',
          fields: [
            ...(meet.participants_count ? [{ label: 'Участники', value: String(meet.participants_count) }] : []),
            ...(meet.location ? [{ label: 'Место', value: meet.location }] : []),
          ],
          onClick: () => viewMeetingSheet(meet),
          animDelay: i * 0.03,
        }));
      });
      listWrap.appendChild(wrap);
    }

    page.appendChild(M.FAB({
      icon: '+',
      onClick: () => createMeetingSheet(),
    }));

    load();
    return page;
  },
};

function viewMeetingSheet(meet) {
  const el = Utils.el;
  const t = DS.t;
  const content = el('div');

  content.appendChild(M.DetailFields({
    fields: [
      { label: 'Тема', value: meet.topic || meet.title || '—' },
      { label: 'Дата', value: meet.date ? Utils.formatDate(meet.date) : '—' },
      { label: 'Время', value: meet.time || meet.start_time || '—' },
      { label: 'Организатор', value: meet.organizer_name || '—' },
      { label: 'Место', value: meet.location || '—' },
    ],
  }));

  // Participants
  if (meet.participants && meet.participants.length) {
    const pWrap = el('div', { style: { marginTop: '16px' } });
    pWrap.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, textContent: 'Участники' }));
    const chips = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
    meet.participants.forEach(p => chips.appendChild(M.Chip({ text: p.name || p, color: 'info' })));
    pWrap.appendChild(chips);
    content.appendChild(pWrap);
  }

  // Protocol
  if (meet.protocol || meet.minutes) {
    const pBlock = el('div', { style: { marginTop: '16px', padding: '12px', background: t.surfaceAlt, borderRadius: '12px', border: '1px solid ' + t.border } });
    pBlock.appendChild(el('div', { style: { ...DS.font('sm'), fontWeight: 600, color: t.text, marginBottom: '6px' }, textContent: '📋 Протокол' }));
    pBlock.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec, whiteSpace: 'pre-wrap' }, textContent: meet.protocol || meet.minutes }));
    content.appendChild(pBlock);
  }

  // Decisions
  if (meet.decisions && meet.decisions.length) {
    content.appendChild(el('div', { style: { marginTop: '16px' } }));
    const timeline = meet.decisions.map((d, i) => ({
      title: d.text || d.title || 'Решение ' + (i + 1),
      text: d.responsible || '',
      time: d.deadline || '',
      badge: d.status || '',
      badgeColor: d.status === 'done' ? 'success' : 'info',
    }));
    content.appendChild(M.Timeline({ items: timeline }));
  }

  M.BottomSheet({ title: '📹 Совещание', content, fullscreen: true });
}

function createMeetingSheet() {
  const content = Utils.el('div');
  content.appendChild(M.Form({
    fields: [
      { id: 'topic', label: 'Тема', type: 'text', required: true },
      { id: 'date', label: 'Дата', type: 'date', required: true },
      { id: 'time', label: 'Время', type: 'time' },
      { id: 'location', label: 'Место', type: 'text' },
      { id: 'description', label: 'Описание', type: 'textarea' },
    ],
    submitLabel: 'Создать совещание',
    onSubmit: async (data) => {
      try {
        await API.fetch('/meetings', { method: 'POST', body: data });
        M.Toast({ message: 'Совещание создано', type: 'success' });
        Router.navigate('/meetings');
      } catch (_) { M.Toast({ message: 'Ошибка', type: 'error' }); }
    },
  }));
  M.BottomSheet({ title: '📹 Новое совещание', content, fullscreen: true });
}

Router.register('/meetings', MeetingsPage);
if (typeof window !== 'undefined') window.MeetingsPage = MeetingsPage;
