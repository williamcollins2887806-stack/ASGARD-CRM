/**
 * TimesheetMobile — единый компонент табеля v2 на мобиле для 5 режимов.
 *
 * mode ∈ { 'pm' | 'warehouse' | 'medical' | 'travel' | 'global' }
 *
 * API: GET /api/timesheet/v2/:year/:month?mode=…
 *      PUT /api/timesheet/v2/entry
 *      GET /api/timesheet/v2/locks/:year/:month
 *      POST /api/timesheet/v2/lock
 *
 * UI-правила (из TIMESHEET_V2_CONTRACT.md):
 *   - pm: свои дни — цифра балла; чужие — иконка
 *   - warehouse/medical/travel: везде только иконки
 *   - global: цифра везде + сумма ₽
 *   - Лок: бейдж «🔒» и блок ввода через 423.
 *
 * Touch-friendly:
 *   - Ячейка 44×40 (тач-таргет ≥44)
 *   - Long-press (550мс) показывает tooltip с «Внёс: ФИО»
 *   - Horizontal scroll по дням, sticky-колонка ФИО
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { toast } from 'sonner';
import {
  CalendarDays, ChevronLeft, ChevronRight, Download,
  Lock, Unlock, Search, X, UserPlus, Settings as SettingsIcon,
} from 'lucide-react';

/** Унифицированный текст «месяц закрыт» (FIX 14) */
const LOCK_TOAST_TEXT = '🔒 Месяц закрыт. Свяжитесь с РП.';

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

/* ── Конфиги типов чекинов ────────────────────────────────────── */
/* FIX 15 — цвета через CSS-переменные --ts-*-bg / --ts-*-fg (унификация с vanilla/v2).
 * FIX 5 — waiting теперь оранжевый (раньше серый, совпадал с пустой клеткой).
 */
const CELL_TYPES = {
  day:       { icon: '☀️', label: 'Дневная смена',   color: 'var(--ts-day-fg, var(--green))',         bg: 'var(--ts-day-bg)',        short: 'Д' },
  night:     { icon: '🌙', label: 'Ночная смена',    color: 'var(--ts-night-fg, var(--blue))',        bg: 'var(--ts-night-bg)',      short: 'Н' },
  warehouse: { icon: '📦', label: 'Склад',           color: 'var(--ts-warehouse-fg, var(--cyan))',    bg: 'var(--ts-warehouse-bg)',  short: 'С' },
  medical:   { icon: '🏥', label: 'Медосмотр',       color: 'var(--ts-medical-fg, var(--red-soft))',  bg: 'var(--ts-medical-bg)',    short: 'М' },
  travel:    { icon: '✈️', label: 'Дорога',          color: 'var(--ts-travel-fg, var(--orange))',     bg: 'var(--ts-travel-bg)',     short: 'Д' },
  // V255 (23.06.2026): Корабль — альтернатива «Дороги» для ТО за повышенную ставку
  // (12 баллов × 500 ₽ = 6000 ₽/день). Свой fg — cyan #0EA5E9 (свободный токен).
  ship:      { icon: '🚢', label: 'Корабль',         color: 'var(--ts-ship-fg, #0EA5E9)',             bg: 'var(--ts-ship-bg)',       short: 'КР' },
  waiting:   { icon: '⏰', label: 'Ожидание',        color: 'var(--ts-waiting-fg, var(--orange))',    bg: 'var(--ts-waiting-bg)',    short: '⏰' },
};

/* FIX 3 — полные заголовки. На узких экранах CSS обрежет ellipsis в шапке. */
const MODE_TITLES = {
  pm:        'Табель моей дружины',
  warehouse: 'Табель учёта работы на складе',
  medical:   'Табель учёта МО',
  travel:    'Табель учёта дороги',
  global:    'Общий табель — Табель дружины',
};

/* ── Какие типы ввода доступны в этом режиме ──────────────────── */
/* V255 (23.06.2026): TO/HEAD_TO (medical) теперь могут ставить и 'ship' (Корабль).
 * В global добавлен 'ship' для директора/админа. */
const MODE_TYPES = {
  pm:        ['day', 'night', 'waiting'],
  warehouse: ['warehouse'],
  medical:   ['medical', 'ship'],
  travel:    ['travel'],
  global:    ['day', 'night', 'warehouse', 'medical', 'travel', 'ship', 'waiting'],
};

/* ── Кто может закрыть этот scope ─────────────────────────────── */
const SCOPE_LOCK_ROLES = {
  pm:        ['PM', 'HEAD_PM'],
  warehouse: ['WAREHOUSE'],
  medical:   ['TO', 'HEAD_TO'],
  travel:    ['OFFICE_MANAGER'],
  global:    ['DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','ADMIN','BUH','HR','HR_MANAGER'],
};

