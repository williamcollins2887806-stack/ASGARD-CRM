import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { formatMoney, formatDate } from '@/lib/utils';
import {
  ArrowLeft, Camera, Paperclip, Send, QrCode, Check, X,
  TrendingDown, TrendingUp, Wallet, ChevronRight, Sparkles,
  FileText, Receipt, MessageSquare, Loader2,
} from 'lucide-react';

const CAT_ICONS = {
  payroll: '👷', cash: '💵', per_diem: '🍽', tickets: '✈',
  accommodation: '🏨', materials: '📦', subcontract: '🤝', other: '📋',
};
const CAT_LABELS = {
  payroll: 'ФОТ', cash: 'Наличные', per_diem: 'Суточные', tickets: 'Билеты',
  accommodation: 'Проживание', materials: 'Материалы', subcontract: 'Субподряд', other: 'Прочее',
};
const CAT_COLORS = {
  payroll: '#F85149', cash: '#f59e0b', per_diem: '#8b5cf6', tickets: '#D4A843',
  accommodation: '#a855f7', materials: '#3FB950', subcontract: '#ec4899', other: '#888',
};

export default function ExpenseChat() {
  const { workId } = useParams();
  const navigate = useNavigate();
  const haptic = useHaptic();
  const user = useAuthStore((s) => s.user);

  const [work, setWork] = useState(null);
  const [financials, setFinancials] = useState(null);
  const [history, setHistory] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recognizing, setRecognizing] = useState(false);
  const [textInput, setTextInput] = useState('');

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const qrInputRef = useRef(null);

  // Загрузка данных
  useEffect(() => {
    (async () => {
      try {
        const [histRes] = await Promise.all([
          api.get(`/mimir/expense-history?work_id=${workId}&limit=30`),
        ]);
        setHistory(histRes.expenses || []);
        setFinancials(histRes.financials || null);
        if (histRes.financials) {
          setWork({ id: workId, work_title: histRes.financials.work_title, work_number: histRes.financials.work_number });
        }
        // Приветственное сообщение
        setMessages([{
          id: 'welcome',
          type: 'mimir',
          text: 'Загрузите чек (QR или фото), файл (PDF/Excel) или напишите текстом — я распознаю и предложу внести в расходы.',
          time: new Date(),
        }]);
      } catch (err) {
        console.error('ExpenseChat load error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [workId]);

  // Скролл вниз при новом сообщении
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // === Обработка QR ===
  const handleQRScan = useCallback(async (qrData) => {
    haptic.medium();
    setRecognizing(true);
    addMessage('user', `📱 QR-код: ${qrData.substring(0, 60)}...`);

    try {
      const result = await api.post('/mimir/expense-recognize', {
        work_id: Number(workId), type: 'qr', data: qrData,
      });
      if (result.success) {
        addPreviewMessage(result.preview, result.financials);
        setFinancials(result.financials);
      } else {
        addMessage('mimir', `Не удалось распознать: ${result.error}`);
      }
    } catch (err) {
      addMessage('mimir', `Ошибка: ${err.message}`);
    } finally {
      setRecognizing(false);
    }
  }, [workId, haptic]);

  // === Обработка фото ===
  const handlePhoto = useCallback(async (file) => {
    haptic.medium();
    setRecognizing(true);
    addMessage('user', `📷 Фото: ${file.name}`);

    try {
      const base64 = await fileToBase64(file);
      const result = await api.post('/mimir/expense-recognize', {
        work_id: Number(workId), type: 'image', data: base64, mime_type: file.type,
      });
      if (result.success) {
        addPreviewMessage(result.preview, result.financials);
        setFinancials(result.financials);
      } else {
        addMessage('mimir', `Не удалось распознать: ${result.error}`);
      }
    } catch (err) {
      addMessage('mimir', `Ошибка: ${err.message}`);
    } finally {
      setRecognizing(false);
    }
  }, [workId, haptic]);

  // === Обработка текста ===
  const handleTextSend = useCallback(async () => {
    const text = textInput.trim();
    if (!text) return;
    haptic.light();
    setTextInput('');
    setRecognizing(true);
    addMessage('user', text);

    try {
      const result = await api.post('/mimir/expense-recognize', {
        work_id: Number(workId), type: 'text', data: text,
      });
      if (result.success) {
        addPreviewMessage(result.preview, result.financials);
        setFinancials(result.financials);
      } else {
        addMessage('mimir', `Не смог распознать: ${result.error}`);
      }
    } catch (err) {
      addMessage('mimir', `Ошибка: ${err.message}`);
    } finally {
      setRecognizing(false);
    }
  }, [workId, textInput, haptic]);

  // === Подтверждение расхода ===
  const handleConfirm = useCallback(async (preview) => {
    haptic.success();
    setRecognizing(true);

    try {
      const result = await api.post('/mimir/expense-confirm', {
        work_id: Number(workId),
        amount: preview.amount,
        date: preview.date,
        category: preview.category,
        supplier: preview.supplier,
        description: preview.description,
      });

      if (result.success) {
        setFinancials(result.after);
        // Убираем карточку-превью, добавляем подтверждение
        setMessages(prev => prev.filter(m => m.id !== `preview_${preview._previewId}`));
        addMessage('confirm', null, {
          amount: preview.amount,
          category: preview.category,
          before: result.before,
          after: result.after,
          delta: result.delta,
        });
        // Обновляем историю
        setHistory(prev => [result.expense, ...prev]);
      } else {
        addMessage('mimir', `Ошибка при внесении: ${result.error || 'неизвестная'}`);
      }
    } catch (err) {
      addMessage('mimir', `Ошибка: ${err.message}`);
    } finally {
      setRecognizing(false);
    }
  }, [workId, haptic]);

  // === Helpers ===
  function addMessage(type, text, data) {
    setMessages(prev => [...prev, {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type, text, data, time: new Date(),
    }]);
  }

  function addPreviewMessage(preview, financials) {
    const previewId = Date.now();
    preview._previewId = previewId;
    setMessages(prev => [...prev, {
      id: `preview_${previewId}`,
      type: 'preview', data: { preview, financials }, time: new Date(),
    }]);
  }

  // === Рендер ===
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--gold)' }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 shrink-0"
        style={{
          padding: 'calc(var(--safe-top) + 8px) 16px 10px',
          background: 'var(--bg-secondary)',
          borderBottom: '0.5px solid var(--border)',
        }}
      >
        <button onClick={() => navigate(-1)} className="spring-tap">
          <ArrowLeft size={22} style={{ color: 'var(--gold)' }} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {work?.work_title || `Работа #${workId}`}
          </div>
          {financials && (
            <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Расходы: {formatMoney(financials.cost_fact)} / Контракт: {formatMoney(financials.contract_value)}
            </div>
          )}
        </div>
        <Wallet size={20} style={{ color: 'var(--gold)' }} />
      </div>

      {/* Financial summary bar */}
      {financials && (
        <div
          className="flex items-center justify-between shrink-0"
          style={{
            padding: '8px 16px',
            background: 'linear-gradient(135deg, rgba(212,168,67,0.08) 0%, rgba(212,168,67,0.02) 100%)',
            borderBottom: '0.5px solid var(--border)',
          }}
        >
          <MetricPill label="Себестоимость" value={formatMoney(financials.cost_fact, { short: true })} color="var(--text-primary)" />
          <MetricPill label="Маржа" value={`${financials.margin_pct}%`} color={financials.margin_pct >= 20 ? 'var(--green)' : 'var(--gold)'} />
          <MetricPill label="Прибыль" value={formatMoney(financials.profit, { short: true })} color={financials.profit >= 0 ? 'var(--green)' : 'var(--red-soft)'} />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '12px 12px 8px' }}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} onConfirm={handleConfirm} onReject={(id) => {
            setMessages(prev => prev.filter(m => m.id !== id));
            addMessage('mimir', 'Отменено. Загрузите другой чек или опишите расход.');
          }} />
        ))}
        {recognizing && (
          <div className="flex items-center gap-2 px-3 py-2" style={{ animation: 'fadeIn 200ms ease-out' }}>
            <div className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-gold animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-gold animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 rounded-full bg-gold animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-xs" style={{ color: 'var(--gold)' }}>Мимир распознаёт...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div
        className="shrink-0 flex items-end gap-2"
        style={{
          padding: '8px 12px calc(var(--safe-bottom) + 8px)',
          background: 'var(--bg-secondary)',
          borderTop: '0.5px solid var(--border)',
        }}
      >
        {/* QR button */}
        <button
          className="spring-tap shrink-0 flex items-center justify-center"
          style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(212,168,67,0.1)' }}
          onClick={() => {
            // Простой prompt для QR данных (в будущем — камера + jsQR)
            const qr = prompt('Вставьте содержимое QR-кода чека:');
            if (qr) handleQRScan(qr);
          }}
        >
          <QrCode size={20} style={{ color: 'var(--gold)' }} />
        </button>

        {/* Camera */}
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhoto(f); e.target.value = ''; }} />
        <button
          className="spring-tap shrink-0 flex items-center justify-center"
          style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(212,168,67,0.1)' }}
          onClick={() => cameraInputRef.current?.click()}
        >
          <Camera size={20} style={{ color: 'var(--gold)' }} />
        </button>

        {/* File */}
        <input ref={fileInputRef} type="file" accept="image/*,.pdf,.xlsx,.xls,.doc,.docx" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhoto(f); e.target.value = ''; }} />
        <button
          className="spring-tap shrink-0 flex items-center justify-center"
          style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(212,168,67,0.1)' }}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip size={20} style={{ color: 'var(--gold)' }} />
        </button>

        {/* Text input */}
        <div className="flex-1 flex items-end" style={{
          background: 'var(--bg-primary)', borderRadius: 16, border: '0.5px solid var(--border)',
          padding: '6px 12px', minHeight: 40,
        }}>
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTextSend(); } }}
            placeholder="Опишите расход..."
            rows={1}
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none', resize: 'none',
              fontSize: 14, color: 'var(--text-primary)', lineHeight: '20px', maxHeight: 80,
            }}
          />
        </div>

        {/* Send */}
        <button
          className="spring-tap shrink-0 flex items-center justify-center"
          style={{
            width: 40, height: 40, borderRadius: 12,
            background: textInput.trim() ? 'linear-gradient(135deg, #D4A843, #B88B2E)' : 'rgba(255,255,255,0.06)',
            transition: 'background 200ms',
          }}
          onClick={handleTextSend}
          disabled={!textInput.trim()}
        >
          <Send size={18} style={{ color: textInput.trim() ? '#fff' : 'var(--text-tertiary)' }} />
        </button>
      </div>
    </div>
  );
}

