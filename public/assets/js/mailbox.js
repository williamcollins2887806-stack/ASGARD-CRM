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

  // ═══════════════════════════════════════════════════════════════════
  // RENDER — Main Layout
  // ═══════════════════════════════════════════════════════════════════
  async function render({ layout }) {
    layout.innerHTML = `
    <div style="display:flex; height:calc(100vh - 56px); overflow:hidden;">
      <!-- LEFT SIDEBAR -->
      <div id="mail-sidebar" style="width:220px; min-width:220px; background:var(--bg-deep); border-right:1px solid var(--border); display:flex; flex-direction:column; overflow-y:auto;">
        <div style="padding:12px;">
          <button id="btn-compose" style="width:100%; padding:10px; background:var(--primary); color:#fff; border:none; border-radius:8px; font-weight:600; cursor:pointer; font-size:14px;">
            Написать
          </button>
        </div>
        <div id="mail-folders" style="flex:1;"></div>
        <div id="mail-sidebar-stats" style="padding:8px 12px; border-top:1px solid var(--border); font-size:11px; color:var(--text-muted);"></div>
      </div>

      <!-- CENTER: EMAIL LIST -->
      <div id="mail-list-panel" style="width:380px; min-width:300px; border-right:1px solid var(--border); display:flex; flex-direction:column; background:var(--bg-main);">
        <div style="padding:8px 12px; border-bottom:1px solid var(--border); display:flex; gap:6px; align-items:center;">
          <input id="mail-search" type="text" placeholder="Поиск..." style="flex:1; padding:6px 10px; background:var(--bg-card); border:1px solid var(--border); border-radius:6px; color:var(--text-main); font-size:13px;">
          <select id="mail-type-filter" style="padding:6px; background:var(--bg-card); border:1px solid var(--border); border-radius:6px; color:var(--text-main); font-size:12px;">
            <option value="">Все типы</option>
            <option value="direct_request">Прямые запросы</option>
            <option value="platform_tender">Тендерные</option>
            <option value="newsletter">Рассылки</option>
            <option value="internal">Внутренние</option>
          </select>
          <button id="btn-refresh-mail" title="Обновить" style="padding:6px 10px; background:var(--bg-card); border:1px solid var(--border); border-radius:6px; cursor:pointer; color:var(--text-main);">&#x21bb;</button>
        </div>
        <!-- Bulk actions -->
        <div id="mail-bulk-bar" style="padding:4px 12px; border-bottom:1px solid var(--border); display:none; gap:4px; align-items:center; font-size:12px;">
          <span id="mail-bulk-count" style="color:var(--text-muted);"></span>
          <button class="mail-bulk-btn" data-action="mark_read" title="Прочитано" style="padding:2px 8px; border-radius:4px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-main); cursor:pointer;">Прочитано</button>
          <button class="mail-bulk-btn" data-action="archive" title="Архив" style="padding:2px 8px; border-radius:4px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-main); cursor:pointer;">Архив</button>
          <button class="mail-bulk-btn" data-action="delete" title="Удалить" style="padding:2px 8px; border-radius:4px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-main); cursor:pointer;">Удалить</button>
          <button class="mail-bulk-btn" data-action="spam" title="Спам" style="padding:2px 8px; border-radius:4px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-main); cursor:pointer;">Спам</button>
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
      if (key === 'inbox' && stats.unread > 0) return `<span style="background:var(--primary); color:#fff; padding:1px 6px; border-radius:10px; font-size:11px; font-weight:600;">${stats.unread}</span>`;
      if (key === 'starred' && stats.starred > 0) return `<span style="color:var(--text-muted); font-size:11px;">${stats.starred}</span>`;
      if (key === 'drafts' && stats.drafts > 0) return `<span style="color:var(--text-muted); font-size:11px;">${stats.drafts}</span>`;
      return '';
    };

    container.innerHTML = FOLDERS.map(f => `
      <div class="mail-folder-item" data-folder="${f.key}"
        style="padding:8px 16px; cursor:pointer; display:flex; align-items:center; justify-content:space-between; font-size:13px;
          ${state.folder === f.key ? 'background:var(--bg-card); color:var(--primary); font-weight:600;' : 'color:var(--text-main);'}">
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

      return `
        <div class="mail-item" data-id="${e.id}"
          style="padding:10px 12px; cursor:pointer; border-bottom:1px solid var(--border); display:flex; gap:8px; align-items:flex-start;
            ${isSelected ? 'background:var(--bg-card);' : ''}
            ${unread ? 'font-weight:600;' : 'opacity:0.85;'}">
          <input type="checkbox" class="mail-checkbox" data-id="${e.id}" ${isChecked ? 'checked' : ''}
            style="margin-top:4px; accent-color:var(--primary);" onclick="event.stopPropagation()">
          <div style="width:8px; min-width:8px; height:8px; border-radius:50%; margin-top:6px; background:${t.color};${e.is_starred ? ' box-shadow:0 0 4px ' + t.color + ';' : ''}" title="${t.name}"></div>
          <div style="flex:1; min-width:0;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:13px; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:220px;">${esc(fromDisplay)}</span>
              <span style="font-size:11px; color:var(--text-muted); white-space:nowrap; margin-left:8px;">${date}</span>
            </div>
            <div style="font-size:12px; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">${esc(e.subject || '(без темы)')}</div>
            <div style="font-size:11px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:1px;">
              ${e.has_attachments ? '<span title="Вложения" style="margin-right:4px;">&#128206;</span>' : ''}${esc(e.snippet || '')}
            </div>
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
        <button id="mail-prev" ${state.page === 0 ? 'disabled' : ''} style="padding:2px 8px; border-radius:4px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-main); cursor:pointer;">&laquo;</button>
        <span>${currentPage} / ${totalPages || 1}</span>
        <button id="mail-next" ${currentPage >= totalPages ? 'disabled' : ''} style="padding:2px 8px; border-radius:4px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-main); cursor:pointer;">&raquo;</button>
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
  async function selectEmail(id) {
    state.selectedId = id;
    renderEmailList(); // highlight

    const detailEl = $('#mail-detail');
    if (!detailEl) return;
    detailEl.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted);">Загрузка...</div>';

    try {
      const data = await apiFetch(`/api/mailbox/emails/${id}`);
      state.selectedEmail = data.email;
      renderDetail(data);

      // Update list to show as read
      const email = state.emails.find(e => e.id === id);
      if (email) { email.is_read = true; renderEmailList(); }

      // Refresh stats (unread count)
      loadStats().then(renderFolders);
    } catch (e) {
      detailEl.innerHTML = `<div style="padding:20px; color:var(--red);">${esc(e.message)}</div>`;
    }
  }

  function renderDetail(data) {
    const detailEl = $('#mail-detail');
    if (!detailEl) return;

    if (!data || !data.email) {
      detailEl.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; height:100%; color:var(--text-muted); font-size:14px;">Выберите письмо для просмотра</div>';
      return;
    }

    const e = data.email;
    const attachments = data.attachments || [];
    const thread = data.thread || [];
    const t = EMAIL_TYPES[e.email_type] || EMAIL_TYPES.unknown;
    const date = e.email_date ? new Date(e.email_date).toLocaleString('ru-RU') : '';

    const toList = parseEmailList(e.to_emails);
    const ccList = parseEmailList(e.cc_emails);

    detailEl.innerHTML = `
      <div style="padding:20px 24px; border-bottom:1px solid var(--border);">
        <!-- Toolbar -->
        <div style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap;">
          <button class="mail-action-btn" data-action="reply" style="${btnStyle()}">Ответить</button>
          <button class="mail-action-btn" data-action="reply_all" style="${btnStyle()}">Ответить всем</button>
          <button class="mail-action-btn" data-action="forward" style="${btnStyle()}">Переслать</button>
          <span style="flex:1;"></span>
          <button class="mail-action-btn" data-action="star" style="${btnStyle()}">${e.is_starred ? '&#9733; Убрать' : '&#9734; Избранное'}</button>
          <button class="mail-action-btn" data-action="archive" style="${btnStyle()}">&#128230; Архив</button>
          <button class="mail-action-btn" data-action="delete" style="${btnStyle('var(--red)')}">&times; Удалить</button>
        </div>

        <!-- Subject -->
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <span style="display:inline-block; padding:2px 8px; border-radius:4px; background:${t.bg}; color:${t.color}; font-size:11px; font-weight:600;">${t.name}</span>
          <h2 style="margin:0; font-size:18px; color:var(--text-main); font-weight:600;">${esc(e.subject || '(без темы)')}</h2>
        </div>

        <!-- From / To / Date -->
        <div style="font-size:13px; color:var(--text-main); margin-bottom:4px;">
          <strong>От:</strong> ${esc(e.from_name || '')} &lt;${esc(e.from_email || '')}&gt;
          <span style="float:right; color:var(--text-muted); font-size:12px;">${date}</span>
        </div>
        <div style="font-size:13px; color:var(--text-muted);">
          <strong style="color:var(--text-main);">Кому:</strong> ${toList.map(a => esc(a.address || a)).join(', ')}
        </div>
        ${ccList.length > 0 ? `<div style="font-size:12px; color:var(--text-muted);"><strong style="color:var(--text-main);">Копия:</strong> ${ccList.map(a => esc(a.address || a)).join(', ')}</div>` : ''}
      </div>

      <!-- Body -->
      <div style="padding:20px 24px; flex:1;">
        <div id="mail-body-frame" style="background:#fff; border-radius:8px; padding:16px; min-height:200px; color:#1e293b; font-size:14px; line-height:1.6;">
          ${e.body_html || (e.body_text || '').replace(/\n/g, '<br>').replace(/ {2}/g, '&nbsp; ') || '<em style="color:#94a3b8;">Пустое письмо</em>'}
        </div>
      </div>

      <!-- Attachments -->
      ${attachments.length > 0 ? `
        <div style="padding:12px 24px; border-top:1px solid var(--border);">
          <div style="font-size:13px; font-weight:600; color:var(--text-main); margin-bottom:8px;">Вложения (${attachments.length}):</div>
          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            ${attachments.map(a => `
              <a href="/api/mailbox/attachments/${a.id}/download" target="_blank"
                style="display:flex; align-items:center; gap:6px; padding:6px 12px; background:var(--bg-card); border:1px solid var(--border); border-radius:6px; text-decoration:none; color:var(--text-main); font-size:12px;">
                &#128206; ${esc(a.original_filename || a.filename)}
                <span style="color:var(--text-muted);">(${formatFileSize(a.size)})</span>
              </a>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Thread -->
      ${thread.length > 0 ? `
        <div style="padding:12px 24px; border-top:1px solid var(--border);">
          <div style="font-size:13px; font-weight:600; color:var(--text-main); margin-bottom:8px;">Цепочка (${thread.length + 1} писем):</div>
          <div style="display:flex; flex-direction:column; gap:4px;">
            ${thread.map(t => `
              <div class="mail-thread-item" data-id="${t.id}" style="padding:6px 10px; cursor:pointer; border-radius:6px; border:1px solid var(--border); font-size:12px; display:flex; justify-content:space-between; align-items:center;">
                <span>${t.direction === 'outbound' ? '&#8594;' : '&#8592;'} <strong>${esc(t.from_name || t.from_email || '')}</strong> — ${esc(t.subject || '')}</span>
                <span style="color:var(--text-muted);">${formatEmailDate(t.email_date)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;

    // Bind action buttons
    detailEl.querySelectorAll('.mail-action-btn').forEach(btn => {
      btn.addEventListener('click', () => handleDetailAction(btn.dataset.action, e));
    });

    // Thread navigation
    detailEl.querySelectorAll('.mail-thread-item').forEach(el => {
      el.addEventListener('click', () => selectEmail(parseInt(el.dataset.id)));
    });
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
    return `padding:6px 12px; border-radius:6px; border:1px solid var(--border); background:var(--bg-card); color:${color || 'var(--text-main)'}; cursor:pointer; font-size:12px; white-space:nowrap;`;
  }

  return { render };
})();
