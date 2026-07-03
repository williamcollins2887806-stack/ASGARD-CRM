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
  // EDIT_ROLES = редактирование.
  // FIX (23.06.2026): HEAD_PM (руководитель РП) и OFFICE_MANAGER (офис-менеджер) — могут править
  // контактные/паспортные данные и добавлять новых. Финансовые поля и статус увольнения остаются под HR/директорами
  // (см. employee.js: canEditFinance / canEditHrSensitive).
  const EDIT_ROLES    = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'HEAD_PM', 'OFFICE_MANAGER'];
  // FIN_ROLES = финансовые операции, в т.ч. импорт остатков СЗ из Excel Озон-Банка.
  // Зеркалит src/routes/staff.js FIN_ROLES (ADMIN/DIRECTOR_GEN/DIRECTOR_COMM/DIRECTOR_DEV/BUH).
  const FIN_ROLES     = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'];

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

  // multipart POST для импорта Excel (Content-Type ставит браузер сам с boundary)
  async function apiPostMultipart(path, formData) {
    const r = await fetch('/api' + path, {
      method: 'POST',
      headers: authHeaders(),  // без 'Content-Type' — браузер сам
      body: formData,
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
    const canImportSe = FIN_ROLES.includes(user.role) || isDirRole(user.role);
    const query   = parseQuery();
    const qSearch = (query.q  || '').trim().toLowerCase();
    const qSpec   = (query.spec || '').trim();
    const qStatus = (query.status || '').trim();
    // 25.06.2026: фильтры по городу и пропускам (БОСИЕТ/РУКАВ/МЛСП/ФСБ)
    const qCity   = (query.city || '').trim();
    const qPass   = (query.pass || '').trim();

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
    // 25.06.2026: уникальные города
    const citiesList = [...new Set(
      employees.map(e => (e.city || '').trim()).filter(Boolean)
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
    if (qCity) {
      rows = rows.filter(e => (e.city || '').trim() === qCity);
    }
    if (qPass) {
      // 'CODE' = есть · 'missing:CODE' = нет · 'expired:CODE' = просрочен · 'expiring:CODE' = до 30д
      const today = new Date().toISOString().slice(0, 10);
      const in30 = new Date(); in30.setDate(in30.getDate() + 30);
      const in30Str = in30.toISOString().slice(0, 10);
      const [mode, code] = qPass.includes(':') ? qPass.split(':') : ['has', qPass];
      rows = rows.filter(e => {
        const kp = (e.key_permits || {})[code];
        if (mode === 'has')      return !!kp;
        if (mode === 'missing')  return !kp;
        if (mode === 'expired')  return !!kp && kp.expiry_date && String(kp.expiry_date).slice(0, 10) < today;
        if (mode === 'expiring') {
          if (!kp || !kp.expiry_date) return false;
          const d = String(kp.expiry_date).slice(0, 10);
          return d >= today && d < in30Str;
        }
        return true;
      });
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

    // 25.06.2026: опции города и пропусков
    const cityOptions = citiesList.map(c =>
      `<option value="${esc(c)}"${qCity === c ? ' selected' : ''}>${esc(c)}</option>`
    ).join('');

    const PASS_FILTERS = [
      { v: 'BOSIET',          label: '✓ Есть БОСИЕТ' },
      { v: 'SLEEVE',          label: '✓ Есть РУКАВ' },
      { v: 'MLSP_PASS',       label: '✓ Есть МЛСП' },
      { v: 'FSB',             label: '✓ Есть ФСБ' },
      { v: 'missing:BOSIET',  label: '✗ Нет БОСИЕТ' },
      { v: 'missing:SLEEVE',  label: '✗ Нет РУКАВ' },
      { v: 'missing:MLSP_PASS',label: '✗ Нет МЛСП' },
      { v: 'missing:FSB',     label: '✗ Нет ФСБ' },
      { v: 'expired:BOSIET',  label: '🔴 Просрочен БОСИЕТ' },
      { v: 'expired:SLEEVE',  label: '🔴 Просрочен РУКАВ' },
      { v: 'expired:MLSP_PASS',label: '🔴 Просрочен МЛСП' },
      { v: 'expired:FSB',     label: '🔴 Просрочен ФСБ' },
      { v: 'expiring:BOSIET', label: '⚠ Истекает БОСИЕТ ≤30д' },
      { v: 'expiring:SLEEVE', label: '⚠ Истекает РУКАВ ≤30д' },
      { v: 'expiring:MLSP_PASS',label: '⚠ Истекает МЛСП ≤30д' },
      { v: 'expiring:FSB',    label: '⚠ Истекает ФСБ ≤30д' }
    ];
    const passOptions = PASS_FILTERS.map(p =>
      `<option value="${esc(p.v)}"${qPass === p.v ? ' selected' : ''}>${esc(p.label)}</option>`
    ).join('');

    // Помощник: компактные чипы 4 ключевых пропусков
    function keyPermChipsHtml(kp) {
      const today = new Date().toISOString().slice(0, 10);
      const in30  = new Date(); in30.setDate(in30.getDate() + 30);
      const in30Str = in30.toISOString().slice(0, 10);
      const ITEMS = [
        { code: 'BOSIET',    short: 'Б', label: 'БОСИЕТ' },
        { code: 'SLEEVE',    short: 'Р', label: 'РУКАВ' },
        { code: 'MLSP_PASS', short: 'М', label: 'МЛСП' },
        { code: 'FSB',       short: 'Ф', label: 'ФСБ' }
      ];
      const chips = ITEMS.map(({ code, short, label }) => {
        const p = kp && kp[code];
        // дефолт «нет»
        let bg = 'var(--bar-bg)', fg = 'var(--t3)', bd = 'var(--brd)', op = '0.55';
        let date = '', title = label + ': нет';
        if (p) {
          const exp = p.expiry_date ? String(p.expiry_date).slice(0, 10) : null;
          if (!exp)               { bg='var(--ok-bg)';     fg='var(--ok)';    bd='var(--ok)';    op='1'; title=label+': действует (без срока)'; }
          else if (exp < today)   { bg='var(--err-bg)';    fg='var(--err)';   bd='var(--err)';   op='1'; title=label+': ПРОСРОЧЕН '+fmtDate(exp); date=fmtDate(exp).slice(0,5); }
          else if (exp < in30Str) { bg='var(--orange-bg)'; fg='var(--amber)'; bd='var(--amber)'; op='1'; title=label+': истекает '+fmtDate(exp); date=fmtDate(exp).slice(0,5); }
          else                    { bg='var(--ok-bg)';     fg='var(--ok)';    bd='var(--ok)';    op='1'; title=label+': до '+fmtDate(exp); date=fmtDate(exp).slice(0,5); }
        }
        return `<div title="${esc(title)}" style="min-width:32px;padding:3px 4px 2px;border-radius:5px;font-size:10px;line-height:1.1;text-align:center;font-weight:700;border:1px solid ${bd};background:${bg};color:${fg};opacity:${op}">
          <div style="font-size:12px">${short}</div>
          ${date ? `<div style="font-size:9px;opacity:.85;margin-top:1px;font-weight:500">${esc(date)}</div>` : ''}
        </div>`;
      }).join('');
      return `<div style="display:inline-flex;gap:3px;align-items:center;justify-content:center">${chips}</div>`;
    }

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
          <td colspan="10" style="background:var(${st.bgVar});color:var(${st.tVar});
              font-weight:700;font-size:12px;letter-spacing:.5px;padding:6px 12px;border:none">
            ${esc(st.label.toUpperCase())} &nbsp;·&nbsp; ${list.length}
          </td>
        </tr>`;

      list.forEach(e => {
        // Приоритет: активный объект (on_site/approved) → последняя работа (last_assignment_info) → —
        const active = e.on_site_info || e.approved_info || null;
        const last   = !active && e.last_assignment_info ? e.last_assignment_info : null;
        const workTitle = active ? (active.work_title || '') : (last ? (last.work_title || '') : '');
        const pmName    = active ? (active.pm_name    || '') : (last ? (last.pm_name    || '') : '');
        const isHistorical = !!last && !active;
        // «Начало работ» — для активных: дата готовности (когда стал готов).
        // Для исторических (последняя работа): дата старта последнего assignment'а.
        const startDate = active
          ? (e.readiness_date ? fmtDate(e.readiness_date) : '—')
          : (last && last.start_date ? fmtDate(last.start_date) : (e.readiness_date ? fmtDate(e.readiness_date) : '—'));
        const seTrans   = Number(e.se_transferred_year || 0);

        // Префикс «был на:» для последней работы (когда сотрудник не на объекте сейчас).
        // Для активного — название работы без префикса (он там сейчас).
        const titleHtml = workTitle ? `
          <div style="font-size:13px;font-weight:${isHistorical ? '400' : '500'};color:${isHistorical ? 'var(--t2)' : 'var(--t1)'}">
            ${isHistorical ? '<span style="color:var(--t3);font-size:11px">был на:</span> ' : ''}${esc(workTitle)}
          </div>` : '<span style="color:var(--t3)">—</span>';
        const pmHtml = pmName
          ? `<div style="font-size:11px;color:var(--t3)">${isHistorical ? 'РП: ' : ''}${esc(pmName)}</div>`
          : '';

        tbodyHtml += `
          <tr class="prs-row" data-id="${e.id}" style="cursor:pointer" title="Открыть карточку">
            <td>
              <div style="font-weight:600;color:var(--t1)">${esc(e.fio || '—')}</div>
              <div style="font-size:12px;color:var(--t3)">${esc(e.phone || '')}</div>
            </td>
            <td style="color:var(--t2);font-size:13px">${esc(e.role_tag || e.position || '—')}</td>
            <td>${statusBadge(e.effective_status || e.readiness_status)}</td>
            <td>
              ${titleHtml}
              ${pmHtml}
            </td>
            <td style="white-space:nowrap;font-size:13px;color:var(--t2)">${startDate}</td>
            <td style="text-align:center">${docIndicator(e.permits)}</td>
            <td style="text-align:center">${keyPermChipsHtml(e.key_permits)}</td>
            <td style="font-size:12.5px;color:var(--t2)">${e.city ? esc(e.city) : '<span style="color:var(--t3)">—</span>'}</td>
            <td>${e.is_self_employed ? seLimitBar(seTrans, SE_YEAR_LIMIT) : '<span style="color:var(--t3);font-size:12px">—</span>'}</td>
            <td style="text-align:right">${ratingHtml(e.rating_avg)}</td>
          </tr>`;
      });
    });

    if (!anyRow) {
      tbodyHtml = `<tr><td colspan="10" class="muted" style="text-align:center;padding:32px">
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
            ${canImportSe ? `
              <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap">
                <button class="btn ghost" id="prs_btnImportSe" title="Импортировать месячные остатки СЗ из Excel Озон-Банка">📥 Импорт остатков СЗ</button>
                <span id="prs_seLastImport" class="help" style="font-size:11px;color:var(--t3)"></span>
              </div>` : ''}
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
          <select id="prs_city" class="input" style="min-width:140px">
            <option value="">Город: все</option>
            ${cityOptions}
          </select>
          <select id="prs_pass" class="input" style="min-width:180px">
            <option value="">Пропуска: все</option>
            ${passOptions}
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
                <th style="text-align:center;width:170px" title="БОСИЕТ · РУКАВ · МЛСП · ФСБ">Ключевые допуски</th>
                <th style="width:120px">Город</th>
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
      const cv  = ($('#prs_city')?.value   || '').trim();
      const pv  = ($('#prs_pass')?.value   || '').trim();
      const parts = [];
      if (qv)  parts.push(`q=${encodeURIComponent(qv)}`);
      if (sv)  parts.push(`spec=${encodeURIComponent(sv)}`);
      if (stv) parts.push(`status=${encodeURIComponent(stv)}`);
      if (cv)  parts.push(`city=${encodeURIComponent(cv)}`);
      if (pv)  parts.push(`pass=${encodeURIComponent(pv)}`);
      location.hash = '#/personnel' + (parts.length ? '?' + parts.join('&') : '');
    }

    $('#prs_btnFind')?.addEventListener('click', buildFilter);
    $('#prs_btnReset')?.addEventListener('click', () => { location.hash = '#/personnel'; });
    $('#prs_q')?.addEventListener('keydown', e => { if (e.key === 'Enter') buildFilter(); });
    // 25.06.2026: автоприменение фильтров по городу и пропускам
    $('#prs_city')?.addEventListener('change', buildFilter);
    $('#prs_pass')?.addEventListener('change', buildFilter);

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

    // ── Импорт остатков СЗ (FIN_ROLES) ────────────────────────────────────────
    if (canImportSe) {
      // Подгружаем сведения о последней синхронизации (асинхронно, без блокировки).
      apiFetch('/staff/se-limits/last-import').then(d => {
        const el = $('#prs_seLastImport');
        if (!el) return;
        if (d && d.last_import_at) {
          const when = fmtDate(d.last_import_at);
          const who  = d.last_import_by_fio ? `, ${d.last_import_by_fio}` : '';
          el.textContent = `Последний импорт: ${when}${who}`;
        } else {
          el.textContent = 'Импорта ещё не было';
        }
      }).catch(() => { /* silent — не критично */ });

      $('#prs_btnImportSe')?.addEventListener('click', () => openSeImportModal());
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

  // ─── Модалка импорта остатков СЗ из Excel (FIN_ROLES) ───────────────────────
  // 3 шага: (1) выбор файла → (2) превью + правка решений → (3) применение.
  //
  // Backend (см. src/routes/staff.js, FIN_ROLES_ARRAY):
  //   POST /api/staff/se-limits/preview  (multipart `file`) → { rows, matched, not_matched, monthly_limit, year, month }
  //   POST /api/staff/se-limits/apply    (JSON { year, month, rows:[{action,...}] }) → { updated, created, errors }
  //   GET  /api/staff/se-limits/last-import → { last_import_at, last_import_by_fio }

  function _seActionLabel(act) {
    switch (act) {
      case 'update':       return 'обновить';
      case 'create_se':    return 'создать СЗ';
      case 'create_payee': return 'создать получателя';
      case 'skip':         return 'пропустить';
      default:             return act || '—';
    }
  }

  function _seRowBgClass(act) {
    // Постельные тона — мягкий зелёный / золотой / серый.
    if (act === 'update')                    return 'background:#E8F5E9';
    if (act === 'create_se')                 return 'background:#FFF8E1';
    if (act === 'create_payee')              return 'background:#FFF8E1';
    return 'background:#F5F5F5';
  }

  function _seFmtMoney(n) {
    if (n == null || !isFinite(Number(n))) return '—';
    return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
  }

  function openSeImportModal() {
    // ── Шаг 1: выбор файла ──
    const step1 = `
      <div id="seimp_root">
        <div style="padding:12px 0">
          <div style="font-size:14px;color:var(--t1);margin-bottom:8px">
            Загрузите файл выгрузки из <b>Озон-Банка</b> (формат <code>.xlsx</code>, 3 колонки: Телефон, ФИО, Оставшийся лимит).
          </div>
          <div style="margin-top:14px">
            <label class="btn" style="cursor:pointer;display:inline-block">
              📁 Выбрать файл
              <input type="file" id="seimp_file" accept=".xlsx,.xls" style="display:none">
            </label>
            <span id="seimp_fileName" style="margin-left:10px;font-size:13px;color:var(--t3)">Файл не выбран</span>
          </div>
          <div id="seimp_step1_err" style="margin-top:10px;color:var(--err);font-size:12px;display:none"></div>
          <div style="margin-top:18px;padding:10px 12px;background:var(--bg2);border-radius:var(--r-md);font-size:12.5px;color:var(--t2);line-height:1.55">
            Текущий месячный лимит системы: <b>350 000 ₽</b>.<br>
            Если у СЗ остаток <b>&gt; 350 000 ₽</b> — будет включён <code>can_exceed_limit</code> (банковский потолок выше).
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <button class="btn ghost" id="seimp_cancel">Отмена</button>
          <button class="btn" id="seimp_next" disabled>Далее: предпросмотр →</button>
        </div>
      </div>`;

    showModal({ title: '📥 Импорт остатков СЗ из Excel', html: step1, wide: true });

    let pickedFile = null;
    let previewData = null; // ответ /preview
    let decisions = [];     // решения юзера для apply

    $('#seimp_cancel')?.addEventListener('click', () => closeModal());

    $('#seimp_file')?.addEventListener('change', e => {
      pickedFile = e.target.files && e.target.files[0] ? e.target.files[0] : null;
      const lbl = $('#seimp_fileName');
      if (lbl) lbl.textContent = pickedFile ? pickedFile.name : 'Файл не выбран';
      const nextBtn = $('#seimp_next');
      if (nextBtn) nextBtn.disabled = !pickedFile;
      const errEl = $('#seimp_step1_err');
      if (errEl) errEl.style.display = 'none';
    });

    $('#seimp_next')?.addEventListener('click', async () => {
      if (!pickedFile) return;
      const errEl = $('#seimp_step1_err');
      const btn = $('#seimp_next');
      btn.disabled = true;
      btn.textContent = 'Загружаем…';
      try {
        const fd = new FormData();
        fd.append('file', pickedFile);
        previewData = await apiPostMultipart('/staff/se-limits/preview', fd);
        // Подготовим начальные decisions = suggested_action для непривязанных,
        // 'update' для matched, true для всех чекбоксов.
        decisions = (previewData.rows || []).map(r => {
          if (r.matched) {
            return {
              row_idx: r.row_idx,
              checked: true,
              action: 'update',
              employee_id: r.employee_id,
              employee_fio: r.employee_fio,
              fio: null,
              phone: null,
              remaining: r.remaining_in_file,
              linked_to_employee_id: null,
              _src: r,
            };
          }
          // matched=false
          const sug = r.suggested_action === 'create_new' ? 'create_se' : 'skip';
          return {
            row_idx: r.row_idx,
            checked: sug !== 'skip',
            action: sug,
            employee_id: null,
            employee_fio: null,
            fio: r.fio_raw || '',
            phone: r.phone_raw || '',
            remaining: r.remaining_in_file,
            linked_to_employee_id: null,
            _src: r,
          };
        });
        _renderSeStep2();
      } catch (err) {
        if (errEl) {
          errEl.style.display = '';
          errEl.textContent = err.message || 'Ошибка загрузки файла';
        }
        btn.disabled = false;
        btn.textContent = 'Далее: предпросмотр →';
      }
    });

    // ── Шаг 2: превью и редактирование решений ──
    function _renderSeStep2() {
      const matchedDec = decisions.filter(d => d._src.matched);
      const newDec     = decisions.filter(d => !d._src.matched);
      const limit      = previewData.monthly_limit || 350000;

      // Хелпер для подсветки строки превью (большая разница / can_exceed)
      const renderMatchedRow = (d, i) => {
        const r = d._src;
        const wasCurrent = r.current_monthly_remaining;
        const will       = r.remaining_in_file;
        const wasFmt = wasCurrent == null ? '∞' : _seFmtMoney(wasCurrent);
        const willFmt = will == null ? '—' : _seFmtMoney(will);
        const exceed = will != null && will > limit;
        const bigDiff = wasCurrent != null && will != null &&
          (Math.abs(will - wasCurrent) >= 100000 || (wasCurrent > 0 && Math.abs(will - wasCurrent) / wasCurrent > 0.5));
        const bg = d.checked ? _seRowBgClass(d.action) : 'background:#F5F5F5';
        return `
          <tr data-dec-idx="${i}" style="${bg}">
            <td style="padding:8px;text-align:center">
              <input type="checkbox" class="seimp_chk" data-idx="${i}" ${d.checked ? 'checked' : ''}>
            </td>
            <td style="padding:8px">
              <select class="input seimp_act" data-idx="${i}" style="min-width:140px;font-size:12px;padding:4px 6px">
                <option value="update"      ${d.action === 'update' ? 'selected' : ''}>обновить</option>
                <option value="skip"        ${d.action === 'skip' ? 'selected' : ''}>пропустить</option>
              </select>
            </td>
            <td style="padding:8px;font-size:13px">
              <div style="font-weight:600">${esc(r.employee_fio || '—')}</div>
              ${r.is_se_payee ? '<div style="font-size:10px;color:var(--info);font-weight:700">получатель</div>' : ''}
            </td>
            <td style="padding:8px;font-size:12px;color:var(--t2)">
              <span style="${bigDiff ? 'font-weight:700' : ''}">${wasFmt}</span>
              <span style="color:var(--t3);margin:0 4px">→</span>
              <span style="${bigDiff ? 'font-weight:700;color:var(--t1)' : ''}">${willFmt}</span>
              ${exceed ? '<div style="font-size:11px;color:#BF360C;margin-top:2px">can_exceed_limit включится</div>' : ''}
              ${bigDiff ? '<div style="font-size:10px;color:var(--warn-t);margin-top:2px">⚠ Большая разница</div>' : ''}
            </td>
          </tr>`;
      };

      const renderNewRow = (d, i) => {
        const r = d._src;
        const linkUI = d.action === 'create_payee' ? `
          <div style="margin-top:6px;font-size:12px;color:var(--t3)">└ Привязать к:</div>
          <input class="input seimp_link" data-idx="${i}"
            placeholder="Введите ФИО рабочего…" style="font-size:12px;padding:4px 8px;margin-top:2px"
            value="${esc(d.linked_to_employee_fio || '')}" autocomplete="off">
          <input type="hidden" class="seimp_link_id" data-idx="${i}" value="${d.linked_to_employee_id || ''}">
          <div class="seimp_link_results" data-idx="${i}" style="margin-top:2px;font-size:11px"></div>
        ` : '';
        const bg = d.checked ? _seRowBgClass(d.action) : 'background:#F5F5F5';
        const exceed = d.remaining != null && d.remaining > limit;
        const remFmt = d.remaining == null ? '—' : _seFmtMoney(d.remaining);
        return `
          <tr data-dec-idx="${i}" style="${bg}">
            <td style="padding:8px;text-align:center;vertical-align:top">
              <input type="checkbox" class="seimp_chk" data-idx="${i}" ${d.checked ? 'checked' : ''}>
            </td>
            <td style="padding:8px;vertical-align:top">
              <select class="input seimp_act" data-idx="${i}" style="min-width:180px;font-size:12px;padding:4px 6px">
                <option value="create_se"    ${d.action === 'create_se' ? 'selected' : ''}>создать СЗ</option>
                <option value="create_payee" ${d.action === 'create_payee' ? 'selected' : ''}>создать получателя + привязать</option>
                <option value="skip"         ${d.action === 'skip' ? 'selected' : ''}>пропустить</option>
              </select>
              ${linkUI}
            </td>
            <td style="padding:8px;font-size:13px;vertical-align:top">
              <input class="input seimp_fio" data-idx="${i}" value="${esc(d.fio || '')}" placeholder="ФИО" style="font-size:12px;padding:4px 6px;width:100%">
              <input class="input seimp_phone" data-idx="${i}" value="${esc(d.phone || '')}" placeholder="Телефон" style="font-size:12px;padding:4px 6px;width:100%;margin-top:4px">
            </td>
            <td style="padding:8px;font-size:12px;color:var(--t2);vertical-align:top">
              ${remFmt}
              ${exceed ? '<div style="font-size:11px;color:#BF360C;margin-top:2px">can_exceed_limit включится</div>' : ''}
            </td>
          </tr>`;
      };

      const matchedHtml = matchedDec.length ? `
        <div style="margin-top:18px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--t3);font-weight:800">
          ✅ Найдены в БД (${matchedDec.length})
        </div>
        <table class="asg" style="width:100%;margin-top:6px;font-size:12.5px">
          <thead>
            <tr style="background:var(--bg2)">
              <th style="width:34px;text-align:center;padding:6px">✓</th>
              <th style="width:160px;padding:6px">Действие</th>
              <th style="padding:6px">ФИО</th>
              <th style="padding:6px">Было → Стало</th>
            </tr>
          </thead>
          <tbody>${matchedDec.map((d, i) => renderMatchedRow(d, decisions.indexOf(d))).join('')}</tbody>
        </table>
      ` : '';

      const newHtml = newDec.length ? `
        <div style="margin-top:22px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--t3);font-weight:800">
          ➕ Не найдены в БД (${newDec.length})
        </div>
        <table class="asg" style="width:100%;margin-top:6px;font-size:12.5px">
          <thead>
            <tr style="background:var(--bg2)">
              <th style="width:34px;text-align:center;padding:6px">✓</th>
              <th style="width:200px;padding:6px">Действие</th>
              <th style="padding:6px">ФИО / Телефон</th>
              <th style="padding:6px">Остаток в файле</th>
            </tr>
          </thead>
          <tbody>${newDec.map((d, i) => renderNewRow(d, decisions.indexOf(d))).join('')}</tbody>
        </table>
      ` : '';

      const html = `
        <div id="seimp_root">
          <div class="row" style="gap:14px;flex-wrap:wrap;align-items:baseline;padding:6px 0 10px;border-bottom:1px solid var(--brd)">
            <div style="font-size:13px;color:var(--t2)">Файл: <b>${esc(previewData.file_name || '—')}</b></div>
            <div style="font-size:13px;color:var(--t2)">Найдено в БД: <b>${previewData.matched}</b></div>
            <div style="font-size:13px;color:var(--t2)">Новые: <b>${previewData.not_matched}</b></div>
            <div style="font-size:13px;color:var(--t2)">Всего: <b>${previewData.total_rows}</b></div>
            <div style="margin-left:auto;font-size:12px;color:var(--t3)">Лимит: ${_seFmtMoney(limit)} · период: ${previewData.month}/${previewData.year}</div>
          </div>
          <div style="max-height:60vh;overflow:auto;padding-right:4px">
            ${matchedHtml}
            ${newHtml}
            ${(!matchedDec.length && !newDec.length)
              ? '<div class="muted" style="padding:24px;text-align:center">Файл не содержит строк для обработки</div>'
              : ''}
          </div>
          <div style="display:flex;justify-content:space-between;gap:8px;margin-top:14px">
            <button class="btn ghost" id="seimp_back">◄ Назад</button>
            <div class="row" style="gap:8px">
              <button class="btn ghost" id="seimp_cancel2">Отмена</button>
              <button class="btn" id="seimp_apply">Применить →</button>
            </div>
          </div>
        </div>`;

      // Заменяем тело модалки (не открываем новую — overlay уже есть)
      const overlay = document.querySelectorAll('.cr-m-overlay');
      const body = overlay.length ? overlay[overlay.length - 1].querySelector('#modalBody') : null;
      if (body) body.innerHTML = html;

      // ── Обработчики решений ──
      $$('.seimp_chk').forEach(el => el.addEventListener('change', e => {
        const i = Number(e.target.dataset.idx);
        decisions[i].checked = e.target.checked;
        if (!e.target.checked) decisions[i].action = 'skip';
        else if (decisions[i].action === 'skip') {
          decisions[i].action = decisions[i]._src.matched ? 'update' : 'create_se';
        }
        _renderSeStep2();
      }));
      $$('.seimp_act').forEach(el => el.addEventListener('change', e => {
        const i = Number(e.target.dataset.idx);
        decisions[i].action = e.target.value;
        decisions[i].checked = e.target.value !== 'skip';
        _renderSeStep2();
      }));
      $$('.seimp_fio').forEach(el => el.addEventListener('input', e => {
        const i = Number(e.target.dataset.idx);
        decisions[i].fio = e.target.value;
      }));
      $$('.seimp_phone').forEach(el => el.addEventListener('input', e => {
        const i = Number(e.target.dataset.idx);
        decisions[i].phone = e.target.value;
      }));
      // Подсказки для «привязать к рабочему» (только для create_payee).
      $$('.seimp_link').forEach(el => {
        let timer = null;
        el.addEventListener('input', e => {
          const i = Number(e.target.dataset.idx);
          const q = e.target.value.trim();
          decisions[i].linked_to_employee_fio = q;
          // если очистили — обнуляем id
          if (!q) {
            decisions[i].linked_to_employee_id = null;
            document.querySelector(`.seimp_link_id[data-idx="${i}"]`).value = '';
            document.querySelector(`.seimp_link_results[data-idx="${i}"]`).innerHTML = '';
            return;
          }
          if (q.length < 2) return;
          clearTimeout(timer);
          timer = setTimeout(async () => {
            try {
              const d = await apiFetch(`/staff/readiness`);
              // Берём не-СЗ рабочих с похожим ФИО (родственники-получатели обычно для рабочих).
              const matches = (d.employees || []).filter(emp =>
                !emp.is_self_employed &&
                (emp.fio || '').toLowerCase().includes(q.toLowerCase())
              ).slice(0, 6);
              const box = document.querySelector(`.seimp_link_results[data-idx="${i}"]`);
              if (!box) return;
              if (!matches.length) {
                box.innerHTML = '<span style="color:var(--t3);font-size:11px">— нет совпадений —</span>';
                return;
              }
              box.innerHTML = matches.map(m =>
                `<div class="seimp_link_opt" data-idx="${i}" data-id="${m.id}" data-fio="${esc(m.fio)}"
                  style="padding:3px 6px;cursor:pointer;border-radius:var(--r-sm);font-size:11.5px"
                  onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
                  ${esc(m.fio)} <span style="color:var(--t3)">${esc(m.phone || '')}</span>
                </div>`).join('');
              box.querySelectorAll('.seimp_link_opt').forEach(opt => {
                opt.addEventListener('click', () => {
                  const idx = Number(opt.dataset.idx);
                  decisions[idx].linked_to_employee_id = Number(opt.dataset.id);
                  decisions[idx].linked_to_employee_fio = opt.dataset.fio;
                  document.querySelector(`.seimp_link[data-idx="${idx}"]`).value = opt.dataset.fio;
                  document.querySelector(`.seimp_link_id[data-idx="${idx}"]`).value = opt.dataset.id;
                  box.innerHTML = `<span style="color:var(--ok);font-size:11px">✓ Привязано к id=${opt.dataset.id}</span>`;
                });
              });
            } catch (_) { /* silent */ }
          }, 280);
        });
      });

      $('#seimp_back')?.addEventListener('click', () => {
        // Назад на step1 — переоткрываем модалку.
        closeModal();
        setTimeout(() => openSeImportModal(), 50);
      });
      $('#seimp_cancel2')?.addEventListener('click', () => closeModal());
      $('#seimp_apply')?.addEventListener('click', _onSeApply);
    }

    // ── Шаг 3: применение ──
    async function _onSeApply() {
      // Собираем payload: только включённые строки.
      const rows = decisions
        .filter(d => d.checked && d.action !== 'skip')
        .map(d => {
          const out = { action: d.action };
          if (d.action === 'update') {
            out.employee_id = d.employee_id;
            out.remaining = d.remaining;
          } else if (d.action === 'create_se' || d.action === 'create_payee') {
            out.fio = (d.fio || '').trim();
            if (d.phone) out.phone = (d.phone || '').trim() || null;
            if (d.remaining != null) out.remaining = d.remaining;
            if (d.action === 'create_payee' && d.linked_to_employee_id) {
              out.linked_to_employee_id = Number(d.linked_to_employee_id);
            }
          }
          return out;
        });

      if (!rows.length) {
        toast('Нет изменений', 'Все строки помечены «пропустить». Включите хотя бы одну.', 'err');
        return;
      }

      const applyBtn = $('#seimp_apply');
      if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Применяем…'; }
      try {
        const result = await apiPost('/staff/se-limits/apply', {
          year:  previewData.year,
          month: previewData.month,
          rows,
        });
        const errCount = (result.errors || []).length;
        const okMsg = `Обновлено: ${result.updated || 0}, создано: ${result.created || 0}`;
        if (errCount > 0) {
          // Покажем сводку с ошибками.
          const errLines = (result.errors || []).slice(0, 10)
            .map(e => `<div>• row #${e.idx}: ${esc(e.error || '')}</div>`).join('');
          showModal({
            title: 'Импорт завершён частично',
            html: `
              <div style="padding:8px 0">
                <div style="font-size:14px;color:var(--ok);margin-bottom:8px">${okMsg}</div>
                <div style="font-size:13px;color:var(--err);margin-bottom:6px">Ошибки (${errCount}):</div>
                <div style="max-height:280px;overflow:auto;font-size:12px;color:var(--t2);padding:8px;background:var(--bg2);border-radius:var(--r-sm)">${errLines}</div>
                <div style="display:flex;justify-content:flex-end;margin-top:14px">
                  <button class="btn" id="seimp_doneOk">Закрыть</button>
                </div>
              </div>`
          });
          $('#seimp_doneOk')?.addEventListener('click', () => {
            closeModal(); closeModal();
            window.dispatchEvent(new CustomEvent('asgard:personnel:changed'));
            // Обновляем «последняя синхронизация» в шапке без релоада.
            location.hash = '#/personnel';
          });
        } else {
          toast('Готово', okMsg, 'ok');
          closeModal();
          window.dispatchEvent(new CustomEvent('asgard:personnel:changed'));
          // Принудительный реренд (наша страница перечитает данные на hashchange'е этой же страницы).
          const cur = location.hash;
          location.hash = '#/personnel?t=' + Date.now();
          setTimeout(() => { location.hash = cur || '#/personnel'; }, 60);
        }
      } catch (err) {
        toast('Ошибка применения', err.message || 'Не удалось применить', 'err');
        if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = 'Применить →'; }
      }
    }
  }

  // ─── Публичный API ────────────────────────────────────────────────────────────

  return { render, openStatusModal, openSeImportModal };
})();
