/**
 * ASGARD CRM — Mobile v3 · Хугинн (Мессенджер)
 * v3 — polling, typing, infinite scroll, emoji, haptic, grouping
 */

/* ── Emoji Data ── */
const HUGINN_EMOJI = {
  'Часто': ['👍','❤️','😂','🔥','👀','✅','😊','😢','😡','👏','🙏','💪','🤝','🎉','❌','⭐','💯','🤔','😘','😎','🤦','🤷','👋','🫡','🚀','💡','✨','🎯'],
  'Смайлы': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','😋','😛','😜','🤪','🤗','🤭','🤔','😏','😒','🙄','😬','😌','😔','😴','🤮','🤧','🥵','🥶','🤯','🥳','😢','😭','😱','😤','😡','🤬'],
  'Жесты': ['👋','🤚','✋','🖖','👌','✌️','🤞','🤟','🤘','🤙','👍','👎','✊','👊','👏','🙌','🤝','🙏','💪','👀','❤️','🧡','💛','💚','💙','💜','🖤','💔'],
  'Работа': ['📱','💻','📊','📈','💰','💳','📧','📎','📌','📝','✅','❌','⏰','📅','📁','🔒','🔑','⚙️','🔔','🔍','📦','🚀','💡','🎯','🏆','🎉','🔥','⭐']
};
var QUICK_REACTIONS = ['👍','❤️','😂','🔥','👀','✅'];

