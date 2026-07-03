'use strict';

/**
 * Юнит-тест extractOriginalSender — разворачивание цепочки форвардов.
 *
 * Контекст бага (29.06.2026, pre_tender #973):
 *   Цепочка: karina@eurochem.ru → info@asgard → e.danilova@asgard → n.androsov@asgard → CRM.
 *   Старый код брал Елизавету (первый Yandex-блок), новый должен взять Карину
 *   (самый глубокий внешний).
 *
 * Запуск:  node tests/unit/extract-original-sender.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Перепубликуем функцию из imap.js. Сам файл инициализирует подключение к БД,
// здесь нам это не нужно — копируем минимум: INTERNAL_DOMAINS + extractOriginalSender.
const INTERNAL_DOMAINS = ['asgard-crm.ru', 'asgard-service.ru', 'asgard-service.com', 'asgard-s.ru', 'асгард.рф'];

function extractOriginalSender(bodyText, bodyHtml) {
  let body = bodyText || '';
  if (!body && bodyHtml) {
    body = String(bodyHtml)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"');
  }

  const isInternal = (e) => INTERNAL_DOMAINS.some(d => String(e).toLowerCase().includes(d));
  const candidates = [];
  let m;

  const reFromAng = /^[ \t>]*(?:От|From):\s*(?:"?([^<\n"]+?)"?\s*)?<([^>\s]+@[^>\s]+)>/gm;
  while ((m = reFromAng.exec(body)) !== null) {
    candidates.push({ name: (m[1] || '').trim() || null, email: m[2].toLowerCase(), pos: m.index });
  }
  const reFromBare = /^[ \t>]*(?:От|From):\s*([^\s<>"]+@[^\s<>"]+)/gm;
  while ((m = reFromBare.exec(body)) !== null) {
    candidates.push({ name: null, email: m[1].toLowerCase().replace(/[:;,]+$/, ''), pos: m.index });
  }
  const reYandexAng = /\d{1,2}\.\d{1,2}\.\d{2,4},\s*\d{1,2}:\d{2},\s*"?([^"<\n]+?)"?\s*<([^>\s]+@[^>\s]+)>/g;
  while ((m = reYandexAng.exec(body)) !== null) {
    candidates.push({ name: (m[1] || '').trim() || null, email: m[2].toLowerCase(), pos: m.index });
  }
  const reYandexBare = /\d{1,2}\.\d{1,2}\.\d{2,4},\s*\d{1,2}:\d{2},\s*(?:"([^"\n]+)"\s+)?([^\s\n,()<>:"]+@[^\s\n,()<>:"]+)/g;
  while ((m = reYandexBare.exec(body)) !== null) {
    candidates.push({ name: (m[1] || '').trim() || null, email: m[2].toLowerCase(), pos: m.index });
  }

  if (!candidates.length) return null;

  const byEmail = new Map();
  for (const c of candidates) {
    const prev = byEmail.get(c.email);
    if (!prev) { byEmail.set(c.email, { ...c }); continue; }
    if (c.pos > prev.pos) prev.pos = c.pos;
    if (!prev.name && c.name) prev.name = c.name;
  }
  const uniq = [...byEmail.values()].sort((a, b) => a.pos - b.pos);

  const externals = uniq.filter(c => !isInternal(c.email));
  if (externals.length) {
    const pick = externals[externals.length - 1];
    return { name: pick.name, email: pick.email };
  }
  return null;
}

// ─── ТЕСТЫ ───────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function it(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); fail++; }
}

console.log('extractOriginalSender:');

it('email #3017 — Карина из eurochem.ru, не Елизавета из asgard', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'email-3017.html'), 'utf-8');
  const r = extractOriginalSender('', html);
  assert.ok(r, 'должен вернуть объект');
  assert.strictEqual(r.email, 'karina.krivlenko@eurochem.ru',
    `ожидался karina.krivlenko@eurochem.ru, получено ${r.email}`);
});

it('одиночный Yandex с угловыми', () => {
  const body = `30.06.2026, 09:00, "Иван Иванов" <ivan@client.ru>:\nТекст`;
  const r = extractOriginalSender(body, null);
  assert.strictEqual(r.email, 'ivan@client.ru');
  assert.strictEqual(r.name, 'Иван Иванов');
});

it('Outlook «От: Имя <email>»', () => {
  const body = `На проработку\n-----Original Message-----\nFrom: John Doe <john@external.com>\nSent: Mon\nSubject: KP`;
  const r = extractOriginalSender(body, null);
  assert.strictEqual(r.email, 'john@external.com');
  assert.strictEqual(r.name, 'John Doe');
});

it('Outlook бара (без угловых) — только От: email', () => {
  const body = `От: ivan@external.com\nДата: 10.06.2026`;
  const r = extractOriginalSender(body, null);
  assert.strictEqual(r.email, 'ivan@external.com');
});

it('двойной форвард: asgard → external — берём external', () => {
  const body =
`30.06.2026, 11:00, "Иван Сотрудник" <ivan@asgard-service.com>:
Перенаправил
-------- Пересылаемое сообщение --------
23.06.2026, 09:00, "Клиент Реальный" <klient@vneshniy.ru>:
Прошу КП`;
  const r = extractOriginalSender(body, null);
  assert.strictEqual(r.email, 'klient@vneshniy.ru');
  assert.strictEqual(r.name, 'Клиент Реальный');
});

it('тройной форвард: asgard → asgard → external — берём самый глубокий external', () => {
  const body =
`30.06.2026, 14:00, "А" <a@asgard-service.com>:
-------- Пересылаемое сообщение --------
29.06.2026, 14:00, "Б" <b@asgard-service.com>:
-------- Пересылаемое сообщение --------
28.06.2026, 14:00, "Внешний" <real@external.com>:
ТЗ`;
  const r = extractOriginalSender(body, null);
  assert.strictEqual(r.email, 'real@external.com');
});

it('все форвардеры внутренние — возвращает null', () => {
  const body = `30.06.2026, 11:00, "А" <a@asgard-service.com>:\nfwd\n29.06.2026, 14:00, "Б" <b@asgard-service.com>:\nfwd`;
  const r = extractOriginalSender(body, null);
  assert.strictEqual(r, null);
});

it('нет форвард-маркеров → null', () => {
  const r = extractOriginalSender('Просто текст без форвардов', null);
  assert.strictEqual(r, null);
});

it('Yandex bare (mailto-ссылки удалены HTML-стрипом)', () => {
  const body = `23.06.2026, 09:21, karina.krivlenko@eurochem.ru (karina.krivlenko@eurochem.ru):\nДобрый день!`;
  const r = extractOriginalSender(body, null);
  assert.strictEqual(r.email, 'karina.krivlenko@eurochem.ru');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
