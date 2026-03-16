/**
 * ASGARD CRM — Mobile v3 · Хугинн (Мессенджер)
 * TG-level: stories, поиск, список чатов, переписка,
 * группировка, реакции, ответы, last seen, разделители дат
 */

/* ═══════════════════════════════════════════════════════════════
   УТИЛИТЫ МЕССЕНДЖЕРА
   ═══════════════════════════════════════════════════════════════ */

function _msgGetChatName(chat) {
  return chat.direct_user_name || chat.name || chat.title || 'Чат';
}

function _msgIsOnline(lastLogin) {
  if (!lastLogin) return false;
  return (Date.now() - new Date(lastLogin).getTime()) < 5 * 60 * 1000;
}

function _msgFormatLastSeen(lastLogin) {
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
  var time = hh + ':' + mm;

  if (msgDay.getTime() === today.getTime()) return 'был(а) в ' + time;
  if (msgDay.getTime() === yesterday.getTime()) return 'был(а) вчера в ' + time;
  var MO = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
  return 'был(а) ' + d.getDate() + ' ' + MO[d.getMonth()];
}

function _msgDateLabel(dateStr) {
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var yesterday = new Date(today.getTime() - 86400000);
  var day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (day.getTime() === today.getTime()) return 'Сегодня';
  if (day.getTime() === yesterday.getTime()) return 'Вчера';
  var ML = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return d.getDate() + ' ' + ML[d.getMonth()];
}

