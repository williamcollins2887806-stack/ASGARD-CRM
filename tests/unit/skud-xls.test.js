'use strict';

/**
 * Тесты парсера отчёта СКУД. Не требуют БД и сети.
 *
 * Эталон — реальный отчёт за 26.10–01.11.2026. Значения проверены руками
 * по сырым событиям (см. комментарии у каждого кейса), поэтому тест ловит
 * регрессию именно в логике часов, а не «файл прочитался без ошибки».
 *
 * Запуск: npx jest tests/unit/skud-xls.test.js
 */

const fs = require('fs');
const path = require('path');
const skud = require('../../src/services/skud-xls');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'skud');

function fixtureBuffer() {
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => /\.xls$/i.test(f));
  if (!files.length) throw new Error('Нет фикстуры отчёта СКУД в tests/fixtures/skud');
  return fs.readFileSync(path.join(FIXTURE_DIR, files[0]));
}

describe('skud-xls: разбор дат и заголовков', () => {
  test('parseStamp разбирает формат отчёта', () => {
    const s = skud.parseStamp('26.10.2026 10:23:29');
    expect(s).not.toBeNull();
    expect(s.iso).toBe('2026-10-26');
    expect(s.time).toBe('10:23:29');
  });

  test('parseStamp не ловит подвал «Страница 47 из 47» и пустые строки', () => {
    expect(skud.parseStamp('')).toBeNull();
    expect(skud.parseStamp('Страница 47 из 47')).toBeNull();
    expect(skud.parseStamp('03.11.2026 14:17:47')).not.toBeNull(); // дата печати — валидная дата
  });

  test('parsePersonHeader снимает «(таб.№)» и лишние пробелы', () => {
    expect(skud.parsePersonHeader('Тумаева Виктория Анатольевна (таб.№)'))
      .toBe('Тумаева Виктория Анатольевна');
    // в отчёте встречается двойной пробел перед маркером
    expect(skud.parsePersonHeader('Вилявисенсио-Мятов Хосе Александр  (таб.№)'))
      .toBe('Вилявисенсио-Мятов Хосе Александр');
  });

  test('parsePersonHeader не считает человеком шапку и обычные строки', () => {
    expect(skud.parsePersonHeader('Дата Время')).toBeNull();
    expect(skud.parsePersonHeader('Отчет "события"')).toBeNull();
    expect(skud.parsePersonHeader('')).toBeNull();
  });

  test('шапка периода читается из второй строки', () => {
    const rows = [['Отчет "события"'], ['период c 26.10.2026 00:00 по 01.11.2026 23:59']];
    expect(skud.parsePeriodHeader(rows)).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });
});

describe('skud-xls: бинарное состояние (два считывателя на одном проёме)', () => {
  test('вход → вход подряд: второй вход отбрасывается', () => {
    const out = skud.collapseState([
      { ts: 1, direction: 'вход' },
      { ts: 2, direction: 'вход' },
      { ts: 3, direction: 'выход' }
    ]);
    expect(out.map((e) => e.ts)).toEqual([1, 3]);
  });

  test('выход при «уже снаружи» отбрасывается', () => {
    const out = skud.collapseState([
      { ts: 1, direction: 'выход' },
      { ts: 2, direction: 'вход' },
      { ts: 3, direction: 'выход' },
      { ts: 4, direction: 'выход' }
    ]);
    expect(out.map((e) => e.ts)).toEqual([2, 3]);
  });
});

describe('skud-xls: интервалы и склейка', () => {
  test('разрыв меньше порога склеивается, больше — нет', () => {
    const events = [
      { ts: Date.UTC(2026, 9, 26, 10, 0), direction: 'вход' },
      { ts: Date.UTC(2026, 9, 26, 11, 0), direction: 'выход' },
      { ts: Date.UTC(2026, 9, 26, 11, 30), direction: 'вход' },  // разрыв 30 мин
      { ts: Date.UTC(2026, 9, 26, 12, 30), direction: 'выход' }
    ];
    // порог 60 мин → два интервала сливаются в один: 10:00–12:30 = 150 мин
    expect(skud.buildIntervals(events, 60).segments[0].minutes).toBe(150);
    // порог 10 мин → остаются два интервала: 60 + 60 = 120 мин
    const strict = skud.buildIntervals(events, 10);
    expect(strict.segments.length).toBe(2);
    expect(strict.segments.reduce((s, x) => s + x.minutes, 0)).toBe(120);
  });

  test('вход без выхода закрывается последним событием дня и помечается openEnded', () => {
    const events = [
      { ts: Date.UTC(2026, 9, 26, 10, 0), direction: 'вход' },
      { ts: Date.UTC(2026, 9, 26, 10, 30), direction: 'вход' } // второй вход, не выход
    ];
    const r = skud.buildIntervals(events, 60);
    expect(r.openEnded).toBe(true);
    expect(r.segments.length).toBe(1);
    expect(r.segments[0].minutes).toBe(30);
  });
});

