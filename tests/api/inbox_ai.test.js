/**
 * INBOX_APPLICATIONS_AI - AI-powered inbox application processing
 */
const { api, assert } = require('../config');

module.exports = {
  name: 'INBOX AI (AI Заявки)',
  tests: [
    {
      name: 'ADMIN reads inbox applications',
      run: async () => {
        const resp = await api('GET', '/api/inbox-ai/applications', { role: 'ADMIN' });
        assert(resp.status < 500, `inbox apps: ${resp.status}`);
      }
    },
    {
      name: 'ADMIN reads inbox AI status',
      run: async () => {
        const resp = await api('GET', '/api/inbox-ai/status', { role: 'ADMIN' });
        assert(resp.status < 500, `inbox ai status: ${resp.status}`);
      }
    },
    {
      name: 'TO reads inbox applications',
      run: async () => {
        const resp = await api('GET', '/api/inbox-ai/applications', { role: 'TO' });
        assert(resp.status < 500, `TO inbox apps: ${resp.status}`);
      }
    }
  ]
};
