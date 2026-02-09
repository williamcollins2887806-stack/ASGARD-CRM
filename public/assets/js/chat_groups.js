/**
 * ASGARD CRM — Групповые чаты (M3)
 *
 * Функционал:
 * - Список групповых чатов
 * - Создание чата
 * - Сообщения с ответами и реакциями
 * - Управление участниками
 */
window.AsgardChatGroups = (function(){
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;

  let currentChatId = null;
  let pollingInterval = null;
  let _savedLayout = null;

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
      const auth = await AsgardAuth.get();
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
  // Render Main Page
  // ═══════════════════════════════════════════════════════════════

  async function render({ layout }) {
    if (layout) _savedLayout = layout;
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }

    stopPolling();

    const response = await API.getChats();
    const chats = response?.chats || [];

    const chatListHtml = chats.length > 0 ? chats.map(c => `
      <div class="chat-item ${currentChatId == c.id ? 'active' : ''}" onclick="AsgardChatGroups.openChat(${c.id})">
        <div class="chat-item-avatar group">${c.name?.[0] || '?'}</div>
        <div class="chat-item-info">
          <div class="chat-item-name">${esc(c.name)}</div>
          <div class="chat-item-preview">${c.member_count} участников</div>
        </div>
        <div class="chat-item-meta">
          ${c.unread_count > 0 ? `<span class="chat-item-unread">${c.unread_count}</span>` : ''}
        </div>
      </div>
    `).join('') : '<div class="widget-empty"><span class="widget-empty-text">Нет групповых чатов</span></div>';

    const html = `
      <div class="chat-container">
        <div class="chat-sidebar">
          <div class="chat-sidebar-header">
            <h3>💬 Групповые чаты</h3>
            <button class="btn btn-sm" onclick="AsgardChatGroups.showCreateModal()">+ Создать</button>
          </div>
          <div class="chat-list">
            ${chatListHtml}
          </div>
        </div>
        <div class="chat-main" id="chat-main-area">
          <div class="widget-empty" style="height: 100%; display: flex;">
            <span class="widget-empty-icon">💬</span>
            <span class="widget-empty-text">Выберите чат слева</span>
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
  // Open Chat
  // ═══════════════════════════════════════════════════════════════

  async function openChat(chatId) {
    currentChatId = chatId;
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
    const auth = await AsgardAuth.get();
    const userId = auth.user.id;

    const messagesHtml = messages.map(m => renderMessage(m, userId)).join('');

    mainArea.innerHTML = `
      <div class="chat-header">
        <div class="chat-header-info">
          <div class="chat-item-avatar group">${chat.name?.[0] || '?'}</div>
          <div>
            <div class="chat-header-title">${esc(chat.name)}</div>
            <div class="chat-header-status">${members.length} участников</div>
          </div>
        </div>
        <div class="row">
          <button class="btn btn-sm" onclick="AsgardChatGroups.showMembersModal(${chatId})">👥 Участники</button>
          <button class="btn btn-sm" onclick="AsgardChatGroups.showSettingsModal(${chatId})">⚙️</button>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages-container">
        ${messagesHtml || '<div class="widget-empty"><span class="widget-empty-text">Нет сообщений</span></div>'}
      </div>
      <div class="chat-input-area">
        <textarea id="chat-message-input" class="chat-input" placeholder="Написать сообщение..." rows="1" onkeydown="AsgardChatGroups.handleKeyDown(event, ${chatId})"></textarea>
        <button class="btn primary" onclick="AsgardChatGroups.sendMessage(${chatId})">➤</button>
      </div>
    `;

    // Scroll to bottom
    const container = $('#chat-messages-container');
    if (container) container.scrollTop = container.scrollHeight;

    // Update active state in sidebar
    $$('.chat-item').forEach(el => el.classList.remove('active'));
    const activeItem = $(`.chat-item[onclick*="${chatId}"]`);
    if (activeItem) activeItem.classList.add('active');
  }

  function renderMessage(msg, currentUserId) {
    const isOwn = msg.user_id === currentUserId;
    const time = new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const initials = msg.user_name?.split(' ').map(n => n[0]).join('').substring(0, 2) || '??';

    const replyHtml = msg.reply_text ? `
      <div class="text-muted text-sm mb-1" style="border-left: 2px solid var(--gold); padding-left: 8px;">
        ↩️ ${esc(msg.reply_user_name)}: ${esc(msg.reply_text.substring(0, 50))}...
      </div>
    ` : '';

    const reactionsHtml = msg.reactions && Object.keys(msg.reactions).length > 0
      ? Object.entries(msg.reactions).map(([emoji, users]) => `
          <span class="kanban-tag" style="cursor: pointer;" onclick="AsgardChatGroups.react(${currentChatId}, ${msg.id}, '${emoji}')">${emoji} ${users.length}</span>
        `).join('')
      : '';

    return `
      <div class="chat-message ${isOwn ? 'own' : ''}">
        ${!isOwn ? `<div class="chat-message-avatar">${initials}</div>` : ''}
        <div class="chat-message-bubble">
          ${!isOwn ? `<div class="chat-message-sender">${esc(msg.user_name)}</div>` : ''}
          ${replyHtml}
          <div class="chat-message-text">${esc(msg.text)}</div>
          <div class="chat-message-time">${time} ${msg.edited_at ? '(изм.)' : ''}</div>
          ${reactionsHtml ? `<div class="kanban-card-tags mt-1">${reactionsHtml}</div>` : ''}
        </div>
      </div>
    `;
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

  async function sendMessage(chatId) {
    const input = $('#chat-message-input');
    const text = input?.value?.trim();
    if (!text) return;

    try {
      await API.sendMessage(chatId, text);
      input.value = '';
      await loadChatMessages(chatId);
    } catch (e) {
      toast('Ошибка отправки', 'error');
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
      <div style="min-width: 400px;">
        <div class="form-group">
          <label>Название чата *</label>
          <input type="text" id="new-chat-name" class="input" placeholder="Например: Проект Альфа">
        </div>
        <div class="form-group">
          <label>Описание</label>
          <textarea id="new-chat-desc" class="input" rows="2" placeholder="Краткое описание..."></textarea>
        </div>
        <div class="form-group">
          <label>Участники</label>
          <div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--sp-2);">
            ${activeUsers.map(u => `
              <label class="row" style="padding: 4px 0;">
                <input type="checkbox" name="chat-members" value="${u.id}">
                <span>${esc(u.name)} (${u.role})</span>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="row between mt-4">
          <button class="btn" onclick="AsgardUI.closeModal()">Отмена</button>
          <button class="btn primary" onclick="AsgardChatGroups.createChat()">Создать чат</button>
        </div>
      </div>
    `;

    showModal(html, { title: '➕ Создать групповой чат' });
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
      await API.createChat({ name, description, member_ids: memberIds });
      toast('Чат создан', 'success');
      closeModal();
      await refresh();
    } catch (e) {
      toast('Ошибка создания', 'error');
    }
  }

  async function showMembersModal(chatId) {
    const { members, myRole } = await API.getChat(chatId);
    const users = await AsgardDB.getAll('users') || [];
    const memberIds = new Set(members.map(m => m.user_id));
    const availableUsers = users.filter(u => u.is_active && !memberIds.has(u.id));

    const membersHtml = members.map(m => `
      <div class="row between" style="padding: 8px 0; border-bottom: 1px solid var(--border);">
        <div class="row">
          <div class="chat-item-avatar" style="width: 32px; height: 32px; font-size: 12px;">${m.name?.[0] || '?'}</div>
          <div>
            <div>${esc(m.name)}</div>
            <div class="text-muted text-xs">${m.role === 'owner' ? '👑 Владелец' : m.role === 'admin' ? '⚙️ Админ' : '👤 Участник'}</div>
          </div>
        </div>
      </div>
    `).join('');

    const addUserHtml = (myRole === 'owner' || myRole === 'admin') && availableUsers.length > 0 ? `
      <div class="mt-3">
        <label>Добавить участника:</label>
        <div class="row">
          <select id="add-member-select" class="input" style="flex: 1;">
            ${availableUsers.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}
          </select>
          <button class="btn" onclick="AsgardChatGroups.addMember(${chatId})">Добавить</button>
        </div>
      </div>
    ` : '';

    const html = `
      <div style="min-width: 350px;">
        <div style="max-height: 300px; overflow-y: auto;">
          ${membersHtml}
        </div>
        ${addUserHtml}
        <div class="row between mt-4">
          <button class="btn text-red" onclick="AsgardChatGroups.leaveChat(${chatId})">🚪 Покинуть чат</button>
          <button class="btn" onclick="AsgardUI.closeModal()">Закрыть</button>
        </div>
      </div>
    `;

    showModal(html, { title: '👥 Участники чата' });
  }

  async function addMember(chatId) {
    const select = $('#add-member-select');
    const userId = select?.value;
    if (!userId) return;

    try {
      await API.addMember(chatId, parseInt(userId));
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
      <div style="min-width: 300px;">
        <div class="form-group">
          <label>Уведомления</label>
          <div class="row">
            <button class="btn" onclick="AsgardChatGroups.muteChat(${chatId}, 0)">🔔 Включить</button>
            <button class="btn" onclick="AsgardChatGroups.muteChat(${chatId}, 24)">🔕 На 24ч</button>
            <button class="btn" onclick="AsgardChatGroups.muteChat(${chatId}, 168)">🔕 На неделю</button>
          </div>
        </div>
        <div class="row between mt-4">
          <button class="btn" onclick="AsgardUI.closeModal()">Закрыть</button>
        </div>
      </div>
    `;

    showModal(html, { title: '⚙️ Настройки чата' });
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

  // Очистка polling при навигации (hashchange)
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
    react,
    showCreateModal,
    createChat,
    showMembersModal,
    addMember,
    leaveChat,
    showSettingsModal,
    muteChat
  };
})();
