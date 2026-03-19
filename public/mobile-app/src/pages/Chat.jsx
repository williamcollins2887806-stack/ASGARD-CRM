import { useState, useCallback } from 'react';
import { Edit3 } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { ChatList } from '@/components/chat/ChatList';
import { NewChatSheet } from '@/components/chat/NewChatSheet';
import { useChat } from '@/hooks/useChat';
import { useSSE } from '@/hooks/useSSE';
import { useHaptic } from '@/hooks/useHaptic';

/**
 * Chat — экран списка чатов + SSE для real-time обновлений
 */
export default function Chat() {
  const { chats, loading, search, setSearch, updateChat } = useChat();
  const [newChatOpen, setNewChatOpen] = useState(false);
  const haptic = useHaptic();

  // SSE: обновляем last_message и unread в списке
  const handleSSE = useCallback(
    (event, data) => {
      if (event === 'new_message' && data.chat_id) {
        updateChat(data.chat_id, {
          last_message: data.message?.message || '',
          last_message_at: data.message?.created_at || new Date().toISOString(),
          unread_count:
            (chats.find((c) => c.id === data.chat_id)?.unread_count || 0) + 1,
        });
      }
    },
    [updateChat, chats]
  );

  useSSE(handleSSE);

  return (
    <PageShell
      title="Хугинн"
      headerRight={
        <button
          onClick={() => {
            haptic.light();
            setNewChatOpen(true);
          }}
          className="flex items-center justify-center spring-tap"
          style={{ width: 44, height: 44, color: 'var(--blue)' }}
        >
          <Edit3 size={20} />
        </button>
      }
    >
      <ChatList
        chats={chats}
        loading={loading}
        search={search}
        onSearch={setSearch}
      />
      <NewChatSheet open={newChatOpen} onClose={() => setNewChatOpen(false)} />
    </PageShell>
  );
}
