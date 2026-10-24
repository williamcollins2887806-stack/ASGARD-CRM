const path = require('path');
const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'node_modules/dotenv')).config({ path: path.join(ROOT, '.env') });
const { extractInvoice } = require(path.join(ROOT, 'src/services/invoice-extract.js'));

const cases = [
  {
    name: 'Утилизация 276 (текстовый слой)',
    text: `Счет на оплату No 276 от 22 октября 2026 г.\nПоставщик (Исполнитель): ООО "УТИЛИЗАЦИЯ ОТХОДОВ", ИНН 6101006049, КПП 610101001\nВсего к оплате: 62 850,00`
  },
  {
    name: 'С № (обычный)',
    text: `Счет на оплату № 276 от 22.10.2026 г.\nПоставщик: ООО "Тест", ИНН 6101006049\nВсего к оплате: 62 850,00`
  },
  {
    name: 'Счёт-договор',
    text: `Счёт-договор № АТЧ-26796 от 21.10.2026\nПоставщик: ООО Акватрио, ИНН 7734415435\nВсего к оплате: 129 125,00`
  },
  {
    name: 'N с точкой',
    text: `Счет N. 4455 от 05.09.2026\nИНН 7704217370\nВсего к оплате: 1 234,56`
  },
  {
    name: 'Хеш',
    text: `Счет # 9981 от 14.10.2026\nИНН 7718979307\nВсего к оплате: 230 580,00`
  }
];

let pass = 0;
for (const c of cases) {
  const r = extractInvoice(c.text, { ownInn: '7736244785' });
  const ok = !!r.invoice_number;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}`);
  console.log(`      номер="${r.invoice_number}" дата=${r.invoice_date} ИНН=${r.inn} сумма=${r.amount_gross}`);
}
console.log(`\n${pass}/${cases.length} — номер счёта извлекается`);
if (pass < cases.length) process.exitCode = 1;
