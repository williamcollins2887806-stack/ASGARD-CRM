import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, Sparkles, Send, CheckCircle2, FileText, Briefcase, Package,
  Users, Calculator, Loader2, AlertTriangle, Info, AlertOctagon, ArrowRight,
} from 'lucide-react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { MarkdownText } from '@/components/chat/MarkdownText';

/**
 * MimirAutoEstimate (AP2)
 *
 * Полный pipeline:
 *   1. SSE stream POST /mimir/auto-estimate {work_id}
 *      → progress events → AI thinking → result event с card+analysis+estimate_id
 *   2. Итоговая карточка с метриками (Telegram-style grid)
 *   3. Warnings блок (amber bg)
 *   4. Кнопка "Открыть просчёт →" (gold gradient)
 *   5. Композер для диалога — РП спрашивает → POST /mimir/auto-estimate-chat
 *      → обновляем card в стейте
 */

const STEP_ICONS = {
  start: Sparkles,
  documents: FileText,
  analogs: Briefcase,
  customer_history: Briefcase,
  warehouse: Package,
  workers: Users,
  tariffs: Calculator,
  collected: CheckCircle2,
  ai_thinking: Sparkles,
  creating_estimate: FileText,
};

const fmtMoney = (n) => {
  if (n == null) return '—';
  return Math.round(Number(n)).toLocaleString('ru-RU') + ' ₽';
};

const fmtMln = (n) => {
  if (n == null || n === 0) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + ' М₽';
  if (Math.abs(v) >= 1e3) return Math.round(v / 1e3) + ' тыс₽';
  return Math.round(v) + ' ₽';
};

