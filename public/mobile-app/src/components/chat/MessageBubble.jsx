import { useState, useRef, useCallback } from 'react';
import { Check, CheckCheck, Reply, Forward } from 'lucide-react';
import { ReactionBadge } from './ReactionBadge';
import { VoicePlayer } from './VoicePlayer';
import { VideoCircle } from './VideoCircle';
import { ImagePreview } from './ImagePreview';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '👀', '✅'];
const SWIPE_THRESHOLD = 60;

/**
 * MessageBubble — бабл сообщения
 * Swipe-to-reply, анимации, улучшенное контекстное меню
 */
export function MessageBubble({
  msg,
  isMine,
  grouped,
  position,
  onReply,
  onReaction,
  onDelete,
  onEdit,
  isNew,
}) {
  const [showMenu, setShowMenu] = useState(false);
  const longPressTimer = useRef(null);

  // Swipe state
  const [swipeX, setSwipeX] = useState(0);
  const touchStartRef = useRef({ x: 0, y: 0, swiping: false });

  // Deleted message
  if (msg.deleted_at) {
    return (
      <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} px-3 py-0.5`}>
        <div
          className="px-3 py-1.5 rounded-2xl text-[13px] italic c-tertiary"
          style={{ opacity: 0.6 }}
        >
          Сообщение удалено
        </div>
      </div>
    );
  }

  // Border radius based on position + side
  const getRadius = () => {
    const r = 18;
    const s = 4;
    if (position === 'single') return `${r}px`;
    if (isMine) {
      if (position === 'first') return `${r}px ${r}px ${s}px ${r}px`;
      if (position === 'middle') return `${r}px ${s}px ${s}px ${r}px`;
      if (position === 'last') return `${r}px ${s}px ${r}px ${r}px`;
    } else {
      if (position === 'first') return `${r}px ${r}px ${r}px ${s}px`;
      if (position === 'middle') return `${s}px ${r}px ${r}px ${s}px`;
      if (position === 'last') return `${s}px ${r}px ${r}px ${r}px`;
    }
    return `${r}px`;
  };

  const time = new Date(msg.created_at).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const isImage =
    msg.attachments?.some((a) => a.mime_type?.startsWith('image/')) ||
    msg.message_type === 'image';
  const isVoice = msg.message_type === 'voice';
  const isVideo = msg.message_type === 'video';

  // Long press for context menu
  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, swiping: false };
    longPressTimer.current = setTimeout(() => {
      if (!touchStartRef.current.swiping) {
        setShowMenu(true);
      }
    }, 500);
  };

  const handleTouchMove = useCallback((e) => {
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;

    // If vertical scroll, cancel swipe
    if (Math.abs(dy) > Math.abs(dx) && !touchStartRef.current.swiping) {
      return;
    }

    // Start swiping if horizontal > 10px
    if (Math.abs(dx) > 10) {
      touchStartRef.current.swiping = true;
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    }

    if (touchStartRef.current.swiping) {
      // Own messages swipe left (negative), others swipe right (positive)
      const clamp = isMine
        ? Math.max(Math.min(dx, 0), -100)
        : Math.min(Math.max(dx, 0), 100);
      setSwipeX(clamp);
    }
  }, [isMine]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (Math.abs(swipeX) >= SWIPE_THRESHOLD) {
      onReply?.(msg);
    }
    setSwipeX(0);
    touchStartRef.current.swiping = false;
  }, [swipeX, msg, onReply]);

  const imageUrl =
    msg.attachments?.find((a) => a.mime_type?.startsWith('image/'))?.url ||
    msg.file_url;

  const swipeProgress = Math.min(Math.abs(swipeX) / SWIPE_THRESHOLD, 1);

  // Animation class
  const animClass = isNew
    ? isMine ? 'msg-enter-own' : 'msg-enter'
    : '';

  return (
    <div
      className={`relative ${isMine ? 'flex justify-end' : 'flex justify-start'} px-3 ${animClass}`}
      style={{ marginTop: grouped ? 1 : 6 }}
    >
      {/* Swipe reply icon */}
      {swipeX !== 0 && (
        <div
          className="swipe-reply-icon"
          style={{
            [isMine ? 'right' : 'left']: isMine ? 'calc(80% + 12px)' : 'calc(80% + 12px)',
            opacity: swipeProgress,
            transform: `translateY(-50%) scale(${0.5 + swipeProgress * 0.5})`,
          }}
        >
          <Reply size={20} />
        </div>
      )}

      <div
        className="relative"
        style={{
          maxWidth: '80%',
          transform: `translateX(${swipeX}px)`,
          transition: swipeX === 0 ? 'transform 250ms var(--ease-spring)' : 'none',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onContextMenu={(e) => {
          e.preventDefault();
          setShowMenu(true);
        }}
      >
        {/* Sender name */}
        {!isMine && !grouped && msg.user_name && (
          <p className="text-[11px] font-semibold mb-0.5 ml-1 c-blue">
            {msg.user_name}
          </p>
        )}

        <div
          className="relative overflow-hidden"
          style={{
            borderRadius: getRadius(),
            background: isMine
              ? 'linear-gradient(135deg, var(--bubble-own-start), var(--bubble-own-end))'
              : 'var(--bubble-other)',
            padding: isImage || isVideo ? 0 : undefined,
          }}
        >
          {/* Reply quote */}
          {msg.reply_to && msg.reply_text && (
            <div
              className="flex items-start gap-1.5 mx-2.5 mt-2 mb-1 px-2 py-1.5 rounded-lg"
              style={{
                background: isMine ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)',
                borderLeft: '2px solid var(--blue)',
              }}
            >
              <div className="min-w-0">
                <p className="text-[11px] font-semibold truncate c-blue">
                  {msg.reply_user_name || ''}
                </p>
                <p className="text-[11px] truncate c-secondary">
                  {msg.reply_text}
                </p>
              </div>
            </div>
          )}

          {/* Content by type */}
          {isVoice ? (
            <div className="px-3 py-2">
              <VoicePlayer
                fileUrl={msg.file_url}
                duration={msg.file_duration}
                isMine={isMine}
              />
            </div>
          ) : isVideo ? (
            <div className="p-2">
              <VideoCircle fileUrl={msg.file_url} duration={msg.file_duration} />
            </div>
          ) : isImage && imageUrl ? (
            <div>
              <ImagePreview src={imageUrl} alt="" />
              {msg.message && (
                <div className="px-3 pt-1.5 pb-1">
                  <p className="text-[15px] leading-[1.35]" style={{ color: isMine ? '#fff' : 'var(--text-primary)' }}>
                    {msg.message}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="px-3 py-2">
              <p
                className="text-[15px] leading-[1.35] whitespace-pre-wrap break-words"
                style={{ color: isMine ? '#fff' : 'var(--text-primary)' }}
              >
                {msg.message}
              </p>
            </div>
          )}

          {/* Time + status */}
          <div
            className={`flex items-center gap-1 ${isImage && !msg.message ? 'absolute bottom-1.5 right-2' : 'px-3 pb-1.5 -mt-0.5'}`}
            style={{ justifyContent: 'flex-end' }}
          >
            {msg.edited_at && (
              <span className="text-[10px]" style={{ color: isMine ? 'rgba(255,255,255,0.4)' : 'var(--text-tertiary)' }}>
                ред.
              </span>
            )}
            <span
              className="text-[10px]"
              style={{
                color: isImage && !msg.message
                  ? 'rgba(255,255,255,0.8)'
                  : isMine
                    ? 'rgba(255,255,255,0.5)'
                    : 'var(--text-tertiary)',
              }}
            >
              {time}
            </span>
            {isMine && (
              <span
                className="check-animate"
                style={{
                  color: msg._sending
                    ? 'rgba(255,255,255,0.3)'
                    : msg.is_read ? '#4fc3f7' : 'rgba(255,255,255,0.5)',
                }}
              >
                {msg._sending ? (
                  <Check size={12} />
                ) : msg.is_read ? (
                  <CheckCheck size={12} />
                ) : (
                  <Check size={12} />
                )}
              </span>
            )}
            {msg._failed && (
              <span className="text-[10px] c-red">!</span>
            )}
          </div>
        </div>

        {/* Reactions */}
        <ReactionBadge
          reactions={msg.reactions}
          onTap={(emoji) => onReaction?.(msg.id, emoji)}
        />

        {/* Context menu (long press) — with backdrop blur + scale-in */}
        {showMenu && (
          <>
            <div
              className="ctx-backdrop"
              onClick={() => setShowMenu(false)}
            />
            <div
              className="absolute ctx-menu"
              style={{
                [isMine ? 'right' : 'left']: 0,
                bottom: '100%',
                marginBottom: 4,
                zIndex: 'var(--z-modal)',
              }}
            >
              {/* Quick reactions */}
              <div
                className="flex gap-1 p-1.5 rounded-2xl mb-1"
                style={{
                  background: 'var(--bg-elevated)',
                  boxShadow: 'var(--shadow-lg)',
                }}
              >
                {QUICK_REACTIONS.map((e) => (
                  <button
                    key={e}
                    onClick={() => {
                      onReaction?.(msg.id, e);
                      setShowMenu(false);
                    }}
                    className="flex items-center justify-center rounded-lg spring-tap"
                    style={{ width: 36, height: 36, fontSize: 20 }}
                  >
                    {e}
                  </button>
                ))}
              </div>

              {/* Actions menu */}
              <div
                className="rounded-xl overflow-hidden"
                style={{
                  background: 'var(--bg-elevated)',
                  boxShadow: 'var(--shadow-lg)',
                  minWidth: 180,
                }}
              >
                <button
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[14px] c-primary"
                  onClick={() => { onReply?.(msg); setShowMenu(false); }}
                >
                  <Reply size={16} className="c-tertiary" />
                  Ответить
                </button>
                <button
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[14px] c-primary"
                  style={{ borderTop: '0.5px solid var(--border-norse)' }}
                  onClick={() => {
                    navigator.clipboard?.writeText(msg.message || '').catch(() => {});
                    setShowMenu(false);
                  }}
                >
                  Копировать
                </button>
                <button
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[14px] c-primary"
                  style={{ borderTop: '0.5px solid var(--border-norse)' }}
                  onClick={() => setShowMenu(false)}
                >
                  <Forward size={16} className="c-tertiary" />
                  Переслать
                </button>
                {isMine && (
                  <>
                    <button
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[14px] c-primary"
                      style={{ borderTop: '0.5px solid var(--border-norse)' }}
                      onClick={() => { onEdit?.(msg); setShowMenu(false); }}
                    >
                      Редактировать
                    </button>
                    <button
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[14px] c-red"
                      style={{ borderTop: '0.5px solid var(--border-norse)' }}
                      onClick={() => { onDelete?.(msg.id); setShowMenu(false); }}
                    >
                      Удалить
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
