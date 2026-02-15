/**
 * АСГАРД CRM — Чат сотрудников
 * ИСПРАВЛЕНО: ID теперь auto-increment, не строка
 */
window.AsgardChat = (function(){

  const CHAT_TYPES = {
    general: { name: 'Общий чат', icon: '💬', color: 'var(--blue)' },
    direct: { name: 'Личное сообщение', icon: '👤', color: 'var(--green)' },
    tender: { name: 'Тендер', icon: '📋', color: 'var(--amber)' },
    work: { name: 'Работа', icon: '🔧', color: 'var(--purple)' },
    bonus: { name: 'Согласование премии', icon: '💰', color: 'var(--gold)' },
    estimate: { name: 'Просчёт', icon: '📊', color: 'var(--cyan)' }
  };

  // CRUD для сообщений
  async function getMessages(chatType, chatId = null, limit = 50) {
    try {
      let all = await AsgardDB.getAll('chat_messages') || [];

      all = all.filter(m => {
        if (chatType === 'general') return m.chat_type === 'general';
        if (chatType === 'direct') return m.chat_type === 'direct' && (m.chat_id === chatId || m.to_user_id === chatId);
        return m.chat_type === chatType && m.entity_id === chatId;
      });

      all.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      return all.slice(-limit);
    } catch(e) {
      return [];
    }
  }

  async function sendMessage(data) {
    // ИСПРАВЛЕНИЕ: НЕ передаём id - БД сгенерирует автоматически
    const message = {
      chat_type: data.chat_type || 'general',
      entity_id: data.entity_id || null,
      entity_title: data.entity_title || null,
      chat_id: data.chat_id || null,
      to_user_id: data.to_user_id || null,
      user_id: data.user_id,
      user_name: data.user_name,
      user_role: data.user_role,
      text: data.text,
      attachments: JSON.stringify(data.attachments || []),
      mentions: JSON.stringify(extractMentions(data.text)),
      is_system: data.is_system || false,
      is_read: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    try {
      // Используем add вместо put - для создания новой записи с auto-id
      const result = await AsgardDB.add('chat_messages', message);
      message.id = result.id || result;

      if (message.mentions && message.mentions.length > 0) {
        await notifyMentions(message);
      }

      if (message.chat_type === 'direct' && message.to_user_id) {
        await notifyDirectMessage(message);
      }

      return message;
    } catch(e) {
      console.error('Error sending message:', e);
      return null;
    }
  }

  function extractMentions(text) {
    const matches = text.match(/@(\w+)/g) || [];
    return matches.map(m => m.slice(1));
  }

  async function notifyMentions(message) {
    const users = await AsgardDB.getAll('users') || [];
    const auth = await AsgardAuth.getAuth();
    
    let mentions = message.mentions;
    if (typeof mentions === 'string') {
      try { mentions = JSON.parse(mentions); } catch(e) { mentions = []; }
    }

    for (const username of mentions) {
      const user = users.find(u =>
        u.login?.toLowerCase() === username.toLowerCase() ||
        u.name?.toLowerCase().includes(username.toLowerCase())
      );

      if (user && user.id !== message.user_id) {
        try {
          await AsgardDB.add('notifications', {
            user_id: user.id,
            title: '💬 Вас упомянули в чате',
            message: `${message.user_name}: ${message.text.slice(0, 100)}...`,
            type: 'chat_mention',
            entity_id: message.id,
            is_read: false,
            created_at: new Date().toISOString()
          });

          if (auth?.token) {
            fetch('/api/notifications/approval', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + auth.token
              },
              body: JSON.stringify({
                type: 'chat_message',
                action: 'mention',
                entityId: message.id,
                toUserId: user.id,
                details: `Вас упомянул ${message.user_name}:\n${message.text.slice(0, 150)}`
              })
            }).catch(() => {});
          }
        } catch(e) {}
      }
    }
  }

  async function notifyDirectMessage(message) {
    try {
      await AsgardDB.add('notifications', {
        user_id: message.to_user_id,
        title: '💬 Новое сообщение',
        message: `${message.user_name}: ${message.text.slice(0, 100)}`,
        type: 'chat_direct',
        entity_id: message.id,
        is_read: false,
        created_at: new Date().toISOString()
      });

      const auth = await AsgardAuth.getAuth();
      if (auth?.token) {
        fetch('/api/notifications/approval', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + auth.token
          },
          body: JSON.stringify({
            type: 'chat_message',
            action: 'direct',
            entityId: message.id,
            toUserId: message.to_user_id,
            details: `Сообщение от ${message.user_name}:\n${message.text.slice(0, 150)}`
          })
        }).catch(() => {});
      }
    } catch(e) {}
  }

  async function markAsRead(messageId) {
    try {
      const msg = await AsgardDB.get('chat_messages', messageId);
      if (msg && !msg.is_read) {
        msg.is_read = true;
        msg.updated_at = new Date().toISOString();
        await AsgardDB.put('chat_messages', msg);
      }
    } catch(e) {}
  }

  async function getUnreadCount(userId) {
    try {
      const all = await AsgardDB.getAll('chat_messages') || [];
      return all.filter(m => 
        !m.is_read && 
        m.user_id !== userId &&
        (m.chat_type === 'general' || m.to_user_id === userId)
      ).length;
    } catch(e) {
      return 0;
    }
  }

  // UI чата
  async function openChatModal(type = 'general', entityId = null, entityTitle = null) {
    const auth = await AsgardAuth.getAuth();
    if (!auth?.user) {
      AsgardUI.toast('Ошибка', 'Требуется авторизация', 'err');
      return;
    }

    const user = auth.user;
    const chatInfo = CHAT_TYPES[type] || CHAT_TYPES.general;
    const title = entityTitle ? `${chatInfo.icon} ${entityTitle}` : `${chatInfo.icon} ${chatInfo.name}`;

    const html = `
      <div class="chat-container" style="height:450px;display:flex;flex-direction:column">
        <div class="chat-messages" id="chatMessages" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px"></div>
        <div style="padding:12px;border-top:1px solid var(--line);display:flex;gap:8px">
          <input type="text" id="chatInput" class="inp" placeholder="Введите сообщение..." style="flex:1" />
          <button class="btn primary" id="chatSend">➤</button>
        </div>
      </div>
    `;

    AsgardUI.showModal(title, html, { width: '500px' });

    const messagesEl = document.getElementById('chatMessages');
    const inputEl = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSend');

    // Загрузка сообщений
    async function loadMessages() {
      const messages = await getMessages(type, entityId);
      messagesEl.innerHTML = messages.map(m => {
        const isOwn = m.user_id === user.id;
        const time = new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        return `
          <div style="align-self:${isOwn ? 'flex-end' : 'flex-start'};max-width:80%">
            <div style="background:${isOwn ? 'var(--secondary)' : 'var(--bg-elevated)'};color:${isOwn ? '#fff' : 'var(--text-primary)'};padding:8px 12px;border-radius:12px">
              ${!isOwn ? `<div style="font-size:12px;font-weight:600;margin-bottom:4px">${AsgardUI.esc(m.user_name || 'Аноним')}</div>` : ''}
              <div>${AsgardUI.esc(m.text || '')}</div>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;text-align:${isOwn ? 'right' : 'left'}">${time}</div>
          </div>
        `;
      }).join('');
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    await loadMessages();

    // Отправка
    async function send() {
      const text = inputEl.value.trim();
      if (!text) return;

      inputEl.value = '';
      inputEl.disabled = true;
      sendBtn.disabled = true;

      const result = await sendMessage({
        chat_type: type,
        entity_id: entityId,
        entity_title: entityTitle,
        user_id: user.id,
        user_name: user.name || user.login,
        user_role: user.role,
        text: text
      });

      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();

      if (result) {
        await loadMessages();
      } else {
        AsgardUI.toast('Ошибка', 'Не удалось отправить сообщение', 'err');
      }
    }

    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') send();
    });

    inputEl.focus();

    // Автообновление
    const interval = setInterval(loadMessages, 5000);
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) clearInterval(interval);
      });
    }
  }

  // Страница чата
  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) return;

    const user = auth.user;
    const users = await AsgardDB.getAll('users') || [];
    const otherUsers = users.filter(u => u.id !== user.id);

    const html = `
      <div class="grid" style="grid-template-columns:250px 1fr;gap:20px;height:calc(100vh - 200px)">
        <!-- Список чатов -->
        <div class="card" style="overflow-y:auto">
          <div style="padding:12px;border-bottom:1px solid var(--line)">
            <h4 style="margin:0">💬 Чаты</h4>
          </div>
          <div id="chatList" style="padding:8px"></div>
        </div>
        
        <!-- Окно чата -->
        <div class="card" style="display:flex;flex-direction:column">
          <div id="chatHeader" style="padding:12px;border-bottom:1px solid var(--line)">
            <h4 style="margin:0">Выберите чат</h4>
          </div>
          <div id="chatArea" style="flex:1;display:flex;flex-direction:column">
            <div class="chat-messages" id="chatMessages" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px">
              <div class="help" style="text-align:center;margin-top:50px">Выберите чат слева</div>
            </div>
            <div style="padding:12px;border-top:1px solid var(--line);display:none" id="chatInputArea">
              <div style="display:flex;gap:8px">
                <input type="text" id="chatInput" class="inp" placeholder="Введите сообщение..." style="flex:1" />
                <button class="btn primary" id="chatSend">➤</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    await layout(`<div class="content">${html}</div>`, { title, motto: "Слово воина — закон." });

    const chatList = document.getElementById('chatList');
    const chatHeader = document.getElementById('chatHeader');
    const chatMessages = document.getElementById('chatMessages');
    const chatInputArea = document.getElementById('chatInputArea');
    const chatInput = document.getElementById('chatInput');
    const chatSend = document.getElementById('chatSend');

    let currentChat = null;
    let refreshInterval = null;

    // Рендер списка чатов
    function renderChatList() {
      chatList.innerHTML = `
        <div class="chat-item ${currentChat?.type === 'general' ? 'active' : ''}" data-type="general" style="padding:10px;cursor:pointer;border-radius:8px;margin-bottom:4px;background:${currentChat?.type === 'general' ? 'var(--primary-glow)' : 'transparent'}">
          <span style="font-size:18px">💬</span> Общий чат
        </div>
        <div style="padding:8px 10px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--line);margin:8px 0">Личные сообщения</div>
        ${otherUsers.map(u => `
          <div class="chat-item ${currentChat?.type === 'direct' && currentChat?.id === u.id ? 'active' : ''}" data-type="direct" data-id="${u.id}" style="padding:10px;cursor:pointer;border-radius:8px;margin-bottom:4px;background:${currentChat?.type === 'direct' && currentChat?.id === u.id ? 'var(--primary-glow)' : 'transparent'}">
            <span style="font-size:18px">👤</span> ${AsgardUI.esc(u.name || u.login)}
          </div>
        `).join('')}
      `;

      chatList.querySelectorAll('.chat-item').forEach(el => {
        el.addEventListener('click', () => {
          const type = el.dataset.type;
          const id = el.dataset.id ? parseInt(el.dataset.id) : null;
          openChat(type, id);
        });
      });
    }

    // Открытие чата
    async function openChat(type, id = null) {
      currentChat = { type, id };
      renderChatList();

      const chatInfo = CHAT_TYPES[type];
      let chatTitle = chatInfo.name;
      if (type === 'direct' && id) {
        const targetUser = users.find(u => u.id === id);
        chatTitle = targetUser ? (targetUser.name || targetUser.login) : 'Личные сообщения';
      }

      chatHeader.innerHTML = `<h4 style="margin:0">${chatInfo.icon} ${AsgardUI.esc(chatTitle)}</h4>`;
      chatInputArea.style.display = 'block';

      await loadMessages();

      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = setInterval(loadMessages, 5000);
    }

    // Загрузка сообщений
    async function loadMessages() {
      if (!currentChat) return;

      const messages = await getMessages(currentChat.type, currentChat.id);
      chatMessages.innerHTML = messages.length === 0 
        ? '<div class="asg-empty" style="margin-top:50px"><div class="asg-empty-icon">💬</div><div class="asg-empty-text">Сообщений пока нет</div></div>'
        : messages.map(m => {
            const isOwn = m.user_id === user.id;
            const time = new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            return `
              <div style="align-self:${isOwn ? 'flex-end' : 'flex-start'};max-width:80%">
                <div style="background:${isOwn ? 'var(--secondary)' : 'var(--bg-elevated)'};color:${isOwn ? '#fff' : 'var(--text-primary)'};padding:8px 12px;border-radius:12px">
                  ${!isOwn ? `<div style="font-size:12px;font-weight:600;margin-bottom:4px">${AsgardUI.esc(m.user_name || 'Аноним')}</div>` : ''}
                  <div>${AsgardUI.esc(m.text || '')}</div>
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;text-align:${isOwn ? 'right' : 'left'}">${time}</div>
              </div>
            `;
          }).join('');
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Отправка
    async function send() {
      if (!currentChat) return;
      const text = chatInput.value.trim();
      if (!text) return;

      chatInput.value = '';
      chatInput.disabled = true;
      chatSend.disabled = true;

      const result = await sendMessage({
        chat_type: currentChat.type,
        chat_id: currentChat.type === 'direct' ? currentChat.id : null,
        to_user_id: currentChat.type === 'direct' ? currentChat.id : null,
        user_id: user.id,
        user_name: user.name || user.login,
        user_role: user.role,
        text: text
      });

      chatInput.disabled = false;
      chatSend.disabled = false;
      chatInput.focus();

      if (result) {
        await loadMessages();
      } else {
        AsgardUI.toast('Ошибка', 'Не удалось отправить', 'err');
      }
    }

    chatSend.addEventListener('click', send);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') send();
    });

    renderChatList();
  }

  return {
    CHAT_TYPES,
    getMessages,
    sendMessage,
    markAsRead,
    getUnreadCount,
    openChatModal,
    render
  };
})();
