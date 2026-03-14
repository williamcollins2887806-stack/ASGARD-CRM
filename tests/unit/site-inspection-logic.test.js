'use strict';

/**
 * Site Inspection — Business Logic Unit Tests
 *
 * Pure business-logic tests that do NOT require:
 *   - Database connections
 *   - Browser / DOM APIs
 *   - Network access
 *
 * Run with:  npx jest tests/unit/site-inspection-logic.test.js
 *        or: npm run test:unit
 */

// ═══════════════════════════════════════════════════════════════════════════
// Status transition matrices (mirrors backend site_inspections.js)
// ═══════════════════════════════════════════════════════════════════════════

const INSPECTION_TRANSITIONS = {
  draft:        ['sent'],
  sent:         ['approved', 'rejected'],
  approved:     ['trip_planned'],
  rejected:     ['draft'],
  trip_planned: ['trip_sent', 'completed'],
  trip_sent:    ['completed'],
  completed:    [],
};

const TRIP_TRANSITIONS = {
  draft:     ['sent'],
  sent:      ['approved', 'rejected'],
  approved:  ['completed'],
  rejected:  ['draft'],
  completed: [],
};

function isValidTransition(matrix, from, to) {
  const allowed = matrix[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

// ═══════════════════════════════════════════════════════════════════════════
// Date validation (mirrors backend)
// ═══════════════════════════════════════════════════════════════════════════

function validateInspectionDates(dates) {
  if (!Array.isArray(dates)) return { valid: false, error: 'dates must be an array' };
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    if (!d || typeof d !== 'object') return { valid: false, error: `dates[${i}] must be an object` };
    if (!d.date || !/^\d{4}-\d{2}-\d{2}$/.test(d.date))
      return { valid: false, error: `dates[${i}].date must be YYYY-MM-DD` };
    if (d.time_from && !/^\d{2}:\d{2}$/.test(d.time_from))
      return { valid: false, error: `dates[${i}].time_from must be HH:MM` };
    if (d.time_to && !/^\d{2}:\d{2}$/.test(d.time_to))
      return { valid: false, error: `dates[${i}].time_to must be HH:MM` };
    const dateObj = new Date(d.date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dateObj < today) return { valid: false, error: `dates[${i}].date is in the past` };
  }
  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Email body builder (mirrors frontend site_inspections.js)
// ═══════════════════════════════════════════════════════════════════════════

function buildEmailBody(si) {
  const dates = Array.isArray(si.inspection_dates) ? si.inspection_dates : [];
  const employees = Array.isArray(si.employees_json) ? si.employees_json : [];
  const vehicles = Array.isArray(si.vehicles_json) ? si.vehicles_json : [];

  let text = `Уважаемый(ая) ${si.customer_contact_person || 'коллега'},\n\n`;
  text += `Направляем заявку на осмотр объекта: ${si.object_name || '—'}\n`;
  if (si.object_address) text += `Адрес: ${si.object_address}\n`;
  text += '\n';

  if (dates.length) {
    text += 'Возможные даты осмотра:\n';
    dates.forEach((d, i) => {
      text += `  ${i + 1}. ${d.date || '—'} с ${d.time_from || '—'} до ${d.time_to || '—'}\n`;
    });
    text += '\n';
  }

  if (employees.length) {
    text += 'Данные сотрудников:\n';
    employees.forEach((e, i) => {
      const passport = (e.passport_series && e.passport_number)
        ? `, паспорт: ${e.passport_series} ${e.passport_number}` : '';
      text += `  ${i + 1}. ${e.fio || '—'}${e.position ? ', ' + e.position : ''}${passport}${e.phone ? ', тел: ' + e.phone : ''}\n`;
    });
    text += '\n';
  }

  if (vehicles.length) {
    text += 'Транспорт:\n';
    vehicles.forEach((v, i) => {
      if (v.brand || v.plate_number) {
        text += `  ${i + 1}. ${v.brand || ''} ${v.model || ''}, гос. номер: ${v.plate_number || '—'}${v.driver_fio ? ', водитель: ' + v.driver_fio : ''}\n`;
      }
    });
    text += '\n';
  }

  text += 'С уважением,\nООО «АСГАРД-СЕРВИС»';
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests (Jest)
// ═══════════════════════════════════════════════════════════════════════════

describe('Site Inspection Status Transitions', () => {
  test('draft -> sent is valid', () => {
    expect(isValidTransition(INSPECTION_TRANSITIONS, 'draft', 'sent')).toBe(true);
  });

  test('draft -> approved is invalid', () => {
    expect(isValidTransition(INSPECTION_TRANSITIONS, 'draft', 'approved')).toBe(false);
  });

  test('draft -> completed is invalid', () => {
    expect(isValidTransition(INSPECTION_TRANSITIONS, 'draft', 'completed')).toBe(false);
  });

  test('sent -> approved is valid', () => {
    expect(isValidTransition(INSPECTION_TRANSITIONS, 'sent', 'approved')).toBe(true);
  });

  test('sent -> rejected is valid', () => {
    expect(isValidTransition(INSPECTION_TRANSITIONS, 'sent', 'rejected')).toBe(true);
  });

  test('rejected -> draft is valid', () => {
    expect(isValidTransition(INSPECTION_TRANSITIONS, 'rejected', 'draft')).toBe(true);
  });

  test('approved -> trip_planned is valid', () => {
    expect(isValidTransition(INSPECTION_TRANSITIONS, 'approved', 'trip_planned')).toBe(true);
  });

  test('completed has no transitions', () => {
    expect(isValidTransition(INSPECTION_TRANSITIONS, 'completed', 'draft')).toBe(false);
    expect(isValidTransition(INSPECTION_TRANSITIONS, 'completed', 'sent')).toBe(false);
    expect(isValidTransition(INSPECTION_TRANSITIONS, 'completed', 'approved')).toBe(false);
  });

  test('trip_planned -> trip_sent is valid', () => {
    expect(isValidTransition(INSPECTION_TRANSITIONS, 'trip_planned', 'trip_sent')).toBe(true);
  });

  test('trip_planned -> completed is valid', () => {
    expect(isValidTransition(INSPECTION_TRANSITIONS, 'trip_planned', 'completed')).toBe(true);
  });

  test('unknown state returns false', () => {
    expect(isValidTransition(INSPECTION_TRANSITIONS, 'unknown', 'draft')).toBe(false);
  });
});

describe('Trip Status Transitions', () => {
  test('draft -> sent is valid', () => {
    expect(isValidTransition(TRIP_TRANSITIONS, 'draft', 'sent')).toBe(true);
  });

  test('sent -> approved is valid', () => {
    expect(isValidTransition(TRIP_TRANSITIONS, 'sent', 'approved')).toBe(true);
  });

  test('draft -> approved is invalid (must go through sent)', () => {
    expect(isValidTransition(TRIP_TRANSITIONS, 'draft', 'approved')).toBe(false);
  });

  test('approved -> completed is valid', () => {
    expect(isValidTransition(TRIP_TRANSITIONS, 'approved', 'completed')).toBe(true);
  });

  test('sent -> rejected is valid', () => {
    expect(isValidTransition(TRIP_TRANSITIONS, 'sent', 'rejected')).toBe(true);
  });

  test('rejected -> draft is valid (re-edit)', () => {
    expect(isValidTransition(TRIP_TRANSITIONS, 'rejected', 'draft')).toBe(true);
  });

  test('completed has no transitions', () => {
    expect(isValidTransition(TRIP_TRANSITIONS, 'completed', 'draft')).toBe(false);
  });
});

describe('Date Validation', () => {
  test('valid future date passes', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().slice(0, 10);
    const result = validateInspectionDates([{ date: dateStr, time_from: '09:00', time_to: '18:00' }]);
    expect(result.valid).toBe(true);
  });

  test('invalid format DD-MM-YYYY is rejected', () => {
    const result = validateInspectionDates([{ date: '01-03-2026', time_from: '09:00', time_to: '18:00' }]);
    expect(result.valid).toBe(false);
  });

  test('non-array is rejected', () => {
    const result = validateInspectionDates('not-an-array');
    expect(result.valid).toBe(false);
  });

  test('empty array is valid', () => {
    const result = validateInspectionDates([]);
    expect(result.valid).toBe(true);
  });

  test('invalid time format is rejected', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().slice(0, 10);
    const result = validateInspectionDates([{ date: dateStr, time_from: '9am', time_to: '6pm' }]);
    expect(result.valid).toBe(false);
  });

  test('null date entry is rejected', () => {
    const result = validateInspectionDates([null]);
    expect(result.valid).toBe(false);
  });

  test('missing date field is rejected', () => {
    const result = validateInspectionDates([{ time_from: '09:00' }]);
    expect(result.valid).toBe(false);
  });
});

describe('Email Body Generation', () => {
  test('contains object name', () => {
    const body = buildEmailBody({ object_name: 'Тестовый объект ООО Рога и Копыта' });
    expect(body).toContain('Тестовый объект ООО Рога и Копыта');
    expect(body).toContain('АСГАРД-СЕРВИС');
  });

  test('includes dates section', () => {
    const body = buildEmailBody({
      object_name: 'Объект',
      inspection_dates: [{ date: '2026-04-01', time_from: '09:00', time_to: '17:00' }],
    });
    expect(body).toContain('2026-04-01');
    expect(body).toContain('09:00');
    expect(body).toContain('17:00');
    expect(body).toContain('Возможные даты осмотра');
  });

  test('includes employees with passport data', () => {
    const body = buildEmailBody({
      object_name: 'Объект',
      employees_json: [{
        fio: 'Иванов Иван Иванович',
        position: 'Инженер',
        passport_series: '45 12',
        passport_number: '123456',
        phone: '+79001234567',
      }],
    });
    expect(body).toContain('Иванов Иван Иванович');
    expect(body).toContain('45 12');
    expect(body).toContain('123456');
    expect(body).toContain('+79001234567');
    expect(body).toContain('Данные сотрудников');
  });

  test('includes vehicles', () => {
    const body = buildEmailBody({
      object_name: 'Объект',
      vehicles_json: [{ brand: 'Toyota', model: 'Hilux', plate_number: 'А123БВ77', driver_fio: 'Петров П.П.' }],
    });
    expect(body).toContain('Toyota');
    expect(body).toContain('А123БВ77');
    expect(body).toContain('Петров П.П.');
    expect(body).toContain('Транспорт');
  });

  test('handles empty data gracefully', () => {
    const body = buildEmailBody({ object_name: 'Пустой объект' });
    expect(body).toContain('Пустой объект');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('null');
  });

  test('uses contact person in greeting', () => {
    const body = buildEmailBody({
      object_name: 'Объект',
      customer_contact_person: 'Сидорова Елена Петровна',
    });
    expect(body).toContain('Сидорова Елена Петровна');
    expect(body).toContain('Уважаемый(ая)');
  });

  test('uses default greeting when no contact person', () => {
    const body = buildEmailBody({ object_name: 'Объект' });
    expect(body).toContain('коллега');
  });

  test('includes address when provided', () => {
    const body = buildEmailBody({
      object_name: 'Объект',
      object_address: 'г. Москва, ул. Ленина, д. 1',
    });
    expect(body).toContain('г. Москва, ул. Ленина, д. 1');
    expect(body).toContain('Адрес:');
  });

  test('multiple dates are numbered', () => {
    const body = buildEmailBody({
      object_name: 'Объект',
      inspection_dates: [
        { date: '2026-04-01', time_from: '09:00', time_to: '17:00' },
        { date: '2026-04-02', time_from: '10:00', time_to: '16:00' },
      ],
    });
    expect(body).toContain('1. 2026-04-01');
    expect(body).toContain('2. 2026-04-02');
  });

  test('employee without passport omits passport info', () => {
    const body = buildEmailBody({
      object_name: 'Объект',
      employees_json: [{ fio: 'Петров П.П.', position: 'Менеджер' }],
    });
    expect(body).toContain('Петров П.П.');
    expect(body).not.toContain('паспорт');
  });
});