const fmtMoney = (n) => n == null ? '—' : `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const fmtNum   = (n) => n == null ? '—' : Math.round(n).toLocaleString('ru-RU');

function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

/* ════════════════════════════════════════════════════════════════
   FIX 9 — KPI chips (горизонтальный scroll, маленькие пилюли)
   ════════════════════════════════════════════════════════════════ */
function KpiChips({ data, employees, mode }) {
  const stats = useMemo(() => {
    let totalCheckins = 0; // отметки любого типа
    let dayShifts = 0;
    let nightShifts = 0;
    let amountSum = 0;
    let pointsSum = 0;
    let perDiemSum = 0;
    let warehouseDays = 0;
    let medicalDays  = 0;
    let travelDays   = 0;
    let shipDays     = 0; // V255
    for (const e of employees) {
      pointsSum += Number(e.total_points || 0);
      amountSum += Number(e.total_amount || 0);
      perDiemSum += Number(e.per_diem_total || 0);
      const days = e.days || {};
      for (const k in days) {
        const d = days[k];
        if (!d?.type) continue;
        totalCheckins++;
        if (d.type === 'day')       dayShifts++;
        else if (d.type === 'night') nightShifts++;
        else if (d.type === 'warehouse') warehouseDays++;
        else if (d.type === 'medical')   medicalDays++;
        else if (d.type === 'travel')    travelDays++;
        else if (d.type === 'ship')      shipDays++;
      }
    }
    return { totalCheckins, dayShifts, nightShifts, amountSum, pointsSum, perDiemSum, warehouseDays, medicalDays, travelDays, shipDays };
  }, [employees]);

  const chips = [];
  chips.push({ icon: '👥', text: `${employees.length} раб` });
  chips.push({ icon: '📅', text: `${stats.totalCheckins} дн` });

  if (mode === 'pm') {
    if (stats.pointsSum > 0) chips.push({ icon: '⭐', text: `${fmtNum(stats.pointsSum)} б` });
    // Суточные скрыты везде — расчёт ненадёжен (источник worker_payments хранит длинные командировки).
    if (stats.dayShifts > 0) chips.push({ icon: '☀️', text: stats.dayShifts });
    if (stats.nightShifts > 0) chips.push({ icon: '🌙', text: stats.nightShifts });
  } else if (mode === 'global') {
    if (stats.pointsSum > 0) chips.push({ icon: '⭐', text: `${fmtNum(stats.pointsSum)} б` });
    if (stats.amountSum > 0) chips.push({ icon: '₽', text: fmtMoney(stats.amountSum) });
    if (stats.dayShifts > 0) chips.push({ icon: '☀️', text: stats.dayShifts });
    if (stats.nightShifts > 0) chips.push({ icon: '🌙', text: stats.nightShifts });
    if (stats.warehouseDays > 0) chips.push({ icon: '📦', text: stats.warehouseDays });
    if (stats.medicalDays > 0) chips.push({ icon: '🏥', text: stats.medicalDays });
    if (stats.travelDays > 0) chips.push({ icon: '✈️', text: stats.travelDays });
    if (stats.shipDays > 0) chips.push({ icon: '🚢', text: stats.shipDays }); // V255
  } else {
    // warehouse / medical / travel — простые отметки.
    // V255: в medical считаем medical + ship (оба ставит ТО).
    const own = mode === 'warehouse' ? stats.warehouseDays
              : mode === 'medical'   ? (stats.medicalDays + stats.shipDays)
              : stats.travelDays;
    if (own > 0) chips.push({ icon: '✓', text: `${own} отметок` });
  }

  return (
    <div
      className="flex gap-1.5 mb-3 overflow-x-auto -mx-4 px-4 pb-1"
      style={{
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
      }}
    >
      {chips.map((c, i) => (
        <span
          key={i}
          className="px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-norse)',
            color: 'var(--text-primary)',
            flexShrink: 0,
          }}
        >
          <span style={{ marginRight: 4 }}>{c.icon}</span>{c.text}
        </span>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Long-press hook: 550ms hold ⇒ показывает tooltip с «Внёс: …»
   ════════════════════════════════════════════════════════════════ */
function useLongPress(callback, ms = 550) {
  const timerRef = useRef(null);
  const triggeredRef = useRef(false);

  const start = useCallback((e) => {
    triggeredRef.current = false;
    timerRef.current = setTimeout(() => {
      triggeredRef.current = true;
      callback(e);
    }, ms);
  }, [callback, ms]);

  const clear = useCallback(() => {
    clearTimeout(timerRef.current);
  }, []);

  return {
    onTouchStart: start,
    onTouchEnd:   clear,
    onTouchCancel:clear,
    onTouchMove:  clear,
    onMouseDown:  start,
    onMouseUp:    clear,
    onMouseLeave: clear,
    wasLongPress: () => triggeredRef.current,
  };
}

/* ════════════════════════════════════════════════════════════════
   Главный компонент
   ════════════════════════════════════════════════════════════════ */
export default function TimesheetMobile({ mode = 'global' }) {
  const haptic = useHaptic();
  const navigate = useNavigate();
  const user   = useAuthStore((s) => s.user);

  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cellDetail, setCellDetail] = useState(null);
  const [tooltip, setTooltip] = useState(null); // {empFio, day, info}
  const [showLockSheet, setShowLockSheet] = useState(false);
  const [showAddWorker, setShowAddWorker] = useState(false);
  const [editingCell, setEditingCell] = useState(null);   // {emp, day, current}
  /* FIX 4 — статус закрытия по всем 4 scope'ам (warehouse/medical/travel/global) +
   * pm_locks (массив РП); ВЕЗДЕ показываем чипы, не только в global. */
  const [closureStatus, setClosureStatus] = useState(null);

  const days = daysInMonth(year, month);

  /* ── Fetch табеля + closure-status (FIX 4) ───────────────── */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/timesheet/v2/${year}/${month}?mode=${mode}`;
      const res = await api.get(url);
      setData(res);
    } catch (e) {
      // Бэкенд может вернуть 404 — пока его нет
      setError(e.message || 'Ошибка загрузки');
      setData(null);
    } finally {
      setLoading(false);
    }
    // closure-status — не критично; при 404/500 просто не показываем чипы.
    api.get(`/timesheet/v2/closure-status/${year}/${month}`)
      .then((r) => setClosureStatus(r || null))
      .catch(() => setClosureStatus(null));
  }, [year, month, mode]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── Tooltip auto-dismiss (FIX 7 — 4000ms чтобы прочитать ФИО + телефон) ── */
  useEffect(() => {
    if (!tooltip) return;
    const t = setTimeout(() => setTooltip(null), 4000);
    return () => clearTimeout(t);
  }, [tooltip]);

  /* ── Месяц вперёд/назад ──────────────────────────────────── */
  const changeMonth = (delta) => {
    haptic.light();
    let m = month + delta, y = year;
    if (m > 12) { m = 1;  y++; }
    if (m < 1)  { m = 12; y--; }
    setMonth(m); setYear(y);
  };

  /* ── Поиск лока этого режима ─────────────────────────────── */
  const myLock = useMemo(() => {
    if (!data?.locks) return null;
    const globalLock = data.locks.find(l => l.scope === 'global' && (l.locked_at && !l.unlocked_at));
    if (globalLock) return { ...globalLock, scope: 'global' };
    // mode-specific
    if (mode === 'pm') {
      return data.locks.find(l => l.scope === 'pm' && l.scope_user_id === user?.id && l.locked_at && !l.unlocked_at) || null;
    }
    return data.locks.find(l => l.scope === mode && l.locked_at && !l.unlocked_at) || null;
  }, [data, mode, user?.id]);

  /* ── Все локи (FIX 4 — чипы во всех mode, не только global) ────
   * Источник истины — closureStatus.scope_locks; fallback на data.locks. */
  const allLockStatus = useMemo(() => {
    const scopes = ['warehouse', 'medical', 'travel'];
    // closure-status доступен — используем его, он точнее (отдельный SQL).
    if (closureStatus?.scope_locks) {
      return scopes.map((scope) => {
        const s = closureStatus.scope_locks[scope];
        const locked = !!(s && s.locked);
        return {
          scope,
          locked,
          locked_by_fio: s?.locked_by_fio || null,
          count: locked ? 1 : 0
        };
      });
    }
    // fallback на data.locks
    if (!data?.locks) return scopes.map((scope) => ({ scope, locked: false, count: 0 }));
    return scopes.map((scope) => {
      const active = data.locks.filter((l) => l.scope === scope && l.locked_at && !l.unlocked_at);
      return { scope, locked: active.length > 0, count: active.length, locked_by_fio: active[0]?.locked_by_fio };
    });
  }, [closureStatus, data]);

  /* PM-локи (для global): сколько РП уже закрыли свой период */
  const pmLockSummary = useMemo(() => {
    if (!closureStatus?.pm_locks) return null;
    const all = closureStatus.pm_locks;
    const locked = all.filter((p) => p.locked).length;
    return { locked, total: all.length };
  }, [closureStatus]);

  /* ── Can user lock this scope ────────────────────────────── */
  const canLockScope = SCOPE_LOCK_ROLES[mode]?.includes(user?.role);

  /* FIX 16 — кнопка-иконка ⚙ настройки баллов (ADMIN/DIRECTOR_GEN). */
  const canSeeSettingsCog = !!user && ['ADMIN', 'DIRECTOR_GEN'].includes(user.role);

  /* ── Lock action ─────────────────────────────────────────── */
  const handleLock = async () => {
    haptic.medium();
    try {
      const body = { scope: mode };
      if (mode === 'pm') body.scope_user_id = user.id;
      await api.post('/timesheet/v2/lock', body);
      toast.success('Месяц закрыт');
      setShowLockSheet(false);
      fetchData();
    } catch (e) {
      haptic.heavy(); /* FIX 11 */
      toast.error(e.message || 'Не удалось закрыть');
    }
  };

  const handleUnlock = async () => {
    if (!myLock?.id) return;
    haptic.medium();
    try {
      await api.delete(`/timesheet/v2/lock/${myLock.id}`);
      toast.success('Месяц разблокирован');
      setShowLockSheet(false);
      fetchData();
    } catch (e) {
      haptic.heavy(); /* FIX 11 */
      toast.error(e.message || 'Не удалось разблокировать');
    }
  };

  /* ── PUT entry ───────────────────────────────────────────── */
  const handleSaveEntry = async (payload) => {
    haptic.medium();
    try {
      await api.put('/timesheet/v2/entry', payload);
      toast.success(payload.delete ? 'Удалено' : 'Сохранено');
      setEditingCell(null);
      fetchData();
    } catch (e) {
      haptic.heavy(); /* FIX 11 — ошибка сохранения = heavy */
      if (e.status === 423) {
        toast.error(LOCK_TOAST_TEXT); /* FIX 14 — унифицированный текст */
      } else {
        toast.error(e.message || 'Ошибка сохранения');
      }
    }
  };

  /* ── Excel export (global only) ──────────────────────────── */
  const handleExport = async () => {
    haptic.medium();
    try {
      const token = api.getToken();
      const url = `/api/timesheet/v2/${year}/${month}/export?format=xlsx`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error('Ошибка экспорта');
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Табель_${MODE_TITLES[mode]}_${year}_${month}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error(e.message || 'Ошибка экспорта');
    }
  };

  const employees = data?.employees || [];

  return (
    <PageShell
      title={MODE_TITLES[mode]}
      headerRight={
        <>
          {canLockScope && (
            <button
              onClick={() => { haptic.light(); setShowLockSheet(true); }}
              className="spring-tap p-2"
              aria-label={myLock ? 'Месяц закрыт' : 'Закрыть месяц'}
              style={{ color: myLock ? 'var(--red-soft)' : 'var(--gold)' }}
            >
              {myLock
                ? <Lock size={20} strokeWidth={2.2} />
                : <Unlock size={20} strokeWidth={2.2} />}
            </button>
          )}
          {mode === 'global' && (
            <button onClick={handleExport} className="spring-tap p-2"
              aria-label="Excel-экспорт" style={{ color: 'var(--gold)' }}>
              <Download size={20} strokeWidth={2.2} />
            </button>
          )}
          {/* FIX 16 — кнопка «⚙ Настройки баллов» в global для админа/директора.
              На мобиле страница /admin/timesheet-settings — десктоп-only, поэтому
              открываем её хеш-роутом v2 (мобила перейдёт на десктоп-вёрстку, если
              ширина позволит; либо клиент откроет на десктопе через закладку). */}
          {mode === 'global' && canSeeSettingsCog && (
            <button
              onClick={() => {
                haptic.light();
                // Прыжок через window.location.hash работает и в HashRouter,
                // и в обычном SPA-окне открытом на десктопе.
                window.location.hash = '#/admin/timesheet-settings';
                navigate('/admin/timesheet-settings');
              }}
              className="spring-tap p-2"
              aria-label="Настройки баллов табеля"
              style={{ color: 'var(--gold)' }}
            >
              <SettingsIcon size={20} strokeWidth={2.2} />
            </button>
          )}
          {/* FIX 2 — «+ Рабочего» для всех mode (не только pm).
              В pm work_id обязателен, в остальных опционален (см. AddWorkerSheet). */}
          {['pm', 'warehouse', 'medical', 'travel', 'global'].includes(mode) && (
            <button onClick={() => { haptic.light(); setShowAddWorker(true); }}
              className="spring-tap p-2" aria-label="Добавить рабочего"
              style={{ color: 'var(--gold)' }}>
              <UserPlus size={20} strokeWidth={2.2} />
            </button>
          )}
        </>
      }
    >
      <PullToRefresh onRefresh={fetchData}>
        {/* Month switcher */}
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => changeMonth(-1)} className="p-3 spring-tap" style={{ minWidth: 44, minHeight: 44 }}>
            <ChevronLeft size={22} style={{ color: 'var(--text-primary)' }} />
          </button>
          <div className="text-center">
            <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {MONTHS[month - 1]} {year}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {employees.length} {employees.length === 1 ? 'рабочий' : employees.length < 5 && employees.length > 0 ? 'рабочих' : 'рабочих'}
            </p>
          </div>
          <button onClick={() => changeMonth(1)} className="p-3 spring-tap" style={{ minWidth: 44, minHeight: 44 }}>
            <ChevronRight size={22} style={{ color: 'var(--text-primary)' }} />
          </button>
        </div>

        {/* Lock badge */}
        {myLock && (
          <div className="rounded-xl p-3 mb-3 flex items-center gap-2" style={{
            backgroundColor: 'color-mix(in srgb, var(--red-soft) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--red-soft) 30%, transparent)',
          }}>
            <Lock size={16} style={{ color: 'var(--red-soft)' }} />
            <div className="flex-1 text-xs" style={{ color: 'var(--text-primary)' }}>
              <span className="font-semibold">🔒 Месяц закрыт</span>
              {myLock.locked_by_fio && <span className="ml-2" style={{ color: 'var(--text-tertiary)' }}>
                {myLock.locked_by_fio}
              </span>}
            </div>
          </div>
        )}

        {/* FIX 4 — Chips статусов локов: warehouse / medical / travel — ВО ВСЕХ mode'ах */}
        {allLockStatus.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {/* В global — отдельная плашка «РП X/Y закрыли» */}
            {mode === 'global' && pmLockSummary && pmLockSummary.total > 0 && (
              <span
                className="px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--gold) 14%, transparent)',
                  color: 'var(--gold)',
                  border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
                }}
                title="Сколько РП уже закрыли свой персональный период"
              >
                👥 РП {pmLockSummary.locked}/{pmLockSummary.total}
              </span>
            )}
            {allLockStatus.map(({ scope, locked }) => {
              const label = scope === 'warehouse' ? 'Склад' : scope === 'medical' ? 'МО' : 'Дорога';
              const isMine = scope === mode;
              return (
                <span key={scope}
                  className="px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1"
                  style={{
                    backgroundColor: locked
                      ? 'color-mix(in srgb, var(--green) 14%, transparent)'
                      : 'color-mix(in srgb, var(--text-tertiary) 12%, transparent)',
                    color: locked ? 'var(--green)' : 'var(--text-tertiary)',
                    border: `1px solid ${locked ? 'color-mix(in srgb, var(--green) 30%, transparent)' : 'var(--border-norse)'}`,
                    outline: isMine ? '1px dashed var(--gold)' : 'none',
                    outlineOffset: 2,
                  }}
                >
                  {locked ? '🔒' : '🔓'} {label}
                </span>
              );
            })}
          </div>
        )}

        {/* FIX 9 — KPI chips (горизонтальный scroll). Числа из data.employees + total_amount.
            mode='global' → +Σ ФОТ; pm → суточные; warehouse/medical/travel → счётчик отметок. */}
        {data && employees.length > 0 && (
          <KpiChips data={data} employees={employees} mode={mode} />
        )}

        {error && (
          <div className="rounded-xl p-3 mb-3 text-sm" style={{
            backgroundColor: 'color-mix(in srgb, var(--red-soft) 12%, transparent)',
            color: 'var(--red-soft)',
          }}>
            {error}
          </div>
        )}

        {/* Loading / Empty / Table */}
        {loading ? (
          <SkeletonList count={4} />
        ) : employees.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            iconColor="var(--blue)"
            iconBg="color-mix(in srgb, var(--blue) 10%, transparent)"
            title="Нет данных"
            description={`Нет отметок за ${MONTHS[month - 1]} ${year}`}
          />
        ) : (
          <TimesheetTable
            employees={employees}
            days={days}
            year={year}
            month={month}
            mode={mode}
            viewer={data?.viewer}
            settings={data?.settings}
            locked={!!myLock}
            onCellTap={(emp, day, dayData) => {
              if (myLock) {
                /* FIX 11 — heavy при ошибке; FIX 14 — унифицированный текст */
                haptic.heavy();
                toast.error(LOCK_TOAST_TEXT);
                return;
              }
              haptic.light();
              setEditingCell({ emp, day, current: dayData });
            }}
            onCellLongPress={(emp, day, dayData) => {
              haptic.medium();
              setTooltip({
                empFio: emp.fio,
                day,
                month,
                year,
                info: dayData,
              });
            }}
            onCellDetail={(emp, day, dayData) => {
              haptic.light();
              setCellDetail({ emp, day, ...dayData });
            }}
          />
        )}
      </PullToRefresh>

      {/* Tooltip (long-press) */}
      {tooltip && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-50 rounded-xl px-4 py-3 max-w-[88%]"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom) + 24px)',
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-norse)',
            boxShadow: 'var(--shadow-lg)',
            animation: 'fadeIn var(--motion-fast) var(--ease-smooth)',
          }}
        >
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            {tooltip.empFio} · {tooltip.day}.{String(tooltip.month).padStart(2, '0')}.{tooltip.year}
          </p>
          {tooltip.info?.type && (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {CELL_TYPES[tooltip.info.type]?.icon} {CELL_TYPES[tooltip.info.type]?.label}
              {tooltip.info.points != null && ` · ${tooltip.info.points} баллов`}
              {tooltip.info.amount != null && ` · ${fmtMoney(tooltip.info.amount)}`}
            </p>
          )}
          {tooltip.info?.entered_by_fio && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {/* FIX 8 — телефон автора, если backend его прислал */}
              Внёс: {tooltip.info.entered_by_fio}
              {tooltip.info.entered_by_role && ` (${tooltip.info.entered_by_role})`}
              {tooltip.info.entered_by_phone && (
                <>
                  {' '}·{' '}
                  <a href={`tel:${tooltip.info.entered_by_phone}`}
                     onClick={(e) => e.stopPropagation()}
                     style={{ color: 'var(--gold)', textDecoration: 'none' }}>
                    {tooltip.info.entered_by_phone}
                  </a>
                </>
              )}
              {tooltip.info.entered_at && (
                <span> · {new Date(tooltip.info.entered_at).toLocaleDateString('ru-RU')}</span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Cell-detail BottomSheet */}
      <BottomSheet open={!!cellDetail} onClose={() => setCellDetail(null)}
        title={cellDetail
          ? `${cellDetail.emp?.fio} · ${cellDetail.day} ${MONTHS[month - 1]}`
          : ''}
      >
        {cellDetail && <CellDetail data={cellDetail} mode={mode} />}
      </BottomSheet>

      {/* Edit cell BottomSheet */}
      <BottomSheet open={!!editingCell} onClose={() => setEditingCell(null)}
        title={editingCell
          ? `${editingCell.emp?.fio} · ${editingCell.day} ${MONTHS[month - 1]}`
          : ''}
      >
        {editingCell && (
          <EditCellSheet
            emp={editingCell.emp}
            day={editingCell.day}
            year={year}
            month={month}
            current={editingCell.current}
            mode={mode}
            onSave={handleSaveEntry}
            onClose={() => setEditingCell(null)}
          />
        )}
      </BottomSheet>

      {/* Lock / Unlock confirm */}
      <BottomSheet open={showLockSheet} onClose={() => setShowLockSheet(false)}
        title={myLock ? 'Разблокировать месяц?' : 'Закрыть месяц?'}
      >
        <LockSheet
          mode={mode}
          isLocked={!!myLock}
          monthName={MONTHS[month - 1]}
          year={year}
          onConfirm={myLock ? handleUnlock : handleLock}
          onClose={() => setShowLockSheet(false)}
        />
      </BottomSheet>

      {/* Add worker (PM only) */}
      <BottomSheet open={showAddWorker} onClose={() => setShowAddWorker(false)}
        title="Добавить рабочего"
      >
        <AddWorkerSheet
          year={year}
          month={month}
          mode={mode}
          onClose={() => setShowAddWorker(false)}
          onAdded={() => { setShowAddWorker(false); fetchData(); }}
        />
      </BottomSheet>
    </PageShell>
  );
}

