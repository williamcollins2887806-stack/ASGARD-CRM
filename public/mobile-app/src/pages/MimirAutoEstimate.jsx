import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Sparkles, CheckCircle2, FileText, Briefcase, Package, Users, Calculator, Loader2 } from 'lucide-react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';

/**
 * MimirAutoEstimate (AP1)
 *
 * Fullscreen чат с Мимиром для авто-просчёта работы.
 * - Запускает POST /api/mimir/auto-estimate {work_id} как fetch streaming
 * - Парсит SSE chunks и показывает прогресс шагов с иконками
 * - В AP1 — без AI и диалога, только показывает что собрано
 * - В AP2 — добавится поле ввода + диалог + создание просчёта
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
};

const STEP_ORDER = ['documents', 'analogs', 'customer_history', 'warehouse', 'workers', 'tariffs'];

export default function MimirAutoEstimate() {
  const { workId } = useParams();
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [steps, setSteps] = useState([]);              // [{ key, message, status, ts }]
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [aiPending, setAiPending] = useState(false);
  const bottomRef = useRef(null);
  const abortRef = useRef(null);

  // Авто-скролл вниз при новых событиях
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps.length, result, error]);

  const start = useCallback(async () => {
    setSteps([]);
    setResult(null);
    setError(null);
    setRunning(true);
    setAiPending(false);
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

        // Парсим SSE chunks: каждый event разделён \n\n, начинается с "data: "
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

  function handleEvent(event) {
    if (event.type === 'start') {
      setSteps((prev) => [...prev, { key: 'start', message: event.message || '🚀 Начинаю...', status: 'done', ts: Date.now() }]);
      return;
    }
    if (event.type === 'progress') {
      setSteps((prev) => [...prev, { key: event.step, message: event.message, status: 'done', ts: Date.now() }]);
      return;
    }
    if (event.type === 'ai_pending') {
      setAiPending(true);
      setSteps((prev) => [...prev, { key: 'ai_pending', message: event.message, status: 'pending', ts: Date.now() }]);
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
    if (event.type === 'done') {
      setRunning(false);
      return;
    }
  }

  // Авто-старт при заходе на страницу
  useEffect(() => {
    start();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

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
        {/* Greeting bubble */}
        <MimirBubble>
          <p className="text-[14px] leading-[1.45]">
            Сейчас соберу всё что нужно для просчёта: документы тендера, аналогичные работы, историю
            заказчика, остатки склада, свободных рабочих и тарифы. Это займёт несколько секунд.
          </p>
        </MimirBubble>

        {/* Progress steps */}
        {steps.map((s, i) => {
          const Icon = STEP_ICONS[s.key] || Sparkles;
          return (
            <div key={i} className="flex items-start gap-2 mb-2 animate-stepIn" style={{ animationDelay: `${i * 30}ms` }}>
              <div
                className="shrink-0 flex items-center justify-center rounded-full mt-0.5"
                style={{
                  width: 28, height: 28,
                  background: s.status === 'pending' ? 'var(--bg-elevated)' : 'color-mix(in srgb, var(--gold) 14%, var(--bg-surface-alt))',
                  border: '0.5px solid color-mix(in srgb, var(--gold) 30%, var(--border-norse))',
                }}
              >
                {s.status === 'pending'
                  ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--gold)' }} />
                  : <Icon size={14} style={{ color: 'var(--gold)' }} />}
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <p className="text-[13px] c-primary">{s.message}</p>
              </div>
            </div>
          );
        })}

        {/* Result summary card */}
        {result && (
          <div
            className="mt-3 rounded-2xl p-4"
            style={{
              background: 'color-mix(in srgb, var(--gold) 6%, var(--bg-surface-alt))',
              border: '0.5px solid color-mix(in srgb, var(--gold) 35%, var(--border-norse))',
              boxShadow: '0 4px 24px rgba(212,168,67,0.08)',
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={18} style={{ color: 'var(--gold)' }} />
              <p className="text-[14px] font-bold c-gold">Контекст собран</p>
            </div>
            <SummaryRow label="Документы прочитано" value={`${result.summary?.documents_parsed || 0} / ${result.summary?.documents_count || 0}`} />
            <SummaryRow label="Аналогов найдено" value={result.summary?.analogs_count || 0} />
            <SummaryRow label="История заказчика" value={`${result.summary?.customer_history_count || 0} тендеров`} />
            <SummaryRow label="Склад" value={`${result.summary?.warehouse_items || 0} позиций`} />
            <SummaryRow label="Свободных рабочих" value={result.summary?.available_workers || 0} />
            <SummaryRow label="Тариф. категорий" value={result.summary?.tariff_categories || 0} />
            <SummaryRow label="Время сбора" value={`${result.summary?.elapsed_ms || 0} мс`} />
          </div>
        )}

        {/* AP1 заглушка */}
        {aiPending && result && (
          <MimirBubble>
            <p className="text-[14px] leading-[1.45]">
              <strong>AP1 завершён.</strong> Все данные собраны. На следующем этапе (AP2) я отправлю
              этот контекст в Claude Sonnet 4.6 и вернусь с готовым просчётом, аналитикой
              и предупреждениями.
            </p>
          </MimirBubble>
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

      {/* Footer */}
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
          onClick={() => { if (!running) start(); }}
          disabled={running}
          className="flex-1 rounded-2xl px-4 py-3 text-[14px] font-bold spring-tap"
          style={{
            background: running
              ? 'var(--bg-elevated)'
              : 'linear-gradient(135deg, #C8293B 0%, #1E4D8C 100%)',
            color: '#fff',
            border: 'none',
            opacity: running ? 0.6 : 1,
          }}
        >
          {running ? 'Считаю...' : 'Пересчитать'}
        </button>
      </div>

      <style>{`
        @keyframes stepIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-stepIn {
          animation: stepIn 0.32s ease both;
        }
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

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1">
      <p className="text-[12px] c-tertiary">{label}</p>
      <p className="text-[13px] font-semibold c-primary">{value}</p>
    </div>
  );
}
