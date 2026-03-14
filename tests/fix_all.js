/**
 * Comprehensive fix script:
 * 1. Import ~300 skipped general expenses (office, warehouse, etc.) with categories
 * 2. Fill contract_sum/cost_plan from project_data.json for works missing them
 * 3. Delete test works (XSS probes, "Value test", etc.)
 * 4. Create auto-sync trigger for employee_assignments
 *
 * Run on server: node fix_all.js [--dry-run]
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DRY_RUN = process.argv.includes('--dry-run');
const DB = { host: 'localhost', port: 5432, database: 'asgard_crm', user: 'asgard', password: '123456789' };

const scriptDir = __dirname;
const projectData = JSON.parse(fs.readFileSync(path.join(scriptDir, 'project_data.json'), 'utf8'));
const expenseData = JSON.parse(fs.readFileSync(path.join(scriptDir, 'expense_data.json'), 'utf8'));

function parseSum(val) {
  if (!val || val === 0 || val === '0') return 0;
  if (typeof val === 'number') return val;
  return parseFloat(String(val).replace(/[\s,]/g, '').replace(/\u00a0/g, '')) || 0;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1: Import skipped general expenses
// ═══════════════════════════════════════════════════════════════

// Objects that should NOT be linked to works — they are general/office expenses
const GENERAL_EXPENSE_OBJECTS = {
  'офис': 'Офис',
  'склад': 'Склад',
  'склад мурманск': 'Склад',
  'склад королёв': 'Склад',
  'склад королев': 'Склад',
  'сертификаты': 'Сертификаты',
  'удостоверения': 'Удостоверения',
  'мед осмотр': 'Медосмотр',
  'медосмотр': 'Медосмотр',
  'мед осмотры': 'Медосмотр',
  'обучение': 'Обучение',
  'обучение сотрудников': 'Обучение',
  'допуски': 'Допуски',
  'страховка': 'Страховка',
  'страхование': 'Страховка',
  'автомобиль': 'Транспорт',
  'автомобили': 'Транспорт',
  'авто': 'Транспорт',
  'транспорт': 'Транспорт',
  'логистика': 'Транспорт',
  'налоги': 'Налоги',
  'зарплата': 'ФОТ',
  'фот': 'ФОТ',
  'аренда': 'Аренда',
  'аренда офиса': 'Аренда',
  'связь': 'Связь',
  'интернет': 'Связь',
  'телефон': 'Связь',
  'ит': 'IT',
  'it': 'IT',
  'компьютеры': 'IT',
  'маркетинг': 'Маркетинг',
  'реклама': 'Маркетинг',
  'представительские': 'Представительские',
  'прочее': 'Прочее',
  'разное': 'Прочее',
  'общие работы': 'Прочее',
  'на тендер': 'Тендеры',
  'для отг': 'Прочее',
  'сро выписка': 'Сертификаты',
  'сро': 'Сертификаты',
  'эб комиссия': 'Сертификаты',
  'лицензия на утилизацию': 'Сертификаты',
  'кудряшов о. с.': 'Представительские',
  'кудряшов о.с.': 'Представительские',
  'свг': 'Прочее',
};

// Work-matching aliases (same as import_server.js)
const WORK_ALIASES = {
  'агпз': 'агхк',
  'амурский гхк': 'агхк',
  'амурский газохимический': 'агхк',
  'амурский гпз': 'агхк',
  'агхк-гкк': 'агхк',
  'выкса': 'выкса - турки',
  'гнш ремонт огн подогр.': 'приразломная',
  'гнш ремонт огн подогр': 'приразломная',
  'огневой подогреватель': 'приразломная',
  'гнш ремонт': 'приразломная',
  'приразломная, чистка даэратора': 'приразломная',
  'приразломная, чистка танков и каусорб': 'приразломная',
  'приразломная чистка танков': 'приразломная',
  'екатеринбург': 'екатеринбург',
  'мурманск': 'мурманск',
  'скруббер': 'приразломная',
  'обслуживание то': 'приразломная',
  'обезжир кислородоропровода ао умм-2': 'обезжиривание кислородопровода',
  'обезжир кислородопровода': 'обезжиривание кислородопровода',
  'кислородопровод': 'обезжиривание кислородопровода',
  'волжская перекись водорода': 'волжская перекись',
  'волжская пв': 'волжская перекись',
  'као азот': 'као азот - гидромеханическая очистка',
  'новатэк': 'новатэк-пуровский гпк',
  'пуровский': 'новатэк-пуровский гпк',
  'печорская грэс': 'печорская грэс',
  'астрахань': 'астрахань 2.0',
  'выкса-турки': 'выкса - турки',
  'гагаринконсервмолоко': 'гагаринконсервмолоко - 4 котла',
  'черномортранснефть': 'черномортранснефть',
  'титан аэс': 'титан аэс',
  'млсп': 'млсп',
  'фрегат': 'фрегат воскресенск',
  'калининград': 'ргт - калининград протравка',
  'лукойл-инжиниринг': 'лукойл-инжиниринг - теплоомбенники',
  'пуровский зпк': 'новатэк-пуровский гпк',
  'пуровский': 'новатэк-пуровский гпк',
  'пуровский зпк/скруббер': 'новатэк-пуровский гпк',
  'приразломная, чистка танков': 'приразломная',
  'приразломная вся': 'приразломная',
  'приразломная, чистка буровых емкостей': 'приразломная',
  'приразломная, каусторб': 'приразломная',
  'приразломная, скруббер, замена гликоля': 'приразломная',
  'приразломная, огневой подогреватель': 'приразломная',
  'очистка и ремонт то, приразломная': 'приразломная',
  'деаэратор+каусорб': 'приразломная',
  'замена гликоля, млсп': 'млсп',
  'торц уплотнения млсп': 'млсп',
  'млсп (деаэратор)': 'млсп',
  'млсп (буровики)': 'млсп',
  'млсп (помощь артёму)': 'млсп',
  'амурский гхк/млсп': 'млсп',
  'чтн': 'черномортранснефть',
  'кливер': 'кливер - акр',
  'калининград кливер': 'кливер - акр',
  'агпх': 'агхк',
  'закупки для гнш': 'приразломная',
  'химия для гнш': 'приразломная',
  'као "азот"': 'као азот - гидромеханическая очистка',
  'лебединский гок': 'гок - зиссер',
  'исток, фрязино': 'исток',
  's7 инжиниринг': 's7',
  'спбгмту, "мангуст"': 'мангуст',
  'спбгу мангуст': 'мангуст',
  'ооо медстрой - замена гликоля': 'медстрой',
  'ооо спецтехстрой - травление трубопровода': 'спецтехстрой',
};

function categorizeExpense(obj, contractor, description) {
  const text = [obj, contractor, description].join(' ').toLowerCase();

  if (text.match(/фот|зарплат|оклад|премия|аванс|больничн|отпускн/)) return 'ФОТ';
  if (text.match(/гсм|бензин|дизел|топлив|заправк/)) return 'ГСМ';
  if (text.match(/командировк|суточн|перелет|билет|жд |ржд|поезд/)) return 'Командировки';
  if (text.match(/проживан|гостиниц|отель|хостел|квартир/)) return 'Проживание';
  if (text.match(/питан|обед|столов|еда|продукт/)) return 'Питание';
  if (text.match(/инструмент|оборудован|насос|компрессор|генератор/)) return 'Инструмент';
  if (text.match(/материал|реагент|химия|кислот|щелоч|ингибитор|расход/)) return 'Материалы';
  if (text.match(/аренд|прокат/)) return 'Аренда';
  if (text.match(/связь|телефон|интернет|мобил|сим/)) return 'Связь';
  if (text.match(/транспорт|доставк|перевозк|логистик|такси|грузоперевоз/)) return 'Транспорт';
  if (text.match(/страхов/)) return 'Страхование';
  if (text.match(/обучен|курс|повышен|квалификац/)) return 'Обучение';
  if (text.match(/сертификат|допуск|удостоверен|лицензи/)) return 'Сертификаты';
  if (text.match(/медосмотр|мед\.? ?осмотр/)) return 'Медосмотр';

  return 'Прочее';
}

async function phase1_expenses(client) {
  console.log('\n═══ PHASE 1: Import skipped general expenses ═══');

  // Get list of already imported hashes
  const { rows: existingHashes } = await client.query(
    "SELECT import_hash FROM work_expenses WHERE import_hash IS NOT NULL"
  );
  const hashSet = new Set(existingHashes.map(r => r.import_hash));

  // Get works for matching
  const { rows: works } = await client.query(
    "SELECT w.id, w.work_title, t.tender_title FROM works w LEFT JOIN tenders t ON w.tender_id = t.id"
  );

  function findWorkId(objectName) {
    if (!objectName) return null;
    const objLower = objectName.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim();

    // Check if it's a general expense (no work_id)
    for (const [pattern, _] of Object.entries(GENERAL_EXPENSE_OBJECTS)) {
      if (objLower === pattern || objLower.startsWith(pattern)) return null;
    }

    // Try exact alias
    let aliased = WORK_ALIASES[objLower] || null;

    // Try partial alias match if no exact hit
    if (!aliased) {
      for (const [key, val] of Object.entries(WORK_ALIASES)) {
        if (objLower.includes(key) || key.includes(objLower)) {
          aliased = val;
          break;
        }
      }
    }

    // Special patterns
    if (!aliased) {
      if (objLower.includes('выкса')) aliased = 'выкса - турки';
      else if (objLower.includes('приразломн')) aliased = 'приразломная';
      else if (objLower.includes('млсп')) aliased = 'млсп';
      else if (objLower.includes('калининград')) aliased = 'ргт - калининград протравка';
      else if (objLower.includes('бараташвили') || objLower.includes('модернизация итп')) aliased = objLower;
      else aliased = objLower;
    }

    if (!aliased) aliased = objLower;

    // Try matching to works
    for (const w of works) {
      const title = (w.work_title || '').toLowerCase();
      const tTitle = (w.tender_title || '').toLowerCase();
      if (title === aliased || tTitle === aliased) return w.id;
      if (title.includes(aliased) || tTitle.includes(aliased)) return w.id;
      if (aliased.length > 3 && (title.includes(aliased) || tTitle.includes(aliased))) return w.id;
    }

    // Try word match
    const words = aliased.split(/\s+/).filter(w => w.length > 3);
    if (words.length > 0) {
      for (const w of works) {
        const combined = ((w.work_title || '') + ' ' + (w.tender_title || '')).toLowerCase();
        const matchCount = words.filter(word => combined.includes(word)).length;
        if (matchCount >= Math.ceil(words.length * 0.6)) return w.id;
      }
    }

    return null;
  }

  let imported = 0;
  let skippedDuplicate = 0;
  let withWork = 0;
  let withoutWork = 0;
  const categoryStats = {};

  for (const exp of expenseData) {
    // Must match the format used in import_server.js
    const hash = `expreg_${exp.rowIndex}_${exp.invoiceNum}_${exp.amount}`;

    if (hashSet.has(hash)) {
      skippedDuplicate++;
      continue;
    }

    const amount = parseSum(exp.amount);
    if (!amount || amount <= 0) continue;

    const objectName = (exp.object || '').trim();
    const workId = findWorkId(objectName);

    // Determine category
    let category;
    const objLower = objectName.toLowerCase();
    const generalCat = Object.entries(GENERAL_EXPENSE_OBJECTS).find(([k]) => objLower === k || objLower.startsWith(k));
    if (generalCat) {
      category = generalCat[1];
    } else {
      category = categorizeExpense(objectName, exp.contractor || '', exp.purpose1 || '');
    }

    categoryStats[category] = (categoryStats[category] || 0) + 1;

    // Parse date
    let expDate = null;
    if (exp.dateRaw) {
      const dateStr = String(exp.dateRaw).trim();
      // Try DD.MM.YYYY
      const m = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (m) {
        expDate = `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
      } else if (dateStr.match(/^\d{5}$/)) {
        // Excel serial date
        const d = new Date((parseInt(dateStr) - 25569) * 86400000);
        expDate = d.toISOString().split('T')[0];
      }
    }

    if (!DRY_RUN) {
      await client.query(`
        INSERT INTO work_expenses (work_id, category, amount, date, description, document_number, counterparty, source, status, notes, import_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'import_excel', $8, $9, $10)
      `, [
        workId,
        category,
        amount,
        expDate,
        objectName || 'Общий расход',
        (exp.invoiceNum || '').substring(0, 255),
        (exp.contractor || '').substring(0, 500),
        (exp.status || '').substring(0, 255),
        [exp.purpose1, exp.purpose2, exp.purpose3, exp.comment].filter(Boolean).join('; ').substring(0, 500),
        hash
      ]);
    }

    hashSet.add(hash);
    imported++;
    if (workId) withWork++; else withoutWork++;
  }

  console.log(`  Imported: ${imported} expenses`);
  console.log(`  Skipped (duplicate): ${skippedDuplicate}`);
  console.log(`  With work_id: ${withWork}, Without (general): ${withoutWork}`);
  console.log(`  By category:`, categoryStats);

  // Update cost_fact for works with new expenses
  if (!DRY_RUN) {
    await client.query(`
      UPDATE works w SET cost_fact = sub.total
      FROM (SELECT work_id, SUM(amount) as total FROM work_expenses WHERE work_id IS NOT NULL GROUP BY work_id) sub
      WHERE w.id = sub.work_id
    `);
    console.log('  Updated cost_fact for all works');
  }
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2: Fill contract sums from project_data.json
// ═══════════════════════════════════════════════════════════════

async function phase2_sums(client) {
  console.log('\n═══ PHASE 2: Fill contract sums and cost_plan from Excel ═══');

  const { rows: works } = await client.query(
    "SELECT w.id, w.work_title, w.contract_sum, w.cost_plan, t.tender_title FROM works w LEFT JOIN tenders t ON w.tender_id = t.id"
  );

  let updatedContract = 0;
  let updatedTkp = 0;
  let updatedCost = 0;

  for (const proj of projectData) {
    const contractSum = parseSum(proj.contractSum);
    const tkpSum = parseSum(proj.tkpSum);

    if (!contractSum && !tkpSum) continue;

    // Find matching work
    const titleLower = (proj.title || '').toLowerCase().trim();
    const work = works.find(w => {
      const wt = (w.work_title || '').toLowerCase().trim();
      const tt = (w.tender_title || '').toLowerCase().trim();
      return wt === titleLower || tt === titleLower ||
             (titleLower.length > 5 && (wt.includes(titleLower) || tt.includes(titleLower)));
    });

    if (!work) continue;

    const updates = [];
    const values = [];
    let idx = 1;

    // Fill contract_sum if missing and we have it from Excel
    if ((!work.contract_sum || parseFloat(work.contract_sum) === 0) && contractSum > 0) {
      updates.push(`contract_sum = $${idx}`);
      values.push(contractSum);
      idx++;
      updatedContract++;
    }

    // If no contract_sum but we have TKP sum, use it
    if ((!work.contract_sum || parseFloat(work.contract_sum) === 0) && !contractSum && tkpSum > 0) {
      updates.push(`contract_sum = $${idx}`);
      values.push(tkpSum);
      idx++;
      updatedTkp++;
    }

    // Fill cost_plan = contract_sum / 2 if not set
    const effectiveSum = contractSum || tkpSum || parseFloat(work.contract_sum) || 0;
    if ((!work.cost_plan || parseFloat(work.cost_plan) === 0) && effectiveSum > 0) {
      updates.push(`cost_plan = $${idx}`);
      values.push(Math.round(effectiveSum / 2 * 100) / 100);
      idx++;
      updatedCost++;
    }

    if (updates.length > 0 && !DRY_RUN) {
      values.push(work.id);
      await client.query(
        `UPDATE works SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
        values
      );
    }
  }

  console.log(`  Updated contract_sum from contractSum: ${updatedContract}`);
  console.log(`  Updated contract_sum from tkpSum: ${updatedTkp}`);
  console.log(`  Updated cost_plan: ${updatedCost}`);
}

// ═══════════════════════════════════════════════════════════════
// PHASE 3: Clean up test works, update statuses
// ═══════════════════════════════════════════════════════════════

async function phase3_cleanup(client) {
  console.log('\n═══ PHASE 3: Clean up test works and statuses ═══');

  // Delete test/XSS probe works
  if (!DRY_RUN) {
    const { rowCount } = await client.query(`
      DELETE FROM works WHERE work_status = 'Новая' AND tender_id IS NULL
      AND (work_title LIKE '%test%' OR work_title LIKE '%<script%' OR work_title LIKE '%<marquee%'
           OR work_title LIKE '%SELECT%' OR work_title LIKE '%XSS%' OR work_title LIKE '%HEAD_TO%'
           OR work_title LIKE 'Value %')
    `);
    console.log(`  Deleted ${rowCount} test/probe works`);
  }

  // All project works should be "Закрыт" (status "Выполнен" from Excel)
  // Already done in previous run, but ensure consistency
  if (!DRY_RUN) {
    const { rowCount } = await client.query(`
      UPDATE works SET work_status = 'Закрыт'
      WHERE work_status = 'Новая'
      AND tender_id IN (SELECT id FROM tenders WHERE source = 'Проект')
    `);
    console.log(`  Updated ${rowCount} remaining "Новая" project works to "Закрыт"`);
  }

  // Show final status distribution
  const { rows } = await client.query(
    "SELECT work_status, COUNT(*) as cnt FROM works GROUP BY work_status ORDER BY cnt DESC"
  );
  console.log('  Final status distribution:');
  for (const r of rows) {
    console.log(`    ${r.work_status}: ${r.cnt}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// PHASE 4: Create auto-sync trigger for employee_assignments
// ═══════════════════════════════════════════════════════════════

async function phase4_trigger(client) {
  console.log('\n═══ PHASE 4: Auto-sync trigger for employee_assignments ═══');

  if (!DRY_RUN) {
    // Create the trigger function
    await client.query(`
      CREATE OR REPLACE FUNCTION sync_employee_assignments()
      RETURNS TRIGGER AS $$
      DECLARE
        emp_id INTEGER;
        emp_ids INTEGER[];
        existing_ids INTEGER[];
      BEGIN
        -- Only trigger if staff_ids_json actually changed
        IF OLD.staff_ids_json IS DISTINCT FROM NEW.staff_ids_json THEN

          -- Parse new staff_ids_json into array
          IF NEW.staff_ids_json IS NOT NULL AND NEW.staff_ids_json::text != 'null' AND NEW.staff_ids_json::text != '[]' THEN
            SELECT ARRAY(
              SELECT (value::text)::integer
              FROM jsonb_array_elements_text(NEW.staff_ids_json)
              WHERE value::text ~ '^[0-9]+$'
            ) INTO emp_ids;
          ELSE
            emp_ids := ARRAY[]::INTEGER[];
          END IF;

          -- Get existing assignment employee_ids for this work
          SELECT ARRAY(
            SELECT employee_id FROM employee_assignments WHERE work_id = NEW.id
          ) INTO existing_ids;

          -- Remove assignments for employees no longer in staff_ids_json
          DELETE FROM employee_assignments
          WHERE work_id = NEW.id
          AND employee_id != ALL(emp_ids);

          -- Add assignments for new employees
          IF array_length(emp_ids, 1) > 0 THEN
            FOREACH emp_id IN ARRAY emp_ids LOOP
              -- Only insert if not already exists and employee exists
              INSERT INTO employee_assignments (employee_id, work_id, role, date_from, created_at, updated_at)
              SELECT emp_id, NEW.id, 'Сотрудник',
                     COALESCE(NEW.start_plan, NEW.created_at::date),
                     NOW(), NOW()
              WHERE EXISTS (SELECT 1 FROM employees WHERE id = emp_id)
              AND NOT EXISTS (SELECT 1 FROM employee_assignments WHERE employee_id = emp_id AND work_id = NEW.id);
            END LOOP;
          END IF;

          -- Update date_to for closed works
          IF NEW.work_status IN ('Закрыт', 'Работы сдали') THEN
            UPDATE employee_assignments
            SET date_to = COALESCE(NEW.end_plan, NEW.end_fact, NEW.updated_at::date),
                updated_at = NOW()
            WHERE work_id = NEW.id AND date_to IS NULL;
          END IF;

        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('  Created function sync_employee_assignments()');

    // Drop existing trigger if any
    await client.query(`
      DROP TRIGGER IF EXISTS trg_sync_employee_assignments ON works;
    `);

    // Create the trigger
    await client.query(`
      CREATE TRIGGER trg_sync_employee_assignments
      AFTER UPDATE ON works
      FOR EACH ROW
      EXECUTE FUNCTION sync_employee_assignments();
    `);
    console.log('  Created trigger trg_sync_employee_assignments on works table');

    // Also create trigger for INSERT
    await client.query(`
      DROP TRIGGER IF EXISTS trg_sync_employee_assignments_insert ON works;
    `);
    await client.query(`
      CREATE TRIGGER trg_sync_employee_assignments_insert
      AFTER INSERT ON works
      FOR EACH ROW
      WHEN (NEW.staff_ids_json IS NOT NULL)
      EXECUTE FUNCTION sync_employee_assignments();
    `);
    console.log('  Created trigger trg_sync_employee_assignments_insert on works table');

    // Fix: INSERT trigger needs OLD reference handled differently
    // Re-create function to handle INSERT (no OLD)
    await client.query(`
      CREATE OR REPLACE FUNCTION sync_employee_assignments()
      RETURNS TRIGGER AS $$
      DECLARE
        emp_id INTEGER;
        emp_ids INTEGER[];
      BEGIN
        -- For UPDATE: only trigger if staff_ids_json actually changed
        IF TG_OP = 'UPDATE' AND OLD.staff_ids_json IS NOT DISTINCT FROM NEW.staff_ids_json THEN
          -- Check if status changed (for date_to updates)
          IF OLD.work_status IS DISTINCT FROM NEW.work_status
             AND NEW.work_status IN ('Закрыт', 'Работы сдали') THEN
            UPDATE employee_assignments
            SET date_to = COALESCE(NEW.end_plan, NEW.end_fact, NEW.updated_at::date),
                updated_at = NOW()
            WHERE work_id = NEW.id AND date_to IS NULL;
          END IF;
          RETURN NEW;
        END IF;

        -- Parse new staff_ids_json into array
        IF NEW.staff_ids_json IS NOT NULL AND NEW.staff_ids_json::text != 'null' AND NEW.staff_ids_json::text != '[]' THEN
          SELECT ARRAY(
            SELECT (value::text)::integer
            FROM jsonb_array_elements_text(NEW.staff_ids_json)
            WHERE value::text ~ '^[0-9]+$'
          ) INTO emp_ids;
        ELSE
          emp_ids := ARRAY[]::INTEGER[];
        END IF;

        -- For UPDATE: remove assignments for employees no longer listed
        IF TG_OP = 'UPDATE' THEN
          DELETE FROM employee_assignments
          WHERE work_id = NEW.id
          AND employee_id != ALL(COALESCE(emp_ids, ARRAY[]::INTEGER[]));
        END IF;

        -- Add assignments for new employees
        IF emp_ids IS NOT NULL AND array_length(emp_ids, 1) > 0 THEN
          FOREACH emp_id IN ARRAY emp_ids LOOP
            INSERT INTO employee_assignments (employee_id, work_id, role, date_from, created_at, updated_at)
            SELECT emp_id, NEW.id, 'Сотрудник',
                   COALESCE(NEW.start_plan, NEW.created_at::date),
                   NOW(), NOW()
            WHERE EXISTS (SELECT 1 FROM employees WHERE id = emp_id)
            AND NOT EXISTS (SELECT 1 FROM employee_assignments WHERE employee_id = emp_id AND work_id = NEW.id);
          END LOOP;
        END IF;

        -- Update date_to for closed works
        IF NEW.work_status IN ('Закрыт', 'Работы сдали') THEN
          UPDATE employee_assignments
          SET date_to = COALESCE(NEW.end_plan, NEW.end_fact, NEW.updated_at::date),
              updated_at = NOW()
          WHERE work_id = NEW.id AND date_to IS NULL;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('  Updated function to handle both INSERT and UPDATE');
  }

  // Verify trigger works
  console.log('  Trigger created. When staff_ids_json is updated on a work:');
  console.log('    - New employees are auto-added to employee_assignments');
  console.log('    - Removed employees are auto-deleted from employee_assignments');
  console.log('    - Closed works auto-set date_to on assignments');
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function run() {
  const client = new Client(DB);
  await client.connect();

  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  try {
    await phase1_expenses(client);
    await phase2_sums(client);
    await phase3_cleanup(client);
    await phase4_trigger(client);

    // Final stats
    console.log('\n═══ FINAL STATS ═══');
    const { rows: expStats } = await client.query(
      "SELECT COUNT(*) as total, COUNT(work_id) as with_work, SUM(amount) as total_amount FROM work_expenses"
    );
    console.log(`  Total expenses: ${expStats[0].total}, with work: ${expStats[0].with_work}, total: ${(parseFloat(expStats[0].total_amount)/1000000).toFixed(2)}M rub`);

    const { rows: workStats } = await client.query(`
      SELECT COUNT(*) as total,
             COUNT(NULLIF(contract_sum, 0)) as with_sum,
             COUNT(NULLIF(cost_plan, 0)) as with_cost_plan,
             COUNT(NULLIF(cost_fact, 0)) as with_cost_fact,
             COUNT(start_plan) as with_dates
      FROM works
    `);
    console.log(`  Works: ${workStats[0].total}, with contract_sum: ${workStats[0].with_sum}, cost_plan: ${workStats[0].with_cost_plan}, cost_fact: ${workStats[0].with_cost_fact}, with dates: ${workStats[0].with_dates}`);

    const { rows: eaStats } = await client.query("SELECT COUNT(*) FROM employee_assignments");
    console.log(`  Employee assignments: ${eaStats[0].count}`);

  } finally {
    await client.end();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
