// Мутация браузерного теста D-306b: возвращаем исторический дефект D3
// (hidden=false ДО проверки) и убеждаемся, что браузерный тест ПАДАЕТ
// на сценарии 3. Без этого браузерный тест — просто «зелёная лампочка».
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

const BAD = `      d.hidden = false;
      d.classList.add('is-on');
      d.setAttribute('aria-hidden', 'false');
      const reopeningSame = !d.hidden && String(d.dataset.docId || '') === String(id);
      d.dataset.docId = String(id);
      if (ov && !reopeningSame) { ov.hidden = false; ov.classList.add('is-on'); ov.onclick = () => closeDrawer(); }`;

const BREAK_CLOSE = '      delete d.dataset.docId;';
const norm = (s) => s.replace(/\r\n/g, '\n');

if (!norm(orig).includes(norm(GOOD))) {
  console.error('MUTATION: исправленный блок не найден');
  process.exit(2);
}
let broken = norm(orig).replace(norm(GOOD), norm(BAD));
// убираем и сброс в closeDrawer — именно сочетание давало FAIL D4
broken = broken.replace(norm(BREAK_CLOSE), '      /* мутация: сброс убран */');

let rc = 0;
try {
  fs.writeFileSync(FILE, broken, 'utf8');
  console.log('=== браузерный тест на ДЕФЕКТНОМ коде (ожидаем провал сценария 3) ===');
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'doc-drawer-overlay.browser.js')], { encoding: 'utf8', stdio: 'pipe', env: process.env });
    console.log('ПРОБЛЕМА: браузерный тест прошёл на дефектном коде — он не ловит FAIL D4');
    rc = 1;
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    console.log(out.split('\n').filter((l) => /FAIL|ИТОГ/.test(l)).join('\n'));
    const caught = /FAIL сценарий 3/.test(out);
    console.log(caught ? 'OK: браузерный тест поймал FAIL D4' : 'ВНИМАНИЕ: сценарий 3 не упал — тест не ловит дефект');
    rc = caught ? 0 : 1;
  }
} finally {
  fs.writeFileSync(FILE, orig, 'utf8');
  console.log('файл восстановлен');
}
process.exit(rc);
