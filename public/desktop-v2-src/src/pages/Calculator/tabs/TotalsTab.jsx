/**
 * Вкладка 8: «Итоги».
 * Себестоимость (разбивка) + цена (НДС, маржа) + светофор статуса.
 * Источник: vanilla `tabTotals` в calculator_v2.js.
 */
import { Field, Pill } from '@/modals/parts';
import { NumberInput } from '@/inputs/Inputs';
import { fmtMoney, num } from '../api';

const STATUS_LABEL = {
  red:    { txt: '🔴 КРАСНАЯ ЗОНА',    tone: 'rejected' },
  yellow: { txt: '🟡 ЖЁЛТАЯ ЗОНА',     tone: 'amber' },
  green:  { txt: '🟢 ЗЕЛЁНАЯ ЗОНА',    tone: 'approved' }
};

export default function TotalsTab({ state, summary, set }) {
  const status = STATUS_LABEL[summary.status] || STATUS_LABEL.red;

  return (
    <div>
      <section className="calc-csec">
        <h3>📊 Себестоимость</h3>
        <table className="calc-tbl calc-tbl-totals">
          <tbody>
            <tr><td>ФОТ + налоги ({summary.fot_tax_pct}%)</td>
                <td className="calc-num">{fmtMoney(summary.payroll_total + summary.fot_tax)}</td></tr>
            <tr><td>Суточные</td><td className="calc-num">{fmtMoney(summary.per_diem_total)}</td></tr>
            <tr><td>Проживание</td><td className="calc-num">{fmtMoney(summary.lodging_total)}</td></tr>
            <tr><td>Мобилизация</td><td className="calc-num">{fmtMoney(summary.mobilization_total)}</td></tr>
            <tr><td>Химия + расходники</td><td className="calc-num">{fmtMoney(summary.chem_total + summary.consumables)}</td></tr>
            <tr><td>Оборудование</td><td className="calc-num">{fmtMoney(summary.equip_total)}</td></tr>
            <tr><td>Логистика</td><td className="calc-num">{fmtMoney(summary.logistics_total)}</td></tr>
            <tr><td>СИЗ</td><td className="calc-num">{fmtMoney(summary.ppe_total)}</td></tr>
            <tr><td>Накладные ({summary.overhead_pct}%)</td><td className="calc-num">{fmtMoney(summary.overhead)}</td></tr>
            <tr className="calc-tr-total">
              <td><strong>СЕБЕСТОИМОСТЬ</strong></td>
              <td className="calc-num"><strong>{fmtMoney(summary.cost_total)}</strong></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="calc-csec">
        <h3>💰 Цена</h3>
        <Field label="Маржа, %">
          <NumberInput
            value={state.margin_pct}
            onChange={(v) => set({ margin_pct: num(v, 20) })}
            min={5}
            max={100}
            step={0.5}
          />
        </Field>
        <table className="calc-tbl calc-tbl-totals calc-mt-12">
          <tbody>
            <tr><td>Цена без НДС</td><td className="calc-num">{fmtMoney(summary.price_no_vat)}</td></tr>
            <tr><td>НДС ({summary.vat_pct}%)</td>
                <td className="calc-num">{fmtMoney(summary.price_with_vat - summary.price_no_vat)}</td></tr>
            <tr className="calc-tr-total calc-tr-price">
              <td><strong>ЦЕНА С НДС</strong></td>
              <td className="calc-num"><strong>{fmtMoney(summary.price_with_vat)}</strong></td>
            </tr>
            <tr className="calc-tr-profit">
              <td>Прибыль до налога</td>
              <td className="calc-num">{fmtMoney(summary.profit_before_tax)}</td>
            </tr>
            <tr>
              <td>Налог на прибыль ({summary.profit_tax_pct}%)</td>
              <td className="calc-num">{fmtMoney(summary.profit_tax)}</td>
            </tr>
            <tr className="calc-tr-total calc-tr-net">
              <td><strong>Чистая прибыль</strong></td>
              <td className="calc-num"><strong>{fmtMoney(summary.net_profit)}</strong></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className={'calc-csec calc-status calc-status--' + summary.status}>
        <div className="calc-status__zone">
          <Pill tone={status.tone}>{status.txt}</Pill>
        </div>
        <div className="calc-status__val">{fmtMoney(summary.profit_per_day)}</div>
        <div className="calc-status__sub">прибыль / чел-день</div>
        <div className="calc-hint calc-mt-8 t-center">
          {summary.people_count} чел × {summary.work_days} дней = {summary.people_count * summary.work_days} чел-дней
          · норма ≥ {fmtMoney(summary.norm_profit)}, минимум ≥ {fmtMoney(summary.min_profit)}
        </div>
      </section>
    </div>
  );
}
