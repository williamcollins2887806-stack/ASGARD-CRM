/**
 * Вкладка 7: «Логистика и доп».
 * Объединяет доставку (транспорт + кпи) + проживание + мобилизацию.
 * Источник: vanilla `tabLogistics` в calculator_v2.js.
 */
import { Field } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { fmtMoney, num } from '../api';

export default function LogisticsTab({ state, settings, summary, set }) {
  const transOpts = [{ value: 'auto', label: '🤖 Авто' }].concat(
    (settings.transport || []).map((t) => ({
      value: t.id,
      label: `${t.name} (до ${num(t.max_kg, 0) / 1000}т) — ${t.rate_km}₽/км`
    }))
  );
  const lodOpts = Object.entries(settings.lodging || {}).map(([id, l]) => ({
    value: id,
    label: `${l.name} — ${l.rate_per_day}₽/сут`
  }));
  const mobOpts = [{ value: 'auto', label: '🤖 Авто' }].concat(
    Object.entries(settings.mobilization || {}).map(([id, m]) => ({
      value: id,
      label: `${m.name} — ${m.rate_per_person}₽/чел`
    }))
  );

  return (
    <div>
      <section className="calc-csec">
        <h3>Доставка груза</h3>
        <Field label="Транспорт">
          <SelectInput
            value={state.transport_id}
            onChange={(v) => set({ transport_id: String(v || 'auto') })}
            options={transOpts}
          />
        </Field>
        <div className="calc-kpi-row">
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Груз</div>
            <div className="calc-kpi__val">{Math.round(summary.total_weight_kg)} кг</div>
            <div className="calc-kpi__sub">{summary.total_volume_m3.toFixed(2)} м³</div>
          </div>
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Транспорт</div>
            <div className="calc-kpi__val">{summary.transport?.name || '—'}</div>
            <div className="calc-kpi__sub">{summary.transport ? `${summary.transport.rate_km} ₽/км` : ''}</div>
          </div>
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Расстояние</div>
            <div className="calc-kpi__val">{summary.distance_km} км × 2</div>
            <div className="calc-kpi__sub">туда-обратно</div>
          </div>
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Итого логистика</div>
            <div className="calc-kpi__val c-gold">{fmtMoney(summary.logistics_total)}</div>
          </div>
        </div>
      </section>

      <section className="calc-csec">
        <h3>Проживание</h3>
        <Field label="Тип">
          <SelectInput
            value={state.lodging_type}
            onChange={(v) => set({ lodging_type: String(v || 'hotel_3') })}
            options={lodOpts}
          />
        </Field>
        <div className="calc-kpi-row">
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Ставка</div>
            <div className="calc-kpi__val">{fmtMoney(settings.lodging?.[state.lodging_type]?.rate_per_day || 0)}/сут</div>
          </div>
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Чел × Дней</div>
            <div className="calc-kpi__val">{summary.people_count} × {summary.total_days}</div>
          </div>
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Итого проживание</div>
            <div className="calc-kpi__val c-gold">{fmtMoney(summary.lodging_total)}</div>
          </div>
        </div>
      </section>

      <section className="calc-csec">
        <h3>Мобилизация</h3>
        <Field label="Способ">
          <SelectInput
            value={state.mobilization_type}
            onChange={(v) => set({ mobilization_type: String(v || 'auto') })}
            options={mobOpts}
          />
        </Field>
        <div className="calc-kpi-row">
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Способ</div>
            <div className="calc-kpi__val">{summary.mobilization_obj?.name || '—'}</div>
            <div className="calc-kpi__sub">{summary.mobilization_obj ? `${summary.mobilization_obj.rate_per_person} ₽/чел` : ''}</div>
          </div>
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Чел × 2</div>
            <div className="calc-kpi__val">{summary.people_count} × 2</div>
            <div className="calc-kpi__sub">туда-обратно</div>
          </div>
          <div className="calc-kpi">
            <div className="calc-kpi__lbl">Итого мобилизация</div>
            <div className="calc-kpi__val c-gold">{fmtMoney(summary.mobilization_total)}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
