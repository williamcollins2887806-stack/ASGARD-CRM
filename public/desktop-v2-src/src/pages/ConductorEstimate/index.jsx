/**
 * Страница /conductor-estimate — War Room Conductor.
 *
 * Источник: vanilla `public/conductor-estimate.html` + `public/assets/js/mimir-conductor-ui.js` (1178 строк).
 * Backend: src/routes/mimir-conductor.js — /api/mimir/conductor/*.
 *
 *   ✅ Topbar: title / progress / cost / status / Cancel
 *   ✅ Левая колонка: 6 фаз × 32 агента, раскрытие с потоком мыслей
 *   ✅ Центральная: лента событий
 *   ✅ Правая: артефакт / финальная смета с действиями
 *   ✅ Низ: уточнения (PM/CUSTOMER, blocking) + inline-форма нормативов + кнопки
 *   ✅ SSE-стрим с автопереподключением, восстановление since_event_id
 *   ✅ Run-picker если нет run_id в query
 *
 *   URL: #/conductor-estimate?run_id=N или ?work_id=N или ?tender_id=N
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn, Pill } from '@/modals/parts';
import { ConfirmModal } from '@/modals';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';

import {
  PHASES, AGENT_NAMES, STATUS_ICON, TERMINAL_RUN_STATUSES, ACTIVE_RUN_STATUSES,
  startRun, getRun, getMyRuns, cancelRun, getArtifact,
  answerClarification, answerWithNorms, generateLetter,
  fmtRub, fmtTs, fmtDur, fmtCost, shortJson,
} from './api';
import { openConductorRunStream } from '@/hooks/useConductorRunStream';
import { ClarificationAnswerModal } from './ClarificationAnswerModal';
import { RecomputeModal } from './RecomputeModal';
import { MarginTunerModal } from './MarginTunerModal';
import { ManualEstimateEditModal } from './ManualEstimateEditModal';

import './conductor-estimate.css';

const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const LS_LAST_RUN = 'mc_last_run_id';
const LS_LAST_EVT = 'mc_last_event_id_';

function lsGetLastEvt(runId) {
  try { return parseInt(localStorage.getItem(LS_LAST_EVT + runId), 10) || 0; } catch { return 0; }
}
function lsSetLastEvt(runId, evtId) {
  try { localStorage.setItem(LS_LAST_EVT + runId, String(evtId)); } catch { /* noop */ }
}
function lsSetLastRun(id) {
  try { localStorage.setItem(LS_LAST_RUN, String(id)); } catch { /* noop */ }
}

function getQuery() {
  // Hash-роутер: query идёт после ? в hash.
  const h = window.location.hash || '';
  const i = h.indexOf('?');
  return new URLSearchParams(i >= 0 ? h.slice(i + 1) : '');
}

