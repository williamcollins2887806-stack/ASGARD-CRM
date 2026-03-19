/**
 * АСГАРД CRM — PostgreSQL Sync
 * Этап 36
 * 
 * Синхронизация IndexedDB ↔ PostgreSQL через REST API
 * 
 * Архитектура:
 * - Frontend (этот модуль) ↔ REST API ↔ PostgreSQL
 * - Двунаправленная синхронизация с conflict resolution
 * - Offline-first: работает без сети, синхронизируется при подключении
 * - Инкрементальная синхронизация по updated_at
 */
window.AsgardSync = (function(){
  
  // Таблицы для синхронизации
  const SYNC_TABLES = [
    'users',
    'tenders', 
    'estimates',
    'works',
    'employees',
    'employee_assignments',
    'employee_reviews',
    'employee_permits',
    'work_expenses',
    'office_expenses',
    'customers',
    'contracts',
    'seals',
    'seal_transfers',
    'bonus_requests',
    'correspondence',
    'proxies',
    'calendar_events',
    'notifications',
    'documents',
    'audit_log',
    'employee_rates',
    'payroll_sheets',
    'payroll_items',
    'payment_registry',
    'self_employed',
    'one_time_payments',
    'staff_requests',
    'staff_request_messages',
    'staff_replacements',
    'purchase_requests'
  ];

  // Статусы синхронизации
  const SYNC_STATUS = {
    idle: { name: 'Ожидание', color: 'var(--text-muted)' },
    syncing: { name: 'Синхронизация...', color: 'var(--blue)' },
    success: { name: 'Синхронизировано', color: 'var(--green)' },
    error: { name: 'Ошибка', color: 'var(--red)' },
    offline: { name: 'Офлайн', color: 'var(--amber)' }
  };

  let currentStatus = 'idle';
  let lastSyncTime = null;
  let syncInProgress = false;

  // Получить настройки синхронизации
  async function getSettings() {
    try {
      const s = await AsgardDB.get('settings', 'sync');
      return s ? JSON.parse(s.value_json || '{}') : {};
    } catch(e) {
      return {};
    }
  }

  // Сохранить настройки
  async function saveSettings(settings) {
    try {
      await AsgardDB.put('settings', {
        key: 'sync',
        value_json: JSON.stringify(settings),
        updated_at: new Date().toISOString()
      });
      return true;
    } catch(e) {
      console.error('Failed to save sync settings:', e);
      return false;
    }
  }

  // Получить время последней синхронизации для таблицы
  async function getLastSyncTime(table) {
    try {
      const meta = await AsgardDB.get('sync_meta', table);
      return meta ? meta.last_sync : null;
    } catch(e) {
      return null;
    }
  }

  // Сохранить время последней синхронизации
  async function setLastSyncTime(table, time) {
    try {
      await AsgardDB.put('sync_meta', {
        table: table,
        last_sync: time,
        updated_at: new Date().toISOString()
      });
    } catch(e) {
      console.error('Failed to save sync time:', e);
    }
  }

  // API запрос к серверу
  async function apiRequest(endpoint, method = 'GET', data = null) {
    const settings = await getSettings();
    if (!settings.api_url) {
      throw new Error('API URL не настроен');
    }

    const url = `${settings.api_url.replace(/\/$/, '')}/${endpoint}`;
    const headers = {
      'Content-Type': 'application/json'
    };

    if (settings.api_key) {
      headers['Authorization'] = `Bearer ${settings.api_key}`;
    }

    const options = {
      method,
      headers,
      mode: 'cors'
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    return await response.json();
  }

  // Проверить подключение к серверу
  async function checkConnection() {
    try {
      const result = await apiRequest('health');
      return { connected: true, server: result };
    } catch(e) {
      return { connected: false, error: e.message };
    }
  }

  // Получить изменения с сервера (pull)
  async function pullChanges(table, since = null) {
    const endpoint = since 
      ? `sync/${table}?since=${encodeURIComponent(since)}`
      : `sync/${table}`;
    
    return await apiRequest(endpoint);
  }

  // Отправить изменения на сервер (push)
  async function pushChanges(table, records) {
    if (!records || records.length === 0) return { pushed: 0 };
    
    return await apiRequest(`sync/${table}`, 'POST', { records });
  }

  // Получить локальные изменения с момента последней синхронизации
  async function getLocalChanges(table, since) {
    try {
      const all = await AsgardDB.getAll(table) || [];
      
      if (!since) return all;
      
      const sinceDate = new Date(since);
      return all.filter(record => {
        const updatedAt = record.updated_at || record.created_at;
        return updatedAt && new Date(updatedAt) > sinceDate;
      });
    } catch(e) {
      console.error(`Error getting local changes for ${table}:`, e);
      return [];
    }
  }

  // Применить изменения с сервера локально
  async function applyServerChanges(table, records) {
    let applied = 0;
    let conflicts = 0;

    for (const serverRecord of records) {
      try {
        const localRecord = await AsgardDB.get(table, serverRecord.id);
        
        if (!localRecord) {
          // Новая запись с сервера
          await AsgardDB.put(table, serverRecord);
          applied++;
        } else {
          // Конфликт - используем стратегию "server wins" или по времени
          const serverTime = new Date(serverRecord.updated_at || 0);
          const localTime = new Date(localRecord.updated_at || 0);
          
          if (serverTime >= localTime) {
            // Серверная версия новее
            await AsgardDB.put(table, serverRecord);
            applied++;
          } else {
            // Локальная версия новее - оставляем локальную
            conflicts++;
          }
        }
      } catch(e) {
        console.error(`Error applying change for ${table}:`, e);
      }
    }

    return { applied, conflicts };
  }

  // Синхронизировать одну таблицу
  async function syncTable(table, options = {}) {
    const lastSync = await getLastSyncTime(table);
    const syncTime = new Date().toISOString();
    
    const result = {
      table,
      pulled: 0,
      pushed: 0,
      conflicts: 0,
      errors: []
    };

    try {
      // 1. Pull: получить изменения с сервера
      if (options.pull !== false) {
        const serverChanges = await pullChanges(table, lastSync);
        if (serverChanges.records && serverChanges.records.length > 0) {
          const applyResult = await applyServerChanges(table, serverChanges.records);
          result.pulled = applyResult.applied;
          result.conflicts = applyResult.conflicts;
        }
      }

      // 2. Push: отправить локальные изменения на сервер
      if (options.push !== false) {
        const localChanges = await getLocalChanges(table, lastSync);
        if (localChanges.length > 0) {
          const pushResult = await pushChanges(table, localChanges);
          result.pushed = pushResult.pushed || localChanges.length;
        }
      }

      // 3. Обновить время последней синхронизации
      await setLastSyncTime(table, syncTime);

    } catch(e) {
      result.errors.push(e.message);
    }

    return result;
  }

  // Полная синхронизация всех таблиц
  async function syncAll(options = {}) {
    if (syncInProgress) {
      return { success: false, error: 'Синхронизация уже выполняется' };
    }

    syncInProgress = true;
    currentStatus = 'syncing';
    updateStatusUI();

    const results = {
      success: true,
      tables: {},
      totalPulled: 0,
      totalPushed: 0,
      totalConflicts: 0,
      errors: []
    };

    const tables = options.tables || SYNC_TABLES;

    for (const table of tables) {
      try {
        const result = await syncTable(table, options);
        results.tables[table] = result;
        results.totalPulled += result.pulled;
        results.totalPushed += result.pushed;
        results.totalConflicts += result.conflicts;
        
        if (result.errors.length > 0) {
          results.errors.push(...result.errors.map(e => `${table}: ${e}`));
        }
      } catch(e) {
        results.tables[table] = { error: e.message };
        results.errors.push(`${table}: ${e.message}`);
      }
    }

    results.success = results.errors.length === 0;
    lastSyncTime = new Date();
    currentStatus = results.success ? 'success' : 'error';
    syncInProgress = false;
    updateStatusUI();

    // Сохраняем результат
    await saveLastSyncResult(results);

    return results;
  }

  // Сохранить результат последней синхронизации
  async function saveLastSyncResult(results) {
    try {
      await AsgardDB.put('settings', {
        key: 'last_sync_result',
        value_json: JSON.stringify({
          ...results,
          timestamp: new Date().toISOString()
        }),
        updated_at: new Date().toISOString()
      });
    } catch(e) {}
  }

  // Получить результат последней синхронизации
  async function getLastSyncResult() {
    try {
      const s = await AsgardDB.get('settings', 'last_sync_result');
      return s ? JSON.parse(s.value_json || '{}') : null;
    } catch(e) {
      return null;
    }
  }

  // Экспорт всей БД для миграции на сервер
  async function exportForMigration() {
    const exportData = {
      version: 1,
      exported_at: new Date().toISOString(),
      tables: {}
    };

    for (const table of SYNC_TABLES) {
      try {
        const records = await AsgardDB.getAll(table) || [];
        exportData.tables[table] = records;
      } catch(e) {
        exportData.tables[table] = [];
      }
    }

    return exportData;
  }

  // Импорт данных с сервера (первичная загрузка)
  async function importFromServer() {
    const results = { imported: 0, errors: [] };

    for (const table of SYNC_TABLES) {
      try {
        const serverData = await pullChanges(table, null);
        if (serverData.records) {
          for (const record of serverData.records) {
            await AsgardDB.put(table, record);
            results.imported++;
          }
        }
      } catch(e) {
        results.errors.push(`${table}: ${e.message}`);
      }
    }

    return results;
  }

  // Обновить UI статуса (вызывается из layout)
  function updateStatusUI() {
    const indicator = document.getElementById('syncStatusIndicator');
    if (indicator) {
      const status = SYNC_STATUS[currentStatus];
      indicator.innerHTML = `
        <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;opacity:0.8">
          <span style="width:8px;height:8px;border-radius:50%;background:${status.color}"></span>
          ${status.name}
        </span>
      `;
    }
  }

  // Автосинхронизация (вызывается периодически)
  async function autoSync() {
    const settings = await getSettings();
    if (!settings.enabled || !settings.api_url) return;

    // Проверяем интервал
    const interval = (settings.auto_sync_minutes || 5) * 60 * 1000;
    if (lastSyncTime && (Date.now() - lastSyncTime.getTime()) < interval) {
      return;
    }

    // Проверяем подключение
    const connection = await checkConnection();
    if (!connection.connected) {
      currentStatus = 'offline';
      updateStatusUI();
      return;
    }

    // Запускаем синхронизацию
    await syncAll({ silent: true });
  }

  // Рендер страницы настроек синхронизации
  async function renderSettings({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    
    const user = auth.user;
    if (user.role !== 'ADMIN') {
      AsgardUI.toast('Доступ', 'Только для администратора', 'err');
      location.hash = '#/home';
      return;
    }

    const settings = await getSettings();
    const lastResult = await getLastSyncResult();
    const connection = await checkConnection();

    const html = `
      <div class="panel">
        <h3 style="margin-bottom:16px">🔄 Синхронизация с PostgreSQL</h3>
        
        <div class="row" style="gap:16px;flex-wrap:wrap;margin-bottom:16px">
          <div class="card" style="flex:1;min-width:200px;padding:16px;border-left:4px solid ${connection.connected ? 'var(--green)' : 'var(--red)'}">
            <div class="help">Статус подключения</div>
            <div style="font-size:18px;font-weight:bold">${connection.connected ? '✅ Подключено' : '❌ Нет связи'}</div>
            ${connection.error ? `<div class="help" style="color:var(--red)">${esc(connection.error)}</div>` : ''}
          </div>
          <div class="card" style="flex:1;min-width:200px;padding:16px">
            <div class="help">Последняя синхронизация</div>
            <div style="font-size:18px;font-weight:bold">${lastResult?.timestamp ? formatDateTime(lastResult.timestamp) : 'Никогда'}</div>
          </div>
          <div class="card" style="flex:1;min-width:200px;padding:16px">
            <div class="help">Результат</div>
            <div style="font-size:14px">
              ${lastResult ? `↓${lastResult.totalPulled || 0} ↑${lastResult.totalPushed || 0} ⚠️${lastResult.totalConflicts || 0}` : '—'}
            </div>
          </div>
        </div>

        <details open style="margin-bottom:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:var(--blue)"></span> Настройки подключения</summary>
          <div class="formrow" style="margin-top:12px">
            <div style="grid-column:1/-1">
              <label>URL API сервера *</label>
              <input type="url" id="syncApiUrl" class="inp" value="${esc(settings.api_url || '')}" placeholder="https://your-server.com/api"/>
              <div class="help">Endpoint REST API для синхронизации</div>
            </div>
            <div>
              <label>API ключ</label>
              <input type="password" id="syncApiKey" class="inp" value="${esc(settings.api_key || '')}" placeholder="Bearer token"/>
            </div>
            <div>
              <label>Интервал автосинхронизации (мин)</label>
              <input type="number" id="syncInterval" class="inp" value="${settings.auto_sync_minutes || 5}" min="1" max="60"/>
            </div>
            <div>
              <label><input type="checkbox" id="syncEnabled" ${settings.enabled ? 'checked' : ''}/> Включить синхронизацию</label>
            </div>
          </div>
          <div style="margin-top:12px">
            <button class="btn" id="btnSaveSync">Сохранить настройки</button>
            <button class="btn ghost" id="btnTestConnection" style="margin-left:8px">Проверить подключение</button>
          </div>
        </details>

        <details style="margin-bottom:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:var(--green)"></span> Управление синхронизацией</summary>
          <div style="margin-top:12px;display:flex;gap:12px;flex-wrap:wrap">
            <button class="btn primary" id="btnSyncNow">🔄 Синхронизировать сейчас</button>
            <button class="btn ghost" id="btnPullAll">⬇️ Только загрузить с сервера</button>
            <button class="btn ghost" id="btnPushAll">⬆️ Только отправить на сервер</button>
          </div>
          <div id="syncProgress" style="margin-top:12px;display:none">
            <div class="help">Идёт синхронизация...</div>
            <div style="height:4px;background:var(--bg-elevated);border-radius:2px;overflow:hidden;margin-top:8px">
              <div id="syncProgressBar" style="height:100%;background:var(--blue);width:0%;transition:width 0.3s"></div>
            </div>
          </div>
        </details>

        <details style="margin-bottom:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:var(--amber)"></span> Миграция данных</summary>
          <div style="margin-top:12px">
            <p class="help" style="margin-bottom:12px">Экспорт всех данных для первичной загрузки на сервер PostgreSQL:</p>
            <button class="btn" id="btnExportMigration">📦 Экспорт для миграции (JSON)</button>
            <button class="btn ghost" id="btnImportServer" style="margin-left:8px">📥 Импорт с сервера</button>
          </div>
        </details>

        <details>
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:var(--purple)"></span> Таблицы для синхронизации (${SYNC_TABLES.length})</summary>
          <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">
            ${SYNC_TABLES.map(t => `<span class="badge">${esc(t)}</span>`).join('')}
          </div>
        </details>

        ${lastResult?.errors?.length > 0 ? `
          <details style="margin-top:16px">
            <summary class="kpi" style="cursor:pointer;color:var(--red)"><span class="dot" style="background:var(--red)"></span> Ошибки (${lastResult.errors.length})</summary>
            <div style="margin-top:12px">
              ${lastResult.errors.map(e => `<div class="help" style="color:var(--red);margin-bottom:4px">• ${esc(e)}</div>`).join('')}
            </div>
          </details>
        ` : ''}
      </div>
    `;

    await layout(html, { title: title || 'PostgreSQL Sync' });

    // Обработчики
    document.getElementById('btnSaveSync')?.addEventListener('click', async () => {
      const newSettings = {
        api_url: document.getElementById('syncApiUrl').value.trim(),
        api_key: document.getElementById('syncApiKey').value.trim(),
        auto_sync_minutes: parseInt(document.getElementById('syncInterval').value) || 5,
        enabled: document.getElementById('syncEnabled').checked,
        updated_at: new Date().toISOString()
      };
      
      if (await saveSettings(newSettings)) {
        AsgardUI.toast('Сохранено', 'Настройки синхронизации сохранены', 'ok');
      }
    });

    document.getElementById('btnTestConnection')?.addEventListener('click', async () => {
      const conn = await checkConnection();
      if (conn.connected) {
        AsgardUI.toast('Успех', 'Подключение установлено', 'ok');
      } else {
        AsgardUI.toast('Ошибка', conn.error || 'Не удалось подключиться', 'err');
      }
    });

    document.getElementById('btnSyncNow')?.addEventListener('click', async () => {
      showSyncProgress(true);
      const result = await syncAll();
      showSyncProgress(false);
      
      if (result.success) {
        AsgardUI.toast('Синхронизация', `Загружено: ${result.totalPulled}, Отправлено: ${result.totalPushed}`, 'ok');
      } else {
        AsgardUI.toast('Ошибка', `${result.errors.length} ошибок`, 'err');
      }
      
      renderSettings({ layout, title });
    });

    document.getElementById('btnPullAll')?.addEventListener('click', async () => {
      showSyncProgress(true);
      const result = await syncAll({ push: false });
      showSyncProgress(false);
      AsgardUI.toast('Загрузка', `Загружено: ${result.totalPulled} записей`, 'ok');
      renderSettings({ layout, title });
    });

    document.getElementById('btnPushAll')?.addEventListener('click', async () => {
      showSyncProgress(true);
      const result = await syncAll({ pull: false });
      showSyncProgress(false);
      AsgardUI.toast('Отправка', `Отправлено: ${result.totalPushed} записей`, 'ok');
      renderSettings({ layout, title });
    });

    document.getElementById('btnExportMigration')?.addEventListener('click', async () => {
      const data = await exportForMigration();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `asgard-migration-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      AsgardUI.toast('Экспорт', 'Файл миграции скачан', 'ok');
    });

    document.getElementById('btnImportServer')?.addEventListener('click', async () => {
      if (!confirm('Это загрузит все данные с сервера. Локальные данные могут быть перезаписаны. Продолжить?')) return;
      
      showSyncProgress(true);
      const result = await importFromServer();
      showSyncProgress(false);
      
      if (result.errors.length === 0) {
        AsgardUI.toast('Импорт', `Импортировано: ${result.imported} записей`, 'ok');
      } else {
        AsgardUI.toast('Ошибка', `${result.errors.length} ошибок при импорте`, 'err');
      }
      
      renderSettings({ layout, title });
    });
  }

  function showSyncProgress(show) {
    const el = document.getElementById('syncProgress');
    if (el) el.style.display = show ? 'block' : 'none';
  }

  // Helpers
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function formatDateTime(d) { return d ? new Date(d).toLocaleString('ru-RU') : ''; }

  // Инициализация автосинхронизации
  async function init() {
    const token = localStorage.getItem('asgard_token');
    if (!token) return; // Не инициализировать без авторизации
    const settings = await getSettings();
    if (settings.enabled && settings.api_url) {
      // Запускаем автосинхронизацию каждые N минут
      const interval = (settings.auto_sync_minutes || 5) * 60 * 1000;
      setInterval(autoSync, interval);
      
      // Первая синхронизация через 10 секунд после загрузки
      setTimeout(autoSync, 10000);
    }
  }

  // Автоинициализация при загрузке
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 1000);
  }

  return {
    getSettings,
    saveSettings,
    checkConnection,
    syncTable,
    syncAll,
    exportForMigration,
    importFromServer,
    renderSettings,
    getLastSyncResult,
    autoSync,
    SYNC_TABLES,
    SYNC_STATUS
  };
})();
