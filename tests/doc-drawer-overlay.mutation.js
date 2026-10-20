// Мутационная проверка теста D-306b: подменяем исправленный порядок на
// дефектный и убеждаемся, что тест ПАДАЕТ. Иначе тест ничего не доказывает.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FILE = path.join(__dirname, '..', 'public', 'assets', 'js', 'doc-hub.js');
const orig = fs.readFileSync(FILE, 'utf8');

const GOOD = `      const wasOpen = !d.hidden && d.classList.contains('is-on');
      const sameDoc = String(d.dataset.docId || '') === String(id);
      const reopeningSame = wasOpen && sameDoc;
      d.dataset.docId = String(id);
      if (ov && !reopeningSame) { ov.hidden = false; ov.classList.add('is-on'); ov.onclick = () => closeDrawer(); }
      d.hidden = false;
      d.classList.add('is-on');
      d.setAttribute('aria-hidden', 'false');`;

// исторически дефектный порядок (D3): hidden=false стоит ДО проверки
const BAD = `      d.hidden = false;
      d.classList.add('is-on');
      d.setAttribute('aria-hidden', 'false');
      const reopeningSame = !d.hidden && String(d.dataset.docId || '') === String(id);
      d.dataset.docId = String(id);
      if (ov && !reopeningSame) { ov.hidden = false; ov.classList.add('is-on'); ov.onclick = () => closeDrawer(); }`;

function norm(s) { return s.replace(/\r\n/g, '\n'); }
if (!norm(orig).includes(norm(GOOD))) {
  console.error('MUTATION: исправленный блок не найден — тест не актуален');
  process.exit(2);
}
const broken = norm(orig).replace(norm(GOOD), norm(BAD));

let rc = 0;
try {
  fs.writeFileSync(FILE, broken, 'utf8');
  console.log('=== тест на ДЕФЕКТНОМ коде (ожидаем провал) ===');
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'doc-drawer-overlay.test.js')], { encoding: 'utf8', stdio: 'pipe' });
    console.log('ПРОБЛЕМА: тест ПРОШЁЛ на дефектном коде — он ничего не ловит');
    rc = 1;
  } catch (e) {
    const out = String(e.stdout || '');
    const failed = (out.match(/FAIL/g) || []).length;
    console.log(out.split('\n').filter((l) => /FAIL|ИТОГ/.test(l)).join('\n'));
    console.log(`дефект поймали: FAIL-ов ${failed}`);
    rc = failed > 0 ? 0 : 1;
  }
} finally {
  fs.writeFileSync(FILE, orig, 'utf8');
  console.log('файл восстановлен');
}
process.exit(rc);
