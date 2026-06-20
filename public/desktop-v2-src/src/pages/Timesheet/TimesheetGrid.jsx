/**
 * TimesheetGrid — главная таблица ФИО × дни месяца.
 *
 * Применённые фиксы:
 *   FIX 5  — work_id для PM: берём primary_work_id ИЛИ последний filled day.work_id.
 *            Если ничего нет — popover показывает блок «Выберите работу».
 *   FIX 6  — Возвращена колонка «Дни» (счётчик отмеченных дней).
 *   FIX 8  — Tooltip с телефоном автора (entered_by_phone).
 *   FIX 13 — onPopoverChange — сигнал parent'у о открытии/закрытии popover.
 *   FIX 14 — Группировка по объекту для pm-mode (через groupEmployees).
 */
import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import CellEditor from './CellEditor';
import {
  TYPE_META, daysInMonth, toIsoDate, fmtNum, fmtMoney, roleShort, fmtDateTime,
  groupEmployees, inferWorkIdForEmployee
} from './api';

const TOOLTIP_DELAY = 300;

export default function TimesheetGrid({
  data,
  mode,
  editableTypes = [],
  canEdit = false,
  isLocked = false,
  requireWorkForDayNight = false,
  onEntryChange,
  onPopoverChange   // FIX 13: вызывать с true когда popover открыт, false когда закрыт
}) {
  const year = data?.year;
  const month = data?.month;
  const dim = data?.days_in_month || daysInMonth(year || 2026, month || 1);
  const cols = data?.columns || { points: 'mine', amount: 'none', perDiem: 'show' };

  const days = useMemo(() => {
    const arr = [];
    if (!year || !month) return arr;
    for (let d = 1; d <= dim; d++) {
      const dt = new Date(year, month - 1, d);
      const iso = toIsoDate(year, month, d);
      const wd = dt.getDay();
      const wdLabel = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][wd];
      arr.push({ d, iso, weekend: wd === 0 || wd === 6, wdLabel });
    }
    return arr;
  }, [year, month, dim]);

  // FIX 14 — pm-mode тоже группируется по объекту
  const groups = useMemo(() => {
    const employees = data?.employees || [];
    return groupEmployees(employees, mode);
  }, [data, mode]);

  /* Состояние popover */
  const [editing, setEditing] = useState(null);
  const cellRefs = useRef(new Map());

  // FIX 13 — сигналим parent'у
  useEffect(() => {
    if (onPopoverChange) onPopoverChange(!!editing);
  }, [editing, onPopoverChange]);

  const setCellRef = useCallback((key, el) => {
    if (el) cellRefs.current.set(key, el);
    else cellRefs.current.delete(key);
  }, []);

  const handleCellClick = useCallback((employee, day) => {
    if (!canEdit) return;
    const dateIso = toIsoDate(year, month, day);
    setEditing({ employee, day, dateIso });
  }, [canEdit, year, month]);

  const handleSave = useCallback(async (type) => {
    if (!editing) return;
    // FIX 5 — корректный work_id: primary_work_id ИЛИ last-filled day.work_id ИЛИ существующий cell.work_id
    const cell = editing.employee.days?.[editing.day];
    const workId = cell?.work_id || inferWorkIdForEmployee(editing.employee);
    const payload = {
      employee_id: editing.employee.id,
      work_id: workId,
      date: editing.dateIso,
      type,
      delete: false
    };
    await onEntryChange?.(payload);
  }, [editing, onEntryChange]);

  const handleDelete = useCallback(async () => {
    if (!editing) return;
    const cell = editing.employee.days?.[editing.day];
    const payload = {
      employee_id: editing.employee.id,
      work_id: cell?.work_id || inferWorkIdForEmployee(editing.employee),
      date: editing.dateIso,
      type: cell?.type || 'day',
      delete: true
    };
    await onEntryChange?.(payload);
  }, [editing, onEntryChange]);

  const closeEditing = useCallback(() => setEditing(null), []);

  /* Tooltip */
  const [tip, setTip] = useState(null);
  const tipTimerRef = useRef(null);

  const onCellMouseEnter = useCallback((e, employee, day) => {
    const cell = employee.days?.[day];
    if (!cell || !cell.type) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
    tipTimerRef.current = setTimeout(() => {
      setTip({
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
        employee,
        day,
        cell,
        dateIso: toIsoDate(year, month, day)
      });
    }, TOOLTIP_DELAY);
  }, [year, month]);

  const onCellMouseLeave = useCallback(() => {
    if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
    setTip(null);
  }, []);

  useEffect(() => () => {
    if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
  }, []);

  useEffect(() => {
    const onScroll = () => setTip(null);
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, []);

  const totalDays = days.length;

  if (!data || !groups.length || groups.every((g) => g.items.length === 0)) {
    return (
      <div className="ts-wrap">
        <div className="ts-empty">Нет данных за выбранный период</div>
      </div>
    );
  }

  const showAmount = cols.amount === 'show';
  const showPerDiem = cols.perDiem === 'show';
  const showPoints = cols.points !== 'none';
  // FIX 6 — колонка «Дни» всегда (vanilla показывает её)
  const showDaysCol = true;
  // Phase 1C — 7 финансовых колонок только в global-режиме
  const showFinanceCols = mode === 'global';
  const monthlyLimit = Number(data?.summary?.limits?.monthly) || 0;

  return (
    <>
      <div className="ts-wrap">
        <table className="ts-table" role="grid" aria-label="Табель">
          <thead>
            <tr>
              <th className="ts-fio-th" scope="col">ФИО / должность</th>
              {/* Q3 — Город (только в mode='global') */}
              {showFinanceCols && <th className="ts-total-cell" scope="col">Город</th>}
              {days.map((d) => (
                <th
                  key={d.iso}
                  className={d.weekend ? 'ts-th-weekend' : ''}
                  scope="col"
                  aria-label={`${d.d} ${d.wdLabel}`}
                >
                  <div className="ts-th-day-num">{d.d}</div>
                  <div className="ts-th-day-wd">{d.wdLabel}</div>
                </th>
              ))}
              {showDaysCol && <th className="ts-total-cell" scope="col">Дни</th>}
              {showPoints && <th className="ts-total-cell" scope="col">Баллы</th>}
              {showAmount && <th className="ts-total-cell money" scope="col">Сумма</th>}
              {showPerDiem && <th className="ts-total-cell money" scope="col">Сутки</th>}
              {/* Phase 1C — 9 финансовых колонок (mode='global'): 1B+ добавлены 🎁/⚠
                  Q3 — после «Тип» вставлена колонка «Получает»
                  Stage S — между «Заработ. ₽» и «🎁 Премия» добавлена «📤 Выплачено ₽» */}
              {showFinanceCols && (
                <>
                  <th className="ts-total-cell" scope="col">Тип</th>
                  <th className="ts-total-cell" scope="col" title="Кому уходят деньги (СЗ сам / через получателя / оклад / наличка)">Получает</th>
                  <th className="ts-total-cell money" scope="col">Заработ. ₽</th>
                  <th className="ts-total-cell money" scope="col" title="Уже выплачено в поле через worker_payments (paid + confirmed)">📤 Выплачено ₽</th>
                  <th className="ts-total-cell money" scope="col" title="Премии за месяц">🎁 Премия ₽</th>
                  <th className="ts-total-cell money" scope="col" title="Штрафы за месяц">⚠ Штраф ₽</th>
                  <th className="ts-total-cell money" scope="col">Оклад ₽</th>
                  <th
                    className="ts-total-cell money"
                    scope="col"
                    title={"Что уходит на карту:\nСЗ — на карту самого СЗ (или получателя НПД)\nОф — оклад/несгораемая, платит бухгалтер\nНал — 0"}
                  >На карту ₽</th>
                  <th
                    className="ts-total-cell money"
                    scope="col"
                    title={"Что отдаёт директор налом из табельной кассы:\nСЗ — превышение лимита\nОф — что заработал сверх оклада\nНал — всё earned"}
                  >Из кассы ₽</th>
                  <th className="ts-total-cell money" scope="col">Лимит СЗ год</th>
                  <th className="ts-total-cell money" scope="col">Лимит СЗ мес</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <RowGroup
                key={g.title || 'main'}
                group={g}
                days={days}
                mode={mode}
                cols={cols}
                showDaysCol={showDaysCol}
                showAmount={showAmount}
                showPerDiem={showPerDiem}
                showPoints={showPoints}
                showFinanceCols={showFinanceCols}
                monthlyLimit={monthlyLimit}
                colSpan={
                  totalDays + 1 +
                  (showDaysCol ? 1 : 0) +
                  (showPoints ? 1 : 0) +
                  (showAmount ? 1 : 0) +
                  (showPerDiem ? 1 : 0) +
                  /* Q3 — +Город (перед днями) +Получает (после Тип) — обе в global
                     Stage S — +Выплачено ₽ (после Заработ.) → 11 + 1 = 12 */
                  (showFinanceCols ? 12 : 0)
                }
                canEdit={canEdit}
                isLocked={isLocked}
                onClick={handleCellClick}
                onEnter={onCellMouseEnter}
                onLeave={onCellMouseLeave}
                setCellRef={setCellRef}
              />
            ))}
          </tbody>
        </table>
      </div>

      {tip && <Tooltip {...tip} />}

      {editing && (
        <CellEditor
          anchorRef={{ current: cellRefs.current.get(`${editing.employee.id}-${editing.day}`) || null }}
          open={!!editing}
          onClose={closeEditing}
          onSave={handleSave}
          onDelete={handleDelete}
          editableTypes={editableTypes}
          currentEntry={editing.employee.days?.[editing.day] || null}
          fio={editing.employee.fio}
          dateIso={editing.dateIso}
          workTitle={
            editing.employee.days?.[editing.day]?.work_title ||
            editing.employee.primary_work_title ||
            editing.employee.work_title
          }
          requireWorkForDayNight={
            requireWorkForDayNight &&
            !(editing.employee.days?.[editing.day]?.work_id || inferWorkIdForEmployee(editing.employee))
          }
          readonly={isLocked}
        />
      )}
    </>
  );
}

