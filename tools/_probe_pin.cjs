const BASE = 'http://127.0.0.1:3100';
(async () => {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'test_buh', password: 'Test123!' }) });
  const d = await r.json();
  let t = d.token;
  for (const pin of ['0000', '1234', '1111', '9999']) {
    const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) });
    let d2 = null; try { d2 = await r2.json(); } catch (_) {}
    console.log('pin=' + pin, 'st=' + r2.status, JSON.stringify(d2).slice(0, 200));
    if (d2 && d2.token) break;
  }
})().catch((e) => console.log('ERR', e.message));
