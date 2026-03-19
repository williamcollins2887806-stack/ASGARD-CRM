import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api/client';

/**
 * useChat — загрузка списка чатов + поиск
 */
export function useChat() {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchChats = useCallback(async () => {
    try {
      const res = await api.get('/chat-groups');
      const rows = api.extractRows(res);
      setChats(rows);
    } catch {
      setChats([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  const filtered = search.trim()
    ? chats.filter((c) => {
        const q = search.toLowerCase();
        return (
          (c.name || '').toLowerCase().includes(q) ||
          (c.last_message || '').toLowerCase().includes(q)
        );
      })
    : chats;

  // Sort: last_message_at desc, unread first
  const sorted = [...filtered].sort((a, b) => {
    const da = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const db = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return db - da;
  });

  return {
    chats: sorted,
    loading,
    search,
    setSearch,
    refetch: fetchChats,
    updateChat: (chatId, updates) => {
      setChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, ...updates } : c))
      );
    },
  };
}
