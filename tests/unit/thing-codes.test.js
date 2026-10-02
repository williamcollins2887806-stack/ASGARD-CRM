'use strict';

const {
  generateSlug,
  generateDialCode,
  isDialCode,
  isSlug
} = require('../../src/services/thing-codes');
const { buildThingProtocolPrompt } = require('../../src/prompts/thing-protocol-prompt');

describe('thing-codes', () => {
  test('dial_code is exactly 6 digits, not starting with 0', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateDialCode();
      expect(isDialCode(c)).toBe(true);
      expect(c[0]).not.toBe('0');
    }
  });

  test('slug is lowercase alnum for URL, not presented as phone code', () => {
    for (let i = 0; i < 20; i++) {
      const s = generateSlug(6);
      expect(isSlug(s)).toBe(true);
      expect(isDialCode(s)).toBe(false);
    }
  });

  test('rejects letter dial codes', () => {
    expect(isDialCode('K7M2QX')).toBe(false);
    expect(isDialCode('48291')).toBe(false);
    expect(isDialCode('482917')).toBe(true);
  });
});

describe('thing-protocol-prompt', () => {
  test('builds JSON-oriented prompt without inventing speakers', () => {
    const p = buildThingProtocolPrompt({
      title: 'Тест',
      segments: [{ start: '0:01', end: '0:05', speaker: 'A', text: 'Сделаем отчёт' }],
      participants: [{ display_name: 'Иван', role: 'host' }]
    });
    expect(p.system).toMatch(/JSON/);
    expect(p.user).toMatch(/Сделаем отчёт/);
    expect(p.user).toMatch(/Иван/);
  });
});
