/**
 * АСГАРД CRM — Почтовый ящик (Фаза 8)
 * Двухпанельный интерфейс: список писем + детали
 * Требования: №52, №53, №54, №55, №56
 *
 * Зависимости: AsgardUI, AsgardAuth, AsgardEmailCompose
 */
window.AsgardMailboxPage = (function(){
  const { $, $$, esc, toast, formatDate } = AsgardUI;

  const MAILBOX_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_TO'];

  // Type colors & labels
  const EMAIL_TYPES = {
    direct_request:   { name: 'Прямой запрос',   color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  icon: 'M' },
    platform_tender:  { name: 'Тендерная площадка', color: '#eab308', bg: 'rgba(234,179,8,0.12)', icon: 'T' },
    newsletter:       { name: 'Рассылка',         color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', icon: 'R' },
    internal:         { name: 'Внутренняя',       color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', icon: 'I' },
    crm_outbound:     { name: 'Исходящее',        color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', icon: 'O' },
    unknown:          { name: 'Неизвестно',        color: '#64748b', bg: 'rgba(100,116,139,0.12)', icon: '?' },
    spam:             { name: 'Спам',              color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  icon: 'S' }
  };

  const FOLDERS = [
    { key: 'inbox',    name: 'Входящие',   icon: '\u{1F4E8}', filter: { direction: 'inbound', is_archived: 'false' } },
    { key: 'starred',  name: 'Избранное',  icon: '\u{2B50}',   filter: { is_starred: 'true' } },
    { key: 'sent',     name: 'Отправленные', icon: '\u{1F4E4}', filter: { direction: 'outbound' } },
    { key: 'drafts',   name: 'Черновики',  icon: '\u{1F4DD}',   filter: { is_draft: 'true' } },
    { key: 'archive',  name: 'Архив',      icon: '\u{1F4E6}',   filter: { is_archived: 'true' } },
    { key: 'trash',    name: 'Корзина',    icon: '\u{1F5D1}',   filter: { is_deleted: 'true' } }
  ];

  // State
  let state = {
    folder: 'inbox',
    emails: [],
    total: 0,
    page: 0,
    limit: 50,
    search: '',
    typeFilter: '',
    selectedId: null,
    selectedEmail: null,
    stats: {},
    accounts: [],
    selectedIds: new Set()
  };

  // ═══════════════════════════════════════════════════════════════════
  // API HELPERS
  // ═══════════════════════════════════════════════════════════════════
  async function apiFetch(url, options = {}) {
    const auth = await AsgardAuth.getAuth();
    const headers = { 'Authorization': 'Bearer ' + (auth?.token || '') };
    if (options.body) headers['Content-Type'] = 'application/json';
    const resp = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Ошибка сервера' }));
      throw new Error(err.error || 'Ошибка запроса');
    }
    return resp.json();
  }

  // API helper for inbox applications
  async function appApi(path, opts = {}) {
    const auth = await AsgardAuth.getAuth();
    const headers = { 'Authorization': 'Bearer ' + (auth?.token || '') };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const resp = await fetch('/api/inbox-applications' + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    return resp.json();
  }

  // Color map for AI analysis
  const AI_COLOR_MAP = {
    green:  { bg: 'rgba(22,163,74,0.13)', border: '#16a34a', icon: '&#128994;', label: 'Наш профиль' },
    yellow: { bg: 'rgba(234,179,8,0.13)', border: '#eab308', icon: '&#128993;', label: 'Требует оценки' },
    red:    { bg: 'rgba(220,38,38,0.13)', border: '#dc2626', icon: '&#128308;', label: 'Не наш профиль' }
  };

  const AI_STATUS_MAP = {
    new:           { label: 'Новая',          color: '#3b82f6' },
    ai_processed:  { label: 'AI обработана',  color: '#8b5cf6' },
    under_review:  { label: 'На рассмотрении', color: '#eab308' },
    accepted:      { label: 'Принята',        color: '#16a34a' },
    rejected:      { label: 'Отклонена',      color: '#dc2626' },
    archived:      { label: 'Архив',          color: '#94a3b8' }
  };

  function money(n) {
    return Math.round(Number(n || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' &#8381;';
  }

  // ═══════════════════════════════════════════════════════════════════
  // RENDER — Main Layout
  // ═══════════════════════════════════════════════════════════════════
  async function render({ layout, title }) {
    const html = `
    <style>
      .ai-summary-line:hover {
        white-space: normal !important;
        overflow: visible !important;
        text-overflow: unset !important;
        background: var(--bg-elevated, rgba(0,0,0,0.06));
        position: relative;
        z-index: 2;
      }
      .ai-popup-overlay {
        position: fixed; top:0; left:0; right:0; bottom:0;
        z-index: 9998; background: transparent;
      }
      .ai-popup {
        position: fixed; z-index: 9999;
        background: var(--bg-card, #1e293b); border: 1px solid var(--border, #334155);
        border-radius: 8px; padding: 16px; max-width: 420px; min-width: 280px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4); font-size: 13px; color: var(--text-primary, #e2e8f0);
        line-height: 1.5;
      }
      .ai-popup-title {
        font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;
        margin-bottom: 8px; color: var(--text-muted, #94a3b8);
      }
      .ai-popup-field { margin-bottom: 6px; }
      .ai-popup-label { font-weight: 600; color: var(--text-muted, #94a3b8); font-size: 11px; }
      .ai-popup-value { margin-top: 1px; }
    </style>
    <div style="display:flex; height:calc(100vh - 56px); overflow:hidden;">
      <!-- LEFT SIDEBAR -->
      <div id="mail-sidebar" style="width:220px; min-width:220px; background:var(--bg-deep); border-right:1px solid var(--border); display:flex; flex-direction:column; overflow-y:auto;">
        <div style="padding:12px;">
          <button id="btn-compose" style="width:100%; padding:10px; background:var(--primary); color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer; font-size:14px;">
            Написать
          </button>
        </div>
        <div id="mail-folders" style="flex:1;"></div>
        <div id="mail-sidebar-stats" style="padding:8px 12px; border-top:1px solid var(--border); font-size:11px; color:var(--text-muted);"></div>
      </div>

      <!-- CENTER: EMAIL LIST -->
      <div id="mail-list-panel" style="width:380px; min-width:300px; border-right:1px solid var(--border); display:flex; flex-direction:column; background:var(--bg-main);">
        <div style="padding:8px 12px; border-bottom:1px solid var(--border); display:flex; gap:6px; align-items:center;">
          <input id="mail-search" type="text" placeholder="Поиск..." style="flex:1; padding:6px 10px; background:var(--bg-card); border:1px solid var(--border); border-radius:6px; color:var(--text-primary); font-size:13px;">
          <select id="mail-type-filter" style="padding:6px; background:var(--bg-card); border:1px solid var(--border); border-radius:6px; color:var(--text-primary); font-size:12px;">
            <option value="">Все типы</option>
            <option value="direct_request">Прямые запросы</option>
            <option value="platform_tender">Тендерные</option>
            <option value="newsletter">Рассылки</option>
            <option value="internal">Внутренние</option>
          </select>
          <button id="btn-refresh-mail" title="Обновить" style="padding:6px 10px; background:var(--bg-card); border:1px solid var(--border); border-radius:6px; cursor:pointer; color:var(--text-primary);">&#x21bb;</button>
        </div>
        <!-- Bulk actions -->
        <div id="mail-bulk-bar" style="padding:4px 12px; border-bottom:1px solid var(--border); display:none; gap:4px; align-items:center; font-size:12px;">
          <span id="mail-bulk-count" style="color:var(--text-muted);"></span>
          <button class="mail-bulk-btn" data-action="mark_read" title="Прочитано" style="padding:2px 8px; border-radius:4px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-primary); cursor:pointer;">Прочитано</button>
          <button class="mail-bulk-btn" data-action="archive" title="Архив" style="padding:2px 8px; border-radius:4px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-primary); cursor:pointer;">Архив</button>
          <button class="mail-bulk-btn" data-action="delete" title="Удалить" style="padding:2px 8px; border-radius:4px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-primary); cursor:pointer;">Удалить</button>
          <button class="mail-bulk-btn" data-action="spam" title="Спам" style="padding:2px 8px; border-radius:4px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-primary); cursor:pointer;">Спам</button>
        </div>
        <div id="mail-list" style="flex:1; overflow-y:auto;"></div>
        <div id="mail-list-pager" style="padding:6px 12px; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; font-size:12px; color:var(--text-muted);"></div>
      </div>

      <!-- RIGHT: EMAIL DETAIL -->
      <div id="mail-detail-panel" style="flex:1; overflow-y:auto; background:var(--bg-main); display:flex; flex-direction:column;">
        <div id="mail-detail" style="flex:1; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:14px;">
          Выберите письмо для просмотра
        </div>
      </div>
    </div>`;

    await layout(html, { title: title || 'Почта' });

    bindEvents();
    await loadStats();
    renderFolders();
    await loadEmails();
  }

  // ═══════════════════════════════════════════════════════════════════
  // FOLDERS SIDEBAR
  // ═══════════════════════════════════════════════════════════════════
  function renderFolders() {
    const container = $('#mail-folders');
    if (!container) return;

    const stats = state.stats;
    const badgeFor = (key) => {
      if (key === 'inbox' && stats.unread > 0) return `<span style="background:var(--primary); color:#fff; padding:1px 6px; border-radius:6px; font-size:11px; font-weight:600;">${stats.unread}</span>`;
      if (key === 'starred' && stats.starred > 0) return `<span style="color:var(--text-muted); font-size:11px;">${stats.starred}</span>`;
      if (key === 'drafts' && stats.drafts > 0) return `<span style="color:var(--text-muted); font-size:11px;">${stats.drafts}</span>`;
      return '';
    };

    container.innerHTML = FOLDERS.map(f => `
      <div class="mail-folder-item" data-folder="${f.key}"
        style="padding:8px 16px; cursor:pointer; display:flex; align-items:center; justify-content:space-between; font-size:13px;
          ${state.folder === f.key ? 'background:var(--bg-card); color:var(--primary); font-weight:600;' : 'color:var(--text-primary);'}">
        <span>${f.icon} ${f.name}</span>
        ${badgeFor(f.key)}
      </div>
    `).join('');

    // Unread by type (below folders)
    if (stats.unread_direct > 0 || stats.unread_tender > 0) {
      container.innerHTML += `
        <div style="padding:12px 16px 4px; font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">По типу</div>
        ${stats.unread_direct > 0 ? `<div class="mail-type-item" data-type="direct_request" style="padding:4px 16px; cursor:pointer; font-size:12px; color:#22c55e; display:flex; justify-content:space-between;">
          <span>Прямые запросы</span><span>${stats.unread_direct}</span></div>` : ''}
        ${stats.unread_tender > 0 ? `<div class="mail-type-item" data-type="platform_tender" style="padding:4px 16px; cursor:pointer; font-size:12px; color:#eab308; display:flex; justify-content:space-between;">
          <span>Тендерные</span><span>${stats.unread_tender}</span></div>` : ''}
      `;
    }

    // Event listeners
    container.querySelectorAll('.mail-folder-item').forEach(el => {
      el.addEventListener('click', () => {
        state.folder = el.dataset.folder;
        state.page = 0;
        state.selectedId = null;
        state.selectedIds.clear();
        loadEmails();
        renderFolders();
        renderDetail();
      });
    });

    container.querySelectorAll('.mail-type-item').forEach(el => {
      el.addEventListener('click', () => {
        state.folder = 'inbox';
        state.typeFilter = el.dataset.type;
        const sel = $('#mail-type-filter');
        if (sel) sel.value = state.typeFilter;
        state.page = 0;
        loadEmails();
        renderFolders();
      });
    });

    // Sidebar stats
    const sideStats = $('#mail-sidebar-stats');
    if (sideStats) {
      sideStats.textContent = `Всего: ${stats.inbox_total || 0} | Отправлено: ${stats.sent || 0}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EMAIL LIST
  // ═══════════════════════════════════════════════════════════════════
  async function loadEmails() {
    const listEl = $('#mail-list');
    if (!listEl) return;

    const folder = FOLDERS.find(f => f.key === state.folder);
    const params = new URLSearchParams();

    // Apply folder filters
    if (folder && folder.filter) {
      for (const [k, v] of Object.entries(folder.filter)) {
        params.set(k, v);
      }
    }

    // Special: trash folder — show deleted
    if (state.folder === 'trash') {
      params.delete('is_deleted'); // already set from FOLDERS filter
    }

    if (state.search) params.set('search', state.search);
    if (state.typeFilter) params.set('type', state.typeFilter);
    params.set('limit', state.limit);
    params.set('offset', state.page * state.limit);

    try {
      const data = await apiFetch('/api/mailbox/emails?' + params.toString());
      state.emails = data.emails || [];
      state.total = data.total || 0;
      renderEmailList();
      renderPager();
    } catch (e) {
      listEl.innerHTML = `<div style="padding:20px; color:var(--red);">${esc(e.message)}</div>`;
    }
  }

  function renderEmailList() {
    const listEl = $('#mail-list');
    if (!listEl) return;

    if (state.emails.length === 0) {
      listEl.innerHTML = '<div style="padding:40px 20px; text-align:center; color:var(--text-muted);">Нет писем</div>';
      return;
    }

    listEl.innerHTML = state.emails.map(e => {
      const t = EMAIL_TYPES[e.email_type] || EMAIL_TYPES.unknown;
      const isSelected = state.selectedId === e.id;
      const isChecked = state.selectedIds.has(e.id);
      const unread = !e.is_read;
      const date = formatEmailDate(e.email_date);
      const fromDisplay = e.direction === 'outbound'
        ? `Кому: ${extractFirstEmail(e.to_emails)}`
        : (e.from_name || e.from_email || '???');

      // AI processing status indicator
      const aiProcessed = !!e.ai_processed_at;
      const aiColorMap = { green: '#4ade80', yellow: '#fbbf24', red: '#f87171' };
      const aiDotColor = aiProcessed && e.ai_color ? (aiColorMap[e.ai_color] || '#94a3b8') : '';
      const aiTitle = aiProcessed
        ? (e.ai_summary ? `AI: ${e.ai_summary}` : 'AI обработано')
        : 'Ожидает AI-анализа';

      const aiBadge = aiProcessed
        ? `<span title="${esc(aiTitle)}" style="display:inline-flex; align-items:center; gap:3px; font-size:11px; padding:2px 8px; border-radius:4px; background:${aiDotColor ? aiDotColor + '22' : 'rgba(148,163,184,.15)'}; color:${aiDotColor || '#94a3b8'}; font-weight:700; white-space:nowrap;">&#10003; AI</span>`
        : `<span title="${esc(aiTitle)}" style="display:inline-flex; align-items:center; gap:3px; font-size:11px; padding:2px 8px; border-radius:4px; background:rgba(148,163,184,.12); color:#94a3b8; font-weight:600; white-space:nowrap;">&#9202; Ждёт AI</span>`;

      const aiSummaryLine = aiProcessed && e.ai_summary
        ? `<div class="ai-summary-line" data-email-id="${e.id}" style="font-size:11px; color:${aiDotColor || '#94a3b8'}; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; transition:all 0.2s; border-radius:4px; padding:1px 4px; margin-left:-4px;" onclick="event.stopPropagation(); AsgardMailboxPage._showAiPopup(this, ${e.id})">AI: ${esc(e.ai_summary)}</div>`
        : '';

      return `
        <div class="mail-item" data-id="${e.id}"
          style="padding:10px 12px; cursor:pointer; border-bottom:none; display:flex; gap:8px; align-items:flex-start;
            margin-bottom:2px; border-radius:6px;
            ${isSelected ? 'background:var(--bg-card);' : ''}
            ${unread ? 'font-weight:600;' : 'opacity:0.85;'}">
          <input type="checkbox" class="mail-checkbox" data-id="${e.id}" ${isChecked ? 'checked' : ''}
            style="margin-top:4px; accent-color:var(--primary);" onclick="event.stopPropagation()">
          <div style="width:8px; min-width:8px; height:8px; border-radius:50%; margin-top:6px; background:${t.color};${e.is_starred ? ' box-shadow:0 0 4px ' + t.color + ';' : ''}" title="${t.name}"></div>
          <div style="flex:1; min-width:0;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:13px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:220px;">${esc(fromDisplay)}</span>
              <div style="display:flex; align-items:center; gap:6px; margin-left:8px;">
                ${aiBadge}
                <span style="font-size:11px; color:var(--text-muted); white-space:nowrap;">${date}</span>
              </div>
            </div>
            <div style="font-size:12px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">${esc(e.subject || '(без темы)')}</div>
            <div style="font-size:11px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:1px;">
              ${e.has_attachments ? '<span title="Вложения" style="margin-right:4px;">&#128206;</span>' : ''}${esc(e.snippet || '')}
            </div>
            ${aiSummaryLine}
          </div>
          ${e.is_starred ? '<span style="color:#eab308; font-size:14px;" title="Избранное">&#9733;</span>' : ''}
        </div>`;
    }).join('');

    // Bind click events
    listEl.querySelectorAll('.mail-item').forEach(el => {
      el.addEventListener('click', () => selectEmail(parseInt(el.dataset.id)));
    });

    listEl.querySelectorAll('.mail-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = parseInt(cb.dataset.id);
        if (cb.checked) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
        updateBulkBar();
      });
    });
  }

  function renderPager() {
    const pager = $('#mail-list-pager');
    if (!pager) return;

    const totalPages = Math.ceil(state.total / state.limit);
    const currentPage = state.page + 1;

    pager.innerHTML = `
      <span>${state.total} писем</span>
      <div style="display:flex; gap:4px; align-items:center;">
        <button id="mail-prev" ${state.page === 0 ? 'disabled' : ''} style="padding:2px 8px; border-radius:4px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-primary); cursor:pointer;">&laquo;</button>
        <span>${currentPage} / ${totalPages || 1}</span>
        <button id="mail-next" ${currentPage >= totalPages ? 'disabled' : ''} style="padding:2px 8px; border-radius:4px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-primary); cursor:pointer;">&raquo;</button>
      </div>
    `;

    const prev = $('#mail-prev');
    const next = $('#mail-next');
    if (prev) prev.addEventListener('click', () => { state.page--; loadEmails(); });
    if (next) next.addEventListener('click', () => { state.page++; loadEmails(); });
  }

  // ═══════════════════════════════════════════════════════════════════
  // EMAIL DETAIL
  // ═══════════════════════════════════════════════════════════════════
  // Close detail panel on mobile (back button)
  function closeDetailMobile() {
    const panel = document.getElementById('mail-detail-panel');
    if (panel) panel.classList.remove('mail-detail-open');
  }

  async function selectEmail(id) {
    state.selectedId = id;
    renderEmailList(); // highlight

    // On mobile: show the detail panel as overlay
    const panel = document.getElementById('mail-detail-panel');
    if (panel && window.innerWidth <= 768) {
      panel.classList.add('mail-detail-open');
    }

    const detailEl = $('#mail-detail');
    if (!detailEl) return;
    // Switch to column layout for detail view
    detailEl.style.cssText = 'flex:1; display:flex; flex-direction:column; overflow-y:auto;';
    detailEl.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted);">Загрузка...</div>';

    try {
      const data = await apiFetch(`/api/mailbox/emails/${id}`);
      if (!data || !data.email) {
        detailEl.innerHTML = '<div style="padding:20px; color:var(--text-muted);">Письмо не найдено</div>';
        return;
      }
      state.selectedEmail = data.email;
      renderDetail(data);

      // Update list to show as read
      const email = state.emails.find(e => e.id === id);
      if (email) { email.is_read = true; renderEmailList(); }

      // Refresh stats (unread count)
      loadStats().then(renderFolders);
    } catch (e) {
      detailEl.innerHTML = `<div style="padding:20px; color:#ef4444; font-size:14px;">Ошибка загрузки: ${esc(e.message || 'неизвестная ошибка')}</div>`;
    }
  }

  function renderDetail(data) {
    const detailEl = $('#mail-detail');
    if (!detailEl) return;

    if (!data || !data.email) {
      detailEl.style.cssText = 'flex:1; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:14px;';
      detailEl.innerHTML = 'Выберите письмо для просмотра';
      return;
    }

    // Set proper column layout for email content
    detailEl.style.cssText = 'flex:1; display:flex; flex-direction:column; overflow-y:auto;';

    const e = data.email;
    const attachments = data.attachments || [];
    const thread = data.thread || [];
    const app = data.application || null;
    const t = EMAIL_TYPES[e.email_type] || EMAIL_TYPES.unknown;
    const date = e.email_date ? new Date(e.email_date).toLocaleString('ru-RU') : '';

    const toList = parseEmailList(e.to_emails);
    const ccList = parseEmailList(e.cc_emails);

    // AI application section
    const col = app ? (AI_COLOR_MAP[app.ai_color] || {}) : {};
    const appSt = app ? (AI_STATUS_MAP[app.status] || AI_STATUS_MAP.new) : null;
    const isInbound = e.direction === 'inbound';

    let aiSectionHtml = '';
    if (app && app.ai_summary) {
      aiSectionHtml = `
        <div style="padding:12px 24px;">
          <!-- AI Status Badge -->
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
            <span style="padding:3px 10px; border-radius:6px; background:${appSt.color}22; color:${appSt.color}; font-size:12px; font-weight:700;">${esc(appSt.label)}</span>
            ${col.icon ? '<span>' + col.icon + ' ' + esc(col.label || '') + '</span>' : ''}
            <span style="color:var(--text-muted); font-size:11px;">Заявка #${app.id}</span>
          </div>

          <!-- AI Analysis Block -->
          <div style="background:${col.bg || 'var(--bg-elevated)'}; border:1px solid ${col.border || 'var(--border)'}; border-radius:6px; padding:16px; margin-bottom:12px;">
            <div style="font-weight:700; margin-bottom:8px; font-size:13px;">AI Анализ</div>
            <div style="margin-bottom:8px; font-size:13px;">${esc(app.ai_summary)}</div>
            <div style="font-size:12px; color:var(--text-muted);">
              <b>Рекомендация:</b> ${esc(app.ai_recommendation || '—')}
              ${app.ai_work_type ? '<br><b>Тип работ:</b> ' + esc(app.ai_work_type) : ''}
              ${app.ai_estimated_budget ? '<br><b>Бюджет:</b> ~' + money(app.ai_estimated_budget) : ''}
              ${app.ai_estimated_days ? '<br><b>Срок:</b> ~' + app.ai_estimated_days + ' дней' : ''}
              ${app.ai_keywords?.length ? '<br><b>Ключевые:</b> ' + app.ai_keywords.map(k => esc(k)).join(', ') : ''}
              <br><b>Уверенность:</b> ${app.ai_confidence ? Math.round(app.ai_confidence * 100) + '%' : '—'}
              ${app.ai_model ? '<br><b>Модель:</b> ' + esc(app.ai_model) : ''}
            </div>
          </div>

          <!-- AI Report -->
          ${app.ai_report ? `
          <details style="margin-bottom:12px;" open>
            <summary style="cursor:pointer; font-weight:700; font-size:13px;">AI-отчёт</summary>
            <div style="margin-top:8px; padding:12px; background:var(--bg-elevated); border:1px solid var(--border); border-radius:6px; font-size:13px; white-space:pre-wrap; line-height:1.5;">${esc(app.ai_report)}</div>
          </details>` : ''}

          <!-- Decision info -->
          ${app.decision_by_name ? `
          <div style="padding:10px; background:var(--bg-elevated); border-radius:6px; font-size:12px; margin-bottom:12px;">
            <b>Решение:</b> ${esc(app.decision_by_name)} &middot; ${app.decision_at ? new Date(app.decision_at).toLocaleString('ru-RU') : ''}
            ${app.decision_notes ? '<br>' + esc(app.decision_notes) : ''}
            ${app.rejection_reason ? '<br><b>Причина:</b> ' + esc(app.rejection_reason) : ''}
            ${app.linked_tender_id ? '<br><a href="#/tenders/' + app.linked_tender_id + '" style="color:var(--primary);">Тендер #' + app.linked_tender_id + '</a>' : ''}
          </div>` : ''}

          <!-- Action Buttons -->
          <div style="display:flex; gap:8px; flex-wrap:wrap; padding-top:8px; border-top:1px solid var(--border);">
            ${['new','ai_processed','under_review'].includes(app.status) ? `
              <button class="app-action-btn" data-app-action="accept" style="padding:8px 16px; border-radius:6px; border:none; background:linear-gradient(135deg,#16a34a,#15803d); color:#fff; font-weight:700; cursor:pointer; font-size:12px;">Принять</button>
              <button class="app-action-btn" data-app-action="reject" style="padding:8px 16px; border-radius:6px; border:none; background:linear-gradient(135deg,#dc2626,#b91c1c); color:#fff; font-weight:700; cursor:pointer; font-size:12px;">Отклонить</button>
            ` : ''}
            ${['new','ai_processed'].includes(app.status) ? `
              <button class="app-action-btn" data-app-action="review" style="padding:8px 16px; border-radius:6px; border:none; background:linear-gradient(135deg,#3b82f6,#2563eb); color:#fff; font-weight:700; cursor:pointer; font-size:12px;">На рассмотрение</button>
            ` : ''}
            <button class="app-action-btn" data-app-action="reanalyze" style="padding:8px 16px; border-radius:6px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-primary); font-weight:600; cursor:pointer; font-size:12px;">Переанализировать</button>
            ${app.status !== 'archived' ? '<button class="app-action-btn" data-app-action="archive" style="padding:8px 16px; border-radius:6px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-primary); cursor:pointer; font-size:12px;">В архив</button>' : ''}
          </div>
        </div>
      `;
    } else if (app && !app.ai_summary) {
      // Application exists but no AI analysis yet
      aiSectionHtml = `
        <div style="padding:12px 24px;">
          <div style="background:var(--bg-elevated); border-radius:6px; padding:16px; text-align:center;">
            <div style="color:var(--text-muted); font-size:13px; margin-bottom:8px;">AI-анализ не проводился (Заявка #${app.id})</div>
            <button class="app-action-btn" data-app-action="reanalyze" style="padding:8px 16px; border-radius:6px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-primary); font-weight:600; cursor:pointer; font-size:12px;">Запустить анализ</button>
          </div>
        </div>
      `;
    } else if (!app && isInbound) {
      // No application for this inbound email
      aiSectionHtml = `
        <div style="padding:12px 24px;">
          <div style="background:var(--bg-elevated); border-radius:6px; padding:16px; text-align:center;">
            <div style="color:var(--text-muted); font-size:13px; margin-bottom:8px;">Заявка не создана</div>
            <button id="btn-create-app" style="padding:8px 16px; border-radius:6px; border:none; background:var(--primary); color:#fff; font-weight:600; cursor:pointer; font-size:12px;">Создать заявку и запустить AI-анализ</button>
          </div>
        </div>
      `;
    }

    detailEl.innerHTML = `
      <div style="padding:20px 24px;">
        <!-- Toolbar -->
        <div style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap;">
          <button id="mail-back-btn" class="btn ghost" style="display:none;" onclick="AsgardMailboxPage.closeDetailMobile()">&#8592; Назад</button>
          <button class="btn ghost mail-action-btn" data-action="reply">Ответить</button>
          <button class="btn ghost mail-action-btn" data-action="reply_all">Ответить всем</button>
          <button class="btn ghost mail-action-btn" data-action="forward">Переслать</button>
          <span style="flex:1;"></span>
          <button class="btn ghost mail-action-btn" data-action="star">${e.is_starred ? '&#9733; Убрать' : '&#9734; Избранное'}</button>
          <button class="btn ghost mail-action-btn" data-action="archive">&#128230; Архив</button>
          <button class="btn danger mail-action-btn" data-action="delete">&times; Удалить</button>
        </div>

        <!-- Subject -->
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <span style="display:inline-block; padding:2px 8px; border-radius:4px; background:${t.bg}; color:${t.color}; font-size:11px; font-weight:600;">${t.name}</span>
          <h2 style="margin:0; font-size:18px; color:var(--text-primary); font-weight:600;">${esc(e.subject || '(без темы)')}</h2>
        </div>

        <!-- From / To / Date -->
        <div style="font-size:13px; color:var(--text-primary); margin-bottom:4px;">
          <strong>От:</strong> ${esc(e.from_name || '')} &lt;${esc(e.from_email || '')}&gt;
          <span style="float:right; color:var(--text-muted); font-size:12px;">${date}</span>
        </div>
        <div style="font-size:13px; color:var(--text-muted);">
          <strong style="color:var(--text-primary);">Кому:</strong> ${toList.map(a => esc(a.address || a)).join(', ')}
        </div>
        ${ccList.length > 0 ? `<div style="font-size:12px; color:var(--text-muted);"><strong style="color:var(--text-primary);">Копия:</strong> ${ccList.map(a => esc(a.address || a)).join(', ')}</div>` : ''}
      </div>

      <!-- AI Analysis Section -->
      ${aiSectionHtml}

      <!-- Body (sandboxed iframe to prevent XSS from email HTML) -->
      <div style="padding:20px 24px; flex:1;">
        <iframe id="mail-body-frame" sandbox="allow-same-origin" style="background:#fff; border-radius:6px; border:none; width:100%; min-height:200px; color:#1e293b; font-size:14px; line-height:1.6;"></iframe>
      </div>

      <!-- Attachments -->
      ${attachments.length > 0 ? `
        <div style="padding:12px 24px;">
          <div style="font-size:13px; font-weight:600; color:var(--text-primary); margin-bottom:8px;">Вложения (${attachments.length}):</div>
          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            ${attachments.map(a => `
              <a href="/api/mailbox/attachments/${a.id}/download" target="_blank"
                style="display:flex; align-items:center; gap:6px; padding:6px 12px; background:var(--bg-elevated); border-radius:6px; text-decoration:none; color:var(--text-primary); font-size:12px;">
                &#128206; ${esc(a.original_filename || a.filename)}
                <span style="color:var(--text-muted);">(${formatFileSize(a.size)})</span>
              </a>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Thread -->
      ${thread.length > 0 ? `
        <div style="padding:12px 24px;">
          <div style="font-size:13px; font-weight:600; color:var(--text-primary); margin-bottom:8px;">Цепочка (${thread.length + 1} писем):</div>
          <div style="display:flex; flex-direction:column; gap:4px;">
            ${thread.map(t => `
              <div class="mail-thread-item" data-id="${t.id}" style="padding:6px 10px; cursor:pointer; border-radius:6px; background:var(--bg-elevated); font-size:12px; display:flex; justify-content:space-between; align-items:center;">
                <span>${t.direction === 'outbound' ? '&#8594;' : '&#8592;'} <strong>${esc(t.from_name || t.from_email || '')}</strong> — ${esc(t.subject || '')}</span>
                <span style="color:var(--text-muted);">${formatEmailDate(t.email_date)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;

    // Inject email body into sandboxed iframe
    const bodyFrame = detailEl.querySelector('#mail-body-frame');
    if (bodyFrame) {
      const bodyContent = e.body_html || esc(e.body_text || '').replace(/\n/g, '<br>').replace(/ {2}/g, '&nbsp; ') || '<em style="color:#94a3b8;">Пустое письмо</em>';
      bodyFrame.addEventListener('load', function onLoad() {
        bodyFrame.removeEventListener('load', onLoad);
        try {
          const doc = bodyFrame.contentDocument;
          doc.open();
          doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1e293b}img{max-width:100%}</style></head><body>' + bodyContent + '</body></html>');
          doc.close();
          // Auto-resize iframe to content height
          bodyFrame.style.height = (doc.body.scrollHeight + 40) + 'px';
        } catch (_) {}
      });
      bodyFrame.src = 'about:blank';
    }

    // Show back button on mobile
    const backBtn = detailEl.querySelector('#mail-back-btn');
    if (backBtn && window.innerWidth <= 768) {
      backBtn.style.display = '';
    }

    // Bind action buttons
    detailEl.querySelectorAll('.mail-action-btn').forEach(btn => {
      btn.addEventListener('click', () => handleDetailAction(btn.dataset.action, e));
    });

    // Thread navigation
    detailEl.querySelectorAll('.mail-thread-item').forEach(el => {
      el.addEventListener('click', () => selectEmail(parseInt(el.dataset.id)));
    });

    // App action buttons (AI analysis actions)
    detailEl.querySelectorAll('.app-action-btn').forEach(btn => {
      btn.addEventListener('click', () => handleAppAction(btn.dataset.appAction, app, e));
    });

    // Create application button
    const btnCreateApp = detailEl.querySelector('#btn-create-app');
    if (btnCreateApp) {
      btnCreateApp.addEventListener('click', async () => {
        btnCreateApp.disabled = true;
        btnCreateApp.textContent = 'Создание...';
        try {
          const res = await appApi('/from-email', { method: 'POST', body: { email_id: e.id, auto_analyze: true } });
          if (res.success) {
            toast('Заявка создана и проанализирована');
            selectEmail(e.id); // reload detail
          } else {
            toast(res.error || 'Ошибка создания заявки', 'error');
            btnCreateApp.disabled = false;
            btnCreateApp.textContent = 'Создать заявку и запустить AI-анализ';
          }
        } catch (err) {
          toast(err.message || 'Ошибка', 'error');
          btnCreateApp.disabled = false;
          btnCreateApp.textContent = 'Создать заявку и запустить AI-анализ';
        }
      });
    }
  }

  // Handle inbox application actions
  async function handleAppAction(action, app, email) {
    if (!app && action !== 'create') return;

    switch (action) {
      case 'accept': {
        if (!confirm('Принять заявку и создать тендер?')) return;
        try {
          const res = await appApi('/' + app.id + '/accept', { method: 'POST', body: { create_tender: true, send_email: true } });
          if (res.success) {
            toast(res.tender_id ? 'Заявка принята, тендер #' + res.tender_id + ' создан' : 'Заявка принята');
            selectEmail(email.id);
          } else if (res.tender_id) {
            toast('Заявка уже принята. Тендер #' + res.tender_id, 'warn');
            selectEmail(email.id);
          } else { toast(res.error || 'Ошибка', 'error'); }
        } catch (err) { toast(err.message, 'error'); }
        break;
      }
      case 'reject': {
        const reason = prompt('Причина отклонения:');
        if (reason === null) return;
        try {
          const res = await appApi('/' + app.id + '/reject', { method: 'POST', body: { reason, send_email: true } });
          if (res.success) { toast('Заявка отклонена'); selectEmail(email.id); }
          else { toast(res.error || 'Ошибка', 'error'); }
        } catch (err) { toast(err.message, 'error'); }
        break;
      }
      case 'review': {
        try {
          const res = await appApi('/' + app.id + '/review', { method: 'POST' });
          if (res.success) { toast('Взято на рассмотрение'); selectEmail(email.id); }
        } catch (err) { toast(err.message, 'error'); }
        break;
      }
      case 'reanalyze': {
        const btns = document.querySelectorAll('[data-app-action="reanalyze"]');
        btns.forEach(b => { b.disabled = true; b.textContent = 'Анализ...'; });
        try {
          const res = await appApi('/' + app.id + '/analyze', { method: 'POST' });
          if (res.success) { toast('Анализ завершён'); selectEmail(email.id); }
          else { toast(res.error || 'Ошибка AI', 'error'); btns.forEach(b => { b.disabled = false; b.textContent = 'Переанализировать'; }); }
        } catch (err) { toast(err.message, 'error'); btns.forEach(b => { b.disabled = false; b.textContent = 'Переанализировать'; }); }
        break;
      }
      case 'archive': {
        try {
          const res = await appApi('/' + app.id + '/archive', { method: 'POST' });
          if (res.success) { toast('Заявка архивирована'); selectEmail(email.id); }
        } catch (err) { toast(err.message, 'error'); }
        break;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════
  async function handleDetailAction(action, email) {
    switch (action) {
      case 'reply':
      case 'reply_all':
      case 'forward':
        if (window.AsgardEmailCompose) {
          AsgardEmailCompose.open({ mode: action, email });
        } else {
          toast('Модуль компоновки не загружен', 'error');
        }
        break;

      case 'star':
        try {
          await apiFetch(`/api/mailbox/emails/${email.id}`, {
            method: 'PATCH',
            body: { is_starred: !email.is_starred }
          });
          email.is_starred = !email.is_starred;
          renderDetail({ email, attachments: [], thread: [] });
          loadEmails();
          loadStats().then(renderFolders);
        } catch (e) { toast(e.message, 'error'); }
        break;

      case 'archive':
        try {
          await apiFetch(`/api/mailbox/emails/${email.id}`, {
            method: 'PATCH',
            body: { is_archived: true }
          });
          toast('Письмо архивировано');
          state.selectedId = null;
          renderDetail();
          loadEmails();
          loadStats().then(renderFolders);
        } catch (e) { toast(e.message, 'error'); }
        break;

      case 'delete':
        if (!confirm('Удалить письмо?')) return;
        try {
          await apiFetch(`/api/mailbox/emails/${email.id}`, {
            method: 'PATCH',
            body: { is_deleted: true }
          });
          toast('Письмо удалено');
          state.selectedId = null;
          renderDetail();
          loadEmails();
          loadStats().then(renderFolders);
        } catch (e) { toast(e.message, 'error'); }
        break;
    }
  }

  // Bulk actions
  async function handleBulkAction(action) {
    if (state.selectedIds.size === 0) return;
    const ids = Array.from(state.selectedIds);

    try {
      await apiFetch('/api/mailbox/emails/bulk', {
        method: 'POST',
        body: { ids, action }
      });
      toast(`Выполнено: ${action} (${ids.length})`);
      state.selectedIds.clear();
      updateBulkBar();
      loadEmails();
      loadStats().then(renderFolders);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function updateBulkBar() {
    const bar = $('#mail-bulk-bar');
    if (!bar) return;
    if (state.selectedIds.size > 0) {
      bar.style.display = 'flex';
      const countEl = $('#mail-bulk-count');
      if (countEl) countEl.textContent = `Выбрано: ${state.selectedIds.size}`;
    } else {
      bar.style.display = 'none';
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════════
  async function loadStats() {
    try {
      state.stats = await apiFetch('/api/mailbox/stats');
    } catch (e) {
      state.stats = {};
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVENT BINDINGS
  // ═══════════════════════════════════════════════════════════════════
  function bindEvents() {
    // Compose button
    const btnCompose = $('#btn-compose');
    if (btnCompose) {
      btnCompose.addEventListener('click', () => {
        if (window.AsgardEmailCompose) {
          AsgardEmailCompose.open({ mode: 'compose' });
        } else {
          toast('Модуль компоновки не загружен', 'error');
        }
      });
    }

    // Search
    const searchInput = $('#mail-search');
    let searchTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          state.search = searchInput.value.trim();
          state.page = 0;
          loadEmails();
        }, 400);
      });
    }

    // Type filter
    const typeFilter = $('#mail-type-filter');
    if (typeFilter) {
      typeFilter.addEventListener('change', () => {
        state.typeFilter = typeFilter.value;
        state.page = 0;
        loadEmails();
      });
    }

    // Refresh
    const btnRefresh = $('#btn-refresh-mail');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        loadEmails();
        loadStats().then(renderFolders);
      });
    }

    // Bulk action buttons
    document.querySelectorAll('.mail-bulk-btn').forEach(btn => {
      btn.addEventListener('click', () => handleBulkAction(btn.dataset.action));
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════
  function formatEmailDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Вчера';

    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    }
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' });
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function parseEmailList(json) {
    if (!json) return [];
    if (typeof json === 'string') {
      try { return JSON.parse(json); } catch (e) { return []; }
    }
    return Array.isArray(json) ? json : [];
  }

  function extractFirstEmail(json) {
    const list = parseEmailList(json);
    if (list.length === 0) return '';
    const first = list[0];
    return first.name || first.address || String(first);
  }

  function btnStyle(color) {
    return `padding:6px 12px; border-radius:6px; border:1px solid var(--border); background:var(--bg-card); color:${color || 'var(--text-primary)'}; cursor:pointer; font-size:12px; white-space:nowrap;`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // AI POPUP — show full AI analysis on click
  // ═══════════════════════════════════════════════════════════════════
  function _showAiPopup(triggerEl, emailId) {
    // Remove existing popup
    const old = document.querySelector('.ai-popup-overlay');
    if (old) old.remove();

    const email = state.emails.find(e => e.id === emailId);
    if (!email) return;

    const aiColorMap = { green: '#4ade80', yellow: '#fbbf24', red: '#f87171' };
    const colorHex = email.ai_color ? (aiColorMap[email.ai_color] || '#94a3b8') : '#94a3b8';
    const colorLabel = { green: 'Зелёный — заявка на работу', yellow: 'Жёлтый — требует внимания', red: 'Красный — спам/неважное' };

    // Build popup content
    let fields = '';
    fields += `<div class="ai-popup-field"><div class="ai-popup-label">Цвет</div><div class="ai-popup-value"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colorHex};margin-right:6px;vertical-align:middle;"></span>${esc(colorLabel[email.ai_color] || email.ai_color || '—')}</div></div>`;
    if (email.ai_classification) {
      const classLabel = { direct_request: 'Прямой запрос', platform_tender: 'Тендер с площадки', commercial_offer: 'Коммерческое предложение', newsletter: 'Рассылка', spam: 'Спам', internal: 'Внутренняя', bounce_or_auto_reply: 'Автоответ/Bounce', other: 'Прочее' };
      const cls = String(email.ai_classification).replace(/"/g, '');
      fields += `<div class="ai-popup-field"><div class="ai-popup-label">Классификация</div><div class="ai-popup-value">${esc(classLabel[cls] || cls)}</div></div>`;
    }
    if (email.ai_summary) {
      fields += `<div class="ai-popup-field"><div class="ai-popup-label">Резюме AI</div><div class="ai-popup-value">${esc(email.ai_summary)}</div></div>`;
    }
    if (email.ai_recommendation) {
      fields += `<div class="ai-popup-field"><div class="ai-popup-label">Рекомендация</div><div class="ai-popup-value">${esc(email.ai_recommendation)}</div></div>`;
    }

    // Position popup near trigger
    const rect = triggerEl.getBoundingClientRect();
    let top = rect.bottom + 6;
    let left = rect.left;

    // Ensure popup stays within viewport
    if (top + 250 > window.innerHeight) top = rect.top - 260;
    if (left + 420 > window.innerWidth) left = window.innerWidth - 430;
    if (left < 10) left = 10;

    const overlay = document.createElement('div');
    overlay.className = 'ai-popup-overlay';
    overlay.addEventListener('click', () => overlay.remove());

    const popup = document.createElement('div');
    popup.className = 'ai-popup';
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
    popup.innerHTML = `<div class="ai-popup-title">Анализ AI</div>${fields}`;
    popup.addEventListener('click', (e) => e.stopPropagation());

    overlay.appendChild(popup);
    document.body.appendChild(overlay);
  }

  return { render, _showAiPopup, closeDetailMobile };
})();
