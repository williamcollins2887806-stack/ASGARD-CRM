/**
 * MimirChat.jsx — правая панель композера: чат с Мимиром + 3 модели + 2 режима.
 *
 * Режимы:
 *   - 💬 Обсудить (mode='discuss')  — markdown-ответ в чат, БЕЗ правок документа.
 *   - ✏️ Редактировать (mode='edit') — JSON {ops,summary,confidence} → applyOps
 *     к TipTap doc через editorRef. Применяется СРАЗУ; в чат — summary + confidence.
 *
 * Модели (3) — селектор AI_MODELS. Дефолт deepseek/deepseek-v4-pro (RouterAI).
 *
 * Вызовы — строго ПО ОДНОМУ. Кнопка отправки блокируется на время запроса.
 */
import { useState, useRef, useEffect } from 'react';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { mimirLetterEdit, AI_MODELS } from './api';
import { applyOps } from './applyOps';

export function MimirChat({
  correspondenceId,
  conversationId,
  setConversationId,
  model,                // RouterAI model id
  onModelChange,        // (id) => void
  editorRef,            // ref на TipTap Editor (для applyOps)
  getCurrentDoc,        // () => TipTap JSON doc (вызывается в момент send)
  onAfterEdit,          // () => void  — родитель сохранит черновик
  disabled              // finalized/sent → нельзя
}) {
  const [messages, setMessages] = useState([
    {
      role: 'mimir',
      kind: 'intro',
      text: '🧙 Я помогу с составлением и правками письма.\n\n' +
            '• 💬 Обсудить — задай вопрос (стилистика, формулировка, цитата из договора).\n' +
            '• ✏️ Редактировать — я применю правку прямо в текст письма.'
    }
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  const send = async (mode) => {
    const text = input.trim();
    if (!text || busy) return;
    if (!correspondenceId) {
      toast?.warn?.('Сохранить черновик', 'Сначала сохрани письмо как черновик, потом зови Мимира') ||
      toast?.('Сохранить черновик', 'Сначала сохрани письмо как черновик', 'warn');
      return;
    }
    const userMsg = { role: 'user', kind: 'text', mode, text };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setBusy(true);
    try {
      const reply = await mimirLetterEdit({
        correspondence_id: correspondenceId,
        conversation_id: conversationId || null,
        current_doc: getCurrentDoc?.() || null,
        instruction: text,
        mode,
        model
      });

      if (reply?.conversation_id && reply.conversation_id !== conversationId) {
        setConversationId?.(reply.conversation_id);
      }

      if (mode === 'discuss') {
        // Markdown-ответ
        const md = reply?.text || reply?.message || reply?.answer || '(пустой ответ)';
        setMessages((m) => [...m, {
          role: 'mimir', kind: 'text', text: md,
          model, ctx: reply?.context_stats
        }]);
      } else {
        // edit-режим → применяем ops
        const ops = Array.isArray(reply?.ops) ? reply.ops : [];
        const summary = reply?.summary || '';
        const conf = typeof reply?.confidence === 'number' ? reply.confidence : null;

        if (ops.length === 0) {
          setMessages((m) => [...m, {
            role: 'mimir', kind: 'warn',
            text: '⚠️ AI вернул пустой ops. Попробуй переформулировать.',
            raw: reply?.raw || '',
            model, ctx: reply?.context_stats
          }]);
        } else {
          const result = applyOps(editorRef?.current, ops);
          setMessages((m) => [...m, {
            role: 'mimir', kind: 'edit_ops',
            text: summary || `Применено правок: ${result.applied} из ${ops.length}`,
            confidence: conf,
            ops_applied: result.applied,
            ops_rejected: result.rejected,
            ops_log: result.log,
            model, ctx: reply?.context_stats
          }]);
          if (result.applied > 0) onAfterEdit?.();
          if (result.rejected.length) {
            toast?.warn?.('Часть правок отброшена', `${result.rejected.length} из ${ops.length}`) ||
            toast?.('Правки', `Отброшено: ${result.rejected.length}`, 'warn');
          }
        }
      }
    } catch (e) {
      const msg = String(e?.message || e);
      setMessages((m) => [...m, { role: 'mimir', kind: 'error', text: '❌ ' + msg }]);
      toast?.error?.(msg) || toast?.('Ошибка Мимира', msg, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--inner-bg, var(--bg2))',
        border: '1px solid var(--brd-2, var(--brd))',
        borderRadius: 'var(--r-sm)',
        overflow: 'hidden'
      }}
    >
      {/* Шапка панели */}
      <div style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--brd-2, var(--brd))',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'var(--bg3, var(--bg2))'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8
        }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--t-1)' }}>
            🧙 Мимир — помощник по письму
          </div>
        </div>

        {/* Селектор модели */}
        <div className="u-flex" style={{ gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--t-3)', whiteSpace: 'nowrap' }}>Модель:</span>
          <select
            className="m-select"
            value={model}
            onChange={(e) => onModelChange?.(e.target.value)}
            disabled={busy || disabled}
            style={{ flex: 1, fontSize: 12, padding: '4px 6px' }}
          >
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.hint}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* История чата */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        {messages.map((m, i) => (
          <MsgBubble key={i} msg={m} />
        ))}
        {busy && (
          <div style={{ color: 'var(--t-3)', fontStyle: 'italic', fontSize: 12 }}>
            ⏳ Мимир думает… (модель {model})
          </div>
        )}
      </div>

      {/* Ввод + 2 режима */}
      <div style={{
        padding: 10,
        borderTop: '1px solid var(--brd-2, var(--brd))',
        background: 'var(--bg3, var(--bg2))',
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }}>
        <textarea
          className="m-textarea"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled
            ? 'Письмо финализировано — правки невозможны. Создай новую редакцию.'
            : 'Опиши правку или вопрос… (Ctrl+Enter → редактировать)'
          }
          disabled={busy || disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send('edit');
            }
          }}
          style={{ fontSize: 12.5, resize: 'vertical' }}
        />
        <div className="u-flex" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <Btn
            size="sm"
            variant="ghost"
            disabled={busy || !input.trim() || disabled}
            onClick={() => send('discuss')}
            title="Обсудить — Мимир ответит в чат, документ не тронет"
          >💬 Обсудить</Btn>
          <Btn
            size="sm"
            variant="primary"
            disabled={busy || !input.trim() || disabled}
            onClick={() => send('edit')}
            title="Редактировать — Мимир применит правку к тексту (Ctrl+Enter)"
          >✏️ Редактировать</Btn>
        </div>
      </div>
    </div>
  );
}

