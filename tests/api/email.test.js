/**
 * EMAIL - Email sending + test
 */
const {api, assert, assertOk, skip} = require('../config');

module.exports = {
  name: 'EMAIL (Почта)',
  tests: [
    {
      name: 'ADMIN tests email config',
      run: async () => {
        const resp = await api('GET', '/api/email/history', { role: 'ADMIN' });
        if (resp.status === 404) skip('Email history endpoint not available');
        assertOk(resp, 'email history');
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
        if (resp.status === 404) skip('Email send endpoint not available');
        assertOk(resp, 'send email');
      }
    }
  ]
};
