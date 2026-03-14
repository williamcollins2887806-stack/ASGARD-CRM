// Check what types the API returns for tender fields
const http = require('http');

async function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', reject);
  });
}

async function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('Parse error: ' + body.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  // Step 1: Login
  const login = await postJSON('http://localhost:3000/api/auth/login', {
    login: 'admin', password: 'admin123'
  });

  if (login.needPin) {
    // Step 2: PIN
    const pin = await postJSON('http://localhost:3000/api/auth/verify-pin', {
      login: 'admin', pin: '1234'
    });
    var token = pin.token;
  } else {
    var token = login.token;
  }

  console.log('Token:', token ? 'OK' : 'FAIL');

  // Step 3: Get 2 tenders
  const resp = await fetchJSON('http://localhost:3000/api/data/tenders?limit=2', {
    'Authorization': 'Bearer ' + token
  });

  const tenders = resp.tenders || [];
  console.log('Got tenders:', tenders.length);

  if (tenders.length > 0) {
    const t = tenders[0];
    console.log('\nFirst tender (raw JSON types):');
    console.log('  id:', typeof t.id, '=', t.id);
    console.log('  tender_price:', typeof t.tender_price, '=', t.tender_price);
    console.log('  estimated_sum:', typeof t.estimated_sum, '=', t.estimated_sum);
    console.log('  cost_plan:', typeof t.cost_plan, '=', t.cost_plan);
    console.log('  year:', typeof t.year, '=', t.year);
    console.log('  tender_status:', typeof t.tender_status, '=', t.tender_status);
    console.log('  customer_name:', typeof t.customer_name, '=', String(t.customer_name).substring(0, 40));

    console.log('\nAll numeric-looking fields:');
    for (const [k, v] of Object.entries(t)) {
      if (v !== null && v !== undefined) {
        const isNumStr = typeof v === 'string' && /^[\d.]+$/.test(v);
        if (typeof v === 'number' || isNumStr) {
          console.log('  ' + k + ': type=' + typeof v + ' value=' + v);
        }
      }
    }
  }
}

main().catch(e => console.error('ERROR:', e));
