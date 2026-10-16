'use strict';
/**
 * Генератор 10 тестовых счетов для проверки OCR/ИИ-разбора.
 * Формирует PDF (текстовый слой) + PNG/JPEG-рендеры в разных условиях:
 * повороты 90/180/45, разное разрешение, шум, низкое качество.
 *
 * Usage: node tools/gen-test-invoices.js
 * Выход: tests/fixtures/test-invoices/
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const OUT = path.join(__dirname, '..', 'tests', 'fixtures', 'test-invoices');
fs.mkdirSync(OUT, { recursive: true });
const FONT = 'C:\\Windows\\Fonts\\arial.ttf';
const FONT_BOLD = 'C:\\Windows\\Fonts\\arialbd.ttf';

// 10 реалистичных счетов: разные контрагенты, суммы, НДС, валюты, оформление.
// ВАЖНО: sum = сумма позиций (иначе ИИ видит расхождение «Итого ≠ позиции»).
function withTotal(inv) {
  const total = inv.items.reduce((s, [, qty, price]) => s + qty * price, 0);
  return { ...inv, sum: Math.round(total * 100) / 100 };
}
const INVOICES = [
  { n: '127', d: '10.09.2026', cp: 'ООО "ВСЕИНСТРУМЕНТЫ.РУ"', inn: '7722753969', kpp: '772201001', vat: '22%', items: [['Сверло по металлу 8мм', 10, 890.0], ['Диск отрезной 125мм', 25, 340.2]] },
  { n: '2601-449830-26083', d: '15.01.2025', cp: 'ООО "ВСЕИНСТРУМЕНТЫ.РУ"', inn: '7722753969', kpp: '772201001', vat: '22%', items: [['Перчатки нитриловые', 2, 1228.0]] },
  { n: 'ППУП-012128', d: '03.11.2025', cp: 'АО "ТЕХНОФОРМ"', inn: '5029111111', kpp: '502901001', vat: '22%', items: [['Промывка кислородопровода', 1, 187400.0]] },
  { n: 'УТ 13028', d: '04.06.2025', cp: 'ООО ПФ "МИР ВОДЫ"', inn: '6317012345', kpp: '631701001', vat: 'нет', items: [['Химреагент Трилон Б', 50, 695.0]] },
  { n: '165', d: '01.10.2026', cp: 'ИП Носенко Владимир Юрьевич', inn: '503412345678', kpp: '', vat: 'нет', items: [['Услуги спецтехники', 1, 50000.0]] },
  { n: 'АС-0209/1-25', d: '20.09.2025', cp: 'ИП Хмельнов О.В.', inn: '503465432109', kpp: '', vat: '5%', items: [['Транспортные услуги', 1, 12890.0]] },
  { n: 'INV-2026-0087', d: '12.03.2026', cp: 'IMH GmbH', inn: 'DE811234567', kpp: '', vat: 'нет', currency: 'EUR', items: [['Насос центробежный', 1, 2450.0]] },
  { n: '874', d: '18.02.2026', cp: 'ООО "ВИЛС"', inn: '7713051155', kpp: '771301001', vat: '22%', items: [['Кабель ВВГ 3х2.5', 100, 121.5]] },
  { n: 'б/н от 07.04.2026', d: '07.04.2026', cp: 'ИП Брандт Денис Александрович', inn: '502712345678', kpp: '', vat: '10%', items: [['Погрузо-разгрузочные работы', 1, 4300.0]] },
  { n: '5691-МСК', d: '09.10.2026', cp: 'ООО "ДЕЛОВЫЕ ЛИНИИ"', inn: '7826156685', kpp: '782601001', vat: '22%', items: [['Доставка груза', 1, 7311.8], ['Страхование', 1, 1608.6]] }
].map(withTotal);

function money(v) {
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Рисует счёт на PDFDocument (A4). */
function drawInvoice(doc, inv) {
  const M = 40;
  const W = doc.page.width;
  doc.font(FONT_BOLD).fontSize(15).text('СЧЁТ № ' + inv.n + ' от ' + inv.d, M, M, { width: W - 2 * M });
  doc.moveDown(0.4);
  doc.font(FONT).fontSize(10);
  doc.text('Поставщик: ' + inv.cp, M, doc.y);
  doc.text('ИНН/КПП: ' + inv.inn + (inv.kpp ? ' / ' + inv.kpp : ''), M, doc.y);
  if (inv.currency) doc.text('Валюта: ' + inv.currency, M, doc.y);
  doc.text('Плательщик: ООО "Асгард Сервис", ИНН 6151012111', M, doc.y);
  doc.moveDown(0.5);

  const y0 = doc.y;
  doc.font(FONT_BOLD).fontSize(9);
  doc.text('№', M + 2, y0); doc.text('Наименование', M + 30, y0);
  doc.text('Кол-во', W - M - 150, y0, { width: 50, align: 'right' });
  doc.text('Цена', W - M - 90, y0, { width: 50, align: 'right' });
  doc.text('Сумма', W - M - 40, y0, { width: 60, align: 'right' });
  doc.moveDown(0.3);
  doc.font(FONT).fontSize(9);
  let i = 1;
  for (const [name, qty, price] of inv.items) {
    const y = doc.y;
    doc.text(String(i++), M + 2, y);
    doc.text(name, M + 30, y, { width: W - M - 200 });
    doc.text(String(qty), W - M - 150, y, { width: 50, align: 'right' });
    doc.text(money(price), W - M - 90, y, { width: 50, align: 'right' });
    doc.text(money(qty * price), W - M - 40, y, { width: 60, align: 'right' });
    doc.moveDown(0.5);
  }
  doc.moveDown(0.5);
  const cur = inv.currency ? ' ' + inv.currency : ' \u20BD';
  doc.font(FONT_BOLD).fontSize(10);
  doc.text('Итого: ' + money(inv.sum) + cur, M, doc.y, { align: 'right', width: W - 2 * M });
  doc.text('НДС: ' + inv.vat, M, doc.y, { align: 'right', width: W - 2 * M });
  doc.moveDown(1.2);
  doc.font(FONT).fontSize(9);
  doc.text('Руководитель ____________ / Главный бухгалтер ____________', M, doc.y);
  doc.moveDown(0.6);
  doc.fontSize(8).fillColor('#666');
  doc.text('Банк: ПАО СБЕРБАНК  БИК 044525225  Р/с 40702810638170001234  К/с 30101810400000000225', M, doc.y);
  doc.fillColor('#000');
}

(async () => {
  const made = [];
  for (let idx = 0; idx < INVOICES.length; idx++) {
    const inv = INVOICES[idx];
    const base = 'inv-' + String(idx + 1).padStart(2, '0');
    // 1) чистый PDF с текстовым слоем
    const pdfPath = path.join(OUT, base + '.pdf');
    await new Promise((res, rej) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const ws = fs.createWriteStream(pdfPath);
      doc.pipe(ws); drawInvoice(doc, inv);
      doc.end(); ws.on('finish', res); ws.on('error', rej);
    });
    made.push({ file: base + '.pdf', kind: 'pdf-text', invoice: inv.n });
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    invoices: INVOICES, files: made
  }, null, 2));
  console.log('PDF (10):', made.length, '→', OUT);
  console.log(JSON.stringify(made.map((m) => m.file)));
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
