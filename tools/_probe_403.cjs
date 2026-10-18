const BASE = 'http://127.0.0.1:3100';
(async () => {
  // логин без verify-pin → токен pinVerified:false
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'test_buh', password: 'Test123!' }) });
  const d = await r.json();
  const t = d.token;
  const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t };
  const r2 = await fetch(BASE + '/api/doc-registry/reconciliation/detail?inn=9700000001&year=2026&quarter=4', { headers: h });
  console.log('need_pin token → recon/detail st=' + r2.status, (await r2.text()).slice(0, 300));
  // а теперь с verify-pin
  const rp = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: h, body: JSON.stringify({ pin: '0000' }) });
  console.log('verify-pin st=' + rp.status, (await rp.text()).slice(0, 120));
  // 6 подряд verify-pin чтобы поймать лимит
  for (let i = 1; i <= 6; i++) {
    const rl = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'test_buh', password: 'Test123!' }) });
    const dl = await rl.json();
    const rv = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + dl.token }, body: JSON.stringify({ pin: '0000' }) });
    let b = await rv.text();
    console.log('  burst ' + i + ': login st=' + rl.status + ' verify st=' + rv.status + ' ' + b.slice(0, 120));
    await new Promise((s) => setTimeout(s, 120));
  }
})().catch((e) => console.log('ERR', e.message));
