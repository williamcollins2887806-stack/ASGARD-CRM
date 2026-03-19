import { ChevronLeft, Phone, MoreVertical } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';

function getOnlineLabel(lastLogin) {
  if (!lastLogin) return '';
  const diff = Date.now() - new Date(lastLogin).getTime();
  if (diff < 300000) return 'в сети';
  if (diff < 3600000) return `был(а) ${Math.floor(diff / 60000)} мин назад`;
  if (diff < 86400000) return `был(а) ${Math.floor(diff / 3600000)} ч назад`;
  return '';
}

/**
 * ChatHeader — хедер открытого чата
 */
export function ChatHeader({ chat, members }) {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const isOnline =
    members?.[0]?.last_login_at &&
    Date.now() - new Date(members[0].last_login_at).getTime() < 300000;

  const subtitle = chat?.is_group
    ? `${chat.member_count || members?.length || 0} участников`
    : getOnlineLabel(members?.[0]?.last_login_at);

  const initials = (chat?.name || '??')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
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
      {/* Back */}
      <button
        onClick={() => {
          haptic.light();
          navigate('/chat');
        }}
        className="flex items-center justify-center spring-tap"
        style={{ width: 44, height: 44, color: 'var(--blue)' }}
      >
        <ChevronLeft size={28} />
      </button>

      {/* Avatar */}
      <div className="relative shrink-0">
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 36,
            height: 36,
            background: 'var(--hero-gradient)',
            fontSize: 13,
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
              width: 10,
              height: 10,
              background: 'var(--green)',
              border: '2px solid var(--bg-primary)',
            }}
          />
        )}
      </div>

      {/* Name + status */}
      <div className="flex-1 min-w-0">
        <p
          className="text-[15px] font-semibold truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {chat?.name || 'Чат'}
        </p>
        {subtitle && (
          <p
            className="text-[11px] truncate"
            style={{ color: isOnline ? 'var(--green)' : 'var(--text-tertiary)' }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {/* Actions */}
      <button
        className="flex items-center justify-center spring-tap"
        style={{ width: 44, height: 44, color: 'var(--text-tertiary)' }}
      >
        <Phone size={20} />
      </button>
      <button
        className="flex items-center justify-center spring-tap"
        style={{ width: 44, height: 44, color: 'var(--text-tertiary)' }}
      >
        <MoreVertical size={20} />
      </button>
    </header>
  );
}
