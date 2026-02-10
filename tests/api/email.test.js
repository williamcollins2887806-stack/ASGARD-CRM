/**
 * EMAIL - Email sending + test
 */
const { api, assert } = require('../config');

module.exports = {
  name: 'EMAIL (Почта)',
  tests: [
    {
      name: 'ADMIN tests email config',
      run: async () => {
        const resp = await api('GET', '/api/email/test', { role: 'ADMIN' });
        // May fail if SMTP not configured - accept non-500
        assert(resp.status < 500, `email test: ${resp.status}`);
      }
    },
    {
      name: 'PM sends test email (may fail without SMTP)',
      run: async () => {
        const resp = await api('POST', '/api/email/send', {
          role: 'PM',
          body: {
            to: 'test@stage12.local',
            subject: 'Stage12 Test Email',
            body: 'This is an autotest email'
          }
        });
        // SMTP may not be configured - we just check it doesn't 500 crash
        assert(resp.status < 500, `send email: ${resp.status}`);
      }
    }
  ]
};
