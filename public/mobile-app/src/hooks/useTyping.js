import { useState, useRef, useCallback } from 'react';
import { api } from '@/api/client';

/**
 * useTyping — typing indicator с debounce
 */
export function useTyping(chatId) {
  const [typingUsers, setTypingUsers] = useState([]);
  const lastSent = useRef(0);

  const sendTyping = useCallback(() => {
    if (!chatId) return;
    if (Date.now() - lastSent.current < 2000) return;
    lastSent.current = Date.now();
    api.post(`/chat-groups/${chatId}/typing`).catch(() => {});
  }, [chatId]);

  const handleTypingEvent = useCallback(
    (data) => {
      if (String(data.chat_id) !== String(chatId)) return;
      setTypingUsers((prev) => {
        const filtered = prev.filter((u) => u.user_id !== data.user_id);
        return [...filtered, { ...data, ts: Date.now() }];
      });
      setTimeout(() => {
        setTypingUsers((prev) => prev.filter((u) => Date.now() - u.ts < 4000));
      }, 4100);
    },
    [chatId]
  );

  return { typingUsers, sendTyping, handleTypingEvent };
}
