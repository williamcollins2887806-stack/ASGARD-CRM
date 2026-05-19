import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { ChevronDown, Search } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { DateSeparator } from './DateSeparator';
import { TypingIndicator } from './TypingIndicator';

/**
 * UnreadSeparator — разделитель "N непрочитанных сообщений" (как в Telegram)
 */
function UnreadSeparator({ count }) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2"
      style={{ animation: 'fadeInUp 0.3s var(--ease-spring) both' }}
    >
      <div style={{ flex: 1, height: '0.5px', background: 'color-mix(in srgb, var(--blue) 40%, var(--border-norse))' }} />
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--blue)',
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
        }}
      >
        {count === 1 ? '1 непрочитанное' : `${count} непрочитанных`}
      </span>
      <div style={{ flex: 1, height: '0.5px', background: 'color-mix(in srgb, var(--blue) 40%, var(--border-norse))' }} />
    </div>
  );
}

/**
 * Highlight search query inside a string
 */
function HighlightText({ text, query }) {
  if (!query || !text) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark
            key={i}
            style={{
              background: 'color-mix(in srgb, var(--gold) 35%, transparent)',
              color: 'inherit',
              borderRadius: 2,
              padding: '0 1px',
            }}
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

/**
 * MessageList — скролл-контейнер сообщений с датами, infinite scroll, ScrollToBottom FAB
 */
export function MessageList({
  messages,
  loading,
  hasOlder,
  onLoadOlder,
  onReply,
  onReaction,
  onDelete,
  onEdit,
  onForward,
  typingUsers,
  firstUnreadId,
  searchQuery,
}) {
  const userId = useAuthStore((s) => s.user?.id);
  const containerRef = useRef(null);
  const bottomRef = useRef(null);
  const prevLenRef = useRef(0);
  const msgRefsMap = useRef({});
  const [showScrollFab, setShowScrollFab] = useState(false);
  const [newMsgIds, setNewMsgIds] = useState(new Set());

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > prevLenRef.current) {
      const isNewAtBottom =
        messages.length > 0 &&
        messages[messages.length - 1]?.user_id === userId;

      if (prevLenRef.current > 0) {
        const ids = new Set();
        for (let i = prevLenRef.current; i < messages.length; i++) {
          ids.add(messages[i]?.id);
        }
        setNewMsgIds(ids);
        setTimeout(() => setNewMsgIds(new Set()), 300);
      }

      if (isNewAtBottom || prevLenRef.current === 0) {
        bottomRef.current?.scrollIntoView({ behavior: prevLenRef.current === 0 ? 'instant' : 'smooth' });
      }
    }
    prevLenRef.current = messages.length;
  }, [messages.length, userId]);

  // Scroll to specific message by id (for reply tap)
  const scrollToMsg = useCallback((msgId) => {
    const el = msgRefsMap.current[msgId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Flash highlight
    el.style.transition = 'background 0s';
    el.style.background = 'color-mix(in srgb, var(--gold) 12%, transparent)';
    setTimeout(() => {
      el.style.transition = 'background 800ms ease';
      el.style.background = '';
    }, 50);
    setTimeout(() => {
      el.style.transition = '';
    }, 900);
  }, []);

  // Scroll position tracking for FAB
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollFab(distFromBottom > 200);
    if (hasOlder && el.scrollTop < 80) {
      onLoadOlder?.();
    }
  }, [hasOlder, onLoadOlder]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Group messages: same author within 2 minutes
  const getPosition = (msg, i, list) => {
    const prev = list[i - 1];
    const next = list[i + 1];
    const sameAsPrev =
      prev &&
      !prev.deleted_at &&
      prev.user_id === msg.user_id &&
      new Date(msg.created_at) - new Date(prev.created_at) < 120000;
    const sameAsNext =
      next &&
      !next.deleted_at &&
      next.user_id === msg.user_id &&
      new Date(next.created_at) - new Date(msg.created_at) < 120000;

    if (sameAsPrev && sameAsNext) return 'middle';
    if (sameAsPrev) return 'last';
    if (sameAsNext) return 'first';
    return 'single';
  };

  const needsDate = (msg, i, list) => {
    if (i === 0) return true;
    const prev = list[i - 1];
    return (
      new Date(msg.created_at).toDateString() !==
      new Date(prev.created_at).toDateString()
    );
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div
          className="h-8 w-8 rounded-full animate-spin"
          style={{
            border: '2px solid var(--bg-elevated)',
            borderTopColor: 'var(--gold)',
          }}
        />
      </div>
    );
  }

  // Filter by search query
  const q = searchQuery?.trim().toLowerCase();
  const filteredMessages = q
    ? messages.filter((m) =>
        !m.deleted_at && (m.message || '').toLowerCase().includes(q)
      )
    : messages;

  // Search empty state
  if (q && filteredMessages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
        <Search size={36} style={{ color: 'var(--text-tertiary)', opacity: 0.4 }} />
        <p className="text-sm text-center" style={{ color: 'var(--text-tertiary)' }}>
          Ничего не найдено по запросу «{searchQuery}»
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 relative overflow-hidden">
      {/* Search results count */}
      {q && filteredMessages.length > 0 && (
        <div
          className="flex items-center justify-center py-1.5"
          style={{
            background: 'color-mix(in srgb, var(--gold) 8%, var(--bg-primary))',
            borderBottom: '0.5px solid var(--border-norse)',
            fontSize: 12,
            color: 'var(--text-secondary)',
          }}
        >
          {filteredMessages.length} {filteredMessages.length === 1 ? 'сообщение' : filteredMessages.length < 5 ? 'сообщения' : 'сообщений'}
        </div>
      )}

      <div
        ref={containerRef}
        className="h-full overflow-y-auto scroll-container"
        onScroll={handleScroll}
      >
        {/* Load older indicator */}
        {hasOlder && !q && (
          <div className="flex justify-center py-3">
            <div
              className="h-5 w-5 rounded-full animate-spin"
              style={{
                border: '2px solid var(--bg-elevated)',
                borderTopColor: 'var(--gold)',
              }}
            />
          </div>
        )}

        <div className="py-2">
          {(() => {
            // Count unread from firstUnreadId
            let unreadCount = 0;
            if (firstUnreadId && !q) {
              const idx = messages.findIndex((m) => String(m.id) === String(firstUnreadId));
              if (idx >= 0) unreadCount = messages.length - idx;
            }

            return filteredMessages.map((msg, i) => {
              const isMine = msg.user_id === userId;
              const pos = getPosition(msg, i, filteredMessages);
              const showUnread = !q && firstUnreadId && String(msg.id) === String(firstUnreadId) && !isMine && unreadCount > 0;

              return (
                <div
                  key={msg.id}
                  ref={(el) => { if (el) msgRefsMap.current[msg.id] = el; }}
                  style={{ borderRadius: 8 }}
                >
                  {!q && needsDate(msg, i, filteredMessages) && (
                    <DateSeparator date={msg.created_at} />
                  )}
                  {showUnread && <UnreadSeparator count={unreadCount} />}
                  <MessageBubble
                    msg={msg}
                    isMine={isMine}
                    grouped={pos === 'middle' || pos === 'last'}
                    position={pos}
                    onReply={onReply}
                    onReaction={onReaction}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    onForward={onForward}
                    isNew={newMsgIds.has(msg.id)}
                    searchQuery={searchQuery}
                    onScrollToMessage={scrollToMsg}
                  />
                </div>
              );
            });
          })()}
        </div>

        {!q && <TypingIndicator users={typingUsers} />}
        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom FAB */}
      {showScrollFab && !q && (
        <button
          onClick={scrollToBottom}
          className="scroll-fab spring-tap"
        >
          <ChevronDown size={20} />
        </button>
      )}
    </div>
  );
}
