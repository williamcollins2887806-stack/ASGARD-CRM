'use strict';
/**
 * ЗАПУСКАЕТСЯ НА ПРОД-СЕРВЕРЕ. Снимает «что сейчас печатает прод» по созданному ТКП:
 * GET /api/tkp/:id/docx → распаковка docx → текст шапки таблицы стоимости.
 * Нужен, чтобы до/после выкатки шаблона сравнивать факт, а не ожидания.
 *
 * Итог печатает одной строкой `PROBE_OK` / `PROBE_FAIL <что>` и этим кодом выходит,
 * чтобы его можно было использовать как гейт из deploy-скрипта.
 *
 * Запуск (на проде, файл копируется в /root/tkp-tmp):
 *   TKP_AUTHOR_LOGIN=n.androsov node tkp_full_docx_probe.js 3042
 * Из deploy-скрипта вызывается как гейт: см. tools/deploy_tkp_universal_20_28_36.py, шаг 4.
 */
const path = require('path');
const APP = '/var/www/asgard-crm';
require(path.join(APP, 'node_modules', 'dotenv')).config({ path: path.join(APP, '.env') });
const jwt = require(path.join(APP, 'node_modules', 'jsonwebtoken'));
const PizZip = require(path.join(APP, 'node_modules', 'pizzip'));
const fs = require('fs');

const TKP_ID = process.argv[2];
const LOGIN = process.env.TKP_AUTHOR_LOGIN || 'n.androsov';

(async () => {
  const token = jwt.sign({ id: 3474, login: LOGIN, name: 'Андросов Никита Андреевич', role: 'PM', pinVerified: true },
    process.env.JWT_SECRET, { expiresIn: '10m' });
  const resp = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/tkp/${TKP_ID}/docx`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('HTTP ' + resp.status + ' ' + (resp.headers.get('content-type') || ''));
  if (!resp.ok) { console.log((await resp.text()).slice(0, 300)); console.log('PROBE_FAIL http'); process.exit(1); }
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(`/root/tkp-tmp/probe-${TKP_ID}.docx`, buf);
  const xml = new PizZip(buf).file('word/document.xml').asText();

  // тексты всех <w:t> в одном массиве, чтобы искать и по разорванным runs.
  // NBSP → обычный пробел: fmtMoney (toLocaleString ru-RU) разделяет тысячи U+00A0,
  // без нормализации денежные строки в docx не находятся.
  const texts = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('');
  const plain = texts.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');

  const OLD = ['ПО АППАРАТАМ', 'Инвентарный', 'Расчётные данные по трубкам'];
  const NEW = ['СТОИМОСТЬ РАБОТ И ЗАТРАТ', 'Наименование', 'Ед. изм.', 'Объём и расчётные данные', 'Кол-во'];
  const MONEY = ['8 510 000,00', '1 872 200,00', '10 382 200,00', '5 191 100,00'];
  const LEAK = ['себестоимост', 'прибыл', '4 157 080', '25 000'];

  const bad = [];
  console.log('\nразмер docx: ' + buf.length + ' байт, символов текста: ' + plain.length);
  console.log('\nСТАРЫЕ (под аппараты) маркеры шапки:');
  for (const s of OLD) {
    const hit = plain.includes(s);
    if (hit) bad.push('old:' + s);
    console.log(`  ${hit ? 'НАЙДЕНО ' : 'нет      '} ${s}`);
  }
  console.log('\nНОВЫЕ (универсальные) маркеры шапки:');
  for (const s of NEW) {
    const hit = plain.includes(s);
    if (!hit) bad.push('new:' + s);
    console.log(`  ${hit ? 'НАЙДЕНО ' : 'НЕТ     '} ${s}`);
  }
  console.log('\nСуммы в документе:');
  for (const s of MONEY) {
    const hit = plain.includes(s);
    if (!hit) bad.push('money:' + s);
    console.log(`  ${hit ? 'OK   ' : 'НЕТ  '} ${s}`);
  }
  console.log('\nВнутренние цифры (должны отсутствовать):');
  for (const s of LEAK) {
    const hit = plain.includes(s);
    if (hit) bad.push('leak:' + s);
    console.log(`  ${hit ? '*** УТЕЧКА ***' : 'ок           '} ${s}`);
  }
  console.log('\n' + (bad.length ? 'PROBE_FAIL ' + bad.join(' | ') : 'PROBE_OK'));
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('FATAL: ' + e.message); console.log('PROBE_FAIL fatal'); process.exit(1); });
