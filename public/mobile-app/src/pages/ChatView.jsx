import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '@/api/client';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { MessageList } from '@/components/chat/MessageList';
import { Composer } from '@/components/chat/Composer';
import { EditMessageSheet } from '@/components/chat/EditMessageSheet';
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
    loadMessages();
  }, [chatId, loadMessages]);

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

  const handleReply = useCallback((msg) => {
    setReplyTo(msg);
  }, []);

  const handleSend = useCallback(
    (text, replyId) => {
      sendMessage(text, replyId);
    },
    [sendMessage]
  );

  return (
    <div
      className="flex flex-col h-full bg-primary"
    >
      <ChatHeader chat={chat} members={members} />

      <MessageList
        messages={messages}
        loading={loading}
        hasOlder={hasOlder}
        onLoadOlder={loadOlder}
        onReply={handleReply}
        onReaction={addReaction}
        onDelete={deleteMessage}
        onEdit={(msg) => setEditingMsg(msg)}
        typingUsers={typingUsers}
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
    </div>
  );
}
