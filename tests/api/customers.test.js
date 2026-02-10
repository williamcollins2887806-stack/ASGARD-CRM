/**
 * CUSTOMERS - Customer/Contractor management
 */
const { api, assert, assertOk } = require('../config');

const TEST_INN = '7700000001';

module.exports = {
  name: 'CUSTOMERS (Заказчики)',
  tests: [
    {
      name: 'ADMIN reads customers list',
      run: async () => {
        const resp = await api('GET', '/api/customers', { role: 'ADMIN' });
        assertOk(resp, 'customers list');
      }
    },
    {
      name: 'PM creates customer',
      run: async () => {
        const resp = await api('POST', '/api/customers', {
          role: 'PM',
          body: {
            inn: TEST_INN,
            name: 'Stage12 Test Customer LLC',
            full_name: 'OOO Stage12 Test Customer',
            phone: '+79991234567',
            email: 'test@stage12.local',
            contact_person: 'Ivanov I.I.'
          }
        });
        assert(resp.status < 500, `create customer: ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 200)}`);
      }
    },
    {
      name: 'PM reads customer by INN',
      run: async () => {
        const resp = await api('GET', `/api/customers/${TEST_INN}`, { role: 'PM' });
        assert(resp.status < 500, `get customer: ${resp.status}`);
      }
    },
    {
      name: 'PM updates customer',
      run: async () => {
        const resp = await api('PUT', `/api/customers/${TEST_INN}`, {
          role: 'PM',
          body: { contact_person: 'Petrov P.P.' }
        });
        assert(resp.status < 500, `update customer: ${resp.status}`);
      }
    },
    {
      name: 'TO reads customers',
      run: async () => {
        const resp = await api('GET', '/api/customers', { role: 'TO' });
        assertOk(resp, 'TO customers');
      }
    },
    {
      name: 'Cleanup: delete test customer',
      run: async () => {
        await api('DELETE', `/api/customers/${TEST_INN}`, { role: 'ADMIN' });
      }
    }
  ]
};
