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
        background: #22c55e;
        border-radius: 50%;
        border: 2px solid #1a1a2e;
      }
      
      .ai-panel {
        position: absolute;
        bottom: 70px;
        right: 0;
        width: 380px;
        max-width: calc(100vw - 48px);
        height: 500px;
        max-height: calc(100vh - 120px);
        background: linear-gradient(180deg, #1a1a2e 0%, #16162a 100%);
        border-radius: 20px;
        border: 1px solid rgba(192, 57, 43, 0.3);
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
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
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
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
        color: #fff;
      }
      
      .ai-header-status {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.6);
      }
      
      .ai-header-actions {
        display: flex;
        gap: 8px;
      }
      
      .ai-header-btn {
        width: 28px;
        height: 28px;
        border-radius: 8px;
        border: none;
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.7);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      .ai-header-btn:hover {
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
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
        border-radius: 16px;
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
        color: rgba(255, 255, 255, 0.9);
        border-bottom-left-radius: 4px;
      }
      
      .ai-message.assistant a {
        color: #60a5fa;
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
        background: rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.8);
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
        background: rgba(255, 255, 255, 0.4);
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
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.2);
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
        border-radius: 8px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.8);
      }
      
      .ai-attachment-remove {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: none;
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
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
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: transparent;
        color: rgba(255, 255, 255, 0.6);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        flex-shrink: 0;
      }
      
      .ai-attach-btn:hover {
        border-color: rgba(192, 57, 43, 0.5);
        color: #fff;
      }
      
      .ai-input-wrap {
        flex: 1;
        position: relative;
      }
      
      .ai-input {
        width: 100%;
        padding: 10px 14px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.05);
        color: #fff;
        font-size: 14px;
        resize: none;
        min-height: 40px;
        max-height: 100px;
        outline: none;
        transition: border-color 0.2s;
      }
      
      .ai-input::placeholder {
        color: rgba(255, 255, 255, 0.4);
      }
      
      .ai-input:focus {
        border-color: rgba(192, 57, 43, 0.5);
      }
      
      .ai-send-btn {
        width: 40px;
        height: 40px;
        border-radius: 12px;
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
        color: rgba(255, 255, 255, 0.7);
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
        fill: rgba(255, 255, 255, 0.6);
      }
      
      .ai-welcome h3 {
        color: #fff;
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
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 20px;
        color: rgba(255, 255, 255, 0.8);
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
            <button class="ai-header-btn" id="aiMinimize" title="Свернуть">${icons.minimize}</button>
            <button class="ai-header-btn" id="aiClose" title="Закрыть">${icons.close}</button>
          </div>
        </div>
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
      container.innerHTML += `
        <div class="ai-typing">
          <span></span><span></span><span></span>
        </div>
      `;
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
    renderMessages();
    
    try {
      // Call AI API
      const response = await callAI(text, filesToSend);
      
      messages.push({
        role: 'assistant',
        content: response
      });
      
    } catch (err) {
      console.error('AI error:', err);
      messages.push({
        role: 'assistant',
        content: 'Извините, произошла ошибка. Попробуйте позже.'
      });
    }
    
    isLoading = false;
    renderMessages();
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // AI API Call (placeholder - will be connected to YandexGPT)
  // ─────────────────────────────────────────────────────────────────────────────
  async function callAI(text, files) {
    // For now, return mock response
    // This will be replaced with actual YandexGPT API call
    
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
    
    const mockResponses = {
      'тендер': `Чтобы создать новый тендер:

1. Перейдите в раздел **"Сага Тендеров"**
2. Нажмите кнопку **"+ Внести тендер"**
3. Заполните обязательные поля: заказчик, тип, дедлайн
4. Нажмите **"Сохранить"**

Тендер появится в реестре и воронке продаж.`,
      
      'статистик': `Для просмотра статистики:

1. Откройте **"Дашборд руководителя"** — общая сводка
2. Или **"Аналитика Ярла"** — детальные KPI
3. Раздел **"Финансы"** — доходы и расходы

Данные обновляются автоматически.`,
      
      'расход': `Добавить расходы можно двумя способами:

1. **По работе**: откройте работу → вкладка "Расходы" → "Добавить"
2. **Офисные**: раздел "Офисные расходы" → "Новый расход"

Также доступен **импорт выписки** из Альфа-Банка в разделе "Финансы".`,
      
      'default': `Я AI-помощник ASGARD CRM. Могу помочь с:

• Навигацией по системе
• Созданием тендеров и работ
• Аналитикой и отчётами
• Настройками

Что вас интересует?`
    };
    
    // Simple keyword matching
    const lowerText = text.toLowerCase();
    for (const [key, response] of Object.entries(mockResponses)) {
      if (lowerText.includes(key)) {
        return response;
      }
    }
    
    if (files.length > 0) {
      return `Получил ${files.length} файл(ов): ${files.map(f => f.name).join(', ')}

*Анализ файлов будет доступен после подключения YandexGPT.*

Пока могу помочь с вопросами о работе системы ASGARD CRM.`;
    }
    
    return mockResponses.default;
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
