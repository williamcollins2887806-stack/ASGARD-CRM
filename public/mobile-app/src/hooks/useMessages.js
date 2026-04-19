import { useState, useCallback, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/api/client';

/**
 * useMessages — сообщения чата + optimistic send + SSE handler
 */
export function useMessages(chatId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasOlder, setHasOlder] = useState(true);
  const userId = useAuthStore((s) => s.user?.id);
  const loadingRef = useRef(false);

  const loadMessages = useCallback(async () => {
    if (!chatId) return;
    try {
      const data = await api.get(`/chat-groups/${chatId}/messages?limit=50`);
      const msgs = data.messages || api.extractRows(data);
      setMessages(msgs);
      setHasOlder(msgs.length >= 50);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  const loadOlder = useCallback(async () => {
    if (!hasOlder || loadingRef.current || messages.length === 0) return;
    loadingRef.current = true;
    try {
      const oldest = messages[0]?.id;
      const data = await api.get(
        `/chat-groups/${chatId}/messages?limit=30&before_id=${oldest}`
      );
      const older = data.messages || api.extractRows(data);
      if (older.length < 30) setHasOlder(false);
      setMessages((prev) => [...older, ...prev]);
    } catch {}
    loadingRef.current = false;
  }, [chatId, hasOlder, messages]);

  const sendMessage = useCallback(
    async (text, replyToId) => {
      const tempId = `temp-${Date.now()}`;
      const optimistic = {
        id: tempId,
        user_id: userId,
        user_name: '',
        message: text,
        message_type: 'text',
        created_at: new Date().toISOString(),
        is_read: false,
        _sending: true,
        reply_to: replyToId || null,
      };
      setMessages((prev) => [...prev, optimistic]);

      try {
        const res = await api.post(`/chat-groups/${chatId}/messages`, {
          text,
          reply_to_id: replyToId || undefined,
        });
        const msg = res.message || res;
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...msg, _sending: false } : m))
        );
        return msg;
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId ? { ...m, _sending: false, _failed: true } : m
          )
        );
      }
    },
    [chatId, userId]
  );

  const handleSSE = useCallback(
    (event, data) => {
      if (String(data.chat_id) !== String(chatId)) return;

      switch (event) {
        case 'new_message':
          if (data.message && data.message.user_id !== userId) {
            setMessages((prev) => [...prev, data.message]);
          }
          break;
        case 'message_edited':
          if (data.message) {
            setMessages((prev) =>
              prev.map((m) =>
                String(m.id) === String(data.message.id)
                  ? { ...m, ...data.message }
                  : m
              )
            );
          }
          break;
        case 'message_deleted':
          setMessages((prev) =>
            prev.map((m) =>
              String(m.id) === String(data.message_id)
                ? { ...m, deleted_at: new Date().toISOString() }
                : m
            )
          );
          break;
        case 'reaction':
          if (data.message_id && data.reactions) {
            setMessages((prev) =>
              prev.map((m) =>
                String(m.id) === String(data.message_id)
                  ? { ...m, reactions: data.reactions }
                  : m
              )
            );
          }
          break;
      }
    },
    [chatId, userId]
  );

  const addReaction = useCallback(
    async (messageId, emoji) => {
      try {
        await api.post(
          `/chat-groups/${chatId}/messages/${messageId}/reaction`,
          { emoji }
        );
      } catch {}
    },
    [chatId]
  );

  const deleteMessage = useCallback(
    async (messageId) => {
      setMessages((prev) =>
        prev.map((m) =>
          String(m.id) === String(messageId)
            ? { ...m, deleted_at: new Date().toISOString() }
            : m
        )
      );
      try {
        await api.delete(`/chat-groups/${chatId}/messages/${messageId}`);
      } catch {}
    },
    [chatId]
  );

  const editMessage = useCallback(
    async (messageId, text) => {
      setMessages((prev) =>
        prev.map((m) =>
          String(m.id) === String(messageId)
            ? { ...m, message: text, edited_at: new Date().toISOString() }
            : m
        )
      );
      try {
        await api.put(`/chat-groups/${chatId}/messages/${messageId}`, { text });
      } catch {}
    },
    [chatId]
  );

  return {
    messages,
    loading,
    hasOlder,
    loadMessages,
    loadOlder,
    sendMessage,
    handleSSE,
    addReaction,
    deleteMessage,
    editMessage,
  };
}
