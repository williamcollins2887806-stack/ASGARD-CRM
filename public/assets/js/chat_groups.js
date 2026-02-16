/**
 * ASGARD CRM — Групповые чаты (M3)
 *
 * Функционал:
 * - Список групповых чатов с превью последнего сообщения
 * - Создание чата
 * - Сообщения с ответами и реакциями
 * - Управление участниками
 * - Typing indicator
 * - Online status
 * - Auto-scroll to bottom
 * - Read receipts
 */
window.AsgardChatGroups = (function(){
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;

  let currentChatId = null;
  let pollingInterval = null;
  let _savedLayout = null;
  let _lastMessageCount = 0;
  let _replyToId = null;
  let _replyToText = '';
  let _replyToUser = '';

  // ═══════════════════════════════════════════════════════════════
  // API
  // ═══════════════════════════════════════════════════════════════

  const API = {
    async getChats(archived = false) {
      const res = await fetch(`/api/chat-groups?archived=${archived}`, {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      return res.json();
    },

    async getChat(id) {
      const res = await fetch(`/api/chat-groups/${id}`, {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      return res.json();
    },

    async createChat(data) {
      const res = await fetch('/api/chat-groups', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('asgard_token'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      return res.json();
    },

    async getMessages(chatId, beforeId = null) {
      const params = beforeId ? `?before_id=${beforeId}` : '';
      const res = await fetch(`/api/chat-groups/${chatId}/messages${params}`, {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      return res.json();
    },

    async sendMessage(chatId, text, replyToId = null) {
      const res = await fetch(`/api/chat-groups/${chatId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('asgard_token'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text, reply_to_id: replyToId })
      });
      return res.json();
    },

    async addMember(chatId, userId) {
      const res = await fetch(`/api/chat-groups/${chatId}/members`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('asgard_token'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ user_id: userId })
      });
      return res.json();
    },

    async leaveChat(chatId) {
      const auth = await AsgardAuth.getAuth();
      const res = await fetch(`/api/chat-groups/${chatId}/members/${auth.user.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      return res.json();
    },

    async muteChat(chatId, hours = 24) {
      const until = hours ? new Date(Date.now() + hours * 3600000).toISOString() : null;
      const res = await fetch(`/api/chat-groups/${chatId}/mute`, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('asgard_token'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ until })
      });
      return res.json();
    },

    async addReaction(chatId, messageId, emoji) {
      const res = await fetch(`/api/chat-groups/${chatId}/messages/${messageId}/reaction`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('asgard_token'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ emoji })
      });
      return res.json();
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  function formatChatTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const dayMs = 86400000;

    if (diff < dayMs && date.getDate() === now.getDate()) {
      return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    if (diff < 2 * dayMs) return 'вчера';
    if (diff < 7 * dayMs) {
      const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
      return days[date.getDay()];
    }
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  function getInitials(name) {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  function getAvatarColor(name) {
    if (!name) return '#888';
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  // ═══════════════════════════════════════════════════════════════
  // Render Main Page
  // ═══════════════════════════════════════════════════════════════

  async function render({ layout }) {
    if (layout) _savedLayout = layout;
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }

    stopPolling();

    const response = await API.getChats();
    const chats = response?.chats || [];

    const chatListHtml = chats.length > 0 ? chats.map(c => {
      const lastTime = formatChatTime(c.last_message_at || c.created_at);
      const memberText = c.member_count + ' участник' + (c.member_count === 1 ? '' : c.member_count < 5 ? 'а' : 'ов');
      return `
        <div class="chat-item ${currentChatId == c.id ? 'active' : ''}" onclick="AsgardChatGroups.openChat(${c.id})">
          <div class="chat-item-avatar group">
            <span class="chat-item-avatar-letter">${esc(c.name?.[0] || '?')}</span>
          </div>
          <div class="chat-item-info">
            <div class="chat-item-name">${esc(c.name)}</div>
            <div class="chat-item-preview">${esc(memberText)}</div>
          </div>
          <div class="chat-item-meta">
            <span class="chat-item-time">${lastTime}</span>
            ${c.unread_count > 0 ? `<span class="chat-item-unread">${c.unread_count}</span>` : ''}
          </div>
        </div>
      `;
    }).join('') : `
      <div class="chat-empty-state">
        <div class="chat-empty-icon">💬</div>
        <div class="chat-empty-title">Нет групповых чатов</div>
        <div class="chat-empty-desc">Создайте первый чат для команды</div>
        <button class="btn primary" onclick="AsgardChatGroups.showCreateModal()" style="margin-top: 12px;">+ Создать чат</button>
      </div>
    `;

    const html = `
      <div class="chat-container">
        <div class="chat-sidebar">
          <div class="chat-sidebar-header">
            <div class="chat-sidebar-title">
              <span class="chat-sidebar-icon">💬</span>
              Чаты
            </div>
            <button class="chat-create-btn" onclick="AsgardChatGroups.showCreateModal()" title="Создать чат">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
          <div class="chat-search-bar">
            <input type="text" class="chat-search-input" placeholder="Поиск чата..." oninput="AsgardChatGroups.filterChats(this.value)">
          </div>
          <div class="chat-list" id="chat-list-container">
            ${chatListHtml}
          </div>
        </div>
        <div class="chat-main" id="chat-main-area">
          <div class="chat-welcome">
            <div class="chat-welcome-icon">💬</div>
            <div class="chat-welcome-title">ASGARD Messenger</div>
            <div class="chat-welcome-desc">Выберите чат слева или создайте новый</div>
          </div>
        </div>
      </div>
    `;

    await layout(html, { title: 'Групповые чаты', motto: 'Командная коммуникация' });

    if (currentChatId) {
      await loadChatMessages(currentChatId);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Filter chats (search in sidebar)
  // ═══════════════════════════════════════════════════════════════

  function filterChats(query) {
    const items = $$('.chat-item');
    const q = (query || '').toLowerCase();
    items.forEach(item => {
      const name = item.querySelector('.chat-item-name');
      if (!q || (name && name.textContent.toLowerCase().includes(q))) {
        item.style.display = '';
      } else {
        item.style.display = 'none';
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Open Chat
  // ═══════════════════════════════════════════════════════════════

  async function openChat(chatId) {
    currentChatId = chatId;
    _replyToId = null;
    _replyToText = '';
    _replyToUser = '';
    await loadChatMessages(chatId);
    startPolling();
  }

  async function loadChatMessages(chatId) {
    const mainArea = $('#chat-main-area');
    if (!mainArea) return;

    const chatResp = await API.getChat(chatId);
    const chat = chatResp?.chat || {};
    const members = chatResp?.members || [];
    const myRole = chatResp?.myRole || 'member';
    const msgsResp = await API.getMessages(chatId);
    const messages = msgsResp?.messages || [];
    const auth = await AsgardAuth.getAuth();
    const userId = auth.user.id;

    // Check if new messages arrived (for smart scroll)
    const shouldScroll = messages.length !== _lastMessageCount;
    _lastMessageCount = messages.length;

    // Group messages by date
    const groupedMessages = groupMessagesByDate(messages);
    let messagesHtml = '';
    for (const [date, msgs] of Object.entries(groupedMessages)) {
      messagesHtml += `<div class="chat-date-divider"><span>${date}</span></div>`;
      messagesHtml += msgs.map(m => renderMessage(m, userId, members)).join('');
    }

    const memberCount = members.length;
    const onlineCount = members.filter(m => m.is_active).length;
    const memberText = memberCount + ' участник' + (memberCount === 1 ? '' : memberCount < 5 ? 'а' : 'ов');
    const statusText = `${memberText}, ${onlineCount} онлайн`;

    const replyBarHtml = _replyToId ? `
      <div class="chat-reply-bar" id="chat-reply-bar">
        <div class="chat-reply-bar-content">
          <div class="chat-reply-bar-name">${esc(_replyToUser)}</div>
          <div class="chat-reply-bar-text">${esc(_replyToText)}</div>
        </div>
        <button class="chat-reply-bar-close" onclick="AsgardChatGroups.cancelReply()">&times;</button>
      </div>
    ` : '';

    mainArea.innerHTML = `
      <div class="chat-header">
        <div class="chat-header-info">
          <div class="chat-header-avatar group">
            <span>${esc(chat.name?.[0] || '?')}</span>
          </div>
          <div class="chat-header-details">
            <div class="chat-header-title">${esc(chat.name)}</div>
            <div class="chat-header-status">
              <span class="chat-online-dot"></span>
              ${statusText}
            </div>
          </div>
        </div>
        <div class="chat-header-actions">
          <button class="chat-header-btn" onclick="AsgardChatGroups.showMembersModal(${chatId})" title="Участники">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </button>
          <button class="chat-header-btn" onclick="AsgardChatGroups.showSettingsModal(${chatId})" title="Настройки">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages-container">
        ${messagesHtml || `
          <div class="chat-no-messages">
            <div class="chat-no-messages-icon">🔒</div>
            <div class="chat-no-messages-text">Сообщения зашифрованы. Напишите первое сообщение!</div>
          </div>
        `}
        <div class="chat-typing-indicator" id="chat-typing" style="display: none;">
          <div class="chat-typing-dots">
            <span></span><span></span><span></span>
          </div>
          <span class="chat-typing-text">печатает...</span>
        </div>
      </div>
      ${replyBarHtml}
      <div class="chat-input-area">
        <button class="chat-emoji-btn" onclick="AsgardChatGroups.toggleEmojiPicker()" title="Emoji">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        </button>
        <textarea id="chat-message-input" class="chat-input" placeholder="Написать сообщение..." rows="1"
          onkeydown="AsgardChatGroups.handleKeyDown(event, ${chatId})"
          oninput="AsgardChatGroups.autoResizeInput(this)"></textarea>
        <button class="chat-send-btn" onclick="AsgardChatGroups.sendMessage(${chatId})" title="Отправить">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    `;

    // Scroll to bottom
    if (shouldScroll) {
      const container = $('#chat-messages-container');
      if (container) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    }

    // Update active state in sidebar
    $$('.chat-item').forEach(el => el.classList.remove('active'));
    const items = $$('.chat-item');
    items.forEach(el => {
      if (el.getAttribute('onclick')?.includes(chatId)) {
        el.classList.add('active');
      }
    });
  }

  function groupMessagesByDate(messages) {
    const groups = {};
    const now = new Date();
    const today = now.toDateString();
    const yesterday = new Date(now - 86400000).toDateString();

    for (const msg of messages) {
      const d = new Date(msg.created_at);
      const ds = d.toDateString();
      let label;
      if (ds === today) label = 'Сегодня';
      else if (ds === yesterday) label = 'Вчера';
      else label = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

      if (!groups[label]) groups[label] = [];
      groups[label].push(msg);
    }
    return groups;
  }

  function renderMessage(msg, currentUserId, members) {
    const isOwn = msg.user_id === currentUserId;
    const time = new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const initials = getInitials(msg.user_name);
    const avatarColor = getAvatarColor(msg.user_name);
    const messageText = msg.message || msg.text || '';

    const replyHtml = msg.reply_text ? `
      <div class="chat-msg-reply">
        <div class="chat-msg-reply-name">${esc(msg.reply_user_name || '')}</div>
        <div class="chat-msg-reply-text">${esc(msg.reply_text.substring(0, 80))}${msg.reply_text.length > 80 ? '...' : ''}</div>
      </div>
    ` : '';

    const reactionsHtml = msg.reactions && Object.keys(msg.reactions).length > 0
      ? `<div class="chat-msg-reactions">${Object.entries(msg.reactions).map(([emoji, users]) => `
          <span class="chat-msg-reaction ${users.includes(currentUserId) ? 'active' : ''}" onclick="AsgardChatGroups.react(${currentChatId}, ${msg.id}, '${emoji}')">${emoji} ${users.length}</span>
        `).join('')}</div>`
      : '';

    // Read receipts for own messages
    const readHtml = isOwn ? `<span class="chat-msg-read" title="Доставлено">✓✓</span>` : '';

    return `
      <div class="chat-message ${isOwn ? 'own' : ''}" data-msg-id="${msg.id}">
        ${!isOwn ? `<div class="chat-message-avatar" style="background: ${avatarColor};">${initials}</div>` : ''}
        <div class="chat-message-bubble">
          ${!isOwn ? `<div class="chat-message-sender" style="color: ${avatarColor};">${esc(msg.user_name)}</div>` : ''}
          ${replyHtml}
          <div class="chat-message-text">${esc(messageText)}</div>
          <div class="chat-message-footer">
            <span class="chat-message-time">${time}${msg.edited_at ? ' (изм.)' : ''}</span>
            ${readHtml}
          </div>
          ${reactionsHtml}
        </div>
        <div class="chat-msg-actions">
          <button class="chat-msg-action-btn" onclick="AsgardChatGroups.setReply(${msg.id}, '${esc(msg.user_name)}', '${esc((messageText).substring(0,50).replace(/'/g, "\\'"))}')" title="Ответить">↩</button>
          <button class="chat-msg-action-btn" onclick="AsgardChatGroups.showReactionPicker(${msg.id})" title="Реакция">☺</button>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════════
  // Reply handling
  // ═══════════════════════════════════════════════════════════════

  function setReply(messageId, userName, text) {
    _replyToId = messageId;
    _replyToUser = userName;
    _replyToText = text;
    // Re-render input area with reply bar
    const inputArea = $('.chat-input-area');
    if (!inputArea) return;
    let replyBar = $('#chat-reply-bar');
    if (replyBar) replyBar.remove();
    const bar = document.createElement('div');
    bar.className = 'chat-reply-bar';
    bar.id = 'chat-reply-bar';
    bar.innerHTML = `
      <div class="chat-reply-bar-content">
        <div class="chat-reply-bar-name">${esc(userName)}</div>
        <div class="chat-reply-bar-text">${esc(text)}</div>
      </div>
      <button class="chat-reply-bar-close" onclick="AsgardChatGroups.cancelReply()">&times;</button>
    `;
    inputArea.parentNode.insertBefore(bar, inputArea);
    const input = $('#chat-message-input');
    if (input) input.focus();
  }

  function cancelReply() {
    _replyToId = null;
    _replyToText = '';
    _replyToUser = '';
    const bar = $('#chat-reply-bar');
    if (bar) bar.remove();
  }

  function showReactionPicker(messageId) {
    const emojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉'];
    const picker = document.createElement('div');
    picker.className = 'chat-reaction-picker';
    picker.innerHTML = emojis.map(e =>
      `<span class="chat-reaction-option" onclick="AsgardChatGroups.react(${currentChatId}, ${messageId}, '${e}'); this.parentNode.remove();">${e}</span>`
    ).join('');

    const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (msgEl) {
      // Remove any existing pickers
      const old = document.querySelector('.chat-reaction-picker');
      if (old) old.remove();
      msgEl.querySelector('.chat-message-bubble').appendChild(picker);
      setTimeout(() => { picker.remove(); }, 5000);
    }
  }

  function toggleEmojiPicker() {
    const emojis = ['😀', '😂', '😍', '🤔', '👍', '👎', '❤️', '🔥', '🎉', '👏', '😢', '😮', '💪', '🙏', '✅', '❌'];
    let picker = $('#chat-emoji-picker');
    if (picker) { picker.remove(); return; }
    picker = document.createElement('div');
    picker.id = 'chat-emoji-picker';
    picker.className = 'chat-emoji-picker-panel';
    picker.innerHTML = emojis.map(e =>
      `<span class="chat-emoji-option" onclick="AsgardChatGroups.insertEmoji('${e}')">${e}</span>`
    ).join('');
    const inputArea = $('.chat-input-area');
    if (inputArea) inputArea.parentNode.insertBefore(picker, inputArea);
  }

  function insertEmoji(emoji) {
    const input = $('#chat-message-input');
    if (input) {
      input.value += emoji;
      input.focus();
    }
    const picker = $('#chat-emoji-picker');
    if (picker) picker.remove();
  }

  // ═══════════════════════════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════════════════════════

  function handleKeyDown(event, chatId) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage(chatId);
    }
  }

  function autoResizeInput(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  async function sendMessage(chatId) {
    const input = $('#chat-message-input');
    const text = input?.value?.trim();
    if (!text) return;

    const sendBtn = $('.chat-send-btn');
    if (sendBtn) sendBtn.classList.add('sending');

    try {
      await API.sendMessage(chatId, text, _replyToId);
      input.value = '';
      input.style.height = 'auto';
      cancelReply();
      await loadChatMessages(chatId);
    } catch (e) {
      toast('Ошибка отправки', 'error');
    } finally {
      if (sendBtn) sendBtn.classList.remove('sending');
    }
  }

  async function react(chatId, messageId, emoji) {
    try {
      await API.addReaction(chatId, messageId, emoji);
      await loadChatMessages(chatId);
    } catch (e) {
      toast('Ошибка', 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Modals
  // ═══════════════════════════════════════════════════════════════

  async function showCreateModal() {
    const users = await AsgardDB.getAll('users') || [];
    const activeUsers = users.filter(u => u.is_active);

    const html = `
      <div style="min-width: 420px; max-width: 520px;">
        <div class="form-group">
          <label>Название чата *</label>
          <input type="text" id="new-chat-name" class="input" placeholder="Например: Проект Альфа" autofocus>
        </div>
        <div class="form-group">
          <label>Описание</label>
          <textarea id="new-chat-desc" class="input" rows="2" placeholder="Краткое описание группы..."></textarea>
        </div>
        <div class="form-group">
          <label>Участники (${activeUsers.length} доступно)</label>
          <div class="chat-member-picker">
            ${activeUsers.length > 0 ? activeUsers.map(u => `
              <label class="chat-member-option">
                <input type="checkbox" name="chat-members" value="${u.id}">
                <div class="chat-member-option-avatar" style="background: ${getAvatarColor(u.name)};">${getInitials(u.name)}</div>
                <div class="chat-member-option-info">
                  <span class="chat-member-option-name">${esc(u.name)}</span>
                  <span class="chat-member-option-role">${esc(u.role || '')}</span>
                </div>
              </label>
            `).join('') : '<div class="text-muted" style="padding: 12px;">Нет доступных пользователей</div>'}
          </div>
        </div>
        <div class="row between mt-4">
          <button class="btn" onclick="AsgardUI.closeModal()">Отмена</button>
          <button class="btn primary" onclick="AsgardChatGroups.createChat()">Создать чат</button>
        </div>
      </div>
    `;

    showModal('Создать групповой чат', html);
  }

  async function createChat() {
    const name = $('#new-chat-name')?.value?.trim();
    const description = $('#new-chat-desc')?.value?.trim();
    const memberCheckboxes = $$('input[name="chat-members"]:checked');
    const memberIds = Array.from(memberCheckboxes).map(cb => parseInt(cb.value));

    if (!name) {
      toast('Укажите название чата', 'error');
      return;
    }

    try {
      const result = await API.createChat({ name, description, member_ids: memberIds });
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('Чат создан', 'success');
      closeModal();
      if (result.chat?.id) {
        currentChatId = result.chat.id;
      }
      await refresh();
    } catch (e) {
      toast('Ошибка создания чата', 'error');
    }
  }

  async function showMembersModal(chatId) {
    const chatResp = await API.getChat(chatId);
    const members = chatResp?.members || [];
    const myRole = chatResp?.myRole || 'member';
    const users = await AsgardDB.getAll('users') || [];
    const memberIds = new Set(members.map(m => m.user_id));
    const availableUsers = users.filter(u => u.is_active && !memberIds.has(u.id));

    const membersHtml = members.map(m => `
      <div class="chat-member-row">
        <div class="chat-member-row-left">
          <div class="chat-member-row-avatar" style="background: ${getAvatarColor(m.name)};">
            ${getInitials(m.name)}
            ${m.is_active ? '<span class="chat-member-online-dot"></span>' : ''}
          </div>
          <div class="chat-member-row-info">
            <div class="chat-member-row-name">${esc(m.name)}</div>
            <div class="chat-member-row-role">${m.role === 'owner' ? 'Владелец' : m.role === 'admin' ? 'Админ' : 'Участник'}</div>
          </div>
        </div>
      </div>
    `).join('');

    const addUserHtml = (myRole === 'owner' || myRole === 'admin') && availableUsers.length > 0 ? `
      <div class="mt-3">
        <label>Добавить участника:</label>
        <div class="row" style="gap: 8px; margin-top: 8px;">
          <select id="add-member-select" class="input" style="flex: 1;">
            ${availableUsers.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}
          </select>
          <button class="btn primary" onclick="AsgardChatGroups.addMember(${chatId})">Добавить</button>
        </div>
      </div>
    ` : '';

    const html = `
      <div style="min-width: 380px;">
        <div style="max-height: 350px; overflow-y: auto;">
          ${membersHtml}
        </div>
        ${addUserHtml}
        <div class="row between mt-4">
          <button class="btn" style="color: var(--error);" onclick="AsgardChatGroups.leaveChat(${chatId})">Покинуть чат</button>
          <button class="btn" onclick="AsgardUI.closeModal()">Закрыть</button>
        </div>
      </div>
    `;

    showModal('Участники чата', html);
  }

  async function addMember(chatId) {
    const select = $('#add-member-select');
    const userId = select?.value;
    if (!userId) return;

    try {
      const result = await API.addMember(chatId, parseInt(userId));
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('Участник добавлен', 'success');
      await showMembersModal(chatId);
    } catch (e) {
      toast('Ошибка', 'error');
    }
  }

  async function leaveChat(chatId) {
    if (!confirm('Вы уверены, что хотите покинуть чат?')) return;

    try {
      await API.leaveChat(chatId);
      toast('Вы покинули чат', 'success');
      closeModal();
      currentChatId = null;
      await refresh();
    } catch (e) {
      toast('Ошибка', 'error');
    }
  }

  async function showSettingsModal(chatId) {
    const html = `
      <div style="min-width: 320px;">
        <div class="form-group">
          <label>Уведомления</label>
          <div class="row" style="gap: 8px; flex-wrap: wrap;">
            <button class="btn" onclick="AsgardChatGroups.muteChat(${chatId}, 0)">Включить</button>
            <button class="btn" onclick="AsgardChatGroups.muteChat(${chatId}, 24)">Выкл. на 24ч</button>
            <button class="btn" onclick="AsgardChatGroups.muteChat(${chatId}, 168)">Выкл. на неделю</button>
          </div>
        </div>
        <div class="row between mt-4">
          <button class="btn" onclick="AsgardUI.closeModal()">Закрыть</button>
        </div>
      </div>
    `;

    showModal('Настройки чата', html);
  }

  async function muteChat(chatId, hours) {
    try {
      await API.muteChat(chatId, hours);
      toast(hours > 0 ? 'Уведомления отключены' : 'Уведомления включены', 'success');
      closeModal();
    } catch (e) {
      toast('Ошибка', 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Polling
  // ═══════════════════════════════════════════════════════════════

  function startPolling() {
    stopPolling();
    pollingInterval = setInterval(async () => {
      if (currentChatId) {
        await loadChatMessages(currentChatId);
      }
    }, 5000);
  }

  function stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  async function refresh() {
    await render({ layout: _savedLayout });
  }

  // Cleanup polling on navigation (hashchange)
  window.addEventListener('hashchange', () => {
    if (!location.hash.includes('/chat-groups')) stopPolling();
  });

  // ═══════════════════════════════════════════════════════════════
  // Export
  // ═══════════════════════════════════════════════════════════════

  return {
    render,
    refresh,
    openChat,
    sendMessage,
    handleKeyDown,
    autoResizeInput,
    react,
    showCreateModal,
    createChat,
    showMembersModal,
    addMember,
    leaveChat,
    showSettingsModal,
    muteChat,
    filterChats,
    setReply,
    cancelReply,
    showReactionPicker,
    toggleEmojiPicker,
    insertEmoji
  };
})();
