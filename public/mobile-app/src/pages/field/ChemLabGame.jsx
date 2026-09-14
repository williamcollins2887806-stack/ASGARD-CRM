import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import {
  REAGENTS, cloneCans, topOf, applyPour, hasGoal,
  pourPreview, goalLabel, recipeHint, playTone, buildPassport,
} from '@/lib/chemLabLogic';
import { startPourTimeline } from '@/lib/chemLabPourTimeline';
import ChemLabStage from './ChemLabStage';
import ReactionVfx from './ReactionVfx';
import './chem-lab-game.css';

function WinSparks() {
  const sparks = useMemo(() => Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2 + 0.2;
    const dist = 55 + (i % 5) * 18;
    return {
      dx: `${Math.cos(a) * dist}px`,
      dy: `${Math.sin(a) * dist * 0.85}px`,
      delay: `${0.05 + i * 0.025}s`,
    };
  }), []);
  return (
    <div className="cl-win-sparks" aria-hidden>
      {sparks.map((s, i) => (
        <i key={i} style={{ '--dx': s.dx, '--dy': s.dy, animationDelay: s.delay }} />
      ))}
    </div>
  );
}

export default function ChemLabGame() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const timers = useRef([]);
  const pourCtl = useRef(null);
  const particlesRef = useRef(null);
  const pourVisualRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [session, setSession] = useState(null);
  const [cans, setCans] = useState([]);
  const [selected, setSelected] = useState(null);
  const [moves, setMoves] = useState(0);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [phase, setPhase] = useState('playing');
  const [locked, setLocked] = useState(false);
  const [vfxState, setVfxState] = useState(null);
  const [winResult, setWinResult] = useState(null);
  const [hintPair, setHintPair] = useState(null);
  const [usedHint, setUsedHint] = useState(false);
  const [failStreak, setFailStreak] = useState(0);
  const [showBrief, setShowBrief] = useState(true);
  const [passport, setPassport] = useState(null);
  const [epilogueReady, setEpilogueReady] = useState(false);
  const [epilogueActions, setEpilogueActions] = useState(false);
  const [failReagent, setFailReagent] = useState(null);
  const [softPulse, setSoftPulse] = useState(null);
  const [mixIdx, setMixIdx] = useState(null);
  const [shakeIdx, setShakeIdx] = useState(null);
  const startTs = useRef(Date.now());

  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const later = useCallback((fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
    return id;
  }, []);

  const cancelPour = useCallback(() => {
    pourCtl.current?.cancel?.();
    pourCtl.current = null;
    pourVisualRef.current = null;
  }, []);

  useEffect(() => () => {
    clearTimers();
    cancelPour();
    particlesRef.current?.clear?.();
  }, [clearTimers, cancelPour]);

  const reagentsMap = useMemo(() => {
    const map = { ...REAGENTS };
    (session?.reagents || []).forEach((r) => {
      const base = REAGENTS[r.code] || {};
      // Цвета берём с клиента — палитра различимости, сервер может отставать
      map[r.code] = { ...base, ...r, color: base.color || r.color };
    });
    return map;
  }, [session]);

  const preview = useMemo(() => {
    if (selected == null || locked || phase !== 'playing') {
      return { valid: [], danger: [], blocked: [] };
    }
    return pourPreview(cans, selected);
  }, [selected, cans, locked, phase]);

  const loadLevel = useCallback(async (level) => {
    clearTimers();
    cancelPour();
    particlesRef.current?.clear?.();
    setLoading(true);
    setError(null);
    setSelected(null);
    setMoves(0);
    setHistory([]);
    setHintPair(null);
    setUsedHint(false);
    setWinResult(null);
    setVfxState(null);
    pourVisualRef.current = null;
    setSoftPulse(null);
    setMixIdx(null);
    setShakeIdx(null);
    setLocked(false);
    setPhase('playing');
    setShowBrief(true);
    setEpilogueReady(false);
    startTs.current = Date.now();
    try {
      const [st, start] = await Promise.all([
        fieldApi.get('/chemlab/stats'),
        fieldApi.post('/chemlab/start', level ? { level } : {}),
      ]);
      setStats(st);
      setSession(start);
      setCans(cloneCans(start.cans));
      playTone(220, 0.05, 'triangle', 0.04);
    } catch (e) {
      setError(e.message || 'Не удалось начать наряд');
    } finally {
      setLoading(false);
    }
  }, [clearTimers, cancelPour]);

  useEffect(() => { loadLevel(); }, [loadLevel]);

  const completeLevel = useCallback(async (finalCans, movesUsed, hinted) => {
    try {
      const res = await fieldApi.post('/chemlab/complete', {
        session_id: session.session_id,
        cans: finalCans,
        moves_used: movesUsed,
        fail_count: 0,
        used_hint: hinted,
        time_ms: Date.now() - startTs.current,
      });
      setWinResult(res);
      setPhase('won');
      setFailStreak(0);
      setLocked(false);
      particlesRef.current?.burstWin?.();
      haptic.success();
      playTone(523, 0.1, 'sine', 0.07);
      later(() => playTone(659, 0.12, 'sine', 0.07), 90);
      later(() => playTone(784, 0.18, 'sine', 0.08), 180);
    } catch (e) {
      setError(e.message || 'Ошибка засчёта');
      setLocked(false);
      setPhase('playing');
    }
  }, [session, haptic, later]);

  const splashAt = useCallback((toIdx, color) => {
    const api = particlesRef.current;
    if (!api || reducedMotion) return;
    const hits = document.querySelector(`.cl-stage-hits [data-can-idx="${toIdx}"]`);
    const stage = document.querySelector('.cl-stage');
    if (!hits || !stage) return;
    const sr = stage.getBoundingClientRect();
    const hr = hits.getBoundingClientRect();
    const x = hr.left + hr.width / 2 - sr.left;
    const y = hr.top + hr.height * 0.35 - sr.top;
    api.spawnSplash(x, y, color, 20);
  }, [reducedMotion]);

  const failBurstAt = useCallback((toIdx, vfx) => {
    const api = particlesRef.current;
    if (!api || reducedMotion) return;
    const hits = document.querySelector(`.cl-stage-hits [data-can-idx="${toIdx}"]`);
    const stage = document.querySelector('.cl-stage');
    if (!hits || !stage) return;
    const sr = stage.getBoundingClientRect();
    const hr = hits.getBoundingClientRect();
    const x = hr.left + hr.width / 2 - sr.left;
    const y = hr.top + hr.height * 0.4 - sr.top;
    api.spawnFailCanvas(x, y, vfx);
    if (api.burstFail) api.burstFail(x, y, vfx);
  }, [reducedMotion]);

  const onCanTap = (index) => {
    if (phase !== 'playing' || loading || locked) return;

    if (selected == null) {
      if (!cans[index].layers.length) {
        setShakeIdx(index);
        haptic.light();
        later(() => setShakeIdx(null), 280);
        return;
      }
      setSelected(index);
      haptic.light();
      playTone(330, 0.05, 'sine', 0.04);
      return;
    }

    if (selected === index) {
      setSelected(null);
      haptic.light();
      return;
    }

    const from = selected;
    const to = index;
    const res = applyPour(cans, from, to);

    if (!res.ok && !res.fail) {
      setShakeIdx(to);
      haptic.medium();
      playTone(140, 0.08, 'square', 0.04);
      later(() => setShakeIdx(null), 300);
      return;
    }

    setSelected(null);
    setHintPair(null);
    setLocked(true);
    clearTimers();
    cancelPour();

    const fromEl = document.querySelector(`.cl-stage-hits [data-can-idx="${from}"]`);
    const toEl = document.querySelector(`.cl-stage-hits [data-can-idx="${to}"]`);
    let tiltDir = to > from ? 'right' : 'left';
    if (fromEl && toEl) {
      const a = fromEl.getBoundingClientRect();
      const b = toEl.getBoundingClientRect();
      tiltDir = (b.left + b.width / 2) >= (a.left + a.width / 2) ? 'right' : 'left';
    }
    const color = res.color || '#888';
    const colorCode = topOf(cans[from]);
    const before = cloneCans(cans);

    if (res.fail) {
      const vfx = res.reaction?.vfx || 'explosion';
      setPassport(null); // не перекрывать catastrophe паспортом
      setEpilogueActions(false);
      setFailReagent(colorCode || topOf(cans[from]));
      pourVisualRef.current = {
        from, to, color, colorCode, tiltDir, fail: true,
        before, poured: 0, transfer: 0, tilt: 0, lift: 0, streamAlpha: 0, wave: 0,
      };
      haptic.heavy();
      playTone(90, 0.15, 'sawtooth', 0.08);

      pourCtl.current = startPourTimeline({
        fail: true,
        reducedMotion,
        onFrame: (f) => {
          const pv = pourVisualRef.current;
          if (!pv) return;
          pv.tilt = f.tilt;
          pv.lift = f.lift;
          pv.streamAlpha = 0;
          pv.transfer = 0;
        },
        onEnd: () => {
          pourVisualRef.current = null;
          failBurstAt(to, vfx);
          setVfxState({
            vfx,
            title: res.reaction?.title,
            fact: res.reaction?.fact,
          });
          setPhase('vfx');
          setFailStreak((s) => s + 1);
          setLocked(false);
          pourCtl.current = null;
        },
      });
      return;
    }

    // Success pour
    haptic.medium();
    playTone(400, 0.06, 'sine', 0.05);
    setHistory((h) => [...h, before]);
    const nextMoves = moves + 1;
    const poured = res.poured || 1;

    pourVisualRef.current = {
      from, to, color, colorCode, tiltDir, fail: false,
      before, poured, transfer: 0, tilt: 0, lift: 0,
      streamAlpha: 0, wave: 0, committed: false,
    };

    pourCtl.current = startPourTimeline({
      reducedMotion,
      onFrame: (f) => {
        const pv = pourVisualRef.current;
        if (!pv) return;
        pv.transfer = f.transfer;
        pv.tilt = f.tilt;
        pv.lift = f.lift;
        pv.streamAlpha = f.streamAlpha;
        pv.wave = f.wave;
      },
      onStreamPeak: () => {
        playTone(480, 0.05, 'sine', 0.04);
        haptic.light();
      },
      onCommit: () => {
        setCans(res.cans);
        setMoves(nextMoves);
        const pv = pourVisualRef.current;
        if (pv) {
          pv.committed = true;
          pv.before = res.cans;
        }
        playTone(520, 0.07, 'triangle', 0.05);
        if (res.reaction?.vfx === 'foam' || res.reaction?.vfx === 'steam') {
          setSoftPulse(res.reaction.vfx);
          setMixIdx(to);
          const api = particlesRef.current;
          if (api && !reducedMotion) {
            const hits = document.querySelector(`.cl-stage-hits [data-can-idx="${to}"]`);
            const stage = document.querySelector('.cl-stage');
            if (hits && stage) {
              const sr = stage.getBoundingClientRect();
              const hr = hits.getBoundingClientRect();
              api.spawnSoft(
                hr.left + hr.width / 2 - sr.left,
                hr.top + hr.height * 0.35 - sr.top,
                res.reaction.vfx
              );
            }
          }
          later(() => {
            setSoftPulse(null);
            setMixIdx(null);
          }, 720);
        }
      },
      onLand: () => {
        splashAt(to, color);
        setMixIdx(to);
        later(() => setMixIdx((cur) => (cur === to ? null : cur)), 480);
        haptic.medium();
      },
      onEnd: () => {
        pourVisualRef.current = null;
        pourCtl.current = null;
        if (hasGoal(res.cans, session?.goal)) {
          later(() => completeLevel(res.cans, nextMoves, usedHint), 220);
        } else {
          setLocked(false);
        }
      },
    });
  };

  const undo = () => {
    if (!history.length || phase !== 'playing' || locked) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCans(prev);
    setMoves((m) => Math.max(0, m - 1));
    setSelected(null);
    haptic.light();
    playTone(260, 0.05, 'triangle', 0.04);
  };

  const useProtocol = useCallback(async () => {
    if (!session || phase !== 'playing' || locked) return;
    try {
      const hint = await fieldApi.post('/chemlab/tool', {
        session_id: session.session_id,
        tool: 'protocol',
        cans,
      });
      if (hint.from != null && hint.to != null) {
        setHintPair({ from: hint.from, to: hint.to });
        setUsedHint(true);
        setSelected(hint.from);
        haptic.medium();
        playTone(600, 0.08, 'sine', 0.05);
      }
    } catch (e) {
      setError(e.message || 'Протокол недоступен');
    }
  }, [session, phase, locked, cans, haptic]);

  const usePassport = useCallback(async (forceCode) => {
    const code = forceCode
      || (selected != null ? topOf(cans[selected]) : null)
      || failReagent
      || topOf(cans.find((c) => c.layers.length) || { layers: [] });
    if (!code) return;

    // Локальная карточка сразу — не зависеть от отстающего API
    const local = buildPassport(code);
    if (local) setPassport(local);
    haptic.light();

    if (!session) return;
    try {
      const res = await fieldApi.post('/chemlab/tool', {
        session_id: session.session_id,
        tool: 'passport',
        cans,
        reagent: code,
      });
      setPassport({
        ...local,
        ...res,
        reagent: { ...(local?.reagent || {}), ...(res.reagent || {}) },
        tip: res.tip || local?.tip,
        rule: res.rule || local?.rule,
        allow: (res.allow?.length ? res.allow : local?.allow) || [],
        forbid: (res.forbid?.length ? res.forbid : local?.forbid) || [],
      });
    } catch {
      /* локальный паспорт уже показан */
    }
  }, [selected, cans, session, haptic, failReagent]);

  useEffect(() => {
    // Авто-помощь только после возврата в игру; паспорт никогда не открываем поверх аварии
    if (phase !== 'playing') return;
    if (failStreak >= 3 && session) useProtocol();
  }, [failStreak, session, useProtocol, phase]);

  const handleVfxEpilogue = useCallback(() => {
    setEpilogueReady(true);
    setEpilogueActions(false);
    setPhase('epilogue');
    // Даём прочитать причину аварии до кнопок (~3.2 с; тап ускоряет)
    later(() => setEpilogueActions(true), reducedMotion ? 600 : 1400);
  }, [later, reducedMotion]);

  const revealEpilogueActions = () => {
    if (!epilogueReady) return;
    setEpilogueActions(true);
  };

  const retryAfterFail = () => {
    clearTimers();
    cancelPour();
    particlesRef.current?.clear?.();
    setVfxState(null);
    setEpilogueReady(false);
    setEpilogueActions(false);
    setPhase('playing');
    setSelected(null);
    setLocked(false);
    playTone(300, 0.06, 'sine', 0.04);
  };

  const openPassportFromEpilogue = () => {
    const code = failReagent;
    clearTimers();
    setVfxState(null);
    setEpilogueReady(false);
    setEpilogueActions(false);
    setPhase('playing');
    setSelected(null);
    setLocked(false);
    later(() => usePassport(code), 40);
  };

  if (loading && !session) {
    return (
      <div className="cl-root">
        <div className="cl-loading">
          <div className="cl-loading-can" />
          <span>Готовим наряд…</span>
        </div>
      </div>
    );
  }

  const world = session?.world;
  const chapter = session?.chapter;
  const goalText = goalLabel(session?.goal);
  const starGoals = session?.stars || null;
  const softLimit = session?.move_limit || 0;
  const threeStar = starGoals?.three ?? (session?.min_moves != null ? session.min_moves + 1 : null);
  const moveRatio = softLimit > 0 ? Math.min(1, moves / softLimit) : 0;
  const ratingLabel = (stars, used, min) => {
    if (stars >= 3) return used <= (min || used) ? 'Идеал смены' : 'Отлично';
    if (stars === 2) return 'Хорошо';
    return 'Зачтено';
  };

  return (
    <div className={`cl-root cl-root--canvas${locked ? ' cl-root--locked' : ''}`}>
      <header className="cl-top">
        <button type="button" className="cl-back" onClick={() => navigate('/field')} aria-label="Назад">←</button>
        <div className="cl-title-block">
          <h1 className="cl-title">Химцех {world?.icon || '🧪'}</h1>
          <div className="cl-sub">
            {chapter?.title || world?.name || 'Смена'} · №{session?.level ?? '—'}
            {stats?.current_streak ? ` · 🔥${stats.current_streak}` : ''}
          </div>
        </div>
        <div className="cl-hud-right">
          <div className="cl-pill" aria-live="polite">ход {moves}</div>
          {threeStar != null && (
            <div className="cl-star-hint" title="Порог 3★">
              ⭐≤{threeStar}
            </div>
          )}
        </div>
      </header>

      {chapter && (
        <div className="cl-chapter" aria-label={chapter.title}>
          <span className="cl-chapter-icon">{chapter.icon}</span>
          <div className="cl-chapter-meta">
            <strong>{chapter.name}</strong>
            <span>этап {chapter.stage}/{chapter.total}</span>
          </div>
          <div className="cl-stages" aria-hidden>
            {Array.from({ length: chapter.total }, (_, i) => (
              <i
                key={i}
                className={
                  i + 1 < chapter.stage ? 'is-done'
                    : i + 1 === chapter.stage ? 'is-now'
                      : ''
                }
              />
            ))}
          </div>
        </div>
      )}

      {error && (
        <button type="button" className="cl-error" onClick={() => setError(null)}>
          {error}
        </button>
      )}

      <div className="cl-goal" aria-live="polite">
        <span className="cl-goal-kicker">ЗАДАЧА</span>
        <span>{goalText}</span>
        {recipeHint(session?.goal) ? (
          <span className="cl-recipe">{recipeHint(session.goal)}</span>
        ) : null}
        {softLimit > 0 && (
          <div className="cl-move-bar" aria-hidden>
            <i style={{ width: `${moveRatio * 100}%` }} />
          </div>
        )}
      </div>

      <div className="cl-bench-wrap">
        <ChemLabStage
          cans={cans}
          reagents={reagentsMap}
          selected={selected}
          hintPair={hintPair}
          valid={preview.valid}
          danger={preview.danger}
          shakeIdx={shakeIdx}
          pourVisualRef={pourVisualRef}
          mixIdx={mixIdx}
          reducedMotion={reducedMotion}
          locked={locked || phase !== 'playing'}
          onCanTap={onCanTap}
          particlesRef={particlesRef}
        />
      </div>

      <div className="cl-tools">
        <button type="button" className="cl-tool" onClick={undo} disabled={!history.length || locked || phase !== 'playing'}>
          <span>↩</span> Отмена
        </button>
        <button type="button" className="cl-tool" onClick={useProtocol} disabled={locked || phase !== 'playing'}>
          <span>📋</span> Протокол
        </button>
        <button type="button" className="cl-tool" onClick={usePassport} disabled={locked || phase !== 'playing'}>
          <span>🪪</span> Паспорт
        </button>
      </div>

      {session?.brief && showBrief && phase === 'playing' && (
        <div className="cl-brief-veil">
          <div className={`cl-brief ${session.brief.danger ? 'cl-brief--danger' : ''}`}>
            <p className="cl-brief-title">{session.brief.title}</p>
            <p className="cl-brief-text">{session.brief.text}</p>
            <button
              type="button"
              className="cl-btn"
              onClick={() => {
                setShowBrief(false);
                haptic.medium();
                playTone(440, 0.06, 'sine', 0.05);
              }}
            >
              К канистрам
            </button>
          </div>
        </div>
      )}

      {softPulse && <div className={`cl-soft-pulse cl-soft-pulse--${softPulse}`} aria-hidden />}

      {(phase === 'vfx' || phase === 'epilogue') && vfxState && (
        <>
          <ReactionVfx
            active
            vfx={vfxState.vfx}
            title={vfxState.title}
            fact={vfxState.fact}
            reducedMotion={reducedMotion}
            onEpilogue={handleVfxEpilogue}
          />
          {epilogueReady && phase === 'epilogue' && (
            <div
              className="cl-overlay cl-overlay--epilogue"
              onClick={revealEpilogueActions}
              role="presentation"
            >
              {epilogueActions ? (
                <div className="cl-card" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="cl-btn" onClick={retryAfterFail}>Ещё раз</button>
                  <button type="button" className="cl-btn cl-btn--ghost" onClick={openPassportFromEpilogue}>
                    Паспорт вещества
                  </button>
                </div>
              ) : (
                <p className="cl-epi-tap">Нажми, когда прочитаешь</p>
              )}
            </div>
          )}
        </>
      )}

      {phase === 'won' && winResult && (
        <div className="cl-overlay">
          <div className="cl-card cl-card--win">
            <WinSparks />
            <div className="cl-stamp">НАРЯД ЗАКРЫТ</div>
            <div className="cl-stars">
              {[1, 2, 3].map((n) => (
                <span key={n}>{n <= (winResult.stars || 1) ? '⭐' : '☆'}</span>
              ))}
            </div>
            <p className="cl-rating">
              {ratingLabel(winResult.stars || 1, winResult.moves_used ?? moves, winResult.min_moves ?? session?.min_moves)}
            </p>
            <h2>{chapter?.stage === 5 ? 'Смена закрыта' : 'Этап зачтён'}</h2>
            <p className="cl-win-meta">
              {winResult.moves_used ?? moves} ход.
              {(winResult.min_moves ?? session?.min_moves) != null
                ? ` · оптимум ${winResult.min_moves ?? session.min_moves}`
                : ''}
              <br />
              +{winResult.total_xp || winResult.xp || 0} XP · +{winResult.total_runes || winResult.runes || 0} ᚱ
              {winResult.current_streak ? ` · серия ${winResult.current_streak}` : ''}
            </p>
            <button type="button" className="cl-btn" onClick={() => loadLevel((session?.level || 0) + 1)}>
              {chapter?.stage === 5 ? 'Следующая смена' : 'Следующий этап'}
            </button>
            <button type="button" className="cl-btn cl-btn--ghost" onClick={() => navigate('/field/leaderboard?tab=chemlab')}>
              Рейтинг Химцеха
            </button>
          </div>
        </div>
      )}

      {passport && phase === 'playing' && (
        <div className="cl-overlay cl-overlay--passport" onClick={() => setPassport(null)}>
          <div className="cl-card cl-card--passport" onClick={(e) => e.stopPropagation()}>
            <p className="cl-brief-title">ПАСПОРТ ВЕЩЕСТВА</p>
            <h2>{passport.reagent?.name || 'Паспорт'}</h2>
            <p className="cl-pass-short" style={{ color: passport.reagent?.color || '#aaa' }}>
              {passport.reagent?.short}
              {passport.reagent?.hazard ? ' · опасно' : ''}
            </p>
            {passport.rule && <p className="cl-pass-rule">{passport.rule}</p>}
            <p className="cl-pass-tip">{passport.tip}</p>
            {!!passport.allow?.length && (
              <div className="cl-pass-block cl-pass-block--ok">
                <strong>Можно</strong>
                <ul>
                  {passport.allow.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            )}
            {!!passport.forbid?.length && (
              <div className="cl-pass-block cl-pass-block--no">
                <strong>Нельзя</strong>
                <ul>
                  {passport.forbid.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            )}
            <button type="button" className="cl-btn" onClick={() => setPassport(null)}>Понятно</button>
          </div>
        </div>
      )}
    </div>
  );
}
