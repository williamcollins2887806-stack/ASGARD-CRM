const http = require('http');

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: 'localhost', port: 3000, path, method, headers }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch(e) { resolve({ status: res.statusCode, body: buf.substring(0, 500) }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // Step 1: Login
  const r1 = await request('POST', '/api/auth/login', { login: 'admin', password: 'admin123' });
  console.log('Step 1:', JSON.stringify(r1.body));

  // Step 2: PIN
  const r2 = await request('POST', '/api/auth/verify-pin', { login: 'admin', pin: '1234' });
  console.log('Step 2:', r2.status, 'token:', r2.body.token ? r2.body.token.substring(0, 30) + '...' : 'NONE');
  console.log('Step 2 full:', JSON.stringify(r2.body).substring(0, 200));

  const token = r2.body.token;
  if (!token) {
    console.log('No token after PIN');
    return;
  }

  // Fetch tenders
  const r3 = await request('GET', '/api/tenders?limit=3', null, token);
  console.log('\n/api/tenders:', r3.status);

  const tenders = r3.body.tenders || r3.body.items || [];
  console.log('Count:', tenders.length);

  if (tenders.length > 0) {
    const t = tenders[0];
    console.log('\nField types for first tender:');
    console.log('  tender_price:', typeof t.tender_price, '=', JSON.stringify(t.tender_price));
    console.log('  estimated_sum:', typeof t.estimated_sum, '=', JSON.stringify(t.estimated_sum));
    console.log('  cost_plan:', typeof t.cost_plan, '=', JSON.stringify(t.cost_plan));
    console.log('  year:', typeof t.year, '=', JSON.stringify(t.year));
    console.log('  id:', typeof t.id, '=', JSON.stringify(t.id));
  }

  // Also try /api/data/tenders
  const r4 = await request('GET', '/api/data/tenders?limit=3', null, token);
  console.log('\n/api/data/tenders:', r4.status);
  const dt = (r4.body.tenders || [])[0];
  if (dt) {
    console.log('  tender_price:', typeof dt.tender_price, '=', JSON.stringify(dt.tender_price));
    console.log('  estimated_sum:', typeof dt.estimated_sum, '=', JSON.stringify(dt.estimated_sum));
  }
}

main().catch(e => console.error('ERROR:', e.message));
