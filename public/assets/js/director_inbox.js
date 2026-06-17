/**
 * ASGARD CRM — Корзина заявок директора (Vanilla desktop — Волна 4а)
 * См. PERSONAL_KANBAN_AND_INBOX_PIPELINE.md §4.1.
 *
 * Доступ: ADMIN / DIRECTOR_GEN / DIRECTOR_COMM / DIRECTOR_DEV / HEAD_PM.
 * Действия: фильтры (новые / в работе / архив), назначить РП, прочитать письмо,
 *           прямая заявка от директора (обязательно с указанием PM).
 */
window.AsgardDirectorInboxPage = (function () {
  const { $, $$, esc, toast, showModal, hideModal, emptyState, formatDateTime } = AsgardUI;

  const FILTERS = [
    { key: 'new',     label: 'Новые',    statuses: ['new', 'ai_processed', 'under_review'] },
    { key: 'working', label: 'В работе', statuses: ['assigned', 'accepted'] },
    { key: 'archive', label: 'Архив',    statuses: ['rejected', 'archived'] }
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
  let _items = [];
  let _pmList = null;

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
    const flt = FILTERS.find(f => f.key === _filterKey) || FILTERS[0];
    const all = [];
    for (const st of flt.statuses) {
      const r = await api(`/?status=${encodeURIComponent(st)}&limit=200&offset=0`);
      if (r.ok && r.data && r.data.items) {
        for (const it of r.data.items) all.push(it);
      }
    }
    all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    _items = all;
  }

  function htmlCard(it) {
    const color = COLOR_LABEL[it.ai_color] || { label: '—', cls: 'di-color-gray', icon: '⚪' };
    const conf = it.ai_confidence != null ? Math.round(parseFloat(it.ai_confidence) * 100) : null;
    const sk = SOURCE_KIND_LABEL[it.source_kind] || SOURCE_KIND_LABEL.unknown;
    const fromName = it.original_sender_name || it.source_name || '';
    const fromEmail = it.original_sender_email || it.source_email || '';
    const summary = (it.ai_summary || it.body_preview || '').toString();
    const assigned = it.assigned_pm_id ? `Назначен: PM #${it.assigned_pm_id}` : '';

    const canAssign = !it.assigned_pm_id;

    return `<div class="di-card" data-id="${it.id}">
      <div class="di-card-row">
        <div class="di-card-title" title="${esc(it.subject || '')}">${esc(it.subject || '(без темы)')}</div>
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
        ${it.email_id ? `<button class="btn ghost" data-act="email" data-id="${it.email_id}">📧 Письмо целиком</button>` : ''}
      </div>
    </div>`;
  }

  function renderPage() {
    const root = $('#di-root');
    if (!root) return;

    const filters = FILTERS.map(f => {
      return `<button class="di-filter ${f.key === _filterKey ? 'active' : ''}" data-filter="${f.key}">${esc(f.label)}</button>`;
    }).join('');

    let body;
    if (_items.length === 0) {
      const msg = _filterKey === 'new'
        ? { icon: '📭', title: 'Корзина чиста', desc: 'Новых заявок нет. Создайте «Прямую заявку» от себя.' }
        : { icon: '📦', title: 'Пусто', desc: 'В этом разделе пока нет заявок.' };
      body = `<div class="di-grid"></div>${emptyState(msg)}`;
    } else {
      body = `<div class="di-grid">${_items.map(htmlCard).join('')}</div>`;
    }

    root.innerHTML = `<div class="di-page">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div class="di-filters">${filters}</div>
        <div>
          <button class="btn primary" id="di-btn-direct">＋ Прямая заявка от меня</button>
          <button class="btn ghost" id="di-btn-refresh" title="Обновить">⟳</button>
        </div>
      </div>
      ${body}
    </div>`;

    _bindPage();
  }

  function _bindPage() {
    $$('.di-filter').forEach(b => {
      b.addEventListener('click', async () => {
        _filterKey = b.dataset.filter;
        await loadItems();
        renderPage();
      });
    });

    const refresh = $('#di-btn-refresh');
    if (refresh) refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      try { await loadItems(); renderPage(); toast('Готово', 'Обновлено', 'ok'); }
      finally { refresh.disabled = false; }
    });

    const direct = $('#di-btn-direct');
    if (direct) direct.addEventListener('click', openDirectFromDirectorModal);

    $$('button[data-act="assign"]').forEach(b => {
      b.addEventListener('click', () => openAssignPmModal(Number(b.dataset.id)));
    });
    $$('button[data-act="email"]').forEach(b => {
      b.addEventListener('click', () => {
        const emailId = Number(b.dataset.id);
        // Откроем письмо в новой вкладке — паттерн совместим с mailbox/my-mail
        location.hash = `#/mailbox?email=${emailId}`;
      });
    });
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

    await _layout(`<div id="di-root">${AsgardUI.skeleton('row', 4)}</div>`, {
      title: opts.title || 'Корзина заявок',
      motto: 'Все врата заявок здесь.'
    });

    try { await loadItems(); }
    catch (e) {
      $('#di-root').innerHTML = `<div class="pk-empty">Не удалось загрузить заявки: ${esc(e.message || String(e))}</div>`;
      return;
    }
    renderPage();
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
