/**
 * АСГАРД — Панель Сервера
 * Здоровье, логи, Мимир-анализ, действия, деплои, паспорт CRM
 */
window.AsgardSystemPanel = (function () {
  const { $, $$, esc, toast } = AsgardUI;

  const CSS = `
<style id="sys-panel-css">
.sysp { font-family: var(--font-sans, Inter, sans-serif); color: var(--t1); }
.sysp-tabs { display:flex; gap:4px; padding:0 0 20px 0; flex-wrap:wrap; }
.sysp-tab {
  padding:8px 18px; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600;
  border:1px solid var(--brd); background:var(--bg2); color:var(--t2);
  transition:all .15s; white-space:nowrap;
}
.sysp-tab:hover { color:var(--t1); border-color:var(--accent,#D4A843); }
.sysp-tab.active { background:var(--accent,#D4A843); color:#0d1117; border-color:var(--accent,#D4A843); }

/* Health cards */
.sysp-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:14px; margin-bottom:24px; }
.sysp-card {
  background:var(--bg2); border:1px solid var(--brd); border-radius:12px;
  padding:18px 20px; position:relative; overflow:hidden;
}
.sysp-card-title { font-size:11px; text-transform:uppercase; letter-spacing:.8px; color:var(--t3); margin-bottom:8px; }
.sysp-card-val { font-size:28px; font-weight:700; color:var(--t1); line-height:1; }
.sysp-card-sub { font-size:12px; color:var(--t3); margin-top:6px; }
.sysp-card-bar { height:4px; background:var(--bg3,#1a1a2e); border-radius:2px; margin-top:12px; overflow:hidden; }
.sysp-card-bar-fill { height:100%; border-radius:2px; transition:width .4s; }
.sysp-card.ok   .sysp-card-bar-fill { background:#22c55e; }
.sysp-card.warn .sysp-card-bar-fill { background:#f59e0b; }
.sysp-card.err  .sysp-card-bar-fill { background:#ef4444; }
.sysp-card.ok   { border-color:rgba(34,197,94,.25); }
.sysp-card.warn { border-color:rgba(245,158,11,.25); }
.sysp-card.err  { border-color:rgba(239,68,68,.25); }
.sysp-status-dot {
  display:inline-block; width:8px; height:8px; border-radius:50%;
  background:#22c55e; margin-right:6px; animation: sysp-pulse 2s infinite;
}
.sysp-status-dot.dead { background:#ef4444; animation:none; }
@keyframes sysp-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }

/* Logs */
.sysp-log-toolbar { display:flex; gap:10px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }
.sysp-log-toolbar select, .sysp-log-toolbar input {
  background:var(--bg2); border:1px solid var(--brd); color:var(--t1);
  border-radius:8px; padding:7px 12px; font-size:13px;
}
.sysp-log-box {
  background:#0a0a0f; border:1px solid var(--brd); border-radius:10px;
  height:480px; overflow-y:auto; padding:12px; font-family:'Fira Code','Courier New',monospace;
  font-size:12px; line-height:1.6;
}
.sysp-log-line { padding:1px 0; word-break:break-all; }
.sysp-log-line.error { color:#f87171; }
.sysp-log-line.warn  { color:#fbbf24; }
.sysp-log-line.info  { color:#9ca3af; }
.sysp-live-badge {
  display:inline-flex; align-items:center; gap:6px;
  padding:4px 10px; border-radius:20px; font-size:12px; font-weight:600;
  background:rgba(34,197,94,.12); color:#22c55e; border:1px solid rgba(34,197,94,.3);
}
.sysp-live-badge.off { background:rgba(100,116,139,.12); color:var(--t3); border-color:var(--brd); }

/* Mimir */
.sysp-mimir-hd { display:flex; align-items:center; gap:14px; margin-bottom:20px; flex-wrap:wrap; }
.sysp-analyze-btn {
  display:inline-flex; align-items:center; gap:8px;
  padding:10px 22px; border-radius:10px; cursor:pointer; font-size:14px; font-weight:700;
  background:linear-gradient(135deg,#7c3aed,#4f46e5); color:#fff; border:none;
  transition:transform .1s,box-shadow .1s;
}
.sysp-analyze-btn:hover { transform:translateY(-1px); box-shadow:0 4px 16px rgba(124,58,237,.4); }
.sysp-analyze-btn:disabled { opacity:.5; cursor:not-allowed; transform:none; }
.sysp-mimir-card {
  background:var(--bg2); border:1px solid var(--brd); border-radius:12px;
  padding:20px; margin-bottom:14px; animation:sysp-fadein .3s;
}
@keyframes sysp-fadein { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
.sysp-mimir-card.ok       { border-left:4px solid #22c55e; }
.sysp-mimir-card.info     { border-left:4px solid #3b82f6; }
.sysp-mimir-card.warn     { border-left:4px solid #f59e0b; }
.sysp-mimir-card.error    { border-left:4px solid #ef4444; }
.sysp-mimir-card.critical { border-left:4px solid #dc2626; background:rgba(220,38,38,.06); }
.sysp-issue-title { font-weight:700; font-size:14px; margin-bottom:8px; }
.sysp-issue-desc  { font-size:13px; color:var(--t2); line-height:1.6; }
.sysp-fix-badge {
  display:inline-block; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:700;
  margin:10px 0 6px;
}
.sysp-fix-badge.quick   { background:rgba(34,197,94,.15); color:#22c55e; }
.sysp-fix-badge.complex { background:rgba(245,158,11,.15); color:#f59e0b; }
.sysp-fix-badge.none    { background:rgba(100,116,139,.12); color:var(--t3); }
.sysp-commands { background:#0a0a0f; border-radius:8px; padding:12px 14px; margin-top:8px; }
.sysp-command-line {
  display:flex; align-items:center; gap:10px;
  font-family:'Fira Code','Courier New',monospace; font-size:12px;
  color:#e2e8f0; margin-bottom:6px;
}
.sysp-command-line:last-child { margin-bottom:0; }
.sysp-run-cmd {
  padding:3px 10px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer;
  background:rgba(124,58,237,.2); color:#a78bfa; border:1px solid rgba(124,58,237,.3);
  white-space:nowrap; flex-shrink:0;
}
.sysp-prompt-box {
  background:#0a0a0f; border-radius:8px; padding:14px;
  font-size:12px; color:#94a3b8; line-height:1.7; white-space:pre-wrap; margin-top:8px;
  max-height:200px; overflow-y:auto; border:1px solid rgba(99,102,241,.2);
}
.sysp-copy-btn {
  padding:4px 12px; border-radius:6px; font-size:12px; cursor:pointer;
  background:var(--bg3,#1a1a2e); color:var(--t2); border:1px solid var(--brd);
}

/* Actions */
.sysp-action-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:16px; margin-bottom:28px; }
.sysp-action-card {
  background:var(--bg2); border:1px solid var(--brd); border-radius:12px; padding:20px;
}
.sysp-action-title { font-weight:700; font-size:14px; margin-bottom:6px; }
.sysp-action-desc  { font-size:12px; color:var(--t3); margin-bottom:14px; line-height:1.5; }
.sysp-btn {
  display:inline-flex; align-items:center; gap:7px;
  padding:9px 18px; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600;
  border:none; transition:all .15s;
}
.sysp-btn.primary   { background:var(--accent,#D4A843); color:#0d1117; }
.sysp-btn.danger    { background:rgba(239,68,68,.15); color:#f87171; border:1px solid rgba(239,68,68,.3); }
.sysp-btn.secondary { background:var(--bg3,#1a1a2e); color:var(--t1); border:1px solid var(--brd); }
.sysp-btn:hover     { opacity:.85; transform:translateY(-1px); }
.sysp-btn:disabled  { opacity:.45; cursor:not-allowed; transform:none; }
.sysp-terminal {
  background:#0a0a0f; border:1px solid var(--brd); border-radius:10px; margin-top:12px;
}
.sysp-terminal-bar {
  display:flex; gap:6px; padding:10px 14px; border-bottom:1px solid var(--brd);
  align-items:center;
}
.sysp-terminal-bar span { font-size:12px; color:var(--t3); flex:1; }
.sysp-term-input {
  width:100%; background:transparent; border:none; color:#22c55e;
  font-family:'Fira Code','Courier New',monospace; font-size:13px;
  padding:12px 14px; outline:none;
}
.sysp-term-input::placeholder { color:#374151; }
.sysp-term-output {
  padding:0 14px 12px; font-family:'Fira Code','Courier New',monospace;
  font-size:12px; color:#9ca3af; line-height:1.6; white-space:pre-wrap;
  max-height:220px; overflow-y:auto; min-height:40px;
}

/* Updates */
.sysp-update-item {
  background:var(--bg2); border:1px solid var(--brd); border-radius:10px;
  padding:16px 18px; margin-bottom:10px;
}
.sysp-update-hd { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
.sysp-version-badge {
  padding:3px 10px; border-radius:20px; font-size:12px; font-weight:700;
  background:rgba(212,168,67,.15); color:var(--accent,#D4A843);
  border:1px solid rgba(212,168,67,.25);
}
.sysp-update-title { font-weight:600; font-size:14px; }
.sysp-update-date  { font-size:12px; color:var(--t3); margin-left:auto; }
.sysp-update-changes { list-style:none; padding:0; margin:0; }
.sysp-update-changes li { font-size:12px; color:var(--t2); padding:2px 0; }
.sysp-update-changes li::before { content:'•'; color:var(--accent,#D4A843); margin-right:7px; }

/* Passport */
.sysp-passport { }
.sysp-pp-section { margin-bottom:28px; }
.sysp-pp-title {
  font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.8px;
  color:var(--accent,#D4A843); margin-bottom:14px; padding-bottom:8px;
  border-bottom:1px solid var(--brd);
}
.sysp-pp-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.sysp-pp-row {
  display:flex; flex-direction:column; background:var(--bg2);
  border:1px solid var(--brd); border-radius:8px; padding:12px 14px;
}
.sysp-pp-key { font-size:11px; color:var(--t3); margin-bottom:4px; text-transform:uppercase; letter-spacing:.5px; }
.sysp-pp-val { font-size:13px; color:var(--t1); font-family:'Fira Code','Courier New',monospace; word-break:break-all; }
.sysp-pp-val.plain { font-family:inherit; }
.sysp-tag-list { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.sysp-tag {
  padding:3px 10px; border-radius:20px; font-size:11px; font-weight:600;
  background:rgba(99,102,241,.15); color:#818cf8; border:1px solid rgba(99,102,241,.25);
}
.sysp-rule-list { list-style:none; padding:0; margin:0; }
.sysp-rule-list li { font-size:13px; color:var(--t2); padding:5px 0; line-height:1.5; }
.sysp-rule-list li::before { content:'⚠'; margin-right:8px; }
.sysp-cron-table { width:100%; border-collapse:collapse; }
.sysp-cron-table th { font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--t3); padding:6px 10px; text-align:left; border-bottom:1px solid var(--brd); }
.sysp-cron-table td { font-size:13px; color:var(--t2); padding:8px 10px; border-bottom:1px solid rgba(255,255,255,.04); }
.sysp-cron-table td:first-child { color:var(--t1); font-weight:600; font-family:'Fira Code',monospace; font-size:12px; }

/* Utility */
.sysp-section-title { font-size:18px; font-weight:700; color:var(--t1); margin-bottom:18px; }
.sysp-refresh-info { font-size:12px; color:var(--t3); margin-left:auto; }
.sysp-spinner { display:inline-block; width:16px; height:16px; border:2px solid rgba(255,255,255,.2); border-top-color:currentColor; border-radius:50%; animation:sysp-spin .7s linear infinite; vertical-align:-3px; }
@keyframes sysp-spin { to{ transform:rotate(360deg) } }
.sysp-empty { text-align:center; padding:40px; color:var(--t3); font-size:14px; }
@media(max-width:700px){
  .sysp-pp-grid { grid-template-columns:1fr; }
  .sysp-action-grid { grid-template-columns:1fr; }
}
</style>`;

  // ─── State ────────────────────────────────────────────────────────────────
  let _tab        = 'health';
  let _healthInt  = null;
  let _logsSse    = null;
  let _liveOn     = false;
  let _logsBuf    = [];
  let _ptyWs      = null;
  let _ptyTerm    = null;
  let _ptyResize  = null;
  const MAX_LIVE  = 500;

  // ─── API helper ───────────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const auth = await AsgardAuth.getAuth();
    const url  = '/api/admin/system' + path;
    const fo   = { headers: { Authorization: 'Bearer ' + auth.token } };
    if (opts.method) fo.method = opts.method;
    if (opts.body) { fo.headers['Content-Type'] = 'application/json'; fo.body = JSON.stringify(opts.body); }
    const r = await fetch(url, fo);
    if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Ошибка сервера' })); throw new Error(e.error || 'Ошибка'); }
    return r.json();
  }

  // ─── Utils ────────────────────────────────────────────────────────────────
  function pct(val, total) { return total > 0 ? Math.round(val / total * 100) : 0; }
  function cardClass(p) { return p < 60 ? 'ok' : p < 85 ? 'warn' : 'err'; }
  function fmtDt(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
  }

  // ─── Render layout ────────────────────────────────────────────────────────
  function renderLayout() {
    return `
${CSS}
<div class="sysp">
  <div style="display:flex;align-items:center;gap:14px;margin-bottom:22px;flex-wrap:wrap">
    <div>
      <h1 style="font-size:22px;font-weight:800;margin:0">⚡ Панель сервера</h1>
      <div style="font-size:13px;color:var(--t3);margin-top:4px">АСГАРД CRM — мониторинг и управление</div>
    </div>
    <div style="margin-left:auto;display:flex;align-items:center;gap:8px" id="sp-live-status"></div>
  </div>

  <div class="sysp-tabs" id="sp-tabs">
    ${['health','logs','mimir','actions','updates','passport'].map(t => {
      const labels = { health:'🖥 Сервер', logs:'📋 Логи', mimir:'🔮 Мимир', actions:'⚙️ Действия', updates:'🚀 Деплои', passport:'📖 Паспорт' };
      return `<div class="sysp-tab${t===_tab?' active':''}" data-tab="${t}">${labels[t]}</div>`;
    }).join('')}
  </div>

  <div id="sp-body"></div>
</div>`;
  }

  // ─── Tab: Health ──────────────────────────────────────────────────────────
  async function renderHealth() {
    const body = $('#sp-body');
    body.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
      <div class="sysp-section-title" style="margin:0">Состояние сервера</div>
      <div id="sp-health-ts" class="sysp-refresh-info">обновление...</div>
    </div>
    <div class="sysp-cards" id="sp-health-cards"><div class="sysp-empty"><span class="sysp-spinner"></span> Загрузка...</div></div>
    <div id="sp-version-check" style="margin-top:18px"></div>`;

    await loadHealth();
    loadVersionCheck();
    clearInterval(_healthInt);
    _healthInt = setInterval(loadHealth, 6000);
  }

  async function loadVersionCheck() {
    const el = $('#sp-version-check');
    if (!el) return;

    const pageVer = window.ASGARD_SHELL_VERSION || '?';

    // Запрашиваем версию у активного SW через postMessage
    let swVer = '?', swCacheVer = '?';
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sw = reg?.active;
      if (sw) {
        await new Promise((resolve) => {
          const ch = new MessageChannel();
          ch.port1.onmessage = e => {
            swVer = e.data.shellVersion || '?';
            swCacheVer = e.data.version || '?';
            resolve();
          };
          sw.postMessage('getVersion', [ch.port2]);
          setTimeout(resolve, 1500);
        });
      }
    } catch (_) {}

    const match = pageVer === swVer;
    const cls = match ? 'ok' : 'err';
    const icon = match ? '✅' : '⚠️';
    const hint = match
      ? 'Версии совпадают — кэш актуален'
      : `Несоответствие! index.html: ${pageVer}, sw.js: ${swVer} — нужен Ctrl+Shift+R`;

    el.innerHTML = `
<div style="background:var(--bg2);border:1px solid ${match ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.35)'};border-radius:12px;padding:16px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
  <span style="font-size:20px">${icon}</span>
  <div>
    <div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:4px">Версии фронтенда</div>
    <div style="font-size:12px;color:${match ? 'var(--t3)' : '#f87171'}">${esc(hint)}</div>
  </div>
  <div style="margin-left:auto;display:flex;gap:18px">
    <div style="text-align:center">
      <div style="font-size:10px;color:var(--t3);text-transform:uppercase;margin-bottom:2px">index.html</div>
      <div style="font-family:monospace;font-size:13px;color:var(--t1)">${esc(pageVer)}</div>
    </div>
    <div style="text-align:center">
      <div style="font-size:10px;color:var(--t3);text-transform:uppercase;margin-bottom:2px">sw.js</div>
      <div style="font-family:monospace;font-size:13px;color:${match ? 'var(--t1)' : '#f87171'}">${esc(swVer)}</div>
    </div>
    <div style="text-align:center">
      <div style="font-size:10px;color:var(--t3);text-transform:uppercase;margin-bottom:2px">SW кэш</div>
      <div style="font-family:monospace;font-size:11px;color:var(--t3)">${esc(swCacheVer)}</div>
    </div>
  </div>
</div>`;
  }

  async function loadHealth() {
    try {
      const d = await api('/health');
      const cpuP  = d.cpu_pct  ?? 0;
      const ramP  = d.ram?.pct ?? 0;
      const diskS = d.disk?.pct?.replace('%','') ?? 0;

      const cards = [
        {
          title: 'Сервис', val: d.service_active ? 'Активен' : 'Упал',
          sub: d.uptime || '', pct: d.service_active ? 10 : 100,
          cls: d.service_active ? 'ok' : 'err',
          icon: d.service_active ? '<span class="sysp-status-dot"></span>' : '<span class="sysp-status-dot dead"></span>'
        },
        {
          title: 'CPU', val: (cpuP ?? '?') + '%',
          sub: 'использование', pct: cpuP, cls: cardClass(cpuP)
        },
        {
          title: 'RAM',
          val: d.ram?.used ? d.ram.used + ' МБ' : '?',
          sub: `из ${d.ram?.total ?? '?'} МБ · ${ramP}%`,
          pct: ramP, cls: cardClass(ramP)
        },
        {
          title: 'Диск',
          val: d.disk?.pct ?? '?',
          sub: `${d.disk?.used ?? '?'} / ${d.disk?.size ?? '?'}`,
          pct: parseInt(diskS) || 0, cls: cardClass(parseInt(diskS) || 0)
        },
        {
          title: 'База данных', val: d.db_ok ? 'Онлайн' : 'Ошибка',
          sub: d.db_ok ? `ping ${d.db_ms} мс` : 'нет подключения',
          pct: d.db_ok ? 10 : 100, cls: d.db_ok ? 'ok' : 'err'
        },
        {
          title: 'Пользователи', val: String(d.active_users),
          sub: 'активны за 30 мин', pct: 0, cls: 'ok', nobar: true
        },
        {
          title: 'Node.js', val: d.node_version || '?',
          sub: `Процесс: ${d.proc_mem} МБ`, pct: 0, cls: 'ok', nobar: true
        },
      ];

      const html = cards.map(c => `
<div class="sysp-card ${c.cls}">
  <div class="sysp-card-title">${c.title}</div>
  <div class="sysp-card-val">${c.icon || ''}${esc(c.val)}</div>
  <div class="sysp-card-sub">${esc(c.sub)}</div>
  ${!c.nobar ? `<div class="sysp-card-bar"><div class="sysp-card-bar-fill" style="width:${c.pct}%"></div></div>` : ''}
</div>`).join('');

      const cardsEl = $('#sp-health-cards');
      if (cardsEl) cardsEl.innerHTML = html;
      const ts = $('#sp-health-ts');
      if (ts) ts.textContent = 'обновлено ' + new Date().toLocaleTimeString('ru-RU');
    } catch (e) {
      const el = $('#sp-health-cards');
      if (el) el.innerHTML = `<div class="sysp-empty" style="color:var(--err-t)">Ошибка: ${esc(e.message)}</div>`;
    }
  }

  // ─── Tab: Logs ────────────────────────────────────────────────────────────
  async function renderLogs() {
    $('#sp-body').innerHTML = `
<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
  <div class="sysp-section-title" style="margin:0">Логи сервера</div>
  <div id="sp-live-badge" class="sysp-live-badge off"><span class="sysp-status-dot dead" id="sp-live-dot"></span> Стрим выкл</div>
</div>
<div class="sysp-log-toolbar">
  <select id="sp-log-level">
    <option value="all">Все записи</option>
    <option value="warn">Warn + Error</option>
    <option value="error">Только ошибки</option>
  </select>
  <select id="sp-log-lines">
    <option value="100">100 строк</option>
    <option value="300" selected>300 строк</option>
    <option value="500">500 строк</option>
  </select>
  <button class="sysp-btn secondary" id="sp-log-load">↻ Загрузить</button>
  <button class="sysp-btn secondary" id="sp-log-toggle-live">▶ Live стрим</button>
  <button class="sysp-btn secondary" id="sp-log-clear" style="margin-left:auto">✕ Очистить</button>
</div>
<div class="sysp-log-box" id="sp-log-box"><div class="sysp-empty">Нажмите «Загрузить» или включите Live стрим</div></div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
  <span id="sp-log-count" style="font-size:12px;color:var(--t3)"></span>
  <button class="sysp-btn secondary" id="sp-log-to-mimir" style="font-size:12px;padding:6px 14px">🔮 Отправить Мимиру</button>
</div>`;

    $('#sp-log-load').onclick    = loadLogs;
    $('#sp-log-clear').onclick   = () => { _logsBuf = []; renderLogBox([]); };
    $('#sp-log-toggle-live').onclick = toggleLive;
    $('#sp-log-to-mimir').onclick = sendLogsToMimir;
  }

  async function loadLogs() {
    const box   = $('#sp-log-box');
    const level = $('#sp-log-level')?.value || 'all';
    const lines = $('#sp-log-lines')?.value || '300';
    box.innerHTML = `<div class="sysp-empty"><span class="sysp-spinner"></span> Загрузка...</div>`;
    try {
      const d = await api(`/logs?lines=${lines}&level=${level}`);
      _logsBuf = d.logs || [];
      renderLogBox(_logsBuf);
      const cnt = $('#sp-log-count');
      if (cnt) cnt.textContent = `Показано ${_logsBuf.length} строк`;
    } catch (e) {
      box.innerHTML = `<div class="sysp-empty" style="color:var(--err-t)">Ошибка: ${esc(e.message)}</div>`;
    }
  }

  function renderLogBox(logs) {
    const box = $('#sp-log-box');
    if (!box) return;
    if (!logs.length) { box.innerHTML = '<div class="sysp-empty">Логи пусты</div>'; return; }
    box.innerHTML = logs.map(l =>
      `<div class="sysp-log-line ${esc(l.sev)}">${esc(l.line)}</div>`
    ).join('');
    box.scrollTop = box.scrollHeight;
  }

  function toggleLive() {
    if (_liveOn) stopLive(); else startLive();
  }

  async function startLive() {
    const auth = await AsgardAuth.getAuth();
    stopLive();
    _liveOn = true;
    updateLiveBadge(true);
    const btn = $('#sp-log-toggle-live');
    if (btn) btn.textContent = '⏹ Стоп';

    _logsSse = new EventSource(`/api/admin/system/logs/stream?token=${encodeURIComponent(auth.token)}`);
    _logsSse.onmessage = e => {
      try {
        const d = JSON.parse(e.data);
        _logsBuf.unshift(d);
        if (_logsBuf.length > MAX_LIVE) _logsBuf = _logsBuf.slice(0, MAX_LIVE);
        const box = $('#sp-log-box');
        if (!box) return;
        const line = document.createElement('div');
        line.className = `sysp-log-line ${d.sev}`;
        line.textContent = d.line;
        box.insertBefore(line, box.firstChild);
        while (box.children.length > MAX_LIVE) box.removeChild(box.lastChild);
      } catch (_) {}
    };
    _logsSse.onerror = () => { stopLive(); };
  }

  function stopLive() {
    if (_logsSse) { _logsSse.close(); _logsSse = null; }
    _liveOn = false;
    updateLiveBadge(false);
    const btn = $('#sp-log-toggle-live');
    if (btn) btn.textContent = '▶ Live стрим';
  }

  function updateLiveBadge(on) {
    const badge = $('#sp-live-badge');
    const dot   = $('#sp-live-dot');
    if (!badge) return;
    if (on) {
      badge.className = 'sysp-live-badge';
      badge.innerHTML = '<span class="sysp-status-dot"></span> Live';
      if (dot) { dot.className = 'sysp-status-dot'; }
    } else {
      badge.className = 'sysp-live-badge off';
      badge.innerHTML = '<span class="sysp-status-dot dead"></span> Стрим выкл';
    }
  }

  function sendLogsToMimir() {
    if (!_logsBuf.length) { toast('Мимир', 'Сначала загрузите логи', 'warn'); return; }
    _tab = 'mimir';
    $$('.sysp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'mimir'));
    const logsText = _logsBuf.slice(0, 200).map(l => l.line).join('\n');
    renderMimir(logsText);
  }

  // ─── Tab: Mimir ───────────────────────────────────────────────────────────
  async function renderMimir(prefillLogs) {
    $('#sp-body').innerHTML = `
<div class="sysp-mimir-hd">
  <div>
    <div class="sysp-section-title" style="margin:0">🔮 Мимир — анализ логов</div>
    <div style="font-size:13px;color:var(--t3);margin-top:4px">Мимир читает логи и код, объясняет проблемы и предлагает решения</div>
  </div>
</div>
<div style="margin-bottom:14px">
  <div style="font-size:12px;color:var(--t3);margin-bottom:6px">Логи для анализа (можно редактировать):</div>
  <textarea id="sp-mimir-input" style="width:100%;height:160px;background:var(--bg2);border:1px solid var(--brd);border-radius:8px;color:var(--t1);font-family:'Fira Code',monospace;font-size:12px;padding:12px;resize:vertical;box-sizing:border-box;line-height:1.5" placeholder="Вставьте логи сюда или нажмите 'Загрузить последние логи'..."></textarea>
  <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
    <button class="sysp-analyze-btn" id="sp-mimir-analyze">🔮 Анализировать</button>
    <button class="sysp-btn secondary" id="sp-mimir-load-logs">↻ Загрузить последние логи</button>
  </div>
</div>
<div id="sp-mimir-result"></div>`;

    if (prefillLogs) {
      const ta = $('#sp-mimir-input');
      if (ta) ta.value = prefillLogs;
    }

    $('#sp-mimir-analyze').onclick = doAnalyze;
    $('#sp-mimir-load-logs').onclick = async () => {
      try {
        const d = await api('/logs?lines=100&level=warn');
        const ta = $('#sp-mimir-input');
        if (ta) ta.value = (d.logs || []).map(l => l.line).join('\n');
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };
  }

  async function doAnalyze() {
    const ta  = $('#sp-mimir-input');
    const res = $('#sp-mimir-result');
    const btn = $('#sp-mimir-analyze');
    if (!ta || !res) return;

    const logs = ta.value.trim();
    if (!logs) { toast('Мимир', 'Вставьте логи для анализа', 'warn'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="sysp-spinner"></span> Мимир читает код...';
    res.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3)">
      <span class="sysp-spinner" style="width:24px;height:24px;border-width:3px"></span>
      <div style="margin-top:12px;font-size:14px">Мимир анализирует логи и читает код...</div>
      <div style="font-size:12px;margin-top:6px;opacity:.7">Это может занять 15–30 секунд</div>
    </div>`;

    try {
      const d = await api('/analyze', { method: 'POST', body: { logs } });
      renderMimirResult(d.analysis, res);
    } catch (e) {
      res.innerHTML = `<div class="sysp-mimir-card err">
        <div class="sysp-issue-title">Ошибка Мимира</div>
        <div class="sysp-issue-desc">${esc(e.message)}</div>
      </div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '🔮 Анализировать';
    }
  }

  function renderMimirResult(a, container) {
    if (!a) { container.innerHTML = '<div class="sysp-empty">Мимир не вернул результат</div>'; return; }

    const sevIcon = { ok:'✅', info:'ℹ️', warn:'⚠️', error:'🚨', critical:'🔴' };
    const sevLabel = { ok:'Всё хорошо', info:'Информация', warn:'Предупреждение', error:'Ошибка', critical:'Критично' };

    let html = `<div class="sysp-mimir-card ${esc(a.severity || 'info')}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:20px">${sevIcon[a.severity] || 'ℹ️'}</span>
        <span style="font-weight:700;font-size:15px">${esc(sevLabel[a.severity] || a.severity)}</span>
      </div>
      <div style="font-size:14px;color:var(--t1);line-height:1.6">${esc(a.summary || '')}</div>
    </div>`;

    for (const issue of (a.issues || [])) {
      const fixLabel = { quick:'⚡ Быстрый фикс', complex:'🛠 Сложный фикс', none:'ℹ️ Без действий' };
      const cmds = (issue.commands || []).filter(Boolean);
      const hasPrompt = issue.fix_type === 'complex' && issue.claude_prompt;

      html += `<div class="sysp-mimir-card ${esc(issue.severity || issue.fix_type || 'info')}">
        <div class="sysp-issue-title">${esc(issue.title || '')}</div>
        <div class="sysp-issue-desc">${esc(issue.description || '')}</div>
        <div class="sysp-fix-badge ${esc(issue.fix_type || 'none')}">${fixLabel[issue.fix_type] || issue.fix_type}</div>`;

      if (cmds.length) {
        html += `<div class="sysp-commands">${cmds.map((cmd, i) =>
          `<div class="sysp-command-line">
            <span style="color:#4ade80;flex-shrink:0">$</span>
            <span style="flex:1">${esc(cmd)}</span>
            <button class="sysp-run-cmd" data-cmd="${esc(cmd)}" data-idx="${i}">▶ Выполнить</button>
          </div>`
        ).join('')}</div>`;
      }

      if (hasPrompt) {
        html += `<div style="margin-top:10px">
          <div style="font-size:12px;color:var(--t3);margin-bottom:6px">Промпт для Claude Code:</div>
          <div style="position:relative">
            <div class="sysp-prompt-box" id="sp-prompt-${Math.random().toString(36).slice(2)}">${esc(issue.claude_prompt)}</div>
            <button class="sysp-copy-btn" style="position:absolute;top:8px;right:8px" onclick="navigator.clipboard?.writeText(${JSON.stringify(issue.claude_prompt)});AsgardUI.toast('Скопировано','Промпт скопирован в буфер обмена','ok')">Копировать</button>
          </div>
        </div>`;
      }

      html += `</div>`;
    }

    container.innerHTML = html;

    // Run-command buttons
    container.querySelectorAll('.sysp-run-cmd').forEach(btn => {
      btn.onclick = async () => {
        const cmd = btn.dataset.cmd;
        if (!confirm(`Выполнить команду?\n\n${cmd}`)) return;
        btn.disabled = true; btn.textContent = '⏳';
        try {
          const d = await api('/action', { method: 'POST', body: { action: 'run-command', command: cmd } });
          toast('Команда', d.ok ? 'Выполнено' : 'Ошибка выполнения', d.ok ? 'ok' : 'err');
          const out = d.output || '';
          if (out) alert('Результат:\n\n' + out.slice(0, 2000));
        } catch (e) { toast('Ошибка', e.message, 'err'); }
        finally { btn.disabled = false; btn.textContent = '▶ Выполнить'; }
      };
    });
  }

  // ─── xterm.js loader ─────────────────────────────────────────────────────
  function loadXterm() {
    if (window.Terminal) return Promise.resolve();
    return new Promise((resolve, reject) => {
      // CSS
      if (!document.getElementById('xterm-css')) {
        const link = document.createElement('link');
        link.id   = 'xterm-css';
        link.rel  = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css';
        document.head.appendChild(link);
      }
      // xterm.js
      const s1 = document.createElement('script');
      s1.src = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js';
      s1.onload = () => {
        // FitAddon
        const s2 = document.createElement('script');
        s2.src = 'https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js';
        s2.onload = resolve;
        s2.onerror = reject;
        document.head.appendChild(s2);
      };
      s1.onerror = reject;
      document.head.appendChild(s1);
    });
  }

  function destroyPty() {
    if (_ptyResize) { _ptyResize.disconnect(); _ptyResize = null; }
    if (_ptyWs)     { try { _ptyWs.close(); } catch (_) {} _ptyWs = null; }
    if (_ptyTerm)   { try { _ptyTerm.dispose(); } catch (_) {} _ptyTerm = null; }
  }

  // ─── Tab: Actions ─────────────────────────────────────────────────────────
  async function renderActions() {
    destroyPty();

    $('#sp-body').innerHTML = `
<div class="sysp-section-title">⚙️ Действия</div>
<div class="sysp-action-grid">

  <div class="sysp-action-card">
    <div class="sysp-action-title">🔄 Перезапуск сервиса</div>
    <div class="sysp-action-desc">Выполняет <code>systemctl restart asgard-crm</code>. Сервис вернётся через ~5 секунд. Все активные соединения прервутся.</div>
    <button class="sysp-btn danger" id="sp-act-restart">Перезапустить</button>
  </div>

  <div class="sysp-action-card">
    <div class="sysp-action-title">🔢 Бамп SHELL_VERSION</div>
    <div class="sysp-action-desc">Увеличивает версию в <code>index.html</code> на +1. Нужно делать при каждом деплое desktop JS, чтобы Service Worker обновил кэш.</div>
    <button class="sysp-btn primary" id="sp-act-bump">Бампнуть версию</button>
  </div>

</div>

<div style="margin-top:8px">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap">
    <div style="font-size:16px;font-weight:700">💻 Терминал</div>
    <div style="font-size:12px;color:var(--t3)">root@asgard-crm — полноценный bash</div>
    <button class="sysp-btn secondary" id="sp-term-connect" style="margin-left:auto;font-size:12px;padding:6px 14px">▶ Подключиться</button>
    <button class="sysp-btn secondary" id="sp-term-disconnect" style="font-size:12px;padding:6px 14px;display:none">✕ Отключиться</button>
  </div>
  <div id="sp-xterm-wrap" style="background:#0a0a0f;border:1px solid var(--brd);border-radius:10px;padding:8px;min-height:320px;position:relative">
    <div id="sp-xterm-placeholder" style="display:flex;align-items:center;justify-content:center;height:300px;color:var(--t3);font-size:14px;flex-direction:column;gap:10px">
      <div style="font-size:32px">🖥</div>
      <div>Нажмите «Подключиться» для запуска терминала</div>
      <div style="font-size:12px;opacity:.6">xterm.js · node-pty · /bin/bash</div>
    </div>
    <div id="sp-xterm-container" style="display:none"></div>
  </div>
</div>`;

    $('#sp-act-restart').onclick = async () => {
      if (!confirm('Перезапустить сервис? Все соединения прервутся на ~5 секунд.')) return;
      const btn = $('#sp-act-restart');
      btn.disabled = true; btn.textContent = '⏳ Перезапуск...';
      try {
        const d = await api('/action', { method: 'POST', body: { action: 'restart' } });
        toast('Рестарт', d.message || 'Запущен', 'ok');
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Перезапустить'; }, 6000);
      } catch (e) { toast('Ошибка', e.message, 'err'); btn.disabled = false; btn.textContent = 'Перезапустить'; }
    };

    $('#sp-act-bump').onclick = async () => {
      const btn = $('#sp-act-bump');
      btn.disabled = true;
      try {
        const d = await api('/action', { method: 'POST', body: { action: 'bump-version' } });
        toast('SHELL_VERSION', d.message, 'ok');
      } catch (e) { toast('Ошибка', e.message, 'err'); }
      finally { btn.disabled = false; }
    };

    $('#sp-term-connect').onclick  = startPty;
    $('#sp-term-disconnect').onclick = () => { destroyPty(); showPtyPlaceholder('Отключено'); };
  }

  function showPtyPlaceholder(msg) {
    const ph = $('#sp-xterm-placeholder');
    const ct = $('#sp-xterm-container');
    if (ph) { ph.style.display = 'flex'; ph.querySelector('div+div').textContent = msg; }
    if (ct) ct.style.display = 'none';
    const cb = $('#sp-term-connect');
    const db = $('#sp-term-disconnect');
    if (cb) cb.style.display = '';
    if (db) db.style.display = 'none';
  }

  async function startPty() {
    const connectBtn    = $('#sp-term-connect');
    const disconnectBtn = $('#sp-term-disconnect');
    const placeholder   = $('#sp-xterm-placeholder');
    const container     = $('#sp-xterm-container');
    if (!container) return;

    if (connectBtn)    connectBtn.style.display = 'none';
    if (placeholder)   { placeholder.querySelector('div+div').textContent = 'Загрузка xterm.js...'; }

    try {
      await loadXterm();
    } catch (e) {
      showPtyPlaceholder('Ошибка загрузки xterm.js. Проверьте интернет-соединение.');
      if (connectBtn) connectBtn.style.display = '';
      return;
    }

    placeholder.style.display  = 'none';
    container.style.display     = 'block';
    if (disconnectBtn) disconnectBtn.style.display = '';

    // Создаём Terminal
    const term = new window.Terminal({
      cursorBlink:    true,
      fontSize:       13,
      fontFamily:     "'Fira Code', 'Courier New', monospace",
      theme: {
        background: '#0a0a0f',
        foreground: '#e2e8f0',
        cursor:     '#22c55e',
        black:      '#1a1a2e',
        green:      '#22c55e',
        yellow:     '#fbbf24',
        red:        '#f87171',
        blue:       '#60a5fa',
        cyan:       '#22d3ee',
        white:      '#e2e8f0',
        brightGreen:'#4ade80',
      },
      allowProposedApi: true,
    });

    const fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();
    _ptyTerm = term;

    // ResizeObserver для автоподгонки
    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch (_) {}
      if (_ptyWs && _ptyWs.readyState === WebSocket.OPEN) {
        _ptyWs.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    ro.observe(container);
    _ptyResize = ro;

    // WebSocket
    const auth = await AsgardAuth.getAuth();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${location.host}/api/admin/system/terminal?token=${encodeURIComponent(auth.token)}`;

    const ws = new WebSocket(wsUrl);
    _ptyWs = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'output') term.write(msg.data);
        if (msg.type === 'exit')   { term.write('\r\n\x1b[33m[Сессия завершена]\x1b[0m\r\n'); }
        if (msg.type === 'error')  { term.write(msg.data); }
      } catch (_) {}
    };

    ws.onclose = () => {
      if (_ptyTerm) _ptyTerm.write('\r\n\x1b[31m[Соединение закрыто]\x1b[0m\r\n');
      const db2 = $('#sp-term-disconnect');
      const cb2 = $('#sp-term-connect');
      if (db2) db2.style.display = 'none';
      if (cb2) cb2.style.display = '';
    };

    ws.onerror = () => {
      showPtyPlaceholder('WebSocket ошибка. Убедитесь что node-pty установлен на сервере.');
    };

    // Ввод из xterm → PTY
    term.onData(data => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    term.focus();
  }

  // ─── Tab: Updates ─────────────────────────────────────────────────────────
  async function renderUpdates() {
    $('#sp-body').innerHTML = `<div class="sysp-section-title">🚀 История деплоев</div>
<div id="sp-updates-list"><div class="sysp-empty"><span class="sysp-spinner"></span> Загрузка...</div></div>`;

    try {
      const d = await api('/updates');
      const list = $('#sp-updates-list');
      if (!d.updates?.length) { list.innerHTML = '<div class="sysp-empty">Деплоев пока нет</div>'; return; }

      list.innerHTML = d.updates.map(u => {
        let changes = [];
        try { changes = typeof u.changes === 'string' ? JSON.parse(u.changes) : (u.changes || []); } catch (_) {}
        const changeTexts = changes.map(c => typeof c === 'string' ? c : (c.text || c.change || String(c)));
        return `<div class="sysp-update-item">
          <div class="sysp-update-hd">
            <span class="sysp-version-badge">v${esc(u.version)}</span>
            <span class="sysp-update-title">${esc(u.title || '')}</span>
            <span class="sysp-update-date">${fmtDt(u.published_at)}</span>
          </div>
          ${changeTexts.length ? `<ul class="sysp-update-changes">${changeTexts.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
        </div>`;
      }).join('');
    } catch (e) {
      $('#sp-updates-list').innerHTML = `<div class="sysp-empty" style="color:var(--err-t)">Ошибка: ${esc(e.message)}</div>`;
    }
  }

  // ─── Tab: Passport ────────────────────────────────────────────────────────
  async function renderPassport() {
    const body = $('#sp-body');
    body.innerHTML = `<div class="sysp-section-title">📖 Паспорт CRM</div><div class="sysp-empty"><span class="sysp-spinner"></span> Загрузка...</div>`;

    try {
      const { info: I } = await api('/crm-info');

      const row  = (k, v) => `<div class="sysp-pp-row"><div class="sysp-pp-key">${esc(k)}</div><div class="sysp-pp-val">${esc(v)}</div></div>`;
      const rowP = (k, v) => `<div class="sysp-pp-row"><div class="sysp-pp-key">${esc(k)}</div><div class="sysp-pp-val plain">${esc(v)}</div></div>`;
      const tag  = t => `<span class="sysp-tag">${esc(t)}</span>`;

      body.innerHTML = `<div class="sysp-section-title">📖 Паспорт CRM</div>
<div class="sysp-passport">

<div class="sysp-pp-section">
  <div class="sysp-pp-title">Проект</div>
  <div class="sysp-pp-grid">
    ${rowP('Название', I.project.name)}
    ${rowP('Ветка', I.project.branch)}
    ${row('Описание', I.project.desc)}
  </div>
</div>

<div class="sysp-pp-section">
  <div class="sysp-pp-title">Сервер</div>
  <div class="sysp-pp-grid">
    ${row('IP', I.server.ip)}
    ${row('Пользователь', I.server.user)}
    ${row('Путь проекта', I.server.project_path)}
    ${row('Порт', String(I.server.port))}
    ${row('Прокси', I.server.proxy)}
    ${row('Сервис', I.server.service)}
    ${row('Рестарт', I.server.restart)}
    ${row('Логи', I.server.logs)}
  </div>
</div>

<div class="sysp-pp-section">
  <div class="sysp-pp-title">SSH подключение</div>
  <div class="sysp-pp-grid">
    ${row('Команда', I.ssh.connect)}
    ${row('Ключ', I.ssh.key_file)}
    ${rowP('Способ деплоя', I.ssh.deploy_method)}
  </div>
</div>

<div class="sysp-pp-section">
  <div class="sysp-pp-title">База данных</div>
  <div class="sysp-pp-grid">
    ${row('Тип', I.database.type)}
    ${row('База', I.database.name)}
    ${row('Пользователь', I.database.user)}
    ${row('Хост', I.database.host)}
    ${row('Подключение (psql)', I.database.psql_cmd)}
  </div>
</div>

<div class="sysp-pp-section">
  <div class="sysp-pp-title">Технологический стек</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
    ${Object.entries(I.stack).map(([k, arr]) => `
<div class="sysp-pp-row">
  <div class="sysp-pp-key">${esc(k)}</div>
  <div class="sysp-tag-list">${arr.map(tag).join('')}</div>
</div>`).join('')}
  </div>
</div>

<div class="sysp-pp-section">
  <div class="sysp-pp-title">Структура проекта</div>
  <div style="background:var(--bg2);border:1px solid var(--brd);border-radius:10px;overflow:hidden">
    ${Object.entries(I.structure).map(([path, desc], i) => `
<div style="display:flex;gap:16px;padding:10px 16px;${i ? 'border-top:1px solid rgba(255,255,255,.04)' : ''}">
  <code style="font-size:12px;color:var(--accent,#D4A843);min-width:260px;flex-shrink:0">${esc(path)}</code>
  <span style="font-size:13px;color:var(--t2)">${esc(desc)}</span>
</div>`).join('')}
  </div>
</div>

<div class="sysp-pp-section">
  <div class="sysp-pp-title">Правила деплоя</div>
  <ul class="sysp-rule-list">${I.deploy_rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
</div>

<div class="sysp-pp-section">
  <div class="sysp-pp-title">Роли пользователей (${I.roles.length})</div>
  <div class="sysp-tag-list">${I.roles.map(tag).join('')}</div>
</div>

<div class="sysp-pp-section">
  <div class="sysp-pp-title">Фоновые задачи (cron)</div>
  <table class="sysp-cron-table">
    <thead><tr><th>Сервис</th><th>Расписание</th><th>Описание</th></tr></thead>
    <tbody>${I.cron_jobs.map(c => `
<tr><td>${esc(c.name)}</td><td>${esc(c.time)}</td><td>${esc(c.desc)}</td></tr>`).join('')}
    </tbody>
  </table>
</div>

<div class="sysp-pp-section">
  <div class="sysp-pp-title">Тестовые аккаунты</div>
  <div class="sysp-pp-grid">
    ${I.test_accounts.map(a => `
<div class="sysp-pp-row">
  <div class="sysp-pp-key">${esc(a.role)}</div>
  <div class="sysp-pp-val">login: ${esc(a.login)} · pass: ${esc(a.password)} · PIN: ${esc(a.pin)}</div>
</div>`).join('')}
  </div>
</div>

<div class="sysp-pp-section">
  <div class="sysp-pp-title">Ключевые файлы</div>
  <div style="background:var(--bg2);border:1px solid var(--brd);border-radius:10px;overflow:hidden">
    ${Object.entries(I.key_files).map(([f, desc], i) => `
<div style="display:flex;gap:16px;padding:10px 16px;${i ? 'border-top:1px solid rgba(255,255,255,.04)' : ''}">
  <code style="font-size:12px;color:#22d3ee;min-width:280px;flex-shrink:0">${esc(f)}</code>
  <span style="font-size:13px;color:var(--t2)">${esc(desc)}</span>
</div>`).join('')}
  </div>
</div>

</div>`;
    } catch (e) {
      body.innerHTML += `<div class="sysp-empty" style="color:var(--err-t)">Ошибка: ${esc(e.message)}</div>`;
    }
  }

  // ─── Tab switching ────────────────────────────────────────────────────────
  function switchTab(tab) {
    _tab = tab;
    stopLive();
    clearInterval(_healthInt);
    if (tab !== 'actions') destroyPty();

    $$('.sysp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

    const map = {
      health:  renderHealth,
      logs:    renderLogs,
      mimir:   () => renderMimir(null),
      actions: renderActions,
      updates: renderUpdates,
      passport: renderPassport,
    };
    (map[tab] || renderHealth)();
  }

  // ─── Public render ────────────────────────────────────────────────────────
  async function render({ layout, title }) {
    const user = await AsgardAuth.requireUser();
    if (!user || user.user.role !== 'ADMIN') {
      AsgardUI.toast('Доступ закрыт', 'Только для администратора', 'err');
      location.hash = '#/home';
      return;
    }

    await layout(renderLayout(), { title });

    $$('.sysp-tab').forEach(t => {
      t.onclick = () => switchTab(t.dataset.tab);
    });

    // Initial tab
    switchTab(_tab);
  }

  return { render };
})();