/* ── Helpers ── */
function _huginnTime(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

function _huginnDateLabel(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var diff = (today - msgDay) / 86400000;
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  var months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return d.getDate() + ' ' + months[d.getMonth()];
}

function _huginnSameDay(d1, d2) {
  if (!d1 || !d2) return false;
  var a = new Date(d1), b = new Date(d2);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function _huginnIsGrouped(prev, curr) {
  if (!prev || !curr) return false;
  if (prev.user_id !== curr.user_id) return false;
  return Math.abs(new Date(curr.created_at) - new Date(prev.created_at)) < 120000;
}

/* ═══════════════════════════════════════════
   CHAT LIST
   ═══════════════════════════════════════════ */
const MessengerPage = {
  async render(params) {
    const el = Utils.el;
    const t = DS.t;
    if (params && params.id) return renderChat(params.id);

    const page = el('div', { className: 'asgard-huginn-list page-container' });

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

    const listWrap = el('div', { style: { padding: '4px 0', minHeight: '200px' } });
    page.appendChild(listWrap);

    let chats = [];

    async function loadChats() {
      listWrap.replaceChildren();
      listWrap.appendChild(M.Skeleton({ type: 'list', count: 6 }));
      try {
        const resp = await API.fetch('/chat-groups');
        chats = Array.isArray(resp) ? resp : API.extractRows(resp);
        renderList('');
      } catch (e) {
        listWrap.replaceChildren();
        listWrap.appendChild(M.ErrorBanner({ onRetry: loadChats }));
      }
    }

    function renderList(query) {
      listWrap.replaceChildren();
      const q = (query || '').toLowerCase();
      const filtered = chats.filter(c => {
        const name = (c.name || c.direct_user_name || '').toLowerCase();
        return !q || name.includes(q);
      });

      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: q ? 'Ничего не найдено' : 'Нет чатов' }));
        return;
      }

      const list = el('div', { style: { display: 'flex', flexDirection: 'column' } });
      filtered.forEach((chat, i) => {
        const unread = chat.unread_count || 0;
        const name = chat.is_group === false ? (chat.direct_user_name || chat.name || 'Чат') : (chat.name || 'Чат');

        const row = el('div', {
          style: {
            display: 'flex', gap: '12px', alignItems: 'center',
            padding: '12px var(--sp-page,16px)', cursor: 'pointer',
            transition: 'background 0.15s ease',
            ...DS.anim(i * 0.02),
          },
          onClick: () => Router.navigate('/messenger/' + chat.id),
        });
        row.addEventListener('touchstart', () => { row.style.background = t.surfaceAlt || 'rgba(255,255,255,0.05)'; }, { passive: true });
        row.addEventListener('touchend', () => { row.style.background = ''; }, { passive: true });

        row.appendChild(M.Avatar({ name: name, size: 52 }));

        const info = el('div', { style: { flex: 1, minWidth: 0 } });

        const topRow = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' } });
        topRow.appendChild(el('div', {
          style: { ...DS.font('md'), color: t.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          textContent: name,
        }));
        const timeText = chat.last_message_at ? Utils.relativeTime(chat.last_message_at) : '';
        topRow.appendChild(el('span', {
          style: { ...DS.font('xs'), color: unread > 0 ? (t.accent || '#ff4444') : (t.textTer || '#666'), flexShrink: 0, marginLeft: '8px' },
          textContent: timeText,
        }));
        info.appendChild(topRow);

        const bottomRow = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });
        const preview = chat.is_group ? (chat.member_count || 0) + ' участн.' : '';
        bottomRow.appendChild(el('div', {
          style: { ...DS.font('sm'), color: t.textSec || '#999', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
          textContent: preview,
        }));
        if (unread > 0) {
          bottomRow.appendChild(el('span', {
            style: {
              minWidth: '22px', height: '22px', borderRadius: '11px',
              background: t.accent || '#ff4444', color: '#fff', fontSize: '11px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', flexShrink: 0, marginLeft: '8px',
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

/* ═══════════════════════════════════════════
   CHAT SCREEN
   ═══════════════════════════════════════════ */
async function renderChat(chatId) {
  const el = Utils.el;
  const t = DS.t;
  const userId = (Store.get('user') || {}).id;
  const page = el('div', {
    className: 'asgard-huginn-chat asgard-slide-right',
    style: { display: 'flex', flexDirection: 'column', height: '100vh', background: t.bg, position: 'relative' },
  });

  // State
  let messages = [];
  let lastMsgId = 0;
  let oldestMsgId = Infinity;
  let hasOlder = true;
  let loadingOlder = false;
  let replyTo = null;
  let emojiOpen = false;
  let emptyStateEl = null;
  let _lastTypingSent = 0;

  // Load chat info
  let chatInfo = {};
  let chatMembers = [];
  try {
    const resp = await API.fetch('/chat-groups/' + chatId);
    chatInfo = resp.chat || resp || {};
    chatMembers = resp.members || [];
  } catch (_) {}

  const mc = chatMembers.length;
  page.appendChild(M.Header({
    title: chatInfo.name || 'Чат',
    subtitle: mc > 0 ? mc + Utils.plural(mc, ' участник', ' участника', ' участников') : '',
    back: true,
    backHref: '/messenger',
    actions: [{
      icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
      onClick: () => chatActionsSheet(chatId),
    }],
  }));

  // Typing indicator bar
  const typingBar = el('div', {
    style: {
      height: '0', overflow: 'hidden', padding: '0 var(--sp-page,16px)',
      transition: 'height 0.2s ease, padding 0.2s ease',
      ...DS.font('xs'), color: t.accent || '#ff4444',
    },
  });
  page.appendChild(typingBar);

  // Messages area
  const messagesWrap = el('div', {
    style: {
      flex: 1, overflowY: 'auto', padding: '8px var(--sp-page,16px) 8px',
      display: 'flex', flexDirection: 'column',
      WebkitOverflowScrolling: 'touch',
    },
  });
  page.appendChild(messagesWrap);

  // Scroll-to-bottom FAB
  const scrollFab = el('div', {
    style: {
      position: 'absolute', right: '16px', bottom: '80px',
      width: '40px', height: '40px', borderRadius: '20px',
      background: t.surface || '#222', border: '1px solid ' + (t.border || '#333'),
      display: 'none', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', zIndex: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    },
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="' + (t.text || '#fff') + '" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
    onClick: () => { messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: 'smooth' }); },
  });
  page.appendChild(scrollFab);

  messagesWrap.addEventListener('scroll', () => {
    var gap = messagesWrap.scrollHeight - messagesWrap.scrollTop - messagesWrap.clientHeight;
    scrollFab.style.display = gap > 150 ? 'flex' : 'none';
    if (messagesWrap.scrollTop < 60 && hasOlder && !loadingOlder) loadOlderMessages();
  }, { passive: true });

  // Reply bar
  const replyBar = el('div', {
    style: {
      display: 'none', padding: '8px 16px', background: t.surface || '#1a1a1a',
      borderTop: '1px solid ' + (t.border || '#333'), alignItems: 'center', gap: '8px',
    },
  });
  const replyContent = el('div', { style: { flex: 1, minWidth: 0, borderLeft: '2px solid ' + (t.accent || '#ff4444'), paddingLeft: '8px' } });
  const replyName = el('div', { style: { ...DS.font('xs'), color: t.accent || '#ff4444', fontWeight: 600, marginBottom: '2px' } });
  const replyTextEl = el('div', { style: { ...DS.font('sm'), color: t.textSec || '#999', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } });
  replyContent.appendChild(replyName);
  replyContent.appendChild(replyTextEl);
  replyBar.appendChild(replyContent);
  replyBar.appendChild(el('div', {
    style: { width: '28px', height: '28px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
    innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + (t.textSec || '#999') + '" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    onClick: () => setReply(null),
  }));

  // Emoji panel
  const emojiPanel = el('div', {
    style: {
      display: 'none', height: '250px', background: t.surface || '#1a1a1a',
      borderTop: '1px solid ' + (t.border || '#333'), flexDirection: 'column', overflow: 'hidden',
    },
  });
  const emojiTabs = el('div', { style: { display: 'flex', borderBottom: '1px solid ' + (t.border || '#333') } });
  const emojiGrid = el('div', { style: { flex: 1, overflowY: 'auto', padding: '8px', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', alignContent: 'start' } });
  const tabNames = Object.keys(HUGINN_EMOJI);
  let activeTab = 0;

  function renderEmojiTab(idx) {
    activeTab = idx;
    emojiGrid.replaceChildren();
    HUGINN_EMOJI[tabNames[idx]].forEach(em => {
      emojiGrid.appendChild(el('div', {
        style: { fontSize: '24px', textAlign: 'center', padding: '6px', cursor: 'pointer', borderRadius: '8px' },
        textContent: em,
        onClick: () => { textarea.value += em; textarea.focus(); autoResize(); },
      }));
    });
    Array.from(emojiTabs.children).forEach((tab, i) => {
      tab.style.borderBottom = i === idx ? '2px solid ' + (t.accent || '#ff4444') : '2px solid transparent';
      tab.style.color = i === idx ? (t.accent || '#ff4444') : (t.textSec || '#999');
    });
  }

  tabNames.forEach((name, i) => {
    emojiTabs.appendChild(el('div', {
      style: { flex: 1, textAlign: 'center', padding: '8px 4px', cursor: 'pointer', ...DS.font('xs'), fontWeight: 600 },
      textContent: name,
      onClick: () => renderEmojiTab(i),
    }));
  });
  emojiPanel.appendChild(emojiTabs);
  emojiPanel.appendChild(emojiGrid);

  // Composer
  const composerWrap = el('div', {
    className: 'asgard-huginn-composer',
    style: {
      display: 'flex', alignItems: 'flex-end', gap: '8px',
      padding: '8px var(--sp-page,16px)',
      paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))',
      background: t.bg, borderTop: '1px solid ' + (t.border || '#333'),
    },
  });

  const emojiBtn = el('div', {
    className: 'asgard-huginn-btn',
    style: { width: '40px', height: '40px', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
    innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' + (t.textSec || '#999') + '" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    onClick: () => toggleEmoji(),
  });
  composerWrap.appendChild(emojiBtn);

  const textarea = el('textarea', {
    className: 'asgard-huginn-textarea',
    placeholder: 'Сообщение...',
    rows: 1,
  });

  function autoResize() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }

  textarea.addEventListener('input', () => { autoResize(); sendTypingSignal(); });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  composerWrap.appendChild(textarea);

  composerWrap.appendChild(el('div', {
    className: 'asgard-huginn-btn',
    style: { width: '40px', height: '40px', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
    innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' + (t.textSec || '#999') + '" stroke-width="1.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>',
    onClick: () => attachFile(),
  }));

  const sendBtn = el('div', {
    className: 'asgard-huginn-send-btn',
    style: {
      width: '40px', height: '40px', borderRadius: '20px',
      background: t.accent || '#ff4444', display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', flexShrink: 0,
    },
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    onClick: () => sendMessage(),
  });
  composerWrap.appendChild(sendBtn);

  page.appendChild(replyBar);
  page.appendChild(emojiPanel);
  page.appendChild(composerWrap);

  // ── Functions ──
  function setReply(msg) {
    replyTo = msg;
    if (msg) {
      replyBar.style.display = 'flex';
      replyName.textContent = msg.user_name || 'Сообщение';
      replyTextEl.textContent = msg.message || '';
      textarea.focus();
    } else {
      replyBar.style.display = 'none';
    }
  }

  function toggleEmoji() {
    emojiOpen = !emojiOpen;
    emojiPanel.style.display = emojiOpen ? 'flex' : 'none';
    if (emojiOpen && emojiGrid.children.length === 0) renderEmojiTab(0);
  }

  function sendTypingSignal() {
    var now = Date.now();
    if (now - _lastTypingSent < 2000) return;
    _lastTypingSent = now;
    API.fetch('/chat-groups/' + chatId + '/typing', { method: 'POST' }).catch(function(){});
  }

  async function sendMessage() {
    var text = textarea.value.trim();
    if (!text) return;
    if (navigator.vibrate) navigator.vibrate(10);

    var body = { text: text };
    var savedReply = replyTo;
    if (savedReply) body.reply_to_id = savedReply.id;

    textarea.value = '';
    autoResize();
    setReply(null);
    if (emojiOpen) toggleEmoji();

    try {
      var resp = await API.fetch('/chat-groups/' + chatId + '/messages', { method: 'POST', body: body });
      var msg = resp.message || resp;
      if (msg && msg.id) {
        msg.user_name = msg.user_name || (Store.get('user') || {}).name || '';
        msg.user_id = msg.user_id || userId;
        if (savedReply) {
          msg.reply_to = savedReply.id;
          msg.reply_text = savedReply.message;
          msg.reply_user_name = savedReply.user_name;
        }
        if (emptyStateEl && emptyStateEl.parentNode) { emptyStateEl.remove(); emptyStateEl = null; }
        messages.push(msg);
        if (msg.id > lastMsgId) lastMsgId = msg.id;
        appendMessage(msg, messages.length > 1 ? messages[messages.length - 2] : null);
        messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: 'smooth' });
      }
    } catch (_) {
      M.Toast({ message: 'Ошибка отправки', type: 'error' });
    }
  }

  function attachFile() {
    var input = el('input', { type: 'file', accept: '*/*' });
    input.onchange = async () => {
      if (!input.files[0]) return;
      var fd = new FormData();
      fd.append('file', input.files[0]);
      try {
        var resp = await fetch('/api/chat-groups/' + chatId + '/upload-file', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + API.getToken() },
          body: fd,
        });
        if (resp.ok) { M.Toast({ message: 'Файл отправлен', type: 'success' }); pollNewMessages(); }
        else M.Toast({ message: 'Ошибка загрузки', type: 'error' });
      } catch (_) { M.Toast({ message: 'Ошибка загрузки', type: 'error' }); }
    };
    input.click();
  }

  // ── Message rendering ──
  function createBubble(msg, prev) {
    var mine = msg.user_id === userId;
    var grouped = _huginnIsGrouped(prev, msg);

    var wrap = el('div', {
      style: {
        display: 'flex', flexDirection: mine ? 'row-reverse' : 'row',
        alignItems: 'flex-end', gap: '8px',
        marginTop: grouped ? '1px' : '8px',
        animation: 'asgard-msg-in 0.2s ease-out',
      },
    });

    if (!mine && !grouped) {
      wrap.appendChild(M.Avatar({ name: msg.user_name || '?', size: 28 }));
    } else if (!mine && grouped) {
      wrap.appendChild(el('div', { style: { width: '28px', flexShrink: 0 } }));
    }

    var bubble = el('div', {
      style: {
        maxWidth: '75%', padding: '8px 12px',
        background: mine ? (t.accent || '#ff4444') : (t.surface || '#1e1e1e'),
        borderRadius: mine
          ? (grouped ? '18px 4px 18px 18px' : '18px 18px 4px 18px')
          : (grouped ? '4px 18px 18px 18px' : '18px 18px 18px 4px'),
        position: 'relative', wordBreak: 'break-word',
      },
    });

    if (!mine && !grouped && chatInfo.is_group) {
      bubble.appendChild(el('div', {
        style: { ...DS.font('xs'), color: t.accent || '#ff4444', fontWeight: 600, marginBottom: '2px' },
        textContent: msg.user_name || '',
      }));
    }

    if (msg.reply_to && msg.reply_text) {
      var rp = el('div', { style: { borderLeft: '2px solid ' + (mine ? 'rgba(255,255,255,0.5)' : (t.accent || '#ff4444')), paddingLeft: '8px', marginBottom: '4px', opacity: 0.8 } });
      rp.appendChild(el('div', { style: { ...DS.font('xs'), fontWeight: 600, color: mine ? 'rgba(255,255,255,0.9)' : (t.accent || '#ff4444') }, textContent: msg.reply_user_name || '' }));
      rp.appendChild(el('div', { style: { ...DS.font('xs'), color: mine ? 'rgba(255,255,255,0.7)' : (t.textSec || '#999'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }, textContent: msg.reply_text }));
      bubble.appendChild(rp);
    }

    if (msg.message) {
      bubble.appendChild(el('div', {
        style: { ...DS.font('sm'), color: mine ? '#fff' : (t.text || '#fff'), lineHeight: '1.4' },
        textContent: msg.message,
      }));
    }

    if (msg.attachments && msg.attachments.length) {
      msg.attachments.forEach(att => {
        var fname = (att.file_path || att.file_name || '').split('/').pop();
        var attEl = el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', cursor: 'pointer', opacity: 0.85 },
          onClick: () => { window.open('/api/chat-groups/' + chatId + '/files/' + encodeURIComponent(fname)); },
        });
        attEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>';
        attEl.appendChild(el('span', { style: { ...DS.font('xs'), textDecoration: 'underline' }, textContent: att.file_name || 'Файл' }));
        bubble.appendChild(attEl);
      });
    }

    var meta = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: mine ? 'flex-end' : 'flex-start', gap: '4px', marginTop: '2px' } });
    meta.appendChild(el('span', {
      style: { ...DS.font('xs'), fontSize: '10px', color: mine ? 'rgba(255,255,255,0.6)' : (t.textTer || '#666') },
      textContent: _huginnTime(msg.created_at) + (msg.edited_at ? ' (ред.)' : ''),
    }));
    if (mine) {
      var checkColor = msg.is_read ? '#4fc3f7' : 'rgba(255,255,255,0.5)';
      var checkSvg = msg.is_read
        ? '<svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M1 5l3 3 5-7" stroke="' + checkColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 5l3 3 5-7" stroke="' + checkColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg width="12" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 5l3 3 7-7" stroke="' + checkColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      var checkEl = el('span');
      checkEl.innerHTML = checkSvg;
      meta.appendChild(checkEl);
    }
    bubble.appendChild(meta);

    if (msg.reactions && Object.keys(msg.reactions).length) {
      var reactRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' } });
      for (var emoji in msg.reactions) {
        var users = msg.reactions[emoji];
        var isMine = Array.isArray(users) && users.includes(userId);
        (function(em, us, im) {
          var rb = el('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: '3px',
              padding: '2px 6px', borderRadius: '10px', cursor: 'pointer',
              background: im ? 'rgba(255,68,68,0.2)' : 'rgba(255,255,255,0.08)',
              border: im ? '1px solid rgba(255,68,68,0.4)' : '1px solid transparent', fontSize: '14px',
            },
            onClick: (e) => { e.stopPropagation(); toggleReaction(msg.id, em); },
          });
          rb.appendChild(el('span', { textContent: em }));
          if (us.length > 1) rb.appendChild(el('span', { style: { fontSize: '11px', color: t.textSec || '#999' }, textContent: String(us.length) }));
          reactRow.appendChild(rb);
        })(emoji, users, isMine);
      }
      bubble.appendChild(reactRow);
    }

    wrap.appendChild(bubble);

    // Swipe-to-reply
    var touchStartX = 0, touchDeltaX = 0;
    wrap.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; touchDeltaX = 0; }, { passive: true });
    wrap.addEventListener('touchmove', (e) => {
      touchDeltaX = e.touches[0].clientX - touchStartX;
      if (touchDeltaX > 0 && touchDeltaX < 80) { wrap.style.transform = 'translateX(' + touchDeltaX + 'px)'; wrap.style.transition = 'none'; }
    }, { passive: true });
    wrap.addEventListener('touchend', () => {
      wrap.style.transition = 'transform 0.2s ease'; wrap.style.transform = '';
      if (touchDeltaX > 50) { if (navigator.vibrate) navigator.vibrate(5); setReply({ id: msg.id, message: msg.message, user_name: msg.user_name }); }
    }, { passive: true });

    // Long press for reactions
    var longPressTimer = null;
    wrap.addEventListener('touchstart', () => {
      longPressTimer = setTimeout(() => { if (navigator.vibrate) navigator.vibrate(15); showReactionPopup(msg, wrap); }, 500);
    }, { passive: true });
    wrap.addEventListener('touchmove', () => { clearTimeout(longPressTimer); }, { passive: true });
    wrap.addEventListener('touchend', () => { clearTimeout(longPressTimer); }, { passive: true });

    return wrap;
  }

  function showReactionPopup(msg, targetEl) {
    var existing = document.querySelector('.huginn-reaction-popup');
    if (existing) existing.remove();
    var existingOv = document.querySelector('.huginn-reaction-overlay');
    if (existingOv) existingOv.remove();

    var rect = targetEl.getBoundingClientRect();
    var popup = el('div', {
      className: 'huginn-reaction-popup',
      style: {
        position: 'fixed', top: Math.max(8, rect.top - 50) + 'px',
        left: '50%', transform: 'translateX(-50%)',
        background: t.surface || '#222', borderRadius: '24px',
        padding: '6px 8px', display: 'flex', gap: '4px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)', zIndex: 100,
        animation: 'asgard-react-pop 0.2s ease-out',
      },
    });

    var overlay = el('div', {
      className: 'huginn-reaction-overlay',
      style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 },
      onClick: () => { popup.remove(); overlay.remove(); },
    });

    QUICK_REACTIONS.forEach(em => {
      popup.appendChild(el('div', {
        style: { fontSize: '24px', padding: '4px 6px', cursor: 'pointer', borderRadius: '8px' },
        textContent: em,
        onClick: () => { toggleReaction(msg.id, em); popup.remove(); overlay.remove(); },
      }));
    });

    document.body.appendChild(overlay);
    document.body.appendChild(popup);
  }

  async function toggleReaction(msgId, emoji) {
    try {
      var resp = await API.fetch('/chat-groups/' + chatId + '/messages/' + msgId + '/reaction', { method: 'POST', body: { emoji: emoji } });
      var msg = messages.find(m => m.id === msgId);
      if (msg && resp.reactions) { msg.reactions = resp.reactions; rerenderMessages(); }
    } catch (_) {}
  }

  function appendDateSeparator(dateStr) {
    var sep = el('div', { style: { textAlign: 'center', padding: '12px 0 8px', ...DS.font('xs'), color: t.textTer || '#666' } });
    sep.appendChild(el('span', {
      style: { background: t.surface || '#1a1a1a', padding: '4px 12px', borderRadius: '10px' },
      textContent: _huginnDateLabel(dateStr),
    }));
    messagesWrap.appendChild(sep);
  }

  function appendMessage(msg, prev) {
    if (!prev || !_huginnSameDay(prev.created_at, msg.created_at)) appendDateSeparator(msg.created_at);
    messagesWrap.appendChild(createBubble(msg, prev));
  }

  function rerenderMessages() {
    messagesWrap.replaceChildren();
    messages.forEach((msg, i) => { appendMessage(msg, i > 0 ? messages[i - 1] : null); });
  }

  // ── Load initial messages ──
  try {
    messagesWrap.appendChild(M.Skeleton({ type: 'list', count: 4 }));
    var resp = await API.fetch('/chat-groups/' + chatId + '/messages?limit=50');
    var list = API.extractRows(resp);
    messagesWrap.replaceChildren();

    if (!list.length) {
      emptyStateEl = M.Empty({ text: 'Начните диалог' });
      messagesWrap.appendChild(emptyStateEl);
    } else {
      messages = list;
      lastMsgId = Math.max.apply(null, list.map(m => m.id));
      oldestMsgId = Math.min.apply(null, list.map(m => m.id));
      hasOlder = list.length >= 50;
      rerenderMessages();
      setTimeout(() => { messagesWrap.scrollTop = messagesWrap.scrollHeight; }, 50);
    }
  } catch (_) {
    messagesWrap.replaceChildren();
    messagesWrap.appendChild(M.ErrorBanner({ onRetry: () => Router.navigate('/messenger/' + chatId, { replace: true }) }));
  }

  // ── Load older messages ──
  async function loadOlderMessages() {
    if (loadingOlder || !hasOlder) return;
    loadingOlder = true;
    var prevScrollHeight = messagesWrap.scrollHeight;
    try {
      var resp = await API.fetch('/chat-groups/' + chatId + '/messages?limit=30&before_id=' + oldestMsgId);
      var older = API.extractRows(resp);
      if (older.length < 30) hasOlder = false;
      if (older.length) {
        oldestMsgId = Math.min.apply(null, older.map(m => m.id));
        messages = older.concat(messages);
        rerenderMessages();
        requestAnimationFrame(() => { messagesWrap.scrollTop = messagesWrap.scrollHeight - prevScrollHeight; });
      }
    } catch (_) {}
    loadingOlder = false;
  }

  // ── Polling: new messages ──
  async function pollNewMessages() {
    if (!page.isConnected) return;
    try {
      var resp = await API.fetch('/chat-groups/' + chatId + '/messages?limit=50&after_id=' + lastMsgId);
      var newMsgs = API.extractRows(resp);
      if (newMsgs.length) {
        var wasAtBottom = messagesWrap.scrollHeight - messagesWrap.scrollTop - messagesWrap.clientHeight < 100;
        if (emptyStateEl && emptyStateEl.parentNode) { emptyStateEl.remove(); emptyStateEl = null; }
        newMsgs.forEach(msg => {
          if (messages.find(m => m.id === msg.id)) return;
          messages.push(msg);
          appendMessage(msg, messages.length > 1 ? messages[messages.length - 2] : null);
        });
        lastMsgId = Math.max(lastMsgId, Math.max.apply(null, newMsgs.map(m => m.id)));
        if (wasAtBottom) messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: 'smooth' });
      }
    } catch (_) {}
  }

  // ── Polling: typing ──
  async function pollTyping() {
    if (!page.isConnected) return;
    try {
      var resp = await API.fetch('/chat-groups/' + chatId + '/typing');
      var typers = resp.typing || [];
      if (typers.length) {
        var names = typers.map(function(tp) { return tp.name || 'Кто-то'; }).join(', ');
        typingBar.textContent = names + (typers.length === 1 ? ' печатает...' : ' печатают...');
        typingBar.style.height = '24px';
        typingBar.style.padding = '4px var(--sp-page,16px)';
      } else {
        typingBar.style.height = '0';
        typingBar.style.padding = '0 var(--sp-page,16px)';
      }
    } catch (_) {}
  }

  // Start polling
  var _pollMsg = setInterval(() => {
    if (!page.isConnected) { clearInterval(_pollMsg); clearInterval(_pollTyp); return; }
    pollNewMessages();
  }, 3000);
  var _pollTyp = setInterval(() => {
    if (!page.isConnected) { clearInterval(_pollMsg); clearInterval(_pollTyp); return; }
    pollTyping();
  }, 2000);

  return page;
}

