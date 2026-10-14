const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const JS_DIR = path.join(ROOT, 'public', 'assets', 'js');

const found = new Map(); // route -> [files]
for (const f of fs.readdirSync(JS_DIR).filter(x => x.endsWith('.js'))) {
  const txt = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
  const re = /AsgardRouter\.add\(\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(txt))) {
    if (!found.has(m[1])) found.set(m[1], []);
    if (!found.get(m[1]).includes(f)) found.get(m[1]).push(f);
  }
}
const routes = [...found.keys()].sort();

const model = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'pages_final.json'), 'utf8'));
const mine = new Set(model.map(r => r.route));

const missing = routes.filter(r => !mine.has(r));
const extra = [...mine].filter(r => !found.has(r));

console.log('в коде:', routes.length, '| в Excel:', mine.size);
console.log('\nЕСТЬ В КОДЕ, НЕТ В EXCEL (' + missing.length + '):');
for (const r of missing) console.log('  ', r, '←', found.get(r).join(', '));
console.log('\nЕСТЬ В EXCEL, НЕТ В КОДЕ (' + extra.length + '):');
for (const r of extra) console.log('  ', r);
