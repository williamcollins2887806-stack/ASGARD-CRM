/**
 * История работ сотрудника — мини Gantt-таймлайн + таблица.
 *
 * Источник: vanilla `public/assets/js/employee.js` (renderTimeline + assignRow,
 * строки 95–113, 421–527).
 *
 * Данные:
 *   • GET /api/data/employee_assignments?where={"employee_id":N}
 *   • GET /api/works?limit=2000 (для подстановки work_title / pm_name / city / customer)
 *
 * Виды:
 *   • Карточки KPI: всего работ / активных / дней / заказчиков
 *   • SVG-таймлайн по месяцам с горизонтальными полосами
 *   • Таблица «С / По / Контракт / Заказчик / Город / Роль / РП / Статус»
 */
import { useEffect, useMemo, useState } from 'react';
import { loadEmployeeAssignments, loadWorksLookup, fmtDate } from './api';

const TODAY = new Date().toISOString().slice(0, 10);

function isCurrentAssign(a) {
  return !a.date_to || String(a.date_to).slice(0, 10) >= TODAY;
}

function daysBetween(d1, d2) {
  if (!d1) return 0;
  const a = new Date(d1);
  const b = d2 ? new Date(d2) : new Date();
  return Math.max(0, Math.round((b - a) / 86400000));
}

