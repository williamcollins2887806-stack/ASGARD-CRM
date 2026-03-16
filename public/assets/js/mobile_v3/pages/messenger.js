/**
 * ASGARD CRM — Mobile v3 · Хугинн (Мессенджер)
 * TG-level: stories, поиск, список чатов, переписка,
 * реакции, ответы, last seen, разделители дат
 */
const MessengerPage = {
  async render(params) {
    const el = Utils.el;
    const t = DS.t;

    if (params && params.id) return renderChat(params.id);

    const page = el('div', { className: 'asgard-messenger-page', style: { minHeight: '100vh', background: t.bg } });

    /* ═══ Header ═══ */
    page.appendChild(M.Header({
      title: 'Хугинн',
      subtitle: 'МЕССЕНДЖЕР',
      back: false,
      actions: [{
        icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        onClick: function() { createNewChatSheet(); },
      }],
    }));

    /* ═══ Stories лента ═══ */
    const storiesWrap = el('div', {
      className: 'asgard-no-scrollbar',
      style: {
        display: 'flex', gap: '14px', padding: '12px var(--sp-page)',
        overflowX: 'auto', flexShrink: 0,
      },
    });
    page.appendChild(storiesWrap);

    /* ═══ Поиск ═══ */
    const searchWrap = el('div', { style: { padding: '0 var(--sp-page) 8px' } });
    const searchInput = el('input', {
      type: 'text',
      placeholder: 'Поиск...',
      style: {
        width: '100%', height: '36px', borderRadius: '12px',
        background: t.surfaceAlt, border: '1px solid ' + t.border,
        padding: '0 12px 0 36px', color: t.text, fontSize: '14px',
        outline: 'none', boxSizing: 'border-box',
      },
    });
    const searchIcon = el('div', {
      style: {
        position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)',
        color: t.textTer, fontSize: '14px', pointerEvents: 'none',
      },
      innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
    });
    const searchBox = el('div', { style: { position: 'relative' } });
    searchBox.appendChild(searchIcon);
    searchBox.appendChild(searchInput);
    searchWrap.appendChild(searchBox);
    page.appendChild(searchWrap);

    searchInput.addEventListener('input', function() { renderList(searchInput.value); });

    /* ═══ Список чатов ═══ */
    const listWrap = el('div', { style: { padding: '0', minHeight: '200px' } });
    page.appendChild(listWrap);

    let chats = [];
    let usersMap = {};

    /* ─── Загрузка данных ─── */
    async function loadData() {
      listWrap.replaceChildren();
      listWrap.appendChild(M.Skeleton({ type: 'list', count: 6 }));

      try {
        const [chatsResp, usersResp] = await Promise.all([
          API.fetch('/chat-groups'),
          API.fetch('/users').catch(function() { return []; }),
        ]);
        chats = Array.isArray(chatsResp) ? chatsResp : API.extractRows(chatsResp);
        const usersList = Array.isArray(usersResp) ? usersResp : API.extractRows(usersResp);
        usersMap = {};
        usersList.forEach(function(u) { usersMap[u.id] = u; });
        renderStories(usersList);
        renderList('');
      } catch (e) {
        listWrap.replaceChildren();
        if (e.status === 403) {
          listWrap.appendChild(M.Empty({ text: 'Нет доступа к мессенджеру.\nОбратитесь к администратору.', icon: '🔒' }));
        } else {
          listWrap.appendChild(M.ErrorBanner({ onRetry: function() { loadData(); } }));
        }
      }
    }

    /* ─── Stories ─── */
    function renderStories(users) {
      storiesWrap.replaceChildren();
      var me = Store.get('user') || {};

      // "Вы" — первый элемент
      var myStory = el('div', {
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer', flexShrink: 0 },
      });
      var myAvatarWrap = el('div', { style: { position: 'relative', width: '52px', height: '52px' } });
      myAvatarWrap.appendChild(M.Avatar({ name: me.name || 'Вы', size: 52 }));
      var plusBadge = el('div', {
        style: {
          position: 'absolute', bottom: '-2px', right: '-2px', width: '20px', height: '20px',
          borderRadius: '50%', background: t.blue, border: '2px solid ' + t.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '14px', color: '#fff', lineHeight: 1,
        },
        textContent: '+',
      });
      myAvatarWrap.appendChild(plusBadge);
      myStory.appendChild(myAvatarWrap);
      myStory.appendChild(el('span', {
        style: { fontSize: '9px', color: t.textSec, maxWidth: '52px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' },
        textContent: 'Вы',
      }));
      myStory.addEventListener('click', function() { M.Toast({ message: 'Истории скоро', type: 'info' }); });
      storiesWrap.appendChild(myStory);

      // Остальные пользователи (активные, не я)
      var activeUsers = users.filter(function(u) { return u.is_active !== false && u.id !== me.id; }).slice(0, 20);
      activeUsers.forEach(function(u) {
        var storyItem = el('div', {
          style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer', flexShrink: 0 },
          onClick: function() {
            openDirectChat(u.id);
          },
        });
        var isOnline = isUserOnline(u.last_login_at);
        var avatarWrap = el('div', {
          style: {
            width: '52px', height: '52px', borderRadius: '50%',
            padding: '2px',
            background: isOnline ? 'linear-gradient(135deg, ' + t.blue + ', ' + t.green + ')' : 'transparent',
          },
        });
        var innerWrap = el('div', { style: { width: '100%', height: '100%', borderRadius: '50%', background: t.bg, padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' } });
        innerWrap.appendChild(M.Avatar({ name: u.name || '?', size: 44, status: isOnline ? 'online' : null }));
        avatarWrap.appendChild(innerWrap);
        storyItem.appendChild(avatarWrap);
        storyItem.appendChild(el('span', {
          style: { fontSize: '9px', color: t.textSec, maxWidth: '52px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' },
          textContent: (u.name || '?').split(' ')[0],
        }));
        storiesWrap.appendChild(storyItem);
      });
    }

    /* ─── Список чатов ─── */
    function renderList(query) {
      listWrap.replaceChildren();
      var q = (query || '').toLowerCase();
      var filtered = chats.filter(function(c) {
        var name = getChatName(c).toLowerCase();
        return !q || name.includes(q);
      });

      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: q ? 'Ничего не найдено' : 'Нет чатов', type: q ? 'search' : 'default' }));
        return;
      }

      var list = el('div', { style: { display: 'flex', flexDirection: 'column' } });
      filtered.forEach(function(chat, i) {
        var unread = chat.unread_count || 0;
        var chatName = getChatName(chat);
        var isGroup = chat.is_group === true;
        var directUser = !isGroup && chat.direct_user_id ? usersMap[chat.direct_user_id] : null;
        var online = directUser ? isUserOnline(directUser.last_login_at) : false;

        var row = el('div', {
          style: {
            display: 'flex', gap: '12px', alignItems: 'center',
            padding: '10px var(--sp-page)', cursor: 'pointer',
            transition: 'background 0.15s ease',
            background: chat._pinned ? 'rgba(255,255,255,0.015)' : 'transparent',
            ...DS.anim(i * 0.02),
          },
          onClick: function() { Router.navigate('/messenger/' + chat.id); },
        });
        row.addEventListener('touchstart', function() { row.style.background = t.surfaceAlt; }, { passive: true });
        row.addEventListener('touchend', function() { row.style.background = chat._pinned ? 'rgba(255,255,255,0.015)' : ''; }, { passive: true });

        /* Аватар */
        row.appendChild(M.Avatar({ name: chatName, size: 50, status: online ? 'online' : null }));

        /* Инфо */
        var info = el('div', { style: { flex: 1, minWidth: 0 } });

        // Верхняя строка: имя + время
        var topRow = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' } });
        var nameEl = el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 } });
        if (chat._pinned) {
          nameEl.appendChild(el('span', { style: { fontSize: '10px', flexShrink: 0 }, textContent: '\uD83D\uDCCC' }));
        }
        nameEl.appendChild(el('span', {
          style: { ...DS.font('md'), color: t.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          textContent: chatName,
        }));
        topRow.appendChild(nameEl);
        topRow.appendChild(el('span', {
          style: { ...DS.font('xs'), color: unread > 0 ? t.blue : t.textTer, flexShrink: 0, marginLeft: '8px' },
          textContent: chat.last_message_at ? Utils.relativeTime(chat.last_message_at) : '',
        }));
        info.appendChild(topRow);

        // Нижняя строка: последнее сообщение + badge
        var bottomRow = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });
        var lastMsgText = chat.last_message_text || chat.last_message || '';
        bottomRow.appendChild(el('div', {
          style: { ...DS.font('sm'), color: t.textSec, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
          textContent: lastMsgText,
        }));
        if (unread > 0) {
          bottomRow.appendChild(el('span', {
            style: {
              minWidth: '20px', height: '20px', borderRadius: '10px',
              background: t.blue, color: '#fff', fontSize: '10px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 6px', flexShrink: 0, marginLeft: '8px',
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

    loadData();
    return page;
  },
};

/* ═══════════════════════════════════════════════════════════════
   ЭКРАН ПЕРЕПИСКИ
   ═══════════════════════════════════════════════════════════════ */
async function renderChat(chatId) {
  var el = Utils.el;
  var t = DS.t;
  var page = el('div', { style: { display: 'flex', flexDirection: 'column', height: '100vh', background: t.bg } });
  var userId = (Store.get('user') || {}).id;
  var replyTo = null; // { id, text, name }

  /* ─── Загрузка данных чата ─── */
  var chatInfo = {};
  var chatMembers = [];
  var directUser = null;
  try {
    var resp = await API.fetch('/chat-groups/' + chatId);
    chatInfo = resp.chat || resp || {};
    chatMembers = resp.members || [];
    if (!chatInfo.is_group && chatMembers.length > 0) {
      directUser = chatMembers.find(function(m) { return m.user_id !== userId; }) || null;
    }
  } catch (_) {}

  var chatName = getChatName(chatInfo);
  if (!chatName && directUser) chatName = directUser.name || 'Чат';
  if (!chatName) chatName = 'Чат';

  /* ═══ Header чата ═══ */
  var header = el('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '8px var(--sp-page)',
      background: t.surface, borderBottom: '1px solid ' + t.border,
      position: 'sticky', top: 0, zIndex: DS.z.sticky,
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      minHeight: '52px',
    },
  });

  // Кнопка назад
  var backBtn = el('button', {
    style: {
      background: 'none', border: 'none', cursor: 'pointer', padding: '8px',
      color: t.text, display: 'flex', alignItems: 'center', flexShrink: 0,
    },
    innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>',
    onClick: function() { Router.navigate('/messenger'); },
  });
  header.appendChild(backBtn);

  // Аватар + Имя/Статус
  var isOnline = directUser ? isUserOnline(directUser.last_login_at) : false;
  header.appendChild(M.Avatar({ name: chatName, size: 36, status: isOnline ? 'online' : null }));

  var headerInfo = el('div', { style: { flex: 1, minWidth: 0 } });
  headerInfo.appendChild(el('div', {
    style: { ...DS.font('md'), color: t.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    textContent: chatName,
  }));

  // Last seen / участники
  var statusEl = el('div', { style: { ...DS.font('xs'), color: t.textSec } });
  if (chatInfo.is_group) {
    var memberCount = chatMembers.length || chatInfo.member_count || 0;
    statusEl.textContent = memberCount + Utils.plural(memberCount, ' участник', ' участника', ' участников');
  } else if (directUser) {
    statusEl.textContent = formatLastSeen(directUser.last_login_at);
    if (isOnline) { statusEl.style.color = t.green; }
  }
  headerInfo.appendChild(statusEl);
  header.appendChild(headerInfo);

  // Кнопки справа
  var headerActions = el('div', { style: { display: 'flex', gap: '4px', flexShrink: 0 } });

  // Звонок
  var callBtn = el('button', {
    style: { background: 'none', border: 'none', cursor: 'pointer', padding: '8px', color: t.textSec, display: 'flex' },
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>',
    onClick: function() { M.Toast({ message: 'Звонки скоро', type: 'info' }); },
  });
  headerActions.appendChild(callBtn);

  // Меню
  var menuBtn = el('button', {
    style: { background: 'none', border: 'none', cursor: 'pointer', padding: '8px', color: t.textSec, display: 'flex' },
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
    onClick: function() { chatActionsSheet(chatId); },
  });
  headerActions.appendChild(menuBtn);
  header.appendChild(headerActions);
  page.appendChild(header);

  /* ═══ Область сообщений ═══ */
  var messagesWrap = el('div', {
    style: {
      flex: 1, overflowY: 'auto', padding: '8px var(--sp-page)',
      display: 'flex', flexDirection: 'column', gap: '2px',
      WebkitOverflowScrolling: 'touch',
    },
  });
  page.appendChild(messagesWrap);

  /* ─── Загрузка сообщений ─── */
  var allMessages = [];
  try {
    var msgsResp = await API.fetch('/chat-groups/' + chatId + '/messages?limit=50');
    allMessages = API.extractRows(msgsResp);
    if (!allMessages.length) {
      messagesWrap.appendChild(M.Empty({ text: 'Начните диалог', icon: '💬' }));
    } else {
      renderMessages(allMessages, messagesWrap, userId, chatInfo.is_group);
      setTimeout(function() { messagesWrap.scrollTop = messagesWrap.scrollHeight; }, 80);
    }
  } catch (_) {
    messagesWrap.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate('/messenger/' + chatId, { replace: true }); } }));
  }

  /* ═══ Reply preview ═══ */
  var replyPreview = el('div', {
    style: {
      display: 'none', padding: '8px 12px', background: t.surface,
      borderTop: '1px solid ' + t.border,
      flexDirection: 'row', alignItems: 'center', gap: '8px',
    },
  });
  var replyBar = el('div', { style: { width: '3px', height: '32px', borderRadius: '2px', background: t.blue, flexShrink: 0 } });
  var replyInfo = el('div', { style: { flex: 1, minWidth: 0 } });
  var replyName = el('div', { style: { ...DS.font('xs'), color: t.blue, fontWeight: 600 } });
  var replyText = el('div', { style: { ...DS.font('sm'), color: t.textSec, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } });
  replyInfo.appendChild(replyName);
  replyInfo.appendChild(replyText);
  replyPreview.appendChild(replyBar);
  replyPreview.appendChild(replyInfo);
  var replyClose = el('button', {
    style: { background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: t.textTer, fontSize: '18px' },
    textContent: '\u00D7',
    onClick: function() { replyTo = null; replyPreview.style.display = 'none'; },
  });
  replyPreview.appendChild(replyClose);
  page.appendChild(replyPreview);

  function setReply(msg) {
    replyTo = { id: msg.id, text: msg.message || msg.text || '', name: msg.user_name || '' };
    replyName.textContent = replyTo.name;
    replyText.textContent = replyTo.text.substring(0, 80);
    replyPreview.style.display = 'flex';
  }

  /* ═══ Composer ═══ */
  var composerWrap = el('div', {
    style: {
      display: 'flex', alignItems: 'flex-end', gap: '6px',
      padding: '8px 12px', background: t.surface,
      borderTop: '1px solid ' + t.border,
      paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))',
    },
  });

  // Кнопка прикрепления
  var attachBtn = el('button', {
    style: { background: 'none', border: 'none', cursor: 'pointer', padding: '8px', color: t.textSec, display: 'flex', flexShrink: 0 },
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>',
    onClick: function() { handleAttach(chatId); },
  });
  composerWrap.appendChild(attachBtn);

  // Кнопка эмодзи
  var emojiBtn = el('button', {
    style: { background: 'none', border: 'none', cursor: 'pointer', padding: '8px', color: t.textSec, display: 'flex', flexShrink: 0, fontSize: '20px' },
    textContent: '\uD83D\uDE0A',
    onClick: function() { toggleEmojiPanel(); },
  });
  composerWrap.appendChild(emojiBtn);

  // Input
  var composerInput = el('input', {
    type: 'text',
    placeholder: 'Сообщение...',
    style: {
      flex: 1, background: t.inputBg, border: '1px solid ' + t.border,
      borderRadius: '20px', padding: '10px 16px', color: t.text,
      fontSize: '14px', fontFamily: 'inherit', outline: 'none',
      height: '40px', lineHeight: '1', transition: 'border-color 0.2s ease',
      boxSizing: 'border-box',
    },
  });
  composerInput.addEventListener('focus', function() { composerInput.style.borderColor = t.blue; });
  composerInput.addEventListener('blur', function() { composerInput.style.borderColor = t.border; });
  composerInput.addEventListener('input', function() { updateSendBtn(); });
  composerInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  composerWrap.appendChild(composerInput);

  // Микрофон / Отправить
  var SVG_MIC = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  var SVG_SEND = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  var actionBtn = el('button', {
    style: {
      width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
      background: t.textTer, border: 'none', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.2s ease',
    },
    innerHTML: SVG_MIC,
  });
  actionBtn.addEventListener('touchstart', function() { actionBtn.style.transform = 'scale(0.9)'; }, { passive: true });
  actionBtn.addEventListener('touchend', function() { actionBtn.style.transform = ''; }, { passive: true });
  composerWrap.appendChild(actionBtn);

  // Видео-кружок
  var videoBtn = el('button', {
    style: { background: 'none', border: 'none', cursor: 'pointer', padding: '8px', color: t.textSec, display: 'flex', flexShrink: 0 },
    innerHTML: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
    onClick: function() { M.Toast({ message: 'Видео-сообщения скоро', type: 'info' }); },
  });
  composerWrap.appendChild(videoBtn);

  page.appendChild(composerWrap);

  /* ─── Emoji панель ─── */
  var emojiPanel = el('div', {
    style: {
      display: 'none', padding: '12px', background: t.surface,
      borderTop: '1px solid ' + t.border,
      flexWrap: 'wrap', gap: '8px', maxHeight: '200px', overflowY: 'auto',
    },
  });
  var emojis = ['\uD83D\uDE00','\uD83D\uDE02','\uD83D\uDE0D','\uD83E\uDD14','\uD83D\uDE0E','\uD83D\uDE22','\uD83D\uDE21','\uD83D\uDC4D','\uD83D\uDC4C','\uD83D\uDD25','\u2764\uFE0F','\uD83C\uDF89','\uD83D\uDCAA','\uD83D\uDE4F','\uD83D\uDE80','\uD83C\uDFC6','\u2705','\u274C','\uD83D\uDCA1','\uD83C\uDFAF','\uD83D\uDCCA','\uD83D\uDCC8','\u23F0','\uD83D\uDCDD'];
  emojis.forEach(function(em) {
    emojiPanel.appendChild(el('button', {
      style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '24px', padding: '4px', minWidth: '36px', minHeight: '36px' },
      textContent: em,
      onClick: function() {
        composerInput.value += em;
        updateSendBtn();
        emojiPanel.style.display = 'none';
        composerInput.focus();
      },
    }));
  });
  page.appendChild(emojiPanel);

  var _emojiOpen = false;
  function toggleEmojiPanel() {
    _emojiOpen = !_emojiOpen;
    emojiPanel.style.display = _emojiOpen ? 'flex' : 'none';
  }

  /* ─── Обновление кнопки отправки ─── */
  function updateSendBtn() {
    var hasText = composerInput.value.trim().length > 0;
    actionBtn.innerHTML = hasText ? SVG_SEND : SVG_MIC;
    actionBtn.style.background = hasText ? 'var(--hero-grad)' : t.textTer;
    actionBtn.onclick = hasText ? function() { sendMessage(); } : function() { M.Toast({ message: 'Голосовые сообщения скоро', type: 'info' }); };
  }
  updateSendBtn();

  /* ─── Отправка сообщения ─── */
  var _sending = false;
  async function sendMessage() {
    var text = composerInput.value.trim();
    if (!text || _sending) return;
    _sending = true;

    var body = { text: text };
    if (replyTo) { body.reply_to_id = replyTo.id; }

    // Optimistic UI
    var tempMsg = {
      id: 'temp_' + Date.now(),
      message: text, user_id: userId, user_name: (Store.get('user') || {}).name || '',
      created_at: new Date().toISOString(), _sending: true,
      reply_id: replyTo ? replyTo.id : null,
      reply_text: replyTo ? replyTo.text : null,
      reply_user_name: replyTo ? replyTo.name : null,
    };
    appendSingleMessage(tempMsg, messagesWrap, userId, chatInfo.is_group);
    messagesWrap.scrollTop = messagesWrap.scrollHeight;
    composerInput.value = '';
    updateSendBtn();
    if (replyTo) { replyTo = null; replyPreview.style.display = 'none'; }

    try {
      await API.fetch('/chat-groups/' + chatId + '/messages', { method: 'POST', body: body });
    } catch (_e) {
      M.Toast({ message: 'Ошибка отправки', type: 'error' });
    }
    _sending = false;
  }

  /* ─── Свайп для ответа ─── */
  function setupSwipeReply(msgEl, msg) {
    var startX = 0, currentX = 0, swiping = false;
    msgEl.addEventListener('touchstart', function(e) {
      startX = e.touches[0].clientX;
      swiping = true;
    }, { passive: true });
    msgEl.addEventListener('touchmove', function(e) {
      if (!swiping) return;
      currentX = e.touches[0].clientX;
      var dx = currentX - startX;
      if (dx > 10 && dx < 80) {
        msgEl.style.transform = 'translateX(' + dx + 'px)';
      }
    }, { passive: true });
    msgEl.addEventListener('touchend', function() {
      if (!swiping) return;
      swiping = false;
      var dx = currentX - startX;
      msgEl.style.transform = '';
      if (dx > 50) {
        setReply(msg);
        composerInput.focus();
      }
      startX = 0;
      currentX = 0;
    }, { passive: true });
  }

  /* ─── Реакция на сообщение (долгое нажатие) ─── */
  function setupLongPress(msgEl, msg) {
    var timer = null;
    msgEl.addEventListener('touchstart', function(e) {
      timer = setTimeout(function() {
        showReactionPopup(msgEl, msg, chatId);
      }, 500);
    }, { passive: true });
    msgEl.addEventListener('touchend', function() { clearTimeout(timer); }, { passive: true });
    msgEl.addEventListener('touchmove', function() { clearTimeout(timer); }, { passive: true });
  }

  /* ─── Рендер одного сообщения ─── */
  function appendSingleMessage(msg, container, userId, isGroup) {
    var mine = msg.user_id === userId || msg.sender_id === userId;
    var msgEl = buildMessageBubble(msg, mine, isGroup);
    msgEl.classList.add('asgard-msg-enter');
    setupSwipeReply(msgEl, msg);
    setupLongPress(msgEl, msg);
    container.appendChild(msgEl);
  }

  return page;
}

