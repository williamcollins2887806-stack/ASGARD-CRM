import { BLOCK_META, fmtMoney } from '../api';

/**
 * Цветная полоса структуры себестоимости (6 блоков).
 * Источник: vanilla `estimate_report.js:405..434 renderCostBar`.
 */
export default function CostBar({ calcData }) {
  if (!calcData || !Array.isArray(calcData.blocks)) return null;
  const segs = calcData.blocks
    .map((b) => ({
      id: b.id,
      label: b.name || BLOCK_META[b.id]?.name || b.id,
      color: b.color || BLOCK_META[b.id]?.color || '#888',
      value: Number(b.subtotal) || 0
    }))
    .filter((s) => s.value > 0);
  const total = segs.reduce((s, b) => s + b.value, 0);
  if (total === 0) return null;

  return (
    <div className="card er-costbar-card">
      <strong className="section-eyebrow">
        Структура себестоимости
      </strong>
      <div className="er-costbar">
        {segs.map((b) => (
          <div key={b.id} title={`${b.label}: ${fmtMoney(b.value)}`} style={{ width: `${(b.value / total) * 100}%`, background: b.color }} />
        ))}
      </div>
      <div className="er-costbar-legend">
        {segs.map((b) => (
          <span key={b.id} className="er-costbar-chip">
            <span className="er-costbar-swatch" style={{ background: b.color }} />
            <span>{b.label}: <strong>{fmtMoney(b.value)}</strong> · {((b.value / total) * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
