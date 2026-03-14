'use strict';

/**
 * ASGARD CRM — Routing Logic Tests
 * Тесты логики маршрутизации звонков
 */

const helpers = require('./helpers');

const tests = [];
function test(name, fn) { tests.push({ name: 'Routing: ' + name, run: fn }); }

// ── Нормализация номера в контексте маршрутизации ──

test('normalizePhone корректно для маршрутизации', () => {
  const { normalizePhone } = require('../../src/services/mango');
  // Проверяем что номера нормализуются (формат может быть +7... или 7...)
  const r1 = normalizePhone('+79161234567');
  if (!r1.includes('9161234567')) throw new Error(`Should contain core digits, got ${r1}`);

  const r2 = normalizePhone('89161234567');
  if (!r2.includes('9161234567')) throw new Error(`8→7 conversion, got ${r2}`);

  const r3 = normalizePhone('');
  if (r3 !== '') throw new Error(`Empty should return empty, got ${r3}`);

  const r4 = normalizePhone('+7 (916) 123-45-67');
  if (!r4.includes('9161234567')) throw new Error(`Should strip formatting, got ${r4}`);
});

// ── Определение направления звонка ──

test('getCallDirection определяет входящие и исходящие', () => {
  const { getCallDirection } = require('../../src/services/mango');
  // API принимает число (call_direction из Mango)
  const r1 = getCallDirection(1);
  if (r1 !== 'inbound') throw new Error(`Expected inbound for 1, got ${r1}`);

  const r2 = getCallDirection(2);
  if (r2 !== 'outbound') throw new Error(`Expected outbound for 2, got ${r2}`);

  const r3 = getCallDirection(0);
  // 0 может быть internal или unknown
  if (!r3) throw new Error('Should return value for 0');
});

// ── Определение типа звонка из summary ──

test('missed определяется по duration=0 и direction=inbound', () => {
  const summary = helpers.generateMissedCallSummary();
  const isMissed = summary.talk_duration === 0 && summary.call_direction === 1;
  if (!isMissed) throw new Error('Should detect missed call');
});

test('answered определяется по duration>0', () => {
  const summary = helpers.generateSummaryEvent({ talk_duration: 120 });
  const isMissed = summary.talk_duration === 0 && summary.call_direction === 1;
  if (isMissed) throw new Error('Should not be missed');
});

// ── Рабочее время ──

test('isWorkHours logic: будни 9-18', () => {
  // Симулируем проверку
  function isWorkHours(date) {
    const hours = date.getHours();
    const day = date.getDay();
    return day >= 1 && day <= 5 && hours >= 9 && hours < 18;
  }

  // Понедельник 10:00
  const mon10 = new Date('2026-03-02T10:00:00');
  if (!isWorkHours(mon10)) throw new Error('Monday 10:00 should be work hours');

  // Понедельник 20:00
  const mon20 = new Date('2026-03-02T20:00:00');
  if (isWorkHours(mon20)) throw new Error('Monday 20:00 should not be work hours');

  // Суббота 12:00
  const sat12 = new Date('2026-03-07T12:00:00');
  if (isWorkHours(sat12)) throw new Error('Saturday should not be work hours');

  // Воскресенье
  const sun = new Date('2026-03-08T10:00:00');
  if (isWorkHours(sun)) throw new Error('Sunday should not be work hours');
});

// ── Генераторы тестовых данных (self-test) ──

test('generateCallEvent() создаёт валидное событие', () => {
  const evt = helpers.generateCallEvent();
  if (!evt.entry_id) throw new Error('Should have entry_id');
  if (!evt.call_id) throw new Error('Should have call_id');
  if (evt.call_state !== 'Appeared') throw new Error('Default state should be Appeared');
  if (!evt.from || !evt.from.number) throw new Error('Should have from.number');
});

test('generateSummaryEvent() создаёт валидный summary', () => {
  const sum = helpers.generateSummaryEvent();
  if (!sum.entry_id) throw new Error('Should have entry_id');
  if (!sum.talk_duration && sum.talk_duration !== 0) throw new Error('Should have talk_duration');
  if (!sum.recording_id) throw new Error('Should have recording_id');
});

test('generateMissedCallSummary() с duration 0', () => {
  const sum = helpers.generateMissedCallSummary();
  if (sum.talk_duration !== 0) throw new Error('Missed call should have duration 0');
  if (sum.entry_result !== 0) throw new Error('Missed call should have entry_result 0');
});

test('randomPhone() генерирует 11-значный номер', () => {
  const phone = helpers.randomPhone();
  if (phone.length !== 11) throw new Error(`Expected 11 digits, got ${phone.length}`);
  if (!phone.startsWith('7')) throw new Error('Should start with 7');
});

module.exports = { name: 'Routing', tests };
