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
  loadWorks, loadStats, loadPayments,
  fmtMoney, fmtMoneyShort, fmtDate, fmtDateTime,
  statusMeta, regStatusMeta, hasAccess, canCreate,
  SHEET_STATUS_TABS, MONTHS_RU,
  parseHashParams
} from './api';
import PayrollSheet from './PayrollSheet';
import PayrollGrid  from './PayrollGrid';
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
  if (activeView === 'grid') {
    return (
      <PayrollGridView
        onBack={() => navigate('/payroll')}
      />
    );
  }

  if (activeView === 'sheet' && sheetId) {
    return (
      <PayrollSheet
        sheetId={sheetId}
        onClose={() => navigate('/payroll')}
      />
    );
  }

  if (activeView === 'report') {
    return <PayrollReport onBack={() => navigate('/payroll')} />;
  }

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

  const onOpenGrid = () => navigate('/payroll?view=grid');

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
            <Btn variant="ghost" onClick={onOpenGrid}>📋 Ведомость-сетка</Btn>
            <Btn variant="ghost" onClick={() => navigate('/reports/payroll')}>📊 Отчёт</Btn>
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

/* ═══════════════════ Excel-сетка (вид) ═══════════════════ */

function PayrollGridView({ onBack }) {
  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Ведомость"
        title="📋 Ведомость-сетка"
        subtitle="Табель, баллы, суточные — вся ведомость на одном экране."
        actions={<Btn variant="ghost" onClick={onBack}>← К ведомостям</Btn>}
      />
      <PayrollGrid />
    </div>
  );
}

/* ═══════════════════ Отчёт по выплатам ═══════════════════ */

