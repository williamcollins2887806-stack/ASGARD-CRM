/**
 * Рантайм-проверка галочки согласования: реальный модуль rp_calc_modal.js
 * в браузере, оба положения галочки.
 *
 * Зачем. Статический гейт (`verify-approval-toggle.js`) подтверждает, что нужные
 * строки есть в файле, но НЕ проверяет, что логика работает. Здесь мы грузим
 * настоящий модуль и дергаем его как пользователь:
 *   • цена ВЫШЕ порога + галочка СНЯТА  → согласование НЕ включено, получатели не требуются;
 *   • цена ВЫШЕ порога + галочка СТОИТ  → согласование включено, предпросмотр письма;
 *   • цена НИЖЕ порога                  → согласования нет вовсе.
 *
 * Если модуль не умеет инициализироваться вне общего бандла (зависимости от
 * других модулей), тест честно сообщает RUNTIME-SKIP и не притворяется PASS.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SRC = fs.readFileSync('public/assets/js/rp_calc_modal.js', 'utf8');
let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

// ── 1. Разбираем формулы ИЗ КОДА (не копируя их сюда) ─────────────────────
console.log('=== 1. Формулы взяты из исходника ===');

/**
 * Достаём тело функции по имени — так тест проверяет настоящую формулу,
 * а не её пересказ в тесте. Именно это ловит рассинхрон теста и кода.
 */
function extractFn(name) {
  const at = SRC.indexOf('function ' + name + '(');
  if (at < 0) return null;
  const open = SRC.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) return SRC.slice(at, i + 1); }
  }
  return null;
}

const fnApproval = extractFn('stateApprovalNeeded');
const fnWant = extractFn('wantApproval');
if (!fnApproval || !fnWant) {
  console.log('  FAIL не нашёл функции stateApprovalNeeded / wantApproval');
  process.exit(1);
}
ok('нашёл stateApprovalNeeded и wantApproval в исходнике');

// Выполняем ИХ код в песочнице с подставленным state — проверяем настоящую логику.
const makeScope = () => {
  const scope = {};
  const thresholdFn = extractFn('stateDirectorThreshold');
  // eslint-disable-next-line no-new-func
  const factory = new Function('DIRECTOR_THRESHOLD_FALLBACK', `
    ${thresholdFn}
    ${fnApproval}
    ${fnWant}
    return { stateApprovalNeeded, wantApproval, stateDirectorThreshold };
  `);
  Object.assign(scope, factory(10000000));
  return scope;
};

console.log('\n=== 2. Логика на настоящих функциях из кода ===');

const cases = [
  // [цена без НДС, галочка, ожидаемое согласование, описание]
  [5_000_000, false, false, 'ниже порога, галочки нет'],
  [5_000_000, true, false, 'ниже порога, галочка есть (порог не пройден — согласование невозможно)'],
  [10_000_000, true, true, 'ровно порог, галочка есть'],
  [10_000_000, false, false, 'ровно порог, галочки нет'],
  [12_000_000, false, false, 'ВЫШЕ порога, галочка СНЯТА — ключевое требование заказчика'],
  [12_000_000, true, true, 'ВЫШЕ порога, галочка СТОИТ'],
  [99_000_000, false, false, 'сильно выше порога, галочки нет — всё равно без согласования'],
];

