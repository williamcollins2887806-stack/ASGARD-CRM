/**
 * Страница /pm-balance — Баланс РП (наличные на руках).
 *
 * Источник: vanilla `public/assets/js/pm_balance.js` (478 строк, AsgardPmBalancePage).
 *
 *   ✅ pages/PmBalance/index.jsx                ← root + KPI + таблица + детали по клику
 *   ✅ pages/PmBalance/api.js                   ← endpoints + нормализация полей
 *   ✅ pages/PmBalance/PmBalanceDetailModal.jsx ← модалка с 5 секциями операций по РП
 *
 * Доступ: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, BUH (бэк проверяет requireRoles).
 *
 * Vanilla имела отдельный роут `/pm-balance/:pm_id`; мы открываем детали как модалку
 * (без отдельного URL) — функционально эквивалентно.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';

import { PmBalanceDetailModal } from './PmBalanceDetailModal';
import { loadPmBalanceList, rub, balanceTone, buildMonthOptions } from './api';

const ALLOWED_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'BUH'];

export default function PmBalancePage() {
  const { user } = useAuth();
  const modal = useModal();
  const role = user?.role;
  const hasAccess = ALLOWED_ROLES.includes(role);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState('');

  const refresh = () => {
    setLoading(true);
    loadPmBalanceList()
      .then((list) => setItems(Array.isArray(list) ? list : []))
      .catch((e) => toast('Ошибка', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (hasAccess) refresh(); }, [hasAccess]);

  // Фильтр по месяцу (клиентский — по last_activity если есть)
  const visible = useMemo(() => {
    if (!month) return items;
    return items.filter((pm) => {
      if (!pm.last_activity) return true; // без даты — всегда показываем
      return String(pm.last_activity).slice(0, 7) === month;
    });
  }, [items, month]);

  const totals = useMemo(() => ({
    cash_in: visible.reduce((s, p) => s + (p.cash_in || 0), 0),
    se_cash_in: visible.reduce((s, p) => s + (p.se_cash_in || 0), 0),
    cash_out: visible.reduce((s, p) => s + (p.cash_out || 0), 0),
    cash_returned: visible.reduce((s, p) => s + (p.cash_returned || 0), 0),
    balance: visible.reduce((s, p) => s + (p.balance || 0), 0),
    negative: visible.filter((p) => (p.balance || 0) < 0).length
  }), [visible]);

  if (!hasAccess) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 mb-12" style={{ opacity: 0.6 }}>🔒</div>
        <div className="fs-16 fw-700 mb-6">Доступ закрыт</div>
        <div className="c-t3">
          Раздел доступен только администратору, директорам (Ген/Комм) и бухгалтерии.
        </div>
      </div>
    );
  }

  const openDetail = (pm) => modal.open(
    <PmBalanceDetailModal pmId={pm.pm_id} pmName={pm.pm_name} />,
    { size: 'wide' }
  );

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Финансы"
        title="Баланс РП"
        subtitle="Сколько наличных на руках у каждого РП прямо сейчас"
        actions={
          <>
            <SelectInput
              value={month}
              onChange={setMonth}
              options={buildMonthOptions()}
            />
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
          </>
        }
      />

      {/* KPI-полоса */}
      {!loading && visible.length > 0 && (
        <div className="grid-auto-160f gap-10">
          <KpiBox label="Всего получено" value={rub(totals.cash_in + totals.se_cash_in)} tone="ok" />
          <KpiBox label="Потрачено" value={rub(totals.cash_out)} tone="warn" />
          <KpiBox label="На руках итого" value={rub(totals.balance)} tone={totals.balance >= 0 ? 'ok' : 'err'} />
          {totals.negative > 0 && (
            <KpiBox label="В минусе РП" value={String(totals.negative)} tone="err" />
          )}
        </div>
      )}

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем балансы…
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="💰"
          title="Нет данных по балансу РП"
          hint={month ? 'Попробуйте сбросить фильтр месяца.' : 'Данные появятся, когда РП начнут получать наличные.'}
          action={month ? <Btn variant="primary" onClick={() => setMonth('')}>Сбросить фильтр</Btn> : null}
        />
      ) : (
        <div className="card card-pad-overflow">
          <div className="ov-x-auto">
            <table className="t-list tbl-base">
              <thead>
                <tr className="bg-inner brd-row-2">
                  <Th>РП</Th>
                  <Th right>Получил из кассы</Th>
                  <Th right>Получил от СЗ</Th>
                  <Th right>Потратил</Th>
                  <Th right>Вернул</Th>
                  <Th right>На руках</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((pm) => {
                  const tone = balanceTone(pm.balance);
                  const color = tone === 'approved' ? 'var(--ok)' : tone === 'rejected' ? 'var(--err)' : 'var(--t-2)';
                  return (
                    <tr
                      key={pm.pm_id}
                      className="row-hover cur-p tbl-row-brd"
                      onClick={() => openDetail(pm)}
                      title={`Открыть детали по ${pm.pm_name}`}
                    >
                      <td className="pad-cell-lg fw-600">{pm.pm_name || '—'}</td>
                      <td className="pad-cell-lg t-right c-t2">{rub(pm.cash_in)}</td>
                      <td className="pad-cell-lg t-right c-t2">{rub(pm.se_cash_in)}</td>
                      <td className="pad-cell-lg t-right c-t2">{rub(pm.cash_out)}</td>
                      <td className="pad-cell-lg t-right c-t2">{rub(pm.cash_returned)}</td>
                      <td className="pad-cell-lg t-right fw-800 fs-14" style={{ color }}>{rub(pm.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-inner" style={{ borderTop: '2px solid var(--brd-1)' }}>
                  <td className="pad-cell-lg fw-800">Итого ({visible.length} РП)</td>
                  <td className="pad-cell-lg t-right fw-700">{rub(totals.cash_in)}</td>
                  <td className="pad-cell-lg t-right fw-700">{rub(totals.se_cash_in)}</td>
                  <td className="pad-cell-lg t-right fw-700">{rub(totals.cash_out)}</td>
                  <td className="pad-cell-lg t-right fw-700">{rub(totals.cash_returned)}</td>
                  <td className="pad-cell-lg t-right fw-800 fs-14" style={{ color: balanceTone(totals.balance) === 'approved' ? 'var(--ok)' : balanceTone(totals.balance) === 'rejected' ? 'var(--err)' : 'var(--t-1)' }}>{rub(totals.balance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, right }) {
  return (
    <th className={'pad-cell-lg c-t2 fs-13 fw-600 u-nowrap-cell ' + (right ? 't-right' : 't-left')}>
      {children}
    </th>
  );
}

function KpiBox({ label, value, tone }) {
  const cls = tone === 'ok' ? 'tone-ok'
    : tone === 'warn' ? 'tone-warn'
    : tone === 'err' ? 'tone-err'
    : 'tone-mute';
  return (
    <div className={'kpi-tile ' + cls}>
      <div className="kpi-tile-lbl">{label}</div>
      <div className="kpi-tile-val">{value}</div>
    </div>
  );
}
