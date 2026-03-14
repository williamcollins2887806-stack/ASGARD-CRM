/**
 * Unit tests: CRM Mailer Helper
 * Tests getTransportForUser, getCrmBccAddress, sendCrmEmail
 */
const { describe, test, expect, beforeEach } = require('@jest/globals');

jest.mock('../../src/services/db', () => ({ query: jest.fn() }));
jest.mock('../../src/services/imap', () => ({
  decrypt: jest.fn(v => 'decrypted_' + v),
  encrypt: jest.fn(v => v)
}));
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: '<test-msg-id@example.com>' })
  }))
}));

const crmMailer = require('../../src/services/crm-mailer');
const db = require('../../src/services/db');
const nodemailer = require('nodemailer');

describe('CRM Mailer — getTransportForUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns personal transport when user has active account', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 1, user_id: 10, email_address: 'ivan@asgard-service.com',
        smtp_host: 'smtp.yandex.ru', smtp_port: 465, smtp_tls: true,
        smtp_user: 'ivan@asgard-service.com', smtp_pass_encrypted: 'enc123',
        display_name: 'Иван Тестов'
      }]
    });

    const result = await crmMailer.getTransportForUser(db, 10);

    expect(result.isPersonal).toBe(true);
    expect(result.fromEmail).toBe('ivan@asgard-service.com');
    expect(result.fromName).toBe('Иван Тестов');
    expect(result.transport).toBeDefined();
  });

  test('falls back to global CRM account when no personal', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] }) // no personal
      .mockResolvedValueOnce({
        rows: [{
          id: 1, email_address: 'crm@asgard-service.com',
          smtp_host: 'smtp.yandex.ru', smtp_port: 587,
          smtp_user: 'crm@asgard-service.com', smtp_pass_encrypted: 'enc_global',
          smtp_from_name: 'ООО Асгард'
        }]
      });

    const result = await crmMailer.getTransportForUser(db, 99);

    expect(result.isPersonal).toBe(false);
    expect(result.fromEmail).toBe('crm@asgard-service.com');
    expect(result.fromName).toBe('ООО Асгард');
  });

  test('falls back to ENV config when no DB accounts', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    process.env.SMTP_HOST = 'smtp.test.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'env_user';
    process.env.SMTP_PASS = 'env_pass';
    process.env.SMTP_FROM = 'env@test.com';

    const result = await crmMailer.getTransportForUser(db, 99);

    expect(result.isPersonal).toBe(false);
    expect(result.fromEmail).toBe('env@test.com');

    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
  });

  test('throws when no account configured at all', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    delete process.env.SMTP_HOST;

    await expect(crmMailer.getTransportForUser(db, 99)).rejects.toThrow('Не настроен ни один почтовый аккаунт');
  });
});

describe('CRM Mailer — getCrmBccAddress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns CRM email address', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ email_address: 'crm@asgard-service.com' }]
    });

    const addr = await crmMailer.getCrmBccAddress(db);
    expect(addr).toBe('crm@asgard-service.com');
  });

  test('returns null when no CRM account', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const addr = await crmMailer.getCrmBccAddress(db);
    expect(addr).toBeNull();
  });

  test('returns null on DB error', async () => {
    db.query.mockRejectedValueOnce(new Error('DB error'));

    const addr = await crmMailer.getCrmBccAddress(db);
    expect(addr).toBeNull();
  });
});

