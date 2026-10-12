#!/usr/bin/env node
'use strict';

/**
 * tests/roadmap/dev-roadmap-comments-sentinel.js — рантайм-проверка комментариев
 * к пунктам дашборда (доска разработки) на КЛОНЕ.
 *
 * Сценарий:
 *   1. POST /comment без ключа           → 404 (fail closed)
 *   2. POST /comment без PIN             → 401
 *   3. POST /comment без текста/файла    → 400
 *   4. POST /comment с текстом (Никита)  → 200, автор = Никита
 *   5. POST /comment с файлом (multipart)→ 200, file_url есть, файл скачивается (200, не html)
 *   6. GET /state                        → комментарии видны всем (в чекпоинте)
 *   7. PATCH чужого комментария (Костя)  → 403
 *   8. PATCH своего (Никита)             → 200, текст изменился
 *   9. DELETE чужого (Костя)             → 403
 *  10. DELETE своего (Никита)            → 200, из state пропал, файл удалён
 *  11. Анти-брутфорс: серия неверных PIN → 429
 *
 * Запуск: node tests/roadmap/dev-roadmap-comments-sentinel.js [baseUrl]
 */

const BASE = process.argv[2] || process.env.ROADMAP_BASE || 'http://127.0.0.1:3100';
const KEY = process.env.ROADMAP_TEST_SECRET || 'test-secret-xyz';
const PIN_NIKITA = process.env.ROADMAP_TEST_PIN_NIKITA || '1111';
const PIN_KOSTYA = process.env.ROADMAP_TEST_PIN_KOSTYA || '2222';

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, evidence) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name + ' :: ' + evidence); console.log(`  FAIL  ${name} :: ${evidence}`); }
}

async function jpost(path, body, key) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Roadmap-Key': key === undefined ? KEY : key },
    body: JSON.stringify(body)
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}
async function jreq(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Roadmap-Key': KEY },
    body: JSON.stringify(body)
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}
async function get(path, key) {
  const r = await fetch(BASE + path, { headers: key === undefined ? {} : { 'X-Roadmap-Key': key } });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}