function _msgTimeStr(dateStr) {
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function _msgSmartTime(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  var now = new Date();
  var diff = now - d;
  if (diff < 60000) return 'сейчас';
  if (diff < 86400000) return _msgTimeStr(dateStr);
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var yesterday = new Date(today.getTime() - 86400000);
  var day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (day.getTime() === yesterday.getTime()) return 'вчера';
  var DAYS = ['вс','пн','вт','ср','чт','пт','сб'];
  if (diff < 7 * 86400000) return DAYS[d.getDay()];
  return d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0');
}

/* SVG-галочки */
var _SVG_CHECK = '<svg width="13" height="9" viewBox="0 0 13 9"><path d="M1 4.5l3 3L11 1" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var _SVG_DCHECK = '<svg width="17" height="9" viewBox="0 0 17 9"><path d="M1 4.5l3 3L11 1" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 4.5l3 3L15 1" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ═══════════════════════════════════════════════════════════════
   СТРАНИЦА: СПИСОК ЧАТОВ
   ═══════════════════════════════════════════════════════════════ */

const MessengerPage = {
  async render(params) {
    const el = Utils.el;
    const t = DS.t;

    if (params && params.id) return _msgRenderChat(params.id);

    const page = el('div', { className: 'asgard-messenger-page', style: { minHeight: '100vh', background: t.bg } });

    /* ═══ Header ═══ */
    page.appendChild(M.Header({
      title: 'Хугинн',
      subtitle: 'МЕССЕНДЖЕР',
      back: false,
      actions: [{
        icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        onClick: function() { _msgNewChatSheet(); },
      }],
    }));

    /* ═══ Stories ═══ */
    const storiesWrap = el('div', {
      className: 'asgard-no-scrollbar asgard-huginn-stories',
      style: {
        display: 'flex', gap: '14px', padding: '12px var(--sp-page)',
        overflowX: 'auto', flexShrink: 0,
      },
    });
    page.appendChild(storiesWrap);

    /* ═══ Поиск ═══ */
    const searchBox = el('div', { className: 'asgard-huginn-search', style: { padding: '0 var(--sp-page) 8px', position: 'relative' } });
    const searchIcon = el('div', {
      style: { position: 'absolute', left: 'calc(var(--sp-page) + 10px)', top: '50%', transform: 'translateY(-50%)', color: t.textTer, pointerEvents: 'none', display: 'flex' },
      innerHTML: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
    });
    const searchInput = el('input', { type: 'search', placeholder: 'Поиск...', className: 'asgard-huginn-input' });
    searchBox.appendChild(searchIcon);
    searchBox.appendChild(searchInput);
    page.appendChild(searchBox);
    searchInput.addEventListener('input', function() { renderList(searchInput.value); });

    /* ═══ Список ═══ */
    const listWrap = el('div', { style: { minHeight: '200px' } });
    page.appendChild(listWrap);

    let chats = [];
    let usersMap = {};

    async function loadData() {
      listWrap.replaceChildren();
      listWrap.appendChild(M.Skeleton({ type: 'list', count: 6 }));
      try {
        const [chatsR, usersR] = await Promise.all([
          API.fetch('/chat-groups'),
          API.fetch('/users').catch(function() { return []; }),
        ]);
        chats = Array.isArray(chatsR) ? chatsR : API.extractRows(chatsR);
        const ul = Array.isArray(usersR) ? usersR : API.extractRows(usersR);
        usersMap = {};
        ul.forEach(function(u) { usersMap[u.id] = u; });
        buildStories(ul);
        renderList('');
      } catch (e) {
        listWrap.replaceChildren();
        if (e.status === 403) {
          listWrap.appendChild(M.Empty({ text: 'Нет доступа к мессенджеру.\nОбратитесь к администратору.', icon: '🔒' }));
        } else {
          listWrap.appendChild(M.ErrorBanner({ onRetry: loadData }));
        }
      }
    }

    function buildStories(users) {
      storiesWrap.replaceChildren();
      var me = Store.get('user') || {};

      // «Вы»
      var myItem = _storyItem('Вы', me.name || 'Вы', null, true);
      myItem.addEventListener('click', function() { M.Toast({ message: 'Истории скоро', type: 'info' }); });
      storiesWrap.appendChild(myItem);

      // Активные пользователи
      users.filter(function(u) { return u.is_active !== false && u.id !== me.id; }).slice(0, 20).forEach(function(u) {
        var item = _storyItem((u.name || '?').split(' ')[0], u.name || '?', u.last_login_at, false);
        item.addEventListener('click', function() { _msgOpenDirect(u.id); });
        storiesWrap.appendChild(item);
      });
    }

    function _storyItem(label, fullName, lastLogin, isMe) {
      var online = _msgIsOnline(lastLogin);
      var item = el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer', flexShrink: 0, width: '56px' } });

      var ring = el('div', {
        style: {
          width: '54px', height: '54px', borderRadius: '50%', padding: '2px',
          background: online ? 'linear-gradient(135deg, ' + t.blue + ', ' + t.green + ')' : (isMe ? 'transparent' : t.border),
        },
      });
      var inner = el('div', { style: { width: '100%', height: '100%', borderRadius: '50%', background: t.bg, padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' } });
      inner.appendChild(M.Avatar({ name: fullName, size: 46, status: online ? 'online' : null }));
      ring.appendChild(inner);

      if (isMe) {
        var plus = el('div', {
          style: {
            position: 'absolute', bottom: '-1px', right: '-1px', width: '18px', height: '18px',
            borderRadius: '50%', background: t.blue, border: '2px solid ' + t.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '12px', color: '#fff', lineHeight: 1,
          },
          textContent: '+',
        });
        ring.style.position = 'relative';
        ring.appendChild(plus);
      }
      item.appendChild(ring);

      item.appendChild(el('span', {
        style: { fontSize: '9px', color: t.textSec, maxWidth: '56px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center', display: 'block' },
        textContent: label,
      }));
      return item;
    }

    function renderList(query) {
      listWrap.replaceChildren();
      var q = (query || '').toLowerCase();
      var filtered = chats.filter(function(c) {
        return !q || _msgGetChatName(c).toLowerCase().includes(q);
      });

      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: q ? 'Ничего не найдено' : 'Нет чатов', type: q ? 'search' : 'default' }));
        return;
      }

      var list = el('div');
      filtered.forEach(function(chat, i) {
        var unread = chat.unread_count || 0;
        var name = _msgGetChatName(chat);
        var isGroup = chat.is_group === true;
        var du = !isGroup && chat.direct_user_id ? usersMap[chat.direct_user_id] : null;
        var online = du ? _msgIsOnline(du.last_login_at) : false;

        var row = el('div', {
          className: 'asgard-huginn-chat-row',
          style: {
            display: 'flex', gap: '12px', alignItems: 'center',
            padding: '10px var(--sp-page)', cursor: 'pointer',
            transition: 'background 0.12s',
          },
        });
        row.addEventListener('click', function() { Router.navigate('/messenger/' + chat.id); });
        row.addEventListener('touchstart', function() { row.style.background = t.surfaceAlt; }, { passive: true });
        row.addEventListener('touchend', function() { row.style.background = ''; }, { passive: true });
        row.addEventListener('touchcancel', function() { row.style.background = ''; }, { passive: true });

        row.appendChild(M.Avatar({ name: name, size: 50, status: online ? 'online' : null }));

        var info = el('div', { style: { flex: 1, minWidth: 0 } });

        // Строка 1: имя + время
        var r1 = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' } });
        r1.appendChild(el('div', {
          style: { fontWeight: 600, fontSize: '15px', color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
          textContent: name,
        }));
        r1.appendChild(el('span', {
          style: { fontSize: '11px', color: unread > 0 ? t.blue : t.textTer, flexShrink: 0, marginLeft: '8px' },
          textContent: _msgSmartTime(chat.last_message_at),
        }));
        info.appendChild(r1);

        // Строка 2: превью + badge
        var r2 = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });
        r2.appendChild(el('div', {
          style: { fontSize: '13px', color: t.textSec, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
          textContent: chat.last_message_text || '',
        }));
        if (unread > 0) {
          r2.appendChild(el('span', {
            className: 'asgard-huginn-badge',
            style: {
              minWidth: '20px', height: '20px', borderRadius: '10px',
              background: t.blue, color: '#fff', fontSize: '10px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 6px', flexShrink: 0, marginLeft: '8px',
            },
            textContent: unread > 99 ? '99+' : String(unread),
          }));
        }
        info.appendChild(r2);
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
   ЭКРАН ПЕРЕПИСКИ (всё в одной closure)
   ═══════════════════════════════════════════════════════════════ */

async function _msgRenderChat(chatId) {
  var el = Utils.el;
  var t = DS.t;
  var userId = (Store.get('user') || {}).id;
  var userName = (Store.get('user') || {}).name || '';

  /* ─── state ─── */
  var replyTo = null;
  var _sending = false;
  var _emojiOpen = false;

  /* ─── Каркас ─── */
  var page = el('div', { className: 'asgard-huginn-chat', style: { display: 'flex', flexDirection: 'column', height: '100vh', background: t.bg } });

  /* ─── Загрузка данных ─── */
  var chatInfo = {}, chatMembers = [], directUser = null;
  try {
    var resp = await API.fetch('/chat-groups/' + chatId);
    chatInfo = resp.chat || resp || {};
    chatMembers = resp.members || [];
    if (!chatInfo.is_group && chatMembers.length > 0) {
      directUser = chatMembers.find(function(m) { return m.user_id !== userId; }) || null;
    }
  } catch (_) {}

  var chatName = _msgGetChatName(chatInfo);
  if (!chatName && directUser) chatName = directUser.name || 'Чат';
  if (!chatName) chatName = 'Чат';
  var isGroup = chatInfo.is_group === true;
  var isOnline = directUser ? _msgIsOnline(directUser.last_login_at) : false;

  /* ═══ HEADER ═══ */
  var header = el('div', {
    className: 'asgard-huginn-chat-header',
    style: {
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '8px var(--sp-page)', background: t.surface,
      borderBottom: '1px solid ' + t.border,
      position: 'sticky', top: 0, zIndex: DS.z.sticky,
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      minHeight: '52px', flexShrink: 0,
    },
  });

  // Назад
  header.appendChild(el('button', {
    className: 'asgard-huginn-btn-icon',
    innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>',
    onClick: function() { Router.navigate('/messenger'); },
  }));

  // Аватар
  header.appendChild(M.Avatar({ name: chatName, size: 36, status: isOnline ? 'online' : null }));

  // Имя + статус
  var hi = el('div', { style: { flex: 1, minWidth: 0 } });
  hi.appendChild(el('div', { style: { fontWeight: 600, fontSize: '15px', color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, textContent: chatName }));
  var statusText = '';
  var statusColor = t.textSec;
  if (isGroup) {
    var mc = chatMembers.length || 0;
    statusText = mc + Utils.plural(mc, ' участник', ' участника', ' участников');
  } else if (directUser) {
    statusText = _msgFormatLastSeen(directUser.last_login_at);
    if (isOnline) statusColor = t.green;
  }
  if (statusText) hi.appendChild(el('div', { style: { fontSize: '11px', color: statusColor }, textContent: statusText }));
  header.appendChild(hi);

  // Действия
  var acts = el('div', { style: { display: 'flex', gap: '2px', flexShrink: 0 } });
  acts.appendChild(el('button', {
    className: 'asgard-huginn-btn-icon',
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="' + t.textSec + '" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>',
    onClick: function() { M.Toast({ message: 'Звонки скоро', type: 'info' }); },
  }));
  acts.appendChild(el('button', {
    className: 'asgard-huginn-btn-icon',
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="' + t.textSec + '" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
    onClick: function() { _msgActionsSheet(chatId); },
  }));
  header.appendChild(acts);
  page.appendChild(header);

  /* ═══ ОБЛАСТЬ СООБЩЕНИЙ ═══ */
  var msgArea = el('div', {
    className: 'asgard-huginn-messages',
    style: {
      flex: 1, overflowY: 'auto', padding: '8px var(--sp-page)',
      display: 'flex', flexDirection: 'column',
      WebkitOverflowScrolling: 'touch', position: 'relative',
    },
  });
  page.appendChild(msgArea);

  /* ═══ SCROLL-TO-BOTTOM FAB ═══ */
  var scrollFab = el('button', {
    className: 'asgard-huginn-scroll-fab',
    style: {
      position: 'absolute', right: '16px', bottom: '80px', width: '36px', height: '36px',
      borderRadius: '50%', background: t.surface, border: '1px solid ' + t.border,
      boxShadow: t.shadow, cursor: 'pointer', display: 'none',
      alignItems: 'center', justifyContent: 'center', zIndex: 10,
    },
    innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + t.text + '" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
    onClick: function() { msgArea.scrollTo({ top: msgArea.scrollHeight, behavior: 'smooth' }); },
  });
  page.appendChild(scrollFab);

  msgArea.addEventListener('scroll', function() {
    var fromBottom = msgArea.scrollHeight - msgArea.scrollTop - msgArea.clientHeight;
    scrollFab.style.display = fromBottom > 200 ? 'flex' : 'none';
  });

  /* ─── Загрузка сообщений ─── */
  var allMsgs = [];
  try {
    var msgsR = await API.fetch('/chat-groups/' + chatId + '/messages?limit=50');
    allMsgs = API.extractRows(msgsR);
    if (!allMsgs.length) {
      msgArea.appendChild(el('div', {
        style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '8px', opacity: 0.5 },
      }, el('div', { style: { fontSize: '36px' }, textContent: '💬' }), el('div', { style: { fontSize: '14px', color: t.textSec }, textContent: 'Начните диалог' })));
    } else {
      renderAllMessages(allMsgs);
      setTimeout(function() { msgArea.scrollTop = msgArea.scrollHeight; }, 50);
    }
  } catch (_) {
    msgArea.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate('/messenger/' + chatId, { replace: true }); } }));
  }

  /* ═══ REPLY PREVIEW ═══ */
  var replyBar = el('div', {
    className: 'asgard-huginn-reply-bar',
    style: {
      display: 'none', padding: '8px 12px', background: t.surface,
      borderTop: '1px solid ' + t.border, alignItems: 'center', gap: '8px', flexShrink: 0,
    },
  });
  var rpLine = el('div', { style: { width: '3px', alignSelf: 'stretch', borderRadius: '2px', background: t.blue, flexShrink: 0 } });
  var rpInfo = el('div', { style: { flex: 1, minWidth: 0 } });
  var rpName = el('div', { style: { fontSize: '11px', color: t.blue, fontWeight: 600 } });
  var rpText = el('div', { style: { fontSize: '12px', color: t.textSec, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } });
  rpInfo.appendChild(rpName);
  rpInfo.appendChild(rpText);
  replyBar.appendChild(rpLine);
  replyBar.appendChild(rpInfo);
  replyBar.appendChild(el('button', {
    className: 'asgard-huginn-btn-icon',
    style: { fontSize: '18px', color: t.textTer },
    textContent: '\u00D7',
    onClick: function() { clearReply(); },
  }));
  page.appendChild(replyBar);

  function setReply(msg) {
    replyTo = { id: msg.id, text: msg.message || msg.text || '', name: msg.user_name || '' };
    rpName.textContent = replyTo.name;
    rpText.textContent = replyTo.text.substring(0, 80);
    replyBar.style.display = 'flex';
    composerInput.focus();
  }
  function clearReply() {
    replyTo = null;
    replyBar.style.display = 'none';
  }

  /* ═══ COMPOSER ═══ */
  var composer = el('div', {
    className: 'asgard-huginn-composer',
    style: {
      display: 'flex', alignItems: 'flex-end', gap: '6px',
      padding: '8px 10px', background: t.surface,
      borderTop: '1px solid ' + t.border,
      paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))',
      flexShrink: 0,
    },
  });

  // Кнопка: прикрепить
  composer.appendChild(el('button', {
    className: 'asgard-huginn-btn-icon',
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="' + t.textSec + '" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>',
    onClick: function() { _msgAttach(chatId); },
  }));

  // Кнопка: эмодзи
  composer.appendChild(el('button', {
    className: 'asgard-huginn-btn-icon',
    style: { fontSize: '20px' },
    textContent: '😊',
    onClick: function() { _emojiOpen = !_emojiOpen; emojiPanel.style.display = _emojiOpen ? 'flex' : 'none'; },
  }));

  // Input
  var composerInput = el('input', {
    type: 'text',
    placeholder: 'Сообщение...',
    className: 'asgard-huginn-input',
  });
  composerInput.addEventListener('input', updateActionBtn);
  composerInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  composer.appendChild(composerInput);

  // Mic / Send
  var actionBtn = el('button', { className: 'asgard-huginn-send-btn' });
  function updateActionBtn() {
    var has = composerInput.value.trim().length > 0;
    if (has) {
      actionBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
      actionBtn.style.background = 'var(--hero-grad)';
      actionBtn.onclick = doSend;
    } else {
      actionBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="' + t.text + '" stroke-width="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
      actionBtn.style.background = t.surfaceAlt;
      actionBtn.onclick = function() { M.Toast({ message: 'Голосовые сообщения скоро', type: 'info' }); };
    }
  }
  updateActionBtn();
  actionBtn.addEventListener('touchstart', function() { actionBtn.style.transform = 'scale(0.9)'; }, { passive: true });
  actionBtn.addEventListener('touchend', function() { actionBtn.style.transform = ''; }, { passive: true });
  composer.appendChild(actionBtn);

  // Видео
  composer.appendChild(el('button', {
    className: 'asgard-huginn-btn-icon',
    innerHTML: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="' + t.textSec + '" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
    onClick: function() { M.Toast({ message: 'Видео-сообщения скоро', type: 'info' }); },
  }));

  page.appendChild(composer);

  /* ═══ EMOJI PANEL ═══ */
  var emojiPanel = el('div', {
    className: 'asgard-huginn-emoji-panel',
    style: { display: 'none', flexShrink: 0 },
  });
  var emojis = ['😀','😂','🥲','😍','🤔','😎','😢','😡','👍','👌','🔥','❤️','🎉','💪','🙏','🚀','🏆','✅','❌','💡','🎯','📊','📈','⏰','📝','👀','🤝','💰','🎪','😈'];
  var emojiGrid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '2px', padding: '12px', justifyContent: 'center' } });
  emojis.forEach(function(em) {
    emojiGrid.appendChild(el('button', {
      className: 'asgard-huginn-emoji-btn',
      textContent: em,
      onClick: function() { composerInput.value += em; updateActionBtn(); _emojiOpen = false; emojiPanel.style.display = 'none'; composerInput.focus(); },
    }));
  });
  emojiPanel.appendChild(emojiGrid);
  page.appendChild(emojiPanel);

  /* ═══════════════════════════════════════════════════
     РЕНДЕР СООБЩЕНИЙ С ГРУППИРОВКОЙ
     ═══════════════════════════════════════════════════ */
  function renderAllMessages(msgs) {
    msgArea.replaceChildren();
    var lastDate = '', lastUserId = null, lastTime = 0;

    msgs.forEach(function(msg, idx) {
      var mine = msg.user_id === userId || msg.sender_id === userId;
      var senderId = msg.user_id || msg.sender_id;
      var msgTime = new Date(msg.created_at).getTime();

      // Разделитель даты
      var dateLabel = _msgDateLabel(msg.created_at);
      if (dateLabel && dateLabel !== lastDate) {
        lastDate = dateLabel;
        lastUserId = null;
        msgArea.appendChild(_buildDateSep(dateLabel));
      }

      // Группировка: тот же отправитель + < 2 мин = grouped
      var grouped = (senderId === lastUserId) && (msgTime - lastTime < 120000);
      lastUserId = senderId;
      lastTime = msgTime;

      var row = _buildBubble(msg, mine, isGroup, grouped);
      _setupInteractions(row, msg);
      msgArea.appendChild(row);
    });
  }

  function appendMsg(msg) {
    var mine = msg.user_id === userId || msg.sender_id === userId;
    var row = _buildBubble(msg, mine, isGroup, false);
    row.classList.add('asgard-msg-enter');
    _setupInteractions(row, msg);
    msgArea.appendChild(row);
    msgArea.scrollTo({ top: msgArea.scrollHeight, behavior: 'smooth' });
  }

  /* ─── Разделитель даты ─── */
  function _buildDateSep(label) {
    var sep = el('div', { style: { display: 'flex', justifyContent: 'center', padding: '10px 0 6px' } });
    sep.appendChild(el('span', {
      style: {
        fontSize: '11px', color: t.textSec, fontWeight: 500,
        background: t.surfaceAlt, padding: '3px 12px', borderRadius: '10px',
      },
      textContent: label,
    }));
    return sep;
  }

  /* ─── Пузырь сообщения ─── */
  function _buildBubble(msg, mine, isGroupChat, grouped) {
    var text = msg.message || msg.text || msg.content || '';
    var time = msg._sending ? '' : _msgTimeStr(msg.created_at);

    var row = el('div', {
      style: {
        display: 'flex', gap: grouped ? '0' : '6px',
        flexDirection: mine ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        marginTop: grouped ? '1px' : '6px',
        paddingLeft: (!mine && grouped) ? '34px' : '0',
      },
    });

    // Аватар (чужие, не grouped)
    if (!mine && !grouped) {
      row.appendChild(M.Avatar({ name: msg.user_name || msg.sender_name || '?', size: 28 }));
    }

    var bubble = el('div', {
      style: {
        maxWidth: '78%', padding: '8px 12px',
        borderRadius: mine
          ? (grouped ? '14px 4px 4px 14px' : '14px 14px 4px 14px')
          : (grouped ? '4px 14px 14px 4px' : '14px 14px 14px 4px'),
        background: mine ? 'var(--hero-grad)' : t.surfaceAlt,
        color: mine ? '#fff' : t.text,
        border: mine ? 'none' : '1px solid ' + t.border,
        boxShadow: mine ? '0 1px 4px rgba(198,40,40,0.12)' : 'none',
      },
    });

    // Имя (группа, чужое, не grouped)
    if (!mine && isGroupChat && !grouped) {
      bubble.appendChild(el('div', {
        style: { fontSize: '11px', fontWeight: 600, color: t.blue, marginBottom: '2px' },
        textContent: msg.user_name || msg.sender_name || '',
      }));
    }

    // Reply quote
    if (msg.reply_id || msg.reply_text) {
      var q = el('div', {
        style: {
          display: 'flex', gap: '6px', padding: '5px 8px', marginBottom: '4px',
          borderRadius: '6px', background: mine ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.04)',
        },
      });
      q.appendChild(el('div', { style: { width: '2px', borderRadius: '1px', background: mine ? 'rgba(255,255,255,0.5)' : t.blue, flexShrink: 0, alignSelf: 'stretch' } }));
      var qi = el('div', { style: { minWidth: 0 } });
      if (msg.reply_user_name) qi.appendChild(el('div', { style: { fontSize: '10px', fontWeight: 600, color: mine ? 'rgba(255,255,255,0.7)' : t.blue }, textContent: msg.reply_user_name }));
      qi.appendChild(el('div', { style: { fontSize: '11px', color: mine ? 'rgba(255,255,255,0.5)' : t.textSec, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }, textContent: (msg.reply_text || '').substring(0, 50) }));
      q.appendChild(qi);
      bubble.appendChild(q);
    }

    // Текст
    bubble.appendChild(el('div', { style: { fontSize: '14px', lineHeight: '1.4', wordBreak: 'break-word' }, textContent: text }));

    // Мета: время + галочки
    var meta = el('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '3px', marginTop: '2px' } });
    if (time) meta.appendChild(el('span', { style: { fontSize: '9px', color: mine ? 'rgba(255,255,255,0.45)' : t.textTer }, textContent: time }));
    if (mine) {
      var chk = el('span', { style: { display: 'inline-flex', alignItems: 'center' } });
      if (msg.is_read) {
        chk.innerHTML = _SVG_DCHECK;
        chk.querySelector('svg').querySelectorAll('path').forEach(function(p) { p.setAttribute('stroke', '#4A90D9'); });
      } else if (msg._sending) {
        chk.innerHTML = _SVG_CHECK;
        chk.querySelector('svg').querySelector('path').setAttribute('stroke', 'rgba(255,255,255,0.4)');
      } else {
        chk.innerHTML = _SVG_DCHECK;
        chk.querySelector('svg').querySelectorAll('path').forEach(function(p) { p.setAttribute('stroke', 'rgba(255,255,255,0.4)'); });
      }
      meta.appendChild(chk);
    }
    bubble.appendChild(meta);

    // Реакции
    if (msg.reactions && typeof msg.reactions === 'object') {
      var rKeys = Object.keys(msg.reactions).filter(function(k) { return msg.reactions[k] && msg.reactions[k].length > 0; });
      if (rKeys.length > 0) {
        var rw = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '4px' } });
        rKeys.forEach(function(emoji) {
          var cnt = msg.reactions[emoji].length;
          var myReact = msg.reactions[emoji].indexOf(userId) >= 0;
          rw.appendChild(el('span', {
            style: {
              display: 'inline-flex', alignItems: 'center', gap: '2px',
              padding: '1px 6px', borderRadius: '10px', fontSize: '12px', cursor: 'pointer',
              background: myReact ? (mine ? 'rgba(255,255,255,0.25)' : t.blueBg) : (mine ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.04)'),
              border: '1px solid ' + (myReact ? t.blue : 'transparent'),
            },
            textContent: emoji + (cnt > 1 ? ' ' + cnt : ''),
            onClick: function() { _msgSendReaction(msg, emoji, chatId); },
          }));
        });
        bubble.appendChild(rw);
      }
    }

    // Вложения
    if (msg.attachments && msg.attachments.length > 0) {
      msg.attachments.forEach(function(att) {
        bubble.appendChild(el('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px',
            borderRadius: '6px', background: mine ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.04)',
            marginTop: '4px', fontSize: '12px', color: mine ? 'rgba(255,255,255,0.85)' : t.textSec, cursor: 'pointer',
          },
          textContent: '📎 ' + (att.file_name || 'Файл'),
        }));
      });
    }

    row.appendChild(bubble);
    return row;
  }

  /* ─── Swipe-to-reply + long-press реакции ─── */
  function _setupInteractions(rowEl, msg) {
    // Swipe → reply
    var sx = 0, cx = 0, sw = false;
    var replyIcon = null;
    rowEl.addEventListener('touchstart', function(e) {
      sx = e.touches[0].clientX;
      cx = sx;
      sw = true;
    }, { passive: true });
    rowEl.addEventListener('touchmove', function(e) {
      if (!sw) return;
      cx = e.touches[0].clientX;
      var dx = cx - sx;
      if (dx > 8 && dx < 80) {
        rowEl.style.transform = 'translateX(' + dx + 'px)';
        if (!replyIcon && dx > 20) {
          replyIcon = el('div', {
            style: {
              position: 'absolute', left: '4px', top: '50%', transform: 'translateY(-50%)',
              fontSize: '16px', opacity: 0.6, transition: 'opacity 0.1s',
            },
            textContent: '↩️',
          });
          rowEl.style.position = 'relative';
          rowEl.appendChild(replyIcon);
        }
        if (replyIcon) replyIcon.style.opacity = dx > 40 ? '1' : '0.4';
      }
    }, { passive: true });
    rowEl.addEventListener('touchend', function() {
      if (!sw) return;
      sw = false;
      var dx = cx - sx;
      rowEl.style.transform = '';
      if (replyIcon) { replyIcon.remove(); replyIcon = null; }
      if (dx > 50) setReply(msg);
      sx = 0; cx = 0;
    }, { passive: true });

    // Long press → reactions
    var lp = null;
    rowEl.addEventListener('touchstart', function(e) {
      lp = setTimeout(function() {
        _showReactionsAt(rowEl, msg, chatId);
      }, 400);
    }, { passive: true });
    rowEl.addEventListener('touchend', function() { clearTimeout(lp); }, { passive: true });
    rowEl.addEventListener('touchmove', function() { clearTimeout(lp); }, { passive: true });
  }

  /* ─── Popup реакций рядом с сообщением ─── */
  function _showReactionsAt(targetEl, msg, chatId) {
    var existing = document.querySelector('.asgard-react-overlay');
    if (existing) existing.remove();

    var overlay = el('div', {
      className: 'asgard-react-overlay',
      style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 },
      onClick: function() { overlay.remove(); },
    });

    var rect = targetEl.getBoundingClientRect();
    var popY = Math.max(8, rect.top - 52);
    var popX = Math.max(12, Math.min(rect.left, window.innerWidth - 260));

    var popup = el('div', {
      className: 'asgard-react-popup',
      style: {
        position: 'fixed', zIndex: 9999,
        left: popX + 'px', top: popY + 'px',
        display: 'flex', gap: '4px', padding: '8px 10px',
        background: t.surface, borderRadius: '20px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
        border: '1px solid ' + t.border,
      },
    });

    ['❤️','👍','👌','😂','🔥','😢'].forEach(function(em) {
      var btn = el('button', {
        className: 'asgard-huginn-emoji-btn',
        textContent: em,
        onClick: function() { overlay.remove(); _msgSendReaction(msg, em, chatId); },
      });
      popup.appendChild(btn);
    });

    overlay.appendChild(popup);
    document.body.appendChild(overlay);
  }

  /* ═══ ОТПРАВКА ═══ */
  async function doSend() {
    var text = composerInput.value.trim();
    if (!text || _sending) return;
    _sending = true;

    var body = { text: text };
    if (replyTo) body.reply_to_id = replyTo.id;

    // Optimistic
    var tempMsg = {
      id: 'temp_' + Date.now(), message: text, user_id: userId,
      user_name: userName, created_at: new Date().toISOString(), _sending: true,
      reply_id: replyTo ? replyTo.id : null, reply_text: replyTo ? replyTo.text : null,
      reply_user_name: replyTo ? replyTo.name : null,
    };
    appendMsg(tempMsg);
    composerInput.value = '';
    updateActionBtn();
    clearReply();

    try {
      await API.fetch('/chat-groups/' + chatId + '/messages', { method: 'POST', body: body });
    } catch (_) {
      M.Toast({ message: 'Ошибка отправки', type: 'error' });
    }
    _sending = false;
  }

  return page;
}

