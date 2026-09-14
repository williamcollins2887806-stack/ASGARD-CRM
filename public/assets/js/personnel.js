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

  const { $, $$, esc, toast, showModal, closeModal, copyToClipboard } = AsgardUI;
  const isDirRole = (r) =>
    (window.AsgardAuth && AsgardAuth.isDirectorRole)
      ? AsgardAuth.isDirectorRole(r)
      : (String(r || '') === 'DIRECTOR' || String(r || '').startsWith('DIRECTOR_'));

  // ─── Константы ──────────────────────────────────────────────────────────────

  // ALLOWED_ROLES = просмотр (read) страницы «Дружина». Должен совпадать с ролями роута /personnel в app.js.
  // PM/HEAD_PM видят всю дружину на десктопе (свою бригаду РП видит в полевом модуле, вкладка «Бригада»).
  const ALLOWED_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'PM', 'HEAD_PM', 'OFFICE_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'TO', 'HEAD_TO'];
  // EDIT_ROLES = редактирование анкеты / «+ Добавить».
  // FIX (23.06.2026): HEAD_PM (руководитель РП) и OFFICE_MANAGER (офис-менеджер) — могут править
  // контактные/паспортные данные и добавлять новых. Финансовые поля и статус увольнения остаются под HR/директорами
  // (см. employee.js: canEditFinance / canEditHrSensitive).
  // PM анкету не правит — только статус готовности (READINESS_EDIT_ROLES).
  const EDIT_ROLES    = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'HEAD_PM', 'OFFICE_MANAGER', 'TO', 'HEAD_TO'];
  // READINESS_EDIT_ROLES — смена ready/not_ready/… (зеркало backend READINESS_ROLES).
  const READINESS_EDIT_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'HEAD_PM', 'OFFICE_MANAGER', 'TO', 'HEAD_TO', 'PM'];
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
    { code: 'unknown',   label: 'Без статуса', bgVar: '--bg2',    tVar: '--t2'      },
    { code: 'planned',   label: 'В плане',    bgVar: '--info-bg', tVar: '--info-t'  },
    { code: 'on_mlsp',   label: 'На МЛСП',    bgVar: '--warn-bg', tVar: '--warn-t'  },
    { code: 'archive',   label: 'Архив',      bgVar: '--bg3',     tVar: '--t3'      },
  ];
  const TABLE_STATUSES = STATUSES.filter(s => s.code !== 'planned' && s.code !== 'on_mlsp');
  const MLSP_WRITE_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'OFFICE_MANAGER', 'HEAD_TO',
    'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM'];

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
    return (AsgardUI.moneyRub || AsgardMoney.formatMoney)(n);
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

  /** Чип в списке Дружины: смена паспорта РФ в 20 и 45 (+90 дн.). Только warn/urgent/overdue. */
  function parseFlexibleDate(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim();
    if (!s) return null;
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return toYmdParts(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})\b/.exec(s);
    if (m) {
      let y = +m[3];
      if (y < 100) y += y <= 30 ? 2000 : 1900;
      return toYmdParts(y, +m[2], +m[1]);
    }
    const digits = s.replace(/\D/g, '');
    if (digits.length === 8) {
      const a = toYmdParts(+digits.slice(0, 4), +digits.slice(4, 6), +digits.slice(6, 8));
      if (a) return a;
      return toYmdParts(+digits.slice(4, 8), +digits.slice(2, 4), +digits.slice(0, 2));
    }
    return null;
  }
  function toYmdParts(y, mo, d) {
    if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  function ageFromBirth(birthDate) {
    const ymd = parseFlexibleDate(birthDate);
    if (!ymd) return null;
    const [y, m, d] = ymd.split('-').map(Number);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let age = today.getFullYear() - y;
    if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
    if (age < 0 || age > 130) return null;
    return age;
  }
  function pluralYears(n) {
    const abs = Math.abs(n) % 100, n1 = abs % 10;
    if (abs > 10 && abs < 20) return 'лет';
    if (n1 === 1) return 'год';
    if (n1 >= 2 && n1 <= 4) return 'года';
    return 'лет';
  }
  function umoChipHtml(emp) {
    const age = ageFromBirth(emp.birth_date);
    if (age == null || age < 45) return '';
    return `<span class="prs-chip prs-chip--umo" title="Возраст ${age} лет — этому рабочему требуется УМО (информационно)">УМО · 45+</span>`;
  }

  function fmtPrsPhone(raw) {
    if (!raw) return '';
    const M = window.AsgardRuMasks;
    const digits = (M && typeof M.normalizeRuPhoneDigits === 'function')
      ? M.normalizeRuPhoneDigits(raw)
      : String(raw).replace(/\D/g, '');
    if (digits.length === 11 && digits[0] === '7') {
      return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
    }
    if (M && typeof M.formatRuPhoneDisplay === 'function') {
      const f = M.formatRuPhoneDisplay(raw);
      if (f) return f;
    }
    return String(raw);
  }

  const COPY_ICON_SVG = '<svg class="asg-copy-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
  const COPY_DONE_SVG = '<svg class="asg-copy-btn__done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
  const PHONE_ICON_SVG = '<svg class="prs-id-phone-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.4"/><path d="M10.5 5h3"/><path d="M10 18.5h4"/></svg>';

  function markCopyBtn(btn) {
    if (!btn) return;
    btn.classList.add('is-copied');
    btn.setAttribute('title', 'Скопировано');
    clearTimeout(btn._copiedTimer);
    btn._copiedTimer = setTimeout(() => {
      btn.classList.remove('is-copied');
      btn.setAttribute('title', 'Копировать');
    }, 1400);
  }

  function passportAgeChipHtml(emp) {
    function parseYmd(v) {
      if (!v) return null;
      const s = String(v).slice(0, 10);
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) return null;
      return new Date(+m[1], +m[2] - 1, +m[3]);
    }
    function addYears(d, y) {
      const x = new Date(d.getFullYear() + y, d.getMonth(), d.getDate());
      if (x.getMonth() !== d.getMonth()) return new Date(d.getFullYear() + y, d.getMonth() + 1, 0);
      return x;
    }
    function addDays(d, n) { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
    function fmt(d) {
      return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
    }
    const birth = parseYmd(emp.birth_date);
    const issued = parseYmd(emp.passport_date);
    if (!birth || !issued) return '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d20 = addYears(birth, 20), d45 = addYears(birth, 45);
    const deadlines = [];
    if (issued < d20) deadlines.push({ at: addDays(d20, 90), m: 20 });
    if (issued < d45) deadlines.push({ at: addDays(d45, 90), m: 45 });
    if (!deadlines.length) return '';
    const upcoming = deadlines.filter(x => x.at >= today).sort((a, b) => a.at - b.at);
    const t = upcoming[0] || deadlines.sort((a, b) => b.at - a.at)[0];
    const days = Math.round((t.at - today) / 86400000);
    let label = '';
    if (days < 0) {
      label = `Паспорт просрочен (${t.m})`;
    } else if (days <= 90) {
      label = `Паспорт до ${fmt(t.at)}`;
    } else if (days <= 180) {
      label = `Паспорт ~ ${fmt(t.at)}`;
    } else {
      return '';
    }
    const toneCls = days < 0 ? 'prs-chip--danger' : (days <= 90 ? 'prs-chip--warn' : 'prs-chip--gold');
    const hint = days < 0
      ? `Смена паспорта в ${t.m} лет (+90 дн.). Срок истёк.`
      : `В РФ паспорт меняют в 20 и 45 лет (+90 дн.). Осталось ${days} дн.`;
    return `<span class="prs-chip ${toneCls}" title="${esc(hint)}">${esc(label)}</span>`;
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

  /** Кнопка копирования ячейки (не открывает карточку) */
  function prsCopyBtn(text) {
    const t = String(text || '').trim();
    if (!t || t === '—') return '';
    return `<button type="button" class="asg-copy-btn prs-copy" data-copy="${esc(t)}" title="Копировать" aria-label="Копировать">${COPY_ICON_SVG}${COPY_DONE_SVG}</button>`;
  }

  function prsCopyWrap(innerHtml, copyText) {
    return `<div class="prs-copy-cell" style="display:flex;align-items:flex-start;gap:2px;justify-content:space-between">` +
      `<div style="min-width:0;flex:1">${innerHtml}</div>${prsCopyBtn(copyText)}</div>`;
  }

  function prsPhoneLine(raw) {
    const phone = String(raw || '').trim();
    if (!phone) return '';
    return `<div class="prs-id-phone">` +
      `<span class="prs-id-phone-ic" aria-hidden="true">${PHONE_ICON_SVG}</span>` +
      `<span class="prs-id-phone-num">${esc(fmtPrsPhone(phone))}</span>` +
      `${prsCopyBtn(phone)}</div>`;
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

  function sizSizesHtml(e) {
    const parts = [];
    if (e.clothing_size) parts.push(`<div style="font-size:11px;color:var(--t2)"><span title="Одежда">👕</span> ${esc(e.clothing_size)}</div>`);
    if (e.shoe_size) parts.push(`<div style="font-size:11px;color:var(--t2)"><span title="Обувь">👟</span> ${esc(e.shoe_size)}</div>`);
    if (e.headwear_size) parts.push(`<div style="font-size:11px;color:var(--t2)"><span title="Головной убор">⛑</span> ${esc(e.headwear_size)}</div>`);
    return parts.length ? parts.join('') : '<span style="color:var(--t3)">—</span>';
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
    const viewMode = (function () {
      try { return localStorage.getItem('prs-view') || 'list'; } catch (_) { return 'list'; }
    })();

    // ── Загрузка данных ────────────────────────────────────────────────────────
    let employees = [];
    let groups    = { on_site: 0, approved: 0, ready: 0, not_ready: 0, unknown: 0, archive: 0, planned: 0, on_mlsp: 0 };

    try {
      const data = await apiFetch('/staff/readiness');
      employees = data.employees || [];
      groups    = data.groups    || groups;
    } catch (e) {
      toast('Ошибка загрузки', e.message, 'err');
    }

    const canWriteMlsp = MLSP_WRITE_ROLES.includes(user.role) || isDirRole(user.role);
    const qMlspSeg = (query.mlsp_seg || 'all').trim();

    // Справочник специальностей (уникальные role_tag, без дублей по регистру)
    const specialties = [...new Set(
      employees.map(e => {
        const t = (e.role_tag || '').trim();
        if (!t) return '';
        return t === 'РП' ? 'РП' : t.toLowerCase();
      }).filter(Boolean)
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
      rows = rows.filter(e => {
        const t = (e.role_tag || '').trim();
        if (qSpec === 'РП') return t === 'РП';
        return t.toLowerCase() === qSpec.toLowerCase();
      });
    }
    if (qStatus === 'planned') {
      rows = rows.filter(e => !!e.planned_info);
    } else if (qStatus === 'on_mlsp') {
      rows = rows.filter(e => !!e.mlsp_stay);
      if (qMlspSeg === 'd14') rows = rows.filter(e => e.mlsp_stay.is_open && e.mlsp_stay.days_left != null && e.mlsp_stay.days_left <= 14);
      else if (qMlspSeg === 'd7') rows = rows.filter(e => e.mlsp_stay.is_open && e.mlsp_stay.days_left != null && e.mlsp_stay.days_left <= 7);
      else if (qMlspSeg === 'over') rows = rows.filter(e => e.mlsp_stay.is_overdue);
      else if (qMlspSeg === 'left') rows = rows.filter(e => !e.mlsp_stay.is_open);
    } else if (qStatus) {
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

    // Сортировка: on_site → approved → ready → not_ready → unknown → archive → прочие, внутри — ФИО
    const statusOrder = { on_site: 0, approved: 1, ready: 2, not_ready: 3, unknown: 4, archive: 5 };
    rows.sort((a, b) => {
      const sa = statusOrder[a.effective_status] ?? 9;
      const sb = statusOrder[b.effective_status] ?? 9;
      if (sa !== sb) return sa - sb;
      return (a.fio || '').localeCompare(b.fio || '', 'ru');
    });

    // ── Статусные группы для секций таблицы ───────────────────────────────────
    const grouped = {};
    TABLE_STATUSES.forEach(s => { grouped[s.code] = []; });
    rows.forEach(e => {
      const st = e.effective_status || e.readiness_status || 'unknown';
      if (grouped[st]) grouped[st].push(e);
      else if (grouped['unknown']) grouped['unknown'].push(e);
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
      const cnt = s.code === 'planned' ? (groups.planned || 0)
        : s.code === 'on_mlsp' ? (groups.on_mlsp || 0)
          : (groups[s.code] || 0);
      const active = qStatus === s.code ? 'outline:2px solid var(--accent);' : '';
      return `<button class="btn-status-badge" data-status="${s.code}"
        style="background:var(${s.bgVar});color:var(${s.tVar});border:none;border-radius:var(--r-md);
               padding:8px 14px;cursor:pointer;${active}transition:opacity .15s">
        <div style="font-size:22px;font-weight:800;line-height:1">${cnt}</div>
        <div style="font-size:11px;opacity:.85;margin-top:2px">${esc(s.label)}</div>
      </button>`;
    }).join('');

    function mlspChipTone(stay) {
      if (!stay || !stay.is_open) return { bg: 'var(--bg3)', fg: 'var(--t3)' };
      if (stay.is_overdue || (stay.days_left != null && stay.days_left <= 7)) return { bg: 'var(--err-bg)', fg: 'var(--err)' };
      if (stay.days_left != null && stay.days_left <= 14) return { bg: 'var(--warn-bg)', fg: 'var(--warn-t)' };
      return { bg: 'var(--ok-bg)', fg: 'var(--ok)' };
    }
    function mlspTodayYmd() {
      try {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date());
      } catch (_) {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }
    }
    function mlspChipHtml(stay, empId) {
      if (!stay || !stay.is_open) return '';
      const toneCls = stay.is_overdue || (stay.days_left != null && stay.days_left <= 7)
        ? 'prs-chip--danger'
        : (stay.days_left != null && stay.days_left <= 14)
          ? 'prs-chip--warn'
          : 'prs-chip--ok';
      return `<button type="button" class="prs-chip prs-chip--mlsp ${toneCls} prs-mlsp-chip-btn" data-emp-id="${empId || ''}" title="Фильтр «На МЛСП»">МЛСП · ${stay.days_on_platform ?? '—'} дн</button>`;
    }

    function prsIdentityCell(e) {
      const fio = e.fio || '—';
      const chips = [umoChipHtml(e), passportAgeChipHtml(e), mlspChipHtml(e.mlsp_stay, e.id)].filter(Boolean).join('');
      return `<div class="prs-id">` +
        `<div class="prs-id-head"><div class="prs-id-name">${esc(fio)}</div>${prsCopyBtn(e.fio || '')}</div>` +
        prsPhoneLine(e.phone) +
        (chips ? `<div class="prs-id-chips">${chips}</div>` : '') +
        `</div>`;
    }

    async function mlspAction(path, body) {
      const r = await fetch('/api/staff/mlsp-stays/' + path, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify(body || {})
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
      return data;
    }

    function findStayById(stayId) {
      const emp = employees.find(e => e.mlsp_stay && String(e.mlsp_stay.id) === String(stayId));
      return emp ? { emp, stay: emp.mlsp_stay } : null;
    }

    function openMlspExtendModal(stayId) {
      const found = findStayById(stayId);
      if (!found) return;
      const { emp, stay } = found;
      const min = stay.planned_depart_at ? String(stay.planned_depart_at).slice(0, 10) : '';
      showModal({
        title: 'Продлить — ' + (emp.fio || ''),
        html: `
          <p class="help" style="margin:0 0 12px">
            Сейчас вывоз: <b>${esc(fmtDate(stay.planned_depart_at))}</b>
            ${stay.days_on_platform != null ? ' · на платформе ' + stay.days_on_platform + ' дн.' : ''}.
            Счётчик дней с заезда не сбрасывается.
          </p>
          <div class="formrow">
            <div style="grid-column:1/-1">
              <label>Новая дата вывоза</label>
              <input type="date" id="mlsp_ext_date" class="input" min="${esc(min)}" />
            </div>
            <div style="grid-column:1/-1">
              <label>Заметка (необязательно)</label>
              <textarea id="mlsp_ext_note" class="input" rows="2" placeholder="Согласовано с начальником МЛСП…"></textarea>
            </div>
          </div>
          <div class="row" style="gap:8px;justify-content:flex-end;margin-top:14px">
            <button type="button" class="btn ghost" id="mlsp_ext_cancel">Отмена</button>
            <button type="button" class="btn" id="mlsp_ext_save">Продлить</button>
          </div>
        `,
        onMount: ({ body }) => {
          body.querySelector('#mlsp_ext_cancel')?.addEventListener('click', () => closeModal());
          body.querySelector('#mlsp_ext_save')?.addEventListener('click', async () => {
            const date = body.querySelector('#mlsp_ext_date')?.value || '';
            const note = (body.querySelector('#mlsp_ext_note')?.value || '').trim() || null;
            if (!date) { toast('Ошибка', 'Укажите новую дату вывоза', 'err'); return; }
            if (min && date <= min) { toast('Ошибка', 'Дата должна быть позже текущей плановой', 'err'); return; }
            try {
              await mlspAction(stayId + '/extend', { planned_depart_at: date, note });
              toast('Ок', 'Вывоз продлён', 'ok');
              closeModal();
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            } catch (e) { toast('Ошибка', e.message, 'err'); }
          });
        }
      });
    }

    function openMlspDepartModal(stayId) {
      const found = findStayById(stayId);
      if (!found) return;
      const { emp, stay } = found;
      const today = mlspTodayYmd();
      showModal({
        title: 'Съехал — ' + (emp.fio || ''),
        html: `
          <p class="help" style="margin:0 0 12px">
            Закроет вахту и все активные назначения на работах МЛСП.
          </p>
          <div class="formrow">
            <div>
              <label>Дата съезда</label>
              <input type="date" id="mlsp_dep_date" class="input" max="${esc(today)}" value="${esc(today)}" />
            </div>
            <div>
              <label>Чем вывезли</label>
              <select id="mlsp_dep_tr" class="input">
                <option value="">— не указано —</option>
                <option value="helicopter"${stay.transport === 'helicopter' ? ' selected' : ''}>Вертолёт</option>
                <option value="ship"${stay.transport === 'ship' ? ' selected' : ''}>Корабль</option>
              </select>
            </div>
          </div>
          <div class="row" style="gap:8px;justify-content:flex-end;margin-top:14px">
            <button type="button" class="btn ghost" id="mlsp_dep_cancel">Отмена</button>
            <button type="button" class="btn" id="mlsp_dep_save">Съехал</button>
          </div>
        `,
        onMount: ({ body }) => {
          body.querySelector('#mlsp_dep_cancel')?.addEventListener('click', () => closeModal());
          body.querySelector('#mlsp_dep_save')?.addEventListener('click', async () => {
            const date = body.querySelector('#mlsp_dep_date')?.value || '';
            const transport = body.querySelector('#mlsp_dep_tr')?.value || null;
            if (!date) { toast('Ошибка', 'Укажите дату съезда', 'err'); return; }
            if (date > today) { toast('Ошибка', 'Дата не позже сегодня', 'err'); return; }
            try {
              await mlspAction(stayId + '/depart', { actual_departed_at: date, transport: transport || null });
              toast('Ок', 'Съезд отмечен', 'ok');
              closeModal();
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            } catch (e) { toast('Ошибка', e.message, 'err'); }
          });
        }
      });
    }

    function openMlspReopenModal(stayId) {
      const found = findStayById(stayId);
      if (!found) return;
      const { emp, stay } = found;
      showModal({
        title: 'Вернуть на платформу — ' + (emp.fio || ''),
        html: `
          <p class="help" style="margin:0 0 12px">
            Автовыезд ${esc(fmtDate(stay.actual_departed_at))}. Откроем stay снова и снимем дату убытия с назначений МЛСП.
          </p>
          <div class="row" style="gap:8px;justify-content:flex-end;margin-top:14px">
            <button type="button" class="btn ghost" id="mlsp_reo_cancel">Отмена</button>
            <button type="button" class="btn" id="mlsp_reo_save">Вернуть</button>
          </div>
        `,
        onMount: ({ body }) => {
          body.querySelector('#mlsp_reo_cancel')?.addEventListener('click', () => closeModal());
          body.querySelector('#mlsp_reo_save')?.addEventListener('click', async () => {
            try {
              await mlspAction(stayId + '/reopen', {});
              toast('Ок', 'Вернули на платформу', 'ok');
              closeModal();
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            } catch (e) { toast('Ошибка', e.message, 'err'); }
          });
        }
      });
    }

    function openMlspExportModal() {
      const today = mlspTodayYmd();
      const d = new Date(today + 'T12:00:00');
      d.setUTCMonth(d.getUTCMonth() - 3);
      const defaultFrom = d.toISOString().slice(0, 10);
      const clampAsOf = (from, to, asOf) => {
        if (!asOf) return to || today;
        if (from && asOf < from) return from;
        if (to && asOf > to) return to;
        return asOf;
      };
      showModal({
        title: 'Excel — график перевахтовки МЛСП',
        html: `
          <p class="help" style="margin:0 0 12px">
            Один лист: кто на платформе, проект, заезд/транспорт и календарь смен (11 ч) / дороги / корабля / вертолёта.
            Колонка «На дату» — сколько дней человек уже на МЛСП (или «уехал» / «планируемый заезд»).
          </p>
          <div class="formrow">
            <div>
              <label>Период с</label>
              <input type="date" id="mlsp_exp_from" class="input" value="${esc(defaultFrom)}" />
            </div>
            <div>
              <label>Период по</label>
              <input type="date" id="mlsp_exp_to" class="input" value="${esc(today)}" />
            </div>
            <div>
              <label>На дату</label>
              <input type="date" id="mlsp_exp_asof" class="input" value="${esc(today)}" />
            </div>
          </div>
          <div class="row" style="gap:8px;justify-content:flex-end;margin-top:14px">
            <button type="button" class="btn ghost" id="mlsp_exp_cancel">Отмена</button>
            <button type="button" class="btn" id="mlsp_exp_go">Скачать Excel</button>
          </div>
        `,
        onMount: ({ body }) => {
          const syncAsOf = () => {
            const from = body.querySelector('#mlsp_exp_from')?.value || '';
            const to = body.querySelector('#mlsp_exp_to')?.value || '';
            const asEl = body.querySelector('#mlsp_exp_asof');
            if (!asEl) return;
            asEl.value = clampAsOf(from, to, asEl.value || today);
            if (from) asEl.min = from;
            if (to) asEl.max = to;
          };
          body.querySelector('#mlsp_exp_from')?.addEventListener('change', syncAsOf);
          body.querySelector('#mlsp_exp_to')?.addEventListener('change', syncAsOf);
          syncAsOf();
          body.querySelector('#mlsp_exp_cancel')?.addEventListener('click', () => closeModal());
          body.querySelector('#mlsp_exp_go')?.addEventListener('click', async () => {
            const from = body.querySelector('#mlsp_exp_from')?.value || '';
            const to = body.querySelector('#mlsp_exp_to')?.value || '';
            let asOf = body.querySelector('#mlsp_exp_asof')?.value || '';
            if (!from || !to) { toast('Период', 'Укажите обе даты периода', 'warn'); return; }
            if (from > to) { toast('Период', 'Дата «с» не позже «по»', 'warn'); return; }
            asOf = clampAsOf(from, to, asOf || to);
            if (asOf < from || asOf > to) {
              toast('На дату', 'Дата должна быть внутри периода', 'warn');
              return;
            }
            const btn = body.querySelector('#mlsp_exp_go');
            if (btn) { btn.disabled = true; btn.textContent = 'Формируем…'; }
            try {
              const r = await fetch('/api/staff/mlsp-stays/export', {
                method: 'POST',
                headers: authHeaders(true),
                body: JSON.stringify({ from, to, as_of: asOf })
              });
              if (!r.ok) {
                const j = await r.json().catch(() => ({}));
                throw new Error(j.error || ('HTTP ' + r.status));
              }
              const blob = await r.blob();
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `perevahtovka_${from}_${to}_na_${asOf}.xlsx`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(a.href);
              toast('Готово', 'График перевахтовки скачан', 'ok');
              closeModal();
            } catch (e) {
              toast('Ошибка', e.message, 'err');
            } finally {
              if (btn) { btn.disabled = false; btn.textContent = 'Скачать Excel'; }
            }
          });
        }
      });
    }

    // Строки таблицы по секциям
    let tbodyHtml = '';
    let anyRow = false;
    const isMlspView = qStatus === 'on_mlsp';
    const focusEmpId = (query.focus_emp || '').trim();

    if (isMlspView) {
      anyRow = rows.length > 0;
      tbodyHtml += `<tr><td colspan="9" style="background:var(--warn-bg);color:var(--warn-t);font-weight:700;font-size:12px;padding:6px 12px;border:none">
        НА МЛСП · ${rows.length}
      </td></tr>`;
      rows.forEach(e => {
        const stay = e.mlsp_stay;
        const active = e.on_site_info || e.approved_info || e.last_assignment_info || null;
        const workTitle = active ? (active.work_title || '') : '';
        const pmName = active ? (active.pm_name || '') : '';
        const tone = mlspChipTone(stay);
        const left = stay?.days_left;
        const transportSel = stay ? `<select class="prs-mlsp-tr" data-stay-id="${stay.id}" ${(!canWriteMlsp || !stay.is_open) ? 'disabled' : ''}
          onclick="event.stopPropagation()" style="font-size:12px;padding:3px 4px;border-radius:4px;border:1px solid var(--brd);background:var(--bg2);color:var(--t1)">
          <option value="">—</option>
          <option value="helicopter"${stay.transport === 'helicopter' ? ' selected' : ''}>Вертолёт</option>
          <option value="ship"${stay.transport === 'ship' ? ' selected' : ''}>Корабль</option>
        </select>` : '—';
        let actions = '';
        if (stay?.is_open && canWriteMlsp) {
          actions = `<div style="display:flex;flex-wrap:wrap;gap:4px">
            <button type="button" class="btn btn-sm prs-mlsp-extend" data-stay-id="${stay.id}" onclick="event.stopPropagation()"
              style="font-size:11px;padding:3px 8px;${left != null && left <= 14 ? 'background:var(--accent);color:#fff;border:none;border-radius:4px' : ''}">Продлить</button>
            <button type="button" class="btn btn-sm prs-mlsp-depart" data-stay-id="${stay.id}" onclick="event.stopPropagation()" style="font-size:11px;padding:3px 8px">Съехал</button>
          </div>`;
        } else if (!stay?.is_open && stay?.departed_source === 'auto_travel' && canWriteMlsp) {
          actions = `<button type="button" class="btn btn-sm prs-mlsp-reopen" data-stay-id="${stay.id}" onclick="event.stopPropagation()" style="font-size:11px;padding:3px 8px">Вернуть</button>`;
        }
        const highlight = focusEmpId && String(e.id) === String(focusEmpId)
          ? 'outline:2px solid var(--accent);outline-offset:-2px;' : '';
        tbodyHtml += `
          <tr class="prs-row" data-id="${e.id}" data-emp-id="${e.id}" style="cursor:pointer;${highlight}${stay?.is_overdue ? 'background:var(--err-bg);' : ''}" title="Открыть карточку">
            <td>
              <div class="bc-cell">
                ${(window.AsgardBrigadeCart && AsgardBrigadeCart.cartBtnHtml) ? AsgardBrigadeCart.cartBtnHtml(e.id) : ''}
                <div class="prs-id bc-cell__body"><div class="prs-id-name">${esc(e.fio || '—')}</div>${prsPhoneLine(e.phone)}</div>
              </div>
            </td>
            <td style="color:var(--t2);font-size:13px">${esc(e.role_tag || e.position || '—')}</td>
            <td>${statusBadge(e.effective_status || e.readiness_status)}</td>
            <td><div style="font-size:13px">${esc(workTitle || '—')}</div>${pmName ? `<div style="font-size:11px;color:var(--t3)">РП: ${esc(pmName)}</div>` : ''}</td>
            <td style="white-space:nowrap">${stay?.arrived_at ? fmtDate(stay.arrived_at) : '—'}</td>
            <td><span style="font-weight:800;padding:2px 8px;border-radius:4px;background:${tone.bg};color:${tone.fg}">${stay?.days_on_platform ?? '—'}</span></td>
            <td>${stay?.is_open
              ? `<div>${fmtDate(stay.planned_depart_at)}</div><div style="font-size:11px;color:${tone.fg}">${stay.is_overdue ? 'просрочен ' + Math.abs(left) + ' дн' : (left != null ? 'осталось ' + left + ' дн' : '')}</div>`
              : `<span style="color:var(--t3)">съехал ${fmtDate(stay?.actual_departed_at)}</span>`}</td>
            <td>${transportSel}</td>
            <td style="white-space:nowrap">${actions}</td>
          </tr>`;
      });
      // empty handled below
    } else {
    TABLE_STATUSES.forEach(st => {
      const list = grouped[st.code];
      if (!list || !list.length) return;
      anyRow = true;

      // Заголовок группы
      tbodyHtml += `
        <tr>
          <td colspan="12" style="background:var(${st.bgVar});color:var(${st.tVar});
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
        // «Начало работ»:
        //  • на объекте — дата первой смены на объекте (backend: on_site_info.start_date,
        //    с фолбэком на дату назначения); если совсем нет — дата готовности;
        //  • готов / согласован — дата, с которой сотрудник готов (readiness_date);
        //  • исторические (последняя работа) — дата старта последнего assignment'а.
        const st = e.effective_status;
        let startRaw;
        if (st === 'on_site') {
          startRaw = (e.on_site_info && e.on_site_info.start_date) || e.readiness_date || null;
        } else if (st === 'ready' || st === 'approved') {
          startRaw = e.readiness_date || null;
        } else {
          startRaw = (last && last.start_date) || e.readiness_date || null;
        }
        const startDate = startRaw ? fmtDate(startRaw) : '—';
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
              <div class="bc-cell">
                ${(window.AsgardBrigadeCart && AsgardBrigadeCart.cartBtnHtml) ? AsgardBrigadeCart.cartBtnHtml(e.id) : ''}
                <div class="bc-cell__body">${prsIdentityCell(e)}</div>
              </div>
            </td>
            <td style="color:var(--t2);font-size:13px">${prsCopyWrap(esc(e.role_tag || e.position || '—'), e.role_tag || e.position || '')}</td>
            <td>${statusBadge(e.effective_status || e.readiness_status)}</td>
            <td>
              ${prsCopyWrap(`${titleHtml}${pmHtml}`, [workTitle, pmName].filter(Boolean).join(' · '))}
            </td>
            <td style="font-size:12px;color:var(--t2)">
              ${e.planned_info
                ? prsCopyWrap(
                    `<span style="font-size:10px;font-weight:700;color:var(--info-t);background:var(--info-bg);padding:2px 5px;border-radius:4px;margin-right:4px">План</span>${esc(e.planned_info.work_title || '')}${e.planned_info.planned_from ? '<div style="font-size:11px;color:var(--t3)">с '+fmtDate(e.planned_info.planned_from)+'</div>' : ''}`,
                    e.planned_info.work_title || ''
                  )
                : '<span style="color:var(--t3)">—</span>'}
            </td>
            <td style="white-space:nowrap;font-size:13px;color:var(--t2)">${prsCopyWrap(startDate, startDate !== '—' ? startDate : '')}</td>
            <td style="text-align:center">${docIndicator(e.permits)}</td>
            <td style="text-align:center">${keyPermChipsHtml(e.key_permits)}</td>
            <td style="font-size:11px;min-width:110px">${sizSizesHtml(e)}</td>
            <td style="font-size:12.5px;color:var(--t2)">${prsCopyWrap(e.city ? esc(e.city) : '<span style="color:var(--t3)">—</span>', e.city || '')}</td>
            <td>${e.is_self_employed
              ? prsCopyWrap(seLimitBar(seTrans, SE_YEAR_LIMIT), `${Math.round(seTrans)} / ${SE_YEAR_LIMIT}`)
              : '<span style="color:var(--t3);font-size:12px">—</span>'}</td>
            <td style="text-align:right">${ratingHtml(e.rating_avg)}</td>
          </tr>`;
      });
    });
    } // end !isMlspView

    if (!anyRow) {
      tbodyHtml = `<tr><td colspan="${isMlspView ? 9 : 12}" class="muted" style="text-align:center;padding:32px">
        ${isMlspView ? 'Нет вахт МЛСП по фильтру' : 'Нет рабочих, соответствующих фильтрам'}
      </td></tr>`;
    }

    // ── Вид «По проектам» ─────────────────────────────────────────────────────
    let byProjectHtml = '';
    if (viewMode === 'by_project') {
      let projects = [];
      try {
        const bd = await apiFetch('/staff/planned-engagements/by-project');
        projects = bd.projects || [];
      } catch (e) {
        byProjectHtml = `<div class="help" style="padding:24px;text-align:center;color:var(--err)">Не удалось загрузить план: ${esc(e.message)}</div>`;
      }
      if (!byProjectHtml) {
        if (!projects.length) {
          byProjectHtml = `<div class="help" style="padding:32px;text-align:center">Нет планируемого привлечения. Назначьте проект в карточке рабочего.</div>`;
        } else {
          byProjectHtml = projects.map(p => {
            const workersRows = (p.workers || []).map(w => {
              const st = STATUS_MAP[w.effective_status || w.readiness_status] || STATUS_MAP.unknown;
              const period = [w.planned_from, w.planned_to].filter(Boolean).map(d => fmtDate(d)).join(' — ');
              const nowHtml = w.on_site_info
                ? `<span style="font-size:10px;font-weight:700;color:var(--ok-t);background:var(--ok-bg);padding:2px 5px;border-radius:4px">На объекте</span><div style="font-size:12px;margin-top:2px">${esc(w.on_site_info.work_title || '')}</div>`
                : (st ? `<span style="font-size:10px;font-weight:700;color:var(${st.tVar});background:var(${st.bgVar});padding:2px 5px;border-radius:4px">${esc(st.label)}</span>` : '—');
              return `<tr class="prs-row" data-id="${w.employee_id}" style="cursor:pointer">
                <td>
                  <div class="bc-cell">
                    ${(window.AsgardBrigadeCart && AsgardBrigadeCart.cartBtnHtml) ? AsgardBrigadeCart.cartBtnHtml(w.employee_id) : ''}
                    <div class="bc-cell__body">${prsCopyWrap(`<div style="font-weight:600">${esc(w.fio || '—')}</div>`, w.fio || '')}</div>
                  </div>
                </td>
                <td style="font-size:13px;color:var(--t2)">${prsCopyWrap(esc(w.role_tag || w.position || '—'), w.role_tag || w.position || '')}</td>
                <td>${nowHtml}</td>
                <td style="font-size:12px;color:var(--t2)">${prsCopyWrap(period || '—', period || '')}</td>
                <td style="font-size:12px;color:var(--t3)">${prsCopyWrap(esc(w.note || '—'), w.note || '')}</td>
              </tr>`;
            }).join('');
            return `<details open style="margin-bottom:12px;border:1px solid var(--brd);border-radius:var(--r-md);overflow:hidden">
              <summary style="padding:10px 14px;background:var(--bg2);cursor:pointer;font-weight:700;font-size:13px;list-style:none;display:flex;gap:8px;align-items:center">
                <span>▼</span>
                <span style="flex:1">${esc(p.work_title || 'Проект')}</span>
                <span style="font-weight:500;color:var(--t3);font-size:12px">${(p.workers || []).length} чел. · РП ${esc(p.pm_name || '—')}</span>
              </summary>
              <table class="asg" style="margin:0">
                <thead><tr>
                  <th>ФИО</th><th>Специальность</th><th>Сейчас</th><th>Период плана</th><th>Примечание</th>
                </tr></thead>
                <tbody>${workersRows}</tbody>
              </table>
            </details>`;
          }).join('');
        }
      }
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
            <button class="btn ghost" id="prs_bc_open" type="button" title="Корзина бригады">
              Корзина<span id="prs_bc_badge" class="bc-badge" hidden>0</span>
            </button>
            <button class="btn ghost" id="prs_mlsp_export" type="button" title="Excel перевахтовки за период">Excel перевахтовка</button>
            <button class="btn ghost" id="prs_btnSchedule">График</button>
          </div>
        </div>

        <!-- Статусные счётчики -->
        <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:10px;align-items:center" id="prs_statusBadges">
          ${summaryBadges}
        </div>

        <!-- Переключатель вида -->
        <div class="row" style="gap:6px;margin-bottom:18px">
          <button class="btn ${viewMode === 'list' ? '' : 'ghost'}" id="prs_viewList" type="button">Список</button>
          <button class="btn ${viewMode === 'by_project' ? '' : 'ghost'}" id="prs_viewByProject" type="button">По проектам</button>
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
          ${isMlspView ? `<select id="prs_mlsp_seg" class="input" style="min-width:160px">
            <option value="all"${qMlspSeg === 'all' ? ' selected' : ''}>Все видимые</option>
            <option value="d14"${qMlspSeg === 'd14' ? ' selected' : ''}>Вывоз ≤14 дн</option>
            <option value="d7"${qMlspSeg === 'd7' ? ' selected' : ''}>Вывоз ≤7 дн</option>
            <option value="over"${qMlspSeg === 'over' ? ' selected' : ''}>Просрочен</option>
            <option value="left"${qMlspSeg === 'left' ? ' selected' : ''}>Съехали (14 дн)</option>
          </select>` : ''}
          <button class="btn" id="prs_btnFind">Найти</button>
          <button class="btn ghost" id="prs_btnReset">Сброс</button>
        </div>

        <!-- Таблица / По проектам -->
        ${viewMode === 'by_project' ? `<div id="prs_byProject">${byProjectHtml}</div>` : `
        <div class="tablewrap">
          <table class="asg" id="prs_table">
            <thead>
              <tr>
                <th>ФИО / Телефон</th>
                <th>Специальность</th>
                <th>Статус</th>
                <th>Объект / РП</th>
                ${isMlspView ? `
                <th>Заезд</th>
                <th>Дней</th>
                <th>Вывоз</th>
                <th>Транспорт</th>
                <th style="width:160px">Действия</th>
                ` : `
                <th>→ План</th>
                <th>Начало работ</th>
                <th style="text-align:center;width:60px">Документы</th>
                <th style="text-align:center;width:170px" title="БОСИЕТ · РУКАВ · МЛСП · ФСБ">Ключевые допуски</th>
                <th style="width:120px">СИЗ</th>
                <th style="width:120px">Город</th>
                <th style="width:140px">Лимит СЗ</th>
                <th style="text-align:right;width:70px">Рейтинг</th>
                `}
              </tr>
            </thead>
            <tbody id="prs_tbody">
              ${tbodyHtml}
            </tbody>
          </table>
        </div>`}

        <!-- Пагинация -->
        <div id="prs_pagination"></div>

        <div class="help" style="margin-top:12px">
          Всего найдено: <b>${rows.length}</b> рабочих
        </div>
      </div>`;

    await layout(html, { title: title || 'Дружина • Реестр рабочих' });

    // Корзина бригады (persist + UI)
    if (window.AsgardBrigadeCart) {
      try {
        AsgardBrigadeCart.mount({ user, employees });
      } catch (e) {
        console.warn('[brigade-cart]', e);
      }
    }

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

      if (dataRows.length > 0) {
        // focus_emp: перейти на страницу с целевой строкой (как v2)
        if (focusEmpId) {
          const idx = dataRows.findIndex(r => String(r.dataset.empId || r.dataset.id) === String(focusEmpId));
          if (idx >= 0 && pageSize > 0) {
            currentPage = Math.floor(idx / pageSize) + 1;
          }
        }
        applyPagination(currentPage, pageSize);
      }
    }

    // ── Обработчики фильтров ──────────────────────────────────────────────────

    function buildFilter() {
      const qv  = ($('#prs_q')?.value      || '').trim();
      const sv  = ($('#prs_spec')?.value   || '').trim();
      const stv = ($('#prs_status')?.value || '').trim();
      const cv  = ($('#prs_city')?.value   || '').trim();
      const pv  = ($('#prs_pass')?.value   || '').trim();
      const mv  = ($('#prs_mlsp_seg')?.value || '').trim();
      const parts = [];
      if (qv)  parts.push(`q=${encodeURIComponent(qv)}`);
      if (sv)  parts.push(`spec=${encodeURIComponent(sv)}`);
      if (stv) parts.push(`status=${encodeURIComponent(stv)}`);
      if (cv)  parts.push(`city=${encodeURIComponent(cv)}`);
      if (pv)  parts.push(`pass=${encodeURIComponent(pv)}`);
      if (stv === 'on_mlsp' && mv && mv !== 'all') parts.push(`mlsp_seg=${encodeURIComponent(mv)}`);
      location.hash = '#/personnel' + (parts.length ? '?' + parts.join('&') : '');
    }

    $('#prs_btnFind')?.addEventListener('click', buildFilter);
    $('#prs_btnReset')?.addEventListener('click', () => { location.hash = '#/personnel'; });
    $('#prs_q')?.addEventListener('keydown', e => { if (e.key === 'Enter') buildFilter(); });
    // 25.06.2026: автоприменение фильтров по городу и пропускам
    $('#prs_city')?.addEventListener('change', buildFilter);
    $('#prs_pass')?.addEventListener('change', buildFilter);
    $('#prs_mlsp_seg')?.addEventListener('change', buildFilter);

    // Переключатель вида
    $('#prs_viewList')?.addEventListener('click', () => {
      try { localStorage.setItem('prs-view', 'list'); } catch (_) {}
      const qs = (location.hash.split('?')[1] || '').trim();
      location.hash = '#/personnel' + (qs ? '?' + qs : '');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    $('#prs_viewByProject')?.addEventListener('click', () => {
      try { localStorage.setItem('prs-view', 'by_project'); } catch (_) {}
      const qs = (location.hash.split('?')[1] || '').trim();
      location.hash = '#/personnel' + (qs ? '?' + qs : '');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

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
    $('#prs_mlsp_export')?.addEventListener('click', () => openMlspExportModal());

    // Клик по строке → карточка сотрудника (кнопка копирования / корзина не открывают)
    $$('.prs-row').forEach(row => {
      row.addEventListener('click', (ev) => {
        if (ev.target.closest('.prs-copy')) return;
        if (ev.target.closest('.bc-row-btn')) return;
        if (ev.target.closest('.prs-mlsp-chip-btn, .prs-mlsp-tr, .prs-mlsp-extend, .prs-mlsp-depart, .prs-mlsp-reopen')) return;
        const id = row.dataset.id;
        if (id) location.hash = `#/employee?id=${id}`;
      });
    });
    $$('.prs-mlsp-chip-btn').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const empId = btn.dataset.empId || '';
        const parts = ['status=on_mlsp'];
        if (empId) parts.push('focus_emp=' + encodeURIComponent(empId));
        location.hash = '#/personnel?' + parts.join('&');
      });
    });
    $$('.prs-mlsp-tr').forEach(sel => {
      sel.addEventListener('change', async () => {
        const id = sel.dataset.stayId;
        try {
          await fetch('/api/staff/mlsp-stays/' + id, {
            method: 'PATCH', headers: authHeaders(true),
            body: JSON.stringify({ transport: sel.value || null })
          }).then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status); });
          toast('Сохранено', 'Транспорт обновлён', 'ok');
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      });
    });
    $$('.prs-mlsp-extend').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openMlspExtendModal(btn.dataset.stayId);
      });
    });
    $$('.prs-mlsp-depart').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openMlspDepartModal(btn.dataset.stayId);
      });
    });
    $$('.prs-mlsp-reopen').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openMlspReopenModal(btn.dataset.stayId);
      });
    });
    if (isMlspView && focusEmpId) {
      setTimeout(() => {
        const safe = String(focusEmpId).replace(/[^\d]/g, '');
        const el = document.querySelector('tr.prs-row[data-emp-id="' + safe + '"]');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
    }
    $$('.prs-copy').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const text = btn.getAttribute('data-copy') || '';
        if (text && typeof copyToClipboard === 'function') {
          copyToClipboard(text);
          markCopyBtn(btn);
        }
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
      'слесарь',
      'сварщик',
      'альпинист',
      'оператор вд',
      'наблюдающий (вд)',
      'слесарь-сантехник',
      'электромонтажник',
      'стропальщик',
      'мастер участка',
      'подсобный рабочий',
      'монтажник',
      'мастер',
      'ПТО',
      'РП',
    ].map(s => {
      const label = (s === 'РП' || s === 'ПТО') ? s : (s.charAt(0).toUpperCase() + s.slice(1));
      return `<option value="${esc(s)}">${esc(label)}</option>`;
    }).join('');

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
          <input id="ae_birth" class="input" placeholder="дд.мм.гггг" autocomplete="bday" title="Можно вставить дату (дд.мм.гггг)"/>
          <div id="ae_birth_age" style="margin-top:4px;font-size:12px;color:var(--t3)"></div>
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

    const birthInp = $('#ae_birth');
    const birthAgeEl = $('#ae_birth_age');
    function refreshBirthAge() {
      if (!birthAgeEl) return;
      const iso = parseFlexibleDate(birthInp?.value);
      if (!iso) { birthAgeEl.textContent = birthInp?.value?.trim() ? 'Не удалось распознать дату' : ''; return; }
      // нормализуем отображение после распознавания
      if (birthInp && birthInp.value.trim() && birthInp.value.trim() !== iso) {
        const [y, mo, d] = iso.split('-');
        birthInp.dataset.iso = iso;
        // оставляем то, что ввёл пользователь, если это уже iso — ок; иначе при paste нормализуем ниже
      } else if (birthInp) {
        birthInp.dataset.iso = iso || '';
      }
      const age = ageFromBirth(iso);
      if (age == null) { birthAgeEl.textContent = ''; return; }
      let t = `Возраст: ${age} ${pluralYears(age)}`;
      if (age >= 45) t += ' · требуется УМО';
      birthAgeEl.textContent = t;
      birthAgeEl.style.color = age >= 45 ? 'var(--info)' : 'var(--t3)';
    }
    function normalizeBirthInput() {
      if (!birthInp) return;
      const iso = parseFlexibleDate(birthInp.value);
      if (!iso) { birthInp.dataset.iso = ''; refreshBirthAge(); return; }
      const [y, mo, d] = iso.split('-');
      birthInp.value = `${d}.${mo}.${y}`;
      birthInp.dataset.iso = iso;
      refreshBirthAge();
    }
    birthInp?.addEventListener('input', refreshBirthAge);
    birthInp?.addEventListener('blur', normalizeBirthInput);
    birthInp?.addEventListener('paste', (ev) => {
      const text = ev.clipboardData?.getData('text');
      if (!text) return;
      const iso = parseFlexibleDate(text);
      if (!iso) return;
      ev.preventDefault();
      const [y, mo, d] = iso.split('-');
      birthInp.value = `${d}.${mo}.${y}`;
      birthInp.dataset.iso = iso;
      refreshBirthAge();
    });

    $('#ae_btnCancel')?.addEventListener('click', () => closeModal());

    $('#ae_btnSave')?.addEventListener('click', async () => {
      const fio = ($('#ae_fio')?.value || '').trim();
      if (!fio) { toast('Проверка', 'ФИО обязательно', 'err'); return; }

      const btn = $('#ae_btnSave');
      btn.disabled = true;
      btn.textContent = 'Сохранение…';

      try {
        const birthRaw = ($('#ae_birth')?.value || '').trim();
        const birthIso = $('#ae_birth')?.dataset?.iso || parseFlexibleDate(birthRaw) || undefined;
        const payload = {
          fio,
          phone:      ($('#ae_phone')?.value || '').trim() || undefined,
          birth_date: birthIso || undefined,
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
    const canEditReadiness = READINESS_EDIT_ROLES.includes(auth.user.role) || isDirRole(auth.user.role);

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

    const statusSelectorHtml = canEditReadiness ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn prs-st-btn" data-st="ready"
          style="background:var(--gold-bg);color:var(--gold)">✓ Готов</button>
        <button class="btn ghost prs-st-btn" data-st="not_ready"
          style="border-color:var(--warn);color:var(--warn-t)">✗ Не готов</button>
        <button class="btn ghost prs-st-btn" data-st="unknown"
          style="border-color:var(--brd);color:var(--t2)">Без статуса</button>
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
          ${canEditReadiness ? '<button class="btn" id="prs_btnSaveStatus" style="display:none">Сохранить</button>' : ''}
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

      if (st === 'ready' || st === 'not_ready') {
        const dateLabel = st === 'ready' ? 'Готов с даты' : 'Не готов с даты';
        html += `<label style="font-size:13px;color:var(--t3)">${dateLabel} <span style="color:var(--err)">*</span></label>
          <input id="prs_rdDate" type="date" class="input" style="margin-top:4px"
            value="${new Date().toISOString().slice(0, 10)}"/>`;
      }
      if (st === 'not_ready') {
        const reasonOpts = REASONS.map(r =>
          `<option value="${esc(r.key)}">${esc(r.label)}</option>`
        ).join('');
        html += `<label style="font-size:13px;color:var(--t3);margin-top:8px;display:block">Причина <span style="color:var(--err)">*</span></label>
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

    if (canEditReadiness) {
      $('#prs_btnSaveStatus')?.addEventListener('click', async () => {
        if (!pendingStatus) { toast('Выберите статус', '', 'err'); return; }

        // Подбираем актуальные значения из формы
        const rdDate    = ($('#prs_rdDate')?.value    || '').trim();
        const rdReason  = ($('#prs_rdReason')?.value  || '').trim();
        const rdComment = ($('#prs_rdComment')?.value || '').trim();

        if ((pendingStatus === 'ready' || pendingStatus === 'not_ready') && !rdDate) {
          toast('Укажите дату (с какого числа)', '', 'err'); return;
        }
        if (pendingStatus === 'not_ready' && !rdReason) {
          toast('Укажите причину', '', 'err'); return;
        }

        const saveBtn = $('#prs_btnSaveStatus');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Сохранение…'; }

        try {
          await apiPut(`/staff/readiness/${employeeId}/status`, {
            status:         pendingStatus,
            readiness_date: (pendingStatus === 'ready' || pendingStatus === 'not_ready') ? (rdDate || null) : null,
            reason:         pendingStatus === 'not_ready' ? (rdReason || null) : null,
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
