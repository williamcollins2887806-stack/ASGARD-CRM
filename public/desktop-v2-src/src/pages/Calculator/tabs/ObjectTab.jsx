/**
 * Вкладка 1: «Объект».
 * Заказчик / Объект (read-only из тендера) + Тип работы + Город + Расстояние + Условия + Допущения.
 * Источник: vanilla `tabObject` в calculator_v2.js.
 */
import { Field } from '@/modals/parts';
import { TextInput, NumberInput, SelectInput, Combobox, Checkbox } from '@/inputs/Inputs';
import { num } from '../api';

export default function ObjectTab({ state, settings, set, toggleCondition }) {
  const wtOpts = (settings.work_types || []).map((w) => ({
    value: w.id,
    label: `${w.icon || ''} ${w.name}`
  }));

  // Чекбоксы условий: только те доплаты, что не привязаны к ролям.
  const conditions = (settings.surcharges || []).filter((x) => !x.roles);

  const onWorkTypeChange = (v) => {
    // Смена типа работ сбрасывает manual-флаги и параметры — autoFill пересчитает всё.
    set({
      work_type_id: String(v || 'custom'),
      params: {},
      crew_manual: false,
      days_manual: false,
      chem_manual: false,
      equip_manual: false
    });
  };

  return (
    <div>
      <section className="calc-csec">
        <h3>Тендер</h3>
        <div className="calc-row-2">
          <Field label="Заказчик">
            <TextInput value={state.customer_name || ''} disabled placeholder="—" />
          </Field>
          <Field label="Объект">
            <TextInput value={state.tender_title || ''} disabled placeholder="—" />
          </Field>
        </div>
        {!state.tender_id && (
          <div className="calc-hint">Тендер не выбран — расчёт «вслепую». Сохранить можно после выбора тендера.</div>
        )}
      </section>

      <section className="calc-csec">
        <h3>Тип работы</h3>
        <Field label="Тип">
          <SelectInput value={state.work_type_id} onChange={onWorkTypeChange} options={wtOpts} />
        </Field>
      </section>

      <section className="calc-csec">
        <h3>Место выполнения</h3>
        <div className="calc-row-2">
          <Field label="Город" help="Введите вручную или выберите из подсказок">
            <Combobox
              value={state.city || ''}
              onChange={(v, opt) => {
                set({ city: String(v || '') });
                if (opt && Number.isFinite(opt.km)) set({ distance_km: num(opt.km, 0) });
              }}
              options={[]}
              allowFreeText
              placeholder="Москва, Екатеринбург, Сургут…"
            />
          </Field>
          <Field label="Расстояние от Москвы, км" help="Если города нет в списке — введите вручную">
            <NumberInput
              value={state.distance_km}
              onChange={(v) => set({ distance_km: num(v, 0) })}
              min={0}
              max={15000}
            />
          </Field>
        </div>
      </section>

      <section className="calc-csec">
        <h3>Условия работы <span className="calc-hint-inline">— влияют на ставки</span></h3>
        <div className="calc-cgrid">
          {conditions.map((cond) => (
            <Checkbox
              key={cond.id}
              checked={(state.conditions || []).includes(cond.id)}
              onChange={() => toggleCondition(cond.id)}
              label={`${cond.name} (+${cond.pct}%)`}
            />
          ))}
        </div>
      </section>

      <section className="calc-csec">
        <h3>Допущения и риски</h3>
        <textarea
          className="m-textarea"
          rows={3}
          value={state.assumptions || ''}
          onChange={(e) => set({ assumptions: e.target.value })}
          placeholder="Например: доступ на объект с 8:00 до 20:00, требуется пропуск, возможны простои из-за погоды…"
        />
        <div className="calc-hint">Важные допущения помогут директору при согласовании.</div>
      </section>
    </div>
  );
}
