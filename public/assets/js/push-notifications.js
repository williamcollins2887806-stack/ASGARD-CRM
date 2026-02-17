/**
 * ASGARD CRM - Push Notifications Client Module
 * Handles subscription, badge, and notification preferences
 */
window.AsgardPush = (function() {
  const STORAGE_KEY = 'asgard_push_subscribed';
  const PREFS_KEY = 'asgard_push_prefs';

  // ── Check Support ──
  function isSupported() {
    return 'serviceWorker' in navigator &&
           'PushManager' in window &&
           'Notification' in window;
  }

  function getPermissionState() {
    if (!isSupported()) return 'unsupported';
    return Notification.permission; // 'default', 'granted', 'denied'
  }

  function isSubscribed() {
    return localStorage.getItem(STORAGE_KEY) === '1';
  }

  // ── Get VAPID Key from server ──
  async function getVapidKey() {
    try {
      const resp = await fetch('/api/push/vapid-key');
      const data = await resp.json();
      return data.publicKey;
    } catch (e) {
      console.error('[Push] Failed to get VAPID key:', e);
      return null;
    }
  }

  // ── Convert VAPID key to Uint8Array ──
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  // ── Subscribe to push ──
  async function subscribe() {
    if (!isSupported()) return { success: false, reason: 'unsupported' };

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { success: false, reason: 'denied' };
    }

    try {
      const vapidKey = await getVapidKey();
      if (!vapidKey) return { success: false, reason: 'no_vapid_key' };

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      });

      const sub = subscription.toJSON();

      // Send to server
      const auth = window.AsgardAuth ? AsgardAuth.getAuth() : null;
      if (!auth) return { success: false, reason: 'not_authenticated' };

      const resp = await fetch('/api/push/subscribe', {
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
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();

        // Notify server
        const auth = window.AsgardAuth ? AsgardAuth.getAuth() : null;
        if (auth) {
          await fetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + auth.token
            },
            body: JSON.stringify({ endpoint })
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
    const ua = navigator.userAgent;
    if (/iPhone|iPad/.test(ua)) return 'iOS ' + ((/OS (\d+)/.exec(ua)) || ['',''])[1];
    if (/Android/.test(ua)) return 'Android';
    if (/Mac/.test(ua)) return 'macOS';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Unknown';
  }

  // ── Badge (App Icon Counter) ──
  async function updateBadge() {
    if (!('setAppBadge' in navigator)) return;

    try {
      const auth = window.AsgardAuth ? AsgardAuth.getAuth() : null;
      if (!auth) return;

      const resp = await fetch('/api/notifications?is_read=false&limit=1', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      if (!resp.ok) return;

      const data = await resp.json();
      const count = data.unread_count || 0;

      if (count > 0) {
        navigator.setAppBadge(count);
      } else {
        navigator.clearAppBadge();
      }
    } catch (e) {
      // Silently fail — badge is not critical
    }
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

  // Default: all types enabled
  function isTypeEnabled(type) {
    const prefs = getPrefs();
    if (prefs[type] === false) return false;
    return true; // enabled by default
  }

  function setTypeEnabled(type, enabled) {
    const prefs = getPrefs();
    prefs[type] = !!enabled;
    savePrefs(prefs);
  }

  // ── Show enable prompt (non-intrusive) ──
  function showEnablePrompt() {
    if (!isSupported()) return;
    if (isSubscribed()) return;
    if (Notification.permission === 'denied') return;

    // Check if user dismissed before
    const dismissed = parseInt(localStorage.getItem('asgard_push_dismissed') || '0', 10);
    if (dismissed >= 3) return; // Stop asking after 3 dismissals

    setTimeout(function() {
      if (!window.AsgardUI || !AsgardUI.toast) return;

      const toastEl = document.createElement('div');
      toastEl.className = 'push-enable-prompt';
      toastEl.innerHTML = '<div style="display:flex;align-items:center;gap:12px;padding:14px 18px;background:var(--bg-elevated,#1e293b);border:1px solid var(--gold,#D4AF37);border-radius:10px;font-size:13px;color:var(--text-primary,#e5e7eb);box-shadow:0 4px 20px rgba(0,0,0,.3);position:fixed;bottom:80px;right:20px;z-index:9999;max-width:360px">'
        + '<span>🔔 Хотите получать уведомления о задачах и обновлениях?</span>'
        + '<button id="pushEnableYes" style="background:var(--gold,#D4AF37);color:#0d1428;border:none;padding:6px 14px;border-radius:6px;font-weight:700;cursor:pointer;white-space:nowrap;font-size:12px">Включить</button>'
        + '<button id="pushEnableNo" style="background:transparent;color:var(--text-muted,#9ca3af);border:none;cursor:pointer;font-size:16px;padding:4px">✕</button>'
        + '</div>';
      document.body.appendChild(toastEl);

      document.getElementById('pushEnableYes').addEventListener('click', async function() {
        toastEl.remove();
        var result = await subscribe();
        if (result.success) {
          AsgardUI.toast('Уведомления', 'Push-уведомления включены!', 'ok');
        } else if (result.reason === 'denied') {
          AsgardUI.toast('Уведомления', 'Разрешение отклонено браузером', 'err');
        }
      });

      document.getElementById('pushEnableNo').addEventListener('click', function() {
        toastEl.remove();
        var c = parseInt(localStorage.getItem('asgard_push_dismissed') || '0', 10);
        localStorage.setItem('asgard_push_dismissed', String(c + 1));
      });

      // Auto-dismiss after 15 seconds
      setTimeout(function() { if (toastEl.parentNode) toastEl.remove(); }, 15000);
    }, 5000); // Show after 5 seconds of page load
  }

  // ── Init: call after successful login ──
  function init() {
    if (!isSupported()) return;

    // Update badge on load
    updateBadge();

    // If already subscribed, nothing to do
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
      { key: 'chat_message', label: 'Сообщения в чате' }
    ];

    var html = '<div class="card" style="margin-top:14px">';
    html += '<h3>🔔 Push-уведомления</h3>';

    if (!supported) {
      html += '<div class="help">Ваш браузер не поддерживает push-уведомления.</div>';
    } else if (permission === 'denied') {
      html += '<div class="help" style="color:var(--red,#ef4444)">Push-уведомления заблокированы в настройках браузера. Разрешите их в настройках сайта.</div>';
    } else {
      html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">';
      html += '<span>Статус: ' + (subscribed ? '<b style="color:#22c55e">Включены</b>' : '<b style="color:#9ca3af">Выключены</b>') + '</span>';
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
          location.hash = location.hash; // Re-render
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
    init: init,
    showEnablePrompt: showEnablePrompt,
    renderSettingsSection: renderSettingsSection,
    bindSettingsEvents: bindSettingsEvents,
    isTypeEnabled: isTypeEnabled,
    setTypeEnabled: setTypeEnabled
  };
})();
