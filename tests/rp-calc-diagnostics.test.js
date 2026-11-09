'use strict';

/**
 * Тесты модалки просчёта: баннер диагностики разбора.
 *
 * ── Что защищаем ───────────────────────────────────────────────────────────
 * Бэкенд считает, полон ли разбор ведомости (incomplete, expected_rows,
 * found_positions, generation_rounds, review_hint), но модалка их не
 * показывала — РП видел позиции и не знал, что половина ведомости потерялась.
 *
 * Проверяем три состояния баннера:
 *   • разбор неполный → красный, с числами;
 *   • нужна сверка → жёлтый;
 *   • всё хорошо → баннера нет (интерфейс не шумит).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'public', 'assets', 'js', 'rp_calc_modal.js');
const CSS = path.join(__dirname, '..', 'public', 'assets', 'css', 'rp-calc-modal.css');

const js = fs.readFileSync(JS, 'utf8');
const css = fs.readFileSync(CSS, 'utf8');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log('FAIL ' + name + ' — ' + e.message);
  }
}

/** Вытаскивает функцию из файла и исполняет её. */
function loadFunction(name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}', 'm');
  const m = re.exec(js);
  assert.ok(m, 'функция ' + name + ' не найдена в rp_calc_modal.js');
  return m[0];
}

/** Собирает окружение для вызова renderParseDiagnostics. */
function callDiagnostics(reportJson) {
  const fnSrc = loadFunction('renderParseDiagnostics');
  const helpers = `
    function parseReportJson(v) {
      if (!v) return null;
      if (typeof v === 'object') return v;
      try { return JSON.parse(v); } catch (_) { return null; }
    }
    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  `;
  const factory = new Function('state', helpers + fnSrc + '\nreturn renderParseDiagnostics(state);');
  return factory({ review: { report_json: reportJson } });
}

// ── 1. Код на месте ────────────────────────────────────────────────────────
check('баннер вызывается в оболочке модалки', () => {
  assert.ok(js.includes('renderParseDiagnostics(state)'), 'функция не вызывается');
  assert.ok(/renderParseDiagnostics\(state\)\s*\+\s*\n?\s*\(ready/.test(js),
    'баннер не вставлен перед плашкой «смета не рассчитана»');
});

check('стили баннера добавлены', () => {
  assert.ok(css.includes('.rp-calc-diag--bad'), 'нет стиля «неполный»');
  assert.ok(css.includes('.rp-calc-diag--warn'), 'нет стиля «сверка»');
});

// ── 2. Неполный разбор ─────────────────────────────────────────────────────
check('неполный разбор даёт красный баннер с числами', () => {
  const html = callDiagnostics({
    incomplete: true,
    incomplete_note: 'Ответ оборван',
    expected_rows: 673,
    found_positions: 353,
    valid_positions: 349,
    generation_rounds: 2
  });
  assert.ok(html.includes('rp-calc-diag--bad'), 'нет класса «неполный»');
  assert.ok(html.includes('Разбор неполный'), 'нет заголовка');
  assert.ok(html.includes('353'), 'нет числа найденных позиций');
  assert.ok(html.includes('673'), 'нет числа ожидаемых строк');
  assert.ok(html.includes('349'), 'нет числа годных позиций');
  assert.ok(html.includes('2 прохода'), 'нет числа проходов');
  assert.ok(html.includes('ДВ'), 'нет подсказки про вкладку ДВ');
  // Блок чисел должен существовать отдельно от пояснения.
  assert.ok(html.includes('rp-calc-diag__facts'), 'нет блока с числами');
});

check('неполный разбор без пояснения всё равно показывает баннер', () => {
  const html = callDiagnostics({ incomplete: true });
  assert.ok(html.includes('rp-calc-diag--bad'));
  assert.ok(html.includes('Разбор ведомости неполный'), 'нет запасного текста');
});

// ── 3. Сверка ──────────────────────────────────────────────────────────────
check('review_hint даёт жёлтый баннер сверки', () => {
  const html = callDiagnostics({
    review_hint: 'В документах найдено строк с объёмом: 400, в разборе позиций: 353',
    expected_rows: 400,
    found_positions: 353
  });
  assert.ok(html.includes('rp-calc-diag--warn'), 'нет класса «сверка»');
  assert.ok(html.includes('Сверьте с ведомостью'), 'нет заголовка сверки');
  assert.ok(html.includes('400'));
});

// ── 4. Чистое состояние ────────────────────────────────────────────────────
check('полный разбор не показывает баннер', () => {
  const html = callDiagnostics({
    incomplete: false,
    expected_rows: 300,
    found_positions: 300
  });
  assert.strictEqual(html, '', 'баннер показан при полном разборе');
});

check('пустой отчёт не падает и не показывает баннер', () => {
  assert.strictEqual(callDiagnostics(null), '');
  assert.strictEqual(callDiagnostics({}), '');
  assert.strictEqual(callDiagnostics('not json at all'), '');
});

// ── 5. Защита от XSS ───────────────────────────────────────────────────────
check('текст пояснения экранируется', () => {
  const html = callDiagnostics({
    incomplete: true,
    incomplete_note: '<script>alert(1)</script>'
  });
  assert.ok(!html.includes('<script>'), 'HTML не экранирован');
  assert.ok(html.includes('&lt;script&gt;'), 'нет экранирования');
});

// ── 6. Кодировка ───────────────────────────────────────────────────────────
check('нет mojibake в модалке и стилях', () => {
  // Признак двойной перекодировки: символы псевдографики вплотную к русским
  // буквам. Проверяем код-поинтами, чтобы тест сам не содержал артефактов.
  const MOJI = /\u2568|\u2564|\u2565|\u2560/; // ╨ ╤ ╥ ╠
  const REPL = '\uFFFD';
  for (const [name, text] of [['JS', js], ['CSS', css]]) {
    assert.ok(!MOJI.test(text), 'mojibake в ' + name);
    assert.ok(!text.includes(REPL), 'символы замены в ' + name);
  }
});

check('диагностика переносится из ответа API в отчёт (проводка)', () => {
  // ГЛАВНЫЙ дефект: без переноса полей баннер в модалке не появится никогда.
  // На проде `incomplete`/`review_hint` были 0 из 219 записей — код работал,
  // а пользователь баннера не видел.
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'assets', 'js', 'rp_review_modal.js'), 'utf8'
  );
  for (const field of ['incomplete', 'incomplete_note', 'review_hint',
    'expected_rows', 'found_positions', 'generation_rounds']) {
    assert.ok(
      new RegExp('reportJson\\.' + field + '\\s*=').test(src),
      'поле ' + field + ' не переносится в отчёт'
    );
  }
});

check('модалка не подставляет дефолтную наценку', () => {
  // Иначе бэкенд не отличает ручной ввод от дефолта и ступень не включается.
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'assets', 'js', 'rp_calc_modal.js'), 'utf8'
  );
  assert.ok(!/params:\s*\(seed && seed\.params\)\s*\|\|\s*\(sm\.DEFAULT_PARAMS/.test(src),
    'модалка всё ещё копирует DEFAULT_PARAMS целиком');
});

const failed = results.filter((r) => !r.ok);
console.log('');
console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
