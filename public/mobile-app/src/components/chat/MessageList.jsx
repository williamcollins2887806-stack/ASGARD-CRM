import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { ChevronDown } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { DateSeparator } from './DateSeparator';
import { TypingIndicator } from './TypingIndicator';

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
  typingUsers,
}) {
  const userId = useAuthStore((s) => s.user?.id);
  const containerRef = useRef(null);
  const bottomRef = useRef(null);
  const prevLenRef = useRef(0);
  const [showScrollFab, setShowScrollFab] = useState(false);
  const [newMsgIds, setNewMsgIds] = useState(new Set());

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > prevLenRef.current) {
      const isNewAtBottom =
        messages.length > 0 &&
        messages[messages.length - 1]?.user_id === userId;

      // Track new message IDs for animation
      if (prevLenRef.current > 0) {
        const ids = new Set();
        for (let i = prevLenRef.current; i < messages.length; i++) {
          ids.add(messages[i]?.id);
        }
        setNewMsgIds(ids);
        // Clear after animation
        setTimeout(() => setNewMsgIds(new Set()), 300);
      }

      if (isNewAtBottom || prevLenRef.current === 0) {
        bottomRef.current?.scrollIntoView({ behavior: prevLenRef.current === 0 ? 'instant' : 'smooth' });
      }
    }
    prevLenRef.current = messages.length;
  }, [messages.length, userId]);

  // Scroll position tracking for FAB
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Show FAB when scrolled up more than 200px from bottom
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollFab(distFromBottom > 200);

    // Infinite scroll up
    if (hasOlder && el.scrollTop < 80) {
      onLoadOlder?.();
    }
  }, [hasOlder, onLoadOlder]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Group messages: same author within 2 minutes
  const getPosition = (msg, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
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

  const needsDate = (msg, i) => {
    if (i === 0) return true;
    const prev = messages[i - 1];
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

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={containerRef}
        className="h-full overflow-y-auto scroll-container"
        onScroll={handleScroll}
      >
        {/* Load older indicator */}
        {hasOlder && (
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
          {messages.map((msg, i) => {
            const isMine = msg.user_id === userId;
            const pos = getPosition(msg, i);

            return (
              <div key={msg.id}>
                {needsDate(msg, i) && (
                  <DateSeparator date={msg.created_at} />
                )}
                <MessageBubble
                  msg={msg}
                  isMine={isMine}
                  grouped={pos === 'middle' || pos === 'last'}
                  position={pos}
                  onReply={onReply}
                  onReaction={onReaction}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  isNew={newMsgIds.has(msg.id)}
                />
              </div>
            );
          })}
        </div>

        <TypingIndicator users={typingUsers} />
        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom FAB */}
      {showScrollFab && (
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
