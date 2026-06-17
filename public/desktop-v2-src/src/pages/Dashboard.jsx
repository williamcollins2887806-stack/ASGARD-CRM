import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import StackedBar from '@/components/StackedBar';

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const WON = ['Выиграли'];
const LOST = ['Проиграли'];
const DONE_SET = new Set([
  'Закрыт', 'Закрыта', 'Закрыто', 'Работы сдали',
  'Завершена', 'Завершено', 'Завершен', 'Завершён',
  'Сдан', 'Сдана', 'Сдано',
  'Отменена', 'Отменено', 'Отменён', 'Отменен', 'Отмена'
].map((s) => s.trim().toLowerCase()));
const isDone = (s) => DONE_SET.has(String(s || '').trim().toLowerCase());

function money(n) {
  return (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
}
function shortMoney(n) {
  const x = Number(n) || 0;
  const abs = Math.abs(x);
  const sign = x < 0 ? '−' : '';
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1) + ' млрд ₽';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + ' млн ₽';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(0) + ' тыс ₽';
  return money(x);
}
function pct(a, b) {
  if (!b) return '—';
  return Math.round((a / b) * 100) + '%';
}

function tenderMatchesYear(t, year) {
  if (Number(t.year) === year) return true;
  if (t.period && String(t.period).startsWith(String(year))) return true;
  return false;
}

