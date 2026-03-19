import { useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { useHaptic } from '@/hooks/useHaptic';
import { PageShell } from '@/components/layout/PageShell';
import {
  Bell, Sun, Moon, Smartphone, Trash2, Info,
} from 'lucide-react';

export default function Settings() {
  const user = useAuthStore((s) => s.user);
  const { theme, toggleTheme } = useThemeStore();
  const haptic = useHaptic();
  const [pushEnabled, setPushEnabled] = useState(Notification?.permission === 'granted');
  const [cacheSize, setCacheSize] = useState(null);

  const togglePush = async () => {
    haptic.light();
    if (!pushEnabled && 'Notification' in window) {
      const perm = await Notification.requestPermission();
      setPushEnabled(perm === 'granted');
    } else {
      setPushEnabled(!pushEnabled);
    }
  };

  const checkCache = async () => {
    haptic.light();
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      const mb = ((est.usage || 0) / 1048576).toFixed(1);
      setCacheSize(`${mb} МБ`);
    }
  };

  const clearCache = async () => {
    haptic.medium();
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
    localStorage.removeItem('asgard_mobile_state');
    setCacheSize('0 МБ');
  };

  return (
    <PageShell title="Настройки">
      {/* Notifications */}
      <SectionLabel>Уведомления</SectionLabel>
      <div
        className="rounded-2xl overflow-hidden mb-4 bg-surface"
        style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}
      >
        <ToggleRow
          icon={Bell}
          label="Push-уведомления"
          active={pushEnabled}
          onToggle={togglePush}
        />
      </div>

      {/* Appearance */}
      <SectionLabel>Внешний вид</SectionLabel>
      <div
        className="rounded-2xl overflow-hidden mb-4 bg-surface"
        style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 50ms both' }}
      >
        <ToggleRow
          icon={theme === 'dark' ? Sun : Moon}
          iconColor={theme === 'dark' ? '#FFCC00' : 'var(--blue)'}
          label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          active={theme === 'dark'}
          onToggle={() => { haptic.medium(); toggleTheme(); }}
        />
      </div>

      {/* System */}
      <SectionLabel>Система</SectionLabel>
      <div
        className="rounded-2xl overflow-hidden mb-4 bg-surface"
        style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 100ms both' }}
      >
        <InfoRow icon={Info} label="Версия" value="ASGARD Mobile v2.0.0" />
        <InfoRow icon={Smartphone} label="Сервер" value={window.location.hostname} />
        <button
          onClick={checkCache}
          className="w-full flex items-center gap-3.5 px-4 py-3.5 spring-tap"
          style={{ borderBottom: '0.5px solid var(--border-norse)' }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'color-mix(in srgb, var(--text-secondary) 10%, transparent)' }}
          >
            <Info size={18} className="c-secondary" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-[11px] c-tertiary">Размер кэша</p>
            <p className="text-[14px] c-primary">{cacheSize || 'Нажмите для проверки'}</p>
          </div>
        </button>
        <button
          onClick={clearCache}
          className="w-full flex items-center gap-3.5 px-4 py-3.5 spring-tap"
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(255, 69, 58, 0.1)' }}
          >
            <Trash2 size={18} className="c-red" />
          </div>
          <span className="flex-1 text-left text-[15px] font-medium c-red">
            Очистить кэш
          </span>
        </button>
      </div>
    </PageShell>
  );
}

function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider px-1 pb-1.5 pt-0.5 c-tertiary">
      {children}
    </p>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div
      className="flex items-center gap-3.5 px-4 py-3.5"
      style={{ borderBottom: '0.5px solid var(--border-norse)' }}
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: 'color-mix(in srgb, var(--text-secondary) 10%, transparent)' }}
      >
        <Icon size={18} className="c-secondary" />
      </div>
      <div className="flex-1">
        <p className="text-[11px] c-tertiary">{label}</p>
        <p className="text-[14px] c-primary">{value}</p>
      </div>
    </div>
  );
}

function ToggleRow({ icon: Icon, iconColor, label, active, onToggle }) {
  return (
    <button onClick={onToggle} className="w-full flex items-center gap-3.5 px-4 py-3.5 spring-tap">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: 'color-mix(in srgb, var(--text-secondary) 10%, transparent)' }}
      >
        <Icon size={18} style={{ color: iconColor || 'var(--text-secondary)' }} />
      </div>
      <span className="flex-1 text-left text-[15px] font-medium c-primary">
        {label}
      </span>
      <div
        className="w-[42px] h-[26px] rounded-full relative shrink-0"
        style={{ background: active ? 'var(--gold)' : 'var(--bg-elevated)', transition: 'background 250ms ease' }}
      >
        <div
          className="absolute top-[3px] w-5 h-5 rounded-full bg-white"
          style={{ left: active ? 19 : 3, transition: 'left 250ms var(--ease-spring)', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
        />
      </div>
    </button>
  );
}
