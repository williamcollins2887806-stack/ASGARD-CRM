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
  { file: 'fixture-esm', kind: 'ESM', poison: '\nexport const broken = ;\n' },
  { file: 'fixture-classic', kind: 'классический', poison: '\nfunction broken( { return 1; }\n' },
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
  /* Фикстура, а не реальный файл: раньше тест правил боевой бандл и
     восстанавливал его. Когда livekit-track-processors.esm.js удалили
     (виртуальные фоны отключены), чтение падало с ENOENT — тест ломался
     не по делу. Теперь создаём временный файл нужного класса прямо здесь. */
  const fixture = c.kind === 'ESM'
    ? 'export const ok = 1;\n'
    : '(function (root) { root.Ok = {}; })(typeof self !== "undefined" ? self : this);\n';
  const p = path.join(VENDOR, `__fixture_${process.pid}.js`);
  fs.writeFileSync(p, fixture, 'utf8');
  let caught = false;
  try {
    fs.writeFileSync(p, fixture + c.poison, 'utf8');
    caught = gateFails();
  } finally {
    try { fs.unlinkSync(p); } catch (_) { /* */ }
  }
  const cleaned = !fs.existsSync(p);
  const ok = caught && cleaned;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  битый ${c.kind} пойман: ${caught ? 'ДА' : 'НЕТ'}`
    + `, фикстура удалена: ${cleaned ? 'ДА' : 'НЕТ'}`);
}

console.log(failures ? `\nИТОГ: FAIL — ${failures}` : '\nИТОГ: OK — оба класса дефектов ловятся');
process.exitCode = failures ? 1 : 0;