/* ════════════════════════════════════════════════════════════════
   Таблица табеля
   ════════════════════════════════════════════════════════════════ */
function TimesheetTable({ employees, days, year, month, mode, viewer, locked, onCellTap, onCellLongPress, onCellDetail }) {
  // Высчитываем выходные
  const weekendDays = useMemo(() => {
    const set = new Set();
    for (let d = 1; d <= days; d++) {
      const dt = new Date(year, month - 1, d);
      const dow = dt.getDay();
      if (dow === 0 || dow === 6) set.add(d);
    }
    return set;
  }, [days, year, month]);

  /* FIX 13 — день сегодня (если месяц/год совпадают с текущими) */
  const todayDay = useMemo(() => {
    const t = new Date();
    if (t.getFullYear() === year && t.getMonth() + 1 === month) return t.getDate();
    return -1;
  }, [year, month]);

  return (
    <div className="overflow-x-auto -mx-4 px-4" style={{ WebkitOverflowScrolling: 'touch' }}>
      {/* FIX 6 — клетки 40×40 (было 32×40) → минимальная ширина больше */}
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: days * 44 + 240 }}>
        <thead>
          <tr>
            <th style={{
              position: 'sticky', left: 0, top: 0, zIndex: 3,
              background: 'var(--bg-primary)',
              padding: '8px 8px 8px 0',
              textAlign: 'left',
              fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
              borderBottom: '1px solid var(--border-norse)',
              minWidth: 140,
            }}>
              ФИО
            </th>
            {Array.from({ length: days }, (_, i) => {
              const d = i + 1;
              const isWeekend = weekendDays.has(d);
              const isToday = d === todayDay;
              return (
                <th key={i} style={{
                  padding: '8px 2px',
                  textAlign: 'center',
                  fontSize: 10,
                  fontWeight: isToday ? 800 : 500,
                  color: isToday ? 'var(--gold)' : (isWeekend ? 'var(--red-soft)' : 'var(--text-tertiary)'),
                  borderBottom: isToday
                    ? '2px solid var(--gold)'
                    : '1px solid var(--border-norse)',
                  minWidth: 44,
                  position: 'relative',
                }}
                  title={isToday ? 'Сегодня' : undefined}
                >
                  {d}
                  {/* FIX 13 — точка под цифрой сегодняшнего дня */}
                  {isToday && (
                    <span aria-hidden="true" style={{
                      position: 'absolute', left: '50%', bottom: 2,
                      transform: 'translateX(-50%)',
                      width: 4, height: 4, borderRadius: 4,
                      background: 'var(--gold)',
                      boxShadow: '0 0 6px var(--gold)',
                    }} />
                  )}
                </th>
              );
            })}
            {/* FIX 10 — отдельная колонка «Дни» (количество отмеченных дней) */}
            <th style={{
              padding: '8px',
              textAlign: 'center',
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--text-tertiary)',
              borderBottom: '1px solid var(--border-norse)',
              minWidth: 44,
              background: 'var(--bg-primary)',
            }}>
              Дни
            </th>
            <th style={{
              padding: '8px',
              textAlign: 'center',
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--text-tertiary)',
              borderBottom: '1px solid var(--border-norse)',
              minWidth: 64,
              background: 'var(--bg-primary)',
            }}>
              Итого
            </th>
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => (
            <EmployeeRow
              key={emp.id}
              emp={emp}
              days={days}
              weekendDays={weekendDays}
              todayDay={todayDay}
              mode={mode}
              viewer={viewer}
              locked={locked}
              onCellTap={onCellTap}
              onCellLongPress={onCellLongPress}
              onCellDetail={onCellDetail}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Строка рабочего
   ════════════════════════════════════════════════════════════════ */
function EmployeeRow({ emp, days, weekendDays, todayDay, mode, viewer, locked, onCellTap, onCellLongPress, onCellDetail }) {
  /* FIX 10 — количество отмеченных дней (любой тип, кроме пустой клетки). */
  const daysCount = useMemo(() => {
    if (!emp?.days) return 0;
    let n = 0;
    for (const k in emp.days) {
      if (emp.days[k]?.type) n++;
    }
    return n;
  }, [emp]);

  return (
    <tr>
      <td style={{
        position: 'sticky', left: 0, zIndex: 1,
        background: 'var(--bg-primary)',
        padding: '6px 8px 6px 0',
        fontSize: 12, fontWeight: 500,
        color: 'var(--text-primary)',
        borderBottom: '1px solid var(--border-norse)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: 140,
        minWidth: 140,
      }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.fio || '—'}</div>
        {emp.position && (
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>
            {emp.position}
          </div>
        )}
      </td>
      {Array.from({ length: days }, (_, di) => {
        const day = di + 1;
        const dayData = emp.days?.[day];
        const isWeekend = weekendDays.has(day);
        const isToday = day === todayDay;
        return (
          <CellTd
            key={di}
            emp={emp}
            day={day}
            dayData={dayData}
            isWeekend={isWeekend}
            isToday={isToday}
            mode={mode}
            locked={locked}
            onCellTap={onCellTap}
            onCellLongPress={onCellLongPress}
            onCellDetail={onCellDetail}
          />
        );
      })}
      {/* FIX 10 — Дни (количество отметок) */}
      <td style={{
        padding: '6px 8px',
        textAlign: 'center',
        fontSize: 12,
        fontWeight: 700,
        color: 'var(--text-secondary)',
        borderBottom: '1px solid var(--border-norse)',
        background: 'var(--bg-primary)',
      }}>
        {daysCount || '—'}
      </td>
      <td style={{
        padding: '6px 8px',
        textAlign: 'right',
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--gold)',
        borderBottom: '1px solid var(--border-norse)',
        background: 'var(--bg-primary)',
        whiteSpace: 'nowrap',
      }}>
        <TotalCell emp={emp} mode={mode} />
      </td>
    </tr>
  );
}

