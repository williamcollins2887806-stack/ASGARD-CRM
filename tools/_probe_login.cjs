const BASE = 'http://127.0.0.1:3100';
(async () => {
  for (const [l, p] of [['test_buh', 'Test123!'], ['test_admin', 'Test123!'], ['test_pm', 'Test123!'], ['test_director_comm', 'Test123!']]) {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
    let d = null; try { d = await r.json(); } catch (_) {}
    console.log(l, 'st=' + r.status, JSON.stringify(d).slice(0, 300));
  }
})().catch((e) => console.log('ERR', e.message));
