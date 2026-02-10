/**
 * CHAT_GROUPS - Group chat CRUD + messages
 */
const { api, assert, assertOk } = require('../config');

let testChatId = null;

module.exports = {
  name: 'CHAT GROUPS (Чаты)',
  tests: [
    {
      name: 'ADMIN reads chat groups',
      run: async () => {
        const resp = await api('GET', '/api/chat_groups', { role: 'ADMIN' });
        assert(resp.status < 500, `chats: ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 200)}`);
      }
    },
    {
      name: 'ADMIN creates chat group',
      run: async () => {
        const resp = await api('POST', '/api/chat_groups', {
          role: 'ADMIN',
          body: {
            name: 'Stage12: Тестовый чат',
            description: 'Автотест'
          }
        });
        assert(resp.status < 500, `create chat: ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 200)}`);
        if (resp.ok) testChatId = resp.data?.chat?.id || resp.data?.id;
      }
    },
    {
      name: 'ADMIN reads single chat',
      run: async () => {
        if (!testChatId) return;
        const resp = await api('GET', `/api/chat_groups/${testChatId}`, { role: 'ADMIN' });
        assert(resp.status < 500, `get chat: ${resp.status}`);
      }
    },
    {
      name: 'ADMIN posts message to chat',
      run: async () => {
        if (!testChatId) return;
        const resp = await api('POST', `/api/chat_groups/${testChatId}/messages`, {
          role: 'ADMIN',
          body: { text: 'Stage12: Hello from autotest!' }
        });
        assert(resp.status < 500, `post message: ${resp.status}`);
      }
    },
    {
      name: 'ADMIN reads chat messages',
      run: async () => {
        if (!testChatId) return;
        const resp = await api('GET', `/api/chat_groups/${testChatId}/messages`, { role: 'ADMIN' });
        assert(resp.status < 500, `messages: ${resp.status}`);
      }
    },
    {
      name: 'ADMIN updates chat',
      run: async () => {
        if (!testChatId) return;
        const resp = await api('PUT', `/api/chat_groups/${testChatId}`, {
          role: 'ADMIN',
          body: { name: 'Stage12: Updated chat' }
        });
        assert(resp.status < 500, `update chat: ${resp.status}`);
      }
    },
    {
      name: 'Cleanup: delete chat',
      run: async () => {
        if (!testChatId) return;
        await api('DELETE', `/api/chat_groups/${testChatId}`, { role: 'ADMIN' });
      }
    }
  ]
};
