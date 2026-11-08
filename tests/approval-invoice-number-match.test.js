'use strict';

/**
 * tests/approval-invoice-number-match.test.js
 *
 * D-401 (08.11.2026): «Добро» не привязывалось к заявке, когда ответ пришёл
 * с телефона и получил НОВЫЙ thread_id.
 *
 * РЕАЛЬНЫЕ СЛУЧАИ НА ПРОДЕ (проверено по базе):
 *   • счёт 5323 «Новошахтинский НПЗ, счет № 2611-482375-46780 …»
 *       thread_id = 25221793887946@mail.360.yandex.ru
 *     «Добро» 5327 (Гажилиев, iPhone)
 *       thread_id = 1672281793890909@b2a204d6-e1b8-4840-bff4-c9e252e0f6c0
 *   • счёт 5368 «НЗНП: Счет ООО Интернет Решения от 06.11.2026»
 *       thread_id = 202331793983000@mail.360.yandex.ru
 *     «Добро» 5371 (Гажилиев, iPhone)
 *       thread_id = 233251793984107@5633b918-5c5b-4afa-97fe-f903b1426465
 *
 * iPhone ставит свой thread_id и НЕ проставляет in_reply_to исходного письма.
 * Оба штатных способа (references и thread_id) заявку не находили: согласие
 * оседало в doc_approval_grant неapplied, а заявка висела в очереди директора.
 *
 * Матчинг теперь идёт и по НОМЕРУ СЧЁТА из темы письма. Тест проверяет логику
 * нормализации номера — без БД, на чистых функциях-дублёрах.
 */

const test = require('node:test');
const assert = require('node:assert');

// Нормализация номера счёта — та же, что в approval-thread.js.
const norm = (s) => String(s || '').toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, '');

// Извлечение номеров из темы — та же регулярка, что в approval-thread.js.
function numbersFromSubject(subj) {
  const cleaned = String(subj || '').replace(/^\s*((re|fw|fwd|ответ|пересл)\s*:\s*)+/gi, '');
  return (cleaned.match(/[A-Za-zА-Яа-я0-9]+(?:[-/][A-Za-zА-Яа-я0-9]+){1,}/g) || [])
    .map((s) => s.trim())
    .filter((s) => s.length >= 6 && /\d/.test(s));
}

test('D-401: номер счёта из темы «Re: … счет № 2611-482375-46780 от 05.11»', () => {
  const nums = numbersFromSubject('Re: Новошахтинский НПЗ, счет № 2611-482375-46780 от 05.11.2026, Все инструменты');
  assert.ok(nums.some((n) => norm(n) === norm('2611-482375-46780')),
    'номер 2611-482375-46780 извлечён: ' + JSON.stringify(nums));
});

test('D-401: номер счёта из темы «Re: НЗНП: Счет ООО Интернет Решения от 06.11.2026»', () => {
  // В этой теме номера счёта НЕТ — только дата. Значит матчинг по номеру
  // здесь не сработает, и должен выручить fallback по контрагенту + сумме.
  const nums = numbersFromSubject('Re: НЗНП: Счет ООО Интернет Решения от 06.11.2026');
  const hasInvoiceNumber = nums.some((n) => norm(n).startsWith('0212923137'));
  assert.strictEqual(hasInvoiceNumber, false,
    'в теме только дата, номера счёта нет — это ожидаемо');
  // Но контрагент «Интернет Решения» в теме есть — по нему и матчим.
  assert.ok(/интернет\s+решения/i.test('Re: НЗНП: Счет ООО Интернет Решения от 06.11.2026'),
    'контрагент в теме присутствует для fallback');
});

test('D-401: нормализация номера не зависит от дефисов, регистра и пробелов', () => {
  const variants = ['2611-482375-46780', '2611 482375 46780', '2611482375-46780', '2611-482375-46780'];
  const set = new Set(variants.map(norm));
  assert.strictEqual(set.size, 1, 'все варианты дают один ключ: ' + [...set][0]);
  assert.strictEqual(norm('ГЮ-1056'), norm('гю 1056'), 'кириллический номер тоже нормализуется');
});

test('D-401: совпадение номера — только однозначное', () => {
  // Логика: если под темы подходит РОВНО одна заявка — привязываем.
  // Если две и больше — не угадываем (иначе согласуем чужой счёт).
  const pick = (rows, nums) => {
    const hits = rows.filter((r) => {
      const inv = norm(r.invoice_number);
      return inv && nums.some((n) => norm(n) === inv || inv.includes(norm(n)) || norm(n).includes(inv));
    });
    return hits.length === 1 ? hits[0] : null;
  };
  const rows = [
    { id: 346, invoice_number: '2611-482375-46780', amount: 33960 },
    { id: 359, invoice_number: '0212923137-0058', amount: 3346 },
    { id: 348, invoice_number: 'V052717397', amount: 113980 },
  ];
  assert.strictEqual(pick(rows, numbersFromSubject('Re: счет № 2611-482375-46780 от 05.11'))?.id, 346,
    'однозначное совпадение → заявка 346');
  assert.strictEqual(pick(rows, ['V052717397', '0212923137-0058']), null,
    'два совпадения → не привязываем (null)');
  assert.strictEqual(pick(rows, ['999999-000']), null, 'нет совпадений → null');
});

test('D-401: fallback по контрагенту больше не требует source_email_id IS NULL', () => {
  // Проверяем по исходнику: ограничение снято, иначе счета, пришедшие почтой
  // (а это ВСЕ счета из intake), запасным путём не находились.
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/services/approval-thread'), 'utf8');
  const start = src.indexOf('Кандидаты: awaiting_dir');
  const body = src.slice(start, start + 1200);
  // Ищем в исполняемом коде, а не в комментарии-пояснении.
  const code = body.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/p\.source_email_id IS NULL/.test(code),
    'фильтр source_email_id IS NULL убран из fallback');
  assert.ok(/p\.status='awaiting_dir'/.test(code), 'кандидаты по-прежнему только из очереди директора');
});

test('D-401: матчинг по номеру стоит ДО fallback по контрагенту', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/services/approval-thread'), 'utf8');
  const iNum = src.indexOf('fallback по номеру счёта');
  const iContr = src.indexOf('fallback по контрагенту');
  assert.ok(iNum > 0, 'матчинг по номеру присутствует');
  assert.ok(iContr > 0, 'fallback по контрагенту присутствует');
  assert.ok(iNum < iContr, 'номер счёта проверяется раньше контрагента (он надёжнее)');
});
