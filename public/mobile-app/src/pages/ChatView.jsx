import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/stores/chatStore';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { MessageList } from '@/components/chat/MessageList';
import { Composer } from '@/components/chat/Composer';
import { EditMessageSheet } from '@/components/chat/EditMessageSheet';
import { ForwardSheet } from '@/components/chat/ForwardSheet';
import { useMessages } from '@/hooks/useMessages';
import { useTyping } from '@/hooks/useTyping';
import { useSSE } from '@/hooks/useSSE';

/**
 * ChatView — открытый чат
 */
export default function ChatView() {
  const { chatId } = useParams();
  const [chat, setChat] = useState(null);
  const [members, setMembers] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [forwardMsg, setForwardMsg] = useState(null);
  const userId = useAuthStore((s) => s.user?.id);
  const markChatRead = useChatStore((s) => s.markChatRead);
  const firstUnreadIdRef = useRef(null);
  const [firstUnreadId, setFirstUnreadId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const {
    messages,
    loading,
    hasOlder,
    loadMessages,
    loadOlder,
    sendMessage,
    handleSSE: handleMsgSSE,
    addReaction,
    deleteMessage,
    editMessage,
  } = useMessages(chatId);

  const { typingUsers, sendTyping, handleTypingEvent } = useTyping(chatId);

  // Load chat details
  useEffect(() => {
    if (!chatId) return;
    (async () => {
      try {
        const res = await api.get(`/chat-groups/${chatId}`);
        setChat(res.chat || res);
        setMembers(res.members || []);
      } catch {}
    })();
  }, [chatId]);

  // Load messages + track first unread
  useEffect(() => {
    if (!chatId) return;
    (async () => {
      await loadMessages();
    })();
    // Mark chat as read — API + глобальный store (TabBar badge)
    api.post(`/chat-groups/${chatId}/read`).catch(() => {});
    markChatRead(chatId);
    // Сбросить firstUnreadId при смене чата
    firstUnreadIdRef.current = null;
    setFirstUnreadId(null);
  }, [chatId, loadMessages, markChatRead]);

  // Определяем первое непрочитанное после загрузки
  useEffect(() => {
    if (loading || messages.length === 0 || firstUnreadIdRef.current) return;
    // Первое сообщение не от себя и без is_read — первое непрочитанное
    // Используем поле is_read или сравниваем по last_read_at (нет в теле)
    // Простая эвристика: последние N сообщений не от себя с is_read=false
    const firstUnread = messages.find(
      (m) => !m.is_read && m.user_id !== userId && !m.deleted_at
    );
    if (firstUnread) {
      firstUnreadIdRef.current = firstUnread.id;
      setFirstUnreadId(firstUnread.id);
    }
  }, [loading, messages]);

  // SSE handler
  const handleSSE = useCallback(
    (event, data) => {
      if (event === 'typing') {
        handleTypingEvent(data);
      } else {
        handleMsgSSE(event, data);
      }
    },
    [handleMsgSSE, handleTypingEvent]
  );

  useSSE(handleSSE);

  const handleReply = useCallback((msg) => setReplyTo(msg), []);
  const handleForward = useCallback((msg) => setForwardMsg(msg), []);

  const handleSend = useCallback(
    (text, replyId) => {
      sendMessage(text, replyId);
    },
    [sendMessage]
  );

  return (
    <div className="flex flex-col h-full bg-primary">
      <ChatHeader chat={chat} members={members} onSearch={setSearchQuery} />

      <MessageList
        messages={messages}
        loading={loading}
        hasOlder={hasOlder}
        onLoadOlder={loadOlder}
        onReply={handleReply}
        onReaction={addReaction}
        onDelete={deleteMessage}
        onEdit={(msg) => setEditingMsg(msg)}
        onForward={handleForward}
        typingUsers={typingUsers}
        firstUnreadId={firstUnreadId}
        searchQuery={searchQuery}
      />

      <Composer
        chatId={chatId}
        onSend={handleSend}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onTyping={sendTyping}
        onFileUploaded={loadMessages}
      />

      {editingMsg && (
        <EditMessageSheet
          message={editingMsg}
          onSave={editMessage}
          onClose={() => setEditingMsg(null)}
        />
      )}

      {forwardMsg && (
        <ForwardSheet
          message={forwardMsg}
          onClose={() => setForwardMsg(null)}
          onForwarded={() => setForwardMsg(null)}
        />
      )}
    </div>
  );
}
