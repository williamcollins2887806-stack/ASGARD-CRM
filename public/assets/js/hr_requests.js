/**
 * ASGARD CRM — Заявки персонала v2
 * Desktop page: window.AsgardHrRequestsPage, route #/hr-requests
 *
 * PM: создание/редактирование черновиков, отправка HR, добавление в бригаду
 * HR: split-screen подбор, назначение рабочих, утверждение
 *
 * API: /api/staff-requests/*
 * Доступ: ADMIN, HR, HR_MANAGER, PM, HEAD_PM, DIRECTOR_GEN
 */
window.AsgardHrRequestsPage = (function () {
  'use strict';

  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;
  const isDirRole = (r) =>
    (window.AsgardAuth && AsgardAuth.isDirectorRole)
      ? AsgardAuth.isDirectorRole(r)
      : (String(r || '').startsWith('DIRECTOR_'));

  const ROLES_PM = ['PM', 'HEAD_PM'];
  const ROLES_HR = ['ADMIN', 'HR', 'HR_MANAGER'];

  const STATUS_V2 = {
    draft:        { label: 'Черновик',        bg: 'var(--bg4)',    color: 'var(--t2)' },
    new:          { label: 'Ожидает HR',      bg: 'var(--info-bg)',color: 'var(--info-t)' },
    in_progress:  { label: 'В работе HR',     bg: 'var(--warn-bg)',color: 'var(--warn-t)' },
    sent_to_pm:   { label: 'На согласовании', bg: 'var(--gold-bg)',color: 'var(--gold)' },
    approved:     { label: 'Утверждена',      bg: 'var(--ok-bg)', color: 'var(--ok-t)' },
    added_to_crew:{ label: 'В бригаде',       bg: 'var(--ok-bg)', color: 'var(--ok-t)' },
    rework:       { label: 'На доработке',    bg: 'var(--err-bg)',color: 'var(--err-t)' },
    cancelled:    { label: 'Отменена',        bg: 'var(--bg3)',   color: 'var(--t3)' },
    // Legacy statuses
    sent:         { label: 'Отправлен',       bg: 'var(--info-bg)',color: 'var(--info-t)' },
    answered:     { label: 'Ответ HR',        bg: 'var(--warn-bg)',color: 'var(--warn-t)' },
  };

  const POSITION_ROLES = [
    { key: 'master',    label: 'Мастера' },
    { key: 'fitter',    label: 'Слесари' },
    { key: 'welder',    label: 'Сварщики' },
    { key: 'pto',       label: 'ПТО' },
    { key: 'chemist',   label: 'Химики' },
    { key: 'insulator', label: 'Изолировщики' },
    { key: 'assembler', label: 'Монтажники' },
    { key: 'laborer',   label: 'Разнорабочие' },
  ];

  const fmt = (n) => n == null ? '—' : new Intl.NumberFormat('ru-RU').format(Math.round(n));

  function parseQuery() {
    const h = (location.hash || '').replace(/^#/, '');
    const [, qs] = h.split('?');
    const q = {};
    if (qs) qs.split('&').forEach(kv => {
      const [k, v] = kv.split('=');
      q[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return q;
  }

  async function apiFetch(url, token) {
    const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || 'HTTP ' + resp.status);
    }
    return resp.json();
  }

  async function apiPost(url, body, token) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || 'HTTP ' + resp.status);
    }
    return resp.json();
  }

  async function apiPut(url, body, token) {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || 'HTTP ' + resp.status);
    }
    return resp.json();
  }

  async function apiDelete(url, token) {
    const resp = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || 'HTTP ' + resp.status);
    }
    return resp.json();
  }

  // ─── Main render ────────────────────────────────────────────────────────────

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user, token = auth.token;

    const isPM = ROLES_PM.includes(user.role);
    const isHR = ROLES_HR.includes(user.role) || isDirRole(user.role);
    if (!isPM && !isHR) {
      toast('Доступ', 'Недостаточно прав', 'err');
      location.hash = '#/home';
      return;
    }

    const query = parseQuery();

    // If ?create=1&work_id=X → open create form
    if (query.create === '1' && query.work_id && isPM) {
      await renderCreateForm(layout, title, user, token, Number(query.work_id));
      return;
    }

    // If ?work_id=X → filter by work
    const filterWorkId = query.work_id ? Number(query.work_id) : null;

    const html = `
      <div class="panel">
        <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div>
            <div style="font-size:16px;font-weight:600;color:var(--t1)">Заявки персонала</div>
            <div class="help">${isPM ? 'Ваши заявки на рабочих' : 'Входящие заявки от РП'}</div>
          </div>
          <div style="display:flex;gap:8px">
            ${isPM ? '<button class="btn primary" id="sr_create">📨 Запросить рабочих</button>' : ''}
            <button class="btn ghost" id="sr_refresh">🔄</button>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <div id="sr_status_filter" style="min-width:180px"></div>
          <input id="sr_search" class="input" placeholder="Поиск по объекту..." style="max-width:250px"/>
        </div>

        <div class="tablewrap">
          <table class="asg">
            <thead><tr>
              <th>#</th><th>Объект / Заказчик</th><th>РП</th><th>Состав</th><th>Статус</th><th>Дата</th><th></th>
            </tr></thead>
            <tbody id="sr_body"></tbody>
          </table>
        </div>
      </div>
    `;
    await layout(html, { title: title || 'Заявки персонала' });

    // Status filter
    const statusOpts = [{ value: '', label: 'Все статусы' }];
    if (isPM) {
      statusOpts.push(
        { value: 'draft', label: 'Черновики' },
        { value: 'new', label: 'Ожидает HR' },
        { value: 'in_progress', label: 'В работе HR' },
        { value: 'sent_to_pm', label: 'На согласовании' },
        { value: 'approved', label: 'Утверждена' },
        { value: 'added_to_crew', label: 'В бригаде' },
        { value: 'rework', label: 'На доработке' }
      );
    } else {
      statusOpts.push(
        { value: 'new', label: 'Ожидает HR' },
        { value: 'in_progress', label: 'В работе' },
        { value: 'sent_to_pm', label: 'На согласовании' },
        { value: 'approved', label: 'Утверждена' },
        { value: 'added_to_crew', label: 'В бригаде' }
      );
    }

    let filterStatus = '';
    if (window.CRSelect) {
      $('#sr_status_filter').appendChild(CRSelect.create({
        id: 'sr_status', options: statusOpts, value: '',
        onChange: () => { filterStatus = CRSelect.getValue('sr_status') || ''; loadList(); }
      }));
    }

    async function loadList() {
      try {
        const endpoint = isPM ? '/api/staff-requests/my' : '/api/staff-requests/pending';
        let list = await apiFetch(endpoint, token);
        if (!Array.isArray(list)) list = list.requests || list.data || [];

        const searchQ = ($('#sr_search')?.value || '').toLowerCase().trim();

        // Filter
        if (filterStatus) list = list.filter(r => (r.status_v2 || r.status) === filterStatus);
        if (filterWorkId) list = list.filter(r => r.work_id === filterWorkId);
        if (searchQ) list = list.filter(r => {
          const hay = `${r.work_title || ''} ${r.customer_name || ''} ${r.pm_name || ''}`.toLowerCase();
          return hay.includes(searchQ);
        });

        // Sort by date desc
        list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

        const tbody = $('#sr_body');
        if (!list.length) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:20px">Нет заявок</td></tr>';
          return;
        }

        tbody.innerHTML = list.map(r => {
          const st = STATUS_V2[r.status_v2 || r.status] || STATUS_V2.new;
          const positions = (r.positions || []).map(p => `${p.role_label}: ${p.filled_count || 0}/${p.required_count}`).join(', ') || '—';
          return `<tr data-id="${r.id}">
            <td><b>#${r.id}</b></td>
            <td>
              <div style="font-weight:600">${esc(r.work_title || '—')}</div>
              <div style="font-size:11px;color:var(--t3)">${esc(r.customer_name || '')}</div>
            </td>
            <td>${esc(r.pm_name || '—')}</td>
            <td style="font-size:12px">${esc(positions)}</td>
            <td><span style="padding:3px 8px;border-radius:var(--r-sm);background:${st.bg};color:${st.color};font-size:12px;font-weight:600">${st.label}</span></td>
            <td style="font-size:12px;color:var(--t3)">${r.created_at ? new Date(r.created_at).toLocaleDateString('ru-RU') : '—'}</td>
            <td><button class="btn mini ghost" data-open="${r.id}">Открыть</button></td>
          </tr>`;
        }).join('');

        // Open handlers
        tbody.querySelectorAll('[data-open]').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = Number(btn.dataset.open);
            if (isPM) openPmView(id, user, token);
            else openHrView(id, user, token);
          });
        });
      } catch (e) {
        toast('Ошибка', 'Не удалось загрузить заявки', 'err');
      }
    }

    if ($('#sr_create')) {
      $('#sr_create').addEventListener('click', () => {
        location.hash = '#/hr-requests?create=1';
      });
    }
    $('#sr_refresh').addEventListener('click', loadList);
    let _searchTimer = null;
    $('#sr_search').addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(loadList, 300);
    });

    loadList();
  }

  // ─── PM: Create/Edit Draft Form ──────────────────────────────────────────────

  async function renderCreateForm(layout, title, user, token, workId) {
    // Check if draft exists for this work
    let existingDraft = null;
    if (workId) {
      try {
        const myReqs = await apiFetch('/api/staff-requests/my', token);
        const list = Array.isArray(myReqs) ? myReqs : (myReqs.requests || []);
        existingDraft = list.find(r => r.work_id === workId && (r.status_v2 || r.status) === 'draft');
      } catch (e) { /* ignore */ }
    }

    // Load works for select
    let works = [];
    try {
      const resp = await fetch('/api/works?my=1', { headers: { 'Authorization': 'Bearer ' + token } });
      if (resp.ok) {
        const data = await resp.json();
        works = Array.isArray(data) ? data : (data.works || data.data || []);
      }
    } catch (e) { /* ignore */ }

    const draft = existingDraft || {};
    const positions = draft.positions || [];
    const conditions = draft.work_conditions || {};

    const positionValues = {};
    POSITION_ROLES.forEach(pr => {
      const pos = positions.find(p => p.role_key === pr.key);
      positionValues[pr.key] = pos ? pos.required_count : 0;
    });

    const html = `
      <div class="panel" style="max-width:800px">
        ${existingDraft ? '<div style="padding:8px 12px;background:var(--info-bg);color:var(--info-t);border-radius:var(--r-sm);margin-bottom:12px;font-size:13px">Продолжаете незаконченную заявку (черновик #' + existingDraft.id + ')</div>' : ''}
        <div class="formrow">
          <div style="grid-column:1/-1">
            <label>Объект</label>
            <select id="df_work">
              <option value="">Выберите объект...</option>
              ${works.map(w => `<option value="${w.id}"${w.id === workId ? ' selected' : ''}>${esc(w.work_title || '')} — ${esc(w.customer_name || '')}</option>`).join('')}
            </select>
          </div>
          <div><label>Дата начала</label><input id="df_date_from" type="date" value="${esc(draft.date_from || '')}"/></div>
          <div><label>Дата окончания</label><input id="df_date_to" type="date" value="${esc(draft.date_to || '')}"/></div>
        </div>

        <div style="margin:12px 0 8px;font-weight:600;color:var(--t1)">Требуемый состав</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
          ${POSITION_ROLES.map(pr => `
            <div>
              <label style="font-size:12px">${pr.label}</label>
              <input id="df_pos_${pr.key}" type="number" min="0" value="${positionValues[pr.key]}"/>
            </div>
          `).join('')}
        </div>

        <div style="margin:12px 0 8px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-weight:600;color:var(--t1)">Требуемые допуска по должностям</span>
          <a href="#/permits" style="font-size:12px;color:var(--info-t);text-decoration:none">Открыть на странице «Допуски → Проекты» ↗</a>
        </div>
        <div id="df_permits_block" style="border:1px solid var(--brd);border-radius:var(--r-sm);padding:10px;margin-bottom:12px">
          <div class="help">Выберите объект, чтобы задать требуемые допуска.</div>
        </div>

        <div class="formrow">
          <div style="grid-column:1/-1">
            <label>Описание работ</label>
            <textarea id="df_desc" rows="3">${esc(draft.work_description || '')}</textarea>
          </div>
        </div>

        <div style="margin:12px 0 8px;font-weight:600;color:var(--t1)">Условия</div>
        <div class="formrow">
          <div>
            <label>Питание</label>
            <select id="df_food">
              <option value="ration"${conditions.food === 'ration' ? ' selected' : ''}>Сухпаёк</option>
              <option value="canteen"${conditions.food === 'canteen' ? ' selected' : ''}>Столовая</option>
              <option value="self"${conditions.food === 'self' ? ' selected' : ''}>Самостоятельно</option>
            </select>
          </div>
          <div>
            <label>Жильё</label>
            <select id="df_housing">
              <option value="wagon"${conditions.housing === 'wagon' ? ' selected' : ''}>Вагон-дом</option>
              <option value="hotel"${conditions.housing === 'hotel' ? ' selected' : ''}>Гостиница</option>
              <option value="dormitory"${conditions.housing === 'dormitory' ? ' selected' : ''}>Общежитие</option>
            </select>
          </div>
          <div>
            <label>Вахта (ротация)</label>
            <input id="df_rotation" placeholder="45/15" value="${esc(conditions.rotation || '')}"/>
          </div>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn ghost" id="df_cancel">✕ Отмена</button>
          <button class="btn" id="df_save_draft">💾 Сохранить черновик</button>
          <button class="btn primary" id="df_submit">📨 Отправить HR</button>
        </div>
      </div>
    `;
    await layout(html, { title: 'Новая заявка на рабочих' });

    // ── Блок «Требуемые допуска по должностям» (пишет в work_permit_requirements) ──
    let permitTypesCache = null;
    async function getPermitTypes() {
      if (permitTypesCache) return permitTypesCache;
      try {
        const r = await apiFetch('/api/permits/types', token);
        permitTypesCache = r.types || r || [];
      } catch (e) { permitTypesCache = []; }
      return permitTypesCache;
    }

    let missingRolesHighlight = [];
    async function renderPermitsBlock(wId) {
      const box = $('#df_permits_block');
      if (!box) return;
      if (!wId) { box.innerHTML = '<div class="help">Выберите объект, чтобы задать требуемые допуска.</div>'; return; }
      box.innerHTML = '<div class="help">Загрузка…</div>';
      const [types, reqResp] = await Promise.all([
        getPermitTypes(),
        apiFetch(`/api/permits/work/${wId}/requirements`, token).catch(() => ({ requirements: [] }))
      ]);
      const requirements = reqResp.requirements || [];
      // активные должности из формы (required_count>0)
      const activeRoles = POSITION_ROLES
        .filter(pr => (Number($(`#df_pos_${pr.key}`)?.value) || 0) > 0);
      const reqByRole = {};
      requirements.forEach(r => { const k = r.role_key || ''; (reqByRole[k] = reqByRole[k] || []).push(r); });

      const typeOptions = types.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');

      const rolesToShow = activeRoles.length ? activeRoles : [];
      let inner = '';
      if (!rolesToShow.length) {
        inner = '<div class="help">Укажите состав (количество по должностям) выше — затем задайте допуска для каждой должности.</div>';
      }
      // блок «для всех должностей» + по каждой активной должности
      const blocks = [{ key: '', label: 'Для всех должностей' }].concat(rolesToShow.map(r => ({ key: r.key, label: r.label })));
      inner += blocks.map(b => {
        const list = reqByRole[b.key] || [];
        const marker = list.find(r => r.no_permits_required);
        const perms = list.filter(r => !r.no_permits_required && r.permit_type_id);
        const isMissing = missingRolesHighlight.includes(b.key);
        return `
          <div style="margin-bottom:10px;${isMissing ? 'border:1px solid var(--danger-t);border-radius:var(--r-sm);padding:6px' : ''}">
            <div style="font-weight:600;color:var(--t1);font-size:13px;margin-bottom:4px">
              ${esc(b.label)} ${isMissing ? '<span style="color:var(--danger-t);font-size:11px">— требуется заполнение</span>' : ''}
            </div>
            ${marker ? '<div class="help">Допуска не требуются</div>'
              : (perms.length
                  ? perms.map(r => `<span class="chip" style="display:inline-flex;align-items:center;gap:4px;margin:2px;padding:2px 6px;background:var(--bg2);border-radius:10px;font-size:12px">${esc(r.type_name)} <button data-del="${r.id}" style="border:none;background:none;cursor:pointer;color:var(--danger-t)">✕</button></span>`).join('')
                  : '<span class="help">—</span>')}
            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
              <select data-typesel="${b.key}" style="font-size:12px;min-width:160px"><option value="">+ тип допуска…</option>${typeOptions}</select>
              <button class="btn mini" data-addreq="${b.key}">Добавить</button>
              ${marker ? `<button class="btn mini ghost" data-delmarker="${marker.id}">Отменить «не требуются»</button>`
                       : `<button class="btn mini ghost" data-noreq="${b.key}">Не требуются</button>`}
            </div>
          </div>`;
      }).join('');
      box.innerHTML = inner;

      // bind
      box.querySelectorAll('[data-addreq]').forEach(btn => btn.addEventListener('click', async () => {
        const rk = btn.getAttribute('data-addreq');
        const sel = box.querySelector(`[data-typesel="${rk}"]`);
        const typeId = sel && sel.value;
        if (!typeId) { toast('Допуска', 'Выберите тип', 'err'); return; }
        try {
          await apiPost(`/api/permits/work/${wId}/requirements`, { permit_type_id: Number(typeId), role_key: rk || null, is_mandatory: true }, token);
          await renderPermitsBlock(wId);
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      }));
      box.querySelectorAll('[data-noreq]').forEach(btn => btn.addEventListener('click', async () => {
        const rk = btn.getAttribute('data-noreq');
        try {
          await apiPost(`/api/permits/work/${wId}/requirements`, { no_permits_required: true, role_key: rk || null }, token);
          await renderPermitsBlock(wId);
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      }));
      box.querySelectorAll('[data-del],[data-delmarker]').forEach(btn => btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-del') || btn.getAttribute('data-delmarker');
        try {
          await apiDelete(`/api/permits/work/${wId}/requirements/${id}`, token);
          await renderPermitsBlock(wId);
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      }));
    }

    // initial + on work / состав change
    renderPermitsBlock(Number($('#df_work').value) || null);
    $('#df_work').addEventListener('change', () => { missingRolesHighlight = []; renderPermitsBlock(Number($('#df_work').value) || null); });
    POSITION_ROLES.forEach(pr => {
      const el = $(`#df_pos_${pr.key}`);
      if (el) el.addEventListener('change', () => renderPermitsBlock(Number($('#df_work').value) || null));
    });

    function collectFormData() {
      const positionsArr = POSITION_ROLES
        .map(pr => ({ role_key: pr.key, role_label: pr.label, required_count: Math.max(0, Number($(`#df_pos_${pr.key}`).value) || 0) }))
        .filter(p => p.required_count > 0);

      return {
        work_id: Number($('#df_work').value) || null,
        date_from: $('#df_date_from').value || null,
        date_to: $('#df_date_to').value || null,
        work_description: ($('#df_desc').value || '').trim(),
        work_conditions: {
          food: $('#df_food').value,
          housing: $('#df_housing').value,
          rotation: ($('#df_rotation').value || '').trim()
        },
        positions: positionsArr
      };
    }

    function validate(data, requirePositions) {
      if (!data.work_id) { toast('Проверка', 'Выберите объект', 'err'); return false; }
      if (requirePositions && (!data.positions || !data.positions.length)) {
        toast('Проверка', 'Укажите хотя бы одну позицию', 'err'); return false;
      }
      return true;
    }

    $('#df_cancel').addEventListener('click', () => { location.hash = '#/hr-requests'; });

    $('#df_save_draft').addEventListener('click', async () => {
      const data = collectFormData();
      if (!validate(data, false)) return;
      try {
        if (existingDraft) {
          await apiPut(`/api/staff-requests/${existingDraft.id}/draft`, data, token);
          toast('Черновик', 'Сохранён', 'ok');
        } else {
          const result = await apiPost('/api/staff-requests', data, token);
          existingDraft = result;
          toast('Черновик', 'Создан', 'ok');
        }
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    });

    $('#df_submit').addEventListener('click', async () => {
      const data = collectFormData();
      if (!validate(data, true)) return;
      try {
        let reqId;
        if (existingDraft) {
          await apiPut(`/api/staff-requests/${existingDraft.id}/draft`, data, token);
          reqId = existingDraft.id;
        } else {
          const result = await apiPost('/api/staff-requests', data, token);
          existingDraft = result.request || result;
          reqId = (result.request && result.request.id) || result.id;
        }
        // Submit с разбором 409 (не заданы допуска)
        const resp = await fetch(`/api/staff-requests/${reqId}/submit`, {
          method: 'PUT', headers: { 'Authorization': 'Bearer ' + token }
        });
        if (resp.status === 409) {
          const err = await resp.json().catch(() => ({}));
          missingRolesHighlight = err.missing_roles || [];
          await renderPermitsBlock(Number($('#df_work').value) || null);
          toast('Требуется заполнение', err.error || 'Не заданы требуемые допуска для должностей', 'err');
          return;
        }
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || 'HTTP ' + resp.status);
        }
        toast('Заявка', 'Отправлена HR', 'ok');
        location.hash = '#/hr-requests';
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    });
  }

  // ─── PM: View request detail ────────────────────────────────────────────────

  async function openPmView(id, user, token) {
    try {
      const req = await apiFetch(`/api/staff-requests/${id}`, token);
      const st = STATUS_V2[req.status_v2 || req.status] || STATUS_V2.new;
      const positions = req.positions || [];
      const assignments = req.assignments || [];

      const posHtml = positions.map(p => {
        const pct = p.required_count > 0 ? Math.round((p.filled_count || 0) / p.required_count * 100) : 0;
        return `<div style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--t1)">
            <span>${esc(p.role_label)}</span>
            <span>${p.filled_count || 0} / ${p.required_count}</span>
          </div>
          <div style="background:var(--bg3);border-radius:var(--r-sm);height:6px;overflow:hidden;margin-top:4px">
            <div style="background:${pct >= 100 ? 'var(--ok)' : 'var(--warn)'};height:100%;width:${Math.min(100, pct)}%"></div>
          </div>
        </div>`;
      }).join('');

      const assignHtml = assignments.length ? assignments.map(a => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:var(--bg2);border-radius:var(--r-sm);margin-bottom:4px">
          <div>
            <b>${esc(a.fio || a.employee_name || '—')}</b>
            <span style="font-size:11px;color:var(--t3);margin-left:8px">${esc(a.assigned_role || '')}</span>
            ${a.role_mismatch ? '<span style="color:var(--warn-t);font-size:11px"> ⚠️ роль не совпадает</span>' : ''}
          </div>
          <span style="padding:2px 6px;border-radius:var(--r-sm);background:var(--ok-bg);color:var(--ok-t);font-size:11px">${esc(a.status || '')}</span>
        </div>
      `).join('') : '<div style="color:var(--t3);padding:8px">Нет назначенных рабочих</div>';

      const body = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div>
            <div style="font-size:16px;font-weight:600;color:var(--t1)">${esc(req.work_title || '—')}</div>
            <div style="font-size:13px;color:var(--t3)">${esc(req.customer_name || '')}</div>
          </div>
          <span style="padding:4px 12px;border-radius:var(--r-sm);background:${st.bg};color:${st.color};font-weight:600">${st.label}</span>
        </div>

        <div style="margin-bottom:16px">${posHtml || '<div style="color:var(--t3)">Нет позиций</div>'}</div>

        <div style="font-weight:600;color:var(--t1);margin-bottom:8px">Назначенные рабочие</div>
        ${assignHtml}

        ${req.hr_comment ? `<div style="margin-top:12px;padding:8px;background:var(--info-bg);border-radius:var(--r-sm);color:var(--info-t);font-size:13px">Комментарий HR: ${esc(req.hr_comment)}</div>` : ''}

        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          ${(req.status_v2 === 'draft' || req.status_v2 === 'rework') ? `<button class="btn" id="pm_edit_draft">✏️ Редактировать</button>` : ''}
          ${req.status_v2 === 'approved' ? `<button class="btn primary" id="pm_add_crew">Добавить в бригаду</button>` : ''}
          <button class="btn ghost" id="pm_close">Закрыть</button>
        </div>
      `;
      showModal(`Заявка #${id}`, body);

      if ($('#pm_close')) $('#pm_close').addEventListener('click', closeModal);
      if ($('#pm_edit_draft')) {
        $('#pm_edit_draft').addEventListener('click', () => {
          closeModal();
          location.hash = `#/hr-requests?create=1&work_id=${req.work_id}`;
        });
      }
      if ($('#pm_add_crew')) {
        $('#pm_add_crew').addEventListener('click', async () => {
          if (!await AsgardUI.confirm('Добавить утверждённых рабочих в бригаду?')) return;
          try {
            await apiPut(`/api/staff-requests/${id}/add-to-crew`, null, token);
            toast('Готово', 'Рабочие добавлены в бригаду', 'ok');
            closeModal();
          } catch (e) { toast('Ошибка', e.message, 'err'); }
        });
      }
    } catch (e) {
      toast('Ошибка', 'Не удалось загрузить заявку', 'err');
    }
  }

  // ─── HR: Split-screen view ──────────────────────────────────────────────────

  async function openHrView(id, user, token) {
    try {
      const req = await apiFetch(`/api/staff-requests/${id}`, token);
      const st = STATUS_V2[req.status_v2 || req.status] || STATUS_V2.new;
      const positions = req.positions || [];

      // Check if need to take first
      if (req.status_v2 === 'new') {
        try {
          await apiPut(`/api/staff-requests/${id}/take`, null, token);
          req.status_v2 = 'in_progress';
          req.hr_user_id = user.id;
        } catch (e) {
          if (e.message.includes('уже в работе') || e.message.includes('Conflict')) {
            toast('Заявка', e.message, 'warn');
          } else {
            throw e;
          }
        }
      }

      // Build split-screen modal
      const body = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;min-height:400px;max-height:70vh;overflow:hidden">
          <!-- Left: Request details -->
          <div style="overflow-y:auto;padding-right:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <div>
                <div style="font-size:15px;font-weight:600;color:var(--t1)">${esc(req.work_title || '—')}</div>
                <div style="font-size:12px;color:var(--t3)">${esc(req.customer_name || '')} · РП: ${esc(req.pm_name || '—')}</div>
              </div>
              <span style="padding:3px 8px;border-radius:var(--r-sm);background:${st.bg};color:${st.color};font-size:12px;font-weight:600">${st.label}</span>
            </div>

            ${req.work_description ? `<div style="padding:8px;background:var(--bg2);border-radius:var(--r-sm);margin-bottom:12px;font-size:13px;color:var(--t2)">${esc(req.work_description)}</div>` : ''}

            <div style="font-weight:600;color:var(--t1);margin-bottom:8px">Прогресс по позициям</div>
            <div id="hr_positions">${renderPositions(positions)}</div>

            <div style="font-weight:600;color:var(--t1);margin:12px 0 8px">Добавленные рабочие</div>
            <div id="hr_assigned"></div>
          </div>

          <!-- Right: Available workers -->
          <div style="overflow-y:auto;border-left:1px solid var(--brd);padding-left:16px">
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <input id="hr_worker_search" class="input" placeholder="Поиск по ФИО..." style="flex:1"/>
              <select id="hr_role_filter" style="min-width:140px">
                <option value="">Все роли</option>
                ${positions.map(p => `<option value="${p.role_key}">${esc(p.role_label)}</option>`).join('')}
              </select>
            </div>
            <div id="hr_workers" style="font-size:13px"></div>
          </div>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;border-top:1px solid var(--brd);padding-top:12px">
          <button class="btn ghost" id="hr_save_exit">💾 Сохранить и выйти</button>
          <button class="btn" id="hr_send_pm">📤 Отправить РП</button>
          <button class="btn primary" id="hr_approve">✅ Утвердить</button>
          <button class="btn ghost" id="hr_rework" style="color:var(--warn-t)">🔄 Вернуть</button>
        </div>
      `;
      showModal(`Заявка #${id} — Подбор`, `<div style="min-width:800px">${body}</div>`);

      // Load assigned and available workers
      await loadAssigned(id, token);
      await loadAvailableWorkers(id, token, positions);

      // Search and filter
      $('#hr_worker_search').addEventListener('input', () => loadAvailableWorkers(id, token, positions));
      $('#hr_role_filter').addEventListener('change', () => loadAvailableWorkers(id, token, positions));

      // Bottom buttons
      $('#hr_save_exit').addEventListener('click', () => { closeModal(); });

      $('#hr_send_pm').addEventListener('click', async () => {
        try {
          await apiPut(`/api/staff-requests/${id}/send-to-pm`, null, token);
          toast('Готово', 'Отправлено РП', 'ok');
          closeModal();
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      });

      $('#hr_approve').addEventListener('click', async () => {
        if (!await AsgardUI.confirm('Утвердить заявку?')) return;
        try {
          await apiPut(`/api/staff-requests/${id}/approve`, null, token);
          toast('Готово', 'Заявка утверждена', 'ok');
          closeModal();
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      });

      $('#hr_rework').addEventListener('click', () => {
        showModal('Вернуть на доработку', `
          <div style="margin-bottom:12px">
            <label style="font-size:13px;color:var(--t2)">Комментарий <span style="color:var(--err)">*</span></label>
            <textarea id="rw_comment" rows="3" placeholder="Укажите причину возврата…" style="margin-top:4px"></textarea>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn ghost" id="rw_cancel">Отмена</button>
            <button class="btn" id="rw_send">Вернуть</button>
          </div>
        `);
        $('#rw_cancel')?.addEventListener('click', () => closeModal());
        $('#rw_send')?.addEventListener('click', async () => {
          const comment = ($('#rw_comment')?.value || '').trim();
          if (!comment) { toast('Проверка', 'Комментарий обязателен', 'err'); return; }
          const btn = $('#rw_send');
          btn.disabled = true; btn.textContent = 'Отправка…';
          try {
            await apiPut(`/api/staff-requests/${id}/rework`, { comment }, token);
            toast('Готово', 'Возвращено на доработку', 'ok');
            closeModal();
          } catch (e) {
            toast('Ошибка', e.message, 'err');
            btn.disabled = false; btn.textContent = 'Вернуть';
          }
        });
      });

    } catch (e) {
      toast('Ошибка', 'Не удалось загрузить заявку: ' + e.message, 'err');
    }
  }

  function renderPositions(positions) {
    return positions.map(p => {
      const pct = p.required_count > 0 ? Math.round((p.filled_count || 0) / p.required_count * 100) : 0;
      const isFull = pct >= 100;
      return `<div style="margin-bottom:8px${isFull ? ';opacity:.6' : ''}">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--t1)">
          <span>${esc(p.role_label)}${isFull ? ' ✅' : ''}</span>
          <span style="font-weight:600;color:${isFull ? 'var(--ok-t)' : 'var(--warn-t)'}">${p.filled_count || 0} / ${p.required_count}</span>
        </div>
        <div style="background:var(--bg3);border-radius:var(--r-sm);height:6px;overflow:hidden;margin-top:3px">
          <div style="background:${isFull ? 'var(--ok)' : 'var(--warn)'};height:100%;width:${Math.min(100, pct)}%"></div>
        </div>
      </div>`;
    }).join('');
  }

  async function loadAssigned(reqId, token) {
    const container = $('#hr_assigned');
    if (!container) return;
    try {
      const req = await apiFetch(`/api/staff-requests/${reqId}`, token);
      const assignments = req.assignments || [];
      if (!assignments.length) {
        container.innerHTML = '<div style="color:var(--t3);padding:8px;font-size:13px">Пока никого не добавлено</div>';
        return;
      }
      container.innerHTML = assignments.map(a => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--bg2);border-radius:var(--r-sm);margin-bottom:4px;font-size:13px">
          <div>
            <b>${esc(a.fio || a.employee_name || '—')}</b>
            <span style="color:var(--t3);margin-left:6px">${esc(a.assigned_role || '')}</span>
            ${a.role_mismatch ? '<span style="color:var(--warn-t)"> ⚠️</span>' : ''}
          </div>
          <button class="btn mini ghost" data-remove-assign="${a.id}" style="color:var(--err-t);font-size:11px">✕ Убрать</button>
        </div>
      `).join('');

      // Update positions
      const posContainer = $('#hr_positions');
      if (posContainer && req.positions) {
        posContainer.innerHTML = renderPositions(req.positions);
      }

      // Remove handlers
      container.querySelectorAll('[data-remove-assign]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await apiDelete(`/api/staff-requests/${reqId}/assign/${btn.dataset.removeAssign}`, token);
            toast('Убрано', '', 'ok');
            await loadAssigned(reqId, token);
            await loadAvailableWorkers(reqId, token, req.positions || []);
          } catch (e) { toast('Ошибка', e.message, 'err'); }
        });
      });
    } catch (e) {
      container.innerHTML = '<div style="color:var(--err-t)">Ошибка загрузки</div>';
    }
  }

  async function loadAvailableWorkers(reqId, token, positions) {
    const container = $('#hr_workers');
    if (!container) return;

    const searchQ = ($('#hr_worker_search')?.value || '').toLowerCase().trim();
    const roleFilter = $('#hr_role_filter')?.value || '';

    try {
      const url = `/api/staff-requests/${reqId}/available-workers${roleFilter ? '?role=' + roleFilter : ''}`;
      let workers = await apiFetch(url, token);
      if (!Array.isArray(workers)) workers = workers.workers || workers.data || [];

      if (searchQ) {
        workers = workers.filter(w => (w.fio || '').toLowerCase().includes(searchQ));
      }

      if (!workers.length) {
        container.innerHTML = '<div style="color:var(--t3);padding:12px;text-align:center">Нет доступных рабочих</div>';
        return;
      }

      container.innerHTML = workers.map(w => {
        const ratColor = (w.rating_avg || 0) >= 4 ? 'var(--ok-t)' : (w.rating_avg || 0) >= 3 ? 'var(--warn-t)' : 'var(--t3)';
        const hasMismatch = w.conflict_reason === 'role_mismatch';
        const missingPermits = w.conflict_reason === 'missing_permits';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid var(--brd)">
          <div>
            <div style="font-weight:600;color:var(--t1)">${esc(w.fio || '—')}</div>
            <div style="font-size:11px;color:var(--t3)">
              ${esc(w.position || w.role_tag || '')}
              ${w.city ? ' · ' + esc(w.city) : ''}
              ${w.rating_avg ? ` · <span style="color:${ratColor}">★ ${Number(w.rating_avg).toFixed(1)}</span>` : ''}
            </div>
            ${hasMismatch ? '<div style="font-size:11px;color:var(--warn-t)">⚠️ Роль не совпадает</div>' : ''}
            ${missingPermits ? '<div style="font-size:11px;color:var(--err-t)">🔴 Нет допусков</div>' : ''}
          </div>
          <button class="btn mini primary" data-add-worker="${w.employee_id || w.id}">+ Добавить</button>
        </div>`;
      }).join('');

      // Add handlers
      container.querySelectorAll('[data-add-worker]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const empId = Number(btn.dataset.addWorker);
          // Find first unfilled position or use role filter
          const targetPos = roleFilter
            ? positions.find(p => p.role_key === roleFilter)
            : positions.find(p => (p.filled_count || 0) < p.required_count);

          if (!targetPos) {
            toast('Внимание', 'Все позиции заполнены', 'warn');
            return;
          }

          try {
            await apiPut(`/api/staff-requests/${reqId}/assign`, {
              employee_id: empId,
              position_id: targetPos.id,
              assigned_role: targetPos.role_key
            }, token);
            toast('Добавлен', '', 'ok');
            btn.disabled = true;
            btn.textContent = '✓';
            await loadAssigned(reqId, token);
            await loadAvailableWorkers(reqId, token, positions);
          } catch (e) { toast('Ошибка', e.message, 'err'); }
        });
      });
    } catch (e) {
      container.innerHTML = '<div style="color:var(--err-t)">Ошибка загрузки рабочих</div>';
    }
  }

  return { render };
})();
