'use strict';

/**
 * Тесты норм и зачёта часов (office-hours). Чистые функции — без БД.
 *
 * Запуск: npx jest tests/unit/office-hours.test.js
 */

const oh = require('../../src/services/office-hours');

const settings = { ...oh.DEFAULTS, norm_hours_per_day: 8, norm_overrides: {} };
// Производственный календарь на неделю 26–31 октября 2026 (пн–сб), без праздников.
const calendar = {};

describe('office-hours: календарь и норма дня', () => {
  test('пн–пт рабочие, сб/вс — нет', () => {
    expect(oh.isWorkingDay('2026-10-26', calendar)).toBe(true); // пн
    expect(oh.isWorkingDay('2026-10-30', calendar)).toBe(true); // пт
    expect(oh.isWorkingDay('2026-10-31', calendar)).toBe(false); // сб
    expect(oh.isWorkingDay('2026-11-01', calendar)).toBe(false); // вс
  });

  test('праздник из work_calendar перекрывает правило сб/вс', () => {
    const cal = { '2026-11-04': { isWorking: false, kind: 'holiday', title: 'День народного единства' } };
    expect(oh.isWorkingDay('2026-11-04', cal)).toBe(false); // среда, но праздник
  });

  test('перенос рабочего дня на субботу (kind=working)', () => {
    const cal = { '2026-10-31': { isWorking: true, kind: 'working' } };
    expect(oh.isWorkingDay('2026-10-31', cal)).toBe(true);
  });

  test('норма дня 8 ч = 480 минут в рабочий день', () => {
    expect(oh.dayNormMinutes('2026-10-26', calendar, settings, 5)).toBe(480);
  });

  test('норма дня 0 в выходной', () => {
    expect(oh.dayNormMinutes('2026-10-31', calendar, settings, 5)).toBe(0);
  });

  test('индивидуальное переопределение нормы (например 6 ч для совместителя)', () => {
    const s = { ...settings, norm_overrides: { 42: 6 } };
    expect(oh.dayNormMinutes('2026-10-26', calendar, s, 42)).toBe(360);
    expect(oh.dayNormMinutes('2026-10-26', calendar, s, 43)).toBe(480);
  });
});

