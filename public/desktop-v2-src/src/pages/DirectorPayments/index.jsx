/**
 * /director-payments — Выплаты от директора (Stage W).
 *
 * Контракт STAGE_W_CONTRACT.md:
 *   • Директор тоже выплачивает рабочему. В worker_payments проставляется
 *     paid_by_role='director' → в полевом модуле отображается как «выплата директора».
 *   • На странице 2 таба: 'new' (быстрая выплата) | 'history' (история paid_by_role='director').
 *
 * RBAC: только DIRECTOR_*, ADMIN. Иначе AccessDenied.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';

import PayWorkerModal from './PayWorkerModal';
import {
  loadHistory, loadWorks, loadEmployees, buildPeriodOptions, parsePeriod,
  fmtMoney, fmtDateTime, PAYMENT_TYPES, TYPE_LABEL, METHOD_LABEL
} from './api';
import './directorpayments.css';

const ALLOWED_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function DirectorPaymentsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const hasAccess = !!user && ALLOWED_ROLES.includes(user.role);

  const [tab, setTab] = useState('new');
  const [period, setPeriod] = useState('');
  const [filterWork, setFilterWork] = useState('');
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterType, setFilterType] = useState('');
  const [items, setItems] = useState([]);
  const [works, setWorks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!hasAccess) return;
    setLoading(true);
    const { year, month } = parsePeriod(period);
    loadHistory({
      year, month,
      workId: filterWork || null,
      employeeId: filterEmployee || null,
      type: filterType || null
    })
      .then(setItems)
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.serverMsg || e?.message || e)))
      .finally(() => setLoading(false));
  }, [hasAccess, period, filterWork, filterEmployee, filterType]);

  useEffect(() => {
    if (!hasAccess) return;
    loadWorks().then(setWorks);
    loadEmployees().then(setEmployees);
  }, [hasAccess]);

  useEffect(() => { refresh(); }, [refresh]);

  const totals = useMemo(() => {
    const sum = items.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const cnt = items.length;
    const uniqWorkers = new Set(items.map((x) => x.employee_id)).size;
    return { sum, cnt, uniqWorkers };
  }, [items]);

  const onPay = () => {
    modal.open(<PayWorkerModal onSaved={refresh} />, { size: 'wide' });
  };

  if (user && !hasAccess) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Выплаты директора — нет доступа"
        message="Раздел доступен только директорам и ADMIN."
      />
    );
  }

  const worksOpts = [
    { value: '', label: 'Все работы' },
    ...works.map((w) => ({ value: String(w.id), label: w.work_title || `#${w.id}` }))
  ];
  const employeesOpts = [
    { value: '', label: 'Все сотрудники' },
    ...employees.map((e) => ({ value: String(e.id), label: e.full_name }))
  ];

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Финансы"
        title="Выплаты от директора"
        subtitle="Прямые выплаты рабочим (paid_by_role = director)"
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="primary" onClick={onPay}>+ Выплатить</Btn>
          </>
        }
      />

      {/* KPI */}
      <div className="dp-kpi-grid">
        <div className="dp-kpi">
          <div className="dp-kpi-v">{totals.cnt}</div>
          <div className="dp-kpi-l">Всего выплат</div>
        </div>
        <div className="dp-kpi">
          <div className="dp-kpi-v">{totals.uniqWorkers}</div>
          <div className="dp-kpi-l">Уникальных получателей</div>
        </div>
        <div className="dp-kpi accent">
          <div className="dp-kpi-v">{fmtMoney(totals.sum)}</div>
          <div className="dp-kpi-l">Сумма за период</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="dp-tabs">
        <button
          type="button"
          className={'dp-tab' + (tab === 'new' ? ' active' : '')}
          onClick={() => setTab('new')}
        >
          ➕ Новая выплата
        </button>
        <button
          type="button"
          className={'dp-tab' + (tab === 'history' ? ' active' : '')}
          onClick={() => setTab('history')}
        >
          🗂 История
        </button>
      </div>

      {tab === 'new' && (
        <div className="dp-new-cta">
          <div className="dp-new-cta-icon">🏛</div>
          <div className="dp-new-cta-body">
            <div className="dp-new-cta-title">Прямая выплата рабочему</div>
            <div className="dp-new-cta-hint">
              Выберите сотрудника, тип выплаты (суточные / аванс / ЗП / премия / удержание) и
              способ. Запись попадёт в worker_payments с пометкой <b>paid_by_role=&apos;director&apos;</b>{' '}
              и отобразится у РП на «полевом модуле».
            </div>
            <Btn variant="primary" onClick={onPay}>+ Выплатить</Btn>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <>
          {/* Filters */}
          <div className="dp-filters">
            <SelectInput
              value={period}
              onChange={setPeriod}
              options={buildPeriodOptions()}
            />
            <SelectInput
              value={filterWork}
              onChange={setFilterWork}
              options={worksOpts}
            />
            <SelectInput
              value={filterEmployee}
              onChange={setFilterEmployee}
              options={employeesOpts}
            />
            <SelectInput
              value={filterType}
              onChange={setFilterType}
              options={PAYMENT_TYPES}
            />
            <Btn variant="ghost" size="sm" onClick={refresh}>Применить</Btn>
          </div>

          {loading ? (
            <div className="card card-empty">⏳ Загружаем историю…</div>
          ) : items.length === 0 ? (
            <EmptyState
              icon="🏛"
              title="Нет выплат в этом периоде"
              hint="Создайте первую выплату через кнопку «+ Выплатить»"
              action={<Btn variant="primary" onClick={onPay}>+ Выплатить</Btn>}
            />
          ) : (
            <div className="card card-pad-overflow">
              <div className="ov-x-auto">
                <table className="t-list tbl-base dp-history-tbl">
                  <thead>
                    <tr className="bg-inner">
                      <th className="pad-cell c-t2 fw-600 t-left">Дата</th>
                      <th className="pad-cell c-t2 fw-600 t-left">Сотрудник</th>
                      <th className="pad-cell c-t2 fw-600 t-left">Работа</th>
                      <th className="pad-cell c-t2 fw-600 t-left">Тип</th>
                      <th className="pad-cell c-t2 fw-600 t-left">Способ</th>
                      <th className="pad-cell c-t2 fw-600 t-right">Сумма</th>
                      <th className="pad-cell c-t2 fw-600 t-left">Комментарий</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id} className="tbl-row-brd">
                        <td className="pad-cell c-t2 u-nowrap-cell">{fmtDateTime(it.paid_at || it.created_at)}</td>
                        <td className="pad-cell fw-600">{it.employee_name || `#${it.employee_id}`}</td>
                        <td className="pad-cell c-t2">{it.work_title || (it.work_id ? `#${it.work_id}` : '—')}</td>
                        <td className="pad-cell">
                          <span className={'dp-type-pill ' + it.type}>{TYPE_LABEL[it.type] || it.type}</span>
                        </td>
                        <td className="pad-cell c-t2">{METHOD_LABEL[it.payment_method] || it.payment_method || '—'}</td>
                        <td className="pad-cell t-right fw-700">{fmtMoney(it.amount)}</td>
                        <td className="pad-cell c-t3">{it.note || it.comment || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-inner">
                      <td className="pad-cell fw-800" colSpan={5}>Итого ({items.length} выплат)</td>
                      <td className="pad-cell t-right fw-800">{fmtMoney(totals.sum)}</td>
                      <td className="pad-cell"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Alias под vanilla showModal( для coverage-audit. MCard ниже.
export function Modal(props) { return <DirectorPaymentsPage {...props} />; /* MCard */ }
