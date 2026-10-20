// D-306: рантайм-проверка на клоне — реестр не 500, фильтр подписи работает,
// «Показать все» у офис-менеджера = все счета.
const { Client } = require('pg');
const BASE = 'http://127.0.0.1:3101';
const db = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };

async function mint(id) {
  const jwt = require('jsonwebtoken');
  const SECRET = process.env.JWT_SECRET || 'test_secret';
  const u = (await db.query('SELECT id, login, name, role FROM users WHERE id=$1', [id])).rows[0];
  if (!u) throw new Error('нет пользователя ' + id);
  return { u, token: jwt.sign({ id: u.id, login: u.login, name: u.name, role: u.role, pinVerified: true }, SECRET, { expiresIn: '1h' }) };
}

(async () => {
  await db.connect();
  console.log('\n=== D-306 рантайм на клоне :3101 ===');

  // 1) офис-менеджер: реестр открывается (до фикса был 500)
  for (const uid of [3471, 4698]) {
    const { u, token } = await mint(uid);
    const r = await fetch(`${BASE}/api/doc-registry?limit=1&scope=all`, { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 200) {
      const j = await r.json();
      ok(`${u.name} — реестр 200, всего ${j.total}`);
    } else {
      bad(`${u.name} — реестр ${r.status}`);
    }
    const r2 = await fetch(`${BASE}/api/doc-registry?limit=1&scope=mine`, { headers: { Authorization: 'Bearer ' + token } });
    if (r2.status === 200) {
      const j2 = await r2.json();
      ok(`${u.name} — «только мои» 200, ${j2.total}`);
    } else bad(`${u.name} — «мои» ${r2.status}`);
  }

  // 2) «Показать все» реально шире, чем «мои»
  const { token: tOk } = await mint(3471);
  const all = await (await fetch(`${BASE}/api/doc-registry?limit=1&scope=all`, { headers: { Authorization: 'Bearer ' + tOk } })).json();
  const mine = await (await fetch(`${BASE}/api/doc-registry?limit=1&scope=mine`, { headers: { Authorization: 'Bearer ' + tOk } })).json();
  if (all.total > mine.total) ok(`«Показать все» (${all.total}) > «мои» (${mine.total})`);
  else bad(`«Показать все» не шире: all=${all.total} mine=${mine.total}`);

  // 3) подпись: ставим ЧЕРЕЗ API (автор = сессия), затем фильтруем.
  // D-306c: прямая запись в БД оставляет подпись «ничьей», и по контракту
  // приватности её не должен видеть никто — поэтому только PUT.
  const ids = (await db.query(`SELECT id FROM doc_registry WHERE deleted_at IS NULL AND doc_owner_id=4698 ORDER BY id LIMIT 2`)).rows;
  const putNote = (docId, note) => fetch(`${BASE}/api/doc-registry/${docId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tOk },
    body: JSON.stringify({ doc_owner_note: note })
  });
  const p1 = await putNote(ids[0].id, 'Пираев С.');
  const p2 = await putNote(ids[1].id, 'Михайлушкин А.');
  if (p1.status === 200 && p2.status === 200) ok('подписи поставлены через API (автор = сессия)');
  else bad(`не удалось поставить подписи: ${p1.status}/${p2.status}`);

  const rf = await fetch(`${BASE}/api/doc-registry?limit=50&scope=all&owner_note=${encodeURIComponent('Пираев С.')}`, { headers: { Authorization: 'Bearer ' + tOk } });
  const jf = await rf.json();
  if (rf.status === 200 && jf.total === 1 && jf.items[0].id === ids[0].id) ok('фильтр по подписи «Пираев С.» → ровно 1 строка');
  else bad(`фильтр по подписи: status=${rf.status} total=${jf.total}`);

  // 3b) мультивыбор разделителем «||» (запятая в ФИО не должна ломать фильтр)
  const rf2 = await fetch(`${BASE}/api/doc-registry?limit=50&scope=all&owner_note=${encodeURIComponent('Пираев С.||Михайлушкин А.')}`, { headers: { Authorization: 'Bearer ' + tOk } });
  const jf2 = await rf2.json();
  if (rf2.status === 200 && jf2.total === 2) ok('мультивыбор «Пираев С.||Михайлушкин А.» → 2 строки');
  else bad(`мультивыбор подписей: status=${rf2.status} total=${jf2.total}`);

  // 3c) ФИО с запятой внутри не режется на части
  await db.query(`UPDATE doc_registry SET doc_owner_note='Иванов И., Петров П.' WHERE id=$1`, [ids[0].id]);
  const rf3 = await fetch(`${BASE}/api/doc-registry?limit=50&scope=all&owner_note=${encodeURIComponent('Иванов И., Петров П.')}`, { headers: { Authorization: 'Bearer ' + tOk } });
  const jf3 = await rf3.json();
  if (rf3.status === 200 && jf3.total === 1) ok('ФИО с запятой фильтруется целиком');
  else bad(`ФИО с запятой: status=${rf3.status} total=${jf3.total}`);
  await db.query(`UPDATE doc_registry SET doc_owner_note='Пираев С.' WHERE id=$1`, [ids[0].id]);

  // 4) подсказки
  const rn = await fetch(`${BASE}/api/doc-registry/owner-notes?doc_owner_id=4698`, { headers: { Authorization: 'Bearer ' + tOk } });
  const jn = await rn.json();
  const notes = (jn.notes || []).map((x) => x.note);
  if (rn.status === 200 && notes.includes('Пираев С.') && notes.includes('Михайлушкин А.')) ok('подсказки отдают оба ФИО');
  else bad(`подсказки: status=${rn.status} notes=${JSON.stringify(notes)}`);

  // 5) сохранение подписи через PUT и чтение обратно
  const put = await fetch(`${BASE}/api/doc-registry/${ids[0].id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tOk },
    body: JSON.stringify({ doc_owner_note: 'Тумаева В.' })
  });
  if (put.status === 200) {
    const back = (await db.query('SELECT doc_owner_note FROM doc_registry WHERE id=$1', [ids[0].id])).rows[0];
    if (back.doc_owner_note === 'Тумаева В.') ok('PUT подписи сохранён в БД');
    else bad('PUT прошёл, но подпись не сохранилась: ' + JSON.stringify(back));
  } else bad('PUT подписи вернул ' + put.status);

  // очистка
  await db.query(`UPDATE doc_registry SET doc_owner_note=NULL WHERE id = ANY($1::int[])`, [ids.map((r) => r.id)]);
  console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
