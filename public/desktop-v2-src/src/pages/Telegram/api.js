/* API для /telegram — настройки бота, привязка юзеров, отправка сообщений.
 * Бэкенд: src/routes/telegram.js (ADMIN-only, кроме /send — ADMIN/PM/HEAD_PM).
 * bot_token никогда не возвращается в открытом виде — только маска `...wxyz`.
 */
import { api } from '@/api/client';

export const fetchSettings   = ()           => api('/api/telegram/settings');
export const saveSettings    = (body)       => api('/api/telegram/settings', { method: 'PUT', body });
export const checkBot        = ()           => api('/api/telegram/check-bot');
export const loadUsers       = (search = '') => api('/api/telegram/users' + (search ? '?search=' + encodeURIComponent(search) : ''));
export const setChatId       = (id, chatId) => api('/api/telegram/users/' + id + '/chat-id', { method: 'PUT', body: { chat_id: chatId } });
export const testMessage     = (user_id, text) => api('/api/telegram/test-message', { method: 'POST', body: { user_id, text } });
export const sendMessage     = (to_user_id, text) => api('/api/telegram/send', { method: 'POST', body: { to_user_id, text } });
export const sendTempPassword = (userId) => api('/api/auth/send-telegram-password', { method: 'POST', body: { userId } });
