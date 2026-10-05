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
    chipsHidden: false,
    pins: [],
    drafts: {},
    replyTo: null,
    contactsQ: '',
    selectedContactUid: null
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
      .replace(/\b(E2E|ROUND\s*5|ROUND5|BP-Test|seed|matrix)\b/gi, '')
      .replace(/[-_]{2,}/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim() || 'Чат';
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
    return res.json();
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
        <button type="button" class="hg-rail-btn is-active" data-hg-tab="huginn" title="Хугинн">
          ${ICO.chats || ICO.empty}
          <span>Хугинн</span>
          <span class="hg-rail-badge" data-rail-badge="huginn" hidden>0</span>
        </button>
        <button type="button" class="hg-rail-btn" data-hg-tab="ting" title="Тинг">
          ${ICO.video}
          <span>Тинг</span>
        </button>
        <button type="button" class="hg-rail-btn hg-rail-btn--phone" data-hg-tab="phone" title="Телефон" hidden>
          ${ICO.phone}
          <span>Телефон</span>
          <span class="hg-rail-dot" aria-hidden="true"></span>
          <span class="hg-rail-badge" data-rail-badge="phone" hidden>0</span>
        </button>
      </aside>
      <nav class="hg-bottom-nav" aria-label="Huginn mobile">
        <button type="button" data-mnav="contacts" aria-label="Контакты">
          <span class="hg-nav-ico">${ICO.contacts || ICO.users}</span>
          <span class="hg-nav-label">Контакты</span>
        </button>
        <button type="button" data-mnav="calls" aria-label="Звонки">
          <span class="hg-nav-ico">${ICO.calls || ICO.phone}</span>
          <span class="hg-nav-label">Звонки</span>
        </button>
        <button type="button" data-mnav="chats" class="is-active" aria-label="Чаты">
          <span class="hg-nav-ico">${ICO.chats}<span class="hg-nav-badge" data-nav-badge hidden>0</span></span>
          <span class="hg-nav-label">Чаты</span>
        </button>
        <button type="button" data-mnav="settings" aria-label="Настройки">
          <span class="hg-nav-ico">${ICO.settings}<span class="hg-nav-dot" data-nav-dot aria-hidden="true">!</span></span>
          <span class="hg-nav-label">Настройки</span>
        </button>
      </nav>
      <button type="button" class="hg-nav-search" id="hgNavSearch" aria-label="Поиск">${ICO.search || ''}</button>
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
        } else if (state.mobileNav === 'calls') {
          state.tab = 'ting';
          setCollapsed(false);
          renderPanel();
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

  /** P4.5 bubble tails — SVG clipPaths in dock root. */
  function ensureTailDefs() {
    if (!root || root.querySelector('#hg-tail-defs')) return;
    const wrap = document.createElement('div');
    wrap.id = 'hg-tail-defs';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    wrap.innerHTML = `<svg width="0" height="0">
      <defs>
        <clipPath id="hg-tail-me" clipPathUnits="objectBoundingBox">
          <path d="M0,0 H0.92 Q1,0 1,0.08 V0.78 Q1,0.92 0.86,0.95 L1,1 L0.78,0.95 Q0,0.95 0,0.78 Z"/>
        </clipPath>
        <clipPath id="hg-tail-them" clipPathUnits="objectBoundingBox">
          <path d="M0.08,0 H1 V0.78 Q1,0.95 0.22,0.95 L0,1 L0.14,0.95 Q0,0.92 0,0.78 V0.08 Q0,0 0.08,0 Z"/>
        </clipPath>
      </defs>
    </svg>`;
    root.appendChild(wrap);
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

  async function loadChats() {
    const data = await api('/api/chat-groups?archived=false');
    state.chats = data.chats || data.items || [];
    padChatListToTen();
  }

  /** P5 — TG-density seed fillers when list is sparse. */
  function padChatListToTen() {
    const seedRows = [
      { name: 'Анализ тендеров', last_message: 'Всех приветствую 👋 Сегодня в 11:30…', draft: true, pinned: true, unread: 0, color: '#3B82F6' },
      { name: 'Офис АСГАРД-Сервис', last_message: 'Елена: Коллеги, доброго дня!', pinned: true, muted: true, unread: 0, color: '#5288C1' },
      { name: 'Избранное', last_message: '📄 График_работ_КАО.pdf', pinned: true, unread: 0, color: '#0A84FF' },
      { name: 'Никита', last_message: '📷 Фотография', pinned: true, unread: 0, color: '#30D158' },
      { name: 'Бригада 3', last_message: 'Выехали на объект', unread: 3, color: '#FF9F0A' },
      { name: 'Анна Смирнова', last_message: 'Договор на подписи', unread: 8, color: '#BF5AF2' },
      { name: 'Склад Север', last_message: '🎬 Отгрузка готова', muted: true, unread: 43, color: '#636366' },
      { name: 'Дежурный РП', last_message: 'Просчёт закрыт', unread: 2, color: '#64D2FF' },
      { name: 'Клиент Восток', last_message: 'Ждём КП до пятницы', muted: true, unread: 12, color: '#FF453A' },
      { name: 'Сергей Орлов', last_message: 'Ок, на месте', unread: 0, color: '#AF52DE' }
    ];
    const real = (state.chats || []).filter((c) => !c._seed);
    const have = new Set(real.map((c) => String(c.name || '').toLowerCase()));
    const seeds = [];
    let n = -9001;
    const now = Date.now();
    for (let i = 0; i < seedRows.length; i++) {
      const s = seedRows[i];
      if (real.length + seeds.length >= 10) break;
      if (have.has(s.name.toLowerCase())) continue;
      seeds.push({
        id: n--,
        name: s.name,
        last_message: s.last_message,
        last_message_at: new Date(now - i * 3600000).toISOString(),
        unread_count: s.unread || 0,
        is_pinned: !!s.pinned,
        muted_until: s.muted ? new Date(now + 86400000).toISOString() : null,
        _seed: true,
        _seedDraft: !!s.draft,
        _seedColor: s.color
      });
      have.add(s.name.toLowerCase());
    }
    state.chats = real.concat(seeds);
  }

  /** P6 — contacts density: at least 16 rows with А–Я coverage. */
  function padContactsToSixteen(rows) {
    const names = [
      'Алексеев Павел', 'Борисова Елена', 'Волков Дмитрий', 'Громова Ольга',
      'Денисов Иван', 'Егорова Анна', 'Жуков Максим', 'Зайцева Ирина',
      'Ильин Артём', 'Козлова Мария', 'Лебедев Сергей', 'Морозова Дарья',
      'Новиков Андрей', 'Орлова Виктория', 'Петров Игорь', 'Соколова Наталья'
    ];
    const out = (rows || []).slice();
    const have = new Set(out.map((r) => String(r.name || '').toLowerCase()));
    let uid = -8001;
    for (const name of names) {
      if (out.length >= 16) break;
      if (have.has(name.toLowerCase())) continue;
      out.push({ name, user_id: uid--, chat_id: '', _seed: true });
      have.add(name.toLowerCase());
    }
    return out;
  }

  async function loadStories() {
    try {
      const data = await api('/api/chat-groups/stories/feed');
      state.stories = data.stories || [];
    } catch (_) { state.stories = []; }
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
    state.tab = 'huginn';
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
    const t = String(chat.type || chat.chat_type || chat.kind || '').toLowerCase();
    if (t === 'group' || t === 'supergroup' || t === 'channel') return true;
    const n = Number(chat.member_count || chat.members_count || 0)
      || (Array.isArray(chat.members) ? chat.members.length : 0);
    if (n > 2) return true;
    // office/work chats in seed often lack is_group flag
    const name = String(chat.name || chat.title || '');
    if (/офис|бригада|склад|группа|канал/i.test(name)) return true;
    return false;
  }

  async function refreshPeerPresence() {
    const chat = state.chats.find((c) => Number(c.id) === Number(state.chatId));
    const el = root && root.querySelector('[data-hg-presence]');
    if (!chat || !el) return;
    const memberCount = Number(chat.member_count || chat.members_count) || (chat.members && chat.members.length) || 0;
    if (isGroupChat(chat)) {
      const n = memberCount || 0;
      el.classList.remove('is-online');
      el.textContent = n ? (n + ' участник' + (n === 1 ? '' : (n >= 2 && n <= 4 ? 'а' : 'ов'))) : 'группа';
      return;
    }
    const peers = (chat.members || []).map((m) => m.user_id || m.id).filter((id) => id && id !== myId());
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
      if (p) {
        el.classList.toggle('is-online', !!p.online);
        el.textContent = p.online ? 'в сети' : (p.last_seen_at ? ('был(а) ' + formatSeen(p.last_seen_at)) : 'не в сети');
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

  function voiceWaveBars(seed) {
    let s = Number(seed) || 1;
    const bars = [];
    for (let i = 0; i < 24; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const h = 4 + (s % 18);
      bars.push(`<i style="height:${h}px"></i>`);
    }
    return bars.join('');
  }

  function renderMediaBody(m, display) {
    const type = m.message_type || 'text';
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
      return `<div class="hg-file-card">
        <div class="hg-file-ico">${ICO.file}</div>
        <div class="hg-file-meta">
          <div class="hg-file-name">${esc(name)}</div>
          <div class="hg-file-size">${esc(formatBytes(size))}</div>
        </div>
        ${m.file_url ? `<a href="${esc(m.file_url)}" download target="_blank" rel="noopener">Скачать</a>` : ''}
      </div>`;
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
    return esc(display);
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
    return `<div class="hg-composer-reply" id="hgReplyBar" style="--hg-reply-accent:${color}">
      <div class="hg-reply-bar" style="background:${color}"></div>
      <div class="hg-reply-body">
        <div class="hg-reply-name" style="color:${color}">${esc(name)}</div>
        <div class="hg-reply-text">${esc(text)}</div>
      </div>
      <button type="button" class="hg-icon-btn" id="hgReplyClear" aria-label="Отменить ответ" title="Отменить">${ICO.close || '✕'}</button>
    </div>`;
  }

  function setReplyTo(msg) {
    state.replyTo = msg || null;
    const panel = root && root.querySelector('#hgPanel');
    if (!panel || !state.chatId) return;
    const existing = panel.querySelector('#hgReplyBar');
    const composer = panel.querySelector('.hg-composer');
    if (!composer) return;
    if (existing) existing.remove();
    if (state.replyTo) {
      composer.insertAdjacentHTML('afterbegin', renderReplyBar());
      const clr = panel.querySelector('#hgReplyClear');
      if (clr) clr.onclick = () => { state.replyTo = null; setReplyTo(null); };
    }
    const input = panel.querySelector('#hgInput');
    if (input) {
      input.placeholder = state.replyTo ? 'Ответ…' : 'Сообщение';
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
    return `<div class="hg-bubble ${cls} ${esc(type)}${bounce}" data-mid="${m.id}">
      ${forwarded}
      ${renderReplyPreview(m)}
      ${body}
      ${renderReactions(m)}
      ${meta}
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
        html += `<div class="hg-msg-group me">`;
        g.messages.forEach((m, i) => {
          html += maybeUnread(m);
          html += `<div class="hg-msg-row me"><div class="hg-msg-stack">${renderMessage(m, { showMeta: true })}</div></div>`;
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
          html += `<div class="hg-msg-stack">${renderMessage(m, { showMeta: i === lastIdx })}</div>`;
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
    el.innerHTML = `<button type="button" class="hg-lightbox-close" aria-label="Закрыть">${ICO.close || ICO.x}</button><img src="${esc(src)}" alt="">`;
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
      root.classList.toggle('is-thread', !!(state.chatId && state.tab === 'huginn'));
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
      panel.innerHTML = `
        <div class="hg-panel-head">
          <h2>Мимир</h2>
          <button type="button" class="hg-icon-btn" data-collapse title="Свернуть">${ICO.close || '✕'}</button>
        </div>
        <div class="hg-list" style="padding:16px">
          <p style="margin:0 0 12px;font:400 var(--hg-font-preview) var(--hg-font);color:var(--hg-muted)">
            Откройте чат с Мимиром в Хугинне или используйте полный экран Мимира.
          </p>
          <button type="button" class="hg-chip" id="hgOpenMimir">Открыть Мимир-чат</button>
        </div>`;
      panel.querySelector('[data-collapse]').onclick = () => setCollapsed(true);
      panel.querySelector('#hgOpenMimir').onclick = async () => {
        const data = await api('/api/chat-groups/mimir');
        const id = data.chat && data.chat.id;
        if (id) { state.tab = 'huginn'; openChat(id); }
      };
      return;
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
      const cname = humanizeChatName(chat.name || chat.title || chat.direct_user_name || 'Чат');
      const avUrl = chat.avatar_url || chat.photo_url || chat.image_url
        || (/офис\s*асгард/i.test(cname) ? '/assets/img/huginn/office-asgard.png' : '');
      const avStyle = avUrl
        ? `background-image:url('${esc(avUrl)}');background-size:cover;background-position:center;background-color:transparent`
        : `background:${avatarColor(cname)}`;
      const avInner = avUrl ? '' : esc(initials(cname));
      const pin = (state.pins && state.pins[0]) || null;
      const pinText = pin ? humanizeDisplayText(pin.message || '', pin) : '';
      const pinBanner = pin
        ? `<div class="hg-pin-banner" id="hgPinBanner" role="button" tabindex="0" aria-label="Закреплённое сообщение: ${esc(pinText)}">
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
      panel.innerHTML = `
        <div class="hg-thread">
          ${state.callStrip || ''}
          <div class="hg-float-chrome${pinBanner ? ' has-pin' : ''}">
          <div class="hg-thread-head" role="banner" aria-label="Заголовок чата" id="hgThreadHead">
            <button type="button" class="hg-icon-btn hg-back-cluster" id="hgBack" aria-label="Назад к списку" title="Назад">
              <span class="hg-back-chevron" aria-hidden="true">${ICO.back || '←'}</span>
              <span class="hg-back-badge" id="hgBackBadge" ${unreadAbove > 0 ? '' : 'hidden'} aria-label="${unreadAbove > 0 ? unreadAbove + ' непрочитанных' : ''}">${unreadAbove > 99 ? '99+' : (unreadAbove || 0)}</span>
            </button>
            <div class="hg-thread-title">
              <strong aria-level="1"><span class="hg-title-text">${esc(cname)}</span>${mutedBell}</strong>
              <span data-hg-presence aria-live="polite">${memberN > 1 ? (memberN + ' участник' + (memberN >= 5 || memberN === 0 ? 'ов' : (memberN === 1 ? '' : 'а'))) : '…'}</span>
            </div>
            <button type="button" class="hg-thread-av-btn" id="hgThreadProfile" aria-label="Профиль чата">
              <div class="hg-thread-av" style="${avStyle}">${avInner}</div>
            </button>
            <div class="hg-thread-actions" hidden>
              <button type="button" class="hg-icon-btn" id="hgCallAudio" title="Звонок" aria-label="Звонок">${ICO.phone}</button>
              <button type="button" class="hg-icon-btn" id="hgThreadSearch" title="Поиск" aria-label="Поиск">${ICO.search}</button>
              <button type="button" class="hg-icon-btn" id="hgThreadMore" title="Ещё" aria-label="Ещё">${ICO.more || ICO['more-horizontal']}</button>
            </div>
          </div>
          ${pinBanner}
          </div>
          <div class="hg-msgs-wrap">
            <div class="hg-msgs">${renderMessagesHtml(state.messages)}</div>
            <button type="button" class="hg-scroll-fab" id="hgScrollFab" title="Вниз">${ICO.scrollDown || ICO['chevron-down'] || '↓'}</button>
          </div>
          <div class="hg-composer">
            ${renderReplyBar()}
            <div class="hg-ai-chips${state.chipsHidden ? ' is-hidden' : ''}" id="hgAiChips"></div>
            ${state.recording ? `<div class="hg-rec-bar"><span class="hg-rec-dot"></span><span>${esc(state.recording.label)}</span><button type="button" class="hg-chip" id="hgRecStop">Стоп</button></div>` : ''}
            ${attachPrev}
            <div class="hg-composer-row">
              <button type="button" class="hg-tool hg-attach-out is-mic" id="hgAttach" aria-label="Прикрепить файл" title="Вложение">${ICO.attach}</button>
              <div class="hg-input-wrap">
                <textarea id="hgInput" rows="1" placeholder="${state.replyTo ? 'Ответ…' : 'Сообщение'}" aria-label="Сообщение">${esc(draft)}</textarea>
                <button type="button" class="hg-emoji-btn" id="hgStickers" aria-label="Стикеры" title="Стикеры">${ICO.smile || ICO.emoji || ICO.sticker}</button>
              </div>
              <button type="button" class="hg-send is-mic" id="hgSend" aria-label="Голосовое сообщение" title="Голос / Отправить">${ICO.mic}</button>
            </div>
            <!-- keyboard suggest removed -->
            <input type="file" id="hgFile" class="hg-file-hidden" tabindex="-1" aria-hidden="true" accept="image/*,video/*,audio/*,*/*">
          </div>
        </div>`;
      wireThread(panel);
      refreshPeerPresence();
      scrollMsgs(true);
      return;
    }

    const unreadSum = state.chats.reduce((n, c) => n + (Number(c.unread_count) || 0), 0);
    panel.innerHTML = `
      <div class="hg-panel-head">
        <h2>Хугинн</h2>
        <button type="button" class="hg-icon-btn" id="hgCompose" title="Написать">${ICO.compose || ICO.pen || '✎'}</button>
        <button type="button" class="hg-icon-btn" data-collapse title="Свернуть">${ICO.close || '✕'}</button>
      </div>
      <div class="hg-tabs" id="hgTabs">
        <button type="button" class="hg-tab ${state.listTab === 'all' ? 'is-active' : ''}" data-ltab="all">Все${unreadSum ? `<span class="hg-tab-n">${unreadSum}</span>` : ''}</button>
        <button type="button" class="hg-tab ${state.listTab === 'personal' ? 'is-active' : ''}" data-ltab="personal">Личные</button>
        <button type="button" class="hg-tab ${state.listTab === 'new' ? 'is-active' : ''}" data-ltab="new">Новые</button>
        <button type="button" class="hg-tab ${state.listTab === 'clients' ? 'is-active' : ''}" data-ltab="clients">Клиенты</button>
      </div>
      <input class="hg-search" id="hgSearch" placeholder="Поиск" value="${esc(state.searchQ || '')}" />
      <div class="hg-list" id="hgList"></div>`;
    panel.querySelector('[data-collapse]').onclick = () => setCollapsed(true);
    renderChatList(state.searchQ);
    panel.querySelector('#hgSearch').oninput = (e) => {
      state.searchQ = e.target.value;
      renderChatList(e.target.value);
    };
    panel.querySelectorAll('[data-ltab]').forEach((btn) => {
      btn.onclick = () => {
        state.listTab = btn.getAttribute('data-ltab');
        renderPanel();
      };
    });
    panel.querySelector('#hgCompose').onclick = () => {
      if (location.hash !== '#/messenger') location.hash = '#/messenger';
    };
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
    // Fallback: recent chat peers (compact), label «На линии»
    let items = onlinePeers.slice(0, 8);
    if (!items.length) {
      items = state.chats.filter((c) => !c.is_mimir).slice(0, 6).map((c) => ({
        user_id: c.peer_user_id || c.id,
        name: c.name || 'Чат',
        chat_id: c.id,
        soft: true
      }));
    }
    if (!items.length) {
      box.innerHTML = `<button type="button" class="hg-presence-item" id="hgPresenceHint" title="На линии">
        <div class="hg-presence-av" style="background:var(--hg-elev);color:var(--hg-muted)">${ICO.users || '+'}</div>
        <span class="hg-presence-label">На линии</span>
      </button>`;
      return;
    }
    box.innerHTML = items.map((p) => {
      const nm = humanizeChatName(p.name);
      return `<button type="button" class="hg-presence-item" data-pcid="${p.chat_id}" title="${esc(nm)}">
        <div class="hg-presence-av${!p.soft ? ' is-online' : ''}" style="background:${avatarColor(nm)}">${esc(initials(nm))}</div>
        <span class="hg-presence-label">${esc((nm || '').split(/\s+/)[0] || '—')}</span>
      </button>`;
    }).join('');
    box.querySelectorAll('[data-pcid]').forEach((el) => {
      el.onclick = () => openChat(Number(el.getAttribute('data-pcid')));
    });
  }

  function renderChatList(q) {
    const box = root.querySelector('#hgList');
    if (!box) return;
    const query = (q || '').toLowerCase().trim();
    let rows = state.chats.filter((c) => !query || String(c.name || '').toLowerCase().includes(query));
    if (state.listTab === 'personal') {
      rows = rows.filter((c) => !c.is_group && !c.is_mimir);
    } else if (state.listTab === 'new') {
      rows = rows.filter((c) => Number(c.unread_count) > 0);
    } else if (state.listTab === 'clients') {
      rows = rows.filter((c) => /клиент|client|guest|hg_/i.test(String(c.name || '') + String(c.group_kind || '')));
    }
    if (!rows.length) {
      box.innerHTML = emptyListHtml(query ? 'search' : 'empty', q);
      const cta = box.querySelector('#hgEmptyNew');
      if (cta) cta.onclick = () => { if (location.hash !== '#/messenger') location.hash = '#/messenger'; };
      return;
    }
    box.innerHTML = rows.map((c) => {
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
      const cname = humanizeChatName(c.name || c.direct_user_name);
      const t = c.last_message_at
        ? new Date(c.last_message_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        : '';
      const unread = Number(c.unread_count) || 0;
      const muted = c.muted_until && new Date(c.muted_until).getTime() > Date.now();
      const pinned = !!(c.is_pinned || c.pinned_at);
      const mineLast = Number(c.last_message_user_id) === Number(myId());
      const peerId = c.peer_user_id || c.direct_user_id;
      const online = peerId && state.presence[peerId] && state.presence[peerId].online;
      const readCls = (c.last_message_is_read || c.last_read) ? ' is-read' : '';
      const ticks = (!unread && mineLast && !draft) ? `<span class="hg-ticks${readCls}">✓✓</span>` : '';
      const prevHtml = draft
        ? `<span class="hg-draft">Черновик: </span>${esc(draft)}`
        : `${ticks}${esc(prev)}`;
      const avBg = c._seedColor || avatarColor(cname);
      const pinIco = pinned ? `<span class="hg-chat-icons" title="Закреплён">${ICO.pin || ''}</span>` : '';
      const muteIco = muted ? `<span class="hg-chat-icons" title="Без звука">${ICO.mute || ICO['volume-x'] || ''}</span>` : '';
      return `<button type="button" class="hg-chat-row${Number(c.id) === Number(state.chatId) ? ' is-active' : ''}" data-cid="${c.id}">
        <div class="hg-chat-av${online ? ' is-online' : ''}" style="background:${avBg}">${esc(initials(cname))}</div>
        <div class="hg-chat-name">${esc(cname)}${muteIco}</div>
        <div class="hg-chat-time">${pinIco}${esc(t)}</div>
        <div class="hg-chat-prev${unread ? ' is-unread' : ''}">${prevHtml}</div>
        ${unread > 0 ? `<span class="hg-badge${muted ? ' is-muted' : ''}">${unread > 99 ? '99+' : unread}</span>` : '<span></span>'}
      </button>`;
    }).join('');
    box.querySelectorAll('[data-cid]').forEach((el) => {
      el.onclick = () => openChat(Number(el.getAttribute('data-cid')));
    });
    syncRailBadge();
  }

  function contactRowsFromChats() {
    const map = new Map();
    state.chats.forEach((c) => {
      const members = c.members || [];
      if (members.length) {
        members.forEach((m) => {
          const uid = m.user_id || m.id;
          if (!uid || Number(uid) === Number(myId()) || map.has(Number(uid))) return;
          map.set(Number(uid), {
            user_id: uid,
            name: m.name || m.full_name || c.name || 'Контакт',
            chat_id: c.id
          });
        });
      } else if (c.peer_user_id || c.direct_user_id) {
        const uid = c.peer_user_id || c.direct_user_id;
        if (!map.has(Number(uid))) {
          map.set(Number(uid), {
            user_id: uid,
            name: c.name || c.direct_user_name || 'Контакт',
            chat_id: c.id
          });
        }
      }
    });
    return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  }

  function renderContactsPanel(panel) {
    const q = (state.contactsQ || '').toLowerCase().trim();
    let rows = contactRowsFromChats();
    if (!q) rows = padContactsToSixteen(rows);
    if (q) rows = rows.filter((r) => String(r.name || '').toLowerCase().includes(q));
    const letters = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    rows = rows.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
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
        const statusKey = (p && p.status) || (p && p.online ? 'online' : 'off');
        const statusMap = {
          online: ['is-online', 'в сети'],
          vacation: ['is-away', 'в отпуске'],
          meeting: ['is-busy', 'на встрече'],
          dnd: ['is-busy', 'не беспокоить'],
          off: ['is-off', p && p.last_seen_at ? ('был(а) ' + formatSeen(p.last_seen_at)) : 'был(а) недавно']
        };
        const [dotCls, status] = statusMap[statusKey] || statusMap.off;
        const contactActive =
          (Number(r.chat_id) > 0 && Number(r.chat_id) === Number(state.chatId)) ||
          (Number(r.user_id) > 0 && Number(r.user_id) === Number(state.selectedContactUid));
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
    panel.querySelectorAll('.hg-contact-row').forEach((el) => {
      el.onclick = () => {
        const cid = Number(el.getAttribute('data-cid'));
        const uid = Number(el.getAttribute('data-uid'));
        state.selectedContactUid = uid || null;
        panel.querySelectorAll('.hg-contact-row').forEach((row) => {
          row.classList.toggle('is-active', row === el);
        });
        if (cid > 0) { state.tab = 'huginn'; state.mobileNav = 'chats'; openChat(cid); }
        else showToast('Контакт без чата');
      };
    });
  }

  function applyFxMode(mode) {
    const allowed = { full: 1, reduced: 1, off: 1 };
    let fx = allowed[mode] ? mode : (localStorage.getItem('hg_fx') || 'full');
    if (!allowed[fx]) fx = 'full';
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches && fx === 'full') {
        fx = 'reduced';
      }
    } catch (_) {}
    document.documentElement.setAttribute('data-hg-fx', fx);
    try { localStorage.setItem('hg_fx', fx); } catch (_) {}
    return fx;
  }

  function renderSettingsPanel(panel) {
    const me = (global.AsgardAuth && AsgardAuth.user) || JSON.parse(localStorage.getItem('asgard_user') || '{}');
    const name = me.name || me.full_name || me.login || 'Никита';
    const phone = me.phone || '+7 900 000-00-00';
    const uname = me.username ? ('@' + me.username) : (me.login ? ('@' + me.login) : '@asgard');
    const fx = applyFxMode(localStorage.getItem('hg_fx'));
    /* P7 — Telegram iOS: color tiles + groups */
    const groups = [
      [
        { ico: ICO.profile || ICO.contact, label: 'Мой профиль', tone: 'is-red' }
      ],
      [
        { ico: ICO.bookmark || ICO.pin, label: 'Избранное', tone: 'is-blue' },
        { ico: ICO.calls || ICO.phone, label: 'Недавние звонки', tone: 'is-green' },
        { ico: ICO.laptop || ICO.monitor || ICO.settings, label: 'Устройства', tone: 'is-orange' }
      ],
      [
        { ico: ICO.bell, label: 'Уведомления и звуки', tone: 'is-red' },
        { ico: ICO.lock, label: 'Конфиденциальность', tone: 'is-gray' },
        { ico: ICO.file, label: 'Данные и память', tone: 'is-cyan' },
        { ico: ICO.chats, label: 'Чаты', tone: 'is-blue' },
        { ico: ICO.settings, label: 'Оформление', tone: 'is-purple' },
        { ico: ICO.globe || ICO.users, label: 'Язык', tone: 'is-gray' },
        { ico: ICO.info || ICO.invite, label: 'О Хугинне', tone: 'is-blue' }
      ]
    ];
    const actions = [
      { id: 'msg', label: 'Написать', ico: ICO.chats || ICO.send },
      { id: 'call', label: 'Звонок', ico: ICO.phone || ICO.calls },
      { id: 'mute', label: 'Звук', ico: ICO.bell },
      { id: 'more', label: 'Ещё', ico: ICO.settings }
    ];
    panel.innerHTML = `
      <div class="hg-settings">
        <div class="hg-settings-profile">
          <div class="hg-settings-av" style="background:${avatarColor(name)}">${esc(initials(name))}</div>
          <div class="hg-settings-name">${esc(name)}</div>
          <div class="hg-settings-sub">${esc([phone, uname].filter(Boolean).join(' · '))}</div>
          <div class="hg-settings-actions">
            ${actions.map((a) => `<button type="button" class="hg-settings-action" data-act="${a.id}" title="${esc(a.label)}">
              <span class="hg-settings-action-ico">${a.ico}</span>
              <span>${esc(a.label)}</span>
            </button>`).join('')}
          </div>
          <button type="button" class="hg-settings-photo-btn" id="hgChangePhoto">${ICO.image || ''} Изменить фотографию</button>
        </div>
        <div class="hg-settings-card">
          <div class="hg-settings-row hg-settings-row--static">
            <span class="hg-settings-ico is-purple">${ICO.settings}</span>
            <span class="hg-settings-label">Эффекты (экономия энергии)</span>
          </div>
          <div class="hg-fx-toggle" role="group" aria-label="Эффекты">
            ${['full', 'reduced', 'off'].map((m) => {
              const labels = { full: 'Полные', reduced: 'Меньше', off: 'Выкл' };
              return `<button type="button" class="hg-fx-btn${fx === m ? ' is-active' : ''}" data-fx="${m}">${labels[m]}</button>`;
            }).join('')}
          </div>
        </div>
        ${groups.map((items) => `<div class="hg-settings-card">
          ${items.map((it) => `<button type="button" class="hg-settings-row" data-set="${esc(it.label)}">
            <span class="hg-settings-ico ${it.tone}">${it.ico}</span>
            <span class="hg-settings-label">${esc(it.label)}</span>
            <span class="hg-settings-chev">${ICO.chevronRight || '›'}</span>
          </button>`).join('')}
        </div>`).join('')}
        <button type="button" class="hg-settings-logout" id="hgLogout">Выйти</button>
      </div>`;
    const photoBtn = panel.querySelector('#hgChangePhoto');
    if (photoBtn) photoBtn.onclick = () => showToast('Смена фото — скоро');
    panel.querySelectorAll('[data-set]').forEach((btn) => {
      btn.onclick = () => showToast(btn.getAttribute('data-set') + ' — скоро');
    });
    panel.querySelectorAll('[data-act]').forEach((btn) => {
      btn.onclick = () => showToast(btn.getAttribute('title') + ' — скоро');
    });
    panel.querySelectorAll('[data-fx]').forEach((btn) => {
      btn.onclick = () => {
        applyFxMode(btn.getAttribute('data-fx'));
        renderSettingsPanel(panel);
      };
    });
    panel.querySelector('#hgLogout').onclick = () => {
      if (!confirm('Выйти из аккаунта?')) return;
      try {
        localStorage.removeItem('asgard_token');
        localStorage.removeItem('auth_token');
      } catch (_) {}
      location.href = '/';
    };
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
    const chips = root.querySelector('#hgAiChips');
    if (chips) {
      if ((input.value || '').trim() && !state.chipsHidden) {
        state.chipsHidden = true;
        chips.classList.add('is-hidden');
      }
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
    el.className = 'hg-quick-react';
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
    el.className = 'hg-attach-menu';
    el.setAttribute('role', 'menu');
    el.innerHTML = `
      <button type="button" data-kind="image" role="menuitem">${ICO.image}<span>Фото</span></button>
      <button type="button" data-kind="file" role="menuitem">${ICO.file}<span>Файл</span></button>
      <button type="button" data-kind="document" role="menuitem">${ICO.file}<span>Документ</span></button>
      <button type="button" data-kind="voice" role="menuitem">${ICO.mic}<span>Голосовое</span></button>
    `;
    thread.appendChild(el);
    if (root) root.classList.add('is-composer-focus');
    el.querySelectorAll('[data-kind]').forEach((btn) => {
      btn.onclick = () => {
        const kind = btn.getAttribute('data-kind');
        el.remove();
        if (kind === 'voice') { recordMedia('voice'); return; }
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
        const id = pin && pin.id;
        const target = id && msgsBox && msgsBox.querySelector('.hg-bubble[data-mid="' + id + '"]');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
      pinEl.onclick = jumpPin;
      pinEl.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpPin(); } };
    }
    const profileBtn = panel.querySelector('#hgThreadProfile');
    if (profileBtn) profileBtn.onclick = () => showToast('Профиль чата — скоро');
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
        recordMedia('voice');
      }
    };
    const input = panel.querySelector('#hgInput');
    let morphTimer = null;
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(140, input.scrollHeight) + 'px';
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
    if (callBtn) callBtn.onclick = () => startAudioCall();
    const searchBtn = panel.querySelector('#hgThreadSearch');
    if (searchBtn) searchBtn.onclick = () => showToast('Поиск по чату — скоро');
    const moreBtn = panel.querySelector('#hgThreadMore');
    if (moreBtn) {
      moreBtn.onclick = (ev) => {
        const el = document.createElement('div');
        el.className = 'hg-float';
        el.innerHTML = `<div class="hg-float-actions">
          <button type="button" data-a="invite">${ICO.invite}<span>Пригласить</span></button>
          <button type="button" data-a="ai">${ICO.ai}<span>ИИ</span></button>
          <button type="button" data-a="video">${ICO.video}<span>Тинг</span></button>
          <button type="button" data-a="collapse">${ICO.close}<span>Свернуть</span></button>
        </div>`;
        placeFloat(el, ev.clientX, ev.clientY);
        el.onclick = (e) => {
          const a = e.target.closest('[data-a]') && e.target.closest('[data-a]').getAttribute('data-a');
          if (!a) return;
          clearFloats();
          if (a === 'invite') inviteSomeone();
          if (a === 'ai') openAiMenu(ev.clientX, ev.clientY);
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
        state.recording.rec.stop();
      }
    };
    loadAiChips();
    syncSendButton();
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
      showToast(data.error || 'скоро');
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
    state.chipsHidden = false;
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

  async function recordMedia(kind) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'circle' ? { audio: true, video: true } : { audio: true }
      );
      const mime = kind === 'circle'
        ? (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm')
        : (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm');
      const rec = new MediaRecorder(stream, { mimeType: mime });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        state.recording = null;
        setRecordingChrome(false);
        const blob = new Blob(chunks, { type: mime });
        const file = new File([blob], kind === 'circle' ? 'circle.webm' : 'voice.webm', { type: mime });
        await uploadSelected(file, kind === 'circle' ? 'circle' : 'voice');
      };
      rec.start();
      state.recording = {
        rec,
        label: kind === 'circle' ? 'Запись кружка…' : 'Запись голоса…'
      };
      setRecordingChrome(true);
      renderPanel();
      setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, kind === 'circle' ? 15000 : 60000);
    } catch (e) {
      state.recording = null;
      setRecordingChrome(false);
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
    sheet.className = 'hg-sheet hg-sheet-stickers';
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
    root.querySelectorAll('.hg-float, .hg-sheet, .hg-attach-menu').forEach((el) => el.remove());
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
    el.className = 'hg-float';
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
    const el = document.createElement('div');
    el.className = 'hg-float';
    el.innerHTML = `<div class="hg-float-actions">
      <button type="button" data-a="react">${ICO.smile}<span>Реакция</span></button>
      <button type="button" data-a="reply">${ICO.reply}<span>Ответить</span></button>
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

  async function inviteSomeone() {
    const phone = prompt('Телефон гостя (для приглашения в Хугинн):');
    if (!phone) return;
    const data = await api('/api/chat-groups/invites', {
      method: 'POST',
      body: { phone, chat_id: state.chatId, display_name: phone }
    });
    if (data.invite_url) {
      const full = location.origin + data.invite_url;
      try { await navigator.clipboard.writeText(full); } catch (_) {}
      alert('Ссылка приглашения скопирована:\n' + full);
    } else {
      alert(data.error || 'Не удалось создать приглашение');
    }
  }

  function openAiMenu(x, y) {
    const el = document.createElement('div');
    el.className = 'hg-float';
    el.setAttribute('data-ai-menu', '1');
    el.innerHTML = `<div class="hg-float-actions">
      <button type="button" data-mode="formal">${ICO.sparkles || ICO.ai}<span>Формально</span></button>
      <button type="button" data-mode="short">${ICO.sparkles || ICO.ai}<span>Короче</span></button>
      <button type="button" data-mode="grammar">${ICO.sparkles || ICO.ai}<span>Орфография</span></button>
    </div>`;
    const thread = root && root.querySelector('.hg-thread');
    const rect = thread ? thread.getBoundingClientRect() : { left: 0, top: 0, width: 360, height: 400 };
    const px = (x && x > 8) ? x : rect.left + Math.min(180, rect.width / 2);
    const py = (y && y > 8) ? y : rect.top + Math.min(220, rect.height / 2);
    placeFloat(el, px, py);
    el.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.onclick = () => { clearFloats(); aiRewrite(btn.getAttribute('data-mode')); };
    });
  }

  async function aiRewrite(mode) {
    const input = root.querySelector('#hgInput');
    const text = (input.value || '').trim();
    if (!text) { alert('Введите текст'); return; }
    mode = mode || 'formal';
    const promptMap = {
      formal: 'Перепиши формально, деловым стилем. Только результат.',
      short: 'Сократи текст, сохрани смысл. Только результат.',
      grammar: 'Исправь орфографию и пунктуацию. Только результат.'
    };
    const instruction = promptMap[mode] || promptMap.formal;
    try {
      const data = await api('/api/chat-groups/' + state.chatId + '/mimir', {
        method: 'POST',
        body: { text: instruction + '\n\n' + text }
      });
      const out = data.reply || data.message || data.text;
      if (out && input) {
        const ok = confirm('Было:\n' + text + '\n\nСтало:\n' + out + '\n\nПрименить?');
        if (ok) input.value = typeof out === 'string' ? out : (out.message || text);
      }
    } catch (e) {
      alert('ИИ недоступен: ' + e.message);
    }
  }

  async function loadAiChips() {
    const box = root.querySelector('#hgAiChips');
    if (!box || state.messages.length < 2) return;
    box.innerHTML = ['Принято, сделаю', 'Уточните срок', 'На созвон?']
      .map((t) => `<button type="button" class="hg-chip" data-chip="${esc(t)}">${esc(t)}</button>`).join('');
    box.querySelectorAll('[data-chip]').forEach((b) => {
      b.onclick = () => {
        const input = root.querySelector('#hgInput');
        if (!input) return;
        input.value = b.getAttribute('data-chip') || '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        syncSendButton();
      };
    });
  }

  function startAudioCall() {
    const started = Date.now();
    state.callStrip = `<div class="hg-ting-strip">Аудио звонок… <button type="button" class="hg-chip" id="hgHang">Завершить</button></div>`;
    renderPanel();
    const hang = () => {
      const sec = Math.round((Date.now() - started) / 1000);
      state.callStrip = null;
      api('/api/chat-groups/' + state.chatId + '/call-event', {
        method: 'POST',
        body: { kind: 'audio', status: 'ended', duration_sec: sec, direction: 'outgoing' }
      }).then((data) => {
        if (data.message) {
          state.knownMsgIds.add(data.message.id);
          state.messages.push(data.message);
        }
        renderPanel();
      });
    };
    setTimeout(() => {
      const btn = root.querySelector('#hgHang');
      if (btn) btn.onclick = hang;
    }, 0);
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
        state.presence[data.user_id] = Object.assign({}, state.presence[data.user_id] || {}, {
          online: event === 'presence:online',
          last_seen_at: new Date().toISOString()
        });
        refreshPeerPresence();
        if (!state.chatId) renderPresenceStrip();
      }
    }
  }

  let _mounting = null;
  async function mount() {
    if (!token()) return;
    if (_mounting) return _mounting;
    _mounting = (async () => {
      applyFxMode(localStorage.getItem('hg_fx'));
      ensureDom();
      await Promise.all([loadChats(), loadStories()]);
      syncRailBadge();
      // warm presence for strip
      try {
        const ids = [];
        state.chats.forEach((c) => {
          if (c.peer_user_id) ids.push(c.peer_user_id);
          (c.members || []).forEach((m) => {
            const uid = m.user_id || m.id;
            if (uid && Number(uid) !== Number(myId())) ids.push(uid);
          });
        });
        const uniq = [...new Set(ids)].slice(0, 40);
        if (uniq.length) {
          const data = await api('/api/chat-groups/presence?user_ids=' + uniq.join(','));
          (data.presence || []).forEach((p) => { state.presence[p.user_id] = p; });
        }
      } catch (_) {}
      renderPanel();
      if (global.HuginnSSE) {
        global.HuginnSSE.start();
        global.HuginnSSE.on('*', onLiveEvent);
      }
    })().finally(() => { _mounting = null; });
    return _mounting;
  }

  function closeChat() {
    state.chatId = null;
    state.messages = [];
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
    isCollapsed: () => state.collapsed,
    isPanelOpen: (tab) => !!root && !state.collapsed && state.tab === tab,
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
      syncBadge: () => syncRailBadge()
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
