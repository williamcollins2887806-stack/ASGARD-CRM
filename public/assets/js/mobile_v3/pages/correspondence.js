/**
 * ASGARD CRM — Mobile v3 · Корреспонденция
 * Окно 4, Страница 3
 * Компоненты: список документов, pill-направление, модалки создания/просмотра
 */
const CorrespondencePage = {
  async render() {
    const el = Utils.el;
    const page = el('div', { className: 'asgard-correspondence-page' });
    let direction = 'all';
    let items = [];

    page.appendChild(M.Header({
      title: 'Корреспонденция',
      subtitle: 'ДОКУМЕНТЫ',
      back: true,
      backHref: '/home',
    }));

    page.appendChild(M.SearchBar({
      placeholder: 'Поиск документов...',
      sticky: true,
      onSearch: (q) => renderList(q),
    }));

    page.appendChild(M.FilterPills({
      items: [
        { label: 'Все', value: 'all', active: true },
        { label: 'Входящие', value: 'incoming' },
        { label: 'Исходящие', value: 'outgoing' },
      ],
      onChange: (v) => { direction = v; renderList(''); },
    }));

    const listWrap = el('div', { style: { padding: '8px 0', minHeight: '200px' } });
    page.appendChild(listWrap);

    async function load() {
      listWrap.replaceChildren();
      listWrap.appendChild(M.Skeleton({ type: 'card', count: 4 }));
      try {
        const resp = await API.fetch('/correspondence?limit=100');
        items = Array.isArray(resp) ? resp : (resp.data || []);
        renderList('');
      } catch (_) {
        listWrap.replaceChildren();
        listWrap.appendChild(M.Empty({ text: 'Ошибка загрузки', type: 'error' }));
      }
    }

    function renderList(query) {
      listWrap.replaceChildren();
      const q = (query || '').toLowerCase();
      const filtered = items.filter(d => {
        if (direction !== 'all' && d.direction !== direction) return false;
        if (q && !(d.title || '').toLowerCase().includes(q) && !(d.number || '').toLowerCase().includes(q)) return false;
        return true;
      });

      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: q ? 'Ничего не найдено' : 'Нет документов', type: q ? 'search' : 'default' }));
        return;
      }

      const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 var(--sp-page)' } });
      filtered.forEach((doc, i) => {
        wrap.appendChild(M.Card({
          title: doc.title || doc.number || 'Документ',
          subtitle: doc.sender || doc.recipient || '',
          badge: doc.direction === 'incoming' ? 'Входящий' : 'Исходящий',
          badgeColor: doc.direction === 'incoming' ? 'info' : 'gold',
          time: doc.date ? Utils.formatDate(doc.date) : '',
          fields: [
            ...(doc.number ? [{ label: '№', value: doc.number }] : []),
            ...(doc.type ? [{ label: 'Тип', value: doc.type }] : []),
          ],
          onClick: () => viewDocSheet(doc),
          animDelay: i * 0.03,
        }));
      });
      listWrap.appendChild(wrap);
    }

    page.appendChild(M.FAB({
      icon: '+',
      onClick: () => createDocSheet(),
    }));

    load();
    return page;
  },
};

function viewDocSheet(doc) {
  const el = Utils.el;
  const t = DS.t;
  const content = el('div');

  content.appendChild(M.DetailFields({
    fields: [
      { label: '№', value: doc.number || '—' },
      { label: 'Дата', value: doc.date ? Utils.formatDate(doc.date) : '—' },
      { label: 'Направление', value: doc.direction === 'incoming' ? 'Входящий' : 'Исходящий' },
      { label: 'Тип', value: doc.type || '—' },
      { label: 'Отправитель', value: doc.sender || '—' },
      { label: 'Получатель', value: doc.recipient || '—' },
      { label: 'Примечание', value: doc.note || doc.comment || '—' },
    ],
  }));

  if (doc.file_url || doc.file_id) {
    const actions = el('div', { style: { marginTop: '16px' } });
    actions.appendChild(M.FullWidthBtn({
      label: '📥 Скачать документ',
      variant: 'secondary',
      onClick: () => window.open(doc.file_url || '/api/correspondence/' + doc.id + '/file', '_blank'),
    }));
    content.appendChild(actions);
  }

  M.BottomSheet({ title: '📄 ' + (doc.title || 'Документ'), content, fullscreen: true });
}

function createDocSheet() {
  const content = Utils.el('div');
  content.appendChild(M.Form({
    fields: [
      { id: 'title', label: 'Название', type: 'text', required: true },
      { id: 'number', label: 'Номер', type: 'text' },
      { id: 'direction', label: 'Направление', type: 'select', options: [{ value: 'incoming', label: 'Входящий' }, { value: 'outgoing', label: 'Исходящий' }], required: true },
      { id: 'type', label: 'Тип', type: 'text', placeholder: 'Письмо, приказ, уведомление...' },
      { id: 'note', label: 'Примечание', type: 'textarea' },
    ],
    submitLabel: 'Создать',
    onSubmit: async (data) => {
      try {
        await API.fetch('/correspondence', { method: 'POST', body: data });
        M.Toast({ message: 'Документ создан', type: 'success' });
        Router.navigate('/correspondence');
      } catch (_) { M.Toast({ message: 'Ошибка', type: 'error' }); }
    },
  }));
  M.BottomSheet({ title: '📝 Новый документ', content, fullscreen: true });
}

Router.register('/correspondence', CorrespondencePage);
if (typeof window !== 'undefined') window.CorrespondencePage = CorrespondencePage;
