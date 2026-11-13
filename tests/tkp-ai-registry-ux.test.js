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

check('canOpen работает при tkp_exists без tkp_id', () => {
  assert.ok(/return !!\(row\.tkp_exists\)/.test(modalSrc),
    'canOpen не учитывает tkp_exists без id');
  assert.ok(/\/api\/tkp\?tender_id=/.test(modalSrc),
    'openExisting не добирает id по tender_id');
});

check('реестр рисует «ТКП создано» даже без row.tkp_id', () => {
  assert.ok(/ТКП создано/.test(regSrc), 'нет текста кнопки');
  assert.ok(/reg-tkp-open/.test(regSrc), 'нет класса reg-tkp-open');
  assert.ok(/if \(open\)/.test(regSrc) && !/if \(open && row\.tkp_id\)/.test(regSrc),
    'кнопка всё ещё требует row.tkp_id — пропадёт на проде без API tkp_id');
  assert.ok(/canOpen/.test(regSrc), 'реестр не зовёт canOpen');
});

check('attach_pdf_only рендерит PDF с печатью и подписью', () => {
  const tkpSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'tkp.js'), 'utf8'
  );
  const m = tkpSrc.match(/async function _finishAttachPdfOnly[\s\S]*?_renderTkpPdfBuffer\(fastify, tkp, \{[\s\S]*?\}\)/);
  assert.ok(m, '_finishAttachPdfOnly не найден');
  assert.ok(/signature:\s*true/.test(m[0]) && /stamp:\s*true/.test(m[0]),
    'attach PDF без stamp/signature');
});

check('ai-draft не берёт ФИО ТО как подписанта', () => {
  const draftSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'tkp-ai-draft.js'), 'utf8'
  );
  assert.ok(/resolveCompanyDirector/.test(draftSrc), 'нет resolveCompanyDirector');
  assert.ok(!/authorName = \(p && p\.user && p\.user\.name\)/.test(draftSrc),
    'всё ещё берёт p.user.name');
});

check('API реестра отдаёт tkp_id', () => {
  assert.ok(/AS tkp_id/.test(apiSrc), 'нет AS tkp_id');
  assert.ok(/ORDER BY k\.id DESC/.test(apiSrc), 'нет ORDER BY id DESC LIMIT 1');
});

check('full KP PDF со stamp идёт через тот же DOCX-шаблон (не HTML)', () => {
  // Раньше этот гейт требовал обратного: «при stamp/signature не идти в
  // LibreOffice, отдать HTML». На практике это давало РАЗНЫЕ документы:
  // Word по шаблону с логотипом и печатью, PDF — HTML-рендер без шапки
  // (ТКП 3071, 08.11.2026; владелец сравнил выгрузки). Коммиты 03f62469 и
  // ddc3909b перевели печать внутрь DOCX (applyStampAndSignature) и оставили
  // один шаблон для Word и PDF.
  //
  // Теперь проверяем то, что действительно важно:
  //  1) PDF собирается из DOCX-шаблона ВСЕГДА, включая штамп;
  //  2) stamp/signature доезжают до сборки DOCX, а не теряются;
  //  3) картинки вставляются в сам DOCX (applyStampAndSignature), поэтому
  //     LibreOffice их не выбросит.
  const m = fullSrc.match(/async function generateFullKpPdfBuffer[\s\S]*?async function generateFullKpPdf/);
  assert.ok(m, 'функция generateFullKpPdfBuffer не найдена');
  const body = m[0];

  assert.ok(/generateFullKpDocxBuffer\(/.test(body),
    'PDF перестал собираться из единого DOCX-шаблона');
  assert.ok(/stamp:\s*!!opts\.stamp/.test(body) && /signature:\s*!!opts\.signature/.test(body),
    'stamp/signature не передаются в сборку DOCX');
  assert.ok(!/if\s*\(\s*!wantStamp\s*\)/.test(body),
    'вернулась ветка «без штампа — шаблон, со штампом — HTML»: Word и PDF разойдутся');

  // Печать/подпись вставляются в DOCX, а не в HTML.
  assert.ok(/applyStampAndSignature/.test(fullSrc), 'нет вставки печати в DOCX');
  const stampFn = fullSrc.match(/function applyStampAndSignature\(buf, opts\)[\s\S]*?\n\}/);
  assert.ok(stampFn, 'applyStampAndSignature не найдена');
  assert.ok(/word\/media\//.test(stampFn[0]),
    'печать/подпись не кладутся в word/media — LibreOffice их не увидит');
});

console.log('\ntkp-ai-registry-ux: ' + passed + '/' + (passed + failed) + ' проверок пройдено');
if (failed) process.exit(1);
console.log('OK');
