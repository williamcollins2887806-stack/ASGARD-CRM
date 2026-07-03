/**
 * Страница /payroll — Расчёты с рабочими.
 *
 * Источник: vanilla `public/assets/js/payroll.js` (1584 строки, AsgardPayrollPage).
 *
 *   ✅ pages/Payroll/index.jsx           — root + переключатель видов (sheets/sheet/grid) с URL-параметрами
 *   ✅ pages/Payroll/api.js              — все endpoints + helpers (тарифы/категории/деньги/даты)
 *   ✅ pages/Payroll/PayrollSheet.jsx    — карточка одной ведомости (inline-edit, действия, реестр)
 *   ✅ pages/Payroll/PayrollGrid.jsx     — Excel-сетка баллов за смены (загрузка/редактирование/сохранение/экспорт)
 *   ✅ pages/Payroll/modals/PaymentModal.jsx   — добавить начисление (рабочий + дни + ставка + премия/штраф)
 *   ✅ pages/Payroll/modals/SheetCloseModal.jsx — закрытие ведомости (paySheet) с подтверждением итогов
 *   ✅ pages/Payroll/modals/ExportModal.jsx     — Excel: реестр выплат или сетка баллов
 *
 * URL-схема (hash-роуты, как в vanilla):
 *   #/payroll                    → список ведомостей + табы статусов
 *   #/payroll?view=grid          → Excel-сетка баллов
 *   #/payroll-grid               → то же что view=grid (отдельный legacy-роут)
 *   #/payroll-sheet?id=NN        → карточка конкретной ведомости
 *   #/reports/payroll            → отчёт по выплатам (payment_registry + графики/Excel)
 *
 *  Доступ: ADMIN, DIRECTOR_*, PM, HEAD_PM, BUH.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { Btn, MCard, MHead, MBody, MFoot, Field } from '@/modals/parts';
import { TopActionsBar, TabsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput, Combobox as _Combobox, DatePicker, TextareaInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import {
  loadSheets, createSheet,
  loadWorks,
  fmtMoney, fmtMoneyShort, fmtDate,
  statusMeta, hasAccess, canCreate,
  SHEET_STATUS_TABS,
  parseHashParams
} from './api';
import PayrollSheet from './PayrollSheet';
import ExportModal  from './modals/ExportModal';
import './payroll.css';

const PAGE = 25;

export default function PayrollPage({ mode }) {
  const { user } = useAuth();
  const modal   = useModal();
  const navigate = useNavigate();
  const location = useLocation();

  /* mode = 'list' | 'sheet' | 'grid' | 'report'. Если не передан — определяем по hash. */
  const [activeView, setActiveView] = useState(mode || 'list');
  const [sheetId,    setSheetId]    = useState(null);

  /* Hash → state */
  const syncFromHash = useCallback(() => {
    const params = parseHashParams();
    if (mode) {
      setActiveView(mode);
      if (mode === 'sheet' && params.id) setSheetId(Number(params.id));
      return;
    }
    if (params.view === 'grid') {
      setActiveView('grid');
    } else if (params.id) {
      setActiveView('sheet');
      setSheetId(Number(params.id));
    } else {
      setActiveView('list');
    }
  }, [mode]);

  useEffect(() => { syncFromHash(); }, [syncFromHash, location.hash]);

  useEffect(() => {
    const h = () => syncFromHash();
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, [syncFromHash]);

  /* RBAC */
  if (!hasAccess(user?.role)) {
    return (
      <div className="card pyd-access-locked">
        <div className="pyd-locked-icon">🔒</div>
        <div className="pyd-locked-title">Доступ закрыт</div>
        <div className="c-t3">Раздел зарплаты доступен директорам, бухгалтерии и руководителям проектов.</div>
      </div>
    );
  }

  /* Маршрутизация внутри страницы */
  // Grid-вид удалён 18.06.2026 — Excel-сетка баллов перенесена на /my-timesheet (Timesheet v2 pm mode).
  // Если из URL пришёл view=grid (legacy) — переходим на /my-timesheet.
  if (activeView === 'grid') {
    navigate('/my-timesheet', { replace: true });
    return null;
  }

  if (activeView === 'sheet' && sheetId) {
    return (
      <PayrollSheet
        sheetId={sheetId}
        onClose={() => navigate('/payroll')}
      />
    );
  }

  // activeView==='report' удалён 18.06.2026 — отчёт перенесён на /payments-report.
  // activeView==='grid' редиректит на /my-timesheet (TimesheetPage в mode='pm').
  return <PayrollList user={user} modal={modal} navigate={navigate} />;
}

/* ═══════════════════ Список ведомостей + табы статусов ═══════════════════ */

