/**
 * Comprehensive data import script:
 * 1. Create PM users from project data
 * 2. Assign works to PMs (archive PM for unassigned)
 * 3. Fill contract sums from TKP data
 * 4. Link employees to works
 * 5. Import expenses from "Реестр счетов и Документов.xlsx"
 *
 * Usage: node import_pm_and_data.js [--dry-run] [--phase=1,2,3,4,5]
 */

const { Client } = require('pg');
const path = require('path');
const XLSX = require('xlsx');
const crypto = require('crypto');

const DRY_RUN = process.argv.includes('--dry-run');
const phaseArg = process.argv.find(a => a.startsWith('--phase='));
const PHASES = phaseArg ? phaseArg.split('=')[1].split(',').map(Number) : [1,2,3,4,5];

const DB = {
  host: 'localhost',
  port: 5432,
  database: 'asgard_crm',
  user: 'asgard',
  password: '123456789',
};

// Password hash for PM accounts
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

const PM_PASSWORD = 'Asgard2026!';
const PM_PASSWORD_HASH = hashPassword(PM_PASSWORD);

// ═══════════════════════════════════════════════════════════════
// Phase 1: Create PM users
// ═══════════════════════════════════════════════════════════════
async function phase1_createPMs(client) {
  console.log('\n=== PHASE 1: Create PM Users ===');

  const projectData = require('./project_data.json');
  const uniquePMs = {};
  for (const p of projectData) {
    if (p.pm) uniquePMs[p.pm] = (uniquePMs[p.pm] || 0) + 1;
  }

  // Generate login from name: "Зиссер Е.О." -> "E.Zisser" style
  // Or simpler: use transliteration
  function transliterate(name) {
    const map = {
      'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'E','Ж':'Zh','З':'Z','И':'I','Й':'Y',
      'К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F',
      'Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Sch','Ъ':'','Ы':'Y','Ь':'','Э':'E','Ю':'Yu','Я':'Ya',
      'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y',
      'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
      'х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
    };
    return name.split('').map(c => map[c] || c).join('');
  }

  function makeLogin(name) {
    // "Зиссер Е.О." -> split to parts
    const parts = name.replace(/\./g, ' ').trim().split(/\s+/);
    if (parts.length >= 2) {
      const surname = transliterate(parts[0]);
      const initials = parts.slice(1).map(p => transliterate(p.charAt(0))).join('');
      return (initials + '.' + surname).toLowerCase();
    }
    return transliterate(name).toLowerCase().replace(/\s+/g, '_');
  }

  function makeDisplayName(name) {
    // Already looks like a display name
    return name;
  }

  const pmMap = {}; // name -> user_id
  let created = 0, existing = 0;

  // Check existing PM users
  const { rows: existingUsers } = await client.query(
    "SELECT id, login, name FROM users WHERE role = 'PM' AND login NOT LIKE 'wam_%' AND login NOT LIKE 'test_%'"
  );

  for (const [pmName, count] of Object.entries(uniquePMs)) {
    // Try to match by name
    const existingMatch = existingUsers.find(u => {
      const uName = (u.name || '').toLowerCase();
      const pmLower = pmName.toLowerCase();
      return uName.includes(pmLower) || pmLower.includes(uName);
    });

    if (existingMatch) {
      pmMap[pmName] = existingMatch.id;
      existing++;
      console.log(`  [EXISTS] ${pmName} -> user_id=${existingMatch.id} (${existingMatch.login})`);
      continue;
    }

    const login = makeLogin(pmName);
    const displayName = makeDisplayName(pmName);

    // Check login doesn't conflict
    const { rows: conflict } = await client.query(
      "SELECT id FROM users WHERE login = $1", [login]
    );

    if (conflict.length > 0) {
      pmMap[pmName] = conflict[0].id;
      existing++;
      console.log(`  [LOGIN EXISTS] ${pmName} -> ${login} -> user_id=${conflict[0].id}`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY-RUN] Would create: ${login} / ${displayName} / PM (${count} works)`);
    } else {
      const { rows } = await client.query(
        `INSERT INTO users (login, password_hash, name, role, is_active, created_at)
         VALUES ($1, $2, $3, 'PM', true, NOW()) RETURNING id`,
        [login, PM_PASSWORD_HASH, displayName]
      );
      pmMap[pmName] = rows[0].id;
      created++;
      console.log(`  [CREATED] ${login} (id=${rows[0].id}) -> ${displayName} (${count} works)`);
    }
  }

  // Create ARCHIVE PM for unassigned works
  const { rows: archiveCheck } = await client.query(
    "SELECT id FROM users WHERE login = 'archive_pm'"
  );
  let archivePmId;
  if (archiveCheck.length > 0) {
    archivePmId = archiveCheck[0].id;
    console.log(`  [EXISTS] Archive PM -> user_id=${archivePmId}`);
  } else if (!DRY_RUN) {
    const { rows } = await client.query(
      `INSERT INTO users (login, password_hash, name, role, is_active, created_at)
       VALUES ('archive_pm', $1, 'Архивный РП', 'PM', true, NOW()) RETURNING id`,
      [PM_PASSWORD_HASH]
    );
    archivePmId = rows[0].id;
    console.log(`  [CREATED] archive_pm (id=${archivePmId}) -> Архивный РП`);
  } else {
    console.log(`  [DRY-RUN] Would create: archive_pm / Архивный РП / PM`);
  }

  console.log(`\n  Summary: ${created} created, ${existing} existing, 1 archive PM`);
  console.log(`  PM password: ${PM_PASSWORD}`);

  return { pmMap, archivePmId };
}

// ═══════════════════════════════════════════════════════════════
// Phase 2: Assign works to PMs
// ═══════════════════════════════════════════════════════════════
async function phase2_assignWorks(client, pmMap, archivePmId) {
  console.log('\n=== PHASE 2: Assign Works to PMs ===');

  const projectData = require('./project_data.json');

  // Get all works with their tender titles
  const { rows: works } = await client.query(`
    SELECT w.id, w.work_title, w.tender_id, t.tender_title, w.pm_id
    FROM works w
    LEFT JOIN tenders t ON w.tender_id = t.id
    WHERE w.work_title NOT LIKE '%TEST%'
      AND w.work_title NOT LIKE '%test%'
  `);

  let assigned = 0, alreadyAssigned = 0, archiveAssigned = 0;

  for (const work of works) {
    if (work.pm_id) {
      alreadyAssigned++;
      continue;
    }

    // Match to project data by title
    const title = work.work_title || work.tender_title || '';
    const project = projectData.find(p => p.title === title);

    let pmId = null;
    if (project && project.pm && pmMap[project.pm]) {
      pmId = pmMap[project.pm];
    } else if (archivePmId) {
      pmId = archivePmId;
      archiveAssigned++;
    }

    if (pmId && !DRY_RUN) {
      await client.query(
        'UPDATE works SET pm_id = $1 WHERE id = $2',
        [pmId, work.id]
      );
      assigned++;
    } else if (pmId && DRY_RUN) {
      assigned++;
    }
  }

  console.log(`  Assigned: ${assigned} (${archiveAssigned} to archive PM), already assigned: ${alreadyAssigned}`);
}

// ═══════════════════════════════════════════════════════════════
// Phase 3: Fill contract sums from TKP
// ═══════════════════════════════════════════════════════════════
async function phase3_fillPrices(client) {
  console.log('\n=== PHASE 3: Fill Contract Sums ===');

  const projectData = require('./project_data.json');

  // Get TKP with amounts, grouped by customer
  const { rows: tkpRecords } = await client.query(`
    SELECT id, customer_name, subject, total_sum, tender_id
    FROM tkp
    WHERE total_sum > 0
    ORDER BY total_sum DESC
  `);

  // Build lookup: customer_name -> [tkp records]
  const tkpByCustomer = {};
  for (const tkp of tkpRecords) {
    const key = (tkp.customer_name || '').trim().toUpperCase();
    if (!tkpByCustomer[key]) tkpByCustomer[key] = [];
    tkpByCustomer[key].push(tkp);
  }

  // Get works without contract sums
  const { rows: works } = await client.query(`
    SELECT w.id, w.work_title, w.tender_id, w.customer_name, w.customer_inn,
           w.contract_sum, w.cost_plan, t.customer_name as tender_customer, t.tender_title
    FROM works w
    LEFT JOIN tenders t ON w.tender_id = t.id
    WHERE w.work_title NOT LIKE '%TEST%'
  `);

  let updated = 0, skipped = 0;

  for (const work of works) {
    // Check project data for contract sum from Excel
    const project = projectData.find(p => p.title === (work.work_title || work.tender_title));
    let contractSum = project?.contractSum || 0;

    // If no contract sum from Excel, try to find from TKP by customer
    if (!contractSum || contractSum <= 0) {
      const customerName = (work.customer_name || work.tender_customer || '').trim().toUpperCase();
      const tkpList = tkpByCustomer[customerName];
      if (tkpList && tkpList.length > 0) {
        // Use the highest TKP amount for this customer (rough approximation)
        // Ideally match by tender_id
        const matchByTender = tkpList.find(t => t.tender_id === work.tender_id);
        if (matchByTender) {
          contractSum = matchByTender.total_sum;
        } else {
          // Take the highest TKP for this customer
          contractSum = tkpList[0].total_sum;
        }
      }
    }

    if (contractSum > 0) {
      const costPlan = Math.round(contractSum / 2);
      const currentContract = parseFloat(work.contract_sum) || 0;
      const currentCost = parseFloat(work.cost_plan) || 0;

      if (currentContract > 0 && currentCost > 0) {
        skipped++;
        continue;
      }

      if (!DRY_RUN) {
        await client.query(
          `UPDATE works SET
            contract_sum = COALESCE(NULLIF(contract_sum, 0), $1),
            cost_plan = COALESCE(NULLIF(cost_plan, 0), $2)
          WHERE id = $3`,
          [contractSum, costPlan, work.id]
        );
      }
      updated++;
    }
  }

  console.log(`  Updated: ${updated} works with prices, skipped: ${skipped} (already had prices)`);
}

// ═══════════════════════════════════════════════════════════════
// Phase 4: Link employees to works
// ═══════════════════════════════════════════════════════════════
async function phase4_linkEmployees(client) {
  console.log('\n=== PHASE 4: Link Employees to Works ===');

  const projectData = require('./project_data.json');

  // Get all employees
  const { rows: employees } = await client.query(
    "SELECT id, fio, full_name FROM employees WHERE fio IS NOT NULL"
  );

  // Build name lookup (multiple formats)
  function normalizeForMatch(name) {
    return name.replace(/\./g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function lastNameMatch(fio, fullName) {
    // "Баринов В.А." should match "Баринов Виктор Александрович"
    const fioParts = fio.split(/\s+/);
    const fullParts = fullName.split(/\s+/);
    if (fioParts.length === 0 || fullParts.length === 0) return false;

    // Same last name
    if (fioParts[0].toLowerCase() !== fullParts[0].toLowerCase()) return false;

    // Check initials match
    if (fioParts.length >= 2 && fullParts.length >= 2) {
      const fioInit = fioParts[1].charAt(0).toLowerCase();
      const fullInit = fullParts[1].charAt(0).toLowerCase();
      return fioInit === fullInit;
    }
    return true;
  }

  function findEmployee(name) {
    const normalized = normalizeForMatch(name);
    // Exact fio match
    let match = employees.find(e => normalizeForMatch(e.fio || '') === normalized);
    if (match) return match.id;

    // Full name match
    match = employees.find(e => normalizeForMatch(e.full_name || '') === normalized);
    if (match) return match.id;

    // Cross-format match (short name to full or vice versa)
    match = employees.find(e => {
      if (e.fio && lastNameMatch(e.fio, name)) return true;
      if (e.fio && lastNameMatch(name, e.fio)) return true;
      if (e.full_name && lastNameMatch(e.full_name, name)) return true;
      return false;
    });
    if (match) return match.id;

    // Last name only match
    const nameParts = name.split(/\s+/);
    if (nameParts.length > 0) {
      match = employees.find(e => {
        const eParts = (e.fio || '').split(/\s+/);
        return eParts[0] && eParts[0].toLowerCase() === nameParts[0].toLowerCase();
      });
      if (match) return match.id;
    }

    return null;
  }

  // Get works
  const { rows: works } = await client.query(`
    SELECT w.id, w.work_title, w.staff_ids_json
    FROM works w WHERE w.work_title NOT LIKE '%TEST%'
  `);

  let linked = 0, notMatched = 0;
  const unmatchedNames = new Set();

  for (const work of works) {
    const project = projectData.find(p => p.title === work.work_title);
    if (!project || !project.employees) continue;

    // Parse employee list
    const empNames = project.employees.split(/[,;\n]+/).map(n => n.trim()).filter(n => n.length > 2);
    if (empNames.length === 0) continue;

    const empIds = [];
    for (const name of empNames) {
      // Remove role annotations like "(Мастер)", "(Инженер ПТО)"
      const cleanName = name.replace(/\s*\([^)]+\)\s*$/, '').trim();
      const empId = findEmployee(cleanName);
      if (empId) {
        empIds.push(empId);
      } else {
        unmatchedNames.add(cleanName);
        notMatched++;
      }
    }

    if (empIds.length > 0) {
      const existing = work.staff_ids_json || [];
      const merged = [...new Set([...(Array.isArray(existing) ? existing : []), ...empIds])];

      if (!DRY_RUN) {
        await client.query(
          "UPDATE works SET staff_ids_json = $1 WHERE id = $2",
          [JSON.stringify(merged), work.id]
        );
      }
      linked++;
    }
  }

  if (unmatchedNames.size > 0) {
    console.log(`  Unmatched employee names (${unmatchedNames.size}):`);
    for (const name of [...unmatchedNames].slice(0, 20)) {
      console.log(`    - ${name}`);
    }
    if (unmatchedNames.size > 20) console.log(`    ... and ${unmatchedNames.size - 20} more`);
  }

  console.log(`  Linked: ${linked} works, unmatched names: ${notMatched}`);
}

// ═══════════════════════════════════════════════════════════════
// Phase 5: Import expenses
// ═══════════════════════════════════════════════════════════════
async function phase5_importExpenses(client) {
  console.log('\n=== PHASE 5: Import Expenses from Registry ===');

  const fp = path.join('C:', 'Users', 'Nikita-ASGARD', 'Downloads', 'Реестр счетов и Документов.xlsx');
  const wb = XLSX.readFile(fp);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Get all works for matching by object name
  const { rows: works } = await client.query(
    "SELECT id, work_title FROM works WHERE work_title IS NOT NULL"
  );

  // Build lookup: normalized title -> work_id
  function normalize(s) {
    return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  const workLookup = {};
  for (const w of works) {
    workLookup[normalize(w.work_title)] = w.id;
  }

  // Helper: convert Excel serial date to ISO string
  function excelDateToISO(serial) {
    if (!serial || typeof serial !== 'number') return null;
    const epoch = new Date(1899, 11, 30); // Excel epoch
    const date = new Date(epoch.getTime() + serial * 86400000);
    return date.toISOString().split('T')[0];
  }

  // Categorize expenses
  function categorizeExpense(objectName, contractor, description) {
    const text = `${objectName} ${contractor} ${description}`.toLowerCase();
    if (text.includes('зп') || text.includes('зарплат') || text.includes('фот') || text.includes('оплата труд')) return 'ФОТ';
    if (text.includes('гсм') || text.includes('топлив') || text.includes('бензин')) return 'ГСМ';
    if (text.includes('инструмент') || text.includes('оборудован')) return 'Оборудование';
    if (text.includes('химия') || text.includes('реагент') || text.includes('моющ')) return 'Материалы (химия)';
    if (text.includes('спецодежд') || text.includes('сиз') || text.includes('одежд')) return 'СИЗ';
    if (text.includes('проживан') || text.includes('гостиниц') || text.includes('отель')) return 'Проживание';
    if (text.includes('билет') || text.includes('перелет') || text.includes('жд') || text.includes('проезд')) return 'Командировки';
    if (text.includes('аренд')) return 'Аренда';
    if (text.includes('транспорт') || text.includes('доставк') || text.includes('логистик')) return 'Транспорт';
    return 'Материалы';
  }

  // Parse data rows (skip 3 header rows)
  let imported = 0, skipped = 0, noMatch = 0, errors = 0;
  const unmatched = {};

  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    const responsible = (row[1] || '').toString().trim(); // Ответственный за объект
    const objectName = (row[2] || '').toString().trim(); // Объект
    const invoiceNum = (row[3] || '').toString().trim(); // Номер счёта
    const dateRaw = row[4]; // Дата (Excel serial)
    const amount = parseFloat(row[5]) || 0; // Сумма
    const hasVat = (row[6] || '').toString().trim().toLowerCase(); // НДС
    const contractor = (row[7] || '').toString().trim(); // Контрагент
    const status = (row[14] || '').toString().trim(); // Состояние
    const comment = (row[17] || '').toString().trim(); // Комментарий
    const purpose1 = (row[18] || '').toString().trim(); // На объект Заказчика
    const purpose2 = (row[19] || '').toString().trim(); // Собственность АСГАРД
    const purpose3 = (row[20] || '').toString().trim(); // Расходники

    if (!objectName || objectName.length < 2 || amount <= 0) {
      skipped++;
      continue;
    }

    // Match object to work
    const normalizedObject = normalize(objectName);
    let workId = workLookup[normalizedObject];

    // Fuzzy match if exact doesn't work
    if (!workId) {
      for (const [key, id] of Object.entries(workLookup)) {
        if (key.includes(normalizedObject) || normalizedObject.includes(key)) {
          workId = id;
          break;
        }
      }
    }

    // Even fuzzier - match by significant word
    if (!workId) {
      const objectWords = normalizedObject.split(/\s+/).filter(w => w.length > 3);
      for (const [key, id] of Object.entries(workLookup)) {
        const match = objectWords.some(w => key.includes(w));
        if (match) {
          workId = id;
          break;
        }
      }
    }

    if (!workId) {
      noMatch++;
      unmatched[objectName] = (unmatched[objectName] || 0) + 1;
      continue;
    }

    const date = excelDateToISO(dateRaw);
    const category = categorizeExpense(objectName, contractor, `${purpose1} ${purpose2} ${purpose3}`);
    const description = [invoiceNum, contractor].filter(Boolean).join(' - ');
    const importHash = `expense_reg_${i}_${invoiceNum}_${amount}`;

    try {
      // Check for duplicate by import_hash
      const { rows: existing } = await client.query(
        "SELECT id FROM work_expenses WHERE import_hash = $1", [importHash]
      );

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO work_expenses (work_id, category, amount, date, description, document_number,
            counterparty, source, status, comment, import_hash, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'registry_import', $8, $9, $10, NOW())`,
          [workId, category, amount, date, description, invoiceNum,
           contractor, status || 'imported', comment, importHash]
        );
      }
      imported++;
    } catch (e) {
      errors++;
      if (errors <= 5) console.log(`  Error row ${i}: ${e.message.substring(0, 100)}`);
    }
  }

  if (Object.keys(unmatched).length > 0) {
    console.log(`\n  Unmatched objects (${Object.keys(unmatched).length}):`);
    const sorted = Object.entries(unmatched).sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted.slice(0, 20)) {
      console.log(`    - "${name}": ${count} expenses`);
    }
  }

  console.log(`\n  Imported: ${imported}, skipped: ${skipped}, no match: ${noMatch}, errors: ${errors}`);
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('='.repeat(60));
  console.log('ASGARD CRM - Data Import: PMs, Prices, Employees, Expenses');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Phases: ${PHASES.join(', ')}`);
  console.log('='.repeat(60));

  const client = new Client(DB);
  await client.connect();

  try {
    let pmMap = {};
    let archivePmId = null;

    if (PHASES.includes(1)) {
      const result = await phase1_createPMs(client);
      pmMap = result.pmMap;
      archivePmId = result.archivePmId;
    }

    if (PHASES.includes(2)) {
      if (!Object.keys(pmMap).length) {
        // Load PM map from DB
        const { rows } = await client.query(
          "SELECT id, name FROM users WHERE role = 'PM' AND login NOT LIKE 'wam_%' AND login NOT LIKE 'test_%'"
        );
        for (const r of rows) pmMap[r.name] = r.id;
        const { rows: arch } = await client.query("SELECT id FROM users WHERE login = 'archive_pm'");
        archivePmId = arch[0]?.id;
      }
      await phase2_assignWorks(client, pmMap, archivePmId);
    }

    if (PHASES.includes(3)) {
      await phase3_fillPrices(client);
    }

    if (PHASES.includes(4)) {
      await phase4_linkEmployees(client);
    }

    if (PHASES.includes(5)) {
      await phase5_importExpenses(client);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Import completed!');
    console.log('='.repeat(60));
  } finally {
    await client.end();
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
