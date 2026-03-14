/**
 * Create missing works for tenders that have expenses, then link expenses
 */
const { Client } = require('pg');

const DB = {
  host: 'localhost', port: 5432,
  database: 'asgard_crm', user: 'asgard', password: '123456789',
};

async function main() {
  const client = new Client(DB);
  await client.connect();

  // Objects that need works created
  const objectsToCreate = [
    {
      description: 'Пуровский ЗПК',
      tenderId: 10545, // first tender, most relevant
      workTitle: 'Пуровский ЗПК',
    },
    {
      description: 'Екатеринбург',
      tenderId: 11735,
      workTitle: 'Екатеринбург (Невьянский цементник)',
    },
    {
      // Multi-line description in DB
      descriptionPattern: 'ИП Бараташвили%',
      tenderId: 10975,
      workTitle: 'ИП Бараташвили - модернизация ИТП Москва',
    },
  ];

  for (const obj of objectsToCreate) {
    // Check if work already exists for this tender
    const { rows: existingWorks } = await client.query(
      'SELECT id, work_title FROM works WHERE tender_id = $1', [obj.tenderId]
    );

    let workId;
    if (existingWorks.length > 0) {
      workId = existingWorks[0].id;
      console.log(`Work already exists for tender #${obj.tenderId}: #${workId} "${existingWorks[0].work_title}"`);
    } else {
      // Get tender details
      const { rows: [tender] } = await client.query(
        'SELECT customer_name, tender_title, tender_price FROM tenders WHERE id = $1', [obj.tenderId]
      );

      // Calculate sum of expenses for this object
      let expenseSum;
      if (obj.descriptionPattern) {
        const { rows: [sumRow] } = await client.query(
          'SELECT round(sum(amount)::numeric, 2) as total FROM work_expenses WHERE work_id IS NULL AND description LIKE $1',
          [obj.descriptionPattern]
        );
        expenseSum = sumRow.total || 0;
      } else {
        const { rows: [sumRow] } = await client.query(
          'SELECT round(sum(amount)::numeric, 2) as total FROM work_expenses WHERE work_id IS NULL AND description = $1',
          [obj.description]
        );
        expenseSum = sumRow.total || 0;
      }

      // Create work
      const contractSum = parseFloat(tender.tender_price) || parseFloat(expenseSum) || 1;
      const { rows: [newWork] } = await client.query(`
        INSERT INTO works (work_title, tender_id, contract_sum, status, created_at, updated_at)
        VALUES ($1, $2, $3, 'В работе', NOW(), NOW())
        RETURNING id
      `, [obj.workTitle, obj.tenderId, contractSum]);

      workId = newWork.id;
      console.log(`Created work #${workId} "${obj.workTitle}" (tender #${obj.tenderId}, contract_sum=${contractSum})`);
    }

    // Link expenses to this work
    let updated;
    if (obj.descriptionPattern) {
      const result = await client.query(
        'UPDATE work_expenses SET work_id = $1 WHERE work_id IS NULL AND description LIKE $2',
        [workId, obj.descriptionPattern]
      );
      updated = result.rowCount;
    } else {
      const result = await client.query(
        'UPDATE work_expenses SET work_id = $1 WHERE work_id IS NULL AND description = $2',
        [workId, obj.description]
      );
      updated = result.rowCount;
    }
    console.log(`  Linked ${updated} expenses to work #${workId}\n`);
  }

  // Also link "Исток, Фрязино" and "Мангуст" - no tenders, but check if works match
  // "СПбГМТУ, Мангуст" and "Спбгу Мангуст" - same object, possibly a work?
  // Check existing works for partial matches
  const miscObjects = [
    { descriptions: ['Исток, Фрязино'], search: '%исток%' },
    { descriptions: ['СПбГМТУ, "Мангуст"', 'Спбгу Мангуст'], search: '%мангуст%' },
    { descriptions: ['Склад тест химии'], search: '%тест хим%' },
  ];

  for (const misc of miscObjects) {
    const { rows: matchWorks } = await client.query(
      `SELECT id, work_title FROM works WHERE work_title ILIKE $1 LIMIT 3`, [misc.search]
    );
    if (matchWorks.length > 0) {
      console.log(`Found work for "${misc.descriptions[0]}": #${matchWorks[0].id} "${matchWorks[0].work_title}"`);
      for (const desc of misc.descriptions) {
        const result = await client.query(
          'UPDATE work_expenses SET work_id = $1 WHERE work_id IS NULL AND description = $2',
          [matchWorks[0].id, desc]
        );
        if (result.rowCount > 0) console.log(`  Linked ${result.rowCount} expenses "${desc}"`);
      }
    } else {
      console.log(`No work found for "${misc.descriptions[0]}" - stays unlinked (category expense)`);
    }
  }

  // Final stats
  const { rows: [stats] } = await client.query(`
    SELECT count(*) as total,
      count(work_id) as linked,
      count(*) - count(work_id) as unlinked,
      round(sum(amount)::numeric, 2) as total_amount,
      round(sum(CASE WHEN work_id IS NOT NULL THEN amount ELSE 0 END)::numeric, 2) as linked_amount
    FROM work_expenses
  `);
  console.log('\n=== FINAL STATS ===');
  console.log(`Total expenses: ${stats.total}`);
  console.log(`Linked to works: ${stats.linked}`);
  console.log(`Unlinked: ${stats.unlinked}`);
  console.log(`Total amount: ${stats.total_amount}`);
  console.log(`Linked amount: ${stats.linked_amount}`);

  // Show remaining unlinked by category
  const { rows: unlinkedCats } = await client.query(`
    SELECT category, count(*) as cnt, round(sum(amount)::numeric, 2) as total
    FROM work_expenses WHERE work_id IS NULL
    GROUP BY category ORDER BY total DESC
  `);
  console.log('\nUnlinked by category:');
  for (const c of unlinkedCats) {
    console.log(`  ${c.category}: ${c.cnt} records, ${c.total} руб`);
  }

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
