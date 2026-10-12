import { useState, useRef } from 'react';
import { ChevronLeft, Phone, MoreVertical, Search, X, Archive, Link2, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useHaptic } from '@/hooks/useHaptic';
import { useAuthStore } from '@/stores/authStore';
import { BottomSheet } from '@/components/shared/BottomSheet';

const AVATAR_COLORS = [
  { bg: 'rgba(74,144,217,0.18)', color: '#4A90D9' },
  { bg: 'rgba(200,168,78,0.18)', color: '#c8a84e' },
  { bg: 'rgba(123,104,238,0.18)', color: '#7B68EE' },
  { bg: 'rgba(48,209,88,0.18)', color: '#30d158' },
  { bg: 'rgba(255,149,0,0.18)', color: '#ff9500' },
  { bg: 'rgba(255,69,58,0.18)', color: '#ff453a' },
];

function getAvatarStyle(name) {
  let h = 5381;
  for (let i = 0; i < (name || '').length; i++) h = ((h << 5) + h) ^ name.charCodeAt(i);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

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
  const myUserId = useAuthStore((s) => s.user?.id);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef(null);

  // Телефон собеседника (прямой чат): из участника, если бэк его отдаёт.
  const peerPhone = (() => {
    if (chat?.is_group) return '';
    const other = (members || []).find((m) => String(m.user_id) !== String(myUserId));
    return (other && other.phone) || '';
  })();

  const handleCall = () => {
    haptic.light();
    if (peerPhone) {
      window.location.href = `tel:${peerPhone}`;
    } else {
      toast.info('Номер собеседника не указан');
    }
  };

  const handleCopyLink = async () => {
    haptic.light();
    setMenuOpen(false);
    try {
      const url = `${window.location.origin}/m/chat/${chat?.id}`;
      await navigator.clipboard.writeText(url);
      toast.success('Ссылка на чат скопирована');
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const handleArchive = async () => {
    haptic.light();
    setMenuOpen(false);
    try {
      await api.put(`/chat-groups/${chat?.id}/archive`, { archive: true });
      toast.success('Чат в архиве');
      navigate('/chat');
    } catch (e) {
      toast.error(e?.message || 'Не удалось архивировать');
    }
  };

  const handleLeave = async () => {
    haptic.medium();
    setMenuOpen(false);
    try {
      await api.delete(`/chat-groups/${chat?.id}/members/${myUserId}`).catch(() => {});
      toast.success('Вы вышли из чата');
      navigate('/chat');
    } catch (e) {
      toast.error(e?.message || 'Не удалось выйти');
    }
  };

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
          {(() => {
            const { bg, color } = getAvatarStyle(chat?.name);
            return (
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 700,
                  color,
                }}
              >
                {initials}
              </div>
            );
          })()}
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
        <button className="btn-icon spring-tap" onClick={handleCall} aria-label="Позвонить">
          <Phone size={20} />
        </button>
        <button className="btn-icon spring-tap" onClick={() => { haptic.light(); setMenuOpen(true); }} aria-label="Действия чата">
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

      {/* Меню действий чата */}
      <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} title={chat?.name || 'Чат'}>
        <div className="flex flex-col gap-1 pb-4">
          <button
            className="flex items-center gap-3 px-3 py-3 rounded-xl text-left active:bg-white/5"
            onClick={() => { setMenuOpen(false); handleCall(); }}
          >
            <Phone size={20} className="c-blue shrink-0" />
            <span className="text-[15px] c-primary">{peerPhone ? 'Позвонить' : 'Позвонить (нет номера)'}</span>
          </button>
          <button
            className="flex items-center gap-3 px-3 py-3 rounded-xl text-left active:bg-white/5"
            onClick={handleCopyLink}
          >
            <Link2 size={20} className="c-tertiary shrink-0" />
            <span className="text-[15px] c-primary">Скопировать ссылку</span>
          </button>
          <button
            className="flex items-center gap-3 px-3 py-3 rounded-xl text-left active:bg-white/5"
            onClick={handleArchive}
          >
            <Archive size={20} className="c-tertiary shrink-0" />
            <span className="text-[15px] c-primary">В архив</span>
          </button>
          <button
            className="flex items-center gap-3 px-3 py-3 rounded-xl text-left active:bg-white/5"
            onClick={handleLeave}
          >
            <LogOut size={20} style={{ color: 'var(--red-soft)' }} className="shrink-0" />
            <span className="text-[15px]" style={{ color: 'var(--red-soft)' }}>Выйти из чата</span>
          </button>
        </div>
      </BottomSheet>
    </header>
  );
}
