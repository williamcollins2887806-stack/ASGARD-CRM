import { useState, useEffect, useRef } from 'react';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import { mimirChat } from '../api';

export default function MimirChat({ estimate, onUpdated }) {
  const [messages, setMessages] = useState([
    { role: 'mimir', text: '🧙 Привет! Я Мимир. Спроси меня про этот расчёт — оборудование, нормы, аналоги, риски, или попроси пересчитать с новыми вводными.' }
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [chatModels, setChatModels] = useState([]);
  const [model, setModel] = useState(() => { try { return localStorage.getItem('asgard_mimirchat_model') || ''; } catch (e) { return ''; } });

  useEffect(() => {
    if (chatModels.length > 0) return;
    api('/api/mimir/chat/models')
      .then((d) => {
        const list = d?.models || [];
        setChatModels(list);
        if (!model && (d?.default || list[0])) setModel(d.default || list[0].id);
      })
      .catch(() => {});
  }, [chatModels.length, model]);

  const onModelChange = (id) => {
    setModel(id);
    try { localStorage.setItem('asgard_mimirchat_model', id); } catch (e) {}
  };
  // v2 BONUS: автоскролл к новому сообщению (vanilla — пользователь сам скроллил)
  const logRef = useRef(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages.length, busy]);

  // v2 BONUS: очистка чата (vanilla — только перезагрузка страницы)
  const clearChat = () => {
    setMessages([{ role: 'mimir', text: '🧙 Привет! Я Мимир. Спроси меня про этот расчёт.' }]);
  };

  const send = async () => {
    if (!input.trim()) return;
    const userText = input.trim();
    setMessages((m) => [...m, { role: 'user', text: userText }]);
    setInput('');
    setBusy(true);
    try {
      const res = await mimirChat({
        estimate_id: estimate.id,
        tender_id: estimate.tender_id,
        work_id: estimate.work_id,
        message: userText,
        model: model || undefined,
      });
      const reply = res?.message || res?.reply || res?.response || '…';
      setMessages((m) => [...m, { role: 'mimir', text: reply }]);
      if (res?.calculation_updated) onUpdated?.();
    } catch (e) {
      const msg = String(e?.message || e);
      // 4xx/5xx от RouterAI или «Insufficient balance» — подсказываем переключить модель
      const looksLikeModelProblem = /balance|HTTP 4\d\d|HTTP 5\d\d|Insufficient|недоступ/i.test(msg);
      toast('Ошибка', msg, 'err');
      setMessages((m) => [...m, {
        role: 'mimir',
        text: '⚠ Ошибка модели «' + (model || '?') + '»: ' + msg.slice(0, 200)
          + (looksLikeModelProblem ? '\n\n👆 Выбери другую модель в селекторе сверху.' : '')
      }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card er-mimir-card-grad" data-mimir-chat="1">
      <strong className="er-mimir-eyebrow row-spread">
        <span>🧙 Чат с Мимиром</span>
        {messages.length > 1 && (
          <button
            type="button"
            onClick={clearChat}
            style={{ background: 'transparent', border: 'none', color: 'var(--t-3)', cursor: 'pointer', fontSize: 11 }}
            title="Очистить чат"
          >🗑 Очистить</button>
        )}
      </strong>

      <div className="er-mimir-log" ref={logRef}>
        {messages.map((m, i) => (
          <div
            key={i}
            className={'er-mimir-bubble ' + (m.role === 'user' ? 'er-mimir-bubble--user' : 'er-mimir-bubble--mimir')}
          >
            <div className="er-mimir-bubble-author">{m.role === 'user' ? 'Ты' : '🧙 Мимир'}</div>
            <div className="er-mimir-bubble-text">{m.text}</div>
          </div>
        ))}
        {busy && <div className="er-mimir-thinking">⏳ Мимир думает…</div>}
      </div>

      {/* Селектор модели Мимира — над input'ом */}
      {chatModels.length > 0 && (() => {
        const m = chatModels.find((x) => x.id === model);
        const knows = !!m?.capabilities?.knows_crm_data;
        return (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', marginTop: 10,
            background: knows ? 'rgba(46,160,67,0.10)' : 'rgba(212,168,67,0.10)',
            border: '1px solid ' + (knows ? 'rgba(46,160,67,0.30)' : 'rgba(212,168,67,0.35)'),
            borderRadius: 8, fontSize: 12,
          }}>
            <span style={{ color: 'var(--t-3, #888)', whiteSpace: 'nowrap' }}>
              {knows ? '🧠' : '⚡'} Модель:
            </span>
            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={busy}
              title={m?.description || ''}
              style={{
                flex: 1,
                background: 'var(--bg-soft, rgba(0,0,0,0.05))',
                color: 'var(--t-1)',
                border: '1px solid var(--bd, rgba(0,0,0,0.15))',
                borderRadius: 6,
                padding: '4px 8px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {chatModels.map((x) => (
                <option key={x.id} value={x.id} title={x.description}>
                  {x.label}{x.short_hint ? '  ·  ' + x.short_hint : ''}
                </option>
              ))}
            </select>
            {!knows && (
              <span style={{ fontSize: 10.5, color: 'var(--t-3, #888)' }}>
                (light не пересчитает смету)
              </span>
            )}
          </div>
        );
      })()}

      <div className="row gap-6 mt-10">
        <input
          className="m-input flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) send(); }}
          placeholder="Спроси Мимира…"
        />
        <Btn variant="primary" disabled={busy || !input.trim()} onClick={send}>→</Btn>
      </div>
    </div>
  );
}
