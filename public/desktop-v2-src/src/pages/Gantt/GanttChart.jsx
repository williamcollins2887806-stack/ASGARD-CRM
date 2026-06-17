/**
 * GanttChart — рендер диаграммы Гантта по неделям.
 * Источник vanilla: AsgardGantt.renderBoard() в public/assets/js/gantt.js.
 *
 * Свой DOM-рендер (без библиотек): шапка-недели + строки-треки.
 * Каждая строка — фиксированная ширина «список» (320px) + растяжимый «трек».
 * Бар: position:absolute, left/width в процентах от полной шкалы (totalDays).
 */
import { useMemo,  } from 'react';
import { parseDate, startOfWeek, addDays, isoDate } from './api';

function weeksBetween(a, b) {
  const ms = 7 * 24 * 60 * 60 * 1000;
  return Math.ceil((b - a) / ms);
}

export default function GanttChart({ startIso, weeks, rows, onRowClick }) {
  const start = startOfWeek(parseDate(startIso) || new Date());
  const end = addDays(start, weeks * 7);
  const totalWeeks = weeksBetween(start, end);

  const msDay = 24 * 60 * 60 * 1000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayOffsetDays = Math.floor((today - start) / msDay);
  const totalDays = totalWeeks * 7;
  const todayLeft = (todayOffsetDays / totalDays) * 100;

  const headWeeks = useMemo(() => {
    return Array.from({ length: totalWeeks }).map((_, i) => {
      const d = addDays(start, i * 7);
      return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startIso, totalWeeks]);

  const items = useMemo(() => {
    return rows.map((r, idx) => {
      const bS = parseDate(r.start) || start;
      const bEraw = parseDate(r.end) || bS;
      const bS0 = new Date(bS); bS0.setHours(0, 0, 0, 0);
      const bE0 = new Date(bEraw); bE0.setHours(0, 0, 0, 0);
      const rawStartDays = Math.floor((bS0 - start) / msDay);
      const rawEndDays = Math.max(rawStartDays, Math.floor((bE0 - start) / msDay));
      const startDays = Math.max(0, Math.min(totalDays - 1, rawStartDays));
      const endDays = Math.max(startDays, Math.min(totalDays - 1, rawEndDays));
      const durDays = Math.max(1, (endDays - startDays) + 1);
      const startsBefore = rawStartDays < 0;
      const endsAfter = rawEndDays >= totalDays;

      const barLeft = (startDays / totalDays) * 100;
      const barW = (durDays / totalDays) * 100;
      const tooltip = `${r.label}\n${isoDate(bS0)} — ${isoDate(bE0)}${startsBefore ? '\n← начало раньше видимой области' : ''}${endsAfter ? '\nконец позже видимой области →' : ''}`;
      return { ...r, idx, barLeft, barW, startsBefore, endsAfter, tooltip };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, startIso, weeks]);

  if (!rows.length) {
    return (
      <div className="gantt-box gantt-empty">
        <div className="gantt-empty-msg">Нет данных для отображения</div>
      </div>
    );
  }

  return (
    <div className="gantt-box">
      <div className="gantt-head">
        <div className="gantt-head-left">Список</div>
        <div
          className="gantt-head-right"
          style={{ gridTemplateColumns: `repeat(${totalWeeks}, 1fr)` }}
        >
          {headWeeks.map((lab, i) => (
            <div key={i} className="gantt-week">{lab}</div>
          ))}
        </div>
      </div>

      <div className="gantt-body">
        {items.map((r) => (
          <div key={`${r.kind}-${r.id}-${r.idx}`} className="gantt-row">
            <div className="gantt-name">
              <div className="gantt-name-main">{r.label}</div>
              <div className="gantt-name-sub">{r.sub}</div>
            </div>
            <div className="gantt-track">
              <div
                className="gantt-grid"
                style={{ gridTemplateColumns: `repeat(${totalWeeks}, 1fr)` }}
              >
                {Array.from({ length: totalWeeks }).map((_, i) => <div key={i} />)}
              </div>
              {Number.isFinite(todayLeft) && todayLeft >= 0 && todayLeft <= 100 && (
                <div className="gantt-today" style={{ left: `${todayLeft}%` }} title="Сегодня" />
              )}
              <button
                type="button"
                className={[
                  'gantt-bar',
                  r.startsBefore ? 'gantt-bar--cut-left' : '',
                  r.endsAfter ? 'gantt-bar--cut-right' : '',
                  r.kind === 'tender' ? 'gantt-bar--tender' : 'gantt-bar--work'
                ].filter(Boolean).join(' ')}
                style={{
                  left: `${r.barLeft}%`,
                  width: `${r.barW}%`,
                  background: r.color || (r.kind === 'tender' ? 'var(--info)' : 'var(--ok)')
                }}
                title={r.tooltip}
                onClick={() => onRowClick?.(r)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
