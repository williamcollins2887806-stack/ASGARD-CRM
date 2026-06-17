/**
 * Страница /payments-report — Отчёты по выплатам рабочим (директор/бухгалтер).
 * Источник: vanilla `public/assets/js/payments-report.js` (287 LOC).
 *
 * Endpoints (src/routes/worker-payments.js):
 *   GET /api/worker-payments/reports/payroll/:year/:month         (line 769)
 *   GET /api/worker-payments/reports/labor-costs/:year/:month     (line 848)
 *   GET /api/worker-payments/reports/debts                        (line 915)
 *   GET /api/worker-payments/reports/payroll/:year/:month/export  (line 948) — XLSX
 *
 * RBAC backend: dirAuth = ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, BUH, HEAD_PM.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { TopActionsBar, LoadingCard } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { Btn, Field } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  MONTH_NAMES, STATUS_LABELS,
  fmtMoneyR,
  loadPayrollReport, loadLaborCosts, loadDebts,
  downloadPayrollExcel
} from './api';
import './payments-report.css';

// RBAC inline-литералы (для скрипта rbac-audit).
const ALLOWED_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH', 'HEAD_PM'];

const TABS = [
  { key: 'payroll', label: 'Табель' },
  { key: 'labor',   label: 'ФОТ по объектам' },
  { key: 'debts',   label: 'Задолженности' }
];

export default function PaymentsReportPage() {
  const { user } = useAuth();
  const now = new Date();
  const [selMonth, setSelMonth] = useState(String(now.getMonth() + 1));
  const [selYear,  setSelYear]  = useState(String(now.getFullYear()));
  const [tab, setTab] = useState('payroll');

  const [payroll, setPayroll] = useState(null);
  const [labor,   setLabor]   = useState(null);
  const [debts,   setDebts]   = useState(null);

  const [loading, setLoading] = useState(true);
  const [busyExcel, setBusyExcel] = useState(false);

  // Грузим всё параллельно при смене периода
  useEffect(() => {
    if (user && !ALLOWED_ROLES.includes(user.role)) return;
    setLoading(true);
    const y = parseInt(selYear, 10);
    const m = parseInt(selMonth, 10);
    Promise.all([
      loadPayrollReport(y, m).catch(() => null),
      loadLaborCosts(y, m).catch(() => null),
      loadDebts().catch(() => null)
    ])
      .then(([p, l, d]) => { setPayroll(p); setLabor(l); setDebts(d); })
      .finally(() => setLoading(false));
  }, [selYear, selMonth, user?.role]);

  if (user && !ALLOWED_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Отчёт по выплатам недоступен"
        message="Раздел открыт директорам, бухгалтерии и HEAD_PM."
      />
    );
  }

  const monthOpts = MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m }));
  const yearOpts  = [2024, 2025, 2026, 2027].map((y) => ({ value: String(y), label: String(y) }));

  const onExcel = async () => {
    setBusyExcel(true);
    try {
      await downloadPayrollExcel(parseInt(selYear, 10), parseInt(selMonth, 10));
      toast.success('Excel сохранён');
    } catch (e) {
      toast.error('Не удалось скачать: ' + (e?.message || e));
    } finally {
      setBusyExcel(false);
    }
  };

  const tot = payroll?.totals || {};

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Отчёты"
        title="Выплаты рабочим"
        subtitle={`Период: ${MONTH_NAMES[parseInt(selMonth, 10) - 1]} ${selYear}`}
        actions={
          <>
            <div className="pr-filter-w">
              <SelectInput value={selMonth} onChange={setSelMonth} options={monthOpts} placeholder="" />
            </div>
            <div className="pr-filter-w">
              <SelectInput value={selYear}  onChange={setSelYear}  options={yearOpts}  placeholder="" />
            </div>
            <Btn variant="ghost" onClick={onExcel} disabled={busyExcel}>
              {busyExcel ? '⏳ Excel…' : '📊 Excel'}
            </Btn>
          </>
        }
      />

      {/* KPI strip */}
      <div className="pr-kpi">
        <div className="pr-kpi-card">
          <div className="pr-kpi-label">ФОТ</div>
          <div className="pr-kpi-val">{fmtMoneyR(tot.fot || 0)}</div>
        </div>
        <div className="pr-kpi-card">
          <div className="pr-kpi-label">Налоги</div>
          <div className="pr-kpi-val err">{fmtMoneyR(tot.tax || 0)}</div>
        </div>
        <div className="pr-kpi-card">
          <div className="pr-kpi-label">Полный ФОТ</div>
          <div className="pr-kpi-val info">{fmtMoneyR((tot.fot || 0) + (tot.tax || 0))}</div>
        </div>
        <div className="pr-kpi-card">
          <div className="pr-kpi-label">Суточные</div>
          <div className="pr-kpi-val">{fmtMoneyR(tot.per_diem || 0)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="pr-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={'pr-tab ' + (t.key === tab ? 'active' : '')}
            onClick={() => setTab(t.key)}
          >{t.label}</button>
        ))}
      </div>

      <div className="card p-16">
        {loading ? <LoadingCard text="Загружаем отчёт…" />
          : tab === 'payroll' ? <PayrollTab payroll={payroll} />
          : tab === 'labor'   ? <LaborTab   labor={labor} />
          : <DebtsTab debts={debts} />}
      </div>
    </div>
  );
}

