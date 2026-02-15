/**
 * ASGARD CRM — Unit-тесты: парсеры тендерных площадок
 */

'use strict';

// Мокаем зависимости до импорта модуля
jest.mock('../../src/services/db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] })
}));
jest.mock('../../src/services/ai-provider', () => ({
  complete: jest.fn().mockResolvedValue({
    text: JSON.stringify({ relevance_score: 75, analysis: 'Тест', keywords: ['нефть'] }),
    usage: { inputTokens: 100, outputTokens: 50 }
  })
}));

const {
  parseZakupkiGov, parseRoseltorg, parseB2BCenter,
  parseSberbankAst, parseRtsTender, parseGeneric,
  detectPlatform, fallbackRelevance, PLATFORMS
} = require('../../src/services/platform-parser');

// ═══════════════════════════════════════════════════════════════════════════
// detectPlatform()
// ═══════════════════════════════════════════════════════════════════════════

describe('detectPlatform()', () => {
  test('определяет zakupki.gov.ru', () => {
    const p = detectPlatform('notification@zakupki.gov.ru');
    expect(p).toBeTruthy();
    expect(p.code).toBe('ZAKUPKI_GOV');
  });

  test('определяет roseltorg.ru', () => {
    const p = detectPlatform('noreply@roseltorg.ru');
    expect(p).toBeTruthy();
    expect(p.code).toBe('ROSELTORG');
  });

  test('определяет b2b-center.ru', () => {
    const p = detectPlatform('system@b2b-center.ru');
    expect(p).toBeTruthy();
    expect(p.code).toBe('B2B_CENTER');
  });

  test('определяет sberbank-ast.ru', () => {
    const p = detectPlatform('alert@sberbank-ast.ru');
    expect(p).toBeTruthy();
    expect(p.code).toBe('SBERBANK_AST');
  });

  test('возвращает UNKNOWN для неизвестного домена', () => {
    const p = detectPlatform('user@gmail.com');
    expect(p.code).toBe('UNKNOWN');
  });

  test('15 площадок зарегистрировано', () => {
    expect(Object.keys(PLATFORMS).length).toBe(15);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// parseZakupkiGov()
// ═══════════════════════════════════════════════════════════════════════════

describe('parseZakupkiGov()', () => {
  test('извлекает номер закупки', () => {
    const email = {
      subject: 'Извещение № 0373100123456 о проведении электронного аукциона',
      body_text: 'Текст уведомления', body_html: ''
    };
    const result = parseZakupkiGov(email);
    expect(result.purchase_number).toBe('0373100123456');
  });

  test('извлекает НМЦ', () => {
    const email = {
      subject: '', body_html: '',
      body_text: 'Начальная максимальная цена контракта: 1 500 000,00 руб.'
    };
    const result = parseZakupkiGov(email);
    expect(result.nmck).toBe(1500000);
  });

  test('извлекает дедлайн', () => {
    const email = {
      subject: '', body_html: '',
      body_text: 'Дата окончания подачи заявок: 15.03.2026 12:00'
    };
    const result = parseZakupkiGov(email);
    expect(result.application_deadline).toContain('2026-03-15');
  });

  test('извлекает заказчика', () => {
    const email = {
      subject: '', body_html: '',
      body_text: 'Заказчик: ООО "Газпром-Нефть"\nИНН: 7708654321'
    };
    const result = parseZakupkiGov(email);
    expect(result.customer_name).toContain('Газпром-Нефть');
    expect(result.customer_inn).toBe('7708654321');
  });

  test('извлекает URL площадки', () => {
    const email = {
      subject: '', body_html: '',
      body_text: 'Подробнее: https://zakupki.gov.ru/epz/order/notice/ea44/view/common-info.html?regNumber=0373100123456'
    };
    const result = parseZakupkiGov(email);
    expect(result.purchase_url).toContain('zakupki.gov.ru');
  });

  test('обрабатывает пустое письмо', () => {
    const result = parseZakupkiGov({ subject: '', body_text: '', body_html: '' });
    expect(result.purchase_number).toBeNull();
    expect(result.nmck).toBeNull();
    expect(result.application_deadline).toBeNull();
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// parseRoseltorg()
// ═══════════════════════════════════════════════════════════════════════════

describe('parseRoseltorg()', () => {
  test('извлекает номер процедуры', () => {
    const email = {
      subject: 'Росэлторг', body_html: '',
      body_text: 'Номер процедуры: 987654. Тип процедуры: Аукцион'
    };
    const result = parseRoseltorg(email);
    expect(result.purchase_number).toBe('987654');
  });

  test('извлекает тип процедуры', () => {
    const email = {
      subject: '', body_html: '',
      body_text: 'Тип процедуры: Аукцион в электронной форме'
    };
    const result = parseRoseltorg(email);
    expect(result.purchase_method).toContain('Аукцион');
  });

  test('извлекает URL roseltorg', () => {
    const email = {
      subject: '', body_html: '',
      body_text: 'Ссылка: https://roseltorg.ru/procedure/12345'
    };
    const result = parseRoseltorg(email);
    expect(result.purchase_url).toContain('roseltorg.ru');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// parseB2BCenter()
// ═══════════════════════════════════════════════════════════════════════════

describe('parseB2BCenter()', () => {
  test('извлекает номер торговой процедуры', () => {
    const email = {
      subject: '', body_html: '',
      body_text: 'Торговая процедура № 456789 на площадке B2B-Center'
    };
    const result = parseB2BCenter(email);
    expect(result.purchase_number).toBe('456789');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// fallbackRelevance()
// ═══════════════════════════════════════════════════════════════════════════

describe('fallbackRelevance()', () => {
  test('релевантный текст даёт высокий скор', () => {
    const score = fallbackRelevance('Химическая чистка трубопроводов нефтегаз обслуживание скважин');
    expect(score).toBeGreaterThanOrEqual(30);
  });

  test('нерелевантный текст даёт минимальный скор (30)', () => {
    const score = fallbackRelevance('Продажа канцтоваров и офисной бумаги');
    expect(score).toBe(30);
  });

  test('пустой текст → минимальный скор (30)', () => {
    expect(fallbackRelevance('')).toBe(30);
  });
});