function RowGroup({ group, days, mode, cols, showDaysCol, showAmount, showPerDiem, showPoints, showFinanceCols, monthlyLimit, colSpan, canEdit, isLocked, onClick, onEnter, onLeave, setCellRef }) {
  // FIX 14 — pm также показывает заголовок группы
  const showGroupHeader = (mode === 'global' || mode === 'pm') && group.title;
  return (
    <>
      {showGroupHeader && (
        <tr className="ts-group-header">
          <td colSpan={colSpan}>{group.title}</td>
        </tr>
      )}
      {group.items.map((emp) => (
        <EmployeeRow
          key={emp.id}
          employee={emp}
          days={days}
          cols={cols}
          showDaysCol={showDaysCol}
          showAmount={showAmount}
          showPerDiem={showPerDiem}
          showPoints={showPoints}
          showFinanceCols={showFinanceCols}
          monthlyLimit={monthlyLimit}
          canEdit={canEdit}
          isLocked={isLocked}
          onClick={onClick}
          onEnter={onEnter}
          onLeave={onLeave}
          setCellRef={setCellRef}
        />
      ))}
    </>
  );
}

function EmployeeRow({ employee, days, cols, showDaysCol, showAmount, showPerDiem, showPoints, showFinanceCols, monthlyLimit, canEdit, isLocked, onClick, onEnter, onLeave, setCellRef }) {
  // FIX 6 — счётчик дней
  const daysFilled = useMemo(() => {
    if (employee.days_count != null) return Number(employee.days_count);
    let n = 0;
    if (employee.days) {
      for (const v of Object.values(employee.days)) {
        if (v?.type) n += 1;
      }
    }
    return n;
  }, [employee]);

  return (
    <tr>
      <td className="ts-fio-td">
        <div className="ts-fio">{employee.fio || '—'}</div>
        {employee.position && <div className="ts-position">{employee.position}</div>}
      </td>
      {/* Q3 — Город (только в global) */}
      {showFinanceCols && (
        <td className="ts-city">{employee.city || '—'}</td>
      )}
      {days.map((d) => {
        const cell = employee.days?.[d.d];
        return (
          <td key={d.iso}>
            <Cell
              employee={employee}
              day={d.d}
              cell={cell}
              cols={cols}
              canEdit={canEdit}
              isLocked={isLocked}
              onClick={onClick}
              onEnter={onEnter}
              onLeave={onLeave}
              setCellRef={setCellRef}
            />
          </td>
        );
      })}
      {showDaysCol && (
        <td className="ts-total-cell">{daysFilled || '—'}</td>
      )}
      {showPoints && (
        <td className="ts-total-cell">
          {employee.total_points != null ? fmtNum(employee.total_points) : '—'}
        </td>
      )}
      {showAmount && (
        <td className="ts-total-cell money">
          {employee.total_amount != null ? fmtMoney(employee.total_amount) : '—'}
        </td>
      )}
      {showPerDiem && (
        <td className="ts-total-cell money">
          {employee.per_diem_total != null ? fmtMoney(employee.per_diem_total) : '—'}
        </td>
      )}
      {showFinanceCols && (
        <FinanceCells employee={employee} monthlyLimit={monthlyLimit} />
      )}
    </tr>
  );
}