export default function ConductorEstimatePage() {
  const { user } = useAuth();
  const modal = useModal();
  const navigate = useNavigate();

  // RBAC
  const allowed = !!user && (user.roles || [user.role]).some((r) => ALLOWED_ROLES.includes(r));

  const [runId, setRunId] = useState(null);
  const [run, setRun] = useState(null);
  const [agents, setAgents] = useState(new Map()); // name -> {status, model, cost_rub, duration_ms, agent_run_id, thoughts, tools, artifact_id, ai_calls, mode, stub_estimated, input_tokens, output_tokens}
  const [byRunId, setByRunId] = useState(new Map()); // agent_run_id -> name
  const [activeAgent, setActiveAgent] = useState(null);
  const [clarifications, setClarifications] = useState([]);
  const [events, setEvents] = useState([]); // лента
  const [artifact, setArtifact] = useState(null);
  const [finalEstimate, setFinalEstimate] = useState(null);
  const [globalCost, setGlobalCost] = useState(0);
  const [finished, setFinished] = useState(false);
  const [myRuns, setMyRuns] = useState(null); // null → не загружали, [] → загружено
  const [loading, setLoading] = useState(true);
  // v2 BONUS: переключатель автоскролла ленты событий (vanilla — всегда скроллит) — полезно для review
  const [autoScroll, setAutoScroll] = useState(true);

  const lastEventIdRef = useRef(0);
  const esRef = useRef(null);
  const streamRef = useRef(null); // DOM ref для автоскролла

  // ── Init: парс query, старт run или picker
  useEffect(() => {
    if (!user) return;
    if (!allowed) {
      toast.error('Conductor доступен PM/ТО/директорам');
      return;
    }
    initRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, allowed]);

  // Слушаем hashchange чтобы переключаться между прогонами без перезагрузки
  useEffect(() => {
    const onHash = () => initRun();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initRun = useCallback(async () => {
    const q = getQuery();
    const queryRunId = parseInt(q.get('run_id'), 10) || null;
    const workId = parseInt(q.get('work_id'), 10) || null;
    const tenderId = parseInt(q.get('tender_id'), 10) || null;

    // Reset state
    setEvents([]);
    setArtifact(null);
    setFinalEstimate(null);
    setAgents(new Map());
    setByRunId(new Map());
    setClarifications([]);
    setFinished(false);
    setLoading(true);
    if (esRef.current) {
      try { esRef.current(); } catch { /* noop */ }  // esRef = unsubscribe-функция
      esRef.current = null;
    }

    let id = queryRunId;
    if (!id && (workId || tenderId)) {
      try {
        const d = await startRun(workId, tenderId);
        id = d.run_id;
        // обновить hash без перезагрузки
        const newHash = '#/conductor-estimate?run_id=' + id;
        window.history.replaceState(null, '', newHash);
      } catch (e) {
        toast.error('Ошибка запуска: ' + String(e?.message || e));
        setLoading(false);
        return;
      }
    }

    if (!id) {
      // run picker
      try {
        const d = await getMyRuns(30);
        setMyRuns(d?.runs || []);
      } catch (e) {
        toast.error('Не удалось загрузить просчёты: ' + String(e?.message || e));
        setMyRuns([]);
      } finally {
        setLoading(false);
      }
      return;
    }

    setRunId(id);
    lsSetLastRun(id);
    lastEventIdRef.current = lsGetLastEvt(id);

    try {
      const d = await getRun(id);
      setRun(d);
      // Заполнить агентов
      const ag = new Map();
      const br = new Map();
      for (const ar of (d.agent_runs || [])) {
        const ie = ar.input_extra || {};
        const a = {
          agent_name: ar.agent_name,
          status: ar.status,
          model: ar.model,
          cost_rub: ar.cost_rub,
          duration_ms: ar.duration_ms,
          agent_run_id: ar.id,
          thoughts: [],
          tools: [],
          artifact_id: ar.output_artifact_id || null,
          ai_calls: ie.ai_calls != null ? Number(ie.ai_calls) : null,
          mode: ie.mode || null,
          stub_estimated: !!ie.stub_estimated,
          input_tokens: ar.input_tokens || 0,
          output_tokens: ar.output_tokens || 0,
        };
        ag.set(ar.agent_name, a);
        if (ar.id) br.set(String(ar.id), ar.agent_name);
      }
      setAgents(ag);
      setByRunId(br);

      const clars = (d.clarifications || []).filter((c) => (c.status || 'OPEN') === 'OPEN');
      setClarifications(clars);

      const runObj = d.run || d;
      if (runObj?.total_cost_rub != null) setGlobalCost(runObj.total_cost_rub);

      if (TERMINAL_RUN_STATUSES.has(runObj?.status)) {
        setFinished(true);
      }
    } catch (e) {
      toast.error('Не удалось загрузить просчёт: ' + String(e?.message || e));
    } finally {
      setLoading(false);
    }

    connectStream(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectStream = useCallback((id) => {
    if (!id || finished) return;
    if (esRef.current) {
      try { esRef.current(); } catch { /* noop */ }  // esRef хранит unsubscribe-функцию
    }
    // Единый канал per-runId через singleton-хук (window.__asgardConductorStreams).
    // Reconnect, lastEventId tracking — внутри хука; здесь только handlers.
    const stop = openConductorRunStream(id, lastEventIdRef.current, {
      onMessage: (event) => {
        if (event?.id) {
          lastEventIdRef.current = Number(event.id);
          lsSetLastEvt(id, lastEventIdRef.current);
        }
        handleEvent(event);
      },
      onComplete: (data) => {
        onRunComplete(data?.status);
      },
      // onError — handled внутри хука (3s reconnect)
    });
    esRef.current = stop;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  useEffect(() => () => {
    if (esRef.current) try { esRef.current(); } catch { /* noop */ }
  }, []);

  /* ── Обработка SSE-событий ── */
  const handleEvent = useCallback((event) => {
    if (!event || !event.event_type) return;
    const payload = event.payload || {};
    const agentRunId = event.agent_run_id;

    // resolve agent
    setAgents((prev) => {
      const next = new Map(prev);
      let agentName = agentRunId != null ? byRunId.get(String(agentRunId)) : null;
      if (!agentName && payload.agent_name) agentName = payload.agent_name;
      let a = agentName ? next.get(agentName) : null;
      if (!a && agentName) {
        a = {
          agent_name: agentName,
          status: 'PENDING',
          model: null,
          cost_rub: null,
          duration_ms: null,
          agent_run_id: agentRunId || null,
          thoughts: [],
          tools: [],
          artifact_id: null,
          ai_calls: null,
          mode: null,
          stub_estimated: false,
          input_tokens: 0,
          output_tokens: 0,
        };
      }

      if (a) {
        switch (event.event_type) {
          case 'agent_started':
            a = { ...a, status: 'RUNNING' };
            if (agentRunId != null) a.agent_run_id = agentRunId;
            break;
          case 'thought':
            a = { ...a, thoughts: [...a.thoughts, { ts: event.ts, text: payload.text }] };
            break;
          case 'tool_call':
            a = { ...a, tools: [...a.tools, { ts: event.ts, type: 'call', tool: payload.tool, input: payload.input }] };
            break;
          case 'tool_result':
            a = { ...a, tools: [...a.tools, { ts: event.ts, type: 'result', tool: payload.tool, output: payload.output_summary }] };
            break;
          case 'artifact_emitted':
            a = { ...a, artifact_id: payload.artifact_id, status: 'SUCCESS' };
            break;
          case 'status_change':
            if (agentRunId != null) {
              a = {
                ...a,
                status: payload.to || a.status,
                cost_rub: payload.cost_rub ?? a.cost_rub,
                duration_ms: payload.duration_ms ?? a.duration_ms,
              };
            }
            break;
          case 'error':
            a = { ...a, status: 'ERROR' };
            break;
          default:
            break;
        }
        next.set(agentName, a);
      }
      return next;
    });

    // также обновим mapping run-id -> name
    if (agentRunId != null && payload.agent_name) {
      setByRunId((m) => {
        if (m.has(String(agentRunId))) return m;
        const next = new Map(m);
        next.set(String(agentRunId), payload.agent_name);
        return next;
      });
    }

    // status_change на уровне run (без agentRunId)
    if (event.event_type === 'status_change' && agentRunId == null && payload.to) {
      setRun((r) => r ? ({ ...r, run: { ...(r.run || {}), status: payload.to }, status: payload.to }) : r);
      if (TERMINAL_RUN_STATUSES.has(payload.to)) onRunComplete(payload.to);
    }

    if (event.event_type === 'cost_tick' && payload.total_cost_rub != null) {
      setGlobalCost(payload.total_cost_rub);
    }

    if (event.event_type === 'clarification_raised') {
      if ((payload.status || 'OPEN') === 'OPEN') {
        setClarifications((arr) => [...arr, payload]);
        toast.warn('Уточнение: ' + (payload.question_ru || 'Требуется уточнение'));
      }
    }

    if (event.event_type === 'final_estimate') {
      setFinalEstimate(payload);
    }

    if (event.event_type === 'error') {
      toast.error(payload.text || payload.message || 'Сбой агента');
    }

    // Лента
    setEvents((arr) => {
      const next = arr.slice();
      if (next.length > 200) next.shift();
      next.push({
        id: event.id,
        ts: event.ts,
        type: event.event_type,
        agent_name: payload.agent_name || (byRunId.get(String(agentRunId)) || ''),
        payload,
      });
      return next;
    });
  }, [byRunId]);

  const onRunComplete = (status) => {
    setFinished(true);
    setRun((r) => r ? ({ ...r, run: { ...(r.run || {}), status }, status }) : r);
    if (status === 'READY_FOR_REVIEW') {
      toast.success('Просчёт завершён, смета готова к ревью');
    } else if (status === 'ERROR') {
      toast.error('Просчёт прерван');
    } else if (status === 'BLOCKED_BY_CUSTOMER' || status === 'BLOCKED_BY_PM') {
      toast.warn('Пауза — просчёт ждёт ответа на уточнение');
    }
  };

  // Автоскролл ленты
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    // v2 BONUS: если пользователь отключил autoScroll — не скроллим (vanilla — всегда)
    if (!autoScroll) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [events.length, autoScroll]);

  // v2 BONUS: hotkeys (C копировать run_id, A toggle autoscroll, Esc к работам) — vanilla не имеет
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'c' && runId) {
        navigator.clipboard?.writeText(String(runId)).then(
          () => toast.success(`Run ID #${runId} скопирован`),
          () => { /* noop */ }
        );
      } else if (e.key === 'a') {
        setAutoScroll((v) => !v);
      } else if (e.key === 'Escape') {
        navigate('/pm-works');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runId]);

  const onCancel = () => {
    if (!runId) return;
    modal.open(
      <ConfirmModal
        icon="🛑"
        title="Прервать просчёт?"
        message="Восстановить не получится — придётся запускать заново."
        tone="danger"
        confirmLabel="Прервать"
        onConfirm={async () => {
          try {
            await cancelRun(runId);
            toast.success('Просчёт остановлен');
          } catch (e) {
            toast.error('Ошибка: ' + String(e?.message || e));
          }
        }}
      />
    );
  };

  const openArtifact = async (artifactId) => {
    setArtifact({ loading: true });
    try {
      const art = await getArtifact(artifactId);
      setArtifact(art);
    } catch (e) {
      setArtifact({ error: String(e?.message || e) });
    }
  };

  const onAgentClick = (name) => {
    setActiveAgent(activeAgent === name ? null : name);
  };

  const onGenLetter = async (ids) => {
    if (!runId || !ids.length) { toast.warn('Не найдены вопросы к заказчику'); return; }
    try {
      const r = await generateLetter(runId, ids);
      toast.success('Письмо сформировано: ' + r.letterNumber);
    } catch (e) {
      toast.error('Ошибка: ' + String(e?.message || e));
    }
  };

  const onAnswerClar = (clar) => {
    modal.open(
      <ClarificationAnswerModal
        clar={clar}
        onAnswered={() => {
          setClarifications((arr) => arr.filter((c) => c.id !== clar.id));
        }}
      />
    );
  };

  const onAcceptAssumption = async (clar) => {
    try {
      const r = await answerClarification(clar.id, { accept_assumption: true });
      if (r?.resumed) toast.success('Conductor продолжает');
      else toast.success(`Принято. Осталось блокеров: ${r?.remaining_blockers ?? 0}`);
      setClarifications((arr) => arr.filter((c) => c.id !== clar.id));
    } catch (e) {
      toast.error('Ошибка: ' + String(e?.message || e));
    }
  };

  const onRecompute = () => {
    if (!runId) return;
    modal.open(
      <RecomputeModal
        runId={runId}
        onApplied={() => {
          setFinished(false);
          connectStream(runId);
        }}
      />
    );
  };

  const onTuneMargin = () => {
    if (!runId || !finalEstimate?.ssr) return;
    modal.open(
      <MarginTunerModal
        runId={runId}
        ssr={finalEstimate.ssr}
        onApplied={(newSsr) => {
          setFinalEstimate((fe) => ({ ...fe, ssr: newSsr }));
        }}
      />
    );
  };

  // Vanilla mimir-conductor-ui.js:851,866 — кнопка «✏ JSON (продвинутый)».
  // Ручная правка финальной сметы через JSON, recompute-with-feedback с manual_estimate.
  const onManualEdit = () => {
    if (!runId || !finalEstimate) return;
    modal.open(
      <ManualEstimateEditModal
        runId={runId}
        initialContent={finalEstimate}
        onApplied={(parsed) => {
          setFinalEstimate(parsed);
          setFinished(false);
          connectStream(runId);
        }}
      />
    );
  };

  /* ── RBAC ── */
  if (user && !allowed) {
    return (
      <div className="p-24 c-err">
        Доступ запрещён. Conductor доступен PM/ТО/директорам.
      </div>
    );
  }

  /* ── Run picker ── */
  if (loading && !runId) {
    return <div className="card p-32 t-center c-t3">⏳ Загрузка…</div>;
  }
  if (!runId && myRuns !== null) {
    return <RunPicker runs={myRuns} />;
  }

  /* ── Main War Room ── */
  const runObj = run?.run || run || {};
  const title = runObj.work_title || runObj.tender_title || runObj.object_name || `Просчёт #${runId}`;
  const status = runObj.status || '—';
  const cancelVisible = ACTIVE_RUN_STATUSES.has(status);

  const required = run?.progress?.required_agents || [];
  const successNames = new Set([...agents.values()].filter((a) => a.status === 'SUCCESS').map((a) => a.agent_name));
  let total, done;
  if (required.length) {
    total = required.length;
    done = required.filter((a) => successNames.has(a)).length;
  } else {
    const nonConductor = [...agents.values()].filter((a) => a.agent_name !== 'conductor');
    total = Math.max(nonConductor.length, 1);
    done = nonConductor.filter((a) => a.status === 'SUCCESS').length;
  }
  const pct = Math.min(100, Math.round((done / total) * 100));

  // Mode summary
  const live = [...agents.values()].filter((a) => a.mode === 'live' && (a.ai_calls || 0) > 0).length;
  const stub = [...agents.values()].filter((a) => a.mode === 'stub' || ((a.ai_calls || 0) === 0 && (a.input_tokens || 0) === 0 && a.status === 'SUCCESS')).length;
  const totIn = [...agents.values()].reduce((s, a) => s + (a.input_tokens || 0), 0);
  const totOut = [...agents.values()].reduce((s, a) => s + (a.output_tokens || 0), 0);
  const totCalls = [...agents.values()].reduce((s, a) => s + (a.ai_calls || 0), 0);

  return (
    <div className="ce-wrap">
      {/* Topbar */}
      <div className="ce-topbar">
        <div className="ce-title">
          <span className="ce-icon">🎼</span>
          <span>{title}</span>
        </div>

        <div className="ce-progress">
          <div className="ce-progress-bar"><div className="ce-progress-fill" style={{ width: pct + '%' }} /></div>
          <span className="ce-progress-text">{required.length ? `${done}/${total} обяз.` : `${done}/${total}`} · {pct}%</span>
        </div>

        <div className="ce-meta">
          <span className="ce-meta-item">💰 <b>{fmtRub(globalCost)}</b></span>
          <span className="ce-status-pill" data-status={status}>{status}</span>
        </div>

        <div className="u-flex gap-6">
          {/* v2 BONUS: переключатель autoScroll (vanilla — нет) */}
          <Btn
            variant={autoScroll ? 'ghost' : 'primary'}
            size="sm"
            onClick={() => setAutoScroll((v) => !v)}
            title="A — toggle autoScroll"
          >
            {autoScroll ? '⏬ Auto' : '⏸ Paused'}
          </Btn>
          {/* v2 BONUS: копирование run_id (vanilla — нет) */}
          {runId && (
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => navigator.clipboard?.writeText(String(runId)).then(
                () => toast.success(`Run ID #${runId} скопирован`),
                () => toast.error('Не удалось скопировать')
              )}
              title="C — копировать run_id"
            >
              📋 #{runId}
            </Btn>
          )}
          {cancelVisible && <Btn variant="danger" size="sm" onClick={onCancel}>🛑 Прервать</Btn>}
          <Btn variant="ghost" size="sm" onClick={() => navigate('/pm-works')} title="Esc">← К работам</Btn>
        </div>

        <div className="ce-mode-summary">
          🤖 {live} live · 💤 {stub} stub · {totCalls} AI-вызов{totCalls === 1 ? '' : (totCalls < 5 ? 'а' : 'ов')} · {totIn.toLocaleString('ru-RU')}→{totOut.toLocaleString('ru-RU')} tok
        </div>
      </div>

      {/* Main 3 columns */}
      <div className="ce-main">
        <div className="ce-col">
          <div className="ce-col-head">🎼 Агенты ({agents.size}/32)</div>
          <div className="ce-col-body">
            {Object.entries(PHASES).map(([phase, names]) => (
              <div className="ce-phase" key={phase}>
                <div className="ce-phase-h">{phase}</div>
                {names.map((name) => {
                  const a = agents.get(name);
                  const display = AGENT_NAMES[name] || name;
                  if (!a) {
                    return (
                      <div
                        key={name}
                        className="ce-agent idle"
                        onClick={() => onAgentClick(name)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAgentClick(name); } }}
                        role="button"
                        tabIndex={0}
                        aria-label={`Агент: ${display}`}
                      >
                        <span aria-hidden="true">○</span>
                        <span className="ce-agent-name">{display}</span>
                      </div>
                    );
                  }
                  const icon = STATUS_ICON[a.status] || '⚪';
                  const isActive = activeAgent === name;
                  let modeTag = '';
                  if (a.status === 'SUCCESS' || a.status === 'ERROR') {
                    if (a.mode === 'live' && a.ai_calls > 0) modeTag = '🤖 ' + a.ai_calls;
                    else if (a.mode === 'stub' || (a.ai_calls === 0 && a.input_tokens === 0)) modeTag = '💤 stub';
                  }
                  const tildePrefix = a.stub_estimated ? '~' : '';
                  const tokTag = (a.input_tokens || a.output_tokens)
                    ? `${tildePrefix}${a.input_tokens || 0}→${a.output_tokens || 0} tok`
                    : '';
                  const meta = [a.model, fmtDur(a.duration_ms), modeTag, tokTag, fmtCost(a.cost_rub)].filter(Boolean).join(' · ');
                  return (
                    <div key={name}>
                      <div
                        className={'ce-agent ' + (a.status === 'RUNNING' ? 'running ' : '') + (isActive ? 'active' : '')}
                        onClick={() => onAgentClick(name)}
                      >
                        <span>{isActive ? '▼' : '▶'}</span>
                        <span>{icon}</span>
                        <span className="ce-agent-name">{display}</span>
                        {meta && <span className="ce-agent-meta">{meta}</span>}
                      </div>
                      {isActive && (
                        <AgentDetails agent={a} onLoadArtifact={openArtifact} />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="ce-col">
          <div className="ce-col-head">📡 Лента событий</div>
          <div className="ce-col-body" ref={streamRef}>
            {events.length === 0 ? (
              <div className="ce-empty">Ожидание событий…</div>
            ) : (
              events.map((e, i) => (
                <div key={e.id || i} className={'ce-ev ce-ev-' + e.type}>
                  <span className="ce-ev-ts">{fmtTs(e.ts)}</span>
                  <span className="ce-ev-who">{e.agent_name ? (AGENT_NAMES[e.agent_name] || e.agent_name) : 'Conductor'}</span>
                  <span className="ce-ev-text">{eventText(e)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="ce-col">
          <div className="ce-col-head">📤 Артефакт</div>
          <div className="ce-col-body">
            {finalEstimate ? (
              <FinalEstimate data={finalEstimate} onRecompute={onRecompute} onTuneMargin={onTuneMargin} onManualEdit={onManualEdit} />
            ) : artifact?.loading ? (
              <div className="ce-empty">Загрузка артефакта…</div>
            ) : artifact?.error ? (
              <div className="ce-empty">Ошибка: {artifact.error}</div>
            ) : artifact ? (
              <>
                <div className="ce-art-head">
                  <span className="ce-art-type">{artifact.artifact_type || 'артефакт'}</span>
                  <span className="ce-art-id">#{artifact.id || ''}</span>
                </div>
                <pre className="ce-art-json">{JSON.stringify(artifact.content ?? artifact, null, 2)}</pre>
              </>
            ) : (
              <div className="ce-empty">Выберите агента слева, чтобы увидеть его артефакт</div>
            )}
          </div>
        </div>
      </div>

      {/* Clarifications bar */}
      {clarifications.length > 0 && (
        <Clarifications
          clarifications={clarifications}
          onAnswer={onAnswerClar}
          onAcceptAssumption={onAcceptAssumption}
          onAnswerNorms={async (clar, values) => {
            try {
              const r = await answerWithNorms(clar.id, values);
              if (r?.resumed) toast.success('Сохранено + Conductor продолжает');
              else toast.success(`Сохранено. Осталось блокеров: ${r?.remaining_blockers ?? 0}`);
              setClarifications((arr) => arr.filter((c) => c.id !== clar.id));
            } catch (e) {
              toast.error('Ошибка: ' + String(e?.message || e));
            }
          }}
          onGenLetter={onGenLetter}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * AgentDetails
 * ═══════════════════════════════════════════════════════════════════════ */
function AgentDetails({ agent, onLoadArtifact }) {
  return (
    <div className="ce-agent-details">
      <div className="ce-d-h">💭 Поток мыслей</div>
      <div className="ce-thoughts">
        {agent.thoughts.length === 0
          ? <i className="c-t3 fs-11">Ещё нет мыслей</i>
          : agent.thoughts.map((t, i) => (
            <div key={i} className="ce-thought">
              <span className="ce-ts">{fmtTs(t.ts)}</span>
              <span>{t.text}</span>
            </div>
          ))}
      </div>

      {agent.tools.length > 0 && (
        <>
          <div className="ce-d-h">🛠 Инструменты</div>
          <div className="ce-tools">
            {agent.tools.map((t, i) => (
              t.type === 'call'
                ? <div key={i} className="ce-tool-call">🔧 {t.tool}({shortJson(t.input)})</div>
                : <div key={i} className="ce-tool-result">↳ {typeof t.output === 'string' ? t.output : shortJson(t.output)}</div>
            ))}
          </div>
        </>
      )}

      <div className="ce-d-h">📤 Артефакт</div>
      {agent.artifact_id ? (
        <Btn variant="primary" size="sm" onClick={() => onLoadArtifact(agent.artifact_id)}>Открыть артефакт</Btn>
      ) : (
        <i className="c-t3 fs-11">Артефакт ещё не создан</i>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * FinalEstimate
 * ═══════════════════════════════════════════════════════════════════════ */
function FinalEstimate({ data, onRecompute, onTuneMargin, onManualEdit }) {
  const rec = (data.recommendation || 'THINK').toUpperCase();
  const recCls = rec.toLowerCase();
  const ssr = data.ssr || {};
  const sources = ssr._coefficient_sources || {};
  const tierIcon = (s) => s === 'analogs' ? '✅' : s === 'company_profile' ? '⚙' : '⚠';

  return (
    <div className="ce-final">
      <div className={'ce-final-rec ' + recCls}>{rec}</div>

      {(ssr.total_with_vat != null || ssr.total_with_margin != null) && (
        <div className="ce-final-totals">
          {ssr.subtotal_fot != null && (
            <div>
              <span>ФОТ{ssr.fot_multiplier_applied > 1 ? ` (×${ssr.fot_multiplier_applied.toFixed(2)})` : ''}:</span>
              <b>{fmtRub(ssr.subtotal_fot)}</b>
            </div>
          )}
          {ssr.total_cost != null && (
            <div><span>Себестоимость:</span><b>{fmtRub(ssr.total_cost)}</b></div>
          )}
          {ssr.gross_profit_margin_pct != null && (
            <div><span>Маржа {tierIcon(sources.margin)}:</span><b>{ssr.gross_profit_margin_pct.toFixed(1)}%</b></div>
          )}
          {ssr.total_with_margin != null && (
            <div><span>Цена без НДС:</span><b>{fmtRub(ssr.total_with_margin)}</b></div>
          )}
          {ssr.total_with_vat != null && (
            <div><span>С НДС {ssr.vat_pct || 22}% {tierIcon(sources.vat)}:</span><b>{fmtRub(ssr.total_with_vat)}</b></div>
          )}
        </div>
      )}

      <div className="ce-final-block">
        <b>Резюме</b>
        <p>{data.summary || '—'}</p>
      </div>
      <div className="ce-final-block">
        <b>Обоснование</b>
        <p>{data.decision_reasoning || '—'}</p>
      </div>
      {Array.isArray(data.key_assumptions) && data.key_assumptions.length > 0 && (
        <div className="ce-final-block">
          <b>Ключевые допущения</b>
          <ul>{data.key_assumptions.map((k, i) => <li key={i}>{k}</li>)}</ul>
        </div>
      )}

      <div className="ce-final-actions">
        <Btn variant="primary" onClick={onTuneMargin}>🎯 Настроить маржу / цену</Btn>
        <Btn variant="ghost" onClick={onRecompute}>🔄 Пересчитать с правкой</Btn>
        {/* Vanilla mimir-conductor-ui.js:851 — кнопка ручного JSON-редактора. */}
        <Btn variant="ghost" onClick={onManualEdit}>✏ JSON (продвинутый)</Btn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Clarifications
 * ═══════════════════════════════════════════════════════════════════════ */
const DOC_RE = /документ|чертёж|чертеж|ведомост|спецификац|тз|техническ.{0,3}задани|комплект|приложени|реестр|раб.{0,3}документ|сметы|схема/i;

function Clarifications({ clarifications, onAnswer, onAcceptAssumption, onAnswerNorms, onGenLetter }) {
  const open = clarifications;
  const blockingCount = open.filter((c) => c.blocking).length;
  const customerOpen = open.filter((c) => c.channel === 'CUSTOMER');

  return (
    <div className="ce-clar-bar">
      <div className="ce-clar-title">
        🟣 {open.length} уточнен{open.length === 1 ? 'ие' : 'ий'}
        {blockingCount > 0 && <span>({blockingCount} блокер{blockingCount === 1 ? '' : 'ов'})</span>}
        {customerOpen.length > 0 && (
          <Btn variant="primary" size="sm" onClick={() => onGenLetter(customerOpen.map((c) => c.id))}>
            📄 Письмо заказчику ({customerOpen.length})
          </Btn>
        )}
      </div>
      <div className="ce-clar-list">
        {open.map((c) => (
          <ClarificationCard
            key={c.id}
            clar={c}
            onAnswer={onAnswer}
            onAcceptAssumption={onAcceptAssumption}
            onAnswerNorms={onAnswerNorms}
          />
        ))}
      </div>
    </div>
  );
}

function ClarificationCard({ clar, onAnswer, onAcceptAssumption, onAnswerNorms }) {
  const oj = clar.options_json || {};
  const expectedInputs = Array.isArray(oj.expected_inputs) ? oj.expected_inputs : [];
  const [norms, setNorms] = useState({});

  const isDocQ = DOC_RE.test(String(clar.question_ru || ''));
  const channelLbl = clar.channel === 'CUSTOMER' ? '👤 ЗАКАЗЧИК' : '📋 РП';
  const cls = clar.channel === 'CUSTOMER' ? 'customer' : 'pm';

  const submitNorms = () => {
    const values = {};
    Object.entries(norms).forEach(([k, v]) => { if (v !== '') values[k] = v; });
    if (!Object.keys(values).length) { toast.warn('Заполните хотя бы одно поле'); return; }
    onAnswerNorms(clar, values);
  };

  return (
    <div className={'ce-clar ' + cls}>
      <div className="ce-clar-head">
        <span className="ce-clar-channel">{isDocQ ? '📎 ' : ''}{channelLbl}</span>
        {clar.blocking && <span className="ce-clar-block">⛔ блокер</span>}
        {clar.impact_rub > 0 && <span className="ce-clar-impact">≈{fmtRub(clar.impact_rub)}</span>}
      </div>
      <div className="ce-clar-q">{clar.question_ru || ''}</div>
      {clar.why_we_ask && <div className="ce-clar-why">Зачем: {clar.why_we_ask}</div>}
      {clar.consequence && <div className="ce-clar-conseq">⚠ {clar.consequence}</div>}

      {expectedInputs.length > 0 && (
        <div className="ce-norm-form">
          <div className="ce-norm-title">📝 Заполните данные — Conductor сразу применит:</div>
          {expectedInputs.map((inp, idx) => (
            <div key={idx} className="ce-norm-row">
              <label className="ce-norm-label">
                {inp.label}
                {inp.unit && <span className="ce-norm-unit"> {inp.unit}</span>}
                {inp.optional && <span className="ce-norm-opt"> (опц.)</span>}
              </label>
              <input
                className="ce-norm-input"
                type={inp.type === 'date' ? 'date' : (inp.type === 'number' ? 'number' : 'text')}
                step="any"
                value={norms[inp.key] || ''}
                onChange={(e) => setNorms((n) => ({ ...n, [inp.key]: e.target.value }))}
                placeholder="введите значение"
              />
              {inp.hint && <div className="ce-norm-hint">{inp.hint}</div>}
            </div>
          ))}
          <Btn variant="primary" size="sm" onClick={submitNorms}>💾 Сохранить и продолжить</Btn>
        </div>
      )}

      {clar.default_assumption && (
        <div className="ce-clar-assumption">
          <b>Допущение по умолчанию:</b>{' '}
          {(typeof clar.default_assumption === 'string' ? clar.default_assumption : JSON.stringify(clar.default_assumption)).slice(0, 200)}
          <div className="mt-6">
            <Btn variant="success-ghost" size="sm" onClick={() => onAcceptAssumption(clar)}>✓ Принять</Btn>
          </div>
        </div>
      )}

      <div className="ce-clar-actions">
        <Btn variant="primary" size="sm" onClick={() => onAnswer(clar)}>✍ Ответить текстом</Btn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Run Picker
 * ═══════════════════════════════════════════════════════════════════════ */
function RunPicker({ runs }) {
  const lastRunId = (() => { try { return parseInt(localStorage.getItem(LS_LAST_RUN), 10) || null; } catch { return null; } })();
  const active = runs.filter((r) => ACTIVE_RUN_STATUSES.has(r.status));
  const finished = runs.filter((r) => !ACTIVE_RUN_STATUSES.has(r.status));

  const card = (r) => {
    const name = r.tender_title || r.work_title || `Просчёт #${r.id}`;
    const customer = r.customer_name || r.work_customer || '';
    const isLast = lastRunId && Number(r.id) === Number(lastRunId);
    return (
      <a
        key={r.id}
        className="ce-pick-card"
        href={'#/conductor-estimate?run_id=' + r.id}
      >
        <div className="ce-pick-tags">
          <Pill tone={r.status === 'READY_FOR_REVIEW' ? 'ok' : (r.status === 'ERROR' ? 'err' : 'info')}>{r.status}</Pill>
          {isLast && <span className="fs-10 c-gold">⏵ был открыт последним</span>}
          {r.open_blockers > 0 && <span className="fs-10 c-err">⛔ {r.open_blockers} блокер{r.open_blockers === 1 ? '' : 'ов'}</span>}
          {r.status === 'WAITING_FOR_SLOT' && r.queue_position && (
            <span style={{ fontSize: 10, color: 'var(--amber)' }}>⏳ В очереди #{r.queue_position}</span>
          )}
        </div>
        <div className="ce-pick-name">{name.length > 80 ? name.slice(0, 80) + '…' : name}</div>
        <div className="ce-pick-meta">{customer} · {r.agents_done || 0} агентов · {fmtCost(r.total_cost_rub)}</div>
        <div className="ce-pick-time">обновлён: {new Date(r.updated_at || r.created_at).toLocaleString('ru-RU')}</div>
      </a>
    );
  };

  return (
    <div className="col gap-16">
      <TopActionsBar
        kicker="Conductor"
        title="🎼 Мои просчёты"
        subtitle="Выберите просчёт чтобы перейти в War Room"
      />

      <div className="ce-picker-section">
        <h3>🟢 Активные ({active.length})</h3>
        {active.length === 0 ? (
          <EmptyState icon="🎼" title="Нет активных просчётов" hint="Запустите со страницы работы или тендера." />
        ) : (
          active.map(card)
        )}
      </div>

      {finished.length > 0 && (
        <div className="ce-picker-section">
          <h3>✅ Завершённые ({finished.length})</h3>
          {finished.slice(0, 10).map(card)}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Текст события для ленты
 * ═══════════════════════════════════════════════════════════════════════ */
function eventText(e) {
  const p = e.payload || {};
  switch (e.type) {
    case 'thought': return '💭 ' + (p.text || '');
    case 'agent_started': return '▶ запущен';
    case 'artifact_emitted': return '📤 артефакт ' + (p.artifact_type || '');
    case 'clarification_raised': return '🟣 уточнение: ' + (p.question_ru || '');
    case 'status_change': return '↪ статус → ' + (p.to || '');
    case 'final_estimate': return '🏁 финальная смета (' + (p.recommendation || '') + ')';
    case 'error': return '🔴 ' + (p.text || p.message || 'ошибка');
    case 'mode': return '⚙️ режим: ' + (p.stub ? 'stub' : 'live') + ' · модель ' + (p.conductor_model || '');
    case 'tool_call': return '🔧 ' + (p.tool || '');
    case 'tool_result': return '↳ результат';
    default: return '· ' + e.type;
  }
}
