/**
 * Страница /to-analytics — Хроники Тендерного Отдела.
 *
 * Источник: vanilla `public/assets/js/to_analytics.js` (~174 строки).
 *
 *   - Фильтр по году
 *   - KPI отдела (всего/выиграно/проиграно/в работе/сумма выигр./конверсия)
 *   - Таблица KPI по тендерным специалистам
 *   - Воронка по статусам (горизонтальные бары)
 *   - Бары "Динамика за 12 месяцев" (всего/выиграно)
 *
 * Endpoint: GET /api/tenders/analytics/team[?year=YYYY] → { department, team, byStatus, byMonth }
 */
import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { api } from '@/api/client';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SelectInput } from '@/inputs/Inputs';

const ALLOWED = ['ADMIN', 'HEAD_TO', 'DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];

function fmtMoney(n) {
  const x = Number(n) || 0;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(x) + ' ₽';
}

function pct(a, b) { return b ? Math.round((a / b) * 100) + '%' : '—'; }

export default function ToAnalyticsPage() {
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
    api(`/api/tenders/analytics/team${qs}`)
      .then(setData)
      .catch((e) => toast.error(`Не удалось загрузить аналитику: ${e?.message || e}`))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    if (!ALLOWED.includes(user.role)) {
      toast.error('Раздел доступен руководителю тендерного отдела');
      window.location.hash = '#/home';
      return;
    }
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, year]);

  if (!user || !ALLOWED.includes(user.role)) return null;

  const dept = data?.department || {};
  const team = data?.team || [];
  const byStatus = data?.byStatus || [];
  const byMonth = data?.byMonth || [];
  const total = Number(dept.total) || 0;
  const won = Number(dept.won) || 0;
  const lost = Number(dept.lost) || 0;
  const active = total - won - lost;

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Аналитика"
        title="Хроники Тендерного Отдела"
        subtitle="KPI, воронка и аналитика по каждому тендерному специалисту"
        actions={
          <>
            <div className="mw-140">
              <SelectInput value={year} onChange={setYear} options={yearOptions} />
            </div>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
          </>
        }
      />

      {loading ? (
        <div className="card card-loader">⏳ Загружаем аналитику…</div>
      ) : (
        <>
          {/* Departmental KPI */}
          <div className="grid-auto-170 gap-10">
            <KpiCard label="Всего тендеров" value={total} tone="default" />
            <KpiCard label="Выиграно" value={won} tone="ok" />
            <KpiCard label="Проиграно" value={lost} tone="err" />
            <KpiCard label="В работе" value={active} tone="amber" />
            <KpiCard label="Сумма выигр." value={fmtMoney(dept.won_sum)} tone="gold" isText />
            <KpiCard label="Конверсия" value={pct(won, total)} tone="info" isText />
          </div>

          {/* Team table */}
          <div className="section-card">
            <h3 className="m-0 mb-12 fs-16 fw-700">KPI по тендерным специалистам</h3>
            <TeamTable team={team} />
          </div>

          {/* Funnel by status */}
          <div className="section-card">
            <h3 className="m-0 mb-12 fs-16 fw-700">Воронка по статусам</h3>
            <StatusBars byStatus={byStatus} />
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
  const colorClass = {
    default: 'c-t1', ok: 'c-ok', info: 'c-info', amber: 'c-amber', err: 'c-err', gold: 'c-gold'
  }[tone] || 'c-t1';
  return (
    <div className="mini-kpi">
      <div className="mini-kpi-label">{label}</div>
      <div className={`${isText ? 'mini-kpi-value--text' : 'mini-kpi-value'} ${colorClass}`}>{value}</div>
    </div>
  );
}

function TeamTable({ team }) {
  if (!team || team.length === 0) {
    return (
      <EmptyState
        icon="👥"
        title="Нет данных по команде"
        hint="За выбранный год тендеров у специалистов ТО не найдено."
      />
    );
  }
  return (
    <div className="ov-x-auto">
      <table className="ta-table">
        <thead>
          <tr className="brd-2-b-row">
            <Th>Сотрудник</Th>
            <Th>Всего</Th>
            <Th>Выиграно</Th>
            <Th>Проиграно</Th>
            <Th>В работе</Th>
            <Th>Сумма выигр.</Th>
            <Th>Конверсия</Th>
          </tr>
        </thead>
        <tbody>
          {team.map((t, i) => {
            const total = Number(t.total_tenders) || 0;
            const won = Number(t.won) || 0;
            const lost = Number(t.lost) || 0;
            const active = Number(t.active) || 0;
            const conv = pct(won, total);
            return (
              <tr key={i} className="brd-2-b-row">
                <Td>
                  <div className="fw-700">{t.name || '—'}</div>
                  <div className="fs-11 c-t3">{t.role || ''}</div>
                </Td>
                <Td>{total}</Td>
                <Td><span className="c-ok fw-700">{won}</span></Td>
                <Td><span className="c-err">{lost}</span></Td>
                <Td><span className="c-amber">{active}</span></Td>
                <Td>{fmtMoney(t.won_sum)}</Td>
                <Td><b>{conv}</b></Td>
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

function StatusBars({ byStatus }) {
  if (!byStatus || byStatus.length === 0) {
    return (
      <EmptyState
        icon="📊"
        title="Воронка пуста"
        hint="За выбранный год нет тендеров по статусам."
      />
    );
  }
  const max = Math.max(...byStatus.map((s) => Number(s.count) || 0), 1);
  return (
    <div className="col gap-8">
      {byStatus.map((s, i) => {
        const c = Number(s.count) || 0;
        const w = Math.round((c / max) * 100);
        const status = s.tender_status || '—';
        const color = /выигр|согласи/i.test(status) ? 'var(--ok)'
          : /проигр|откаж/i.test(status) ? 'var(--err)'
          : 'var(--info)';
        return (
          <div key={i} className="lbv-row lbv-row-160">
            <div className="c-t2 ellipsis">{status}</div>
            <div className="progress-bar h-18">
              <div className="progress-bar-fill tr-bar" style={{ width: w + '%', background: color }} />
            </div>
            <div className="t-right">
              <b>{c}</b> · {fmtMoney(s.sum)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthBars({ byMonth }) {
  if (!byMonth || byMonth.length === 0) {
    return (
      <EmptyState
        icon="📈"
        title="Нет помесячных данных"
        hint="За выбранный период тендеры не подавались."
      />
    );
  }
  const max = Math.max(...byMonth.map((m) => Number(m.total) || 0), 1);
  return (
    <div className="col gap-8">
      {byMonth.map((m, i) => {
        const total = Number(m.total) || 0;
        const won = Number(m.won) || 0;
        const w = Math.round((total / max) * 100);
        const wonPct = total > 0 ? Math.round((won / total) * 100) : 0;
        return (
          <div key={i} className="lbv-row lbv-row-90">
            <div className="c-t2">{m.month}</div>
            <div className="progress-bar h-18">
              <div
                className="progress-bar-fill tr-bar"
                style={{ width: w + '%', background: `linear-gradient(90deg, var(--ok) 0%, var(--ok) ${wonPct}%, var(--info) ${wonPct}%, var(--info) 100%)` }}
              />
            </div>
            <div className="t-right">
              <b>{total}</b> ({won} выигр.)
            </div>
          </div>
        );
      })}
    </div>
  );
}
