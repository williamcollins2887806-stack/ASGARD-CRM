/**
 * ASGARD CRM — Дружина • Реестр рабочих
 * Desktop page: window.AsgardPersonnelPage, route #/personnel
 *
 * API: GET  /api/staff/readiness         — список с группировкой по статусу
 *      PUT  /api/staff/readiness/:id/status — смена статуса
 *      POST /api/staff/employees          — добавить нового
 *
 * Доступ: ADMIN, HR, HR_MANAGER, DIRECTOR_GEN, DIRECTOR_COMM, TO, HEAD_TO
 */
window.AsgardPersonnelPage = (function () {
  'use strict';

  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;
  const isDirRole = (r) =>
    (window.AsgardAuth && AsgardAuth.isDirectorRole)
      ? AsgardAuth.isDirectorRole(r)
      : (String(r || '') === 'DIRECTOR' || String(r || '').startsWith('DIRECTOR_'));

  // ─── Константы ──────────────────────────────────────────────────────────────

  // ALLOWED_ROLES = просмотр (read) страницы «Дружина». Должен совпадать с ролями роута /personnel в app.js.
  // PM/HEAD_PM видят всю дружину на десктопе (свою бригаду РП видит в полевом модуле, вкладка «Бригада»).
  const ALLOWED_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'PM', 'HEAD_PM', 'OFFICE_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'TO', 'HEAD_TO'];
  // EDIT_ROLES = редактирование. PM остаётся read-only — править анкеты может HR/директор.
  const EDIT_ROLES    = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];

  // 2,4М ₽ — стандартный годовой лимит СЗ (самозанятый)
  const SE_YEAR_LIMIT = 2_400_000;

  const STATUSES = [
    { code: 'on_site',   label: 'На объекте', bgVar: '--ok-bg',   tVar: '--ok-t'   },
    { code: 'approved',  label: 'Утверждён',  bgVar: '--info-bg', tVar: '--info-t'  },
    { code: 'ready',     label: 'Готов',      bgVar: '--gold-bg', tVar: '--gold'    },
    { code: 'not_ready', label: 'Не готов',   bgVar: '--warn-bg', tVar: '--warn-t'  },
    { code: 'archive',   label: 'Архив',      bgVar: '--bg3',     tVar: '--t3'      },
  ];

  const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.code, s]));

  const REASONS = [
    { key: 'illness',    label: 'Болезнь' },
    { key: 'vacation',   label: 'Отпуск' },
    { key: 'family',     label: 'Семейные обстоятельства' },
    { key: 'training',   label: 'Обучение' },
    { key: 'personal',   label: 'Личные дела' },
    { key: 'legal',      label: 'Юридические вопросы' },
    { key: 'injury',     label: 'Травма на производстве' },
    { key: 'no_contact', label: 'Не выходит на связь' },
    { key: 'refused',    label: 'Отказ без причины' },
    { key: 'other',      label: 'Другое' },
  ];

  // ─── Утилиты ─────────────────────────────────────────────────────────────────

  function getToken() {
    try { return AsgardAuth.getAuth?.()?.token || localStorage.getItem('asgard_token') || ''; }
    catch (_) { return ''; }
  }

  function authHeaders(json = false) {
    const h = { 'Authorization': 'Bearer ' + getToken() };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function apiFetch(path) {
    const r = await fetch('/api' + path, { headers: authHeaders() });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'HTTP ' + r.status);
    }
    return r.json();
  }

  async function apiPut(path, body) {
    const r = await fetch('/api' + path, {
      method: 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
    return data;
  }

  async function apiPost(path, body) {
    const r = await fetch('/api' + path, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
    return data;
  }

  function parseQuery() {
    const h = (location.hash || '#/personnel').replace(/^#/, '');
    const [, qs] = h.split('?');
    const q = {};
    if (qs) qs.split('&').forEach(kv => {
      if (!kv) return;
      const [k, v] = kv.split('=');
      q[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return q;
  }

  function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
    catch (_) { return String(d).slice(0, 10); }
  }

  function fmtMoney(n) {
    if (n == null || !isFinite(n)) return '—';
    return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₽';
  }

  function statusBadge(code) {
    const s = STATUS_MAP[code];
    if (!s) return `<span class="badge" style="background:var(--bg3);color:var(--t3)">${esc(code || '—')}</span>`;
    return `<span class="badge" style="background:var(${s.bgVar});color:var(${s.tVar})">${esc(s.label)}</span>`;
  }

  function docIndicator(permits) {
    if (!permits) return '';
    const { expired = 0, expiring = 0 } = permits;
    if (expired > 0)  return `<span title="${expired} просрочен${expired === 1 ? '' : 'о'}" style="font-size:16px;cursor:default">🔴</span>`;
    if (expiring > 0) return `<span title="${expiring} скоро истекает" style="font-size:16px;cursor:default">⚠️</span>`;
    return `<span title="Документы в порядке" style="font-size:16px;cursor:default">✅</span>`;
  }

  function seLimitBar(transferred, limit) {
    const pct = limit > 0 ? Math.min(100, Math.round(transferred / limit * 100)) : 0;
    let barColor = 'var(--ok)';
    if (pct >= 90) barColor = 'var(--err)';
    else if (pct >= 70) barColor = 'var(--warn)';
    return `
      <div style="min-width:110px">
        <div style="font-size:11px;color:var(--t3);margin-bottom:3px">${fmtMoney(transferred)} / ${fmtMoney(limit)}</div>
        <div style="background:var(--bg3);border-radius:var(--r-sm);height:6px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${barColor};border-radius:var(--r-sm);transition:width .3s"></div>
        </div>
        <div style="font-size:10px;color:var(--t3);margin-top:2px;text-align:right">${pct}%</div>
      </div>`;
  }

  function ratingHtml(v) {
    if (v == null || !isFinite(Number(v))) return '<span style="color:var(--t3)">—</span>';
    const n = Number(v);
    let col = 'var(--t2)';
    if (n >= 8) col = 'var(--ok)';
    else if (n >= 6) col = 'var(--gold)';
    else if (n < 4) col = 'var(--err)';
    return `<span style="font-weight:700;color:${col}">${n.toFixed(1)}</span>`;
  }

  // ─── Основной рендер страницы ─────────────────────────────────────────────

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;

    if (!(ALLOWED_ROLES.includes(user.role) || isDirRole(user.role))) {
      toast('Доступ', 'Недостаточно прав', 'err');
      location.hash = '#/home';
      return;
    }

    const canEdit = EDIT_ROLES.includes(user.role) || isDirRole(user.role);
    const query   = parseQuery();
    const qSearch = (query.q  || '').trim().toLowerCase();
    const qSpec   = (query.spec || '').trim();
    const qStatus = (query.status || '').trim();

    // ── Загрузка данных ────────────────────────────────────────────────────────
    let employees = [];
    let groups    = { on_site: 0, approved: 0, ready: 0, not_ready: 0, archive: 0 };

    try {
      const data = await apiFetch('/staff/readiness');
      employees = data.employees || [];
      groups    = data.groups    || groups;
    } catch (e) {
      toast('Ошибка загрузки', e.message, 'err');
    }

    // Справочник специальностей (уникальные role_tag)
    const specialties = [...new Set(
      employees.map(e => e.role_tag || '').filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'ru'));

    // ── Фильтрация ─────────────────────────────────────────────────────────────
    let rows = employees.slice();
    if (qSearch) {
      rows = rows.filter(e =>
        (e.fio   || '').toLowerCase().includes(qSearch) ||
        (e.phone || '').toLowerCase().includes(qSearch)
      );
    }
    if (qSpec) {
      rows = rows.filter(e => (e.role_tag || '') === qSpec);
    }
    if (qStatus) {
      rows = rows.filter(e => (e.effective_status || e.readiness_status || '') === qStatus);
    }

    // Сортировка: on_site → approved → ready → not_ready → archive → прочие, внутри — ФИО
    const statusOrder = { on_site: 0, approved: 1, ready: 2, not_ready: 3, archive: 4 };
    rows.sort((a, b) => {
      const sa = statusOrder[a.effective_status] ?? 9;
      const sb = statusOrder[b.effective_status] ?? 9;
      if (sa !== sb) return sa - sb;
      return (a.fio || '').localeCompare(b.fio || '', 'ru');
    });

    // ── Статусные группы для секций таблицы ───────────────────────────────────
    const grouped = {};
    STATUSES.forEach(s => { grouped[s.code] = []; });
    rows.forEach(e => {
      const st = e.effective_status || e.readiness_status || 'archive';
      if (grouped[st]) grouped[st].push(e);
      else if (grouped['archive']) grouped['archive'].push(e);
    });

    // ── HTML ────────────────────────────────────────────────────────────────────
    const specOptions = specialties.map(s =>
      `<option value="${esc(s)}"${qSpec === s ? ' selected' : ''}>${esc(s)}</option>`
    ).join('');

    const statusOptions = STATUSES.map(s =>
      `<option value="${esc(s.code)}"${qStatus === s.code ? ' selected' : ''}>${esc(s.label)}</option>`
    ).join('');

    // Бейджи суммарных статусов
    const summaryBadges = STATUSES.map(s => {
      const cnt = groups[s.code] || 0;
      const active = qStatus === s.code ? 'outline:2px solid var(--accent);' : '';
      return `<button class="btn-status-badge" data-status="${s.code}"
        style="background:var(${s.bgVar});color:var(${s.tVar});border:none;border-radius:var(--r-md);
               padding:8px 14px;cursor:pointer;${active}transition:opacity .15s">
        <div style="font-size:22px;font-weight:800;line-height:1">${cnt}</div>
        <div style="font-size:11px;opacity:.85;margin-top:2px">${esc(s.label)}</div>
      </button>`;
    }).join('');

    // Строки таблицы по секциям
    let tbodyHtml = '';
    let anyRow = false;
    STATUSES.forEach(st => {
      const list = grouped[st.code];
      if (!list || !list.length) return;
      anyRow = true;

      // Заголовок группы
      tbodyHtml += `
        <tr>
          <td colspan="8" style="background:var(${st.bgVar});color:var(${st.tVar});
              font-weight:700;font-size:12px;letter-spacing:.5px;padding:6px 12px;border:none">
            ${esc(st.label.toUpperCase())} &nbsp;·&nbsp; ${list.length}
          </td>
        </tr>`;

      list.forEach(e => {
        const location_info = e.on_site_info || e.approved_info || null;
        const workTitle = location_info ? (location_info.work_title || '') : '';
        const pmName    = location_info ? (location_info.pm_name    || '') : '';
        const startDate = e.readiness_date ? fmtDate(e.readiness_date) : '—';
        const seTrans   = Number(e.se_transferred_year || 0);

        tbodyHtml += `
          <tr class="prs-row" data-id="${e.id}" style="cursor:pointer" title="Открыть карточку">
            <td>
              <div style="font-weight:600;color:var(--t1)">${esc(e.fio || '—')}</div>
              <div style="font-size:12px;color:var(--t3)">${esc(e.phone || '')}</div>
            </td>
            <td style="color:var(--t2);font-size:13px">${esc(e.role_tag || e.position || '—')}</td>
            <td>${statusBadge(e.effective_status || e.readiness_status)}</td>
            <td>
              ${workTitle ? `<div style="font-size:13px;font-weight:500">${esc(workTitle)}</div>` : '<span style="color:var(--t3)">—</span>'}
              ${pmName    ? `<div style="font-size:11px;color:var(--t3)">${esc(pmName)}</div>` : ''}
            </td>
            <td style="white-space:nowrap;font-size:13px;color:var(--t2)">${startDate}</td>
            <td style="text-align:center">${docIndicator(e.permits)}</td>
            <td>${e.is_self_employed ? seLimitBar(seTrans, SE_YEAR_LIMIT) : '<span style="color:var(--t3);font-size:12px">—</span>'}</td>
            <td style="text-align:right">${ratingHtml(e.rating_avg)}</td>
          </tr>`;
      });
    });

    if (!anyRow) {
      tbodyHtml = `<tr><td colspan="8" class="muted" style="text-align:center;padding:32px">
        Нет рабочих, соответствующих фильтрам
      </td></tr>`;
    }

    const html = `
      <div class="panel">

        <!-- Шапка -->
        <div class="row" style="justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px">
          <div>
            <div style="font-size:18px;font-weight:700;color:var(--t1)">Дружина</div>
            <div class="help" style="margin-top:2px">ᚨ В дружине сила. В учёте — порядок. В деле — честь.</div>
          </div>
          <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
            ${canEdit ? '<button class="btn" id="prs_btnAdd">+ Добавить</button>' : ''}
            <button class="btn ghost" id="prs_btnSchedule">График</button>
          </div>
        </div>

        <!-- Статусные счётчики -->
        <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:18px" id="prs_statusBadges">
          ${summaryBadges}
        </div>

        <!-- Фильтры -->
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center">
          <input id="prs_q" class="input" placeholder="Поиск по ФИО, телефону…"
            style="min-width:220px;flex:1" value="${esc(qSearch)}"/>
          <select id="prs_spec" class="input" style="min-width:160px">
            <option value="">Специальность: все</option>
            ${specOptions}
          </select>
          <select id="prs_status" class="input" style="min-width:150px">
            <option value="">Статус: все</option>
            ${statusOptions}
          </select>
          <button class="btn" id="prs_btnFind">Найти</button>
          <button class="btn ghost" id="prs_btnReset">Сброс</button>
        </div>

        <!-- Таблица -->
        <div class="tablewrap">
          <table class="asg" id="prs_table">
            <thead>
              <tr>
                <th>ФИО / Телефон</th>
                <th>Специальность</th>
                <th>Статус</th>
                <th>Объект / РП</th>
                <th>Начало работ</th>
                <th style="text-align:center;width:60px">Документы</th>
                <th style="width:140px">Лимит СЗ</th>
                <th style="text-align:right;width:70px">Рейтинг</th>
              </tr>
            </thead>
            <tbody id="prs_tbody">
              ${tbodyHtml}
            </tbody>
          </table>
        </div>

        <!-- Пагинация -->
        <div id="prs_pagination"></div>

        <div class="help" style="margin-top:12px">
          Всего найдено: <b>${rows.length}</b> рабочих
        </div>
      </div>`;

    await layout(html, { title: title || 'Дружина • Реестр рабочих' });

    // ── Пагинация ──────────────────────────────────────────────────────────────
    if (window.AsgardPagination) {
      const tbody     = document.getElementById('prs_tbody');
      const pgWrap    = document.getElementById('prs_pagination');
      let currentPage = 1;
      let pageSize    = AsgardPagination.getPageSize();

      // Собираем строки-разделители и строки-данные отдельно
      const dataRows = tbody
        ? Array.from(tbody.querySelectorAll('tr.prs-row'))
        : [];

      function applyPagination(pg, ps) {
        if (!tbody) return;
        // Показываем/скрываем строки данных
        dataRows.forEach((r, i) => {
          r.style.display = (ps > 0 && (i < (pg - 1) * ps || i >= pg * ps)) ? 'none' : '';
        });
        // Заголовки секций: показываем только если есть видимые строки под ними
        const allRows = Array.from(tbody.querySelectorAll('tr'));
        allRows.forEach(r => {
          if (r.classList.contains('prs-row')) return;
          // Ищем следующую видимую строку данных до следующего заголовка
          let next = r.nextElementSibling;
          let hasVisible = false;
          while (next && !next.querySelector('td[colspan]')) {
            if (next.classList.contains('prs-row') && next.style.display !== 'none') {
              hasVisible = true;
              break;
            }
            next = next.nextElementSibling;
          }
          r.style.display = hasVisible ? '' : 'none';
        });

        if (pgWrap) {
          pgWrap.innerHTML = AsgardPagination.renderControls(dataRows.length, pg, ps);
          AsgardPagination.attachHandlers(
            'prs_pagination',
            (p) => { currentPage = p; applyPagination(p, pageSize); },
            (s) => { pageSize = s; currentPage = 1; applyPagination(1, s); }
          );
        }
      }

      if (dataRows.length > 0) applyPagination(currentPage, pageSize);
    }

    // ── Обработчики фильтров ──────────────────────────────────────────────────

    function buildFilter() {
      const qv  = ($('#prs_q')?.value      || '').trim();
      const sv  = ($('#prs_spec')?.value   || '').trim();
      const stv = ($('#prs_status')?.value || '').trim();
      const parts = [];
      if (qv)  parts.push(`q=${encodeURIComponent(qv)}`);
      if (sv)  parts.push(`spec=${encodeURIComponent(sv)}`);
      if (stv) parts.push(`status=${encodeURIComponent(stv)}`);
      location.hash = '#/personnel' + (parts.length ? '?' + parts.join('&') : '');
    }

    $('#prs_btnFind')?.addEventListener('click', buildFilter);
    $('#prs_btnReset')?.addEventListener('click', () => { location.hash = '#/personnel'; });
    $('#prs_q')?.addEventListener('keydown', e => { if (e.key === 'Enter') buildFilter(); });

    // Клик по статусным бейджам — фильтруем
    $$('.btn-status-badge').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.status;
        if ($('#prs_status')) $('#prs_status').value = code === qStatus ? '' : code;
        buildFilter();
      });
    });

    // Кнопки навигации
    $('#prs_btnSchedule')?.addEventListener('click', () => { location.hash = '#/workers-schedule'; });

    // Клик по строке → карточка сотрудника
    $$('.prs-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        if (id) location.hash = `#/employee?id=${id}`;
      });
    });

    // ── Кнопка «Добавить» ─────────────────────────────────────────────────────
    if (canEdit) {
      $('#prs_btnAdd')?.addEventListener('click', () => openAddModal(auth));
    }
  }

  // ─── Модалка добавления сотрудника ──────────────────────────────────────────

  function openAddModal(auth) {
    const specialtyOptions = [
      'Оператор ВД',
      'Наблюдающий (ВД)',
      'Слесарь-сантехник',
      'Электромонтажник',
      'Стропальщик',
      'Мастер участка',
      'Подсобный рабочий',
      'Сварщик',
      'Монтажник',
    ].map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');

    const body = `
      <div class="formrow">
        <div style="grid-column:1/-1">
          <label>ФИО <span style="color:var(--err)">*</span></label>
          <input id="ae_fio" class="input" placeholder="Фамилия Имя Отчество"/>
        </div>
        <div>
          <label>Телефон</label>
          <input id="ae_phone" class="input" placeholder="+7 (___) ___-__-__"/>
        </div>
        <div>
          <label>Дата рождения</label>
          <input id="ae_birth" type="date" class="input"/>
        </div>
        <div>
          <label>Специальность</label>
          <select id="ae_spec" class="input">
            <option value="">— выбрать —</option>
            ${specialtyOptions}
          </select>
        </div>
        <div>
          <label>Разряд</label>
          <input id="ae_grade" class="input" placeholder="3–6"/>
        </div>
        <div>
          <label>Город</label>
          <input id="ae_city" class="input" placeholder="Москва"/>
        </div>
        <div style="grid-column:1/-1">
          <label>Примечание</label>
          <textarea id="ae_notes" class="input" rows="2" placeholder="Доп. информация…"></textarea>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button class="btn ghost" id="ae_btnCancel">Отмена</button>
        <button class="btn" id="ae_btnSave">Сохранить</button>
      </div>`;

    showModal('Новый сотрудник', body);

    $('#ae_btnCancel')?.addEventListener('click', () => closeModal());

    $('#ae_btnSave')?.addEventListener('click', async () => {
      const fio = ($('#ae_fio')?.value || '').trim();
      if (!fio) { toast('Проверка', 'ФИО обязательно', 'err'); return; }

      const btn = $('#ae_btnSave');
      btn.disabled = true;
      btn.textContent = 'Сохранение…';

      try {
        const payload = {
          fio,
          phone:      ($('#ae_phone')?.value || '').trim() || undefined,
          birth_date: ($('#ae_birth')?.value || '').trim() || undefined,
          role_tag:   ($('#ae_spec')?.value  || '').trim() || undefined,
          grade:      ($('#ae_grade')?.value || '').trim() || undefined,
          city:       ($('#ae_city')?.value  || '').trim() || undefined,
          notes:      ($('#ae_notes')?.value || '').trim() || undefined,
        };
        // Убираем undefined
        Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

        await apiPost('/staff/employees', payload);
        toast('Готово', `${fio} добавлен`, 'ok');
        closeModal();
        location.hash = '#/personnel';
      } catch (e) {
        toast('Ошибка', e.message, 'err');
        btn.disabled = false;
        btn.textContent = 'Сохранить';
      }
    });
  }

  // ─── Модалка карточки статуса рабочего (вызывается из employee.js / напрямую) ──

  async function openStatusModal(employeeId, employeeFio, currentStatus, onSuccess) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) return;
    const canEdit = EDIT_ROLES.includes(auth.user.role) || isDirRole(auth.user.role);

    // Подгружаем данные сотрудника
    let emp = null;
    let seOps = [];
    try {
      const d = await apiFetch(`/staff/readiness`);
      emp = (d.employees || []).find(e => e.id === Number(employeeId));
    } catch (_) {}

    const status = emp?.effective_status || emp?.readiness_status || currentStatus || 'unknown';
    const seTrans = Number(emp?.se_transferred_year || 0);
    const seRemaining = Math.max(0, SE_YEAR_LIMIT - seTrans);

    // Лог последних операций СЗ
    try {
      const seData = await apiFetch(`/staff/readiness/log/${employeeId}`);
      seOps = (seData.log || []).slice(0, 3);
    } catch (_) {}

    const statusSelectorHtml = canEdit ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn prs-st-btn" data-st="ready"
          style="background:var(--gold-bg);color:var(--gold)">✓ Готов</button>
        <button class="btn ghost prs-st-btn" data-st="not_ready"
          style="border-color:var(--warn);color:var(--warn-t)">✗ Не готов</button>
        <button class="btn ghost prs-st-btn" data-st="archive"
          style="border-color:var(--brd);color:var(--t3)">Архив</button>
      </div>` : '';

    const seBlockHtml = emp?.is_self_employed ? `
      <div style="margin-top:16px;padding:12px;background:var(--bg2);border-radius:var(--r-md)">
        <div style="font-weight:600;color:var(--t1);margin-bottom:8px">СЗ — годовой лимит</div>
        ${seLimitBar(seTrans, SE_YEAR_LIMIT)}
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--t3);margin-top:6px">
          <span>Перечислено: ${fmtMoney(seTrans)}</span>
          <span>Остаток: ${fmtMoney(seRemaining)}</span>
        </div>
        ${seOps.length ? `
          <div style="margin-top:10px;font-size:12px;color:var(--t3)">Последние операции:</div>
          <div style="margin-top:4px">
            ${seOps.map(op => `
              <div style="font-size:12px;color:var(--t2);padding:3px 0;border-bottom:1px solid var(--brd)">
                ${fmtDate(op.created_at)} — ${statusBadge(op.new_status)}
                ${op.reason ? `<span style="color:var(--t3)"> · ${esc(op.reason)}</span>` : ''}
              </div>`).join('')}
          </div>` : ''}
      </div>` : '';

    const empBody = `
      <div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <div style="font-size:28px">👤</div>
          <div>
            <div style="font-weight:700;font-size:16px;color:var(--t1)">${esc(emp?.fio || employeeFio || '—')}</div>
            <div style="font-size:13px;color:var(--t3)">${esc(emp?.role_tag || emp?.position || '')}</div>
          </div>
        </div>

        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="color:var(--t2);font-size:13px">Статус:</span>
          ${statusBadge(status)}
          ${emp?.readiness_date ? `<span style="font-size:12px;color:var(--t3)">с ${fmtDate(emp.readiness_date)}</span>` : ''}
        </div>

        ${emp?.on_site_info || emp?.approved_info ? `
          <div style="margin-top:8px;font-size:13px;color:var(--t2)">
            Объект: <b>${esc((emp.on_site_info || emp.approved_info)?.work_title || '—')}</b>
            ${(emp.on_site_info || emp.approved_info)?.pm_name
              ? ` · РП: ${esc((emp.on_site_info || emp.approved_info).pm_name)}`
              : ''}
          </div>` : ''}

        ${emp?.readiness_reason ? `
          <div style="margin-top:6px;font-size:12px;color:var(--t3)">
            Причина: ${esc(REASONS.find(r => r.key === emp.readiness_reason)?.label || emp.readiness_reason)}
          </div>` : ''}

        ${statusSelectorHtml}

        <!-- Форма изменения статуса (скрыта по умолчанию) -->
        <div id="prs_statusForm" style="display:none;margin-top:12px;padding:12px;
             background:var(--bg2);border-radius:var(--r-md)">
        </div>

        ${seBlockHtml}

        <!-- Официальное трудоустройство (read-only) -->
        ${emp?.is_officially_employed ? `
          <div style="margin-top:16px;padding:12px;background:var(--bg2);border-radius:var(--r-md)">
            <div style="font-weight:600;color:var(--t1);margin-bottom:8px">Официальное трудоустройство</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px">
              <div style="color:var(--t3)">Оклад:</div>
              <div style="color:var(--t1)">${fmtMoney(emp.salary)}</div>
              <div style="color:var(--t3)">Дата найма:</div>
              <div style="color:var(--t1)">${fmtDate(emp.hire_date || emp.employment_date)}</div>
              <div style="color:var(--t3)">Статус:</div>
              <div><span style="background:var(--ok-bg);color:var(--ok-t);padding:2px 8px;
                   border-radius:var(--r-sm);font-size:11px">Трудоустроен</span></div>
            </div>
          </div>` : ''}

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <button class="btn ghost" id="prs_btnOpenFull">Полная карточка</button>
          ${canEdit ? '<button class="btn" id="prs_btnSaveStatus" style="display:none">Сохранить</button>' : ''}
          <button class="btn ghost" id="prs_btnCloseCard">Закрыть</button>
        </div>
      </div>`;

    showModal(`Статус рабочего`, empBody);

    $('#prs_btnCloseCard')?.addEventListener('click', () => closeModal());
    $('#prs_btnOpenFull')?.addEventListener('click', () => {
      closeModal();
      location.hash = `#/employee?id=${employeeId}`;
    });

    // Кнопки смены статуса
    let pendingStatus = null;
    let pendingDate   = null;
    let pendingReason = null;
    let pendingComment = null;

    $$('.prs-st-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        pendingStatus = btn.dataset.st;
        renderStatusForm(pendingStatus);
      });
    });

    function renderStatusForm(st) {
      const form = $('#prs_statusForm');
      const saveBtn = $('#prs_btnSaveStatus');
      if (!form) return;
      form.style.display = '';
      if (saveBtn) saveBtn.style.display = '';

      let html = `<div style="font-size:13px;color:var(--t2);margin-bottom:8px">
        Изменить статус на: ${statusBadge(st)}
      </div>`;

      if (st === 'ready') {
        html += `<label style="font-size:13px;color:var(--t3)">Дата готовности <span style="color:var(--err)">*</span></label>
          <input id="prs_rdDate" type="date" class="input" style="margin-top:4px"
            value="${new Date().toISOString().slice(0, 10)}"/>`;
      }
      if (st === 'not_ready') {
        const reasonOpts = REASONS.map(r =>
          `<option value="${esc(r.key)}">${esc(r.label)}</option>`
        ).join('');
        html += `<label style="font-size:13px;color:var(--t3)">Причина <span style="color:var(--err)">*</span></label>
          <select id="prs_rdReason" class="input" style="margin-top:4px">
            <option value="">— выбрать —</option>
            ${reasonOpts}
          </select>`;
      }
      html += `<label style="font-size:13px;color:var(--t3);margin-top:8px;display:block">Комментарий</label>
        <input id="prs_rdComment" class="input" style="margin-top:4px" placeholder="Необязательно…"/>`;

      form.innerHTML = html;

      // Bind inputs
      $('#prs_rdDate')?.addEventListener('change', e => { pendingDate = e.target.value; });
      $('#prs_rdReason')?.addEventListener('change', e => { pendingReason = e.target.value; });
      $('#prs_rdComment')?.addEventListener('input', e => { pendingComment = e.target.value; });
      pendingDate = $('#prs_rdDate')?.value || null;
    }

    if (canEdit) {
      $('#prs_btnSaveStatus')?.addEventListener('click', async () => {
        if (!pendingStatus) { toast('Выберите статус', '', 'err'); return; }

        // Подбираем актуальные значения из формы
        const rdDate    = ($('#prs_rdDate')?.value    || '').trim();
        const rdReason  = ($('#prs_rdReason')?.value  || '').trim();
        const rdComment = ($('#prs_rdComment')?.value || '').trim();

        if (pendingStatus === 'ready' && !rdDate) {
          toast('Укажите дату готовности', '', 'err'); return;
        }
        if (pendingStatus === 'not_ready' && !rdReason) {
          toast('Укажите причину', '', 'err'); return;
        }

        const saveBtn = $('#prs_btnSaveStatus');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Сохранение…'; }

        try {
          await apiPut(`/staff/readiness/${employeeId}/status`, {
            status:         pendingStatus,
            readiness_date: rdDate   || null,
            reason:         rdReason  || null,
            comment:        rdComment || null,
          });
          toast('Сохранено', `Статус изменён на «${STATUS_MAP[pendingStatus]?.label || pendingStatus}»`);
          closeModal();
          if (typeof onSuccess === 'function') onSuccess();
          else location.hash = '#/personnel';
        } catch (e) {
          toast('Ошибка', e.message, 'err');
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Сохранить'; }
        }
      });
    }
  }

  // ─── Публичный API ────────────────────────────────────────────────────────────

  return { render, openStatusModal };
})();
