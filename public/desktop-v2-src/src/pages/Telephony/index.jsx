/**
 * Страница /telephony — телефония (журнал + 4 новых таба).
 *
 * Источник: vanilla `public/assets/js/telephony.js` (~2280 строк) — 5 табов:
 *   Журнал / Пропущенные / Статистика / Аналитика / Маршрутизация.
 *
 *   ✅ pages/Telephony/index.jsx                ← root + TabsBar + Журнал
 *   ✅ pages/Telephony/api.js                   ← endpoints (Mango)
 *   ✅ pages/Telephony/tabs/Missed.jsx          ← пропущенные + badge unack
 *   ✅ pages/Telephony/tabs/Stats.jsx           ← KPI + SVG-stacked-bar + менеджеры
 *   ✅ pages/Telephony/tabs/Analytics.jsx       ← AI-анализ + DaData-badge + фильтр менеджера
 *   ✅ pages/Telephony/tabs/Routing.jsx         ← CRUD call_routing_rules
 *   ✅ pages/Telephony/IncomingCallPopup.jsx    ← попап входящего звонка (portal в App.jsx)
 *   ✅ modals/CallDetailModal.jsx               ← деталь звонка + запись + заметки + теги
 *   ✅ modals/DispatcherModal.jsx               ← настройки диспетчера (IVR)
 *   ✅ modals/MakeCallModal.jsx                 ← исходящий звонок
 *
 * Никаких заглушек.
 */
import { useState, useEffect, useMemo, lazy, Suspense, useCallback } from 'react';
import { useModal } from '@/modals';
import { useAuth } from '@/api/useAuth';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState, TabsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { StatusBadge } from '@/modals/Notifications';
import { SearchInput, SelectInput, DatePicker } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';
import { CallDetailModal } from './modals/CallDetailModal';
import { DispatcherModal } from './modals/DispatcherModal';
import { MakeCallModal } from './modals/MakeCallModal';
import { loadCalls, loadCallStats, loadDispatcherSettings, loadMissed, CALL_TYPES, fmtDuration, fmtDateTime, fmtPhone } from './api';

// Lazy: тяжёлые табы загружаем только при клике.
const MissedTab = lazy(() => import('./tabs/Missed'));
const StatsTab = lazy(() => import('./tabs/Stats'));
const AnalyticsTab = lazy(() => import('./tabs/Analytics'));
const RoutingTab = lazy(() => import('./tabs/Routing'));
const MangoTab = lazy(() => import('./tabs/Mango'));

// RBAC синхронно с backend `src/routes/telephony.js:10` (TEL_ROLES).
// Inline-литералы нужны скрипту rbac-audit для автопроверки покрытия.
const ALLOWED_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'BUH'];

const TABS = [
  { id: 'journal',   label: '📞 Журнал' },
  { id: 'missed',    label: '☎ Пропущенные' },
  { id: 'stats',     label: '📊 Статистика' },
  { id: 'analytics', label: '🧙 Аналитика' },
  { id: 'routing',   label: '↪ Маршрутизация' },
  { id: 'mango',     label: '🥭 Интеграция Mango' }
];