/* ═══════════════════════════════════════════════════════════════
   ХЕЛПЕРЫ
   ═══════════════════════════════════════════════════════════════ */

function getChatName(chat) {
  return chat.direct_user_name || chat.name || chat.title || 'Чат';
}

function isUserOnline(lastLogin) {
  if (!lastLogin) return false;
  var diff = Date.now() - new Date(lastLogin).getTime();
  return diff < 5 * 60 * 1000; // 5 минут
}

function formatLastSeen(lastLogin) {
  if (!lastLogin) return '';
  var d = new Date(lastLogin);
  if (isNaN(d.getTime())) return '';
  var now = new Date();
  var diff = now - d;

  if (diff < 5 * 60 * 1000) return 'онлайн';

  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var yesterday = new Date(today.getTime() - 86400000);
  var msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var hh = String(d.getHours()).padStart(2, '0');
  var mm = String(d.getMinutes()).padStart(2, '0');
  var timeStr = hh + ':' + mm;

  if (msgDay.getTime() === today.getTime()) return 'был(а) в ' + timeStr;
  if (msgDay.getTime() === yesterday.getTime()) return 'был(а) вчера в ' + timeStr;

  var MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return 'был(а) ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
}

function getDateSeparator(dateStr) {
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var yesterday = new Date(today.getTime() - 86400000);
  var msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (msgDay.getTime() === today.getTime()) return 'Сегодня';
  if (msgDay.getTime() === yesterday.getTime()) return 'Вчера';

  var MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return d.getDate() + ' ' + MONTHS[d.getMonth()];
}

