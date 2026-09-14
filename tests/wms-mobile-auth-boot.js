#!/usr/bin/env node
/**
 * WMS mobile helper — auth boot recipe for Playwright / CDP.
 *
 * Goal: reach /m/warehouse-wms as test_warehouse after login+PIN.
 *
 * Mobile is served from built assets in public/m/ (Vite build), NOT Vite dev.
 * After changing public/mobile-app/src, rebuild:
 *   cd public/mobile-app && npm run build && cp -r dist/* ../m/
 *
 * Usage (print only):
 *   node tests/wms-mobile-auth-boot.js
 *
 * Credentials (defaults match tests/config.js):
 *   login test_warehouse / Test123! / PIN 0000
 */

'use strict';

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const USER = process.env.WMS_USER || 'test_warehouse';
const PASS = process.env.WMS_PASS || 'Test123!';
const PIN = process.env.WMS_PIN || '0000';

console.log(`
=== WMS mobile auth boot (Playwright / CDP) ===
BASE=${BASE}
user=${USER}  pin=${PIN}

## Preferred: API login → verify-pin → localStorage → navigate

\`\`\`js
const BASE = '${BASE}';
const USER = '${USER}';
const PASS = '${PASS}';
const PIN = '${PIN}';

// 1) Login
const r1 = await fetch(BASE + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: USER, password: PASS }),
});
const d1 = await r1.json();
let token = d1.token;
if (!token) throw new Error('login failed: ' + JSON.stringify(d1));

// 2) PIN if needed (status need_pin OR token without pinVerified)
if (d1.status === 'need_pin' || d1.status === 'need_setup') {
  const r2 = await fetch(BASE + '/api/auth/verify-pin', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pin: PIN }),
  });
  const d2 = await r2.json();
  if (!r2.ok) throw new Error('verify-pin failed: ' + JSON.stringify(d2));
  token = d2.token || token;
}

// 3) Seed storage on origin, then open helper (BrowserRouter — path, NOT hash)
await page.goto(BASE + '/m/', { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => {
  localStorage.setItem('asgard_token', t);
}, token);

// 4) Navigate — use /m/warehouse-wms (NOT /m/#/warehouse-wms)
await page.goto(BASE + '/m/warehouse-wms', { waitUntil: 'domcontentloaded' });

// App bootstrap: token → fetchUser(/auth/me) → loading false.
// With pinVerified token, APIs succeed and the page stays.
\`\`\`

## If you inject a pre-PIN token (pinVerified=false)

Fix in client.js: 403 body matching /PIN|пин/i does NOT clearToken;
it sets pinStatus='need_pin' and redirects to /m/pin (not /m/welcome).
Complete PIN in UI, then go to /m/warehouse-wms.

## Zustand pinStatus after token inject

useAuthStore is NOT exposed on window.

- Full UI login (Login.jsx → login() → pinStatus) — no store patch needed.
- API inject of pin-verified token — fetchUser(/auth/me) is enough; pinStatus stays null (OK).
- If you must force pinStatus after load (e.g. race), only possible if you expose the store
  in a test build, e.g.:

\`\`\`js
// NOT available in production build unless you add:
//   if (import.meta.env.DEV) window.__useAuthStore = useAuthStore;
await page.evaluate(() => {
  const store = window.__useAuthStore;
  if (store) store.setState({ pinStatus: null, loading: false });
});
\`\`\`

Otherwise: use full UI login, OR inject pin-verified token after verify-pin.
Fix (1) in client.js alone is enough to stop welcome-wipe on PIN 403 races.

## Curl smoke (no browser)

\`\`\`bash
TOKEN=$(curl -s -X POST ${BASE}/api/auth/login \\
  -H 'Content-Type: application/json' \\
  -d '{"login":"${USER}","password":"${PASS}"}' | jq -r .token)
TOKEN=$(curl -s -X POST ${BASE}/api/auth/verify-pin \\
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \\
  -d '{"pin":"${PIN}"}' | jq -r .token)
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" \\
  ${BASE}/api/auth/me
# expect 200
\`\`\`
`);
