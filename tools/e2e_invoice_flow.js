'use strict';
/**
 * D-370: сквозная проверка «загрузил счёт с телефона → распознался → ушёл
 * директору → дошёл до бухгалтерии → все поля правильные».
 *
 * Вопросы заказчика, на которые отвечает скрипт:
 *   1. Предпросмотр загруженных счетов.
 *   2. Автоматический разбор: контрагент, сумма, НДС, договор.
 *   3. Видно ли, что у контрагента уже есть счета/договора, и предлагается ли
 *      создать карточку, если он новый.
 *   4. Доходят ли все поля до бухгалтерии.
 *
 * Проверяет ДВА реальных счёта разных контрагентов и разными путями расхода
 * (работы с объектом / офис) — заказчик просил довести минимум две заявки.
 *
 * Работает на локальном стенде (:3000, БД asgard_crm_dev): на прод не ходит,
 * реальные заявки не трогает.
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(process.cwd(), '.env') });

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3000';
const SECRET = process.env.JWT_SECRET;
const PM = { id: 3474, login: 'n.androsov', role: 'PM' };
const DIR = { id: 3456, login: 'go', role: 'DIRECTOR_COMM' };
const BUH = { id: 3469, login: 'buh', role: 'BUH' };

const tok = (u) => jwt.sign({ ...u, pinVerified: true }, SECRET, { expiresIn: '2h' });
const H = (u) => ({ Authorization: 'Bearer ' + tok(u), 'Content-Type': 'application/json' });

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`); }
};

async function api(method, url, user, body) {
  const res = await fetch(BASE + url, {
    method, headers: H(user), ...(body ? { body: JSON.stringify(body) } : {})
  });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch (_) { /* не JSON */ }
  return { status: res.status, json, text: txt };
}

