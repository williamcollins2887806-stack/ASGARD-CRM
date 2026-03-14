/**
 * Fix year filter dropdowns to add "Все" (All) option
 * Files: office_expenses.js, correspondence.js, travel.js, kpi_money.js
 * Also fix funnel.js click to open specific tender
 */
const fs = require('fs');
const path = require('path');

const BASE = '/var/www/asgard-crm/public/assets/js';

function fixFile(filename, fixes) {
  const filepath = path.join(BASE, filename);
  let content = fs.readFileSync(filepath, 'utf8');
  let changed = 0;

  for (const [search, replace] of fixes) {
    if (content.includes(search)) {
      content = content.replace(search, replace);
      changed++;
      console.log(`  ✓ Fixed in ${filename}`);
    } else {
      console.log(`  ✗ Pattern not found in ${filename}: "${search.substring(0, 60)}..."`);
    }
  }

  if (changed > 0) {
    fs.writeFileSync(filepath, content, 'utf8');
    console.log(`  Saved ${filename} (${changed} fixes)`);
  }
  return changed;
}

let totalFixes = 0;

// 1. office_expenses.js - add "Все" to year dropdown + fix label
console.log('\n1. office_expenses.js');
totalFixes += fixFile('office_expenses.js', [
  [
    `<select id="f_year">
                \${[currentYear, currentYear-1, currentYear-2].map(y =>
                  \`<option value="\${y}" \${filters.year == y ? 'selected' : ''}>\${y}</option>\`
                ).join('')}
              </select>`,
    `<select id="f_year">
                <option value="" \${!filters.year ? 'selected' : ''}>Все</option>
                \${[currentYear, currentYear-1, currentYear-2, currentYear-3, currentYear-4].map(y =>
                  \`<option value="\${y}" \${filters.year == y ? 'selected' : ''}>\${y}</option>\`
                ).join('')}
              </select>`
  ],
  [
    `Всего за \${filters.year}`,
    `Всего за \${filters.year || 'все годы'}`
  ]
]);

// 2. correspondence.js - add "Все" to year dropdown
console.log('\n2. correspondence.js');
// Need to find the actual year select pattern
const corrPath = path.join(BASE, 'correspondence.js');
let corrContent = fs.readFileSync(corrPath, 'utf8');

// Find year select in correspondence
const corrYearPattern = `<select id="f_year">
                \${[currentYear, currentYear-1, currentYear-2].map(y =>
                  \`<option value="\${y}" \${filters.year == y ? 'selected' : ''}>\${y}</option>\`
                ).join('')}
              </select>`;

