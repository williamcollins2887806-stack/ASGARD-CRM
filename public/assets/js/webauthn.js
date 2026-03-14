/**
 * ASGARD CRM - WebAuthn (Biometric Login) Client Module
 * Uses @simplewebauthn/browser from CDN (global: SimpleWebAuthnBrowser)
 */
window.AsgardWebAuthn = (function() {

  const DISMISSED_KEY = 'webauthn_dismissed';
  const LAST_USER_KEY = 'asgard_last_login';

  // ── Feature Detection ──
  async function isSupported() {
    if (!window.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (e) {
      return false;
    }
  }

  // ── Detect device type for button label ──
  function getBiometricLabel() {
    var ua = navigator.userAgent;
    if (/iPhone|iPad/.test(ua)) return 'Войти через Face ID';
    if (/Android/.test(ua)) return 'Войти по отпечатку';
    if (/Macintosh/.test(ua)) return 'Войти через Touch ID';
    return 'Войти с биометрией';
  }

  function getBiometricIcon() {
    var ua = navigator.userAgent;
    if (/iPhone|iPad/.test(ua)) return '👤';
    if (/Android/.test(ua)) return '👆';
    if (/Macintosh/.test(ua)) return '👆';
    return '🔐';
  }

  // ── Get last logged-in username ──
  function getLastUsername() {
    return localStorage.getItem(LAST_USER_KEY) || '';
  }

  function saveLastUsername(username) {
    localStorage.setItem(LAST_USER_KEY, username);
  }

  function isModernMobileUi() {
    return !!(window.M && M.BottomSheet && M.Toast);
  }

  function toastMessage(message, type) {
    if (window.M && M.Toast) {
      M.Toast({ message: message, type: type || 'info' });
      return;
    }
    if (window.AsgardUI) {
      const map = { success: 'ok', danger: 'err', warning: 'err', info: 'ok' };
      AsgardUI.toast('Биометрия', message, map[type] || 'ok');
    }
  }

  async function ensureBiometricSupport() {
    if (!window.isSecureContext) {
      throw new Error('Биометрический вход работает только в защищенном HTTPS-режиме CRM.');
    }
    var supported = await isSupported();
    if (!supported) {
      throw new Error('Face ID или passkey недоступны на этом iPhone или текущем устройстве.');
    }
  }

  function normalizeErrorMessage(err) {
    var message = typeof err === 'string' ? err : (err && err.message) || 'Не удалось выполнить биометрическую операцию';
    if (message === 'cancelled') return message;
    if (/library_not_loaded|library not loaded/i.test(message)) return 'Модуль биометрии еще не загрузился. Обновите страницу и попробуйте снова.';
    if (/No biometric credentials registered/i.test(message)) return 'На этом устройстве еще не настроен Face ID. Сначала войдите по паролю и подключите биометрию.';
    if (/User not found/i.test(message)) return 'Не удалось найти пользователя для входа через Face ID.';
    if (/Challenge expired/i.test(message)) return 'Сессия биометрической проверки истекла. Попробуйте еще раз.';
    if (/Verification failed|Authentication failed/i.test(message)) return 'Face ID не подтвердил вход. Попробуйте еще раз.';
    if (/rp id|origin|relying party|registrable domain/i.test(message)) return 'Неверный адрес сайта CRM. Откройте https://asgard-crm.ru и попробуйте снова.';
    if (/NotAllowedError|timed out or was not allowed/i.test(message)) return 'Запрос Face ID был отменен или отклонен.';
    return message;
  }

  // ?? Register Biometric (after normal login) ??
async function registerBiometric() {
    await ensureBiometricSupport();
    var swab = window.SimpleWebAuthnBrowser;
    if (!swab) {
      console.warn('[WebAuthn] SimpleWebAuthn library not loaded, biometric registration unavailable');
      throw new Error('Библиотека биометрии не загружена. Обновите страницу и попробуйте снова.');
    }

    var auth = window.AsgardAuth ? AsgardAuth.getAuth() : null;
    if (!auth) throw new Error('Not authenticated');

    // 1. Get registration options from server
    var resp = await fetch('/api/webauthn/register/options', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + auth.token
      }
    });

    if (!resp.ok) {
      var err = await resp.json().catch(function() { return {}; });
      throw new Error(normalizeErrorMessage(err.error || 'Failed to get registration options'));
    }

    var options = await resp.json();

    // 2. Create credential via browser API
    var attResp;
    try {
      attResp = await swab.startRegistration({ optionsJSON: options });
    } catch (e) {
      if (e.name === 'NotAllowedError') throw new Error('cancelled');
      throw new Error(normalizeErrorMessage(e));
    }

    // 3. Verify with server
    var verifyResp = await fetch('/api/webauthn/register/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + auth.token
      },
      body: JSON.stringify(attResp)
    });

    if (!verifyResp.ok) {
      var verifyErr = await verifyResp.json().catch(function() { return {}; });
      throw new Error(normalizeErrorMessage(verifyErr.error || 'Verification failed'));
    }

    return await verifyResp.json();
  }

  // ── Login with Biometric ──
  async function loginWithBiometric(username) {
    await ensureBiometricSupport();
    var swab = window.SimpleWebAuthnBrowser;
    if (!swab) {
      console.warn('[WebAuthn] SimpleWebAuthn library not loaded, biometric login unavailable');
      throw new Error(normalizeErrorMessage('library_not_loaded'));
    }

    if (!username) throw new Error('Username is required');

    // 1. Get authentication options
    var resp = await fetch('/api/webauthn/login/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username })
    });

    if (!resp.ok) {
      var err = await resp.json().catch(function() { return {}; });
      throw new Error(normalizeErrorMessage(err.error || 'Failed to get login options'));
    }

    var data = await resp.json();
    var userId = data.userId;

    // 2. Authenticate via browser API
    var authResp;
    try {
      authResp = await swab.startAuthentication({ optionsJSON: data });
    } catch (e) {
      if (e.name === 'NotAllowedError') throw new Error('cancelled');
      throw new Error(normalizeErrorMessage(e));
    }

    // 3. Verify with server
    var verifyResp = await fetch('/api/webauthn/login/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...authResp, userId: userId })
    });

    if (!verifyResp.ok) {
      var verifyErr = await verifyResp.json().catch(function() { return {}; });
      throw new Error(normalizeErrorMessage(verifyErr.error || 'Authentication failed'));
    }

    var result = await verifyResp.json();

    // 4. Save session (same as normal login)
    if (result.token) {
      localStorage.setItem('asgard_token', result.token);
    }
    if (result.user) {
      localStorage.setItem('asgard_user', JSON.stringify(result.user));
      if (result.user.permissions) {
        localStorage.setItem('asgard_permissions', JSON.stringify(result.user.permissions));
      }
      if (result.user.menu_settings) {
        localStorage.setItem('asgard_menu_settings', JSON.stringify(result.user.menu_settings));
      }
    }

    saveLastUsername(username);
    return result;
  }

  // ── Check if current device has credentials for user ──
  async function hasCredentialsForUser() {
    var auth = window.AsgardAuth ? AsgardAuth.getAuth() : null;
    if (!auth) return false;

    try {
      var resp = await fetch('/api/webauthn/credentials', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      if (!resp.ok) return false;
      var data = await resp.json();
      return data.credentials && data.credentials.length > 0;
    } catch (e) {
      return false;
    }
  }

  // ── Show registration prompt after normal login ──
  async function showRegistrationPrompt() {
    var supported = await isSupported();
    if (!supported || !window.isSecureContext) return;

    var dismissed = parseInt(localStorage.getItem(DISMISSED_KEY) || '0', 10);
    if (dismissed >= 3) return;

    var hasCreds = await hasCredentialsForUser();
    if (hasCreds) return;

    setTimeout(function() {
      if (!isModernMobileUi()) return;

      var promptId = 'webauthn-prompt-' + Math.random().toString(36).slice(2, 8);
      var modeLabel = getBiometricLabel().replace('Войти через ', '').replace('Войти по ', '').replace('Войти с ', '');
      var html = ''
        + '<div style="display:grid;gap:14px">'
        +   '<div style="padding:18px;border-radius:18px;background:var(--hero-grad);box-shadow:var(--hero-shadow);color:#fff;overflow:hidden">'
        +     '<div style="font-size:11px;font-weight:600;letter-spacing:1.1px;opacity:.7;text-transform:uppercase;margin-bottom:6px">FAST LOGIN</div>'
        +     '<div style="display:flex;gap:10px;align-items:center;margin-bottom:8px"><span style="font-size:22px;line-height:1">' + getBiometricIcon() + '</span><div style="font-size:22px;font-weight:800;line-height:1.1;letter-spacing:-.5px">Вход через ' + modeLabel + '</div></div>'
        +     '<div style="font-size:13px;line-height:1.45;opacity:.86">Подключите биометрию на устройстве и входите в CRM без ввода пароля.</div>'
        +   '</div>'
        +   '<div style="display:flex;gap:10px;align-items:flex-start;padding:14px 16px;border-radius:16px;background:var(--surface-alt);border:1px solid var(--border)"><div style="font-size:18px;line-height:1">⚡</div><div><div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:2px">Быстро и без пароля</div><div style="font-size:12px;line-height:1.45;color:var(--text-sec)">Face ID сохраняется как passkey и позволяет входить без ввода пароля.</div></div></div>'
        +   '<div style="display:grid;gap:10px;padding-top:2px">'
        +     '<button id="' + promptId + '-yes" type="button" style="height:52px;border:none;border-radius:16px;background:var(--hero-grad);color:#fff;font-size:15px;font-weight:800;letter-spacing:-.2px;box-shadow:var(--fab-shadow);cursor:pointer">Подключить Face ID</button>'
        +     '<button id="' + promptId + '-no" type="button" style="height:48px;border-radius:16px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text-sec);font-size:14px;font-weight:700;cursor:pointer">Позже</button>'
        +   '</div>'
        + '</div>';

      var sheet = M.BottomSheet({ title: 'Быстрый вход', content: html });
      var yesBtn = sheet.body.querySelector('#' + promptId + '-yes');
      var noBtn = sheet.body.querySelector('#' + promptId + '-no');

      yesBtn.addEventListener('click', async function() {
        yesBtn.disabled = true;
        yesBtn.textContent = 'Подключаем...';
        try {
          var result = await registerBiometric();
          if (result.verified) {
            sheet.close();
            toastMessage('Face ID готов для этого устройства', 'success');
          }
        } catch (e) {
          yesBtn.disabled = false;
          yesBtn.textContent = 'Подключить Face ID';
          if (e.message === 'cancelled') return;
          toastMessage(normalizeErrorMessage(e), 'danger');
        }
      });

      noBtn.addEventListener('click', function() {
        sheet.close();
        var c = parseInt(localStorage.getItem(DISMISSED_KEY) || '0', 10);
        localStorage.setItem(DISMISSED_KEY, String(c + 1));
      });
    }, 3000);
  }

  function renderLoginButton(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var lastUser = getLastUsername();
    if (!lastUser) return;

    (async function() {
      var supported = await isSupported();
      if (!supported || !window.isSecureContext) {
        container.innerHTML = '';
        return;
      }

      var html = ''
        + '<div style="display:grid;gap:12px;margin:14px 0 10px">'
        +   '<div style="padding:16px;border-radius:18px;background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));border:1px solid var(--border);box-shadow:var(--shadow)">'
        +     '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px"><div style="width:44px;height:44px;border-radius:14px;background:var(--hero-grad);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;box-shadow:var(--fab-shadow)">' + getBiometricIcon() + '</div><div style="min-width:0"><div style="font-size:15px;font-weight:800;letter-spacing:-.2px;color:var(--text)">' + getBiometricLabel() + '</div><div style="margin-top:3px;font-size:12px;line-height:1.4;color:var(--text-sec);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + lastUser + '</div></div></div>'
        +     '<button id="btnBiometricLogin" type="button" style="width:100%;height:50px;border:none;border-radius:16px;background:var(--hero-grad);color:#fff;font-size:15px;font-weight:800;letter-spacing:-.2px;box-shadow:var(--fab-shadow);cursor:pointer">Войти через биометрию</button>'
        +   '</div>'
        +   '<div style="text-align:center;font-size:12px;color:var(--text-sec)">или войдите по логину и паролю</div>'
        + '</div>';

      container.innerHTML = html;

      document.getElementById('btnBiometricLogin').addEventListener('click', async function() {
        var btn = this;
        btn.disabled = true;
        btn.textContent = 'Проверяем Face ID...';
        try {
          var result = await loginWithBiometric(lastUser);
          if (result.status === 'ok') {
            location.hash = '#/home';
            return;
          }
          throw new Error('Не удалось выполнить вход через биометрию');
        } catch (e) {
          btn.disabled = false;
          btn.textContent = 'Войти через биометрию';
          if (e.message === 'cancelled') return;
          toastMessage(normalizeErrorMessage(e), 'danger');
        }
      });
    })();
  }

  function renderDevicesSection() {
    return '<div style="margin-top:14px;padding:18px;border-radius:20px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow)" id="webauthn-devices-section">'
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><div style="width:34px;height:34px;border-radius:12px;background:var(--hero-grad);display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px">🔐</div><div><div style="font-size:15px;font-weight:800;color:var(--text)">Ваши устройства</div><div style="font-size:12px;color:var(--text-sec)">Face ID и passkey для быстрого входа</div></div></div>'
      + '<div id="webauthn-devices-list"><div class="help">Загрузка...</div></div>'
      + '</div>';
  }

  async function loadDevices() {
    var container = document.getElementById('webauthn-devices-list');
    if (!container) return;

    var supported = await isSupported();
    var auth = window.AsgardAuth ? AsgardAuth.getAuth() : null;
    if (!auth) {
      container.innerHTML = '<div class="help">Требуется авторизация</div>';
      return;
    }

    try {
      var resp = await fetch('/api/webauthn/credentials', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      if (!resp.ok) throw new Error('Failed to load');
      var data = await resp.json();
      var creds = data.credentials || [];

      if (creds.length === 0) {
        var html = '<div style="display:grid;gap:12px">';
        html += '<div style="padding:14px 16px;border-radius:16px;background:var(--surface-alt);border:1px solid var(--border);font-size:13px;line-height:1.5;color:var(--text-sec)">Биометрия пока не подключена. Добавьте устройство через Face ID, Touch ID, отпечаток пальца или защитный ключ с PIN.</div>';
        if (supported) {
          html += '<button class="btn" id="btnAddDevice" style="height:48px;border:none;border-radius:16px;background:var(--hero-grad);color:#fff;font-size:14px;font-weight:800;box-shadow:var(--fab-shadow)">Добавить устройство</button>';
        } else {
          html += '<div class="help" style="padding:12px 14px;border-radius:14px;background:var(--surface-alt);border:1px solid var(--border)">Это устройство не поддерживает биометрическую аутентификацию.</div>';
        }
        html += '</div>';
        container.innerHTML = html;
      } else {
        var html = '<table class="tbl" style="width:100%;margin-bottom:12px">';
        html += '<thead><tr><th>Устройство</th><th>Создано</th><th>Последний вход</th><th></th></tr></thead>';
        html += '<tbody>';
        creds.forEach(function(c) {
          var created = c.created_at ? ((window.AsgardUI && AsgardUI.formatDate) ? AsgardUI.formatDate(c.created_at) : new Date(c.created_at).toLocaleDateString('ru-RU')) : '—';
          var lastUsed = c.last_used_at ? ((window.AsgardUI && AsgardUI.formatDate) ? AsgardUI.formatDate(c.last_used_at) : new Date(c.last_used_at).toLocaleDateString('ru-RU')) : '—';
          html += '<tr>';          html += '<td><input class="inp" value="' + (c.device_name || '').replace(/"/g, '&quot;') + '" data-rename-id="' + c.id + '" style="max-width:200px"/></td>';

          html += '<td>' + created + '</td>';
          html += '<td>' + lastUsed + '</td>';
          html += '<td><button class="btn ghost" data-delete-id="' + c.id + '" style="color:var(--red,#ef4444);padding:4px 8px;font-size:12px">Удалить</button></td>';
          html += '</tr>';
        });
        html += '</tbody></table>';
        html += '<div style="font-size:12px;color:var(--text-sec);margin-top:-2px;margin-bottom:12px">Если устройство потеряно, удалите его из списка.</div>';

        if (supported) {
          html += '<button class="btn ghost" id="btnAddDevice" style="height:46px;border-radius:14px">+ Добавить устройство</button>';
        }

        container.innerHTML = html;
      }

      var addBtn = document.getElementById('btnAddDevice');
      if (addBtn) {
        addBtn.addEventListener('click', async function() {
          try {
            var result = await registerBiometric();
            if (result.verified) {
              toastMessage('Face ID готов для этого устройства', 'success');
              loadDevices();
            }
          } catch (e) {
            if (e.message === 'cancelled') return;
            toastMessage(normalizeErrorMessage(e), 'danger');
          }
        });
      }

      container.querySelectorAll('[data-delete-id]').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var ok = window.M && M.Confirm ? await M.Confirm({ title: 'Удалить устройство?', message: 'Face ID на этом устройстве больше не сможет входить без пароля.', okText: 'Удалить', cancelText: 'Отмена', danger: true }) : confirm('Удалить устройство?');
          if (!ok) return;
          var id = btn.dataset.deleteId;
          try {
            await fetch('/api/webauthn/credentials/' + id, {
              method: 'DELETE',
              headers: { 'Authorization': 'Bearer ' + auth.token }
            });
            toastMessage('Устройство удалено', 'success');
            loadDevices();
          } catch (e) {
            toastMessage(normalizeErrorMessage(e), 'danger');
          }
        });
      });

      container.querySelectorAll('[data-rename-id]').forEach(function(inp) {
        inp.addEventListener('blur', async function() {
          var newName = inp.value.trim();
          if (!newName) return;
          try {
            await fetch('/api/webauthn/credentials/' + inp.dataset.renameId, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + auth.token
              },
              body: JSON.stringify({ device_name: newName })
            });
          } catch (e) { /* silent */ }
        });
      });

    } catch (e) {
      container.innerHTML = '<div class="help" style="padding:12px 14px;border-radius:14px;background:var(--surface-alt);border:1px solid var(--border);color:var(--red)">Ошибка загрузки: ' + (e.message || 'неизвестная ошибка') + '</div>';
    }
  }

  return {
    isSupported: isSupported,
    getBiometricLabel: getBiometricLabel,
    getLastUsername: getLastUsername,
    saveLastUsername: saveLastUsername,
    registerBiometric: registerBiometric,
    loginWithBiometric: loginWithBiometric,
    hasCredentialsForUser: hasCredentialsForUser,
    showRegistrationPrompt: showRegistrationPrompt,
    renderLoginButton: renderLoginButton,
    renderDevicesSection: renderDevicesSection,
    loadDevices: loadDevices
  };
})();
