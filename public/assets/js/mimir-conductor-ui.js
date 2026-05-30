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

  // Фазы и порядок агентов в левой колонке (отображение всех 31).
  const PHASES = {
    'Фаза 1 · Контекст': ['document_parser', 'tz_analyst', 'drawings_reader', 'gatekeeper'],
    'Фаза 2 · Декомпозиция и нормативы': ['contract_decomposer', 'resource_planner', 'method_validator', 'site_conditions', 'norms_compliance'],
    'Фаза 3 · Стоимость': ['warehouse_matcher', 'market_search', 'procurement_analyzer', 'crew_composer', 'labor_calculator', 'routing_planner', 'travel_pricer', 'permits_planner', 'consumables_calculator', 'pre_mob_calculator', 'site_access_planner', 'standby_estimator'],
    'Фаза 4 · Спец-условия': ['marine_permits', 'quality_control_planner', 'warranty_reserve'],
    'Фаза 5 · Контроль и отчёт': ['indirects_calculator', 'risk_quantifier', 'historical_comparator', 'financial_modeler', 'final_consolidator', 'devils_advocate', 'executive_docs_planner']
  };

  const DISPLAY_NAMES = {
    document_parser: 'Парсер документов', tz_analyst: 'Аналитик ТЗ',
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
    const meta = [a.model, fmtDur(a.duration_ms), fmtCost(a.cost_rub)].filter(Boolean).join(' · ');
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
  function renderClarifications() {
    const bar = $('mc-clarifications-bar');
    if (!bar) return;
    const open = state.clarifications.filter((c) => (c.status || 'OPEN') === 'OPEN');
    if (!open.length) { bar.innerHTML = ''; bar.classList.remove('mc-bottom-active'); return; }
    bar.classList.add('mc-bottom-active');
    const cards = open.map((c) => `
      <div class="mc-clar mc-clar-${(c.channel || 'PM').toLowerCase()}">
        <div class="mc-clar-head">
          <span class="mc-clar-channel">${c.channel === 'CUSTOMER' ? '👤 ЗАКАЗЧИК' : '📋 РП'}</span>
          ${c.impact_rub ? `<span class="mc-clar-impact">≈${fmtRub(c.impact_rub)}</span>` : ''}
        </div>
        <div class="mc-clar-q">${esc(c.question_ru || '')}</div>
        ${c.why_we_ask ? `<div class="mc-clar-why">Зачем: ${esc(c.why_we_ask)}</div>` : ''}
      </div>`).join('');
    bar.innerHTML = `<div class="mc-clar-title">🟣 ${open.length} уточнени${open.length === 1 ? 'е' : 'й'}</div><div class="mc-clar-list">${cards}</div>`;
  }

  // ─────────── Финал ───────────
  function assumptionsHtml(list) {
    if (!Array.isArray(list) || !list.length) return '';
    const items = list.map((k) => `<li>${esc(k)}</li>`).join('');
    return `<div class="mc-final-block"><b>Ключевые допущения</b><ul>${items}</ul></div>`;
  }

  function renderFinalEstimate(data) {
    const panel = $('mc-artifact-panel');
    if (panel) {
      const rec = esc(data.recommendation || 'THINK');
      const recClass = esc((data.recommendation || 'THINK').toLowerCase());
      panel.innerHTML = `
        <div class="mc-artifact-head"><span class="mc-artifact-type">🏁 Финальная смета</span></div>
        <div class="mc-final">
          <div class="mc-final-rec mc-final-rec-${recClass}">${rec}</div>
          <div class="mc-final-block"><b>Резюме</b><p>${esc(data.summary || '—')}</p></div>
          <div class="mc-final-block"><b>Обоснование</b><p>${esc(data.decision_reasoning || '—')}</p></div>
          ${assumptionsHtml(data.key_assumptions)}
        </div>`;
    }
    const btn = $('mc-final-report');
    if (btn) btn.disabled = false;
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
