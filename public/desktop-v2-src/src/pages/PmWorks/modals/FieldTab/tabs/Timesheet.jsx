/**
 * Timesheet (Табель) — полный inline-редактор смен.
 *
 * Vanilla parity: `public/assets/js/field-tab.js:1184-1707` (renderTimesheetTab +
 *   renderTimesheetTable + editCheckinCell + addCheckinCell + _shiftEditor).
 *
 * Endpoints (vanilla → React):
 *   GET    /api/field/manage/projects/:work_id/timesheet?from=&to=     (loadTimesheet)
 *   GET    /api/field/manage/projects/:work_id/timesheet?…&format=xlsx (exportTimesheetExcel)
 *   GET    /api/field/manage/projects/:work_id/dashboard               (loadDashboard → point_value)
 *   POST   /api/field/manage/projects/:work_id/checkin                 (createCheckin)
 *   PUT    /api/field/manage/projects/:work_id/checkin/:id             (updateCheckin)
 *   DELETE /api/field/manage/projects/:work_id/checkin/:id             (deleteCheckin — soft-cancel)
 *
 * Backend источники: src/routes/field-manage.js
 *   • GET   /projects/:work_id/timesheet  (line 579)
 *   • POST  /projects/:work_id/checkin    (line 969)
 *   • PUT   /projects/:work_id/checkin/:id (line 1030)
 *   • DELETE /projects/:work_id/checkin/:id (line 1061)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Field } from '@/modals/parts';
import { DatePicker } from '@/inputs/Inputs';
import { EmptyState } from '@/blocks/Blocks';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import {
  loadTimesheet, exportTimesheetExcel, loadDashboard,
  createCheckin, updateCheckin, deleteCheckin
} from '../api';
import {
  SHIFT_TYPES, getShiftMeta, fmtMoney, fmtInt, pointsColor,
  ymdAddDays, buildDateRange, dayLabel, dowShort, dayOfWeek,
  extractPointValue
} from './timesheetUtils';
import { ShiftPopover } from './ShiftPopover';
import { BulkShiftModal } from './BulkShiftModal';

/* По умолчанию: workStart-7 → workEnd+7, fallback last 30 days. */
function defaultRange(work) {
  const today = new Date();
  const workStart = work?.start_in_work_date || work?.start_plan || work?.start_fact;
  const workEnd = work?.end_plan || work?.end_fact;
  let from;
  if (workStart) {
    from = ymdAddDays(String(workStart).slice(0, 10), -7);
  } else {
    const d = new Date(today); d.setDate(d.getDate() - 30);
    from = d.toISOString().slice(0, 10);
  }
  let to;
  if (workEnd) {
    to = ymdAddDays(String(workEnd).slice(0, 10), 7);
  } else {
    to = today.toISOString().slice(0, 10);
  }
  return { from, to };
}

