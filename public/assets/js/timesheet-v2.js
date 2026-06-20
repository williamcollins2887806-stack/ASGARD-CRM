/* Timesheet v2 — единый модуль для 5 ролевых режимов
 * Один компонент-таблица ФИО × дни месяца, разный тулбар по mode.
 *
 * Контракт: TIMESHEET_V2_CONTRACT.md (источник правды).
 *
 * Endpoints (ожидаются от backend агента B):
 *   GET    /api/timesheet/v2/:year/:month?mode=...&work_id=...
 *   PUT    /api/timesheet/v2/entry        { employee_id, work_id, date, type, shift, delete }
 *   GET    /api/timesheet/v2/locks/:year/:month
 *   POST   /api/timesheet/v2/lock         { scope, scope_user_id? }
 *   DELETE /api/timesheet/v2/lock/:lockId
 *   GET    /api/timesheet/v2/:year/:month/export?format=xlsx
 *   GET    /api/staff/employees?search=... (используется поиск рабочих)
 *
 * Пять public-методов: renderPm, renderWarehouse, renderMedical, renderTravel, renderGlobal
 */
window.AsgardTimesheetV2 = (function () {
  'use strict';

  const { $, esc, toast, showModal, closeModal } = AsgardUI;
  const API_BASE = '/api/timesheet/v2';

  // FIX 7 — цвета через CSS-токены (assets/css/timesheet-types-tokens.css).
  // Передаём в style.background/color как var(--ts-*-bg)/var(--ts-*-fg).
  const TYPE_META = {
    day:       { icon: '☀️', label: 'Дневная смена', color: 'var(--ts-day-bg)',       textColor: 'var(--ts-day-fg)' },
    night:     { icon: '🌙', label: 'Ночная смена',  color: 'var(--ts-night-bg)',     textColor: 'var(--ts-night-fg)' },
    warehouse: { icon: '📦', label: 'Склад',         color: 'var(--ts-warehouse-bg)', textColor: 'var(--ts-warehouse-fg)' },
    medical:   { icon: '🏥', label: 'Медосмотр',     color: 'var(--ts-medical-bg)',   textColor: 'var(--ts-medical-fg)' },
    travel:    { icon: '✈️', label: 'Дорога',        color: 'var(--ts-travel-bg)',    textColor: 'var(--ts-travel-fg)' },
    waiting:   { icon: '⏰', label: 'Ожидание',      color: 'var(--ts-waiting-bg)',   textColor: 'var(--ts-waiting-fg)' }
  };

  // FIX 11 — локализация ролей
  const ROLE_LABELS = {
    PM: 'РП',
    HEAD_PM: 'Старший РП',
    WAREHOUSE: 'Склад',
    TO: 'ТО',
    HEAD_TO: 'Рук. ТО',
    OFFICE_MANAGER: 'Офис',
    DIRECTOR_GEN: 'Директор',
    DIRECTOR_COMM: 'Дир. ком.',
    DIRECTOR_DEV: 'Дир. разв.',
    BUH: 'Бухгалтер',
    HR: 'HR',
    HR_MANAGER: 'HR-менеджер',
    ADMIN: 'Админ',
    WORKER: 'Рабочий'
  };
  function roleLabel(r) { return ROLE_LABELS[r] || r || ''; }

  const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  // Какие типы могут выставлять разные mode
  const MODE_ALLOWED_TYPES = {
    pm:        ['day','night','waiting'],
    warehouse: ['warehouse'],
    medical:   ['medical'],
    travel:    ['travel'],
    global:    ['day','night','warehouse','medical','travel','waiting']
  };

  // По какому scope мы запираем месяц
  const MODE_LOCK_SCOPE = {
    pm:        'pm',
    warehouse: 'warehouse',
    medical:   'medical',
    travel:    'travel',
    global:    'global'
  };

  let _stylesInjected = false;
  let _refreshTimer = null;

  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const s = document.createElement('style');
    s.id = 'tsv2-styles';
    s.textContent = `
      .tsv2-wrap { padding: 0; }
      .tsv2-toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; margin-bottom:12px; }
      .tsv2-tb-left, .tsv2-tb-right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .tsv2-period { font-size:16px; font-weight:600; color:var(--t1); min-width:160px; text-align:center; }
      .tsv2-kpi { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px; }
      .tsv2-kpi-card { padding:8px 16px; border-radius:var(--r-sm); font-weight:600; min-width:120px; }
      .tsv2-kpi-card.k-workers { background:var(--ok-bg); color:var(--ok-t); }
      .tsv2-kpi-card.k-shifts  { background:var(--info-bg); color:var(--info-t); }
      .tsv2-kpi-card.k-fot     { background:var(--gold-bg); color:var(--gold); }
      .tsv2-kpi-card.k-perdiem { background:var(--bg3); color:var(--t1); }

      /* FIX 1 + FIX 15 — расширенный блок «Закрытие месяца» */
      .tsv2-locks { display:flex; flex-direction:column; gap:10px; margin-bottom:12px;
        padding:10px 12px; background:var(--bg2); border:1px solid var(--brd); border-radius:var(--r-md); }
      .tsv2-locks-title { font-size:11px; color:var(--t3); letter-spacing:0.12em;
        text-transform:uppercase; font-weight:700; }
      .tsv2-lock-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
      .tsv2-lock-row-label { font-size:11px; color:var(--t3); font-weight:700;
        min-width:78px; text-transform:uppercase; letter-spacing:0.08em; }
      .tsv2-lock-chip {
        display:inline-flex; align-items:center; gap:6px; padding:5px 10px;
        border-radius:999px; font-size:11px; font-weight:600; cursor:default;
      }
      .tsv2-lock-chip.locked   { background:var(--err-bg); color:var(--err-t);
        border:1px solid var(--err-t); }
      .tsv2-lock-chip.unlocked { background:var(--bg3); color:var(--t3);
        border:1px dashed var(--brd); }
      .tsv2-lock-chip .unlock  { background:transparent; border:none; color:inherit;
        cursor:pointer; font-weight:700; margin-left:4px; padding:1px 6px; border-radius:6px; }
      .tsv2-lock-chip .unlock:hover { background:rgba(0,0,0,0.08); }

      /* FIX 2 — сетка РП-чипов в global-mode */
      .tsv2-pm-grid { display:grid; gap:6px;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); width:100%; }
      .tsv2-pm-chip { display:flex; justify-content:space-between; align-items:center;
        gap:8px; padding:6px 10px; border-radius:var(--r-sm);
        border:1px solid var(--brd); background:var(--bg3); font-size:12px; }
      .tsv2-pm-chip.locked { background:var(--ok-bg); border-color:var(--ok-t); color:var(--ok-t); }
      .tsv2-pm-chip.open   { border-style:dashed; color:var(--t2); }
      .tsv2-pm-chip .fio { font-weight:600; color:var(--t1);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .tsv2-pm-chip.locked .fio { color:var(--ok-t); }
      .tsv2-pm-chip .status { font-size:10px; white-space:nowrap; display:flex; gap:4px; align-items:center; }
      .tsv2-pm-remind { background:transparent; border:1px solid var(--brd);
        color:var(--t3); border-radius:999px; font-size:10px; padding:1px 6px; cursor:pointer; }
      .tsv2-pm-remind:hover { border-color:var(--gold); color:var(--gold); }

      /* FIX 9 — кастомный tooltip (заменяет native title=) */
      .tsv2-tooltip { position:fixed; background:var(--bg2); color:var(--t1);
        padding:8px 12px; border-radius:var(--r-sm);
        border:1px solid var(--brd); box-shadow:var(--shadow-md);
        font-size:11px; line-height:1.5; z-index:30000;
        pointer-events:none; max-width:280px;
        transform:translate(-50%, -100%);
        opacity:0; transition:opacity 120ms ease;
      }
      .tsv2-tooltip.show { opacity:1; }
      .tsv2-tooltip .tt-title { font-weight:700; color:var(--t1); margin-bottom:2px; }
      .tsv2-tooltip .tt-row { color:var(--t2); }
      .tsv2-tooltip .tt-meta { color:var(--t3); font-size:10px; margin-top:4px; }

      .tsv2-scroll {
        overflow:auto; max-height:calc(100vh - 280px);
        border:1px solid var(--brd); border-radius:var(--r-md); background:var(--bg1);
      }
      .tsv2-table { border-collapse:separate; border-spacing:0; font-size:12px; width:max-content; min-width:100%; }
      .tsv2-table th, .tsv2-table td {
        padding:4px 6px; border-bottom:1px solid var(--brd); border-right:1px solid var(--brd);
        white-space:nowrap; text-align:center; background:var(--bg1);
      }
      .tsv2-table thead th { position:sticky; top:0; z-index:3; background:var(--bg2); color:var(--t2); font-weight:600; font-size:11px; }
      .tsv2-table thead th:first-child { z-index:4; left:0; }
      .tsv2-table td:first-child, .tsv2-table th:first-child {
        position:sticky; left:0; z-index:2; background:var(--bg1);
        text-align:left; min-width:200px; max-width:240px;
      }
      .tsv2-table tbody tr:hover td { background:var(--bg3); }
      .tsv2-table tbody tr:hover td:first-child { background:var(--bg3); }
      .tsv2-day-weekend { color:var(--err-t); }
      .tsv2-day-today   { background:var(--gold-bg) !important; color:var(--gold) !important; }
      .tsv2-group-row td { background:var(--bg3) !important; font-weight:600; color:var(--t1); font-size:13px; text-align:left; }
      /* Q3: «Город» — мягкий серый текст */
      .tsv2-city { font-size:11px; color:var(--t-2, var(--t2)); text-align:center; }
      /* Q3: «Получает» — текстовый бейдж */
      .tsv2-src-cell { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:500; white-space:nowrap; max-width:160px; overflow:hidden; text-overflow:ellipsis; }
      .tsv2-src-cell.src-self   { background:#E8F5E9; color:#1B5E20; }
      .tsv2-src-cell.src-via    { background:#F3E5F5; color:#4A148C; }
      .tsv2-src-cell.src-salary { background:#E3F2FD; color:#0D47A1; }
      .tsv2-src-cell.src-cash   { background:var(--bg3); color:var(--t-3, var(--t3)); }
      html[data-theme="dark"] .tsv2-src-cell.src-self   { background:rgba(76,175,80,0.15);  color:#A5D6A7; }
      html[data-theme="dark"] .tsv2-src-cell.src-via    { background:rgba(156,39,176,0.18); color:#CE93D8; }
      html[data-theme="dark"] .tsv2-src-cell.src-salary { background:rgba(33,150,243,0.15); color:#90CAF9; }
      /* Q1: класс остатка лимита — определён ниже в общем блоке .tsv2-dash-limit-fill (стр. ~422) */
      .tsv2-fio { font-weight:600; }
      .tsv2-pos { font-size:10px; color:var(--t3); }

      .tsv2-cell {
        display:inline-flex; align-items:center; justify-content:center;
        width:30px; height:24px; border-radius:var(--r-sm);
        font-size:12px; font-weight:700; cursor:default;
        transition: transform 60ms ease, box-shadow 60ms ease;
      }
      .tsv2-cell.editable { cursor:pointer; }
      .tsv2-cell.editable:hover { box-shadow: 0 0 0 2px var(--gold); }
      .tsv2-cell.tsv2-saved { animation: tsv2-pulse 600ms ease; }
      @keyframes tsv2-pulse {
        0%   { box-shadow:0 0 0 0 rgba(0,210,106,.7); }
        50%  { box-shadow:0 0 0 6px rgba(0,210,106,0); }
        100% { box-shadow:0 0 0 0 rgba(0,210,106,0); }
      }
      .tsv2-total { font-weight:700; color:var(--t1); }
      .tsv2-sum   { color:var(--ok-t); font-weight:700; text-align:right; }

      .tsv2-popover {
        position:absolute; z-index:120; background:var(--bg2); border:1px solid var(--brd);
        border-radius:var(--r-md); padding:6px; box-shadow:var(--shadow-md); min-width:170px;
      }
      .tsv2-popover button {
        display:flex; align-items:center; gap:8px; width:100%; padding:6px 8px;
        border:none; background:transparent; color:var(--t1); cursor:pointer;
        border-radius:var(--r-sm); font-size:13px; text-align:left;
      }
      .tsv2-popover button:hover { background:var(--bg4); }
      .tsv2-popover .ts-del { color:var(--err-t); border-top:1px solid var(--brd); margin-top:4px; padding-top:6px; }

      .tsv2-add { display:flex; flex-direction:column; gap:12px; min-width:420px; }
      .tsv2-add input[type=text], .tsv2-add input[type=date] {
        width:100%; padding:8px 10px; border:1px solid var(--brd);
        border-radius:var(--r-sm); background:var(--bg1); color:var(--t1); font-size:14px;
      }
      .tsv2-search-results { max-height:260px; overflow:auto; border:1px solid var(--brd); border-radius:var(--r-sm); }
      .tsv2-search-row { display:flex; justify-content:space-between; padding:8px 10px; cursor:pointer; border-bottom:1px solid var(--brd); }
      .tsv2-search-row:hover { background:var(--bg3); }

      .tsv2-empty { padding:40px; text-align:center; color:var(--t3); }
      .tsv2-loading { padding:40px; text-align:center; color:var(--t3); }

      @media (max-width:768px) {
        .tsv2-table td:first-child, .tsv2-table th:first-child { min-width:140px; max-width:160px; }
        .tsv2-cell { width:32px; height:32px; font-size:13px; }
        .tsv2-period { min-width:120px; font-size:14px; }
      }

      /* Phase 1E (2026-06-20) — компактный финансовый дашборд (mode='global') */
      .tsv2-dash {
        margin-bottom: 14px; padding: 14px 16px;
        background: var(--bg2); border: 1px solid var(--brd);
        border-radius: var(--r-md); box-shadow: var(--shadow-sm);
        display: flex; flex-direction: column; gap: 12px;
      }

      /* ─── Шапка-чипы ─── */
      .tsv2-dash-headrow {
        display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
        font-size: 13px; color: var(--t1);
      }
      .tsv2-dash-sep-dot { color: var(--t3); opacity: 0.6; }
      .tsv2-dash-chip {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 4px 10px; border-radius: 999px;
        background: var(--bg3); color: var(--t1);
        border: 1px solid var(--brd); font-size: 12px; font-weight: 600;
      }
      .tsv2-dash-chip.dc-chip-bold { font-weight: 700; }
      .tsv2-dash-chip.dc-chip-mute { color: var(--t2); }
      .tsv2-dash-chip .dt-dot {
        width: 8px; height: 8px; border-radius: 50%;
        display: inline-block;
      }
      .tsv2-dash-chip.dt-se  .dt-dot { background: #4CAF50; }
      .tsv2-dash-chip.dt-of  .dt-dot { background: #2196F3; }
      .tsv2-dash-chip.dt-cas .dt-dot { background: #9E9E9E; }

      /* ─── Большая карточка «Заработали» ─── */
      .tsv2-dash-earned-big {
        padding: 14px 18px; border-radius: var(--r-sm);
        background: #FFF8E1; color: #5D4037; border: 1px solid #FFE082;
      }
      html[data-theme="dark"] .tsv2-dash-earned-big {
        background: rgba(255, 193, 7, 0.08); color: #FFE082;
        border-color: rgba(255, 193, 7, 0.30);
      }
      .dc-earned-label {
        font-size: 11px; font-weight: 600; opacity: 0.82;
        letter-spacing: 0.04em; text-transform: uppercase;
      }
      .dc-earned-value {
        font-size: 26px; font-weight: 800; line-height: 1.2;
        margin-top: 4px;
      }
      .dc-earned-sub {
        font-size: 12px; font-weight: 500; line-height: 1.3;
        margin-top: 5px; display: flex; gap: 10px; flex-wrap: wrap;
      }
      .dc-sub-bonus   { color: #2E7D32; }
      .dc-sub-penalty { color: #C62828; }
      html[data-theme="dark"] .dc-sub-bonus   { color: #A5D6A7; }
      html[data-theme="dark"] .dc-sub-penalty { color: #EF9A9A; }

      /* ─── 2 колонки «На карту» + «Из кассы» ─── */
      .tsv2-dash-split {
        display: grid; gap: 10px;
        grid-template-columns: repeat(2, 1fr);
      }
      .tsv2-dash-card {
        padding: 12px 14px; border-radius: var(--r-sm);
        display: flex; flex-direction: column; gap: 3px;
        border: 1px solid transparent;
      }
      .tsv2-dash-card .dc-label {
        font-size: 11px; font-weight: 600; opacity: 0.85;
        letter-spacing: 0.04em; text-transform: uppercase;
      }
      .tsv2-dash-card .dc-value {
        font-size: 22px; font-weight: 700; line-height: 1.2;
      }
      .dc-card-hint {
        font-size: 11px; opacity: 0.72; margin-top: 2px;
      }
      .tsv2-dash-card.dc-transfer { background: #E3F2FD; color: #0D47A1; border-color: #BBDEFB; }
      .tsv2-dash-card.dc-cash-out { background: #FFF3E0; color: #E65100; border-color: #FFCC80; }
      html[data-theme="dark"] .tsv2-dash-card.dc-transfer { background: rgba(33,150,243,0.10); color: #BBDEFB; border-color: rgba(33,150,243,0.30); }
      html[data-theme="dark"] .tsv2-dash-card.dc-cash-out { background: rgba(255,152,0,0.10); color: #FFCC80; border-color: rgba(255,152,0,0.30); }

      /* ─── 🏦 Карточка «Касса» ─── */
      .tsv2-dash-cash {
        padding: 14px 16px; border-radius: var(--r-sm);
        border: 1px solid; display: flex; flex-direction: column; gap: 10px;
      }
      .cash-title {
        font-size: 13px; font-weight: 700;
        letter-spacing: 0.02em;
      }
      .cash-grid {
        display: grid; gap: 16px;
        grid-template-columns: 1fr 1fr;
      }
      .cash-col { display: flex; flex-direction: column; gap: 4px; }
      .cash-row {
        display: flex; justify-content: space-between; align-items: baseline;
        font-size: 12px; gap: 8px;
      }
      .cash-row-sep {
        margin-top: 4px; padding-top: 6px;
        border-top: 1px dashed currentColor;
      }
      .cash-label { opacity: 0.78; }
      .cash-label-bold { font-weight: 700; opacity: 1; }
      .cash-num { font-variant-numeric: tabular-nums; font-weight: 600; }
      .cash-num-bold { font-weight: 800; font-size: 14px; }
      .cash-num-mut { opacity: 0.75; }
      .cash-diff-neg { color: #C62828; }
      .cash-diff-pos { color: #2E7D32; }
      .cash-diff-zero { opacity: 0.7; }
      html[data-theme="dark"] .cash-diff-neg { color: #EF9A9A; }
      html[data-theme="dark"] .cash-diff-pos { color: #A5D6A7; }

      .cash-pct {
        font-size: 11px; font-weight: 700;
        margin-top: 3px; opacity: 0.78;
        text-align: right;
      }
      .cash-bar {
        height: 10px; border-radius: 999px;
        background: var(--bg3); overflow: hidden;
        border: 1px solid var(--brd);
      }
      .cash-bar-fill {
        height: 100%; border-radius: 999px;
        transition: width 240ms ease;
      }
      .cash-bar-fill.cash-status-ok,
      .cash-bar-fill.cash-status-ok_with_returns {
        background: linear-gradient(90deg, #A5D6A7, #66BB6A);
      }
      .cash-bar-fill.cash-status-tight {
        background: linear-gradient(90deg, #FFE082, #FFB300);
      }
      .cash-bar-fill.cash-status-shortage {
        background: linear-gradient(90deg, #EF9A9A, #E57373);
      }
      /* 2026-06-20 — парность для тёмной темы (на тёмном фоне нужны более насыщенные оттенки) */
      html[data-theme="dark"] .cash-bar-fill.cash-status-ok,
      html[data-theme="dark"] .cash-bar-fill.cash-status-ok_with_returns {
        background: linear-gradient(90deg, #66BB6A, #43A047);
      }
      html[data-theme="dark"] .cash-bar-fill.cash-status-tight {
        background: linear-gradient(90deg, #FFB300, #F57F17);
      }
      html[data-theme="dark"] .cash-bar-fill.cash-status-shortage {
        background: linear-gradient(90deg, #E57373, #C62828);
      }

      .cash-action {
        font-size: 13px; font-weight: 700;
        padding: 6px 0;
      }
      .cash-action-bad { color: #B71C1C; }
      .cash-action-good { color: #1B5E20; }
      html[data-theme="dark"] .cash-action-bad { color: #EF9A9A; }
      html[data-theme="dark"] .cash-action-good { color: #A5D6A7; }

      .cash-advances {
        font-size: 12px; opacity: 0.82;
        padding-top: 6px; border-top: 1px dashed currentColor;
      }

      /* Постельные тона по статусу cash-coverage */
      .tsv2-dash-cash.cash-status-ok               { background: #E8F5E9; color: #1B5E20; border-color: #66BB6A; }
      .tsv2-dash-cash.cash-status-ok_with_returns  { background: #F1F8E9; color: #33691E; border-color: #9CCC65; }
      .tsv2-dash-cash.cash-status-tight            { background: #FFF8E1; color: #E65100; border-color: #FFB300; }
      .tsv2-dash-cash.cash-status-shortage         { background: #FFEBEE; color: #B71C1C; border-color: #E57373; }

      html[data-theme="dark"] .tsv2-dash-cash.cash-status-ok {
        background: rgba(76,175,80,0.10); color: #A5D6A7; border-color: rgba(76,175,80,0.40);
      }
      html[data-theme="dark"] .tsv2-dash-cash.cash-status-ok_with_returns {
        background: rgba(124,179,66,0.10); color: #C5E1A5; border-color: rgba(124,179,66,0.40);
      }
      html[data-theme="dark"] .tsv2-dash-cash.cash-status-tight {
        background: rgba(255,179,0,0.10); color: #FFE082; border-color: rgba(255,179,0,0.40);
      }
      html[data-theme="dark"] .tsv2-dash-cash.cash-status-shortage {
        background: rgba(229,115,115,0.12); color: #EF9A9A; border-color: rgba(229,115,115,0.45);
      }

      /* ─── Лимиты СЗ (компактная карточка) ─── */
      .tsv2-dash-limits-card {
        padding: 12px 14px; border-radius: var(--r-sm);
        background: var(--bg3); border: 1px solid var(--brd);
        display: flex; flex-direction: column; gap: 8px;
      }
      .tsv2-dash-limits-title {
        font-size: 11px; font-weight: 700; color: var(--t2);
        letter-spacing: 0.04em; text-transform: uppercase;
      }
      .tsv2-dash-limit-row {
        display: grid; gap: 10px; align-items: center;
        grid-template-columns: minmax(220px, 1fr) minmax(140px, 1.5fr) auto;
        font-size: 12px; color: var(--t1);
      }
      .tsv2-dash-limit-label { color: var(--t1); }
      .tsv2-dash-limit-label b { font-weight: 700; }
      .tsv2-dash-limit-bar {
        position: relative; height: 10px;
        background: var(--bg2); border: 1px solid var(--brd);
        border-radius: 999px; overflow: hidden;
      }
      .tsv2-dash-limit-fill {
        position: absolute; left: 0; top: 0; bottom: 0;
        background: #81C784; transition: width 240ms ease;
      }
      .tsv2-dash-limit-fill.remain-ok   { background: linear-gradient(90deg,#A5D6A7,#66BB6A); }
      .tsv2-dash-limit-fill.remain-warn { background: linear-gradient(90deg,#FFE082,#FFB300); }
      .tsv2-dash-limit-fill.remain-low  { background: linear-gradient(90deg,#EF9A9A,#E57373); }
      /* 2026-06-20 — парность для тёмной темы (на тёмном фоне нужны более насыщенные оттенки) */
      html[data-theme="dark"] .tsv2-dash-limit-fill.remain-ok   { background: linear-gradient(90deg,#66BB6A,#43A047); }
      html[data-theme="dark"] .tsv2-dash-limit-fill.remain-warn { background: linear-gradient(90deg,#FFB300,#F57F17); }
      html[data-theme="dark"] .tsv2-dash-limit-fill.remain-low  { background: linear-gradient(90deg,#E57373,#C62828); }
      .tsv2-dash-limit-pct {
        font-size: 11px; font-weight: 700; color: var(--t2);
        white-space: nowrap; text-align: right;
      }

      /* Адаптив — на узком экране секции в столбик */
      @media (max-width: 720px) {
        .tsv2-dash-split { grid-template-columns: 1fr; }
        .cash-grid { grid-template-columns: 1fr; }
        .tsv2-dash-limit-row { grid-template-columns: 1fr; }
        .tsv2-dash-limit-pct { text-align: left; }
        .dc-earned-value { font-size: 22px; }
        .tsv2-dash-card .dc-value { font-size: 18px; }
      }

      /* Phase 1B — новые колонки таблицы (mode='global') */
      .tsv2-pay-cell { font-size: 11px; padding: 2px 8px; border-radius: 999px; display: inline-block; font-weight: 700; }
      .tsv2-pay-cell.pay-se  { background: #E0F2F1; color: #00695C; }
      .tsv2-pay-cell.pay-of  { background: #F1F8E9; color: #33691E; }
      .tsv2-pay-cell.pay-cas { background: #F5F5F5; color: #424242; }
      html[data-theme="dark"] .tsv2-pay-cell.pay-se  { background: #2A4D49; color: #B2DFDB; }
      html[data-theme="dark"] .tsv2-pay-cell.pay-of  { background: #3A4A2A; color: #DCEDC8; }
      html[data-theme="dark"] .tsv2-pay-cell.pay-cas { background: #3A3A3A; color: #E0E0E0; }
      /* Stage U — оф-выплата (бух платит банком) — индиго */
      .tsv2-pay-cell.pay-buh {
        background: #E8EAF6;
        color: #1A237E;
        font-weight: 600;
      }
      html[data-theme="dark"] .tsv2-pay-cell.pay-buh {
        background: rgba(63, 81, 181, 0.15);
        color: #9FA8DA;
      }
      .tsv2-cash-pos { color: #2E7D32; font-weight: 700; }
      .tsv2-cash-neg { color: #C62828; font-weight: 700; }
      html[data-theme="dark"] .tsv2-cash-pos { color: #A5D6A7; }
      html[data-theme="dark"] .tsv2-cash-neg { color: #EF9A9A; }
      .tsv2-limit-badge {
        font-size: 12px; padding: 2px 8px; border-radius: 6px;
        display: inline-block; font-weight: 600; min-width: 80px;
      }
      .tsv2-limit-badge.lim-ok    { background: #E8F5E9; color: #1B5E20; }
      .tsv2-limit-badge.lim-low   { background: #FFEBEE; color: #C62828; }
      html[data-theme="dark"] .tsv2-limit-badge.lim-ok  { background: #2E4D33; color: #C5E1A5; }
      html[data-theme="dark"] .tsv2-limit-badge.lim-low { background: #4D2A2A; color: #EF9A9A; }
      .tsv2-mute { color: var(--t3); }

      /* Phase 1B+ — премии (🎁) и штрафы (⚠) бейджи */
      .tsv2-bonus-cell {
        color: #2E7D32; background: #E8F5E9;
        padding: 2px 6px; border-radius: 4px; font-weight: 600;
        display: inline-block; min-width: 60px;
      }
      .tsv2-penalty-cell {
        color: #C62828; background: #FFEBEE;
        padding: 2px 6px; border-radius: 4px; font-weight: 600;
        display: inline-block; min-width: 60px;
      }
      .tsv2-bonus-cell.muted, .tsv2-penalty-cell.muted {
        color: var(--t3); background: transparent; font-weight: normal;
      }
      html[data-theme="dark"] .tsv2-bonus-cell {
        background: rgba(76, 175, 80, 0.15); color: #A5D6A7;
      }
      html[data-theme="dark"] .tsv2-penalty-cell {
        background: rgba(244, 67, 54, 0.15); color: #EF9A9A;
      }

      /* Stage S — «📤 Уже выплачено в поле» (бейдж в таблице + блок в дашборде) */
      .tsv2-paid-cell {
        display: inline-block; padding: 2px 6px; border-radius: 4px;
        background: #FFF3E0; color: #E65100; font-weight: 600;
        font-size: 12px;
      }
      html[data-theme="dark"] .tsv2-paid-cell {
        background: rgba(255, 152, 0, 0.18); color: #FFAB91;
      }

      .tsv2-dash-paid {
        padding: 12px 14px; border-radius: var(--r-md);
        background: #FFF3E0; border: 1px solid #FFB74D;
        margin-bottom: 12px;
      }
      .tsv2-dash-paid-title {
        font-size: 13px; font-weight: 700; color: #E65100;
        margin-bottom: 8px;
      }
      .tsv2-dash-paid-row {
        display: flex; justify-content: space-between;
        font-size: 13px; color: #BF360C;
      }
      .tsv2-dash-paid-row.total {
        border-top: 1px dashed #FFB74D; padding-top: 6px;
        margin-top: 4px; font-weight: 700;
      }
      .tsv2-dash-paid-hint {
        font-size: 11px; color: #BF360C; opacity: 0.75;
        margin-top: 6px;
      }
      html[data-theme="dark"] .tsv2-dash-paid {
        background: rgba(255, 152, 0, 0.10); border-color: rgba(255, 152, 0, 0.30);
      }
      html[data-theme="dark"] .tsv2-dash-paid-title,
      html[data-theme="dark"] .tsv2-dash-paid-row,
      html[data-theme="dark"] .tsv2-dash-paid-hint { color: #FFCC80; }

      /* Stage U — мини-блок «🏢 Официально устроены» в дашборде (индиго) */
      .tsv2-dash-official {
        padding: 12px 14px;
        border-radius: var(--r-md, 8px);
        background: #E8EAF6;
        border: 1px solid #9FA8DA;
        margin-bottom: 12px;
      }
      .tsv2-dash-official-title {
        font-size: 13px;
        font-weight: 700;
        color: #1A237E;
        margin-bottom: 8px;
      }
      .tsv2-dash-official-row {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        color: #283593;
      }
      .tsv2-dash-official-row.total {
        border-top: 1px dashed #9FA8DA;
        padding-top: 6px;
        margin-top: 4px;
        font-weight: 700;
      }
      html[data-theme="dark"] .tsv2-dash-official {
        background: rgba(63, 81, 181, 0.10);
        border-color: rgba(63, 81, 181, 0.30);
      }
      html[data-theme="dark"] .tsv2-dash-official-title,
      html[data-theme="dark"] .tsv2-dash-official-row { color: #C5CAE9; }

      /* Stage S — подстрока «Осталось» в карточках «На карту»/«Из кассы» */
      .dc-card-remain {
        font-size: 11px; font-weight: 600;
        margin-top: 4px; opacity: 0.85;
      }

      /* Stage W — Tabs (PM mode «📋 Табель» / «💵 Передачи») */
      .tsv2-tabs { display:flex; gap:4px; margin: 0 0 12px; border-bottom: 2px solid var(--brd); }
      .tsv2-tab {
        padding: 8px 14px; background: transparent; border: none; border-bottom: 2px solid transparent;
        font-size: 13px; font-weight: 600; color: var(--t3); cursor: pointer;
        margin-bottom: -2px; position: relative; display:inline-flex; align-items:center; gap:6px;
      }
      .tsv2-tab:hover { color: var(--t1); background: var(--bg2); }
      .tsv2-tab.active { color: var(--gold); border-bottom-color: var(--gold); }
      .tsv2-tab-badge {
        display:inline-flex; align-items:center; justify-content:center;
        min-width:18px; height:18px; padding: 0 5px; border-radius:9px;
        background: var(--gold); color:#1a1409; font-size:10px; font-weight:800;
      }
      html[data-theme="light"] .tsv2-tab.active { color: #B26A00; border-bottom-color: #B26A00; }
      html[data-theme="light"] .tsv2-tab-badge { background:#F9A825; color:#3E2723; }

      /* Stage W — Handovers таблица/строки */
      .hov-wrap { padding: 8px 0 0; }
      .hov-empty {
        text-align:center; padding: 32px; color: var(--t3); font-size: 14px;
        background: var(--bg2); border: 1px dashed var(--brd); border-radius: var(--r-md);
      }
      .hov-table { width:100%; border-collapse: collapse; font-size: 13px; }
      .hov-table th, .hov-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--brd); }
      .hov-table thead th {
        font-size: 11px; font-weight: 700; color: var(--t3); text-transform: uppercase; letter-spacing: .04em;
        background: var(--bg2);
      }
      .hov-table tbody tr:hover td { background: var(--bg2); }
      .hov-table tr.hov-done td { background: rgba(76,175,80,.06); }
      .hov-table tr.hov-pending td { background: rgba(255,193,7,.06); }
      .hov-pill {
        display:inline-flex; align-items:center; gap:4px;
        padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;
      }
      .hov-pill.hov-ok      { background: rgba(76,175,80,.15);  color: var(--acc, #4CAF50); }
      .hov-pill.hov-warn    { background: rgba(255,193,7,.15);  color: var(--warn-t, #F59E0B); }
      .hov-pill.hov-err     { background: rgba(244,67,54,.15);  color: var(--err-t, #EF5350); }
      .hov-btn-full, .hov-btn-part, .hov-btn-no {
        padding: 6px 10px; font-size: 12px; font-weight: 700; border: none; border-radius: var(--r-sm);
        cursor: pointer; margin-right: 6px;
      }
      .hov-btn-full { background: var(--ok-t, #4CAF50); color: #fff; }
      .hov-btn-part { background: var(--gold);          color: #1a1409; }
      .hov-btn-no   { background: var(--bg3);           color: var(--t1); border: 1px solid var(--brd); }
      .hov-btn-full:hover, .hov-btn-part:hover, .hov-btn-no:hover { filter: brightness(1.08); }

      html[data-theme="light"] .hov-table tr.hov-done td    { background: #E8F5E9; }
      html[data-theme="light"] .hov-table tr.hov-pending td { background: #FFF8E1; }
      html[data-theme="light"] .hov-pill.hov-ok    { background:#C8E6C9; color:#2E7D32; }
      html[data-theme="light"] .hov-pill.hov-warn  { background:#FFE0B2; color:#B26A00; }
      html[data-theme="light"] .hov-pill.hov-err   { background:#FFCDD2; color:#C62828; }
      html[data-theme="light"] .hov-btn-full       { background:#2E7D32; }
      html[data-theme="light"] .hov-btn-part       { background:#F9A825; color:#3E2723; }

    `;
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────────────────────────
  // API helpers
  // ─────────────────────────────────────────────────────────────────
  async function apiGet(path) {
    const auth = await AsgardAuth.getAuth();
    const r = await fetch(path, { headers: { 'Authorization': 'Bearer ' + auth.token } });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      const e = new Error(err.error || ('HTTP ' + r.status));
      e.status = r.status; throw e;
    }
    return r.json();
  }
  async function apiSend(method, path, body) {
    const auth = await AsgardAuth.getAuth();
    const r = await fetch(path, {
      method,
      headers: { 'Authorization': 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      const e = new Error(err.error || ('HTTP ' + r.status));
      e.status = r.status; throw e;
    }
    return r.json().catch(() => ({}));
  }

  async function fetchData(year, month, mode) {
    const q = mode ? ('?mode=' + encodeURIComponent(mode)) : '';
    return apiGet(`${API_BASE}/${year}/${month}${q}`);
  }
  async function fetchLocks(year, month) {
    return apiGet(`${API_BASE}/locks/${year}/${month}`);
  }
  // FIX 1 + FIX 2 — расширенный статус закрытия (все 4 scope + список ВСЕХ РП)
  async function fetchClosureStatus(year, month) {
    return apiGet(`${API_BASE}/closure-status/${year}/${month}`);
  }
  // Phase 1E (2026-06-20) — карточка «Касса»: хватает ли нала на ЗП.
  // 404/403/ошибки — silent (карточка просто скрывается).
  async function fetchCashCoverage(year, month) {
    try {
      return await apiGet(`/api/payroll-dashboard/cash-coverage/${year}/${month}`);
    } catch (_) { return null; }
  }
  async function lockMonth(scope, scope_user_id, year, month) {
    return apiSend('POST', `${API_BASE}/lock`, { scope, scope_user_id: scope_user_id || null, year, month });
  }
  async function unlockMonth(lockId) {
    return apiSend('DELETE', `${API_BASE}/lock/${lockId}`);
  }
  async function editCell(payload) {
    return apiSend('PUT', `${API_BASE}/entry`, payload);
  }
  async function exportExcel(year, month) {
    const auth = await AsgardAuth.getAuth();
    const r = await fetch(`${API_BASE}/${year}/${month}/export?format=xlsx`, {
      headers: { 'Authorization': 'Bearer ' + auth.token }
    });
    if (!r.ok) throw new Error('Не удалось скачать Excel');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `табель_${year}_${String(month).padStart(2,'0')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─────────────────────────────────────────────────────────────────
  // Cell render — общий компонент
  // ─────────────────────────────────────────────────────────────────
  function fmt(n) {
    return (n == null) ? '—' : new Intl.NumberFormat('ru-RU').format(Math.round(n));
  }

  // FIX 8 + FIX 11 — расширенный tooltip с телефоном и локализованной ролью
  function tooltipLinesForEntry(emp, dateISO, entry) {
    const meta = TYPE_META[entry.type] || {};
    const dt = new Date(dateISO).toLocaleDateString('ru-RU');
    const lines = [];
    lines.push(`<div class="tt-title">${esc(emp.fio || '—')} · ${esc(dt)}</div>`);
    let row1 = `${meta.icon || ''} ${esc(meta.label || entry.type)}`;
    if (entry.points != null) row1 += ` · ${esc(String(entry.points))} баллов`;
    if (entry.amount != null) row1 += ` · ${esc(fmt(entry.amount))} ₽`;
    lines.push(`<div class="tt-row">${row1}</div>`);
    if (entry.work_title) lines.push(`<div class="tt-row">Объект: ${esc(entry.work_title)}</div>`);
    if (entry.entered_by_fio) {
      const role = entry.entered_by_role ? ` (${esc(roleLabel(entry.entered_by_role))})` : '';
      const phone = entry.entered_by_phone ? ` · ${esc(entry.entered_by_phone)}` : '';
      const at = entry.entered_at ? ` · ${esc(new Date(entry.entered_at).toLocaleString('ru-RU'))}` : '';
      lines.push(`<div class="tt-meta">Внёс: ${esc(entry.entered_by_fio)}${role}${phone}${at}</div>`);
    }
    return lines.join('');
  }

  // FIX 9 — кастомный tooltip-движок (заменяет native title=)
  let _tipEl = null, _tipShowTimer = null;
  function ensureTipEl() {
    if (_tipEl) return _tipEl;
    _tipEl = document.createElement('div');
    _tipEl.className = 'tsv2-tooltip';
    document.body.appendChild(_tipEl);
    window.addEventListener('scroll', () => hideTip(), true);
    return _tipEl;
  }
  function showTip(html, cellEl) {
    clearTimeout(_tipShowTimer);
    _tipShowTimer = setTimeout(() => {
      const el = ensureTipEl();
      el.innerHTML = html;
      const r = cellEl.getBoundingClientRect();
      el.style.left = (r.left + r.width / 2) + 'px';
      el.style.top  = (r.top - 8) + 'px';
      el.classList.add('show');
    }, 300);
  }
  function hideTip() {
    clearTimeout(_tipShowTimer);
    if (_tipEl) _tipEl.classList.remove('show');
  }

  // Phase 1B — 7 финансовых ячеек для строки сотрудника (mode='global')
  // Поля от бэка: pay_type, earned, deduct_salary, transfer_amount,
  //              cash_payout, cash_return, yearly_remaining, monthly_remaining
  function renderPayCells(emp) {
    const payType = emp.pay_type || (emp.is_self_employed ? 'self_employed'
                                   : emp.is_officially_employed ? 'official'
                                   : 'cash');
    const PAY_META = {
      self_employed:        { short: 'СЗ',  full: 'Самозанятый',           cls: 'pay-se'  },
      self_employed_payee:  { short: 'СЗ→', full: 'СЗ через получателя',   cls: 'pay-se'  },
      official:             { short: 'Оф',  full: 'Официальное',           cls: 'pay-of'  },
      cash:                 { short: 'Нал', full: 'Наличными',             cls: 'pay-cas' }
    };
    const meta = PAY_META[payType] || PAY_META.cash;
    const isSE = (payType === 'self_employed' || payType === 'self_employed_payee');

    // Тип
    let html = `<td><span class="tsv2-pay-cell ${meta.cls}" title="${esc(meta.full)}">${esc(meta.short)}</span></td>`;
    // Q3 — «Получает» — кто получает деньги (сам / через ФИО / оклад / наличка)
    const srcLabel = emp.payment_source_label || (
      payType === 'self_employed_payee' ? (emp.payee_fio ? `через ${emp.payee_fio}` : 'через получателя')
      : payType === 'self_employed' ? 'сам'
      : payType === 'official' ? 'оклад'
      : 'наличка'
    );
    const srcCls = payType === 'self_employed_payee' ? 'src-via'
                 : payType === 'self_employed' ? 'src-self'
                 : payType === 'official' ? 'src-salary'
                 : 'src-cash';
    const srcTitle = payType === 'self_employed_payee' && emp.payee_phone
      ? `Через ${emp.payee_fio || 'получателя'} · ${emp.payee_phone}`
      : srcLabel;
    html += `<td><span class="tsv2-src-cell ${srcCls}" title="${esc(srcTitle)}">${esc(srcLabel)}</span></td>`;
    // Заработано ₽
    html += `<td class="tsv2-total">${emp.earned != null ? fmt(emp.earned) + ' ₽' : '—'}</td>`;
    // Stage S — 📤 Уже выплачено в поле ₽ (через worker_payments status IN paid/confirmed)
    const paidTotal = Number(emp.paid_total || 0);
    if (paidTotal > 0) {
      const breakdown = emp.paid_breakdown || {};
      const parts = [];
      if (Number(breakdown.per_diem || 0) > 0) parts.push(`сут ${fmt(breakdown.per_diem)}`);
      if (Number(breakdown.bonus    || 0) > 0) parts.push(`бонус ${fmt(breakdown.bonus)}`);
      if (Number(breakdown.salary   || 0) > 0) parts.push(`зп ${fmt(breakdown.salary)}`);
      if (Number(breakdown.advance  || 0) > 0) parts.push(`аванс ${fmt(breakdown.advance)}`);
      const tt = parts.length
        ? `Налом: ${fmt(emp.paid_cash)} ₽ · Переводом: ${fmt(emp.paid_transfer)} ₽\n` + parts.join(' · ')
        : `Налом: ${fmt(emp.paid_cash)} ₽ · Переводом: ${fmt(emp.paid_transfer)} ₽`;
      html += `<td><span class="tsv2-paid-cell" title="${esc(tt)}">${fmt(paidTotal)} ₽</span></td>`;
    } else {
      html += `<td class="tsv2-mute">—</td>`;
    }
    // 🎁 Премия ₽ — зелёный бейдж когда >0, прочерк когда 0
    const empBonus = Number(emp.bonus || 0);
    if (empBonus > 0) {
      html += `<td><span class="tsv2-bonus-cell" title="Премии за месяц">${fmt(empBonus)} ₽</span></td>`;
    } else {
      html += `<td class="tsv2-mute">—</td>`;
    }
    // ⚠ Штраф ₽ — розовый бейдж когда >0, прочерк когда 0
    const empPenalty = Number(emp.penalty || 0);
    if (empPenalty > 0) {
      html += `<td><span class="tsv2-penalty-cell" title="Штрафы за месяц">${fmt(empPenalty)} ₽</span></td>`;
    } else {
      html += `<td class="tsv2-mute">—</td>`;
    }
    // Оклад ₽ (только оф)
    if (payType === 'official' && emp.deduct_salary != null && Number(emp.deduct_salary) > 0) {
      html += `<td class="tsv2-total">${fmt(emp.deduct_salary)} ₽</td>`;
    } else {
      html += `<td class="tsv2-mute">—</td>`;
    }
    // На карту ₽ — Stage U: подкраска индиго для оф (бух платит банком)
    const transferAmount = Number(emp.transfer_amount || 0);
    if (emp.is_officially_employed && transferAmount > 0) {
      const nonBurnable = Number(emp.official_non_burnable || 0);
      const buhKind = nonBurnable > 0 ? 'несгораемая' : 'оклад';
      html += `<td class="tsv2-total"><span class="tsv2-pay-cell pay-buh" title="Платит бухгалтер через банк (${esc(buhKind)})">🏢 ${fmt(transferAmount)} ₽</span></td>`;
    } else if (transferAmount > 0) {
      html += `<td class="tsv2-total">${fmt(transferAmount)} ₽</td>`;
    } else {
      html += `<td class="tsv2-total"><span class="tsv2-mute">—</span></td>`;
    }
    // Из кассы ₽ — только cash_payout (компания доплачивает налом). Без знаков.
    // Возврат в кассу (cash_return) появится в Phase 3 как отдельная колонка.
    // Stage U: для оф — tooltip «премия наличными сверх оклада»
    const cashOut = Number(emp.cash_payout || 0);
    if (cashOut > 0) {
      const cashTitle = emp.is_officially_employed
        ? 'Платит директор налом сверх оклада (премия наличными)'
        : 'Сумма, выдаваемая наличными из кассы';
      html += `<td class="tsv2-cash-neg" title="${esc(cashTitle)}">${fmt(cashOut)} ₽</td>`;
    } else {
      html += `<td class="tsv2-mute">—</td>`;
    }
    // Лимит СЗ год ост. ₽
    if (!isSE || emp.yearly_remaining == null) {
      html += `<td class="tsv2-mute">—</td>`;
    } else {
      const yr = Number(emp.yearly_remaining);
      const moLim = Number(emp.monthly_remaining != null ? (Number(emp.monthly_used || 0) + Number(emp.monthly_remaining)) : 0);
      // правило из ТЗ: зелёный, если ост.год > 2 × месячный_лимит_компании
      const threshold = moLim > 0 ? moLim * 2 : 0;
      const cls = (threshold > 0 && yr > threshold) ? 'lim-ok' : 'lim-low';
      html += `<td><span class="tsv2-limit-badge ${cls}" title="Остаток годового лимита самозанятого">${fmt(yr)} ₽</span></td>`;
    }
    // Лимит СЗ мес ост. ₽
    if (!isSE || emp.monthly_remaining == null) {
      html += `<td class="tsv2-mute">—</td>`;
    } else {
      const mo = Number(emp.monthly_remaining);
      const cls = mo > 0 ? 'lim-ok' : 'lim-low';
      html += `<td><span class="tsv2-limit-badge ${cls}" title="Остаток месячного лимита самозанятого">${fmt(mo)} ₽</span></td>`;
    }
    return html;
  }

  function renderCellHtml(emp, dateISO, entry, canEdit) {
    if (!entry || !entry.type) {
      const editAttr = canEdit
        ? ' class="tsv2-cell editable" data-tt="Добавить отметку"'
        : ' class="tsv2-cell" style="background:transparent;color:var(--t3)"';
      return `<td><div${editAttr}
        data-emp="${emp.id}" data-date="${dateISO}" data-work="${emp.last_work_id || ''}"
        ></div></td>`;
    }
    const meta = TYPE_META[entry.type] || TYPE_META.day;
    const bg = meta.color, fg = meta.textColor;
    const content = (entry.points != null) ? String(entry.points) : meta.icon;
    const editClass = (canEdit && entry.is_mine) ? ' editable' : '';
    // FIX 9 — title= больше не используется. Передаём данные через data-tt-json (escaped JSON).
    const ttHtml = tooltipLinesForEntry(emp, dateISO, entry);
    const ttData = encodeURIComponent(ttHtml);
    return `<td><div class="tsv2-cell${editClass}"
      style="background:${bg};color:${fg}"
      data-emp="${emp.id}" data-date="${dateISO}" data-work="${entry.work_id || ''}" data-type="${entry.type}"
      data-tt-enc="${ttData}">${esc(content)}</div></td>`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Главный рендерер
  // ─────────────────────────────────────────────────────────────────
  async function renderGrid({ layout, title, mode, toolbarExtra }) {
    injectStyles();
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;

    const now = new Date();
    let curYear = now.getFullYear(), curMonth = now.getMonth() + 1;
    let data = null;

    // Stage W — для PM-режима добавляем вкладку «💵 Передачи от рабочих»
    const showHandoversTab = (mode === 'pm');
    const tabsHtml = showHandoversTab ? `
      <div class="tsv2-tabs" id="tsv2_tabs">
        <button class="tsv2-tab active" data-tab="grid">📋 Табель</button>
        <button class="tsv2-tab"        data-tab="handovers">💵 Передачи <span class="tsv2-tab-badge" id="tsv2_hov_badge" hidden></span></button>
      </div>` : '';

    const html = `
      <div class="panel tsv2-wrap">
        <div class="tsv2-toolbar">
          <div class="tsv2-tb-left">
            <button class="btn ghost" id="tsv2_prev">◀</button>
            <span class="tsv2-period" id="tsv2_period"></span>
            <button class="btn ghost" id="tsv2_next">▶</button>
            <button class="btn ghost" id="tsv2_today" title="К текущему месяцу">📅 Сегодня</button>
          </div>
          <div class="tsv2-tb-right" id="tsv2_toolbar_extra"></div>
        </div>
        ${tabsHtml}
        <div class="tsv2-view tsv2-view-grid" id="tsv2_view_grid">
          <div class="tsv2-locks" id="tsv2_locks"></div>
          <div id="tsv2_dash"></div>
          <div class="tsv2-kpi" id="tsv2_kpi"></div>
          <div class="tsv2-scroll" id="tsv2_scroll">
            <div class="tsv2-loading">Загрузка...</div>
          </div>
        </div>
        <div class="tsv2-view tsv2-view-handovers" id="tsv2_view_handovers" style="display:none">
          <div class="tsv2-loading">Загрузка передач…</div>
        </div>
      </div>
    `;
    await layout(html, { title: title || 'Табель' });

    // ── Stage W — HANDOVERS TAB (только в PM-режиме) ─────────────────────
    let _activeTab = 'grid';
    let _handovers = null;   // [{worker_id, fio, work_id, expected_amount, source_se_transfer_id, handover_id?, handover_status?}]
    let _hovLoaded = null;   // '<year>-<month>' для какой пары загружено

    async function fetchHandovers(y, m) {
      try {
        const j = await apiGet(`/api/timesheet/v2/handovers/${y}/${m}`);
        return Array.isArray(j) ? j : (j.items || j.handovers || []);
      } catch (e) {
        if (e.status === 404) return []; // backend ещё не задеплоен — graceful
        throw e;
      }
    }

    function updateHandoversBadge() {
      const badge = $('#tsv2_hov_badge');
      if (!badge) return;
      const pending = Array.isArray(_handovers)
        ? _handovers.filter(it => !it.handover_status || it.handover_status === 'pending').length
        : 0;
      if (pending > 0) { badge.textContent = String(pending); badge.hidden = false; }
      else { badge.hidden = true; }
    }

    function renderHandoversView() {
      const wrap = $('#tsv2_view_handovers');
      if (!wrap) return;

      if (_handovers == null) {
        wrap.innerHTML = `<div class="tsv2-loading">Загрузка передач…</div>`;
        return;
      }

      if (!_handovers.length) {
        wrap.innerHTML = `
          <div class="hov-wrap">
            <div class="hov-empty">📭 Передач за этот месяц нет.<br>Когда бухгалтер сделает перевод СЗ — здесь появятся ожидаемые суммы.</div>
          </div>`;
        return;
      }

      const rows = _handovers.map(it => {
        const fio = esc(it.fio || it.full_name || ('Рабочий #' + it.worker_id));
        const amt = fmt(it.expected_amount || 0) + ' ₽';
        const st = it.handover_status || (it.handover_id ? 'received' : 'pending');
        if (st === 'received') {
          return `<tr class="hov-done">
            <td>${fio}</td><td>${amt}</td>
            <td><span class="hov-pill hov-ok">✓ Получено</span></td>
          </tr>`;
        }
        if (st === 'partial') {
          const rec = it.received_amount != null ? (fmt(it.received_amount) + ' ₽') : '?';
          return `<tr class="hov-pending">
            <td>${fio}</td><td>${amt} <small style="color:var(--t3)">(принято ${rec})</small></td>
            <td><span class="hov-pill hov-warn">◐ Частично</span></td>
          </tr>`;
        }
        if (st === 'not_received') {
          return `<tr class="hov-pending">
            <td>${fio}</td><td>${amt}</td>
            <td><span class="hov-pill hov-err">✗ Не получено</span></td>
          </tr>`;
        }
        // pending — три кнопки
        return `<tr class="hov-pending"
              data-worker="${it.worker_id}"
              data-work="${it.work_id || ''}"
              data-transfer="${it.source_se_transfer_id || ''}"
              data-expected="${it.expected_amount || 0}">
          <td>${fio}</td>
          <td>${amt}</td>
          <td>
            <button class="hov-btn-full" data-action="full">Получено полностью</button>
            <button class="hov-btn-part" data-action="part">Частично…</button>
            <button class="hov-btn-no"   data-action="no">Не получено</button>
          </td>
        </tr>`;
      }).join('');

      wrap.innerHTML = `
        <div class="hov-wrap">
          <table class="hov-table">
            <thead><tr><th>Рабочий</th><th>Сумма к получению</th><th>Действие</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;

      // Bind buttons
      wrap.querySelectorAll('tr[data-worker]').forEach(tr => {
        tr.addEventListener('click', async (ev) => {
          const btn = ev.target.closest('button[data-action]');
          if (!btn) return;
          const workerId = parseInt(tr.dataset.worker, 10);
          const workId = tr.dataset.work ? parseInt(tr.dataset.work, 10) : null;
          const transferId = tr.dataset.transfer ? parseInt(tr.dataset.transfer, 10) : null;
          const expected = parseFloat(tr.dataset.expected) || 0;
          const action = btn.dataset.action;
          try {
            if (action === 'full') {
              await postHandover({ workerId, workId, transferId, expected,
                                   received: expected, status: 'received' });
              toast('Передача зафиксирована', '', 'ok');
            } else if (action === 'part') {
              const raw = window.prompt(`Частично получено от рабочего (₽). Ожидалось: ${fmt(expected)} ₽`, String(expected));
              if (raw == null) return;
              const v = parseFloat(String(raw).replace(',', '.'));
              if (!isFinite(v) || v < 0) { toast('Неверная сумма', '', 'err'); return; }
              await postHandover({ workerId, workId, transferId, expected,
                                   received: v, status: 'partial' });
              toast('Частичная передача зафиксирована', '', 'ok');
            } else if (action === 'no') {
              const note = window.prompt('Комментарий (опционально):', '') || '';
              await postHandover({ workerId, workId, transferId, expected,
                                   received: 0, status: 'not_received', note });
              toast('Отмечено: не получено', '', 'ok');
            }
            await reloadHandovers();
          } catch (e) {
            toast('Ошибка', e.message || 'Не удалось сохранить', 'err');
          }
        });
      });
    }

    async function postHandover({ workerId, workId, transferId, expected, received, status, note }) {
      const body = {
        worker_id: workerId,
        work_id: workId,
        year: curYear, month: curMonth,
        source_se_transfer_id: transferId,
        expected_amount: expected,
        received_amount: received,
        status
      };
      if (note) body.note = note;
      return apiSend('POST', '/api/handovers/', body);
    }

    async function reloadHandovers() {
      try {
        _handovers = await fetchHandovers(curYear, curMonth);
        _hovLoaded = `${curYear}-${curMonth}`;
      } catch (e) {
        _handovers = [];
        toast('Ошибка', 'Не удалось загрузить передачи: ' + (e.message || ''), 'err');
      }
      renderHandoversView();
      updateHandoversBadge();
    }

    function switchTab(tab) {
      _activeTab = tab;
      const tabs = document.querySelectorAll('#tsv2_tabs .tsv2-tab');
      tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      const gridV = $('#tsv2_view_grid');
      const hovV = $('#tsv2_view_handovers');
      if (gridV) gridV.style.display = (tab === 'grid') ? '' : 'none';
      if (hovV)  hovV.style.display  = (tab === 'handovers') ? '' : 'none';
      if (tab === 'handovers' && _hovLoaded !== `${curYear}-${curMonth}`) {
        reloadHandovers();
      }
    }

    // bind tab clicks (only if tabs exist — PM mode)
    document.querySelectorAll('#tsv2_tabs .tsv2-tab').forEach(b => {
      b.addEventListener('click', () => switchTab(b.dataset.tab));
    });

    // PM mode — фоновый pre-fetch чтобы бейдж появился сразу
    if (showHandoversTab) {
      // запускаем без await — не блокируем основной рендер
      reloadHandovers();
    }

    function updatePeriodLabel() {
      const el = $('#tsv2_period');
      if (el) el.textContent = new Date(curYear, curMonth - 1).toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
    }

    function renderToolbarExtra() {
      const box = $('#tsv2_toolbar_extra');
      if (!box) return;
      const buttons = [];
      const extras = toolbarExtra || [];

      if (extras.includes('add-worker')) {
        buttons.push(`<button class="btn primary" id="tsv2_add_worker">＋ Добавить рабочего</button>`);
      }
      // Кнопка «🔒 Закрыть месяц» вынесена в панель «Закрытие месяца» (LockBadges) — там она контекстная (на каждой scope-строке своя)
      if (extras.includes('excel')) {
        buttons.push(`<button class="btn primary" id="tsv2_excel">📥 Excel</button>`);
      }
      buttons.push(`<button class="btn ghost" id="tsv2_refresh">🔄 Обновить</button>`);

      box.innerHTML = buttons.join('');

      const addBtn = $('#tsv2_add_worker');
      if (addBtn) addBtn.addEventListener('click', openAddWorkerModal);
      const lockBtn = $('#tsv2_lock');
      if (lockBtn) lockBtn.addEventListener('click', onLockClick);
      const xlsBtn = $('#tsv2_excel');
      if (xlsBtn) xlsBtn.addEventListener('click', async () => {
        try { await exportExcel(curYear, curMonth); toast('Экспорт','Файл скачан','ok'); }
        catch (e) { toast('Ошибка', e.message, 'err'); }
      });
      const refBtn = $('#tsv2_refresh');
      if (refBtn) refBtn.addEventListener('click', refresh);
    }

    // FIX 1 + FIX 2 + FIX 15 — новый блок «Закрытие месяца»:
    //   - 4 scope-бейджа (warehouse/medical/travel/global) с обоими состояниями
    //   - Для global-mode: таблица ВСЕХ РП с статусом закрытия (сортировка: открытые сверху)
    //   - Заголовок «Закрытие месяца — <Период>»
    function renderLocks() {
      const box = $('#tsv2_locks');
      if (!box) return;

      const cs = data && data.closureStatus;
      // Fallback: если closure-status не пришёл, синтезируем из старого locks[]
      const scopeLocks = (cs && cs.scope_locks) || synthesizeScopeLocks((data && data.locks) || []);
      const pmLocks = (cs && cs.pm_locks) || synthesizePmLocks((data && data.locks) || []);

      const period = new Date(curYear, curMonth - 1).toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
      const isGlobal = mode === 'global';
      const myScope = MODE_LOCK_SCOPE[mode];

      const rows = [];
      rows.push(`<div class="tsv2-locks-title">Закрытие месяца — ${esc(period)}</div>`);

      if (isGlobal) {
        // РП (все)
        if (pmLocks.length) {
          const sorted = [...pmLocks].sort((a, b) => {
            if (a.locked !== b.locked) return a.locked ? 1 : -1;
            return String(a.fio || '').localeCompare(String(b.fio || ''));
          });
          const chips = sorted.map(p => renderPmChip(p)).join('');
          rows.push(
            `<div class="tsv2-lock-row" style="align-items:flex-start">
               <div class="tsv2-lock-row-label">РП:</div>
               <div class="tsv2-pm-grid">${chips}</div>
             </div>`
          );
        }
        // Доп. виды
        rows.push(
          `<div class="tsv2-lock-row">
             <div class="tsv2-lock-row-label">Доп. виды:</div>
             ${renderScopeBadge('warehouse', scopeLocks.warehouse)}
             ${renderScopeBadge('medical',   scopeLocks.medical)}
             ${renderScopeBadge('travel',    scopeLocks.travel)}
           </div>`
        );
        // Общий
        const globalSl = scopeLocks.global || { locked: false };
        rows.push(
          `<div class="tsv2-lock-row">
             <div class="tsv2-lock-row-label">Общий:</div>
             ${renderScopeBadge('global', globalSl)}
             ${!globalSl.locked ? `<button class="btn primary" id="tsv2_lock_inline">🔒 Закрыть месяц</button>` : ''}
           </div>`
        );
      } else {
        // Не-global: свой статус + справочные бейджи
        if (mode === 'pm') {
          const my = pmLocks.find(p => p.user_id === user.id) || { user_id: user.id, fio: user.name || 'Вы', locked: false };
          rows.push(
            `<div class="tsv2-lock-row">
               <div class="tsv2-lock-row-label">Мой табель:</div>
               ${renderPmChip(my)}
               ${!my.locked ? `<button class="btn primary" id="tsv2_lock_inline">🔒 Закрыть свой табель</button>` : ''}
             </div>`
          );
        } else if (myScope) {
          const sl = scopeLocks[myScope] || { locked: false };
          rows.push(
            `<div class="tsv2-lock-row">
               <div class="tsv2-lock-row-label">Мой scope:</div>
               ${renderScopeBadge(myScope, sl)}
               ${!sl.locked ? `<button class="btn primary" id="tsv2_lock_inline">🔒 Закрыть месяц</button>` : ''}
             </div>`
          );
        }
        // Справочные бейджи всех видов
        rows.push(
          `<div class="tsv2-lock-row">
             <div class="tsv2-lock-row-label">Статус:</div>
             ${renderScopeBadge('warehouse', scopeLocks.warehouse, true)}
             ${renderScopeBadge('medical',   scopeLocks.medical, true)}
             ${renderScopeBadge('travel',    scopeLocks.travel, true)}
             ${renderScopeBadge('global',    scopeLocks.global, true)}
           </div>`
        );
      }

      box.innerHTML = rows.join('');

      // Кнопки «Открыть» (unlock) — на любом scope/pm chip
      box.querySelectorAll('.unlock').forEach(btn => {
        btn.addEventListener('click', async () => {
          const lockId = btn.dataset.lockid;
          if (!lockId) return;
          if (!confirm('Открыть месяц (снять закрытие)?')) return;
          try { await unlockMonth(lockId); toast('Готово','Месяц открыт','ok'); await refresh(); }
          catch (e) { toast('Ошибка', e.message, 'err'); }
        });
      });
      // Кнопки «Напомнить» (FIX 2 — пока TODO endpoint)
      box.querySelectorAll('.tsv2-pm-remind').forEach(btn => {
        btn.addEventListener('click', () => {
          const fio = btn.dataset.fio || '';
          toast('Напоминание', `Поставлено в очередь для ${fio} (TODO: endpoint)`, 'ok');
        });
      });
      // Кнопка inline lock (FIX 15 — заменяет toolbar-lock в global)
      const lockInline = $('#tsv2_lock_inline');
      if (lockInline) lockInline.addEventListener('click', onLockClick);
    }

    function renderScopeBadge(scope, sl, dim) {
      const meta = ({
        warehouse: { icon: '📦', label: 'Склад' },
        medical:   { icon: '🏥', label: 'МО' },
        travel:    { icon: '✈️', label: 'Дорога' },
        global:    { icon: '🔒', label: 'Общий' }
      })[scope] || { icon: '🔒', label: scope };
      const locked = !!(sl && sl.locked);
      if (locked) {
        const at = sl.locked_at ? new Date(sl.locked_at).toLocaleDateString('ru-RU') : '';
        const by = sl.locked_by_fio ? ` · ${esc(sl.locked_by_fio)}` : '';
        const canUn = canUnlockSl({ ...sl, scope });
        const un = canUn ? `<button class="unlock" data-lockid="${sl.lock_id}" title="Снять закрытие">🔓</button>` : '';
        return `<span class="tsv2-lock-chip locked">🔒 ${meta.icon} ${meta.label}: закрыт${at ? ' с ' + at : ''}${by}${un}</span>`;
      }
      return `<span class="tsv2-lock-chip unlocked"${dim ? ' style="opacity:.75"' : ''}>${meta.icon} ${meta.label}: открыт</span>`;
    }

    function renderPmChip(p) {
      const locked = !!p.locked;
      const cls = locked ? 'locked' : 'open';
      const icon = locked ? '✅' : '❌';
      const dt = p.locked_at ? new Date(p.locked_at).toLocaleDateString('ru-RU') : '';
      const canUn = canUnlockSl({ ...p, scope: 'pm' });
      const un = locked && canUn
        ? `<button class="unlock" data-lockid="${p.lock_id}" title="Открыть месяц ${esc(p.fio)}">🔓</button>`
        : '';
      const remind = !locked
        ? `<button class="tsv2-pm-remind" data-fio="${esc(p.fio)}" title="Напомнить РП закрыть">Напомнить</button>`
        : '';
      const status = locked
        ? `<span class="status" title="Закрыл: ${esc(p.fio)}\n${dt}">${esc(dt)}${un}</span>`
        : `<span class="status">Не закрыл${remind}</span>`;
      return `<div class="tsv2-pm-chip ${cls}"><div class="fio" title="${esc(p.fio)}">${icon} ${esc(p.fio)}</div>${status}</div>`;
    }

    function synthesizeScopeLocks(arr) {
      const out = {
        warehouse: { locked: false }, medical: { locked: false },
        travel: { locked: false }, global: { locked: false }
      };
      for (const l of arr) {
        if (!l.locked_at || l.scope === 'pm') continue;
        if (out[l.scope]) {
          out[l.scope] = { locked: true, locked_at: l.locked_at,
            locked_by: l.locked_by, locked_by_fio: l.locked_by_fio, lock_id: l.id };
        }
      }
      return out;
    }
    function synthesizePmLocks(arr) {
      return arr.filter(l => l.scope === 'pm' && l.locked_at).map(l => ({
        user_id: l.scope_user_id, fio: l.scope_user_fio || '—',
        locked: true, locked_at: l.locked_at, locked_by: l.locked_by, lock_id: l.id
      }));
    }
    function canUnlockSl(slLike) {
      const role = user.role;
      const isDir = role && (role.startsWith('DIRECTOR') || role === 'ADMIN');
      if (isDir) return !!slLike.lock_id;
      if (slLike.locked_by === user.id) return !!slLike.lock_id;
      return false;
    }

    function canUnlockLock(lock) {
      const role = user.role;
      const isDir = role && (role.startsWith('DIRECTOR') || role === 'ADMIN');
      if (isDir) return true;
      if (lock.locked_by === user.id) return true;
      return false;
    }

    function isModeLockedForViewer() {
      const locks = (data && data.locks) || [];
      // 1) Любой неснятый глобальный лок — всем кроме DIRECTOR/ADMIN
      const isDir = user.role && (user.role.startsWith('DIRECTOR') || user.role === 'ADMIN');
      const g = locks.find(l => l.scope === 'global' && l.locked_at && !l.unlocked_at);
      if (g && !isDir) return true;
      // 2) Свой scope-лок
      const myScope = MODE_LOCK_SCOPE[mode];
      const own = locks.find(l => l.scope === myScope && l.locked_at && !l.unlocked_at && (
        myScope !== 'pm' ? true : (!l.scope_user_id || l.scope_user_id === user.id)
      ));
      if (own && !isDir) return true;
      return false;
    }

    async function onLockClick() {
      const scope = MODE_LOCK_SCOPE[mode];
      const period = `${MONTHS_RU[curMonth-1]} ${curYear}`;
      // FIX 16 — человеческие подписи без техжаргона (никаких scope=pm)
      const scopeText = ({
        pm: 'свой табель',
        warehouse: 'табель склада',
        medical: 'табель медосмотров',
        travel: 'табель дороги',
        global: 'общий табель (всё)'
      })[scope] || period;
      if (!confirm(`Закрыть ${scopeText} за ${period}?\nПосле закрытия редактирование будет запрещено.`)) return;
      try {
        const payload = { scope };
        if (scope === 'pm') payload.scope_user_id = user.id;
        await lockMonth(payload.scope, payload.scope_user_id, curYear, curMonth);
        toast('Готово', 'Месяц закрыт', 'ok');
        await refresh();
      } catch (e) {
        toast('Ошибка', e.message, 'err');
      }
    }

    // Phase 1E (2026-06-20) — компактный финансовый дашборд.
    // Только mode='global' + data.summary != null.
    // Структура:
    //   1) Шапка-чипы (рабочих/дней/типы)
    //   2) Большая карточка «Заработали» (Σ + премии/штрафы)
    //   3) Две колонки «На карту» + «Из кассы»
    //   4) Карточка «Касса» (хватает ли нала на ЗП) — fetch cash-coverage
    //   5) Карточка «Лимиты СЗ» (мес+год в одну строку)
    function renderDashboard() {
      const box = $('#tsv2_dash');
      if (!box) return;
      const sum = data && data.summary;
      if (mode !== 'global' || !sum) { box.innerHTML = ''; return; }

      const byType = sum.by_type || {};
      const se  = Number(byType.self_employed || 0);
      const of  = Number(byType.official || 0);
      const cas = Number(byType.cash || 0);
      const empCnt = Number(sum.employees_count || (se + of + cas));
      const daysTotal = Number(sum.days_total || 0);

      const earned   = Number(sum.total_earned || 0);
      const bonus    = Number(sum.total_bonus   || 0);
      const penalty  = Number(sum.total_penalty || 0);
      const transfer = Number(sum.total_transfer || 0);
      const cashOut  = Number(sum.total_cash_payout || 0);

      // Stage S — уже выплачено через полевой модуль
      const paidCash     = Number(sum.total_paid_cash     || 0);
      const paidTransfer = Number(sum.total_paid_transfer || 0);
      const paidTotal    = Number(sum.total_paid_total    || (paidCash + paidTransfer));
      const cashRemain   = Number(sum.total_cash_needed_remaining != null
                              ? sum.total_cash_needed_remaining
                              : Math.max(0, cashOut - paidCash));
      const transferRemain = Number(sum.total_transfer_remaining != null
                              ? sum.total_transfer_remaining
                              : Math.max(0, transfer - paidTransfer));

      // Stage S — агрегируем paid_breakdown по сотрудникам для хинта блока
      const paidBreakSum = { per_diem: 0, salary: 0, advance: 0, bonus: 0 };
      const empsArr = (data && data.employees) || [];
      empsArr.forEach(e => {
        const b = e.paid_breakdown || {};
        paidBreakSum.per_diem += Number(b.per_diem || 0);
        paidBreakSum.salary   += Number(b.salary   || 0);
        paidBreakSum.advance  += Number(b.advance  || 0);
        paidBreakSum.bonus    += Number(b.bonus    || 0);
      });

      const limits = sum.limits || {};
      const limMonth   = Number(limits.monthly || 0);
      const limYear    = Number(limits.yearly  || 0);
      const seCnt              = Number(limits.se_count || 0);
      const monthRemainCo      = Number(limits.month_remaining_company || 0);
      const monthCapacityCo    = Number(limits.total_monthly_capacity  || (seCnt * limMonth));
      const yearRemainCo       = Number(limits.year_remaining_company  || 0);
      const yearCapacityCo     = Number(limits.total_yearly_capacity   || (seCnt * limYear));
      // % СВОБОДНО (чем меньше — тем краснее)
      const pctMonthFree = monthCapacityCo > 0 ? Math.max(0, Math.min(100, Math.round(monthRemainCo / monthCapacityCo * 100))) : 0;
      const pctYearFree  = yearCapacityCo  > 0 ? Math.max(0, Math.min(100, Math.round(yearRemainCo  / yearCapacityCo  * 100))) : 0;
      const remainCls = (pct) => pct >= 50 ? 'remain-ok' : (pct >= 20 ? 'remain-warn' : 'remain-low');
      const remainBadge = (pct) => pct >= 50 ? '✓' : (pct >= 20 ? '⚠' : '⛔');
      const haveCompanyLimits = (monthCapacityCo > 0 || yearCapacityCo > 0);

      // Подсказка: «в т.ч.» а не «+/−», иначе пользователь думает что нужно прибавлять/вычитать
      // (719k earned УЖЕ включает 130k премии). Премии: только paid (выплачены и видны в полевом модуле).
      const earnedSub = (bonus > 0 || penalty > 0)
        ? `<div class="dc-earned-sub">
             <span class="dc-sub-inclnote">в т.ч.:</span>
             ${bonus   > 0 ? `<span class="dc-sub-bonus" title="Премии за этот месяц (включены в Σ Заработано)">${fmt(bonus)} ₽ премий</span>`   : ''}
             ${penalty > 0 ? `<span class="dc-sub-penalty" title="Штрафы (уже вычтены из Σ Заработано)">${fmt(penalty)} ₽ штрафов вычтено</span>` : ''}
           </div>`
        : '';

      // ─── Шапка: компактная строка чипов ───
      const headRow = `
        <div class="tsv2-dash-headrow">
          <span class="tsv2-dash-chip dc-chip-bold">👥 ${empCnt} раб</span>
          <span class="tsv2-dash-chip dc-chip-mute">📅 ${fmt(daysTotal)} дн</span>
          <span class="tsv2-dash-sep-dot">·</span>
          <span class="tsv2-dash-chip dt-se"><span class="dt-dot"></span>СЗ: ${se}</span>
          <span class="tsv2-dash-chip dt-of"><span class="dt-dot"></span>Оф: ${of}</span>
          <span class="tsv2-dash-chip dt-cas"><span class="dt-dot"></span>Нал: ${cas}</span>
        </div>
      `;

      // ─── Заработали: большая карточка ───
      const earnedBlock = `
        <div class="tsv2-dash-earned-big">
          <div class="dc-earned-label">Σ Заработано за месяц</div>
          <div class="dc-earned-value">${fmt(earned)} ₽</div>
          ${earnedSub}
        </div>
      `;

      // ─── 2 колонки: На карту + Из кассы ───
      // Stage S — под каждой подстрока «Осталось: X ₽» (только если что-то уже выплачено)
      const transferRemainSub = (paidTransfer > 0)
        ? `<div class="dc-card-remain">Осталось: ${fmt(transferRemain)} ₽</div>` : '';
      const cashRemainSub = (paidCash > 0)
        ? `<div class="dc-card-remain">Осталось: ${fmt(cashRemain)} ₽</div>` : '';
      const splitBlock = `
        <div class="tsv2-dash-split">
          <div class="tsv2-dash-card dc-transfer">
            <div class="dc-label">💳 На карту (банк)</div>
            <div class="dc-value">${fmt(transfer)} ₽</div>
            <div class="dc-card-hint">СЗ через банк + оф оклады</div>
            ${transferRemainSub}
          </div>
          <div class="tsv2-dash-card dc-cash-out">
            <div class="dc-label">💵 Из кассы (нал)</div>
            <div class="dc-value">${fmt(cashOut)} ₽</div>
            <div class="dc-card-hint">Доплаты нал-рабочим</div>
            ${cashRemainSub}
          </div>
        </div>
      `;

      // ─── Stage S: 📤 УЖЕ ВЫПЛАЧЕНО В ПОЛЕ ───
      // Показываем только если total_paid_total > 0
      let paidBlock = '';
      if (paidTotal > 0) {
        const hintParts = [];
        if (paidBreakSum.bonus    > 0) hintParts.push(`${fmt(paidBreakSum.bonus)} ₽ премии`);
        if (paidBreakSum.per_diem > 0) hintParts.push(`${fmt(paidBreakSum.per_diem)} ₽ суточные`);
        if (paidBreakSum.salary   > 0) hintParts.push(`${fmt(paidBreakSum.salary)} ₽ зп`);
        if (paidBreakSum.advance  > 0) hintParts.push(`${fmt(paidBreakSum.advance)} ₽ авансы`);
        const hint = hintParts.length
          ? `<div class="tsv2-dash-paid-hint">💡 ${hintParts.join(' · ')}</div>`
          : '';
        paidBlock = `
          <div class="tsv2-dash-paid">
            <div class="tsv2-dash-paid-title">📤 УЖЕ ВЫПЛАЧЕНО В ПОЛЕ</div>
            <div class="tsv2-dash-paid-row">
              <span>Налом (РП в поле):</span>
              <span>${fmt(paidCash)} ₽</span>
            </div>
            <div class="tsv2-dash-paid-row">
              <span>Переводом:</span>
              <span>${fmt(paidTransfer)} ₽</span>
            </div>
            <div class="tsv2-dash-paid-row total">
              <span>Всего:</span>
              <span>${fmt(paidTotal)} ₽</span>
            </div>
            ${hint}
          </div>
        `;
      }

      // ─── Stage U: 🏢 ОФИЦИАЛЬНО УСТРОЕНЫ (бух платит банком) ───
      // Показываем только если total_official_count > 0
      const offCount  = Number(sum.total_official_count || 0);
      const offToPay  = Number(sum.total_official_to_pay_by_buh || 0);
      const offPaid   = Number(sum.total_official_paid_by_buh   || 0);
      const offRemain = Number(sum.total_official_remaining_by_buh != null
                                ? sum.total_official_remaining_by_buh
                                : Math.max(0, offToPay - offPaid));
      const officialBlock = offCount > 0 ? `
        <div class="tsv2-dash-official">
          <div class="tsv2-dash-official-title">🏢 Официально устроены (${offCount} чел)</div>
          <div class="tsv2-dash-official-row">
            <span>К выплате бухом:</span><span>${fmt(offToPay)} ₽</span>
          </div>
          <div class="tsv2-dash-official-row">
            <span>Уже выплачено бухом:</span><span>${fmt(offPaid)} ₽</span>
          </div>
          <div class="tsv2-dash-official-row total">
            <span>Осталось бух:</span><span>${fmt(offRemain)} ₽</span>
          </div>
        </div>
      ` : '';

      // ─── Касса: хватает ли нала ───
      const cashBlock = renderCashCoverageBlock(data.cashCoverage);

      // ─── Лимиты СЗ (компактно, мес+год в одной карточке) ───
      const limitsBlock = haveCompanyLimits ? `
        <div class="tsv2-dash-limits-card">
          <div class="tsv2-dash-limits-title">🟢 Лимиты СЗ — не исчерпаны?</div>
          ${monthCapacityCo > 0 ? `
          <div class="tsv2-dash-limit-row">
            <div class="tsv2-dash-limit-label">Мес: <b>${fmt(monthRemainCo)}</b> из ${fmt(monthCapacityCo)} ₽</div>
            <div class="tsv2-dash-limit-bar">
              <div class="tsv2-dash-limit-fill ${remainCls(pctMonthFree)}" style="width:${pctMonthFree}%"></div>
            </div>
            <div class="tsv2-dash-limit-pct">${pctMonthFree}% свободно ${remainBadge(pctMonthFree)}</div>
          </div>` : ''}
          ${yearCapacityCo > 0 ? `
          <div class="tsv2-dash-limit-row">
            <div class="tsv2-dash-limit-label">Год: <b>${fmt(yearRemainCo)}</b> из ${fmt(yearCapacityCo)} ₽</div>
            <div class="tsv2-dash-limit-bar">
              <div class="tsv2-dash-limit-fill ${remainCls(pctYearFree)}" style="width:${pctYearFree}%"></div>
            </div>
            <div class="tsv2-dash-limit-pct">${pctYearFree}% свободно ${remainBadge(pctYearFree)}</div>
          </div>` : ''}
        </div>
      ` : '';

      box.innerHTML = `<div class="tsv2-dash">
        ${headRow}
        ${earnedBlock}
        ${splitBlock}
        ${paidBlock}
        ${officialBlock}
        ${cashBlock}
        ${limitsBlock}
      </div>`;
    }

    // Phase 1E — карточка «🏦 КАССА» с балансом, нуждой и эффективным балансом.
    // Возвращает HTML строкой (пусто если cc == null).
    function renderCashCoverageBlock(cc) {
      if (!cc) return '';
      const balance = Number(cc.cash_balance || 0);
      const needed  = Number(cc.cash_needed || 0);
      const pending = Number(cc.pending_returns || 0);
      const effective = Number(cc.effective_balance || (balance + pending));
      const diff = Number(cc.diff != null ? cc.diff : (effective - needed));
      const pct = Number(cc.coverage_pct != null ? cc.coverage_pct : (needed > 0 ? Math.round(effective / needed * 100) : 100));
      const advancesSum = Number(cc.advances_outstanding || 0);
      const advancesCnt = Number(cc.advances_count || 0);
      const status = cc.status || 'ok';
      const statusLabel = cc.status_label || '';

      // Класс/иконка/подпись по статусу
      const statusCls = `cash-status-${status}`;
      const statusIcon = (
        status === 'ok'             ? '✅'
      : status === 'ok_with_returns' ? '🟢'
      : status === 'tight'           ? '⚠'
      : /* shortage */                 '❌'
      );

      // Для бара показываем процент покрытия, обрезанный в [0..100] (выше — full).
      const barPct = Math.min(100, Math.max(0, pct));
      const diffPrefix = diff < 0 ? '−' : (diff > 0 ? '+' : '');
      const diffAbs = Math.abs(diff);
      const diffCls = diff < 0 ? 'cash-diff-neg' : (diff > 0 ? 'cash-diff-pos' : 'cash-diff-zero');

      const advancesRow = advancesSum > 0 ? `
        <div class="cash-advances">
          💡 Дополнительно — <b>${fmt(advancesSum)} ₽</b> выданы РП на руках (${advancesCnt} заявк${advancesCnt === 1 ? 'а' : (advancesCnt < 5 ? 'и' : '')})
        </div>` : '';

      const action = diff < 0 ? `
        <div class="cash-action cash-action-bad">${statusIcon} ${esc(statusLabel)} — нужно пополнить ${fmt(diffAbs)} ₽</div>
      ` : `
        <div class="cash-action cash-action-good">${statusIcon} ${esc(statusLabel)}</div>
      `;

      return `
        <div class="tsv2-dash-cash ${statusCls}">
          <div class="cash-title">🏦 Касса — есть ли деньги на ЗП?</div>
          <div class="cash-grid">
            <div class="cash-col cash-col-left">
              <div class="cash-row"><span class="cash-label">В кассе:</span><span class="cash-num">${fmt(balance)} ₽</span></div>
              <div class="cash-row"><span class="cash-label">+ Ожидается возвратов:</span><span class="cash-num cash-num-mut">${fmt(pending)} ₽</span></div>
              <div class="cash-row cash-row-sep">
                <span class="cash-label cash-label-bold">= Эффективно:</span>
                <span class="cash-num cash-num-bold">${fmt(effective)} ₽</span>
              </div>
            </div>
            <div class="cash-col cash-col-right">
              <div class="cash-row"><span class="cash-label">Нужно на ЗП:</span><span class="cash-num">${fmt(needed)} ₽</span></div>
              <div class="cash-row cash-row-sep">
                <span class="cash-label cash-label-bold">${diff < 0 ? 'Дефицит:' : 'Профицит:'}</span>
                <span class="cash-num cash-num-bold ${diffCls}">${diffPrefix}${fmt(diffAbs)} ₽</span>
              </div>
              <div class="cash-pct">${pct}% покрыто</div>
            </div>
          </div>
          <div class="cash-bar">
            <div class="cash-bar-fill ${statusCls}" style="width:${barPct}%"></div>
          </div>
          ${action}
          ${advancesRow}
        </div>
      `;
    }

    function renderKpi() {
      const box = $('#tsv2_kpi');
      if (!box) return;
      const emps = (data && data.employees) || [];
      const workers = emps.length;
      let shifts = 0, fot = 0, perDiem = 0;
      emps.forEach(e => {
        shifts += (e.days_count != null) ? Number(e.days_count) : Object.keys(e.days || {}).filter(d => (e.days[d] && e.days[d].type)).length;
        fot += Number(e.total_amount || 0);
        perDiem += Number(e.per_diem_total || 0);
      });
      // ФОТ видит только директор/бух/HR/админ (global). РП не видит ФОТ — по ТЗ.
      const showAmount = (mode === 'global');
      // Суточные скрыты везде — расчёт ненадёжен (источник worker_payments хранит длинные командировки).
      const showPerDiem = false;
      const items = [
        `<div class="tsv2-kpi-card k-workers">👥 ${workers} рабочих</div>`,
        `<div class="tsv2-kpi-card k-shifts">📅 ${shifts} чел-дней</div>`
      ];
      if (showAmount)   items.push(`<div class="tsv2-kpi-card k-fot">💰 ФОТ: ${fmt(fot)} ₽</div>`);
      if (showPerDiem)  items.push(`<div class="tsv2-kpi-card k-perdiem">🍞 Суточные: ${fmt(perDiem)} ₽</div>`);
      box.innerHTML = items.join('');
    }

    function renderTable() {
      const wrap = $('#tsv2_scroll');
      if (!wrap) return;
      if (!data || !data.employees || !data.employees.length) {
        wrap.innerHTML = `<div class="tsv2-empty">
          Нет данных за выбранный период.<br>
          <span style="font-size:12px">Показаны рабочие, у кого есть хотя бы одна отметка.</span>
        </div>`;
        return;
      }
      const employees = data.employees;
      const daysInMonth = data.days_in_month || new Date(curYear, curMonth, 0).getDate();
      const todayD = (new Date().getFullYear() === curYear && new Date().getMonth() + 1 === curMonth) ? new Date().getDate() : -1;

      // Header
      let header = '<thead><tr><th>ФИО / Должность</th>';
      if (mode === 'global') header += '<th title="Город проживания">Город</th>';
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(curYear, curMonth - 1, d);
        const wd = dt.getDay();
        let cls = '';
        if (wd === 0 || wd === 6) cls += ' tsv2-day-weekend';
        if (d === todayD) cls += ' tsv2-day-today';
        header += `<th class="${cls.trim()}">${d}</th>`;
      }
      // Колонки итогов: дни / баллы (если PM/GLOBAL) / ФОТ (если PM/GLOBAL) / суточные (если PM)
      header += `<th class="tsv2-total">Дни</th>`;
      if (mode === 'pm' || mode === 'global') header += `<th class="tsv2-total">Баллы</th>`;
      if (mode === 'global') header += `<th class="tsv2-total">Сумма ₽</th>`;
      // Phase 1B — 9 финансовых колонок (только global)
      // 1B+: между «Заработано» и «Оклад» добавлены 🎁 Премия и ⚠ Штраф
      if (mode === 'global') {
        header += `<th class="tsv2-total" title="Тип занятости: СЗ — самозанятый, Оф — официально, Нал — наличка">Тип</th>`;
        header += `<th class="tsv2-total" title="Получает выплаты сам / через родственника / окладом / наличкой">Получает</th>`;
        header += `<th class="tsv2-total">Заработано ₽</th>`;
        header += `<th class="tsv2-total" title="Уже выплачено через полевой модуль (worker_payments paid/confirmed): суточные / бонусы / зп / авансы">📤 Выплачено ₽</th>`;
        header += `<th class="tsv2-total" title="Премии за месяц (worker_payments type=bonus)">🎁 Премия ₽</th>`;
        header += `<th class="tsv2-total" title="Штрафы за месяц (worker_payments type=penalty)">⚠ Штраф ₽</th>`;
        header += `<th class="tsv2-total">Оклад ₽</th>`;
        // Stage U — расширенные tooltip'ы шапки: разные правила для СЗ / Оф / Нал
        const transferTooltip = 'Что уходит на карту:\nСЗ — на карту самого СЗ (или получателя НПД)\nОф — оклад/несгораемая, платит бухгалтер\nНал — 0';
        const cashTooltip     = 'Что отдаёт директор налом из табельной кассы:\nСЗ — превышение лимита\nОф — что заработал сверх оклада (премия наличными)\nНал — всё earned';
        header += `<th class="tsv2-total" title="${esc(transferTooltip)}">На карту ₽</th>`;
        header += `<th class="tsv2-total" title="${esc(cashTooltip)}">Из кассы ₽</th>`;
        header += `<th class="tsv2-total" title="Остаток годового лимита самозанятого">Лимит СЗ год ост.</th>`;
        header += `<th class="tsv2-total" title="Остаток месячного лимита самозанятого">Лимит СЗ мес ост.</th>`;
      }
      // Колонка «Суточные» убрана — см. renderKpi.
      header += `</tr></thead>`;

      // Body — группируем по объекту (если PM, иначе по умолчанию)
      let body = '<tbody>';
      const groups = {};
      employees.forEach(e => {
        const k = e.group_label || e.work_title || (mode === 'pm' ? 'Без объекта' : '');
        if (!groups[k]) groups[k] = [];
        groups[k].push(e);
      });
      const groupKeys = Object.keys(groups);
      const showGroups = mode === 'pm' || mode === 'global';

      const renderEmpRow = (emp) => {
        let row = `<tr><td>
          <div class="tsv2-fio">${esc(emp.fio || '—')}</div>
          <div class="tsv2-pos">${esc(emp.position || emp.role_tag || '')}</div>
        </td>`;
        if (mode === 'global') row += `<td class="tsv2-city">${esc(emp.city || '—')}</td>`;
        const days = emp.days || {};
        for (let d = 1; d <= daysInMonth; d++) {
          const dateISO = `${curYear}-${String(curMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const entry = days[String(d)] || days[d];
          row += renderCellHtml(emp, dateISO, entry, canEdit);
        }
        row += `<td class="tsv2-total">${emp.days_count != null ? emp.days_count : '—'}</td>`;
        if (mode === 'pm' || mode === 'global') row += `<td class="tsv2-total">${emp.total_points != null ? emp.total_points : '—'}</td>`;
        if (mode === 'global') row += `<td class="tsv2-sum">${emp.total_amount != null ? fmt(emp.total_amount) + ' ₽' : '—'}</td>`;
        // Phase 1B — 7 финансовых колонок (только global)
        if (mode === 'global') row += renderPayCells(emp);
        // Колонка «Суточные» убрана из таблицы.
        row += '</tr>';
        return row;
      };

      if (showGroups && groupKeys.length > 1) {
        // Подсчёт ширины таблицы — для colspan
        const totalCols = 1 + daysInMonth +
                          1 +                                        // Дни
                          ((mode === 'pm' || mode === 'global') ? 1 : 0) + // Баллы
                          ((mode === 'global') ? 1 : 0) +            // Сумма ₽
                          ((mode === 'global') ? 11 : 0) +           // Phase 1B+ Stage S: Тип/Получает/Заработ./Выплачено/Премия/Штраф/Оклад/Карта/Касса±/Лим.год/Лим.мес
                          ((mode === 'global') ? 1 : 0);             // Q3: Город
        groupKeys.forEach(k => {
          body += `<tr class="tsv2-group-row"><td colspan="${totalCols}">${esc(k || 'Без объекта')}</td></tr>`;
          groups[k].forEach(e => { body += renderEmpRow(e); });
        });
      } else {
        employees.forEach(e => { body += renderEmpRow(e); });
      }
      body += '</tbody>';

      wrap.innerHTML = `<table class="tsv2-table">${header}${body}</table>`;

      // Биндим клики по редактируемым ячейкам
      if (canEdit) {
        wrap.querySelectorAll('.tsv2-cell.editable').forEach(cell => {
          cell.addEventListener('click', (ev) => {
            ev.stopPropagation();
            openCellPopover(cell);
          });
        });
      }
      // FIX 9 — кастомный tooltip на любую клетку с data-tt-enc или data-tt
      wrap.querySelectorAll('.tsv2-cell').forEach(cell => {
        cell.addEventListener('mouseenter', () => {
          if (cell.dataset.ttEnc) {
            showTip(decodeURIComponent(cell.dataset.ttEnc), cell);
          } else if (cell.dataset.tt) {
            showTip(`<div class="tt-row">${esc(cell.dataset.tt)}</div>`, cell);
          }
        });
        cell.addEventListener('mouseleave', hideTip);
      });
    }

    // ── Popover редактирования ячейки ──────────────────────────────
    function openCellPopover(cell) {
      document.querySelectorAll('.tsv2-popover').forEach(p => p.remove());
      const empId  = Number(cell.dataset.emp);
      const dateISO = cell.dataset.date;
      const workId = cell.dataset.work ? Number(cell.dataset.work) : null;
      const curType = cell.dataset.type || null;

      const allowedTypes = MODE_ALLOWED_TYPES[mode] || [];
      const pop = document.createElement('div');
      pop.className = 'tsv2-popover';
      _editing = true; // FIX 13 — пауза авторефреша

      allowedTypes.forEach(t => {
        // day/night без work_id поставить нельзя
        if ((t === 'day' || t === 'night') && !workId && mode === 'pm') return;
        const meta = TYPE_META[t];
        const btn = document.createElement('button');
        btn.innerHTML = `<span class="tsv2-cell" style="background:${meta.color};color:${meta.textColor}">${meta.icon}</span> ${meta.label}`;
        btn.addEventListener('click', async () => {
          pop.remove();
          _editing = false; // FIX 13
          try {
            await editCell({
              employee_id: empId, work_id: workId, date: dateISO,
              type: t, shift: (t === 'night') ? 'night' : 'day', delete: false
            });
            // Зелёный пульс на ячейке
            cell.classList.add('tsv2-saved');
            setTimeout(() => cell.classList.remove('tsv2-saved'), 700);
            toast('Табель','Отметка сохранена','ok');
            await refresh();
          } catch (e) {
            if (e.status === 423) toast('Заперто', 'Месяц закрыт — редактирование запрещено', 'err');
            else if (e.status === 409) toast('Уже есть отметка', e.message, 'err');
            else toast('Ошибка', e.message, 'err');
          }
        });
        pop.appendChild(btn);
      });

      if (curType) {
        const del = document.createElement('button');
        del.className = 'ts-del';
        del.innerHTML = `🗑 Удалить отметку`;
        del.addEventListener('click', async () => {
          pop.remove();
          _editing = false; // FIX 13
          try {
            await editCell({ employee_id: empId, work_id: workId, date: dateISO, type: curType, delete: true });
            toast('Готово','Отметка удалена','ok');
            await refresh();
          } catch (e) {
            if (e.status === 423) toast('Заперто', 'Месяц закрыт', 'err');
            else toast('Ошибка', e.message, 'err');
          }
        });
        pop.appendChild(del);
      }

      if (!pop.children.length) {
        toast('Нет действий','Для этой клетки нет доступных типов','err');
        return;
      }

      const wrap = $('#tsv2_scroll');
      const r = cell.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      pop.style.left = (r.left - wr.left + wrap.scrollLeft) + 'px';
      pop.style.top  = (r.bottom - wr.top + wrap.scrollTop + 2) + 'px';
      wrap.style.position = 'relative';
      wrap.appendChild(pop);

      const closeOnOut = (e) => {
        if (!pop.contains(e.target)) {
          pop.remove();
          _editing = false; // FIX 13 — возобновляем авторефреш
          document.removeEventListener('click', closeOnOut);
        }
      };
      setTimeout(() => document.addEventListener('click', closeOnOut), 10);
    }

    // ── Модалка «+ Добавить рабочего» ────────────────────────────────
    function openAddWorkerModal() {
      const todayStr = new Date().toISOString().slice(0, 10);
      // BUG #5: для PM показываем ВСЕ allowedTypes (включая day/night), но при сабмите
      // требуем выбор работы. PM-day/night требуют work_id — раньше скрывали тип,
      // что прятало основной сценарий «РП добавляет рабочего на смену».
      const allowedTypes = (MODE_ALLOWED_TYPES[mode] || []).slice();

      const html = `
        <div class="tsv2-add">
          ${mode === 'pm' ? `
            <div>
              <label style="font-size:11px;color:var(--t2);display:block;margin-bottom:4px">Работа</label>
              <select id="tsv2_work" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--border)">
                <option value="">⏳ Грузим работы…</option>
              </select>
            </div>
          ` : ''}
          <div>
            <label style="font-size:11px;color:var(--t2);display:block;margin-bottom:4px">Поиск рабочего (ФИО / телефон, минимум 2 символа)</label>
            <input type="text" id="tsv2_search" placeholder="Иванов, +7..." autocomplete="off">
          </div>
          <div id="tsv2_search_results" class="tsv2-search-results" style="display:none"></div>
          <div id="tsv2_picked" style="padding:8px 10px;background:var(--ok-bg);color:var(--ok-t);border-radius:var(--r-sm);font-weight:600;display:none"></div>
          <div>
            <label style="font-size:11px;color:var(--t2);display:block;margin-bottom:4px">Дата отметки</label>
            <input type="date" id="tsv2_date" value="${todayStr}">
          </div>
          <div>
            <label style="font-size:11px;color:var(--t2);display:block;margin-bottom:6px">Тип отметки</label>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px" id="tsv2_type_grid">
              ${allowedTypes.map(t => {
                const meta = TYPE_META[t];
                return `<button class="btn ghost" data-type="${t}" style="display:flex;align-items:center;gap:6px;justify-content:flex-start">
                  <span class="tsv2-cell" style="background:${meta.color};color:${meta.textColor}">${meta.icon}</span>
                  ${meta.label}
                </button>`;
              }).join('')}
            </div>
          </div>
        </div>`;

      _editing = true; // FIX 13 — пауза авторефреша на время модалки
      // FIX 13 — наблюдаем за исчезновением модалки и сбрасываем флаг
      const _modalCloseWatcher = setInterval(() => {
        if (!document.querySelector('.cr-m-overlay--visible')) {
          _editing = false;
          clearInterval(_modalCloseWatcher);
        }
      }, 500);
      showModal({
        title: 'Добавить рабочего в табель',
        html: html,
        wide: false,
        onMount: ({ body }) => {
          let selected = null;
          let timer = null;
          const sInp = body.querySelector('#tsv2_search');
          const sRes = body.querySelector('#tsv2_search_results');
          const picked = body.querySelector('#tsv2_picked');
          const dInp = body.querySelector('#tsv2_date');
          const wSel = body.querySelector('#tsv2_work');

          // BUG #5: грузим работы PM в селектор (только для mode='pm')
          if (mode === 'pm' && wSel) {
            (async () => {
              try {
                const auth = await AsgardAuth.getAuth();
                const r = await fetch('/api/pm/works', { headers: { 'Authorization': 'Bearer ' + auth.token } });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const d = await r.json();
                const works = (d.works || d.items || d.rows || []);
                if (!works.length) {
                  wSel.innerHTML = '<option value="">У вас нет активных работ</option>';
                  wSel.disabled = true;
                } else {
                  wSel.innerHTML = '<option value="">— выбрать работу —</option>' +
                    works.map(w => `<option value="${w.id}">${esc(w.work_title || w.title || ('Объект #' + w.id))}${w.city ? ' · ' + esc(w.city) : ''}</option>`).join('');
                  if (works.length === 1) wSel.value = String(works[0].id);
                }
              } catch (e) {
                wSel.innerHTML = '<option value="">Ошибка загрузки работ</option>';
              }
            })();
          }

          function pickWorker(w) {
            selected = w;
            picked.style.display = 'block';
            picked.textContent = `✓ ${w.fio}${w.position ? ' · ' + w.position : ''}`;
            sRes.style.display = 'none';
            sInp.value = w.fio;
          }

          async function doSearch(q) {
            if (q.length < 2) { sRes.style.display = 'none'; return; }
            try {
              // Используем /api/staff/employees если есть; иначе fallback
              let url = `/api/staff/employees?search=${encodeURIComponent(q)}&limit=20`;
              const auth = await AsgardAuth.getAuth();
              let r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + auth.token } });
              if (!r.ok) {
                // Fallback: старая ручка табеля
                r = await fetch('/api/timesheet/workers/search?q=' + encodeURIComponent(q), { headers: { 'Authorization': 'Bearer ' + auth.token } });
              }
              if (!r.ok) throw new Error('HTTP ' + r.status);
              const d = await r.json();
              const list = (d.employees || d.workers || []).map(e => ({
                employee_id: e.employee_id || e.id, fio: e.fio || e.name, phone: e.phone, position: e.position || e.role_tag || ''
              }));
              if (!list.length) {
                sRes.innerHTML = '<div class="tsv2-empty" style="padding:16px">Никого не нашли</div>';
              } else {
                sRes.innerHTML = list.map(w =>
                  `<div class="tsv2-search-row" data-emp="${w.employee_id}">
                     <div><b>${esc(w.fio)}</b> <span style="color:var(--t3);font-size:11px">${esc(w.position)}</span></div>
                     <div style="color:var(--t3);font-size:11px">${esc(w.phone || '')}</div>
                   </div>`
                ).join('');
                sRes.querySelectorAll('.tsv2-search-row').forEach(row => {
                  row.addEventListener('click', () => {
                    const id = Number(row.dataset.emp);
                    const w = list.find(x => x.employee_id === id);
                    if (w) pickWorker(w);
                  });
                });
              }
              sRes.style.display = 'block';
            } catch (e) {
              sRes.innerHTML = '<div class="tsv2-empty" style="padding:16px">Ошибка поиска: ' + esc(e.message) + '</div>';
              sRes.style.display = 'block';
            }
          }

          sInp.addEventListener('input', () => {
            selected = null;
            picked.style.display = 'none';
            clearTimeout(timer);
            timer = setTimeout(() => doSearch(sInp.value.trim()), 220);
          });
          setTimeout(() => sInp.focus(), 50);

          body.querySelectorAll('[data-type]').forEach(btn => {
            btn.addEventListener('click', async () => {
              if (!selected) { toast('Не выбран рабочий','Сначала найдите и выберите','err'); return; }
              const type = btn.dataset.type;
              const date = dInp.value || todayStr;
              // BUG #5: PM-режим — work_id обязателен (контракт)
              let workIdForCell = null;
              if (mode === 'pm') {
                workIdForCell = wSel && wSel.value ? Number(wSel.value) : null;
                if (!workIdForCell && (type === 'day' || type === 'night')) {
                  toast('Нет работы','Выберите работу из списка','err');
                  return;
                }
              }
              try {
                await editCell({
                  employee_id: selected.employee_id,
                  work_id: workIdForCell,
                  date, type,
                  shift: (type === 'night') ? 'night' : 'day',
                  delete: false
                });
                toast('Табель','Рабочий добавлен в табель','ok');
                closeModal();
                await refresh();
              } catch (e) {
                if (e.status === 423) toast('Заперто', 'Месяц закрыт', 'err');
                else if (e.status === 409) toast('Уже есть отметка', e.message, 'err');
                else toast('Ошибка', e.message, 'err');
              }
            });
          });
        }
      });
    }

    let canEdit = false;
    // FIX 13 — пауза авто-рефреша при открытой модалке/попапе
    let _editing = false;
    async function refresh() {
      updatePeriodLabel();
      renderToolbarExtra();
      try {
        // Phase 1E — параллельно фетчим табель И cash-coverage (только в global, иначе skip)
        const [d, cc] = await Promise.all([
          fetchData(curYear, curMonth, mode),
          mode === 'global' ? fetchCashCoverage(curYear, curMonth) : Promise.resolve(null)
        ]);
        data = d;
        if (data) data.cashCoverage = cc; // null если не директор/бух/admin или ошибка
        // FIX 1 + FIX 2 — параллельно дёргаем closure-status; кладём в data.closureStatus
        try {
          const cs = await fetchClosureStatus(curYear, curMonth);
          if (data) data.closureStatus = cs;
        } catch (_) { /* старый бэкенд без эндпоинта — игнорим, fallback на synthesize */ }
      } catch (e) {
        toast('Ошибка', e.message || 'Не удалось загрузить табель', 'err');
        data = null;
      }
      // canEdit: есть хоть один разрешённый тип, и месяц не заперт
      const allowedTypes = MODE_ALLOWED_TYPES[mode] || [];
      canEdit = allowedTypes.length > 0 && !isModeLockedForViewer();
      renderLocks();
      renderDashboard();
      renderKpi();
      renderTable();
    }

    // Stage W — при смене месяца сбрасываем кэш handovers и перерисовываем (если вкладка активна)
    function onPeriodChanged() {
      _handovers = null;
      _hovLoaded = null;
      if (_activeTab === 'handovers' && showHandoversTab) {
        renderHandoversView();   // покажет «Загрузка передач…»
        reloadHandovers();
      } else if (showHandoversTab) {
        // Фоновое обновление бейджа
        reloadHandovers();
      }
    }

    // Init handlers
    $('#tsv2_prev')?.addEventListener('click', () => {
      curMonth--; if (curMonth < 1) { curMonth = 12; curYear--; }
      refresh(); onPeriodChanged();
    });
    $('#tsv2_next')?.addEventListener('click', () => {
      curMonth++; if (curMonth > 12) { curMonth = 1; curYear++; }
      refresh(); onPeriodChanged();
    });
    $('#tsv2_today')?.addEventListener('click', () => {
      const n = new Date(); curYear = n.getFullYear(); curMonth = n.getMonth() + 1;
      refresh(); onPeriodChanged();
    });

    updatePeriodLabel();
    renderToolbarExtra();
    await refresh();

    // Авто-рефреш (живые данные) — FIX 13: не дёргаем сервер при открытой модалке/popover
    if (_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(async () => {
      if (!document.getElementById('tsv2_scroll')) { clearInterval(_refreshTimer); _refreshTimer = null; return; }
      if (_editing) return; // FIX 13 — открытая модалка/popover → skip
      // Дополнительная защита: открыта системная модалка AsgardUI
      if (document.querySelector('.tsv2-popover, .asgard-modal, .modal-backdrop')) return;
      try {
        const fresh = await fetchData(curYear, curMonth, mode);
        data = fresh;
        try { const cs = await fetchClosureStatus(curYear, curMonth); if (data) data.closureStatus = cs; } catch (_) {}
        if (mode === 'global') {
          try { data.cashCoverage = await fetchCashCoverage(curYear, curMonth); } catch (_) {}
        }
        renderLocks(); renderDashboard(); renderKpi(); renderTable();
      } catch (_) {}
    }, 15000);
  }

  // ── Public mode-обёртки ────────────────────────────────────────────
  async function renderPm(opts) {
    return renderGrid({
      layout: opts.layout,
      title: opts.title || 'Табель моей дружины',
      mode: 'pm',
      toolbarExtra: ['lock', 'add-worker']
    });
  }
  async function renderWarehouse(opts) {
    return renderGrid({
      layout: opts.layout,
      title: opts.title || 'Табель учёта работы на складе',
      mode: 'warehouse',
      toolbarExtra: ['lock', 'add-worker']
    });
  }
  async function renderMedical(opts) {
    return renderGrid({
      layout: opts.layout,
      title: opts.title || 'Табель учёта МО',
      mode: 'medical',
      toolbarExtra: ['lock', 'add-worker']
    });
  }
  async function renderTravel(opts) {
    return renderGrid({
      layout: opts.layout,
      title: opts.title || 'Табель учёта дороги',
      mode: 'travel',
      toolbarExtra: ['lock', 'add-worker']
    });
  }
  async function renderGlobal(opts) {
    return renderGrid({
      layout: opts.layout,
      title: opts.title || 'Общий табель — Табель дружины',
      mode: 'global',
      toolbarExtra: ['lock', 'excel']
    });
  }

  return { renderPm, renderWarehouse, renderMedical, renderTravel, renderGlobal };
})();
