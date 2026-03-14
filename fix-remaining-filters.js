const fs = require('fs');
const path = require('path');
const BASE = '/var/www/asgard-crm/public/assets/js';

function addВсеAfterSelect(filename) {
  const filepath = path.join(BASE, filename);
  let content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split('\n');

  let fixed = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<select id="f_year">')) {
      // Check if next line already has "Все"
      if (i + 1 < lines.length && lines[i + 1].includes('Все')) {
        console.log(`  ${filename}: already has "Все" option, skipping`);
        return;
      }
      // Get indentation from the select line
      const indent = lines[i].match(/^(\s*)/)[1] + '  ';
      const newLine = indent + '<option value="" ${!filters.year ? \'selected\' : \'\'}>Все</option>';
      lines.splice(i + 1, 0, newLine);
      fixed = true;
      break;
    }
  }

  if (fixed) {
    fs.writeFileSync(filepath, lines.join('\n'), 'utf8');
    console.log(`  ${filename}: added "Все" option ✓`);
  } else {
    console.log(`  ${filename}: select not found ✗`);
  }
}

function addВсеAfterYearSelect(filename) {
  const filepath = path.join(BASE, filename);
  let content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split('\n');

  let fixed = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<select id="yearSelect"')) {
      // Check if next line already has "Все"
      if (i + 1 < lines.length && lines[i + 1].includes('Все')) {
        console.log(`  ${filename}: already has "Все" option, skipping`);
        return;
      }
      const indent = '            ';
      const newLine = indent + '<option value="" ${!selectedYear ? \'selected\' : \'\'}>Все</option>';
      lines.splice(i + 1, 0, newLine);
      fixed = true;
      break;
    }
  }

  if (fixed) {
    fs.writeFileSync(filepath, lines.join('\n'), 'utf8');
    console.log(`  ${filename}: added "Все" option ✓`);
  } else {
    console.log(`  ${filename}: yearSelect not found ✗`);
  }
}

console.log('Fixing year filters...');
addВсеAfterSelect('office_expenses.js');
addВсеAfterSelect('correspondence.js');
addВсеAfterSelect('travel.js');
addВсеAfterYearSelect('kpi_money.js');

// Verify
console.log('\nVerification:');
for (const f of ['office_expenses.js', 'correspondence.js', 'travel.js', 'kpi_money.js']) {
  const content = fs.readFileSync(path.join(BASE, f), 'utf8');
  const lines = content.split('\n');
  let selectLine = -1;
  let hasВсе = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('f_year') && lines[i].includes('select') || lines[i].includes('yearSelect') && lines[i].includes('select')) {
      selectLine = i + 1;
    }
    if (selectLine > 0 && i === selectLine && lines[i].includes('Все')) {
      hasВсе = true;
    }
  }
  console.log(`  ${f}: ${hasВсе ? '✓ has Все' : '✗ missing Все'}`);
}
