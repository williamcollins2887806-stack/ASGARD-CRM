const BASE = 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
async function login(l, p) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
    const d = await r.json();
    let t = d.token;
    if (d.status === 'need_pin') {
      for (const pin of ['0000', '1234']) {
        const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) });
        const d2 = await r2.json().catch(() => ({}));
        if (d2.token) { t = d2.token; break; }
      }
    }
    const probe = await fetch(BASE + '/api/doc-registry/kpi', { headers: { Authorization: 'Bearer ' + t } });
    if (probe.status === 200) return t;
    await new Promise((res) => setTimeout(res, 800));
  }
  throw new Error('login failed for ' + l);
}
const H = (t) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t });
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };
(async () => {
  const t = await login('test_buh', 'Test123!');
  const call = async (method, url, body) => {
    const r = await fetch(BASE + '/api' + url, { method, headers: H(t), body: body ? JSON.stringify(body) : undefined });
    let d = null; try { d = await r.json(); } catch (_) {}
    return { st: r.status, d };
  };
  const INN = '9700000001';
  const tag = 'RECON-' + Date.now();
  // Тест должен быть воспроизводимым: остатки прошлого прогона (тот же ИНН за
  // тот же период) иначе попадают в сверку и ломают ожидаемые 2 документа и
  // баланс -4000. Чистим ПЕРЕД прогоном, а не только в конце.
  await db.query(`DELETE FROM doc_registry WHERE counterparty_inn=$1`, [INN]);
  await db.query(`DELETE FROM doc_reconciliation_acts WHERE counterparty_inn=$1`, [INN]);
  // два документа за 2026 Q4: один оплачен, один с услугой
  const d1 = (await db.query(
    `INSERT INTO doc_registry(dir, counterparty_name, counterparty_inn, invoice_number, invoice_date, amount_gross, pay_status, doc_owner_id, created_by, updated_by, currency)
     VALUES ('in', $1, $2, $3, '2026-10-05', 10000, 'paid', 1, 1, 1, 'RUB') RETURNING id`, [tag, INN, 'R-1'])).rows[0].id;
  const d2 = (await db.query(
    `INSERT INTO doc_registry(dir, counterparty_name, counterparty_inn, invoice_number, invoice_date, service_done_at, amount_gross, doc_owner_id, created_by, updated_by, currency)
     VALUES ('in', $1, $2, $3, '2026-11-05', '2026-11-10', 4000, 1, 1, 1, 'RUB') RETURNING id`, [tag, INN, 'R-2'])).rows[0].id;

  console.log('\n=== GET /reconciliation/detail ===');
  const det = await call('GET', `/doc-registry/reconciliation/detail?inn=${INN}&year=2026&quarter=4`);
  console.log('  st=' + det.st, '| docs=' + (det.d.docs || []).length, '| paid=' + det.d.paidSum, '| docsSum=' + det.d.docsSum, '| balance=' + det.d.balanceRub, '| due=' + det.d.due_at);
  (det.st === 200 && det.d.docs.length === 2) ? ok('2 документа в сверке') : bad('docs=' + (det.d && det.d.docs && det.d.docs.length));
  (det.d.paidSum === 10000 && det.d.docsSum === 14000 && det.d.balanceRub === -4000) ? ok('баланс -4000 (мы должны 4000)') : bad('баланс ' + det.d.balanceRub);
  (det.d.due_at === '2027-01-10') ? ok('дедлайн квартала = 2027-01-10') : bad('due_at=' + det.d.due_at);

  console.log('\n=== GET /reconciliation (список) ===');
  const list = await call('GET', '/doc-registry/reconciliation?year=2026&quarter=4');
  console.log('  st=' + list.st, '| items=' + (list.d.items || []).length, '| дедлайн=' + list.d.due_at);
  (list.st === 200 && Array.isArray(list.d.items)) ? ok('список отдаётся') : bad('список: ' + list.st);

  console.log('\n=== POST /reconciliation/status ===');
  const s1 = await call('POST', '/doc-registry/reconciliation/status', { inn: INN, name: tag, year: 2026, quarter: 4, status: 'requested' });
  const s2 = await call('POST', '/doc-registry/reconciliation/status', { inn: INN, name: tag, year: 2026, quarter: 4, status: 'received', comment: 'файл от контрагента' });
  const act = (await db.query(`SELECT status, received_at FROM doc_reconciliation_acts WHERE counterparty_inn=$1 AND period_year=2026 AND period_quarter=4`, [INN])).rows[0];
  console.log('  requested st=' + s1.st, 'received st=' + s2.st, '| БД=' + JSON.stringify(act));
  (s1.st === 200 && s2.st === 200 && act && act.status === 'received' && act.received_at) ? ok('статус requested→received с датой') : bad('статус: ' + JSON.stringify(act));

  console.log('\n=== дедлайн годового акта = 15.01 ===');
  const year = await call('GET', `/doc-registry/reconciliation/detail?inn=${INN}&year=2026&quarter=0`);
  console.log('  year due=' + year.d.due_at);
  (year.d.due_at === '2027-01-15') ? ok('годовой дедлайн 2027-01-15') : bad('year due=' + year.d.due_at);

  // ── V483: «Запросить/Получен» больше НЕ стирает данные акта ────────────
  // Дефект: comment, file_url и received_at затирались при каждом нажатии,
  // потому что фронт их не передаёт, а сервер писал пустые значения.
  console.log('\n=== V483: status не затирает comment/file_url ===');
  await call('POST', '/doc-registry/reconciliation/comment', {
    inn: INN, name: tag, year: 2026, quarter: 4, comment: 'заметка бухгалтерии'
  });
  const before = (await db.query(
    `SELECT comment, receive_channel, received_at FROM doc_reconciliation_acts
      WHERE counterparty_inn=$1 AND period_year=2026 AND period_quarter=4`, [INN])).rows[0];
  // Повторное «запрошен» без comment/file_url в теле — раньше обнуляло всё.
  const s3 = await call('POST', '/doc-registry/reconciliation/status', {
    inn: INN, name: tag, year: 2026, quarter: 4, status: 'requested'
  });
  const after = (await db.query(
    `SELECT comment, receive_channel, received_at FROM doc_reconciliation_acts
      WHERE counterparty_inn=$1 AND period_year=2026 AND period_quarter=4`, [INN])).rows[0];
  console.log('  было=' + JSON.stringify(before), '| стало=' + JSON.stringify(after));
  (s3.st === 200 && after.comment === 'заметка бухгалтерии')
    ? ok('комментарий акта сохранён при «запрошен»')
    : bad('комментарий затёрт: ' + JSON.stringify(after && after.comment));
  (after.received_at && String(after.received_at) === String(before.received_at))
    ? ok('дата получения не стёрта повторным «запрошен»')
    : bad('received_at потерян: ' + JSON.stringify(after && after.received_at));

  // ── V483: способ подписания акта ──────────────────────────────────────
  console.log('\n=== V483: способ подписания акта ===');
  // 2 документа: ставим ЭДО у обоих → «>50 % ЭДО» даст edo.
  await db.query(`UPDATE doc_registry SET receive_channel='edo' WHERE id IN ($1,$2)`, [d1, d2]);
  const chAuto = await call('GET', `/doc-registry/reconciliation/detail?inn=${INN}&year=2026&quarter=4`);
  (chAuto.d.receive_channel === 'edo')
    ? ok('авто: 2 из 2 по ЭДО → edo')
    : bad('авто канал=' + chAuto.d.receive_channel);
  // Ручное переопределение побеждает.
  await call('POST', '/doc-registry/reconciliation/comment', {
    inn: INN, name: tag, year: 2026, quarter: 4, receive_channel: 'original'
  });
  const chManual = await call('GET', `/doc-registry/reconciliation/detail?inn=${INN}&year=2026&quarter=4`);
  (chManual.d.receive_channel === 'original')
    ? ok('ручной выбор побеждает автоопределение')
    : bad('ручной канал=' + chManual.d.receive_channel);
  // Нет данных вовсе → unknown, НЕ original.
  await db.query(`UPDATE doc_registry SET receive_channel=NULL WHERE id IN ($1,$2)`, [d1, d2]);
  await db.query(`UPDATE doc_reconciliation_acts SET receive_channel='auto'
                   WHERE counterparty_inn=$1 AND period_year=2026 AND period_quarter=4`, [INN]);
  const chNone = await call('GET', `/doc-registry/reconciliation/detail?inn=${INN}&year=2026&quarter=4`);
  (chNone.d.receive_channel === 'unknown')
    ? ok('нет данных о канале → unknown')
    : bad('пустой канал=' + chNone.d.receive_channel);

  await db.query(`DELETE FROM doc_registry WHERE id IN ($1,$2)`, [d1, d2]);
  await db.query(`DELETE FROM doc_reconciliation_acts WHERE counterparty_inn=$1`, [INN]);
  console.log('\n────────────────────────────────────────');
  console.log(`ИТОГ актов: PASS ${pass} / FAIL ${fail}`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
