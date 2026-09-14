/**
 * Общая логика конструктора счетов и актов: позиции, итоги, PDF (кириллица).
 */
'use strict';

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { registerDejaVuFonts } = require('../lib/pdf-fonts');

const IMG_DIR = path.join(__dirname, '..', '..', 'public', 'assets', 'img');

const INV_COLS = new Set([
  'invoice_number', 'invoice_date', 'invoice_type', 'status',
  'work_id', 'act_id', 'contract_id', 'customer_id',
  'customer_name', 'customer_inn', 'customer_kpp', 'customer_address',
  'contact_person', 'contact_email', 'contact_phone',
  'description', 'notes',
  'amount', 'vat_pct', 'vat_amount', 'total_amount',
  'due_date', 'paid_amount', 'items_json', 'issuer_json', 'created_by'
]);

const ACT_COLS = new Set([
  'act_number', 'act_date', 'act_type', 'status',
  'work_id', 'contract_id', 'customer_id',
  'customer_name', 'customer_inn', 'customer_kpp', 'customer_address',
  'contact_person', 'contact_email', 'contact_phone',
  'description', 'notes',
  'amount', 'vat_pct', 'vat_amount', 'total_amount',
  'signed_date', 'paid_date', 'items_json', 'issuer_json', 'created_by'
]);

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function strField(v) {
  return v == null ? '' : String(v).trim();
}

function parseIssuer(raw) {
  if (raw == null || raw === '') return null;
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v;
}

function normalizeIssuer(raw) {
  const p = parseIssuer(raw);
  if (!p) return null;
  const name = strField(p.name || p.company_name);
  const full_name = strField(p.full_name) || name;
  const address = strField(p.legal_address || p.address);
  const director = strField(p.director_name || p.director || p.director_fio);
  const accountant = strField(p.accountant_name || p.accountant);
  return {
    name,
    full_name,
    inn: strField(p.inn),
    kpp: strField(p.kpp),
    ogrn: strField(p.ogrn),
    legal_address: address,
    address,
    phone: strField(p.phone),
    email: strField(p.email),
    director_name: director,
    director,
    director_title: strField(p.director_title) || 'Генеральный директор',
    accountant_name: accountant,
    accountant,
    bank_name: strField(p.bank_name),
    bank_rs: strField(p.bank_rs || p.rs),
    bank_ks: strField(p.bank_ks || p.ks),
    bank_bik: strField(p.bank_bik || p.bik)
  };
}

function aliasCompany(c) {
  const x = c || {};
  const address = x.legal_address || x.address || '';
  const director = x.director_name || x.director || '';
  const accountant = x.accountant_name || x.accountant || '';
  return {
    ...x,
    legal_address: address,
    address,
    director_name: director,
    director,
    accountant_name: accountant,
    accountant
  };
}

function mergeIssuer(settings, override) {
  const base = aliasCompany(settings);
  const o = normalizeIssuer(override);
  if (!o) return base;
  return aliasCompany({
    ...base,
    ...o,
    name: o.name || base.name,
    full_name: o.full_name || o.name || base.full_name,
    director_title: o.director_title || base.director_title || 'Генеральный директор'
  });
}

function hasCustomIssuer(doc) {
  return !!parseIssuer(doc && (doc.issuer_json || doc.issuer));
}

function parseItems(raw) {
  if (!raw) return [];
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.items)) return v.items;
  return [];
}

function normalizeItem(it, idx) {
  const qty = Number(it.qty != null ? it.qty : it.quantity) || 0;
  const price = Number(it.price != null ? it.price : it.cost) || 0;
  const name = String(it.name || it.description || it.title || '').trim() || `Позиция ${idx + 1}`;
  const unit = String(it.unit || 'усл.').trim() || 'усл.';
  return { name, unit, qty, price, total: round2(qty * price) };
}

function calcTotals(items, vatPct) {
  const rows = (items || []).map((it, i) => normalizeItem(it, i));
  const amount = round2(rows.reduce((s, r) => s + r.total, 0));
  const vat_pct = Number(vatPct) || 0;
  const vat_amount = round2(amount * vat_pct / 100);
  return { items: rows, amount, vat_pct, vat_amount, total_amount: round2(amount + vat_amount) };
}