/* ─── 7 финансовых колонок (Phase 1C) ─── */
function FinanceCells({ employee, monthlyLimit }) {
  const payType = employee.pay_type || null;
  const cashDelta = useMemo(() => {
    const ret = Number(employee.cash_return) || 0;
    const pay = Number(employee.cash_payout) || 0;
    return ret - pay;
  }, [employee.cash_return, employee.cash_payout]);

  const cashCls =
    cashDelta > 0 ? 'pos' :
    cashDelta < 0 ? 'neg' : '';

  // Лимит-колонки: если остаток > 2 * monthly_limit → зелёный (healthy),
  // иначе бледно-красный (tight). Для null/не-СЗ — прочерк без подсветки.
  const limitCls = (val) => {
    if (val == null || isNaN(val)) return '';
    if (monthlyLimit <= 0) return '';
    return Number(val) > 2 * monthlyLimit ? 'healthy' : 'tight';
  };

  const bonusVal   = Number(employee.bonus   || 0);
  const penaltyVal = Number(employee.penalty || 0);

  // Q3 — «Получает»: kind+label+tooltip из backend-полей
  // pay_type: self_employed / self_employed_payee / official / cash
  const paySrc = paymentSourceMeta(employee);

  return (
    <>
      {/* Тип */}
      <td className="ts-total-cell ts-pay-type-cell">
        {payType ? <PayTypePill type={payType} /> : '—'}
      </td>
      {/* Q3 — Получает (кому уходят деньги) */}
      <td className="ts-total-cell ts-pay-source-cell">
        {paySrc ? (
          <span
            className={`ts-src-cell src-${paySrc.kind}`}
            title={paySrc.tooltip}
          >
            {paySrc.label}
          </span>
        ) : '—'}
      </td>
      {/* Заработано */}
      <td className="ts-total-cell money ts-fin-cell">
        {employee.earned != null ? fmtMoney(employee.earned) : '—'}
      </td>
      {/* Stage S — 📤 Выплачено ₽: оранжевый бейдж с tooltip разбивки;
          прочерк когда paid_total<=0. */}
      {(() => {
        const paidTotal = Number(employee.paid_total || 0);
        if (paidTotal <= 0) {
          return <td className="ts-total-cell money ts-fin-cell ts-mute">—</td>;
        }
        const b = employee.paid_breakdown || {};
        const parts = [];
        if (Number(b.per_diem || 0) > 0) parts.push(`сут ${fmtMoney(b.per_diem)}`);
        if (Number(b.bonus    || 0) > 0) parts.push(`бонус ${fmtMoney(b.bonus)}`);
        if (Number(b.salary   || 0) > 0) parts.push(`зп ${fmtMoney(b.salary)}`);
        if (Number(b.advance  || 0) > 0) parts.push(`аванс ${fmtMoney(b.advance)}`);
        const tooltip =
          `Налом: ${fmtMoney(employee.paid_cash)} ₽ · ` +
          `Переводом: ${fmtMoney(employee.paid_transfer)} ₽` +
          (parts.length > 0 ? `\n${parts.join(' · ')}` : '');
        return (
          <td className="ts-total-cell money ts-fin-cell">
            <span className="ts-paid-cell" title={tooltip}>
              {fmtMoney(paidTotal)} ₽
            </span>
          </td>
        );
      })()}
      {/* 🎁 Премия — зелёная если >0, прочерк если 0 */}
      <td className={`ts-total-cell money ts-fin-cell ts-bonus-cell ${bonusVal > 0 ? 'has-value' : ''}`}>
        {bonusVal > 0 ? fmtMoney(bonusVal) : '—'}
      </td>
      {/* ⚠ Штраф — розовая если >0, прочерк если 0 */}
      <td className={`ts-total-cell money ts-fin-cell ts-penalty-cell ${penaltyVal > 0 ? 'has-value' : ''}`}>
        {penaltyVal > 0 ? fmtMoney(penaltyVal) : '—'}
      </td>
      {/* Оклад */}
      <td className="ts-total-cell money ts-fin-cell">
        {employee.deduct_salary != null && Number(employee.deduct_salary) > 0
          ? fmtMoney(employee.deduct_salary)
          : '—'}
      </td>
      {/* На карту — Stage U: для оф-сотрудников подкраска индиго «🏢 платит бухгалтер» */}
      <td className="ts-total-cell money ts-fin-cell">
        {employee.transfer_amount != null && Number(employee.transfer_amount) > 0 && employee.is_officially_employed ? (
          <span
            className="ts-pay-cell pay-buh"
            title={`Платит бухгалтер через банк (${Number(employee.official_non_burnable || 0) > 0 ? 'несгораемая' : 'оклад'})`}
          >
            🏢 {fmtMoney(employee.transfer_amount)} ₽
          </span>
        ) : (
          employee.transfer_amount != null ? fmtMoney(employee.transfer_amount) : '—'
        )}
      </td>
      {/* Из кассы ₽ — только cash_payout (доплата налом). Без знака. */}
      <td className="ts-total-cell money ts-fin-cell ts-cash-cell neg" title="Сумма, доплаченная наличными из кассы">
        {employee.cash_payout && Number(employee.cash_payout) > 0
          ? fmtMoney(employee.cash_payout)
          : '—'}
      </td>
      {/* Лимит СЗ год — остаток */}
      <td className={`ts-total-cell money ts-limit-cell ${limitCls(employee.yearly_remaining)}`}>
        {employee.yearly_remaining != null ? fmtMoney(employee.yearly_remaining) : '—'}
      </td>
      {/* Лимит СЗ мес — остаток */}
      <td className={`ts-total-cell money ts-limit-cell ${limitCls(employee.monthly_remaining)}`}>
        {employee.monthly_remaining != null ? fmtMoney(employee.monthly_remaining) : '—'}
      </td>
    </>
  );
}

