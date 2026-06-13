/**
 * ASGARD CRM — Mimir Conductor: War Room UI (Сессия 3)
 * ═══════════════════════════════════════════════════════════════════════════
 * Desktop-страница «боевого штаба» просчёта. РП видит каждого агента, его
 * поток мыслей, инструменты, артефакты; внизу — уточнения. Поток событий —
 * через SSE /api/mimir/conductor/events (авторизация ?token=, т.к. EventSource
 * не умеет слать заголовки). При перезагрузке состояние восстанавливается из
 * since_event_id=0.
 *
 * Зависит от: window.AsgardAuth (getToken/getAuth), window.AsgardUI (esc/toast).
 * ES6+ (const/=>/class) — desktop-стандарт.
 * ═══════════════════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  const API = '/api/mimir/conductor';
  const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

  // Фазы и порядок агентов в левой колонке (отображение всех 32).
  const PHASES = {
    'Фаза 0 · Глубокое понимание задачи': ['document_parser', 'work_scope_researcher'],
    'Фаза 1 · Контекст': ['tz_analyst', 'drawings_reader', 'gatekeeper'],
    'Фаза 2 · Декомпозиция и нормативы': ['contract_decomposer', 'resource_planner', 'method_validator', 'site_conditions', 'norms_compliance'],
    'Фаза 3 · Стоимость': ['warehouse_matcher', 'market_search', 'procurement_analyzer', 'crew_composer', 'labor_calculator', 'routing_planner', 'travel_pricer', 'permits_planner', 'consumables_calculator', 'pre_mob_calculator', 'site_access_planner', 'standby_estimator'],
    'Фаза 4 · Спец-условия': ['marine_permits', 'quality_control_planner', 'warranty_reserve'],
    'Фаза 5 · Контроль и отчёт': ['indirects_calculator', 'risk_quantifier', 'historical_comparator', 'financial_modeler', 'final_consolidator', 'devils_advocate', 'executive_docs_planner']
  };

  const DISPLAY_NAMES = {
    document_parser: 'Парсер документов',
    work_scope_researcher: '🔍 Исследователь задачи',
    tz_analyst: 'Аналитик ТЗ',
    drawings_reader: 'Чтение чертежей', gatekeeper: 'Гейткипер',
    contract_decomposer: 'Декомпозиция договора', resource_planner: 'Планировщик ресурсов',
    method_validator: 'Валидатор методов', site_conditions: 'Условия площадки',
    norms_compliance: 'Соответствие нормам', warehouse_matcher: 'Подбор по складу',
    market_search: 'Поиск по рынку', procurement_analyzer: 'Анализ закупок',
    crew_composer: 'Состав бригады', labor_calculator: 'Расчёт трудозатрат',
    routing_planner: 'Логистика маршрута', travel_pricer: 'Стоимость командировок',
    permits_planner: 'Допуски и разрешения', consumables_calculator: 'Расходники',
    pre_mob_calculator: 'Предмобилизация', site_access_planner: 'Доступ на объект',
    standby_estimator: 'Простои', marine_permits: 'Морские разрешения',
    quality_control_planner: 'Контроль качества', warranty_reserve: 'Гарантийный резерв',
    indirects_calculator: 'Накладные расходы', risk_quantifier: 'Оценка рисков',
    historical_comparator: 'Исторические аналоги', financial_modeler: 'Финмодель',
    final_consolidator: 'Сборка ССР', devils_advocate: 'Адвокат дьявола',
    executive_docs_planner: 'Директорский отчёт'
  };

  const STATUS_ICON = {
    PENDING: '⚪', RUNNING: '🟡', SUCCESS: '🟢',
    ERROR: '🔴', CANCELLED: '⚫', BLOCKED_ON_CLARIFICATION: '🟣'
  };

  const TERMINAL_RUN_STATUSES = new Set(['READY_FOR_REVIEW', 'ERROR', 'APPROVED', 'REJECTED', 'BLOCKED_BY_CUSTOMER', 'BLOCKED_BY_PM']);

  // ─────────── Состояние ───────────
  const state = {
    runId: null,
    run: null,
    agents: new Map(),       // agent_name → { agent_name, status, model, cost_rub, duration_ms, agent_run_id, thoughts:[], tools:[], artifact_id }
    byRunId: new Map(),      // agent_run_id → agent_name
    activeAgentName: null,
    clarifications: [],      // payload уточнений
    eventSource: null,
    lastEventId: 0,
    finished: false
  };

  // ─────────── Утилиты ───────────
  const ui = () => window.AsgardUI || {};
  const esc = (s) => (ui().esc ? ui().esc(s) : String(s == null ? '' : s));
  const toast = (title, msg, type) => { if (ui().toast) ui().toast(title, msg || '', type || 'info'); };
  const fmtTs = (ts) => { try { return new Date(ts).toLocaleTimeString('ru-RU'); } catch (_) { return ''; } };
  const fmtDur = (ms) => (ms ? `${Math.round(ms / 1000)}с` : '');
  const fmtCost = (rub) => (rub ? `${Number(rub).toFixed(2)}₽` : '');
  const fmtRub = (n) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} ₽`;
  const shortJson = (o) => { try { return JSON.stringify(o).slice(0, 60); } catch (_) { return ''; } };
  const $ = (id) => document.getElementById(id);

  function authToken() {
    return (window.AsgardAuth && window.AsgardAuth.getToken && window.AsgardAuth.getToken()) || '';
  }

  function authFetch(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, { Authorization: `Bearer ${authToken()}` });
    return fetch(url, opts);
  }

  // ─────────── Гейт ролей ───────────
  function checkAccess() {
    const a = (window.AsgardAuth && window.AsgardAuth.getAuth && window.AsgardAuth.getAuth()) || null;
    if (!a || !a.user) { location.href = '/index.html'; return false; }
    const roles = Array.isArray(a.user.roles) ? a.user.roles : [a.user.role];
    const ok = roles.some((r) => ALLOWED_ROLES.includes(r));
    if (!ok) { toast('Доступ запрещён', 'Conductor доступен PM/ТО/директорам', 'err'); location.href = '/index.html'; return false; }
    return true;
  }

  // ─────────── Инициализация ───────────
  async function init() {
    if (!checkAccess()) return;

    const params = new URLSearchParams(location.search);
    state.runId = parseInt(params.get('run_id'), 10) || null;
    const workId = parseInt(params.get('work_id'), 10) || null;
    const tenderId = parseInt(params.get('tender_id'), 10) || null;

    if (!state.runId && (workId || tenderId)) {
      try {
        const resp = await authFetch(`${API}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ work_id: workId, tender_id: tenderId })
        });
        if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error || `HTTP ${resp.status}`); }
        const data = await resp.json();
        state.runId = data.run_id;
        history.replaceState(null, '', `?run_id=${state.runId}`);
      } catch (e) {
        $('mc-run-title').textContent = 'Не удалось запустить просчёт';
        toast('Ошибка запуска', e.message, 'err');
        return;
      }
    }

    if (!state.runId) {
      $('mc-run-title').textContent = 'Не задан run_id или work_id';
      return;
    }

    await loadRunDetails();
    renderAgentList();
    connectEventStream();
  }

  // ─────────── Загрузка деталей ───────────
  async function loadRunDetails() {
    try {
      const resp = await authFetch(`${API}/run/${state.runId}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      state.run = await resp.json();
    } catch (e) {
      toast('Ошибка', `Не удалось загрузить просчёт: ${e.message}`, 'err');
      return;
    }

    const run = state.run.run || state.run;
    updateTopbar(run);

    for (const ar of (state.run.agent_runs || [])) {
      const a = ensureAgent(ar.agent_name, ar.id);
      a.status = ar.status;
      a.model = ar.model;
      a.cost_rub = ar.cost_rub;
      a.duration_ms = ar.duration_ms;
      a.artifact_id = ar.output_artifact_id || a.artifact_id;
      // Точный учёт: ai_calls и mode из input_extra (stub/live + stub_estimated флаг)
      const ie = ar.input_extra || {};
      a.ai_calls = ie.ai_calls != null ? Number(ie.ai_calls) : null;
      a.mode = ie.mode || null;
      a.stub_estimated = !!ie.stub_estimated;
      a.input_tokens = ar.input_tokens || 0;
      a.output_tokens = ar.output_tokens || 0;
    }
    for (const c of (state.run.clarifications || [])) {
      if (c.status === 'OPEN') state.clarifications.push(c);
    }
    renderClarifications();
  }

  // ─────────── SSE ───────────
  function connectEventStream() {
    if (state.finished) return;
    const token = encodeURIComponent(authToken());
    const url = `${API}/events?run_id=${state.runId}&since_event_id=${state.lastEventId}&token=${token}`;
    state.eventSource = new EventSource(url);

    state.eventSource.onmessage = (ev) => {
      let event;
      try { event = JSON.parse(ev.data); } catch (_) { return; }
      if (event && event.id) state.lastEventId = Number(event.id);
      handleEvent(event);
    };

    state.eventSource.addEventListener('connected', () => {
      $('mc-status') && $('mc-status').classList.add('mc-status-live');
    });

    state.eventSource.addEventListener('complete', (ev) => {
      let data = {}; try { data = JSON.parse(ev.data); } catch (_) { /* noop */ }
      onRunComplete(data.status);
      try { state.eventSource.close(); } catch (_) { /* noop */ }
    });

    state.eventSource.onerror = () => {
      try { state.eventSource.close(); } catch (_) { /* noop */ }
      if (state.finished) return;
      // Переподключение через 3с с того же since_event_id.
      setTimeout(connectEventStream, 3000);
    };
  }

  // ─────────── Обработка событий ───────────
  // Карта обработчиков по типу события — плоская, без большого switch.
  const EVENT_HANDLERS = {
    agent_started: (ev, ag) => { if (ag) { ag.status = 'RUNNING'; if (ev.agent_run_id != null) bindRunId(ag, ev.agent_run_id); } },
    thought: (ev, ag, p) => { if (ag) ag.thoughts.push({ ts: ev.ts, text: p.text }); },
    tool_call: (ev, ag, p) => { if (ag) ag.tools.push({ ts: ev.ts, type: 'call', tool: p.tool, input: p.input }); },
    tool_result: (ev, ag, p) => { if (ag) ag.tools.push({ ts: ev.ts, type: 'result', tool: p.tool, output: p.output_summary }); },
    artifact_emitted: (ev, ag, p) => { if (ag) { ag.artifact_id = p.artifact_id; ag.status = 'SUCCESS'; } },
    status_change: (ev, ag, p) => {
      if (ev.agent_run_id == null) { updateRunStatus(p.to); return; }
      if (ag) { ag.status = p.to; if (p.cost_rub) ag.cost_rub = p.cost_rub; if (p.duration_ms) ag.duration_ms = p.duration_ms; }
    },
    cost_tick: (ev, ag, p) => { if (p.total_cost_rub != null) setGlobalCost(p.total_cost_rub); },
    clarification_raised: (ev, ag, p) => {
      if (p.status && p.status !== 'OPEN') return;
      state.clarifications.push(p);
      renderClarifications();
      toast('Уточнение', p.question_ru || 'Требуется уточнение', 'warn');
    },
    final_estimate: (ev, ag, p) => renderFinalEstimate(p),
    error: (ev, ag, p) => { if (ag) ag.status = 'ERROR'; toast('Ошибка', p.text || p.message || 'Сбой агента', 'err'); }
  };

  function handleEvent(event) {
    if (!event || !event.event_type) return;
    const payload = event.payload || {};
    const agentRunId = event.agent_run_id;

    let agent = agentRunId != null ? agentByRunId(agentRunId) : null;
    if (!agent && payload.agent_name) agent = ensureAgent(payload.agent_name, agentRunId);

    const handler = EVENT_HANDLERS[event.event_type];
    if (handler) handler(event, agent, payload);

    appendEventStreamItem(event, agent);
    renderAgentList();
    refreshProgress();
  }

  // ─────────── Модель агентов ───────────
  function ensureAgent(name, runId) {
    let a = state.agents.get(name);
    if (!a) {
      a = { agent_name: name, status: 'PENDING', model: null, cost_rub: null, duration_ms: null, agent_run_id: runId || null, thoughts: [], tools: [], artifact_id: null };
      state.agents.set(name, a);
    }
    if (runId != null) bindRunId(a, runId);
    return a;
  }
  function bindRunId(agent, runId) {
    agent.agent_run_id = runId;
    state.byRunId.set(String(runId), agent.agent_name);
  }
  function agentByRunId(runId) {
    const name = state.byRunId.get(String(runId));
    return name ? state.agents.get(name) : null;
  }

  // ─────────── Topbar ───────────
  function updateTopbar(run) {
    if (!run) return;
    const title = run.work_title || run.object_name || `Просчёт #${state.runId}`;
    $('mc-run-title').textContent = title;
    updateRunStatus(run.status);
    if (run.total_cost_rub != null) setGlobalCost(run.total_cost_rub);
    refreshProgress();
  }
  function updateRunStatus(status) {
    if (!status) return;
    const pill = $('mc-status');
    if (pill) { pill.textContent = status; pill.dataset.status = status; }
    if (TERMINAL_RUN_STATUSES.has(status)) onRunComplete(status);
  }
  function setGlobalCost(rub) {
    const el = $('mc-cost');
    if (el) el.innerHTML = fmtRub(rub).replace(' ', '&nbsp;');
  }

  function refreshProgress() {
    // Грубый прогресс: доля SUCCESS-агентов от запущенных + 1 (conductor).
    const agents = [...state.agents.values()].filter((a) => a.agent_name !== 'conductor');
    const total = Math.max(agents.length, 1);
    const done = agents.filter((a) => a.status === 'SUCCESS').length;
    const pct = Math.min(100, Math.round((done / total) * 100));
    const fill = $('mc-progress-fill'); if (fill) fill.style.width = `${pct}%`;
    const txt = $('mc-progress-text'); if (txt) txt.textContent = `${pct}%`;

    // Сводка точного учёта: сколько агентов реально звонили AI vs stub
    const live = agents.filter((a) => a.mode === 'live' && (a.ai_calls || 0) > 0).length;
    const stub = agents.filter((a) => a.mode === 'stub' || ((a.ai_calls || 0) === 0 && (a.input_tokens || 0) === 0 && a.status === 'SUCCESS')).length;
    const totalTokIn = agents.reduce((s, a) => s + (a.input_tokens || 0), 0);
    const totalTokOut = agents.reduce((s, a) => s + (a.output_tokens || 0), 0);
    const totalCalls = agents.reduce((s, a) => s + (a.ai_calls || 0), 0);
    const summaryEl = $('mc-mode-summary');
    if (summaryEl) {
      summaryEl.innerHTML = `🤖 ${live} live · 💤 ${stub} stub · ${totalCalls} AI-вызов${totalCalls === 1 ? '' : (totalCalls < 5 ? 'а' : 'ов')} · ${totalTokIn.toLocaleString('ru-RU')}→${totalTokOut.toLocaleString('ru-RU')} tok`;
    } else {
      // если контейнера в HTML нет — создаём рядом с прогресс-баром
      const par = ($('mc-progress-fill') || {}).parentElement;
      if (par && !par.querySelector('#mc-mode-summary')) {
        const div = document.createElement('div');
        div.id = 'mc-mode-summary';
        div.style.cssText = 'font-size:11.5px;opacity:.75;margin-top:6px';
        div.innerHTML = `🤖 ${live} live · 💤 ${stub} stub · ${totalCalls} AI-вызов${totalCalls === 1 ? '' : (totalCalls < 5 ? 'а' : 'ов')} · ${totalTokIn.toLocaleString('ru-RU')}→${totalTokOut.toLocaleString('ru-RU')} tok`;
        par.appendChild(div);
      }
    }
  }

  // ─────────── Рендер: список агентов ───────────
  function renderAgentList() {
    const wrap = $('mc-agents-list');
    if (!wrap) return;
    const html = Object.entries(PHASES).map(([phase, names]) => {
      const rows = names.map(renderAgentRow).join('');
      return `<div class="mc-phase"><div class="mc-phase-header">${esc(phase)}</div><div class="mc-phase-agents">${rows}</div></div>`;
    }).join('');
    wrap.innerHTML = html;
    attachAgentHandlers();
  }

  function renderAgentRow(name) {
    const a = state.agents.get(name);
    const display = DISPLAY_NAMES[name] || name;
    if (!a) {
      return `<div class="mc-agent mc-agent-idle" data-agent="${esc(name)}">
        <span class="mc-agent-status">○</span>
        <span class="mc-agent-name">${esc(display)}</span>
      </div>`;
    }
    const icon = STATUS_ICON[a.status] || '⚪';
    const isActive = state.activeAgentName === name;
    // Mode-индикатор: 🤖 N (live с N вызовами AI) / 💤 stub / без иконки если ещё работает
    let modeTag = '';
    if (a.status === 'SUCCESS' || a.status === 'ERROR') {
      if (a.mode === 'live' && a.ai_calls > 0) modeTag = `🤖 ${a.ai_calls}`;
      else if (a.mode === 'stub' || (a.ai_calls === 0 && a.input_tokens === 0)) modeTag = '💤 stub';
    }
    // Префикс ~ если токены оценены (не точные от провайдера, а наша эвристика)
    const tildePrefix = a.stub_estimated ? '~' : '';
    const tokensTag = (a.input_tokens || a.output_tokens)
      ? `${tildePrefix}${a.input_tokens||0}→${a.output_tokens||0} tok`
      : '';
    const meta = [a.model, fmtDur(a.duration_ms), modeTag, tokensTag, fmtCost(a.cost_rub)].filter(Boolean).join(' · ');
    return `
      <div class="mc-agent ${isActive ? 'mc-agent-active' : ''} ${a.status === 'RUNNING' ? 'mc-agent-running' : ''}" data-agent="${esc(name)}">
        <span class="mc-agent-expand">${isActive ? '▼' : '▶'}</span>
        <span class="mc-agent-status">${icon}</span>
        <span class="mc-agent-name">${esc(display)}</span>
        <span class="mc-agent-meta">${esc(meta)}</span>
      </div>
      ${isActive ? renderAgentDetails(a) : ''}
    `;
  }

  function renderAgentDetails(a) {
    const thoughts = a.thoughts.map((t) => `
      <div class="mc-thought"><span class="mc-ts">${fmtTs(t.ts)}</span><span class="mc-thought-text">${esc(t.text)}</span></div>
    `).join('');
    const tools = a.tools.map((t) => (t.type === 'call'
      ? `<div class="mc-tool-call">🔧 ${esc(t.tool)}(${esc(shortJson(t.input))})</div>`
      : `<div class="mc-tool-result">↳ ${esc(typeof t.output === 'string' ? t.output : shortJson(t.output))}</div>`)).join('');
    return `
      <div class="mc-agent-details">
        <div class="mc-details-section">
          <div class="mc-details-header">💭 Поток мыслей ${a.status === 'RUNNING' ? '<span class="mc-blink">▌</span>' : ''}</div>
          <div class="mc-thoughts">${thoughts || '<i>Ещё нет мыслей</i>'}</div>
        </div>
        ${tools ? `<div class="mc-details-section"><div class="mc-details-header">🛠 Инструменты</div><div class="mc-tools">${tools}</div></div>` : ''}
        <div class="mc-details-section">
          <div class="mc-details-header">📤 Артефакт</div>
          ${a.artifact_id
    ? `<button class="mc-btn mc-btn-sm mc-load-artifact" data-aid="${esc(a.artifact_id)}">Открыть артефакт</button>`
    : '<i>Артефакт ещё не создан</i>'}
        </div>
      </div>`;
  }

  function attachAgentHandlers() {
    document.querySelectorAll('.mc-agent').forEach((el) => {
      el.onclick = (e) => {
        if (e.target.closest('.mc-agent-details')) return;
        const name = el.dataset.agent;
        state.activeAgentName = state.activeAgentName === name ? null : name;
        renderAgentList();
      };
    });
    document.querySelectorAll('.mc-load-artifact').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        await openArtifact(btn.dataset.aid);
      };
    });
  }

  // ─────────── Артефакт (правая колонка) ───────────
  async function openArtifact(artifactId) {
    const panel = $('mc-artifact-panel');
    if (panel) panel.innerHTML = '<div class="mc-empty">Загрузка артефакта…</div>';
    try {
      const resp = await authFetch(`${API}/artifact/${artifactId}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const art = await resp.json();
      renderArtifact(art);
    } catch (e) {
      if (panel) panel.innerHTML = `<div class="mc-empty">Ошибка загрузки: ${esc(e.message)}</div>`;
    }
  }

  function renderArtifact(art) {
    const panel = $('mc-artifact-panel');
    if (!panel) return;
    const content = art.content != null ? art.content : art;
    panel.innerHTML = `
      <div class="mc-artifact-head">
        <span class="mc-artifact-type">${esc(art.artifact_type || 'артефакт')}</span>
        <span class="mc-artifact-id">#${esc(art.id || '')}</span>
      </div>
      <pre class="mc-artifact-json">${esc(JSON.stringify(content, null, 2))}</pre>`;
  }

  // ─────────── Лента событий (центр) ───────────
  function appendEventStreamItem(event, agent) {
    const stream = $('mc-event-stream');
    if (!stream) return;
    const p = event.payload || {};
    const who = agent ? (DISPLAY_NAMES[agent.agent_name] || agent.agent_name) : 'Conductor';
    let text = '';
    switch (event.event_type) {
      case 'thought': text = `💭 ${p.text || ''}`; break;
      case 'agent_started': text = `▶ запущен`; break;
      case 'artifact_emitted': text = `📤 артефакт ${esc(p.artifact_type || '')}`; break;
      case 'clarification_raised': text = `🟣 уточнение: ${p.question_ru || ''}`; break;
      case 'status_change': text = `↪ статус → ${p.to || ''}`; break;
      case 'final_estimate': text = `🏁 финальная смета (${p.recommendation || ''})`; break;
      case 'error': text = `🔴 ${p.text || p.message || 'ошибка'}`; break;
      case 'mode': text = `⚙️ режим: ${p.stub ? 'stub' : 'live'} · модель ${p.conductor_model || ''}`; break;
      default: text = `· ${event.event_type}`; break;
    }
    const div = document.createElement('div');
    div.className = `mc-ev mc-ev-${event.event_type}`;
    div.innerHTML = `<span class="mc-ev-ts">${fmtTs(event.ts)}</span><span class="mc-ev-who">${esc(who)}</span><span class="mc-ev-text">${esc(text)}</span>`;
    stream.appendChild(div);
    // Автоскролл если пользователь у низа.
    const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 120;
    if (nearBottom) stream.scrollTop = stream.scrollHeight;
  }

  // ─────────── Уточнения (низ) ───────────
  // Эвристика: вопрос «документного» типа, если содержит признаки документации
  const _DOC_KEYWORDS = /документ|чертёж|чертеж|ведомост|спецификац|тз|техническ.{0,3}задани|комплект|приложени|реестр|раб.{0,3}документ|сметы|схема/i;
  function isDocumentQuestion(c) {
    return _DOC_KEYWORDS.test(String(c.question_ru || ''));
  }

  function renderClarifications() {
    const bar = $('mc-clarifications-bar');
    if (!bar) return;
    const open = state.clarifications.filter((c) => (c.status || 'OPEN') === 'OPEN');
    const closed = state.clarifications.filter((c) => (c.status || 'OPEN') !== 'OPEN').length;
    const total = state.clarifications.length;
    if (!open.length) {
      if (total > 0) {
        bar.innerHTML = `<div class="mc-clar-title">✅ Все ${total} уточнен${total === 1 ? 'ие' : 'ий'} закрыты</div>`;
        bar.classList.add('mc-bottom-active');
      } else {
        bar.innerHTML = '';
        bar.classList.remove('mc-bottom-active');
      }
      return;
    }
    bar.classList.add('mc-bottom-active');
    const blockingCount = open.filter((c) => c.blocking).length;
    const cards = open.map((c) => {
      const channelLbl = c.channel === 'CUSTOMER' ? '👤 ЗАКАЗЧИК' : '📋 РП';
      const blockTag = c.blocking ? '<span class="mc-clar-block">⛔ блокер</span>' : '';
      const impactTag = c.impact_rub ? `<span class="mc-clar-impact">≈${fmtRub(c.impact_rub)}</span>` : '';
      const isDocQ = isDocumentQuestion(c);
      const docIcon = isDocQ ? '📎 ' : '';
      // Default assumption — если есть, показываем как принимаемый текст
      let assumptionBlock = '';
      if (c.default_assumption) {
        const asp = typeof c.default_assumption === 'string'
          ? c.default_assumption
          : JSON.stringify(c.default_assumption);
        assumptionBlock = `
          <div class="mc-clar-assumption">
            <b>Допущение по умолчанию:</b> ${esc(asp.substring(0, 200))}
            <button class="mc-btn mc-btn-sm mc-accept-assumption" data-cid="${c.id}">✓ Принять</button>
          </div>`;
      }
      const consequenceBlock = c.consequence ? `<div class="mc-clar-conseq">⚠ ${esc(c.consequence)}</div>` : '';
      return `
        <div class="mc-clar mc-clar-${(c.channel || 'PM').toLowerCase()}" data-cid="${c.id}">
          <div class="mc-clar-head">
            <span class="mc-clar-channel">${docIcon}${channelLbl}</span>
            ${blockTag}
            ${impactTag}
          </div>
          <div class="mc-clar-q">${esc(c.question_ru || '')}</div>
          ${c.why_we_ask ? `<div class="mc-clar-why">Зачем: ${esc(c.why_we_ask)}</div>` : ''}
          ${consequenceBlock}
          ${assumptionBlock}
          <div class="mc-clar-actions">
            ${isDocQ ? `<button class="mc-btn mc-btn-sm mc-upload-doc" data-cid="${c.id}">📎 Прикрепить файл</button>` : ''}
            <button class="mc-btn mc-btn-sm mc-answer-text" data-cid="${c.id}">✍ Ответить текстом</button>
          </div>
        </div>`;
    }).join('');

    // Сводка + кнопка письма
    const customerOpen = open.filter((c) => c.channel === 'CUSTOMER');
    const letterBtn = customerOpen.length
      ? `<button id="mc-gen-letter" class="mc-btn mc-btn-primary" style="margin-left:8px;">📄 Письмо заказчику (${customerOpen.length})</button>`
      : '';
    const progress = total > 0 ? ` · ${closed}/${total} закрыто` : '';

    bar.innerHTML = `
      <div class="mc-clar-title">🟣 ${open.length} уточнен${open.length === 1 ? 'ие' : 'ий'}${blockingCount ? ` (⛔ ${blockingCount} блокер${blockingCount === 1 ? '' : 'ов'})` : ''}${progress}${letterBtn}</div>
      <div class="mc-clar-list">${cards}</div>`;

    // Обработчики
    const gb = $('mc-gen-letter');
    if (gb) gb.addEventListener('click', () => generateLetter(customerOpen.map((c) => c.id)));

    document.querySelectorAll('.mc-upload-doc').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid = Number(btn.dataset.cid);
        openDocumentUpload(cid);
      });
    });
    document.querySelectorAll('.mc-answer-text').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid = Number(btn.dataset.cid);
        openTextAnswer(cid);
      });
    });
    document.querySelectorAll('.mc-accept-assumption').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const cid = Number(btn.dataset.cid);
        await postAnswer(cid, { accept_assumption: true });
      });
    });
  }

  // ─────────── Действия с уточнениями ───────────
  async function postAnswer(clarId, body) {
    try {
      const resp = await authFetch(`${API}/clarification/${clarId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      // Локально пометить ANSWERED, перерисовать
      const c = state.clarifications.find((x) => Number(x.id) === Number(clarId));
      if (c) c.status = 'ANSWERED';
      renderClarifications();
      if (data.resumed) {
        toast('Conductor продолжает', 'Все блокеры закрыты — просчёт возобновлён', 'ok');
      } else {
        toast('Ответ сохранён', `Осталось блокеров: ${data.remaining_blockers || 0}`, 'info');
      }
    } catch (e) {
      toast('Ошибка ответа', e.message, 'err');
    }
  }

  function openTextAnswer(clarId) {
    const c = state.clarifications.find((x) => Number(x.id) === Number(clarId));
    if (!c) return;
    const overlay = document.createElement('div');
    overlay.className = 'mc-modal-overlay';
    overlay.innerHTML = `
      <div class="mc-modal">
        <div class="mc-modal-head">✍ Ответ на уточнение #${clarId}</div>
        <div class="mc-modal-q">${esc(c.question_ru || '')}</div>
        <textarea id="mc-answer-ta" rows="6" placeholder="Введите ответ..." style="width:100%"></textarea>
        <div class="mc-modal-actions">
          <button class="mc-btn" id="mc-answer-cancel">Отмена</button>
          <button class="mc-btn mc-btn-primary" id="mc-answer-save">Сохранить ответ</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('mc-answer-cancel').onclick = () => overlay.remove();
    document.getElementById('mc-answer-save').onclick = async () => {
      const txt = (document.getElementById('mc-answer-ta').value || '').trim();
      if (!txt) { toast('Пустой ответ', 'Введите текст', 'warn'); return; }
      overlay.remove();
      await postAnswer(clarId, { answer_text: txt });
    };
    setTimeout(() => document.getElementById('mc-answer-ta').focus(), 50);
  }

  function openDocumentUpload(clarId) {
    const c = state.clarifications.find((x) => Number(x.id) === Number(clarId));
    if (!c) return;
    const tenderId = (state.run && state.run.tender_id) || (state.run && state.run.run && state.run.run.tender_id) || null;
    const workId = (state.run && state.run.work_id) || (state.run && state.run.run && state.run.run.work_id) || null;

    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = async () => {
      const files = Array.from(inp.files || []);
      inp.remove();
      if (!files.length) return;
      toast('Загрузка', `Файлов: ${files.length}…`, 'info');
      const uploadedIds = [];
      for (const f of files) {
        try {
          const fd = new FormData();
          fd.append('file', f);
          if (tenderId) fd.append('tender_id', tenderId);
          if (workId) fd.append('work_id', workId);
          fd.append('type', 'Документ');
          const r = await authFetch('/api/files/upload', { method: 'POST', body: fd });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
          if (d.file && d.file.id) uploadedIds.push(d.file.id);
        } catch (err) {
          toast('Ошибка загрузки', `${f.name}: ${err.message}`, 'err');
        }
      }
      if (uploadedIds.length) {
        // /files/upload уже автоматически закрывает blocking-уточнения и резумит run.
        // Дополнительно явно отвечаем на ЭТО уточнение (если не закрыто uploader-ом)
        try {
          await postAnswer(clarId, { document_ids: uploadedIds });
        } catch (_) { /* /files/upload мог его закрыть */ }
      }
    };
    inp.click();
  }

  // Сформировать письмо заказчику из открытых CUSTOMER-уточнений War Room.
  async function generateLetter(ids) {
    const runId = state.runId || (state.run && (state.run.run_id || state.run.id));
    if (!runId || !ids.length) { toast('Нет данных', 'Не найдены вопросы к заказчику', 'warn'); return; }
    try {
      const r = await authFetch(`${API}/letter/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: Number(runId), clarification_ids: ids })
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || ('HTTP ' + r.status)); }
      const res = await r.json();
      toast('Письмо сформировано', 'Исх. № ' + res.letterNumber + '. Управление — на странице «Ожидание заказчика».', 'ok');
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  // ─────────── Финал ───────────
  function assumptionsHtml(list) {
    if (!Array.isArray(list) || !list.length) return '';
    const items = list.map((k) => `<li>${esc(k)}</li>`).join('');
    return `<div class="mc-final-block"><b>Ключевые допущения</b><ul>${items}</ul></div>`;
  }

  // Текущая SSR-копия для live-пересчёта (mutable между кликами)
  state.currentSsr = null;

  function renderFinalEstimate(data) {
    const panel = $('mc-artifact-panel');
    if (panel) {
      const rec = esc(data.recommendation || 'THINK');
      const recClass = esc((data.recommendation || 'THINK').toLowerCase());
      // Ключевые цифры если есть в data.ssr
      const ssr = data.ssr || {};
      state.currentSsr = JSON.parse(JSON.stringify(ssr)); // глубокая копия для live-edit
      state.currentFinalData = data;
      // Source-tier подсказки (✅ analogs / ⚙ company / ⚠ default)
      const sources = ssr._coefficient_sources || {};
      const tierIcon = (s) => s === 'analogs' ? '✅' : s === 'company_profile' ? '⚙' : '⚠';
      const totalsBlock = (ssr.total_with_vat || ssr.total_with_margin) ? `
        <div class="mc-final-totals">
          ${ssr.subtotal_fot != null ? `<div><span>ФОТ${ssr.fot_multiplier_applied > 1 ? ` (×${ssr.fot_multiplier_applied.toFixed(2)} надбавки)` : ''}:</span><b>${fmtRub(ssr.subtotal_fot)}</b></div>` : ''}
          ${ssr.total_cost != null ? `<div><span>Себестоимость:</span><b>${fmtRub(ssr.total_cost)}</b></div>` : ''}
          ${ssr.gross_profit_margin_pct != null ? `<div><span>Маржа ${tierIcon(sources.margin)}:</span><b id="mc-margin-display">${ssr.gross_profit_margin_pct.toFixed(1)}%</b></div>` : ''}
          ${ssr.total_with_margin != null ? `<div><span>Цена без НДС:</span><b id="mc-revenue-display">${fmtRub(ssr.total_with_margin)}</b></div>` : ''}
          ${ssr.total_with_vat != null ? `<div><span>С НДС ${ssr.vat_pct || 22}% ${tierIcon(sources.vat)}:</span><b id="mc-totvat-display">${fmtRub(ssr.total_with_vat)}</b></div>` : ''}
        </div>` : '';
      panel.innerHTML = `
        <div class="mc-artifact-head"><span class="mc-artifact-type">🏁 Финальная смета</span></div>
        <div class="mc-final">
          <div class="mc-final-rec mc-final-rec-${recClass}">${rec}</div>
          ${totalsBlock}
          <div class="mc-final-block"><b>Резюме</b><p>${esc(data.summary || '—')}</p></div>
          <div class="mc-final-block"><b>Обоснование</b><p>${esc(data.decision_reasoning || '—')}</p></div>
          ${assumptionsHtml(data.key_assumptions)}
          <div class="mc-margin-tuner" id="mc-margin-tuner" style="display:none;background:rgba(31,111,255,0.08);border:1px solid #1f6fff44;border-radius:10px;padding:14px;margin-top:12px">
            <div style="font-weight:600;font-size:13px;margin-bottom:10px">🎯 Настройка маржи / цены клиента</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
              <div>
                <label style="font-size:11.5px;opacity:.85">Маржа (gross-profit, % от выручки)</label>
                <input type="range" id="mc-margin-slider" min="0" max="80" step="0.5" value="${ssr.gross_profit_margin_pct || 14.3}" style="width:100%"/>
                <input type="number" id="mc-margin-input" min="0" max="80" step="0.1" value="${(ssr.gross_profit_margin_pct || 14.3).toFixed(1)}" style="width:100%;text-align:center;font-weight:700;font-size:14px;margin-top:4px"/>
              </div>
              <div>
                <label style="font-size:11.5px;opacity:.85">Прибыль абсолютная, ₽ (от выручки без НДС)</label>
                <input type="number" id="mc-profit-input" step="10000" style="width:100%;text-align:center;font-weight:700;font-size:14px;margin-top:4px" placeholder="посчитается из маржи"/>
              </div>
            </div>
            <div id="mc-margin-preview" style="background:#0e1626;border-radius:8px;padding:10px;font-size:12.5px;margin-bottom:10px"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="mc-btn mc-btn-sm" id="mc-margin-cancel">Отмена</button>
              <button class="mc-btn mc-btn-sm" id="mc-margin-reset">Вернуть Mimir-маржу</button>
              <button class="mc-btn mc-btn-sm mc-btn-primary" id="mc-margin-apply">✓ Применить новую цену</button>
            </div>
          </div>
          <div class="mc-final-actions">
            <button class="mc-btn mc-btn-primary" id="mc-tune-margin">🎯 Настроить маржу / цену</button>
            <button class="mc-btn" id="mc-recompute">🔄 Пересчитать с правкой</button>
            <button class="mc-btn" id="mc-edit-estimate">✏ JSON (продвинутый)</button>
          </div>
        </div>`;
      // Handlers
      const tm = $('mc-tune-margin');
      if (tm) tm.onclick = () => {
        const t = $('mc-margin-tuner');
        if (t) {
          t.style.display = t.style.display === 'none' ? 'block' : 'none';
          if (t.style.display === 'block') wireMarginTuner();
        }
      };
      const rc = $('mc-recompute');
      if (rc) rc.onclick = openRecomputeModal;
      const ee = $('mc-edit-estimate');
      if (ee) ee.onclick = openManualEditor;
    }
    const btn = $('mc-final-report');
    if (btn) btn.disabled = false;
  }

  // ─── Live-настройка маржи: пересчёт revenue/VAT/profit на лету ───
  function wireMarginTuner() {
    const ssrOrig = state.currentSsr;
    if (!ssrOrig) return;
    const slider = $('mc-margin-slider');
    const inputPct = $('mc-margin-input');
    const inputProfit = $('mc-profit-input');
    const preview = $('mc-margin-preview');

    function recompute(marginPct) {
      const cost = Number(ssrOrig.total_cost) || 0;
      const fotMul = Number(ssrOrig.fot_multiplier_applied) || 1;
      const m = Math.max(0.1, Math.min(79.9, marginPct)) / 100;
      const revenue = cost / (1 - m);
      const profit = revenue - cost;
      const vatPct = Number(ssrOrig.vat_pct) || 22;
      const vat = revenue * vatPct / 100;
      const totalWithVat = revenue + vat;

      // Сравнение с оригиналом
      const origRevenue = Number(ssrOrig.total_with_margin) || 0;
      const origProfit = origRevenue - cost;
      const deltaRev = revenue - origRevenue;
      const deltaPct = origRevenue > 0 ? (deltaRev / origRevenue * 100) : 0;

      // Update DOM
      const md = $('mc-margin-display'); if (md) md.textContent = `${(marginPct).toFixed(1)}%`;
      const rd = $('mc-revenue-display'); if (rd) rd.textContent = fmtRub(revenue);
      const td = $('mc-totvat-display'); if (td) td.textContent = fmtRub(totalWithVat);

      preview.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <div style="opacity:.7;font-size:11px">Себестоимость${fotMul > 1 ? ` (с надбавками ×${fotMul.toFixed(2)})` : ''}</div>
            <div style="font-weight:700">${fmtRub(cost)}</div>
          </div>
          <div>
            <div style="opacity:.7;font-size:11px">Прибыль (revenue - cost)</div>
            <div style="font-weight:700;color:${profit > 0 ? '#3fb950' : '#f85149'}">${fmtRub(profit)}</div>
          </div>
          <div>
            <div style="opacity:.7;font-size:11px">Цена без НДС</div>
            <div style="font-weight:800;font-size:14px">${fmtRub(revenue)}</div>
            <div style="font-size:10.5px;color:${deltaRev > 0 ? '#3fb950' : (deltaRev < 0 ? '#f85149' : 'inherit')}">
              ${deltaRev > 0 ? '+' : ''}${fmtRub(deltaRev)} (${deltaPct.toFixed(1)}% от Mimir)
            </div>
          </div>
          <div>
            <div style="opacity:.7;font-size:11px">С НДС ${vatPct}%</div>
            <div style="font-weight:800;font-size:14px">${fmtRub(totalWithVat)}</div>
            <div style="font-size:10.5px;opacity:.6">НДС: ${fmtRub(vat)}</div>
          </div>
        </div>`;
      return { revenue, profit, totalWithVat, vat, marginPct };
    }

    // Slider ↔ input синхронизация
    function syncFromPct(pct) {
      slider.value = pct;
      inputPct.value = Number(pct).toFixed(1);
      const r = recompute(Number(pct));
      inputProfit.value = Math.round(r.profit);
      return r;
    }
    function syncFromProfit(profit) {
      const cost = Number(ssrOrig.total_cost) || 0;
      const revenue = cost + Number(profit);
      const margin = revenue > 0 ? (profit / revenue * 100) : 0;
      slider.value = margin;
      inputPct.value = Number(margin).toFixed(1);
      return recompute(margin);
    }

    slider.oninput = () => syncFromPct(slider.value);
    inputPct.oninput = () => syncFromPct(inputPct.value);
    inputProfit.oninput = () => syncFromProfit(inputProfit.value);

    // Стартовое заполнение
    syncFromPct(ssrOrig.gross_profit_margin_pct || 14.3);

    $('mc-margin-cancel').onclick = () => { $('mc-margin-tuner').style.display = 'none'; };
    $('mc-margin-reset').onclick = () => syncFromPct(ssrOrig.gross_profit_margin_pct || 14.3);
    $('mc-margin-apply').onclick = async () => {
      const newPct = Number(inputPct.value);
      try {
        const r = await authFetch(`${API}/run/${state.runId}/adjust-margin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_margin_pct: newPct })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        toast('Маржа изменена',
          `Новая цена клиенту: ${fmtRub(d.new_ssr.total_with_vat)}. Сохранено как новая версия артефакта.`, 'ok');
        $('mc-margin-tuner').style.display = 'none';
        // Перерисуем смету с новой ssr
        const updated = Object.assign({}, state.currentFinalData, { ssr: d.new_ssr });
        renderFinalEstimate(updated);
      } catch (e) {
        toast('Ошибка', e.message, 'err');
      }
    };
  }

  // ─── Пересчёт с правкой ───
  function openRecomputeModal() {
    const overlay = document.createElement('div');
    overlay.className = 'mc-modal-overlay';
    overlay.innerHTML = `
      <div class="mc-modal">
        <div class="mc-modal-head">🔄 Попросить Conductor пересчитать</div>
        <p style="margin:8px 0;font-size:13px;opacity:.8">
          Опиши что нужно изменить — Conductor учтёт правку и пересчитает смету.
          Примеры: «увеличить бригаду до 12 человек», «убрать командировочные»,
          «учесть скидку поставщика 10%», «работаем в две смены вместо одной».
        </p>
        <textarea id="mc-recompute-ta" rows="6" placeholder="Что не так / что изменить..." style="width:100%"></textarea>
        <div class="mc-modal-actions">
          <button class="mc-btn" id="mc-recompute-cancel">Отмена</button>
          <button class="mc-btn mc-btn-primary" id="mc-recompute-save">Запустить пересчёт</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('mc-recompute-cancel').onclick = () => overlay.remove();
    document.getElementById('mc-recompute-save').onclick = async () => {
      const txt = (document.getElementById('mc-recompute-ta').value || '').trim();
      if (!txt) { toast('Пустая правка', 'Введите что изменить', 'warn'); return; }
      overlay.remove();
      try {
        const r = await authFetch(`${API}/run/${state.runId}/recompute-with-feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback_text: txt })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        toast('Пересчёт', 'Conductor учтёт правку и продолжит', 'ok');
        // Сбросим terminal-флаг чтобы SSE снова заработал
        state.finished = false;
        connectEventStream();
      } catch (e) {
        toast('Ошибка', e.message, 'err');
      }
    };
    setTimeout(() => document.getElementById('mc-recompute-ta').focus(), 50);
  }

  // ─── Ручной редактор сметы (упрощённый JSON-режим для MVP) ───
  async function openManualEditor() {
    // Подгружаем актуальный final_estimate
    let finalContent = null;
    try {
      const r = await authFetch(`${API}/run/${state.runId}`);
      const d = await r.json();
      const arts = (d.artifacts || []).filter((a) => a.artifact_type === 'final_estimate');
      if (arts.length) finalContent = arts[arts.length - 1].content;
    } catch (_) { /* noop */ }
    if (!finalContent) { toast('Нет данных', 'Не нашёл final_estimate', 'warn'); return; }

    const overlay = document.createElement('div');
    overlay.className = 'mc-modal-overlay';
    overlay.innerHTML = `
      <div class="mc-modal mc-modal-wide">
        <div class="mc-modal-head">✏ Ручное редактирование сметы</div>
        <p style="margin:6px 0;font-size:12px;opacity:.7">
          Прямая правка JSON. После сохранения создаётся новая версия артефакта
          (старая помечается superseded), оригинал виден в истории.
        </p>
        <textarea id="mc-edit-ta" rows="20" style="width:100%;font-family:monospace;font-size:12px"></textarea>
        <div class="mc-modal-actions">
          <button class="mc-btn" id="mc-edit-cancel">Отмена</button>
          <button class="mc-btn mc-btn-primary" id="mc-edit-save">Сохранить</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('mc-edit-ta').value = JSON.stringify(finalContent, null, 2);
    document.getElementById('mc-edit-cancel').onclick = () => overlay.remove();
    document.getElementById('mc-edit-save').onclick = async () => {
      const raw = document.getElementById('mc-edit-ta').value;
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch (e) { toast('JSON-ошибка', e.message, 'err'); return; }
      overlay.remove();
      try {
        // Используем тот же recompute-with-feedback для трейс-аудита (PM не часто
        // правит руками, и Conductor должен знать что состояние изменилось).
        const r = await authFetch(`${API}/run/${state.runId}/recompute-with-feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            feedback_text: '[MANUAL EDIT] РП отредактировал смету руками. См. артефакт pm_feedback с JSON-патчем.',
            manual_estimate: parsed
          })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        toast('Сохранено', 'Правка применена, Conductor пересчитает', 'ok');
        renderFinalEstimate(parsed);
      } catch (e) {
        toast('Ошибка', e.message, 'err');
      }
    };
  }

  function onRunComplete(status) {
    state.finished = true;
    updateRunStatusPill(status);
    if (status === 'READY_FOR_REVIEW') {
      toast('Готово', 'Просчёт завершён, смета готова к ревью', 'ok');
      const btn = $('mc-final-report'); if (btn) btn.disabled = false;
    } else if (status === 'ERROR') {
      toast('Просчёт прерван', 'Возникла ошибка — см. ленту событий', 'err');
    } else if (status === 'BLOCKED_BY_CUSTOMER' || status === 'BLOCKED_BY_PM') {
      toast('Пауза', 'Просчёт ждёт ответа на уточнение', 'warn');
    }
  }
  function updateRunStatusPill(status) {
    const pill = $('mc-status');
    if (pill && status) { pill.textContent = status; pill.dataset.status = status; pill.classList.remove('mc-status-live'); }
  }

  // ─────────── Запуск ───────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