export function EmployeeWorkHistory({ employeeId }) {
  const [loading, setLoading] = useState(true);
  const [assigns, setAssigns] = useState([]);
  const [worksMap, setWorksMap] = useState(new Map());

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      loadEmployeeAssignments(employeeId),
      loadWorksLookup(),
    ]).then(([a, w]) => {
      if (!alive) return;
      // Сортируем по date_from DESC (новые сверху)
      const sorted = (a || []).slice().sort((x, y) =>
        String(y.date_from || '').localeCompare(String(x.date_from || ''))
      );
      setAssigns(sorted);
      setWorksMap(new Map((w || []).map((it) => [it.id, it])));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [employeeId]);

  const stats = useMemo(() => {
    const total = assigns.length;
    const active = assigns.filter(isCurrentAssign).length;
    let totalDays = 0;
    const customers = new Set();
    assigns.forEach((a) => {
      totalDays += daysBetween(a.date_from, a.date_to);
      const w = worksMap.get(a.work_id);
      if (w?.customer_name) customers.add(w.customer_name);
    });
    return { total, active, totalDays, customers: customers.size };
  }, [assigns, worksMap]);

  if (loading) {
    return <div className="emp-modal-empty">⏳ Загружаем историю работ…</div>;
  }

  if (assigns.length === 0) {
    return <div className="emp-modal-empty">История назначений пуста</div>;
  }

  return (
    <div className="emp-history">
      {/* KPI */}
      <div className="emp-history-stats">
        <StatCard label="Всего работ" value={stats.total} tone="gold" />
        <StatCard label="Активных" value={stats.active} tone="ok" />
        <StatCard label="Дней отработано" value={stats.totalDays} tone="t1" />
        <StatCard label="Заказчиков" value={stats.customers} tone="info" />
      </div>

      {/* Timeline */}
      <Timeline assigns={assigns} worksMap={worksMap} />

      {/* Таблица */}
      <div className="emp-history-table-wrap">
        <table className="emp-history-table">
          <thead>
            <tr>
              <th>С</th>
              <th>По</th>
              <th>Контракт</th>
              <th>Заказчик</th>
              <th>Город</th>
              <th>Роль</th>
              <th>РП</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {assigns.map((a, i) => {
              const w = worksMap.get(a.work_id);
              const isCur = isCurrentAssign(a);
              return (
                <tr key={a.id || i} className={isCur ? 'is-current' : ''}>
                  <td className="u-nowrap">{a.date_from ? fmtDate(a.date_from) : '—'}</td>
                  <td className="u-nowrap">{a.date_to ? fmtDate(a.date_to) : '—'}</td>
                  <td><b>{w?.work_title || '—'}</b></td>
                  <td>{w?.customer_name || ''}</td>
                  <td>{w?.object_name || w?.city || w?.tender_region || w?.object_address || ''}</td>
                  <td>{a.role || a.role_on_work || a.field_role || ''}</td>
                  <td>{w?.pm_name || (w?.pm_id ? `#${w.pm_id}` : '—')}</td>
                  <td>
                    {isCur
                      ? <span className="emp-history-status-pill emp-history-status-pill--cur">Сейчас</span>
                      : (w?.work_status
                        ? <span className="emp-history-status-pill">{w.work_status}</span>
                        : '—')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  return (
    <div className={`emp-history-stat emp-history-stat--${tone}`}>
      <div className="emp-history-stat-num">{value}</div>
      <div className="emp-history-stat-lbl">{label}</div>
    </div>
  );
}

/**
 * SVG mini-Gantt по месяцам.
 * Источник: vanilla `employee.js` строки 449–527.
 */
function Timeline({ assigns, worksMap }) {
  const { svgInfo, monthW, totalW, months, rowH } = useMemo(() => {
    const now = new Date();
    const allDates = [];
    assigns.forEach((a) => {
      if (a.date_from) allDates.push(new Date(a.date_from));
      allDates.push(a.date_to ? new Date(a.date_to) : now);
    });
    if (allDates.length === 0) return { svgInfo: null, monthW: 0, totalW: 0, months: [], rowH: 38 };

    let minD = new Date(Math.min.apply(null, allDates));
    let maxD = new Date(Math.max.apply(null, allDates));
    minD.setDate(1); minD.setMonth(minD.getMonth() - 1);
    maxD.setDate(1); maxD.setMonth(maxD.getMonth() + 2);
    const totalMs = maxD - minD;
    if (totalMs <= 0) return { svgInfo: null, monthW: 0, totalW: 0, months: [], rowH: 38 };

    const monthsArr = [];
    const cur = new Date(minD);
    while (cur < maxD) {
      monthsArr.push({
        d: new Date(cur),
        label: cur.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }),
      });
      cur.setMonth(cur.getMonth() + 1);
    }
    const mw = Math.max(60, 900 / Math.max(1, monthsArr.length));
    const tw = mw * monthsArr.length;
    const rh = 38;
    const todayLeft = ((now - minD) / totalMs) * tw;

    const bars = assigns.map((a, idx) => {
      const d1 = a.date_from ? new Date(a.date_from) : minD;
      const d2 = a.date_to ? new Date(a.date_to) : now;
      const left = ((d1 - minD) / totalMs) * tw;
      const width = Math.max(4, ((d2 - d1) / totalMs) * tw);
      const w2 = worksMap.get(a.work_id);
      const isCur = !a.date_to || String(a.date_to).slice(0, 10) >= TODAY;
      const label = (w2?.work_title || '').slice(0, 25);
      const customer = w2?.customer_name || '';
      const role = a.role || a.role_on_work || a.field_role || '';
      const days = daysBetween(a.date_from, a.date_to);
      const df = d1.toLocaleDateString('ru-RU');
      const dt = a.date_to ? d2.toLocaleDateString('ru-RU') : 'по н.в.';
      const tooltip = `${label}\n${customer}\nРоль: ${role}\n${df} — ${dt}\n${days} дн.${isCur ? ' (активна)' : ' (завершена)'}`;
      return { idx, left, width, isCur, label, tooltip };
    });

    return {
      svgInfo: { bars, todayLeft, totalHeight: assigns.length * rh + 10 },
      monthW: mw,
      totalW: tw,
      months: monthsArr,
      rowH: rh,
    };
  }, [assigns, worksMap]);

  if (!svgInfo) return null;

  return (
    <div className="emp-history-timeline">
      <div className="emp-history-timeline-inner" style={{ minWidth: totalW + 'px' }}>
        <div className="emp-history-timeline-head">
          {months.map((m, i) => (
            <div key={i} className="emp-history-timeline-month" style={{ width: monthW + 'px' }}>
              {m.label}
            </div>
          ))}
        </div>
        <div
          className="emp-history-timeline-body"
          style={{ height: svgInfo.totalHeight + 'px' }}
        >
          {months.map((_, i) => (
            <div
              key={i}
              className="emp-history-timeline-grid"
              style={{ left: (i * monthW) + 'px' }}
            />
          ))}
          {svgInfo.bars.map((b) => (
            <div
              key={b.idx}
              className={'emp-history-timeline-bar ' + (b.isCur ? 'is-cur' : 'is-done')}
              style={{
                left: b.left + 'px',
                top: (b.idx * rowH + 4) + 'px',
                width: b.width + 'px',
                height: (rowH - 8) + 'px',
              }}
              title={b.tooltip}
            >
              {b.label}
            </div>
          ))}
          <div
            className="emp-history-timeline-today"
            style={{ left: svgInfo.todayLeft + 'px' }}
            title="Сегодня"
          />
        </div>
        <div className="emp-history-timeline-legend">
          <span><span className="dot dot--cur" />Активна</span>
          <span><span className="dot dot--done" />Завершена</span>
          <span className="legend-today"><span className="line" />Сегодня</span>
        </div>
      </div>
    </div>
  );
}
