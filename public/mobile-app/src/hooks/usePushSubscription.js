/**
 * usePushSubscription — управление Web Push подпиской для рабочих (field)
 * Использует field_token, эндпоинт /api/field/push/*
 * iOS 16.4+: работает только когда PWA добавлена на экран «Домой»
 */
import { useState, useEffect, useCallback } from 'react';

const FIELD_TOKEN_KEY = 'field_token';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function getFieldToken() {
  return localStorage.getItem(FIELD_TOKEN_KEY);
}

async function fieldFetch(path, options = {}) {
  const token = await getFieldToken();
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
}

export function usePushSubscription() {
  const [permission, setPermission] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [supported, setSupported] = useState(false);

  const isIOSPWA = typeof window !== 'undefined' &&
    (window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches) &&
    /iPhone|iPad|iPod/.test(navigator.userAgent);

  useEffect(() => {
    const ok =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setSupported(ok);
    if (!ok) return;

    setPermission(Notification.permission);

    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setSubscribed(!!sub);
      });
    }).catch(() => {});
  }, []);

  const subscribe = useCallback(async () => {
    if (!supported) return { ok: false, reason: 'not_supported' };
    setLoading(true);
    try {
      // 1. Get VAPID key
      const vapidRes = await fetch('/api/push/vapid-key');
      const { publicKey } = await vapidRes.json();
      if (!publicKey) throw new Error('No VAPID key');

      // 2. Request permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return { ok: false, reason: 'denied' };

      // 3. Subscribe
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // 4. Save on server (field endpoint)
      const token = await getFieldToken();
      const res = await fieldFetch('/api/field/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: {
            p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))),
            auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')))),
          },
          device_info: {
            platform: navigator.platform,
            userAgent: navigator.userAgent.slice(0, 120),
            isIOS: isIOSPWA,
          },
        }),
      });
      if (!res.ok) throw new Error('Server rejected subscription');

      setSubscribed(true);
      return { ok: true };
    } catch (e) {
      console.error('[push] subscribe error:', e);
      return { ok: false, reason: e.message };
    } finally {
      setLoading(false);
    }
  }, [supported, isIOSPWA]);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fieldFetch('/api/field/push/unsubscribe', {
          method: 'POST',
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (e) {
      console.error('[push] unsubscribe error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  return { supported, permission, subscribed, loading, isIOSPWA, subscribe, unsubscribe };
}
