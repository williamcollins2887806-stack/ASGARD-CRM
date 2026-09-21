// Сборка мутанта registry_tab.js для mutation-контроля гейта D-239.
// Возвращает ДО-FIX логику выбора ставки НДС: карточка первая + сломанное чтение `.value_json`.
// Хук `_test` остаётся (иначе гейт упадёт по «нет _test» и это не будет честной проверкой).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'assets', 'js', 'registry_tab.js');
const OUT = path.join(require('os').tmpdir(), 'registry_tab_MUTANT.js');

const s = fs.readFileSync(SRC, 'utf8');
const eol = s.includes('\r\n') ? '\r\n' : '\n';
const L = (...lines) => lines.join(eol);

const good = L(
  "    const vatSetting = await AsgardDB.getSettingNumber('vat_default_pct', { min: 0, max: 100 });",
  '    const vatPct = vatSetting != null',
  '      ? vatSetting',
  '      : ((M() && M().VAT_DEFAULT_PCT) || 22);'
);

const broken = L(
  '    let vatPct = Number(row.vat_pct) || (M() && M().VAT_DEFAULT_PCT) || 22;',
  '    try {',
  "      const vatSetting = await AsgardDB.get('settings', 'vat_default_pct');",
  '      const v = vatSetting ? parseFloat(vatSetting.value_json) : NaN;',
  '      if (Number.isFinite(v) && v >= 0 && v <= 100) vatPct = v;',
  '    } catch (_) { /* keep fallback */ }'
);

if (!s.includes(good)) {
  console.error('marker block NOT found — мутант собрать нельзя (код изменился?)');
  process.exit(1);
}
fs.writeFileSync(OUT, s.replace(good, broken));
console.log('мутант записан:', OUT);
