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

    const dismissed = parseInt(localStorage.getItem('asgard_push_dismissed') || '0', 10);
    if (dismissed >= 3) return;

    setTimeout(function() {
      if (isSubscribed()) return;

      if (window.M && M.BottomSheet) {
        const promptId = 'push-prompt-' + Math.random().toString(36).slice(2, 8);
        const content = document.createElement('div');
        const hint = /iPhone|iPad/.test(navigator.userAgent)
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

        const sheet = M.BottomSheet({ title: 'Уведомления', content: content });
        const yesBtn = content.querySelector('#' + promptId + '-yes');
        const noBtn = content.querySelector('#' + promptId + '-no');

        yesBtn.addEventListener('click', async function() {
          yesBtn.disabled = true;
          yesBtn.textContent = 'Подключаем...';
          const result = await subscribe();
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
          const c = parseInt(localStorage.getItem('asgard_push_dismissed') || '0', 10);
          localStorage.setItem('asgard_push_dismissed', String(c + 1));
          sheet.close();
        });
        return;
      }

      if (!window.AsgardUI || !AsgardUI.toast) return;
      AsgardUI.toast('Уведомления', 'Включите push-уведомления в настройках браузера', 'ok');
    }, 5000);
  }

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
