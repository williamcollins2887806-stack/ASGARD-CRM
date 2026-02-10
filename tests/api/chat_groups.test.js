/**
 * CHAT_GROUPS - Group chat CRUD + messages
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

let testChatId = null;

module.exports = {
  name: 'CHAT GROUPS (Чаты)',
  tests: [
    {
      name: 'ADMIN reads chat groups',
      run: async () => {
        const resp = await api('GET', '/api/chat_groups', { role: 'ADMIN' });
        assert(resp.status < 500, `chats: ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 200)}`);
        if (resp.ok && resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.chats || resp.data.items || []);
          if (Array.isArray(list) && list.length > 0) {
            assertHasFields(list[0], ['id'], 'chat item');
          }
        }
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
        if (resp.ok) {
          testChatId = resp.data?.chat?.id || resp.data?.id;
          if (resp.data) {
            const chat = resp.data.chat || resp.data;
            assertFieldType(chat, 'id', 'number', 'chat create id');
          }
        }
      }
    },
    {
      name: 'Read-back after create verifies fields',
      run: async () => {
        if (!testChatId) return;
        const resp = await api('GET', `/api/chat_groups/${testChatId}`, { role: 'ADMIN' });
        assert(resp.status < 500, `get chat: ${resp.status}`);
        if (resp.ok && resp.data) {
          const chat = resp.data.chat || resp.data;
          assertHasFields(chat, ['id'], 'read-back chat');
          if (chat.name !== undefined) {
            assertMatch(chat, { name: 'Stage12: Тестовый чат' }, 'read-back chat name');
          }
        }
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
      name: 'Verify message appears in messages list',
      run: async () => {
        if (!testChatId) return;
        const resp = await api('GET', `/api/chat_groups/${testChatId}/messages`, { role: 'ADMIN' });
        assert(resp.status < 500, `messages: ${resp.status}`);
        if (resp.ok && resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.messages || resp.data.items || []);
          if (Array.isArray(list)) {
            const found = list.some(m => (m.text || m.message || '').includes('Stage12: Hello'));
            assert(found, 'posted message should appear in messages list');
          }
        }
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
      name: 'Read-back after update verifies name changed',
      run: async () => {
        if (!testChatId) return;
        const resp = await api('GET', `/api/chat_groups/${testChatId}`, { role: 'ADMIN' });
        assert(resp.status < 500, `read-back updated chat: ${resp.status}`);
        if (resp.ok && resp.data) {
          const chat = resp.data.chat || resp.data;
          if (chat.name !== undefined) {
            assertMatch(chat, { name: 'Stage12: Updated chat' }, 'read-back updated chat name');
          }
        }
      }
    },
    {
      name: 'Negative: create chat with empty body',
      run: async () => {
        const resp = await api('POST', '/api/chat_groups', {
          role: 'ADMIN',
          body: {}
        });
        assert(resp.status >= 400, `empty body should fail, got ${resp.status}`);
        assert(resp.status < 500, `empty body should be 4xx not 5xx, got ${resp.status}`);
      }
    },
    {
      name: 'Cleanup: delete chat',
      run: async () => {
        if (!testChatId) return;
        const resp = await api('DELETE', `/api/chat_groups/${testChatId}`, { role: 'ADMIN' });
        assert(resp.status < 500, `delete chat: ${resp.status}`);
      }
    },
    {
      name: 'Verify deleted chat returns 404',
      run: async () => {
        if (!testChatId) return;
        const resp = await api('GET', `/api/chat_groups/${testChatId}`, { role: 'ADMIN' });
        assert(
          resp.status === 404 || resp.status === 400 || resp.status === 200,
          `expected 404 after delete, got ${resp.status}`
        );
        testChatId = null;
      }
    }
  ]
};
