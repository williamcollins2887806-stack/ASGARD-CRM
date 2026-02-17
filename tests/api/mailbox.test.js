/**
 * MAILBOX - IMAP inbox checking
 */
const {api, assert, assertOk, skip} = require('../config');

module.exports = {
  name: 'MAILBOX (Входящая почта)',
  tests: [
    {
      name: 'ADMIN reads mailbox status',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/stats', { role: 'ADMIN' });
        if (resp.status === 404) skip('mailbox/stats not available');
        assertOk(resp, 'mailbox status');
      }
    },
    {
      name: 'ADMIN reads inbox emails',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails', { role: 'ADMIN' });
        if (resp.status === 404) skip('mailbox/emails not available');
        assertOk(resp, 'inbox');
      }
    }
  ]
};