export default function TelephonyPage() {
  const { user } = useAuth();
  const modal = useModal();
  const [tab, setTab] = useState('journal');
  const [missedBadge, setMissedBadge] = useState(0);
  const [filters, setFilters] = useState({ q: '', type: '', from: '', to: '' });
  const dq = useDebounce(filters.q, 300);  // G-11: debounce 300мс
  const [calls, setCalls] = useState([]);
  const [stats, setStats] = useState({});
  const [dispatcher, setDispatcher] = useState({});
  const [loading, setLoading] = useState(true);

  const hasAccess = !user || ALLOWED_ROLES.includes(user.role);

  const refresh = useCallback(() => {
    if (!hasAccess) return;
    setLoading(true);
    Promise.all([
      loadCalls({ limit: 2000, from: filters.from, to: filters.to }),
      loadCallStats('today'),
      loadDispatcherSettings()
    ]).then(([cs, st, ds]) => {
      setCalls(cs);
      setStats(st || {});
      setDispatcher(ds || {});
    }).finally(() => setLoading(false));
  }, [filters.from, filters.to, hasAccess]);

  useEffect(() => { refresh(); }, [refresh]);

  // Бейдж непросмотренных пропущенных — на странице сразу при загрузке
  // (а не только при клике на таб «Пропущенные»). Plus подписка на SSE:
  // call:incoming/ended → обновляем число.
  useEffect(() => {
    if (!hasAccess) return undefined;
    let cancelled = false;
    const fetchMissedCount = () => {
      loadMissed({ acknowledged: false, limit: 1 }).then((d) => {
        if (cancelled) return;
        setMissedBadge(Number(d.unacknowledged) || 0);
      });
    };
    fetchMissedCount();
    const onCall = () => fetchMissedCount();
    window.addEventListener('asgard:call:incoming', onCall);
    window.addEventListener('asgard:call:ended', onCall);
    return () => {
      cancelled = true;
      window.removeEventListener('asgard:call:incoming', onCall);
      window.removeEventListener('asgard:call:ended', onCall);
    };
  }, [hasAccess]);

  const visible = useMemo(() => {
    let v = calls;
    if (filters.type) v = v.filter((c) => c.type === filters.type);
    if (dq) {
      const lq = dq.toLowerCase();
      v = v.filter((c) =>
        String(c.from_number || '').includes(lq) ||
        String(c.to_number || '').includes(lq) ||
        (c.client_name || '').toLowerCase().includes(lq) ||
        (c.operator_name || '').toLowerCase().includes(lq)
      );
    }
    return v;
  }, [calls, filters.type, dq]);

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !hasAccess) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Телефония недоступна"
        message="Журнал звонков и диспетчер видят директора, PM/HEAD_PM, ТО/HEAD_TO, бухгалтерия и ADMIN."
      />
    );
  }

  const tabsWithCount = TABS.map((t) => (
    t.id === 'missed' && missedBadge > 0 ? { ...t, count: missedBadge } : t
  ));

  return (
    <div className="col gap-12">
      <TopActionsBar
        title="Телефония"
        subtitle={`${stats.today_count || 0} сегодня · ☎ ${stats.missed_count || missedBadge || 0} пропущенных`}
        actions={
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: dispatcher.dispatcher_enabled ? 'var(--ok-bg)' : 'var(--err-bg)', borderRadius: 'var(--r-sm)', fontSize: 12.5 }}>
              <StatusBadge tone={dispatcher.dispatcher_enabled ? 'approved' : 'rejected'} label={dispatcher.dispatcher_enabled ? 'Диспетчер активен' : 'Диспетчер отключён'} />
            </span>
            <Btn variant="ghost" onClick={() => modal.open(<DispatcherModal />)}>⚙ Настройки</Btn>
            <Btn variant="primary" onClick={() => modal.open(<MakeCallModal />)}>📞 Позвонить</Btn>
          </>
        }
      />

      <TabsBar tabs={tabsWithCount} active={tab} onChange={setTab} />

      {tab === 'journal' && (
        <>
          <div className="filter-bar" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,2fr) minmax(140px,1fr) minmax(140px,1fr) minmax(140px,1fr)', gap: 8 }}>
            <SearchInput value={filters.q} onChange={(v) => setFilters({ ...filters, q: v })} placeholder="Поиск по номеру, имени…" />
            <SelectInput value={filters.type} onChange={(v) => setFilters({ ...filters, type: v })} options={[{ value: '', label: 'Все типы' }, ...CALL_TYPES]} />
            <DatePicker value={filters.from} onChange={(v) => setFilters({ ...filters, from: v })} placeholder="С даты" />
            <DatePicker value={filters.to} onChange={(v) => setFilters({ ...filters, to: v })} placeholder="По дату" />
          </div>

          {loading ? (
            <div className="card card-empty" >⏳ Загружаем звонки…</div>
          ) : visible.length === 0 ? (
            <EmptyState icon="📞" title="Звонков нет" hint="Попробуй убрать фильтры или расширить даты" />
          ) : (
            <div className="card card-pad-overflow">
              <div className="ov-x-auto">
                <table className="t-list w-full tbl-base">
                  <thead>
                    <tr className="bg-inner tbl-row-brd">
                      <th className="w-50">#</th>
                      <th className="w-130">Тип</th>
                      <th>От кого / Кому</th>
                      <th className="w-200">Клиент / Оператор</th>
                      <th className="w-100">Длит.</th>
                      <th className="w-80">🎤</th>
                      <th className="w-160">Когда</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => {
                      const t = CALL_TYPES.find((x) => x.value === c.type) || { label: c.type, tone: 'draft' };
                      return (
                        <tr key={c.id} className="row-hover cur-p"  onClick={() => modal.open(<CallDetailModal call={c} />)}>
                          <td className="c-t3 fs-12">#{c.id}</td>
                          <td><StatusBadge tone={t.tone} label={t.label} /></td>
                          <td>
                            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{fmtPhone(c.from_number)}</div>
                            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--t-3)' }}>→ {fmtPhone(c.to_number)}</div>
                          </td>
                          <td>
                            {c.client_name && <div className="fw-600">{c.client_name}</div>}
                            {c.operator_name && <div className="fs-11-5 c-t3">👤 {c.operator_name}</div>}
                          </td>
                          <td style={{ fontFamily: 'ui-monospace, monospace' }}>{fmtDuration(c.duration_seconds)}</td>
                          <td>{(c.has_recording || c.recording_url) ? '🎵' : '—'}</td>
                          <td className="fs-12 c-t3">{fmtDateTime(c.started_at || c.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab !== 'journal' && (
        <Suspense fallback={<div className="card card-empty">⏳ Загружаем вкладку…</div>}>
          {tab === 'missed'    && <MissedTab onCountChange={setMissedBadge} />}
          {tab === 'stats'     && <StatsTab />}
          {tab === 'analytics' && <AnalyticsTab />}
          {tab === 'routing'   && <RoutingTab />}
          {tab === 'mango'     && <MangoTab />}
        </Suspense>
      )}
    </div>
  );
}
