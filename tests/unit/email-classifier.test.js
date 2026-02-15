/**
 * ASGARD CRM — Unit-тесты: классификатор писем
 */

'use strict';

// Мокаем модуль БД до загрузки классификатора
jest.mock('../../src/services/db', () => ({
  query: jest.fn()
}));

const db = require('../../src/services/db');
const { classify, invalidateCache } = require('../../src/services/email-classifier');

beforeEach(() => {
  invalidateCache();
  jest.clearAllMocks();
});

// Правила-фикстуры
const MOCK_RULES = [
  {
    id: 1, rule_type: 'domain', match_mode: 'ends_with',
    pattern: 'zakupki.gov.ru', classification: 'platform_tender',
    confidence: 95, is_active: true, priority: 100
  },
  {
    id: 2, rule_type: 'domain', match_mode: 'ends_with',
    pattern: 'roseltorg.ru', classification: 'platform_tender',
    confidence: 90, is_active: true, priority: 90
  },
  {
    id: 3, rule_type: 'keyword_subject', match_mode: 'contains',
    pattern: 'коммерческое предложение', classification: 'direct_request',
    confidence: 80, is_active: true, priority: 80
  },
  {
    id: 4, rule_type: 'keyword_subject', match_mode: 'contains',
    pattern: 'запрос цен', classification: 'direct_request',
    confidence: 85, is_active: true, priority: 85
  },
  {
    id: 5, rule_type: 'domain', match_mode: 'ends_with',
    pattern: 'b2b-center.ru', classification: 'platform_tender',
    confidence: 90, is_active: true, priority: 90
  }
];

function setupMockRules(rules = MOCK_RULES) {
  db.query.mockImplementation((sql) => {
    if (sql.includes('email_classification_rules') || sql.includes('classification')) {
      return { rows: rules };
    }
    // Для recordMatch - обновление статистики
    return { rows: [], rowCount: 1 };
  });
}

describe('Email Classifier', () => {

  describe('classify() — правила по домену', () => {
    test('классифицирует zakupki.gov.ru как platform_tender', async () => {
      setupMockRules();
      const result = await classify({
        from_email: 'notification@zakupki.gov.ru',
        subject: 'Извещение о закупке',
        body_text: 'Текст уведомления'
      });
      expect(result.type).toBe('platform_tender');
      expect(result.confidence).toBeGreaterThanOrEqual(90);
    });

    test('классифицирует roseltorg.ru как platform_tender', async () => {
      setupMockRules();
      const result = await classify({
        from_email: 'noreply@roseltorg.ru',
        subject: 'Новая процедура',
        body_text: ''
      });
      expect(result.type).toBe('platform_tender');
    });

    test('классифицирует b2b-center.ru как platform_tender', async () => {
      setupMockRules();
      const result = await classify({
        from_email: 'system@b2b-center.ru',
        subject: 'Приглашение к участию',
        body_text: ''
      });
      expect(result.type).toBe('platform_tender');
    });
  });

  describe('classify() — правила по ключевым словам', () => {
    test('классифицирует "коммерческое предложение" как direct_request', async () => {
      setupMockRules();
      const result = await classify({
        from_email: 'partner@example.com',
        subject: 'Коммерческое предложение на обслуживание',
        body_text: 'Добрый день'
      });
      expect(result.type).toBe('direct_request');
    });

    test('классифицирует "запрос цен" как direct_request', async () => {
      setupMockRules();
      const result = await classify({
        from_email: 'tender@company.ru',
        subject: 'Запрос цен на химическую чистку',
        body_text: ''
      });
      expect(result.type).toBe('direct_request');
    });
  });

  describe('classify() — неизвестные письма', () => {
    test('неизвестный домен → unknown', async () => {
      setupMockRules();
      const result = await classify({
        from_email: 'random@gmail.com',
        subject: 'Привет',
        body_text: 'Просто письмо'
      });
      expect(result.type).toBe('unknown');
    });

    test('пустой email → unknown', async () => {
      setupMockRules();
      const result = await classify({
        from_email: '',
        subject: '',
        body_text: ''
      });
      expect(result.type).toBe('unknown');
    });
  });

  describe('classify() — кеширование правил', () => {
    test('повторный вызов не перезапрашивает правила', async () => {
      setupMockRules();
      await classify({ from_email: 'a@zakupki.gov.ru', subject: '', body_text: '' });
      const callsAfterFirst = db.query.mock.calls.length;
      await classify({ from_email: 'b@roseltorg.ru', subject: '', body_text: '' });
      // Второй вызов classify не должен загружать правила (кеш)
      // Может вызвать recordMatch, но не SELECT из classification_rules
      const ruleSelectCalls = db.query.mock.calls.slice(callsAfterFirst).filter(c =>
        c[0].includes('SELECT') && c[0].includes('classification_rules')
      );
      expect(ruleSelectCalls.length).toBe(0);
    });

    test('invalidateCache сбрасывает кеш', async () => {
      setupMockRules();
      await classify({ from_email: 'a@zakupki.gov.ru', subject: '', body_text: '' });
      invalidateCache();
      await classify({ from_email: 'b@zakupki.gov.ru', subject: '', body_text: '' });
      const ruleQueries = db.query.mock.calls.filter(c =>
        c[0].includes('classification_rules') || c[0].includes('email_classification')
      );
      expect(ruleQueries.length).toBeGreaterThanOrEqual(2);
    });
  });
});
