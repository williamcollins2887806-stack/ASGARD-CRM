const { chromium } = require('playwright');
const https = require('https');

const BASE_URL = 'https://127.0.0.1';

function apiCall(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request({
      hostname: '127.0.0.1', port: 443, path: urlPath,
      method, headers, rejectUnauthorized: false
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAuthData(login, pass) {
  const loginRes = await apiCall('POST', '/api/auth/login', null, JSON.stringify({ login, password: pass }));
  let token = loginRes.token;
  if (loginRes.status === 'need_pin' && token) {
    const pinRes = await apiCall('POST', '/api/auth/verify-pin', token, JSON.stringify({ pin: '0000' }));
    if (pinRes.token) token = pinRes.token;
  }
  const userData = await apiCall('GET', '/api/auth/me', token);
  const user = userData.user || userData;
  return { token, user };
}

(async () => {
  const { token, user } = await getAuthData('test_warehouse', 'Test123!');
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors']
  });
  
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    storageState: {
      cookies: [],
      origins: [{
        origin: 'https://127.0.0.1',
        localStorage: [
          { name: 'token', value: token },
          { name: 'asgard_token', value: token },
          { name: 'asgard_user', value: JSON.stringify(user) }
        ]
      }]
    }
  });
  
  const page = await ctx.newPage();
  
  // Capture ALL failed requests
  const failed = [];
  page.on('response', resp => {
    if (resp.status() === 403) {
      failed.push(resp.url() + ' -> 403');
    }
  });
  page.on('requestfailed', req => {
    failed.push(req.url() + ' -> FAILED: ' + req.failure().errorText);
  });
  
  await page.goto(BASE_URL + '/#/home', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 5000));
  
  console.log('=== WAREHOUSE HOME: ' + failed.length + ' failed requests ===');
  failed.forEach(f => console.log('  ' + f));
  
  await browser.close();
})();
