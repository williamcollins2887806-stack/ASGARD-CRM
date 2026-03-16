/**
 * ASGARD CRM — Mobile v3 · Хугинн (Мессенджер)
 * Окно 4, Страница 1
 * Компоненты: список чатов, экран чата, загрузка файлов
 */
const MessengerPage = {
  async render(params) {
    const el = Utils.el;
    const t = DS.t;

    // If chatId passed — open chat screen
    if (params && params.id) return renderChat(params.id);

    const page = el('div', { className: 'asgard-messenger-page' });

    page.appendChild(M.Header({
      title: 'Хугинн',
      subtitle: 'МЕССЕНДЖЕР',
      back: false,
      actions: [{
        icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        onClick: () => createChatSheet(),
      }],
    }));

    page.appendChild(M.SearchBar({
      placeholder: 'Поиск чатов...',
      sticky: true,
      onSearch: (q) => renderList(q),
    }));

    const listWrap = el('div', { style: { padding: '8px 0', minHeight: '200px' } });
    page.appendChild(listWrap);

    let chats = [];

    async function loadChats() {
      listWrap.replaceChildren();
      listWrap.appendChild(M.Skeleton({ type: 'list', count: 6 }));
      try {
        chats = await API.fetch('/chat-groups');
        if (!Array.isArray(chats)) chats = API.extractRows(chats);
        renderList('');
      } catch (e) {
        listWrap.replaceChildren();
        listWrap.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
      }
    }

    function renderList(query) {
      listWrap.replaceChildren();
      const q = (query || '').toLowerCase();
      const filtered = chats.filter(c => {
        const name = (c.name || c.title || '').toLowerCase();
        return !q || name.includes(q);
      });

      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: q ? 'Ничего не найдено' : 'Нет чатов', type: q ? 'search' : 'default' }));
        return;
      }

      const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } });
      filtered.forEach((chat, i) => {
        const unread = chat.unread_count || 0;
        const lastMsg = chat.last_message || {};
        const row = el('div', {
          style: {
            display: 'flex', gap: '12px', alignItems: 'center',
            padding: '12px var(--sp-page)', cursor: 'pointer',
            transition: 'background 0.15s ease',
            ...DS.anim(i * 0.03),
          },
          onClick: () => Router.navigate('/messenger/' + chat.id),
        });
        row.addEventListener('touchstart', () => row.style.background = t.surfaceAlt, { passive: true });
        row.addEventListener('touchend', () => row.style.background = '', { passive: true });

        row.appendChild(M.Avatar({ name: chat.name || chat.title || '?', size: 48, status: chat.online ? 'online' : null }));

        const info = el('div', { style: { flex: 1, minWidth: 0 } });
        const topRow = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' } });
        topRow.appendChild(el('div', {
          style: { ...DS.font('md'), color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          textContent: chat.name || chat.title || 'Чат',
        }));
        topRow.appendChild(el('span', {
          style: { ...DS.font('xs'), color: t.textTer, flexShrink: 0 },
          textContent: lastMsg.created_at ? Utils.relativeTime(lastMsg.created_at) : '',
        }));
        info.appendChild(topRow);

        const bottomRow = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });
        bottomRow.appendChild(el('div', {
          style: { ...DS.font('sm'), color: t.textSec, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
          textContent: lastMsg.text || lastMsg.content || '',
        }));
        if (unread > 0) {
          bottomRow.appendChild(el('span', {
            style: {
              minWidth: '20px', height: '20px', borderRadius: '10px',
              background: t.red, color: '#fff', fontSize: '11px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', flexShrink: 0,
            },
            textContent: unread > 99 ? '99+' : String(unread),
          }));
        }
        info.appendChild(bottomRow);
        row.appendChild(info);
        list.appendChild(row);
      });
      listWrap.appendChild(list);
    }

    loadChats();
    return page;
  },
};

