import { useState, useRef } from 'react';
import { ChevronLeft, Phone, MoreVertical, Search, X } from 'lucide-react';
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
 * ChatHeader — хедер открытого чата с поиском
 */
export function ChatHeader({ chat, members, onSearch }) {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  // For direct chats, find the OTHER member (not self)
  const otherMember = !chat?.is_group
    ? members?.find((m) => m.is_online !== undefined) || members?.[0]
    : null;

  const isOnline = otherMember?.is_online ||
    (otherMember?.last_login_at &&
      Date.now() - new Date(otherMember.last_login_at).getTime() < 300000);

  const subtitle = chat?.is_group
    ? `${chat.member_count || members?.length || 0} участников`
    : isOnline
      ? 'в сети'
      : getOnlineLabel(otherMember?.last_login_at);

  const initials = (chat?.name || '??')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  const handleSearchToggle = () => {
    haptic.light();
    if (searching) {
      setSearching(false);
      setQuery('');
      onSearch?.('');
    } else {
      setSearching(true);
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  };

  const handleSearchInput = (e) => {
    const v = e.target.value;
    setQuery(v);
    onSearch?.(v);
  };

  return (
    <header
      className="shrink-0"
      style={{
        paddingTop: 'calc(var(--safe-top) + 6px)',
        background: 'var(--bg-primary)',
        borderBottom: '0.5px solid var(--border-norse)',
        zIndex: 10,
      }}
    >
      <div className="flex items-center gap-2 px-2" style={{ paddingBottom: 8 }}>
        {/* Back */}
        <button
          onClick={() => {
            haptic.light();
            navigate('/chat');
          }}
          className="btn-icon spring-tap"
          style={{ color: 'var(--blue)' }}
        >
          <ChevronLeft size={28} />
        </button>

        {/* Avatar */}
        <div className="relative shrink-0">
          <div
            className="avatar-hero"
            style={{ width: 36, height: 36, fontSize: 13 }}
          >
            {initials}
          </div>
          {isOnline && (
            <div
              className="absolute -bottom-0.5 -right-0.5 rounded-full online-pulse"
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
          <p className="text-[15px] font-semibold truncate c-primary">
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

        {/* Search */}
        <button
          onClick={handleSearchToggle}
          className="btn-icon spring-tap"
          style={{ color: searching ? 'var(--gold)' : 'var(--text-tertiary)' }}
        >
          {searching ? <X size={20} /> : <Search size={20} />}
        </button>

        {/* Actions */}
        <button className="btn-icon spring-tap">
          <Phone size={20} />
        </button>
        <button className="btn-icon spring-tap">
          <MoreVertical size={20} />
        </button>
      </div>

      {/* Search bar */}
      {searching && (
        <div
          className={`px-3 pb-2 ${searching ? 'chat-search-enter' : 'chat-search-exit'}`}
        >
          <div className="search-bar">
            <Search size={16} className="c-tertiary shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={handleSearchInput}
              placeholder="Поиск в чате..."
            />
          </div>
        </div>
      )}
    </header>
  );
}