/* Итог по рабочему */
function TotalCell({ emp, mode }) {
  if (mode === 'global') {
    return (
      <div>
        <div>{fmtNum(emp.total_points)}</div>
        <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{fmtMoney(emp.total_amount)}</div>
      </div>
    );
  }
  if (mode === 'pm') {
    return <div>{fmtNum(emp.total_points)}</div>;
  }
  // warehouse / medical / travel — без чисел
  const cnt = emp.days ? Object.keys(emp.days).length : 0;
  return <div style={{ color: 'var(--text-secondary)' }}>{cnt}</div>;
}

/* ════════════════════════════════════════════════════════════════
   Ячейка
   ════════════════════════════════════════════════════════════════ */
function CellTd({ emp, day, dayData, isWeekend, isToday, mode, locked, onCellTap, onCellLongPress, onCellDetail }) {
  const longPress = useLongPress(() => {
    if (dayData) onCellLongPress(emp, day, dayData);
  });

  const handleClick = (e) => {
    if (longPress.wasLongPress()) {
      e.preventDefault();
      return;
    }
    // PM: чужой день — открываем info; свой / empty — редактирование
    if (mode === 'pm' && dayData && !dayData.is_mine) {
      onCellDetail(emp, day, dayData);
      return;
    }
    onCellTap(emp, day, dayData);
  };

  const cell = renderCell(dayData, mode);

  return (
    <td
      onClick={handleClick}
      {...longPress}
      style={{
        padding: 2,
        textAlign: 'center',
        borderBottom: '1px solid var(--border-norse)',
        cursor: locked ? 'not-allowed' : 'pointer',
        opacity: locked ? 0.6 : 1,
        background: isToday
          ? 'color-mix(in srgb, var(--gold) 8%, transparent)' /* FIX 13 — фон сегодняшней клетки */
          : isWeekend
            ? 'color-mix(in srgb, var(--red-soft) 3%, transparent)'
            : 'transparent',
      }}
    >
      <div style={{
        /* FIX 6 — квадрат 40×40 (было 32×40) */
        width: 40, height: 40, margin: '0 auto',
        borderRadius: 8,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: cell.bg,
        border: cell.border,
        color: cell.fg,
        fontWeight: 700,
        fontSize: cell.fontSize,
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        transition: 'transform var(--motion-fast) var(--ease-smooth)',
      }}>
        {cell.content}
      </div>
    </td>
  );
}

