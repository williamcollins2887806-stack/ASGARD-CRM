import { create } from 'zustand';
import { api } from '@/api/client';

export const useAuthStore = create((set, get) => ({
  user: null,
  token: localStorage.getItem('asgard_token') || null,
  loading: true,
  error: null,
  // PIN flow: null | 'need_pin' | 'need_setup'
  pinStatus: null,

  login: async (login, password) => {
    try {
      set({ loading: true, error: null, pinStatus: null });
      const data = await api.post('/auth/login', { login, password });
      const token = data.token;
      api.setToken(token);

      if (data.status === 'need_pin') {
        // Token is limited (pinVerified: false), need PIN screen
        set({
          token,
          user: data.user || null,
          pinStatus: 'need_pin',
          loading: false,
        });
        return { status: 'need_pin' };
      }

      if (data.status === 'need_setup') {
        set({
          token,
          user: data.user || null,
          pinStatus: 'need_setup',
          loading: false,
        });
        return { status: 'need_setup' };
      }

      // status: 'ok' — full access
      set({ token, user: data.user || null, pinStatus: null, loading: false });
      // Also fetch full profile
      await get().fetchUser();
      return { status: 'ok' };
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  verifyPin: async (pin) => {
    try {
      set({ loading: true, error: null });
      const data = await api.post('/auth/verify-pin', { pin });
      const token = data.token;
      api.setToken(token);
      set({
        token,
        user: data.user || get().user,
        pinStatus: null,
        loading: false,
      });
      // Fetch full profile with permissions
      await get().fetchUser();
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  fetchUser: async () => {
    try {
      set({ loading: true });
      const response = await api.get('/auth/me');
      // API returns { user: { ... } }
      const user = response.user || response;
      set({ user, loading: false });
    } catch {
      set({ user: null, token: null, pinStatus: null, loading: false });
      api.clearToken();
    }
  },

  logout: () => {
    api.clearToken();
    set({ user: null, token: null, pinStatus: null, error: null });
  },
}));
