const { api, assert, assertOk, assertForbidden, skip } = require('../config');

let procReqId = null;
let procItemId = null;
let assemblyId = null;
let palletId = null;
let fullProcId = null;
let fullItemId = null;
let fullAssemblyId = null;

module.exports = {
  name: 'FLOW: Procurement + Warehouse + Assembly Pipeline',
  tests: [
    {
      name: 'Step 0: Server is alive',
      run: async () => {
        const resp = await api('GET', '/api/users/me', { role: 'ADMIN' });
        assertOk(resp, 'Server responds');
        assert(resp.data?.user?.id, 'User ID returned');
      }
    },
  ]
};
