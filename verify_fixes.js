const { api, assert, assertOk, skip, getToken, rawFetch, initTokens, initRealUsers } = require('./tests/config');

async function test() {
  await initRealUsers();
  await initTokens();

  // Test 1: Scan endpoint
  console.log('=== Test: Scan pre-tender ===');
  const token = await getToken('TO');
  const list = await api('GET', '/api/pre-tenders', { role: 'TO' });
  const items = Array.isArray(list.data) ? list.data : (list.data?.items || []);
  if (items.length > 0) {
    const ptId = items[0].id;
    const resp = await rawFetch('POST', '/api/pre-tenders/' + ptId + '/scan', { token, body: {} });
    console.log('  Status:', resp.status, '(expected 200, was 500)');
  } else {
    const resp = await rawFetch('POST', '/api/pre-tenders/1/scan', { token, body: {} });
    console.log('  Status:', resp.status, '(expected 200 or 404)');
  }

  // Test 2: Auth login
  console.log('\n=== Test: Auth login ===');
  const loginResp = await rawFetch('POST', '/api/auth/login', {
    body: { login: 'test_admin', password: 'Test123!' }
  });
  console.log('  Status:', loginResp.status, '(expected 200)');
  const hasToken = loginResp.data && loginResp.data.token;
  console.log('  Has token:', hasToken ? 'YES' : 'NO');

  // Test 3: Notification CRUD
  console.log('\n=== Test: Notification mark-read ===');
  const u = await api('GET', '/api/users', { role: 'ADMIN' });
  const ul = Array.isArray(u.data) ? u.data : (u.data?.users || []);
  const au = ul.find(x => x.login === 'test_admin') || ul.find(x => x.role === 'ADMIN');
  console.log('  User:', au?.login, 'id:', au?.id);
  const cr = await api('POST', '/api/notifications', {
    role: 'ADMIN', body: { user_id: au.id, title: 'Fix Test', message: 'Testing fix', type: 'info', link: '#/test' }
  });
  if (cr.data?.notification?.id) {
    const nid = cr.data.notification.id;
    console.log('  Created notification:', nid);
    const rr = await api('PUT', '/api/notifications/' + nid + '/read', { role: 'ADMIN', body: {} });
    console.log('  Mark-read status:', rr.status, '(expected 200, was 404)');
    await api('DELETE', '/api/notifications/' + nid, { role: 'ADMIN' });
    console.log('  Cleaned up');
  } else {
    console.log('  Create failed:', cr.status);
  }

  console.log('\n=== Done ===');
}

test().catch(e => console.error(e));
