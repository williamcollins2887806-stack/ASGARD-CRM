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
  /**
   * ЖУРНАЛ ПРЫЖКОВ БАРА (27.10.2026).
   *
   * Заказчик в PWA: «тап-бар туда-сюда прыгает». В PWA нет адресной строки,
   * поэтому `?diag=1` недостижим — а именно так раньше включался оверлей с
   * журналом. Здесь журнал доступен со СТРАНИЦЫ, которая открывается из меню
   * («Ещё → Диагностика»), то есть замер реально можно снять на устройстве.
   *
   * Пишем каждое смещение низа бара: время, было → стало, высоту окна,
   * visualViewport и прокрутку. По этим полям причина определяется однозначно:
   *   • меняется `окно`  → iOS пересчитывает коробку вьюпорта;
   *   • меняется `скролл` → бар двигает прокрутка страницы;
   *   • меняется только `vv` → дёргается visualViewport (клавиатура/шторка).
   */
  const [jumps, setJumps] = useState([]);
  const [recording, setRecording] = useState(true);

  useEffect(() => {
    if (!recording) return undefined;
    const t0 = Date.now();
    let last = null;
    const id = setInterval(() => {
      const nav = document.querySelector('nav.fixed.bottom-0');
      if (!nav) return;
      const val = Math.round(nav.getBoundingClientRect().bottom * 100) / 100;
      if (last !== null && Math.abs(val - last) > 0.5) {
        setJumps((J) => {
          const next = [...J, {
            t: Date.now() - t0,
            from: last,
            to: val,
            win: window.innerHeight,
            vv: window.visualViewport ? Math.round(window.visualViewport.height) : null,
            scroll: Math.round(window.scrollY),
          }];
          return next.length > 50 ? next.slice(-50) : next;
        });
      }
      last = val;
    }, 100);
    return () => clearInterval(id);
  }, [recording]);

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

        {/* ─── ПРЫЖКИ ТАП-БАРА ───────────────────────────────────────────────
            Ключевой блок для дефекта «бар прыгает». Показывает каждое смещение
            низа бара с причиной: меняется окно (вьюпорт) или прокрутка.
            Скролль страницу ниже и обратно — записи появятся сами. */}
        <div className="rounded-2xl overflow-hidden card-glass" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 220ms both' }}>
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider c-tertiary">
              Прыжки тап-бара: {jumps.length}
            </p>
            <button
              type="button"
              className="spring-tap"
              onClick={() => { haptic.light(); setRecording((r) => !r); }}
              style={{
                fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
                background: recording ? 'color-mix(in srgb, var(--green) 15%, transparent)' : 'var(--bg-surface-alt)',
                color: recording ? 'var(--green)' : 'var(--text-tertiary)',
                border: '0.5px solid var(--border-norse)',
              }}
            >
              {recording ? '● пишу' : '▶ писать'}
            </button>
          </div>

          {jumps.length === 0 ? (
            <div className="px-4 pb-3">
              <p className="text-[12px] c-tertiary" style={{ lineHeight: 1.45 }}>
                Смещений пока не было. Пролистайте страницу вниз и вверх — если бар
                прыгнет, записи появятся здесь.
              </p>
            </div>
          ) : (
            <div className="px-4 pb-3">
              {jumps.slice(-12).reverse().map((j, i) => (
                <div key={i} className="text-[11px] c-primary" style={{ marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                  {j.t}мс: {j.from} → <b className="c-gold">{j.to}</b>
                  {' '}окно {j.win}{j.vv !== null ? ` (vv ${j.vv})` : ''} скролл {j.scroll}
                </div>
              ))}
              <p className="text-[11px] c-tertiary" style={{ marginTop: 8, lineHeight: 1.45 }}>
                Если меняется «окно» — дело во вьюпорте iOS. Если «скролл» — бар
                двигает прокрутка. Пришлите этот экран разработчику.
              </p>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
