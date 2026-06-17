/**
 * Страница /payroll-dashboard — Финансы персонала (общий обзор всех ведомостей).
 *
 * Источник: vanilla `public/assets/js/payroll_dashboard.js` (445 строк, AsgardPayrollDashboard).
 *
 *   ✅ index.jsx                       ← root + период + KPI + 3 секции
 *   ✅ api.js                          ← endpoints + helpers
 *   ✅ AgreementTransferModal.jsx      ← создание перевода по договорённости
 *   ✅ FinanceLimitsModal.jsx          ← редактирование лимитов СЗ
 *
 * 3 секции:
 *   1) Расчёт кассы (4 вкладки: все/самозанятые/официальные/наличка)
 *   2) Операции с самозанятыми за месяц (с фильтром work/agreement, кнопка «Наличные получены»)
 *   3) Годовые лимиты самозанятых (с прогресс-баром и редактированием лимитов)
 *
 * Доступ: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, BUH.
 * Переходы в детали:
 *   - клик «Самозанятые» → ссылка #/self-employed (уже в v2)
 *   - клик «Баланс РП»   → ссылка #/pm-balance     (уже в v2)
 *   - клик «Зарплата»    → ссылка #/payroll        (legacy)
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { Btn, Pill } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { TopActionsBar, TabsBar, EmptyState } from '@/blocks/Blocks';

import { AgreementTransferModal } from './AgreementTransferModal';
import { FinanceLimitsModal } from './FinanceLimitsModal';
import {
  ACCESS_ROLES, LIMIT_EDITORS,
  CASH_CALC_TABS, OPERATION_OPTIONS, OPERATION_TYPES,
  getSummary, getCashCalc, getSeTransfers, getSelfEmployedLimits,
  confirmReturn, cancelTransfer,
  fmtMoney, fmtPeriod, statusMeta, payTypeMeta, shiftPeriod
} from './api';
import '../Payroll/payroll.css';

function isDirRole(r) { return String(r || '').startsWith('DIRECTOR'); }

export default function PayrollDashboardPage() {
  const { user } = useAuth();
  const modal = useModal();
  const role = user?.role || '';
  const hasAccess = ACCESS_ROLES.includes(role) || isDirRole(role);
  const canEditLimits = LIMIT_EDITORS.includes(role);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [summary, setSummary] = useState(null);
  const [cashCalc, setCashCalc] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [limits, setLimits] = useState({ employees: [], yearly_limit: 2400000, monthly_limit: 350000 });
  const [loading, setLoading] = useState(true);

  const [ccTab, setCcTab] = useState('all');
  const [opType, setOpType] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const [s, cc, tr, lm] = await Promise.allSettled([
        getSummary(year, month),
        getCashCalc(year, month),
        getSeTransfers(year, month),
        getSelfEmployedLimits()
      ]);
      if (s.status === 'fulfilled')  setSummary(s.value); else { setSummary(null); toast.error('Сводка: ' + (s.reason?.message || '')); }
      if (cc.status === 'fulfilled') setCashCalc(cc.value); else { setCashCalc(null); toast.error('Расчёт кассы: ' + (cc.reason?.message || '')); }
      if (tr.status === 'fulfilled') setTransfers(tr.value); else { setTransfers([]); }
      if (lm.status === 'fulfilled') {
        const arr = lm.value.employees || lm.value.limits || [];
        const normalized = arr.map((w) => ({
          ...w,
          employee_id: w.employee_id ?? w.id,
          fio: w.fio || w.name || '—',
          transferred_year: Number(w.transferred_year ?? w.yearly_transferred ?? 0),
          yearly_limit: Number(w.yearly_limit ?? lm.value.yearly_limit ?? 2400000),
          remaining: Number(w.remaining ?? ((w.yearly_limit ?? lm.value.yearly_limit ?? 2400000) - (w.transferred_year ?? w.yearly_transferred ?? 0)))
        }));
        setLimits({
          employees: normalized,
          yearly_limit: Number(lm.value.yearly_limit || 2400000),
          monthly_limit: Number(lm.value.monthly_limit || 350000)
        });
      }
    } finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (hasAccess) refresh(); /* eslint-disable-next-line */ }, [hasAccess, year, month]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:payroll-dashboard:changed', onChanged);
    return () => window.removeEventListener('asgard:payroll-dashboard:changed', onChanged);
    // eslint-disable-next-line
  }, [year, month]);

  /* ─── Фильтр операций ─── */
  const visibleTransfers = useMemo(() => {
    if (!opType) return transfers;
    return transfers.filter((t) => t.operation_type === opType);
  }, [transfers, opType]);

  const transferSums = useMemo(() => ({
    transfer: visibleTransfers.reduce((s, t) => s + Number(t.transfer_amount || 0), 0),
    cash_return: visibleTransfers.reduce((s, t) => s + Number(t.cash_return_amount || 0), 0)
  }), [visibleTransfers]);

  /* ─── Расчёт кассы фильтр ─── */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ccItems = cashCalc?.items || [];
  const ccList = useMemo(
    () => ccTab === 'all' ? ccItems : ccItems.filter((i) => i.pay_type === ccTab),
    [ccItems, ccTab]
  );
  const ccTotals = useMemo(() => ccList.reduce((acc, i) => ({
    earned:      acc.earned + Number(i.earned || 0),
    transfer:    acc.transfer + Number(i.transfer || 0),
    cash_return: acc.cash_return + Number(i.cash_return || 0),
    cash_payout: acc.cash_payout + Number(i.cash_payout || 0)
  }), { earned: 0, transfer: 0, cash_return: 0, cash_payout: 0 }), [ccList]);
  const ccNetCash = ccTotals.cash_return - ccTotals.cash_payout;

  if (!hasAccess) {
    return (
      <div className="card pyd-access-locked">
        <div className="pyd-locked-icon">🔒</div>
        <div className="pyd-locked-title">Доступ закрыт</div>
        <div className="c-t3">Раздел доступен директорам и бухгалтерии.</div>
      </div>
    );
  }

  const monthOpts = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: fmtPeriod(year, i + 1)
  }));
  const yearOpts = [0, 1, 2].map((d) => ({ value: String(year - d), label: String(year - d) }));

  const openAgreement = () => modal.open(
    <AgreementTransferModal year={year} month={month} onDone={refresh} />,
    { size: 'wide' }
  );

  const openLimitsEditor = () => modal.open(
    <FinanceLimitsModal onDone={refresh} />,
    { size: 'wide' }
  );

  const onConfirmReturn = (t) => {
    modal.open(
      <ConfirmModal
        title="Подтвердить получение наличных?"
        message={`От ${t.fio || t.employee_name || '—'} · ${fmtMoney(t.cash_return_amount)}.`}
        tone="success"
        okText="✅ Подтвердить"
        onConfirm={async () => {
          try {
            await confirmReturn(t.id);
            toast.success('Возврат подтверждён');
            refresh();
          } catch (e) { toast.error(e?.message || 'Не удалось'); }
        }}
      />
    );
  };

  const onCancel = (t) => {
    modal.open(
      <ConfirmModal
        title="Отменить операцию?"
        message={`Перевод #${t.id} (${fmtMoney(t.transfer_amount)}) будет отменён.`}
        tone="danger"
        okText="Отменить"
        cancelText="Не отменять"
        onConfirm={async () => {
          try {
            await cancelTransfer(t.id);
            toast.success('Операция отменена');
            refresh();
          } catch (e) { toast.error(e?.message || 'Не удалось'); }
        }}
      />
    );
  };

  return (
    <div className="col gap-16">
      <TopActionsBar
        kicker="Финансы"
        title="Финансы персонала"
        subtitle={`Период: ${fmtPeriod(year, month)}`}
        actions={
          <>
            <Btn variant="ghost" onClick={() => { const p = shiftPeriod(year, month, -1); setYear(p.year); setMonth(p.month); }}>◀</Btn>
            <SelectInput value={String(month)} onChange={(v) => setMonth(Number(v))} options={monthOpts} placeholder="Месяц" />
            <SelectInput value={String(year)} onChange={(v) => setYear(Number(v))} options={yearOpts} placeholder="Год" />
            <Btn variant="ghost" onClick={() => { const p = shiftPeriod(year, month, +1); setYear(p.year); setMonth(p.month); }}>▶</Btn>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
          </>
        }
      />

      {/* KPI — переход к деталям через карточки и Link */}
      <div className="grid-auto-200 gap-10">
        <KpiBox label="Заработано всего" value={fmtMoney(summary?.total_earned)} tone="ok" />
        <KpiBox label="К переводу (СЗ)" value={fmtMoney(summary?.total_transfer)} tone="info" />
        <KpiBox label="Из кассы" value={fmtMoney(summary?.total_cash_needed)} tone="amber" />
        <KpiBox label="Возврат в кассу" value={fmtMoney(summary?.total_cash_return)} tone="gold" />
      </div>

      {/* Quick-навигация в детальные разделы */}
      <div className="card pyd-quick-card">
        <div className="pyd-quick-head">
          Перейти к ведомостям
        </div>
        <div className="grid-auto-220 gap-8">
          <QuickNav to="/self-employed"      icon="🤝" title="Самозанятые"        sub="Реестр НПД и выплаты" />
          <QuickNav to="/official-employees" icon="📑" title="Официально устроенные" sub="Оклад, статусы, отпуска" />
          <QuickNav to="/pm-balance"         icon="💼" title="Баланс РП"           sub="Наличные на руках" />
          <QuickNav to="/one-time-pay"       icon="💵" title="Разовые оплаты"      sub="Такси, топливо, питание" />
        </div>
      </div>

      {/* ─── 1. Расчёт кассы ─── */}
      <div className="card pyd-card">
        <div className="pyd-card-row">
          <h3 className="pyd-card-h3">Расчёт кассы</h3>
          {summary && (
            <Pill tone={summary.net_cash >= 0 ? 'ok' : 'err'}>
              Итого в кассе: {fmtMoney(summary.net_cash)}
            </Pill>
          )}
        </div>

        <TabsBar
          tabs={CASH_CALC_TABS.map((t) => ({
            id: t.id,
            label: t.label,
            count: t.id === 'all' ? ccItems.length : ccItems.filter((i) => i.pay_type === t.id).length
          }))}
          active={ccTab}
          onChange={setCcTab}
        />

        <div className="mt-10 pyd-overflow-x">
          {loading ? (
            <div className="pyd-loading">⏳ Загружаем…</div>
          ) : ccList.length === 0 ? (
            <EmptyState icon="📊" title="Нет данных за период" hint="Попробуйте сменить месяц или вкладку." action={null} />
          ) : (
            <table className="t-list pyd-table">
              <thead>
                <tr className="pyd-table-head-tr">
                  <Th>Рабочий</Th>
                  <Th>Тип оплаты</Th>
                  <Th right>Заработал</Th>
                  <Th right>Переводим</Th>
                  <Th right>Возврат в кассу</Th>
                  <Th right>Из кассы</Th>
                </tr>
              </thead>
              <tbody>
                {ccList.map((i) => {
                  const pt = payTypeMeta(i.pay_type);
                  return (
                    <tr key={`${i.employee_id}-${i.pay_type}`} className="pyd-row">
                      <td className="pyd-cell pyd-cell-fw6">{i.fio || '—'}</td>
                      <td className="pyd-cell"><StatusBadge tone={pt.tone} label={pt.label} /></td>
                      <td className="pyd-cell pyd-cell-r pyd-cell-mut">{fmtMoney(i.earned)}</td>
                      <td className="pyd-cell pyd-cell-r pyd-cell-fw7">{fmtMoney(i.transfer)}</td>
                      <td className={`pyd-cell pyd-cell-r ${i.cash_return ? 'c-gold' : 'c-t3'}`}>
                        {i.cash_return ? fmtMoney(i.cash_return) : '—'}
                      </td>
                      <td className={`pyd-cell pyd-cell-r pyd-cell-fw6 ${i.cash_payout ? 'c-amber' : 'c-t3'}`}>
                        {i.cash_payout ? fmtMoney(i.cash_payout) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="pyd-foot-tr">
                  <td className="pyd-cell" colSpan={2}>Итого</td>
                  <td className="pyd-cell pyd-cell-r">{fmtMoney(ccTotals.earned)}</td>
                  <td className="pyd-cell pyd-cell-r">{fmtMoney(ccTotals.transfer)}</td>
                  <td className="pyd-cell pyd-cell-r c-gold">{fmtMoney(ccTotals.cash_return)}</td>
                  <td className="pyd-cell pyd-cell-r c-amber">{fmtMoney(ccTotals.cash_payout)}</td>
                </tr>
                <tr className="pyd-foot-tot-row">
                  <td colSpan={6} className={`pyd-foot-tot-cell ${ccNetCash >= 0 ? 'c-ok' : 'c-err'}`}>
                    ИТОГО В КАССЕ (возврат − выдача): {fmtMoney(ccNetCash)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* ─── 2. Операции с самозанятыми ─── */}
      <div className="card pyd-card">
        <div className="pyd-card-row">
          <h3 className="pyd-card-h3">Операции с самозанятыми</h3>
          <div className="row gap-8">
            <div className="mw-200">
              <SelectInput value={opType} onChange={setOpType} options={OPERATION_OPTIONS} placeholder="Все операции" />
            </div>
            <Btn variant="primary" onClick={openAgreement}>+ По договорённости</Btn>
          </div>
        </div>

        <div className="pyd-overflow-x">
          {loading ? (
            <div className="pyd-loading">⏳ Загружаем…</div>
          ) : visibleTransfers.length === 0 ? (
            <EmptyState icon="🤝" title="Нет операций за период" hint="Создайте перевод по договорённости или подождите автоматического начисления." action={null} />
          ) : (
            <table className="t-list pyd-table">
              <thead>
                <tr className="pyd-table-head-tr">
                  <Th>ФИО</Th>
                  <Th>Тип</Th>
                  <Th right>Заработал</Th>
                  <Th right>Перевели</Th>
                  <Th right>Возврат</Th>
                  <Th>Статус</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {visibleTransfers.map((t) => {
                  const st = statusMeta(t.status);
                  const canConfirmReturn = t.status === 'transferred';
                  const canCancel = ['planned', 'transferred'].includes(t.status);
                  return (
                    <tr key={t.id} className="pyd-row">
                      <td className="pyd-cell pyd-cell-fw6">{t.fio || t.employee_name || '—'}</td>
                      <td className="pyd-cell pyd-cell-mut">{OPERATION_TYPES[t.operation_type] || t.operation_type}</td>
                      <td className="pyd-cell pyd-cell-r pyd-cell-mut">{fmtMoney(t.earned_amount)}</td>
                      <td className="pyd-cell pyd-cell-r pyd-cell-fw7">{fmtMoney(t.transfer_amount)}</td>
                      <td className="pyd-cell pyd-cell-r c-gold">{fmtMoney(t.cash_return_amount)}</td>
                      <td className="pyd-cell"><StatusBadge tone={st.tone} label={st.label} /></td>
                      <td className="pyd-cell pyd-cell-r">
                        <div className="pyd-action-row">
                          {canConfirmReturn && (
                            <Btn size="sm" variant="success" onClick={() => onConfirmReturn(t)}>✅ Наличные получены</Btn>
                          )}
                          {canCancel && (
                            <Btn size="sm" variant="ghost" onClick={() => onCancel(t)} title="Отменить операцию">✕</Btn>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {visibleTransfers.length > 0 && (
          <div className="pyd-tab-bar-totals">
            <span>Переводов: <b className="c-t1">{visibleTransfers.length}</b></span>
            <span>Сумма переводов: <b className="c-t1">{fmtMoney(transferSums.transfer)}</b></span>
            <span>Сумма возвратов: <b className="c-gold">{fmtMoney(transferSums.cash_return)}</b></span>
          </div>
        )}
      </div>

      {/* ─── 3. Годовые лимиты СЗ ─── */}
      <div className="card pyd-card">
        <div className="pyd-card-row">
          <div>
            <h3 className="pyd-card-h3">Годовые лимиты самозанятых</h3>
            <div className="pyd-card-sub">
              Месячный: {fmtMoney(limits.monthly_limit)} · Годовой: {fmtMoney(limits.yearly_limit)}
            </div>
          </div>
          {canEditLimits && (
            <Btn variant="ghost" onClick={openLimitsEditor}>⚙ Изменить лимиты</Btn>
          )}
        </div>

        <div className="pyd-overflow-x">
          {loading ? (
            <div className="pyd-loading">⏳ Загружаем…</div>
          ) : limits.employees.length === 0 ? (
            <EmptyState icon="🤝" title="Нет самозанятых" hint="Реестр пуст." action={null} />
          ) : (
            <table className="t-list pyd-table">
              <thead>
                <tr className="pyd-table-head-tr">
                  <Th>ФИО</Th>
                  <Th right>Переведено за год</Th>
                  <Th right>Годовой лимит</Th>
                  <Th right>Остаток</Th>
                  <Th>Прогресс</Th>
                </tr>
              </thead>
              <tbody>
                {limits.employees.map((w) => {
                  const pct = w.yearly_limit > 0
                    ? Math.min(100, Math.round((w.transferred_year / w.yearly_limit) * 100))
                    : 0;
                  const isLow = w.remaining < limits.monthly_limit * 2;
                  return (
                    <tr
                      key={w.employee_id}
                      className={`pyd-row ${isLow ? 'pyd-low-row' : ''}`}
                    >
                      <td className="pyd-cell pyd-cell-fw6">{w.fio}</td>
                      <td className="pyd-cell pyd-cell-r pyd-cell-mut">{fmtMoney(w.transferred_year)}</td>
                      <td className="pyd-cell pyd-cell-r pyd-cell-mut">{fmtMoney(w.yearly_limit)}</td>
                      <td className={`pyd-cell pyd-cell-r pyd-cell-fw7 ${isLow ? 'c-err' : 'c-ok'}`}>
                        {fmtMoney(w.remaining)}
                      </td>
                      <td className="pyd-cell mw-140">
                        <div className="pyd-bar">
                          <div
                            className={`pyd-bar-fill ${isLow ? 'bg-err' : 'bg-ok'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="pyd-bar-pct">{pct}%</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Th({ children, right }) {
  return (
    <th className={`pyd-th ${right ? 'pyd-th-r' : ''}`}>
      {children}
    </th>
  );
}

function KpiBox({ label, value, tone = 'default' }) {
  const bgClass = tone === 'ok' ? 'bg-ok'
    : tone === 'info' ? 'bg-info'
    : tone === 'amber' ? 'bg-orange'
    : tone === 'gold' ? 'bg-gold'
    : 'bg-inner';
  const fgClass = tone === 'ok' ? 'c-ok'
    : tone === 'info' ? 'c-info'
    : tone === 'amber' ? 'c-amber'
    : tone === 'gold' ? 'c-gold'
    : 'c-t1';
  return (
    <div className={`pyd-kpi-box ${bgClass}`}>
      <div className={`pyd-kpi-label ${fgClass}`}>{label}</div>
      <div className={`pyd-kpi-value ${fgClass}`}>{value}</div>
    </div>
  );
}

function QuickNav({ to, icon, title, sub }) {
  return (
    <Link
      to={to}
      className="pyd-quick-nav"
    >
      <span className="pyd-quick-nav-icon">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="pyd-quick-nav-title">{title}</div>
        <div className="pyd-quick-nav-sub">{sub}</div>
      </div>
      <span className="pyd-quick-nav-arrow">›</span>
    </Link>
  );
}
