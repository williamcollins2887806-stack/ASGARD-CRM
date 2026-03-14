const fs = require('fs');
const FILE = '/var/www/asgard-crm/public/assets/js/telephony.js';
let code = fs.readFileSync(FILE, 'utf8');

// Fix the broken line from previous sed
const broken = `api("/managers"=2020-01-01&date_to=2099-12-31');`;
if (code.includes(broken)) {
  code = code.replace(broken, `api('/managers');`);
  console.log('Fixed broken API call');
} else {
  // Try other variations
  const old1 = "api('/stats/managers?date_from=2020-01-01&date_to=2099-12-31')";
  if (code.includes(old1)) {
    code = code.replace(old1, "api('/managers')");
    console.log('Fixed API endpoint (variant 1)');
  } else {
    console.log('API endpoint already correct or unknown format');
    // Show current state
    const match = code.match(/api\([^)]*manager[^)]*\)/gi);
    if (match) console.log('Found:', match);
  }
}

fs.writeFileSync(FILE, code);
console.log('Done');