/* Проекция ячейки в зависимости от mode */
function renderCell(dayData, mode) {
  if (!dayData || !dayData.type) {
    return {
      content: '',
      bg: 'transparent',
      border: '1px dashed color-mix(in srgb, var(--text-tertiary) 20%, transparent)',
      fg: 'var(--text-tertiary)',
      fontSize: 11,
    };
  }
  const cfg = CELL_TYPES[dayData.type] || CELL_TYPES.day;

  // Решаем: показывать цифру или иконку
  let showNumber = false;
  if (mode === 'global') showNumber = true;
  if (mode === 'pm' && dayData.is_mine && dayData.points != null) showNumber = true;

  if (showNumber) {
    return {
      content: dayData.points != null ? String(dayData.points) : cfg.icon,
      bg: `color-mix(in srgb, ${cfg.color} 18%, transparent)`,
      border: `1px solid color-mix(in srgb, ${cfg.color} 40%, transparent)`,
      fg: cfg.color,
      fontSize: 13,
    };
  }

  return {
    content: cfg.icon,
    bg: `color-mix(in srgb, ${cfg.color} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${cfg.color} 30%, transparent)`,
    fg: cfg.color,
    fontSize: 14,
  };
}

/* ════════════════════════════════════════════════════════════════
   Cell detail (read-only)
   ════════════════════════════════════════════════════════════════ */
