/**
 * AcademyBanners.jsx — баннеры полевого PWA (Фаза 3, дизайн-система).
 *
 * 1. UpdateChangelogModal — «что нового»; используется как анонс редизайна
 *    и появления светлой темы (с кнопкой мгновенного переключения).
 * 2. PwaInstallBanner — установка на домашний экран.
 * 3. PushPermissionBanner — разрешение на уведомления.
 *
 * Всё на токенах (--acc/--value/--ok/--bg-*): работает и в тёмной, и в светлой.
 * Никаких литеральных цветов и fixed-оверлеев мимо BottomSheet.
 */
import { useState, useEffect } from 'react';
import { Sparkles, Smartphone, Bell, Sun, Moon, Palette } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useThemeStore } from '@/stores/themeStore';
import { BottomSheet, KeyButton, IconTile, Banner } from '@/components/field/ui';

/* ── Анонс редизайна (одноразовый) ───────────────────────────────────────── */
const REDESIGN_KEY = 'field_redesign_2026_seen';

export function RedesignAnnouncement({ force = false, onClose: onCloseProp }) {
  const [visible, setVisible] = useState(false);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const isLight = theme === 'light';

  useEffect(() => {
    if (force) { setVisible(true); return; }
    try { if (localStorage.getItem(REDESIGN_KEY) === '1') return; } catch { /* private mode */ }
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, [force]);

  function close() {
    try { localStorage.setItem(REDESIGN_KEY, '1'); } catch { /* ignore */ }
    setVisible(false);
    onCloseProp?.();
  }

  return (
    <BottomSheet open={visible} onClose={close} title="Асгард обновился">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Логотип ASGARD CRM менять нельзя — официальный файл */}
          <img
            src={import.meta.env.BASE_URL + 'asgard-logo.png'}
            alt="ASGARD CRM"
            draggable={false}
            style={{ width: 54, height: 'auto', userSelect: 'none', flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 850, color: 'var(--text-primary)' }}>
              Новое оформление
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              Стекло, объём, аккуратные акценты — и привычное расположение кнопок.
              Всё, что знали, осталось на месте.
            </p>
          </div>
        </div>

        <Banner
          tone="value"
          icon={Sparkles}
          title="Появилась светлая тема"
          text="Для работы на солнце. Тёмная и светлая переключаются в один тап."
        />

        <KeyButton
          tone={isLight ? 'neutral' : 'accent'}
          block
          icon={isLight ? Moon : Sun}
          onClick={() => toggleTheme()}
        >
          {isLight ? 'Включить тёмную тему' : 'Включить светлую тему'}
        </KeyButton>

        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 11,
            padding: '12px 14px', borderRadius: 'var(--r-card)',
            background: 'var(--bg-surface-alt)',
          }}
        >
          <IconTile icon={Palette} size={38} tone="neutral" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 750, color: 'var(--text-primary)' }}>
              Где переключить тему
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
              Профиль → Тема · и кнопка солнца в шапке главного экрана
            </p>
          </div>
        </div>

        <KeyButton tone="ghost" block onClick={close}>Понятно</KeyButton>
      </div>
    </BottomSheet>
  );
}

/* ── Update Changelog (с бэкенда) ────────────────────────────────────────── */
export function UpdateChangelogModal() {
  const [updates, setUpdates] = useState([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('field_token');
    if (!token) return;
    // Анонс редизайна показываем один раз и не смешиваем с серверным чеинжлогом.
    try { if (localStorage.getItem(REDESIGN_KEY) !== '1') return; } catch { /* ignore */ }
    fieldApi.get('/academy/updates').then((data) => {
      if (data.has_updates && data.updates?.length > 0) {
        setUpdates(data.updates);
        setVisible(true);
      }
    }).catch(() => {});
  }, []);

  async function handleDismiss() {
    if (!updates.length) return;
    const latest = updates[updates.length - 1];
    try { await fieldApi.post('/academy/updates/seen', { version: latest.version }); } catch { /* ignore */ }
    setVisible(false);
  }

  const allChanges = updates.flatMap((u) => u.changes || []);
  const title = updates.length === 1 ? updates[0].title : `${updates.length} обновления`;

  return (
    <BottomSheet open={visible && updates.length > 0} onClose={handleDismiss} title={title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 8 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-tertiary)' }}>Что нового в Асгарде</p>
        {allChanges.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <IconTile icon={Sparkles} size={36} tone="value" />
            <span style={{ flex: 1, fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)' }}>
              {c.text}
            </span>
          </div>
        ))}
        <KeyButton block onClick={handleDismiss}>Отлично, понял</KeyButton>
      </div>
    </BottomSheet>
  );
}

/* ── PWA Install Banner ──────────────────────────────────────────────────── */
export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const isInstalled = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    if (isInstalled) return undefined;

    const dismissed = localStorage.getItem('pwa_install_dismissed');
    if (dismissed && Date.now() - parseInt(dismissed, 10) < 7 * 24 * 3600 * 1000) return undefined;

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setTimeout(() => setVisible(true), 30000);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setVisible(false);
    setDeferredPrompt(null);
  }

  function handleDismiss() {
    localStorage.setItem('pwa_install_dismissed', String(Date.now()));
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div style={{ position: 'fixed', left: 16, right: 16, bottom: 84, zIndex: 1000 }}>
      <Banner
        tone="value"
        icon={Smartphone}
        title="Установи на экран"
        text="Быстрый доступ без браузера"
        action="Установить"
        onAction={handleInstall}
        onDismiss={handleDismiss}
      />
    </div>
  );
}

/* ── Push Permission Banner ──────────────────────────────────────────────── */
export function PushPermissionBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!('Notification' in window)) return undefined;
    if (Notification.permission !== 'default') return undefined;
    const dismissed = localStorage.getItem('push_permission_dismissed');
    if (dismissed && Date.now() - parseInt(dismissed, 10) < 7 * 24 * 3600 * 1000) return undefined;
    const timer = setTimeout(() => setVisible(true), 15000);
    return () => clearTimeout(timer);
  }, []);

  async function handleEnable() {
    const permission = await Notification.requestPermission();
    setVisible(false);
    if (permission === 'granted') localStorage.removeItem('push_permission_dismissed');
  }

  function handleDismiss() {
    localStorage.setItem('push_permission_dismissed', String(Date.now()));
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div style={{ position: 'fixed', left: 16, right: 16, bottom: 144, zIndex: 999 }}>
      <Banner
        tone="accent"
        icon={Bell}
        title="Включи уведомления"
        text="Не пропусти новую Руну недели"
        action="Включить"
        onAction={handleEnable}
        onDismiss={handleDismiss}
      />
    </div>
  );
}
