/**
 * АСГАРД CRM — Моя Почта v2.0 (Premium)
 * Полноценный email-клиент, качество уровня Яндекс Почты
 * Все стили — в /assets/css/my-mail.css (не inline)
 */
window.AsgardMyMailPage = (function(){
  const { $, $$, esc, toast, skeleton, emptyState, formatDate, formatDateTime } = AsgardUI;

  /* ═══════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════ */
  let state = {
    configured: false,
    account: null,
    folders: [],
    emails: [],
    total: 0,
    page: 0,
    limit: 50,
    search: '',
    currentFolder: null,
    currentFolderType: 'inbox',
    selectedId: null,
    selectedEmail: null,
    selectedIds: new Set(),
    composing: false,
    composeData: null,
    stats: {},
    sidebarCollapsed: false,
    focusedIdx: -1,        // keyboard nav
    bodyZoom: 'zoom-md',   // font zoom
    pollTimer: null,
    lastPollUnread: null,
    draftAutoSaveTimer: null,
    contacts: [],           // address book cache
    contextMenu: null
  };

  let composeAttachments = [];
  let layoutEl = null;

  /* ═══════════════════════════════════════════════════════════════════
     API
     ═══════════════════════════════════════════════════════════════════ */
  async function api(url, options = {}) {
    const auth = await AsgardAuth.getAuth();
    const headers = { 'Authorization': 'Bearer ' + (auth?.token || '') };
    if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const resp = await fetch('/api/my-mail' + url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? (options.body instanceof FormData ? options.body : JSON.stringify(options.body)) : undefined
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Ошибка сервера' }));
      throw new Error(err.error || 'HTTP ' + resp.status);
    }
    return resp.json();
  }

  /* ═══════════════════════════════════════════════════════════════════
     DATE HELPERS
     ═══════════════════════════════════════════════════════════════════ */
  function fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    const now = new Date();
    const diff = now - dt;
    if (diff < 86400000 && dt.getDate() === now.getDate())
      return dt.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    if (diff < 604800000)
      return dt.toLocaleDateString('ru-RU', { weekday:'short', hour:'2-digit', minute:'2-digit' });
    return dt.toLocaleDateString('ru-RU', { day:'numeric', month:'short' });
  }

  function fmtFullDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleString('ru-RU', {
      day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit'
    });
  }

  function getDateGroup(d) {
    if (!d) return 'Ранее';
    const dt = new Date(d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
    if (dt >= today) return 'Сегодня';
    if (dt >= yesterday) return 'Вчера';
    if (dt >= weekAgo) return 'На этой неделе';
    return 'Ранее';
  }

  /* ═══════════════════════════════════════════════════════════════════
     COLOR HELPERS (avatar)
     ═══════════════════════════════════════════════════════════════════ */
  const AVATAR_COLORS = [
    '#1E4D8C','#C8293B','#D4A843','#2D7D46','#7B3FA0',
    '#C75B39','#2A8E8E','#6B5B95','#D14D72','#4A90D9'
  ];

  function hashColor(str) {
    let h = 0;
    for (let i = 0; i < (str||'').length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  }

  function avatarLetter(name, email) {
    if (name && name.trim()) return name.trim()[0].toUpperCase();
    if (email) return email[0].toUpperCase();
    return '?';
  }

  /* ═══════════════════════════════════════════════════════════════════
     SVG ICONS
     ═══════════════════════════════════════════════════════════════════ */
  const IC = {
    inbox:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>',
    sent:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    drafts:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    spam:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    trash:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
    folder:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
    compose:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    search:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    sync:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>',
    read:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    archive:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg>',
    del:      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
    reply:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>',
    forward:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 014-4h12"/></svg>',
    attach:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>',
    back:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    envelope: '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    collapse: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>',
    expand:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>',
    plus:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    print:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
    zoomIn:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    zoomOut:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    fullscreen:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    star:     '\u2606',
    starFull: '\u2605'
  };

  function folderIcon(type) { return IC[type] || IC.folder; }

  /* ═══════════════════════════════════════════════════════════════════
     FILE SIZE
     ═══════════════════════════════════════════════════════════════════ */
  function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B','KB','MB','GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k,i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Hashchange listener ref for cleanup
  let _hashChangeHandler = null;

  /* ═══════════════════════════════════════════════════════════════════
     MAIN RENDER
     ═══════════════════════════════════════════════════════════════════ */
  async function render({ layout, title }) {
    // Clean up previous instance (prevent timer leaks)
    destroy();

    document.title = title || 'Моя почта';
    const html = `
      <div class="mymail-container">
        <div class="mymail-sidebar${state.sidebarCollapsed?' collapsed':''}" id="mymail-sidebar">
          <button class="mymail-sidebar-toggle" id="mymail-sidebar-toggle" title="Свернуть/развернуть">${state.sidebarCollapsed?IC.expand:IC.collapse}</button>
          <button class="mymail-compose-btn" id="mymail-compose-btn">
            ${IC.compose}
            <span class="mymail-compose-btn-text">Написать</span>
          </button>
          <div class="mymail-folders" id="mymail-folders">
            ${skeleton('row', 5)}
          </div>
          <div class="mymail-account-info" id="mymail-account-info"></div>
        </div>
        <div class="mymail-main">
          <div class="mymail-toolbar" id="mymail-toolbar">
            <div class="mymail-toolbar-left">
              <label class="mymail-checkbox-wrap">
                <input type="checkbox" id="mymail-select-all">
              </label>
              <div class="mymail-bulk-actions" id="mymail-bulk-actions" style="display:none">
                <button class="mymail-btn-icon" data-action="mark_read" title="Прочитано">${IC.read}</button>
                <button class="mymail-btn-icon" data-action="archive" title="Архив">${IC.archive}</button>
                <button class="mymail-btn-icon" data-action="delete" title="Удалить">${IC.del}</button>
                <button class="mymail-btn-icon" data-action="spam" title="Спам">!</button>
              </div>
            </div>
            <div class="mymail-toolbar-right">
              <div class="mymail-search-wrap">
                ${IC.search}
                <input type="text" class="mymail-search" id="mymail-search" placeholder="Поиск по письмам...">
              </div>
              <button class="mymail-btn-icon" id="mymail-sync-btn" title="Синхронизировать">${IC.sync}</button>
            </div>
          </div>
          <div class="mymail-content">
            <div class="mymail-list-panel" id="mymail-list-panel">
              <div id="mymail-new-banner"></div>
              <div class="mymail-list" id="mymail-list">${skeleton('row', 10)}</div>
              <div class="mymail-pager" id="mymail-pager"></div>
            </div>
            <div class="mymail-detail-panel" id="mymail-detail-panel">
              <div class="mymail-detail" id="mymail-detail">
                ${renderEmptyDetail()}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="mymail-compose-overlay" id="mymail-compose-overlay" style="display:none"></div>
      <div class="mymail-mobile-actions" id="mymail-mobile-actions" style="display:none"></div>
    `;

    await layout(html, { title: title || 'Моя почта' });

    await loadAccount();

    if (!state.configured) {
      const foldersEl = $('#mymail-folders');
      const listEl = $('#mymail-list');
      if (foldersEl) foldersEl.innerHTML = '';
      if (listEl) listEl.innerHTML = `
        <div class="mymail-empty-state">
          ${IC.envelope}
          <h3>Почта не настроена</h3>
          <p>Обратитесь к администратору для привязки почтового ящика к вашей учётной записи.</p>
        </div>`;
      return;
    }

    await loadFolders();
    renderFolders();
    renderAccountInfo();
    bindEvents();
    await loadEmails();
    loadStats();
    startPolling();
    loadContacts();
    initSwipeActions();
    initPullToRefresh();

    // Cleanup when navigating away (hashchange)
    if (_hashChangeHandler) window.removeEventListener('hashchange', _hashChangeHandler);
    _hashChangeHandler = () => {
      if (!location.hash.includes('my-mail')) destroy();
    };
    window.addEventListener('hashchange', _hashChangeHandler);
  }

  function renderEmptyDetail() {
    return `<div class="mymail-empty-state">
      ${IC.envelope}
      <h3>Выберите письмо</h3>
      <p>Выберите письмо из списка или нажмите <span class="mymail-kbd">C</span> чтобы написать новое</p>
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════════════
     DATA LOADING
     ═══════════════════════════════════════════════════════════════════ */
  async function loadAccount() {
    try {
      const data = await api('/account');
      state.configured = data.configured;
      state.account = data.account;
    } catch (e) {
      state.configured = false;
    }
  }

  async function loadFolders() {
    try {
      const data = await api('/folders');
      state.folders = data.folders || [];
      if (!state.currentFolder && state.folders.length > 0) {
        const inbox = state.folders.find(f => f.folder_type === 'inbox');
        state.currentFolder = inbox || state.folders[0];
        state.currentFolderType = state.currentFolder.folder_type;
      }
    } catch (e) {
      state.folders = [];
    }
  }

  async function loadEmails() {
    const listEl = $('#mymail-list');
    if (!listEl) return;
    listEl.innerHTML = `<div class="mymail-loading"><div class="spinner"></div>Загрузка писем...</div>`;

    try {
      const params = new URLSearchParams();
      if (state.currentFolder) params.set('folder_id', state.currentFolder.id);
      if (state.currentFolderType === 'trash') params.set('is_deleted', 'true');
      if (state.currentFolderType === 'drafts') params.set('is_draft', 'true');
      if (state.search) params.set('search', state.search);
      params.set('limit', state.limit);
      params.set('offset', state.page * state.limit);

      const data = await api('/emails?' + params.toString());
      state.emails = data.emails || [];
      state.total = data.total || 0;

      renderEmailList();
      renderPager();
    } catch (e) {
      listEl.innerHTML = `<div class="mymail-empty-state"><h3>Ошибка загрузки</h3><p>${esc(e.message)}</p></div>`;
    }
  }

  async function loadStats() {
    try {
      const data = await api('/stats');
      state.stats = data;
      if (data.folders) {
        for (const f of data.folders) {
          const badge = document.querySelector(`.mymail-folder-badge[data-folder="${f.id}"]`);
          if (badge) {
            const count = f.unread_count || 0;
            badge.textContent = count > 0 ? count : '';
            badge.style.display = count > 0 ? '' : 'none';
            badge.classList.toggle('pulse', count > 0);
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  async function loadContacts() {
    try {
      const data = await api('/contacts');
      state.contacts = data.contacts || [];
    } catch (e) { state.contacts = []; }
  }

  /* ═══════════════════════════════════════════════════════════════════
     RENDER: FOLDERS
     ═══════════════════════════════════════════════════════════════════ */
  function renderFolders() {
    const container = $('#mymail-folders');
    if (!container) return;

    const system = state.folders.filter(f => ['inbox','sent','drafts','spam','trash'].includes(f.folder_type));
    const custom = state.folders.filter(f => !['inbox','sent','drafts','spam','trash'].includes(f.folder_type));

    let html = system.map(folderHtml).join('');
    if (custom.length > 0) {
      html += '<div class="mymail-sidebar-divider"></div>';
      html += custom.map(folderHtml).join('');
    }
    html += '<div class="mymail-sidebar-divider"></div>';
    html += `<button class="mymail-create-folder-btn" id="mymail-create-folder">${IC.plus} <span>Создать папку</span></button>`;

    container.innerHTML = html;

    // Events
    container.querySelectorAll('.mymail-folder-item').forEach(el => {
      el.addEventListener('click', () => selectFolder(parseInt(el.dataset.folderId)));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showFolderContextMenu(e, parseInt(el.dataset.folderId));
      });
      // Drag-drop target
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        const emailId = parseInt(e.dataTransfer.getData('text/plain'));
        const folderId = parseInt(el.dataset.folderId);
        if (emailId && folderId) moveEmail(emailId, folderId);
      });
    });

    const createBtn = $('#mymail-create-folder');
    if (createBtn) createBtn.addEventListener('click', promptCreateFolder);
  }

  function folderHtml(f) {
    const active = state.currentFolder?.id === f.id ? ' active' : '';
    const icon = folderIcon(f.folder_type);
    const count = f.unread_count || 0;
    const badge = count > 0
      ? `<span class="mymail-folder-badge pulse" data-folder="${f.id}">${count}</span>`
      : `<span class="mymail-folder-badge" data-folder="${f.id}" style="display:none"></span>`;
    return `<div class="mymail-folder-item${active}" data-folder-id="${f.id}" data-folder-type="${f.folder_type}">
      <span class="mymail-folder-icon">${icon}</span>
      <span class="mymail-folder-name">${esc(f.name)}</span>
      ${badge}
    </div>`;
  }

  function selectFolder(folderId) {
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) return;
    state.currentFolder = folder;
    state.currentFolderType = folder.folder_type;
    state.page = 0;
    state.selectedId = null;
    state.selectedEmail = null;
    state.selectedIds.clear();
    state.focusedIdx = -1;
    renderFolders();
    loadEmails();
    clearDetail();
  }

  /* ═══════════════════════════════════════════════════════════════════
     RENDER: ACCOUNT INFO
     ═══════════════════════════════════════════════════════════════════ */
  function renderAccountInfo() {
    const el = $('#mymail-account-info');
    if (!el || !state.account) return;
    const letter = avatarLetter(state.account.display_name, state.account.email_address);
    const color = hashColor(state.account.email_address);
    el.innerHTML = `
      <div class="mymail-account-card">
        <div class="mymail-account-avatar" style="background:linear-gradient(135deg,${color},${color}dd)">${letter}</div>
        <div style="overflow:hidden;flex:1;min-width:0">
          <div class="mymail-account-name">${esc(state.account.display_name || '')}</div>
          <div class="mymail-account-email">${esc(state.account.email_address || '')}</div>
        </div>
      </div>`;
  }

  /* ═══════════════════════════════════════════════════════════════════
     RENDER: EMAIL LIST (с аватарами + группировка по дате)
     ═══════════════════════════════════════════════════════════════════ */
  function renderEmailList() {
    const listEl = $('#mymail-list');
    if (!listEl) return;
    const savedScroll = listEl.scrollTop;

    if (state.emails.length === 0) {
      const folderName = state.currentFolder?.name || 'папке';
      listEl.innerHTML = `<div class="mymail-empty-state">
        ${IC.envelope}
        <h3>Нет писем</h3>
        <p>В ${esc(folderName)} пока нет писем</p>
        <button class="mymail-reply-btn primary" onclick="AsgardMyMailPage.openCompose()" style="margin:8px auto 0;display:inline-flex">
          ${IC.compose} Написать письмо
        </button>
      </div>`;
      return;
    }

    let html = '';
    let lastGroup = '';

    state.emails.forEach((e, idx) => {
      const group = getDateGroup(e.email_date);
      if (group !== lastGroup) {
        html += `<div class="mymail-date-group">${esc(group)}</div>`;
        lastGroup = group;
      }
      html += emailRowHtml(e, idx);
    });

    listEl.innerHTML = html;

    // Bind row events
    listEl.querySelectorAll('.mymail-email-row').forEach(row => {
      row.addEventListener('click', () => selectEmail(parseInt(row.dataset.id)));
      // Draggable
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', row.dataset.id);
        row.style.opacity = '0.5';
      });
      row.addEventListener('dragend', () => { row.style.opacity = '1'; });
    });

    listEl.querySelectorAll('.mymail-email-cb').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const id = parseInt(cb.dataset.id);
        if (cb.checked) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
        updateBulkActions();
      });
    });

    // Restore scroll position
    listEl.scrollTop = savedScroll;
  }

  function emailRowHtml(e, idx) {
    const isSelected = state.selectedId === e.id;
    const isChecked = state.selectedIds.has(e.id);
    const unread = !e.is_read;
    const starred = e.is_starred;
    const focused = state.focusedIdx === idx;

    const from = e.direction === 'outbound'
      ? 'Кому: ' + (e.to_emails?.[0]?.address || e.to_emails?.[0] || '...')
      : (e.from_name || e.from_email || '?');

    const senderForAvatar = e.direction === 'outbound'
      ? (e.to_emails?.[0]?.address || 'O')
      : (e.from_name || e.from_email || '?');
    const letter = avatarLetter(e.from_name, e.from_email);
    const color = hashColor(senderForAvatar);

    const cls = [
      'mymail-email-row',
      isSelected ? 'selected' : '',
      unread ? 'unread' : '',
      focused ? 'focused' : ''
    ].filter(Boolean).join(' ');

    return `<div class="${cls}" data-id="${e.id}" data-idx="${idx}">
      <label class="mymail-checkbox-wrap" onclick="event.stopPropagation()">
        <input type="checkbox" class="mymail-email-cb" data-id="${e.id}" ${isChecked ? 'checked' : ''}>
      </label>
      <div class="mymail-email-avatar" style="background:${color}">${letter}</div>
      <span class="mymail-star${starred?' active':''}" data-id="${e.id}" onclick="event.stopPropagation();AsgardMyMailPage.toggleStar(${e.id})">${starred?IC.starFull:IC.star}</span>
      <span class="mymail-email-from">${esc(from)}</span>
      <span class="mymail-email-subject">${esc(e.subject || '(без темы)')}<span class="mymail-email-snippet"> — ${esc(e.snippet || '')}</span></span>
      ${e.has_attachments ? '<span class="mymail-email-attach" title="Вложения">'+IC.attach+'</span>' : ''}
      <span class="mymail-email-date">${fmtDate(e.email_date)}</span>
      <div class="mymail-email-hover-actions">
        <button class="mymail-btn-icon" onclick="event.stopPropagation();AsgardMyMailPage.archiveEmail(${e.id})" title="Архив">${IC.archive}</button>
        <button class="mymail-btn-icon" onclick="event.stopPropagation();AsgardMyMailPage.deleteEmail(${e.id})" title="Удалить">${IC.del}</button>
        <button class="mymail-btn-icon" onclick="event.stopPropagation();AsgardMyMailPage.toggleStar(${e.id})" title="Отметить">${starred?IC.starFull:IC.star}</button>
      </div>
    </div>`;
  }

  function renderPager() {
    const pager = $('#mymail-pager');
    if (!pager) return;
    const totalPages = Math.ceil(state.total / state.limit);
    if (totalPages <= 1) { pager.innerHTML = ''; return; }

    const from = state.page * state.limit + 1;
    const to = Math.min((state.page + 1) * state.limit, state.total);

    pager.innerHTML = `
      <span class="mymail-pager-info">${from}–${to} из ${state.total}</span>
      <button class="mymail-btn-icon" id="mymail-prev" ${state.page===0?'disabled':''}>${IC.collapse}</button>
      <button class="mymail-btn-icon" id="mymail-next" ${state.page>=totalPages-1?'disabled':''}>${IC.expand}</button>
    `;

    const prev = $('#mymail-prev');
    const next = $('#mymail-next');
    if (prev) prev.addEventListener('click', () => { if (state.page > 0) { state.page--; loadEmails(); } });
    if (next) next.addEventListener('click', () => { if (state.page < totalPages - 1) { state.page++; loadEmails(); } });
  }

  function clearDetail() {
    const detail = $('#mymail-detail');
    if (detail) detail.innerHTML = renderEmptyDetail();
    hideMobileActions();
  }

  /* ═══════════════════════════════════════════════════════════════════
     EMAIL DETAIL (premium)
     ═══════════════════════════════════════════════════════════════════ */
  async function selectEmail(id) {
    state.selectedId = id;
    state.focusedIdx = state.emails.findIndex(e => e.id === id);
    const detailEl = $('#mymail-detail');
    if (!detailEl) return;
    detailEl.innerHTML = `<div class="mymail-loading"><div class="spinner"></div></div>`;

    // Highlight in list
    $$('.mymail-email-row').forEach(r => r.classList.toggle('selected', parseInt(r.dataset.id) === id));

    // Show detail panel on mobile
    const panel = $('#mymail-detail-panel');
    if (panel) panel.classList.add('visible');

    try {
      const data = await api('/emails/' + id);
      state.selectedEmail = data.email;
      const e = data.email;

      const senderLetter = avatarLetter(e.from_name, e.from_email);
      const senderColor = hashColor(e.from_email);
      const toList = (e.to_emails || []).map(t => t.address || t).join(', ');
      const ccList = (e.cc_emails || []).filter(c => c.address || c).map(c => c.address || c).join(', ');

      // Attachments
      let attachHtml = '';
      if (data.attachments && data.attachments.length > 0) {
        const nonInline = data.attachments.filter(a => !a.is_inline);
        if (nonInline.length > 0) {
          attachHtml = `<div class="mymail-attachments">
            <div class="mymail-attach-header">Вложения (${nonInline.length})</div>
            ${nonInline.map(a => {
              const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(a.original_filename || a.filename || '');
              const preview = isImg ? `<img class="mymail-attach-preview" src="/api/my-mail/attachments/${a.id}/download" alt="">` : '';
              return `<a class="mymail-attach-item" href="/api/my-mail/attachments/${a.id}/download" target="_blank">
                ${preview}${IC.attach} ${esc(a.original_filename || a.filename)} <span class="mymail-attach-size">(${formatFileSize(a.size)})</span>
              </a>`;
            }).join('')}
          </div>`;
        }
      }

      // Thread (collapsible Gmail-like)
      let threadHtml = '';
      if (data.thread && data.thread.length > 0) {
        const otherMessages = data.thread.filter(t => t.id !== e.id);
        threadHtml = `<div class="mymail-thread">
          <div class="mymail-thread-header">Цепочка (${data.thread.length + 1} писем)</div>
          ${otherMessages.map(t => {
            const tColor = hashColor(t.from_email);
            const tLetter = avatarLetter(t.from_name, t.from_email);
            return `<div class="mymail-thread-msg" data-thread-id="${t.id}">
              <div class="mymail-thread-toggle" onclick="AsgardMyMailPage.toggleThread(this)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                <div class="mymail-email-avatar" style="background:${tColor};width:24px;height:24px;font-size:10px">${tLetter}</div>
                <span class="mymail-thread-from">${esc(t.from_name || t.from_email || '?')}</span>
                <span class="mymail-thread-snippet">${esc(t.snippet || '')}</span>
                <span class="mymail-thread-date">${fmtDate(t.email_date)}</span>
              </div>
              <div class="mymail-thread-collapsed mymail-thread-body">${t.body_html || (t.body_text || '').replace(/\n/g,'<br>') || '<em>Пустое</em>'}</div>
            </div>`;
          }).join('')}
        </div>`;
      }

      detailEl.innerHTML = `
        <div class="mymail-detail-header">
          <button class="mymail-btn-icon mymail-back-btn" id="mymail-back-btn" title="Назад">${IC.back}</button>
          <h2 class="mymail-detail-subject">${esc(e.subject || '(без темы)')}</h2>
          <div class="mymail-detail-actions">
            <button class="mymail-btn-icon" onclick="AsgardMyMailPage.reply(${e.id})" title="Ответить (R)">${IC.reply}</button>
            <button class="mymail-btn-icon" onclick="AsgardMyMailPage.replyAll(${e.id})" title="Ответить всем (A)">A</button>
            <button class="mymail-btn-icon" onclick="AsgardMyMailPage.forward(${e.id})" title="Переслать (F)">${IC.forward}</button>
            <button class="mymail-btn-icon" onclick="AsgardMyMailPage.deleteEmail(${e.id})" title="Удалить (#)">${IC.del}</button>
            <button class="mymail-btn-icon" onclick="AsgardMyMailPage.printEmail()" title="Печать">${IC.print}</button>
            <button class="mymail-btn-icon" id="mymail-zoom-in" title="Увеличить шрифт">${IC.zoomIn}</button>
            <button class="mymail-btn-icon" id="mymail-zoom-out" title="Уменьшить шрифт">${IC.zoomOut}</button>
            <button class="mymail-btn-icon" id="mymail-show-raw" title="Показать оригинал">{ }</button>
          </div>
        </div>
        <div class="mymail-detail-meta">
          <div class="mymail-detail-sender-avatar" style="background:linear-gradient(135deg,${senderColor},${senderColor}dd)">${senderLetter}</div>
          <div class="mymail-detail-meta-info">
            <div class="mymail-detail-from">
              ${esc(e.from_name || e.from_email || '?')}
              ${e.from_name ? `<span class="mymail-meta-email"> &lt;${esc(e.from_email || '')}&gt;</span>` : ''}
            </div>
            <div class="mymail-detail-to">Кому: ${esc(toList)}</div>
            ${ccList ? `<div class="mymail-detail-cc">Копия: ${esc(ccList)}</div>` : ''}
          </div>
          <div class="mymail-detail-date">${fmtFullDate(e.email_date)}</div>
        </div>
        ${attachHtml}
        <div class="mymail-detail-body ${state.bodyZoom}" id="mymail-body-container"></div>
        ${threadHtml}
        <div class="mymail-detail-footer">
          <button class="mymail-reply-btn primary" onclick="AsgardMyMailPage.reply(${e.id})">
            ${IC.reply} Ответить
          </button>
          <button class="mymail-reply-btn" onclick="AsgardMyMailPage.replyAll(${e.id})">
            ${IC.reply} Ответить всем
          </button>
          <button class="mymail-reply-btn" onclick="AsgardMyMailPage.forward(${e.id})">
            ${IC.forward} Переслать
          </button>
        </div>
      `;

      // Render email body in sandboxed iframe (XSS protection)
      const bodyContainer = $('#mymail-body-container');
      if (bodyContainer) {
        const bodyContent = e.body_html || (e.body_text || '').replace(/\n/g, '<br>') || '<p style="color:#666">(пустое письмо)</p>';
        renderEmailBody(bodyContainer, bodyContent);
      }

      // Back button (mobile)
      const backBtn = $('#mymail-back-btn');
      if (backBtn) backBtn.addEventListener('click', () => {
        panel?.classList.remove('visible');
        state.selectedId = null;
        hideMobileActions();
      });

      // Zoom (changes iframe body font-size)
      const zoomLevels = ['zoom-sm','zoom-md','zoom-lg','zoom-xl'];
      const fontSizes = { 'zoom-sm':'12px', 'zoom-md':'14px', 'zoom-lg':'17px', 'zoom-xl':'20px' };
      const zoomIn = $('#mymail-zoom-in');
      const zoomOut = $('#mymail-zoom-out');
      function applyZoom() {
        const container = $('#mymail-body-container');
        if (!container) return;
        container.className = 'mymail-detail-body ' + state.bodyZoom;
        const iframe = container.querySelector('iframe');
        if (iframe) {
          try {
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            doc.body.style.fontSize = fontSizes[state.bodyZoom] || '14px';
          } catch (err) { /* cross-origin */ }
        }
      }
      if (zoomIn) zoomIn.addEventListener('click', () => {
        const idx = zoomLevels.indexOf(state.bodyZoom);
        if (idx < zoomLevels.length - 1) { state.bodyZoom = zoomLevels[idx + 1]; applyZoom(); }
      });
      if (zoomOut) zoomOut.addEventListener('click', () => {
        const idx = zoomLevels.indexOf(state.bodyZoom);
        if (idx > 0) { state.bodyZoom = zoomLevels[idx - 1]; applyZoom(); }
      });

      // Show raw headers
      const rawBtn = $('#mymail-show-raw');
      if (rawBtn) rawBtn.addEventListener('click', async () => {
        const existing = detailEl.querySelector('.mymail-raw-headers');
        if (existing) { existing.remove(); return; }
        try {
          const rawData = await api('/emails/' + id + '?raw_headers=true');
          const headers = rawData.email?.raw_headers || rawData.email?.headers_json || 'Заголовки недоступны';
          const rawEl = document.createElement('div');
          rawEl.className = 'mymail-raw-headers';
          rawEl.innerHTML = `<pre>${esc(typeof headers === 'string' ? headers : JSON.stringify(headers, null, 2))}</pre>`;
          detailEl.querySelector('.mymail-detail-body')?.after(rawEl);
        } catch (er) { toast('Ошибка', er.message, 'err'); }
      });

      // Mark as read in list
      const row = document.querySelector(`.mymail-email-row[data-id="${id}"]`);
      if (row) row.classList.remove('unread');

      // Mobile actions
      showMobileActions(e.id);

      loadStats();
    } catch (e) {
      detailEl.innerHTML = `<div class="mymail-empty-state"><h3>Ошибка</h3><p>${esc(e.message)}</p></div>`;
    }
  }

  function showMobileActions(emailId) {
    const el = $('#mymail-mobile-actions');
    if (!el) return;
    el.style.display = '';
    el.innerHTML = `
      <button class="mymail-btn-icon" onclick="AsgardMyMailPage.reply(${emailId})" title="Ответить">${IC.reply}</button>
      <button class="mymail-btn-icon" onclick="AsgardMyMailPage.forward(${emailId})" title="Переслать">${IC.forward}</button>
      <button class="mymail-btn-icon" onclick="AsgardMyMailPage.archiveEmail(${emailId})" title="Архив">${IC.archive}</button>
      <button class="mymail-btn-icon" onclick="AsgardMyMailPage.deleteEmail(${emailId})" title="Удалить">${IC.del}</button>
    `;
  }

  function hideMobileActions() {
    const el = $('#mymail-mobile-actions');
    if (el) el.style.display = 'none';
  }

  /* ═══════════════════════════════════════════════════════════════════
     COMPOSE (Premium)
     ═══════════════════════════════════════════════════════════════════ */
  function openCompose(data = {}) {
    const overlay = $('#mymail-compose-overlay');
    if (!overlay) return;

    state.composing = true;
    state.composeData = data;
    composeAttachments = [];

    // Auto-insert signature
    let bodyContent = data.body || '';
    if (!data.body && state.account?.signature_html) {
      bodyContent = '<br><br>' + state.account.signature_html;
    }

    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="mymail-compose-window" id="mymail-compose-win">
        <div class="mymail-compose-header">
          <span>${esc(data.title || 'Новое письмо')}</span>
          <div class="mymail-compose-header-actions">
            <button class="mymail-compose-expand" id="mymail-compose-fullscreen" title="Полный экран">${IC.fullscreen}</button>
            <button class="mymail-compose-close" id="mymail-compose-close">&times;</button>
          </div>
        </div>
        <div class="mymail-compose-fields">
          <div class="mymail-compose-row" style="position:relative">
            <label>Кому:</label>
            <input type="text" id="mymail-to" value="${esc(data.to || '')}" placeholder="email@example.com" autocomplete="off">
            <div class="mymail-contact-suggest" id="mymail-contact-suggest" style="display:none"></div>
          </div>
          <div class="mymail-compose-row">
            <label>Копия:</label>
            <input type="text" id="mymail-cc" value="${esc(data.cc || '')}" placeholder="email@example.com">
          </div>
          <div class="mymail-compose-row">
            <label>Тема:</label>
            <input type="text" id="mymail-subject" value="${esc(data.subject || '')}">
          </div>
        </div>
        <div class="mymail-compose-body-wrap">
          <div class="mymail-compose-toolbar-fmt">
            <button onclick="document.execCommand('bold')" title="Жирный (Ctrl+B)"><b>B</b></button>
            <button onclick="document.execCommand('italic')" title="Курсив (Ctrl+I)"><i>I</i></button>
            <button onclick="document.execCommand('underline')" title="Подчёркнутый (Ctrl+U)"><u>U</u></button>
            <button onclick="document.execCommand('strikeThrough')" title="Зачёркнутый"><s>S</s></button>
            <div class="sep"></div>
            <button onclick="document.execCommand('justifyLeft')" title="По левому краю">&#8676;</button>
            <button onclick="document.execCommand('justifyCenter')" title="По центру">&#8696;</button>
            <button onclick="document.execCommand('justifyRight')" title="По правому краю">&#8677;</button>
            <div class="sep"></div>
            <button onclick="document.execCommand('insertUnorderedList')" title="Список">&#8226;</button>
            <button onclick="document.execCommand('insertOrderedList')" title="Нумерованный список">1.</button>
            <div class="sep"></div>
            <button id="mymail-insert-link" title="Ссылка">&#128279;</button>
            <div class="sep"></div>
            <button id="mymail-color-btn" title="Цвет текста" style="position:relative">A
              <div class="mymail-color-picker" id="mymail-color-picker"></div>
            </button>
            <button id="mymail-fontsize-btn" title="Размер шрифта" style="position:relative">T&#8597;
              <div class="mymail-fontsize-picker" id="mymail-fontsize-picker"></div>
            </button>
            <div class="sep"></div>
            <button onclick="document.execCommand('removeFormat')" title="Очистить форматирование">&#10006;</button>
          </div>
          <div class="mymail-compose-body" id="mymail-compose-body" contenteditable="true">${bodyContent}</div>
          <div class="mymail-compose-dropzone" id="mymail-compose-dropzone">
            ${IC.attach}
            <span>Перетащите файлы сюда</span>
          </div>
        </div>
        <div class="mymail-compose-footer">
          <button class="mymail-compose-send" id="mymail-compose-send">Отправить</button>
          <button class="mymail-compose-draft" id="mymail-compose-draft">Черновик</button>
          <label class="mymail-compose-attach-btn">
            ${IC.attach} Прикрепить
            <input type="file" id="mymail-attach-input" multiple style="display:none">
          </label>
          <span class="mymail-autosave-indicator"><span class="dot"></span><span id="mymail-autosave-ind"></span></span>
          <span class="mymail-compose-shortcut">Ctrl+Enter — отправить</span>
          <div class="mymail-compose-attachments" id="mymail-compose-attachments"></div>
        </div>
      </div>
    `;

    bindComposeEvents();

    // Focus
    setTimeout(() => {
      const toField = $('#mymail-to');
      if (toField && !toField.value) toField.focus();
      else $('#mymail-compose-body')?.focus();
    }, 100);

    // Start autosave drafts timer
    startDraftAutoSave();
  }

  function bindComposeEvents() {
    $('#mymail-compose-close')?.addEventListener('click', closeCompose);
    $('#mymail-compose-send')?.addEventListener('click', sendCompose);
    $('#mymail-compose-draft')?.addEventListener('click', saveDraft);
    $('#mymail-attach-input')?.addEventListener('change', handleAttachments);

    // Close on backdrop click
    const overlay = $('#mymail-compose-overlay');
    if (overlay) overlay.addEventListener('click', (e) => {
      if (e.target === overlay) AsgardUI.oopsBubble(e.clientX, e.clientY);
    });

    // Fullscreen toggle
    $('#mymail-compose-fullscreen')?.addEventListener('click', () => {
      const win = $('#mymail-compose-win');
      if (win) win.classList.toggle('fullscreen');
    });

    // Insert link
    $('#mymail-insert-link')?.addEventListener('click', () => {
      const url = prompt('Введите URL:');
      if (url) document.execCommand('createLink', false, url);
    });

    // Color picker
    const colorBtn = $('#mymail-color-btn');
    const colorPicker = $('#mymail-color-picker');
    if (colorBtn && colorPicker) {
      const colors = ['#ffffff','#cccccc','#999999','#333333','#C8293B','#E8475A','#1E4D8C','#4A90D9','#D4A843','#2D8659','#7B3FA0','#C75B39'];
      colorPicker.innerHTML = colors.map(c =>
        `<div class="mymail-color-swatch" style="background:${c}" data-color="${c}"></div>`
      ).join('');
      colorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        colorPicker.classList.toggle('visible');
      });
      colorPicker.querySelectorAll('.mymail-color-swatch').forEach(sw => {
        sw.addEventListener('click', (e) => {
          e.stopPropagation();
          document.execCommand('foreColor', false, sw.dataset.color);
          colorPicker.classList.remove('visible');
        });
      });
    }

    // Font size picker
    const fsBtn = $('#mymail-fontsize-btn');
    const fsPicker = $('#mymail-fontsize-picker');
    if (fsBtn && fsPicker) {
      const sizes = [{label:'Мелкий', val:'1'},{label:'Обычный', val:'3'},{label:'Средний', val:'4'},{label:'Крупный', val:'5'},{label:'Большой', val:'6'}];
      fsPicker.innerHTML = sizes.map(s =>
        `<div class="mymail-fontsize-option" data-size="${s.val}">${s.label}</div>`
      ).join('');
      fsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fsPicker.classList.toggle('visible');
      });
      fsPicker.querySelectorAll('.mymail-fontsize-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          document.execCommand('fontSize', false, opt.dataset.size);
          fsPicker.classList.remove('visible');
        });
      });
    }

    // Close pickers on outside click
    document.addEventListener('click', () => {
      colorPicker?.classList.remove('visible');
      fsPicker?.classList.remove('visible');
    });

    // Ctrl+Enter to send
    const composeBody = $('#mymail-compose-body');
    if (composeBody) {
      composeBody.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          sendCompose();
        }
      });
    }

    // Contact autocomplete on "To" field
    const toField = $('#mymail-to');
    if (toField) {
      let suggestTimer;
      toField.addEventListener('input', () => {
        clearTimeout(suggestTimer);
        suggestTimer = setTimeout(() => showContactSuggestions(toField.value), 200);
      });
      toField.addEventListener('blur', () => {
        setTimeout(() => { const s = $('#mymail-contact-suggest'); if (s) s.style.display = 'none'; }, 200);
      });
    }

    // Drag & drop files
    const win = $('#mymail-compose-win');
    const dropzone = $('#mymail-compose-dropzone');
    if (win && dropzone) {
      let dragCounter = 0;
      win.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropzone.classList.add('active');
      });
      win.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) { dropzone.classList.remove('active'); dragCounter = 0; }
      });
      win.addEventListener('dragover', (e) => e.preventDefault());
      win.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropzone.classList.remove('active');
        if (e.dataTransfer.files?.length) {
          processFiles(e.dataTransfer.files);
        }
      });
    }
  }

  function showContactSuggestions(value) {
    const suggest = $('#mymail-contact-suggest');
    if (!suggest) return;

    const parts = value.split(',');
    const query = (parts[parts.length - 1] || '').trim().toLowerCase();
    if (query.length < 2) { suggest.style.display = 'none'; return; }

    const matches = state.contacts.filter(c =>
      (c.email && c.email.toLowerCase().includes(query)) ||
      (c.name && c.name.toLowerCase().includes(query))
    ).slice(0, 8);

    if (matches.length === 0) { suggest.style.display = 'none'; return; }

    suggest.style.display = 'block';
    suggest.innerHTML = matches.map(c => `
      <div class="mymail-contact-item" data-email="${esc(c.email)}">
        <div class="mymail-email-avatar" style="background:${hashColor(c.email)};width:28px;height:28px;font-size:11px">${avatarLetter(c.name, c.email)}</div>
        <div>
          <div class="mymail-contact-name">${esc(c.name || c.email)}</div>
          ${c.name ? `<div class="mymail-contact-email">${esc(c.email)}</div>` : ''}
        </div>
      </div>
    `).join('');

    suggest.querySelectorAll('.mymail-contact-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const email = item.dataset.email;
        const toField = $('#mymail-to');
        if (toField) {
          const parts = toField.value.split(',').map(s => s.trim()).filter(Boolean);
          parts.pop(); // remove current typing
          parts.push(email);
          toField.value = parts.join(', ') + ', ';
          toField.focus();
        }
        suggest.style.display = 'none';
      });
    });
  }

  function closeCompose() {
    const overlay = $('#mymail-compose-overlay');
    if (overlay) overlay.style.display = 'none';
    state.composing = false;
    state.composeData = null;
    composeAttachments = [];
    stopDraftAutoSave();
  }

  function handleAttachments(e) {
    if (e.target.files?.length) processFiles(e.target.files);
  }

  function processFiles(files) {
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) {
        toast('Файл слишком большой', file.name + ' превышает 25 МБ', 'err');
        continue;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target.result.split(',')[1];
        composeAttachments.push({ filename: file.name, content: base64, size: file.size });
        renderComposeAttachments();
      };
      reader.readAsDataURL(file);
    }
  }

  function renderComposeAttachments() {
    const el = $('#mymail-compose-attachments');
    if (!el) return;
    el.innerHTML = composeAttachments.map((a, i) => `
      <span class="mymail-compose-att-item">
        ${IC.attach} ${esc(a.filename)} (${formatFileSize(a.size)})
        <span class="mymail-compose-att-remove" onclick="AsgardMyMailPage.removeAttachment(${i})">&times;</span>
      </span>
    `).join('');
  }

  function removeAttachment(idx) {
    composeAttachments.splice(idx, 1);
    renderComposeAttachments();
  }

  async function sendCompose() {
    const to = $('#mymail-to')?.value?.trim();
    const cc = $('#mymail-cc')?.value?.trim();
    const subject = $('#mymail-subject')?.value?.trim();
    const bodyEl = $('#mymail-compose-body');
    const body_html = bodyEl?.innerHTML || '';
    const body_text = bodyEl?.innerText || '';

    if (!to) { toast('Укажите получателя', '', 'warn'); return; }
    if (!subject) { toast('Укажите тему письма', '', 'warn'); return; }

    const sendBtn = $('#mymail-compose-send');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.classList.add('loading'); sendBtn.textContent = 'Отправка'; }

    try {
      await api('/send', {
        method: 'POST',
        body: {
          to: to.split(',').map(s => s.trim()).filter(Boolean),
          cc: cc ? cc.split(',').map(s => s.trim()).filter(Boolean) : undefined,
          subject,
          body_html,
          body_text,
          reply_to_email_id: state.composeData?.reply_to_email_id,
          forward_of_email_id: state.composeData?.forward_of_email_id,
          is_crm_action: false,
          attachments: composeAttachments
        }
      });

      toast('Письмо отправлено', '', 'ok');
      composeAttachments = [];
      closeCompose();
      loadEmails();
      loadStats();
    } catch (e) {
      toast('Ошибка отправки', e.message, 'err');
      if (sendBtn) { sendBtn.disabled = false; sendBtn.classList.remove('loading'); sendBtn.textContent = 'Отправить'; }
    }
  }

  async function saveDraft() {
    const to = $('#mymail-to')?.value?.trim();
    const cc = $('#mymail-cc')?.value?.trim();
    const subject = $('#mymail-subject')?.value?.trim();
    const bodyEl = $('#mymail-compose-body');

    try {
      await api('/drafts', {
        method: 'POST',
        body: {
          to: to ? to.split(',').map(s => s.trim()) : [],
          cc: cc ? cc.split(',').map(s => s.trim()) : [],
          subject: subject || '',
          body_html: bodyEl?.innerHTML || '',
          body_text: bodyEl?.innerText || '',
          reply_to_email_id: state.composeData?.reply_to_email_id
        }
      });
      toast('Черновик сохранён', '', 'ok');
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  function startDraftAutoSave() {
    stopDraftAutoSave();
    state.draftAutoSaveTimer = setInterval(async () => {
      const bodyEl = $('#mymail-compose-body');
      if (bodyEl && bodyEl.innerText.trim().length > 10) {
        try {
          await silentSaveDraft();
          const ind = $('#mymail-autosave-ind');
          if (ind) { ind.textContent = 'Сохранено'; setTimeout(() => { if (ind) ind.textContent = ''; }, 2000); }
        } catch (e) { /* silent */ }
      }
    }, 60000); // каждые 60 сек
  }

  async function silentSaveDraft() {
    const to = $('#mymail-to')?.value?.trim();
    const cc = $('#mymail-cc')?.value?.trim();
    const subject = $('#mymail-subject')?.value?.trim();
    const bodyEl = $('#mymail-compose-body');
    await api('/drafts', {
      method: 'POST',
      body: {
        to: to ? to.split(',').map(s => s.trim()) : [],
        cc: cc ? cc.split(',').map(s => s.trim()) : [],
        subject: subject || '',
        body_html: bodyEl?.innerHTML || '',
        body_text: bodyEl?.innerText || '',
        reply_to_email_id: state.composeData?.reply_to_email_id
      }
    });
  }

  function stopDraftAutoSave() {
    if (state.draftAutoSaveTimer) { clearInterval(state.draftAutoSaveTimer); state.draftAutoSaveTimer = null; }
  }

  /* ═══════════════════════════════════════════════════════════════════
     ACTIONS
     ═══════════════════════════════════════════════════════════════════ */
  function reply(emailId) {
    const e = state.selectedEmail;
    if (!e) return;
    openCompose({
      title: 'Ответ',
      to: e.from_email || '',
      subject: e.subject?.startsWith('Re:') ? e.subject : 'Re: ' + (e.subject || ''),
      body: `<br><br><blockquote style="border-left:3px solid rgba(255,255,255,0.1);padding-left:16px;margin-left:0;color:rgba(255,255,255,0.5)">${fmtFullDate(e.email_date)}, ${esc(e.from_name || e.from_email || '')}:<br>${e.body_html || (e.body_text || '').replace(/\n/g, '<br>')}</blockquote>`,
      reply_to_email_id: emailId
    });
  }

  function replyAll(emailId) {
    const e = state.selectedEmail;
    if (!e) return;
    const allTo = [e.from_email, ...(e.to_emails || []).map(t => t.address || t)].filter(Boolean);
    const myEmail = state.account?.email_address;
    const toFiltered = allTo.filter(addr => addr !== myEmail);

    openCompose({
      title: 'Ответ всем',
      to: toFiltered.join(', '),
      cc: (e.cc_emails || []).map(c => c.address || c).filter(Boolean).join(', '),
      subject: e.subject?.startsWith('Re:') ? e.subject : 'Re: ' + (e.subject || ''),
      body: `<br><br><blockquote style="border-left:3px solid rgba(255,255,255,0.1);padding-left:16px;margin-left:0;color:rgba(255,255,255,0.5)">${fmtFullDate(e.email_date)}, ${esc(e.from_name || e.from_email || '')}:<br>${e.body_html || (e.body_text || '').replace(/\n/g, '<br>')}</blockquote>`,
      reply_to_email_id: emailId
    });
  }

  function forward(emailId) {
    const e = state.selectedEmail;
    if (!e) return;
    openCompose({
      title: 'Пересылка',
      to: '',
      subject: e.subject?.startsWith('Fwd:') ? e.subject : 'Fwd: ' + (e.subject || ''),
      body: `<br><br><p>---------- Пересланное сообщение ----------</p><p>От: ${esc(e.from_name || '')} &lt;${esc(e.from_email || '')}&gt;<br>Дата: ${fmtFullDate(e.email_date)}<br>Тема: ${esc(e.subject || '')}</p><br>${e.body_html || (e.body_text || '').replace(/\n/g, '<br>')}`,
      forward_of_email_id: emailId
    });
  }

  async function toggleStar(emailId) {
    const email = state.emails.find(e => e.id === emailId);
    if (!email) return;
    const newVal = !email.is_starred;
    try {
      await api('/emails/' + emailId, { method: 'PATCH', body: { is_starred: newVal } });
      email.is_starred = newVal;
      renderEmailList();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  async function deleteEmail(emailId) {
    try {
      await api('/emails/' + emailId, { method: 'PATCH', body: { is_deleted: true } });
      toast('Письмо удалено', '', 'ok');
      clearDetail();
      loadEmails();
      loadStats();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  async function archiveEmail(emailId) {
    const archiveFolder = state.folders.find(f => f.folder_type === 'archive' || f.name === 'Архив');
    if (archiveFolder) {
      await moveEmail(emailId, archiveFolder.id);
    } else {
      // Нет папки «Архив» — помечаем прочитанным и перемещаем в «Все письма» или просто скрываем
      try {
        await api('/emails/' + emailId, { method: 'PATCH', body: { is_read: true } });
        toast('Письмо архивировано', '', 'ok');
        loadEmails();
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    }
  }

  async function moveEmail(emailId, folderId) {
    try {
      await api('/emails/' + emailId + '/move', { method: 'POST', body: { folder_id: folderId } });
      toast('Письмо перемещено', '', 'ok');
      loadEmails();
      loadStats();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  async function bulkAction(action) {
    const ids = [...state.selectedIds];
    if (ids.length === 0) return;
    try {
      await api('/emails/bulk', { method: 'POST', body: { ids, action } });
      state.selectedIds.clear();
      toast('Готово', ids.length + ' писем обработано', 'ok');
      loadEmails();
      loadStats();
      updateBulkActions();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  function updateBulkActions() {
    const el = $('#mymail-bulk-actions');
    if (el) el.style.display = state.selectedIds.size > 0 ? '' : 'none';
  }

  function printEmail() {
    window.print();
  }

  /* ═══════════════════════════════════════════════════════════════════
     FOLDER MANAGEMENT
     ═══════════════════════════════════════════════════════════════════ */
  async function promptCreateFolder() {
    const name = prompt('Название новой папки:');
    if (!name || !name.trim()) return;
    try {
      await api('/folders', { method: 'POST', body: { name: name.trim() } });
      toast('Папка создана', '', 'ok');
      await loadFolders();
      renderFolders();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  async function renameFolder(folderId) {
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) return;
    const name = prompt('Новое название:', folder.name);
    if (!name || !name.trim() || name.trim() === folder.name) return;
    try {
      await api('/folders/' + folderId, { method: 'PUT', body: { name: name.trim() } });
      toast('Папка переименована', '', 'ok');
      await loadFolders();
      renderFolders();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  async function deleteFolder(folderId) {
    if (!confirm('Удалить эту папку? Письма в ней будут перемещены в корзину.')) return;
    try {
      await api('/folders/' + folderId, { method: 'DELETE' });
      toast('Папка удалена', '', 'ok');
      if (state.currentFolder?.id === folderId) {
        state.currentFolder = state.folders.find(f => f.folder_type === 'inbox') || state.folders[0];
        state.currentFolderType = state.currentFolder?.folder_type || 'inbox';
      }
      await loadFolders();
      renderFolders();
      loadEmails();
    } catch (e) { toast('Ошибка', e.message, 'err'); }
  }

  /* ═══════════════════════════════════════════════════════════════════
     CONTEXT MENU
     ═══════════════════════════════════════════════════════════════════ */
  function showFolderContextMenu(e, folderId) {
    removeContextMenu();
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) return;

    const isSystem = ['inbox','sent','drafts','spam','trash'].includes(folder.folder_type);

    const menu = document.createElement('div');
    menu.className = 'mymail-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.innerHTML = `
      ${!isSystem ? `<div class="mymail-context-item" data-action="rename">&#9998; Переименовать</div>` : ''}
      ${!isSystem ? `<div class="mymail-context-item danger" data-action="delete">${IC.del} Удалить папку</div>` : ''}
      ${isSystem ? `<div class="mymail-context-item" style="color:var(--t3);cursor:default">Системная папка</div>` : ''}
    `;

    document.body.appendChild(menu);
    state.contextMenu = menu;

    menu.querySelectorAll('.mymail-context-item[data-action]').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        if (action === 'rename') renameFolder(folderId);
        if (action === 'delete') deleteFolder(folderId);
        removeContextMenu();
      });
    });

    document.addEventListener('click', removeContextMenu, { once: true });
  }

  function removeContextMenu() {
    if (state.contextMenu) {
      state.contextMenu.remove();
      state.contextMenu = null;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     POLLING
     ═══════════════════════════════════════════════════════════════════ */
  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(pollNewMail, 30000);
  }

  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  async function pollNewMail() {
    try {
      const data = await api('/poll');
      if (state.lastPollUnread !== null && data.unread > state.lastPollUnread) {
        const diff = data.unread - state.lastPollUnread;
        showNewMailBanner(diff);
        // Browser notification
        if (Notification?.permission === 'granted') {
          new Notification('Новая почта', { body: diff + ' новых писем', icon: '/assets/img/logo.png' });
        }
      }
      state.lastPollUnread = data.unread;
      loadStats();
    } catch (e) { /* ignore poll errors */ }
  }

  function showNewMailBanner(count) {
    const bannerEl = $('#mymail-new-banner');
    if (!bannerEl) return;
    bannerEl.innerHTML = `<div class="mymail-new-mail-banner" id="mymail-new-banner-bar">
      Новых писем: ${count} &mdash; Нажмите для обновления
    </div>`;
    const bar = $('#mymail-new-banner-bar');
    if (bar) bar.addEventListener('click', () => {
      bannerEl.innerHTML = '';
      loadEmails();
      loadStats();
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     KEYBOARD NAVIGATION
     ═══════════════════════════════════════════════════════════════════ */
  function handleKeydown(e) {
    // Ignore when typing in inputs
    if (state.composing) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

    switch (e.key) {
      case 'j': // next email
        e.preventDefault();
        if (state.focusedIdx < state.emails.length - 1) {
          state.focusedIdx++;
          selectEmail(state.emails[state.focusedIdx].id);
          scrollToFocused();
        }
        break;
      case 'k': // prev email
        e.preventDefault();
        if (state.focusedIdx > 0) {
          state.focusedIdx--;
          selectEmail(state.emails[state.focusedIdx].id);
          scrollToFocused();
        }
        break;
      case 'Enter':
        if (state.focusedIdx >= 0 && state.emails[state.focusedIdx]) {
          e.preventDefault();
          selectEmail(state.emails[state.focusedIdx].id);
        }
        break;
      case 'Escape':
        e.preventDefault();
        if ($('#mymail-detail-panel')?.classList.contains('visible')) {
          $('#mymail-detail-panel').classList.remove('visible');
          hideMobileActions();
        }
        state.selectedId = null;
        clearDetail();
        break;
      case 'c': // compose
        e.preventDefault();
        openCompose();
        break;
      case 'r': // reply
        e.preventDefault();
        if (state.selectedId) reply(state.selectedId);
        break;
      case 'a': // reply all
        e.preventDefault();
        if (state.selectedId) replyAll(state.selectedId);
        break;
      case 'f': // forward
        e.preventDefault();
        if (state.selectedId) forward(state.selectedId);
        break;
      case '#': // delete
        e.preventDefault();
        if (state.selectedId) deleteEmail(state.selectedId);
        break;
      case 'e': // archive
        e.preventDefault();
        if (state.selectedId) archiveEmail(state.selectedId);
        break;
      case '/': // search
        e.preventDefault();
        $('#mymail-search')?.focus();
        break;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     EVENTS
     ═══════════════════════════════════════════════════════════════════ */
  function bindEvents() {
    // Compose button
    $('#mymail-compose-btn')?.addEventListener('click', () => openCompose());

    // Sidebar toggle
    $('#mymail-sidebar-toggle')?.addEventListener('click', () => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      const sidebar = $('#mymail-sidebar');
      const toggle = $('#mymail-sidebar-toggle');
      if (sidebar) sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
      if (toggle) toggle.innerHTML = state.sidebarCollapsed ? IC.expand : IC.collapse;
    });

    // Search
    const searchInput = $('#mymail-search');
    let searchTimer;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          state.search = searchInput.value;
          state.page = 0;
          loadEmails();
        }, 400);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { searchInput.value = ''; searchInput.blur(); state.search = ''; state.page = 0; loadEmails(); }
      });
    }

    // Select all
    const selectAll = $('#mymail-select-all');
    if (selectAll) {
      selectAll.addEventListener('change', () => {
        state.selectedIds.clear();
        if (selectAll.checked) state.emails.forEach(e => state.selectedIds.add(e.id));
        renderEmailList();
        updateBulkActions();
      });
    }

    // Bulk actions
    $$('#mymail-bulk-actions .mymail-btn-icon').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action) bulkAction(action);
      });
    });

    // Sync
    const syncBtn = $('#mymail-sync-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        // Request notification permission on user gesture
        if (Notification && Notification.permission === 'default') {
          Notification.requestPermission();
        }
        syncBtn.disabled = true;
        syncBtn.classList.add('spinning');
        try {
          await api('/sync', { method: 'POST' });
          toast('Синхронизация завершена', '', 'ok');
          loadEmails();
          loadStats();
          loadFolders().then(renderFolders);
        } catch (e) {
          toast('Ошибка синхронизации', e.message, 'err');
        }
        syncBtn.disabled = false;
        syncBtn.classList.remove('spinning');
      });
    }

    // Keyboard nav
    document.addEventListener('keydown', handleKeydown);

    // Request notification permission on first sync click (user gesture required)
    // (moved to sync button handler)
  }

  /* ═══════════════════════════════════════════════════════════════════
     SANDBOXED EMAIL BODY RENDER (XSS protection)
     ═══════════════════════════════════════════════════════════════════ */
  function renderEmailBody(container, html) {
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-same-origin'; // no scripts, no forms, no popups
    iframe.style.cssText = 'width:100%;border:none;min-height:200px;background:transparent;display:block';
    iframe.title = 'Email body';
    container.innerHTML = '';
    container.appendChild(iframe);

    iframe.addEventListener('load', () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const zoomClass = state.bodyZoom;
        const fontSizes = { 'zoom-sm':'12px', 'zoom-md':'14px', 'zoom-lg':'17px', 'zoom-xl':'20px' };
        const fontSize = fontSizes[zoomClass] || '14px';
        doc.open();
        doc.write(`<!DOCTYPE html><html><head><style>
          body{margin:0;padding:0;font-family:Inter,-apple-system,sans-serif;font-size:${fontSize};line-height:1.7;color:rgba(255,255,255,0.95);background:transparent;overflow-wrap:break-word;word-break:break-word}
          a{color:#4A90D9}
          img{max-width:100%;height:auto;border-radius:8px}
          blockquote{border-left:3px solid rgba(255,255,255,0.1);padding-left:16px;margin-left:0;color:rgba(255,255,255,0.65)}
          pre,code{font-family:'JetBrains Mono',monospace;font-size:0.9em;background:rgba(255,255,255,0.05);padding:2px 6px;border-radius:4px}
          table{border-collapse:collapse;max-width:100%}td,th{padding:4px 8px;border:1px solid rgba(255,255,255,0.1)}
        </style></head><body>${html}</body></html>`);
        doc.close();

        // Auto-resize iframe to content height
        const resizeIframe = () => {
          const h = doc.body?.scrollHeight || doc.documentElement?.scrollHeight || 300;
          iframe.style.height = Math.max(h + 20, 200) + 'px';
        };
        resizeIframe();
        // Re-check after images load
        const imgs = doc.querySelectorAll('img');
        imgs.forEach(img => img.addEventListener('load', resizeIframe));
        // Fallback resize after 500ms
        setTimeout(resizeIframe, 500);
      } catch (err) {
        // Fallback: render directly (same-origin should work)
        container.innerHTML = html;
      }
    });
  }

  function scrollToFocused() {
    const row = document.querySelector(`.mymail-email-row[data-idx="${state.focusedIdx}"]`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ═══════════════════════════════════════════════════════════════════
     THREAD TOGGLE (collapsible)
     ═══════════════════════════════════════════════════════════════════ */
  async function toggleThread(toggleEl) {
    const msg = toggleEl.closest('.mymail-thread-msg');
    if (!msg) return;
    const body = msg.querySelector('.mymail-thread-body');
    if (!body) return;
    const isExpanded = toggleEl.classList.contains('expanded');

    if (!isExpanded) {
      // Expand: load full email body if not yet loaded
      if (!msg.dataset.loaded) {
        const threadId = msg.dataset.threadId;
        body.innerHTML = '<div class="mymail-loading"><div class="spinner"></div></div>';
        body.className = 'mymail-thread-expanded mymail-thread-body';
        toggleEl.classList.add('expanded');
        try {
          const data = await api('/emails/' + threadId);
          const e = data.email;
          body.innerHTML = e.body_html || (e.body_text || '').replace(/\n/g, '<br>') || '<em style="color:var(--t3)">Пустое письмо</em>';
          msg.dataset.loaded = '1';
        } catch (err) {
          body.innerHTML = '<p style="color:var(--err-t)">Ошибка загрузки: ' + esc(err.message) + '</p>';
        }
      } else {
        toggleEl.classList.add('expanded');
        body.className = 'mymail-thread-expanded mymail-thread-body';
      }
    } else {
      // Collapse
      toggleEl.classList.remove('expanded');
      body.className = 'mymail-thread-collapsed mymail-thread-body';
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     SWIPE ACTIONS (Mobile touch)
     ═══════════════════════════════════════════════════════════════════ */
  function initSwipeActions() {
    const listEl = $('#mymail-list');
    if (!listEl || !('ontouchstart' in window)) return;

    let startX = 0, startY = 0, currentRow = null, swiping = false;

    listEl.addEventListener('touchstart', (e) => {
      const row = e.target.closest('.mymail-email-row');
      if (!row) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      currentRow = row;
      swiping = false;
    }, { passive: true });

    listEl.addEventListener('touchmove', (e) => {
      if (!currentRow) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (Math.abs(dy) > Math.abs(dx)) { currentRow = null; return; }
      if (Math.abs(dx) > 30) swiping = true;
      if (swiping) {
        currentRow.style.transform = `translateX(${dx}px)`;
        currentRow.style.transition = 'none';
      }
    }, { passive: true });

    listEl.addEventListener('touchend', (e) => {
      if (!currentRow || !swiping) { currentRow = null; return; }
      const dx = e.changedTouches[0].clientX - startX;
      currentRow.style.transition = 'transform 0.2s ease';

      if (dx > 100) {
        // Swipe right → archive
        currentRow.style.transform = 'translateX(100%)';
        const id = parseInt(currentRow.dataset.id);
        setTimeout(() => archiveEmail(id), 200);
      } else if (dx < -100) {
        // Swipe left → delete
        currentRow.style.transform = 'translateX(-100%)';
        const id = parseInt(currentRow.dataset.id);
        setTimeout(() => deleteEmail(id), 200);
      } else {
        currentRow.style.transform = 'translateX(0)';
      }
      currentRow = null;
      swiping = false;
    }, { passive: true });
  }

  /* ═══════════════════════════════════════════════════════════════════
     PULL-TO-REFRESH
     ═══════════════════════════════════════════════════════════════════ */
  function initPullToRefresh() {
    const listEl = $('#mymail-list');
    if (!listEl || !('ontouchstart' in window)) return;

    let startY = 0, pulling = false;
    const indicator = document.createElement('div');
    indicator.className = 'mymail-ptr-indicator';
    indicator.innerHTML = '<div class="spinner"></div> Обновление...';
    listEl.parentNode.insertBefore(indicator, listEl);

    listEl.addEventListener('touchstart', (e) => {
      if (listEl.scrollTop === 0) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    }, { passive: true });

    listEl.addEventListener('touchmove', (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 60 && listEl.scrollTop === 0) {
        indicator.classList.add('active');
      }
    }, { passive: true });

    listEl.addEventListener('touchend', async () => {
      if (!pulling || !indicator.classList.contains('active')) { pulling = false; return; }
      pulling = false;
      try {
        await loadEmails();
        await loadStats();
      } catch (e) { /* ignore */ }
      indicator.classList.remove('active');
    }, { passive: true });
  }

  /* ═══════════════════════════════════════════════════════════════════
     CLEANUP (called when leaving page)
     ═══════════════════════════════════════════════════════════════════ */
  function destroy() {
    stopPolling();
    stopDraftAutoSave();
    document.removeEventListener('keydown', handleKeydown);
    removeContextMenu();
    if (_hashChangeHandler) {
      window.removeEventListener('hashchange', _hashChangeHandler);
      _hashChangeHandler = null;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     PUBLIC API
     ═══════════════════════════════════════════════════════════════════ */
  return {
    render,
    destroy,
    selectEmail,
    toggleStar,
    deleteEmail,
    archiveEmail,
    reply,
    replyAll,
    forward,
    removeAttachment,
    openCompose,
    printEmail,
    toggleThread
  };
})();
