'use strict';

/**
 * Тесты сопоставления «ФИО из СКУД → сотрудник». Чистые функции — без БД.
 *
 * Кейсы взяты из реального отчёта за 26.10–01.11.2026 и реального состава CRM,
 * потому что именно на них матчинг ломается:
 *   • «Морозов Иван Михайлович» в СКУД против «Морозов Иван» в CRM;
 *   • «Иванейкин Юрий Николаевич» против «Иванейкин Ю.Н.»;
 *   • «Тапенов Асан Сирикбаевич» — в CRM ДВА аккаунта (PM и FIELD_WORKER);
 *   • «Айти Константин», «Аурелия Уборка» — в CRM нет вовсе.
 *
 * Запуск: npx jest tests/unit/skud-people.test.js
 */

const skudPeople = require('../../src/services/skud-people');

/** Состав, как в проде (имена из users + staff). */
const STAFF = [
  { staff_id: 11, name: 'Путков Дмитрий Вадимович', user_id: 3465, role: 'PM' },
  { staff_id: 13, name: 'Иванейкин Ю.Н.', user_id: 3459, role: 'HEAD_PM' },
  { staff_id: 14, name: 'Бухгалтер', user_id: 3470, role: 'BUH' },
  { staff_id: 18, name: 'Тумаева Виктория Анатольевна', user_id: 3471, role: 'OFFICE_MANAGER' },
  { staff_id: 20, name: 'Морозов Иван', user_id: 3475, role: 'TO' },
  { staff_id: 21, name: 'Тапенов Асан Сирикбаевич', user_id: 4662, role: 'PM' },
  { staff_id: 22, name: 'Тапенов Асан Сирикбаевич', user_id: 4690, role: 'FIELD_WORKER' },
  { staff_id: 23, name: 'Зубань Руслан Владимирович', user_id: 4697, role: 'PM' }
];

describe('skud-people: нормализация и разбор ФИО', () => {
  test('ё и регистр не влияют', () => {
    expect(skudPeople.normalizeName('Аксёнов  Пётр')).toBe('аксенов петр');
  });

  test('точки в инициалах снимаются', () => {
    expect(skudPeople.normalizeName('Иванейкин Ю.Н.')).toBe('иванейкин ю н');
  });

  test('splitFio разбирает полное ФИО', () => {
    const s = skudPeople.splitFio('Морозов Иван Михайлович');
    expect(s.surname).toBe('морозов');
    expect(s.name).toBe('иван');
    expect(s.patronymic).toBe('михайлович');
  });
});

describe('skud-people: точные совпадения', () => {
  test('полное ФИО совпало → confidence 1.0', () => {
    const m = skudPeople.matchCandidates('Путков Дмитрий Вадимович', STAFF);
    expect(m.best.staff_id).toBe(11);
    expect(m.confidence).toBe(1);
  });

  test('Зубань — точное совпадение, хотя его нет в старом локальном снимке', () => {
    const m = skudPeople.matchCandidates('Зубань Руслан Владимирович', STAFF);
    expect(m.best.staff_id).toBe(23);
  });
});

describe('skud-people: неполное ФИО в CRM', () => {
  test('«Морозов Иван Михайлович» (СКУД) → «Морозов Иван» (CRM), не полное доверие', () => {
    const m = skudPeople.matchCandidates('Морозов Иван Михайлович', STAFF);
    expect(m.best).not.toBeNull();
    expect(m.best.staff_id).toBe(20);
    // 0.7 — хорошая догадка, но её видно в списке как «проверить»
    expect(m.confidence).toBeCloseTo(0.7, 3);
  });

  test('«Иванейкин Юрий Николаевич» → «Иванейкин Ю.Н.», по инициалам', () => {
    const m = skudPeople.matchCandidates('Иванейкин Юрий Николаевич', STAFF);
    expect(m.best.staff_id).toBe(13);
    expect(m.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

describe('skud-people: двусмысленность не угадывается', () => {
  test('два аккаунта Тапенова → не выбираем сами', () => {
    const m = skudPeople.matchCandidates('Тапенов Асан Сирикбаевич', STAFF);
    expect(m.ambiguous).toBe(true);
    expect(m.best).toBeNull();
    expect(m.candidates.length).toBeGreaterThan(1);
  });
});

describe('skud-people: людей вне CRM не придумываем', () => {
  test('«Айти Константин» — нет кандидатов', () => {
    const m = skudPeople.matchCandidates('Айти Константин', STAFF);
    expect(m.best).toBeNull();
    expect(m.confidence).toBe(0);
  });

  test('«Аурелия Уборка» — нет кандидатов', () => {
    const m = skudPeople.matchCandidates('Аурелия Уборка', STAFF);
    expect(m.best).toBeNull();
  });

  test('однофамилец с другим именем не привязывается молча', () => {
    const staff = [
      { staff_id: 1, name: 'Иванов Пётр Сергеевич', user_id: 1 },
      { staff_id: 2, name: 'Иванов Илья Петрович', user_id: 2 }
    ];
    const m = skudPeople.matchCandidates('Иванов Сидор Кузьмич', staff);
    expect(m.best).toBeNull();
  });
});
