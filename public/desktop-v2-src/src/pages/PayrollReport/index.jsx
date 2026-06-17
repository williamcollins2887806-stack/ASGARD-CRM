/**
 * Страница /reports/payroll — PayrollReport (Отчёт по выплатам рабочим).
 *
 * 3 вкладки:
 *   1. «Сводный табель»     — /api/worker-payments/reports/payroll/:year/:month
 *   2. «ФОТ по объектам»    — /api/payroll-report/labor?period=YYYY-MM (сорт по сумме DESC)
 *   3. «Задолженности»      — /api/payroll-report/debts?period=YYYY-MM
 *
 * RBAC backend: ADMIN, DIRECTOR_*, BUH, HEAD_PM (как в worker-payments dirAuth).
 *
 * Источник паттерна табов: vanilla `public/assets/js/payments-report.js:112-116`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { TopActionsBar, LoadingCard } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { SelectInput } from '@/inputs/Inputs';
import {
  MONTH_NAMES, MONTH_FULL, STATUS_LABELS,
  fmtMoneyR,
  loadPayrollReport, loadLaborByObjects, loadDebts
} from './api';

const ALLOWED_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH', 'HEAD_PM'];

const TABS = [
  { key: 'payroll', label: 'Сводный табель' },
  { key: 'labor',   label: 'ФОТ по объектам' },
  { key: 'debts',   label: 'Задолженности' }
];

export default function PayrollReportPage() {
  const { user } = useAuth();
  const now = new Date();
  const [selMonth, setSelMonth] = useState(String(now.getMonth() + 1));
  const [selYear,  setSelYear]  = useState(String(now.getFullYear()));
  const [tab, setTab] = useState('payroll');

  const [payroll, setPayroll] = useState(null);
  const [labor,   setLabor]   = useState(null);
  const [debts,   setDebts]   = useState(null);

  const [loading, setLoading] = useState(true);

  // Загрузка всех трёх отчётов при смене периода
  useEffect(() => {
    if (user && !ALLOWED_ROLES.includes(user.role)) return;
    setLoading(true);
    const y = parseInt(selYear, 10);
    const m = parseInt(selMonth, 10);
    Promise.all([
      loadPayrollReport(y, m).catch(() => null),
      loadLaborByObjects(y, m).catch(() => null),
      loadDebts(y, m).catch(() => null)
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
        message="Раздел открыт директорам, бухгалтерии и руководителям групп РП."
      />
    );
  }

  const monthOpts = MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m }));
  const yearOpts  = [2024, 2025, 2026, 2027].map((y) => ({ value: String(y), label: String(y) }));

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Отчёты"
        title="Выплаты рабочим"
        subtitle={`Период: ${MONTH_FULL[parseInt(selMonth, 10) - 1]} ${selYear}`}
        actions={
          <>
            <div style={{ minWidth: 120 }}>
              <SelectInput value={selMonth} onChange={setSelMonth} options={monthOpts} placeholder="" />
            </div>
            <div style={{ minWidth: 100 }}>
              <SelectInput value={selYear}  onChange={setSelYear}  options={yearOpts}  placeholder="" />
            </div>
          </>
        }
      />

      {/* Вкладки — паттерн как в vanilla payments-report.js:112-116 */}
      <div className="blk-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={t.key === tab ? 'on' : ''}
            onClick={() => setTab(t.key)}
          >
            <span>{t.label}</span>
          </button>
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

/* ─── Вкладка 1: Сводный табель ─────────────────────────────────────── */
function PayrollTab({ payroll }) {
  const rows = payroll?.rows || [];
  const tot  = payroll?.totals || {};
  if (!rows.length) {
    return <div style={{ textAlign: 'center', padding: 32, color: 'var(--t-3)' }}>Нет данных за указанный период</div>;
  }

  const netTotal = (tot.salary || 0) + (tot.bonus || 0) - (tot.penalty || 0) + (tot.per_diem || 0) - (tot.advance || 0);
  return (
    <table className="pr-tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          <th style={th()}>Сотрудник</th>
          <th style={th()}>Объект</th>
          <th style={thNum()}>Баллы</th>
          <th style={thNum()}>ЗП</th>
          <th style={thNum()}>Суточные</th>
          <th style={thNum()}>Авансы</th>
          <th style={thNum()}>Премии</th>
          <th style={thNum()}>Удерж.</th>
          <th style={thNum(true)}>Итого</th>
          <th style={th()}>Статус</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const net = (parseFloat(r.salary) || 0) + (parseFloat(r.bonus) || 0)
                    - (parseFloat(r.penalty) || 0) + (parseFloat(r.per_diem) || 0) - (parseFloat(r.advance) || 0);
          return (
            <tr key={(r.employee_id || 'x') + '-' + (r.work_id || 'none') + '-' + i}>
              <td style={td()}>{r.employee_name}</td>
              <td style={td()}>{r.work_title || '—'}</td>
              <td style={tdNum()}>{r.points || 0}</td>
              <td style={tdNum()}>{fmtMoneyR(r.salary)}</td>
              <td style={tdNum()}>{fmtMoneyR(r.per_diem)}</td>
              <td style={tdNum()}>{fmtMoneyR(r.advance)}</td>
              <td style={tdNum()}>{fmtMoneyR(r.bonus)}</td>
              <td style={tdNum()}>{fmtMoneyR(r.penalty)}</td>
              <td style={tdNum(true)}>{fmtMoneyR(net)}</td>
              <td style={td()}>{STATUS_LABELS[r.payment_status] || r.payment_status || '—'}</td>
            </tr>
          );
        })}
        <tr style={{ fontWeight: 700, borderTop: '2px solid var(--brd)' }}>
          <td style={td()} colSpan={3}>ИТОГО</td>
          <td style={tdNum()}>{fmtMoneyR(tot.salary || 0)}</td>
          <td style={tdNum()}>{fmtMoneyR(tot.per_diem || 0)}</td>
          <td style={tdNum()}>{fmtMoneyR(tot.advance || 0)}</td>
          <td style={tdNum()}>{fmtMoneyR(tot.bonus || 0)}</td>
          <td style={tdNum()}>{fmtMoneyR(tot.penalty || 0)}</td>
          <td style={tdNum(true)}>{fmtMoneyR(netTotal)}</td>
          <td style={td()} />
        </tr>
      </tbody>
    </table>
  );
}

