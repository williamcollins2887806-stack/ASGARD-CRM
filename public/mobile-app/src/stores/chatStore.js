import { create } from 'zustand';

/**
 * chatStore — глобальное состояние мессенджера
 *
 * unreadTotal — суммарный счётчик для TabBar-бейджа
 * chatUnreads — per-chat счётчик { [chatId]: number }
 *
 * Поток данных:
 *   1. useChat загрузил список → initFromChats → инициализирует оба
 *   2. Глобальный SSE в AppLayout → incrementChat для других чатов
 *   3. ChatView открыт → markChatRead → badge уменьшается немедленно
 */
export const useChatStore = create((set) => ({
  unreadTotal: 0,
  chatUnreads: {},

  // Перезаписать всё после загрузки списка чатов
  initFromChats: (chats) => {
    const unreads = {};
    let total = 0;
    chats.forEach((c) => {
      unreads[String(c.id)] = c.unread_count || 0;
      total += c.unread_count || 0;
    });
    set({ chatUnreads: unreads, unreadTotal: total });
  },

  // Устаревший метод (обратная совместимость — Chat.jsx вызывал setUnreadTotal напрямую)
  setUnreadTotal: (n) => set({ unreadTotal: n }),

  // Новое сообщение в чате chatId (от другого пользователя)
  incrementChat: (chatId) =>
    set((s) => {
      const id = String(chatId);
      return {
        chatUnreads: { ...s.chatUnreads, [id]: (s.chatUnreads[id] || 0) + 1 },
        unreadTotal: s.unreadTotal + 1,
      };
    }),

  // Пользователь открыл чат — сброс его непрочитанных
  markChatRead: (chatId) =>
    set((s) => {
      const id = String(chatId);
      const prev = s.chatUnreads[id] || 0;
      if (prev === 0) return {};
      return {
        chatUnreads: { ...s.chatUnreads, [id]: 0 },
        unreadTotal: Math.max(0, s.unreadTotal - prev),
      };
    }),
}));