function normalizeBillingBody(body = {}, defaults = {}) {
  const items = parseItems(body.items_json || body.items);
  const vat_pct = body.vat_pct != null && body.vat_pct !== ''
    ? Number(body.vat_pct)
    : (defaults.vat_pct != null ? Number(defaults.vat_pct) : 22);
  let amount, vat_amount, total_amount, rows;
  if (items.length) {
    const t = calcTotals(items, vat_pct);
    rows = t.items;
    amount = t.amount;
    vat_amount = t.vat_amount;
    total_amount = t.total_amount;
  } else {
    rows = [];
    amount = Number(body.amount) || 0;
    vat_amount = body.vat_amount != null ? Number(body.vat_amount) : round2(amount * vat_pct / 100);
    total_amount = body.total_amount != null ? Number(body.total_amount) : round2(amount + vat_amount);
  }
  return {
    items: rows,
    items_json: rows.length ? rows : (body.items_json != null ? rows : null),
    vat_pct,
    amount,
    vat_amount,
    total_amount,
    customer_name: body.customer_name || null,
    customer_inn: body.customer_inn || null,
    customer_kpp: body.customer_kpp || null,
    customer_address: body.customer_address || body.address || null,
    customer_id: body.customer_id != null && body.customer_id !== '' ? Number(body.customer_id) : null,
    contact_person: body.contact_person || null,
    contact_email: body.contact_email || body.customer_email || null,
    contact_phone: body.contact_phone || null,
    description: body.description || null,
    notes: body.notes || null,
    work_id: body.work_id != null && body.work_id !== '' ? Number(body.work_id) : null,
    act_id: body.act_id != null && body.act_id !== '' ? Number(body.act_id) : null,
    contract_id: body.contract_id != null && body.contract_id !== '' ? Number(body.contract_id) : null,
    status: body.status || defaults.status || 'draft',
    issuer_json: ('issuer' in body || 'issuer_json' in body)
      ? (normalizeIssuer(body.issuer || body.issuer_json) || null)
      : undefined
  };
}

function toJsonParam(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      JSON.parse(v);
      return v;
    } catch {
      return JSON.stringify([]);
    }
  }
  return JSON.stringify(v);
}

function pickCols(data, allow) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (!allow.has(k) || v === undefined) continue;
    out[k] = (k === 'items_json' || k === 'issuer_json') ? toJsonParam(v) : v;
  }
  return out;
}

async function insertDoc(db, table, data) {
  const allow = table === 'acts' ? ACT_COLS : INV_COLS;
  const row = pickCols(data, allow);
  const keys = Object.keys(row);
  if (!keys.length) throw new Error('empty insert');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    keys.map((k) => row[k])
  );
  return rows[0];
}