async function renderChat(chatId) {
  const el = Utils.el;
  const t = DS.t;
  const page = el('div', { style: { display: 'flex', flexDirection: 'column', height: '100vh', background: t.bg } });

  // Load chat info
  let chatInfo = {};
  try { chatInfo = await API.fetch('/chat-groups/' + chatId); } catch (_) {}

  page.appendChild(M.Header({
    title: chatInfo.name || chatInfo.title || 'Чат',
    subtitle: (chatInfo.members_count || '') + (chatInfo.members_count ? Utils.plural(chatInfo.members_count, ' участник', ' участника', ' участников') : ''),
    back: true,
    backHref: '/messenger',
    actions: [{
      icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
      onClick: () => chatActionsSheet(chatId),
    }],
  }));

  const messagesWrap = el('div', {
    style: {
      flex: 1, overflowY: 'auto', padding: '12px var(--sp-page)',
      display: 'flex', flexDirection: 'column', gap: '4px',
      WebkitOverflowScrolling: 'touch',
    },
  });
  page.appendChild(messagesWrap);

  // Load messages
  const userId = (Store.get('user') || {}).id;
  try {
    const msgs = await API.fetch('/chat-groups/' + chatId + '/messages?limit=50');
    const list = API.extractRows(msgs);
    if (!list.length) {
      messagesWrap.appendChild(M.Empty({ text: 'Начните диалог', icon: '💬' }));
    } else {
      list.forEach(msg => {
        messagesWrap.appendChild(M.ChatBubble({
          text: msg.text || msg.content || '',
          mine: msg.user_id === userId || msg.sender_id === userId,
          name: msg.user_name || msg.sender_name || '',
          time: msg.created_at ? Utils.formatDate(msg.created_at, 'HH:mm') : '',
          status: msg.read ? 'read' : 'sent',
        }));
      });
      // Scroll to bottom
      setTimeout(() => { messagesWrap.scrollTop = messagesWrap.scrollHeight; }, 100);
    }
  } catch (_) {
    messagesWrap.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
  }

  // Composer
  page.appendChild(M.MessageComposer({
    placeholder: 'Сообщение...',
    onSend: async (text) => {
      try {
        await API.fetch('/chat-groups/' + chatId + '/messages', { method: 'POST', body: { text } });
        messagesWrap.appendChild(M.ChatBubble({ text, mine: true, time: 'сейчас', status: 'sent' }));
        messagesWrap.scrollTop = messagesWrap.scrollHeight;
      } catch (_) {
        M.Toast({ message: 'Ошибка отправки', type: 'error' });
      }
    },
    onAttach: () => {
      const input = Utils.el('input', { type: 'file', accept: '*/*' });
      input.onchange = async () => {
        if (!input.files[0]) return;
        const fd = new FormData();
        fd.append('file', input.files[0]);
        try {
          const resp = await fetch('/api/chat-groups/' + chatId + '/upload-file', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + API.getToken() },
            body: fd,
          });
          if (resp.ok) M.Toast({ message: 'Файл отправлен', type: 'success' });
          else M.Toast({ message: 'Ошибка загрузки', type: 'error' });
        } catch (_) {
          M.Toast({ message: 'Ошибка загрузки', type: 'error' });
        }
      };
      input.click();
    },
  }));

  return page;
}

function chatActionsSheet(chatId) {
  M.ActionSheet({
    title: 'Действия',
    actions: [
      { icon: '🔇', label: 'Выключить уведомления', onClick: () => API.fetch('/chat-groups/' + chatId + '/mute', { method: 'POST' }).then(() => M.Toast({ message: 'Уведомления выключены', type: 'info' })) },
      { icon: '👥', label: 'Участники', onClick: () => Router.navigate('/messenger/' + chatId + '?tab=members') },
      { icon: '📎', label: 'Файлы', onClick: () => Router.navigate('/messenger/' + chatId + '?tab=files') },
    ],
  });
}

function createChatSheet() {
  const content = Utils.el('div');
  content.appendChild(M.Form({
    fields: [
      { id: 'name', label: 'Название чата', type: 'text', required: true },
    ],
    submitLabel: 'Создать',
    onSubmit: async (data) => {
      try {
        await API.fetch('/chat-groups', { method: 'POST', body: { name: data.name, type: 'group' } });
        M.Toast({ message: 'Чат создан', type: 'success' });
        Router.navigate('/messenger');
      } catch (_) {
        M.Toast({ message: 'Ошибка создания', type: 'error' });
      }
    },
  }));
  M.BottomSheet({ title: 'Новый чат', content });
}

Router.register('/messenger', MessengerPage);
Router.register('/messenger/:id', { render: (p) => renderChat(p.id) });
if (typeof window !== 'undefined') window.MessengerPage = MessengerPage;
