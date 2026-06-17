/**
 * ScheduleGantt — режим «Гантт» для страницы /workers-schedule.
 *
 * Источник: vanilla `staff_schedule.js:483-611` (#ganttWrap, #btnViewGantt, setViewMode('gantt')).
 *
 * Структура:
 *  • рендер на основе уже-загруженного planByKey (employee_id|YYYY-MM-DD → план)
 *  • объединяем последовательные дни одного сотрудника с одинаковым kind/work_id в один бар
 *  • месяцная навигация наследуется от родителя; здесь рендерим только бары для текущего месяца
 *
 * Используем shared <GanttChart> из @/pages/Gantt/GanttChart (как просил пользователь).
 */
import { useMemo } from 'react';
import GanttChart from '@/pages/Gantt/GanttChart';
import { EmptyState } from '@/blocks/Blocks';
import { STATUS_BY_CODE, fmtDateIso } from './api';

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }

/**
 * Преобразует planByKey + список сотрудников в массив строк-баров для GanttChart.
 * Каждая последовательность одинаковых kind/work_id у одного employee_id внутри
 * текущего месяца → 1 бар (start = первый день, end = последний день).
 */
function buildBars(employees, planByKey, worksMap, year, month) {
  const days = daysInMonth(year, month);
  const rows = [];

  for (const emp of employees) {
    let runStart = null;
    let runKey = null;
    let runPlan = null;

    const flush = (endDay) => {
      if (!runStart || !runPlan) return;
      const st = STATUS_BY_CODE[runPlan.kind];
      const startIso = fmtDateIso(new Date(year, month, runStart));
      const endIso = fmtDateIso(new Date(year, month, endDay));
      const work = runPlan.work_id ? worksMap.get(runPlan.work_id) : null;
      const sub = work
        ? `${st?.label || runPlan.kind} · ${work}`
        : (st?.label || runPlan.kind);
      rows.push({
        id: `${emp.id}-${startIso}-${runPlan.kind}-${runPlan.work_id || 'x'}`,
        kind: 'work', // тип для класса бара — берём work-стиль; цвет ниже переопределяем явно
        label: emp.fio || emp.full_name || `#${emp.id}`,
        sub,
        start: startIso,
        end: endIso,
        color: st?.color || 'var(--t-3)'
      });
    };

    for (let d = 1; d <= days; d++) {
      const dateIso = fmtDateIso(new Date(year, month, d));
      const plan = planByKey.get(`${emp.id}|${dateIso}`);
      const key = plan ? `${plan.kind}|${plan.work_id || ''}` : null;
      if (key && key === runKey) {
        // продолжение run
        continue;
      }
      // закрываем предыдущий run
      if (runStart) flush(d - 1);
      // открываем новый, если есть план
      if (plan) {
        runStart = d;
        runKey = key;
        runPlan = plan;
      } else {
        runStart = null;
        runKey = null;
        runPlan = null;
      }
    }
    if (runStart) flush(days);
  }

  return rows;
}

export default function ScheduleGantt({ employees, planByKey, worksMap, year, month }) {
  const rows = useMemo(
    () => buildBars(employees, planByKey, worksMap, year, month),
    [employees, planByKey, worksMap, year, month]
  );

  // Шкала Ганта — от 1-го числа месяца на 5-6 недель вперёд.
  const startIso = fmtDateIso(new Date(year, month, 1));
  // Количество недель чтобы покрыть месяц + хвостик.
  const weeks = Math.ceil((daysInMonth(year, month) + 7) / 7);

  if (!rows.length) {
    return (
      <EmptyState
        icon="📅"
        title="В этом месяце нет плана"
        hint="Кликните по ячейке в режиме «Календарь» чтобы назначить статус."
      />
    );
  }

  return (
    <div className="card ws-gantt-wrap">
      <GanttChart
        startIso={startIso}
        weeks={weeks}
        rows={rows}
      />
    </div>
  );
}