export default function TimesheetTab({ work }) {
  const { open } = useModal();
  const def = useMemo(() => defaultRange(work), [work?.id]);
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [pointValue, setPointValue] = useState(500);
  const [exporting, setExporting] = useState(false);

  // Якорь и контекст popover'а (один на всю таблицу — экономит на DOM)
  const [popState, setPopState] = useState(null);
  // { anchorEl, employee, date, day | null, isNew }

  const reload = async () => {
    setLoading(true);
    try {
      const d = await loadTimesheet(work.id, { from, to });
      setData(d || { timesheet: [], per_diem_rate: 0 });
    } finally {
      setLoading(false);
    }
  };

  // Загрузка point_value (один раз на работу)
  useEffect(() => {
    let cancelled = false;
    loadDashboard(work.id).then((dash) => {
      if (cancelled) return;
      setPointValue(extractPointValue(dash));
    });
    return () => { cancelled = true; };
  }, [work.id]);

  // Загрузка табеля при смене дат
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id, from, to]);

  const rows = data?.timesheet || [];
  const perDiem = parseFloat(data?.per_diem_rate || 0);

  const dates = useMemo(() => buildDateRange(from, to), [from, to]);

  // Карта { employee_id → { dateYMD → day } } для быстрого доступа
  const dayMap = useMemo(() => {
    const m = new Map();
    rows.forEach((emp) => {
      const inner = {};
      (emp.days || []).forEach((d) => { inner[String(d.date).slice(0, 10)] = d; });
      m.set(emp.employee_id, inner);
    });
    return m;
  }, [rows]);

  /* ─── CRUD: создать/обновить/удалить смену ─── */
  const saveCheckin = async ({ employee, date, day, payload }) => {
    try {
      if (day && day.id) {
        await updateCheckin(work.id, day.id, payload);
        toast('Табель', `Смена ${dayLabel(date)} обновлена`, 'ok');
      } else {
        await createCheckin(work.id, { employee_id: employee.employee_id, date, ...payload });
        toast('Табель', `${getShiftMeta(payload.shift).label} ${dayLabel(date)} добавлена`, 'ok');
      }
      setPopState(null);
      await reload();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const removeCheckin = async ({ date, day }) => {
    if (!day?.id) return;
    try {
      await deleteCheckin(work.id, day.id);
      toast('Табель', `Смена ${dayLabel(date)} удалена`, 'ok');
      setPopState(null);
      await reload();
    } catch (e) {
      toast('Ошибка', 'Не удалось удалить смену', 'err');
    }
  };

  const openCell = (e, employee, date, day) => {
    const anchor = e.currentTarget;
    // Если popover уже открыт на этой ячейке — закрываем (toggle)
    if (popState?.anchorEl === anchor) {
      setPopState(null);
      return;
    }
    setPopState({
      anchorEl: anchor,
      employee,
      date,
      day: day || null,
      isNew: !day
    });
  };

  /* ─── Сдвиг диапазона на ±1 день ─── */
  const shiftFromLeft = () => setFrom(ymdAddDays(from, -1));
  const shiftToRight = () => setTo(ymdAddDays(to, 1));

  /* ─── Excel-экспорт ─── */
  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportTimesheetExcel(work.id, { from, to });
      toast('Табель', 'Excel скачан', 'ok');
    } catch (e) {
      toast('Ошибка', 'Не удалось выгрузить Excel', 'err');
    } finally {
      setExporting(false);
    }
  };

  /* ─── Bulk-шаблон ─── */
  const onBulkTemplate = () => {
    if (!rows.length) {
      toast('Шаблон', 'Сначала загрузите бригаду', 'warn');
      return;
    }
    open(
      <BulkShiftModal
        workId={work.id}
        from={from}
        to={to}
        employees={rows.map((r) => ({
          employee_id: r.employee_id,
          fio: r.fio
        }))}
        onDone={() => reload()}
      />
    );
  };

  /* ─── Анкор-реф для popover'а ─── */
  const anchorRef = useRef(null);
  useEffect(() => { anchorRef.current = popState?.anchorEl || null; }, [popState]);

  /* ─── Подсчёт ИТОГО по таблице ─── */
  let grandPoints = 0, grandEarned = 0, grandPerDiem = 0, grandTotal = 0;
  const enrichedRows = rows.map((emp) => {
    const earned = parseFloat(emp.total_earned || 0);
    const points = Math.round(earned / pointValue) || 0;
    const pd = parseFloat(emp.per_diem_total || 0);
    const total = parseFloat(emp.grand_total || 0);
    grandPoints += points;
    grandEarned += earned;
    grandPerDiem += pd;
    grandTotal += total;
    return { ...emp, _points: points, _earned: earned, _perDiem: pd, _total: total };
  });

  return (
    <div className="ft-stack">
      {/* ─── Фильтры + действия ─── */}
      <div className="ft-ts-filters">
        <Btn variant="ghost" size="sm" onClick={shiftFromLeft} title="Сдвинуть начало на день влево">← День</Btn>
        <Field label="С">
          <DatePicker value={from} onChange={setFrom} />
        </Field>
        <Field label="По">
          <DatePicker value={to} onChange={setTo} />
        </Field>
        <Btn variant="ghost" size="sm" onClick={shiftToRight} title="Сдвинуть конец на день вправо">День →</Btn>
        <Btn variant="ghost" size="sm" onClick={reload} disabled={loading} title="Перезагрузить табель">
          {loading ? '⏳' : '↻'}
        </Btn>
        <Btn
          variant={editMode ? 'danger' : 'primary'}
          size="sm"
          onClick={() => { setEditMode((m) => !m); setPopState(null); }}
        >
          {editMode ? '✓ Готово' : '✎ Редактировать'}
        </Btn>
        <Btn variant="ghost" size="sm" onClick={onBulkTemplate} disabled={loading || !rows.length}>
          📅 Шаблон
        </Btn>
        <div className="ml-auto" style={{ display: 'flex', gap: 6 }}>
          <Btn variant="ghost" size="sm" onClick={onExport} disabled={exporting}>
            {exporting ? '⏳' : '📥 Excel'}
          </Btn>
        </div>
      </div>

      {loading && <div className="ft-loading">⏳ Загружаем табель…</div>}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon="📋"
          title="Записей нет"
          hint={editMode ? 'Бригада не назначена. Добавь людей во вкладке «Бригада».' : 'За выбранный период чекинов не было. Включи «Редактировать» чтобы добавить смены вручную.'}
        />
      )}

      {!loading && rows.length > 0 && (
        <div className="card ft-ts-card">
          <table className="t-list ft-ts-table">
            <thead>
              <tr>
                <th className="ft-ts-th-fio">Сотрудник</th>
                {dates.map((d) => {
                  const dow = dayOfWeek(d);
                  const isWeekend = dow === 0 || dow === 6;
                  return (
                    <th key={d} className={'ft-ts-th-day' + (isWeekend ? ' ft-ts-th-day--we' : '')}>
                      <div className="ft-ts-th-dow">{dowShort(d)}</div>
                      <div>{dayLabel(d)}</div>
                    </th>
                  );
                })}
                <th className="ft-ts-th-total">Дней</th>
                <th className="ft-ts-th-total">Баллов</th>
                <th className="ft-ts-th-total">Зараб.</th>
                <th className="ft-ts-th-total">Суточные</th>
                <th className="ft-ts-th-total ft-ts-th-grand">Итого</th>
              </tr>
            </thead>
            <tbody>
              {enrichedRows.map((emp) => {
                const inner = dayMap.get(emp.employee_id) || {};
                return (
                  <tr key={emp.employee_id} className="row-hover">
                    <td className="ft-ts-fio">{emp.fio || `#${emp.employee_id}`}</td>
                    {dates.map((d) => {
                      const day = inner[d];
                      const isWeekend = (() => { const dw = dayOfWeek(d); return dw === 0 || dw === 6; })();
                      return (
                        <ShiftCell
                          key={d}
                          day={day}
                          date={d}
                          isWeekend={isWeekend}
                          pointValue={pointValue}
                          editMode={editMode}
                          activeAnchor={popState?.anchorEl}
                          activeKey={popState ? popState.employee.employee_id + '|' + popState.date : null}
                          cellKey={emp.employee_id + '|' + d}
                          onClick={(e) => editMode && openCell(e, emp, d, day)}
                        />
                      );
                    })}
                    <td className="ft-ts-total-num">{fmtInt(emp.days_count || 0)}</td>
                    <td className="ft-ts-total-num">{fmtInt(emp._points)}</td>
                    <td className="ft-ts-total-num">{fmtMoney(emp._earned)}</td>
                    <td className="ft-ts-total-num">{fmtMoney(emp._perDiem)}</td>
                    <td className="ft-ts-total-num ft-ts-total-grand">{fmtMoney(emp._total)}</td>
                  </tr>
                );
              })}
              <tr className="ft-ts-totals-row">
                <td className="ft-ts-totals-label" colSpan={dates.length + 1}>ИТОГО:</td>
                <td className="ft-ts-total-num">{fmtInt(grandPoints)}</td>
                <td className="ft-ts-total-num">{fmtMoney(grandEarned)}</td>
                <td className="ft-ts-total-num">{fmtMoney(grandPerDiem)}</td>
                <td className="ft-ts-total-num ft-ts-total-grand">{fmtMoney(grandTotal)}</td>
              </tr>
            </tbody>
          </table>

          <div className="ft-ts-legend">
            {SHIFT_TYPES.map((st) => (
              <span key={st.value} className="ft-ts-legend-item" title={st.label}>
                <span className="ic" aria-hidden="true">{st.icon}</span>
                <span>{st.label} ({st.defaultPts} бал. = {fmtMoney(st.defaultPts * pointValue)})</span>
              </span>
            ))}
            <span className="ft-ts-legend-item">
              <span>Суточные: {fmtMoney(perDiem)}/день</span>
            </span>
          </div>
        </div>
      )}

      {/* Inline-редактор */}
      {popState && (
        <ShiftPopover
          anchorRef={anchorRef}
          open
          initial={popState.day ? {
            shift: popState.day.shift,
            hours_worked: popState.day.hours_worked,
            hours_paid: popState.day.hours_paid,
            day_rate: popState.day.day_rate,
            amount_earned: popState.day.amount,
            points: Math.round(parseFloat(popState.day.day_rate || 0) / pointValue) || 0
          } : null}
          pointValue={pointValue}
          isNew={popState.isNew}
          date={popState.date}
          employeeName={popState.employee.fio || `#${popState.employee.employee_id}`}
          onSave={(payload) => saveCheckin({
            employee: popState.employee,
            date: popState.date,
            day: popState.day,
            payload
          })}
          onDelete={popState.day ? () => removeCheckin({ date: popState.date, day: popState.day }) : null}
          onClose={() => setPopState(null)}
        />
      )}
    </div>
  );
}

