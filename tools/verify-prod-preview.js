/**
 * Проверка предпросмотра на ЖИВОМ проде.
 *
 * Контекст: на клоне 404, потому что каталога `uploads/rp_estimates/1939` там нет
 * (клон БД без файлов). На проде файл лежит на месте (проверено `ls`). Значит
 * надо убедиться, что эндпоинт отдаёт файл ИМЕННО на проде, а не гадать.
 *
 * Прод не меняем: только чтение. Нужен токен — берём входом через API.
 */
const BASE = 'https://asgard-crm.ru';
const LOGIN = process.env.ASGARD_LOGIN || 'test_director_gen';
const PASSWORD = process.env.ASGARD_PASSWORD || 'TestDirector!2026';
const PIN = process.env.ASGARD_PIN || '4321';

(async () => {
  // Вход
  const lj = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASSWORD }),
  })).json();

  if (!lj.token) {
    console.log('Не удалось войти:', JSON.stringify(lj).slice(0, 200));
    console.log('\nНужны рабочие креды для проверки preview на проде.');
    process.exit(2);
  }
  let token = lj.token;
  if (lj.status === 'need_pin') {
    const pj = await (await fetch(BASE + '/api/auth/verify-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: PIN }),
    })).json();
    token = pj.token || token;
    console.log('PIN:', pj.token ? 'принят' : 'НЕ принят');
  }
  console.log('вход:', lj.status, '| токен:', !!token);

  const get = async (p) => {
    const r = await fetch(BASE + p, { headers: { Authorization: 'Bearer ' + token } });
    return { status: r.status, ct: r.headers.get('content-type'), len: r.headers.get('content-length'), url: p };
  };

  // Проверяем предпросмотр по файлам просчёта тендера 1939 (те, что точно есть на диске).
  console.log('\n=== предпросмотр файлов тендера 1939 ===');
  for (const docId of [497, 498, 499]) {
    const r = await get(`/api/tenders/1939/rp-review/files/${docId}/preview`);
    const ok = r.status === 200;
    console.log(`  файл ${docId}: ${r.status} ${ok ? 'OK' : 'НЕ ОТКРЫЛСЯ'} | ${r.ct || '-'} | ${r.len || '?'} байт`);
  }

  // Для сравнения: файл другого тендера, который тоже есть на диске.
  console.log('\n=== для сравнения: файлы других тендеров ===');
  for (const [tid, did] of [[2114, 1390], [2093, 1260], [2087, 1234]]) {
    const r = await get(`/api/tenders/${tid}/rp-review/files/${did}/preview`);
    console.log(`  тендер ${tid}, файл ${did}: ${r.status} | ${r.ct || '-'}`);
  }
})();
