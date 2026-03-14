/**
 * Reconcile Excel invoices with CRM work_expenses
 * Find missing records and try to link unlinked expenses to works
 */
const { Client } = require('pg');
const fs = require('fs');

const DB = {
  host: 'localhost',
  port: 5432,
  database: 'asgard_crm',
  user: 'asgard',
  password: '123456789',
};

async function main() {
  const client = new Client(DB);
  await client.connect();

  // Load Excel data
  const excel = JSON.parse(fs.readFileSync('/tmp/excel_invoices.json', 'utf8'));
  console.log(`Excel rows: ${excel.length}`);

  // Get CRM expenses
  const { rows: expenses } = await client.query(`
    SELECT id, description, amount, date, counterparty, document_number, work_id, import_hash
    FROM work_expenses ORDER BY id
  `);
  console.log(`CRM expenses: ${expenses.length}`);

  // Build lookup by amount+counterparty for matching
  const crmByAmount = {};
  for (const e of expenses) {
    const key = parseFloat(e.amount).toFixed(2);
    if (!crmByAmount[key]) crmByAmount[key] = [];
    crmByAmount[key].push(e);
  }

  // Find Excel rows not in CRM
  const missing = [];
  const matched = new Set();

  for (const row of excel) {
    const amt = parseFloat(row.amount || 0).toFixed(2);
    const candidates = crmByAmount[amt] || [];

    let found = false;
    for (const c of candidates) {
      if (matched.has(c.id)) continue;
      // Match by amount (and optionally by contractor/date)
      const contraMatch = !row.contractor || !c.counterparty ||
        c.counterparty.toLowerCase().includes((row.contractor || '').substring(0, 10).toLowerCase()) ||
        (row.contractor || '').toLowerCase().includes((c.counterparty || '').substring(0, 10).toLowerCase());

      if (contraMatch || candidates.filter(x => !matched.has(x.id)).length === 1) {
        matched.add(c.id);
        found = true;
        break;
      }
    }

    if (!found) {
      // Try just by amount (relaxed matching)
      for (const c of candidates) {
        if (!matched.has(c.id)) {
          matched.add(c.id);
          found = true;
          break;
        }
      }
    }

    if (!found) {
      missing.push(row);
    }
  }

  console.log(`\nMatched: ${matched.size}`);
  console.log(`Missing from CRM: ${missing.length}`);

  if (missing.length > 0) {
    console.log(`\n--- MISSING RECORDS ---`);
    let totalMissing = 0;
    for (const m of missing) {
      console.log(`  Object: ${(m.object || m.for_object || '').substring(0, 40)}`);
      console.log(`  Amount: ${m.amount} | Contractor: ${(m.contractor || '').substring(0, 40)}`);
      console.log(`  Invoice: ${m.invoice_num || ''} | Date: ${m.date || ''}`);
      console.log('');
      totalMissing += parseFloat(m.amount || 0);
    }
    console.log(`Total missing amount: ${totalMissing.toFixed(2)}`);
  }

  // Now try to link unlinked expenses to works
  console.log('\n\n--- LINKING UNLINKED EXPENSES TO WORKS ---');

  const { rows: unlinked } = await client.query(`
    SELECT id, description, amount, counterparty, category
    FROM work_expenses WHERE work_id IS NULL ORDER BY description
  `);
  console.log(`Unlinked expenses: ${unlinked.length}`);

  // Get works with their tenders
  const { rows: works } = await client.query(`
    SELECT w.id, w.work_title, t.customer_name, t.tender_title
    FROM works w
    LEFT JOIN tenders t ON t.id = w.tender_id
    ORDER BY w.work_title
  `);

  // Build search index for works
  const workIndex = works.map(w => ({
    id: w.id,
    title: (w.work_title || '').toLowerCase(),
    customer: (w.customer_name || '').toLowerCase(),
    tender: (w.tender_title || '').toLowerCase(),
  }));

  // Try to match each unlinked expense
  let linkedCount = 0;
  const linkUpdates = [];

  for (const exp of unlinked) {
    const desc = (exp.description || '').toLowerCase().trim();

    // Skip generic categories that shouldn't be linked to specific works
    if (['офис', 'office', 'склад', 'склад королёв', 'склад мурманск',
         'склад тест химии', 'склад, наше авто',
         'сро выписка', 'на тендер', 'обучение босиет',
         'лицензия на утилизацию', 'wam-exp',
         'эб комиссия', 'свг', 'для отг'].includes(desc)) {
      continue;
    }

    // Try exact match first
    let match = workIndex.find(w => w.title.includes(desc) || desc.includes(w.title));

    if (!match) {
      // Try partial matching for multi-word descriptions
      const words = desc.split(/[\s,.-]+/).filter(w => w.length > 3);
      for (const word of words) {
        match = workIndex.find(w => w.title.includes(word) || w.customer.includes(word));
        if (match) break;
      }
    }

    if (match) {
      linkedCount++;
      linkUpdates.push({ expId: exp.id, workId: match.id, desc: exp.description, workTitle: works.find(w => w.id === match.id).work_title });
    }
  }

  console.log(`\nPotential links found: ${linkedCount}`);
  for (const u of linkUpdates) {
    console.log(`  Expense #${u.expId} "${u.desc}" => Work #${u.workId} "${u.workTitle}"`);
  }

  // Apply links
  if (linkUpdates.length > 0) {
    console.log('\nApplying links...');
    for (const u of linkUpdates) {
      await client.query('UPDATE work_expenses SET work_id = $1 WHERE id = $2', [u.workId, u.expId]);
    }
    console.log(`Updated ${linkUpdates.length} expenses`);
  }

  // Final stats
  const { rows: finalStats } = await client.query(`
    SELECT
      count(*) as total,
      count(work_id) as linked,
      count(*) - count(work_id) as unlinked,
      round(sum(amount)::numeric, 2) as total_amount,
      round(sum(CASE WHEN work_id IS NOT NULL THEN amount ELSE 0 END)::numeric, 2) as linked_amount
    FROM work_expenses
  `);
  console.log('\n--- FINAL STATS ---');
  console.log(`Total: ${finalStats[0].total}`);
  console.log(`Linked: ${finalStats[0].linked}`);
  console.log(`Unlinked: ${finalStats[0].unlinked}`);
  console.log(`Total amount: ${finalStats[0].total_amount}`);
  console.log(`Linked amount: ${finalStats[0].linked_amount}`);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
