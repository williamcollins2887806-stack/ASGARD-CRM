'use strict';
/**
 * Негативный контроль vendor-гейта: проверяем, что он РЕАЛЬНО ловит битые
 * бандлы, а не просто зелёный. Два класса: классический скрипт и ESM-модуль.
 *
 * Важно: подделка дописывается через "\n", иначе строка приклеивается к
 * хвостовому комментарию `//# sourceMappingURL=...` и дефект не воспроизводится
 * (на этом первая версия контроля сама себя обманула).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'public', 'assets', 'vendor');
const GATE = path.join(__dirname, 'verify_vendor_bundles.js');

const CASES = [
  { file: 'livekit-track-processors.esm.js', kind: 'ESM', poison: '\nexport const broken = ;\n' },
  { file: 'jssip.min.js', kind: 'классический', poison: '\nfunction broken( { return 1; }\n' },
];

function gateFails() {
  try {
    execFileSync(process.execPath, [GATE], { stdio: 'pipe' });
    return false;
  } catch (_) {
    return true;
  }
}

let failures = 0;
for (const c of CASES) {
  const p = path.join(VENDOR, c.file);
  const backup = fs.readFileSync(p, 'utf8');
  let caught = false;
  try {
    fs.writeFileSync(p, backup + c.poison, 'utf8');
    caught = gateFails();
  } finally {
    fs.writeFileSync(p, backup, 'utf8');
  }
  const restored = fs.readFileSync(p, 'utf8') === backup;
  const ok = caught && restored;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  битый ${c.kind} (${c.file}) пойман: ${caught ? 'ДА' : 'НЕТ'}`
    + `, файл восстановлен: ${restored ? 'ДА' : 'НЕТ'}`);
}

console.log(failures ? `\nИТОГ: FAIL — ${failures}` : '\nИТОГ: OK — оба класса дефектов ловятся');
process.exitCode = failures ? 1 : 0;
