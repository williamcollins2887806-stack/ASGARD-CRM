import { useState, useEffect } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { PageShell } from '@/components/layout/PageShell';
import { Activity, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

const TESTS = [
  { id: 'dom', name: 'DOM доступ', test: () => !!document.querySelector('body') },
  { id: 'storage', name: 'localStorage', test: () => { try { localStorage.setItem('__test', '1'); localStorage.removeItem('__test'); return true; } catch { return false; } } },
  { id: 'fetch', name: 'Fetch API', test: () => typeof fetch === 'function' },
  { id: 'sw', name: 'Service Worker', test: () => 'serviceWorker' in navigator },
  { id: 'push', name: 'Push API', test: () => 'PushManager' in window },
  { id: 'notify', name: 'Notifications', test: () => 'Notification' in window },
  { id: 'webauthn', name: 'WebAuthn', test: () => !!window.PublicKeyCredential },
  { id: 'crypto', name: 'Crypto API', test: () => !!window.crypto?.subtle },
  { id: 'sse', name: 'EventSource (SSE)', test: () => typeof EventSource !== 'undefined' },
  { id: 'vibrate', name: 'Vibration API', test: () => 'vibrate' in navigator },
];

export default function Diag() {
  const haptic = useHaptic();
  const [results, setResults] = useState([]);
  const [storageInfo, setStorageInfo] = useState(null);
  const [swInfo, setSwInfo] = useState(null);

  const runTests = () => {
    haptic.light();
    const r = TESTS.map((t) => ({ ...t, passed: t.test() }));
    setResults(r);
  };

  useEffect(() => {
    runTests();
    // Storage estimate
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((est) => setStorageInfo(est)).catch(() => {});
    }
    // SW status
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        setSwInfo(reg ? { active: !!reg.active, scope: reg.scope } : null);
      }).catch(() => {});
    }
  }, []);

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  return (
    <PageShell title="Диагностика" headerRight={<button onClick={runTests} className="btn-icon spring-tap c-blue"><RefreshCw size={20} /></button>}>
      <div className="flex flex-col gap-3 pb-4">
        {/* Summary */}
        <div className="card-hero" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
          <div className="flex items-center gap-3">
            <Activity size={24} className={passed === total ? 'c-green' : 'c-gold'} />
            <div>
              <p className="text-[16px] font-bold c-primary">{passed}/{total} тестов</p>
              <p className="text-[12px] c-tertiary">ASGARD Mobile v2.0.0</p>
            </div>
          </div>
        </div>

        {/* Build info */}
        <div className="card-hero" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 60ms both' }}>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 c-tertiary">Система</p>
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between"><span className="text-[13px] c-secondary">User Agent</span><span className="text-[11px] max-w-[60%] text-right truncate c-tertiary">{navigator.userAgent.slice(0, 50)}...</span></div>
            <div className="flex justify-between"><span className="text-[13px] c-secondary">Язык</span><span className="text-[13px] c-primary">{navigator.language}</span></div>
            <div className="flex justify-between"><span className="text-[13px] c-secondary">Online</span><span className={`text-[13px] ${navigator.onLine ? 'c-green' : 'c-red'}`}>{navigator.onLine ? 'Да' : 'Нет'}</span></div>
            {swInfo && <div className="flex justify-between"><span className="text-[13px] c-secondary">Service Worker</span><span className={`text-[13px] ${swInfo.active ? 'c-green' : 'c-gold'}`}>{swInfo.active ? 'Активен' : 'Неактивен'}</span></div>}
          </div>
        </div>

        {/* Storage */}
        {storageInfo && (
          <div className="card-hero" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 120ms both' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 c-tertiary">Хранилище</p>
            <div className="flex justify-between mb-2">
              <span className="text-[13px] c-secondary">Использовано</span>
              <span className="text-[13px] font-semibold c-primary">{(storageInfo.usage / 1024 / 1024).toFixed(1)} МБ</span>
            </div>
            <div className="flex justify-between mb-2">
              <span className="text-[13px] c-secondary">Квота</span>
              <span className="text-[13px] c-tertiary">{(storageInfo.quota / 1024 / 1024).toFixed(0)} МБ</span>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--bg-surface-alt)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (storageInfo.usage / storageInfo.quota) * 100)}%`, background: 'var(--blue)' }} />
            </div>
          </div>
        )}

        {/* Test results */}
        <div className="rounded-2xl overflow-hidden card-glass" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 180ms both' }}>
          <p className="text-[11px] font-semibold uppercase tracking-wider px-4 pt-3 pb-2 c-tertiary">Тесты API</p>
          {results.map((r, i) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: i > 0 ? '0.5px solid var(--border-norse)' : 'none' }}>
              <span className="text-[13px] c-primary">{r.name}</span>
              {r.passed ? <CheckCircle size={16} className="c-green" /> : <XCircle size={16} className="c-red" />}
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
