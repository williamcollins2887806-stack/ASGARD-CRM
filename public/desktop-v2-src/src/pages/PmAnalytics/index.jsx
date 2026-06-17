/**
 * Страница /pm-analytics — Хроники Руководителей Проектов.
 *
 * Источник: vanilla `public/assets/js/pm_analytics.js` (~154 строки).
 *
 *   - Фильтр по году
 *   - KPI отдела (всего/активные/завершено/просрочено/сумма контрактов/прибыль)
 *   - Таблица KPI по руководителям проектов
 *   - Горизонтальные бары "Динамика за 12 месяцев" (контракты)
 *
 * Endpoint: GET /api/works/analytics/team[?year=YYYY] → { department, team, byMonth }
 */
import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { api } from '@/api/client';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SelectInput } from '@/inputs/Inputs';

const ALLOWED = ['ADMIN', 'HEAD_PM', 'DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];

function fmtMoney(n) {
  const x = Number(n) || 0;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(x) + ' ₽';
}

function _pct(a, b) { return b ? Math.round((a / b) * 100) + '%' : '—'; }

export default function PmAnalyticsPage() {
  const { user } = useAuth();
  const now = new Date();
  const yNow = now.getFullYear();

  const [year, setYear] = useState(String(yNow));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const yearOptions = useMemo(() => (
    [{ value: '', label: 'Все годы' }].concat([yNow, yNow - 1, yNow - 2].map((y) => ({ value: String(y), label: String(y) })))
  ), [yNow]);

  const refresh = () => {
    setLoading(true);
    const qs = year ? `?year=${year}` : '';
    api(`/api/works/analytics/team${qs}`)
      .then(setData)
      .catch((e) => toast.error(`Не удалось загрузить аналитику: ${e?.message || e}`))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    if (!ALLOWED.includes(user.role)) {
      toast.error('Раздел доступен руководителю технического отдела');
      window.location.hash = '#/home';
      return;
    }
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, year]);

  if (!user || !ALLOWED.includes(user.role)) return null;

  const dept = data?.department || {};
  const team = data?.team || [];
  const byMonth = data?.byMonth || [];

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Аналитика"
        title="Хроники Руководителей Проектов"
        subtitle="KPI, загрузка и аналитика по каждому РП"
        actions={
          <>
            <div className="min-w-140">
              <SelectInput value={year} onChange={setYear} options={yearOptions} />
            </div>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
          </>
        }
      />

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем аналитику…</div>
      ) : (
        <>
          {/* Departmental KPI */}
          <div className="grid-auto-170 gap-10">
            <KpiCard label="Всего работ" value={Number(dept.total) || 0} tone="default" />
            <KpiCard label="Активных" value={Number(dept.active) || 0} tone="info" />
            <KpiCard label="Завершено" value={Number(dept.completed) || 0} tone="ok" />
            <KpiCard label="Просрочено" value={Number(dept.overdue) || 0} tone="err" />
            <KpiCard label="Сумма контрактов" value={fmtMoney(dept.total_contract)} tone="gold" isText />
            <KpiCard label="Общая прибыль" value={fmtMoney(dept.total_profit)} tone="ok" isText />
          </div>

          {/* Team table */}
          <div className="section-card">
            <h3 className="m-0 mb-12 fs-16 fw-700">KPI по руководителям проектов</h3>
            <TeamTable team={team} />
          </div>

          {/* Monthly */}
          <div className="section-card">
            <h3 className="m-0 mb-12 fs-16 fw-700">Динамика за 12 месяцев</h3>
            <MonthBars byMonth={byMonth} />
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, tone = 'default', isText = false }) {
  const colors = { default: 'var(--t-1)', ok: 'var(--ok)', info: 'var(--info)', amber: 'var(--amber)', err: 'var(--err)', gold: 'var(--gold)' };
  return (
    <div className="bg-inner r-md p-14">
      <div className="mini-kpi-label">{label}</div>
      <div className={(isText ? 'mini-kpi-value--text' : 'mini-kpi-value')} style={{ color: colors[tone] }}>{value}</div>
    </div>
  );
}

function TeamTable({ team }) {
  if (!team || team.length === 0) {
    return (
      <EmptyState
        icon="👥"
        title="Нет данных по РП"
        hint="За выбранный год работ у руководителей проектов не найдено."
      />
    );
  }
  return (
    <div className="ov-x-auto">
      <table className="ta-table">
        <thead>
          <tr className="brd-2-b-row">
            <Th>РП</Th>
            <Th>Всего работ</Th>
            <Th>Активных</Th>
            <Th>Завершено</Th>
            <Th>Просрочено</Th>
            <Th>Контракты</Th>
            <Th>Прибыль</Th>
          </tr>
        </thead>
        <tbody>
          {team.map((t, i) => {
            const total = Number(t.total_works) || 0;
            const active = Number(t.active) || 0;
            const completed = Number(t.completed) || 0;
            const overdue = Number(t.overdue) || 0;
            const profit = Number(t.profit) || 0;
            return (
              <tr key={i} className="brd-2-b-row">
                <Td>
                  <div className="fw-700">{t.name || '—'}</div>
                  <div className="fs-11 c-t3">{t.role || ''}</div>
                </Td>
                <Td>{total}</Td>
                <Td><span className="c-info">{active}</span></Td>
                <Td><span className="c-ok fw-700">{completed}</span></Td>
                <Td><span style={{ color: overdue ? 'var(--err)' : 'var(--t-2)' }}>{overdue}</span></Td>
                <Td>{fmtMoney(t.total_contract)}</Td>
                <Td><span className="fw-700" style={{ color: profit >= 0 ? 'var(--ok)' : 'var(--err)' }}>{fmtMoney(profit)}</span></Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }) {
  return <th className="tab-th">{children}</th>;
}
function Td({ children }) {
  return <td className="tab-td">{children}</td>;
}

function MonthBars({ byMonth }) {
  if (!byMonth || byMonth.length === 0) {
    return (
      <EmptyState
        icon="📈"
        title="Нет помесячных данных"
        hint="За выбранный период работы не запускались."
      />
    );
  }
  const max = Math.max(...byMonth.map((m) => Number(m.total_contract) || 0), 1);
  return (
    <div className="col gap-8">
      {byMonth.map((m, i) => {
        const total = Number(m.total) || 0;
        const completed = Number(m.completed) || 0;
        const contractSum = Number(m.total_contract) || 0;
        const w = Math.round((contractSum / max) * 100);
        const completePct = total > 0 ? Math.round((completed / total) * 100) : 0;
        return (
          <div key={i} className="lbv-row lbv-row-90-220">
            <div className="c-t2">{m.month}</div>
            <div className="progress-18">
              <div className="tr-bar" style={{ width: w + '%', height: '100%', background: `linear-gradient(90deg, var(--ok) 0%, var(--ok) ${completePct}%, var(--info) ${completePct}%, var(--info) 100%)` }} />
            </div>
            <div className="t-right">
              <b>{total}</b> работ · {fmtMoney(contractSum)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
