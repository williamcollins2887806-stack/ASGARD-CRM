import { create } from 'zustand';

export const useThemeStore = create((set) => ({
  theme: localStorage.getItem('asgard_theme') || 'dark',

  toggleTheme: () => {
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('asgard_theme', next);
      document.documentElement.classList.toggle('light', next === 'light');
      return { theme: next };
    });
  },

  initTheme: () => {
    const saved = localStorage.getItem('asgard_theme') || 'dark';
    document.documentElement.classList.toggle('light', saved === 'light');
    set({ theme: saved });
  },
}));
