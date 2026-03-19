import { useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { formatDate } from '@/lib/utils';

function normalizePreview(text) {
  if (!text) return '';
  if (text.includes('[Фото')) return '📷 Фото';
  if (text.includes('[Голосовое')) return '🎤 Голосовое';
  if (text.includes('[Видео')) return '🎬 Видео';
  if (text.includes('[Файл')) return '📎 Файл';
  return text.length > 60 ? text.slice(0, 60) + '…' : text;
}

/**
 * ChatListItem — элемент списка чатов
 */
export function ChatListItem({ chat }) {
  const navigate = useNavigate();
  const haptic = useHaptic();

  const initials = (chat.name || '??')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  const isOnline =
    chat.last_login_at &&
    Date.now() - new Date(chat.last_login_at).getTime() < 300000;

  const handleTap = () => {
    haptic.light();
    navigate(`/chat/${chat.id}`);
  };

  return (
    <button
      onClick={handleTap}
      className="flex items-center gap-3 w-full px-4 py-2.5 text-left spring-tap"
      style={{
        borderBottom: '0.5px solid var(--border-norse)',
      }}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 48,
            height: 48,
            background: 'var(--hero-gradient)',
            fontSize: 15,
            fontWeight: 700,
            color: '#fff',
          }}
        >
          {initials}
        </div>
        {isOnline && (
          <div
            className="absolute -bottom-0.5 -right-0.5 rounded-full"
            style={{
              width: 12,
              height: 12,
              background: 'var(--green)',
              border: '2.5px solid var(--bg-primary)',
            }}
          />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p
            className="text-[15px] font-semibold truncate"
            style={{ color: 'var(--text-primary)' }}
          >
            {chat.name}
          </p>
          <span
            className="text-[11px] shrink-0"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {chat.last_message_at ? formatDate(chat.last_message_at) : ''}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p
            className="text-[13px] truncate"
            style={{ color: 'var(--text-secondary)' }}
          >
            {normalizePreview(chat.last_message)}
          </p>
          {chat.unread_count > 0 && (
            <span
              className="shrink-0 flex items-center justify-center rounded-full text-[11px] font-bold"
              style={{
                minWidth: 20,
                height: 20,
                padding: '0 6px',
                background: 'var(--blue)',
                color: '#fff',
              }}
            >
              {chat.unread_count > 99 ? '99+' : chat.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