if (corrContent.includes(corrYearPattern)) {
  corrContent = corrContent.replace(corrYearPattern,
    `<select id="f_year">
                <option value="" \${!filters.year ? 'selected' : ''}>Все</option>
                \${[currentYear, currentYear-1, currentYear-2, currentYear-3, currentYear-4].map(y =>
                  \`<option value="\${y}" \${filters.year == y ? 'selected' : ''}>\${y}</option>\`
                ).join('')}
              </select>`);
  fs.writeFileSync(corrPath, corrContent, 'utf8');
  console.log('  ✓ Fixed year dropdown');
  totalFixes++;
} else {
  // Try with different whitespace
  const idx = corrContent.indexOf('<select id="f_year">');
  if (idx >= 0) {
    const endIdx = corrContent.indexOf('</select>', idx);
    if (endIdx >= 0) {
      const old = corrContent.substring(idx, endIdx + '</select>'.length);
      console.log('  Found select at position', idx, 'length', old.length);
      const replacement = old.replace(
        /(\$\{)\[currentYear, currentYear-1, currentYear-2\]/,
        '$1["",' + ' currentYear, currentYear-1, currentYear-2, currentYear-3, currentYear-4]'
      );
      // Actually let's just do a targeted replace
      corrContent = corrContent.replace(
        /(<select id="f_year">\s*)\$\{\[currentYear, currentYear-1, currentYear-2\]\.map\(y =>\s*`<option value="\$\{y\}" \$\{filters\.year == y \? 'selected' : ''\}>\$\{y\}<\/option>`\s*\)\.join\(''\)\}/,
        `$1<option value="" \${!filters.year ? 'selected' : ''}>Все</option>
                \${[currentYear, currentYear-1, currentYear-2, currentYear-3, currentYear-4].map(y =>
                  \`<option value="\${y}" \${filters.year == y ? 'selected' : ''}>\${y}</option>\`
                ).join('')}`
      );
      fs.writeFileSync(corrPath, corrContent, 'utf8');
      console.log('  ✓ Fixed via regex');
      totalFixes++;
    }
  } else {
    console.log('  ✗ Year select not found');
  }
}

// 3. travel.js - add "Все" to year dropdown
console.log('\n3. travel.js');
totalFixes += fixFile('travel.js', [
  [
    `<select id="f_year">
                \${[currentYear, currentYear-1, currentYear-2].map(y =>
                  \`<option value="\${y}" \${filters.year == y ? 'selected' : ''}>\${y}</option>\`
                ).join('')}
              </select>`,
    `<select id="f_year">
                <option value="" \${!filters.year ? 'selected' : ''}>Все</option>
                \${[currentYear, currentYear-1, currentYear-2, currentYear-3, currentYear-4].map(y =>
                  \`<option value="\${y}" \${filters.year == y ? 'selected' : ''}>\${y}</option>\`
                ).join('')}
              </select>`
  ]
]);

// 4. kpi_money.js - add "Все" to year dropdown (needs special handling)
console.log('\n4. kpi_money.js');
const kpiPath = path.join(BASE, 'kpi_money.js');
let kpiContent = fs.readFileSync(kpiPath, 'utf8');

const kpiYearPattern = `\${[currentYear, currentYear-1, currentYear-2].map(y =>
              \`<option value="\${y}" \${y===selectedYear?'selected':''}>\${y}</option>\`
            ).join('')}`;

if (kpiContent.includes(kpiYearPattern)) {
  kpiContent = kpiContent.replace(kpiYearPattern,
    `<option value="" \${!selectedYear?'selected':''}>Все</option>
            \${[currentYear, currentYear-1, currentYear-2, currentYear-3, currentYear-4].map(y =>
              \`<option value="\${y}" \${y===selectedYear?'selected':''}>\${y}</option>\`
            ).join('')}`);

  // Also fix the year change handler to handle empty value
  kpiContent = kpiContent.replace(
    `selectedYear = parseInt(e.target.value);`,
    `selectedYear = e.target.value ? parseInt(e.target.value) : null;`
  );

  // Fix filterYear function to handle null year (show all)
  kpiContent = kpiContent.replace(
    `const filterYear = (date) => getYear(date) === year;`,
    `const filterYear = (date) => !year || getYear(date) === year;`
  );

  // Fix the label that shows year
  kpiContent = kpiContent.replace(
    `за \${selectedYear} год`,
    `за \${selectedYear || 'все'} год\${selectedYear ? '' : 'ы'}`
  );

  fs.writeFileSync(kpiPath, kpiContent, 'utf8');
  console.log('  ✓ Fixed year dropdown + filter logic');
  totalFixes++;
} else {
  console.log('  ✗ Pattern not found, trying alternative...');
  // Try regex approach
  const replaced = kpiContent.replace(
    /\$\{\[currentYear, currentYear-1, currentYear-2\]\.map\(y =>\s*`<option value="\$\{y\}" \$\{y===selectedYear\?'selected':''\}>\$\{y\}<\/option>`\s*\)\.join\(''\)\}/,
    `<option value="" \${!selectedYear?'selected':''}>Все</option>
            \${[currentYear, currentYear-1, currentYear-2, currentYear-3, currentYear-4].map(y =>
              \`<option value="\${y}" \${y===selectedYear?'selected':''}>\${y}</option>\`
            ).join('')}`
  );
  if (replaced !== kpiContent) {
    kpiContent = replaced;
    kpiContent = kpiContent.replace(
      `selectedYear = parseInt(e.target.value);`,
      `selectedYear = e.target.value ? parseInt(e.target.value) : null;`
    );
    kpiContent = kpiContent.replace(
      `const filterYear = (date) => getYear(date) === year;`,
      `const filterYear = (date) => !year || getYear(date) === year;`
    );
    fs.writeFileSync(kpiPath, kpiContent, 'utf8');
    console.log('  ✓ Fixed via regex');
    totalFixes++;
  } else {
    console.log('  ✗ Could not fix');
  }
}

// 5. funnel.js - fix click to open specific tender
console.log('\n5. funnel.js - fix click behavior');
totalFixes += fixFile('funnel.js', [
  [
    "location.hash = `#/tenders?highlight=${id}`;",
    "location.hash = `#/tenders?id=${id}`;"
  ]
]);

console.log(`\nTotal fixes applied: ${totalFixes}`);
