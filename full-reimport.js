/**
 * FULL REIMPORT: Delete all tenders+works from CRM, import from Excel
 *
 * Steps:
 * 1. Delete all work_expenses FK refs, works, tender FK refs, tenders
 * 2. Import tenders (Источник=Тендер) with customer
 * 3. Import projects as tenders+works (Источник=Проект) with customer
 * 4. Link expenses to new works where possible
 */
const { Client } = require('pg');
const fs = require('fs');

const DB = {
  host: 'localhost', port: 5432,
  database: 'asgard_crm', user: 'asgard', password: '123456789',
};

// PM mapping: Excel name -> user id
const PM_MAP = {
  'Зиссер Е.О.': 1226,
  'Трухин А.': 1225,
  'Пантузенко А.В.': 1230,
  'Путков Д.В.': 1231,
  'Погребняков С.В.': 1235,
  'Богданов Д.В.': 1229,
  'Климакин Д.': 1240,
  'Цветков А.В.': 1223,
  'Магомедов Р.Д.': 1234,
  'Коваленко А.А.': 1236,
  'Мараховский А.В.': 1227,
  'Яковлев А.А.': 1241,
  'Андросов Н.А.': 13,
  'Мартыненко Ю.': 1224,
  'Китуашвили Н.С.': 1228,
  'Очнев А.Л.': 1232,
  'Баринов В.А.': 1233,
  'Пономарев А.Е.': 1237,
  'Кузьмин М.М.': 1238,
  'Щедриков Д.С.': 1239,
};

// Status mapping: Excel -> CRM
const TENDER_STATUS_MAP = {
  'Новый': 'Новый',
  'В работе': 'В работе',
  'Выполнен': 'Выполнен',
  'Отказ': 'Клиент отказался',
  'Проиграли': 'Проиграли',
  'ТКП согласовано': 'ТКП согласовано',
  'Согласование ТКП': 'Согласование ТКП',
  'Выиграли': 'Выиграли',
};

const WORK_STATUS_MAP = {
  'Выполнен': 'Закрыт',
  'В работе': 'В работе',
  'Новый': 'Подготовка',
  'ТКП согласовано': 'Подготовка',
  'Согласование ТКП': 'Подготовка',
  'Выиграли': 'В работе',
  'Отказ': 'Отказ',
  'Проиграли': 'Отказ',
};

function parseNumber(val) {
  if (!val && val !== 0) return null;
  if (typeof val === 'number') return val > 0 ? val : null;
  const s = String(val).replace(/\s/g, '');
  // Handle comma as thousands separator when dot present
  let cleaned = s;
  if (cleaned.includes('.') && cleaned.includes(',')) {
    cleaned = cleaned.replace(/,/g, '');
  } else if (/\d,\d{3}(?!\d)/.test(cleaned) && !cleaned.includes('.')) {
    cleaned = cleaned.replace(/,/g, '');
  } else {
    cleaned = cleaned.replace(/,/g, '.');
  }
  const n = parseFloat(cleaned);
  return isNaN(n) || n <= 0 ? null : n;
}

function parseINN(val) {
  if (!val) return null;
  const s = String(val).replace(/\s/g, '').replace(/\.0$/, '').substring(0, 20);
  return s || null;
}

