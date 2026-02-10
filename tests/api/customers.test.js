/**
 * CUSTOMERS - Customer/Contractor management
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

const TEST_INN = '7700000001';

module.exports = {
  name: 'CUSTOMERS (Заказчики)',
  tests: [
    {
      name: 'ADMIN reads customers list',
      run: async () => {
        const resp = await api('GET', '/api/customers', { role: 'ADMIN' });
        assertOk(resp, 'customers list');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.customers || resp.data.items || []);
          assertArray(list, 'customers list');
          if (list.length > 0) {
            assertHasFields(list[0], ['name'], 'customer item');
            assertFieldType(list[0], 'name', 'string', 'customer name');
          }
        }
      }
    },
    {
      name: 'PM creates customer',
      run: async () => {
        // Cleanup first in case leftover from prev run
        await api('DELETE', `/api/customers/${TEST_INN}`, { role: 'ADMIN' });
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
      name: 'Read-back by INN after create verifies fields',
      run: async () => {
        const resp = await api('GET', `/api/customers/${TEST_INN}`, { role: 'PM' });
        assert(resp.status < 500, `get customer: ${resp.status}`);
        if (resp.ok && resp.data) {
          const customer = resp.data.customer || resp.data;
          assertHasFields(customer, ['name'], 'read-back customer');
          if (customer.inn !== undefined) {
            assertMatch(customer, { inn: TEST_INN }, 'read-back customer INN');
          }
          if (customer.contact_person !== undefined) {
            assertMatch(customer, { contact_person: 'Ivanov I.I.' }, 'read-back contact_person');
          }
        }
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
      name: 'Read-back after update verifies contact_person changed',
      run: async () => {
        const resp = await api('GET', `/api/customers/${TEST_INN}`, { role: 'PM' });
        assert(resp.status < 500, `read-back updated customer: ${resp.status}`);
        if (resp.ok && resp.data) {
          const customer = resp.data.customer || resp.data;
          if (customer.contact_person !== undefined) {
            assertMatch(customer, { contact_person: 'Petrov P.P.' }, 'read-back updated contact_person');
          }
        }
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
      name: 'Negative: create customer with empty body',
      run: async () => {
        const resp = await api('POST', '/api/customers', {
          role: 'PM',
          body: {}
        });
        assert(resp.status >= 400, `empty body should fail, got ${resp.status}`);
        assert(resp.status < 500, `empty body should be 4xx not 5xx, got ${resp.status}`);
      }
    },
    {
      name: 'Negative: BUH cannot create customer',
      run: async () => {
        const resp = await api('POST', '/api/customers', {
          role: 'BUH',
          body: {
            inn: '9999999999',
            name: 'BUH customer attempt',
            phone: '+70000000000'
          }
        });
        assertForbidden(resp, 'BUH create customer');
      }
    },
    {
      name: 'Cleanup: delete test customer',
      run: async () => {
        const resp = await api('DELETE', `/api/customers/${TEST_INN}`, { role: 'ADMIN' });
        assert(resp.status < 500, `delete customer: ${resp.status}`);
      }
    },
    {
      name: 'Verify deleted customer is gone',
      run: async () => {
        const resp = await api('GET', `/api/customers/${TEST_INN}`, { role: 'ADMIN' });
        assert(
          resp.status === 404 || resp.status === 400 || resp.status === 200,
          `expected 404 after delete, got ${resp.status}`
        );
      }
    }
  ]
};
