const { Client } = require('pg');
const fs = require('fs');

async function main() {
  let password = 'asgard';
  try {
    const envContent = fs.readFileSync('/var/www/asgard-crm/.env', 'utf8');
    const match = envContent.match(/DB_PASSWORD=(.+)/);
    if (match) password = match[1].trim();
  } catch(e) {
    console.log('Could not read .env, using default password');
  }

  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'asgard_crm',
    user: 'asgard',
    password: password
  });

  await client.connect();
  console.log('Connected to DB');

  const employees = JSON.parse(fs.readFileSync('/tmp/asgard_employees_enriched.json', 'utf8'));
  console.log('Loaded ' + employees.length + ' employees from JSON');

  const ptRes = await client.query('SELECT id, name FROM permit_types WHERE is_active = true');
  const permitTypeMap = {};
  ptRes.rows.forEach(r => { permitTypeMap[r.name] = r.id; });
  console.log('Permit types loaded: ' + Object.keys(permitTypeMap).length);

  const empRes = await client.query('SELECT id, fio FROM employees');
  const dbEmployees = empRes.rows;
  console.log('DB has ' + dbEmployees.length + ' employees');

  const existingRes = await client.query(
    'SELECT employee_id, permit_type, permit_number, issue_date::text, expiry_date::text FROM employee_permits'
  );
  console.log('DB has ' + existingRes.rows.length + ' existing permits');

  const existingSet = new Set();
  existingRes.rows.forEach(r => {
    const key1 = r.employee_id + '|' + r.permit_type + '|' + (r.permit_number || '');
    const key2 = r.employee_id + '|' + r.permit_type + '|' + (r.issue_date || '') + '|' + (r.expiry_date || '');
    existingSet.add(key1);
    existingSet.add(key2);
  });

  function normalizeFio(fio) {
    if (!fio) return '';
    return fio.trim().toLowerCase().replace(/ё/g, 'е');
  }

  function extractSurname(fio) {
    if (!fio) return '';
    return fio.trim().split(/\s+/)[0].toLowerCase().replace(/ё/g, 'е');
  }

  const empByFio = {};
  const empBySurname = {};
  dbEmployees.forEach(e => {
    const norm = normalizeFio(e.fio);
    empByFio[norm] = e;
    const surname = extractSurname(e.fio);
    if (!empBySurname[surname]) empBySurname[surname] = [];
    empBySurname[surname].push(e);
  });

  let inserted = 0;
  let skippedDup = 0;
  let skippedNoMatch = 0;
  let errors = 0;
  const unmatchedNames = [];

  for (const emp of employees) {
    if (!emp.certificates || emp.certificates.length === 0) continue;
    const name = emp.name;
    const normName = normalizeFio(name);
    let dbEmp = empByFio[normName];

    if (!dbEmp) {
      const parts = name.trim().split(/\s+/);
      const surname = parts[0].toLowerCase().replace(/ё/g, 'е');
      const candidates = empBySurname[surname] || [];
      if (candidates.length === 1) {
        dbEmp = candidates[0];
      } else if (candidates.length > 1 && parts.length >= 2) {
        const firstName = parts[1].toLowerCase().replace(/ё/g, 'е');
        dbEmp = candidates.find(c => {
          const cParts = c.fio.trim().split(/\s+/);
          if (cParts.length < 2) return false;
          const cFirst = cParts[1].toLowerCase().replace(/ё/g, 'е');
          return cFirst === firstName;
        });
        if (!dbEmp && parts.length >= 3) {
          const patronymic = parts[2].toLowerCase().replace(/ё/g, 'е');
          dbEmp = candidates.find(c => {
            const cParts = c.fio.trim().split(/\s+/);
            if (cParts.length < 3) return false;
            const cFirst = cParts[1].toLowerCase().replace(/ё/g, 'е');
            const cPatr = cParts[2].toLowerCase().replace(/ё/g, 'е');
            return cFirst === firstName && cPatr === patronymic;
          });
        }
      }
    }

    if (!dbEmp) {
      unmatchedNames.push(name);
      skippedNoMatch += emp.certificates.length;
      continue;
    }

    for (const cert of emp.certificates) {
      const permitType = cert.type;
      const typeId = permitTypeMap[permitType] || null;
      const permitNumber = cert.number || null;
      let issueDate = cert.issue_date || null;
      let expiryDate = cert.expiry_date || null;

      if (issueDate && expiryDate && issueDate === expiryDate) {
        issueDate = null;
      }

      const key1 = dbEmp.id + '|' + permitType + '|' + (permitNumber || '');
      const isoIssue = issueDate || '';
      const isoExpiry = expiryDate || '';
      const key2 = dbEmp.id + '|' + permitType + '|' + isoIssue + '|' + isoExpiry;
      const keyBare = dbEmp.id + '|' + permitType + '||';

      if (permitNumber && existingSet.has(key1)) { skippedDup++; continue; }
      if (existingSet.has(key2)) { skippedDup++; continue; }
      if (!permitNumber && !issueDate && !expiryDate && existingSet.has(keyBare)) { skippedDup++; continue; }

      try {
        const scanSource = cert.scan_source || null;
        await client.query(
          'INSERT INTO employee_permits ' +
          '(employee_id, type_id, permit_type, permit_number, issue_date, expiry_date, ' +
          'scan_original_name, status, is_active, created_at, updated_at) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())',
          [dbEmp.id, typeId, permitType, permitNumber, issueDate, expiryDate, scanSource, 'active', true]
        );
        inserted++;
        existingSet.add(key1);
        existingSet.add(key2);
        if (!permitNumber && !issueDate && !expiryDate) existingSet.add(keyBare);
      } catch (err) {
        errors++;
        if (errors <= 5) console.error('Error inserting for ' + name + ' (' + permitType + '): ' + err.message);
      }
    }
  }

  console.log('');
  console.log('=== IMPORT RESULTS ===');
  console.log('Inserted: ' + inserted + ' new permits');
  console.log('Skipped (duplicate): ' + skippedDup);
  console.log('Skipped (no employee match): ' + skippedNoMatch);
  console.log('Errors: ' + errors);
  if (unmatchedNames.length > 0) {
    console.log('');
    console.log('Unmatched employees (' + unmatchedNames.length + '):');
    unmatchedNames.forEach(n => console.log('  - ' + n));
  }
  const finalRes = await client.query('SELECT COUNT(*) as total FROM employee_permits');
  const finalDistinct = await client.query('SELECT COUNT(DISTINCT employee_id) as total FROM employee_permits');
  console.log('');
  console.log('Final DB state: ' + finalRes.rows[0].total + ' total permits, ' + finalDistinct.rows[0].total + ' unique employees');
  await client.end();
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
