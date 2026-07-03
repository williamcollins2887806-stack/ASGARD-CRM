/**
 * ASGARD CRM — Корзина заявок директора (Vanilla desktop — Волна 4а)
 * См. PERSONAL_KANBAN_AND_INBOX_PIPELINE.md §4.1.
 *
 * Доступ:
 *   - Директора (ADMIN / DIRECTOR_* / HEAD_PM) — режим распределения по РП.
 *   - PM / HEAD_PM — режим маркетплейса (свободные заявки, кнопка «Забрать»).
 * 23.06.2026: добавлен marketplace-режим (см. PM_ROLES).
 */
window.AsgardDirectorInboxPage = (function () {
  const { $, $$, esc, toast, showModal, hideModal, emptyState, formatDateTime } = AsgardUI;
  const fmtDate = (iso) => iso ? (AsgardUI.formatDate ? AsgardUI.formatDate(iso) : new Date(iso).toLocaleDateString('ru-RU')) : '—';

  const DIRECTOR_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_PM'];
  const PM_ROLES = ['PM','HEAD_PM'];
  // HEAD_PM участвует в обоих списках — может и распределять, и забирать.

  const FILTERS = [
    { key: 'new',     label: 'Новые',    statuses: ['new', 'ai_processed', 'under_review'],
      ptStatuses: ['new', 'in_review', 'need_docs'] },
    // Wave A+ fix MIN#7: 'accepted' добавлен — pre_tender'ы после accept конвертируются в tender,
    // но запись pre_tender_requests со status='accepted' остаётся; для согласованности с inbox
    // 'accepted' и в 'В работе' (видны 1 цикл до закрытия).
    { key: 'working', label: 'В работе', statuses: ['assigned', 'accepted'],
      ptStatuses: ['pending_approval', 'approved', 'accepted'] },
    { key: 'archive', label: 'Архив',    statuses: ['rejected', 'archived'],
      ptStatuses: ['rejected', 'expired'] }
  ];

  // Wave C: тип-фильтр (inbox / pre_tender / все)
  const TYPE_FILTERS = [
    { key: 'all',        label: 'Все типы' },
    { key: 'inbox',      label: '📥 Заявки' },
    { key: 'pre_tender', label: '🗂 Пре-тендеры' }
  ];

  const COLOR_LABEL = {
    green:  { label: 'Наш профиль',      cls: 'di-color-green',  icon: '🟢' },
    yellow: { label: 'Требует оценки',   cls: 'di-color-yellow', icon: '🟡' },
    red:    { label: 'Не наш профиль',   cls: 'di-color-red',    icon: '🔴' }
  };

  const SOURCE_KIND_LABEL = {
    corporate_forward: 'Переслано из корп. почты',
    external_direct:   'Внешний отправитель',
    platform:          'Тендерная площадка',
    manual:            'Прямая заявка',
    unknown:           'Не определён'
  };

  // ── State ────────────────────────────────────────────────────────────
  let _layout = null;
  let _user = null;
  let _filterKey = 'new';
  let _typeFilter = 'all'; // Wave C: тип-фильтр
  let _items = [];
  let _pmList = null;
  // 23.06.2026 Маркетплейс
  let _mode = 'director';      // 'director' | 'marketplace'
  let _myStats = null;         // { active_count, limit, breakdown, can_claim }
  let _sseListenerBound = false;

  // Wave C: API для pre-tenders
  async function apiPreTender(path, opts) {
    opts = opts || {};
    const headers = await _authHeaders();
    if (opts.headers) Object.assign(headers, opts.headers);
    const init = { method: opts.method || 'GET', headers };
    if (opts.body) init.body = JSON.stringify(opts.body);
    const res = await fetch('/api/pre-tenders' + path, init);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data };
  }

  async function _authHeaders() {
    const token = localStorage.getItem('asgard_token') || '';
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = await _authHeaders();
    if (opts.headers) Object.assign(headers, opts.headers);
    const init = { method: opts.method || 'GET', headers };
    if (opts.body && !opts.isFormData) init.body = JSON.stringify(opts.body);
    if (opts.body && opts.isFormData) {
      delete headers['Content-Type'];
      init.body = opts.body;
    }
    const res = await fetch('/api/inbox-applications' + path, init);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data };
  }

  async function loadPmList() {
    if (_pmList) return _pmList;
    const headers = await _authHeaders();
    const all = [];
    for (const role of ['PM', 'HEAD_PM']) {
      try {
        const r = await fetch(`/api/users?role=${role}&is_active=true&limit=200`, { headers });
        if (r.ok) {
          const j = await r.json();
          for (const u of (j.users || [])) all.push(u);
        }
      } catch (e) {}
    }
    _pmList = all;
    return all;
  }

  async function loadItems() {
    // ── Маркетплейс PM: только свободные pre_tender'ы FIFO ──────────────
    if (_mode === 'marketplace') {
      const r = await apiPreTender('/?unassigned=1&limit=200&offset=0&sort=created_at&order=ASC');
      const list = (r.ok && r.data && r.data.items) ? r.data.items : [];
      // На фронте дублируем ASC (backend форсит, но если кто-то рукой DESC передаст…)
      list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      _items = list.map(it => ({ ...it, _type: 'pre_tender' }));
      return;
    }

    // ── Директор: как раньше ─────────────────────────────────────────────
    const flt = FILTERS.find(f => f.key === _filterKey) || FILTERS[0];
    const all = [];

    // 1. inbox_applications (если не отфильтровано только pre_tender)
    if (_typeFilter === 'all' || _typeFilter === 'inbox') {
      for (const st of flt.statuses) {
        const r = await api(`/?status=${encodeURIComponent(st)}&limit=200&offset=0`);
        if (r.ok && r.data && r.data.items) {
          for (const it of r.data.items) all.push({ ...it, _type: 'inbox' });
        }
      }
    }

    // 2. pre_tender_requests (если не отфильтровано только inbox)
    if (_typeFilter === 'all' || _typeFilter === 'pre_tender') {
      for (const st of (flt.ptStatuses || [])) {
        const r = await apiPreTender(`/?status=${encodeURIComponent(st)}&limit=200&offset=0`);
        if (r.ok && r.data && r.data.items) {
          for (const it of r.data.items) all.push({ ...it, _type: 'pre_tender' });
        }
      }
    }

    // 27.06.2026 FIX дубля: одно письмо может породить и inbox_application,
    // и pre_tender_request (через общий email_id). Если оба попали в выдачу —
    // показываем только pre_tender (он «свежее» в воронке). Раньше письмо
    // отображалось дважды (📥 Заявка + 🗂 Pre-tender) и путало директора.
    const preTenderEmailIds = new Set(
      all
        .filter((it) => it._type === 'pre_tender' && it.email_id)
        .map((it) => it.email_id)
    );
    const deduped = all.filter(
      (it) => !(it._type === 'inbox' && it.email_id && preTenderEmailIds.has(it.email_id))
    );
    deduped.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    _items = deduped;
  }

  // 23.06.2026 Маркетплейс: подгрузка X/5.
  async function loadMyStats() {
    if (_mode !== 'marketplace') { _myStats = null; return; }
    try {
      const r = await apiPreTender('/my-stats');
      _myStats = (r.ok && r.data && r.data.success) ? r.data : null;
    } catch (e) { _myStats = null; }
  }

  // Wave C: единый htmlCard для inbox_application + pre_tender_request
  function htmlCard(it) {
    if (it._type === 'pre_tender') return htmlPreTenderCard(it);
    return htmlInboxCard(it);
  }

  function htmlInboxCard(it) {
    const color = COLOR_LABEL[it.ai_color] || { label: '—', cls: 'di-color-gray', icon: '⚪' };
    const conf = it.ai_confidence != null ? Math.round(parseFloat(it.ai_confidence) * 100) : null;
    const sk = SOURCE_KIND_LABEL[it.source_kind] || SOURCE_KIND_LABEL.unknown;
    const fromName = it.original_sender_name || it.source_name || '';
    const fromEmail = it.original_sender_email || it.source_email || '';
    const summary = (it.ai_summary || it.body_preview || '').toString();
    // 26.06.2026: показываем ФИО назначенного РП (backend теперь делает LEFT JOIN users).
    // Fallback на «PM #ID» оставлен только для очень старых записей без резолва.
    const assigned = it.assigned_pm_id
      ? `Назначен: ${it.assigned_pm_name || ('PM #' + it.assigned_pm_id)}`
      : '';

    const canAssign = !it.assigned_pm_id;

    return `<div class="di-card" data-id="${it.id}" data-type="inbox">
      <div class="di-card-row">
        <div class="di-card-title" title="${esc(it.subject || '')}">
          <span style="font-size:11px;padding:1px 5px;background:var(--bg-elevated);border-radius:4px;margin-right:6px">📥 Заявка</span>
          ${esc(it.subject || '(без темы)')}
        </div>
        <div class="di-color-badge ${color.cls}" title="${esc(color.label)}">${color.icon} ${esc(color.label)}${conf != null ? ' · ' + conf + '%' : ''}</div>
      </div>
      ${summary ? `<div class="di-summary">${esc(summary.slice(0, 280))}</div>` : ''}
      <div class="di-meta">
        <span title="${esc(fromEmail)}">${esc(fromName || fromEmail || '—')}</span>
        <span>· ${esc(sk)}</span>
        <span>· ${formatDateTime(it.created_at)}</span>
        ${assigned ? `<span>· ${esc(assigned)}</span>` : ''}
      </div>
      <div class="di-card-actions">
        ${canAssign ? `<button class="btn primary" data-act="assign" data-id="${it.id}">Назначить РП</button>` : ''}
        <button class="btn ghost" data-act="view" data-id="${it.id}">👁 Просмотр</button>
        ${it.email_id ? `<button class="btn ghost" data-act="email" data-id="${it.email_id}">📧 Письмо целиком</button>` : ''}
      </div>
    </div>`;
  }

  // Wave C: pre_tender карточка
  function htmlPreTenderCard(it) {
    const color = COLOR_LABEL[it.ai_color] || { label: '—', cls: 'di-color-gray', icon: '⚪' };
    const ptStatusLabel = {
      new: '🆕 Новая', in_review: '🔍 На рассмотрении', need_docs: '📄 Запрошены доки',
      pending_approval: '⏳ Согласование', approved: '✓ Согласован',
      accepted: '✓ Принят', rejected: '✕ Отклонён', expired: '⌛ Просрочен'
    }[it.status] || it.status;
    const title = it.customer_name || it.work_description?.slice(0, 60) || `Просчёт #${it.id}`;
    const summary = (it.ai_summary || it.work_description || '').toString();
    const contact = it.contact_person ? `${it.contact_person}` : (it.customer_email || '');
    const sum = it.estimated_sum ? `${Number(it.estimated_sum).toLocaleString('ru-RU')} ₽` : '';
    const deadline = it.work_deadline ? `до ${fmtDate(it.work_deadline)}` : '';
    const assigned = it.assigned_to_name ? `Назначен: ${it.assigned_to_name}` : '';

    return `<div class="di-card" data-id="${it.id}" data-type="pre_tender">
      <div class="di-card-row">
        <div class="di-card-title" title="${esc(title)}">
          <span style="font-size:11px;padding:1px 5px;background:var(--bg-elevated);border-radius:4px;margin-right:6px">🗂 Pre-tender</span>
          ${esc(title)}
        </div>
        <div class="di-color-badge ${color.cls}" title="${esc(color.label)}">${color.icon} ${esc(color.label)}</div>
      </div>
      <div style="font-size:11px;color:var(--text-secondary);margin-top:4px"><b>Статус:</b> ${esc(ptStatusLabel)}</div>
      ${summary ? `<div class="di-summary">${esc(summary.slice(0, 280))}</div>` : ''}
      <div class="di-meta">
        ${contact ? `<span>${esc(contact)}</span>` : ''}
        ${sum ? `<span>· ${esc(sum)}</span>` : ''}
        ${deadline ? `<span>· ${esc(deadline)}</span>` : ''}
        <span>· ${formatDateTime(it.created_at)}</span>
        ${assigned ? `<span>· ${esc(assigned)}</span>` : ''}
      </div>
      <div class="di-card-actions">
        ${_mode === 'marketplace' ? `
          <button class="btn primary di-claim-btn" data-act="pt-claim" data-id="${it.id}"
            ${(_myStats && !_myStats.can_claim) ? 'disabled title="Достигнут лимит 5 заявок"' : ''}>
            🎯 Забрать себе
          </button>` : ''}
        <button class="btn ghost" data-act="pt-view" data-id="${it.id}">👁 Просмотр</button>
        ${it.email_id ? `<button class="btn ghost" data-act="email" data-id="${it.email_id}">📧 Письмо целиком</button>` : ''}
      </div>
    </div>`;
  }

  function renderPage() {
    const root = $('#di-root');
    if (!root) return;

    if (_mode === 'marketplace') return _renderMarketplace(root);

    const filters = FILTERS.map(f => {
      return `<button class="di-filter ${f.key === _filterKey ? 'active' : ''}" data-filter="${f.key}">${esc(f.label)}</button>`;
    }).join('');

    // Wave C: тип-фильтры
    const typeFilters = TYPE_FILTERS.map(f => {
      return `<button class="di-filter ${f.key === _typeFilter ? 'active' : ''}" data-type-filter="${f.key}">${esc(f.label)}</button>`;
    }).join('');

    let body;
    if (_items.length === 0) {
      const msg = _filterKey === 'new'
        ? { icon: '📭', title: 'Корзина чиста', desc: 'Новых заявок нет. Создайте «Прямую заявку» от себя.' }
        : { icon: '📦', title: 'Пусто', desc: 'В этом разделе пока нет заявок.' };
      body = `<div class="di-grid"></div>${emptyState(msg)}`;
    } else {
      const inboxN = _items.filter(i => i._type === 'inbox').length;
      const ptN = _items.filter(i => i._type === 'pre_tender').length;
      const counter = `<div style="font-size:11px;color:var(--text-secondary);margin:6px 0">
        Всего: <b>${_items.length}</b> · 📥 ${inboxN} · 🗂 ${ptN}
      </div>`;
      body = counter + `<div class="di-grid">${_items.map(htmlCard).join('')}</div>`;
    }

    root.innerHTML = `<div class="di-page">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div class="di-filters">${filters}</div>
        <div>
          <!-- 27.06.2026 UX: убрана кнопка «＋ Прямая заявка от меня» —
               директор не создаёт заявки вручную, это делает РП у себя. -->
          <button class="btn ghost" id="di-btn-refresh" title="Обновить">⟳</button>
        </div>
      </div>
      <div class="di-filters" style="margin-top:8px">${typeFilters}</div>
      ${body}
    </div>`;

    _bindPage();
  }

  // 23.06.2026 Маркетплейс: отдельный рендер для PM.
  function _renderMarketplace(root) {
    const stats = _myStats || { active_count: 0, limit: 5, can_claim: true };
    const limitReached = stats.active_count >= stats.limit;
    const badgeColor = limitReached ? 'var(--red, #C8293B)' : 'var(--gold, #D4A843)';
    const badgeBg = limitReached
      ? 'var(--red-glow, rgba(231,76,60,.18))'
      : 'var(--gold-bg, rgba(212,168,67,.18))';
    const badgeTip = limitReached
      ? 'Достигнут лимит. Доведите текущие заявки до конца, чтобы взять новую.'
      : 'Активные заявки в работе';

    let body;
    if (_items.length === 0) {
      body = emptyState({
        icon: '📭',
        title: 'Маркетплейс пуст',
        desc: 'Свободных заявок нет. Загляните позже.'
      });
    } else {
      const counter = `<div style="font-size:11px;color:var(--text-secondary);margin:6px 0">
        Свободных заявок: <b>${_items.length}</b> · сортировка FIFO (старые сверху)
      </div>`;
      body = counter + `<div class="di-grid">${_items.map(htmlCard).join('')}</div>`;
    }

    const headerLimitNote = limitReached
      ? `<div style="margin-top:8px;padding:8px 12px;background:${badgeBg};border-left:3px solid ${badgeColor};border-radius:6px;font-size:12px;color:var(--text-primary)">
           🚫 Лимит достигнут. Закройте/передайте текущие заявки, чтобы взять новые.
         </div>`
      : '';

    root.innerHTML = `<div class="di-page">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--text-primary)">🎯 Маркетплейс заявок</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">
            Свободные заявки — заберите подходящую (FIFO: старые сверху).
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="di-stat-badge" title="${esc(badgeTip)}"
            style="padding:6px 12px;border-radius:8px;background:${badgeBg};color:${badgeColor};font-weight:700;font-size:13px;border:1px solid ${badgeColor}">
            У вас ${stats.active_count} / ${stats.limit}
          </span>
          <button class="btn ghost" id="di-btn-refresh" title="Обновить">⟳</button>
        </div>
      </div>
      ${headerLimitNote}
      <div style="margin-top:14px"></div>
      ${body}
    </div>`;

    _bindPage();
  }

  function _bindPage() {
    $$('.di-filter[data-filter]').forEach(b => {
      b.addEventListener('click', async () => {
        _filterKey = b.dataset.filter;
        await loadItems();
        renderPage();
      });
    });

    // Wave C: тип-фильтр
    $$('.di-filter[data-type-filter]').forEach(b => {
      b.addEventListener('click', async () => {
        _typeFilter = b.dataset.typeFilter;
        await loadItems();
        renderPage();
      });
    });

    const refresh = $('#di-btn-refresh');
    if (refresh) refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      try {
        await loadItems();
        if (_mode === 'marketplace') await loadMyStats();
        renderPage();
        toast('Готово', 'Обновлено', 'ok');
      }
      finally { refresh.disabled = false; }
    });

    const direct = $('#di-btn-direct');
    if (direct) direct.addEventListener('click', openDirectFromDirectorModal);

    $$('button[data-act="assign"]').forEach(b => {
      b.addEventListener('click', () => openAssignPmModal(Number(b.dataset.id)));
    });
    $$('button[data-act="view"]').forEach(b => {
      b.addEventListener('click', () => openApplicationDetailModal(Number(b.dataset.id)));
    });
    // Wave C: pre_tender detail
    $$('button[data-act="pt-view"]').forEach(b => {
      b.addEventListener('click', () => openPreTenderDetailModal(Number(b.dataset.id)));
    });
    // 23.06.2026 Маркетплейс: «Забрать себе»
    $$('button[data-act="pt-claim"]').forEach(b => {
      b.addEventListener('click', () => claimPreTender(Number(b.dataset.id), b));
    });
    $$('button[data-act="email"]').forEach(b => {
      b.addEventListener('click', () => {
        const emailId = Number(b.dataset.id);
        // Откроем письмо в новой вкладке — паттерн совместим с mailbox/my-mail
        location.hash = `#/mailbox?email=${emailId}`;
      });
    });
  }

  // 23.06.2026 Маркетплейс: забрать заявку.
  async function claimPreTender(ptId, btn) {
    const it = _items.find(x => x.id === ptId);
    const title = it?.customer_name || it?.work_description?.slice(0, 60) || `№${ptId}`;
    if (!window.confirm(`Заберёте заявку «${title}»? Она перейдёт к вам в работу.`)) return;

    if (btn) btn.disabled = true;
    let r;
    try {
      r = await apiPreTender(`/${ptId}/claim`, { method: 'POST', body: {} });
    } catch (e) {
      if (btn) btn.disabled = false;
      toast('Ошибка', 'Сбой сети — попробуйте ещё раз', 'err');
      return;
    }
    if (btn) btn.disabled = false;

    if (r.ok && r.data && r.data.success) {
      toast('Готово', '✅ Заявка забрана', 'ok');
      // Редирект в личный канбан на свежую карточку.
      if (r.data.redirect_to) {
        location.hash = r.data.redirect_to;
      } else {
        await loadItems(); await loadMyStats(); renderPage();
      }
      return;
    }
    // Обработка 409
    if (r.status === 409 && r.data) {
      if (r.data.error === 'already_claimed') {
        const claimer = r.data.claimed_by_name || 'другой РП';
        toast('Опоздали', `😔 Опередил ${claimer}`, 'err');
      } else if (r.data.error === 'limit_reached') {
        toast('Лимит', `🚫 Лимит ${r.data.limit || 5} заявок — закройте текущие, прежде чем брать новые.`, 'err');
      } else if (r.data.error === 'not_claimable') {
        toast('Поздно', 'Заявку уже взяли в работу', 'err');
      } else {
        toast('Ошибка', r.data.error || 'Не удалось забрать', 'err');
      }
      await loadItems(); await loadMyStats(); renderPage();
      return;
    }
    // Прочие ошибки
    toast('Ошибка', (r?.data?.message || r?.data?.error || 'Не удалось забрать'), 'err');
  }

  // 23.06.2026 Маркетплейс: SSE-слушатель удалит карточку, если её забрал коллега.
  function _bindSseOnce() {
    if (_sseListenerBound) return;
    if (!window._asgardSSE) return;
    _sseListenerBound = true;
    try {
      window._asgardSSE.addEventListener('pre_tender:claimed', async (e) => {
        if (_mode !== 'marketplace') return;
        let data; try { data = JSON.parse(e.data); } catch (_) { return; }
        const ptId = Number(data?.id);
        if (!ptId) return;
        const had = _items.some(it => it.id === ptId);
        if (!had) return;
        // Не я ли забрал? Если я — не показываем «опередил».
        if (data.claimed_by_id && data.claimed_by_id === _user?.id) return;
        _items = _items.filter(it => it.id !== ptId);
        renderPage();
        toast('Заявка ушла', `${data.claimed_by_name || 'Коллега'} забрал заявку #${ptId}`, 'ok');
      });
      window._asgardSSE.addEventListener('pre_tender:transferred', async () => {
        if (_mode !== 'marketplace') return;
        // Передача между РП — на маркетплейсе ничего не меняет (там только assigned_to IS NULL).
      });
    } catch (e) {
      // SSE может быть недоступен — это не фатально.
    }
  }

  // ── Wave A — BUG-4: модалка деталей заявки с атачментами ──────────────
  async function openApplicationDetailModal(appId) {
    const r = await api(`/${appId}`);
    if (!r.ok || !r.data?.item) {
      toast('Ошибка', 'Не удалось загрузить детали заявки', 'err');
      return;
    }
    const item = r.data.item;
    const atts = r.data.attachments || [];
    const tk = encodeURIComponent(localStorage.getItem('asgard_token') || '');

    const colorMap = { green: '#27ae60', yellow: '#f39c12', red: '#e74c3c' };
    const badgeColor = colorMap[item.ai_color] || '#8a93a6';

    const summaryBlock = item.ai_summary ? `
      <div style="margin-top:8px;padding:8px 10px;background:var(--bg-elevated);border-left:3px solid ${badgeColor};border-radius:6px">
        <div style="font-size:11px;color:var(--text-secondary);font-weight:600">AI-резюме</div>
        <div style="font-size:13px;color:var(--text-primary);margin-top:4px;line-height:1.4">${esc(item.ai_summary)}</div>
        ${item.ai_recommendation ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:6px"><b>Рекомендация:</b> ${esc(item.ai_recommendation)}</div>` : ''}
      </div>` : '';

    const fwdBlock = (item.source_kind === 'corporate_forward') ? `
      <div style="font-size:11px;color:var(--text-secondary);margin-top:6px">
        Переслал: <b>${esc(item.forwarded_from_email || '?')}</b>
        ${item.original_sender_email ? ` · Клиент: <b>${esc(item.original_sender_email)}</b> ${item.original_sender_name ? '(' + esc(item.original_sender_name) + ')' : ''}` : ''}
      </div>` : '';

    const body = (item.body_preview || item.email_body_text || '').toString();
    const bodyBlock = body ? `
      <div style="margin-top:8px">
        <div style="font-size:11px;color:var(--text-secondary);font-weight:600;margin-bottom:4px">Текст письма (первые 600)</div>
        <div style="font-size:12px;color:var(--text-primary);line-height:1.4;white-space:pre-wrap;max-height:200px;overflow-y:auto;padding:6px 8px;background:var(--bg-elevated);border-radius:6px">${esc(body.slice(0, 600))}${body.length > 600 ? '…' : ''}</div>
      </div>` : '';

    const attsBlock = atts.length ? `
      <div style="margin-top:10px">
        <div style="font-size:11px;color:var(--text-secondary);font-weight:600;margin-bottom:6px">Вложения · ${atts.length}</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${atts.map(a => `
            <a href="/api/inbox-applications/${item.id}/attachments/${a.id}/download?token=${tk}" target="_blank"
               style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--bg-elevated);border-radius:6px;text-decoration:none;color:var(--text-primary);font-size:12px">
              📎 <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.original_filename || a.filename)}</span>
              <span style="color:var(--text-secondary);font-size:10px">${a.size ? Math.round(a.size / 1024) + ' КБ' : ''}</span>
            </a>`).join('')}
        </div>
      </div>` : '<div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">Вложений нет</div>';

    const html = `
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="font-size:14px;color:var(--text-primary);font-weight:600">${esc(item.subject || '(без темы)')}</div>
        ${fwdBlock}
        ${summaryBlock}
        ${bodyBlock}
        ${attsBlock}
        <div class="pk-modal-foot">
          ${!item.assigned_pm_id ? `<button class="btn primary" id="di-detail-assign">Назначить РП</button>` : ''}
          <button class="btn ghost" id="di-detail-close">Закрыть</button>
        </div>
      </div>`;

    showModal({
      title: `Заявка #${item.id}`, html, icon: '📥', wide: true,
      onMount: () => {
        $('#di-detail-close').addEventListener('click', hideModal);
        const assignBtn = $('#di-detail-assign');
        if (assignBtn) assignBtn.addEventListener('click', () => { hideModal(); openAssignPmModal(item.id); });
      }
    });
  }

  // ── Wave C: модалка деталей pre_tender (для директора/HEAD_PM) ──
  async function openPreTenderDetailModal(ptId) {
    const r = await apiPreTender(`/${ptId}`);
    if (!r.ok || !r.data?.item) {
      toast('Ошибка', 'Не удалось загрузить просчёт', 'err');
      return;
    }
    const item = r.data.item;
    const atts = r.data.attachments || [];
    const tk = encodeURIComponent(localStorage.getItem('asgard_token') || '');

    const colorMap = { green: '#27ae60', yellow: '#f39c12', red: '#e74c3c' };
    const badgeColor = colorMap[item.ai_color] || '#8a93a6';

    const statusLabels = {
      new:'🆕 Новая', in_review:'🔍 На рассмотрении', need_docs:'📄 Запрошены доки',
      pending_approval:'⏳ Ожидает согласования', approved:'✓ Согласован',
      accepted:'✓ Принят', rejected:'✕ Отклонён', expired:'⌛ Просрочен'
    };

    const clientBlock = `
      <div style="margin-top:8px;padding:8px 10px;background:var(--bg-elevated);border-radius:6px;font-size:12px;line-height:1.5">
        <div><b>Клиент:</b> ${esc(item.customer_name || '—')}${item.customer_email ? ' · ' + esc(item.customer_email) : ''}</div>
        ${item.customer_inn ? `<div><b>ИНН:</b> ${esc(item.customer_inn)}</div>` : ''}
        ${item.contact_person ? `<div><b>Контакт:</b> ${esc(item.contact_person)}${item.contact_phone ? ' · ' + esc(item.contact_phone) : ''}</div>` : ''}
        ${item.assigned_to_name ? `<div><b>РП:</b> ${esc(item.assigned_to_name)}</div>` : ''}
      </div>`;

    const workBlock = `
      <div style="margin-top:8px;font-size:12px;line-height:1.5">
        ${item.work_description ? `<div><b>Описание работ:</b><br>${esc((item.work_description || '').slice(0, 600))}${item.work_description.length > 600 ? '…' : ''}</div>` : ''}
        ${item.work_location ? `<div style="margin-top:4px"><b>Объект:</b> ${esc(item.work_location)}</div>` : ''}
        ${item.work_deadline ? `<div style="margin-top:4px"><b>Срок:</b> ${esc(fmtDate(item.work_deadline))}</div>` : ''}
        ${item.estimated_sum ? `<div style="margin-top:4px"><b>Бюджет (оценка):</b> ${Number(item.estimated_sum).toLocaleString('ru-RU')} ₽</div>` : ''}
      </div>`;

    const summaryBlock = item.ai_summary ? `
      <div style="margin-top:8px;padding:8px 10px;background:var(--bg-elevated);border-left:3px solid ${badgeColor};border-radius:6px">
        <div style="font-size:11px;color:var(--text-secondary);font-weight:600">AI-резюме</div>
        <div style="font-size:13px;color:var(--text-primary);margin-top:4px;line-height:1.4">${esc(item.ai_summary)}</div>
        ${item.ai_recommendation ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:6px"><b>Рекомендация:</b> ${esc(item.ai_recommendation)}</div>` : ''}
      </div>` : '';

    // Wave D BUG-8: email_attachments + manual_documents в едином блоке.
    const manualDocs = Array.isArray(item.manual_documents) ? item.manual_documents : [];
    const allDocs = atts.map(a => ({
      _src: 'email', _id: a.id, name: a.original_filename || a.filename || 'файл',
      size: a.size
    })).concat(manualDocs.map((md, idx) => ({
      _src: 'manual', _idx: idx, name: md.original_name || md.filename || 'документ',
      size: md.size
    })));
    const attsBlock = allDocs.length ? `
      <div style="margin-top:10px">
        <div style="font-size:11px;color:var(--text-secondary);font-weight:600;margin-bottom:6px">Документы · ${allDocs.length}</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${allDocs.map(a => {
            // Wave A+ fix BLOCKER#2: email-attachments под pre_tender идут через
            // /api/pre-tenders/:ptId/email-attachments/:attId/download (новый endpoint),
            // а не через /inbox-applications/0/... (хардкод appId=0 давал 404).
            const href = a._src === 'email'
              ? `/api/pre-tenders/${item.id}/email-attachments/${a._id}/download?token=${tk}`
              : `/api/pre-tenders/${item.id}/documents/${a._idx}/download?token=${tk}`;
            const tag = a._src === 'email' ? '📧' : '📤';
            return `<a href="${href}" target="_blank"
               style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--bg-elevated);border-radius:6px;text-decoration:none;color:var(--text-primary);font-size:12px">
              ${tag} <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}</span>
              <span style="color:var(--text-secondary);font-size:10px">${a.size ? Math.round(a.size / 1024) + ' КБ' : ''}</span>
            </a>`;
          }).join('')}
        </div>
      </div>` : '';

    // Действия по статусу
    const st = (item.status || '').toLowerCase();
    let actionsHtml = '';
    if (['new', 'in_review', 'need_docs', 'pending_approval'].includes(st)) {
      actionsHtml = `
        <button class="btn primary" id="di-pt-accept">✓ Принять и создать тендер</button>
        ${st !== 'need_docs' ? `<button class="btn ghost" id="di-pt-need-docs">📄 Запросить доки</button>` : ''}
        <button class="btn warn" id="di-pt-reject">✕ Отклонить</button>
      `;
    } else if (st === 'accepted' && item.created_tender_id) {
      actionsHtml = `<a class="btn primary" href="#/tenders?id=${item.created_tender_id}">→ Перейти к тендеру #${item.created_tender_id}</a>`;
    } else if (st === 'rejected') {
      actionsHtml = `<div style="font-size:12px;color:var(--text-secondary)">Отклонён${item.reject_reason ? ': ' + esc(item.reject_reason) : ''}</div>`;
    }

    const title = item.customer_name || item.work_description?.slice(0, 60) || `Просчёт #${item.id}`;
    const html = `
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="font-size:14px;color:var(--text-primary);font-weight:600">${esc(title)}</div>
        <div>
          <span style="display:inline-block;padding:2px 8px;background:${badgeColor};color:#fff;border-radius:6px;font-size:11px;font-weight:600">PRE-TENDER</span>
          <span style="margin-left:6px;font-size:11px;color:var(--text-secondary)">${esc(statusLabels[st] || item.status || '')}</span>
        </div>
        ${clientBlock}
        ${workBlock}
        ${summaryBlock}
        ${attsBlock}
        <div class="pk-modal-foot" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          ${actionsHtml}
          <button class="btn ghost" id="di-pt-close">Закрыть</button>
        </div>
      </div>`;

    showModal({
      title: `Pre-tender #${item.id}`, html, icon: '🗂', wide: true,
      onMount: () => {
        $('#di-pt-close').addEventListener('click', hideModal);
        $('#di-pt-accept')?.addEventListener('click', () => doPtAction(item.id, 'accept'));
        $('#di-pt-reject')?.addEventListener('click', () => doPtAction(item.id, 'reject'));
        $('#di-pt-need-docs')?.addEventListener('click', () => doPtAction(item.id, 'request-docs'));
      }
    });
  }

  async function doPtAction(ptId, action) {
    let r;
    if (action === 'accept') {
      if (!window.confirm('Принять просчёт и создать тендер?')) return;
      r = await apiPreTender(`/${ptId}/accept`, { method: 'POST', body: {} });
      if (r.ok) toast('Готово', 'Тендер создан', 'ok');
    } else if (action === 'reject') {
      const reason = window.prompt('Причина отказа?');
      if (!reason || !reason.trim()) return;
      r = await apiPreTender(`/${ptId}/reject`, { method: 'POST', body: { reject_reason: reason.trim() } });
      if (r.ok) toast('Готово', 'Отклонено', 'ok');
    } else if (action === 'request-docs') {
      const what = window.prompt('Что запросить у клиента?');
      if (!what || !what.trim()) return;
      r = await apiPreTender(`/${ptId}/request-docs`, { method: 'POST', body: { request_text: what.trim() } });
      if (r.ok) toast('Готово', 'Запрос отправлен', 'ok');
    }
    if (!r || !r.ok) {
      toast('Ошибка', (r?.data?.error || r?.data?.message || 'Не удалось'), 'err');
      return;
    }
    hideModal();
    await loadItems(); renderPage();
  }

  async function openAssignPmModal(appId) {
    const it = _items.find(x => x.id === appId);
    if (!it) return;
    const pmList = await loadPmList();
    const options = pmList.map(u => `<option value="${u.id}">${esc(u.name || u.login)} (${esc(u.role)})</option>`).join('');
    const html = `
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">
        Заявка: <b style="color:var(--text-primary)">${esc(it.subject || '(без темы)')}</b>
      </div>
      <div class="pk-form-grp">
        <label>Кому назначить</label>
        <select id="di-assign-pm">
          <option value="">— Выберите РП —</option>${options}
        </select>
      </div>
      <div class="pk-form-grp">
        <label>Комментарий (опционально)</label>
        <textarea id="di-assign-note" rows="3" placeholder="Кратко: что важно для РП"></textarea>
      </div>
      <div class="pk-modal-foot">
        <button class="btn ghost" id="di-assign-cancel">Отмена</button>
        <button class="btn primary" id="di-assign-ok">Назначить</button>
      </div>`;
    showModal({
      title: 'Назначить РП', html, icon: '👤',
      onMount: () => {
        $('#di-assign-cancel').addEventListener('click', hideModal);
        $('#di-assign-ok').addEventListener('click', async () => {
          const pmId = Number($('#di-assign-pm').value || 0);
          if (!pmId) { toast('Ошибка', 'Выберите РП', 'err'); return; }
          const note = $('#di-assign-note').value.trim() || null;
          const btn = $('#di-assign-ok'); btn.disabled = true;
          const r = await api(`/${appId}/assign-pm`, { method: 'POST', body: { pm_user_id: pmId, note }});
          btn.disabled = false;
          if (r.ok && r.data && r.data.success) {
            hideModal();
            toast('Готово', `Назначен — карта #${r.data.card_id || '?'}`, 'ok');
            await loadItems(); renderPage();
          } else if (r.status === 409 && r.data && r.data.error === 'already_assigned') {
            toast('Ошибка', 'Уже назначен — обновите страницу', 'err');
            await loadItems(); renderPage();
          } else {
            toast('Ошибка', (r.data && (r.data.message || r.data.error)) || 'Не удалось назначить', 'err');
          }
        });
      }
    });
  }

  async function openDirectFromDirectorModal() {
    const pmList = await loadPmList();
    const options = pmList.map(u => `<option value="${u.id}">${esc(u.name || u.login)} (${esc(u.role)})</option>`).join('');
    const html = `
      <div class="pk-form-grp">
        <label>Назначить РП <span style="color:var(--red,#e74c3c)">*</span></label>
        <select id="di-da-pm">
          <option value="">— Выберите РП —</option>${options}
        </select>
      </div>
      <div class="pk-form-grp">
        <label>Тема <span style="color:var(--red,#e74c3c)">*</span></label>
        <input type="text" id="di-da-title" maxlength="500" placeholder="Например: «Запросить КП у заказчика …»" />
      </div>
      <div class="pk-form-grp">
        <label>Описание <span style="color:var(--red,#e74c3c)">*</span></label>
        <textarea id="di-da-body" rows="6" placeholder="Полное описание заявки и инструкции для РП"></textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="pk-form-grp">
          <label>Заказчик (имя)</label>
          <input type="text" id="di-da-cn" />
        </div>
        <div class="pk-form-grp">
          <label>Контакт (email/тел.)</label>
          <input type="text" id="di-da-cc" />
        </div>
      </div>
      <div class="pk-form-grp">
        <label>Вложения (до 20 файлов)</label>
        <input type="file" id="di-da-files" multiple />
      </div>
      <div class="pk-modal-foot">
        <button class="btn ghost" id="di-da-cancel">Отмена</button>
        <button class="btn primary" id="di-da-ok">Создать</button>
      </div>`;
    showModal({
      title: 'Прямая заявка от меня', html, icon: '📥', wide: true,
      onMount: () => {
        $('#di-da-cancel').addEventListener('click', hideModal);
        $('#di-da-ok').addEventListener('click', async () => {
          const pmId = Number($('#di-da-pm').value || 0);
          if (!pmId) { toast('Ошибка', 'Выберите РП', 'err'); return; }
          const title = $('#di-da-title').value.trim();
          const bodyText = $('#di-da-body').value.trim();
          if (title.length < 2 || title.length > 500) { toast('Ошибка', 'Тема: 2..500 символов', 'err'); return; }
          if (!bodyText) { toast('Ошибка', 'Введите описание', 'err'); return; }

          const fd = new FormData();
          fd.append('title', title);
          fd.append('body', bodyText);
          fd.append('assign_pm_user_id', String(pmId));
          const cn = $('#di-da-cn').value.trim(); if (cn) fd.append('customer_name', cn);
          const cc = $('#di-da-cc').value.trim(); if (cc) fd.append('customer_contact', cc);
          const files = $('#di-da-files').files;
          for (let i = 0; i < files.length; i++) fd.append('files', files[i]);

          const btn = $('#di-da-ok'); btn.disabled = true;
          const r = await api('/direct', { method: 'POST', body: fd, isFormData: true });
          btn.disabled = false;
          if (r.ok && r.data && r.data.success) {
            hideModal();
            toast('Готово', `Заявка №${r.data.application_id} создана`, 'ok');
            await loadItems(); renderPage();
          } else {
            toast('Ошибка', (r.data && (r.data.message || r.data.error)) || 'Не удалось создать', 'err');
          }
        });
      }
    });
  }

  async function render(opts) {
    // Стили шарим с personal_kanban (тот же файл с CSS-vars)
    if (window.AsgardPersonalKanbanPage && typeof AsgardPersonalKanbanPage.render === 'function') {
      // ничего не вызываем — только полагаемся, что styles inject уже произошёл,
      // но реалистичнее — добавить свой fallback inject ниже.
    }
    _injectStyles();

    _layout = opts.layout;
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    _user = auth.user;

    // 23.06.2026 Маркетплейс: выбираем режим по роли.
    // HEAD_PM — приоритет «директор» (он распределяет), PM — только маркетплейс.
    const role = _user.role;
    if (DIRECTOR_ROLES.includes(role)) {
      _mode = 'director';
    } else if (PM_ROLES.includes(role)) {
      _mode = 'marketplace';
    } else {
      _mode = 'director'; // безопасный дефолт
    }

    const title = opts.title || (_mode === 'marketplace' ? 'Маркетплейс заявок' : 'Корзина заявок');
    const motto = _mode === 'marketplace'
      ? 'Свободные заявки — FIFO. Кто первый встал, того и заявка.'
      : 'Все врата заявок здесь.';

    await _layout(`<div id="di-root">${AsgardUI.skeleton('row', 4)}</div>`, {
      title, motto
    });

    try {
      await loadItems();
      if (_mode === 'marketplace') await loadMyStats();
    }
    catch (e) {
      $('#di-root').innerHTML = `<div class="pk-empty">Не удалось загрузить заявки: ${esc(e.message || String(e))}</div>`;
      return;
    }
    renderPage();
    _bindSseOnce();
  }

  function _injectStyles() {
    // Re-inject guard: если personal_kanban.js (id=asg-pk-styles) или мы сами (asg-di-styles)
    // уже вставили стили — пропускаем. Иначе на re-render накапливаются <style> элементы.
    if (document.getElementById('asg-pk-styles') || document.getElementById('asg-di-styles')) return;
    // Дублирующий минимальный набор стилей, если personal_kanban.js ещё не загружен
    const css = `
.di-page{padding:8px 4px}
.di-filters{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0}
.di-filter{padding:7px 12px;border-radius:8px;background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border);cursor:pointer;font-size:13px;font-weight:600;font-family:var(--font-sans)}
.di-filter.active{background:var(--gold-bg);color:var(--gold);border-color:var(--gold)}
.di-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;margin-top:14px}
.di-card{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px}
.di-card-row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.di-card-title{font-weight:700;color:var(--text-primary);font-size:14px;line-height:1.3}
.di-color-badge{flex:0 0 auto;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700}
.di-color-green{background:var(--green-glow,rgba(39,174,96,.18));color:var(--green,#27ae60)}
.di-color-yellow{background:var(--amber-glow,rgba(243,156,18,.18));color:var(--amber,#D4A843)}
.di-color-red{background:var(--red-glow,rgba(231,76,60,.18));color:var(--red,#C8293B)}
.di-color-gray{background:var(--bg-elevated);color:var(--text-secondary)}
.di-summary{font-size:12px;color:var(--text-secondary);line-height:1.4}
.di-meta{font-size:11px;color:var(--text-secondary);display:flex;gap:10px;flex-wrap:wrap}
.di-card-actions{display:flex;gap:6px;margin-top:4px;flex-wrap:wrap}
.di-card-actions .btn{font-size:12px;padding:6px 10px}
.pk-form-grp{margin-bottom:12px}
.pk-form-grp label{display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px;font-weight:600}
.pk-form-grp input,.pk-form-grp textarea,.pk-form-grp select{width:100%;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:8px;padding:8px 10px;font-size:13px;box-sizing:border-box}
.pk-modal-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)}
.pk-empty{padding:32px 16px;text-align:center;color:var(--text-secondary);font-size:13px}
@media (max-width: 768px){.di-grid{grid-template-columns:1fr}}
`;
    const st = document.createElement('style');
    st.id = 'asg-di-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  return { render };
})();