/* ─── CSV export helpers ─── */
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return '﻿' + lines.join('\r\n');
}
function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function fmtCsvDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('ru-RU');
}
function fmtCsvMoney(n) {
  return (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

export default function Dashboard() {
  const now = useMemo(() => new Date(), []);
  const year = now.getFullYear();
  const month = now.getMonth();

  const [data, setData] = useState({ tenders: [], works: [], users: [], workExpenses: [], officeExpenses: [], travelExpenses: [], callDash: null });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      api('/api/tenders?limit=2000', { signal: ctrl.signal }).then((d) => d.tenders || []).catch(() => []),
      api('/api/works?limit=2000', { signal: ctrl.signal }).then((d) => d.works || d.items || []).catch(() => []),
      api('/api/users?limit=500', { signal: ctrl.signal }).then((d) => d.users || d.items || []).catch(() => []),
      api('/api/expenses/work?year=' + year, { signal: ctrl.signal }).then((d) => d.items || d.expenses || []).catch(() => []),
      api('/api/expenses/office?year=' + year, { signal: ctrl.signal }).then((d) => d.items || d.expenses || []).catch(() => []),
      api('/api/expenses/travel?year=' + year, { signal: ctrl.signal }).then((d) => d.items || d.expenses || []).catch(() => []),
      api('/api/call-reports/dashboard', { signal: ctrl.signal }).catch(() => null)
    ])
      .then(([tenders, works, users, workExp, officeExp, travelExp, callDash]) => {
        setData({ tenders, works, users, workExpenses: workExp, officeExpenses: officeExp, travelExpenses: travelExp, callDash });
        setLoading(false);
      })
      .catch((e) => { setErr(e); setLoading(false); });

    return () => ctrl.abort();
  }, [year]);

  const stats = useMemo(() => {
    const { tenders, works, users, workExpenses, officeExpenses, travelExpenses } = data;
    const thisYearTenders = tenders.filter((t) => tenderMatchesYear(t, year));
    const thisYearWorks = works.filter((w) => {
      const d = w.start_fact || w.start_plan || w.start_in_work_date;
      if (d && new Date(d).getFullYear() === year) return true;
      if (w.tender_id) {
        const t = tenders.find((x) => x.id === w.tender_id);
        if (t) return tenderMatchesYear(t, year);
      }
      if (!w.tender_id && !d && w.created_at) return new Date(w.created_at).getFullYear() === year;
      return false;
    });

    const s = {
      tendersTotal: thisYearTenders.length,
      tendersWon: thisYearTenders.filter((t) => WON.includes(t.tender_status)).length,
      tendersLost: thisYearTenders.filter((t) => LOST.includes(t.tender_status)).length,
      tendersInProgress: thisYearTenders.filter((t) => !WON.includes(t.tender_status) && !LOST.includes(t.tender_status) && t.tender_status !== 'Другое').length,
      worksTotal: thisYearWorks.length,
      worksDone: thisYearWorks.filter((w) => isDone(w.work_status)).length,
      worksActive: thisYearWorks.filter((w) => !isDone(w.work_status)).length,
      worksProblems: thisYearWorks.filter((w) => w.work_status === 'Проблема').length,
      contractSum: thisYearWorks.reduce((a, w) => a + (Number(w.contract_value) || 0), 0),
      planSum: thisYearWorks.reduce((a, w) => a + (Number(w.cost_plan) || 0), 0),
      factSum: thisYearWorks.reduce((a, w) => a + (Number(w.cost_fact) || 0), 0),
      workExpensesSum: workExpenses.filter((e) => e.date && new Date(e.date).getFullYear() === year).reduce((a, e) => a + (Number(e.amount) || 0), 0),
      officeExpensesSum: officeExpenses.filter((e) => e.date && new Date(e.date).getFullYear() === year).reduce((a, e) => a + (Number(e.amount) || 0), 0),
      travelExpensesSum: travelExpenses.filter((e) => e.date && new Date(e.date).getFullYear() === year).reduce((a, e) => a + (Number(e.amount) || 0), 0),
      usersActive: users.filter((u) => u.is_active && !u.is_blocked).length,
      usersBlocked: users.filter((u) => u.is_blocked).length
    };
    s.profit = s.contractSum - s.factSum;
    s.profitPlan = s.contractSum - s.planSum;
    s.conversionRate = s.tendersTotal > 0 ? Math.round((s.tendersWon / s.tendersTotal) * 100) : 0;

    const monthly = [];
    for (let m = 0; m <= month; m++) {
      const monthTenders = tenders.filter((t) => {
        if (Number(t.year) !== year) return false;
        const p = t.period || '';
        const mm = p.match(/^\d{4}-(\d{2})$/);
        if (mm) return parseInt(mm[1]) === m + 1;
        const d = t.created_at || t.updated_at;
        if (d) { const dt = new Date(d); return dt.getFullYear() === year && dt.getMonth() === m; }
        return false;
      });
      const monthWorks = works.filter((w) => {
        const d = w.start_fact || w.start_plan || w.start_in_work_date;
        if (d) { const dt = new Date(d); return dt.getFullYear() === year && dt.getMonth() === m; }
        if (w.tender_id) {
          const t = tenders.find((x) => x.id === w.tender_id);
          if (t && tenderMatchesYear(t, year)) {
            const p = t.period || '';
            const pm = p.match(/^\d{4}-(\d{2})$/);
            if (pm) return parseInt(pm[1]) === m + 1;
          }
        }
        if (w.created_at) { const wdt = new Date(w.created_at); return wdt.getFullYear() === year && wdt.getMonth() === m; }
        return false;
      });
      monthly.push({
        label: MONTHS[m],
        works: monthWorks.length,
        tenders: monthTenders.length,
        won: monthTenders.filter((t) => WON.includes(t.tender_status)).length
      });
    }
    return { ...s, monthly };
  }, [data, year, month]);

  if (loading) return <SkeletonDash />;
  if (err) return <div className="p-24 c-err">Ошибка: {err.message}</div>;

  const callDash = data.callDash;
  const callStats = callDash?.stats;

  return (
    <div className="dash-2">
      {/* HERO */}
      <div className="dash-hero">
        <h1>Дашборд руководителя</h1>
        <div className="meta">
          <span className="pill">📅 {year} год</span>
          <span className="pill">⏱ Данные на {now.toLocaleDateString('ru-RU')}</span>
        </div>
      </div>

      {/* ALERTS */}
      {(stats.worksProblems > 0 || stats.usersBlocked > 0) && (
        <div className="dash-alerts">
          <div className="dash-alerts-title">⚠️ Требует внимания</div>
          {stats.worksProblems > 0 && (
            <div className="dash-alert-item">🔴 <strong>{stats.worksProblems}</strong>&nbsp;работ со статусом «Проблема»</div>
          )}
          {stats.usersBlocked > 0 && (
            <div className="dash-alert-item">🔒 <strong>{stats.usersBlocked}</strong>&nbsp;заблокированных пользователей</div>
          )}
        </div>
      )}

      {/* KPI GRID — те же 8 карточек что в оригинале */}
      <div className="dash-grid">
        {/* Тендеры */}
        <div className="kpi kpi-tenders">
          <div className="kpi-icon">📋</div>
          <div className="kpi-title">Тендеры {year}</div>
          <div className="kpi-value c-blue">{stats.tendersTotal}</div>
          <div className="kpi-sub">Конверсия: <strong className="c-green">{stats.conversionRate}%</strong></div>
          <div className="kpi-row">
            <div className="kpi-mini"><div className="kpi-mini-label">Выиграно</div><div className="kpi-mini-value c-green">{stats.tendersWon}</div></div>
            <div className="kpi-mini"><div className="kpi-mini-label">Проиграно</div><div className="kpi-mini-value c-red">{stats.tendersLost}</div></div>
            <div className="kpi-mini"><div className="kpi-mini-label">В работе</div><div className="kpi-mini-value c-amber">{stats.tendersInProgress}</div></div>
          </div>
        </div>

        {/* Работы */}
        <div className="kpi kpi-works">
          <div className="kpi-icon">🏗️</div>
          <div className="kpi-title">Работы {year}</div>
          <div className="kpi-value c-green">{stats.worksTotal}</div>
          <div className="kpi-sub">Завершено: <strong>{pct(stats.worksDone, stats.worksTotal)}</strong></div>
          <div className="kpi-progress">
            <div className="kpi-progress-bar" style={{ width: (stats.worksTotal ? (stats.worksDone / stats.worksTotal * 100) : 0) + '%' }} />
          </div>
          <div className="kpi-row">
            <div className="kpi-mini"><div className="kpi-mini-label">Завершено</div><div className="kpi-mini-value c-green">{stats.worksDone}</div></div>
            <div className="kpi-mini"><div className="kpi-mini-label">Активные</div><div className="kpi-mini-value c-blue">{stats.worksActive}</div></div>
            <div className="kpi-mini"><div className="kpi-mini-label">Проблемы</div><div className="kpi-mini-value c-red">{stats.worksProblems}</div></div>
          </div>
        </div>

        {/* Выручка */}
        <div className="kpi kpi-revenue">
          <div className="kpi-icon">💰</div>
          <div className="kpi-title">Выручка (контракты)</div>
          <div className="kpi-value c-gold">{shortMoney(stats.contractSum)}</div>
          <div className="kpi-sub">{money(stats.contractSum)}</div>
        </div>

        {/* Прибыль */}
        <div className={'kpi ' + (stats.profit >= 0 ? 'kpi-profit-p' : 'kpi-profit-n')}>
          <div className="kpi-icon">{stats.profit >= 0 ? '📈' : '📉'}</div>
          <div className="kpi-title">Прибыль (факт)</div>
          <div className={'kpi-value ' + (stats.profit >= 0 ? 'c-green' : 'c-red')}>{shortMoney(stats.profit)}</div>
          <div className="kpi-sub">План: {money(stats.profitPlan)}</div>
        </div>

        {/* Расходы */}
        <div className="kpi kpi-expense">
          <div className="kpi-icon">💸</div>
          <div className="kpi-title">Расходы (всего)</div>
          <div className="kpi-value c-red">{shortMoney(stats.workExpensesSum + stats.officeExpensesSum + stats.travelExpensesSum)}</div>
          <div className="kpi-row">
            <div className="kpi-mini"><div className="kpi-mini-label">По работам</div><div className="kpi-mini-value">{shortMoney(stats.workExpensesSum)}</div></div>
            <div className="kpi-mini"><div className="kpi-mini-label">Офис</div><div className="kpi-mini-value">{shortMoney(stats.officeExpensesSum)}</div></div>
            <div className="kpi-mini"><div className="kpi-mini-label">Команд.</div><div className="kpi-mini-value">{shortMoney(stats.travelExpensesSum)}</div></div>
          </div>
        </div>

        {/* Команда */}
        <div className="kpi kpi-team">
          <div className="kpi-icon">👥</div>
          <div className="kpi-title">Команда</div>
          <div className="kpi-value c-purple">{stats.usersActive}</div>
          <div className="kpi-sub">активных сотрудников</div>
        </div>

        {/* Звонки — если есть */}
        {callStats && (
          <button type="button" className="kpi kpi-calls cur-p" onClick={() => { window.location.hash = '#/telephony?tab=analytics'; }} aria-label="Перейти в аналитику звонков">
            <div className="kpi-icon" aria-hidden="true">📞</div>
            <div className="kpi-title">Звонки</div>
            <div className="kpi-value c-blue">{callStats.totalCalls || 0}</div>
            <div className="kpi-sub">за последний отчёт</div>
            <div className="kpi-row">
              <div className="kpi-mini"><div className="kpi-mini-label">Целевых</div><div className="kpi-mini-value c-green">{callStats.targetCalls || 0}</div></div>
              <div className="kpi-mini"><div className="kpi-mini-label">Пропущено</div><div className="kpi-mini-value c-red">{callStats.missedCalls || 0}</div></div>
            </div>
            {callDash?.unviewedReport && (
              <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 8 }}>📊 Новый отчёт: {callDash.unviewedReport.title || 'готов'}</div>
            )}
          </button>
        )}
      </div>

      {/* CHARTS */}
      <div className="dash-charts">
        <div className="chart-card">
          <div className="chart-title">
            <h3>📊 Тендеры по месяцам</h3>
            <div className="chart-legend">
              <span><span className="swatch" style={{ background: 'var(--ok)' }} />Выиграно</span>
              <span><span className="swatch" style={{ background: 'var(--info)' }} />Прочие</span>
            </div>
          </div>
          <StackedBar
            rows={stats.monthly.map((m) => ({
              label: m.label,
              parts: [
                { value: m.won, color: 'var(--ok)' },
                { value: m.tenders - m.won, color: 'var(--info)' }
              ]
            }))}
          />
        </div>
        <div className="chart-card">
          <div className="chart-title">
            <h3>📊 Работы по месяцам</h3>
            <div className="chart-legend">
              <span><span className="swatch" style={{ background: 'var(--purple)' }} />Работы</span>
            </div>
          </div>
          <StackedBar
            rows={stats.monthly.map((m) => ({
              label: m.label,
              parts: [{ value: m.works, color: 'var(--purple)' }]
            }))}
          />
        </div>
      </div>

      {/* QUICK ACTIONS — те же что в оригинале */}
      <div className="dash-section">
        <div className="dash-section-title">⚡ Быстрые действия</div>
        <div className="dash-quick">
          <Link to="/tenders">📋 Тендеры</Link>
          <Link to="/all-works">🏗️ Все работы</Link>
          <Link to="/approvals">✓ Согласования</Link>
          <Link to="/finances">💰 Финансы</Link>
          <Link to="/user-requests">👥 Пользователи</Link>
          <Link to="/kpi-works">📈 KPI работ</Link>
          <Link to="/kpi-money">💵 KPI деньги</Link>
          <Link to="/buh-registry">🧾 Реестр BUH</Link>
        </div>
      </div>

      {/* EXPORT */}
      <DashboardExportSection
        year={year}
        tenders={data.tenders}
        works={data.works}
        users={data.users}
        workExpenses={data.workExpenses}
        officeExpenses={data.officeExpenses}
        travelExpenses={data.travelExpenses}
        stats={stats}
      />
    </div>
  );
}

