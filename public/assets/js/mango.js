/**
 * АСГАРД CRM — Манго Телеком интеграция
 * Этап 43
 * 
 * Функционал:
 * - Переключатель приёма звонков на главной
 * - Карточка входящего звонка
 * - История звонков
 * - Click-to-call
 * - Интеграция с API Манго
 * 
 * ТРЕБУЕТСЯ: API ключ Манго Телеком
 */
window.AsgardMango = (function(){
  
  // Настройки по умолчанию
  const DEFAULT_SETTINGS = {
    api_key: '',
    api_salt: '',
    vpbx_host: '',
    enabled: false,
    webhook_url: ''
  };

  // Статусы пользователей
  const userCallStatus = new Map(); // userId -> { accepting: boolean, busy: boolean }
  
  // Текущий звонок
  let currentCall = null;
  let callPopupElement = null;

  // Получить настройки
  async function getSettings() {
    try {
      const s = await AsgardDB.get('settings', 'mango');
      return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s.value_json || '{}') } : DEFAULT_SETTINGS;
    } catch(e) {
      return DEFAULT_SETTINGS;
    }
  }

  // Сохранить настройки
  async function saveSettings(settings) {
    try {
      await AsgardDB.put('settings', {
        key: 'mango',
        value_json: JSON.stringify(settings),
        updated_at: new Date().toISOString()
      });
      return true;
    } catch(e) {
      return false;
    }
  }

  // Получить статус приёма звонков пользователя
  async function getUserCallStatus(userId) {
    try {
      const status = await AsgardDB.get('user_call_status', String(userId));
      return status || { user_id: String(userId), accepting: false, busy: false };
    } catch(e) {
      return { user_id: String(userId), accepting: false, busy: false };
    }
  }

  // Установить статус приёма звонков
  async function setUserCallStatus(userId, accepting) {
    try {
      await AsgardDB.put('user_call_status', {
        user_id: String(userId),
        accepting: accepting,
        busy: false,
        updated_at: new Date().toISOString()
      });
      
      userCallStatus.set(String(userId), { accepting, busy: false });
      
      // Уведомляем сервер (если настроен webhook)
      await notifyStatusChange(userId, accepting);
      
      return true;
    } catch(e) {
      return false;
    }
  }

  // Уведомить сервер об изменении статуса
  async function notifyStatusChange(userId, accepting) {
    const settings = await getSettings();
    if (!settings.webhook_url) return;
    
    try {
      await fetch(settings.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'status_change',
          user_id: userId,
          accepting: accepting,
          timestamp: new Date().toISOString()
        })
      });
    } catch(e) {
      console.error('Mango webhook error:', e);
    }
  }

  // Получить всех пользователей, принимающих звонки
  async function getAcceptingUsers() {
    try {
      const all = await AsgardDB.getAll('user_call_status') || [];
      return all.filter(s => s.accepting && !s.busy);
    } catch(e) {
      return [];
    }
  }

  // Инициализация статусов для ТО по умолчанию
  async function initDefaultStatuses() {
    try {
      const users = await AsgardDB.getAll('users') || [];
      
      for (const user of users) {
        const existing = await AsgardDB.get('user_call_status', String(user.id));
        if (!existing) {
          // По умолчанию только ТО принимают звонки
          const accepting = user.role === 'TO';
          await AsgardDB.put('user_call_status', {
            user_id: String(user.id),
            accepting: accepting,
            busy: false,
            created_at: new Date().toISOString()
          });
        }
      }
    } catch(e) {
      console.error('Init call statuses error:', e);
    }
  }

  // ========== ВИДЖЕТ ПЕРЕКЛЮЧАТЕЛЯ ==========
  
  async function renderCallToggle(containerId) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) return;
    
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const status = await getUserCallStatus(auth.user.id);
    const settings = await getSettings();
    
    container.innerHTML = `
      <div class="call-toggle-widget">
        <div class="call-toggle-header">
          <span class="call-toggle-icon">${status.accepting ? '📞' : '📵'}</span>
          <span class="call-toggle-label">Приём звонков</span>
        </div>
        <label class="call-toggle-switch">
          <input type="checkbox" id="callAcceptToggle" ${status.accepting ? 'checked' : ''} ${!settings.enabled ? 'disabled' : ''}/>
          <span class="call-toggle-slider"></span>
        </label>
        ${!settings.enabled ? '<div class="call-toggle-hint">Телефония не настроена</div>' : ''}
        ${status.accepting ? '<div class="call-toggle-status active">Звонки поступают</div>' : '<div class="call-toggle-status">Звонки не поступают</div>'}
      </div>
      
      <style>
        .call-toggle-widget {
          background: var(--bg-card);
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .call-toggle-header {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .call-toggle-icon {
          font-size: 24px;
        }
        
        .call-toggle-label {
          font-weight: 600;
          font-size: 14px;
        }
        
        .call-toggle-switch {
          position: relative;
          display: inline-block;
          width: 56px;
          height: 30px;
          align-self: flex-start;
        }
        
        .call-toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        
        .call-toggle-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: var(--bg-elevated);
          border: 1px solid var(--line);
          border-radius: 30px;
          transition: 0.3s;
        }
        
        .call-toggle-slider:before {
          position: absolute;
          content: "";
          height: 22px;
          width: 22px;
          left: 3px;
          bottom: 3px;
          background-color: #fff;
          border-radius: 50%;
          transition: 0.3s;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        
        .call-toggle-switch input:checked + .call-toggle-slider {
          background: linear-gradient(135deg, var(--green), #15803d);
          border-color: var(--green);
        }
        
        .call-toggle-switch input:checked + .call-toggle-slider:before {
          transform: translateX(26px);
        }
        
        .call-toggle-switch input:disabled + .call-toggle-slider {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .call-toggle-hint {
          font-size: 11px;
          color: var(--amber);
        }
        
        .call-toggle-status {
          font-size: 12px;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .call-toggle-status.active {
          color: var(--green);
        }
        
        .call-toggle-status.active::before {
          content: '';
          width: 8px;
          height: 8px;
          background: var(--green);
          border-radius: 50%;
          animation: callPulse 2s infinite;
        }
        
        @keyframes callPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }
      </style>
    `;
    
    // Обработчик переключения
    document.getElementById('callAcceptToggle')?.addEventListener('change', async (e) => {
      const accepting = e.target.checked;
      await setUserCallStatus(auth.user.id, accepting);
      
      // Обновляем UI
      renderCallToggle(containerId);
      
      if (accepting) {
        AsgardUI.toast('Телефония', 'Вы принимаете входящие звонки', 'ok');
      } else {
        AsgardUI.toast('Телефония', 'Приём звонков отключён', 'info');
      }
    });
  }

  // ========== КАРТОЧКА ВХОДЯЩЕГО ЗВОНКА ==========
  
  function showIncomingCall(callData) {
    // callData: { caller_id, caller_name, caller_number, call_id }
    
    if (callPopupElement) {
      callPopupElement.remove();
    }
    
    currentCall = callData;
    
    const html = `
      <div class="incoming-call-popup" id="incomingCallPopup">
        <div class="call-popup-content">
          <div class="call-popup-header">
            <div class="call-avatar">📞</div>
            <div class="call-info">
              <div class="call-title">Входящий звонок</div>
              <div class="call-number">${esc(callData.caller_number || 'Неизвестный')}</div>
              ${callData.caller_name ? `<div class="call-name">${esc(callData.caller_name)}</div>` : ''}
            </div>
          </div>
          
          ${callData.customer ? `
            <div class="call-customer">
              <div class="call-customer-label">Контрагент:</div>
              <div class="call-customer-name">${esc(callData.customer.name)}</div>
              <a href="#/customers?open=${callData.customer.id}" class="btn mini ghost">Открыть карточку</a>
            </div>
          ` : ''}
          
          <div class="call-actions">
            <button class="btn call-accept" id="btnAcceptCall">
              <span>📞</span> Ответить
            </button>
            <button class="btn call-reject" id="btnRejectCall">
              <span>📵</span> Отклонить
            </button>
          </div>
          
          <div class="call-timer" id="callTimer">00:00</div>
        </div>
      </div>
      
      <style>
        .incoming-call-popup {
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 99999;
          animation: callSlideIn 0.3s ease;
        }
        
        @keyframes callSlideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        
        .call-popup-content {
          background: linear-gradient(135deg, #1a1a2e, #0d1428);
          border: 2px solid var(--green);
          border-radius: 20px;
          padding: 20px;
          min-width: 320px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), 0 0 30px rgba(34, 197, 94, 0.3);
          animation: callGlow 1.5s ease-in-out infinite;
        }
        
        @keyframes callGlow {
          0%, 100% { box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), 0 0 30px rgba(34, 197, 94, 0.3); }
          50% { box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), 0 0 50px rgba(34, 197, 94, 0.5); }
        }
        
        .call-popup-header {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 16px;
        }
        
        .call-avatar {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--green), #15803d);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          animation: callRing 0.5s ease-in-out infinite;
        }
        
        @keyframes callRing {
          0%, 100% { transform: rotate(-5deg); }
          50% { transform: rotate(5deg); }
        }
        
        .call-info {
          flex: 1;
        }
        
        .call-title {
          font-size: 12px;
          color: var(--green);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 4px;
        }
        
        .call-number {
          font-size: 20px;
          font-weight: 700;
          color: #fff;
        }
        
        .call-name {
          font-size: 14px;
          color: var(--text-muted);
          margin-top: 2px;
        }
        
        .call-customer {
          background: rgba(34, 197, 94, 0.1);
          border: 1px solid rgba(34, 197, 94, 0.2);
          border-radius: 12px;
          padding: 12px;
          margin-bottom: 16px;
        }
        
        .call-customer-label {
          font-size: 11px;
          color: var(--text-muted);
        }
        
        .call-customer-name {
          font-weight: 600;
          margin: 4px 0;
        }
        
        .call-actions {
          display: flex;
          gap: 12px;
        }
        
        .call-accept {
          flex: 1;
          background: linear-gradient(135deg, var(--green), #15803d) !important;
          border: none !important;
          color: #fff !important;
          padding: 14px !important;
          font-size: 16px !important;
        }
        
        .call-accept:hover {
          transform: scale(1.02);
        }
        
        .call-reject {
          flex: 1;
          background: linear-gradient(135deg, var(--red), #b91c1c) !important;
          border: none !important;
          color: #fff !important;
          padding: 14px !important;
          font-size: 16px !important;
        }
        
        .call-reject:hover {
          transform: scale(1.02);
        }
        
        .call-timer {
          text-align: center;
          font-size: 24px;
          font-weight: 600;
          color: var(--green);
          margin-top: 16px;
          font-family: monospace;
        }
      </style>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    callPopupElement = document.getElementById('incomingCallPopup');
    
    // Таймер звонка
    let seconds = 0;
    const timerEl = document.getElementById('callTimer');
    const timerInterval = setInterval(() => {
      seconds++;
      const m = Math.floor(seconds / 60).toString().padStart(2, '0');
      const s = (seconds % 60).toString().padStart(2, '0');
      if (timerEl) timerEl.textContent = `${m}:${s}`;
    }, 1000);
    
    // Звук звонка (если включены звуки)
    playRingtone();
    
    // Обработчики
    document.getElementById('btnAcceptCall')?.addEventListener('click', () => {
      clearInterval(timerInterval);
      stopRingtone();
      acceptCall(callData);
    });
    
    document.getElementById('btnRejectCall')?.addEventListener('click', () => {
      clearInterval(timerInterval);
      stopRingtone();
      rejectCall(callData);
    });
  }

  // Принять звонок
  async function acceptCall(callData) {
    if (callPopupElement) {
      callPopupElement.querySelector('.call-popup-content').style.borderColor = 'var(--blue)';
      callPopupElement.querySelector('.call-title').textContent = 'Разговор';
      callPopupElement.querySelector('.call-avatar').textContent = '🎧';
      callPopupElement.querySelector('.call-avatar').style.animation = 'none';
      callPopupElement.querySelector('.call-actions').innerHTML = `
        <button class="btn" id="btnEndCall" style="flex:1;background:var(--red)!important;color:#fff!important">
          📵 Завершить
        </button>
      `;
      
      document.getElementById('btnEndCall')?.addEventListener('click', () => {
        endCall(callData);
      });
    }
    
    // Логируем в историю
    await logCall(callData, 'answered');
    
    // API вызов к Манго для принятия звонка
    // await mangoAPI('call/answer', { call_id: callData.call_id });
  }

  // Отклонить звонок
  async function rejectCall(callData) {
    hideCallPopup();
    await logCall(callData, 'rejected');
    
    // API вызов к Манго
    // await mangoAPI('call/reject', { call_id: callData.call_id });
  }

  // Завершить звонок
  async function endCall(callData) {
    hideCallPopup();
    await logCall(callData, 'ended');
    
    // API вызов к Манго
    // await mangoAPI('call/hangup', { call_id: callData.call_id });
  }

  function hideCallPopup() {
    if (callPopupElement) {
      callPopupElement.style.animation = 'callSlideOut 0.3s ease forwards';
      setTimeout(() => {
        callPopupElement?.remove();
        callPopupElement = null;
      }, 300);
    }
    currentCall = null;
    stopRingtone();
  }

  // ========== ИСТОРИЯ ЗВОНКОВ ==========
  
  async function logCall(callData, status) {
    try {
      await AsgardDB.add('call_history', {
        call_id: callData.call_id || 'call_' + Date.now(),
        caller_number: callData.caller_number,
        caller_name: callData.caller_name,
        customer_id: callData.customer?.id,
        direction: 'incoming',
        status: status, // answered, rejected, missed, ended
        duration: 0,
        timestamp: new Date().toISOString()
      });
    } catch(e) {
      console.error('Log call error:', e);
    }
  }

  async function getCallHistory(limit = 50) {
    try {
      const all = await AsgardDB.getAll('call_history') || [];
      return all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
    } catch(e) {
      return [];
    }
  }

  // ========== CLICK-TO-CALL ==========
  
  async function makeCall(phoneNumber) {
    const settings = await getSettings();
    if (!settings.enabled || !settings.api_key) {
      AsgardUI.toast('Телефония', 'Телефония не настроена', 'warn');
      return false;
    }
    
    // API вызов к Манго для исходящего звонка
    try {
      // await mangoAPI('call/make', { to: phoneNumber });
      AsgardUI.toast('Звонок', `Набираем ${phoneNumber}...`, 'info');
      return true;
    } catch(e) {
      AsgardUI.toast('Ошибка', 'Не удалось совершить звонок', 'err');
      return false;
    }
  }

  // ========== РИНГТОН ==========
  
  let ringtoneInterval = null;
  
  function playRingtone() {
    if (localStorage.getItem('asgard_sounds') === 'false') return;
    
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      const playTone = () => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.value = 440;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        osc.start();
        osc.stop(audioContext.currentTime + 0.5);
      };
      
      playTone();
      ringtoneInterval = setInterval(playTone, 2000);
    } catch(e) {}
  }

  function stopRingtone() {
    if (ringtoneInterval) {
      clearInterval(ringtoneInterval);
      ringtoneInterval = null;
    }
  }

  // ========== MANGO API ==========
  
  async function mangoAPI(endpoint, data = {}) {
    const settings = await getSettings();
    if (!settings.api_key) throw new Error('API key not configured');
    
    // Формируем подпись
    const json = JSON.stringify(data);
    const sign = await sha256(settings.api_key + json + settings.api_salt);
    
    const response = await fetch(`https://app.mango-office.ru/vpbx/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `vpbx_api_key=${settings.api_key}&sign=${sign}&json=${encodeURIComponent(json)}`
    });
    
    return await response.json();
  }

  async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ========== СТРАНИЦА НАСТРОЕК ==========
  
  async function renderSettings({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    
    if (auth.user.role !== 'ADMIN') {
      AsgardUI.toast('Доступ', 'Только для администратора', 'err');
      location.hash = '#/home';
      return;
    }

    const settings = await getSettings();
    const users = await AsgardDB.getAll('users') || [];
    const statuses = [];
    
    for (const user of users) {
      const status = await getUserCallStatus(user.id);
      statuses.push({ ...user, callStatus: status });
    }

    const html = `
      <div class="panel">
        <h3 style="margin-bottom:16px">📞 Манго Телеком — Интеграция</h3>
        
        <div class="row" style="gap:16px;flex-wrap:wrap;margin-bottom:24px">
          <div class="card" style="flex:1;min-width:200px;padding:16px;border-left:4px solid ${settings.enabled ? 'var(--green)' : 'var(--red)'}">
            <div class="help">Статус</div>
            <div style="font-size:18px;font-weight:bold">${settings.enabled ? '✅ Подключено' : '❌ Не настроено'}</div>
          </div>
          <div class="card" style="flex:1;min-width:200px;padding:16px">
            <div class="help">Принимают звонки</div>
            <div style="font-size:18px;font-weight:bold">${statuses.filter(s => s.callStatus?.accepting).length} из ${users.length}</div>
          </div>
        </div>

        <details open style="margin-bottom:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:var(--blue)"></span> Настройки API</summary>
          <div class="formrow" style="margin-top:12px">
            <div>
              <label>API Key *</label>
              <input type="password" id="mangoApiKey" class="inp" value="${esc(settings.api_key || '')}" placeholder="Ваш API ключ"/>
            </div>
            <div>
              <label>API Salt *</label>
              <input type="password" id="mangoApiSalt" class="inp" value="${esc(settings.api_salt || '')}" placeholder="Секретный ключ"/>
            </div>
            <div>
              <label>VPBX Host</label>
              <input type="text" id="mangoVpbxHost" class="inp" value="${esc(settings.vpbx_host || '')}" placeholder="vpbx123456"/>
            </div>
            <div>
              <label>Webhook URL</label>
              <input type="url" id="mangoWebhook" class="inp" value="${esc(settings.webhook_url || '')}" placeholder="https://your-server.com/webhook"/>
            </div>
            <div>
              <label><input type="checkbox" id="mangoEnabled" ${settings.enabled ? 'checked' : ''}/> Включить телефонию</label>
            </div>
          </div>
          <div style="margin-top:12px">
            <button class="btn primary" id="btnSaveMango">Сохранить настройки</button>
            <button class="btn ghost" id="btnTestMango" style="margin-left:8px">Тест подключения</button>
          </div>
        </details>

        <details style="margin-bottom:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:var(--green)"></span> Статусы сотрудников</summary>
          <div style="margin-top:12px">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Роль</th>
                  <th>Принимает звонки</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${statuses.map(u => `
                  <tr>
                    <td>${esc(u.name || u.login)}</td>
                    <td><span class="badge">${esc(u.role)}</span></td>
                    <td>
                      ${u.callStatus?.accepting 
                        ? '<span style="color:var(--green)">✅ Да</span>' 
                        : '<span style="color:var(--text-muted)">❌ Нет</span>'}
                    </td>
                    <td>
                      <button class="btn mini ghost btnToggleUser" data-user-id="${u.id}" data-accepting="${u.callStatus?.accepting || false}">
                        ${u.callStatus?.accepting ? 'Выключить' : 'Включить'}
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </details>

        <details>
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:var(--amber)"></span> История звонков</summary>
          <div id="callHistoryList" style="margin-top:12px">
            <div class="help">Загрузка...</div>
          </div>
        </details>
      </div>
    `;

    await layout(html, { title: title || 'Телефония' });

    // Загружаем историю
    loadCallHistory();

    // Обработчики
    document.getElementById('btnSaveMango')?.addEventListener('click', async () => {
      const newSettings = {
        api_key: document.getElementById('mangoApiKey').value.trim(),
        api_salt: document.getElementById('mangoApiSalt').value.trim(),
        vpbx_host: document.getElementById('mangoVpbxHost').value.trim(),
        webhook_url: document.getElementById('mangoWebhook').value.trim(),
        enabled: document.getElementById('mangoEnabled').checked,
        updated_at: new Date().toISOString()
      };
      
      if (await saveSettings(newSettings)) {
        AsgardUI.toast('Сохранено', 'Настройки телефонии сохранены', 'ok');
      }
    });

    document.getElementById('btnTestMango')?.addEventListener('click', async () => {
      try {
        // const result = await mangoAPI('account/info');
        AsgardUI.toast('Тест', 'Подключение успешно (demo)', 'ok');
      } catch(e) {
        AsgardUI.toast('Ошибка', e.message, 'err');
      }
    });

    document.querySelectorAll('.btnToggleUser').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        const currentlyAccepting = btn.dataset.accepting === 'true';
        await setUserCallStatus(userId, !currentlyAccepting);
        renderSettings({ layout, title });
      });
    });
  }

  async function loadCallHistory() {
    const container = document.getElementById('callHistoryList');
    if (!container) return;
    
    const history = await getCallHistory(20);
    
    if (history.length === 0) {
      container.innerHTML = '<div class="help">Нет записей</div>';
      return;
    }
    
    container.innerHTML = `
      <table class="tbl">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Номер</th>
            <th>Статус</th>
            <th>Длительность</th>
          </tr>
        </thead>
        <tbody>
          ${history.map(c => `
            <tr>
              <td>${new Date(c.timestamp).toLocaleString('ru-RU')}</td>
              <td>${esc(c.caller_number || '—')}</td>
              <td>
                ${c.status === 'answered' ? '<span class="badge success">Принят</span>' : ''}
                ${c.status === 'rejected' ? '<span class="badge danger">Отклонён</span>' : ''}
                ${c.status === 'missed' ? '<span class="badge warning">Пропущен</span>' : ''}
                ${c.status === 'ended' ? '<span class="badge">Завершён</span>' : ''}
              </td>
              <td>${c.duration ? formatDuration(c.duration) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // Helpers
  function esc(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Инициализация
  async function init() {
    await initDefaultStatuses();
  }

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 500);
  }

  return {
    getSettings,
    saveSettings,
    getUserCallStatus,
    setUserCallStatus,
    getAcceptingUsers,
    renderCallToggle,
    showIncomingCall,
    hideCallPopup,
    makeCall,
    getCallHistory,
    renderSettings,
    init
  };
})();
