/**
 * Create works from clean-data.json projects
 * Run on server: node create-works.js [--dry-run]
 *
 * 1. Reads clean-data.json (filter: Источник=Проект, Сумма>0) → 119 records
 * 2. Creates works via API (POST /api/data/works)
 * 3. Matches employees → staff_ids_json (triggers sync_employee_assignments)
 * 4. Links work_expenses to created works
 * 5. Updates cost_fact from linked expenses
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

const DB = { host: 'localhost', port: 5432, database: 'asgard_crm', user: 'asgard', password: '123456789' };
const BASE_URL = 'https://asgard-crm.ru';
const API_URL = `${BASE_URL}/api`;

// Admin credentials
const ADMIN_LOGIN = 'admin';
const ADMIN_PASSWORD = 'admin123';
const ADMIN_PIN = '1234';

// PM name → user_id mapping (from existing imports)
const PM_MAP = {
  'Зиссер Е.О.':       1226,
  'Трухин А.':          1225,
  'Пантузенко А.В.':    1230,
  'Путков Д.В.':        1231,
  'Погребняков С.В.':   1235,
  'Богданов Д.В.':      1229,
  'Климакин Д.':        1240,
  'Цветков А.В.':       1223,
  'Магомедов Р.Д.':     1234,
  'Коваленко А.А.':     1236,
  'Мараховский А.В.':   1227,
  'Яковлев А.А.':       1241,
  'Андросов Н.А.':      13,
  'Мартыненко Ю.':      1224,
  'Китуашвили Н.С.':    1228,
  'Очнев А.Л.':         1232,
  'Баринов В.А.':       1233,
  'Пономарев А.Е.':     1237,
  'Кузьмин М.М.':       1238,
  'Щедриков Д.С.':      1239,
};

// Generic/overhead expense descriptions that should NOT be linked to works
const GENERIC_EXPENSES = new Set([
  'офис', 'office', 'склад', 'склад королёв', 'склад мурманск',
  'склад тест химии', 'склад, наше авто', 'сро выписка', 'на тендер',
  'обучение босиет', 'лицензия на утилизацию', 'wam-exp',
  'эб комиссия', 'свг', 'для отг', 'кудряшов о. с.', 'кудряшов о.с.',
  'водитель', 'обслуживание то',
]);

// ═══════════════════════════════════════════════════════════════
// API helpers
// ═══════════════════════════════════════════════════════════════
let _fetch;
async function getFetch() {
  if (!_fetch) _fetch = (await import('node-fetch')).default;
  return _fetch;
}

async function loginAdmin() {
  const fetch = await getFetch();

  // Step 1: login + password → получаем temp token
  const loginResp = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: ADMIN_LOGIN, password: ADMIN_PASSWORD }),
  });
  const loginData = await loginResp.json();
  if (!loginResp.ok) throw new Error(`Login failed: ${loginData.error || loginResp.status}`);

  const tempToken = loginData.token;
  if (!tempToken) throw new Error('No token from login step');

  // Step 2: PIN verify → Bearer temp token + pin в body
  const pinResp = await fetch(`${API_URL}/auth/verify-pin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tempToken}`,
    },
    body: JSON.stringify({ pin: ADMIN_PIN }),
  });
  const pinData = await pinResp.json();
  if (!pinResp.ok) throw new Error(`PIN verify failed: ${pinData.error || pinResp.status}`);

  return pinData.token;
}

async function apiPost(token, endpoint, body) {
  const fetch = await getFetch();
  const resp = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`API POST ${endpoint} failed: ${JSON.stringify(data)}`);
  return data;
}

// ═══════════════════════════════════════════════════════════════
// Date parsing: "ДД.ММ.ГГГГ - ДД.ММ.ГГГГ" → { start, end }
// ═══════════════════════════════════════════════════════════════
function parseDateRange(str) {
  if (!str || typeof str !== 'string') return { start: null, end: null };

  // Handle multiple date ranges separated by ";" — take earliest start, latest end
  const ranges = str.split(';').map(s => s.trim()).filter(Boolean);

  let earliest = null;
  let latest = null;

  for (const range of ranges) {
    const m = range.match(/(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/);
    if (m) {
      const start = new Date(`${m[3]}-${m[2]}-${m[1]}`);
      const end = new Date(`${m[6]}-${m[5]}-${m[4]}`);
      if (!isNaN(start.getTime()) && (!earliest || start < earliest)) earliest = start;
      if (!isNaN(end.getTime()) && (!latest || end > latest)) latest = end;
    } else {
      // Single date: ДД.ММ.ГГГГ
      const s = range.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (s) {
        const d = new Date(`${s[3]}-${s[2]}-${s[1]}`);
        if (!isNaN(d.getTime())) {
          if (!earliest || d < earliest) earliest = d;
          if (!latest || d > latest) latest = d;
        }
      }
    }
  }

  return {
    start: earliest ? earliest.toISOString().split('T')[0] : null,
    end: latest ? latest.toISOString().split('T')[0] : null,
  };
}

// ═══════════════════════════════════════════════════════════════
// Employee matching
// ═══════════════════════════════════════════════════════════════
function buildEmployeeMatcher(employees) {
  // Pre-process employees for matching
  const empIndex = employees.map(e => {
    const fio = (e.fio || '').trim();
    const fullName = (e.full_name || '').trim();
    const fioParts = fio.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const fullParts = fullName.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    return { id: e.id, fio, fullName, fioParts, fullParts };
  });

  return function findEmployee(name) {
    // Remove parenthetical info like "(Мастер Очнев Андрей Львович)"
    const cleanName = name.replace(/\s*\([^)]+\)\s*$/, '').trim();
    const normalized = cleanName.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
    const parts = normalized.split(' ').filter(Boolean);
    if (parts.length === 0) return null;

    const surname = parts[0];

    // Strategy 1: Exact match on fio
    let m = empIndex.find(e => e.fio.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim() === normalized);
    if (m) return m.id;

    // Strategy 2: Exact match on full_name
    m = empIndex.find(e => e.fullName.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim() === normalized);
    if (m) return m.id;

    // Strategy 3: Surname + initials match on fio
    m = empIndex.find(e => {
      if (!e.fioParts[0] || e.fioParts[0] !== surname) return false;
      if (parts.length >= 2 && e.fioParts.length >= 2) {
        return e.fioParts[1].charAt(0) === parts[1].charAt(0);
      }
      return parts.length === 1; // Only surname, match if surname is unique
    });
    if (m) return m.id;

    // Strategy 4: Surname + initials match on full_name
    m = empIndex.find(e => {
      if (!e.fullParts[0] || e.fullParts[0] !== surname) return false;
      if (parts.length >= 2 && e.fullParts.length >= 2) {
        return e.fullParts[1].charAt(0) === parts[1].charAt(0);
      }
      return parts.length === 1;
    });
    if (m) return m.id;

    // Strategy 5: Only surname (if unique in DB)
    const surnameMatches = empIndex.filter(e =>
      e.fioParts[0] === surname || e.fullParts[0] === surname
    );
    if (surnameMatches.length === 1) return surnameMatches[0].id;

    return null;
  };
}

// ═══════════════════════════════════════════════════════════════
// Tender matching
// ═══════════════════════════════════════════════════════════════
function findTender(tenders, project) {
  const title = (project['Название'] || '').trim().toLowerCase();
  const customer = (project['Заказчик'] || '').trim().toLowerCase();
  const inn = (project['ИНН'] || '').trim();

  // Strategy 1: customer_name + title exact match
  let m = tenders.find(t =>
    (t.customer_name || '').trim().toLowerCase() === customer &&
    (t.tender_title || '').trim().toLowerCase() === title
  );
  if (m) return m.id;

  // Strategy 2: customer_inn + title contains
  if (inn) {
    m = tenders.find(t =>
      (t.customer_inn || '').trim() === inn &&
      ((t.tender_title || '').toLowerCase().includes(title) || title.includes((t.tender_title || '').toLowerCase()))
    );
    if (m) return m.id;
  }

  // Strategy 3: title contains match (both directions)
  m = tenders.find(t => {
    const tt = (t.tender_title || '').trim().toLowerCase();
    return tt && title && (tt.includes(title) || title.includes(tt));
  });
  if (m) return m.id;

  // Strategy 4: Customer name match + keyword overlap
  const titleWords = title.split(/[\s,.\-_()]+/).filter(w => w.length > 3);
  if (titleWords.length > 0) {
    m = tenders.find(t => {
      const tt = (t.tender_title || '').toLowerCase();
      const tc = (t.customer_name || '').toLowerCase();
      const custMatch = customer && tc && (tc.includes(customer) || customer.includes(tc));
      if (!custMatch) return false;
      return titleWords.some(w => tt.includes(w));
    });
    if (m) return m.id;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// Expense linking (adapted from relink-expenses.js)
// ═══════════════════════════════════════════════════════════════
function buildExpenseMatcher(works) {
  const workIndex = works.map(w => {
    const title = (w.work_title || '').toLowerCase();
    const customer = (w.customer_name || '').toLowerCase();
    const keywords = title.split(/[\s,.\-_()]+/).filter(w => w.length > 3);
    return { id: w.id, title, customer, keywords, originalTitle: w.work_title };
  });

  return function matchExpense(description) {
    const desc = (description || '').toLowerCase().trim();
    if (!desc || GENERIC_EXPENSES.has(desc)) return null;

    // Strategy 1: Exact title match
    let m = workIndex.find(w => w.title === desc);
    if (m) return m.id;

    // Strategy 2: Title contains description (or vice versa)
    const descClean = desc.replace(/^\d+\.\s*/, '');
    m = workIndex.find(w => {
      const titleClean = w.title.replace(/^\d+\.\s*/, '');
      return titleClean && descClean && (titleClean.includes(descClean) || descClean.includes(titleClean));
    });
    if (m) return m.id;

    // Strategy 3: Keyword overlap (at least 6 chars total weight)
    const descWords = desc.split(/[\s,.\-_()]+/).filter(w => w.length > 3);
    let bestMatch = null;
    let bestScore = 0;
    for (const w of workIndex) {
      let score = 0;
      for (const dw of descWords) {
        if (w.title.includes(dw) || w.customer.includes(dw)) {
          score += dw.length;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = w;
      }
    }
    if (bestMatch && bestScore >= 6) return bestMatch.id;

    // Strategy 4: Customer name match
    m = workIndex.find(w =>
      w.customer && (w.customer.includes(desc) || desc.includes(w.customer))
    );
    if (m) return m.id;

    return null;
  };
}

