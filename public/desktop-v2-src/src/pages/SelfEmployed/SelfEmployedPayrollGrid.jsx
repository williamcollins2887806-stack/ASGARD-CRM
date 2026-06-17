/**
 * Вкладка «Ведомость-сетка» внутри /self-employed.
 *
 * Источник vanilla: `public/assets/js/payroll.js` → renderInlineGrid (вкладка «📋 Ведомость»).
 * Endpoints (см. ./api.js + src/routes/worker-payments.js):
 *   GET  /api/worker-payments/reports/payroll-grid/:year/:month
 *   PUT  /api/worker-payments/reports/payroll-grid/:year/:month/save
 *   GET  /api/worker-payments/reports/payroll-grid/:year/:month/export
 *
 * Зачем здесь: vanilla `/payroll` совмещал реестр СЗ и табельную сетку. В React-миграции
 * каноническая страница сетки — `pages/Payroll/PayrollGrid.jsx`, но бухгалтер ожидает
 * увидеть сетку и из реестра СЗ. Дублирования бизнес-логики нет — оба места дёргают
 * одни и те же endpoints, серверная агрегация одинаковая.
 *
 * RBAC: вкладка доступна ADMIN, BUH, HEAD_PM, DIRECTOR_* (PAYROLL_GRID_ROLES). PM,
 * имеющий доступ к самому реестру СЗ только на чтение, сетку здесь НЕ видит — у него
 * для своих работ есть отдельная страница /payroll-grid.
 */
import { useEffect, useMemo, useState } from 'react';
import { Btn } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  PAYROLL_GRID_MONTHS_RU,
  GRID_CATEGORY_COLORS,
  loadPayrollGrid,
  savePayrollGrid,
  exportPayrollGrid,
  buildGridPointsMap,
  gridCellStyle,
  gridNum,
  fmtMoney
} from './api';
import './self-employed.css';

const NOW = new Date();

