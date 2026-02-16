/**
 * Jest environment setup for ASGARD CRM tests.
 *
 * Sets minimal environment variables so that modules that read process.env
 * at require-time do not crash. No real DB or network connections are made.
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_NAME = process.env.DB_NAME || 'asgard_test';
process.env.DB_USER = process.env.DB_USER || 'asgard';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/asgard-test-uploads';
