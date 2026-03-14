/**
 * ASGARD CRM — Import employees and permits from JSON
 *
 * 1. Clear test employees (CASCADE cleans permits, reviews, etc.)
 * 2. Ensure permit_types exist for all certificate types
 * 3. Insert 222 employees
 * 4. Insert 583 certificates as employee_permits
 */
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  user: 'asgard',
  password: '123456789',
  database: 'asgard_crm',
  host: 'localhost'
});

const employees = JSON.parse(fs.readFileSync('/tmp/asgard_employees_final.json', 'utf8'));
console.log('Employees to import:', employees.length);
console.log('Total certificates:', employees.reduce((sum, e) => sum + e.certificates.length, 0));

async function run() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Step 1: Clear test data
    console.log('\n--- Step 1: Clearing test data ---');
    const before = await client.query('SELECT count(*) FROM employees');
    console.log('  Employees before:', before.rows[0].count);

    // Delete from dependent tables first to avoid FK issues
    await client.query('DELETE FROM employee_permits');
    await client.query('DELETE FROM employee_reviews');
    await client.query('DELETE FROM employee_plan');
    await client.query('DELETE FROM employee_rates');
    await client.query('DELETE FROM self_employed');
    await client.query('DELETE FROM travel_expenses');
    await client.query('DELETE FROM payroll_items');
    await client.query('DELETE FROM payment_registry');
    await client.query('DELETE FROM one_time_payments');
    await client.query('DELETE FROM employees');
    console.log('  Cleared all employee-related data');

    // Step 2: Ensure permit_types exist
    console.log('\n--- Step 2: Setting up permit types ---');
    await client.query('DELETE FROM permit_types');

    const permitTypes = [
      { name: 'БОСИЕТ', category: 'offshore', months: 48, code: 'BOSIET' },
      { name: 'РУКАВ', category: 'offshore', months: 48, code: 'SLEEVE' },
      { name: 'Медицинский осмотр', category: 'medical', months: 12, code: 'MEDCHECK' },
      { name: 'Охрана труда (ОТ)', category: 'safety', months: 12, code: 'OT' },
      { name: 'Пожарная безопасность (ПТМ)', category: 'safety', months: 12, code: 'PTM' },
      { name: 'Электробезопасность (ЭБ)', category: 'electric', months: 12, code: 'EB' },
      { name: 'Первая медицинская помощь (ПМП)', category: 'medical', months: 36, code: 'PMP' },
      { name: 'Средства защиты (СИЗ)', category: 'safety', months: 12, code: 'SIZ' },
      { name: 'БМПО', category: 'safety', months: 12, code: 'BMPO' },
      { name: 'ОТЗП (замкнутые пространства)', category: 'special', months: 60, code: 'OTZP' },
      { name: 'Драгеры', category: 'special', months: 60, code: 'DRAGER' },
      { name: 'Работы на высоте', category: 'special', months: 0, code: 'HEIGHT' },
      { name: 'Промышленная безопасность', category: 'safety', months: 60, code: 'PROMBEZ' },
      { name: 'НАКС', category: 'special', months: 0, code: 'NAKS' },
      { name: 'Квалификация', category: 'attest', months: 60, code: 'QUAL' },
      { name: 'Пропуск ФСБ', category: 'special', months: 0, code: 'FSB' },
      { name: 'SCORE', category: 'medical', months: 0, code: 'SCORE' },
    ];

    const typeIdMap = {};
    for (const pt of permitTypes) {
      const r = await client.query(
        `INSERT INTO permit_types (name, category, validity_months, code, is_active, is_system, sort_order)
         VALUES ($1, $2, $3, $4, true, true, $5) RETURNING id`,
        [pt.name, pt.category, pt.months || null, pt.code, permitTypes.indexOf(pt) + 1]
      );
      typeIdMap[pt.name] = r.rows[0].id;
    }
    console.log('  Created', Object.keys(typeIdMap).length, 'permit types');

    // Step 3: Insert employees
    console.log('\n--- Step 3: Inserting employees ---');
    let empCount = 0, certCount = 0;

    for (const emp of employees) {
      // Determine contract_type from employment_type
      let contractType = null;
      if (emp.employment_type) {
        if (/СЗ/i.test(emp.employment_type)) contractType = 'СЗ';
        else if (/ТК/i.test(emp.employment_type)) contractType = 'ТК';
        else contractType = emp.employment_type;
      }

      // Insert employee
      const empResult = await client.query(
        `INSERT INTO employees (
          fio, phone, position, inn, snils, birth_date, address,
          passport_series, passport_number,
          pass_series, pass_number,
          contract_type, department, is_active,
          naks, fsb_pass, score_index,
          registration_address, birth_place,
          passport_date, passport_issued, passport_code,
          naks_number, naks_stamp, naks_date, naks_expiry,
          qualification_name, qualification_grade,
          brigade, notes
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9,
          $8, $9,
          $10, $11, true,
          $12, $13, $14,
          $15, $16,
          $17, $18, $19,
          $20, $21, $22, $23,
          $24, $25,
          $26, $27
        ) RETURNING id`,
        [
          emp.name,                    // fio
          emp.phone,                   // phone
          emp.position,                // position
          emp.inn,                     // inn
          emp.snils,                   // snils
          emp.birth_date,              // birth_date
          emp.address,                 // address
          emp.passport_series,         // passport_series
          emp.passport_number,         // passport_number
          contractType,                // contract_type
          emp.brigade || null,         // department
          emp.naks,                    // naks
          emp.fsb_pass,                // fsb_pass
          emp.score_index,             // score_index
          emp.registration_address,    // registration_address
          emp.birth_place,             // birth_place
          emp.passport_date,           // passport_date
          emp.passport_issued,         // passport_issued
          emp.passport_code,           // passport_code
          emp.naks_number,             // naks_number
          emp.naks_stamp,              // naks_stamp
          emp.naks_date,               // naks_date
          emp.naks_expiry,             // naks_expiry
          emp.qualification_name,      // qualification_name
          emp.qualification_grade,     // qualification_grade
          emp.brigade,                 // brigade
          emp.notes,                   // notes
        ]
      );

      const empId = empResult.rows[0].id;
      empCount++;

      // Step 4: Insert certificates
      for (const cert of emp.certificates) {
        const typeId = typeIdMap[cert.type];
        if (!typeId) {
          console.log('  Unknown cert type:', cert.type, 'for', emp.name);
          continue;
        }

        // Determine status
        let status = 'active';
        if (cert.expiry_date) {
          const expiry = new Date(cert.expiry_date);
          const now = new Date();
          if (expiry < now) status = 'expired';
        } else if (!cert.issue_date && !cert.number) {
          status = 'unknown';
        }

        await client.query(
          `INSERT INTO employee_permits (
            employee_id, type_id, permit_type, permit_number,
            issue_date, expiry_date, status, is_active, category
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            empId,
            typeId,
            cert.type,
            cert.number,
            cert.issue_date,
            cert.expiry_date,
            status,
            status === 'active',
            null,
          ]
        );
        certCount++;
      }

      if (empCount % 50 === 0) {
        console.log('  Inserted', empCount, 'employees,', certCount, 'certificates...');
      }
    }

    await client.query('COMMIT');

    console.log('\n========== РЕЗУЛЬТАТ ==========');
    console.log('Сотрудников создано:', empCount);
    console.log('Удостоверений создано:', certCount);

    // Verify
    const empCheck = await client.query('SELECT count(*) FROM employees');
    const certCheck = await client.query('SELECT count(*) FROM employee_permits');
    const typeCheck = await client.query('SELECT count(*) FROM permit_types');
    console.log('\nВ базе:');
    console.log('  employees:', empCheck.rows[0].count);
    console.log('  employee_permits:', certCheck.rows[0].count);
    console.log('  permit_types:', typeCheck.rows[0].count);

    // Cert stats
    const certStats = await client.query(
      `SELECT status, count(*) FROM employee_permits GROUP BY status ORDER BY status`
    );
    console.log('\nУдостоверения по статусу:');
    certStats.rows.forEach(r => console.log('  ' + r.status + ':', r.count));

  } catch(e) {
    await client.query('ROLLBACK');
    console.error('ERROR:', e.message);
    console.error(e.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