/* ─── Tab 1: Табель ──────────────────────────────────────────────────── */
function PayrollTab({ payroll }) {
  const rows = payroll?.rows || [];
  const tot  = payroll?.totals || {};
  if (!rows.length) return <div className="pr-empty">Нет данных за указанный период</div>;

  const netTotal = (tot.salary || 0) + (tot.bonus || 0) - (tot.penalty || 0) + (tot.per_diem || 0) - (tot.advance || 0);
  return (
    <table className="pr-tbl">
      <thead>
        <tr>
          <th>Сотрудник</th>
          <th>Объект</th>
          <th className="num">Баллы</th>
          <th className="num">ЗП</th>
          <th className="num">Суточные</th>
          <th className="num">Авансы</th>
          <th className="num">Премии</th>
          <th className="num">Удерж.</th>
          <th className="num bold gold">Итого</th>
          <th>Статус</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const net = (parseFloat(r.salary) || 0) + (parseFloat(r.bonus) || 0)
                    - (parseFloat(r.penalty) || 0) + (parseFloat(r.per_diem) || 0) - (parseFloat(r.advance) || 0);
          return (
            <tr key={r.employee_id + '-' + (r.work_id || 'none') + '-' + i}>
              <td>{r.employee_name}</td>
              <td>{r.work_title || '—'}</td>
              <td className="num">{r.points || 0}</td>
              <td className="num">{fmtMoneyR(r.salary)}</td>
              <td className="num">{fmtMoneyR(r.per_diem)}</td>
              <td className="num">{fmtMoneyR(r.advance)}</td>
              <td className="num">{fmtMoneyR(r.bonus)}</td>
              <td className="num">{fmtMoneyR(r.penalty)}</td>
              <td className="num bold gold">{fmtMoneyR(net)}</td>
              <td>{STATUS_LABELS[r.payment_status] || r.payment_status || '—'}</td>
            </tr>
          );
        })}
        <tr className="totals-row">
          <td colSpan={3}>ИТОГО</td>
          <td className="num">{fmtMoneyR(tot.salary || 0)}</td>
          <td className="num">{fmtMoneyR(tot.per_diem || 0)}</td>
          <td className="num">{fmtMoneyR(tot.advance || 0)}</td>
          <td className="num">{fmtMoneyR(tot.bonus || 0)}</td>
          <td className="num">{fmtMoneyR(tot.penalty || 0)}</td>
          <td className="num bold gold">{fmtMoneyR(netTotal)}</td>
          <td />
        </tr>
      </tbody>
    </table>
  );
}

/* ─── Tab 2: ФОТ по объектам ─────────────────────────────────────────── */
function LaborTab({ labor }) {
  const rows = labor?.rows || [];
  if (!rows.length) return <div className="pr-empty">Нет данных</div>;

  let totFot = 0, totTax = 0, totPd = 0, totFull = 0, totWorkers = 0;
  for (const r of rows) {
    totFot += parseFloat(r.fot) || 0;
    totTax += parseFloat(r.tax) || 0;
    totPd  += parseFloat(r.per_diem) || 0;
    totFull+= parseFloat(r.full_cost) || 0;
    totWorkers += parseInt(r.worker_count, 10) || 0;
  }

  return (
    <table className="pr-tbl">
      <thead>
        <tr>
          <th>Объект</th>
          <th className="num">Рабочих</th>
          <th className="num">ФОТ</th>
          <th className="num">Налоги</th>
          <th className="num">Суточные</th>
          <th className="num bold gold">Полная стоимость</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={(r.work_id || 'none') + '-' + i}>
            <td>{r.work_title || 'Без объекта'}</td>
            <td className="num">{r.worker_count}</td>
            <td className="num">{fmtMoneyR(r.fot)}</td>
            <td className="num">{fmtMoneyR(r.tax)}</td>
            <td className="num">{fmtMoneyR(r.per_diem)}</td>
            <td className="num bold gold">{fmtMoneyR(r.full_cost)}</td>
          </tr>
        ))}
        <tr className="totals-row">
          <td>ИТОГО</td>
          <td className="num">{totWorkers}</td>
          <td className="num">{fmtMoneyR(totFot)}</td>
          <td className="num">{fmtMoneyR(totTax)}</td>
          <td className="num">{fmtMoneyR(totPd)}</td>
          <td className="num bold gold">{fmtMoneyR(totFull)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/* ─── Tab 3: Задолженности ───────────────────────────────────────────── */
function DebtsTab({ debts }) {
  const rows = debts?.rows || [];
  if (!rows.length) return <div className="pr-empty">Нет задолженностей</div>;

  return (
    <table className="pr-tbl">
      <thead>
        <tr>
          <th>Сотрудник</th>
          <th className="num">Заработано</th>
          <th className="num">Удержано</th>
          <th className="num">Выплачено</th>
          <th className="num bold gold">Долг</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.employee_id + '-' + i}>
            <td>{r.employee_name}</td>
            <td className="num">{fmtMoneyR(r.earned)}</td>
            <td className="num">{fmtMoneyR(r.deductions)}</td>
            <td className="num">{fmtMoneyR(r.paid)}</td>
            <td className="num bold gold">{fmtMoneyR(r.debt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
