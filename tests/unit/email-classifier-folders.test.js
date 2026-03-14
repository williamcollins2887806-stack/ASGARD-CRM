/**
 * Unit tests: Email Folder Sorter (AI classification for CRM folders)
 */
const { describe, test, expect } = require('@jest/globals');

// Mock dependencies
jest.mock('../../src/services/db', () => ({ query: jest.fn() }));
jest.mock('../../src/services/imap', () => ({
  decrypt: jest.fn(v => v),
  encrypt: jest.fn(v => v)
}));
jest.mock('../../src/services/ai-provider', () => ({
  ask: jest.fn()
}));
jest.mock('imapflow', () => ({
  ImapFlow: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    logout: jest.fn(),
    list: jest.fn().mockResolvedValue([]),
    mailboxCreate: jest.fn(),
    getMailboxLock: jest.fn().mockResolvedValue({ release: jest.fn() }),
    messageMove: jest.fn()
  }))
}));

const sorter = require('../../src/services/email-folder-sorter');

describe('Email Folder Sorter — preClassify', () => {
  test('classifies TKP by subject keywords', () => {
    expect(sorter.preClassify({ subject: 'Коммерческое предложение на монтаж', body_text: '' })).toBe('tkp');
    expect(sorter.preClassify({ subject: 'ТКП-2024-001', body_text: '' })).toBe('tkp');
    expect(sorter.preClassify({ subject: 'Commercial Proposal for services', body_text: '' })).toBe('tkp');
  });

  test('classifies tenders', () => {
    expect(sorter.preClassify({ subject: 'Тендер на закупку оборудования', body_text: '' })).toBe('tender');
    expect(sorter.preClassify({ subject: 'Аукцион №12345', body_text: '' })).toBe('tender');
    expect(sorter.preClassify({ subject: 'Конкурсная документация', body_text: '' })).toBe('tender');
  });

  test('classifies invoices', () => {
    expect(sorter.preClassify({ subject: 'Счёт на оплату', body_text: '' })).toBe('invoice');
    expect(sorter.preClassify({ subject: 'Invoice #12345', body_text: '' })).toBe('invoice');
  });

  test('classifies acts', () => {
    expect(sorter.preClassify({ subject: 'Акт выполненных работ', body_text: '' })).toBe('act');
    expect(sorter.preClassify({ subject: 'Акт сверки за 2024', body_text: '' })).toBe('act');
  });

  test('classifies contracts', () => {
    expect(sorter.preClassify({ subject: 'Договор подряда', body_text: '' })).toBe('contract');
    expect(sorter.preClassify({ subject: 'Подписание контракта', body_text: '' })).toBe('contract');
  });

  test('returns null for unrecognized emails', () => {
    expect(sorter.preClassify({ subject: 'Привет, как дела?', body_text: '' })).toBeNull();
    expect(sorter.preClassify({ subject: 'Обед в среду', body_text: '' })).toBeNull();
  });

  test('also checks body text', () => {
    expect(sorter.preClassify({ subject: 'Документы', body_text: 'Высылаем коммерческое предложение' })).toBe('tkp');
  });
});

describe('Email Folder Sorter — CRM_FOLDERS', () => {
  test('has all required folder paths', () => {
    expect(sorter.CRM_FOLDERS.tkp).toBe('CRM/ТКП');
    expect(sorter.CRM_FOLDERS.tender).toBe('CRM/Тендеры');
    expect(sorter.CRM_FOLDERS.invoice).toBe('CRM/Счета');
    expect(sorter.CRM_FOLDERS.act).toBe('CRM/Акты');
    expect(sorter.CRM_FOLDERS.contract).toBe('CRM/Договоры');
    expect(sorter.CRM_FOLDERS.other).toBe('CRM/Прочее');
  });
});

describe('Email Folder Sorter — classifyWithAI', () => {
  const aiProvider = require('../../src/services/ai-provider');

  test('returns AI classification result', async () => {
    aiProvider.ask.mockResolvedValue('tkp');
    const result = await sorter.classifyWithAI({ subject: 'Some proposal', from_email: 'test@test.com', body_text: 'proposal details' });
    expect(result).toBe('tkp');
  });

  test('falls back to other on AI error', async () => {
    aiProvider.ask.mockRejectedValue(new Error('API error'));
    const result = await sorter.classifyWithAI({ subject: 'test', from_email: '', body_text: '' });
    expect(result).toBe('other');
  });

  test('falls back to other on invalid AI response', async () => {
    aiProvider.ask.mockResolvedValue('unknown_category_xyz');
    const result = await sorter.classifyWithAI({ subject: 'test', from_email: '', body_text: '' });
    expect(result).toBe('other');
  });
});
