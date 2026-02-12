/**
 * ASGARD CRM — Настройка окружения для тестов
 * Устанавливает переменные окружения ДО загрузки любых модулей
 */

process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_NAME = process.env.DB_NAME || 'asgard_test';
process.env.DB_USER = process.env.DB_USER || 'asgard_test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test_password';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'asgard-jwt-secret-2026';
process.env.JWT_EXPIRES_IN = '1d';
process.env.CORS_ORIGIN = '*';
process.env.RATE_LIMIT_MAX = '1000';
process.env.RATE_LIMIT_WINDOW = '60000';