export default function MimirAutoEstimate() {
  const { workId } = useParams();
  const navigate = useNavigate();
  const haptic = useHaptic();

  const [steps, setSteps] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [chatMessages, setChatMessages] = useState([]); // [{role, text, ts}]
  const [composerText, setComposerText] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  // AP3: проверка существующего draft
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [existingDraft, setExistingDraft] = useState(null);

  const bottomRef = useRef(null);
  const abortRef = useRef(null);
  const composerRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps.length, result, error, chatMessages.length]);

  const startStream = useCallback(async () => {
    setSteps([]);
    setResult(null);
    setError(null);
    setChatMessages([]);
    setRunning(true);
    haptic.medium();

    const token = api.getToken();
    if (!token) { setError('Не авторизован'); setRunning(false); return; }

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const response = await fetch('/api/mimir/auto-estimate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({ work_id: parseInt(workId) }),
        signal: ctrl.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errBody.substring(0, 200)}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          let event;
          try { event = JSON.parse(json); } catch { continue; }
          handleEvent(event);
        }
      }
      setRunning(false);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[MimirAutoEstimate] error:', err);
      setError(err.message || 'Ошибка соединения');
      setRunning(false);
    }
  }, [workId, haptic]);

  // Stagger queue для прогресс-шагов (400мс между шагами)
  const staggerQueue = useRef([]);
  const staggerTimer = useRef(null);

  function enqueueStepEvent(evt) {
    staggerQueue.current.push(evt);
    if (!staggerTimer.current) drainQueue();
  }

  function drainQueue() {
    if (staggerQueue.current.length === 0) { staggerTimer.current = null; return; }
    const evt = staggerQueue.current.shift();
    setSteps((prev) => [...prev, {
      key: evt.step || 'start',
      message: evt.message || evt.step,
      status: 'done',
      ts: Date.now(),
    }]);
    staggerTimer.current = setTimeout(drainQueue, 2500);
  }

  function handleEvent(event) {
    if (event.type === 'start' || event.type === 'progress') {
      enqueueStepEvent(event);
      return;
    }
    if (event.type === 'result') {
      setResult(event);
      haptic.success();
      return;
    }
    if (event.type === 'error') {
      setError(event.message);
      haptic.error?.();
      return;
    }
  }

  async function sendChatMessage() {
    const text = composerText.trim();
    if (!text || !result?.estimate_id || chatLoading) return;
    haptic.light();

    const userMsg = { role: 'user', text, ts: Date.now() };
    setChatMessages((prev) => [...prev, userMsg]);
    setComposerText('');
    if (composerRef.current) composerRef.current.style.height = 'auto';
    setChatLoading(true);

    try {
      const res = await api.post('/mimir/auto-estimate-chat', {
        work_id: parseInt(workId),
        estimate_id: result.estimate_id,
        message: text,
        history: chatMessages,
      });

      if (res.success) {
        // Обновляем карточку
        setResult((prev) => ({
          ...prev,
          card: { ...prev.card, ...res.updated_card },
          analysis: { ...prev.analysis, ...res.updated_analysis },
        }));
        setChatMessages((prev) => [...prev, {
          role: 'mimir',
          text: res.response || 'Готово.',
          ts: Date.now(),
        }]);
        haptic.success();
      } else {
        throw new Error(res.message || 'Ошибка');
      }
    } catch (err) {
      setChatMessages((prev) => [...prev, {
        role: 'mimir',
        text: 'Ошибка: ' + (err.message || 'неизвестная'),
        ts: Date.now(),
        error: true,
      }]);
    } finally {
      setChatLoading(false);
    }
  }

  // AP3: При маунте проверяем нет ли уже draft. Если есть — показываем выбор.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/mimir/auto-estimate/check?work_id=${workId}`);
        if (cancelled) return;
        if (res.exists) {
          setExistingDraft(res);
          setChatMessages(res.chat_history || []);
          setCheckingExisting(false);
        } else {
          setCheckingExisting(false);
          startStream();
        }
      } catch (e) {
        if (cancelled) return;
        setCheckingExisting(false);
        startStream();
      }
    })();
    return () => {
      cancelled = true;
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

  const card = result?.card;
  const analysis = result?.analysis;
  const hasResult = !!card;

  return (
    <div className="flex flex-col h-full bg-primary">
      {/* Header */}
      <header
        className="shrink-0 flex items-center gap-2 px-2"
        style={{
          paddingTop: 'calc(var(--safe-top) + 6px)',
          paddingBottom: 8,
          background: 'var(--bg-primary)',
          borderBottom: '0.5px solid var(--border-norse)',
          zIndex: 10,
        }}
      >
        <button
          onClick={() => { haptic.light(); navigate(-1); }}
          className="flex items-center justify-center spring-tap btn-icon c-blue"
        >
          <ChevronLeft size={28} />
        </button>
        <div
          className="flex items-center justify-center rounded-full shrink-0"
          style={{ width: 36, height: 36, background: 'var(--gold-gradient)' }}
        >
          <Sparkles size={18} color="#fff" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold c-gold">Мимир считает</p>
          <p className="text-[11px] c-tertiary">Работа #{workId}</p>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto scroll-container px-3 py-4">
        {/* AP3: Spinner проверки существующего */}
        {checkingExisting && (
          <div className="flex flex-col items-center justify-center py-10">
            <Loader2 size={28} className="animate-spin mb-3" style={{ color: 'var(--gold)' }} />
            <p className="text-[13px] c-tertiary">Проверяю предыдущие просчёты...</p>
          </div>
        )}

        {/* AP3: Выбор — открыть существующий или пересчитать */}
        {!checkingExisting && existingDraft && !running && !result && (
          <div>
            <MimirBubble>
              <p className="text-[14px] leading-[1.5]">
                По этой работе уже есть просчёт <strong>#{existingDraft.estimate.id}</strong>.
                Можешь открыть его или попросить меня пересчитать заново.
              </p>
            </MimirBubble>
            <div
              className="rounded-2xl p-4 mb-3 mt-2"
              style={{
                background: 'color-mix(in srgb, var(--gold) 6%, var(--bg-surface-alt))',
                border: '0.5px solid color-mix(in srgb, var(--gold) 30%, var(--border-norse))',
              }}
            >
              <p className="text-[13px] font-bold c-primary mb-2">{existingDraft.estimate.title || `Просчёт #${existingDraft.estimate.id}`}</p>
              <SummaryRow label="Себестоимость" value={fmtMoney(existingDraft.estimate.cost_plan)} />
              <SummaryRow label="Клиенту" value={fmtMoney(existingDraft.estimate.price_tkp)} />
              <SummaryRow label="Маржа" value={existingDraft.estimate.margin_pct ? `${existingDraft.estimate.margin_pct}%` : '—'} />
              <SummaryRow label="Бригада" value={existingDraft.estimate.crew_count ? `${existingDraft.estimate.crew_count} × ${existingDraft.estimate.work_days || '?'} дн` : '—'} />
              <SummaryRow label="Диалог" value={`${existingDraft.chat_history?.length || 0} сообщ.`} />
            </div>

            <button
              onClick={() => {
                haptic.medium();
                navigate(`/estimate-report/${existingDraft.estimate.id}`);
              }}
              className="w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 mb-2 spring-tap"
              style={{
                background: 'linear-gradient(135deg, #D4A843 0%, #B88B2E 100%)',
                color: '#fff', border: 'none',
                boxShadow: '0 6px 24px rgba(212,168,67,0.35), 0 0 50px rgba(212,168,67,0.18)',
              }}
            >
              <span className="text-[14px] font-bold">Открыть просчёт #{existingDraft.estimate.id}</span>
              <ArrowRight size={18} />
            </button>

            <button
              onClick={() => {
                haptic.light();
                setExistingDraft(null);
                startStream();
              }}
              className="w-full rounded-2xl px-4 py-3 text-[14px] font-semibold c-secondary spring-tap"
              style={{
                background: 'var(--bg-surface-alt)',
                border: '0.5px solid var(--border-norse)',
              }}
            >
              Пересчитать заново
            </button>
          </div>
        )}

        {/* Greeting (только когда запущен новый сбор) */}
        {!checkingExisting && !existingDraft && (
          <MimirBubble>
            <p className="text-[14px] leading-[1.45]">
              Сейчас соберу всё что нужно для просчёта: документы тендера, аналогичные работы, историю
              заказчика, остатки склада, свободных рабочих и тарифы. Затем посчитаю себестоимость
              и наценку.
            </p>
          </MimirBubble>
        )}

        {/* Progress steps */}
        {steps.map((s, i) => {
          const Icon = STEP_ICONS[s.key] || Sparkles;
          return (
            <div key={i} className="flex items-start gap-2 mb-2 animate-stepIn" style={{ animationDelay: `${i * 30}ms` }}>
              <div
                className="shrink-0 flex items-center justify-center rounded-full mt-0.5"
                style={{
                  width: 28, height: 28,
                  background: 'color-mix(in srgb, var(--gold) 14%, var(--bg-surface-alt))',
                  border: '0.5px solid color-mix(in srgb, var(--gold) 30%, var(--border-norse))',
                }}
              >
                <Icon size={14} style={{ color: 'var(--gold)' }} />
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <p className="text-[13px] c-primary">{s.message}</p>
              </div>
            </div>
          );
        })}

        {/* AI thinking spinner */}
        {running && steps.length > 0 && !hasResult && !error && (
          <div className="flex items-center gap-2 mb-2 mt-1">
            <div
              className="shrink-0 flex items-center justify-center rounded-full"
              style={{
                width: 28, height: 28,
                background: 'color-mix(in srgb, var(--gold) 14%, var(--bg-surface-alt))',
                border: '0.5px solid color-mix(in srgb, var(--gold) 30%, var(--border-norse))',
              }}
            >
              <Loader2 size={14} className="animate-spin" style={{ color: 'var(--gold)' }} />
            </div>
            <p className="text-[12px] c-tertiary">Мимир думает...</p>
          </div>
        )}

        {/* RESULT CARD */}
        {hasResult && <ResultCard card={card} />}

        {/* Comment from Mimir */}
        {hasResult && result?.comment && (
          <MimirBubble>
            <div className="text-[14px] leading-[1.5] c-primary">
              <MarkdownText text={result.comment} />
            </div>
          </MimirBubble>
        )}

        {/* Markup reasoning */}
        {hasResult && analysis?.markup_reasoning && (
          <MimirBubble>
            <p className="text-[11px] font-semibold mb-1.5 c-gold">💰 Обоснование наценки</p>
            <div className="text-[13px] leading-[1.5] c-primary">
              <MarkdownText text={analysis.markup_reasoning} />
            </div>
          </MimirBubble>
        )}

        {/* Warnings */}
        {hasResult && analysis?.warnings?.length > 0 && (
          <div className="mb-3">
            {analysis.warnings.map((w, i) => <WarningCard key={i} warning={w} />)}
          </div>
        )}

        {/* Workers / warehouse status */}
        {hasResult && (analysis?.workers_status || analysis?.warehouse_status) && (
          <MimirBubble>
            {analysis.workers_status && (
              <p className="text-[13px] mb-1.5 c-primary">
                <span className="c-gold font-semibold">👷 Рабочие: </span>
                {analysis.workers_status}
              </p>
            )}
            {analysis.warehouse_status && (
              <p className="text-[13px] c-primary">
                <span className="c-gold font-semibold">🏭 Склад: </span>
                {analysis.warehouse_status}
              </p>
            )}
          </MimirBubble>
        )}

        {/* Purchases needed */}
        {hasResult && analysis?.purchases_needed?.length > 0 && (
          <div
            className="mb-3 rounded-2xl p-4"
            style={{
              background: 'color-mix(in srgb, var(--blue) 6%, var(--bg-surface-alt))',
              border: '0.5px solid color-mix(in srgb, var(--blue) 30%, var(--border-norse))',
            }}
          >
            <p className="text-[12px] font-bold mb-2 c-blue">🛒 Нужно докупить</p>
            {analysis.purchases_needed.map((p, i) => (
              <div key={i} className="flex items-center justify-between py-1">
                <p className="text-[13px] c-primary flex-1 truncate">{p.item} × {p.quantity}</p>
                <p className="text-[13px] font-semibold c-primary ml-2 shrink-0">{fmtMoney(p.total || (p.price * p.quantity))}</p>
              </div>
            ))}
          </div>
        )}

        {/* "Открыть просчёт" CTA */}
        {hasResult && result?.estimate_id && (
          <button
            onClick={() => { haptic.medium(); navigate(`/estimate-report/${result.estimate_id}`); }}
            className="w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 mb-3 spring-tap"
            style={{
              background: 'linear-gradient(135deg, #D4A843 0%, #B88B2E 100%)',
              color: '#fff',
              border: 'none',
              boxShadow: '0 6px 24px rgba(212,168,67,0.35), 0 0 50px rgba(212,168,67,0.18)',
            }}
          >
            <span className="text-[14px] font-bold tracking-wide">Открыть просчёт</span>
            <ArrowRight size={18} />
          </button>
        )}

        {/* Chat dialog (после результата) */}
        {hasResult && chatMessages.map((msg, i) => (
          <div key={i} className={`flex mb-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'mimir' && (
              <div
                className="shrink-0 flex items-center justify-center rounded-full mr-2 mt-1"
                style={{ width: 28, height: 28, background: 'var(--gold-gradient)' }}
              >
                <Sparkles size={14} color="#fff" />
              </div>
            )}
            <div
              className="rounded-2xl px-3.5 py-2.5"
              style={{
                maxWidth: '85%',
                background: msg.role === 'user'
                  ? 'linear-gradient(135deg, var(--bubble-own-start), var(--bubble-own-end))'
                  : 'var(--bg-surface-alt)',
                border: msg.role === 'user' ? 'none' : '0.5px solid color-mix(in srgb, var(--gold) 15%, var(--border-norse))',
              }}
            >
              {msg.role === 'mimir' && (
                <p className="text-[11px] font-semibold mb-1 c-gold">Мимир</p>
              )}
              <div
                className="text-[14px] leading-[1.45]"
                style={{ color: msg.role === 'user' ? '#fff' : 'var(--text-primary)' }}
              >
                {msg.role === 'user' ? msg.text : <MarkdownText text={msg.text} />}
              </div>
            </div>
          </div>
        ))}

        {/* Chat loading */}
        {chatLoading && (
          <div className="flex items-center gap-2 mb-2 mt-1">
            <div
              className="shrink-0 flex items-center justify-center rounded-full"
              style={{ width: 28, height: 28, background: 'var(--gold-gradient)' }}
            >
              <Loader2 size={14} className="animate-spin" color="#fff" />
            </div>
            <p className="text-[12px] c-tertiary">Мимир пересчитывает...</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            className="mt-3 rounded-2xl p-4"
            style={{
              background: 'color-mix(in srgb, var(--red-soft) 8%, var(--bg-surface-alt))',
              border: '0.5px solid color-mix(in srgb, var(--red-soft) 35%, var(--border-norse))',
            }}
          >
            <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--red-soft)' }}>Ошибка</p>
            <p className="text-[12px] c-secondary">{error}</p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Composer (показываем после результата) */}
      {hasResult ? (
        <div
          className="shrink-0 flex items-end gap-2 px-3 py-2"
          style={{
            borderTop: '0.5px solid var(--border-norse)',
            background: 'var(--bg-surface)',
            paddingBottom: 'calc(8px + var(--safe-bottom))',
          }}
        >
          <div
            className="flex-1 rounded-2xl overflow-hidden"
            style={{
              background: 'var(--bg-surface-alt)',
              border: '0.5px solid var(--border-norse)',
            }}
          >
            <textarea
              ref={composerRef}
              value={composerText}
              onChange={(e) => {
                setComposerText(e.target.value);
                if (composerRef.current) {
                  composerRef.current.style.height = 'auto';
                  composerRef.current.style.height = Math.min(composerRef.current.scrollHeight, 120) + 'px';
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendChatMessage();
                }
              }}
              placeholder="Спросите или попросите изменить..."
              rows={1}
              disabled={chatLoading}
              className="w-full px-3 py-2 resize-none outline-none text-[15px] leading-[1.35] c-primary"
              style={{
                background: 'transparent',
                caretColor: 'var(--gold)',
                maxHeight: 120,
              }}
            />
          </div>
          <button
            onClick={sendChatMessage}
            disabled={!composerText.trim() || chatLoading}
            className="shrink-0 flex items-center justify-center rounded-full spring-tap"
            style={{
              width: 36, height: 36,
              background: composerText.trim()
                ? 'var(--gold-gradient)'
                : 'var(--bg-elevated)',
              color: '#fff',
              opacity: chatLoading ? 0.5 : 1,
            }}
          >
            <Send size={18} className="ml-0.5" />
          </button>
        </div>
      ) : (
        <div
          className="shrink-0 flex items-center gap-2 px-3 py-3"
          style={{
            borderTop: '0.5px solid var(--border-norse)',
            background: 'var(--bg-surface)',
            paddingBottom: 'calc(12px + var(--safe-bottom))',
          }}
        >
          <button
            onClick={() => { haptic.light(); navigate(-1); }}
            className="flex-1 rounded-2xl px-4 py-3 text-[14px] font-semibold c-secondary"
            style={{
              background: 'var(--bg-surface-alt)',
              border: '0.5px solid var(--border-norse)',
            }}
          >
            Закрыть
          </button>
          <button
            onClick={() => { if (!running) startStream(); }}
            disabled={running}
            className="flex-1 rounded-2xl px-4 py-3 text-[14px] font-bold spring-tap"
            style={{
              background: running ? 'var(--bg-elevated)' : 'linear-gradient(135deg, #C8293B 0%, #1E4D8C 100%)',
              color: '#fff',
              border: 'none',
              opacity: running ? 0.6 : 1,
            }}
          >
            {running ? 'Считаю...' : 'Пересчитать'}
          </button>
        </div>
      )}

      <style>{`
        @keyframes stepIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-stepIn { animation: stepIn 0.32s ease both; }
        @keyframes resultIn {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animate-resultIn { animation: resultIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
      `}</style>
    </div>
  );
}

function MimirBubble({ children }) {
  return (
    <div className="flex mb-3 justify-start">
      <div
        className="flex items-center justify-center rounded-full shrink-0 mr-2 mt-1"
        style={{ width: 28, height: 28, background: 'var(--gold-gradient)' }}
      >
        <Sparkles size={14} color="#fff" />
      </div>
      <div
        className="rounded-2xl px-3.5 py-2.5"
        style={{
          maxWidth: '85%',
          background: 'var(--bg-surface-alt)',
          border: '0.5px solid color-mix(in srgb, var(--gold) 15%, var(--border-norse))',
        }}
      >
        <p className="text-[11px] font-semibold mb-1 c-gold">Мимир</p>
        <div className="c-primary">{children}</div>
      </div>
    </div>
  );
}

function ResultCard({ card }) {
  return (
    <div
      className="mb-3 rounded-2xl overflow-hidden animate-resultIn"
      style={{
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--gold) 10%, var(--bg-surface-alt)) 0%, var(--bg-surface-alt) 100%)',
        border: '0.5px solid color-mix(in srgb, var(--gold) 40%, var(--border-norse))',
        boxShadow: '0 6px 28px rgba(212,168,67,0.12)',
      }}
    >
      {/* Header strip */}
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{
          background: 'linear-gradient(90deg, rgba(212,168,67,0.18), rgba(212,168,67,0.04))',
          borderBottom: '0.5px solid color-mix(in srgb, var(--gold) 25%, var(--border-norse))',
        }}
      >
        <CheckCircle2 size={16} style={{ color: 'var(--gold)' }} />
        <p className="text-[12px] font-bold c-gold tracking-wide uppercase">Просчёт готов</p>
      </div>

      {/* Title */}
      <div className="px-4 pt-3">
        <p className="text-[15px] font-bold c-primary leading-snug">{card.title || '—'}</p>
        {card.customer && (
          <p className="text-[12px] c-tertiary mt-0.5">{card.customer}</p>
        )}
      </div>

      {/* Big numbers row */}
      <div className="px-4 pt-3 pb-1">
        <div className="grid grid-cols-2 gap-2">
          <BigMetric
            label="Себестоимость"
            value={fmtMln(card.total_cost)}
            color="var(--text-primary)"
          />
          <BigMetric
            label="Клиенту"
            value={fmtMln(card.total_with_margin)}
            color="var(--gold)"
            highlight
          />
        </div>
      </div>

      {/* Margin + markup */}
      <div className="px-4 pt-2 pb-3">
        <div className="grid grid-cols-3 gap-2">
          <SmallMetric label="Маржа" value={card.margin_pct ? `${card.margin_pct}%` : '—'} />
          <SmallMetric label="Наценка" value={card.markup_multiplier ? `×${card.markup_multiplier}` : '—'} />
          <SmallMetric label="С НДС" value={fmtMln(card.total_with_vat)} />
        </div>
      </div>

      {/* Details */}
      <div
        className="px-4 py-3"
        style={{
          background: 'color-mix(in srgb, #000 12%, transparent)',
          borderTop: '0.5px solid color-mix(in srgb, var(--gold) 15%, var(--border-norse))',
        }}
      >
        <DetailRow label="Бригада" value={card.crew_count ? `${card.crew_count} чел` : '—'} />
        <DetailRow label="Дней работы" value={card.work_days ? `${card.work_days} дн` : '—'} />
        <DetailRow label="Дороги" value={card.road_days ? `${card.road_days} дн` : '—'} />
        <DetailRow label="Город" value={card.city || '—'} />
      </div>

      {/* Cost breakdown */}
      <div
        className="px-4 py-3"
        style={{
          background: 'color-mix(in srgb, #000 18%, transparent)',
          borderTop: '0.5px solid color-mix(in srgb, var(--gold) 12%, var(--border-norse))',
        }}
      >
        <p className="text-[10px] uppercase tracking-wider font-semibold mb-2 c-tertiary">Структура себестоимости</p>
        <BreakdownRow label="ФОТ + налог" value={card.fot_subtotal} />
        <BreakdownRow label="Командировочные" value={card.travel_subtotal} />
        <BreakdownRow label="Транспорт" value={card.transport_subtotal} />
        <BreakdownRow label="Химия / материалы" value={card.chemistry_subtotal} />
        <BreakdownRow label="Текущие" value={card.current_subtotal} />
      </div>

      {card.drift_pct != null && card.drift_pct > 1 && (
        <div className="px-4 py-2 text-[10px] c-tertiary border-t" style={{ borderColor: 'var(--border-norse)' }}>
          ⓘ Сервер пересчитал — отклонение AI от формул: {card.drift_pct}%
        </div>
      )}
    </div>
  );
}

function BigMetric({ label, value, color, highlight }) {
  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{
        background: highlight
          ? 'color-mix(in srgb, var(--gold) 10%, transparent)'
          : 'color-mix(in srgb, #000 15%, transparent)',
        border: highlight
          ? '0.5px solid color-mix(in srgb, var(--gold) 35%, transparent)'
          : '0.5px solid var(--border-norse)',
      }}
    >
      <p className="text-[10px] uppercase tracking-wider c-tertiary mb-0.5">{label}</p>
      <p className="text-[18px] font-bold leading-none" style={{ color }}>{value}</p>
    </div>
  );
}

function SmallMetric({ label, value }) {
  return (
    <div
      className="rounded-lg px-2 py-1.5 text-center"
      style={{ background: 'color-mix(in srgb, #000 10%, transparent)' }}
    >
      <p className="text-[9px] uppercase tracking-wider c-tertiary">{label}</p>
      <p className="text-[13px] font-bold c-primary">{value}</p>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <p className="text-[12px] c-tertiary">{label}</p>
      <p className="text-[13px] font-semibold c-primary">{value}</p>
    </div>
  );
}

function BreakdownRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <p className="text-[12px] c-tertiary">{label}</p>
      <p className="text-[12px] font-semibold c-primary">{fmtMoney(value)}</p>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1">
      <p className="text-[12px] c-tertiary">{label}</p>
      <p className="text-[13px] font-semibold c-primary">{value}</p>
    </div>
  );
}

function WarningCard({ warning }) {
  const level = warning.level || 'warning';
  const Icon = level === 'critical' ? AlertOctagon : level === 'info' ? Info : AlertTriangle;
  const colors = {
    critical: { bg: 'rgba(200,41,59,0.10)', border: 'rgba(200,41,59,0.45)', icon: '#E67381', text: '#E67381' },
    warning:  { bg: 'rgba(212,168,67,0.10)', border: 'rgba(212,168,67,0.45)', icon: '#D4A843', text: '#D4A843' },
    info:     { bg: 'rgba(30,77,140,0.10)', border: 'rgba(30,77,140,0.45)', icon: '#4D90E0', text: '#4D90E0' },
  };
  const c = colors[level] || colors.warning;

  return (
    <div
      className="rounded-2xl p-3 mb-2 flex gap-2.5 animate-stepIn"
      style={{
        background: c.bg,
        border: '0.5px solid ' + c.border,
      }}
    >
      <Icon size={18} style={{ color: c.icon, flexShrink: 0, marginTop: 1 }} />
      <div className="flex-1 min-w-0">
        {warning.title && (
          <p className="text-[12px] font-bold mb-0.5" style={{ color: c.text }}>{warning.title}</p>
        )}
        <p className="text-[12px] leading-[1.4] c-primary">{warning.text || warning.message || ''}</p>
      </div>
    </div>
  );
}
