/**
 * FILES - File upload/download/documents
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

module.exports = {
  name: 'FILES (Файлы)',
  tests: [
    {
      name: 'ADMIN reads files list',
      run: async () => {
        const resp = await api('GET', '/api/files', { role: 'ADMIN' });
        assertOk(resp, 'files list');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.files || resp.data.items || []);
          assertArray(list, 'files list');
          if (list.length > 0) {
            assert(
              list[0].id || list[0].filename || list[0].name,
              'file item should have id, filename, or name'
            );
          }
        }
      }
    },
    {
      name: 'PM reads files list',
      run: async () => {
        const resp = await api('GET', '/api/files', { role: 'PM' });
        assertOk(resp, 'PM files');
      }
    },
    {
      name: 'Download non-existent file returns 404',
      run: async () => {
        const resp = await api('GET', '/api/files/download/nonexistent_file_xyz.pdf', { role: 'ADMIN' });
        assert(resp.status === 404 || resp.status === 400, `expected 404/400, got ${resp.status}`);
      }
    },
    {
      name: 'Negative: upload without file data returns 400',
      run: async () => {
        const resp = await api('POST', '/api/files/upload', {
          role: 'ADMIN',
          body: {}
        });
        assert(resp.status >= 400, `upload without file should fail, got ${resp.status}`);
        assert(resp.status < 500, `upload without file should be 4xx not 5xx, got ${resp.status}`);
      }
    }
  ]
};