function PayTypePill({ type }) {
  // Q3: для self_employed_payee показываем тот же СЗ-пилл (это всё ещё «СЗ»),
  // отличие — в колонке «Получает».
  const norm = type === 'self_employed_payee' ? 'self_employed' : type;
  const meta = {
    self_employed: { cls: 'se',   label: 'СЗ' },
    official:      { cls: 'off',  label: 'Оф' },
    cash:          { cls: 'cash', label: 'Нал' }
  }[norm];
  if (!meta) return <span>—</span>;
  return <span className={`ts-pay-pill ts-pay-pill--${meta.cls}`}>{meta.label}</span>;
}

/* Q3 — meta для колонки «Получает».
 * Возвращает { kind, label, tooltip } или null если payType неизвестен.
 * Источник правды по pay_type — backend:
 *   self_employed         → 'self'   («Сам»)
 *   self_employed_payee   → 'via'    («Через ФИО payee»)
 *   official              → 'salary' («Оклад»)
 *   cash                  → 'cash'   («Нал»)
 * Если backend прислал payment_source_label — используем как label (с приоритетом).
 */
function paymentSourceMeta(emp) {
  if (!emp) return null;
  const pt = emp.pay_type || null;
  const backendLabel = emp.payment_source_label || null;
  const payee = emp.payee_fio || null;
  const phone = emp.payee_phone || null;

  // Маппинг pay_type → kind+default label+tooltip
  let kind, defLabel, tooltip;
  switch (pt) {
    case 'self_employed':
      kind = 'self';
      defLabel = 'Сам';
      tooltip = 'Самозанятый сам получает';
      break;
    case 'self_employed_payee':
      kind = 'via';
      defLabel = payee ? `Через ${payee}` : 'Через получателя';
      tooltip = payee
        ? `Через ${payee}${phone ? ` · ${phone}` : ''}`
        : 'Через получателя';
      break;
    case 'official':
      kind = 'salary';
      defLabel = 'Оклад';
      tooltip = 'Оклад на банковский счёт';
      break;
    case 'cash':
      kind = 'cash';
      defLabel = 'Наличка';
      tooltip = 'Наличными через РП';
      break;
    default:
      // Fallback: если есть backendLabel, но нет pay_type — рисуем нейтрально
      if (backendLabel) return { kind: 'cash', label: backendLabel, tooltip: backendLabel };
      return null;
  }

  // Backend label — приоритет (например, «через Иванов И.И.»)
  const label = backendLabel || defLabel;
  return { kind, label, tooltip };
}

