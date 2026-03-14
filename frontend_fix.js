const fs = require('fs');
const FILE = '/var/www/asgard-crm/public/assets/js/telephony.js';
let code = fs.readFileSync(FILE, 'utf8');

// Fix 1: loadManagerOptions - change API endpoint
const oldApi = "api('/stats/managers?date_from=2020-01-01&date_to=2099-12-31')";
const newApi = "api('/managers')";
if (code.includes(oldApi)) {
  code = code.replace(oldApi, newApi);
  console.log('Fix 1: Manager API endpoint changed');
} else {
  console.log('Fix 1: Already fixed or pattern not found');
}

// Fix 2: manager_id → user_id in fetchLog
const oldParam = "manager_id:";
if (code.includes(oldParam)) {
  code = code.replace(oldParam, "user_id:");
  console.log('Fix 2: manager_id → user_id in fetchLog');
} else {
  console.log('Fix 2: Already fixed or pattern not found');
}

// Fix 3: Handle the response format - managers endpoint returns {managers: [{id, name, role}]}
// The existing code expects data.managers - check if it's correct
if (code.includes('data.managers || []') || code.includes('(data.managers || [])')) {
  console.log('Fix 3: managers array access already correct');
} else {
  console.log('Fix 3: Check managers data access manually');
}

fs.writeFileSync(FILE, code);
console.log('Frontend fixes applied');