function PayrollList({ user, modal, navigate }) {
  const [tab,       setTab]       = useState('all');
  const [sheets,    setSheets]    = useState([]);
  const [works,     setWorks]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [q,         setQ]         = useState('');
  const dq = useDebounce(q, 300);  // G-11: debounce 300мс
  const [workFilter, setWorkFilter] = useState('');
  const [page,      setPage]      = useState(1);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      loadSheets({ status: tab, work_id: workFilter || undefined, limit: 2000 }),
      loadWorks()
    ])
      .then(([s, w]) => { setSheets(s); setWorks(w); })
      .catch((e) => toast.error('Не удалось загрузить ведомости: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [tab, workFilter]);

  useEffect(() => {
    const h = () => refresh();
    window.addEventListener('asgard:payroll:changed', h);
    return () => window.removeEventListener('asgard:payroll:changed', h);
    // eslint-disable-next-line
  }, [tab, workFilter]);

  /* PM видит только свои работы для фильтра */
  const myWorks = useMemo(() => {
    if (user.role === 'PM') {
      return works.filter((w) => w.pm_id === user.id || w.created_by === user.id);
    }
    return works;
  }, [works, user]);

  const filtered = useMemo(() => {
    if (!dq.trim()) return sheets;
    const lq = dq.trim().toLowerCase();
    return sheets.filter((s) =>
      (s.title || '').toLowerCase().includes(lq) ||
      (s.work_title || '').toLowerCase().includes(lq) ||
      (s.customer_name || '').toLowerCase().includes(lq) ||
      String(s.id).includes(lq)
    );
  }, [sheets, dq]);

  const counts = useMemo(() => ({
    all: sheets.length,
    pending: sheets.filter((s) => s.status === 'pending').length
  }), [sheets]);

  /* KPI */
  const kpi = useMemo(() => {
    const total_accrued = sheets.reduce((s, x) => s + Number(x.total_accrued || 0), 0);
    const total_payout  = sheets.reduce((s, x) => s + Number(x.total_payout || 0), 0);
    const total_paid    = sheets.filter((s) => s.status === 'paid').reduce((s, x) => s + Number(x.total_payout || 0), 0);
    return { total_accrued, total_payout, total_paid, pending: counts.pending };
  }, [sheets, counts.pending]);

  useEffect(() => { setPage(1); }, [tab, dq, workFilter]);
  const pages    = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice    = filtered.slice((safePage - 1) * PAGE, safePage * PAGE);

  const tabs = SHEET_STATUS_TABS.map((t) => ({
    id: t.id,
    label: t.label,
    count: t.id === 'all' ? counts.all : (t.id === 'pending' ? counts.pending : undefined)
  }));

  const onCreate = () => modal.open(
    <SheetCreateModal user={user} works={myWorks} onCreated={(id) => navigate(`/payroll-sheet?id=${id}`)} />,
    { size: 'wide' }
  );

  // onOpenGrid удалён 18.06.2026 — Excel-сетка теперь на /my-timesheet.

  const onOpenSheet = (s) => navigate(`/payroll-sheet?id=${s.id}`);

  const onExport = () => modal.open(<ExportModal defaultMode="payments" />);

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Финансы"
        title="Расчёты с рабочими"
        subtitle={`${filtered.length} ведом., из них ${kpi.pending} на согласовании`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={() => navigate('/my-timesheet')}>📋 Табель</Btn>
            <Btn variant="ghost" onClick={() => navigate('/payments-report')}>📊 Отчёт</Btn>
            <Btn variant="ghost" onClick={onExport}>📥 Excel</Btn>
            {canCreate(user.role) && <Btn variant="primary" onClick={onCreate}>＋ Новая ведомость</Btn>}
          </>
        }
      />

      {/* KPI */}
      <div className="grid-auto-170 gap-10">
        <KpiCell label="Ведомостей"   value={sheets.length} />
        <KpiCell label="Ожидают согл." value={kpi.pending} tone="amber" />
        <KpiCell label="К выплате"     value={fmtMoneyShort(kpi.total_payout) + ' ₽'} tone="gold" />
        <KpiCell label="Выплачено"     value={fmtMoneyShort(kpi.total_paid)   + ' ₽'} tone="ok" />
      </div>

      <TabsBar tabs={tabs} active={tab} onChange={setTab} />

      <div className="card pyr-search-bar">
        <div className="pyr-search-q">
          <SearchInput value={q} onChange={setQ} placeholder="Поиск по названию, заказчику, работе или ID" />
        </div>
        <div className="pyr-search-work">
          <SelectInput
            value={workFilter}
            onChange={setWorkFilter}
            options={[{ value: '', label: 'Все работы' }, ...myWorks.map((w) => ({ value: String(w.id), label: `#${w.id} · ${w.customer_name ? w.customer_name + ' — ' : ''}${w.work_title || ''}` }))]}
          />
        </div>
      </div>

      {loading ? (
        <div className="card card-loader">⏳ Грузим ведомости…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="💰"
          title="Нет ведомостей"
          hint={canCreate(user.role) ? 'Создайте первую ведомость на месяц.' : 'В этой выборке ничего нет.'}
          action={canCreate(user.role) ? <Btn variant="primary" onClick={onCreate}>＋ Новая ведомость</Btn> : null}
        />
      ) : (
        <>
          <div className="col gap-8">
            {slice.map((s) => (
              <SheetCard key={s.id} sheet={s} onOpen={() => onOpenSheet(s)} />
            ))}
          </div>

          {pages > 1 && (
            <div className="card pyr-pager">
              <Btn size="sm" variant="ghost" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹</Btn>
              <span className="fs-13 c-t3">{safePage} / {pages}</span>
              <Btn size="sm" variant="ghost" disabled={safePage >= pages} onClick={() => setPage(safePage + 1)}>›</Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SheetCard({ sheet, onOpen }) {
  const sMeta = statusMeta(sheet.status);
  const workLabel = sheet.work_title
    ? `${sheet.customer_name || ''}${sheet.customer_name && sheet.work_title ? ' — ' : ''}${sheet.work_title}`
    : 'Общая';
  return (
    <div
      className="card row-hover pyr-sheet-card"
      onClick={onOpen}
    >
      <div className="pyr-sheet-head-row">
        <div className="flex-1 min-w-0">
          <div className="fw-800 fs-15">{sheet.title || `Ведомость #${sheet.id}`}</div>
          <div className="fs-12 c-t3 mt-4">{workLabel}</div>
        </div>
        <div className="t-right">
          <StatusBadge tone={sMeta.tone} label={sMeta.label} />
          <div className="fs-11 c-t3 mt-4">{fmtDate(sheet.created_at)}</div>
        </div>
      </div>
      <div className="pyr-sheet-meta">
        <span>Период: <b className="c-t1">{fmtDate(sheet.period_from)} — {fmtDate(sheet.period_to)}</b></span>
        <span>Рабочих: <b className="c-t1">{sheet.workers_count || 0}</b></span>
        <span>Начислено: <b className="c-t1">{fmtMoney(sheet.total_accrued)}</b></span>
        <span className="c-gold">К выплате: <b>{fmtMoney(sheet.total_payout)}</b></span>
      </div>
    </div>
  );
}

function KpiCell({ label, value, tone }) {
  const c = tone === 'gold' ? 'c-gold' : tone === 'amber' ? 'c-amber' : tone === 'ok' ? 'c-ok' : tone === 'info' ? 'c-info' : 'c-t1';
  return (
    <div className="card pyr-kpi">
      <div className="pyr-kpi-label">{label}</div>
      <div className={`pyr-kpi-value ${c}`}>{value}</div>
    </div>
  );
}

/* Excel-сетка (вид) удалена 18.06.2026 — перенесена на /my-timesheet (Timesheet v2). */

/* Отчёт по выплатам (локальный) удалён 18.06.2026 — единый отчёт на /payments-report. */

/* ═══════════════════ Создание ведомости ═══════════════════ */

function SheetCreateModal({ _user, works, onCreated }) {
  const { close } = useModal();
  const [workId, setWorkId]   = useState('');
  const [from,   setFrom]     = useState('');
  const [to,     setTo]       = useState('');
  const [title,  setTitle]    = useState('');
  const [comment,setComment]  = useState('');
  const [busy,   setBusy]     = useState(false);

  /* Авто-период: 1-е число пред. месяца … последний день */
  useEffect(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const first = new Date(y, m - 1, 1);
    const last  = new Date(y, m, 0);
    setFrom(first.toISOString().slice(0, 10));
    setTo(last.toISOString().slice(0, 10));
  }, []);

  const workOpts = useMemo(
    () => [
      { value: '', label: '— Общая (без работы) —' },
      ...works.map((w) => ({ value: String(w.id), label: `#${w.id} · ${w.customer_name ? w.customer_name + ' — ' : ''}${w.work_title || ''}` }))
    ],
    [works]
  );

  const submit = async () => {
    if (!from || !to) { toast.warn('Укажите период'); return; }
    setBusy(true);
    try {
      const r = await createSheet({
        work_id: workId ? Number(workId) : null,
        title: title || null,
        period_from: from,
        period_to: to,
        comment: comment || null
      });
      toast.success('Ведомость создана');
      window.dispatchEvent(new CustomEvent('asgard:payroll:changed'));
      onCreated?.(r.sheet?.id);
      close();
    } catch (e) {
      toast.error(String(e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="＋" title="Новая ведомость" subtitle="Создать черновик для месяца/работы" accent="gold" onClose={close} />
      <MBody>
        <Field label="Работа">
          <SelectInput value={workId} onChange={setWorkId} options={workOpts} />
        </Field>
        <div className="m-grid-2 mt-10">
          <Field label="Период с" required>
            <DatePicker value={from} onChange={setFrom} />
          </Field>
          <Field label="Период по" required>
            <DatePicker value={to} onChange={setTo} />
          </Field>
        </div>
        <Field label="Название (опционально)" help="По умолчанию: «Ведомость <Месяц Год> — <Заказчик>»">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ведомость Июнь 2026 — Заказчик А"
            className="m-input"
          />
        </Field>
        <Field label="Комментарий">
          <TextareaInput value={comment} onChange={setComment} minRows={1} maxRows={3} placeholder="Опционально" />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? '…' : '＋ Создать'}</Btn>
      </MFoot>
    </MCard>
  );
}