function Cell({ employee, day, cell, cols, canEdit, isLocked, onClick, onEnter, onLeave, setCellRef }) {
  const key = `${employee.id}-${day}`;

  if (!cell || !cell.type) {
    return (
      <div
        ref={(el) => setCellRef(key, el)}
        className={'ts-cell' + (canEdit && !isLocked ? ' editable' : '') + (isLocked ? ' locked' : '')}
        onClick={() => canEdit && !isLocked && onClick(employee, day)}
        role={canEdit ? 'button' : undefined}
        tabIndex={canEdit ? 0 : undefined}
        aria-label={canEdit ? `Добавить отметку ${employee.fio} день ${day}` : undefined}
        onKeyDown={(e) => {
          if (canEdit && !isLocked && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick(employee, day);
          }
        }}
      />
    );
  }

  const meta = TYPE_META[cell.type] || TYPE_META.day;
  let content;
  if (cols.points === 'always' && cell.points != null) {
    content = String(cell.points);
  } else if (cols.points === 'mine' && cell.is_mine && cell.points != null) {
    content = String(cell.points);
  } else {
    content = meta.icon;
  }
  const isIconOnly = content === meta.icon;

  return (
    <div
      ref={(el) => setCellRef(key, el)}
      className={
        'ts-cell has-value' +
        (isIconOnly ? ' icon-only' : '') +
        (canEdit && !isLocked ? ' editable' : '') +
        (isLocked ? ' locked' : '')
      }
      style={{
        '--bg': `var(${meta.bgVar})`,
        '--fg': `var(${meta.fgVar})`
      }}
      onClick={() => canEdit && !isLocked && onClick(employee, day)}
      onMouseEnter={(e) => onEnter(e, employee, day)}
      onMouseLeave={onLeave}
      role={canEdit ? 'button' : 'img'}
      tabIndex={canEdit ? 0 : undefined}
      aria-label={`${meta.title} ${cell.points != null ? cell.points + ' баллов' : ''}`}
      onKeyDown={(e) => {
        if (canEdit && !isLocked && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick(employee, day);
        }
      }}
    >
      {content}
    </div>
  );
}