describe('office-hours: зачёт офис + СРМ вне офиса', () => {
  const base = { normMinutes: 480, crmHasData: true, skudMissing: false };

  test('«оф» без сессий СРМ: только СКУД (СРМ без времени не прибавляем — иначе двойной учёт)', () => {
    const r = oh.creditDay({ ...base, date: '2026-10-26', statusCode: 'оф', officeMinutes: 475, crmMinutes: 300 });
    expect(r.source).toBe('skud');
    expect(r.credited_minutes).toBe(475);
    expect(r.counts_in_norm).toBe(true);
  });

  test('2 ч офис + 5 ч СРМ дома = 7 ч (СРМ в окне СКУД вычтена)', () => {
    const r = oh.creditDay({
      ...base,
      date: '2026-10-26',
      statusCode: 'оф',
      officeMinutes: 120,
      crmMinutes: 360,
      officeSegments: [{ from: '2026-10-26T09:00:00.000Z', to: '2026-10-26T11:00:00.000Z', minutes: 120 }],
      crmSessions: [
        { from: '09:30', to: '10:29', minutes: 60 },   // в офисе — не считаем
        { from: '18:00', to: '22:59', minutes: 300 }  // дома — считаем
      ]
    });
    expect(r.source).toBe('hybrid');
    expect(r.crm_remote_minutes).toBe(300);
    expect(r.credited_minutes).toBe(420); // 120 + 300
  });

  test('«уд» зачитывает часы СРМ', () => {
    const r = oh.creditDay({ ...base, date: '2026-10-26', statusCode: 'уд', officeMinutes: 0, crmMinutes: 420 });
    expect(r.source).toBe('crm');
    expect(r.credited_minutes).toBe(420);
  });

  test('«об/км/пг/уч/ск» — тоже часы СРМ', () => {
    for (const s of ['об', 'км', 'пг', 'уч', 'ск']) {
      const r = oh.creditDay({ ...base, date: '2026-10-26', statusCode: s, officeMinutes: 0, crmMinutes: 240 });
      expect(r.source).toBe('crm');
      expect(r.credited_minutes).toBe(240);
    }
  });

  test('crmMinutesOutsideOffice: вся СРМ внутри офиса → 0', () => {
    const remote = oh.crmMinutesOutsideOffice(
      [{ from: '10:00', to: '10:59', minutes: 60 }],
      [{ from: '2026-10-26T09:00:00.000Z', to: '2026-10-26T12:00:00.000Z', minutes: 180 }]
    );
    expect(remote).toBe(0);
  });

  test('«бн/сс/вх/отп» — день выпадает из нормы, недоработка не начисляется', () => {
    for (const s of ['бн', 'сс', 'вх', 'отп']) {
      const r = oh.creditDay({ ...base, date: '2026-10-26', statusCode: s, officeMinutes: 0, crmMinutes: 0 });
      expect(r.source).toBe('excluded');
      expect(r.counts_in_norm).toBe(false);
      expect(r.credited_minutes).toBe(0);
    }
  });

  test('«нп» (снят ложный оф) в норму не идёт и недоработку не начисляет', () => {
    const r = oh.creditDay({ ...base, date: '2026-10-26', statusCode: 'нп', officeMinutes: 0, crmMinutes: 0 });
    expect(r.source).toBe('unconfirmed');
    expect(r.counts_in_norm).toBe(false);
    expect(r.warn).toBe('not_confirmed');
  });

  test('«оф» без единого прохода — 0 зачёта и предупреждение no_punches', () => {
    const r = oh.creditDay({ ...base, date: '2026-10-26', statusCode: 'оф', officeMinutes: 0, crmMinutes: 120 });
    expect(r.credited_minutes).toBe(0);
    expect(r.warn).toBe('no_punches');
  });

  test('нет импорта СКУД за день — предупреждение skud_missing, а не «прогул»', () => {
    const r = oh.creditDay({ ...base, skudMissing: true, date: '2026-10-26', statusCode: 'оф', officeMinutes: 0, crmMinutes: 0 });
    expect(r.warn).toBe('skud_missing');
  });

  test('часы СРМ до выкатки серверного учёта не начисляют недоработку', () => {
    const r = oh.creditDay({
      ...base, crmHasData: false, date: '2026-09-15', statusCode: 'уд', officeMinutes: 0, crmMinutes: 0
    });
    expect(r.source).toBe('no_crm_data');
    expect(r.counts_in_norm).toBe(false);
  });

  test('статуса нет, но СКУД видел человека — часы всё равно факт', () => {
    const r = oh.creditDay({ ...base, date: '2026-10-26', statusCode: null, officeMinutes: 300, crmMinutes: 0 });
    expect(r.source).toBe('skud_no_status');
    expect(r.credited_minutes).toBe(300);
  });

  test('нерабочий день — dayoff, нормы нет', () => {
    const r = oh.creditDay({ ...base, normMinutes: 0, date: '2026-10-31', statusCode: 'оф', officeMinutes: 100, crmMinutes: 0 });
    expect(r.source).toBe('dayoff');
    expect(r.counts_in_norm).toBe(false);
  });

  // Регрессия 03.11.2026: на проде у людей без отметки в графике был реальный
  // труд в СРМ (серверный счётчик), а зачёт давал 0 → ложная недоработка.
  test('статуса нет, но в СРМ была активность — засчитываем часы СРМ', () => {
    const r = oh.creditDay({ ...base, date: '2026-10-28', statusCode: null, officeMinutes: 0, crmMinutes: 480 });
    expect(r.source).toBe('crm_no_status');
    expect(r.credited_minutes).toBe(480);
    expect(r.counts_in_norm).toBe(true);
  });

  test('статуса нет и данных нет — день не судим', () => {
    const r = oh.creditDay({
      ...base, date: '2026-10-28', statusCode: null, officeMinutes: 0, crmMinutes: 0, crmHasData: false, skudMissing: true
    });
    expect(r.source).toBe('no_data');
    expect(r.counts_in_norm).toBe(false);
  });
});

