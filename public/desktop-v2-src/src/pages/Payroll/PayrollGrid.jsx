/**
 * PayrollGrid — Excel-сетка ведомости: фио × дни месяца → сумма ₽ за смену.
 * С 01.11.2026: ввод/сохранение amount_rub (шаг 10), без баллов.
 */
import { useEffect, useMemo, useState } from 'react';
import { Btn } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import {
  MONTHS_RU, CATEGORY_COLORS,
  loadPayrollGrid, savePayrollGrid,
  fmtMoney, fmtMoneyShort, num,
  buildPointsMap, pointsCellStyle
} from './api';
import { fmtCompactRub, snapRubStep10 } from '@/lib/moneyCompact';
import ExportModal from './modals/ExportModal';
import './payroll.css';

/** Карта dayNum → amount_rub из emp.days_detailed или legacy days[day]=points×500. */
function amountByDay(emp, pointValue = 500) {
  const map = {};
  if (Array.isArray(emp.days_detailed) && emp.days_detailed.length) {
    for (const d of emp.days_detailed) {
      const day = d.day || (d.date ? new Date(d.date).getDate() : null);
      if (!day) continue;
      map[day] = Number(d.amount != null ? d.amount : (d.points || 0) * pointValue) || 0;
    }
    return map;
  }
  const days = emp.days || {};
  for (const [k, v] of Object.entries(days)) {
    const pts = Number(v) || 0;
    map[k] = pts > 50 ? pts : pts * pointValue; // >50 уже похоже на ₽
  }
  return map;
}

const NOW = new Date();

