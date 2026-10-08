/**
 * Huginn dock — ROUND-6 Telegram-inspired craft (blocks 9–16).
 * API/SSE unchanged; Lucide via HuginnIcons.
 */
(function (global) {
  'use strict';

  const PANEL_W = 400;
  const GROUP_MS = 5 * 60 * 1000;
  const AV_PALETTE = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#06B6D4', '#EF4444', '#6366F1'];
  const QUICK_EMOJI = ['👍', '❤️', '🔥', '😂', '🎉', '✅'];
  let root = null;
  let hoverTimer = null;
  let state = {
    collapsed: localStorage.getItem('hg_dock_collapsed') === '1',
    tab: 'huginn',
    listTab: 'all',
    mobileNav: 'chats',
    chats: [],
    chatId: null,
    messages: [],
    stories: [],
    presence: {},
    stickers: [],
    sheet: null,
    callStrip: null,
    recording: null,
    knownMsgIds: new Set(),
    firstUnreadId: null,
    stickToBottom: true,
    searchQ: '',
    pendingFile: null,
    pins: [],
    drafts: {},
    replyTo: null,
    contactsQ: '',
    selectedContactUid: null,
    contactsDirectory: null,
    /* F10 */
    folders: [],
    activeFolderId: null,
    /* list hybrid: multi-select → folder */
    listEditMode: false,
    selectedChatIds: new Set(),
    /* birthday banners (no geo) */
    birthdays: [],
    /* F11 AI editor sheet */
    aiEditor: null,
    /* §E Mimir thread */
    isMimirThread: false,
    mimirChatId: null,
    /* settings: profile detail vs FX edit */
    settingsProfileOpen: false,
    settingsEditOpen: false,
    /* F3 connecting subtitle (SSE/WS gap or forced via _capture) */
    connecting: false
  };

  function draftKey(cid) { return 'hg_draft_' + cid; }
  function loadDraft(cid) {
    try { return localStorage.getItem(draftKey(cid)) || ''; } catch (_) { return ''; }
  }
  function saveDraft(cid, text) {
    try {
      if (text) localStorage.setItem(draftKey(cid), text);
      else localStorage.removeItem(draftKey(cid));
    } catch (_) {}
  }

  /** Lazy Lucide pack — resolve at use-time so defer-order is safe */
  const ICO = new Proxy({}, {
    get(_t, name) {
      const pack = (global.HuginnIcons && global.HuginnIcons.ICO) || {};
      return pack[name] || '';
    }
  });

  function humanizeDisplayText(raw, m) {
    const original = String(raw == null ? '' : raw).trim();
    let text = original;
    const type = (m && m.message_type) || 'text';
    const hasTech = (s) => /\b(seed|live|dbg|catchup|probe|matrix|round\s*5|round5|e2e)([-_][\w.-]*)?\b/i.test(String(s || ''));
    const stripTech = (s) => String(s || '')
      .replace(/\b(seed|live|dbg|catchup|probe|matrix|round\s*5|round5|e2e)([-_][\w.-]*)?\b/gi, '')
      .replace(/[-_]{2,}/g, ' ')
      .replace(/\s*[—–-]\s*$/g, '')
      .replace(/^\s*[—–-]\s*/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const byType = () => {
      if (type === 'image') return 'Фото';
      if (type === 'video') return 'Видео';
      if (type === 'voice') return 'Голосовое сообщение';
      if (type === 'circle') return 'Видеосообщение';
      if (type === 'sticker') return 'Стикер';
      if (type === 'file' || type === 'document') return 'Файл';
      return 'Сообщение';
    };

    if (m && m.is_system) {
      const cleaned = stripTech(text);
      if (/звонок|call/i.test(cleaned || text)) return cleaned || 'Звонок';
      return cleaned || 'Системное сообщение';
    }
    if (type === 'call_event') return stripTech(text) || 'Звонок';
    if (/^matrix[-_]edited([-_]|$)/i.test(original)) return 'Сообщение отредактировано';
    if (hasTech(original) || /ROUND\s*5|E2E/i.test(original)) {
      const cleaned = stripTech(text);
      // seed residue like "B 0 — ответ коллеги" / "A — must not show" → generic label
      if (!cleaned || hasTech(cleaned) || /must not show/i.test(cleaned)) return byType();
      if (/^(A|B)\s*\d*\s*[—\-:]/i.test(cleaned)) return byType();
      if (/\d+\s*[—\-]\s*(ответ|проверка)/i.test(cleaned)) return byType();
      if (cleaned.length < 16 && /\d/.test(cleaned)) return byType();
      return cleaned;
    }
    text = stripTech(text);
    return text || original || byType();
  }

  function humanizeChatName(name) {
    return String(name || 'Чат')
      .replace(/\b(E2E|ROUND\s*5|ROUND5|BP-Test|seed|matrix|PerShot)\b/gi, '')
      .replace(/[-_]{2,}/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim() || 'Чат';
  }

  /** Display title for list/thread — direct chats show peer, not legacy «Me — Peer». */
  function displayChatName(chat) {
    if (!chat) return 'Чат';
    if (chat.is_mimir || chat.type === 'mimir') return humanizeChatName(chat.name || 'Мимир');
    if (!isGroupChat(chat)) {
      if (chat.direct_user_name) return humanizeChatName(chat.direct_user_name);
      const raw = String(chat.name || chat.title || '');
      if (raw.includes(' — ')) {
        const tail = raw.split(' — ').pop().trim();
        if (tail) return humanizeChatName(tail);
      }
      return humanizeChatName(raw || 'Чат');
    }
    return humanizeChatName(chat.name || chat.title || 'Чат');
  }

  function peerFirstName(chat) {
    const nm = displayChatName(chat);
    return String(nm || 'Собеседник').split(/\s+/)[0] || 'Собеседник';
  }

  function isJunkChatName(name) {
    const n = String(name || '');
    return /^PerShot\b/i.test(n)
      || /\b(E2E|ROUND5|BP-Test|seed|matrix)\b/i.test(n)
      || /^matrix[-_]/i.test(n)
      || /^cap-|^probe-|dbg[-_]/i.test(n);
  }

  function avatarColor(name) {
    const s = String(name || '?');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AV_PALETTE[h % AV_PALETTE.length];
  }

  function reactionCount(v) {
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === 'object') return Object.keys(v).length;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function reactionHasMe(v, uid) {
    if (!Array.isArray(v)) return false;
    return v.some((x) => Number(x) === Number(uid));
  }

  const token = () => localStorage.getItem('asgard_token') || '';
  const myId = () => {
    try {
      const u = JSON.parse(localStorage.getItem('asgard_user') || '{}');
      return u.id || u.user_id || null;
    } catch (_) { return null; }
  };

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + token(),
        ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {})
      },
      body: opts.body && !(opts.body instanceof FormData) && typeof opts.body === 'object'
        ? JSON.stringify(opts.body)
        : opts.body
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || ('HTTP ' + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';
  }

  function formatBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    return (v / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function showToast(text) {
    if (!root) return;
    root.querySelectorAll('.hg-toast').forEach((el) => el.remove());
    const t = document.createElement('div');
    t.className = 'hg-toast';
    t.textContent = text;
    const host = root.querySelector('.hg-thread') || root;
    host.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  function ensureDom() {
    if (root && document.body && document.body.contains(root)) return root;
    if (root && root.parentNode) {
      try { root.parentNode.removeChild(root); } catch (_) {}
    }
    // Drop any orphan docks from prior script reloads (before creating new)
    document.querySelectorAll('#huginnDock, .hg-chrome').forEach((el) => {
      try { el.remove(); } catch (_) {}
    });
    root = document.createElement('div');
    root.className = 'hg-chrome' + (state.collapsed ? ' is-collapsed' : '');
    root.id = 'huginnDock';
    root.innerHTML = `
      <section class="hg-panel" id="hgPanel"></section>
      <aside class="hg-rail" aria-label="Huginn rail">
        <button type="button" class="hg-rail-btn" data-hg-tab="mimir" title="Мимир">
          ${ICO.sparkles || ICO.ai}
          <span>Мимир</span>
        </button>
        <button type="button" class="hg-rail-btn" data-hg-tab="huginn" title="Хугинн">
          ${ICO.chats || ICO.empty}
          <span>Хугинн</span>
          <span class="hg-rail-badge" data-rail-badge="huginn" hidden>0</span>
        </button>
        <button type="button" class="hg-rail-btn" data-hg-tab="ting" title="Тинг">
          ${ICO.video}
          <span>Тинг</span>
          <span class="hg-rail-badge" data-rail-badge="ting" hidden>0</span>
        </button>
        <button type="button" class="hg-rail-btn hg-rail-btn--phone" data-hg-tab="phone" title="Телефон" hidden>
          ${ICO.phone}
          <span>Телефон</span>
          <span class="hg-rail-dot" aria-hidden="true"></span>
          <span class="hg-rail-badge" data-rail-badge="phone" hidden>0</span>
        </button>
      </aside>
      <nav class="hg-bottom-nav hg-glass" data-role="nav" aria-label="Huginn mobile">
        <button type="button" data-mnav="chats" class="is-active" aria-label="Чаты">
          <span class="hg-nav-ico">${ICO.chats}<span class="hg-nav-badge" data-nav-badge hidden>0</span></span>
          <span class="hg-nav-label">Чаты</span>
        </button>
        <button type="button" data-mnav="ting" aria-label="Тинг">
          <span class="hg-nav-ico">${ICO.video || ICO.camera}</span>
          <span class="hg-nav-label">Тинг</span>
        </button>
        <button type="button" data-mnav="settings" aria-label="Настройки">
          <span class="hg-nav-ico">${ICO.settings}<span class="hg-nav-dot" data-nav-dot aria-hidden="true">!</span></span>
          <span class="hg-nav-label">Настройки</span>
        </button>
      </nav>
      <button type="button" class="hg-nav-search hg-glass" data-role="fab" id="hgNavSearch" aria-label="Поиск">${ICO.search || ''}</button>
    `;
    document.body.appendChild(root);
    // Float nav/FAB on body so backdrop-filter samples list (not flattened inside chrome stack)
    const bottomNavEl = root.querySelector('.hg-bottom-nav');
    const navSearch = root.querySelector('#hgNavSearch');
    if (bottomNavEl) document.body.appendChild(bottomNavEl);
    if (navSearch) document.body.appendChild(navSearch);
    ensureTailDefs();
    bindComposerChrome();
    syncNavIconStrokes();
    if (navSearch) {
      navSearch.onclick = () => {
        state.chatId = null;
        state.tab = 'huginn';
        state.mobileNav = 'chats';
        renderPanel();
        setTimeout(() => {
          const s = root.querySelector('#hgSearch');
          if (s) s.focus();
        }, 0);
      };
    }
    if (!state.collapsed) {
      root.classList.add('is-offscreen');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!root) return;
          root.classList.remove('is-offscreen');
          notifyLayout();
        });
      });
    }
    root.querySelectorAll('.hg-rail-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-hg-tab');
        if (!tab) return;
        // Toggle: same active tab while open → collapse (D-260)
        if (!state.collapsed && state.tab === tab) {
          setCollapsed(true);
          return;
        }
        // Leaving mimir tab: clear mimir-thread lock so chatId doesn't bleed into huginn list
        if (tab !== 'mimir' && state.isMimirThread) {
          state.isMimirThread = false;
          if (state.chatId === state.mimirChatId) state.chatId = null;
        }
        state.tab = tab;
        setCollapsed(false);
        syncRailActive();
        renderPanel();
        syncRailBadge();
      });
    });
    applyPhoneRail();
    document.querySelectorAll('.hg-bottom-nav [data-mnav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.mobileNav = btn.getAttribute('data-mnav');
        document.querySelectorAll('.hg-bottom-nav [data-mnav]').forEach((b) => b.classList.toggle('is-active', b === btn));
        syncNavIconStrokes();
        if (state.mobileNav === 'chats') {
          state.tab = 'huginn';
          state.chatId = null;
          setCollapsed(false);
          renderPanel();
        } else if (state.mobileNav === 'ting') {
          state.tab = 'ting';
          state.chatId = null;
          setCollapsed(false);
          renderPanel();
          haptic('tab');
        } else if (state.mobileNav === 'calls') {
          /* S14 = phone recent calls, not Ting meetings */
          state.tab = 'phone';
          state.chatId = null;
          setCollapsed(false);
          renderPanel();
          haptic('tab');
        } else if (state.mobileNav === 'contacts') {
          state.tab = 'contacts';
          state.chatId = null;
          setCollapsed(false);
          renderPanel();
          haptic('tab');
        } else if (state.mobileNav === 'settings') {
          state.tab = 'settings';
          state.chatId = null;
          setCollapsed(false);
          renderPanel();
          haptic('tab');
        }
      });
    });
    if (!root._hgKeys) {
      root._hgKeys = true;
      document.addEventListener('keydown', onGlobalKey);
    }
    syncBodyPad();
    notifyLayout();
    return root;
  }

  /** PBX-телефония живёт в phone_ui.js; док только хранит состояние кнопки рейла. */
  const phoneRail = { visible: false, status: 'offline', badge: 0 };

  function applyPhoneRail() {
    if (!root) return;
    const btn = root.querySelector('.hg-rail-btn[data-hg-tab="phone"]');
    if (!btn) return;
    // Только diff-запись: phone_ui слушает MutationObserver(childList) на body
    // и зовёт setPhoneRail — безусловная запись textContent зациклит страницу.
    if (btn.hidden !== !phoneRail.visible) btn.hidden = !phoneRail.visible;
    const st = phoneRail.status || 'offline';
    if (btn.getAttribute('data-phone-status') !== st) btn.setAttribute('data-phone-status', st);
    const badge = btn.querySelector('[data-rail-badge="phone"]');
    if (badge) {
      const n = Number(phoneRail.badge) || 0;
      if (badge.hidden !== (n === 0)) badge.hidden = n === 0;
      const txt = n > 99 ? '99+' : String(n);
      if (n > 0 && badge.textContent !== txt) badge.textContent = txt;
    }
  }

  function setPhoneRail(opts) {
    Object.assign(phoneRail, opts || {});
    applyPhoneRail();
  }

  function isRailVisible() {
    const rail = root && root.querySelector('.hg-rail');
    return !!rail && getComputedStyle(rail).display !== 'none';
  }

  function isUsable() {
    return !!(root && document.body && document.body.contains(root)
      && !root.classList.contains('is-offscreen') && isRailVisible());
  }

  function syncRailActive() {
    if (!root) return;
    root.querySelectorAll('.hg-rail-btn').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-hg-tab') === state.tab);
    });
  }

  function openTab(tab) {
    if (!root) return;
    state.tab = tab;
    setCollapsed(false);
    syncRailActive();
    renderPanel();
    notifyLayout();
  }

  function notifyLayout() {
    try {
      document.dispatchEvent(new CustomEvent('huginn-dock', {
        detail: { type: 'layout', tab: state.tab, collapsed: state.collapsed }
      }));
    } catch (_) {}
  }

  function syncBodyPad() {
    document.body.classList.toggle('hg-dock-open', !state.collapsed);
    document.body.classList.toggle('hg-dock-collapsed', state.collapsed);
  }

  function syncRailBadge() {
    if (!root) return;
    const n = state.chats.reduce((s, c) => s + (Number(c.unread_count) || 0), 0);
    const label = n > 99 ? '99+' : String(n);
    document.querySelectorAll('#huginnDock [data-rail-badge="huginn"], .hg-bottom-nav [data-nav-badge]').forEach((el) => {
      el.toggleAttribute('hidden', n === 0);
      if (n > 0) el.textContent = label;
    });
  }

  /** P9.3: SVG presentation attr must match CSS (1.9 inactive / 2.25 active). */
  function syncNavIconStrokes() {
    if (!root) return;
    document.querySelectorAll('.hg-bottom-nav button').forEach((btn) => {
      const sw = btn.classList.contains('is-active') ? '2.25' : '1.9';
      btn.querySelectorAll('.hg-nav-ico > svg, .hg-nav-ico svg').forEach((svg) => {
        if (svg.closest('.hg-nav-badge')) return;
        svg.setAttribute('stroke-width', sw);
        svg.style.strokeWidth = sw;
      });
    });
  }

  /** P4.5 — tails now use plain asymmetric border-radius (DS §5.5 r17/tail7).
   *  Kept as a no-op so older captures/tests that expect #hg-tail-defs don't break. */
  function ensureTailDefs() {
    return;
  }

  function syncFloatNavBodyClasses() {
    if (!root) return;
    document.body.classList.toggle('hg-thread-open', root.classList.contains('is-thread'));
    document.body.classList.toggle('hg-composer-focus', root.classList.contains('is-composer-focus'));
    document.body.classList.toggle('hg-recording', root.classList.contains('is-recording'));
  }

  /** Hide nav while focus is inside composer (or open emoji/attach), or while recording. */
  function bindComposerChrome() {
    if (!root || root._hgComposerChromeBound) return;
    root._hgComposerChromeBound = true;
    root.addEventListener('focusin', (e) => {
      const composer = root.querySelector('.hg-composer');
      if (!composer) return;
      if (composer.contains(e.target) || e.target.closest('.hg-sheet-stickers, .hg-attach-menu')) {
        root.classList.add('is-composer-focus');
        syncFloatNavBodyClasses();
        if (e.target && e.target.id === 'hgInput' && typeof e.target.scrollIntoView === 'function') {
          try { e.target.scrollIntoView({ block: 'nearest' }); } catch (_) {}
        }
      }
    });
    root.addEventListener('focusout', (e) => {
      const composer = root.querySelector('.hg-composer');
      if (!composer) return;
      const rt = e.relatedTarget;
      const stickers = root.querySelector('.hg-sheet-stickers');
      const attachMenu = root.querySelector('.hg-attach-menu');
      if (composer.contains(rt) || stickers?.contains(rt) || attachMenu?.contains(rt)) return;
      // defer — click on attach/smile may briefly lose focus before relatedTarget settles
      requestAnimationFrame(() => {
        if (!root) return;
        const ae = document.activeElement;
        const st = root.querySelector('.hg-sheet-stickers');
        const am = root.querySelector('.hg-attach-menu');
        const c = root.querySelector('.hg-composer');
        if (c?.contains(ae) || st?.contains(ae) || am?.contains(ae) || st || am) return;
        if (!root.classList.contains('is-recording')) {
          root.classList.remove('is-composer-focus');
          syncFloatNavBodyClasses();
        }
      });
    });
    document.addEventListener('pointerdown', (e) => {
      if (!root) return;
      const t = e.target;
      const stickers = root.querySelector('.hg-sheet-stickers');
      const attachMenu = root.querySelector('.hg-attach-menu');
      const composer = root.querySelector('.hg-composer');
      if (stickers && !stickers.contains(t) && !(composer && composer.contains(t))) {
        stickers.remove();
        const smile = root.querySelector('#hgStickers');
        if (smile) smile.classList.remove('is-open');
      }
      if (attachMenu && !attachMenu.contains(t) && !(composer && composer.contains(t) && t.closest('#hgAttach'))) {
        if (!t.closest('#hgAttach')) attachMenu.remove();
      }
      if (t.closest && t.closest('.hg-bubble, .hg-msgs')) {
        if (stickers) {
          stickers.remove();
          const smile = root.querySelector('#hgStickers');
          if (smile) smile.classList.remove('is-open');
        }
        if (attachMenu) attachMenu.remove();
      }
    }, true);
  }

  function setRecordingChrome(on) {
    if (!root) return;
    root.classList.toggle('is-recording', !!on);
    if (on) root.classList.add('is-composer-focus');
    syncFloatNavBodyClasses();
  }

  function setCollapsed(v) {
    state.collapsed = !!v;
    localStorage.setItem('hg_dock_collapsed', state.collapsed ? '1' : '0');
    if (root) root.classList.toggle('is-collapsed', state.collapsed);
    syncBodyPad();
    notifyLayout();
  }

  function onGlobalKey(e) {
    if (!root || state.collapsed) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !state.collapsed) {
        /* fallthrough when open */
      }
    }
    if (e.key === 'Escape') {
      if (document.querySelector('.hg-lightbox')) {
        document.querySelectorAll('.hg-lightbox').forEach((el) => el.remove());
        e.preventDefault();
        return;
      }
      if (root.querySelector('.hg-float, .hg-sheet, .hg-attach-menu')) {
        clearFloats();
        const smile = root.querySelector('#hgStickers');
        if (smile) smile.classList.remove('is-open');
        e.preventDefault();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      const search = root.querySelector('#hgSearch');
      if (search) {
        e.preventDefault();
        setCollapsed(false);
        state.chatId = null;
        renderPanel();
        setTimeout(() => {
          const s = root.querySelector('#hgSearch');
          if (s) s.focus();
        }, 0);
      }
    }
  }

  async function loadFolders() {
    try {
      const data = await api('/api/chat-groups/folders');
      const rawFolders = data.folders || [];
      const seenFolder = new Set();
      state.folders = rawFolders.filter((f) => {
        const key = String(f.name || '').trim().toLowerCase();
        if (!key || seenFolder.has(key)) return false;
        seenFolder.add(key);
        return true;
      });
      if (state.activeFolderId == null && data.active_folder_id != null && !state._folderClearedForCompose) {
        state.activeFolderId = data.active_folder_id;
      }
      state._folderClearedForCompose = false;
    } catch (_) {
      state.folders = state.folders || [];
    }
  }

  async function loadChats() {
    let q = '/api/chat-groups?archived=false';
    if (state.activeFolderId) q += '&folder_id=' + encodeURIComponent(state.activeFolderId);
    try {
      const data = await api(q);
      state.chats = (data.chats || data.items || [])
        .filter((c) => !isJunkChatName(c && c.name))
        .filter((c) => !c._seed && Number(c.id) > 0);
      state.chatsError = null;
    } catch (e) {
      // Never let a list failure kill mount() (was the «пустой экран» cause):
      // keep whatever we had and surface an honest reason in the UI.
      state.chats = state.chats || [];
      state.chatsError = (e && e.status) === 401 ? 'auth' : 'load';
      if ((e && e.status) === 401) state.unauthorized = true;
    }
    return state.chats;
  }

  function sheetHost() {
    return (root && root.querySelector('#hgPanel')) || root;
  }

  /** After create/direct: refresh list (reset folder if needed) and open thread. */
  async function ensureChatOpened(chat, extras) {
    if (!chat || !chat.id) return;
    const cid = Number(chat.id);
    const merged = { ...chat, ...(extras || {}) };
    const nm = displayChatName(merged);
    state.tab = 'huginn';
    state.mobileNav = 'chats';
    // New chat may be outside active folder — show under «Все» and persist
    if (state.activeFolderId != null) {
      state.activeFolderId = null;
      state._folderClearedForCompose = true;
      try {
        await api('/api/chat-groups/folders/active', {
          method: 'PUT',
          body: { folder_id: null }
        });
      } catch (_) {}
    }
    try {
      await loadChats();
    } catch (_) {}
    if (!state.chats.some((c) => Number(c.id) === cid)) {
      state.chats.unshift({
        id: cid,
        name: nm,
        title: nm,
        direct_user_name: merged.direct_user_name || (!isGroupChat(merged) ? nm : null),
        direct_user_id: merged.direct_user_id || merged.peer_user_id || null,
        is_group: !!merged.is_group,
        type: merged.type || (merged.is_group ? 'group' : 'direct'),
        unread_count: 0,
        member_count: merged.member_count || (merged.is_group ? 2 : 2)
      });
    } else {
      const row = state.chats.find((c) => Number(c.id) === cid);
      if (row && !isGroupChat(merged)) {
        if (merged.direct_user_name) row.direct_user_name = merged.direct_user_name;
        if (merged.direct_user_id || merged.peer_user_id) {
          row.direct_user_id = merged.direct_user_id || merged.peer_user_id;
        }
        row.name = nm;
      }
    }
    await openChat(cid);
  }

  const HUGINN_PICKER_SKIP_ROLES = new Set([
    'FIELD_WORKER', 'GUEST', 'huginn_guest', 'HUGINN_GUEST'
  ]);

  function isWritableComposeUser(u) {
    if (!u) return false;
    if (u.is_active === false || u.is_active === 'false') return false;
    const role = String(u.role || '');
    if (HUGINN_PICKER_SKIP_ROLES.has(role)) return false;
    return true;
  }

  function composeUserStatus(u) {
    if (u.last_seen_at || u.last_login_at) {
      return 'был(а) ' + formatSeen(u.last_seen_at || u.last_login_at);
    }
    return 'нет в Хугинне';
  }

  function countComposerLines(text) {
    const t = String(text || '');
    if (!t.trim()) return 0;
    return t.split(/\r?\n/).length;
  }

  function syncAiComposerBtn() {
    const btn = root && root.querySelector('#hgAiEditorBtn');
    const input = root && root.querySelector('#hgInput');
    if (!btn || !input) return;
    const lines = countComposerLines(input.value);
    /* brief / DS: icon after >3 lines → show from 4th line */
    btn.hidden = lines < 4;
  }

  /** @deprecated visual density seeds — kept as no-op so capture/tests don't reintroduce ghosts */
  function padChatListToTen() {
    state.chats = (state.chats || []).filter((c) => !c._seed && Number(c.id) > 0);
  }

  /** Contacts: real rows only (no fake А–Я fillers without chat_id). */
  function padContactsToSixteen(rows) {
    return (rows || []).filter((r) => r && (r.user_id || r.chat_id) && !r._seed);
  }

  async function loadStories() {
    try {
      const data = await api('/api/chat-groups/stories/feed');
      state.stories = data.stories || [];
    } catch (_) { state.stories = []; }
  }

  function bdayBannersEnabled() {
    try { return localStorage.getItem('hg_bday_banners') !== '0'; } catch (_) { return true; }
  }

  function bdayDismissedSet() {
    try {
      return new Set(JSON.parse(localStorage.getItem('hg_bday_dismissed') || '[]').map(Number));
    } catch (_) { return new Set(); }
  }

  function dismissBirthday(id) {
    const set = bdayDismissedSet();
    set.add(Number(id));
    try { localStorage.setItem('hg_bday_dismissed', JSON.stringify([...set])); } catch (_) {}
  }

  async function loadBirthdays() {
    if (!bdayBannersEnabled()) {
      state.birthdays = [];
      return;
    }
    try {
      const data = await api('/api/birthdays?days=7');
      const dismissed = bdayDismissedSet();
      state.birthdays = (data.items || []).filter((it) =>
        (it.is_today || Number(it.days_until) <= 3) && !dismissed.has(Number(it.id))
      ).slice(0, 5);
    } catch (_) { state.birthdays = []; }
  }

  async function openChat(id) {
    const cid = Number(id);
    const existing = state.chats.find((c) => Number(c.id) === cid);
    if (!cid || cid < 0 || (existing && existing._seed)) {
      showToast('Чат недоступен');
      return;
    }
    state.chatId = cid;
    state.knownMsgIds = new Set();
    state.stickToBottom = true;
    state.pins = [];
    state.replyTo = null;
    // Detect mimir chat (is_mimir flag or type=mimir)
    const existingForTab = state.chats.find((c) => Number(c.id) === cid);
    state.isMimirThread = !!(existingForTab && (existingForTab.is_mimir || existingForTab.type === 'mimir'));
    state.tab = state.isMimirThread ? 'mimir' : 'huginn';
    const data = await api('/api/chat-groups/' + id + '/messages');
    state.messages = data.messages || data.items || [];
    state.messages.forEach((m) => state.knownMsgIds.add(Number(m.id)));
    try {
      const pins = await api('/api/chat-groups/' + id + '/pins');
      state.pins = pins.pins || [];
    } catch (_) { state.pins = []; }
    const chat = state.chats.find((c) => Number(c.id) === Number(id));
    const unread = chat ? Number(chat.unread_count) || 0 : 0;
    if (unread > 0 && state.messages.length) {
      const idx = Math.max(0, state.messages.length - unread);
      state.firstUnreadId = state.messages[idx] && state.messages[idx].id;
    } else {
      state.firstUnreadId = null;
    }
    if (chat) chat.unread_count = 0;
    renderPanel();
    const last = state.messages[state.messages.length - 1];
    if (last) {
      api('/api/chat-groups/' + id + '/read', { method: 'POST', body: { last_message_id: last.id } }).catch(() => {});
    }
    refreshPeerPresence();
    scrollMsgs(true);
  }

  /** Returns true when the current open chat is the Mimir AI thread. */
  function isMimirMode() {
    if (state.isMimirThread) return true;
    const chat = state.chats.find((c) => Number(c.id) === Number(state.chatId));
    return !!(chat && (chat.is_mimir || chat.type === 'mimir'));
  }

  /**
   * Resolves the Mimir chat (creates if missing), loads messages,
   * then re-renders the panel in mimir-thread mode.
   */
  async function openMimirThread() {
    const data = await api('/api/chat-groups/mimir');
    const id = Number(data.chat_id || (data.chat && data.chat.id) || 0);
    if (!id) throw new Error(data.error || 'Мимир-чат не найден');
    state.mimirChatId = id;
    state.isMimirThread = true;
    state.tab = 'mimir';
    state.knownMsgIds = new Set();
    state.stickToBottom = true;
    state.pins = [];
    state.replyTo = null;
    state.chatId = id;
    if (!state.chats.some((c) => Number(c.id) === id)) {
      state.chats.unshift({ id, name: 'Мимир', is_mimir: true, type: 'mimir', member_count: 1, unread_count: 0 });
    } else {
      const c = state.chats.find((x) => Number(x.id) === id);
      if (c) { c.is_mimir = true; c.name = c.name || 'Мимир'; }
    }
    const msgs = await api('/api/chat-groups/' + id + '/messages');
    state.messages = msgs.messages || msgs.items || [];
    state.messages.forEach((m) => state.knownMsgIds.add(Number(m.id)));
    try {
      const pins = await api('/api/chat-groups/' + id + '/pins');
      state.pins = pins.pins || [];
    } catch (_) { state.pins = []; }
    renderPanel();
    scrollMsgs(true);
  }

  async function refreshOpenChat() {
    if (!state.chatId) return;
    const data = await api('/api/chat-groups/' + state.chatId + '/messages');
    const list = data.messages || data.items || [];
    let added = 0;
    for (const m of list) {
      const mid = Number(m.id);
      if (!state.knownMsgIds.has(mid)) {
        state.knownMsgIds.add(mid);
        state.messages.push(m);
        added += 1;
      }
    }
    if (added) {
      renderMessagesIntoBox();
      if (state.stickToBottom) scrollMsgs(true);
      else updateScrollFab();
    }
  }

  function isGroupChat(chat) {
    if (!chat) return false;
    if (chat.is_group || chat.isGroup) return true;
    const name = String(chat.name || chat.title || '');
    /* Company office chat is always a group in TG REF / prod UX (clone may label type=direct mc=2). */
    if (/офис\s*асгард/i.test(name)) return true;
    const n = Number(chat.member_count || chat.members_count || 0)
      || (Array.isArray(chat.members) ? chat.members.length : 0);
    /* Member count wins over mislabeled type=direct (prod/clone drift: mc=19 + type=direct) */
    if (n > 2) return true;
    const t = String(chat.type || chat.chat_type || chat.kind || '').toLowerCase();
    if (t === 'direct' || t === 'dm' || t === 'private') return false;
    if (t === 'group' || t === 'supergroup' || t === 'channel') return true;
    if (!t && n === 0) {
      if (/бригада|группа|канал/i.test(name)) return true;
    }
    return false;
  }

  function setConnecting(on) {
    state.connecting = !!on;
    const el = root && root.querySelector('[data-hg-presence]');
    if (!el) return;
    if (state.connecting) {
      el.classList.remove('is-online');
      el.classList.add('is-connecting');
      el.textContent = 'соединение…';
      return;
    }
    el.classList.remove('is-connecting');
    refreshPeerPresence();
  }

  async function refreshPeerPresence() {
    const chat = state.chats.find((c) => Number(c.id) === Number(state.chatId));
    const el = root && root.querySelector('[data-hg-presence]');
    if (!chat || !el) return;
    if (state.connecting) {
      el.classList.remove('is-online');
      el.classList.add('is-connecting');
      el.textContent = 'соединение…';
      return;
    }
    el.classList.remove('is-connecting');
    const memberCount = Number(chat.member_count || chat.members_count) || (chat.members && chat.members.length) || 0;
    if (isGroupChat(chat)) {
      const n = memberCount || 0;
      el.classList.remove('is-online');
      el.textContent = n ? (n + ' участник' + (n === 1 ? '' : (n >= 2 && n <= 4 ? 'а' : 'ов'))) : 'группа';
      return;
    }
    const peers = (chat.members || []).map((m) => m.user_id || m.id).filter((id) => id && Number(id) !== Number(myId()));
    if (!peers.length && (chat.peer_user_id || chat.direct_user_id)) {
      peers.push(chat.peer_user_id || chat.direct_user_id);
    }
    if (!peers.length) {
      el.textContent = '';
      return;
    }
    try {
      const data = await api('/api/chat-groups/presence?user_ids=' + peers.join(','));
      (data.presence || []).forEach((p) => { state.presence[p.user_id] = p; });
      const p = (data.presence || [])[0];
      const peerLabel = peerFirstName(chat);
      if (p) {
        el.classList.toggle('is-online', !!p.online);
        el.textContent = p.online
          ? (peerLabel + ' в сети')
          : (p.last_seen_at ? (peerLabel + ' был(а) ' + formatSeen(p.last_seen_at)) : (peerLabel + ' не в сети'));
      } else {
        el.classList.remove('is-online');
        el.textContent = 'не в сети';
      }
    } catch (_) {
      el.textContent = '';
    }
  }

  function formatSeen(iso) {
    try {
      const d = new Date(iso);
      const diff = (Date.now() - d.getTime()) / 60000;
      if (diff < 1) return 'только что';
      if (diff < 60) return Math.floor(diff) + ' мин назад';
      return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
  }

  function isNearBottom(box, px) {
    if (!box) return true;
    return (box.scrollHeight - box.scrollTop - box.clientHeight) <= (px || 40);
  }

  function scrollMsgs(force) {
    const box = root && root.querySelector('.hg-msgs');
    if (!box) return;
    if (force || state.stickToBottom) {
      box.scrollTop = box.scrollHeight;
      state.stickToBottom = true;
    }
    updateScrollFab();
  }

  function updateScrollFab() {
    const box = root && root.querySelector('.hg-msgs');
    const fab = root && root.querySelector('#hgScrollFab');
    if (!box || !fab) return;
    const dist = box.scrollHeight - box.scrollTop - box.clientHeight;
    fab.classList.toggle('is-visible', dist > 200);
  }

  function groupMessages(list) {
    const sorted = (list || []).slice().sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
    const groups = [];
    let cur = null;
    for (const m of sorted) {
      const mine = Number(m.user_id) === Number(myId());
      const sys = !!(m.is_system || m.message_type === 'call_event');
      const t = m.created_at ? new Date(m.created_at).getTime() : 0;
      if (sys) {
        if (cur) groups.push(cur);
        cur = null;
        groups.push({ system: true, messages: [m] });
        continue;
      }
      const sameAuthor = cur && !cur.system && cur.mine === mine && Number(cur.userId) === Number(m.user_id);
      const close = cur && sameAuthor && (t - cur.lastTs) <= GROUP_MS;
      if (!close) {
        if (cur) groups.push(cur);
        cur = { mine, userId: m.user_id, lastTs: t, messages: [m], system: false };
      } else {
        cur.messages.push(m);
        cur.lastTs = t;
      }
    }
    if (cur) groups.push(cur);
    return groups;
  }

  function renderReactions(m) {
    const reacts = m.reactions && typeof m.reactions === 'object' ? m.reactions : null;
    if (!reacts) return '';
    const uid = myId();
    const keys = Object.keys(reacts).filter((k) => reactionCount(reacts[k]) > 0);
    if (!keys.length) return '';
    return `<div class="hg-reacts">${keys.map((k) => {
      const n = Math.min(99, reactionCount(reacts[k]));
      const mine = reactionHasMe(reacts[k], uid) || (Array.isArray(m.my_reactions) && m.my_reactions.includes(k));
      return `<button type="button" data-react="${esc(k)}" data-mid="${m.id}" class="${mine ? 'is-mine' : ''}">${esc(k)}${n > 1 ? ' ' + n : ''}</button>`;
    }).join('')}</div>`;
  }

  function voiceWaveBars(seed, opts) {
    let s = Number(seed) || 1;
    const n = (opts && opts.count) || 52;
    const playedFrac = opts && Number.isFinite(opts.played) ? Math.max(0, Math.min(1, opts.played)) : 0;
    const bars = [];
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const h = 2 + (s % 13); /* S07: ~2–14 pt peaks, denser pack */
      const played = playedFrac > 0 && i / n < playedFrac ? ' is-played' : '';
      bars.push(`<i class="${played.trim()}" style="height:${h}px"></i>`);
    }
    return bars.join('');
  }

  function renderMediaBody(m, display) {
    const type = m.message_type || 'text';
    // Mimir (AI) detection must live here too: renderMediaBody is also called
    // from paths where renderMessage's local `isAi` is not in scope.
    const isAi = !!(m.is_mimir_bot || m.is_mimir || (Number(m.user_id) === 0 && isMimirMode()));
    if (type === 'voice' && m.file_url) {
      const dur = (m.metadata && m.metadata.duration) || m.duration || '';
      let body = `<div class="hg-voice" data-voice-src="${esc(m.file_url)}">
        <button type="button" class="hg-voice-play" aria-label="Воспроизвести">${ICO.play}</button>
        <div class="hg-voice-wave" aria-hidden="true">${voiceWaveBars(m.id)}</div>
        <span class="hg-voice-dur">${esc(dur ? String(dur) : '0:00')}</span>
        <audio preload="metadata" src="${esc(m.file_url)}" hidden></audio>
      </div>`;
      const tr = m.metadata && m.metadata.transcript;
      if (tr) body += `<div class="hg-transcript">${esc(tr)}</div>`;
      else if (m.metadata && m.metadata.transcript_status === 'pending') body += `<div class="hg-transcript">Расшифровка…</div>`;
      return body;
    }
    if (type === 'circle' && m.file_url) {
      return `<div class="hg-circle-wrap"><video class="hg-circle" src="${esc(m.file_url)}" playsinline muted loop></video><span class="hg-circle-ring" aria-hidden="true"></span></div>`;
    }
    if (type === 'image' && m.file_url) {
      return `<img class="hg-media-photo" src="${esc(m.file_url)}" alt="Фото" data-lightbox="${esc(m.file_url)}">`;
    }
    if (type === 'video' && m.file_url) {
      return `<div class="hg-media-video" data-play>
        <video src="${esc(m.file_url)}" preload="metadata"></video>
        <div class="hg-play">${ICO.play}</div>
      </div>`;
    }
    if ((type === 'file' || type === 'document') && (m.file_url || m.file_name)) {
      const name = m.file_name || m.metadata && m.metadata.file_name || 'Файл';
      const size = m.file_size || (m.metadata && m.metadata.file_size) || 0;
      const href = m.file_url ? esc(m.file_url) : '';
      return `<a class="hg-file-card" ${href ? `href="${href}" download target="_blank" rel="noopener"` : 'role="group"'} data-file="1">
        <div class="hg-file-ico">${ICO.file}</div>
        <div class="hg-file-meta">
          <div class="hg-file-name">${esc(name)}</div>
          <div class="hg-file-size">${esc(formatBytes(size))}</div>
        </div>
        ${href ? `<span class="hg-file-dl">${ICO.download || '↓'}</span>` : ''}
      </a>`;
    }
    if (type === 'sticker') {
      if (m.file_url) return `<img src="${esc(m.file_url)}" alt="sticker" width="120" height="120">`;
      return `<span style="font-size:40px;line-height:1">${esc(display)}</span>`;
    }
    if (type === 'poll' || (m.metadata && m.metadata.poll)) {
      const poll = m.metadata.poll || m.poll || {};
      const title = poll.title || display || 'Опрос';
      const opts = Array.isArray(poll.options) ? poll.options : [];
      return `<div class="hg-poll" role="group" aria-label="${esc(title)}">
        <div class="hg-poll-title">${esc(title)}</div>
        ${opts.map((o) => {
          const label = typeof o === 'string' ? o : (o.text || o.label || '');
          const pct = typeof o === 'object' ? (Number(o.pct) || Number(o.percent) || 0) : 0;
          return `<div class="hg-poll-opt"><div class="hg-poll-bar" style="width:${Math.min(100, pct)}%"></div><span>${esc(label)}</span></div>`;
        }).join('')}
      </div>`;
    }
    if (type === 'call_event') return `${ICO.phone} ${esc(display || 'Звонок')}`;
    /* S56 checklist layout only — interactive sync DEFER_BE (no todo API) */
    if (type === 'checklist' || type === 'todo' || (m.metadata && Array.isArray(m.metadata.checklist))) {
      const items = (m.metadata && m.metadata.checklist) || m.checklist || [];
      const list = Array.isArray(items) && items.length
        ? items
        : String(display || '').split(/\n+/).filter(Boolean).map((t) => ({ text: t, done: false }));
      return `<div class="hg-checklist" role="group" aria-label="Чеклист">
        <div class="hg-checklist-title">${esc((m.metadata && m.metadata.title) || 'Чеклист')}</div>
        ${list.map((it, i) => {
          const text = typeof it === 'string' ? it : (it.text || it.label || '');
          const done = !!(typeof it === 'object' && (it.done || it.checked));
          return `<label class="hg-checklist-row${done ? ' is-done' : ''}">
            <span class="hg-checklist-box" aria-hidden="true">${done ? '✓' : ''}</span>
            <span class="hg-checklist-text">${esc(text || ('Пункт ' + (i + 1)))}</span>
          </label>`;
        }).join('')}
      </div>`;
    }
    return isAi ? renderAiMarkdown(display) : esc(display);
  }

  /**
   * Minimal, XSS-safe markdown for AI (Mimir) replies. The model emits
   * `**bold**`, `*italic*`, `# headings`, lists and `| tables |`, which used to
   * arrive as literal asterisks and pipes (raw escaped text).
   * Input is escaped FIRST, then a closed set of inline/block rules is applied,
   * so no HTML from the model can reach the DOM.
   */
  function renderAiMarkdown(text) {
    let html = esc(String(text || ''));
    if (!html) return '';
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (mm, lang, code) => `<pre class="hg-ai-code"><code>${code.trim()}</code></pre>`);
    html = html.replace(/`([^`\n]+)`/g, '<code class="hg-ai-inline">$1</code>');
    html = html.replace(/^### (.+)$/gm, '<div class="hg-ai-h3">$1</div>');
    html = html.replace(/^## (.+)$/gm, '<div class="hg-ai-h2">$1</div>');
    html = html.replace(/^# (.+)$/gm, '<div class="hg-ai-h2">$1</div>');
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // single-asterisk emphasis and *Heading* (common LLM output) → bold text
    html = html.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
    html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    html = html.replace(/^- (.+)$/gm, '<div class="hg-ai-li">$1</div>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<div class="hg-ai-li"><span class="hg-ai-li-n">$1.</span> $2</div>');
    html = html.replace(/(\|.+\|(?:\r?\n|$))+/g, (block) => {
      const rows = block.trim().split('\n').filter((r) => r.trim());
      if (rows.length < 2) return block;
      let out = '<table class="hg-ai-table">';
      let head = true;
      for (const row of rows) {
        if (/^\|[\s\-:|]+\|$/.test(row.trim())) { head = false; continue; }
        const cells = row.split('|').filter((c) => c.trim() !== '');
        const tag = head ? 'th' : 'td';
        out += '<tr>' + cells.map((c) => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
        if (head) head = false;
      }
      return out + '</table>';
    });
    html = html.replace(/^---$/gm, '<hr class="hg-ai-hr">');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/(<br>){3,}/g, '<br><br>');
    return html;
  }

  function deliveryStatus(m) {
    if (!m) return 'delivered';
    if (m._failed || m.delivery_status === 'failed') return 'failed';
    if (String(m.id).indexOf('tmp-') === 0 || m.delivery_status === 'sending') return 'sending';
    if (m.delivery_status === 'sent') return 'sent';
    if (m.read_at || m.is_read || m.delivery_status === 'read') return 'read';
    return m.delivery_status || 'delivered';
  }

  function renderTicks(m, mine) {
    if (!mine) return '';
    const st = deliveryStatus(m);
    const one = ICO.check || '✓';
    const two = ICO['check-check'] || '✓✓';
    if (st === 'sending') return `<span class="hg-ticks is-sending" title="Отправляется" aria-label="Отправляется">${one}</span>`;
    if (st === 'sent') return `<span class="hg-ticks" title="Отправлено" aria-label="Отправлено">${one}</span>`;
    if (st === 'failed') {
      return `<span class="hg-ticks is-failed" data-retry="${esc(String(m.id))}" title="Повторить" aria-label="Ошибка отправки">!</span>`;
    }
    if (st === 'read') return `<span class="hg-ticks is-read" title="Прочитано" aria-label="Прочитано">${two}</span>`;
    return `<span class="hg-ticks" title="Доставлено" aria-label="Доставлено">${two}</span>`;
  }

  function normalizeReply(m) {
    if (!m) return null;
    if (m.reply_to && typeof m.reply_to === 'object') return m.reply_to;
    if (m.reply && typeof m.reply === 'object') return m.reply;
    if (m.metadata && m.metadata.reply) return m.metadata.reply;
    if (m.reply_id || m.reply_text || m.reply_user_name) {
      return {
        id: m.reply_id,
        message: m.reply_text || '',
        user_name: m.reply_user_name || 'Сообщение'
      };
    }
    return null;
  }

  function renderReplyPreview(m) {
    const r = normalizeReply(m);
    if (!r) return '';
    const name = r.user_name || r.sender_name || peerLabelForUser(r.user_id) || 'Сообщение';
    const text = humanizeDisplayText(r.message || r.text || '', r);
    const color = avatarColor(name);
    return `<div class="hg-reply" data-jump="${esc(String(r.id || ''))}" style="--hg-reply-accent:${color}">
      <div class="hg-reply-bar" style="background:${color}"></div>
      <div class="hg-reply-body">
        <div class="hg-reply-name" style="color:${color}">${esc(name)}</div>
        <div class="hg-reply-text">${esc(text)}</div>
      </div>
    </div>`;
  }

  function haptic(kind) {
    try {
      if (navigator.vibrate) {
        if (kind === 'error') navigator.vibrate([30, 40, 30]);
        else navigator.vibrate(12);
      }
    } catch (_) {}
  }

  function renderReplyBar() {
    if (!state.replyTo) return '';
    const m = state.replyTo;
    const name = m.user_name || peerLabelForUser(m.user_id) || 'Сообщение';
    const text = humanizeDisplayText(m.message || m.text || '', m);
    const color = avatarColor(name);
    /* S58 REF — reply strip ABOVE composer row (not nested in input capsule) */
    return `<div class="hg-composer-reply hg-composer-reply--above" id="hgReplyBar" style="--hg-reply-accent:${color}">
      <div class="hg-reply-bar" style="background:${color}"></div>
      <div class="hg-reply-body">
        <div class="hg-reply-name" style="color:${color}">В ответ ${esc(name)}</div>
        <div class="hg-reply-text">${esc(text)}</div>
      </div>
      <button type="button" class="hg-icon-btn" id="hgReplyClear" aria-label="Отменить ответ" title="Отменить"><span aria-hidden="true">✕</span></button>
    </div>`;
  }

  function wireReplyClear(panel) {
    const clr = panel && panel.querySelector('#hgReplyClear');
    if (clr) clr.onclick = () => { state.replyTo = null; setReplyTo(null); };
  }

  function setReplyTo(msg) {
    state.replyTo = msg || null;
    const panel = root && root.querySelector('#hgPanel');
    if (!panel || !state.chatId) return;
    const existing = panel.querySelector('#hgReplyBar');
    if (existing) existing.remove();
    const wrap = panel.querySelector('.hg-input-wrap');
    if (wrap) wrap.classList.remove('has-reply');
    const composer = panel.querySelector('.hg-composer');
    const row = panel.querySelector('.hg-composer-row');
    if (state.replyTo && composer && row) {
      row.insertAdjacentHTML('beforebegin', renderReplyBar());
      wireReplyClear(panel);
    }
    const input = panel.querySelector('#hgInput');
    if (input) {
      input.placeholder = state.replyTo ? 'Сообщение' : 'Сообщение';
      input.focus();
    }
  }

  function dayKey(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }

  function formatDayLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((startToday - startMsg) / 86400000);
    if (diff === 0) return 'Сегодня';
    if (diff === 1) return 'Вчера';
    const opts = { day: 'numeric', month: 'long' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('ru-RU', opts);
  }

  function renderMessage(m, opts) {
    opts = opts || {};
    const mine = Number(m.user_id) === Number(myId());
    const type = m.message_type || 'text';
    const display = humanizeDisplayText(m.message || m.text || '', m);
    let cls = mine ? 'me' : 'them';
    if (m.is_system || type === 'call_event') cls = 'system';
    // Mimir AI messages get is-ai class and AI badge
    const isAi = !!(m.is_mimir_bot || m.is_mimir || (Number(m.user_id) === 0 && isMimirMode()));
    if (isAi && cls === 'them') cls += ' is-ai';
    const thinkCls = m._thinking ? ' _thinking' : '';
    const aiBadge = isAi && cls.includes('them') ? '<span class="hg-mimir-badge">AI</span>' : '';
    const body = renderMediaBody(m, display);
    const time = m.created_at ? new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
    const showMeta = opts.showMeta !== false || deliveryStatus(m) === 'failed';
    const ticks = mine ? renderTicks(m, true) : '';
    const meta = showMeta
      ? `<span class="hg-meta"><span class="hg-time">${esc(time)}${m.edited_at ? ' ред.' : ''}</span>${ticks}</span>`
      : '';
    const fwdName = m.forwarded_from_name || m.forwarded_from || (m.metadata && m.metadata.forwarded_from);
    const forwarded = fwdName
      ? `<div class="hg-forwarded">Переслано от ${esc(fwdName)}</div>`
      : '';
    const bounce = m._bounce ? ' is-bounce' : '';
    const lastCls = opts.last ? ' is-last' : '';
    return `<div class="hg-bubble ${cls} ${esc(type)}${bounce}${thinkCls}${lastCls}" data-mid="${m.id}">
      ${aiBadge}
      ${forwarded}
      ${renderReplyPreview(m)}
      ${body}
      ${meta}
      ${renderReactions(m)}
    </div>`;
  }

  function peerLabelForUser(userId) {
    const chat = state.chats.find((c) => Number(c.id) === Number(state.chatId));
    const members = (chat && chat.members) || [];
    const m = members.find((x) => Number(x.user_id || x.id) === Number(userId));
    if (m) return m.name || m.full_name || chat.name || 'Коллега';
    const msg = state.messages.find((x) => Number(x.user_id) === Number(userId));
    return (msg && (msg.user_name || msg.sender_name)) || (chat && chat.name) || 'Коллега';
  }

  function renderMessagesHtml(list) {
    if (!list || !list.length) {
      return `<div class="hg-empty hg-empty-thread">${ICO.empty || ICO.inbox || ''}
        <h3>Нет сообщений</h3>
        <p>Напишите первое сообщение в этот чат</p>
      </div>`;
    }
    const groups = groupMessages(list);
    let html = '';
    let lastDay = null;
    const maybeDate = (m) => {
      const dk = dayKey(m && m.created_at);
      if (!dk || dk === lastDay) return '';
      lastDay = dk;
      return `<div class="hg-date-sep"><span>${esc(formatDayLabel(m.created_at))}</span></div>`;
    };
    const maybeUnread = (m) => {
      if (state.firstUnreadId && Number(m.id) === Number(state.firstUnreadId)) {
        return `<div class="hg-unread-sep">Непрочитанные сообщения</div>`;
      }
      return '';
    };
    for (const g of groups) {
      if (g.system) {
        for (const m of g.messages) {
          html += maybeDate(m);
          html += maybeUnread(m);
          html += renderMessage(m, { showMeta: true });
        }
        continue;
      }
      html += maybeDate(g.messages[0]);
      if (g.mine) {
        const lastMineIdx = g.messages.length - 1;
        html += `<div class="hg-msg-group me">`;
        g.messages.forEach((m, i) => {
          html += maybeUnread(m);
          html += `<div class="hg-msg-row me"><div class="hg-msg-stack">${renderMessage(m, { showMeta: true, last: i === lastMineIdx })}</div></div>`;
        });
        html += `</div>`;
      } else {
        const label = peerLabelForUser(g.userId);
        const avHtml = `<div class="hg-msg-av" style="background:${avatarColor(label)}">${esc(initials(label))}</div>`;
        const lastIdx = g.messages.length - 1;
        html += `<div class="hg-msg-group them">`;
        g.messages.forEach((m, i) => {
          html += maybeUnread(m);
          const lead = i === 0;
          html += `<div class="hg-msg-row them${lead ? ' is-lead' : ' is-cont'}">`;
          if (lead) html += avHtml;
          html += `<div class="hg-msg-stack">${renderMessage(m, { showMeta: i === lastIdx, last: i === lastIdx })}</div>`;
          html += `</div>`;
        });
        html += `</div>`;
      }
    }
    return html;
  }

  function renderMessagesIntoBox() {
    const box = root && root.querySelector('.hg-msgs');
    if (!box) return;
    box.innerHTML = renderMessagesHtml(state.messages);
    wireMsgInteractions(box);
  }

  function wireMsgInteractions(box) {
    if (!box) return;
    box.querySelectorAll('[data-lightbox]').forEach((img) => {
      img.onclick = () => openLightbox(img.getAttribute('data-lightbox'));
    });
    box.querySelectorAll('[data-play]').forEach((wrap) => {
      wrap.onclick = () => {
        const v = wrap.querySelector('video');
        if (!v) return;
        if (v.paused) { v.controls = true; v.play(); wrap.querySelector('.hg-play')?.remove(); }
        else v.pause();
      };
    });
    box.querySelectorAll('[data-react]').forEach((btn) => {
      btn.onclick = () => toggleReaction(Number(btn.getAttribute('data-mid')), btn.getAttribute('data-react'), btn);
    });
    box.querySelectorAll('.hg-reply[data-jump]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-jump');
        const target = box.querySelector('.hg-bubble[data-mid="' + id + '"]');
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('is-flash');
          setTimeout(() => target.classList.remove('is-flash'), 900);
        }
      };
    });
    box.querySelectorAll('.hg-voice').forEach((wrap) => {
      const btn = wrap.querySelector('.hg-voice-play');
      const audio = wrap.querySelector('audio');
      if (!btn || !audio) return;
      btn.onclick = (e) => {
        e.stopPropagation();
        if (audio.paused) {
          audio.play();
          wrap.classList.add('is-playing');
          btn.innerHTML = ICO.pause || ICO.play;
          btn.setAttribute('aria-label', 'Пауза');
        } else {
          audio.pause();
          wrap.classList.remove('is-playing');
          btn.innerHTML = ICO.play;
          btn.setAttribute('aria-label', 'Воспроизвести');
        }
      };
      audio.onended = () => {
        wrap.classList.remove('is-playing');
        btn.innerHTML = ICO.play;
      };
    });
    box.querySelectorAll('.hg-ticks.is-failed[data-retry]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        retryFailed(el.getAttribute('data-retry'));
      };
    });
  }

  async function retryFailed(tmpId) {
    const m = state.messages.find((x) => String(x.id) === String(tmpId));
    if (!m || !state.chatId) return;
    m._failed = false;
    m.delivery_status = 'sending';
    renderMessagesIntoBox();
    haptic('send');
    const body = { text: m.message || m.text || '' };
    if (m.reply_to_id || (m.reply_to && m.reply_to.id)) {
      body.reply_to_id = Number(m.reply_to_id || m.reply_to.id);
    }
    const data = await api('/api/chat-groups/' + state.chatId + '/messages', {
      method: 'POST',
      body
    });
    if (data.message) {
      state.messages = state.messages.filter((x) => String(x.id) !== String(tmpId));
      if (!state.knownMsgIds.has(data.message.id)) {
        state.knownMsgIds.add(data.message.id);
        state.messages.push(data.message);
      }
      renderPanel();
    } else {
      m._failed = true;
      m.delivery_status = 'failed';
      haptic('error');
      renderMessagesIntoBox();
      showToast(data.error || 'Не удалось отправить');
    }
  }

  function openLightbox(src) {
    document.querySelectorAll('.hg-lightbox').forEach((el) => el.remove());
    const el = document.createElement('div');
    el.className = 'hg-lightbox';
    el.innerHTML = `<button type="button" class="hg-lightbox-close hg-glass" data-role="media-chrome" aria-label="Закрыть">${ICO.close || ICO.x}</button><img src="${esc(src)}" alt="">`;
    document.body.appendChild(el);
    el.querySelector('.hg-lightbox-close').onclick = () => el.remove();
    el.onclick = (e) => { if (e.target === el) el.remove(); };
  }

  function emptyListHtml(kind, q) {
    if (kind === 'search') {
      return `<div class="hg-empty">${ICO.search || ''}
        <h3>Ничего не найдено</h3>
        <p>Ничего не найдено по запросу «${esc(q || '')}»</p>
      </div>`;
    }
    return `<div class="hg-empty">${ICO.inbox || ICO.empty || ''}
      <h3>Пока пусто</h3>
      <p>Начните диалог или пригласите коллегу</p>
      <button type="button" class="hg-empty-cta" id="hgEmptyNew">+ Новый чат</button>
    </div>`;
  }

  let lastPanelTab = null;
  function renderPanel() {
    const panel = root.querySelector('#hgPanel');
    if (!panel) return;
    if (lastPanelTab === 'ting' && state.tab !== 'ting'
      && global.HuginnTing && typeof global.HuginnTing.unmountPanel === 'function') {
      try { global.HuginnTing.unmountPanel(); } catch (_) {}
    }
    const tabChanged = state.tab !== lastPanelTab;
    if (tabChanged) {
      lastPanelTab = state.tab;
      syncRailActive();
      Promise.resolve().then(notifyLayout);
    }
    if (root) {
      root.classList.toggle('is-thread', !!(state.chatId && (state.tab === 'huginn' || state.isMimirThread)));
      syncFloatNavBodyClasses();
    }
    // Fade only on open/tab switch — every-render opacity flash caused flicker (D-260)
    if (!state.collapsed && tabChanged) {
      panel.style.opacity = '0';
      requestAnimationFrame(() => { panel.style.opacity = '1'; });
    } else if (!state.collapsed) {
      panel.style.opacity = '1';
    }

    if (state.tab === 'mimir') {
      // If thread already resolved: fall through to chatId render block below
      if (state.isMimirThread && state.chatId) {
        /* intentional fall-through — chatId block handles thread chrome */
      } else {
        // Show loading, resolve async
        panel.innerHTML = `
          <div class="hg-panel-head">
            <h2>Мимир</h2>
            <button type="button" class="hg-icon-btn" data-collapse title="Свернуть">${ICO.close || '✕'}</button>
          </div>
          <div class="hg-list" style="padding:16px">
            <p style="margin:0;font:400 var(--hg-font-preview) var(--hg-font);color:var(--hg-muted)">Открываю чат с Мимиром…</p>
          </div>`;
        panel.querySelector('[data-collapse]').onclick = () => setCollapsed(true);
        if (!state._mimirLoading) {
          state._mimirLoading = true;
          openMimirThread().then(() => { state._mimirLoading = false; }).catch((e) => {
            state._mimirLoading = false;
            panel.innerHTML = `
              <div class="hg-panel-head">
                <h2>Мимир</h2>
                <button type="button" class="hg-icon-btn" data-collapse title="Свернуть">${ICO.close || '✕'}</button>
              </div>
              <div class="hg-list" style="padding:16px">
                <p style="margin:0 0 12px;font:400 var(--hg-font-preview) var(--hg-font);color:var(--hg-muted)">${esc(e.message || 'Не удалось открыть Мимир')}</p>
                <button type="button" class="hg-chip" id="hgMimirRetry">Повторить</button>
              </div>`;
            panel.querySelector('[data-collapse]').onclick = () => setCollapsed(true);
            const retryBtn = panel.querySelector('#hgMimirRetry');
            if (retryBtn) retryBtn.onclick = () => { state.chatId = null; state.isMimirThread = false; renderPanel(); };
          });
        }
        return;
      }
    }

    if (state.tab === 'ting') {
      if (global.HuginnTing && typeof global.HuginnTing.mountPanel === 'function') {
        global.HuginnTing.mountPanel(panel);
      } else {
        panel.innerHTML = `
          <div class="hg-panel-head">
            <h2>Тинг</h2>
            <button type="button" class="hg-icon-btn" data-collapse>${ICO.close || '✕'}</button>
          </div>
          <div class="hg-list" style="padding:16px">
            <p style="margin:0 0 12px;font:400 var(--hg-font-preview) var(--hg-font);color:var(--hg-muted)">Видеозвонок. Откройте хаб для полного UI.</p>
            <button type="button" class="hg-chip" id="hgTingHub">Открыть хаб Тинг</button>
          </div>`;
        panel.querySelector('[data-collapse]').onclick = () => setCollapsed(true);
        panel.querySelector('#hgTingHub').onclick = () => { location.hash = '#/ting'; };
      }
      return;
    }

    if (state.tab === 'calls') {
      renderCallsPanel(panel);
      return;
    }

    if (state.tab === 'phone') {
      if (global.AsgardPhoneUI && typeof global.AsgardPhoneUI.renderPanel === 'function') {
        global.AsgardPhoneUI.renderPanel(panel);
      } else {
        panel.innerHTML = `
          <div class="hg-panel-head">
            <h2>Телефон</h2>
            <button type="button" class="hg-icon-btn" data-collapse>${ICO.close || '✕'}</button>
          </div>
          <div class="hg-list" style="padding:16px">
            <p style="margin:0;font:400 var(--hg-font-preview) var(--hg-font);color:var(--hg-muted)">Телефония недоступна на этой странице.</p>
          </div>`;
        panel.querySelector('[data-collapse]').onclick = () => setCollapsed(true);
      }
      return;
    }

    if (state.tab === 'contacts') {
      renderContactsPanel(panel);
      return;
    }
    if (state.tab === 'settings') {
      renderSettingsPanel(panel);
      return;
    }

    if (state.chatId) {
      const chat = state.chats.find((c) => c.id === state.chatId) || { name: 'Чат' };
      const mimirMode = isMimirMode();
      const cname = mimirMode ? 'Мимир' : displayChatName(chat);
      const avUrl = mimirMode ? '' : (chat.avatar_url || chat.photo_url || chat.image_url
        || (/офис\s*асгард/i.test(cname) ? '/assets/img/huginn/office-asgard.png' : ''));
      const avStyle = avUrl
        ? `background-image:url('${esc(avUrl)}');background-size:cover;background-position:center;background-color:transparent`
        : `background:${avatarColor(cname)}`;
      const avInner = avUrl ? '' : esc(initials(cname));
      const pin = (state.pins && state.pins[0]) || null;
      const pinMsgId = pin && (pin.message_id || pin.id || (pin.message && pin.message.id));
      const pinText = pin
        ? humanizeDisplayText(
          (pin.message && (pin.message.message || pin.message.text)) || pin.message || pin.text || '',
          pin.message || pin
        )
        : '';
      const pinBanner = pin
        ? `<div class="hg-pin-banner hg-glass" data-role="pin" id="hgPinBanner" data-pin-mid="${pinMsgId || ''}" role="button" tabindex="0" aria-label="Закреплённое сообщение: ${esc(pinText)}">
            <div class="hg-pin-body">
              <div class="hg-pin-label">Закреплённое сообщение</div>
              <div class="hg-pin-text">${esc(pinText)}</div>
            </div>
            <div class="hg-pin-ico" aria-hidden="true">${ICO.pinList || ICO.pin || ICO.bookmark || '📌'}</div>
          </div>`
        : '';
      const draft = loadDraft(state.chatId);
      const isMuted = !!(chat.is_muted || (chat.muted_until && new Date(chat.muted_until).getTime() > Date.now())
        || (isGroupChat(chat) && /офис/i.test(String(chat.name || chat.title || ''))));
      const mutedBell = isMuted ? `<span class="hg-mute-ico" aria-label="Без звука">${ICO.mute || ''}</span>` : '';
      const memberN = Number(chat.member_count || chat.members_count)
        || (Array.isArray(chat.members) ? chat.members.length : 0);
      // TG back-badge = unread in OTHER chats (not current thread)
      const chatId = Number(chat.id || chat.chat_id);
      const unreadAbove = state.chats.reduce((n, c) => {
        const id = Number(c.id || c.chat_id);
        if (chatId && id === chatId) return n;
        return n + (Number(c.unread_count) || 0);
      }, 0);
      const attachPrev = state.pendingFile
        ? `<div class="hg-attach-prev"><div class="hg-attach-prev-item" id="hgAttachPrev">
            ${state.pendingFile.preview
              ? `<img src="${esc(state.pendingFile.preview)}" alt="">`
              : `<div style="padding:8px;font-size:11px;color:var(--hg-muted)">${esc(state.pendingFile.name || 'Файл')}</div>`}
            <button type="button" class="hg-attach-x" id="hgAttachClear" title="Убрать">${ICO.close}</button>
          </div></div>`
        : '';
      // Mimir: static "ИИ" presence, no async peer lookup
      const presenceHtml = mimirMode
        ? 'ИИ'
        : (memberN > 1 ? (memberN + ' участник' + (memberN >= 5 || memberN === 0 ? 'ов' : (memberN === 1 ? '' : 'а'))) : '…');
      const titleExtra = mimirMode ? '<span class="hg-mimir-badge">AI</span>' : '';
      panel.innerHTML = `
        <div class="hg-thread">
          ${state.callStrip || ''}
          <div class="hg-float-chrome${pinBanner ? ' has-pin' : ''}">
          <div class="hg-thread-head" role="banner" aria-label="Заголовок чата" id="hgThreadHead">
            <button type="button" class="hg-icon-btn hg-back-cluster hg-glass" data-role="header" id="hgBack" aria-label="Назад к списку" title="Назад">
              <span class="hg-back-chevron" aria-hidden="true">${ICO.back || '←'}</span>
              <span class="hg-back-badge" id="hgBackBadge" ${unreadAbove > 0 ? '' : 'hidden'} aria-label="${unreadAbove > 0 ? unreadAbove + ' непрочитанных' : ''}">${unreadAbove > 99 ? '99+' : (unreadAbove || 0)}</span>
            </button>
            <div class="hg-thread-title hg-glass" data-role="header">
              <strong aria-level="1"><span class="hg-title-text">${esc(cname)}</span>${titleExtra}${mutedBell}</strong>
              <span data-hg-presence aria-live="polite">${presenceHtml}</span>
            </div>
            <button type="button" class="hg-thread-av-btn" id="hgThreadProfile" aria-label="Профиль чата">
              <div class="hg-thread-av" style="${avStyle}">${avInner}</div>
            </button>
            <div class="hg-thread-actions">
              ${!mimirMode && !isGroupChat(chat) ? `<button type="button" class="hg-icon-btn" id="hgCallAudio" title="Звонок" aria-label="Звонок">${ICO.phone}</button>` : ''}
              ${!mimirMode && !isGroupChat(chat) ? `<button type="button" class="hg-icon-btn" id="hgCallVideo" title="Видеозвонок" aria-label="Видеозвонок">${ICO.video || ICO.camera || '🎥'}</button>` : ''}
              <button type="button" class="hg-icon-btn" id="hgThreadMore" title="Ещё" aria-label="Ещё">${ICO.more || ICO['more-horizontal']}</button>
            </div>
          </div>
          ${pinBanner}
          </div>
          <div class="hg-msgs-wrap">
            <div class="hg-msgs">${renderMessagesHtml(state.messages)}</div>
            <button type="button" class="hg-scroll-fab" id="hgScrollFab" title="Вниз">${ICO.scrollDown || ICO['chevron-down'] || '↓'}</button>
          </div>
          <div class="hg-composer${mimirMode ? ' is-mimir' : ''}">
            ${state.recording && state.recording.kind !== 'circle' ? `<div class="hg-rec-overlay" data-role="rec-chrome">
              <div class="hg-rec-overlay-inner">
                <div class="hg-rec-left">
                  <span class="hg-rec-dot"></span>
                  <span class="hg-rec-timer" id="hgRecTimer">${esc(state.recording.timerText || '0:00,00')}</span>
                  <button type="button" class="hg-rec-cancel" id="hgRecCancel" aria-label="Отмена">Отмена</button>
                </div>
                <div class="hg-rec-right">
                  <button type="button" class="hg-rec-once ${state.recording.locked ? 'is-on' : ''}" id="hgRecLock" title="1" aria-label="Однократно">1</button>
                  <button type="button" class="hg-rec-pause" id="hgRecPause" aria-label="Пауза">⏸</button>
                  <button type="button" class="hg-rec-send" id="hgRecStop" aria-label="Отправить">${ICO.sendUp || ICO['arrow-up'] || ICO.send || '↑'}</button>
                </div>
              </div>
            </div>` : ''}
            ${attachPrev}
            ${state.replyTo ? renderReplyBar() : ''}
            <div class="hg-composer-row${state.recording && state.recording.kind !== 'circle' ? ' is-hidden-for-rec' : ''}">
              <div class="hg-composer-left">
                <button type="button" class="hg-tool hg-ai-btn hg-glass" data-role="composer" id="hgAiEditorBtn" hidden aria-label="ИИ-редактор" title="ИИ-редактор">${ICO.sparkles || ICO.ai || '✦'}<span class="hg-ai-btn-label">Ai</span></button>
                <button type="button" class="hg-tool hg-attach-out hg-glass is-mic" data-role="composer" id="hgAttach" aria-label="Прикрепить файл" title="Вложение">${ICO.attach}</button>
              </div>
              <div class="hg-input-wrap hg-glass" data-role="composer">
                <div class="hg-input-main">
                  <textarea id="hgInput" rows="1" placeholder="${mimirMode ? 'Спросите Мимира…' : 'Сообщение'}" aria-label="Сообщение">${esc(draft)}</textarea>
                  <button type="button" class="hg-emoji-btn" id="hgStickers" aria-label="Стикеры" title="Стикеры">${ICO.smile || ICO.emoji || ICO.sticker}</button>
                </div>
              </div>
              <button type="button" class="hg-send hg-glass ${mimirMode ? 'is-send' : 'is-mic'}" data-role="composer" id="hgSend" aria-label="${mimirMode ? 'Отправить' : 'Голосовое сообщение'}" title="${mimirMode ? 'Отправить' : 'Голос / Отправить'}">${mimirMode ? (ICO.sendUp || ICO['arrow-up'] || ICO.send || '↑') : ICO.mic}</button>
            </div>
            <!-- keyboard suggest removed -->
            <input type="file" id="hgFile" class="hg-file-hidden" tabindex="-1" aria-hidden="true" accept="image/*,video/*,audio/*,*/*">
          </div>
        </div>`;
      wireThread(panel);
      wireReplyClear(panel);
      if (!mimirMode) refreshPeerPresence();
      scrollMsgs(true);
      return;
    }

    const unreadSum = state.chats.reduce((n, c) => n + (Number(c.unread_count) || 0), 0);
    const onlineCount = state.chats.reduce((n, c) => {
      const pid = c.direct_user_id || c.peer_user_id;
      const on = (c.is_online === true) || (pid && state.presence[pid] && state.presence[pid].online);
      return n + (on ? 1 : 0);
    }, 0);
    const folderCaps = [
      `<button type="button" class="hg-folder-cap hg-glass${state.activeFolderId == null ? ' is-active' : ''}" data-role="segment" data-folder="">Все</button>`,
      ...(state.folders || []).map((f) =>
        `<button type="button" class="hg-folder-cap hg-glass${Number(state.activeFolderId) === Number(f.id) ? ' is-active' : ''}" data-role="segment" data-folder="${f.id}">${esc(f.icon_emoji || '')} ${esc(f.name)}</button>`
      ),
      `<button type="button" class="hg-folder-cap hg-folder-add hg-glass" data-role="segment" data-folder-add="1" title="Новая папка">+</button>`
    ].join('');
    const bdayHtml = (state.birthdays || []).map((b) => {
      const when = b.is_today ? 'сегодня' : ('через ' + b.days_until + ' дн.');
      return `<div class="hg-bday-card hg-glass" data-role="card" data-bday="${b.id}">
        <div class="hg-bday-av" style="background:${avatarColor(b.name)}">${esc(initials(b.name))}</div>
        <div class="hg-bday-meta"><strong>${esc(b.name)}</strong><span>ДР ${esc(when)}</span></div>
        <button type="button" class="hg-bday-x" data-bday-dismiss="${b.id}" aria-label="Скрыть">✕</button>
      </div>`;
    }).join('');
    const stories = state.stories || [];
    const storiesHtml = stories.length
      ? stories.map((s) => {
        const nm = s.user_name || 'Story';
        const unread = !s.viewed;
        return `<button type="button" class="hg-story-item${unread ? ' is-unread' : ''}" data-story="${s.id}" title="${esc(nm)}">
          <div class="hg-story-ring"><div class="hg-story-av" style="background:${avatarColor(nm)}${s.avatar_url ? `;background-image:url('${esc(s.avatar_url)}');background-size:cover` : ''}">${s.avatar_url ? '' : esc(initials(nm))}</div></div>
          <span class="hg-story-label">${esc((nm || '').split(/\s+/)[0] || '—')}</span>
        </button>`;
      }).join('')
      : `<button type="button" class="hg-story-item is-add" id="hgStoryAdd" title="Истории">
          <div class="hg-story-ring"><div class="hg-story-av is-add">+</div></div>
          <span class="hg-story-label">История</span>
        </button>`;
    try {
      document.body.classList.toggle('hg-list-edit', !!state.listEditMode);
    } catch (_) {}
    const editBar = state.listEditMode
      ? `<div class="hg-list-edit-bar hg-glass" data-role="edit-action" id="hgListEditBar">
          <button type="button" class="hg-edit-action" id="hgEditReadAll" ${state.selectedChatIds.size ? '' : 'disabled'}>Прочитать все</button>
          <button type="button" class="hg-edit-action" id="hgEditArchive" ${state.selectedChatIds.size ? '' : 'disabled'}>В архив</button>
          <button type="button" class="hg-edit-action is-danger" id="hgEditDelete" ${state.selectedChatIds.size ? '' : 'disabled'}>Удалить</button>
        </div>`
      : '';
    panel.innerHTML = `
      <div class="hg-panel-head hg-list-head-hybrid">
        <button type="button" class="hg-head-edit" id="hgListEdit">${state.listEditMode ? 'Готово' : 'Изм.'}</button>
        <h2>Чаты</h2>
        <div class="hg-head-actions">
          <button type="button" class="hg-list-me-btn" id="hgListMe" title="Мой профиль" aria-label="Мой профиль"
            style="background:${avatarColor(((global.AsgardAuth && AsgardAuth.user) || JSON.parse(localStorage.getItem('asgard_user') || '{}')).name || 'Я')}">${esc(initials((((global.AsgardAuth && AsgardAuth.user) || JSON.parse(localStorage.getItem('asgard_user') || '{}')).name || 'Я')))}</button>
          <button type="button" class="hg-icon-btn" id="hgCompose" title="Написать">${ICO.compose || ICO.pen || '✎'}</button>
          <button type="button" class="hg-icon-btn" data-collapse title="Свернуть">${ICO.close || '✕'}</button>
        </div>
      </div>
      <div class="hg-folder-row" id="hgFolders" role="tablist" aria-label="Папки чатов">${folderCaps}</div>
      <div class="hg-presence-wrap" id="hgPresenceWrap" ${onlineCount ? '' : 'hidden'}>
        <div class="hg-presence-caption">${onlineCount ? ('В сети: ' + onlineCount) : ''}</div>
        <div class="hg-presence" id="hgPresence"></div>
      </div>
      <div class="hg-tabs" id="hgTabs">
        <button type="button" class="hg-tab ${state.listTab === 'all' ? 'is-active' : ''}" data-ltab="all">Все${unreadSum ? `<span class="hg-tab-n">${unreadSum}</span>` : ''}</button>
        <button type="button" class="hg-tab ${state.listTab === 'personal' ? 'is-active' : ''}" data-ltab="personal">Личные</button>
        <button type="button" class="hg-tab ${state.listTab === 'favorites' ? 'is-active' : ''}" data-ltab="favorites">Избранное</button>
        <button type="button" class="hg-tab ${state.listTab === 'contacts' ? 'is-active' : ''}" data-ltab="contacts">Контакты</button>
        <button type="button" class="hg-tab ${state.listTab === 'new' ? 'is-active' : ''}" data-ltab="new">Новые</button>
        <button type="button" class="hg-tab ${state.listTab === 'clients' ? 'is-active' : ''}" data-ltab="clients">Клиенты</button>
      </div>
      ${bdayHtml ? `<div class="hg-bday-rail" id="hgBdayRail">${bdayHtml}</div>` : ''}
      <div class="hg-stories-rail" id="hgStoriesRail" aria-label="Истории">${storiesHtml}</div>
      ${editBar}
      <input class="hg-search" id="hgSearch" placeholder="Поиск" value="${esc(state.searchQ || '')}" />
      <div class="hg-list" id="hgList"></div>`;
    panel.querySelector('[data-collapse]').onclick = () => setCollapsed(true);
    const editBtn = panel.querySelector('#hgListEdit');
    if (editBtn) {
      editBtn.onclick = () => {
        state.listEditMode = !state.listEditMode;
        if (!state.listEditMode) {
          state.selectedChatIds = new Set();
          try { document.body.classList.remove('hg-list-edit'); } catch (_) {}
        }
        renderPanel();
      };
    }
    const selectedIds = () => [...state.selectedChatIds].filter((id) => Number(id) > 0);
    const exitEdit = async (toast) => {
      state.listEditMode = false;
      state.selectedChatIds = new Set();
      try { document.body.classList.remove('hg-list-edit'); } catch (_) {}
      await loadChats();
      if (toast) showToast(toast);
      renderPanel();
    };
    const readAllBtn = panel.querySelector('#hgEditReadAll');
    if (readAllBtn) {
      readAllBtn.onclick = async () => {
        const ids = selectedIds();
        if (!ids.length) return;
        for (const id of ids) {
          try { await api('/api/chat-groups/' + id + '/read', { method: 'POST', body: {} }); } catch (_) {}
        }
        await exitEdit('Прочитано: ' + ids.length);
      };
    }
    const archiveBtn = panel.querySelector('#hgEditArchive');
    if (archiveBtn) {
      archiveBtn.onclick = async () => {
        const ids = selectedIds();
        if (!ids.length) return;
        for (const id of ids) {
          try {
            await api('/api/chat-groups/' + id + '/archive', { method: 'PUT', body: { archive: true } });
          } catch (e) {
            showToast(e.message || 'Архив');
            return;
          }
        }
        await exitEdit('В архиве: ' + ids.length);
      };
    }
    const deleteBtn = panel.querySelector('#hgEditDelete');
    if (deleteBtn) {
      deleteBtn.onclick = async () => {
        const ids = selectedIds();
        if (!ids.length) return;
        if (!confirm('Удалить выбранные чаты (' + ids.length + ')?')) return;
        for (const id of ids) {
          try {
            await api('/api/chat-groups/' + id, { method: 'DELETE' });
          } catch (e) {
            showToast(e.message || 'Удаление недоступно');
            return;
          }
        }
        await exitEdit('Удалено: ' + ids.length);
      };
    }
    panel.querySelectorAll('[data-bday-dismiss]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        dismissBirthday(btn.getAttribute('data-bday-dismiss'));
        state.birthdays = (state.birthdays || []).filter(
          (b) => Number(b.id) !== Number(btn.getAttribute('data-bday-dismiss'))
        );
        renderPanel();
      };
    });
    panel.querySelectorAll('[data-story]').forEach((btn) => {
      btn.onclick = () => openStoryViewer(Number(btn.getAttribute('data-story')));
    });
    const storyAdd = panel.querySelector('#hgStoryAdd');
    if (storyAdd) {
      storyAdd.onclick = () => openStoryComposer();
    }
    renderChatList(state.searchQ);
    renderPresenceStrip();
    panel.querySelector('#hgSearch').oninput = (e) => {
      state.searchQ = e.target.value;
      renderChatList(e.target.value);
    };
    panel.querySelectorAll('[data-ltab]').forEach((btn) => {
      btn.onclick = () => {
        state.listTab = btn.getAttribute('data-ltab');
        if (state.listTab === 'contacts') loadContactsDirectory().then(() => renderPanel());
        else renderPanel();
      };
    });
    if (state.listTab === 'contacts') {
      // Contacts live INSIDE the chat list (Telegram-like), not as a separate panel.
      renderContactsInline(panel.querySelector('#hgList'));
      const searchEl = panel.querySelector('#hgSearch');
      if (searchEl) {
        searchEl.oninput = (e) => {
          state.contactsQ = e.target.value;
          renderContactsInline(panel.querySelector('#hgList'));
        };
      }
      return;
    }
    panel.querySelectorAll('[data-folder]').forEach((btn) => {
      const isAdd = btn.hasAttribute('data-folder-add');
      btn.onclick = async (ev) => {
        if (isAdd) { ev.stopPropagation(); promptNewFolder(); return; }
        const raw = btn.getAttribute('data-folder');
        state.activeFolderId = raw ? Number(raw) : null;
        try {
          await api('/api/chat-groups/folders/active', {
            method: 'PUT',
            body: { folder_id: state.activeFolderId }
          });
        } catch (_) {}
        await loadChats();
        renderPanel();
      };
      if (!isAdd) {
        btn.oncontextmenu = (ev) => {
          ev.preventDefault();
          openFolderMenu(Number(btn.getAttribute('data-folder')));
        };
      }
    });
    const addFolder = panel.querySelector('[data-folder-add]');
    if (addFolder) {
      addFolder.onclick = () => promptNewFolder();
    }
    panel.querySelector('#hgCompose').onclick = () => {
      openComposeSheet();
    };
    const meBtn = panel.querySelector('#hgListMe');
    if (meBtn) {
      meBtn.onclick = () => {
        state.tab = 'settings';
        state.mobileNav = 'settings';
        state.settingsProfileOpen = false;
        state.settingsEditOpen = false;
        state.chatId = null;
        renderPanel();
      };
    }
  }

  async function openComposeSheet() {
    clearFloats();
    root.querySelectorAll('.hg-compose-sheet,.hg-chat-profile,.hg-invite-sheet').forEach((el) => el.remove());
    const host = sheetHost();
    const el = document.createElement('div');
    el.className = 'hg-compose-sheet hg-sheet';
    el.setAttribute('data-role', 'card');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Новый чат');
    let mode = 'chat'; // chat | group
    el.innerHTML = `
      <div class="hg-compose-head">
        <button type="button" class="hg-icon-btn hg-compose-x" id="hgComposeClose" aria-label="Закрыть"><span aria-hidden="true">✕</span></button>
        <strong>Добавить</strong>
        <button type="button" class="hg-icon-btn hg-compose-ok" id="hgComposeDone" aria-label="Готово" disabled><span aria-hidden="true">✓</span></button>
      </div>
      <div class="hg-compose-modes" role="tablist" aria-label="Режим">
        <button type="button" class="hg-compose-mode is-active" data-cmode="chat" role="tab" aria-selected="true">Чат</button>
        <button type="button" class="hg-compose-mode" data-cmode="group" role="tab" aria-selected="false">Группа</button>
      </div>
      <button type="button" class="hg-compose-invite-cta" id="hgComposeInvite">${ICO.invite || ICO.userPlus || '+'} Пригласить в Хугинн</button>
      <input class="hg-compose-group-name" id="hgComposeGroupName" placeholder="Название группы" hidden />
      <div class="hg-compose-search-wrap">
        <span class="hg-compose-search-ico" aria-hidden="true">${ICO.search || '🔍'}</span>
        <input class="hg-search" id="hgComposeSearch" placeholder="Поиск" />
      </div>
      <div class="hg-compose-body">
        <div class="hg-compose-list" id="hgComposeList"><div class="hg-empty">Загрузка…</div></div>
        <div class="hg-compose-index" id="hgComposeIndex" aria-hidden="true"></div>
      </div>`;
    host.appendChild(el);
    const selected = new Set();
    const listEl = el.querySelector('#hgComposeList');
    const doneBtn = el.querySelector('#hgComposeDone');
    const groupNameInput = el.querySelector('#hgComposeGroupName');
    el.querySelector('#hgComposeClose').onclick = () => el.remove();
    el.querySelector('#hgComposeInvite').onclick = () => {
      el.remove();
      openInviteSheet();
    };

    function syncModeUi() {
      el.querySelectorAll('[data-cmode]').forEach((btn) => {
        const on = btn.getAttribute('data-cmode') === mode;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      if (groupNameInput) groupNameInput.hidden = mode !== 'group';
      doneBtn.disabled = mode === 'group' ? selected.size < 2 : selected.size === 0;
      doneBtn.hidden = mode === 'chat';
    }

    el.querySelectorAll('[data-cmode]').forEach((btn) => {
      btn.onclick = () => {
        mode = btn.getAttribute('data-cmode') === 'group' ? 'group' : 'chat';
        selected.clear();
        syncModeUi();
        loadUsers(el.querySelector('#hgComposeSearch').value);
      };
    });
    syncModeUi();

    async function loadUsers(q) {
      let users = [];
      try {
        const qs = new URLSearchParams({ is_active: 'true', limit: '200' });
        if (q) qs.set('search', q);
        const data = await api('/api/users?' + qs.toString());
        users = data.users || data.items || (Array.isArray(data) ? data : []);
      } catch (_) {
        users = contactRowsFromChats().map((r) => ({ id: r.user_id, name: r.name, is_active: true }));
      }
      const me = myId();
      users = (users || [])
        .filter((u) => Number(u.id || u.user_id) !== Number(me))
        .filter(isWritableComposeUser);
      if (q) {
        const qq = String(q).toLowerCase();
        users = users.filter((u) => String(u.name || u.full_name || u.login || '').toLowerCase().includes(qq));
      }
      users.sort((a, b) => String(a.name || a.full_name || '').localeCompare(String(b.name || b.full_name || ''), 'ru'));
      let html = '';
      let last = '';
      for (const u of users) {
        const uid = u.id || u.user_id;
        const nm = u.name || u.full_name || u.login || ('User ' + uid);
        const letter = (nm.trim().charAt(0) || '#').toUpperCase();
        if (letter !== last) {
          last = letter;
          html += `<div class="hg-contact-letter">${esc(letter)}</div>`;
        }
        const on = selected.has(Number(uid));
        html += `<button type="button" class="hg-contact-row hg-compose-row${on ? ' is-selected' : ''}" data-uid="${uid}">
          <span class="hg-compose-check${on ? ' is-on' : ''}" aria-hidden="true"></span>
          <div class="hg-contact-av" style="background:${avatarColor(nm)}">${esc(initials(nm))}</div>
          <div class="hg-contact-meta"><div class="hg-contact-name">${esc(nm)}</div>
          <div class="hg-contact-status">${esc(composeUserStatus(u))}</div></div>
        </button>`;
      }
      if (!users.length) {
        listEl.innerHTML = `<div class="hg-empty">${q ? 'Никого не найдено' : 'Нет доступных контактов'}</div>
          <button type="button" class="hg-compose-invite-cta" id="hgComposeInviteEmpty">${ICO.invite || '+'} Пригласить в Хугинн</button>`;
        const emptyInv = listEl.querySelector('#hgComposeInviteEmpty');
        if (emptyInv) emptyInv.onclick = () => { el.remove(); openInviteSheet(); };
      } else {
        listEl.innerHTML = html;
      }
      const idx = el.querySelector('#hgComposeIndex');
      if (idx) {
        const letters = [...new Set((users || []).map((u) => {
          const nm = u.name || u.full_name || u.login || '#';
          return (nm.trim().charAt(0) || '#').toUpperCase();
        }))].slice(0, 16);
        idx.innerHTML = letters.map((L) => `<span>${esc(L)}</span>`).join('');
      }
      listEl.querySelectorAll('.hg-compose-row').forEach((row) => {
        row.onclick = async () => {
          const uid = Number(row.getAttribute('data-uid'));
          if (mode === 'chat') {
            try {
              const data = await api('/api/chat-groups/direct', { method: 'POST', body: { user_id: uid } });
              const chat = data.chat || data;
              el.remove();
              await ensureChatOpened(chat);
            } catch (e) {
              showToast(e.message || 'Не удалось открыть чат');
              loadUsers(el.querySelector('#hgComposeSearch').value);
            }
            return;
          }
          if (selected.has(uid)) selected.delete(uid);
          else selected.add(uid);
          syncModeUi();
          loadUsers(el.querySelector('#hgComposeSearch').value);
        };
      });
    }

    doneBtn.onclick = async () => {
      const ids = [...selected];
      if (mode !== 'group' || ids.length < 2) return;
      const gName = ((groupNameInput && groupNameInput.value) || '').trim() || 'Группа';
      try {
        const data = await api('/api/chat-groups', {
          method: 'POST',
          body: { name: gName, member_ids: ids, group_kind: 'work' }
        });
        const chat = data.chat || data;
        el.remove();
        await ensureChatOpened(chat, { name: gName });
      } catch (e) {
        showToast(e.message || 'Не удалось создать');
      }
    };

    let t = null;
    el.querySelector('#hgComposeSearch').oninput = (e) => {
      clearTimeout(t);
      t = setTimeout(() => loadUsers(e.target.value), 180);
    };
    await loadUsers('');
  }

  /** In-chat message search (backend GET /:id/messages?search=). */
  async function openInChatSearch() {
    if (!state.chatId) return;
    clearFloats();
    const host = sheetHost();
    root.querySelectorAll('.hg-search-sheet').forEach((el) => el.remove());
    const el = document.createElement('div');
    el.className = 'hg-search-sheet hg-sheet hg-compose-sheet';
    el.setAttribute('data-role', 'card');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Поиск в чате');
    el.innerHTML = `
      <div class="hg-compose-head">
        <button type="button" class="hg-icon-btn hg-compose-x" id="hgSearchClose" aria-label="Закрыть"><span aria-hidden="true">✕</span></button>
        <strong>Поиск в чате</strong>
        <span style="width:32px"></span>
      </div>
      <div class="hg-compose-search-wrap">
        <span class="hg-compose-search-ico" aria-hidden="true">${ICO.search || '🔍'}</span>
        <input class="hg-search" id="hgSearchInput" placeholder="Найти сообщение" />
      </div>
      <div class="hg-compose-body"><div class="hg-compose-list" id="hgSearchResults"><div class="hg-empty">Введите запрос</div></div></div>`;
    host.appendChild(el);
    el.querySelector('#hgSearchClose').onclick = () => el.remove();
    const listEl = el.querySelector('#hgSearchResults');
    let t = null;
    const run = async (q) => {
      const query = String(q || '').trim();
      if (query.length < 2) { listEl.innerHTML = '<div class="hg-empty">Введите запрос</div>'; return; }
      try {
        const data = await api('/api/chat-groups/' + state.chatId + '/messages?search=' + encodeURIComponent(query) + '&limit=50');
        const msgs = data.messages || data.items || [];
        if (!msgs.length) { listEl.innerHTML = '<div class="hg-empty">Ничего не найдено</div>'; return; }
        listEl.innerHTML = msgs.map((m) => {
          const nm = m.user_name || m.name || 'Сообщение';
          return `<button type="button" class="hg-contact-row" data-mid="${m.id}">
            <div class="hg-contact-av" style="background:${avatarColor(nm)}">${esc(initials(nm))}</div>
            <div class="hg-contact-meta"><div class="hg-contact-name">${esc(nm)}</div>
            <div class="hg-contact-status">${esc(humanizeDisplayText(m.message || '', m)).slice(0, 80)}</div></div>
          </button>`;
        }).join('');
        listEl.querySelectorAll('[data-mid]').forEach((row) => {
          row.onclick = () => {
            const mid = Number(row.getAttribute('data-mid'));
            el.remove();
            scrollToMessage(mid);
          };
        });
      } catch (e) {
        listEl.innerHTML = '<div class="hg-empty">' + esc(e.message || 'Ошибка поиска') + '</div>';
      }
    };
    el.querySelector('#hgSearchInput').oninput = (e) => {
      clearTimeout(t);
      t = setTimeout(() => run(e.target.value), 220);
    };
    setTimeout(() => { const inp = el.querySelector('#hgSearchInput'); if (inp) inp.focus(); }, 0);
  }

  function scrollToMessage(mid) {
    const box = root && root.querySelector('.hg-msgs');
    if (!box) return;
    const bubble = box.querySelector('.hg-bubble[data-mid="' + mid + '"]');
    if (!bubble) { showToast('Сообщение не в текущей ленте'); return; }
    try { bubble.scrollIntoView({ block: 'center' }); } catch (_) {}
    bubble.classList.add('is-highlight');
    setTimeout(() => bubble.classList.remove('is-highlight'), 1600);
  }

  /** Add members to a group chat (POST /:id/members). */
  async function openAddMembers(existing) {
    if (!state.chatId) return;
    clearFloats();
    const have = new Set((existing || []).map((m) => Number(m.user_id || m.id)));
    const host = sheetHost();
    root.querySelectorAll('.hg-addmem-sheet').forEach((el) => el.remove());
    const el = document.createElement('div');
    el.className = 'hg-addmem-sheet hg-sheet hg-compose-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Добавить участников');
    el.innerHTML = `
      <div class="hg-compose-head">
        <button type="button" class="hg-icon-btn hg-compose-x" id="hgAddMemClose" aria-label="Закрыть"><span aria-hidden="true">✕</span></button>
        <strong>Добавить</strong>
        <button type="button" class="hg-icon-btn hg-compose-ok" id="hgAddMemDone" aria-label="Готово" disabled><span aria-hidden="true">✓</span></button>
      </div>
      <div class="hg-compose-search-wrap">
        <span class="hg-compose-search-ico" aria-hidden="true">${ICO.search || '🔍'}</span>
        <input class="hg-search" id="hgAddMemSearch" placeholder="Поиск" />
      </div>
      <div class="hg-compose-body"><div class="hg-compose-list" id="hgAddMemList"><div class="hg-empty">Загрузка…</div></div></div>`;
    host.appendChild(el);
    el.querySelector('#hgAddMemClose').onclick = () => el.remove();
    const selected = new Set();
    const listEl = el.querySelector('#hgAddMemList');
    const doneBtn = el.querySelector('#hgAddMemDone');
    let candidates = [];
    try {
      const data = await api('/api/users?is_active=true&limit=200');
      candidates = (data.users || data.items || []).filter((u) => !have.has(Number(u.id || u.user_id)));
    } catch (_) { candidates = []; }
    const render = (q) => {
      const qq = String(q || '').toLowerCase().trim();
      const rows = candidates.filter((u) => !qq || String(u.name || u.login || '').toLowerCase().includes(qq));
      if (!rows.length) { listEl.innerHTML = '<div class="hg-empty">Никого не найдено</div>'; return; }
      listEl.innerHTML = rows.map((u) => {
        const uid = u.id || u.user_id;
        const nm = u.name || u.login || ('#' + uid);
        const on = selected.has(Number(uid));
        return `<button type="button" class="hg-contact-row hg-compose-row${on ? ' is-selected' : ''}" data-uid="${uid}">
          <span class="hg-compose-check${on ? ' is-on' : ''}" aria-hidden="true"></span>
          <div class="hg-contact-av" style="background:${avatarColor(nm)}">${esc(initials(nm))}</div>
          <div class="hg-contact-meta"><div class="hg-contact-name">${esc(nm)}</div></div>
        </button>`;
      }).join('');
      listEl.querySelectorAll('.hg-compose-row').forEach((row) => {
        row.onclick = () => {
          const uid = Number(row.getAttribute('data-uid'));
          if (selected.has(uid)) selected.delete(uid); else selected.add(uid);
          doneBtn.disabled = selected.size === 0;
          render(el.querySelector('#hgAddMemSearch').value);
        };
      });
    };
    render('');
    el.querySelector('#hgAddMemSearch').oninput = (e) => render(e.target.value);
    doneBtn.onclick = async () => {
      const ids = [...selected];
      if (!ids.length) return;
      try {
        for (const uid of ids) {
          await api('/api/chat-groups/' + state.chatId + '/members', { method: 'POST', body: { user_id: uid } });
        }
        el.remove();
        showToast('Добавлено: ' + ids.length);
        await openChatProfile();
      } catch (e) {
        showToast(e.message || 'Не удалось добавить');
      }
    };
  }

  /** Compose and publish a story (POST /api/stories). */
  async function openStoryComposer() {
    clearFloats();
    const host = sheetHost();
    root.querySelectorAll('.hg-story-sheet').forEach((el) => el.remove());
    const el = document.createElement('div');
    el.className = 'hg-story-sheet hg-sheet hg-compose-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Новая история');
    el.innerHTML = `
      <div class="hg-compose-head">
        <button type="button" class="hg-icon-btn hg-compose-x" id="hgStoryClose" aria-label="Закрыть"><span aria-hidden="true">✕</span></button>
        <strong>История</strong>
        <span style="width:32px"></span>
      </div>
      <div class="hg-invite-fields">
        <input id="hgStoryFile" type="file" accept="image/*,video/*" />
        <input id="hgStoryCaption" placeholder="Подпись (необязательно)" />
      </div>
      <button type="button" class="hg-invite-submit" id="hgStoryPublish">Опубликовать</button>`;
    host.appendChild(el);
    el.querySelector('#hgStoryClose').onclick = () => el.remove();
    el.querySelector('#hgStoryPublish').onclick = async () => {
      const fileInput = el.querySelector('#hgStoryFile');
      const caption = (el.querySelector('#hgStoryCaption').value || '').trim();
      const file = fileInput.files && fileInput.files[0];
      if (!file && !caption) { showToast('Добавьте файл или подпись'); return; }
      const btn = el.querySelector('#hgStoryPublish');
      btn.disabled = true;
      try {
        let mediaUrl = null;
        if (file) {
          const fd = new FormData();
          fd.append('file', file, file.name || 'story');
          const up = await fetch('/api/chat-groups/upload', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token() },
            body: fd
          });
          const upData = await up.json().catch(() => ({}));
          if (!up.ok) throw new Error(upData.error || 'Не удалось загрузить файл');
          mediaUrl = upData.url || upData.file_url || null;
        }
        await api('/api/stories', { method: 'POST', body: { content: caption || 'История', image_url: mediaUrl } });
        el.remove();
        showToast('История опубликована');
        loadStories().then(() => renderPanel());
      } catch (e) {
        showToast(e.message || 'Не удалось опубликовать');
        btn.disabled = false;
      }
    };
  }

  async function promptNewFolder() {
    const name = prompt('Название папки');
    if (!name || !name.trim()) return;
    try {
      await api('/api/chat-groups/folders', { method: 'POST', body: { name: name.trim() } });
      await loadFolders();
      renderPanel();
    } catch (e) {
      showToast(e.message || 'Не удалось создать папку');
    }
  }

  /** Folder management menu: rename / delete / assign dialog. */
  function openFolderMenu(folderId) {
    if (!folderId) return;
    clearFloats();
    const el = document.createElement('div');
    el.className = 'hg-float hg-glass';
    el.setAttribute('data-role', 'menu');
    el.innerHTML = `<div class="hg-float-actions">
      <button type="button" data-fa="rename">${ICO.pen || ICO.compose || '✎'}<span>Переименовать</span></button>
      <button type="button" data-fa="assign">${ICO.plus || '+'}<span>Добавить чат…</span></button>
      <button type="button" class="danger" data-fa="delete">${ICO.trash || '🗑'}<span>Удалить папку</span></button>
    </div>`;
    placeFloat(el, window.innerWidth / 2, 240);
    el.onclick = async (e) => {
      const btn = e.target.closest('[data-fa]');
      if (!btn) return;
      const a = btn.getAttribute('data-fa');
      clearFloats();
      const folder = (state.folders || []).find((f) => Number(f.id) === Number(folderId));
      if (a === 'rename') {
        const name = prompt('Новое название', (folder && folder.name) || '');
        if (!name || !name.trim()) return;
        try {
          await api('/api/chat-groups/folders/' + folderId, { method: 'PATCH', body: { name: name.trim() } });
          await loadFolders();
          renderPanel();
        } catch (err) { showToast(err.message || 'Не удалось переименовать'); }
      }
      if (a === 'delete') {
        if (!confirm('Удалить папку ' + ((folder && folder.name) || '') + '?')) return;
        try {
          await api('/api/chat-groups/folders/' + folderId, { method: 'DELETE' });
          if (Number(state.activeFolderId) === Number(folderId)) state.activeFolderId = null;
          await loadFolders();
          await loadChats();
          renderPanel();
        } catch (err) { showToast(err.message || 'Не удалось удалить папку'); }
      }
      if (a === 'assign') openAssignFolderDialog(folderId);
    };
  }

  /** Pick a chat and drop it into the folder (PUT /:id/folder). */
  function openAssignFolderDialog(folderId) {
    clearFloats();
    const panel = root && root.querySelector('#hgPanel');
    if (!panel) return;
    const host = sheetHost();
    root.querySelectorAll('.hg-assign-sheet').forEach((x) => x.remove());
    const el = document.createElement('div');
    el.className = 'hg-assign-sheet hg-sheet hg-compose-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Добавить чат в папку');
    const rows = (state.chats || []).slice(0, 200).map((c) => {
      const nm = displayChatName(c);
      return `<button type="button" class="hg-contact-row" data-assign="${c.id}">
        <div class="hg-contact-av" style="background:${avatarColor(nm)}">${esc(initials(nm))}</div>
        <div class="hg-contact-meta"><div class="hg-contact-name">${esc(nm)}</div></div>
      </button>`;
    }).join('');
    el.innerHTML = `
      <div class="hg-compose-head">
        <button type="button" class="hg-icon-btn hg-compose-x" id="hgAssignClose" aria-label="Закрыть"><span aria-hidden="true">✕</span></button>
        <strong>В папку</strong>
        <span style="width:32px"></span>
      </div>
      <div class="hg-compose-body"><div class="hg-compose-list">${rows || '<div class="hg-empty">Нет чатов</div>'}</div></div>`;
    host.appendChild(el);
    el.querySelector('#hgAssignClose').onclick = () => el.remove();
    el.querySelectorAll('[data-assign]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api('/api/chat-groups/' + btn.getAttribute('data-assign') + '/folder', {
            method: 'PUT',
            body: { folder_id: Number(folderId) }
          });
          el.remove();
          showToast('Чат добавлен в папку');
          await loadChats();
          renderPanel();
        } catch (e) { showToast(e.message || 'Не удалось'); }
      };
    });
  }

  async function openChatProfile() {
    if (!state.chatId) return;
    clearFloats();
    root.querySelectorAll('.hg-compose-sheet,.hg-chat-profile,.hg-invite-sheet').forEach((el) => el.remove());
    const chat = state.chats.find((c) => Number(c.id) === Number(state.chatId)) || {};
    const title = displayChatName(chat);
    const host = sheetHost();
    const el = document.createElement('div');
    el.className = 'hg-chat-profile hg-sheet';
    el.setAttribute('data-role', 'card');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Профиль чата');
    const isGroup = isGroupChat(chat);
    const avUrl = chat.avatar_url || chat.photo_url || chat.image_url
      || (/офис\s*асгард/i.test(title) ? '/assets/img/huginn/office-asgard.png' : '');
    const avStyle = avUrl
      ? `background-image:url('${esc(avUrl)}');background-size:cover;background-position:center;background-color:transparent`
      : `background:${avatarColor(title)}`;
    const avInner = avUrl ? '' : esc(initials(title));
    el.innerHTML = `
      <div class="hg-profile-head hg-profile-head--group">
        <button type="button" class="hg-icon-btn hg-profile-back" id="hgProfileClose" aria-label="Назад"><span class="hg-profile-back-chevron" aria-hidden="true">‹</span></button>
        <div class="hg-profile-av" style="${avStyle}">${avInner}</div>
        <div class="hg-profile-titles">
          <div class="hg-profile-name">${esc(title)}</div>
          <div class="hg-profile-sub" id="hgProfileSub">…</div>
        </div>
        <button type="button" class="hg-icon-btn hg-profile-more-gal hg-glass" id="hgProfileMoreGal" aria-label="Поиск" hidden>${ICO.search || '<span aria-hidden="true">🔍</span>'}</button>
        <div class="hg-profile-actions">
          <button type="button" class="hg-profile-act" id="hgProfileMute" aria-label="Без звука">
            <span class="hg-profile-act-ico">${ICO.bell || ICO.mute || '🔔'}</span><span>звук</span>
          </button>
          <button type="button" class="hg-profile-act" id="hgProfileSearch" aria-label="Поиск">
            <span class="hg-profile-act-ico">${ICO.search || '🔍'}</span><span>поиск</span>
          </button>
          <button type="button" class="hg-profile-act" id="hgProfileMore" aria-label="Ещё">
            <span class="hg-profile-act-ico">${ICO.more || '⋯'}</span><span>ещё</span>
          </button>
        </div>
      </div>
      ${!isGroup ? `<div class="hg-profile-segment hg-glass" data-role="segment" role="tablist">
        <button type="button" class="hg-profile-seg is-active" data-stab="publications">Публикации</button>
        <button type="button" class="hg-profile-seg" data-stab="archive">Архив</button>
      </div>` : ''}
      <div class="hg-profile-tabs" role="tablist">
        ${isGroup ? '<button type="button" class="hg-profile-tab is-active" data-stab="members">Участники</button>' : ''}
        <button type="button" class="hg-profile-tab" data-stab="media">Медиа</button>
        <button type="button" class="hg-profile-tab" data-stab="files">Файлы</button>
        <button type="button" class="hg-profile-tab" data-stab="voice">Голосовые</button>
        <button type="button" class="hg-profile-tab" data-stab="links">Ссылки</button>
      </div>
      <div class="hg-profile-body" id="hgProfileBody"><div class="hg-empty">Загрузка…</div></div>`;
    host.appendChild(el);
    el.querySelector('#hgProfileClose').onclick = () => el.remove();
    const searchBtn = el.querySelector('#hgProfileSearch');
    if (searchBtn) searchBtn.onclick = () => openInChatSearch();
    const openSoundMenu = () => {
      el.querySelectorAll('.hg-sound-menu').forEach((m) => m.remove());
      const menu = document.createElement('div');
      menu.className = 'hg-attach-menu hg-glass hg-sound-menu';
      menu.setAttribute('data-role', 'menu');
      menu.innerHTML = `<button type="button" data-mute="8h">${ICO.clock || '⏱'} Выключить на время…</button>
        <button type="button" data-mute="forever">${ICO.bellOff || ICO.mute || '🔇'} Выключить звук</button>
        <button type="button" data-mute="1d">${ICO.settings || '⚙'} Настроить</button>
        <button type="button" data-mute="off" class="is-danger">${ICO.bellOff || '🔕'} Выкл. уведомления</button>`;
      el.appendChild(menu);
      menu.querySelectorAll('[data-mute]').forEach((btn) => {
        btn.onclick = async () => {
          const mode = btn.getAttribute('data-mute');
          try {
            if (mode === 'off') {
              await api('/api/chat-groups/' + state.chatId + '/mute', { method: 'PUT', body: { until: null } });
              showToast('Звук включён');
            } else {
              const ms = mode === '1d' ? 24 * 3600 * 1000 : (mode === 'forever' ? 3650 * 24 * 3600 * 1000 : 8 * 3600 * 1000);
              const until = new Date(Date.now() + ms).toISOString();
              await api('/api/chat-groups/' + state.chatId + '/mute', { method: 'PUT', body: { until } });
              showToast(mode === 'forever' ? 'Звук выключен' : ('Без звука: ' + btn.textContent));
            }
          } catch (e) {
            showToast(e.message || 'Mute error');
          }
          menu.remove();
        };
      });
    };
    const openProfileMoreMenu = () => {
      const ch = state.chats.find((c) => Number(c.id) === Number(state.chatId)) || chat;
      const isFav = !!ch.is_favorite;
      el.querySelectorAll('.hg-profile-menu').forEach((m) => m.remove());
      const menu = document.createElement('div');
      menu.className = 'hg-attach-menu hg-glass hg-profile-menu';
      menu.setAttribute('data-role', 'menu');
      menu.innerHTML = `        <button type="button" data-a="favorite" class="${isFav ? 'is-active' : ''}">${isFav ? '★' : '☆'} ${isFav ? 'Убрать из избранного' : 'В избранное'}</button>
        <button type="button" data-a="sound">${ICO.bell || '🔔'} Звук…</button>
        <button type="button" data-a="search">${ICO.search || '🔍'} Поиск</button>
        <button type="button" data-a="leave" class="is-danger">${ICO.x || '✕'} Покинуть</button>`;
      el.appendChild(menu);
      menu.querySelector('[data-a="sound"]').onclick = () => { menu.remove(); openSoundMenu(); };
      menu.querySelector('[data-a="search"]').onclick = () => { menu.remove(); openInChatSearch(); };
      menu.querySelector('[data-a="favorite"]').onclick = async () => {
        menu.remove();
        if (!state.chatId) return;
        try {
          await api('/api/chat-groups/' + state.chatId, { method: 'PUT', body: { is_favorite: !isFav } });
          const ch = state.chats.find((c) => Number(c.id) === Number(state.chatId));
          if (ch) ch.is_favorite = !isFav;
          showToast(!isFav ? 'В избранном' : 'Убрано из избранного');
          renderPanel();
        } catch (e) { showToast(e.message || 'Не удалось'); }
      };
      menu.querySelector('[data-a="leave"]').onclick = async () => {
        menu.remove();
        if (!state.chatId) return;
        try {
          await api('/api/chat-groups/' + state.chatId + '/members/' + myId(), { method: 'DELETE' });
          showToast('Вы покинули чат');
          state.chats = state.chats.filter((c) => Number(c.id) !== Number(state.chatId));
          el.remove();
          closeChat();
        } catch (e) {
          showToast(e.message || 'Не удалось покинуть чат');
        }
      };
    };
    el.querySelector('#hgProfileMore').onclick = () => openProfileMoreMenu();
    const moreGal = el.querySelector('#hgProfileMoreGal');
    if (moreGal) moreGal.onclick = () => openInChatSearch();
    el.querySelector('#hgProfileMute').onclick = () => openSoundMenu();

    let shared = { media: [], files: [], links: [], voices: [] };
    let members = [];
    let activeProfileTab = isGroup ? 'members' : 'publications';
    const body = el.querySelector('#hgProfileBody');
    const syncProfileMeta = (tab) => {
      const sub = el.querySelector('#hgProfileSub');
      if (!sub) return;
      const nMem = members.length || chat.member_count || 0;
      const gallery = tab === 'media' || tab === 'files' || tab === 'voice' || tab === 'links'
        || tab === 'publications' || tab === 'archive';
      el.classList.toggle('is-media-gallery', gallery);
      const moreGalBtn = el.querySelector('#hgProfileMoreGal');
      if (moreGalBtn) moreGalBtn.hidden = !gallery;
      el.querySelectorAll('.hg-profile-tab[data-stab="members"]').forEach((b) => {
        b.style.display = gallery ? 'none' : '';
      });
      const seg = el.querySelector('.hg-profile-segment');
      if (seg) {
        const showSeg = !isGroup && (tab === 'publications' || tab === 'archive' || tab === 'media');
        seg.style.display = showSeg ? '' : 'none';
      }
      if (tab === 'media' || tab === 'publications') {
        const n = (shared.media || []).length;
        const nVid = (shared.media || []).filter((m) => m.message_type === 'video' || m.message_type === 'circle').length;
        const nPhoto = Math.max(0, n - nVid);
        sub.textContent = n
          ? (nVid ? (nPhoto + ' фото, ' + nVid + ' видео') : (n + ' фото'))
          : (isGroup ? ((nMem ? (nMem + ' участников') : '')) : peerFirstName(chat));
      } else if (tab === 'archive') {
        sub.textContent = 'Архив публикаций';
      } else if (tab === 'files') {
        const nFiles = (shared.files || []).filter((f) => {
          const t = String(f.message_type || '');
          if (t === 'image' || t === 'video' || t === 'circle' || t === 'voice') return false;
          const n = String(f.original_name || f.file_name || f.name || '');
          return !(/^seed-photo/i.test(n) || /\.(png|jpe?g|gif|webp)$/i.test(n));
        }).length;
        sub.textContent = nFiles + ' файлов';
      } else if (tab === 'voice') {
        sub.textContent = ((shared.voices || []).length || 0) + ' голосовых сообщений';
      } else if (tab === 'links') {
        sub.textContent = ((shared.links || []).length || 0) + ' ссылок';
      } else if (tab === 'members') {
        sub.textContent = nMem + ' участников';
      } else {
        sub.textContent = nMem + ' участников';
      }
    };
    const renderMediaGrid = (items, emptyLabel) => {
      body.innerHTML = items.length
        ? `<div class="hg-shared-grid">${items.map((m) =>
          `<button type="button" class="hg-shared-cell" data-src="${esc(m.file_url || m.url || '')}">
            ${m.message_type === 'circle' || m.message_type === 'video'
              ? `<video src="${esc(m.file_url || '')}" muted playsinline></video>`
              : `<img src="${esc(m.file_url || m.url || '')}" alt="" loading="eager" onerror="this.style.display='none';this.parentElement.style.background='color-mix(in srgb, var(--blue-l,#4A90D9) 55%, var(--bg3,#1C2130))'">`}
          </button>`).join('')}</div>`
        : `<div class="hg-empty">${esc(emptyLabel || 'Нет медиа')}</div>`;
      body.querySelectorAll('.hg-shared-cell').forEach((cell) => {
        cell.onclick = () => { const src = cell.getAttribute('data-src'); if (src) openLightbox(src); };
      });
    };
    const openMemberMenu = (m) => {
      el.querySelectorAll('.hg-member-menu').forEach((x) => x.remove());
      const nm = m.name || m.user_name || ('User ' + (m.user_id || m.id));
      const menu = document.createElement('div');
      menu.className = 'hg-attach-menu hg-glass hg-member-menu';
      menu.setAttribute('data-role', 'menu');
      menu.innerHTML = `<div class="hg-member-preview">
          <div class="hg-contact-av" style="background:${avatarColor(nm)}">${esc(initials(nm))}</div>
          <div><strong>${esc(nm)}</strong><div class="hg-muted">${esc(m.role || 'участник')}</div></div>
        </div>
        <button type="button" data-a="msg">Написать</button>
        <button type="button" data-a="info">Инфо</button>
        <button type="button" data-a="tags" disabled title="DEFER_BE">Метки…</button>
        <button type="button" data-a="kick" class="is-danger">Исключить</button>`;
      el.appendChild(menu);
      menu.querySelector('[data-a="msg"]').onclick = async () => {
        menu.remove();
        const uid = m.user_id || m.id;
        if (!uid) return;
        try {
          const data = await api('/api/chat-groups/direct', { method: 'POST', body: { user_id: uid } });
          el.remove();
          await openChat((data.chat || data).id);
        } catch (e) { showToast(e.message || 'Чат'); }
      };
      menu.querySelector('[data-a="info"]').onclick = () => { showToast(nm); menu.remove(); };
      menu.querySelector('[data-a="kick"]').onclick = async () => {
        const uid = m.user_id || m.id;
        menu.remove();
        if (!uid || !state.chatId) return;
        try {
          await api('/api/chat-groups/' + state.chatId + '/members/' + uid, { method: 'DELETE' });
          showToast('Участник исключён');
          el.remove();
          await openChatProfile();
        } catch (err) {
          showToast(err.message || 'Не удалось исключить');
        }
      };
      menu.querySelector('[data-a="tags"]').onclick = () => {};
    };
    const renderTab = (tab) => {
      activeProfileTab = tab;
      el.querySelectorAll('.hg-profile-tab, .hg-profile-seg').forEach((b) => {
        b.classList.toggle('is-active', b.getAttribute('data-stab') === tab);
      });
      syncProfileMeta(tab === 'publications' || tab === 'archive' ? 'media' : tab);
      if (tab === 'publications' || tab === 'media') {
        renderMediaGrid(shared.media || [], tab === 'publications' ? 'Нет публикаций' : 'Нет медиа');
        return;
      }
      if (tab === 'archive') {
        renderMediaGrid([], 'Архив пуст');
        return;
      }
      if (tab === 'files') {
        const fmtSize = (n) => {
          const b = Number(n) || 0;
          if (b <= 0) return '0 Б';
          if (b < 1024) return b + ' Б';
          if (b < 1024 * 1024) return (Math.round((b / 1024) * 10) / 10) + ' Кб';
          return (Math.round((b / (1024 * 1024)) * 10) / 10) + ' Мб';
        };
        const fmtWhen = (iso) => {
          if (!iso) return '';
          try {
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return '';
            return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
          } catch (_) { return ''; }
        };
        const fileBadge = (name, mime) => {
          const n = String(name || '');
          const m = String(mime || '');
          if (/\.pdf$/i.test(n) || /pdf/i.test(m)) return '<span class="hg-file-badge is-pdf">pdf</span>';
          if (/\.docx?$/i.test(n) || /word|msword|officedocument\.word/i.test(m)) return '<span class="hg-file-badge is-doc">doc</span>';
          if (/\.xlsx?$/i.test(n) || /excel|spreadsheet/i.test(m)) return '<span class="hg-file-badge is-xls">xls</span>';
          if (/\.(zip|rar|7z)$/i.test(n) || /zip|rar/i.test(m)) return '<span class="hg-file-badge is-zip">zip</span>';
          if (/\.(png|jpe?g|gif|webp)$/i.test(n) || /^image\//i.test(m)) return '<span class="hg-file-badge is-img">img</span>';
          return `<span class="hg-file-badge is-generic">${ICO.file || '📄'}</span>`;
        };
        const items = (shared.files || []).filter((f) => {
          const t = String(f.message_type || '');
          if (t === 'image' || t === 'video' || t === 'circle' || t === 'voice') return false;
          const n = String(f.original_name || f.file_name || f.name || '');
          if (/^seed-photo/i.test(n) || /\.(png|jpe?g|gif|webp)$/i.test(n)) return false;
          return true;
        });
        body.innerHTML = items.length
          ? `<div class="hg-shared-list hg-glass" data-role="card">${items.map((f) => {
            const name = f.original_name || f.file_name || f.name || 'файл';
            const size = fmtSize(f.file_size || (f.metadata && f.metadata.file_size) || 0);
            const when = fmtWhen(f.created_at || f.sent_at || f.timestamp);
            const sub = [size, when].filter(Boolean).join(' • ');
            return `<a class="hg-shared-file" href="${esc(f.file_url || f.url || '#')}" target="_blank" rel="noopener">
              <span class="hg-shared-file-ico">${fileBadge(name, f.mime_type || f.mime)}</span>
              <span class="hg-shared-file-meta">
                <span class="hg-shared-file-name">${esc(name)}</span>
                <span class="hg-shared-file-sub">${esc(sub || 'файл')}</span>
              </span>
            </a>`;
          }).join('')}</div>`
          : '<div class="hg-empty">Нет файлов</div>';
        return;
      }
      if (tab === 'links') {
        const items = shared.links || [];
        body.innerHTML = items.length
          ? `<div class="hg-shared-list hg-glass" data-role="card">${items.map((l) => {
            const title = l.title || l.url || 'Ссылка';
            const host = (() => { try { return new URL(l.url).hostname; } catch (_) { return l.url || ''; } })();
            return `<a class="hg-shared-file" href="${esc(l.url)}" target="_blank" rel="noopener">
              <span class="hg-shared-file-ico"><span class="hg-file-badge is-generic">${ICO.globe || '🔗'}</span></span>
              <span class="hg-shared-file-meta">
                <span class="hg-shared-file-name">${esc(title)}</span>
                <span class="hg-shared-file-sub">${esc(host)}</span>
              </span>
            </a>`;
          }).join('')}</div>`
          : '<div class="hg-empty">Нет ссылок</div>';
        return;
      }
      if (tab === 'voice') {
        const items = shared.voices || [];
        body.innerHTML = items.length
          ? `<div class="hg-shared-list hg-glass" data-role="card">${items.map((v) => {
            const who = v.user_name || v.sender_name || v.name || 'Голос';
            const dur = v.file_duration || v.duration || '0:00';
            return `<button type="button" class="hg-shared-voice" data-src="${esc(v.file_url || '')}">
              <span class="hg-shared-file-ico" style="border-radius:50%;background:#0A84FF">${ICO.play || '▶'}</span>
              <span class="hg-shared-file-meta">
                <span class="hg-shared-file-name">${esc(who)}</span>
                <span class="hg-shared-file-sub">${esc(String(dur))}</span>
              </span>
            </button>`;
          }).join('')}</div>`
          : '<div class="hg-empty">Нет голосовых</div>';
        body.querySelectorAll('.hg-shared-voice').forEach((btn) => {
          btn.onclick = () => {
            const src = btn.getAttribute('data-src');
            if (!src) return;
            const a = new Audio(src);
            a.play().catch(() => {});
          };
        });
        return;
      }
      if (tab === 'members') {
        const addBtn = `<button type="button" class="hg-add-members" id="hgAddMembers">${ICO.userPlus || ICO.users || '+'} Добавить участников</button>`;
        body.innerHTML = addBtn + (members.length
          ? `<div class="hg-members-card hg-glass" data-role="card">${members.map((m, idx) => {
            const nm = m.name || m.user_name || ('User ' + (m.user_id || m.id));
            const role = String(m.role || 'участник').toLowerCase();
            const badge = /owner|владел/i.test(role) ? '<span class="hg-role-badge is-owner">владелец</span>'
              : /admin|админ/i.test(role) ? '<span class="hg-role-badge is-admin">админ</span>' : '';
            const online = !!(m.is_online || m.online || /в\s*сети/i.test(String(m.status || '')));
            const statusTxt = online
              ? 'в сети'
              : (m.last_seen_at ? ('был(а) ' + formatSeen(m.last_seen_at)) : 'был(а) недавно');
            return `<button type="button" class="hg-member-row" data-member-idx="${idx}">
              <div class="hg-contact-av" style="background:${avatarColor(nm)}">${esc(initials(nm))}</div>
              <div class="hg-member-meta">
                <div class="hg-member-name">${esc(nm)}</div>
                <div class="hg-member-sub ${online ? 'is-online' : ''}">${esc(statusTxt)}</div>
              </div>
              ${badge}
            </button>`;
          }).join('')}</div>`
          : '<div class="hg-empty">Нет участников</div>');
        const add = body.querySelector('#hgAddMembers');
        if (add) add.onclick = () => openAddMembers(members);
        body.querySelectorAll('.hg-member-row').forEach((row) => {
          const idx = Number(row.getAttribute('data-member-idx'));
          row.onclick = () => openMemberMenu(members[idx] || {});
        });
      }
    };
    el.querySelectorAll('.hg-profile-tab, .hg-profile-seg').forEach((btn) => {
      btn.onclick = () => renderTab(btn.getAttribute('data-stab'));
    });
    renderTab(activeProfileTab);

    try {
      const detail = await api('/api/chat-groups/' + state.chatId);
      members = detail.members || [];
      if (detail.chat) {
        if (detail.chat.direct_user_name) chat.direct_user_name = detail.chat.direct_user_name;
        if (detail.chat.direct_user_id) chat.direct_user_id = detail.chat.direct_user_id;
        const nmEl = el.querySelector('.hg-profile-name');
        if (nmEl) nmEl.textContent = displayChatName(detail.chat);
      }
    } catch (_) { /* keep peer subtitle from initial renderTab */ }
    try {
      const sh = await api('/api/chat-groups/' + state.chatId + '/shared');
      if (sh && (sh.media || sh.files || sh.links || sh.voices)) shared = sh;
    } catch (_) {}
    renderTab(activeProfileTab);
  }

  async function openStoryViewer(storyId) {
    const story = (state.stories || []).find((s) => Number(s.id) === Number(storyId));
    if (!story) return;
    clearFloats();
    root.querySelectorAll('.hg-story-viewer').forEach((el) => el.remove());
    const el = document.createElement('div');
    el.className = 'hg-story-viewer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'История');
    const media = story.media_url || story.file_url || story.image_url;
    const isVideo = story.media_type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(String(media || ''));
    el.innerHTML = `
      <button type="button" class="hg-story-viewer-close" aria-label="Закрыть">${ICO.close || '✕'}</button>
      <div class="hg-story-viewer-meta">${esc(story.user_name || 'Story')}</div>
      <div class="hg-story-viewer-body">
        ${media
          ? (isVideo
            ? `<video src="${esc(media)}" autoplay playsinline controls></video>`
            : `<img src="${esc(media)}" alt="">`)
          : `<div class="hg-story-viewer-text">${esc(story.caption || story.text || 'История')}</div>`}
      </div>`;
    (root.querySelector('.hg-chrome') || root).appendChild(el);
    el.querySelector('.hg-story-viewer-close').onclick = () => el.remove();
    el.onclick = (e) => { if (e.target === el) el.remove(); };
    try {
      await api('/api/chat-groups/stories/' + storyId + '/view', { method: 'POST', body: {} });
      story.viewed = true;
      const railBtn = root.querySelector('[data-story="' + storyId + '"]');
      if (railBtn) railBtn.classList.remove('is-unread');
    } catch (_) {}
  }

  /** «На линии» — presence peers, not Instagram stories */
  function renderPresenceStrip() {
    const box = root.querySelector('#hgPresence');
    if (!box) return;
    const onlinePeers = [];
    const seen = new Set();
    state.chats.forEach((c) => {
      const members = c.members || [];
      members.forEach((m) => {
        const uid = m.user_id || m.id;
        if (!uid || Number(uid) === Number(myId()) || seen.has(Number(uid))) return;
        const p = state.presence[uid];
        if (p && p.online) {
          seen.add(Number(uid));
          onlinePeers.push({
            user_id: uid,
            name: m.name || m.full_name || c.name || 'Коллега',
            chat_id: c.id
          });
        }
      });
      if (c.peer_user_id && state.presence[c.peer_user_id] && state.presence[c.peer_user_id].online) {
        if (!seen.has(Number(c.peer_user_id))) {
          seen.add(Number(c.peer_user_id));
          onlinePeers.push({
            user_id: c.peer_user_id,
            name: c.name || 'Коллега',
            chat_id: c.id
          });
        }
      }
    });
    // Fallback: recent chat peers (compact), label «На линии».
    // Prefer the global presence map (presence/all) so users with no open chat
    // are still visible; fall back to chat rows only when nobody is online.
    let items = [];
    const dir = state.contactsDirectory || [];
    if (Array.isArray(dir) && dir.length) {
      items = dir
        .filter((u) => u.online)
        .slice(0, 8)
        .map((u) => ({ user_id: u.user_id, name: u.name, chat_id: u.chat_id || 0 }));
    }
    if (!items.length) items = onlinePeers.slice(0, 8);
    if (!items.length) {
      items = state.chats.filter((c) => !c.is_mimir).slice(0, 6).map((c) => ({
        user_id: c.peer_user_id || c.direct_user_id || c.id,
        name: c.name || 'Чат',
        chat_id: c.id,
        soft: true
      }));
    }
    if (!items.length) {
      const wrap = root.querySelector('#hgPresenceWrap');
      if (wrap) wrap.hidden = true;
      box.innerHTML = '';
      return;
    }
    const wrap = root.querySelector('#hgPresenceWrap');
    if (wrap) wrap.hidden = false;
    box.innerHTML = items.map((p) => {
      const nm = p.name || 'Коллега';
      return `<button type="button" class="hg-presence-item" data-pcid="${p.chat_id || ''}" data-puid="${p.user_id}" title="${esc(nm)}">
        <div class="hg-presence-av${!p.soft ? ' is-online' : ''}" style="background:${avatarColor(nm)}">${esc(initials(nm))}</div>
        <span class="hg-presence-label">${esc((nm || '').split(/\s+/)[0] || '—')}</span>
      </button>`;
    }).join('');
    box.querySelectorAll('[data-pcid]').forEach((el) => {
      el.onclick = async () => {
        const cid = Number(el.getAttribute('data-pcid'));
        if (cid > 0) { openChat(cid); return; }
        const uid = Number(el.getAttribute('data-puid'));
        if (uid > 0) {
          try {
            const data = await api('/api/chat-groups/direct', { method: 'POST', body: { user_id: uid } });
            await ensureChatOpened(data.chat || data, { direct_user_id: uid, direct_user_name: el.getAttribute('title') });
          } catch (e) { showToast(e.message || 'Не удалось открыть чат'); }
        }
      };
    });
  }

  function renderChatList(q) {
    const box = root.querySelector('#hgList');
    if (!box) return;
    const query = (q || '').toLowerCase().trim();
    // Honest state: if the list failed to load (e.g. guest 403), say so instead
    // of pretending the user has no chats.
    if (state.chatsError && !(state.chats && state.chats.length)) {
      box.innerHTML = state.chatsError === 'auth'
        ? `<div class="hg-empty"><div class="hg-empty-t">Сессия истекла</div><div class="hg-empty-s">Войдите заново</div></div>`
        : `<div class="hg-empty"><div class="hg-empty-t">Не удалось загрузить чаты</div><div class="hg-empty-s">Проверьте соединение и обновите</div></div>`;
      return;
    }
    let rows = state.chats.filter((c) => !query || String(c.name || '').toLowerCase().includes(query));
    if (state.listTab === 'personal') {
      rows = rows.filter((c) => !c.is_group && !c.is_mimir);
    } else if (state.listTab === 'favorites') {
      rows = rows.filter((c) => !!c.is_favorite);
    } else if (state.listTab === 'new') {
      rows = rows.filter((c) => Number(c.unread_count) > 0);
    } else if (state.listTab === 'clients') {
      rows = rows.filter((c) => /клиент|client|guest|hg_/i.test(String(c.name || '') + String(c.group_kind || '')));
    }
    if (!rows.length) {
      box.innerHTML = emptyListHtml(query ? 'search' : 'empty', q);
      const cta = box.querySelector('#hgEmptyNew');
      if (cta) cta.onclick = () => { openComposeSheet(); };
      return;
    }
    const rowHtml = (c) => {
      const draft = loadDraft(c.id) || (c._seedDraft ? String(c.last_message || '') : '');
      const rawPrev = c.last_message || c.last_message_text || '';
      const prevType = c.last_message_type || (
        /фото|image/i.test(rawPrev) ? 'image'
          : /файл|file|document|📄/i.test(rawPrev) ? 'file'
            : 'text'
      );
      let prev = humanizeDisplayText(rawPrev, { message_type: prevType });
      if (prevType === 'image' && !/📷/.test(prev)) prev = '📷 ' + (prev || 'Фото');
      else if ((prevType === 'file' || prevType === 'document') && !/📄/.test(prev)) prev = '📄 ' + (prev || 'Файл');
      else if (prevType === 'video' && !/🎬/.test(prev)) prev = '🎬 ' + (prev || 'Видео');
      else if (prevType === 'voice') prev = '🎤 ' + (prev || 'Голосовое');
      const cname = displayChatName(c);
      const t = c.last_message_at
        ? new Date(c.last_message_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        : '';
      const unread = Number(c.unread_count) || 0;
      const muted = c.muted_until && new Date(c.muted_until).getTime() > Date.now();
      const pinned = !!(c.is_pinned || c.pinned_at);
      const mineLast = Number(c.last_message_user_id) === Number(myId());
      const peerId = c.peer_user_id || c.direct_user_id;
      const online = !!(peerId && ((c.is_online === true) || (state.presence[peerId] && state.presence[peerId].online)));
      const readCls = (c.last_message_is_read || c.last_read) ? ' is-read' : '';
      const ticks = (!unread && mineLast && !draft) ? `<span class="hg-ticks${readCls}">✓✓</span>` : '';
      // Honest last-seen for direct chats (contacts/header already show it; here
      // only when there is no message preview, to avoid noise on a busy chat).
      const seenIso = (peerId && !isGroupChat(c))
        ? (c.direct_user_last_seen_at || (state.presence[peerId] && state.presence[peerId].last_seen_at) || null)
        : null;
      const seenHtml = (!online && seenIso && !draft && !rawPrev)
        ? `<span class="hg-chat-seen">был(а) ${esc(formatSeen(seenIso))}</span>`
        : '';
      const prevHtml = draft
        ? `<span class="hg-draft">Черновик: </span>${esc(draft)}`
        : `${ticks}${esc(prev)}${seenHtml}`;
      const avBg = c._seedColor || avatarColor(cname);
      const pinIco = pinned ? `<span class="hg-chat-icons" title="Закреплён">${ICO.pin || ''}</span>` : '';
      const muteIco = muted ? `<span class="hg-chat-icons" title="Без звука">${ICO.mute || ICO['volume-x'] || ''}</span>` : '';
      const selected = state.selectedChatIds.has(Number(c.id));
      const check = state.listEditMode
        ? `<span class="hg-chat-check${selected ? ' is-on' : ''}" aria-hidden="true"></span>`
        : '';
      return `<button type="button" class="hg-chat-row${Number(c.id) === Number(state.chatId) ? ' is-active' : ''}${selected ? ' is-selected' : ''}${state.listEditMode ? ' is-edit' : ''}" data-cid="${c.id}">
        ${check}
        <div class="hg-chat-av${online ? ' is-online' : ''}" style="background:${avBg}">${esc(initials(cname))}</div>
        <div class="hg-chat-name">${esc(cname)}${muteIco}</div>
        <div class="hg-chat-time">${pinIco}${esc(t)}</div>
        <div class="hg-chat-prev${unread ? ' is-unread' : ''}">${prevHtml}</div>
        ${unread > 0 ? `<span class="hg-badge${muted ? ' is-muted' : ''}">${unread > 99 ? '99+' : unread}</span>` : '<span></span>'}
      </button>`;
    };
    const pinnedRows = rows.filter((c) => !!(c.is_pinned || c.pinned_at));
    const ordinary = rows.filter((c) => !(c.is_pinned || c.pinned_at));
    let html = '';
    if (pinnedRows.length) {
      html += `<div class="hg-pinned-block" data-role="pinned">
        <div class="hg-pinned-label">Закреплённые</div>
        ${pinnedRows.map(rowHtml).join('')}
      </div>`;
    }
    if (ordinary.length) {
      if (pinnedRows.length) html += `<div class="hg-list-sep" aria-hidden="true"></div>`;
      html += ordinary.map(rowHtml).join('');
    }
    box.innerHTML = html;
    box.querySelectorAll('[data-cid]').forEach((el) => {
      el.onclick = () => {
        const cid = Number(el.getAttribute('data-cid'));
        if (state.listEditMode) {
          if (state.selectedChatIds.has(cid)) state.selectedChatIds.delete(cid);
          else state.selectedChatIds.add(cid);
          renderPanel();
          return;
        }
        openChat(cid);
      };
    });
    syncRailBadge();
  }

  /** Contacts source: full Huginn directory (all active users), not just chats. */
  async function loadContactsDirectory() {
    try {
      const data = await api('/api/chat-groups/directory');
      state.contactsDirectory = data.users || [];
    } catch (_) {
      state.contactsDirectory = state.contactsDirectory || [];
    }
    return state.contactsDirectory;
  }

  function contactRowsFromChats() {
    const dir = state.contactsDirectory;
    if (Array.isArray(dir) && dir.length) {
      return dir
        .filter((u) => Number(u.user_id) !== Number(myId()))
        .map((u) => ({
          user_id: u.user_id,
          name: u.name || 'Контакт',
          chat_id: u.chat_id || 0,
          online: !!u.online,
          last_seen_at: u.last_seen_at || null,
          is_huginn_guest: !!u.is_huginn_guest
        }));
    }
    const map = new Map();
    state.chats.forEach((c) => {
      const members = c.members || [];
      if (members.length) {
        members.forEach((m) => {
          const uid = m.user_id || m.id;
          if (!uid || Number(uid) === Number(myId()) || map.has(Number(uid))) return;
          map.set(Number(uid), {
            user_id: uid,
            name: m.name || m.full_name || displayChatName(c) || 'Контакт',
            chat_id: c.id
          });
        });
      } else if (c.peer_user_id || c.direct_user_id) {
        const uid = c.peer_user_id || c.direct_user_id;
        if (!map.has(Number(uid))) {
          map.set(Number(uid), {
            user_id: uid,
            name: displayChatName(c) || c.direct_user_name || 'Контакт',
            chat_id: c.id
          });
        }
      }
    });
    return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  }

  /** Contacts rendered INSIDE the chat list (tab «Контакты»), Telegram-like. */
  function renderContactsInline(listEl) {
    if (!listEl) return;
    const q = (state.contactsQ || '').toLowerCase().trim();
    const dir = state.contactsDirectory || [];
    if (!dir.length) { listEl.innerHTML = '<div class="hg-empty">Загрузка…</div>'; return; }
    let rows = contactRowsFromChats();
    if (q) rows = rows.filter((r) => String(r.name || '').toLowerCase().includes(q));
    rows = rows.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
    if (!rows.length) {
      listEl.innerHTML = emptyListHtml(q ? 'search' : 'empty', state.contactsQ);
      return;
    }
    let lastLetter = '';
    let html = '';
    for (const r of rows) {
      const nm = humanizeChatName(r.name);
      const letter = (nm.trim().charAt(0) || '#').toUpperCase();
      if (letter !== lastLetter) {
        lastLetter = letter;
        html += `<div class="hg-contact-letter">${esc(letter)}</div>`;
      }
      const p = state.presence[r.user_id];
      const isOnline = r.online != null ? r.online : !!(p && p.online);
      const seen = r.last_seen_at || (p && p.last_seen_at);
      const statusTxt = isOnline ? 'в сети' : (seen ? ('был(а) ' + formatSeen(seen)) : 'не в сети');
      const hasChat = Number(r.chat_id) > 0;
      // Contacts without an existing chat are the «not in Huginn yet» bucket:
      // show «Пригласить» instead of «открыть чат» (user requirement).
      if (!hasChat) {
        html += `<button type="button" class="hg-contact-row is-invite" data-invite-uid="${r.user_id}" data-invite-name="${esc(nm)}">
          <div class="hg-contact-av" style="background:${avatarColor(nm)}">${esc(initials(nm))}</div>
          <div class="hg-contact-meta">
            <div class="hg-contact-name">${esc(nm)}</div>
            <div class="hg-contact-status"><span class="hg-status-dot is-off"></span>ещё не в Хугинне</div>
          </div>
          <span class="hg-contact-invite">Пригласить</span>
        </button>`;
        continue;
      }
      html += `<button type="button" class="hg-contact-row" data-cid="${r.chat_id || ''}" data-uid="${r.user_id}">
        <div class="hg-contact-av" style="background:${avatarColor(nm)}">${esc(initials(nm))}</div>
        <div class="hg-contact-meta">
          <div class="hg-contact-name">${esc(nm)}</div>
          <div class="hg-contact-status"><span class="hg-status-dot ${isOnline ? 'is-online' : 'is-off'}"></span>${esc(statusTxt)}</div>
        </div>
      </button>`;
    }
    listEl.innerHTML = html;
    listEl.querySelectorAll('.hg-contact-row.is-invite').forEach((el) => {
      el.onclick = () => openInviteSheet({ name: el.getAttribute('data-invite-name') });
    });
    listEl.querySelectorAll('.hg-contact-row:not(.is-invite)').forEach((el) => {
      el.onclick = async () => {
        const cid = Number(el.getAttribute('data-cid'));
        const uid = Number(el.getAttribute('data-uid'));
        if (cid > 0) { openChat(cid); return; }
        if (uid > 0) {
          try {
            const data = await api('/api/chat-groups/direct', { method: 'POST', body: { user_id: uid } });
            const row = (state.contactsDirectory || []).find((u) => Number(u.user_id) === uid);
            await ensureChatOpened(data.chat || data, {
              direct_user_id: uid,
              direct_user_name: (row && row.name) || null,
              name: (row && row.name) || null
            });
          } catch (e) {
            showToast(e.message || 'Не удалось открыть чат');
          }
        }
      };
    });
  }

  async function renderContactsPanel(panel) {
    const q = (state.contactsQ || '').toLowerCase().trim();
    if (!state.contactsDirectory || !state.contactsDirectory.length) {
      panel.innerHTML = '<div class="hg-empty">Загрузка…</div>';
      await loadContactsDirectory();
    }
    let rows = contactRowsFromChats();
    if (q) rows = rows.filter((r) => String(r.name || '').toLowerCase().includes(q));
    const letters = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    rows = rows.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
    const onlineCount = rows.filter((r) => (r.online != null ? r.online : (state.presence[r.user_id] || {}).online)).length;
    let listHtml = '';
    if (!rows.length) {
      listHtml = emptyListHtml(q ? 'search' : 'empty', state.contactsQ);
    } else {
      let lastLetter = '';
      for (const r of rows) {
        const nm = humanizeChatName(r.name);
        const letter = (nm.trim().charAt(0) || '#').toUpperCase();
        if (letter !== lastLetter) {
          lastLetter = letter;
          listHtml += `<div class="hg-contact-letter" data-letter-head="${esc(letter)}">${esc(letter)}</div>`;
        }
        const p = state.presence[r.user_id];
        const isOnline = r.online != null ? r.online : !!(p && p.online);
        const seen = r.last_seen_at || (p && p.last_seen_at);
        const statusMap = {
          online: ['is-online', 'в сети'],
          vacation: ['is-away', 'в отпуске'],
          meeting: ['is-busy', 'на встрече'],
          dnd: ['is-busy', 'не беспокоить'],
          off: ['is-off', seen ? ('был(а) ' + formatSeen(seen)) : 'не в сети']
        };
        const statusKey = (p && p.status) || (isOnline ? 'online' : 'off');
        const [dotCls, status] = statusMap[statusKey] || statusMap.off;
        const contactActive =
          (Number(r.chat_id) > 0 && Number(r.chat_id) === Number(state.chatId)) ||
          (Number(r.user_id) > 0 && Number(r.user_id) === Number(state.selectedContactUid));
        if (Number(r.chat_id) <= 0) {
          // Not in Huginn yet → invite, not open a chat.
          listHtml += `<button type="button" class="hg-contact-row is-invite" data-invite-uid="${r.user_id}" data-invite-name="${esc(nm)}">
            <div class="hg-contact-av" style="background:${avatarColor(nm)}">${esc(initials(nm))}</div>
            <div class="hg-contact-meta">
              <div class="hg-contact-name">${esc(nm)}</div>
              <div class="hg-contact-status"><span class="hg-status-dot is-off"></span>ещё не в Хугинне</div>
            </div>
            <span class="hg-contact-invite">Пригласить</span>
          </button>`;
          continue;
        }
        listHtml += `<button type="button" class="hg-contact-row${contactActive ? ' is-active' : ''}" data-cid="${r.chat_id || ''}" data-uid="${r.user_id}">
          <div class="hg-contact-av" style="background:${avatarColor(nm)}">${esc(initials(nm))}</div>
          <div class="hg-contact-meta">
            <div class="hg-contact-name">${esc(nm)}</div>
            <div class="hg-contact-status"><span class="hg-status-dot ${dotCls}"></span>${esc(status)}</div>
          </div>
        </button>`;
      }
    }
    panel.innerHTML = `
      <div class="hg-contacts">
        <div class="hg-contacts-head">
          <button type="button" class="hg-link-btn" id="hgContactSort">Сортировка</button>
          <h2>Контакты</h2>
          <button type="button" class="hg-icon-btn" id="hgContactAdd" title="Добавить">${ICO.plus || '+'}</button>
        </div>
        <input class="hg-search" id="hgContactSearch" placeholder="Поиск" value="${esc(state.contactsQ || '')}" />
        <div class="hg-contacts-body">
          <div class="hg-contacts-list" id="hgContactList">${listHtml}</div>
          <div class="hg-alpha-index" id="hgAlpha">${letters.map((L) => `<span data-letter="${L}">${L}</span>`).join('')}</div>
        </div>
      </div>`;
    panel.querySelector('#hgContactSearch').oninput = (e) => {
      state.contactsQ = e.target.value;
      renderContactsPanel(panel);
    };
    panel.querySelector('#hgContactSort').onclick = () => showToast('Сортировка по имени');
    panel.querySelector('#hgContactAdd').onclick = () => inviteSomeone();
    panel.querySelectorAll('.hg-contact-row.is-invite').forEach((el) => {
      el.onclick = () => openInviteSheet({ name: el.getAttribute('data-invite-name') });
    });
    panel.querySelectorAll('.hg-contact-row:not(.is-invite)').forEach((el) => {
      el.onclick = async () => {
        const cid = Number(el.getAttribute('data-cid'));
        const uid = Number(el.getAttribute('data-uid'));
        state.selectedContactUid = uid || null;
        panel.querySelectorAll('.hg-contact-row').forEach((row) => {
          row.classList.toggle('is-active', row === el);
        });
        if (cid > 0) { state.tab = 'huginn'; state.mobileNav = 'chats'; openChat(cid); return; }
        if (uid > 0) {
          try {
            const data = await api('/api/chat-groups/direct', { method: 'POST', body: { user_id: uid } });
            const chat = data.chat || data;
            state.tab = 'huginn';
            state.mobileNav = 'chats';
            const row = state.contactsDirectory && state.contactsDirectory.find((u) => Number(u.user_id) === uid);
            await ensureChatOpened(chat, {
              direct_user_id: uid,
              direct_user_name: (row && row.name) || null,
              name: (row && row.name) || null
            });
          } catch (e) {
            showToast(e.message || 'Не удалось открыть чат');
          }
          return;
        }
        showToast('Контакт недоступен');
      };
    });
  }

  function applyFxMode(mode) {
    const allowed = { full: 1, reduced: 1, off: 1 };
    let stored = null;
    try {
      // F0: DS key hg_power_saving; one-time migrate from ROUND-7 hg_fx
      stored = localStorage.getItem('hg_power_saving');
      if (!stored) {
        const legacy = localStorage.getItem('hg_fx');
        if (legacy && allowed[legacy]) {
          stored = legacy;
          localStorage.setItem('hg_power_saving', legacy);
          localStorage.removeItem('hg_fx');
        }
      }
    } catch (_) {}
    let fx = allowed[mode] ? mode : (allowed[stored] ? stored : 'full');
    if (!allowed[fx]) fx = 'full';
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches && fx === 'full') {
        fx = 'reduced';
      }
    } catch (_) {}
    const dock = (root && root.id === 'huginnDock' ? root : null) || document.getElementById('huginnDock');
    if (dock) {
      dock.classList.remove('hg-power-full', 'hg-power-reduced', 'hg-power-off');
      dock.classList.add('hg-power-' + fx);
    }
    // Bridge: keep data-hg-fx for any leftover ROUND-7 selectors
    document.documentElement.setAttribute('data-hg-fx', fx);
    try { localStorage.setItem('hg_power_saving', fx); } catch (_) {}
    return fx;
  }

  /** Журнал звонков Хугинна (читаемый список вместо call_event-пузыря). */
  function renderCallsPanel(panel) {
    panel.innerHTML = `
      <div class="hg-panel-head">
        <h2>Звонки</h2>
        <button type="button" class="hg-icon-btn" data-collapse title="Свернуть">${ICO.close || '✕'}</button>
      </div>
      <div class="hg-calls" id="hgCallsList">
        <div class="hg-empty"><div class="hg-empty-s">Загрузка…</div></div>
      </div>`;
    panel.querySelector('[data-collapse]').onclick = () => setCollapsed(true);
    const listEl = panel.querySelector('#hgCallsList');
    api('/api/chat-groups/calls/history?limit=50').then((data) => {
      const calls = (data && data.calls) || [];
      if (!calls.length) {
        listEl.innerHTML = `<div class="hg-empty">${ICO.phone || ''}<h3>Звонков пока нет</h3><p>Аудио и видео звонки появятся здесь</p></div>`;
        return;
      }
      const fmtDur = (s) => {
        const n = Number(s) || 0;
        const m = Math.floor(n / 60);
        return m ? (m + ' мин ' + (n % 60) + ' с') : (n + ' с');
      };
      const fmtWhen = (iso) => {
        try {
          const d = new Date(iso);
          const today = new Date();
          const sameDay = d.toDateString() === today.toDateString();
          return sameDay
            ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
            : d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        } catch (_) { return ''; }
      };
      listEl.innerHTML = calls.map((c) => {
        const missed = c.missed && c.direction === 'in';
        const cls = missed ? ' is-missed' : '';
        const arrow = c.direction === 'out' ? '↗' : '↙';
        const kindIco = c.kind === 'video' ? '🎥' : '📞';
        const statusTxt = missed ? 'Пропущенный'
          : (c.status === 'ended' && c.answered_at ? fmtDur(c.duration_sec)
            : (c.status === 'declined' ? 'Отклонён' : (c.status === 'canceled' ? 'Отменён' : 'Завершён')));
        return `<button type="button" class="hg-call-row${cls}" data-cid="${c.chat_id || ''}" data-peer="${esc(c.peer_name)}">
          <div class="hg-call-ico">${kindIco}</div>
          <div class="hg-call-meta">
            <div class="hg-call-name">${esc(c.peer_name)}</div>
            <div class="hg-call-sub"><span class="hg-call-arrow">${arrow}</span>${esc(statusTxt)} · ${esc(fmtWhen(c.created_at))}</div>
          </div>
        </button>`;
      }).join('');
      listEl.querySelectorAll('.hg-call-row').forEach((el) => {
        el.onclick = () => {
          const cid = Number(el.getAttribute('data-cid'));
          if (cid > 0) { state.tab = 'huginn'; state.mobileNav = 'chats'; openChat(cid); }
        };
      });
    }).catch((e) => {
      listEl.innerHTML = `<div class="hg-empty"><div class="hg-empty-s">${esc(e.message || 'Не удалось загрузить')}</div></div>`;
    });
  }

  function renderSettingsPanel(panel) {
    const meLocal = (global.AsgardAuth && AsgardAuth.user) || JSON.parse(localStorage.getItem('asgard_user') || '{}');
    let me = meLocal;
    const name = me.name || me.full_name || me.login || 'Пользователь';
    const shortName = name.split(' ')[0] || name;
    const phone = me.phone || '—';
    const role = me.role || '—';
    const email = me.email || '—';
    const uname = me.username ? ('@' + me.username) : (me.login ? ('@' + me.login) : '—');
    const fx = applyFxMode(localStorage.getItem('hg_power_saving') || localStorage.getItem('hg_fx'));
    const quick = [
      { label: 'Мой профиль', ico: ICO.user || ICO.contacts || '👤', tone: 'is-red', set: 'profile' },
      { label: 'Избранное', ico: ICO.bookmark || ICO.pin || '🔖', tone: 'is-blue', set: 'favorites' },
      { label: 'Недавние звонки', ico: ICO.phone || ICO.calls || '📞', tone: 'is-green', set: 'calls' }
    ];
    const groups = [
      [
        { label: 'Уведомления и звуки', ico: ICO.bell || '🔔', tone: 'is-red' },
        { label: 'Конфиденциальность', ico: ICO.lock || '🔒', tone: 'is-grey' },
        { label: 'Данные и память', ico: ICO.database || ICO.file || '💾', tone: 'is-green' },
        { label: 'Оформление', ico: ICO.palette || ICO.settings || '🎨', tone: 'is-blue' }
      ],
      [
        { label: 'Энергосбережение', ico: ICO.battery || '🔋', tone: 'is-yellow', value: fx === 'off' ? 'Выкл.' : (fx === 'reduced' ? 'Меньше' : 'Полные') },
        { label: 'Язык', ico: ICO.languages || ICO.globe || '🌐', tone: 'is-purple', value: 'Русский' }
      ]
    ];
    const showProfile = !!state.settingsProfileOpen && !state.settingsEditOpen;
    const showEdit = !!state.settingsEditOpen;
    const quickTop = quick.slice(0, 1);
    const quickRest = quick.slice(1);
    const headTitle = showProfile ? 'Профиль' : shortName;
    const headBtn = showProfile ? 'Назад' : (showEdit ? 'Готово' : 'Изм.');
    panel.innerHTML = `
      <div class="hg-settings${showProfile || showEdit ? ' is-profile' : ' is-root'}">
        <div class="hg-settings-head">
          <strong class="hg-settings-title">${esc(headTitle)}</strong>
          <button type="button" class="hg-settings-edit" id="hgSettingsEdit">${headBtn}</button>
        </div>
        <div class="hg-settings-profile${!showProfile && !showEdit ? ' is-clickable' : ''}" id="hgSettingsProfileCard" role="${!showProfile && !showEdit ? 'button' : 'group'}" tabindex="${!showProfile && !showEdit ? '0' : '-1'}">
          <div class="hg-settings-av" style="background:${avatarColor(name)}">${esc(initials(name))}</div>
          <div class="hg-settings-name">${esc(name)}</div>
          <div class="hg-settings-sub"><span class="hg-settings-shield" aria-hidden="true">1</span>${esc(phone)} · ${esc(uname)}</div>
          ${!showProfile && !showEdit ? `<button type="button" class="hg-settings-photo-btn" id="hgSettingsPhoto">${ICO.camera || '📷'} Изменить фотографию</button>` : ''}
        </div>
        ${showProfile ? `
        <div class="hg-settings-card hg-glass hg-settings-profile-detail" data-role="card" id="hgMyProfileDetail">
          <div class="hg-settings-kv"><span class="hg-settings-k">Имя</span><span class="hg-settings-v">${esc(name)}</span></div>
          <div class="hg-settings-kv"><span class="hg-settings-k">Роль</span><span class="hg-settings-v">${esc(role)}</span></div>
          <div class="hg-settings-kv"><span class="hg-settings-k">Телефон</span><span class="hg-settings-v">${esc(phone)}</span></div>
          <div class="hg-settings-kv"><span class="hg-settings-k">Email</span><span class="hg-settings-v">${esc(email)}</span></div>
          <div class="hg-settings-kv"><span class="hg-settings-k">Логин</span><span class="hg-settings-v">${esc(uname)}</span></div>
        </div>` : ''}
        ${!showProfile && !showEdit ? `
        <div class="hg-settings-alert hg-glass" data-role="card">
          <div class="hg-settings-alert-head"><span class="hg-settings-alert-bang">!</span><strong class="hg-settings-alert-title">${esc(phone)} всё ещё Ваш номер?</strong></div>
          <div class="hg-settings-alert-body">Чтобы вы всегда могли войти в аккаунт, подтвердите номер. <button type="button" class="hg-settings-alert-link" id="hgSettingsPhoneMore">Подробнее</button></div>
          <button type="button" class="hg-settings-alert-action" data-phone-keep="1">Оставить ${esc(phone)}</button>
          <button type="button" class="hg-settings-alert-action" data-phone-change="1">Изменить номер</button>
        </div>
        <div class="hg-settings-card hg-glass" data-role="card">
          ${quickTop.map((it) => `<button type="button" class="hg-settings-row" data-set="${esc(it.set)}" data-label="${esc(it.label)}">
            <span class="hg-settings-ico ${it.tone}">${it.ico}</span>
            <span class="hg-settings-label">${esc(it.label)}</span>
            <span class="hg-settings-chev">${ICO.chevronRight || '›'}</span>
          </button>`).join('')}
        </div>
        <div class="hg-settings-card hg-glass" data-role="card">
          ${quickRest.map((it) => `<button type="button" class="hg-settings-row" data-set="${esc(it.set)}" data-label="${esc(it.label)}">
            <span class="hg-settings-ico ${it.tone}">${it.ico}</span>
            <span class="hg-settings-label">${esc(it.label)}</span>
            <span class="hg-settings-chev">${ICO.chevronRight || '›'}</span>
          </button>`).join('')}
        </div>
        ${groups.map((items) => `<div class="hg-settings-card hg-settings-card--secondary hg-glass" data-role="card">
          ${items.map((it) => `<button type="button" class="hg-settings-row" data-set="${esc(it.label)}">
            <span class="hg-settings-ico ${it.tone}">${it.ico}</span>
            <span class="hg-settings-label">${esc(it.label)}</span>
            ${it.value ? `<span class="hg-settings-value">${esc(it.value)}</span>` : ''}
            <span class="hg-settings-chev">${ICO.chevronRight || '›'}</span>
          </button>`).join('')}
        </div>`).join('')}` : ''}
        ${showEdit ? `
        <div class="hg-settings-card hg-glass" data-role="card">
          <div class="hg-settings-row hg-settings-row--static">
            <span class="hg-settings-ico is-yellow">${ICO.battery || '🔋'}</span>
            <span class="hg-settings-label">Эффекты</span>
          </div>
          <div class="hg-fx-toggle" role="group" aria-label="Эффекты">
            ${['full', 'reduced', 'off'].map((m) => {
              const labels = { full: 'Полные', reduced: 'Меньше', off: 'Выкл' };
              return `<button type="button" class="hg-fx-btn${fx === m ? ' is-active' : ''}" data-fx="${m}">${labels[m]}</button>`;
            }).join('')}
          </div>
        </div>
        <button type="button" class="hg-settings-logout" id="hgLogout">Выйти</button>` : ''}
      </div>`;
    panel.querySelectorAll('[data-fx]').forEach((btn) => {
      btn.onclick = () => {
        applyFxMode(btn.getAttribute('data-fx'));
        renderSettingsPanel(panel);
      };
    });
    const photoBtn = panel.querySelector('#hgSettingsPhoto');
    if (photoBtn) photoBtn.onclick = () => showToast('Смена фото — DEFER S31');
    panel.querySelectorAll('[data-phone-keep],[data-phone-change],#hgSettingsPhoneMore').forEach((btn) => {
      btn.onclick = () => {
        const card = panel.querySelector('.hg-settings-alert');
        if (card) card.remove();
        showToast(btn.getAttribute('data-phone-change') ? 'Смена номера' : 'Номер подтверждён');
      };
    });
    const logoutBtn = panel.querySelector('#hgLogout');
    if (logoutBtn) {
      logoutBtn.onclick = () => {
        if (!confirm('Выйти из аккаунта?')) return;
        try {
          localStorage.removeItem('asgard_token');
          localStorage.removeItem('auth_token');
        } catch (_) {}
        location.href = '/';
      };
    }
    const editBtn = panel.querySelector('#hgSettingsEdit');
    if (editBtn) {
      editBtn.onclick = () => {
        if (showProfile) {
          state.settingsProfileOpen = false;
          state.settingsEditOpen = false;
        } else if (showEdit) {
          state.settingsEditOpen = false;
          state.settingsProfileOpen = false;
        } else {
          state.settingsEditOpen = true;
          state.settingsProfileOpen = false;
        }
        renderSettingsPanel(panel);
      };
    }
    const profileCard = panel.querySelector('#hgSettingsProfileCard');
    if (profileCard && !showProfile && !showEdit) {
      const openProfileDetail = () => {
        state.settingsProfileOpen = true;
        state.settingsEditOpen = false;
        renderSettingsPanel(panel);
        enrichMyProfile(panel);
      };
      profileCard.onclick = (e) => {
        if (e.target.closest('#hgSettingsPhoto')) return;
        openProfileDetail();
      };
      profileCard.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfileDetail(); }
      };
    }
    panel.querySelectorAll('[data-set]').forEach((btn) => {
      btn.onclick = () => {
        const set = btn.getAttribute('data-set') || '';
        if (set === 'calls') { state.tab = 'calls'; state.mobileNav = 'calls'; renderPanel(); return; }
        if (set === 'favorites') { state.tab = 'huginn'; state.mobileNav = 'chats'; state.listTab = 'favorites'; renderPanel(); return; }
        if (set === 'profile') {
          state.settingsProfileOpen = true;
          state.settingsEditOpen = false;
          renderSettingsPanel(panel);
          enrichMyProfile(panel);
          return;
        }
        showToast(btn.getAttribute('data-label') || set || 'Настройки');
      };
    });
    if (showProfile) enrichMyProfile(panel);
  }

  async function enrichMyProfile(panel) {
    try {
      const data = await api('/api/users/me');
      const u = data.user || data;
      if (!u) return;
      try {
        const cur = JSON.parse(localStorage.getItem('asgard_user') || '{}');
        localStorage.setItem('asgard_user', JSON.stringify({ ...cur, ...u }));
      } catch (_) {}
      const detail = panel && panel.querySelector('#hgMyProfileDetail');
      if (!detail) return;
      const name = u.name || u.full_name || u.login || '—';
      const phone = u.phone || '—';
      const role = u.role || '—';
      const email = u.email || '—';
      const uname = u.login ? ('@' + u.login) : '—';
      detail.innerHTML = `
        <div class="hg-settings-kv"><span class="hg-settings-k">Имя</span><span class="hg-settings-v">${esc(name)}</span></div>
        <div class="hg-settings-kv"><span class="hg-settings-k">Роль</span><span class="hg-settings-v">${esc(role)}</span></div>
        <div class="hg-settings-kv"><span class="hg-settings-k">Телефон</span><span class="hg-settings-v">${esc(phone)}</span></div>
        <div class="hg-settings-kv"><span class="hg-settings-k">Email</span><span class="hg-settings-v">${esc(email)}</span></div>
        <div class="hg-settings-kv"><span class="hg-settings-k">Логин</span><span class="hg-settings-v">${esc(uname)}</span></div>`;
      const av = panel.querySelector('.hg-settings-av');
      const nm = panel.querySelector('.hg-settings-name');
      const sub = panel.querySelector('.hg-settings-sub');
      if (av) { av.style.background = avatarColor(name); av.textContent = initials(name); }
      if (nm) nm.textContent = name;
      if (sub) sub.innerHTML = `<span class="hg-settings-shield" aria-hidden="true">1</span>${esc(phone)} · ${esc(uname)}`;
    } catch (_) {}
  }

  function syncSendButton() {
    const input = root && root.querySelector('#hgInput');
    const send = root && root.querySelector('#hgSend');
    if (!input || !send) return;
    if (state.recording) {
      send.classList.remove('is-mic', 'is-send', 'is-ready');
      send.classList.add('is-recording');
      send.innerHTML = ICO.stop || ICO.square || ICO.close;
      send.setAttribute('aria-label', 'Остановить запись');
      send.title = 'Стоп';
      return;
    }
    const has = !!(input.value || '').trim() || !!state.pendingFile;
    const wasSend = send.classList.contains('is-send');
    // Mimir mode: always show send icon, never mic
    if (isMimirMode()) {
      send.classList.add('is-send');
      send.classList.remove('is-mic', 'is-recording');
      send.classList.toggle('is-ready', has);
      send.innerHTML = ICO.sendUp || ICO['arrow-up'] || ICO.send || '↑';
      send.setAttribute('aria-label', 'Отправить');
      send.title = 'Отправить';
      if (has && !wasSend) { send.style.animation = 'none'; void send.offsetWidth; send.style.animation = ''; }
      return;
    }
    send.classList.toggle('is-send', has);
    send.classList.toggle('is-mic', !has);
    send.classList.toggle('is-ready', has);
    send.classList.remove('is-recording');
    send.innerHTML = has ? (ICO.sendUp || ICO['arrow-up'] || ICO.send) : ICO.mic;
    send.setAttribute('aria-label', has ? 'Отправить' : 'Голосовое сообщение');
    send.title = has ? 'Отправить' : 'Голосовое';
    if (has && !wasSend) {
      send.style.animation = 'none';
      // reflow to retrigger enter animation
      void send.offsetWidth;
      send.style.animation = '';
    }
  }

  function showQuickReact(bubble) {
    if (!root || !bubble) return;
    root.querySelectorAll('.hg-quick-react').forEach((el) => el.remove());
    const mid = Number(bubble.getAttribute('data-mid'));
    if (!mid) return;
    const wrap = root.querySelector('.hg-msgs-wrap') || root.querySelector('.hg-thread');
    if (!wrap) return;
    const br = bubble.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'hg-quick-react hg-glass';
    el.setAttribute('data-role', 'menu');
    el.innerHTML = QUICK_EMOJI.map((e) => `<button type="button" data-qe="${e}">${e}</button>`).join('');
    wrap.appendChild(el);
    const left = Math.max(8, Math.min(br.left - wr.left + br.width / 2 - el.offsetWidth / 2, wr.width - el.offsetWidth - 8));
    const top = Math.max(8, br.top - wr.top - el.offsetHeight - 8);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.querySelectorAll('[data-qe]').forEach((btn) => {
      btn.onclick = () => toggleReaction(mid, btn.getAttribute('data-qe'));
    });
  }

  function openAttachMenu() {
    const existing = root && root.querySelector('.hg-attach-menu');
    if (existing) { existing.remove(); return; }
    clearFloats();
    const thread = root.querySelector('.hg-thread');
    if (!thread) return;
    const el = document.createElement('div');
    el.className = 'hg-attach-menu hg-glass';
    el.setAttribute('data-role', 'menu');
    el.setAttribute('role', 'menu');
    const mimirAttach = isMimirMode();
    el.innerHTML = `
      <button type="button" data-kind="image" role="menuitem">${ICO.image}<span>Фото</span></button>
      <button type="button" data-kind="file" role="menuitem">${ICO.file}<span>Файл</span></button>
      <button type="button" data-kind="document" role="menuitem">${ICO.file}<span>Документ</span></button>
      ${mimirAttach ? '' : `<button type="button" data-kind="voice" role="menuitem">${ICO.mic}<span>Голосовое</span></button>`}
      ${mimirAttach ? '' : `<button type="button" data-kind="circle" role="menuitem">${ICO.video || ICO.circle || '◎'}<span>Кружок</span></button>`}
    `;
    thread.appendChild(el);
    if (root) root.classList.add('is-composer-focus');
    el.querySelectorAll('[data-kind]').forEach((btn) => {
      btn.onclick = () => {
        const kind = btn.getAttribute('data-kind');
        el.remove();
        if (kind === 'voice') { recordMedia('voice'); return; }
        if (kind === 'circle') { recordMedia('circle'); return; }
        const file = root.querySelector('#hgFile');
        if (kind === 'image') file.accept = 'image/*';
        else file.accept = '*/*';
        file.click();
      };
    });
  }

  function wireThread(panel) {
    panel.querySelector('#hgBack').onclick = () => {
      state.chatId = null;
      state.replyTo = null;
      if (state.isMimirThread || state.tab === 'mimir') {
        state.isMimirThread = false;
        state.tab = 'huginn';
      }
      renderPanel();
    };
    const head = panel.querySelector('#hgThreadHead');
    const msgsBox = panel.querySelector('.hg-msgs');
    if (head && msgsBox) {
      const syncHeadScroll = () => {
        head.classList.toggle('is-scrolled', msgsBox.scrollTop > 8);
        const h = head.offsetHeight || 56;
        panel.querySelector('.hg-thread')?.style.setProperty('--hg-header-h', h + 'px');
        // TG iOS: back-badge = unread in OTHER chats (always while in thread), not current-thread scroll unread
        const badge = panel.querySelector('#hgBackBadge');
        if (badge) {
          const unreadAbove = state.chats.reduce((n, c) => {
            if (c.id === state.chatId) return n;
            return n + (Number(c.unread_count) || 0);
          }, 0);
          const show = unreadAbove > 0;
          badge.toggleAttribute('hidden', !show);
          if (show) {
            badge.textContent = unreadAbove > 99 ? '99+' : String(unreadAbove);
            badge.setAttribute('aria-label', unreadAbove + ' непрочитанных');
          }
        }
      };
      msgsBox.addEventListener('scroll', syncHeadScroll);
      syncHeadScroll();
      const badge = panel.querySelector('#hgBackBadge');
      if (badge) {
        badge.onclick = (e) => {
          e.stopPropagation();
          const first = msgsBox.querySelector('.hg-unread-sep') || msgsBox.querySelector('.hg-bubble');
          if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
      }
    }
    const pinEl = panel.querySelector('#hgPinBanner');
    if (pinEl) {
      const jumpPin = () => {
        const pin = state.pins && state.pins[0];
        const id = pinEl.getAttribute('data-pin-mid')
          || (pin && (pin.message_id || pin.id || (pin.message && pin.message.id)));
        const target = id && msgsBox && msgsBox.querySelector('.hg-bubble[data-mid="' + id + '"]');
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('is-pin-flash');
          setTimeout(() => target.classList.remove('is-pin-flash'), 1200);
        } else {
          showToast('Закреплённое сообщение не в текущей ленте');
        }
      };
      pinEl.onclick = jumpPin;
      pinEl.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpPin(); } };
    }
    const profileBtn = panel.querySelector('#hgThreadProfile');
    if (profileBtn) {
      profileBtn.onclick = () => { openChatProfile(); };
    }
    const replyClr = panel.querySelector('#hgReplyClear');
    if (replyClr) replyClr.onclick = () => setReplyTo(null);
    const sendBtn = panel.querySelector('#hgSend');
    sendBtn.onclick = () => {
      if (state.recording && state.recording.rec) {
        try { state.recording.rec.stop(); } catch (_) {}
        return;
      }
      if (sendBtn.classList.contains('is-send') || sendBtn.classList.contains('is-ready')) {
        if (state.pendingFile && state.pendingFile.file) {
          const f = state.pendingFile.file;
          state.pendingFile = null;
          uploadSelected(f);
          return;
        }
        sendText();
      } else {
        if (!isMimirMode()) recordMedia('voice');
      }
    };
    const input = panel.querySelector('#hgInput');
    let morphTimer = null;
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(140, input.scrollHeight) + 'px';
      syncAiComposerBtn();
      if (state.chatId) saveDraft(state.chatId, (input.value || '').trim());
      clearTimeout(morphTimer);
      morphTimer = setTimeout(() => syncSendButton(), 50);
    });
    if ((input.value || '').trim()) {
      input.style.height = 'auto';
      input.style.height = Math.min(140, input.scrollHeight) + 'px';
      syncSendButton();
    }
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    input.addEventListener('keydown', (e) => {
      // F12: iPad / desktop Cmd|Ctrl+Enter → send (always)
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        sendBtn.click();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        if (coarse || window.innerWidth <= 768) return; // mobile: newline
        e.preventDefault();
        sendBtn.click();
        return;
      }
      if (e.key === 'ArrowUp' && !(input.value || '').trim()) {
        e.preventDefault();
        editLastOwn();
      }
    });
    panel.querySelector('#hgAttach').onclick = openAttachMenu;
    panel.querySelector('#hgFile').onchange = () => {
      const file = panel.querySelector('#hgFile').files[0];
      if (!file) return;
      const isImg = /^image\//.test(file.type);
      if (isImg) {
        const url = URL.createObjectURL(file);
        state.pendingFile = { file, name: file.name, preview: url };
        renderPanel();
      } else {
        state.pendingFile = { file, name: file.name, preview: null };
        renderPanel();
      }
    };
    const clearAtt = panel.querySelector('#hgAttachClear');
    if (clearAtt) clearAtt.onclick = () => { state.pendingFile = null; renderPanel(); };
    const stickersBtn = panel.querySelector('#hgStickers');
    if (stickersBtn) stickersBtn.onclick = openStickers;
    const callBtn = panel.querySelector('#hgCallAudio');
    if (callBtn) callBtn.onclick = () => startHuginnCall('audio');
    const callVideoBtn = panel.querySelector('#hgCallVideo');
    if (callVideoBtn) callVideoBtn.onclick = () => startHuginnCall('video');
    const moreBtn = panel.querySelector('#hgThreadMore');
    if (moreBtn) {
      moreBtn.onclick = (ev) => {
        const el = document.createElement('div');
        el.className = 'hg-float hg-glass';
    el.setAttribute('data-role', 'menu');
        el.innerHTML = `<div class="hg-float-actions">
          <button type="button" data-a="invite">${ICO.invite}<span>Пригласить</span></button>
          <button type="button" data-a="video">${ICO.video}<span>Тинг</span></button>
          <button type="button" data-a="collapse">${ICO.close}<span>Свернуть</span></button>
        </div>`;
        placeFloat(el, ev.clientX, ev.clientY);
        el.onclick = (e) => {
          const a = e.target.closest('[data-a]') && e.target.closest('[data-a]').getAttribute('data-a');
          if (!a) return;
          clearFloats();
          if (a === 'invite') inviteSomeone();
          if (a === 'video') {
            if (typeof HuginnTing !== 'undefined' && HuginnTing.openOverlay) HuginnTing.openOverlay({ chatId: state.chatId });
            else location.hash = '#/ting';
          }
          if (a === 'collapse') setCollapsed(true);
        };
      };
    }
    const msgs = panel.querySelector('.hg-msgs');
    msgs.addEventListener('contextmenu', (e) => {
      const bubble = e.target.closest('.hg-bubble');
      if (!bubble || bubble.classList.contains('system')) return;
      e.preventDefault();
      openMsgMenu(Number(bubble.getAttribute('data-mid')), e.clientX, e.clientY);
    });
    msgs.addEventListener('dblclick', (e) => {
      const bubble = e.target.closest('.hg-bubble');
      if (!bubble || bubble.classList.contains('system')) return;
      toggleReaction(Number(bubble.getAttribute('data-mid')), '👍');
    });
    // B12 hover 400ms / long-press
    msgs.addEventListener('pointerover', (e) => {
      const bubble = e.target.closest('.hg-bubble');
      if (!bubble || bubble.classList.contains('system')) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => showQuickReact(bubble), 400);
    });
    msgs.addEventListener('pointerout', (e) => {
      if (!e.target.closest('.hg-bubble')) return;
      clearTimeout(hoverTimer);
    });
    let pressTimer = null;
    msgs.addEventListener('pointerdown', (e) => {
      const bubble = e.target.closest('.hg-bubble');
      if (!bubble || bubble.classList.contains('system')) return;
      pressTimer = setTimeout(() => showQuickReact(bubble), 450);
    });
    msgs.addEventListener('pointerup', () => clearTimeout(pressTimer));
    msgs.addEventListener('pointercancel', () => clearTimeout(pressTimer));
    msgs.addEventListener('scroll', () => {
      state.stickToBottom = isNearBottom(msgs, 40);
      updateScrollFab();
      root.querySelectorAll('.hg-quick-react').forEach((el) => el.remove());
    });
    const fab = panel.querySelector('#hgScrollFab');
    if (fab) fab.onclick = () => scrollMsgs(true);
    wireMsgInteractions(msgs);
    const stop = panel.querySelector('#hgRecStop');
    if (stop) stop.onclick = () => {
      if (state.recording && state.recording.rec && state.recording.rec.state === 'recording') {
        state.recording.discard = false;
        state.recording.rec.stop();
      }
    };
    const cancelRec = panel.querySelector('#hgRecCancel');
    if (cancelRec) cancelRec.onclick = () => {
      if (state.recording && state.recording.rec && state.recording.rec.state === 'recording') {
        state.recording.discard = true;
        state.recording.rec.stop();
      }
    };
    const lockRec = panel.querySelector('#hgRecLock');
    if (lockRec) lockRec.onclick = () => {
      if (!state.recording) return;
      state.recording.locked = !state.recording.locked;
      lockRec.classList.toggle('is-on', !!state.recording.locked);
      showToast(state.recording.locked ? 'Однократно' : 'Обычная запись');
    };
    const pauseRec = panel.querySelector('#hgRecPause');
    if (pauseRec) pauseRec.onclick = () => showToast('Пауза');
    const aiBtn = panel.querySelector('#hgAiEditorBtn');
    if (aiBtn) aiBtn.onclick = () => openAiEditorSheet();
    syncSendButton();
    syncAiComposerBtn();
    updateScrollFab();
    // Swipe-back (mobile): edge swipe right closes thread
    const thread = panel.querySelector('.hg-thread');
    if (thread && !thread._hgSwipe) {
      thread._hgSwipe = true;
      let sx = 0; let sy = 0; let tracking = false;
      thread.addEventListener('touchstart', (e) => {
        const t = e.changedTouches[0];
        if (!t || t.clientX > 28) { tracking = false; return; }
        sx = t.clientX; sy = t.clientY; tracking = true;
      }, { passive: true });
      thread.addEventListener('touchend', (e) => {
        if (!tracking) return;
        tracking = false;
        const t = e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - sx;
        const dy = Math.abs(t.clientY - sy);
        if (dx > 80 && dy < 60) {
          state.chatId = null;
          state.replyTo = null;
          haptic('tab');
          renderPanel();
        }
      }, { passive: true });
    }
  }

  async function editLastOwn() {
    const mine = [...state.messages].reverse().find((m) =>
      Number(m.user_id) === Number(myId()) && !m.is_system && (m.message_type || 'text') === 'text'
    );
    if (!mine) { showToast('Нет своего сообщения для правки'); return; }
    const next = prompt('Редактировать сообщение:', mine.message || mine.text || '');
    if (next == null) return;
    const data = await api('/api/chat-groups/' + state.chatId + '/messages/' + mine.id, {
      method: 'PUT',
      body: { text: next }
    });
    if (data && data.success !== false && !data.error) {
      mine.message = next;
      mine.edited_at = new Date().toISOString();
      renderMessagesIntoBox();
    } else {
      showToast(data.error || 'Не удалось сохранить');
    }
  }

  async function sendText() {
    const input = root.querySelector('#hgInput');
    const text = (input && input.value || '').trim();
    if (!text || !state.chatId) return;
    const msgs = root.querySelector('.hg-msgs');
    const wasAtBottom = msgs
      ? (msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 100)
      : true;
    input.value = '';
    input.style.height = 'auto';
    saveDraft(state.chatId, '');
    const reply = state.replyTo;
    state.replyTo = null;
    syncSendButton();
    haptic('send');
    const optimistic = {
      id: 'tmp-' + Date.now(),
      user_id: myId(),
      message: text,
      message_type: 'text',
      created_at: new Date().toISOString(),
      delivery_status: 'sending',
      reply_to_id: reply ? reply.id : null,
      reply_to: reply || null,
      reply_id: reply ? reply.id : null,
      reply_text: reply ? (reply.message || reply.text || '') : null,
      reply_user_name: reply ? (reply.user_name || peerLabelForUser(reply.user_id)) : null
    };
    optimistic._bounce = true;
    state.messages.push(optimistic);
    state.stickToBottom = wasAtBottom;
    renderPanel();
    // keep composer focused after send (nav stays hidden)
    requestAnimationFrame(() => {
      const inp = root && root.querySelector('#hgInput');
      if (inp) {
        inp.focus({ preventScroll: true });
        if (root) root.classList.add('is-composer-focus');
      }
      if (wasAtBottom) {
        const box = root && root.querySelector('.hg-msgs');
        if (box) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
      }
      const bub = root && root.querySelector('.hg-bubble[data-mid="' + optimistic.id + '"]');
      if (bub) setTimeout(() => { bub.classList.remove('is-bounce'); delete optimistic._bounce; }, 240);
    });
    const body = { text };
    if (reply && reply.id) body.reply_to_id = Number(reply.id);

    // ── Mimir AI path ─────────────────────────────────────────────
    if (isMimirMode()) {
      // Show AI-is-thinking placeholder
      const thinkingId = 'mimir-think-' + Date.now();
      const thinkingMsg = {
        id: thinkingId, user_id: 0, message: '…', message_type: 'text',
        created_at: new Date().toISOString(), is_mimir_bot: true, user_name: 'Мимир', _thinking: true
      };
      state.messages.push(thinkingMsg);
      const tBox = root && root.querySelector('.hg-msgs');
      if (tBox) { renderMessagesIntoBox(); if (wasAtBottom) tBox.scrollTo({ top: tBox.scrollHeight, behavior: 'smooth' }); }

      let data;
      try {
        data = await api('/api/chat-groups/' + state.chatId + '/mimir', { method: 'POST', body: { message: text } });
      } catch (e) {
        state.messages = state.messages.filter((m) => m.id !== thinkingId);
        optimistic._failed = true;
        optimistic.delivery_status = 'failed';
        haptic('error');
        renderMessagesIntoBox();
        showToast(e.message || 'Ошибка связи с Мимиром');
        return;
      }

      // Remove thinking bubble
      state.messages = state.messages.filter((m) => m.id !== thinkingId);

      if (data.user_message || data.mimir_message) {
        state.messages = state.messages.filter((m) => m.id !== optimistic.id);
        const userMsg = data.user_message;
        const aiMsg = data.mimir_message;
        if (userMsg && userMsg.id && !state.knownMsgIds.has(Number(userMsg.id))) {
          state.knownMsgIds.add(Number(userMsg.id));
          state.messages.push(Object.assign({}, userMsg, { delivery_status: 'delivered' }));
        }
        if (aiMsg) {
          const normalized = Object.assign({}, aiMsg, {
            is_mimir: true, is_mimir_bot: true, user_id: 0,
            user_name: aiMsg.user_name || 'Мимир', delivery_status: 'delivered'
          });
          if (normalized.id && !state.knownMsgIds.has(Number(normalized.id))) {
            state.knownMsgIds.add(Number(normalized.id));
            state.messages.push(normalized);
          }
        }
      } else if (data.error) {
        optimistic._failed = true;
        optimistic.delivery_status = 'failed';
        haptic('error');
        renderMessagesIntoBox();
        showToast(data.error || 'Мимир не ответил');
        return;
      }

      renderPanel();
      requestAnimationFrame(() => {
        const inp = root && root.querySelector('#hgInput');
        if (inp) { inp.focus({ preventScroll: true }); if (root) root.classList.add('is-composer-focus'); }
        if (wasAtBottom) { const box = root && root.querySelector('.hg-msgs'); if (box) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); }
      });
      return;
    }
    // ── Regular chat path ─────────────────────────────────────────
    const data = await api('/api/chat-groups/' + state.chatId + '/messages', {
      method: 'POST',
      body
    });
    if (data.message) {
      state.messages = state.messages.filter((m) => m.id !== optimistic.id);
      if (!state.knownMsgIds.has(data.message.id)) {
        state.knownMsgIds.add(data.message.id);
        data.message.delivery_status = data.message.is_read ? 'read' : 'delivered';
        state.messages.push(data.message);
      }
      renderPanel();
      requestAnimationFrame(() => {
        const inp = root && root.querySelector('#hgInput');
        if (inp) {
          inp.focus({ preventScroll: true });
          if (root) root.classList.add('is-composer-focus');
        }
        if (wasAtBottom) {
          const box = root && root.querySelector('.hg-msgs');
          if (box) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
        }
      });
    } else {
      optimistic._failed = true;
      optimistic.delivery_status = 'failed';
      haptic('error');
      renderMessagesIntoBox();
      showToast(data.error || 'Не удалось отправить');
    }
  }

  async function uploadSelected(file, messageType) {
    if (!file || !state.chatId) return;
    const fd = new FormData();
    fd.append('file', file, file.name || (messageType === 'circle' ? 'circle.webm' : file.name));
    if (messageType) fd.append('message_type', messageType);
    const res = await fetch('/api/chat-groups/' + state.chatId + '/upload-file', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token() },
      body: fd
    });
    const data = await res.json();
    if (data.message && !state.knownMsgIds.has(data.message.id)) {
      state.knownMsgIds.add(data.message.id);
      state.messages.push(data.message);
      state.stickToBottom = true;
      renderPanel();
    }
  }

  function clearRecordingUi() {
    document.querySelectorAll('.hg-circle-record').forEach((el) => el.remove());
    if (state.recording && state.recording.timerId) {
      try { clearInterval(state.recording.timerId); } catch (_) {}
    }
  }

  function formatRecTimer(sec) {
    const totalMs = Math.max(0, Math.floor(sec * 100));
    const m = Math.floor(totalMs / 6000);
    const s = Math.floor((totalMs % 6000) / 100);
    const cs = totalMs % 100;
    return m + ':' + String(s).padStart(2, '0') + ',' + String(cs).padStart(2, '0');
  }

  function mountCircleOverlay(stream, onCancel, onSend) {
    document.querySelectorAll('.hg-circle-record').forEach((el) => el.remove());
    const overlay = document.createElement('div');
    overlay.className = 'hg-circle-record';
    overlay.setAttribute('data-role', 'circle-record');
    overlay.innerHTML = `
      <div class="hg-circle-stage">
        <video class="hg-circle-preview" playsinline muted autoplay></video>
        <div class="hg-circle-fallback" aria-hidden="true"></div>
      </div>
      <div class="hg-circle-chrome">
        <div class="hg-circle-bar">
          <button type="button" class="hg-circle-flip" id="hgCircleFlip" aria-label="Камера">↻</button>
          <button type="button" class="hg-circle-flash" id="hgCircleFlash" aria-label="Вспышка">⚡</button>
          <div class="hg-circle-mid">
            <span class="hg-rec-dot"></span>
            <span class="hg-rec-timer" id="hgCircleTimer">0:00,00</span>
            <button type="button" class="hg-circle-cancel" id="hgCircleCancel">Отмена</button>
          </div>
        </div>
        <div class="hg-circle-side">
          <button type="button" class="hg-rec-once" aria-label="1">1</button>
          <button type="button" class="hg-rec-pause" aria-label="Пауза">⏸</button>
          <button type="button" class="hg-circle-send" id="hgCircleSend" aria-label="Отправить">${ICO.sendUp || ICO['arrow-up'] || '↑'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const video = overlay.querySelector('video');
    if (video && stream) {
      video.srcObject = stream;
      try { video.play(); } catch (_) {}
      overlay.classList.add('has-stream');
    }
    overlay.querySelector('#hgCircleCancel').onclick = () => onCancel && onCancel();
    overlay.querySelector('#hgCircleSend').onclick = () => onSend && onSend();
    return overlay;
  }

  async function recordMedia(kind) {
    try {
      clearRecordingUi();
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'circle' ? { audio: true, video: { facingMode: 'user' } } : { audio: true }
      );
      const mime = kind === 'circle'
        ? (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm')
        : (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm');
      const rec = new MediaRecorder(stream, { mimeType: mime });
      const chunks = [];
      let cancelled = false;
      let startedAt = Date.now();
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearRecordingUi();
        document.body.classList.remove('hg-circle-recording');
        const was = state.recording;
        const discard = cancelled || !!(was && was.discard);
        state.recording = null;
        setRecordingChrome(false);
        renderPanel();
        if (was && was.timerId) {
          try { clearInterval(was.timerId); } catch (_) {}
        }
        if (discard || !chunks.length) return;
        const blob = new Blob(chunks, { type: mime });
        const file = new File([blob], kind === 'circle' ? 'circle.webm' : 'voice.webm', { type: mime });
        await uploadSelected(file, kind === 'circle' ? 'circle' : 'voice');
      };
      const stopRec = (asCancel) => {
        cancelled = !!asCancel;
        if (state.recording) state.recording.discard = cancelled;
        if (rec.state === 'recording') {
          try { rec.stop(); } catch (_) {}
        } else {
          stream.getTracks().forEach((t) => t.stop());
          clearRecordingUi();
          document.body.classList.remove('hg-circle-recording');
          state.recording = null;
          setRecordingChrome(false);
          renderPanel();
        }
      };
      rec.start(250);
      const timerId = setInterval(() => {
        if (!state.recording) return;
        const sec = (Date.now() - startedAt) / 1000;
        state.recording.elapsed = sec;
        state.recording.timerText = formatRecTimer(sec);
        const tEl = document.querySelector('#hgRecTimer, #hgCircleTimer');
        if (tEl) tEl.textContent = state.recording.timerText;
      }, 200);
      state.recording = {
        rec,
        kind,
        locked: false,
        label: kind === 'circle' ? 'Запись кружка…' : 'Запись голоса…',
        timerText: '0:00',
        elapsed: 0,
        timerId,
        cancel: () => stopRec(true),
        send: () => stopRec(false)
      };
      setRecordingChrome(true);
      if (kind === 'circle') {
        mountCircleOverlay(stream, () => stopRec(true), () => stopRec(false));
        document.body.classList.add('hg-circle-recording');
      } else {
        renderPanel();
      }
      setTimeout(() => {
        if (state.recording && state.recording.rec === rec && rec.state === 'recording') stopRec(false);
      }, kind === 'circle' ? 15000 : 60000);
    } catch (e) {
      clearRecordingUi();
      state.recording = null;
      setRecordingChrome(false);
      document.body.classList.remove('hg-circle-recording');
      alert('Нет доступа к микрофону/камере: ' + e.message);
    }
  }

  async function openStickers() {
    const smile = root && root.querySelector('#hgStickers');
    const existing = root && root.querySelector('.hg-sheet-stickers');
    if (existing) {
      existing.remove();
      if (smile) smile.classList.remove('is-open');
      return;
    }
    clearFloats();
    const FALLBACK = ['👍', '❤️', '🔥', '👏', '😂', '🎉', '✅', '🚀', '💼', '📌', '🎯', '⭐'];
    const sheet = document.createElement('div');
    sheet.className = 'hg-sheet hg-sheet-stickers hg-glass';
    sheet.setAttribute('data-role', 'menu');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Эмодзи');
    const emojiGrid = FALLBACK.map((e) =>
      `<button type="button" class="hg-sticker-emoji" data-emoji="${e}" title="${e}">${e}</button>`
    ).join('');
    sheet.innerHTML = `<div class="hg-sticker-label">Эмодзи</div><div class="hg-sticker-grid" data-sticker-grid="1" data-emoji-grid="1">${emojiGrid}</div><button type="button" class="hg-sheet-close" data-close>Закрыть</button>`;
    const thread = root.querySelector('.hg-thread');
    if (!thread) return;
    thread.appendChild(sheet);
    if (smile) smile.classList.add('is-open');
    if (root) root.classList.add('is-composer-focus');
    sheet.querySelector('[data-close]').onclick = () => {
      sheet.remove();
      if (smile) smile.classList.remove('is-open');
    };
    sheet.querySelectorAll('[data-emoji]').forEach((btn) => {
      btn.onclick = async () => {
        const emoji = btn.getAttribute('data-emoji');
        const data2 = await api('/api/chat-groups/' + state.chatId + '/messages', {
          method: 'POST',
          body: { text: emoji, message_type: 'sticker' }
        });
        if (data2.message || data2.id) {
          const msg = data2.message || data2;
          state.knownMsgIds.add(Number(msg.id));
          state.messages.push(msg);
          state.stickToBottom = true;
          renderPanel();
        }
        sheet.remove();
        if (smile) smile.classList.remove('is-open');
      };
    });
  }

  function clearFloats() {
    if (!root) return;
    root.querySelectorAll('.hg-float, .hg-sheet, .hg-attach-menu, .hg-compose-sheet, .hg-chat-profile, .hg-ai-sheet').forEach((el) => el.remove());
    const smile = root.querySelector('#hgStickers');
    if (smile) smile.classList.remove('is-open');
  }

  function placeFloat(el, clientX, clientY) {
    const thread = root.querySelector('.hg-thread');
    if (!thread) return;
    clearFloats();
    thread.appendChild(el);
    const rect = thread.getBoundingClientRect();
    let left = clientX - rect.left - 20;
    let top = clientY - rect.top - 20;
    left = Math.max(8, Math.min(left, rect.width - 220));
    top = Math.max(8, Math.min(top, rect.height - 160));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  async function toggleReaction(messageId, emoji, btnEl) {
    if (!messageId || !emoji || !state.chatId) return;
    const data = await api('/api/chat-groups/' + state.chatId + '/messages/' + messageId + '/reaction', {
      method: 'POST',
      body: { emoji }
    });
    const msg = state.messages.find((m) => Number(m.id) === Number(messageId));
    if (msg) {
      if (data && data.reactions && typeof data.reactions === 'object') {
        msg.reactions = data.reactions;
      } else {
        const uid = myId();
        msg.reactions = Object.assign({}, msg.reactions || {});
        let arr = Array.isArray(msg.reactions[emoji]) ? msg.reactions[emoji].slice() : [];
        const idx = arr.findIndex((x) => Number(x) === Number(uid));
        if (idx >= 0) arr.splice(idx, 1);
        else arr.push(uid);
        if (!arr.length) delete msg.reactions[emoji];
        else msg.reactions[emoji] = arr;
      }
      const uid = myId();
      msg.my_reactions = Object.keys(msg.reactions || {}).filter((k) => reactionHasMe(msg.reactions[k], uid));
    }
    if (btnEl) {
      btnEl.classList.add('is-pop');
      setTimeout(() => btnEl.classList.remove('is-pop'), 320);
    }
    clearFloats();
    root && root.querySelectorAll('.hg-quick-react').forEach((el) => el.remove());
    renderMessagesIntoBox();
  }

  function openReactions(messageId, x, y) {
    const el = document.createElement('div');
    el.className = 'hg-float hg-glass';
    el.setAttribute('data-role', 'menu');
    const emojis = ['👍', '❤️', '🔥', '👏', '😂', '👀', '✅', '❗'];
    el.innerHTML = `<div class="hg-float-grid">${emojis.map((e) =>
      `<button type="button" data-e="${e}">${e}</button>`
    ).join('')}</div>`;
    placeFloat(el, x, y);
    el.querySelectorAll('[data-e]').forEach((btn) => {
      btn.onclick = () => toggleReaction(messageId, btn.getAttribute('data-e'));
    });
  }

  function openMsgMenu(messageId, x, y) {
    const pinnedIds = new Set((state.pins || []).map((p) => Number(p.message_id || (p.message && p.message.id))));
    const el = document.createElement('div');
    el.className = 'hg-float hg-glass';
    el.setAttribute('data-role', 'menu');
    el.innerHTML = `<div class="hg-float-actions">
      <button type="button" data-a="react">${ICO.smile}<span>Реакция</span></button>
      <button type="button" data-a="reply">${ICO.reply}<span>Ответить</span></button>
      <button type="button" data-a="pin">${ICO.pin || ICO.bookmark || '📌'}<span>${pinnedIds.has(Number(messageId)) ? 'Открепить' : 'Закрепить'}</span></button>
      <button type="button" data-a="forward">${ICO.forward}<span>Переслать</span></button>
      <button type="button" data-a="copy">${ICO.copy}<span>Копировать</span></button>
      <button type="button" class="danger" data-a="delete">${ICO.trash}<span>Удалить</span></button>
    </div>`;
    placeFloat(el, x, y);
    el.onclick = async (e) => {
      const btn = e.target.closest('[data-a]');
      if (!btn) return;
      const a = btn.getAttribute('data-a');
      const msg = state.messages.find((m) => Number(m.id) === Number(messageId));
      if (a === 'react') { openReactions(messageId, x, y); return; }
      if (a === 'pin') {
        try {
          if (pinnedIds.has(Number(messageId))) {
            await api('/api/chat-groups/' + state.chatId + '/pin/' + messageId, { method: 'DELETE' });
            state.pins = (state.pins || []).filter((p) => Number(p.message_id || (p.message && p.message.id)) !== Number(messageId));
            showToast('Откреплено');
          } else {
            await api('/api/chat-groups/' + state.chatId + '/pin/' + messageId, { method: 'POST', body: {} });
            const m = state.messages.find((x) => Number(x.id) === Number(messageId));
            state.pins = [{ message_id: Number(messageId), message: m || null }];
            showToast('Закреплено');
          }
          renderPanel();
        } catch (err) {
          showToast(err.message || 'Не удалось закрепить');
        }
        return;
      }
      if (a === 'copy' && msg) {
        try { await navigator.clipboard.writeText(humanizeDisplayText(msg.message || '', msg)); } catch (_) {}
      }
      if (a === 'delete' && msg) {
        await api('/api/chat-groups/' + state.chatId + '/messages/' + messageId, { method: 'DELETE' });
        state.messages = state.messages.filter((m) => Number(m.id) !== Number(messageId));
        renderPanel();
        return;
      }
      if (a === 'forward' && msg) {
        const target = prompt('ID чата для пересылки:');
        if (target) {
          await api('/api/chat-groups/' + state.chatId + '/messages/' + messageId + '/forward', {
            method: 'POST',
            body: { target_chat_id: Number(target) }
          });
        }
      }
      if (a === 'reply' && msg) {
        setReplyTo(msg);
      }
      clearFloats();
    };
  }

  async function openInviteSheet(opts) {
    clearFloats();
    const preset = opts || {};
    root.querySelectorAll('.hg-invite-sheet').forEach((el) => el.remove());
    const host = sheetHost();
    const el = document.createElement('div');
    el.className = 'hg-invite-sheet hg-sheet hg-compose-sheet';
    el.setAttribute('data-role', 'card');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Пригласить в Хугинн');
    el.innerHTML = `
      <div class="hg-compose-head">
        <button type="button" class="hg-icon-btn hg-compose-x" id="hgInviteClose" aria-label="Закрыть"><span aria-hidden="true">✕</span></button>
        <strong>Пригласить</strong>
        <span style="width:32px"></span>
      </div>
      <div class="hg-invite-fields">
        <input id="hgInviteName" placeholder="Имя (необязательно)" autocomplete="name" value="${esc(preset.name || '')}" />
        <input id="hgInvitePhone" placeholder="Телефон" inputmode="tel" autocomplete="tel" />
        <input id="hgInviteEmail" placeholder="Email" inputmode="email" autocomplete="email" />
      </div>
      <div class="hg-invite-modes" role="tablist" aria-label="Куда отправить">
        <button type="button" class="hg-compose-mode is-active" data-ich="email" role="tab" aria-selected="true">На почту</button>
        <button type="button" class="hg-compose-mode" data-ich="sms" role="tab" aria-selected="false">По SMS</button>
        <button type="button" class="hg-compose-mode" data-ich="none" role="tab" aria-selected="false">Только ссылка</button>
      </div>
      <button type="button" class="hg-invite-submit" id="hgInviteSubmit">Отправить приглашение</button>
      <div class="hg-invite-result" id="hgInviteResult" hidden></div>`;
    host.appendChild(el);
    el.querySelector('#hgInviteClose').onclick = () => el.remove();
  let channel = 'email';
  el.querySelectorAll('[data-ich]').forEach((btn) => {
    btn.onclick = () => {
      channel = btn.getAttribute('data-ich');
      el.querySelectorAll('[data-ich]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      const needEmail = channel === 'email';
      const needPhone = channel === 'sms';
      el.querySelector('#hgInviteEmail').style.opacity = needPhone ? '0.5' : '1';
      el.querySelector('#hgInvitePhone').style.opacity = needEmail ? '0.5' : '1';
    };
  });
    const submit = el.querySelector('#hgInviteSubmit');
    const resultBox = el.querySelector('#hgInviteResult');
    const showResult = (fullUrl, delivery) => {
      const sentText = delivery && delivery.sent
        ? (delivery.channel === 'email' ? 'Письмо отправлено на ' + esc(delivery.to)
          : 'SMS отправлено на ' + esc(delivery.to))
        : (delivery && delivery.error ? ('Отправка не удалась: ' + esc(delivery.error)) : 'Ссылка готова');
      resultBox.hidden = false;
      resultBox.innerHTML = `<div class="hg-invite-result-text">${sentText}</div>
        <a class="hg-invite-download" href="${esc(fullUrl)}" download="huginn-invite.txt" target="_blank" rel="noopener">Скачать ссылку</a>
        <button type="button" class="hg-invite-copy" id="hgInviteCopy">Скопировать</button>`;
      const copy = resultBox.querySelector('#hgInviteCopy');
      if (copy) copy.onclick = async () => {
        try { await navigator.clipboard.writeText(fullUrl); showToast('Ссылка скопирована'); } catch (_) {}
      };
      resultBox.querySelector('.hg-invite-download').onclick = () => {
        try { URL.revokeObjectURL(resultBox.dataset.blob || ''); } catch (_) {}
      };
      // make the download a real blob so "скачать ссылку" works offline too
      try {
        const blob = new Blob([fullUrl + '\n'], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        resultBox.dataset.blob = url;
        resultBox.querySelector('.hg-invite-download').setAttribute('href', url);
      } catch (_) {}
    };
    submit.onclick = async () => {
      const phone = (el.querySelector('#hgInvitePhone').value || '').trim();
      const email = (el.querySelector('#hgInviteEmail').value || '').trim();
      const displayName = (el.querySelector('#hgInviteName').value || '').trim() || phone || email || null;
      if (channel === 'email' && !email) { showToast('Укажите email'); return; }
      if (channel === 'sms' && !phone) { showToast('Укажите телефон'); return; }
      if (channel === 'none' && !phone && !email) { showToast('Укажите телефон или email'); return; }
      submit.disabled = true;
      try {
        const body = { phone: phone || null, email: email || null, display_name: displayName, channel };
        if (opts && opts.chatId) body.chat_id = opts.chatId;
        else if (state.chatId) body.chat_id = state.chatId;
        const data = await api('/api/chat-groups/invites', { method: 'POST', body });
        if (data.full_url) {
          showResult(data.full_url, data.delivery);
          showToast(data.delivery && data.delivery.sent ? 'Приглашение отправлено' : 'Ссылка готова');
          submit.disabled = false;
        } else {
          showToast(data.error || 'Не удалось создать приглашение');
          submit.disabled = false;
        }
      } catch (e) {
        showToast(e.message || 'Ошибка приглашения');
        submit.disabled = false;
      }
    };
  }

  async function inviteSomeone() {
    await openInviteSheet({ chatId: state.chatId || null });
  }

  /* F11 AI Editor sheet — /api/chat-groups/ai/* (not Mimir) */
  async function openAiEditorSheet() {
    const input = root && root.querySelector('#hgInput');
    const original = (input && input.value) || '';
    if (countComposerLines(original) < 4) {
      showToast('ИИ-редактор: наберите больше 3 строк');
      return;
    }
    clearFloats();
    root.querySelectorAll('.hg-ai-sheet,.hg-ai-style-sheet').forEach((el) => el.remove());
    let styles = { presets: [], custom: [] };
    try {
      styles = await api('/api/chat-groups/ai/styles');
    } catch (_) {}
    const el = document.createElement('div');
    el.className = 'hg-ai-sheet hg-sheet hg-glass';
    el.setAttribute('data-role', 'card');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'ИИ-редактор');
    const tabIco = {
      translate: ICO.languages || ICO.globe || '🌐',
      style: ICO.wand || ICO.sparkles || '✨',
      grammar: ICO.check || ICO['check-circle'] || '✓'
    };
    const genBtn = `<button type="button" class="hg-ai-style" data-style="clarify"><span class="hg-ai-style-ico">💬</span><span>Генерация</span></button>`;
    const createBtn = `<button type="button" class="hg-ai-style" data-new-style="1"><span class="hg-ai-style-ico">✨</span><span>Создать</span></button>`;
    const presetOrder = ['formal', 'viking', 'short', 'tribal', 'corp', 'zen', 'biblical', 'friendly', 'clarify'];
    const presets = styles.presets || [];
    const byId = Object.fromEntries(presets.map((s) => [s.id, s]));
    const ordered = presetOrder.map((id) => byId[id]).filter(Boolean)
      .concat(presets.filter((s) => !presetOrder.includes(s.id)));
    const presetHtml = ordered.map((s) =>
      `<button type="button" class="hg-ai-style" data-style="${esc(s.id)}"><span class="hg-ai-style-ico">${esc(s.icon_emoji || '✦')}</span><span>${esc(s.name)}</span></button>`
    ).join('');
    const customHtml = (styles.custom || []).map((s) =>
      `<button type="button" class="hg-ai-style" data-style-id="${s.id}"><span class="hg-ai-style-ico">${esc(s.icon_emoji || '✦')}</span><span>${esc(s.name)}</span></button>`
    ).join('');
    el.innerHTML = `
      <div class="hg-ai-sheet-head">
        <button type="button" class="hg-ai-close hg-ai-close--circle" aria-label="Закрыть"><span aria-hidden="true">✕</span></button>
        <strong>ИИ-редактор</strong>
        <span class="hg-ai-info hg-ai-close--circle" title="Обработка на сервере CRM, тексты не используются для обучения моделей">ⓘ</span>
      </div>
      <div class="hg-ai-tabs" role="tablist">
        <button type="button" class="hg-ai-tab" data-tab="translate"><span class="hg-ai-tab-ico">${tabIco.translate}</span><span>Перевод</span></button>
        <button type="button" class="hg-ai-tab is-active" data-tab="style"><span class="hg-ai-tab-ico">${tabIco.style}</span><span>Стилизация</span></button>
        <button type="button" class="hg-ai-tab" data-tab="grammar"><span class="hg-ai-tab-ico">${tabIco.grammar}</span><span>Исправление</span></button>
      </div>
      <div class="hg-ai-body">
        <div class="hg-ai-pane" data-pane="translate" hidden>
          <div class="hg-ai-label-row"><span>Оригинал: русский</span>
            <button type="button" class="hg-ai-link" data-expand-orig="1">развернуть</button>
          </div>
          <div class="hg-ai-orig">${esc(original)}</div>
          <label class="hg-ai-label hg-ai-lang-row">Перевод
            <select id="hgAiLang" class="hg-ai-lang"><option value="английский">английский</option><option value="немецкий">немецкий</option><option value="китайский">китайский</option></select>
          </label>
        </div>
        <div class="hg-ai-pane" data-pane="style">
          <div class="hg-ai-styles">${genBtn}${createBtn}${presetHtml}${customHtml}</div>
          <input type="text" class="hg-ai-field hg-ai-field--pill" id="hgAiStylePrompt" placeholder="Генерация текста, формул, таблиц…" maxlength="500" readonly value="">
        </div>
        <div class="hg-ai-pane" data-pane="grammar" hidden>
          <div class="hg-ai-label-row"><span>Оригинал</span>
            <button type="button" class="hg-ai-link" data-expand-orig="1">развернуть</button>
          </div>
          <div class="hg-ai-orig">${esc(original)}</div>
        </div>
        <div class="hg-ai-result-box">
          <div class="hg-ai-label-row"><span>Результат</span>
            <div class="hg-ai-result-tools">
              <label class="hg-ai-emoji-tog hg-ai-emoji-radio"><input type="checkbox" id="hgAiEmoji"> <span class="hg-ai-radio"></span> Эмодзи</label>
              <button type="button" class="hg-ai-tool-btn" id="hgAiCopy" title="Копировать" aria-label="Копировать"><span aria-hidden="true">⧉</span></button>
            </div>
          </div>
          <div class="hg-ai-result" id="hgAiResult"></div>
          <div class="hg-ai-error" id="hgAiError" hidden></div>
        </div>
      </div>
      <div class="hg-ai-actions">
        <button type="button" class="hg-ai-primary hg-ai-primary--pill" id="hgAiRun">Сгенерировать</button>
        <button type="button" class="hg-ai-round" id="hgAiRefresh" title="Повторить" aria-label="Повторить">${ICO.refresh || ICO.rotate || '↻'}</button>
        <button type="button" class="hg-ai-primary hg-ai-primary--pill" id="hgAiApply" hidden>Применить</button>
        <button type="button" class="hg-ai-round" id="hgAiSend" hidden title="Отправить">${ICO.send || '➤'}</button>
      </div>`;
    const thread = root.querySelector('.hg-thread') || root;
    thread.appendChild(el);
    let tab = 'style';
    let styleId = 'formal';
    let lastOut = '';
    const setTab = (t) => {
      tab = t;
      el.querySelectorAll('.hg-ai-tab').forEach((b) => b.classList.toggle('is-active', b.getAttribute('data-tab') === t));
      el.querySelectorAll('.hg-ai-pane').forEach((p) => { p.hidden = p.getAttribute('data-pane') !== t; });
    };
    el.querySelectorAll('.hg-ai-tab').forEach((b) => { b.onclick = () => setTab(b.getAttribute('data-tab')); });
    el.querySelector('.hg-ai-close').onclick = () => el.remove();
    el.querySelectorAll('.hg-ai-style').forEach((b) => {
      b.onclick = async () => {
        if (b.getAttribute('data-new-style')) {
          openNewStyleSheet(async (created) => {
            if (created && created.style) {
              styleId = String(created.style.id);
              showToast('Стиль создан');
              el.remove();
              openAiEditorSheet();
            }
          });
          return;
        }
        el.querySelectorAll('.hg-ai-style').forEach((x) => x.classList.remove('is-active'));
        b.classList.add('is-active');
        styleId = b.getAttribute('data-style-id') || b.getAttribute('data-style') || 'formal';
      };
    });
    const runBtn = el.querySelector('#hgAiRun');
    const applyBtn = el.querySelector('#hgAiApply');
    const sendBtn = el.querySelector('#hgAiSend');
    const refreshBtn = el.querySelector('#hgAiRefresh');
    const resultEl = el.querySelector('#hgAiResult');
    const errEl = el.querySelector('#hgAiError');
    const copyBtn = el.querySelector('#hgAiCopy');
    el.querySelectorAll('[data-expand-orig]').forEach((b) => {
      b.onclick = () => {
        el.querySelectorAll('.hg-ai-orig').forEach((o) => o.classList.toggle('is-expanded'));
      };
    });
    const runRewrite = async () => {
      runBtn.disabled = true;
      if (refreshBtn) refreshBtn.disabled = true;
      resultEl.textContent = '…';
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
      try {
        const body = {
          text: original,
          mode: tab === 'translate' ? 'translate' : (tab === 'style' ? 'style' : 'grammar'),
          emoji: !!(el.querySelector('#hgAiEmoji') && el.querySelector('#hgAiEmoji').checked)
        };
        if (body.mode === 'translate') body.target_lang = el.querySelector('#hgAiLang').value;
        if (body.mode === 'style') body.style_id = styleId;
        const data = await api('/api/chat-groups/ai/rewrite', { method: 'POST', body });
        if (data.error || (!data.text && data.ok === false)) {
          throw new Error(data.error || 'ИИ недоступен');
        }
        lastOut = data.text || '';
        resultEl.textContent = lastOut;
        /* After result: Применить (primary) + round send; refresh stays for retry */
        if (lastOut) {
          runBtn.hidden = true;
          applyBtn.hidden = false;
          sendBtn.hidden = false;
          if (refreshBtn) refreshBtn.hidden = true;
        } else {
          runBtn.hidden = false;
          applyBtn.hidden = true;
          sendBtn.hidden = true;
          if (refreshBtn) refreshBtn.hidden = false;
        }
      } catch (e) {
        lastOut = '';
        resultEl.textContent = '';
        applyBtn.hidden = true;
        sendBtn.hidden = true;
        runBtn.hidden = false;
        runBtn.textContent = 'Сгенерировать';
        if (refreshBtn) refreshBtn.hidden = false;
        const msg = e.message || 'Ошибка ИИ';
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = msg + ' — нажмите «Повторить»';
        } else {
          resultEl.textContent = msg;
        }
        showToast(msg);
      }
      runBtn.disabled = false;
      if (refreshBtn) refreshBtn.disabled = false;
    };
    runBtn.onclick = runRewrite;
    if (refreshBtn) refreshBtn.onclick = runRewrite;
    if (copyBtn) {
      copyBtn.onclick = async () => {
        if (!lastOut) return;
        try {
          await navigator.clipboard.writeText(lastOut);
          showToast('Скопировано');
        } catch (_) {
          showToast('Не удалось скопировать');
        }
      };
    }
    applyBtn.onclick = () => {
      if (!input || !lastOut) return;
      input.value = lastOut;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      el.remove();
    };
    sendBtn.onclick = () => {
      if (!input || !lastOut) return;
      input.value = lastOut;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      el.remove();
      const send = root.querySelector('#hgSend');
      if (send) send.click();
    };
  }

  function openNewStyleSheet(onCreated) {
    root.querySelectorAll('.hg-ai-style-sheet').forEach((el) => el.remove());
    const el = document.createElement('div');
    el.className = 'hg-ai-style-sheet hg-sheet hg-glass';
    el.setAttribute('data-role', 'card');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Новый стиль');
    el.innerHTML = `
      <div class="hg-ai-sheet-head">
        <button type="button" class="hg-ai-close hg-ai-close--circle" aria-label="Закрыть"><span aria-hidden="true">✕</span></button>
        <strong>Новый стиль</strong>
        <span style="width:36px"></span>
      </div>
      <div class="hg-ai-body hg-ai-body--new-style">
        <div class="hg-ai-style-avatar" aria-hidden="true"><span class="hg-ai-style-face">☺+</span></div>
        <input type="text" class="hg-ai-field hg-ai-field--pill" id="hgNewStyleName" placeholder="Название стиля (например, «Pirate»)" maxlength="64">
        <textarea class="hg-ai-field hg-ai-field-area hg-ai-field--pill" id="hgNewStylePrompt" placeholder="Инструкция (например: «Пиши как лихой пират. Используй слова «йо-хо-хо», «полундра», «приятель» и говори о сокровищах и море»)" rows="4" maxlength="4000"></textarea>
      </div>
      <div class="hg-ai-actions hg-ai-actions--stack">
        <label class="hg-ai-emoji-tog hg-ai-profile-tog hg-ai-emoji-radio" id="hgNewStylePublicRow">
          <input type="checkbox" id="hgNewStylePublic"> <span class="hg-ai-radio" aria-hidden="true"></span>
          <span>Со ссылкой на мой профиль</span>
        </label>
        <button type="button" class="hg-ai-primary hg-ai-primary--pill" id="hgNewStyleCreate">Создать</button>
      </div>`;
    const host = root.querySelector('.hg-thread') || root;
    host.appendChild(el);
    el.querySelector('.hg-ai-close').onclick = () => el.remove();
    el.querySelector('#hgNewStyleCreate').onclick = async () => {
      const name = (el.querySelector('#hgNewStyleName').value || '').trim();
      const promptText = (el.querySelector('#hgNewStylePrompt').value || '').trim();
      if (!name || !promptText) {
        showToast('Укажите название и инструкцию');
        return;
      }
      try {
        const created = await api('/api/chat-groups/ai/styles', {
          method: 'POST',
          body: { name, prompt: promptText, icon_emoji: '✦' }
        });
        const withProfile = !!(el.querySelector('#hgNewStylePublic') && el.querySelector('#hgNewStylePublic').checked);
        if (withProfile && created.style && created.style.id) {
          try {
            await api('/api/chat-groups/ai/styles/' + created.style.id + '/share', {
              method: 'POST',
              body: { with_profile_link: true }
            });
          } catch (_) {}
        }
        el.remove();
        if (typeof onCreated === 'function') onCreated(created);
      } catch (e) {
        showToast(e.message || 'Ошибка создания стиля');
      }
    };
  }

  /* F11 AI Editor — chips removed (visual wave) */

  /** 1:1 call via HuginnCall (LiveKit). Replaces the old PBX dial-to-phone path. */
  async function startHuginnCall(kind) {
    const chat = state.chats.find((c) => Number(c.id) === Number(state.chatId)) || {};
    if (isMimirMode() || isGroupChat(chat)) {
      showToast('Звонок доступен в личном чате');
      return;
    }
    if (!global.HuginnCall) {
      showToast('Звонки недоступны');
      return;
    }
    try {
      await global.HuginnCall.start(kind);
    } catch (e) {
      const msg = e && e.message ? e.message : 'Не удалось позвонить';
      showToast(msg.includes('занят') ? 'Трубка занята' : msg);
    }
  }

  function ingestMessage(msg, chatId) {
    if (!msg || msg.id == null) return false;
    const mid = Number(msg.id);
    const cid = Number(chatId || msg.chat_id);
    if (!Number.isFinite(mid)) return false;
    const chat = state.chats.find((c) => Number(c.id) === cid);
    if (chat) {
      chat.last_message = humanizeDisplayText(msg.message || '', msg);
      chat.last_message_at = msg.created_at;
      if (cid !== Number(state.chatId)) {
        chat.unread_count = (Number(chat.unread_count) || 0) + 1;
      }
    }
    if (cid === Number(state.chatId) && !state.knownMsgIds.has(mid)) {
      state.knownMsgIds.add(mid);
      state.messages.push(msg);
      const box = root && root.querySelector('.hg-msgs');
      if (box) {
        const near = isNearBottom(box, 40);
        renderMessagesIntoBox();
        if (near) scrollMsgs(true);
        else updateScrollFab();
      } else {
        renderPanel();
      }
      api('/api/chat-groups/' + cid + '/read', {
        method: 'POST',
        body: { last_message_id: mid }
      }).catch(() => {});
      return true;
    }
    if (!state.chatId) {
      renderChatList(root.querySelector('#hgSearch') && root.querySelector('#hgSearch').value);
      renderPresenceStrip();
    }
    return false;
  }

  function onLiveEvent(event, data) {
    if (event === 'chat:new_message' && data) {
      const msg = data.message || data;
      const chatId = data.chat_id || (msg && msg.chat_id);
      ingestMessage(msg, chatId);
    }
    if (event === 'chat:read' && data && Number(data.chat_id) === Number(state.chatId)) {
      state.messages.forEach((m) => {
        if (Number(m.user_id) === Number(myId()) && Number(m.id) <= Number(data.message_id)) m.is_read = true;
      });
      renderMessagesIntoBox();
    }
    if (event === 'chat:transcript_ready' && data && Number(data.chat_id) === Number(state.chatId)) {
      const m = state.messages.find((x) => Number(x.id) === Number(data.message_id));
      if (m) {
        m.metadata = Object.assign({}, m.metadata || {}, { transcript: data.transcript, transcript_status: 'done' });
        // Patch thread only — avoid full panel rebuild lag
        if (root && root.querySelector('.hg-msgs')) renderMessagesIntoBox();
        else renderPanel();
      }
    }
    if (event === 'presence:online' || event === 'presence:offline') {
      if (data && data.user_id) {
        // Socket event is only a fast hint. Do NOT fabricate last_seen_at from the
        // client clock (that was the «был(а) только что» mirage); keep the DB value
        // and let refreshPeerPresence() reconcile from the honest source.
        state.presence[data.user_id] = Object.assign({}, state.presence[data.user_id] || {}, {
          online: event === 'presence:online'
        });
        refreshPeerPresence();
        // Repaint the chat list so the online dot updates without reopening a chat.
        if (!state.chatId) renderPanel();
        else renderChatList(state.searchQ);
      }
    }
    if (event === 'chat:message_deleted' && data) {
      const mid = Number(data.message_id);
      if (!mid) return;
      const chat = state.chats.find((c) => Number(c.id) === Number(data.chat_id));
      if (chat && chat.last_message_id && Number(chat.last_message_id) === mid) chat.last_message = '';
      if (Number(data.chat_id) === Number(state.chatId)) {
        state.messages = state.messages.filter((m) => Number(m.id) !== mid);
        renderMessagesIntoBox();
      }
      renderChatList(state.searchQ);
    }
    if (event === 'chat:message_edited' && data) {
      const mid = Number(data.message_id);
      if (Number(data.chat_id) !== Number(state.chatId) || !mid) return;
      const m = state.messages.find((x) => Number(x.id) === mid);
      if (m) {
        m.message = data.message != null ? data.message : m.message;
        m.is_edited = true;
        renderMessagesIntoBox();
      }
    }
    if (event === 'chat:cleared' && data && Number(data.chat_id) === Number(state.chatId)) {
      state.messages = [];
      renderMessagesIntoBox();
    }
    if (event === 'chat:deleted' && data && data.chat_id != null) {
      state.chats = state.chats.filter((c) => Number(c.id) !== Number(data.chat_id));
      if (Number(data.chat_id) === Number(state.chatId)) closeChat();
      renderChatList(state.searchQ);
    }
  }

  /** Bulk presence map for the whole chat list + contacts (not just the open chat). */
  async function warmPresence() {
    try {
      const data = await api('/api/chat-groups/presence/all');
      (data.presence || []).forEach((p) => {
        state.presence[p.user_id] = Object.assign({}, state.presence[p.user_id] || {}, p);
      });
    } catch (_) {}
  }

  let _presenceTimer = null;
  function startPresencePolling() {
    if (_presenceTimer) return;
    _presenceTimer = setInterval(() => { warmPresence().then(() => {
      if (!state.chatId && state.tab === 'huginn') { renderChatList(state.searchQ); renderPresenceStrip(); }
    }); }, 30000);
  }

  let _mounting = null;
  async function mount() {
    if (!token()) return;
    if (_mounting) return _mounting;
    _mounting = (async () => {
      applyFxMode(localStorage.getItem('hg_power_saving') || localStorage.getItem('hg_fx'));
      ensureDom();
      // Parallel loaders must not take each other down: if chats 403/401 (guest
      // permission gap) the dock still has to render with an honest state.
      await Promise.allSettled([loadFolders(), loadChats(), loadStories(), loadBirthdays()]);
      syncRailBadge();
      try { await warmPresence(); } catch (_) {}
      renderPanel();
      if (global.HuginnSSE) {
        global.HuginnSSE.start();
        global.HuginnSSE.on('*', onLiveEvent);
      }
      if (global.HuginnCall) global.HuginnCall.mount();
      startPresencePolling();
    })().finally(() => { _mounting = null; });
    return _mounting;
  }

  function closeChat() {
    state.chatId = null;
    state.messages = [];
    state.settingsProfileOpen = false;
    state.settingsEditOpen = false;
    renderPanel();
  }

  global.HuginnDock = {
    mount,
    open: (tab) => {
      setCollapsed(false);
      if (tab && typeof tab === 'string') state.tab = tab;
      else state.tab = 'huginn';
      syncRailActive();
      renderPanel();
      notifyLayout();
    },
    collapse: () => setCollapsed(true),
    openTab,
    getTab: () => state.tab,
    getChatId: () => state.chatId,
    getState: () => state,
    isCollapsed: () => state.collapsed,
    isPanelOpen: (tab) => !!root && !state.collapsed && state.tab === tab,
    // Alias used by huginn_ting.js when polling the Ting panel. Without it the
    // 30s refresh exits immediately and the room list never updates.
    isTabOpen: (tab) => !!root && state.tab === tab,
    isUsable,
    setPhoneRail,
    openChat,
    closeChat,
    refreshOpenChat,
    _showQuickReact: showQuickReact,
    PANEL_W,
    /** Capture/SBS helpers — not for product UI */
    _capture: {
      getState: () => state,
      patchState: (fn) => { if (typeof fn === 'function') fn(state); },
      setTab: (tab) => { state.tab = tab; renderPanel(); },
      setMobileNav: (nav) => {
        state.mobileNav = nav;
        if (root) {
          root.querySelectorAll('[data-mnav]').forEach((b) => {
            b.classList.toggle('is-active', b.getAttribute('data-mnav') === nav);
          });
        }
        renderPanel();
      },
      rerender: () => renderPanel(),
      syncBadge: () => syncRailBadge(),
      /** Visual-only record chrome for capture (no MediaRecorder). */
      showRecChrome: (kind = 'voice') => {
        state.recording = {
          kind,
          locked: kind === 'voice',
          label: kind === 'circle' ? 'Запись кружка…' : 'Запись голоса…',
          timerText: kind === 'circle' ? '0:00,00' : '0:02,02',
          elapsed: kind === 'circle' ? 0 : 2.02,
          discard: false,
          rec: { state: 'recording', stop() {} },
          cancel: () => {},
          send: () => {}
        };
        setRecordingChrome(true);
        if (kind === 'circle') {
          mountCircleOverlay(null, () => {}, () => {});
          document.body.classList.add('hg-circle-recording');
        } else {
          renderPanel();
        }
      },
      clearRecChrome: () => {
        clearRecordingUi();
        document.body.classList.remove('hg-circle-recording');
        state.recording = null;
        setRecordingChrome(false);
        renderPanel();
      },
      /** Visual-only outgoing voice bubble for S07 capture. */
      showVoiceDemo: () => {
        const box = root && root.querySelector('.hg-msgs');
        if (!box) return;
        box.querySelectorAll('.hg-capture-voice').forEach((el) => el.remove());
        box.querySelectorAll('.hg-bubble').forEach((b) => { b.setAttribute('data-cap-hide', '1'); b.style.display = 'none'; });
        const pauseIco = ICO.pause || '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
        const el = document.createElement('div');
        el.className = 'hg-bubble me voice hg-capture-voice';
        el.setAttribute('data-mid', 'capture-voice');
        el.innerHTML = `<div class="hg-voice is-paused" data-voice-src="">
          <button type="button" class="hg-voice-play" aria-label="Пауза">${pauseIco}</button>
          <div class="hg-voice-wave" aria-hidden="true">${voiceWaveBars(11, { count: 52, played: 0.7 })}</div>
          <span class="hg-voice-dur">0:11</span>
        </div>
        <span class="hg-meta"><span class="hg-time">21:09</span><span class="hg-ticks is-read">✓✓</span></span>`;
        box.appendChild(el);
        el.scrollIntoView({ block: 'center' });
        const ta = root.querySelector('#hgInput');
        if (ta) { ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); }
      },
      clearVoiceDemo: () => {
        const box = root && root.querySelector('.hg-msgs');
        if (!box) return;
        box.querySelectorAll('.hg-capture-voice').forEach((el) => el.remove());
        box.querySelectorAll('.hg-bubble[data-cap-hide]').forEach((b) => {
          b.removeAttribute('data-cap-hide');
          b.style.display = '';
        });
      },
      setConnecting: (on) => setConnecting(!!on),
      setListEdit: (on) => {
        state.listEditMode = !!on;
        if (!on) state.selectedChatIds = new Set();
        else if (!state.selectedChatIds.size && state.chats[0]) {
          state.selectedChatIds = new Set([Number(state.chats[0].id)]);
        }
        try { document.body.classList.toggle('hg-list-edit', !!on); } catch (_) {}
        renderPanel();
      },
      setReplyDemo: () => {
        const msg = state.messages.find((m) => (m.message || m.text)) || {
          id: 'cap-reply', user_id: 0, user_name: 'Коллега', message: 'Исходное сообщение для ответа'
        };
        setReplyTo(msg);
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body && document.body.dataset.huginnAutostart !== '0') {
        // autostart only if shell opted in
      }
    });
  }
})(typeof window !== 'undefined' ? window : global);
