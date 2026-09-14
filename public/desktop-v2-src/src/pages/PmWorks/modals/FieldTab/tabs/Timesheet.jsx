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
import { MCard, MHead, MBody, MFoot } from '@/modals/parts';
import {
  loadTimesheet, exportTimesheetExcel, loadDashboard,
  createCheckin, updateCheckin, deleteCheckin
} from '../api';
import {
  SHIFT_TYPES, getShiftMeta, fmtMoney, fmtInt, pointsColor,
  buildDateRange, dayLabel, dowShort, dayOfWeek,
  extractPointValue, todayYmd
} from './timesheetUtils';
import { ShiftPopover } from './ShiftPopover';
import { BulkShiftModal } from './BulkShiftModal';

/* По умолчанию: текущий календарный месяц.
 * Раньше брали весь срок работы (±7 дней) — на длинных объектах 600+ колонок
 * и UI «невозможно использовать». Как в общем табеле — месяц. */
function defaultRange(_work) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to, viewY: y, viewM: m };
}

const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function monthBounds(y, m) {
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

export default function TimesheetTab({ work }) {
  const { open } = useModal();
  const def = useMemo(() => defaultRange(work), [work?.id]);
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [viewY, setViewY] = useState(def.viewY);
  const [viewM, setViewM] = useState(def.viewM);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [pointValue, setPointValue] = useState(500);
  const [exporting, setExporting] = useState(false);

  // Якорь и контекст popover'а (один на всю таблицу — экономит на DOM)
  const [popState, setPopState] = useState(null);
  // { anchorEl, employee, date, day | null, isNew }

  // Локальный флаг: текущий показ это «strawman из crew» (без чекинов)?
  // Нужен, чтобы EmptyState показывался ТОЛЬКО когда и timesheet пустой, и crew пустая.
  const [crewEmpty, setCrewEmpty] = useState(false);

  const reload = async () => {
    setLoading(true);
    setCrewEmpty(false);
    try {
      const d0 = new Date(from + 'T12:00:00Z');
      const d1 = new Date(to + 'T12:00:00Z');
      const daysSpan = Math.round((d1 - d0) / 86400000) + 1;
      // Произвольный период > месяца разрешён; предупреждаем только при экстремальной длине.
      if (daysSpan > 186) {
        toast('Табель', `Длинный период (${daysSpan} дн.) — таблица может тормозить. Для правок удобнее месяц ← → или «Этот месяц».`, 'warn');
      }
      const d = await loadTimesheet(work.id, { from, to });
      const safe = d || { timesheet: [], per_diem_rate: 0 };
      const tsArr = Array.isArray(safe.timesheet) ? safe.timesheet : [];

      // Vanilla parity: field-tab.js:1254-1277 — если timesheet пустой (никто
      // ещё не отмечался), всегда подтягиваем бригаду из /dashboard.crew и
      // показываем пустые ячейки. РП тыкает «+» → создаётся первый чекин.
      if (tsArr.length === 0) {
        try {
          const dash = await loadDashboard(work.id);
          const crew = Array.isArray(dash?.crew) ? dash.crew : [];
          if (crew.length) {
            safe.timesheet = crew.map((c) => ({
              employee_id: c.employee_id,
              fio: c.fio || c.employee_name || ('ID ' + c.employee_id),
              days: [],
              days_count: 0,
              total_hours: 0,
              total_paid_hours: 0,
              total_earned: 0,
              per_diem_total: 0,
              grand_total: 0
            }));
          } else {
            // Никого не назначили на работу — покажем EmptyState с подсказкой
            // про вкладку «Бригада» (см. рендер ниже).
            setCrewEmpty(true);
          }
        } catch (_) {
          // /dashboard недоступен — оставляем пустоту, EmptyState старого вида.
          setCrewEmpty(true);
        }
      }

      setData(safe);
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

  const rows = useMemo(() => {
    const list = Array.isArray(data?.timesheet) ? data.timesheet.slice() : [];
    // Сначала действующие / с отметками, затем «только план»; внутри — А→Я
    list.sort((a, b) => {
      const ap = a.is_planned_only ? 1 : 0;
      const bp = b.is_planned_only ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return String(a.fio || '').localeCompare(String(b.fio || ''), 'ru', { sensitivity: 'base' });
    });
    return list;
  }, [data?.timesheet]);
  const perDiem = parseFloat(data?.per_diem_rate || 0);

  const goMonth = (y, m) => {
    let yy = y; let mm = m;
    if (mm < 1) { mm = 12; yy -= 1; }
    if (mm > 12) { mm = 1; yy += 1; }
    const b = monthBounds(yy, mm);
    setViewY(yy); setViewM(mm);
    setFrom(b.from); setTo(b.to);
  };

  const monthLabel = useMemo(() => {
    const b = monthBounds(viewY, viewM);
    if (from === b.from && to === b.to) return `${MONTHS_RU[viewM - 1]} ${viewY}`;
    const fmt = (ymd) => {
      const p = String(ymd || '').slice(0, 10).split('-');
      return p.length >= 3 ? `${p[2]}.${p[1]}.${p[0].slice(2)}` : ymd;
    };
    return `${fmt(from)} — ${fmt(to)}`;
  }, [from, to, viewY, viewM]);

  const todayStr = useMemo(() => todayYmd(), []);

  const dates = useMemo(() => buildDateRange(from, to), [from, to]);

  // Прокрутка к сегодняшнему дню в шапке
  useEffect(() => {
    if (loading || !dates.includes(todayStr)) return;
    const el = document.querySelector(`th.ft-ts-th-day--today`);
    if (el && typeof el.scrollIntoView === 'function') {
      try { el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (_) {}
    }
  }, [loading, dates, todayStr]);

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

  // 25.06.2026: чужие чекины — рендерим как «занят» с tooltip «РП X, работа Y».
  // Раньше клетка была пустой, и РП мог случайно поставить свой чекин поверх
  // (см. инцидент Климакин 23.06 → Пономарёв work=353).
  const foreignMap = useMemo(() => {
    const m = new Map();
    rows.forEach((emp) => {
      const inner = {};
      (emp.foreign_days || []).forEach((d) => { inner[String(d.date).slice(0, 10)] = d; });
      m.set(emp.employee_id, inner);
    });
    return m;
  }, [rows]);

  /* ─── CRUD: создать/обновить/удалить смену ─── */
  const saveCheckin = async ({ employee, date, day, payload }) => {
    const trySave = async (body) => {
      if (day && day.id) {
        await updateCheckin(work.id, day.id, body);
        toast('Табель', `Смена ${dayLabel(date)} обновлена`, 'ok');
      } else {
        await createCheckin(work.id, { employee_id: employee.employee_id, date, ...body });
        toast('Табель', `${getShiftMeta(payload.shift).label} ${dayLabel(date)} добавлена`, 'ok');
      }
    };
    try {
      await trySave(payload);
      setPopState(null);
      await reload();
    } catch (e) {
      if (e?.status === 409 && e?.data?.requires_confirmation && !payload.confirm_overwrite) {
        const ok = window.confirm(e.data.message || e.message || 'На дату уже есть отметка. Перезаписать?');
        if (!ok) return;
        try {
          await trySave({ ...payload, confirm_overwrite: true });
          setPopState(null);
          await reload();
          return;
        } catch (e2) {
          toast('Ошибка', String(e2?.data?.message || e2?.message || e2), 'err');
          return;
        }
      }
      toast('Ошибка', String(e?.data?.message || e?.message || e), 'err');
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
    if (employee?.is_planned_only) {
      toast('В плане', 'Смены появятся после назначения в бригаду. Сейчас только подсветка даты заезда.', 'warn');
      return;
    }
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

  /* ─── Excel-экспорт ─── */
  const onExport = () => {
    if (exporting) return;
    open(
      <ExportPerDiemModal
        onGo={async (includePerDiem) => {
          setExporting(true);
          try {
            await exportTimesheetExcel(work.id, { from, to, include_per_diem: includePerDiem });
            toast('Табель', includePerDiem ? 'Excel со суточными' : 'Excel без суточных', 'ok');
          } catch (e) {
            toast('Ошибка', 'Не удалось выгрузить Excel', 'err');
          } finally {
            setExporting(false);
          }
        }}
      />
    );
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
        <Btn variant="ghost" size="sm" onClick={() => goMonth(viewY, viewM - 1)} title="Предыдущий месяц">←</Btn>
        <span style={{ fontWeight: 600, minWidth: 140, textAlign: 'center' }}>{monthLabel}</span>
        <Btn variant="ghost" size="sm" onClick={() => goMonth(viewY, viewM + 1)} title="Следующий месяц">→</Btn>
        <Btn variant="ghost" size="sm" onClick={() => {
          const t = new Date();
          goMonth(t.getFullYear(), t.getMonth() + 1);
        }}>Этот месяц</Btn>
        <Field label="С">
          <DatePicker value={from} onChange={setFrom} />
        </Field>
        <Field label="По">
          <DatePicker value={to} onChange={setTo} />
        </Field>
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
          title={crewEmpty ? 'Бригада не назначена' : 'Записей нет'}
          hint={crewEmpty
            ? 'Никого не назначено в бригаду — перейди на вкладку «Бригада» и добавь сотрудников.'
            : (editMode
                ? 'Бригада не назначена. Добавь людей во вкладке «Бригада».'
                : 'За выбранный период чекинов не было. Включи «Редактировать» чтобы добавить смены вручную.')}
        />
      )}

      {!loading && rows.length > 0 && (
        <div className="card ft-ts-card">
          <table className="t-list ft-ts-table">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: 'center' }}>#</th>
                <th className="ft-ts-th-fio">Сотрудник</th>
                {dates.map((d) => {
                  const dow = dayOfWeek(d);
                  const isWeekend = dow === 0 || dow === 6;
                  const isToday = d === todayStr;
                  return (
                    <th
                      key={d}
                      className={
                        'ft-ts-th-day'
                        + (isWeekend ? ' ft-ts-th-day--we' : '')
                        + (isToday ? ' ft-ts-th-day--today' : '')
                      }
                      title={isToday ? 'Сегодня' : undefined}
                    >
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
              {enrichedRows.map((emp, idx) => {
                const inner = dayMap.get(emp.employee_id) || {};
                const innerForeign = foreignMap.get(emp.employee_id) || {};
                const planFrom = emp.planned_info?.planned_from
                  ? String(emp.planned_info.planned_from).slice(0, 10)
                  : null;
                const planTo = emp.planned_info?.planned_to
                  ? String(emp.planned_info.planned_to).slice(0, 10)
                  : null;
                const reasons = emp.roster_reasons || [];
                const rowClass = [
                  'row-hover',
                  emp.is_planned_only ? 'ft-ts-row--planned' : '',
                  reasons.includes('was_on') && !reasons.includes('on_site') ? 'ft-ts-row--was' : ''
                ].filter(Boolean).join(' ');
                return (
                  <tr key={emp.employee_id} className={rowClass}>
                    <td className="ft-ts-num">{idx + 1}</td>
                    <td className="ft-ts-fio">
                      <div className="ft-ts-fio-main">{emp.fio || `#${emp.employee_id}`}</div>
                      <div className="ft-ts-fio-badges">
                        {reasons.includes('on_site') && (
                          <span className="ft-ts-badge ft-ts-badge--crew" title="Сейчас в бригаде">в бригаде</span>
                        )}
                        {reasons.includes('was_on') && !reasons.includes('on_site') && (
                          <span className="ft-ts-badge ft-ts-badge--was" title="Был на объекте в этом периоде">был</span>
                        )}
                        {reasons.includes('planned') && (
                          <span
                            className="ft-ts-badge ft-ts-badge--plan"
                            title={
                              planFrom
                                ? `План заезда с ${planFrom}${planTo ? ` по ${planTo}` : ''}`
                                : 'Планируемое привлечение'
                            }
                          >
                            в плане{planFrom ? ` · ${planFrom.slice(8, 10)}.${planFrom.slice(5, 7)}` : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    {dates.map((d) => {
                      const day = inner[d];
                      const foreign = !day ? innerForeign[d] : null;
                      const isWeekend = (() => { const dw = dayOfWeek(d); return dw === 0 || dw === 6; })();
                      const isToday = d === todayStr;
                      const isPlanArrive = !!(planFrom && d === planFrom);
                      const isPlanSpan = !!(planFrom && planTo && d > planFrom && d <= planTo && !day);
                      return (
                        <ShiftCell
                          key={d}
                          day={day}
                          foreign={foreign}
                          date={d}
                          isWeekend={isWeekend}
                          isToday={isToday}
                          isPlanArrive={isPlanArrive}
                          isPlanSpan={isPlanSpan}
                          plannedOnly={!!emp.is_planned_only}
                          pointValue={pointValue}
                          editMode={editMode && !emp.is_planned_only}
                          activeAnchor={popState?.anchorEl}
                          activeKey={popState ? popState.employee.employee_id + '|' + popState.date : null}
                          cellKey={emp.employee_id + '|' + d}
                          onClick={(e) => {
                            if (foreign) {
                              toast('Занят на другой работе',
                                'Работает у РП ' + (foreign.pm_fio || '—') + ' (работа: ' + (foreign.work_title || '—') + '). Свяжитесь с РП, чтобы перенести.',
                                'warn');
                              return;
                            }
                            if (emp.is_planned_only) {
                              toast('В плане',
                                planFrom
                                  ? `Планируемый заезд ${planFrom.slice(8, 10)}.${planFrom.slice(5, 7)}. Отметки — после назначения в бригаду.`
                                  : 'Планируемое привлечение. Отметки — после назначения в бригаду.',
                                'warn');
                              return;
                            }
                            if (!editMode) return;
                            if (day?.kind === 'stage') {
                              toast('Этап',
                                (getShiftMeta(day.shift).label || 'Отметка') + ' из маршрутов — правьте во вкладке «Маршруты» или в «Мой табель».',
                                'warn');
                              return;
                            }
                            openCell(e, emp, d, day);
                          }}
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
                <td className="ft-ts-totals-label" colSpan={dates.length + 2}>ИТОГО:</td>
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
              <span className="ft-ts-badge ft-ts-badge--plan">в плане</span>
              <span>планируемое привлечение</span>
            </span>
            <span className="ft-ts-legend-item">
              <span className="ft-ts-legend-plan-swatch" aria-hidden="true" />
              <span>день планируемого заезда</span>
            </span>
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
            points: Math.round(parseFloat(popState.day.amount ?? popState.day.amount_earned ?? popState.day.day_rate ?? 0) / pointValue) || 0
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
function ShiftCell({
  day, foreign, date, isWeekend, isToday, isPlanArrive, isPlanSpan, plannedOnly,
  pointValue, editMode, activeAnchor, cellKey, activeKey, onClick
}) {
  const ref = useRef(null);
  const isActive = activeKey && activeKey === cellKey;
  useEffect(() => {
    if (isActive && ref.current && activeAnchor !== ref.current) {
      // popState.anchorEl ставится в openCell сразу
    }
  });

  let content, color, bg, titleTxt;
  if (day) {
    const pts = Math.round(parseFloat(day.amount ?? day.amount_earned ?? day.day_rate ?? 0) / pointValue) || 0;
    const meta = getShiftMeta(day.shift);
    content = <><span style={{ marginRight: 1 }}>{meta.icon}</span>{pts}</>;
    color = pointsColor(pts);
    bg = meta.bg;
    titleTxt = `${getShiftMeta(day.shift).label} · ${pts} бал. · ${fmtMoney(parseFloat(day.amount || day.amount_earned || 0))}`;
    if (isPlanArrive) titleTxt = `Планируемый заезд · ${titleTxt}`;
  } else if (foreign) {
    content = '🔒';
    color = 'var(--t-3)';
    bg = 'rgba(245,158,11,0.10)';
    titleTxt = 'Занят на работе «' + (foreign.work_title || '—') + '» (РП ' + (foreign.pm_fio || '—') + '). Поставить чекин нельзя.';
  } else if (isPlanArrive) {
    content = <span className="ft-ts-plan-pin" aria-hidden="true">◆</span>;
    color = 'var(--gold)';
    titleTxt = 'Планируемый заезд';
  } else if (editMode && !plannedOnly) {
    content = '+';
    color = 'var(--t-3)';
    titleTxt = 'Добавить смену';
  } else if (isPlanSpan) {
    content = '';
    color = 'var(--t-3)';
    titleTxt = 'Период плана привлечения';
  } else {
    content = plannedOnly ? '' : '—';
    color = 'var(--t-3)';
    titleTxt = plannedOnly ? 'В плане — отметки после назначения в бригаду' : '';
  }

  const className = [
    'ft-ts-cell',
    day ? 'ft-ts-cell--filled' : '',
    foreign ? 'ft-ts-cell--foreign' : '',
    editMode && !plannedOnly ? 'ft-ts-cell--edit' : '',
    isWeekend ? 'ft-ts-cell--we' : '',
    isToday ? 'ft-ts-cell--today' : '',
    isActive ? 'ft-ts-cell--active' : '',
    isPlanArrive ? 'ft-ts-cell--plan-arrive' : '',
    isPlanSpan && !day && !isPlanArrive ? 'ft-ts-cell--plan-span' : '',
    plannedOnly ? 'ft-ts-cell--planned-row' : ''
  ].filter(Boolean).join(' ');

  return (
    <td
      ref={ref}
      className={className}
      onClick={onClick}
      style={{
        color, background: bg,
        cursor: foreign || plannedOnly
          ? (isPlanArrive || plannedOnly ? 'help' : 'not-allowed')
          : (editMode ? 'pointer' : 'default'),
        opacity: foreign ? 0.65 : 1
      }}
      title={titleTxt || (isToday ? 'Сегодня' : '')}
    >
      {content}
    </td>
  );
}

/** Модалка опций Excel: суточные вкл/выкл */
function ExportPerDiemModal({ onGo }) {
  const { close } = useModal();
  const [pd, setPd] = useState(true);
  return (
    <MCard className="frame-inside" style={{ maxWidth: 420 }}>
      <MHead icon="📥" title="Выгрузка табеля Excel" accent="gold" onClose={close} />
      <MBody>
        <p style={{ fontSize: 13, color: 'var(--t2)', margin: '0 0 12px', lineHeight: 1.45 }}>
          В ячейках — только баллы, цвет = тип смены. Легенда под таблицей на одном листе.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={pd} onChange={(e) => setPd(e.target.checked)} />
          Учитывать суточные
        </label>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={() => { close(); onGo?.(pd); }}>Скачать Excel</Btn>
      </MFoot>
    </MCard>
  );
}
