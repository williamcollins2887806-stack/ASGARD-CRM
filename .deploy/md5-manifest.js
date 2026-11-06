const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');

const SCOPE = ['src/', 'public/assets/', 'public/index.html', 'public/sw.js',
  'public/h/', 'public/ting-tv/', 'tools/', 'migrations/', 'templates/'];
const SKIP = ['node_modules', '.git', 'tests/', '.deploy/', 'tmp_', 'public/assets/img/'];

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
}

const committed = sh('git diff --name-only 76fd787c..HEAD').split('\n').map((s) => s.trim()).filter(Boolean);
const dirty = sh('git status --porcelain').split('\n').map((l) => l.slice(3).trim()).filter(Boolean);

const files = [...new Set([...committed, ...dirty])]
  .filter((f) => SCOPE.some((s) => f === s || f.startsWith(s)))
  .filter((f) => !SKIP.some((s) => f.startsWith(s)))
  .filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } })
  .sort();

const lines = [];
for (const f of files) {
  const buf = fs.readFileSync(f);
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  lines.push(md5 + '\t' + f);
}
fs.writeFileSync('.deploy/md5-all.txt', lines.join('\n') + '\n', 'utf8');
console.log('FILES=' + files.length);
