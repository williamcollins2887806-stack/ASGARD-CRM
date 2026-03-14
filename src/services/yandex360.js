/**
 * ASGARD CRM — Яндекс 360 API Service
 * Создание/управление почтовыми ящиками через Яндекс 360 для бизнеса
 * API docs: https://yandex.ru/dev/api360/
 */

'use strict';

const db = require('./db');

const API_BASE = 'https://api360.yandex.net';

// ── Config cache ────────────────────────────────────────────────────
let _config = null;
let _configLoaded = false;

async function getConfig() {
  if (_configLoaded && _config) return _config;
  try {
    const res = await db.query("SELECT value_json FROM settings WHERE key = 'yandex360_config'");
    if (res.rows[0]?.value_json) {
      _config = JSON.parse(res.rows[0].value_json);
    }
  } catch (e) {
    console.error('[Yandex360] Config load error:', e.message);
  }
  _configLoaded = true;
  return _config || {};
}

function invalidateConfig() {
  _config = null;
  _configLoaded = false;
}

// ── HTTP helper ─────────────────────────────────────────────────────
async function apiRequest(method, path, body = null) {
  const config = await getConfig();
  if (!config.oauth_token || !config.org_id) {
    throw new Error('Яндекс 360 не настроен: укажите OAuth-токен и ID организации в настройках');
  }

  const url = `${API_BASE}/directory/v1/org/${config.org_id}${path}`;
  const options = {
    method,
    headers: {
      'Authorization': `OAuth ${config.oauth_token}`,
      'Content-Type': 'application/json'
    }
  };

  if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  const resp = await fetch(url, options);
  const text = await resp.text();

  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }

  if (!resp.ok) {
    const errMsg = data?.message || data?.error || `HTTP ${resp.status}`;
    throw new Error(`Яндекс 360 API (${resp.status}): ${errMsg}`);
  }

  return data;
}

// ── User Management ─────────────────────────────────────────────────

/**
 * Создать пользователя в Яндекс 360
 * @param {Object} params
 * @param {string} params.nickname - логин (часть до @)
 * @param {string} params.password - пароль
 * @param {string} params.firstName - имя
 * @param {string} params.lastName - фамилия
 * @param {string} [params.middleName] - отчество
 * @param {string} [params.department_id] - ID отдела
 * @returns {Promise<Object>} Созданный пользователь
 */
async function createUser({ nickname, password, firstName, lastName, middleName, department_id }) {
  const body = {
    nickname,
    password,
    name: {
      first: firstName,
      last: lastName
    }
  };
  if (middleName) body.name.middle = middleName;
  if (department_id) body.departmentId = parseInt(department_id);

  const result = await apiRequest('POST', '/users', body);

  const config = await getConfig();
  const domain = config.domain || 'asgard-service.com';
  result.email = `${nickname}@${domain}`;

  return result;
}

/**
 * Получить список пользователей Яндекс 360
 */
async function listUsers(page = 1, perPage = 100) {
  return apiRequest('GET', `/users?page=${page}&perPage=${perPage}`);
}

/**
 * Получить пользователя по ID
 */
async function getUser(userId) {
  return apiRequest('GET', `/users/${userId}`);
}

/**
 * Удалить пользователя
 */
async function deleteUser(userId) {
  return apiRequest('DELETE', `/users/${userId}`);
}

/**
 * Изменить пароль пользователя
 */
async function changePassword(userId, newPassword) {
  return apiRequest('PATCH', `/users/${userId}`, { password: newPassword });
}

/**
 * Найти пользователя Яндекс 360 по email
 * @param {string} email - полный email (nickname@domain)
 * @returns {Promise<Object|null>} Пользователь или null
 */
async function findUserByEmail(email) {
  const nickname = email.split('@')[0].toLowerCase();
  let page = 1;
  const perPage = 100;
  while (true) {
    const result = await apiRequest('GET', `/users?page=${page}&perPage=${perPage}`);
    const users = result.users || [];
    const found = users.find(u =>
      (u.email && u.email.toLowerCase() === email.toLowerCase()) ||
      (u.nickname && u.nickname.toLowerCase() === nickname)
    );
    if (found) return found;
    if (users.length < perPage) return null;
    page++;
  }
}

/**
 * Проверить подключение к Яндекс 360 API
 */
async function testConnection() {
  try {
    const result = await listUsers(1, 1);
    return { success: true, message: 'Подключение успешно', usersTotal: result.total || 0 };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/**
 * Сохранить настройки Яндекс 360
 */
async function saveConfig(config) {
  await db.query(`
    INSERT INTO settings (key, value_json, updated_at)
    VALUES ('yandex360_config', , NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = , updated_at = NOW()
  `, [JSON.stringify(config)]);
  invalidateConfig();
}

module.exports = {
  createUser,
  listUsers,
  getUser,
  deleteUser,
  changePassword,
  findUserByEmail,
  testConnection,
  saveConfig,
  getConfig,
  invalidateConfig
};