async function main() {
  const client = new Client(DB);
  await client.connect();

  // Load Excel data (JSON array from cleaned Excel)
  const allData = JSON.parse(fs.readFileSync('tenders_projects.json', 'utf8'));
  const rows = Array.isArray(allData) ? allData : allData['Тендеры и Проекты'];
  console.log(`Excel rows: ${rows.length}`);

  // Filter: only with customer
  const withCustomer = rows.filter(r => {
    const cust = String(r['Заказчик'] || '').trim();
    const inn = String(r['ИНН'] || '').trim();
    return cust || inn;
  });
  console.log(`With customer/INN: ${withCustomer.length}`);

  const tenders = withCustomer.filter(r => r['Источник'] === 'Тендер');
  const projects = withCustomer.filter(r => r['Источник'] === 'Проект');
  console.log(`Tenders to import: ${tenders.length}`);
  console.log(`Projects to import: ${projects.length} (will create tender + work)`);

  // ============================================================
  // PHASE 1: FULL CLEANUP (everything except employees, users, permits, contractors)
  // ============================================================
  console.log('\n=== PHASE 1: Full cleanup ===');

  // Save expenses for re-linking
  const { rows: existingExpenses } = await client.query(`
    SELECT we.id, we.description, we.amount, we.work_id, w.work_title
    FROM work_expenses we
    LEFT JOIN works w ON w.id = we.work_id
  `);
  console.log(`Saved ${existingExpenses.length} expenses for re-linking`);

  // Order matters: children first, then parents
  const cleanupQueries = [
    // Tasks system
    'DELETE FROM task_comments',
    'DELETE FROM task_watchers',
    'UPDATE meeting_minutes SET task_id = NULL',
    'UPDATE tasks SET parent_task_id = NULL WHERE parent_task_id IS NOT NULL',
    'DELETE FROM tasks',

    // Cash system
    'DELETE FROM cash_messages',
    'DELETE FROM cash_returns',
    'DELETE FROM cash_requests',

    // Notifications
    'DELETE FROM notifications',

    // TKP (unlink invoices first)
    'UPDATE invoices SET tkp_id = NULL WHERE tkp_id IS NOT NULL',
    'DELETE FROM tkp',

    // Estimates
    'UPDATE invoices SET estimate_id = NULL WHERE estimate_id IS NOT NULL',
    'DELETE FROM estimates',

    // Work expenses - detach from works
    'UPDATE work_expenses SET work_id = NULL',

    // Works FK cleanup
    'UPDATE incomes SET work_id = NULL WHERE work_id IS NOT NULL',
    'UPDATE calendar_events SET work_id = NULL WHERE work_id IS NOT NULL',
    'UPDATE documents SET work_id = NULL WHERE work_id IS NOT NULL',
    'UPDATE correspondence SET work_id = NULL WHERE work_id IS NOT NULL',
    'UPDATE travel_expenses SET work_id = NULL WHERE work_id IS NOT NULL',
    'UPDATE payroll_sheets SET work_id = NULL WHERE work_id IS NOT NULL',
    'UPDATE payroll_items SET work_id = NULL WHERE work_id IS NOT NULL',
    'UPDATE one_time_payments SET work_id = NULL WHERE work_id IS NOT NULL',
    'UPDATE inbox_applications SET linked_work_id = NULL WHERE linked_work_id IS NOT NULL',
    'UPDATE bank_transactions SET work_id = NULL WHERE work_id IS NOT NULL',
    'UPDATE work_permit_requirements SET work_id = NULL WHERE work_id IS NOT NULL',
    'UPDATE meetings SET work_id = NULL WHERE work_id IS NOT NULL',
    'UPDATE employee_reviews SET work_id = NULL WHERE work_id IS NOT NULL',
    'UPDATE employee_plan SET work_id = NULL WHERE work_id IS NOT NULL',

    // Delete works
    'DELETE FROM works',

    // Tender FK cleanup
    'UPDATE invoices SET tender_id = NULL WHERE tender_id IS NOT NULL',
    'UPDATE calendar_events SET tender_id = NULL WHERE tender_id IS NOT NULL',
    'UPDATE documents SET tender_id = NULL WHERE tender_id IS NOT NULL',
    'UPDATE correspondence SET tender_id = NULL WHERE tender_id IS NOT NULL',
    'UPDATE meetings SET tender_id = NULL WHERE tender_id IS NOT NULL',
    'UPDATE inbox_applications SET linked_tender_id = NULL WHERE linked_tender_id IS NOT NULL',
    'UPDATE bank_transactions SET tender_id = NULL WHERE tender_id IS NOT NULL',
    'UPDATE pass_requests SET tender_id = NULL WHERE tender_id IS NOT NULL',
    'UPDATE tmc_requests SET tender_id = NULL WHERE tender_id IS NOT NULL',

    // Delete tenders
    'DELETE FROM tenders',

    // Todo items
    'DELETE FROM todo_items',

    // Audit log (test data)
    'DELETE FROM audit_log',

    // Calendar events (already unlinked from works/tenders)
    'DELETE FROM calendar_events',

    // Reminders
    'DELETE FROM reminders',

    // AI analysis log
    'DELETE FROM ai_analysis_log',

    // Mimir conversations
    'DELETE FROM mimir_conversations',
    'DELETE FROM mimir_usage_log',
  ];

  let cleanupCount = 0;
  for (const sql of cleanupQueries) {
    try {
      const result = await client.query(sql);
      if (result.rowCount > 0) {
        const table = sql.match(/(?:FROM|UPDATE)\s+(\w+)/i)?.[1] || '?';
        console.log(`  ${sql.startsWith('DELETE') ? 'Deleted' : 'Updated'} ${result.rowCount} in ${table}`);
        cleanupCount += result.rowCount;
      }
    } catch(e) {
      // Table may not exist
      console.log(`  SKIP: ${sql.substring(0, 60)}... (${e.message.substring(0, 40)})`);
    }
  }
  console.log(`\nTotal cleanup: ${cleanupCount} rows affected`);

  // ============================================================
  // PHASE 2: Import tenders
  // ============================================================
  console.log('\n=== PHASE 2: Importing tenders ===');

  let tenderCount = 0;
  const tenderIdMap = {}; // excelNo -> crm tender id

  for (const row of tenders) {
    const customer = String(row['Заказчик'] || '').trim();
    const inn = parseINN(row['ИНН']);
    const title = String(row['Название'] || '').trim();
    const year = String(row['Год'] || '').trim();
    const price = parseNumber(row['Сумма']);
    const status = TENDER_STATUS_MAP[row['Статус']] || row['Статус'] || 'Новый';
    const link = String(row['Ссылка'] || '').trim() || null;
    const comment = String(row['Комментарий'] || '').trim() || null;
    const excelNo = row['№'];

    const { rows: [inserted] } = await client.query(`
      INSERT INTO tenders (
        customer_name, customer_inn, inn, tender_title, tender_type,
        tender_price, tender_status, period, year, link, comment_to,
        created_at, updated_at
      ) VALUES ($1, $2, $2, $3, 'Прямой запрос', $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING id
    `, [
      customer || (inn ? `ИНН ${inn}` : 'Без заказчика'),
      inn,
      title,
      price,
      status,
      String(year).substring(0, 20),  // period (varchar 20)
      parseInt(year) || null,         // year (integer)
      link,
      comment,
    ]);

    tenderIdMap[excelNo] = inserted.id;
    tenderCount++;
  }
  console.log(`Imported ${tenderCount} tenders`);

  // ============================================================
  // PHASE 3: Import projects (tender + work)
  // ============================================================
  console.log('\n=== PHASE 3: Importing projects (tender + work) ===');

  let projectCount = 0;
  let workCount = 0;
  const workTitleMap = {}; // work title (lower) -> work id, for expense linking

  for (const row of projects) {
    const customer = String(row['Заказчик'] || '').trim();
    const inn = parseINN(row['ИНН']);
    const title = String(row['Название'] || '').trim();
    const year = String(row['Год'] || '').trim();
    const price = parseNumber(row['Сумма']);
    const contractSum = parseNumber(row['Сумма договора']);
    const contractNo = String(row['№ договора'] || '').trim() || null;
    const contractDate = String(row['Дата договора'] || '').trim() || null;
    const workDates = String(row['Даты работ'] || '').trim() || null;
    const pmName = String(row['Руководитель проекта'] || '').trim();
    const employees = String(row['Сотрудники'] || '').trim() || null;
    const empCount = parseNumber(row['Кол-во сотр.']);
    const status = TENDER_STATUS_MAP[row['Статус']] || row['Статус'] || 'Новый';
    const workStatus = WORK_STATUS_MAP[row['Статус']] || 'В работе';
    const link = String(row['Ссылка'] || '').trim() || null;
    const comment = String(row['Комментарий'] || '').trim() || null;
    const excelNo = row['№'];

    // Create tender
    const { rows: [tender] } = await client.query(`
      INSERT INTO tenders (
        customer_name, customer_inn, inn, tender_title, tender_type,
        tender_price, tender_status, period, year, link, comment_to,
        created_at, updated_at
      ) VALUES ($1, $2, $2, $3, 'Прямой запрос', $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING id
    `, [
      customer || (inn ? `ИНН ${inn}` : 'Без заказчика'),
      inn,
      title,
      price || contractSum || null,
      status,
      String(year).substring(0, 20),  // period (varchar 20)
      parseInt(year) || null,         // year (integer)
      link,
      comment,
    ]);

    tenderIdMap[excelNo] = tender.id;
    projectCount++;

    // Create work
    const pmId = pmName ? (PM_MAP[pmName] || null) : null;
    if (pmName && !pmId) {
      console.warn(`  WARNING: PM not found: "${pmName}" for project "${title}"`);
    }

    // Parse work dates
    let startDate = null;
    let endDate = null;
    if (workDates) {
      // Try various formats: "Сент-Окт 2024", "Март 2025", "15.01-20.03.2025", etc.
      // Store as-is in comment, parse simple cases
      const dateMatch = workDates.match(/(\d{1,2}\.\d{1,2}\.\d{4})/g);
      if (dateMatch) {
        if (dateMatch[0]) {
          const [d, m, y] = dateMatch[0].split('.');
          startDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
        if (dateMatch[1]) {
          const [d, m, y] = dateMatch[1].split('.');
          endDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
      }
    }

    // Parse contract date
    let parsedContractDate = null;
    if (contractDate) {
      const dateMatch = contractDate.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
      if (dateMatch) {
        const [d, m, y] = dateMatch[1].split('.');
        parsedContractDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
    }

    const commentFull = [
      contractNo ? `Договор: ${contractNo}` : null,
      contractDate ? `Дата договора: ${contractDate}` : null,
      workDates ? `Даты работ: ${workDates}` : null,
      employees ? `Сотрудники: ${employees}` : null,
      empCount ? `Кол-во сотр.: ${empCount}` : null,
      comment,
    ].filter(Boolean).join('\n') || null;

    const cSum = contractSum || price || 0;

    const workParams = [
      title,
      tender.id,
      cSum,
      workStatus,
      pmId,
      customer || null,
      (inn || '').substring(0, 20) || null,  // customer_inn varchar(20)
      startDate,
      endDate,
      commentFull,
    ];

    let work;
    try {
    const result = await client.query(`
      INSERT INTO works (
        work_title, tender_id, contract_sum, contract_value,
        status, pm_id, customer_name, customer_inn,
        start_date_plan, end_date_plan,
        comment, created_at, updated_at
      ) VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING id
    `, workParams);
    work = result.rows[0];
    workTitleMap[title.toLowerCase()] = work.id;
    workCount++;
    } catch(e) {
      console.error(`  ERROR inserting work "${title}": ${e.message}`);
      console.error(`  Params:`, workParams.map((p, i) => `$${i+1}=${String(p).substring(0, 30)}`).join(', '));
    }
  }
  console.log(`Imported ${projectCount} project tenders + ${workCount} works`);

  // ============================================================
  // PHASE 4: Re-link expenses to works
  // ============================================================
  console.log('\n=== PHASE 4: Re-linking expenses to works ===');

  // Build reverse lookup: old work_title -> new work_id
  const { rows: newWorks } = await client.query('SELECT id, work_title FROM works');
  const newWorkByTitle = {};
  for (const w of newWorks) {
    newWorkByTitle[w.work_title.toLowerCase()] = w.id;
  }

  // Try to link expenses by matching their old work title to new works
  let linked = 0;
  let unlinked = 0;

  // Group old expenses by their work title
  const expensesByTitle = {};
  for (const e of existingExpenses) {
    if (e.work_title) {
      const key = e.work_title.toLowerCase();
      if (!expensesByTitle[key]) expensesByTitle[key] = [];
      expensesByTitle[key].push(e.id);
    }
  }

  for (const [oldTitle, expIds] of Object.entries(expensesByTitle)) {
    // Direct match
    let newWorkId = newWorkByTitle[oldTitle];

    // Fuzzy match if no direct
    if (!newWorkId) {
      // Try without leading number prefix like "44. АГХК" -> "АГХК"
      const stripped = oldTitle.replace(/^\d+\.\s*/, '');
      newWorkId = newWorkByTitle[stripped];
    }

    if (!newWorkId) {
      // Try partial match
      for (const [newTitle, id] of Object.entries(newWorkByTitle)) {
        if (newTitle.includes(oldTitle) || oldTitle.includes(newTitle)) {
          newWorkId = id;
          break;
        }
      }
    }

    if (newWorkId) {
      const placeholders = expIds.map((_, i) => `$${i + 2}`).join(',');
      await client.query(
        `UPDATE work_expenses SET work_id = $1 WHERE id IN (${placeholders})`,
        [newWorkId, ...expIds]
      );
      linked += expIds.length;
    } else {
      unlinked += expIds.length;
      if (expIds.length > 2) {
        console.log(`  No match for "${oldTitle}" (${expIds.length} expenses)`);
      }
    }
  }

  // Also try to link expenses by description matching work titles
  const { rows: stillUnlinked } = await client.query(`
    SELECT DISTINCT description FROM work_expenses WHERE work_id IS NULL AND description IS NOT NULL
  `);

  for (const { description } of stillUnlinked) {
    const desc = description.toLowerCase().trim();
    // Skip generic
    if (['офис', 'office', 'склад', 'склад королёв', 'склад мурманск',
         'склад тест химии', 'склад, наше авто', 'сро выписка', 'на тендер',
         'обучение босиет', 'лицензия на утилизацию', 'wam-exp',
         'эб комиссия', 'свг', 'для отг', 'офис'].includes(desc)) {
      continue;
    }

    let matchId = newWorkByTitle[desc];
    if (!matchId) {
      for (const [title, id] of Object.entries(newWorkByTitle)) {
        if (title.includes(desc) || desc.includes(title)) {
          matchId = id;
          break;
        }
      }
    }

    if (matchId) {
      const result = await client.query(
        'UPDATE work_expenses SET work_id = $1 WHERE work_id IS NULL AND lower(trim(description)) = $2',
        [matchId, desc]
      );
      if (result.rowCount > 0) {
        linked += result.rowCount;
        console.log(`  Linked ${result.rowCount} expenses "${description}" -> work #${matchId}`);
      }
    }
  }

  console.log(`\nRe-linked: ${linked} expenses`);
  console.log(`Could not link: ${unlinked} (by old title)`);

  // ============================================================
  // FINAL STATS
  // ============================================================
  console.log('\n=== FINAL STATS ===');

  const { rows: [tStats] } = await client.query(`
    SELECT count(*) as total,
      count(CASE WHEN tender_price > 0 THEN 1 END) as with_price,
      count(CASE WHEN customer_inn IS NOT NULL AND trim(customer_inn) != '' THEN 1 END) as with_inn,
      count(CASE WHEN customer_name IS NOT NULL AND trim(customer_name) != '' THEN 1 END) as with_customer
    FROM tenders
  `);
  console.log(`\nTenders: ${tStats.total}`);
  console.log(`  With price: ${tStats.with_price}`);
  console.log(`  With INN: ${tStats.with_inn}`);
  console.log(`  With customer: ${tStats.with_customer}`);

  const { rows: tStatuses } = await client.query(`
    SELECT tender_status, count(*) as cnt FROM tenders GROUP BY tender_status ORDER BY cnt DESC
  `);
  console.log('  Statuses:');
  for (const s of tStatuses) console.log(`    ${s.tender_status}: ${s.cnt}`);

  const { rows: [wStats] } = await client.query(`
    SELECT count(*) as total,
      count(CASE WHEN contract_sum > 0 THEN 1 END) as with_price,
      count(CASE WHEN pm_id IS NOT NULL THEN 1 END) as with_pm,
      count(CASE WHEN id IN (SELECT DISTINCT work_id FROM work_expenses WHERE work_id IS NOT NULL) THEN 1 END) as with_expenses
    FROM works
  `);
  console.log(`\nWorks: ${wStats.total}`);
  console.log(`  With price: ${wStats.with_price}`);
  console.log(`  With PM: ${wStats.with_pm}`);
  console.log(`  With expenses: ${wStats.with_expenses}`);

  const { rows: wStatuses } = await client.query(`
    SELECT status, count(*) as cnt FROM works GROUP BY status ORDER BY cnt DESC
  `);
  console.log('  Statuses:');
  for (const s of wStatuses) console.log(`    ${s.status || '(empty)'}: ${s.cnt}`);

  const { rows: [eStats] } = await client.query(`
    SELECT count(*) as total,
      count(work_id) as linked,
      count(*) - count(work_id) as unlinked,
      round(sum(amount)::numeric, 2) as total_amount
    FROM work_expenses
  `);
  console.log(`\nExpenses: ${eStats.total}`);
  console.log(`  Linked: ${eStats.linked}`);
  console.log(`  Unlinked: ${eStats.unlinked}`);
  console.log(`  Total amount: ${eStats.total_amount}`);

  await client.end();
  console.log('\nDone!');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
