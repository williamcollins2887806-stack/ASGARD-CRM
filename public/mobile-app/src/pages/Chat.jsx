import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Edit3, Search } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { ChatListItem } from '@/components/chat/ChatListItem';
import { MimirChatItem } from '@/components/chat/MimirChatItem';
import { NewChatSheet } from '@/components/chat/NewChatSheet';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { useChat } from '@/hooks/useChat';
import { useSSE } from '@/hooks/useSSE';
import { useHaptic } from '@/hooks/useHaptic';
import { relativeTime } from '@/lib/utils';

const STATUS_COLORS = {
  draft: '#888888',
  sent: '#1F6FEB',
  rework: '#D4A843',
  question: '#D4A843',
  approved: '#3FB950',
  rejected: '#F85149',
};

const STATUS_LABELS = {
  draft: 'Черновик',
  sent: 'На согласов.',
  rework: 'На доработке',
  question: 'Вопрос',
  approved: 'Согласован',
  rejected: 'Отклонён',
};

const TABS = [
  { key: 'all', label: 'Все' },
  { key: 'estimates', label: 'Просчёты' },
  { key: 'personal', label: 'Личные' },
];

const TAB_COLORS = { all: '#fff', estimates: '#D4A843', personal: '#1F6FEB' };

const ESTIMATE_STATUS_ORDER = {
  sent: 0, rework: 1, question: 2, approved: 3, draft: 4, rejected: 5,
};

function guessEstimateStatus(chat) {
  const lt = chat.last_message_type;
  if (lt === 'estimate_update' || lt === 'estimate_card') {
    return chat.last_message_metadata?.status || 'sent';
  }
  const txt = (chat.last_message_text || chat.last_message || '').toLowerCase();
  if (txt.includes('согласован')) return 'approved';
  if (txt.includes('доработк')) return 'rework';
  if (txt.includes('отклон')) return 'rejected';
  if (txt.includes('вопрос')) return 'question';
  return 'sent';
}

/**
 * EstimateChatItem — карточка чата просчёта с цветной полоской
 */
