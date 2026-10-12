#!/usr/bin/env node
'use strict';

/**
 * tests/roadmap/dev-roadmap-sentinel.js — рантайм-проверка дашборда разработки на КЛОНЕ.
 *
 * Сценарий (POST → GET → assert):
 *   1. Без ключа / неверный ключ  → 404 (fail closed)
 *   2. GET /state с ключом        → 200, 7 этапов, 108 чекпоинтов, прогресс = 0%
 *   3. POST /checkpoint/:id/close с PIN Кости → 200, signed_by = «Костя»
 *   4. GET /state                 → прогресс чекпоинта и общего кольца ВЫРОС
 *   5. GET /events                → последнее событие: action=close, signer_name=Костя
 *   6. POST close повторно        → 409 (идемпотентность)
 *   7. POST close с неверным PIN  → 401
 *   8. POST reopen с PIN Кости    → 200, прогресс вернулся
 *
 * Запуск: node tests/roadmap/dev-roadmap-sentinel.js [baseUrl]
 * По умолчанию BASE=127.0.0.1:3100, ключ и PIN — из env или тестовые значения ниже.
 */

const BASE = process.argv[2] || process.env.ROADMAP_BASE || 'http://127.0.0.1:3100';
const KEY = process.env.ROADMAP_TEST_SECRET || 'test-secret-xyz';
const PIN_KOSTYA = process.env.ROADMAP_TEST_PIN_KOSTYA || '2222';

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, evidence) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name + ' :: ' + evidence); console.log(`  FAIL  ${name} :: ${evidence}`); }
}

async function get(path, key) {
  const r = await fetch(BASE + path, { headers: key !== undefined ? { 'X-Roadmap-Key': key } : {} });
  let body = null;
  try { body = await r.json(); } catch (_) {}
  return { status: r.status, body };
}

async function post(path, body, key) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Roadmap-Key': key === undefined ? KEY : key },
    body: JSON.stringify(body)
  });
  let j = null;
  try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}