/* ═══════════════════════════════════════════════════════════════
   ОБЩИЕ ФУНКЦИИ
   ═══════════════════════════════════════════════════════════════ */

async function _msgSendReaction(msg, emoji, chatId) {
  if (!msg.id || String(msg.id).startsWith('temp_')) return;
  try {
    await API.fetch('/chat-groups/' + chatId + '/messages/' + msg.id + '/reaction', {
      method: 'POST', body: { emoji: emoji },
    });
    M.Toast({ message: emoji, type: 'info' });
  } catch (_) {
    M.Toast({ message: 'Ошибка', type: 'error' });
  }
}

function _msgAttach(chatId) {
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

async function _msgOpenDirect(userId) {
  try {
    var resp = await API.fetch('/chat-groups/direct', { method: 'POST', body: { user_id: userId } });
    var id = resp.chat ? resp.chat.id : resp.id;
    if (id) Router.navigate('/messenger/' + id);
  } catch (e) {
    M.Toast({ message: 'Ошибка: ' + (e.message || 'не удалось'), type: 'error' });
  }
}

function _msgNewChatSheet() {
  var el = Utils.el;
  var t = DS.t;
  var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });

  var opts = [
    { icon: '👤', title: 'Личный чат', desc: 'Напишите сотруднику', action: function() { _msgUserPicker(); } },
    { icon: '👥', title: 'Групповой чат', desc: 'Чат с несколькими участниками', action: function() { _msgGroupCreate(); } },
  ];
  opts.forEach(function(o) {
    var row = el('button', {
      style: {
        display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px',
        background: t.surfaceAlt, borderRadius: '12px', border: '1px solid ' + t.border,
        color: t.text, cursor: 'pointer', width: '100%', textAlign: 'left',
      },
      onClick: o.action,
    });
    row.appendChild(el('span', { style: { fontSize: '24px' }, textContent: o.icon }));
    var info = el('div');
    info.appendChild(el('div', { style: { fontWeight: 600, fontSize: '15px', color: t.text }, textContent: o.title }));
    info.appendChild(el('div', { style: { fontSize: '12px', color: t.textSec }, textContent: o.desc }));
    row.appendChild(info);
    content.appendChild(row);
  });
  M.BottomSheet({ title: 'Новый чат', content: content });
}

