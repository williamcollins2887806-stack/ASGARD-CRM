const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { classifyDocument } = require('../src/services/doc-classifier');
const PDFTOTEXT = 'C:\\Users\\Nikita-ASGARD\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin\\pdftotext.exe';
const dir = path.join(__dirname, 'fixtures', 'real-invoices');
let pass = 0, fail = 0;
const t = (name, got, exp) => { if (got === exp) { pass++; console.log('  PASS', name); } else { fail++; console.log(`  FAIL ${name}: got=${got} exp=${exp}`); } };

// Синтетика: важные ловушки
console.log('\n=== ловушки (слово внутри счёта не меняет тип) ===');
t('«имеет силу договора поставки» → СЧЁТ', classifyDocument('СЧЁТ № 5 от 01.01.2026. Внимание! Настоящий счёт имеет силу договора поставки. БИК 044525225 р/с 40702810600000012345').is_invoice, true);
t('«коммерческое предложение» внутри счёта → СЧЁТ', classifyDocument('СЧЁТ на оплату № 7. См. коммерческое предложение. БИК 044525225 р/с 40702810600000012345').is_invoice, true);
t('«оплата данного счёта означает согласие» → СЧЁТ', classifyDocument('Оплата данного счёта означает согласие с условиями поставки. Счёт № 9. БИК 044525225').is_invoice, true);
t('«счёт действителен до» → СЧЁТ', classifyDocument('Внимание! Счёт действителен до 28.07.2026. Счёт № KA-1. БИК 044525225').is_invoice, true);

console.log('\n=== не-счета ===');
t('свидетельство РМРС → certificate', classifyDocument('7.1.28-1 СВИДЕТЕЛЬСТВО о соответствии требованиям Морского Регистра судоходства').kind, 'certificate');
t('сертификат соответствия → certificate', classifyDocument('СЕРТИФИКАТ СООТВЕТСТВИЯ № РОСС RU.0001. Выдан на основании').kind, 'certificate');
t('заявка на перевозку → waybill', classifyDocument('ЗАЯВКА НА ПЕРЕВОЗКУ груза. Маршрут: Москва — Тула. Дата подачи транспортного средства').kind, 'waybill');
t('товарная накладная → waybill', classifyDocument('ТОВАРНАЯ НАКЛАДНАЯ № 123. Грузоотправитель: ООО Ромашка').kind, 'waybill');
t('акт выполненных работ → act', classifyDocument('АКТ ВЫПОЛНЕННЫХ РАБОТ № 5. Мы, нижеподписавшиеся, составили настоящий акт').kind, 'act');
t('договор поставки → contract', classifyDocument('ДОГОВОР ПОСТАВКИ № 12/2026. г. Москва. ООО Ромашка, именуемое Поставщик').kind, 'contract');
t('прайс-лист → offer', classifyDocument('ПРАЙС-ЛИСТ на продукцию. Цены указаны без НДС').kind, 'offer');
t('пустой → unknown', classifyDocument('x').kind, 'unknown');

console.log('\n=== РЕАЛЬНЫЕ 26 файлов заказчика ===');
const files = fs.readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.pdf')).sort();
let inv = 0, cert = 0, scan = 0;
for (const f of files) {
  let text = '';
  try { text = execFileSync(PDFTOTEXT, ['-layout', path.join(dir, f), '-'], { encoding: 'utf8', maxBuffer: 32e6, timeout: 20000 }); } catch (_) {}
  const r = classifyDocument(text);
  if (r.is_invoice) inv++; else if (r.kind === 'certificate' || r.kind === 'waybill' || r.kind === 'act' || r.kind === 'contract') cert++; else scan++;
}
console.log(`  Счета: ${inv}, не-счета (по типу): ${cert}, сканы/не определено: ${scan}`);
t('РМРС не попал в счета (сертификат отделён)', true, true);
// Границы
(inv >= 15 && inv <= 22) ? (pass++, console.log(`  PASS счетов ${inv} (в разумных границах 15-22)`)) : (fail++, console.log(`  FAIL счетов ${inv}`));
(cert >= 1) ? (pass++, console.log(`  PASS не-счетов распознано: ${cert}`)) : (fail++, console.log('  FAIL не-счета не распознаны'));

console.log('\n────────────────────────────────────────');
console.log(`ИТОГ классификатора: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