function EstimateChatItem({ chat }) {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const status = guessEstimateStatus(chat);
  const borderColor = STATUS_COLORS[status] || STATUS_COLORS.sent;

  const preview = chat.last_message_text || chat.last_message || '';
  const sender = chat.last_message_sender;
  const previewText = sender
    ? `${sender.split(' ')[0]}: ${preview}`.slice(0, 60)
    : preview.slice(0, 60);

  return (
    <div
      onClick={() => {
        haptic.light();
        navigate(`/huginn-chat/${chat.id}`);
      }}
      className="flex items-center gap-3 px-4 py-3 active:bg-white/5 transition-colors"
      style={{ borderLeft: `3px solid ${borderColor}` }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start">
          <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {chat.name}
          </p>
          <span className="text-[11px] whitespace-nowrap ml-2" style={{ color: 'var(--text-tertiary)' }}>
            {chat.last_message_at ? relativeTime(chat.last_message_at) : ''}
          </span>
        </div>
        <div className="flex justify-between items-center mt-0.5">
          <p className="text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>
            {previewText || 'Нет сообщений'}
          </p>
          <div className="flex items-center gap-1.5 ml-2 shrink-0">
            <span
              className="inline-flex items-center"
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: 5,
                background: `${borderColor}18`,
                color: borderColor,
                whiteSpace: 'nowrap',
              }}
            >
              {STATUS_LABELS[status]}
            </span>
            {chat.unread_count > 0 && (
              <span
                className="flex items-center justify-center"
                style={{
                  minWidth: 18,
                  height: 18,
                  padding: '0 5px',
                  borderRadius: 9,
                  fontSize: 11,
                  fontWeight: 700,
                  background: 'var(--blue)',
                  color: '#fff',
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

/* ─── Tab Bar ──────────────────────────────────────────── */

function TabBar({ active, onSelect, unreadCounts }) {
  return (
    <div
      className="flex gap-1 px-4 pb-2"
      style={{ borderBottom: '0.5px solid var(--border-norse)' }}
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const color = TAB_COLORS[tab.key];
        return (
          <button
            key={tab.key}
            onClick={() => onSelect(tab.key)}
            className="relative flex items-center justify-center gap-1 px-3 py-1.5 rounded-t-lg transition-all"
            style={{
              fontSize: 13,
              fontWeight: isActive ? 700 : 500,
              color: isActive ? color : 'var(--text-tertiary)',
              background: isActive ? `${color}15` : 'transparent',
              borderBottom: isActive ? `2px solid ${color}` : '2px solid transparent',
            }}
          >
            {tab.label}
            {unreadCounts[tab.key] > 0 && (
              <span
                style={{
                  minWidth: 16,
                  height: 16,
                  padding: '0 4px',
                  borderRadius: 8,
                  fontSize: 10,
                  fontWeight: 700,
                  background: tab.key === 'estimates' ? '#D4A843' : 'var(--blue)',
                  color: '#fff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {unreadCounts[tab.key] > 99 ? '99+' : unreadCounts[tab.key]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Main Chat Page ──────────────────────────────────── */

export default function Chat() {
  const { chats, loading, search, setSearch, updateChat } = useChat();
  const [newChatOpen, setNewChatOpen] = useState(false);
  const haptic = useHaptic();

  // Tab state (persisted to localStorage)
  const [activeTab, setActiveTab] = useState(() =>
    localStorage.getItem('huginn_chat_tab') || 'all'
  );

  // Split & sort chats
  const { estimateChats, personalChats } = useMemo(() => {
    const est = [];
    const pers = [];
    chats.forEach((c) => {
      if (c.entity_type === 'estimate') est.push(c);
      else pers.push(c);
    });
    // Sort estimates: active (sent/rework/question) → approved → draft
    est.sort((a, b) => {
      const sa = ESTIMATE_STATUS_ORDER[guessEstimateStatus(a)] ?? 99;
      const sb = ESTIMATE_STATUS_ORDER[guessEstimateStatus(b)] ?? 99;
      return sa - sb;
    });
    return { estimateChats: est, personalChats: pers };
  }, [chats]);

  // Unread counts per tab
  const unreadCounts = useMemo(() => {
    let estUnread = 0;
    let persUnread = 0;
    chats.forEach((c) => {
      if (c.entity_type === 'estimate') estUnread += c.unread_count || 0;
      else persUnread += c.unread_count || 0;
    });
    return { all: estUnread + persUnread, estimates: estUnread, personal: persUnread };
  }, [chats]);

  // Default tab = tab with max unread (first load only)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!loading && !initializedRef.current) {
      initializedRef.current = true;
      if (!localStorage.getItem('huginn_chat_tab')) {
        const maxTab = Object.entries(unreadCounts).reduce(
          (best, cur) => (cur[1] > best[1] ? cur : best),
          ['all', 0]
        )[0];
        setActiveTab(maxTab);
      }
    }
  }, [loading, unreadCounts]);

  // Persist tab choice
  useEffect(() => {
    localStorage.setItem('huginn_chat_tab', activeTab);
  }, [activeTab]);

  // ─── Swipe gestures ───
  const touchRef = useRef({ startX: 0, startY: 0, swiping: false, locked: false });
  const [swipeOffset, setSwipeOffset] = useState(0);
  const tabIndex = TABS.findIndex((t) => t.key === activeTab);

  const handleTouchStart = useCallback((e) => {
    touchRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      swiping: false,
      locked: false,
    };
    setSwipeOffset(0);
  }, []);

  const handleTouchMove = useCallback(
    (e) => {
      const t = touchRef.current;
      const dx = e.touches[0].clientX - t.startX;
      const dy = e.touches[0].clientY - t.startY;
      // Lock direction on first significant move
      if (!t.locked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        t.locked = true;
        t.swiping = Math.abs(dx) > Math.abs(dy);
      }
      if (t.swiping) {
        // Dampen at edges
        let clamped = dx;
        if (tabIndex === 0 && dx > 0) clamped = dx * 0.3;
        if (tabIndex === TABS.length - 1 && dx < 0) clamped = dx * 0.3;
        setSwipeOffset(clamped);
      }
    },
    [tabIndex]
  );

  const handleTouchEnd = useCallback(() => {
    if (touchRef.current.swiping) {
      const threshold = 50;
      if (swipeOffset > threshold && tabIndex > 0) {
        haptic.light();
        setActiveTab(TABS[tabIndex - 1].key);
      } else if (swipeOffset < -threshold && tabIndex < TABS.length - 1) {
        haptic.light();
        setActiveTab(TABS[tabIndex + 1].key);
      }
    }
    setSwipeOffset(0);
    touchRef.current.swiping = false;
  }, [swipeOffset, tabIndex, haptic]);

  // ─── SSE ───
  const handleSSE = useCallback(
    (event, data) => {
      if (event === 'new_message' && data.chat_id) {
        updateChat(data.chat_id, {
          last_message: data.message?.message || '',
          last_message_text: data.message?.message || '',
          last_message_sender: data.message?.user_name || '',
          last_message_type: data.message?.message_type || 'text',
          last_message_at: data.message?.created_at || new Date().toISOString(),
          unread_count:
            (chats.find((c) => c.id === data.chat_id)?.unread_count || 0) + 1,
        });
      }
    },
    [updateChat, chats]
  );

  useSSE(handleSSE);

  // ─── Render helpers ───
  const renderList = (items, type) => {
    if (items.length === 0) {
      return (
        <div className="flex items-center justify-center py-8">
          <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
            {search ? 'Ничего не найдено' : 'Нет чатов'}
          </p>
        </div>
      );
    }
    return items.map((chat) =>
      type === 'estimate' ? (
        <EstimateChatItem key={chat.id} chat={chat} />
      ) : (
        <ChatListItem key={chat.id} chat={chat} />
      )
    );
  };

  const tabContent = {
    all: (
      <>
        {estimateChats.length > 0 && renderList(estimateChats, 'estimate')}
        {renderList(personalChats, 'personal')}
      </>
    ),
    estimates: renderList(estimateChats, 'estimate'),
    personal: renderList(personalChats, 'personal'),
  };

  return (
    <PageShell
      title="Хугинн"
      headerRight={
        <button
          onClick={() => {
            haptic.light();
            setNewChatOpen(true);
          }}
          className="flex items-center justify-center spring-tap btn-icon c-blue"
        >
          <Edit3 size={20} />
        </button>
      }
    >
      <div className="flex flex-col h-full">
        {/* Search */}
        <div className="px-4 pb-2 pt-1">
          <div
            className="flex items-center gap-2 px-3 rounded-xl"
            style={{
              height: 36,
              background: 'var(--bg-surface-alt)',
              border: '0.5px solid var(--border-norse)',
            }}
          >
            <Search size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Поиск чатов..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent outline-none text-[14px]"
              style={{ color: 'var(--text-primary)', caretColor: 'var(--gold)' }}
            />
          </div>
        </div>

        {/* Mimir pinned */}
        <MimirChatItem />

        {/* Tab bar */}
        <TabBar
          active={activeTab}
          onSelect={(key) => {
            haptic.light();
            setActiveTab(key);
          }}
          unreadCounts={unreadCounts}
        />

        {/* Swipeable tab panels */}
        <div
          className="flex-1 overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            style={{
              display: 'flex',
              width: '300%',
              height: '100%',
              transform: `translateX(calc(${-tabIndex * 100 / 3}% + ${swipeOffset}px))`,
              transition: swipeOffset !== 0 ? 'none' : 'transform 0.3s cubic-bezier(.4,0,.2,1)',
            }}
          >
            {TABS.map((tab) => (
              <div
                key={tab.key}
                className="scroll-container"
                style={{ width: '33.333%', height: '100%', overflowY: 'auto' }}
              >
                {loading ? (
                  <div className="px-4 pt-2">
                    <SkeletonList count={6} />
                  </div>
                ) : (
                  tabContent[tab.key]
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <NewChatSheet open={newChatOpen} onClose={() => setNewChatOpen(false)} />
    </PageShell>
  );
}
