import { create } from 'zustand';

/**
 * chatStore — глобальное состояние мессенджера
 * Минимальный стор для cross-page shared state
 */
export const useChatStore = create((set) => ({
  unreadTotal: 0,
  setUnreadTotal: (n) => set({ unreadTotal: n }),
}));
