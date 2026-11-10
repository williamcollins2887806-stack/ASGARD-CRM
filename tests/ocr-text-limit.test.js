'use strict';
/**
 * Извлечение текста документов НЕ должно резать ведомость на 100 000 символов.
 *
 * ── История (10.11.2026, тендер 2138) ──────────────────────────────────────
 * OCR ведомости на 673 строки дал 99 998 символов — ровно лимит MAX_TEXT_CHARS.
 * Последняя строка в тексте была поз. 353, «Прил. 2/6/7» отсутствовали: модель
 * физически не видела 320 позиций из 673, и разбор был «нестабильным» (от 1
 * до 353 позиций). При этом анализ готов принять 400 000 символов, а OCR-воркер
 * хранит в БД до 500 000 — лимит терялся ещё на извлечении.
 *
 * Тест проверяет ПОВЕДЕНИЕ: длинный текст проходит целиком, а короткий лимит
 * остаётся только у разбора готового КП (там ответ модели короткий).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/services/tkp-parser.js'), 'utf8');
const STAGES_AI = fs.readFileSync(path.join(ROOT, 'src/services/mimir-tender-stages-ai.js'), 'utf8');

const results = [];
function check(name, fn) {
  try { fn(); results.push({ ok: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ ok: false }); console.log('FAIL ' + name + ' — ' + e.message); }
}

check('лимит извлечения отделён от лимита разбора КП', () => {
  assert.ok(/MAX_TEXT_CHARS\s*=\s*100000/.test(SRC), 'нет лимита разбора КП');
  assert.ok(/MAX_EXTRACT_CHARS\s*=\s*500000/.test(SRC), 'нет отдельного лимита извлечения');
});

check('извлечение текста не режет на 100 000', () => {
  // Все return'ы извлечения обязаны использовать MAX_EXTRACT_CHARS.
  const wrong = [];
  SRC.split('\n').forEach((line, i) => {
    if (!/text.*(substring|slice)\(0,\s*MAX_TEXT_CHARS/.test(line)) return;
    // Исключение: промпт разбора готового КП (const trimmed = ...) — там
    // вход для модели ограничен осознанно.
    if (/const trimmed\s*=\s*text\.substring/.test(line)) return;
    wrong.push((i + 1) + ': ' + line.trim());
  });
  assert.deepStrictEqual(wrong, [], 'извлечение ограничено лимитом разбора: ' + wrong.join(' | '));
});

check('анализ принимает больше 100 000 символов', () => {
  const m = /function docsToText\(documents,\s*limit\s*=\s*(\d+)\)/.exec(STAGES_AI);
  assert.ok(m, 'docsToText не найден');
  assert.ok(Number(m[1]) >= 400000,
    'бюджет анализа меньше извлечённого текста: ' + m[1]);
});

check('OCR-воркер хранит не меньше, чем извлекаем', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'src/services/tender-ocr-worker.js'), 'utf8');
  const m = /String\(text\)\.slice\(0,\s*(\d+)\)/.exec(worker);
  assert.ok(m, 'не найден лимит записи ocr_text');
  const stored = Number(m[1]);
  const extract = Number(/MAX_EXTRACT_CHARS\s*=\s*(\d+)/.exec(SRC)[1]);
  assert.ok(stored >= extract,
    `в БД пишется ${stored}, а извлекаем ${extract} — обрезка на записи`);
});

check('промпт разбора КП остаётся ограниченным (ответ модели короткий)', () => {
  assert.ok(/const trimmed = text\.substring\(0, MAX_TEXT_CHARS\)/.test(SRC),
    'лимит разбора КП потерян — промпт может уехать в огромный вход');
});

check('диагностика недобора сохраняется в состоянии анализа', () => {
  const QS = fs.readFileSync(path.join(ROOT, 'src/routes/tkp_quick.js'), 'utf8');
  const PM = fs.readFileSync(path.join(ROOT, 'src/routes/pm-duty.js'), 'utf8');
  // Без сохранения РП не видит, что модель прочитала половину ведомости:
  // после перезагрузки модалки цифры недобора исчезали (тендер 2138).
  ['incomplete', 'expected_rows', 'found_positions', 'valid_positions',
    'generation_rounds', 'review_hint'].forEach((k) => {
    assert.ok(new RegExp(k + ':').test(QS), 'этап ДВ не сохраняет ' + k);
    assert.ok(new RegExp("'" + k + "'").test(PM), 'диагностика ' + k + ' не доходит до отчёта');
  });
});

const failed = results.filter((r) => !r.ok);
console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
