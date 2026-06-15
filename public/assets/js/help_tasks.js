'use strict';
/**
 * ASGARD CRM — Vanilla страница «🤝 Помощь коллеги» (модуль help-tasks).
 *
 * Backend: src/routes/tasks.js (расширен V212):
 *   /api/tasks/help/inbox|outbox|watching|stats
 *   POST /api/tasks {task_kind:'help', ...}
 *   PUT  /api/tasks/:id/{accept|decline|redirect|complete|reassign|escalate}
 *   POST /api/tasks/:id/watchers/bulk
 *
 * Регистрация: AsgardRouter.add('/help', AsgardHelpTasks.render) — в app.js.
 * Script-тег в index.html — рядом с tasks.js.
 */
window.AsgardHelpTasks = (function() {
  const ROLE_LABELS = {
    ADMIN:'Админ', PM:'РП', HEAD_PM:'Глава РП', TO:'ТО', HEAD_TO:'Глава ТО',
    PROC:'Закупки', BUH:'Бухгалтерия', HR:'Кадры', HR_MANAGER:'Глава кадров',
    WAREHOUSE:'Склад', CHIEF_ENGINEER:'Гл. инженер', OFFICE_MANAGER:'Офис-менеджер',
    DIRECTOR_GEN:'Ген. директор', DIRECTOR_COMM:'Ком. директор', DIRECTOR_DEV:'Дир. развития'
  };
  const STATUS_LABELS = {
    new:'Новая', accepted:'Принята', in_progress:'В работе',
    done:'Завершена', declined:'Отказ', overdue:'Просрочена', cancelled:'Отменена'
  };
  const PRIORITY_LABELS = { low:'Низкий', normal:'Обычно', high:'⚠️ Важно', urgent:'🔥 Горит' };

  let state = {
    tab: 'inbox',  // inbox | outbox | watching
    inbox: [], outbox: [], watching: [], stats: {},
    users: [],
    q: '',
    statusFilter: '',
    currentUser: null,
    loading: false
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const headers = () => ({ 'Content-Type':'application/json', 'Authorization': 'Bearer ' + (window.AsgardAuth?.token || localStorage.getItem('token') || '') });

  async function api(method, path, body) {
    const opts = { method, headers: headers() };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    let data = null; try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(data?.error || `${r.status}`);
    return data;
  }

  function injectStyles() {
    if (document.getElementById('help-tasks-styles')) return;
    const css = `
      .ht-page { max-width: 1280px; margin: 0 auto; padding: 16px 24px 48px; }
      .ht-head { display:flex; align-items:center; justify-content:space-between; padding-bottom:14px; border-bottom:1px solid var(--bd, #2a2520); }
      .ht-h1 { font:600 22px/1.2 'Cinzel', Georgia, serif; color: var(--c-gold, #c4a062); margin:0; }
      .ht-sub { font-size:12px; color: var(--c-t2, #a8987a); margin-top:4px; }
      .ht-actions { display:flex; gap:8px; }
      .ht-btn { padding:8px 16px; border-radius:8px; border:1px solid rgba(196,160,98,.3); background:rgba(196,160,98,.06); color:var(--c-t1,#d4c08a); cursor:pointer; font:inherit; font-size:14px; text-decoration:none; display:inline-flex; align-items:center; gap:6px; }
      .ht-btn:hover { background:rgba(196,160,98,.16); border-color:rgba(196,160,98,.55); }
      .ht-btn--primary { background: linear-gradient(180deg, rgba(196,160,98,.25), rgba(196,160,98,.12)); border-color:rgba(196,160,98,.6); color:var(--c-gold,#c4a062); font-weight:600; }
      .ht-btn--primary:hover { background: linear-gradient(180deg, rgba(196,160,98,.4), rgba(196,160,98,.2)); }
      .ht-tabs { display:flex; gap:4px; border-bottom:1px solid var(--bd,#2a2520); margin:18px 0 0; }
      .ht-tab { background:none; border:none; border-bottom:2px solid transparent; padding:12px 18px; color:var(--c-t2,#a8987a); cursor:pointer; font:inherit; font-size:14px; display:inline-flex; align-items:center; gap:8px; }
      .ht-tab:hover { color: var(--c-t1, #d4c08a); }
      .ht-tab.active { color: var(--c-gold, #c4a062); border-bottom-color: var(--c-gold, #c4a062); font-weight:600; }
      .ht-tab-badge { background:rgba(196,160,98,.15); color:var(--c-gold,#c4a062); padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; }
      .ht-tab-badge.alert { background:#c04545; color:#fff; }
      .ht-toolbar { display:grid; grid-template-columns:1fr 200px; gap:12px; margin:18px 0 12px; }
      .ht-toolbar input, .ht-toolbar select { width:100%; padding:8px 12px; background:rgba(28,22,18,.6); border:1px solid var(--bd,#2a2520); border-radius:8px; color:var(--c-t0,#e8d8b0); font:inherit; }
      .ht-list { display:flex; flex-direction:column; gap:12px; }
      .ht-card { background: linear-gradient(180deg, rgba(40,32,24,.7), rgba(28,22,18,.85)); border:1px solid rgba(196,160,98,.12); border-radius:12px; padding:16px 18px; cursor:pointer; transition: transform .12s, border-color .14s, box-shadow .14s; }
      .ht-card:hover { transform: translateY(-1px); border-color: rgba(196,160,98,.35); box-shadow: 0 4px 16px rgba(0,0,0,.35); }
      .ht-card.urgent { border-color: rgba(192,69,69,.45); background: linear-gradient(180deg, rgba(56,28,28,.6), rgba(28,22,18,.9)); }
      .ht-card.overdue { border-color: rgba(192,69,69,.7); }
      .ht-card-head { display:flex; align-items:center; flex-wrap:wrap; gap:8px; font-size:12px; margin-bottom:8px; }
      .ht-chip { padding:3px 9px; border-radius:10px; font-weight:600; font-size:11px; }
      .ht-chip-prio-urgent { background: rgba(192,69,69,.15); color:#e08585; }
      .ht-chip-prio-high   { background: rgba(212,160,23,.15); color:#d4a017; }
      .ht-chip-prio-normal { background: rgba(139,111,71,.18); color:#b09567; }
      .ht-chip-st-new      { background: rgba(74,125,200,.15); color:#6a9fd4; }
      .ht-chip-st-accepted { background: rgba(74,125,58,.15); color:#6fb058; }
      .ht-chip-st-progress { background: rgba(212,160,23,.18); color:#d4a017; }
      .ht-chip-st-done     { background: rgba(74,125,58,.25); color:#8bc275; }
      .ht-chip-st-declined { background: rgba(192,69,69,.2); color:#e08585; }
      .ht-chip-st-overdue  { background: rgba(192,69,69,.25); color:#ff7575; font-weight:700; }
      .ht-deadline { margin-left:auto; color: var(--c-t2,#a8987a); font-size:12px; }
      .ht-deadline.hot { color:#d4a017; font-weight:600; }
      .ht-deadline.over { color:#e08585; font-weight:700; }
      .ht-title { font:600 18px/1.25 'Cinzel', Georgia, serif; color: var(--c-t0,#e8d8b0); margin:4px 0 6px; }
      .ht-desc { color: var(--c-t2,#a8987a); font-size:13px; line-height:1.5; margin:0 0 10px; }
      .ht-meta { display:flex; flex-wrap:wrap; gap:14px; color:var(--c-t2,#a8987a); font-size:12px; margin-bottom:10px; }
      .ht-meta b { color: var(--c-t1, #d4c08a); }
      .ht-declined-banner { background:rgba(192,69,69,.08); border:1px solid rgba(192,69,69,.25); padding:8px 12px; border-radius:8px; color:#d49595; font-size:13px; margin-bottom:10px; }
      .ht-card-actions { display:flex; flex-wrap:wrap; gap:6px; }
      .ht-act { padding:6px 14px; border-radius:8px; border:1px solid rgba(196,160,98,.25); background:rgba(196,160,98,.06); color:var(--c-t1,#d4c08a); cursor:pointer; font-size:13px; }
      .ht-act:hover { background:rgba(196,160,98,.14); }
      .ht-act.accept   { background:rgba(74,125,58,.18); border-color:rgba(74,125,58,.45); color:#8bc275; }
      .ht-act.complete { background:rgba(74,125,58,.25); border-color:rgba(74,125,58,.6); color:#95d080; }
      .ht-act.decline  { background:rgba(192,69,69,.15); border-color:rgba(192,69,69,.4); color:#e09595; }
      .ht-act.redirect { background:rgba(74,125,200,.12); border-color:rgba(74,125,200,.4); color:#80a8d8; }
      .ht-act.escalate { background:rgba(212,160,23,.14); border-color:rgba(212,160,23,.45); color:#e8c060; }
      .ht-act.chat     { background:rgba(160,120,196,.12); border-color:rgba(160,120,196,.35); color:#b89ad4; text-decoration:none; }
      .ht-empty { text-align:center; padding:48px 24px; color:var(--c-t2,#a8987a); }
      .ht-empty .ht-empty-icon { font-size:56px; opacity:.5; margin-bottom:12px; }
      .ht-empty h3 { font:600 18px/1.2 'Cinzel', Georgia, serif; color:var(--c-t1,#d4c08a); margin:0 0 8px; }
      /* Модалка создания */
      .ht-mod-field { margin-bottom:14px; }
      .ht-mod-field label { display:block; font-size:12px; color:var(--c-t2,#a8987a); margin-bottom:4px; font-weight:600; }
      .ht-mod-field label.required::after { content:' *'; color:#e08585; }
      .ht-mod-field input, .ht-mod-field textarea, .ht-mod-field select { width:100%; padding:8px 12px; background:rgba(28,22,18,.6); border:1px solid var(--bd,#2a2520); border-radius:8px; color:var(--c-t0,#e8d8b0); font:inherit; box-sizing:border-box; }
      .ht-mod-field textarea { min-height:80px; resize:vertical; }
      .ht-presets { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
      .ht-preset { background:rgba(196,160,98,.06); border:1px solid rgba(196,160,98,.2); color:var(--c-t1,#d4c08a); padding:4px 10px; border-radius:14px; cursor:pointer; font-size:12px; }
      .ht-preset:hover { background:rgba(196,160,98,.15); }
      .ht-prio-radio { display:flex; gap:6px; flex-wrap:wrap; }
      .ht-prio-radio label { display:inline-flex; align-items:center; padding:6px 14px; border:1px solid rgba(196,160,98,.2); border-radius:8px; cursor:pointer; font-size:13px; color:var(--c-t1,#d4c08a); }
      .ht-prio-radio input { display:none; }
      .ht-prio-radio label.active { background:rgba(196,160,98,.15); border-color:rgba(196,160,98,.55); font-weight:600; color:var(--c-gold,#c4a062); }
      .ht-explainer { background:rgba(74,125,200,.07); border-left:3px solid rgba(74,125,200,.45); padding:10px 14px; border-radius:6px; color:var(--c-t2,#a8987a); font-size:12px; line-height:1.5; }
      .ht-warn { background:rgba(212,160,23,.07); border-left:3px solid rgba(212,160,23,.55); padding:10px 14px; border-radius:6px; color:#e8c060; font-size:13px; margin-bottom:12px; }
    `;
    const tag = document.createElement('style');
    tag.id = 'help-tasks-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function timeLeft(deadline) {
    if (!deadline) return null;
    const diff = new Date(deadline) - new Date();
    if (diff < 0) {
      const past = Math.floor(-diff / 3600000);
      return { overdue: true, label: past < 24 ? `просрочено ${past}ч назад` : `просрочено ${Math.floor(past/24)}д назад` };
    }
    const h = Math.floor(diff / 3600000);
    if (h < 1)  return { hot: true, label: `${Math.max(1, Math.floor(diff/60000))} мин` };
    if (h < 24) return { hot: h < 4, label: `${h} ч` };
    return { label: `${Math.floor(h/24)} д` };
  }

  function fmtDateTime(v) {
    if (!v) return '';
    try { return new Date(v).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }); } catch { return ''; }
  }

  function renderCard(task) {
    const me = state.currentUser;
    const isMine = task.assignee_id === me?.id;
    const isCreator = task.creator_id === me?.id;
    const mode = state.tab;
    const tl = timeLeft(task.deadline);

    const showAccept   = mode === 'inbox' && isMine && task.status === 'new';
    const showDecline  = mode === 'inbox' && isMine && ['new','accepted','in_progress'].includes(task.status);
    const showRedirect = mode === 'inbox' && isMine && ['new','accepted','in_progress'].includes(task.status) && !task.redirected_once;
    const showComplete = mode === 'inbox' && isMine && ['accepted','in_progress'].includes(task.status);
    const showReassign = mode === 'outbox' && isCreator && task.status === 'declined';
    const showEscalate = mode === 'outbox' && isCreator && task.status === 'declined';

    const fromTo = mode === 'inbox'
      ? `📨 От: <b>${esc(task.creator_name)}</b> · ${esc(ROLE_LABELS[task.creator_role] || task.creator_role || '')}`
      : `👤 Исполнитель: <b>${esc(task.assignee_name)}</b> · ${esc(ROLE_LABELS[task.assignee_role] || task.assignee_role || '')}`;

    return `
      <article class="ht-card ${task.priority==='urgent'?'urgent':''} ${tl?.overdue?'overdue':''}" data-task-id="${task.id}">
        <div class="ht-card-head">
          <span class="ht-chip ht-chip-prio-${task.priority||'normal'}">${PRIORITY_LABELS[task.priority] || task.priority}</span>
          <span class="ht-chip ht-chip-st-${(task.status||'new').replace('in_progress','progress')}">${STATUS_LABELS[task.status]||task.status}</span>
          ${task.redirected_once?'<span class="ht-chip" style="background:rgba(196,160,98,.12);color:var(--c-t2,#a8987a)">↪️ перенаправлено</span>':''}
          ${tl ? `<span class="ht-deadline ${tl.overdue?'over':''} ${tl.hot?'hot':''}">${tl.overdue?'⏰':tl.hot?'🔥':'⏱'} ${esc(tl.label)}</span>`:''}
        </div>
        <h3 class="ht-title">${esc(task.title)}</h3>
        ${task.description?`<p class="ht-desc">${esc(String(task.description).slice(0,180))}${task.description.length>180?'…':''}</p>`:''}
        <div class="ht-meta">
          <span>${fromTo}</span>
          ${task.deadline?`<span>🗓 ${esc(fmtDateTime(task.deadline))}</span>`:''}
          ${Array.isArray(task.files)&&task.files.length?`<span>📎 ${task.files.length}</span>`:''}
          ${parseInt(task.watchers_count)>0?`<span>👁 +${task.watchers_count}</span>`:''}
          ${parseInt(task.messages_count)>0?`<span>💬 ${task.messages_count}</span>`:''}
        </div>
        ${task.declined_reason && task.status==='declined' ? `<div class="ht-declined-banner"><b>❌ Причина отказа:</b> ${esc(task.declined_reason)}</div>` : ''}
        <div class="ht-card-actions">
          ${showAccept   ? `<button class="ht-act accept"   data-act="accept"   data-id="${task.id}">✓ Принять</button>` : ''}
          ${showComplete ? `<button class="ht-act complete" data-act="complete" data-id="${task.id}">✅ Завершить</button>` : ''}
          ${showDecline  ? `<button class="ht-act decline"  data-act="decline"  data-id="${task.id}">❌ Отказать</button>` : ''}
          ${showRedirect ? `<button class="ht-act redirect" data-act="redirect" data-id="${task.id}">↪️ Перенаправить</button>` : ''}
          ${showReassign ? `<button class="ht-act accept"   data-act="reassign" data-id="${task.id}">🔄 Переназначить</button>` : ''}
          ${showEscalate ? `<button class="ht-act escalate" data-act="escalate" data-id="${task.id}">🛡 Эскалировать</button>` : ''}
          ${task.chat_id ? `<a class="ht-act chat" href="#/messenger?id=${task.chat_id}">💬 Чат</a>` : ''}
        </div>
      </article>
    `;
  }

  function renderList() {
    const list = state.tab === 'inbox' ? state.inbox : state.tab === 'outbox' ? state.outbox : state.watching;
    const q = state.q.trim().toLowerCase();
    const sf = state.statusFilter;
    let filtered = list.filter(t => {
      if (sf && t.status !== sf) return false;
      if (q) {
        const blob = `${t.title||''} ${t.description||''} ${t.creator_name||''} ${t.assignee_name||''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
    // sort: urgent first, then deadline asc
    const prio = { urgent:0, high:1, normal:2, low:3 };
    filtered.sort((a,b) => {
      const pa = prio[a.priority] ?? 2, pb = prio[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      const da = a.deadline ? +new Date(a.deadline) : Infinity;
      const db = b.deadline ? +new Date(b.deadline) : Infinity;
      return da - db;
    });

    if (state.loading) return '<div class="ht-empty">⏳ Загружаем задачи…</div>';
    if (!filtered.length) {
      const tab = state.tab;
      return `<div class="ht-empty">
        <div class="ht-empty-icon">${tab==='inbox'?'🤝':tab==='outbox'?'📤':'👁'}</div>
        <h3>${q||sf?'Ничего не нашли':tab==='inbox'?'Никто пока не просил помощи':tab==='outbox'?'Ты ещё ни о чём не просил':'Ты не наблюдаешь ни за одной задачей'}</h3>
        <div>${q||sf?'Сбрось фильтр':tab==='outbox'?'Нажми «+ Попросить помощи»':''}</div>
      </div>`;
    }
    return `<div class="ht-list">${filtered.map(renderCard).join('')}</div>`;
  }

  function renderHeader(container) {
    const counts = {
      inbox: state.inbox.length, outbox: state.outbox.length, watching: state.watching.length
    };
    const inboxNew = parseInt(state.stats.inbox_new || 0);
    const outDecl  = parseInt(state.stats.outbox_declined || 0);
    container.innerHTML = `
      <div class="ht-page">
        <div class="ht-head">
          <div>
            <h1 class="ht-h1">🤝 Помощь коллеги</h1>
            <div class="ht-sub">${inboxNew>0?`📥 ${inboxNew} новых · ${state.stats.inbox_active||0} в работе`:'Сильные плечо к плечу — слабые в одиночку'}</div>
          </div>
          <div class="ht-actions">
            <button class="ht-btn" id="ht-refresh">↻ Обновить</button>
            <button class="ht-btn ht-btn--primary" id="ht-create">+ Попросить помощи</button>
          </div>
        </div>

        <div class="ht-tabs">
          <button class="ht-tab ${state.tab==='inbox'?'active':''}" data-tab="inbox">📥 Входящие <span class="ht-tab-badge ${inboxNew>0?'alert':''}">${counts.inbox}</span></button>
          <button class="ht-tab ${state.tab==='outbox'?'active':''}" data-tab="outbox">📤 Отправленные <span class="ht-tab-badge ${outDecl>0?'alert':''}">${counts.outbox}</span></button>
          <button class="ht-tab ${state.tab==='watching'?'active':''}" data-tab="watching">👁 Наблюдаю <span class="ht-tab-badge">${counts.watching}</span></button>
        </div>

        <div class="ht-toolbar">
          <input type="text" id="ht-q" placeholder="Поиск по названию, описанию, имени…" value="${esc(state.q)}" />
          <select id="ht-status">
            <option value="">Все статусы</option>
            ${Object.entries(STATUS_LABELS).map(([k,v])=>`<option value="${k}" ${state.statusFilter===k?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>

        <div id="ht-list-wrap">${renderList()}</div>
      </div>
    `;
    bindEvents(container);
  }

  function bindEvents(container) {
    container.querySelector('#ht-refresh').onclick = () => refresh();
    container.querySelector('#ht-create').onclick = () => openCreateModal();
    container.querySelector('#ht-q').oninput = (e) => { state.q = e.target.value; rerenderList(container); };
    container.querySelector('#ht-status').onchange = (e) => { state.statusFilter = e.target.value; rerenderList(container); };
    $$('.ht-tab', container).forEach(t => { t.onclick = () => { state.tab = t.dataset.tab; state.q=''; state.statusFilter=''; renderHeader(container); }; });

    $$('[data-act]', container).forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const id = parseInt(b.dataset.id);
        const list = state.tab === 'inbox' ? state.inbox : state.tab === 'outbox' ? state.outbox : state.watching;
        const t = list.find(x => x.id === id);
        if (!t) return;
        const act = b.dataset.act;
        if (act === 'accept')   acceptAction(t, container);
        else if (act === 'complete') openCompleteModal(t, container);
        else if (act === 'decline')  openDeclineModal(t, container);
        else if (act === 'redirect') openRedirectModal(t, container);
        else if (act === 'reassign') openReassignModal(t, container);
        else if (act === 'escalate') openEscalateModal(t, container);
      };
    });

    $$('.ht-card', container).forEach(card => {
      card.onclick = () => {
        const id = parseInt(card.dataset.taskId);
        const list = state.tab === 'inbox' ? state.inbox : state.tab === 'outbox' ? state.outbox : state.watching;
        const t = list.find(x => x.id === id);
        if (t?.chat_id) window.location.hash = `#/messenger?id=${t.chat_id}`;
      };
    });
  }

  function rerenderList(container) {
    const wrap = container.querySelector('#ht-list-wrap');
    if (wrap) wrap.innerHTML = renderList();
    bindEvents(container);
  }

  // ── ДЕЙСТВИЯ ────────────────────────────────────────────────
  async function acceptAction(task, container) {
    try { await api('PUT', `/api/tasks/${task.id}/accept`); toast('Принято', 'ok'); await refresh(container); }
    catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  }

  function openDeclineModal(task, container) {
    const presets = [
      'Сильно загружен срочной работой',
      'Не моя зона ответственности — лучше к коллеге',
      'Не хватает информации для выполнения',
      'Сейчас в отпуске / на объекте'
    ];
    const html = `
      <div class="ht-mod-field">
        <label class="required">Причина отказа</label>
        <textarea id="ht-reason" rows="4" placeholder="Минимум 5 символов…"></textarea>
        <div class="ht-presets">${presets.map(p => `<button type="button" class="ht-preset" data-r="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      </div>
      <div class="ht-explainer">Создатель получит уведомление и сможет переназначить или эскалировать.</div>
    `;
    AsgardUI.showModal({
      title: '❌ Отказаться от задачи',
      html,
      wide: false,
      buttons: [
        { label: 'Назад', variant: 'ghost' },
        { label: 'Отправить отказ', variant: 'primary', handler: async (modal) => {
            const reason = modal.querySelector('#ht-reason').value.trim();
            if (reason.length < 5) { toast('Минимум 5 символов', 'err'); return false; }
            try { await api('PUT', `/api/tasks/${task.id}/decline`, { reason }); toast('Отказ отправлен', 'ok'); await refresh(container); }
            catch (e) { toast('Ошибка: ' + e.message, 'err'); return false; }
          }
        }
      ],
      onOpen: (modal) => {
        modal.querySelectorAll('.ht-preset').forEach(b => b.onclick = () => modal.querySelector('#ht-reason').value = b.dataset.r);
      }
    });
  }

  function openRedirectModal(task, container) {
    if (!state.users.length) { toast('Сначала подгружу список сотрудников…', 'info'); loadUsers().then(() => openRedirectModal(task, container)); return; }
    const me = state.currentUser?.id;
    const opts = state.users.filter(u => u.is_active !== false && u.id !== me && u.id !== task.creator_id)
      .map(u => `<option value="${u.id}">${esc(u.name||u.login)} (${esc(ROLE_LABELS[u.role]||u.role)})</option>`).join('');
    const html = `
      <div class="ht-warn">⚠️ Перенаправление возможно <b>только один раз</b>. Дальше — либо ты выполняешь, либо отказываешься.</div>
      <div class="ht-mod-field"><label class="required">Кому передать</label>
        <select id="ht-new-as"><option value="">— выберите —</option>${opts}</select>
      </div>
      <div class="ht-mod-field"><label class="required">Причина</label>
        <textarea id="ht-reason" rows="3" placeholder="Например: «Это его компетенция»"></textarea>
      </div>
      <div class="ht-explainer">Ты останешься <b>наблюдателем</b> — сможешь следить и помогать.</div>
    `;
    AsgardUI.showModal({
      title: '↪️ Перенаправить задачу',
      html,
      buttons: [
        { label: 'Назад', variant: 'ghost' },
        { label: '↪️ Перенаправить', variant: 'primary', handler: async (modal) => {
            const newId = parseInt(modal.querySelector('#ht-new-as').value);
            const reason = modal.querySelector('#ht-reason').value.trim();
            if (!newId) { toast('Выбери исполнителя', 'err'); return false; }
            if (reason.length < 5) { toast('Минимум 5 символов в причине', 'err'); return false; }
            try { await api('PUT', `/api/tasks/${task.id}/redirect`, { new_assignee_id: newId, reason }); toast('Перенаправлено', 'ok'); await refresh(container); }
            catch (e) { toast('Ошибка: ' + e.message, 'err'); return false; }
          }
        }
      ]
    });
  }

  function openReassignModal(task, container) {
    if (!state.users.length) { loadUsers().then(() => openReassignModal(task, container)); return; }
    const me = state.currentUser?.id;
    const opts = state.users.filter(u => u.is_active !== false && u.id !== me && u.id !== task.assignee_id)
      .map(u => `<option value="${u.id}">${esc(u.name||u.login)} (${esc(ROLE_LABELS[u.role]||u.role)})</option>`).join('');
    const html = `
      <div class="ht-warn">Предыдущий исполнитель отказался: <b>«${esc(task.declined_reason||'')}»</b></div>
      <div class="ht-mod-field"><label class="required">Новый исполнитель</label>
        <select id="ht-new-as"><option value="">— выберите —</option>${opts}</select>
      </div>
    `;
    AsgardUI.showModal({
      title: '🔄 Переназначить задачу',
      html,
      buttons: [
        { label: 'Назад', variant: 'ghost' },
        { label: '✓ Назначить', variant: 'primary', handler: async (modal) => {
            const newId = parseInt(modal.querySelector('#ht-new-as').value);
            if (!newId) { toast('Выбери исполнителя', 'err'); return false; }
            try { await api('PUT', `/api/tasks/${task.id}/reassign`, { new_assignee_id: newId }); toast('Переназначено', 'ok'); await refresh(container); }
            catch (e) { toast('Ошибка: ' + e.message, 'err'); return false; }
          }
        }
      ]
    });
  }

  function openEscalateModal(task, container) {
    AsgardUI.showModal({
      title: '🛡 Эскалировать руководителю',
      html: `<div class="ht-warn">Задача будет перенаправлена <b>руководителю отдела</b> прошлого исполнителя. Он получит уведомление с пометкой «эскалация».</div>`,
      buttons: [
        { label: 'Назад', variant: 'ghost' },
        { label: '🛡 Эскалировать', variant: 'primary', handler: async () => {
            try { const r = await api('PUT', `/api/tasks/${task.id}/escalate`); toast('Эскалировано: ' + (r.escalated_to?.name || ''), 'ok'); await refresh(container); }
            catch (e) { toast('Ошибка: ' + e.message, 'err'); return false; }
          }
        }
      ]
    });
  }

  function openCompleteModal(task, container) {
    AsgardUI.showModal({
      title: '✅ Завершить задачу',
      html: `
        <div class="ht-mod-field"><label>Комментарий о результате</label>
          <textarea id="ht-comment" rows="3" placeholder="Что сделано, где результат…"></textarea>
        </div>
        <div class="ht-explainer">После завершения чат <b>архивируется</b> (read-only).</div>`,
      buttons: [
        { label: 'Отмена', variant: 'ghost' },
        { label: '✅ Завершить', variant: 'primary', handler: async (modal) => {
            const comment = modal.querySelector('#ht-comment').value.trim() || null;
            try { await api('PUT', `/api/tasks/${task.id}/complete`, { comment }); toast('Завершено. Чат архивирован.', 'ok'); await refresh(container); }
            catch (e) { toast('Ошибка: ' + e.message, 'err'); return false; }
          }
        }
      ]
    });
  }

  function openCreateModal() {
    if (!state.users.length) { loadUsers().then(openCreateModal); toast('Подгружаю список…', 'info'); return; }
    const me = state.currentUser?.id;
    const usersOpts = state.users.filter(u => u.is_active !== false && u.id !== me)
      .map(u => `<option value="${u.id}">${esc(u.name||u.login)} (${esc(ROLE_LABELS[u.role]||u.role)})</option>`).join('');
    const html = `
      <div class="ht-mod-field"><label class="required">Кому отправить</label>
        <select id="ht-assignee"><option value="">— выберите коллегу —</option>${usersOpts}</select>
      </div>
      <div class="ht-mod-field"><label>Кто ещё поможет (наблюдатели, через Ctrl/Cmd-click)</label>
        <select id="ht-watchers" multiple style="min-height:120px"><option value="" disabled>— выберите —</option>${usersOpts}</select>
      </div>
      <div class="ht-mod-field"><label class="required">Кратко о задаче</label>
        <input type="text" id="ht-title" maxlength="255" placeholder="Найти ТЗ по объекту X / помочь со сметой…" />
      </div>
      <div class="ht-mod-field"><label>Подробности</label>
        <textarea id="ht-desc" rows="4" placeholder="Что нужно сделать, где искать, ссылки…"></textarea>
      </div>
      <div class="ht-mod-field"><label>Дедлайн</label>
        <input type="datetime-local" id="ht-dl" />
        <div class="ht-presets">
          <button type="button" class="ht-preset" data-h="2">🔥 2 часа</button>
          <button type="button" class="ht-preset" data-h="6">⏰ К концу дня</button>
          <button type="button" class="ht-preset" data-h="24">📅 Завтра</button>
          <button type="button" class="ht-preset" data-h="72">📆 3 дня</button>
        </div>
      </div>
      <div class="ht-mod-field"><label>Приоритет</label>
        <div class="ht-prio-radio">
          ${Object.entries(PRIORITY_LABELS).map(([k,v]) => `<label data-p="${k}"><input type="radio" name="prio" value="${k}" ${k==='normal'?'checked':''}/>${v}</label>`).join('')}
        </div>
      </div>
      <div class="ht-explainer">
        После отправки:<br/>• Создастся чат в Хугинне с участниками<br/>• Исполнитель получит уведомление<br/>• Сможешь общаться в чате до завершения задачи
      </div>
    `;
    AsgardUI.showModal({
      title: '🤝 Попросить помощи',
      html, wide: true,
      buttons: [
        { label: 'Отмена', variant: 'ghost' },
        { label: '🤝 Попросить помощи', variant: 'primary', handler: async (modal) => {
            const aid = parseInt(modal.querySelector('#ht-assignee').value);
            const title = modal.querySelector('#ht-title').value.trim();
            if (!aid) { toast('Выберите кому отправить', 'err'); return false; }
            if (title.length < 3) { toast('Слишком короткое название', 'err'); return false; }
            const watchers = Array.from(modal.querySelector('#ht-watchers').selectedOptions).map(o => parseInt(o.value)).filter(Boolean);
            const desc = modal.querySelector('#ht-desc').value.trim() || null;
            const dl = modal.querySelector('#ht-dl').value;
            const prio = modal.querySelector('input[name=prio]:checked')?.value || 'normal';
            try {
              await api('POST', '/api/tasks', {
                assignee_id: aid, title, description: desc,
                deadline: dl ? new Date(dl).toISOString() : null,
                priority: prio, task_kind: 'help',
                watcher_ids: watchers
              });
              toast('🤝 Помощь запрошена', 'ok');
              await refresh();
            } catch (e) { toast('Ошибка: ' + e.message, 'err'); return false; }
          }
        }
      ],
      onOpen: (modal) => {
        modal.querySelectorAll('.ht-prio-radio label').forEach(lbl => {
          lbl.onclick = () => { modal.querySelectorAll('.ht-prio-radio label').forEach(l => l.classList.remove('active')); lbl.classList.add('active'); };
          if (lbl.querySelector('input').checked) lbl.classList.add('active');
        });
        modal.querySelectorAll('.ht-preset[data-h]').forEach(b => {
          b.onclick = () => {
            const h = parseInt(b.dataset.h);
            const d = new Date(Date.now() + h * 3600000);
            const off = d.getTimezoneOffset();
            const local = new Date(d.getTime() - off * 60000);
            modal.querySelector('#ht-dl').value = local.toISOString().slice(0, 16);
          };
        });
      }
    });
  }

  function toast(msg, tone) {
    if (window.toast) {
      if (typeof window.toast === 'function') window.toast('', msg, tone === 'ok' ? 'success' : tone === 'err' ? 'error' : 'info');
      else if (window.toast[tone === 'ok' ? 'success' : tone === 'err' ? 'error' : 'info']) window.toast[tone === 'ok' ? 'success' : tone === 'err' ? 'error' : 'info'](msg);
      else window.toast.info?.(msg);
    } else console.log('[toast]', msg);
  }

  // ── Загрузка ───────────────────────────────────────────────
  async function loadUsers() {
    try {
      const r = await fetch('/api/users?is_active=true&limit=500', { headers: headers() });
      const d = await r.json();
      state.users = d.users || [];
    } catch (e) { state.users = []; }
  }

  async function loadAll() {
    state.loading = true;
    try {
      const [i, o, w, s] = await Promise.all([
        api('GET', '/api/tasks/help/inbox').then(r => r.tasks || []).catch(() => []),
        api('GET', '/api/tasks/help/outbox').then(r => r.tasks || []).catch(() => []),
        api('GET', '/api/tasks/help/watching').then(r => r.tasks || []).catch(() => []),
        api('GET', '/api/tasks/help/stats').catch(() => ({}))
      ]);
      state.inbox = i; state.outbox = o; state.watching = w; state.stats = s;
    } finally { state.loading = false; }
  }

  // ── Главный render() ───────────────────────────────────────
  async function render(container) {
    injectStyles();
    state.currentUser = window.AsgardAuth?.user || JSON.parse(localStorage.getItem('user') || 'null');
    container.innerHTML = '<div class="ht-page"><div class="ht-empty">⏳ Загружаем…</div></div>';
    // Параллельно — пользователи (для пикеров)
    loadUsers();
    await loadAll();
    renderHeader(container);
  }

  async function refresh(container) {
    await loadAll();
    if (!container) container = $('#help-tasks-page');
    if (container) renderHeader(container);
  }

  return { render, refresh };
})();
