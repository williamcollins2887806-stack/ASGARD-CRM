/**
 * ASGARD CRM — Глобальный teardown после интеграционных тестов
 */

'use strict';

require('./env-setup');

module.exports = async function globalTeardown() {
  // Очистка тестовых данных (опционально)
  // В CI тестовая БД удаляется вместе с контейнером
  console.log('[GlobalTeardown] Интеграционные тесты завершены');
};