async function updateDoc(db, table, id, data) {
  const allow = table === 'acts' ? ACT_COLS : INV_COLS;
  const row = pickCols(data, allow);
  delete row.created_by;
  const keys = Object.keys(row);
  if (!keys.length) {
    const { rows } = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    return rows[0] || null;
  }
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  const values = keys.map((k) => row[k]);
  values.push(id);
  const { rows } = await db.query(
    `UPDATE ${table} SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
    values
  );
  return rows[0] || null;
}

function flagOn(opts, key) {
  const v = opts && opts[key];
  if (v === undefined || v === null || v === '') return true;
  return !['0', 'false', 'off', 'no'].includes(String(v).toLowerCase());
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (!Number.isFinite(dt.getTime())) return '—';
  return dt.toLocaleDateString('ru-RU');
}

function numberToWordsRu(num) {
  if (!num && num !== 0) return 'Ноль рублей 00 копеек';

  const units = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const unitsFem = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

  function getForm(n, forms) {
    n = Math.abs(n) % 100;
    if (n > 10 && n < 20) return forms[2];
    n = n % 10;
    if (n === 1) return forms[0];
    if (n >= 2 && n <= 4) return forms[1];
    return forms[2];
  }

  function triplet(n, fem) {
    if (n === 0) return '';
    const parts = [];
    const h = Math.floor(n / 100);
    const remainder = n % 100;
    const t = Math.floor(remainder / 10);
    const u = remainder % 10;
    if (h > 0) parts.push(hundreds[h]);
    if (t === 1) {
      parts.push(teens[u]);
    } else {
      if (t > 1) parts.push(tens[t]);
      if (u > 0) parts.push(fem ? unitsFem[u] : units[u]);
    }
    return parts.join(' ');
  }

  const rub = Math.floor(Math.abs(num));
  const kop = Math.round((Math.abs(num) - rub) * 100);
  if (rub === 0) {
    return `Ноль рублей ${String(kop).padStart(2, '0')} ${getForm(kop, ['копейка', 'копейки', 'копеек'])}`;
  }

  const parts = [];
  const billions = Math.floor(rub / 1000000000);
  if (billions > 0) parts.push(triplet(billions, false) + ' ' + getForm(billions, ['миллиард', 'миллиарда', 'миллиардов']));
  const millions = Math.floor((rub % 1000000000) / 1000000);
  if (millions > 0) parts.push(triplet(millions, false) + ' ' + getForm(millions, ['миллион', 'миллиона', 'миллионов']));
  const thousands = Math.floor((rub % 1000000) / 1000);
  if (thousands > 0) parts.push(triplet(thousands, true) + ' ' + getForm(thousands, ['тысяча', 'тысячи', 'тысяч']));
  const remainder = rub % 1000;
  if (remainder > 0 || parts.length === 0) parts.push(triplet(remainder, false));

  const rubWord = getForm(rub, ['рубль', 'рубля', 'рублей']);
  const kopWord = getForm(kop, ['копейка', 'копейки', 'копеек']);
  let result = parts.join(' ').replace(/\s+/g, ' ').trim();
  result = result.charAt(0).toUpperCase() + result.slice(1);
  return `${result} ${rubWord} ${String(kop).padStart(2, '0')} ${kopWord}`;
}

async function loadCompany(db) {
  const fallback = {
    name: 'ООО «Асгард-Сервис»',
    full_name: 'Общество с ограниченной ответственностью «Асгард-Сервис»',
    inn: '', kpp: '', ogrn: '',
    legal_address: '', phone: '', email: '',
    director_name: '', director_title: 'Генеральный директор',
    accountant_name: '',
    bank_name: '', bank_rs: '', bank_ks: '', bank_bik: ''
  };
  try {
    const { rows } = await db.query(
      "SELECT key, value_json FROM settings WHERE key IN ('company_profile', 'app')"
    );
    let keyProfile = {};
    let appProfile = {};
    for (const r of rows) {
      const v = typeof r.value_json === 'string' ? JSON.parse(r.value_json) : (r.value_json || {});
      if (r.key === 'company_profile') keyProfile = v || {};
      if (r.key === 'app' && v && v.company_profile) appProfile = v.company_profile;
    }
    const p = { ...appProfile, ...keyProfile };
    const legal_address = p.legal_address || p.address || '';
    const director_name = p.director_name || p.director_fio || '';
    const accountant_name = p.accountant_name || '';
    return {
      ...fallback,
      name: p.company_name || p.name || fallback.name,
      full_name: p.full_name || p.company_name || p.name || fallback.full_name,
      inn: p.inn || '',
      kpp: p.kpp || '',
      ogrn: p.ogrn || '',
      legal_address,
      address: legal_address,
      phone: p.phone || '',
      email: p.email || '',
      director_name,
      director: director_name,
      director_title: p.director_title || fallback.director_title,
      accountant_name,
      accountant: accountant_name,
      bank_name: p.bank_name || '',
      bank_rs: p.bank_rs || p.rs || '',
      bank_ks: p.bank_ks || p.ks || '',
      bank_bik: p.bank_bik || p.bik || ''
    };
  } catch (_) {
    return fallback;
  }
}

function docItems(doc) {
  const rows = parseItems(doc.items_json || doc.items).map((it, i) => normalizeItem(it, i));
  if (rows.length) return rows;
  return [{
    name: doc.description || (doc.kind === 'act' ? 'Выполненные работы' : 'Работы / услуги'),
    unit: 'усл.',
    qty: 1,
    price: Number(doc.amount) || 0,
    total: Number(doc.amount) || 0
  }];
}

function generateBillingPdfBuffer(kind, doc, company = {}, opts = {}) {
  const stampOn = flagOn(opts, 'stamp');
  const sigOn = flagOn(opts, 'signature');
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: {
        Title: kind === 'act'
          ? `Акт ${doc.act_number || doc.id || ''}`
          : `Счёт ${doc.invoice_number || doc.id || ''}`,
        Author: company.name || 'АСГАРД-СЕРВИС'
      }
    });
    const fonts = registerDejaVuFonts(pdf);
    const F = fonts.regular;
    const B = fonts.bold;
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const gold = '#1E4D8C';
    const ink = '#1a1a1a';
    const muted = '#4b5563';
    const left = 48;
    const right = 547;
    const width = right - left;
    const logoPath = path.join(IMG_DIR, 'asgard_logo.png');
    const logoAlt = path.join(IMG_DIR, 'logo.png');
    if (fs.existsSync(logoPath) || fs.existsSync(logoAlt)) {
      try {
        pdf.image(fs.existsSync(logoPath) ? logoPath : logoAlt, left, 36, { height: 32 });
      } catch (_) { /* logo optional */ }
      pdf.y = 78;
    }

    const items = docItems({ ...doc, kind });
    const vatPct = Number(doc.vat_pct != null ? doc.vat_pct : 22);
    const amount = Number(doc.amount != null ? doc.amount : items.reduce((s, r) => s + r.total, 0));
    const vatAmount = Number(doc.vat_amount != null ? doc.vat_amount : round2(amount * vatPct / 100));
    const total = Number(doc.total_amount != null ? doc.total_amount : round2(amount + vatAmount));
    const number = kind === 'act' ? (doc.act_number || `АКТ-${doc.id || ''}`) : (doc.invoice_number || `СЧ-${doc.id || ''}`);
    const date = fmtDate(kind === 'act' ? doc.act_date : doc.invoice_date);

    if (kind === 'invoice' && (company.bank_name || company.bank_rs)) {
      const bankY = pdf.y;
      pdf.font(B).fontSize(8).fillColor(muted).text('Банк получателя', left, bankY, { width: 320 });
      pdf.font(B).fontSize(10).fillColor(ink).text(company.bank_name || '—', left, bankY + 12, { width: 320 });
      pdf.font(F).fontSize(8).fillColor(muted).text('БИК', left + 330, bankY, { width: 160 });
      pdf.font(F).fontSize(10).fillColor(ink).text(company.bank_bik || '—', left + 330, bankY + 12, { width: 160 });
      pdf.moveTo(left, bankY + 30).lineTo(right, bankY + 30).strokeColor('#d1d5db').stroke();
      pdf.font(B).fontSize(8).fillColor(muted).text('Получатель', left, bankY + 36, { width: 320 });
      pdf.font(B).fontSize(10).fillColor(ink).text(company.full_name || company.name || '', left, bankY + 48, { width: 320 });
      pdf.font(F).fontSize(9).fillColor(ink)
        .text(`ИНН ${company.inn || '—'}   КПП ${company.kpp || '—'}`, left, bankY + 64, { width: 320 });
      pdf.font(F).fontSize(8).fillColor(muted).text('Сч. №', left + 330, bankY + 36, { width: 160 });
      pdf.font(F).fontSize(10).fillColor(ink).text(company.bank_rs || '—', left + 330, bankY + 48, { width: 160 });
      pdf.font(F).fontSize(8).fillColor(muted).text(`К/с ${company.bank_ks || '—'}`, left, bankY + 80, { width: width });
      pdf.y = bankY + 100;
    }

    pdf.font(B).fontSize(16).fillColor(gold)
      .text(kind === 'act' ? 'АКТ сдачи-приёмки выполненных работ' : 'СЧЁТ НА ОПЛАТУ', left, pdf.y, {
        width, align: 'center'
      });
    pdf.moveDown(0.3);
    pdf.font(B).fontSize(12).fillColor(ink)
      .text(`№ ${number}  от ${date}`, { align: 'center', width });
    pdf.moveDown(0.8);

    pdf.font(B).fontSize(9).fillColor(muted).text(kind === 'act' ? 'Исполнитель:' : 'Поставщик:');
    pdf.font(F).fontSize(10).fillColor(ink)
      .text(company.full_name || company.name || 'ООО «Асгард-Сервис»');
    pdf.font(F).fontSize(9).fillColor(muted)
      .text([
        company.inn ? `ИНН ${company.inn}` : null,
        company.kpp ? `КПП ${company.kpp}` : null,
        company.legal_address || company.address || null
      ].filter(Boolean).join('  ·  '));
    pdf.moveDown(0.45);

    pdf.font(B).fontSize(9).fillColor(muted).text(kind === 'act' ? 'Заказчик:' : 'Покупатель:');
    pdf.font(F).fontSize(10).fillColor(ink).text(doc.customer_name || '—');
    pdf.font(F).fontSize(9).fillColor(muted)
      .text([
        doc.customer_inn ? `ИНН ${doc.customer_inn}` : null,
        doc.customer_kpp ? `КПП ${doc.customer_kpp}` : null,
        doc.customer_address || null
      ].filter(Boolean).join('  ·  '));
    pdf.moveDown(0.6);

    if (doc.description) {
      pdf.font(B).fontSize(9).fillColor(muted).text(kind === 'act' ? 'Основание / наименование работ:' : 'Назначение:');
      pdf.font(F).fontSize(10).fillColor(ink).text(doc.description, { width });
      pdf.moveDown(0.5);
    }

    const cols = [
      { key: 'n', title: '№', w: 28 },
      { key: 'name', title: 'Наименование', w: 230 },
      { key: 'unit', title: 'Ед.', w: 40 },
      { key: 'qty', title: 'Кол-во', w: 50 },
      { key: 'price', title: 'Цена, ₽', w: 75 },
      { key: 'sum', title: 'Сумма, ₽', w: 76 }
    ];
    let y = pdf.y;
    pdf.rect(left, y, width, 20).fill(gold);
    let x = left;
    pdf.fillColor('#ffffff').font(B).fontSize(8);
    cols.forEach((c) => {
      pdf.text(c.title, x + 3, y + 6, { width: c.w - 6, align: c.key === 'name' ? 'left' : 'center' });
      x += c.w;
    });
    y += 20;
    pdf.font(F).fontSize(8);
    items.forEach((it, i) => {
      const rowH = Math.max(20, pdf.heightOfString(String(it.name || ''), { width: 224 }) + 6);
      if (y + rowH > 740) {
        pdf.addPage();
        y = 48;
      }
      if (i % 2 === 1) pdf.rect(left, y, width, rowH).fill('#f3f4f6');
      pdf.fillColor(ink).font(F).fontSize(8);
      x = left;
      const cells = [String(i + 1), it.name, it.unit, String(it.qty), fmtMoney(it.price), fmtMoney(it.total)];
      cells.forEach((txt, ci) => {
        pdf.text(txt, x + 3, y + 4, {
          width: cols[ci].w - 6,
          align: ci <= 1 ? 'left' : 'right'
        });
        x += cols[ci].w;
      });
      y += rowH;
    });
    pdf.y = y + 8;

    const labelW = 360;
    const drawTotal = (label, value, bold) => {
      pdf.font(bold ? B : F).fontSize(bold ? 11 : 9).fillColor(bold ? gold : ink);
      pdf.text(label, left, pdf.y, { width: labelW, align: 'right' });
      pdf.text(value, left + labelW, pdf.y, { width: width - labelW, align: 'right' });
      pdf.moveDown(0.25);
    };
    drawTotal('Итого без НДС:', `${fmtMoney(amount)} ₽`, false);
    drawTotal(`НДС ${vatPct}%:`, `${fmtMoney(vatAmount)} ₽`, false);
    drawTotal(kind === 'act' ? 'Всего с НДС:' : 'Всего к оплате:', `${fmtMoney(total)} ₽`, true);

    pdf.moveDown(0.4);
    pdf.font(F).fontSize(9).fillColor(ink)
      .text(`Всего наименований ${items.length}, на сумму: ${numberToWordsRu(total)}`, { width });

    if (kind === 'invoice' && doc.due_date) {
      pdf.moveDown(0.3);
      pdf.font(B).fontSize(9).fillColor(ink).text(`Оплатить до: ${fmtDate(doc.due_date)}`);
    }

    pdf.moveDown(1.2);
    const signTop = pdf.y;
    if (kind === 'act') {
      pdf.font(B).fontSize(9).fillColor(ink).text('Сдал (Исполнитель)', left, signTop, { width: 230 });
      pdf.text('Принял (Заказчик)', left + 260, signTop, { width: 230 });
      pdf.moveDown(1.6);
      pdf.font(F).fontSize(9).fillColor(muted);
      pdf.text('_________________ / ' + (company.director_name || company.director || '            ') + ' /', left, pdf.y, { width: 230 });
      pdf.text('_________________ /                    /', left + 260, pdf.y, { width: 230 });
    } else {
      pdf.font(B).fontSize(9).fillColor(ink)
        .text(company.director_title || 'Генеральный директор', left, pdf.y, { width: 200 });
      pdf.font(F).fontSize(9).fillColor(muted)
        .text('_________________ / ' + (company.director_name || company.director || '') + ' /', left + 210, pdf.y, { width: 280 });
      pdf.moveDown(1.2);
      pdf.font(B).fontSize(9).fillColor(ink).text('Главный бухгалтер', left, pdf.y, { width: 200 });
      pdf.font(F).fontSize(9).fillColor(muted)
        .text('_________________ / ' + (company.accountant_name || company.accountant || '') + ' /', left + 210, pdf.y, { width: 280 });
    }
    try {
      const sigPath = path.join(IMG_DIR, 'signature.png');
      const stampPath = path.join(IMG_DIR, 'stamp.png');
      if (sigOn && fs.existsSync(sigPath)) {
        pdf.image(sigPath, left + 20, signTop + 8, { height: 48 });
      }
      if (stampOn && fs.existsSync(stampPath)) {
        pdf.image(stampPath, left + 150, signTop + 4, { height: 88 });
      }
    } catch (_) { /* facsimile optional */ }

    pdf.end();
  });
}

async function generateBillingPdf(db, kind, doc, opts) {
  const settings = await loadCompany(db);
  const company = mergeIssuer(settings, doc && (doc.issuer_json || doc.issuer));
  return generateBillingPdfBuffer(kind, doc, company, opts);
}

function patchFromBody(body, n) {
  const out = {};
  const direct = {
    customer_name: n.customer_name,
    customer_inn: n.customer_inn,
    customer_kpp: n.customer_kpp,
    customer_address: n.customer_address,
    customer_id: n.customer_id,
    contact_person: n.contact_person,
    contact_email: n.contact_email,
    contact_phone: n.contact_phone,
    description: n.description,
    notes: n.notes,
    work_id: n.work_id,
    act_id: n.act_id,
    contract_id: n.contract_id,
    status: n.status
  };
  for (const [k, v] of Object.entries(direct)) {
    if (k in body) out[k] = v;
  }
  if ('items' in body || 'items_json' in body) {
    out.items_json = n.items_json;
    out.amount = n.amount;
    out.vat_pct = n.vat_pct;
    out.vat_amount = n.vat_amount;
    out.total_amount = n.total_amount;
  } else if ('amount' in body || 'vat_pct' in body || 'total_amount' in body || 'vat_amount' in body) {
    out.amount = n.amount;
    out.vat_pct = n.vat_pct;
    out.vat_amount = n.vat_amount;
    out.total_amount = n.total_amount;
  }
  if ('issuer' in body || 'issuer_json' in body) {
    out.issuer_json = n.issuer_json;
  }
  return out;
}

module.exports = {
  round2,
  parseItems,
  normalizeItem,
  calcTotals,
  normalizeBillingBody,
  patchFromBody,
  insertDoc,
  updateDoc,
  loadCompany,
  generateBillingPdf,
  generateBillingPdfBuffer,
  parseIssuer,
  normalizeIssuer,
  mergeIssuer,
  hasCustomIssuer,
  fmtMoney,
  fmtDate,
  numberToWordsRu,
  flagOn,
  docItems,
  INV_COLS,
  ACT_COLS
};
