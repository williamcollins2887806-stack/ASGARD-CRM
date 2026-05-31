import { useState, useEffect, useCallback } from 'react';
import { X, Search, Send } from 'lucide-react';
import { api } from '@/api/client';
import { useHaptic } from '@/hooks/useHaptic';

/**
 * ForwardSheet — bottom sheet для пересылки сообщения в другой чат.
 * Props:
 *   message     — объект сообщения для пересылки
 *   onClose     — закрыть без действия
 *   onForwarded — callback после успешной отправки
 */
export function ForwardSheet({ message, onClose, onForwarded }) {
  const [chats, setChats] = useState([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [sending, setSending] = useState(false);
  const haptic = useHaptic();

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get('/chat-groups');
        setChats(api.extractRows(data) || []);
      } catch {}
    })();
  }, []);

  const filtered = chats.filter((ch) =>
    (ch.name || '').toLowerCase().includes(query.toLowerCase())
  );

  const handleForward = useCallback(async () => {
    if (!selected || !message || sending) return;
    setSending(true);
    haptic.medium();
    try {
      // Формируем текст пересланного сообщения
      const fwdText = [
        message.user_name ? `↩ ${message.user_name}:` : '↩ Переслано:',
        message.message || '',
      ].filter(Boolean).join('\n');

      await api.post(`/chat-groups/${selected.id}/messages`, {
        text: fwdText,
      });
      haptic.success?.() || haptic.light();
      onForwarded?.(selected);
      onClose?.();
    } catch {
      window.dispatchEvent(new CustomEvent('asgard:toast', {
        detail: { message: 'Ошибка пересылки', type: 'error' }
      }));
    } finally {
      setSending(false);
    }
  }, [selected, message, sending, haptic, onForwarded, onClose]);

  const initials = (name) =>
    (name || '?')
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();

  // Генерация цвета аватара из имени
  const avatarColor = (name) => {
    const colors = ['var(--blue)', 'var(--gold)', '#7B68EE', 'var(--green)', '#FF7043', '#26C6DA'];
    let h = 0;
    for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
    return colors[Math.abs(h) % colors.length];
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl"
        style={{
          background: 'var(--bg-surface)',
          paddingBottom: 'calc(var(--safe-bottom) + 16px)',
          maxHeight: '75vh',
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideUp 0.3s var(--ease-spring) both',
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: 'var(--bg-elevated)',
            }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2">
          <h2 className="text-[17px] font-semibold c-primary">Переслать в...</h2>
          <button
            onClick={onClose}
            className="spring-tap"
            style={{ color: 'var(--text-tertiary)', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pb-2">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: 'var(--bg-elevated)' }}
          >
            <Search size={16} style={{ color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск чата..."
              className="flex-1 bg-transparent outline-none text-[14px]"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map((chat) => {
            const color = avatarColor(chat.name);
            const isSelected = selected?.id === chat.id;
            return (
              <button
                key={chat.id}
                onClick={() => { setSelected(isSelected ? null : chat); haptic.light(); }}
                className="w-full flex items-center gap-3 px-4 py-3 spring-tap"
                style={{
                  background: isSelected
                    ? 'color-mix(in srgb, var(--gold) 8%, var(--bg-surface))'
                    : 'transparent',
                  borderBottom: '0.5px solid var(--border-norse)',
                }}
              >
                {/* Avatar */}
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: `color-mix(in srgb, ${color} 20%, var(--bg-elevated))`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 700,
                    color,
                    flexShrink: 0,
                    border: isSelected ? `2px solid ${color}` : '2px solid transparent',
                    transition: 'border-color 0.15s',
                  }}
                >
                  {initials(chat.name)}
                </div>

                <span className="flex-1 text-left text-[15px] font-medium c-primary truncate">
                  {chat.name}
                </span>

                {isSelected && (
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: 'var(--gold)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                      <path d="M1 5L4.5 8.5L11 1" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-center text-[14px] c-tertiary py-8">Нет чатов</p>
          )}
        </div>

        {/* Send button */}
        {selected && (
          <div className="px-4 pt-3">
            <button
              onClick={handleForward}
              disabled={sending}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl spring-tap"
              style={{
                background: 'var(--gold-gradient)',
                opacity: sending ? 0.7 : 1,
              }}
            >
              {sending ? (
                <div
                  className="w-4 h-4 rounded-full animate-spin"
                  style={{ border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff' }}
                />
              ) : (
                <Send size={16} style={{ color: '#fff' }} />
              )}
              <span style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>
                {sending ? 'Отправка...' : `Переслать в «${selected.name}»`}
              </span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
