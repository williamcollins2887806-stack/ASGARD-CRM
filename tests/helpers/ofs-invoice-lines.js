'use strict';
/**
 * Позиции счёта ОФС без платного ИИ — из fixtures/ofs/cart-items.json + цены.
 */
const fs = require('fs');
const path = require('path');

const ITEMS = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/ofs/cart-items.json'), 'utf8')
);

function invoiceLines(limit = 6) {
  return ITEMS.slice(0, limit).map((it, i) => ({
    name: it.name,
    article: 'OFS-' + String(i + 1).padStart(3, '0'),
    quantity: it.qty || 1,
    unit: it.unit || 'шт',
    unit_price: 18500 + i * 500,
    supplier_name: 'ОФС ВЕДО / ВсеИнструменты',
  }));
}

module.exports = { invoiceLines, ITEMS };