// ═══════════════════════════════════════════════════════════════
// PM matching — resolve PM name from clean-data to user_id
// ═══════════════════════════════════════════════════════════════
function findPmId(pmName) {
  if (!pmName) return null;
  const name = pmName.trim();

  // Direct match
  if (PM_MAP[name]) return PM_MAP[name];

  // Fuzzy match: try matching by surname
  const surname = name.split(/[\s.]+/)[0].toLowerCase();
  for (const [key, id] of Object.entries(PM_MAP)) {
    if (key.split(/[\s.]+/)[0].toLowerCase() === surname) return id;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('='.repeat(60));
  console.log('ASGARD CRM - Create Works from Projects');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('='.repeat(60));

  // 1. Load clean-data.json
  const dataPath = path.join(__dirname, 'clean-data.json');
  if (!fs.existsSync(dataPath)) {
    console.error(`File not found: ${dataPath}`);
    process.exit(1);
  }
  const allData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const projects = allData.filter(r =>
    r['Источник'] === 'Проект' &&
    parseFloat(r['Сумма'] || r['Сумма договора'] || 0) > 0
  );
  console.log(`\nLoaded ${allData.length} records, ${projects.length} projects with Сумма > 0`);

  // 2. Login to API
  console.log('\nLogging in to API...');
  let token;
  try {
    token = await loginAdmin();
    console.log('  Authenticated as admin');
  } catch (e) {
    console.error('  Login failed:', e.message);
    process.exit(1);
  }

  // 3. Connect to PostgreSQL
  const client = new Client(DB);
  await client.connect();
  console.log('  Connected to PostgreSQL');

  try {
    // 4. Load reference data from DB
    const { rows: employees } = await client.query(
      "SELECT id, fio, full_name FROM employees WHERE fio IS NOT NULL OR full_name IS NOT NULL"
    );
    console.log(`  Employees: ${employees.length}`);

    const { rows: tenders } = await client.query(
      "SELECT id, tender_title, customer_name, customer_inn FROM tenders"
    );
    console.log(`  Tenders: ${tenders.length}`);

    const { rows: existingWorks } = await client.query(
      "SELECT id, work_title, tender_id FROM works"
    );
    console.log(`  Existing works: ${existingWorks.length}`);

    // Check for already existing works to avoid duplicates
    const existingTitles = new Set(existingWorks.map(w => (w.work_title || '').trim().toLowerCase()));

    const findEmp = buildEmployeeMatcher(employees);

    // 5. Create works
    console.log('\n=== Creating Works ===\n');
    let created = 0, skipped = 0, errors = 0;
    const createdWorks = []; // { id, title, customer } for expense linking
    const unmatchedPMs = new Set();
    const unmatchedEmps = new Set();
    const stats = { withPm: 0, withStaff: 0, withDates: 0, withTender: 0 };

    for (const proj of projects) {
      const title = (proj['Название'] || '').trim();
      if (!title) { skipped++; continue; }

      // Check if already exists
      if (existingTitles.has(title.toLowerCase())) {
        console.log(`  [SKIP] "${title}" — already exists`);
        skipped++;
        continue;
      }

      // Parse fields
      const contractSum = parseFloat(proj['Сумма договора'] || proj['Сумма'] || 0);
      const costPlan = Math.round(contractSum / 2);
      const { start, end } = parseDateRange(proj['Даты работ']);

      // Match PM
      const pmName = (proj['Руководитель проекта'] || '').trim();
      const pmId = findPmId(pmName);
      if (pmName && !pmId) unmatchedPMs.add(pmName);
      if (pmId) stats.withPm++;

      // Match employees
      const empStr = (proj['Сотрудники'] || '').trim();
      const staffIds = [];
      if (empStr) {
        const names = empStr.split(/[;\n]+/).map(n => n.trim()).filter(n => n.length > 2);
        for (const name of names) {
          const empId = findEmp(name);
          if (empId) {
            if (!staffIds.includes(empId)) staffIds.push(empId);
          } else {
            unmatchedEmps.add(name);
          }
        }
      }
      if (staffIds.length > 0) stats.withStaff++;
      if (start) stats.withDates++;

      // Match tender
      const tenderId = findTender(tenders, proj);
      if (tenderId) stats.withTender++;

      // Build work object
      const workData = {
        work_title: title,
        customer_name: (proj['Заказчик'] || '').trim(),
        customer_inn: (proj['ИНН'] || '').trim() || null,
        contract_sum: contractSum,
        cost_plan: costPlan,
        work_number: (proj['№ договора'] || '').trim() || null,
        work_status: 'Работы сдали',
        tender_id: tenderId || null,
        pm_id: pmId || null,
        start_plan: start || null,
        end_date_plan: end || null,
        staff_ids_json: staffIds.length > 0 ? JSON.stringify(staffIds) : null,
      };

      if (DRY_RUN) {
        console.log(`  [DRY-RUN] Would create: "${title}" (sum=${contractSum}, pm=${pmName||'—'}, staff=${staffIds.length}, tender=${tenderId||'—'})`);
        created++;
        continue;
      }

      // Create via Data API (supports all columns, triggers fire on INSERT)
      try {
        const result = await apiPost(token, '/data/works', workData);
        const workId = result.id || result.item?.id;
        if (!workId) throw new Error('No work ID returned: ' + JSON.stringify(result));

        createdWorks.push({
          id: workId,
          title: title,
          customer: workData.customer_name,
        });

        console.log(`  [OK] #${workId} "${title}" (sum=${contractSum}, pm=${pmId||'—'}, staff=${staffIds.length})`);
        created++;

        // Small delay to avoid overwhelming the API
        await new Promise(r => setTimeout(r, 100));
      } catch (e) {
        console.error(`  [ERR] "${title}": ${e.message}`);
        errors++;
      }
    }

    console.log(`\n--- Works Summary ---`);
    console.log(`Created: ${created}, Skipped: ${skipped}, Errors: ${errors}`);
    console.log(`With PM: ${stats.withPm}, With staff: ${stats.withStaff}, With dates: ${stats.withDates}, Linked to tender: ${stats.withTender}`);

    if (unmatchedPMs.size > 0) {
      console.log(`\nUnmatched PMs (${unmatchedPMs.size}):`);
      for (const pm of unmatchedPMs) console.log(`  - ${pm}`);
    }
    if (unmatchedEmps.size > 0) {
      console.log(`\nUnmatched employees (${unmatchedEmps.size}):`);
      [...unmatchedEmps].slice(0, 20).forEach(n => console.log(`  - ${n}`));
      if (unmatchedEmps.size > 20) console.log(`  ... and ${unmatchedEmps.size - 20} more`);
    }

    // 6. Link expenses
    if (!DRY_RUN && createdWorks.length > 0) {
      console.log('\n=== Linking Expenses ===\n');

      // Reload all works (including newly created)
      const { rows: allWorks } = await client.query(
        "SELECT id, work_title, customer_name FROM works"
      );
      const matchExpense = buildExpenseMatcher(allWorks);

      // Get unlinked expenses
      const { rows: expGroups } = await client.query(`
        SELECT description, count(*) as cnt, round(sum(amount)::numeric, 2) as total,
          array_agg(id) as ids
        FROM work_expenses WHERE work_id IS NULL AND description IS NOT NULL
        GROUP BY description
        ORDER BY total DESC
      `);

      console.log(`Unlinked expense groups: ${expGroups.length}`);
      let totalLinked = 0;

      for (const group of expGroups) {
        const matchId = matchExpense(group.description);
        if (matchId) {
          const ids = group.ids;
          const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
          await client.query(
            `UPDATE work_expenses SET work_id = $1 WHERE id IN (${placeholders})`,
            [matchId, ...ids]
          );
          totalLinked += ids.length;
          console.log(`  -> "${group.description}" (${ids.length} exp, ${group.total}) -> work #${matchId}`);
        }
      }

      console.log(`\nTotal expenses linked: ${totalLinked}`);

      // 7. Update cost_fact for all works from linked expenses
      const { rowCount } = await client.query(`
        UPDATE works SET cost_fact = sub.total
        FROM (SELECT work_id, round(SUM(amount)::numeric, 2) as total FROM work_expenses WHERE work_id IS NOT NULL GROUP BY work_id) sub
        WHERE works.id = sub.work_id
      `);
      console.log(`Updated cost_fact for ${rowCount} works`);

      // For works without expenses, set cost_fact = cost_plan (Сумма/2)
      await client.query(`
        UPDATE works SET cost_fact = cost_plan
        WHERE cost_fact IS NULL AND cost_plan IS NOT NULL AND cost_plan > 0
      `);
    }

    // 8. Final stats
    console.log('\n=== Final Stats ===');
    const { rows: [wStats] } = await client.query(`
      SELECT count(*) as total,
        count(*) FILTER (WHERE work_status = 'Работы сдали') as completed,
        count(pm_id) as with_pm,
        count(staff_ids_json) as with_staff,
        round(sum(contract_sum)::numeric, 2) as total_contract,
        round(sum(cost_plan)::numeric, 2) as total_cost_plan,
        round(sum(cost_fact)::numeric, 2) as total_cost_fact
      FROM works
    `);
    console.log(`Works: ${wStats.total} total (${wStats.completed} completed, ${wStats.with_pm} with PM, ${wStats.with_staff} with staff)`);
    console.log(`Contract sum: ${wStats.total_contract}, Cost plan: ${wStats.total_cost_plan}, Cost fact: ${wStats.total_cost_fact}`);

    const { rows: [aStats] } = await client.query(
      "SELECT count(*) as total FROM employee_assignments"
    );
    console.log(`Employee assignments: ${aStats.total}`);

    const { rows: [eStats] } = await client.query(`
      SELECT count(*) as total, count(work_id) as linked, count(*) - count(work_id) as unlinked,
        round(sum(amount)::numeric, 2) as total_amount,
        round(sum(CASE WHEN work_id IS NOT NULL THEN amount ELSE 0 END)::numeric, 2) as linked_amount
      FROM work_expenses
    `);
    console.log(`Expenses: ${eStats.total} total, ${eStats.linked} linked, ${eStats.unlinked} unlinked`);
    console.log(`Amount: ${eStats.total_amount} total, ${eStats.linked_amount} linked`);

  } finally {
    await client.end();
  }

  console.log('\n' + '='.repeat(60));
  console.log('DONE!');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