/* ─── Ячейка одного дня ─── */
function ShiftCell({ day, date, isWeekend, pointValue, editMode, activeAnchor, cellKey, activeKey, onClick }) {
  const ref = useRef(null);
  const isActive = activeKey && activeKey === cellKey;
  // Сохраняем ref активной ячейки в родительский активный якорь (нужен для popover)
  useEffect(() => {
    if (isActive && ref.current && activeAnchor !== ref.current) {
      // Шанс рассинхрона минимальный — popState.anchorEl ставится в openCell сразу
    }
  });

  let content, color, bg;
  if (day) {
    const pts = Math.round(parseFloat(day.day_rate || 0) / pointValue) || 0;
    const meta = getShiftMeta(day.shift);
    content = <><span style={{ marginRight: 1 }}>{meta.icon}</span>{pts}</>;
    color = pointsColor(pts);
    bg = meta.bg;
  } else if (editMode) {
    content = '+';
    color = 'var(--t-3)';
  } else {
    content = '—';
    color = 'var(--t-3)';
  }

  const className = [
    'ft-ts-cell',
    day ? 'ft-ts-cell--filled' : '',
    editMode ? 'ft-ts-cell--edit' : '',
    isWeekend ? 'ft-ts-cell--we' : '',
    isActive ? 'ft-ts-cell--active' : ''
  ].filter(Boolean).join(' ');

  return (
    <td
      ref={ref}
      className={className}
      onClick={onClick}
      style={{ color, background: bg, cursor: editMode ? 'pointer' : 'default' }}
      title={day
        ? `${getShiftMeta(day.shift).label} · ${Math.round(parseFloat(day.day_rate || 0) / pointValue) || 0} бал. · ${fmtMoney(parseFloat(day.amount || day.amount_earned || 0))}`
        : (editMode ? 'Добавить смену' : '')}
    >
      {content}
    </td>
  );
}
