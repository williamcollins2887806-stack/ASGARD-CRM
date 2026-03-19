/**
 * Server-side import script for PM assignments, prices, employees, and expenses.
 * Run on the server: node import_server.js [--dry-run] [--phase=1,2,3,4,5]
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DRY_RUN = process.argv.includes('--dry-run');
const phaseArg = process.argv.find(a => a.startsWith('--phase='));
const PHASES = phaseArg ? phaseArg.split('=')[1].split(',').map(Number) : [1,2,3,4,5];

const DB = { host: 'localhost', port: 5432, database: 'asgard_crm', user: 'asgard', password: '123456789' };

function hashPassword(pw) { return crypto.createHash('sha256').update(pw).digest('hex'); }
const PM_PASSWORD = 'Asgard2026!';
const PM_PASSWORD_HASH = hashPassword(PM_PASSWORD);

const scriptDir = __dirname;
const projectData = JSON.parse(fs.readFileSync(path.join(scriptDir, 'project_data.json'), 'utf8'));
const expenseData = JSON.parse(fs.readFileSync(path.join(scriptDir, 'expense_data.json'), 'utf8'));

function transliterate(name) {
  const map = {
    'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'E','Ж':'Zh','З':'Z','И':'I','Й':'Y',
    'К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F',
    'Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Sch','Ъ':'','Ы':'Y','Ь':'','Э':'E','Ю':'Yu','Я':'Ya',
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y',
    'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
    'х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
  };
  return name.split('').map(c => map[c] || c).join('').replace(/[^\x00-\x7F]/g, '');
}

function makeLogin(name) {
  const parts = name.replace(/\./g, ' ').trim().split(/\s+/);
  if (parts.length >= 2) {
    const surname = transliterate(parts[0]);
    const initials = parts.slice(1).map(p => transliterate(p.charAt(0))).join('');
    return (initials + '.' + surname).toLowerCase().replace(/[^a-z0-9._-]/g, '');
  }
  return transliterate(name).toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/\s+/g, '_');
}

// ═══════════════════════════════════════════════════════════════
// Phase 1: Create PM users
// ═══════════════════════════════════════════════════════════════
async function phase1(client) {
  console.log('\n=== PHASE 1: Create PM Users ===');
  const uniquePMs = {};
  for (const p of projectData) {
    if (p.pm) uniquePMs[p.pm] = (uniquePMs[p.pm] || 0) + 1;
  }

  const pmMap = {};
  let created = 0, existing = 0;

  const { rows: existingUsers } = await client.query(
    "SELECT id, login, name FROM users WHERE role = 'PM' AND login NOT LIKE 'wam_%' AND login NOT LIKE 'test_%'"
  );

  for (const [pmName, count] of Object.entries(uniquePMs)) {
    // Match by name parts
    const pmParts = pmName.toLowerCase().split(/[\s.]+/).filter(p => p.length > 1);
    const existingMatch = existingUsers.find(u => {
      const uParts = (u.name || '').toLowerCase().split(/[\s.]+/).filter(p => p.length > 1);
      // Match if last name matches
      return pmParts[0] && uParts[0] && pmParts[0] === uParts[0];
    });

    if (existingMatch) {
      pmMap[pmName] = existingMatch.id;
      existing++;
      console.log(`  [EXISTS] ${pmName} -> user_id=${existingMatch.id} (${existingMatch.login})`);
      continue;
    }

    const login = makeLogin(pmName);

    const { rows: conflict } = await client.query("SELECT id FROM users WHERE login = $1", [login]);
    if (conflict.length > 0) {
      pmMap[pmName] = conflict[0].id;
      existing++;
      console.log(`  [LOGIN EXISTS] ${pmName} -> ${login} -> user_id=${conflict[0].id}`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY-RUN] Would create: ${login} / ${pmName} / PM (${count} works)`);
    } else {
      const { rows } = await client.query(
        `INSERT INTO users (login, password_hash, name, role, is_active, created_at)
         VALUES ($1, $2, $3, 'PM', true, NOW()) RETURNING id`,
        [login, PM_PASSWORD_HASH, pmName]
      );
      pmMap[pmName] = rows[0].id;
      created++;
      console.log(`  [CREATED] ${login} (id=${rows[0].id}) -> ${pmName} (${count} works)`);
    }
  }

  // Archive PM
  const { rows: archCheck } = await client.query("SELECT id FROM users WHERE login = 'archive_pm'");
  let archivePmId;
  if (archCheck.length > 0) {
    archivePmId = archCheck[0].id;
    console.log(`  [EXISTS] Archive PM -> user_id=${archivePmId}`);
  } else if (!DRY_RUN) {
    const { rows } = await client.query(
      `INSERT INTO users (login, password_hash, name, role, is_active, created_at)
       VALUES ('archive_pm', $1, 'Архивный РП', 'PM', true, NOW()) RETURNING id`,
      [PM_PASSWORD_HASH]
    );
    archivePmId = rows[0].id;
    console.log(`  [CREATED] archive_pm (id=${archivePmId})`);
  }

  console.log(`  Summary: ${created} created, ${existing} existing`);
  console.log(`  PM password for all new accounts: ${PM_PASSWORD}`);
  return { pmMap, archivePmId };
}

// ═══════════════════════════════════════════════════════════════
// Phase 2: Assign works to PMs
// ═══════════════════════════════════════════════════════════════
async function phase2(client, pmMap, archivePmId) {
  console.log('\n=== PHASE 2: Assign Works to PMs ===');

  const { rows: works } = await client.query(`
    SELECT w.id, w.work_title, w.tender_id, t.tender_title, w.pm_id
    FROM works w LEFT JOIN tenders t ON w.tender_id = t.id
    WHERE w.work_title NOT LIKE '%TEST%' AND w.work_title NOT LIKE 'Advance%'
      AND w.work_title NOT LIKE 'Finance%' AND w.work_title NOT LIKE 'Validation%'
      AND w.work_title NOT LIKE 'MATRIX%' AND w.work_title NOT LIKE 'HEAD_%'
      AND w.work_title NOT LIKE 'PM-Work%' AND w.work_title NOT LIKE 'Expense%'
      AND w.work_title NOT LIKE 'Cash source%' AND w.work_title NOT LIKE 'Approval%'
      AND w.work_title NOT LIKE 'Status%' AND w.work_title NOT LIKE 'Value test%'
      AND w.work_title NOT LIKE 'XSS%' AND w.work_title NOT LIKE '%SELECT%'
      AND w.work_title NOT LIKE '%script%' AND w.work_title NOT LIKE '%marquee%'
      AND w.work_title NOT LIKE 'Work Status%' AND w.work_title NOT LIKE 'HEAD_TO%'
  `);

  let assigned = 0, archiveCount = 0, already = 0;

  for (const work of works) {
    if (work.pm_id) { already++; continue; }

    const title = work.work_title || '';
    const tenderTitle = work.tender_title || '';
    const project = projectData.find(p => p.title === title || p.title === tenderTitle);

    let pmId = null;
    if (project && project.pm && pmMap[project.pm]) {
      pmId = pmMap[project.pm];
    } else {
      pmId = archivePmId;
      archiveCount++;
    }

    if (pmId && !DRY_RUN) {
      await client.query('UPDATE works SET pm_id = $1 WHERE id = $2', [pmId, work.id]);
      assigned++;
    } else if (pmId) {
      assigned++;
    }
  }

  console.log(`  Assigned: ${assigned} works (${archiveCount} to archive PM), already had PM: ${already}`);
}

// ═══════════════════════════════════════════════════════════════
// Phase 3: Fill contract sums
// ═══════════════════════════════════════════════════════════════
async function phase3(client) {
  console.log('\n=== PHASE 3: Fill Contract Sums from TKP ===');

  const { rows: tkpRecords } = await client.query(
    "SELECT id, customer_name, subject, total_sum, tender_id FROM tkp WHERE total_sum > 0 ORDER BY total_sum DESC"
  );

  // Build lookup by customer
  const tkpByCustomer = {};
  const tkpByTender = {};
  for (const tkp of tkpRecords) {
    const key = (tkp.customer_name || '').trim().toUpperCase();
    if (!tkpByCustomer[key]) tkpByCustomer[key] = [];
    tkpByCustomer[key].push(tkp);
    if (tkp.tender_id) {
      if (!tkpByTender[tkp.tender_id]) tkpByTender[tkp.tender_id] = [];
      tkpByTender[tkp.tender_id].push(tkp);
    }
  }

  const { rows: works } = await client.query(`
    SELECT w.id, w.work_title, w.tender_id, w.customer_name, w.customer_inn,
           w.contract_value, w.cost_plan, t.customer_name as tcust
    FROM works w LEFT JOIN tenders t ON w.tender_id = t.id
    WHERE w.work_title NOT LIKE '%TEST%'
  `);

  let updated = 0, skipped = 0;

  for (const work of works) {
    const currentSum = parseFloat(work.contract_value) || 0;
    if (currentSum > 0) { skipped++; continue; }

    // 1. Match by tender_id
    let tkp = null;
    if (work.tender_id && tkpByTender[work.tender_id]) {
      tkp = tkpByTender[work.tender_id][0]; // highest sum
    }

    // 2. Match by customer name
    if (!tkp) {
      const cust = (work.customer_name || work.tcust || '').trim().toUpperCase();
      if (cust && tkpByCustomer[cust]) {
        tkp = tkpByCustomer[cust][0];
      }
    }

    // 3. Project data from Excel
    const project = projectData.find(p => p.title === work.work_title);
    const excelContract = project?.contractSum || 0;

    const contractSum = excelContract > 0 ? excelContract : (tkp ? parseFloat(tkp.total_sum) : 0);
    if (contractSum <= 0) continue;

    const costPlan = Math.round(contractSum / 2);

    if (!DRY_RUN) {
      await client.query(
        'UPDATE works SET contract_value = $1, cost_plan = $2 WHERE id = $3',
        [contractSum, costPlan, work.id]
      );
    }
    updated++;
  }

  console.log(`  Updated: ${updated} works with prices, skipped: ${skipped} (already had)`);
}

// ═══════════════════════════════════════════════════════════════
// Phase 4: Link employees to works
// ═══════════════════════════════════════════════════════════════
async function phase4(client) {
  console.log('\n=== PHASE 4: Link Employees to Works ===');

  const { rows: employees } = await client.query("SELECT id, fio, full_name FROM employees WHERE fio IS NOT NULL");

  function findEmployee(name) {
    const cleanName = name.replace(/\s*\([^)]+\)\s*$/, '').trim();
    const normalized = cleanName.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();

    // Exact fio match
    let m = employees.find(e => (e.fio || '').toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim() === normalized);
    if (m) return m.id;

    // Full name match
    m = employees.find(e => (e.full_name || '').toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim() === normalized);
    if (m) return m.id;

    // Last name + initial match
    const parts = normalized.split(/\s+/);
    if (parts.length >= 1) {
      m = employees.find(e => {
        const eParts = (e.fio || '').toLowerCase().split(/[\s.]+/).filter(p => p);
        if (!eParts[0]) return false;
        if (eParts[0] !== parts[0]) return false;
        if (parts.length >= 2 && eParts.length >= 2) {
          return eParts[1].charAt(0) === parts[1].charAt(0);
        }
        return true;
      });
      if (m) return m.id;

      // Also check full_name
      m = employees.find(e => {
        const eParts = (e.full_name || '').toLowerCase().split(/\s+/);
        if (!eParts[0]) return false;
        if (eParts[0] !== parts[0]) return false;
        if (parts.length >= 2 && eParts.length >= 2) {
          return eParts[1].charAt(0) === parts[1].charAt(0);
        }
        return true;
      });
      if (m) return m.id;
    }

    return null;
  }

  const { rows: works } = await client.query(
    "SELECT id, work_title, staff_ids_json FROM works WHERE work_title NOT LIKE '%TEST%'"
  );

  let linked = 0, notMatched = 0;
  const unmatchedNames = new Set();

  for (const work of works) {
    const project = projectData.find(p => p.title === work.work_title);
    if (!project || !project.employees) continue;

    const empNames = project.employees.split(/[,;\n]+/).map(n => n.trim()).filter(n => n.length > 2);
    if (empNames.length === 0) continue;

    const empIds = [];
    for (const name of empNames) {
      const empId = findEmployee(name);
      if (empId) empIds.push(empId);
      else { unmatchedNames.add(name); notMatched++; }
    }

    if (empIds.length > 0) {
      const existing = Array.isArray(work.staff_ids_json) ? work.staff_ids_json : [];
      const merged = [...new Set([...existing, ...empIds])];

      if (!DRY_RUN) {
        await client.query("UPDATE works SET staff_ids_json = $1 WHERE id = $2", [JSON.stringify(merged), work.id]);
      }
      linked++;
    }
  }

  if (unmatchedNames.size > 0) {
    console.log(`  Unmatched names (${unmatchedNames.size}):`);
    [...unmatchedNames].slice(0, 15).forEach(n => console.log(`    - ${n}`));
    if (unmatchedNames.size > 15) console.log(`    ... and ${unmatchedNames.size - 15} more`);
  }
  console.log(`  Linked employees to ${linked} works, unmatched: ${notMatched}`);
}

// ═══════════════════════════════════════════════════════════════
// Phase 5: Import expenses
// ═══════════════════════════════════════════════════════════════
async function phase5(client) {
  console.log('\n=== PHASE 5: Import Expenses ===');

  const { rows: works } = await client.query("SELECT id, work_title FROM works WHERE work_title IS NOT NULL");
  const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const workLookup = {};
  for (const w of works) workLookup[norm(w.work_title)] = w.id;

  function excelDateToISO(serial) {
    if (!serial || typeof serial !== 'number') return null;
    const epoch = new Date(1899, 11, 30);
    const date = new Date(epoch.getTime() + serial * 86400000);
    const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }

  function categorize(object, contractor, purposes) {
    const t = `${object} ${contractor} ${purposes}`.toLowerCase();
    if (t.match(/зп|зарплат|фот|оплата\s*труд/)) return 'ФОТ';
    if (t.match(/гсм|топлив|бензин|дизел/)) return 'ГСМ';
    if (t.match(/инструмент/)) return 'Инструмент';
    if (t.match(/оборудован/)) return 'Оборудование';
    if (t.match(/хими|реагент|моющ/)) return 'Материалы (химия)';
    if (t.match(/спецодежд|сиз|каска|перчат/)) return 'СИЗ';
    if (t.match(/проживан|гостиниц|отел/)) return 'Проживание';
    if (t.match(/билет|перелет|жд\s|проезд|авиа/)) return 'Командировки';
    if (t.match(/аренд/)) return 'Аренда';
    if (t.match(/транспорт|доставк|логистик|перевоз/)) return 'Транспорт';
    if (t.match(/питан|еда|вода|продукт/)) return 'Питание';
    if (t.match(/связь|интернет|телефон|сим/)) return 'Связь';
    return 'Материалы';
  }

  // Manual alias map for expense objects -> work titles
  const ALIASES = {
    'агпз': 'агхк',
    'амурский гхк': 'агхк',
    'амурский газохимический': 'агхк',
    'выкса': 'выкса - турки',
    'гнш ремонт огн подогр.': 'огневой подогреватель',
    'гнш ремонт огн подогр': 'огневой подогреватель',
    'огневой подогреватель': 'приразломная - подогреватели',
    'гнш ремонт': 'приразломная - подогреватели',
    'екатеринбург': 'екатеринбург',
    'мурманск': 'мурманск',
  };

  function matchWork(objectName) {
    let n = norm(objectName);

    // Check alias first
    for (const [alias, target] of Object.entries(ALIASES)) {
      if (n.includes(alias)) { n = target; break; }
    }

    // Skip non-work objects
    if (['офис', 'склад', 'обслуживание то', 'кудряшов о.с.', 'кудряшов о. с.',
         'сро выписка', 'склад мурманск', 'водитель'].includes(n)) {
      return null; // These are office/general expenses, not work-linked
    }

    // Exact
    if (workLookup[n]) return workLookup[n];

    // Contains
    for (const [key, id] of Object.entries(workLookup)) {
      if (key.includes(n) || n.includes(key)) return id;
    }

    // Word match (significant words > 3 chars)
    const words = n.split(/[\s,;]+/).filter(w => w.length > 3 &&
      !['обслуживание','проект','ремонт','работ','объект','ооо','оао'].includes(w));
    if (words.length > 0) {
      for (const [key, id] of Object.entries(workLookup)) {
        for (const w of words) {
          if (key.includes(w)) return id;
        }
      }
    }

    return null;
  }

  let imported = 0, skipped = 0, noMatch = 0, errors = 0;
  const unmatched = {};

  for (const exp of expenseData) {
    const workId = matchWork(exp.object);
    if (!workId) {
      noMatch++;
      unmatched[exp.object] = (unmatched[exp.object] || 0) + 1;
      continue;
    }

    const date = excelDateToISO(exp.dateRaw);
    const category = categorize(exp.object, exp.contractor, `${exp.purpose1} ${exp.purpose2} ${exp.purpose3}`);
    const description = [exp.invoiceNum, exp.contractor].filter(Boolean).join(' — ');
    const importHash = `expreg_${exp.rowIndex}_${exp.invoiceNum}_${exp.amount}`;

    try {
      const { rows: dup } = await client.query("SELECT id FROM work_expenses WHERE import_hash = $1", [importHash]);
      if (dup.length > 0) { skipped++; continue; }

      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO work_expenses (work_id, category, amount, date, description, document_number,
            counterparty, source, status, comment, import_hash, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'registry_import', $8, $9, $10, NOW())`,
          [workId, category, exp.amount, date, description, exp.invoiceNum,
           exp.contractor, exp.status || 'imported', exp.comment, importHash]
        );
      }
      imported++;
    } catch (e) {
      errors++;
      if (errors <= 5) console.log(`  Error: ${e.message.substring(0, 120)}`);
    }
  }

  if (Object.keys(unmatched).length > 0) {
    console.log(`\n  Unmatched objects (${Object.keys(unmatched).length}):`);
    Object.entries(unmatched).sort((a,b) => b[1] - a[1]).slice(0, 15)
      .forEach(([n, c]) => console.log(`    - "${n}": ${c} expenses`));
  }

  console.log(`\n  Imported: ${imported}, skipped: ${skipped}, no match: ${noMatch}, errors: ${errors}`);

  // Update cost_fact on works
  if (!DRY_RUN) {
    const { rowCount } = await client.query(`
      UPDATE works SET cost_fact = sub.total
      FROM (SELECT work_id, SUM(amount) as total FROM work_expenses GROUP BY work_id) sub
      WHERE works.id = sub.work_id
    `);
    console.log(`  Updated cost_fact for ${rowCount} works`);
  }
}

// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('='.repeat(60));
  console.log('ASGARD CRM - Data Import');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Phases: ${PHASES.join(', ')}`);
  console.log('='.repeat(60));

  const client = new Client(DB);
  await client.connect();

  try {
    let pmMap = {}, archivePmId = null;

    if (PHASES.includes(1)) {
      ({ pmMap, archivePmId } = await phase1(client));
    }

    if (PHASES.includes(2)) {
      if (!Object.keys(pmMap).length) {
        const { rows } = await client.query(
          "SELECT id, name FROM users WHERE role = 'PM' AND login NOT LIKE 'wam_%' AND login NOT LIKE 'test_%'"
        );
        for (const r of rows) pmMap[r.name] = r.id;
        const { rows: a } = await client.query("SELECT id FROM users WHERE login = 'archive_pm'");
        archivePmId = a[0]?.id;
      }
      await phase2(client, pmMap, archivePmId);
    }

    if (PHASES.includes(3)) await phase3(client);
    if (PHASES.includes(4)) await phase4(client);
    if (PHASES.includes(5)) await phase5(client);

    console.log('\n' + '='.repeat(60));
    console.log('DONE!');
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
