'use strict';
// Негативный контроль поведенческого стенда: старая (дырявая) реализация
// защёлки обязана давать цикл, и стенд обязан это показать.
// Сравниваем: код из HEAD (старый) vs рабочий файл (новый).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HUG = path.join(ROOT, 'public/h/index.html');
const PROBE = path.join(__dirname, 'test_huginn_ver_guard.js');
const backup = fs.readFileSync(HUG, 'utf8');

function runProbe() {
  try {
    const out = execFileSync(process.execPath, [PROBE], { stdio: 'pipe', encoding: 'utf8' });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

let failures = 0;
try {
  // Восстанавливаем старую реализацию: recall-хранилище без подтверждения записи.
  const oldImpl = backup
    .replace(/function triedThisVersion\(v\) \{[\s\S]*?\n      \}/,
      `function triedThisVersion(v) {
        try { return sessionStorage.getItem(lockKey(v)) === '1'; } catch (_) { return false; }
      }
      function rememberTry(v) {
        try { sessionStorage.setItem(lockKey(v), '1'); } catch (_) {}
      }`)
    .replace(/if \(triedThisVersion\(j\.version\)\) \{ showReloadNotice\(j\.version\); return; \}/,
      `if (triedThisVersion(j.version)) { showReloadNotice(j.version); return; }
            rememberTry(j.version);`);

  fs.writeFileSync(HUG, oldImpl, 'utf8');
  const r = runProbe();
  // Старая реализация ДОЛЖНА провалить сценарий «setItem бросает».
  const caught = !r.ok;
  console.log(`${caught ? 'PASS' : 'FAIL'}  стенд краснеет на старой (дырявой) защёлке: ${caught ? 'ДА' : 'НЕТ — бесполезен'}`);
  if (!caught) failures += 1;
} finally {
  fs.writeFileSync(HUG, backup, 'utf8');
}

const restored = fs.readFileSync(HUG, 'utf8') === backup;
console.log(`${restored ? 'PASS' : 'FAIL'}  /h/ восстановлен побайтово`);
if (!restored) failures += 1;

console.log(failures ? `\nИТОГ: FAIL — ${failures}` : '\nИТОГ: OK — стенд ловит старую реализацию');
process.exitCode = failures ? 1 : 0;
