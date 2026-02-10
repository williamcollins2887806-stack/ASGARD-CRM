/**
 * FILES - File upload/download/documents
 */
const { api, assert, assertOk } = require('../config');

module.exports = {
  name: 'FILES (Файлы)',
  tests: [
    {
      name: 'ADMIN reads documents list',
      run: async () => {
        const resp = await api('GET', '/api/files/documents', { role: 'ADMIN' });
        assertOk(resp, 'documents');
      }
    },
    {
      name: 'PM reads documents',
      run: async () => {
        const resp = await api('GET', '/api/files/documents', { role: 'PM' });
        assertOk(resp, 'PM documents');
      }
    },
    {
      name: 'Download non-existent file returns 404',
      run: async () => {
        const resp = await api('GET', '/api/files/download/nonexistent_file_xyz.pdf', { role: 'ADMIN' });
        assert(resp.status === 404 || resp.status === 400, `expected 404/400, got ${resp.status}`);
      }
    }
  ]
};
