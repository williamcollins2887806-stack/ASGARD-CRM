/**
 * Add 11 missing expenses from Excel to CRM
 */
const { Client } = require('pg');

const DB = {
  host: 'localhost', port: 5432,
  database: 'asgard_crm', user: 'asgard', password: '123456789',
};

const MISSING = [
  { object: 'Пуровский ЗПК', amount: 124600, contractor: 'ООО "НОВА Механика"', invoice: '13934', date: '2025-06-11' },
  { object: 'Пуровский ЗПК', amount: 89499.92, contractor: 'ООО "Фирма "Техноавиа"', invoice: 'Ал-2824', date: '2025-07-03' },
  { object: 'Пуровский ЗПК', amount: 1898, contractor: 'ООО "Интернет Решения"', invoice: '0144436306-0062', date: '2025-07-03' },
  { object: 'Пуровский ЗПК', amount: 5660, contractor: 'ООО "Интернет Решения"', invoice: '0144436306-0063', date: '2025-07-16' },
  { object: 'Пуровский ЗПК', amount: 65000, contractor: 'ООО "ГРУППА КОМПАНИЙ ЯКУТТРАНСКАРГО"', invoice: '834', date: '2025-07-28' },
  { object: 'Амурский ГХК', amount: 52500, contractor: 'ООО "ТК РИМ"', invoice: '32654', date: '2025-08-27' },
  { object: 'замена гликоля, МЛСП', amount: 145000, contractor: 'ООО "ГРУППА КОМПАНИЙ ЯКУТТРАНСКАРГО"', invoice: '1013', date: '2025-09-03' },
  { object: 'Офис', amount: 8100, contractor: 'ООО "Ундервуд"', invoice: '18', date: '2025-10-06' },
  { object: 'Амурский ГХК', amount: 70000, contractor: 'ИП Клинок А.В.', invoice: '1', date: '2025-11-20' },
  { object: '', amount: 67000, contractor: 'ООО "УК "СтройСпециалист"', invoice: 'М-3225', date: '2025-08-04' },
  { object: 'Обезжир Кислородоропровода АО УММ-2', amount: 35000, contractor: 'ООО "Макс Экспресс"', invoice: '23', date: '2026-01-31' },
];

// Map objects to categories and try to find work_id
const CATEGORY_MAP = {
  'Пуровский ЗПК': 'Прочее',
  'Амурский ГХК': 'Прочее',
  'замена гликоля, МЛСП': 'Материалы',
  'Офис': 'Офис',
  '': 'Прочее',
  'Обезжир Кислородоропровода АО УММ-2': 'Прочее',
};

async function main() {
  const client = new Client(DB);
  await client.connect();

  // Try to find matching works
  const { rows: works } = await client.query(`
    SELECT w.id, w.work_title FROM works w ORDER BY w.work_title
  `);

  const workMatches = {
    'Амурский ГХК': works.find(w => w.work_title.toLowerCase().includes('агхк') || w.work_title.toLowerCase().includes('амурский')),
    'замена гликоля, МЛСП': works.find(w => w.work_title.toLowerCase().includes('млсп') || w.work_title.toLowerCase().includes('замена гликоля')),
    'Обезжир Кислородоропровода АО УММ-2': works.find(w => w.work_title.toLowerCase().includes('обезжир')),
  };

  console.log('Work matches found:');
  for (const [key, val] of Object.entries(workMatches)) {
    if (val) console.log(`  "${key}" => #${val.id} "${val.work_title}"`);
  }

  let inserted = 0;
  for (const m of MISSING) {
    const category = CATEGORY_MAP[m.object] || 'Прочее';
    const workMatch = workMatches[m.object];
    const workId = workMatch ? workMatch.id : null;
    const description = m.object || (m.contractor.includes('СтройСпециалист') ? 'Екатеринбург' : 'Прочее');
    const hash = `excel_import_${m.amount}_${m.date}_${m.invoice}`;

    // Check for duplicate
    const { rows: existing } = await client.query(
      'SELECT id FROM work_expenses WHERE import_hash = $1', [hash]
    );
    if (existing.length > 0) {
      console.log(`  SKIP (exists): ${description} ${m.amount}`);
      continue;
    }

    await client.query(`
      INSERT INTO work_expenses (description, amount, date, counterparty, document_number, category, work_id, source, import_hash, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'excel_import', $8, NOW())
    `, [description, m.amount, m.date, m.contractor, m.invoice, category, workId, hash]);

    console.log(`  + ${description}: ${m.amount} -> work_id=${workId || 'NULL'}`);
    inserted++;
  }

  console.log(`\nInserted: ${inserted}`);

  // Final stats
  const { rows: stats } = await client.query(`
    SELECT count(*) as total,
      count(work_id) as linked,
      round(sum(amount)::numeric, 2) as total_amount
    FROM work_expenses
  `);
  console.log(`\nFinal: ${stats[0].total} expenses, ${stats[0].linked} linked, total ${stats[0].total_amount}`);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
