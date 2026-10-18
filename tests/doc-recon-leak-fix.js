/**
 * Повторная проверка дыр, найденных независимым верификатором 17.10.2026.
 * P0-1 path traversal, P0-2 приватный файл в статике, P1-3 баланс, P2-4 без ИНН.
 */
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

async function login(l, p) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
  const d = await r.json(); let t = d.token;
  if (d.status === 'need_pin') {
    for (const pin of ['0000', '1234']) {
      const r2 = await fetch(BASE + '/api/auth/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ pin }) });
      const d2 = await r2.json().catch(() => ({})); if (d2.token) { t = d2.token; break; }
    }
  }
  return t;
}
const H = (t) => ({ Authorization: 'Bearer ' + t });

(async () => {
  const buh = await login('test_buh', 'Test123!');
  const inn = '7' + String(Date.now()).slice(-9);
  const year = new Date().getFullYear();
  const quarter = Math.floor(new Date().getMonth() / 3) + 1;

  console.log('=== P0-1: path traversal через file_url ===');
  // Пробуем записать опасный file_url через /status.
  await fetch(BASE + '/api/doc-registry/reconciliation/status', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(buh) },
    body: JSON.stringify({ inn, year, quarter, status: 'requested', file_url: 'uploads/../.env' })
  });
  const actRow = (await db.query(`SELECT id, file_url FROM doc_reconciliation_acts WHERE counterparty_inn=$1 AND period_year=$2 AND period_quarter=$3`, [inn, year, quarter])).rows[0];
  ok(actRow && !actRow.file_url, 'опасный file_url НЕ сохранён в БД (получили ' + JSON.stringify(actRow && actRow.file_url) + ')');

  // Если traversal-путь всё же попадёт в БД вручную (старые данные) — скачивание должно отказать.
  if (actRow) {
    await db.query(`UPDATE doc_reconciliation_acts SET file_url='uploads/../.env' WHERE id=$1`, [actRow.id]);
    const r = await fetch(BASE + `/api/doc-registry/reconciliation/${actRow.id}/file`, { headers: H(buh) });
    const body = await r.text();
    ok(r.status === 400 || r.status === 404, 'скачивание traversal-пути отклонено (' + r.status + ')');
    ok(!body.includes('JWT_SECRET') && !body.includes('DB_PASSWORD'), 'содержимое .env НЕ отдано');
  }

  console.log('\n=== P0-2: приватный каталог не раздаётся статикой ===');
  // Загружаем настоящий акт и пробуем забрать его напрямую из /uploads/ (анонимом).
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 СЕКРЕТ акта сверки')], { type: 'application/pdf' }), 'act.pdf');
  fd.append('inn', inn); fd.append('year', String(year)); fd.append('quarter', String(quarter));
  const up = await (await fetch(BASE + '/api/doc-registry/reconciliation/file', { method: 'POST', headers: H(buh), body: fd })).json();
  console.log('  file_url в БД:', up.file_url);
  ok(up.file_url && up.file_url.startsWith('private/'), 'файл лёг в приватный каталог (' + up.file_url + ')');

  const direct = await fetch(BASE + '/uploads/' + up.file_url);
  ok(direct.status === 404 || direct.status === 403, 'прямой /uploads/<private> закрыт (' + direct.status + ')');
  const directBody = await direct.text().catch(() => '');
  ok(!directBody.includes('СЕКРЕТ'), 'содержимое акта анониму НЕ отдано');

  const viaAcl = await fetch(BASE + `/api/doc-registry/reconciliation/${up.act_id}/file`, { headers: H(buh) });
  ok(viaAcl.status === 200, 'через ACL файл доступен бухгалтеру (' + viaAcl.status + ')');
  const aclBody = await viaAcl.text();
  ok(aclBody.includes('СЕКРЕТ'), 'через ACL содержимое читается');

  // Файл реально лежит на диске в private/recon
  const disk = path.join(process.env.UPLOAD_DIR || './uploads', up.file_url);
  ok(fs.existsSync(disk), 'файл на диске: ' + disk.replace(process.cwd(), '.'));

  console.log('\n=== P1-3: баланс детали = баланс списка ===');
  // Документ с услугой (входит) + неоплаченный без услуги (не входит).
  const d1 = (await db.query(
    `INSERT INTO doc_registry(dir,package_type,ops_status,pay_status,invoice_number,invoice_date,
       counterparty_name,counterparty_inn,amount_gross,amount_net,vat_amount,has_vat,wh_status)
     VALUES ('in','invoice','done','paid','B-1',CURRENT_DATE,'ООО «БАЛАНС»',$1,1000,1000,0,false,'none') RETURNING id`, [inn])).rows[0];
  const d2 = (await db.query(
    `INSERT INTO doc_registry(dir,package_type,ops_status,pay_status,invoice_number,invoice_date,
       counterparty_name,counterparty_inn,amount_gross,amount_net,vat_amount,has_vat,wh_status)
     VALUES ('in','invoice','wait','wait','B-2',CURRENT_DATE,'ООО «БАЛАНС»',$1,999999,999999,0,false,'none') RETURNING id`, [inn])).rows[0];
  const det = await (await fetch(BASE + `/api/doc-registry/reconciliation/detail?inn=${encodeURIComponent(inn)}&year=${year}&quarter=${quarter}`, { headers: H(buh) })).json();
  const list = await (await fetch(BASE + `/api/doc-registry/reconciliation?year=${year}&quarter=${quarter}&scope=all`, { headers: H(buh) })).json();
  const listRow = (list.items || []).find((x) => x.inn === inn);
  console.log('  деталь: docsSum=' + det.docsSum + ' balance=' + det.balanceRub);
  console.log('  список: amount=' + (listRow && listRow.amount) + ' balance=' + (listRow && listRow.balance_rub));
  const sumShown = (det.docs || []).reduce((s, x) => s + Number(x.amount || 0), 0);
  ok(Number(det.docsSum) === sumShown, 'сумма показанных документов = docsSum (' + sumShown + ')');
  ok(Number(det.docsSum) === 1000, 'неоплаченный без услуги НЕ попал в docsSum (' + det.docsSum + ')');
  ok(Number(det.balanceRub) === Number(listRow.balance_rub), 'баланс детали = баланс списка');

  console.log('\n=== P2-4: контрагент без ИНН виден в списке ===');
  const innLess = 'ООО «БЕЗ-ИНН-' + String(Date.now()).slice(-6) + '»';
  const d3 = (await db.query(
    `INSERT INTO doc_registry(dir,package_type,ops_status,pay_status,invoice_number,invoice_date,
       counterparty_name,counterparty_inn,amount_gross,amount_net,vat_amount,has_vat,wh_status)
     VALUES ('in','invoice','done','paid','NI-1',CURRENT_DATE,$1,NULL,5000,5000,0,false,'none') RETURNING id`, [innLess])).rows[0];
  const list2 = await (await fetch(BASE + `/api/doc-registry/reconciliation?year=${year}&quarter=${quarter}&scope=all`, { headers: H(buh) })).json();
  const rowNoInn = (list2.items || []).find((x) => x.name === innLess);
  ok(!!rowNoInn, 'контрагент без ИНН найден в списке');
  ok(rowNoInn && Number(rowNoInn.balance_rub) === 0, 'баланс без ИНН считается (' + (rowNoInn && rowNoInn.balance_rub) + ')');

  // уборка
  await db.query(`DELETE FROM doc_reconciliation_acts WHERE counterparty_inn=$1`, [inn]).catch(() => {});
  await db.query(`DELETE FROM doc_registry WHERE id = ANY($1::int[])`, [[d1.id, d2.id, d3.id]]).catch(() => {});
  if (disk && fs.existsSync(disk)) fs.unlinkSync(disk);
  await db.end();
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('CRASH', e.message); try { await db.end(); } catch (_) {} process.exit(1); });
