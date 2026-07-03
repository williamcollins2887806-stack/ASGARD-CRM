/**
 * Страница Timesheet v2 — единый компонент для 5 mode'ов:
 *   pm        → /my-timesheet            (PM, HEAD_PM)
 *   warehouse → /timesheet-warehouse     (WAREHOUSE)
 *   medical   → /timesheet-medical       (TO, HEAD_TO)
 *   travel    → /timesheet-travel        (OFFICE_MANAGER)
 *   global    → /timesheet               (DIRECTOR_*, ADMIN, BUH, HR, HR_MANAGER)
 *
 * Контракт: TIMESHEET_V2_CONTRACT.md.
 *
 * Применённые фиксы (см. TIMESHEET_V2_FIX_PLAN):
 *   FIX 1   — все 4 scope-бейджа в global (LockBadges)
 *   FIX 2   — таблица ВСЕХ РП с статусом «закрыл/не закрыл» (closure-status + LockBadges)
 *   FIX 3   — «+ Рабочего» для всех не-РП ролей
 *   FIX 10  — кнопка «📅 Сегодня» в Toolbar
 *   FIX 12  — ВСЕ действия в одном Toolbar (TopActionsBar — только title)
 *   FIX 13  — пауза авто-рефреша при открытой модалке/popover
 *   FIX 14  — группировка по объекту в pm-mode (как vanilla)
 *   FIX 15  — заголовок «Закрытие месяца — <Период>»
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { TopActionsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';

import { api } from '@/api/client';
import {
  MODES, inferModeFromRole,
  canLockScope, canAnyUnlock,
  getMonth, putEntry, lockMonth, unlockMonth, getLocks, getClosureStatus, exportXlsx,
  monthLabel
} from './api';
import Toolbar from './Toolbar';
import TimesheetGrid from './TimesheetGrid';
import LockBadges from './LockBadges';
import AddWorkerModal from './AddWorkerModal';
import LockMonthModal from './LockMonthModal';
import Dashboard from './Dashboard';
// Stage W — вкладка «💵 Передачи» (только PM-mode)
import HandoverTab from './HandoverTab';
import './timesheet.css';

const REFRESH_MS = 30000;

// FIX 3 — Кто может добавлять рабочего (все role-агрегации кроме чистого read-only).
const MODES_WITH_ADD = ['pm', 'warehouse', 'medical', 'travel', 'global'];

export default function TimesheetPage({ mode: modeProp }) {
  const { user } = useAuth();
  const modal = useModal();

  const mode = useMemo(() => {
    if (modeProp && MODES[modeProp]) return modeProp;
    return inferModeFromRole(user?.role) || 'pm';
  }, [modeProp, user?.role]);

  const meta = MODES[mode];

  /* ─── Доступ ─── */
  const hasAccess = !!(user && meta.roles.includes(user.role));

  /* ─── Период ─── */
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  /* ─── Данные ─── */
  const [data, setData] = useState(null);
  const [locks, setLocks] = useState([]);
  const [closureStatus, setClosureStatus] = useState(null);
  // Phase 1E — данные карточки «🏦 Касса» (только в global)
  const [cashCoverage, setCashCoverage] = useState(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef(null);

  // FIX 13 — флаг открытой модалки (пауза авто-рефреша)
  const [modalsOpen, setModalsOpen] = useState(0);
  const pauseRefresh = modalsOpen > 0;

  // Stage W — табы в pm-режиме: «Табель» / «💵 Передачи».
  // В остальных mode таблица одна, табов нет.
  const [pmTab, setPmTab] = useState('timesheet');

  const loadAll = useCallback(async (silent = false) => {
    if (!hasAccess) return;
    if (!silent) setLoading(true);
    try {
      // Phase 1E — параллельно фетчим cash-coverage в global. 403/ошибки → null (карточка просто не покажется).
      const [d, l, cs, cc] = await Promise.all([
        getMonth(year, month).catch((e) => {
          if (e?.status === 404) return null;
          throw e;
        }),
        getLocks(year, month).catch(() => []),
        // FIX 1 + FIX 2 — закрытие-статус (для global = pm_locks + scope_locks).
        // Для остальных mode используем как доп. источник.
        getClosureStatus(year, month).catch(() => null),
        mode === 'global'
          ? api(`/api/payroll-dashboard/cash-coverage/${year}/${month}`).catch(() => null)
          : Promise.resolve(null)
      ]);
      setData(d || { year, month, employees: [], days_in_month: new Date(year, month, 0).getDate() });
      setLocks(Array.isArray(l) ? l : (l?.locks || []));
      setClosureStatus(cs);
      setCashCoverage(cc);
    } catch (e) {
      if (!silent) {
        toast.error('Не удалось загрузить табель: ' + (e?.serverMsg || e?.message || e));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [hasAccess, year, month, mode]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Авто-refresh 30с — FIX 13: только если нет открытых модалок
  useEffect(() => {
    if (!hasAccess) return;
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = setInterval(() => {
      if (pauseRefresh) return; // не дёргаем сервер при открытой модалке
      loadAll(true);
    }, REFRESH_MS);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [hasAccess, loadAll, pauseRefresh]);

  /* ─── Лок-логика ─── */
  const myLock = useMemo(() => {
    // Глобальный — для всех; собственный scope — для своей роли.
    // Сначала проверяем closure-status (новый источник истины).
    if (closureStatus?.scope_locks?.global?.locked) {
      return {
        scope: 'global',
        locked_at: closureStatus.scope_locks.global.locked_at,
        id: closureStatus.scope_locks.global.lock_id
      };
    }
    if (meta.lockScope === 'pm' && user?.id) {
      const my = (closureStatus?.pm_locks || []).find((p) => p.user_id === user.id && p.locked);
      if (my) return { scope: 'pm', locked_at: my.locked_at, id: my.lock_id };
    } else if (meta.lockScope !== 'global') {
      const sl = closureStatus?.scope_locks?.[meta.lockScope];
      if (sl?.locked) return { scope: meta.lockScope, locked_at: sl.locked_at, id: sl.lock_id };
    }
    // Fallback к старому locks[]
    return locks.find((l) => {
      if (!l.locked_at) return false;
      if (l.scope === 'global') return true;
      if (l.scope !== meta.lockScope) return false;
      if (l.scope === 'pm') return l.scope_user_id === user?.id;
      return true;
    });
  }, [closureStatus, locks, meta.lockScope, user?.id]);

  const isLocked = !!myLock;
  const canEdit = hasAccess && !isLocked;
  const canLockMy = hasAccess && canLockScope(user?.role, meta.lockScope);
  const canExport = hasAccess && mode === 'global';
  // FIX 3 — «+ Рабочего» для всех 4 не-РП ролей + global, кроме read-only
  const canAddWorker = hasAccess && canEdit && MODES_WITH_ADD.includes(mode);

  const canUnlockSpecific = useCallback((lock) => {
    if (!user) return false;
    if (lock.locked_by === user.id || lock.locked_by_id === user.id) return true;
    if (canAnyUnlock(user.role)) return true;
    return false;
  }, [user]);

  /* ─── Период nav ─── */
  const onPrev = () => {
    if (month <= 1) { setMonth(12); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  };
  const onNext = () => {
    if (month >= 12) { setMonth(1); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  };
  // FIX 10 — быстрый возврат к текущему месяцу
  const onToday = () => {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth() + 1);
  };

  /* ─── Действия ─── */
  const onRefresh = () => loadAll();

  const onExportClick = async () => {
    try {
      await exportXlsx(year, month);
      toast.success('Файл скачивается');
    } catch (e) {
      toast.error('Не удалось скачать: ' + (e?.serverMsg || e?.message || e));
    }
  };

  const openWithPause = useCallback((node) => {
    // FIX 13 — фиксируем открытие модалки
    setModalsOpen((n) => n + 1);
    modal.open(node, {
      onClose: () => setModalsOpen((n) => Math.max(0, n - 1))
    });
  }, [modal]);

  const onAddWorker = () => {
    openWithPause(
      <AddWorkerModal
        year={year}
        month={month}
        mode={mode}
        onAdded={() => loadAll(true)}
      />
    );
  };

  const onLockGlobal = () => {
    if (!canLockMy) return;
    openWithPause(
      <LockMonthModal
        scope={meta.lockScope}
        year={year}
        month={month}
        onConfirm={async () => {
          await lockMonth({ scope: meta.lockScope, year, month });
          await loadAll(true);
        }}
      />
    );
  };

  const onUnlockClick = async (lock) => {
    if (!canUnlockSpecific(lock)) return;
    try {
      await unlockMonth(lock.id);
      toast.success('Месяц открыт');
      loadAll(true);
    } catch (e) {
      toast.error('Не удалось открыть: ' + (e?.serverMsg || e?.message || e));
    }
  };

  // FIX 2 — «Напомнить РП»: реальный push через /api/notifications/push.
  // RBAC сервера: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, BUH, HR_MANAGER.
  const onRemindPm = async (pmLock) => {
    if (!pmLock?.user_id) {
      toast.error('Не удалось определить РП');
      return;
    }
    const period = monthLabel(year, month);
    try {
      await api('/api/notifications/push', {
        method: 'POST',
        body: {
          user_id: pmLock.user_id,
          title: 'Напоминание: закрытие табеля',
          message: `Пожалуйста, заполните и закройте табель за ${period}.`,
          link: '/#/my-timesheet',
          type: 'timesheet_close_reminder'
        }
      });
      toast.success(`Напоминание отправлено: ${pmLock.fio}`);
    } catch (e) {
      if (e?.status === 403) {
        toast.warn('Недостаточно прав для отправки напоминания');
      } else {
        toast.error('Не удалось отправить: ' + (e?.serverMsg || e?.message || e));
      }
    }
  };

  /* ─── Entry change (callback из TimesheetGrid) ─── */
  const onEntryChange = useCallback(async (payload) => {
    try {
      await putEntry(payload);
      toast.success(payload.delete ? 'Отметка удалена' : 'Отметка сохранена');
      await loadAll(true);
    } catch (e) {
      if (e?.status === 423) {
        toast.warn('Месяц закрыт — изменение запрещено');
      } else if (e?.status === 403) {
        toast.warn('Нет прав на эту отметку');
      } else if (e?.status === 400 && e?.serverMsg === 'work_id_required') {
        toast.error('Выберите работу для этой отметки');
      } else if (e?.status === 422 || e?.status === 400) {
        toast.error('Некорректные данные: ' + (e?.serverMsg || ''));
      } else {
        toast.error('Не удалось сохранить: ' + (e?.serverMsg || e?.message || e));
      }
      throw e;
    }
  }, [loadAll]);

  // FIX 13 — позволяем дочерним компонентам сигналить об открытии/закрытии popover
  const onPopoverChange = useCallback((open) => {
    setModalsOpen((n) => open ? n + 1 : Math.max(0, n - 1));
  }, []);

  if (!hasAccess) {
    return (
      <AccessDenied
        allowed={meta.roles}
        userRole={user?.role || '—'}
        title={meta.title}
        message={`Этот табель доступен ролям: ${meta.roles.join(', ')}.`}
      />
    );
  }

  /* ─── Render ─── */
  return (
    <div className="ts-page">
      {/* FIX 12 — TopActionsBar теперь только title (без кнопок) */}
      <TopActionsBar
        kicker={meta.kicker}
        title={meta.title}
        subtitle={isLocked ? `🔒 Месяц закрыт — редактирование запрещено` : meta.subtitle}
      />

      <Toolbar
        year={year}
        month={month}
        mode={mode}
        data={data}
        onPrev={onPrev}
        onNext={onNext}
        onToday={onToday}
        onRefresh={onRefresh}
        onExport={onExportClick}
        onAddWorker={onAddWorker}
        canExport={canExport}
        canAddWorker={canAddWorker}
      />

      {/* LockBadges — теперь работает по closure-status для FIX 1 и FIX 2 */}
      {(mode === 'global' || closureStatus || locks.length > 0 || canLockMy) && (
        <LockBadges
          mode={mode}
          closureStatus={closureStatus}
          locks={locks}
          year={year}
          month={month}
          currentUserId={user?.id}
          canUnlock={canUnlockSpecific}
          onUnlock={onUnlockClick}
          onLockGlobal={onLockGlobal}
          onRemindPm={onRemindPm}
          canLockMy={canLockMy}
          myScope={meta.lockScope}
        />
      )}

      {/* Stage W — PM-mode табы (Табель / Передачи). В остальных mode табов нет. */}
      {mode === 'pm' && (
        <div className="ts-pm-tabs">
          <button
            type="button"
            className={'ts-pm-tab' + (pmTab === 'timesheet' ? ' active' : '')}
            onClick={() => setPmTab('timesheet')}
          >
            📊 Табель
          </button>
          <button
            type="button"
            className={'ts-pm-tab' + (pmTab === 'handovers' ? ' active' : '')}
            onClick={() => setPmTab('handovers')}
          >
            💵 Передачи
          </button>
        </div>
      )}

      {loading ? (
        <div className="ts-wrap">
          <div className="ts-empty">⏳ Загружаем табель…</div>
        </div>
      ) : mode === 'pm' && pmTab === 'handovers' ? (
        <HandoverTab year={year} month={month} />
      ) : (
        <>
          {/* Phase 1C/1E + Stage S — Dashboard для global-режима. Backend возвращает summary только директорам/HR/BUH.
              employees нужен для PaidInFieldCard (Stage S) — суммирует paid_breakdown по сотрудникам. */}
          {mode === 'global' && (
            <Dashboard
              summary={data?.summary}
              cashCoverage={cashCoverage}
              employees={data?.employees || []}
            />
          )}
          <TimesheetGrid
            data={data}
            mode={mode}
            editableTypes={meta.editableTypes}
            canEdit={canEdit}
            isLocked={isLocked}
            requireWorkForDayNight={meta.requireWorkFor.includes('day') || meta.requireWorkFor.includes('night')}
            onEntryChange={onEntryChange}
            onPopoverChange={onPopoverChange}
          />
        </>
      )}
    </div>
  );
}
