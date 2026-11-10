'use strict';
/**
 * Данные от РП (описание работы + свои файлы) должны попадать в расчёт
 * Мимира С ПРИОРИТЕТОМ выше документов тендера.
 *
 * ── Задача (Дима, 10.11.2026) ──────────────────────────────────────────────
 * На этапе просчёта РП должен иметь возможность дописать описание работы и
 * приложить свои файлы, и Мимир обязан учесть их в первую очередь.
 *
 * ── Что было не так ────────────────────────────────────────────────────────
 * 1. Поля были только в мастере Quick, из карточки просчёта их не было.
 * 2. Описание РП дописывалось в КОНЕЦ tz_text — после сотен тысяч символов
 *    OCR, и модель фактически его не учитывала.
 * 3. Файлы РП при большом кэше тендера (>=30 000 симв.) не попадали в промпт
 *    вообще: вместо текста уходило лишь имя («текст взят из кэша тендера»).
 *
 * Проверка идёт ПОВЕДЕНИЕМ: собираем user-message и смотрим порядок и состав.
 */

process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test-stub';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const quick = require('../src/services/mimir-tkp-quick');
const QS = fs.readFileSync(path.join(ROOT, 'src/routes/tkp_quick.js'), 'utf8');
const CALC = fs.readFileSync(path.join(ROOT, 'public/assets/js/rp_calc_modal.js'), 'utf8');

const results = [];
function check(name, fn) {
  try { fn(); results.push({ ok: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ ok: false }); console.log('FAIL ' + name + ' — ' + e.message); }
}

const MARK = '— Дополнение от РП —';

check('описание РП идёт В НАЧАЛЕ промпта, а не в хвосте ТЗ', () => {
  const msg = quick._buildQuickUserMessage({
    tz_text: 'ТЗ из документов: промывка теплообменника.\n' + MARK + '\nАппараты Е-716 и Е-904, 1200 м², работа внутри — нужен наблюдающий.',
    customer_name: 'ООО Тест'
  });
  const manualPos = msg.indexOf('Аппараты Е-716');
  const tzPos = msg.indexOf('промывка теплообменника');
  assert.ok(manualPos > 0, 'описание РП не попало в промпт');
  assert.ok(manualPos < tzPos, 'описание РП стоит ПОСЛЕ ТЗ — модель его проигнорирует');
  assert.ok(/ПРИОРИТЕТ №1/.test(msg), 'нет явного маркера приоритета');
});

check('описание РП отделено от «ТЗ из письма»', () => {
  const msg = quick._buildQuickUserMessage({
    tz_text: 'Письмо клиента.\n' + MARK + '\nУточнение инженера.',
    customer_name: 'X'
  });
  assert.ok(/ТЕХНИЧЕСКОЕ ЗАДАНИЕ \(из тела письма\)/.test(msg), 'блок ТЗ из письма отсутствует');
  const tzBlock = msg.slice(msg.indexOf('ТЕХНИЧЕСКОЕ ЗАДАНИЕ'));
  assert.ok(tzBlock.indexOf('Уточнение инженера') === -1,
    'описание РП продублировано в блоке ТЗ — смешается с документами');
});

check('без описания РП промпт собирается как раньше', () => {
  const msg = quick._buildQuickUserMessage({
    tz_text: 'Просто ТЗ без маркера.',
    customer_name: 'X'
  });
  assert.ok(msg.indexOf('ПРИОРИТЕТ №1') === -1, 'лишний блок приоритета без данных');
  assert.ok(/Просто ТЗ без маркера/.test(msg), 'ТЗ потерялось');
});

check('файлы РП ВСЕГДА попадают в промпт, даже при большом кэше тендера', () => {
  // Ветка с большим кэшем не должна выбрасывать вложения сессии.
  assert.ok(/const manualWithText = withText\.filter\(/i.test(QS),
    'нет разделения файлов РП и файлов тендера');
  assert.ok(/manualText/.test(QS), 'текст файлов РП не подмешивается в промпт');
  // Проверяем, что при большом кэше manualText не теряется.
  const cacheBranch = QS.slice(
    QS.indexOf('if (tenderDocsText.length >= TENDER_CACHE_MIN_CHARS)'),
    QS.indexOf('} else {', QS.indexOf('if (tenderDocsText.length >= TENDER_CACHE_MIN_CHARS)'))
  );
  assert.ok(/manualText/.test(cacheBranch),
    'при большом кэше тендера текст файлов РП не попадает в attachmentsText');
});

check('файлы РП помечаются источником при загрузке', () => {
  assert.ok(/source:\s*'manual'/.test(QS), 'загруженные РП файлы не помечаются source=manual');
  assert.ok(/added_by_rp:\s*true/.test(QS), 'нет флага added_by_rp');
});

check('в карточке просчёта есть поля для описания и файлов', () => {
  assert.ok(/data-rp-extra="manual_tz"/.test(CALC), 'нет поля описания работы');
  assert.ok(/data-rp-extra-input/.test(CALC), 'нет поля выбора файлов');
  assert.ok(/uploadExtraFiles/.test(CALC), 'нет загрузки файлов');
  assert.ok(/pushManualTz/.test(CALC), 'описание не отправляется в сессию');
});

check('описание РП уходит в сессию ДО расчёта', () => {
  assert.ok(/prepareSession/.test(CALC), 'нет подготовки сессии перед расчётом');
  const wizard = fs.readFileSync(path.join(ROOT, 'public/assets/js/mimir_quick_wizard.js'), 'utf8');
  assert.ok(/onBeforeCalculate/.test(wizard), 'мастер не вызывает подготовку');
  const kanban = fs.readFileSync(path.join(ROOT, 'public/assets/js/personal_kanban.js'), 'utf8');
  assert.ok(/await opts\.onBeforeCalculate\(sessionUid\)/.test(kanban),
    'хук не вызывается перед _doCalculate');
});

check('лимит описания РП — 100 000 символов, как в подсказке', () => {
  assert.ok(/maxlength="100000"/.test(CALC), 'нет ограничения длины');
  assert.ok(/slice\(0, 100000\)/.test(fs.readFileSync(path.join(ROOT, 'src/services/mimir-tkp-quick.js'), 'utf8')),
    'сервер не ограничивает описание РП');
});

const failed = results.filter((r) => !r.ok);
console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
