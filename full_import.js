/**
 * Full certificate import from 10,198 scanned files
 * Matches filenames to employees in DB, extracts cert type + dates, imports new ones
 */
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  host: 'localhost', port: 5432,
  database: 'asgard_crm', user: 'asgard', password: '123456789'
});

// Certificate type detection patterns
const CERT_TYPES = [
  { type: 'БОСИЕТ',           patterns: [/босиет|bosiet|бусиет|бусиэт/i] },
  { type: 'РУКАВ',            patterns: [/рукав/i] },
  { type: 'Медицинский осмотр', patterns: [/мед[\.\s]*осмотр|МО\b|УМО|углубл.*МО|мед\.? от/i] },
  { type: 'Охрана труда (ОТ)', patterns: [/охран.*труд|\bОТ\b.*(?:А|Б|В|от|протокол)|протокол.*\(ОТ\)|ОТ\s*[АБВ]/i] },
  { type: 'Пожарная безопасность (ПТМ)', patterns: [/пожар|ПТМ|ПВП/i] },
  { type: 'Электробезопасность (ЭБ)', patterns: [/электробез|\bЭБ\b|электр.*безоп|группа.*ЭБ/i] },
  { type: 'Первая помощь (ПМП)', patterns: [/перв.*помощ|ПМП|ОПП|\(ОПП\)/i] },
  { type: 'СИЗ',              patterns: [/\bСИЗ\b|\(СИЗ\)/i] },
  { type: 'БМПО',             patterns: [/БМПО|БМВО|\(БМПО\)|\(БМВО\)/i] },
  { type: 'ОТЗП',             patterns: [/ОТЗП|замкн.*простр|ОЗП/i] },
  { type: 'Драгеры',          patterns: [/драгер|dräger/i] },
  { type: 'Работы на высоте',  patterns: [/высот|height/i] },
  { type: 'Промышленная безопасность', patterns: [/промбез|промышл.*безоп|Б[12]\.\d|А1/i] },
  { type: 'НАКС',             patterns: [/НАКС|сварщик|сварк|газосварк|электрогазосварк|РАД|РД/i] },
  { type: 'Квалификация',     patterns: [/квалиф|слесарь|монтажник|стропальщик|машинист|оператор|такелажник|рабоч.*профес|чистильщик|каналопром|люльк|подъемник/i] },
  { type: 'Пропуск ФСБ',     patterns: [/ФСБ|фсб|пропуск/i] },
  { type: 'SCORE',            patterns: [/SCORE|score/i] },
  { type: 'РМРС',             patterns: [/РМРС|морск.*регистр|OPITO/i] },
  { type: 'ВИК',              patterns: [/\bВИК\b|неразруш.*контроль|визуальн.*контроль/i] },
  { type: 'Тепловые энергоустановки', patterns: [/теплов.*энерг/i] },
  { type: 'Стройконтроль',    patterns: [/стройконтроль/i] },
  { type: 'ДСР',              patterns: [/\bДСР\b/i] },
];

function detectCertType(filename, folderPath) {
  const combined = folderPath + ' ' + filename;
  for (const ct of CERT_TYPES) {
    for (const p of ct.patterns) {
      if (p.test(combined)) return ct.type;
    }
  }
  // Fallback: try to detect from folder name
  if (/Мед.*осмотр|ДЕЛОМЕДИКА|РЖД.*Медицин/i.test(folderPath)) return 'Медицинский осмотр';
  if (/Колион/i.test(folderPath)) return 'Квалификация';
  if (/Химик.*механик/i.test(folderPath)) return 'Квалификация';
  if (/комиссии.*АС/i.test(folderPath)) return 'Квалификация';
  return null;
}

// Date extraction: find dates like dd.mm.yy, dd.mm.yyyy, dd.mm.20yy
function extractDates(filename) {
  const dates = [];
  // Pattern: dd.mm.yyyy or dd.mm.yy
  const re = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/g;
  let m;
  while ((m = re.exec(filename)) !== null) {
    let day = parseInt(m[1]), month = parseInt(m[2]), year = parseInt(m[3]);
    if (year < 100) year += 2000;
    if (month > 12 && day <= 12) { [day, month] = [month, day]; } // swap if month>12
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2018 && year <= 2035) {
      const d = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      dates.push(d);
    }
  }
  return dates;
}

// Extract document number from filename
function extractDocNumber(filename) {
  // Match patterns like №123, №12-34, №24К8-84
  const m = filename.match(/№\s*([^\s,]+)/);
  return m ? m[1] : null;
}

// Normalize surname for matching
function normSurname(fio) {
  if (!fio) return '';
  return fio.trim().split(/\s+/)[0].toLowerCase().replace(/ё/g, 'е');
}