/* ═══════════════════════════════════════════
   ACTION SHEETS
   ═══════════════════════════════════════════ */
function chatActionsSheet(chatId) {
  M.ActionSheet({
    title: 'Действия',
    actions: [
      { icon: '🔇', label: 'Выключить уведомления', onClick: () => API.fetch('/chat-groups/' + chatId + '/mute', { method: 'PUT', body: { until: new Date(Date.now() + 365*86400000).toISOString() } }).then(() => M.Toast({ message: 'Уведомления выключены', type: 'info' })).catch(() => M.Toast({ message: 'Ошибка', type: 'error' })) },
      { icon: '👥', label: 'Участники', onClick: () => Router.navigate('/messenger/' + chatId + '?tab=members') },
      { icon: '📎', label: 'Файлы', onClick: () => Router.navigate('/messenger/' + chatId + '?tab=files') },
    ],
  });
}

function createChatSheet() {
  var content = Utils.el('div');
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
  M.BottomSheet({ title: 'Новый чат', content: content });
}

/* ═══════════════════════════════════════════
   ROUTER
   ═══════════════════════════════════════════ */
Router.register('/messenger', MessengerPage);
Router.register('/messenger/:id', { render: (p) => renderChat(p.id) });
if (typeof window !== 'undefined') window.MessengerPage = MessengerPage;
