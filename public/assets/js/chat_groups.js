/**
 * ASGARD CRM — Вороний Вестник (Huginn Messenger) — Desktop v2
 *
 * S10: SSE real-time, Мимир AI, markdown, drag&drop, keyboard shortcuts,
 *      SVG bubble tails, voice playback, right-click context menu
 */
window.AsgardChatGroups = (function(){
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;

  let currentChatId = null;
  let _savedLayout = null;
  let _lastMessageCount = 0;
  let _replyToId = null;
  let _replyToText = '';
  let _replyToUser = '';
  let _currentChatData = null;
  let _sseListeners = [];
  let _typingTimeout = null;
  let _searchMode = false;
  let _chatListCache = [];
  let _myId = null;
  let _currentTab = localStorage.getItem('huginn_chat_tab_desktop') || 'all';

  const token = () => localStorage.getItem('asgard_token');

  // ═══════════════════════════════════════════════════════════════
  // API
  // ═══════════════════════════════════════════════════════════════

  const API = {
    async getChats(archived = false) {
      const res = await fetch(`/api/chat-groups?archived=${archived}`, {
        headers: { 'Authorization': 'Bearer ' + token() }
      });
      return res.json();
    },
    async getChat(id) {
      const res = await fetch(`/api/chat-groups/${id}`, {
        headers: { 'Authorization': 'Bearer ' + token() }
      });
      return res.json();
    },
    async createChat(data) {
      const res = await fetch('/api/chat-groups', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    async getMessages(chatId, beforeId) {
      const params = beforeId ? `?before_id=${beforeId}` : '';
      const res = await fetch(`/api/chat-groups/${chatId}/messages${params}`, {
        headers: { 'Authorization': 'Bearer ' + token() }
      });
      return res.json();
    },
    async sendMessage(chatId, text, replyToId) {
      const res = await fetch(`/api/chat-groups/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, reply_to_id: replyToId || null })
      });
      return res.json();
    },
    async editMessage(chatId, messageId, text) {
      const res = await fetch(`/api/chat-groups/${chatId}/messages/${messageId}`, {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      return res.json();
    },
    async deleteMessage(chatId, messageId) {
      const res = await fetch(`/api/chat-groups/${chatId}/messages/${messageId}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token() }
      });
      return res.json();
    },
    async addMember(chatId, userId) {
      const res = await fetch(`/api/chat-groups/${chatId}/members`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId })
      });
      return res.json();
    },
    async leaveChat(chatId) {
      const res = await fetch(`/api/chat-groups/${chatId}/members/${_myId}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token() }
      });
      return res.json();
    },
    async muteChat(chatId, hours) {
      const until = hours ? new Date(Date.now() + hours * 3600000).toISOString() : null;
      const res = await fetch(`/api/chat-groups/${chatId}/mute`, {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ until })
      });
      return res.json();
    },
    async addReaction(chatId, messageId, emoji) {
      const res = await fetch(`/api/chat-groups/${chatId}/messages/${messageId}/reaction`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji })
      });
      return res.json();
    },
    async openDirect(userId) {
      const res = await fetch('/api/chat-groups/direct', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId })
      });
      return res.json();
    },
    async uploadFile(chatId, file, messageText) {
      const fd = new FormData();
      fd.append('file', file);
      if (messageText) fd.append('message_text', messageText);
      const res = await fetch(`/api/chat-groups/${chatId}/upload-file`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token() },
        body: fd
      });
      return res.json();
    },
    async sendTyping(chatId) {
      fetch(`/api/chat-groups/${chatId}/typing`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token() }
      }).catch(() => {});
    },
    async markRead(chatId, lastMessageId) {
      fetch(`/api/chat-groups/${chatId}/read`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_message_id: lastMessageId })
      }).catch(() => {});
    },
    async getMimirChat() {
      const res = await fetch('/api/chat-groups/mimir', {
        headers: { 'Authorization': 'Bearer ' + token() }
      });
      return res.json();
    },
    async sendMimir(chatId, message) {
      const res = await fetch(`/api/chat-groups/${chatId}/mimir`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      return res.json();
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  function formatChatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 86400000 && d.getDate() === now.getDate())
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (diff < 172800000) return 'вчера';
    if (diff < 604800000) return ['вс','пн','вт','ср','чт','пт','сб'][d.getDay()];
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  function getInitials(name) {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  function getAvatarColor(name) {
    if (!name) return '#555';
    const colors = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F','#BB8FCE','#85C1E9'];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return colors[Math.abs(h) % colors.length];
  }

  // Attachment helpers
  function getSafeInternalUrl(value) {
    if (!value || typeof value !== 'string') return '';
    const t = value.trim();
    if (/^\/api\/chat-groups\/\d+\/files\/[^/?#]+$/i.test(t)) return t;
    if (/^\/api\/files\/download\/[^/?#]+$/i.test(t)) return t;
    let storedName = '';
    const m1 = t.match(/^\/uploads\/chat\/([^/?#]+)$/i);
    const m2 = t.match(/^chat\/([^/?#]+)$/i);
    if (m1) storedName = m1[1];
    else if (m2) storedName = m2[1];
    else if (!t.includes('/') && !t.includes('\\')) storedName = t;
    if (!storedName || !currentChatId) return '';
    if (storedName.includes('..') || storedName.includes('\\')) return '';
    return `/api/chat-groups/${encodeURIComponent(currentChatId)}/files/${encodeURIComponent(storedName)}`;
  }

  function renderAttachmentHtml(att) {
    if (!att) return '';
    const name = att.file_name || att.original_name || att.filename || 'Файл';
    const href = getSafeInternalUrl(att.download_url) || getSafeInternalUrl(att.file_url) || getSafeInternalUrl(att.file_path) || getSafeInternalUrl(att.filename);
    const icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    if (!href) return `<span class="chat-attachment-link disabled">${icon} ${esc(name)}</span>`;
    return `<a href="${esc(href)}" download="${esc(name)}" class="chat-attachment-link">${icon} ${esc(name)}</a>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // Markdown parser (ported from Huginn mobile)
  // ═══════════════════════════════════════════════════════════════

  function parseMarkdown(text) {
    if (!text) return document.createDocumentFragment();
    const frag = document.createDocumentFragment();
    const parts = text.split(/(```[\s\S]*?```)/g);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.indexOf('```') === 0 && part.lastIndexOf('```') > 2) {
        let code = part.slice(3, part.length - 3);
        const nl = code.indexOf('\n');
        if (nl >= 0 && nl < 20 && /^[a-zA-Z]*$/.test(code.slice(0, nl).trim())) code = code.slice(nl + 1);
        const pre = document.createElement('pre');
        pre.className = 'hg-code-block';
        const codeEl = document.createElement('code');
        codeEl.textContent = code;
        pre.appendChild(codeEl);
        frag.appendChild(pre);
      } else {
        _parseBlock(part, frag);
      }
    }
    return frag;
  }

  function _parseBlock(text, frag) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hm = line.match(/^(#{1,3})\s+(.+)$/);
      if (hm) { const d = document.createElement('div'); d.className = 'hg-md-h' + hm[1].length; d.appendChild(_parseInline(hm[2])); frag.appendChild(d); continue; }
      const um = line.match(/^[\s]*[-*]\s+(.+)$/);
      if (um) { const d = document.createElement('div'); d.className = 'hg-md-li'; d.appendChild(document.createTextNode('\u2022 ')); d.appendChild(_parseInline(um[1])); frag.appendChild(d); continue; }
      const om = line.match(/^[\s]*(\d+)\.\s+(.+)$/);
      if (om) { const d = document.createElement('div'); d.className = 'hg-md-li'; d.appendChild(document.createTextNode(om[1] + '. ')); d.appendChild(_parseInline(om[2])); frag.appendChild(d); continue; }
      if (line.trim()) frag.appendChild(_parseInline(line));
      if (i < lines.length - 1) frag.appendChild(document.createElement('br'));
    }
  }

  function _parseInline(text) {
    const frag = document.createDocumentFragment();
    const re = /(https?:\/\/[^\s<>"']+)|(\*\*(.+?)\*\*)|(__(.+?)__)|(_(.+?)_)|(~~(.+?)~~)|(`(.+?)`)/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) { const a = document.createElement('a'); a.href = m[1]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = m[1]; a.className = 'hg-link'; frag.appendChild(a); }
      else if (m[2]) { const b = document.createElement('strong'); b.textContent = m[3]; frag.appendChild(b); }
      else if (m[4]) { const b = document.createElement('strong'); b.textContent = m[5]; frag.appendChild(b); }
      else if (m[6]) { const em = document.createElement('em'); em.textContent = m[7]; frag.appendChild(em); }
      else if (m[8]) { const del = document.createElement('del'); del.textContent = m[9]; frag.appendChild(del); }
      else if (m[10]) { const c = document.createElement('code'); c.className = 'hg-code-inline'; c.textContent = m[11]; frag.appendChild(c); }
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  // ═══════════════════════════════════════════════════════════════
  // Voice message player (desktop — click to play)
  // ═══════════════════════════════════════════════════════════════

  function renderVoicePlayer(msg) {
    const dur = msg.file_duration || 0;
    const m = Math.floor(dur / 60);
    const s = Math.floor(dur % 60);
    const timeStr = m + ':' + (s < 10 ? '0' : '') + s;
    const url = getSafeInternalUrl(msg.file_url);
    if (!url) return `<div class="hg-voice">[Голосовое ${timeStr}]</div>`;
    return `<div class="hg-voice" data-url="${esc(url)}" data-dur="${dur}" onclick="AsgardChatGroups._playVoice(this)">
      <button class="hg-voice-play">&#9654;</button>
      <div class="hg-voice-wave"></div>
      <span class="hg-voice-time">${timeStr}</span>
    </div>`;
  }

  let _currentAudio = null;
  function _playVoice(el) {
    const url = el.dataset.url;
    if (!url) return;
    const btn = el.querySelector('.hg-voice-play');
    if (_currentAudio) { _currentAudio.pause(); _currentAudio = null; document.querySelectorAll('.hg-voice-play.playing').forEach(b => { b.classList.remove('playing'); b.innerHTML = '&#9654;'; }); }
    if (btn.classList.contains('playing')) return;
    const audio = new Audio(url);
    _currentAudio = audio;
    btn.classList.add('playing');
    btn.innerHTML = '&#9646;&#9646;';
    audio.play().catch(() => {});
    audio.onended = () => { btn.classList.remove('playing'); btn.innerHTML = '&#9654;'; _currentAudio = null; };
  }

  // ═══════════════════════════════════════════════════════════════
  // Voice recording (desktop — click-to-record)
  // ═══════════════════════════════════════════════════════════════

  let _recorder = null;
  let _recordingChunks = [];
  let _recordingTimer = null;
  let _recordingStart = 0;

  function startVoiceRecording(chatId) {
    if (_recorder) { stopVoiceRecording(chatId, true); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      _recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      _recordingChunks = [];
      _recorder.ondataavailable = e => { if (e.data.size > 0) _recordingChunks.push(e.data); };
      _recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const recBar = $('#hg-rec-bar');
        if (recBar) recBar.remove();
      };
      _recorder.start();
      _recordingStart = Date.now();
      // Show recording bar
      const inputArea = $('.chat-input-area');
      if (inputArea) {
        const bar = document.createElement('div');
        bar.id = 'hg-rec-bar';
        bar.className = 'hg-rec-bar';
        bar.innerHTML = '<span class="hg-rec-dot"></span><span id="hg-rec-time">0:00</span><button class="hg-rec-cancel" title="Отмена">&times;</button><button class="hg-rec-send" title="Отправить">&#10003;</button>';
        inputArea.parentNode.insertBefore(bar, inputArea);
        bar.querySelector('.hg-rec-cancel').onclick = () => stopVoiceRecording(chatId, false);
        bar.querySelector('.hg-rec-send').onclick = () => stopVoiceRecording(chatId, true);
      }
      _recordingTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - _recordingStart) / 1000);
        const el = $('#hg-rec-time');
        if (el) el.textContent = Math.floor(elapsed / 60) + ':' + (elapsed % 60 < 10 ? '0' : '') + (elapsed % 60);
      }, 500);
    }).catch(() => toast('Нет доступа к микрофону', 'error'));
  }

  function stopVoiceRecording(chatId, send) {
    if (_recordingTimer) { clearInterval(_recordingTimer); _recordingTimer = null; }
    if (!_recorder) return;
    const recorder = _recorder;
    _recorder = null;
    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach(t => t.stop());
      const bar = $('#hg-rec-bar');
      if (bar) bar.remove();
      if (send && _recordingChunks.length > 0) {
        const blob = new Blob(_recordingChunks, { type: 'audio/webm' });
        const file = new File([blob], 'voice.webm', { type: 'audio/webm' });
        try {
          await API.uploadFile(chatId, file, '');
          await loadChatMessages(chatId);
        } catch (e) { toast('Ошибка отправки', 'error'); }
      }
    };
    recorder.stop();
  }

  // ═══════════════════════════════════════════════════════════════
  // SSE real-time (uses global window._asgardSSE from app.js)
  // ═══════════════════════════════════════════════════════════════

  function _sseOn(event, handler) {
    const sse = window._asgardSSE;
    if (!sse) return;
    sse.addEventListener(event, handler);
    _sseListeners.push({ event, handler });
  }

  function _sseCleanup() {
    const sse = window._asgardSSE;
    if (!sse) return;
    _sseListeners.forEach(l => sse.removeEventListener(l.event, l.handler));
    _sseListeners = [];
  }

  function _setupSSE() {
    _sseCleanup();

    _sseOn('chat:new_message', (e) => {
      try {
        const data = JSON.parse(e.data);
        const msg = data.message;
        if (!msg) return;
        // Update sidebar preview
        _updateSidebarPreview(msg.chat_id, msg);
        // If this chat is open — append message
        if (currentChatId && msg.chat_id === currentChatId) {
          _appendMessage(msg);
          // Mark as read
          API.markRead(currentChatId, msg.id);
        }
      } catch (_) {}
    });

    _sseOn('chat:message_edited', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (currentChatId && data.chat_id === currentChatId) {
          const el = document.querySelector(`[data-msg-id="${data.message_id}"] .chat-message-text`);
          if (el) { el.textContent = ''; el.appendChild(parseMarkdown(data.text)); }
          const timeEl = document.querySelector(`[data-msg-id="${data.message_id}"] .chat-message-time`);
          if (timeEl && !timeEl.textContent.includes('ред.')) timeEl.textContent += ' (ред.)';
        }
      } catch (_) {}
    });

    _sseOn('chat:message_deleted', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (currentChatId && data.chat_id === currentChatId) {
          const el = document.querySelector(`[data-msg-id="${data.message_id}"]`);
          if (el) { el.style.transition = 'opacity 200ms, max-height 200ms'; el.style.opacity = '0'; el.style.maxHeight = '0'; el.style.overflow = 'hidden'; setTimeout(() => el.remove(), 250); }
        }
      } catch (_) {}
    });

    _sseOn('chat:reaction', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (currentChatId && data.chat_id === currentChatId) {
          loadChatMessages(currentChatId);
        }
      } catch (_) {}
    });

    _sseOn('chat:typing', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (currentChatId && data.chat_id === currentChatId && data.user_id !== _myId) {
          _showTyping(data.user_name || 'Кто-то');
        }
      } catch (_) {}
    });

    _sseOn('chat:read', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (currentChatId && data.chat_id === currentChatId) {
          // Update read receipts — mark messages as read
          $$('.chat-msg-read.pending').forEach(el => { el.classList.remove('pending'); el.classList.add('read'); });
        }
      } catch (_) {}
    });
  }

  function _showTyping(name) {
    const el = $('#chat-typing');
    if (!el) return;
    el.querySelector('.chat-typing-text').textContent = name + ' печатает...';
    el.style.display = '';
    clearTimeout(_typingTimeout);
    _typingTimeout = setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

  function _appendMessage(msg) {
    const container = $('#chat-messages-container');
    if (!container) return;
    // Remove "no messages" placeholder
    const noMsg = container.querySelector('.chat-no-messages');
    if (noMsg) noMsg.remove();

    // Дедупликация: если SSE пришёл для нашего оптимистичного сообщения — заменить tempId
    if (msg.id && msg.user_id === _myId) {
      const tempEls = container.querySelectorAll('[data-msg-id^="temp-"]');
      for (const el of tempEls) {
        const tempText = el.querySelector('.chat-message-text')?.textContent?.trim();
        const msgText = (msg.message || msg.text || '').trim();
        if (tempText === msgText) {
          el.setAttribute('data-msg-id', msg.id);
          el.classList.remove('chat-msg-pending');
          return; // уже отрисовано оптимистично
        }
      }
    }

    // Check if message already exists (avoid duplicate)
    if (container.querySelector(`[data-msg-id="${msg.id}"]`)) return;
    // Hide typing
    const typing = $('#chat-typing');
    if (typing) typing.style.display = 'none';
    // Add date divider if needed
    const lastMsgEl = container.querySelector('.chat-message:last-of-type');
    const msgDate = new Date(msg.created_at);
    if (lastMsgEl) {
      const lastDateAttr = lastMsgEl.dataset.date;
      const todayStr = msgDate.toDateString();
      if (lastDateAttr && lastDateAttr !== todayStr) {
        const divider = document.createElement('div');
        divider.className = 'chat-date-divider';
        divider.innerHTML = '<span>' + _dateLabel(msgDate) + '</span>';
        container.insertBefore(divider, typing);
      }
    }
    // Render message
    const isEstimateChat = _currentChatData && _currentChatData.entity_type === 'estimate';
    const html = renderMessage(msg, _myId, [], false, isEstimateChat);
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const msgEl = temp.firstElementChild;
    if (msgEl) {
      msgEl.dataset.date = msgDate.toDateString();
      msgEl.style.animation = 'hgMsgIn 200ms ease-out';
      if (msg._optimistic) msgEl.classList.add('chat-msg-pending');
      container.insertBefore(msgEl, typing);
    }
    // Auto scroll if near bottom, or force scroll for mimir_response
    const isMimirMsg = msg.message_type === 'mimir_response' || msg.user_id === 4401;
    const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (dist < 200 || isMimirMsg) {
      requestAnimationFrame(() => container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' }));
    }
    _lastMessageCount++;

    // H4: Show "Мимир думает..." after director comment with approval_action in estimate chat
    const isEstChat = _currentChatData && _currentChatData.entity_type === 'estimate';
    if (isEstChat && msg.metadata) {
      let meta = {};
      try { meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : (msg.metadata || {}); } catch(e) {}
      if (meta.approval_action && meta.approval_action !== 'approve') {
        setTimeout(() => _showTyping('Мимир'), 500);
      }
    }

    // H4: Update pinned card when estimate_update arrives
    if (msg.message_type === 'estimate_update' && isEstChat) {
      _updatePinnedCard(msg);
    }
  }

  function _updatePinnedCard(msg) {
    const card = document.querySelector('.ec-pinned-card');
    if (!card) return;
    let meta = {};
    try { meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : (msg.metadata || {}); } catch(e) {}
    const fmt = v => new Intl.NumberFormat('ru-RU').format(v || 0) + ' \u20BD';
    const statusLabels = { draft: 'Черновик', sent: 'Отправлен', approved: 'Согласован', rework: 'Доработка', question: 'Вопрос', rejected: 'Отклонён' };
    // Update status badge
    const badge = card.querySelector('.ec-status-badge');
    if (badge && meta.status) {
      badge.className = 'ec-status-badge ec-status-badge--' + meta.status;
      badge.textContent = statusLabels[meta.status] || meta.status;
    }
    // Update metrics
    const values = card.querySelectorAll('.ec-metric__value');
    if (values.length >= 3) {
      if (meta.total_cost != null) values[0].textContent = fmt(meta.total_cost);
      if (meta.total_with_margin != null) values[1].textContent = fmt(meta.total_with_margin);
      if (meta.margin_pct != null) values[2].textContent = meta.margin_pct + '%';
    }
    // Flash animation
    card.style.transition = 'box-shadow 300ms';
    card.style.boxShadow = '0 0 12px rgba(212,168,67,.4)';
    setTimeout(() => { card.style.boxShadow = ''; }, 1500);
  }

  function _updateSidebarPreview(chatId, msg) {
    const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (!item) return;
    const preview = item.querySelector('.chat-item-preview');
    const time = item.querySelector('.chat-item-time');
    if (preview) {
      if (msg.message_type === 'estimate_update') {
        preview.textContent = '\uD83D\uDD04 Просчёт обновлён';
      } else if (msg.message_type === 'estimate_card') {
        preview.textContent = '\uD83D\uDCCB Карточка просчёта';
      } else if (msg.message_type === 'mimir_response') {
        preview.textContent = '\u041C\u0438\u043C\u0438\u0440: ' + (msg.message || msg.text || '').substring(0, 35);
      } else {
        const text = msg.message || msg.text || '';
        const prefix = msg.user_name && msg.user_id !== _myId ? msg.user_name.split(' ')[0] + ': ' : '';
        preview.textContent = prefix + text.substring(0, 40);
      }
    }
    if (time) time.textContent = formatChatTime(msg.created_at);
    // Increment unread if not current chat
    if (chatId !== currentChatId) {
      let badge = item.querySelector('.chat-item-unread');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'chat-item-unread';
        badge.textContent = '1';
        const meta = item.querySelector('.chat-item-meta');
        if (meta) meta.appendChild(badge);
      } else {
        badge.textContent = Math.min(99, parseInt(badge.textContent || '0') + 1);
      }
      _updateTabBadges();
    }
    // Move chat to top (within its section)
    const list = item.parentNode;
    if (list) {
      const isEstimateItem = item.dataset.entityType === 'estimate';
      list.removeChild(item);
      if (isEstimateItem) {
        // Move to top of estimate section (after section header)
        const sectionHeader = list.querySelector('.ec-section-header');
        if (sectionHeader && sectionHeader.nextSibling) {
          list.insertBefore(item, sectionHeader.nextSibling);
        } else {
          const mimirItem = list.querySelector('.chat-item[data-mimir="true"]');
          list.insertBefore(item, mimirItem ? mimirItem.nextSibling : list.firstChild);
        }
      } else {
        // Move to top of regular section (after last estimate item or mimir)
        const lastEstimate = list.querySelector('.chat-item[data-entity-type="estimate"]:last-of-type');
        if (lastEstimate && lastEstimate.nextSibling) {
          list.insertBefore(item, lastEstimate.nextSibling);
        } else {
          const mimirItem = list.querySelector('.chat-item[data-mimir="true"]');
          list.insertBefore(item, mimirItem && mimirItem.nextSibling ? mimirItem.nextSibling : list.firstChild);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Render Main Page
  // ═══════════════════════════════════════════════════════════════

  async function render({ layout }) {
    if (layout) _savedLayout = layout;
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    _myId = auth.user.id;

    const response = await API.getChats();
    const chats = response?.chats || [];
    _chatListCache = chats;

    // Inject SVG defs once
    if (!$('#hg-svg-defs')) {
      const svgDefs = document.createElement('div');
      svgDefs.id = 'hg-svg-defs';
      svgDefs.innerHTML = '<svg width="0" height="0" style="position:absolute"><defs><clipPath id="hg-tail-in"><path d="M10,0 A10,10 0,0,1 0,10 L16,10 L16,0 Z"/></clipPath><clipPath id="hg-tail-out"><path d="M6,0 A10,10 0,0,0 16,10 L0,10 L0,0 Z"/></clipPath></defs></svg>';
      document.body.appendChild(svgDefs);
    }

    // Build Mimir entry
    const mimirEntry = `
      <div class="chat-item chat-item--mimir" data-mimir="true" onclick="AsgardChatGroups.openMimir()">
        <div class="chat-item-avatar hg-mimir-avatar"><span>⚡</span></div>
        <div class="chat-item-info">
          <div class="chat-item-name hg-mimir-name">Мимир</div>
          <div class="chat-item-preview hg-mimir-sub">AI-помощник ASGARD</div>
        </div>
        <div class="chat-item-meta"></div>
      </div>
    `;

    function _renderChatItem(c) {
      const lastTime = formatChatTime(c.last_message_at || c.created_at);
      const isDirect = !c.is_group;
      const isEstimate = c.entity_type === 'estimate';
      const displayName = isDirect ? (c.direct_user_name || c.name) : c.name;
      const avatarLetter = displayName?.[0] || '?';
      const avatarColor = isDirect ? getAvatarColor(displayName) : '';
      const previewText = c.last_message_text
        ? (c.last_message_sender_name && c.is_group ? c.last_message_sender_name.split(' ')[0] + ': ' : '') + c.last_message_text.substring(0, 40)
        : (isDirect ? 'Личное сообщение' : (c.member_count || 0) + ' уч.');
      const typeBadge = isEstimate ? ' <span class="chat-item-type-badge">просчёт</span>' : (isDirect ? '' : ' <span class="chat-item-type-badge">дружина</span>');

      return `
        <div class="chat-item ${currentChatId == c.id ? 'active' : ''}" data-chat-id="${c.id}" data-chat-type="${isDirect ? 'direct' : 'group'}" ${isEstimate ? 'data-entity-type="estimate"' : ''} onclick="AsgardChatGroups.openChat(${c.id})">
          <div class="chat-item-avatar${isDirect ? '' : ' group'}" ${isDirect ? `style="background:${avatarColor}"` : ''}>
            <span class="chat-item-avatar-letter">${esc(avatarLetter)}</span>
          </div>
          <div class="chat-item-info">
            <div class="chat-item-name">${esc(displayName)}${typeBadge}</div>
            <div class="chat-item-preview">${esc(previewText)}</div>
          </div>
          <div class="chat-item-meta">
            <span class="chat-item-time">${lastTime}</span>
            ${c.unread_count > 0 ? `<span class="chat-item-unread">${c.unread_count > 99 ? '99+' : c.unread_count}</span>` : ''}
          </div>
        </div>
      `;
    }

    const estimateChats = chats.filter(c => c.entity_type === 'estimate');
    const regularChats = chats.filter(c => c.entity_type !== 'estimate');

    const estimateSection = estimateChats.length > 0
      ? `<div class="ec-section-header">📋 Просчёты</div>${estimateChats.map(_renderChatItem).join('')}`
      : '';

    const chatListHtml = chats.length > 0
      ? estimateSection + regularChats.map(_renderChatItem).join('')
      : `
      <div class="chat-empty-state">
        <div class="chat-empty-icon">🐦‍⬛</div>
        <div class="chat-empty-title">Тишина в чертогах</div>
        <div class="chat-empty-desc">Отправьте весть или создайте совет</div>
      </div>
    `;

    const html = `
      <div class="chat-container">
        <div class="chat-sidebar" id="chat-sidebar">
          <div class="chat-sidebar-header">
            <div class="chat-sidebar-title">
              <span class="chat-sidebar-icon">🐦‍⬛</span>
              Хугинн
            </div>
            <button class="chat-create-btn" onclick="AsgardChatGroups.showNewChatMenu()" title="Новый чат">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
          <div class="chat-search-bar">
            <input type="text" class="chat-search-input" placeholder="Поиск..." oninput="AsgardChatGroups.filterChats(this.value)">
          </div>
          <div class="hg-chat-tabs" id="hg-chat-tabs">
            <button class="hg-chat-tab${_currentTab === 'all' ? ' active' : ''}" data-tab="all" onclick="AsgardChatGroups.filterByTab('all')">Все</button>
            <button class="hg-chat-tab${_currentTab === 'estimates' ? ' active' : ''}" data-tab="estimates" onclick="AsgardChatGroups.filterByTab('estimates')">Просчёты</button>
            <button class="hg-chat-tab${_currentTab === 'personal' ? ' active' : ''}" data-tab="personal" onclick="AsgardChatGroups.filterByTab('personal')">Личные</button>
            <div class="hg-tab-indicator" id="hg-tab-indicator"></div>
          </div>
          <div class="chat-list" id="chat-list-container">
            ${mimirEntry}
            ${chatListHtml}
          </div>
        </div>
        <div class="chat-main" id="chat-main-area">
          <div class="chat-welcome">
            <div class="chat-welcome-icon">🐦‍⬛</div>
            <div class="chat-welcome-title">Хугинн — Вороний Вестник</div>
            <div class="chat-welcome-desc">Выберите чат или отправьте новую весть<br><small>Ctrl+F — поиск &bull; Enter — отправить &bull; Shift+Enter — новая строка</small></div>
          </div>
        </div>
      </div>
    `;

    await layout(html, { title: 'Хугинн', motto: 'Вороний Вестник' });

    // Initialize chat tabs
    filterByTab(_currentTab);
    // Position indicator after DOM is ready
    requestAnimationFrame(() => _updateTabIndicator());

    _setupSSE();

    if (currentChatId) {
      await loadChatMessages(currentChatId);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Filter chats
  // ═══════════════════════════════════════════════════════════════

  function filterChats(query) {
    const q = (query !== undefined ? query : ($('.chat-search-input')?.value || '')).toLowerCase();
    const sectionHeader = document.querySelector('.ec-section-header');
    if (sectionHeader) sectionHeader.style.display = _currentTab === 'all' ? '' : 'none';
    $$('#chat-list-container .chat-item').forEach(item => {
      if (item.dataset.mimir === 'true') { item.style.display = ''; return; }
      // Tab filter
      let tabMatch = true;
      if (_currentTab === 'estimates') tabMatch = item.dataset.entityType === 'estimate';
      else if (_currentTab === 'personal') tabMatch = item.dataset.entityType !== 'estimate';
      // Search filter
      const name = item.querySelector('.chat-item-name');
      const searchMatch = !q || (name && name.textContent.toLowerCase().includes(q));
      item.style.display = (tabMatch && searchMatch) ? '' : 'none';
    });
  }

  function filterByTab(tab) {
    _currentTab = tab;
    localStorage.setItem('huginn_chat_tab_desktop', tab);
    $$('#hg-chat-tabs .hg-chat-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    filterChats();
    _updateTabBadges();
    _updateTabIndicator();
  }

  function _updateTabIndicator() {
    const indicator = $('#hg-tab-indicator');
    const activeBtn = document.querySelector('#hg-chat-tabs .hg-chat-tab.active');
    if (!indicator || !activeBtn) return;
    const tabColors = { all: '#fff', estimates: '#D4A843', personal: '#1F6FEB' };
    indicator.style.left = activeBtn.offsetLeft + 'px';
    indicator.style.width = activeBtn.offsetWidth + 'px';
    indicator.style.background = tabColors[_currentTab] || '#fff';
  }

  function _updateTabBadges() {
    let estUnread = 0, persUnread = 0;
    $$('#chat-list-container .chat-item').forEach(item => {
      if (item.dataset.mimir === 'true') return;
      const badge = item.querySelector('.chat-item-unread');
      if (!badge) return;
      const count = parseInt(badge.textContent) || 0;
      if (item.dataset.entityType === 'estimate') estUnread += count;
      else persUnread += count;
    });
    const total = estUnread + persUnread;
    const counts = { all: total, estimates: estUnread, personal: persUnread };
    $$('#hg-chat-tabs .hg-chat-tab').forEach(btn => {
      const tab = btn.dataset.tab;
      let badge = btn.querySelector('.hg-tab-badge');
      if (counts[tab] > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'hg-tab-badge';
          btn.appendChild(badge);
        }
        badge.textContent = counts[tab] > 99 ? '99+' : counts[tab];
      } else if (badge) {
        badge.remove();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Open Chat
  // ═══════════════════════════════════════════════════════════════

  async function openChat(chatId) {
    currentChatId = chatId;
    _replyToId = null; _replyToText = ''; _replyToUser = '';
    _currentChatData = null;
    // Mobile toggle
    const sidebar = $('#chat-sidebar');
    const main = $('#chat-main-area');
    if (sidebar) sidebar.classList.add('chat-hidden-mobile');
    if (main) main.classList.add('chat-visible-mobile');
    // Mark active in sidebar
    $$('.chat-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (activeItem) { activeItem.classList.add('active'); const badge = activeItem.querySelector('.chat-item-unread'); if (badge) badge.remove(); }
    await loadChatMessages(chatId);
  }

  function backToList() {
    const sidebar = $('#chat-sidebar');
    const main = $('#chat-main-area');
    if (sidebar) sidebar.classList.remove('chat-hidden-mobile');
    if (main) main.classList.remove('chat-visible-mobile');
    currentChatId = null;
    _currentChatData = null;
  }

  // ═══════════════════════════════════════════════════════════════
  // Load & render chat messages
  // ═══════════════════════════════════════════════════════════════

  async function loadChatMessages(chatId) {
    const mainArea = $('#chat-main-area');
    if (!mainArea) return;

    const chatResp = await API.getChat(chatId);
    const chat = chatResp?.chat || {};
    const members = chatResp?.members || [];
    const myRole = chatResp?.myRole || 'member';
    const msgsResp = await API.getMessages(chatId);
    const messages = msgsResp?.messages || [];

    _currentChatData = chat;
    const isDirect = !chat.is_group;
    const isMimir = chat.is_mimir;
    const isEstimate = chat.entity_type === 'estimate';
    const shouldScroll = messages.length !== _lastMessageCount;
    _lastMessageCount = messages.length;

    // Find pinned estimate card
    let pinnedCardHtml = '';
    if (isEstimate) {
      const cardMsg = messages.find(m => m.message_type === 'estimate_card');
      if (cardMsg) {
        let meta = {};
        try { meta = typeof cardMsg.metadata === 'string' ? JSON.parse(cardMsg.metadata) : (cardMsg.metadata || {}); } catch(e) {}
        const fmt = v => new Intl.NumberFormat('ru-RU').format(v || 0) + ' \u20BD';
        const status = meta.status || 'draft';
        const statusLabels = { draft: 'Черновик', sent: 'Отправлен', approved: 'Согласован', rework: 'Доработка', question: 'Вопрос', rejected: 'Отклонён' };
        pinnedCardHtml = `
          <div class="ec-pinned-card">
            <div class="ec-pinned-card__header">
              <span class="ec-pinned-card__title">${esc(meta.title || chat.name || 'Просчёт')}</span>
              <span class="ec-status-badge ec-status-badge--${status}">${statusLabels[status] || status}</span>
            </div>
            <div class="ec-pinned-card__metrics">
              <div class="ec-metric"><span class="ec-metric__label">Себестоимость</span><span class="ec-metric__value">${fmt(meta.total_cost)}</span></div>
              <div class="ec-metric"><span class="ec-metric__label">Клиенту</span><span class="ec-metric__value">${fmt(meta.total_with_margin)}</span></div>
              <div class="ec-metric"><span class="ec-metric__label">Маржа</span><span class="ec-metric__value">${meta.margin_pct || 0}%</span></div>
            </div>
            <a class="ec-pinned-card__link" href="#/estimate-report?id=${meta.estimate_id || ''}">Открыть полный отчёт \u2192</a>
          </div>`;
      }
    }

    // Group by date
    const grouped = _groupByDate(messages);
    let messagesHtml = '';
    for (const [label, msgs] of Object.entries(grouped)) {
      messagesHtml += `<div class="chat-date-divider"><span>${label}</span></div>`;
      messagesHtml += msgs.map(m => renderMessage(m, _myId, members, isMimir, isEstimate)).join('');
    }

    // Header
    let headerTitle, headerStatus, headerAvatar, headerActions;
    if (isMimir) {
      headerTitle = 'Мимир';
      headerStatus = '<span style="color:var(--gold,#D4A843)">AI-помощник ASGARD</span>';
      headerAvatar = '<div class="chat-header-avatar hg-mimir-avatar"><span>⚡</span></div>';
      headerActions = '';
    } else if (isDirect) {
      const other = members.find(m => m.user_id !== _myId) || {};
      const name = other.name || chat.direct_user_name || chat.name;
      headerTitle = esc(name);
      headerStatus = other.is_active ? '<span class="chat-online-dot"></span> в сети' : 'не в сети';
      headerAvatar = `<div class="chat-header-avatar" style="background:${getAvatarColor(name)}"><span>${getInitials(name)}</span></div>`;
      headerActions = `<button class="chat-header-btn" onclick="AsgardChatGroups.showSettingsModal(${chatId})" title="Настройки"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>`;
    } else {
      const mc = members.length;
      const oc = members.filter(m => m.is_active).length;
      headerTitle = esc(chat.name);
      headerStatus = `<span class="chat-online-dot"></span> ${mc} уч., ${oc} онлайн`;
      headerAvatar = `<div class="chat-header-avatar group"><span>${esc(chat.name?.[0] || '?')}</span></div>`;
      const addMemberBtn = isEstimate ? `<button class="chat-header-btn ec-add-member-btn" onclick="AsgardChatGroups.showMembersModal(${chatId})" title="Добавить участника"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg></button>` : '';
      headerActions = `
        ${addMemberBtn}
        <button class="chat-header-btn" onclick="AsgardChatGroups.showMembersModal(${chatId})" title="Участники"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></button>
        <button class="chat-header-btn" onclick="AsgardChatGroups.showSettingsModal(${chatId})" title="Настройки"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
      `;
    }

    const placeholder = isMimir ? 'Спросите Мимира...' : 'Сообщение...';
    const micBtn = isMimir ? '' : `<button class="chat-mic-btn" onclick="AsgardChatGroups.startVoiceRecording(${chatId})" title="Голосовое сообщение"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button>`;

    mainArea.innerHTML = `
      <div class="chat-header">
        <button class="chat-back-btn" onclick="AsgardChatGroups.backToList()" title="Назад">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="chat-header-info" onclick="${!isMimir && !isDirect ? `AsgardChatGroups.showMembersModal(${chatId})` : ''}">
          ${headerAvatar}
          <div class="chat-header-details">
            <div class="chat-header-title">${headerTitle}</div>
            <div class="chat-header-status">${headerStatus}</div>
          </div>
        </div>
        <div class="chat-header-actions">
          <button class="chat-header-btn" onclick="AsgardChatGroups.toggleSearch()" title="Поиск (Ctrl+F)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          ${headerActions}
        </div>
      </div>
      <div class="hg-search-bar" id="hg-search-bar" style="display:none">
        <input type="text" class="hg-search-input" id="hg-search-input" placeholder="Поиск в чате..." oninput="AsgardChatGroups.searchInChat(this.value)">
        <span id="hg-search-count"></span>
        <button class="hg-search-close" onclick="AsgardChatGroups.toggleSearch()">&times;</button>
      </div>
      ${pinnedCardHtml}
      <div class="chat-messages" id="chat-messages-container"
           ondragover="AsgardChatGroups._dragOver(event)"
           ondragleave="AsgardChatGroups._dragLeave(event)"
           ondrop="AsgardChatGroups._drop(event, ${chatId})">
        ${messagesHtml || `
          <div class="chat-no-messages">
            <div class="chat-no-messages-icon">${isMimir ? '⚡' : isDirect ? '👋' : '🔒'}</div>
            <div class="chat-no-messages-text">${isMimir ? 'Спросите Мимира что угодно!' : isDirect ? 'Начните переписку!' : 'Напишите первое сообщение!'}</div>
          </div>
        `}
        <div class="chat-typing-indicator" id="chat-typing" style="display:none">
          <div class="chat-typing-dots"><span></span><span></span><span></span></div>
          <span class="chat-typing-text">печатает...</span>
        </div>
      </div>
      <div class="hg-drop-overlay" id="hg-drop-overlay" style="display:none">
        <div class="hg-drop-text">📎 Перетащите файлы сюда</div>
      </div>
      <div class="chat-input-area">
        ${!isMimir ? `<button class="chat-emoji-btn" onclick="AsgardChatGroups.toggleEmojiPicker()" title="Emoji">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        </button>` : ''}
        <button class="chat-attach-btn" onclick="document.getElementById('chat-file-input').click()" title="Файл">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <input type="file" id="chat-file-input" style="display:none" onchange="AsgardChatGroups.handleFileSelect(this, ${chatId})">
        <textarea id="chat-message-input" class="chat-input" placeholder="${placeholder}" rows="1"
          onkeydown="AsgardChatGroups.handleKeyDown(event, ${chatId})"
          oninput="AsgardChatGroups.autoResizeInput(this); AsgardChatGroups._onTyping(${chatId})"></textarea>
        ${micBtn}
        <button class="chat-send-btn" onclick="AsgardChatGroups.sendMessage(${chatId})" title="Отправить (Enter)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    `;

    // Scroll to bottom
    if (shouldScroll || true) {
      const container = $('#chat-messages-container');
      if (container) requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
    }

    // Mark as read
    if (messages.length > 0) {
      API.markRead(chatId, messages[messages.length - 1].id);
    }

    // Setup right-click context menu on messages
    _setupContextMenu(chatId);
    // S12: Double-click → ❤️ reaction
    _setupDoubleTap(chatId);
    // S12: Load link previews
    _loadLinkPreviews();

    // Focus input
    const input = $('#chat-message-input');
    if (input) setTimeout(() => input.focus(), 100);
  }

  // ═══════════════════════════════════════════════════════════════
  // Render single message
  // ═══════════════════════════════════════════════════════════════

  function renderMessage(msg, userId, members, isMimir, isEstimateChat) {
    // H3: Skip estimate_card — shown as pinned card
    if (msg.message_type === 'estimate_card') return '';

    // H3: estimate_update — system pill
    if (msg.message_type === 'estimate_update') {
      let meta = {};
      try { meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : (msg.metadata || {}); } catch(e) {}
      const ver = meta.version_no ? 'v' + meta.version_no : '';
      const margin = meta.margin_pct ? ', маржа ' + meta.margin_pct + '%' : '';
      const pillTime = new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      return `<div class="ec-system-pill" data-msg-id="${msg.id}"><span class="ec-system-pill__icon">\uD83D\uDD04</span><span class="ec-system-pill__text">Просчёт обновлён${ver ? ' \u2014 ' + ver : ''}${margin}</span><span class="ec-system-pill__time">${pillTime}</span></div>`;
    }

    const isOwn = msg.user_id === userId;
    const isMimirResponse = msg.message_type === 'mimir_response' || msg.user_id === 4401;
    const isMimirBot = isMimirResponse || msg.user_id === 0 || msg.is_mimir_bot || msg.is_system;
    const time = new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const initials = getInitials(msg.user_name);
    const avatarColor = getAvatarColor(msg.user_name);
    const messageText = msg.message || msg.text || '';
    const atts = Array.isArray(msg.attachments) ? msg.attachments.filter(Boolean) : [];

    // H3: Parse approval_action metadata
    let actionBadgeHtml = '';
    if (msg.metadata) {
      let meta = {};
      try { meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : (msg.metadata || {}); } catch(e) {}
      if (meta.approval_action) {
        const actionLabels = { approve: 'Согласовано', rework: 'На доработку', question: 'Вопрос', reject: 'Отклонено' };
        actionBadgeHtml = `<span class="ec-action-badge ec-action-badge--${meta.approval_action}">${actionLabels[meta.approval_action] || meta.approval_action}</span>`;
      }
    }

    // H3: Mimir response avatar & bubble overrides
    const useMimirEstimateStyle = isMimirResponse && isEstimateChat;
    const avatarHtml = !isOwn
      ? (useMimirEstimateStyle
        ? '<div class="chat-message-avatar ec-mimir-avatar"><span>\u041C</span></div>'
        : (isMimirBot
          ? '<div class="chat-message-avatar hg-mimir-avatar"><span>\u26A1</span></div>'
          : `<div class="chat-message-avatar" style="background:${avatarColor}">${initials}</div>`))
      : '';
    const bubbleClass = useMimirEstimateStyle ? ' ec-mimir-bubble' : (isMimirBot ? ' hg-mimir-bubble' : '');
    const senderHtml = !isOwn
      ? `<div class="chat-message-sender" ${isMimirBot ? 'style="color:var(--gold,#D4A843)"' : `style="color:${avatarColor}"`}>${useMimirEstimateStyle ? '\u041C\u0438\u043C\u0438\u0440 <span class="ec-mimir-pill">\u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442</span>' : (isMimirBot ? '\u041C\u0438\u043C\u0438\u0440' : esc(msg.user_name))}${actionBadgeHtml}</div>`
      : (actionBadgeHtml ? `<div class="chat-message-sender" style="color:${avatarColor};text-align:right">${esc(msg.user_name)}${actionBadgeHtml}</div>` : '');

    // Voice message?
    if (msg.message_type === 'voice' || (msg.file_url && (msg.file_url.endsWith('.webm') || msg.file_url.endsWith('.ogg')))) {
      const voiceHtml = renderVoicePlayer(msg);
      return `<div class="chat-message ${isOwn ? 'own' : ''} ${isMimirBot ? 'mimir-bot' : ''}" data-msg-id="${msg.id}" data-date="${new Date(msg.created_at).toDateString()}">
        ${avatarHtml}
        <div class="chat-message-bubble${bubbleClass}">
          ${senderHtml}
          ${voiceHtml}
          <div class="chat-message-footer"><span class="chat-message-time">${time}</span>${isOwn ? '<span class="chat-msg-read">&#10003;&#10003;</span>' : ''}</div>
        </div>
      </div>`;
    }

    // Reply preview
    const replyHtml = msg.reply_text ? `
      <div class="chat-msg-reply">
        <div class="chat-msg-reply-name">${esc(msg.reply_user_name || '')}</div>
        <div class="chat-msg-reply-text">${esc((msg.reply_text || '').substring(0, 80))}</div>
      </div>` : '';

    // Reactions
    const reactionsHtml = msg.reactions && Object.keys(msg.reactions).length > 0
      ? `<div class="chat-msg-reactions">${Object.entries(msg.reactions).map(([emoji, users]) =>
          `<span class="chat-msg-reaction ${users.includes(userId) ? 'active' : ''}" onclick="AsgardChatGroups.react(${currentChatId}, ${msg.id}, '${emoji}')">${emoji} ${users.length}</span>`
        ).join('')}</div>` : '';

    // Attachments
    const attsHtml = atts.length > 0 ? `<div class="chat-message-attachments">${atts.map(a => renderAttachmentHtml(a)).join('')}</div>` : '';

    // Build message body with markdown
    const textContainer = document.createElement('div');
    textContainer.appendChild(parseMarkdown(messageText));
    const textHtml = messageText ? `<div class="chat-message-text">${textContainer.innerHTML}</div>` : '';

    // S12: Link preview placeholder
    const urlMatch = messageText.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/i);
    const linkPreviewHtml = urlMatch ? `<div class="huginn-link-preview--shimmer" data-preview-url="${esc(urlMatch[0])}"></div>` : '';

    const readHtml = isOwn ? '<span class="chat-msg-read">&#10003;&#10003;</span>' : '';

    return `
      <div class="chat-message ${isOwn ? 'own' : ''} ${isMimirBot ? 'mimir-bot' : ''}" data-msg-id="${msg.id}" data-date="${new Date(msg.created_at).toDateString()}" data-user-id="${msg.user_id}">
        ${avatarHtml}
        <div class="chat-message-bubble${bubbleClass}">
          ${senderHtml}
          ${replyHtml}
          ${textHtml}
          ${linkPreviewHtml}
          ${attsHtml}
          <div class="chat-message-footer">
            <span class="chat-message-time">${time}${msg.edited_at ? ' (ред.)' : ''}</span>
            ${readHtml}
          </div>
          ${reactionsHtml}
        </div>
        <div class="chat-msg-actions">
          <button class="chat-msg-action-btn" onclick="AsgardChatGroups.setReply(${msg.id}, '${esc(msg.user_name || '')}', '${esc((messageText || '').substring(0, 50).replace(/'/g, "\\'"))}')" title="Ответить">&#8617;</button>
          <button class="chat-msg-action-btn" onclick="AsgardChatGroups.showReactionPicker(${msg.id})" title="Реакция">&#9786;</button>
        </div>
      </div>
    `;
  }

  function _groupByDate(messages) {
    const groups = {};
    const now = new Date();
    const today = now.toDateString();
    const yesterday = new Date(now - 86400000).toDateString();
    for (const m of messages) {
      const d = new Date(m.created_at);
      const ds = d.toDateString();
      const label = ds === today ? 'Сегодня' : ds === yesterday ? 'Вчера' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
      if (!groups[label]) groups[label] = [];
      groups[label].push(m);
    }
    return groups;
  }

  function _dateLabel(d) {
    const now = new Date();
    const ds = d.toDateString();
    if (ds === now.toDateString()) return 'Сегодня';
    if (ds === new Date(now - 86400000).toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ═══════════════════════════════════════════════════════════════
  // Mimir AI
  // ═══════════════════════════════════════════════════════════════

  async function openMimir() {
    try {
      const resp = await API.getMimirChat();
      const chatId = resp?.chatId || resp?.chat?.id || resp?.chat_id;
      if (chatId) {
        await openChat(chatId);
      } else {
        toast('Не удалось открыть Мимира', 'error');
      }
    } catch (e) {
      toast('Ошибка подключения к Мимиру', 'error');
    }
  }

  async function _sendMimirMessage(chatId) {
    const input = $('#chat-message-input');
    const text = input?.value?.trim();
    if (!text) return;

    const sendBtn = $('.chat-send-btn');
    if (sendBtn) sendBtn.classList.add('sending');
    input.value = '';
    input.style.height = 'auto';

    // Optimistic user message
    _appendMessage({
      id: 'temp-' + Date.now(),
      chat_id: chatId,
      user_id: _myId,
      user_name: 'Вы',
      message: text,
      created_at: new Date().toISOString()
    });

    // Show typing
    _showTyping('Мимир');

    try {
      const resp = await API.sendMimir(chatId, text);
      // Typing will be hidden by SSE new_message or manually
      const typing = $('#chat-typing');
      if (typing) typing.style.display = 'none';
      // If SSE didn't catch it, reload
      if (resp?.mimir_message) {
        _appendMessage({ ...resp.mimir_message, user_name: 'Мимир', is_mimir_bot: true });
      }
    } catch (e) {
      const typing = $('#chat-typing');
      if (typing) typing.style.display = 'none';
      toast('Мимир не отвечает', 'error');
    } finally {
      if (sendBtn) sendBtn.classList.remove('sending');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════════════════════════

  let _lastTypingSent = 0;
  function _onTyping(chatId) {
    if (_currentChatData?.is_mimir) return;
    const now = Date.now();
    if (now - _lastTypingSent > 3000) {
      _lastTypingSent = now;
      API.sendTyping(chatId);
    }
  }

  function handleKeyDown(event, chatId) {
    // Enter = send, Shift+Enter = newline
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage(chatId);
      return;
    }
    // Escape = cancel reply or search
    if (event.key === 'Escape') {
      if (_replyToId) cancelReply();
      if (_searchMode) toggleSearch();
      return;
    }
    // Arrow up = edit last message
    if (event.key === 'ArrowUp' && !event.target.value) {
      event.preventDefault();
      _editLastMessage(chatId);
      return;
    }
  }

  function autoResizeInput(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  async function sendMessage(chatId) {
    // Mimir has its own flow
    if (_currentChatData?.is_mimir) { await _sendMimirMessage(chatId); return; }

    const input = $('#chat-message-input');
    const text = input?.value?.trim();
    if (!text) return;

    const sendBtn = $('.chat-send-btn');
    if (sendBtn) sendBtn.classList.add('sending');

    // Оптимистичный UI: показать сообщение мгновенно
    const tempId = 'temp-' + Date.now();
    const auth = AsgardAuth?.getAuth?.();
    const tempMsg = {
      id: tempId,
      chat_id: chatId,
      user_id: _myId,
      user_name: auth?.user?.name || 'Я',
      message: text,
      text: text,
      created_at: new Date().toISOString(),
      reply_to_id: _replyToId || null,
      _optimistic: true
    };
    _appendMessage(tempMsg);

    // Очищаем ввод сразу
    input.value = '';
    input.style.height = 'auto';
    const savedReplyId = _replyToId;
    cancelReply();

    try {
      const result = await API.sendMessage(chatId, text, savedReplyId);
      // Заменить tempId на реальный ID из ответа сервера
      if (result?.message?.id || result?.id) {
        const realId = result.message?.id || result.id;
        const tempEl = document.querySelector(`[data-msg-id="${tempId}"]`);
        if (tempEl) {
          tempEl.setAttribute('data-msg-id', realId);
          tempEl.classList.remove('chat-msg-pending');
        }
      }
    } catch (e) {
      // Пометить сообщение как failed
      const failedEl = document.querySelector(`[data-msg-id="${tempId}"]`);
      if (failedEl) {
        failedEl.classList.remove('chat-msg-pending');
        failedEl.classList.add('chat-msg-failed');
        const meta = failedEl.querySelector('.chat-message-time');
        if (meta) meta.textContent = 'Ошибка отправки';
      }
      toast('Ошибка отправки', 'error');
    } finally {
      if (sendBtn) sendBtn.classList.remove('sending');
    }
  }

  async function react(chatId, messageId, emoji) {
    try {
      await API.addReaction(chatId, messageId, emoji);
    } catch (e) {
      toast('Ошибка', 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Reply
  // ═══════════════════════════════════════════════════════════════

  function setReply(messageId, userName, text) {
    _replyToId = messageId;
    _replyToUser = userName;
    _replyToText = text;
    let bar = $('#chat-reply-bar');
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.className = 'chat-reply-bar';
    bar.id = 'chat-reply-bar';
    bar.innerHTML = `<div class="chat-reply-bar-content"><div class="chat-reply-bar-name">${esc(userName)}</div><div class="chat-reply-bar-text">${esc(text)}</div></div><button class="chat-reply-bar-close" onclick="AsgardChatGroups.cancelReply()">&times;</button>`;
    const inputArea = $('.chat-input-area');
    if (inputArea) inputArea.parentNode.insertBefore(bar, inputArea);
    const input = $('#chat-message-input');
    if (input) input.focus();
  }

  function cancelReply() {
    _replyToId = null; _replyToText = ''; _replyToUser = '';
    const bar = $('#chat-reply-bar');
    if (bar) bar.remove();
  }

  // ═══════════════════════════════════════════════════════════════
  // Edit last message
  // ═══════════════════════════════════════════════════════════════

  async function _editLastMessage(chatId) {
    const msgs = $$(`#chat-messages-container .chat-message.own`);
    if (msgs.length === 0) return;
    const lastMsg = msgs[msgs.length - 1];
    const msgId = lastMsg.dataset.msgId;
    const textEl = lastMsg.querySelector('.chat-message-text');
    if (!textEl) return;
    const oldText = textEl.textContent;
    const newText = prompt('Редактировать сообщение:', oldText);
    if (newText !== null && newText.trim() !== oldText) {
      try {
        await API.editMessage(chatId, msgId, newText.trim());
        textEl.textContent = '';
        textEl.appendChild(parseMarkdown(newText.trim()));
        const timeEl = lastMsg.querySelector('.chat-message-time');
        if (timeEl && !timeEl.textContent.includes('ред.')) timeEl.textContent += ' (ред.)';
      } catch (e) {
        toast('Ошибка редактирования', 'error');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Emoji picker
  // ═══════════════════════════════════════════════════════════════

  function showReactionPicker(messageId) {
    const emojis = ['👍','❤️','😂','😮','😢','🔥','👏','🎉'];
    const old = document.querySelector('.chat-reaction-picker');
    if (old) old.remove();
    const picker = document.createElement('div');
    picker.className = 'chat-reaction-picker';
    picker.innerHTML = emojis.map(e => `<span class="chat-reaction-option" onclick="AsgardChatGroups.react(${currentChatId}, ${messageId}, '${e}'); this.parentNode.remove();">${e}</span>`).join('');
    const msgEl = document.querySelector(`[data-msg-id="${messageId}"] .chat-message-bubble`);
    if (msgEl) { msgEl.appendChild(picker); setTimeout(() => picker.remove(), 5000); }
  }

  function toggleEmojiPicker() {
    const emojis = ['😀','😂','😍','🤔','👍','👎','❤️','🔥','🎉','👏','😢','😮','💪','🙏','✅','❌'];
    let picker = $('#chat-emoji-picker');
    if (picker) { picker.remove(); return; }
    picker = document.createElement('div');
    picker.id = 'chat-emoji-picker';
    picker.className = 'chat-emoji-picker-panel';
    picker.innerHTML = emojis.map(e => `<span class="chat-emoji-option" onclick="AsgardChatGroups.insertEmoji('${e}')">${e}</span>`).join('');
    const inputArea = $('.chat-input-area');
    if (inputArea) inputArea.parentNode.insertBefore(picker, inputArea);
  }

  function insertEmoji(emoji) {
    const input = $('#chat-message-input');
    if (input) { input.value += emoji; input.focus(); }
    const picker = $('#chat-emoji-picker');
    if (picker) picker.remove();
  }

  // ═══════════════════════════════════════════════════════════════
  // Search in chat (Ctrl+F)
  // ═══════════════════════════════════════════════════════════════

  function toggleSearch() {
    _searchMode = !_searchMode;
    const bar = $('#hg-search-bar');
    if (bar) {
      bar.style.display = _searchMode ? 'flex' : 'none';
      if (_searchMode) {
        const input = $('#hg-search-input');
        if (input) { input.value = ''; input.focus(); }
      } else {
        // Clear highlights
        $$('.hg-search-highlight').forEach(el => { el.classList.remove('hg-search-highlight'); });
      }
    }
  }

  function searchInChat(query) {
    $$('.hg-search-highlight').forEach(el => el.classList.remove('hg-search-highlight'));
    if (!query || query.length < 2) { const c = $('#hg-search-count'); if (c) c.textContent = ''; return; }
    const q = query.toLowerCase();
    let count = 0;
    $$('#chat-messages-container .chat-message').forEach(el => {
      const text = (el.querySelector('.chat-message-text')?.textContent || '').toLowerCase();
      if (text.includes(q)) {
        el.classList.add('hg-search-highlight');
        count++;
      }
    });
    const c = $('#hg-search-count');
    if (c) c.textContent = count > 0 ? count + ' найдено' : 'не найдено';
    // Scroll to first match
    const first = document.querySelector('.hg-search-highlight');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ═══════════════════════════════════════════════════════════════
  // S12: Link Previews (Open Graph)
  // ═══════════════════════════════════════════════════════════════
  const _lpCache = {};
  function _loadLinkPreviews() {
    document.querySelectorAll('.huginn-link-preview--shimmer[data-preview-url]').forEach(el => {
      const url = el.dataset.previewUrl;
      if (!url) return;
      if (_lpCache[url]) { _renderDesktopPreview(el, _lpCache[url], url); return; }
      fetch('/api/chat-groups/link-preview?url=' + encodeURIComponent(url), {
        headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
      })
        .then(r => r.json())
        .then(data => { _lpCache[url] = data; _renderDesktopPreview(el, data, url); })
        .catch(() => el.remove());
    });
  }
  function _renderDesktopPreview(shimmer, data, url) {
    if (!data || !data.title) { shimmer.remove(); return; }
    const card = document.createElement('a');
    card.className = 'huginn-link-preview';
    card.href = url; card.target = '_blank'; card.rel = 'noopener';
    let html = '';
    if (data.image) html += `<img class="huginn-link-preview__img" src="${esc(data.image)}" onerror="this.remove()">`;
    html += `<div class="huginn-link-preview__body">`;
    if (data.domain) html += `<div class="huginn-link-preview__domain">${esc(data.domain)}</div>`;
    html += `<div class="huginn-link-preview__title">${esc(data.title)}</div>`;
    if (data.description) html += `<div class="huginn-link-preview__desc">${esc(data.description)}</div>`;
    html += `</div>`;
    card.innerHTML = html;
    shimmer.parentNode.replaceChild(card, shimmer);
  }

  // ═══════════════════════════════════════════════════════════════
  // Right-click context menu
  // ═══════════════════════════════════════════════════════════════

  function _setupContextMenu(chatId) {
    const container = $('#chat-messages-container');
    if (!container) return;
    container.addEventListener('contextmenu', (e) => {
      const msgEl = e.target.closest('.chat-message');
      if (!msgEl) return;
      e.preventDefault();
      _removeContextMenu();
      const msgId = msgEl.dataset.msgId;
      const isOwn = msgEl.classList.contains('own');
      const text = msgEl.querySelector('.chat-message-text')?.textContent || '';
      const userName = msgEl.querySelector('.chat-message-sender')?.textContent || '';

      const menu = document.createElement('div');
      menu.className = 'hg-ctx-menu';
      menu.innerHTML = `
        <div class="hg-ctx-item" data-action="reply">↩ Ответить</div>
        <div class="hg-ctx-item" data-action="copy">📋 Копировать</div>
        ${isOwn ? '<div class="hg-ctx-item" data-action="edit">✏️ Редактировать</div>' : ''}
        ${isOwn ? '<div class="hg-ctx-item hg-ctx-danger" data-action="delete">🗑 Удалить</div>' : ''}
      `;
      menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
      menu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
      document.body.appendChild(menu);

      menu.addEventListener('click', async (ev) => {
        const action = ev.target.closest('.hg-ctx-item')?.dataset.action;
        _removeContextMenu();
        if (action === 'reply') setReply(msgId, userName || 'Вы', text.substring(0, 50));
        else if (action === 'copy') { navigator.clipboard.writeText(text).then(() => toast('Скопировано', 'success')).catch(() => {}); }
        else if (action === 'edit') {
          const newText = prompt('Редактировать:', text);
          if (newText !== null && newText.trim() !== text) {
            await API.editMessage(chatId, msgId, newText.trim());
            const el = msgEl.querySelector('.chat-message-text');
            if (el) { el.textContent = ''; el.appendChild(parseMarkdown(newText.trim())); }
          }
        }
        else if (action === 'delete') {
          if (confirm('Удалить сообщение?')) {
            await API.deleteMessage(chatId, msgId);
            msgEl.style.transition = 'opacity 200ms, max-height 200ms';
            msgEl.style.opacity = '0';
            setTimeout(() => msgEl.remove(), 250);
          }
        }
      });

      setTimeout(() => document.addEventListener('click', _removeContextMenu, { once: true }), 50);
    });
  }

  // S12: Double-click → ❤️ reaction (desktop)
  function _setupDoubleTap(chatId) {
    const container = $('#chat-messages-container');
    if (!container) return;
    container.addEventListener('dblclick', (e) => {
      const msgEl = e.target.closest('.chat-message');
      if (!msgEl) return;
      const msgId = msgEl.dataset.msgId;
      if (!msgId) return;
      react(chatId, parseInt(msgId), '❤️');
      // Heart animation
      const heart = document.createElement('div');
      heart.className = 'huginn-heart-anim';
      heart.textContent = '❤️';
      heart.style.left = e.clientX + 'px';
      heart.style.top = e.clientY + 'px';
      document.body.appendChild(heart);
      setTimeout(() => heart.remove(), 650);
    });
  }

  function _removeContextMenu() {
    const old = document.querySelector('.hg-ctx-menu');
    if (old) old.remove();
  }

  // ═══════════════════════════════════════════════════════════════
  // Drag & drop
  // ═══════════════════════════════════════════════════════════════

  function _dragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const overlay = $('#hg-drop-overlay');
    if (overlay) overlay.style.display = 'flex';
  }

  function _dragLeave(e) {
    const overlay = $('#hg-drop-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  async function _drop(e, chatId) {
    e.preventDefault();
    const overlay = $('#hg-drop-overlay');
    if (overlay) overlay.style.display = 'none';
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 50 * 1024 * 1024) { toast('Файл слишком большой (макс. 50 МБ)', 'error'); continue; }
      try {
        await API.uploadFile(chatId, file, '');
        toast(file.name + ' отправлен', 'success');
      } catch (e) {
        toast('Ошибка: ' + file.name, 'error');
      }
    }
    await loadChatMessages(chatId);
  }

  // ═══════════════════════════════════════════════════════════════
  // File select
  // ═══════════════════════════════════════════════════════════════

  async function handleFileSelect(input, chatId) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { toast('Файл слишком большой (макс. 50 МБ)', 'error'); input.value = ''; return; }
    try {
      await API.uploadFile(chatId, file, '');
      toast('Файл отправлен', 'success');
      await loadChatMessages(chatId);
    } catch (e) {
      toast('Ошибка отправки файла', 'error');
    } finally {
      input.value = '';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Modals
  // ═══════════════════════════════════════════════════════════════

  async function showNewChatMenu() {
    const users = await AsgardDB.getAll('users') || [];
    const activeUsers = users.filter(u => u.is_active && u.id !== _myId && u.name && u.name.trim());

    const html = `
      <div style="min-width:min(420px,calc(100vw - 32px));max-width:min(520px,calc(100vw - 32px));">
        <div style="display:flex;gap:10px;margin-bottom:20px;">
          <button class="btn primary" id="tabDirect" onclick="document.getElementById('directPanel').style.display='';document.getElementById('groupPanel').style.display='none';this.classList.add('primary');document.getElementById('tabGroup').classList.remove('primary')">Личное</button>
          <button class="btn" id="tabGroup" onclick="document.getElementById('groupPanel').style.display='';document.getElementById('directPanel').style.display='none';this.classList.add('primary');document.getElementById('tabDirect').classList.remove('primary')">Группа</button>
        </div>
        <div id="directPanel">
          <input type="text" class="inp" placeholder="Поиск..." id="directUserSearch" style="margin-bottom:12px;width:100%">
          <div class="emp-selector" id="directUserList" style="max-height:350px">
            ${activeUsers.map(u => `<div class="emp-selector-item" onclick="AsgardChatGroups.startDirect(${u.id})" style="cursor:pointer"><div class="emp-selector-avatar" style="background:${getAvatarColor(u.name)}">${getInitials(u.name)}</div><div class="emp-selector-info"><div class="emp-selector-name">${esc(u.name)}</div><div class="emp-selector-role">${esc(u.role || '')}</div></div></div>`).join('')}
          </div>
        </div>
        <div id="groupPanel" style="display:none">
          <div class="form-group"><label>Название *</label><input type="text" id="new-chat-name" class="input" placeholder="Например: Проект Альфа"></div>
          <div class="form-group"><label>Описание</label><textarea id="new-chat-desc" class="input" rows="2" placeholder="Краткое описание..."></textarea></div>
          <div class="form-group"><label>Участники</label>
            <input type="text" class="inp" placeholder="Поиск..." id="memberSearch" style="margin-bottom:8px;width:100%">
            <div class="emp-selector" id="memberList" style="max-height:250px">
              ${activeUsers.map(u => `<label class="emp-selector-item"><input type="checkbox" name="chat-members" value="${u.id}"><div class="emp-selector-check">\u2713</div><div class="emp-selector-avatar" style="background:${getAvatarColor(u.name)}">${getInitials(u.name)}</div><div class="emp-selector-info"><div class="emp-selector-name">${esc(u.name)}</div><div class="emp-selector-role">${esc(u.role || '')}</div></div></label>`).join('')}
            </div>
          </div>
          <div class="row between mt-3"><button class="btn" onclick="AsgardUI.closeModal()">Отмена</button><button class="btn primary" onclick="AsgardChatGroups.createChat()">Создать</button></div>
        </div>
      </div>`;

    showModal('Новый чат', html);

    const ds = document.getElementById('directUserSearch');
    if (ds) { ds.addEventListener('input', function() { const q = this.value.toLowerCase(); document.querySelectorAll('#directUserList .emp-selector-item').forEach(i => { i.style.display = (i.querySelector('.emp-selector-name')?.textContent || '').toLowerCase().includes(q) ? '' : 'none'; }); }); ds.focus(); }
    const ms = document.getElementById('memberSearch');
    if (ms) { ms.addEventListener('input', function() { const q = this.value.toLowerCase(); document.querySelectorAll('#memberList .emp-selector-item').forEach(i => { i.style.display = (i.querySelector('.emp-selector-name')?.textContent || '').toLowerCase().includes(q) ? '' : 'none'; }); }); }
  }

  async function startDirect(userId) {
    try {
      const result = await API.openDirect(userId);
      if (result.error) { toast(result.error, 'error'); return; }
      closeModal();
      currentChatId = result.chat.id;
      await refresh();
    } catch (e) { toast('Ошибка', 'error'); }
  }

  async function createChat() {
    const name = $('#new-chat-name')?.value?.trim();
    const description = $('#new-chat-desc')?.value?.trim();
    const memberIds = Array.from($$('input[name="chat-members"]:checked')).map(cb => parseInt(cb.value));
    if (!name) { toast('Укажите название', 'error'); return; }
    try {
      const result = await API.createChat({ name, description, member_ids: memberIds });
      if (result.error) { toast(result.error, 'error'); return; }
      toast('Чат создан', 'success');
      closeModal();
      if (result.chat?.id) currentChatId = result.chat.id;
      await refresh();
    } catch (e) { toast('Ошибка', 'error'); }
  }

  async function showMembersModal(chatId) {
    const chatResp = await API.getChat(chatId);
    const members = chatResp?.members || [];
    const myRole = chatResp?.myRole || 'member';
    const users = await AsgardDB.getAll('users') || [];
    const memberIds = new Set(members.map(m => m.user_id));
    const available = users.filter(u => u.is_active && !memberIds.has(u.id) && u.name && u.name.trim());

    const html = `<div style="min-width:min(380px,calc(100vw - 32px));">
      <div style="max-height:350px;overflow-y:auto">${members.map(m => `
        <div class="chat-member-row">
          <div class="chat-member-row-left">
            <div class="chat-member-row-avatar" style="background:${getAvatarColor(m.name)}">${getInitials(m.name)}${m.is_active ? '<span class="chat-member-online-dot"></span>' : ''}</div>
            <div class="chat-member-row-info"><div class="chat-member-row-name">${esc(m.name)}</div><div class="chat-member-row-role">${m.role === 'owner' ? 'Владелец' : m.role === 'admin' ? 'Админ' : 'Участник'}</div></div>
          </div>
        </div>`).join('')}</div>
      ${(myRole === 'owner' || myRole === 'admin') && available.length > 0 ? `<div class="mt-3"><label>Добавить:</label><div class="row" style="gap:8px;margin-top:8px"><div id="crw_add_member" style="flex:1"></div><button class="btn primary" onclick="AsgardChatGroups.addMember(${chatId})">Добавить</button></div></div>` : ''}
      <div class="row between mt-4"><button class="btn" style="color:var(--error)" onclick="AsgardChatGroups.leaveChat(${chatId})">Покинуть</button><button class="btn" onclick="AsgardUI.closeModal()">Закрыть</button></div>
    </div>`;
    showModal('Участники', html);

    // Монтируем CRSelect для добавления участника
    if (available.length > 0) {
      const memberOpts = available.map(u => ({ value: String(u.id), label: u.name }));
      $('#crw_add_member')?.appendChild(CRSelect.create({
        id: 'add_member_select', fullWidth: true, searchable: true, dropdownClass: 'z-modal',
        options: memberOpts, value: memberOpts[0]?.value || ''
      }));
    }
  }

  async function addMember(chatId) {
    const userId = CRSelect.getValue('add_member_select');
    if (!userId) return;
    try {
      const r = await API.addMember(chatId, parseInt(userId));
      if (r.error) { toast(r.error, 'error'); return; }
      toast('Добавлен', 'success');
      await showMembersModal(chatId);
    } catch (e) { toast('Ошибка', 'error'); }
  }

  async function leaveChat(chatId) {
    if (!confirm('Покинуть чат?')) return;
    try {
      await API.leaveChat(chatId);
      toast('Вы покинули чат', 'success');
      closeModal();
      currentChatId = null;
      await refresh();
    } catch (e) { toast('Ошибка', 'error'); }
  }

  async function showSettingsModal(chatId) {
    const html = `<div style="min-width:min(320px,calc(100vw - 32px));">
      <div class="form-group"><label>Уведомления</label>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn" onclick="AsgardChatGroups.muteChat(${chatId}, 0)">Включить</button>
          <button class="btn" onclick="AsgardChatGroups.muteChat(${chatId}, 24)">Выкл. 24ч</button>
          <button class="btn" onclick="AsgardChatGroups.muteChat(${chatId}, 168)">Выкл. неделю</button>
        </div>
      </div>
      <div class="row between mt-4"><button class="btn" onclick="AsgardUI.closeModal()">Закрыть</button></div>
    </div>`;
    showModal('Настройки', html);
  }

  async function muteChat(chatId, hours) {
    try {
      await API.muteChat(chatId, hours);
      toast(hours > 0 ? 'Уведомления выключены' : 'Уведомления включены', 'success');
      closeModal();
    } catch (e) { toast('Ошибка', 'error'); }
  }

  // ═══════════════════════════════════════════════════════════════
  // Global keyboard shortcuts
  // ═══════════════════════════════════════════════════════════════

  function _globalKeyHandler(e) {
    if (!location.hash.includes('/messenger')) return;
    // Ctrl+F — search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && currentChatId) {
      e.preventDefault();
      if (!_searchMode) toggleSearch();
      else { const inp = $('#hg-search-input'); if (inp) inp.focus(); }
    }
  }

  document.addEventListener('keydown', _globalKeyHandler);

  // ═══════════════════════════════════════════════════════════════
  // Refresh & cleanup
  // ═══════════════════════════════════════════════════════════════

  async function refresh() {
    await render({ layout: _savedLayout });
  }

  window.addEventListener('hashchange', () => {
    if (!location.hash.includes('/messenger') && !location.hash.includes('/chat-groups')) {
      _sseCleanup();
      currentChatId = null;
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Export
  // ═══════════════════════════════════════════════════════════════

  return {
    render, refresh, openChat, backToList, sendMessage, handleKeyDown, autoResizeInput,
    react, showNewChatMenu, createChat, startDirect, handleFileSelect,
    showMembersModal, addMember, leaveChat, showSettingsModal, muteChat,
    filterChats, filterByTab, setReply, cancelReply, showReactionPicker, toggleEmojiPicker, insertEmoji,
    openMimir, toggleSearch, searchInChat, startVoiceRecording,
    _playVoice, _dragOver, _dragLeave, _drop, _onTyping
  };
})();
