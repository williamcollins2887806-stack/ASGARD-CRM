const fs = require('fs');
const t = fs.readFileSync('.env', 'utf8');
const want = ['OPENAI_URL', 'OPENAI_MODEL', 'AI_PROVIDER', 'AI_TIMEOUT_MS', 'DB_NAME', 'DB_HOST', 'DB_PORT', 'ASGARD_ENV', 'PORT'];
for (const line of t.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && want.includes(m[1])) console.log(m[1] + '=' + m[2].trim());
}
console.log('--- ai-provider keys ---');
try {
  const ai = require('./src/services/ai-provider');
  console.log(Object.keys(ai));
} catch (e) { console.log('load err', e.message); }
