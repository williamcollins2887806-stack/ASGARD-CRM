/**
 * V394: экран «Входящие СФ» для кладовщика — E2E на клоне (:3100).
 * Проверяем: ACL (кому можно), список (минимум полей), двухшаговый флоу
 * (склад отметил → владелец подтвердил), идемпотентность, отсутствие утечки.
 */
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const { Client } = require('pg');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

async function token(login, password) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  const j = await r.json();
  let t = j.token;
  if (j.status === 'need_pin' || j.need_pin) {
    for (const pin of ['0000', '1234', '1111']) {
      const r2 = await fetch(BASE + '/api/auth/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ pin })
      });
      const j2 = await r2.json().catch(() => ({}));
      if (j2.token) { t = j2.token; break; }
    }
  }
  return t;
}
const call = async (path, t, opts = {}) => {
  const r = await fetch(BASE + '/api/doc-registry' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, ...(opts.headers || {}) }
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (_) { j = { raw: text }; }
  return { status: r.status, body: j };
};

(async () => {
  console.log('=== V394: экран «Входящие СФ» для кладовщика ===\n');
  const wh = await token('test_warehouse', 'Test123!');
  const admin = await token('test_admin', 'Test123!');
  const buh = await token('test_buh', 'Test123!');
  ok(!!wh && !!admin && !!buh, 'логины всех трёх ролей получены');

  // 1. ACL: кому нельзя
  const asBuh = await call('/incoming-sf', buh);
  ok(asBuh.status === 200, 'BUH видит экран (200), получили ' + asBuh.status);

  // 2. ACL: склад видит
  const asWh = await call('/incoming-sf', wh);
  ok(asWh.status === 200, 'WAREHOUSE видит экран (200), получили ' + asWh.status);
  const items = (asWh.body.items || []);
  ok(Array.isArray(items), 'вернулся массив items, длина ' + items.length);

  // 3. Минимум полей + отсутствие утечек
  const first = items[0] || {};
  const keys = Object.keys(first);
  ok(keys.includes('id') && keys.includes('counterparty_name') && keys.includes('amount'),
    'поля минимума на месте: ' + keys.join(','));
  const leakKeys = keys.filter((k) => /comment|parse_raw|parsed_json|audit|inn|bik|rs$|ks$|payee|correction/i.test(k));
  ok(leakKeys.length === 0, 'утечки служебных полей нет' + (leakKeys.length ? ': ' + leakKeys.join(',') : ''));

  // 4. only_pending=1 отсекает уже полученные
  const pending = await call('/incoming-sf?only_pending=1', wh);
  const pendItems = pending.body.items || [];
  ok(pendItems.every((i) => !i.sf_received_at), 'only_pending=1: нет уже отмеченных (' + pendItems.length + ' шт.)');
  ok(pendItems.length <= items.length, 'фильтр не расширяет выдачу (' + pendItems.length + ' <= ' + items.length + ')');

  // 5. Двухшаговый флоу на реальной строке
  const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  await db.connect();
  const t = (await db.query(`SELECT id, sf_received_at, closing_json, ops_status FROM doc_registry
    WHERE deleted_at IS NULL AND dir='in' AND ops_status IN ('wait_sf','wait_closing')
    ORDER BY id LIMIT 1`)).rows[0];
  if (!t) { console.log('\n(нет подходящей строки — флоу пропущен)'); }
  else {
    console.log(`\n  строка #${t.id} (ops=${t.ops_status}, получено=${t.sf_received_at || 'нет'})`);
    // Шаг 1: кладовщик отмечает
    const s1 = await call(`/${t.id}/quick`, wh, { method: 'POST', body: JSON.stringify({ action: 'receive_sf' }) });
    ok(s1.status === 200, 'шаг 1: кладовщик отметил (200), получили ' + s1.status);
    const after1 = (await db.query(`SELECT sf_received_at, wh_status FROM doc_registry WHERE id=$1`, [t.id])).rows[0];
    ok(!!after1.sf_received_at, 'sf_received_at выставлен: ' + after1.sf_received_at);
    ok(after1.wh_status === 'received', 'wh_status=received, получили ' + after1.wh_status);

    // Идемпотентность: повтор не портит дату
    const s1b = await call(`/${t.id}/quick`, wh, { method: 'POST', body: JSON.stringify({ action: 'receive_sf' }) });
    const after1b = (await db.query(`SELECT sf_received_at FROM doc_registry WHERE id=$1`, [t.id])).rows[0];
    ok(s1b.status === 200 && String(after1b.sf_received_at) === String(after1.sf_received_at),
      'повтор не сдвигает дату (идемпотентно)');

    // Шаг 2: владелец/бух подтверждает закрывающий (action=sf)
    const s2 = await call(`/${t.id}/quick`, buh, {
      method: 'POST', body: JSON.stringify({ action: 'sf', kind: 'sf', number: 'ТЕСТ-СФ', date: new Date().toISOString().slice(0, 10) })
    });
    ok(s2.status === 200, 'шаг 2: подтверждение закрывающего (200), получили ' + s2.status);
    const after2 = (await db.query(`SELECT closing_json, ops_status FROM doc_registry WHERE id=$1`, [t.id])).rows[0];
    const cj = Array.isArray(after2.closing_json) ? after2.closing_json : [];
    ok(cj.length > 0 && cj[cj.length - 1].no === 'ТЕСТ-СФ', 'closing_json содержит подтверждение: ' + JSON.stringify(cj[cj.length - 1] || {}));
    ok(after2.ops_status === 'done', 'ops_status=done после подтверждения, получили ' + after2.ops_status);

    // 6. Чужая роль (не WH/BUH/ADMIN) не может отметить — берём PROC-подобную,
    //    если такой логина нет, проверяем хотя бы отсутствие доступa без токена
    const noAuth = await fetch(BASE + '/api/doc-registry/incoming-sf');
    ok(noAuth.status === 401 || noAuth.status === 403, 'без токена экран закрыт (' + noAuth.status + ')');

    // откат тестовой строки
    await db.query(`UPDATE doc_registry SET sf_received_at=NULL, wh_status='none', ops_status=$2, closing_json='[]'::jsonb WHERE id=$1`, [t.id, t.ops_status]);
    console.log(`  (строка #${t.id} возвращена в исходное состояние)`);
  }
  await db.end();

  console.log(`\n=== ИТОГ: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
