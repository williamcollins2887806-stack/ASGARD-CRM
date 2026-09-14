/**
 * История работ сотрудника — мини Gantt по /worklog + таблица назначений.
 * Паритет vanilla `employee.js` renderTimeline (чек-ины, разрывы заездов).
 */
import { useEffect, useMemo, useState } from 'react';
import { loadEmployeeAssignments, loadEmployeeWorklog, loadWorksLookup, fmtDate } from './api';

const TODAY = new Date().toISOString().slice(0, 10);

function ymd(v) {
  if (!v) return '';
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function assignEnd(a) {
  return ymd(a && a.date_to) || ymd(a && a.departure_date);
}

function isCurrentAssign(a) {
  const end = assignEnd(a);
  if (end && end < TODAY) return false;
  if (a && (a.is_active === false || a.is_active === 'f' || a.is_active === 0)) {
    return !!(end && end >= TODAY);
  }
  return !end || end >= TODAY;
}

function fmtRu(s) {
  return s ? new Date(s).toLocaleDateString('ru-RU') : '';
}

export function EmployeeWorkHistory({ employeeId }) {
  const [loading, setLoading] = useState(true);
  const [assigns, setAssigns] = useState([]);
  const [segments, setSegments] = useState([]);
  const [worksMap, setWorksMap] = useState(new Map());
  const [hlWorkId, setHlWorkId] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      loadEmployeeAssignments(employeeId),
      loadEmployeeWorklog(employeeId),
      loadWorksLookup(),
    ]).then(([a, segs, w]) => {
      if (!alive) return;
      const sorted = (a || []).slice().sort((x, y) =>
        String(y.date_from || '').localeCompare(String(x.date_from || ''))
      );
      setAssigns(sorted);
      setSegments(segs || []);
      setWorksMap(new Map((w || []).map((it) => [it.id, it])));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [employeeId]);

  const stats = useMemo(() => {
    const total = assigns.length;
    const active = assigns.filter(isCurrentAssign).length;
    let factDays = 0;
    segments.forEach((s) => { factDays += Number(s.days) || 0; });
    const customers = new Set();
    assigns.forEach((a) => {
      const w = worksMap.get(a.work_id);
      if (w?.customer_name) customers.add(w.customer_name);
    });
    segments.forEach((s) => { if (s.customer_name) customers.add(s.customer_name); });
    return { total, active, factDays, customers: customers.size };
  }, [assigns, segments, worksMap]);

  if (loading) {
    return <div className="emp-modal-empty">⏳ Загружаем историю работ…</div>;
  }

  if (assigns.length === 0 && segments.length === 0) {
    return <div className="emp-modal-empty">История назначений пуста</div>;
  }

  return (
    <div className="emp-history">
      <div className="emp-history-stats">
        <StatCard label="Всего работ" value={stats.total} tone="gold" />
        <StatCard label="Активных" value={stats.active} tone="ok" />
        <StatCard label="Дней факт." value={stats.factDays} tone="t1" />
        <StatCard label="Заказчиков" value={stats.customers} tone="info" />
      </div>

      <WorklogTimeline
        segments={segments}
        hlWorkId={hlWorkId}
        onBarClick={(wid) => setHlWorkId(wid)}
      />

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
              const hl = hlWorkId != null && String(a.work_id) === String(hlWorkId);
              return (
                <tr
                  key={a.id || i}
                  className={(isCur ? 'is-current' : '') + (hl ? ' is-hl' : '')}
                  data-work-id={a.work_id || ''}
                >
                  <td className="u-nowrap">{a.date_from ? fmtDate(a.date_from) : '—'}</td>
                  <td className="u-nowrap">{assignEnd(a) ? fmtDate(assignEnd(a)) : '—'}</td>
                  <td><b>{w?.work_title || a.work_title || '—'}</b></td>
                  <td>{w?.customer_name || ''}</td>
                  <td>{w?.object_name || w?.city || w?.tender_region || w?.object_address || ''}</td>
                  <td>{a.role || a.role_on_work || ({ worker: 'Рабочий', senior_master: 'Ст. мастер', project_lead: 'Рук. проекта' }[a.field_role] || a.field_role || '')}</td>
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

/** Gantt по сегментам worklog (чек-ины), группировка по work_id */
function WorklogTimeline({ segments, hlWorkId, onBarClick }) {
  const layout = useMemo(() => {
    if (!segments.length) return null;
    const now = new Date();
    const endOf = (seg) => (seg.ongoing ? now : (seg.end ? new Date(seg.end) : now));
    const startOf = (seg) => (seg.start ? new Date(seg.start) : now);

    const allDates = [];
    segments.forEach((s) => { allDates.push(startOf(s)); allDates.push(endOf(s)); });
    let minD = new Date(Math.min.apply(null, allDates));
    let maxD = new Date(Math.max.apply(null, allDates));
    minD.setDate(1); minD.setMonth(minD.getMonth() - 1);
    maxD.setDate(1); maxD.setMonth(maxD.getMonth() + 2);
    const totalMs = maxD - minD;
    if (totalMs <= 0) return null;

    const monthsArr = [];
    const cur = new Date(minD);
    while (cur < maxD) {
      monthsArr.push(cur.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }));
      cur.setMonth(cur.getMonth() + 1);
    }
    const monthW = Math.max(60, 900 / Math.max(1, monthsArr.length));
    const totalW = monthW * monthsArr.length;
    const rowH = 38;
    const todayLeft = ((now - minD) / totalMs) * totalW;

    const rowsMap = new Map();
    segments.forEach((s) => {
      if (!rowsMap.has(s.work_id)) rowsMap.set(s.work_id, []);
      rowsMap.get(s.work_id).push(s);
    });
    const rows = Array.from(rowsMap.entries()).map(([work_id, segs]) => ({
      work_id,
      segs: segs.slice().sort((a, b) => startOf(a) - startOf(b)),
    })).sort((a, b) => startOf(a.segs[0]) - startOf(b.segs[0]));

    const bars = [];
    rows.forEach((row, idx) => {
      row.segs.forEach((s, segIdx) => {
        const d1 = startOf(s);
        const d2 = endOf(s);
        const left = ((d1 - minD) / totalMs) * totalW;
        const width = Math.max(5, ((d2 - d1) / totalMs) * totalW);
        const title = s.work_title || (`Объект #${s.work_id}`);
        const label = segIdx === 0 ? title.slice(0, 25) : (s.days ? `${s.days} дн.` : '');
        const periodTxt = `${fmtRu(s.start)} — ${s.ongoing ? 'по н.в. (текущая работа)' : fmtRu(s.end)}`;
        const daysTxt = s.no_checkins ? 'нет отметок о выходах' : `${s.days} дн. фактически`;
        const depTxt = (!s.ongoing && s.departure) ? `\nОтъезд: ${fmtRu(s.departure)}` : '';
        const tooltip = `${title}\n${s.customer_name || ''}\nРП: ${s.pm_name || ''}\n${periodTxt}\n${daysTxt}${depTxt}`;
        bars.push({
          key: `${s.work_id}-${segIdx}-${s.start}`,
          work_id: s.work_id,
          left,
          top: idx * rowH + 4,
          width,
          height: rowH - 8,
          isCur: !!s.ongoing,
          label,
          tooltip,
        });
      });
    });

    return {
      monthW,
      totalW,
      months: monthsArr,
      bars,
      todayLeft,
      totalHeight: rows.length * rowH + 10,
    };
  }, [segments]);

  if (!segments.length) {
    return <div className="emp-modal-empty" style={{ marginBottom: 12 }}>Нет отметок о выходах на объект</div>;
  }
  if (!layout) return null;

  return (
    <div className="emp-history-timeline">
      <div className="emp-history-timeline-inner" style={{ minWidth: layout.totalW + 'px' }}>
        <div className="emp-history-timeline-head">
          {layout.months.map((m, i) => (
            <div key={i} className="emp-history-timeline-month" style={{ width: layout.monthW + 'px' }}>
              {m}
            </div>
          ))}
        </div>
        <div className="emp-history-timeline-body" style={{ height: layout.totalHeight + 'px' }}>
          {layout.months.map((_, i) => (
            <div
              key={i}
              className="emp-history-timeline-grid"
              style={{ left: (i * layout.monthW) + 'px' }}
            />
          ))}
          {layout.bars.map((b) => (
            <div
              key={b.key}
              role="button"
              tabIndex={0}
              className={
                'emp-history-timeline-bar '
                + (b.isCur ? 'is-cur' : 'is-done')
                + (hlWorkId != null && String(hlWorkId) === String(b.work_id) ? ' is-hl' : '')
              }
              style={{
                left: b.left + 'px',
                top: b.top + 'px',
                width: b.width + 'px',
                height: b.height + 'px',
                cursor: 'pointer',
              }}
              title={b.tooltip}
              onClick={() => onBarClick?.(b.work_id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onBarClick?.(b.work_id); }}
            >
              {b.label}
            </div>
          ))}
          <div
            className="emp-history-timeline-today"
            style={{ left: layout.todayLeft + 'px' }}
            title="Сегодня"
          />
        </div>
        <div className="emp-history-timeline-legend">
          <span><span className="dot dot--cur" />Текущая работа</span>
          <span><span className="dot dot--done" />Завершённый заезд</span>
          <span className="legend-today"><span className="line" />Сегодня</span>
        </div>
      </div>
    </div>
  );
}
