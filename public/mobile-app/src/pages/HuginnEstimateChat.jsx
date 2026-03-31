import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, UserPlus, ChevronDown, Copy, CornerUpLeft } from 'lucide-react';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useMessages } from '@/hooks/useMessages';
import { useTyping } from '@/hooks/useTyping';
import { useSSE } from '@/hooks/useSSE';
import { useHaptic } from '@/hooks/useHaptic';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Composer } from '@/components/chat/Composer';
import { DateSeparator } from '@/components/chat/DateSeparator';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { EstimatePinnedCard } from '@/components/chat/EstimatePinnedCard';
import { MimirBubble } from '@/components/chat/MimirBubble';
import { ChatBubble } from '@/components/chat/ChatBubble';
import { SystemPill } from '@/components/chat/SystemPill';
import { AddMemberSheet } from '@/components/chat/AddMemberSheet';
import { plural } from '@/lib/utils';

const MIMIR_USER_ID = 4401;

/**
 * HuginnEstimateChat — полноэкранный чат просчёта
 * Telegram-level UX: pinned card, Мимир-пузыри, action badges, SSE
 */
export default function HuginnEstimateChat() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const haptic = useHaptic();
  const userId = useAuthStore((s) => s.user?.id);

  const [chat, setChat] = useState(null);
  const [members, setMembers] = useState([]);
  const [pinnedMeta, setPinnedMeta] = useState(null);
  const [pinnedFlash, setPinnedFlash] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [showScrollFab, setShowScrollFab] = useState(false);
  const [newMsgIds, setNewMsgIds] = useState(new Set());
  const [mimirTyping, setMimirTyping] = useState(false);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const [longPressMsg, setLongPressMsg] = useState(null);

  const containerRef = useRef(null);
  const bottomRef = useRef(null);
  const prevLenRef = useRef(0);
  const mimirTimerRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressTouchRef = useRef({ x: 0, y: 0 });

  const {
    messages,
    loading,
    hasOlder,
    loadMessages,
    loadOlder,
    sendMessage,
    handleSSE: handleMsgSSE,
  } = useMessages(chatId);

  const { typingUsers, sendTyping, handleTypingEvent } = useTyping(chatId);

  // Load chat details + extract pinned estimate card
  useEffect(() => {
    if (!chatId) return;
    (async () => {
      try {
        const res = await api.get(`/chat-groups/${chatId}`);
        setChat(res.chat || res);
        setMembers(res.members || []);
      } catch {}
    })();
    loadMessages();
  }, [chatId, loadMessages]);

  // Extract pinned card from messages (estimate_card type)
  useEffect(() => {
    const cardMsg = messages.find((m) => m.message_type === 'estimate_card');
    if (cardMsg?.metadata) {
      setPinnedMeta(cardMsg.metadata);
    }
  }, [messages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > prevLenRef.current) {
      const isOwn = messages.length > 0 && messages[messages.length - 1]?.user_id === userId;
      const newCount = messages.length - prevLenRef.current;

      // Track new IDs for animation
      if (prevLenRef.current > 0) {
        const ids = new Set();
        for (let i = prevLenRef.current; i < messages.length; i++) {
          ids.add(messages[i]?.id);
        }
        setNewMsgIds(ids);
        setTimeout(() => setNewMsgIds(new Set()), 300);
      }

      if (isOwn || prevLenRef.current === 0) {
        bottomRef.current?.scrollIntoView({ behavior: prevLenRef.current === 0 ? 'instant' : 'smooth' });
        setUnreadBelow(0);
      } else if (showScrollFab) {
        setUnreadBelow((prev) => prev + newCount);
      }
    }
    prevLenRef.current = messages.length;
  }, [messages.length, userId, showScrollFab]);

  // SSE handler
  const handleSSE = useCallback(
    (event, data) => {
      if (event === 'typing') {
        handleTypingEvent(data);
        return;
      }
      if (event === 'estimate_updated' && String(data.chat_id) === String(chatId)) {
        if (data.metadata) {
          setPinnedMeta(data.metadata);
          setPinnedFlash(true);
          setTimeout(() => setPinnedFlash(false), 700);
        }
        return;
      }
      // Check if incoming message is mimir — stop mimir typing
      if (event === 'new_message' && data.message) {
        if (data.message.message_type === 'mimir_response' || data.message.user_id === MIMIR_USER_ID) {
          setMimirTyping(false);
          if (mimirTimerRef.current) clearTimeout(mimirTimerRef.current);
        }
        // Trigger Мимир typing after director comment with approval_action
        if (data.message.metadata?.approval_action && data.message.metadata.approval_action !== 'approve') {
          setMimirTyping(true);
          mimirTimerRef.current = setTimeout(() => setMimirTyping(false), 15000);
        }
      }
      handleMsgSSE(event, data);
    },
    [handleMsgSSE, handleTypingEvent, chatId]
  );

  useSSE(handleSSE);

  const handleSend = useCallback(
    (text, replyId) => {
      haptic.light();
      sendMessage(text, replyId);
      setReplyTo(null);
    },
    [sendMessage, haptic]
  );

  // Scroll tracking
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollFab(dist > 200);
    if (hasOlder && el.scrollTop < 80) {
      loadOlder();
    }
  }, [hasOlder, loadOlder]);

  const scrollToBottom = useCallback(() => {
    haptic.light();
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUnreadBelow(0);
  }, [haptic]);

  // Pull-to-refresh: reload messages + pinned card
  const handleRefresh = useCallback(async () => {
    try {
      const res = await api.get(`/chat-groups/${chatId}`);
      setChat(res.chat || res);
      setMembers(res.members || []);
      await loadMessages();
    } catch {}
  }, [chatId, loadMessages]);

  // Long press on message → context menu
  const handleLongPressStart = useCallback((e, msg) => {
    if (msg.message_type === 'system' || msg.message_type === 'estimate_card' || msg.message_type === 'estimate_update') return;
    const touch = e.touches?.[0] || e;
    longPressTouchRef.current = { x: touch.clientX, y: touch.clientY };
    longPressTimerRef.current = setTimeout(() => {
      haptic.medium();
      setLongPressMsg(msg);
    }, 500);
  }, [haptic]);

  const handleLongPressMove = useCallback((e) => {
    if (!longPressTimerRef.current) return;
    const touch = e.touches?.[0] || e;
    const dx = Math.abs(touch.clientX - longPressTouchRef.current.x);
    const dy = Math.abs(touch.clientY - longPressTouchRef.current.y);
    if (dx > 10 || dy > 10) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleCopyText = useCallback(() => {
    if (!longPressMsg) return;
    navigator.clipboard.writeText(longPressMsg.message || '').catch(() => {});
    haptic.light();
    setLongPressMsg(null);
  }, [longPressMsg, haptic]);

  const handleReplyFromMenu = useCallback(() => {
    if (!longPressMsg) return;
    setReplyTo({ id: longPressMsg.id, user_name: longPressMsg.user_name, text: longPressMsg.message });
    setLongPressMsg(null);
  }, [longPressMsg]);

  // Keyboard: scroll to bottom when keyboard opens
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handler = () => {
      setTimeout(() => {
        const el = containerRef.current;
        if (el) {
          const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
          if (dist < 400) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }
        }
      }, 100);
    };
    vv.addEventListener('resize', handler);
    return () => vv.removeEventListener('resize', handler);
  }, []);

  // Member role lookup
  const memberRoleMap = {};
  members.forEach((m) => {
    memberRoleMap[m.user_id] = m.user_role || m.role;
  });

  // Date separator check
  const needsDate = (msg, i) => {
    if (i === 0) return true;
    const prev = messages[i - 1];
    return new Date(msg.created_at).toDateString() !== new Date(prev.created_at).toDateString();
  };

  // Group check (same sender within 2min)
  const showName = (msg, i) => {
    if (msg.is_system || msg.message_type === 'system' || msg.message_type === 'estimate_update') return false;
    const prev = messages[i - 1];
    if (!prev) return true;
    if (prev.user_id !== msg.user_id) return true;
    if (prev.is_system || prev.message_type === 'system' || prev.message_type === 'estimate_card') return true;
    return (new Date(msg.created_at) - new Date(prev.created_at)) > 120000;
  };

  const memberCount = members.length;

  // Render individual message
  const renderMessage = (msg, i) => {
    // Skip estimate_card (shown as pinned)
    if (msg.message_type === 'estimate_card') return null;

    // System message
    if (msg.message_type === 'system' || msg.is_system) {
      return <SystemPill key={msg.id} text={msg.message} />;
    }

    // Estimate update
    if (msg.message_type === 'estimate_update') {
      const meta = msg.metadata;
      const text = meta
        ? `Расчёт обновлён v.${meta.version_no || '?'}${meta.margin_pct ? `, маржа ${meta.margin_pct}%` : ''}`
        : msg.message;
      return <SystemPill key={msg.id} text={text} variant="estimate_update" />;
    }

    // Mimir response
    if (msg.message_type === 'mimir_response' || msg.user_id === MIMIR_USER_ID) {
      return (
        <div
          key={msg.id}
          onTouchStart={(e) => handleLongPressStart(e, msg)}
          onTouchMove={handleLongPressMove}
          onTouchEnd={handleLongPressEnd}
        >
          <MimirBubble msg={msg} isNew={newMsgIds.has(msg.id)} />
        </div>
      );
    }

    // Regular message
    const isMine = msg.user_id === userId;
    return (
      <div
        key={msg.id}
        onTouchStart={(e) => handleLongPressStart(e, msg)}
        onTouchMove={handleLongPressMove}
        onTouchEnd={handleLongPressEnd}
      >
        <ChatBubble
          msg={msg}
          isMine={isMine}
          showName={showName(msg, i)}
          userRole={memberRoleMap[msg.user_id]}
          isNew={newMsgIds.has(msg.id)}
        />
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      {/* Navbar */}
      <div
        className="shrink-0 flex items-center gap-3 px-2"
        style={{
          height: 56,
          paddingTop: 'var(--safe-top)',
          background: 'var(--bg-surface)',
          borderBottom: '0.5px solid var(--border-norse)',
        }}
      >
        <button
          onClick={() => navigate(-1)}
          className="flex items-center justify-center spring-tap"
          style={{ width: 44, height: 44 }}
        >
          <ArrowLeft size={22} style={{ color: 'var(--text-primary)' }} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {chat?.name || 'Чат просчёта'}
          </p>
          <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            {memberCount} {plural(memberCount, 'участник', 'участника', 'участников')}
          </p>
        </div>
        <button
          onClick={() => {
            haptic.light();
            setShowAddMember(true);
          }}
          className="flex items-center justify-center spring-tap"
          style={{ width: 44, height: 44 }}
        >
          <UserPlus size={20} style={{ color: '#58a6ff' }} />
        </button>
      </div>

      {/* Pinned card */}
      <EstimatePinnedCard metadata={pinnedMeta} flash={pinnedFlash} />

      {/* Messages */}
      <div className="flex-1 relative overflow-hidden">
        <PullToRefresh onRefresh={handleRefresh}>
          <div
            ref={containerRef}
            className="h-full overflow-y-auto scroll-container"
            onScroll={handleScroll}
            style={{ height: '100%' }}
          >
            {/* Load older spinner */}
            {hasOlder && (
              <div className="flex justify-center py-3">
                <div
                  className="h-5 w-5 rounded-full animate-spin"
                  style={{ border: '2px solid var(--bg-elevated)', borderTopColor: 'var(--gold)' }}
                />
              </div>
            )}

            {loading ? (
              <div className="flex-1 flex items-center justify-center py-12">
                <div
                  className="h-8 w-8 rounded-full animate-spin"
                  style={{ border: '2px solid var(--bg-elevated)', borderTopColor: 'var(--gold)' }}
                />
              </div>
            ) : (
              <div className="py-2">
                {messages.filter((m) => m.message_type !== 'estimate_card').length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 opacity-60">
                    <span style={{ fontSize: 32 }}>💬</span>
                    <p className="mt-2 text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
                      Нет сообщений
                    </p>
                  </div>
                )}
                {messages.map((msg, i) => (
                  <div key={msg.id}>
                    {needsDate(msg, i) && <DateSeparator date={msg.created_at} />}
                    {renderMessage(msg, i)}
                  </div>
                ))}
              </div>
            )}

            {/* Typing indicators */}
            <TypingIndicator users={typingUsers} />

            {/* Mimir typing */}
            {mimirTyping && (
              <div className="flex items-start gap-2 px-3 py-1">
                <div
                  className="shrink-0 flex items-center justify-center"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #6e1d2a, #0d2848)',
                    border: '2px solid #D4A843',
                    fontSize: 14,
                    fontWeight: 700,
                    color: '#D4A843',
                  }}
                >
                  M
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#D4A843' }}>Мимир</span>
                  </div>
                  <div
                    style={{
                      background: '#1a1a0e',
                      border: '1px solid rgba(212,168,67,0.2)',
                      borderRadius: '4px 16px 16px 16px',
                      padding: '12px 16px',
                    }}
                  >
                    <div className="flex gap-[3px] items-end">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="inline-block rounded-full"
                          style={{
                            width: 6,
                            height: 6,
                            background: '#D4A843',
                            animation: `dotBounce 1s ease-in-out ${i * 0.15}s infinite`,
                          }}
                        />
                      ))}
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                      Мимир анализирует...
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} style={{ height: 8 }} />
          </div>
        </PullToRefresh>

        {/* Scroll to bottom FAB with unread badge */}
        {showScrollFab && (
          <button
            onClick={scrollToBottom}
            className="scroll-fab spring-tap"
            style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 10 }}
          >
            <ChevronDown size={20} />
            {unreadBelow > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  minWidth: 18,
                  height: 18,
                  padding: '0 4px',
                  borderRadius: 9,
                  fontSize: 10,
                  fontWeight: 700,
                  background: 'var(--blue)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {unreadBelow > 99 ? '99+' : unreadBelow}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Long press context menu (bottom sheet) */}
      {longPressMsg && (
        <div
          className="fixed inset-0"
          style={{ zIndex: 50, background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setLongPressMsg(null)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-2xl"
            style={{
              background: 'var(--bg-surface)',
              paddingBottom: 'calc(16px + var(--safe-bottom))',
              animation: 'sheetSlideUp 200ms ease-out',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-norse)' }} />
            </div>
            <div className="px-4 py-2 mb-1 mx-4 rounded-xl" style={{ background: 'var(--bg-surface-alt)' }}>
              <p className="text-[13px] truncate" style={{ color: 'var(--text-secondary)' }}>
                {(longPressMsg.message || '').slice(0, 80)}
              </p>
            </div>
            <button
              onClick={handleCopyText}
              className="flex items-center gap-3 px-6 py-3.5 w-full active:bg-white/5 transition-colors"
            >
              <Copy size={20} style={{ color: 'var(--text-secondary)' }} />
              <span className="text-[15px]" style={{ color: 'var(--text-primary)' }}>Копировать текст</span>
            </button>
            <button
              onClick={handleReplyFromMenu}
              className="flex items-center gap-3 px-6 py-3.5 w-full active:bg-white/5 transition-colors"
            >
              <CornerUpLeft size={20} style={{ color: 'var(--text-secondary)' }} />
              <span className="text-[15px]" style={{ color: 'var(--text-primary)' }}>Ответить</span>
            </button>
          </div>
        </div>
      )}

      {/* Composer */}
      <Composer
        chatId={chatId}
        onSend={handleSend}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onTyping={sendTyping}
      />

      {/* Add member sheet */}
      <AddMemberSheet
        open={showAddMember}
        onClose={() => setShowAddMember(false)}
        chatId={chatId}
        existingMemberIds={members.map((m) => m.user_id)}
      />

      <style>{`
        @keyframes msgFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes badgeScale {
          from { transform: scale(0.95); }
          to { transform: scale(1); }
        }
        @keyframes pinnedFlash {
          0% { box-shadow: 0 0 0 0 rgba(212,168,67,0.4); }
          50% { box-shadow: 0 0 16px 4px rgba(212,168,67,0.3); }
          100% { box-shadow: 0 0 0 0 rgba(212,168,67,0); }
        }
        @keyframes sheetSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
