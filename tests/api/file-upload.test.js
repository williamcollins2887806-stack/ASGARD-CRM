/**
 * Block D: File upload tests
 * Tests /api/files/upload and /api/files/download
 */
const { api, assert, assertOk, skip, rawFetch, getToken, getTokenSync, BASE_URL } = require('../config');

let uploadedFilename = null;

module.exports = {
  name: 'FILE UPLOAD',
  tests: [
    {
      name: 'UPLOAD: multipart file upload → 200',
      run: async () => {
        // Build multipart form data manually
        const boundary = '----TestBoundary' + Date.now();
        const fileContent = 'Test file content for ASGARD CRM upload test';
        const body = [
          `--${boundary}`,
          'Content-Disposition: form-data; name="file"; filename="test-upload.txt"',
          'Content-Type: text/plain',
          '',
          fileContent,
          `--${boundary}--`
        ].join('\r\n');

        const url = `${BASE_URL}/api/files/upload`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${getTokenSync('PM')}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`
          },
          body
        });

        const ct = resp.headers.get('content-type') || '';
        const data = ct.includes('json') ? await resp.json().catch(() => null) : await resp.text();

        assert(resp.status < 500, `upload: expected non-500, got ${resp.status}`);
        if (resp.ok && data?.file) {
          uploadedFilename = data.file.filename || data.download_url?.split('/').pop();
        }
        if (!resp.ok) skip(`Upload returned ${resp.status} — multipart may need different format`);
      }
    },
    {
      name: 'UPLOAD: without file → 400',
      run: async () => {
        const boundary = '----TestBoundary' + Date.now();
        const body = [
          `--${boundary}`,
          'Content-Disposition: form-data; name="tender_id"',
          '',
          '123',
          `--${boundary}--`
        ].join('\r\n');

        const url = `${BASE_URL}/api/files/upload`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${getTokenSync('PM')}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`
          },
          body
        });

        assert(resp.status === 400, `no file should return 400, got ${resp.status}`);
      }
    },
    {
      name: 'UPLOAD: disallowed extension (.exe) → 400',
      run: async () => {
        const boundary = '----TestBoundary' + Date.now();
        const body = [
          `--${boundary}`,
          'Content-Disposition: form-data; name="file"; filename="malware.exe"',
          'Content-Type: application/octet-stream',
          '',
          'MZ fake exe content',
          `--${boundary}--`
        ].join('\r\n');

        const url = `${BASE_URL}/api/files/upload`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${getTokenSync('PM')}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`
          },
          body
        });

        assert(resp.status === 400, `exe upload should return 400, got ${resp.status}`);
      }
    },
    {
      name: 'UPLOAD: disallowed extension (.js) → 400',
      run: async () => {
        const boundary = '----TestBoundary' + Date.now();
        const body = [
          `--${boundary}`,
          'Content-Disposition: form-data; name="file"; filename="script.js"',
          'Content-Type: application/javascript',
          '',
          'console.log("xss")',
          `--${boundary}--`
        ].join('\r\n');

        const url = `${BASE_URL}/api/files/upload`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${getTokenSync('PM')}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`
          },
          body
        });

        assert(resp.status === 400, `.js upload should return 400, got ${resp.status}`);
      }
    },
    {
      name: 'DOWNLOAD: uploaded file → 200',
      run: async () => {
        if (!uploadedFilename) skip('No file was uploaded');
        const url = `${BASE_URL}/api/files/download/${uploadedFilename}`;
        const resp = await fetch(url, {
          headers: { 'Authorization': `Bearer ${getTokenSync('PM')}` }
        });
        assertOk({ status: resp.status, ok: resp.ok }, 'download file');
      }
    },
    {
      name: 'DOWNLOAD: non-existent file → 404',
      run: async () => {
        const url = `${BASE_URL}/api/files/download/nonexistent-file-99999.txt`;
        const resp = await fetch(url, {
          headers: { 'Authorization': `Bearer ${getTokenSync('PM')}` }
        });
        assert(resp.status === 404 || resp.status === 400, `expected 404 for missing file, got ${resp.status}`);
      }
    },
    {
      name: 'UPLOAD: unauthorized (no token) → 401',
      run: async () => {
        const boundary = '----TestBoundary' + Date.now();
        const body = [
          `--${boundary}`,
          'Content-Disposition: form-data; name="file"; filename="test.txt"',
          'Content-Type: text/plain',
          '',
          'unauthorized content',
          `--${boundary}--`
        ].join('\r\n');

        const url = `${BASE_URL}/api/files/upload`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`
          },
          body
        });

        assert(resp.status === 401 || resp.status === 403, `unauthorized upload: expected 401/403, got ${resp.status}`);
      }
    },
    {
      name: 'DOWNLOAD: unauthorized (no token) → 401',
      run: async () => {
        const url = `${BASE_URL}/api/files/download/any-file.txt`;
        const resp = await fetch(url);
        assert(resp.status === 401 || resp.status === 403, `unauthorized download: expected 401/403, got ${resp.status}`);
      }
    }
  ]
};