/* ─── Tooltip (Hover) ─── */
function Tooltip({ x, y, employee, day, cell, dateIso }) {
  const meta = TYPE_META[cell.type];
  if (!meta) return null;
  const style = {
    left: x,
    top: y,
    transform: 'translate(-50%, -100%)'
  };
  // FIX 8 — формат с телефоном автора
  const dt = dateIso ? dateIso.split('-').reverse().join('.') : '';
  return (
    <div className="ts-tooltip" style={style} role="tooltip">
      <div className="ts-tooltip-title">{employee.fio} · {dt}</div>
      <div className="ts-tooltip-row">
        <span aria-hidden="true">{meta.icon}</span> {meta.title}
        {cell.points != null && ` · ${cell.points} баллов`}
        {cell.amount != null && cell.amount > 0 && ` · ${fmtMoney(cell.amount)}`}
      </div>
      {cell.work_title && (
        <div className="ts-tooltip-row">Объект: {cell.work_title}</div>
      )}
      {cell.entered_by_fio && (
        <div className="ts-tooltip-meta">
          Внёс: {cell.entered_by_fio}{cell.entered_by_role ? ` (${roleShort(cell.entered_by_role)})` : ''}
          {cell.entered_by_phone && ` · ${cell.entered_by_phone}`}
          {cell.entered_at && ` · ${fmtDateTime(cell.entered_at)}`}
        </div>
      )}
    </div>
  );
}
