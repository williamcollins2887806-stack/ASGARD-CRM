const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Что выкатываем: изменения между прод-коммитом и HEAD + незакоммиченные правки.
// Ограничиваем каталоги, которые реально едут в деплой.
const SCOPE = ['src/', 'public/assets/', 'public/index.html', 'public/sw.js',
  'public/h/', 'public/ting-tv/', 'tools/', 'migrations/', 'templates/'];
const SKIP_DIRS = ['node_modules', '.git', 'tests/', '.deploy/', 'tmp_', 'public/assets/img/'];

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const committed = sh('git diff --name-only 76fd787c..HEAD')
  .split('\n').map((s) => s.trim()).filter(Boolean);

const dirty = sh('git status --porcelain')
  .split('\n')
  .map((l) => l.slice(3).trim())
  .filter(Boolean);

const all = [...new Set([...committed, ...dirty])]
  .filter((f) => SCOPE.some((s) => f === s || f.startsWith(s)))
  .filter((f) => !SKIP_DIRS.some((s) => f.startsWith(s)))
  .filter((f) => {
    try { return fs.statSync(f).isFile(); } catch { return false; }
  })
  .sort();

// Сравнение с продом по размеру+mtime делает rsync на сервере,
// здесь только формируем список.
fs.writeFileSync('.deploy/deploy-scoped.txt', all.join('\n') + '\n', 'utf8');
console.log('FILES=' + all.length);
const byDir = {};
for (const f of all) {
  const k = f.split('/').slice(0, 3).join('/');
  byDir[k] = (byDir[k] || 0) + 1;
}
Object.entries(byDir).sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([k, v]) => console.log(v + '\t' + k));
