/**
 * Вкладка 2: «Параметры объекта».
 * Параметры зависят от типа работы (settings.work_types[id].params).
 * Кнопка «Автоподбор» — сбрасывает manual-флаги и пересчитывает crew/days/chem/equipment.
 * Источник: vanilla `tabParams` в calculator_v2.js.
 */
import { Btn, Field } from '@/modals/parts';
import { TextInput, NumberInput, SelectInput } from '@/inputs/Inputs';
import { num } from '../api';

export default function ParamsTab({ state, settings, set, onAutoFill }) {
  const wt = (settings.work_types || []).find((w) => w.id === state.work_type_id);

  if (!wt || !wt.params || !wt.params.length) {
    return (
      <section className="calc-csec">
        <div className="calc-hint">Для этого типа работ параметров не задано.</div>
        <div className="calc-mt-12">
          <Btn variant="ghost" onClick={onAutoFill}>🤖 Автоподбор</Btn>
        </div>
      </section>
    );
  }

  const setParam = (key, v) => {
    set({ params: { ...(state.params || {}), [key]: v } });
  };

  return (
    <section className="calc-csec">
      <h3>{wt.icon} {wt.name}</h3>
      {wt.desc && <div className="calc-hint">{wt.desc}</div>}
      <div className="calc-row">
        {wt.params.map((p) => {
          const v = state.params?.[p.id] ?? '';
          if (p.type === 'select') {
            const opts = (p.options || []).map((o) => ({ value: o, label: o }));
            return (
              <Field key={p.id} label={p.name}>
                <SelectInput
                  value={v}
                  onChange={(nv) => setParam(p.id, String(nv || ''))}
                  options={opts}
                  placeholder="Выберите…"
                />
              </Field>
            );
          }
          if (p.type === 'number') {
            return (
              <Field key={p.id} label={`${p.name}${p.unit ? `, ${p.unit}` : ''}`}>
                <NumberInput
                  value={v}
                  onChange={(nv) => setParam(p.id, num(nv, 0))}
                  min={0}
                />
              </Field>
            );
          }
          return (
            <Field key={p.id} label={p.name}>
              <TextInput value={String(v || '')} onChange={(nv) => setParam(p.id, String(nv || ''))} />
            </Field>
          );
        })}
      </div>
      <div className="calc-mt-12">
        <Btn variant="primary" onClick={onAutoFill}>🤖 Автоподбор бригады/сроков/химии/оборудования</Btn>
      </div>
    </section>
  );
}
