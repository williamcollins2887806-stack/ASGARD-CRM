/**
 * ASGARD CRM — Bank Statement Processor
 * Парсинг банковских выписок: CSV, 1С, Тинькофф, Сбер, Точка
 */

'use strict';

let iconv;
try { iconv = require('iconv-lite'); } catch (_) { iconv = null; }

// ── Хеш совместимый с bank_import.js (фронт) ──────────────────────────────
function generateHash(row) {
  const str = `${row.date}|${row.amount}|${(row.counterparty || '').slice(0, 30)}|${(row.description || '').slice(0, 30)}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'tx_' + Math.abs(hash).toString(36);
}

// ── Декодирование кодировки ────────────────────────────────────────────────
function decodeBuffer(buffer) {
  const text = buffer.toString('utf-8');
  // Проверяем UTF-8 BOM
  if (text.charCodeAt(0) === 0xFEFF) return text.slice(1);
  // Проверяем наличие невалидных UTF-8 символов (типичных для Windows-1251)
  if (text.includes('\ufffd') || /[\x80-\xff]{3,}/.test(buffer.toString('latin1'))) {
    if (iconv) return iconv.decode(buffer, 'win1251');
  }
  return text;
}

// ── Определение формата ────────────────────────────────────────────────────
function detectFormat(text) {
  const first500 = text.slice(0, 500);
  if (first500.includes('1CClientBankExchange')) return '1c_txt';
  if (/Дата операции.*Номер карты/i.test(first500) || /Tinkoff|Тинькофф/i.test(first500)) return 'tinkoff';
  if (/Номер документа;Дата операции;Сумма/i.test(first500) || /Сбербанк|sber/i.test(first500)) return 'sber';
  if (/Дата;.*Сумма;.*Валюта/i.test(first500) || /Точка|tochka/i.test(first500)) return 'tochka';
  return 'csv';
}

// ── Утилиты ────────────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  str = str.trim();
  let m = str.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = str.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2})$/);
  if (m) return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function parseAmount(str) {
  if (!str && str !== 0) return NaN;
  str = String(str).trim().replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
  return parseFloat(str);
}

function parseCSVRow(line, sep) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === sep && !inQuotes) { result.push(current.trim().replace(/^"|"$/g, '')); current = ''; }
    else current += ch;
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}


// ═══════════════════════════════════════════════════════════════════════════
// ФОРМАТ 1: Универсальный CSV (совместимо с bank_import.js)
// ═══════════════════════════════════════════════════════════════════════════
function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const sep = lines[0].includes(';') ? ';' : ',';
  let startIdx = 0;
  const header = lines[0].toLowerCase();
  if (header.includes('дата') || header.includes('сумма') || header.includes('назначение')) startIdx = 1;

  const results = [];
  for (let i = startIdx; i < lines.length; i++) {
    const row = parseCSVRow(lines[i], sep);
    if (row.length < 3) continue;

    let date, amount, description, counterparty;
    if (row.length >= 6 && ['RUB', 'RUR', 'руб'].includes(row[3])) {
      date = parseDate(row[0] || row[1]);
      amount = parseAmount(row[2]);
      description = row[4] || '';
      counterparty = row[5] || '';
    } else if (row.length >= 5) {
      date = parseDate(row[0]);
      amount = parseAmount(row[1]);
      counterparty = row[2] || '';
      description = row[3] || row[4] || '';
    } else {
      date = parseDate(row[0]);
      amount = parseAmount(row[1]);
      description = row[2] || '';
      counterparty = '';
    }

    if (!date || isNaN(amount)) continue;
    results.push({
      transaction_date: date,
      amount: Math.abs(amount),
      direction: amount >= 0 ? 'income' : 'expense',
      counterparty_name: counterparty.trim(),
      payment_purpose: description.trim(),
      document_number: null,
      document_date: null,
      counterparty_inn: null,
      counterparty_kpp: null,
      counterparty_account: null,
      counterparty_bank_bik: null,
      our_account: null,
      // Для совместимого хеша
      _hash_row: { date, amount, counterparty: counterparty.trim(), description: description.trim() }
    });
  }
  return results;
}


// ═══════════════════════════════════════════════════════════════════════════
// ФОРМАТ 2: 1С (1CClientBankExchange)
// ═══════════════════════════════════════════════════════════════════════════
function parse1C(text) {
  const results = [];
  // Извлекаем наш р/с
  const ourAccountMatch = text.match(/РасsчСчёт=(.+)|РасsчСчет=(.+)|РасчСчёт=(.+)|РасчСчет=(.+)/i);
  const ourAccount = (ourAccountMatch ? (ourAccountMatch[1] || ourAccountMatch[2] || ourAccountMatch[3] || ourAccountMatch[4]) : '').trim();

  // Разбиваем по секциям документов
  const sections = text.split(/СекцияДокумент=/i).slice(1);

  for (const section of sections) {
    const endIdx = section.indexOf('КонецДокумента');
    const body = endIdx > 0 ? section.slice(0, endIdx) : section;

    const kv = {};
    for (const line of body.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) kv[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }

    const date = parseDate(kv['Дата'] || kv['ДатаСписworked'] || '');
    const amount = parseAmount(kv['Сумма'] || '');
    if (!date || isNaN(amount)) continue;

    // Определяем направление: если наш ИНН = плательщик → расход, иначе доход
    const payerInn = kv['ПлательщикИНН'] || '';
    const recipientInn = kv['ПолучательИНН'] || '';
    const payerAccount = kv['ПлательщикРасчСчет'] || kv['ПлательщикСчет'] || '';
    const isExpense = payerAccount === ourAccount || payerInn === (kv['ИНН'] || '');

    results.push({
      transaction_date: date,
      amount,
      direction: isExpense ? 'expense' : 'income',
      counterparty_name: isExpense ? (kv['Получатель'] || '') : (kv['Плательщик'] || ''),
      counterparty_inn: isExpense ? recipientInn : payerInn,
      counterparty_kpp: isExpense ? (kv['ПолучательКПП'] || '') : (kv['ПлательщикКПП'] || ''),
      counterparty_account: isExpense ? (kv['ПолучательРасчСчет'] || kv['ПолучательСчет'] || '') : payerAccount,
      counterparty_bank_bik: isExpense ? (kv['ПолучательБИК'] || '') : (kv['ПлательщикБИК'] || ''),
      payment_purpose: kv['НазначениеПлатежа'] || '',
      document_number: kv['Номер'] || '',
      document_date: parseDate(kv['Дата'] || ''),
      our_account: ourAccount,
      _hash_row: {
        date,
        amount: isExpense ? -amount : amount,
        counterparty: (isExpense ? (kv['Получатель'] || '') : (kv['Плательщик'] || '')).slice(0, 30),
        description: (kv['НазначениеПлатежа'] || '').slice(0, 30)
      }
    });
  }
  return results;
}


// ═══════════════════════════════════════════════════════════════════════════
// ФОРМАТ 3: Тинькофф CSV
// ═══════════════════════════════════════════════════════════════════════════
function parseTinkoff(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const sep = ';';
  const headerLine = lines[0].toLowerCase();
  // Находим индексы колонок
  const headers = parseCSVRow(lines[0], sep).map(h => h.toLowerCase().trim());
  const idx = {
    date: headers.findIndex(h => h.includes('дата операции') || h.includes('дата')),
    docNum: headers.findIndex(h => h.includes('номер документа') || h.includes('номер')),
    amount: headers.findIndex(h => h.includes('сумма')),
    currency: headers.findIndex(h => h.includes('валюта')),
    status: headers.findIndex(h => h.includes('статус')),
    counterparty: headers.findIndex(h => h.includes('наименование контрагента') || h.includes('контрагент')),
    inn: headers.findIndex(h => h.includes('инн контрагента') || h.includes('инн')),
    kpp: headers.findIndex(h => h.includes('кпп')),
    account: headers.findIndex(h => h.includes('счёт контрагента') || h.includes('счет контрагента')),
    bik: headers.findIndex(h => h.includes('бик')),
    purpose: headers.findIndex(h => h.includes('назначение платежа') || h.includes('назначение'))
  };

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i], sep);
    if (row.length < 3) continue;

    const date = parseDate(row[idx.date >= 0 ? idx.date : 0]);
    const amount = parseAmount(row[idx.amount >= 0 ? idx.amount : 2]);
    if (!date || isNaN(amount)) continue;

    const counterparty = row[idx.counterparty >= 0 ? idx.counterparty : 5] || '';
    const purpose = row[idx.purpose >= 0 ? idx.purpose : row.length - 1] || '';

    results.push({
      transaction_date: date,
      amount: Math.abs(amount),
      direction: amount >= 0 ? 'income' : 'expense',
      counterparty_name: counterparty,
      counterparty_inn: row[idx.inn >= 0 ? idx.inn : -1] || null,
      counterparty_kpp: row[idx.kpp >= 0 ? idx.kpp : -1] || null,
      counterparty_account: row[idx.account >= 0 ? idx.account : -1] || null,
      counterparty_bank_bik: row[idx.bik >= 0 ? idx.bik : -1] || null,
      payment_purpose: purpose,
      document_number: row[idx.docNum >= 0 ? idx.docNum : 1] || null,
      document_date: date,
      our_account: null,
      _hash_row: { date, amount, counterparty: counterparty.slice(0, 30), description: purpose.slice(0, 30) }
    });
  }
  return results;
}


// ═══════════════════════════════════════════════════════════════════════════
// ФОРМАТ 4: Сбербанк CSV
// ═══════════════════════════════════════════════════════════════════════════
function parseSber(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const sep = ';';
  const headers = parseCSVRow(lines[0], sep).map(h => h.toLowerCase().trim());
  const idx = {
    docNum: headers.findIndex(h => h.includes('номер документа') || h.includes('номер')),
    date: headers.findIndex(h => h.includes('дата операции') || h.includes('дата')),
    amount: headers.findIndex(h => h.includes('сумма')),
    currency: headers.findIndex(h => h.includes('валюта')),
    counterparty: headers.findIndex(h => h.includes('наименование контрагента') || h.includes('контрагент')),
    inn: headers.findIndex(h => h.includes('инн')),
    purpose: headers.findIndex(h => h.includes('назначение платежа') || h.includes('назначение'))
  };

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i], sep);
    if (row.length < 3) continue;

    const date = parseDate(row[idx.date >= 0 ? idx.date : 1]);
    const amount = parseAmount(row[idx.amount >= 0 ? idx.amount : 2]);
    if (!date || isNaN(amount)) continue;

    const counterparty = row[idx.counterparty >= 0 ? idx.counterparty : 4] || '';
    const purpose = row[idx.purpose >= 0 ? idx.purpose : row.length - 1] || '';

    results.push({
      transaction_date: date,
      amount: Math.abs(amount),
      direction: amount >= 0 ? 'income' : 'expense',
      counterparty_name: counterparty,
      counterparty_inn: row[idx.inn >= 0 ? idx.inn : -1] || null,
      counterparty_kpp: null,
      counterparty_account: null,
      counterparty_bank_bik: null,
      payment_purpose: purpose,
      document_number: row[idx.docNum >= 0 ? idx.docNum : 0] || null,
      document_date: date,
      our_account: null,
      _hash_row: { date, amount, counterparty: counterparty.slice(0, 30), description: purpose.slice(0, 30) }
    });
  }
  return results;
}


// ═══════════════════════════════════════════════════════════════════════════
// ФОРМАТ 5: Точка (Точка Банк)
// ═══════════════════════════════════════════════════════════════════════════
function parseTochka(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const sep = ';';
  const headers = parseCSVRow(lines[0], sep).map(h => h.toLowerCase().trim());
  const idx = {
    date: headers.findIndex(h => h.includes('дата')),
    docNum: headers.findIndex(h => h.includes('номер')),
    debit: headers.findIndex(h => h.includes('списани')),
    credit: headers.findIndex(h => h.includes('зачислени')),
    counterparty: headers.findIndex(h => h.includes('контрагент')),
    inn: headers.findIndex(h => h.includes('инн')),
    purpose: headers.findIndex(h => h.includes('назначение'))
  };

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i], sep);
    if (row.length < 3) continue;

    const date = parseDate(row[idx.date >= 0 ? idx.date : 0]);
    const debit = parseAmount(row[idx.debit >= 0 ? idx.debit : 2]);
    const credit = parseAmount(row[idx.credit >= 0 ? idx.credit : 3]);

    let amount, direction;
    if (!isNaN(credit) && credit > 0) { amount = credit; direction = 'income'; }
    else if (!isNaN(debit) && debit > 0) { amount = debit; direction = 'expense'; }
    else continue;

    if (!date) continue;

    const counterparty = row[idx.counterparty >= 0 ? idx.counterparty : 4] || '';
    const purpose = row[idx.purpose >= 0 ? idx.purpose : row.length - 1] || '';

    results.push({
      transaction_date: date,
      amount,
      direction,
      counterparty_name: counterparty,
      counterparty_inn: row[idx.inn >= 0 ? idx.inn : -1] || null,
      counterparty_kpp: null,
      counterparty_account: null,
      counterparty_bank_bik: null,
      payment_purpose: purpose,
      document_number: row[idx.docNum >= 0 ? idx.docNum : 1] || null,
      document_date: date,
      our_account: null,
      _hash_row: {
        date,
        amount: direction === 'expense' ? -amount : amount,
        counterparty: counterparty.slice(0, 30),
        description: purpose.slice(0, 30)
      }
    });
  }
  return results;
}


// ═══════════════════════════════════════════════════════════════════════════
// Главная функция: парсинг буфера
// ═══════════════════════════════════════════════════════════════════════════
function parseStatement(buffer, formatHint) {
  const text = decodeBuffer(buffer);
  const format = formatHint || detectFormat(text);

  let rows;
  switch (format) {
    case '1c_txt': rows = parse1C(text); break;
    case 'tinkoff': rows = parseTinkoff(text); break;
    case 'sber': rows = parseSber(text); break;
    case 'tochka': rows = parseTochka(text); break;
    default: rows = parseCSV(text); break;
  }

  // Вычисляем import_hash для каждой строки (совместимый с фронтендом)
  for (const row of rows) {
    if (row._hash_row) {
      row.import_hash = generateHash(row._hash_row);
      delete row._hash_row;
    }
  }

  return { format, rows };
}


// ═══════════════════════════════════════════════════════════════════════════
// Классификация по правилам
// ═══════════════════════════════════════════════════════════════════════════
function classifyTransaction(tx, rules) {
  for (const rule of rules) {
    if (!rule.is_active) continue;
    if (rule.direction && rule.direction !== tx.direction) continue;

    const pattern = (rule.pattern || '').toLowerCase();
    let text = '';
    switch (rule.match_field) {
      case 'counterparty': text = (tx.counterparty_name || '').toLowerCase(); break;
      case 'purpose': text = (tx.payment_purpose || '').toLowerCase(); break;
      case 'document': text = (tx.document_number || '').toLowerCase(); break;
      default: text = ((tx.counterparty_name || '') + ' ' + (tx.payment_purpose || '') + ' ' + (tx.document_number || '')).toLowerCase();
    }

    if (text.includes(pattern)) {
      return {
        article: rule.article,
        category_1c: rule.category_1c || null,
        work_id: rule.work_id || null,
        confidence: rule.is_system ? 'medium' : 'high',
        rule_id: rule.id
      };
    }
  }
  return null;
}


// ═══════════════════════════════════════════════════════════════════════════
// Генерация файла 1CClientBankExchange
// ═══════════════════════════════════════════════════════════════════════════
function generate1CExport(transactions, dateFrom, dateTo, ourAccount) {
  const lines = [
    '1CClientBankExchange',
    'ВерсияФормата=1.03',
    'Кодировка=Windows',
    'Отправитель=ASGARD CRM',
    `ДатаНачала=${formatDate1C(dateFrom)}`,
    `ДатаКонца=${formatDate1C(dateTo)}`,
    `РасsчСчёт=${ourAccount || ''}`,
    ''
  ];

  for (const tx of transactions) {
    lines.push('СекцияДокумент=Платёжное поручение');
    lines.push(`Номер=${tx.document_number || tx.id || ''}`);
    lines.push(`Дата=${formatDate1C(tx.transaction_date)}`);
    lines.push(`Сумма=${(tx.amount || 0).toFixed(2)}`);

    if (tx.direction === 'expense') {
      lines.push(`ПлательщикИНН=`);
      lines.push(`Плательщик=ООО "Асгард Сервис"`);
      lines.push(`ПолучательИНН=${tx.counterparty_inn || ''}`);
      lines.push(`Получатель=${tx.counterparty_name || ''}`);
    } else {
      lines.push(`ПлательщикИНН=${tx.counterparty_inn || ''}`);
      lines.push(`Плательщик=${tx.counterparty_name || ''}`);
      lines.push(`ПолучательИНН=`);
      lines.push(`Получатель=ООО "Асгард Сервис"`);
    }

    lines.push(`НазначениеПлатежа=${tx.payment_purpose || ''}`);
    lines.push('КонецДокумента');
    lines.push('');
  }

  lines.push('КонецФайла');

  // Кодируем в Windows-1251 если доступен iconv
  const text = lines.join('\r\n');
  if (iconv) return iconv.encode(text, 'win1251');
  return Buffer.from(text, 'utf-8');
}

function formatDate1C(d) {
  if (!d) return '';
  if (typeof d === 'string') d = new Date(d);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}


module.exports = {
  generateHash,
  detectFormat,
  parseStatement,
  classifyTransaction,
  generate1CExport,
  decodeBuffer,
  parseCSV,
  parse1C,
  parseTinkoff,
  parseSber,
  parseTochka
};
