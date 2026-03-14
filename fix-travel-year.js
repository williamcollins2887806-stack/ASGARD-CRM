const fs = require('fs');
const filepath = '/var/www/asgard-crm/public/assets/js/travel.js';
let content = fs.readFileSync(filepath, 'utf8');

const old = `<select id="f_year">
                \${[currentYear, currentYear-1, currentYear-2].map(y =>
                  \`<option value="\${y}" \${filters.year == y ? 'selected' : ''}>\${y}</option>\`
                ).join('')}
              </select>`;

const replacement = `<select id="f_year">
                <option value="" \${!filters.year ? 'selected' : ''}>Все</option>
                \${[currentYear, currentYear-1, currentYear-2, currentYear-3, currentYear-4].map(y =>
                  \`<option value="\${y}" \${filters.year == y ? 'selected' : ''}>\${y}</option>\`
                ).join('')}
              </select>`;

if (content.includes(old)) {
  content = content.replace(old, replacement);
  fs.writeFileSync(filepath, content, 'utf8');
  console.log('Fixed travel.js');
} else {
  console.log('Exact pattern not found, using line insert...');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<select id="f_year">')) {
      console.log('Found select at line ' + (i + 1));
      lines.splice(i + 1, 0, '                <option value="" ${!filters.year ? \'selected\' : \'\'}>Все</option>');
      fs.writeFileSync(filepath, lines.join('\n'), 'utf8');
      console.log('Fixed by inserting line');
      break;
    }
  }
}