describe('office-hours: свод и недоработка', () => {
  test('полная неделя 5×8 с 7-часовыми днями даёт −5 ч', () => {
    const days = [];
    for (const d of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']) {
      days.push(oh.creditDay({
        date: d, statusCode: 'оф', officeMinutes: 420, crmMinutes: 0,
        crmHasData: true, skudMissing: false, normMinutes: 480
      }));
    }
    const s = oh.summarizeDays(days);
    expect(s.norm_minutes).toBe(2400);
    expect(s.credited_minutes).toBe(2100);
    expect(s.delta_minutes).toBe(-300);
    expect(s.delta_hours).toBe(-5);
    expect(s.days_counted).toBe(5);
  });

  test('переработка сверх нормы дня не раздувает зачёт (потолок — норма дня)', () => {
    const r = oh.creditDay({
      date: '2026-10-26', statusCode: 'оф', officeMinutes: 600, crmMinutes: 0,
      crmHasData: true, skudMissing: false, normMinutes: 480
    });
    const s = oh.summarizeDays([r]);
    expect(r.credited_minutes).toBe(600);   // факт показываем как есть
    expect(s.credited_minutes).toBe(480);   // но в норму идёт не больше 480
    expect(s.delta_minutes).toBe(0);
  });

  test('отпуск не создаёт фиктивной нормы', () => {
    const days = [
      oh.creditDay({ date: '2026-10-26', statusCode: 'отп', officeMinutes: 0, crmMinutes: 0, crmHasData: true, skudMissing: false, normMinutes: 480 }),
      oh.creditDay({ date: '2026-10-27', statusCode: 'оф', officeMinutes: 480, crmMinutes: 0, crmHasData: true, skudMissing: false, normMinutes: 480 })
    ];
    const s = oh.summarizeDays(days);
    expect(s.norm_minutes).toBe(480);   // только второй день
    expect(s.delta_minutes).toBe(0);
    expect(s.days_counted).toBe(1);
  });
});

describe('office-hours: границы периодов', () => {
  test('понедельник недели', () => {
    expect(oh.mondayOf('2026-10-26')).toBe('2026-10-26'); // пн
    expect(oh.mondayOf('2026-10-29')).toBe('2026-10-26'); // чт
    expect(oh.mondayOf('2026-11-01')).toBe('2026-10-26'); // вс → пн той же недели
    expect(oh.mondayOf('2026-11-02')).toBe('2026-11-02'); // следующий пн
  });

  test('диапазон месяца', () => {
    expect(oh.monthRange(2026, 10)).toEqual({ from: '2026-10-01', to: '2026-10-31', daysInMonth: 31 });
    expect(oh.monthRange(2026, 2)).toEqual({ from: '2026-02-01', to: '2026-02-28', daysInMonth: 28 });
    expect(oh.monthRange(2024, 2)).toEqual({ from: '2024-02-01', to: '2024-02-29', daysInMonth: 29 });
  });

  test('addDays через границу месяца', () => {
    expect(oh.addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(oh.addDays('2026-11-01', -1)).toBe('2026-10-31');
  });
});

describe('office-hours: список статусов для ответа на гейт', () => {
  test('«оф» и «нп» запрещены, остальные разрешены', () => {
    expect(oh.DISPUTE_ALLOWED).not.toContain('оф');
    expect(oh.DISPUTE_ALLOWED).not.toContain('нп');
    expect(oh.DISPUTE_ALLOWED).toContain('уд');
    expect(oh.DISPUTE_ALLOWED).toContain('бн');
  });
});

describe('office-hours: канонизация кода статуса', () => {
  // Верификатор 03.11.2026: «ОФ», « оф », «оф\u200B» (zero-width space)
  // проходили запрет «оф без прохода», потому что код сравнивался строго.
  test('регистр и пробелы не меняют поведения', () => {
    const base = { date: '2026-10-29', officeMinutes: 300, crmMinutes: 0, crmHasData: true, skudMissing: false, normMinutes: 480 };
    for (const s of ['оф', 'ОФ', ' оф', 'оф ']) {
      const r = oh.creditDay({ ...base, statusCode: s });
      expect(r.source).toBe('skud');
      expect(r.credited_minutes).toBe(300);
    }
  });

  test('невидимый символ внутри кода не ломает распознавание', () => {
    const base = { date: '2026-10-29', officeMinutes: 300, crmMinutes: 0, crmHasData: true, skudMissing: false, normMinutes: 480 };
    const r = oh.creditDay({ ...base, statusCode: 'оф\u200B' });
    expect(r.source).toBe('skud');
    expect(r.credited_minutes).toBe(300);
  });

  test('«НП» в верхнем регистре всё ещё «не подтверждён»', () => {
    const r = oh.creditDay({
      date: '2026-10-29', statusCode: 'НП', officeMinutes: 0, crmMinutes: 0,
      crmHasData: true, skudMissing: false, normMinutes: 480
    });
    expect(r.source).toBe('unconfirmed');
    expect(r.counts_in_norm).toBe(false);
  });
});
