/**
 * АСГАРД CRM — Мимир: Хранитель Мудрости v2.0
 * 
 * Функции:
 * - Чат с ИИ (YandexGPT)
 * - Загрузка файлов (PDF, Excel, изображения)
 * - Вопросы по тендерам, работам, финансам
 * - Генерация ТКП
 * - Умные рекомендации
 * - Ограничения по ролям
 */

window.AsgardMimir = (function(){
  const { esc, toast } = AsgardUI;
  
  let isOpen = false;
  let isMinimized = false;
  let messages = [];
  let attachedFiles = [];
  let isLoading = false;
  let userRole = null;
  let userName = '';
  
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
      .mimir-widget { position:fixed; bottom:24px; right:24px; z-index:9999; font-family:var(--font-main, -apple-system, sans-serif); }
      
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
        width:450px; max-width:calc(100vw - 48px);
        height:600px; max-height:calc(100vh - 140px);
        background:linear-gradient(180deg, #1a1a2e 0%, #0d1428 100%);
        border-radius:20px; border:2px solid rgba(245,215,142,0.3);
        box-shadow:0 10px 50px rgba(0,0,0,0.6);
        display:none; flex-direction:column; overflow:hidden;
      }
      
      .mimir-panel.open { display:flex; animation:mimirOpen 0.4s cubic-bezier(0.34,1.56,0.64,1); }
      .mimir-panel.minimized { height:64px; }
      
      @keyframes mimirOpen {
        from { opacity:0; transform:translateY(30px) scale(0.9); }
        to { opacity:1; transform:translateY(0) scale(1); }
      }
      
      .mimir-header {
        padding:16px 20px;
        background:linear-gradient(135deg, rgba(192,57,43,0.3) 0%, rgba(42,59,102,0.3) 100%);
        border-bottom:1px solid rgba(245,215,142,0.2);
        display:flex; align-items:center; gap:14px; cursor:pointer;
      }
      
      .mimir-avatar { font-size:36px; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3)); }
      .mimir-header-info { flex:1; }
      .mimir-header-title { font-size:18px; font-weight:700; color:#f5d78e; letter-spacing:1px; }
      .mimir-header-status { font-size:12px; color:rgba(255,255,255,0.6); margin-top:2px; }
      .mimir-header-actions { display:flex; gap:8px; }
      .mimir-header-btn {
        width:28px; height:28px; border-radius:8px;
        background:rgba(255,255,255,0.1); border:none; color:#fff;
        cursor:pointer; font-size:14px; transition:all 0.2s;
      }
      .mimir-header-btn:hover { background:rgba(255,255,255,0.2); }
      
      .mimir-messages {
        flex:1; overflow-y:auto; padding:20px;
        display:flex; flex-direction:column; gap:12px;
      }
      
      .mimir-messages::-webkit-scrollbar { width:6px; }
      .mimir-messages::-webkit-scrollbar-track { background:transparent; }
      .mimir-messages::-webkit-scrollbar-thumb { background:rgba(245,215,142,0.3); border-radius:3px; }
      
      .mimir-message {
        max-width:85%; padding:12px 16px;
        border-radius:16px; font-size:14px; line-height:1.5;
        animation:msgFade 0.3s ease;
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
        color:#e2e8f0; border-bottom-left-radius:4px;
        border:1px solid rgba(245,215,142,0.15);
      }
      
      .mimir-message code { background:rgba(0,0,0,0.3); padding:2px 6px; border-radius:4px; font-size:13px; }
      .mimir-message strong { color:#f5d78e; }
      
      .mimir-typing { display:flex; gap:4px; padding:12px 16px; align-self:flex-start; }
      .mimir-typing span {
        width:8px; height:8px; background:#f5d78e; border-radius:50%;
        animation:typingDot 1.4s infinite ease-in-out;
      }
      .mimir-typing span:nth-child(2) { animation-delay:0.2s; }
      .mimir-typing span:nth-child(3) { animation-delay:0.4s; }
      @keyframes typingDot { 0%,80%,100%{ transform:scale(0.6); opacity:0.5; } 40%{ transform:scale(1); opacity:1; } }
      
      .mimir-welcome { text-align:center; padding:30px 20px; }
      .mimir-welcome-icon { font-size:64px; margin-bottom:16px; filter:drop-shadow(0 4px 8px rgba(0,0,0,0.3)); }
      .mimir-welcome h3 { color:#f5d78e; font-size:20px; margin:0 0 8px; }
      .mimir-welcome p { color:rgba(255,255,255,0.7); font-size:14px; margin:0 0 20px; }
      
      .mimir-suggestions { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; }
      .mimir-suggestion {
        padding:8px 14px; border-radius:20px;
        background:rgba(245,215,142,0.1); border:1px solid rgba(245,215,142,0.3);
        color:#f5d78e; font-size:12px; cursor:pointer; transition:all 0.2s;
      }
      .mimir-suggestion:hover { background:rgba(245,215,142,0.2); transform:translateY(-2px); }
      
      .mimir-input-area {
        padding:16px 20px;
        background:rgba(0,0,0,0.2);
        border-top:1px solid rgba(245,215,142,0.1);
      }
      
      .mimir-attachments {
        display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px;
      }
      
      .mimir-attachment {
        display:flex; align-items:center; gap:6px;
        padding:6px 10px; border-radius:8px;
        background:rgba(245,215,142,0.15); font-size:12px; color:#f5d78e;
      }
      
      .mimir-attachment-remove {
        background:none; border:none; color:#ef4444; cursor:pointer;
        font-size:14px; padding:0; line-height:1;
      }
      
      .mimir-input-row { display:flex; gap:10px; align-items:flex-end; }
      
      .mimir-file-btn {
        width:44px; height:44px; border-radius:12px;
        background:rgba(255,255,255,0.1); border:1px solid rgba(245,215,142,0.2);
        color:#f5d78e; cursor:pointer; font-size:18px;
        display:flex; align-items:center; justify-content:center;
        transition:all 0.2s;
      }
      .mimir-file-btn:hover { background:rgba(255,255,255,0.15); }
      
      .mimir-input {
        flex:1; padding:12px 16px;
        background:rgba(255,255,255,0.08); border:1px solid rgba(245,215,142,0.2);
        border-radius:12px; color:#fff; font-size:14px;
        resize:none; min-height:44px; max-height:120px;
      }
      .mimir-input:focus { outline:none; border-color:rgba(245,215,142,0.5); box-shadow:0 0 15px rgba(245,215,142,0.1); }
      .mimir-input::placeholder { color:rgba(255,255,255,0.4); font-style:italic; }
      
      .mimir-send-btn {
        width:44px; height:44px; border-radius:12px;
        background:linear-gradient(135deg, #c0392b, #8e2c22);
        border:1px solid rgba(245,215,142,0.3); color:#f5d78e;
        cursor:pointer; display:flex; align-items:center; justify-content:center;
        font-size:18px; transition:all 0.2s;
      }
      .mimir-send-btn:hover { transform:scale(1.05); box-shadow:0 4px 15px rgba(192,57,43,0.4); }
      .mimir-send-btn:disabled { opacity:0.5; cursor:not-allowed; transform:none; }
      
      .mimir-quick-bar {
        display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap;
      }
      
      .mimir-quick-btn {
        padding:4px 10px; border-radius:12px;
        background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
        color:rgba(255,255,255,0.7); font-size:11px; cursor:pointer;
        transition:all 0.2s;
      }
      .mimir-quick-btn:hover { background:rgba(255,255,255,0.1); color:#f5d78e; }
      
      .mimir-wisdom {
        font-style:italic; font-size:11px; color:rgba(245,215,142,0.5);
        text-align:center; padding:8px 20px;
        border-top:1px solid rgba(245,215,142,0.1);
      }
      
      .mimir-result-card {
        background:rgba(0,0,0,0.2); border-radius:8px;
        padding:10px; margin-top:8px; font-size:13px;
      }
      
      .mimir-result-card table { width:100%; border-collapse:collapse; }
      .mimir-result-card th, .mimir-result-card td { 
        padding:4px 8px; text-align:left; 
        border-bottom:1px solid rgba(255,255,255,0.1);
      }
      .mimir-result-card th { color:#f5d78e; font-weight:600; }
      
      @media (max-width:480px) {
        .mimir-panel { width:calc(100vw - 24px); right:-12px; bottom:76px; height:calc(100vh - 120px); }
        .mimir-widget { bottom:16px; right:16px; }
        .mimir-toggle { width:56px; height:56px; }
      }
    </style>
  `;

  function init() {
    // Не показываем только на welcome/login страницах
    const hash = window.location.hash || '';
    if (!hash || hash === '#/' || hash === '#/welcome' || hash === '#/login') {
      // Удаляем виджет если есть
      const existing = document.getElementById('mimirWidget');
      if (existing) existing.remove();
      return;
    }
    
    // Если виджет уже есть - не создаём заново
    if (document.getElementById('mimirWidget')) return;
    
    if (!document.getElementById('mimir-styles')) {
      document.head.insertAdjacentHTML('beforeend', styles);
    }
    
    // Получаем роль пользователя
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
  }
  
  // Слушаем смену страницы
  window.addEventListener('hashchange', () => {
    setTimeout(init, 100);
  });
  
  function buildWidgetHTML() {
    return `
      <button class="mimir-toggle" id="mimirToggle" title="Мимир — Хранитель Мудрости">
        <span class="mimir-toggle-icon">🧙</span>
      </button>
      
      <div class="mimir-panel" id="mimirPanel">
        <div class="mimir-header" id="mimirHeader">
          <div class="mimir-avatar">🧙</div>
          <div class="mimir-header-info">
            <div class="mimir-header-title">Мимир</div>
            <div class="mimir-header-status">Хранитель Мудрости</div>
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
            <input type="file" id="mimirFileInput" style="display:none" accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.txt" multiple/>
            <textarea class="mimir-input" id="mimirInput" placeholder="Спроси у Мимира..." rows="1"></textarea>
            <button class="mimir-send-btn" id="mimirSend" title="Отправить">➤</button>
          </div>
        </div>
        
        <div class="mimir-wisdom" id="mimirWisdom"></div>
      </div>
    `;
  }

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
      messages = [];
      attachedFiles = [];
      renderMessages();
      renderAttachments();
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
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    
    // Файлы
    fileBtn?.addEventListener('click', () => fileInput?.click());
    
    fileInput?.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      files.forEach(file => {
        if (file.size > 10 * 1024 * 1024) {
          toast?.('Ошибка', 'Файл > 10 МБ', 'err');
          return;
        }
        attachedFiles.push(file);
      });
      renderAttachments();
      if (fileInput) fileInput.value = '';
    });
    
    // Быстрые команды
    document.querySelectorAll('.mimir-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        
        // Специальные действия
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
  
  // Генератор ТКП
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
          <button id="tkp_cancel" style="padding:8px 16px;border-radius:6px;background:rgba(255,255,255,0.1);border:none;color:#fff;cursor:pointer">Отмена</button>
          <button id="tkp_generate" style="padding:8px 16px;border-radius:6px;background:linear-gradient(135deg,#c0392b,#8e2c22);border:1px solid rgba(245,215,142,0.3);color:#f5d78e;cursor:pointer;font-weight:600">✨ Сгенерировать</button>
        </div>
      </div>
    `;
    
    // Показываем модалку внутри Мимира
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
        
        const auth = await AsgardAuth?.getAuth?.();
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
        } catch(e) {
          toast?.('Ошибка', e.message, 'err');
          btn.disabled = false;
          btn.textContent = '✨ Сгенерировать';
        }
      });
    }
  }
  
  function renderAttachments() {
    const container = document.getElementById('mimirAttachments');
    if (!container) return;
    
    container.innerHTML = attachedFiles.map((file, idx) => {
      const icon = getFileIcon(file.name);
      const name = file.name.length > 25 ? file.name.slice(0,22) + '...' : file.name;
      return `
        <div class="mimir-attachment">
          ${icon} ${esc(name)}
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
    if (['png', 'jpg', 'jpeg', 'gif'].includes(ext)) return '🖼️';
    return '📁';
  }

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
          <p>Я — Мимир, хранитель мудрости. Спрашивай о тендерах, работах, финансах или прикрепи файл.</p>
          <div class="mimir-suggestions">
            <button class="mimir-suggestion" data-q="Сколько у нас тендеров?">📊 Тендеры</button>
            <button class="mimir-suggestion" data-q="Найди работы по Газпром">🔍 Поиск</button>
            <button class="mimir-suggestion" data-q="Как добавить расход?">❓ Помощь</button>
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
    
    container.innerHTML = messages.map(msg => {
      let content = formatMessage(msg.content);
      
      if (msg.files && msg.files.length) {
        content += '<div style="margin-top:8px">';
        msg.files.forEach(f => {
          content += '<div class="mimir-attachment">' + getFileIcon(f.name) + ' ' + esc(f.name) + '</div>';
        });
        content += '</div>';
      }
      
      if (msg.results && msg.results.length) {
        content += renderResultsTable(msg.results);
      }
      
      return '<div class="mimir-message ' + msg.role + '">' + content + '</div>';
    }).join('');
    
    if (isLoading) {
      container.innerHTML += '<div class="mimir-typing"><span></span><span></span><span></span></div>';
    }
    
    container.scrollTop = container.scrollHeight;
  }
  
  function renderResultsTable(results) {
    if (!results || !results.length) return '';
    
    const keys = Object.keys(results[0]).slice(0, 4);
    let html = '<div class="mimir-result-card"><table><thead><tr>';
    keys.forEach(k => { html += '<th>' + esc(k) + '</th>'; });
    html += '</tr></thead><tbody>';
    
    results.slice(0, 5).forEach(row => {
      html += '<tr>';
      keys.forEach(k => { html += '<td>' + esc(String(row[k] || '-')) + '</td>'; });
      html += '</tr>';
    });
    
    if (results.length > 5) {
      html += '<tr><td colspan="' + keys.length + '" style="text-align:center;color:#f5d78e">... ещё ' + (results.length - 5) + '</td></tr>';
    }
    
    html += '</tbody></table></div>';
    return html;
  }

  function formatMessage(text) {
    if (!text) return '';
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  async function sendMessage() {
    const input = document.getElementById('mimirInput');
    const sendBtn = document.getElementById('mimirSend');
    const text = (input?.value || '').trim();
    
    if (!text && !attachedFiles.length) return;
    if (isLoading) return;
    
    const userMsg = { 
      role: 'user', 
      content: text || '(Файл)',
      files: attachedFiles.map(f => ({ name: f.name, type: f.type, size: f.size }))
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
      const response = await callMimir(text, filesToSend);
      messages.push({ 
        role: 'assistant', 
        content: response.text || response,
        results: response.results
      });
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
  }

  async function callMimir(text, files) {
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

    // Контекст по разделу
    let context = '';
    const hash = window.location.hash || '';
    if (hash.includes('tender')) context = 'Тендеры';
    else if (hash.includes('work') || hash.includes('pm-')) context = 'Работы';
    else if (hash.includes('financ') || hash.includes('buh') || hash.includes('invoice')) context = 'Финансы';
    else if (hash.includes('employee') || hash.includes('hr')) context = 'Персонал';
    
    // Токен
    const auth = await AsgardAuth?.getAuth?.();
    const token = auth?.token;
    
    // С файлами — FormData
    if (files && files.length > 0) {
      const formData = new FormData();
      formData.append('message', text || '');
      formData.append('context', context);
      files.forEach((f, i) => formData.append('file_' + i, f));
      
      const resp = await fetch('/api/mimir/analyze', {
        method: 'POST',
        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
        body: formData
      });
      
      if (!resp.ok) throw new Error('API error');
      const data = await resp.json();
      return { text: data.response || data.message || 'Файл получен.' };
    }
    
    // Обычный запрос
    const resp = await fetch('/api/mimir/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      },
      body: JSON.stringify({ message: text, context: context })
    });
    
    if (!resp.ok) throw new Error('API error');
    const data = await resp.json();
    
    return {
      text: data.response || 'Руны молчат...',
      results: data.results
    };
  }
  
  // Получить рекомендацию по тендеру
  async function getTenderRecommendation(tenderId) {
    const auth = await AsgardAuth?.getAuth?.();
    const token = auth?.token;
    
    try {
      const resp = await fetch('/api/mimir/tender-recommendation/' + tenderId, {
        headers: token ? { 'Authorization': 'Bearer ' + token } : {}
      });
      
      if (!resp.ok) return null;
      return await resp.json();
    } catch(e) {
      return null;
    }
  }
  
  // Получить финансовую статистику
  async function getFinanceStats() {
    const auth = await AsgardAuth?.getAuth?.();
    const token = auth?.token;
    
    try {
      const resp = await fetch('/api/mimir/finance-stats', {
        headers: token ? { 'Authorization': 'Bearer ' + token } : {}
      });
      
      if (!resp.ok) return null;
      return await resp.json();
    } catch(e) {
      return null;
    }
  }
  
  // Получить аналитику работ
  async function getWorksAnalytics() {
    const auth = await AsgardAuth?.getAuth?.();
    const token = auth?.token;
    
    try {
      const resp = await fetch('/api/mimir/works-analytics', {
        headers: token ? { 'Authorization': 'Bearer ' + token } : {}
      });
      
      if (!resp.ok) return null;
      return await resp.json();
    } catch(e) {
      return null;
    }
  }

  // Public API
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

  // Init on load
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