/* SVG галочки */
function svgCheck(color) {
  return '<svg width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5l3 3L12 1" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function svgDoubleCheck(color) {
  return '<svg width="18" height="10" viewBox="0 0 18 10" fill="none"><path d="M1 5l3 3L12 1" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5l3 3L16 1" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

/* ─── Рендер всех сообщений с разделителями ─── */
function renderMessages(messages, container, userId, isGroup) {
  var el = Utils.el;
  var t = DS.t;
  var lastDateStr = '';

  messages.forEach(function(msg) {
    var msgDate = getDateSeparator(msg.created_at);
    if (msgDate && msgDate !== lastDateStr) {
      lastDateStr = msgDate;
      var sep = el('div', {
        style: {
          display: 'flex', justifyContent: 'center', padding: '8px 0',
        },
      });
      sep.appendChild(el('span', {
        style: {
          ...DS.font('xs'), color: t.textSec,
          background: t.surfaceAlt, padding: '4px 12px',
          borderRadius: '10px', fontSize: '11px',
        },
        textContent: msgDate,
      }));
      container.appendChild(sep);
    }

    var mine = msg.user_id === userId || msg.sender_id === userId;
    var msgEl = buildMessageBubble(msg, mine, isGroup);

    // Свайп + long press
    var startX = 0, currentX = 0, swiping = false;
    msgEl.addEventListener('touchstart', function(e) { startX = e.touches[0].clientX; swiping = true; }, { passive: true });
    msgEl.addEventListener('touchmove', function(e) {
      if (!swiping) return;
      currentX = e.touches[0].clientX;
      var dx = currentX - startX;
      if (dx > 10 && dx < 80) msgEl.style.transform = 'translateX(' + dx + 'px)';
    }, { passive: true });
    msgEl.addEventListener('touchend', function() {
      if (!swiping) return;
      swiping = false;
      msgEl.style.transform = '';
      startX = 0; currentX = 0;
    }, { passive: true });

    // Long press — реакция
    var lpTimer = null;
    msgEl.addEventListener('touchstart', function() {
      lpTimer = setTimeout(function() { showReactionPopup(msgEl, msg, null); }, 500);
    }, { passive: true });
    msgEl.addEventListener('touchend', function() { clearTimeout(lpTimer); }, { passive: true });
    msgEl.addEventListener('touchmove', function() { clearTimeout(lpTimer); }, { passive: true });

    container.appendChild(msgEl);
  });
}

/* ─── Пузырь сообщения ─── */
function buildMessageBubble(msg, mine, isGroup) {
  var el = Utils.el;
  var t = DS.t;
  var row = el('div', {
    className: 'asgard-chat-row',
    style: {
      display: 'flex', gap: '6px', marginBottom: '2px',
      flexDirection: mine ? 'row-reverse' : 'row',
      alignItems: 'flex-end',
      transition: 'transform 0.15s ease',
    },
  });

  if (!mine) {
    row.appendChild(M.Avatar({ name: msg.user_name || msg.sender_name || '?', size: 28 }));
  }

  var bubble = el('div', {
    style: {
      maxWidth: '78%', padding: '8px 12px',
      borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
      background: mine ? 'var(--hero-grad)' : t.surfaceAlt,
      color: mine ? '#fff' : t.text,
      border: mine ? 'none' : '1px solid ' + t.border,
      boxShadow: mine ? '0 2px 8px rgba(198,40,40,0.15)' : 'none',
    },
  });

  // Имя отправителя (группа, не своё)
  if (!mine && isGroup) {
    bubble.appendChild(el('div', {
      style: { ...DS.font('xs'), fontWeight: 600, color: t.blue, marginBottom: '3px' },
      textContent: msg.user_name || msg.sender_name || '',
    }));
  }

  // Reply quote
  if (msg.reply_id || msg.reply_text) {
    var quote = el('div', {
      style: {
        display: 'flex', gap: '6px', padding: '6px 8px', marginBottom: '6px',
        borderRadius: '8px', background: mine ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.05)',
      },
    });
    quote.appendChild(el('div', {
      style: { width: '2px', borderRadius: '1px', background: mine ? 'rgba(255,255,255,0.6)' : t.blue, flexShrink: 0 },
    }));
    var quoteInfo = el('div', { style: { minWidth: 0 } });
    if (msg.reply_user_name) {
      quoteInfo.appendChild(el('div', {
        style: { fontSize: '10px', fontWeight: 600, color: mine ? 'rgba(255,255,255,0.8)' : t.blue, marginBottom: '1px' },
        textContent: msg.reply_user_name,
      }));
    }
    quoteInfo.appendChild(el('div', {
      style: { fontSize: '11px', color: mine ? 'rgba(255,255,255,0.6)' : t.textSec, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' },
      textContent: (msg.reply_text || '').substring(0, 60),
    }));
    quote.appendChild(quoteInfo);
    bubble.appendChild(quote);
  }

  // Текст сообщения
  bubble.appendChild(el('div', {
    style: { ...DS.font('base'), lineHeight: 1.4, wordBreak: 'break-word' },
    textContent: msg.message || msg.text || msg.content || '',
  }));

  // Мета: время + галочки
  var meta = el('div', {
    style: {
      display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '3px',
      marginTop: '3px',
    },
  });
  if (msg.created_at) {
    var d = new Date(msg.created_at);
    var timeStr = msg._sending ? 'сейчас' : (String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
    meta.appendChild(el('span', {
      style: { fontSize: '9px', color: mine ? 'rgba(255,255,255,0.4)' : t.textTer },
      textContent: timeStr,
    }));
  }
  if (mine) {
    var checkEl = el('span', { style: { display: 'flex', alignItems: 'center' } });
    if (msg.is_read) {
      checkEl.innerHTML = svgDoubleCheck('#4A90D9');
    } else if (msg._sending) {
      checkEl.innerHTML = svgCheck('rgba(255,255,255,0.4)');
    } else {
      checkEl.innerHTML = svgDoubleCheck('rgba(255,255,255,0.4)');
    }
    meta.appendChild(checkEl);
  }
  bubble.appendChild(meta);

  // Реакции под пузырём
  if (msg.reactions && typeof msg.reactions === 'object') {
    var reactionsWrap = el('div', {
      style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' },
    });
    var keys = Object.keys(msg.reactions);
    if (keys.length > 0) {
      keys.forEach(function(emoji) {
        var users = msg.reactions[emoji] || [];
        if (users.length === 0) return;
        var rBadge = el('span', {
          style: {
            display: 'inline-flex', alignItems: 'center', gap: '2px',
            padding: '2px 6px', borderRadius: '10px', fontSize: '12px',
            background: mine ? 'rgba(255,255,255,0.2)' : t.surfaceAlt,
            border: '1px solid ' + (mine ? 'rgba(255,255,255,0.15)' : t.border),
            cursor: 'pointer',
          },
          textContent: emoji + (users.length > 1 ? ' ' + users.length : ''),
        });
        reactionsWrap.appendChild(rBadge);
      });
      bubble.appendChild(reactionsWrap);
    }
  }

  // Вложения
  if (msg.attachments && msg.attachments.length > 0) {
    var attachWrap = el('div', { style: { marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' } });
    msg.attachments.forEach(function(att) {
      var attEl = el('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px',
          borderRadius: '8px', background: mine ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.05)',
          cursor: 'pointer', fontSize: '12px', color: mine ? 'rgba(255,255,255,0.9)' : t.textSec,
        },
      });
      attEl.appendChild(el('span', { textContent: '\uD83D\uDCCE' }));
      attEl.appendChild(el('span', {
        style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        textContent: att.file_name || 'Файл',
      }));
      attachWrap.appendChild(attEl);
    });
    bubble.appendChild(attachWrap);
  }

  row.appendChild(bubble);
  return row;
}

/* ─── Popup реакций ─── */
function showReactionPopup(targetEl, msg, chatId) {
  var el = Utils.el;
  var t = DS.t;
  var existing = document.querySelector('.asgard-react-overlay');
  if (existing) existing.remove();

  var overlay = el('div', {
    className: 'asgard-react-overlay',
    style: {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 9998, background: 'transparent',
    },
    onClick: function() { overlay.remove(); },
  });

  var popup = el('div', {
    className: 'asgard-react-popup',
    style: {
      position: 'fixed', zIndex: 9999,
      left: '50%', top: '40%', transform: 'translate(-50%, -50%)',
      display: 'flex', gap: '8px', padding: '10px 14px',
      background: t.surface, borderRadius: '24px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      border: '1px solid ' + t.border,
    },
  });

  var reactionEmojis = ['\u2764\uFE0F', '\uD83D\uDC4D', '\uD83D\uDC4C', '\uD83D\uDE02', '\uD83D\uDD25', '\uD83D\uDE22'];
  reactionEmojis.forEach(function(em) {
    popup.appendChild(el('button', {
      style: {
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: '24px', padding: '4px', transition: 'transform 0.15s ease',
        minWidth: '36px', minHeight: '36px',
      },
      textContent: em,
      onClick: function() {
        overlay.remove();
        sendReaction(msg, em, chatId);
      },
    }));
  });

  overlay.appendChild(popup);
  document.body.appendChild(overlay);
}

async function sendReaction(msg, emoji, chatId) {
  if (!msg.id || String(msg.id).startsWith('temp_')) return;
  var cId = chatId || msg.chat_id;
  if (!cId) return;
  try {
    await API.fetch('/chat-groups/' + cId + '/messages/' + msg.id + '/reaction', {
      method: 'POST',
      body: { emoji: emoji },
    });
    M.Toast({ message: emoji, type: 'info' });
  } catch (_) {
    M.Toast({ message: 'Ошибка реакции', type: 'error' });
  }
}

/* ─── Прикрепление файла ─── */
function handleAttach(chatId) {
  var input = Utils.el('input', { type: 'file', accept: '*/*' });
  input.onchange = async function() {
    if (!input.files[0]) return;
    var fd = new FormData();
    fd.append('file', input.files[0]);
    try {
      var resp = await fetch('/api/chat-groups/' + chatId + '/upload-file', {
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
}

/* ─── Создание нового чата ─── */
function createNewChatSheet() {
  var el = Utils.el;
  var t = DS.t;
  var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

  // Кнопки: Личный чат / Группа
  var directBtn = el('button', {
    style: {
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '14px 16px', background: t.surfaceAlt,
      borderRadius: '12px', border: '1px solid ' + t.border,
      color: t.text, cursor: 'pointer', width: '100%', textAlign: 'left',
    },
  });
  directBtn.appendChild(el('span', { style: { fontSize: '24px' }, textContent: '\uD83D\uDC64' }));
  var directInfo = el('div');
  directInfo.appendChild(el('div', { style: { ...DS.font('md'), color: t.text }, textContent: 'Личный чат' }));
  directInfo.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec }, textContent: 'Напишите сотруднику напрямую' }));
  directBtn.appendChild(directInfo);
  directBtn.addEventListener('click', function() { showUserPicker(); });
  content.appendChild(directBtn);

  var groupBtn = el('button', {
    style: {
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '14px 16px', background: t.surfaceAlt,
      borderRadius: '12px', border: '1px solid ' + t.border,
      color: t.text, cursor: 'pointer', width: '100%', textAlign: 'left',
    },
  });
  groupBtn.appendChild(el('span', { style: { fontSize: '24px' }, textContent: '\uD83D\uDC65' }));
  var groupInfo = el('div');
  groupInfo.appendChild(el('div', { style: { ...DS.font('md'), color: t.text }, textContent: 'Групповой чат' }));
  groupInfo.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec }, textContent: 'Создайте чат с несколькими участниками' }));
  groupBtn.appendChild(groupInfo);
  groupBtn.addEventListener('click', function() { showGroupCreate(); });
  content.appendChild(groupBtn);

  M.BottomSheet({ title: 'Новый чат', content: content });
}

