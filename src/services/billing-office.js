/**
 * Word / Excel выгрузка счетов и актов + факсимиле печати/подписи.
 * Шаблоны: templates/billing/invoice-tpl.docx, act-tpl.docx (бланки пользователя + логотип).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const billing = require('./billing-docs');

const ROOT = path.join(__dirname, '..', '..');
const IMG_DIR = path.join(ROOT, 'public', 'assets', 'img');
const TPL = {
  invoice: path.join(ROOT, 'templates', 'billing', 'invoice-tpl.docx'),
  act: path.join(ROOT, 'templates', 'billing', 'act-tpl.docx')
};

function facsimileOpts(src) {
  src = src || {};
  return { stamp: billing.flagOn(src, 'stamp'), signature: billing.flagOn(src, 'signature') };
}

function imgFile(name) {
  const p = path.join(IMG_DIR, name);
  return fs.existsSync(p) ? p : '';
}

function imgBuffer(name) {
  const p = imgFile(name);
  return p ? fs.readFileSync(p) : null;
}

function contentDisposition(filename) {
  const ascii = String(filename).replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function partyLine(name, inn, kpp, address, extra) {
  return [
    name || '—',
    inn ? `ИНН ${inn}` : null,
    kpp ? `КПП ${kpp}` : null,
    address || null,
    extra || null
  ].filter(Boolean).join(', ');
}

function buildView(kind, doc, company) {
  const isAct = kind === 'act';
  const co = billing.mergeIssuer(company || {}, doc && (doc.issuer_json || doc.issuer));
  const itemsRaw = billing.parseItems(doc.items_json || doc.items);
  const vatPct = Number(doc.vat_pct != null ? doc.vat_pct : 22);
  const totals = billing.calcTotals(itemsRaw, vatPct);
  const rows = totals.items || [];
  const amount = Number(doc.amount != null ? doc.amount : totals.amount);
  const vatAmount = Number(doc.vat_amount != null ? doc.vat_amount : totals.vat_amount);
  const total = Number(doc.total_amount != null ? doc.total_amount : totals.total_amount);
  const number = isAct ? (doc.act_number || `АКТ-${doc.id || ''}`) : (doc.invoice_number || `СЧ-${doc.id || ''}`);
  const date = billing.fmtDate(isAct ? doc.act_date : doc.invoice_date);
  const items = rows.map((it, i) => ({
    n: i + 1,
    name: it.name || '—',
    unit: it.unit || 'усл.',
    qty: String(it.qty ?? 0),
    price: billing.fmtMoney(it.price),
    sum: billing.fmtMoney(it.total)
  }));
  return {
    isAct,
    co,
    number,
    date,
    items,
    amount: billing.fmtMoney(amount),
    vat_pct: String(vatPct),
    vat_amount: billing.fmtMoney(vatAmount),
    total: billing.fmtMoney(total),
    totalNum: total,
    items_count: String(items.length),
    total_words: billing.numberToWordsRu(total),
    due_date: doc.due_date ? billing.fmtDate(doc.due_date) : '—',
    basis: doc.description || doc.subject || '—',
    executor_line: partyLine(
      co.full_name || co.name,
      co.inn,
      co.kpp,
      co.address || co.legal_address,
      co.phone
    ),
    customer_line: partyLine(
      doc.customer_name,
      doc.customer_inn,
      doc.customer_kpp,
      doc.customer_address,
      doc.contact_phone
    ),
    customer_name: doc.customer_name || '—',
    customer_signer: doc.contact_person || 'уполномоченное лицо',
    director: co.director_name || co.director || '',
    director_title: co.director_title || 'Генеральный директор',
    accountant: co.accountant_name || co.accountant || '',
    company_full: co.full_name || co.name || 'ООО «Асгард-Сервис»',
    inn: co.inn || '',
    kpp: co.kpp || '',
    bank_name: co.bank_name || '',
    bank_bik: co.bank_bik || '',
    bank_rs: co.bank_rs || '',
    bank_ks: co.bank_ks || '',
    bank_city: ''
  };
}

function loadOfficeLibs() {
  let Docxtemplater;
  let PizZip;
  let ImageModule;
  try {
    Docxtemplater = require('docxtemplater');
    PizZip = require('pizzip');
    ImageModule = require('docxtemplater-image-module-free');
  } catch (e) {
    throw new Error('Нужны docxtemplater, pizzip, docxtemplater-image-module-free: ' + (e.message || e));
  }
  return { Docxtemplater, PizZip, ImageModule };
}

function pngSize(buf) {
  if (!buf || buf.length < 24 || buf[0] !== 0x89) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function fitBox(buf, maxW, maxH) {
  const s = pngSize(buf);
  if (!s || !s.w || !s.h) return [maxW, maxH];
  const r = Math.min(maxW / s.w, maxH / s.h);
  return [Math.max(1, Math.round(s.w * r)), Math.max(1, Math.round(s.h * r))];
}

function imageModuleOpts(flags) {
  const logo = imgBuffer('asgard_logo.png') || imgBuffer('logo.png');
  const stamp = flags.stamp ? imgBuffer('stamp.png') : null;
  const signature = flags.signature ? imgBuffer('signature.png') : null;
  const { ImageModule } = loadOfficeLibs();
  return new ImageModule({
    centered: false,
    getImage(_tagValue, tagName) {
      if (tagName === 'logo_img') return logo || Buffer.alloc(0);
      if (tagName === 'stamp_img') return stamp || Buffer.alloc(0);
      if (tagName === 'signature_img') return signature || Buffer.alloc(0);
      return Buffer.alloc(0);
    },
    getSize(img, _tagValue, tagName) {
      const buf = Buffer.isBuffer(img) ? img : (img && img.length ? Buffer.from(img) : null);
      if (tagName === 'logo_img') return fitBox(buf || logo, 196, 56);
      if (tagName === 'stamp_img') return fitBox(buf || stamp, 110, 110);
      if (tagName === 'signature_img') return fitBox(buf || signature, 150, 56);
      return [100, 100];
    }
  });
}

function generateBillingDocx(kind, doc, company, flags) {
  flags = facsimileOpts(flags);
  const tpl = TPL[kind === 'act' ? 'act' : 'invoice'];
  if (!fs.existsSync(tpl)) {
    throw new Error('Шаблон Word не найден: ' + tpl);
  }
  const { Docxtemplater, PizZip } = loadOfficeLibs();
  const view = buildView(kind, doc, company);
  const zip = new PizZip(fs.readFileSync(tpl));
  const docx = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    modules: [imageModuleOpts(flags)],
    nullGetter() { return ''; }
  });
  docx.render({
    logo_img: !!(imgBuffer('asgard_logo.png') || imgBuffer('logo.png')),
    stamp_img: !!(flags.stamp && imgBuffer('stamp.png')),
    signature_img: !!(flags.signature && imgBuffer('signature.png')),
    number: view.number,
    date: view.date,
    bank_name: view.bank_name,
    bank_bik: view.bank_bik,
    bank_ks: view.bank_ks,
    bank_rs: view.bank_rs,
    bank_city: view.bank_city,
    inn: view.inn,
    kpp: view.kpp,
    company_full: view.company_full,
    executor_line: view.executor_line,
    customer_line: view.customer_line,
    customer_name: view.customer_name,
    customer_signer: view.customer_signer,
    basis: view.basis,
    items: view.items,
    amount: view.amount,
    vat_pct: view.vat_pct,
    vat_amount: view.vat_amount,
    total: view.total,
    items_count: view.items_count,
    total_words: view.total_words,
    due_date: view.due_date,
    director: view.director,
    director_title: view.director_title,
    accountant: view.accountant
  });
  return docx.getZip().generate({ type: 'nodebuffer' });
}

async function generateBillingXlsx(kind, doc, company, flags) {
  flags = facsimileOpts(flags);
  const view = buildView(kind, doc, company);
  const isAct = kind === 'act';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'АСГАРД CRM';
  const ws = wb.addWorksheet(isAct ? 'Акт' : 'Счёт', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.4, top: 0.5, bottom: 0.5 }
    }
  });
  ws.columns = [
    { width: 6 }, { width: 42 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 16 }
  ];
  const NAVY = 'FF1E4D8C';
  const GREY = 'FF6B7280';
  const DARK = 'FF1A1A1A';
  const thin = { style: 'thin', color: { argb: 'FFCBD2DE' } };
  const allBorder = { top: thin, bottom: thin, left: thin, right: thin };
  let r = 1;

  const logoPath = imgFile('asgard_logo.png') || imgFile('logo.png');
  if (logoPath) {
    const logoBuf = fs.readFileSync(logoPath);
    const [lw, lh] = fitBox(logoBuf, 196, 56);
    const imgId = wb.addImage({ filename: logoPath, extension: 'png' });
    ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: lw, height: lh } });
    ws.getRow(1).height = Math.max(46, Math.round(lh * 0.75));
    r = 3;
  }

  ws.mergeCells(`A${r}:F${r}`);
  const title = ws.getCell(`A${r}`);
  title.value = isAct ? 'АКТ сдачи-приёмки выполненных работ' : 'СЧЁТ НА ОПЛАТУ';
  title.font = { bold: true, size: 16, color: { argb: NAVY } };
  title.alignment = { horizontal: 'center' };
  ws.getRow(r).height = 24;
  r++;
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = `№ ${view.number}  от  ${view.date}`;
  ws.getCell(`A${r}`).alignment = { horizontal: 'center' };
  ws.getCell(`A${r}`).font = { size: 11, color: { argb: DARK } };
  r += 2;

  if (!isAct) {
    ws.mergeCells(`A${r}:D${r}`);
    ws.getCell(`A${r}`).value = `Банк получателя: ${view.bank_name}`;
    ws.getCell(`E${r}`).value = 'БИК';
    ws.getCell(`F${r}`).value = view.bank_bik;
    r++;
    ws.mergeCells(`A${r}:D${r}`);
    ws.getCell(`A${r}`).value = `Получатель: ${view.company_full}`;
    ws.getCell(`E${r}`).value = 'Р/с';
    ws.getCell(`F${r}`).value = view.bank_rs;
    r++;
    ws.mergeCells(`A${r}:F${r}`);
    ws.getCell(`A${r}`).value = `ИНН ${view.inn}  КПП ${view.kpp}  К/с ${view.bank_ks}`;
    ws.getCell(`A${r}`).font = { size: 9, color: { argb: GREY } };
    r += 2;
  }

  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = (isAct ? 'Исполнитель: ' : 'Поставщик: ') + view.executor_line;
  r++;
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = (isAct ? 'Заказчик: ' : 'Покупатель: ') + view.customer_line;
  r++;
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = 'Основание: ' + view.basis;
  r += 2;

  const head = ['№', 'Наименование', 'Ед.', 'Кол-во', 'Цена', 'Сумма'];
  head.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.border = allBorder;
    cell.alignment = { horizontal: i <= 1 ? 'left' : 'right' };
  });
  r++;
  view.items.forEach((it) => {
    const vals = [it.n, it.name, it.unit, it.qty, it.price, it.sum];
    vals.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = v;
      cell.border = allBorder;
      cell.font = { size: 9 };
      cell.alignment = { horizontal: i <= 1 ? 'left' : 'right', wrapText: true };
    });
    r++;
  });
  r++;
  const totals = [
    ['Итого без НДС', view.amount + ' ₽'],
    [`НДС ${view.vat_pct}%`, view.vat_amount + ' ₽'],
    [isAct ? 'Всего с НДС' : 'Всего к оплате', view.total + ' ₽']
  ];
  totals.forEach((row, idx) => {
    ws.mergeCells(`A${r}:E${r}`);
    ws.getCell(`A${r}`).value = row[0];
    ws.getCell(`A${r}`).alignment = { horizontal: 'right' };
    ws.getCell(`A${r}`).font = { bold: idx === 2, size: idx === 2 ? 12 : 10 };
    ws.getCell(`F${r}`).value = row[1];
    ws.getCell(`F${r}`).font = { bold: idx === 2 };
    r++;
  });
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = view.total_words;
  ws.getCell(`A${r}`).font = { italic: true, size: 9, color: { argb: GREY } };
  r += 2;

  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = isAct ? 'Работы сдал (Исполнитель)' : view.director_title;
  ws.getCell(`A${r}`).font = { bold: true, size: 10 };
  ws.mergeCells(`D${r}:F${r}`);
  ws.getCell(`D${r}`).value = isAct ? 'Работы принял (Заказчик)' : 'Главный бухгалтер';
  ws.getCell(`D${r}`).font = { bold: true, size: 10 };
  const signRow = r;
  r += 4;
  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = `_________________ / ${view.director} /`;
  ws.mergeCells(`D${r}:F${r}`);
  ws.getCell(`D${r}`).value = isAct
    ? `_________________ / ${view.customer_signer} /`
    : `_________________ / ${view.accountant} /`;

  const stampPath = flags.stamp ? imgFile('stamp.png') : '';
  const sigPath = flags.signature ? imgFile('signature.png') : '';
  if (sigPath) {
    const [sw, sh] = fitBox(fs.readFileSync(sigPath), 150, 56);
    const id = wb.addImage({ filename: sigPath, extension: 'png' });
    ws.addImage(id, {
      tl: { col: 0.2, row: signRow },
      ext: { width: sw, height: sh }
    });
  }
  if (stampPath) {
    const [tw, th] = fitBox(fs.readFileSync(stampPath), 110, 110);
    const id = wb.addImage({ filename: stampPath, extension: 'png' });
    ws.addImage(id, {
      tl: { col: 1.6, row: signRow - 0.2 },
      ext: { width: tw, height: th }
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function suggestedFilename(kind, doc, ext) {
  const isAct = kind === 'act';
  const num = isAct ? (doc.act_number || doc.id) : (doc.invoice_number || doc.id);
  const safe = String(num || '').replace(/[\\/:*?"<>|]+/g, '_');
  return `${isAct ? 'Akt' : 'Schet'}_${safe}.${ext}`;
}

async function sendOffice(reply, kind, doc, company, flags, fmt) {
  try {
    const ext = fmt === 'xlsx' ? 'xlsx' : 'docx';
    const buf = ext === 'xlsx'
      ? await generateBillingXlsx(kind, doc, company, flags)
      : generateBillingDocx(kind, doc, company, flags);
    reply.header(
      'Content-Type',
      ext === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    reply.header('Content-Disposition', contentDisposition(suggestedFilename(kind, doc, ext)));
    return reply.send(buf);
  } catch (err) {
    return reply.code(500).send({
      success: false,
      message: err.message || 'Не удалось сформировать файл'
    });
  }
}

module.exports = {
  facsimileOpts,
  imgFile,
  contentDisposition,
  generateBillingDocx,
  generateBillingXlsx,
  suggestedFilename,
  sendOffice,
  buildView
};