async function _msgUserPicker() {
  var el = Utils.el;
  var t = DS.t;
  var content = el('div', { style: { maxHeight: '60vh', overflowY: 'auto' } });
  content.appendChild(M.Skeleton({ type: 'list', count: 5 }));
  M.BottomSheet({ title: 'Выберите сотрудника', content: content });
  try {
    var resp = await API.fetch('/users');
    var users = Array.isArray(resp) ? resp : API.extractRows(resp);
    var me = Store.get('user') || {};
    content.replaceChildren();
    users.filter(function(u) { return u.is_active !== false && u.id !== me.id; }).forEach(function(u) {
      var row = el('div', {
        style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', cursor: 'pointer', borderBottom: '1px solid ' + t.border },
        onClick: function() { _msgOpenDirect(u.id); },
      });
      row.appendChild(M.Avatar({ name: u.name || '?', size: 40, status: _msgIsOnline(u.last_login_at) ? 'online' : null }));
      var info = el('div');
      info.appendChild(el('div', { style: { fontWeight: 600, fontSize: '14px', color: t.text }, textContent: u.name || u.login }));
      info.appendChild(el('div', { style: { fontSize: '11px', color: t.textSec }, textContent: u.role || '' }));
      row.appendChild(info);
      content.appendChild(row);
    });
  } catch (_) {
    content.replaceChildren();
    content.appendChild(M.ErrorBanner());
  }
}

