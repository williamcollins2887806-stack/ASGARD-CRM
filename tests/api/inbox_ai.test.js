/**
 * INBOX_APPLICATIONS_AI - AI-powered inbox application processing
 */
const {api, assert, assertOk, skip} = require('../config');

module.exports = {
  name: 'INBOX AI (AI Заявки)',
  tests: [
    {
      name: 'ADMIN reads inbox applications',
      run: async () => {
        const resp = await api('GET', '/api/inbox-applications', { role: 'ADMIN' });
        if (resp.status === 404) skip('inbox-applications not available');
        assertOk(resp, 'inbox apps');
      }
    },
    {
      name: 'ADMIN reads inbox AI status',
      run: async () => {
        const resp = await api('GET', '/api/inbox-applications/stats/summary', { role: 'ADMIN' });
        if (resp.status === 404) skip('inbox-applications/stats/summary not available');
        assertOk(resp, 'inbox ai status');
      }
    },
    {
      name: 'TO reads inbox applications',
      run: async () => {
        const resp = await api('GET', '/api/inbox-applications', { role: 'TO' });
        if (resp.status === 404) skip('inbox-applications not available');
        assertOk(resp, 'TO inbox apps');
      }
    }
  ]
};
