/**
 * ASGARD AI Assistant - Chat Widget
 * ═══════════════════════════════════════════════════════════════════════════
 * Виджет чата с AI-помощником в правом нижнем углу
 */

window.AsgardAI = (function(){
  const { esc, toast } = AsgardUI;
  
  let isOpen = false;
  let isMinimized = false;
  let messages = [];
  let attachedFiles = [];
  let isLoading = false;
  let conversationId = null;
  let thinkSeconds = 0;
  let thinkTimer = null;
  let activeAbort = null;
  let availableModels = [];
  let selectedModelId = null;

  function getToken() {
    try { return localStorage.getItem('asgard_token') || localStorage.getItem('token'); } catch (e) { return null; }
  }

  function startThinkTicker() {
    thinkSeconds = 0;
    if (thinkTimer) clearInterval(thinkTimer);
    thinkTimer = setInterval(() => { thinkSeconds++; renderMessages(); }, 1000);
  }

  function stopThinkTicker() {
    if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
    thinkSeconds = 0;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Styles
  // ─────────────────────────────────────────────────────────────────────────────
  const styles = `
    <style id="asgard-ai-styles">
      .ai-widget {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999;
        font-family: var(--font-main, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      }
      
      .ai-toggle {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg, #c0392b 0%, #2a3b66 100%);
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 20px rgba(192, 57, 43, 0.4);
        transition: all 0.3s ease;
        position: relative;
      }
      
      .ai-toggle:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 30px rgba(192, 57, 43, 0.5);
      }
      
      .ai-toggle svg {
        width: 28px;
        height: 28px;
        fill: white;
      }
      
      .ai-toggle.has-badge::after {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        width: 14px;
        height: 14px;
        background: var(--ok-t);
        border-radius: 50%;
        border: 2px solid var(--bg2);
      }
      
      .ai-panel {
        position: absolute;
        bottom: 70px;
        right: 0;
        width: 380px;
        max-width: calc(100vw - 48px);
        height: 500px;
        max-height: calc(100vh - 120px);
        background: linear-gradient(180deg, var(--bg2) 0%, var(--bg3) 100%);
        border-radius: 6px;
        border: 1px solid rgba(192, 57, 43, 0.3);
        box-shadow: var(--shadow-xl);
        display: none;
        flex-direction: column;
        overflow: hidden;
      }
      
      .ai-panel.open {
        display: flex;
        animation: aiSlideUp 0.3s ease;
      }
      
      .ai-panel.minimized {
        height: 56px;
      }
      
      @keyframes aiSlideUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      .ai-header {
        padding: 16px;
        background: linear-gradient(135deg, rgba(192, 57, 43, 0.2) 0%, rgba(42, 59, 102, 0.2) 100%);
        border-bottom: 1px solid var(--brd);
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
      }
      
      .ai-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: linear-gradient(135deg, #c0392b, #2a3b66);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .ai-avatar svg {
        width: 20px;
        height: 20px;
        fill: white;
      }
      
      .ai-header-info {
        flex: 1;
      }
      
      .ai-header-title {
        font-weight: 700;
        font-size: 14px;
        color: var(--t1);
      }

      .ai-header-status {
        font-size: 12px;
        color: var(--t2);
      }
      
      .ai-header-actions {
        display: flex;
        gap: 8px;
      }
      
      .ai-header-btn {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: none;
        background: var(--brd);
        color: var(--t2);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }

      .ai-header-btn:hover {
        background: var(--brd-m);
        color: var(--t1);
      }
      
      .ai-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      
      .ai-message {
        max-width: 85%;
        padding: 12px 16px;
        border-radius: 6px;
        font-size: 14px;
        line-height: 1.5;
        animation: aiFadeIn 0.3s ease;
      }
      
      @keyframes aiFadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      .ai-message.user {
        align-self: flex-end;
        background: linear-gradient(135deg, #c0392b, #a33527);
        color: white;
        border-bottom-right-radius: 4px;
      }
      
      .ai-message.assistant {
        align-self: flex-start;
        background: rgba(42, 59, 102, 0.5);
        color: var(--t1);
        border-bottom-left-radius: 4px;
      }
      
      .ai-message.assistant a {
        color: var(--info-t);
      }
      
      .ai-message-files {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      
      .ai-file-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: var(--brd);
        border-radius: 6px;
        font-size: 11px;
        color: var(--t1);
      }
      
      .ai-typing {
        display: flex;
        gap: 4px;
        padding: 12px 16px;
        align-self: flex-start;
      }
      
      .ai-typing span {
        width: 8px;
        height: 8px;
        background: var(--t3);
        border-radius: 50%;
        animation: aiTyping 1.4s infinite;
      }
      
      .ai-typing span:nth-child(2) { animation-delay: 0.2s; }
      .ai-typing span:nth-child(3) { animation-delay: 0.4s; }
      
      @keyframes aiTyping {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
        30% { transform: translateY(-6px); opacity: 1; }
      }
      
      .ai-input-area {
        padding: 12px 16px;
        border-top: 1px solid var(--brd);
        background: var(--bg3);
      }
      
      .ai-attachments {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
      }
      
      .ai-attachment {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        background: rgba(192, 57, 43, 0.2);
        border: 1px solid rgba(192, 57, 43, 0.3);
        border-radius: 6px;
        font-size: 12px;
        color: var(--t1);
      }

      .ai-attachment-remove {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: none;
        background: var(--brd-m);
        color: var(--t1);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
      }
      
      .ai-input-row {
        display: flex;
        gap: 8px;
        align-items: flex-end;
      }
      
      .ai-attach-btn {
        width: 40px;
        height: 40px;
        border-radius: 6px;
        border: 1px solid var(--brd);
        background: transparent;
        color: var(--t2);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        flex-shrink: 0;
      }
      
      .ai-attach-btn:hover {
        border-color: rgba(192, 57, 43, 0.5);
        color: var(--t1);
      }

      .ai-input-wrap {
        flex: 1;
        position: relative;
      }
      
      .ai-input {
        width: 100%;
        padding: 10px 14px;
        border-radius: 6px;
        border: 1px solid var(--brd);
        background: var(--bg3);
        color: var(--t1);
        font-size: 14px;
        resize: none;
        min-height: 40px;
        max-height: 100px;
        outline: none;
        transition: border-color 0.2s;
      }
      
      .ai-input::placeholder {
        color: var(--t3);
      }
      
      .ai-input:focus {
        border-color: rgba(192, 57, 43, 0.5);
      }
      
      .ai-send-btn {
        width: 40px;
        height: 40px;
        border-radius: 6px;
        border: none;
        background: linear-gradient(135deg, #c0392b, #a33527);
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        flex-shrink: 0;
      }
      
      .ai-send-btn:hover {
        transform: scale(1.05);
      }
      
      .ai-send-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }
      
      .ai-welcome {
        text-align: center;
        padding: 32px 24px;
        color: var(--t2);
      }
      
      .ai-welcome-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 16px;
        background: linear-gradient(135deg, rgba(192, 57, 43, 0.2), rgba(42, 59, 102, 0.2));
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .ai-welcome-icon svg {
        width: 32px;
        height: 32px;
        fill: var(--t3);
      }
      
      .ai-welcome h3 {
        color: var(--t1);
        font-size: 18px;
        margin-bottom: 8px;
      }
      
      .ai-suggestions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: center;
        margin-top: 16px;
      }
      
      .ai-suggestion {
        padding: 8px 14px;
        background: var(--bg3);
        border: 1px solid var(--brd);
        border-radius: 6px;
        color: var(--t1);
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .ai-suggestion:hover {
        background: rgba(192, 57, 43, 0.2);
        border-color: rgba(192, 57, 43, 0.4);
      }
      
      @media (max-width: 480px) {
        .ai-panel {
          width: calc(100vw - 32px);
          right: -8px;
          bottom: 70px;
          height: calc(100vh - 140px);
        }
        
        .ai-widget {
          bottom: 16px;
          right: 16px;
        }
      }
    </style>
  `;
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Icons
  // ─────────────────────────────────────────────────────────────────────────────
  const icons = {
    bot: `<svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2M7.5 13A2.5 2.5 0 005 15.5 2.5 2.5 0 007.5 18a2.5 2.5 0 002.5-2.5A2.5 2.5 0 007.5 13m9 0a2.5 2.5 0 00-2.5 2.5 2.5 2.5 0 002.5 2.5 2.5 2.5 0 002.5-2.5 2.5 2.5 0 00-2.5-2.5z"/></svg>`,
    close: `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    minimize: `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 13H5v-2h14v2z"/></svg>`,
    send: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
    attach: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 015 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 005 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>`,
    file: `<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"/></svg>`
  };
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Initialize Widget
  // ─────────────────────────────────────────────────────────────────────────────
  function init() {
    // Only show for authenticated users and not on welcome/login pages
    const hash = location.hash || '';
    if (hash.includes('welcome') || hash.includes('login') || hash.includes('register')) {
      return;
    }
    
    // Check authentication
    if (!window.AsgardAuth) return;
    AsgardAuth.requireUser().then(auth => {
      if (auth) {
        render();
      }
    }).catch(() => {});
  }
  
  function render() {
    // Remove existing widget
    const existing = document.getElementById('asgard-ai-widget');
    if (existing) existing.remove();
    
    // Add styles
    if (!document.getElementById('asgard-ai-styles')) {
      document.head.insertAdjacentHTML('beforeend', styles);
    }
    
    // Create widget
    const widget = document.createElement('div');
    widget.id = 'asgard-ai-widget';
    widget.className = 'ai-widget';
    widget.innerHTML = `
      <div class="ai-panel" id="aiPanel">
        <div class="ai-header" id="aiHeader">
          <div class="ai-avatar">${icons.bot}</div>
          <div class="ai-header-info">
            <div class="ai-header-title">AI Помощник</div>
            <div class="ai-header-status">Готов помочь</div>
          </div>
          <div class="ai-header-actions">
            <select id="aiModelSelect" class="ai-model-select" title="Модель Мимира" style="background:rgba(255,255,255,0.12);color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:6px;padding:3px 6px;font-size:11px;margin-right:6px;cursor:pointer;max-width:140px;"></select>
            <button class="ai-header-btn" id="aiMinimize" title="Свернуть">${icons.minimize}</button>
            <button class="ai-header-btn" id="aiClose" title="Закрыть">${icons.close}</button>
          </div>
        </div>
        <div id="aiModelHint" style="display:none;"></div>
        <div class="ai-messages" id="aiMessages">
          <div class="ai-welcome">
            <div class="ai-welcome-icon">${icons.bot}</div>
            <h3>Привет! Я AI-помощник</h3>
            <p>Задайте вопрос или прикрепите файл для анализа</p>
            <div class="ai-suggestions">
              <button class="ai-suggestion" data-q="Как создать новый тендер?">Создать тендер</button>
              <button class="ai-suggestion" data-q="Покажи статистику за месяц">Статистика</button>
              <button class="ai-suggestion" data-q="Как добавить расходы?">Добавить расходы</button>
            </div>
          </div>
        </div>
        <div class="ai-input-area">
          <div class="ai-attachments" id="aiAttachments"></div>
          <div class="ai-input-row">
            <button class="ai-attach-btn" id="aiAttachBtn" title="Прикрепить файл">${icons.attach}</button>
            <input type="file" id="aiFileInput" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg">
            <div class="ai-input-wrap">
              <textarea class="ai-input" id="aiInput" placeholder="Напишите сообщение..." rows="1"></textarea>
            </div>
            <button class="ai-send-btn" id="aiSend" title="Отправить">${icons.send}</button>
          </div>
        </div>
      </div>
      <button class="ai-toggle" id="aiToggle" title="AI Помощник">
        ${icons.bot}
      </button>
    `;
    
    document.body.appendChild(widget);
    bindEvents();
    loadChatModels();
  }

  async function loadChatModels() {
    const token = getToken();
    if (!token) return;
    try {
      const resp = await fetch('/api/mimir/chat/models', { headers: { 'Authorization': 'Bearer ' + token } });
      if (!resp.ok) return;
      const data = await resp.json();
      availableModels = data.models || [];
      const stored = localStorage.getItem('asgard_ai_model');
      selectedModelId = (stored && availableModels.find(m => m.id === stored)) ? stored : (data.default || availableModels[0]?.id);
      renderModelSelect();
    } catch (e) { /* silently fall back to backend default */ }
  }

  function renderModelSelect() {
    const sel = document.getElementById('aiModelSelect');
    if (!sel || !availableModels.length) return;
    sel.innerHTML = availableModels.map(m => {
      const isSel = (m.id === selectedModelId) ? ' selected' : '';
      const hint = m.short_hint ? `  · ${m.short_hint}` : '';
      return `<option value="${esc(m.id)}"${isSel} title="${esc(m.description || '')}">${esc(m.label)}${esc(hint)}</option>`;
    }).join('');
    sel.onchange = () => {
      selectedModelId = sel.value;
      try { localStorage.setItem('asgard_ai_model', selectedModelId); } catch (e) {}
      renderModelHint();
      renderMessages();
    };
    renderModelHint();
  }

  function renderModelHint() {
    const hintEl = document.getElementById('aiModelHint');
    if (!hintEl) return;
    const m = availableModels.find(x => x.id === selectedModelId);
    if (!m) { hintEl.style.display = 'none'; return; }
    const caps = m.capabilities || {};
    const knows = caps.knows_crm_data;
    const bg = knows ? 'rgba(46,160,67,0.12)' : 'rgba(212,168,67,0.12)';
    const bd = knows ? 'rgba(46,160,67,0.35)' : 'rgba(212,168,67,0.4)';
    const ic = knows ? '🧠' : '⚡';
    const txt = knows
      ? 'Эта модель видит данные CRM (тендеры, работы, финансы) и помнит диалог. Можно спрашивать про цифры.'
      : 'Эта модель НЕ видит данные CRM — отвечает только на общие вопросы про систему. Для вопросов про ваши тендеры/финансы переключи на «🧠 с данными CRM».';
    hintEl.style.cssText = `display:flex;gap:8px;align-items:flex-start;padding:6px 10px;margin:6px 12px 4px;background:${bg};border:1px solid ${bd};border-radius:8px;font-size:11px;color:var(--text-secondary,#aaa);`;
    hintEl.innerHTML = `<span style="font-size:14px;line-height:1;">${ic}</span><span>${esc(txt)}</span>`;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Event Handlers
  // ─────────────────────────────────────────────────────────────────────────────
  function bindEvents() {
    const toggle = document.getElementById('aiToggle');
    const panel = document.getElementById('aiPanel');
    const closeBtn = document.getElementById('aiClose');
    const minimizeBtn = document.getElementById('aiMinimize');
    const header = document.getElementById('aiHeader');
    const input = document.getElementById('aiInput');
    const sendBtn = document.getElementById('aiSend');
    const attachBtn = document.getElementById('aiAttachBtn');
    const fileInput = document.getElementById('aiFileInput');
    
    // Toggle panel
    toggle.addEventListener('click', () => {
      isOpen = !isOpen;
      panel.classList.toggle('open', isOpen);
      if (isOpen) {
        input.focus();
        isMinimized = false;
        panel.classList.remove('minimized');
      }
    });
    
    // Close panel
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isOpen = false;
      panel.classList.remove('open');
    });
    
    // Minimize
    minimizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isMinimized = !isMinimized;
      panel.classList.toggle('minimized', isMinimized);
    });
    
    // Header click to expand
    header.addEventListener('click', () => {
      if (isMinimized) {
        isMinimized = false;
        panel.classList.remove('minimized');
      }
    });
    
    // Send message
    sendBtn.addEventListener('click', sendMessage);
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    
    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    });
    
    // File attachment
    attachBtn.addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files);
      files.forEach(file => {
        if (attachedFiles.length < 5) {
          attachedFiles.push(file);
        }
      });
      renderAttachments();
      fileInput.value = '';
    });
    
    // Suggestions
    document.querySelectorAll('.ai-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        const q = btn.dataset.q;
        document.getElementById('aiInput').value = q;
        sendMessage();
      });
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Render Functions
  // ─────────────────────────────────────────────────────────────────────────────
  function renderAttachments() {
    const container = document.getElementById('aiAttachments');
    if (!container) return;
    
    container.innerHTML = attachedFiles.map((file, idx) => `
      <div class="ai-attachment">
        ${icons.file}
        <span>${esc(file.name.length > 20 ? file.name.slice(0, 17) + '...' : file.name)}</span>
        <button class="ai-attachment-remove" data-idx="${idx}">×</button>
      </div>
    `).join('');
    
    container.querySelectorAll('.ai-attachment-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        attachedFiles.splice(idx, 1);
        renderAttachments();
      });
    });
  }
  
  function renderMessages() {
    const container = document.getElementById('aiMessages');
    if (!container) return;
    
    if (messages.length === 0) {
      container.innerHTML = `
        <div class="ai-welcome">
          <div class="ai-welcome-icon">${icons.bot}</div>
          <h3>Привет! Я AI-помощник</h3>
          <p>Задайте вопрос или прикрепите файл для анализа</p>
          <div class="ai-suggestions">
            <button class="ai-suggestion" data-q="Как создать новый тендер?">Создать тендер</button>
            <button class="ai-suggestion" data-q="Покажи статистику за месяц">Статистика</button>
            <button class="ai-suggestion" data-q="Как добавить расходы?">Добавить расходы</button>
          </div>
        </div>
      `;
      
      container.querySelectorAll('.ai-suggestion').forEach(btn => {
        btn.addEventListener('click', () => {
          const q = btn.dataset.q;
          document.getElementById('aiInput').value = q;
          sendMessage();
        });
      });
      return;
    }
    
    container.innerHTML = messages.map(msg => {
      const filesHtml = msg.files?.length ? `
        <div class="ai-message-files">
          ${msg.files.map(f => `<span class="ai-file-badge">${icons.file} ${esc(f)}</span>`).join('')}
        </div>
      ` : '';
      
      return `
        <div class="ai-message ${msg.role}">
          ${formatMessage(msg.content)}
          ${filesHtml}
        </div>
      `;
    }).join('');
    
    if (isLoading) {
      const lastIsEmptyBot = messages.length > 0
        && messages[messages.length - 1].role === 'assistant'
        && !messages[messages.length - 1].content;
      const hint = thinkSeconds > 0
        ? `Мимир думает… ${thinkSeconds}с${thinkSeconds >= 30 ? ' (бывает до минуты)' : ''}`
        : 'Мимир печатает…';
      container.innerHTML += `
        <div class="ai-typing" title="${esc(hint)}">
          <span></span><span></span><span></span>
        </div>
        <div style="font-size:11px;color:var(--text-tertiary,#888);padding:2px 12px;">${esc(hint)}</div>
      `;
      // (lastIsEmptyBot переменная зарезервирована для будущего варианта со стримом «в пузырь»)
      void lastIsEmptyBot;
    }

    container.scrollTop = container.scrollHeight;
  }
  
  function formatMessage(text) {
    // Basic markdown-like formatting
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Send Message
  // ─────────────────────────────────────────────────────────────────────────────
  async function sendMessage() {
    const input = document.getElementById('aiInput');
    const text = input.value.trim();
    
    if (!text && attachedFiles.length === 0) return;
    if (isLoading) return;
    
    // Add user message
    const userMessage = {
      role: 'user',
      content: text || 'Прикреплённые файлы:',
      files: attachedFiles.map(f => f.name)
    };
    messages.push(userMessage);
    
    // Clear input
    input.value = '';
    input.style.height = 'auto';
    const filesToSend = [...attachedFiles];
    attachedFiles = [];
    renderAttachments();
    
    // Show typing indicator
    isLoading = true;
    startThinkTicker();
    // Сразу добавляем пустой пузырь ассистента — в него стрим дописывает текст
    const botMsg = { role: 'assistant', content: '' };
    messages.push(botMsg);
    renderMessages();

    try {
      await streamAI(text, botMsg);
    } catch (err) {
      console.error('AI error:', err);
      botMsg.content = botMsg.content || 'Произошла ошибка соединения. Попробуйте ещё раз.';
    } finally {
      isLoading = false;
      stopThinkTicker();
      activeAbort = null;
      renderMessages();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Streaming AI Call → /api/mimir/chat-stream (SSE через fetch+ReadableStream)
  // ─────────────────────────────────────────────────────────────────────────────
  async function streamAI(text, botMsg) {
    const token = getToken();
    if (!token) {
      botMsg.content = 'Нужно перелогиниться (нет токена).';
      return;
    }
    if (activeAbort) { try { activeAbort.abort(); } catch (e) {} }
    activeAbort = new AbortController();

    const body = { message: text };
    if (conversationId) body.conversation_id = conversationId;
    if (selectedModelId) body.model = selectedModelId;
    try {
      const ctx = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
      if (ctx) body.context = ctx;
    } catch (e) {}

    const response = await fetch('/api/mimir/chat-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(body),
      signal: activeAbort.signal
    });

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastRender = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const json = line.slice(5).trim();
        if (!json) continue;
        let event;
        try { event = JSON.parse(json); } catch (e) { continue; }

        if (event.type === 'start' && event.conversation_id) {
          conversationId = event.conversation_id;
        } else if (event.type === 'text' && typeof event.content === 'string') {
          botMsg.content += event.content;
          // Тротлим перерисовку до 60fps (16мс) чтобы не лагать на длинных ответах
          const now = Date.now();
          if (now - lastRender > 50) {
            lastRender = now;
            renderMessages();
          }
        } else if (event.type === 'reasoning') {
          // reasoning_content от reasoning-моделей (gpt-5.5) — оставляем в стороне.
          // Юзеру не нужно видеть chain-of-thought, но typing-индикатор показывает
          // что что-то происходит (счётчик секунд уже крутится).
        } else if (event.type === 'done') {
          renderMessages();
          return;
        } else if (event.type === 'error') {
          // Если бэк сказал code='model_unavailable' — подсвечиваем селектор
          // моделей красным, чтобы юзер сразу понял где переключить.
          if (event.code === 'model_unavailable') {
            const sel = document.getElementById('aiModelSelect');
            if (sel) { sel.style.outline = '2px solid #d9534f'; setTimeout(() => { sel.style.outline = ''; }, 5000); }
          }
          botMsg.content = (botMsg.content || '') + (botMsg.content ? '\n\n' : '') + '⚠️ ' + (event.message || 'Ошибка');
          renderMessages();
          return;
        }
      }
    }
    renderMessages();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────
  return {
    init,
    open: () => {
      isOpen = true;
      const panel = document.getElementById('aiPanel');
      if (panel) panel.classList.add('open');
    },
    close: () => {
      isOpen = false;
      const panel = document.getElementById('aiPanel');
      if (panel) panel.classList.remove('open');
    },
    clearHistory: () => {
      messages = [];
      renderMessages();
    }
  };
})();

// Auto-initialize on page load and hash change
document.addEventListener('DOMContentLoaded', () => AsgardAI.init());
window.addEventListener('hashchange', () => AsgardAI.init());
