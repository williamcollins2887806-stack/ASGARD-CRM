const http = require('http');

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const data = body ? JSON.stringify(body) : null;

    const req = http.request({
      hostname: 'localhost', port: 3000, path, method, headers
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch(e) { resolve({ status: res.statusCode, body: buf.substring(0, 300) }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // Login
  const r1 = await request('POST', '/api/auth/login', { login: 'admin', password: 'admin123' });
  console.log('Login:', r1.status, r1.body.needPin ? 'needPin' : 'token=' + (r1.body.token || '').substring(0, 20));

  let token;
  if (r1.body.needPin) {
    const r2 = await request('POST', '/api/auth/verify-pin', { login: 'admin', pin: '1234' });
    console.log('PIN:', r2.status);
    token = r2.body.token;
  } else {
    token = r1.body.token;
  }

  if (!token) {
    console.log('No token, aborting');
    return;
  }

  // Try data API
  const r3 = await request('GET', '/api/data/tenders?limit=3', null, token);
  console.log('\n/api/data/tenders status:', r3.status);
  const tenders = r3.body.tenders || [];
  console.log('Tenders returned:', tenders.length, 'total:', r3.body.total);

  if (tenders.length === 0) {
    // Try tenders API directly
    const r4 = await request('GET', '/api/tenders?limit=3', null, token);
    console.log('\n/api/tenders status:', r4.status);
    console.log('Body keys:', Object.keys(r4.body || {}));
    const items = r4.body.tenders || r4.body.items || r4.body.data || [];
    console.log('Items:', items.length);
    if (items.length > 0) {
      const t = items[0];
      console.log('\nFirst tender types:');
      console.log('  tender_price:', typeof t.tender_price, '=', t.tender_price);
      console.log('  estimated_sum:', typeof t.estimated_sum, '=', t.estimated_sum);
    }
  } else {
    const t = tenders[0];
    console.log('\nFirst tender (field types):');
    for (const [k, v] of Object.entries(t)) {
      if (v !== null && v !== undefined) {
        console.log('  ' + k + ': ' + typeof v + ' = ' + String(v).substring(0, 50));
      }
    }
  }
}

main().catch(e => console.error('ERROR:', e.message));