function _msgGroupCreate() {
  var content = Utils.el('div');
  content.appendChild(M.Form({
    fields: [{ id: 'name', label: 'Название чата', type: 'text', required: true, placeholder: 'Введите название' }],
    submitLabel: 'Создать',
    onSubmit: async function(data) {
      try {
        await API.fetch('/chat-groups', { method: 'POST', body: { name: data.name, type: 'group' } });
        M.Toast({ message: 'Чат создан', type: 'success' });
        Router.navigate('/messenger');
      } catch (_) { M.Toast({ message: 'Ошибка создания', type: 'error' }); }
    },
  }));
  M.BottomSheet({ title: 'Групповой чат', content: content });
}

function _msgActionsSheet(chatId) {
  M.ActionSheet({
    title: 'Действия',
    actions: [
      { icon: '🔇', label: 'Выключить уведомления', onClick: function() { API.fetch('/chat-groups/' + chatId + '/mute', { method: 'PUT' }).then(function() { M.Toast({ message: 'Уведомления выключены', type: 'info' }); }).catch(function() { M.Toast({ message: 'Ошибка', type: 'error' }); }); } },
      { icon: '👥', label: 'Участники', onClick: function() { Router.navigate('/messenger/' + chatId + '?tab=members'); } },
      { icon: '📎', label: 'Файлы', onClick: function() { Router.navigate('/messenger/' + chatId + '?tab=files'); } },
    ],
  });
}

/* ═══ Регистрация маршрутов ═══ */
Router.register('/messenger', MessengerPage);
Router.register('/messenger/:id', { render: function(p) { return _msgRenderChat(p.id); } });
if (typeof window !== 'undefined') window.MessengerPage = MessengerPage;
