/**
 * BulkShiftModal — «Заполнить шаблоном» — массовая запись смен.
 *
 * Заполняет диапазон дат указанным шаблоном (типичная неделя Пн-Пт 8-17, или
 * «все дни день», или «выходные пропускать») для выбранных сотрудников.
 *
 * Использует POST /api/field/manage/projects/:work_id/checkin (Upsert через
 * ON CONFLICT employee_id+date+work_id — vanilla field-manage.js:1003).
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Pill } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { SHIFT_TYPES, getShiftMeta, buildDateRange, dayOfWeek, dowShort, dayLabel } from './timesheetUtils';
import { createCheckin } from '../api';

const TEMPLATES = [
  { value: 'workweek',  label: 'Будни (Пн–Пт)', daysFn: (dow) => dow >= 1 && dow <= 5 },
  { value: 'all',       label: 'Все дни',        daysFn: () => true },
  { value: 'sixday',    label: 'Шестидневка (Пн–Сб)', daysFn: (dow) => dow >= 1 && dow <= 6 },
  { value: 'weekends',  label: 'Только выходные (Сб–Вс)', daysFn: (dow) => dow === 0 || dow === 6 }
];

export function BulkShiftModal({ workId, from, to, employees = [], onDone }) {
  const { close } = useModal();
  const [template, setTemplate] = useState('workweek');
  const [shift, setShift] = useState('day');
  const [points, setPoints] = useState(getShiftMeta('day').defaultPts);
  const [hours, setHours] = useState(getShiftMeta('day').hours);
  const [pointValue, setPointValue] = useState(500);
  const [overwrite, setOverwrite] = useState(false);
  const [selected, setSelected] = useState(new Set(employees.map((e) => e.employee_id || e.id)));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const toggleAll = (on) => {
    if (on) setSelected(new Set(employees.map((e) => e.employee_id || e.id)));
    else setSelected(new Set());
  };
  const toggleOne = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const onPickShift = (v) => {
    setShift(v);
    const meta = getShiftMeta(v);
    setPoints(meta.defaultPts);
    setHours(meta.hours);
  };

  const tmpl = TEMPLATES.find((t) => t.value === template) || TEMPLATES[0];
  const dates = buildDateRange(from, to);
  const targetDates = dates.filter((d) => tmpl.daysFn(dayOfWeek(d)));
  const totalCalls = targetDates.length * selected.size;
  const totalAmount = points * pointValue;

  async function apply() {
    if (!selected.size) {
      toast('Шаблон', 'Выбери хотя бы одного сотрудника', 'warn');
      return;
    }
    if (!targetDates.length) {
      toast('Шаблон', 'Нет дней под шаблон в выбранном периоде', 'warn');
      return;
    }
    if (points <= 0) {
      toast('Шаблон', 'Баллы должны быть > 0', 'warn');
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: totalCalls, failed: 0 });
    let done = 0;
    let failed = 0;
    const empIds = [...selected];
    for (const empId of empIds) {
      for (const date of targetDates) {
        try {
          await createCheckin(workId, {
            employee_id: empId,
            date,
            shift,
            hours_worked: hours,
            hours_paid: hours,
            day_rate: points * pointValue,
            amount_earned: points * pointValue,
            status: 'completed'
          });
          done++;
        } catch (e) {
          failed++;
        }
        setProgress({ done: done + failed, total: totalCalls, failed });
      }
    }
    setBusy(false);
    if (failed > 0) {
      toast('Шаблон применён', `${done} записей · ошибок: ${failed}`, failed === totalCalls ? 'err' : 'warn');
    } else {
      toast('Шаблон применён', `Создано/обновлено ${done} записей`, 'ok');
    }
    onDone?.();
    close();
  }

  return (
    <MCard className="modal-md">
      <MHead
        icon="📅"
        title="Заполнить шаблоном"
        subtitle={`${from} — ${to}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="ft-stack-10">
          <Field label="Шаблон расписания">
            <SelectInput
              value={template}
              onChange={setTemplate}
              options={TEMPLATES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </Field>

          <div className="ft-ts-pop-shifts" role="radiogroup" aria-label="Тип смены">
            {SHIFT_TYPES.map((st) => (
              <button
                key={st.value}
                type="button"
                className={'ft-ts-pop-shift' + (shift === st.value ? ' on' : '')}
                onClick={() => onPickShift(st.value)}
              >
                <span className="ic" aria-hidden="true">{st.icon}</span>
                <span className="lbl">{st.label}</span>
              </button>
            ))}
          </div>

          <div className="ft-row-grid-2">
            <Field label="Часы">
              <input
                type="number"
                className="m-input"
                value={hours}
                min={0}
                max={24}
                step={0.5}
                onChange={(e) => setHours(Math.max(0, Math.min(24, parseFloat(e.target.value) || 0)))}
              />
            </Field>
            <Field label="Баллы / день">
              <input
                type="number"
                className="m-input"
                value={points}
                min={1}
                max={30}
                onChange={(e) => setPoints(Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))}
              />
            </Field>
          </div>

          <Field label="Стоимость балла, ₽">
            <input
              type="number"
              className="m-input"
              value={pointValue}
              min={1}
              onChange={(e) => setPointValue(Math.max(1, parseInt(e.target.value) || 500))}
            />
          </Field>

          <div className="ft-card-soft">
            <div className="ft-card-eyebrow">Сотрудники ({selected.size} / {employees.length})</div>
            <div className="ft-row" style={{ gap: 6, marginBottom: 6 }}>
              <Btn variant="ghost" size="sm" onClick={() => toggleAll(true)}>Все</Btn>
              <Btn variant="ghost" size="sm" onClick={() => toggleAll(false)}>Никого</Btn>
            </div>
            <div className="ft-ts-bulk-emps">
              {employees.length === 0 && <div className="muted">Бригада пуста</div>}
              {employees.map((e) => {
                const id = e.employee_id || e.id;
                const checked = selected.has(id);
                return (
                  <label key={id} className={'ft-ts-bulk-emp' + (checked ? ' on' : '')}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(id)}
                    />
                    <span>{e.fio || e.employee_name || e.name || `#${id}`}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="ft-summary-soft">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Pill tone="default">{targetDates.length} {pl(targetDates.length, 'день', 'дня', 'дней')}</Pill>
              <Pill tone="default">{selected.size} {pl(selected.size, 'сотрудник', 'сотрудника', 'сотрудников')}</Pill>
              <Pill tone="gold">≈ {totalCalls} записей</Pill>
              <Pill tone="default">{totalAmount.toLocaleString('ru-RU')} ₽/смена</Pill>
            </div>
            <div className="help" style={{ marginTop: 6 }}>
              {targetDates.slice(0, 14).map((d) => (
                <span key={d} className="ft-ts-bulk-day-chip">
                  {dowShort(d)} {dayLabel(d)}
                </span>
              ))}
              {targetDates.length > 14 && <span className="muted"> +{targetDates.length - 14}</span>}
            </div>
          </div>

          <label className="ft-row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            <span className="help">Перезаписать существующие смены (upsert через ON CONFLICT)</span>
          </label>

          {progress && (
            <div className="ft-summary-soft">
              <strong>Прогресс:</strong> {progress.done} / {progress.total}
              {progress.failed > 0 && <span className="ft-text-money-err"> · ошибок: {progress.failed}</span>}
            </div>
          )}
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={apply} disabled={busy || !selected.size || !targetDates.length}>
          {busy ? '⏳ Применяем…' : `Применить (${totalCalls})`}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function pl(n, one, two, many) {
  const a = Math.abs(n) % 10;
  const b = Math.abs(n) % 100;
  if (b > 10 && b < 20) return many;
  if (a === 1) return one;
  if (a >= 2 && a <= 4) return two;
  return many;
}
