/**
 * Settings → таб «Калькулятор»: нормы, налоги, ставки + JSON role_rates/chemicals/transport.
 */
import { num, safeParseJSON } from '../api';
import { toast } from '@/modals/Notifications';

export default function CalculatorTab({ app, setApp }) {
  const calc = app.calc || {};
  const set = (k, v) => setApp((a) => ({ ...a, calc: { ...(a.calc || {}), [k]: v } }));

  const onJsonChange = (k, text, expected) => {
    const parsed = safeParseJSON(text, null);
    if (parsed === null) {
      toast.error(`Калькулятор: ${k} — ошибка JSON, проверьте синтаксис`);
      return;
    }
    if (expected === 'object' && Array.isArray(parsed)) {
      toast.error(`Калькулятор: ${k} — ожидается объект, а не массив`);
      return;
    }
    if (expected === 'array' && !Array.isArray(parsed)) {
      toast.error(`Калькулятор: ${k} — ожидается массив`);
      return;
    }
    set(k, parsed);
  };

  return (
    <div className="sett-grid">
      <div className="sett-card">
        <h3>ᚱ Рунический Калькулятор — нормы и коэффициенты</h3>
        <p className="sett-hint">
          Базовые значения для авто-просчёта тендеров. Влияют на расчёт прибыли, накладных, ставок.
        </p>

        <div className="sett-row">
          <div className="sett-field">
            <label>Мин. прибыль/чел-день (жёлтая), ₽</label>
            <input
              type="number" min="0" step="1000"
              className="inp-text"
              value={calc.min_profit_per_person_day ?? 20000}
              onChange={(e) =>
                set('min_profit_per_person_day', Math.max(0, Math.round(num(e.target.value, 20000))))
              }
            />
          </div>
          <div className="sett-field">
            <label>Норма прибыли/чел-день (зелёная), ₽</label>
            <input
              type="number" min="0" step="1000"
              className="inp-text"
              value={calc.norm_profit_per_person_day ?? 25000}
              onChange={(e) =>
                set('norm_profit_per_person_day', Math.max(0, Math.round(num(e.target.value, 25000))))
              }
            />
          </div>
          <div className="sett-field">
            <label>Накладные расходы, %</label>
            <input
              type="number" min="0" step="0.5"
              className="inp-text"
              value={calc.overhead_pct ?? 10}
              onChange={(e) => set('overhead_pct', Math.max(0, num(e.target.value, 10)))}
            />
          </div>
          <div className="sett-field">
            <label>Налоги на ФОТ, %</label>
            <input
              type="number" min="0" step="1"
              className="inp-text"
              value={calc.fot_tax_pct ?? 50}
              onChange={(e) => set('fot_tax_pct', Math.max(0, num(e.target.value, 50)))}
            />
          </div>
          <div className="sett-field">
            <label>Налог на прибыль, %</label>
            <input
              type="number" min="0" step="1"
              className="inp-text"
              value={calc.profit_tax_pct ?? 20}
              onChange={(e) => set('profit_tax_pct', Math.max(0, num(e.target.value, 20)))}
            />
          </div>
          <div className="sett-field">
            <label>Базовая ставка рабочего, ₽</label>
            <input
              type="number" min="0" step="100"
              className="inp-text"
              value={calc.base_rate ?? 5500}
              onChange={(e) => set('base_rate', Math.max(0, Math.round(num(e.target.value, 5500))))}
            />
          </div>
          <div className="sett-field">
            <label>Коэфф. запаса сроков</label>
            <input
              type="number" min="1" max="2" step="0.05"
              className="inp-text"
              value={calc.auto_days_multiplier ?? 1.2}
              onChange={(e) =>
                set('auto_days_multiplier', Math.max(1, Math.min(2, num(e.target.value, 1.2))))
              }
            />
          </div>
          <div className="sett-field">
            <label>Коэфф. запаса бригады</label>
            <input
              type="number" min="1" max="2" step="0.05"
              className="inp-text"
              value={calc.auto_people_multiplier ?? 1.1}
              onChange={(e) =>
                set('auto_people_multiplier', Math.max(1, Math.min(2, num(e.target.value, 1.1))))
              }
            />
          </div>
        </div>
      </div>

      <div className="sett-card">
        <h3>🛠 Ставки ролей (role_rates) — JSON-объект</h3>
        <p className="sett-hint">
          Соответствие должность → дневная ставка (₽). Пример: <code>{`{"мастер": 7000, "сварщик": 6500}`}</code>
        </p>
        <textarea
          className="sett-textarea"
          rows={8}
          defaultValue={JSON.stringify(calc.role_rates || {}, null, 2)}
          onBlur={(e) => onJsonChange('role_rates', e.target.value, 'object')}
        />
      </div>

      <div className="sett-card">
        <h3>🧪 Химсоставы (chemicals) — JSON-массив</h3>
        <p className="sett-hint">
          Список химикатов с расходом/ценой. Используется в мастере просчёта.
        </p>
        <textarea
          className="sett-textarea"
          rows={8}
          defaultValue={JSON.stringify(calc.chemicals || [], null, 2)}
          onBlur={(e) => onJsonChange('chemicals', e.target.value, 'array')}
        />
      </div>

      <div className="sett-card">
        <h3>🚚 Транспорт (transport) — JSON-массив</h3>
        <p className="sett-hint">
          Транспортные опции (грузовик/Камаз/спецтехника) с ценой за км и сутки.
        </p>
        <textarea
          className="sett-textarea"
          rows={10}
          defaultValue={JSON.stringify(calc.transport || calc.transport_options || [], null, 2)}
          onBlur={(e) => onJsonChange('transport', e.target.value, 'array')}
        />
      </div>
    </div>
  );
}
