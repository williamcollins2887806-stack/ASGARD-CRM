const BASE = 'http://127.0.0.1:3100';
(async () => {
  for (let i = 1; i <= 8; i++) {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'test_buh', password: 'Test123!' }) });
    let d = null; try { d = await r.json(); } catch (_) {}
    console.log(i, 'st=' + r.status, 'body=' + JSON.stringify(d).slice(0, 160));
  }
})().catch((e) => console.log('ERR', e.message));
