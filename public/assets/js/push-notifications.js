/**
 * ASGARD CRM - Push Notifications Client Module
 * Handles subscription, badge, notification preferences, install prompt
 * Session 15: Badge polling, notification click handler, install prompt
 */
window.AsgardPush = (function() {
  var STORAGE_KEY = 'asgard_push_subscribed';
  var PREFS_KEY = 'asgard_push_prefs';
  var _badgeInterval = null;
  var _deferredInstallPrompt = null;

  // ── Check Support ──
  function isSupported() {
    return 'serviceWorker' in navigator &&
           'PushManager' in window &&
           'Notification' in window;
  }

  function getPermissionState() {
    if (!isSupported()) return 'unsupported';
    return Notification.permission;
  }

  function isSubscribed() {
    return localStorage.getItem(STORAGE_KEY) === '1';
  }

  // ── Get VAPID Key from server ──
  async function getVapidKey() {
    try {
      var resp = await fetch('/api/push/vapid-key');
      var data = await resp.json();
      return data.publicKey;
    } catch (e) {
      console.error('[Push] Failed to get VAPID key:', e);
      return null;
    }
  }

  // ── Convert VAPID key to Uint8Array ──
  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  // ── Subscribe to push ──
  async function subscribe() {
    if (!isSupported()) return { success: false, reason: 'unsupported' };

    var permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { success: false, reason: 'denied' };
    }

    try {
      var vapidKey = await getVapidKey();
      if (!vapidKey) return { success: false, reason: 'no_vapid_key' };

      var reg = await navigator.serviceWorker.ready;
      var subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      });

      var sub = subscription.toJSON();
      var auth = window.AsgardAuth ? AsgardAuth.getAuth() : null;
      if (!auth) return { success: false, reason: 'not_authenticated' };

      var resp = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + auth.token
        },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: sub.keys,
          device_info: getDeviceInfo()
        })
      });

      if (resp.ok) {
        localStorage.setItem(STORAGE_KEY, '1');
        return { success: true };
      }

      return { success: false, reason: 'server_error' };
    } catch (e) {
      console.error('[Push] Subscribe error:', e);
      return { success: false, reason: e.message };
    }
  }

  // ── Unsubscribe ──
  async function unsubscribe() {
    try {
      var reg = await navigator.serviceWorker.ready;
      var subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        var endpoint = subscription.endpoint;
        await subscription.unsubscribe();

        var auth = window.AsgardAuth ? AsgardAuth.getAuth() : null;
        if (auth) {
          await fetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + auth.token
            },
            body: JSON.stringify({ endpoint: endpoint })
          });
        }
      }

      localStorage.removeItem(STORAGE_KEY);
      return { success: true };
    } catch (e) {
      console.error('[Push] Unsubscribe error:', e);
      return { success: false, reason: e.message };
    }
  }

  // ── Device Info ──
  function getDeviceInfo() {
    var ua = navigator.userAgent;
    if (/iPhone|iPad/.test(ua)) return 'iOS ' + ((/OS (\d+)/.exec(ua)) || ['',''])[1];
    if (/Android/.test(ua)) return 'Android';
    if (/Mac/.test(ua)) return 'macOS';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Unknown';
  }

  // ═══════════════════════════════════════════════════════════════
  // BADGE — composite count (notifications + approvals + chats)
  // ═══════════════════════════════════════════════════════════════
  async function updateBadge() {
    if (!('setAppBadge' in navigator)) return;

    try {
      var auth = window.AsgardAuth ? AsgardAuth.getAuth() : null;
      if (!auth) return;

      var resp = await fetch('/api/push/badge-count', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      if (!resp.ok) return;

      var data = await resp.json();
      var count = data.count || 0;

      if (count > 0) {
        navigator.setAppBadge(count);
      } else {
        navigator.clearAppBadge();
      }
    } catch (e) {
      // Silently fail — badge is not critical
    }
  }

  function startBadgePolling() {
    if (_badgeInterval) return;
    updateBadge();
    _badgeInterval = setInterval(updateBadge, 60000); // каждые 60 секунд
  }

  function stopBadgePolling() {
    if (_badgeInterval) {
      clearInterval(_badgeInterval);
      _badgeInterval = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // NOTIFICATION CLICK handler — from Service Worker message
  // ═══════════════════════════════════════════════════════════════
  function initNotificationClickHandler() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('message', function(event) {
      var msg = event.data;
      if (!msg) return;

      // Push action click (Variant B: app handles the action)
      if (msg.type === 'NOTIFICATION_CLICK') {
        var url = msg.url || '';
        // Check if URL has action params
        var qIndex = url.indexOf('?');
        if (qIndex !== -1) {
          var search = url.substring(qIndex + 1);
          var params = new URLSearchParams(search);
          var action = params.get('action');
          var entityType = params.get('type');
          var entityId = params.get('id');

          if (action && entityType && entityId) {
            // Navigate to approvals page and trigger the action
            var hashPart = url.substring(0, qIndex);
            location.hash = hashPart || '/approvals';
            // Dispatch custom event for approval module to pick up
            setTimeout(function() {
              window.dispatchEvent(new CustomEvent('push-action', {
                detail: { action: action, entityType: entityType, entityId: entityId, actionType: params.get('action_type') }
              }));
            }, 300);
            updateBadge();
            return;
          }
        }
        // Simple navigation
        if (url.startsWith('#')) {
          location.hash = url.substring(1);
        } else if (url.startsWith('/')) {
          location.hash = url;
        } else {
          location.hash = url;
        }
        updateBadge();
        return;
      }

      // Offline action queued
      if (msg.type === 'ACTION_QUEUED') {
        if (window.M && M.Toast) {
          M.Toast({ message: 'Действие будет выполнено при восстановлении связи', type: 'warning', duration: 4000 });
        }
        return;
      }

      // Background Sync completed
      if (msg.type === 'SYNC_COMPLETE') {
        if (window.M && M.Toast) {
          M.Toast({ message: 'Отложенные действия выполнены (' + msg.processed + ')', type: 'success' });
        }
        updateBadge();
        return;
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // INSTALL PROMPT — предложение установить на главный экран
  // ═══════════════════════════════════════════════════════════════
  function initInstallPrompt() {
    // Android/Chrome: intercept beforeinstallprompt
    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      _deferredInstallPrompt = e;
      // Don't show immediately — delay to avoid annoying user on first visit
      var dismissed = parseInt(localStorage.getItem('asgard_install_dismissed') || '0', 10);
      if (dismissed >= 3) return;
      // Show after 30 seconds of usage
      setTimeout(function() {
        if (_deferredInstallPrompt) showInstallBanner();
      }, 30000);
    });

    // iOS: detect if not installed and show manual instruction
    if (isIOS() && !isStandalone()) {
      var dismissed = parseInt(localStorage.getItem('asgard_install_dismissed') || '0', 10);
      if (dismissed >= 3) return;
      setTimeout(function() { showIOSInstallBanner(); }, 30000);
    }
  }

  function isIOS() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  function showInstallBanner() {
    if (!window.M || !M.BottomSheet) {
      // Fallback: no UI library
      return;
    }
    var content = document.createElement('div');
    content.innerHTML = ''
      + '<div style="display:grid;gap:14px">'
      +   '<div style="display:flex;align-items:center;gap:14px;padding:16px;border-radius:16px;background:var(--surface-alt,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.08))">'
      +     '<img src="./assets/img/icon-96.png" width="48" height="48" style="border-radius:12px" alt="ASGARD">'
      +     '<div>'
      +       '<div style="font-size:15px;font-weight:700;color:var(--text,#f0f2f5)">Установить АСГАРД CRM</div>'
      +       '<div style="font-size:12px;color:var(--text-sec,#8b95a8);margin-top:2px">Быстрый доступ с главного экрана</div>'
      +     '</div>'
      +   '</div>'
      +   '<div style="display:grid;gap:10px">'
      +     '<button id="btnInstallYes" type="button" style="height:52px;border:none;border-radius:16px;background:var(--hero-grad,linear-gradient(135deg,#1E4D8C,#C8293B));color:#fff;font-size:15px;font-weight:800;letter-spacing:-0.2px;box-shadow:0 4px 20px rgba(30,77,140,0.35);cursor:pointer">Установить</button>'
      +     '<button id="btnInstallNo" type="button" style="height:48px;border-radius:16px;border:1px solid var(--border,rgba(255,255,255,0.08));background:var(--surface-alt,rgba(255,255,255,0.04));color:var(--text-sec,#8b95a8);font-size:14px;font-weight:700;cursor:pointer">Не сейчас</button>'
      +   '</div>'
      + '</div>';

    var sheet = M.BottomSheet({ title: 'Установка', content: content });

    content.querySelector('#btnInstallYes').addEventListener('click', function() {
      sheet.close();
      if (_deferredInstallPrompt) {
        _deferredInstallPrompt.prompt();
        _deferredInstallPrompt.userChoice.then(function(result) {
          if (result.outcome === 'accepted') {
            if (window.M && M.Toast) M.Toast({ message: 'Приложение установлено!', type: 'success' });
          }
          _deferredInstallPrompt = null;
        });
      }
    });

    content.querySelector('#btnInstallNo').addEventListener('click', function() {
      var c = parseInt(localStorage.getItem('asgard_install_dismissed') || '0', 10);
      localStorage.setItem('asgard_install_dismissed', String(c + 1));
      sheet.close();
    });
  }

  function showIOSInstallBanner() {
    if (!window.M || !M.BottomSheet) return;

    var content = document.createElement('div');
    content.innerHTML = ''
      + '<div style="display:grid;gap:14px">'
      +   '<div style="display:flex;align-items:center;gap:14px;padding:16px;border-radius:16px;background:var(--surface-alt,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.08))">'
      +     '<img src="./assets/img/icon-96.png" width="48" height="48" style="border-radius:12px" alt="ASGARD">'
      +     '<div>'
      +       '<div style="font-size:15px;font-weight:700;color:var(--text,#f0f2f5)">Установить АСГАРД CRM</div>'
      +       '<div style="font-size:12px;color:var(--text-sec,#8b95a8);margin-top:2px">Добавьте на экран «Домой»</div>'
      +     '</div>'
      +   '</div>'
      +   '<div style="padding:16px;border-radius:16px;background:var(--surface-alt,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.08))">'
      +     '<div style="font-size:13px;color:var(--text,#f0f2f5);line-height:1.6">'
      +       '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:20px">1️⃣</span> Нажмите <span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:6px;background:rgba(0,122,255,0.15);font-weight:600;font-size:12px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#007aff" stroke-width="2.5" stroke-linecap="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> Поделиться</span></div>'
      +       '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:20px">2️⃣</span> Выберите «На экран Домой»</div>'
      +     '</div>'
      +   '</div>'
      +   '<div style="text-align:center;padding:8px 0">'
      +     '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="animation:bounce 1.5s ease-in-out infinite"><path d="M12 19V5M5 12l7-7 7 7" stroke="var(--text-sec,#8b95a8)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      +   '</div>'
      +   '<style>@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}</style>'
      +   '<button id="btnIOSClose" type="button" style="height:48px;width:100%;border-radius:16px;border:1px solid var(--border,rgba(255,255,255,0.08));background:var(--surface-alt,rgba(255,255,255,0.04));color:var(--text-sec,#8b95a8);font-size:14px;font-weight:700;cursor:pointer">Понятно</button>'
      + '</div>';

    var sheet = M.BottomSheet({ title: 'Установка на iPhone', content: content });
    content.querySelector('#btnIOSClose').addEventListener('click', function() {
      var c = parseInt(localStorage.getItem('asgard_install_dismissed') || '0', 10);
      localStorage.setItem('asgard_install_dismissed', String(c + 1));
      sheet.close();
    });
  }

  // ── Notification Preferences ──
  function getPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    } catch (e) { return {}; }
  }

  function savePrefs(prefs) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }

  function isTypeEnabled(type) {
    var prefs = getPrefs();
    if (prefs[type] === false) return false;
    return true;
  }

  function setTypeEnabled(type, enabled) {
    var prefs = getPrefs();
    prefs[type] = !!enabled;
    savePrefs(prefs);
  }

  // ── Show enable prompt (non-intrusive) ──
  function showEnablePrompt() {
    if (!isSupported()) return;
    if (isSubscribed()) return;
    if (Notification.permission === 'denied') return;

    var dismissed = parseInt(localStorage.getItem('asgard_push_dismissed') || '0', 10);
    if (dismissed >= 3) return;

    setTimeout(function() {
      if (isSubscribed()) return;

      if (window.M && M.BottomSheet) {
        var promptId = 'push-prompt-' + Math.random().toString(36).slice(2, 8);
        var content = document.createElement('div');
        var hint = /iPhone|iPad/.test(navigator.userAgent)
          ? 'Добавьте CRM на экран Домой и разрешите уведомления в Safari на iPhone.'
          : 'Включите push, чтобы быстро получать важные события CRM.';

        content.innerHTML = ''
          + '<div style="display:grid;gap:14px">'
          +   '<div style="padding:18px;border-radius:18px;background:var(--hero-grad);box-shadow:var(--hero-shadow);color:#fff;overflow:hidden">'
          +     '<div style="font-size:11px;font-weight:600;letter-spacing:1.1px;opacity:.7;text-transform:uppercase;margin-bottom:6px">ASGARD MOBILE</div>'
          +     '<div style="font-size:22px;font-weight:800;line-height:1.1;letter-spacing:-.5px;margin-bottom:8px">Push-уведомления</div>'
          +     '<div style="font-size:13px;line-height:1.45;opacity:.86">' + hint + '</div>'
          +   '</div>'
          +   '<div style="display:grid;gap:10px">'
          +     '<div style="display:flex;gap:10px;align-items:flex-start;padding:14px 16px;border-radius:16px;background:var(--surface-alt);border:1px solid var(--border)"><div style="font-size:18px;line-height:1">🔔</div><div><div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:2px">Задачи, чаты, согласования</div><div style="font-size:12px;line-height:1.45;color:var(--text-sec)">Будьте в курсе важных событий, даже когда CRM закрыта.</div></div></div>'
          +     '<div style="display:flex;gap:10px;align-items:flex-start;padding:14px 16px;border-radius:16px;background:var(--surface-alt);border:1px solid var(--border)"><div style="font-size:18px;line-height:1">⚙️</div><div><div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:2px">Гибкие типы уведомлений</div><div style="font-size:12px;line-height:1.45;color:var(--text-sec)">Нужные push можно настроить прямо в профиле.</div></div></div>'
          +   '</div>'
          +   '<div style="display:grid;gap:10px;padding-top:2px">'
          +     '<button id="' + promptId + '-yes" type="button" style="height:52px;border:none;border-radius:16px;background:var(--hero-grad);color:#fff;font-size:15px;font-weight:800;letter-spacing:-.2px;box-shadow:var(--fab-shadow);cursor:pointer">Включить уведомления</button>'
          +     '<button id="' + promptId + '-no" type="button" style="height:48px;border-radius:16px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text-sec);font-size:14px;font-weight:700;cursor:pointer">Позже</button>'
          +   '</div>'
          + '</div>';

        var sheet = M.BottomSheet({ title: 'Уведомления', content: content });
        var yesBtn = content.querySelector('#' + promptId + '-yes');
        var noBtn = content.querySelector('#' + promptId + '-no');

        yesBtn.addEventListener('click', async function() {
          yesBtn.disabled = true;
          yesBtn.textContent = 'Подключаем...';
          var result = await subscribe();
          sheet.close();
          if (result.success) {
            M.Toast({ message: 'Push-уведомления включены', type: 'success' });
          } else if (result.reason === 'denied') {
            M.Toast({ message: 'Доступ к уведомлениям отклонен', type: 'warning' });
          } else {
            M.Toast({ message: 'Не удалось включить уведомления', type: 'danger' });
          }
        });

        noBtn.addEventListener('click', function() {
          var c = parseInt(localStorage.getItem('asgard_push_dismissed') || '0', 10);
          localStorage.setItem('asgard_push_dismissed', String(c + 1));
          sheet.close();
        });
        return;
      }

      if (!window.AsgardUI || !AsgardUI.toast) return;
      AsgardUI.toast('Уведомления', 'Включите push-уведомления в настройках браузера', 'ok');
    }, 5000);
  }

  // ── Init ──
  function init() {
    if (!isSupported()) return;

    // Badge polling
    startBadgePolling();

    // Notification click handler
    initNotificationClickHandler();

    // Install prompt
    initInstallPrompt();

    // If already subscribed, just run badge
    if (isSubscribed() && Notification.permission === 'granted') return;

    // Show prompt for new users
    showEnablePrompt();
  }

  // ── Notification preferences UI (for settings page) ──
  function renderSettingsSection() {
    var supported = isSupported();
    var subscribed = isSubscribed();
    var permission = getPermissionState();
    var prefs = getPrefs();

    var TYPES = [
      { key: 'task_assigned', label: 'Новая задача' },
      { key: 'status_changed', label: 'Изменение статуса' },
      { key: 'comment', label: 'Новый комментарий' },
      { key: 'deadline', label: 'Приближение дедлайна' },
      { key: 'system', label: 'Системные уведомления' },
      { key: 'chat_message', label: 'Сообщения в чате' },
      { key: 'approval', label: 'Согласования' },
      { key: 'payment', label: 'Оплата' }
    ];

    var html = '<div class="card" style="margin-top:14px">';
    html += '<h3>🔔 Push-уведомления</h3>';

    if (!supported) {
      html += '<div class="help">Ваш браузер не поддерживает push-уведомления.</div>';
    } else if (permission === 'denied') {
      html += '<div class="help" style="color:var(--red,#ef4444)">Push-уведомления заблокированы в настройках браузера. Разрешите их в настройках сайта.</div>';
    } else {
      html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">';
      html += '<span>Статус: ' + (subscribed ? '<b style="color:var(--ok-t)">Включены</b>' : '<b style="color:var(--t3)">Выключены</b>') + '</span>';
      if (subscribed) {
        html += '<button class="btn ghost" id="btnPushOff">Отключить</button>';
      } else {
        html += '<button class="btn" id="btnPushOn">Включить уведомления</button>';
      }
      html += '</div>';

      if (subscribed) {
        html += '<div class="help" style="margin-bottom:10px">Выберите типы уведомлений:</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px">';
        TYPES.forEach(function(t) {
          var checked = prefs[t.key] !== false ? 'checked' : '';
          html += '<label style="display:flex;align-items:center;gap:8px;cursor:pointer">';
          html += '<input type="checkbox" ' + checked + ' data-push-type="' + t.key + '" class="push-type-cb"/>';
          html += '<span>' + t.label + '</span></label>';
        });
        html += '</div>';
      }
    }

    html += '</div>';
    return html;
  }

  function bindSettingsEvents() {
    var btnOn = document.getElementById('btnPushOn');
    if (btnOn) {
      btnOn.addEventListener('click', async function() {
        var result = await subscribe();
        if (result.success) {
          window.AsgardUI && AsgardUI.toast('Push', 'Уведомления включены!', 'ok');
          location.hash = location.hash;
        } else {
          window.AsgardUI && AsgardUI.toast('Push', 'Не удалось: ' + (result.reason || 'ошибка'), 'err');
        }
      });
    }

    var btnOff = document.getElementById('btnPushOff');
    if (btnOff) {
      btnOff.addEventListener('click', async function() {
        await unsubscribe();
        window.AsgardUI && AsgardUI.toast('Push', 'Уведомления отключены', 'ok');
        location.hash = location.hash;
      });
    }

    document.querySelectorAll('.push-type-cb').forEach(function(cb) {
      cb.addEventListener('change', function() {
        setTypeEnabled(cb.dataset.pushType, cb.checked);
      });
    });
  }

  return {
    isSupported: isSupported,
    isSubscribed: isSubscribed,
    getPermissionState: getPermissionState,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    updateBadge: updateBadge,
    startBadgePolling: startBadgePolling,
    stopBadgePolling: stopBadgePolling,
    init: init,
    showEnablePrompt: showEnablePrompt,
    renderSettingsSection: renderSettingsSection,
    bindSettingsEvents: bindSettingsEvents,
    isTypeEnabled: isTypeEnabled,
    setTypeEnabled: setTypeEnabled,
    showInstallBanner: showInstallBanner,
    isStandalone: isStandalone
  };
})();
