/**
 * АСГАРД CRM — Мимир: Хранитель Мудрости v4.0
 * iPhone-дизайн модалка (FAB десктоп only)
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
  let useStreaming = false;
  let unreadDigestCount = 0;

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

  // ═══════════════════════════════════════════════════════════════════════════
  // CSS — iPhone-дизайн
  // ═══════════════════════════════════════════════════════════════════════════

  const styles = `
    <style id="mimir-styles">
      /* ── FAB кнопка ── */
      .mimir-widget { position:fixed; bottom:24px; right:24px; z-index:500; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }

      .mimir-fab {
        width:60px; height:60px; border-radius:50%;
        background:linear-gradient(135deg, #c0392b 0%, #2a3b66 100%);
        border:none; cursor:pointer;
        display:flex; align-items:center; justify-content:center;
        box-shadow:0 6px 24px rgba(192,57,43,0.45), 0 0 0 0 rgba(245,215,142,0.3);
        transition:all 0.35s cubic-bezier(0.34,1.56,0.64,1);
        position:relative;
      }
      .mimir-fab:hover {
        transform:scale(1.12);
        box-shadow:0 8px 32px rgba(192,57,43,0.5), 0 0 0 4px rgba(245,215,142,0.25);
      }
      .mimir-fab.has-unread { animation:iphoneFabPulse 4s infinite; }
      .mimir-fab.is-open { transform:rotate(180deg) scale(0.88); }
      .mimir-fab-emoji { font-size:28px; transition:opacity 0.2s; pointer-events:none; }
      .mimir-fab.is-open .mimir-fab-emoji { opacity:0; }
      .mimir-fab.is-open::after {
        content:'\\2715'; position:absolute; font-size:22px; color:#fff; font-weight:300;
      }

      /* Руна ᛗ badge */
      .mimir-fab-rune {
        position:absolute; top:-2px; left:-2px;
        width:22px; height:22px; background:#f5d78e; border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        font-size:12px; color:#2a3b66; font-weight:bold; font-family:serif;
        box-shadow:0 2px 6px rgba(0,0,0,0.35);
      }

      /* Notification count badge */
      .mimir-fab-count {
        position:absolute; top:-6px; right:-6px;
        min-width:20px; height:20px; padding:0 5px;
        background:linear-gradient(135deg, #e74c3c, #c0392b); border-radius:10px;
        display:none; align-items:center; justify-content:center;
        font-size:11px; color:#fff; font-weight:700;
        box-shadow:0 2px 8px rgba(231,76,60,0.5);
        animation:iphoneBadge 0.4s cubic-bezier(0.34,1.56,0.64,1);
      }
      .mimir-fab-count.visible { display:flex; }

      /* Tooltip */
      .mimir-fab-tooltip {
        position:absolute; right:72px; top:50%; transform:translateY(-50%) translateX(8px);
        background:rgba(26,26,26,0.95); color:#f5d78e; padding:8px 14px;
        border-radius:10px; font-size:13px; font-weight:500;
        white-space:nowrap; pointer-events:none;
        opacity:0; transition:all 0.25s ease;
        box-shadow:0 4px 16px rgba(0,0,0,0.4);
      }
      .mimir-fab:hover .mimir-fab-tooltip {
        opacity:1; transform:translateY(-50%) translateX(0);
      }

      /* ── iPhone модалка ── */
      .mimir-iphone {
        position:fixed; bottom:96px; right:24px;
        width:380px; height:740px;
        max-height:calc(100vh - 120px);
        display:none; flex-direction:column;
        z-index:501;
      }
      .mimir-iphone.open {
        display:flex;
        animation:iphoneOpen 0.5s cubic-bezier(0.34,1.56,0.64,1);
      }

      /* Корпус iPhone */
      .mimir-iphone-body {
        flex:1; display:flex; flex-direction:column;
        background:#1a1a1a; border-radius:44px; padding:4px;
        box-shadow:
          inset 0 0 0 1px rgba(255,255,255,0.08),
          0 25px 80px rgba(0,0,0,0.6),
          0 0 0 2px rgba(60,60,60,0.5);
        position:relative; overflow:hidden;
        min-height:0;
      }

      /* Боковые кнопки (декор) */
      .mimir-iphone-btn-power {
        position:absolute; right:-3px; top:140px;
        width:3px; height:44px; background:#333; border-radius:0 2px 2px 0;
      }
      .mimir-iphone-btn-vol1 {
        position:absolute; left:-3px; top:120px;
        width:3px; height:28px; background:#333; border-radius:2px 0 0 2px;
      }
      .mimir-iphone-btn-vol2 {
        position:absolute; left:-3px; top:156px;
        width:3px; height:28px; background:#333; border-radius:2px 0 0 2px;
      }

      /* Экран */
      .mimir-iphone-screen {
        flex:1; display:flex; flex-direction:column;
        background:linear-gradient(180deg, #0d1428 0%, #0a0e1a 100%);
        border-radius:40px; overflow:hidden; min-height:0;
      }

      /* Dynamic Island */
      .mimir-dynamic-island {
        width:120px; height:32px; background:#000;
        border-radius:16px; margin:8px auto 0;
        position:relative; z-index:2;
      }

      /* Status bar */
      .mimir-status-bar {
        display:flex; align-items:center; justify-content:space-between;
        padding:4px 24px 8px; font-size:14px; font-weight:600; color:#fff;
      }
      .mimir-status-bar-time { min-width:40px; }
      .mimir-status-bar-icons { display:flex; align-items:center; gap:6px; }
      .mimir-status-bar-icons svg { width:16px; height:16px; }

      /* Header чата */
      .mimir-chat-header {
        display:flex; align-items:center; gap:10px;
        padding:10px 16px;
        background:linear-gradient(135deg, rgba(192,57,43,0.15) 0%, rgba(42,59,102,0.15) 100%);
        border-bottom:1px solid rgba(245,215,142,0.08);
      }
      .mimir-back-btn {
        background:none; border:none; color:#f5d78e; font-size:22px;
        cursor:pointer; padding:4px; line-height:1;
      }
      .mimir-chat-avatar {
        width:32px; height:32px; border-radius:50%;
        background:linear-gradient(135deg, #c0392b, #2a3b66);
        display:flex; align-items:center; justify-content:center;
        font-size:18px; flex-shrink:0;
      }
      .mimir-chat-info { flex:1; min-width:0; }
      .mimir-chat-name {
        font-size:16px; font-weight:700; color:#f5d78e; letter-spacing:0.5px;
      }
      .mimir-chat-subtitle {
        font-size:11px; color:rgba(255,255,255,0.5); margin-top:1px;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      }

      /* Sidebar */
      .mimir-sidebar {
        position:absolute; top:0; left:0; bottom:0;
        width:220px; background:rgba(10,14,26,0.97);
        border-right:1px solid rgba(245,215,142,0.1);
        transform:translateX(-100%); transition:transform 0.3s ease;
        z-index:10; display:flex; flex-direction:column;
        border-radius:40px 0 0 40px; padding-top:60px;
      }
      .mimir-sidebar.open { transform:translateX(0); }
      .mimir-sidebar-header { padding:12px; border-bottom:1px solid rgba(245,215,142,0.08); }
      .mimir-sidebar-new {
        width:100%; padding:10px; border-radius:10px;
        background:linear-gradient(135deg, #c0392b, #8e2c22);
        border:1px solid rgba(245,215,142,0.15); color:#f5d78e;
        cursor:pointer; font-weight:600; font-size:13px; transition:all 0.2s;
      }
      .mimir-sidebar-new:hover { transform:scale(1.02); }
      .mimir-sidebar-list { flex:1; overflow-y:auto; padding:8px; }
      .mimir-sidebar-item {
        padding:10px 12px; margin-bottom:4px; border-radius:10px;
        background:rgba(255,255,255,0.03); cursor:pointer;
        transition:all 0.2s; font-size:13px; color:rgba(255,255,255,0.65);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      }
      .mimir-sidebar-item:hover { background:rgba(255,255,255,0.06); }
      .mimir-sidebar-item.active { background:rgba(245,215,142,0.12); color:#f5d78e; }
      .mimir-sidebar-item.pinned::before { content:'\\1F4CC '; }

      /* Сообщения */
      .mimir-messages {
        flex:1; overflow-y:auto; padding:12px 14px;
        display:flex; flex-direction:column; gap:6px;
        min-height:0;
      }
      .mimir-messages::-webkit-scrollbar { width:0; }

      .mimir-msg {
        max-width:85%; padding:10px 14px; font-size:14px; line-height:1.55;
        position:relative; animation:iphoneBubble 0.3s ease;
      }

      .mimir-msg.user {
        align-self:flex-end;
        background:linear-gradient(135deg, #c0392b, #2a3b66);
        color:#fff; border-radius:18px 18px 4px 18px;
      }
      .mimir-msg.assistant {
        align-self:flex-start;
        background:rgba(255,255,255,0.05);
        color:rgba(255,255,255,0.9); border-radius:18px 18px 18px 4px;
        margin-left:38px; position:relative;
      }
      .mimir-msg-bot-avatar {
        position:absolute; left:-38px; bottom:0;
        width:30px; height:30px; border-radius:50%;
        background:linear-gradient(135deg, #c0392b, #2a3b66);
        display:flex; align-items:center; justify-content:center;
        font-size:16px;
      }
      .mimir-msg-meta {
        display:flex; align-items:center; justify-content:flex-end;
        gap:4px; margin-top:4px;
        font-size:9.5px; color:rgba(255,255,255,0.35);
      }
      .mimir-msg.user .mimir-msg-meta::after {
        content:'\\2713\\2713'; font-size:10px; color:rgba(100,180,255,0.6); margin-left:2px;
      }

      /* Copy button */
      .mimir-msg-copy {
        position:absolute; top:6px; right:6px;
        width:24px; height:24px; border-radius:6px;
        background:rgba(0,0,0,0.3); border:none; color:rgba(255,255,255,0.45);
        cursor:pointer; font-size:11px; opacity:0; transition:opacity 0.2s;
        display:flex; align-items:center; justify-content:center;
      }
      .mimir-msg:hover .mimir-msg-copy { opacity:1; }

      /* Typing dots */
      .mimir-typing-dots {
        display:flex; gap:5px; padding:10px 14px; align-self:flex-start;
        margin-left:38px; position:relative;
      }
      .mimir-typing-dots::before {
        content:'\\1F9D9'; position:absolute; left:-38px; bottom:0;
        width:30px; height:30px; border-radius:50%;
        background:linear-gradient(135deg, #c0392b, #2a3b66);
        display:flex; align-items:center; justify-content:center; font-size:16px;
      }
      .mimir-typing-dot {
        width:8px; height:8px; border-radius:50%;
        background:rgba(245,215,142,0.55);
        animation:iphoneDot 1.4s infinite ease-in-out;
      }
      .mimir-typing-dot:nth-child(2) { animation-delay:0.15s; }
      .mimir-typing-dot:nth-child(3) { animation-delay:0.3s; }

      /* Welcome */
      .mimir-welcome { text-align:center; padding:40px 20px; }
      .mimir-welcome-icon { font-size:48px; margin-bottom:12px; }
      .mimir-welcome h3 { color:#f5d78e; font-size:17px; margin:0 0 8px; font-weight:600; }
      .mimir-welcome p { color:rgba(255,255,255,0.55); font-size:13px; margin:0 0 18px; line-height:1.5; }
      .mimir-welcome-chips { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; }
      .mimir-welcome-chip {
        padding:7px 16px; border-radius:100px;
        background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);
        color:#f5d78e; font-size:12px; cursor:pointer; transition:all 0.2s;
      }
      .mimir-welcome-chip:hover {
        background:rgba(245,215,142,0.12); border-color:rgba(245,215,142,0.25);
      }

      /* Markdown */
      .mimir-code { background:rgba(0,0,0,0.4); border-radius:10px; padding:12px; margin:8px 0;
        font-family:'JetBrains Mono','Fira Code',monospace; font-size:12px; overflow-x:auto; white-space:pre; }
      .mimir-inline-code { background:rgba(0,0,0,0.3); padding:2px 6px; border-radius:4px; font-size:13px; font-family:monospace; }
      .mimir-h2 { font-size:16px; font-weight:700; color:#f5d78e; margin:14px 0 8px; }
      .mimir-h3 { font-size:14px; font-weight:600; color:#cbd5e1; margin:12px 0 6px; }
      .mimir-li { padding-left:16px; margin:3px 0; position:relative; }
      .mimir-li::before { content:'\\2022'; position:absolute; left:0; color:#f5d78e; }
      .mimir-li-num { padding-left:20px; margin:3px 0; }
      .mimir-table { width:100%; border-collapse:collapse; margin:10px 0; font-size:13px; }
      .mimir-table th { background:rgba(245,215,142,0.15); color:#f5d78e; font-weight:600;
        padding:8px 10px; text-align:left; border-bottom:1px solid rgba(245,215,142,0.3); }
      .mimir-table td { padding:6px 10px; border-bottom:1px solid rgba(255,255,255,0.06); }
      .mimir-msg strong { color:#f5d78e; }

      /* Streaming cursor */
      .mimir-streaming-cursor {
        display:inline-block; width:7px; height:15px;
        background:#f5d78e; margin-left:2px;
        animation:mimirBlink 1s infinite;
      }
      @keyframes mimirBlink { 0%,50%{opacity:1;} 51%,100%{opacity:0;} }

      /* Result cards */
      .mimir-result-card {
        background:rgba(0,0,0,0.2); border-radius:12px;
        padding:12px; margin-top:8px; font-size:13px;
      }
      .mimir-result-card table { width:100%; border-collapse:collapse; }
      .mimir-result-card th, .mimir-result-card td {
        padding:4px 8px; text-align:left; border-bottom:1px solid rgba(255,255,255,0.08);
      }
      .mimir-result-card th { color:#f5d78e; font-weight:600; }

      /* Attachments */
      .mimir-attachments { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
      .mimir-attachment {
        display:flex; align-items:center; gap:5px;
        padding:5px 10px; border-radius:8px;
        background:rgba(245,215,142,0.08); font-size:11px; color:#f5d78e;
      }
      .mimir-attachment-remove {
        background:none; border:none; color:#e74c3c; cursor:pointer;
        font-size:13px; padding:0; line-height:1;
      }

      /* Input area — iMessage style */
      .mimir-input-area {
        padding:8px 12px 4px;
        background:rgba(0,0,0,0.15);
        border-top:1px solid rgba(255,255,255,0.05);
      }
      .mimir-input-row { display:flex; gap:8px; align-items:flex-end; }

      .mimir-plus-btn {
        width:34px; height:34px; border-radius:50%;
        background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12);
        color:#f5d78e; cursor:pointer; font-size:20px; font-weight:300;
        display:flex; align-items:center; justify-content:center;
        transition:all 0.2s; flex-shrink:0;
      }
      .mimir-plus-btn:hover { background:rgba(255,255,255,0.12); }

      .mimir-input {
        flex:1; padding:8px 14px;
        background:transparent; border:1px solid rgba(245,215,142,0.08);
        border-radius:20px; color:#fff; font-size:14px;
        resize:none; min-height:34px; max-height:100px;
        line-height:1.4; font-family:inherit;
      }
      .mimir-input:focus {
        outline:none; border-color:rgba(245,215,142,0.25);
      }
      .mimir-input::placeholder { color:rgba(245,215,142,0.18); }

      .mimir-send-btn {
        width:34px; height:34px; border-radius:50%;
        border:none; cursor:pointer;
        display:flex; align-items:center; justify-content:center;
        font-size:16px; transition:all 0.2s; flex-shrink:0;
      }
      .mimir-send-btn.mic-mode {
        background:transparent; color:rgba(255,255,255,0.4);
      }
      .mimir-send-btn.send-mode {
        background:linear-gradient(135deg, #c0392b, #2a3b66);
        color:#fff;
        animation:iphoneSendPop 0.2s cubic-bezier(0.34,1.56,0.64,1);
      }
      .mimir-send-btn:disabled { opacity:0.4; cursor:not-allowed; }

      /* Wisdom bar */
      .mimir-wisdom {
        font-style:italic; font-size:9px; color:rgba(245,215,142,0.35);
        text-align:center; padding:4px 14px 2px;
      }

      /* Home indicator */
      .mimir-home-indicator {
        width:134px; height:5px; background:rgba(255,255,255,0.15);
        border-radius:3px; margin:6px auto 8px;
      }

      /* Drag & drop */
      .mimir-iphone-screen.drag-over { border:2px dashed #f5d78e; }
      .mimir-drop-overlay {
        position:absolute; inset:0; background:rgba(10,14,26,0.93);
        display:none; align-items:center; justify-content:center;
        flex-direction:column; gap:14px; z-index:20;
        border-radius:40px; backdrop-filter:blur(8px);
      }
      .mimir-iphone-screen.drag-over .mimir-drop-overlay { display:flex; }
      .mimir-drop-icon { font-size:40px; }
      .mimir-drop-text { color:#f5d78e; font-size:15px; font-weight:600; }

      /* Desktop only */
      @media (max-width:768px) { .mimir-widget { display:none !important; } }

      /* ── Animations ── */
      @keyframes iphoneOpen {
        0% { opacity:0; transform:translateY(40px) scale(0.85) rotateX(8deg); }
        70% { opacity:1; transform:translateY(-8px) scale(1.02) rotateX(0); }
        100% { opacity:1; transform:translateY(0) scale(1) rotateX(0); }
      }
      @keyframes iphoneBubble {
        from { opacity:0; transform:translateY(6px) scale(0.97); }
        to { opacity:1; transform:translateY(0) scale(1); }
      }
      @keyframes iphoneDot {
        0%,80%,100% { transform:scale(0.5); opacity:0.3; }
        40% { transform:scale(1.1); opacity:1; }
      }
      @keyframes iphoneFabPulse {
        0%,100% { box-shadow:0 6px 24px rgba(192,57,43,0.45), 0 0 0 0 rgba(245,215,142,0.3); }
        50% { box-shadow:0 6px 24px rgba(192,57,43,0.45), 0 0 0 12px rgba(245,215,142,0); }
      }
      @keyframes iphoneSendPop {
        from { transform:scale(0.5); }
        to { transform:scale(1); }
      }
      @keyframes iphoneBadge {
        0% { transform:scale(0); }
        60% { transform:scale(1.3); }
        100% { transform:scale(1); }
      }
    </style>
  `;

  // ═══════════════════════════════════════════════════════════════════════════
  // ИНИЦИАЛИЗАЦИЯ
  // ═══════════════════════════════════════════════════════════════════════════

  function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      || (window.innerWidth <= 768)
      || (typeof window.MobileShell !== 'undefined');
  }

  function init() {
    if (isMobileDevice()) return;

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
    startStatusBarClock();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTML — iPhone модалка
  // ═══════════════════════════════════════════════════════════════════════════

  function buildWidgetHTML() {
    return `
      <button class="mimir-fab" id="mimirFab">
        <span class="mimir-fab-emoji">\uD83E\uDDD9</span>
        <span class="mimir-fab-rune">\u16D7</span>
        <span class="mimir-fab-count" id="mimirFabCount"></span>
        <span class="mimir-fab-tooltip">\uD83E\uDDD9 Мимир \u2014 Хранитель Мудрости</span>
      </button>

      <div class="mimir-iphone" id="mimirIphone">
        <div class="mimir-iphone-body">
          <div class="mimir-iphone-btn-power"></div>
          <div class="mimir-iphone-btn-vol1"></div>
          <div class="mimir-iphone-btn-vol2"></div>

          <div class="mimir-iphone-screen" id="mimirScreen">
            <div class="mimir-drop-overlay">
              <span class="mimir-drop-icon">\uD83D\uDCCE</span>
              <span class="mimir-drop-text">Отпусти файлы здесь</span>
            </div>

            <div class="mimir-sidebar" id="mimirSidebar">
              <div class="mimir-sidebar-header">
                <button class="mimir-sidebar-new" id="mimirNewChat">+ Новый диалог</button>
              </div>
              <div class="mimir-sidebar-list" id="mimirConversations"></div>
            </div>

            <div class="mimir-dynamic-island"></div>

            <div class="mimir-status-bar">
              <span class="mimir-status-bar-time" id="mimirClock">--:--</span>
              <span class="mimir-status-bar-icons">
                <svg viewBox="0 0 16 16" fill="white"><path d="M1 10h2v4H1zm4-3h2v7H5zm4-3h2v10H9zm4-3h2v13h-2z"/></svg>
                <svg viewBox="0 0 16 16" fill="white"><path d="M8 3C5.5 3 3.3 4 1.7 5.7l1.4 1.4C4.5 5.7 6.1 5 8 5s3.5.7 4.9 2.1l1.4-1.4C12.7 4 10.5 3 8 3zm0 4c-1.4 0-2.6.5-3.5 1.4l1.4 1.4C6.5 9.3 7.2 9 8 9s1.5.3 2.1.8l1.4-1.4C10.6 7.5 9.4 7 8 7zm0 4c-.6 0-1 .4-1 1s.4 1 1 1 1-.4 1-1-.4-1-1-1z"/></svg>
                <svg viewBox="0 0 24 16" fill="none"><rect x="0" y="2" width="20" height="12" rx="2" stroke="white" stroke-width="1.5"/><rect x="2" y="4" width="14" height="8" rx="1" fill="#4CD964"/><rect x="21" y="5" width="2" height="6" rx="1" fill="white" opacity="0.4"/></svg>
              </span>
            </div>

            <div class="mimir-chat-header">
              <button class="mimir-back-btn" id="mimirBack">\u2039</button>
              <div class="mimir-chat-avatar">\uD83E\uDDD9</div>
              <div class="mimir-chat-info">
                <div class="mimir-chat-name">Мимир</div>
                <div class="mimir-chat-subtitle" id="mimirStatus">Хранитель Мудрости</div>
              </div>
            </div>

            <div class="mimir-messages" id="mimirMessages"></div>

            <div class="mimir-input-area">
              <div class="mimir-attachments" id="mimirAttachments"></div>
              <div class="mimir-input-row">
                <button class="mimir-plus-btn" id="mimirFileBtn" title="Прикрепить">+</button>
                <input type="file" id="mimirFileInput" style="display:none"
                  accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.gif,.webp,.txt" multiple/>
                <textarea class="mimir-input" id="mimirInput" placeholder="Сообщение Мимиру..." rows="1"></textarea>
                <button class="mimir-send-btn mic-mode" id="mimirSend" title="Отправить">\uD83C\uDF99</button>
              </div>
            </div>

            <div class="mimir-wisdom" id="mimirWisdom"></div>
            <div class="mimir-home-indicator"></div>
          </div>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS BAR CLOCK
  // ═══════════════════════════════════════════════════════════════════════════

  let _clockInterval = null;

  function startStatusBarClock() {
    updateClock();
    _clockInterval = setInterval(updateClock, 30000);
  }

  function updateClock() {
    const el = document.getElementById('mimirClock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // СОБЫТИЯ
  // ═══════════════════════════════════════════════════════════════════════════

  function bindEvents() {
    const fab = document.getElementById('mimirFab');
    const back = document.getElementById('mimirBack');
    const sendBtn = document.getElementById('mimirSend');
    const input = document.getElementById('mimirInput');
    const fileBtn = document.getElementById('mimirFileBtn');
    const fileInput = document.getElementById('mimirFileInput');
    const screen = document.getElementById('mimirScreen');
    const newChatBtn = document.getElementById('mimirNewChat');

    fab?.addEventListener('click', () => {
      if (isOpen) close(); else open();
    });

    back?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSidebarOpen) {
        isSidebarOpen = false;
        document.getElementById('mimirSidebar')?.classList.remove('open');
      } else {
        close();
      }
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
      updateSendButton();
    });

    // File
    fileBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      addFiles(files);
      if (fileInput) fileInput.value = '';
    });

    // Drag & Drop
    screen?.addEventListener('dragover', (e) => {
      e.preventDefault();
      screen.classList.add('drag-over');
    });
    screen?.addEventListener('dragleave', (e) => {
      e.preventDefault();
      screen.classList.remove('drag-over');
    });
    screen?.addEventListener('drop', (e) => {
      e.preventDefault();
      screen.classList.remove('drag-over');
      addFiles(Array.from(e.dataTransfer?.files || []));
    });

    newChatBtn?.addEventListener('click', startNewChat);
  }

  function updateSendButton() {
    const input = document.getElementById('mimirInput');
    const btn = document.getElementById('mimirSend');
    if (!input || !btn) return;
    const hasText = (input.value || '').trim().length > 0;
    if (hasText) {
      btn.className = 'mimir-send-btn send-mode';
      btn.innerHTML = '\u25B2';
    } else {
      btn.className = 'mimir-send-btn mic-mode';
      btn.innerHTML = '\uD83C\uDF99';
    }
  }

  function updateFabBadge() {
    const el = document.getElementById('mimirFabCount');
    const fab = document.getElementById('mimirFab');
    if (!el || !fab) return;
    if (unreadDigestCount > 0) {
      el.textContent = String(unreadDigestCount);
      el.classList.add('visible');
      fab.classList.add('has-unread');
    } else {
      el.classList.remove('visible');
      fab.classList.remove('has-unread');
    }
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
      return '<div class="mimir-sidebar-item ' + active + ' ' + pinned + '" data-conv-id="' + conv.id + '">' + title + '</div>';
    }).join('');

    container.querySelectorAll('.mimir-sidebar-item').forEach(item => {
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
        isSidebarOpen = false;
        document.getElementById('mimirSidebar')?.classList.remove('open');
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
    isSidebarOpen = false;
    document.getElementById('mimirSidebar')?.classList.remove('open');
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
      return '<div class="mimir-attachment">' +
        icon + ' ' + esc(name) +
        ' <span style="font-size:10px;opacity:0.6">(' + size + ')</span>' +
        ' <button class="mimir-attachment-remove" data-idx="' + idx + '">\u2715</button>' +
        '</div>';
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
    if (['pdf'].includes(ext)) return '\uD83D\uDCD5';
    if (['xlsx', 'xls', 'csv'].includes(ext)) return '\uD83D\uDCCA';
    if (['doc', 'docx', 'txt'].includes(ext)) return '\uD83D\uDCC4';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '\uD83D\uDDBC\uFE0F';
    return '\uD83D\uDCC1';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // СООБЩЕНИЯ
  // ═══════════════════════════════════════════════════════════════════════════

  function showWisdom() {
    const el = document.getElementById('mimirWisdom');
    if (el) {
      const wisdom = VIKING_WISDOM[Math.floor(Math.random() * VIKING_WISDOM.length)];
      el.textContent = '\u00AB ' + wisdom + ' \u00BB';
    }
  }

  function _loadSuggestionChips(container) {
    const token = localStorage.getItem('asgard_token');
    if (!token) return;
    fetch('/api/mimir/suggestions', {
      headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(r => r.json())
    .then(data => {
      const chips = document.getElementById('mimir-suggestion-chips');
      if (!chips) return;
      const items = data.suggestions || [
        { icon: '\uD83D\uDCCA', label: '\u0422\u0435\u043D\u0434\u0435\u0440\u044B', query: '\u0421\u043A\u043E\u043B\u044C\u043A\u043E \u0443 \u043D\u0430\u0441 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0442\u0435\u043D\u0434\u0435\u0440\u043E\u0432?' },
        { icon: '\uD83D\uDD0D', label: '\u041F\u043E\u0438\u0441\u043A', query: '\u041D\u0430\u0439\u0434\u0438 \u0440\u0430\u0431\u043E\u0442\u044B \u043F\u043E \u0413\u0430\u0437\u043F\u0440\u043E\u043C' },
        { icon: '\u2753', label: '\u041F\u043E\u043C\u043E\u0449\u044C', query: '\u041A\u0430\u043A \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043D\u043E\u0432\u044B\u0439 \u0440\u0430\u0441\u0445\u043E\u0434?' }
      ];
      chips.innerHTML = items.map(s =>
        '<button class="mimir-welcome-chip" data-q="' + esc(s.query) + '">' + s.icon + ' ' + esc(s.label) + '</button>'
      ).join('');
      chips.querySelectorAll('.mimir-welcome-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const input = document.getElementById('mimirInput');
          if (input) input.value = btn.dataset.q;
          sendMessage();
        });
      });
    })
    .catch(() => {
      const chips = document.getElementById('mimir-suggestion-chips');
      if (!chips) return;
      chips.innerHTML =
        '<button class="mimir-welcome-chip" data-q="\u0421\u043A\u043E\u043B\u044C\u043A\u043E \u0443 \u043D\u0430\u0441 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0442\u0435\u043D\u0434\u0435\u0440\u043E\u0432?">\uD83D\uDCCA \u0422\u0435\u043D\u0434\u0435\u0440\u044B</button>' +
        '<button class="mimir-welcome-chip" data-q="\u041D\u0430\u0439\u0434\u0438 \u0440\u0430\u0431\u043E\u0442\u044B \u043F\u043E \u0413\u0430\u0437\u043F\u0440\u043E\u043C">\uD83D\uDD0D \u041F\u043E\u0438\u0441\u043A</button>' +
        '<button class="mimir-welcome-chip" data-q="\u041A\u0430\u043A \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043D\u043E\u0432\u044B\u0439 \u0440\u0430\u0441\u0445\u043E\u0434?">\u2753 \u041F\u043E\u043C\u043E\u0449\u044C</button>';
      chips.querySelectorAll('.mimir-welcome-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const input = document.getElementById('mimirInput');
          if (input) input.value = btn.dataset.q;
          sendMessage();
        });
      });
    });
  }

  function renderMessages() {
    const container = document.getElementById('mimirMessages');
    if (!container) return;

    if (messages.length === 0) {
      container.innerHTML =
        '<div class="mimir-welcome">' +
          '<div class="mimir-welcome-icon">\uD83E\uDDD9</div>' +
          '<h3>Приветствую тебя, ' + esc(userName) + '!</h3>' +
          '<p>Я \u2014 Мимир, хранитель мудрости. Спрашивай о тендерах, работах, финансах или прикрепи файл для анализа.</p>' +
          '<div class="mimir-welcome-chips" id="mimir-suggestion-chips">' +
            '<span style="opacity:0.5;font-size:12px">Загрузка подсказок\u2026</span>' +
          '</div>' +
        '</div>';

      // Загружаем персональные подсказки с сервера
      _loadSuggestionChips(container);
      return;
    }

    const now = new Date();
    container.innerHTML = messages.map((msg, idx) => {
      let content = renderMarkdown(msg.content);

      if (msg.files && msg.files.length) {
        content += '<div style="margin-top:6px;font-size:11px;opacity:0.7">';
        msg.files.forEach(f => {
          content += '<span style="margin-right:6px">' + getFileIcon(f) + ' ' + esc(f) + '</span>';
        });
        content += '</div>';
      }

      if (msg.results && msg.results.length) {
        content += renderResultsTable(msg.results);
      }

      const copyBtn = msg.role === 'assistant'
        ? '<button class="mimir-msg-copy" data-msg-idx="' + idx + '" title="Копировать">\uD83D\uDCCB</button>'
        : '';

      const streamCursor = msg.isStreaming ? '<span class="mimir-streaming-cursor"></span>' : '';

      const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

      const botAvatar = msg.role === 'assistant'
        ? '<div class="mimir-msg-bot-avatar">\uD83E\uDDD9</div>'
        : '';

      return '<div class="mimir-msg ' + msg.role + '">' +
        botAvatar + copyBtn +
        '<div class="mimir-msg-content">' + content + streamCursor + '</div>' +
        '<div class="mimir-msg-meta">' + timeStr + '</div>' +
        '</div>';
    }).join('');

    if (isLoading && !messages[messages.length - 1]?.isStreaming) {
      container.innerHTML +=
        '<div class="mimir-typing-dots">' +
          '<span class="mimir-typing-dot"></span>' +
          '<span class="mimir-typing-dot"></span>' +
          '<span class="mimir-typing-dot"></span>' +
        '</div>';
    }

    container.scrollTop = container.scrollHeight;

    // Copy
    container.querySelectorAll('.mimir-msg-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.msgIdx);
        const text = messages[idx]?.content || '';
        navigator.clipboard?.writeText(text).then(() => {
          btn.textContent = '\u2713';
          setTimeout(() => { btn.textContent = '\uD83D\uDCCB'; }, 1500);
        });
      });
    });
  }

  function updateLastMessage(text) {
    const container = document.getElementById('mimirMessages');
    const lastMsg = container?.querySelector('.mimir-msg.assistant:last-child .mimir-msg-content');
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

    let html = esc(text);

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      return '<pre class="mimir-code"><code>' + code.trim() + '</code></pre>';
    });

    // Inline code
    html = html.replace(/`([^`\n]+)`/g, '<code class="mimir-inline-code">$1</code>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<div class="mimir-h3">$1</div>');
    html = html.replace(/^## (.+)$/gm, '<div class="mimir-h2">$1</div>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(m, text, url) {
      if (url.startsWith('#/')) {
        return '<a href="' + url + '" style="color:#f5d78e;text-decoration:underline;cursor:pointer" onclick="if(window.AsgardMimir)window.AsgardMimir.close();window.location.hash=\'' + url.replace('#', '') + '\';return false;">' + text + '</a>';
      }
      return '<a href="' + url + '" target="_blank" style="color:#f5d78e;text-decoration:underline">' + text + '</a>';
    });

    // Bold & italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

    // Lists
    html = html.replace(/^- (.+)$/gm, '<div class="mimir-li">$1</div>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<div class="mimir-li-num">$1. $2</div>');

    // Tables
    html = html.replace(/(\|.+\|[\r\n])+/g, (match) => {
      const rows = match.trim().split('\n').filter(r => r.trim());
      if (rows.length < 2) return match;

      let table = '<table class="mimir-table">';
      let isHeader = true;

      for (const row of rows) {
        if (row.match(/^\|[\s\-:|]+\|$/)) { isHeader = false; continue; }
        const cells = row.split('|').filter(c => c.trim());
        const tag = isHeader ? 'th' : 'td';
        table += '<tr>' + cells.map(c => '<' + tag + '>' + c.trim() + '</' + tag + '>').join('') + '</tr>';
        if (isHeader) isHeader = false;
      }

      table += '</table>';
      return table;
    });

    // HR
    html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid rgba(245,215,142,0.15);margin:10px 0">');

    // Paragraphs
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    return '<p>' + html + '</p>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // СОЗДАНИЕ ТКП ЧЕРЕЗ ЧАТ
  // ═══════════════════════════════════════════════════════════════════════════

  async function handleCreateTkpAction(action, userMessage) {
    var lastMsg = messages[messages.length - 1];
    if (!lastMsg) return;

    var savedContent = lastMsg.content || '';
    lastMsg.content = savedContent + '\n\n\u23F3 *Генерирую черновик ТКП...*';
    renderMessages();

    try {
      var auth = AsgardAuth?.getAuth?.();
      var token = auth?.token;
      var resp = await fetch('/api/mimir/suggest-tkp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          tender_id: action.tender_id || null,
          work_id: action.work_id || null,
          description: userMessage,
          mode: 'full'
        })
      });

      if (resp.ok) {
        var result = await resp.json();
        if (result.success) {
          lastMsg.content = savedContent +
            '\n\n\u2705 **' + result.tkp_number + '** создано!\n' +
            '\uD83D\uDCCB "' + result.subject + '"\n' +
            '\uD83D\uDCB0 ' + Number(result.total_sum).toLocaleString('ru-RU') + ' \u20BD (' + result.items_count + ' позиций)\n\n' +
            '[\uD83D\uDD17 Открыть для редактирования \u2192](#/tkp?edit=' + result.tkp_id + ')';
        } else {
          lastMsg.content = savedContent + '\n\n\u274C Не удалось создать ТКП: ' + (result.message || 'Ошибка');
        }
      } else {
        var errData = await resp.json().catch(function() { return {}; });
        lastMsg.content = savedContent + '\n\n\u274C Не удалось создать ТКП: ' + (errData.message || 'HTTP ' + resp.status);
      }
    } catch (e) {
      lastMsg.content = savedContent + '\n\n\u274C Ошибка создания ТКП: ' + e.message;
    }
    renderMessages();
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
    updateSendButton();

    isLoading = true;
    if (sendBtn) sendBtn.disabled = true;
    updateStatus('\u2728 печатает...');
    renderMessages();

    try {
      if (filesToSend.length > 0) {
        const response = await callMimirWithFiles(text, filesToSend);
        messages.push({
          role: 'assistant',
          content: response.text || response,
          results: response.results
        });
      } else if (useStreaming) {
        await callMimirStream(text);
      } else {
        const response = await callMimir(text);
        messages.push({
          role: 'assistant',
          content: response.text || response,
          results: response.results
        });
        if (response.action && response.action.type === 'CREATE_TKP') {
          renderMessages();
          await handleCreateTkpAction(response.action, text);
        }
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
    updateStatus('Хранитель Мудрости');
    renderMessages();
    showWisdom();
    loadConversations();
  }

  async function callMimirStream(text) {
    const lowerText = (text || '').toLowerCase();

    if (lowerText.match(/^(спасибо|спс|благодарю)$/)) {
      messages.push({ role: 'assistant', content: 'Рад был помочь, воин! Да прибудет мудрость Одина. \u2694\uFE0F' });
      return;
    }
    if (lowerText.match(/^(пока|бывай|до свидания)$/)) {
      messages.push({ role: 'assistant', content: 'До встречи, воин! Пусть путь будет ясен. \uD83D\uDEE1\uFE0F' });
      return;
    }
    if (lowerText.match(/^(привет|здравствуй|хай|салют)$/)) {
      messages.push({ role: 'assistant', content: 'Приветствую тебя, ' + userName + '! Чем могу помочь? \uD83E\uDDD9' });
      return;
    }

    let context = '';
    const hash = window.location.hash || '';
    if (hash.includes('tender')) context = 'Тендеры';
    else if (hash.includes('work') || hash.includes('pm-')) context = 'Работы';
    else if (hash.includes('financ') || hash.includes('buh') || hash.includes('invoice')) context = 'Финансы';
    else if (hash.includes('employee') || hash.includes('hr')) context = 'Персонал';

    const auth = AsgardAuth?.getAuth?.();
    const token = auth?.token;

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

    if (!response.ok) throw new Error('API error');

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
          } else if (event.type === 'action') {
            messages[messages.length - 1]._action = event.data;
          } else if (event.type === 'done') {
            messages[messages.length - 1].isStreaming = false;
          } else if (event.type === 'error') {
            messages[messages.length - 1].content = 'Ошибка: ' + event.message;
            messages[messages.length - 1].isStreaming = false;
          }
        } catch (e) { /* skip */ }
      }
    }

    messages[messages.length - 1].isStreaming = false;

    var streamAction = messages[messages.length - 1]._action;
    if (streamAction && streamAction.type === 'CREATE_TKP') {
      renderMessages();
      await handleCreateTkpAction(streamAction, text);
    }

    if (!fullText && messages.length > 0) {
      messages.pop();
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

    if (lowerText.match(/^(спасибо|спс|благодарю)$/)) {
      return { text: 'Рад был помочь, воин! Да прибудет мудрость Одина. \u2694\uFE0F' };
    }
    if (lowerText.match(/^(пока|бывай|до свидания)$/)) {
      return { text: 'До встречи, воин! Пусть путь будет ясен. \uD83D\uDEE1\uFE0F' };
    }
    if (lowerText.match(/^(привет|здравствуй|хай|салют)$/)) {
      return { text: 'Приветствую тебя, ' + userName + '! Чем могу помочь? \uD83E\uDDD9' };
    }

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
      results: data.results,
      action: data.action || null
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
    const html =
      '<div style="padding:14px">' +
        '<h3 style="color:#f5d78e;margin:0 0 14px;font-size:15px">\uD83D\uDCDD Генератор ТКП</h3>' +
        '<div style="margin-bottom:10px">' +
          '<label style="display:block;color:rgba(255,255,255,0.5);font-size:11px;margin-bottom:3px">Заказчик</label>' +
          '<input id="tkp_customer" style="width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(245,215,142,0.1);color:#fff;padding:8px;border-radius:8px;font-size:13px" placeholder="ООО Газпром"/>' +
        '</div>' +
        '<div style="margin-bottom:10px">' +
          '<label style="display:block;color:rgba(255,255,255,0.5);font-size:11px;margin-bottom:3px">Название работ</label>' +
          '<input id="tkp_title" style="width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(245,215,142,0.1);color:#fff;padding:8px;border-radius:8px;font-size:13px" placeholder="Техническое обслуживание..."/>' +
        '</div>' +
        '<div style="margin-bottom:10px">' +
          '<label style="display:block;color:rgba(255,255,255,0.5);font-size:11px;margin-bottom:3px">Перечень услуг</label>' +
          '<textarea id="tkp_services" style="width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(245,215,142,0.1);color:#fff;padding:8px;border-radius:8px;resize:vertical;font-size:13px" rows="3" placeholder="Диагностика, ремонт..."></textarea>' +
        '</div>' +
        '<div style="display:flex;gap:10px;margin-bottom:12px">' +
          '<div style="flex:1"><label style="display:block;color:rgba(255,255,255,0.5);font-size:11px;margin-bottom:3px">Сумма (руб)</label>' +
            '<input id="tkp_sum" type="number" style="width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(245,215,142,0.1);color:#fff;padding:8px;border-radius:8px;font-size:13px" placeholder="500000"/></div>' +
          '<div style="flex:1"><label style="display:block;color:rgba(255,255,255,0.5);font-size:11px;margin-bottom:3px">Срок</label>' +
            '<input id="tkp_deadline" style="width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(245,215,142,0.1);color:#fff;padding:8px;border-radius:8px;font-size:13px" placeholder="14 дней"/></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
          '<button id="tkp_cancel" style="padding:8px 16px;border-radius:8px;background:rgba(255,255,255,0.06);border:none;color:rgba(255,255,255,0.6);cursor:pointer;font-size:13px">Отмена</button>' +
          '<button id="tkp_generate" style="padding:8px 16px;border-radius:8px;background:linear-gradient(135deg,#c0392b,#2a3b66);border:none;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Сгенерировать</button>' +
        '</div>' +
      '</div>';

    const messagesEl = document.getElementById('mimirMessages');
    if (messagesEl) {
      messagesEl.innerHTML = html;

      document.getElementById('tkp_cancel')?.addEventListener('click', () => {
        renderMessages();
      });

      document.getElementById('tkp_generate')?.addEventListener('click', async () => {
        const btn = document.getElementById('tkp_generate');
        btn.disabled = true;
        btn.textContent = '\u23F3 Генерация...';

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
            messages.push({ role: 'user', content: '\uD83D\uDCDD Сгенерировать ТКП' });
            messages.push({ role: 'assistant', content: data.tkp });
            renderMessages();
          } else {
            toast?.('Ошибка', 'Не удалось сгенерировать ТКП', 'err');
            btn.disabled = false;
            btn.textContent = 'Сгенерировать';
          }
        } catch (e) {
          toast?.('Ошибка', e.message, 'err');
          btn.disabled = false;
          btn.textContent = 'Сгенерировать';
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
    } catch (e) { return null; }
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
    } catch (e) { return null; }
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
    } catch (e) { return null; }
  }

  function open() {
    if (isMobileDevice()) return;
    isOpen = true;
    isMinimized = false;
    const iphone = document.getElementById('mimirIphone');
    const fab = document.getElementById('mimirFab');
    iphone?.classList.add('open');
    fab?.classList.add('is-open');
    unreadDigestCount = 0;
    updateFabBadge();
    setTimeout(() => {
      document.getElementById('mimirInput')?.focus();
      const msgs = document.getElementById('mimirMessages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
      updateClock();
    }, 100);
  }

  function close() {
    isOpen = false;
    isSidebarOpen = false;
    const iphone = document.getElementById('mimirIphone');
    const fab = document.getElementById('mimirFab');
    const sidebar = document.getElementById('mimirSidebar');
    iphone?.classList.remove('open');
    fab?.classList.remove('is-open');
    sidebar?.classList.remove('open');
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

  // Auto-init
  document.addEventListener('DOMContentLoaded', function() { init(); });
  window.addEventListener('hashchange', function() { init(); });

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
