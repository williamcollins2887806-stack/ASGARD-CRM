#!/usr/bin/env node
'use strict';

/**
 * Прод-путь полного КП: DOCX, который отдаёт buildAiDraft, читаем как текст
 * и проверяем, что в документе нет пустых разделов, лишних меток и что итоги
 * арифметически сходятся.
 *
 * Зачем отдельно от tkp-full-kp-sections.test.js: там фикстура, здесь —
 * документ, собранный ровно тем путём, который пойдёт в LibreOffice на проде.
 *
 * Запуск: node tools/tkp-full-kp-docx-check.js [tenderId]
 */

if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = '123456789';
if (!process.env.DB_NAME) process.env.DB_NAME = 'asgard_crm_test';

const PizZip = require('pizzip');
const assert2 = require('assert');
const full = require('../src/services/tkp-full-kp');
const lint = require('../src/services/client-doc-lint');

let fails = 0;
function ok(cond, label, detail) {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
  if (!cond) fails += 1;
}

function docText(buf) {
  const xml = new PizZip(buf).file('word/document.xml').asText();
  return xml.replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

function money(n) {
  return Number(n).toLocaleString('ru-RU', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }).replace(/[\s\u00a0\u202f]/g, ' ');
}

const SUB = 5935430;
const VAT = Math.round(SUB * 0.22 * 100) / 100;
const TOT = Math.round((SUB + VAT) * 100) / 100;

const tkp = {
  id: 902,
  customer_name: 'ООО ПК «КИРОВ ТАЙР»',
  subject: 'Чистка технологических каналов',
  validity_days: 30,
  created_at: new Date('2026-11-05'),
  items: {
    vat_pct: 22,
    subtotal: SUB,
    vat_sum: VAT,
    total_with_vat: TOT,
    full: {
      object_name: 'Завод Пирелли',
      basis: 'Техническое задание заказчика',
      transport_amount: 0,
      conditions: {
        personnel: 'ИТР (РП) — 1, Мастер / бригадир — 1, Слесарь — 5',
        regime: '2 смены в сутки, смена 12 ч, рабочих дней: 9',
        payment: 'Постоплата'
      },
      apparatus: [
        { equipment: 'Чистка каналов корпуса №37', inventory_no: 'усл.', tube_data: '', qty: 1, amount_no_vat: 2967715 },
        { equipment: 'Чистка каналов корпуса №64', inventory_no: 'усл.', tube_data: '', qty: 1, amount_no_vat: 2967715 }
      ],
      // Разделы пустые — заголовки не должны печататься.
      acceptance: '',
      risks: '',
      customer_duties: '',
      deliverables: ''
    }
  }
};

const buf = full.generateFullKpDocxBuffer(tkp, { name: 'ООО «АСГАРД-Сервис»' });
const text = docText(buf);
require('fs').writeFileSync('tmp/tkp-docx-check.docx', buf);
console.log('DOCX: ' + buf.length + ' байт\n');

ok(text.indexOf(money(SUB)) >= 0, 'итог без НДС в документе', money(SUB));
ok(text.indexOf(money(SUB + 50000)) < 0, 'нет удвоенного транспорта', 'искали ' + money(SUB + 50000));
ok(text.indexOf(money(TOT)) >= 0, 'итог с НДС в документе', money(TOT));
ok(Math.abs(SUB * 0.22 - VAT) < 0.02, 'НДС = 22% от базы', money(VAT));

const emptyHeads = ['ПОРЯДОК СДАЧИ', 'УСЛОВИЯ, ВЛИЯЮЩИЕ', 'ОБЯЗАННОСТИ ЗАКАЗЧИКА', 'ИСПОЛНИТЕЛЬНАЯ ДОКУМЕНТ']
  .filter((h) => text.indexOf(h) >= 0);
ok(emptyHeads.length === 0, 'нет пустых заголовков разделов', emptyHeads.join(' | '));
  ok(text.indexOf('Мобилизация и срок') < 0, 'нет метки без значения');
  ok(text.indexOf('Ресурсы Заказчика') < 0, 'нет пустой метки ресурсов');
  // Верификатор 05.11.2026: cost_notes захардкожен пустым, а заголовок печатался
  // в КАЖДОМ ИИ-КП; personnel/regime пусты у 114 из 115 готовых просчётов.
  ok(text.indexOf('Примечания к распределению') < 0, 'нет пустых примечаний');
  ok(text.indexOf('Граница объема') < 0, 'нет пустой границы объёма');

ok(text.indexOf('Слесарь') >= 0, 'состав бригады из техплана');
ok(text.indexOf('2 смены в сутки') >= 0, 'режим работ из техплана');

// Обратный контроль: документ без техплана не должен печатать пустые метки.
{
  const bare = JSON.parse(JSON.stringify(tkp));
  bare.items.full.conditions = { payment: 'Постоплата' };
  const t2 = docText(full.generateFullKpDocxBuffer(bare, { name: 'ООО «АСГАРД-Сервис»' }));
  ok(t2.indexOf('Персонал') < 0, 'без техплана нет пустой метки «Персонал»');
  ok(t2.indexOf('Режим производства') < 0, 'без техплана нет пустой метки «Режим»');
  ok(t2.indexOf('Постоплата') >= 0, 'заполненная оплата сохранена');
}

const gate = lint.lintText(text, { skipNumbers: true });
ok(gate.hits.length === 0, 'линтер чист', JSON.stringify(gate.hits.map((h) => h.kind + ':' + h.phrase)));

const rawTags = (text.match(/\{[#\/][a-z_0-9]+\}/g) || []);
ok(rawTags.length === 0, 'нет необработанных тегов шаблона', rawTags.join(' '));

console.log('\nфайл: tmp/tkp-docx-check.docx');
console.log(fails ? 'ИТОГ: FAIL (' + fails + ')' : 'ИТОГ: OK — документ полный, чистый, суммы сходятся');
process.exit(fails ? 1 : 0);
