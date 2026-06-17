/**
 * Страница /global-timesheet — Общий табель.
 * Источник: vanilla `public/assets/js/global_timesheet.js` (~287 строк)
 * + backend `src/routes/global-timesheet.js`.
 *
 *   ✅ index.jsx              — root + KPI + матрица + Excel-экспорт + auto-refresh
 *   ✅ api.js                 — endpoints + типы ячеек + RBAC editable
 *   ✅ TypePickerModal.jsx    — выбор типа отметки
 *   ✅ global-timesheet.css   — стили sticky-таблицы
 *
 * RBAC: см. api.js (VIEW_ROLES + editableTypesForRole).
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';

import {
  VIEW_ROLES, CELL_TYPES,
  editableTypesForRole, isDirectorRole,
  fmt, daysInMonth, monthLabel,
  loadTimesheet, putEntry, downloadExport,
  flatten, groupByWork
} from './api';
import { TypePickerModal } from './TypePickerModal';
import './global-timesheet.css';

const REFRESH_MS = 30000;

export default function GlobalTimesheetPage() {
  const { user } = useAuth();
  const modal = useModal();

  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1..12
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (user && !(VIEW_ROLES.includes(user.role) || isDirectorRole(user.role))) {
      setDenied(true);
    }
  }, [user]);

  const editableTypes = useMemo(
    () => (user ? editableTypesForRole(user.role) : []),
    [user]
  );
  const canEdit = editableTypes.length > 0;

  const refresh = useCallback(() => {
    if (denied) return;
    setLoading(true);
    loadTimesheet(year, month)
      .then(setData)
      .catch((e) => toast.error('Не удалось загрузить табель: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, [year, month, denied]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh каждые 30 секунд
  useEffect(() => {
    if (denied) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      loadTimesheet(year, month).then(setData).catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [year, month, denied]);

  const onPrev = () => {
    if (month <= 1) { setMonth(12); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  };
  const onNext = () => {
    if (month >= 12) { setMonth(1); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  };

  const onExport = async () => {
    try {
      await downloadExport(year, month);
      toast.success('Файл скачан');
    } catch (e) {
      toast.error('Не удалось скачать: ' + (e?.message || e));
    }
  };

  const onCellClick = (row, dateIso) => {
    if (!canEdit) return;
    // Если выбран тип, требующий work_id (day/night), а у строки work_id=0 — предупредим в модалке
    modal.open(
      <TypePickerModal
        employeeId={row.employee_id}
        fio={row.fio}
        date={dateIso}
        workId={row.work_id}
        editableTypes={editableTypes}
        onPick={async (type) => {
          if ((type === 'day' || type === 'night') && !row.work_id) {
            toast.error('Для «День/Ночь» нужна работа у строки сотрудника');
            return;
          }
          try {
            await putEntry({
              employee_id: row.employee_id,
              work_id: row.work_id || null,
              date: dateIso,
              type
            });
            toast.success('Отметка добавлена');
            refresh();
          } catch (e) {
            toast.error('Не удалось сохранить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const dim = daysInMonth(year, month);
  const days = useMemo(() => {
    const arr = [];
    for (let d = 1; d <= dim; d++) {
      const dt = new Date(year, month - 1, d);
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const wd = dt.getDay();
      arr.push({ d, iso, weekend: wd === 0 || wd === 6 });
    }
    return arr;
  }, [year, month, dim]);

  const flatRows = useMemo(() => flatten(data || { employees: [] }), [data]);
  const groups = useMemo(() => groupByWork(flatRows), [flatRows]);

  const totals = useMemo(() => {
    const emps = data?.employees || [];
    const totalEmps = emps.length;
    const totalDays = (data?.total?.days != null)
      ? data.total.days
      : flatRows.reduce((s, r) => s + r.total_days, 0);
    const totalAmount = (data?.total?.amount != null)
      ? data.total.amount
      : flatRows.reduce((s, r) => s + r.total_amount, 0);
    return { totalEmps, totalDays, totalAmount };
  }, [data, flatRows]);

  // Гейт «нет доступа» — ПОСЛЕ всех хуков (Rules of Hooks).
  if (denied) {
    return (
      <div className="p-32">
        <EmptyState
          icon="🔒"
          title="Доступ закрыт"
          hint="Раздел «Общий табель» доступен ролям ADMIN, DIRECTOR_*, TO, HEAD_TO, WAREHOUSE, HR."
          action={null}
        />
      </div>
    );
  }

  return (
    <div className="gts-page">
      <TopActionsBar
        kicker="Дружина"
        title="Общий табель"
        subtitle="Чекины + этапы командировок — сводно по всем рабочим"
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="primary" onClick={onExport}>📥 Excel</Btn>
          </>
        }
      />

      <div className="gts-controls">
        <div className="gts-period-nav">
          <Btn variant="ghost" onClick={onPrev}>◀</Btn>
          <span className="gts-period">{monthLabel(year, month)}</span>
          <Btn variant="ghost" onClick={onNext}>▶</Btn>
        </div>
        <div className="gts-stats">
          <span className="gts-stats-pill ok">{totals.totalEmps} рабочих</span>
          <span className="gts-stats-pill info">{totals.totalDays} чел-дней</span>
          <span className="gts-stats-pill gold">{fmt(totals.totalAmount)} ₽</span>
        </div>
      </div>

      {loading ? (
        <div className="gts-wrap"><div className="gts-empty">⏳ Загружаем табель…</div></div>
      ) : flatRows.length === 0 ? (
        <div className="gts-wrap"><div className="gts-empty">Нет данных за выбранный период</div></div>
      ) : (
        <div className="gts-wrap">
          <table className="gts-table">
            <thead>
              <tr>
                <th>ФИО / Объект</th>
                {days.map((d) => (
                  <th key={d.iso} className={d.weekend ? 'gts-th-weekend' : ''}>{d.d}</th>
                ))}
                <th className="gts-total">Дни</th>
                <th className="gts-total">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Group
                  key={g.title}
                  group={g}
                  days={days}
                  daysInMonth={dim}
                  canEdit={canEdit}
                  onCellClick={onCellClick}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Group({ group, days, daysInMonth, canEdit, onCellClick }) {
  return (
    <>
      <tr className="gts-group-header">
        <td colSpan={daysInMonth + 3}>{group.title}</td>
      </tr>
      {group.items.map((row, i) => (
        <tr key={`${row.employee_id}-${row.work_id}-${i}`}>
          <td>
            <div className="gts-fio">{row.fio || '—'}</div>
            {row.role_tag && <div className="gts-role">{row.role_tag}</div>}
          </td>
          {days.map((d) => {
            const entry = row.cells?.[d.iso];
            if (entry && entry.type) {
              const ct = CELL_TYPES[entry.type] || CELL_TYPES.day;
              const tip = ct.title + (entry.amount ? ` · ${new Intl.NumberFormat('ru-RU').format(Math.round(entry.amount))} ₽` : '');
              return (
                <td key={d.iso}>
                  <div className="gts-cell" style={{ background: ct.bg, color: ct.color }} title={tip}>
                    {ct.label}
                  </div>
                </td>
              );
            }
            return (
              <td key={d.iso}>
                <div
                  className={'gts-cell' + (canEdit ? ' editable' : '')}
                  title={canEdit ? 'Добавить отметку' : ''}
                  onClick={canEdit ? () => onCellClick(row, d.iso) : undefined}
                />
              </td>
            );
          })}
          <td className="gts-total">{row.total_days || 0}</td>
          <td className="gts-sum">{new Intl.NumberFormat('ru-RU').format(Math.round(row.total_amount || 0))} ₽</td>
        </tr>
      ))}
    </>
  );
}
