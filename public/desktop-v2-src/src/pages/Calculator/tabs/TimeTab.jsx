/**
 * Вкладка 4: «Сроки».
 * Подготовка / Работа / Демобилизация в днях + KPI-плитки.
 * Источник: vanilla `tabTime` в calculator_v2.js.
 */
import { Field } from '@/modals/parts';
import { NumberInput, Checkbox } from '@/inputs/Inputs';
import { num } from '../api';

export default function TimeTab({ state, set }) {
  const total = num(state.prep_days, 0) + num(state.work_days, 0) + num(state.demob_days, 0);

  return (
    <section className="calc-csec">
      <h3>Сроки выполнения</h3>
      <Checkbox
        checked={!!state.days_manual}
        onChange={(v) => set({ days_manual: !!v })}
        label="Ручной режим (не пересчитывать при автоподборе)"
      />
      <div className="calc-row">
        <Field label="Подготовка, дн">
          <NumberInput
            value={state.prep_days}
            onChange={(v) => set({ prep_days: num(v, 0), days_manual: true })}
            min={0}
            max={30}
          />
        </Field>
        <Field label="Работа, дн">
          <NumberInput
            value={state.work_days}
            onChange={(v) => set({ work_days: num(v, 1), days_manual: true })}
            min={1}
            max={365}
          />
        </Field>
        <Field label="Демобилизация, дн">
          <NumberInput
            value={state.demob_days}
            onChange={(v) => set({ demob_days: num(v, 0), days_manual: true })}
            min={0}
            max={14}
          />
        </Field>
      </div>
      <div className="calc-kpi-row">
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Подготовка</div>
          <div className="calc-kpi__val">{num(state.prep_days, 0)} дн</div>
        </div>
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Работа</div>
          <div className="calc-kpi__val">{num(state.work_days, 0)} дн</div>
        </div>
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Демобилизация</div>
          <div className="calc-kpi__val">{num(state.demob_days, 0)} дн</div>
        </div>
        <div className="calc-kpi">
          <div className="calc-kpi__lbl">Всего</div>
          <div className="calc-kpi__val c-gold">{total} дн</div>
        </div>
      </div>
    </section>
  );
}
