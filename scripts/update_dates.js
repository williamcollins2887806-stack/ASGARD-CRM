const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const yearMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'project_years.json'), 'utf8'));

async function run() {
  const client = new Client({ host: 'localhost', database: 'asgard_crm', user: 'asgard', password: '123456789' });
  await client.connect();

  const { rows: works } = await client.query(
    "SELECT w.id, w.work_title, t.tender_title FROM works w LEFT JOIN tenders t ON w.tender_id = t.id WHERE w.tender_id IS NOT NULL"
  );

  let updated = 0;
  for (const w of works) {
    const title = w.work_title || w.tender_title;
    const year = yearMap[title];
    if (!year) continue;

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    await client.query(
      "UPDATE works SET start_plan = COALESCE(start_plan, $1), end_plan = COALESCE(end_plan, $2) WHERE id = $3",
      [startDate, endDate, w.id]
    );
    updated++;
  }

  // Update employee_assignments dates from works
  const { rowCount } = await client.query(`
    UPDATE employee_assignments ea SET
      date_from = COALESCE(w.start_plan, w.start_fact, w.created_at::date),
      date_to = CASE WHEN w.work_status IN ('Закрыт', 'Работы сдали')
        THEN COALESCE(w.end_plan, w.end_fact, w.updated_at::date)
        ELSE NULL END
    FROM works w WHERE ea.work_id = w.id
  `);

  console.log(`Updated ${updated} works with year dates`);
  console.log(`Updated ${rowCount} employee assignments`);

  const { rows: sample } = await client.query(
    "SELECT e.fio, ea.date_from, ea.date_to, w.work_title FROM employee_assignments ea JOIN employees e ON ea.employee_id = e.id JOIN works w ON ea.work_id = w.id ORDER BY ea.date_from LIMIT 10"
  );
  console.log('\nSample:');
  for (const r of sample) {
    console.log(`  ${r.fio}: ${r.date_from} - ${r.date_to || 'ongoing'} | ${r.work_title}`);
  }

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