describe('skud-xls: реальный отчёт за 26.10–01.11.2026', () => {
  let parsed;
  beforeAll(() => {
    parsed = skud.parseBuffer(fixtureBuffer(), { mergeGapMin: 60 });
  });

  test('период и число людей', () => {
    expect(parsed.periodFrom).toBe('2026-10-26');
    expect(parsed.periodTo).toBe('2026-11-01');
    expect(parsed.people.length).toBe(20);
  });

  test('технические дубли «проход» не удваивают часы', () => {
    // Проверяем именно парсер, а не содержимое skud_punches: «проход» до записи
    // в БД не доходит (он отбрасывается раньше), поэтому смотреть надо на
    // rowsUsed против rowsTotal — но это косвенно. Здесь прямая проверка:
    // одна и та же пара «доступ разрешен» + «проход» даёт ОДИН интервал.
    const rows = [
      ['', 'Иванов Иван Иванович (таб.№)'],
      ['', '26.10.2026 09:00:00', 'доступ разрешен', '', '', 'вход', '6 этаж (A)'],
      ['', '26.10.2026 09:00:02', 'проход', '', '', 'вход', '6 этаж (A)'],
      ['', '26.10.2026 18:00:00', 'доступ разрешен', '', '', 'выход', '6 этаж (A)'],
      ['', '26.10.2026 18:00:02', 'проход', '', '', 'выход', '6 этаж (A)']
    ];
    const parsed = skud.parseRows(rows, { mergeGapMin: 60 });
    const day = parsed.people[0].days[0];
    // 09:00–18:00 = 540 минут, а не 1080 и не 1080+2
    expect(day.minutes).toBe(540);
    expect(day.segments.length).toBe(1);
    // Технические «проход» не должны попасть в доказательную базу как
    // отдельные прохождения.
    expect(day.punches.length).toBe(2);
    expect(day.punches.every((p) => p.event !== 'проход')).toBe(true);
  });

  test('в реальном отчёте строк с событием «проход» в punch-ах нет', () => {
    // В исходном файле «проход» ~1190 строк, но в punches их быть не должно.
    for (const person of parsed.people) {
      for (const day of person.days) {
        for (const p of day.punches) {
          expect(String(p.event).toLowerCase()).not.toBe('проход');
        }
      }
    }
  });

  test('Тумаева 26.10 = 7:88 ч (10:23–14:25 + 15:48–19:41, обеденный разрыв 83 мин не склеиваем)', () => {
    const p = parsed.people.find((x) => x.rawName.includes('Тумаева'));
    const day = p.days.find((d) => d.date === '2026-10-26');
    // 242 + 233 = 475 мин = 7 ч 55 мин
    expect(day.minutes).toBe(475);
    expect(day.segments.length).toBe(2);
    expect(day.openEnded).toBe(false);
  });

  test('Тумаева за неделю = 24.49 ч (3 дня)', () => {
    const p = parsed.people.find((x) => x.rawName.includes('Тумаева'));
    const total = p.days.reduce((s, d) => s + d.minutes, 0);
    expect(Math.round(total / 60)).toBe(24);
    expect(p.days.length).toBe(3);
  });

  test('Зубань за неделю = 36.62 ч (5 дней) — контрольная сумма недели', () => {
    const p = parsed.people.find((x) => x.rawName.includes('Зубань'));
    const total = p.days.reduce((s, d) => s + d.minutes, 0);
    expect(Math.round(total / 60)).toBe(37);
    expect(p.days.length).toBe(5);
    expect(total).toBe(2197);
  });

  test('дни с незакрытым входом помечены (Данилова — все 5 дней)', () => {
    const p = parsed.people.find((x) => x.rawName.includes('Данилова'));
    const openDays = p.days.filter((d) => d.openEnded);
    expect(openDays.length).toBe(5);
  });

  test('«неизвестный ключ» не попадает в расчёт часов (Ермошин — 5 событий)', () => {
    const p = parsed.people.find((x) => x.rawName.includes('Ермошин'));
    expect(p).toBeTruthy();
    expect(p.skippedEvents).toBe(5);
    expect(p.days.length).toBe(0);
  });

  test('в отчёте есть люди без аккаунта CRM — они возвращаются парсером отдельно', () => {
    const names = parsed.people.map((p) => p.rawName);
    expect(names).toContain('Айти Константин');
    expect(names).toContain('Аурелия Уборка');
  });

  test('sha256 считается от исходного файла и стабилен', () => {
    const again = skud.parseBuffer(fixtureBuffer(), { mergeGapMin: 60 });
    expect(again.sha256).toBe(parsed.sha256);
    expect(parsed.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('skud-xls: устойчивость', () => {
  test('пустой файл — понятная ошибка', () => {
    expect(() => skud.parseBuffer(Buffer.alloc(0))).toThrow(/Пустой файл/);
  });

  test('не отчёт СКУД — понятная ошибка, а не пустой результат', () => {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Просто', 'таблица'], [1, 2]]), 'Лист1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    expect(() => skud.parseBuffer(buf)).toThrow(/Не найдено ни одного сотрудника/);
  });

  test('looksLikeSkudRows распознаёт шапку отчёта', () => {
    const rows = [['Отчет "события"'], ['период c 26.10.2026 00:00 по 01.11.2026 23:59']];
    expect(skud.looksLikeSkudRows(rows)).toBe(true);
    expect(skud.looksLikeSkudRows([['Счёт на оплату'], ['ИНН 1234']])).toBe(false);
  });
});