/* ─── Экспортная секция ─── */
function DashboardExportSection({ year, tenders, works, users, workExpenses, officeExpenses, travelExpenses, stats }) {
  const usersMap = useMemo(() => new Map(users.map((u) => [u.id, u.name || u.login || ''])), [users]);
  const today = new Date().toISOString().slice(0, 10);

  const exportSummary = () => {
    const headers = ['Показатель', 'Значение'];
    const rows = [
      ['Год', String(year)],
      ['Дата выгрузки', today],
      ['Тендеров всего', String(stats.tendersTotal)],
      ['Выиграно', String(stats.tendersWon)],
      ['Проиграно', String(stats.tendersLost)],
      ['В работе (тендеры)', String(stats.tendersInProgress)],
      ['Конверсия %', String(stats.conversionRate)],
      ['Работ всего', String(stats.worksTotal)],
      ['Работ закрыто', String(stats.worksDone)],
      ['Работ активных', String(stats.worksActive)],
      ['Работ с проблемой', String(stats.worksProblems)],
      ['Сумма контрактов', fmtCsvMoney(stats.contractSum)],
      ['План расходов', fmtCsvMoney(stats.planSum)],
      ['Факт расходов', fmtCsvMoney(stats.factSum)],
      ['Прибыль (факт)', fmtCsvMoney(stats.profit)],
      ['Прибыль (план)', fmtCsvMoney(stats.profitPlan)],
      ['Расходы работ', fmtCsvMoney(stats.workExpensesSum)],
      ['Офисные расходы', fmtCsvMoney(stats.officeExpensesSum)],
      ['Командировочные', fmtCsvMoney(stats.travelExpensesSum)],
      ['Активных пользователей', String(stats.usersActive)],
      ['Заблокировано', String(stats.usersBlocked)]
    ];
    downloadCSV(toCSV(headers, rows), `dashboard_summary_${year}_${today}.csv`);
  };

  const exportTenders = () => {
    const filtered = tenders.filter((t) => tenderMatchesYear(t, year));
    const headers = ['Период', 'Год', 'Заказчик', 'Название тендера', 'Статус', 'Цена', 'РП', 'Причина отказа'];
    const rows = filtered.map((t) => [
      t.period || '',
      t.year || '',
      t.customer_name || '',
      t.tender_title || '',
      t.tender_status || '',
      fmtCsvMoney(t.tender_price),
      usersMap.get(t.responsible_pm_id) || '',
      t.reject_reason || ''
    ]);
    downloadCSV(toCSV(headers, rows), `tenders_${year}_${today}.csv`);
  };

  const exportWorks = () => {
    const filtered = works.filter((w) => {
      const d = w.start_fact || w.start_plan || w.start_in_work_date;
      return d ? new Date(d).getFullYear() === year : false;
    });
    const headers = ['Название', 'Статус', 'РП', 'Старт план', 'Старт факт', 'Окончание план', 'Окончание факт', 'Контракт', 'План', 'Факт'];
    const rows = filtered.map((w) => [
      w.work_title || '',
      w.work_status || '',
      usersMap.get(w.pm_id) || '',
      fmtCsvDate(w.start_plan),
      fmtCsvDate(w.start_fact),
      fmtCsvDate(w.end_plan),
      fmtCsvDate(w.work_end_fact),
      fmtCsvMoney(w.contract_value),
      fmtCsvMoney(w.cost_plan),
      fmtCsvMoney(w.cost_fact)
    ]);
    downloadCSV(toCSV(headers, rows), `works_${year}_${today}.csv`);
  };

  const worksMap = useMemo(() => new Map(works.map((w) => [w.id, w.work_title || `Работа #${w.id}`])), [works]);

  const exportWorkExpenses = () => {
    const filtered = workExpenses.filter((e) => e.date && new Date(e.date).getFullYear() === year);
    const headers = ['Дата', 'Работа', 'Категория', 'Описание', 'Сумма', 'Создал'];
    const rows = filtered.map((e) => [
      fmtCsvDate(e.date),
      worksMap.get(e.work_id) || '',
      e.category || '',
      e.description || e.name || '',
      fmtCsvMoney(e.amount),
      usersMap.get(e.created_by) || ''
    ]);
    downloadCSV(toCSV(headers, rows), `work_expenses_${year}_${today}.csv`);
  };

  const exportOfficeExpenses = () => {
    const filtered = officeExpenses.filter((e) => e.date && new Date(e.date).getFullYear() === year);
    const headers = ['Дата', 'Категория', 'Описание', 'Сумма', 'Статус', 'Создал'];
    const rows = filtered.map((e) => [
      fmtCsvDate(e.date),
      e.category || '',
      e.description || '',
      fmtCsvMoney(e.amount),
      e.status || '',
      usersMap.get(e.created_by) || ''
    ]);
    downloadCSV(toCSV(headers, rows), `office_expenses_${year}_${today}.csv`);
  };

  const exportTravelExpenses = () => {
    const filtered = travelExpenses.filter((e) => e.date && new Date(e.date).getFullYear() === year);
    const headers = ['Дата', 'Тип', 'Работа', 'Сотрудник', 'Описание', 'Сумма', 'Поставщик', 'Создал'];
    const rows = filtered.map((e) => [
      fmtCsvDate(e.date),
      e.expense_type || '',
      worksMap.get(e.work_id) || '',
      e.employee_name || e.employee_id || '',
      e.description || '',
      fmtCsvMoney(e.amount),
      e.supplier || '',
      usersMap.get(e.created_by) || ''
    ]);
    downloadCSV(toCSV(headers, rows), `travel_expenses_${year}_${today}.csv`);
  };

  const exportUsers = () => {
    const headers = ['Логин', 'Имя', 'Роль', 'Активен', 'Заблокирован'];
    const rows = users.map((u) => [
      u.login || '',
      u.name || '',
      u.role || '',
      u.is_active ? 'Да' : 'Нет',
      u.is_blocked ? 'Да' : 'Нет'
    ]);
    downloadCSV(toCSV(headers, rows), `users_${today}.csv`);
  };

  const handle = (fn) => (e) => { e.preventDefault(); try { fn(); } catch (err) { console.error('[Dashboard export]', err); } };

  return (
    <div className="dash-section">
      <div className="dash-section-title">📥 Экспорт в Excel (CSV)</div>
      <div className="dash-quick">
        <a href="#" onClick={handle(exportSummary)}>📊 Сводка</a>
        <a href="#" onClick={handle(exportTenders)}>📋 Тендеры</a>
        <a href="#" onClick={handle(exportWorks)}>🏗️ Работы</a>
        <a href="#" onClick={handle(exportWorkExpenses)}>💸 Расходы работ</a>
        <a href="#" onClick={handle(exportOfficeExpenses)}>🏢 Офис.расходы</a>
        <a href="#" onClick={handle(exportTravelExpenses)}>✈️ Командировки</a>
        <a href="#" onClick={handle(exportUsers)}>👥 Пользователи</a>
      </div>
    </div>
  );
}

function SkeletonDash() {
  return (
    <div className="dash-2">
      <div className="skel" style={{ height: 110 }} />
      <div className="dash-grid">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skel" style={{ height: 180 }} />)}
      </div>
      <div className="dash-charts">
        <div className="skel h-240" />
        <div className="skel h-240" />
      </div>
    </div>
  );
}
