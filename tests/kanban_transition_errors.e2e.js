/**
 * Гейт перехода карты канбана: ошибка обязана быть понятной.
 *
 * Класс дефекта (23.10.2026, скриншот пользователя): при переводе карты на
 * другой этап показывалось «Не получилось / bad_request». Причина — хук onSend
 * затирал протокольный код ручки на общий `bad_request`.
 *
 * Проверяем на живом приложении-двойнике (:3100, клон БД):
 *   1) недопустимый переход (work → kp_prep) отдаёт осмысленный код + текст;
 *   2) несуществующая карта — not_found + текст;
 *   3) несуществующая колонка — invalid_to_v3_column + текст;
 *   4) ни в одном ответе нет машинного огрызка вместо объяснения.
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1', port: 5432, database: 'asgard_crm_test',
  user: 'asgard', password: '123456789',
});

let pass = 0, fail = 0, fails = [];
function ok(n, c, e) {
  if (c) { pass++; console.log('  ✅ ' + n + (e ? ' — ' + e : '')); }
  else { fail++; fails.push(n); console.log('  ❌ ' + n + ' — ' + (e || '')); }
}

const isHuman = (s) => /[А-Яа-яЁё]/.test(String(s || ''));
const isMachineOnly = (s) => /^[a-z][a-z0-9_]*$/.test(String(s || ''));

(async () => {
  // Ждём приложение
  let up = false;
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) { up = true; break; } } catch (_) {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!up) { console.log('SKIP: приложение на ' + BASE + ' не поднято'); await pool.end(); process.exit(0); }

  const login = async (l, p) => {
    const r = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: l, password: p }),
    });
    const d = await r.json();
    let t = d.token;
    if (d.status === 'need_pin') {
      const r2 = await fetch(BASE + '/api/auth/verify-pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ pin: '0000' }),
      });
      const d2 = await r2.json();
      if (d2.token) t = d2.token;
    }
    return t;
  };

  const token = await login('test_admin', 'Test123!');
  if (!token) { console.log('SKIP: не удалось залогиниться test_admin'); await pool.end(); process.exit(0); }

  const call = async (cardId, toCol) => {
    const r = await fetch(`${BASE}/api/personal-kanban/cards/${cardId}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ to_v3_column: toCol, confirm: true }),
    });
    let d = null;
    try { d = await r.json(); } catch (_) {}
    return { st: r.status, d: d || {} };
  };

  // Берём work-карту: для work-flow разрешена только колонка work.
  const workCard = (await pool.query(
    `SELECT id FROM personal_kanban_cards WHERE flow_type='work' AND is_closed=false ORDER BY id LIMIT 1`
  )).rows[0];
  const anyCard = (await pool.query(
    `SELECT id, flow_type FROM personal_kanban_cards WHERE is_closed=false ORDER BY id LIMIT 1`
  )).rows[0];

  console.log('\n=== 1. Недопустимый переход объяснён по-русски ===');
  if (workCard) {
    const r = await call(workCard.id, 'kp_prep');
    const msg = String(r.d.message || '');
    ok('код не затёрт на bad_request', r.d.error !== 'bad_request' || r.d.code !== undefined,
      `error=${r.d.error} code=${r.d.code}`);
    ok('есть русское объяснение', isHuman(msg) || isHuman(r.d.error), `error="${r.d.error}" msg="${msg.slice(0, 60)}"`);
    ok('есть подсказка «что делать»', !!r.d.hint && String(r.d.hint).length > 15, `hint="${String(r.d.hint || '').slice(0, 55)}"`);
    ok('пользователь не видит машинный огрызок', !isMachineOnly(r.d.error) || isHuman(msg),
      `error="${r.d.error}" msg="${msg.slice(0, 45)}"`);
  } else {
    console.log('  ⏭  нет work-карты на клоне — пропуск');
  }

  console.log('\n=== 2. Несуществующая карта ===');
  {
    const r = await call(99999999, 'calc');
    ok('статус 404', r.st === 404, `st=${r.st}`);
    ok('код not_found доступен', r.d.error === 'not_found' || r.d.code === 'not_found', `error=${r.d.error} code=${r.d.code}`);
    ok('есть русский текст + hint', isHuman(r.d.message) && !!r.d.hint, `"${String(r.d.message || '').slice(0, 45)}"`);
  }

  console.log('\n=== 3. Несуществующая колонка ===');
  if (anyCard) {
    const r = await call(anyCard.id, 'no_such_column');
    ok('статус 400', r.st === 400, `st=${r.st}`);
    ok('код invalid_to_v3_column доступен',
      r.d.error === 'invalid_to_v3_column' || r.d.code === 'invalid_to_v3_column',
      `error=${r.d.error} code=${r.d.code}`);
    ok('есть русский текст + hint', isHuman(r.d.message) && !!r.d.hint, `"${String(r.d.message || '').slice(0, 45)}"`);
  }

  await pool.end();
  console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
  if (fails.length) { console.log('ПРОВАЛЫ:'); fails.forEach((f) => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
