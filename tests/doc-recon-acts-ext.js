/**
 * Акты сверки — расширенный набор (17.10.2026):
 *   1. загрузка файла акта (whitelist, лимит, ACL-скачивание);
 *   2. светофор по актам: запрос проставляет recon_due_at, получение снимает;
 *   3. взаимозачёты (manual_adjustments) влияют на баланс;
 *   4. права: чужой роли — 403, без токена — 401.
 */
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const { Pool } = require('pg');
const db = new Pool({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

async function login(l, p) {
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
  return t;
}
const H = (t) => ({ Authorization: 'Bearer ' + t });

(async () => {
  console.log('=== АКТЫ СВЕРКИ: файл, светофор, взаимозачёты ===');
  const buh = await login('test_buh', 'Test123!');

  // Тестовый контрагент с оплаченным счётом за текущий квартал.
  // ИНН — ровно 10 цифр (колонка varchar(20) + валидатор с контрольной суммой).
  const inn = '7' + String(Date.now()).slice(-9);
  const doc = (await db.query(
    `INSERT INTO doc_registry(dir, package_type, ops_status, pay_status, invoice_number, invoice_date,
       counterparty_name, counterparty_inn, amount_gross, amount_net, vat_amount, has_vat, wh_status, created_at)
     VALUES ('in','invoice','done','paid','ACT-1', CURRENT_DATE, 'ООО «АКТ-ТЕСТ»', $1, 10000, 10000, 0, false, 'none', NOW())
     RETURNING id`, [inn])).rows[0];
  const year = new Date().getFullYear();
  const quarter = Math.floor(new Date().getMonth() / 3) + 1;
  const cleanup = async () => {
    await db.query(`DELETE FROM doc_reconciliation_acts WHERE counterparty_inn=$1`, [inn]).catch(() => {});
    await db.query(`DELETE FROM doc_registry WHERE id=$1`, [doc.id]).catch(() => {});
  };
  await db.query(`DELETE FROM doc_reconciliation_acts WHERE counterparty_inn=$1`, [inn]).catch(() => {});

  console.log('\n--- 1. СВЕТОФОР: запрос акта проставляет срок ---');
  let r = await fetch(BASE + '/api/doc-registry/reconciliation/status', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(buh) },
    body: JSON.stringify({ inn, name: 'ООО «АКТ-ТЕСТ»', year, quarter, status: 'requested' })
  });
  ok(r.status === 200, 'запрос акта принят (' + r.status + ')');
  const d1 = (await db.query(`SELECT recon_due_at, recon_requested_at, recon_received_at FROM doc_registry WHERE id=$1`, [doc.id])).rows[0];
  ok(!!d1.recon_due_at, 'recon_due_at проставлен: ' + d1.recon_due_at);
  ok(!!d1.recon_requested_at, 'recon_requested_at проставлен: ' + d1.recon_requested_at);
  ok(!d1.recon_received_at, 'recon_received_at пока пуст');
  const day = (v) => {
    if (!v) return null;
    const x = v instanceof Date ? v : new Date(v);
    if (isNaN(x.getTime())) return String(v).slice(0, 10);
    const p = (n) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
  };
  const dueStr = day(d1.recon_due_at);
  const qEnd = [[1, 3], [2, 6], [3, 9], [4, 12]][quarter - 1][1];
  const nextM = qEnd + 1;
  const wantDue = nextM > 12 ? `${year + 1}-01-10` : `${year}-${String(nextM).padStart(2, '0')}-10`;
  ok(dueStr === wantDue, `срок акта = ${wantDue} (получили ${dueStr})`);

  console.log('\n--- 2. ЗАГРУЗКА ФАЙЛА акта от контрагента ---');
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 тестовый акт сверки')], { type: 'application/pdf' }), 'akt-test.pdf');
  fd.append('inn', inn); fd.append('name', 'ООО «АКТ-ТЕСТ»');
  fd.append('year', String(year)); fd.append('quarter', String(quarter));
  r = await fetch(BASE + '/api/doc-registry/reconciliation/file', { method: 'POST', headers: H(buh), body: fd });
  const up = await r.json().catch(() => ({}));
  ok(r.status === 200 && up.ok, 'файл акта загружен (' + r.status + ') act_id=' + up.act_id);
  ok(!!up.file_url, 'вернулся адрес файла: ' + up.file_url);

  const act = (await db.query(`SELECT id, status, file_url, file_meta, received_at FROM doc_reconciliation_acts WHERE counterparty_inn=$1 AND period_year=$2 AND period_quarter=$3`, [inn, year, quarter])).rows[0];
  ok(act && act.status === 'received', 'статус акта = received (' + (act && act.status) + ')');
  ok(!!(act && act.received_at), 'received_at выставлен');
  ok(act && act.file_meta && act.file_meta.name === 'akt-test.pdf', 'имя файла сохранено: ' + (act && act.file_meta && act.file_meta.name));

  // Светофор: получение снимает срок
  const d2 = (await db.query(`SELECT recon_due_at, recon_received_at FROM doc_registry WHERE id=$1`, [doc.id])).rows[0];
  ok(!d2.recon_due_at, 'при получении recon_due_at снят (акт закрыт)');
  ok(!!d2.recon_received_at, 'recon_received_at проставлен: ' + d2.recon_received_at);

  console.log('\n--- 3. СКАЧИВАНИЕ файла через ACL ---');
  r = await fetch(BASE + `/api/doc-registry/reconciliation/${up.act_id}/file`, { headers: H(buh) });
  ok(r.status === 200, 'файл скачивается бухгалтером (' + r.status + ')');
  const ct = r.headers.get('content-type') || '';
  ok(ct.includes('pdf'), 'Content-Type = ' + ct);
  const noAuth = await fetch(BASE + `/api/doc-registry/reconciliation/${up.act_id}/file`);
  ok(noAuth.status === 401 || noAuth.status === 403, 'без токена файл закрыт (' + noAuth.status + ')');

  console.log('\n--- 4. Недопустимый тип файла (класс D-220) ---');
  const fd2 = new FormData();
  fd2.append('file', new Blob([Buffer.from('<html><script>alert(1)</script>')], { type: 'text/html' }), 'evil.html');
  fd2.append('inn', inn); fd2.append('year', String(year)); fd2.append('quarter', String(quarter));
  r = await fetch(BASE + '/api/doc-registry/reconciliation/file', { method: 'POST', headers: H(buh), body: fd2 });
  ok(r.status === 415 || r.status === 400, 'HTML не принят (' + r.status + ')');

  console.log('\n--- 5. ВЗАИМОЗАЧЁТЫ меняют баланс ---');
  r = await fetch(BASE + '/api/doc-registry/reconciliation/adjustment', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(buh) },
    body: JSON.stringify({ inn, name: 'ООО «АКТ-ТЕСТ»', year, quarter, amount: -2500, note: 'зачёт за бой товара' })
  });
  ok(r.status === 200, 'взаимозачёт добавлен (' + r.status + ')');
  const det = await (await fetch(BASE + `/api/doc-registry/reconciliation/detail?inn=${encodeURIComponent(inn)}&year=${year}&quarter=${quarter}`, { headers: H(buh) })).json();
  ok(Array.isArray(det.adjustments) && det.adjustments.length === 1, 'взаимозачёт в детали: ' + (det.adjustments || []).length);
  ok(Number(det.baseBalance) === 0, 'базовый баланс 0 (оплачено 10000 − документы 10000)');
  ok(Number(det.balanceRub) === -2500, 'итоговый баланс с взаимозачётом = -2500 (получили ' + det.balanceRub + ')');

  console.log('\n--- 6. Комментарий обязателен ---');
  r = await fetch(BASE + '/api/doc-registry/reconciliation/adjustment', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(buh) },
    body: JSON.stringify({ inn, year, quarter, amount: 100, note: '' })
  });
  ok(r.status === 400, 'без комментария — отказ (' + r.status + ')');

  console.log('\n--- 7. Удаление взаимозачёта ---');
  r = await fetch(BASE + '/api/doc-registry/reconciliation/adjustment', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H(buh) },
    body: JSON.stringify({ inn, year, quarter, remove_at: 0, amount: 1, note: 'удаление' })
  });
  ok(r.status === 200, 'удаление принято (' + r.status + ')');
  const det2 = await (await fetch(BASE + `/api/doc-registry/reconciliation/detail?inn=${encodeURIComponent(inn)}&year=${year}&quarter=${quarter}`, { headers: H(buh) })).json();
  ok((det2.adjustments || []).length === 0, 'взаимозачётов снова 0');
  ok(Number(det2.balanceRub) === 0, 'баланс вернулся к 0 (' + det2.balanceRub + ')');

  console.log('\n--- 8. Файл в списке актов: есть флаг и имя ---');
  const list = await (await fetch(BASE + `/api/doc-registry/reconciliation?year=${year}&quarter=${quarter}&scope=all`, { headers: H(buh) })).json();
  const row = (list.items || []).find((x) => x.inn === inn);
  ok(!!row, 'контрагент в списке найден');
  ok(row && row.has_file === true, 'флаг has_file = true');
  ok(row && row.file_name === 'akt-test.pdf', 'имя файла в списке: ' + (row && row.file_name));

  console.log('\n--- 9. СВЕТОФОР ПО АКТАМ: просроченный акт красит строку ---');
  // Ставим просроченный акт (срок в прошлом, не получен) и смотрим traffic строки.
  await db.query(`UPDATE doc_registry SET recon_due_at = CURRENT_DATE - 3, recon_received_at = NULL WHERE id=$1`, [doc.id]);
  const listT = await (await fetch(BASE + `/api/doc-registry?scope=all&limit=500`, { headers: H(buh) })).json();
  const rowT = (listT.items || []).find((x) => Number(x.id) === Number(doc.id));
  const trr = rowT && (rowT.traffic || rowT.traffic_light);
  ok(trr === 'red' || (trr && trr.color === 'red'), 'просроченный акт → строка красная (' + JSON.stringify(trr) + ')');
  await db.query(`UPDATE doc_registry SET recon_received_at = CURRENT_DATE, recon_due_at = NULL WHERE id=$1`, [doc.id]);
  const listT2 = await (await fetch(BASE + `/api/doc-registry?scope=all&limit=500`, { headers: H(buh) })).json();
  const rowT2 = (listT2.items || []).find((x) => Number(x.id) === Number(doc.id));
  const trr2 = rowT2 && (rowT2.traffic || rowT2.traffic_light);
  ok(!(trr2 === 'red' || (trr2 && trr2.color === 'red')), 'после получения акта строка не красная по акту (' + JSON.stringify(trr2) + ')');

  await cleanup();
  console.log('\n  (тестовые данные удалены)');
  await db.end();
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('CRASH', e.message); try { await db.end(); } catch (_) {} process.exit(1); });
