process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';
const token = jwt.sign({id:1,role:'ADMIN',name:'Admin'}, secret, {expiresIn:'1h'});

async function test(method, path, body) {
  const opts = {method, headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'}};
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch('http://127.0.0.1:3000'+path, opts);
    const d = await r.json().catch(()=>({}));
    const ok = d.success !== false && r.status < 500;
    return {status: r.status, ok, data: d};
  } catch(e) { return {status: 0, ok: false, data: {error: e.message}}; }
}

(async () => {
  let pass = 0, fail = 0;
  async function check(label, method, path, body) {
    const r = await test(method, path, body);
    const icon = r.ok ? '✅' : '❌';
    console.log(`${icon} ${label}: HTTP ${r.status}`);
    if (r.ok) pass++; else { fail++; console.log('   ', JSON.stringify(r.data).substring(0, 200)); }
    return r;
  }

  console.log('=== EXISTING ENDPOINTS ===');
  await check('GET /api/equipment', 'GET', '/api/equipment?limit=3');
  await check('GET /api/equipment/categories', 'GET', '/api/equipment/categories');
  await check('GET /api/equipment/warehouses', 'GET', '/api/equipment/warehouses');
  await check('GET /api/equipment/objects', 'GET', '/api/equipment/objects');
  await check('GET /api/equipment/stats/summary', 'GET', '/api/equipment/stats/summary');
  await check('GET /api/equipment/available', 'GET', '/api/equipment/available');

  console.log('\n=== NEW PREMIUM ENDPOINTS ===');
  const kits = await check('GET /api/equipment/kits', 'GET', '/api/equipment/kits');
  console.log('   Kits count:', (kits.data?.kits || []).length);

  const dash = await check('GET /api/equipment/stats/dashboard', 'GET', '/api/equipment/stats/dashboard');
  if (dash.ok) console.log('   Total:', dash.data?.total, '| On warehouse:', dash.data?.on_warehouse);

  const rec = await check('GET /api/equipment/recommend', 'GET', '/api/equipment/recommend?work_type=' + encodeURIComponent('ХИМ-промывка'));
  console.log('   Recommendations:', (rec.data?.recommendations || []).length);

  // Test kit CRUD
  const newKit = await check('POST /api/equipment/kits', 'POST', '/api/equipment/kits', {
    name: 'QUICK_TEST_KIT', work_type: 'Тест', icon: '🧪',
    items: [{ item_name: 'Test item', quantity: 1, is_required: true }]
  });
  if (newKit.data?.kit?.id) {
    const kitId = newKit.data.kit.id;
    await check('GET /api/equipment/kits/' + kitId, 'GET', '/api/equipment/kits/' + kitId);
    await check('PUT /api/equipment/kits/' + kitId, 'PUT', '/api/equipment/kits/' + kitId, { name: 'QUICK_TEST_KIT_UPDATED' });
    await check('DELETE /api/equipment/kits/' + kitId, 'DELETE', '/api/equipment/kits/' + kitId);
  }

  // Test work equipment (if any work exists)
  const works = await test('GET', '/api/works?limit=1');
  const workId = works.data?.works?.[0]?.id;
  if (workId) {
    await check('GET /api/equipment/work/' + workId + '/equipment', 'GET', '/api/equipment/work/' + workId + '/equipment');
  } else {
    console.log('⏭️  Skipping work endpoints (no works found)');
  }

  console.log('\n=== RESULT ===');
  console.log(`✅ Passed: ${pass} | ❌ Failed: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})();
