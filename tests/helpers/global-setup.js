/**
 * ASGARD CRM — Глобальный setup перед запуском интеграционных тестов
 * Запускает миграции и сидирует тестовые данные
 */

'use strict';

require('./env-setup');

module.exports = async function globalSetup() {
  const { Pool } = require('pg');
  const fs = require('fs');
  const path = require('path');

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });

  try {
    // Проверяем подключение
    await pool.query('SELECT 1');
    console.log('[GlobalSetup] БД доступна');

    // Прогоняем миграции
    const migrationsDir = path.join(__dirname, '../../migrations');
    if (fs.existsSync(migrationsDir)) {
      // Создаём таблицу миграций
      await pool.query(`
        CREATE TABLE IF NOT EXISTS migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) UNIQUE NOT NULL,
          executed_at TIMESTAMP DEFAULT NOW()
        )
      `);

      const files = fs.readdirSync(migrationsDir)
        .filter(f => /^V\d+.*\.sql$/.test(f))
        .sort();

      const { rows: executed } = await pool.query('SELECT name FROM migrations');
      const executedNames = new Set(executed.map(r => r.name));

      for (const file of files) {
        if (executedNames.has(file)) continue;
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        try {
          await pool.query(sql);
          await pool.query('INSERT INTO migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
          console.log(`[GlobalSetup] Миграция ${file} — OK`);
        } catch (err) {
          console.warn(`[GlobalSetup] Миграция ${file} — ошибка: ${err.message}`);
        }
      }
    }

    // Сидируем пользователей
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('Test123!', 10);
    const roles = [
      'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
      'HEAD_PM', 'HEAD_TO', 'PM', 'TO', 'HR', 'HR_MANAGER',
      'BUH', 'OFFICE_MANAGER', 'WAREHOUSE', 'PROC', 'CHIEF_ENGINEER'
    ];

    for (const role of roles) {
      const login = `test_${role.toLowerCase()}`;
      await pool.query(`
        INSERT INTO users (login, password_hash, name, role, is_active)
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (login) DO UPDATE SET password_hash = $2, role = $4, is_active = true
      `, [login, hash, `Тест ${role}`, role]);
    }

    console.log('[GlobalSetup] Тестовые пользователи созданы');
  } catch (err) {
    console.error('[GlobalSetup] Ошибка:', err.message);
    // Не бросаем ошибку — тесты пропустятся если БД недоступна
  } finally {
    await pool.end();
  }
};