function PayrollReport({ onBack }) {
  const { user: _user } = useAuth();
  const modal = useModal();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [stats, setStats] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [payments, setPayments] = useState([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingPayments, setLoadingPayments] = useState(true);

  const refresh = async () => {
    setLoadingStats(true);
    setLoadingPayments(true);
    try {
      const s = await loadStats({ year });
      setStats(s);
    } catch (e) {
      toast.error('Не удалось загрузить статистику: ' + (e?.message || e));
      setStats(null);
    } finally { setLoadingStats(false); }

    try {
      const p = await loadPayments({
        status: statusFilter || undefined,
        payment_method: methodFilter || undefined,
        date_from: fromDate || undefined,
        date_to: toDate || undefined,
        limit: 1000
      });
      setPayments(p);
    } catch (e) {
      toast.error('Не удалось загрузить выплаты: ' + (e?.message || e));
      setPayments([]);
    } finally { setLoadingPayments(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [year, statusFilter, methodFilter, fromDate, toDate]);

  const yearOpts = [-2, -1, 0].map((d) => ({ value: String(now.getFullYear() + d), label: String(now.getFullYear() + d) }));
  const statusOpts = [
    { value: '',           label: 'Все статусы' },
    { value: 'pending',    label: 'Ожидает' },
    { value: 'processing', label: 'В работе' },
    { value: 'paid',       label: 'Оплачено' },
    { value: 'failed',     label: 'Ошибка' },
    { value: 'cancelled',  label: 'Отменено' }
  ];
  const methodOpts = [
    { value: '',         label: 'Все типы' },
    { value: 'salary',   label: '💰 Зарплата' },
    { value: 'one_time', label: '💸 Разовая' },
    { value: 'cash',     label: '💵 Наличные' },
    { value: 'card',     label: '💳 На карту' }
  ];

  const totals = useMemo(() => ({
    sum: payments.reduce((s, p) => s + Number(p.amount || 0), 0),
    paid: payments.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amount || 0), 0),
    pending: payments.filter((p) => p.status === 'pending' || p.status === 'processing').reduce((s, p) => s + Number(p.amount || 0), 0)
  }), [payments]);

  const onExport = () => modal.open(<ExportModal defaultMode="payments" />);

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Отчёты"
        title="📊 Отчёт по выплатам"
        subtitle={`${payments.length} операций в выборке · Σ ${fmtMoney(totals.sum)}`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={onExport}>📥 Excel</Btn>
            <Btn variant="ghost" onClick={onBack}>← К ведомостям</Btn>
          </>
        }
      />

      {/* Годовая статистика */}
      {!loadingStats && stats && (
        <>
          <div className="grid-auto-160 gap-10">
            <KpiCell label={`Начислено ${year}`} value={fmtMoneyShort(stats.total_accrued) + ' ₽'} />
            <KpiCell label="Выплачено" value={fmtMoneyShort(stats.total_paid) + ' ₽'} tone="ok" />
            <KpiCell label="Ожидают" value={fmtMoneyShort(stats.total_pending) + ' ₽'} tone="amber" />
            <KpiCell label="Ведомостей" value={stats.sheets_count} />
            <KpiCell label="Рабочих" value={stats.workers_count} />
            <KpiCell label="Ср. ставка" value={fmtMoney(stats.avg_day_rate) + '/д'} tone="info" />
          </div>

          {/* По месяцам + по работам (мини-чарты по строкам) */}
          {stats.by_month?.length > 0 && (
            <div className="card p-14">
              <h3 className="mt-0 fs-15">По месяцам</h3>
              <MonthBars data={stats.by_month} year={year} />
            </div>
          )}

          {stats.by_work?.length > 0 && (
            <div className="card p-14">
              <h3 className="mt-0 fs-15">Топ работ по ФОТ</h3>
              <div className="col gap-6">
                {stats.by_work.slice(0, 10).map((w) => (
                  <div key={w.work_id} className="pyr-work-row">
                    <span className="pyr-work-title">
                      {w.customer_name && <span className="c-t3">{w.customer_name} · </span>}
                      <b>{w.work_title || `Работа #${w.work_id}`}</b>
                    </span>
                    <span className="pyr-work-paid">{fmtMoney(w.paid)} / {fmtMoney(w.accrued)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.top_workers?.length > 0 && (
            <div className="card p-14">
              <h3 className="mt-0 fs-15">Топ рабочих по выплатам</h3>
              <div className="col gap-6">
                {stats.top_workers.slice(0, 10).map((w, i) => (
                  <div key={w.employee_id} className="pyr-work-row">
                    <span className="pyr-worker-rank">{i + 1}.</span>
                    <span className="pyr-worker-name"><b>{w.employee_name}</b></span>
                    <span className="pyr-worker-amt">{fmtMoney(w.total_earned)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Фильтры */}
      <div className="card pyr-rep-filter">
        <div className="mw-120">
          <Label>Год</Label>
          <SelectInput value={String(year)} onChange={(v) => setYear(Number(v))} options={yearOpts} />
        </div>
        <div className="mw-170">
          <Label>Статус</Label>
          <SelectInput value={statusFilter} onChange={setStatusFilter} options={statusOpts} />
        </div>
        <div className="mw-170">
          <Label>Тип выплаты</Label>
          <SelectInput value={methodFilter} onChange={setMethodFilter} options={methodOpts} />
        </div>
        <div className="mw-160">
          <Label>С даты</Label>
          <DatePicker value={fromDate} onChange={setFromDate} />
        </div>
        <div className="mw-160">
          <Label>По дату</Label>
          <DatePicker value={toDate} onChange={setToDate} />
        </div>
        <Btn variant="ghost" onClick={() => { setStatusFilter(''); setMethodFilter(''); setFromDate(''); setToDate(''); }}>↺ Сброс</Btn>
      </div>

      {/* Таблица выплат */}
      {loadingPayments ? (
        <div className="card card-loader">⏳ Грузим выплаты…</div>
      ) : payments.length === 0 ? (
        <EmptyState icon="📊" title="Нет выплат в выборке" hint="Измените фильтры или дату." />
      ) : (
        <div className="card p-0">
          <div className="pyr-rep-totals-row">
            <span>Всего: <b className="c-t1">{fmtMoney(totals.sum)}</b></span>
            <span className="c-ok">Оплачено: <b>{fmtMoney(totals.paid)}</b></span>
            <span className="c-amber">Ожидают: <b>{fmtMoney(totals.pending)}</b></span>
          </div>
          <div className="ov-x-auto">
            <table className="pyr-rep-table">
              <thead>
                <tr className="bg-inner">
                  <th className="pyr-rep-th">Дата</th>
                  <th className="pyr-rep-th pyr-rep-th--left">Ведомость</th>
                  <th className="pyr-rep-th pyr-rep-th--left">Рабочий</th>
                  <th className="pyr-rep-th">Тип</th>
                  <th className="pyr-rep-th pyr-rep-th--right">Сумма</th>
                  <th className="pyr-rep-th">Статус</th>
                </tr>
              </thead>
              <tbody>
                {payments.slice(0, 500).map((p) => {
                  const sM = regStatusMeta(p.status);
                  return (
                    <tr key={p.id} className="pyr-rep-row">
                      <td className="pyr-rep-td">{fmtDateTime(p.created_at)}</td>
                      <td className="pyr-rep-td pyr-rep-td--left">{p.sheet_title || (p.sheet_id ? `#${p.sheet_id}` : '—')}</td>
                      <td className="pyr-rep-td pyr-rep-td--left">{p.employee_name || `#${p.employee_id}`}</td>
                      <td className="pyr-rep-td">{p.payment_type || '—'}</td>
                      <td className="pyr-rep-td pyr-rep-td--rgold">{fmtMoney(p.amount)}</td>
                      <td className="pyr-rep-td"><StatusBadge tone={sM.tone} label={sM.label} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {payments.length > 500 && (
            <div className="pyr-rep-tail">
              Показано первые 500 из {payments.length}. Сузьте фильтры или скачайте Excel.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MonthBars({ data, year }) {
  const max = Math.max(1, ...data.map((m) => Number(m.accrued || 0)));
  return (
    <div className="col gap-6">
      {data.map((m) => {
        const month = Number(m.month);
        const accrued = Number(m.accrued || 0);
        const paid    = Number(m.paid || 0);
        const wA = (accrued / max) * 100;
        const wP = (accrued > 0 ? (paid / accrued) : 0) * wA;
        return (
          <div key={month} className="pyr-month-row">
            <span className="pyr-month-lbl">{MONTHS_RU[month - 1]} {year}</span>
            <div className="pyr-month-bar">
              <div className="pyr-month-fill-acc" style={{ width: wA + '%' }} />
              <div className="pyr-month-fill-paid" style={{ width: wP + '%' }} />
            </div>
            <span className="pyr-month-val-acc">{fmtMoney(accrued)}</span>
            <span className="pyr-month-val-paid">{fmtMoney(paid)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Label({ children }) {
  return <div className="pyr-label">{children}</div>;
}

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
