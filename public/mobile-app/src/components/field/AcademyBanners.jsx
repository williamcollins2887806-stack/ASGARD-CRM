/**
 * AcademyBanners.jsx — Баннеры для Field PWA
 * 1. PWA install prompt (Add to Home Screen)
 * 2. Push notification permission
 * 3. App update changelog modal
 */
import { useState, useEffect } from 'react';
import { fieldApi } from '@/api/fieldClient';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  rune: '#7b61ff', green: '#22c55e', text: '#e8e8f0', muted: '#6b7280',
};

// ── Update Changelog Modal ────────────────────────────────────────────────

export function UpdateChangelogModal() {
  const [updates, setUpdates] = useState([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('field_token');
    if (!token) return;

    fieldApi.get('/academy/updates').then(data => {
      if (data.has_updates && data.updates?.length > 0) {
        setUpdates(data.updates);
        setVisible(true);
      }
    }).catch(() => {});
  }, []);

  async function handleDismiss() {
    if (!updates.length) return;
    const latest = updates[updates.length - 1];
    try {
      await fieldApi.post('/academy/updates/seen', { version: latest.version });
    } catch {}
    setVisible(false);
  }

  if (!visible || !updates.length) return null;

  const allChanges = updates.flatMap(u => u.changes || []);
  const title = updates.length === 1 ? updates[0].title : `${updates.length} обновления`;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      padding: '0 0 env(safe-area-inset-bottom)',
    }}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: C.card,
        borderRadius: '20px 20px 0 0',
        padding: '24px 20px 32px',
        border: `1px solid ${C.rune}33`,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>⚡</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: C.text, marginBottom: 4 }}>
            {title}
          </div>
          <div style={{ fontSize: 13, color: C.muted }}>Что нового в Асгарде</div>
        </div>

        <div style={{ marginBottom: 20 }}>
          {allChanges.map((change, i) => (
            <div key={i} style={{
              display: 'flex', gap: 12, alignItems: 'flex-start',
              padding: '10px 0', borderBottom: i < allChanges.length - 1 ? '1px solid #ffffff08' : 'none',
            }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>{change.icon}</span>
              <span style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>{change.text}</span>
            </div>
          ))}
        </div>

        <button
          onClick={handleDismiss}
          style={{
            width: '100%', padding: '14px 0',
            background: `linear-gradient(90deg, ${C.rune}, #9b59b6)`,
            border: 'none', borderRadius: 12, color: '#fff',
            fontSize: 15, fontWeight: 800, cursor: 'pointer',
          }}
        >
          Отлично, понял!
        </button>
      </div>
    </div>
  );
}

// ── PWA Install Banner ────────────────────────────────────────────────────

export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Check if already installed
    const isInstalled = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    if (isInstalled) return;

    // Check dismiss cooldown (7 days)
    const dismissed = localStorage.getItem('pwa_install_dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 3600 * 1000) return;

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Show after 30 seconds
      setTimeout(() => setVisible(true), 30000);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setVisible(false);
    }
    setDeferredPrompt(null);
  }

  function handleDismiss() {
    localStorage.setItem('pwa_install_dismissed', String(Date.now()));
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 80, left: 16, right: 16, zIndex: 1000,
      background: `linear-gradient(135deg, #1a0d2e, ${C.card})`,
      border: `1px solid ${C.gold}44`,
      borderRadius: 16, padding: 16,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      display: 'flex', gap: 14, alignItems: 'center',
    }}>
      <div style={{ fontSize: 40, flexShrink: 0 }}>📱</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 2 }}>
          Установи на экран
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>
          Быстрый доступ без браузера
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button onClick={handleInstall} style={{
          padding: '6px 12px', background: C.gold,
          border: 'none', borderRadius: 8, color: '#000',
          fontSize: 12, fontWeight: 700, cursor: 'pointer',
        }}>
          Установить
        </button>
        <button onClick={handleDismiss} style={{
          padding: '4px 12px', background: 'transparent',
          border: 'none', color: C.muted,
          fontSize: 11, cursor: 'pointer',
        }}>
          Не сейчас
        </button>
      </div>
    </div>
  );
}

// ── Push Permission Banner ────────────────────────────────────────────────

export function PushPermissionBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return;

    // Show after 15 seconds
    const dismissed = localStorage.getItem('push_permission_dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 3600 * 1000) return;

    const timer = setTimeout(() => setVisible(true), 15000);
    return () => clearTimeout(timer);
  }, []);

  async function handleEnable() {
    const permission = await Notification.requestPermission();
    setVisible(false);
    if (permission === 'granted') {
      localStorage.removeItem('push_permission_dismissed');
    }
  }

  function handleDismiss() {
    localStorage.setItem('push_permission_dismissed', String(Date.now()));
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 140, left: 16, right: 16, zIndex: 999,
      background: `linear-gradient(135deg, #0d1a2e, ${C.card})`,
      border: `1px solid #3b82f644`,
      borderRadius: 16, padding: 16,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      display: 'flex', gap: 14, alignItems: 'center',
    }}>
      <div style={{ fontSize: 36, flexShrink: 0 }}>🔔</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 2 }}>
          Включи уведомления
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>
          Не пропусти новую Руну недели
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button onClick={handleEnable} style={{
          padding: '6px 12px', background: '#3b82f6',
          border: 'none', borderRadius: 8, color: '#fff',
          fontSize: 12, fontWeight: 700, cursor: 'pointer',
        }}>
          Включить
        </button>
        <button onClick={handleDismiss} style={{
          padding: '4px 12px', background: 'transparent',
          border: 'none', color: C.muted,
          fontSize: 11, cursor: 'pointer',
        }}>
          Позже
        </button>
      </div>
    </div>
  );
}
