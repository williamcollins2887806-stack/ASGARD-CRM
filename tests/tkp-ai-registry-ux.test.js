#!/usr/bin/env node
'use strict';

/**
 * Гейт UX «ТКП через ИИ» в реестре:
 *  - после save в модалке есть Word + PDF stamp/sig;
 *  - canOffer / canOpen разделены;
 *  - реестр рисует «ТКП создано» при tkp_id;
 *  - full KP PDF со stamp не идёт в LibreOffice.
 *
 * Запуск: node tests/tkp-ai-registry-ux.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS', name);
  } catch (e) {
    failed += 1;
    console.log('FAIL', name, '—', e.message);
  }
}

const modalSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'tkp-ai-modal.js'), 'utf8');
const regSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'registry_tab.js'), 'utf8');
const apiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'tenders-registry.js'), 'utf8');
const fullSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'tkp-full-kp.js'), 'utf8');

check('success-экран содержит Word и PDF с печатью', () => {
  assert.ok(/data-act="docx"/.test(modalSrc), 'нет data-act=docx');
  assert.ok(/data-act="pdf"/.test(modalSrc), 'нет data-act=pdf');
  assert.ok(/PDF с печатью/.test(modalSrc), 'нет подписи кнопки PDF');
  assert.ok(/\/docx/.test(modalSrc) && /signature=1&stamp=1/.test(modalSrc),
    'нет URL docx или pdf?signature&stamp');
});

check('canOffer скрывает create при tkp_id / tkp_exists', () => {
  assert.ok(/function canOffer\(row\)/.test(modalSrc));
  assert.ok(/tkp_exists \|\| row\.tkp_id/.test(modalSrc) ||
    /if \(row\.tkp_exists \|\| row\.tkp_id\) return false/.test(modalSrc),
    'canOffer не блокирует при существующем ТКП');
});

check('canOpen + openExisting экспортированы', () => {
  assert.ok(/function canOpen\(row\)/.test(modalSrc));
  assert.ok(/function openExisting\(row\)/.test(modalSrc));
  assert.ok(/canOpen:\s*canOpen/.test(modalSrc));
  assert.ok(/openExisting:\s*openExisting/.test(modalSrc));
});

check('реестр рисует «ТКП создано» и вешает .reg-tkp-open', () => {
  assert.ok(/ТКП создано/.test(regSrc), 'нет текста кнопки');
  assert.ok(/reg-tkp-open/.test(regSrc), 'нет класса reg-tkp-open');
  assert.ok(/AsgardTkpAi\.openExisting|\.reg-tkp-open/.test(regSrc));
  assert.ok(/canOpen/.test(regSrc), 'реестр не зовёт canOpen');
});

check('API реестра отдаёт tkp_id', () => {
  assert.ok(/AS tkp_id/.test(apiSrc), 'нет AS tkp_id');
  assert.ok(/ORDER BY k\.id DESC/.test(apiSrc), 'нет ORDER BY id DESC LIMIT 1');
});

check('full KP PDF со stamp не идёт в LibreOffice', () => {
  assert.ok(/wantStamp/.test(fullSrc) || /opts\.stamp \|\| opts\.signature/.test(fullSrc),
    'нет ветки wantStamp');
  // LibreOffice convert только внутри !wantStamp
  const m = fullSrc.match(/async function generateFullKpPdfBuffer[\s\S]*?async function generateFullKpPdf/);
  assert.ok(m, 'функция не найдена');
  const body = m[0];
  assert.ok(/wantStamp/.test(body), 'wantStamp не в generateFullKpPdfBuffer');
  assert.ok(/if\s*\(\s*!wantStamp\s*\)/.test(body), 'LibreOffice не обёрнут в !wantStamp');
});

console.log('\ntkp-ai-registry-ux: ' + passed + '/' + (passed + failed) + ' проверок пройдено');
if (failed) process.exit(1);
console.log('OK');