function CellDetail({ data, mode }) {
  const cfg = CELL_TYPES[data.type] || CELL_TYPES.day;
  return (
    <div className="flex flex-col gap-3 pb-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Тип</p>
        <p className="text-[15px]" style={{ color: 'var(--text-primary)' }}>
          {cfg.icon} {cfg.label}
        </p>
      </div>
      {data.points != null && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Баллы</p>
          <p className="text-[15px] font-semibold" style={{ color: 'var(--gold)' }}>{data.points}</p>
        </div>
      )}
      {data.amount != null && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Сумма</p>
          <p className="text-[15px] font-semibold" style={{ color: 'var(--gold)' }}>{fmtMoney(data.amount)}</p>
        </div>
      )}
      {data.work_title && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Объект</p>
          <p className="text-[14px]" style={{ color: 'var(--text-primary)' }}>{data.work_title}</p>
        </div>
      )}
      {data.entered_by_fio && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Внёс</p>
          <p className="text-[14px]" style={{ color: 'var(--text-primary)' }}>
            {data.entered_by_fio}
            {data.entered_by_role && (
              <span className="ml-1" style={{ color: 'var(--text-tertiary)' }}>({data.entered_by_role})</span>
            )}
          </p>
          {/* FIX 8 — телефон автора */}
          {data.entered_by_phone && (
            <p className="text-[13px] mt-1">
              <a href={`tel:${data.entered_by_phone}`}
                 style={{ color: 'var(--gold)', textDecoration: 'none' }}>
                📞 {data.entered_by_phone}
              </a>
            </p>
          )}
          {data.entered_at && (
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {new Date(data.entered_at).toLocaleString('ru-RU')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Edit cell sheet
   ════════════════════════════════════════════════════════════════ */
function EditCellSheet({ emp, day, year, month, current, mode, onSave, onClose }) {
  const types = MODE_TYPES[mode] || ['day'];
  const [type, setType] = useState(current?.type || types[0]);
  const [workId, setWorkId] = useState(current?.work_id || emp.work_id || '');
  const [works, setWorks]   = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Подгружаем работы — нужны для PM mode (work_id обязателен)
  useEffect(() => {
    if (mode !== 'pm' && mode !== 'global') return;
    api.get('/pm/works').then(r => setWorks(r.works || [])).catch(() => {});
  }, [mode]);

  const handleSave = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        employee_id: emp.id,
        work_id: workId ? parseInt(workId) : null,
        date: dateStr,
        type,
        shift: type === 'night' ? 'night' : 'day',
        delete: false,
      };
      await onSave(payload);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (submitting) return;
    if (!confirm('Удалить отметку?')) return;
    setSubmitting(true);
    try {
      await onSave({
        employee_id: emp.id,
        work_id: workId ? parseInt(workId) : null,
        date: dateStr,
        type,
        delete: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 pb-4">
      {/* Тип */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-2"
          style={{ color: 'var(--text-tertiary)' }}>Тип</p>
        <div className="grid grid-cols-3 gap-1.5">
          {types.map(t => {
            const cfg = CELL_TYPES[t];
            const active = type === t;
            return (
              <button
                key={t}
                onClick={() => setType(t)}
                className="spring-tap rounded-xl py-3 px-2 flex flex-col items-center gap-1"
                style={{
                  minHeight: 64,
                  backgroundColor: active
                    ? `color-mix(in srgb, ${cfg.color} 22%, transparent)`
                    : 'var(--bg-elevated)',
                  border: `1.5px solid ${active ? cfg.color : 'var(--border-norse)'}`,
                  color: active ? cfg.color : 'var(--text-secondary)',
                }}
              >
                <span style={{ fontSize: 22 }}>{cfg.icon}</span>
                <span className="text-[11px] font-semibold">{cfg.label.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Объект (для pm/global) */}
      {(mode === 'pm' || mode === 'global') && works.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-tertiary)' }}>Объект</p>
          <select value={workId} onChange={(e) => setWorkId(e.target.value)}
            className="w-full rounded-xl px-3 py-3 text-sm"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-norse)',
              color: 'var(--text-primary)',
              minHeight: 44,
            }}
          >
            <option value="">— выбрать —</option>
            {works.map(w => (
              <option key={w.id} value={w.id}>{w.work_title || `Объект #${w.id}`}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex gap-2 mt-2">
        {current?.type && (
          <button onClick={handleDelete} disabled={submitting}
            className="flex-1 spring-tap rounded-xl py-3 text-sm font-semibold"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--red-soft) 15%, transparent)',
              color: 'var(--red-soft)',
              minHeight: 44,
            }}
          >
            Удалить
          </button>
        )}
        <button onClick={onClose} className="spring-tap rounded-xl py-3 px-4 text-sm font-medium"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-norse)',
            minHeight: 44,
          }}
        >
          Отмена
        </button>
        <button onClick={handleSave} disabled={submitting}
          className="flex-1 spring-tap rounded-xl py-3 text-sm font-bold"
          style={{
            background: 'var(--gold-gradient)',
            color: '#000',
            minHeight: 44,
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Lock confirm sheet
   ════════════════════════════════════════════════════════════════ */
function LockSheet({ mode, isLocked, monthName, year, onConfirm, onClose }) {
  const [submitting, setSubmitting] = useState(false);
  const handle = async () => {
    setSubmitting(true);
    try { await onConfirm(); } finally { setSubmitting(false); }
  };

  return (
    <div className="flex flex-col gap-3 pb-4">
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {isLocked
          ? `Месяц ${monthName} ${year} закрыт. Разблокировать?`
          : `После закрытия редактирование табеля будет недоступно.`}
      </p>
      {mode === 'global' && !isLocked && (
        <div className="rounded-xl p-3" style={{
          backgroundColor: 'color-mix(in srgb, var(--orange) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--orange) 30%, transparent)',
        }}>
          <p className="text-xs" style={{ color: 'var(--text-primary)' }}>
            ⚠️ Глобальный лок блокирует ввод для <b>всех</b> ролей. РП, склад, МО и офис-менеджер не смогут вносить изменения.
          </p>
        </div>
      )}
      <div className="flex gap-2 mt-2">
        <button onClick={onClose}
          className="flex-1 spring-tap rounded-xl py-3 text-sm font-medium"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-norse)',
            minHeight: 44,
          }}
        >
          Отмена
        </button>
        <button onClick={handle} disabled={submitting}
          className="flex-1 spring-tap rounded-xl py-3 text-sm font-bold"
          style={{
            background: isLocked ? 'var(--green)' : 'var(--red-soft)',
            color: '#fff',
            minHeight: 44,
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? '…' : (isLocked ? 'Разблокировать' : 'Закрыть месяц')}
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Add worker — реальная модалка (BUG #5):
   - поиск рабочего по ФИО/телефону
   - PM-режим: селектор работы PM (work_id обязателен для day/night)
   - PUT /api/timesheet/v2/entry с первым днём месяца как пустая отметка
   Никаких заглушек: контракт «никаких stub-компонентов» (см. CLAUDE/MEMORY).
   ════════════════════════════════════════════════════════════════ */
function AddWorkerSheet({ year, month, mode = 'pm', onClose, onAdded }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // BUG #5 / FIX 2: PM-режим ТРЕБУЕТ work_id (validated на сервере).
  // warehouse/medical/travel — work_id опционален, селектор не показываем.
  // global — селектор показываем, но не обязательный.
  const [pmWorks, setPmWorks] = useState([]);
  const [worksLoading, setWorksLoading] = useState(false);
  const [selectedWorkId, setSelectedWorkId] = useState('');

  const needsWorkSelect = mode === 'pm' || mode === 'global';
  const workIsRequired  = mode === 'pm';

  // Подгружаем работы PM один раз при открытии (для pm + global)
  useEffect(() => {
    if (!needsWorkSelect) return;
    setWorksLoading(true);
    api.get('/pm/works')
      .then((r) => {
        const arr = Array.isArray(r) ? r : (r.works || r.items || r.rows || []);
        setPmWorks(arr);
        if (arr.length === 1 && workIsRequired) setSelectedWorkId(String(arr[0].id));
      })
      .catch(() => setPmWorks([]))
      .finally(() => setWorksLoading(false));
  }, [needsWorkSelect, workIsRequired]);

  // Поиск рабочих с debounce
  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.get(`/staff/employees?search=${encodeURIComponent(q)}`);
        const items = Array.isArray(r) ? r : (r.employees || r.items || r.rows || []);
        setResults(items.slice(0, 20));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const typeByMode = {
    pm: 'day',
    warehouse: 'warehouse',
    medical: 'medical',
    travel: 'travel',
    global: 'day',
  };

  const addOne = async (emp) => {
    if (submitting) return;
    if (workIsRequired && !selectedWorkId) {
      toast.error('Сначала выберите работу');
      return;
    }
    setSubmitting(true);
    try {
      const date = `${year}-${String(month).padStart(2, '0')}-01`;
      const payload = {
        employee_id: emp.id,
        work_id: selectedWorkId ? Number(selectedWorkId) : null,
        date,
        type: typeByMode[mode] || 'day',
        shift: (typeByMode[mode] === 'night') ? 'night' : 'day',
        delete: false,
      };
      await api.put('/timesheet/v2/entry', payload);
      toast.success(`${emp.fio || emp.full_name || 'Рабочий'} добавлен в табель`);
      onAdded?.();
    } catch (e) {
      if (e.status === 423) toast.error(LOCK_TOAST_TEXT); /* FIX 14 — унифицированный текст */
      else if (e.status === 409) toast.error('На эту дату уже есть отметка');
      else toast.error(e.message || 'Не удалось добавить');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 pb-4">
      {/* FIX 2 — селектор работы для pm (обязательный) и global (опциональный). */}
      {needsWorkSelect && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1"
             style={{ color: 'var(--text-tertiary)' }}>
            Работа{workIsRequired ? ' *' : ' (необязательно)'}
          </p>
          {worksLoading ? (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>⏳ Грузим работы…</p>
          ) : pmWorks.length === 0 ? (
            workIsRequired ? (
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                У вас нет активных работ. Создайте работу, чтобы добавить рабочего в табель.
              </p>
            ) : null
          ) : (
            <select
              value={selectedWorkId}
              onChange={(e) => setSelectedWorkId(e.target.value)}
              className="w-full rounded-xl px-3 py-3 text-sm"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-norse)',
                color: 'var(--text-primary)',
                minHeight: 44,
              }}
            >
              <option value="">— {workIsRequired ? 'выбрать работу' : 'без привязки к работе'} —</option>
              {pmWorks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.work_title || w.title || `Объект #${w.id}`}
                  {w.city ? ` · ${w.city}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="relative">
        <Search size={16} style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--text-tertiary)',
        }} />
        <input
          autoFocus
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ФИО / телефон"
          className="w-full rounded-xl pl-9 pr-9 py-3 text-sm"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-norse)',
            color: 'var(--text-primary)',
            minHeight: 44,
          }}
        />
        {q && (
          <button onClick={() => setQ('')}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              padding: 4, minWidth: 32, minHeight: 32,
              color: 'var(--text-tertiary)',
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {searching && <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>Поиск…</p>}

      <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto">
        {results.map((emp) => {
          const disabled = submitting || (workIsRequired && !selectedWorkId);
          return (
            <button key={emp.id}
              onClick={() => !disabled && addOne(emp)}
              disabled={disabled}
              className="spring-tap w-full text-left rounded-xl p-3"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-norse)',
                minHeight: 56,
                opacity: disabled ? 0.55 : 1,
              }}
            >
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {emp.fio || emp.full_name || '—'}
              </p>
              {emp.position && (
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {emp.position}{emp.phone ? ` · ${emp.phone}` : ''}
                </p>
              )}
            </button>
          );
        })}
        {q.length >= 2 && !searching && results.length === 0 && (
          <p className="text-xs text-center py-4" style={{ color: 'var(--text-tertiary)' }}>
            Не найдено
          </p>
        )}
      </div>
    </div>
  );
}