export default function PayrollGrid({ _embedded = false }) {
  const modal = useModal();

  /* Стартовый период — предыдущий месяц (по факту это «закрываемый» табель) */
  const prevMonthDate = useMemo(() => new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1), []);
  const [year,  setYear]  = useState(prevMonthDate.getFullYear());
  const [month, setMonth] = useState(prevMonthDate.getMonth() + 1);

  const [gridData, setGridData] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [pendingEdits, setPendingEdits] = useState({}); // { "empId_day": "10" }
  const [saving, setSaving] = useState(false);

  const load = async (y = year, m = month) => {
    setLoading(true);
    setPendingEdits({});
    setEditMode(false);
    try {
      const data = await loadPayrollGrid(y, m);
      setGridData(data);
    } catch (e) {
      toast.error('Не удалось загрузить ведомость: ' + (e?.message || e));
      setGridData(null);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(year, month); /* eslint-disable-next-line */ }, []);

  const pointsMap = useMemo(() => buildPointsMap(gridData?.tariff_categories || []), [gridData]);

  const monthOpts = MONTHS_RU.map((m, i) => ({ value: String(i + 1), label: m }));
  const yearOpts  = [-2, -1, 0, 1].map((d) => ({ value: String(NOW.getFullYear() + d), label: String(NOW.getFullYear() + d) }));

  const onSave = async () => {
    const entries = Object.entries(pendingEdits);
    if (!entries.length) { toast.info('Нет изменений'); return; }
    setSaving(true);
    try {
      const changes = entries.map(([k, v]) => {
        const [empId, day] = k.split('_');
        return { employee_id: Number(empId), day: Number(day), amount_rub: snapRubStep10(num(v)) };
      });
      await savePayrollGrid(year, month, changes);
      toast.success('Ведомость обновлена', { title: `Изменено ${changes.length}` });
      setPendingEdits({});
      setEditMode(false);
      await load(year, month);
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const onExport = () => modal.open(<ExportModal defaultMode="grid" sheet={{ period_from: `${year}-${String(month).padStart(2, '0')}-01` }} />);

  return (
    <div className="col gap-12">
      {/* Селекторы периода */}
      <div className="card pyr-period-bar">
        <div className="mw-160">
          <Label>Месяц</Label>
          <SelectInput value={String(month)} onChange={(v) => setMonth(Number(v))} options={monthOpts} />
        </div>
        <div className="mw-110">
          <Label>Год</Label>
          <SelectInput value={String(year)} onChange={(v) => setYear(Number(v))} options={yearOpts} />
        </div>
        <Btn variant="primary" onClick={() => load(year, month)} disabled={loading}>
          {loading ? '⏳ Грузим…' : 'Сформировать'}
        </Btn>
        {gridData?.employees?.length > 0 && (
          <>
            <Btn variant="ghost" onClick={() => { setEditMode((v) => !v); setPendingEdits({}); }}>
              {editMode ? '✕ Отменить' : '✏ Редактировать'}
            </Btn>
            {editMode && (
              <Btn variant="primary" onClick={onSave} disabled={saving}>
                {saving ? '⏳ Сохраняем…' : '💾 Сохранить'}
              </Btn>
            )}
            <Btn variant="ghost" onClick={onExport}>📥 Excel</Btn>
          </>
        )}
      </div>

      {loading ? (
        <div className="card card-loader">⏳ Грузим сетку…</div>
      ) : !gridData || !gridData.employees || gridData.employees.length === 0 ? (
        <div className="card card-loader-32">
          Нет данных за {MONTHS_RU[month - 1]} {year}. Возможно, ещё нет ни одной отметки в Field PWA.
        </div>
      ) : (
        <GridBody
          gridData={gridData}
          pointsMap={pointsMap}
          editMode={editMode}
          pendingEdits={pendingEdits}
          setPendingEdits={setPendingEdits}
          year={year}
          month={month}
        />
      )}
    </div>
  );
}

function Label({ children }) {
  return <div className="pyr-label">{children}</div>;
}

function GridBody({ gridData, pointsMap, editMode, pendingEdits, setPendingEdits, year, month }) {
  const employees   = gridData.employees;
  const daysInMonth = gridData.month_days || new Date(year, month, 0).getDate();
  const pointValue  = Number(gridData.point_value) || 500;

  /* KPI */
  const totalWorkers  = employees.length;
  const totalShifts   = employees.reduce((s, e) => s + Number(e.days_count || 0), 0);
  const totalFOT      = employees.reduce((s, e) => s + Number(e.total_amount || 0), 0);
  const totalPerDiem  = employees.reduce((s, e) => s + Number(e.per_diem_total || 0), 0);

  /* Footer totals per day (₽) */
  const colTotals = new Array(daysInMonth).fill(0);
  let grandAmt = 0, grandPd = 0;

  employees.forEach((emp) => {
    const amap = amountByDay(emp, pointValue);
    for (let d = 1; d <= daysInMonth; d++) {
      const rub = Number(amap[d] || 0);
      if (rub) colTotals[d - 1] += rub;
    }
    grandAmt += Number(emp.total_amount || 0);
    grandPd  += Number(emp.per_diem_total || 0);
  });

  /* Легенда: тип по legacy-баллам (amount/500) */
  const usedTypes = new Set();
  employees.forEach((emp) => {
    const amap = amountByDay(emp, pointValue);
    for (const d in amap) {
      const rub = Number(amap[d] || 0);
      if (!rub) continue;
      const pts = Math.round(rub / pointValue);
      const t = pointsMap[pts] || 'work';
      usedTypes.add(t);
    }
  });

  const onCellChange = (empId, day, value) => {
    setPendingEdits((p) => ({ ...p, [empId + '_' + day]: value }));
  };

  return (
    <>
      {/* KPI */}
      <div className="grid-auto-160 gap-10">
        <KPICell label="Рабочих" value={totalWorkers} />
        <KPICell label="Смен"    value={totalShifts} />
        <KPICell label="ФОТ"     value={fmtMoneyShort(totalFOT)} tone="gold" />
        <KPICell label="Суточные" value={fmtMoneyShort(totalPerDiem)} tone="info" />
      </div>

      {/* Таблица */}
      <div className="card pyr-grid-wrap">
        <table className="pyr-grid">
          <thead>
            <tr className="bg-inner">
              <th className="pyr-th pyr-th-fio">ФИО</th>
              {Array.from({ length: daysInMonth }, (_, i) => (
                <th key={i + 1} className="pyr-th pyr-th-day">{i + 1}</th>
              ))}
              <th className="pyr-th">Дней</th>
              <th className="pyr-th pyr-th-r">Заработок</th>
              <th className="pyr-th pyr-th-r">Суточные</th>
              <th className="pyr-th pyr-th-r c-ok">ИТОГО</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp, idx) => {
              const amap = amountByDay(emp, pointValue);
              const rowEven = idx % 2 === 0;
              return (
                <tr key={emp.employee_id || emp.id} className={rowEven ? 'pyr-row-even' : 'pyr-row-odd'}>
                  <td className="pyr-td pyr-td-fio">
                    {emp.fio || emp.full_name || `#${emp.employee_id || emp.id}`}
                    {emp.position && <div className="pyr-td-pos">{emp.position}</div>}
                  </td>
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const day = i + 1;
                    const rub = Number(amap[day] || 0);
                    const key = (emp.employee_id || emp.id) + '_' + day;
                    if (editMode) {
                      const val = pendingEdits[key] !== undefined ? pendingEdits[key] : (rub || '');
                      return (
                        <td key={day} className="pyr-td pyr-td-edit">
                          <input
                            type="number"
                            value={val}
                            onChange={(e) => onCellChange(emp.employee_id || emp.id, day, e.target.value)}
                            min={0}
                            step={10}
                            className="pyr-cell-input"
                            title="Сумма ₽"
                          />
                        </td>
                      );
                    }
                    const ptsApprox = Math.round(rub / pointValue);
                    const style = pointsCellStyle(ptsApprox, pointsMap);
                    if (rub) {
                      return (
                        <td
                          key={day}
                          className="pyr-td pyr-td-pts"
                          style={{ background: style.bg, color: style.fg }}
                          title={fmtMoney(rub)}
                        >
                          {fmtCompactRub(rub) || Math.round(rub)}
                        </td>
                      );
                    }
                    return <td key={day} className="pyr-td pyr-td-zero">·</td>;
                  })}
                  <td className="pyr-td pyr-td-c pyr-td-bold">{emp.days_count || 0}</td>
                  <td className="pyr-td pyr-td-r c-ok">{fmtMoney(emp.total_amount)}</td>
                  <td className="pyr-td pyr-td-r pyr-td-pd">{fmtMoney(emp.per_diem_total)}</td>
                  <td className="pyr-td pyr-td-r pyr-td-itog">{fmtMoney(Number(emp.total_amount || 0) + Number(emp.per_diem_total || 0))}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="pyr-tfoot">
              <td className="pyr-td pyr-tfoot-fio">ИТОГО</td>
              {colTotals.map((sum, i) => (
                <td key={i} className="pyr-td pyr-tfoot-c" title={sum ? fmtMoney(sum) : ''}>
                  {sum ? (fmtCompactRub(sum) || Math.round(sum)) : ''}
                </td>
              ))}
              <td className="pyr-td pyr-tfoot-c">{totalShifts}</td>
              <td className="pyr-td pyr-tfoot-r">{fmtMoney(grandAmt)}</td>
              <td className="pyr-td pyr-tfoot-r">{fmtMoney(grandPd)}</td>
              <td className="pyr-td pyr-tfoot-r pyr-tfoot-grand">{fmtMoney(grandAmt + grandPd)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Легенда */}
      <div className="card pyr-legend">
        <span className="fw-700 c-t2">Обозначения:</span>
        {Object.entries(CATEGORY_COLORS).map(([type, cfg]) => {
          if (usedTypes.size && !usedTypes.has(type)) return null;
          return (
            <span key={type} className="pyr-legend-chip">
              <span className="pyr-legend-sw" style={{ background: cfg.bg }} />
              <span className="c-t2">{cfg.label}</span>
            </span>
          );
        })}
      </div>
    </>
  );
}

function KPICell({ label, value, tone }) {
  const c = tone === 'gold' ? 'c-gold' : tone === 'info' ? 'c-info' : 'c-t1';
  return (
    <div className="card pyr-kpi">
      <div className="pyr-kpi-label">{label}</div>
      <div className={`pyr-kpi-value ${c}`}>{value}</div>
    </div>
  );
}