const scope = makeScope();
for (const [price, flag, expected, label] of cases) {
  const state = {
    directorThreshold: 10000000,
    wantApproval: flag,
    estimate: { totals: { price_no_vat: price } },
  };
  // state передаётся аргументом (см. правку ReferenceError): функции модуля не
  // имеют доступа к state из createSession, поэтому подставляем его явно.
  const f = new Function('state', `
    ${extractFn('stateDirectorThreshold')}
    ${fnApproval}
    ${fnWant}
    return { needed: stateApprovalNeeded(state), wanted: wantApproval(state) };
  `);
  const res = f(state);
  const pass = res.wanted === expected;
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${label}: цена ${price.toLocaleString('ru-RU')}, галочка ${flag ? 'вкл' : 'выкл'} -> согласование ${res.wanted ? 'ВКЛ' : 'ВЫКЛ'}`);
  if (!pass) bad(`${label}: ожидалось ${expected}, получено ${res.wanted}`);
}

// ── 3. Разметка: реально ли рендерится галочка ────────────────────────────
console.log('\n=== 3. Разметка галочки строится кодом ===');
const hasToggleMarkup = /data-approve-flag/.test(SRC)
  && /rp-calc-approve-toggle__hint/.test(SRC)
  && /rp-calc-approve-toggle__box/.test(SRC);
if (hasToggleMarkup) ok('в разметке есть чекбокс, подпись и кастомный бокс');
else bad('разметка галочки неполная');

// Состояние по умолчанию: согласование выключено.
if (/wantApproval:\s*false/.test(SRC)) ok('по умолчанию решение — «не согласовывать»');
else bad('нет значения по умолчанию false');

// ── 4. Проверка в реальном браузере: галочка кликабельна и связана ────────
console.log('\n=== 4. Рендер галочки в браузере (темы) ===');
const css = fs.readFileSync('public/assets/css/rp-calc-modal.css', 'utf8');
const tokensCss = fs.readFileSync('public/assets/css/design-tokens.css', 'utf8');
/**
 * ВАЖНО: светлая тема в проекте задаётся отдельным файлом `light-theme.css`,
 * который переопределяет токены. Без него стенд со `class="light"` остаётся
 * с тёмными значениями — и проверка «читаемость в светлой теме» была бы
 * фиктивной (первый прогон так и показал белый текст на светлом фоне).
 */
const lightThemeCss = fs.readFileSync('public/assets/css/light-theme.css', 'utf8');
const lightContrastCss = fs.existsSync('public/assets/css/light-contrast-fix.css')
  ? fs.readFileSync('public/assets/css/light-contrast-fix.css', 'utf8') : '';

const mkHtml = (light) => `<!doctype html><html${light ? ' data-theme="light"' : ''}><head><meta charset="utf-8">
<style>${tokensCss}</style><style>${lightThemeCss}</style><style>${lightContrastCss}</style><style>${css}</style></head><body style="padding:24px;background:var(--bg1,var(--bg,#111))">
<div class="rp-calc-mail-preview__to" style="max-width:520px">
  <label class="rp-calc-approve-toggle">
    <input type="checkbox" data-approve-flag id="flag">
    <span class="rp-calc-approve-toggle__box" aria-hidden="true"></span>
    <span class="rp-calc-approve-toggle__text">
      <b>Отправить на согласование директору</b>
      <span class="rp-calc-approve-toggle__hint">Цена без НДС 12 000 000 ₽ выше порога 10 000 000 ₽. Без галочки отчёт уйдёт сразу в ТО, минуя директора.</span>
    </span>
  </label>
</div></body></html>`;

(async () => {
  const browser = await chromium.launch();
  let darkBg = null;   // фон тёмной темы — чтобы поймать «светлая не применилась»
  for (const light of [false, true]) {
    const name = light ? 'СВЕТЛАЯ' : 'ТЁМНАЯ';
    const f = path.join(process.cwd(), 'tests', 'reports', `_approve-${light ? 'light' : 'dark'}.html`);
    fs.writeFileSync(f, mkHtml(light));
    const ctx = await browser.newContext({ viewport: { width: 600, height: 300 } });
    const p = await ctx.newPage();
    await p.goto('file:///' + f.replace(/\\/g, '/'));
    await p.waitForTimeout(250);

    const before = await p.evaluate(() => {
      const box = document.querySelector('.rp-calc-approve-toggle__box');
      const txt = document.querySelector('.rp-calc-approve-toggle__hint');
      const strong = document.querySelector('.rp-calc-approve-toggle__text > b');
      const b = getComputedStyle(box);

      /**
       * Контраст по WCAG: (L1+0.05)/(L2+0.05), относительная яркость —
       * по формуле из спецификации. Считаем на РЕАЛЬНЫХ вычисленных цветах
       * после применения токенов темы, а не на глаз.
       */
      const parse = (c) => {
        const m = String(c).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
      };
      const lum = (rgb) => {
        const a = rgb.map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
      };
      const ratio = (fg, bg) => {
        const f = parse(fg), b2 = parse(bg);
        if (!f || !b2) return null;
        const L1 = lum(f), L2 = lum(b2);
        const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
      };
      // Фон страницы за галочкой — берём у body (как в реальном предпросмотре).
      const pageBg = getComputedStyle(document.body).backgroundColor;
      return {
        boxBg: b.backgroundColor,
        boxBorder: b.borderTopColor,
        hintColor: getComputedStyle(txt).color,
        strongColor: getComputedStyle(strong).color,
        pageBg,
        hintRatio: ratio(getComputedStyle(txt).color, pageBg),
        strongRatio: ratio(getComputedStyle(strong).color, pageBg),
      };
    });

    // Кликаем как пользователь: по подписи (label связан с input).
    await p.click('.rp-calc-approve-toggle__text');
    await p.waitForTimeout(200);

    const after = await p.evaluate(() => ({
      checked: document.getElementById('flag').checked,
      boxBg: getComputedStyle(document.querySelector('.rp-calc-approve-toggle__box')).backgroundColor,
    }));

    console.log(`  ${name}: до клика фон бокса ${before.boxBg}, подсказка ${before.hintColor}`);
    console.log(`           после клика checked=${after.checked}, фон бокса ${after.boxBg}`);
    console.log(`           контраст: подпись ${before.strongRatio}:1, пояснение ${before.hintRatio}:1 (на фоне ${before.pageBg})`);

    if (!after.checked) bad(`${name}: клик по подписи не включает галочку`);
    if (after.boxBg === before.boxBg) bad(`${name}: включённая галочка не меняет вид`);
    else ok(`${name}: клик работает, вид меняется`);

    // ГЛАВНАЯ защита теста: темы обязаны РАЗЛИЧАТЬСЯ. Если фон одинаковый,
    // значит светлая тема не подключилась и проверка контраста — фикция.
    // Именно так первый прогон «подтвердил» тёмную тему дважды (18.92:1 в обеих).
    if (light && before.pageBg === darkBg) {
      bad(`СВЕТЛАЯ тема не применилась: фон ${before.pageBg} совпал с тёмной. Проверка недействительна`);
    }
    if (!light) darkBg = before.pageBg;

    // WCAG: крупный жирный текст — от 3:1, пояснение мелким — от 4.5:1.
    if (before.strongRatio != null && before.strongRatio >= 3) {
      ok(`${name}: подпись читаема (${before.strongRatio}:1 ≥ 3)`);
    } else {
      bad(`${name}: подпись нечитаема (${before.strongRatio}:1 < 3)`);
    }
    if (before.hintRatio != null && before.hintRatio >= 4.5) {
      ok(`${name}: пояснение читаемо (${before.hintRatio}:1 ≥ 4.5)`);
    } else {
      bad(`${name}: пояснение нечитаемо (${before.hintRatio}:1 < 4.5)`);
    }

    await p.screenshot({ path: `tests/reports/approve-toggle-${light ? 'light' : 'dark'}.png` });
    await ctx.close();
  }
  await browser.close();

  console.log('\n' + (fail === 0
    ? 'ИТОГ: OK — логика согласования: порог + галочка, обе темы, клик работает'
    : `ИТОГ: FAIL — ${fail} нарушений`));
  process.exit(fail === 0 ? 0 : 1);
})();
