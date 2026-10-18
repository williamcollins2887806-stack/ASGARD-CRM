require('dotenv').config();
// НЕ переопределяем .env — проверяем, что там сейчас
console.log('OPENAI_URL(from .env)=', process.env.OPENAI_URL);
const fs = require('fs');
const t = fs.readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8');
for (const l of t.split(/\r?\n/)) if (/^OPENAI_URL|^OPENAI_API_KEY|^OPENAI_MODEL/.test(l)) console.log('env-line:', l.replace(/=(.{6}).*/, '=$1…'));