describe('CRM Mailer — sendCrmEmail', () => {
  let uniqueAccId = 100;

  beforeEach(() => {
    jest.clearAllMocks();
    uniqueAccId++; // Use unique ID to avoid transport cache hits
  });

  test('sends email with BCC to CRM address', async () => {
    const accId = uniqueAccId;
    const mockSendMail = jest.fn().mockResolvedValue({ messageId: '<msg-1@test>' });
    nodemailer.createTransport.mockReturnValue({ sendMail: mockSendMail });

    db.query.mockImplementation((sql) => {
      if (sql.includes('user_email_accounts')) {
        return Promise.resolve({
          rows: [{
            id: accId, user_id: 10, email_address: 'ivan@asgard-service.com',
            smtp_host: 'smtp.yandex.ru', smtp_port: 465, smtp_tls: true,
            smtp_user: 'ivan@asgard-service.com', smtp_pass_encrypted: 'enc',
            display_name: 'Иван'
          }]
        });
      }
      if (sql.includes('email_accounts') && sql.includes('is_copy_target')) {
        return Promise.resolve({
          rows: [{ email_address: 'crm@asgard-service.com' }]
        });
      }
      if (sql.includes('INSERT INTO emails')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await crmMailer.sendCrmEmail(db, 10, {
      to: 'client@example.com',
      subject: 'ТКП №123',
      text: 'Текст предложения',
      html: '<p>Текст предложения</p>'
    });

    expect(result.success).toBe(true);
    expect(result.from).toBe('ivan@asgard-service.com');

    // Verify BCC was added
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const sendCallArgs = mockSendMail.mock.calls[0][0];
    expect(sendCallArgs.bcc).toContain('crm@asgard-service.com');
    expect(sendCallArgs.from).toContain('ivan@asgard-service.com');
    expect(sendCallArgs.to).toBe('client@example.com');
    expect(sendCallArgs.subject).toBe('ТКП №123');
  });

  test('does not add duplicate BCC when sending from CRM address', async () => {
    const accId = uniqueAccId;
    const mockSendMail = jest.fn().mockResolvedValue({ messageId: '<msg-2@test>' });
    nodemailer.createTransport.mockReturnValue({ sendMail: mockSendMail });

    // Personal account IS the CRM account
    db.query.mockImplementation((sql) => {
      if (sql.includes('user_email_accounts')) {
        return Promise.resolve({
          rows: [{
            id: accId, user_id: 10, email_address: 'crm@asgard-service.com',
            smtp_host: 'smtp.yandex.ru', smtp_port: 465, smtp_tls: true,
            smtp_user: 'crm@asgard-service.com', smtp_pass_encrypted: 'enc',
            display_name: 'CRM'
          }]
        });
      }
      if (sql.includes('is_copy_target')) {
        return Promise.resolve({ rows: [{ email_address: 'crm@asgard-service.com' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await crmMailer.sendCrmEmail(db, 10, {
      to: 'client@example.com',
      subject: 'Test',
      text: 'Test'
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const sendCallArgs = mockSendMail.mock.calls[0][0];
    // BCC should not contain own address (fromEmail === crmBcc)
    expect(sendCallArgs.bcc || '').not.toContain('crm@asgard-service.com');
  });

  test('logs sent email to DB', async () => {
    const accId = uniqueAccId;
    const mockSendMail = jest.fn().mockResolvedValue({ messageId: '<msg-3@test>' });
    nodemailer.createTransport.mockReturnValue({ sendMail: mockSendMail });

    db.query.mockImplementation((sql) => {
      if (sql.includes('user_email_accounts')) {
        return Promise.resolve({
          rows: [{
            id: accId, user_id: 10, email_address: 'log@asgard-service.com',
            smtp_host: 'smtp.yandex.ru', smtp_port: 465, smtp_tls: true,
            smtp_user: 'log@asgard-service.com', smtp_pass_encrypted: 'enc',
            display_name: 'Logger'
          }]
        });
      }
      if (sql.includes('is_copy_target')) {
        return Promise.resolve({ rows: [{ email_address: 'crm@asgard-service.com' }] });
      }
      if (sql.includes('INSERT INTO emails')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await crmMailer.sendCrmEmail(db, 10, {
      to: 'client@example.com',
      subject: 'Test Log',
      text: 'Body text'
    });

    // Should have called INSERT INTO emails
    const insertCall = db.query.mock.calls.find(c => c[0].includes('INSERT INTO emails'));
    expect(insertCall).toBeDefined();
  });
});
