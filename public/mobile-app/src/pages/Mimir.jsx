import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Zap, Send } from 'lucide-react';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { MimirWelcome } from '@/components/chat/MimirWelcome';

/**
 * Mimir — AI-ассистент
 */
export default function Mimir() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const userId = useAuthStore((s) => s.user?.id);
  const navigate = useNavigate();
  const haptic = useHaptic();
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const sendMessage = useCallback(
    async (msgText) => {
      const t = msgText || text.trim();
      if (!t) return;
      haptic.light();

      const userMsg = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: t,
        ts: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setText('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      setLoading(true);

      try {
        const res = await api.post('/mimir/chat', {
          message: t,
          conversation_id: conversationId || undefined,
        });
        if (res.conversation_id) setConversationId(res.conversation_id);

        const mimirMsg = {
          id: `mimir-${Date.now()}`,
          role: 'assistant',
          text: res.response || res.message || 'Нет ответа',
          ts: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, mimirMsg]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'assistant',
            text: 'Ошибка. Попробуйте позже.',
            ts: new Date().toISOString(),
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [text, conversationId, haptic]
  );

  const handleInput = (e) => {
    setText(e.target.value);
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div
      className="flex flex-col h-full bg-primary"
    >
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
          onClick={() => {
            haptic.light();
            navigate('/chat');
          }}
          className="flex items-center justify-center spring-tap btn-icon c-blue"
        >
          <ChevronLeft size={28} />
        </button>
        <div
          className="flex items-center justify-center rounded-full shrink-0"
          style={{
            width: 36,
            height: 36,
            background: 'var(--gold-gradient)',
          }}
        >
          <Zap size={18} color="#fff" />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="text-[15px] font-semibold c-gold"
          >
            Мимир
          </p>
          <p className="text-[11px] c-tertiary">
            AI-ассистент ASGARD
          </p>
        </div>
      </header>

      {/* Messages or Welcome */}
      {messages.length === 0 ? (
        <MimirWelcome onSuggest={sendMessage} />
      ) : (
        <div className="flex-1 overflow-y-auto scroll-container px-3 py-3">
          {messages.map((msg) => {
            const isMine = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-2`}
              >
                {!isMine && (
                  <div
                    className="flex items-center justify-center rounded-full shrink-0 mr-2 mt-1"
                    style={{
                      width: 28,
                      height: 28,
                      background: 'var(--gold-gradient)',
                    }}
                  >
                    <Zap size={14} color="#fff" />
                  </div>
                )}
                <div
                  className="rounded-2xl px-3.5 py-2.5"
                  style={{
                    maxWidth: '80%',
                    background: isMine
                      ? 'linear-gradient(135deg, var(--bubble-own-start), var(--bubble-own-end))'
                      : 'var(--bg-surface-alt)',
                    border: isMine
                      ? 'none'
                      : '0.5px solid color-mix(in srgb, var(--gold) 15%, var(--border-norse))',
                  }}
                >
                  {!isMine && (
                    <p
                      className="text-[11px] font-semibold mb-1 c-gold"
                    >
                      Мимир
                    </p>
                  )}
                  <p
                    className={`text-[15px] leading-[1.4] whitespace-pre-wrap ${isMine ? '' : 'c-primary'}`}
                    style={isMine ? { color: '#fff' } : undefined}
                  >
                    {msg.text}
                  </p>
                  <p
                    className={`text-[10px] text-right mt-1 ${isMine ? '' : 'c-tertiary'}`}
                    style={isMine ? { color: 'rgba(255,255,255,0.5)' } : undefined}
                  >
                    {new Date(msg.ts).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            );
          })}

          {/* Typing indicator */}
          {loading && (
            <div className="flex items-center gap-2 mb-2">
              <div
                className="flex items-center justify-center rounded-full shrink-0"
                style={{
                  width: 28,
                  height: 28,
                  background: 'var(--gold-gradient)',
                }}
              >
                <Zap size={14} color="#fff" />
              </div>
              <div
                className="flex items-center gap-1 px-3.5 py-3 rounded-2xl"
                style={{
                  background: 'var(--bg-surface-alt)',
                  border: '0.5px solid color-mix(in srgb, var(--gold) 15%, var(--border-norse))',
                }}
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="inline-block rounded-full"
                    style={{
                      width: 6,
                      height: 6,
                      background: 'var(--gold)',
                      animation: `dotBounce 1s ease-in-out ${i * 0.15}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Composer */}
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
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Спросите Мимира..."
            rows={1}
            className="w-full px-3 py-2 resize-none outline-none text-[15px] leading-[1.35] c-primary"
            style={{
              background: 'transparent',
              caretColor: 'var(--gold)',
              maxHeight: 120,
            }}
          />
        </div>
        <button
          onClick={() => sendMessage()}
          disabled={!text.trim() || loading}
          className={`shrink-0 flex items-center justify-center rounded-full spring-tap ${text.trim() ? '' : 'c-tertiary'}`}
          style={{
            width: 36,
            height: 36,
            background: text.trim()
              ? 'var(--gold-gradient)'
              : 'var(--bg-elevated)',
            ...(text.trim() ? { color: '#fff' } : {}),
            opacity: loading ? 0.5 : 1,
          }}
        >
          <Send size={18} className="ml-0.5" />
        </button>
      </div>
    </div>
  );
}