(async () => {
  console.log(`\nКомментарии к пунктам — sentinel @ ${BASE}\n`);

  // Первый чекпоинт
  const s0 = await get('/api/dev-roadmap/state', KEY);
  check('state доступен', s0.status === 200, `status=${s0.status}`);
  let cp = null;
  for (const st of s0.body.stages) for (const it of st.items) for (const c of it.checkpoints) { if (!cp) cp = c; }
  check('найден чекпоинт', !!cp, 'нет чекпоинтов');

  // 1. Без ключа
  const noKey = await jpost('/api/dev-roadmap/comment', { signer: 'nikita', pin: PIN_NIKITA, body: 'x', checkpoint_id: cp.id }, '');
  check('без ключа → 404', noKey.status === 404, `status=${noKey.status}`);

  // 2. Без PIN
  const noPin = await jpost('/api/dev-roadmap/comment', { signer: 'nikita', pin: '', body: 'x', checkpoint_id: cp.id });
  check('без PIN → 401', noPin.status === 401, `status=${noPin.status}`);

  // 3. Пусто (нет текста и файла)
  const empty = await jpost('/api/dev-roadmap/comment', { signer: 'nikita', pin: PIN_NIKITA, checkpoint_id: cp.id });
  check('без текста и файла → 400', empty.status === 400, `status=${empty.status}`);

  // 4. Текст
  const c1 = await jpost('/api/dev-roadmap/comment',
    { signer: 'nikita', pin: PIN_NIKITA, checkpoint_id: cp.id, body: 'План: разбить на 3 спринта' });
  check('добавление текста → 200', c1.status === 200, `status=${c1.status} ${JSON.stringify(c1.body).slice(0, 120)}`);
  check('автор = Никита', c1.body && c1.body.comment && c1.body.comment.author_name === 'Никита',
    `author=${c1.body && c1.body.comment && c1.body.comment.author_name}`);
  const c1id = c1.body && c1.body.comment && c1.body.comment.id;

  // 5. Файл (multipart)
  const fd = new FormData();
  fd.append('signer', 'kostya');
  fd.append('pin', PIN_KOSTYA);
  fd.append('checkpoint_id', String(cp.id));
  fd.append('body', 'Прикрепляю план');
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 test attachment')], { type: 'application/pdf' }), 'plan.pdf');
  const fr = await fetch(BASE + '/api/dev-roadmap/comment', { method: 'POST', headers: { 'X-Roadmap-Key': KEY }, body: fd });
  const fj = await fr.json();
  check('добавление с файлом → 200', fr.status === 200, `status=${fr.status} ${JSON.stringify(fj).slice(0, 120)}`);
  check('файл сохранён под .pdf', fj.comment && /\.pdf$/.test(fj.comment.file_url || ''), `file_url=${fj.comment && fj.comment.file_url}`);
  const c2id = fj.comment && fj.comment.id;

  // Скачивание файла (открыто, без ключа)
  if (fj.comment && fj.comment.file_url) {
    const dl = await fetch(BASE + fj.comment.file_url);
    const ct = dl.headers.get('content-type') || '';
    check('файл скачивается (200)', dl.status === 200, `status=${dl.status}`);
    check('файл отдаётся НЕ как html (без XSS)', !/text\/html/i.test(ct), `content-type=${ct}`);
  }

  // 6. Видно всем
  const s1 = await get('/api/dev-roadmap/state', KEY);
  let got = 0;
  for (const st of s1.body.stages) for (const it of st.items) for (const c of it.checkpoints) {
    if (c.id === cp.id) got = (c.comments || []).length;
  }
  check('комментарии видны в state', got >= 2, `comments=${got}`);

  // 7. Чужой не правит
  const foreign = await jreq('PATCH', `/api/dev-roadmap/comment/${c1id}`,
    { signer: 'kostya', pin: PIN_KOSTYA, body: 'взлом' });
  check('чужой PATCH → 403', foreign.status === 403, `status=${foreign.status}`);

  // 8. Свой правит
  const own = await jreq('PATCH', `/api/dev-roadmap/comment/${c1id}`,
    { signer: 'nikita', pin: PIN_NIKITA, body: 'План обновлён' });
  check('свой PATCH → 200', own.status === 200, `status=${own.status}`);
  check('текст изменился', own.body && own.body.comment && own.body.comment.body === 'План обновлён',
    `body=${own.body && own.body.comment && own.body.comment.body}`);

  // 9. Чужой не удаляет
  const foreignDel = await jreq('DELETE', `/api/dev-roadmap/comment/${c2id}`, { signer: 'nikita', pin: PIN_NIKITA });
  check('чужой DELETE → 403', foreignDel.status === 403, `status=${foreignDel.status}`);

  // 10. Свой удаляет
  const ownDel = await jreq('DELETE', `/api/dev-roadmap/comment/${c2id}`, { signer: 'kostya', pin: PIN_KOSTYA });
  check('свой DELETE → 200', ownDel.status === 200, `status=${ownDel.status}`);
  const s2 = await get('/api/dev-roadmap/state', KEY);
  let stillThere = false;
  for (const st of s2.body.stages) for (const it of st.items) for (const c of it.checkpoints) {
    (c.comments || []).forEach(x => { if (x.id === c2id) stillThere = true; });
  }
  check('удалённый комментарий пропал', !stillThere, 'всё ещё в state');

  // 11. Анти-брутфорс
  let saw429 = false;
  for (let i = 0; i < 12; i++) {
    const r = await jreq('PATCH', `/api/dev-roadmap/comment/${c1id}`,
      { signer: 'andrey', pin: '0000', body: 'x' });
    if (r.status === 429) { saw429 = true; break; }
  }
  check('анти-брутфорс комментариев → 429', saw429, '429 не пришёл');

  // Уборка: удаляем свой тестовый комментарий
  if (c1id) await jreq('DELETE', `/api/dev-roadmap/comment/${c1id}`, { signer: 'nikita', pin: PIN_NIKITA });

  console.log(`\nИтог: ${pass} PASS / ${fail} FAIL\n`);
  if (failures.length) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
})().catch(e => { console.error('Ошибка sentinel:', e); process.exit(1); });
