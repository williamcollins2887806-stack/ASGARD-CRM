/**
 * Страница /kpi-money — KPI по деньгам (выручка, маржа, рентабельность).
 *
 * Источник: vanilla `public/assets/js/kpi_money.js` (~601 строка).
 *
 * Что показываем:
 *  - KPI по РП: контракты, факт, маржа в %, прибыль
 *  - Динамика по месяцам (выручка / прибыль)
 *  - Топ работ по марже
 *
 * RBAC: ADMIN, HEAD_PM, BUH, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { api } from '@/api/client';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SelectInput } from '@/inputs/Inputs';
import './kpi-money.css';

const _ALLOWED = ['ADMIN', 'PM', 'HEAD_PM', 'BUH', 'OFFICE_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

function fmtMoney(n) {
  const x = Number(n) || 0;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(x) + ' ₽';
}
function shortMoney(n) {
  const x = Number(n) || 0;
  const abs = Math.abs(x);
  const sign = x < 0 ? '−' : '';
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1) + ' млрд ₽';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + ' млн ₽';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(0) + ' тыс ₽';
  return fmtMoney(x);
}
function marginPct(contract, fact) {
  const c = Number(contract) || 0;
  const f = Number(fact) || 0;
  if (c <= 0) return null;
  return ((c - f) / c) * 100;
}

export default function KpiMoneyPage() {
  const { user } = useAuth();
  const now = new Date();

  const [year, setYear] = useState(now.getFullYear());
  const [works, setWorks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // RBAC inline-литералы — синхронно с vanilla kpi_money.js (ADMIN/PM/OFFICE_MANAGER/BUH/DIRECTOR_*)
  const _allowed = ['ADMIN', 'PM', 'HEAD_PM', 'BUH', 'OFFICE_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      api('/api/works?limit=2000').then((d) => d?.works || d?.items || []).catch(() => []),
      api('/api/users?limit=500').then((d) => d?.users || []).catch(() => [])
    ])
      .then(([w, u]) => { setWorks(w); setUsers(u); })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    if (!_allowed) {
      toast.error('KPI по деньгам доступен руководству');
      window.location.hash = '#/home';
      return;
    }
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  const inYear = (w) => {
    const d = w.start_fact || w.start_plan || w.start_in_work_date || w.created_at;
    if (!d) return false;
    try { return new Date(d).getFullYear() === year; } catch { return false; }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const yearWorks = useMemo(() => works.filter(inYear), [works, year]);

  const dept = useMemo(() => {
    const contract = yearWorks.reduce((a, w) => a + (Number(w.contract_value) || 0), 0);
    const plan = yearWorks.reduce((a, w) => a + (Number(w.cost_plan) || 0), 0);
    const fact = yearWorks.reduce((a, w) => a + (Number(w.cost_fact) || 0), 0);
    const profitPlan = contract - plan;
    const profitFact = contract - fact;
    const mPct = marginPct(contract, fact);
    return { contract, plan, fact, profitPlan, profitFact, mPct };
  }, [yearWorks]);

  const byPm = useMemo(() => {
    const byId = new Map(users.map((u) => [u.id, u]));
    const m = new Map();
    for (const w of yearWorks) {
      if (!w.pm_id) continue;
      const key = w.pm_id;
      const e = m.get(key) || { pm: byId.get(key), contract: 0, plan: 0, fact: 0, works: 0 };
      e.contract += Number(w.contract_value) || 0;
      e.plan += Number(w.cost_plan) || 0;
      e.fact += Number(w.cost_fact) || 0;
      e.works += 1;
      m.set(key, e);
    }
    return Array.from(m.values())
      .filter((x) => x.pm)
      .map((x) => ({ ...x, profit: x.contract - x.fact, mPct: marginPct(x.contract, x.fact) }))
      .sort((a, b) => b.contract - a.contract);
  }, [yearWorks, users]);

  const byMonth = useMemo(() => {
    const arr = Array.from({ length: 12 }, () => ({ contract: 0, fact: 0, works: 0 }));
    for (const w of yearWorks) {
      const d = w.start_fact || w.start_plan || w.start_in_work_date || w.created_at;
      if (!d) continue;
      try {
        const dt = new Date(d);
        const m = dt.getMonth();
        arr[m].contract += Number(w.contract_value) || 0;
        arr[m].fact += Number(w.cost_fact) || 0;
        arr[m].works += 1;
      } catch { /* noop */ }
    }
    return arr;
  }, [yearWorks]);

  const topWorks = useMemo(() => {
    return yearWorks
      .map((w) => ({ w, profit: (Number(w.contract_value) || 0) - (Number(w.cost_fact) || 0), pct: marginPct(w.contract_value, w.cost_fact) }))
      .filter((x) => x.pct !== null)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10);
  }, [yearWorks]);

  if (user && !_allowed) return null;

  const yearOptions = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2, now.getFullYear() - 3]
    .map((y) => ({ value: String(y), label: String(y) }));

  return (
    <div className="km-wrap">
      <TopActionsBar
        kicker="Аналитика"
        title="Ярл • Аналитика Денег"
        subtitle={`${year} год · ${yearWorks.length} ${plural(yearWorks.length, ['работа', 'работы', 'работ'])}`}
        actions={
          <>
            <div className="km-year-sel">
              <SelectInput value={String(year)} onChange={(v) => setYear(Number(v))} options={yearOptions} />
            </div>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
          </>
        }
      />

      {loading ? (
        <div className="card km-loading">⏳ Считаем…</div>
      ) : (
        <>
          {/* Departmental KPI */}
          <div className="km-kpis">
            <Kpi label="Контракты" value={shortMoney(dept.contract)} tone="gold" isText />
            <Kpi label="План себест." value={shortMoney(dept.plan)} tone="info" isText />
            <Kpi label="Факт себест." value={shortMoney(dept.fact)} tone="amber" isText />
            <Kpi label="Прибыль факт" value={shortMoney(dept.profitFact)} tone={dept.profitFact >= 0 ? 'ok' : 'err'} isText />
            <Kpi label="Маржа" value={dept.mPct != null ? dept.mPct.toFixed(1) + ' %' : '—'} tone={dept.mPct != null && dept.mPct >= 15 ? 'ok' : 'err'} isText />
          </div>

          {/* By PM */}
          <div className="card km-section">
            <h3 className="km-section-title">💼 По РП</h3>
            {byPm.length === 0 ? (
              <EmptyState icon="📊" title="Нет данных за год" hint="Попробуйте сменить год" action={null} />
            ) : (
              <div className="km-table-scroll">
                <table className="km-table">
                  <thead>
                    <tr>
                      <Th>РП</Th>
                      <Th>Работ</Th>
                      <Th>Контракты</Th>
                      <Th>План</Th>
                      <Th>Факт</Th>
                      <Th>Прибыль</Th>
                      <Th>Маржа, %</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {byPm.map((x) => (
                      <tr key={x.pm.id}>
                        <Td>
                          <div className="km-pm-name">{x.pm.name || '—'}</div>
                          <div className="km-pm-role">{x.pm.role || ''}</div>
                        </Td>
                        <Td>{x.works}</Td>
                        <Td>{fmtMoney(x.contract)}</Td>
                        <Td>{fmtMoney(x.plan)}</Td>
                        <Td>{fmtMoney(x.fact)}</Td>
                        <Td>
                          <span
                            className="fw-700"
                            style={{ color: x.profit >= 0 ? 'var(--ok)' : 'var(--err)' }}
                          >
                            {fmtMoney(x.profit)}
                          </span>
                        </Td>
                        <Td>
                          <span
                            className="fw-700"
                            style={{ color: x.mPct == null ? 'var(--t-3)' : x.mPct >= 20 ? 'var(--ok)' : x.mPct >= 10 ? 'var(--amber)' : 'var(--err)' }}
                          >
                            {x.mPct == null ? '—' : x.mPct.toFixed(1) + ' %'}
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Monthly */}
          <div className="card km-section">
            <h3 className="km-section-title">📅 Динамика по месяцам</h3>
            <MonthlyChart byMonth={byMonth} />
          </div>

          {/* Top works */}
          <div className="card km-section">
            <h3 className="km-section-title">🏆 Топ работ по прибыли</h3>
            {topWorks.length === 0 ? (
              <div className="km-top-empty">Нет данных</div>
            ) : (
              <div className="km-top">
                {topWorks.map((x) => (
                  <div
                    key={x.w.id}
                    onClick={() => { window.location.hash = `#/pm-works?id=${x.w.id}`; }}
                    className="km-top-row"
                  >
                    <div>
                      <div className="km-top-title">{x.w.work_title || x.w.tender_title || '—'}</div>
                      <div className="km-top-sub">{x.w.customer_name || ''}</div>
                    </div>
                    <div className="km-top-contract">{fmtMoney(x.w.contract_value)}</div>
                    <div className="km-top-profit">
                      {fmtMoney(x.profit)}
                    </div>
                    <div
                      className="km-top-pct"
                      style={{ color: x.pct >= 20 ? 'var(--ok)' : x.pct >= 10 ? 'var(--amber)' : 'var(--err)' }}
                    >
                      {x.pct.toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, tone = 'default', isText = false }) {
  const colors = { default: 'var(--t-1)', ok: 'var(--ok)', err: 'var(--err)', info: 'var(--info)', amber: 'var(--amber)', gold: 'var(--gold)' };
  return (
    <div className="km-kpi">
      <div className="km-kpi-label">{label}</div>
      <div
        className={'km-kpi-value' + (isText ? ' km-kpi-value--text' : '')}
        style={{ color: colors[tone] }}
      >
        {value}
      </div>
    </div>
  );
}
function Th({ children }) {
  return <th className="km-th">{children}</th>;
}
function Td({ children }) {
  return <td className="km-td">{children}</td>;
}
function MonthlyChart({ byMonth }) {
  const max = Math.max(...byMonth.map((m) => m.contract), 1);
  return (
    <div className="km-month-list">
      {byMonth.map((m, i) => {
        if (!m.contract && !m.fact) return null;
        const profit = m.contract - m.fact;
        const w = (m.contract / max) * 100;
        return (
          <div key={i} className="km-month-row">
            <div className="km-month-label">{MONTHS[i]}</div>
            <div className="km-month-bar">
              <div className="km-month-bar-fill" style={{ width: w + '%' }} />
            </div>
            <div className="km-month-vals">
              <span className="km-month-contract">{shortMoney(m.contract)}</span>
              <span style={{ color: profit >= 0 ? 'var(--ok)' : 'var(--err)' }}>{shortMoney(profit)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
