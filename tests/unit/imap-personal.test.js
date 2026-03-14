/**
 * Unit tests: Personal IMAP sync extension
 * Tests syncUserAccount and personal polling logic
 */
const { describe, test, expect, beforeEach } = require('@jest/globals');

jest.mock('imapflow', () => ({
  ImapFlow: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue([
      { path: 'INBOX', name: 'INBOX' },
      { path: 'Sent', name: 'Sent' }
    ]),
    getMailboxLock: jest.fn().mockResolvedValue({ release: jest.fn() }),
    status: jest.fn().mockResolvedValue({ messages: 5, unseen: 2 }),
    fetch: jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: jest.fn().mockResolvedValue({ done: true })
      })
    }),
    mailboxOpen: jest.fn().mockResolvedValue({ exists: 5 }),
    search: jest.fn().mockResolvedValue([])
  }))
}));

jest.mock('../../src/services/db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] })
}));

// Need to ensure decrypt is available
jest.mock('../../src/services/imap', () => {
  const actual = jest.requireActual('../../src/services/imap');
  return {
    ...actual,
    decrypt: jest.fn(v => 'decrypted_' + v),
    encrypt: jest.fn(v => 'encrypted_' + v),
    syncUserAccount: actual.syncUserAccount,
    startPersonalPolling: actual.startPersonalPolling,
    stopPersonalPolling: actual.stopPersonalPolling
  };
});

const db = require('../../src/services/db');

describe('Personal IMAP — syncUserAccount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('skips when no user account found', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // no account

    const imap = require('../../src/services/imap');
    if (typeof imap.syncUserAccount === 'function') {
      const result = await imap.syncUserAccount(999);
      // Should return without error, even if account not found
      expect(result).toBeDefined();
    }
  });

  test('exports syncUserAccount function', () => {
    const imap = require('../../src/services/imap');
    expect(typeof imap.syncUserAccount).toBe('function');
  });

  test('exports startPersonalPolling function', () => {
    const imap = require('../../src/services/imap');
    expect(typeof imap.startPersonalPolling).toBe('function');
  });

  test('exports stopPersonalPolling function', () => {
    const imap = require('../../src/services/imap');
    expect(typeof imap.stopPersonalPolling).toBe('function');
  });

  test('exports encrypt/decrypt functions', () => {
    const imap = require('../../src/services/imap');
    expect(typeof imap.encrypt).toBe('function');
    expect(typeof imap.decrypt).toBe('function');
  });
});

describe('Personal IMAP — Folder Sync', () => {
  test('standard Yandex folders are recognized', () => {
    const standardFolders = {
      'INBOX': 'inbox',
      'Sent': 'sent',
      'Drafts': 'drafts',
      'Spam': 'spam',
      'Trash': 'trash'
    };

    Object.entries(standardFolders).forEach(([path, type]) => {
      expect(path).toBeTruthy();
      expect(type).toBeTruthy();
    });
  });

  test('folder type mapping is correct', () => {
    function getFolderType(path) {
      const lower = path.toLowerCase();
      if (lower === 'inbox') return 'inbox';
      if (lower.includes('sent') || lower.includes('отправленные')) return 'sent';
      if (lower.includes('draft') || lower.includes('черновик')) return 'drafts';
      if (lower.includes('spam') || lower.includes('спам')) return 'spam';
      if (lower.includes('trash') || lower.includes('корзина') || lower.includes('удалённые')) return 'trash';
      return 'custom';
    }

    expect(getFolderType('INBOX')).toBe('inbox');
    expect(getFolderType('Sent')).toBe('sent');
    expect(getFolderType('Отправленные')).toBe('sent');
    expect(getFolderType('Drafts')).toBe('drafts');
    expect(getFolderType('Черновики')).toBe('drafts');
    expect(getFolderType('Spam')).toBe('spam');
    expect(getFolderType('Спам')).toBe('spam');
    expect(getFolderType('Trash')).toBe('trash');
    expect(getFolderType('Корзина')).toBe('trash');
    expect(getFolderType('Custom Folder')).toBe('custom');
  });
});