function MsgBubble({ msg }) {
  const isUser = msg.role === 'user';
  const tone =
    msg.kind === 'error'    ? 'err'  :
    msg.kind === 'warn'     ? 'warn' :
    msg.kind === 'edit_ops' ? 'ok'   :
    msg.kind === 'intro'    ? 'info' : 'default';

  const bg =
    isUser              ? 'var(--gold-bg)' :
    tone === 'err'      ? 'var(--err-bg)'  :
    tone === 'warn'     ? 'var(--warn-bg)' :
    tone === 'ok'       ? 'var(--ok-bg)'   :
    tone === 'info'     ? 'var(--info-bg)' : 'var(--card-bg, var(--bg3))';

  const border =
    isUser              ? '1px solid var(--gold)' :
    tone === 'err'      ? '1px solid var(--err, var(--err-t))'  :
    tone === 'warn'     ? '1px solid var(--warn, var(--gold))' :
    tone === 'ok'       ? '1px solid var(--ok)'   :
    tone === 'info'     ? '1px solid var(--info, var(--info-t))' : '1px solid var(--brd-2, var(--brd))';

  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '92%',
        padding: 8,
        background: bg,
        border,
        borderRadius: 'var(--r-sm)',
        fontSize: 12.5,
        color: 'var(--t-1)'
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--t-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {isUser
          ? `Ты · ${msg.mode === 'edit' ? '✏️ ред.' : '💬 обсуж.'}`
          : '🧙 Мимир' + (msg.model ? ` · ${msg.model}` : '')
        }
        {msg.confidence != null ? ` · conf ${Math.round(msg.confidence * 100)}%` : ''}
      </div>
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
        {msg.text}
      </div>
      {msg.kind === 'edit_ops' && (msg.ops_log?.length || msg.ops_rejected?.length) ? (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--t-3)' }}>
            Детали ({msg.ops_applied || 0} применено
            {msg.ops_rejected?.length ? `, ${msg.ops_rejected.length} отброшено` : ''})
          </summary>
          <div style={{ fontSize: 11, marginTop: 4 }}>
            {msg.ops_log?.map((l, i) => <div key={'l' + i}>{l}</div>)}
            {msg.ops_rejected?.map((r, i) => (
              <div key={'r' + i} style={{ color: 'var(--err-t, var(--err))' }}>
                ✗ {r.op || 'op'}: {r.reason}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {msg.ctx ? (
        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--t-3)' }}>
          контекст: {msg.ctx.est_tokens ? `~${Math.round(msg.ctx.est_tokens / 1000)}K ток.` : '—'}
          {msg.ctx.layers_included?.length ? ` · слоёв: ${msg.ctx.layers_included.length}` : ''}
        </div>
      ) : null}
    </div>
  );
}
