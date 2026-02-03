/**
 * ASGARD DB — Серверная версия v2.2
 * Использует API вместо IndexedDB
 * Интерфейс совместим со старой версией
 * 
 * Специальная обработка:
 * - settings: key вместо id
 * - user_call_status: user_id вместо id
 * - Обработка 401 Unauthorized
 */

window.AsgardDB = (function(){
  const DB_NAME = "asgard_crm";
  const DB_VERSION = 27;
  
  // Кэш для уменьшения запросов
  const cache = new Map();
  const CACHE_TTL = 30000; // 30 секунд
  
  // Получить токен авторизации
  function getToken() {
    return localStorage.getItem('asgard_token') || '';
  }
  
  // Заголовки для запросов
  function headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getToken()
    };
  }
  
  // Базовый fetch с обработкой ошибок
  async function apiFetch(url, options) {
    options = options || {};
    try {
      const resp = await fetch(url, {
        method: options.method || 'GET',
        headers: Object.assign({}, headers(), options.headers || {}),
        body: options.body
      });
      
      // При 401 - возвращаем null (не авторизован)
      if (resp.status === 401) {
        console.warn('[AsgardDB] Unauthorized:', url);
        return null;
      }
      
      // При 404 - возвращаем null
      if (resp.status === 404) {
        return null;
      }
      
      if (!resp.ok) {
        const err = await resp.json().catch(function() { return { error: 'Network error' }; });
        throw new Error(err.error || err.message || 'API Error');
      }
      
      return await resp.json();
    } catch(e) {
      console.error('[AsgardDB] API Error:', e.message, url);
      throw e;
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // СПЕЦИАЛЬНЫЕ МЕТОДЫ ДЛЯ SETTINGS
  // ─────────────────────────────────────────────────────────────────────────────
  
  async function getSettings(key) {
    try {
      const resp = await fetch('/api/settings/' + key, { headers: headers() });
      if (resp.status === 401 || resp.status === 404) return null;
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.setting || data.value || data;
    } catch(e) {
      return null;
    }
  }
  
  async function putSettings(val) {
    const key = val.key;
    if (!key) throw new Error('settings требует key');
    
    try {
      const resp = await fetch('/api/settings/' + key, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ value: val.value !== undefined ? val.value : val })
      });
      if (resp.ok) {
        clearCache('settings');
        return key;
      }
      // Если PUT не сработал - пробуем через data API
      const resp2 = await fetch('/api/data/settings', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ key: key, value_json: JSON.stringify(val.value !== undefined ? val.value : val) })
      });
      if (resp2.ok) {
        clearCache('settings');
        return key;
      }
      // Тихо игнорируем ошибку - настройки не критичны
      console.warn('[AsgardDB] putSettings failed for:', key);
      return key;
    } catch(e) {
      console.warn('[AsgardDB] putSettings error:', key, e.message);
      return key; // Не бросаем ошибку
    }
  }
  
  async function getAllSettings() {
    try {
      const resp = await fetch('/api/settings', { headers: headers() });
      if (resp.status === 401) return [];
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.settings || [];
    } catch(e) {
      return [];
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // СПЕЦИАЛЬНЫЕ МЕТОДЫ ДЛЯ USER_CALL_STATUS
  // ─────────────────────────────────────────────────────────────────────────────
  
  async function getUserCallStatus(userId) {
    try {
      const data = await apiFetch('/api/data/user_call_status?limit=1000');
      if (!data) return null;
      const items = data.user_call_status || [];
      return items.find(function(x) { return x.user_id == userId; }) || null;
    } catch(e) {
      return null;
    }
  }
  
  async function putUserCallStatus(val) {
    const userId = val.user_id;
    if (!userId) throw new Error('user_call_status требует user_id');
    
    try {
      const existing = await getUserCallStatus(userId);
      
      if (existing && existing.id) {
        await apiFetch('/api/data/user_call_status/' + existing.id, {
          method: 'PUT',
          body: JSON.stringify(Object.assign({}, val, { id: existing.id }))
        });
      } else {
        await apiFetch('/api/data/user_call_status', {
          method: 'POST',
          body: JSON.stringify(val)
        });
      }
      
      clearCache('user_call_status');
      return userId;
    } catch(e) {
      console.error('[AsgardDB] putUserCallStatus error:', e);
      throw e;
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // ОСНОВНЫЕ МЕТОДЫ
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Получить одну запись по id
   */
  async function get(store, key) {
    if (!key) return null;
    
    // Специальная обработка settings
    if (store === 'settings') {
      return getSettings(key);
    }
    
    // Специальная обработка user_call_status
    if (store === 'user_call_status') {
      return getUserCallStatus(key);
    }
    
    // Проверяем кэш
    const cacheKey = store + ':' + key;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return cached.data;
    }
    
    try {
      const data = await apiFetch('/api/data/' + store + '/' + key);
      if (!data) return null;
      
      // Кэшируем
      cache.set(cacheKey, { data: data.item, time: Date.now() });
      
      return data.item || null;
    } catch(e) {
      return null;
    }
  }
  
  /**
   * Получить все записи
   */
  async function all(store) {
    // Специальная обработка settings
    if (store === 'settings') {
      return getAllSettings();
    }
    
    // Проверяем кэш
    const cacheKey = store + ':all';
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return cached.data;
    }
    
    try {
      const data = await apiFetch('/api/data/' + store + '?limit=10000');

      // Если null (401/404) - возвращаем пустой массив
      if (!data) return [];

      const items = data[store] || [];
      
      // Кэшируем
      cache.set(cacheKey, { data: items, time: Date.now() });
      
      return items;
    } catch(e) {
      console.error('[AsgardDB] all() error:', store, e);
      return [];
    }
  }
  
  // Алиас для all
  const getAll = all;
  
  /**
   * Добавить запись (INSERT)
   */
  async function add(store, val) {
    // Специальная обработка settings
    if (store === 'settings') {
      return putSettings(val);
    }
    
    // Специальная обработка user_call_status
    if (store === 'user_call_status') {
      return putUserCallStatus(val);
    }
    
    try {
      const data = await apiFetch('/api/data/' + store, {
        method: 'POST',
        body: JSON.stringify(val)
      });
      
      if (!data) return null;
      
      // Очищаем кэш
      clearCache(store);
      
      return data.id || (data.item && data.item.id);
    } catch(e) {
      console.error('[AsgardDB] add() error:', store, e);
      throw e;
    }
  }
  
  /**
   * Обновить или вставить запись (UPSERT)
   */
  async function put(store, val) {
    // Специальная обработка settings
    if (store === 'settings') {
      return putSettings(val);
    }
    
    // Специальная обработка user_call_status
    if (store === 'user_call_status') {
      return putUserCallStatus(val);
    }
    
    try {
      let data;

      if (val.id) {
        // UPDATE
        data = await apiFetch('/api/data/' + store + '/' + val.id, {
          method: 'PUT',
          body: JSON.stringify(val)
        });
      } else {
        // INSERT
        data = await apiFetch('/api/data/' + store, {
          method: 'POST',
          body: JSON.stringify(val)
        });
      }
      
      if (!data) return val.id || null;
      
      // Очищаем кэш
      clearCache(store);
      
      return data.id || (data.item && data.item.id) || val.id;
    } catch(e) {
      console.error('[AsgardDB] put() error:', store, e);
      throw e;
    }
  }
  
  /**
   * Удалить запись
   */
  async function del(store, key) {
    try {
      await apiFetch('/api/data/' + store + '/' + key, {
        method: 'DELETE'
      });
      
      // Очищаем кэш
      clearCache(store);
      
      return true;
    } catch(e) {
      console.error('[AsgardDB] del() error:', store, key, e);
      return false;
    }
  }
  
  /**
   * Поиск по индексу
   */
  async function byIndex(store, indexName, value) {
    try {
      const data = await apiFetch('/api/data/' + store + '/by-index', {
        method: 'POST',
        body: JSON.stringify({ index: indexName, value: value })
      });
      
      if (!data) return [];
      return data.items || [];
    } catch(e) {
      console.error('[AsgardDB] byIndex() error:', store, indexName, e);
      return [];
    }
  }
  
  /**
   * Количество записей
   */
  async function count(store) {
    try {
      const data = await apiFetch('/api/data/' + store + '/count');
      if (!data) return 0;
      return data.count || 0;
    } catch(e) {
      return 0;
    }
  }
  
  /**
   * Список с фильтрацией
   */
  async function list(store, opts) {
    opts = opts || {};
    const limit = opts.limit || 50;
    const orderBy = opts.orderBy;
    const desc = opts.desc;

    try {
      let url = '/api/data/' + store + '?limit=' + limit;
      if (orderBy) url += '&orderBy=' + orderBy;
      if (desc) url += '&desc=true';
      
      const data = await apiFetch(url);
      if (!data) return [];
      return data[store] || [];
    } catch(e) {
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ЭКСПОРТ/ИМПОРТ (для совместимости)
  // ─────────────────────────────────────────────────────────────────────────────

  async function exportJSON() {
    const STORES = [
      'users', 'settings', 'tenders', 'estimates', 'works',
      'customers', 'staff', 'notifications', 'audit_log'
    ];

    const out = { 
      __meta: { 
        exported_at: new Date().toISOString(), 
        db: DB_NAME, 
        version: DB_VERSION,
        source: 'server'
      } 
    };
    
    for (let i = 0; i < STORES.length; i++) {
      const s = STORES[i];
      try {
        out[s] = await all(s);
      } catch(e) {
        out[s] = [];
      }
    }
    
    return out;
  }
  
  async function importJSON(payload, opts) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Некорректный файл импорта');
    }
    
    console.warn('[AsgardDB] importJSON не реализован для серверной версии');
    return true;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // УПРАВЛЕНИЕ КЭШЕМ
  // ─────────────────────────────────────────────────────────────────────────────
  
  function clearCache(store) {
    if (store) {
      for (const key of cache.keys()) {
        if (key.indexOf(store + ':') === 0) {
          cache.delete(key);
        }
      }
    } else {
      cache.clear();
    }
  }
  
  // Очищаем кэш периодически
  setInterval(function() {
    const now = Date.now();
    for (const entry of cache.entries()) {
      if (now - entry[1].time > CACHE_TTL * 2) {
        cache.delete(entry[0]);
      }
    }
  }, 60000);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // ЗАГЛУШКИ ДЛЯ СОВМЕСТИМОСТИ
  // ─────────────────────────────────────────────────────────────────────────────
  
  function open() {
    return Promise.resolve(true);
  }
  
  const STORES = {
    users: { keyPath: "id" },
    settings: { keyPath: "key" },
    tenders: { keyPath: "id" },
    estimates: { keyPath: "id" },
    works: { keyPath: "id" },
    work_expenses: { keyPath: "id" },
    office_expenses: { keyPath: "id" },
    correspondence: { keyPath: "id" },
    travel_expenses: { keyPath: "id" },
    incomes: { keyPath: "id" },
    calendar_events: { keyPath: "id" },
    contracts: { keyPath: "id" },
    seals: { keyPath: "id" },
    seal_transfers: { keyPath: "id" },
    employee_permits: { keyPath: "id" },
    bonus_requests: { keyPath: "id" },
    chats: { keyPath: "id" },
    chat_messages: { keyPath: "id" },
    bank_rules: { keyPath: "id" },
    customers: { keyPath: "id" },
    staff: { keyPath: "id" },
    staff_plan: { keyPath: "id" },
    employees: { keyPath: "id" },
    employee_reviews: { keyPath: "id" },
    staff_requests: { keyPath: "id" },
    purchase_requests: { keyPath: "id" },
    documents: { keyPath: "id" },
    audit_log: { keyPath: "id" },
    notifications: { keyPath: "id" },
    user_call_status: { keyPath: "user_id" },
    sync_meta: { keyPath: "table_name" }
  };
  
  return {
    open: open,
    get: get,
    all: all,
    getAll: getAll,
    add: add,
    put: put,
    del: del,
    byIndex: byIndex,
    count: count,
    list: list,
    exportJSON: exportJSON,
    importJSON: importJSON,
    clearCache: clearCache,
    STORES: STORES,
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION
  };
})();
