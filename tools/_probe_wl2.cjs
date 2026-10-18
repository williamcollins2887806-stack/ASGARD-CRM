'use strict';
const det = require('../src/services/approval-detector');
const th = require('../src/services/approval-thread');

// 1) emoji / symbol negatives (no words)
console.log('--- emoji/symbol negatives (approve must be false) ---');
const emo = ['Добро 🚫', 'Добро ❌', '🚫 Добро', 'Добро 🛑', 'Добро ⛔', 'Добро 👎', 'Добро ❌❌❌', 'Добро 👍👎'];
for (const b of emo) console.log((det.detectApproval(b).approve ? 'LEAK ' : 'ok   '), JSON.stringify(b), JSON.stringify(det.detectApproval(b)));

// 2) dash-separator followed by negative without PAY word
console.log('\n--- dash separator + non-pay negative ---');
const dash = ['Добро\n--\nне сейчас', 'Добро\n--\nподожди', 'Добро\n--\nотмена', 'Добро\n--\nне надо', 'Добро\n--\nне время', 'Добро\n--\nпозже', 'Добро\n--\nстоп'];
for (const b of dash) console.log((det.detectApproval(b).approve ? 'LEAK ' : 'ok   '), JSON.stringify(b), JSON.stringify(det.detectApproval(b)));

// 3) product answers (realistic director replies)
console.log('\n--- realistic director replies ---');
const prod = ['Добро, оплачивай', 'Согласен на оплату', 'Оплачивай', 'Утверждаю оплату', 'Да, можно оплатить', 'Хорошо, платим', 'Добро, спасибо!', 'Добро, можно оплачивать', 'Согласовано, платите', 'Даю согласие', 'Ок, оплачивайте', 'Добро. Оплата согласована', 'Подтверждаю оплату', 'Разрешаю оплату', 'Можно платить'];
for (const b of prod) console.log((det.detectApproval(b).approve ? 'APPROVE' : 'manual '), JSON.stringify(b), JSON.stringify(det.detectApproval(b)));

// 4) address spoof unit-level
console.log('\n--- extractEmail ---');
const addrs = ['go@asgard-service.com@evil.ru', 'go@asgard-service.com.', 'go@asgard-service.com.evil.ru', 'Олег Гажилиев <go@asgard-service.com>', 'GO@ASGARD-SERVICE.COM', 'go@asgard-service.com ', 'go@asgard-service.com', '"Fake" <go@asgard-service.com@evil.ru>', 'go@asgard-service.com>, <evil@evil.ru'];
for (const a of addrs) console.log(JSON.stringify(a), '->', JSON.stringify(th.extractEmail(a)));
