/**
 * АСГАРД CRM — Мимир: Хранитель Мудрости v3.0
 *
 * Функции:
 * - Чат с ИИ (Claude API) со стримингом
 * - История диалогов (сохраняется в БД)
 * - Загрузка файлов (PDF, DOCX, Excel, изображения)
 * - Вопросы по тендерам, работам, финансам
 * - Генерация ТКП
 * - Умные рекомендации
 * - Ограничения по ролям
 */

window.AsgardMimir = (function(){
  const { esc, toast } = AsgardUI;

  // Состояние
  let isOpen = false;
  let isMinimized = false;
  let isSidebarOpen = false;
  let messages = [];
  let attachedFiles = [];
  let isLoading = false;
  let userRole = null;
  let userName = '';
  let currentConversationId = null;
  let conversations = [];
  let useStreaming = false;  // Отключаем стриминг — RouterAI не поддерживает SSE корректно

  const VIKING_WISDOM = [
    "Мудрость дороже золота, ибо золото можно потерять, а мудрость — никогда.",
    "Спрашивай — и обретёшь знание. Молчи — и останешься во тьме.",
    "Даже Один искал совета у Мимира.",
    "Знание — меч, который не затупится.",
    "Лучше спросить дважды, чем ошибиться единожды.",
    "Мудрый видит путь там, где другие видят только стену.",
    "Руны откроют тайны тому, кто умеет читать.",
    "Терпение — добродетель воина, знание — его сила."
  ];

  const styles = `
    <style id="mimir-styles">
      .mimir-widget { position:fixed; bottom:24px; right:24px; z-index:500; font-family:var(--font-main, -apple-system, sans-serif); }

      .mimir-toggle {
        width:64px; height:64px; border-radius:50%;
        background:linear-gradient(135deg, #c0392b 0%, #2a3b66 100%);
        border:3px solid #f5d78e; cursor:pointer;
        display:flex; align-items:center; justify-content:center;
        box-shadow:0 4px 24px rgba(192,57,43,0.5), 0 0 0 0 rgba(245,215,142,0.4);
        transition:all 0.3s ease; position:relative;
        animation:mimirPulse 3s infinite;
      }

      @keyframes mimirPulse {
        0%,100% { box-shadow:0 4px 24px rgba(192,57,43,0.5), 0 0 0 0 rgba(245,215,142,0.4); }
        50% { box-shadow:0 4px 24px rgba(192,57,43,0.5), 0 0 0 8px rgba(245,215,142,0); }
      }

      .mimir-toggle:hover { transform:scale(1.1) rotate(5deg); }
      .mimir-toggle-icon { font-size:32px; }

      .mimir-toggle::before {
        content:'ᛗ'; position:absolute; top:-6px; right:-6px;
        width:22px; height:22px; background:#f5d78e; border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        font-size:12px; color:#2a3b66; font-weight:bold; font-family:serif;
      }

      .mimir-panel {
        position:absolute; bottom:80px; right:0;
        width:520px; max-width:calc(100vw - 48px);
        height:650px; max-height:calc(100vh - 140px);
        background:linear-gradient(180deg, #1a1a2e 0%, #0d1428 100%);
        border-radius:6px; border:2px solid rgba(245,215,142,0.3);
        box-shadow:0 10px 50px rgba(0,0,0,0.6);
        display:none; flex-direction:row; overflow:hidden;
      }

      .mimir-panel.open { display:flex; animation:mimirOpen 0.4s cubic-bezier(0.34,1.56,0.64,1); }
      .mimir-panel.minimized { height:64px; }

      @keyframes mimirOpen {
        from { opacity:0; transform:translateY(30px) scale(0.9); }
        to { opacity:1; transform:translateY(0) scale(1); }
      }

      /* Сайдбар с диалогами */
      .mimir-sidebar {
        width:0; overflow:hidden; transition:width 0.3s ease;
        background:rgba(0,0,0,0.3); border-right:1px solid rgba(245,215,142,0.15);
        display:flex; flex-direction:column;
      }
      .mimir-sidebar.open { width:200px; }

      .mimir-sidebar-header {
        padding:12px; border-bottom:1px solid rgba(245,215,142,0.1);
      }
      .mimir-new-chat-btn {
        width:100%; padding:10px; border-radius:6px;
        background:linear-gradient(135deg, #c0392b, #8e2c22);
        border:1px solid rgba(245,215,142,0.3); color:#f5d78e;
        cursor:pointer; font-weight:600; font-size:13px;
        transition:all 0.2s;
      }
      .mimir-new-chat-btn:hover { transform:scale(1.02); box-shadow:0 2px 10px rgba(192,57,43,0.4); }

      .mimir-conversations {
        flex:1; overflow-y:auto; padding:8px;
      }
      .mimir-conv-item {
        padding:10px 12px; margin-bottom:4px; border-radius:6px;
        background:rgba(255,255,255,0.03); cursor:pointer;
        transition:all 0.2s; font-size:13px; color:rgba(255,255,255,0.7);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      }
      .mimir-conv-item:hover { background:rgba(255,255,255,0.08); }
      .mimir-conv-item.active { background:rgba(245,215,142,0.15); color:#f5d78e; }
      .mimir-conv-item.pinned::before { content:'📌 '; }

      /* Основная область */
      .mimir-main { flex:1; display:flex; flex-direction:column; min-width:0; }

      .mimir-header {
        padding:14px 16px;
        background:linear-gradient(135deg, rgba(192,57,43,0.3) 0%, rgba(42,59,102,0.3) 100%);
        border-bottom:1px solid rgba(245,215,142,0.2);
        display:flex; align-items:center; gap:12px;
      }

      .mimir-menu-btn {
        width:32px; height:32px; border-radius:6px;
        background:rgba(255,255,255,0.1); border:none; color:#fff;
        cursor:pointer; font-size:16px; transition:all 0.2s;
        display:flex; align-items:center; justify-content:center;
      }
      .mimir-menu-btn:hover { background:rgba(255,255,255,0.2); }

      .mimir-avatar { font-size:32px; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3)); }
      .mimir-header-info { flex:1; min-width:0; }
      .mimir-header-title { font-size:16px; font-weight:700; color:#f5d78e; letter-spacing:1px; }
      .mimir-header-status { font-size:11px; color:rgba(255,255,255,0.6); margin-top:2px;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .mimir-header-actions { display:flex; gap:6px; }
      .mimir-header-btn {
        width:28px; height:28px; border-radius:6px;
        background:rgba(255,255,255,0.1); border:none; color:#fff;
        cursor:pointer; font-size:14px; transition:all 0.2s;
      }
      .mimir-header-btn:hover { background:rgba(255,255,255,0.2); }

      .mimir-messages {
        flex:1; overflow-y:auto; padding:16px;
        display:flex; flex-direction:column; gap:12px;
      }

      .mimir-messages::-webkit-scrollbar { width:6px; }
      .mimir-messages::-webkit-scrollbar-track { background:transparent; }
      .mimir-messages::-webkit-scrollbar-thumb { background:rgba(245,215,142,0.3); border-radius:3px; }

      .mimir-message {
        max-width:90%; padding:12px 16px;
        border-radius:6px; font-size:14px; line-height:1.6;
        animation:msgFade 0.3s ease; position:relative;
      }

      @keyframes msgFade {
        from { opacity:0; transform:translateY(10px); }
        to { opacity:1; transform:translateY(0); }
      }

      .mimir-message.user {
        align-self:flex-end;
        background:linear-gradient(135deg, #c0392b, #8e2c22);
        color:#fff; border-bottom-right-radius:4px;
      }

      .mimir-message.assistant {
        align-self:flex-start;
        background:rgba(42,59,102,0.6);
        color:var(--text-secondary); border-bottom-left-radius:4px;
        border:1px solid rgba(245,215,142,0.15);
      }

      .mimir-msg-content { word-wrap:break-word; }

      /* Кнопка копирования */
      .mimir-copy-btn {
        position:absolute; top:8px; right:8px;
        width:24px; height:24px; border-radius:6px;
        background:rgba(0,0,0,0.3); border:none; color:rgba(255,255,255,0.6);
        cursor:pointer; font-size:12px; opacity:0; transition:all 0.2s;
      }
      .mimir-message:hover .mimir-copy-btn { opacity:1; }
      .mimir-copy-btn:hover { background:rgba(0,0,0,0.5); color:#fff; }

      /* Markdown стили */
      .mimir-code { background:rgba(0,0,0,0.4); border-radius:6px; padding:12px; margin:8px 0;
        font-family:'JetBrains Mono','Fira Code',monospace; font-size:12px; overflow-x:auto; white-space:pre; }
      .mimir-inline-code { background:rgba(0,0,0,0.3); padding:2px 6px; border-radius:4px; font-size:13px; font-family:monospace; }
      .mimir-h2 { font-size:16px; font-weight:700; color:#f5d78e; margin:14px 0 8px; }
      .mimir-h3 { font-size:14px; font-weight:600; color:#cbd5e1; margin:12px 0 6px; }
      .mimir-li { padding-left:16px; margin:3px 0; position:relative; }
      .mimir-li::before { content:'•'; position:absolute; left:0; color:#f5d78e; }
      .mimir-li-num { padding-left:20px; margin:3px 0; }
      .mimir-table { width:100%; border-collapse:collapse; margin:10px 0; font-size:13px; }
      .mimir-table th { background:rgba(245,215,142,0.15); color:#f5d78e; font-weight:600;
        padding:8px 10px; text-align:left; border-bottom:1px solid rgba(245,215,142,0.3); }
      .mimir-table td { padding:6px 10px; border-bottom:1px solid rgba(255,255,255,0.08); }
      .mimir-message strong { color:#f5d78e; }

      /* Стриминг индикатор */
      .mimir-streaming { display:inline; }
      .mimir-streaming-cursor {
        display:inline-block; width:8px; height:16px;
        background:#f5d78e; margin-left:2px;
        animation:blink 1s infinite;
      }
      @keyframes blink { 0%,50% { opacity:1; } 51%,100% { opacity:0; } }

      .mimir-typing { display:flex; gap:4px; padding:12px 16px; align-self:flex-start; }
      .mimir-typing span {
        width:8px; height:8px; background:#f5d78e; border-radius:50%;
        animation:typingDot 1.4s infinite ease-in-out;
      }
      .mimir-typing span:nth-child(2) { animation-delay:0.2s; }
      .mimir-typing span:nth-child(3) { animation-delay:0.4s; }
      @keyframes typingDot { 0%,80%,100%{ transform:scale(0.6); opacity:0.5; } 40%{ transform:scale(1); opacity:1; } }

      .mimir-welcome { text-align:center; padding:30px 20px; }
      .mimir-welcome-icon { font-size:56px; margin-bottom:14px; filter:drop-shadow(0 4px 8px rgba(0,0,0,0.3)); }
      .mimir-welcome h3 { color:#f5d78e; font-size:18px; margin:0 0 8px; }
      .mimir-welcome p { color:rgba(255,255,255,0.7); font-size:13px; margin:0 0 20px; }

      .mimir-suggestions { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; }
      .mimir-suggestion {
        padding:8px 14px; border-radius:6px;
        background:rgba(245,215,142,0.1); border:1px solid rgba(245,215,142,0.3);
        color:#f5d78e; font-size:12px; cursor:pointer; transition:all 0.2s;
      }
      .mimir-suggestion:hover { background:rgba(245,215,142,0.2); transform:translateY(-2px); }

      .mimir-input-area {
        padding:12px 16px;
        background:rgba(0,0,0,0.2);
        border-top:1px solid rgba(245,215,142,0.1);
      }

      .mimir-attachments {
        display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px;
      }

      .mimir-attachment {
        display:flex; align-items:center; gap:6px;
        padding:6px 10px; border-radius:6px;
        background:rgba(245,215,142,0.15); font-size:12px; color:#f5d78e;
      }
      .mimir-attachment-size { font-size:10px; opacity:0.7; }

      .mimir-attachment-remove {
        background:none; border:none; color:#ef4444; cursor:pointer;
        font-size:14px; padding:0; line-height:1;
      }

      .mimir-input-row { display:flex; gap:8px; align-items:flex-end; }

      .mimir-file-btn {
        width:40px; height:40px; border-radius:6px;
        background:rgba(255,255,255,0.1); border:1px solid rgba(245,215,142,0.2);
        color:#f5d78e; cursor:pointer; font-size:16px;
        display:flex; align-items:center; justify-content:center;
        transition:all 0.2s;
      }
      .mimir-file-btn:hover { background:rgba(255,255,255,0.15); }

      .mimir-input {
        flex:1; padding:10px 14px;
        background:rgba(255,255,255,0.08); border:1px solid rgba(245,215,142,0.2);
        border-radius:6px; color:#fff; font-size:14px;
        resize:none; min-height:40px; max-height:100px;
      }
      .mimir-input:focus { outline:none; border-color:rgba(245,215,142,0.5); box-shadow:0 0 15px rgba(245,215,142,0.1); }
      .mimir-input::placeholder { color:rgba(255,255,255,0.4); font-style:italic; }

      .mimir-send-btn {
        width:40px; height:40px; border-radius:6px;
        background:linear-gradient(135deg, #c0392b, #8e2c22);
        border:1px solid rgba(245,215,142,0.3); color:#f5d78e;
        cursor:pointer; display:flex; align-items:center; justify-content:center;
        font-size:16px; transition:all 0.2s;
      }
      .mimir-send-btn:hover { transform:scale(1.05); box-shadow:0 4px 15px rgba(192,57,43,0.4); }
      .mimir-send-btn:disabled { opacity:0.5; cursor:not-allowed; transform:none; }

      .mimir-quick-bar {
        display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap;
      }

      .mimir-quick-btn {
        padding:4px 10px; border-radius:6px;
        background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
        color:rgba(255,255,255,0.7); font-size:11px; cursor:pointer;
        transition:all 0.2s;
      }
      .mimir-quick-btn:hover { background:rgba(255,255,255,0.1); color:#f5d78e; }

      .mimir-wisdom {
        font-style:italic; font-size:10px; color:rgba(245,215,142,0.5);
        text-align:center; padding:6px 16px;
        border-top:1px solid rgba(245,215,142,0.1);
      }

      .mimir-result-card {
        background:rgba(0,0,0,0.2); border-radius:6px;
        padding:10px; margin-top:8px; font-size:13px;
      }

      .mimir-result-card table { width:100%; border-collapse:collapse; }
      .mimir-result-card th, .mimir-result-card td {
        padding:4px 8px; text-align:left;
        border-bottom:1px solid rgba(255,255,255,0.1);
      }
      .mimir-result-card th { color:#f5d78e; font-weight:600; }

      /* Drag & Drop */
      .mimir-panel.drag-over {
        border-color:#f5d78e;
        box-shadow:0 0 20px rgba(245,215,142,0.3);
      }
      .mimir-drop-overlay {
        position:absolute; inset:0; background:rgba(26,26,46,0.95);
        display:none; align-items:center; justify-content:center;
        flex-direction:column; gap:16px; z-index:10;
        border-radius:6px;
      }
      .mimir-panel.drag-over .mimir-drop-overlay { display:flex; }
      .mimir-drop-icon { font-size:48px; }
      .mimir-drop-text { color:#f5d78e; font-size:16px; font-weight:600; }

      @media (max-width:600px) {
        .mimir-panel { width:calc(100vw - 24px); right:-12px; bottom:76px; height:calc(100vh - 120px); }
        .mimir-sidebar.open { width:160px; }
        .mimir-widget { bottom:16px; right:16px; }
        .mimir-toggle { width:56px; height:56px; }
      }
    </style>
  `;

  // ═══════════════════════════════════════════════════════════════════════════
  // ИНИЦИАЛИЗАЦИЯ
  // ═══════════════════════════════════════════════════════════════════════════

  function init() {
    const hash = window.location.hash || '';
    if (!hash || hash === '#/' || hash === '#/welcome' || hash === '#/login') {
      const existing = document.getElementById('mimirWidget');
      if (existing) existing.remove();
      return;
    }

    if (!localStorage.getItem('asgard_token')) return;

    if (document.getElementById('mimirWidget')) return;

    if (!document.getElementById('mimir-styles')) {
      document.head.insertAdjacentHTML('beforeend', styles);
    }

    const auth = AsgardAuth?.getAuth?.();
    userRole = auth?.user?.role || 'USER';
    userName = auth?.user?.name || auth?.user?.login || 'Воин';

    const widget = document.createElement('div');
    widget.id = 'mimirWidget';
    widget.className = 'mimir-widget';
    widget.innerHTML = buildWidgetHTML();

    document.body.appendChild(widget);
    bindEvents();
    renderMessages();
    showWisdom();
    loadConversations();
  }

  window.addEventListener('hashchange', () => {
    setTimeout(init, 100);
  });

  function buildWidgetHTML() {
    return `
      <button class="mimir-toggle" id="mimirToggle" title="Мимир — Хранитель Мудрости">
        <span class="mimir-toggle-icon">🧙</span>
      </button>

      <div class="mimir-panel" id="mimirPanel">
        <div class="mimir-drop-overlay">
          <span class="mimir-drop-icon">📎</span>
          <span class="mimir-drop-text">Отпусти файлы здесь</span>
        </div>

        <div class="mimir-sidebar" id="mimirSidebar">
          <div class="mimir-sidebar-header">
            <button class="mimir-new-chat-btn" id="mimirNewChat">+ Новый диалог</button>
          </div>
          <div class="mimir-conversations" id="mimirConversations"></div>
        </div>

        <div class="mimir-main">
          <div class="mimir-header" id="mimirHeader">
            <button class="mimir-menu-btn" id="mimirMenuBtn" title="Диалоги">☰</button>
            <div class="mimir-avatar">🧙</div>
            <div class="mimir-header-info">
              <div class="mimir-header-title">Мимир</div>
              <div class="mimir-header-status" id="mimirStatus">Хранитель Мудрости</div>
            </div>
            <div class="mimir-header-actions">
              <button class="mimir-header-btn" id="mimirClear" title="Очистить">🗑️</button>
              <button class="mimir-header-btn" id="mimirMinimize" title="Свернуть">—</button>
              <button class="mimir-header-btn" id="mimirClose" title="Закрыть">✕</button>
            </div>
          </div>

          <div class="mimir-messages" id="mimirMessages"></div>

          <div class="mimir-input-area">
            <div class="mimir-quick-bar" id="mimirQuickBar">
              <button class="mimir-quick-btn" data-q="Покажи статистику">📊 Статистика</button>
              <button class="mimir-quick-btn" data-q="Какие счета просрочены?">⚠️ Просрочки</button>
              <button class="mimir-quick-btn" data-q="Ближайшие дедлайны работ">⏰ Дедлайны</button>
              <button class="mimir-quick-btn" data-action="tkp">📝 Создать ТКП</button>
            </div>

            <div class="mimir-attachments" id="mimirAttachments"></div>

            <div class="mimir-input-row">
              <button class="mimir-file-btn" id="mimirFileBtn" title="Прикрепить файл">📎</button>
              <input type="file" id="mimirFileInput" style="display:none"
                accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.gif,.webp,.txt" multiple/>
              <textarea class="mimir-input" id="mimirInput" placeholder="Спроси у Мимира..." rows="1"></textarea>
              <button class="mimir-send-btn" id="mimirSend" title="Отправить">➤</button>
            </div>
          </div>

          <div class="mimir-wisdom" id="mimirWisdom"></div>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // СОБЫТИЯ
  // ═══════════════════════════════════════════════════════════════════════════

  function bindEvents() {
    const toggle = document.getElementById('mimirToggle');
    const panel = document.getElementById('mimirPanel');
    const closeBtn = document.getElementById('mimirClose');
    const minimizeBtn = document.getElementById('mimirMinimize');
    const clearBtn = document.getElementById('mimirClear');
    const sendBtn = document.getElementById('mimirSend');
    const input = document.getElementById('mimirInput');
    const fileBtn = document.getElementById('mimirFileBtn');
    const fileInput = document.getElementById('mimirFileInput');
    const menuBtn = document.getElementById('mimirMenuBtn');
    const sidebar = document.getElementById('mimirSidebar');
    const newChatBtn = document.getElementById('mimirNewChat');

    toggle?.addEventListener('click', () => {
      isOpen = !isOpen;
      panel?.classList.toggle('open', isOpen);
      if (isOpen) {
        input?.focus();
        isMinimized = false;
        panel?.classList.remove('minimized');
      }
    });

    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      isOpen = false;
      panel?.classList.remove('open');
    });

    minimizeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      isMinimized = !isMinimized;
      panel?.classList.toggle('minimized', isMinimized);
    });

    clearBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      startNewChat();
    });

    sendBtn?.addEventListener('click', sendMessage);

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    });

    // Сайдбар
    menuBtn?.addEventListener('click', () => {
      isSidebarOpen = !isSidebarOpen;
      sidebar?.classList.toggle('open', isSidebarOpen);
    });

    newChatBtn?.addEventListener('click', startNewChat);

    // Файлы
    fileBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      addFiles(files);
      if (fileInput) fileInput.value = '';
    });

    // Drag & Drop
    panel?.addEventListener('dragover', (e) => {
      e.preventDefault();
      panel.classList.add('drag-over');
    });

    panel?.addEventListener('dragleave', (e) => {
      e.preventDefault();
      panel.classList.remove('drag-over');
    });

    panel?.addEventListener('drop', (e) => {
      e.preventDefault();
      panel.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer?.files || []);
      addFiles(files);
    });

    // Быстрые команды
    document.querySelectorAll('.mimir-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'tkp') {
          openTkpGenerator();
          return;
        }
        const q = btn.dataset.q;
        if (input && q) {
          input.value = q;
          sendMessage();
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ДИАЛОГИ
  // ═══════════════════════════════════════════════════════════════════════════

  async function loadConversations() {
    const auth = AsgardAuth?.getAuth?.();
    const token = auth?.token;
    if (!token) return;

    try {
      const resp = await fetch('/api/mimir/conversations?limit=30', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (resp.ok) {
        const data = await resp.json();
        conversations = data.conversations || [];
        renderConversations();
      }
    } catch (e) { /* ignore */ }
  }

  function renderConversations() {
    const container = document.getElementById('mimirConversations');
    if (!container) return;

    container.innerHTML = conversations.map(conv => {
      const active = conv.id === currentConversationId ? 'active' : '';
      const pinned = conv.is_pinned ? 'pinned' : '';
      const title = esc(conv.title || 'Без названия');
      return `<div class="mimir-conv-item ${active} ${pinned}" data-conv-id="${conv.id}">${title}</div>`;
    }).join('');

    container.querySelectorAll('.mimir-conv-item').forEach(item => {
      item.addEventListener('click', () => {
        const convId = parseInt(item.dataset.convId);
        loadConversation(convId);
      });
    });
  }

  async function loadConversation(convId) {
    const auth = AsgardAuth?.getAuth?.();
    const token = auth?.token;
    if (!token) return;

    try {
      const resp = await fetch('/api/mimir/conversations/' + convId, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (resp.ok) {
        const data = await resp.json();
        currentConversationId = convId;
        messages = (data.messages || []).map(m => ({
          role: m.role,
          content: m.content,
          results: m.search_results ? JSON.parse(m.search_results) : null,
          files: m.file_names
        }));
        renderMessages();
        renderConversations();
        updateStatus(data.conversation?.title || 'Диалог');
      }
    } catch (e) {
      toast?.('Ошибка', 'Не удалось загрузить диалог', 'err');
    }
  }

  function startNewChat() {
    currentConversationId = null;
    messages = [];
    attachedFiles = [];
    renderMessages();
    renderAttachments();
    renderConversations();
    updateStatus('Хранитель Мудрости');
  }

  function updateStatus(text) {
    const el = document.getElementById('mimirStatus');
    if (el) el.textContent = text;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ФАЙЛЫ
  // ═══════════════════════════════════════════════════════════════════════════

  function addFiles(files) {
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) {
        toast?.('Ошибка', 'Файл > 20 МБ: ' + file.name, 'err');
        continue;
      }
      if (attachedFiles.length >= 3) {
        toast?.('Ошибка', 'Максимум 3 файла', 'err');
        break;
      }
      attachedFiles.push(file);
    }
    renderAttachments();
  }

  function renderAttachments() {
    const container = document.getElementById('mimirAttachments');
    if (!container) return;

    container.innerHTML = attachedFiles.map((file, idx) => {
      const icon = getFileIcon(file.name);
      const name = file.name.length > 20 ? file.name.slice(0, 17) + '...' : file.name;
      const size = (file.size / 1024).toFixed(0) + ' КБ';
      return `
        <div class="mimir-attachment">
          ${icon} ${esc(name)}
          <span class="mimir-attachment-size">(${size})</span>
          <button class="mimir-attachment-remove" data-idx="${idx}">✕</button>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.mimir-attachment-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        attachedFiles.splice(parseInt(btn.dataset.idx), 1);
        renderAttachments();
      });
    });
  }

  function getFileIcon(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    if (['pdf'].includes(ext)) return '📕';
    if (['xlsx', 'xls', 'csv'].includes(ext)) return '📊';
    if (['doc', 'docx', 'txt'].includes(ext)) return '📄';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '🖼️';
    return '📁';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // СООБЩЕНИЯ
  // ═══════════════════════════════════════════════════════════════════════════

  function showWisdom() {
    const el = document.getElementById('mimirWisdom');
    if (el) {
      const wisdom = VIKING_WISDOM[Math.floor(Math.random() * VIKING_WISDOM.length)];
      el.textContent = '« ' + wisdom + ' »';
    }
  }

  function renderMessages() {
    const container = document.getElementById('mimirMessages');
    if (!container) return;

    if (messages.length === 0) {
      container.innerHTML = `
        <div class="mimir-welcome">
          <div class="mimir-welcome-icon">🧙</div>
          <h3>Приветствую тебя, ${esc(userName)}!</h3>
          <p>Я — Мимир, хранитель мудрости. Спрашивай о тендерах, работах, финансах или прикрепи файл для анализа.</p>
          <div class="mimir-suggestions">
            <button class="mimir-suggestion" data-q="Сколько у нас активных тендеров?">📊 Тендеры</button>
            <button class="mimir-suggestion" data-q="Найди работы по Газпром">🔍 Поиск</button>
            <button class="mimir-suggestion" data-q="Как добавить новый расход?">❓ Помощь</button>
          </div>
        </div>
      `;

      container.querySelectorAll('.mimir-suggestion').forEach(btn => {
        btn.addEventListener('click', () => {
          const input = document.getElementById('mimirInput');
          if (input) input.value = btn.dataset.q;
          sendMessage();
        });
      });
      return;
    }

    container.innerHTML = messages.map((msg, idx) => {
      let content = renderMarkdown(msg.content);

      if (msg.files && msg.files.length) {
        content += '<div style="margin-top:8px;font-size:12px;opacity:0.8">';
        msg.files.forEach(f => {
          content += '<span style="margin-right:8px">' + getFileIcon(f) + ' ' + esc(f) + '</span>';
        });
        content += '</div>';
      }

      if (msg.results && msg.results.length) {
        content += renderResultsTable(msg.results);
      }

      const copyBtn = msg.role === 'assistant'
        ? `<button class="mimir-copy-btn" data-msg-idx="${idx}" title="Копировать">📋</button>`
        : '';

      const streamingCursor = msg.isStreaming ? '<span class="mimir-streaming-cursor"></span>' : '';

      return `
        <div class="mimir-message ${msg.role}">
          ${copyBtn}
          <div class="mimir-msg-content">${content}${streamingCursor}</div>
        </div>
      `;
    }).join('');

    if (isLoading && !messages[messages.length - 1]?.isStreaming) {
      container.innerHTML += '<div class="mimir-typing"><span></span><span></span><span></span></div>';
    }

    container.scrollTop = container.scrollHeight;

    // Копирование
    container.querySelectorAll('.mimir-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.msgIdx);
        const text = messages[idx]?.content || '';
        navigator.clipboard?.writeText(text).then(() => {
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = '📋'; }, 1500);
        });
      });
    });
  }

  function updateLastMessage(text) {
    const container = document.getElementById('mimirMessages');
    const lastMsg = container?.querySelector('.mimir-message.assistant:last-child .mimir-msg-content');
    if (lastMsg) {
      lastMsg.innerHTML = renderMarkdown(text) + '<span class="mimir-streaming-cursor"></span>';
      container.scrollTop = container.scrollHeight;
    }
  }

  function renderResultsTable(results) {
    if (!results || !results.length) return '';

    const keys = Object.keys(results[0]).slice(0, 5);
    let html = '<div class="mimir-result-card"><table><thead><tr>';
    keys.forEach(k => { html += '<th>' + esc(k) + '</th>'; });
    html += '</tr></thead><tbody>';

    results.slice(0, 5).forEach(row => {
      html += '<tr>';
      keys.forEach(k => { html += '<td>' + esc(String(row[k] ?? '-')) + '</td>'; });
      html += '</tr>';
    });

    if (results.length > 5) {
      html += '<tr><td colspan="' + keys.length + '" style="text-align:center;color:#f5d78e">... ещё ' + (results.length - 5) + '</td></tr>';
    }

    html += '</tbody></table></div>';
    return html;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MARKDOWN РЕНДЕРИНГ
  // ═══════════════════════════════════════════════════════════════════════════

  function renderMarkdown(text) {
    if (!text) return '';

    // Экранируем HTML
    let html = esc(text);

    // Блоки кода (```lang\n...\n```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      return '<pre class="mimir-code"><code>' + code.trim() + '</code></pre>';
    });

    // Инлайн код
    html = html.replace(/`([^`\n]+)`/g, '<code class="mimir-inline-code">$1</code>');

    // Заголовки
    html = html.replace(/^### (.+)$/gm, '<div class="mimir-h3">$1</div>');
    html = html.replace(/^## (.+)$/gm, '<div class="mimir-h2">$1</div>');

    // Жирный и курсив
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

    // Маркированные списки
    html = html.replace(/^- (.+)$/gm, '<div class="mimir-li">$1</div>');

    // Нумерованные списки
    html = html.replace(/^(\d+)\. (.+)$/gm, '<div class="mimir-li-num">$1. $2</div>');

    // Таблицы (простые: | col | col |)
    html = html.replace(/(\|.+\|[\r\n])+/g, (match) => {
      const rows = match.trim().split('\n').filter(r => r.trim());
      if (rows.length < 2) return match;

      let table = '<table class="mimir-table">';
      let isHeader = true;

      for (const row of rows) {
        if (row.match(/^\|[\s\-:|]+\|$/)) {
          isHeader = false;
          continue;
        }
        const cells = row.split('|').filter(c => c.trim());
        const tag = isHeader ? 'th' : 'td';
        table += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
        if (isHeader) isHeader = false;
      }

      table += '</table>';
      return table;
    });

    // Горизонтальные линии
    html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid rgba(245,215,142,0.2);margin:12px 0">');

    // Абзацы и переносы
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    return '<p>' + html + '</p>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ОТПРАВКА СООБЩЕНИЙ
  // ═══════════════════════════════════════════════════════════════════════════

  async function sendMessage() {
    const input = document.getElementById('mimirInput');
    const sendBtn = document.getElementById('mimirSend');
    const text = (input?.value || '').trim();

    if (!text && !attachedFiles.length) return;
    if (isLoading) return;

    const userMsg = {
      role: 'user',
      content: text || '(Анализ файлов)',
      files: attachedFiles.map(f => f.name)
    };
    messages.push(userMsg);

    const filesToSend = [...attachedFiles];
    attachedFiles = [];

    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }
    renderAttachments();

    isLoading = true;
    if (sendBtn) sendBtn.disabled = true;
    renderMessages();

    try {
      if (filesToSend.length > 0) {
        // С файлами — обычный запрос
        const response = await callMimirWithFiles(text, filesToSend);
        messages.push({
          role: 'assistant',
          content: response.text || response,
          results: response.results
        });
      } else if (useStreaming) {
        // Стриминг
        await callMimirStream(text);
      } else {
        // Обычный запрос
        const response = await callMimir(text);
        messages.push({
          role: 'assistant',
          content: response.text || response,
          results: response.results
        });
      }
    } catch (err) {
      console.error('Mimir error:', err);
      messages.push({
        role: 'assistant',
        content: 'Прости, воин. Колодец мудрости временно недоступен. Попробуй снова.'
      });
    }

    isLoading = false;
    if (sendBtn) sendBtn.disabled = false;
    renderMessages();
    showWisdom();
    loadConversations();
  }

  async function callMimirStream(text) {
    const lowerText = (text || '').toLowerCase();

    // Быстрые ответы
    if (lowerText.match(/^(спасибо|спс|благодарю)$/)) {
      messages.push({ role: 'assistant', content: 'Рад был помочь, воин! Да прибудет мудрость Одина. ⚔️' });
      return;
    }
    if (lowerText.match(/^(пока|бывай|до свидания)$/)) {
      messages.push({ role: 'assistant', content: 'До встречи, воин! Пусть путь будет ясен. 🛡️' });
      return;
    }
    if (lowerText.match(/^(привет|здравствуй|хай|салют)$/)) {
      messages.push({ role: 'assistant', content: 'Приветствую тебя, ' + userName + '! Чем могу помочь? 🧙' });
      return;
    }

    // Контекст по разделу
    let context = '';
    const hash = window.location.hash || '';
    if (hash.includes('tender')) context = 'Тендеры';
    else if (hash.includes('work') || hash.includes('pm-')) context = 'Работы';
    else if (hash.includes('financ') || hash.includes('buh') || hash.includes('invoice')) context = 'Финансы';
    else if (hash.includes('employee') || hash.includes('hr')) context = 'Персонал';

    const auth = AsgardAuth?.getAuth?.();
    const token = auth?.token;

    // Добавляем пустое сообщение для стриминга
    messages.push({ role: 'assistant', content: '', isStreaming: true });
    renderMessages();

    const response = await fetch('/api/mimir/chat-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      },
      body: JSON.stringify({
        message: text,
        context: context,
        conversation_id: currentConversationId
      })
    });

    if (!response.ok) {
      throw new Error('API error');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        try {
          const event = JSON.parse(line.slice(6));

          if (event.type === 'text') {
            fullText += event.content;
            messages[messages.length - 1].content = fullText;
            updateLastMessage(fullText);
          } else if (event.type === 'start') {
            currentConversationId = event.conversation_id;
          } else if (event.type === 'results') {
            messages[messages.length - 1].results = event.data;
          } else if (event.type === 'done') {
            messages[messages.length - 1].isStreaming = false;
          } else if (event.type === 'error') {
            messages[messages.length - 1].content = 'Ошибка: ' + event.message;
            messages[messages.length - 1].isStreaming = false;
          }
        } catch (e) { /* skip malformed */ }
      }
    }

    messages[messages.length - 1].isStreaming = false;

    // Если стриминг не вернул текст — пробуем обычный запрос
    if (!fullText && messages.length > 0) {
      messages.pop(); // убираем пустое сообщение
      const response = await callMimir(text);
      messages.push({
        role: 'assistant',
        content: response.text || response,
        results: response.results
      });
    }
  }

  async function callMimir(text) {
    const lowerText = (text || '').toLowerCase();

    // Быстрые ответы
    if (lowerText.match(/^(спасибо|спс|благодарю)$/)) {
      return { text: 'Рад был помочь, воин! Да прибудет мудрость Одина. ⚔️' };
    }
    if (lowerText.match(/^(пока|бывай|до свидания)$/)) {
      return { text: 'До встречи, воин! Пусть путь будет ясен. 🛡️' };
    }
    if (lowerText.match(/^(привет|здравствуй|хай|салют)$/)) {
      return { text: 'Приветствую тебя, ' + userName + '! Чем могу помочь? 🧙' };
    }

    // Контекст
    let context = '';
    const hash = window.location.hash || '';
    if (hash.includes('tender')) context = 'Тендеры';
    else if (hash.includes('work') || hash.includes('pm-')) context = 'Работы';
    else if (hash.includes('financ') || hash.includes('buh') || hash.includes('invoice')) context = 'Финансы';
    else if (hash.includes('employee') || hash.includes('hr')) context = 'Персонал';

    const auth = AsgardAuth?.getAuth?.();
    const token = auth?.token;

    const resp = await fetch('/api/mimir/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      },
      body: JSON.stringify({
        message: text,
        context: context,
        conversation_id: currentConversationId
      })
    });

    if (!resp.ok) throw new Error('API error');
    const data = await resp.json();

    if (data.conversation_id) {
      currentConversationId = data.conversation_id;
    }

    return {
      text: data.response || 'Руны молчат...',
      results: data.results
    };
  }

  async function callMimirWithFiles(text, files) {
    const auth = AsgardAuth?.getAuth?.();
    const token = auth?.token;

    const formData = new FormData();
    formData.append('message', text || '');
    formData.append('context', window.location.hash || '');
    if (currentConversationId) {
      formData.append('conversation_id', currentConversationId);
    }
    files.forEach((f, i) => formData.append('file_' + i, f));

    const resp = await fetch('/api/mimir/analyze', {
      method: 'POST',
      headers: token ? { 'Authorization': 'Bearer ' + token } : {},
      body: formData
    });

    if (!resp.ok) throw new Error('API error');
    const data = await resp.json();

    if (data.conversation_id) {
      currentConversationId = data.conversation_id;
    }

    return { text: data.response || 'Файлы получены.' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ГЕНЕРАТОР ТКП
  // ═══════════════════════════════════════════════════════════════════════════

  async function openTkpGenerator() {
    const html = `
      <div style="padding:16px">
        <h3 style="color:#f5d78e;margin:0 0 16px">📝 Генератор ТКП</h3>

        <div style="margin-bottom:12px">
          <label style="display:block;color:#94a3b8;font-size:12px;margin-bottom:4px">Заказчик</label>
          <input id="tkp_customer" class="inp" style="width:100%;background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);color:#fff;padding:8px;border-radius:6px" placeholder="ООО Газпром"/>
        </div>

        <div style="margin-bottom:12px">
          <label style="display:block;color:#94a3b8;font-size:12px;margin-bottom:4px">Название работ</label>
          <input id="tkp_title" class="inp" style="width:100%;background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);color:#fff;padding:8px;border-radius:6px" placeholder="Техническое обслуживание..."/>
        </div>

        <div style="margin-bottom:12px">
          <label style="display:block;color:#94a3b8;font-size:12px;margin-bottom:4px">Перечень услуг</label>
          <textarea id="tkp_services" style="width:100%;background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);color:#fff;padding:8px;border-radius:6px;resize:vertical" rows="3" placeholder="Диагностика, ремонт, замена..."></textarea>
        </div>

        <div style="display:flex;gap:12px;margin-bottom:12px">
          <div style="flex:1">
            <label style="display:block;color:#94a3b8;font-size:12px;margin-bottom:4px">Сумма (руб)</label>
            <input id="tkp_sum" type="number" class="inp" style="width:100%;background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);color:#fff;padding:8px;border-radius:6px" placeholder="500000"/>
          </div>
          <div style="flex:1">
            <label style="display:block;color:#94a3b8;font-size:12px;margin-bottom:4px">Срок</label>
            <input id="tkp_deadline" class="inp" style="width:100%;background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);color:#fff;padding:8px;border-radius:6px" placeholder="14 дней"/>
          </div>
        </div>

        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn ghost" id="tkp_cancel">Отмена</button>
          <button class="btn primary" id="tkp_generate">Сгенерировать</button>
        </div>
      </div>
    `;

    const messagesEl = document.getElementById('mimirMessages');
    if (messagesEl) {
      messagesEl.innerHTML = html;

      document.getElementById('tkp_cancel')?.addEventListener('click', () => {
        renderMessages();
      });

      document.getElementById('tkp_generate')?.addEventListener('click', async () => {
        const btn = document.getElementById('tkp_generate');
        btn.disabled = true;
        btn.textContent = '⏳ Генерация...';

        const auth = AsgardAuth?.getAuth?.();
        const token = auth?.token;

        try {
          const resp = await fetch('/api/mimir/generate-tkp', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { 'Authorization': 'Bearer ' + token } : {})
            },
            body: JSON.stringify({
              customer_name: document.getElementById('tkp_customer')?.value || '',
              work_title: document.getElementById('tkp_title')?.value || '',
              services: document.getElementById('tkp_services')?.value || '',
              total_sum: document.getElementById('tkp_sum')?.value || '',
              deadline: document.getElementById('tkp_deadline')?.value || ''
            })
          });

          const data = await resp.json();

          if (data.success && data.tkp) {
            messages.push({ role: 'user', content: '📝 Сгенерировать ТКП' });
            messages.push({ role: 'assistant', content: data.tkp });
            renderMessages();
          } else {
            toast?.('Ошибка', 'Не удалось сгенерировать ТКП', 'err');
            btn.disabled = false;
            btn.textContent = '✨ Сгенерировать';
          }
        } catch (e) {
          toast?.('Ошибка', e.message, 'err');
          btn.disabled = false;
          btn.textContent = '✨ Сгенерировать';
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ПУБЛИЧНЫЕ МЕТОДЫ
  // ═══════════════════════════════════════════════════════════════════════════

  async function getTenderRecommendation(tenderId) {
    const auth = AsgardAuth?.getAuth?.();
    const token = auth?.token;

    try {
      const resp = await fetch('/api/mimir/tender-recommendation/' + tenderId, {
        headers: token ? { 'Authorization': 'Bearer ' + token } : {}
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) {
      return null;
    }
  }

  async function getFinanceStats() {
    const auth = AsgardAuth?.getAuth?.();
    const token = auth?.token;

    try {
      const resp = await fetch('/api/mimir/finance-stats', {
        headers: token ? { 'Authorization': 'Bearer ' + token } : {}
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) {
      return null;
    }
  }

  async function getWorksAnalytics() {
    const auth = AsgardAuth?.getAuth?.();
    const token = auth?.token;

    try {
      const resp = await fetch('/api/mimir/works-analytics', {
        headers: token ? { 'Authorization': 'Bearer ' + token } : {}
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) {
      return null;
    }
  }

  function open() {
    isOpen = true;
    const panel = document.getElementById('mimirPanel');
    panel?.classList.add('open');
    document.getElementById('mimirInput')?.focus();
  }

  function close() {
    isOpen = false;
    document.getElementById('mimirPanel')?.classList.remove('open');
  }

  function ask(question) {
    open();
    setTimeout(() => {
      const input = document.getElementById('mimirInput');
      if (input) {
        input.value = question;
        sendMessage();
      }
    }, 300);
  }

  // Инициализация при загрузке
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 500);
  }

  return {
    init,
    open,
    close,
    ask,
    getTenderRecommendation,
    getFinanceStats,
    getWorksAnalytics,
    openTkpGenerator
  };
})();