// === Sub-components ===

function MetricPill({ label, value, color }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span className="text-[13px] font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

function MessageBubble({ msg, onConfirm, onReject }) {
  if (msg.type === 'user') {
    return (
      <div className="flex justify-end mb-2">
        <div style={{
          maxWidth: '80%', padding: '8px 12px', borderRadius: '16px 16px 4px 16px',
          background: 'rgba(212,168,67,0.15)', color: 'var(--text-primary)', fontSize: 14,
        }}>
          {msg.text}
        </div>
      </div>
    );
  }

  if (msg.type === 'mimir') {
    return (
      <div className="flex justify-start mb-2" style={{ animation: 'slideUp 200ms ease-out' }}>
        <div className="flex items-start gap-2" style={{ maxWidth: '85%' }}>
          <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #D4A843, #B88B2E)', fontSize: 14 }}>
            M
          </div>
          <div style={{
            padding: '8px 12px', borderRadius: '4px 16px 16px 16px',
            background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14,
            border: '0.5px solid var(--border)',
          }}>
            {msg.text}
          </div>
        </div>
      </div>
    );
  }

  if (msg.type === 'preview') {
    const { preview } = msg.data;
    const cat = preview.category || 'other';
    return (
      <div className="mb-3" style={{ animation: 'scaleIn 300ms var(--ease-spring)' }}>
        <div style={{
          borderRadius: 16, overflow: 'hidden',
          border: '0.5px solid rgba(212,168,67,0.3)',
          background: 'var(--bg-secondary)',
        }}>
          {/* Header */}
          <div className="flex items-center gap-2" style={{
            padding: '10px 14px',
            background: 'linear-gradient(135deg, rgba(212,168,67,0.1), rgba(212,168,67,0.03))',
            borderBottom: '0.5px solid var(--border)',
          }}>
            <Sparkles size={16} style={{ color: 'var(--gold)' }} />
            <span className="text-xs font-semibold" style={{ color: 'var(--gold)' }}>Мимир распознал</span>
            {preview.source === 'fns' && (
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(63,185,80,0.15)', color: 'var(--green)' }}>
                ФНС
              </span>
            )}
            {preview.confidence >= 0.9 && preview.source !== 'fns' && (
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(212,168,67,0.15)', color: 'var(--gold)' }}>
                {Math.round(preview.confidence * 100)}%
              </span>
            )}
          </div>

          {/* Body */}
          <div style={{ padding: '12px 14px' }}>
            {/* Amount + Category */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 20 }}>{CAT_ICONS[cat]}</span>
                <span className="text-xs font-medium" style={{ color: CAT_COLORS[cat] }}>{CAT_LABELS[cat]}</span>
              </div>
              <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {formatMoney(preview.amount)}
              </span>
            </div>

            {/* Details */}
            {preview.supplier && (
              <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                {preview.supplier}{preview.inn ? ` (ИНН: ${preview.inn})` : ''}
              </div>
            )}
            {preview.description && (
              <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
                {preview.description}
              </div>
            )}
            <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
              {preview.date}
              {preview.items && preview.items.length > 0 && ` / ${preview.items.length} позиций`}
            </div>
          </div>

          {/* Actions */}
          <div className="flex" style={{ borderTop: '0.5px solid var(--border)' }}>
            <button
              className="flex-1 flex items-center justify-center gap-2 spring-tap"
              style={{ padding: '12px', color: 'var(--red-soft)', fontSize: 14, fontWeight: 600 }}
              onClick={() => onReject(msg.id)}
            >
              <X size={16} /> Отмена
            </button>
            <div style={{ width: 0.5, background: 'var(--border)' }} />
            <button
              className="flex-1 flex items-center justify-center gap-2 spring-tap"
              style={{
                padding: '12px', fontSize: 14, fontWeight: 700,
                background: 'linear-gradient(135deg, rgba(63,185,80,0.1), rgba(63,185,80,0.03))',
                color: 'var(--green)',
              }}
              onClick={() => onConfirm(preview)}
            >
              <Check size={16} /> Внести
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (msg.type === 'confirm') {
    const d = msg.data;
    return (
      <div className="mb-3" style={{ animation: 'goldenFlash 600ms ease-out' }}>
        <div style={{
          borderRadius: 16, padding: '14px',
          background: 'linear-gradient(135deg, rgba(63,185,80,0.08), rgba(63,185,80,0.02))',
          border: '0.5px solid rgba(63,185,80,0.2)',
        }}>
          <div className="flex items-center gap-2 mb-3">
            <Check size={18} style={{ color: 'var(--green)' }} />
            <span className="text-sm font-bold" style={{ color: 'var(--green)' }}>
              Внесено: {formatMoney(d.amount)}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <div>
              <div style={{ color: 'var(--text-tertiary)' }}>Себестоимость</div>
              <div style={{ color: 'var(--text-primary)' }}>
                {formatMoney(d.before.cost_fact)} → <b>{formatMoney(d.after.cost_fact)}</b>
              </div>
            </div>
            <div className="text-right">
              <div style={{ color: 'var(--text-tertiary)' }}>Маржа</div>
              <div style={{ color: d.delta.margin_pct < 0 ? 'var(--red-soft)' : 'var(--green)' }}>
                {d.before.margin_pct}% → <b>{d.after.margin_pct}%</b>
                <span className="ml-1">({d.delta.margin_pct > 0 ? '+' : ''}{d.delta.margin_pct}%)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// Helper: File → base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // Remove data URL prefix: "data:image/jpeg;base64,"
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