export function SelfEmployedPayrollGrid() {
  /* Стартовый период — предыдущий месяц (vanilla: payroll.js → bindHandlers → grid таб) */
  const prevMonthDate = useMemo(() => new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1), []);
  const [year, setYear] = useState(prevMonthDate.getFullYear());
  const [month, setMonth] = useState(prevMonthDate.getMonth() + 1);

  const [gridData, setGridData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [pendingEdits, setPendingEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = async (y = year, m = month) => {
    setLoading(true);
    setPendingEdits({});
    setEditMode(false);
    try {
      const data = await loadPayrollGrid(y, m);
      setGridData(data);
    } catch (e) {
      toast('Ошибка', 'Не удалось загрузить ведомость: ' + (e?.message || e), 'err');
      setGridData(null);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(year, month); /* eslint-disable-next-line */ }, []);

  const pointsMap = useMemo(() => buildGridPointsMap(gridData?.tariff_categories || []), [gridData]);

  const monthOpts = PAYROLL_GRID_MONTHS_RU.map((m, i) => ({ value: String(i + 1), label: m }));
  const yearOpts = [-2, -1, 0, 1].map((d) => ({ value: String(NOW.getFullYear() + d), label: String(NOW.getFullYear() + d) }));

  const onSave = async () => {
    const entries = Object.entries(pendingEdits);
    if (!entries.length) { toast('Нет изменений', '', 'info'); return; }
    setSaving(true);
    try {
      const changes = entries.map(([k, v]) => {
        const [empId, day] = k.split('_');
        return { employee_id: Number(empId), day: Number(day), points: gridNum(v) };
      });
      await savePayrollGrid(year, month, changes);
      toast('Сохранено', `Ведомость обновлена: ${changes.length} ${pluralize(changes.length, ['правка', 'правки', 'правок'])}`, 'ok');
      setPendingEdits({});
      setEditMode(false);
      await load(year, month);
    } catch (e) {
      toast('Ошибка', 'Не удалось сохранить: ' + (e?.message || e), 'err');
    } finally {
      setSaving(false);
    }
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await exportPayrollGrid(year, month);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast('Готово', 'Excel скачан', 'ok');
    } catch (e) {
      toast('Ошибка', 'Не удалось скачать: ' + (e?.message || e), 'err');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="se-grid-wrap">
      {/* Селекторы периода + действия */}
      <div className="card se-grid-toolbar">
        <div className="se-grid-toolbar-month">
          <Label>Месяц</Label>
          <SelectInput value={String(month)} onChange={(v) => setMonth(Number(v))} options={monthOpts} />
        </div>
        <div className="se-grid-toolbar-year">
          <Label>Год</Label>
          <SelectInput value={String(year)} onChange={(v) => setYear(Number(v))} options={yearOpts} />
        </div>
        <Btn variant="primary" onClick={() => load(year, month)} disabled={loading}>
          {loading ? '⏳ Грузим…' : 'Сформировать'}
        </Btn>
        {gridData?.employees?.length > 0 && (
          <>
            <Btn
              variant="ghost"
              onClick={() => { setEditMode((v) => !v); setPendingEdits({}); }}
            >
              {editMode ? '✕ Отменить' : '✏ Редактировать'}
            </Btn>
            {editMode && (
              <Btn variant="primary" onClick={onSave} disabled={saving}>
                {saving ? '⏳ Сохраняем…' : '💾 Сохранить'}
              </Btn>
            )}
            <Btn variant="ghost" onClick={onExport} disabled={exporting}>
              {exporting ? '⏳ Excel…' : '📥 Excel'}
            </Btn>
          </>
        )}
      </div>

      {loading ? (
        <div className="card se-grid-loading">⏳ Грузим сетку…</div>
      ) : !gridData || !gridData.employees || gridData.employees.length === 0 ? (
        <div className="card se-grid-empty">
          Нет данных за {PAYROLL_GRID_MONTHS_RU[month - 1]} {year}. Возможно, ещё нет отметок в Field PWA — или у вас нет работ с активными выходами.
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
  return (
    <div className="se-grid-label">
      {children}
    </div>
  );
}

function GridBody({ gridData, pointsMap, editMode, pendingEdits, setPendingEdits, year, month }) {
  const employees = gridData.employees;
  const daysInMonth = gridData.month_days || new Date(year, month, 0).getDate();

  /* KPI (vanilla: renderInlineGrid → totalWorkers/totalShifts/totalFOT/totalPerDiem) */
  const totalWorkers = employees.length;
  const totalShifts = employees.reduce((s, e) => s + Number(e.days_count || 0), 0);
  const totalFOT = employees.reduce((s, e) => s + Number(e.total_amount || 0), 0);
  const totalPerDiem = employees.reduce((s, e) => s + Number(e.per_diem_total || 0), 0);

  /* Итоги по колонкам и по строкам */
  const colTotals = new Array(daysInMonth).fill(0);
  let grandPts = 0, grandAmt = 0, grandPd = 0;
  employees.forEach((emp) => {
    const days = emp.days || {};
    for (let d = 1; d <= daysInMonth; d++) {
      const pts = Number(days[d] || 0);
      if (pts) colTotals[d - 1] += pts;
    }
    grandPts += Number(emp.total_points || 0);
    grandAmt += Number(emp.total_amount || 0);
    grandPd += Number(emp.per_diem_total || 0);
  });

  /* Какие категории реально использованы — для динамической легенды */
  const usedTypes = new Set();
  employees.forEach((emp) => {
    const days = emp.days || {};
    for (const d in days) {
      const pts = Number(days[d] || 0);
      if (!pts) continue;
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
      <div className="se-grid-kpi-row">
        <KPICell label="Рабочих" value={totalWorkers} />
        <KPICell label="Смен" value={totalShifts} />
        <KPICell label="ФОТ" value={fmtMoney(totalFOT)} tone="gold" />
        <KPICell label="Суточные" value={fmtMoney(totalPerDiem)} tone="info" />
      </div>

      {/* Таблица */}
      <div className="card se-grid-table-wrap">
        <table className="se-grid-table">
          <thead>
            <tr>
              <th className="se-grid-th-fio">ФИО</th>
              {Array.from({ length: daysInMonth }, (_, i) => (
                <th key={i + 1}>{i + 1}</th>
              ))}
              <th>Дней</th>
              <th>Баллов</th>
              <th className="se-grid-th-right">Заработок</th>
              <th className="se-grid-th-right">Суточные</th>
              <th className="se-grid-th-total">ИТОГО</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp, idx) => {
              const days = emp.days || {};
              const rowBg = idx % 2 === 0 ? 'var(--bg-0)' : 'var(--inner-bg)';
              return (
                <tr key={emp.employee_id || emp.id}>
                  <td className="se-grid-cell-fio" style={{ background: rowBg }}>
                    {emp.fio || emp.full_name || `#${emp.employee_id || emp.id}`}
                    {emp.position && <div className="se-grid-cell-pos">{emp.position}</div>}
                  </td>
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const day = i + 1;
                    const pts = Number(days[day] || 0);
                    const key = (emp.employee_id || emp.id) + '_' + day;
                    if (editMode) {
                      const val = pendingEdits[key] !== undefined ? pendingEdits[key] : (pts || '');
                      return (
                        <td key={day} className="se-grid-cell-edit" style={{ background: rowBg }}>
                          <input
                            type="number"
                            value={val}
                            onChange={(e) => onCellChange(emp.employee_id || emp.id, day, e.target.value)}
                            min={0}
                            max={24}
                            className="se-grid-cell-input"
                          />
                        </td>
                      );
                    }
                    const style = gridCellStyle(pts, pointsMap);
                    if (pts) {
                      return (
                        <td
                          key={day}
                          className="se-grid-cell-pts"
                          style={{ background: style.bg, color: style.fg }}
                        >
                          {pts}
                        </td>
                      );
                    }
                    return (
                      <td key={day} className="se-grid-cell-empty" style={{ background: rowBg }}>
                        ·
                      </td>
                    );
                  })}
                  <td className="se-grid-cell-days" style={{ background: rowBg }}>{emp.days_count || 0}</td>
                  <td className="se-grid-cell-points" style={{ background: rowBg }}>{Number(emp.total_points || 0)}</td>
                  <td className="se-grid-cell-amt" style={{ background: rowBg }}>{fmtMoney(emp.total_amount)}</td>
                  <td className="se-grid-cell-pd" style={{ background: rowBg }}>{fmtMoney(emp.per_diem_total)}</td>
                  <td className="se-grid-cell-total" style={{ background: rowBg }}>
                    {fmtMoney(Number(emp.total_amount || 0) + Number(emp.per_diem_total || 0))}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="se-grid-foot-row">
              <td className="se-grid-foot-cell se-grid-foot-fio">ИТОГО</td>
              {colTotals.map((sum, i) => (
                <td key={i} className="se-grid-foot-cell se-grid-foot-day">{sum || ''}</td>
              ))}
              <td className="se-grid-foot-cell se-grid-foot-center">{totalShifts}</td>
              <td className="se-grid-foot-cell se-grid-foot-center">{Math.round(grandPts * 100) / 100}</td>
              <td className="se-grid-foot-cell se-grid-foot-right">{fmtMoney(grandAmt)}</td>
              <td className="se-grid-foot-cell se-grid-foot-right">{fmtMoney(grandPd)}</td>
              <td className="se-grid-foot-cell se-grid-foot-total">{fmtMoney(grandAmt + grandPd)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Легенда (vanilla: payroll.js → legendItems) */}
      <div className="card se-grid-legend">
        <span className="se-grid-legend-title">Обозначения:</span>
        {Object.entries(GRID_CATEGORY_COLORS).map(([type, cfg]) => {
          if (usedTypes.size && !usedTypes.has(type)) return null;
          const ptsRange = Object.entries(pointsMap).filter(([_, t]) => t === type).map(([p]) => p);
          const ptsLabel = ptsRange.length ? ` (${ptsRange.join('/')} бал.)` : '';
          return (
            <span key={type} className="se-grid-legend-item">
              <span className="se-grid-legend-swatch" style={{ background: cfg.bg }} />
              <span className="se-grid-legend-label">{cfg.label}{ptsLabel}</span>
            </span>
          );
        })}
      </div>
    </>
  );
}

function KPICell({ label, value, tone }) {
  const c = tone === 'gold' ? 'var(--gold)' : tone === 'info' ? 'var(--info)' : 'var(--t-1)';
  return (
    <div className="card se-grid-kpi">
      <div className="se-grid-kpi-label">{label}</div>
      <div className="se-grid-kpi-value" style={{ color: c }}>{value}</div>
    </div>
  );
}

function pluralize(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
