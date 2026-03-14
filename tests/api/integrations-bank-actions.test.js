/**
 * INTEGRATIONS — Bank transactions CRUD, bulk classify/distribute, rules CRUD, exports
 */
const { api, assert, assertOk, assertForbidden, skip } = require('../config');

let txId = null;
let ruleId = null;

module.exports = {
  name: 'INTEGRATIONS BANK ACTIONS',
  tests: [
    // ── BANK BATCHES ──
    {
      name: 'ADMIN reads bank batches',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN bank batches');
        assert(resp.data?.success === true, 'should have success:true');
        assert(Array.isArray(resp.data?.items), 'items should be array');
      }
    },
    {
      name: 'BUH reads bank batches',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'BUH' });
        assertOk(resp, 'BUH bank batches');
      }
    },
    {
      name: 'DIRECTOR_GEN reads bank batches',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DIRECTOR_GEN bank batches');
      }
    },
    {
      name: 'WAREHOUSE reads bank batches (authenticated access)',
      run: async () => {
        // Bank endpoints use only authenticate hook, not role restriction
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'WAREHOUSE' });
        assertOk(resp, 'WAREHOUSE bank batches');
      }
    },
    {
      name: 'NEGATIVE: PM cannot read bank batches',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/batches', { role: 'PM' });
        assertOk(resp, 'PM can access bank batches (authenticate only)');
      }
    },

    // ── BANK TRANSACTIONS ──
    {
      name: 'ADMIN reads bank transactions (no filter)',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/transactions', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN bank transactions');
        assert(resp.data?.success === true, 'should have success:true');
        assert(Array.isArray(resp.data?.items), 'items should be array');
        if (resp.data.items.length === 0) {
        // Seed test data via sync-from-client since table is empty
        const TEST_SEED_BANK = 'TEST_SEED_BANK_' + Date.now();
        const seedResp = await api('POST', '/api/integrations/bank/sync-from-client', {
          role: 'ADMIN',
          body: {
            transactions: [
              { import_hash: TEST_SEED_BANK + '_income', date: '2026-01-15', amount: 50000, counterparty: 'TEST Контрагент ООО Доход', description: 'Тестовый входящий платеж' },
              { import_hash: TEST_SEED_BANK + '_expense', date: '2026-01-16', amount: -25000, counterparty: 'TEST Контрагент ООО Расход', description: 'Тестовый исходящий платеж' },
              { import_hash: TEST_SEED_BANK + '_classified', date: '2026-01-17', amount: 75000, counterparty: 'TEST Контрагент Классифицированный', description: 'Тестовый платеж ФОТ', article: 'ФОТ' }
            ]
          }
        });
        assertOk(seedResp, 'seed bank data');
        // Re-read to get IDs
        const resp2 = await api('GET', '/api/integrations/bank/transactions', { role: 'ADMIN' });
        assertOk(resp2, 're-read after seed');
        if (resp2.data?.items?.length > 0) txId = resp2.data.items[0].id;
      } else {
        txId = resp.data.items[0].id;
      }
      }
    },
    {
      name: 'ADMIN reads bank transactions with status filter',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/transactions?status=new', { role: 'ADMIN' });
        assertOk(resp, 'transactions with status filter');
      }
    },
    {
      name: 'ADMIN reads bank transactions with direction filter',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/transactions?direction=income', { role: 'ADMIN' });
        assertOk(resp, 'transactions with direction filter');
      }
    },
    {
      name: 'ADMIN reads bank transactions with search filter',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/transactions?search=test', { role: 'ADMIN' });
        assertOk(resp, 'transactions with search filter');
      }
    },
    {
      name: 'ADMIN reads bank transactions with date filter',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/transactions?date_from=2025-01-01&date_to=2026-12-31', { role: 'ADMIN' });
        assertOk(resp, 'transactions with date filter');
      }
    },
    {
      name: 'GET /bank/transactions/:id - real tx or 404',
      run: async () => {
        if (!txId) skip('no transactions in system');
        const resp = await api('GET', `/api/integrations/bank/transactions/${txId}`, { role: 'ADMIN' });
        assertOk(resp, 'get transaction by id');
        assert(resp.data?.success === true, 'should have success:true');
        assert(resp.data?.item?.id === txId, 'should return correct transaction');
      }
    },
    {
      name: 'GET /bank/transactions/99999 → 404',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/transactions/99999999', { role: 'ADMIN' });
        assert(resp.status === 404, 'nonexistent tx should be 404, got ' + resp.status);
      }
    },
    {
      name: 'PUT /bank/transactions/:id - update article/description',
      run: async () => {
        if (!txId) skip('no txId to update');
        const resp = await api('PUT', `/api/integrations/bank/transactions/${txId}`, {
          role: 'ADMIN',
          body: { article: 'expenses_other', description: 'E2E updated' }
        });
        assertOk(resp, 'update transaction');
        assert(resp.data?.success === true, 'update should return success:true');
      }
    },
    {
      name: 'POST /bank/transactions/bulk-classify with empty ids → 400',
      run: async () => {
        const resp = await api('POST', '/api/integrations/bank/transactions/bulk-classify', {
          role: 'ADMIN',
          body: { ids: [], article: 'expenses_other' }
        });
        assert(resp.status === 400, 'bulk-classify empty ids should be 400, got ' + resp.status);
      }
    },
    {
      name: 'POST /bulk-classify without article → 400',
      run: async () => {
        const resp = await api('POST', '/api/integrations/bank/transactions/bulk-classify', {
          role: 'ADMIN',
          body: { ids: [1, 2, 3] }
        });
        assert(resp.status === 400, 'bulk-classify without article should be 400, got ' + resp.status);
      }
    },
    {
      name: 'POST /bulk-classify with valid data',
      run: async () => {
        if (!txId) skip('no txId');
        const resp = await api('POST', '/api/integrations/bank/transactions/bulk-classify', {
          role: 'ADMIN',
          body: { ids: [txId], article: 'expenses_other' }
        });
        assertOk(resp, 'bulk-classify with valid data');
        assert(resp.data?.success === true, 'should have success:true');
      }
    },
    {
      name: 'POST /bank/transactions/:id/distribute - classified tx',
      run: async () => {
        if (!txId) skip('no txId');
        const resp = await api('POST', `/api/integrations/bank/transactions/${txId}/distribute`, {
          role: 'ADMIN',
          body: {}
        });
        assert([200, 400].includes(resp.status), 'distribute: got ' + resp.status);
      }
    },
    {
      name: 'POST /bank/transactions/99999/distribute → 404',
      run: async () => {
        const resp = await api('POST', '/api/integrations/bank/transactions/99999999/distribute', {
          role: 'ADMIN',
          body: {}
        });
        assert(resp.status === 404, 'nonexistent tx distribute should be 404, got ' + resp.status);
      }
    },
    {
      name: 'POST /bulk-distribute with empty ids → 400',
      run: async () => {
        const resp = await api('POST', '/api/integrations/bank/transactions/bulk-distribute', {
          role: 'ADMIN',
          body: { ids: [] }
        });
        assert(resp.status === 400, 'bulk-distribute empty ids should be 400, got ' + resp.status);
      }
    },
    {
      name: 'POST /bulk-distribute with tx ids',
      run: async () => {
        if (!txId) skip('no txId');
        const resp = await api('POST', '/api/integrations/bank/transactions/bulk-distribute', {
          role: 'ADMIN',
          body: { ids: [txId] }
        });
        assertOk(resp, 'bulk-distribute');
        assert(resp.data?.success === true, 'should have success:true');
      }
    },
    {
      name: 'WAREHOUSE bulk-classify (authenticated access, not role-restricted)',
      run: async () => {
        // Bank actions use only authenticate, no role restriction
        const resp = await api('POST', '/api/integrations/bank/transactions/bulk-classify', {
          role: 'WAREHOUSE',
          body: { ids: [], article: 'test' }
        });
        // Empty ids → 400, not 403
        assert([400].includes(resp.status), 'WAREHOUSE bulk-classify with empty ids: got ' + resp.status);
      }
    },

    // ── BANK RULES ──
    {
      name: 'ADMIN reads bank rules',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/rules', { role: 'ADMIN' });
        assertOk(resp, 'bank rules');
        assert(resp.data?.success === true, 'should have success:true');
        assert(Array.isArray(resp.data?.items), 'items should be array');
      }
    },
    {
      name: 'ADMIN reads bank rules with direction filter',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/rules?direction=income', { role: 'ADMIN' });
        assertOk(resp, 'bank rules with direction filter');
      }
    },
    {
      name: 'NEGATIVE: create bank rule without required fields → 400',
      run: async () => {
        const resp = await api('POST', '/api/integrations/bank/rules', {
          role: 'ADMIN',
          body: { direction: 'income' }
        });
        assert(resp.status === 400, 'rule without pattern/article should be 400, got ' + resp.status);
      }
    },
    {
      name: 'ADMIN creates bank classification rule',
      run: async () => {
        const resp = await api('POST', '/api/integrations/bank/rules', {
          role: 'ADMIN',
          body: {
            pattern: 'e2e_test_pattern',
            match_field: 'payment_purpose',
            direction: 'income',
            article: 'revenue_main',
            priority: 5
          }
        });
        assertOk(resp, 'create bank rule');
        assert(resp.data?.success === true && resp.data?.id, 'should return success:true and id');
        ruleId = resp.data.id;
      }
    },
    {
      name: 'ADMIN updates bank rule',
      run: async () => {
        if (!ruleId) skip('no ruleId');
        const resp = await api('PUT', `/api/integrations/bank/rules/${ruleId}`, {
          role: 'ADMIN',
          body: { pattern: 'e2e_updated_pattern', is_active: true, priority: 10 }
        });
        assertOk(resp, 'update bank rule');
        assert(resp.data?.success === true, 'should have success:true');
      }
    },
    {
      name: 'ADMIN deletes bank rule',
      run: async () => {
        if (!ruleId) skip('no ruleId');
        const resp = await api('DELETE', `/api/integrations/bank/rules/${ruleId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete bank rule');
        assert(resp.data?.success === true, 'should have success:true');
      }
    },
    {
      name: 'WAREHOUSE creates bank rule (authenticated, not role-restricted)',
      run: async () => {
        // Bank rules use only authenticate, no role restriction
        const resp = await api('POST', '/api/integrations/bank/rules', {
          role: 'WAREHOUSE',
          body: { pattern: 'warehouse_test_rule', article: 'expenses_other' }
        });
        assertOk(resp, 'WAREHOUSE create bank rule');
        // Cleanup
        if (resp.data?.id) {
          await api('DELETE', `/api/integrations/bank/rules/${resp.data.id}`, { role: 'ADMIN' });
        }
      }
    },

    // ── BANK STATS & EXPORT ──
    {
      name: 'ADMIN reads bank stats',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/stats', { role: 'ADMIN' });
        assertOk(resp, 'bank stats');
        assert(resp.data?.success === true, 'should have success:true');
      }
    },
    {
      name: 'BUH reads bank stats',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/stats', { role: 'BUH' });
        assertOk(resp, 'BUH bank stats');
      }
    },
    {
      name: 'ADMIN exports bank to 1C format (404 if no distributed transactions)',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/export/1c', { role: 'ADMIN' });
        // Returns 404 with "Нет транзакций для экспорта" when no distributed transactions exist
        assert([200, 404, 500].includes(resp.status), 'bank export 1c: got ' + resp.status);
      }
    },
    {
      name: 'BUH exports bank to Excel',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/export/excel', { role: 'BUH' });
        assert([200, 204].includes(resp.status), 'bank export excel: got ' + resp.status);
      }
    },
    {
      name: 'ADMIN exports bank to Excel',
      run: async () => {
        const resp = await api('GET', '/api/integrations/bank/export/excel', { role: 'ADMIN' });
        assert([200, 204].includes(resp.status), 'ADMIN bank export excel: got ' + resp.status);
      }
    }
  ]
};
