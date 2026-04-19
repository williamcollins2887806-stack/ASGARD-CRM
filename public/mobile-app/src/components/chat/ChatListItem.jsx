import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { formatDate } from '@/lib/utils';
import { Pin, BellOff, Archive } from 'lucide-react';

function normalizePreview(text) {
  if (!text) return '';
  if (text.includes('[Фото')) return '📷 Фото';
  if (text.includes('[Голосовое')) return '🎤 Голосовое';
  if (text.includes('[Видео')) return '🎬 Видео';
  if (text.includes('[Файл')) return '📎 Файл';
  return text.length > 60 ? text.slice(0, 60) + '…' : text;
}

const SWIPE_THRESHOLD = 70;

/**
 * ChatListItem — элемент списка чатов с swipe actions
 */
export function ChatListItem({ chat, onPin, onMute, onArchive }) {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [swipeX, setSwipeX] = useState(0);
  const touchRef = useRef({ x: 0, y: 0, swiping: false });

  const initials = (chat.name || '??')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  const isOnline = chat.is_online ||
    (chat.direct_user_last_login &&
      Date.now() - new Date(chat.direct_user_last_login).getTime() < 300000);

  const handleTap = () => {
    if (Math.abs(swipeX) > 5) return;
    haptic.light();
    navigate(`/chat/${chat.id}`);
  };

  const handleTouchStart = (e) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, swiping: false };
  };

  const handleTouchMove = useCallback((e) => {
    const t = e.touches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;

    if (Math.abs(dy) > Math.abs(dx) && !touchRef.current.swiping) return;
    if (Math.abs(dx) > 10) touchRef.current.swiping = true;

    if (touchRef.current.swiping && dx < 0) {
      setSwipeX(Math.max(dx, -200));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (swipeX < -SWIPE_THRESHOLD) {
      setSwipeX(-192);
    } else {
      setSwipeX(0);
    }
    touchRef.current.swiping = false;
  }, [swipeX]);

  const closeSwipe = () => setSwipeX(0);

  return (
    <div className="relative overflow-hidden" style={{ borderBottom: '0.5px solid var(--border-norse)' }}>
      {/* Swipe action buttons */}
      <div className="swipe-actions">
        <button
          className="swipe-action-btn"
          style={{ background: 'var(--blue)' }}
          onClick={() => { onMute?.(chat.id); closeSwipe(); }}
        >
          <BellOff size={18} />
          <span>Тихо</span>
        </button>
        <button
          className="swipe-action-btn"
          style={{ background: 'var(--gold)' }}
          onClick={() => { onPin?.(chat.id); closeSwipe(); }}
        >
          <Pin size={18} />
          <span>Закрепить</span>
        </button>
        <button
          className="swipe-action-btn"
          style={{ background: 'var(--red-soft)' }}
          onClick={() => { onArchive?.(chat.id); closeSwipe(); }}
        >
          <Archive size={18} />
          <span>Архив</span>
        </button>
      </div>

      {/* Main content — slides on swipe */}
      <div
        onClick={handleTap}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        className="flex items-center gap-3 w-full px-4 py-2.5 text-left spring-tap"
        style={{
          background: 'var(--bg-primary)',
          transform: `translateX(${swipeX}px)`,
          transition: swipeX === 0 || swipeX === -192 ? 'transform 250ms var(--ease-spring)' : 'none',
        }}
      >
        {/* Avatar */}
        <div className="relative shrink-0">
          <div
            className="avatar-hero"
            style={{ width: 48, height: 48, fontSize: 15 }}
          >
            {initials}
          </div>
          {isOnline && (
            <div
              className="absolute -bottom-0.5 -right-0.5 rounded-full online-pulse"
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
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-[15px] font-semibold truncate c-primary">
                {chat.name}
              </p>
              {chat.is_pinned && (
                <Pin size={12} className="c-tertiary shrink-0" />
              )}
              {chat.is_muted && (
                <BellOff size={12} className="c-tertiary shrink-0" />
              )}
            </div>
            <span className="text-[11px] shrink-0 c-tertiary">
              {chat.last_message_at ? formatDate(chat.last_message_at) : ''}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className="text-[13px] truncate c-secondary">
              {normalizePreview(chat.last_message)}
            </p>
            {chat.unread_count > 0 && (
              <span
                className="status-badge shrink-0 text-[11px] font-bold"
                style={{
                  minWidth: 20,
                  height: 20,
                  padding: '0 6px',
                  background: chat.is_muted ? 'var(--text-tertiary)' : 'var(--blue)',
                  color: '#fff',
                  justifyContent: 'center',
                }}
              >
                {chat.unread_count > 99 ? '99+' : chat.unread_count}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
