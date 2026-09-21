// Сборка МУТАНТОВ для mutation-контроля гейта D-243 (НДС модалки «Подались»).
//
// Гейт tools/verify_registry_vat_from_settings.js перехватывает ОТВЕТЫ сервера (route.fulfill),
// потому что страницу отдаёт сервер — подмена файла на диске ничего не доказывает. Здесь мы
// готовим ДО-FIX версии двух файлов, которые гейт может подставить независимо друг от друга:
//
//   * registry_tab_MUTANT.js — до-фикс ВЫБОР СТАВКИ (карточка первая + сломанное чтение
//     `.value_json`). Хук `_test` остаётся, иначе гейт упадёт по «нет _test» и это не будет
//     честной проверкой.
//   * money_fmt_MUTANT.js   — до-фикс приоритет сохранённой пары над расчётом по ставке
//     (`withV = row.submission_price_with_vat`, `exV = row.submission_price`).
//
// Прогоны (подтверждают, что гейт ловит КАЖДУЮ часть правки, а не только подпись):
//   registry_tab только:  REGISTRY_TAB_PATH=%TEMP%\registry_tab_MUTANT.js  → краснеет
//   money_fmt только:     MONEY_FMT_PATH=%TEMP%\money_fmt_MUTANT.js        → краснеют V6/V7
//   оба:                  оба env-var                                      → краснеет
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const REG_SRC = path.join(ROOT, 'public', 'assets', 'js', 'registry_tab.js');
const MONEY_SRC = path.join(ROOT, 'public', 'assets', 'js', 'money_fmt.js');
const REG_OUT = path.join(os.tmpdir(), 'registry_tab_MUTANT.js');
const MONEY_OUT = path.join(os.tmpdir(), 'money_fmt_MUTANT.js');

let bad = 0;
function fail(msg) { console.error(msg); bad = 1; }
const L = (s, ...lines) => lines.join(s.includes('\r\n') ? '\r\n' : '\n');

// ── 1. registry_tab.js: выбор ставки + сборка сумм ────────────────────────
const regSrc = fs.readFileSync(REG_SRC, 'utf8');

const regGoodVat = L(regSrc,
  "    const vatSetting = await AsgardDB.getSettingNumber('vat_default_pct', { min: 0, max: 100 });",
  '    const vatPct = vatSetting != null',
  '      ? vatSetting',
  '      : ((M() && M().VAT_DEFAULT_PCT) || 22);'
);
const regBrokenVat = L(regSrc,
  '    let vatPct = Number(row.vat_pct) || (M() && M().VAT_DEFAULT_PCT) || 22;',
  '    try {',
  "      const vatSetting = await AsgardDB.get('settings', 'vat_default_pct');",
  '      const v = vatSetting ? parseFloat(vatSetting.value_json) : NaN;',
  '      if (Number.isFinite(v) && v >= 0 && v <= 100) vatPct = v;',
  '    } catch (_) { /* keep fallback */ }'
);

const regGoodSave = null; // сборка сумм в PATCH не мутируется: деньги приводит money_fmt (см. ниже)
const regBrokenSave = null;

if (!regSrc.includes(regGoodVat)) fail('registry_tab: маркер выбора ставки не найден — мутант собрать нельзя (код изменился?)');
if (!bad) {
  fs.writeFileSync(REG_OUT, regSrc.replace(regGoodVat, regBrokenVat));
  console.log('мутант записан:', REG_OUT);
}

// ── 2. money_fmt.js: приоритет сохранённой пары над расчётом по ставке ─────
const moneySrc = fs.readFileSync(MONEY_SRC, 'utf8');
const moneyGood = L(moneySrc,
  '    if (row && row.submission_price != null && Number(row.submission_price) > 0) {',
  '      exV = Number(row.submission_price);',
  '      withV = withVat(exV, pct);',
  '    } else if (row && row.submission_price_with_vat != null && Number(row.submission_price_with_vat) > 0) {'
);
const moneyBroken = L(moneySrc,
  '    if (row && row.submission_price_with_vat != null && Number(row.submission_price_with_vat) > 0) {'
);
if (!moneySrc.includes(moneyGood)) {
  fail('money_fmt: маркер приоритета сумм подачи не найден — мутант собрать нельзя (код изменился?)');
} else {
  fs.writeFileSync(MONEY_OUT, moneySrc.replace(moneyGood, moneyBroken));
  console.log('мутант записан:', MONEY_OUT);
}

process.exit(bad);
