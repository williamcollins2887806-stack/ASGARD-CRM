'use strict';
/**
 * Проверка обязательных полей модалок анализа и просчёта.
 *
 * Смысл: заказчик прав, что «полей нет» — модалки рисовали не всё, что умеет
 * движок. Тест фиксирует контракт: каждый пункт из требований должен быть
 * представлен в разметке модалки.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REVIEW = fs.readFileSync(path.join(ROOT, 'public/assets/js/rp_review_modal.js'), 'utf8');
const CALC = fs.readFileSync(path.join(ROOT, 'public/assets/js/rp_calc_modal.js'), 'utf8');
const CL = fs.readFileSync(path.join(ROOT, 'public/assets/js/analysis_checklist.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// ── Анализ ─────────────────────────────────────────────────────────────────
check('анализ: ДВ позициями-карточками', () => {
  assert.ok(REVIEW.includes('renderDvBlock'), 'нет renderDvBlock');
  assert.ok(REVIEW.includes('rp-dv-card'), 'нет карточки позиции');
  for (const part of ['rp-dv-card__num', 'rp-dv-card__grid', 'rp-dv-card__tech', 'rp-dv-card__src']) {
    assert.ok(REVIEW.includes(part), 'нет блока ' + part);
  }
  for (const label of ['Ведомость объёмов', 'Метод', 'Отложения', 'Чем работаем', 'Источник']) {
    assert.ok(REVIEW.includes(label), 'нет подписи ' + label);
  }
  assert.ok(!REVIEW.includes('rp-review-dv-table'), 'старая сжатая таблица осталась');
});

check('анализ: новые поля от модели (суть, риски, выполнимость)', () => {
  for (const k of ['d.summary', 'd.risks', 'd.feasibility', 'd.volume_summary', 'd.competition']) {
    assert.ok(REVIEW.includes(k), 'не пишется ' + k);
  }
  const prompt = fs.readFileSync(path.join(ROOT, 'templates/prompts/PROMPT-dv-v1.md'), 'utf8');
  for (const k of ['"summary"', '"risks"', '"feasibility"', '"volume_summary"']) {
    assert.ok(prompt.includes(k), 'промпт не просит ' + k);
  }
});

check('анализ: блок «позвоните клиенту» с телефоном и вопросами', () => {
  assert.ok(REVIEW.includes('renderCallBlock'), 'нет renderCallBlock');
  assert.ok(REVIEW.includes('call_questions'), 'нет вопросов');
  assert.ok(REVIEW.includes('tel:'), 'нет кнопки звонка');
});

check('анализ: ДВ и звонок реально вызываются в отчёте', () => {
  assert.ok(/h \+= renderDvBlock/.test(REVIEW), 'renderDvBlock не вызывается');
  assert.ok(/h \+= renderCallBlock/.test(REVIEW), 'renderCallBlock не вызывается');
});

check('анализ: позиции сохраняются в карточку (dv_positions)', () => {
  assert.ok(REVIEW.includes('dv_positions'), 'dv_positions не пишется в report_json');
});

check('анализ: выполнимость и риски заполняются из разбора', () => {
  assert.ok(REVIEW.includes('feasibility = problems.length'), 'нет авто-выполнимости');
  assert.ok(REVIEW.includes('riskLines'), 'нет сборки рисков');
});

// ── Просчёт ────────────────────────────────────────────────────────────────
check('просчёт: вкладка «Объёмы» есть', () => {
  assert.ok(/id: 'dv', label: 'Объёмы'/.test(CALC), 'нет вкладки Объёмы');
  assert.ok(CALC.includes('renderDv'), 'нет renderDv');
  assert.ok(/renderDv\(state\)/.test(CALC), 'renderDv не вызывается');
});

check('просчёт: ДВ показывает людей, сроки и источник', () => {
  for (const col of ['Люди', 'Сутки']) {
    assert.ok(CALC.includes(col), 'нет подписи ' + col);
  }
  assert.ok(CALC.includes('rp-calc-dv-card'), 'нет карточки позиции в просчёте');
  assert.ok(CALC.includes('rp-dv-source'), 'нет пометки источника');
  assert.ok(CALC.includes('source_ref'), 'нет обоснования');
  assert.ok(CALC.includes('is-expert'), 'нет пометки экспертной оценки');
});

check('просчёт: бригада и МТР с ролями и источниками', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'public/assets/js/rp-tech-plan-ui.js'), 'utf8');
  assert.ok(ui.includes('data-crew'), 'нет бригады');
  assert.ok(ui.includes('data-mtr'), 'нет МТР');
  assert.ok(ui.includes('role_code'), 'нет ролей');
  assert.ok(ui.includes('warehouse'), 'нет источника «склад»');
});

// ── Чек-лист ───────────────────────────────────────────────────────────────
check('чек-лист: разделён на клиентские и технические', () => {
  assert.ok(CL.includes("q.kind === 'tech'"), 'нет разделения на технические');
  assert.ok(CL.includes('Вопросы клиенту'), 'нет группы «Вопросы клиенту»');
  assert.ok(CL.includes('Технические вопросы'), 'нет группы «Технические»');
});

check('чек-лист: счётчик ответов по группе', () => {
  assert.ok(CL.includes('answeredBase') && CL.includes('answeredTech'), 'нет счётчиков');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