async function showUserPicker() {
  var el = Utils.el;
  var t = DS.t;
  var content = el('div', { style: { maxHeight: '60vh', overflowY: 'auto' } });
  content.appendChild(M.Skeleton({ type: 'list', count: 5 }));

  M.BottomSheet({ title: 'Выберите сотрудника', content: content });

  try {
    var resp = await API.fetch('/users');
    var users = Array.isArray(resp) ? resp : API.extractRows(resp);
    var me = Store.get('user') || {};
    var activeUsers = users.filter(function(u) { return u.is_active !== false && u.id !== me.id; });

    content.replaceChildren();
    activeUsers.forEach(function(u) {
      var row = el('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '10px 0', cursor: 'pointer', borderBottom: '1px solid ' + t.border,
        },
        onClick: function() { openDirectChat(u.id); },
      });
      row.appendChild(M.Avatar({ name: u.name || '?', size: 40, status: isUserOnline(u.last_login_at) ? 'online' : null }));
      var info = el('div');
      info.appendChild(el('div', { style: { ...DS.font('md'), color: t.text }, textContent: u.name || u.login || '?' }));
      info.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec }, textContent: u.role || '' }));
      row.appendChild(info);
      content.appendChild(row);
    });
  } catch (_) {
    content.replaceChildren();
    content.appendChild(M.ErrorBanner());
  }
}