// Extract initials from FIO
function getInitials(fio) {
  if (!fio) return '';
  const parts = fio.trim().split(/\s+/);
  if (parts.length >= 3) return parts[1][0] + '.' + parts[2][0] + '.';
  if (parts.length >= 2) return parts[1][0] + '.';
  return '';
}

async function main() {
  // Load employees from DB
  const { rows: employees } = await pool.query('SELECT id, fio FROM employees WHERE is_active = true');
  console.log('Employees in DB:', employees.length);

  // Build lookup: surname -> [{id, fio, initials}]
  const byName = {};
  for (const e of employees) {
    const surname = normSurname(e.fio);
    if (!byName[surname]) byName[surname] = [];
    byName[surname].push({ id: e.id, fio: e.fio, initials: getInitials(e.fio) });
  }

  // Load existing permits for dedup
  const { rows: existing } = await pool.query(
    'SELECT employee_id, permit_type, doc_number, issue_date, expiry_date FROM employee_permits'
  );
  const existingSet = new Set();
  for (const p of existing) {
    // Key: employee_id|type|number
    if (p.doc_number) existingSet.add(`${p.employee_id}|${p.permit_type}|${p.doc_number}`);
    // Key: employee_id|type|expiry
    if (p.expiry_date) {
      const exp = typeof p.expiry_date === 'object' ? p.expiry_date.toISOString().slice(0,10) : String(p.expiry_date).slice(0,10);
      existingSet.add(`${p.employee_id}|${p.permit_type}|${exp}`);
    }
    // Key: employee_id|type|issue
    if (p.issue_date) {
      const iss = typeof p.issue_date === 'object' ? p.issue_date.toISOString().slice(0,10) : String(p.issue_date).slice(0,10);
      existingSet.add(`${p.employee_id}|${p.permit_type}|${iss}`);
    }
  }
  console.log('Existing permits:', existing.length, 'dedup keys:', existingSet.size);

  // Parse the full scan file
  const lines = fs.readFileSync('/tmp/certificates_full_scan.txt', 'utf8').split('\n');

  let totalFiles = 0, matched = 0, unmatched = 0, inserted = 0, skippedDup = 0, skippedNoType = 0;
  const unmatchedNames = {};
  const insertBatch = [];

  for (const line of lines) {
    if (!line.includes(' | ')) continue;
    const sepIdx = line.lastIndexOf(' | ');
    const folder = line.slice(0, sepIdx).trim();
    const filename = line.slice(sepIdx + 3).trim();

    // Skip non-certificate files
    if (/^(Thumbs\.db|desktop\.ini|~\$)/.test(filename)) continue;
    if (/\.(xlsx?|docx?|msg|zip|rar)$/i.test(filename)) continue;
    // Skip folder entries (no extension)
    if (!filename.includes('.') && !/\.(pdf|jpg|jpeg|png|tif|tiff|gif|bmp)$/i.test(filename)) continue;

    totalFiles++;

    // Try to find employee name in filename or folder
    let empMatch = null;

    // Strategy 1: Extract surname from FIO folder
    const fioMatch = folder.match(/по ФИО\/([\wА-яёЁ]+)\s/);
    if (fioMatch) {
      const surname = fioMatch[1].toLowerCase().replace(/ё/g, 'е');
      if (byName[surname]) {
        // Try to match initials
        const initialsMatch = folder.match(/по ФИО\/[\wА-яёЁ]+\s+([А-ЯA-Z])\.\s*([А-ЯA-Z])\./);
        if (initialsMatch && byName[surname].length > 1) {
          const init = initialsMatch[1] + '.' + initialsMatch[2] + '.';
          empMatch = byName[surname].find(e => e.initials === init) || byName[surname][0];
        } else {
          empMatch = byName[surname][0];
        }
      }
    }

    // Strategy 2: Search filename for known surnames
    if (!empMatch) {
      for (const [surname, emps] of Object.entries(byName)) {
        if (surname.length < 3) continue;
        // Check if surname appears in filename (case-insensitive)
        const surnameCapital = surname.charAt(0).toUpperCase() + surname.slice(1);
        if (filename.includes(surnameCapital) || folder.includes(surnameCapital)) {
          if (emps.length === 1) {
            empMatch = emps[0];
          } else {
            // Multiple employees with same surname - try initials
            const initMatch = (filename + ' ' + folder).match(new RegExp(surnameCapital + '\\s+([А-ЯA-Z])\\.\\s*([А-ЯA-Z])\\.'));
            if (initMatch) {
              const init = initMatch[1] + '.' + initMatch[2] + '.';
              empMatch = emps.find(e => e.initials === init) || emps[0];
            } else {
              empMatch = emps[0];
            }
          }
          break;
        }
      }
    }

    if (!empMatch) {
      unmatched++;
      // Track unmatched names for reporting
      const nameFromFile = filename.match(/^(?:\d+\.?\s*)?([А-ЯЁ][а-яёА-ЯЁ]+)/);
      const key = nameFromFile ? nameFromFile[1] : folder.split('/').pop();
      unmatchedNames[key] = (unmatchedNames[key] || 0) + 1;
      continue;
    }
    matched++;

    // Detect certificate type
    const certType = detectCertType(filename, folder);
    if (!certType) {
      skippedNoType++;
      continue;
    }

    // Extract dates and doc number
    const dates = extractDates(filename);
    const docNumber = extractDocNumber(filename);

    let issueDate = null, expiryDate = null;
    if (dates.length === 1) {
      // Single date - could be issue or expiry depending on context
      if (/до\s|до$/i.test(filename.slice(0, filename.indexOf(dates[0].replace(/(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1'))))) {
        expiryDate = dates[0];
      } else if (/от\s/i.test(filename)) {
        issueDate = dates[0];
      } else {
        expiryDate = dates[0]; // Default: treat as expiry
      }
    } else if (dates.length >= 2) {
      // Multiple dates: earliest is issue, latest is expiry
      dates.sort();
      issueDate = dates[0];
      expiryDate = dates[dates.length - 1];
      // If both dates are the same, it's just one date
      if (issueDate === expiryDate) {
        if (/до/i.test(filename)) { issueDate = null; }
        else { expiryDate = null; }
      }
    }

    // Check for duplicates
    const isDup = (
      (docNumber && existingSet.has(`${empMatch.id}|${certType}|${docNumber}`)) ||
      (expiryDate && existingSet.has(`${empMatch.id}|${certType}|${expiryDate}`)) ||
      (issueDate && existingSet.has(`${empMatch.id}|${certType}|${issueDate}`))
    );

    if (isDup) {
      skippedDup++;
      continue;
    }

    // Add dedup keys
    if (docNumber) existingSet.add(`${empMatch.id}|${certType}|${docNumber}`);
    if (expiryDate) existingSet.add(`${empMatch.id}|${certType}|${expiryDate}`);
    if (issueDate) existingSet.add(`${empMatch.id}|${certType}|${issueDate}`);

    insertBatch.push({
      employee_id: empMatch.id,
      permit_type: certType,
      doc_number: docNumber,
      issue_date: issueDate,
      expiry_date: expiryDate,
      scan_file: filename,
      scan_original_name: folder + ' | ' + filename
    });
  }

  // Batch insert
  console.log(`\nInserting ${insertBatch.length} new permits...`);
  let insertOk = 0, insertErr = 0;

  for (const p of insertBatch) {
    try {
      await pool.query(
        `INSERT INTO employee_permits (employee_id, permit_type, doc_number, issue_date, expiry_date, scan_file, scan_original_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [p.employee_id, p.permit_type, p.doc_number, p.issue_date, p.expiry_date, p.scan_file, p.scan_original_name]
      );
      insertOk++;
    } catch(e) {
      insertErr++;
      if (insertErr <= 5) console.error('Insert error:', e.message, 'for:', p.employee_id, p.permit_type);
    }
  }

  // Final stats
  const { rows: [finalCount] } = await pool.query('SELECT COUNT(*) as total, COUNT(DISTINCT employee_id) as emps FROM employee_permits');

  console.log('\n========== FULL IMPORT RESULTS ==========');
  console.log(`Total files processed: ${totalFiles}`);
  console.log(`Matched to employees: ${matched}`);
  console.log(`Unmatched: ${unmatched}`);
  console.log(`Skipped (no cert type): ${skippedNoType}`);
  console.log(`Skipped (duplicate): ${skippedDup}`);
  console.log(`Inserted: ${insertOk}`);
  console.log(`Insert errors: ${insertErr}`);
  console.log(`\nDB totals: ${finalCount.total} permits, ${finalCount.emps} employees with permits`);

  // Top unmatched names
  const topUnmatched = Object.entries(unmatchedNames)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);
  console.log('\nTop unmatched names/folders:');
  for (const [name, count] of topUnmatched) {
    console.log(`  ${name}: ${count} files`);
  }

  // Cert type breakdown
  const { rows: breakdown } = await pool.query(
    'SELECT permit_type, COUNT(*) as cnt FROM employee_permits GROUP BY permit_type ORDER BY cnt DESC'
  );
  console.log('\nCert types in DB:');
  for (const r of breakdown) {
    console.log(`  ${r.permit_type}: ${r.cnt}`);
  }

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