/* ─── Вкладка 2: ФОТ по объектам ─────────────────────────────────────
   GET /api/payroll-report/labor?period=YYYY-MM
   Поля: { rows: [{ work_id, work_title, days, fot }] }
   Сорт: по сумме ФОТ DESC (на клиенте, на случай если бэк не сортирует). */
function LaborTab({ labor }) {
  const rows = labor?.rows || labor?.items || [];
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => Number(b.fot || b.amount || 0) - Number(a.fot || a.amount || 0));
  }, [rows]);

  if (!sorted.length) {
    return <div style={{ textAlign: 'center', padding: 32, color: 'var(--t-3)' }}>Нет данных</div>;
  }

  let totFot = 0, totDays = 0;
  for (const r of sorted) {
    totFot  += Number(r.fot || r.amount || 0);
    totDays += Number(r.days || r.worker_days || 0);
  }

  return (
    <table className="pr-tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          <th style={th()}>Объект</th>
          <th style={thNum()}>Дней</th>
          <th style={thNum(true)}>Сумма ФОТ</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, i) => (
          <tr key={(r.work_id || 'none') + '-' + i}>
            <td style={td()}>{r.work_title || r.work_name || 'Без объекта'}</td>
            <td style={tdNum()}>{r.days || r.worker_days || 0}</td>
            <td style={tdNum(true)}>{fmtMoneyR(r.fot || r.amount || 0)}</td>
          </tr>
        ))}
        <tr style={{ fontWeight: 700, borderTop: '2px solid var(--brd)' }}>
          <td style={td()}>ИТОГО</td>
          <td style={tdNum()}>{totDays}</td>
          <td style={tdNum(true)}>{fmtMoneyR(totFot)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/* ─── Вкладка 3: Задолженности ───────────────────────────────────────
   GET /api/payroll-report/debts?period=YYYY-MM
   Поля: { rows: [{ employee_id, employee_name, work_id, work_title, amount, days }] } */
function DebtsTab({ debts }) {
  const rows = debts?.rows || debts?.items || [];
  if (!rows.length) {
    return <div style={{ textAlign: 'center', padding: 32, color: 'var(--t-3)' }}>Нет задолженностей</div>;
  }

  let totAmt = 0, totDays = 0;
  for (const r of rows) {
    totAmt  += Number(r.amount || r.debt || 0);
    totDays += Number(r.days || 0);
  }

  return (
    <table className="pr-tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          <th style={th()}>Сотрудник</th>
          <th style={th()}>Работа</th>
          <th style={thNum(true)}>Сумма к выплате</th>
          <th style={thNum()}>Дни</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={(r.employee_id || 'x') + '-' + (r.work_id || 'none') + '-' + i}>
            <td style={td()}>{r.employee_name || r.fio || '—'}</td>
            <td style={td()}>{r.work_title || r.work_name || '—'}</td>
            <td style={tdNum(true)}>{fmtMoneyR(r.amount || r.debt || 0)}</td>
            <td style={tdNum()}>{r.days || 0}</td>
          </tr>
        ))}
        <tr style={{ fontWeight: 700, borderTop: '2px solid var(--brd)' }}>
          <td style={td()} colSpan={2}>ИТОГО</td>
          <td style={tdNum(true)}>{fmtMoneyR(totAmt)}</td>
          <td style={tdNum()}>{totDays}</td>
        </tr>
      </tbody>
    </table>
  );
}

/* ─── Inline-стили: paritet с PaymentsReport css-классами ─────────── */
function th() {
  return { textAlign: 'left', padding: '8px 6px', borderBottom: '2px solid var(--brd)', fontSize: 10, textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 };
}
function thNum(bold) {
  return { ...th(), textAlign: 'right', ...(bold ? { color: 'var(--gold)' } : {}) };
}
function td() {
  return { padding: '7px 6px', borderBottom: '1px solid var(--brd-m)' };
}
function tdNum(bold) {
  return { ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...(bold ? { fontWeight: 700, color: 'var(--gold)' } : {}) };
}