async function uploadPdf(user, filePath) {
  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'application/pdf' }), path.basename(filePath));
  const res = await fetch(BASE + '/api/payment-invoices/upload', {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok(user) }, body: fd
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Полный проход одного счёта. */
async function runOne(file, spendKind, label) {
  console.log(`\n════════ ${label} ════════`);
  console.log('  файл:', path.basename(file), '| вид расхода:', spendKind);

  console.log('\n── Загрузка и черновик ──');
  const up = await uploadPdf(PM, file);
  ok('upload → 200', up.status === 200, up.status);
  ok('вернулся file_path', !!(up.json && up.json.file_path));

  const created = await api('POST', '/api/payment-invoices', PM, {
    amount: 0, supplier_name: 'Распознаётся…',
    file_path: up.json.file_path, file_name: up.json.file_name || path.basename(file),
    basis_type: 'other'
  });
  ok('POST / (черновик) → 200', created.status === 200, created.status);
  const id = created.json && created.json.id;
  ok('id счёта получен', !!id, id);

  console.log('\n── Автоматическое распознавание ──');
  const rec = await api('POST', `/api/payment-invoices/${id}/recognize`, PM, {});
  ok('recognize → 200', rec.status === 200, rec.status);
  const f = (rec.json && rec.json.fields) || {};
  console.log('  движок:', (rec.json && rec.json.engine) || '—');
  console.log('  распознано:', JSON.stringify({
    контрагент: f.supplier_name, инн: f.inn, номер: f.invoice_number,
    дата: f.invoice_date, сумма: f.amount, ндс: f.vat_amount,
    ставка: f.vat_rate, нетто: f.amount_net, договор: f.contract_number,
    позиций: (f.lines || []).length
  }));
  ok('контрагент распознан', !!f.supplier_name, f.supplier_name);
  ok('сумма распознана', Number(f.amount) > 0, f.amount);
  ok('НДС распознан', Number(f.vat_amount) > 0 || Number(f.vat_rate) > 0,
    { vat: f.vat_amount, rate: f.vat_rate });
  ok('номер счёта', !!f.invoice_number, f.invoice_number);
  ok('дата счёта', !!f.invoice_date, f.invoice_date);
  ok('ИНН распознан', !!f.inn, f.inn);
  ok('позиции разобраны', (f.lines || []).length > 0, (f.lines || []).length);

  console.log('\n── Что записалось в карточку заявки ──');
  // D-372: распознавание пишет ИНН и supplier_id отдельным UPDATE после OCR.
  // Тест читал карточку сразу и иногда ловил промежуточное состояние
  // (supplier_id=null), хотя через мгновение всё на месте. Даём записи
  // зафиксироваться: ждём до 6 с появления ИНН.
  let row = null;
  for (let i = 0; i < 12; i++) {
    row = await api('GET', `/api/payment-invoices/${id}`, PM);
    const rr = row.json || {};
    const innNow = rr.counterparty_inn || (rr.supplier && rr.supplier.inn) || '';
    if (innNow && rr.supplier_id) break;
    await new Promise((res) => setTimeout(res, 500));
  }
  const r = row.json || {};
  const innVal = r.counterparty_inn || (r.supplier && r.supplier.inn) || '';
  console.log('  в БД:', JSON.stringify({
    supplier: r.supplier_name, supplier_id: r.supplier_id, amount: r.amount,
    vat: r.vat_amount, rate: r.vat_rate, net: r.amount_net,
    number: r.invoice_number, date: r.invoice_date, inn: innVal,
    contract: r.contract_basis_number, contract_id: r.contract_id
  }));
  ok('контрагент в БД', r.supplier_name && r.supplier_name !== 'Распознаётся…', r.supplier_name);
  ok('сумма в БД > 0', Number(r.amount) > 0, r.amount);
  ok('НДС в БД', Number(r.vat_amount) > 0 || Number(r.vat_rate) > 0, { v: r.vat_amount, rt: r.vat_rate });
  ok('ИНН в БД', !!innVal, innVal);
  ok('карточка поставщика привязана', !!r.supplier_id, r.supplier_id);
  ok('нетто + НДС = сумма', Math.abs((Number(r.amount_net) + Number(r.vat_amount)) - Number(r.amount)) < 0.02,
    { net: r.amount_net, vat: r.vat_amount, gross: r.amount });

  console.log('\n── Счётчики контрагента (история в СРМ) ──');
  if (innVal) {
    const sug = await api('GET', `/api/customers/registry-suggest?q=${encodeURIComponent(innVal)}&limit=3`, PM);
    const list = (sug.json && sug.json.suppliers) || [];
    ok('registry-suggest → 200', sug.status === 200, sug.status);
    ok('контрагент найден в справочнике', list.length > 0, list.length);
    if (list[0]) {
      console.log('  счётчики:', JSON.stringify({
        name: list[0].name, docs: list[0].docs_count, contracts: list[0].contracts_count,
        phone: list[0].phone || '—'
      }));
      ok('docs_count отдаётся', list[0].docs_count !== undefined, list[0].docs_count);
      ok('contracts_count отдаётся', list[0].contracts_count !== undefined, list[0].contracts_count);
    }
  } else {
    ok('ИНН для счётчиков', false, 'не распознан');
  }

  console.log('\n── Поиск договора ──');
  const cnum = r.contract_basis_number;
  const cs = await api('GET',
    `/api/payment-invoices/contract-search?q=${encodeURIComponent(cnum || 'ДП')}`, PM);
  ok('contract-search → 200', cs.status === 200, cs.status);
  console.log('  по запросу', JSON.stringify(cnum || 'ДП'), 'найдено:',
    (cs.json && cs.json.items || []).length);

  console.log('\n── Предпросмотр файла ──');
  const prevHdr = await fetch(BASE + `/api/payment-invoices/preview/${id}`,
    { headers: { Authorization: 'Bearer ' + tok(PM) } });
  ok('preview с заголовком → 200', prevHdr.status === 200, prevHdr.status);
  ok('preview отдаёт картинку', /image/i.test(prevHdr.headers.get('content-type') || ''),
    prevHdr.headers.get('content-type'));
  const prevUrl = await fetch(BASE + `/api/payment-invoices/preview/${id}?token=` + encodeURIComponent(tok(PM)));
  ok('preview по ?token → 200 (как <img>)', prevUrl.status === 200, prevUrl.status);
  const orig = await fetch(BASE + `/api/payment-invoices/${id}/file`,
    { headers: { Authorization: 'Bearer ' + tok(PM) } });
  ok('оригинал PDF → 200', orig.status === 200 && /pdf/i.test(orig.headers.get('content-type') || ''),
    orig.headers.get('content-type'));

  console.log('\n── Отправка и согласование ──');
  const patched = await api('PATCH', `/api/payment-invoices/${id}`, PM, {
    spend_kind: spendKind,
    sf_due_at: '2026-11-15', sf_basis: 'invoice',
    comment_text: 'E2E: сквозной сценарий ' + label
  });
  ok('PATCH условий → 200', patched.status === 200, patched.status);

  const sub = await api('POST', '/api/payment-invoices/submit', PM, { ids: [id] });
  ok('submit → 200', sub.status === 200, sub.status);
  ok('счёт отправлен', ((sub.json && sub.json.submitted) || []).includes(id));

  const dirApp = await api('POST', `/api/payment-invoices/${id}/dir-approve`, DIR, {});
  ok('dir-approve → 200', dirApp.status === 200, dirApp.status);

  const afterDir = await api('GET', `/api/payment-invoices/${id}`, DIR);
  const a = afterDir.json || {};
  ok('статус = pending_payment (у бухгалтерии)', a.status === 'pending_payment', a.status);
  ok('строка реестра связана', !!a.doc_registry_id, a.doc_registry_id);

  console.log('\n── Что увидела бухгалтерия ──');
  console.log('  карточка:', JSON.stringify({
    supplier: a.supplier_name, amount: a.amount, vat: a.vat_amount, rate: a.vat_rate,
    net: a.amount_net, number: a.invoice_number, date: a.invoice_date,
    spend_kind: a.spend_kind, sf_basis: a.sf_basis, inn: a.counterparty_inn
  }));
  ok('бухгалтерия: сумма', Number(a.amount) > 0, a.amount);
  ok('бухгалтерия: НДС', Number(a.vat_amount) > 0 || Number(a.vat_rate) > 0, a.vat_amount);
  ok('бухгалтерия: вид расхода', a.spend_kind === spendKind, a.spend_kind);
  ok('бухгалтерия: основание СФ', !!a.sf_basis, a.sf_basis);
  ok('бухгалтерия: номер и дата', !!(a.invoice_number && a.invoice_date));
  ok('бухгалтерия: ИНН', !!(a.counterparty_inn || (a.supplier && a.supplier.inn)),
    a.counterparty_inn);

  if (a.doc_registry_id) {
    const reg = await api('GET', `/api/doc-registry/${a.doc_registry_id}`, BUH);
    const dr = reg.json || {};
    console.log('  реестр:', JSON.stringify({
      name: dr.counterparty_name, gross: dr.amount_gross, net: dr.amount_net,
      vat: dr.vat_amount, rate: dr.vat_rate, number: dr.invoice_number,
      date: dr.invoice_date, spend_kind: dr.spend_kind, sf_basis: dr.sf_basis,
      reasons: dr.incomplete_reasons
    }));
    ok('реестр: сумма совпадает', Math.abs(Number(dr.amount_gross) - Number(a.amount)) < 0.02,
      { doc: dr.amount_gross, pay: a.amount });
    ok('реестр: нетто + НДС = сумма',
      Math.abs((Number(dr.amount_net) + Number(dr.vat_amount)) - Number(dr.amount_gross)) < 0.02);
    ok('реестр: ставка в долях (<=1)', Number(dr.vat_rate) <= 1, dr.vat_rate);
    ok('реестр: вид расхода перенесён', dr.spend_kind === spendKind, dr.spend_kind);
    ok('реестр: основание СФ перенесено', dr.sf_basis === 'invoice', dr.sf_basis);
    ok('реестр: номер счёта есть', !!dr.invoice_number, dr.invoice_number);
    // Метка «нужен объект» должна соответствовать виду расхода:
    // для работ без объекта — стоять, для офиса — отсутствовать.
    const reasons = dr.incomplete_reasons || [];
    const hasTag = reasons.includes('no_work_for_expense');
    const expected = spendKind === 'work' && !dr.work_id;
    ok('реестр: метка «нужен объект» по делу', hasTag === expected,
      { kind: spendKind, work_id: dr.work_id, has: hasTag });
  }

  return id;
}

(async () => {
  if (!SECRET) throw new Error('JWT_SECRET не найден');

  console.log('══ Стенд ══');
  const h = await fetch(BASE + '/api/health');
  ok('стенд отвечает', h.ok, h.status);

  // Два реальных счёта РАЗНЫХ контрагентов — заказчик просил довести две заявки.
  const dir = 'tests/fixtures/real-invoices';
  const all = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.pdf'));
  const picks = [
    all.find((n) => /Радио/i.test(n)),
    all.find((n) => /Высот/i.test(n)),
  ].filter(Boolean);
  if (picks.length < 2) throw new Error('нужны 2 тестовых PDF, найдено ' + picks.length);

  const id1 = await runOne(path.join(dir, picks[0]), 'work', 'СЧЁТ 1: работы по объекту');
  const id2 = await runOne(path.join(dir, picks[1]), 'office', 'СЧЁТ 2: офисный расход');

  console.log('\n══ Итог по двум заявкам ══');
  const a = await api('GET', `/api/payment-invoices/${id1}`, BUH);
  const b = await api('GET', `/api/payment-invoices/${id2}`, BUH);
  console.log(`  #${id1}: ${a.json.supplier_name} / ${a.json.amount} ₽ / ${a.json.status} / реестр ${a.json.doc_registry_id}`);
  console.log(`  #${id2}: ${b.json.supplier_name} / ${b.json.amount} ₽ / ${b.json.status} / реестр ${b.json.doc_registry_id}`);
  ok('обе заявки у бухгалтерии',
    a.json.status === 'pending_payment' && b.json.status === 'pending_payment',
    { id1: a.json.status, id2: b.json.status });
  ok('у обеих есть строка реестра',
    !!a.json.doc_registry_id && !!b.json.doc_registry_id,
    { id1: a.json.doc_registry_id, id2: b.json.doc_registry_id });

  console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
