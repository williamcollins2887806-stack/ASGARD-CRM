/**
 * MAILBOX - IMAP inbox checking
 */
const { api, assert } = require('../config');

module.exports = {
  name: 'MAILBOX (Входящая почта)',
  tests: [
    {
      name: 'ADMIN reads mailbox status',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/status', { role: 'ADMIN' });
        assert(resp.status < 500, `mailbox status: ${resp.status}`);
      }
    },
    {
      name: 'ADMIN reads inbox emails',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/inbox', { role: 'ADMIN' });
        assert(resp.status < 500, `inbox: ${resp.status}`);
      }
    }
  ]
};