(async () => {
  console.log(`\nДашборд разработки — sentinel @ ${BASE}\n`);

  // 1. Fail closed
  const noKey = await get('/api/dev-roadmap/state');
  check('без ключа → 404', noKey.status === 404, `status=${noKey.status}`);
  const badKey = await get('/api/dev-roadmap/state', 'wrong-key');
  check('неверный ключ → 404', badKey.status === 404, `status=${badKey.status}`);

  // 2. Baseline
  const s0 = await get('/api/dev-roadmap/state', KEY);
  check('state → 200', s0.status === 200, `status=${s0.status}`);
  check('7 этапов', s0.body && Array.isArray(s0.body.stages) && s0.body.stages.length === 7,
    `stages=${s0.body && s0.body.stages && s0.body.stages.length}`);
  check('108 чекпоинтов', s0.body && s0.body.overall && s0.body.overall.total === 108,
    `total=${s0.body && s0.body.overall && s0.body.overall.total}`);
  const total0 = s0.body.overall.total;
  const done0 = s0.body.overall.done;

  // Находим первый незакрытый чекпоинт
  let target = null;
  for (const st of s0.body.stages) {
    for (const it of st.items) {
      for (const cp of it.checkpoints) {
        if (!cp.done) { target = { cp, item: it, stage: st }; break; }
      }
      if (target) break;
    }
    if (target) break;
  }
  check('найден незакрытый чекпоинт', !!target, 'нет ни одного незакрытого');

  if (target) {
    // 3. Неверный PIN
    const badPin = await post(`/api/dev-roadmap/checkpoint/${target.cp.id}/close`,
      { signer: 'kostya', pin: '0000', note: 'негатив-тест' });
    check('неверный PIN → 401', badPin.status === 401, `status=${badPin.status}`);

    // 4. Закрытие верным PIN
    const close1 = await post(`/api/dev-roadmap/checkpoint/${target.cp.id}/close`,
      { signer: 'kostya', pin: PIN_KOSTYA, note: 'прогнал тесты под ролью Олега Викторовича' });
    check('закрытие → 200', close1.status === 200, `status=${close1.status} body=${JSON.stringify(close1.body).slice(0, 160)}`);
    check('подписал Костя', close1.body && close1.body.signed_by === 'Костя', `signed_by=${close1.body && close1.body.signed_by}`);
    check('прогресс вырос на 1', close1.body && close1.body.state.overall.done === done0 + 1,
      `done=${close1.body && close1.body.state.overall.done}, было ${done0}`);

    // 5. GET перечитывает изменение
    const s1 = await get('/api/dev-roadmap/state', KEY);
    check('GET видит закрытие', s1.body.overall.done === done0 + 1, `done=${s1.body.overall.done}`);
    let chk1 = null;
    for (const st of s1.body.stages) for (const it of st.items) for (const cp of it.checkpoints)
      if (cp.id === target.cp.id) chk1 = cp;
    check('чекпоинт: done=true, done_by=kostya',
      chk1 && chk1.done === true && chk1.done_by === 'kostya',
      `done=${chk1 && chk1.done}, done_by=${chk1 && chk1.done_by}`);
    check('чекпоинт: имя закрывшего = Костя', chk1 && chk1.done_by_name === 'Костя',
      `done_by_name=${chk1 && chk1.done_by_name}`);
    check('счётная доля этапа подросла', chk1 && target.stage.progress.total > 0 &&
      s1.body.stages.find(x => x.code === target.stage.code).progress.done >= target.stage.progress.done + 1,
      `stage done было ${target.stage.progress.done}`);

    // 6. Лента событий
    const ev = await get('/api/dev-roadmap/events', KEY);
    check('events → 200', ev.status === 200, `status=${ev.status}`);
    const last = ev.body && ev.body.events && ev.body.events[0];
    check('последнее событие = close от Кости',
      last && last.action === 'close' && last.signer_name === 'Костя' && last.checkpoint_id === target.cp.id,
      `last=${JSON.stringify(last).slice(0, 160)}`);
    check('в логе сохранён комментарий', last && last.note === 'прогнал тесты под ролью Олега Викторовича',
      `note=${last && last.note}`);

    // 7. Повторное закрытие → 409
    const close2 = await post(`/api/dev-roadmap/checkpoint/${target.cp.id}/close`,
      { signer: 'kostya', pin: PIN_KOSTYA });
    check('повторное закрытие → 409', close2.status === 409, `status=${close2.status}`);

    // 7b. Мусорный id → 400 (parseInt раньше глотал "1abc" → 1)
    for (const badId of ['1abc', '1.9', '-5', '0x10']) {
      const r = await post(`/api/dev-roadmap/checkpoint/${encodeURIComponent(badId)}/close`,
        { signer: 'kostya', pin: PIN_KOSTYA });
      check(`мусорный id «${badId}» → 400`, r.status === 400, `status=${r.status}`);
    }

    // 8. Reopen возвращает
    const reopen = await post(`/api/dev-roadmap/checkpoint/${target.cp.id}/reopen`,
      { signer: 'kostya', pin: PIN_KOSTYA, note: 'вернул в работу' });
    check('reopen → 200', reopen.status === 200, `status=${reopen.status}`);
    check('reopen вернул прогресс', reopen.body && reopen.body.state.overall.done === done0,
      `done=${reopen.body && reopen.body.state.overall.done}, ожидалось ${done0}`);
    const ev2 = await get('/api/dev-roadmap/events', KEY);
    check('в логе появился reopen', ev2.body.events[0] && ev2.body.events[0].action === 'reopen',
      `action=${ev2.body.events[0] && ev2.body.events[0].action}`);

    // 9. Анти-брутфорс PIN: неверные попытки копятся и упираются в 429
    const PIN_MAX = 8;
    let saw429 = false;
    for (let i = 0; i < PIN_MAX + 3; i++) {
      const r = await post(`/api/dev-roadmap/checkpoint/${target.cp.id}/close`,
        { signer: 'andrey', pin: '0000' });
      if (r.status === 429) { saw429 = true; break; }
    }
    check('анти-брутфорс: серия неверных PIN → 429', saw429, '429 так и не пришёл');
  }

  console.log(`\nИтог: ${pass} PASS / ${fail} FAIL (всего ${total0} чекпоинтов в структуре)\n`);
  if (failures.length) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
})().catch(e => { console.error('Ошибка sentinel:', e); process.exit(1); });