async function openDirectChat(userId) {
  try {
    var resp = await API.fetch('/chat-groups/direct', { method: 'POST', body: { user_id: userId } });
    var chatId = resp.chat ? resp.chat.id : resp.id;
    if (chatId) Router.navigate('/messenger/' + chatId);
  } catch (e) {
    M.Toast({ message: 'Ошибка: ' + (e.message || 'не удалось открыть чат'), type: 'error' });
  }
}

function showGroupCreate() {
  var content = Utils.el('div');
  content.appendChild(M.Form({
    fields: [
      { id: 'name', label: 'Название чата', type: 'text', required: true, placeholder: 'Введите название' },
    ],
    submitLabel: 'Создать',
    onSubmit: async function(data) {
      try {
        await API.fetch('/chat-groups', { method: 'POST', body: { name: data.name, type: 'group' } });
        M.Toast({ message: 'Чат создан', type: 'success' });
        Router.navigate('/messenger');
      } catch (_) {
        M.Toast({ message: 'Ошибка создания', type: 'error' });
      }
    },
  }));
  M.BottomSheet({ title: 'Новый групповой чат', content: content });
}

function chatActionsSheet(chatId) {
  M.ActionSheet({
    title: 'Действия',
    actions: [
      {
        icon: '\uD83D\uDD07', label: 'Выключить уведомления',
        onClick: function() {
          API.fetch('/chat-groups/' + chatId + '/mute', { method: 'PUT' })
            .then(function() { M.Toast({ message: 'Уведомления выключены', type: 'info' }); })
            .catch(function() { M.Toast({ message: 'Ошибка', type: 'error' }); });
        },
      },
      {
        icon: '\uD83D\uDC65', label: 'Участники',
        onClick: function() { Router.navigate('/messenger/' + chatId + '?tab=members'); },
      },
      {
        icon: '\uD83D\uDCCE', label: 'Файлы',
        onClick: function() { Router.navigate('/messenger/' + chatId + '?tab=files'); },
      },
    ],
  });
}

/* ═══ Регистрация маршрутов ═══ */
Router.register('/messenger', MessengerPage);
Router.register('/messenger/:id', { render: function(p) { return renderChat(p.id); } });
if (typeof window !== 'undefined') window.MessengerPage = MessengerPage;
