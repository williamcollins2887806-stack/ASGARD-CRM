import { fmtMoney, calcMargin } from '../api';

/**
 * 4 карточки финансовой сводки: себестоимость / наценка / цена клиенту / маржа.
 * Источник: vanilla `estimate_report.js:297..326 renderSummaryCards`.
 *
 * Берём данные из распарсенного calcData.summary (cost_no_vat/markup/price_no_vat/margin_pct),
 * с fallback на поля estimates (cost_plan/markup_multiplier/price_tkp/margin).
 */
export default function SummaryCards({ estimate, calcData }) {
  const s = calcData?.summary || {};
  const cost = +s.cost_no_vat || +estimate?.cost_plan || +estimate?.cost || 0;
  const markup = +s.markup || +estimate?.markup_multiplier || 1;
  const price = +s.price_no_vat || +estimate?.price_tkp || +estimate?.amount || 0;
  const margin = calcMargin(price, cost);
  const marginTone = margin == null ? 'default' : margin < 5 ? 'rejected' : margin < 15 ? 'question' : 'approved';
  const marginRub = price - cost;

  const cards = [
    { label: '📉 Себестоимость',    value: fmtMoney(cost),                                            tone: 'default', sub: '' },
    { label: '➕ Наценка',           value: '×' + Number(markup || 1).toFixed(2),                      tone: 'default', sub: markup > 1 ? '+' + ((markup - 1) * 100).toFixed(0) + '%' : '' },
    { label: '💰 Цена клиенту',      value: fmtMoney(price),                                           tone: 'default', sub: '' },
    { label: '📊 Маржа',             value: margin == null ? '—' : margin.toFixed(1) + '%',            tone: marginTone, sub: fmtMoney(marginRub) }
  ];

  const colorByTone = {
    rejected: 'var(--err)',
    question: 'var(--amber)',
    approved: 'var(--ok)',
    default:  'var(--t-1)'
  };

  // v2 BONUS: copy-to-clipboard итогов одним кликом (vanilla — переписывать руками) — title с подсказкой
  const copyTotals = () => {
    const text = `Себестоимость: ${fmtMoney(cost)}\nНаценка: ×${Number(markup || 1).toFixed(2)}\nЦена клиенту: ${fmtMoney(price)}\nМаржа: ${margin == null ? '—' : margin.toFixed(1) + '% (' + fmtMoney(marginRub) + ')'}`;
    navigator.clipboard?.writeText(text);
  };

  return (
    <div className="er-summary-grid">
      {cards.map((c) => (
        <div
          key={c.label}
          className="card er-summary-card"
          style={{ borderLeft: `3px solid ${colorByTone[c.tone] || 'var(--gold)'}`, cursor: 'pointer' }}
          onClick={copyTotals}
          title="Клик — скопировать все 4 итога в буфер"
        >
          <div className="er-summary-card-label">
            {c.label}
          </div>
          <div className="er-summary-card-value" style={{ color: colorByTone[c.tone] }}>{c.value}</div>
          {c.sub && <div className="er-summary-card-sub">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
