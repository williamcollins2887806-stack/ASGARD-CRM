#!/usr/bin/env node
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const DRY_RUN = process.argv.includes('--dry-run');
const pool = new Pool({
  host: 'localhost', port: 5432,
  database: 'asgard_crm', user: 'asgard', password: '123456789'
});
const stats = { customers: {created:0, updated:0, skipped:0}, tkp: {created:0, skipped:0, errors:0}, invoices: {created:0, skipped:0, errors:0}, works: {created:0, skipped:0, errors:0} };
function parseCSV(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { current.push(field.trim()); field = ''; }
      else if (c === '\n' || (c === '\r' && text[i+1] === '\n')) {
        if (c === '\r') i++;
        current.push(field.trim());
        if (current.length > 1 || current[0] !== '') rows.push(current);
        current = []; field = '';
      } else { field += c; }
    }
  }
  if (field || current.length) { current.push(field.trim()); rows.push(current); }
  return rows;
}
function parseDate(str) {
  if (!str) return null;
  const m = str.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  const m2 = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return str.slice(0, 10);
  return null;
}
function parseNum(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}
function cleanHTML(str) {
  return String(str || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}
async function importCounterparties() {
  console.log('\n=== Importing Counterparties ===');
  const raw = fs.readFileSync('/tmp/counterparties.json', 'utf8');
  const data = JSON.parse(raw);
  const entries = Object.values(data);
  console.log('Total counterparties in file:', entries.length);
  for (const c of entries) {
    if (!c.inn || !c.name) { stats.customers.skipped++; continue; }
    const exists = await pool.query('SELECT id FROM customers WHERE inn = $1', [c.inn]);
    if (exists.rows.length > 0) {
      if (!DRY_RUN) {
        await pool.query("UPDATE customers SET full_name = COALESCE(NULLIF($2, ''), full_name), kpp = COALESCE(NULLIF($3, ''), kpp), ogrn = COALESCE(NULLIF($4, ''), ogrn), legal_address = COALESCE(NULLIF($5, ''), legal_address) WHERE inn = $1", [c.inn, c.full_name || '', c.kpp || '', c.ogrn || '', c.address || '']);
      }
      stats.customers.updated++;
    } else {
      if (!DRY_RUN) {
        await pool.query('INSERT INTO customers (name, inn, full_name, kpp, ogrn, legal_address, phone, email, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) ON CONFLICT (inn) DO NOTHING', [c.short_name || c.name, c.inn, c.full_name || c.name, c.kpp || '', c.ogrn || '', c.address || '', c.phone || '', c.email || '']);
      }
      stats.customers.created++;
    }
  }
  console.log('Counterparties:', JSON.stringify(stats.customers));
}
async function importQuotes() {
  console.log('\n=== Importing Quotes (TKP) ===');
  const text = fs.readFileSync('/tmp/quotes.csv', 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCSV(text);
  const header = rows[0];
  console.log('Header:', header.join(' | '));
  console.log('Total rows:', rows.length - 1);
  const colIdx = {};
  header.forEach((h, i) => colIdx[h] = i);
  const grouped = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const num = r[colIdx['\u041d\u043e\u043c\u0435\u0440']] || '';
    if (!num) continue;
    if (!grouped[num]) grouped[num] = { rows: [], first: r };
    grouped[num].rows.push(r);
  }
  console.log('Unique quotes:', Object.keys(grouped).length);
  const stageMap = {'\u041d\u043e\u0432\u043e\u0435': 'draft', '\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u043a\u043b\u0438\u0435\u043d\u0442\u0443': 'sent', '\u041f\u0440\u0438\u043d\u044f\u0442\u043e': 'accepted', '\u0412\u044b\u0438\u0433\u0440\u0430\u043d\u043e': 'accepted', '\u041f\u0440\u043e\u0438\u0433\u0440\u0430\u043d\u043e': 'rejected', '\u041e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u043e': 'rejected'};
  for (const [num, group] of Object.entries(grouped)) {
    const r = group.first;
    const company = r[colIdx['\u041a\u043e\u043c\u043f\u0430\u043d\u0438\u044f']] || '';
    const tema = r[colIdx['\u0422\u0435\u043c\u0430']] || '';
    const sum = parseNum(r[colIdx['\u0421\u0443\u043c\u043c\u0430']]);
    const stage = r[colIdx['\u0421\u0442\u0430\u0434\u0438\u044f']] || '';
    const created = r[colIdx['\u041a\u043e\u0433\u0434\u0430 \u0441\u043e\u0437\u0434\u0430\u043d']] || '';
    const dedupKey = 'b24q_' + num;
    const exists = await pool.query('SELECT id FROM tkp WHERE source = $1', [dedupKey]);
    if (exists.rows.length > 0) { stats.tkp.skipped++; continue; }
    const items = group.rows.map(row => ({name: row[colIdx['\u0422\u043e\u0432\u0430\u0440']] || tema, price: parseNum(row[colIdx['\u0426\u0435\u043d\u0430']]) || 0, qty: parseNum(row[colIdx['\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e']]) || 1, unit: '\u0448\u0442'})).filter(it => it.name);
    const status = stageMap[stage] || 'draft';
    const createdAt = parseDate(created);
    const tenderMatch = await pool.query("SELECT id FROM tenders WHERE customer_name ILIKE $1 LIMIT 1", ['%' + company.replace(/["']/g, '').substring(0, 30) + '%']);
    const tenderId = tenderMatch.rows.length > 0 ? tenderMatch.rows[0].id : null;
    if (!DRY_RUN) {
      try {
        await pool.query("INSERT INTO tkp (customer_name, subject, items, total_sum, final_sum, status, source, work_description, validity_days, created_at, tender_id) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, 30, COALESCE($9::timestamp, NOW()), $10)", [company, tema, JSON.stringify(items), sum || 0, sum ? sum * 1.2 : 0, status, dedupKey, tema, createdAt, tenderId]);
        stats.tkp.created++;
      } catch(e) { console.error('TKP error:', num, e.message); stats.tkp.errors++; }
    } else { stats.tkp.created++; }
  }
  console.log('TKP:', JSON.stringify(stats.tkp));
}
async function importInvoices() {
  console.log('\n=== Importing Invoices ===');
  const text = fs.readFileSync('/tmp/invoices.csv', 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCSV(text);
  const header = rows[0];
  console.log('Header:', header.slice(0, 10).join(' | '));
  console.log('Total rows:', rows.length - 1);
  const colIdx = {};
  header.forEach((h, i) => colIdx[h] = i);
  const statusMap = {'\u041d\u043e\u0432\u044b\u0439': 'pending', '\u041e\u043f\u043b\u0430\u0447\u0435\u043d': 'paid', '\u0427\u0430\u0441\u0442\u0438\u0447\u043d\u043e \u043e\u043f\u043b\u0430\u0447\u0435\u043d': 'partial', '\u041e\u0442\u043a\u043b\u043e\u043d\u0451\u043d': 'cancelled', '\u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d': 'overdue', '\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d': 'sent'};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 5) continue;
    const num = r[colIdx['\u041d\u043e\u043c\u0435\u0440']] || '';
    const tema = cleanHTML(r[colIdx['\u0422\u0435\u043c\u0430']] || '');
    const sum = parseNum(r[colIdx['\u0421\u0443\u043c\u043c\u0430']]);
    const company = r[colIdx['\u041a\u043e\u043c\u043f\u0430\u043d\u0438\u044f']] || '';
    const b24Status = r[colIdx['\u0421\u0442\u0430\u0442\u0443\u0441']] || '';
    const created = r[colIdx['\u0414\u0430\u0442\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f']] || '';
    const b24Id = r[colIdx['ID']] || '';
    const docNum = r[colIdx['\u041d\u043e\u043c\u0435\u0440 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430']] || '';
    const payDate = r[colIdx['\u0414\u0430\u0442\u0430 \u043e\u043f\u043b\u0430\u0442\u044b']] || '';
    const dedupNum = 'B24-' + (docNum || num || b24Id);
    const exists = await pool.query('SELECT id FROM invoices WHERE invoice_number = $1', [dedupNum]);
    if (exists.rows.length > 0) { stats.invoices.skipped++; continue; }
    const status = statusMap[b24Status] || 'pending';
    const vatPct = 20;
    const amount = sum ? sum / 1.2 : 0;
    const createdAt = parseDate(created);
    const tenderMatch = await pool.query("SELECT id FROM tenders WHERE customer_name ILIKE $1 LIMIT 1", ['%' + company.replace(/["']/g, '').substring(0, 30) + '%']);
    const tenderId = tenderMatch.rows.length > 0 ? tenderMatch.rows[0].id : null;
    if (!DRY_RUN) {
      try {
        await pool.query("INSERT INTO invoices (invoice_number, invoice_date, amount, total_amount, vat_pct, status, customer_name, description, source, tender_id, created_at) VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, 'bitrix24', $9, COALESCE($10::timestamp, NOW()))", [dedupNum, createdAt, amount, sum || 0, vatPct, status, company, tema, tenderId, createdAt]);
        stats.invoices.created++;
      } catch(e) { console.error('Invoice error:', num, e.message); stats.invoices.errors++; }
    } else { stats.invoices.created++; }
  }
  console.log('Invoices:', JSON.stringify(stats.invoices));
}
async function createWorks() {
  console.log('\n=== Creating Works from Won Tenders ===');
  const res = await pool.query("SELECT t.id, t.customer_name, t.customer_inn, t.tender_title, t.tender_price, t.work_start_plan, t.work_end_plan, t.responsible_pm_id, t.source FROM tenders t LEFT JOIN works w ON w.tender_id = t.id WHERE w.id IS NULL AND (t.source = '\u041f\u0440\u043e\u0435\u043a\u0442' OR t.tender_status IN ('\u041a\u043b\u0438\u0435\u043d\u0442 \u0441\u043e\u0433\u043b\u0430\u0441\u0438\u043b\u0441\u044f', '\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u043a \u0440\u0430\u0431\u043e\u0442\u0430\u043c', '\u0412 \u0440\u0430\u0431\u043e\u0442\u0435', '\u041f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0430\u043a\u0442\u0430', '\u0420\u0430\u0431\u043e\u0442\u044b \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u044b'))");
  console.log('Tenders without works:', res.rows.length);
  for (const t of res.rows) {
    const tkpRes = await pool.query('SELECT total_sum FROM tkp WHERE tender_id = $1 AND total_sum > 0 ORDER BY total_sum DESC LIMIT 1', [t.id]);
    const tkpSum = tkpRes.rows.length > 0 ? tkpRes.rows[0].total_sum : null;
    const contractSum = t.tender_price || tkpSum || 0;
    const costPlan = tkpSum ? tkpSum / 2 : (contractSum > 0 ? contractSum / 2 : null);
    if (!DRY_RUN) {
      try {
        await pool.query("INSERT INTO works (tender_id, customer_name, customer_inn, work_title, work_status, contract_value, cost_plan, pm_id, start_in_work_date, end_plan, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())", [t.id, t.customer_name, t.customer_inn, t.tender_title, '\u041d\u043e\u0432\u0430\u044f', contractSum, costPlan, t.responsible_pm_id, t.work_start_plan || null, t.work_end_plan || null]);
        stats.works.created++;
      } catch(e) { console.error('Work error:', t.id, e.message); stats.works.errors++; }
    } else { stats.works.created++; }
  }
  console.log('Works:', JSON.stringify(stats.works));
}

async function main() {
  console.log(DRY_RUN ? '*** DRY RUN MODE ***' : '*** LIVE MODE ***');
  console.log('Started at:', new Date().toISOString());
  try {
    await importCounterparties();
    await importQuotes();
    await importInvoices();
    await createWorks();
  } catch(e) { console.error('FATAL:', e); }
  console.log('\n========== FINAL STATS ==========');
  console.log(JSON.stringify(stats, null, 2));
  console.log('Finished at:', new Date().toISOString());
  await pool.end();
}
main();
