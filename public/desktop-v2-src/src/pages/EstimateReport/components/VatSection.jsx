/**
 * VatSection — налоги и НДС (справочно).
 * Vanilla: estimate_report.js:331..400 (renderVatSection).
 *
 * Считает:
 *   • НДС к начислению = 20% от цены клиенту
 *   • НДС к вычету     = 20% от суммы блоков с НДС (chemistry/transport/travel)
 *   • НДС к уплате     = начислено − вычет
 *   • Налог на прибыль = 20% от маржи
 *   • ФОТ (без НДС, для справки)
 */
import { fmtMoney } from '../api';

const VAT_RATE = 0.20;
const INCOME_TAX_RATE = 0.20;
const VAT_DEDUCT_BLOCKS = ['chemistry', 'transport', 'travel'];

export default function VatSection({ estimate, calcData }) {
  const est = estimate || {};
  const s = calcData?.summary || {};
  const blocks = calcData?.blocks || [];

  const price = Number(s.price_no_vat) || Number(est.price_tkp) || 0;
  const cost = Number(s.cost_no_vat) || Number(est.cost_plan) || 0;
  const margin = price - cost;

  if (price <= 0) return null;

  const vatCharged = price * VAT_RATE;
  const vatDeductBase = blocks
    .filter((b) => VAT_DEDUCT_BLOCKS.includes(b.id))
    .reduce((sum, b) => sum + (Number(b.subtotal) || 0), 0);
  const vatDeduct = vatDeductBase * VAT_RATE;
  const vatNet = vatCharged - vatDeduct;

  const fotBlock = blocks.find((b) => b.id === 'personnel');
  const fotTotal = Number(fotBlock?.subtotal) || 0;

  const incomeTax = margin > 0 ? margin * INCOME_TAX_RATE : 0;

  return (
    <div className="card er-vat">
      <div className="er-vat__title">Налоги и НДС (справочно)</div>
      <div className="er-vat__grid">
        <div className="er-vat__cell">
          <div className="er-vat__label">НДС к начислению (20%)</div>
          <div className="er-vat__value er-vat__value--red">{fmtMoney(vatCharged)}</div>
          <div className="er-vat__sub">от цены клиенту</div>
        </div>
        <div className="er-vat__cell">
          <div className="er-vat__label">НДС к вычету (20%)</div>
          <div className="er-vat__value er-vat__value--green">{fmtMoney(vatDeduct)}</div>
          <div className="er-vat__sub">хим., транспорт, командировочные</div>
        </div>
        <div className="er-vat__cell">
          <div className="er-vat__label">НДС к уплате</div>
          <div className={'er-vat__value ' + (vatNet > 0 ? 'er-vat__value--amber' : 'er-vat__value--green')}>
            {fmtMoney(vatNet)}
          </div>
          <div className="er-vat__sub">начислено − вычет</div>
        </div>
        <div className="er-vat__cell">
          <div className="er-vat__label">Налог на прибыль (20%)</div>
          <div className="er-vat__value er-vat__value--purple">{fmtMoney(incomeTax)}</div>
          <div className="er-vat__sub">от маржи {fmtMoney(margin)}</div>
        </div>
      </div>
      <div className="er-vat__note">
        💡 <b>Разбивка:</b> ФОТ (без НДС) — {fmtMoney(fotTotal)} · Расходы с НДС
        (хим/транспорт/командировочные) — {fmtMoney(vatDeductBase)}
      </div>
    </div>
  );
}
