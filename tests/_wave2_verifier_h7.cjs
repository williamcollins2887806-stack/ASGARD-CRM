/* H7 verifier: multipart upload to /direct should reject >20 files with 400 too_many_files,
 * and >50MB single file with 400 file_too_large.
 *
 * Crafts a raw multipart/form-data payload (no FormData dependency).
 */
'use strict';
const http = require('http');
const jwt = require('jsonwebtoken');

const SECRET = (process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET env required'); })());
const BASE = 'http://127.0.0.1:3120';
const PM = { id: 4610, login: 'test_pm', role: 'PM' };

function sign(u) { return jwt.sign({ id: u.id, login: u.login, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' }); }

function buildMultipart(boundary, fields, files) {
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(f.body);
    parts.push(Buffer.from(`\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

function post(path, token, payload, ctype) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = {
      method: 'POST',
      hostname: url.hostname, port: url.port, path: url.pathname,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': ctype,
        'Content-Length': payload.length
      }
    };
    const r = http.request(opts, res => { let buf = ''; res.setEncoding('utf8'); res.on('data', c => buf += c); res.on('end', () => { let p = null; try { p = JSON.parse(buf); } catch (_) { p = buf; } resolve({ status: res.statusCode, body: p }); }); });
    r.on('error', reject);
    r.write(payload);
    r.end();
  });
}

(async () => {
  const tok = sign(PM);
  let fails = 0, total = 0;

  // Test 1: 21 small files → expect 400 too_many_files (max 20)
  {
    total++;
    const boundary = '----wave2tester' + Date.now();
    const files = [];
    for (let i = 0; i < 21; i++) {
      files.push({ name: `f${i}.txt`, body: Buffer.from('hello' + i) });
    }
    const body = buildMultipart(boundary, { title: 'h7-many-files', body: 'test body' }, files);
    const r = await post('/api/inbox-applications/direct', tok, body, 'multipart/form-data; boundary=' + boundary);
    const passed = r.status === 400 && r.body && r.body.error === 'too_many_files';
    console.log(passed ? 'PASS' : 'FAIL', '21 files → status=' + r.status + ' body=' + JSON.stringify(r.body).slice(0, 100));
    if (!passed) fails++;
  }

  // Test 2: 1 file slightly larger than 50MB → expect 400 file_too_large
  {
    total++;
    const boundary = '----wave2tester' + Date.now();
    const big = Buffer.alloc(50 * 1024 * 1024 + 1024); // 50MB + 1KB
    big.fill('A');
    const body = buildMultipart(boundary, { title: 'h7-big-file', body: 'test body' }, [{ name: 'big.bin', body: big }]);
    const r = await post('/api/inbox-applications/direct', tok, body, 'multipart/form-data; boundary=' + boundary);
    const passed = r.status === 400 && r.body && r.body.error === 'file_too_large';
    console.log(passed ? 'PASS' : 'FAIL', '50MB+1KB file → status=' + r.status + ' body=' + JSON.stringify(r.body).slice(0, 120));
    if (!passed) fails++;
  }

  // Test 3 (control): 1 small file → expect 200
  {
    total++;
    const boundary = '----wave2tester' + Date.now();
    const body = buildMultipart(boundary, { title: 'h7-control', body: 'control body' }, [{ name: 'a.txt', body: Buffer.from('ok') }]);
    const r = await post('/api/inbox-applications/direct', tok, body, 'multipart/form-data; boundary=' + boundary);
    const passed = r.status === 200 && r.body && r.body.success;
    console.log(passed ? 'PASS' : 'FAIL', 'control 1 small file → status=' + r.status + ' body=' + JSON.stringify(r.body).slice(0, 100));
    if (!passed) fails++;
  }

  console.log(`H7 verifier: ${total - fails}/${total}`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('crash', e); process.exit(2); });
